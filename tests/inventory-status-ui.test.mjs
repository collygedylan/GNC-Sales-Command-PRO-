import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: inventory
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const built = buildSync({ entryPoints: ['services/inventoryStatusSync.ts'], bundle: true, platform: 'node',
  format: 'cjs', external: ['swr'], write: false, logLevel: 'silent' });
const serviceModule = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(require, serviceModule, serviceModule.exports);
const { createInventoryStatusSync } = serviceModule.exports;
const html = readComposedAppSource();
const helperStart = html.indexOf('let inventoryStatusSync = null;');
const helperEnd = html.indexOf('async function postArgosInventoryTransactionPayload(payload)', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'inventory status UI helper cluster should exist');
const helperSource = html.slice(helperStart, helperEnd);

const pair = { itemcode: 'SKU.01', locationcode: 'A.01.001' };
const row = (unique_id, fields = {}) => ({ UNIQUE_ID: unique_id, ITEMCODE: pair.itemcode, LOCATIONCODE: pair.locationcode,
  PRIORITY: '', HOLDSTOPCODE: '', HOLDSTOPREASON: '', last_updated: '2026-10-13T10:00:00Z', ...fields });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const harnesses = [];
test.afterEach(() => { for (const h of harnesses.splice(0)) { h.api.pending.forEach(entry => clearTimeout(entry.timer)); h.api.getSync()?.reset(); h.dom.window.close(); } });

function harness({ rows = [row('row-a')], readPair, toastTitle = 'Inquiry Queued' } = {}) {
  const dom = new JSDOM(`<main id="main-scroll-area"><div data-dom-id="card"></div></main><aside id="toast-notification"><span class="toast-title">${toastTitle}</span></aside>`, { pretendToBeVisual: true });
  const canonicalRows = rows;
  const cache = new Map();
  const mutateCalls = [];
  const changes = { paints: 0, dismissed: [], applied: [], persisted: 0, toasts: [], queued: [], readCalls: [], errors: [] };
  let scope = 'profile-a';
  let identity = 'profile-a';
  const mutate = async (key, data, options = {}) => {
    mutateCalls.push({ key, data, options });
    cache.set(key, typeof data === 'function' ? await data(cache.get(key)) : data);
    return cache.get(key);
  };
  const createSync = options => createInventoryStatusSync({ ...options, mutate });
  const context = vm.createContext({
    window: { GncDatabase: { createInventoryStatusSync: createSync, driveEvidenceRevision: value => Date.parse(value || '') || 0, driveEvidenceColumns: ['last_updated'] } },
    canonicalRows, cache, changes,
    setScope: value => { scope = value; }, setIdentity: value => { identity = value; },
    fullInventory: canonicalRows,
    managerSeasonPriorityState: { rows: [] },
    confirmedArgosReclassLiveEditRevisions: new Map(),
    getItemInquiryItemCode: value => String(value.ITEMCODE ?? value.itemcode ?? '').toUpperCase(),
    document: dom.window.document,
    navigator: { onLine: true },
    nativeAuthProfile: { id: 'profile-a' },
    getSupabaseReadIdentityScope: () => scope,
    getArgosReclassLiveEditIdentityKey: () => identity,
    RECLASS_ACTION_WORKFLOW_V6_POLICY_VERSION: 'v6',
    RECLASS_ACTION_WORKFLOW_V7_POLICY_VERSION: 'v7',
    argosInventoryTransactionState: { inquiryModel: { locationRows: canonicalRows.map(sourceRow => ({ unique_id: sourceRow.UNIQUE_ID, sourceRow })) } },
    findItemByUniqueId: uid => canonicalRows.find(candidate => candidate.UNIQUE_ID === uid) || null,
    getArgosReclassHoldTargetEntries: (_action, sourceUid) => canonicalRows.filter(candidate => [sourceUid, 'row-b'].includes(candidate.UNIQUE_ID))
      .map(sourceRow => ({ unique_id: sourceRow.UNIQUE_ID, sourceRow })),
    requestInventoryRead: async (operation, params, { signal } = {}) => {
      changes.readCalls.push({ operation, params, signal });
      return readPair ? await readPair(operation, params, signal) : { rows: [row('row-a')], hasMore: false, inventoryRevision: '7' };
    },
    validateInventoryReadProjection: (page, expected) => assert.equal(page.projection || expected.projection, expected.projection),
    isConfirmedInventoryReadRevisionCurrent: revision => String(revision) === '7',
    applyArgosInventoryTransactionReturnedRow: raw => {
      changes.applied.push(raw);
      const id = raw.unique_id || raw.UNIQUE_ID;
      const index = canonicalRows.findIndex(candidate => candidate.UNIQUE_ID === id);
      if (index >= 0) canonicalRows[index] = { ...canonicalRows[index], ...raw };
    },
    persistCurrentCache: () => { changes.persisted++; },
    scheduleDeferredCardPhotoHydration: root => { (changes.photoRoots ||= []).push(root); },
    paintInventoryStatusCards: () => { changes.paints++; },
    inventoryStatusCardSignature: value => JSON.stringify(['priority', 'holdstopcode', 'holdstopreason', 'last_updated'].map(key => value[key.toUpperCase()] ?? value[key] ?? '')),
    generateCard: (value) => {
      const shown = context.getInventoryStatusSync()?.getDisplayRow(value) || value;
      return `<div data-dom-id="card">${shown.PRIORITY || shown.priority || '—'}</div>`;
    },
    showToast: (...args) => changes.toasts.push(args),
    dismissToast: reason => changes.dismissed.push(reason),
    rememberQueuedReclassDelivery: (...args) => changes.queued.push(args),
    getCurrentReclassDeliveryActor: () => ({ username: 'user' }),
    pollReclassDeliveryJobs: () => Promise.resolve(),
    applyConfirmedArgosReclassLiveEdits: (...args) => changes.confirmed = args,
    clearTimeout,
    setTimeout,
    Promise,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    Error,
    DOMException,
    console,
  });
  vm.runInContext(`${helperSource}\nthis.harness = {
    getSync: getInventoryStatusSync, buildPatches: buildInventoryStatusPatches,
    run: runInventoryStatusMutation, paint: paintInventoryStatusCards,
    rendered: inventoryStatusRenderedCards, pending: inventoryStatusPendingSaves,
    scope: setScope, identity: setIdentity,
    managerPatches: buildManagerPriorityStatusPatches,
    canonicalRows, cache, changes
  };`, context);
  const result = { context, api: context.harness, dom, cache, mutateCalls, changes, canonicalRows };
  harnesses.push(result);
  return result;
}

