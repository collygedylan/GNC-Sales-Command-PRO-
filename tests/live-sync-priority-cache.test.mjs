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
function transportFixture(overrides = {}) {
    const calls = [], navigation = new AbortController();
    const ctx = { AbortController, WeakMap, Set, Error, Object, Math, Number, String, JSON,
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
    const ctx = { Error, Object, String, Math, Number, SUPABASE_WRITE_TIMEOUT_MS: 1000, APP_API_FUNCTION_URL: 'https://fixture.invalid',
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
