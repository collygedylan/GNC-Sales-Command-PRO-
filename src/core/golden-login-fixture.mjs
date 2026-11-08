import assert from 'node:assert/strict';

export function loginBootstrapContract(runFunctions) {
  const nodes = {
    'view-login': { style: { display: 'flex' } },
    'login-inputs': { classList: { remove() {} } },
    'loading-spinner': { classList: { add() {} } },
    'app-wrapper': { hidden: true, style: { display: 'none', removeProperty(name) { delete this[name]; } }, classList: { remove() {} } },
    'main-scroll-area': { style: {} },
  };
  const context = runFunctions('assets/app-runtime.js', ['openAppShellAfterLogin'], {
    window:{}, shouldPreserveMountedBootView:()=>false,runAppUpdateRestoreAfterShell:async()=>{},
    currentUser: 'dylan_collyge', clearLoginStartupWatchdog() {}, blurActiveField() {}, setLoginProgress() {}, finishInitialAppLoad() {},
    document: { documentElement:{classList:{remove(){}}}, getElementById: id => nodes[id] || null, body: { classList: { remove() {} } } },
    isTouchConstrainedDevice: () => false, setMenuOpenState() {}, syncAuraWidgetForSession: async () => true,
    setHomeDashboardModulesReady() {}, syncCurrentViewBodyClass() {}, repairAppShellScrollState() {}, syncRoleAccessUi() {},
    getRoleAccessState: () => ({}), applyRolePermissions() {}, showOnlyPrimaryView: view => { context.visibleView = view; },
    renderHome: () => { context.homeRendered = true; }, updateFooterNavState() {}, syncGlobalHeaderChrome() {}, runAfterShellInteractive() {},
    scheduleRequestModalReferencePrefetch() {}, scheduleGlobalReferencePrefetch() {}, ensureHomeDashboardReadyAfterLogin() {},
    refreshRealtimeSubscriptionsForCurrentView() {}, canUseProductionLiveSync: () => true, signalProductionLiveSync() {},
    setTimeout() {}, console: { warn() {} },
  });
  assert.doesNotThrow(() => context.openAppShellAfterLogin(false));
  assert.equal(nodes['app-wrapper'].hidden, false);
  assert.equal(context.visibleView, 'home');
  assert.equal(context.homeRendered, true);
}
