import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "./database.types.ts";
import { jsonValue } from "../../../services/database-contract-runtime.ts";

export const SUSPEND_TAG_EDITORS = new Set(['dylan_collyge', 'megan_kelly', 'dan_mccuistion']);
type RecordValue = Record<string, unknown>;
type RpcClient = Pick<SupabaseClient<Database>, "rpc">;

export async function verifySuspendTagSession(client: { auth: { getUser: (token: string) => PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> } }, actor: RecordValue, request?: Request) {
  const token = String(request?.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const verified = await client.auth.getUser(token);
  if (verified.error || verified.data.user?.id !== actor.id) throw new Error('SUSPEND_TAG_SESSION_REQUIRED');
  const encoded = token.split('.')[1] || '';
  const claims = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
  if (claims.sub !== actor.id || claims.role !== 'authenticated' || !/^[0-9a-f-]{36}$/i.test(claims.session_id || '')) throw new Error('SUSPEND_TAG_SESSION_REQUIRED');
  return claims.session_id as string;
}

export async function handleSuspendTag(client: RpcClient, actor: RecordValue, payload: RecordValue) {
  const operation = String(payload.operation || '');
  if (!['rows', 'save', 'complete', 'send', 'retry', 'approval', 'decide'].includes(operation)) throw new Error('SUSPEND_TAG_OPERATION_INVALID');
  if (!['approval', 'decide'].includes(operation) && !SUSPEND_TAG_EDITORS.has(String(actor.username || ''))) throw new Error('SUSPEND_TAG_FORBIDDEN');
  const input = payload.payload;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('SUSPEND_TAG_REQUEST_INVALID');
  const body = input as RecordValue;
  const allowed = new Set(['sourceUid', 'expectedLastUpdated', 'patch', 'approvalId', 'decision', 'ids']);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new Error('SUSPEND_TAG_FIELD_FORBIDDEN');
  if (operation === 'rows' && (!Array.isArray(body.ids) || body.ids.length > 1000)) throw new Error('SUSPEND_TAG_REQUEST_INVALID');
  if (!['rows', 'approval', 'decide'].includes(operation) && (!Number.isSafeInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 0)) throw new Error('SUSPEND_TAG_VERSION_REQUIRED');
  const { data, error } = await client.rpc('suspend_tag_command_v1', {
    p_actor_id: String(actor.id), p_operation: operation, p_payload: jsonValue(body),
    ...(typeof payload.commandId === "string" ? { p_command_id: payload.commandId } : {}),
    ...(typeof payload.expectedVersion === "number" ? { p_expected_version: payload.expectedVersion } : {}),
    ...(typeof actor.nativeSessionId === "string" ? { p_session_id: actor.nativeSessionId } : {}),
  });
  if (error) throw new Error(error.message || 'SUSPEND_TAG_REQUEST_FAILED');
  return data;
}

export function suspendTagError(error: unknown) {
  const raw = String(error instanceof Error ? error.message : error);
  const code = raw.match(/SUSPEND_TAG_[A-Z_]+/)?.[0] || 'SUSPEND_TAG_REQUEST_FAILED';
  const status = /FORBIDDEN|SESSION_REQUIRED|SERVICE_REQUIRED|REVIEW_LOCKED/.test(code) ? 403
    : /CHANGED|CONFLICT|SUPERSEDED/.test(code) ? 409 : /MISSING|REQUIRED|INVALID/.test(code) ? 422 : 503;
  return { status, body: { ok: false, error: code, code } };
}
