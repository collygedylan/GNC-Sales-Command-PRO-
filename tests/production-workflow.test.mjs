import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import {
  normalizeProductionCommand, handleProductionWorkflow, handleInventoryTransactionHistory,
  normalizeInventoryHistoryQuery, workflowError,
} from '../supabase/functions/_shared/production-workflow.ts';

const actor = { id: 'ec34e498-ed81-4b30-8236-5751af4e68cb', username: 'dylan_collyge', role: 'Admin', must_change_password: false };
const source = { unique_id: 'row-1', itemcode: '006138.051.1', contsize: '5DP', locationcode: 'D.08.001', lotcode: null };
const add = () => ({ operation: 'add', workflow_type: 'planting', command_id: 'test-command-0001', expected_revision: 0,
  row: { source_unique_id: 'row-1', quantity: '12.5', baynumber: '001', instructions: 'Use marked rows', snapshot: source,
    created_by_username: 'attacker', unique_id: 'client-chosen-id' } });

test('production uses exact source identity, nullable lot values, and separates optional bay instructions', () => {
  const command = normalizeProductionCommand(add());
  assert.equal(command.input.quantity, '12.5');
  assert.deepEqual(command.input.source_identity, source);
  assert.equal(command.input.baynumber, '001');
  assert.equal(command.input.created_by_username, undefined);
  assert.equal(command.input.unique_id, undefined);
});

test('deferred types, invalid quantities, missing snapshots, and stale creation revisions are rejected', () => {
  for (const workflow_type of ['can-filling', 'order-pulling', 'unknown']) {
    assert.throws(() => normalizeProductionCommand({ ...add(), workflow_type }), /PRODUCTION_TYPE_INVALID/);
  }
  for (const quantity of ['', null, 0, -1, 'NaN', 'Infinity', '5 percent']) {
    const payload = add(); payload.row.quantity = quantity;
    assert.throws(() => normalizeProductionCommand(payload), /PRODUCTION_QUANTITY_REQUIRED/);
  }
  const payload = add(); delete payload.row.snapshot.lotcode;
  assert.throws(() => normalizeProductionCommand(payload), /PRODUCTION_SOURCE_REFRESH_REQUIRED/);
  // Avoid mutating the shared source fixture for subsequent cases.
  source.lotcode = null;
  assert.throws(() => normalizeProductionCommand({ ...add(), expected_revision: 1 }), /WORKFLOW_REVISION_CONFLICT/);
});

test('production commands bind trusted actor and stable command IDs and return server-assigned rows', async () => {
  const calls = [];
  const supabase = { rpc: async (name, params) => { calls.push({ name, params }); return { data: { ok: true, row: { unique_id: 'server-id', revision: 1 } }, error: null }; } };
  const payload = { ...add(), actor_id: 'attacker', moduleAllowed: true };
  const result = await handleProductionWorkflow({ supabase, actorProfile: actor, moduleAllowed: true, payload });
  assert.equal(result.row.unique_id, 'server-id');
  assert.equal(calls[0].params.p_actor_id, actor.id);
  assert.equal(calls[0].params.p_payload.command_id, 'test-command-0001');
  await assert.rejects(handleProductionWorkflow({ supabase, actorProfile: actor, moduleAllowed: false, payload }), /PRODUCTION_FORBIDDEN/);
  await assert.rejects(handleProductionWorkflow({ supabase, actorProfile: { ...actor, disabled_at: '2026-09-20' }, moduleAllowed: true, payload }), /WORKFLOW_PROFILE_INACTIVE/);
  assert.equal(calls.length, 1);
});

test('completion requires the current row revision and never submits client completion identity', () => {
  const command = normalizeProductionCommand({ operation: 'complete', workflow_type: 'propagation', unique_id: 'saved-id', command_id: 'complete-command-1', expected_revision: 3, completed_by_username: 'attacker' });
  assert.equal(command.input.expected_revision, 3);
  assert.equal(command.input.completed_by_username, undefined);
  assert.throws(() => normalizeProductionCommand({ ...command.input, operation: 'complete', expected_revision: 0 }), /WORKFLOW_REVISION_REQUIRED/);
});

test('history search and pagination are forwarded together instead of filtering only a downloaded page', async () => {
  const calls = [];
  const supabase = { rpc: async (name, params) => { calls.push({ name, params }); return { data: { ok: true, rows: [], count: 503, hasMore: false }, error: null }; } };
  const result = await handleInventoryTransactionHistory({ supabase, actorProfile: actor, moduleAllowed: true,
    payload: { filter_action: 'priority_change', search: ' Hydrangea ', offset: 500, limit: 100, dateEnd: '2026-09-20' } });
  assert.equal(result.count, 503);
  assert.equal(calls[0].name, 'inventory_transaction_history_v1');
  assert.equal(calls[0].params.p_payload.offset, 500);
  assert.equal(calls[0].params.p_payload.search, 'Hydrangea');
  assert.equal(calls[0].params.p_payload.dateEnd, '2026-09-20T23:59:59.999Z');
});

