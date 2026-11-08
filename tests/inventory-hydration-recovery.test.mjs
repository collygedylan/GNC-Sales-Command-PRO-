import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createSnapshotError, isRecoverableSnapshotError, createRecoveryScheduler } from '../src/core/inventory-hydration-recovery.js';
const recoverable = () => createSnapshotError('incomplete', { expectedRows: 1000, actualRows: 423 });

function fixture(overrides = {}) {
    const timers = new Map(), calls = [];
    let timerId = 0;
    const context = { scope: 'account-a', readIdentity: 'login-1', viewKey: 'drive', authenticated: true, visible: true, online: true };
    const scheduler = createRecoveryScheduler({ getContext: () => context,
        shouldContinue: (start, current) => start.viewKey === current.viewKey,
        retry: async details => { calls.push(details); return true; },
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id), baseDelayMs: 10, maxDelayMs: 30, ...overrides });
    async function tick() {
        const [id, timer] = timers.entries().next().value || [];
        assert.ok(timer, 'a retry timer must exist');
        timers.delete(id);
        await timer.callback();
        return timer.delay;
    }
    return { scheduler, context, timers, calls, tick };
}

test('typed pagination failures are recoverable and preserve diagnostic counts', () => {
    const incomplete = recoverable(), changed = createSnapshotError('changed', 'Revision moved.');
    assert.equal(incomplete.code, 'INVENTORY_SNAPSHOT_INCOMPLETE');
    assert.equal(incomplete.actualRows, 423);
    assert.equal(changed.code, 'INVENTORY_SNAPSHOT_CHANGED');
    assert.equal(changed.message, 'Revision moved.');
    assert.equal(isRecoverableSnapshotError(incomplete), true);
    assert.equal(isRecoverableSnapshotError(changed), true);
    assert.equal(isRecoverableSnapshotError(new Error('Unclassified read failure.')), false);
    assert.throws(() => createSnapshotError('projection'), RangeError);
});

test('only the exact legacy snapshot consistency messages enter recovery', () => {
    const messages = ['Inventory page was incomplete; the partial snapshot was discarded.',
        'Inventory total changed between pages; the partial snapshot was discarded.',
        'Inventory keyset boundary was invalid; the partial snapshot was discarded.',
        'Complete inventory rows could not be verified. Retry the report.'];
    messages.forEach(message => assert.equal(isRecoverableSnapshotError(new Error(message)), true));
    messages.forEach(message => assert.equal(isRecoverableSnapshotError(new Error(`Other failure: ${message}`)), false));
    assert.equal(isRecoverableSnapshotError(new Error('Inventory field coverage changed between pages; the partial snapshot was discarded.')), true);
    assert.equal(isRecoverableSnapshotError(new Error('Inventory page rows were invalid.')), false);
    assert.equal(isRecoverableSnapshotError(new Error('Inventory response exceeded the safe page limit.')), false);
    assert.equal(isRecoverableSnapshotError(Object.assign(new Error(messages[0]), { status: 403 })), false);
});

test('a recoverable retry failure backs off and success returns its lane to idle', async () => {
    let attempts = 0;
    const f = fixture({ retry: async () => { attempts++; if (attempts === 1) throw recoverable(); return true; } });
    assert.equal(f.scheduler.schedule('foreground', recoverable()), true);
    assert.equal(await f.tick(), 10);
    assert.equal(f.scheduler.getState('foreground').status, 'scheduled');
    assert.equal(await f.tick(), 20);
    assert.equal(attempts, 2);
    assert.equal(f.timers.size, 0);
    assert.equal(f.scheduler.getState('foreground').status, 'idle');
    assert.equal(f.scheduler.getState('foreground').attempt, 0);
});

test('one pending or running retry owns each lane', async () => {
    let finish;
    const f = fixture({ retry: () => new Promise(resolve => { finish = resolve; }) });
    assert.equal(f.scheduler.schedule('foreground', recoverable()), true);
    assert.equal(f.scheduler.schedule('foreground', recoverable()), false);
    assert.equal(f.timers.size, 1);
    const running = f.tick();
    assert.equal(f.scheduler.getState('foreground').running, true);
    assert.equal(f.scheduler.schedule('foreground', recoverable()), false);
    finish(true);
    await running;
    assert.equal(f.scheduler.getState('foreground').status, 'idle');
});

