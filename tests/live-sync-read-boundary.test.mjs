import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const start = html.indexOf('const supabaseReadInFlight = new Map();');
const end = html.indexOf('async function getResponseError(', start);
assert.ok(start > 0 && end > start);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function dashboardMetadataFixture() {
    const calls = [];
    const ctx = { Error, Object, String, Number, Array, Set, Map, Math, JSON, Promise, Date, encodeURIComponent, AbortController,
        currentUser: 'metadata-user-a', owner: 'metadata-scope-a', allowed: true,
        navigator: { onLine: true }, document: { hidden: false },
        productionLiveSyncNavigation: new AbortController(),
        DASHBOARD_SYNC_METADATA_LIMIT: 30, DASHBOARD_SYNC_METADATA_TTL_MS: 60000, SUPABASE_READ_TIMEOUT_MS: 1000,
        canViewDashboardSyncStatus: () => ctx.allowed,
        getSupabaseReadIdentityScope: () => ctx.owner,
        firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') || '',
        getValidIsoTimestamp: value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '',
        formatFetchedRows: rows => rows,
        yieldToUiFrame: async () => {}, commits: 0,
        updateDashboardSyncSummary: () => { ctx.commits++; },
        transport: async table => ({ rows: [{ filename: `${ctx.owner}-${table}.csv`, last_updated: '2026-09-12T12:00:00Z' }] }),
        fetchAuthenticatedSupabaseReadPage: (table, query, options) => {
            calls.push({ table, query, options, owner: ctx.owner });
            return ctx.transport(table, query, options);
        }
    };
    vm.createContext(ctx);
    const stateStart = html.indexOf('let dashboardSyncMetadataSummaries =');
    const stateEnd = html.indexOf('let pendingRequestArchiveFlushTimer', stateStart);
    const signalStart = html.indexOf('async function withProductionLiveSyncSignal(');
    const metadataStart = html.indexOf('function collectDashboardSyncSource(');
    const metadataEnd = html.indexOf('function updateDashboardSyncSummary()', metadataStart);
    assert.ok(stateStart > 0 && stateEnd > stateStart && metadataEnd > metadataStart);
    vm.runInContext(html.slice(stateStart, stateEnd)
        + html.slice(signalStart, html.indexOf('function ', signalStart + 15)).trim()
        + html.slice(metadataStart, metadataEnd)
        + '\nthis.metadataState = () => ({ summaries: dashboardSyncMetadataSummaries, fetchedAt: dashboardSyncMetadataFetchedAt, pending: dashboardSyncMetadataInFlight });', ctx);
    return { ctx, calls };
}

test('dashboard metadata cancellation between reads prevents the next request and commit, then fresh reads resume and cache', async () => {
    const { ctx, calls } = dashboardMetadataFixture(), uiGate = deferred();
    ctx.yieldToUiFrame = () => uiGate.promise;
    const pending = ctx.refreshDashboardSyncMetadata(true);
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(ctx.commits, 0);
    ctx.productionLiveSyncNavigation.abort(); uiGate.resolve();
    assert.equal(await pending, false);
    assert.equal(calls.length, 1, 'the next metadata source must not start after unload');
    assert.equal(ctx.commits, 0);
    assert.equal(ctx.metadataState().summaries.length, 0);
    assert.equal(ctx.metadataState().fetchedAt, 0);
    assert.equal(ctx.metadataState().pending, null);
    ctx.productionLiveSyncNavigation = new AbortController();
    ctx.yieldToUiFrame = async () => {};
    assert.equal(await ctx.refreshDashboardSyncMetadata(), true);
    assert.equal(calls.length, 5);
    assert.equal(ctx.commits, 1);
    assert.equal(ctx.metadataState().summaries.length, 4);
    assert.ok(ctx.metadataState().fetchedAt > 0);
    for (const call of calls) {
        const query = new URLSearchParams(call.query);
        assert.equal(query.get('select'), 'filename,last_updated');
        assert.equal(query.get('last_updated'), 'not.is.null');
        assert.equal(query.get('order'), 'last_updated.desc');
        assert.equal(query.get('limit'), '30');
        assert.equal(query.get('offset'), '0');
        assert.equal(call.options.timeoutMs, 1000);
        assert.ok(call.options.signal);
    }
    assert.equal(await ctx.refreshDashboardSyncMetadata(), true);
    assert.equal(calls.length, 5, 'same-owner metadata reuses its valid TTL cache');
});

test('dashboard metadata never starts transport after navigation is already aborted', async () => {
    const { ctx, calls } = dashboardMetadataFixture();
    ctx.productionLiveSyncNavigation.abort();
    assert.equal(await ctx.refreshDashboardSyncMetadata(true), false);
    assert.equal(calls.length, 0);
    assert.equal(ctx.commits, 0);
    assert.equal(ctx.metadataState().fetchedAt, 0);
    assert.equal(ctx.metadataState().pending, null);
});

test('dashboard metadata aborts an in-flight authenticated request while preserving the same-owner cache', async () => {
    const { ctx, calls } = dashboardMetadataFixture();
    assert.equal(await ctx.refreshDashboardSyncMetadata(), true);
    const prior = ctx.metadataState();
    assert.equal(calls.length, 4);
    ctx.transport = (_, __, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });
    const pending = ctx.refreshDashboardSyncMetadata(true);
    await settle();
    assert.equal(calls.length, 5);
    ctx.productionLiveSyncNavigation.abort();
    assert.equal(await pending, false);
    assert.equal(calls.at(-1).options.signal.aborted, true);
    assert.equal(calls.length, 5);
    assert.equal(ctx.commits, 1, 'only the earlier successful read committed');
    assert.equal(ctx.metadataState().fetchedAt, prior.fetchedAt);
    assert.equal(ctx.metadataState().summaries, prior.summaries);
});

