'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Message as AIMessage,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { ToolActionsGroup } from '@/components/ai-elements/tool-actions-group';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
} from '@/components/ai-elements/confirmation';
import { Shimmer } from '@/components/ai-elements/shimmer';
import type { ToolUIPart } from 'ai';
import type { PermissionRequestEvent } from '@/types';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
  toolUses?: ToolUseInfo[];
  toolResults?: ToolResultInfo[];
  streamingToolOutput?: string;
  statusText?: string;
  pendingPermission?: PermissionRequestEvent | null;
  onPermissionResponse?: (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>) => void;
  permissionResolved?: 'allow' | 'deny' | null;
  onForceStop?: () => void;
}

function ElapsedTimer() {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    startRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <span className="tabular-nums">
      {mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}
    </span>
  );
}

function StreamingStatusBar({ statusText, onForceStop }: { statusText?: string; onForceStop?: () => void }) {
  const displayText = statusText || 'Thinking';

  // Parse elapsed seconds from statusText like "Running bash... (45s)"
  const elapsedMatch = statusText?.match(/\((\d+)s\)/);
  const toolElapsed = elapsedMatch ? parseInt(elapsedMatch[1], 10) : 0;
  const isWarning = toolElapsed >= 60;
  const isCritical = toolElapsed >= 90;

  return (
    <div className="flex items-center gap-3 py-2 px-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className={isCritical ? 'text-red-500' : isWarning ? 'text-yellow-500' : undefined}>
          <Shimmer duration={1.5}>{displayText}</Shimmer>
        </span>
        {isWarning && !isCritical && (
          <span className="text-yellow-500 text-[10px]">Running longer than usual</span>
        )}
        {isCritical && (
          <span className="text-red-500 text-[10px]">Tool may be stuck</span>
        )}
      </div>
      <span className="text-muted-foreground/50">|</span>
      <ElapsedTimer />
      {isCritical && onForceStop && (
        <button
          type="button"
          onClick={onForceStop}
          className="ml-auto rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-500 transition-colors hover:bg-red-500/20"
        >
          Force stop
        </button>
      )}
    </div>
  );
}

interface AskQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