for (const [name, change] of [
    ['hidden', context => { context.visible = false; }],
    ['logged out', context => { context.authenticated = false; }],
    ['account changed', context => { context.scope = 'account-b'; }],
    ['login changed', context => { context.readIdentity = 'login-2'; }],
    ['view changed', context => { context.viewKey = 'av'; }],
    ['offline', context => { context.online = false; }]
]) {
    test(`${name} cancels the captured retry before transport starts`, async () => {
        const f = fixture();
        f.scheduler.schedule('foreground', recoverable());
        change(f.context);
        await f.tick();
        assert.equal(f.calls.length, 0);
        assert.equal(f.scheduler.getState('foreground').status, 'idle');
        assert.equal(f.timers.size, 0);
    });
}

test('the caller lifecycle predicate compares captured and current contexts', async () => {
    const checks = [];
    const f = fixture({ shouldContinue: (start, current, lane) => {
        checks.push([start, current, lane]);
        return start.generation === current.generation;
    } });
    f.context.generation = 1;
    f.scheduler.schedule('background', recoverable());
    f.context.generation = 2;
    await f.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(checks.at(-1)[0].generation, 1);
    assert.equal(checks.at(-1)[1].generation, 2);
    assert.equal(checks.at(-1)[2], 'background');
});

test('failed retries stop at max attempts with capped exponential delays', async () => {
    let attempts = 0;
    const f = fixture({ maxAttempts: 4, retry: async () => { attempts++; throw recoverable(); } });
    f.scheduler.schedule('foreground', recoverable());
    const delays = [];
    while (f.timers.size) delays.push(await f.tick());
    assert.deepEqual(delays, [10, 20, 30, 30]);
    assert.equal(attempts, 4);
    assert.equal(f.scheduler.getState('foreground').status, 'exhausted');
    assert.equal(f.scheduler.schedule('foreground', recoverable()), false);
    f.scheduler.reset('foreground');
    assert.equal(f.scheduler.schedule('foreground', recoverable()), true);
    f.scheduler.cancel();
});

test('authorization, projection and aborted requests never enter retry even with a permissive transport classifier', () => {
    const f = fixture({ isRecoverable: () => true });
    const errors = [Object.assign(recoverable(), { status: 401 }), Object.assign(recoverable(), { status: 403 }),
        { code: 'INVENTORY_READ_PROJECTION_INVALID' }, { code: '42501' }, { code: 'PGRST301' }, { name: 'AbortError' },
        { message: 'Full inventory field coverage was missing or invalid; the partial snapshot was discarded.' },
        { message: 'Direct inventory projection is unavailable.' }, { code: 'REQUEST_ABORTED' }, { payload: { status: 403 } }];
    errors.forEach(error => {
        assert.equal(isRecoverableSnapshotError(error), false);
        assert.equal(f.scheduler.schedule('foreground', error), false);
    });
    assert.equal(f.timers.size, 0);
    assert.equal(f.scheduler.schedule('foreground', { code: 'NETWORK_ERROR' }), true);
    f.scheduler.cancel();
});

test('a nonrecoverable retry failure stops without another timer', async () => {
    const f = fixture({ retry: async () => { throw Object.assign(new Error('Invalid projection.'), { code: 'PROJECTION_INVALID' }); } });
    f.scheduler.schedule('foreground', recoverable());
    await f.tick();
    assert.equal(f.scheduler.getState('foreground').status, 'stopped');
    assert.equal(f.timers.size, 0);
});

test('foreground success cannot reset background retry attempts or its timer', async () => {
    const f = fixture({ retry: async ({ lane }) => lane === 'foreground' });
    f.scheduler.schedule('background', recoverable());
    assert.equal(await f.tick(), 10);
    assert.equal(f.scheduler.getState('background').attempt, 2);
    f.scheduler.schedule('foreground', recoverable());
    const foreground = [...f.timers.entries()].find(([, timer]) => timer.delay === 10);
    f.timers.delete(foreground[0]);
    await foreground[1].callback();
    assert.equal(f.scheduler.getState('foreground').status, 'idle');
    assert.equal(f.scheduler.getState('background').attempt, 2);
    assert.equal(f.timers.size, 1);
    f.scheduler.success('foreground');
    assert.equal(await f.tick(), 20);
    assert.equal(f.scheduler.getState('background').attempt, 3);
    f.scheduler.cancel();
});

