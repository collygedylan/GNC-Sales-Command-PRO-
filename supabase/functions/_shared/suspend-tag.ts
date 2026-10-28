import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "./database.types.ts";
import { jsonValue } from "../../../services/database-contract-runtime.ts";

export const SUSPEND_TAG_EDITORS = new Set(['dylan_collyge', 'megan_kelly', 'jd_jones', 'dan_mccuistion']);
const SUSPEND_TAG_AUTHORIZED_ROLES = new Set(['ADMIN', 'ADMINISTRATOR', 'MANAGER', 'EVALUATOR', 'INVENTORY', 'INVENTORYMANAGER', 'SALESREP']);
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
  if (!['rows', 'save', 'complete', 'close', 'send', 'retry', 'approval', 'decide', 'add_candidates', 'inbox', 'dock_review'].includes(operation)) throw new Error('SUSPEND_TAG_OPERATION_INVALID');
  const role = String(actor.role || '').replace(/[^A-Z]/gi, '').toUpperCase();
  if (!['rows', 'inbox', 'dock_review'].includes(operation)
    && !SUSPEND_TAG_EDITORS.has(String(actor.username || '')) && !SUSPEND_TAG_AUTHORIZED_ROLES.has(role)) throw new Error('SUSPEND_TAG_FORBIDDEN');
  const input = payload.payload;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('SUSPEND_TAG_REQUEST_INVALID');
  const body = input as RecordValue;
  const allowed = new Set(['sourceUid', 'sourceIdentity', 'expectedLastUpdated', 'patch', 'approvalId', 'decision', 'decisionMessage', 'ids', 'inventoryIds', 'customRows', 'candidateUid']);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new Error('SUSPEND_TAG_FIELD_FORBIDDEN');
  if (operation === 'decide') {
    if (!['approve', 'deny'].includes(String(body.decision || ''))) throw new Error('SUSPEND_TAG_DECISION_INVALID');
    if (body.decisionMessage !== undefined && typeof body.decisionMessage !== 'string') throw new Error('SUSPEND_TAG_DECISION_MESSAGE_INVALID');
    if (String(body.decisionMessage || '').length > 1000) throw new Error('SUSPEND_TAG_DECISION_MESSAGE_INVALID');
  } else if (Object.prototype.hasOwnProperty.call(body, 'decisionMessage')) {
    throw new Error('SUSPEND_TAG_FIELD_FORBIDDEN');
  }
  if (operation === 'add_candidates') {
    const inventoryIds = Array.isArray(body.inventoryIds) ? body.inventoryIds : [];
    const customRows = Array.isArray(body.customRows) ? body.customRows : [];
    const invalidCustom = customRows.some((row) => !row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).some((key) => !['locationcode', 'lotcode'].includes(key))
      || typeof (row as RecordValue).locationcode !== 'string' || typeof (row as RecordValue).lotcode !== 'string'
      || !/^[A-Z0-9]+(?:\.[A-Z0-9]+){1,2}$/i.test(String((row as RecordValue).locationcode).trim())
      || /^0+\.0+\.111$/i.test(String((row as RecordValue).locationcode).trim())
      || !/^\d{2}\.(?:F1|S1|U1|U2|U3|X|Y|Z)$/i.test(String((row as RecordValue).lotcode).trim()));
    if (inventoryIds.length + customRows.length < 1 || inventoryIds.length + customRows.length > 30
      || inventoryIds.some(id => typeof id !== 'string' || !id.trim()) || invalidCustom) throw new Error('SUSPEND_TAG_CANDIDATES_INVALID');
  }
  if (body.candidateUid !== undefined && (operation !== 'decide' || typeof body.candidateUid !== 'string')) throw new Error('SUSPEND_TAG_FIELD_FORBIDDEN');
  if (body.sourceIdentity !== undefined) {
    const identity = body.sourceIdentity;
    const identityFields = new Set(['transactionnumber', 'tagcode', 'dock', 'stopnumber', 'itemcode', 'locationcode', 'lotcode', 'quantityshipped', 'customer', 'consignee', 'salesrep', 'spec', 'photo_url', 'loc_photo_match']);
    if (operation !== 'close' && operation !== 'add_candidates' || !identity || typeof identity !== 'object' || Array.isArray(identity)
      || Object.entries(identity as RecordValue).some(([key, value]) => !identityFields.has(key) || typeof value !== 'string')) {
      throw new Error('SUSPEND_TAG_FIELD_FORBIDDEN');
    }
  }
  if (operation === 'inbox' && Object.keys(body).length) throw new Error('SUSPEND_TAG_FIELD_FORBIDDEN');
  if (operation === 'rows' && (!Array.isArray(body.ids) || body.ids.length > 1000)) throw new Error('SUSPEND_TAG_REQUEST_INVALID');
  if (!['rows', 'approval', 'decide', 'inbox', 'close'].includes(operation) && (!Number.isSafeInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 0)) throw new Error('SUSPEND_TAG_VERSION_REQUIRED');
  const { data, error } = await client.rpc('suspend_tag_command_v1', {
    p_actor_id: String(actor.id), p_operation: operation, p_payload: jsonValue(body),
    ...(typeof payload.commandId === "string" ? { p_command_id: payload.commandId } : {}),
    ...(typeof payload.expectedVersion === "number" ? { p_expected_version: payload.expectedVersion } : {}),
    ...(typeof actor.nativeSessionId === "string" ? { p_session_id: actor.nativeSessionId } : {}),
  });
  if (error) {
    const rpcCode = String((error as { code?: string }).code || '').replace(/[^A-Z0-9_]/gi, '').toUpperCase();
    const message = String(error.message || '').trim();
    throw new Error((message.match(/SUSPEND_TAG_[A-Z0-9_]+/i)?.[0] || (rpcCode ? `SUSPEND_TAG_DATABASE_${rpcCode}` : 'SUSPEND_TAG_DATABASE_ERROR')).toUpperCase());
  }
  return data;
}

export function suspendTagError(error: unknown) {
  const raw = String(error instanceof Error ? error.message : error);
  const code = raw.match(/SUSPEND_TAG_[A-Z0-9_]+/)?.[0] || 'SUSPEND_TAG_REQUEST_FAILED';
  const status = /FORBIDDEN|SESSION_REQUIRED|SERVICE_REQUIRED|REVIEW_LOCKED/.test(code) ? 403
    : /CHANGED|CONFLICT|SUPERSEDED|AMBIGUOUS/.test(code) ? 409 : /MISSING|REQUIRED|INVALID/.test(code) ? 422 : 503;
  return { status, body: { ok: false, error: code, code } };
}
