// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { minify } from 'terser';
import { installPerformanceLoginValidationObserver } from '../scripts/performance-login-validation-observer.mjs';
import { isPerformanceViewRuntimeReady } from '../scripts/performance-browser-fixture.mjs';

function makeQueue() {
  const entries = [];
  let nextHandle = 0;
  const setTimeout = function (callback, delay, ...args) {
    const handle = { id: ++nextHandle };
    entries.push({ callback, delay, args, handle, receiver: this });
    return handle;
  };
  return { entries, setTimeout };
}

function makeVmScheduler(timers, source, globals = {}) {
  const sandbox = { ...globals, setTimeout: timers.setTimeout };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { sandbox, scheduler: sandbox.scheduleBackgroundLoginValidation };
}

function actualSchedulerSourceFromIndex() {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = source.indexOf('        function scheduleBackgroundLoginValidation(');
  const end = source.indexOf('        function getLoginReadHeaders(', start + 1);
  assert.ok(start >= 0 && end > start, 'actual background-login validation function remains in the shell');
  return source.slice(start, end);
}

function actualSchedulerFromIndex({ native = true, schedulerSource = actualSchedulerSourceFromIndex() } = {}) {
  const timers = makeQueue();
  let resolveRefresh;
  const refreshPromise = new Promise(resolve => { resolveRefresh = resolve; });
  const reasons = [];
  const sandbox = {
    navigator: { onLine: true },
    nativeAuthRecoveryEpoch: 1,
    currentUser: 'fixture_user',
    normalizeSessionIdentity: value => String(value || '').trim().toLowerCase(),
    nativeReadRequiresRls: () => native,
    getNativeAuthRequestHeaders: async () => ({ Authorization: 'fixture' }),
    refreshNativeRoleAndCapabilities: reason => { reasons.push(reason); return refreshPromise; },
    fetchRemoteLoginUser: async () => ({ ok: true, user: { role: 'ADMIN' } }),
    persistVerifiedLoginRecord() {},
    initializeOpsPilotForCurrentSession: async () => false,
    setTimeout: timers.setTimeout,
    localStorage: { setItem() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(schedulerSource, sandbox);
  return { sandbox, scheduler: sandbox.scheduleBackgroundLoginValidation, timers, refreshPromise, resolveRefresh, reasons };
}

test('actual shell scheduler keeps its early return and tracks the original 2200 ms async validation', async () => {
  const fixture = actualSchedulerFromIndex();
  const observer = installPerformanceLoginValidationObserver(fixture.sandbox, fixture.scheduler);
  const wrapped = observer.wrap(fixture.scheduler);
  const originalTimer = fixture.sandbox.setTimeout;

  assert.equal(wrapped('', 'secret'), undefined);
  assert.deepEqual({ ...observer.getPendingActivity() }, {
    pending: false, calls: 1, scheduled: 0, running: 0, settled: 0,
    earlyReturns: 1, schedulingFailures: 0, contractValid: true, pendingTimers: [],
  });
  assert.equal(fixture.sandbox.setTimeout, originalTimer);

  assert.equal(wrapped('fixture_user', 'secret'), undefined);
  assert.equal(fixture.timers.entries.length, 1);
  assert.equal(fixture.timers.entries[0].delay, 2200);
  assert.equal(observer.getPendingActivity().pending, true);
  assert.equal(fixture.sandbox.setTimeout, originalTimer, 'the scoped interception is restored before the timer fires');

  const callbackPromise = fixture.timers.entries[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.reasons[0], 'background-validation');
  assert.equal(observer.getPendingActivity().running, 1);
  assert.equal(observer.getPendingActivity().pending, true);
  fixture.resolveRefresh();
  await callbackPromise;
  await Promise.resolve();
  assert.equal(observer.getPendingActivity().pending, false);
  assert.equal(observer.getPendingActivity().settled, 1);
});

test('pinned minifier output for the actual scheduler still passes the source contract and settles', async () => {
  const minified = await minify(actualSchedulerSourceFromIndex(), {
    compress: false,
    mangle: false,
    keep_fnames: true,
    format: { comments: false },
  });
  assert.equal(typeof minified.code, 'string');
  const fixture = actualSchedulerFromIndex({ schedulerSource: minified.code });
  const observer = installPerformanceLoginValidationObserver(fixture.sandbox, fixture.scheduler);
  const wrapped = observer.wrap(fixture.scheduler);
  wrapped('fixture_user', 'secret');
  assert.equal(fixture.timers.entries[0].delay, 2200);
  const callbackPromise = fixture.timers.entries[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.reasons[0], 'background-validation');
  assert.equal(observer.getPendingActivity().pending, true);
  fixture.resolveRefresh();
  await callbackPromise;
  await Promise.resolve();
  assert.equal(observer.getPendingActivity().pending, false);
});

test('scoped scheduler preserves receiver, delay, timer args, handle, callback receiver, args and promise identity', async () => {
  const timers = makeQueue();
  let resolveCallback;
  const callbackPromise = new Promise(resolve => { resolveCallback = resolve; });
  const { sandbox: root, scheduler: scheduleBackgroundLoginValidation } = makeVmScheduler(timers, `
    function scheduleBackgroundLoginValidation(username = '', password = '') {
      if (!username || !password) return;
      const timer = setTimeout(function (first, second) {
        refreshNativeRoleAndCapabilities('background-validation');
        callbackThis = this;
        callbackArgs = [first, second];
        return callbackPromise;
      }, 2200, 'first', 'second');
      return { result: this.result, timer };
    }
  `, { callbackPromise, refreshNativeRoleAndCapabilities() {} });
  root.callbackThis = undefined;
  root.callbackArgs = undefined;
  const descriptor = Object.getOwnPropertyDescriptor(root, 'setTimeout');
  const observer = installPerformanceLoginValidationObserver(root, scheduleBackgroundLoginValidation);
  const wrapped = observer.wrap(scheduleBackgroundLoginValidation);
  const receiver = { result: 'original result' };
  const scheduleResult = wrapped.call(receiver, 'user', 'password');
  assert.equal(scheduleResult.result, 'original result');
  assert.equal(root.setTimeout, descriptor.value);
  assert.equal(timers.entries.length, 1);
  assert.equal(timers.entries[0].receiver, undefined, 'the scoped replacement preserves the original strict-call receiver');
  assert.equal(scheduleResult.timer, timers.entries[0].handle);
  assert.equal(timers.entries[0].delay, 2200);
  assert.deepEqual(timers.entries[0].args, ['first', 'second']);

  const timerReceiver = { timer: true };
  const result = timers.entries[0].callback.call(timerReceiver, 'callback-1', 'callback-2');
  assert.equal(result, callbackPromise);
  assert.equal(root.callbackThis, timerReceiver);
  assert.deepEqual(Array.from(root.callbackArgs), ['callback-1', 'callback-2']);
  assert.equal(observer.getPendingActivity().pending, true);
  resolveCallback('settled');
  await result;
  await Promise.resolve();
  assert.equal(observer.getPendingActivity().pending, false);
});

test('schedule exceptions and callback exceptions preserve the originals and leave no pending timer', () => {
  const timers = makeQueue();
  const error = new Error('scheduler failure');
  const { sandbox: root, scheduler: scheduleBackgroundLoginValidation } = makeVmScheduler(timers, `
    function scheduleBackgroundLoginValidation(username = '', password = '') {
      if (!username || !password) return;
      setTimeout(() => { refreshNativeRoleAndCapabilities('background-validation'); throw error; }, 2200);
      throw error;
    }
  `, { error, refreshNativeRoleAndCapabilities() {} });
  const originalTimer = root.setTimeout;
  const observer = installPerformanceLoginValidationObserver(root, scheduleBackgroundLoginValidation);
  const wrapped = observer.wrap(scheduleBackgroundLoginValidation);
  assert.throws(() => wrapped('user', 'password'), value => value === error);
  assert.equal(root.setTimeout, originalTimer);
  assert.equal(observer.getPendingActivity().pending, true, 'a successfully scheduled original timer remains observed');
  assert.throws(() => timers.entries[0].callback(), value => value === error);
  assert.equal(observer.getPendingActivity().pending, false);
  assert.equal(observer.getPendingActivity().settled, 1);
});

test('unexpected delay fails readiness clearly but passes the original timer through unchanged', () => {
  const timers = makeQueue();
  const { sandbox: root, scheduler: scheduleBackgroundLoginValidation } = makeVmScheduler(timers, `
    function scheduleBackgroundLoginValidation(username = '', password = '') {
      if (!username || !password) return;
      setTimeout(() => refreshNativeRoleAndCapabilities('background-validation'), username === 'early' ? 2100 : 2200);
    }
  `, { refreshNativeRoleAndCapabilities() {} });
  const observer = installPerformanceLoginValidationObserver(root, scheduleBackgroundLoginValidation);
  const wrapped = observer.wrap(scheduleBackgroundLoginValidation);
  wrapped('early', 'secret');
  assert.equal(timers.entries[0].delay, 2100);
  assert.equal(observer.getPendingActivity().contractValid, false);
  assert.throws(() => isPerformanceViewRuntimeReady({ viewId: 'request', loginValidationActivity: observer.getPendingActivity() }, 'request', true),
    /PERFORMANCE_LOGIN_VALIDATION_CONTRACT_INVALID/);
});

test('unsupported scheduler source is rejected before the application timer can be changed', () => {
  const timers = makeQueue();
  const { sandbox: root, scheduler: scheduleBackgroundLoginValidation } = makeVmScheduler(timers, `
    function scheduleBackgroundLoginValidation(username = '', password = '') {
      if (!username || !password) return;
      setTimeout(() => refreshNativeRoleAndCapabilities('background-validation'), 2100);
    }
  `, { refreshNativeRoleAndCapabilities() {} });
  assert.throws(() => installPerformanceLoginValidationObserver(root, scheduleBackgroundLoginValidation), /PERFORMANCE_LOGIN_VALIDATION_SOURCE_INVALID/);
  assert.equal(root.setTimeout, timers.setTimeout);
  assert.equal(timers.entries.length, 0);
});

test('live route readiness waits for this observer but V2 readiness remains independent', () => {
  const ready = { viewId: 'request', coordinatorActivity: { pending: false }, shellActivity: { pending: false },
    datasetLoadState: {}, datasetQueueTimers: {}, uiRenderTimers: {}, uiRenderFrames: {} };
  assert.equal(isPerformanceViewRuntimeReady(ready, 'request'), true);
  assert.throws(() => isPerformanceViewRuntimeReady(ready, 'request', true), /PERFORMANCE_LOGIN_VALIDATION_OBSERVER_MISSING/);
  assert.equal(isPerformanceViewRuntimeReady({ ...ready, loginValidationActivity: { contractValid: true, calls: 1, pending: true } }, 'request', true), false);
  assert.equal(isPerformanceViewRuntimeReady({ ...ready, loginValidationActivity: { contractValid: true, calls: 1, pending: false } }, 'request', true), true);
});
