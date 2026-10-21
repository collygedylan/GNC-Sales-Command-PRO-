import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: @session-recovery
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const lifecycle = readFileSync(new URL('../assets/app-lifecycle.js', import.meta.url), 'utf8');
const html = readComposedAppSource().replace(/\r\n/g, '\n');
const release = html.match(/window\.__APP_SHELL_VERSION__\s*=\s*'([^']+)'/)?.[1] || 'AgData current';
const releases = ['AgData v2.1.38', release];

function storage() {
  const entries = new Map();
  return { entries, getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key), clear: () => entries.clear() };
}

function lifecycleHarness() {
  const timers = [], deleted = [], unregistered = [], reloads = [], logs = [];
  const caches = ['ag-data-v4.3-rebuild-AgData v2.1.38-old', `ag-data-v4.3-rebuild-${release}-scope-r1`,
    'ag-data-runtime-images-v2', 'gnc-suspend-notification-actions', 'partner-cache'];
  const registrations = [
    { scope: 'https://app.test/', active: { scriptURL: 'https://app.test/sw.js?v=old' }, unregister: async () => { unregistered.push('root'); } },
    { scope: 'https://app.test/v2/', active: { scriptURL: 'https://app.test/v2/sw.js' }, unregister: async () => { unregistered.push('nested'); } },
    { scope: 'https://other.test/', active: { scriptURL: 'https://other.test/sw.js' }, unregister: async () => { unregistered.push('other'); } },
  ];
  const root = {
    AbortController,
    document: { hidden: false, addEventListener() {} },
    navigator: { onLine: true, serviceWorker: { getRegistrations: async () => registrations } },
    caches: { keys: async () => [...caches], delete: async key => { deleted.push(key); return true; } },
    localStorage: storage(), sessionStorage: storage(),
    console: { info: (...args) => logs.push(['info', ...args]), warn: (...args) => logs.push(['warn', ...args]), error: (...args) => logs.push(['error', ...args]) },
    __APP_SHELL_VERSION__: releases[0], __APP_SHELL_BUILD__: releases[0],
    location: { href: 'https://app.test/index.html', origin: 'https://app.test', reload: () => reloads.push(root.location.href), replace: url => reloads.push(url) },
    history: { state: {}, replaceState: (_state, _title, url) => { root.location.href = String(url); } },
    addEventListener() {}, setTimeout: callback => { timers.push(callback); return timers.length; },
  };
  const context = vm.createContext({ window: root, AbortController, URL, Date, Promise });
  vm.runInContext(lifecycle, context, { filename: 'assets/app-lifecycle.js' });
  return { root, context, caches, deleted, unregistered, reloads, timers, logs };
}

test('stale shell recovery removes only AgData shell state and preserves user/auth caches', async () => {
  const h = lifecycleHarness();
  h.root.localStorage.setItem('supabase.auth.token', 'active-session');
  h.root.localStorage.setItem('draft:request', 'unsent');
  h.root.sessionStorage.setItem('request-outbox', 'pending');
  h.root.indexedDB = { deleteDatabase() { assert.fail('shell recovery must preserve IndexedDB'); } };

  assert.equal(await h.root.recoverShellVersionMismatch(releases[0], releases[1]), true);
  assert.deepEqual(h.deleted, ['ag-data-v4.3-rebuild-AgData v2.1.38-old']);
  assert.deepEqual(h.unregistered, ['root']);
  assert.equal(h.root.localStorage.getItem('supabase.auth.token'), 'active-session');
  assert.equal(h.root.localStorage.getItem('draft:request'), 'unsent');
  assert.equal(h.root.sessionStorage.getItem('request-outbox'), 'pending');
  assert.equal(await h.root.recoverShellVersionMismatch(releases[0], releases[1]), false,
    'one stale-shell target cannot cause a reload loop');
  assert.equal(h.reloads.length, 1);
});

