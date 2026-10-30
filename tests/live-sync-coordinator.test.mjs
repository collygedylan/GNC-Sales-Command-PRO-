import { readComposedRuntimeSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import test from 'node:test';

test('transient permission refresh retains verified access without throwing', () => {
  const runtime = readComposedRuntimeSource();
  assert.doesNotMatch(runtime, /throw new Error\('Updated permissions could not be verified/);
  assert.match(runtime, /Permission refresh deferred; retaining the active verified permissions/);
});
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';

const deterministicMath = Object.create(Math);
deterministicMath.random = () => 0.2;
const sandbox = { module: { exports: {} }, setTimeout, clearTimeout, AbortController, Math: deterministicMath };
vm.runInNewContext(readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8'), sandbox);
const { createCoordinator, readContextKey } = sandbox.module.exports;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

test('Home to Drive detaches a cancelled startup transport and hydrates the new view immediately', async () => {
    const f = fixture();
    const startup = deferred();
    f.context.viewKey = 'home';
    f.loadHook = () => startup.promise;
    const oldTask = f.coordinator.check('login-shell-open');
    await settle();
    f.context.viewKey = 'drive';
    f.loadHook = null;
    f.rows = Array.from({ length: 9600 }, (_, id) => ({ id }));
    const started = performance.now();
    const nextTask = f.coordinator.check('visible-view');
    await settle();
    const rendered = f.commits.at(-1)?.length || 0;
    startup.resolve();
    await Promise.all([oldTask, nextTask]);
    assert.equal(rendered, 9600, 'Drive must complete before the obsolete startup transport settles');
    assert.ok(performance.now() - started < 2500);
    assert.equal(f.commits.length, 1, 'late Home data must never replace Drive');
    f.coordinator.reset();
});

test('account switch releases an unresponsive prior read before Brian hydrates once', async () => {
    const f = fixture();
    const oldRead = deferred();
    f.context.scope = 'dylan_collyge';
    f.loadHook = () => oldRead.promise;
    const oldTask = f.coordinator.check();
    await settle();
    f.coordinator.reset();
    f.context.scope = 'brian_hatfield';
    f.context.readIdentity = 'brian_hatfield:login-2';
    f.loadHook = null;
    f.rows = [{ id: 'brian-authorized' }];
    const next = f.coordinator.check();
    await settle();
    const committedBeforeOldRead = f.commits.length;
    oldRead.resolve();
    await Promise.all([oldTask, next]);
    assert.equal(committedBeforeOldRead, 1, 'new account must not wait for an aborted transport');
    assert.deepEqual(f.commits, [[{ id: 'brian-authorized' }]]);
    assert.equal(f.reads, 2, 'one read for each account');
    f.coordinator.reset();
});
function fixture(overrides = {}) {
    let revision = '1', state = 'ready', permission = 'role-v1', changedAt = '2026-10-08T00:00:00Z', clock = 1000;
    let rows = [{ id: 'dock-28' }], reads = 0, metadataReads = 0, subscriptions = 0, closes = 0;
    let fault = null, loadHook = null, metadataHook = null, notify = null, sourceGateReadChecks = false, publication = null;
    const commits = [], statuses = [], permissionChanges = [], timers = new Map(); let timerId = 0;
    const adapter = { id: 'core:soc', cacheKey: 'soc/all', sourceKeys: ['ph_soc_master'],
        stage: async ({ signal } = {}) => { reads++; if (sourceGateReadChecks && coordinator.isSourceReadSuspended()) throw Object.assign(new Error('LOC_SOURCE_READ_SUSPENDED'), { code: 'LOC_SOURCE_READ_SUSPENDED' }); if (fault) throw fault; const captured = structuredClone(rows); if (loadHook) await loadHook(signal); if (signal?.aborted) throw signal.reason || new Error('Stage aborted.'); return captured; },
        commit: (value) => commits.push(value) };
    const context = { scope: 'same-user/site-role-v1', viewKey: 'docks', visible: true, online: true, adapters: [adapter] };
    let coordinator;
    coordinator = createCoordinator({
        getContext: () => context,
        readRevisions: async (keys, readOptions = {}) => {
            metadataReads++; if (metadataHook) await metadataHook(keys, readOptions);
            const result = { contractVersion: 1, permissionVersion: permission, serverTime: '2026-09-08T00:00:00Z',
                sources: keys.map((key) => ({ key, revision, state, changedAt, ...(publication || {}) })) };
            return result;
        },
        onStatus: (value) => statuses.push(value), onPermissionChange: (...args) => permissionChanges.push(args), now: () => clock,
        subscribe: (changed) => { subscriptions++; notify = changed; return () => { closes++; }; },
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
        clearTimeout: (id) => timers.delete(id),
        ...overrides
    });
    return { coordinator, context, adapter, commits, statuses, permissionChanges, timers,
        get revision() { return revision; }, set revision(value) { revision = value; }, set state(value) { state = value; }, set changedAt(value) { changedAt = value; }, set rows(value) { rows = value; },
        set fault(value) { fault = value; }, set loadHook(value) { loadHook = value; }, set metadataHook(value) { metadataHook = value; }, set sourceGateReadChecks(value) { sourceGateReadChecks = value; },
        set permission(value) { permission = value; }, set publication(value) { publication = value; },
        get clock() { return clock; }, set clock(value) { clock = value; },
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

test('revision connection is published before nonblocking startup hydration finishes', async () => {
    const hydration = deferred();
    const events = [];
    const f = fixture({ onRevisionRead: (_value, metadata) => events.push(`connected:${metadata.permissionVersion}`) });
    f.adapter.stage = async () => { events.push('hydrate-started'); await hydration.promise; return [{ id: 'dock-28' }]; };
    const pending = f.coordinator.check('login-shell-open');
    await settle();
    assert.deepEqual(events, ['connected:role-v1', 'hydrate-started']);
    assert.equal(f.commits.length, 0, 'revision connectivity does not claim hydrated rows');
    hydration.resolve();
    assert.equal(await pending, true);
    assert.equal(f.coordinator.getStatus().state, 'Up to date');
});

test('an empty navigation hub checks one connection revision without claiming data proof', async () => {
    const connections = [];
    const f = fixture({ connectionSourceKeys: () => ['ph_master_inventory'],
        onRevisionRead: (_value, metadata) => connections.push(metadata.permissionVersion) });
    f.context.adapters = [];
    assert.equal(await f.coordinator.check('login-shell-open'), true);
    assert.deepEqual(connections, ['role-v1']);
    assert.equal(f.reads, 0);
    assert.equal(f.coordinator.getStatus().connectionOnly, true);
});

for (const view of ['managers:crop-roll', 'managers:eval-reports-2', 'drive:salesrep', 'chat:salesrep']) {
    test(`${view} reads authorized rows despite unavailable revision metadata without granting freshness`, async () => {
        let cacheWrites = 0;
        const f = fixture({ writeCachedSnapshot: () => { cacheWrites++; } });
        Object.assign(f.context, { viewKey: view, authenticated: true, accessDenied: false,
            readIdentity: 'account-a:login-1', dataPermissionVersion: 'role-v1' });
        f.state = 'unavailable';
        assert.equal(await f.coordinator.ensure(f.adapter), true);
        assert.deepEqual(f.commits.at(-1), [{ id: 'dock-28' }]);
        const status = f.coordinator.getStatus();
        assert.equal(status.state, 'Available data');
        assert.equal(status.dataReadable, true);
        assert.equal(status.readOnlySnapshot, true);
        assert.equal(status.lastVerifiedAt, null);
        assert.equal(status.readContextKey, readContextKey(f.context));
        assert.match(status.contextKey, /read-only-metadata/);
        assert.equal(cacheWrites, 0, 'unknown revision metadata cannot create a verified disk cache');
        await f.coordinator.ensure(f.adapter);
        assert.equal(f.reads, 2, 'unavailable metadata never proves a cached snapshot unchanged');
        f.state = 'ready';
        assert.equal(await f.coordinator.ensure(f.adapter), true);
        assert.equal(f.coordinator.getStatus().state, 'Up to date');
        assert.doesNotMatch(f.coordinator.getStatus().contextKey, /read-only-metadata/);
        assert.equal(cacheWrites, 1);
        f.coordinator.reset();
    });
}

test('unavailable revision metadata never bypasses actual endpoint authorization or an unproven interrupted import', async () => {
    for (const state of ['unavailable', 'interrupted']) {
        const f = fixture();
        Object.assign(f.context, { authenticated: true, accessDenied: false,
            readIdentity: 'account-a:login-1', dataPermissionVersion: 'role-v1' });
        f.state = state;
        f.fault = Object.assign(new Error('Forbidden'), { status: 403, code: '42501' });
        assert.equal(await f.coordinator.ensure(f.adapter), false);
        assert.equal(f.commits.length, 0);
        assert.notEqual(f.coordinator.getStatus().dataReadable, true);
        if (state === 'unavailable') assert.equal(f.coordinator.getStatus().authorizationDenied, true);
        else assert.equal(f.reads, 0, 'an interrupted source without publication proof remains unreadable');
        f.coordinator.reset();
    }
});

for (const view of ['docks', 'request:suspend-tag']) {
    test(`${view} in-flight server read completes through a same-account access refresh without claiming changed permission proof`, async () => {
        const f = fixture();
        Object.assign(f.context, { viewKey: view, authenticated: true, accessDenied: false,
            readIdentity: 'account-a:login-epoch-1', dataPermissionVersion: 'role-v1', dataPermissionSnapshotFresh: true });
        const gate = deferred();
        let signal;
        f.loadHook = value => { signal = value; return gate.promise; };
        const pending = f.coordinator.ensure(f.adapter);
        await settle();
        assert.ok(signal, 'the data read must actually be in flight');
        const owner = readContextKey(f.context);
        f.context.dataPermissionVersion = 'role-v2';
        f.context.dataPermissionSnapshotFresh = true;
        f.coordinator.signal('permissions', 0);
        await f.advance(0);
        assert.equal(signal.aborted, false, 'a background permission refresh is not an account boundary');
        assert.equal(readContextKey(f.context), owner);
        gate.resolve();
        assert.equal(await pending, true, 'server-authorized rows satisfy the view loader');
        assert.deepEqual(f.commits.at(-1), [{ id: 'dock-28' }]);
        const status = f.coordinator.getStatus();
        assert.equal(status.dataReadable, true);
        assert.equal(status.readContextKey, owner);
        assert.match(status.contextKey, /role-v1/, 'proof remains tied to the server permission hash');
        assert.doesNotMatch(status.contextKey, /role-v2/, 'independent access refresh cannot fabricate freshness/write proof');
        assert.equal(f.statuses.some(value => /Access permissions changed while this screen/.test(value.message)), false);
        f.coordinator.reset();
    });

    test(`${view} reissues once when the server permission revision changes during the read`, async () => {
        const f = fixture();
        Object.assign(f.context, { viewKey: view, authenticated: true, accessDenied: false,
            readIdentity: 'account-a:login-epoch-1', dataPermissionVersion: 'role-v1' });
        const gate = deferred();
        f.loadHook = () => gate.promise;
        const pending = f.coordinator.ensure(f.adapter);
        await settle();
        f.permission = 'role-v2'; f.context.dataPermissionVersion = 'role-v2';
        gate.resolve();
        assert.equal(await pending, true);
        assert.equal(f.reads, 2, 'only the obsolete server-bracketed read is repeated');
        assert.equal(f.commits.length, 1, 'the obsolete permission cohort is never published');
        assert.match(f.coordinator.getStatus().contextKey, /role-v2/);
        assert.equal(f.statuses.some(value => /Access permissions changed while this screen/.test(value.message)), false);
        f.coordinator.reset();
    });
}

test('same-account read continuity does not survive logout, confirmed denial or a new login epoch', async () => {
    for (const boundary of ['logout', 'revoked', 'relogin']) {
        const f = fixture();
        Object.assign(f.context, { authenticated: true, accessDenied: false,
            readIdentity: 'account-a:login-epoch-1', dataPermissionVersion: 'role-v1' });
        const gate = deferred();
        let signal;
        f.loadHook = value => { signal = value; return gate.promise; };
        const pending = f.coordinator.ensure(f.adapter);
        await settle();
        const previousOwner = readContextKey(f.context);
        if (boundary === 'logout') { f.context.authenticated = false; f.context.scope = ''; }
        else if (boundary === 'revoked') f.context.accessDenied = true;
        else { f.context.readIdentity = 'account-a:login-epoch-2'; f.rows = [{ id: 'new-login-row' }]; }
        assert.notEqual(readContextKey(f.context), previousOwner, `${boundary}: the read owner changes`);
        f.coordinator.signal('permissions', 0);
        assert.equal(signal.aborted, true);
        gate.resolve();
        assert.equal(await pending, false, boundary);
        assert.deepEqual(f.commits, boundary === 'relogin' ? [[{ id: 'new-login-row' }]] : [], 'an old owner never publishes its rows');
        assert.equal(f.coordinator.retainDisplay(), false, boundary);
        f.coordinator.reset();
    }
});

test('same-account adapter scope drift retries once, while persistent drift and unknown failures remain failures', async () => {
    for (const failure of ['once', 'persistent', 'unknown']) {
        const f = fixture();
        Object.assign(f.context, { authenticated: true, accessDenied: false,
            readIdentity: 'account-a:login-epoch-1', dataPermissionVersion: 'role-v1' });
        let attempts = 0;
        f.loadHook = () => {
            attempts++;
            if (failure === 'once' && attempts > 1) return;
            throw Object.assign(new Error(failure), { code: failure === 'unknown' ? 'UNEXPECTED_FAILURE' : 'DATASET_READ_SCOPE_CHANGED' });
        };
        assert.equal(await f.coordinator.ensure(f.adapter), failure === 'once');
        assert.equal(attempts, failure === 'unknown' ? 1 : 2);
        assert.equal(f.commits.length, failure === 'once' ? 1 : 0);
        if (failure !== 'once') assert.notEqual(f.coordinator.getStatus().dataReadable, true);
        f.coordinator.reset();
    }
});

test('an active-account permission refresh runs in the background without delaying Docks rows', async () => {
    const access = deferred();
    let refreshes = 0;
    const f = fixture({ onPermissionChange: () => { refreshes++; return access.promise; } });
    Object.assign(f.context, { viewKey: 'docks', authenticated: true, accessDenied: false,
        readIdentity: 'account-a:login-epoch-1', dataPermissionVersion: 'role-v2' });
    const pending = f.coordinator.ensure(f.adapter);
    await settle();
    assert.ok(refreshes > 0);
    assert.equal(f.commits.length, 1, 'the server read completes before independent profile/capability refresh');
    assert.equal(f.coordinator.getStatus().dataReadable, true);
    access.resolve();
    assert.equal(await pending, true);
    f.coordinator.reset();
});

test('a server authorization denial during access refresh still clears same-account retained rows', async () => {
    const f = fixture();
    Object.assign(f.context, { authenticated: true, accessDenied: false,
        readIdentity: 'account-a:login-epoch-1', dataPermissionVersion: 'role-v1' });
    await f.coordinator.check();
    f.context.dataPermissionVersion = 'role-v2'; f.permission = 'role-v2'; f.revision = '2';
    f.fault = Object.assign(new Error('Forbidden'), { status: 403, code: '42501' });
    assert.equal(await f.coordinator.ensure(f.adapter, true), false);
    assert.equal(f.coordinator.getStatus().authorizationDenied, true);
    assert.notEqual(f.coordinator.getStatus().dataReadable, true);
    assert.equal(f.coordinator.retainDisplay(), false);
    f.coordinator.reset();
});
test('unchanged revisions perform no full downloads; a healthy socket never stops the 30s check', async () => {
    const f = fixture(); await f.coordinator.check(); const first = f.metadataReads;
    await f.advance(30000);
    assert.equal(f.subscriptions, 1); assert.equal(f.metadataReads, first + 1); assert.equal(f.reads, 1);
});
test('an applied snapshot is served immediately while a snapshot older than 30 seconds revalidates', async () => {
    const f = fixture();
    assert.equal(await f.coordinator.check(), true);
    const initialReads = f.reads;
    const initialMetadataReads = f.metadataReads;
    assert.equal(await f.coordinator.ensure(f.adapter), true, 'a fresh complete snapshot is immediately reusable');
    assert.equal(f.metadataReads, initialMetadataReads);
    f.clock = 31001;
    assert.equal(await f.coordinator.ensure(f.adapter), true, 'stale-while-revalidate must not block the view');
    await f.advance(0);
    assert.equal(f.metadataReads, initialMetadataReads + 2, 'revalidation brackets a conditional read');
    assert.equal(f.reads, initialReads, 'unchanged source revisions do not redownload the dataset');
});
test('same row count updates and deletions replace the old snapshot', async () => {
    const f = fixture(); await f.coordinator.check();
    f.revision = '2'; f.rows = [{ id: 'dock-29' }]; await f.coordinator.check();
    f.revision = '3'; f.rows = []; await f.coordinator.check();
    assert.deepEqual(f.commits.at(-2), [{ id: 'dock-29' }]); assert.deepEqual(f.commits.at(-1), []);
});

test('a full projection request retains the verified browse cohort until its source changes', async () => {
    const f = fixture();
    f.context.dataPermissionVersion = 'role-v1';
    f.adapter.projection = 'browse'; f.adapter.projectionFamily = 'complete-same-rows';
    const full = { ...f.adapter, cacheKey: 'soc/full', projection: 'full' };
    const background = { id: 'side:lookup', cacheKey: 'lookup/all', sourceKeys: ['lookup'],
        stage: async () => [], commit: () => {} };
    f.context.backgroundAdapters = [background];
    await f.coordinator.check();
    await f.coordinator.ensure(full, true);
    const reads = f.reads;
    await f.advance(250);
    assert.equal(f.coordinator.getStatus().state, 'Up to date', 'a wider same-revision read is not a source change');
    assert.equal(f.coordinator.getBackgroundStatus().state, 'Up to date');
    await f.coordinator.check();
    assert.equal(f.reads, reads, 'returning to browse does not download or downgrade the wider snapshot');
    assert.equal(await f.coordinator.ensure(full), true);
    assert.equal(f.reads, reads, 'the complete contract remains reusable');
    f.revision = '2';
    await f.coordinator.check();
    const changedReads = f.reads;
    await f.coordinator.ensure(full);
    assert.equal(f.reads, changedReads + 1, 'a new browse revision invalidates its older full sibling');
    f.permission = 'role-v2'; f.context.dataPermissionVersion = 'role-v2';
    await f.coordinator.check();
    const permissionReads = f.reads;
    await f.coordinator.ensure(full);
    assert.equal(f.reads, permissionReads + 1, 'permission changes discard all old projection contracts');
});

test('different filters and a narrower applied projection never retain obsolete snapshot ownership', async () => {
    const f = fixture();
    await f.coordinator.check();
    await f.coordinator.ensure({ ...f.adapter, cacheKey: 'soc/other-filter' });
    let reads = f.reads;
    await f.coordinator.ensure(f.adapter);
    assert.equal(f.reads, reads + 1, 'switching back to a filter must apply its own rows again');
    f.adapter.projection = 'browse'; f.adapter.projectionFamily = 'same-rows';
    const full = { ...f.adapter, cacheKey: 'soc/full', projection: 'full' };
    await f.coordinator.ensure(full);
    await f.coordinator.ensure(f.adapter, true);
    reads = f.reads;
    await f.coordinator.ensure(full);
    assert.equal(f.reads, reads + 1, 'a forced narrow read invalidates previously installed full-field ownership');
    await f.coordinator.ensure({ ...full, cacheKey: 'soc/other-season/full', projectionFamily: 'other-season' });
    reads = f.reads;
    await f.coordinator.ensure(full);
    assert.equal(f.reads, reads + 1, 'a different season cannot retain the prior full-field ownership');
});
test('a previous-day source revision invalidates the prior cache and applies current rows', async () => {
    const f = fixture();
    f.changedAt = '2026-10-07T23:59:59Z';
    await f.coordinator.check();
    const firstReads = f.reads;
    f.revision = '2';
    f.changedAt = '2026-10-08T00:00:00Z';
    f.rows = [{ id: 'updated-after-yesterday-import' }];
    await f.coordinator.check();
    assert.equal(f.reads, firstReads + 1);
    assert.deepEqual(f.commits.at(-1), [{ id: 'updated-after-yesterday-import' }]);
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
    assert.equal(f.coordinator.getStatus().state, 'Published data');
    assert.equal(f.coordinator.getStatus().dataReadable, true);
    assert.doesNotMatch(f.coordinator.getStatus().message, /interrupted|Needs attention/i);
});
test('network failures keep old data visibly stale instead of committing an empty list', async () => {
    const f = fixture(); await f.coordinator.check(); f.revision = '2'; f.fault = new Error('Read timed out');
    await f.coordinator.check(); assert.equal(f.commits.length, 1);
    assert.equal(f.coordinator.getStatus().state, 'Syncing');
    assert.match(f.coordinator.getStatus().message, /Retrying current data/);
    assert.ok(Array.from(f.timers.values()).some(timer => timer.at - f.clock === 10000));
});

test('a cold 503 waits for the transport cooldown and then hydrates automatically', async () => {
    const f = fixture();
    f.fault = Object.assign(new Error('Edge function temporarily unavailable'), { status: 503 });
    assert.equal(await f.coordinator.check('visible-view'), false);
    assert.equal(f.commits.length, 0);
    assert.equal(f.coordinator.getStatus().state, 'Syncing');
    assert.ok(Array.from(f.timers.values()).some(timer => timer.at - f.clock === 10000));
    f.fault = null;
    await f.advance(10000);
    assert.deepEqual(f.commits.at(-1), [{ id: 'dock-28' }]);
    assert.equal(f.coordinator.getStatus().state, 'Up to date');
    f.coordinator.reset();
});

test('forced refresh keeps the same verified display available through import and transient failure without masking status', async () => {
    const f = fixture();
    f.context.dataPermissionVersion = 'role-v1';
    assert.equal(await f.coordinator.check(), true);
    f.state = 'importing'; f.revision = '2';
    assert.equal(await f.coordinator.ensure(f.adapter, true), true, 'force requests revalidation but does not discard the same trusted snapshot');
    assert.equal(f.coordinator.getStatus().state, 'Importing', 'retained display availability does not claim freshness');
    assert.match(f.coordinator.getStatus().message, /Keeping the last verified data/);
    assert.deepEqual(f.commits.at(-1), [{ id: 'dock-28' }]);

    f.state = 'ready'; f.revision = '3'; f.fault = new Error('Read timed out');
    assert.equal(await f.coordinator.ensure(f.adapter, true), true, 'a transient read error keeps the same authorized display usable');
    assert.equal(f.coordinator.getStatus().state, 'Syncing');
    assert.match(f.coordinator.getStatus().message, /Retrying current data/);
    assert.deepEqual(f.commits.at(-1), [{ id: 'dock-28' }], 'the failed replacement is never committed');
});

test('a real authorization denial clears retained data and remains a hard failure', async () => {
    const f = fixture();
    f.context.dataPermissionVersion = 'role-v1';
    assert.equal(await f.coordinator.check(), true);
    f.revision = '2';
    f.fault = Object.assign(new Error('Forbidden'), { status: 403, code: '42501' });
    assert.equal(await f.coordinator.ensure(f.adapter, true), false, 'a denied read cannot fall back to the previous display');
    assert.equal(f.coordinator.getStatus().state, 'Needs attention');
    assert.equal(f.coordinator.getStatus().authorizationDenied, true);
    assert.equal(f.coordinator.retainDisplay(), false);
    assert.equal(f.permissionChanges.length, 1, 'the application is told to clear its rendered display cache');
});

test('semantic location readiness failures gate repeated checks until a new ready revision is confirmed', async () => {
    const f = fixture();
    f.context.dataPermissionVersion = 'role-v1';
    f.adapter.sourceKeys = ['ph_master_inventory'];
    const error = Object.assign(new Error('Location on-hand source is not ready.'), { code: 'LOC_ON_HAND_SOURCE_NOT_READY', status: 423 });
    f.fault = error;
    assert.equal(await f.coordinator.check(), false);
    assert.equal(f.reads, 1);
    assert.equal(f.coordinator.isSourceReadSuspended(), true);
    const scheduledDelays = Array.from(f.timers.values()).map((timer) => timer.at - f.clock);
    assert.ok(scheduledDelays.includes(31200), 'first readiness probe applies positive jitter within the 30–36 second bound');
    await settle();
    const gateTimer = Array.from(f.timers.entries()).find(([, timer]) => timer.at - f.clock === 31200)?.[0];
    assert.equal(f.coordinator.suspendSourceReads(error, ['ph_master_inventory']), true);
    assert.equal(f.timers.has(gateTimer), true, 'repeated semantic errors must preserve the existing cooldown timer');

    f.notify();
    await f.coordinator.check('metadata');
    await f.advance(1000);
    assert.equal(f.reads, 1, 'semantic source failures must not restart adapter reads on queued/realtime checks');
    const metadataBeforeHidden = f.metadataReads;
    f.context.visible = false;
    assert.equal(f.coordinator.isSourceReadSuspended(), true, 'hidden state pauses probes without releasing the row-read gate');
    await f.advance(180000);
    assert.equal(f.metadataReads, metadataBeforeHidden, 'hidden sessions must pause readiness probes');
    f.context.visible = true;
    f.context.online = false;
    assert.equal(f.coordinator.isSourceReadSuspended(), true, 'offline state also keeps direct reads blocked');
    f.context.online = true;
    await f.coordinator.check('view-entry');
    assert.equal(f.reads, 1, 'returning to the view must preserve the gate');

    f.fault = null;
    f.revision = '2';
    await f.advance(180000);
    assert.equal(f.reads, 1, 'a changed ready revision first becomes the gate baseline');
    await f.advance(180000);
    assert.equal(f.reads, 2, 'one new ready revision permits exactly one fresh adapter read');
    assert.equal(f.coordinator.getStatus().state, 'Up to date');
    assert.deepEqual(f.commits.at(-1), [{ id: 'dock-28' }]);
});

test('direct semantic read failures install a scoped gate and logout reset clears it', async () => {
    const f = fixture();
    f.context.dataPermissionVersion = 'role-v1';
    const error = Object.assign(new Error('Manager report source revision changed.'), { code: 'MANAGER_REPORT_SOURCE_REVISION_CHANGED', status: 409, source: 'ph_master_inventory' });
    assert.equal(f.coordinator.suspendSourceReads(error, ['ph_master_inventory']), true);
    await settle();
    assert.equal(f.coordinator.isSourceReadSuspended(), true);
    assert.equal(f.metadataReads, 1, 'direct path captures its baseline through the metadata RPC');
    await f.coordinator.check('metadata');
    assert.equal(f.reads, 0, 'direct read callers cannot bypass the readiness gate');

    f.coordinator.reset();
    assert.equal(f.coordinator.isSourceReadSuspended(), false, 'logout/session reset clears the prior identity gate');

    const unrelated = fixture();
    unrelated.context.dataPermissionVersion = 'role-v1';
    assert.equal(unrelated.coordinator.suspendSourceReads(Object.assign(new Error('Dataset is unavailable.'), { code: 'DATASET_NOT_READY', status: 423 }), ['ph_soc_master']), false,
        'a generic capability/readiness failure on another source must not gate master inventory');
    assert.equal(unrelated.coordinator.suspendSourceReads(Object.assign(new Error('Manager source changed.'), { code: 'MANAGER_REPORT_SOURCE_REVISION_CHANGED', status: 409 }), ['ph_master_inventory']), false,
        'a manager revision alias without a verified master source must not suspend unrelated inventory reads');

    const hidden = fixture();
    hidden.context.dataPermissionVersion = 'role-v1'; hidden.context.visible = false;
    assert.equal(hidden.coordinator.suspendSourceReads(Object.assign(new Error('Source not ready.'), { code: 'LOC_ON_HAND_SOURCE_NOT_READY', status: 423 }), ['ph_master_inventory']), true);
    await settle();
    assert.equal(hidden.metadataReads, 0, 'hidden contexts defer the baseline metadata request');
    assert.equal(hidden.coordinator.isSourceReadSuspended(), true, 'hidden contexts retain the direct-read gate');
    hidden.context.visible = true;
    await hidden.coordinator.check('view-entry');
    await settle();
    assert.equal(hidden.metadataReads, 1, 'the baseline metadata request starts after the scope becomes visible');
});

test('a direct readiness failure during another live-sync pass gates reads and aborts that pass', async () => {
    const f = fixture();
    f.context.dataPermissionVersion = 'role-v1';
    const stageStarted = deferred();
    f.loadHook = (signal) => new Promise((resolve, reject) => {
        stageStarted.resolve();
        signal.addEventListener('abort', () => reject(signal.reason || new Error('Stage aborted.')), { once: true });
    });
    const check = f.coordinator.check();
    await stageStarted.promise;
    const error = Object.assign(new Error('Location on-hand source is not ready.'), { code: 'LOC_ON_HAND_SOURCE_NOT_READY', status: 423 });
    assert.equal(f.coordinator.suspendSourceReads(error, ['ph_master_inventory']), true);
    assert.equal(await check, false);
    await settle();
    assert.equal(f.reads, 1, 'the active unrelated cohort is aborted instead of being allowed to restart rows');
    assert.equal(f.commits.length, 0, 'the aborted cohort cannot commit an incomplete snapshot');
    assert.equal(f.coordinator.isSourceReadSuspended(), true);
    await f.coordinator.check('metadata');
    assert.equal(f.reads, 1, 'later coordinator checks remain gated');
});

test('scope changes abort an in-flight direct readiness baseline probe', async () => {
    const f = fixture();
    f.context.dataPermissionVersion = 'role-v1';
    const gate = deferred(); let baselineSignal = null, first = true;
    f.metadataHook = async (_keys, options) => {
        if (!first) return;
        first = false; baselineSignal = options.signal; await gate.promise;
    };
    assert.equal(f.coordinator.suspendSourceReads(Object.assign(new Error('Source not ready.'), { code: 'LOC_ON_HAND_SOURCE_NOT_READY', status: 423 }), ['ph_master_inventory']), true);
    await settle();
    assert.equal(baselineSignal?.aborted, false);
    f.context.scope = 'other-account';
    f.coordinator.isSourceReadSuspended();
    assert.equal(baselineSignal?.aborted, true, 'identity changes abort the old identity metadata probe');
    gate.resolve();
    await settle();
});

test('repeated revision churn pauses after three discarded snapshots and resumes on a later ready revision', async () => {
    const f = fixture();
    f.loadHook = async () => { f.revision = String(Number(f.revision) + 1); };
    assert.equal(await f.coordinator.check(), false);
    assert.equal(f.reads, 3, 'three unstable snapshots are discarded before the cooldown gate opens');
    assert.equal(f.coordinator.isSourceReadSuspended(), true);
    await f.coordinator.check('metadata');
    assert.equal(f.reads, 3, 'new signals cannot bypass the churn gate');

    f.loadHook = null;
    await f.advance(180000);
    assert.equal(f.reads, 4, 'one stable ready revision permits a bounded half-open replacement snapshot');
    assert.deepEqual(f.commits.at(-1), [{ id: 'dock-28' }]);
    assert.equal(f.coordinator.isSourceReadSuspended(), false);
});

test('a direct revision conflict whose baseline is already ready recovers after one stable cooldown probe', async () => {
    const f = fixture();
    f.adapter.sourceKeys = ['ph_master_inventory'];
    f.revision = '42';
    const error = Object.assign(new Error('Location on-hand revision changed.'), { code: 'LOC_ON_HAND_REVISION_CHANGED', status: 409 });
    assert.equal(f.coordinator.suspendSourceReads(error, ['ph_master_inventory']), true);
    f.sourceGateReadChecks = true;
    assert.equal(f.reads, 0, 'installing the direct-read gate does not fetch rows');
    await settle();
    assert.equal(f.coordinator.isSourceReadSuspended(), true, 'a ready baseline alone never opens the gate');
    await f.advance(31200);
    assert.equal(f.reads, 1, 'the real read gate permits the single half-open snapshot attempt');
    assert.deepEqual(f.commits.at(-1), [{ id: 'dock-28' }]);
    assert.equal(f.coordinator.isSourceReadSuspended(), false, 'the recovery episode ends only after the snapshot commits');
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
    assert.equal(status.contextKey, JSON.stringify([f.context.scope, '', f.context.viewKey, [[f.adapter.id, f.adapter.cacheKey]]]));
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
            if (shouldFail) throw new Error('Primary response was malformed');
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
    assert.equal(statuses.at(-1).message, 'Primary response was malformed', 'a sibling abort must not replace the original error');
    assert.equal(statuses.at(-1).contextKey, JSON.stringify([context.scope, '', context.viewKey,
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
    const nextContextKey = JSON.stringify([context.scope, '', context.viewKey, [[second.id, second.cacheKey]]]);
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
test('first revision permission mismatch refreshes access and rechecks before cohort proof', async () => {
    const context = { scope: 'same-user', dataPermissionVersion: 'access-v1', viewKey: 'drive', visible: true, online: true,
        adapters: [{ id: 'core:master', cacheKey: 'all', sourceKeys: ['inventory'], stage: async () => ['fresh'], commit() {} }] };
    let revisionPermission = 'access-v2', permissionRefreshes = 0, commits = 0, commitsAtRefresh = -1;
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: revisionPermission,
            sources: keys.map(key => ({ key, revision: '1', state: 'ready' })) }),
        onPermissionChange: async () => { permissionRefreshes++; commitsAtRefresh = commits; context.dataPermissionVersion = revisionPermission; },
        commitSnapshots: () => { commits++; } });
    assert.equal(await coordinator.check(), true);
    assert.equal(permissionRefreshes, 1);
    assert.equal(commitsAtRefresh, 0, 'the stale access cohort cannot commit before access is refreshed');
    assert.equal(commits, 1);
    assert.match(coordinator.getStatus().contextKey, /access-v2/);
    coordinator.reset();
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

test('a configured primary preview adapter displays before side adapters finish without committing early', async () => {
    const primaryGate = deferred(), sideGate = deferred(), shown = [], committed = [];
    const primary = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'],
        stage: async ({ preview }) => {
            preview({ rows: ['first page'], partial: true }); await primaryGate.promise;
            preview({ rows: ['updated first page'], partial: true }); return { rows: ['all rows'] };
        },
        commit: value => committed.push(value) };
    const side = { id: 'core:reserves', cacheKey: 'reserves/all', sourceKeys: ['reserves'],
        stage: async () => { await sideGate.promise; return { rows: ['reserves'] }; }, commit: value => committed.push(value) };
    const context = { scope: 'account-permissions', viewKey: 'av', progressive: true, visible: true, online: true,
        previewAdapterIds: ['core:master'], adapters: [primary, side] };
    const coordinator = createCoordinator({ getContext: () => context, concurrency: 2, setTimeout: () => 1, clearTimeout() {},
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1', sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) }),
        previewSnapshots: (...args) => shown.push(args),
        commitSnapshots: entries => committed.push(entries) });
    const pending = coordinator.check('visible-view'); await settle();
    assert.equal(shown.length, 1, 'the primary first page is available while the side adapter is pending');
    assert.deepEqual(shown[0][0].map(entry => entry.adapter.id), ['core:master']);
    assert.equal(shown[0][0][0].value.partial, true);
    assert.equal(typeof shown[0][2].sources.get, 'function', 'the established before-revision argument remains third');
    assert.equal(shown[0][1].partialCohort, true);
    assert.equal(committed.length, 0, 'a partial display never commits or proves a cohort');
    primaryGate.resolve(); await settle();
    assert.deepEqual(shown.at(-1)[0][0].value.rows, ['all rows'], 'the full master replaces its first page before reserves finish');
    assert.equal(committed.length, 0, 'display completion still does not grant full-cohort write proof');
    sideGate.resolve();
    assert.equal(await pending, true);
    assert.equal(shown.length, 3, 'first page, changed first page and completed master each preview once');
    assert.deepEqual(shown[1][0].map(entry => entry.adapter.id), ['core:master']);
    assert.deepEqual(shown[1][0][0].value.rows, ['updated first page']);
    assert.equal(committed.length, 1, 'the existing full-cohort commit runs only after every adapter and revision check completes');
    coordinator.reset();
});

test('partial preview subsets must name unique visible adapters', async () => {
    const adapter = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'], stage: async () => [], commit() {} };
    const context = { scope: 'a', viewKey: 'av', progressive: true, visible: true, online: true,
        previewAdapterIds: ['core:missing'], adapters: [adapter] };
    const statuses = [];
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        onStatus: status => statuses.push(status),
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1', sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) }) });
    assert.equal(await coordinator.check(), false);
    assert.match(statuses.at(-1).message, /preview adapter subset is invalid/);
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

test('an ensure arriving during an active cycle is staged before it reports success', async () => {
    const gate = deferred(); let baseReads = 0, extraReads = 0;
    const base = { id: 'core:base', cacheKey: 'base/all', sourceKeys: ['base'],
        stage: async () => { baseReads++; await gate.promise; return ['base']; }, commit() {} };
    const context = { scope: 'a', viewKey: 'home', visible: true, online: true, adapters: [base] };
    const extra = { id: 'side:startup', cacheKey: 'startup/all', sourceKeys: ['startup'],
        stage: async () => { extraReads++; return ['startup']; }, commit() {} };
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1', sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) }) });
    const baseLoad = coordinator.check(); await settle();
    assert.equal(baseReads, 1, 'the first cycle is paused inside the base adapter');
    const requestedLoad = coordinator.ensure(extra);
    gate.resolve();
    assert.equal(await baseLoad, true);
    assert.equal(await requestedLoad, true, 'ensure must not report success until its requested adapter is applied');
    assert.equal(extraReads, 1);
    coordinator.reset();
});

test('same-permission display cache previews before revisions without creating current proof', async () => {
    const shown = [], order = [];
    const adapter = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'], stage: async () => ({ rows: ['fresh'] }), commit() {} };
    const context = { scope: 'account-a', dataPermissionVersion: 'access-v1', viewKey: 'drive', progressive: true, visible: true, online: true, adapters: [adapter] };
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        readDisplaySnapshot: async (item, meta) => { order.push(['cache', meta.dataPermissionVersion]); return { rows: ['saved'] }; },
        previewSnapshots: entries => { order.push(['preview', entries[0].value.rows[0]]); shown.push(entries); },
        readRevisions: async keys => { order.push(['revision']); return { contractVersion: 1, permissionVersion: 'access-v1', sources: keys.map(key => ({ key, state: 'importing', revision: '2' })) }; },
        commitSnapshots: () => { throw new Error('importing cache must not commit'); }
    });
    assert.equal(await coordinator.check(), false);
    assert.deepEqual(order.slice(0, 3), [['cache', 'access-v1'], ['preview', 'saved'], ['revision']]);
    assert.equal(shown.length, 1);
    assert.equal(coordinator.getStatus().state, 'Importing');
    coordinator.reset();
});

test('a new view adapter does not replay stale cached data over an already-applied adapter', async () => {
    const previews = []; let revision = '1', inventoryState = 'ready';
    const master = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'], stage: async () => ({ rows: ['fresh'] }), commit() {} };
    const side = { id: 'core:settings', cacheKey: 'settings/all', sourceKeys: ['settings'], stage: async () => ({ rows: ['settings-fresh'] }), commit() {} };
    const context = { scope: 'account-a', dataPermissionVersion: 'access-v1', viewKey: 'drive', progressive: true, visible: true, online: true, adapters: [master] };
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        readDisplaySnapshot: async adapter => adapter.id === master.id ? { rows: ['stale-disk'] } : { rows: ['settings-disk'] },
        previewSnapshots: entries => previews.push(entries.map(entry => [entry.adapter.id, entry.value.rows[0]])),
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'access-v1', sources: keys.map(key => ({ key, state: key === 'inventory' ? inventoryState : 'ready', revision: key === 'inventory' ? revision : '1' })) }),
        commitSnapshots: () => {}
    });
    assert.equal(await coordinator.check(), true);
    previews.length = 0;
    revision = '2';
    inventoryState = 'importing';
    context.viewKey = 'drive-with-settings';
    context.adapters = [master, side];
    assert.equal(await coordinator.check(), false);
    assert.equal(previews.some(entries => entries.some(([id, value]) => id === master.id && value === 'stale-disk')), false,
        'the pre-revision cached cohort must not roll back the live master row');
    previews.length = 0;
    inventoryState = 'ready';
    await coordinator.check();
    assert.equal(previews.some(entries => entries.some(([id, value]) => id === master.id && value === 'stale-disk')), false,
        'the changed-revision fallback must not roll back an already-applied row while the fresh cohort stages');
    coordinator.reset();
});

test('unchanged revisits keep the already-applied display and do not reapply disk previews', async () => {
    let displayReads = 0, previews = 0, retained = 0, stages = 0;
    const adapter = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'], stage: async () => { stages++; return ['fresh']; }, commit() {} };
    const context = { scope: 'account-a', dataPermissionVersion: 'permission-a', viewKey: 'drive', progressive: true, visible: true, online: true, adapters: [adapter] };
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        readDisplaySnapshot: async () => { displayReads++; return null; },
        previewSnapshots: () => { previews++; },
        retainAppliedDisplay: (_context, entries) => { retained++; assert.equal(entries[0].value[0], 'fresh'); },
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'permission-a', sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) }) });
    await coordinator.check();
    const initialDisplayReads = displayReads;
    assert.ok(initialDisplayReads > 0);
    assert.equal(previews, 1);
    assert.equal(stages, 1);
    await coordinator.check();
    assert.equal(displayReads, initialDisplayReads, 'a complete applied cohort bypasses disk preview on a repeat visit');
    assert.equal(previews, 1, 'a repeat visit cannot reapply stale data or invalidate the cached report index');
    assert.equal(retained, 1, 'a same-permission revisit republishes the current in-memory display without committing it again');
    assert.equal(stages, 1);
    coordinator.reset();
});

