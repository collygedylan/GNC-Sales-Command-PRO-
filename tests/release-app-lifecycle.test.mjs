import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/app-lifecycle.js', import.meta.url), 'utf8');

function harness() {
  const listeners = new Map();
  const timers = [];
  const idle = [];
  const errors = [];
  let hidden = false;
  let nextId = 1;
  const add = (target, name, callback) => {
    const key = `${target}:${name}`;
    listeners.set(key, [...(listeners.get(key) || []), callback]);
  };
  const queue = (items, callback, options) => {
    const item = { id: nextId++, callback, options, cancelled: false };
    items.push(item);
    return item.id;
  };
  const cancel = (items, id) => {
    const item = items.find(entry => entry.id === id);
    if (item) item.cancelled = true;
  };
  const document = {
    get hidden() { return hidden; },
    addEventListener: (name, callback) => add('document', name, callback),
  };
  const window = {
    document,
    AbortController,
    console: { error: (...args) => errors.push(args) },
    addEventListener: (name, callback) => add('window', name, callback),
    setTimeout: (callback, delay) => queue(timers, callback, delay),
    clearTimeout: id => cancel(timers, id),
    requestIdleCallback: (callback, options) => queue(idle, callback, options),
    cancelIdleCallback: id => cancel(idle, id),
  };
  const context = vm.createContext({ window, document, AbortController, console: window.console });
  vm.runInContext(source, context, { filename: 'assets/app-lifecycle.js' });
  const run = items => {
    assert.ok(items.length, 'expected a queued callback');
    const item = items.shift();
    if (!item.cancelled) item.callback({ didTimeout: false, timeRemaining: () => 50 });
  };
  return {
    window,
    api: window.AgMetricLifecycle,
    errors,
    timers,
    idle,
    setHidden: value => { hidden = value; },
    event(target, name, isTrusted = true) {
      for (const callback of listeners.get(`${target}:${name}`) || []) {
        callback({ type: name, isTrusted });
      }
    },
    runTimer: () => run(timers),
    runIdle: () => run(idle),
    runAgain: () => vm.runInContext(source, context, { filename: 'assets/app-lifecycle.js' }),
  };
}

const eventValues = events => events.map(({ type, reason }) => ({ type, reason }));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('installs one owner with compatibility adapters and validates lifetime names', () => {
  const h = harness();
  const owner = h.api;
  assert.equal(h.window.getShellMaintenanceSignal(), owner.getSignal());
  assert.equal(h.window.suspendShellMaintenanceForNavigation, owner.suspendNavigation);
  assert.equal(Object.isFrozen(owner), true);
  h.runAgain();
  assert.equal(h.window.AgMetricLifecycle, owner, 'a second load must retain the singleton');
  assert.throws(() => owner.getSignal('worker'), /Unknown lifecycle lifetime/);
  assert.throws(() => owner.createScope({ lifetime: 'worker' }), /Unknown lifecycle lifetime/);
});

test('view and session invalidation fence late work while scopes stay isolated', async () => {
  const h = harness();
  const documentSignal = h.api.getSignal('document');
  const sessionSignal = h.api.getSignal('session');
  h.api.enterView('home');
  const firstViewSignal = h.api.getSignal('view');
  const sessionA = h.api.createScope({ lifetime: 'session' });
  const sessionB = h.api.createScope({ lifetime: 'session' });
  const home = h.api.createScope();
  const events = [];
  h.api.subscribe(event => events.push(event));

  sessionA.dispose();
  assert.equal(sessionA.isCurrent(), false);
  assert.equal(sessionB.isCurrent(), true, 'disposing one child cannot abort a sibling');
  assert.equal(sessionSignal.aborted, false, 'disposing a child cannot abort its parent');
  h.api.enterView('home');
  assert.equal(home.isCurrent(), true, 're-entering the same key is a no-op');
  h.api.enterView('request');
  assert.equal(home.signal.aborted, true);
  assert.equal(sessionB.isCurrent(), true);
  assert.equal(firstViewSignal.aborted, true);

  const request = h.api.createScope();
  const guardedCalls = [];
  const guarded = request.guard(value => guardedCalls.push(value));
  const read = deferred();
  const commits = [];
  const completion = read.promise.then(value => {
    if (request.isCurrent()) commits.push(value);
    guarded(value);
  });
  const requestViewSignal = h.api.getSignal('view');
  h.api.resetSession();
  assert.equal(sessionSignal.aborted, true);
  assert.equal(requestViewSignal.aborted, true);
  assert.equal(documentSignal.aborted, false);
  assert.equal(sessionB.signal.aborted, true);
  assert.equal(request.signal.aborted, true);
  assert.notEqual(h.api.getSignal('session'), sessionSignal);
  assert.notEqual(h.api.getSignal('view'), requestViewSignal);
  read.resolve('stale');
  await completion;
  assert.deepEqual(commits, []);
  assert.deepEqual(guardedCalls, []);
  assert.deepEqual(eventValues(events), [
    { type: 'view', reason: 'view-change' },
    { type: 'session', reason: 'session-reset' },
  ]);
});