test('service-worker registration helper tolerates undefined test stubs without console errors', async () => {
  const h = lifecycleHarness();
  const unavailable = [];
  const unsupported = await h.root.registerGncServiceWorkerSafely(undefined, './sw.js', {}, {
    onUnavailable: reason => unavailable.push(reason),
  });
  const stubbed = await h.root.registerGncServiceWorkerSafely({ register: () => undefined }, './sw.js', {}, {
    onUnavailable: reason => unavailable.push(reason),
  });
  assert.equal(unsupported, null);
  assert.equal(stubbed, null);
  assert.equal(unavailable.length, 2);
  assert.equal(h.logs.filter(([level]) => level === 'error').length, 0);
});

function restoreFunctionSource() {
  const start = html.indexOf('async function restoreNativeAuthSessionOnStartup()');
  const end = html.indexOf('function showNativeSessionRestorePending(', start);
  assert.ok(start >= 0 && end > start, 'startup session restore function is present');
  return html.slice(start, end);
}

function pendingSessionFunctionSource() {
  const start = html.indexOf('function hasRetainedAuthenticatedAppAccess()');
  const end = html.indexOf('async function clearRevokedNativeAuthSession(', start);
  assert.ok(start >= 0 && end > start, 'identity-bound pending-session helpers are present');
  return html.slice(start, end);
}

function passkeyFunctionSource() {
  const start = html.indexOf('async function signInWithAppPasskey(');
  const end = html.indexOf('async function registerAppPasskey(', start);
  assert.ok(start >= 0 && end > start, 'passkey sign-in preserves same-account workspace state');
  return html.slice(start, end);
}

function pendingSessionHarness({ sameIdentity = true, retainedSnapshot = true } = {}) {
  const classes = new Map();
  const ids = ['app-wrapper', 'login-inputs', 'loading-spinner', 'loading-text',
    'native-session-restore-retry', 'native-session-restore-signin'];
  for (const id of ids) classes.set(id, new Set(id === 'app-wrapper' || id === 'loading-spinner' ? ['hidden'] : []));
  const elements = Object.fromEntries(ids.map(id => [id, {
    id, innerText: '', disabled: false,
    classList: {
      add: token => classes.get(id).add(token),
      remove: token => classes.get(id).delete(token),
      toggle: (token, force) => {
        const enable = force === undefined ? !classes.get(id).has(token) : !!force;
        if (enable) classes.get(id).add(token); else classes.get(id).delete(token);
        return enable;
      },
      contains: token => classes.get(id).has(token),
    },
  }]));
  const profile = { id: 'profile-1', username: 'field_user', role: 'Sales Rep', disabled_at: null, must_change_password: false };
  const snapshot = retainedSnapshot ? { username: 'field_user', role: 'Sales Rep', dataPermissionVersion: 'perm-v1' } : null;
  const state = retainedSnapshot ? { username: 'field_user', profileId: 'profile-1', snapshot, status: 'error', stale: true, loadedAt: 1 } : { username: 'field_user', profileId: 'profile-1', snapshot: null, status: 'error', stale: true, loadedAt: 0 };
  const context = vm.createContext({
    window: { GncLoginTrace: { finish() {} } },
    document: { hidden: false, getElementById: id => elements[id] || null },
    nativeAuthSessionActive: true, nativeAuthSessionUserId: sameIdentity ? 'profile-1' : 'different-profile', nativeAuthProfile: profile,
    nativeAuthProfileRestorePending: false, currentUser: 'field_user', currentRole: 'Sales Rep', appAccessSnapshotState: state,
    getAppAccessSnapshot: () => snapshot, normalizeRoleAccessToken: value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''),
    setBootingSession() {}, logShellDiagnostics() {},
  });
  vm.runInContext(pendingSessionFunctionSource(), context, { filename: 'index.html:pending-session-access' });
  return { context, classes, elements };
}

