import assert from 'node:assert/strict';
import vm from 'node:vm';

export function assertLoginFallback({ shellFunction }) {
  const nodes = {
    'view-login': { style: { display: 'flex' } },
    'login-inputs': { classList: { remove() {} } },
    'loading-spinner': { classList: { add() {} } },
    'app-wrapper': { hidden: true, style: { display: 'none', removeProperty(name) { delete this[name]; } }, classList: { remove() {} } },
    'main-scroll-area': { style: {} },
  };
  const warnings = [];
  const context = vm.createContext({
    clearLoginStartupWatchdog() {}, blurActiveField() {}, setLoginProgress() {}, finishInitialAppLoad() {},
    window: {}, shouldPreserveMountedBootView: () => false, runAppUpdateRestoreAfterShell: async () => {},
    document: { documentElement: { classList: { remove() {} } }, getElementById: id => nodes[id] || null, body: { classList: { remove() {} } } },
    isTouchConstrainedDevice: () => false,
    setMenuOpenState() { throw new Error('preferences unavailable'); },
    syncAuraWidgetForSession: async () => true, setHomeDashboardModulesReady() {}, syncCurrentViewBodyClass() {},
    repairAppShellScrollState() {}, syncRoleAccessUi() {}, getRoleAccessState: () => ({}), applyRolePermissions() {},
    showOnlyPrimaryView: view => { context.visibleView = view; }, renderHome: () => { context.homeRendered = true; },
    updateFooterNavState() {}, syncGlobalHeaderChrome() {}, runAfterShellInteractive() {},
    scheduleRequestModalReferencePrefetch() {}, scheduleGlobalReferencePrefetch() {}, ensureHomeDashboardReadyAfterLogin() {},
    refreshRealtimeSubscriptionsForCurrentView() {}, canUseProductionLiveSync: () => true, signalProductionLiveSync() {},
    setTimeout() {}, console: { warn: (...args) => warnings.push(args) },
  });
  vm.runInContext(`${shellFunction('openAppShellAfterLogin')}\nglobalThis.openLoginShell = openAppShellAfterLogin;`, context);
  context.openLoginShell(false);
  assert.equal(nodes['app-wrapper'].hidden, false);
  assert.equal(nodes['view-login'].style.display, 'none');
  assert.equal(context.visibleView, 'home');
  assert.equal(context.homeRendered, true);
  assert.match(String(warnings[0]?.[0] || ''), /Menu reset deferred after login/);
  assert.doesNotMatch(shellFunction('openAppShellAfterLogin'), /App could not load|Reload app/);
}

export async function assertSharedRowAccess() {
  const {assertTableDrivenRowAuthorization} = await import('../../tests/helpers/table-row-authorization-contract.mjs');
  await assertTableDrivenRowAuthorization();
}

export async function assertAdminShortcuts({ read }) {
  const shortcuts = ['drive', 'eval_reports_2', 'docks', 'request'];
  const labels = vm.runInNewContext(read('assets/navigation-preferences.js').match(/const LABELS = [^;]+;/)[0] + 'LABELS');
  for (const username of ['dylan_collyge', 'megan_kelly', 'jd_jones']) {
    const window = {};
    vm.runInNewContext(read('assets/navigation-preferences.js'), { window });
    const api = window.GncNavigationPreferences;
    api.configure({ username: () => username, canAccess: () => true,
      call: async () => ({ data: { username, footerRevision: 2, shortcuts: ['tasks'],
        views: [{ view: 'tasks', selectable: true, allowed: true }, ...shortcuts.map(view => ({ view, selectable: false, allowed: false }))] } }) });
    await api.refresh();
    assert.deepEqual(Array.from(api.shortcuts()), shortcuts);
    assert.deepEqual(['menu', 'home', 'aura', ...api.shortcuts(), 'communication'].map(view => labels[view]), ['Menu', 'Home', 'AURA', 'Drive', 'Eval Reports #2', 'Docks', 'Que', 'Comm']);
  }
  const shell = read('index.html');
  assert.match(shell, /data-footer-view="managers"[^>]*aria-label="Manager"[^]*<span>Manager<\/span>/);
  assert.doesNotMatch(shell, /data-footer-view="tasks"[^>]*<span>Tasks<\/span>/);
}

