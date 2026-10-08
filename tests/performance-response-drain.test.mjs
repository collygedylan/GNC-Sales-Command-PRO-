// @test-group: foundation
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { attachPerformanceApiIdleTracker, buildPerformanceViewRuntimeReadyExpression, isPerformanceHomeRuntimeReady, isPerformanceViewRuntimeReady,
  waitForPerformanceHomeReadiness, waitForPerformanceViewReadiness } from '../scripts/performance-browser-fixture.mjs';
import { drainPerformanceApiRequests, drainPerformanceResponseBodies, readCompletePerformanceResponseBody, settlePerformanceApiBoundary } from '../scripts/performance-response-drain.mjs';

test('response body drain clears completed batches and captures responses added while waiting', async () => {
  const totals = { pending: [], errors: [] };
  let release;
  totals.pending.push(new Promise(resolve => { release = resolve; }));
  const drained = drainPerformanceResponseBodies(totals);
  totals.pending.push(Promise.resolve());
  release();
  await drained;
  assert.deepEqual(totals.pending, []);
});

test('response body drain bounds batch growth and hung response bodies', async () => {
  const growing = { pending: [], errors: [] };
  growing.pending.push(Promise.resolve().then(() => growing.pending.push(Promise.resolve())));
  await assert.rejects(drainPerformanceResponseBodies(growing, { maxBatches: 1 }), /PERFORMANCE_RESPONSE_DRAIN_LIMIT/);

  const hung = { pending: [new Promise(() => {})], errors: [] };
  await assert.rejects(drainPerformanceResponseBodies(hung, { timeoutMs: 5 }), /PERFORMANCE_RESPONSE_DRAIN_TIMEOUT/);
});

test('API request drain settles pending reads added during the drain and fails closed on a hung request', async () => {
  const totals = { apiRequests: [] };
  let release;
  totals.apiRequests.push({ outcome: new Promise(resolve => { release = resolve; }), response: {},
    capturePromise: Promise.resolve(), canceled: true, error: null });
  const draining = drainPerformanceApiRequests(totals, { startIndex: 0, endIndex: 1 });
  totals.apiRequests.push({ outcome: Promise.resolve({ type: 'finished' }), response: {},
    capturePromise: Promise.resolve(), canceled: false, error: null });
  release({ type: 'failed', errorText: 'net::ERR_ABORTED' });
  await draining;
  await drainPerformanceApiRequests(totals, { startIndex: 1, endIndex: 2 });
  await assert.rejects(drainPerformanceApiRequests({ apiRequests: [{ outcome: new Promise(() => {}) }] }, { timeoutMs: 5 }), /PERFORMANCE_API_DRAIN_TIMEOUT/);
  await assert.rejects(drainPerformanceApiRequests({ apiRequests: [{ outcome: Promise.resolve({ type: 'finished' }),
    response: null, capturePromise: null, canceled: false, error: null }] }), /PERFORMANCE_API_RESPONSE_MISSING/);
  await assert.rejects(drainPerformanceApiRequests({ apiRequests: [{ outcome: Promise.resolve({ type: 'failed', errorText: 'reset' }),
    response: null, capturePromise: null, canceled: false, error: '/rpc: reset' }] }), /PERFORMANCE_API_REQUEST_FAILED/);
});

test('API boundary waits for fixture API idle before freezing the request index and propagates wait failures', async () => {
  const totals = { apiRequests: [], pending: [], errors: [] };
  const events = [];
  const control = { async waitForApiIdle() {
    events.push('idle');
    if (!totals.apiRequests.length) totals.apiRequests.push({ index: 0,
      outcome: Promise.resolve({ type: 'finished' }), response: {}, capturePromise: Promise.resolve(), canceled: false, error: null });
  } };
  assert.equal(await settlePerformanceApiBoundary(totals, control), 1);
  assert.deepEqual(events, ['idle']);
  await assert.rejects(settlePerformanceApiBoundary({ apiRequests: [], pending: [], errors: [] }, {
    async waitForApiIdle() { throw new Error('fixture failure'); }
  }), /fixture failure/);
});

