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
const ownership = section('        let loginSessionGeneration = 0;', '        function clearLoginStartupWatchdog()');
const accessLoader = section('        async function initializeAppAccessSnapshot(', '        function normalizeRequestCapabilities(');
const requestLoader = section('        async function initializeRequestCapabilities(', '        function retryRequestCapabilities(');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

function fixture() {
    const calls = [], writes = [], timers = [], renders = [];
    const ctx = {
        currentUser: 'fixture_a', currentRole: 'REP', currentUserDivision: '10', nativeAuthSessionActive: true,
        nativeAuthProfile: { id: 'profile-a' }, hasAppliedInitialHomeView: false,
        navigator: { onLine: true }, activeHomeTab: 'dashboard', MANAGER_ACCESS_CONTROL_VIEW: 'access-control',
        appAccessSnapshotState: {}, requestCapabilityState: {}, appAccessSnapshotLoadPromise: null, requestCapabilityLoadPromise: null,
        getRequestCapabilityUsernameKey: value => value,
        readCachedAppAccessSnapshot: () => null, readCachedRequestCapabilities: () => null,
        normalizeAppAccessSnapshot: (value, username) => value?.username === username ? value : null,
        normalizeRequestCapabilities: (value, username) => value?.username === username ? value : null,
        persistAppAccessSnapshot: value => writes.push(['access', value.username]),
        persistRequestCapabilities: value => writes.push(['request', value.username]),
        reportSemanticHealthEvent() {}, isAppShellVisiblyOpen: () => true,
        getRoleAccessState: () => ({ isRep: true, isAdmin: false }),
        normalizeRoleAccessToken: value => String(value).trim().toUpperCase(),
        getAppAccessSnapshot: () => ctx.appAccessSnapshotState.username === ctx.currentUser ? ctx.appAccessSnapshotState.snapshot : null,
        applyRolePermissions: () => renders.push('role'), refreshRequestCapabilityUi: () => renders.push('request'),
        setTimeout: callback => { timers.push(callback); return timers.length; },
        supabaseRpc: name => { const gate = deferred(); calls.push({ name, gate }); return gate.promise; }
    };
    vm.createContext(ctx);
    vm.runInContext(ownership + accessLoader + requestLoader + '\nthis.setPreparing = value => { loginShellPreparing = value; }; this.setAccessOwner = () => { loginModuleAccessOwner = captureLoginSessionOwnership(); };', ctx);
    return { ctx, calls, writes, timers, renders };
}

for (const [name, method, stateKey, valueKey, promiseKey] of [
    ['module access', 'initializeAppAccessSnapshot', 'appAccessSnapshotState', 'snapshot', 'appAccessSnapshotLoadPromise'],
    ['Request access', 'initializeRequestCapabilities', 'requestCapabilityState', 'capabilities', 'requestCapabilityLoadPromise']
]) {
    test(`${name}: an old account response cannot overwrite or persist current permissions`, async () => {
        const f = fixture();
        const old = f.ctx[method]({ force: true, render: false });
        f.ctx.currentUser = 'fixture_b'; f.ctx.nativeAuthProfile = { id: 'profile-b' };
        const current = f.ctx[method]({ force: true, render: false });
        f.calls[1].gate.resolve({ username: 'fixture_b', role: 'REP', canViewQueue: false }); await current;
        f.calls[0].gate.resolve({ username: 'fixture_a', role: 'REP', canViewQueue: true }); await old;
        assert.equal(f.ctx[stateKey].username, 'fixture_b');
        assert.equal(f.ctx[stateKey][valueKey].canViewQueue, false);
        assert.deepEqual(f.writes.map(entry => entry[1]), ['fixture_b']);
    });

    test(`${name}: an old failure cannot clear a newer in-flight request`, async () => {
        const f = fixture(); const old = f.ctx[method]({ force: true, render: false });
        const current = f.ctx[method]({ force: true, render: false });
        const active = f.ctx[promiseKey];
        f.calls[0].gate.reject(new Error('old connection failed')); await old;
        assert.equal(f.ctx[promiseKey], active); assert.equal(f.ctx[stateKey].status, 'loading');
        f.calls[1].gate.resolve({ username: 'fixture_a', role: 'REP' }); await current;
        assert.equal(f.ctx[stateKey].status, 'ready');
    });

    test(`${name}: logout invalidates success and failure continuations`, async () => {
        for (const fail of [false, true]) {
            const f = fixture(); const pending = f.ctx[method]({ force: true, render: false });
            f.ctx.invalidateLoginSessionGeneration(); f.ctx.currentUser = '';
            if (fail) f.calls[0].gate.reject(new Error('late failure'));
            else f.calls[0].gate.resolve({ username: 'fixture_a', role: 'REP' });
            await pending;
            assert.equal(f.ctx[stateKey].status, 'loading'); assert.deepEqual(f.writes, []); assert.deepEqual(f.renders, []);
        }
    });
}