test('module grants do not grant protected history authority; untrusted role and actor input is ignored', async () => {
  let calls = 0;
  const supabase = { rpc: async () => { calls++; return { data: {}, error: null }; } };
  await assert.rejects(handleInventoryTransactionHistory({ supabase, actorProfile: { ...actor, username: 'rep', role: 'Sales Rep' }, moduleAllowed: true,
    payload: { role: 'Admin', actor: { username: 'dylan_collyge' } } }), /INVENTORY_MANAGER_REQUIRED/);
  assert.equal(calls, 0);
  assert.throws(() => normalizeInventoryHistoryQuery({ offset: -1 }), /INVENTORY_HISTORY_PAGE_INVALID/);
  assert.throws(() => normalizeInventoryHistoryQuery({ dateStart: 'not a date' }), /INVENTORY_HISTORY_DATE_INVALID/);
});

test('stale revisions return a conflict and infrastructure errors cannot leak database details', () => {
  assert.equal(workflowError({ code: '40001', message: 'WORKFLOW_REVISION_CONFLICT' }).status, 409);
  assert.equal(workflowError({ code: '42501', message: 'INVENTORY_MANAGER_REQUIRED' }).status, 403);
  const failure = workflowError(new Error('secret SQL body and token'));
  assert.equal(failure.status, 503);
  assert.doesNotMatch(JSON.stringify(failure), /secret|token|SQL/);
});

const backend = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const extract = (name) => {
  const start = backend.indexOf(`function ${name}(`);
  const end = backend.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start, `${name} is present`);
  return backend.slice(start, end);
};

function mutationContext(extra = {}) {
  const calls = { patch: 0, emails: 0, rpc: 0 };
  const context = {
    Object, String, Number, Array, isFinite, Date, JSON, Error,
    normalizeInventoryTransactionAction_: (value) => value,
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    verifyInventoryWorkflowActor_: () => actor,
    firstNonEmptyRequestValue_: (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim() !== ''),
    fetchEmailApprovalMasterRow_: () => ({ ...source, ptronhand: 20, ptravailable: 15, ptrreviewed: 20 }),
    validateInventoryTransactionSourceIdentity_: () => {}, validateInventoryTransactionHoldScopeRequest_: () => {},
    getInventoryTransactionRowTable_: () => 'ph_master_inventory',
    getInventoryTransactionRowUid_: (row) => row.unique_id,
    cloneInventoryTransactionRowForAudit_: (row) => ({ ...row }),
    prepareInventoryTransactionOperations_: () => ({ operations: [{ table: 'ph_master_inventory', unique_id: 'row-1', kind: 'update', expected: source, patch: { ptronhand: 9 } }], quantity: 9, destination: null, holdScope: { rows: [], action: 'none' } }),
    patchEmailApprovalMasterRow_: () => { calls.patch++; throw new Error('Legacy non-atomic path used'); },
    inventoryWorkflowRpc_: () => { calls.rpc++; throw new Error('Audit insert failed; transaction rolled back'); },
    sendInventoryTransactionEmail_: () => { calls.emails++; return { ok: true }; },
    emitAppLiveEvent_: () => { throw new Error('Must not emit before commit'); },
    ...extra,
  };
  vm.createContext(context);
  vm.runInContext(extract('handleInventoryTransaction_'), context);
  return { context, calls };
}

test('inventory audit failure cannot run legacy patches, notify success, or send email', () => {
  const { context, calls } = mutationContext();
  const result = context.handleInventoryTransaction_({ action: 'qty', command_id: 'inventory-command-1', source, transaction: { newQuantity: 9 } });
  assert.equal(result.ok, false);
  assert.equal(calls.rpc, 1);
  assert.equal(calls.patch, 0);
  assert.equal(calls.emails, 0);
});

test('acknowledgement-loss replay returns the saved result without a second notification', () => {
  const audit = { source_after: source, destination_after: null, source_table: 'ph_master_inventory' };
  const { context, calls } = mutationContext({ inventoryWorkflowRpc_: () => ({ duplicate: true, transactionId: 'saved-transaction', rows: [], audit }) });
  const result = context.handleInventoryTransaction_({ action: 'qty', command_id: 'inventory-command-1', source, transaction: { newQuantity: 9 } });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.transactionId, 'saved-transaction');
  assert.equal(calls.emails, 0);
  assert.equal(calls.patch, 0);
});

test('cached Reclass requests remain reports and never enter the mutation bridge', () => {
  const { context, calls } = mutationContext({ handleReclassInquiryEmail_: () => ({ ok: true, status: 'pending', reportOnly: true }) });
  const result = context.handleInventoryTransaction_({ action: 'reclass', clientTransactionId: 'inquiry-command-1' });
  assert.equal(result.reportOnly, true);
  assert.equal(calls.rpc, 0);
  assert.equal(calls.patch, 0);
});
