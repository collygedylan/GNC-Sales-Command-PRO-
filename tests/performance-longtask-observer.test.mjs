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

test('diagnostics are bounded, redact script URLs, and do not change finish metrics', () => {
  const callbacks = new Map();
  let now = 100;
  class FakePerformanceObserver {
    static supportedEntryTypes = ['longtask', 'long-animation-frame'];
    constructor(handler) { this.handler = handler; }
    observe({ type }) { callbacks.set(type, this); }
    takeRecords() { return []; }
  }
  const root = {
    PerformanceObserver: FakePerformanceObserver,
    performance: { now: () => now },
    location: { href: 'https://app.example.test/home?session=secret' }
  };
  const observer = installPerformanceLongTaskObserver(root);
  const start = observer.begin();
  callbacks.get('longtask').handler({ getEntries: () => [
    { startTime: 110, duration: 42 },
    ...Array.from({ length: 130 }, (_, index) => ({ startTime: 120 + index, duration: 1 }))
  ] });
  callbacks.get('long-animation-frame').handler({ getEntries: () => [{
    startTime: 140,
    duration: 80,
    blockingDuration: 30,
    renderStart: 190,
    styleAndLayoutStart: 200,
    scripts: [{
      duration: 55,
      startTime: 151,
      executionStart: 150,
      invokerType: 'classic-script',
      invoker: 'Window.requestAnimationFrame',
      sourceFunctionName: 'renderCards',
      sourceURL: 'https://app.example.test/assets/app.js?token=secret#section',
      sourceCharPosition: 23,
      forcedStyleAndLayoutDuration: 12
    }]
  }] });
  now = 250;

  const metric = observer.finish(start);
  assert.deepEqual(metric, { longTaskMs: 172 });
  assert.deepEqual(Object.keys(metric), ['longTaskMs']);
  const diagnostic = observer.getDiagnostics();
  assert.equal(diagnostic.longAnimationFrameSupported, true);
  assert.deepEqual(diagnostic.windows, [{ startTime: 100, endTime: 250, longTaskMs: 172 }]);
  assert.equal(diagnostic.longTasks.length, 128);
  assert.equal(diagnostic.dropped.longTasks, 3);
  assert.equal(diagnostic.animationFrames.length, 1);
  assert.deepEqual(diagnostic.dropped, { longTasks: 3, animationFrames: 0, windows: 0, scripts: 0 });
  assert.deepEqual(diagnostic.animationFrames[0], {
    startTime: 140,
    duration: 80,
    blockingDuration: 30,
    renderStart: 190,
    styleAndLayoutStart: 200,
    scripts: [{
      startTime: 151,
      duration: 55,
      executionStart: 150,
      invokerType: 'classic-script',
      invoker: 'Window.requestAnimationFrame',
      sourceFunctionName: 'renderCards',
      sourceURL: '/assets/app.js',
      sourceCharPosition: 23,
      forcedStyleAndLayoutDuration: 12
    }]
  });
  assert.equal(JSON.stringify(diagnostic).includes('secret'), false);
});

test('unsupported long-animation-frame timing is explicit and leaves existing metrics intact', () => {
  let now = 10;
  class FakePerformanceObserver {
    static supportedEntryTypes = ['longtask'];
    constructor() {}
    observe() {}
    takeRecords() { return []; }
  }
  const observer = installPerformanceLongTaskObserver({
    PerformanceObserver: FakePerformanceObserver,
    performance: { now: () => now }
  });
  const start = observer.begin();
  now = 20;
  assert.deepEqual(observer.finish(start), { longTaskMs: 0 });
  assert.deepEqual(observer.getDiagnostics(), {
    longAnimationFrameSupported: false,
    windows: [{ startTime: 10, endTime: 20, longTaskMs: 0 }],
    longTasks: [],
    animationFrames: [],
    dropped: { longTasks: 0, animationFrames: 0, windows: 0, scripts: 0 }
  });
});

test('window and animation-frame diagnostic histories are capped with dropped counts', () => {
  const callbacks = new Map();
  let now = 0;
  class FakePerformanceObserver {
    static supportedEntryTypes = ['longtask', 'long-animation-frame'];
    constructor(handler) { this.handler = handler; }
    observe({ type }) { callbacks.set(type, this); }
    takeRecords() { return []; }
  }
  const observer = installPerformanceLongTaskObserver({
    PerformanceObserver: FakePerformanceObserver,
    performance: { now: () => now }
  });
  for (let index = 0; index < 130; index++) {
    const start = observer.begin();
    now++;
    observer.finish(start);
  }
  callbacks.get('long-animation-frame').handler({ getEntries: () => Array.from({ length: 130 }, (_, index) => ({
    startTime: index,
    duration: 60,
    scripts: []
  })) });
  const diagnostic = observer.getDiagnostics();
  assert.equal(diagnostic.windows.length, 128);
  assert.equal(diagnostic.windows[0].startTime, 2);
  assert.equal(diagnostic.dropped.windows, 2);
  assert.equal(diagnostic.animationFrames.length, 128);
  assert.equal(diagnostic.animationFrames[0].startTime, 2);
  assert.equal(diagnostic.dropped.animationFrames, 2);
});

test('script diagnostics reject non-HTTP URLs, redact invoker queries, cap paths, and count dropped scripts', () => {
  class FakePerformanceObserver {
    static supportedEntryTypes = ['long-animation-frame'];
    constructor(handler) { this.handler = handler; }
    observe() { FakePerformanceObserver.instance = this; }
    takeRecords() { return []; }
  }
  const observer = installPerformanceLongTaskObserver({
    PerformanceObserver: FakePerformanceObserver,
    performance: { now: () => 10 }
  });
  FakePerformanceObserver.instance.handler({ getEntries: () => [{
    startTime: 1,
    duration: 20,
    scripts: [
      { sourceURL: 'data:text/javascript,secret', invoker: 'https://example.test/invoke?q=secret' },
      { sourceURL: 'not a URL?secret', invoker: 'Window.setTimeout?token=secret' },
      { sourceURL: `https://example.test/${'x'.repeat(600)}?secret=1`, invoker: 'Window.requestAnimationFrame' },
      ...Array.from({ length: 15 }, () => ({ sourceURL: 'javascript:secret', invoker: 'unknown?secret' }) )
    ]
  }] });
  const diagnostic = observer.getDiagnostics();
  assert.equal(diagnostic.animationFrames[0].scripts.length, 16);
  assert.deepEqual(diagnostic.animationFrames[0].scripts.slice(0, 3).map(script => [script.sourceURL, script.invoker]), [
    ['', '/invoke'],
    ['', ''],
    [`/${'x'.repeat(511)}`, 'Window.requestAnimationFrame']
  ]);
  assert.equal(diagnostic.dropped.scripts, 2);
  assert.equal(JSON.stringify(diagnostic).includes('secret'), false);
});
