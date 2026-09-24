import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(process.env.GNC_SHELL_TEST_STDIN === '1' ? 0 : new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lifecycle = readFileSync(new URL('../assets/app-lifecycle.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = html.indexOf(start);
  assert.ok(a >= 0, `missing ${start}`);
  const b = html.indexOf(end, a + start.length);
  assert.ok(b >= 0, `missing ${end}`);
  return html.slice(a, b);
}
const inline = section('const checkLatestShellAndReload = async', 'navigator.serviceWorker.register(');
const runtime = section('async function fetchLatestShellManifestInfo(', 'async function forceShellBuildReload(');
const held = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

function harness() {
  const listeners = new Map(), timers = [], idle = [], fetches = [], registrations = [], reloads = [];
  let hidden = false, now = 100_000, nextTimerId = 1;
  const add = (target, name, callback) => {
    const key = `${target}:${name}`;
    listeners.set(key, [...(listeners.get(key) || []), callback]);
  };
  const queue = (items, fn) => { const item = { id: nextTimerId++, fn, cancelled: false }; items.push(item); return item.id; };
  const cancel = (items, id) => { const item = items.find(entry => entry.id === id); if (item) item.cancelled = true; };
  const document = { get hidden() { return hidden; }, addEventListener: (n, f) => add('document', n, f) };
  const window = {
    __APP_SHELL_VERSION__: 'current', __APP_SHELL_BUILD__: 'current', AbortController, console, document,
    addEventListener: (n, f) => add('window', n, f),
    setTimeout: fn => queue(timers, fn), clearTimeout: id => cancel(timers, id),
    requestIdleCallback: fn => queue(idle, fn), cancelIdleCallback: id => cancel(idle, id),
  };
  const context = vm.createContext({
    window, document, navigator: { onLine: true }, AbortController, URL, console,
    Date: { now: () => now },
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    requestIdleCallback: window.requestIdleCallback, cancelIdleCallback: window.cancelIdleCallback,
    fetch: (url, options) => { const pending = held(); fetches.push({ url, options, pending }); return pending.promise; },
    isTouchConstrainedDevice: () => false,
    updateShellRegistration: async reason => { registrations.push(reason); return {}; },
    requestWaitingShellActivation: () => true,
    reloadToShellBuild: (build, reason) => { reloads.push({ build, reason }); return true; },
    extractShellBuildFromUrl: url => new URL(url || '/', 'https://test.invalid/').searchParams.get('shellv') || '',
    firstNonEmptyValue: (...values) => values.find(Boolean) || '', logShellDiagnostics: () => {},
    APP_SHELL_VERSION: 'current', APP_SHELL_BUILD: 'current', APP_SHELL_MANIFEST_CHECK_TTL_MS: 30_000,
  });
  vm.runInContext(lifecycle, context, { filename: 'assets/app-lifecycle.js' });
  vm.runInContext(`
    const shellBuild = 'current';
    let latestShellCheckAt = 0, latestShellCheckSignal = null, latestShellCheckPromise = null;
    ${inline}
    globalThis.inlineApi = { checkLatestShellAndReload, scheduleShellMaintenance, get pending() { return latestShellCheckPromise; } };
    let latestShellManifestInfoCache = null, latestShellManifestInfoAt = 0;
    let latestShellManifestInfoPromise = null, latestShellManifestInfoSignal = null;
    ${runtime}
    globalThis.runtimeApi = { fetchLatestShellManifestInfo, get pending() { return latestShellManifestInfoPromise; }, get cache() { return latestShellManifestInfoCache; } };
  `, context);
  return {
    window, inline: context.inlineApi, runtime: context.runtimeApi, fetches, registrations, reloads,
    event: (target, name, isTrusted = true) => { for (const fn of listeners.get(`${target}:${name}`) || []) fn({ type: name, isTrusted }); },
    hidden: value => { hidden = value; }, tick: value => { now += value; },
    timer: () => { assert.ok(timers.length); const item = timers.shift(); if (!item.cancelled) item.fn(); },
    idle: () => { assert.ok(idle.length); const item = idle.shift(); if (!item.cancelled) item.fn(); },
    queuedIdle: () => idle.length,
    resolve: (index, build = 'current') => fetches[index].pending.resolve({ ok: true, json: async () => ({ start_url: `/?shellv=${build}`, version: build }) }),
    flush: async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); },
  };
}

test('navigation aborts an in-flight inline manifest request and its stale reload', async () => {
  const h = harness();
  const old = h.inline.checkLatestShellAndReload('test', true);
  assert.equal(h.fetches.length, 1);
  h.window.suspendShellMaintenanceForNavigation();
  assert.equal(h.fetches[0].options.signal.aborted, true);
  h.resolve(0, 'new');
  assert.equal(await old, false);
  assert.equal(h.registrations.length, 0);
  assert.equal(h.reloads.length, 0);
  assert.equal(await h.inline.checkLatestShellAndReload('late', true), false);
  assert.equal(h.fetches.length, 1);
});

