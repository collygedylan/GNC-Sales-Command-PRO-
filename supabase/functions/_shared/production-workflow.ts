import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "./database.types.ts";
import { jsonValue } from "../../../services/database-contract-runtime.ts";
import { normalizeReclassMoveCommand } from "../../../services/reclassMove.ts";

/** Protected adapters; actorProfile and moduleAllowed come from the authenticated
 * API context, never from the request JSON. SQL repeats active-profile checks. */
type JsonRecord = Record<string, unknown>;
type RpcClient = Pick<SupabaseClient<Database>, "rpc" | "from">;
export type WorkflowContext = { supabase: RpcClient; actorProfile: JsonRecord; moduleAllowed: boolean; payload: JsonRecord };

const TYPES = new Set(['propagation', 'planting']);
const IDENTITY_FIELDS = ['unique_id', 'itemcode', 'contsize', 'locationcode', 'lotcode'];
export const GLOBAL_INVENTORY_LIVE_CHANGE_USERS = new Set(['dylan_collyge', 'megan_kelly', 'jd_jones', 'mitch_kaiser']);
const text = (value: unknown) => String(value ?? '').trim();
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};

export type InventoryLiveChangeIdentity = {
  uniqueId?: string;
  itemcode?: string;
  locationcode?: string;
  lotcode?: string;
};

export function normalizeInventoryLiveChangeUsername(value: unknown) {
  const key = text(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return ['jorge', 'jorge_colunga', 'colunga_jorge'].includes(key) ? 'jorge_colunga' : key;
}

export async function assertInventoryLiveChangeActorRows(
  supabase: RpcClient,
  actorProfile: JsonRecord,
  identities: InventoryLiveChangeIdentity[],
) {
  const actor = normalizeInventoryLiveChangeUsername(actorProfile.username);
  const role = text(actorProfile.role).toUpperCase().replace(/[^A-Z]/g, '');
  if (GLOBAL_INVENTORY_LIVE_CHANGE_USERS.has(actor) || ['ADMIN', 'ADMINISTRATOR'].includes(role)) return true;
  if (actor !== 'jorge_colunga') return true;
  const requested = identities.map((identity) => ({
    uniqueId: text(identity.uniqueId),
    itemcode: text(identity.itemcode).toUpperCase(),
    locationcode: text(identity.locationcode).toUpperCase(),
    lotcode: text(identity.lotcode).toUpperCase(),
  })).filter((identity) => identity.uniqueId || identity.itemcode);
  if (!actor || !requested.length) throw new Error(actor === 'jorge_colunga'
    ? 'INVENTORY_LIVE_CHANGE_JORGE_ROW_NOT_ASSIGNED' : 'INVENTORY_LIVE_CHANGE_ROW_NOT_ASSIGNED');
  const uniqueIds = [...new Set(requested.map((identity) => identity.uniqueId).filter(Boolean))];
  const requestedItemcodes = [...new Set(requested.map((identity) => identity.itemcode).filter(Boolean))];
  let sourceRows: Array<Record<string, unknown>> = [];
  if (uniqueIds.length) {
    const result = await supabase.from('ph_master_inventory')
      .select('unique_id,itemcode,locationcode,lotcode').in('unique_id', uniqueIds);
    if (result.error) throw result.error;
    sourceRows = (result.data || []) as Array<Record<string, unknown>>;
  }
  const resolved = requested.map((identity) => {
    const row = sourceRows.find((candidate) => text(candidate.unique_id) === identity.uniqueId);
    return row ? {
      uniqueId: text(row.unique_id), itemcode: text(row.itemcode).toUpperCase(),
      locationcode: text(row.locationcode).toUpperCase(), lotcode: text(row.lotcode).toUpperCase(),
    } : identity;
  });
  const itemcodes = [...new Set([...requestedItemcodes, ...resolved.map((identity) => identity.itemcode).filter(Boolean)])];
  const rowAssignments = uniqueIds.length ? await supabase.from('ph_inventory_row_assignments')
    .select('master_unique_id,itemcode,locationcode,lotcode,assignedto,present_in_drive')
    .in('master_unique_id', uniqueIds).eq('present_in_drive', true) : { data: [], error: null };
  if (rowAssignments.error) throw rowAssignments.error;
  const itemAssignments = itemcodes.length ? await supabase.from('ph_warehouse_assigned_items')
    .select('itemcode,itemcode_normalized,assignedto,present_in_drive')
    .in('itemcode', itemcodes).eq('present_in_drive', true) : { data: [], error: null };
  if (itemAssignments.error) throw itemAssignments.error;
  const exact = (rowAssignments.data || []) as Array<Record<string, unknown>>;
  const legacy = (itemAssignments.data || []) as Array<Record<string, unknown>>;
  const allowed = resolved.every((identity) => exact.some((assignment) =>
    normalizeInventoryLiveChangeUsername(assignment.assignedto) === actor
      && text(assignment.master_unique_id) === identity.uniqueId)
    || legacy.some((assignment) => normalizeInventoryLiveChangeUsername(assignment.assignedto) === actor
      && text(assignment.itemcode_normalized || assignment.itemcode).toUpperCase() === identity.itemcode));
  if (!allowed) throw new Error(actor === 'jorge_colunga'
    ? 'INVENTORY_LIVE_CHANGE_JORGE_ROW_NOT_ASSIGNED' : 'INVENTORY_LIVE_CHANGE_ROW_NOT_ASSIGNED');
  return true;
}

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
    p_actor_id: String(actorProfile.id), p_operation: operation, p_payload: jsonValue(input),
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
    p_actor_id: String(actorProfile.id), p_payload: jsonValue(normalizeInventoryHistoryQuery(payload)),
  });
  if (error) throw error;
  return data;
}