test('API idle tracker keeps a delayed non-revision request in the current boundary', async () => {
  const page = new EventEmitter();
  const tracker = attachPerformanceApiIdleTracker(page, { quietMs: 40 });
  const makeRequest = path => ({ method: () => 'GET', url: () => `http://fixture.invalid/rest/v1/${path}` });
  const first = makeRequest('rpc/startup');
  const started = Date.now();
  page.emit('request', first);
  const idle = tracker.waitForApiIdle({ timeoutMs: 500 });
  setTimeout(() => {
    page.emit('requestfinished', first);
    setTimeout(() => {
      const late = makeRequest('ph_master_inventory');
      page.emit('request', late);
      setTimeout(() => page.emit('requestfinished', late), 10);
    }, 15);
  }, 5);

  const result = await idle;
  assert.equal(result.activityCount, 4);
  assert.ok(Date.now() - started >= 60, 'the quiet period restarts when the delayed request begins');
});

test('API idle tracker times out instead of accepting a truncated quiet interval', async () => {
  const page = new EventEmitter();
  const tracker = attachPerformanceApiIdleTracker(page, { quietMs: 75 });
  const request = { method: () => 'GET', url: () => 'http://fixture.invalid/rest/v1/ph_master_inventory' };
  page.emit('request', request);
  setTimeout(() => page.emit('requestfinished', request), 65);
  await assert.rejects(tracker.waitForApiIdle({ timeoutMs: 100 }), /PERFORMANCE_API_IDLE_TIMEOUT/);
});

test('API idle tracker rejects an event-loop stall beyond the timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const tracker = attachPerformanceApiIdleTracker(new EventEmitter(), { quietMs: 75 });
  const rejected = assert.rejects(tracker.waitForApiIdle({ timeoutMs: 100 }), /PERFORMANCE_API_IDLE_TIMEOUT/);
  t.mock.timers.tick(150);
  await rejected;
});

test('Home readiness waits for deferred loader work before accepting an idle API interval', async () => {
  const page = new EventEmitter();
  const tracker = attachPerformanceApiIdleTracker(page, { quietMs: 15 });
  const state = { scheduled: true, loading: false, completed: false };
  const request = { method: () => 'GET', url: () => 'http://fixture.invalid/functions/v1/app-api' };
  const waitUntilReady = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!state.scheduled && !state.loading) return;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw new Error('fixture Home loader did not settle');
  };
  setTimeout(() => {
    state.scheduled = false;
    state.loading = true;
    page.emit('request', request);
    setTimeout(() => {
      page.emit('requestfinished', request);
      state.loading = false;
      state.completed = true;
    }, 20);
  }, 25);

  const result = await waitForPerformanceHomeReadiness({
    waitForRuntimeReady: waitUntilReady,
    isRuntimeReady: () => !state.scheduled && !state.loading && state.completed,
    waitForApiIdle: tracker.waitForApiIdle.bind(tracker),
    quietMs: tracker.quietMs,
    timeoutMs: 500,
  });
  assert.equal(result.method, 'home-loader-queues-and-api-idle');
  assert.equal(result.quietMs, 15);
  assert.equal(state.completed, true);
});

test('Home readiness rejects a final state check completed after its deadline', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  await assert.rejects(waitForPerformanceHomeReadiness({
    waitForRuntimeReady: async () => {},
    waitForApiIdle: async () => {},
    isRuntimeReady: async () => { t.mock.timers.setTime(1101); return true; },
    timeoutMs: 100,
  }), /PERFORMANCE_HOME_READINESS_TIMEOUT/);
});

