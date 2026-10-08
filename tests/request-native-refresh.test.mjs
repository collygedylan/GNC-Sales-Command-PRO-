// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(source, name, stopAt) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists in shell`);
  const end = source.indexOf(stopAt, start);
  assert.ok(end > start, `${name} boundary`);
  return source.slice(start, end);
}

function requestAdapter() {
  return { id: 'core:requests', sourceKeys: ['ph_active_request'], cacheKey: 'request-cache-v1' };
}

function requestContext({ surfaces = ['request:pending'], adapters = [requestAdapter()], ...overrides } = {}) {
  return {
    view: 'request', viewKey: 'request:pending:1', surfaces, adapters, visible: true, online: true,
    scope: 'profile:dylan', dataPermissionVersion: 'permission-v4',
    ...overrides
  };
}

function fixture({ native = true, context = requestContext(), ensureResult = true,
  ensureError = null, onEnsure = null, terminal = false, lastForceAt = 0 } = {}) {
  const calls = { ensure: [], fetch: [], process: [], sideRefresh: [], failures: [], clears: [], dirty: [],
    reconcile: [], badges: 0, persisted: [] };
  const state = {};
  const coordinator = {
    async ensure(...args) {
      calls.ensure.push(args);
      if (onEnsure) onEnsure();
      if (ensureError) throw ensureError;
      return ensureResult;
    }
  };
  const ctx = {
    ACTIVE_REQUEST_TABLE: 'ph_active_request',
    REQUEST_VIEW_FORCE_REFRESH_MIN_INTERVAL_MS: 1000,
    REQUEST_QUEUE_SIDE_REFRESH_MIN_INTERVAL_MS: 2000,
    currentUser: 'dylan',
    currentRole: 'ADMIN',
    activeReqTab: context.surfaces.includes('request:bunch-notes') ? 'bunch-notes' : 'pending',
    navigator: { onLine: true },
    productionLiveSyncCoordinator: native ? coordinator : null,
    canUseProductionLiveSync: () => native,
    getProductionLiveSyncContext: () => ({ ...context }),
    getProductionLiveSyncCoordinator: () => coordinator,
    isRequestViewReadTerminalForCurrentIdentity: () => terminal,
    clearSupabaseReadTerminalDenialsForIdentity() { calls.clears.push('terminal'); },
    requestViewTerminalReadIdentityScope: 'terminal-scope',
    clearRequestViewReadFailure() { calls.clears.push('read-failure'); },
    shouldPauseManualSyncViewRefresh: () => false,
    requestViewForceRefreshInFlight: false,
    requestViewReadCooldownRemaining: () => 0,
    shouldDeferInteractiveBackgroundWork: () => false,
    lastRequestViewForceRefreshAt: lastForceAt,
    requestViewRetryAttempts: 3,
    requestViewForceRefreshRetryTimer: null,
    requestViewInteractiveRefreshTimer: null,
    requestViewLiveSyncSignature: 'old-signature',
    requestsInventory: [],
    fetchActiveRequestLiveRows: async (...args) => { calls.fetch.push(args); return [{ unique_id: 'legacy-row' }]; },
    formatFetchedRows: rows => rows,
    processAndLoadData: payload => calls.process.push(payload),
    refreshActiveRequestQueueSideData: async (...args) => { calls.sideRefresh.push(args); return false; },
    getDatasetState: () => state,
    buildRequestLiveSyncSignature: () => 'new-signature',
    updateFooterRequestBadge: () => { calls.badges++; },
    schedulePendingRequestSourceCompletionReconcile: (...args) => calls.reconcile.push(args),
    markViewDirty: (...args) => calls.dirty.push(args),
    isViewVisible: () => false,
    persistCurrentCache: (...args) => calls.persisted.push(args),
    recordRequestViewReadFailure: error => calls.failures.push(error),
    calls
  };
  vm.createContext(ctx);
  const helper = extractFunction(html, 'getNativeForegroundRequestRefreshAdapter', 'async function forceRefreshRequestsForView(');
  const forceRefresh = extractFunction(html, 'forceRefreshRequestsForView', 'function syncRequestViewLiveSync(');
  vm.runInContext(`${helper}\n${forceRefresh}`, ctx);
  return { ctx, calls, state, adapter: requestAdapter() };
}