test('transient startup verification retains the authenticated session and offers a safe retry', async () => {
  const profile = { id: 'profile-1', username: 'field_user', display_name: 'Field User', role: 'Sales Rep', division: '10', language: 'English' };
  const calls = [];
  const context = vm.createContext({
    window: { GncLoginTrace: { finish: result => calls.push(['trace', result]) } },
    document: { hidden: false, getElementById: () => ({ classList: { add() {}, remove() {} } }) },
    NATIVE_AUTH_ENABLED: true,
    nativeAuthRecoveryEpoch: 7,
    nativeAuthSessionUserId: profile.id,
    nativeAuthSessionActive: true,
    nativeAuthProfile: profile,
    nativeAuthProfileRestorePending: false,
    currentUser: '', currentUserDisplay: '', currentRole: '', currentUserDivision: '10', currentUserLanguage: 'English', safeRole: '',
    hasExplicitLogoutMarker: () => false,
    startLoginNetworkTrace: () => {},
    loadNativeAuthProfile: async () => profile,
    normalizeAppUserLanguage: value => value,
    beginInitialAppLoad: () => calls.push(['begin']),
    scheduleLoginStartupWatchdog: () => {},
    ensureNativeAppSessionBridge: async () => null,
    finalizeLogin: async () => { throw new TypeError('Failed to fetch'); },
    isTransientNativeAuthReadFailure: error => error instanceof TypeError || /network/i.test(error.message),
    isNativeAuthSessionRevoked: () => false,
    showNativeSessionRestorePending: error => calls.push(['retry-ui', error.message]),
    finishInitialAppLoad: () => calls.push(['finish']),
    clearRevokedNativeAuthSession: async () => { calls.push(['revoked-cleanup']); },
    clearInMemorySessionIdentity: () => { calls.push(['identity-cleared']); },
    resetLoginUiState: () => { calls.push(['login-reset']); },
  });
  vm.runInContext(restoreFunctionSource(), context, { filename: 'index.html:restoreNativeAuthSessionOnStartup' });
  const restored = await vm.runInContext('restoreNativeAuthSessionOnStartup()', context);
  assert.equal(restored, true);
  assert.equal(vm.runInContext('nativeAuthSessionActive', context), true);
  assert.equal(vm.runInContext('nativeAuthProfileRestorePending', context), true);
  assert.equal(vm.runInContext('nativeAuthProfile.id', context), profile.id);
  assert.equal(calls.some(([name]) => name === 'identity-cleared' || name === 'login-reset'), false);
  assert.equal(calls.some(([name]) => name === 'retry-ui'), true);
});

test('a confirmed revoked Supabase session uses local sign-out and never opens the app shell', async () => {
  const profile = { id: 'profile-1', username: 'field_user', display_name: 'Field User', role: 'Sales Rep', division: '10', language: 'English' };
  const calls = [];
  const context = vm.createContext({
    window: { GncLoginTrace: { finish: () => {}, measure: (_label, callback) => callback() } },
    document: { hidden: false, getElementById: () => ({ classList: { add() {}, remove() {} } }) },
    NATIVE_AUTH_ENABLED: true, nativeAuthRecoveryEpoch: 7, nativeAuthSessionUserId: profile.id,
    nativeAuthSessionActive: true, nativeAuthProfile: profile, nativeAuthProfileRestorePending: false,
    currentUser: '', currentUserDisplay: '', currentRole: '', currentUserDivision: '10', currentUserLanguage: 'English', safeRole: '',
    hasExplicitLogoutMarker: () => false, startLoginNetworkTrace: () => {},
    loadNativeAuthProfile: async () => profile, normalizeAppUserLanguage: value => value,
    beginInitialAppLoad: () => {}, scheduleLoginStartupWatchdog: () => {}, ensureNativeAppSessionBridge: async () => null,
    finalizeLogin: async () => { throw Object.assign(new Error('refresh token revoked'), { status: 401, code: 'invalid_grant' }); },
    isTransientNativeAuthReadFailure: () => false,
    isNativeAuthSessionRevoked: error => error.status === 401 || error.code === 'invalid_grant',
    clearRevokedNativeAuthSession: async error => calls.push(['revoked-cleanup', error.status]),
    showNativeSessionRestorePending: () => calls.push(['retry-ui']),
    finishInitialAppLoad: () => {}, clearInMemorySessionIdentity: () => calls.push(['identity-cleared']),
    resetLoginUiState: () => calls.push(['login-reset']),
  });
  vm.runInContext(restoreFunctionSource(), context, { filename: 'index.html:restoreNativeAuthSessionOnStartup' });
  const restored = await vm.runInContext('restoreNativeAuthSessionOnStartup()', context);
  assert.equal(restored, false);
  assert.deepEqual(calls, [['revoked-cleanup', 401]]);
});