test('abort after response but before JSON settles cannot activate a new build or cache it', async () => {
  const h = harness();
  const inlineJson = held();
  const inlineRead = h.inline.checkLatestShellAndReload('json', true);
  h.fetches[0].pending.resolve({ ok: true, json: () => inlineJson.promise });
  await h.flush();
  h.event('window', 'beforeunload');
  inlineJson.resolve({ start_url: '/?shellv=late' });
  assert.equal(await inlineRead, false);
  assert.equal(h.registrations.length, 0);
  assert.equal(h.reloads.length, 0);

  h.event('window', 'focus');
  const runtimeJson = held();
  const runtimeRead = h.runtime.fetchLatestShellManifestInfo(true);
  h.fetches[1].pending.resolve({ ok: true, json: () => runtimeJson.promise });
  await h.flush();
  h.event('window', 'beforeunload');
  runtimeJson.resolve({ start_url: '/?shellv=late' });
  assert.equal(await runtimeRead, null);
  assert.equal(h.runtime.cache, null);
});

test('queued timeout and idle callbacks cannot borrow a restored signal', async () => {
  const h = harness();
  h.inline.scheduleShellMaintenance('old', { force: true, delayMs: 1 });
  h.timer();
  assert.equal(h.queuedIdle(), 1);
  h.event('window', 'beforeunload');
  h.event('window', 'focus');
  h.idle();
  await h.flush();
  assert.equal(h.fetches.length, 0);
  assert.equal(h.registrations.length, 0);
  h.inline.scheduleShellMaintenance('fresh', { force: true, delayMs: 1 });
  h.timer(); h.idle(); await h.flush();
  assert.equal(h.fetches.length, 1);
  h.resolve(0);
});

test('a timeout queued before navigation cannot run after a trusted restore', async () => {
  const h = harness();
  h.inline.scheduleShellMaintenance('old-timeout', { force: true, delayMs: 1 });
  h.event('window', 'beforeunload');
  h.event('window', 'focus');
  h.timer();
  await h.flush();
  assert.equal(h.fetches.length, 0);
  assert.equal(h.registrations.length, 0);
  assert.equal(h.queuedIdle(), 0);
});

test('committed pagehide resumes only on trusted visible pageshow', async () => {
  const h = harness();
  h.event('window', 'pagehide');
  h.event('window', 'focus');
  h.event('document', 'pointerdown');
  assert.equal(h.window.getShellMaintenanceSignal().aborted, true);
  h.hidden(true); h.event('window', 'pageshow');
  assert.equal(h.window.getShellMaintenanceSignal().aborted, true);
  h.hidden(false); h.event('window', 'pageshow', false);
  assert.equal(h.window.getShellMaintenanceSignal().aborted, true);
  h.event('window', 'pageshow');
  assert.equal(h.window.getShellMaintenanceSignal().aborted, false);
});

test('trusted pageshow while hidden unlocks later visible visibility restoration', async () => {
  const h = harness();
  h.event('window', 'pagehide');
  h.hidden(true);
  h.event('window', 'pageshow');
  assert.equal(h.window.getShellMaintenanceSignal().aborted, true);
  h.hidden(false);
  h.event('document', 'visibilitychange');
  assert.equal(h.window.getShellMaintenanceSignal().aborted, false);
  const pending = h.inline.checkLatestShellAndReload('restored', true);
  assert.equal(h.fetches.length, 1);
  h.resolve(0);
  assert.equal(await pending, false);
});

test('old inline completion cannot erase a new request or trigger reload', async () => {
  const h = harness();
  const old = h.inline.checkLatestShellAndReload('old', true);
  h.event('window', 'beforeunload'); h.event('window', 'focus');
  const fresh = h.inline.checkLatestShellAndReload('fresh', false);
  assert.equal(h.fetches.length, 2);
  h.resolve(0, 'stale');
  assert.equal(await old, false);
  assert.notEqual(h.inline.pending, null);
  assert.equal(h.reloads.length, 0);
  h.resolve(1);
  assert.equal(await fresh, false);
  assert.equal(h.inline.pending, null);
});

test('runtime cache and pending read are bound to the current signal; force still refreshes', async () => {
  const h = harness();
  const old = h.runtime.fetchLatestShellManifestInfo(true);
  h.event('window', 'beforeunload'); h.event('window', 'focus');
  const fresh = h.runtime.fetchLatestShellManifestInfo(false);
  assert.equal(h.fetches.length, 2);
  h.resolve(0, 'stale');
  assert.equal(await old, null);
  assert.notEqual(h.runtime.pending, null);
  assert.equal(h.runtime.cache, null);
  h.resolve(1, 'new');
  assert.equal((await fresh).build, 'new');
  assert.equal(h.runtime.cache.build, 'new');
  assert.equal((await h.runtime.fetchLatestShellManifestInfo(false)).build, 'new');
  assert.equal(h.fetches.length, 2);
  const forced = h.runtime.fetchLatestShellManifestInfo(true);
  assert.equal(h.fetches.length, 3);
  h.resolve(2, 'newer');
  assert.equal((await forced).build, 'newer');
});