type ReclassMoveContext = Pick<WorkflowContext, 'supabase' | 'actorProfile' | 'payload'>;

function requireReclassMoveActor(actor: JsonRecord) {
  const locked = Date.parse(text(actor.locked_until));
  if (!text(actor.id) || !text(actor.username) || actor.disabled_at || actor.must_change_password !== false
    || (actor.locked_until && (!Number.isFinite(locked) || locked > Date.now()))) {
    throw new Error('INVENTORY_RECLASS_PROFILE_INACTIVE');
  }
}

async function resolveCurrentReclassSourceIds(supabase: RpcClient, command: ReturnType<typeof normalizeReclassMoveCommand>) {
  const requested = command.moves.map((move) => move.source.uniqueId);
  const { data: currentRows, error: currentError } = await supabase.from('ph_master_inventory')
    .select('unique_id').in('unique_id', requested);
  if (currentError) throw currentError;
  const currentIds = new Set((currentRows || []).map((row) => text(row.unique_id)));
  for (const move of command.moves) {
    if (currentIds.has(move.source.uniqueId)) continue;
    const identity = move.source.identity;
    const itemcode = text(identity.itemcode), locationcode = text(identity.locationcode);
    if (!itemcode || !locationcode) continue;
    const { data: candidates, error } = await supabase.from('ph_master_inventory')
      .select('unique_id,itemcode,contsize,locationcode,lotcode,season')
      .eq('itemcode', itemcode).eq('locationcode', locationcode)
      .order('unique_id', { ascending: true }).limit(200);
    if (error) throw error;
    const ranked = [...(candidates || [])].sort((left, right) => {
      const score = (row: typeof left) =>
        (text(row.lotcode) === text(identity.lotcode) ? 4 : 0)
        + (text(row.season) === text(identity.season) ? 2 : 0)
        + (text(row.contsize) === text(identity.contsize) ? 1 : 0);
      return score(right) - score(left) || text(left.unique_id).localeCompare(text(right.unique_id));
    });
    const replacement = text(ranked[0]?.unique_id);
    if (!replacement) continue;
    move.source.uniqueId = replacement;
    move.source.identity.unique_id = replacement;
  }
  return command;
}

