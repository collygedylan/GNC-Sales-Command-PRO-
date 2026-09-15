import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('        // HL selections mirror');
const end = html.indexOf('\n\n        function getCartSelectedItems()', start);
assert.ok(start >= 0 && end > start, 'HL implementation block must be present');

function runtime(overrides = {}) {
  const ctx = vm.createContext({
    Map, Set, Object, JSON, String, Number, Date, Intl, Promise, Array, Math, console,
    setTimeout, clearTimeout, queueMicrotask,
    navigator: { onLine: true },
    document: { hidden: false, getElementById: () => null, querySelectorAll: () => [] },
    currentUser: 'dylan_collyge', nativeAuthSessionActive: true,
    nativeAuthProfile: { id: 'restock-profile', username: 'dylan_collyge' },
    productionLiveSyncReadAuthEpoch: 1, productionLiveSyncReadPermissionVersion: '',
    getSupabaseReadIdentityScope: () => 'restock-test',
    escapeHtml: value => String(value ?? ''), buildFastInvokeAttrs: () => '',
    selectedItems: new Set(), selectedItemSources: new Map(),
    getCurrentVisibleViewId: () => 'hl-order', renderHlOrder: () => {}, showToast: () => {},
    ...overrides
  });
  vm.runInContext(html.slice(start, end), ctx);
  return ctx;
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function waitFor(check, message = 'condition did not settle') {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test('restock quantities retain a true zero and block unknown or negative inventory confirmation', () => {
  const ctx = runtime();
  const item = { itemcode: 'RESTOCK.1', size: '#3', suggested_quantity: '7', available: '0', can_confirm_inventory: true, status: 'ready' };
  assert.equal(ctx.getHlRestockGap(item), 7);
  assert.equal(ctx.isHlRestockAvailableForConfirmation(item), true, 'actual zero is confirmable');
  assert.equal(ctx.isHlRestockAvailableForConfirmation({ ...item, available: null }), false);
  assert.equal(ctx.isHlRestockAvailableForConfirmation({ ...item, available: '-1' }), false);
  assert.equal(ctx.getHlRestockStatusLabel({ status: 'receipt_pending' }), 'Awaiting inventory update');
});

test('new restock save omits a prior draft source id and passes the opaque inventory snapshot unchanged', async () => {
  const ctx = runtime();
  const item = { itemcode: 'RESTOCK.1', size: '#3', commonname: 'Restock Holly', source_id: 'saved-on-another-date', suggested_quantity: 7 };
  const snapshot = Object.freeze({ opaque: 'server-signed-snapshot' });
  const key = 'RESTOCK.1|#3';
  ctx.snapshot = snapshot;
  ctx.item = item;
  vm.runInContext("hlRestockState = { revision: 9, inventory_snapshot: snapshot, items: [item] }; hlRestockShipDate = '2026-09-20';", ctx);
  const card = { dataset: { hlRestockItem: key }, querySelector: () => ({ value: '4' }) };
  ctx.document = {
    hidden: false,
    getElementById: id => id === 'hl-restock-ship-date' ? { value: '2026-09-20' } : null,
    querySelectorAll: selector => selector === '[data-hl-restock-item]' ? [card] : []
  };
  const commands = [];
  ctx.runHlOrderCommand = async (...args) => { commands.push(args); return { state: { revision: 10 } }; };
  ctx.loadHlRestockState = async () => null;
  await ctx.saveHlRestockDraft(key);
  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], 'restock_draft_save');
  assert.deepEqual(JSON.parse(JSON.stringify(commands[0][1].rows)), [{ itemcode: 'RESTOCK.1', size: '#3', quantity: 4 }]);
  assert.equal(commands[0][1].inventory_snapshot, snapshot);
  assert.equal(commands[0][3], 9);
});

