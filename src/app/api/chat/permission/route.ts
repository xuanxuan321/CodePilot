import { NextRequest } from 'next/server';
import { resolvePendingPermission } from '@/lib/permission-registry';
import type { PermissionResponseRequest } from '@/types';
import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body: PermissionResponseRequest = await request.json();
    const { permissionRequestId, decision } = body;

    if (!permissionRequestId || !decision) {
      return new Response(
        JSON.stringify({ error: 'permissionRequestId and decision are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let result: PermissionResult;
    if (decision.behavior === 'allow') {
      result = {
        behavior: 'allow',
        updatedPermissions: decision.updatedPermissions as unknown as PermissionUpdate[],
        updatedInput: decision.updatedInput,
      };
    } else {
      result = {
        behavior: 'deny',
        message: decision.message || 'User denied permission',
      };
    }

    const found = resolvePendingPermission(permissionRequestId, result);

    if (!found) {
      return new Response(
        JSON.stringify({ error: 'Permission request not found or already resolved' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