test('module access does not reveal or repaint the app while bootstrap prepares it', async () => {
    const f = fixture(); f.ctx.setPreparing(true);
    const pending = f.ctx.initializeAppAccessSnapshot({ force: true });
    f.calls[0].gate.resolve({ username: 'fixture_a', role: 'REP' }); await pending;
    assert.deepEqual(f.timers, []); assert.deepEqual(f.renders, []);
});

test('authentication attempts suppress ambient live reads before finalizeLogin starts', () => {
    const f = fixture();
    vm.runInContext(section('        function canUseProductionLiveSync()', '        function createProductionCoreLiveAdapter('), f.ctx);
    f.ctx.window = { AgMetricLiveSync: {}, AgMetricLiveSyncRegistry: {} };
    f.ctx.nativeAuthProfile.username = f.ctx.currentUser;
    assert.equal(f.ctx.canUseProductionLiveSync(), true);
    f.ctx.beginLoginSessionAttempt();
    assert.equal(f.ctx.canUseProductionLiveSync(), false);
    f.ctx.setPreparing(false);
    assert.equal(f.ctx.canUseProductionLiveSync(), true);
});

test('profile-backed role families do not gain or lose module authority through the snapshot availability guard', () => {
    const f = fixture(); f.ctx.setAccessOwner();
    for (const role of [{ isAdmin: true }, { isEval: true }, { isGrower: true }, { isDivision: true }]) {
        f.ctx.getRoleAccessState = () => role;
        assert.equal(f.ctx.isLoginModuleAccessBlocked(), false);
    }
    for (const role of [{ isRep: true }, { isCsr: true }, { isSalesMarketing: true }]) {
        f.ctx.getRoleAccessState = () => role;
        assert.equal(f.ctx.isLoginModuleAccessBlocked(), true);
    }
});

test('a scheduled permission repaint cannot survive logout', async () => {
    const f = fixture(); const pending = f.ctx.initializeAppAccessSnapshot({ force: true });
    f.calls[0].gate.resolve({ username: 'fixture_a', role: 'REP' }); await pending;
    assert.equal(f.timers.length, 1);
    f.ctx.invalidateLoginSessionGeneration(); f.timers.forEach(callback => callback());
    assert.deepEqual(f.renders, []);
});

test('module access fails closed while online but retains matching saved offline permissions', () => {
    const f = fixture(); f.ctx.setAccessOwner();
    f.ctx.appAccessSnapshotState = { username: 'fixture_a', status: 'ready', stale: true, snapshot: { username: 'fixture_a', role: 'REP' } };
    assert.equal(f.ctx.isLoginModuleAccessBlocked(), true);
    f.ctx.navigator.onLine = false;
    assert.equal(f.ctx.isLoginModuleAccessBlocked(), false);
    f.ctx.appAccessSnapshotState.snapshot.role = 'ADMIN';
    assert.equal(f.ctx.isLoginModuleAccessBlocked(), true);
});