test('transient verification keeps the same authenticated user’s retained shell visible', () => {
  const h = pendingSessionHarness();
  assert.equal(vm.runInContext('hasRetainedAuthenticatedAppAccess()', h.context), true);
  assert.equal(vm.runInContext("showNativeSessionRestorePending(new Error('network timeout'))", h.context), true);
  assert.equal(h.classes.get('app-wrapper').has('hidden'), false);
  assert.equal(h.classes.get('loading-spinner').has('hidden'), true);
  assert.equal(h.classes.get('native-session-restore-retry').has('hidden'), false);
  assert.match(h.elements['loading-text'].innerText, /loaded workspace remains available/i);
  assert.equal(vm.runInContext('nativeAuthProfileRestorePending', h.context), true);
});

test('pending verification hides the shell when identity or retained access does not match', () => {
  for (const options of [{ sameIdentity: false }, { retainedSnapshot: false }]) {
    const h = pendingSessionHarness(options);
    assert.equal(vm.runInContext('hasRetainedAuthenticatedAppAccess()', h.context), false);
    assert.equal(vm.runInContext("showNativeSessionRestorePending(new Error('network timeout'))", h.context), true);
    assert.equal(h.classes.get('app-wrapper').has('hidden'), true);
    assert.equal(h.classes.get('loading-spinner').has('hidden'), false);
  }
});

test('passkey refresh preserves the current account workspace without teardown', async () => {
  const calls = [];
  const profile = { id: 'profile-1', username: 'field_user', role: 'Sales Rep' };
  const client = { auth: { signInWithPasskey: async () => ({ data: { session: {
    user: { id: 'profile-1' }, access_token: 'refreshed-token',
  } }, error: null }) } };
  const context = vm.createContext({
    window: { GncLoginTrace: { measure: (_label, fn) => fn(), finish() {} }, BunchQueueShell: { reset: () => calls.push('queue-reset') } },
    document: {}, navigator: {},
    getSupabaseBrowserClient: () => client, startLoginNetworkTrace() {},
    nativeAuthProfile: profile, nativeAuthSessionUserId: 'profile-1', nativeAuthSessionActive: true,
    nativeAuthAccessToken: 'previous-token', nativeAuthReadRequired: false, nativeAuthProfileRestorePending: false,
    currentUser: 'field_user', currentUserDisplay: 'Field User', currentRole: 'Sales Rep', currentUserDivision: '10', currentUserLanguage: 'English', safeRole: 'SALESREP',
    invalidateNativeAuthRecovery() {}, inventoryFieldCountingMode: true,
    destroyFieldCountingIsland: () => calls.push('field-counting-destroyed'),
    destroyHistoricalRequestsIsland: () => calls.push('history-destroyed'),
    loadNativeAuthProfile: async () => ({ ...profile, display_name: 'Field User' }),
    ensureNativeAppSessionBridge: async () => null,
    normalizeAppUserLanguage: value => value,
    beginInitialAppLoad: () => calls.push('initial-load'), finalizeLogin: async () => calls.push('finalize'),
    isNativeAuthSessionRevoked: () => false, isTransientNativeAuthReadFailure: () => false,
    clearRevokedNativeAuthSession: async () => calls.push('revoked-cleanup'),
    showNativeSessionRestorePending: () => calls.push('visible-pending'), showToast: (_title, message) => calls.push(['toast', message]),
  });
  vm.runInContext(passkeyFunctionSource(), context, { filename: 'index.html:signInWithAppPasskey' });
  await vm.runInContext('signInWithAppPasskey()', context);
  assert.equal(vm.runInContext('nativeAuthProfile?.id || null', context), profile.id, JSON.stringify(calls));
  assert.equal(vm.runInContext('nativeAuthSessionUserId', context), profile.id);
  assert.equal(vm.runInContext('nativeAuthAccessToken', context), 'refreshed-token');
  assert.equal(vm.runInContext('inventoryFieldCountingMode', context), true);
  assert.deepEqual(calls, ['initial-load', 'finalize']);
});

