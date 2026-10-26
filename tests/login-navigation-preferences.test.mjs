import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: navigation
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readComposedAppSource();
const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const preferencesSource = readFileSync(new URL('../assets/navigation-preferences.js', import.meta.url), 'utf8');

function sliceBetween(startText, endText) {
  const start = html.indexOf(startText);
  const end = html.indexOf(endText, start);
  assert.ok(start >= 0, `missing source: ${startText}`);
  assert.ok(end > start, `missing source after ${startText}: ${endText}`);
  return html.slice(start, end);
}

function accessHarness({ preferences, overrides = {} } = {}) {
  const context = vm.createContext({
    window: { ...(preferences === undefined ? {} : { GncNavigationPreferences: preferences }), SalesWorkspace: { isView: () => false } },
    currentUser: 'worker',
    canonicalFeaturePermission: () => null,
    isEvalSensitiveDataRestricted: () => false,
    canUseHistoricalRequests: () => true,
    BunchNote: { author: () => true },
    canUseHlOrder: () => true,
    isManagerViewDeniedUser: () => false,
    isStrictDylanCollygeUser: () => true,
    canViewCropRollHome: () => true,
    getRequestCapabilities: () => ({ canViewQueue: true }),
    canSeeEvalWorkRequestTab: () => false,
    canUseInvBunchNotes: () => true,
    canUseMovesModule: () => false,
    isFullAppAdministrator: () => false,
    getRoleAccessState: () => ({ isRepLike: false, isAdmin: false, allowedViews: new Set(['tasks', 'moves']) }),
    canViewManagerSalesReps: () => false,
    ...overrides,
  });
  vm.runInContext(sliceBetween('function navigationPreferencesAllowed(', 'function isSalesShellAccess('), context);
  return context;
}

function element() {
  const classes = new Set(['hidden']);
  return {
    style: {}, hidden: false, dataset: {}, innerHTML: '', textContent: '',
    classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
      toggle: (name, force) => force === undefined ? (classes.has(name) ? classes.delete(name) : classes.add(name)) : (force ? classes.add(name) : classes.delete(name)),
      contains: name => classes.has(name),
    },
    setAttribute() {}, querySelectorAll: () => [],
  };
}

test('missing and null navigation modules preserve view baselines and protected denials', () => {
  for (const preferences of [undefined, null, {}]) {
    const runtime = accessHarness({ preferences });
    for (const view of ['historical-requests', 'bunch-note', 'hl-order', 'pest-management', 'disease-pest', 'crop-roll', 'request', 'moves']) {
      assert.equal(runtime.canAccessView(view), true, `${view} should retain its baseline permission`);
    }
    assert.equal(runtime.canAccessView('tasks'), true);
    assert.equal(runtime.canAccessView('reports'), false);
    assert.equal(runtime.canAccessView('building'), false);
    runtime.canUseHistoricalRequests = () => false;
    runtime.BunchNote.author = () => false;
    runtime.canUseInvBunchNotes = () => false;
    runtime.canUseHlOrder = () => false;
    runtime.isStrictDylanCollygeUser = () => false;
    runtime.canViewCropRollHome = () => false;
    runtime.getRequestCapabilities = () => null;
    runtime.getRoleAccessState = () => ({ allowedViews: new Set() });
    for (const view of ['historical-requests', 'bunch-note', 'hl-order', 'pest-management', 'disease-pest', 'crop-roll', 'request', 'moves']) {
      assert.equal(runtime.canAccessView(view), false, `${view} must not gain access when its baseline denies it`);
    }
    runtime.isEvalSensitiveDataRestricted = () => true;
    assert.equal(runtime.canAccessView('historical-requests'), false);
    assert.equal(runtime.canAccessView('reports'), false);
  }
});