test('a role change does not disengage the module access guard before replacement permissions arrive', () => {
    const f = fixture(); f.ctx.setAccessOwner();
    const owner = f.ctx.captureLoginSessionOwnership();
    f.ctx.appAccessSnapshotState = { username: 'fixture_a', status: 'ready', stale: false, snapshot: { username: 'fixture_a', role: 'REP' } };
    f.ctx.currentRole = 'CSR';
    assert.equal(f.ctx.isLoginSessionOwnershipCurrent(owner), false);
    assert.equal(f.ctx.isLoginSessionIdentityCurrent(owner), true);
    assert.equal(f.ctx.isLoginModuleAccessBlocked(), true);
    vm.runInContext(section('        function canAccessView(', '        function isSalesShellAccess('), f.ctx);
    assert.equal(f.ctx.canAccessView('home'), true);
    assert.equal(f.ctx.canAccessView('detail'), false);
    f.ctx.appAccessSnapshotState.snapshot.role = 'CSR';
    assert.equal(f.ctx.isLoginModuleAccessBlocked(), false);
    assert.equal(f.ctx.canAccessView('detail'), true);
});

test('native login does not schedule a second password sign-in and stale legacy validation does not start', async () => {
    const f = fixture(); let reads = 0;
    Object.assign(f.ctx, { normalizeSessionIdentity: value => value, fetchRemoteLoginUser: async () => { reads++; return null; } });
    vm.runInContext(section('        function scheduleBackgroundLoginValidation(', '        function getLoginReadHeaders('), f.ctx);
    f.ctx.scheduleBackgroundLoginValidation('fixture_a', 'synthetic-password');
    assert.equal(f.timers.length, 0);
    f.ctx.nativeAuthSessionActive = false;
    f.ctx.scheduleBackgroundLoginValidation('fixture_a', 'synthetic-password');
    assert.equal(f.timers.length, 1);
    f.ctx.invalidateLoginSessionGeneration(); await f.timers[0]();
    assert.equal(reads, 0);
});

test('bootstrap is single-flight, checks access concurrently, and opens before background assignments', async () => {
    const f = fixture(); const paints = []; const events = [];
    Object.assign(f.ctx, {
        currentUserDisplay: 'Fixture', currentUserLanguage: 'English', currentProgress: 0,
        LOGIN_DISPLAY_NAME_STORAGE_KEY: 'fixture-display', VERIFIED_LOGIN_STORAGE_KEY: 'fixture-verified',
        localStorage: { setItem() {}, removeItem() {} }, document: { getElementById: () => ({ innerText: '' }) },
        clearExplicitLogoutMarker() {}, normalizeAppUserLanguage: value => value, applyCurrentUserLanguagePreference() {}, setLoginProgress() {},
        applyCurrentUserMasterInventoryScope() {}, registerAppFilterStatePersistence() {}, restorePersistedAppFilterStateForCurrentUser() {},
        isTouchConstrainedDevice: () => true, hasWarmAppData: () => true, reservesInventory: [],
        openAppShellAfterLogin: () => { events.push('shell'); return true; },
        runAfterShellInteractive: callback => paints.push(callback),
        loadEvalWorkAssignments: () => { events.push('assignments'); return Promise.reject(new Error('unrelated data failed')); }
    });
    vm.runInContext(section('        function finalizeLogin(', '        async function silentBackgroundSync('), f.ctx);
    const one = f.ctx.finalizeLogin('fixture_a', '', false), two = f.ctx.finalizeLogin('fixture_a', '', false);
    assert.equal(one, two); assert.equal(f.calls.length, 2);
    f.calls.find(entry => entry.name === 'get_request_capabilities').gate.reject(new Error('Request service unavailable'));
    f.calls.find(entry => entry.name === 'get_my_app_permissions_v1').gate.resolve({ username: 'fixture_a', role: 'REP' });
    await settle();
    assert.deepEqual(events, ['shell']); assert.equal(paints.length, 1);
    f.ctx.invalidateLoginSessionGeneration(); paints[0]();
    assert.equal(await one, false); assert.deepEqual(events, ['shell']);
});