test('dashboard metadata never shares or commits an old account request over a new owner', async () => {
    const { ctx, calls } = dashboardMetadataFixture(), oldGate = deferred(), freshGate = deferred();
    let freshReads = 0;
    ctx.transport = table => ctx.owner === 'metadata-scope-a' ? oldGate.promise
        : ++freshReads === 1 ? freshGate.promise
        : Promise.resolve({ rows: [{ filename: `new-${table}.csv`, last_updated: '2026-09-12T12:00:00Z' }] });
    const old = ctx.refreshDashboardSyncMetadata(true);
    await settle();
    ctx.currentUser = 'metadata-user-b'; ctx.owner = 'metadata-scope-b';
    const fresh = ctx.refreshDashboardSyncMetadata(), shared = ctx.refreshDashboardSyncMetadata();
    await settle();
    assert.equal(calls.length, 2, 'the new owner starts once and coalesces only its own reads');
    oldGate.resolve({ rows: [{ filename: 'old-account.csv', last_updated: '2026-09-12T13:00:00Z' }] });
    assert.equal(await old, false);
    assert.equal(ctx.commits, 0);
    const stillShared = ctx.refreshDashboardSyncMetadata();
    await settle();
    assert.equal(calls.length, 2, 'old completion cannot clear the new pending request');
    freshGate.resolve({ rows: [{ filename: 'new-master.csv', last_updated: '2026-09-12T12:00:00Z' }] });
    assert.deepEqual(await Promise.all([fresh, shared, stillShared]), [true, true, true]);
    assert.equal(calls.length, 5);
    assert.equal(ctx.commits, 1);
    assert.ok(ctx.metadataState().summaries.every(entry => entry.files.every(file => file.startsWith('new-'))));
    assert.equal(await ctx.refreshDashboardSyncMetadata(), true);
    assert.equal(calls.length, 5);
});

test('dashboard metadata permission loss at the final UI yield prevents a completed batch from committing', async () => {
    const { ctx, calls } = dashboardMetadataFixture();
    let yields = 0;
    ctx.yieldToUiFrame = async () => { if (++yields === 4) ctx.allowed = false; };
    assert.equal(await ctx.refreshDashboardSyncMetadata(true), false);
    assert.equal(calls.length, 4);
    assert.equal(ctx.commits, 0);
    assert.equal(ctx.metadataState().summaries.length, 0);
    assert.equal(ctx.metadataState().fetchedAt, 0);
});

test('health telemetry cancels across navigation during authentication and in flight, then resumes normally', async () => {
    const auth = deferred(), calls = [];
    const sampleMath = Object.create(Math); sampleMath.random = () => 0;
    const ctx = { Error, Object, String, Number, Set, Math: sampleMath, JSON, Promise, encodeURIComponent,
        AbortController, currentUser: 'fixture', navigator: { onLine: true }, APP_SHELL_BUILD: 'fixture',
        SUPABASE_URL: 'https://fixture.invalid', SUPABASE_WRITE_TIMEOUT_MS: 1000,
        productionLiveSyncNavigation: new AbortController(), getNativeAuthRequestHeaders: () => auth.promise,
        sanitizeHealthMetadata: value => value,
        fetchWithTimeout: async (_, options) => { calls.push(options); return { ok: true, text: async () => '[]' }; }
    };
    vm.createContext(ctx);
    const signalStart = html.indexOf('async function withProductionLiveSyncSignal(');
    vm.runInContext(html.slice(signalStart, html.indexOf('function ', signalStart + 15)).trim(), ctx);
    const rpcStart = html.indexOf('async function supabaseRpc(');
    vm.runInContext(html.slice(rpcStart, html.indexOf('const SECURE_DRIVE_EVIDENCE_PREFIXES', rpcStart)), ctx);
    const healthStart = html.indexOf('function reportSemanticHealthEvent(');
    vm.runInContext(html.slice(healthStart, html.indexOf('window.reportSemanticHealthEvent', healthStart)), ctx);
    const reports = () => [ctx.reportSemanticHealthEvent('fixture', 'test'), ctx.reportPerformanceHealthEvent('fixture', 'test', 1)];
    let pending = reports();
    ctx.productionLiveSyncNavigation.abort(); auth.resolve({ Authorization: 'synthetic' });
    assert.deepEqual(await Promise.all(pending), [false, false]);
    assert.equal(calls.length, 0, 'unloading during auth preparation must not start telemetry requests');
    ctx.productionLiveSyncNavigation = new AbortController();
    ctx.fetchWithTimeout = (_, options) => new Promise((_, reject) => {
        calls.push(options); options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });
    pending = reports(); await settle();
    assert.equal(calls.length, 2);
    ctx.productionLiveSyncNavigation.abort();
    assert.deepEqual(await Promise.all(pending), [false, false]);
    assert.ok(calls.every(options => options.signal.aborted));
    ctx.productionLiveSyncNavigation = new AbortController();
    ctx.fetchWithTimeout = async () => ({ ok: true, text: async () => '[]' });
    assert.deepEqual(await Promise.all(reports()), [true, true], 'active-document health reporting remains enabled');
});

test('a revision read cancelled during auth preparation never starts its RPC', async () => {
    const from = html.indexOf('async function supabaseRpc(');
    const to = html.indexOf('const SECURE_DRIVE_EVIDENCE_PREFIXES', from);
    const gate = deferred(), controller = new AbortController(); let calls = 0;
    const ctx = { Error, Object, String, Number, Math, JSON, encodeURIComponent,
        SUPABASE_URL: 'https://fixture.invalid', SUPABASE_WRITE_TIMEOUT_MS: 1000,
        getNativeAuthRequestHeaders: () => gate.promise,
        fetchWithTimeout: async () => { calls++; return { ok: true, text: async () => '{}' }; }
    };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    const pending = ctx.supabaseRpc('get_my_dataset_revisions_v1', {}, { signal: controller.signal });
    controller.abort(); gate.resolve({ Authorization: 'synthetic' });
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
    assert.equal(calls, 0);
    await ctx.supabaseRpc('get_my_dataset_revisions_v1', {}, { signal: new AbortController().signal });
    assert.equal(calls, 1, 'new document/account reads retain normal authentication');
});

test('cancellation during proxy preparation prevents a native fetch', async () => {
    const from = html.indexOf('async function fetchWithTimeout(');
    const to = html.indexOf('const supabaseReadInFlight', from);
    const gate = deferred(), controller = new AbortController(); let calls = 0;
    const ctx = { Error, Object, AbortController, setTimeout, clearTimeout, SUPABASE_WRITE_TIMEOUT_MS: 1000,
        fetchSupabaseRestViaAppApiIfNeeded: () => gate.promise,
        fetch: async () => { calls++; return {}; }
    };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    const pending = ctx.fetchWithTimeout('https://fixture.invalid', { signal: controller.signal });
    controller.abort(); gate.resolve(null);
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
    assert.equal(calls, 0);
});

