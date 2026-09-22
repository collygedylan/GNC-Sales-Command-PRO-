import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const sandbox = { module: { exports: {} }, setTimeout, clearTimeout, AbortController };
vm.runInNewContext(readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8'), sandbox);
const { createCoordinator } = sandbox.module.exports;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function fixture() {
    let revision = '1', state = 'ready', permission = 'role-v1', clock = 1000;
    let rows = [{ id: 'dock-28' }], reads = 0, metadataReads = 0, subscriptions = 0, closes = 0;
    let fault = null, loadHook = null, metadataHook = null, notify = null;
    const commits = [], statuses = [], timers = new Map(); let timerId = 0;
    const adapter = { id: 'core:soc', cacheKey: 'soc/all', sourceKeys: ['ph_soc_master'],
        stage: async () => { reads++; if (fault) throw fault; const captured = structuredClone(rows); if (loadHook) await loadHook(); return captured; },
        commit: (value) => commits.push(value) };
    const context = { scope: 'same-user/site-role-v1', viewKey: 'docks', visible: true, online: true, adapters: [adapter] };
    const coordinator = createCoordinator({
        getContext: () => context,
        readRevisions: async (keys) => {
            metadataReads++; if (metadataHook) await metadataHook();
            return { contractVersion: 1, permissionVersion: permission, serverTime: '2026-09-08T00:00:00Z',
                sources: keys.map((key) => ({ key, revision, state, changedAt: '2026-09-08T00:00:00Z' })) };
        },
        onStatus: (value) => statuses.push(value), now: () => clock,
        subscribe: (changed) => { subscriptions++; notify = changed; return () => { closes++; }; },
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
        clearTimeout: (id) => timers.delete(id)
    });
    return { coordinator, context, adapter, commits, statuses, timers,
        set revision(value) { revision = value; }, set state(value) { state = value; }, set rows(value) { rows = value; },
        set fault(value) { fault = value; }, set loadHook(value) { loadHook = value; }, set metadataHook(value) { metadataHook = value; },
        set permission(value) { permission = value; },
        get reads() { return reads; }, get metadataReads() { return metadataReads; }, get subscriptions() { return subscriptions; }, get closes() { return closes; },
        notify: () => notify?.(),
        advance: async (milliseconds) => {
            clock += milliseconds;
            for (const [id, timer] of Array.from(timers)) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
            await settle();
        }
    };
}

test('metadata before and after the read gates the first authoritative snapshot', async () => {
    const f = fixture(); assert.equal(await f.coordinator.check(), true);
    assert.equal(f.metadataReads, 2); assert.equal(f.reads, 1);
    assert.deepEqual(f.commits[0], [{ id: 'dock-28' }]);
    assert.equal(f.coordinator.getStatus().state, 'Up to date');
});
test('unchanged revisions perform no full downloads; a healthy socket never stops the 30s check', async () => {
    const f = fixture(); await f.coordinator.check(); const first = f.metadataReads;
    await f.advance(30000);
    assert.equal(f.subscriptions, 1); assert.equal(f.metadataReads, first + 1); assert.equal(f.reads, 1);
});
test('same row count updates and deletions replace the old snapshot', async () => {
    const f = fixture(); await f.coordinator.check();
    f.revision = '2'; f.rows = [{ id: 'dock-29' }]; await f.coordinator.check();
    f.revision = '3'; f.rows = []; await f.coordinator.check();
    assert.deepEqual(f.commits.at(-2), [{ id: 'dock-29' }]); assert.deepEqual(f.commits.at(-1), []);
});
test('overlapping signals are deduplicated and do not duplicate full reads', async () => {
    const f = fixture(); const gate = deferred(); f.loadHook = () => gate.promise;
    const first = f.coordinator.check(); await settle();
    const second = f.coordinator.check(); f.notify(); f.notify();
    gate.resolve(); await Promise.all([first, second]); await f.advance(250);
    assert.equal(f.reads, 1); assert.equal(f.commits.length, 1);
});
test('import between pages discards the partial load and waits for ready', async () => {
    const f = fixture(); f.loadHook = async () => { f.state = 'importing'; f.revision = '2'; };
    assert.equal(await f.coordinator.check(), false); assert.equal(f.commits.length, 0);
    assert.equal(f.coordinator.getStatus().state, 'Importing');
    f.loadHook = null; f.state = 'ready'; f.revision = '3'; f.rows = [{ id: 'complete-import' }];
    await f.coordinator.check(); assert.deepEqual(f.commits.at(-1), [{ id: 'complete-import' }]);
});
test('interrupted imports retain verified rows and never become ready from a socket', async () => {
    const f = fixture(); await f.coordinator.check(); f.state = 'interrupted'; f.revision = '2';
    await f.coordinator.check(); f.notify(); await f.advance(250);
    assert.equal(f.reads, 1); assert.equal(f.commits.length, 1);
    assert.equal(f.coordinator.getStatus().state, 'Needs attention');
});
test('network failures keep old data visibly stale instead of committing an empty list', async () => {
    const f = fixture(); await f.coordinator.check(); f.revision = '2'; f.fault = new Error('Read timed out');
    await f.coordinator.check(); assert.equal(f.commits.length, 1);
    assert.equal(f.coordinator.getStatus().state, 'Needs attention');
    assert.match(f.coordinator.getStatus().message, /timed out/);
});
test('verification timestamps and metadata failures belong to the current screen', async () => {
    const f = fixture();
    await f.coordinator.check();
    const verifiedAt = f.coordinator.getStatus().lastVerifiedAt;
    assert.equal(verifiedAt, 1000);
    f.context.viewKey = 'request:pending';
    f.metadataHook = async () => { throw new Error('Request metadata failed'); };
    assert.equal(await f.coordinator.check(), false);
    const status = f.coordinator.getStatus();
    assert.equal(status.state, 'Needs attention');
    assert.equal(status.lastVerifiedAt, null, 'a new screen must not inherit another screen verification');
    assert.equal(status.contextKey, JSON.stringify([f.context.scope, f.context.viewKey, [[f.adapter.id, f.adapter.cacheKey]]]));
    f.context.viewKey = 'docks';
    await f.coordinator.check();
    assert.equal(f.coordinator.getStatus().lastVerifiedAt, verifiedAt, 'retained data keeps its own previous verification');
});

test('account changes discard all prior screen verification timestamps', async () => {
    const f = fixture();
    const firstScope = f.context.scope;
    await f.coordinator.check();
    f.context.scope = 'other-account';
    await f.coordinator.check();
    f.context.scope = firstScope;
    f.metadataHook = async () => { throw new Error('New session read failed'); };
    await f.coordinator.check();
    assert.equal(f.coordinator.getStatus().lastVerifiedAt, null);
});

test('the first required-read failure publishes promptly, aborts siblings and leaves retryable state', async () => {
    const siblingStarted = deferred(), statuses = [], commits = [], attempts = [];
    let shouldFail = true, queuedReads = 0, statusAtAbort = '';
    const adapters = [
        { id: 'core:primary', cacheKey: 'primary/all', sourceKeys: ['primary'], stage: async () => {
            attempts.push('primary'); await siblingStarted.promise;
            if (shouldFail) throw new Error('Primary request timed out');
            return ['primary'];
        }, commit: value => commits.push(value) },
        { id: 'core:sibling', cacheKey: 'sibling/all', sourceKeys: ['sibling'], stage: async ({ signal }) => {
            attempts.push('sibling'); siblingStarted.resolve();
            if (!shouldFail) return ['sibling'];
            return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
                statusAtAbort = statuses.at(-1)?.state || '';
                reject(signal.reason || new Error('Sibling aborted'));
            }, { once: true }));
        }, commit: value => commits.push(value) },
        { id: 'core:queued', cacheKey: 'queued/all', sourceKeys: ['queued'], stage: async () => {
            queuedReads++; return ['queued'];
        }, commit: value => commits.push(value) },
    ];
    const context = { scope: 'same-user/site-role-v1', viewKey: 'requests', visible: true, online: true, adapters };
    const coordinator = createCoordinator({ getContext: () => context, concurrency: 2,
        setTimeout: () => 1, clearTimeout() {}, onStatus: status => statuses.push(status),
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1',
            sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) }) });

    assert.equal(await coordinator.check(), false);
    assert.equal(statusAtAbort, 'Needs attention', 'failure status must publish before sibling cancellation settles');
    assert.equal(statuses.at(-1).message, 'Primary request timed out', 'a sibling abort must not replace the original error');
    assert.equal(statuses.at(-1).contextKey, JSON.stringify([context.scope, context.viewKey,
        adapters.map(adapter => [adapter.id, adapter.cacheKey])]));
    assert.equal(queuedReads, 0, 'no queued sibling may start after the first failure');
    assert.equal(commits.length, 0, 'an incomplete cohort must never commit');

    shouldFail = false;
    assert.equal(await coordinator.check(), true);
    assert.equal(queuedReads, 1);
    assert.deepEqual(attempts, ['primary', 'sibling', 'primary', 'sibling']);
    assert.deepEqual(commits, [['primary'], ['sibling'], ['queued']]);
    assert.equal(coordinator.getStatus().state, 'Up to date');
    coordinator.reset();
});
test('a background failure finishing after navigation cannot replace the new foreground state', async () => {
    const backgroundGate = deferred(), timers = new Map(), foregroundStatuses = [], backgroundStatuses = [];
    let timerId = 0, backgroundStarted = false;
    const first = { id: 'core:first', cacheKey: 'first/all', sourceKeys: ['first'], stage: async () => ['first'], commit() {} };
    const second = { id: 'core:second', cacheKey: 'second/all', sourceKeys: ['second'], stage: async () => ['second'], commit() {} };
    const deferredBackground = { id: 'core:deferred', cacheKey: 'deferred/all', sourceKeys: ['deferred'], stage: async () => {
        backgroundStarted = true; await backgroundGate.promise; throw new Error('obsolete background failure');
    }, commit() {} };
    const context = { scope: 'same-user/site-role-v1', viewKey: 'first', visible: true, online: true,
        adapters: [first], backgroundAdapters: [deferredBackground] };
    const coordinator = createCoordinator({ getContext: () => context, backgroundDelayMs: 0,
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        onStatus: status => foregroundStatuses.push(status), onBackgroundStatus: status => backgroundStatuses.push(status),
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1',
            sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) }) });

    assert.equal(await coordinator.check(), true);
    await settle();
    const backgroundTimer = Array.from(timers.entries()).find(([, timer]) => timer.delay === 0);
    assert.ok(backgroundTimer, 'successful foreground verification must schedule its background cohort');
    timers.delete(backgroundTimer[0]); backgroundTimer[1].callback(); await settle();
    assert.equal(backgroundStarted, true);

    context.viewKey = 'second'; context.adapters = [second]; context.backgroundAdapters = [];
    assert.equal(await coordinator.check('view-entry'), true);
    const nextContextKey = JSON.stringify([context.scope, context.viewKey, [[second.id, second.cacheKey]]]);
    assert.equal(coordinator.getStatus().contextKey, nextContextKey);
    backgroundGate.resolve(); await settle();
    assert.equal(coordinator.getStatus().state, 'Up to date');
    assert.equal(coordinator.getStatus().contextKey, nextContextKey);
    assert.ok(!backgroundStatuses.some(status => status.state === 'Needs attention'),
        'obsolete background failure must be discarded instead of publishing stale attention');
    assert.equal(foregroundStatuses.at(-1).state, 'Up to date');
    coordinator.reset();
});
test('a newer revision during fetch is retained and automatically reconciled', async () => {
    const f = fixture(); let first = true;
    f.loadHook = async () => { if (first) { first = false; f.revision = '9007199254740993'; f.rows = [{ id: 'newer' }]; } };
    await f.coordinator.check(); assert.equal(f.commits.length, 1);
    assert.deepEqual(f.commits[0], [{ id: 'newer' }]); assert.equal(f.coordinator.getStatistics().discardedLoads, 1);
});
test('account switch during a delayed response cannot apply old account rows', async () => {
    const f = fixture(); const gate = deferred(); f.loadHook = () => gate.promise;
    const running = f.coordinator.check(); await settle();
    f.context.scope = 'other-account'; f.rows = [{ id: 'other-account-row' }]; gate.resolve();
    await running; assert.deepEqual(f.commits, [[{ id: 'other-account-row' }]]);
    assert.equal(f.closes, 1);
});
test('permission revision changes invalidate cached adapters even without a stock change', async () => {
    const f = fixture(); await f.coordinator.check(); f.permission = 'role-v2'; f.rows = [{ id: 'allowed-now' }];
    await f.coordinator.check(); assert.equal(f.reads, 2); assert.deepEqual(f.commits.at(-1), [{ id: 'allowed-now' }]);
});
test('hidden sessions stop polling and unsubscribe; returning catches up without login', async () => {
    const f = fixture(); await f.coordinator.check(); f.context.visible = false; f.coordinator.suspend();
    const count = f.metadataReads; await f.advance(90000); assert.equal(f.metadataReads, count); assert.equal(f.closes, 1);
    f.context.visible = true; f.revision = '2'; f.rows = [{ id: 'dock-29' }]; f.coordinator.signal('visible', 0); await f.advance(0);
    assert.deepEqual(f.commits.at(-1), [{ id: 'dock-29' }]); assert.equal(f.subscriptions, 2);
});

