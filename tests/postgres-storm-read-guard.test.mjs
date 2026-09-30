import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const guardStart = html.indexOf('const supabaseReadInFlight = new Map();');
const guardEnd = html.indexOf('async function getResponseError(', guardStart);
assert.ok(guardStart >= 0 && guardEnd > guardStart, 'shared read guard source must be present');

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

function makeGuardHarness() {
  const ctx = {
    Error, Object, String, Number, Boolean, Array, Set, Map, Math, JSON, Promise, Date,
    AbortController, setTimeout, clearTimeout, SUPABASE_URL: 'https://guard-fixture.invalid', currentUser: 'reader-a',
    currentRole: 'manager', currentUserDivision: '', nativeAuthSessionActive: true,
    nativeAuthProfile: { id: 'profile-a' }, productionLiveSyncReadPermissionVersion: 'permissions-a',
    SUPABASE_READ_CONCURRENCY_LIMIT: 8,
    incrementInternalPerfCounter() {},
    getCurrentLoginCacheScopeKey: () => 'login-a',
    getProductionLiveSyncReadSignalKey: () => 'fixture-signal'
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(guardStart, guardEnd) + '\nthis.readCooldowns = supabaseReadFailureCooldowns;', ctx);
  return ctx;
}

test('shared reader caps transient failures at three attempts and establishes a generation-independent cooldown', async () => {
  const ctx = makeGuardHarness();
  let calls = 0;
  await assert.rejects(ctx.runDedupeSupabaseRead('dataset:inventory', async () => {
    calls += 1;
    throw Object.assign(new Error('temporary server failure'), { status: 503 });
  }));
  assert.equal(calls, 3, 'there are no more than three total attempts');

  ctx.productionLiveSyncReadGeneration += 1;
  let retryCalls = 0;
  await assert.rejects(
    ctx.runDedupeSupabaseRead('dataset:inventory', async () => { retryCalls += 1; return []; }),
    error => error?.code === 'SUPABASE_READ_COOLDOWN' && error.retryAfterMs > 0
  );
  assert.equal(retryCalls, 0, 'a coordinator generation cannot bypass the dataset cooldown');
  const cooldown = ctx.readCooldowns.get(ctx.getSupabaseReadCooldownKey(ctx.getSupabaseReadIdentityScope(), 'dataset:inventory'));
  assert.ok(cooldown.until - Date.now() >= 9900, 'new failure cooldown is at least ten seconds');
});

test('permission and PT409 responses are terminal and are never automatically retried', async () => {
  const ctx = makeGuardHarness();
  for (const error of [
    Object.assign(new Error('permission denied'), { code: '42501' }),
    Object.assign(new Error('season sales is not open'), { code: 'PT409', status: 409 })
  ]) {
    let calls = 0;
    await assert.rejects(ctx.runDedupeSupabaseRead(`terminal:${error.code}`, async () => {
      calls += 1;
      throw error;
    }), caught => caught === error);
    assert.equal(calls, 1, `${error.code} must not be retried`);
  }
  assert.equal(ctx.isSupabaseReadRetryable({ code: '42501' }), false);
  assert.equal(ctx.isSupabaseReadRetryable({ code: 'PT409', status: 409 }), false);
});

test('identical reads share one in-flight request in a session and account scopes stay separate', async () => {
  const ctx = makeGuardHarness();
  const gate = deferred();
  let calls = 0;
  const task = async () => { calls += 1; return gate.promise; };
  const first = ctx.runDedupeSupabaseRead('dataset:grower', task);
  const duplicate = ctx.runDedupeSupabaseRead('dataset:grower', task);
  assert.equal(first, duplicate, 'same generation and identity return the same promise');
  await settle();
  assert.equal(calls, 1);
  gate.resolve(['a']);
  assert.deepEqual(await Promise.all([first, duplicate]), [['a'], ['a']]);

  ctx.currentUser = 'reader-b';
  const other = ctx.runDedupeSupabaseRead('dataset:grower', async () => { calls += 1; return ['b']; });
  assert.deepEqual(await other, ['b']);
  assert.equal(calls, 2, 'a different account never shares another account request');
});

test('aborted reads stop during backoff and do not create a failure cooldown', async () => {
  const ctx = makeGuardHarness();
  const controller = new AbortController();
  let calls = 0;
  const pending = ctx.runDedupeSupabaseRead('dataset:abort', async () => {
    calls += 1;
    throw new Error('temporary network failure');
  }, { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 30));
  controller.abort();
  await assert.rejects(pending, error => error?.code === 'REQUEST_ABORTED');
  assert.equal(calls, 1, 'abort prevents the next retry attempt');
  assert.equal(ctx.readCooldowns.has(ctx.getSupabaseReadCooldownKey(ctx.getSupabaseReadIdentityScope(), 'dataset:abort')), false);
});