test('all cold dataset lanes retry independently and success clears only its dataset', async () => {
    const f = fixture({ retry: async () => false });
    const lanes = ['master', 'soc', 'requests', 'suspendTag', 'warehouseAssignedItems'];
    lanes.forEach(lane => assert.equal(f.scheduler.schedule(lane, recoverable()), true));
    assert.equal(f.timers.size, 5);
    await f.tick();
    f.scheduler.success('soc');
    assert.equal(f.scheduler.getState('soc').status, 'idle');
    assert.equal(f.scheduler.getState('master').attempt, 2);
    assert.equal(f.scheduler.getState('requests').attempt, 1);
    assert.equal(f.scheduler.getState('suspendTag').attempt, 1);
    assert.equal(f.scheduler.getState('warehouseAssignedItems').attempt, 1);
    assert.equal(f.timers.size, 4);
    f.scheduler.reset();
    assert.equal(f.timers.size, 0);
});

test('lane identifiers and retained lane count remain bounded', () => {
    const f = fixture();
    ['', ' ', ' master', 'x'.repeat(81), null].forEach(lane => {
        assert.throws(() => f.scheduler.schedule(lane, recoverable()), RangeError);
    });
    for (let index = 0; index < 32; index++) assert.equal(f.scheduler.schedule(`dataset-${index}`, recoverable()), true);
    assert.equal(f.scheduler.schedule('excess-dataset', recoverable()), false);
    assert.equal(f.timers.size, 32);
    f.scheduler.cancel();
});

test('an old running retry cannot clear a newer account recovery', async () => {
    let finish;
    const f = fixture({ retry: () => new Promise(resolve => { finish = resolve; }) });
    f.scheduler.schedule('foreground', recoverable());
    const running = f.tick();
    f.context.scope = 'account-b';
    assert.equal(f.scheduler.schedule('foreground', recoverable()), true);
    finish(true);
    await running;
    assert.equal(f.scheduler.getState('foreground').status, 'scheduled');
    assert.equal(f.scheduler.getState('foreground').attempt, 1);
    assert.equal(f.timers.size, 1);
    f.scheduler.cancel();
});

test('cancel removes both lane timers and makes already queued callbacks inert', async () => {
    const f = fixture();
    f.scheduler.schedule('foreground', recoverable());
    f.scheduler.schedule('background', recoverable());
    const callbacks = [...f.timers.values()].map(timer => timer.callback);
    f.scheduler.cancel();
    await Promise.all(callbacks.map(callback => callback()));
    assert.equal(f.calls.length, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.scheduler.getState('foreground').status, 'idle');
    assert.equal(f.scheduler.getState('background').status, 'idle');
});

test('classic asset matches the ES owner and exposes the same UMD API', () => {
    const source = readFileSync(new URL('../src/core/inventory-hydration-recovery.js', import.meta.url), 'utf8');
    const asset = readFileSync(new URL('../assets/inventory-hydration-recovery.js', import.meta.url), 'utf8');
    assert.equal(asset, source.replace(/^export /gm, ''));
    const context = vm.createContext({ module: { exports: {} } });
    vm.runInContext(asset, context);
    assert.equal(context.module.exports, context.GncInventoryHydrationRecovery);
    const error = context.GncInventoryHydrationRecovery.createSnapshotError('changed');
    assert.equal(context.GncInventoryHydrationRecovery.isRecoverableSnapshotError(error), true);
});

