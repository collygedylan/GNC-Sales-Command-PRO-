import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const sandbox = { module: { exports: {} }, setTimeout, clearTimeout, AbortController };
vm.runInNewContext(readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8'), sandbox);
const { createCoordinator } = sandbox.module.exports;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function fixture(cache = new Map(), overrides = {}) {
    const commits = [], statuses = [], backgroundStatuses = [], reads = [], metadata = [], timers = new Map();
    let timerId = 0, permission = 'p1', revision = '1', state = 'ready';
    const gates = new Map();
    const adapter = id => ({ id, cacheKey: `${id}/all`, sourceKeys: [id],
        stage: async () => { reads.push(id); if (gates.has(id)) await gates.get(id); return [{ id, revision }]; },
        commit: value => commits.push({ id, value }) });
    const foreground = adapter('inventory'), background = adapter('badges');
    const context = { scope: 'user-a', viewKey: 'inventory', visible: true, online: true, adapters: [foreground], backgroundAdapters: [background] };
    const coordinator = createCoordinator({ getContext: () => context,
        readRevisions: async keys => { metadata.push([...keys]); return { contractVersion: 1, permissionVersion: permission,
            sources: keys.map(key => ({ key, revision, state })) }; },
        readCachedSnapshot: async (item, meta) => cache.get(`${meta.scope}/${item.id}`),
        writeCachedSnapshot: (item, value, meta) => { cache.set(`${meta.scope}/${item.id}`, structuredClone({ meta, value })); },
        onStatus: value => statuses.push(value), onBackgroundStatus: value => backgroundStatuses.push(value),
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id), ...overrides
    });
    return { coordinator, context, foreground, background, commits, statuses, backgroundStatuses, reads, metadata, cache, gates, adapter, timers,
        set permission(value) { permission = value; }, set revision(value) { revision = value; }, set state(value) { state = value; },
        async backgroundTick() { for (const [id, timer] of [...timers]) if (timer.delay < 30000) { timers.delete(id); timer.callback(); } await settle(); }
    };
}

test('foreground settles without awaiting held background, whose status stays separate', async () => {
    const f = fixture(), gate = deferred(); f.gates.set('badges', gate.promise);
    assert.equal(await f.coordinator.check(), true);
    assert.deepEqual(f.reads, ['inventory']);
    await f.backgroundTick();
    assert.deepEqual(f.reads, ['inventory', 'badges']);
    assert.equal(f.coordinator.getStatus().state, 'Up to date');
    assert.equal(f.coordinator.getBackgroundStatus().state, 'Syncing');
    gate.resolve(); await settle();
    assert.equal(f.coordinator.getBackgroundStatus().state, 'Up to date');
    assert.deepEqual(f.commits.map(value => value.id), ['inventory', 'badges']);
});

test('ensure calls covered by a current cohort share its verification without another pass', async () => {
    const f = fixture(), gate = deferred(); f.gates.set('inventory', gate.promise);
    const first = f.coordinator.check(); await settle();
    const joined = [f.coordinator.ensure(f.foreground), f.coordinator.ensure(f.foreground, true)];
    gate.resolve(); assert.deepEqual(await Promise.all([first, ...joined]), [true, true, true]);
    assert.equal(f.metadata.length, 2); assert.deepEqual(f.reads, ['inventory']);
});

test('navigation and rendering share one proof but a real revision event still rechecks', async () => {
    const f = fixture(), gate = deferred(); f.context.backgroundAdapters = [];
    f.gates.set('inventory', gate.promise);
    f.coordinator.signal('view-entry', 0);
    const first = f.coordinator.check('visible-view'); await settle();
    f.coordinator.signal('view-entry', 0);
    const joined = f.coordinator.check('visible-view');
    gate.resolve(); await Promise.all([first, joined]);
    await f.backgroundTick();
    assert.equal(f.metadata.length, 2); assert.deepEqual(f.reads, ['inventory']);
    assert.equal(f.coordinator.getStatus().contextKey, JSON.stringify(['user-a', 'inventory', [['inventory', 'inventory/all']]]));
    f.revision = '2'; f.coordinator.signal('metadata', 0); await f.backgroundTick();
    assert.deepEqual(f.reads, ['inventory', 'inventory']);
});