test('a changed revision never re-previews an older already-applied cohort over live row updates', async () => {
    let inventoryRevision = '1', sideRevision = '1';
    const previews = [], commits = [], retained = [];
    const inventory = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'],
        stage: async ({ preview }) => {
            if (inventoryRevision === '1') return { rows: ['old master'] };
            preview({ rows: ['fresh master first page'], partial: true });
            return { rows: ['fresh master'] };
        }, commit() {} };
    const side = { id: 'core:settings', cacheKey: 'settings/all', sourceKeys: ['settings'],
        stage: async ({ preview }) => {
            if (sideRevision === '1') return { rows: ['old settings'] };
            // This may complete after a row-level realtime update has already
            // refreshed the displayed inventory, but before the full cohort commits.
            preview({ rows: ['fresh settings first page'], partial: true });
            return { rows: ['fresh settings'] };
        }, commit() {} };
    const context = { scope: 'account-a', dataPermissionVersion: 'permission-a', viewKey: 'drive',
        progressive: true, visible: true, online: true, adapters: [inventory, side] };
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'permission-a',
            sources: keys.map(key => ({ key, state: 'ready', revision: key === 'inventory' ? inventoryRevision : sideRevision })) }),
        retainAppliedDisplay: (_context, entries) => retained.push(entries),
        previewSnapshots: entries => previews.push(entries.map(entry => entry.value.rows)),
        commitSnapshots: entries => commits.push(entries.map(entry => entry.value.rows)) });
    await coordinator.check();
    assert.equal(commits.length, 1);
    previews.length = 0;

    inventoryRevision = sideRevision = '2';
    const pending = coordinator.check();
    await settle();
    assert.deepEqual(previews, [], 'an already-applied complete cohort stays visible until the new atomic cohort commits');
    assert.ok(retained.length >= 1, 'the previously verified display remains available during revalidation');
    assert.equal(await pending, true);
    assert.equal(JSON.stringify(commits.at(-1)), JSON.stringify([['fresh master'], ['fresh settings']]));
    coordinator.reset();
});