test('cancelled navigation may resume on trusted activity but committed navigation requires pageshow', () => {
  const h = harness();
  const events = [];
  h.api.subscribe(event => events.push(event));

  const first = h.api.getSignal();
  h.event('window', 'beforeunload');
  assert.equal(first.aborted, true);
  h.event('window', 'focus', false);
  assert.equal(h.api.getSignal().aborted, true);
  h.event('document', 'pointerdown');
  assert.equal(h.api.getSignal().aborted, false);

  const committed = h.api.getSignal();
  h.event('window', 'pagehide');
  assert.equal(committed.aborted, true);
  h.event('window', 'focus');
  h.event('document', 'keydown');
  assert.equal(h.api.getSignal().aborted, true);
  h.event('window', 'pageshow', false);
  assert.equal(h.api.getSignal().aborted, true);
  h.event('window', 'pageshow');
  assert.equal(h.api.getSignal().aborted, false);
  assert.deepEqual(eventValues(events), [
    { type: 'suspend', reason: 'beforeunload' },
    { type: 'resume', reason: 'pointerdown' },
    { type: 'suspend', reason: 'pagehide' },
    { type: 'resume', reason: 'pageshow' },
  ]);
});

test('hidden pageshow unlocks only a later trusted visible restoration and retires foreground scopes', () => {
  const h = harness();
  h.api.enterView('home');
  const foreground = h.api.createScope({ foreground: true });
  const ordinary = h.api.createScope();
  const events = [];
  const unsubscribe = h.api.subscribe(event => events.push(event));

  h.event('window', 'pagehide');
  h.setHidden(true);
  h.event('window', 'pageshow');
  assert.equal(h.api.getSignal().aborted, true);
  h.event('document', 'visibilitychange');
  assert.equal(foreground.signal.aborted, true);
  assert.equal(ordinary.signal.aborted, true, 'pagehide retires every scope');
  h.setHidden(false);
  h.event('document', 'visibilitychange', false);
  assert.equal(h.api.getSignal().aborted, true);
  h.event('document', 'visibilitychange');
  assert.equal(h.api.getSignal().aborted, false);
  const visible = h.api.createScope({ foreground: true });
  assert.equal(visible.isCurrent(), true);

  unsubscribe();
  h.event('window', 'offline');
  assert.deepEqual(eventValues(events), [
    { type: 'suspend', reason: 'pagehide' },
    { type: 'visibility', reason: 'hidden' },
    { type: 'visibility', reason: 'visible' },
    { type: 'resume', reason: 'visibilitychange' },
    { type: 'visibility', reason: 'visible' },
  ]);
});

test('foreground hiding does not invalidate ordinary scopes in a live document', () => {
  const h = harness();
  h.api.enterView('home');
  const foreground = h.api.createScope({ foreground: true });
  const ordinary = h.api.createScope();
  h.setHidden(true);
  h.event('document', 'visibilitychange');
  assert.equal(foreground.signal.aborted, true);
  assert.equal(ordinary.isCurrent(), true);
  h.setHidden(false);
  h.event('document', 'visibilitychange');
  assert.equal(ordinary.isCurrent(), true);
  assert.equal(h.api.createScope({ foreground: true }).isCurrent(), true);
});

test('timeout and idle cancellation is idempotent and queued callbacks cannot cross invalidation', () => {
  const h = harness();
  h.api.enterView('home');
  const calls = [];
  const scope = h.api.createScope();
  const cancelTimeout = scope.timeout(() => calls.push('cancelled-timeout'), 25);
  const cancelIdle = scope.idle(() => calls.push('cancelled-idle'), { timeout: 50 });
  cancelTimeout();
  cancelTimeout();
  cancelIdle();
  cancelIdle();
  h.runTimer();
  h.runIdle();
  assert.deepEqual(calls, []);

  const stale = h.api.createScope();
  stale.timeout(() => calls.push('stale-timeout'), 1);
  stale.idle(() => calls.push('stale-idle'), { timeout: 1 });
  h.api.enterView('request');
  stale.dispose();
  stale.dispose();
  h.runTimer();
  h.runIdle();
  assert.deepEqual(calls, []);

  const fresh = h.api.createScope();
  fresh.timeout(() => calls.push('fresh-timeout'), 1);
  fresh.idle(() => calls.push('fresh-idle'), { timeout: 1 });
  h.runTimer();
  h.runIdle();
  assert.deepEqual(calls, ['fresh-timeout', 'fresh-idle']);
});

test('a subscriber failure is isolated from later subscribers', () => {
  const h = harness();
  const calls = [];
  h.api.subscribe(() => { throw new Error('subscriber failure'); });
  h.api.subscribe(event => calls.push(event.type));
  h.api.enterView('home');
  assert.deepEqual(calls, ['view']);
  assert.equal(h.errors.length, 1);
});