function requestQueueLifecycleFixture() {
    const calls = [], warnings = [];
    const ctx = { Error, Object, String, AbortController,
        productionLiveSyncNavigation: new AbortController(),
        REQUEST_QUEUE_LIVE_ROWS_TABLE: 'ph_request_queue_live_rows', ACTIVE_REQUEST_TABLE: 'ph_active_request',
        console: { warn: (...args) => warnings.push(args) },
        transport: async () => [{ unique_id: 'isolated-request' }],
        fetchAllSupabaseRows: (table, query, options) => {
            calls.push({ table, query, options });
            return ctx.transport(table, query, options);
        }
    };
    vm.createContext(ctx);
    const from = html.indexOf('let activeRequestLiveRowsViewReady =');
    const to = html.indexOf('async function fetchSupabasePage(', from);
    assert.ok(from > 0 && to > from);
    vm.runInContext(html.slice(from, to), ctx);
    return { ctx, calls, warnings, ready: () => vm.runInContext('activeRequestLiveRowsViewReady', ctx) };
}

test('request queue reads do not start after navigation or poison view availability on cancellation', async () => {
    const { ctx, calls, warnings, ready } = requestQueueLifecycleFixture();
    ctx.productionLiveSyncNavigation.abort();
    await assert.rejects(ctx.fetchActiveRequestLiveRows(), error => error.code === 'REQUEST_ABORTED');
    assert.equal(calls.length, 0);
    assert.equal(ready(), null);
    assert.equal(warnings.length, 0);
});

test('navigation during a request queue read aborts the same read and never launches the fallback', async () => {
    const { ctx, calls, warnings, ready } = requestQueueLifecycleFixture();
    const gate = deferred();
    ctx.transport = async () => { await gate.promise; throw new TypeError('Load failed'); };
    const pending = ctx.fetchActiveRequestLiveRows();
    await settle();
    const signal = ctx.productionLiveSyncNavigation.signal;
    ctx.productionLiveSyncNavigation.abort();
    gate.resolve();
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
    assert.equal(calls.length, 1, 'a teardown failure must not launch an authenticated fallback');
    assert.equal(calls[0].options.signal, signal);
    assert.equal(signal.aborted, true);
    assert.equal(ready(), null, 'navigation is not evidence the database view is missing');
    assert.equal(warnings.length, 0);
    ctx.productionLiveSyncNavigation = new AbortController();
    ctx.transport = async () => [{ unique_id: 'restored-request' }];
    assert.equal((await ctx.fetchActiveRequestLiveRows())[0].unique_id, 'restored-request');
    assert.equal(calls[1].table, 'ph_request_queue_live_rows');
    assert.equal(ready(), true);
});

test('request queue navigation rejects late successful data without changing view availability', async () => {
    const { ctx, calls, ready } = requestQueueLifecycleFixture();
    const gate = deferred();
    ctx.transport = () => gate.promise;
    const pending = ctx.fetchActiveRequestLiveRows();
    await settle();
    ctx.productionLiveSyncNavigation.abort();
    gate.resolve([{ unique_id: 'old-document' }]);
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
    assert.equal(calls.length, 1);
    assert.equal(ready(), null);
});

test('active request queue still falls back for real view failures and shares its navigation signal', async () => {
    const { ctx, calls, warnings, ready } = requestQueueLifecycleFixture();
    ctx.transport = async table => {
        if (table === 'ph_request_queue_live_rows') throw new Error('view unavailable');
        return [{ unique_id: 'pending-request' }];
    };
    assert.equal((await ctx.fetchActiveRequestLiveRows())[0].unique_id, 'pending-request');
    assert.deepEqual(calls.map(call => call.table), ['ph_request_queue_live_rows', 'ph_active_request']);
    assert.ok(calls.every(call => call.options.signal === ctx.productionLiveSyncNavigation.signal));
    assert.equal(ready(), false);
    assert.equal(warnings.length, 1);
    assert.equal((await ctx.fetchActiveRequestLiveRows())[0].unique_id, 'pending-request');
    assert.equal(calls[2].table, 'ph_active_request');
    assert.equal(warnings.length, 1);
});

test('navigation stops visible-document reads until restoration or trusted interaction', () => {
    const handlers = new Map(), signals = [], original = new AbortController();
    const listen = (name, callback) => handlers.set(name, callback);
    const coordinator = { suspend() {}, signal: reason => signals.push(reason) };
    const ctx = { AbortController, document: { hidden: false, addEventListener: listen, body: { classList: { contains: () => true } } }, window: { addEventListener: listen },
        appAccessSnapshotState: { status: 'ready', stale: false, username: 'fixture' }, currentUser: 'fixture', getRequestCapabilityUsernameKey: value => value,
        productionLiveSyncNavigation: original, productionLiveSyncCoordinator: coordinator,
        getProductionLiveSyncCoordinator: () => coordinator, canUseProductionLiveSync: () => false,
        observeHlOrderVerificationContext: value => value, navigator: { onLine: true }
    };
    vm.createContext(ctx);
    const contextStart = html.indexOf('function getProductionLiveSyncContext()');
    vm.runInContext(html.slice(contextStart, html.indexOf('function renderProductionDataFreshness(', contextStart)), ctx);
    const from = html.indexOf('function signalProductionLiveSync(');
    vm.runInContext(html.slice(from, html.indexOf('function resetProductionLiveSync()', from)), ctx);
    const events = html.indexOf("['focus', 'pageshow'].forEach");
    vm.runInContext(html.slice(events, html.indexOf("document.addEventListener('focusout'", events)), ctx);
    handlers.get('beforeunload')({ isTrusted: true });
    assert.equal(original.signal.aborted, true);
    assert.equal(ctx.getProductionLiveSyncContext().visible, false, 'beforeunload precedes document.hidden');
    ctx.signalProductionLiveSync('loader');
    handlers.get('pointerdown')({ isTrusted: false });
    handlers.get('focus')({ isTrusted: false });
    assert.deepEqual(signals, []);
    handlers.get('pointerdown')({ isTrusted: true });
    assert.equal(ctx.getProductionLiveSyncContext().visible, true);
    assert.deepEqual(signals, ['navigation-cancelled']);
    assert.equal(original.signal.aborted, true, 'old reads cannot inherit the resumed signal');
    handlers.get('pagehide')({ isTrusted: true });
    ctx.document.hidden = true;
    handlers.get('pageshow')({ isTrusted: true });
    assert.equal(ctx.getProductionLiveSyncContext().visible, false);
    ctx.document.hidden = false;
    handlers.get('pageshow')({ isTrusted: true });
    assert.equal(ctx.getProductionLiveSyncContext().visible, true);
});
function fixture(concurrency = 3) {
    const ctx = { Map, Promise, JSON, String, Error, SUPABASE_READ_CONCURRENCY_LIMIT: concurrency,
        SUPABASE_URL: 'https://fixture.invalid', currentUser: 'dylan_collyge', currentRole: 'Admin', currentUserDivision: '10',
        nativeAuthSessionActive: true, nativeAuthProfile: { id: 'user-a' }, incrementInternalPerfCounter() {}, getCurrentLoginCacheScopeKey: () => 'scope'
    };
    vm.createContext(ctx);
    vm.runInContext(html.slice(start, end) + '\nthis.generation = () => { productionLiveSyncReadGeneration++; }; this.permission = value => { productionLiveSyncReadPermissionVersion = value; }; this.resetAuth = () => { productionLiveSyncReadAuthEpoch++; }; this.reads = supabaseReadInFlight;', ctx);
    return ctx;
}

