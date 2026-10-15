// @test-group: suspend
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
const workflow = between('function getSuspendTagStatus(', 'let dockSuspendCompletionState = null;');
const helpers = between('let dockSuspendCompletionState = null;', 'async function openDockSuspendDcNotFoundRecount(');
const handler = between('async function completeDockSuspendDcRequestFromCard(', 'async function saveDockSuspendDcRequestMirrorData(');
const revision = '2026-09-08T15:50:47.123456Z';
const source = () => ({ UNIQUE_ID: 'soc-1', LAST_UPDATED: revision, DATE_COMPLETED: '', SUSPEND: 'SUSPEND', SUSPEND_TO: 'DC', PTRONHAND: '0' });
const button = () => ({ innerHTML: 'Done', disabled: false, classList: { add() {}, remove() {} } });
const acknowledgement = (changes = {}) => ({ ok: true, row: { unique_id: 'soc-1', last_updated: revision, date_completed: '2026-09-08T16:00:00Z', suspend_tag_version: 1, suspend_tag_status: 'completed', ...changes } });
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
    canCurrentUserWorkRequestItem: () => ctx.allowed,
    canUseProductionLiveSync: () => options.live === true,
    AbortController,
    productionLiveSyncNavigation: new AbortController(),
    view: 'detail', permission: 'permissions-1',
    getCurrentVisibleViewId: () => ctx.view,
    getProductionLiveSyncContext: () => ({ scope: ctx.currentUser, dataPermissionVersion: ctx.permission }),
    isSuspendTagWriteSurface: () => ['detail', 'request'].includes(ctx.view),
    isDockSuspendDcRequestRowAnyStatus: () => true,
    staleSupabaseReadScopeError: () => new Error('stale scope'),
    withProductionLiveSyncSignal: async (_, read) => read(ctx.productionLiveSyncNavigation.signal),
    window: { AgMetricLiveSync: { snapshot: value => value } },
    supabaseRpc: async () => ({ permissionVersion: ctx.permission,
      sources: new Map([['ph_soc_master', { state: 'ready', revision: 'dataset-1' }]]) }),
    remoteRow: { unique_id: 'soc-1', last_updated: revision, suspend_tag_version: 0, suspend_tag_status: 'pending' },
    requireCurrentSuspendTagWriteProof: () => options.proof !== false,
    getDockSuspendDcRequestSourceUid: (item) => item?.DOCK_SUSPEND_SOURCE_UID || item?.UNIQUE_ID?.replace(/^dock_suspend_dc_/, '') || '',
    findDockSuspendDcRequestSourceRow: () => ctx.currentSource,
    findDockSuspendDcRequestMirrorRowByUniqueId: () => mirror,
    isDockSuspendDcRequestMirrorRow: (item) => Boolean(item?.DOCK_SUSPEND_SOURCE_UID),
    getDockSuspendDcRequestGroupParts: () => ({}),
    showAppConfirm: async () => options.confirm !== false,
    showToast: (...args) => toasts.push(args),
    getDetailRowWriteTimeoutMs: () => 1000,
    postAppFunctionJson: async (_url, body) => {
      calls.push({ name: body.operation, body });
      if (body.operation === 'rows') return { ok: true, data: options.read ? await options.read(ctx) : { rows: [{ ...ctx.remoteRow }] } };
      const result = options.api ? await options.api(body) : acknowledgement();
      if (options.live && result?.row) ctx.remoteRow = { ...result.row };
      return { ok: true, data: result };
    },
    APP_API_FUNCTION_URL: 'https://example.invalid', normalizeRowPhotoFields() {}, buildSearchIndex() {},
    getDockSuspendDcRequestCompletionReadiness: () => ({ ready: options.ready !== false, missing: ['photo'] }), openDockSuspendDcRequestUpdate() {},
    applyDockSuspendDcRequestHandledState: (item, at) => { item.DATE_COMPLETED = at; item.date_completed = at; },
    refreshLocalDockSuspendDcRequestState() {}, markViewDirty() {},
    queueSuspendTagInventoryReconciliation() {},
    invalidateSuspendTagInventoryRows() {},
    invalidateDockSuspendDcSourceRowLookup() {},
    getPendingPhotoUploadsForItem: () => [],
    reconcileConfirmedDriveEvidence: (...args) => { ctx.inventoryReconciliation = args; return true; },
    matchesSuspendTagInventoryIdentity: () => true,
    getSuspendTagInventoryIdentity: () => ({}),
    getSupabaseReadIdentityScope: () => ctx.currentUser,
    mergePhotoCsvList: values => [...new Set(values.flatMap(value => String(value || '').split(',').filter(Boolean)))].join(','),
    dockSuspendDcRequestMirrorRowsCacheKey: 'stale', requestScopedItemsCacheKey: 'stale',
    requestsInventory: [mirror], currentSource: row,
  };
  vm.createContext(ctx);
  vm.runInContext(`${workflow}\n${helpers}\n${handler}`, ctx);
  return { ctx, row, mirror, calls, toasts, storage };
}