test('available navigation overrides remain effective and cannot bypass protected checks', () => {
  const restrict = accessHarness({ preferences: { allowed: (_view, baseline) => !baseline } });
  assert.equal(restrict.canAccessView('tasks'), false);
  assert.equal(restrict.canAccessView('request'), false);
  assert.equal(restrict.canAccessView('building'), false);
  const grant = accessHarness({ preferences: { allowed: () => true } });
  assert.equal(grant.canAccessView('reports'), true);
  grant.isStrictDylanCollygeUser = () => false;
  assert.equal(grant.canAccessView('pest-management'), false);
  assert.equal(grant.canAccessView('disease-pest'), false);
  grant.isManagerViewDeniedUser = () => true;
  assert.equal(grant.canAccessView('managers'), false);
  grant.isEvalSensitiveDataRestricted = () => true;
  assert.equal(grant.canAccessView('reports'), false, 'sensitive-data restriction precedes preference overrides');
});

test('role UI initialization runs actual access checks with the navigation module missing', () => {
  const context = accessHarness({ overrides: {
    document: { getElementById: () => element() },
    ROLE_VIEW_ELEMENT_IDS: { request: ['request-button'], moves: ['moves-button'], 'crop-roll': ['crop-button'] },
    HOME_MODULE_REGISTRY: [{ view: 'request' }, { view: 'reports' }, { view: 'moves' }],
    getHomeModuleRegistry: () => [{ view: 'request' }, { view: 'reports' }, { view: 'moves' }],
    ensureHomeModuleRegistry: () => ({ dataset: {}, querySelectorAll: () => [] }),
    isSalesShellAccess: () => false,
    scheduleHomeDashboardFitSettle() {},
  } });
  vm.runInContext(sliceBetween('function syncRoleAccessUi(', 'function isDrawerOpen('), context);
  assert.doesNotThrow(() => context.syncRoleAccessUi({ allowedViews: new Set(['moves']) }));
});

test('configuration, refresh, footer updates, and preference editor tolerate absent methods', async () => {
  const source = sliceBetween('let navigationPreferencesAccount =', 'function scheduleViewActivationWork(');
  const context = vm.createContext({
    window: {}, currentUser: 'worker', navigationPreferencesAccount: '',
    configureCanonicalUserAccess() {},
    renderCanonicalUserAccessEditor() {},
    document: { getElementById: () => element(), querySelectorAll: () => [] },
    GncMobileWorkspace: { shell() {} }, getCurrentVisibleViewId: () => 'home', getRoleAccessState: () => ({}),
    canShowFooterViewButton: () => false, isSalesShellAccess: () => false,
    scheduleIosBottomNavViewportLock() {}, setMenuOpenState() {}, switchView() {},
    cartPanelOpen: false, selectedItems: new Set(),
    postAppFunctionJson: async () => { throw new Error('unavailable'); },
  });
  vm.runInContext(source, context);
  assert.doesNotThrow(() => context.configureNavigationPreferences());
  assert.doesNotThrow(() => context.updateFooterNavState());
  const container = element();
  context.renderNavigationPreferencesEditor('shortcuts', container);
  assert.match(container.innerHTML, /Navigation settings are unavailable/);
  context.renderNavigationPreferencesEditor('access', container);
  assert.match(container.innerHTML, /Navigation settings are unavailable/);
  assert.equal(context.openFooterShortcutSettings(), false);

  context.window.GncNavigationPreferences = { configure() {}, refresh: () => Promise.reject(new Error('offline')) };
  assert.doesNotThrow(() => context.configureNavigationPreferences());
  await Promise.resolve();
});

test('missing saved preferences or an initial failed refresh retain permitted defaults', async () => {
  for (const response of [null, undefined, { views: [] }, new Error('offline')]) {
    const context = accessHarness();
    vm.runInContext(preferencesSource, context);
    const preferences = context.window.GncNavigationPreferences;
    preferences.configure({ username: 'worker', canAccess: view => context.canAccessView(view), call: async () => {
      if (response instanceof Error) throw response;
      return response;
    } });
    if (response instanceof Error) await assert.rejects(preferences.refresh(), /offline/);
    else await preferences.refresh();
    assert.equal(preferences.snapshot, null);
    assert.equal(context.canAccessView('request'), true);
    assert.equal(context.canAccessView('reports'), false);
    assert.deepEqual(Array.from(preferences.shortcuts()), ['tasks', 'request']);
  }
});