test('optimistic display paints before a deferred save while canonical inventory stays unchanged', async () => {
  const h = harness();
  const sync = h.api.getSync();
  sync.seed(h.canonicalRows);
  h.api.rendered.set('card', { uid: 'row-a', row: h.canonicalRows[0], sourceView: 'drive', colorClass: 'status-green', renderMeta: {}, signature: 'old' });
  const payload = { idempotencyToken: 'save-1', workflowPolicyVersion: 'v7' };
  let resolveSave;
  const pendingSave = h.api.run(payload, () => new Promise(resolve => { resolveSave = resolve; }), {
    patches: [{ ...pair, unique_id: 'row-a', priority: '1', holdstopcode: 'H', holdstopreason: 'Review' }],
  });
  await delay(0);
  assert.equal(sync.getDisplayRow(h.canonicalRows[0]).PRIORITY, '1');
  assert.equal(h.canonicalRows[0].PRIORITY, '', 'optimistic values never enter canonical inventory arrays');
  assert.equal(h.dom.window.document.querySelector('#main-scroll-area').textContent, '1');
  assert.deepEqual(h.changes.dismissed, ['inventory-status-save']);
  resolveSave({ ok: true, status: 'saved' });
  await pendingSave;
});

test('targeted remote card replacements register new photos for deferred hydration', () => {
  const h = harness();
  const sync = h.api.getSync();
  sync.seed(h.canonicalRows);
  h.api.rendered.set('card', { uid: 'row-a', row: h.canonicalRows[0], sourceView: 'drive',
    colorClass: 'status-green', renderMeta: {}, signature: 'before-remote-update' });
  h.context.generateCard = () => '<div data-dom-id="card"><img data-deferred-card-photo="1" data-src="https://example.invalid/new.jpg"></div>';
  h.api.paint();
  const replacement = h.dom.window.document.querySelector('[data-dom-id="card"]');
  assert.deepEqual(h.changes.photoRoots, [replacement]);
  assert.ok(replacement.isConnected, 'hydrate the mounted replacement, not the detached template');
});