test('native request refresh helper accepts only an authorized foreground request-source adapter', () => {
  const valid = fixture();
  assert.deepEqual(valid.ctx.getNativeForegroundRequestRefreshAdapter(), valid.adapter);

  const invalidContexts = [
    requestContext({ surfaces: ['request:bunch-notes'] }),
    requestContext({ adapters: [] }),
    requestContext({ adapters: [{ id: 'core:requests', sourceKeys: ['ph_request_history'] }] }),
    requestContext({ adapters: [{ id: 'side:requests', sourceKeys: ['ph_active_request'] }] }),
    requestContext({ scope: '' }),
    requestContext({ dataPermissionVersion: '' }),
    requestContext({ visible: false }),
    requestContext({ online: false })
  ];
  for (const context of invalidContexts) {
    const f = fixture({ context });
    assert.equal(f.ctx.getNativeForegroundRequestRefreshAdapter(), null);
  }
  assert.equal(fixture({ native: false }).ctx.getNativeForegroundRequestRefreshAdapter(), null);
  assert.equal(fixture({ context: requestContext(), native: true, ensureResult: true }).ctx.getNativeForegroundRequestRefreshAdapter().id, 'core:requests');
});

test('authorized native refresh delegates with the requested force mode and retains queue-side refresh', async () => {
  for (const options of [
    { options: {}, expectedForce: false },
    { options: { force: true }, expectedForce: true },
    { options: { manualRetry: true }, expectedForce: true }
  ]) {
    const f = fixture();
    assert.equal(await f.ctx.forceRefreshRequestsForView('request-switch', options.options), true);
    assert.equal(f.calls.ensure.length, 1);
    assert.equal(f.calls.ensure[0][0].id, 'core:requests');
    assert.equal(f.calls.ensure[0][1], options.expectedForce);
    assert.equal(f.calls.fetch.length, 0, 'native refresh must not issue the legacy fetch');
    assert.equal(f.calls.process.length, 0, 'native snapshot commit owns request state updates');
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.sideRefresh)), [[
      'request-switch', { force: options.options.force === true, allowWhileInteractive: true, minIntervalMs: 2000 }
    ]]);
    assert.equal(f.ctx.requestViewForceRefreshInFlight, false);
  }
});

test('native ensure false or failure never falls back to a legacy request read', async () => {
  const declined = fixture({ ensureResult: false });
  assert.equal(await declined.ctx.forceRefreshRequestsForView('request-switch', { force: true }), false);
  assert.equal(declined.calls.ensure.length, 1);
  assert.equal(declined.calls.fetch.length, 0);
  assert.equal(declined.calls.process.length, 0);
  assert.equal(declined.ctx.requestViewForceRefreshInFlight, false);

  const failure = new Error('verified native snapshot unavailable');
  const rejected = fixture({ ensureError: failure });
  assert.equal(await rejected.ctx.forceRefreshRequestsForView('request-switch'), false);
  assert.equal(rejected.calls.fetch.length, 0);
  assert.equal(rejected.calls.process.length, 0);
  assert.equal(rejected.calls.failures[0], failure);
  assert.equal(rejected.ctx.requestViewForceRefreshInFlight, false);
});

test('a lost native owner after ensure returns false without a legacy fetch', async () => {
  const context = requestContext();
  const f = fixture({ context, onEnsure: () => { context.visible = false; } });
  assert.equal(await f.ctx.forceRefreshRequestsForView('request-switch'), false);
  assert.equal(f.calls.ensure.length, 1);
  assert.equal(f.calls.fetch.length, 0);
  assert.equal(f.calls.process.length, 0);
  assert.equal(f.calls.sideRefresh.length, 0);
  assert.equal(f.ctx.requestViewForceRefreshInFlight, false);
});

test('a changed Request surface after ensure does not refresh the new tab side data', async () => {
  const context = requestContext();
  const f = fixture({ context, onEnsure: () => { context.viewKey = 'request:reps:2'; } });
  assert.equal(await f.ctx.forceRefreshRequestsForView('request-switch'), false);
  assert.equal(f.calls.fetch.length, 0);
  assert.equal(f.calls.process.length, 0);
  assert.equal(f.calls.sideRefresh.length, 0);
  assert.equal(f.ctx.requestViewForceRefreshInFlight, false);
});

