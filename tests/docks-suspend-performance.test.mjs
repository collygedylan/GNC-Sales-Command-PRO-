import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const coordinatorSource = readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function extractFunction(name, stopAt) {
    const start = html.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    const end = html.indexOf(stopAt, start);
    assert.ok(end > start, `${name} boundary`);
    return html.slice(start, end);
}

function inventoryReadFixture(options = {}) {
    const calls = [];
    let active = 0, maxActive = 0;
    const context = {
        Error, Number, Math, Array, Object, JSON, Set, String, Promise,
        fetchInventoryReadPage: async (_operation, _params, limit, offset) => {
            calls.push(offset);
            active++;
            maxActive = Math.max(maxActive, active);
            const delay = options.delayByOffset?.[offset] ?? options.delayMs ?? 2;
            await (options.wait ? options.wait(delay) : new Promise(resolve => setTimeout(resolve, delay)));
            active--;
            if (options.failOffset === offset) throw new Error('synthetic page failure');
            const total = options.totalAtOffset === offset ? options.changedTotal : (options.total ?? 7);
            const length = options.shortOffset === offset ? 1 : Math.max(0, Math.min(limit, total - offset));
            return { total, rows: Array.from({ length }, (_, index) => ({ unique_id: `row-${offset + index}` })),
                projection: 'browse', fieldCoverage: 'browse', columns: ['unique_id'] };
        },
        yieldToUiFrame: async () => {}
    };
    vm.createContext(context);
    vm.runInContext(extractFunction('fetchAllInventoryReadRows', 'let inventorySchemaCapabilitiesPromise'), context);
    return { context, calls, get maxActive() { return maxActive; } };
}

test('opt-in inventory paging uses two bounded workers and returns rows in offset order', async () => {
    const fixture = inventoryReadFixture();
    let firstPage = 0;
    const rows = await fixture.context.fetchAllInventoryReadRows('master_page', { dataset: 'master' }, {
        limit: 2, pageConcurrency: 2, requireComplete: true, onFirstPage: () => { firstPage++; }
    });
    assert.equal(fixture.maxActive, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row => row.unique_id))), Array.from({ length: 7 }, (_, index) => `row-${index}`));
    assert.equal(firstPage, 1);
    assert.deepEqual(fixture.calls.slice(0, 3).sort((a, b) => a - b), [0, 2, 4]);
    assert.deepEqual(fixture.calls.sort((a, b) => a - b), [0, 2, 4, 6]);
});

test('controlled network cold paging p95 improves by at least 40% with two workers', async (t) => {
    const measure = async (pageConcurrency) => {
        const samples = [];
        for (let run = 0; run < 20; run++) {
            // Drive the actual paging function with a deterministic network clock.
            // Browser/CI CPU contention cannot change this scheduling contract.
            let clock = 0, done = false;
            const pending = [];
            const fixture = inventoryReadFixture({ total: 9466, delayMs: 100 + (run % 5) * 10,
                wait: delay => new Promise(resolve => pending.push({ at: clock + delay, resolve })) });
            const read = fixture.context.fetchAllInventoryReadRows('master_page', { dataset: 'master' }, {
                limit: 500, pageConcurrency, requireComplete: true
            }).finally(() => { done = true; });
            for (let tick = 0; !done && tick < 100; tick++) {
                await settle();
                if (!pending.length) continue;
                clock = Math.min(...pending.map(task => task.at));
                const ready = pending.filter(task => task.at === clock);
                ready.forEach(task => { pending.splice(pending.indexOf(task), 1); task.resolve(); });
            }
            await read;
            samples.push(clock);
        }
        samples.sort((a, b) => a - b);
        return samples[Math.ceil(samples.length * 0.95) - 1];
    };
    const sequentialP95 = await measure(1);
    const parallelP95 = await measure(2);
    const improvement = 1 - parallelP95 / sequentialP95;
    t.diagnostic(`controlled network paging p95 (19 pages): sequential=${sequentialP95.toFixed(1)}ms, parallel=${parallelP95.toFixed(1)}ms, improvement=${(improvement * 100).toFixed(1)}%`);
    assert.ok(improvement >= 0.4, `expected >=40% improvement, measured ${(improvement * 100).toFixed(1)}%`);
});
test('inventory paging stays sequential unless two-page concurrency is explicitly requested', async () => {
    const fixture = inventoryReadFixture();
    await fixture.context.fetchAllInventoryReadRows('master_page', { dataset: 'master' }, { limit: 2, requireComplete: true });
    assert.equal(fixture.maxActive, 1);
    assert.deepEqual(fixture.calls, [0, 2, 4, 6]);
});

test('parallel inventory paging discards a short page rather than presenting incomplete rows', async () => {
    const fixture = inventoryReadFixture({ shortOffset: 2 });
    await assert.rejects(fixture.context.fetchAllInventoryReadRows('master_page', { dataset: 'master' }, {
        limit: 2, pageConcurrency: 2, requireComplete: true
    }), /page was incomplete/i);
});