test('returning to a verified group checks metadata without downloading or recommitting its rows', async () => {
    const f = fixture(); f.context.backgroundAdapters = [];
    await f.coordinator.check('view-entry');
    f.context.viewKey = 'other'; f.context.adapters = [f.adapter('other')];
    await f.coordinator.check('view-entry');
    const before = f.metadata.length;
    f.context.viewKey = 'inventory'; f.context.adapters = [f.foreground];
    await f.coordinator.check('visible-view');
    assert.equal(f.metadata.length - before, 1);
    assert.deepEqual(f.reads, ['inventory', 'other']);
    assert.deepEqual(f.commits.map(value => value.id), ['inventory', 'other']);
});

test('navigation reprioritizes immediately and discards the old held background', async () => {
    const f = fixture(), gate = deferred(); f.gates.set('badges', gate.promise);
    await f.coordinator.check(); await f.backgroundTick();
    f.context.viewKey = 'orders'; f.context.adapters = [f.adapter('orders')]; f.context.backgroundAdapters = [];
    assert.equal(await f.coordinator.check('navigation'), true);
    assert.deepEqual(f.commits.map(value => value.id), ['inventory', 'orders']);
    gate.resolve(); await settle();
    assert.deepEqual(f.commits.map(value => value.id), ['inventory', 'orders']);
});

test('a reload reuses a complete cached snapshot only after both revision checks', async () => {
    const cache = new Map(), first = fixture(cache); first.context.backgroundAdapters = [];
    await first.coordinator.check(); assert.equal(cache.size, 1);
    const second = fixture(cache); second.context.backgroundAdapters = [];
    assert.equal(await second.coordinator.check(), true);
    assert.equal(second.reads.length, 0); assert.equal(second.metadata.length, 2);
    assert.equal(second.commits.length, 1);
});

for (const mismatch of ['scope', 'permission', 'revision', 'query']) {
    test(`cached snapshots cannot cross a ${mismatch} change`, async () => {
        const cache = new Map(), first = fixture(cache); await first.coordinator.check();
        const next = fixture(cache);
        if (mismatch === 'scope') next.context.scope = 'user-b';
        if (mismatch === 'permission') next.permission = 'p2';
        if (mismatch === 'revision') next.revision = '2';
        if (mismatch === 'query') next.foreground.cacheKey = 'inventory/restricted';
        await next.coordinator.check(); assert.deepEqual(next.reads, ['inventory']);
    });
}

test('importing sources cannot use a previously persisted ready snapshot', async () => {
    const cache = new Map(), first = fixture(cache); await first.coordinator.check();
    const next = fixture(cache); next.state = 'importing';
    assert.equal(await next.coordinator.check(), false);
    assert.equal(next.commits.length, 0); assert.equal(next.reads.length, 0);
});

for (const invalidation of ['suspend', 'reset', 'account']) {
    test(`${invalidation} rejects held background commits and cache writes`, async () => {
        const f = fixture(), gate = deferred(); f.gates.set('badges', gate.promise);
        await f.coordinator.check(); await f.backgroundTick();
        if (invalidation === 'account') f.context.scope = 'user-b'; else f.coordinator[invalidation]();
        const statusCount = f.backgroundStatuses.length;
        gate.resolve(); await settle();
        assert.equal(f.commits.length, 1); assert.equal(f.cache.size, 1);
        assert.equal(f.backgroundStatuses.length, statusCount);
        if (invalidation !== 'account') assert.equal(f.timers.size, 0, 'a departed background cycle cannot rearm work');
    });
}

test('cache access failures fall back to the authoritative read', async () => {
    const f = fixture(new Map(), { readCachedSnapshot() { throw new Error('Storage unavailable'); } });
    assert.equal(await f.coordinator.check(), true); assert.deepEqual(f.reads, ['inventory']);
});

test('a failed member cannot partially commit or persist its joined foreground cohort', async () => {
    const f = fixture();
    f.context.adapters.push({ ...f.adapter('joined'), stage: async () => { throw new Error('Unavailable joined data'); } });
    assert.equal(await f.coordinator.check(), false);
    assert.equal(f.commits.length, 0); assert.equal(f.cache.size, 0);
    assert.equal(f.coordinator.getStatus().state, 'Needs attention');
});