for (const invalidate of ['suspend', 'reset']) {
    for (const phase of ['first revision', 'adapter load', 'final revision']) {
        test(`${invalidate} during ${phase} cannot restart reads in a closing document`, async () => {
            const f = fixture(), gate = deferred(); let revisionCall = 0;
            if (phase === 'adapter load') f.loadHook = () => gate.promise;
            else f.metadataHook = () => ++revisionCall === (phase === 'first revision' ? 1 : 2) ? gate.promise : undefined;
            const running = f.coordinator.check(); await settle();
            const reads = f.metadataReads;
            // pagehide can invalidate work before document.hidden changes.
            assert.equal(f.context.visible, true);
            f.coordinator[invalidate](); const statusCount = f.statuses.length;
            gate.resolve(); await running; await f.advance(90000);
            assert.equal(f.metadataReads, reads, 'invalidated work must not start another request');
            assert.equal(f.commits.length, 0, 'invalidated snapshots must not commit');
            assert.equal(f.statuses.length, statusCount, 'invalidated work must not publish completion');
            assert.equal(f.timers.size, 0, 'invalidated work must not rearm polling');
        });
    }
}

test('an explicit resume queued during a suspended load still verifies fresh data', async () => {
    const f = fixture(), gate = deferred(); f.loadHook = () => gate.promise;
    const running = f.coordinator.check(); await settle();
    f.coordinator.suspend(); f.rows = [{ id: 'resumed-data' }]; f.loadHook = null;
    const resumed = f.coordinator.check('resume'); gate.resolve();
    await Promise.all([running, resumed]);
    assert.deepEqual(f.commits, [[{ id: 'resumed-data' }]]);
    assert.equal(f.metadataReads, 3, 'skip the stale final read but retain both fresh verification reads');
    assert.equal(f.coordinator.getStatus().state, 'Up to date');
});
test('offline shows offline independently of a previously healthy subscription', async () => {
    const f = fixture(); await f.coordinator.check(); f.context.online = false;
    await f.coordinator.check(); assert.equal(f.coordinator.getStatus().state, 'Offline'); assert.equal(f.reads, 1);
});
test('two devices converge on matching sources without sharing their filter state', async () => {
    const android = fixture(), iphone = fixture();
    const filters = { android: ['customer-a'], iphone: [] };
    await Promise.all([android.coordinator.check(), iphone.coordinator.check()]);
    for (const device of [android, iphone]) { device.revision = '2'; device.rows = [{ id: 'dock-29', customer: 'new-customer' }]; }
    android.notify(); await android.advance(250); await iphone.advance(30000);
    assert.deepEqual(android.commits.at(-1), iphone.commits.at(-1));
    assert.deepEqual(filters, { android: ['customer-a'], iphone: [] });
});
test('missing or denied dependency never labels the view up to date', async () => {
    const f = fixture(); f.state = 'unavailable'; await f.coordinator.check();
    assert.equal(f.reads, 0); assert.equal(f.coordinator.getStatus().state, 'Needs attention');
});
test('query scope changes reload even when database revision is unchanged', async () => {
    const f = fixture(); await f.coordinator.check(); f.adapter.cacheKey = 'soc/new-season';
    await f.coordinator.check(); assert.equal(f.reads, 2);
});
test('explicit background warmup requests are removed after one cycle', async () => {
    const f = fixture(); const extra = { ...f.adapter, id: 'core:extra', cacheKey: 'extra/all' };
    await f.coordinator.ensure(extra); const count = f.reads; f.revision = '2'; await f.coordinator.check();
    assert.equal(f.reads, count + 1);
});
test('forced readiness restores an invalidated side state without reloading unrelated adapters', async () => {
    const f = fixture(); let extraReads = 0;
    f.context.adapters.push({ id: 'side:extra', cacheKey: 'extra/all', sourceKeys: ['extra'], stage: async () => { extraReads++; return []; }, commit() {} });
    await f.coordinator.check();
    assert.equal(await f.coordinator.ensure(f.adapter), true);
    assert.equal(f.reads, 1);
    assert.equal(await f.coordinator.ensure(f.adapter, true), true);
    assert.equal(f.reads, 2); assert.equal(f.commits.length, 2); assert.equal(extraReads, 1);
});
test('concurrent forced readiness requests share the same reload and cancellation cannot commit', async () => {
    for (const cancel of [false, true]) {
        const f = fixture(); await f.coordinator.check();
        const gate = deferred(); f.loadHook = () => gate.promise;
        const first = f.coordinator.ensure(f.adapter, true); await settle();
        const second = f.coordinator.ensure(f.adapter, true);
        if (cancel) f.coordinator.suspend();
        gate.resolve();
        assert.deepEqual(await Promise.all([first, second]), [!cancel, !cancel]);
        assert.equal(f.reads, 2); assert.equal(f.commits.length, cancel ? 1 : 2);
    }
});
test('forcing an adapter during an unchanged verification restores it before reporting success', async () => {
    const f = fixture(); await f.coordinator.check();
    const gate = deferred(); f.metadataHook = () => gate.promise;
    const check = f.coordinator.check(); await settle();
    const forced = f.coordinator.ensure(f.adapter, true); gate.resolve();
    assert.equal(await forced, true); await check;
    assert.equal(f.reads, 2); assert.equal(f.commits.length, 2);
});
test('an immediate resume supersedes a queued low-priority check', async () => {
    const f = fixture(); await f.coordinator.check(); f.revision = '2';
    f.coordinator.signal('background-request', 30000); f.coordinator.signal('resume', 0);
    await f.advance(0); assert.equal(f.reads, 2);
});

