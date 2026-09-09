import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const sandbox = { module: { exports: {} }, setTimeout, clearTimeout };
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