test('Home readiness blocks on baseline per-reason and candidate coalesced refresh keys', () => {
  const ready = { viewId: 'home', coordinatorActivity: { pending: false }, datasetLoadState: {}, datasetQueueTimers: {}, uiRenderTimers: {}, uiRenderFrames: {} };
  assert.equal(isPerformanceHomeRuntimeReady(ready), true);
  assert.equal(isPerformanceHomeRuntimeReady({ ...ready, uiRenderTimers: { 'visible-dirty-refresh:dataset-refresh': 1 } }), false);
  assert.equal(isPerformanceHomeRuntimeReady({ ...ready, uiRenderFrames: { 'visible-dirty-refresh:current': 1 } }), false);
  assert.equal(isPerformanceHomeRuntimeReady({ ...ready, uiRenderTimers: { 'production-live-refresh:render': 1 } }), false);
  assert.equal(isPerformanceHomeRuntimeReady({ ...ready, datasetLoadState: { requests: { initialPromise: {} } } }), false);
  assert.equal(isPerformanceHomeRuntimeReady({ ...ready, datasetQueueTimers: { 'requests:initial': 1 } }), false);
  assert.equal(isPerformanceHomeRuntimeReady({ ...ready, productionLiveSyncRenderTimer: true }), false);
  assert.equal(isPerformanceHomeRuntimeReady({ ...ready, activeChunkRenderCount: 1 }), false);
  assert.equal(isPerformanceHomeRuntimeReady({ ...ready, chunkRenderTimersByKey: { 'drive:name:list': [1] } }), false);
  assert.equal(isPerformanceHomeRuntimeReady({ ...ready, runAfterTouchInteractionTasks: { 'current-view-realtime-subscriptions': { timerId: 1 } } }), false);
  assert.equal(isPerformanceHomeRuntimeReady({ ...ready, nativeRoleRefreshPromise: Promise.resolve() }), false);
  assert.equal(isPerformanceHomeRuntimeReady({ ...ready, viewId: 'request' }), false);
});