test('a mixed new cohort cannot preview an old-revision applied adapter beside fresh data', async () => {
    let inventoryRevision = '1', includeSettings = false;
    const previews = [], commits = [];
    const inventory = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'],
        stage: async ({ preview }) => {
            if (inventoryRevision === '1') return { rows: ['old master'] };
            preview({ rows: ['fresh master first page'], partial: true });
            return { rows: ['fresh master'] };
        }, commit() {} };
    const settings = { id: 'core:settings', cacheKey: 'settings/all', sourceKeys: ['settings'],
        stage: async ({ preview }) => {
            preview({ rows: ['fresh settings first page'], partial: true });
            return { rows: ['fresh settings'] };
        }, commit() {} };
    const context = { scope: 'account-a', dataPermissionVersion: 'permission-a', viewKey: 'drive',
        progressive: true, visible: true, online: true, get adapters() { return includeSettings ? [inventory, settings] : [inventory]; } };
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'permission-a',
            sources: keys.map(key => ({ key, state: 'ready', revision: key === 'inventory' ? inventoryRevision : '2' })) }),
        previewSnapshots: entries => previews.push(entries.map(entry => entry.value.rows)),
        commitSnapshots: entries => commits.push(entries.map(entry => entry.value.rows)) });
    await coordinator.check();
    previews.length = 0;
    inventoryRevision = '2';
    includeSettings = true;
    await coordinator.check();
    assert.ok(previews.length > 0, 'the new cohort can still show current progressive data');
    assert.ok(previews.every(cohort => !cohort.flat().includes('old master')),
        'the old master snapshot cannot be combined with the newly added adapter');
    assert.equal(JSON.stringify(commits.at(-1)), JSON.stringify([['fresh master'], ['fresh settings']]));
    coordinator.reset();
});