test('builds Priority and Hold/Stop patches across explicit fanout targets without mutating source rows', () => {
  const h = harness({ rows: [row('row-a', { HOLDSTOPCODE: 'S', HOLDSTOPREASON: 'existing' }), row('row-b')] });
  const before = structuredClone(h.canonicalRows);
  const patches = h.api.buildPatches({
    workflowPolicyVersion: 'v7',
    rowOverlays: [{ unique_id: 'row-a', proposals: [{ action: 'priority_change', priority: '2' }] }],
    transaction: { holdStopProposals: [{ sourceUid: 'row-a', action: 'hold', reason: 'Inspect' }] },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(patches)), [
    { unique_id: 'row-a', itemcode: pair.itemcode, locationcode: pair.locationcode, priority: '2', holdstopcode: 'SH', holdstopreason: 'Inspect' },
    { unique_id: 'row-b', itemcode: pair.itemcode, locationcode: pair.locationcode, holdstopcode: 'H', holdstopreason: 'Inspect' },
  ]);
  assert.deepEqual(h.canonicalRows, before);
});

test('definite save failure rolls back the optimistic display', async () => {
  const h = harness();
  const sync = h.api.getSync();
  sync.seed(h.canonicalRows);
  await assert.rejects(h.api.run({ idempotencyToken: 'fail-1' }, async () => {
    throw Object.assign(new Error('rejected'), { status: 400 });
  }, { patches: [{ ...pair, unique_id: 'row-a', priority: '3' }] }), /rejected/);
  assert.equal(sync.getDisplayRow(h.canonicalRows[0]).PRIORITY, '');
});

test('uncertain save retries with the same idempotency token and clears pending state after confirmation', async () => {
  const h = harness();
  const sync = h.api.getSync();
  sync.seed(h.canonicalRows);
  const sentTokens = [];
  const payload = { idempotencyToken: 'same-token', sourceContext: { sourceMode: 'drive' } };
  const send = async () => {
    sentTokens.push(payload.idempotencyToken);
    if (sentTokens.length === 1) throw Object.assign(new Error('temporary network timeout'), { status: 503 });
    return { ok: true, status: 'saved' };
  };
  await assert.rejects(h.api.run(payload, send, { patches: [{ ...pair, unique_id: 'row-a', priority: '4' }] }), error => error.inventoryStatusPending === true);
  const entry = h.api.pending.get('same-token');
  assert.ok(entry);
  await entry.run();
  await delay(10);
  assert.deepEqual(sentTokens, ['same-token', 'same-token']);
  assert.equal(h.api.pending.has('same-token'), false);
  assert.equal(h.changes.toasts.at(-1)?.[0], 'Changes Saved');
});

test('pair refresh pages the public master lookup and rejects a revision change', async () => {
  const requests = [];
  let currentRevision = '7';
  const h = harness({ readPair: async (operation, params, signal) => {
    requests.push({ operation, params, signal });
    return { rows: [row(`row-${params.offset}`)], hasMore: params.offset === 0, inventoryRevision: requests.length === 1 ? '7' : currentRevision };
  } });
  const sync = h.api.getSync();
  await sync.revalidate(pair);
  assert.deepEqual(requests.map(request => [request.operation, request.params.dataset, request.params.projection,
    request.params.itemCode, request.params.locationCode, request.params.offset]), [
    ['master_page', 'lookup', 'full', pair.itemcode, pair.locationcode, 0],
    ['master_page', 'lookup', 'full', pair.itemcode, pair.locationcode, 1],
  ]);
  requests.length = 0;
  currentRevision = '8';
  await sync.revalidate(pair);
  assert.equal(h.changes.applied.length, 2, 'only the consistent first read reaches confirmed canonical rows');
});

test('logout reset prevents a late save response from applying or painting into the new session', async () => {
  const h = harness();
  const sync = h.api.getSync();
  sync.seed(h.canonicalRows);
  let resolveSave;
  const pendingSave = h.api.run({ idempotencyToken: 'logout-save' }, () => new Promise(resolve => { resolveSave = resolve; }), {
    patches: [{ ...pair, unique_id: 'row-a', priority: '9' }],
  });
  await delay(0);
  h.api.identity('profile-b');
  h.api.scope('profile-b');
  sync.reset();
  const paintsAfterReset = h.changes.paints;
  resolveSave({ ok: true, liveEdits: [{ unique_id: 'row-a', priority: '9' }] });
  await pendingSave;
  await delay(0);
  assert.equal(h.changes.confirmed, undefined);
  assert.equal(h.changes.paints, paintsAfterReset);
  assert.equal(h.canonicalRows[0].PRIORITY, '');
});