test('source touch-deferred callback remains a readiness blocker through role refresh and API idle', async () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const extract = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start + 1);
    assert.ok(start >= 0 && end > start, `source function exists: ${startMarker}`);
    return source.slice(start, end);
  };
  const schedulerSource = [
    extract('        function runAfterShellInteractive(', '        function cancelRunAfterTouchInteractionTask('),
    extract('        function cancelRunAfterTouchInteractionTask(', '        function trimRunAfterTouchInteractionTasks('),
    extract('        function trimRunAfterTouchInteractionTasks(', '        function runAfterTouchInteraction('),
    extract('        function runAfterTouchInteraction(', '        function getLoginWarmupPlan('),
  ].join('\n');
  let handle = 0;
  const timers = new Map(), frames = new Map();
  const runtime = vm.createContext({
    ACTIVE_TOUCH_GRACE_MS: 90, window: { addEventListener() {}, removeEventListener() {} },
    runAfterTouchInteractionTasks: {},
    setTimeout: callback => { timers.set(++handle, callback); return handle; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { frames.set(++handle, callback); return handle; },
    cancelAnimationFrame: id => frames.delete(id),
    isTouchConstrainedDevice: () => true, shouldHoldFollowupChunkFramesForInteraction: () => false,
    getFollowupChunkInteractionDelayMs: () => 20, getInternalPlainObjectSize: value => Object.keys(value).length,
    scheduleAppSessionHousekeeping() {},
  });
  vm.runInContext(schedulerSource, runtime);
  const state = { viewId: 'request', coordinatorActivity: { pending: false }, datasetLoadState: {}, datasetQueueTimers: {},
    uiRenderTimers: {}, uiRenderFrames: {}, runAfterTouchInteractionTasks: runtime.runAfterTouchInteractionTasks,
    nativeRoleRefreshPromise: null };
  const page = new EventEmitter();
  const apiIdle = attachPerformanceApiIdleTracker(page, { quietMs: 10 });
  const request = { method: () => 'GET', url: () => 'http://fixture.invalid/rest/v1/profiles' };
  let resolveRefresh, finishRequest;
  runtime.runAfterTouchInteraction(() => {
    state.nativeRoleRefreshPromise = new Promise(resolve => { resolveRefresh = resolve; });
    state.datasetQueueTimers['request:realtime-refresh'] = true;
    page.emit('request', request);
    finishRequest = () => {
      delete state.datasetQueueTimers['request:realtime-refresh'];
      page.emit('requestfinished', request);
    };
  }, 2800, 'current-view-realtime-subscriptions');
  assert.equal(isPerformanceViewRuntimeReady(state, 'request'), false, 'the deferred touch task blocks readiness');

  const timeoutId = [...timers.keys()][0];
  timers.get(timeoutId)();
  timers.delete(timeoutId);
  assert.equal(Object.keys(state.runAfterTouchInteractionTasks).length, 0, 'the scheduler removes the task when it invokes it');
  const firstFrame = [...frames.values()][0];
  frames.clear(); firstFrame();
  const secondFrame = [...frames.values()][0];
  frames.clear(); secondFrame();
  const callbackId = [...timers.keys()][0];
  timers.get(callbackId)();
  assert.equal(isPerformanceViewRuntimeReady(state, 'request'), false, 'the ensuing role refresh and read block readiness');

  const idlePromise = apiIdle.waitForApiIdle({ timeoutMs: 500 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(isPerformanceViewRuntimeReady(state, 'request'), false, 'the active profile request remains unsettled');
  finishRequest();
  await idlePromise;
  resolveRefresh();
  await state.nativeRoleRefreshPromise;
  state.nativeRoleRefreshPromise = null;
  assert.equal(isPerformanceViewRuntimeReady(state, 'request'), true, 'readiness returns after the callback work settles');
});

test('live route readiness waits for queued dataset, render, production refresh, and chunk work', () => {
  const ready = { viewId: 'request', coordinatorActivity: { pending: false }, datasetLoadState: {}, datasetQueueTimers: {}, uiRenderTimers: {}, uiRenderFrames: {} };
  assert.equal(isPerformanceViewRuntimeReady(ready, 'request'), true);
  assert.equal(isPerformanceViewRuntimeReady(ready, 'drive'), false);
  for (const pending of [
    { coordinatorActivity: undefined },
    { coordinatorActivity: { pending: true } },
    { datasetQueueTimers: { 'requests:initial': 1 } },
    { datasetLoadState: { requests: { initialPromise: {} } } },
    { uiRenderTimers: { 'commit:drive:name:list': 1 } },
    { uiRenderFrames: { 'production-live-refresh:render': 1 } },
    { productionLiveSyncRenderTimer: true },
    { productionLiveSyncRenderPending: true },
    { productionLiveSyncViewLoadPending: true },
    { activeChunkRenderCount: 1 },
    { chunkRenderActivityByKey: { 'drive:name:list': 1 } },
    { chunkRenderTimersByKey: { 'drive:name:list': [1] } },
    { runAfterTouchInteractionTasks: { 'current-view-realtime-subscriptions': { timerId: 1 } } },
    { nativeRoleRefreshPromise: Promise.resolve() },
  ]) assert.equal(isPerformanceViewRuntimeReady({ ...ready, ...pending }, 'request'), false);
});

test('generated browser readiness expression passes the expected view and evaluates actual runtime state', () => {
  const expression = buildPerformanceViewRuntimeReadyExpression('request');
  const runtime = {
    getCurrentVisibleViewId: () => 'request',
    datasetLoadState: {}, datasetQueueTimers: {}, backgroundRefreshInFlight: false,
    productionLiveSyncRendering: false, productionLiveSyncRenderPending: false,
    productionLiveSyncRenderTimer: false, productionLiveSyncViewLoad: { pending: false },
    uiRenderTimers: {}, uiRenderFrames: {}, uiRenderTokens: {}, activeChunkRenderCount: 0,
    chunkRenderActivityByKey: {}, chunkRenderTimersByKey: {},
    runAfterTouchInteractionTasks: {}, nativeRoleRefreshPromise: null,
    __phase6CoordinatorObserver: { getPendingActivity: () => ({ pending: false }) },
  };
  assert.equal(vm.runInNewContext(expression, runtime), true);
  assert.equal(vm.runInNewContext(expression, { ...runtime, getCurrentVisibleViewId: () => 'drive' }), false);
  assert.equal(vm.runInNewContext(expression, { ...runtime, datasetQueueTimers: { 'requests:initial': 1 } }), false);
  assert.throws(() => buildPerformanceViewRuntimeReadyExpression(''), /PERFORMANCE_VIEW_ID_REQUIRED/);
  assert.equal(vm.runInNewContext(buildPerformanceViewRuntimeReadyExpression('home'), { ...runtime, getCurrentVisibleViewId: () => 'home' }), true);
});

test('route readiness waits for live render tokens but accepts a completed replacement frame with stale timer bookkeeping', () => {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = source.indexOf('        function scheduleUiRender(');
  const end = source.indexOf('\n        function ', start + 1);
  assert.ok(start >= 0 && end > start);
  const timeouts = new Map(), frames = new Map();
  let handle = 0, rendered = 0;
  const runtime = vm.createContext({
    uiRenderTimers: {}, uiRenderFrames: {}, uiRenderTokens: {},
    setTimeout: callback => { timeouts.set(++handle, callback); return handle; },
    clearTimeout: id => timeouts.delete(id),
    requestAnimationFrame: callback => { frames.set(++handle, callback); return handle; },
    cancelAnimationFrame: id => frames.delete(id),
    beginInternalPerfMeasure: () => 0, getAdaptivePerfElapsedMs: () => 0,
    recordAdaptiveRenderDuration: () => {}, getInternalPlainObjectSize: value => Object.keys(value).length,
    LONG_SESSION_CACHE_LIMIT: 100, scheduleAppSessionHousekeeping: () => {},
  });
  vm.runInContext(source.slice(start, end), runtime);
  const state = { viewId: 'drive', coordinatorActivity: { pending: false }, uiRenderTimers: runtime.uiRenderTimers,
    uiRenderFrames: runtime.uiRenderFrames, uiRenderTokens: runtime.uiRenderTokens };
  runtime.scheduleUiRender('production-live-refresh:render', () => { rendered++; }, 150);
  assert.equal(isPerformanceViewRuntimeReady(state, 'drive'), false);
  runtime.scheduleUiRender('production-live-refresh:render', () => { rendered++; }, 0);
  assert.equal(timeouts.size, 0, 'the prior delayed callback was canceled');
  assert.equal(isPerformanceViewRuntimeReady(state, 'drive'), false, 'the replacement frame is still active');
  for (const callback of frames.values()) callback();
  assert.equal(rendered, 1);
  assert.equal(Object.keys(state.uiRenderTimers).length, 1, 'the existing scheduler retains this cleared timer entry');
  assert.deepEqual(Object.keys(state.uiRenderTokens), []);
  assert.equal(isPerformanceViewRuntimeReady(state, 'drive'), true);
  assert.equal(isPerformanceViewRuntimeReady({ ...state, uiRenderTokens: undefined }, 'drive'), false,
    'unknown token state cannot establish that a queued key is stale');
});

test('live route settlement includes a delayed queued read and waits again when state changes after API idle', async () => {
  const page = new EventEmitter();
  const tracker = attachPerformanceApiIdleTracker(page, { quietMs: 15 });
  const state = { viewId: 'request', coordinatorActivity: { pending: false }, datasetLoadState: {}, datasetQueueTimers: { 'requests:initial': true },
    backgroundRefreshInFlight: false, uiRenderTimers: {}, uiRenderFrames: {} };
  const request = { method: () => 'POST', url: () => 'http://fixture.invalid/functions/v1/app-api' };
  const started = Date.now();
  setTimeout(() => {
    delete state.datasetQueueTimers['requests:initial'];
    state.uiRenderTimers['commit:request'] = true;
    page.emit('request', request);
    setTimeout(() => {
      state.uiRenderTimers = {};
      page.emit('requestfinished', request);
      state.datasetLoadState = { requests: { fullPromise: true } };
      setTimeout(() => { state.datasetLoadState = {}; }, 20);
    }, 20);
  }, 260);
  const isReady = () => isPerformanceViewRuntimeReady(state, 'request');
  const waitForRuntimeReady = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (isReady()) return;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw new Error('PERFORMANCE_VIEW_READINESS_TIMEOUT');
  };
  const result = await waitForPerformanceViewReadiness({ waitForRuntimeReady, isRuntimeReady: isReady,
    waitForApiIdle: tracker.waitForApiIdle.bind(tracker), viewId: 'request', timeoutMs: 800, quietMs: tracker.quietMs });
  assert.equal(result.method, 'live-view-work-and-api-idle');
  assert.equal(result.viewId, 'request');
  assert.equal(tracker.quietMs, 15);
  assert.ok(Date.now() - started >= 290, 'settlement waits for the delayed request and its follow-up state change');
});