test('inventory confirmation submits the exact receipt snapshot that the dialog showed', async () => {
  const ctx = runtime();
  const nodes = new Map();
  const dialog = { open: false, innerHTML: '', showModal() { this.open = true; }, close() { this.open = false; } };
  ctx.document = {
    hidden: false,
    getElementById: id => nodes.get(id) || null,
    createElement: () => dialog,
    body: { appendChild: node => nodes.set(node.id, node) },
    querySelectorAll: () => []
  };
  const shownSnapshot = Object.freeze({ changed_at: '2026-09-12T11:00:00Z', master_revision: '7' });
  ctx.shownSnapshot = shownSnapshot;
  vm.runInContext(`hlRestockState = { revision: 3, inventory_snapshot: shownSnapshot, items: [{ itemcode: 'RESTOCK.1', size: '#3', available: 0, can_confirm_inventory: true, receipt_watermark: 'receipt-1', receipts: [{ order_number: 'HL-1', quantity_delta: 5, created_at: '2026-09-12T10:00:00Z' }] }] };`, ctx);
  ctx.openHlRestockInventoryConfirmation('RESTOCK.1|#3');
  assert.match(dialog.innerHTML, /HL-1/);
  assert.match(dialog.innerHTML, /Quantity change 5/);
  ctx.newSnapshot = { changed_at: '2026-09-12T12:00:00Z', master_revision: '8' };
  vm.runInContext(`hlRestockState = { revision: 4, inventory_snapshot: newSnapshot, items: [] };`, ctx);
  const commands = [];
  ctx.runHlOrderCommand = async (...args) => { commands.push(args); return { state: { revision: 4 } }; };
  ctx.loadHlRestockState = async () => null;
  await ctx.confirmHlRestockInventory();
  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], 'restock_inventory_confirm');
  assert.equal(commands[0][1].inventory_snapshot, shownSnapshot);
  assert.equal(commands[0][1].receipt_watermark, 'receipt-1');
  assert.equal(commands[0][3], 3);
});

test('initial permission metadata retries a discarded restock response once under the current scope', async () => {
  let scope = 'restock-scope:permission-pending';
  const ctx = runtime({ getSupabaseReadIdentityScope: () => scope });
  vm.runInContext("hlOrderTab = 'restocking';", ctx);
  const first = deferred();
  let reads = 0;
  ctx.supabaseRpc = async () => {
    reads++;
    if (reads === 1) {
      await first.promise;
      return { revision: 1, inventory_snapshot: { version: 'discarded' }, items: [{ itemcode: 'OLD' }] };
    }
    return { revision: 2, inventory_snapshot: { version: 'current' }, items: [{ itemcode: 'CURRENT' }] };
  };

  const pending = ctx.loadHlRestockState(true);
  await waitFor(() => reads === 1, 'first protected restock read should begin');
  scope = 'restock-scope:permission-ready';
  ctx.productionLiveSyncReadPermissionVersion = 'hl-policy-1';
  first.resolve();

  const state = await pending;
  assert.equal(reads, 2, 'only the initial permission transition retries');
  assert.equal(state.revision, 2);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(hlRestockState)', ctx)), {
    revision: 2, inventory_snapshot: { version: 'current' }, items: [{ itemcode: 'CURRENT' }]
  }, 'the discarded response never commits');
});

test('a discarded restock response never retries after account, auth epoch, or HL navigation changes', async (t) => {
  const cases = [
    ['account', (ctx, changeScope) => { ctx.currentUser = 'another-user'; changeScope(); }],
    ['auth epoch', (ctx, changeScope) => { ctx.productionLiveSyncReadAuthEpoch = 2; changeScope(); }],
    ['navigation', (ctx, changeScope) => { ctx.getCurrentVisibleViewId = () => 'home'; changeScope(); }]
  ];
  for (const [name, invalidate] of cases) await t.test(name, async () => {
    let scope = 'restock-scope:permission-pending';
    const ctx = runtime({ getSupabaseReadIdentityScope: () => scope });
    vm.runInContext("hlOrderTab = 'restocking';", ctx);
    const first = deferred();
    let reads = 0;
    ctx.supabaseRpc = async () => {
      reads++;
      await first.promise;
      return { revision: 1, inventory_snapshot: { version: 'discarded' }, items: [] };
    };
    const pending = ctx.loadHlRestockState(true);
    await waitFor(() => reads === 1, `${name} case should begin one read`);
    invalidate(ctx, () => { scope = 'restock-scope:permission-ready'; ctx.productionLiveSyncReadPermissionVersion = 'hl-policy-1'; });
    first.resolve();
    assert.equal(await pending, null);
    assert.equal(reads, 1, `${name} change must not retry with a different owner`);
    assert.equal(vm.runInContext('hlRestockState', ctx), null);
  });
});

