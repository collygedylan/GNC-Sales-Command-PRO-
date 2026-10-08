// @test-group: foundation
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { attachPerformanceApiIdleTracker } from '../scripts/performance-browser-fixture.mjs';
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