test('live route settlement rechecks state after API idle before closing the boundary', async () => {
  const state = { viewId: 'drive', coordinatorActivity: { pending: false }, datasetLoadState: {}, datasetQueueTimers: {}, uiRenderTimers: {}, uiRenderFrames: {} };
  let idleCalls = 0;
  const isReady = () => isPerformanceViewRuntimeReady(state, 'drive');
  const waitForRuntimeReady = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (isReady()) return;
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    throw new Error('PERFORMANCE_VIEW_READINESS_TIMEOUT');
  };
  const result = await waitForPerformanceViewReadiness({ waitForRuntimeReady, isRuntimeReady: isReady,
    waitForApiIdle: async () => {
      idleCalls++;
      if (idleCalls === 1) {
        state.uiRenderTimers['production-live-refresh:render'] = true;
        setTimeout(() => { state.uiRenderTimers = {}; }, 10);
      }
    }, viewId: 'drive', timeoutMs: 200, quietMs: 5 });
  assert.equal(result.method, 'live-view-work-and-api-idle');
  assert.equal(idleCalls, 2, 'work queued by the first idle interval must settle and be followed by a second idle interval');
});

test('live route settlement fails closed when queued work never settles', async () => {
  await assert.rejects(waitForPerformanceViewReadiness({
    waitForRuntimeReady: async timeoutMs => {
      await new Promise(resolve => setTimeout(resolve, timeoutMs));
      throw new Error('PERFORMANCE_VIEW_READINESS_TIMEOUT');
    },
    isRuntimeReady: () => false,
    waitForApiIdle: async () => {},
    viewId: 'drive', timeoutMs: 25, quietMs: 5,
  }), /PERFORMANCE_VIEW_READINESS_TIMEOUT/);
});