test('terminal, offline, cooldown, in-flight, and interval guards run before native ensure', async () => {
  const cases = [
    { terminal: true, options: {} },
    { offline: true, options: {} },
    { cooldown: true, options: {} },
    { inFlight: true, options: {} },
    { lastForceAt: Date.now(), options: { force: false } }
  ];
  for (const item of cases) {
    const f = fixture({ terminal: item.terminal || false, lastForceAt: item.lastForceAt || 0 });
    if (item.offline) f.ctx.navigator.onLine = false;
    if (item.cooldown) f.ctx.requestViewReadCooldownRemaining = () => 500;
    if (item.inFlight) f.ctx.requestViewForceRefreshInFlight = true;
    assert.equal(await f.ctx.forceRefreshRequestsForView('request-switch', item.options), false);
    assert.equal(f.calls.ensure.length, 0);
    assert.equal(f.calls.fetch.length, 0);
  }

  const manual = fixture({ terminal: true });
  assert.equal(await manual.ctx.forceRefreshRequestsForView('manual-retry', { manualRetry: true }), true);
  assert.equal(manual.calls.ensure[0][1], true);
  assert.deepEqual(manual.calls.clears, ['terminal', 'read-failure']);
});

test('Bunch Notes and non-native contexts retain legacy request refresh behavior', async () => {
  for (const f of [
    fixture({ context: requestContext({ surfaces: ['request:bunch-notes'] }) }),
    fixture({ native: false })
  ]) {
    assert.equal(await f.ctx.forceRefreshRequestsForView('request-switch', { force: true }), true);
    assert.equal(f.calls.ensure.length, 0);
    assert.equal(f.calls.fetch.length, 1);
    assert.equal(f.calls.process.length, 1);
    assert.equal(f.calls.process[0].requestsData[0].unique_id, 'legacy-row');
    assert.equal(f.ctx.requestViewForceRefreshInFlight, false);
  }
});

function wakeFixture({ native = true } = {}) {
  const calls = { signal: [], subscriptions: [], force: [], liveSync: [], alwaysOn: [], renders: [] };
  const ctx = {
    REQUEST_VIEW_VISIBLE_FORCE_REFRESH_MIN_INTERVAL_MS: 1000,
    REQUEST_VIEW_ACTIVE_SIGNATURE_SYNC_MS: 3000,
    REQUEST_VIEW_SIGNATURE_SYNC_MIN_INTERVAL_MS: 4000,
    REQUEST_REALTIME_UI_DELAY_MS: 25,
    lastRequestLiveWakeAt: 0,
    canWakeRequestQueueLiveData: () => true,
    getNativeForegroundRequestRefreshAdapter: () => native ? requestAdapter() : null,
    signalProductionLiveSync: (...args) => calls.signal.push(args),
    isPrimaryRequestLiveSyncContextVisible: () => true,
    setRealtimeSubscriptionsForView: (...args) => calls.subscriptions.push(args),
    forceRefreshRequestsForView: (...args) => { calls.force.push(args); return Promise.resolve(true); },
    runRequestViewLiveSync: (...args) => { calls.liveSync.push(args); return Promise.resolve(true); },
    syncAlwaysOnRequestData: (...args) => calls.alwaysOn.push(args),
    isViewVisible: () => true,
    scheduleRequestRender: (...args) => calls.renders.push(args),
    calls
  };
  vm.createContext(ctx);
  const wake = extractFunction(html, 'wakeRequestQueueLiveData', 'function scheduleRequestNavigationLiveWake(');
  vm.runInContext(wake, ctx);
  return { ctx, calls };
}

test('native request wake signals the coordinator without legacy fetch, timer, subscription, or render work', () => {
  const f = wakeFixture();
  assert.equal(f.ctx.wakeRequestQueueLiveData('request-navigation', {
    force: true, subscribeVisible: true, renderDelayMs: 50
  }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.signal)), [['view-entry', 0]]);
  assert.equal(f.calls.subscriptions.length, 0);
  assert.equal(f.calls.force.length, 0);
  assert.equal(f.calls.liveSync.length, 0);
  assert.equal(f.calls.alwaysOn.length, 0);
  assert.equal(f.calls.renders.length, 0);
});

test('legacy request wake retains its subscription, refresh, periodic sync, and render sequence', async () => {
  const f = wakeFixture({ native: false });
  assert.equal(f.ctx.wakeRequestQueueLiveData('request-navigation', {
    subscribeVisible: true, renderDelayMs: 50
  }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.subscriptions)), [['request', true]]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.force)), [[
    'request-navigation', { force: true, allowWhileInteractive: true, minIntervalMs: 0 }
  ]]);
  assert.equal(f.calls.alwaysOn.length, 1);
  assert.equal(f.calls.renders.length, 1);
  assert.equal(f.calls.liveSync.length, 0);
  await Promise.resolve();
});