test('post-login shell completes role initialization without the optional preference module', () => {
  const source = sliceBetween('function openAppShellAfterLogin(', 'function addLoginWarmupTarget(');
  const calls = [];
  const ids = ['view-login', 'login-inputs', 'loading-spinner', 'app-wrapper', 'main-scroll-area'];
  const elements = new Map(ids.map(id => [id, element()]));
  const context = accessHarness({ overrides: {
    window: {}, document: { getElementById: id => elements.get(id) || null, body: element() },
    navigator: { userAgent: '' },
    clearLoginStartupWatchdog() {}, blurActiveField() {}, setLoginProgress() {}, finishInitialAppLoad() {},
    isTouchConstrainedDevice: () => false, setMenuOpenState() {}, syncAuraWidgetForSession() {},
    setHomeDashboardModulesReady() {}, syncCurrentViewBodyClass() {}, repairAppShellScrollState() {},
    ROLE_VIEW_ELEMENT_IDS: { request: ['request-button'], moves: ['moves-button'], 'crop-roll': ['crop-button'] },
    HOME_MODULE_REGISTRY: [{ view: 'request' }, { view: 'reports' }, { view: 'moves' }],
    ensureHomeModuleRegistry: () => null, isSalesShellAccess: () => false,
    scheduleHomeDashboardFitSettle() {},
    applyRolePermissions() { calls.push('apply-role-permissions'); context.syncRoleAccessUi(); },
    ensureHomeDashboardReadyAfterLogin() {}, runAfterShellInteractive() {},
    refreshRealtimeSubscriptionsForCurrentView() {}, setTimeout() { return 1; },
    canUseProductionLiveSync: () => true, signalProductionLiveSync() {},
  } });
  vm.runInContext(sliceBetween('function syncRoleAccessUi(', 'function isDrawerOpen('), context);
  const syncRoleAccessUi = context.syncRoleAccessUi;
  context.syncRoleAccessUi = (...args) => { calls.push('sync-role-ui'); syncRoleAccessUi(...args); };
  vm.runInContext(source, context);
  context.openAppShellAfterLogin();
  assert.deepEqual(calls, ['sync-role-ui', 'apply-role-permissions', 'sync-role-ui']);
  assert.equal(elements.get('view-login').style.display, 'none');
  assert.equal(elements.get('login-inputs').classList.contains('hidden'), false);
  assert.equal(elements.get('loading-spinner').classList.contains('hidden'), true);
});