test('response byte capture waits for the complete network response before reading its body', async () => {
  const events = [];
  const body = Buffer.from('captured payload');
  const captured = await readCompletePerformanceResponseBody({
    async finished() { events.push('finished'); return null; },
    async body() { events.push('body'); return body; },
  });
  assert.deepEqual(events, ['finished', 'body']);
  assert.deepEqual(captured, body);
});

test('response byte capture reports incomplete or unreadable responses instead of hiding them', async () => {
  let bodyRead = false;
  await assert.rejects(readCompletePerformanceResponseBody({
    async finished() { return new Error('net::ERR_ABORTED'); },
    async body() { bodyRead = true; return Buffer.from('partial'); },
  }), /PERFORMANCE_RESPONSE_NOT_FINISHED:net::ERR_ABORTED/);
  assert.equal(bodyRead, false);

  await assert.rejects(readCompletePerformanceResponseBody({
    async finished() { return null; },
    async body() { throw new Error('protocol body unavailable'); },
  }), /protocol body unavailable/);
  await assert.rejects(readCompletePerformanceResponseBody({ body() {} }), /PERFORMANCE_RESPONSE_CAPTURE_INVALID/);
});

test('response byte capture distinguishes a finished request from an explicit cancellation', async () => {
  const body = Buffer.from('complete');
  const completed = await readCompletePerformanceResponseBody({
    async finished() { throw new Error('request outcome should be authoritative'); },
    async body() { return body; },
  }, Promise.resolve({ type: 'finished' }));
  assert.deepEqual(completed, body);

  await assert.rejects(readCompletePerformanceResponseBody({
    async finished() { return null; },
    async body() { throw new Error('body should not be read for canceled request'); },
  }, Promise.resolve({ type: 'failed', errorText: 'net::ERR_ABORTED' })), /PERFORMANCE_RESPONSE_REQUEST_FAILED:net::ERR_ABORTED/);
  await assert.rejects(readCompletePerformanceResponseBody({
    async finished() { return null; },
    async body() { return body; },
  }, Promise.resolve({ type: 'failed', errorText: 'net::ERR_CONNECTION_RESET' })), /PERFORMANCE_RESPONSE_REQUEST_FAILED:net::ERR_CONNECTION_RESET/);
});