const settleCoordinator = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
function coordinatorFixture(faults = {}) {
    const timers = new Map(), reads = [], commits = [];
    let clock = 0, timerId = 0;
    const context = { scope: 'actor', readIdentity: 'login', viewKey: 'drive', authenticated: true,
        accessDenied: false, visible: true, online: true, dataPermissionVersion: 'p1' };
    const adapter = lane => ({ id: `core:${lane}`, cacheKey: `${lane}/all`, sourceKeys: [lane],
        stage: async () => { if (faults[lane]) throw faults[lane]; return [{ id: lane }]; },
        commit: value => commits.push({ lane, value }) });
    context.adapters = [adapter('foreground')];
    context.backgroundAdapters = [adapter('background')];
    const sandbox = vm.createContext({ module: { exports: {} }, AbortController });
    vm.runInContext(readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8'), sandbox);
    vm.runInContext(readFileSync(new URL('../assets/inventory-hydration-recovery.js', import.meta.url), 'utf8'), sandbox);
    const coordinator = sandbox.AgMetricLiveSync.createCoordinator({ getContext: () => context, now: () => clock,
        eventDrivenRevisions: true, backgroundDelayMs: 5,
        hydrationRecovery: { baseDelayMs: 10, maxDelayMs: 30, maxAttempts: 3 },
        readRevisions: async keys => { reads.push([...keys]); if (keys.includes('background') && faults.revision) throw faults.revision;
            if (!keys.includes('background') && faults.foregroundRevision) throw faults.foregroundRevision;
            return { contractVersion: 1, permissionVersion: 'p1', sources: keys.map(key => ({ key, revision: '1', state: 'ready' })) }; },
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, due: clock + delay }); return id; },
        clearTimeout: id => timers.delete(id) });
    async function advance(duration) {
        const target = clock + duration;
        for (let count = 0; count < 100; count++) {
            const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due)[0] || [];
            if (!timer || timer.due > target) break;
            clock = timer.due; timers.delete(id); timer.callback();
            await settleCoordinator();
        }
        clock = target;
        await settleCoordinator();
    }
    return { coordinator, context, faults, reads, commits, timers, advance, sandbox,
        nextDelay: () => Math.min(...[...timers.values()].map(timer => timer.due - clock)) };
}

test('auto decorator wraps caller ensure adapters and recovers their exact partial full read', async () => {
    const f = coordinatorFixture({ foreground: recoverable() });
    assert.equal(f.sandbox.GncInventoryHydrationRecovery.installLiveSyncRecovery(f.sandbox), false);
    assert.equal(await f.coordinator.ensure(f.context.adapters[0]), false);
    const count = f.reads.length;
    f.faults.foreground = null;
    assert.equal(f.nextDelay(), 10);
    await f.advance(9);
    assert.equal(await f.coordinator.check('view-entry'), false);
    assert.equal(f.reads.length, count);
    await f.advance(1);
    assert.equal(f.commits.filter(value => value.lane === 'foreground').length, 1);
    f.coordinator.suspend();
});

test('background revision 504s exhaust capped backoff and allow metadata/manual recovery', async () => {
    const f = coordinatorFixture({ revision: Object.assign(new Error('Gateway timeout.'), { status: 504 }) });
    await f.coordinator.check('view-entry');
    await f.advance(5);
    for (const delay of [10, 20, 30]) {
        assert.equal(f.timers.size, 1, 'one managed retry and no immediate legacy signal');
        assert.equal(f.nextDelay(), delay);
        const count = f.reads.length;
        await f.advance(delay - 1);
        f.coordinator.signal('visible-view', 0);
        assert.equal(f.reads.length, count, 'no transport before the backoff deadline');
        await f.advance(1);
        assert.equal(f.nextDelay(), 5, 'foreground success leaves this attempt pending for background');
        await f.advance(5);
    }
    assert.equal(f.timers.size, 0);
    assert.equal(f.reads.filter(keys => keys.includes('background')).length, 4);
    const count = f.reads.length;
    await f.advance(100);
    assert.equal(f.reads.length, count);
    f.faults.revision = null;
    f.coordinator.signal('metadata', 0);
    await f.advance(0);
    assert.ok(f.reads.length > count, 'metadata signals remain usable after exhaustion');
    assert.equal(await f.coordinator.check('manual'), true, 'an exhausted lane cannot block manual recovery');
    await f.advance(5);
    assert.equal(f.commits.filter(value => value.lane === 'background').length, 1);
    f.coordinator.reset();
});
test('cached foreground ensure stays usable during scheduled and running background recovery', async () => {
    const f = coordinatorFixture({ revision: Object.assign(new Error('Gateway timeout.'), { status: 504 }) });
    await f.coordinator.check('view-entry');
    await f.advance(5);
    const count = f.reads.length;
    assert.equal(await f.coordinator.ensure(f.context.adapters[0]), true);
    assert.equal(f.reads.length, count, 'cached ensure cannot bypass scheduled backoff');
    f.faults.revision = null;
    await f.advance(10);
    const retryReads = f.reads.length;
    assert.equal(await f.coordinator.ensure(f.context.adapters[0]), true);
    assert.equal(f.reads.length, retryReads, 'cached ensure cannot interrupt an owning background attempt');
    await f.advance(5);
    assert.equal(f.timers.size, 0);
    assert.equal(f.commits.filter(value => value.lane === 'foreground').length, 1);
    assert.equal(f.commits.filter(value => value.lane === 'background').length, 1);
    f.coordinator.suspend();
});