test('native Save verifies only its row and succeeds while the whole view is unverified', async () => {
  const h = harness({ live: true, proof: false });
  assert.equal(await h.ctx.runSuspendTagRowCommand('save', h.mirror, { dock_spec: 'new spec', dock_photo_link: 'photo.jpg' }), true);
  assert.deepEqual(h.calls.map(call => call.name), ['rows', 'save']);
  assert.equal(h.calls[1].body.expectedVersion, 0);
  assert.equal(h.calls[1].body.payload.patch.dock_spec, 'new spec');
  assert.equal(h.calls[1].body.payload.patch.dock_photo_link, 'photo.jpg');
  assert.equal(h.toasts.length, 0);
  assert.equal(vm.runInContext('suspendTagWriteReads.size', h.ctx), 0);
  assert.equal(vm.runInContext('suspendTagRowWrites.size', h.ctx), 0);
});

test('Done applies canonical inventory evidence before returning and keeps the tag visible', async () => {
  const inventoryRow = { unique_id: 'master-1', photo_link: 'new.jpg', match: '40', av_rule_photo_updated_at: '2026-10-14T11:00:00Z' };
  const h = harness({ api: () => ({ ...acknowledgement(), inventoryRow }) });
  assert.equal(await h.ctx.runSuspendTagRowCommand('complete', h.mirror), true);
  assert.equal(h.ctx.inventoryReconciliation?.[0].row, inventoryRow);
  assert.equal(h.ctx.inventoryReconciliation?.[0].canonicalConfirmed, true);
  assert.equal(h.row.SUSPEND, 'SUSPEND');
  assert.equal(h.row.SUSPEND_TO, 'DC');
});

test('Complete Tag waits for confirmation, permits pending approval, and removes eligibility without emailing', async () => {
  let finish;
  const h = harness({ live: true, proof: false, api: () => new Promise(resolve => { finish = resolve; }) });
  h.ctx.remoteRow.suspend_tag_status = h.mirror.suspend_tag_status = 'awaiting_rep';
  const action = button();
  const pending = h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
  await new Promise(setImmediate);
  assert.equal(action.disabled, true);
  assert.equal(h.row.SUSPEND, 'SUSPEND');
  await h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.deepEqual(h.calls.map(call => call.name), ['rows', 'close']);
  finish(acknowledgement({ suspend: null, suspend_to: null }));
  await pending;
  assert.equal(h.row.SUSPEND, null);
  assert.equal(h.mirror.SUSPEND_TO, null);
  assert.equal(action.disabled, false);
  assert.ok(h.toasts.some(([title]) => title === 'Tag Complete'));
});