test('identical same-scope reads within one verified generation share a request', async () => {
    const ctx = fixture(); const gate = deferred(); let calls = 0;
    const one = ctx.runDedupeSupabaseRead('all:soc:query', async () => { calls++; return gate.promise; });
    const two = ctx.runDedupeSupabaseRead('all:soc:query', async () => { calls++; return ['wrong']; });
    assert.equal(one, two); gate.resolve(['rows']);
    assert.deepEqual(await one, ['rows']); assert.equal(calls, 1); assert.equal(ctx.reads.size, 0);
});

test('a fresh snapshot generation cannot join a pre-revision inventory read', async () => {
    const ctx = fixture(); const gate = deferred();
    const old = ctx.runDedupeSupabaseRead('all:soc:query', () => gate.promise);
    await settle(); ctx.generation();
    const fresh = ctx.runDedupeSupabaseRead('all:soc:query', async () => ['new-generation']);
    assert.notEqual(old, fresh);
    assert.deepEqual(await fresh, ['new-generation']);
    gate.resolve(['old-generation']); await old;
});

test('account switching rejects old in-flight data and never shares it with the new account', async () => {
    const ctx = fixture(); const gate = deferred();
    const old = ctx.runDedupeSupabaseRead('all:requests:query', () => gate.promise);
    const rejected = assert.rejects(old, /account or data permissions changed/);
    await settle(); ctx.currentUser = 'other'; ctx.nativeAuthProfile = { id: 'user-b' };
    const fresh = ctx.runDedupeSupabaseRead('all:requests:query', async () => ['user-b-rows']);
    assert.deepEqual(await fresh, ['user-b-rows']);
    gate.resolve(['user-a-rows']); await rejected;
});

test('a queued read captured under an old account is rejected before it issues a request', async () => {
    const ctx = fixture(1); const gate = deferred(); let oldCalls = 0;
    const blocker = ctx.runDedupeSupabaseRead('blocker', () => gate.promise);
    const blockerRejected = assert.rejects(blocker, /permissions changed/);
    const queued = ctx.runDedupeSupabaseRead('queued', async () => { oldCalls++; return []; });
    const queuedRejected = assert.rejects(queued, /permissions changed/);
    await settle(); ctx.currentUserDivision = '20'; gate.resolve([]);
    await Promise.all([blockerRejected, queuedRejected]); assert.equal(oldCalls, 0);
});

test('same-role permission changes and logout-login epochs discard earlier reads', async () => {
    for (const change of [(ctx) => ctx.permission('new-policy'), (ctx) => ctx.resetAuth()]) {
        const ctx = fixture(); const gate = deferred();
        const pending = ctx.runDedupeSupabaseRead('request', () => gate.promise);
        const rejected = assert.rejects(pending, /permissions changed/);
        await settle(); change(ctx); gate.resolve(['stale']); await rejected;
    }
});

test('an old completion cannot remove a newer in-flight cache entry', async () => {
    const ctx = fixture(); const oldGate = deferred(); const freshGate = deferred();
    const old = ctx.runDedupeSupabaseRead('same', () => oldGate.promise);
    await settle(); ctx.generation();
    const fresh = ctx.runDedupeSupabaseRead('same', () => freshGate.promise);
    oldGate.resolve([]); await old;
    assert.equal(ctx.reads.size, 1);
    assert.equal(ctx.runDedupeSupabaseRead('same', async () => ['wrong']), fresh);
    freshGate.resolve([]); await fresh; assert.equal(ctx.reads.size, 0);
});

test('settings-only updates rebuild current-season collections from verified inventory without a download', () => {
    const marker = 'commitSnapshots: (snapshots, context, metadata) => {';
    const from = html.indexOf(marker);
    const to = html.indexOf('\n                subscribe:', from);
    assert.ok(from > 0 && to > from);
    const callback = html.slice(from + 'commitSnapshots: '.length, to).trim().replace(/,$/, '');
    const previous = [{ UNIQUE_ID: 'spring', SEASON: 'S1' }, { UNIQUE_ID: 'fall', SEASON: 'F1' }];
    const calls = [], state = { fullLoaded: true, liveVerifiedScope: 'actor-a', liveVerifiedPermission: 'policy-a', liveVerifiedRevision: '10' };
    const context = { scope: 'actor-a' }, metadata = { permissionVersion: 'policy-a', sources: new Map([['ph_master_inventory', { state: 'ready', revision: '10' }]]) };
    const ctx = { Object, Array, Date, fullInventory: previous, season: 'S1', calls,
        getProductionLiveSyncContext: () => ({ adapters: [{ id: 'side:settings' }] }),
        getDatasetState: () => state, TRACKED_VIEW_IDS: [], invalidateResolvedViewStateCaches() {}, markViewDirty() {}, persistCurrentCache() {}, scheduleProductionLiveSyncRender() {},
        processAndLoadData: (payload) => { calls.push(payload); ctx.visibleRows = payload.data.filter((row) => row.SEASON === ctx.season); }
    };
    vm.createContext(ctx); vm.runInContext(`this.commit = ${callback}`, ctx);
    ctx.commit([{ adapter: { id: 'side:settings', commit: () => { ctx.season = 'F1'; } }, value: {} }], context, metadata);
    assert.deepEqual(ctx.visibleRows.map((row) => row.UNIQUE_ID), ['fall']);
    assert.equal(calls[0]._verifiedLiveSync, true);
    assert.notEqual(calls[0].data[0], previous[0]);
    assert.deepEqual(previous.map((row) => row.SEASON), ['S1', 'F1']);
    calls.length = 0; state.fullLoaded = false;
    ctx.commit([{ adapter: { id: 'side:settings', commit() {} }, value: {} }], context, metadata);
    assert.equal(calls.length, 0, 'an incomplete master cache is not promoted to a verified source');
    state.fullLoaded = true;
    for (const field of ['liveVerifiedScope', 'liveVerifiedPermission', 'liveVerifiedRevision']) {
        const saved = state[field]; state[field] = 'stale';
        ctx.commit([{ adapter: { id: 'side:settings', commit() {} }, value: {} }], context, metadata);
        assert.equal(calls.length, 0, `${field} prevents stale cache promotion`);
        state[field] = saved;
    }
});

