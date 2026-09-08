import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from > 0 && to > from);
  return html.slice(from, to);
}
const helpers = between('let dockSuspendCompletionState = null;', 'async function openDockSuspendDcNotFoundRecount(');
const handler = between('async function completeDockSuspendDcRequestFromCard(', 'async function saveDockSuspendDcRequestMirrorData(');
const revision = '2026-09-08T15:50:47.123456Z';
const source = () => ({ UNIQUE_ID: 'soc-1', LAST_UPDATED: revision, DATE_COMPLETED: '', SUSPEND: 'SUSPEND', SUSPEND_TO: 'DC', PTRONHAND: '0' });
const button = () => ({ innerHTML: 'Done', disabled: false, classList: { add() {}, remove() {} } });
const acknowledgement = (changes = {}) => ({ ok: true, sourceUid: 'soc-1', sourceLastUpdated: revision, completedAt: '2026-09-08T16:00:00Z', alreadyCompleted: false, ...changes });
function harness(options = {}) {
  const storage = options.storage || new Map();
  const calls = [], toasts = [];
  const row = source();
  const mirror = { ...row, UNIQUE_ID: 'dock_suspend_dc_soc-1', DOCK_SUSPEND_SOURCE_UID: row.UNIQUE_ID };
  const ctx = {
    Date, Map, Set, JSON, Object, Array, String, Number, Promise,
    currentUser: 'dylan_collyge', SUPABASE_URL: 'https://isolated.invalid', allowed: true,
    crypto: { randomUUID: () => `a0000000-0000-4000-8000-${String(storage.size + 1).padStart(12, '0')}` },
    console: { warn() {} },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    normalizeSessionIdentity: (value) => String(value || '').trim().toLowerCase(),
    firstNonEmptyValue: (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim()) ?? '',
    canCurrentUserViewDockSuspendDcRequests: () => ctx.allowed,
    getDockSuspendDcRequestSourceUid: (item) => item?.DOCK_SUSPEND_SOURCE_UID || item?.UNIQUE_ID?.replace(/^dock_suspend_dc_/, '') || '',
    findDockSuspendDcRequestSourceRow: () => ctx.currentSource,
    findDockSuspendDcRequestMirrorRowByUniqueId: () => mirror,
    isDockSuspendDcRequestMirrorRow: (item) => Boolean(item?.DOCK_SUSPEND_SOURCE_UID),
    getDockSuspendDcRequestGroupParts: () => ({}),
    showAppConfirm: async () => options.confirm !== false,
    showToast: (...args) => toasts.push(args),
    getDetailRowWriteTimeoutMs: () => 1000,
    supabaseRpc: async (name, body) => { calls.push({ name, body }); return options.api ? options.api(body) : acknowledgement(); },
    applyDockSuspendDcRequestHandledState: (item, at) => { item.DATE_COMPLETED = at; item.date_completed = at; },
    refreshLocalDockSuspendDcRequestState() {}, markViewDirty() {},
    dockSuspendDcRequestMirrorRowsCacheKey: 'stale', requestScopedItemsCacheKey: 'stale',
    requestsInventory: [mirror], currentSource: row,
  };
  vm.createContext(ctx);
  vm.runInContext(`${helpers}\n${handler}`, ctx);
  return { ctx, row, mirror, calls, toasts, storage };
}

test('Done saves the exact source revision before removing zero-stock rows; retains the source', async () => {
  let resolve;
  const wait = new Promise((done) => { resolve = done; });
  const h = harness({ api: () => wait });
  const action = button();
  const pending = h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
  await new Promise(setImmediate);
  assert.equal(action.disabled, true);
  assert.equal(h.row.DATE_COMPLETED, '');
  assert.equal(h.toasts.length, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'complete_suspend_tag_v1');
  assert.equal(h.calls[0].body.p_source_uid, 'soc-1');
  assert.equal(h.calls[0].body.p_expected_last_updated, revision);
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.equal(h.calls.length, 1);
  resolve(acknowledgement());
  await pending;
  assert.equal(h.row.DATE_COMPLETED, acknowledgement().completedAt);
  assert.equal(h.row.PTRONHAND, '0');
  assert.equal(h.ctx.isAcknowledgedDockSuspendCompletion(source()), true);
});

test('cancel or unauthorized actor never submits a write', async () => {
  for (const denied of [false, true]) {
    const h = harness({ confirm: denied });
    h.ctx.allowed = !denied;
    const action = button();
    await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
    assert.equal(h.calls.length, 0);
    assert.equal(h.row.DATE_COMPLETED, '');
    assert.equal(action.disabled, false);
  }
});