test('primary view visibility, cached identity and body marker agree before lifecycle and Back chrome hooks', () => {
  const makeElement = (...initialClasses) => {
    const classes = new Set(initialClasses);
    return { dataset: {}, style: {}, classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name), [Symbol.iterator]: () => classes.values(),
    } };
  };
  const views = new Map(['home', 'drive', 'av', 'request'].map(view => [view, makeElement(...(view === 'home' ? [] : ['hidden']))]));
  const body = makeElement('current-view-home');
  body.dataset.currentView = 'home';
  const observations = [];
  let expectedView = 'home';
  let context;
  const observe = hook => {
    assert.equal(context.currentPrimaryViewId, expectedView, `${hook}: cached primary view`);
    assert.equal(context.getCurrentVisibleViewId(), expectedView, `${hook}: visible primary view`);
    assert.equal(body.dataset.currentView, expectedView, `${hook}: synchronous body marker`);
    assert.deepEqual(Array.from(body.classList).filter(name => name.startsWith('current-view-')), [`current-view-${expectedView}`]);
    assert.deepEqual(Array.from(views).filter(([, view]) => !view.classList.contains('hidden')).map(([id]) => id), [expectedView]);
    observations.push(hook);
  };
  context = vm.createContext({
    currentPrimaryViewId: 'home', TRACKED_VIEW_IDS: ['drive', 'av', 'request'],
    document: { body, getElementById: id => views.get(id.replace(/^view-/, '')) || null },
    window: { BunchQueueShell: { closeDetail() {} }, AgMetricLifecycle: { enterView: () => observe('lifecycle') } },
    getPrimaryViewIds: () => Array.from(views.keys()), getViewElementById: id => views.get(id),
    isViewVisible: id => !!views.get(id) && !views.get(id).classList.contains('hidden'),
    syncHomeDashboardBodyMode() {}, syncRequestDetailScrollMode: () => observe('detail-scroll'),
    repairAppShellScrollState: () => observe('scroll-repair'),
    updateGlobalBackButton: () => observe('back-chrome'),
    canUseProductionLiveSync: () => true, beginProductionVerifiedNavigation: () => observe('live-navigation'),
  });
  for (const name of ['getCurrentVisibleViewId', 'syncCurrentViewBodyClass', 'showOnlyPrimaryView']) {
    const source = html.match(new RegExp('        function ' + name + '\\([^]*?^        }', 'm'))?.[0];
    assert.ok(source, `missing ${name}`);
    vm.runInContext(source, context);
  }
  for (const view of ['drive', 'av', 'request', 'home']) {
    expectedView = view;
    observations.length = 0;
    assert.equal(context.showOnlyPrimaryView(view), views.get(view));
    assert.ok(observations.includes('lifecycle'), 'lifecycle must observe the completed synchronous view transition');
    assert.ok(observations.includes('back-chrome'), 'global Back chrome must be refreshed synchronously');
  }
});

test('navigation module URL and service worker cache use the current asset version', () => {
  const version = worker.match(/const APP_ASSET_VERSION = '([^']+)'/);
  assert.ok(version, 'service worker asset version should exist');
  assert.ok(html.includes(`./assets/navigation-preferences.js?v=${encodeURIComponent(version[1])}`));
  assert.ok(worker.includes(`'./assets/navigation-preferences.js?v=' + encodeURIComponent(APP_SHELL_BUILD)`));
});

test('saved admin shortcuts and nested quick-access routes remain selectable', () => {
  assert.match(preferencesSource, /usesAdminShortcuts\(\) && Array\.isArray\(saved\) && saved\.length === 1 && text\(saved\[0\]\)\.trim\(\) === 'tasks'/);
  assert.match(preferencesSource, /staleAdminShortcuts \|\| !Array\.isArray\(saved\) \|\| !saved\.length \? fallbackShortcuts : saved/);
  assert.doesNotMatch(preferencesSource, /value = \{ \.\.\.value, shortcuts: \[\.\.\.ADMIN_SHORTCUTS\] \}/);
  for (const marker of ['eval_reports_2', 'Eval Reports #2', 'archive-drive', 'queue-bunch-count-review', 'inv-consolidation']) {
    assert.ok(preferencesSource.includes(marker), marker);
  }
  for (const marker of ['function canAccessQuickAccessView', 'function navigateQuickAccessView',
    'quickAccessNestedBackState', 'quickAccessRoute: safeView',
    "eval_reports_2: { parent: 'managers', tab: 'eval-reports-2' }",
    "'archive-orders': { parent: 'historical-requests', archiveTab: 'orders' }",
    "'queue-pending': { parent: 'request', tab: 'pending' }",
    "'qc-docks': { parent: 'docks', access: 'qc' }",
    "'office-orders': { parent: 'sales-office', tab: 'orders', access: 'office' }",
    "'sales-drive': { parent: 'drive', access: 'sales' }"]) assert.ok(html.includes(marker), marker);
});
