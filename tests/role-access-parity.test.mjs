import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runtime = read('assets/runtime-watchdog.js');
const api = read('supabase/functions/app-api/index.ts');
const auth = read('supabase/functions/_shared/app-auth.ts');
const html = readComposedAppSource();
const coordinator = read('assets/live-sync-coordinator.js');

function shellFunction(name) {
  const match = html.match(new RegExp('        (?:async )?function ' + name + '\\([^]*?^        }', 'm'));
  assert.ok(match, name);
  return match[0];
}

test('verified administrators mount all eleven Home modules at desktop and mobile widths', () => {
  const registry = html.match(/        const HOME_MODULE_REGISTRY = Object.freeze\(\[[^]*?\n        \]\);/)[0];
  for (const width of [320, 390, 768, 1024, 1440, 2560]) {
    for (const username of ['dylan_collyge', 'megan_kelly', 'jd_jones']) {
      const grid = { dataset: {}, innerHTML: '' };
      const ctx = vm.createContext({ currentUser: username, nativeAuthSessionActive: true,
        nativeAuthSessionUserId: 'actor', nativeAuthProfile: { id: 'actor', username },
        PRIVILEGED_MANAGER_USER_KEYS: ['dylan_collyge', 'megan_kelly', 'jd_jones'],
        window: { innerWidth: width }, document: { getElementById: () => grid },
        buildFastInvokeAttrs: () => '' });
      vm.runInContext(registry + shellFunction('isFullAppAdministrator') + shellFunction('canAccessView') + shellFunction('ensureHomeModuleRegistry'), ctx);
      ctx.ensureHomeModuleRegistry();
      const views = [...grid.innerHTML.matchAll(/data-home-module-view="([^"]+)"/g)].map(match => match[1]);
      assert.deepEqual(views, ['drive', 'hl-order', 'av', 'sales-office', 'sales', 'historical-requests', 'managers', 'qc', 'office', 'sales-inventory', 'production']);
      for (const view of views) assert.equal(ctx.canAccessView(view), true, `${username} ${width}px ${view}`);
      assert.match(grid.innerHTML.match(/<button[^>]+id="home-tile-sales-office"[^]*?<\/button>/)[0], /<svg[^>]+viewBox="0 0 24 24"[^]*?<path/);
    }
  }
});

test('Home sync always renders four named cards while partial metadata refreshes', () => {
  const nodes = Object.fromEntries(['dashboard-sync-accordion', 'dashboard-sync-stamp', 'dashboard-sync-summary', 'dashboard-sync-files'].map(id => [id, { classList: { toggle() {} }, innerHTML: '', innerText: '' }]));
  const ctx = vm.createContext({ document: { getElementById: id => nodes[id] }, canViewDashboardSyncStatus: () => true,
    getSupabaseReadIdentityScope: () => 'owner', dashboardSyncMetadataOwner: 'owner',
    dashboardSyncMetadataSummaries: [], dashboardSyncMetadataFetchedAt: Date.now(), dashboardSyncMetadataInFlight: false,
    DASHBOARD_SYNC_METADATA_TTL_MS: 60000, fullInventory: [], socInventory: [], reservesInventory: [], cavInventory: [],
    collectDashboardSyncSource: (_rows, label) => ({ label, iso: label === 'Reserves' ? '2026-10-21T16:00:00Z' : '', ms: label === 'Reserves' ? 1 : 0, files: label === 'Reserves' ? ['Reserves.xlsx'] : [] }),
    mergeDashboardSyncSummaries: rows => rows, formatDashboardSyncDateTime: value => value || 'Awaiting import metadata',
    escapeDashboardSyncText: value => String(value) });
  vm.runInContext(shellFunction('updateDashboardSyncSummary'), ctx);
  ctx.updateDashboardSyncSummary();
  for (const source of ['DRIVE', 'CAV', 'RESERVES', 'SOC']) assert.match(nodes['dashboard-sync-files'].innerHTML, new RegExp('data-sync-source="' + source + '"'));
  assert.match(nodes['dashboard-sync-files'].innerHTML, /Reserves.xlsx/);
});

