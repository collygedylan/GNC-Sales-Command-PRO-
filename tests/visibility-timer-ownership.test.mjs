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

test('service-worker registration resolving while hidden does not create a recurring timer', () => {
  const timers = [];
  const cleared = [];
  const ctx = { document: { hidden: true }, window: { __swReg: {}, __swUpdateIntervalId: null },
    setInterval: (callback, delay) => { const id = { callback, delay }; timers.push(id); return id; },
    clearInterval: id => cleared.push(id), updateShellRegistration() {}, checkLatestShellAndReload() {} };
  vm.createContext(ctx);
  vm.runInContext(extractFunction('startShellUpdateInterval') + extractFunction('stopShellUpdateInterval'), ctx);

  assert.equal(ctx.startShellUpdateInterval(), false, 'late registration completion sees the hidden document');
  assert.equal(timers.length, 0);
  ctx.document.hidden = false;
  assert.equal(ctx.startShellUpdateInterval('interval-resume'), true, 'visibility resume starts the existing five-minute check');
  assert.equal(ctx.startShellUpdateInterval('interval-resume'), false, 'repeated visibility events do not duplicate it');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 300_000);
  ctx.document.hidden = true;
  assert.equal(ctx.stopShellUpdateInterval(), true);
  assert.equal(cleared[0], timers[0]);
  assert.equal(ctx.window.__swUpdateIntervalId, null);

  assert.match(html, /startShellUpdateInterval\(\);\s*\}\)\.catch\(err => logShellDiagnostics\('service-worker-startup-failed',/,
    'registration continuation uses the visibility-aware helper');
  assert.match(html, /if \(document\.hidden\) \{\s*setTimeout\(tryApplyShellUpdateSilently, 600\);\s*stopShellUpdateInterval\(\);/);
  assert.match(html, /\} else \{\s*startShellUpdateInterval\('interval-resume'\);/);
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
  assert.match(extractFunction('startFallbackSync'), /if \(!currentUser \|\| document\.hidden\) return;/,
    'fallback startup itself also rejects hidden callers');
  assert.match(html, /else scheduleRealtimeFallbackStart\(retryDelay\);/,
    'the realtime CLOSED / CHANNEL_ERROR path uses the guarded scheduler');
});
