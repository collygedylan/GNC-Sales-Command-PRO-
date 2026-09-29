import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/login-network-trace.js', import.meta.url), 'utf8');

function harness({ observer = 'supported', performance = null, fetchImpl = null } = {}) {
  let clock = 10;
  let timerId = 0;
  const timers = new Map();
  const resourceEntries = [];
  const calls = [];
  class FakeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; }
    observe(options) { this.options = options; if (observer === 'throws') throw new Error('unavailable'); }
    disconnect() { this.disconnected = true; }
    emit(entries) { this.callback({ getEntries: () => entries }); }
  }
  const perf = performance || {
    now: () => clock,
    getEntriesByType: (type) => type === 'resource' ? resourceEntries.slice() : []
  };
  const root = {
    performance: perf,
    fetch: fetchImpl || ((input, init) => { calls.push([input, init]); return Promise.resolve({ status: 200, marker: 'response' }); }),
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    PerformanceObserver: observer === 'missing' ? undefined : FakeObserver,
    location: { href: 'https://app.example.test/' },
    URL,
    Date,
    console
  };
  const context = { window: root, module: { exports: {} }, URL, Date, Promise, Set, Map, Number, String, Object, Array, Error, TypeError };
  vm.runInNewContext(source, context, { filename: 'login-network-trace.js' });
  const trace = context.module.exports;
  trace.configure({
    supabaseUrl: 'https://project.supabase.co',
    appApiUrl: 'https://functions.example.test/functions/v1/app-api?key=do-not-store',
    release: 'V2026.09.29.002'
  });
  return {
    trace, root, calls, timers, resourceEntries,
    advance(ms) { clock += ms; },
    observers: () => Array.from(root.__observers || [])
  };
}

test('traces only allowlisted requests and redacts URLs, headers, bodies, identities, and hostile error text', async () => {
  const secretBody = { username: 'dylan_private', password: 'secret-password' };
  const signal = { marker: 'signal-object' };
  const response = { status: 200, bodyMarker: true };
  const nativeCalls = [];
  const h = harness({ fetchImpl: (input, init) => { nativeCalls.push([input, init]); return Promise.resolve(response); } });
  const request = { url: 'https://project.supabase.co/auth/v1/token?grant_type=password&private=secret', method: 'POST' };
  const init = { method: 'POST', headers: { Authorization: 'Bearer private-token' }, body: JSON.stringify(secretBody), signal };
  h.trace.begin('password');
  const returned = await h.trace.measure('native-sign-in', () => h.trace.fetch(request, init));
  assert.equal(returned, response);
  assert.equal(nativeCalls[0][0], request);
  assert.equal(nativeCalls[0][1], init);

  const hostile = Object.assign(new TypeError('https://project.supabase.co/auth/v1/token?access_token=leaked private-token password=secret-password'), {
    code: 'raw-db-error', requestUrl: 'https://secret.example/?key=leak'
  });
  const failing = harness({ fetchImpl: () => Promise.reject(hostile) });
  failing.trace.configure({ supabaseUrl: 'https://project.supabase.co', appApiUrl: 'https://functions.example.test/functions/v1/app-api', release: 'release-1' });
  failing.trace.begin('password');
  await assert.rejects(failing.trace.fetch('https://project.supabase.co/rest/v1/profiles?select=*&access_token=leak', init), error => error === hostile);
  const dump = JSON.stringify(failing.trace.snapshot());
  for (const secret of ['access_token=leak', 'private-token', 'secret-password', 'dylan_private', 'raw-db-error', 'secret.example']) assert.equal(dump.includes(secret), false);
  assert.match(dump, /"endpoint":"profiles"/);
  assert.match(dump, /"errorClass":"TypeError"/);
});

