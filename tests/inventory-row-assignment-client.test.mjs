import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const names = ['firstNonEmptyValue', 'normalizeWarehouseAssignedMatchPart', 'normalizeWarehouseAssignedCompactPart',
  'getWarehouseAssignedIdentityParts', 'buildWarehouseAssignedLookupKeys', 'clearWarehouseAssignedItemCaches',
  'normalizeWarehouseAssignedItemRow', 'rebuildWarehouseAssignedItemIndexes', 'getWarehouseAssignedRowsForItem',
  'getWarehouseAssignedRowForItem', 'getWarehouseAssignedUserForItem', 'getMasterAssignedToValue',
  'getManagerAssignedColumnState', 'buildManagerEvalAssignmentKey', 'parseManagerEvalAssignmentKey',
  'unwrapEvalAssignmentRpcRow', 'applyAcknowledgedEvalAssignmentResults', 'assignEvalItemcodes'];
function extract(name) {
  const start = html.search(new RegExp(`        (?:async )?function ${name}\\(`));
  assert.ok(start > 0, name);
  const next = html.slice(start + 1).search(/\r?\n        (?:async )?function \w+\(/);
  return html.slice(start, start + 1 + next);
}
function harness() {
  const rows = [
    { master_unique_id: 'inside', itemcode: 'SAME', assignedto: 'zoe_green', default_assignedto: 'dylan_collyge', default_revision: 3, locationcode: 'D.10.021' },
    { master_unique_id: 'rose', itemcode: 'SAME', assignedto: 'mitch_kaiser', default_assignedto: 'dylan_collyge', default_revision: 3, locationcode: 'C.06.001' },
    { master_unique_id: 'outside', itemcode: 'SAME', assignedto: 'dylan_collyge', default_assignedto: 'dylan_collyge', default_revision: 3, locationcode: 'D.10.022' },
    { master_unique_id: 'none', itemcode: 'NONE', assignedto: null, ASSIGNEDTO: 'stale_owner', default_revision: 0 },
  ];
  const ctx = vm.createContext({ WAREHOUSE_ASSIGNED_ITEMS_TABLE: 'ph_inventory_row_assignments',
    currentUser: 'dylan_collyge', managersSearchTerm: '', managerAssignedItemsAssignedToFilter: 'all',
    warehouseAssignedItemsInventory: rows, warehouseAssignedItemIndexCacheKey: '',
    warehouseAssignedItemsByLookupKey: new Map(), warehouseAssignedItemMatchCache: new WeakMap(),
    managerAssignedColumnState: { owner: 'dylan_collyge' }, managerEvalAssignmentSelection: new Set(),
    normalizeEvalAssignableUser: v => String(v || '').trim().toLowerCase(), getDatasetLoadSignature: () => '1',
    disposeManagerAssignedColumnEditor() {}, invalidateManagerEvalReport2Cache() {}, scheduleManagersRender() {},
    canManageEvalItemcodeAssignments: () => true, isManagerAssignedSnapshotCurrent: () => true,
    reloadWarehouseAssignmentsAfterMutation: async () => {}, reportSemanticHealthEvent() {}, showToast() {},
    crypto: { randomUUID: () => '10000000-0000-4000-8000-000000000001' }, console,
  });
  vm.runInContext(names.map(extract).join('\n'), ctx);
  ctx.warehouseAssignedItemsInventory = rows.map(ctx.normalizeWarehouseAssignedItemRow);
  return ctx;
}

test('exact inventory identity separates siblings and null never falls back to source or grouped owners', () => {
  const ctx = harness();
  for (const [id, owner] of [['inside', 'zoe_green'], ['rose', 'mitch_kaiser'], ['outside', 'dylan_collyge'], ['none', ''], ['missing', '']]) {
    assert.equal(ctx.getMasterAssignedToValue({ UNIQUE_ID: id, ITEMCODE: 'SAME', ASSIGNEDTO: 'stale_owner' }), owner);
  }
  assert.equal(ctx.getWarehouseAssignedRowsForItem({ ITEMCODE: 'SAME' }).length, 0);
  ctx.warehouseAssignedItemsInventory = [{ itemcode: 'SAME', assignedto: 'legacy_owner' }];
  ctx.clearWarehouseAssignedItemCaches();
  assert.equal(ctx.getMasterAssignedToValue({ UNIQUE_ID: 'outside', ITEMCODE: 'SAME', ASSIGNEDTO: 'legacy_owner' }), '');
});

test('default command deduplicates itemcodes, sends revisions, and applies only canonical row results', async () => {
  const ctx = harness();
  let sent;
  ctx.supabaseRpc = async (name, args) => {
    sent = JSON.parse(JSON.stringify({ name, args }));
    return { contractVersion: 'inventory-row-assignments-v1', defaults: [{ itemcode: 'SAME', assignedto: 'megan_kelly', revision: 4 }],
      assignments: ctx.warehouseAssignedItemsInventory.filter(row => row.ITEMCODE === 'SAME').map(row => ({ ...row,
        assignedto: row.master_unique_id === 'outside' ? 'megan_kelly' : row.assignedto,
        default_assignedto: 'megan_kelly', default_revision: 4 })) };
  };
  await ctx.assignEvalItemcodes([{ itemcode: 'same', genusname: 'Acer' }, { itemcode: 'SAME', genusname: 'Rosa' }], 'megan_kelly');
  assert.equal(sent.name, 'set_itemcode_default_owners_v1');
  assert.deepEqual(sent.args.p_changes, [{ itemcode: 'SAME', assignedto: 'megan_kelly', expectedRevision: 3 }]);
  assert.equal(ctx.getMasterAssignedToValue({ UNIQUE_ID: 'inside' }), 'zoe_green');
  assert.equal(ctx.getMasterAssignedToValue({ UNIQUE_ID: 'rose' }), 'mitch_kaiser');
  assert.equal(ctx.getMasterAssignedToValue({ UNIQUE_ID: 'outside' }), 'megan_kelly');
  assert.equal(ctx.managerAssignedColumnState.defaultDrafts.SAME, undefined);
});

test('failed saves retain the entered default and retry the same request; conflicts do not mutate effective owners', async () => {
  const ctx = harness();
  const ids = [];
  ctx.supabaseRpc = async (name, args) => { ids.push(args.p_request_id); throw new Error('Revision conflict'); };
  await ctx.assignEvalItemcodes(['SAME'], 'megan_kelly');
  assert.equal(ctx.managerAssignedColumnState.defaultDrafts.SAME.assignedto, 'megan_kelly');
  assert.equal(ctx.managerAssignedColumnState.defaultDrafts.SAME.expectedRevision, 3);
  assert.equal(ctx.managerAssignedColumnState.defaultDrafts.SAME.error, 'Revision conflict');
  await ctx.assignEvalItemcodes(['SAME'], 'megan_kelly');
  assert.equal(ids[0], ids[1]);
  assert.equal(ctx.getMasterAssignedToValue({ UNIQUE_ID: 'outside' }), 'dylan_collyge');
  ctx.currentUser = 'megan_kelly';
  assert.equal(ctx.getManagerAssignedColumnState().defaultDrafts, undefined, 'drafts do not leak across sessions');
});

test('malformed acknowledgments cannot simulate a saved default or mutate effective rows', () => {
  const ctx = harness();
  assert.throws(() => ctx.applyAcknowledgedEvalAssignmentResults([], [{ assignedto: 'megan_kelly' }]), /did not confirm/);
  assert.equal(ctx.getMasterAssignedToValue({ UNIQUE_ID: 'outside' }), 'dylan_collyge');
});


test('an idempotent acknowledgment cannot replace a newer realtime row revision', () => {
  const ctx = harness();
  ctx.warehouseAssignedItemsInventory.find(row => row.master_unique_id === 'outside').revision = 6;
  ctx.applyAcknowledgedEvalAssignmentResults([], [{ contractVersion:'inventory-row-assignments-v1', defaults:[],
    assignments:[{master_unique_id:'outside',itemcode:'SAME',assignedto:'old_owner',revision:5}] }]);
  assert.equal(ctx.getMasterAssignedToValue({UNIQUE_ID:'outside'}),'dylan_collyge');
});

test('duplicate row controls and overlapping bulk submissions share one pending itemcode command', async () => {
  const ctx = harness();
  let release, calls = 0;
  ctx.supabaseRpc = async () => { calls++; await new Promise(resolve => { release = resolve; }); throw new Error('Offline'); };
  const first = ctx.assignEvalItemcodes(['SAME'], 'megan_kelly');
  assert.equal(ctx.managerAssignedColumnState.defaultPending.has('SAME'), true);
  await ctx.assignEvalItemcodes(['same'], 'dylan_collyge');
  await ctx.assignEvalItemcodes(['SAME', 'NONE'], 'dylan_collyge');
  assert.equal(calls, 1);
  assert.equal(ctx.managerAssignedColumnState.defaultDrafts.SAME.assignedto, 'megan_kelly');
  release(); await first;
  assert.equal(ctx.managerAssignedColumnState.defaultPending.size, 0);
  assert.equal(ctx.managerAssignedColumnState.defaultDrafts.SAME.error, 'Offline');
});

test('independent pending commands preserve each other and changed retries receive distinct IDs', async () => {
  const ctx = harness();
  const calls = [], releases = [];
  ctx.crypto.randomUUID = () => `request-${calls.length}`;
  ctx.supabaseRpc = async (name, args) => {
    calls.push(JSON.parse(JSON.stringify(args)));
    await new Promise(resolve => releases.push(resolve));
    throw new Error('Offline');
  };
  const a = ctx.assignEvalItemcodes(['SAME'], 'megan_kelly');
  const b = ctx.assignEvalItemcodes(['NONE'], 'dylan_collyge');
  assert.notEqual(calls[0].p_request_id, calls[1].p_request_id);
  releases[0](); await a;
  assert.equal(ctx.managerAssignedColumnState.defaultPending.has('NONE'), true);
  releases[1](); await b;
  const retry = ctx.assignEvalItemcodes(['SAME'], 'megan_kelly');
  releases[2](); await retry;
  assert.equal(calls[0].p_request_id, calls[2].p_request_id);
  const changed = ctx.assignEvalItemcodes(['SAME'], 'dylan_collyge');
  releases[3](); await changed;
  assert.notEqual(calls[0].p_request_id, calls[3].p_request_id);
  assert.equal(ctx.managerAssignedColumnState.defaultDrafts.NONE.assignedto, 'dylan_collyge');
});

test('a save acknowledgment after an account change cannot mutate the new session', async () => {
  const ctx = harness();
  let release;
  ctx.supabaseRpc = async () => {
    await new Promise(resolve => { release = resolve; });
    return { contractVersion: 'inventory-row-assignments-v1', assignments: [{master_unique_id:'outside', itemcode:'SAME', assignedto:'megan_kelly', revision:100}] };
  };
  const pending = ctx.assignEvalItemcodes(['SAME'], 'megan_kelly');
  ctx.currentUser = 'megan_kelly';
  release(); await pending;
  assert.equal(ctx.getMasterAssignedToValue({UNIQUE_ID:'outside'}), 'dylan_collyge');
  assert.equal(ctx.getManagerAssignedColumnState().defaultDrafts, undefined);
});

test('Crop Roll reports keep exact row ownership without legacy location or itemcode overrides', () => {
  const ctx = vm.createContext({ WAREHOUSE_ASSIGNED_ITEMS_TABLE:'ph_inventory_row_assignments',
    getEvalTaskAssignedUsersFromItem: row => row.owners,
    normalizeEvalAssignableUser: value => String(value || '').toLowerCase(),
    getCropRollItemCodeOverrideUsers: () => { throw new Error('legacy override must not run'); } });
  vm.runInContext(extract('getCropRollEvalUsersForItem'),ctx);
  assert.deepEqual(Array.from(ctx.getCropRollEvalUsersForItem({owners:['mitch_kaiser']})),['mitch_kaiser']);
  assert.deepEqual(Array.from(ctx.getCropRollEvalUsersForItem({owners:[]})),[]);
});