test('AV and inventory resolve to one identical authoritative read descriptor', async () => {
    const from = html.indexOf('const productionLiveSyncReadSignalIds');
    const to = html.indexOf('function getProductionLiveSyncContext()', from);
    const ctx = { JSON, Error, Array, AbortController, productionLiveSyncNavigation: new AbortController(), DATASET_DEFINITIONS: {
        master: { table: 'ph_master_inventory', fullQuery: 'select=*&order=unique_id.asc' },
        avOpen: { table: 'ph_master_inventory', fullQuery: 'select=*&season=in.(F1,S1,U1,U2)' }
    }, window: { AgMetricLiveSyncRegistry: { getSourceKeys: () => ['ph_master_inventory'] } },
        season: { seasonCode: 'S1', salesYear: 27 }, getCurrentAppSeasonSettings: () => ctx.season,
        fetchAllSupabaseRows: async () => [], buildDatasetPayload: (key, rows) => ({ key, rows }),
        canUseHlOrder: () => false }; // This original AV fixture is outside the Dylan-only HL surface.
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    const master = ctx.createProductionCoreLiveAdapter('master'), av = ctx.createProductionCoreLiveAdapter('avOpen');
    assert.equal(av.id, 'core:master'); assert.equal(av.cacheKey, master.cacheKey);
    const staged = await av.stage();
    assert.equal(staged.key, 'master');
    assert.equal(staged.hlOrderInventory, null, 'ordinary AV staging does not acquire an HL snapshot');
    ctx.season = { seasonCode: 'F1', salesYear: 27 };
    assert.notEqual(ctx.createProductionCoreLiveAdapter('master').cacheKey, master.cacheKey,
        'season changed off-screen cannot retain old derived inventory under unchanged stock revisions');
});

function permissionFixture(options = {}) {
    const from = html.indexOf('async function refreshNativeRoleAndCapabilities(');
    const to = html.indexOf('function installNativeRoleRefreshWatchers()', from);
    const calls = [];
    const ctx = { String, Promise, Error, console: { warn() {} }, calls,
        NATIVE_AUTH_ENABLED: true, nativeAuthSessionActive: true, nativeRoleRefreshPromise: null,
        nativeAuthProfile: { id: 'account-a' }, captureProductionPermissionDrafts() {}, restoreProductionPermissionDrafts: async () => {},
        setProductionPermissionCheckState: (state) => { ctx.mask = state; }, getCurrentVisibleViewId: () => 'home',
        currentUser: 'dylan_collyge', currentUserDisplay: 'Dylan', currentRole: 'Admin', currentUserDivision: '10', currentUserLanguage: 'English',
        loadNativeAuthProfile: async () => ({ username: 'dylan_collyge', role: 'Admin', division: options.division || '10' }),
        normalizeRoleAccessToken: (value) => String(value).toLowerCase(), normalizeAppUserLanguage: (value) => value,
        localStorage: { setItem() {} }, persistAppSessionRecord() {}, ensureNativeAppSessionBridge: async () => {},
        clearRoleScopedClientCaches: () => { calls.push('clear'); ctx.appAccessSnapshotState = {}; ctx.requestCapabilityState = {}; },
        initializeAppAccessSnapshot: async () => { calls.push('access'); ctx.appAccessSnapshotState = options.failure ? { status: 'error' } : { status: 'ready', stale: false, snapshot: {} }; },
        initializeRequestCapabilities: async () => { calls.push('capabilities'); ctx.requestCapabilityState = { status: 'ready', stale: false, capabilities: {} }; },
        ensureAssignableAppUsers: async () => {}, ensureFlyerAssignableUsers: async () => {},
        applyRolePermissions: () => { calls.push('apply'); }, refreshProtectedSections() {}, markViewDirty() {}, renderHome() {}, reportSemanticHealthEvent() {}
    };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    return ctx;
}

test('same-role policy changes reload and apply authoritative permissions before returning', async () => {
    const ctx = permissionFixture();
    assert.equal(await ctx.refreshNativeRoleAndCapabilities('foreground'), false);
    assert.equal(ctx.calls.length, 0);
    assert.equal(await ctx.refreshNativeRoleAndCapabilities('live-permissions'), true);
    assert.deepEqual(ctx.calls, ['clear', 'capabilities', 'access', 'apply']);
});

test('division changes refresh capability scope even without a role change', async () => {
    const ctx = permissionFixture({ division: '20' });
    assert.equal(await ctx.refreshNativeRoleAndCapabilities('foreground'), true);
    assert.equal(ctx.currentUserDivision, '20');
    assert.ok(ctx.calls.includes('apply'));
});

test('a failed updated policy check rejects instead of granting fallback access', async () => {
    const ctx = permissionFixture({ failure: true });
    await assert.rejects(ctx.refreshNativeRoleAndCapabilities('live-permissions'), /permissions could not be verified/);
    assert.ok(!ctx.calls.includes('apply'));
    assert.equal(ctx.mask, 'failed');
});

test('live permission signal arriving during a foreground check performs a full refresh afterwards', async () => {
    const ctx = permissionFixture(); const gate = deferred();
    const getProfile = ctx.loadNativeAuthProfile;
    ctx.loadNativeAuthProfile = async () => { await gate.promise; return getProfile(); };
    const foreground = ctx.refreshNativeRoleAndCapabilities('foreground');
    const policy = ctx.refreshNativeRoleAndCapabilities('live-permissions');
    gate.resolve();
    assert.equal(await foreground, false); assert.equal(await policy, true);
    assert.deepEqual(ctx.calls, ['clear', 'capabilities', 'access', 'apply']);
});

