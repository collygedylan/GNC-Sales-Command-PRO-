// @test-group: foundation
import assert from 'node:assert/strict';
import test from 'node:test';
import { installPerformanceLongTaskObserver } from '../scripts/performance-longtask-observer.mjs';

test('long-task entries are attributed by their start timestamp and pending records are drained at sample end', () => {
  let now = 100;
  let callback;
  let pending = [];
  class FakePerformanceObserver {
    static supportedEntryTypes = ['longtask'];
    constructor(handler) { callback = handler; }
    observe() {}
    takeRecords() { const result = pending; pending = []; return result; }
  }
  const root = { PerformanceObserver: FakePerformanceObserver, performance: { now: () => now } };
  const observer = installPerformanceLongTaskObserver(root);
  const firstStart = observer.begin();
  pending.push({ startTime: 50, duration: 80 });
  pending.push({ startTime: 120, duration: 35 });
  now = 200;
  assert.deepEqual({ ...observer.finish(firstStart) }, { longTaskMs: 35 }, 'pre-sample entries are drained but not assigned to this sample');

  const secondStart = observer.begin();
  callback({ getEntries: () => [{ startTime: 210, duration: 25 }] });
  now = 250;
  assert.deepEqual({ ...observer.finish(secondStart) }, { longTaskMs: 25 });
});

test('long-task entries that start after a sample remain for the next sample', () => {
  let now = 100;
  let callback;
  class FakePerformanceObserver {
    static supportedEntryTypes = ['longtask'];
    constructor(handler) { callback = handler; }
    observe() {}
    takeRecords() { return []; }
  }
  const observer = installPerformanceLongTaskObserver({ PerformanceObserver: FakePerformanceObserver, performance: { now: () => now } });
  const start = observer.begin();
  callback({ getEntries: () => [{ startTime: 250, duration: 12 }] });
  now = 200;
  assert.deepEqual({ ...observer.finish(start) }, { longTaskMs: 0 });
  const next = observer.begin();
  now = 300;
  assert.deepEqual({ ...observer.finish(next) }, { longTaskMs: 12 });
});