test('background shared-source changes invalidate foreground before background can commit', async () => {
    const f = fixture(); await f.coordinator.check(); f.revision = '2';
    await f.backgroundTick();
    assert.deepEqual(f.reads, ['inventory']);
    assert.equal(f.coordinator.getStatus().state, 'Syncing');
    await f.backgroundTick();
    assert.deepEqual(f.reads, ['inventory', 'inventory']);
    assert.equal(f.coordinator.getStatus().state, 'Up to date');
    await f.backgroundTick();
    assert.deepEqual(f.commits.map(value => value.id), ['inventory', 'inventory', 'badges']);
});

test('cached data changing revision during final verification is discarded', async () => {
    const cache = new Map(), first = fixture(cache); await first.coordinator.check();
    let calls = 0;
    const next = fixture(cache, { readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1',
        sources: keys.map(key => ({ key, revision: ++calls === 1 ? '1' : '2', state: 'ready' })) }) });
    await next.coordinator.check();
    assert.equal(next.commits.length, 1); assert.equal(next.reads.length, 1);
    assert.equal(next.coordinator.getStatistics().discardedLoads, 1);
});

test('foreground navigation aborts background requests and starts without their completion', async () => {
    const f = fixture(); let backgroundSignal;
    f.background.stage = async ({ signal }) => {
        backgroundSignal = signal;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
    };
    await f.coordinator.check(); await f.backgroundTick();
    assert.equal(backgroundSignal.aborted, false);
    f.context.viewKey = 'orders'; f.context.adapters = [f.adapter('orders')]; f.context.backgroundAdapters = [];
    assert.equal(await f.coordinator.check('navigation'), true);
    assert.equal(backgroundSignal.aborted, true);
    assert.deepEqual(f.commits.map(value => value.id), ['inventory', 'orders']);
});

test('suspend aborts a pending metadata request and cannot publish an error afterward', async () => {
    let revisionSignal;
    const f = fixture(new Map(), { readRevisions: async (keys, { signal }) => {
        revisionSignal = signal;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
    } });
    const pending = f.coordinator.check(); await settle(); f.coordinator.suspend();
    const count = f.statuses.length;
    assert.equal(revisionSignal.aborted, true); await pending;
    assert.equal(f.statuses.length, count); assert.equal(f.timers.size, 0);
});

test('an importing dependency prevents a partial joined cohort from committing', async () => {
    const f = fixture(new Map(), { readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1',
        sources: keys.map(key => ({ key, revision: '1', state: key === 'joined' ? 'importing' : 'ready' })) }) });
    f.context.adapters.push(f.adapter('joined'));
    assert.equal(await f.coordinator.check(), false);
    assert.equal(f.reads.length, 0); assert.equal(f.commits.length, 0); assert.equal(f.cache.size, 0);
});

test('navigation cancellation cannot publish the abandoned foreground error', async () => {
    const f = fixture();
    f.foreground.stage = async ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Abandoned screen')), { once: true }));
    const pending = f.coordinator.check(); await settle();
    f.context.viewKey = 'orders'; f.context.adapters = [f.adapter('orders')]; f.context.backgroundAdapters = [];
    const fresh = f.coordinator.check('navigation');
    await Promise.all([pending, fresh]);
    assert.deepEqual(f.commits.map(value => value.id), ['orders']);
    assert.equal(f.statuses.some(value => value.message === 'Abandoned screen'), false);
});

test('a navigation-only Home opens before its badge cohort and still loads those badges', async () => {
    const f = fixture(); f.context.viewKey = 'home'; f.context.adapters = [];
    assert.equal(await f.coordinator.check(), true); assert.equal(f.metadata.length, 0);
    await f.backgroundTick();
    assert.deepEqual(f.reads, ['badges']); assert.deepEqual(f.commits.map(value => value.id), ['badges']);
    assert.equal(f.coordinator.getStatus().state, 'Up to date');
});

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('a loading placeholder cannot retain the Drive render key and suppress unchanged rows on return', () => {
    const container = { dataset: { driveRenderKey: 'same-snapshot' }, innerHTML: 'verified rows' };
    const context = { String, VIEW_LOAD_UI: { drive: { container: 'rows' } },
        document: { getElementById: () => container },
        getViewLoadingRenderSignature: () => 'loading', containerHasRenderableContent: () => true,
        setContainerHtml: (element, markup) => { element.innerHTML = markup; },
        setContainerRenderSignature() {}, setContainerUiState() {}, syncDriveCrumb() {}
    };
    vm.createContext(context);
    vm.runInContext(html.slice(html.indexOf('        function showViewLoadingState('), html.indexOf('        function showViewErrorState(')), context);
    vm.runInContext(html.slice(html.indexOf('        function applyDriveRenderMarkup('), html.indexOf('        function isDriveSpreadsheetGridMode(')), context);
    context.showViewLoadingState('drive', 'Verifying current data...', true);
    assert.equal(container.dataset.driveRenderKey, undefined);
    assert.equal(context.applyDriveRenderMarkup(container, null, 'Drive', 'verified rows', 'same-snapshot'), true);
    assert.equal(container.innerHTML, 'verified rows');
    assert.equal(context.applyDriveRenderMarkup(container, null, 'Drive', 'verified rows', 'same-snapshot'), false);
});