async function enforceReclassMoveUpOpenStock(supabase: RpcClient, command: ReturnType<typeof normalizeReclassMoveCommand>) {
  const ids = command.moves.map((move) => move.source.uniqueId);
  const { data, error } = await supabase.from('ph_master_inventory')
    .select('unique_id,itemcode,lotcode,ptronhand,s_lts').in('unique_id', ids);
  if (error) throw error;
  const rows = new Map((data || []).map((row) => [text(row.unique_id), row]));
  const lots = new Map<string, { quantity: number; openStock: number; lotcode: string }>();
  for (const move of command.moves) {
    const row = rows.get(move.source.uniqueId);
    if (!row) throw new Error('INVENTORY_RECLASS_SOURCE_MISSING');
    const quantity = move.lines.filter((line) => line.direction === 'move_up').reduce((sum, line) => sum + line.quantity, 0);
    if (!quantity) continue;
    const onHand = Number(text(row.ptronhand).replace(/,/g, ''));
    const parsedOpenStock = Number(text(row.s_lts).replace(/,/g, ''));
    const openStock = Number.isFinite(parsedOpenStock) ? Math.max(0, parsedOpenStock) : 0;
    if (!Number.isFinite(onHand) || quantity > onHand) throw new Error('INVENTORY_RECLASS_QUANTITY_UNDERFLOW');
    const key = `${text(row.itemcode).toUpperCase()}|${text(row.lotcode).toUpperCase()}`;
    const current = lots.get(key) || { quantity: 0, openStock, lotcode: text(row.lotcode).toUpperCase() };
    current.quantity += quantity;
    current.openStock = Math.min(current.openStock, openStock);
    lots.set(key, current);
  }
  for (const lot of lots.values()) {
    if (lot.quantity > lot.openStock) throw new Error('INVENTORY_RECLASS_MOVE_UP_OPEN_STOCK_EXCEEDED');
  }
}

export async function handleInventoryReclassMove({ supabase, actorProfile, payload }: ReclassMoveContext) {
  requireReclassMoveActor(actorProfile);
  const receiptEncoding = payload.receiptEncoding;
  if (receiptEncoding !== undefined && receiptEncoding !== 'master-null-elision-v1') {
    throw new Error('INVENTORY_RECLASS_RECEIPT_ENCODING_UNSUPPORTED');
  }
  const compactReceipt = receiptEncoding === 'master-null-elision-v1';
  if (payload.operation === 'status') {
    const allowed = new Set(['action', 'operation', 'commandId', 'receiptEncoding']);
    if (Object.keys(payload).some((key) => !allowed.has(key)) || payload.action !== 'inventory_reclass_move') {
      throw new Error('INVENTORY_RECLASS_STATUS_INVALID');
    }
    const commandId = text(payload.commandId);
    if (!/^[A-Za-z0-9:_.-]{12,180}$/.test(commandId)) throw new Error('INVENTORY_RECLASS_COMMAND_INVALID');
    const { data, error } = await supabase.rpc(compactReceipt
      ? 'get_inventory_reclass_move_status_compact_v1' : 'get_inventory_reclass_move_status_v1', {
      p_actor_id: String(actorProfile.id), p_command_id: commandId,
    });
    if (error) throw error;
    return data;
  }
  const commandPayload = { ...payload };
  delete commandPayload.receiptEncoding;
  const command = await resolveCurrentReclassSourceIds(supabase, normalizeReclassMoveCommand(commandPayload));
  await assertInventoryLiveChangeActorRows(supabase, actorProfile, command.moves.map((move) => ({
    uniqueId: move.source.uniqueId,
    itemcode: move.source.identity.itemcode || '',
    locationcode: move.source.identity.locationcode || '',
    lotcode: move.source.identity.lotcode || '',
  })));
  await enforceReclassMoveUpOpenStock(supabase, command);
  const { data, error } = await supabase.rpc('apply_inventory_reclass_moves_with_delivery_v1', {
    p_actor_id: String(actorProfile.id), p_command_id: command.commandId,
    p_expected_revision: command.expectedRevision ?? 0,
    p_moves: jsonValue(command.moves),
    ...(compactReceipt ? { p_receipt_encoding: 'master-null-elision-v1' } : {}),
  });
  if (error) throw error;
  const receipt = record(data);
  if (receipt.ok !== true || text(receipt.status) !== 'applied' || !Array.isArray(receipt.rows)) {
    throw new Error('INVENTORY_RECLASS_COMMIT_UNCONFIRMED');
  }
  return data;
}