test('lost close response retries its receipt even after the row leaves the eligible dataset', async () => {
  let first = true;
  const h = harness({ live: true, proof: false,
    read: ctx => ({ rows: first ? [{ ...ctx.remoteRow }] : [] }),
    api: () => {
      if (first) { first = false; throw new Error('response lost'); }
      return acknowledgement({ suspend: null, suspend_to: null });
    } });
  await h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.equal(h.row.SUSPEND, 'SUSPEND');
  await h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  const writes = h.calls.filter(call => call.name === 'close');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.commandId, writes[1].body.commandId);
  assert.equal(writes[0].body.expectedVersion, writes[1].body.expectedVersion);
  assert.equal(h.row.SUSPEND, null);
  const restored = harness({ storage: h.storage });
  assert.equal(restored.ctx.overlaySuspendTagReceipt(source()).suspend, null);
  assert.equal(restored.ctx.overlaySuspendTagReceipt(source()).SUSPEND, null, 'cached uppercase aliases cannot resurrect a closed tag');
  assert.equal(restored.ctx.overlaySuspendTagReceipt(source()).SUSPEND_TO, null);
});

test('Complete Tag retains the card when uploads fail, data is incomplete, or the server rejects closure', async () => {
  for (const scenario of ['upload', 'incomplete', 'conflict']) {
    const h = harness({ ready: scenario !== 'incomplete', api: () => { throw new Error('SUSPEND_TAG_VERSION_CHANGED'); } });
    if (scenario === 'upload') h.ctx.getPendingPhotoUploadsForItem = () => [Promise.reject(new Error('Upload failed'))];
    await h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
    assert.equal(h.row.SUSPEND, 'SUSPEND');
    assert.equal(h.calls.filter(call => call.name === 'close').length, scenario === 'conflict' ? 1 : 0);
    assert.ok(!h.toasts.some(([title]) => title === 'Tag Complete'));
  }
});

test('close permission permits reviewed rows without unlocking editing or bypassing role access', () => {
  const h = harness();
  vm.runInContext(between('function canCurrentUserWorkRequestItem(', 'function parseRequestCustomerFolderParts('), h.ctx);
  for (const status of ['awaiting_rep', 'approved']) {
    h.mirror.suspend_tag_status = status;
    assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'close'), true);
    assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'edit'), false);
    assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'complete'), false);
  }
  h.ctx.allowed = false;
  assert.equal(h.ctx.canCurrentUserWorkRequestItem(h.mirror, 'close'), false);
});

test('an incomplete close acknowledgement cannot remove the card or report completion', async () => {
  const h = harness({ api: () => acknowledgement({ suspend: 'SUSPEND', suspend_to: 'DC' }) });
  await h.ctx.closeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.equal(h.row.SUSPEND, 'SUSPEND');
  assert.ok(h.toasts.some(([title]) => title === 'Could Not Complete Tag'));
  assert.ok(!h.toasts.some(([title]) => title === 'Tag Complete'));
});

test('native verification deduplicates reads and releases pending state after failure and retry', async () => {
  let finish;
  const h = harness({ live: true, proof: false, read: () => new Promise(resolve => { finish = resolve; }) });
  const first = h.ctx.loadCurrentSuspendTagWriteRow(h.mirror, 'save');
  assert.equal(h.ctx.loadCurrentSuspendTagWriteRow(h.mirror, 'save'), first);
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 1);
  finish({ rows: [] });
  await assert.rejects(first, /SOURCE_CHANGED/);
  assert.equal(vm.runInContext('suspendTagWriteReads.size', h.ctx), 0);
  const retry = h.ctx.loadCurrentSuspendTagWriteRow(h.mirror, 'save');
  await new Promise(setImmediate);
  finish({ rows: [h.ctx.remoteRow] });
  assert.equal(h.ctx.isCurrentSuspendTagWriteRowProof(await retry, h.mirror, 'save'), true);
  assert.equal(vm.runInContext('suspendTagWriteReads.size', h.ctx), 0);
});