test('a new visit can retain its same-account display synchronously before any loading placeholder', async () => {
    let retained = 0, metadataReads = 0;
    const adapter = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'], stage: async () => ['verified'], commit() {} };
    const context = { scope: 'nellie', dataPermissionVersion: 'access-v1', viewKey: 'drive:1', progressive: true, visible: true, online: true, adapters: [adapter] };
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        retainAppliedDisplay: () => { retained++; },
        readRevisions: async keys => { metadataReads++; return { contractVersion: 1, permissionVersion: 'access-v1', sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) }; } });
    await coordinator.check();
    context.viewKey = 'drive:2';
    const priorReads = metadataReads;
    assert.equal(coordinator.retainDisplay(), true);
    assert.equal(retained, 1);
    assert.equal(metadataReads, priorReads, 'retention is synchronous and makes no network request');
    assert.notEqual(coordinator.getStatus().contextKey, JSON.stringify([context.scope, context.dataPermissionVersion, context.viewKey, [[adapter.id, adapter.cacheKey]]]), 'display reuse never establishes fresh read/write proof');
    context.dataPermissionVersion = 'access-v2';
    assert.equal(coordinator.retainDisplay(), false, 'old access cannot authorize display');
    context.dataPermissionVersion = 'access-v1'; context.scope = 'dylan';
    assert.equal(coordinator.retainDisplay(), false, 'another user cannot reuse the prior display');
    coordinator.reset();
});