test('the initial-permission retry cannot chain into a third read after another ownership change', async () => {
  let scope = 'restock-scope:permission-pending';
  const ctx = runtime({ getSupabaseReadIdentityScope: () => scope });
  vm.runInContext("hlOrderTab = 'restocking';", ctx);
  const first = deferred();
  const second = deferred();
  let reads = 0;
  ctx.supabaseRpc = async () => {
    reads++;
    if (reads === 1) await first.promise;
    else await second.promise;
    return { revision: reads, inventory_snapshot: { version: reads }, items: [] };
  };

  const pending = ctx.loadHlRestockState(true);
  await waitFor(() => reads === 1);
  scope = 'restock-scope:permission-ready';
  ctx.productionLiveSyncReadPermissionVersion = 'hl-policy-1';
  first.resolve();
  await waitFor(() => reads === 2, 'the initial transition should permit one fresh read');
  scope = 'restock-scope:permission-changed-again';
  ctx.productionLiveSyncReadPermissionVersion = 'hl-policy-2';
  second.resolve();

  assert.equal(await pending, null);
  assert.equal(reads, 2, 'a changed retry owner must not schedule a third read');
  assert.equal(vm.runInContext('hlRestockState', ctx), null);
});

test('F1 and S1 keep independent controls and reject a late response from the other lot', async () => {
  const ctx = runtime();
  ctx.renderHlOrder = () => {};
  const first = deferred();
  const calls = [];
  ctx.supabaseRpc = async (name, body) => {
    calls.push([name, body.p_lot]);
    if (body.p_lot === '27.F1') await first.promise;
    return { revision: 1, inventory_snapshot: { lot: body.p_lot }, items: [{ itemcode: 'SHARED.1', size: '#3', lot: body.p_lot, available: body.p_lot === '27.S1' ? 5 : 99 }] };
  };
  vm.runInContext("hlRestockSearch = 'juniper'; hlRestockFilter = 'all'; hlRestockShipDate = '2026-09-20'; hlRestockEdits.set('SHARED.1|#3', '7');", ctx);
  const pendingF1 = ctx.loadHlRestockState();
  ctx.setHlRestockLot('27.S1');
  await waitFor(() => vm.runInContext('hlRestockState?.items?.[0]?.lot', ctx) === '27.S1');
  first.resolve(); await pendingF1;
  assert.equal(ctx.getHlRestockItems()[0].available, 5);
  assert.equal(vm.runInContext('hlRestockSearch', ctx), '');
  assert.equal(ctx.getHlRestockItemKey({ itemcode: 'SHARED.1', size: '#3', lot: '27.S1' }), 'SHARED.1|#3|27.S1');
  ctx.setHlRestockLot('27.F1');
  assert.equal(vm.runInContext('hlRestockSearch', ctx), 'juniper');
  assert.equal(vm.runInContext('hlRestockFilter', ctx), 'all');
  assert.equal(vm.runInContext('hlRestockShipDate', ctx), '2026-09-20');
  assert.equal(ctx.getHlRestockQuantityInput({ itemcode: 'SHARED.1', size: '#3' }), '7');
  assert.deepEqual(calls[0], ['hl_order_restock_state_v2', '27.F1']);
});

test('target confirmation uses the reviewed server preview and its revision, without computing a client target', async () => {
  const ctx = runtime();
  const nodes = new Map();
  const dialog = { open: false, innerHTML: '', showModal() { this.open = true; }, close() { this.open = false; } };
  ctx.document = { hidden: false, getElementById: id => nodes.get(id) || null, createElement: () => dialog, body: { appendChild: node => nodes.set(node.id, node) }, querySelectorAll: () => [] };
  vm.runInContext("hlRestockLot = '27.S1'; hlRestockState = { revision: 11, inventory_snapshot: {}, items: [{ itemcode: '000310.030.1', size: '#3', lot: '27.S1', target: 239 }] };", ctx);
  const commands = [];
  ctx.runHlOrderCommand = async (...args) => {
    commands.push(args);
    return { state: { revision: 12 }, restock_target_preview: { id: 'protected-preview', items: [{ itemcode: '000310.030.1', size: '#3', lot: '27.S1', previous_target: 239, basis_quantity: 794, target: 239 }] } };
  };
  ctx.loadHlRestockState = async () => null;
  await ctx.previewHlRestockTarget('000310.030.1|#3|27.S1');
  assert.match(dialog.innerHTML, /794/); assert.match(dialog.innerHTML, /239/); assert.match(dialog.innerHTML, /27.S1/);
  assert.equal(commands[0][1].lot, '27.S1');
  assert.equal(commands[0][3], 11);
  await ctx.confirmHlRestockTarget();
  assert.equal(commands[1][0], 'restock_target_confirm');
  assert.equal(commands[1][1].preview_id, 'protected-preview');
  assert.equal(commands[1][3], 12);
  assert.equal(dialog.open, false);
});