test('background exact snapshot failures recover through their own stage', async () => {
    const f = coordinatorFixture({ background: recoverable() });
    await f.coordinator.check('view-entry');
    await f.advance(5);
    assert.equal(f.nextDelay(), 10);
    f.faults.background = null;
    await f.advance(15);
    assert.equal(f.commits.filter(value => value.lane === 'background').length, 1);
    assert.equal(f.timers.size, 0);
    f.coordinator.suspend();
});

test('a terminal foreground prerequisite cancels an awaiting background attempt', async () => {
    const f = coordinatorFixture({ revision: Object.assign(new Error('Gateway timeout.'), { status: 504 }) });
    await f.coordinator.check('view-entry');
    await f.advance(5);
    f.faults.foregroundRevision = Object.assign(new Error('Denied.'), { status: 403 });
    await f.advance(10);
    assert.equal(f.timers.size, 0);
    f.faults.foregroundRevision = null;
    f.faults.revision = null;
    assert.equal(await f.coordinator.check('view-entry'), true, 'no orphaned pending lane blocks a new authorized read');
    f.coordinator.suspend();
});

test('foreground stage 504 remains exclusively owned by the legacy retry path', async () => {
    const f = coordinatorFixture({ foreground: Object.assign(new Error('Gateway timeout.'), { status: 504 }) });
    await f.coordinator.check('view-entry');
    assert.equal(f.timers.size, 1);
    assert.equal(f.nextDelay(), 5000, 'legacy event-driven backoff owns the 504');
    f.faults.foreground = null;
    await f.advance(10);
    assert.equal(f.commits.length, 0, 'the decorator did not create its ten-ms retry');
    f.coordinator.suspend();
});

test('decorator reset, suspend and context fences cancel pending account work', async () => {
    for (const change of [f => f.coordinator.reset(), f => f.coordinator.suspend(),
        f => { f.context.scope = 'another'; }, f => { f.context.readIdentity = 'new-login'; },
        f => { f.context.visible = false; }, f => { f.context.online = false; }, f => { f.context.authenticated = false; }]) {
        const f = coordinatorFixture({ foreground: recoverable() });
        await f.coordinator.check('view-entry');
        const count = f.reads.length;
        change(f);
        await f.advance(100);
        assert.equal(f.reads.length, count);
        assert.equal(f.timers.size, 0);
        f.coordinator.suspend();
    }
});

test('background projection, authorization and Abort errors never enter the decorator retry lane', async () => {
    const errors = ['Full inventory field coverage was missing or invalid; the partial snapshot was discarded.',
        'Direct inventory projection is unavailable.'].map(message => Object.assign(new Error(message), { status: 504 }));
    errors.push(Object.assign(new Error('Denied.'), { status: 403 }), Object.assign(new Error('Aborted.'), { name: 'AbortError' }));
    for (const revision of errors) {
        const f = coordinatorFixture({ revision });
        await f.coordinator.check('view-entry');
        await f.advance(5);
        assert.equal(f.timers.size, 0);
        f.coordinator.suspend();
    }
});