test('pending access refresh retains same-scope rows for display only, never as current proof', async () => {
    let sourceState = 'ready', retained = 0, stages = 0;
    const adapter = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'],
        stage: async () => { stages++; return ['verified']; }, commit() {} };
    const context = { scope: 'account-a:role-a:login-a', dataPermissionVersion: 'access-v1',
        dataPermissionSnapshotFresh: true, viewKey: 'drive', progressive: true, visible: true, online: true, adapters: [adapter] };
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        retainAppliedDisplay: (_ctx, entries) => { retained++; assert.deepEqual(entries[0].value, ['verified']); },
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'access-v1',
            sources: keys.map(key => ({ key, state: sourceState, revision: '1' })) }) });
    assert.equal(await coordinator.check(), true);
    context.dataPermissionVersion = '';
    context.dataPermissionSnapshotFresh = false;
    sourceState = 'interrupted';
    assert.equal(await coordinator.check(), false, 'pending access and interrupted source are not current read proof');
    assert.equal(retained, 1, 'the same-account last verified rows remain displayed during access refresh');
    const readsBeforeEnsure = coordinator.getStatistics().revisionReads;
    assert.equal(await coordinator.ensure(adapter), false, 'a display-only row cannot satisfy an ensure/read request');
    assert.equal(coordinator.getStatistics().revisionReads, readsBeforeEnsure + 1, 'ensure still performs a current server revision check');
    assert.equal(stages, 1, 'display retention does not stage or authorize another data read');
    coordinator.reset();
});

