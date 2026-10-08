// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { installPerformanceCoordinatorObserver } from '../scripts/performance-coordinator-observer.mjs';

const coordinatorSource = readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('observer preserves promise identity, synchronous results, timer handles and future coordinator fields', async () => {
  const root = { setTimeout, clearTimeout };
  const observer = installPerformanceCoordinatorObserver(root);
  let wrappedOptions, callback, cancelled;
  const promise = Promise.resolve('original');
  const handle = () => {};
  root.AgMetricLiveSync = { createCoordinator(options) {
    wrappedOptions = options;
    return Object.freeze({ check: () => promise, ensure: () => true, futureField: 'kept' });
  } };
  const coordinator = root.AgMetricLiveSync.createCoordinator({
    readRevisions: () => promise,
    setTimeout(fn, delay, argument) { callback = fn; assert.equal(delay, 37); assert.equal(argument, 'arg'); return handle; },
    clearTimeout(value) { cancelled = value; return 'cleared'; },
  });
  assert.equal(coordinator.check(), promise);
  assert.equal(coordinator.ensure(), true);
  assert.equal(coordinator.futureField, 'kept');
  assert.equal(wrappedOptions.readRevisions(), promise);
  await settle();
  assert.equal(observer.getPendingActivity().pending, false);
  assert.equal(wrappedOptions.setTimeout(function (value) { return `${this.prefix}:${value}`; }, 37, 'arg'), handle);
  assert.equal(observer.getPendingActivity().pending, true);
  assert.equal(callback.call({ prefix: 'original' }, 'value'), 'original:value');
  assert.equal(observer.getPendingActivity().pending, false);
  assert.equal(wrappedOptions.clearTimeout(handle), 'cleared');
  assert.equal(cancelled, handle);
});

function createFixture({ background = false, readHook = null } = {}) {
  let now = 1000;
  let nextId = 0;
  const timers = new Map();
  const context = {
    scope: 'user/site', viewKey: 'queue', visible: true, online: true,
    adapters: [{ id: 'foreground', cacheKey: 'fg-v1', sourceKeys: ['foreground_source'], stage: async () => [], commit() {} }],
    backgroundAdapters: background ? [{ id: 'background', cacheKey: 'bg-v1', sourceKeys: ['background_source'], stage: async () => [], commit() {} }] : []
  };
  let reads = 0;
  const sandbox = {
    module: { exports: {} }, AbortController,
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.createContext(sandbox);
  vm.runInContext(`(${installPerformanceCoordinatorObserver.toString()})(globalThis)`, sandbox);
  const pendingBeforeCoordinator = sandbox.__phase6CoordinatorObserver.getPendingActivity().pending;
  vm.runInContext(coordinatorSource, sandbox);
  const api = sandbox.AgMetricLiveSync;
  const coordinator = api.createCoordinator({
    getContext: () => context,
    now: () => now,
    setTimeout: sandbox.setTimeout,
    clearTimeout: sandbox.clearTimeout,
    readRevisions: async keys => {
      reads++;
      if (readHook) await readHook(keys);
      return { contractVersion: 1, permissionVersion: 'v1', sources: keys.map(key => ({ key, state: 'ready', revision: '1' })) };
    }
  });
  return {
    coordinator, observer: sandbox.__phase6CoordinatorObserver, timers, pendingBeforeCoordinator,
    get reads() { return reads; },
    async tick(ms) {
      now += ms;
      let rounds = 0;
      while (rounds++ < 20) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= now);
        if (!due.length) break;
        for (const [id, timer] of due) { timers.delete(id); timer.callback(); }
        await settle();
      }
      await settle();
    }
  };
}

test('observer excludes only the persistent foreground safeguard and leaves its schedule intact', async () => {
  const fixture = createFixture();
  assert.equal(fixture.pendingBeforeCoordinator, true, 'missing coordinator instrumentation must fail closed');
  await fixture.coordinator.check();
  const firstReadCount = fixture.reads;
  const before = fixture.observer.getPendingActivity();
  assert.equal(before.persistentPollTimers, 1);
  assert.equal(before.pending, false);
  assert.equal(before.pendingTimers.length, 0);

  await fixture.tick(30000);
  assert.equal(fixture.reads, firstReadCount + 1, 'the observed safeguard still performs its foreground check');
  const after = fixture.observer.getPendingActivity();
  assert.equal(after.persistentPollTimers, 1, 'the coordinator rearms the safeguard after the check');
  assert.equal(after.pending, false);
});

test('observer tracks the delayed background pass and its in-flight revision read', async () => {
  let releaseRead;
  let held = false;
  const fixture = createFixture({ background: true, readHook: keys => keys.includes('background_source') && !held
    ? (held = true, new Promise(resolve => { releaseRead = resolve; })) : undefined });
  await fixture.coordinator.check();
  const waiting = fixture.observer.getPendingActivity();
  assert.equal(waiting.pending, true);
  assert.deepEqual(Array.from(waiting.pendingTimers, timer => timer.kind), ['background']);
  assert.equal(waiting.persistentPollTimers, 1);

  const backgroundPass = fixture.tick(250);
  await settle();
  const reading = fixture.observer.getPendingActivity();
  assert.equal(reading.activeRevisionReads, 1);
  assert.equal(reading.pending, true);
  releaseRead();
  await backgroundPass;
  const complete = fixture.observer.getPendingActivity();
  assert.equal(complete.pending, false, JSON.stringify(complete));
  assert.equal(complete.backgroundStatus?.state, 'Up to date');
  assert.equal(complete.persistentPollTimers, 1);
});

test('reconnect signal timer is observable, cancellation clears it, and firing it starts tracked work', async () => {
  const cancelled = createFixture();
  await cancelled.coordinator.check();
  cancelled.coordinator.signal('reconnect', 400);
  assert.equal(cancelled.observer.getPendingActivity().pendingTimers.some(timer => timer.kind === 'signal'), true);
  cancelled.coordinator.suspend();
  assert.equal(cancelled.observer.getPendingActivity().pending, false);

  const fired = createFixture();
  await fired.coordinator.check();
  const before = fired.reads;
  fired.coordinator.signal('reconnect', 400);
  await fired.tick(400);
  assert.ok(fired.reads > before, 'firing the signal still runs the coordinator read');
  assert.equal(fired.observer.getPendingActivity().pending, false);
});
