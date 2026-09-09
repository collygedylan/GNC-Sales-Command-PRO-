import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.search(new RegExp(`(?:async )?function ${name}\\(`));
  const end = html.indexOf('\n        }', start);
  assert.ok(start >= 0 && end > start, name);
  return html.slice(start, end + '\n        }'.length);
}
function fixture() {
  const elements = new Map(), calls = { clears: 0, finalizes: 0, diagnostics: 0, refreshes: 0 };
  function element(id = '') {
    const hidden = new Set();
    const result = { id, style: {}, innerHTML: '', className: '',
      classList: { add: key => hidden.add(key), remove: key => hidden.delete(key), contains: key => hidden.has(key), toggle(key, yes) { if (yes) hidden.add(key); else hidden.delete(key); } },
      remove() { elements.delete(this.id); }, setAttribute() {}, appendChild(child) { elements.set(child.id, child); } };
    if (id) elements.set(id, result);
    return result;
  }
  for (const id of ['view-login', 'app-wrapper', 'loading-spinner', 'login-inputs']) element(id);
  const context = {
    console, Date, NATIVE_AUTH_ENABLED: true,
    currentUser: '', currentRole: '', currentUserDisplay: '', currentUserDivision: '', currentUserLanguage: '', safeRole: '',
    nativeAuthSessionActive: true, nativeAuthProfile: { id: 'profile-a' }, loginShellPreparing: false,
    loginSessionGeneration: 1, loginBootstrapPromise: null, loginBootstrapOwner: null, loginModuleAccessOwner: null, hasAppliedInitialHomeView: false,
    document: { getElementById: id => elements.get(id) || null, createElement: () => element() },
    getCurrentLoginGeneration: () => context.loginSessionGeneration,
    hasExplicitLogoutMarker: () => false, isAppShellVisiblyOpen: () => !elements.get('app-wrapper').classList.contains('hidden'),
    finishInitialAppLoad() {}, clearLoginStartupWatchdog() {}, setBootingSession() {}, clearCachedNativeAuthProfile() {},
    resetProductionLiveSync() {}, beginInitialAppLoad() {}, scheduleLoginStartupWatchdog() {},
    recordNativeSessionRecoveryDiagnostic() { calls.diagnostics++; }, flushNativeSessionRecoveryDiagnostics() {},
    loadNativeAuthProfile: async () => null,
    clearInMemorySessionIdentity() { calls.clears++; context.currentUser = ''; context.invalidateLoginSessionGeneration(); },
    createNativeSessionRecoveryError(code) { return { code, sessionRecovery: true, retryable: ['NATIVE_SESSION_NETWORK', 'NATIVE_SESSION_SERVICE_UNAVAILABLE'].includes(code) }; },
    recoverStaleRequestCapabilities: async () => false, refreshNativeRoleAndCapabilities: async () => { calls.refreshes++; return false; },
    normalizeAppUserLanguage: value => value, ensureNativeAppSessionBridge: async () => null,
    finalizeLogin: async () => { calls.finalizes++; context.clearNativeSessionRecoveryUi(); context.loginShellPreparing = false; },
  };
  vm.createContext(context);
  vm.runInContext('let nativeSessionRecoveryUi = null; let nativeSessionRecoveryPromise = null; let nativeSessionRecoveryLastAttempt = 0;', context);
  for (const name of ['clearNativeSessionRecoveryUi', 'invalidateLoginSessionGeneration', 'beginLoginSessionAttempt', 'handleNativeSessionRecoveryFailure', 'recoverNativeSessionAccess', 'retryNativeSessionRecovery', 'restoreNativeAuthSessionOnStartup']) vm.runInContext(extract(name), context);
  const evaluate = source => vm.runInContext(source, context);
  return { context, elements, calls, evaluate };
}

test('Retry with a confirmed missing session exposes Sign In instead of keeping the retry-only screen', async () => {
  const f = fixture();
  f.context.handleNativeSessionRecoveryFailure(f.context.createNativeSessionRecoveryError('NATIVE_SESSION_NETWORK'));
  assert.equal(f.elements.get('login-inputs').classList.contains('hidden'), true);
  await f.context.recoverNativeSessionAccess('manual-retry', { force: true });
  assert.equal(f.elements.get('login-inputs').classList.contains('hidden'), false);
  assert.match(f.elements.get('native-session-recovery').innerHTML, /Session Ended — Sign In/);
  assert.equal(f.evaluate('nativeSessionRecoveryUi.code'), 'NATIVE_SESSION_REQUIRED');
  assert.equal(f.calls.finalizes, 0);
});

test('Retry while profile service still fails preserves session and displays recovery guidance', async () => {
  const f = fixture();
  f.context.loadNativeAuthProfile = async () => { throw f.context.createNativeSessionRecoveryError('NATIVE_SESSION_SERVICE_UNAVAILABLE'); };
  f.context.handleNativeSessionRecoveryFailure(f.context.createNativeSessionRecoveryError('NATIVE_SESSION_NETWORK'));
  await f.context.recoverNativeSessionAccess('manual-retry', { force: true });
  assert.equal(f.elements.get('login-inputs').classList.contains('hidden'), true);
  assert.match(f.elements.get('native-session-recovery').innerHTML, /Connection Interrupted — Retry/);
  assert.equal(f.context.nativeAuthSessionActive, true);
  assert.equal(f.calls.clears, 0);
  assert.equal(f.calls.finalizes, 0);
});

test('Retry with recovered profile finishes startup without password authentication', async () => {
  const f = fixture();
  f.context.loadNativeAuthProfile = async () => ({ id: 'profile-a', username: 'test-user', role: 'MANAGER' });
  f.context.handleNativeSessionRecoveryFailure(f.context.createNativeSessionRecoveryError('NATIVE_SESSION_NETWORK'));
  assert.equal(await f.context.recoverNativeSessionAccess('manual-retry', { force: true }), true);
  assert.equal(f.calls.finalizes, 1);
  assert.equal(f.calls.clears, 0);
  assert.equal(f.elements.get('native-session-recovery'), undefined);
  assert.equal(f.context.currentUser, 'test-user');
});

test('temporary background permission failure leaves the current authorized view untouched', () => {
  const f = fixture(); f.context.currentUser = 'test-user';
  f.context.handleNativeSessionRecoveryFailure(f.context.createNativeSessionRecoveryError('NATIVE_SESSION_SERVICE_UNAVAILABLE'));
  assert.equal(f.elements.get('app-wrapper').classList.contains('hidden'), false);
  assert.equal(f.elements.get('native-session-recovery'), undefined);
  assert.equal(f.context.currentUser, 'test-user');
  assert.equal(f.calls.clears, 0);
});