test('desktop connection status is visible without standalone mode or an active import', () => {
  const nodes = Object.fromEntries(['sync-diagnostics-badge', 'sync-diagnostics-detail'].map(id => [id, { classList: { toggle(_key, hidden) { this.hidden = hidden; } } }]));
  const ctx = vm.createContext({ document: { getElementById: id => nodes[id] }, navigator: { onLine: true },
    isIOSDevice: () => false, isStandaloneApp: () => false, hasActiveManualSync: () => false,
    isTouchConstrainedDevice: () => false, syncDiagnosticsOverride: '', liveSyncMode: 'idle', lastSuccessfulSyncTime: 0,
    getDatasetRevisionConnectionLabel: () => 'Connected · 4 ready', formatDiagnosticsTime: () => '', getDiagnosticsPlatformLabel: () => 'Desktop' });
  vm.runInContext(shellFunction('updateSyncDiagnostics'), ctx); ctx.updateSyncDiagnostics();
  assert.equal(nodes['sync-diagnostics-badge'].classList.hidden, false);
  assert.equal(nodes['sync-diagnostics-badge'].innerText, 'IDLE');
  assert.match(nodes['sync-diagnostics-detail'].innerText, /Connected · 4 ready/);
});

test('all nursery role aliases normalize consistently on client and server', () => {
  const aliases = new Map([
    ['admin', 'admin'], ['sales rep', 'sales_rep'], ['salesrep', 'sales_rep'], ['sales_rep', 'sales_rep'],
    ['supervisor', 'supervisor'], ['evaluator', 'evaluator'], ['kier', 'kier'], ['dock office', 'dock_office'], ['dock_office', 'dock_office'],
    ['qc supervisor', 'qc_supervisor'], ['qc_supervisor', 'qc_supervisor'], ['shipping', 'shipping'], ['data entry', 'data_entry'], ['data_entry', 'data_entry'],
    ['foreman', 'foreman'], ['take backs', 'take_backs'], ['take_backs', 'take_backs'],
  ]);
  for (const [alias, canonical] of aliases) {
    assert.ok(runtime.includes(`'${alias}': '${canonical}'`) || runtime.includes(`${alias}: '${canonical}'`), `client alias ${alias}`);
    if (alias.includes(' ') || alias.includes('_')) assert.ok(api.includes(`"${canonical}"`), `server canonical role ${canonical}`);
  }
  assert.match(auth, /export function normalizeRole\(value = ""\)/);
  assert.match(api, /watchdogRole\(actor\.role\)/);
  assert.match(html, /function normalizeRoleAccessToken\(value = ''\)/);
});