test('phase and fetch timings correlate while preserving synchronous values and rejection identity', async () => {
  const h = harness();
  h.trace.begin('restore');
  h.advance(20);
  const value = h.trace.measure('cached-login', () => 'cached');
  assert.equal(value, 'cached');
  const failure = new Error('private details');
  assert.throws(() => h.trace.measure('profile', () => { throw failure; }), error => error === failure);
  const task = h.trace.measure('remote-login', async () => {
    await h.trace.fetch('https://project.supabase.co/auth/v1/user?token=secret', { method: 'GET' });
    h.advance(42);
    return 'signed-in';
  });
  h.advance(18);
  assert.equal(await task, 'signed-in');
  h.trace.finish('shell-ready');
  const attempt = h.trace.snapshot().attempts[0];
  const phase = attempt.events.find(event => event.type === 'phase' && event.name === 'remote-login');
  const request = attempt.events.find(event => event.type === 'fetch' && event.endpoint === 'auth-user');
  assert.equal(phase.outcome, 'resolved');
  assert.ok(phase.durationMs >= request.durationMs);
  assert.equal(request.activePhases.join(','), 'remote-login');
  assert.equal(request.status, 200);
  assert.equal(attempt.outcome, 'shell-ready');
});

test('resource timing marks unavailable cross-origin requestStart without inventing preflight timing', () => {
  const h = harness();
  h.trace.begin('password');
  h.resourceEntries.push({
    name: 'https://project.supabase.co/rest/v1/rpc/get_request_capabilities?secret=yes',
    startTime: 20, duration: 33, requestStart: 0, responseStart: 0, responseEnd: 0,
    transferSize: 0, encodedBodySize: 0, decodedBodySize: 0
  });
  h.advance(50);
  h.trace.finish('failed');
  const event = h.trace.snapshot().attempts[0].events.find(entry => entry.type === 'resource-timing');
  assert.equal(event.endpoint, 'request-capabilities');
  assert.equal(event.networkStartAvailable, false);
  assert.equal(event.requestStartOffsetMs, null);
  assert.equal(event.responseStartOffsetMs, null);
  assert.equal(JSON.stringify(event).includes('secret'), false);
});

test('unsupported performance observers and instrumentation failures do not change login results', async () => {
  const h = harness({ observer: 'missing', performance: { now: () => { throw new Error('clock unavailable'); }, getEntriesByType: () => { throw new Error('timings unavailable'); } } });
  h.trace.begin('passkey');
  const result = h.trace.measure('session-read', () => Promise.resolve({ session: 'unchanged' }));
  assert.deepEqual(await result, { session: 'unchanged' });
  h.trace.finish('shell-ready');
  assert.equal(h.trace.snapshot().attempts[0].observerAvailable, false);
});

test('no active attempt and unapproved endpoints pass through without trace records', async () => {
  const nativeCalls = [];
  const response = { status: 204 };
  const h = harness({ fetchImpl: (input, init) => { nativeCalls.push([input, init]); return Promise.resolve(response); } });
  const request = { url: 'https://unknown.example/private?token=hidden' };
  const init = { signal: { abort: false } };
  assert.equal(await h.trace.fetch(request, init), response);
  h.trace.begin('password');
  assert.equal(await h.trace.fetch(request, init), response);
  assert.equal(nativeCalls.length, 2);
  assert.equal(h.trace.snapshot().attempts[0].events.length, 0);
});

test('a fetch replacement installed after trace load remains the delegated fetch', async () => {
  const h = harness();
  const replacementResponse = { status: 202, fromReplacement: true };
  let receiver = null;
  const lateFetch = function (input, init) {
    receiver = this;
    assert.equal(input, 'https://project.supabase.co/auth/v1/user');
    assert.equal(init.signal.marker, 'late-signal');
    return Promise.resolve(replacementResponse);
  };
  h.root.fetch = lateFetch;
  h.trace.begin('restore');
  assert.equal(await h.trace.fetch('https://project.supabase.co/auth/v1/user', { signal: { marker: 'late-signal' } }), replacementResponse);
  assert.equal(receiver, h.root);
  assert.equal(h.trace.snapshot().attempts[0].events[0].status, 202);
});

