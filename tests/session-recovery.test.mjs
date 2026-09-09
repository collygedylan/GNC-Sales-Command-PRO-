import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function section(start, end) {
    const first = html.indexOf(start), last = html.indexOf(end, first);
    assert.ok(first >= 0 && last > first, start);
    return html.slice(first, last);
}
const core = section('        let nativeAuthSessionActive = false;', '        let bloomscapesPendingState =');
const sessionCode = section('        async function getNativeAuthSession()', '        let mutationBlockedAccessCanaryAuthEnabled');
const headersCode = section('        async function getNativeAuthRequestHeaders()', '        function readCachedNativeAuthProfile');
const profileCode = section('        function readCachedNativeAuthProfile', '        let nativeRoleRefreshPromise');
const watcherCode = section('        function installNativeRoleRefreshWatchers()', "        document.addEventListener('visibilitychange'");
const passwordCode = section('        async function tryNativeAuthPasswordLogin', '        async function ensureNativeAppSessionBridge');
const passkeyCode = section('        async function signInWithAppPasskey(', '        async function registerAppPasskey(');
const roleCode = section('        async function refreshNativeRoleAndCapabilities(', '        function installNativeRoleRefreshWatchers(');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const session = (id = 'profile-a', token = 'token-a') => ({ user: { id }, access_token: token });
const profile = (id = 'profile-a') => ({ id, username: id, display_name: id, role: 'MANAGER', disabled_at: null, locked_until: null });

function fixture() {
    const writes = [], diagnostics = [], timers = new Map(), calls = { session: 0, profile: 0, signIn: 0, signOut: 0, refresh: 0, reset: 0, finalized: [], passwordGates: [], failures: [] };
    let timerId = 0, loginGeneration = 1, callback, sessionResult = { data: { session: session() }, error: null }, profileResult = { data: profile(), error: null };
    const client = {
        auth: {
            getSession: async () => { calls.session++; return typeof sessionResult === 'function' ? sessionResult() : sessionResult; },
            signInWithPassword: async () => { calls.signIn++; return { data: { session: session() }, error: null }; },
            signInWithPasskey: async () => ({ data: { session: session() }, error: null }),
            signOut: async () => { calls.signOut++; },
            refreshSession: async () => { calls.refresh++; return { data: { session: session() }, error: null }; },
            onAuthStateChange: cb => { callback = cb; return { data: { subscription: { unsubscribe() {} } } }; }
        },
        from: table => {
            assert.equal(table, 'profiles');
            const query = { select() { return this; }, eq() { return this; }, abortSignal() { return this; }, maybeSingle() { calls.profile++; return typeof profileResult === 'function' ? profileResult() : Promise.resolve(profileResult); } };
            return query;
        }
    };
    const storage = new Map();
    const ctx = {
        NATIVE_AUTH_ENABLED: true, SUPABASE_KEY: 'publishable-fixture', NATIVE_AUTH_PROFILE_CACHE_KEY: 'profile-cache',
        navigator: { onLine: true }, window: {}, console: { warn() {} }, AbortController,
        getCurrentLoginGeneration: () => loginGeneration,
        getSupabaseBrowserClient: () => client,
        closeBloomscapesPendingOrders() {}, syncPasskeyPilotUi() {}, canViewBloomscapesPendingOrders: () => false,
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => { writes.push([key, value]); storage.set(key, value); }, removeItem: key => storage.delete(key) },
        setTimeout: (cb, delay) => { const id = ++timerId; timers.set(id, { cb, delay }); return id; },
        clearTimeout: id => timers.delete(id),
        normalizeNativeAuthAlias: value => `${value}@example.test`,
        mutationBlockedAccessCanaryAuthEnabled: false, hasMutationBlockedCanaryQuery: () => false,
        recordNativeSessionRecoveryDiagnostic: (error, stage) => diagnostics.push({ code: error.code, stage }),
        resetProductionLiveSync() {}, clearInMemorySessionIdentity: () => { loginGeneration++; ctx.invalidateNativeAuthRecovery(); },
        resetLoginUiState: () => { calls.reset++; },
        refreshNativeRoleAndCapabilities: async () => false,
        signalProductionLiveSync() {}
    };
    Object.assign(ctx, {
        currentUser: '', currentUserDisplay: '', currentRole: '', currentUserDivision: '10', currentUserLanguage: 'English', safeRole: '',
        loginShellPreparing: false, normalizeAppUserLanguage: value => value,
        normalizeRoleAccessToken: value => String(value).toLowerCase(),
        beginLoginSessionAttempt: () => { loginGeneration++; ctx.invalidateNativeAuthRecovery(); ctx.loginShellPreparing = true; return loginGeneration; },
        ensureNativeAppSessionBridge: async () => null,
        beginInitialAppLoad() {}, clearLoginStartupWatchdog() {}, showToast() {},
        clearExplicitLogoutMarker: () => { calls.logoutMarkerCleared = true; },
        finalizeLogin: async user => { calls.finalized.push(user); },
        showForcedPasswordChangeGate: user => calls.passwordGates.push(user),
        handleNativeSessionRecoveryFailure: error => { calls.failures.push(error.code); return true; }
    });
    vm.createContext(ctx);
    vm.runInContext(core + sessionCode + headersCode + profileCode + watcherCode + passwordCode + passkeyCode + '\nthis.authState = () => ({ active: nativeAuthSessionActive, token: nativeAuthAccessToken, profile: nativeAuthProfile, userId: nativeAuthSessionUserId }); this.seedProfile = value => { nativeAuthProfile = value; };', ctx);
    return { ctx, client, calls, writes, diagnostics, timers, storage,
        setSession: value => { sessionResult = value; }, setProfile: value => { profileResult = value; },
        advanceLogin: () => { loginGeneration++; ctx.invalidateNativeAuthRecovery(); },
        emit: (event, value) => callback(event, value),
        flushEvents: async () => { for (const [id, timer] of [...timers]) if (!timer.delay) { timers.delete(id); await timer.cb(); } }
    };
}