test('status refresh clears only the stale Inquiry Queued toast', async () => {
  const h = harness({ toastTitle: 'Email Sent' });
  await h.api.run({ idempotencyToken: 'toast-scope' }, async () => ({ ok: true }), {
    patches: [{ ...pair, unique_id: 'row-a', priority: '1' }],
  });
  assert.deepEqual(h.changes.dismissed, []);
});

for (const [name, proposal, expected] of [
  ['priority removal', { action: 'priority_change', priority: '' }, { PRIORITY: '' }],
  ['reason change', { action: 'hold', reason: 'New reason', sourceUid: 'row-a' }, { HOLDSTOPCODE: 'H', HOLDSTOPREASON: 'New reason' }],
  ['Hold clear', { action: 'take_off_hold', sourceUid: 'row-a' }, { HOLDSTOPCODE: '', HOLDSTOPREASON: '' }],
]) test(`${name} is visible before the save resolves, without modifying the draft or scroll`, async () => {
  const h = harness({ rows: [row('row-a', { PRIORITY: '3', HOLDSTOPCODE: 'H', HOLDSTOPREASON: 'Old reason' })] });
  const doc = h.dom.window.document;
  doc.body.insertAdjacentHTML('beforeend', '<input id="draft" value="open draft">');
  const draft = doc.getElementById('draft'); draft.focus(); draft.setSelectionRange(2, 5);
  doc.getElementById('main-scroll-area').scrollTop = 81;
  const payload = { idempotencyToken: name, workflowPolicyVersion: 'v7',
    rowOverlays: [{ unique_id: 'row-a', proposals: proposal.action === 'priority_change' ? [proposal] : [] }],
    transaction: { holdStopProposals: proposal.action === 'priority_change' ? [] : [proposal] } };
  let resolve;
  const saving = h.api.run(payload, () => new Promise(done => { resolve = done; }));
  const displayed = h.api.getSync().getDisplayRow(h.canonicalRows[0]);
  for (const [field, value] of Object.entries(expected)) assert.equal(displayed[field], value);
  assert.equal(h.canonicalRows[0].PRIORITY, '3');
  assert.equal(h.canonicalRows[0].HOLDSTOPREASON, 'Old reason');
  assert.equal(doc.activeElement, draft);
  assert.equal(draft.selectionStart, 2); assert.equal(draft.selectionEnd, 5);
  assert.equal(doc.getElementById('main-scroll-area').scrollTop, 81);
  resolve({ ok: true }); await saving;
});

test('Manager save optimistically rotates loaded lots and locations through the shared pending handler', async () => {
  const h = harness({ rows: [row('row-a', { PRIORITY: '3' }), row('row-b', { PRIORITY: '1', LOCATIONCODE: 'B.01.001' }), row('row-c', { PRIORITY: '2', LOTCODE: '25.F1' })] });
  const state = { rows: [{ sourceUid: 'row-a', ...pair, priority: '3', scopeFingerprint: 'scope' }],
    requests: [], account: 'user', tokens: new Map(), pending: new Set(), pageEnabled: false };
  let resolve;
  Object.assign(h.context, {
    managerSeasonPriorityState: state, currentUser: 'user',
    canViewManagerSeasonPriority: () => true, getManagerSeasonPriorityState: () => state,
    normalizeSessionIdentity: value => value, getManagerSeasonPriorityRequest: () => null,
    scheduleManagersRender: () => {}, generateArgosInventoryTransactionId: () => 'manager-token',
    driveReclassApi: (_op, request) => { assert.equal(request.idempotencyToken, 'manager-token'); return new Promise(done => { resolve = done; }); },
    applyConfirmedArgosReclassLiveEdits: () => ({ applied: 1 }),
    isManagerSeasonPriorityVisible: () => false,
  });
  const start = html.indexOf('async function submitManagerSeasonPriority(');
  const end = html.indexOf('function renderManagerSeasonPriorityPanel()', start);
  vm.runInContext(html.slice(start, end), h.context);
  const saving = h.context.submitManagerSeasonPriority('row-a');
  assert.deepEqual(h.canonicalRows.map(source => h.api.getSync().getDisplayRow(source).PRIORITY), ['1', '2', '3']);
  assert.deepEqual(h.canonicalRows.map(source => source.PRIORITY), ['3', '1', '2']);
  resolve({ ok: true, eventId: 'event' }); await saving;
  assert.equal(state.tokens.size, 0);
});

