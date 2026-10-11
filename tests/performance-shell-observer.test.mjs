// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { installPerformanceShellObserver } from '../scripts/performance-shell-observer.mjs';

test('shell observer follows the real two-frame scheduler through its deferred callback', () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = source.indexOf('        function runAfterShellInteractive(');
  const end = source.indexOf('\n        function cancelRunAfterTouchInteractionTask', start);
  assert.ok(start >= 0 && end > start);
  const frames = [], timers = [];
  const context = vm.createContext({
    requestAnimationFrame: callback => frames.push(callback),
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
  });
  vm.runInContext(source.slice(start, end), context);
  const observer = vm.runInContext(`(${installPerformanceShellObserver.toString()})(globalThis)`, context);
  let calls = 0;
  context.runAfterShellInteractive(() => { calls++; }, 80);
  assert.equal(observer.getPendingActivity().pending, true);
  assert.equal(timers.length, 0);
  frames.shift()();
  assert.equal(observer.getPendingActivity().pending, true);
  frames.shift()();
  assert.equal(timers[0].delay, 80, 'the original scheduler retains its exact delay');
  assert.equal(calls, 0);
  assert.equal(observer.getPendingActivity().pending, true, 'API silence cannot complete a route before its deferred callback');
  timers.shift().callback();
  assert.equal(calls, 1);
  assert.equal(observer.getPendingActivity().pending, false);

  context.runAfterShellInteractive(() => { throw new Error('app handles callback failure'); }, 12);
  frames.shift()(); frames.shift()();
  assert.doesNotThrow(() => timers.shift().callback(), 'the original scheduler keeps its error behavior');
  assert.equal(observer.getPendingActivity().pending, false);
});

test('shell observation preserves arguments, receiver, return identity and nested scheduling', () => {
  const tasks = [];
  const result = Promise.resolve('original');
  const root = { runAfterShellInteractive(task, ...args) {
    assert.equal(this, root);
    tasks.push({ task, args });
    return result;
  } };
  const observer = installPerformanceShellObserver(root);
  const callbackResult = Promise.resolve('callback');
  const receiver = {};
  assert.equal(root.runAfterShellInteractive(function (value) {
    assert.equal(this, receiver);
    assert.equal(value, 'payload');
    root.runAfterShellInteractive(() => {}, 12);
    return callbackResult;
  }, 80, 'extra'), result);
  assert.deepEqual(tasks[0].args, [80, 'extra']);
  assert.equal(tasks.shift().task.call(receiver, 'payload'), callbackResult);
  assert.equal(observer.getPendingActivity().callbacks, 1);
  tasks.shift().task();
  assert.equal(observer.getPendingActivity().callbacks, 0);
  assert.equal(installPerformanceShellObserver(root), observer, 'installation is idempotent');
  assert.equal(root.runAfterShellInteractive(null, 7), result);
  assert.equal(tasks.shift().task, null, 'invalid callbacks retain original behavior');
  assert.equal(observer.getPendingActivity().pending, false);
});

test('shell observer fails clearly without the runtime and preserves scheduler errors', () => {
  assert.throws(() => installPerformanceShellObserver({}), /PERFORMANCE_SHELL_SCHEDULER_MISSING/);
  const error = new Error('scheduler failed');
  const root = { runAfterShellInteractive() { throw error; } };
  const observer = installPerformanceShellObserver(root);
  assert.throws(() => root.runAfterShellInteractive(() => {}), value => value === error);
  assert.equal(observer.getPendingActivity().pending, false);
});