test('passkey account switch tears down the previous account workspace before loading the new identity', async () => {
  const calls = [];
  const profile = { id: 'profile-2', username: 'other_user', role: 'Sales Rep' };
  const client = { auth: { signInWithPasskey: async () => ({ data: { session: {
    user: { id: 'profile-2' }, access_token: 'new-account-token',
  } }, error: null }) } };
  const context = vm.createContext({
    window: { GncLoginTrace: { measure: (_label, fn) => fn(), finish() {} }, BunchNote: { reset: () => calls.push('bunch-reset') },
      BunchQueueShell: { reset: () => calls.push('queue-reset') }, SalesWorkspace: { reset: () => calls.push('sales-reset') },
      GncNavigationPreferences: { reset: () => calls.push('navigation-reset') } },
    BunchNote: { reset: () => calls.push('bunch-reset') },
    SalesWorkspace: { reset: () => calls.push('sales-reset') },
    GncNavigationPreferences: { reset: () => calls.push('navigation-reset') },
    document: {}, navigator: {},
    getSupabaseBrowserClient: () => client, startLoginNetworkTrace() {},
    nativeAuthProfile: { id: 'profile-1', username: 'field_user', role: 'Sales Rep' }, nativeAuthSessionUserId: 'profile-1', nativeAuthSessionActive: true,
    nativeAuthAccessToken: 'previous-token', nativeAuthReadRequired: false, nativeAuthProfileRestorePending: false,
    currentUser: 'field_user', currentUserDisplay: 'Field User', currentRole: 'Sales Rep', currentUserDivision: '10', currentUserLanguage: 'English', safeRole: 'SALESREP',
    invalidateNativeAuthRecovery() {}, inventoryFieldCountingMode: true,
    destroyFieldCountingIsland: () => calls.push('field-counting-destroyed'),
    destroyHistoricalRequestsIsland: () => calls.push('history-destroyed'),
    loadNativeAuthProfile: async () => ({ ...profile, display_name: 'Other User' }),
    ensureNativeAppSessionBridge: async () => null,
    normalizeAppUserLanguage: value => value,
    beginInitialAppLoad: () => calls.push('initial-load'), finalizeLogin: async () => calls.push('finalize'),
    isNativeAuthSessionRevoked: () => false, isTransientNativeAuthReadFailure: () => false,
    clearRevokedNativeAuthSession: async () => calls.push('revoked-cleanup'),
    showNativeSessionRestorePending: () => calls.push('visible-pending'), showToast: (_title, message) => calls.push(['toast', message]),
    navigationPreferencesAccount: 'field_user',
  });
  vm.runInContext(passkeyFunctionSource(), context, { filename: 'index.html:signInWithAppPasskey' });
  context.__nextProfile = profile;
  vm.runInContext("loadNativeAuthProfile = async () => { nativeAuthProfile = { ...__nextProfile, display_name: 'Other User' }; return nativeAuthProfile; }", context);
  await vm.runInContext('signInWithAppPasskey()', context);
  assert.equal(vm.runInContext('nativeAuthProfile?.id || null', context), profile.id, JSON.stringify(calls));
  assert.equal(vm.runInContext('nativeAuthSessionUserId', context), profile.id);
  assert.equal(vm.runInContext('currentUser', context), 'other_user');
  assert.equal(vm.runInContext('inventoryFieldCountingMode', context), false);
  for (const expected of ['field-counting-destroyed', 'history-destroyed', 'bunch-reset', 'queue-reset', 'sales-reset', 'navigation-reset', 'initial-load', 'finalize']) {
    assert.ok(calls.includes(expected), `account switch performs ${expected}`);
  }
});