test('Drive, AV, Docks and Que use the shared non-blocking view hydration coordinator', () => {
  assert.match(html, /function switchView\(/);
  assert.match(html, /ensureViewDataForRender\(/);
  assert.match(coordinator, /createCoordinator/);
  const required = ['drive', 'av', 'docks', 'queue', 'que'];
  for (const view of required) assert.ok(html.toLowerCase().includes(view), `${view} view wiring`);
  assert.match(runtime, /configure\(options = \{\}\)/);
  assert.match(runtime, /state\.report = options\.reportEvent/);
});

test('designated administrators retain every flag; management cannot be inherited by another account', async () => {
  const clientSource = read('assets/user-access-control.js');
  const server = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read('supabase/functions/_shared/canonical-user-access.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, server);
  for (const username of ['dylan_collyge', 'megan_kelly', 'jd_jones', 'other_admin', 'kayla_knepp', 'nelly_aguilar', 'sales_rep']) {
    const window = {};
    vm.runInNewContext(clientSource, { window });
    const access = window.GncUserAccessControl;
    const privileged = ['dylan_collyge', 'megan_kelly', 'jd_jones'].includes(username);
    const permissions = Object.fromEntries(access.permissionKeys.map(flag => [flag, !privileged]));
    const profile = { id: '11111111-1111-4111-8111-111111111111', username, role: 'Admin' };
    const response = { revision: 1, profile, baseline: { role: 'admin', permissions },
      permission_overrides: {}, effective_permissions: permissions,
      data_hydration_policy: { use_shared_instant_snapshot: true, av_season_rule: 'CURRENT_SEASON_F1_LE_27', av_visibility_rule: 'ALL_ELIGIBLE_ROWS' } };
    access.configure({ getSessionIdentity: () => ({ ...profile, authenticated: true }), transport: async () => ({ ok: true, data: response }) });
    await access.loadSelf();
    const client = access.getEffectiveUserPermissions().permissions;
    const resolved = await server.exports.resolveCanonicalUserAccess({ rpc: async () => ({ data: response, error: null }) }, profile.id);
    for (const flag of access.permissionKeys) {
      assert.equal(client[flag], privileged || flag !== 'can_manage_user_access', `${username}: client ${flag}`);
      assert.equal(resolved.permissions[flag], client[flag], `${username}: server ${flag}`);
    }
    if (!privileged) await assert.rejects(access.loadDirectory(), /USER_ACCESS_MANAGER_REQUIRED/);
  }
  const migration = read('supabase/migrations/20261021035500_full_app_administrators_v1.sql');
  assert.match(migration, /if not private\.is_full_app_administrator_v1\(actor\.username\)/);
  assert.match(migration, /protect_full_app_user_access before insert or update/);
  assert.match(migration, /history_dylan_financial_v1\(p_actor uuid\)[\s\S]*?private\.is_full_app_administrator_v1\(p\.username\)/);
  assert.match(api, /operation !== "resolve" && !FULL_ACCESS_USER_KEYS\.has\(String\(actor\.username/);
});

test('AURA legacy owner stays Dylan-only while voice routing follows server capabilities', async () => {
  const clientSource = read('assets/user-access-control.js');
  const clientWindow = {};
  vm.runInNewContext(clientSource, { window: clientWindow });
  const clientAuraOwner = clientWindow.GncUserAccessControl.isAuraOwner;
  assert.equal(clientAuraOwner(' DYLAN_COLLYGE '), true);
  for (const username of ['megan_kelly', 'jd_jones', 'brian_hart', 'other_admin', null]) assert.equal(clientAuraOwner(username), false, username);

  const server = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read('supabase/functions/_shared/canonical-user-access.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, server);
  assert.equal(server.exports.isCanonicalAuraOwner(' DYLAN_COLLYGE '), true);
  for (const username of ['megan_kelly', 'jd_jones', 'brian_hart', 'other_admin', null]) assert.equal(server.exports.isCanonicalAuraOwner(username), false, username);

  const auraRuntime = read('assets/app-runtime.js');
  const voiceStore = read('supabase/functions/_shared/aura-voice-store.ts');
  const auraAuth = read('supabase/functions/_shared/aura-auth.ts');
  const migration = read('supabase/migrations/20261021133149_aura_dylan_owner_only_guard.sql');
  const legacyCandidate = auraRuntime.slice(auraRuntime.indexOf('function isAuraProfileCandidate()'), auraRuntime.indexOf('function isAuraWidgetAuthorized()'));
  const routerCandidate = auraRuntime.slice(auraRuntime.indexOf('function isAuraRouterProfileCandidate()'), auraRuntime.indexOf('function isAuraRouterWidgetAuthorized()'));
  assert.match(legacyCandidate, /dylan_collyge/);
  assert.doesNotMatch(routerCandidate, /dylan_collyge|isAuraOwner/);
  assert.match(auraRuntime, /aura-standby-control[\s\S]*?standby\.style\.display = standby\.hidden \? 'none' : ''/);
  assert.doesNotMatch(voiceStore, /isCanonicalAuraOwner/);
  assert.match(voiceStore, /capabilities\.auraEnabled !== true/);
  assert.doesNotMatch(voiceStore, /allowedRoles/);
  assert.match(auraAuth, /isCanonicalAuraOwner\(session\.username\)/);
  assert.match(migration, /coalesce\(lower\(btrim\(actor\.username\)\),''''\)<>''dylan_collyge''/);
  assert.match(migration, /AURA_ACCESS_RPC_GRANTS_CHANGED/);
  const releaseMigration = read('supabase/migrations/20261022_inventory_projects_v1.sql');
  assert.match(releaseMigration, /actor_role not in \(''ADMIN'',''ADMINISTRATOR'',''MANAGER'',''REP'',''SALESREP'',''CSR''\)/);
});

test('unverified and revoked sessions cannot use the administrator UI grant', () => {
  const start = html.indexOf('        function isFullAppAdministrator(');
  const end = html.indexOf('\n        function ', start + 1);
  const context = { PRIVILEGED_MANAGER_USER_KEYS: ['dylan_collyge', 'megan_kelly', 'jd_jones'],
    currentUser: 'dylan_collyge', nativeAuthSessionActive: true, nativeAuthSessionUserId: 'owner',
    nativeAuthProfile: { id: 'owner', username: 'dylan_collyge' }, window: {} };
  vm.createContext(context); vm.runInContext(html.slice(start, end), context);
  assert.equal(context.isFullAppAdministrator(), true);
  context.currentUser = 'other_admin';
  assert.equal(context.isFullAppAdministrator(), false);
  context.currentUser = 'dylan_collyge'; context.nativeAuthSessionUserId = 'another-account';
  assert.equal(context.isFullAppAdministrator(), false);
  context.nativeAuthSessionUserId = 'owner';
  context.window.GncUserAccessControl = { getSelfState: () => ({ denied: true }) };
  assert.equal(context.isFullAppAdministrator(), false);
});

test('background Home rendering retains the active Manager module', () => {
  const ctx = vm.createContext({ activeHomeTab: 'access-control', selectedProductivityUser: 'dylan_collyge',
    getCurrentVisibleViewId: () => 'managers', document: { getElementById: () => { throw new Error('inactive Home DOM touched'); } } });
  vm.runInContext(html.match(/        function renderHome\([^]*?^        }/m)[0], ctx);
  ctx.renderHome();
  assert.equal(ctx.activeHomeTab, 'access-control');
});

test('only the admin trio can view Home imported filenames', () => {
  const ctx=vm.createContext({currentUser:''});
  vm.runInContext(html.match(/        function canViewDashboardSyncStatus\([^]*?^        }/m)[0],ctx);
  for (const user of ['dylan_collyge','megan_kelly','jd_jones','nelly_aguilar','brian_hatfield','']) {
    ctx.currentUser=user;
    assert.equal(ctx.canViewDashboardSyncStatus(),['dylan_collyge','megan_kelly','jd_jones'].includes(user));
  }
});

test('verified administrator controls remain available during a same-account refresh', () => {
  const source=read('assets/user-access-control.js');
  const ctx=vm.createContext({selfStatus:'loading',selfDenied:false,selfRecord:{verified:true,profile:{id:'actor',username:'dylan_collyge'},effective_permissions:{can_manage_user_access:true}},
    getIdentity:()=>({id:'actor',username:'dylan_collyge'}),isFullAppAdministrator:()=>true});
  vm.runInContext(source.match(/    function isVerifiedManager\([^]*?^    }/m)[0],ctx);
  assert.equal(ctx.isVerifiedManager(),true);
  ctx.selfDenied=true; assert.equal(ctx.isVerifiedManager(),false);
});

test('Dylan saved Manager shortcut produces the eight requested footer entries', async () => {
  const window = {};
  vm.runInNewContext(read('assets/navigation-preferences.js'), { window });
  const api = window.GncNavigationPreferences;
  const shortcuts = ['drive', 'managers', 'docks', 'request', 'bloom'];
  api.configure({ username: () => 'dylan_collyge', canAccess: () => true,
    call: async () => ({ data: { username: 'dylan_collyge', footerRevision: 2, shortcuts,
      views: shortcuts.map(view => ({ view, selectable: true, allowed: true })) } }) });
  await api.refresh();
  assert.deepEqual(Array.from(api.shortcuts()), shortcuts);
  const labels = vm.runInNewContext(read('assets/navigation-preferences.js').match(/const LABELS = [^;]+;/)[0] + 'LABELS');
  assert.deepEqual(['menu', 'home', ...api.shortcuts(), 'communication'].map(view => labels[view]), ['Menu', 'Home', 'Drive', 'Manager', 'Docks', 'Que', 'Bloom', 'Comm']);
});