test('focused AV note choices cannot use previously loaded notes before current proof', async () => {
    const gate = deferred(), list = { innerHTML: '' }, item = { UNIQUE_ID: 'one' };
    let checks = 0;
    const context = { Map, JSON, String, Promise, activeItem: item, holdReleasePromptItem: null,
        verifiedAvNoteLoads: new Map(), productionLiveSyncVerifiedView: 'previous-group',
        canUseProductionLiveSync: () => true,
        getProductionLiveSyncContext: () => ({ surfaces: ['dialog:av-notes'] }),
        productionVerifiedViewKey: () => 'current-group',
        document: { getElementById: () => list },
        getProductionLiveSyncCoordinator: () => ({ check: () => { checks++; return gate.promise; } }),
        isDatasetLoaded: () => { throw new Error('Unverified choices must never render'); }
    };
    vm.createContext(context);
    vm.runInContext(html.slice(html.indexOf('        function ensureVerifiedAvNoteChoices('), html.indexOf('        function selectAvNote(')), context);
    context.filterAvNotes(''); context.filterAvNotes('');
    assert.equal(checks, 1); assert.match(list.innerHTML, /Loading verified AV notes/);
    gate.resolve(false); await settle();
    assert.match(list.innerHTML, /could not be verified/);
    assert.doesNotMatch(list.innerHTML, /No saved AV notes/);
});

function transportFixture(overrides = {}) {
    const calls = [], navigation = new AbortController();
    const ctx = { AbortController, WeakMap, Set, Error, Object, Math, Number, String, JSON,
        REQUEST_HISTORY_TABLE: 'ph_request_history', SALES_CREDIT_REQUESTS_TABLE: 'ph_sales_credit_requests',
        productionLiveSyncNavigation: navigation, SUPABASE_READ_TIMEOUT_MS: 1000, SUPABASE_URL: 'https://fixture.invalid',
        normalizeAppTableName: value => value, getNativeAuthRequestHeaders: async () => ({ Authorization: 'synthetic' }),
        fetchWithTimeout: async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => '[{"id":1},{"id":2}]' }; },
        parseSupabaseContentRangeTotal: () => 6, runDedupeSupabaseRead: (key, task) => task(),
        startGlobalProgress() {}, stopGlobalProgress() {}, beginInternalPerfMeasure: () => 0,
        getFullDatasetPageLimit: () => 2, getFullDatasetPageConcurrency: () => 1, yieldToUiFrame: async () => {},
        incrementInternalPerfCounter() {}, recordInternalPerfDuration() {}, ...overrides
    };
    vm.createContext(ctx);
    vm.runInContext(html.slice(html.indexOf('const productionLiveSyncReadSignalIds'), html.indexOf('function createProductionCoreLiveAdapter')), ctx);
    vm.runInContext(html.slice(html.indexOf('async function fetchAuthenticatedSupabaseReadPage'), html.indexOf('let activeRequestLiveRowsViewReady')), ctx);
    return { ctx, calls, navigation };
}

for (const source of ['navigation', 'cohort']) {
    test(`${source} cancellation reaches the combined production transport signal`, async () => {
        const f = transportFixture(), cohort = new AbortController(), gate = deferred(); let received;
        const pending = f.ctx.withProductionLiveSyncSignal(cohort.signal, async signal => { received = signal; await gate.promise; });
        assert.equal(received.aborted, false);
        (source === 'navigation' ? f.navigation : cohort).abort();
        assert.equal(received.aborted, true); gate.resolve(); await pending;
    });
}