test('permission-change coordinator callback returns the permission refresh promise', () => {
    const code = html.match(/onPermissionChange: (\(\) => \{[^\n]+\}),/)[1];
    const promise = Promise.resolve(true); const groups = new Set(['prior']); const ctx = { productionDisplayGroups: groups, refreshNativeRoleAndCapabilities: () => promise };
    vm.createContext(ctx); vm.runInContext(`this.callback = ${code}`, ctx);
    assert.equal(ctx.callback(), promise);
});

test('footer refresh does not render or reset static Hours and navigation screens', () => {
    const from = html.indexOf('function scheduleProductionLiveSyncRender(');
    const to = html.indexOf('function getProductionLiveSyncCoordinator()', from);
    for (const kind of ['static', 'navigation']) {
        const ctx = { productionVerifiedViewKey: () => 'visit', VIEW_LOAD_UI: {}, productionLiveSyncRenderTimer: null, document: { hidden: false },
            setTimeout: (callback) => { callback(); return 1; }, canUseProductionLiveSync: () => true,
            getCurrentVisibleViewId: () => 'hours', window: { AgMetricLiveSyncRegistry: { views: { hours: { kind } } } },
            hasProductionLiveSyncDraft: () => { throw new Error('Static form should not enter redraw handling.'); }
        };
        vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
        assert.doesNotThrow(() => ctx.scheduleProductionLiveSyncRender());
    }
});

test('focused live search defers one redraw without scheduling a busy retry timer', () => {
    const from = html.indexOf('function scheduleProductionLiveSyncRender(');
    const to = html.indexOf('function getProductionLiveSyncCoordinator()', from);
    const queued = [];
    const ctx = { productionVerifiedViewKey: () => 'visit', VIEW_LOAD_UI: {}, productionLiveSyncRenderTimer: null, productionLiveSyncDraftChanged: false,
        productionLiveSyncRenderGeneration: 0, productionLiveSyncRenderPending: false,
        scheduleTypingAwareUiRender: (_key, callback) => { queued.push(callback); },
        setTimeout: (callback) => { queued.push(callback); return queued.length; }, document: { hidden: false, activeElement: { matches: () => true } },
        canUseProductionLiveSync: () => true, getCurrentVisibleViewId: () => 'docks', hasProductionLiveSyncDraft: () => false,
        window: { AgMetricLiveSyncRegistry: { views: { docks: { kind: 'data' } } } }
    };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    ctx.scheduleProductionLiveSyncRender(); queued[0]();
    assert.equal(queued.length, 1); assert.equal(ctx.productionLiveSyncDraftChanged, true); assert.equal(ctx.productionLiveSyncRenderTimer, null);
});

function draftFixture() {
    const from = html.indexOf('let productionPermissionCheckElements = []');
    const to = html.indexOf('async function refreshNativeRoleAndCapabilities(', from);
    const editor = { targetType: 'user', targetKey: 'fixture-user', reason: 'unsaved reason', decision: 'deny' };
    const ctx = { String, Array, Object, Error, currentUser: 'dylan_collyge', nativeAuthProfile: { id: 'account-a' },
        accessControlAdminState: { editor, publishReason: 'my review' },
        codexOpsState: { composeOpen: true, draft: 'unsent issue', attachments: [{ id: 'local-file' }], messageDraft: 'unsent reply', activeTaskId: 'my-task' },
        canAccessView: () => true, isKaylaLimitedAccessManagerUser: () => false, normalizeAccessControlMatrix: (value) => value,
        supabaseRpc: async () => ({ capabilities: { canView: true, canEdit: true, canPublish: true, editScope: 'all' } }),
        invokeCodexOpsApi: async () => ({ canView: true, submissionEnabled: true })
    };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    return ctx;
}

test('only same-account draft fields are restored after authoritative feature permission checks', async () => {
    const ctx = draftFixture(); ctx.captureProductionPermissionDrafts();
    ctx.accessControlAdminState = {}; ctx.codexOpsState = {};
    await ctx.restoreProductionPermissionDrafts();
    assert.equal(ctx.accessControlAdminState.editor.reason, 'unsaved reason');
    assert.equal(ctx.accessControlAdminState.publishReason, 'my review');
    assert.equal(ctx.codexOpsState.draft, 'unsent issue');
    assert.equal(ctx.codexOpsState.messageDraft, 'unsent reply');
    assert.equal(ctx.codexOpsState.tasks, undefined, 'stale server records are not restored');
});

test('revoked feature permissions and account switches redact saved drafts', async () => {
    for (const switchAccount of [false, true]) {
        const ctx = draftFixture(); ctx.captureProductionPermissionDrafts();
        ctx.accessControlAdminState = {}; ctx.codexOpsState = {};
        ctx.supabaseRpc = async () => ({ capabilities: { canView: false, canEdit: false } });
        ctx.invokeCodexOpsApi = async () => ({ canView: false, submissionEnabled: false });
        if (switchAccount) ctx.nativeAuthProfile = { id: 'account-b' };
        await ctx.restoreProductionPermissionDrafts();
        assert.equal(ctx.accessControlAdminState.editor, undefined); assert.equal(ctx.codexOpsState.draft, undefined);
    }
});

test('limited-access manager drafts restore only for a currently permitted user target', async () => {
    for (const allowed of [true, false]) {
        const ctx = draftFixture(); ctx.captureProductionPermissionDrafts();
        ctx.accessControlAdminState = {}; ctx.codexOpsState = {};
        ctx.supabaseRpc = async () => ({ capabilities: { canView: true, canEdit: true, canPublish: false, editScope: 'limited-users' }, users: allowed ? [{ username: 'fixture-user' }] : [] });
        await ctx.restoreProductionPermissionDrafts();
        assert.equal(!!ctx.accessControlAdminState.editor, allowed);
        assert.equal(ctx.accessControlAdminState.publishReason, undefined);
    }
});

test('a failed feature-permission read retains the draft privately for a later safe retry', async () => {
    const ctx = draftFixture(); ctx.captureProductionPermissionDrafts();
    ctx.accessControlAdminState = {}; ctx.codexOpsState = {};
    const read = ctx.supabaseRpc;
    ctx.supabaseRpc = async () => { throw new Error('network unavailable'); };
    await assert.rejects(ctx.restoreProductionPermissionDrafts(), /network/);
    assert.equal(ctx.accessControlAdminState.editor, undefined);
    ctx.captureProductionPermissionDrafts(); // Retry must not replace saved draft with reset caches.
    ctx.supabaseRpc = read; await ctx.restoreProductionPermissionDrafts();
    assert.equal(ctx.accessControlAdminState.editor.reason, 'unsaved reason');
});

