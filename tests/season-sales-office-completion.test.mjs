import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing completion source: ${start}`);
  return html.slice(from, to);
}
const receiptSource = between('let seasonSalesOfficeCompletionState = null;', 'function getSalesOfficeSeasonItems()');
const completionSource = between('async function markSalesOfficeComplete(', 'function isSameDockSuspendDcRequestCardDataLocation(');
const row = (overrides = {}) => ({ UNIQUE_ID: 'master-1', MASTER_ID: 'master-1', DOM_ID: 'so_master-1', ITEMCODE: 'TEST-1', SO_SOURCE: 'season', STATE_REVISION: 7, APP_TAB_ASSIGNMENT: 'season', ...overrides });
const ack = (overrides = {}) => ({ ok: true, status: 'done', masterId: 'master-1', revision: 8, removedMirrorIds: ['master-1'], ...overrides });
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function button() {
  const classes = new Set();
  return { disabled: false, classList: { add: (...values) => values.forEach((value) => classes.add(value)), remove: (...values) => values.forEach((value) => classes.delete(value)) } };
}
function harness(options = {}) {
  const storage = options.storage || new Map();
  const calls = [];
  const toasts = [];
  const removed = [];
  const ctx = {
    Map, Set, Date, JSON, Object, Array, String, Number, Promise,
    console: { error() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => `test-request-${calls.length}-${storage.size}` },
    currentUser: 'dylan', currentSeason: 'S1', currentYear: 26, allowed: true,
    salesOfficeInventory: options.rows || [row()],
    normalizeSessionIdentity: (value) => String(value || '').trim().toLowerCase(),
    firstNonEmptyValue: (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    getSeasonSalesNotesCurrentSeasonCode: () => ctx.currentSeason,
    getSeasonSalesNotesCurrentSalesYearCode: () => ctx.currentYear,
    findLinkedMasterRow: (item) => item ? row({ UNIQUE_ID: item.MASTER_ID || item.UNIQUE_ID }) : null,
    findItemByUniqueId: (id) => row({ UNIQUE_ID: id }),
    isBloomPickerSalesOfficeItem: (item) => item?.SO_SOURCE === 'bloom_picker',
    isSalesOfficeMoveSource: (item) => ['move', 'moves'].includes(item?.SO_SOURCE),
    isSalesOfficeComplete: (item) => item?.STATUS === 'done',
    isCurrentSeasonSalesNotesRow: (item) => item && !item.NOT_CURRENT,
    isAvBlanksPhotoBypassUserAllowed: () => ctx.allowed,
    ensureSeasonSalesNoteAccessFresh() {},
    showToast: (...args) => toasts.push(args),
    seasonSalesOfficeApi: async (operation, payload, apiOptions) => {
      calls.push({ operation, payload, options: apiOptions });
      return options.api ? options.api(operation, payload, apiOptions) : ack();
    },
    removeRenderedSalesOfficeRowByDomId: (id) => removed.push(id),
    removeSalesOfficeRowByUniqueId: (id, removeOptions) => {
      assert.equal(removeOptions.skipRemote, true, 'Season completion must never use generic DELETE');
      ctx.salesOfficeInventory = ctx.salesOfficeInventory.filter((item) => item.UNIQUE_ID !== id);
    },
    invalidateSalesOfficeLocalState() {},
    persistCurrentCache() {},
    refreshSeasonSalesOfficeDataset: async () => true,
    selectedItems: new Set(),
    maybeCreateSalesOfficeShearStageSplit: () => { throw new Error('Season row fell into generic completion'); },
    isTouchConstrainedDevice: () => true,
  };
  vm.createContext(ctx);
  vm.runInContext(`${receiptSource}\n${completionSource}`, ctx);
  return { ctx, calls, toasts, storage, removed };
}

test('every source admitted by Season view uses protected completion and server-confirmed removal', async () => {
  for (const source of ['season', 'flyer_folder', 'legacy', '', undefined]) {
    const { ctx, calls } = harness({ rows: [row({ SO_SOURCE: source })] });
    assert.equal(ctx.isSeasonSalesOfficeItem(ctx.salesOfficeInventory[0]), true);
    await ctx.markSalesOfficeComplete('master-1', 'so_master-1', button());
    assert.equal(calls.length, 1, `source ${source} must use protected API`);
    assert.equal(calls[0].operation, 'complete');
    assert.equal(ctx.salesOfficeInventory.length, 0);
  }
});

test('legacy rows obey the same user permission gate and canonical revision', async () => {
  const flyer = row({ UNIQUE_ID: 'flyer-1', DOM_ID: 'so_flyer-1', SO_SOURCE: 'flyer_folder', STATE_REVISION: undefined });
  const denied = harness({ rows: [row(), flyer] });
  denied.ctx.allowed = false;
  await denied.ctx.markSalesOfficeComplete('flyer-1', 'so_flyer-1', button());
  assert.equal(denied.calls.length, 0);
  assert.equal(denied.ctx.salesOfficeInventory.length, 2);
  const allowed = harness({ rows: [row(), flyer] });
  await allowed.ctx.markSeasonSalesOfficeComplete('flyer-1', 'so_flyer-1', button());
  assert.equal(allowed.calls[0].payload.masterId, 'master-1');
  assert.equal(allowed.calls[0].payload.expectedRevision, 7);
  assert.equal(allowed.ctx.salesOfficeInventory.length, 0);
});

test('double taps share one request and the card remains until acknowledgment', async () => {
  const response = deferred();
  const { ctx, calls } = harness({ api: () => response.promise });
  const first = button();
  const pending = ctx.markSeasonSalesOfficeComplete('master-1', 'so_master-1', first);
  await ctx.markSeasonSalesOfficeComplete('master-1', 'so_master-1', button());
  assert.equal(first.disabled, true);
  assert.equal(calls.length, 1);
  assert.equal(ctx.salesOfficeInventory.length, 1);
  response.resolve(ack());
  await pending;
  assert.equal(ctx.salesOfficeInventory.length, 0);
});

test('lost response and app reopen reuse the same persisted request token', async () => {
  const first = harness({ api: () => { throw new Error('Failed to fetch'); } });
  const firstButton = button();
  await first.ctx.markSeasonSalesOfficeComplete('master-1', 'so_master-1', firstButton);
  assert.equal(firstButton.disabled, false);
  assert.equal(first.ctx.salesOfficeInventory.length, 1);
  const reopened = harness({ storage: first.storage, api: () => ack({ status: 'already_done' }) });
  await reopened.ctx.markSeasonSalesOfficeComplete('master-1', 'so_master-1', button());
  assert.equal(reopened.calls[0].payload.idempotencyKey, first.calls[0].payload.idempotencyKey);
  assert.equal(reopened.calls[0].options.idempotencyKey, first.calls[0].payload.idempotencyKey);
  assert.equal(reopened.ctx.salesOfficeInventory.length, 0);
});

test('stale revision and expired sessions retain actionable rows and expose the server reason', async () => {
  for (const [status, code] of [[409, 'SEASON_SALES_STALE_REVISION'], [401, 'AUTH_REQUIRED']]) {
    const error = Object.assign(new Error('Server says refresh or sign in.'), { status, payload: { code } });
    const { ctx, calls, toasts } = harness({ api: () => { throw error; } });
    const action = button();
    await ctx.markSeasonSalesOfficeComplete('master-1', 'so_master-1', action);
    assert.equal(calls.length, 1);
    assert.equal(action.disabled, false);
    assert.equal(ctx.salesOfficeInventory.length, 1);
    assert.ok(toasts.some(([title, message]) => title === 'Could Not Complete' && message.includes(code)));
  }
});

test('persistent receipts suppress stale snapshots, preserve newer revisions and isolate users/seasons/years', async () => {
  const first = harness();
  await first.ctx.markSeasonSalesOfficeComplete('master-1', 'so_master-1', button());
  const reopened = harness({ storage: first.storage });
  assert.equal(reopened.ctx.isSeasonSalesOfficeItem(row()), false);
  assert.equal(reopened.ctx.isSeasonSalesOfficeItem(row({ STATE_REVISION: 9 })), true);
  assert.equal(reopened.ctx.isAcknowledgedSeasonSalesOfficeRow(row({ SO_SOURCE: 'bloom_picker' })), false);
  assert.equal(reopened.ctx.isAcknowledgedSeasonSalesOfficeRow(row({ SO_SOURCE: 'moves' })), false);
  reopened.ctx.currentYear = 27;
  assert.equal(reopened.ctx.isSeasonSalesOfficeItem(row({ STATE_REVISION: 1 })), true);
  reopened.ctx.currentYear = 26;
  reopened.ctx.currentSeason = 'F1';
  assert.equal(reopened.ctx.isSeasonSalesOfficeItem(row({ STATE_REVISION: 1 })), true);
  reopened.ctx.currentSeason = 'S1';
  reopened.ctx.currentUser = 'kayla';
  assert.equal(reopened.ctx.isSeasonSalesOfficeItem(row({ STATE_REVISION: 1 })), true);
});

test('a newer reopened row arriving before an old completion response is never removed by UID', async () => {
  const response = deferred();
  const { ctx, removed } = harness({ api: () => response.promise });
  const pending = ctx.markSeasonSalesOfficeComplete('master-1', 'so_master-1', button());
  ctx.salesOfficeInventory = [row({ STATE_REVISION: 9, WORKFLOW_STATUS: 'reopened_cav_blank' })];
  response.resolve(ack());
  await pending;
  assert.equal(ctx.salesOfficeInventory.length, 1, 'newer same-UID reopening survives older acknowledgment');
  assert.equal(ctx.salesOfficeInventory[0].STATE_REVISION, 9);
  assert.deepEqual(removed, []);
});

test('malformed acknowledgments never remove a row or record a success receipt', async () => {
  for (const malformed of [ack({ status: 'open' }), ack({ revision: null }), ack({ masterId: 'other-master' })]) {
    const { ctx } = harness({ api: () => malformed });
    const action = button();
    await ctx.markSeasonSalesOfficeComplete('master-1', 'so_master-1', action);
    assert.equal(ctx.salesOfficeInventory.length, 1);
    assert.equal(action.disabled, false);
    assert.equal(ctx.isAcknowledgedSeasonSalesOfficeRow(row()), false);
  }
});
