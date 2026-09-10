import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const sandbox = { module: { exports: {} }, setTimeout, clearTimeout };
vm.runInNewContext(readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8'), sandbox);
const { createCoordinator } = sandbox.module.exports;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function fixture(options = {}) {
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
        clearTimeout: (id) => timers.delete(id),
        ...options
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
test('an immediate resume supersedes a queued low-priority check', async () => {
    const f = fixture(); await f.coordinator.check(); f.revision = '2';
    f.coordinator.signal('background-request', 30000); f.coordinator.signal('resume', 0);
    await f.advance(0); assert.equal(f.reads, 2);
});

test('two visible aliases of the same physical snapshot issue one full read', async () => {
    const f = fixture(); f.context.adapters.push({ ...f.adapter });
    await f.coordinator.check(); assert.equal(f.reads, 1); assert.equal(f.commits.length, 1);
});

test('a verified requested snapshot succeeds while an unrelated adapter fails', async () => {
    const f = fixture();
    f.context.adapters.push({ id: 'side:calendar', cacheKey: 'calendar/all', sourceKeys: ['calendar'],
        stage: async () => { throw new Error('Calendar unavailable'); }, commit() {} });
    assert.equal(await f.coordinator.ensure(f.adapter, true), true);
    assert.equal(f.commits.length, 1);
    assert.equal(f.coordinator.getStatus().state, 'Needs attention');
    assert.equal(f.coordinator.getStatus().lastVerifiedAt, null);
});

test('a verified loader does not require an unrelated denied source to become ready', async () => {
    const f = fixture();
    const denied = { id: 'side:denied', cacheKey: 'denied', sourceKeys: ['denied'],
        stage: async () => { throw new Error('Unavailable auxiliary data'); }, commit() {} };
    f.context.adapters.push(denied);
    assert.equal(await f.coordinator.ensure(f.adapter), true);
    assert.equal(await f.coordinator.ensure(denied, true), false);
    assert.equal(f.coordinator.getStatus().state, 'Needs attention');
});

test('failed forced verification cannot succeed from an older applied cache entry', async () => {
    const f = fixture();
    assert.equal(await f.coordinator.ensure(f.adapter), true);
    f.revision = '2'; f.fault = new Error('Requested data failed');
    assert.equal(await f.coordinator.ensure(f.adapter, true), false);
    assert.equal(f.commits.length, 1);
    assert.equal(f.coordinator.getStatus().state, 'Needs attention');
});

test('an account change cannot satisfy an old account loader even if the new one loads', async () => {
    const f = fixture(); const gate = deferred(); f.loadHook = () => gate.promise;
    const pending = f.coordinator.ensure(f.adapter, true); await settle();
    f.context.scope = 'new-account'; gate.resolve();
    assert.equal(await pending, false);
});

test('failed metadata validation cannot acknowledge a cached snapshot', async () => {
    const f = fixture(); await f.coordinator.ensure(f.adapter);
    f.metadataHook = async () => { throw new Error('Revision check failed'); };
    assert.equal(await f.coordinator.ensure(f.adapter, true), false);
    assert.equal(await f.coordinator.ensure(f.adapter), false);
});

function cachedEntry(overrides = {}) {
    return { contractVersion: 1, id: 'core:soc', cacheKey: 'soc/all', scope: 'same-user/site-role-v1',
        permissionVersion: 'role-v1', sources: [{ key: 'ph_soc_master', revision: '1', state: 'ready' }],
        verifiedAt: 100, value: [{ id: 'cached-dock', nested: { server: true } }], ...overrides };
}

test('warm canonical cache and metadata load together; unchanged data needs zero full reads', async () => {
    const disk = deferred(), metadata = deferred(); let diskStarted = false;
    const f = fixture({ loadSnapshot: async () => { diskStarted = true; return disk.promise; } });
    f.metadataHook = () => metadata.promise;
    const checking = f.coordinator.check(); await settle();
    assert.equal(diskStarted, true); assert.equal(f.metadataReads, 1);
    assert.equal(f.commits.length, 0); assert.equal(f.coordinator.isVerified(f.adapter), false);
    disk.resolve(cachedEntry()); metadata.resolve();
    assert.equal(await checking, true); assert.equal(f.reads, 0); assert.equal(f.metadataReads, 1);
    assert.equal(f.commits[0][0].id, 'cached-dock'); assert.equal(f.coordinator.isVerified(f.adapter), true);
});

test('changed revision previews authorized cache as unverified, then replaces it with fenced server data', async () => {
    const gate = deferred(), previews = [], saved = [];
    const f = fixture({ loadSnapshot: async () => cachedEntry(), previewSnapshots: (items) => previews.push(items), saveSnapshot: (entry) => saved.push(entry) });
    f.revision = '2'; f.loadHook = () => gate.promise;
    const checking = f.coordinator.check(); await settle();
    assert.equal(previews.length, 1); assert.equal(previews[0][0].value[0].id, 'cached-dock');
    assert.equal(f.coordinator.isVerified(f.adapter), false); assert.equal(f.commits.length, 0); assert.equal(saved.length, 0);
    gate.resolve(); assert.equal(await checking, true);
    assert.equal(f.commits[0][0].id, 'dock-28'); assert.equal(saved[0].sources[0].revision, '2');
});

for (const [name, override] of [
    ['permission', { permissionVersion: 'old-role' }], ['scope', { scope: 'other-user' }],
    ['schema', { contractVersion: 2 }], ['query', { cacheKey: 'soc/other-season' }],
    ['adapter', { id: 'core:other' }], ['source set', { sources: [{ key: 'other-source', revision: '1', state: 'ready' }] }],
    ['source readiness', { sources: [{ key: 'ph_soc_master', revision: '1', state: 'importing' }] }],
    ['verification time', { verifiedAt: undefined }]
]) test('cache with mismatched ' + name + ' is never previewed or trusted', async () => {
    let previews = 0;
    const f = fixture({ loadSnapshot: async () => cachedEntry(override), previewSnapshots: () => previews++ });
    assert.equal(await f.coordinator.check(), true);
    assert.equal(previews, 0); assert.equal(f.reads, 1); assert.equal(f.commits[0][0].id, 'dock-28');
});

test('denied or missing current sources forbid even an otherwise valid cache preview', async () => {
    for (const missing of [false, true]) {
        let previews = 0;
        const f = fixture({ loadSnapshot: async () => cachedEntry(), previewSnapshots: () => previews++,
            readRevisions: async () => ({ contractVersion: 1, permissionVersion: 'role-v1', sources: missing ? [] : [{ key: 'ph_soc_master', revision: null, state: 'unavailable' }] }) });
        assert.equal(await f.coordinator.check(), false);
        assert.equal(previews, 0); assert.equal(f.reads, 0); assert.equal(f.commits.length, 0);
        assert.equal(f.coordinator.isVerified(f.adapter), false);
    }
});

test('canonical and persisted snapshots stay immutable when commit mutates application rows', async () => {
    const saved = [], painted = [];
    const f = fixture({ saveSnapshot: (entry) => saved.push(entry), commitSnapshots: (items) => {
        items.forEach(({ value }) => { painted.push(structuredClone(value)); value[0].nested.server = 'draft'; value.push({ id: 'optimistic-row' }); });
    } });
    f.rows = [{ id: 'server-row', nested: { server: true } }];
    await f.coordinator.check();
    assert.deepEqual(saved[0].value, [{ id: 'server-row', nested: { server: true } }]);
    f.adapter.cacheKey = 'soc/second-query'; await f.coordinator.check();
    f.adapter.cacheKey = 'soc/all'; await f.coordinator.check();
    assert.equal(f.reads, 2); assert.deepEqual(painted.at(-1), [{ id: 'server-row', nested: { server: true } }]);
    assert.equal(saved.length, 2);
});

test('optional storage failures and slow writes do not delay verification', async () => {
    const never = deferred();
    const f = fixture({ loadSnapshot: async () => { throw new Error('IDB unavailable'); }, saveSnapshot: () => never.promise });
    assert.equal(await f.coordinator.ensure(f.adapter), true); assert.equal(f.reads, 1);
    never.resolve();
});

test('slow badge starts after critical data and cannot delay its check or own ensure result', async () => {
    const gate = deferred(), events = [];
    const f = fixture();
    f.context.backgroundAdapters = [{ id: 'badge:request', cacheKey: 'request/badge', sourceKeys: ['requests'],
        stage: async () => { events.push('badge-start'); await gate.promise; return [{ badge: 2 }]; }, commit: () => events.push('badge-commit') }];
    f.loadHook = () => { events.push('critical-stage'); };
    assert.equal(await f.coordinator.ensure(f.adapter), true); await settle();
    assert.equal(f.commits.length, 1); assert.equal(f.coordinator.getStatus().state, 'Up to date');
    assert.equal(f.coordinator.isVerified(f.adapter), true);
    assert.deepEqual(events, ['critical-stage', 'badge-start']);
    gate.resolve(); await settle(); assert.equal(events.at(-1), 'badge-commit');
});

test('new navigation verifies immediately while the old shared dataset finishes without painting', async () => {
    const gate = deferred(), saved = [];
    const f = fixture({ saveSnapshot: (entry) => saved.push(entry) });
    f.loadHook = () => gate.promise;
    const original = f.coordinator.check(); await settle();
    const bCommits = [];
    const b = { id: 'side:b', cacheKey: 'b/all', sourceKeys: ['b'], stage: async () => ['B'], commit: (value) => bCommits.push(value) };
    f.context.viewKey = 'B'; f.context.adapters = [b];
    assert.equal(await f.coordinator.check(), true); assert.deepEqual(bCommits, [['B']]);
    gate.resolve(); await original;
    assert.equal(f.commits.length, 0); assert.equal(saved.some((entry) => entry.id === f.adapter.id), true);
    f.context.viewKey = 'docks'; f.context.adapters = [f.adapter];
    assert.equal(await f.coordinator.check(), true);
    assert.equal(f.reads, 1); assert.equal(f.commits.length, 1);
});

test('same adapter A to B to A navigation reuses the pending request and commits only once', async () => {
    const gate = deferred(); const f = fixture(); f.loadHook = () => gate.promise;
    const a = f.coordinator.check(); await settle();
    f.context.viewKey = 'B'; const b = f.coordinator.check(); await settle();
    f.context.viewKey = 'docks'; const again = f.coordinator.check();
    gate.resolve(); await Promise.all([a, b, again]);
    assert.equal(f.reads, 1); assert.equal(f.commits.length, 1); assert.equal(f.coordinator.isVerified(f.adapter), true);
});

test('query or account changes during a cached read cannot paint or persist its old scope', async () => {
    for (const change of ['query', 'account']) {
        const gate = deferred(), saved = []; const f = fixture({ saveSnapshot: (entry) => saved.push(entry) });
        f.loadHook = () => gate.promise;
        const checking = f.coordinator.check(); await settle();
        if (change === 'query') f.adapter.cacheKey = 'soc/other-query'; else f.context.scope = 'new-user';
        gate.resolve(); await checking;
        assert.equal(saved.some((entry) => entry.scope === 'same-user/site-role-v1' && entry.cacheKey === 'soc/all'), false);
        if (change === 'query') assert.equal(saved.every((entry) => entry.cacheKey === 'soc/other-query'), true);
    }
});

test('imports retain only an unverified preview, and a ready empty snapshot removes deleted rows', async () => {
    const previews = [], saved = [];
    const f = fixture({ loadSnapshot: async () => cachedEntry(), previewSnapshots: (items) => previews.push(items), saveSnapshot: (entry) => saved.push(entry) });
    f.state = 'importing'; f.revision = '2';
    assert.equal(await f.coordinator.check(), false); assert.equal(f.coordinator.isVerified(f.adapter), false);
    assert.equal(previews.length, 1); assert.equal(f.commits.length, 0); assert.equal(saved.length, 0);
    f.state = 'ready'; f.revision = '3'; f.rows = [];
    assert.equal(await f.coordinator.check(), true); assert.deepEqual(f.commits.at(-1), []);
    assert.deepEqual(saved[0].value, []); assert.equal(saved[0].sources[0].revision, '3');
});

test('a changing unrelated critical source retries only its own dataset and commits one consistent group', async () => {
    let sideRevision = '1', coreReads = 0, sideReads = 0; const commits = [];
    const f = fixture({ readRevisions: async (keys) => ({ contractVersion: 1, permissionVersion: 'role-v1', sources: keys.map((key) => ({ key, revision: key === 'side' ? sideRevision : '1', state: 'ready' })) }),
        commitSnapshots: (items, ctx, meta) => commits.push({ ids: items.map(({ adapter }) => adapter.id), revision: meta.sources.get('side').revision }) });
    f.loadHook = () => { coreReads++; };
    f.context.adapters.push({ id: 'side:test', cacheKey: 'side/all', sourceKeys: ['side'], stage: async () => { sideReads++; if (sideReads === 1) sideRevision = '2'; return [{ revision: sideRevision }]; }, commit() {} });
    assert.equal(await f.coordinator.check(), true);
    assert.equal(coreReads, 1); assert.equal(sideReads, 2); assert.equal(commits.length, 1);
    assert.equal(commits[0].ids.length, 2); assert.equal(commits[0].revision, '2');
});

test('revision churn has a bounded three-pass retry and schedules a later check', async () => {
    let revision = 1; const f = fixture();
    f.loadHook = () => { f.revision = String(++revision); };
    assert.equal(await f.coordinator.check(), false);
    assert.equal(f.reads, 3); assert.equal(f.commits.length, 0);
    assert.equal(f.coordinator.getStatistics().discardedLoads, 3);
    assert.equal([...f.timers.values()].some((timer) => timer.at === 2000), true);
});

test('a formerly verified descriptor cannot authorize a different currently selected query', async () => {
    const f = fixture(); await f.coordinator.check(); const old = { ...f.adapter };
    f.adapter.cacheKey = 'soc/new-query';
    assert.equal(f.coordinator.isVerified(old), false); assert.equal(f.coordinator.isVerified(f.adapter), false);
});

test('background discovery of a changed shared source revokes visible verification immediately', async () => {
    let revision = '1', badgeStarted = false; const gate = deferred();
    const f = fixture({ readRevisions: async (keys) => ({ contractVersion: 1, permissionVersion: 'role-v1', sources: keys.map((key) => ({ key, revision: badgeStarted ? '2' : revision, state: 'ready' })) }) });
    f.context.backgroundAdapters = [{ id: 'badge:shared', cacheKey: 'badge/all', sourceKeys: ['ph_soc_master'], stage: async () => { await gate.promise; return []; }, commit() {} }];
    await f.coordinator.check(); await settle(); assert.equal(f.coordinator.isVerified(f.adapter), true);
    badgeStarted = true; revision = '2'; gate.resolve(); await settle();
    assert.equal(f.coordinator.isVerified(f.adapter), false);
    assert.equal(f.coordinator.getStatus().state, 'Syncing');
    assert.equal([...f.timers.values()].some((timer) => timer.at === 1000), true);
});

test('late metadata cannot replace a newer observation and bless an outdated navigation load', async () => {
    const delayed = deferred(); let calls = 0; const saved = [];
    const f = fixture({ saveSnapshot: (entry) => saved.push(entry), readRevisions: async (keys) => {
        const call = ++calls;
        if (call === 2) await delayed.promise;
        return { contractVersion: 1, permissionVersion: 'role-v1', sources: keys.map((key) => ({ key, revision: call <= 2 ? '1' : '2', state: 'ready' })) };
    } });
    const first = f.coordinator.check(); await settle();
    f.context.viewKey = 'B'; f.rows = [{ id: 'new-revision' }];
    assert.equal(await f.coordinator.check(), true); delayed.resolve(); await first;
    assert.equal(f.commits.length, 1); assert.equal(f.commits[0][0].id, 'new-revision');
    assert.equal(saved.every((entry) => entry.sources[0].revision === '2'), true);
    assert.equal(f.coordinator.isVerified(f.adapter), true);
});

test('canonical Map and Set snapshots retain native methods and isolate nested committed drafts', async () => {
    const saved = [], painted = [];
    const value = { map: new Map([['row', { count: 1 }]]), set: new Set([{ id: 'server' }]) };
    const f = fixture({ saveSnapshot: (entry) => saved.push(entry), commitSnapshots: (items) => {
        const current = items[0].value;
        painted.push(current.map.get('row').count);
        current.map.get('row').count = 99; current.set.add({ id: 'draft' });
    } });
    f.adapter.stage = async () => value;
    await f.coordinator.check();
    assert.equal(saved[0].value.map.get('row').count, 1); assert.equal(saved[0].value.set.size, 1);
    f.adapter.cacheKey = 'soc/second'; await f.coordinator.check();
    f.adapter.cacheKey = 'soc/all'; await f.coordinator.check();
    assert.deepEqual(painted, [1, 1, 1]); assert.equal(value.map.get('row').count, 1); assert.equal(value.set.size, 1);
});

test('onVerified observes installed flags for critical and background snapshots', async () => {
    const observations = [], gate = deferred(); let f;
    f = fixture({ onVerified: () => observations.push([f.coordinator.isVerified(f.adapter), f.coordinator.isVerified(badge)]) });
    const badge = { id: 'badge:map', cacheKey: 'map/all', sourceKeys: ['badge'], stage: async () => { await gate.promise; return new Map(); }, commit() {} };
    f.context.backgroundAdapters = [badge];
    await f.coordinator.check(); assert.deepEqual(observations, [[true, false]]);
    gate.resolve(); await settle(); assert.deepEqual(observations.at(-1), [true, true]);
});

test('settings changing a derived query during commit reverify that selection before acknowledging it', async () => {
    let first = true; const f = fixture({ commitSnapshots: () => { if (first) { first = false; f.adapter.cacheKey = 'soc/new-season'; } } });
    assert.equal(await f.coordinator.check(), true); assert.equal(f.reads, 2);
    assert.equal(f.coordinator.isVerified(f.adapter), true);
});

test('a failed authoritative permission refresh cannot be skipped by the next check', async () => {
    let permissionReads = 0;
    const f = fixture({ onPermissionChange: async () => { if (++permissionReads === 1) throw new Error('Policy read failed'); } });
    await f.coordinator.check(); f.permission = 'role-v2';
    assert.equal(await f.coordinator.check(), false); assert.equal(f.coordinator.isVerified(f.adapter), false);
    assert.equal(f.reads, 1); assert.equal(f.commits.length, 1);
    assert.equal(await f.coordinator.check(), true); assert.equal(permissionReads, 2); assert.equal(f.reads, 2);
});

test('concurrent navigation cannot accept snapshots while the authoritative permission refresh is pending', async () => {
    const gate = deferred(); let permissionReads = 0;
    const f = fixture({ onPermissionChange: async () => { permissionReads++; await gate.promise; } });
    await f.coordinator.check(); f.permission = 'role-v2';
    const a = f.coordinator.check(); await settle();
    f.context.viewKey = 'B'; const b = f.coordinator.check(); await settle();
    assert.equal(permissionReads, 1); assert.equal(f.commits.length, 1); assert.equal(f.coordinator.isVerified(f.adapter), false);
    gate.resolve(); await Promise.all([a, b]);
    assert.equal(permissionReads, 1); assert.equal(f.coordinator.isVerified(f.adapter), true);
});