function productionListFixture({ key = 'request-main', tab = 'pending', signature = 'same', rowCount = 2 } = {}) {
  const calls = { crumb: [], complete: 0, staged: [], created: 0, classes: [] };
  const container = {
    querySelectorAll: selector => ({ length: selector === '[data-request-uid]' ? rowCount : 0 }),
    classList: { add: value => calls.classes.push(value) },
    isConnected: true
  };
  const refresh = { pending: 0, containers: new Set() };
  const ctx = {
    productionLiveSyncActiveRender: refresh,
    activeReqTab: tab,
    document: { createElement: () => { calls.created++; return { childNodes: [] }; } },
    normalizeRenderSignature: value => String(value).trim(),
    getContainerRenderSignature: () => signature,
    syncRequestCrumb: (...args) => calls.crumb.push(args),
    renderMarkupChunkedByKey: (...args) => { calls.staged.push(args); return 'staged'; },
    calls
  };
  vm.createContext(ctx);
  const source = extractFunction(html, 'stageProductionRefreshList', 'function cancelProductionRefresh(');
  vm.runInContext(source, ctx);
  return { ctx, calls, container, refresh, key };
}

test('completed pending request list reuses matching rendered rows and completes the refresh', () => {
  const f = productionListFixture();
  const completed = () => { f.calls.complete++; };
  const rows = [{ id: 'a' }, { id: 'b' }];
  assert.equal(f.ctx.stageProductionRefreshList('request-main', f.container, {}, rows, 'Pending', () => '', {
    renderSignature: 'same', onComplete: completed
  }), true);
  assert.equal(f.calls.created, 0);
  assert.equal(f.calls.staged.length, 0);
  assert.equal(f.calls.complete, 1);
  assert.equal(f.calls.crumb.length, 1);
  assert.equal(f.refresh.pending, 0);
});

test('changed, incomplete, non-pending, and Drive lists still use the staging renderer', () => {
  const cases = [
    { signature: 'changed' },
    { rowCount: 1 },
    { tab: 'completed' },
    { key: 'drive:name:list' }
  ];
  for (const item of cases) {
    const f = productionListFixture(item);
    const key = item.key || 'request-main';
    const rows = [{ id: 'a' }, { id: 'b' }];
    assert.equal(f.ctx.stageProductionRefreshList(key, f.container, null, rows, 'Rows', () => '', {
      renderSignature: 'same'
    }), 'staged');
    assert.equal(f.calls.created, 1);
    assert.equal(f.calls.staged.length, 1);
    assert.equal(f.refresh.pending, 1);
    assert.equal(f.container.classList ? f.calls.classes.length : 0, 1);
  }
});

function footerContainer() {
  const calls = { inserted: [], removed: 0 };
  let footer = null;
  const container = {
    querySelector: selector => selector === '.browse-page-footer' ? footer : null,
    insertAdjacentHTML(_position, markup) {
      calls.inserted.push(markup);
      footer = { outerHTML: markup, remove() { calls.removed++; footer = null; } };
    },
    get footer() { return footer; },
    calls
  };
  return container;
}

function footerFixture() {
  const ctx = { WeakMap };
  vm.createContext(ctx);
  const fn = extractFunction(html, 'syncRequestBrowseFooter', 'function renderRequest(');
  vm.runInContext(`const requestBrowseFooterMarkup = new WeakMap();\n${fn}`, ctx);
  return ctx.syncRequestBrowseFooter;
}

test('request browse footer reuses identical HTML despite DOM decoration, replaces changed HTML once, and removes empty HTML', () => {
  const syncFooter = footerFixture();
  const first = footerContainer();
  syncFooter(first, '<footer class="browse-page-footer">Page 1</footer>');
  const originalFooter = first.footer;
  originalFooter.outerHTML = '<footer class="browse-page-footer ops-record-node">Page 1</footer>';
  syncFooter(first, '<footer class="browse-page-footer">Page 1</footer>');
  assert.equal(first.footer, originalFooter, 'unchanged markup keeps the decorated footer node');
  assert.deepEqual(first.calls.inserted, ['<footer class="browse-page-footer">Page 1</footer>']);
  assert.equal(first.calls.removed, 0);

  const changedMarkup = '<footer class="browse-page-footer">Page 2</footer>';
  syncFooter(first, changedMarkup);
  assert.deepEqual(first.calls.inserted, [
    '<footer class="browse-page-footer">Page 1</footer>', changedMarkup
  ]);
  assert.equal(first.calls.removed, 1);
  syncFooter(first, '');
  assert.equal(first.footer, null);
  assert.equal(first.calls.removed, 2);
  assert.equal(first.calls.inserted.length, 2, 'empty markup removes without inserting');

  const second = footerContainer();
  syncFooter(second, changedMarkup);
  assert.equal(second.calls.inserted.length, 1, 'the WeakMap cache is independent per footer node');
  assert.equal(second.calls.removed, 0);
});