test('503 profile failure after successful password sign-in retains session and never signs out', async () => {
    const f = fixture(); f.setProfile({ data: null, error: { status: 503, message: 'upstream unavailable' } });
    await assert.rejects(f.ctx.tryNativeAuthPasswordLogin('profile-a', 'fixture-password'), error => error.code === 'NATIVE_SESSION_SERVICE_UNAVAILABLE' && error.retryable === true);
    assert.equal(f.calls.signIn, 1); assert.equal(f.calls.signOut, 0);
    assert.equal(f.ctx.authState().active, true); assert.equal(f.ctx.authState().token, 'token-a');
    f.setProfile({ data: profile(), error: null });
    assert.equal((await f.ctx.loadNativeAuthProfile(true)).username, 'profile-a');
    assert.equal(f.calls.signIn, 1, 'profile retry does not repeat password login');
});

test('network getSession failure preserves current credentials and does not launch refresh requests', async () => {
    const f = fixture(); f.ctx.adoptNativeAuthSession(session()); f.ctx.seedProfile(profile());
    f.setSession(() => Promise.reject(new TypeError('Failed to fetch')));
    await assert.rejects(f.ctx.getNativeAuthRequestHeaders(), error => error.code === 'NATIVE_SESSION_NETWORK');
    assert.equal(f.ctx.authState().active, true); assert.equal(f.ctx.authState().profile.id, 'profile-a');
    assert.equal(f.calls.refresh, 0); assert.equal(f.calls.signOut, 0);
});

test('confirmed missing session is distinct from network failure and never starts a redundant refresh', async () => {
    const f = fixture(); f.ctx.adoptNativeAuthSession(session()); f.setSession({ data: { session: null }, error: null });
    assert.equal(await f.ctx.getNativeAuthRequestHeaders(), null);
    assert.equal(f.ctx.authState().active, false); assert.equal(f.calls.refresh, 0); assert.equal(f.calls.signOut, 0);
});