test('stale permission hashes retain display until confirmed, then reject a changed access scope', async () => {
    let sourceState = 'ready', retained = 0;
    const adapter = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'], stage: async () => ['verified'], commit() {} };
    const context = { scope: 'account-a:role-a:login-a', dataPermissionVersion: 'access-v1',
        dataPermissionSnapshotFresh: true, viewKey: 'drive', progressive: true, visible: true, online: true, adapters: [adapter] };
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        retainAppliedDisplay: () => { retained++; },
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'access-v1',
            sources: keys.map(key => ({ key, state: sourceState, revision: '1' })) }) });
    assert.equal(await coordinator.check(), true);
    context.dataPermissionVersion = 'access-v2';
    context.dataPermissionSnapshotFresh = false;
    sourceState = 'importing';
    assert.equal(coordinator.retainDisplay(), true, 'an unconfirmed cached hash is not a revocation');
    assert.equal(retained, 1);
    context.dataPermissionSnapshotFresh = true;
    assert.equal(coordinator.retainDisplay(), false, 'a confirmed permission change cannot reuse the old display');
    coordinator.reset();
});

test('cached display permission mismatch and logout never preview stale rows', async () => {
    const shown = [];
    const adapter = { id: 'core:master', cacheKey: 'master/all', sourceKeys: ['inventory'], stage: async () => [], commit() {} };
    const context = { scope: 'account-a', dataPermissionVersion: 'access-v2', viewKey: 'drive', progressive: true, visible: true, online: true, adapters: [adapter] };
    let cachePermission = 'access-v1';
    const coordinator = createCoordinator({ getContext: () => context, setTimeout: () => 1, clearTimeout() {},
        readDisplaySnapshot: async (_adapter, meta) => cachePermission === meta.dataPermissionVersion ? { rows: ['saved'] } : null,
        previewSnapshots: entries => shown.push(entries),
        readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'access-v2', sources: keys.map(key => ({ key, state: 'importing', revision: '1' })) })
    });
    await coordinator.check();
    assert.equal(shown.length, 0);
    context.visible = false;
    context.scope = '';
    await coordinator.check();
    assert.equal(shown.length, 0);
    coordinator.reset();
});

const appSource = readComposedAppSource();
function appFunction(name) {
    const found = appSource.match(new RegExp(`(?:async )?function ${name}\\(`));
    assert.ok(found, name);
    const end = appSource.indexOf('\n        function ', found.index + found[0].length);
    assert.ok(end > found.index, name + ' function boundary');
    return appSource.slice(found.index, end);
}

test('touch devices render only the data-free Managers dashboard synchronously', () => {
    const evaluate = ({ view = 'managers', tab = 'dashboard', touch = true, required = [] } = {}) => {
        const context = {
            activeHomeTab: tab,
            isTouchConstrainedDevice: () => touch,
            isIOSDevice: () => false,
            ensureViewRenderState: () => ({ initialized: false, dirty: true }),
            getViewLoadingConfig: () => ({ required }),
        };
        vm.runInNewContext(appFunction('shouldRenderViewSynchronouslyOnSwitch'), context);
        return vm.runInNewContext(`shouldRenderViewSynchronouslyOnSwitch('${view}')`, context);
    };
    assert.equal(evaluate(), true, 'the initial Managers navigation hub has no required data');
    assert.equal(evaluate({ required: [{ key: 'master', mode: 'full' }] }), false, 'a data-dependent cohort stays scheduled');
    assert.equal(evaluate({ tab: 'assigned-items-export' }), false, 'other Managers tabs retain touch scheduling');
    assert.equal(evaluate({ view: 'home' }), false, 'other touch-device views retain their existing scheduling');
    assert.equal(evaluate({ view: 'home', touch: false }), true, 'existing desktop light-view behavior remains');
});

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
// @test-group: foundation


test('published complete baseline loads on cold entry during a failed atomic import without granting current write proof', async () => {
    const f = fixture(); f.state = 'interrupted';
    f.publication = { publishedReadable: true, publishedRevision: 'receipt-1:revision-1', publishedAt: '2026-10-20T02:26:00Z' };
    assert.equal(await f.coordinator.check(), true);
    assert.equal(f.reads, 1);
    assert.equal(f.commits.length, 1);
    assert.equal(f.coordinator.getStatus().state, 'Published data');
    assert.equal(f.coordinator.getStatus().readOnlySnapshot, true);
    assert.equal(f.coordinator.getStatus().dataReadable, true);
    f.coordinator.reset();
});

