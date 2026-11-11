import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const read = file => fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const runtime = read('assets/app-runtime.js');
export const navigationFixtureRuntime = runtime;
function sourceFunction(name) {
    const match = runtime.match(new RegExp('^( *)(?:async )?function ' + name + '\\([^]*?^\\1}', 'm'));
    assert.ok(match, name);
    return match[0];
}

function contextDefaults(username, role, document, storage) {
    return {
        window: { document, localStorage: storage, addEventListener() {}, SalesWorkspace: { isView: () => false } },
        document, console, currentUser: username, currentUserDisplay: username, currentRole: role, safeRole: role, currentPrimaryViewId: 'detail',
        nativeAuthSessionActive: true, nativeAuthSessionUserId: 'profile-1',
        nativeAuthProfile: { id: 'profile-1', username, role, active: true },
        hasExplicitLogoutMarker: () => false, hasConfirmedCurrentAccountRevocation: () => false,
        hasAuthenticatedOperationalReadIdentity: () => true,
        getRequestCapabilityUsernameKey: value => String(value || '').trim().toLowerCase(),
        appAccessSnapshotState: { status: 'idle', stale: true },
        APP_SESSION_RECORD_STORAGE_KEY: 'gnc_app_session_v1', currentAppSessionToken: '', currentAppSessionExpiresAt: 0,
        opsPilotInitializedSessionToken: '', nativeAuthReadRequired: false, NATIVE_AUTH_ENABLED: true,
        nativeAuthRecoveryEpoch: 1, APP_API_FUNCTION_URL: 'https://fixture.invalid/app-api',
        firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim()) || '',
        isEvalSensitiveDataRestricted: () => false, isPrivilegedManagerUser: () => false,
        canUseRequestRepScopedAccess: () => false, canUseMovesModule: () => false,
        isExecutiveAccessUser: () => false, getRequestCapabilities: () => null,
        canSeeEvalWorkRequestTab: () => false, canonicalFeaturePermission: () => null,
        getAppAccessSnapshot: () => null, getAuditedAppPermission: () => null,
        canUseInvBunchNotes: () => false, canUseHistoricalRequests: () => true, canUseHlOrder: () => true,
        canViewManagerSalesReps: () => false, buildFastInvokeAttrs: () => '', scheduleHomeDashboardFitSettle() {},
        configureNavigationPreferences() {}, scheduleIosBottomNavViewportLock() {},
        selectedItems: new Set(), cartPanelOpen: false, navTransitionSeq: 0,
        shouldPreserveMountedBootView: () => false, getAppBootViewState: () => ({}),
        persistAppFilterStateNow() {}, isDrawerOpen: () => false, getMainAreaScrollTop: () => 0,
        cancelScheduledViewRenderWork() {}, cancelChunkRenderWorkForView() {}, pushViewHistoryEntry() {},
        cancelManagerModuleReads() {}, syncGlobalHeaderChrome() {}, repairAppShellScrollState() {},
        queueScrollMainAreaToTop() {}, ensureNativeBackGuard() {}, setMainAreaScrollTop() {}, showToast() {}
    };
}

function loadRuntimeOwners(context) {
    const start = runtime.indexOf('        const ROLE_ACCESS_VIEWS =');
    const end = runtime.indexOf('        function normalizeRoleAccessToken', start);
    vm.runInContext(runtime.slice(start, end), context);
    const names = ['normalizeRoleAccessToken', 'isEvalRoleValue', 'isDivisionRoleValue', 'isSalesMarketingRoleValue',
        'getCurrentRoleAccessValue', 'normalizeMovesUserKey', 'isManagerViewDeniedUser', 'getRoleAccessState',
        'isSuperAdminRoleValue', 'isFullAppAdministrator', 'isAuthenticatedExecutiveUser', 'hasExplicitViewPermission',
        'navigationPreferencesAllowed', 'canAccessView', 'isSalesShellAccess', 'canAccessQuickAccessView',
        'syncRoleAccessUi', 'syncDrawerPresentation', 'updateFooterNavState', 'shouldRedirectForConfirmedViewDenial', 'configureCanonicalUserAccess',
        'readPersistedAppSessionRecord', 'persistAppSessionRecord', 'getAppSessionDisplayProfileId', 'getCurrentAppSessionToken', 'ensureNativeAppSessionBridge'];
    for (const name of names) vm.runInContext(sourceFunction(name), context);
    const nested = runtime.match(/        const QUICK_ACCESS_NESTED_ROUTES = Object\.freeze\(\{[^]*?        \}\);/);
    assert.ok(nested);
    vm.runInContext(nested[0], context);
}