test('TOKEN_REFRESHED adopts valid credentials before starting recovery', async () => {
    const f = fixture(); const seen = [];
    f.ctx.recoverNativeSessionAccess = async () => seen.push(f.ctx.authState());
    f.ctx.installNativeRoleRefreshWatchers(); f.emit('TOKEN_REFRESHED', session('profile-a', 'new-token'));
    assert.equal(f.ctx.authState().active, true); assert.equal(f.ctx.authState().token, 'new-token');
    assert.equal(seen.length, 0); await f.flushEvents();
    assert.equal(seen.length, 1); assert.equal(seen[0].token, 'new-token');
    assert.equal(f.calls.reset, 0);
});

test('late getSession response cannot overwrite a newer token auth event', async () => {
    const f = fixture(); const gate = deferred(); f.ctx.adoptNativeAuthSession(session());
    f.setSession(() => gate.promise); const pending = f.ctx.getNativeAuthSession();
    f.ctx.adoptNativeAuthSession(session('profile-a', 'new-token'), true);
    gate.resolve({ data: { session: session('profile-a', 'old-token') }, error: null });
    assert.equal((await pending).access_token, 'new-token'); assert.equal(f.ctx.authState().token, 'new-token');
});

test('late failed session read cannot undo a successful token-refresh event', async () => {
    const f = fixture(), gate = deferred(); f.ctx.adoptNativeAuthSession(session());
    f.setSession(() => gate.promise); const pending = f.ctx.getNativeAuthSession();
    f.ctx.adoptNativeAuthSession(session('profile-a', 'new-token'), true);
    gate.reject(new TypeError('Failed to fetch'));
    assert.equal((await pending).access_token, 'new-token');
    assert.equal(f.ctx.authState().active, true); assert.equal(f.diagnostics.length, 0);
});

test('concurrent session and profile reads share one request each', async () => {
    const f = fixture(), gate = deferred(); f.setProfile(() => gate.promise);
    const reads = Array.from({ length: 30 }, () => f.ctx.loadNativeAuthProfile(true)); await settle();
    assert.equal(f.calls.session, 1); assert.equal(f.calls.profile, 1);
    gate.resolve({ data: profile(), error: null }); const results = await Promise.all(reads);
    assert.equal(results.length, 30); assert.equal(f.writes.length, 1);
});

test('logout invalidates pending session and profile replies without repopulating any identity', async () => {
    for (const target of ['session', 'profile']) {
        const f = fixture(), gate = deferred();
        if (target === 'session') f.setSession(() => gate.promise); else f.setProfile(() => gate.promise);
        const pending = target === 'session' ? f.ctx.getNativeAuthSession() : f.ctx.loadNativeAuthProfile(true);
        await settle(); f.advanceLogin(); gate.resolve(target === 'session' ? { data: { session: session() }, error: null } : { data: profile(), error: null });
        await assert.rejects(pending, error => error.code === 'NATIVE_SESSION_SUPERSEDED');
        assert.equal(f.ctx.authState().active, false); assert.equal(f.ctx.authState().profile, null); assert.equal(f.writes.length, 0);
    }
});

test('old account profile completion cannot overwrite a new account or clear its pending profile read', async () => {
    const f = fixture(), first = deferred(), second = deferred(); f.setProfile(() => first.promise);
    const old = f.ctx.loadNativeAuthProfile(true); await settle();
    f.ctx.adoptNativeAuthSession(session('profile-b', 'token-b'), true);
    f.setSession({ data: { session: session('profile-b', 'token-b') }, error: null }); f.setProfile(() => second.promise);
    const current = f.ctx.loadNativeAuthProfile(true); await settle();
    first.resolve({ data: profile(), error: null }); await assert.rejects(old, error => error.code === 'NATIVE_SESSION_SUPERSEDED');
    const joined = f.ctx.loadNativeAuthProfile(true); await settle(); assert.equal(f.calls.profile, 2);
    second.resolve({ data: profile('profile-b'), error: null }); await Promise.all([current, joined]);
    assert.equal(f.ctx.authState().profile.id, 'profile-b'); assert.equal(f.writes.length, 1);
});

