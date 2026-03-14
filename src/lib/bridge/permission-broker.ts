/**
 * Permission Broker — forwards Claude permission requests to IM channels
 * and handles user responses via inline buttons.
 *
 * When Claude needs tool approval, the broker:
 * 1. Formats a permission prompt with inline keyboard buttons
 * 2. Sends it via the delivery layer
 * 3. Records the link between permission ID and IM message
 * 4. When a callback arrives, resolves the permission via the existing registry
 */

import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { ChannelAddress, OutboundMessage } from './types';
import type { BaseChannelAdapter } from './channel-adapter';
import { deliver } from './delivery-layer';
import { insertPermissionLink, getPermissionLink, markPermissionLinkResolved, getSession, getDb, getPermissionRequest } from '../db';
import { resolvePendingPermission } from '../permission-registry';
import { escapeHtml } from './adapters/telegram-utils';

/**
 * Dedup recent permission forwards to prevent duplicate cards.
 * Key: permissionRequestId, value: timestamp. Entries expire after 30s.
 */
const recentPermissionForwards = new Map<string, number>();

/**
 * Forward a permission request to an IM channel as an interactive message.
 */
export async function forwardPermissionRequest(
  adapter: BaseChannelAdapter,
  address: ChannelAddress,
  permissionRequestId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionId?: string,
  suggestions?: unknown[],
  replyToMessageId?: string,
): Promise<void> {
  // Check if this session uses full_access permission profile — auto-approve without IM notification
  if (sessionId) {
    const session = getSession(sessionId);
    if (session?.permission_profile === 'full_access') {
      console.log(`[bridge] Auto-approved permission ${permissionRequestId} (tool=${toolName}) due to full_access profile`);
      resolvePendingPermission(permissionRequestId, { behavior: 'allow' });
      return;
    }
  }

  // Dedup: prevent duplicate forwarding of the same permission request
  const now = Date.now();
  if (recentPermissionForwards.has(permissionRequestId)) {
    console.warn(`[permission-broker] Duplicate forward suppressed for ${permissionRequestId}`);
    return;
  }
  recentPermissionForwards.set(permissionRequestId, now);
  // Clean up old entries
  for (const [id, ts] of recentPermissionForwards) {
    if (now - ts > 30_000) recentPermissionForwards.delete(id);
  }

  console.log(`[permission-broker] Forwarding permission request: ${permissionRequestId} tool=${toolName} channel=${adapter.channelType}`);

  // Channels without inline button support (e.g. QQ) need text-based
  // permission commands. Check if the adapter ignores inlineButtons.
  const supportsButtons = adapter.channelType !== 'qq';

  let message: OutboundMessage;

  // AskUserQuestion: render as interactive question form instead of raw JSON
  if (toolName === 'AskUserQuestion' && supportsButtons) {
    message = buildAskUserQuestionMessage(address, permissionRequestId, toolInput, replyToMessageId);
  } else {
    // Generic permission card
    const inputStr = JSON.stringify(toolInput, null, 2);
    const truncatedInput = inputStr.length > 300
      ? inputStr.slice(0, 300) + '...'
      : inputStr;

    const textLines = [
      `<b>Permission Required</b>`,
      ``,
      `Tool: <code>${escapeHtml(toolName)}</code>`,
      `<pre>${escapeHtml(truncatedInput)}</pre>`,
      ``,
    ];

    if (supportsButtons) {
      textLines.push(`Choose an action:`);
    } else {
      // Text-based permission commands for channels without inline buttons
      textLines.push(
        `Reply with one of:`,
        `/perm allow ${permissionRequestId}`,
        `/perm allow_session ${permissionRequestId}`,
        `/perm deny ${permissionRequestId}`,
      );
    }

    const text = textLines.join('\n');

    message = {
      address,
      text,
      parseMode: supportsButtons ? 'HTML' : 'plain',
      inlineButtons: supportsButtons
        ? [
            [
              { text: 'Allow', callbackData: `perm:allow:${permissionRequestId}` },
              { text: 'Allow Session', callbackData: `perm:allow_session:${permissionRequestId}` },
              { text: 'Deny', callbackData: `perm:deny:${permissionRequestId}` },
            ],
          ]
        : undefined,
      replyToMessageId,
    };
  }

  const result = await deliver(adapter, message, { sessionId });

  // Record the link so we can match callback queries back to this permission
  if (result.ok && result.messageId) {
    try {
      insertPermissionLink({
        permissionRequestId,
        channelType: adapter.channelType,
        chatId: address.chatId,
        messageId: result.messageId,
        toolName,
        suggestions: suggestions ? JSON.stringify(suggestions) : '',
      });
    } catch { /* best effort */ }
  }
}