export async function startNavigationMatrixArrival(fixture, { initialized = false } = {}) {
    const { context } = fixture;
    const rendered = [], activated = [], restored = [], scheduled = [], states = new Map();
    let deliver;
    const pending = new Promise(resolve => { deliver = resolve; });
    context.canonicalUserAccessAccount = ''; context.canonicalUserAccessRevision = 0;
    context.supabaseClient = { from: () => ({ select() { return this; }, order() { return this; }, limit: () => pending }) };
    context.getRequestMappedRepDirectory = () => ({ options: [] });
    context.postAppFunctionJson = async () => { throw new Error('offline'); };
    context.filterRepList = () => {}; context.invalidateRequestViewResolvedCaches = () => {};
    context.isViewVisible = view => context.currentPrimaryViewId === view;
    context.scheduleRequestRender = () => {}; context.applyRolePermissions = () => context.syncRoleAccessUi();
    context.getMainAreaScrollTop = () => 83;
    context.ensureViewRenderState = view => {
        if (!states.has(view)) states.set(view, { initialized, dirty: false });
        return states.get(view);
    };
    context.prepareLatestViewRender = () => 1; context.isLatestViewRenderToken = () => true;
    context.isCurrentNavigationTransition = (sequence, view) => sequence === context.navTransitionSeq && view === context.currentPrimaryViewId;
    context.renderViewContent = (...args) => rendered.push(args);
    context.scheduleViewActivationWork = view => activated.push(view);
    context.schedulePostRenderMainAreaScrollRestore = (...args) => restored.push(args);
    context.scheduleUiRender = (key, callback) => { scheduled.push(key); callback(); };
    await context.configureCanonicalUserAccess();
    return { rendered, activated, restored, scheduled, deliver: async rows => {
        deliver({ data: rows, error: null });
        await new Promise(resolve => setImmediate(resolve));
    } };
}

export function navigationVisibilityFixture({ username = 'worker', role = 'standard', storage = new Map(), sessionRecord = null, legacy = false } = {}) {
    const dom = new JSDOM(read('index.html'), { url: 'https://navigation.fixture/' });
    const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
    const context = vm.createContext(contextDefaults(username, role, dom.window.document, localStorage));
    const session = new Map();
    if (sessionRecord) session.set('gnc_app_session_v1', JSON.stringify(sessionRecord));
    context.sessionStorage = { getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) };
    context.getCurrentVisibleViewId = () => context.currentPrimaryViewId;
    context.getViewElementById = view => dom.window.document.getElementById('view-' + view);
    context.showOnlyPrimaryView = view => { context.currentPrimaryViewId = view; };
    context.setMenuOpenState = value => { context.menuOpen = value; };
    for (const file of ['access-display-cache', 'navigation-visibility', 'navigation-routing']) {
        vm.runInContext(read('src/ui/' + file + '.js').replace(/^export /gm, ''), context);
    }
    vm.runInContext(read('assets/user-access-control.js'), context);
    context.resolveUserAccessMatrix = (...args) => context.window.GncUserAccessControl.resolveUserAccessMatrix(...args);
    loadRuntimeOwners(context);
    if (legacy) {
        context.nativeAuthSessionActive = false; context.nativeAuthProfile = null; context.nativeAuthSessionUserId = '';
        vm.runInContext(sourceFunction('hasAuthenticatedOperationalReadIdentity'), context);
    }
    vm.runInContext(read('assets/navigation-preferences.js'), context);
    const preferences = context.window.GncNavigationPreferences;
    preferences.configure({ username: () => context.currentUser, canAccess: context.canAccessQuickAccessView,
        canDisplay: context.canDisplayQuickAccessView, fullVisibility: context.hasFullNavigationVisibility,
        displayChoices: context.getNavigationDisplayChoices, navigate: context.navigateDisplayedQuickAccessView,
        call: async () => { throw new Error('offline'); } });
    context.refreshNavigationDisplayCache();
    const render = () => { context.syncRoleAccessUi(); context.updateFooterNavState(); };
    const visible = selector => [...dom.window.document.querySelectorAll(selector)].filter(node => !node.hidden && !node.classList.contains('hidden'));
    return { context, dom, preferences, storage, session, render, visible, close: () => dom.window.close() };
}