test('native Mark Done waits for verification and ignores duplicate taps before writing', async () => {
  let finish;
  const h = harness({ live: true, proof: false, read: () => new Promise(resolve => { finish = resolve; }) });
  const action = button();
  const first = h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
  await new Promise(setImmediate);
  assert.equal(action.disabled, true);
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.deepEqual(h.calls.map(call => call.name), ['rows']);
  finish({ rows: [h.ctx.remoteRow] });
  await first;
  assert.deepEqual(h.calls.map(call => call.name), ['rows', 'complete']);
  assert.equal(action.disabled, false);
  assert.equal(vm.runInContext('suspendTagCompletionActions.size', h.ctx), 0);
});

test('native writes reject locked, stale, unauthorized and changing source snapshots', async () => {
  const scenarios = [
    h => { h.ctx.remoteRow.suspend_tag_status = 'awaiting_rep'; },
    h => { h.ctx.remoteRow.suspend_tag_version = 5; },
    h => { h.ctx.remoteRow.last_updated = 'changed'; },
    h => { h.ctx.remoteRow.unique_id = 'other-row'; },
    h => { h.ctx.allowed = false; },
    h => { h.ctx.supabaseRpc = async () => ({ permissionVersion: 'wrong', sources: new Map([['ph_soc_master', { state: 'ready', revision: 'a' }]]) }); },
    h => { h.ctx.supabaseRpc = async () => ({ permissionVersion: h.ctx.permission, sources: new Map([['ph_soc_master', { state: 'importing', revision: 'a' }]]) }); },
    h => { let i = 0; h.ctx.supabaseRpc = async () => ({ permissionVersion: h.ctx.permission, sources: new Map([['ph_soc_master', { state: 'ready', revision: String(i++) }]]) }); },
  ];
  for (const configure of scenarios) {
    const h = harness({ live: true, proof: false }); configure(h);
    await assert.rejects(h.ctx.runSuspendTagRowCommand('save', h.mirror, { dock_spec: 'draft' }));
    assert.equal(h.calls.filter(call => call.name === 'save').length, 0);
    assert.equal(vm.runInContext('suspendTagWriteReads.size', h.ctx), 0);
    assert.equal(vm.runInContext('suspendTagRowWrites.size', h.ctx), 0);
  }
});

test('navigation, account and permission changes discard an in-flight row verification', async () => {
  for (const change of [h => h.ctx.productionLiveSyncNavigation.abort(), h => { h.ctx.productionLiveSyncNavigation = new AbortController(); },
    h => { h.ctx.currentUser = 'other'; }, h => { h.ctx.permission = 'changed'; }, h => { h.ctx.view = 'home'; }]) {
    let finish;
    const h = harness({ live: true, proof: false, read: () => new Promise(resolve => { finish = resolve; }) });
    const pending = h.ctx.runSuspendTagRowCommand('save', h.mirror, { dock_spec: 'draft' });
    await new Promise(setImmediate); change(h); finish({ rows: [h.ctx.remoteRow] });
    await assert.rejects(pending);
    assert.equal(h.calls.filter(call => call.name === 'save').length, 0);
    assert.equal(vm.runInContext('suspendTagWriteReads.size', h.ctx), 0);
  }
});

test('native lost-response retry retains its exact idempotency token and expected version', async () => {
  let fail = true;
  const h = harness({ live: true, proof: false, api: () => {
    h.ctx.remoteRow = { ...h.ctx.remoteRow, suspend_tag_version: 1, dock_spec: 'draft' };
    if (fail) { fail = false; throw new Error('response lost'); }
    return acknowledgement({ suspend_tag_status: 'pending', dock_spec: 'draft' });
  } });
  await assert.rejects(h.ctx.runSuspendTagRowCommand('save', h.mirror, { dock_spec: 'draft' }), /response lost/);
  assert.equal(await h.ctx.runSuspendTagRowCommand('save', h.mirror, { dock_spec: 'draft' }), true);
  const writes = h.calls.filter(call => call.name === 'save');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.commandId, writes[1].body.commandId);
  assert.equal(writes[1].body.expectedVersion, 0);
});

