import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource().replace(/\r\n/g, '\n');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const brace = html.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < html.length; index++) {
    if (html[index] === '{') depth++;
    else if (html[index] === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

test('shell update timer stays single and never checks while hidden or offline', () => {
  const source = readFileSync(new URL('../assets/live-app-update.js', import.meta.url), 'utf8');
  const start = source.indexOf('    function start() {');
  const end = source.indexOf('    serviceWorker?.addEventListener', start);
  assert.ok(start > 0 && end > start);
  const timers = [], checks = [];
  const ctx = { started: false, interval: null, doc: { hidden: true },
    root: { navigator: { onLine: true }, setInterval: (callback, delay) => { timers.push({ callback, delay }); return 1; } },
    ensureRegistration() {}, checkForLiveAppUpdate: reason => checks.push(reason) };
  vm.createContext(ctx);
  vm.runInContext("const visible = () => !doc.hidden && root.navigator?.onLine !== false;\n" + source.slice(start, end), ctx);
  assert.equal(ctx.start(), true);
  assert.equal(ctx.start(), false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 45000);
  checks.length = 0;
  timers[0].callback();
  assert.deepEqual(checks, []);
  ctx.doc.hidden = false;
  ctx.root.navigator.onLine = false;
  timers[0].callback();
  assert.deepEqual(checks, []);
  ctx.root.navigator.onLine = true;
  timers[0].callback();
  assert.deepEqual(checks, ['interval']);
});

test('a delayed realtime CLOSED fallback callback cannot restart polling after the page hides', () => {
  let callback = null;
  const starts = [];
  const ctx = { document: { hidden: false }, realtimeFallbackStartTimer: null, currentUser: 'user-1',
    activeRealtimeContextViewId: 'home', activeRealtimeTables: ['ph_master_inventory'],
    REALTIME_RECOVERY_GRACE_MS: 5000, setTimeout: fn => { callback = fn; return 7; }, clearTimeout() {},
    hasHealthyCoreRealtimeSubscriptions: () => false, getFallbackSyncInterval: () => 18_000,
    startFallbackSync: (...args) => starts.push(args) };
  vm.createContext(ctx);
  vm.runInContext(extractFunction('scheduleRealtimeFallbackStart'), ctx);

  ctx.scheduleRealtimeFallbackStart(5000);
  assert.equal(typeof callback, 'function');
  ctx.document.hidden = true;
  callback();
  assert.deepEqual(starts, [], 'delayed channel recovery exits before it can create the fallback interval');
  const fallback = extractFunction('startFallbackSync');
  assert.match(fallback, /clearInterval\(fallbackSyncInterval\)/);
  assert.doesNotMatch(fallback, /setInterval\(/, 'the retired fallback cannot create polling');
});