/**
 * Build an OutboundMessage for AskUserQuestion with interactive option buttons.
 * Each option becomes a button; clicking it selects and submits the answer.
 */
function buildAskUserQuestionMessage(
  address: ChannelAddress,
  permissionRequestId: string,
  toolInput: Record<string, unknown>,
  replyToMessageId?: string,
): OutboundMessage {
  const questions = (toolInput.questions || []) as Array<{
    question: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
    header?: string;
  }>;

  const textLines: string[] = [];
  const buttons: { text: string; callbackData: string }[][] = [];

  for (let qIdx = 0; qIdx < questions.length; qIdx++) {
    const q = questions[qIdx];
    if (q.header) {
      textLines.push(`<b>${escapeHtml(q.header)}</b>`);
    }
    textLines.push(escapeHtml(q.question));
    textLines.push('');

    // Each option as a button — callback: ask:{permId}:{qIdx}:{optionLabel}
    const row: { text: string; callbackData: string }[] = [];
    for (const opt of q.options) {
      row.push({
        text: opt.label,
        callbackData: `ask:${permissionRequestId}:${qIdx}:${opt.label}`,
      });
    }
    buttons.push(row);
  }

  return {
    address,
    text: textLines.join('\n'),
    parseMode: 'HTML',
    inlineButtons: buttons,
    replyToMessageId,
  };
}

/**
 * Validate and atomically claim a permission link for callback processing.
 * Checks origin (chat/message ID), dedup (already resolved), and claims atomically.
 * Returns the link on success, or null if validation/claim fails.
 */
function validateAndClaimLink(
  permissionRequestId: string,
  callbackChatId: string,
  callbackMessageId?: string,
): ReturnType<typeof getPermissionLink> | null {
  const link = getPermissionLink(permissionRequestId);
  if (!link) {
    console.warn(`[permission-broker] No permission link found for ${permissionRequestId}`);
    return null;
  }

  if (link.chatId !== callbackChatId) {
    console.warn(`[permission-broker] Chat ID mismatch for ${permissionRequestId}`);
    return null;
  }

  if (callbackMessageId && link.messageId !== callbackMessageId) {
    console.warn(`[permission-broker] Message ID mismatch for ${permissionRequestId}`);
    return null;
  }

  if (link.resolved) {
    console.warn(`[permission-broker] Permission ${permissionRequestId} already resolved`);
    return null;
  }

  try {
    if (!markPermissionLinkResolved(permissionRequestId)) {
      console.warn(`[permission-broker] Permission ${permissionRequestId} already claimed by concurrent handler`);
      return null;
    }
  } catch {
    return null;
  }

  return link;
}

/**
 * Handle a permission callback from an inline button press.
 * Validates that the callback came from the same chat AND same message that
 * received the permission request, prevents duplicate resolution via atomic
 * DB check-and-set, and implements real allow_session semantics by passing
 * updatedPermissions (suggestions).
 *
 * Returns true if the callback was recognized and handled.
 */