test('row verification does not bypass the approval action guard', async () => {
  const h = harness({ live: true, proof: false });
  await assert.rejects(h.ctx.runSuspendTagRowCommand('send', h.mirror), /FORBIDDEN/);
  assert.equal(h.calls.length, 0);
});

test('detail save keeps captured fields and waits for photos, with a recoverable verification timeout', async () => {
  let finishPhoto, failRead = true;
  const photo = new Promise(resolve => { finishPhoto = resolve; });
  const h = harness({ live: true, proof: false, read: ctx => {
    if (failRead) throw new Error('verification timed out');
    return { rows: [ctx.remoteRow] };
  }, api: body => acknowledgement({ ...body.payload.patch, suspend_tag_status: 'pending' }) });
  const action = button();
  Object.assign(h.ctx, {
    activeItem: h.mirror,
    document: { getElementById: () => action },
    getDockSuspendDcRequestFormValues: () => ({ spec: 'captured spec', caliper: '2', match: '', avNote: 'note' }),
    getPendingPhotoUploadsForItem: () => [photo], syncDockSuspendDcRequestPhotoAliases() {},
    buildDockSuspendDcRequestNote: () => 'captured comment',
  });
  vm.runInContext(between('async function saveDockSuspendDcRequestMirrorData(', 'function getDockSuspendDcRequestHandledConfirmMessage('), h.ctx);
  const pending = h.ctx.saveDockSuspendDcRequestMirrorData(false, h.mirror);
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 0);
  h.row.DOCK_PHOTO_LINK = 'old.jpg,new.jpg'; h.row.DOCK_PHOTO_NAME = 'old,new';
  h.ctx.remoteRow.dock_photo_link = h.row.DOCK_PHOTO_LINK; h.ctx.remoteRow.dock_photo_name = h.row.DOCK_PHOTO_NAME;
  finishPhoto(); await pending;
  assert.match(h.toasts[0][1], /timed out/);
  assert.equal(h.calls.filter(call => call.name === 'save').length, 0);
  failRead = false;
  await h.ctx.saveDockSuspendDcRequestMirrorData(false, h.mirror);
  const saved = h.calls.find(call => call.name === 'save').body.payload.patch;
  assert.equal(saved.dock_spec, 'captured spec');
  assert.equal(saved.dock_caliper, '2');
  assert.equal(saved.dock_note, 'captured comment');
  assert.equal(saved.dock_photo_link, 'old.jpg,new.jpg');
  assert.ok(h.toasts.some(([title]) => title === 'Saved'));
  assert.ok(!h.toasts.some(([title]) => title === 'Checking for updates'));
});

test('Done saves the exact source revision before marking retained rows completed; retains the source', async () => {
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
  assert.equal(h.calls[0].name, 'complete');
  assert.equal(h.calls[0].body.payload.sourceUid, 'soc-1');
  assert.equal(h.calls[0].body.payload.expectedLastUpdated, revision);
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, button());
  assert.equal(h.calls.length, 1);
  resolve(acknowledgement());
  await pending;
  assert.equal(h.row.DATE_COMPLETED, acknowledgement().row.date_completed);
  assert.equal(h.row.PTRONHAND, '0');
  assert.equal(h.ctx.isAcknowledgedDockSuspendCompletion(source()), true);
});

test('unverified Suspend Tag view never starts a completion write', async () => {
  const h = harness({ proof: false });
  const action = button();
  await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
  assert.equal(h.calls.length, 0);
  assert.equal(h.row.DATE_COMPLETED, '');
  assert.equal(action.disabled, false);
  assert.ok(h.toasts.length === 0);
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
  assert.equal(next.calls[0].body.commandId, h.calls[0].body.commandId);
  assert.equal(next.row.DATE_COMPLETED, acknowledgement().row.date_completed);
});