test('permission overlay obscures and disables the old app, retries centrally, and restores prior inert state', () => {
    const ctx = draftFixture(); const signals = [];
    const existing = [{ inert: false, isConnected: true }, { inert: true, isConnected: true }];
    let overlay = null;
    ctx.signalProductionLiveSync = (...args) => signals.push(args);
    ctx.document = {
        getElementById: () => overlay,
        body: { children: existing, appendChild: (node) => { overlay = node; existing.push(node); } },
        createElement: () => {
            const button = { focus() {} }, status = {};
            return { style: {}, setAttribute() {}, querySelector: (selector) => selector === 'button' ? button : status, remove: () => { existing.splice(existing.indexOf(overlay), 1); overlay = null; } };
        }
    };
    ctx.setProductionPermissionCheckState('checking');
    assert.equal(existing[0].inert, true); assert.match(overlay.style.cssText, /inset:0/);
    assert.equal(overlay.querySelector('button').disabled, true);
    ctx.setProductionPermissionCheckState('failed');
    assert.equal(overlay.querySelector('button').disabled, false);
    overlay.querySelector('button').onclick(); assert.deepEqual(signals, [['permissions-retry', 0]]);
    ctx.setProductionPermissionCheckState('');
    assert.equal(existing[0].inert, false); assert.equal(existing[1].inert, true); assert.equal(overlay, null);
});

test('native Codex live updates do not start the redundant fifteen-second timer', () => {
    const from = html.indexOf('function scheduleCodexOpsPoll()');
    const to = html.indexOf('function stopCodexOpsPoll()', from);
    let stopped = false;
    const ctx = { stopCodexOpsPoll: () => { stopped = true; }, shouldUseProductionLiveSyncSideLoad: () => true, setTimeout: () => { throw new Error('redundant poll'); } };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    assert.equal(ctx.scheduleCodexOpsPoll(), false); assert.equal(stopped, true);
});

test('Reclass delivery checks issue no requests while hidden and discard responses after suspension', async () => {
    const from = html.indexOf('async function pollReclassDeliveryJobs()');
    const to = html.indexOf('async function retryReclassDeliveryJob(', from);
    const ctx = { document: { hidden: true }, reclassDeliveryPollActive: false, requests: 0, updates: 0,
        getCurrentReclassDeliveryActor: () => 'fixture', renderReclassDeliveryStatusTray() {},
        readReclassDeliveryJobs: () => [{ actorUsername: 'fixture', sourceView: 'drive', status: 'queued', token: 'fixture' }],
        driveReclassApi: async () => { ctx.requests++; ctx.document.hidden = true; return { status: 'delivered' }; },
        upsertReclassDeliveryJob: () => { ctx.updates++; }
    };
    vm.createContext(ctx); vm.runInContext(html.slice(from, to), ctx);
    assert.equal(await ctx.pollReclassDeliveryJobs(), false); assert.equal(ctx.requests, 0);
    ctx.document.hidden = false; await ctx.pollReclassDeliveryJobs();
    assert.equal(ctx.requests, 1); assert.equal(ctx.updates, 0); assert.equal(ctx.reclassDeliveryPollActive, false);
});

test('Reclass delivery status reconciles immediately when visibility returns', () => {
    const marker = "document.addEventListener('visibilitychange', () => {\n            if (!document.hidden) void pollReclassDeliveryJobs();\n        }, { passive: true });";
    assert.ok(html.includes(marker)); let handler; let calls = 0;
    const ctx = { document: { hidden: true, addEventListener: (_, callback) => { handler = callback; } }, pollReclassDeliveryJobs: () => { calls++; } };
    vm.createContext(ctx); vm.runInContext(marker, ctx);
    handler(); assert.equal(calls, 0); ctx.document.hidden = false; handler(); assert.equal(calls, 1);
});

function nativeRecoveryFixture() {
    const gate = deferred(); let sessions = 0, refreshes = 0;
    const session = { access_token: 'native-token', user: { id: 'account-a' } };
    const ctx = { Error, Object, String, Promise, NATIVE_AUTH_ENABLED: true, SUPABASE_KEY: 'public-key',
        nativeAuthProfile: { id: 'account-a' }, nativeAuthSessionActive: true, nativeAuthAccessToken: '',
        getSupabaseBrowserClient: () => ({ auth: {
            getSession: async () => { sessions++; return { data: { session: null } }; },
            refreshSession: async () => { refreshes++; await gate.promise; return { data: { session } }; }
        } })
    };
    vm.createContext(ctx);
    vm.runInContext(html.slice(html.indexOf('let nativeAuthSessionRead ='), html.indexOf('function readCachedNativeAuthProfile')), ctx);
    return { ctx, gate, session, get sessions() { return sessions; }, get refreshes() { return refreshes; } };
}

test('native module reads share one restoration and refresh without changing auth mode', async () => {
    const f = nativeRecoveryFixture();
    const reads = Array.from({ length: 12 }, () => f.ctx.getNativeAuthRequestHeaders());
    await settle();
    assert.equal(f.sessions, 1); assert.equal(f.refreshes, 1);
    assert.equal(f.ctx.nativeAuthSessionActive, true);
    f.gate.resolve();
    const headers = await Promise.all(reads);
    assert.ok(headers.every(value => value.Authorization === 'Bearer native-token'));
});

test('logout and account changes invalidate delayed native token restoration', async () => {
    for (const change of ['nativeAuthRecoveryEpoch++', "nativeAuthProfile = { id: 'account-b' }"]) {
        const f = nativeRecoveryFixture(); const pending = f.ctx.getNativeAuthRequestHeaders();
        await settle(); vm.runInContext(change, f.ctx); f.gate.resolve();
        assert.equal(await pending, null);
        assert.equal(f.ctx.nativeAuthAccessToken, '');
    }
});

