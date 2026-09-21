/** Protected adapters; actorProfile and moduleAllowed come from the authenticated
 * API context, never from the request JSON. SQL repeats active-profile checks. */
type JsonRecord = Record<string, unknown>;
type RpcClient = { rpc: (name: string, params: JsonRecord) => PromiseLike<{ data: unknown; error: unknown }> };
export type WorkflowContext = { supabase: RpcClient; actorProfile: JsonRecord; moduleAllowed: boolean; payload: JsonRecord };

const TYPES = new Set(['propagation', 'planting']);
const IDENTITY_FIELDS = ['unique_id', 'itemcode', 'contsize', 'locationcode', 'lotcode'];
const text = (value: unknown) => String(value ?? '').trim();
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};

export function requireWorkflowActor(actor: JsonRecord, moduleAllowed: boolean) {
  const locked = Date.parse(text(actor.locked_until));
  if (!text(actor.id) || !text(actor.username) || actor.disabled_at || actor.must_change_password !== false
    || (actor.locked_until && (!Number.isFinite(locked) || locked > Date.now()))) throw new Error('WORKFLOW_PROFILE_INACTIVE');
  if (moduleAllowed !== true) throw new Error('PRODUCTION_FORBIDDEN');
}

export function normalizeProductionCommand(payload: JsonRecord) {
  const operation = text(payload.operation || 'list').toLowerCase();
  const row = record(payload.row);
  const kind = text(payload.workflow_type || row.workflow_type).toLowerCase();
  if (!TYPES.has(kind)) throw new Error('PRODUCTION_TYPE_INVALID');
  if (!['list', 'add', 'complete'].includes(operation)) throw new Error('PRODUCTION_OPERATION_INVALID');
  const input: JsonRecord = { workflow_type: kind };
  if (operation === 'list') {
    const status = text(payload.status || 'open');
    if (!['open', 'complete'].includes(status)) throw new Error('PRODUCTION_STATUS_INVALID');
    return { operation, input: { ...input, status } };
  }
  const command = text(payload.command_id);
  if (!/^[A-Za-z0-9:_.-]{12,180}$/.test(command)) throw new Error('WORKFLOW_COMMAND_ID_REQUIRED');
  const revision = payload.expected_revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new Error('WORKFLOW_REVISION_REQUIRED');
  input.command_id = command;
  input.expected_revision = revision;
  if (operation === 'complete') {
    input.unique_id = text(payload.unique_id);
    if (!input.unique_id || revision < 1) throw new Error('WORKFLOW_REVISION_REQUIRED');
    return { operation, input };
  }
  const quantity = row.quantity ?? payload.quantity;
  const amountText = text(quantity).replace(/,/g, '');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(amountText) || !Number.isFinite(Number(amountText)) || Number(amountText) <= 0) {
    throw new Error('PRODUCTION_QUANTITY_REQUIRED');
  }
  if (revision !== 0) throw new Error('WORKFLOW_REVISION_CONFLICT');
  const snapshot = record(payload.source_identity || row.snapshot);
  const sourceId = text(payload.source_unique_id || row.source_unique_id || snapshot.unique_id);
  if (!sourceId || sourceId.length > 1000) throw new Error('PRODUCTION_SOURCE_MISSING');
  // Preserve literal source values for a database comparison; display-normalized
  // values must never silently replace identity fields in an inventory snapshot.
  const identity: JsonRecord = {};
  for (const field of IDENTITY_FIELDS) {
    if (!(field in snapshot)) throw new Error('PRODUCTION_SOURCE_REFRESH_REQUIRED');
    identity[field] = snapshot[field];
  }
  if (text(identity.unique_id) !== sourceId) throw new Error('PRODUCTION_SOURCE_CHANGED');
  const bay = text(row.baynumber ?? payload.baynumber);
  const instructions = text(row.instructions ?? payload.instructions);
  if (bay.length > 150 || instructions.length > 12000) throw new Error('PRODUCTION_TEXT_TOO_LONG');
  return { operation, input: { ...input, source_unique_id: sourceId, source_identity: identity, quantity: amountText, baynumber: bay, instructions } };
}

export async function handleProductionWorkflow({ supabase, actorProfile, moduleAllowed, payload }: WorkflowContext) {
  requireWorkflowActor(actorProfile, moduleAllowed);
  const { operation, input } = normalizeProductionCommand(payload);
  const { data, error } = await supabase.rpc('production_workflow_command_v1', {
    p_actor_id: actorProfile.id, p_operation: operation, p_payload: input,
  });
  if (error) throw error;
  return data;
}

export function normalizeInventoryHistoryQuery(payload: JsonRecord) {
  const action = text(payload.filter_action || payload.history_action || 'all').toLowerCase();
  if (!['all', 'qty', 'transfer', 'reclass', 'priority_change'].includes(action)) throw new Error('INVENTORY_HISTORY_FILTER_INVALID');
  const limit = payload.limit === undefined ? 100 : Number(payload.limit);
  const offset = payload.offset === undefined ? 0 : Number(payload.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('INVENTORY_HISTORY_PAGE_INVALID');
  const input: JsonRecord = { action, limit, offset, search: text(payload.search).slice(0, 300) };
  for (const key of ['dateStart', 'dateEnd']) {
    let date = text(payload[key]);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) date += key === 'dateStart' ? 'T00:00:00.000Z' : 'T23:59:59.999Z';
    if (date && !Number.isFinite(Date.parse(date))) throw new Error('INVENTORY_HISTORY_DATE_INVALID');
    input[key] = date;
  }
  return input;
}

export async function handleInventoryTransactionHistory({ supabase, actorProfile, moduleAllowed, payload }: WorkflowContext) {
  requireWorkflowActor(actorProfile, moduleAllowed);
  const role = text(actorProfile.role).toUpperCase().replace(/[^A-Z]/g, '');
  if (!['dylan_collyge', 'jd_jones', 'megan_kelly'].includes(text(actorProfile.username)) && !['ADMIN', 'ADMINISTRATOR', 'MANAGER'].includes(role)) {
    throw new Error('INVENTORY_MANAGER_REQUIRED');
  }
  const { data, error } = await supabase.rpc('inventory_transaction_history_v1', {
    p_actor_id: actorProfile.id, p_payload: normalizeInventoryHistoryQuery(payload),
  });
  if (error) throw error;
  return data;
}

export function workflowError(error: unknown) {
  const source = record(error);
  const message = error instanceof Error ? error.message : text(source.message);
  const code = /^(?:WORKFLOW|PRODUCTION|INVENTORY)_[A-Z_]+$/.test(message) ? message : 'WORKFLOW_UNAVAILABLE';
  const forbidden = /FORBIDDEN|INACTIVE|MANAGER_REQUIRED/.test(code) || source.code === '42501';
  const conflict = /CONFLICT|CHANGED|ALREADY_OPEN|SOURCE_MISSING|REFRESH_REQUIRED/.test(code) || source.code === '40001';
  return { status: forbidden ? 403 : conflict ? 409 : code === 'WORKFLOW_UNAVAILABLE' ? 503 : 400,
    body: { ok: false, code, message: forbidden ? 'Your current account cannot use this action.' : conflict
      ? 'This row changed. Refresh and review it before trying again.' : code === 'WORKFLOW_UNAVAILABLE'
      ? 'The workflow could not be saved. Your entries are retained.' : 'Review the amount, source row, and required fields.' } };
}