test('malformed acknowledgements never hide the row or claim success', async () => {
  for (const result of [null, {}, acknowledgement({ unique_id: 'other' }), acknowledgement({ last_updated: null }), acknowledgement({ date_completed: 'invalid' }), acknowledgement({ suspend_tag_version: undefined })]) {
    const h = harness({ api: () => result });
    const action = button();
    await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID, action);
    assert.equal(h.row.DATE_COMPLETED, '');
    assert.equal(h.ctx.isAcknowledgedDockSuspendCompletion(h.row), false);
    assert.equal(action.disabled, false);
    assert.ok(!h.toasts.some(([title]) => title === 'Marked Done'));
  }
});

test('receipts preserve completed state across stale snapshots without hiding rows', async () => {
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
  assert.equal(h.calls[0].body.payload.expectedLastUpdated, revision);
  assert.equal(h.ctx.currentSource.DATE_COMPLETED, '');
  assert.ok(h.toasts.some(([, message]) => message.includes('Refresh')));
});

test('recount completion shares the protected persistence path', async () => {
  const h = harness();
  await h.ctx.markDockSuspendDcRequestCompleteAfterRecount(h.mirror.UNIQUE_ID);
  assert.equal(h.calls[0].name, 'complete');
  assert.equal(h.row.DATE_COMPLETED, acknowledgement().row.date_completed);
});

 test('incomplete cards cannot bypass detail photo validation', async () => { const h=harness({ready:false}); await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID,button()); assert.equal(h.calls.length,0); assert.equal(h.row.DATE_COMPLETED,''); });
test('new denial state supersedes a cached completion without dropping photos', async () => { const h=harness(); await h.ctx.completeDockSuspendDcRequestFromCard(h.mirror.UNIQUE_ID,button()); const denied={...source(),suspend_tag_status:'denied',suspend_tag_version:2,DOCK_PHOTO_LINK:'saved.jpg'}; assert.equal(h.ctx.getSuspendTagStatus(denied),'denied'); assert.equal(h.ctx.overlaySuspendTagReceipt(denied).DOCK_PHOTO_LINK,'saved.jpg'); });

test('queued evidence saves use the latest version and retain photos and the newest unsaved draft', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  let writes = 0;
  const h = harness({ api: async body => {
    writes += 1;
    if (writes === 1) await wait;
    return acknowledgement({ ...body.payload.patch, suspend_tag_status: 'pending', suspend_tag_version: writes });
  } });
  let reconciled = 0;
  h.ctx.queueSuspendTagInventoryReconciliation = () => { reconciled += 1; };
  h.ctx.draftRow = h.mirror;
  vm.runInContext("suspendTagFormDrafts.set(getSuspendTagFormDraftKey(draftRow), { 'req-spec': 'still typing' });", h.ctx);
  const first = h.ctx.runSuspendTagRowCommand('save', h.mirror, { dock_spec: 'first', dock_photo_link: 'new.jpg', dock_photo_name: 'new.jpg' });
  const second = h.ctx.runSuspendTagRowCommand('save', h.mirror, { dock_spec: 'second', dock_photo_link: '', dock_photo_name: '' });
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 1);
  release();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(h.calls.map(call => call.body.expectedVersion), [0, 1]);
  assert.equal(h.calls[1].body.payload.patch.dock_photo_link, 'new.jpg');
  assert.equal(h.mirror.REQ_SPEC, 'second');
  assert.equal(h.mirror.REQ_PHOTO_LINK, 'new.jpg');
  assert.equal(vm.runInContext("suspendTagFormDrafts.get(getSuspendTagFormDraftKey(draftRow))['req-spec']", h.ctx), 'still typing');
  assert.equal(reconciled, 2);
});