test('page authentication finishing after cancellation cannot issue a request', async () => {
    const gate = deferred(), controller = new AbortController();
    const f = transportFixture({ getNativeAuthRequestHeaders: () => gate.promise });
    const pending = f.ctx.fetchAuthenticatedSupabaseReadPage('inventory', 'select=*', { signal: controller.signal });
    controller.abort(); gate.resolve({ Authorization: 'synthetic' });
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
    assert.equal(f.calls.length, 0);
});

test('paginated cancellation stops later pages and the first request carries its signal', async () => {
    const controller = new AbortController();
    const f = transportFixture({ yieldToUiFrame: async () => controller.abort() });
    await assert.rejects(f.ctx.fetchAllSupabaseRows('inventory', 'select=*', { signal: controller.signal }), error => error.code === 'REQUEST_ABORTED');
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].options.signal, controller.signal);
});

test('a canceled read waiting for a concurrency slot cannot start its first page', async () => {
    const gate = deferred(), controller = new AbortController();
    const f = transportFixture({ runDedupeSupabaseRead: async (key, task) => { await gate.promise; return task(); } });
    const pending = f.ctx.fetchAllSupabaseRows('inventory', 'select=*', { signal: controller.signal });
    controller.abort(); gate.resolve();
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED'); assert.equal(f.calls.length, 0);
});

test('secure fallback reads cancel after session preparation without changing writes', async () => {
    const controller = new AbortController(), gate = deferred(), calls = [];
    const ctx = { nativeReadRequiresRls: () => false, Error, Object, String, Math, Number, SUPABASE_WRITE_TIMEOUT_MS: 1000, APP_API_FUNCTION_URL: 'https://fixture.invalid',
        normalizeAppTableName: value => value, ensureAppApiWriteProxySession: () => gate.promise,
        postAppFunctionJson: async (url, body, options) => { calls.push(options); return { ok: true, data: [] }; }
    };
    vm.createContext(ctx);
    vm.runInContext(html.slice(html.indexOf('async function runAppApiSupabaseWrite('), html.indexOf('async function runWithFullJitter(')), ctx);
    const pending = ctx.runAppApiSupabaseWrite('inventory', 'GET', null, '', { signal: controller.signal });
    controller.abort(); gate.resolve(true);
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED'); assert.equal(calls.length, 0);
    await ctx.runAppApiSupabaseWrite('inventory', 'PATCH', {}, '', { signal: controller.signal });
    assert.equal(calls.length, 1); assert.equal(calls[0].signal, undefined, 'business writes retain prior delivery semantics');
});

test('fallback app-function auth cannot start a read after cancellation', async () => {
    const controller = new AbortController(), gate = deferred(); let calls = 0;
    const ctx = { Error, Object, Array, String, JSON, SUPABASE_KEY: '', getNativeAuthRequestHeaders: () => gate.promise,
        fetchWithTimeout: async () => { calls++; }, getCurrentAppSessionToken: () => '' };
    vm.createContext(ctx);
    vm.runInContext(html.slice(html.indexOf('async function postAppFunctionJson('), html.indexOf('function getOpsPilotBridge(')), ctx);
    const pending = ctx.postAppFunctionJson('https://fixture.invalid', {}, { signal: controller.signal });
    controller.abort(); gate.resolve({ Authorization: 'synthetic' });
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED'); assert.equal(calls, 0);
});


function installRefreshRenderFixture(ctx) {
    Object.assign(ctx, {
        productionLiveSyncRenderGeneration: 0, productionLiveSyncRenderPending: false, productionLiveSyncActiveRender: null,
        latestViewRenderTokensByView: { drive: 1, docks: 1 }, captureProductionRefreshAnchor: () => null,
        restoreProductionRefreshAnchor() {}, isProductionRefreshCurrent: () => true,
        finishProductionRefresh: () => { ctx.productionLiveSyncRenderPending = false; },
        cancelProductionRefresh: () => { ctx.productionLiveSyncRenderGeneration++; ctx.productionLiveSyncRenderPending = false; },
        scheduleTypingAwareUiRender: (_key, fn, delay) => {
            if (ctx.refreshFixtureTimer) ctx.clearTimeout(ctx.refreshFixtureTimer);
            ctx.refreshFixtureTimer = ctx.setTimeout(fn, delay);
        }
    });
    ctx.window ||= { AgMetricLiveSyncRegistry: { views: {} } };
    return ctx;
}