test('an incomplete publication proof cannot authorize a cold row read', async () => {
    for (const publication of [null, { publishedReadable: true },
        { publishedReadable: true, publishedRevision: 'receipt', publishedAt: 'invalid' },
        { publishedReadable: false, publishedRevision: 'receipt', publishedAt: '2026-10-20T02:26:00Z' }]) {
        const f = fixture(); f.state = 'interrupted'; f.publication = publication;
        assert.equal(await f.coordinator.check(), false); assert.equal(f.reads, 0); f.coordinator.reset();
    }
});

test('published baseline reads discard a changed publication token and retain auth denial protection', async () => {
    const f = fixture(); f.state = 'interrupted';
    f.publication = { publishedReadable: true, publishedRevision: 'receipt:1', publishedAt: '2026-10-20T02:26:00Z' };
    f.loadHook = () => { f.publication = { publishedReadable: true, publishedRevision: 'receipt:2', publishedAt: '2026-10-20T02:27:00Z' }; f.state = 'unavailable'; };
    assert.equal(await f.coordinator.check(), false); assert.equal(f.commits.length, 0);
    f.loadHook = null; f.state = 'interrupted'; f.fault = Object.assign(new Error('forbidden'), { status: 403 });
    assert.equal(await f.coordinator.check(), false); assert.equal(f.commits.length, 0);
    assert.equal(f.coordinator.getStatus().authorizationDenied, true); f.coordinator.reset();
});

 test('core imports lead the five-stage run and status polling bypasses Apps Script', () => {
 const script=readFileSync(new URL('../Code.gs',import.meta.url),'utf8');
 assert.match(script,/MANUAL_SYNC_STAGE_ORDER_DEFAULT = Object.freeze\(\['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed'\]/);
 });

test('sync status reads authenticated PostgREST without Apps Script status requests', async () => {
 const calls=[];const ctx=vm.createContext({supabaseRpc:async(rpc,body)=>{calls.push({rpc,body});return {active:true,currentStage:'drive'};},normalizeManualSyncStatusPayload:value=>value});
 vm.runInContext(appFunction('fetchManualSyncStatusFromScript'),ctx);
 assert.equal((await ctx.fetchManualSyncStatusFromScript()).currentStage,'drive');
 assert.equal(calls[0].rpc,'get_my_erp_sync_progress_v23116'); assert.deepEqual(Object.keys(calls[0].body),[]);
 const runtime=readComposedRuntimeSource();
 assert.ok(runtime.includes('MANUAL_SYNC_STATUS_POLL_MS = 10000'));
 const script=readFileSync(new URL('../Code.gs',import.meta.url),'utf8');
 for(const expected of ['IMPORT_HISTORY_CHUNK_SIZE_ = 2000','scheduleRequestIntegrityMaintenance_();','app_manual_sync_status','chunkSize: 2000']) assert.ok(script.includes(expected),expected);
 assert.ok(script.includes('chunkSize === 500') || script.includes('[500,2000]'));
});


test('one foreground heartbeat pauses hidden callbacks and skips unchanged dataset downloads', async () => {
    let heartbeat = 0, interval = 30000;
    const f = fixture({ getPollInterval: () => interval, onHeartbeat: () => heartbeat++ });
    await f.coordinator.check();
    assert.equal(f.reads, 1);
    await f.advance(30000);
    assert.equal(f.reads, 1, 'unchanged revision must retain the dataset');
    assert.equal(heartbeat, 1);
    const metadataReads = f.metadataReads;
    f.context.visible = false;
    await f.advance(30000);
    assert.equal(f.metadataReads, metadataReads);
    assert.equal(heartbeat, 1);
    assert.equal(f.timers.size, 0);
    f.context.visible = true;
    interval = 10000;
    await f.coordinator.check('foreground');
    assert.equal(f.metadataReads, metadataReads + 1, 'resume performs one lightweight revision read');
    assert.equal(f.reads, 1);
    await f.advance(10000);
    assert.equal(heartbeat, 2);
    f.coordinator.reset();
});

test('v2.3.89 polls every 15 seconds and hot-reloads every processed file cohort in the background', () => {
    const runtime = readComposedRuntimeSource();
    const registry = readFileSync(new URL('../assets/live-sync-registry.js', import.meta.url), 'utf8');
    assert.match(runtime, /getPollInterval:\s*\(\) => hasActiveManualSync\(\) \? 10000 : 15000/);
    assert.match(runtime, /for \(const key of \['soc', 'reserves', 'cav'\]\)[^]*createProductionCoreLiveAdapter\(key, 'browse'/);
    assert.match(runtime, /getAdapter\('side:po'/);
    assert.match(registry, /homeSyncMetadata:\s*\[[^\]]*'hl_po_parsed'/);
    assert.match(registry, /po:\s*\[[^\]]*'hl_po_parsed'/);
});

test('Dylan receives one toast per immutable processed file identity and other users receive none', () => {
    const runtime = readComposedRuntimeSource();
    const start = runtime.indexOf("const DYLAN_FILE_TOAST_STORAGE_KEY");
    const end = runtime.indexOf('\n        function mergeDashboardSyncSummaries', start);
    const source = runtime.slice(start, end);
    const storage = new Map(), toasts = [];
    const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
    const context = { currentUser: 'dylan_collyge', localStorage, showToast: (...args) => toasts.push(args),
        firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') ?? '' };
    vm.runInNewContext(source, context);
    const keys = ['ph_master_inventory', 'ph_cav_import', 'ph_reserves', 'ph_soc_master'];
    const metadata = (revision, fileVersion = 1) => ({ contractVersion: 1, sources: keys.map((key, index) => ({
        key, revision: String(revision + index), state: 'ready', sourceFileName: `${key}-${fileVersion}.xlsx`,
        sourceFileId: `${key}-drive-${fileVersion}`, sourceImportedAt: `2026-10-27T18:${String(revision).padStart(2, '0')}:00Z`
    })) });
    assert.deepEqual(Array.from(context.processDylanFileProcessedToasts(metadata(1))), []);
    assert.equal(toasts.length, 0, 'initial boot seeds without replaying old files');
    assert.deepEqual(Array.from(context.processDylanFileProcessedToasts(metadata(2))), [], 'revision-only advances are not new files');
    assert.deepEqual(Array.from(context.processDylanFileProcessedToasts(metadata(3, 2))), keys);
    assert.equal(toasts.length, 4);
    assert.ok(toasts.every(([, message]) => /processed — Supabase updated/.test(message)));
    context.currentUser = 'megan_kelly';
    context.processDylanFileProcessedToasts(metadata(4, 3));
    assert.equal(toasts.length, 4, 'non-Dylan accounts never receive file-processed toasts');
});


test('conditional page cache avoids retransfers and is isolated by account and permission', async () => {
    const app = readComposedAppSource();
    const source = app.match(/        async function requestAuthorizedDatasetReadPage\([^]*?^        }/m)[0];
    let scope = 'alice', version = 'v1', transferred = 0;
    const calls = [];
    const context = { structuredClone, Map, console,
      getAuthorizedDatasetRead: () => ({ dataset: 'cav' }),
      buildAuthorizedDatasetReadParams: () => ({ limit: 500, offset: 0 }),
      getSupabaseReadIdentityScope: () => scope,
      appAccessSnapshotState: { snapshot: { dataPermissionVersion: version } },
      APP_API_FUNCTION_URL: '/app-api', SUPABASE_READ_TIMEOUT_MS: 1000,
      staleSupabaseReadScopeError: () => new Error('stale'),
      postAppFunctionJson: async (_url, body) => {
        calls.push(body);
        if (body.params.ifRevision === '7') return { ok: true, data: { revision: '7', up_to_date: true } };
        transferred++;
        return { ok: true, data: { rows: [{ unique_id: scope }], revision: '7', total: 1, offset: 0, limit: 500 } };
      }
    };
    vm.runInNewContext(source, context);
    const first = await context.requestAuthorizedDatasetReadPage('ph_cav_import');
    first.rows[0].unique_id = 'local-edit';
    const second = await context.requestAuthorizedDatasetReadPage('ph_cav_import');
    assert.equal(second.rows[0].unique_id, 'alice', 'cached snapshots must not share mutable response rows');
    assert.equal(transferred, 1);
    assert.equal(calls[1].params.ifRevision, '7');
    scope = 'bob';
    await context.requestAuthorizedDatasetReadPage('ph_cav_import');
    assert.equal(calls[2].params.ifRevision, undefined);
    context.appAccessSnapshotState.snapshot.dataPermissionVersion = 'v2';
    await context.requestAuthorizedDatasetReadPage('ph_cav_import');
    assert.equal(calls[3].params.ifRevision, undefined);
    assert.equal(transferred, 3);
});


test('idle sync header never counts interrupted datasets as updating', () => {
    const runtime=readComposedAppSource();
    const fn=runtime.match(/        function getDatasetRevisionConnectionLabel\([^]*?^        }/m)[0];
    let active=false;
    const context=vm.createContext({ datasetRevisionConnectionOwner:'owner',getSupabaseReadIdentityScope:()=> 'owner',window:{},
      hasActiveManualSync:()=>active, datasetRevisionConnectionStates:[{state:'ready'},{state:'interrupted'},{state:'importing'}] });
    vm.runInContext(fn,context);
    assert.equal(context.getDatasetRevisionConnectionLabel(),'Connected · 1 ready');
    active=true;
    assert.equal(context.getDatasetRevisionConnectionLabel(),'Connected · 1 ready · 1 updating');
});


test('Location Moves paints its own memory snapshot while active queue verification stays in background', () => {
  const runtime = readComposedAppSource();
  const render = runtime.match(/function renderRequest\([^]*?^        }/m)[0];
  assert.match(render, /refreshRequestViewInBackground/);
  assert.doesNotMatch(render, /if \(ensureViewDataForRender\('request'\)\)/);
});

test('Request and Assigned Items paint retained rows before bounded background hydration', () => {
  const runtime = readComposedAppSource();
  const synchronousSwitch = runtime.slice(runtime.indexOf('function shouldRenderViewSynchronouslyOnSwitch'), runtime.indexOf('function switchView'));
  const requestRefresh = runtime.slice(runtime.indexOf('function refreshRequestViewInBackground'), runtime.indexOf('function renderRequest()'));
  const assignedPanel = runtime.slice(runtime.indexOf('function renderManagerAssignedItemsExportPanel'), runtime.indexOf('function renderManagerEvalReportsPanel'));
  const assignedEntry = runtime.slice(runtime.indexOf("if (nextTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW)"), runtime.indexOf("if (nextTab === MANAGER_EVAL_REPORTS_VIEW)"));
  const managerRender = runtime.match(/function renderManagers\(\)[\s\S]*?^        }/m)[0];
  assert.match(synchronousSwitch, /targetViewId === 'request'[\s\S]*!requestState\.initialized \|\| !!requestState\.dirty/);
  assert.match(requestRefresh, /REQUEST_VIEW_BACKGROUND_TIMEOUT_MS[\s\S]*Request queue refresh/);
  assert.doesNotMatch(assignedPanel, /return ['"`][^'"`]*Loading AssignedTo rows/);
  assert.match(managerRender, /activeHomeTab !== MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && ensureViewDataForRender\('managers'\)/);
  assert.match(assignedEntry, /force: !warehouseAssignedItemsInventory\.length[\s\S]*bypassLiveSyncCoordinator: !warehouseAssignedItemsInventory\.length[\s\S]*retryOnCancellation: !warehouseAssignedItemsInventory\.length[\s\S]*preserveRequestedMode: true/);
});


test('Location Work displays cached jobs during a pending read and transport retry preserves denials', () => {
  const runtime=readComposedAppSource();
  const fn=name=>runtime.match(new RegExp('function '+name+'\\([^]*?^        }','m'))[0];
  const cooldowns=new Map([['queue',{until:Date.now()+60000}]]), denials=new Map([['other','denied']]);
  const ctx=vm.createContext({locationWorkLoading:true,locationWorkLoaded:false,locationWorkError:'',locationWorkRows:[{id:'move-1'}],renderLocationWorkQueueCard:row=>'<article>'+row.id+'</article>',supabaseReadFailureCooldowns:cooldowns,supabaseReadTerminalDenials:denials});
  vm.runInContext(fn('renderLocationWorkQueue')+fn('resetQueueReadCooldowns'),ctx);
  const start=performance.now(); const html=ctx.renderLocationWorkQueue();
  assert.match(html,/move-1/); assert.doesNotMatch(html,/Loading/); assert.ok(performance.now()-start<50);
  ctx.resetQueueReadCooldowns(); assert.equal(cooldowns.size,0);assert.equal(denials.size,1);
});

test('v2.3.45 treats Bunch Note revisions as optional and retries transient identity or inventory races silently', () => {
  const source = readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8');
  assert.match(source, /optionalReadySources = new Set\(\['bunch_note_private\.jobs', 'bunch_note_private\.previews'\]\)/);
  assert.match(source, /state: optionalReadySources\.has\(key\) \? 'ready' : 'unavailable'/);
  assert.match(source, /NATIVE_PROFILE_RETRY_REQUIRED/);
  assert.match(source, /LOC_ON_HAND_REVISION_CHANGED[^]*?continue/);
  assert.match(source, /if \(isSilentBackgroundRetry\(error\) \|\| isInventoryRevisionAdoption\(error\)\)[^]*?signal\([^]*?, 1000\)/);
});

test('v2.3.56 REQUEST reconciliation is bounded, non-blocking, and refreshes every open', () => {
  const runtime = readComposedRuntimeSource();
  const appApi = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/20261023233000_bounded_request_queue_reconciliation_v2.sql', import.meta.url), 'utf8');
  assert.match(runtime, /const REQUEST_LIVE_QUEUE_POLL_MS = 8000/);
  assert.match(runtime, /function isRequestPendingVisible[^]*\['', 'pending', 'open'\]\.includes\(status\)/);
  assert.match(runtime, /function buildPendingRequestRenderPlan[^]*compareLocationCodeValues\(a\.LOCATIONCODE, b\.LOCATIONCODE\)[^]*naturalCompare\(a\.LOTCODE, b\.LOTCODE\)/);
  assert.match(runtime, /forceRefreshRequestsForView\('request-tab', \{[^]*force: true[^]*minIntervalMs: 0/);
  assert.match(runtime, /forceRefreshRequestsForView === 'function'[^]*forceRefreshRequestsForView\('request-home-open', \{ force: true, minIntervalMs: 0/);
  assert.match(appApi, /\["request_queue", "active_request"\]\.includes\(dataset\)[^]*Promise\.resolve\(supabase\.rpc\("reconcile_active_requests_from_outbox_v1"\)\)[^]*runtime\.waitUntil\(reconciliationTask\)/);
  assert.doesNotMatch(appApi, /const reconciliation = await supabase\.rpc\("reconcile_active_requests_from_outbox_v1"\)/);
  assert.match(migration, /where o\.event_type='request_created'[^]*order by o\.created_at desc,o\.event_id desc[^]*limit 100/);
  assert.match(migration, /regexp_matches[^]*insert into public\.ph_active_request/);
  assert.match(migration, /ph_request_delivery_outbox_request_created_recent_idx/);
  assert.match(migration, /request_source[^]*customeridentityid[^]*consigneeidentityid/);
  assert.doesNotMatch(migration, /update public\.ph_active_request set req_qty='1'/);
});

test('v2.3.81 RUN SCRIPT fast-skips before parsing and stages 1,000-row RPC batches before canonical commit', () => {
  const code = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
  const runtime = readComposedRuntimeSource();
  const migration = readFileSync(new URL('../supabase/migrations/20261026070000_agdata_v2369_fast_live_erp_ingestion.sql', import.meta.url), 'utf8');
  const fastFunction = code.slice(code.indexOf('function processFastLiveFile_('), code.indexOf('function runRoutedDropImport_('));
  assert.ok(fastFunction.indexOf("callSupabaseRpc_('check_erp_file_sync_needed_v1'") < fastFunction.indexOf('extractDataFromFile('));
  assert.match(fastFunction, /check\.skip[^]*code: 'UP_TO_DATE'/);
  assert.match(fastFunction, /callSupabaseRpc_\('fast_begin_erp_stage_v1'/);
  assert.match(fastFunction, /offset \+= 1000/);
  assert.match(fastFunction, /callSupabaseRpc_\('fast_append_erp_stage_batch_v1'/);
  assert.match(fastFunction, /callSupabaseRpc_\('fast_commit_erp_stage_swap_v1'/);
  assert.doesNotMatch(fastFunction, /callSupabaseRpc_\(getFastLiveIngestRpc_\(dataset\)/);
  assert.doesNotMatch(fastFunction, /fetchAllSupabaseData|pushToSupabase|deleteFromSupabase/);
  assert.match(appFunction('runGoogleAppsScriptTrigger'), /action: 'erp_sync'[^]*operation: 'start'[^]*maxAttemptsPerStage: 1[^]*force: true/);
  assert.doesNotMatch(appFunction('runGoogleAppsScriptTrigger'), /postGoogleScriptJsonPayload|manual_run|manual_continue/);
  assert.match(migration, /btrim\(p_file_name\) like '~\$%'/);
  assert.match(migration, /upper\(btrim\(p_file_name\)\) like 'TEMP\\_%'/);
  assert.match(migration, /merge_compact_history_state_v2366[^]*merge_drive_around_report_state_v2366/);
  assert.match(migration, /\(itemcode,row_state_hash\)/);
});