test('two visible aliases of the same physical snapshot issue one full read', async () => {
    const f = fixture(); f.context.adapters.push({ ...f.adapter });
    await f.coordinator.check(); assert.equal(f.reads, 1); assert.equal(f.commits.length, 1);
});

for (const finalFailure of [false, true]) test(`progressive display precedes completion and never creates proof on failure=${finalFailure}`, async () => {
    const gate = deferred(), shown = [], committed = [], statuses = [];
    const adapter = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'],
        stage: async ({ preview }) => {
            preview({ rows: ['first'], partial: true }); await gate.promise;
            if (finalFailure) throw new Error('Later page failed');
            return { rows: ['first', 'last'] };
        }, commit: value => committed.push(value) };
    const context = { scope: 'account-permissions', viewKey: 'drive', progressive: true, visible: true, online: true, adapters: [adapter] };
    const coordinator = createCoordinator({ getContext: () => context,
        setTimeout: () => 1, clearTimeout() {}, onStatus: status => statuses.push(status.state),
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1', sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) }),
        previewSnapshots: entries => shown.push(entries[0].value) });
    const pending = coordinator.check('visible-view'); await settle();
    assert.equal(shown.length, 1); assert.equal(shown[0].partial, true);
    assert.equal(committed.length, 0); assert.notEqual(statuses.at(-1), 'Up to date');
    gate.resolve(); assert.equal(await pending, !finalFailure);
    assert.equal(committed.length, finalFailure ? 0 : 1);
    assert.equal(statuses.at(-1), finalFailure ? 'Needs attention' : 'Up to date');
    coordinator.reset();
});