test('initial verified content skips the background render debounce and retains draft guards', () => {
    for (const [state, immediate, expectedDelay] of [['loading', false, 0], ['ready', false, 150], ['ready', true, 0]]) {
        let callback, delay, renders = 0;
        const context = { productionLiveSyncRenderTimer: null, productionLiveSyncDraftChanged: false,
            productionLiveSyncRendering: false, VIEW_LOAD_UI: { drive: { container: 'drive-content' } },
            productionVerifiedViewKey: () => 'visit', getCurrentVisibleViewId: () => 'drive', getContainerUiState: () => state,
            document: { hidden: false, getElementById: () => ({}), activeElement: null },
            window: { AgMetricLiveSyncRegistry: { views: { drive: { kind: 'data' } } } },
            canUseProductionLiveSync: () => true, hasProductionLiveSyncDraft: () => false,
            setTimeout: (fn, ms) => { callback = fn; delay = ms; return 1; }, clearTimeout() {},
            markViewDirty() {}, renderViewContent: () => { renders++; } };
        installRefreshRenderFixture(context);
        vm.createContext(context);
        vm.runInContext(html.slice(html.indexOf('        function scheduleProductionLiveSyncRender('), html.indexOf('        function getProductionLiveSyncCoordinator()')), context);
        context.scheduleProductionLiveSyncRender(immediate); assert.equal(delay, expectedDelay);
        callback(); assert.equal(renders, 1);
    }
});


test('late readiness callbacks reuse this visit but every new visit verifies again', async () => {
    const f = fixture(); f.context.backgroundAdapters = [];
    f.context.viewKey = 'drive:1'; await f.coordinator.check('visible-view');
    const before = f.metadata.length;
    f.coordinator.signal('view-entry', 0); await f.coordinator.check('visible-view'); await f.backgroundTick();
    assert.equal(f.metadata.length, before);
    f.context.viewKey = 'drive:2'; await f.coordinator.check('visible-view');
    assert.equal(f.metadata.length, before + 1); assert.equal(f.reads.length, 1); assert.equal(f.commits.length, 1);
    f.coordinator.signal('metadata', 0); await f.backgroundTick();
    assert.equal(f.metadata.length, before + 2, 'real invalidation is not suppressed by this visit proof');
});

test('navigation clears the previous proof before immediately requesting required data', () => {
    const calls = [];
    const ctx = { productionLiveSyncNavigationGeneration: 7, productionLiveSyncVerifiedView: 'old',
        productionLiveSyncViewLoad: { pending: true }, productionLiveSyncRenderTimer: 4,
        renderProductionDataFreshness: status => assert.equal(status.state, 'Syncing'),
        clearTimeout: id => calls.push(['cancel', id]), ensureViewDataForRender: view => {
            assert.equal(ctx.productionLiveSyncVerifiedView, ''); assert.equal(ctx.productionLiveSyncViewLoad, null); calls.push(['ensure', view]); },
        getProductionLiveSyncCoordinator: () => ({ check: reason => calls.push(['check', reason]) }) };
    installRefreshRenderFixture(ctx);
    vm.createContext(ctx); vm.runInContext(html.slice(html.indexOf('        function beginProductionVerifiedNavigation('), html.indexOf('        function signalProductionLiveSync(')), ctx);
    ctx.beginProductionVerifiedNavigation('drive'); assert.equal(ctx.productionLiveSyncNavigationGeneration, 8);
    ctx.beginProductionVerifiedNavigation('home'); ctx.beginProductionVerifiedNavigation('drive');
    assert.equal(ctx.productionLiveSyncNavigationGeneration, 10);
    assert.equal(ctx.productionLiveSyncRenderGeneration, 3);
    assert.deepEqual(calls, [['cancel', 4], ['ensure', 'drive'], ['check', 'view-entry'], ['ensure', 'drive']]);
});