test('Docks workflow display cache round-trips Maps without granting a live write proof', () => {
    const start = html.indexOf('const PRODUCTION_DISPLAY_CACHE_SIDE_ADAPTERS = new Set(');
    const end = html.indexOf('let productionLiveSyncCoordinator = null;', start);
    assert.ok(start >= 0 && end > start);
    const context = { Array, Map, Set, WeakMap, String, JSON, Math, Number, Object, MutationObserver: undefined };
    vm.createContext(context);
    vm.runInContext(html.slice(start, end), context);
    const adapter = { id: 'side:dockWorkflow' };
    const value = {
        trips: new Map([['trip-1', { tripnumber: 'trip-1', status: 'Loading' }]]),
        items: new Map([['soc-1', { checker: true, inspector: false }]]),
        issues: new Map([['soc-1', { issueSourceUniqueId: 'soc-1', issueState: 'open' }]]),
        allocations: new Map([['allocation-1', { allocationUniqueId: 'allocation-1', issueSourceUniqueId: 'soc-1' }]])
    };
    const serialized = context.serializeProductionSideDisplayValue(adapter, value);
    assert.ok(context.isBoundedProductionSideDisplayValue(adapter, serialized));
    const persisted = JSON.parse(JSON.stringify(serialized));
    const restored = context.deserializeProductionSideDisplayValue(adapter, persisted);
    assert.ok(restored.trips instanceof Map);
    assert.equal(restored.trips.get('trip-1').status, 'Loading');
    assert.equal(restored.items.get('soc-1').checker, true);
    assert.equal(restored.issues.get('soc-1').issueState, 'open');
    assert.deepEqual(JSON.parse(JSON.stringify(restored.bySource.get('soc-1'))), [persisted.allocations[0][1]]);
    assert.equal(context.deserializeProductionSideDisplayValue(adapter, { ...persisted, allocations: [['bad']] }), null);
});


test('parallel inventory paging rejects a changed total', async () => {
    const fixture = inventoryReadFixture({ totalAtOffset: 2, changedTotal: 8 });
    await assert.rejects(fixture.context.fetchAllInventoryReadRows('master_page', { dataset: 'master' }, {
        limit: 2, pageConcurrency: 2, requireComplete: true
    }), /total changed between pages/i);
});