test('Eval passes the immutable submission token and request-only payloads remain unchanged', async () => {
  const h = harness();
  let sent;
  const requestOnly = { workflowPolicyVersion: 'v7', submissionToken: 'eval-token', transaction: { requestActions: ['quantity_change'] } };
  await h.api.run(requestOnly, async () => { sent = requestOnly; return { ok: true }; });
  assert.equal(sent, requestOnly);
  assert.equal(h.mutateCalls.length, 0);
  const start = html.indexOf("const submissionToken = `eval-submit-");
  const end = html.indexOf('if (!submitIdentityIsCurrent())', start);
  const submit = html.slice(start, end);
  assert.match(submit, /runInventoryStatusMutation\(\{ \.\.\.inquiry, submissionToken \}/);
  assert.match(submit, /idempotencyKey: submissionToken/);
  assert.match(submit, /recovered: \(\) => \{ void loadEvalWorkAssignments\(true\)/);
});

test('validated receipts fetch unloaded locations and preserve confirmed evidence', async () => {
  const h = harness();
  const edit = { unique_id: 'unloaded', last_updated: '2026-10-13T12:00:00Z', evidence: { itemcode: pair.itemcode, locationcode: 'B.01.001' } };
  h.context.window.GncDatabase.confirmedReclassLiveEditsFromResult = () => ({ liveEdits: [edit] });
  await h.api.run({ idempotencyToken: 'receipt-save' }, async () => ({ ok: true, liveEdits: [edit] }), { patches: [{ ...pair, unique_id: 'row-a', priority: '1' }] });
  await delay(0);
  assert.ok(h.changes.readCalls.some(call => call.params.locationCode === 'B.01.001'));
  assert.ok(h.changes.confirmed, 'validated server reconciliation runs before pair refresh');
});

test('production subscription authenticates one inventory UPDATE listener and removes it on cleanup', () => {
  const start = html.indexOf('subscribe: (changed, reconnected) => {');
  const end = html.indexOf('\n                }', start);
  const source = html.slice(start + 'subscribe: '.length, end + '\n                }'.length);
  const handlers = [], readiness = [], changed = [], status = { resumes: 0, suspends: 0, events: 0, removals: 0 };
  let scope = 'first', subscribed;
  const channel = { on: (_kind, filter, handler) => { handlers.push({ filter, handler }); return channel; },
    subscribe: handler => { subscribed = handler; return channel; } };
  const context = vm.createContext({
    nativeAuthProfile: { id: 'first' }, getProductionRealtimeOwnerKey: () => scope,
    document: { hidden: false },
    getSupabaseBrowserClient: () => ({ channel: () => channel, removeChannel: async () => { status.removals++; } }),
    getInventoryStatusSync: () => ({ setSourceReady: ready => readiness.push(ready), handleUpdate: () => { status.events++; }, resume: () => { status.resumes++; }, suspend: () => { status.suspends++; } }),
  });
  const subscribe = vm.runInContext(`(${source})`, context);
  const cleanup = subscribe(payload => changed.push(payload), () => {});
  const master = handlers.filter(entry => entry.filter.table === 'ph_master_inventory');
  assert.equal(master.length, 1); assert.equal(master[0].filter.event, 'UPDATE');
  subscribed('SUBSCRIBED'); master[0].handler({ new: pair });
  assert.equal(status.resumes, 1); assert.equal(status.events, 1);
  const metadata = handlers.find(entry => entry.filter.table === 'app_dataset_revisions');
  for (const state of ['importing', 'interrupted', 'ready']) metadata.handler({ new: { key: 'ph_master_inventory', state } });
  assert.deepEqual(readiness, [false, false, false, true]);
  assert.equal(changed.length, 3, 'metadata also retains normal cohort reconciliation');
  scope = 'second'; master[0].handler({ new: pair }); subscribed('SUBSCRIBED');
  metadata.handler({ new: { key: 'ph_master_inventory', state: 'importing' } });
  assert.equal(readiness.length, 4, 'old-session metadata cannot gate the new session');
  assert.equal(status.resumes, 1); assert.equal(status.events, 1);
  cleanup();
  assert.equal(status.suspends, 1); assert.equal(status.removals, 1);
});