test('lost response and reopening the app preserve the command token; failures stay actionable', async () => {
  const h = harness({ api: () => { throw new Error('Connection lost'); } });
  const action = button();
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
  assert.equal(action.disabled, false);
  assert.equal(h.row.DATE_COMPLETED, '');
  assert.equal(h.ctx.isAcknowledgedDockSuspendCompletion(h.row), false);
  const next = harness({ storage: h.storage, api: () => acknowledgement({ alreadyCompleted: true }) });
  await next.ctx.completeDockSuspendDcRequestFromCard(next.mirror.UNIQUE_ID, button());
  assert.equal(next.calls[0].body.p_request_id, h.calls[0].body.p_request_id);
  assert.equal(next.row.DATE_COMPLETED, acknowledgement().completedAt);
});

test('malformed acknowledgements never hide the row or claim success', async () => {
  for (const result of [null, {}, acknowledgement({ sourceUid: 'other' }), acknowledgement({ sourceLastUpdated: null }), acknowledgement({ completedAt: 'invalid' }), acknowledgement({ alreadyCompleted: undefined })]) {
    const h = harness({ api: () => result });
    const action = button();
    await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
    assert.equal(h.row.DATE_COMPLETED, '');
    assert.equal(h.ctx.isAcknowledgedDockSuspendCompletion(h.row), false);
    assert.equal(action.disabled, false);
    assert.ok(!h.toasts.some(([title]) => title === 'Marked Done'));
  }
});

test('receipts suppress stale snapshots but not newer imports or other users', async () => {
  const h = harness();
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  const next = harness({ storage: h.storage });
  assert.equal(next.ctx.isAcknowledgedDockSuspendCompletion(source()), true);
  assert.equal(next.ctx.isAcknowledgedDockSuspendCompletion({ ...source(), LAST_UPDATED: '2026-09-08T15:50:48Z' }), false);
  next.ctx.currentUser = 'jd_jones';
  assert.equal(next.ctx.isAcknowledgedDockSuspendCompletion(source()), false);
});

test('an older acknowledgement does not mutate a newer source or a switched user session', async () => {
  for (const switchUser of [false, true]) {
    let resolve;
    const h = harness({ api: () => new Promise((done) => { resolve = done; }) });
    const pending = h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
    await new Promise(setImmediate);
    h.ctx.currentSource = { ...source(), LAST_UPDATED: '2026-09-08T15:50:48Z' };
    if (switchUser) h.ctx.currentUser = 'jd_jones';
    resolve(acknowledgement());
    await pending;
    assert.equal(h.ctx.currentSource.DATE_COMPLETED, '');
    if (switchUser) assert.equal(h.row.DATE_COMPLETED, '');
  }
});

test('completion revision retains PostgreSQL microseconds and equivalent timezone formatting', () => {
  const h = harness();
  assert.equal(h.ctx.getDockSuspendCompletionRevision({ last_updated: '2026-09-08T15:50:47.123456+00:00' }), revision);
  assert.equal(h.ctx.getDockSuspendCompletionRevision({ last_updated: '2026-09-08T10:50:47.123456-05:00' }), revision);
  assert.equal(h.ctx.getDockSuspendCompletionRevision({ last_updated: null }), null);
});

test('a row changed while confirmation is open submits only the originally reviewed revision', async () => {
  const h = harness({ api: () => { throw new Error('SUSPEND_TAG_SOURCE_CHANGED'); } });
  let confirm;
  h.ctx.showAppConfirm = () => new Promise((resolve) => { confirm = resolve; });
  const pending = h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  h.ctx.currentSource = { ...source(), LAST_UPDATED: '2026-09-08T17:00:00Z' };
  confirm(true);
  await pending;
  assert.equal(h.calls[0].body.p_expected_last_updated, revision);
  assert.equal(h.ctx.currentSource.DATE_COMPLETED, '');
  assert.ok(h.toasts.some(([, message]) => message.includes('SUSPEND_TAG_SOURCE_CHANGED')));
});

test('recount completion shares the protected persistence path', async () => {
  const h = harness();
  await h.ctx.markDockSuspendDcRequestCompleteAfterRecount(h.mirror.UNIQUE_ID);
  assert.equal(h.calls[0].name, 'complete_suspend_tag_v1');
  assert.equal(h.row.DATE_COMPLETED, acknowledgement().completedAt);
});