test('parallel inventory paging does not schedule more pages after a worker fails', async () => {
    const fixture = inventoryReadFixture({ failOffset: 2, delayByOffset: { 2: 0, 4: 15 } });
    await assert.rejects(fixture.context.fetchAllInventoryReadRows('master_page', { dataset: 'master' }, {
        limit: 2, pageConcurrency: 2, requireComplete: true
    }), /synthetic page failure/i);
    assert.deepEqual(fixture.calls.sort((a, b) => a - b), [0, 2, 4]);
});
test('synthetic cached Docks workflow codec round trip stays under 250ms', (t) => {
    const start = html.indexOf('const PRODUCTION_DISPLAY_CACHE_SIDE_ADAPTERS = new Set(');
    const end = html.indexOf('let productionLiveSyncCoordinator = null;', start);
    const context = { Array, Map, Set, WeakMap, String, JSON, Math, Number, Object, MutationObserver: undefined };
    vm.createContext(context);
    vm.runInContext(html.slice(start, end), context);
    const adapter = { id: 'side:dockWorkflow' };
    const items = new Map(Array.from({ length: 3000 }, (_, index) => [`row-${index}`, {
        unique_id: `row-${index}`, itemcode: `ITEM-${index % 90}`, dock_num: String(index % 24), status: 'Open'
    }]));
    const display = { trips: new Map(), items, issues: new Map(), allocations: new Map() };
    const started = performance.now();
    const saved = context.serializeProductionSideDisplayValue(adapter, display);
    const restored = context.deserializeProductionSideDisplayValue(adapter, JSON.parse(JSON.stringify(saved)));
    const elapsed = performance.now() - started;
    t.diagnostic(`synthetic cached Docks codec round trip: ${elapsed.toFixed(1)}ms for ${restored.items.size} rows`);
    assert.equal(restored.items.size, 3000);
    assert.ok(elapsed < 250, `expected <250ms, measured ${elapsed.toFixed(1)}ms`);
});
test('live-sync suspension clears write proof until a matching foreground success', () => {
    const blocks = [
        ['function productionVerifiedViewKey(', 'function canUseProductionLiveSync()'],
        ['function hasCurrentProductionLiveSyncProof(', 'function invalidateProductionLiveSyncProofForSuspend('],
        ['function invalidateProductionLiveSyncProofForSuspend(', 'function updateProductionLiveSyncProofFromStatus('],
        ['function updateProductionLiveSyncProofFromStatus(', 'function requireCurrentProductionLiveSyncProof('],
        ['window.AgMetricLifecycle.subscribe(({ type, reason }) => {', "document.addEventListener('focusout'"]
    ].map(([startText, endText]) => {
        const start = html.indexOf(startText);
        const end = html.indexOf(endText, start + startText.length);
        assert.ok(start >= 0 && end > start, `${startText} boundary`);
        return html.slice(start, end);
    });
    let lifecycleListener = null, suspended = 0, renderedStatus = null;
    const context = {
        JSON, String, navigator: { onLine: true }, document: { hidden: false },
        productionLiveSyncVerifiedView: '',
        productionDisplayGroups: new Set(['saved-display-group']),
        nativeAuthSessionActive: true, nativeAuthProfile: { id: 'account-1', username: 'qc_user' }, currentUser: 'qc_user',
        viewContext: { scope: 'account-1/qc_user', dataPermissionVersion: 'perm-1', viewKey: 'docks:1',
            adapters: [{ id: 'core:master', cacheKey: 'browse-v1' }] },
        getProductionLiveSyncContext: () => context.viewContext,
        canUseProductionLiveSync: () => true,
        renderProductionDataFreshness(status) { renderedStatus = status; },
        productionLiveSyncCoordinator: { suspend() { suspended++; } },
        signalProductionLiveSync() {},
        window: { AgMetricLifecycle: { subscribe(listener) { lifecycleListener = listener; } } }
    };
    vm.createContext(context);
    blocks.slice(0, 4).forEach(block => vm.runInContext(block, context));
    const expectedKey = vm.runInContext('productionVerifiedViewKey()', context);
    context.productionLiveSyncVerifiedView = expectedKey;
    assert.equal(vm.runInContext('hasCurrentProductionLiveSyncProof()', context), true);
    vm.runInContext(blocks[4], context);
    lifecycleListener({ type: 'suspend', reason: 'pagehide' });
    assert.equal(suspended, 1);
    assert.equal(vm.runInContext('productionLiveSyncVerifiedView', context), '');
    assert.equal(vm.runInContext('hasCurrentProductionLiveSyncProof()', context), false);
    assert.equal(renderedStatus.state, 'Syncing');
    assert.equal(vm.runInContext("productionDisplayGroups.has('saved-display-group')", context), true,
        'suspension keeps saved display data available');
    context.updateProductionLiveSyncProofFromStatus({ state: 'Up to date', contextKey: 'old-context' });
    assert.equal(vm.runInContext('hasCurrentProductionLiveSyncProof()', context), false,
        'a success status for another view cannot restore proof');
    context.updateProductionLiveSyncProofFromStatus({ state: 'Syncing', contextKey: expectedKey });
    assert.equal(vm.runInContext('hasCurrentProductionLiveSyncProof()', context), false);
    context.updateProductionLiveSyncProofFromStatus({ state: 'Up to date', contextKey: expectedKey });
    assert.equal(vm.runInContext('hasCurrentProductionLiveSyncProof()', context), true);
    context.document.hidden = true;
    lifecycleListener({ type: 'visibility', reason: 'hidden' });
    assert.equal(suspended, 2);
    assert.equal(vm.runInContext('hasCurrentProductionLiveSyncProof()', context), false);
    context.document.hidden = false;
    context.updateProductionLiveSyncProofFromStatus({ state: 'Up to date', contextKey: expectedKey });
    assert.equal(vm.runInContext('hasCurrentProductionLiveSyncProof()', context), true);
});
test('per-context coordinator stage concurrency remains bounded and keeps the default elsewhere', async () => {
    const sandbox = { module: { exports: {} }, setTimeout, clearTimeout, AbortController };
    vm.runInNewContext(coordinatorSource, sandbox);
    const { createCoordinator } = sandbox.module.exports;
    const gates = [], adapters = [];
    let active = 0, maxActive = 0;
    for (let index = 0; index < 4; index++) adapters.push({
        id: `core:${index}`, cacheKey: String(index), sourceKeys: [`source-${index}`],
        stage: async () => {
            active++; maxActive = Math.max(maxActive, active);
            await new Promise(resolve => gates.push(resolve));
            active--; return index;
        }, commit() {}
    });
    const context = { scope: 'account-a', view: 'docks', viewKey: 'docks', visible: true, online: true, adapters };
    const coordinator = createCoordinator({ getContext: () => context, concurrency: 1,
        getForegroundConcurrency: ctx => ctx.view === 'docks' ? 2 : 1,
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1', sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) }) });
    const pending = coordinator.check();
    await settle();
    assert.equal(maxActive, 2);
    while (gates.length) { gates.splice(0).forEach(resolve => resolve()); await settle(); }
    assert.equal(await pending, true);
    assert.equal(maxActive, 2);
    coordinator.reset();
});