test('a queued verified render cannot paint after navigation or an account change', () => {
    for (const change of ['navigation', 'account']) {
        let callback, currentView = 'drive', key = 'account-a:drive:1', renders = 0;
        const ctx = { productionLiveSyncRenderTimer: null, VIEW_LOAD_UI: {},
            getCurrentVisibleViewId: () => currentView, productionVerifiedViewKey: () => key,
            document: { hidden: false }, canUseProductionLiveSync: () => true,
            setTimeout: fn => { callback = fn; return 1; }, clearTimeout() {},
            renderViewContent: () => { renders++; } };
        installRefreshRenderFixture(ctx);
        vm.createContext(ctx); vm.runInContext(html.slice(html.indexOf('        function scheduleProductionLiveSyncRender('), html.indexOf('        function getProductionLiveSyncCoordinator()')), ctx);
        ctx.scheduleProductionLiveSyncRender(true);
        if (change === 'navigation') currentView = 'tasks'; else key = 'account-b:drive:1';
        callback(); assert.equal(renders, 0);
        assert.equal(ctx.productionLiveSyncRenderPending, false, 'obsolete navigation cannot strand the pending-update status');
    }
});

test('closing a Dock editor replaces its captured dialog render and releases hidden focus', () => {
    let open = true, nextId = 0, renders = 0;
    const timers = new Map();
    const focused = { matches: () => true, blur: () => { ctx.document.activeElement = null; } };
    const modal = { classList: { add: () => { open = false; } }, contains: element => element === focused };
    const ctx = { productionLiveSyncRenderTimer: null, productionLiveSyncDraftChanged: true,
        productionLiveSyncRendering: false, VIEW_LOAD_UI: {},
        productionVerifiedViewKey: () => open ? 'docks:dialog' : 'docks', getCurrentVisibleViewId: () => 'docks',
        document: { hidden: false, getElementById: id => id === 'dock-info-modal' ? modal : null, activeElement: focused },
        window: { AgMetricLiveSyncRegistry: { views: { docks: { kind: 'data' } } } },
        canUseProductionLiveSync: () => true, hasProductionLiveSyncDraft: () => open,
        setTimeout: fn => { timers.set(++nextId, fn); return nextId; }, clearTimeout: id => timers.delete(id),
        markViewDirty() {}, renderViewContent: () => { renders++; } };
    installRefreshRenderFixture(ctx);
    vm.createContext(ctx);
    vm.runInContext(html.slice(html.indexOf('        function scheduleProductionLiveSyncRender('), html.indexOf('        function getProductionLiveSyncCoordinator()')), ctx);
    vm.runInContext(html.slice(html.indexOf('        function closeDockInfoModal()'), html.indexOf('        function openDockInfoModal(')), ctx);
    ctx.scheduleProductionLiveSyncRender(); // The capture-phase click sees the open dialog.
    ctx.closeDockInfoModal();
    assert.equal(timers.size, 1); assert.equal(ctx.document.activeElement, null);
    [...timers.values()][0]();
    assert.equal(renders, 1); assert.equal(ctx.productionLiveSyncDraftChanged, false);
});

test('an obsolete Eval refresh cannot restore its old account cache after a failed read', async () => {
    let owner = 'account-a:permissions-a', rejectRead, renders = 0;
    const read = new Promise((_, reject) => { rejectRead = reject; });
    const ctx = {
        managerEvalReport2LoadState: {}, managerEvalReport2Cache: { privateRows: ['account-a'] }, managerEvalReport2CacheKey: 'old',
        canViewManagerEvalReports2: () => true, getSupabaseReadIdentityScope: () => owner,
        getDatasetLoadSignature: () => 'source-a', ensureDatasetLoaded: () => read,
        loadManagerEvalReportSettings: async () => {}, scheduleManagersRender: () => { renders++; }
    };
    const start = html.indexOf('        async function loadManagerEvalReports2(');
    const end = html.indexOf('        function getManagerEvalReport2CacheKeyValue(', start);
    vm.createContext(ctx); vm.runInContext(html.slice(start, end), ctx);
    const pending = ctx.loadManagerEvalReports2();
    owner = 'account-b:permissions-b';
    ctx.managerEvalReport2Cache = null;
    rejectRead(new Error('obsolete request cancelled'));
    assert.equal(await pending, null);
    assert.equal(ctx.managerEvalReport2Cache, null);
    assert.equal(ctx.managerEvalReport2LoadState.loading, false);
    assert.equal(renders, 1, 'only the initial refresh may request a render');
});