test('progressive callbacks cannot display an obsolete account response', async () => {
    const gate = deferred(), shown = [];
    const context = { scope: 'a', viewKey: 'drive', progressive: true, visible: true, online: true,
        adapters: [{ id: 'core:master', cacheKey: 'all', sourceKeys: ['inventory'], stage: async ({ preview }) => {
            await gate.promise; preview({ rows: ['old'], partial: true }); return { rows: ['old'] };
        }, commit() {} }] };
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1', sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) }),
        previewSnapshots: entries => shown.push(entries) });
    const pending = coordinator.check(); await settle(); context.scope = 'b'; coordinator.suspend(); gate.resolve();
    assert.equal(await pending, false); assert.equal(shown.length, 0);
});


test('progressive display does not wait for an extra requested startup dependency', async () => {
    const gate = deferred(), shown = [];
    const inventory = { id: 'inventory', cacheKey: 'all', sourceKeys: ['inventory'], stage: async ({ preview }) => {
        preview({ rows: ['first'], partial: true }); await gate.promise; return { rows: ['first', 'last'] };
    }, commit() {} };
    const extra = { id: 'startup-extra', cacheKey: 'all', sourceKeys: ['extra'], stage: async () => [], commit() {} };
    const context = { scope: 'a', viewKey: 'drive', progressive: true, visible: true, online: true, adapters: [inventory] };
    const coordinator = createCoordinator({ getContext: () => context, concurrency: 1, setTimeout: () => 1, clearTimeout() {},
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1', sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) }),
        previewSnapshots: entries => shown.push(entries.map(item => item.adapter.id)) });
    const pending = coordinator.ensure(extra); await settle();
    assert.equal(shown.length, 1); assert.equal(shown[0].join(','), 'inventory');
    gate.resolve(); assert.equal(await pending, true); coordinator.reset();
});

const appSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function appFunction(name) {
    const found = appSource.match(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(found, name);
    const end = appSource.indexOf('\n        function ', found.index + found[0].length);
    assert.ok(end > found.index, name + ' function boundary');
    return appSource.slice(found.index, end);
}

for (const [name, renderName] of [
    ['ensureSpreadCountInventoryData', 'renderProductionInventoryCountingContent'],
    ['ensureProductionWorkflowData', 'renderProductionWorkflowPanel'],
    ['ensureWeatherHoldInventoryData', 'renderWeatherHold'],
]) test(`${name} only rerenders after a completed full inventory load`, async () => {
    for (const [result, verified] of [[false, false], [true, false], [true, true]]) {
        let ready = false, renders = 0, loads = 0;
        const context = {
            isDatasetLoaded: () => ready, fullInventory: [], getActiveSpreadCountType: () => 'bunch',
            productionWorkflowActive: 'planting', isProductionWorkflowDriveType: () => true,
            productionWorkflowState: { loaded: true, workflowType: 'planting' },
            spreadCountState: { loaded: true, countType: 'bunch' },
            inventoryMainTab: 'production', productionInventoryTab: 'counting', isViewVisible: () => true,
            loadDatasetTargetsWithLimit: async () => { loads++; ready = verified; return result; },
            [renderName]: () => { renders++; },
        };
        vm.runInNewContext(`${appFunction(name)}; ${name}();`, context);
        await settle();
        assert.equal(loads, 1);
        assert.equal(renders, result && verified ? 1 : 0, 'A paused or incomplete read must not queue another render');
    }
});

test('hidden Inventory counting content does not trigger data reads', () => {
    for (const [visible, mainTab, subTab, expected] of [[true, 'sales', 'counting', 0], [false, 'production', 'counting', 0], [true, 'production', '84rd', 0], [true, 'production', 'counting', 1]]) {
        let renders = 0;
        vm.runInNewContext(`${appFunction('renderProductionInventoryCountingContent')}; renderProductionInventoryCountingContent();`, {
            document: { getElementById: () => ({}) }, isViewVisible: () => visible,
            inventoryMainTab: mainTab, productionInventoryTab: subTab, renderSpreadCountContent: () => { renders++; },
        });
        assert.equal(renders, expected);
    }
});

for (const [name, stateKey, args] of [
    ['loadSpreadCountData', 'spreadCountState', [false, 'bunch']],
    ['loadProductionWorkflowRows', 'productionWorkflowState', [false, 'planting']],
    ['loadPoManagementData', 'poManagementState', [false]],
]) test(`${name} restores reset state once without forcing healthy state`, async () => {
    const calls = [], state = { loaded: false, season: '27F1' };
    const context = {
        [stateKey]: state, shouldUseProductionLiveSyncSideLoad: () => true,
        normalizeSpreadCountType: value => value, isViewVisible: () => false,
        ensureProductionLiveSyncSideData: async (_id, force) => { calls.push(force); state.loaded = true; return true; },
    };
    vm.runInNewContext(appFunction(name), context);
    await context[name](...args); await context[name](...args);
    assert.deepEqual(calls, [true, false]);
});