function AskUserQuestionCard({
  toolInput,
  onAnswer,
  onSkip,
  resolved,
}: {
  toolInput: Record<string, unknown>;
  onAnswer: (answers: Record<string, string>) => void;
  onSkip: () => void;
  resolved: 'allow' | 'deny' | null;
}) {
  const questions = (toolInput.questions ?? []) as AskQuestion[];
  const [customInputIdx, setCustomInputIdx] = useState<number | null>(null);
  const [customText, setCustomText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (customInputIdx !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [customInputIdx]);

  const handleSelect = useCallback((questionText: string, label: string) => {
    onAnswer({ [questionText]: label });
  }, [onAnswer]);

  const handleCustomSubmit = useCallback((questionText: string) => {
    if (customText.trim()) {
      onAnswer({ [questionText]: customText.trim() });
    }
  }, [customText, onAnswer]);

  if (resolved) {
    return (
      <div className="rounded-lg border border-border/50 bg-card/50 p-4">
        <p className={`text-xs ${resolved === 'allow' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {resolved === 'allow' ? 'Answered' : 'Skipped'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {questions.map((q, qIdx) => (
        <div key={qIdx} className="rounded-lg border border-border/50 bg-card/50 p-4 space-y-3">
          <p className="text-sm font-medium">{q.question}</p>
          <div className="space-y-2">
            {q.options.map((opt, optIdx) => (
              <button
                key={optIdx}
                type="button"
                onClick={() => handleSelect(q.question, opt.label)}
                className="flex w-full items-center justify-between rounded-md border border-border/60 bg-background px-4 py-3 text-left transition-colors hover:bg-accent hover:border-accent-foreground/20"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{opt.label}</div>
                  {opt.description && (
                    <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                  )}
                </div>
                <span className="ml-3 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-xs font-medium">
                  {optIdx + 1}
                </span>
              </button>
            ))}
            {/* "Type something else..." option */}
            {customInputIdx === qIdx ? (
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-4 py-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCustomSubmit(q.question);
                    if (e.key === 'Escape') { setCustomInputIdx(null); setCustomText(''); }
                  }}
                  placeholder="Type your answer..."
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => handleCustomSubmit(q.question)}
                  disabled={!customText.trim()}
                  className="rounded px-2 py-1 text-xs font-medium text-primary hover:bg-accent disabled:opacity-40"
                >
                  Submit
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setCustomInputIdx(qIdx); setCustomText(''); }}
                className="flex w-full items-center justify-between rounded-md border border-dashed border-border/60 bg-background px-4 py-3 text-left transition-colors hover:bg-accent hover:border-accent-foreground/20"
              >
                <span className="text-sm text-muted-foreground">Type something else...</span>
                <span className="ml-3 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-xs font-medium">
                  {q.options.length + 1}
                </span>
              </button>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Skip
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function StreamingMessage({
  content,
  isStreaming,
  toolUses = [],
  toolResults = [],
  streamingToolOutput,
  statusText,
  pendingPermission,
  onPermissionResponse,
  permissionResolved,
  onForceStop,
}: StreamingMessageProps) {
  const runningTools = toolUses.filter(
    (tool) => !toolResults.some((r) => r.tool_use_id === tool.id)
  );

  // Determine confirmation state for the AI Elements component
  const getConfirmationState = (): ToolUIPart['state'] => {
    if (permissionResolved) return 'approval-responded';
    if (pendingPermission) return 'approval-requested';
    return 'input-available';
  };

  const getApproval = () => {
    if (!pendingPermission && !permissionResolved) return undefined;
    if (permissionResolved === 'allow') {
      return { id: pendingPermission?.permissionRequestId || '', approved: true as const };
    }
    if (permissionResolved === 'deny') {
      return { id: pendingPermission?.permissionRequestId || '', approved: false as const };
    }
    // Pending - no decision yet
    return { id: pendingPermission?.permissionRequestId || '' };
  };

  const formatToolInput = (input: Record<string, unknown>): string => {
    if (input.command) return String(input.command);
    if (input.file_path) return String(input.file_path);
    if (input.path) return String(input.path);
    return JSON.stringify(input, null, 2);
  };

  // Extract a human-readable summary of the running command
  const getRunningCommandSummary = (): string | undefined => {
    if (runningTools.length === 0) {
      // All tools completed but still streaming — AI is generating text
      if (toolUses.length > 0) return 'Generating response...';
      return undefined;
    }
    const tool = runningTools[runningTools.length - 1];
    const input = tool.input as Record<string, unknown>;
    if (tool.name === 'Bash' && input.command) {
      const cmd = String(input.command);
      return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
    }
    if (input.file_path) return `${tool.name}: ${String(input.file_path)}`;
    if (input.path) return `${tool.name}: ${String(input.path)}`;
    return `Running ${tool.name}...`;
  };

  return (
    <AIMessage from="assistant">
      <MessageContent>
        {/* Tool calls — compact collapsible group */}
        {toolUses.length > 0 && (
          <ToolActionsGroup
            tools={toolUses.map((tool) => {
              const result = toolResults.find((r) => r.tool_use_id === tool.id);
              return {
                id: tool.id,
                name: tool.name,
                input: tool.input,
                result: result?.content,
                isError: result?.is_error,
              };
            })}
            isStreaming={isStreaming}
            streamingToolOutput={streamingToolOutput}
          />
        )}

        {/* AskUserQuestion — interactive question card */}
        {(pendingPermission || permissionResolved) && pendingPermission?.toolName === 'AskUserQuestion' && (
          <AskUserQuestionCard
            toolInput={pendingPermission.toolInput}
            onAnswer={(answers) => {
              const updatedInput = { ...pendingPermission.toolInput, answers };
              onPermissionResponse?.('allow', updatedInput);
            }}
            onSkip={() => onPermissionResponse?.('deny')}
            resolved={permissionResolved ?? null}
          />
        )}

        {/* Permission approval confirmation (non-AskUserQuestion tools) */}
        {(pendingPermission || permissionResolved) && pendingPermission?.toolName !== 'AskUserQuestion' && (
          <Confirmation
            approval={getApproval()}
            state={getConfirmationState()}
          >
            <ConfirmationTitle>
              <span className="font-medium">{pendingPermission?.toolName}</span>
              {pendingPermission?.decisionReason && (
                <span className="text-muted-foreground ml-2">
                  — {pendingPermission.decisionReason}
                </span>
              )}
            </ConfirmationTitle>

            {pendingPermission && (
              <div className="mt-1 rounded bg-muted/50 px-3 py-2 font-mono text-xs">
                {formatToolInput(pendingPermission.toolInput)}
              </div>
            )}

            <ConfirmationRequest>
              <ConfirmationActions>
                <ConfirmationAction
                  variant="outline"
                  onClick={() => onPermissionResponse?.('deny')}
                >
                  Deny
                </ConfirmationAction>
                <ConfirmationAction
                  variant="outline"
                  onClick={() => onPermissionResponse?.('allow')}
                >
                  Allow Once
                </ConfirmationAction>
                {pendingPermission?.suggestions && pendingPermission.suggestions.length > 0 && (
                  <ConfirmationAction
                    variant="default"
                    onClick={() => onPermissionResponse?.('allow_session')}
                  >
                    Allow for Session
                  </ConfirmationAction>
                )}
              </ConfirmationActions>
            </ConfirmationRequest>

            <ConfirmationAccepted>
              <p className="text-xs text-green-600 dark:text-green-400">Allowed</p>
            </ConfirmationAccepted>

            <ConfirmationRejected>
              <p className="text-xs text-red-600 dark:text-red-400">Denied</p>
            </ConfirmationRejected>
          </Confirmation>
        )}

        {/* Streaming text content rendered via Streamdown */}
        {content && (
          <MessageResponse>{content}</MessageResponse>
        )}

        {/* Loading indicator when no content yet */}
        {isStreaming && !content && toolUses.length === 0 && !pendingPermission && (
          <div className="py-2">
            <Shimmer>Thinking...</Shimmer>
          </div>
        )}

        {/* Status bar during streaming */}
        {isStreaming && !pendingPermission && <StreamingStatusBar statusText={
          statusText || getRunningCommandSummary()
        } onForceStop={onForceStop} />}
      </MessageContent>
    </AIMessage>
  );
}