export function handlePermissionCallback(
  callbackData: string,
  callbackChatId: string,
  callbackMessageId?: string,
): boolean {
  // Handle AskUserQuestion callbacks: ask:{permId}:{qIdx}:{optionLabel}
  if (callbackData.startsWith('ask:')) {
    return handleAskUserQuestionCallback(callbackData, callbackChatId, callbackMessageId);
  }

  // Parse callback data: perm:action:permId
  const parts = callbackData.split(':');
  if (parts.length < 3 || parts[0] !== 'perm') return false;

  const action = parts[1];
  const permissionRequestId = parts.slice(2).join(':');

  const link = validateAndClaimLink(permissionRequestId, callbackChatId, callbackMessageId);
  if (!link) return false;

  let resolved: boolean;

  switch (action) {
    case 'allow':
      resolved = resolvePendingPermission(permissionRequestId, {
        behavior: 'allow',
      });
      break;

    case 'allow_session': {
      let updatedPermissions: PermissionUpdate[] | undefined;
      if (link.suggestions) {
        try {
          updatedPermissions = JSON.parse(link.suggestions) as PermissionUpdate[];
        } catch { /* fall through without updatedPermissions */ }
      }

      resolved = resolvePendingPermission(permissionRequestId, {
        behavior: 'allow',
        ...(updatedPermissions ? { updatedPermissions } : {}),
      });
      break;
    }

    case 'deny':
      resolved = resolvePendingPermission(permissionRequestId, {
        behavior: 'deny',
        message: 'Denied via IM bridge',
      });
      break;

    default:
      return false;
  }

  return resolved;
}

/**
 * Handle AskUserQuestion callback: resolve with the selected option as answer.
 * Callback format: ask:{permId}:{qIdx}:{optionLabel}
 */
function handleAskUserQuestionCallback(
  callbackData: string,
  callbackChatId: string,
  callbackMessageId?: string,
): boolean {
  // Parse: ask:{permId}:{qIdx}:{optionLabel}
  // Strategy: split from the end — last segment is optionLabel, second-to-last is qIdx, rest is permId
  const segments = callbackData.slice(4).split(':'); // skip "ask:"
  if (segments.length < 3) return false;

  const optionLabel = segments[segments.length - 1];
  const qIdxStr = segments[segments.length - 2];
  const permissionRequestId = segments.slice(0, -2).join(':');
  const qIdx = parseInt(qIdxStr, 10);
  if (isNaN(qIdx)) return false;

  if (!validateAndClaimLink(permissionRequestId, callbackChatId, callbackMessageId)) return false;

  // Build updatedInput matching the format the PC UI sends:
  // { questions: originalQuestions, answers: { [question]: selectedOption } }
  const permRow = getPermissionRequest(permissionRequestId);
  let originalQuestions: Array<{ question: string; options: unknown[]; multiSelect?: boolean; header?: string }> = [];
  if (permRow?.tool_input) {
    try {
      const toolInput = JSON.parse(permRow.tool_input);
      originalQuestions = toolInput.questions || [];
    } catch { /* fallback */ }
  }

  const answers: Record<string, string> = {};
  if (originalQuestions[qIdx]) {
    answers[originalQuestions[qIdx].question] = optionLabel;
  }

  return resolvePendingPermission(permissionRequestId, {
    behavior: 'allow',
    updatedInput: { questions: originalQuestions, answers },
  });
}

/**
 * Auto-approve all pending permission requests for a session.
 * Called when a session switches from 'default' to 'full_access' profile.
 * Resolves in-memory pending permissions and marks DB links as resolved.
 */
export function autoApprovePendingForSession(sessionId: string): number {
  // The permission_requests DB table tracks pending permissions by session_id.
  // Find all pending ones and resolve them via the in-memory registry.
  const db = getDb();

  const pendingRows = db.prepare(
    "SELECT id FROM permission_requests WHERE session_id = ? AND status = 'pending'"
  ).all(sessionId) as { id: string }[];

  let resolved = 0;
  for (const row of pendingRows) {
    const ok = resolvePendingPermission(row.id, { behavior: 'allow' });
    if (ok) {
      resolved++;
      console.log(`[bridge] Auto-approved pending permission ${row.id} for session ${sessionId} (profile switched to full_access)`);
    }
    // Also mark the IM link as resolved so the button becomes inoperative
    try { markPermissionLinkResolved(row.id); } catch { /* best effort */ }
  }

  if (resolved > 0) {
    console.log(`[bridge] Auto-approved ${resolved} pending permission(s) for session ${sessionId}`);
  }
  return resolved;
}