test('a manual snapshot taken during an SDK stall includes pending phase and fetch timing events', async () => {
  let finishFetch;
  let finishSdk;
  let downloadedBlob = null;
  const h = harness({ fetchImpl: () => new Promise(resolve => { finishFetch = resolve; }) });
  h.root.Blob = class FakeBlob { constructor(parts) { this.parts = parts; } };
  h.root.URL.createObjectURL = blob => { downloadedBlob = blob; return 'blob:pending-trace'; };
  h.root.URL.revokeObjectURL = () => {};
  h.root.document = {
    body: { appendChild() {} },
    createElement: () => ({ style: {}, click() {}, remove() {} })
  };
  h.trace.begin('password');
  const sdkHold = new Promise(resolve => { finishSdk = resolve; });
  const operation = h.trace.measure('native-sign-in', async () => {
    await h.trace.fetch('https://project.supabase.co/auth/v1/token', { method: 'POST' });
    await sdkHold;
    return 'complete';
  });
  const pending = JSON.parse(JSON.stringify(h.trace.snapshot())).attempts[0].events;
  assert.equal(pending.find(event => event.type === 'phase').outcome, 'pending');
  assert.equal(pending.find(event => event.type === 'fetch').outcome, 'pending');
  assert.equal(h.trace.download(), true);
  const downloaded = JSON.parse(downloadedBlob.parts[0]).attempts[0].events;
  assert.equal(downloaded.find(event => event.type === 'phase').outcome, 'pending');
  assert.equal(downloaded.find(event => event.type === 'fetch').status, null);
  finishFetch({ status: 200 });
  await Promise.resolve();
  finishSdk();
  assert.equal(await operation, 'complete');
  const settled = h.trace.snapshot().attempts[0].events;
  assert.equal(settled.find(event => event.type === 'phase').outcome, 'resolved');
  assert.equal(settled.find(event => event.type === 'fetch').status, 200);
});

test('trace is bounded to the newest three attempts and 128 events per attempt, and clear removes all history', () => {
  const h = harness();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    h.trace.begin('password');
    for (let event = 0; event < 130; event += 1) h.trace.measure('cached-login', () => event);
    h.trace.finish('failed');
  }
  const snapshot = h.trace.snapshot();
  assert.equal(snapshot.attempts.length, 3);
  assert.equal(snapshot.attempts[0].id, 2);
  assert.equal(snapshot.attempts[2].events.length, 128);
  assert.ok(snapshot.attempts[2].droppedEvents >= 2);
  h.trace.clear();
  assert.equal(h.trace.snapshot().attempts.length, 0);
});

test('expiry and manual download are local and use a fixed filename', () => {
  const h = harness();
  h.trace.begin('password');
  const timer = Array.from(h.timers.values()).find(value => value.delay === 120000);
  assert.ok(timer);
  timer.fn();
  assert.equal(h.trace.snapshot().attempts[0].outcome, 'timed-out');
  assert.equal(h.trace.download(), false, 'download safely fails without document/Blob APIs');
});

test('manual download creates only the fixed local JSON artifact', () => {
  const h = harness();
  let downloaded = null;
  h.root.Blob = class FakeBlob {
    constructor(parts, options) { this.parts = parts; this.type = options.type; }
  };
  h.root.URL.createObjectURL = blob => { assert.equal(blob.type, 'application/json'); return 'blob:local-trace'; };
  h.root.URL.revokeObjectURL = () => {};
  h.root.document = {
    body: { appendChild(anchor) { downloaded = anchor; } },
    createElement: () => ({ style: {}, click() { this.clicked = true; }, remove() { this.removed = true; } })
  };
  h.trace.begin('password');
  h.trace.measure('profile', () => 'ok');
  assert.equal(h.trace.download(), true);
  assert.equal(downloaded.download, 'gnc-login-network-trace.json');
  assert.equal(downloaded.clicked, true);
  assert.equal(downloaded.removed, true);
  assert.match(downloaded.href, /^blob:/);
  assert.ok(Array.from(h.timers.values()).some(value => value.delay === 1000), 'object URL is retained briefly for download consumers');
});

test('release metadata accepts only the repository release version shape', () => {
  const h = harness();
  h.trace.configure({ supabaseUrl: 'https://project.supabase.co', appApiUrl: 'https://functions.example.test/functions/v1/app-api', release: 'secret-not-a-release' });
  h.trace.begin('password');
  assert.equal(h.trace.snapshot().attempts[0].release, '');
  h.trace.finish('failed');
});