test('disabled, locked, missing, and forbidden profiles stay denied without global sign-out', async () => {
    const cases = [
        [{ data: { ...profile(), disabled_at: new Date().toISOString() }, error: null }, 'NATIVE_PROFILE_DISABLED'],
        [{ data: { ...profile(), locked_until: new Date(Date.now() + 60000).toISOString() }, error: null }, 'NATIVE_PROFILE_LOCKED'],
        [{ data: null, error: null }, 'NATIVE_PROFILE_DENIED'],
        [{ data: null, error: { status: 403, code: '42501', message: 'private provider details' } }, 'NATIVE_PROFILE_DENIED']
    ];
    for (const [result, code] of cases) {
        const f = fixture(); f.setProfile(result);
        await assert.rejects(f.ctx.tryNativeAuthPasswordLogin('profile-a', 'fixture-password'), error => error.code === code && !error.retryable && !error.message.includes('provider'));
        assert.equal(f.ctx.authState().profile, null); assert.equal(f.calls.signOut, 0);
    }
});

test('profile timeout is retryable, does not clear the session, and late completion cannot save a profile', async () => {
    const f = fixture(), gate = deferred(); f.setProfile(() => gate.promise);
    const pending = f.ctx.loadNativeAuthProfile(true); await settle();
    const timer = [...f.timers.values()].find(timer => timer.delay === 12000); assert.ok(timer); timer.cb();
    await assert.rejects(pending, error => error.code === 'NATIVE_SESSION_TIMEOUT' && error.retryable);
    gate.resolve({ data: profile(), error: null }); await settle();
    assert.equal(f.ctx.authState().active, true); assert.equal(f.ctx.authState().profile, null); assert.equal(f.writes.length, 0);
});

test('an online device with a failed read does not claim cached profile data is freshly verified', async () => {
    const f = fixture(); f.ctx.adoptNativeAuthSession(session()); f.ctx.seedProfile(profile());
    f.setProfile({ data: null, error: { status: 503, message: 'temporary failure' } });
    await assert.rejects(f.ctx.loadNativeAuthProfile(true), error => error.retryable);
    assert.equal(f.ctx.authState().profile.id, 'profile-a', 'previously verified UI can remain while freshness fails');
    assert.equal(f.writes.length, 0);
});

test('auth event deferred recovery cannot survive a subsequent SIGNED_OUT event', async () => {
    const f = fixture(); let recoveries = 0; f.ctx.recoverNativeSessionAccess = async () => recoveries++;
    f.ctx.installNativeRoleRefreshWatchers(); f.emit('SIGNED_IN', session()); f.emit('SIGNED_OUT', null); await f.flushEvents();
    assert.equal(recoveries, 0); assert.equal(f.ctx.authState().active, false); assert.equal(f.calls.reset, 1);
});

test('revoked refresh token is not classified as an offline retry and no global sign-out occurs', async () => {
    const f = fixture(); f.setSession({ data: { session: null }, error: { status: 400, code: 'refresh_token_not_found' } });
    await assert.rejects(f.ctx.loadNativeAuthProfile(true), error => error.code === 'NATIVE_SESSION_REVOKED' && !error.retryable);
    assert.equal(f.calls.signOut, 0); assert.equal(f.calls.refresh, 0);
});

test('password transport failures cannot fall through to legacy credentials', async () => {
    const f = fixture(); f.client.auth.signInWithPassword = async () => ({ data: null, error: { status: 503 } });
    await assert.rejects(f.ctx.tryNativeAuthPasswordLogin('profile-a', 'fixture-password'), error => error.retryable && error.sessionRecovery);
    f.client.auth.signInWithPassword = async () => ({ data: null, error: { status: 400, code: 'invalid_credentials' } });
    assert.equal(await f.ctx.tryNativeAuthPasswordLogin('profile-a', 'fixture-password'), null);
});