test('Request privilege failures retain verified rows and do not trigger the partial-list fallback', () => {
  const start = html.indexOf('async function fetchActiveRequestLiveRows(');
  const end = html.indexOf('\n        async function fetchSupabasePage(', start);
  assert.ok(start > 0 && end > start);
  const body = html.slice(start, end);
  assert.match(body, /if\s*\(!isRequestQueueLiveRowsViewMissingError\(error\)\)\s*throw error/,
    'permission errors must propagate instead of marking the view missing');
  assert.match(body, /isRequestQueueLiveRowsViewMissingError\(error\)[\s\S]*?activeRequestLiveRowsViewReady\s*=\s*false/,
    'only a verified missing-view error can enable the legacy fallback');
  const missingStart = html.indexOf('function isRequestQueueLiveRowsViewMissingError(');
  const missingEnd = html.indexOf('\n        function isOptionalFlyerRowsMissingError(', missingStart);
  assert.ok(missingStart > 0 && missingEnd > missingStart);
  assert.match(html.slice(missingStart, missingEnd), /code === '42501'[\s\S]*return false/,
    'permission errors must never be classified as a missing view');
  const missingCtx = { REQUEST_QUEUE_LIVE_ROWS_TABLE: 'ph_request_queue_live_rows', getSupabaseReadErrorCode: error => error.code || '' };
  vm.createContext(missingCtx);
  vm.runInContext(html.slice(missingStart, missingEnd), missingCtx);
  assert.equal(missingCtx.isRequestQueueLiveRowsViewMissingError({ code: '42501', message: 'permission denied for relation ph_request_queue_live_rows' }), false);
  assert.equal(missingCtx.isRequestQueueLiveRowsViewMissingError({ code: '42P01', message: 'relation ph_master_inventory does not exist' }), false);
  assert.equal(missingCtx.isRequestQueueLiveRowsViewMissingError({ code: '42P01', message: 'relation ph_request_queue_live_rows does not exist' }), true);
  const forceStart = html.indexOf('async function forceRefreshRequestsForView(');
  const forceEnd = html.indexOf('\n        function syncRequestViewLiveSync(', forceStart);
  const forceBody = html.slice(forceStart, forceEnd);
  const catchBody = forceBody.slice(forceBody.indexOf('} catch (error) {'));
  assert.match(catchBody, /recordRequestViewReadFailure\(error\)/);
  assert.doesNotMatch(catchBody, /processAndLoadData\(\{\s*requestsData:/,
    'a failed refresh must leave the last complete requests snapshot in place');
});

test('Request failure schedules use one cancellable interactive timer and honor read cooldown', () => {
  const start = html.indexOf('function queueRequestInteractiveRefresh(');
  const end = html.indexOf('\n        function queueRequestVisibleRenderCatchup(', start);
  assert.ok(start > 0 && end > start);
  const queue = html.slice(start, end);
  assert.match(queue, /requestViewInteractiveRefreshTimer/);
  assert.match(queue, /if\s*\(requestViewInteractiveRefreshTimer\)\s*return false/);
  const clearStart = html.indexOf('function clearRequestViewLiveSync(');
  const clearEnd = html.indexOf('\n        function getRequestViewReadCooldownMs(', clearStart);
  assert.match(html.slice(clearStart, clearEnd), /clearTimeout\(requestViewInteractiveRefreshTimer\)/,
    'leaving the Request view must cancel its scheduled interactive retry');
  const liveSyncStart = html.indexOf('async function runRequestViewLiveSync(');
  const liveSyncEnd = html.indexOf('\n        async function forceRefreshRequestsForView(', liveSyncStart);
  const liveSync = html.slice(liveSyncStart, liveSyncEnd);
  assert.match(liveSync, /recordRequestViewReadFailure\(error\)/);
  assert.match(liveSync, /requestViewReadCooldownRemaining\(\)/);
  assert.match(liveSync, /const readCooldown = requestViewReadCooldownRemaining\(\)/,
    'poll refreshes must wait for the failure cooldown');
  const syncStart = html.indexOf('function syncRequestViewLiveSync(');
  const syncEnd = html.indexOf('\n        function getFallbackSyncInterval(', syncStart);
  assert.match(html.slice(syncStart, syncEnd), /requestViewReadCooldownRemaining\(\)/);
});

test('Eval Work realtime channel has teardown on hidden state, identity change, and sign-out', () => {
  const evalChannelStart = html.indexOf('let evalWorkRealtimeChannel');
  assert.ok(evalChannelStart > 0, 'Eval Work realtime channel declaration must exist');
  const cleanupStart = html.indexOf('function unsubscribeEvalWorkRealtime(', evalChannelStart);
  assert.ok(cleanupStart > evalChannelStart, 'Eval Work channel needs a named teardown helper');
  const cleanupEnd = html.indexOf('\n        }', cleanupStart) + '\n        }'.length;
  const cleanup = html.slice(cleanupStart, cleanupEnd);
  assert.match(cleanup, /removeChannel|unsubscribe/);
  const docLifecycleStart = html.indexOf("document.addEventListener('visibilitychange'", evalChannelStart);
  const docLifecycleEnd = html.indexOf('\n        });', docLifecycleStart);
  assert.match(html.slice(docLifecycleStart, docLifecycleEnd), /unsubscribeEvalWorkRealtime\(/,
    'the hidden lifecycle must tear down Eval Work subscriptions');
  const identityStart = html.indexOf('function clearInMemorySessionIdentity(');
  const identityEnd = html.indexOf('\n        }', identityStart);
  assert.match(html.slice(identityStart, identityEnd), /unsubscribeEvalWorkRealtime\(/,
    'scope changes and sign-out share the realtime teardown path');
  const scopeStart = html.indexOf('function subscribeEvalWorkRealtime(', evalChannelStart);
  const scopeEnd = html.indexOf('\n        async function loadEvalWorkAssignments(', scopeStart);
  assert.match(html.slice(scopeStart, scopeEnd), /evalWorkRealtimeScope === scope[\s\S]*unsubscribeEvalWorkRealtime\(/,
    'changing the authenticated scope removes the old channel before subscribing again');
});