export function assertCurrentRequestMatrix({ read }) {
 const ctx=vm.createContext({});vm.runInContext((read('assets/access-matrix-policy.js')+'\n'+read('assets/user-access-control.js')),ctx);const a=ctx.GncUserAccessControl;
 for(const username of ['nelly_aguilar','nally_aguilar','morgan_anderson']){const m=a.resolveUserAccessMatrix(username);assert.equal(m.make_request,'N');assert.equal(m.edit_any_row,'N');assert.equal(m.flyer_folder_access,'N');}
 a.setAccessMatrixRows([{username:'new_request_actor',role:'REP',make_request:'Y',can_make_request:'Y',edit_any_row:'Y',can_edit_all_rows:'Y',flyer_folder_access:'Y'}]);const granted=a.resolveUserAccessMatrix('new_request_actor');assert.equal(granted.make_request,'Y');assert.equal(granted.edit_any_row,'Y');
 a.setAccessMatrixRows([{username:'melissa_dowty',make_request:'Y',can_make_request:'Y',request_all_reps:'Y',sales_rep_access:{abbey_burka:'N',nate_douglas:'Y'}}]);const m=a.resolveUserAccessMatrix('Melissa Dowty');assert.equal(a.canRequestSalesRep(m,'Abbey Burka'),true);assert.equal(a.canRequestSalesRep(m,'Nate Douglas'),true);
 a.setAccessMatrixRows([{...m,make_request:'N',can_make_request:'N'}]);assert.equal(a.canRequestSalesRep(a.resolveUserAccessMatrix('melissa_dowty'),'Nate Douglas'),false);
 assert.equal(a.canRequestSalesRep(m,''),false);
}


export function assertExecutiveHomeModules({ read, shellFunction, html }) {
  const shell = read('index.html');
  assert.match(shell, /id="home-dashboard-grid"[^]*id="home-tile-smart-moves"[^>]*data-module="smart-moves"[^>]*class="home-module-tile role-access hidden"[^>]*onclick="switchView\('smart-moves'\)"/);
  const registryStart = html.indexOf('        const HOME_MODULE_REGISTRY = Object.freeze([');
  const registryEnd = html.indexOf('        function normalizeRoleAccessToken', registryStart);
  const registry = html.slice(registryStart, registryEnd);
  for (const width of [320, 390, 768, 1024, 1440, 2560]) {
    for (const {username,allowed} of [{username:'dylan_collyge',allowed:true},{username:'megan_kelly',allowed:false},{username:'smart_moves_operator',allowed:true}]) {
      const grid = { dataset: {}, innerHTML: '' };
      const ctx = vm.createContext({ currentUser: username,hasFullNavigationVisibility:()=>false,getNavigationVisibilityIdentity:()=>null,isAuthenticatedExecutiveUser:permission=>permission==='view_smart_moves'&&allowed,
        window: { innerWidth: width }, document: { getElementById: () => grid },
        buildFastInvokeAttrs: () => '' });
      vm.runInContext(shellFunction('getNavigationHomeModuleRegistry'), ctx);
      vm.runInContext(registry, ctx);
      ctx.ensureHomeModuleRegistry();
      const views = [...grid.innerHTML.matchAll(/data-home-module-view="([^"]+)"/g)].map(match => match[1]);
      const standard = ['drive', 'hl-order', 'av', 'sales-office', 'sales', 'historical-requests', 'managers', 'qc', 'office', 'sales-inventory', 'production'];
      assert.deepEqual(views, allowed ? [...standard, 'smart-moves'] : standard);
      if (allowed) assert.equal(views.length, 12, `Desktop Browser ${width}px executive module count`);
      assert.doesNotMatch(grid.innerHTML, /App could not load|Reload app/);
      if (allowed) assert.match(grid.innerHTML, /data-module="smart-moves"[^>]*onclick="switchView\('smart-moves'\)"/);
      else assert.doesNotMatch(grid.innerHTML, /smart-moves/);
      assert.match(grid.innerHTML.match(/<button[^>]+id="home-tile-sales-office"[^]*?<\/button>/)[0], /<svg[^>]+viewBox="0 0 24 24"[^]*?<path/);
    }
  }
  assert.match(shellFunction('canAccessView'),/isAuthenticatedExecutiveUser\('view_smart_moves'/);
}
