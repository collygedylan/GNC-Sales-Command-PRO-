import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const DYLAN_ID = '54c87ebf-d76d-452b-96b4-beaaeb1742d9';
const ISSUER = 'https://kzrnyjsosryejjejliii.supabase.co/auth/v1';
const RPC = 'https://kzrnyjsosryejjejliii.supabase.co/rest/v1/rpc/bloomscapes_pending_command';
const NOW = Date.parse('2026-09-08T02:00:00Z');

function between(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing pending-view source: ${start}`);
  return html.slice(from, to);
}
const stateSource = between('let bloomscapesPendingState =', 'function getSupabaseBrowserClient(');
const viewSource = between('function canViewBloomscapesPendingOrders(', 'function updateSalesOfficeExportButton(');
const escapingSource = between('const escapeHtml =', 'const APP_SHELL_VERSION');
const watcherSource = between('function installNativeRoleRefreshWatchers()', "document.addEventListener('visibilitychange'");
const cacheResetSource = between('function clearRoleScopedClientCaches(', 'async function refreshNativeRoleAndCapabilities(');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function profile(overrides = {}) {
  return { id: DYLAN_ID, username: 'dylan_collyge', role: 'Admin', disabled_at: null,
    locked_until: null, must_change_password: false, ...overrides };
}
// Deliberately unsigned test fixtures: the UI reads claims only; the server verifies JWTs.
function token(overrides = {}) {
  const claims = { sub: DYLAN_ID, iss: ISSUER, exp: NOW / 1000 + 3600, ...overrides };
  return `unit.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.not-a-signature`;
}
function order(id = 'order-a', overrides = {}) {
  return { id, status: 'pending', created_at: '2026-09-08T01:00:00Z', tier: 'retail',
    customer_name: 'Private customer', note: 'Review first', subtotal_cents: 4500,
    lines: [{ quantity: 3, unit_price_cents: 1500,
      snapshot: { itemcode: '008033.021.1', name: "Anna's Magic Ball", size: '#3',
        locationcode: 'A.01.010', lotcode: '27S1', spec: '18-24', caliper: '1 in', photoLink: null, holdCode: 'REVIEW' } }],
    ...overrides };
}
function response(orders = [], overrides = {}) {
  return { ok: true, status: 200, json: async () => ({ mode: 'pending-unpaid',
    paymentEnabled: false, stockReserved: false, orders, ...overrides }) };
}
function storage() {
  const values = new Map([['unrelated', 'keep'], ['gnc_request_capabilities_v2:dylan_collyge', 'private']]);
  return { get length() { return values.size; }, key: (index) => [...values.keys()][index],
    getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key) };
}
function dialogElement() {
  const listeners = new Map();
  return { id: 'bloomscapes-pending-dialog', open: true, innerHTML: '', style: {},
    close() { this.open = false; }, showModal() { this.open = true; },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(name, listener) { listeners.set(name, listener); },
    dispatch(name) { listeners.get(name)?.({ preventDefault() {} }); } };
}

function harness(options = {}) {
  const calls = [], toasts = [], timers = [], refreshes = [];
  let dialog = options.noDialog ? null : dialogElement();
  let authCallback;
  class FixedDate extends Date { static now() { return NOW; } }
  const mutation = () => { throw new Error('Pending review must not mutate inventory or use legacy order actions'); };
  const ctx = vm.createContext({
    Date: FixedDate, Intl, atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    currentUser: 'dylan_collyge', currentRole: 'Admin', nativeAuthProfile: profile(),
    nativeAuthSessionActive: true, nativeAuthAccessToken: token(),
    navigator: { onLine: true }, window: {}, localStorage: storage(), sessionStorage: storage(),
    document: {
      getElementById: (id) => id === 'bloomscapes-pending-dialog' ? dialog : null,
      createElement: (tag) => { assert.equal(tag, 'dialog'); return dialogElement(); },
      body: { appendChild: (element) => { dialog = element; } },
    },
    showToast: (...args) => toasts.push(args), stopCodexOpsPoll() {},
    getSupabaseBrowserClient: () => ({ auth: { onAuthStateChange: (callback) => {
      authCallback = callback; return { data: { subscription: {} } };
    } } }),
    setTimeout: (callback) => timers.push(callback),
    refreshNativeRoleAndCapabilities: async (reason) => { refreshes.push(reason); },
    loadNativeAuthProfile: async (force) => {
      assert.equal(force, true);
      return options.profileLoader ? options.profileLoader(ctx) : ctx.nativeAuthProfile;
    },
    getNativeAuthRequestHeaders: async () => options.headers === null ? null : ({
      apikey: 'unit-publishable', Authorization: `Bearer ${ctx.nativeAuthAccessToken}`,
    }),
    fetchWithTimeout: async (url, request, timeout) => {
      assert.equal(url, RPC);
      assert.equal(request.method, 'POST');
      assert.equal(request.cache, 'no-store');
      assert.equal(request.credentials, 'omit');
      assert.equal(request.redirect, 'error');
      assert.equal(timeout, 20000);
      const body = JSON.parse(request.body);
      assert.equal(body.p_action, 'state', 'Only the read-only state command is permitted');
      assert.equal(body.p_request_id, null);
      assert.deepEqual(Object.keys(body).sort(), ['p_action', 'p_payload', 'p_request_id']);
      calls.push({ url, request, body });
      return options.fetch ? options.fetch(calls.length, ctx) : response([order()]);
    },
    fetch: mutation, supabaseFetch: mutation, runAppApiSupabaseWrite: mutation,
    saveData: mutation, markSalesOfficeComplete: mutation, removeSalesOfficeRowByUniqueId: mutation,
  });
  vm.runInContext(`${stateSource}\n${escapingSource}\n${viewSource}\n${watcherSource}\n${cacheResetSource}
    globalThis.pendingState = () => bloomscapesPendingState;
  `, ctx);
  ctx.installNativeRoleRefreshWatchers();
  return { ctx, calls, toasts, refreshes,
    get dialog() { return dialog; },
    auth: (event, session) => authCallback(event, session),
    flushTimers: async () => { for (const callback of timers.splice(0)) await callback(); },
  };
}

function assertCleared(h) {
  assert.equal(h.ctx.pendingState().orders.length, 0);
  assert.equal(h.ctx.pendingState().loading, false);
  assert.equal(h.ctx.pendingState().more, false);
  assert.equal(h.ctx.pendingState().error, '');
  assert.equal(h.dialog?.innerHTML || '', '');
  assert.equal(h.dialog?.open || false, false);
}

test('pending view permits only the exact active native Dylan profile and unexpired matching claims', () => {
  const { ctx } = harness();
  assert.equal(ctx.canViewBloomscapesPendingOrders(), true);
  const deniedProfiles = [null, profile({ username: 'megan_kelly' }), profile({ id: 'other-user' }),
    profile({ disabled_at: '2026-09-08T00:00:00Z' }), profile({ must_change_password: true }),
    profile({ must_change_password: undefined }), profile({ locked_until: '2026-09-09T00:00:00Z' }),
    profile({ locked_until: 'invalid' })];
  for (const candidate of deniedProfiles) assert.ok(!ctx.canViewBloomscapesPendingOrders(candidate));
  assert.equal(ctx.canViewBloomscapesPendingOrders(profile({ locked_until: '2026-09-07T00:00:00Z' })), true);
  for (const candidate of ['', 'not-a-jwt', token({ sub: 'other-user' }), token({ iss: 'https://foreign.invalid/auth/v1' }),
    token({ exp: NOW / 1000 }), token({ exp: 'invalid' })]) {
    ctx.nativeAuthAccessToken = candidate;
    assert.equal(ctx.canViewBloomscapesPendingOrders(), false, candidate);
  }
  ctx.nativeAuthAccessToken = token();
  ctx.nativeAuthSessionActive = false;
  assert.equal(ctx.canViewBloomscapesPendingOrders(), false);
  ctx.nativeAuthSessionActive = true;
  ctx.currentUser = 'megan_kelly';
  assert.equal(ctx.canViewBloomscapesPendingOrders(), false, 'Dylan-equivalent users are not admitted');
});

test('unauthorized direct entry cannot create a dialog or issue a request', async () => {
  const h = harness({ noDialog: true });
  h.ctx.currentUser = 'megan_kelly';
  h.ctx.openBloomscapesPendingOrders();
  await h.ctx.loadBloomscapesPendingOrders();
  assert.equal(h.dialog, null);
  assert.equal(h.calls.length, 0);
  assert.equal(h.toasts.length, 1);
});

test('authorized read is native-only and retains exact requested source details with unpaid warnings', async () => {
  const h = harness();
  await h.ctx.loadBloomscapesPendingOrders();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].request.headers.Authorization, `Bearer ${h.ctx.nativeAuthAccessToken}`);
  assert.deepEqual(h.calls[0].body.p_payload, {});
  for (const text of ['008033.021.1', 'Anna&#39;s Magic Ball', 'A.01.010', '27S1', '3 requested', '$15.00', '$45.00',
    'Unpaid', 'No stock reserved', 'not confirmed allocations or instructions to pull', 'Shipping and tax not calculated',
    'missing; nursery review required', 'Source hold code: REVIEW']) assert.ok(h.dialog.innerHTML.includes(text), text);
  assert.equal(h.ctx.pendingState().orders.length, 1);
});

test('all customer, source and error text is escaped; photo references are not loaded', async () => {
  const attack = '<img src=x onerror="alert(1)">&\'';
  const injected = order('xss-order', { customer_name: attack, note: attack, tier: attack,
    lines: [{ quantity: 3, unit_price_cents: 1500,
      snapshot: Object.fromEntries(['itemcode', 'name', 'size', 'locationcode', 'lotcode', 'spec', 'caliper', 'holdCode', 'photoLink'].map(key => [key, attack])) }] });
  const h = harness({ fetch: () => response([injected]) });
  await h.ctx.loadBloomscapesPendingOrders();
  assert.doesNotMatch(h.dialog.innerHTML, /<img\b|<script\b/i);
  assert.ok(h.dialog.innerHTML.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;'));
  assert.match(h.dialog.innerHTML, /recorded; verify current evidence before fulfillment/);
  assert.equal(h.calls.length, 1);
});

test('offline, invalid refreshed profile and missing native headers never use a legacy fallback', async () => {
  const cases = [harness(), harness({ profileLoader: () => null }), harness({ headers: null })];
  cases[0].ctx.navigator.onLine = false;
  for (const h of cases) {
    await h.ctx.loadBloomscapesPendingOrders();
    assert.equal(h.calls.length, 0);
    assert.equal(h.ctx.pendingState().orders.length, 0);
    assert.equal(h.ctx.pendingState().loading, false);
    assert.ok(h.ctx.pendingState().error);
  }
});

test('explicit close invalidates an outstanding response and resets all private state', async () => {
  const sent = deferred(), reply = deferred();
  const h = harness({ fetch: () => { sent.resolve(); return reply.promise; } });
  const flight = h.ctx.loadBloomscapesPendingOrders();
  await sent.promise;
  const sequence = h.ctx.pendingState().sequence;
  h.ctx.closeBloomscapesPendingOrders();
  assert.ok(h.ctx.pendingState().sequence > sequence);
  reply.resolve(response([order('late-private-order')]));
  await flight;
  assertCleared(h);
});

test('real SIGNED_OUT callback immediately erases private data and rejects a delayed response', async () => {
  const sent = deferred(), reply = deferred();
  const h = harness({ fetch: () => { sent.resolve(); return reply.promise; } });
  h.ctx.pendingState().orders = [order('already-visible')];
  h.ctx.renderBloomscapesPendingOrders();
  const flight = h.ctx.loadBloomscapesPendingOrders();
  await sent.promise;
  h.auth('SIGNED_OUT', null);
  assertCleared(h);
  assert.equal(h.ctx.nativeAuthSessionActive, false);
  assert.equal(h.ctx.nativeAuthAccessToken, '');
  reply.resolve(response([order('late-private-order')]));
  await flight;
  assertCleared(h);
});

test('same-role native identity switch erases the private dialog before deferred role refresh', async () => {
  const sent = deferred(), reply = deferred();
  const h = harness({ fetch: () => { sent.resolve(); return reply.promise; } });
  const flight = h.ctx.loadBloomscapesPendingOrders();
  await sent.promise;
  h.auth('SIGNED_IN', { user: { id: 'other-admin-user' }, access_token: token({ sub: 'other-admin-user' }) });
  assertCleared(h);
  assert.equal(h.ctx.currentRole, 'Admin');
  assert.equal(h.refreshes.length, 0, 'privacy cleanup must not wait for role refresh');
  reply.resolve(response([order('old-dylan-response')]));
  await flight;
  await h.flushTimers();
  assertCleared(h);
  assert.deepEqual(h.refreshes, ['auth:signed_in']);
});

test('ordinary token refresh for the same Dylan identity does not discard displayed orders', async () => {
  const h = harness();
  await h.ctx.loadBloomscapesPendingOrders();
  const before = h.dialog.innerHTML;
  h.auth('TOKEN_REFRESHED', { user: { id: DYLAN_ID }, access_token: token() });
  assert.equal(h.dialog.innerHTML, before);
  assert.equal(h.ctx.pendingState().orders.length, 1);
  await h.flushTimers();
  assert.deepEqual(h.refreshes, ['auth:token_refreshed']);
});

test('an old response cannot populate or stop loading a reopened dialog', async () => {
  const sentOld = deferred(), sentNew = deferred(), oldReply = deferred(), newReply = deferred();
  const h = harness({ fetch: count => {
    if (count === 1) { sentOld.resolve(); return oldReply.promise; }
    sentNew.resolve(); return newReply.promise;
  } });
  const first = h.ctx.loadBloomscapesPendingOrders();
  await sentOld.promise;
  h.ctx.closeBloomscapesPendingOrders();
  h.dialog.showModal();
  const second = h.ctx.loadBloomscapesPendingOrders();
  await sentNew.promise;
  oldReply.resolve(response([order('old-order')]));
  await first;
  assert.equal(h.ctx.pendingState().loading, true);
  assert.equal(h.ctx.pendingState().orders.length, 0);
  newReply.resolve(response([order('new-order')]));
  await second;
  assert.equal(h.ctx.pendingState().orders[0].id, 'new-order');
  assert.equal(h.ctx.pendingState().loading, false);
});

test('role-scoped cache reset invokes real pending cleanup without deleting unrelated storage', async () => {
  const h = harness();
  await h.ctx.loadBloomscapesPendingOrders();
  h.ctx.pendingState().more = true;
  h.ctx.pendingState().error = 'private failure';
  h.ctx.clearRoleScopedClientCaches();
  assertCleared(h);
  assert.equal(h.ctx.localStorage.getItem('unrelated'), 'keep');
  assert.equal(h.ctx.localStorage.getItem('gnc_request_capabilities_v2:dylan_collyge'), null);
});

test('pagination sends the exact last cursor, avoids duplicate rows and never changes stock', async () => {
  const firstPage = Array.from({ length: 25 }, (_, index) => order(`order-${index}`));
  const h = harness({ fetch: count => response(count === 1 ? firstPage : [firstPage[24], order('older-order')]) });
  await h.ctx.loadBloomscapesPendingOrders();
  assert.equal(h.ctx.pendingState().more, true);
  await h.ctx.loadBloomscapesPendingOrders(true);
  assert.deepEqual(h.calls[1].body.p_payload, { beforeTime: firstPage[24].created_at, beforeId: firstPage[24].id });
  assert.equal(h.ctx.pendingState().orders.length, 26);
  assert.equal(h.ctx.pendingState().more, false);
});

test('unexpected payment/stock contract and forbidden responses clear previously shown orders', async () => {
  for (const bad of [response([], { paymentEnabled: true }), response([], { stockReserved: true }),
    { ok: false, status: 403, json: async () => ({ message: '<script>private error</script>' }) }]) {
    const h = harness({ fetch: count => count === 1 ? response([order()]) : bad });
    await h.ctx.loadBloomscapesPendingOrders();
    await h.ctx.loadBloomscapesPendingOrders();
    assert.equal(h.ctx.pendingState().orders.length, 0);
    assert.equal(h.ctx.pendingState().loading, false);
    assert.ok(h.ctx.pendingState().error);
    assert.doesNotMatch(h.dialog.innerHTML, /<script>|Private customer/);
  }
});