test('native database helpers never fall through to the prohibited legacy proxy', async () => {
    const calls = [], ctx = { Error, Object, String, Number, Math, JSON, Array, Promise,
        SUPABASE_READ_TIMEOUT_MS: 1000, SUPABASE_URL: 'https://test.invalid',
        normalizeAppTableName: value => value, nativeReadRequiresRls: () => true,
        nativeSessionRecoveryError: () => Object.assign(new Error('Recover session'), { code: 'NATIVE_SESSION_RECOVERY_REQUIRED' }),
        getNativeAuthRequestHeaders: async () => null,
        fetchWithTimeout: async (_, options) => { calls.push(options); return { ok: true, text: async () => '[{"unique_id":"one"}]' }; },
        parseSupabaseContentRangeTotal: () => 1
    };
    vm.createContext(ctx);
    vm.runInContext(html.slice(html.indexOf('async function fetchAuthenticatedSupabaseReadPage('), html.indexOf('async function fetchSupabaseRowsPage(')), ctx);
    vm.runInContext(html.slice(html.indexOf('async function runAppApiSupabaseWrite('), html.indexOf('async function supabaseFetch(')), ctx);
    await assert.rejects(ctx.runAppApiSupabaseWrite('ph_master_inventory', 'GET', null, 'select=*'), error => error.code === 'NATIVE_SESSION_RECOVERY_REQUIRED');
    assert.equal(calls.length, 0);
    ctx.getNativeAuthRequestHeaders = async () => ({ Authorization: 'Bearer native-token' });
    const rows = await ctx.runAppApiSupabaseWrite('ph_master_inventory', 'GET', null, 'select=*', { count: true });
    assert.equal(rows.length, 1); assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.Prefer, 'count=exact');
    assert.equal(calls[0].headers.Authorization, 'Bearer native-token');
});


test('progressive disk display accepts an older revision only with the same account, query and permissions', async () => {
    const meta = { scope: 'account-a', adapterId: 'core:master', cacheKey: 'master/all', signature: JSON.stringify(['permission-a', ['master', '2', 'ready']]) };
    let saved = { format: 'verified-raw-v1', meta: { ...meta, signature: JSON.stringify(['permission-a', ['master', '1', 'ready']]) }, rawRows: [{ id: 'old-row' }], rowCount: 1 };
    const ctx = { JSON, Array, loadCacheValue: async () => saved, verifiedSnapshotCacheKey: () => 'scope-key', buildDatasetPayload: (_, rows) => ({ data: rows }) };
    vm.createContext(ctx);
    const from = html.indexOf('async function readProductionDisplaySnapshot(');
    vm.runInContext(html.slice(from, html.indexOf('function previewProductionSnapshots(', from)), ctx);
    const read = () => ctx.readProductionDisplaySnapshot({ id: 'core:master' }, meta);
    assert.equal((await read()).cached, true);
    const original = saved;
    for (const change of [
        { meta: { ...saved.meta, scope: 'account-b' } },
        { meta: { ...saved.meta, cacheKey: 'other/query' } },
        { meta: { ...saved.meta, signature: JSON.stringify(['permission-b']) } },
        { format: 'legacy-unscoped' }, { rowCount: 2 }
    ]) { saved = { ...original, ...change }; assert.equal(await read(), null); }
});

test('SIGNED_OUT watcher invalidates pending native recovery before clearing the session', () => {
    const calls = []; let callback;
    const ctx = { window: {}, nativeAuthProfile: { id: 'account-a' }, nativeAuthSessionActive: true, nativeAuthAccessToken: 'old',
        getSupabaseBrowserClient: () => ({ auth: { onAuthStateChange: fn => { callback = fn; return {}; } } }),
        invalidateNativeAuthRecovery: () => calls.push('invalidate'), resetProductionLiveSync: () => calls.push('reset'),
        closeBloomscapesPendingOrders: () => calls.push('close') };
    vm.createContext(ctx);
    const from = html.indexOf('function installNativeRoleRefreshWatchers()');
    vm.runInContext(html.slice(from, html.indexOf("document.addEventListener('visibilitychange'", from)), ctx);
    ctx.installNativeRoleRefreshWatchers(); callback('SIGNED_OUT', null);
    assert.deepEqual(calls.slice(0, 2), ['invalidate', 'reset']);
    assert.equal(ctx.nativeAuthSessionActive, false); assert.equal(ctx.nativeAuthAccessToken, '');
});


test('native background validation refreshes the existing session without signing in again or persisting a password', async () => {
    let callback; const calls = [];
    const ctx = { String, currentUser: 'alice', nativeAuthRecoveryEpoch: 4, navigator: { onLine: true },
        normalizeSessionIdentity: value => value.trim().toLowerCase(), nativeReadRequiresRls: () => true,
        setTimeout: fn => { callback = fn; }, getNativeAuthRequestHeaders: async () => { calls.push('headers'); return {}; },
        refreshNativeRoleAndCapabilities: async () => { calls.push('roles'); },
        fetchRemoteLoginUser: async () => { calls.push('forbidden-password-login'); },
        persistVerifiedLoginRecord: () => { calls.push('forbidden-password-storage'); } };
    vm.createContext(ctx);
    const from = html.indexOf('function scheduleBackgroundLoginValidation(');
    vm.runInContext(html.slice(from, html.indexOf('function getLoginReadHeaders()', from)), ctx);
    ctx.scheduleBackgroundLoginValidation('alice', 'synthetic'); await callback();
    assert.deepEqual(calls, ['headers', 'roles']);
    calls.length = 0; ctx.scheduleBackgroundLoginValidation('alice', 'synthetic'); ctx.currentUser = 'bob'; await callback();
    assert.deepEqual(calls, []);
});


test('initial restored auth event keeps its pending session read while a known account change invalidates it', () => {
    const calls = []; let callback;
    const ctx = { window: {}, nativeAuthProfile: null,
        getSupabaseBrowserClient: () => ({ auth: { onAuthStateChange: fn => { callback = fn; return {}; } } }),
        invalidateNativeAuthRecovery: () => calls.push('invalidate'), resetProductionLiveSync: () => calls.push('reset'),
        closeBloomscapesPendingOrders: () => {}, setTimeout: () => {} };
    vm.createContext(ctx);
    const from = html.indexOf('function installNativeRoleRefreshWatchers()');
    vm.runInContext(html.slice(from, html.indexOf("document.addEventListener('visibilitychange'", from)), ctx);
    ctx.installNativeRoleRefreshWatchers(); callback('INITIAL_SESSION', { user: { id: 'account-a' } });
    assert.deepEqual(calls, []);
    ctx.nativeAuthProfile = { id: 'account-a' };
    callback('SIGNED_IN', { user: { id: 'account-b' } });
    assert.deepEqual(calls, ['invalidate', 'reset']);
});
