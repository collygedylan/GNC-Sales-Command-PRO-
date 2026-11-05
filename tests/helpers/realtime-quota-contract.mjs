import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

export async function assertRealtimeQuotaContract(base = new URL('../../', import.meta.url)) {
  for (const prefix of ['', 'test/']) {
    const source = fs.readFileSync(new URL(prefix + 'assets/live-sync-coordinator.js', base), 'utf8');
    const context = { module: { exports: {} }, AbortController, setTimeout, clearTimeout, console };
    vm.runInNewContext(source, context);
    let clock = 0, timerId = 0, notify, subscriptions = 0, closed = 0, reads = 0;
    const timers = new Map();
    const state = { scope: 'actor-a', viewKey: 'docks', authenticated: true, visible: true, online: true,
      adapters: [{ id: 'soc', cacheKey: 'soc/all', sourceKeys: ['ph_soc_master'], stage: async () => [], commit() {} }] };
    const coordinator = context.module.exports.createCoordinator({
      getContext: () => state, now: () => clock,
      readRevisions: async keys => { reads++; return { contractVersion: 1, permissionVersion: '1',
        sources: keys.map(key => ({ key, revision: '1', state: 'ready' })) }; },
      subscribe: callback => { subscriptions++; notify = callback; return () => closed++; },
      setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
      clearTimeout: id => timers.delete(id)
    });
    const advance = async ms => {
      clock += ms;
      for (let tick = 0; tick < 30; tick++) {
        for (const [id, timer] of timers) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
        await Promise.resolve();
      }
    };
    await coordinator.check('initial');
    assert.equal(subscriptions, 1);
    const before = reads;
    for (let i = 0; i < 50; i++) notify({ new: { key: 'ph_soc_master' } });
    await advance(499); assert.equal(reads, before);
    notify({ new: { key: 'ph_soc_master' } });
    await advance(499); assert.equal(reads, before);
    await advance(1); assert.ok(reads > before);
    const after = reads;
    await advance(1); assert.equal(reads, after);
    state.viewKey = 'av'; await coordinator.check('view-entry'); assert.equal(subscriptions, 1);
    notify({ new: { key: 'ph_soc_master' } });
    coordinator.reset(); const resetReads = reads;
    await advance(500); assert.equal(reads, resetReads); assert.equal(closed, 1);
    const runtime = fs.readFileSync(new URL(prefix + 'assets/app-runtime.js', base), 'utf8');
    assert.equal((runtime.match(/supabaseClient\.channel\(/g) || []).length, 1);
    assert.match(runtime, /REALTIME_CHANGE_BATCH_MS = 500/);
  }
  const operations = fs.readFileSync(new URL('test/assets/test/operations.mjs', base), 'utf8');
  assert.doesNotMatch(operations, /\.channel\??\(/);
  assert.match(operations, /agdata-test:ops-change/);
}
