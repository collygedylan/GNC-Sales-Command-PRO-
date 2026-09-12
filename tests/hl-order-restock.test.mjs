import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('        // HL selections mirror');
const end = html.indexOf('\n\n        function getCartSelectedItems()', start);
assert.ok(start >= 0 && end > start, 'HL implementation block must be present');

function runtime() {
  const ctx = vm.createContext({
    Map, Set, Object, JSON, String, Number, Date, Intl, Promise, Array, Math, console,
    navigator: { onLine: true },
    document: { hidden: false, getElementById: () => null, querySelectorAll: () => [] },
    currentUser: 'dylan_collyge', nativeAuthSessionActive: true,
    nativeAuthProfile: { username: 'dylan_collyge' },
    getSupabaseReadIdentityScope: () => 'restock-test',
    escapeHtml: value => String(value ?? ''), buildFastInvokeAttrs: () => '',
    selectedItems: new Set(), selectedItemSources: new Map(),
    getCurrentVisibleViewId: () => 'hl-order', renderHlOrder: () => {}, showToast: () => {}
  });
  vm.runInContext(html.slice(start, end), ctx);
  return ctx;
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