export function inventoryReclassMoveError(error: unknown) {
  const source = record(error);
  const message = error instanceof Error ? error.message : text(source.message);
  const code = /^(?:INVENTORY_RECLASS|INVENTORY_LIVE_CHANGE|DRIVE_RECLASS)_[A-Z0-9_]+$/.test(message) ? message : 'INVENTORY_RECLASS_UNAVAILABLE';
  const forbidden = /FORBIDDEN|PERMISSION_REQUIRED|PROFILE_INACTIVE|ACTOR_REQUIRED|ROW_NOT_ASSIGNED/.test(code) || source.code === '42501';
  const conflict = /CONFLICT|CHANGED|MISSING|AMBIGUOUS|MISMATCH|REFRESH_REQUIRED/.test(code) || (source.code === "40001" || source.code === "PT409");
  const status = forbidden ? 403 : conflict ? 409 : code === 'INVENTORY_RECLASS_UNAVAILABLE' ? 503 : 400;
  const jorgeAssignedOnly = code === 'INVENTORY_LIVE_CHANGE_JORGE_ROW_NOT_ASSIGNED';
  return { status: jorgeAssignedOnly ? 403 : status, body: { ok: false, code, message: jorgeAssignedOnly
    ? 'Live changes for jorge_colunga are only permitted on rows assigned to jorge_colunga in Assigned Items.'
    : forbidden ? 'You do not have access to Reclass this inventory.'
    : conflict ? 'The physical inventory row could not be confirmed. Your draft is retained for retry.'
      : code === 'INVENTORY_RECLASS_MOVE_UP_OPEN_STOCK_EXCEEDED' ? 'Cannot Move Up more than the source lot Open Stock.'
      : code === 'INVENTORY_RECLASS_UNAVAILABLE' ? 'The inventory movement could not be saved. Retry with the same command.'
        : 'Review the movement details and try again.' } };
}

export function workflowError(error: unknown) {
  const source = record(error);
  const message = error instanceof Error ? error.message : text(source.message);
  const code = /^(?:WORKFLOW|PRODUCTION|INVENTORY)_[A-Z_]+$/.test(message) ? message : 'WORKFLOW_UNAVAILABLE';
  const forbidden = /FORBIDDEN|INACTIVE|MANAGER_REQUIRED/.test(code) || source.code === '42501';
  const conflict = /CONFLICT|CHANGED|ALREADY_OPEN|SOURCE_MISSING|REFRESH_REQUIRED/.test(code) || (source.code === "40001" || source.code === "PT409");
  return { status: forbidden ? 403 : conflict ? 409 : code === 'WORKFLOW_UNAVAILABLE' ? 503 : 400,
    body: { ok: false, code, message: forbidden ? 'Your current account cannot use this action.' : conflict
      ? 'This row changed. Refresh and review it before trying again.' : code === 'WORKFLOW_UNAVAILABLE'
      ? 'The workflow could not be saved. Your entries are retained.' : 'Review the amount, source row, and required fields.' } };
}