test('passkey bridge continuation cannot repopulate identity after logout or account switching', async () => {
    for (const switchedUser of ['', 'profile-b']) {
        const f = fixture(), bridge = deferred(); f.ctx.ensureNativeAppSessionBridge = () => bridge.promise;
        const pending = f.ctx.signInWithAppPasskey(); await settle();
        f.advanceLogin(); f.ctx.currentUser = switchedUser;
        bridge.resolve(null); await pending;
        assert.equal(f.ctx.currentUser, switchedUser); assert.deepEqual(f.calls.finalized, []); assert.deepEqual(f.calls.failures, []);
    }
});

test('passkey transport and profile continuations cannot adopt a superseded login', async () => {
    for (const stage of ['auth', 'profile']) {
        const f = fixture(), gate = deferred();
        if (stage === 'auth') f.client.auth.signInWithPasskey = () => gate.promise;
        else f.setProfile(() => gate.promise);
        const pending = f.ctx.signInWithAppPasskey(); await settle(); f.advanceLogin(); f.ctx.currentUser = 'profile-b';
        gate.resolve(stage === 'auth' ? { data: { session: session() }, error: null } : { data: profile(), error: null });
        await pending; assert.equal(f.ctx.currentUser, 'profile-b'); assert.deepEqual(f.calls.finalized, []);
    }
});

test('passkey required password change uses the existing gate instead of opening Home', async () => {
    const f = fixture(); f.setProfile({ data: { ...profile(), must_change_password: true }, error: null });
    await f.ctx.signInWithAppPasskey();
    assert.deepEqual(f.calls.passwordGates, ['profile-a']); assert.deepEqual(f.calls.finalized, []);
    assert.equal(f.ctx.loginShellPreparing, false); assert.equal(f.ctx.authState().active, true);
});

test('passkey profile transient failures retain the session for connection recovery', async () => {
    const f = fixture(); f.setProfile({ data: null, error: { status: 503 } });
    await f.ctx.signInWithAppPasskey();
    assert.deepEqual(f.calls.failures, ['NATIVE_SESSION_SERVICE_UNAVAILABLE']); assert.deepEqual(f.calls.finalized, []);
    assert.equal(f.ctx.authState().active, true); assert.equal(f.calls.signOut, 0);
    assert.equal(f.calls.logoutMarkerCleared, true, 'a deliberate passkey login permits recovery after an earlier logout');
});

test('foreground confirmed session loss without SIGNED_OUT invokes terminal recovery', async () => {
    const f = fixture(); f.ctx.adoptNativeAuthSession(session()); f.ctx.seedProfile(profile());
    f.ctx.currentUser = 'profile-a'; f.ctx.currentRole = 'MANAGER'; f.ctx.nativeRoleRefreshPromise = null; f.ctx.nativeRoleRefreshOwner = null;
    f.setSession({ data: { session: null }, error: null }); vm.runInContext(roleCode, f.ctx);
    await f.ctx.refreshNativeRoleAndCapabilities('foreground');
    assert.deepEqual(f.calls.failures, ['NATIVE_SESSION_REQUIRED']); assert.equal(f.ctx.authState().active, false);
});

test('foreground old-session loss cannot mark a newer account as signed out', async () => {
    const f = fixture(), gate = deferred(); f.ctx.adoptNativeAuthSession(session()); f.ctx.seedProfile(profile());
    f.ctx.currentUser = 'profile-a'; f.ctx.currentRole = 'MANAGER'; f.ctx.nativeRoleRefreshPromise = null; f.ctx.nativeRoleRefreshOwner = null;
    f.setSession(() => gate.promise); vm.runInContext(roleCode, f.ctx);
    const pending = f.ctx.refreshNativeRoleAndCapabilities('foreground'); await settle();
    f.advanceLogin(); f.ctx.currentUser = 'profile-b'; f.ctx.adoptNativeAuthSession(session('profile-b', 'token-b'));
    gate.resolve({ data: { session: null }, error: null }); await pending;
    assert.deepEqual(f.calls.failures, []); assert.equal(f.ctx.authState().userId, 'profile-b'); assert.equal(f.ctx.authState().active, true);
});
