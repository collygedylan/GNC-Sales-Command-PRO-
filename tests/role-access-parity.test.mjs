import { assertLoginFallback, assertSharedRowAccess, assertAdminShortcuts, assertCurrentRequestMatrix, assertExecutiveHomeModules } from '../src/ui/role-access-contract.mjs';
import { classifyReleaseSmokeRoute, RELEASE_SMOKE_SUPABASE_ORIGIN } from './helpers/release-smoke-route-policy.mjs';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { assertInventoryLiveChangeActorRows } from '../supabase/functions/_shared/production-workflow.ts';
import {fixture as rowAccessFixture,engines as rowAccessEngines} from '../src/core/canonical-row-fixture.mjs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runtime = read('assets/runtime-watchdog.js');
const api = read('supabase/functions/app-api/index.ts');
const auth = read('supabase/functions/_shared/app-auth.ts');
const html = readComposedAppSource();
const coordinator = read('assets/live-sync-coordinator.js');

function shellFunction(name) {
  const match = html.match(new RegExp('^( *)(?:async )?function ' + name + '\\([^]*?^\\1}', 'm'));
  assert.ok(match, name);
  return match[0];
}

test('super-admin or explicit Smart Moves capability mounts the twelfth Home module', () => assertExecutiveHomeModules({ read, shellFunction, html }));

test('Desktop Browser Dylan login opens Home when optional initialization fails', () => assertLoginFallback({ shellFunction }));

test('authenticated app directory reads stay sanitized and Request rep fallback never rejects', () => {
  assert.match(api, /app_user_directory:\s*\{[^}]*table: "profiles"[^}]*fields: "username,display_name,role,division,language"/s);
  assert.match(api, /ph_app_users: "app_user_directory"/);
  assert.match(api, /dataset !== "app_user_directory" && !hasTableReadAccess/);
  assert.match(api, /dataset === "app_user_directory"\) query\.set\("disabled_at", "is\.null"\)/);
  assert.doesNotMatch(api.match(/const COMMON_AUTH_READ_TABLES = new Set\(\[[^]*?\]\);/)?.[0] || '', /ph_app_users/);
  assert.match(html, /ph_app_users: 'app_user_directory'/);
  const requestDirectory = shellFunction('ensureRequestRepUserOptionsReady');
  assert.match(requestDirectory, /Request rep directory refresh retained known options/);
  assert.match(requestDirectory, /return requestModalRepUserOptions/);
  assert.doesNotMatch(requestDirectory, /throw error/);
});

test('transient reads retain UI data while genuine reclass conflicts stay enforced', () => {
  assert.match(api, /transientOkResponse\("MANAGER_REPORT_SOURCE_REVISION_CHANGED"/);
  assert.match(api, /transientOkResponse\("DATASET_NOT_READY"/);
  assert.match(api, /MASTER_IDENTITY_SOURCE_NOT_READY[^]*retained:true, retryable:true/);
  assert.match(api, /DRIVE_RECLASS_SOURCE_CHANGED" \}\);/);
  assert.match(html, /const policy = response.status === 403/);
  assert.match(html, /!preLogin && !policy && !reconciling/);
  assert.match(html, /response\.status === 401 && \(isLoginScreenVisible\(\) \|\| !getCurrentAppSessionToken\(\)\)/);
  assert.match(html, /\[409,423\]\.includes\(response\.status\)/);
});

test('Eval Reports 2 replaces contradictory zero counts from a complete same-account snapshot', () => {
  const build = shellFunction('createPagedManagerEvalIndex');
  assert.match(build, /getCachedManagerEvalReport2Metadata\(\)/);
  assert.match(build, /reportIds\.length === 11/);
  assert.match(build, /localMetadata\.counts/);
  assert.match(build, /cachedSnapshot:true/);
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
  vm.runInContext('const homeMarkupByNode = new WeakMap();' + shellFunction('syncRequestChromeMarkup') + shellFunction('updateDashboardSyncSummary'), ctx);
  ctx.updateDashboardSyncSummary();
  for (const source of ['DRIVE', 'CAV', 'RESERVES', 'SOC']) assert.match(nodes['dashboard-sync-files'].innerHTML, new RegExp('data-sync-source="' + source + '"'));
  assert.match(nodes['dashboard-sync-files'].innerHTML, /Reserves.xlsx/);
});

test('desktop connection status is visible without standalone mode or an active import', () => {
  const nodes = Object.fromEntries(['sync-diagnostics-badge', 'sync-diagnostics-detail'].map(id => [id, { classList: { toggle(_key, hidden) { this.hidden = hidden; } } }]));
  const ctx = vm.createContext({ document: { getElementById: id => nodes[id] }, navigator: { onLine: true },
    isIOSDevice: () => false, isStandaloneApp: () => false, hasActiveManualSync: () => false,
    isTouchConstrainedDevice: () => false, syncDiagnosticsOverride: '', liveSyncMode: 'idle', lastSuccessfulSyncTime: 0,
    getManualSyncProgressInfo: () => ({ active: false }),
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

test('super-admin receives every flag while ordinary accounts retain server-authored permissions', async () => {
  const clientSource = (read('assets/access-matrix-policy.js')+'\n'+read('assets/user-access-control.js'));
  const server = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read('supabase/functions/_shared/canonical-user-access.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, server);
  for (const { username, role, superAdmin } of [{username:'dylan_collyge',role:'super-admin',superAdmin:true},{username:'megan_kelly',role:'Admin',superAdmin:false},{username:'other_admin',role:'Admin',superAdmin:false}]) {
    const window = {};
    vm.runInNewContext(clientSource, { window });
    const access = window.GncUserAccessControl;
    const permissions = Object.fromEntries(access.permissionKeys.map(flag => [flag, flag !== 'can_manage_user_access']));
    const profile = { id: '11111111-1111-4111-8111-111111111111', username, role };
    const response = { revision: 1, profile, baseline: { role: superAdmin ? 'super_admin' : 'admin', permissions },
      permission_overrides: {}, effective_permissions: permissions,
      data_hydration_policy: { use_shared_instant_snapshot: true, av_season_rule: 'CURRENT_SEASON_F1_LE_27', av_visibility_rule: 'ALL_ELIGIBLE_ROWS' } };
    access.configure({ getSessionIdentity: () => ({ ...profile, authenticated: true }), transport: async () => ({ ok: true, data: response }) });
    await access.loadSelf();
    const client = access.getEffectiveUserPermissions().permissions;
    const resolved = await server.exports.resolveCanonicalUserAccess({ rpc: async () => ({ data: response, error: null }) }, profile.id);
    for (const flag of access.permissionKeys) {
      assert.equal(client[flag], superAdmin || flag !== 'can_manage_user_access', `${username}: client ${flag}`);
      assert.equal(resolved.permissions[flag], client[flag], `${username}: server ${flag}`);
    }
    if (!superAdmin) await assert.rejects(access.loadDirectory(), /USER_ACCESS_MANAGER_REQUIRED/);
  }
  const migration = read('supabase/migrations/20261101050000_v23129_super_admin_role.sql');
  assert.match(migration, /private\.user_access_capability_v23129\(actor\.id,'manage_user_access'\)/);
  assert.match(migration, /create or replace function private\.protect_full_app_access_v1/);
  assert.match(migration, /when 'SUPERADMIN' then 'super_admin'/);
  assert.match(api, /operation !== "resolve" && !await activeProfileAllows\(actor, "manage_user_access"\)/);
});

test('AURA uses super-admin or explicit matrix capability while voice routing follows server capabilities', async () => {
  const clientSource = (read('assets/access-matrix-policy.js')+'\n'+read('assets/user-access-control.js'));
  const clientWindow = {};
  vm.runInNewContext(clientSource, { window: clientWindow });
  const clientAuraOwner = clientWindow.GncUserAccessControl.isAuraOwner;
  assert.equal(clientAuraOwner('dylan_collyge','super-admin'), true);
  clientWindow.GncUserAccessControl.setAccessMatrixRows([{username:'aura_operator',role:'REP',use_aura_assistant:'Y'}]);
  assert.equal(clientAuraOwner('aura_operator'), true);assert.equal(clientAuraOwner('other_admin','Admin'), false);

  const server = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read('supabase/functions/_shared/canonical-user-access.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, server);
  assert.equal(server.exports.isSuperAdminRole(' SUPER-ADMIN '), true);
  for (const role of ['admin','manager','rep','']) assert.equal(server.exports.isSuperAdminRole(role), false, role);

  const auraRuntime = read('assets/app-runtime.js');
  const voiceStore = read('supabase/functions/_shared/aura-voice-store.ts');
  const auraAuth = read('supabase/functions/_shared/aura-auth.ts');
  const migration = read('supabase/migrations/20261101050000_v23129_super_admin_role.sql');
  const legacyCandidate = auraRuntime.slice(auraRuntime.indexOf('function isAuraProfileCandidate()'), auraRuntime.indexOf('function isAuraWidgetAuthorized()'));
  const routerCandidate = auraRuntime.slice(auraRuntime.indexOf('function isAuraRouterProfileCandidate()'), auraRuntime.indexOf('function isAuraRouterWidgetAuthorized()'));
  assert.match(legacyCandidate, /isAuthenticatedExecutiveUser\('use_aura_assistant'\)/);
  assert.doesNotMatch(legacyCandidate, /dylan_collyge/);
  assert.doesNotMatch(routerCandidate, /dylan_collyge|isAuraOwner/);
  assert.match(auraRuntime, /aura-standby-control[\s\S]*?standby\.style\.display = standby\.hidden \? 'none' : ''/);
  assert.doesNotMatch(voiceStore, /isCanonicalAuraOwner/);
  assert.match(voiceStore, /capabilities\.auraEnabled !== true/);
  assert.doesNotMatch(voiceStore, /allowedRoles/);
  assert.doesNotMatch(auraAuth, /dylan_collyge|isCanonicalAuraOwner/);
  assert.match(auraAuth, /normalize\(session\.username \|\| ""\) === normalize\(profile\.username\)/);
  assert.match(migration, /user_access_capability_v23129\(actor\.id,'use_aura_assistant'\)/);
  const releaseMigration = read('supabase/migrations/20261022_inventory_projects_v1.sql');
  assert.match(releaseMigration, /actor_role not in \(''ADMIN'',''ADMINISTRATOR'',''MANAGER'',''REP'',''SALESREP'',''CSR''\)/);
});

test('unverified and revoked sessions cannot use the administrator UI grant', () => {
  const start = html.indexOf('        function isFullAppAdministrator(');
  const end = html.indexOf('\n        function ', start + 1);
  const context = { PRIVILEGED_MANAGER_USER_KEYS: ['dylan_collyge', 'megan_kelly', 'jd_jones'],
    currentUser: 'dylan_collyge', nativeAuthSessionActive: true, nativeAuthSessionUserId: 'owner',
    nativeAuthProfile: { id: 'owner', username: 'dylan_collyge', role:'super-admin' }, window: {},
    resolveUserAccessMatrix:username=>({role:username==='dylan_collyge'?'super-admin':'Admin'}),isSuperAdminRoleValue:role=>role==='super-admin' };
  vm.createContext(context); vm.runInContext(html.slice(start, end), context);
  assert.equal(context.isFullAppAdministrator(), true);
  context.currentUser = 'other_admin';
  assert.equal(context.isFullAppAdministrator(), false);
  context.currentUser = 'dylan_collyge'; context.nativeAuthSessionUserId = 'another-account';
  assert.equal(context.isFullAppAdministrator(), false);
  context.nativeAuthSessionUserId = 'owner';
  context.window.GncUserAccessControl = { getSelfState: () => ({ denied: true }) };
  assert.equal(context.isFullAppAdministrator(), true, 'a stale access fallback cannot revoke the active native profile');
  context.nativeAuthProfile.active = false;
  assert.equal(context.isFullAppAdministrator(), false);
});

test('background Home rendering retains the active Manager module', () => {
  const ctx = vm.createContext({ activeHomeTab: 'access-control', selectedProductivityUser: 'dylan_collyge',
    getCurrentVisibleViewId: () => 'managers', document: { getElementById: () => { throw new Error('inactive Home DOM touched'); } } });
  vm.runInContext(html.match(/        function renderHome\([^]*?^        }/m)[0], ctx);
  ctx.renderHome();
  assert.equal(ctx.activeHomeTab, 'access-control');
});

test('canonical row writes require verified table grants and exact ownership', assertSharedRowAccess);

test('Jorge server guard accepts exact and legacy Assigned Items ownership and rejects every unassigned row', async () => {
  const rowsByTable = {
    ph_master_inventory: [
      { unique_id: 'row-exact', itemcode: 'ABC.001', locationcode: 'A.01.000', lotcode: '27.F1' },
      { unique_id: 'row-legacy', itemcode: 'LEG.002', locationcode: 'B.02.000', lotcode: '27.F1' },
      { unique_id: 'row-blocked', itemcode: 'NO.003', locationcode: 'C.03.000', lotcode: '27.F1' },
    ],
    ph_inventory_row_assignments: [
      { master_unique_id: 'row-exact', itemcode: 'ABC.001', assignedto: 'Jorge Colunga', present_in_drive: true },
    ],
    ph_warehouse_assigned_items: [
      { itemcode: 'LEG.002', itemcode_normalized: 'LEG.002', assignedto: 'Colunga, Jorge', present_in_drive: true },
    ],
  };
  const calls = [];
  const supabase = { from(table) {
    calls.push(table);
    let rows = [...(rowsByTable[table] || [])];
    const chain = {
      select() { return chain; },
      maybeSingle() { return Promise.resolve({data:rows[0]||null,error:null}); },
      in(field, values) { rows = rows.filter(row => values.includes(row[field])); return chain; },
      eq(field, value) { rows = rows.filter(row => row[field] === value); return chain; },
      then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
    };
    return chain;
  } };
  const jorge = { username: 'jorge_colunga', role: 'EVAL' };
  assert.equal(await assertInventoryLiveChangeActorRows(supabase, jorge, [{ uniqueId: 'row-exact', itemcode: 'ABC.001' }]), true);
  assert.equal(await assertInventoryLiveChangeActorRows(supabase, jorge, [{ uniqueId: 'row-legacy', itemcode: 'LEG.002' }]), true);
  await assert.rejects(assertInventoryLiveChangeActorRows(supabase, jorge,
    [{ uniqueId: 'row-blocked', itemcode: 'NO.003' }]), /INVENTORY_LIVE_CHANGE_JORGE_ROW_NOT_ASSIGNED/);
  const beforeGlobal = calls.length;
  for (const username of ['dylan_collyge', 'megan_kelly', 'jd_jones', 'mitch_kaiser']) {
    assert.equal(await assertInventoryLiveChangeActorRows(supabase, { username, role: 'EVAL' },
      [{ uniqueId: 'row-blocked', itemcode: 'NO.003' }]), true);
  }
  assert.equal(calls.length, beforeGlobal + 4, 'global live-change users check the matrix without assignment lookups');
  assert.ok(calls.slice(beforeGlobal).every(table=>table==='user_access'));
});

test('only the admin trio can view Home imported filenames', () => {
  const ctx=vm.createContext({currentUser:''});
  vm.runInContext(html.match(/        function canViewDashboardSyncStatus\([^]*?^        }/m)[0],ctx);
  for (const user of ['dylan_collyge','megan_kelly','jd_jones','nelly_aguilar','brian_hatfield','']) {
    ctx.currentUser=user;
    assert.equal(ctx.canViewDashboardSyncStatus(),['dylan_collyge','megan_kelly','jd_jones'].includes(user));
  }
});

test('Request requester choices allow only REP, CSR, Admin and active mapped reps with readable names', () => {
  const ctx = vm.createContext({
    normalizeRoleAccessToken: value => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''),
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? '',
    normalizePushUsername: value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
    normalizeRequestSalesrepId: value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''),
    normalizeRepDisplayOrder: value => String(value || '').trim().replace(/\b\w/g, char => char.toUpperCase()),
    normalizeRepMatchToken: value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    buildRequestModalRepOption(label, metadata) { const token = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); return { label, token, collapsedToken: token.replace(/\s+/g, ''), ...metadata }; },
  });
  vm.runInContext(shellFunction('isRequestRepRoleValue') + shellFunction('normalizeRequestRepUserOption'), ctx);
  for (const role of ['REP', 'rep', 'Sales Rep', 'sales_rep', 'salesrep', 'Sales', 'CSR', 'Customer Service', 'Sales Office', 'Office', 'Admin', 'Administrator', 'Manager']) {
    assert.equal(ctx.isRequestRepRoleValue(role), true, role);
  }
  for (const role of ['Eval', 'Evaluator', 'Production', 'QC', 'Docks']) assert.equal(ctx.isRequestRepRoleValue(role), false, role);
  assert.equal(ctx.normalizeRequestRepUserOption({ username: 'chris_evans', role: 'CSR' }).label, 'Chris Evans');
  assert.equal(ctx.normalizeRequestRepUserOption({ username: 'eval_user', role: 'Evaluator' }), null);
  const allowed = vm.createContext({
    requestModalRepUserOptions: [
      { label: 'Chris Evans', role: 'CSR', username: 'chris_evans', token: 'chris evans', collapsedToken: 'chrisevans' },
      { label: 'Hidden Eval', role: 'Evaluator', username: 'hidden_eval', token: 'hidden eval', collapsedToken: 'hiddeneval' },
    ],
    getRequestMappedRepDirectory: () => ({ options: [{ label: 'Kevin Effinger', salesrepId: 'S01', salesrepIds: ['S01'], token: 'kevin effinger', collapsedToken: 'kev ineffinger' }] }),
    normalizeRoleAccessToken: ctx.normalizeRoleAccessToken,
    normalizeRepMatchToken: ctx.normalizeRepMatchToken,
    normalizePushUsername: ctx.normalizePushUsername,
    normalizeRequestSalesrepId: ctx.normalizeRequestSalesrepId,
    normalizeRepDisplayOrder: value => String(value || '').trim(),
    buildRequestModalRepOption: (label, metadata) => ({ label, token: 'kevin effinger', collapsedToken: 'kevineffinger', ...metadata }),
  });
  vm.runInContext(shellFunction('isRequestRepRoleValue') + shellFunction('getAllowedRequestModalRepOptions'), allowed);
  const options = Array.from(allowed.getAllowedRequestModalRepOptions());
  assert.deepEqual(options.map(option => option.label).sort(), ['Chris Evans', 'Kevin Effinger']);
  assert.equal(options.find(option => option.label === 'Kevin Effinger').salesrepId, 'S01');
  const dedupe = vm.createContext({ normalizePushUsername: ctx.normalizePushUsername });
  vm.runInContext(shellFunction('dedupeRequestModalRepUsers'), dedupe);
  const identities = dedupe.dedupeRequestModalRepUsers([
    { username: 'person_one', label: 'Alex Smith', role: 'REP' },
    { username: 'person_one', label: 'Alex Smith', role: 'REP' },
    { username: 'person_two', label: 'Alex Smith', role: 'CSR' },
  ]);
  assert.equal(identities.length, 2, 'dedupe by canonical username rather than display name');
  assert.match(html, /if \(!isRequestRepRoleValue\(role\)\) return null/);
  assert.match(html, /function getAllowedRequestModalRepOptions\(\)[\s\S]{0,1200}const eligibleUsers = \[\.\.\.requestModalRepUserOptions\.filter\(option => isRequestRepRoleValue\(option && option\.role\)\)[\s\S]{0,1200}directory\.options\.forEach\(option => add\(option, `rep:/);
  assert.match(html, /key\.startsWith\('rep:'\)\) return \{ rows: sourceRows, shown: sourceRows\.length/);
});

test('Eval Reclass entry and submit require table-granted exact ownership', () => {
  const {ctx} = rowAccessFixture([...rowAccessEngines,'isEvalReclassRowAssigned'],{
    currentUser:'taylor_eval',currentRole:'Evaluator',nativeAuthProfile:{id:'fixture-profile',username:'taylor_eval',role:'EVAL',active:true},
    getRoleAccessState:()=>({isEval:true,isAdmin:false}),
    resolveInventoryRowOwner:row=>row.unique_id==='assigned'?'taylor_eval':'other'
  });
  assert.equal(ctx.isEvalReclassRowAssigned('taylor_eval', { unique_id: 'assigned' }), true);
  assert.equal(ctx.isEvalReclassRowAssigned('taylor_eval', { unique_id: 'other' }), false);
  ctx.currentRole = 'Admin';ctx.currentUser='admin_user';ctx.nativeAuthProfile.username='admin_user';
  ctx.resolveUserAccessMatrix=()=>({verified:true,profile_id:'fixture-profile',role:'Admin',edit_any_row:'Y',view_permissions:{view_drive_mode:'Y'}});
  assert.equal(ctx.isEvalReclassRowAssigned('admin_user', { unique_id: 'other' }), true);
  ctx.currentRole = 'Evaluator';
  assert.equal(ctx.isEvalReclassRowAssigned('dylan_collyge', { unique_id: 'other' }), false);
  const actionContext = vm.createContext({
    currentUser: 'taylor_eval', currentUserDisplay: 'Taylor Eval',
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') ?? '',
    canUserMakeLiveChangesOnRow: (user,row) => actionContext.isRowAssignedToUser(user,row),
    getRoleAccessState: () => ({ isEval: true, isAdmin: false, isRepLike: false }),
    isAlwaysDriveCardOptionsUser: () => false,
    isRowAssignedToUser: (user, row) => ['taylor_eval', 'taylor_eval'].includes(String(user || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')) && row?.unique_id === 'assigned',
  });
  vm.runInContext(shellFunction('isWarehouseAssignedDriveCardForCurrentUser') + shellFunction('canCurrentUserUseDriveCardOptions'), actionContext);
  assert.equal(actionContext.canCurrentUserUseDriveCardOptions({ unique_id: 'assigned' }, 'drive'), true);
  assert.equal(actionContext.canCurrentUserUseDriveCardOptions({ unique_id: 'other' }, 'drive'), false);
  assert.match(api, /roleKey === "EVAL" \|\| roleKey === "EVALUATOR"/);
  assert.match(api, /ph_inventory_row_assignments[\s\S]*?ph_warehouse_assigned_items/);
  assert.match(api, /INVENTORY_LIVE_CHANGE_EVAL_ROW_NOT_ASSIGNED/);
  assert.match(api, /Evaluators may submit Reclass changes only for rows assigned to them/);
  assert.match(html, /if \(!isEvalReclassRowAssigned\(currentUser \|\| currentUserDisplay, item\)\)/);
  assert.match(html, /if \(!state \|\| state\.submitting \|\| !canSubmitArgosReclassForRow\(state\.item\)\)/);
  assert.match(api, /normalizeUsername\(String\(activeProfile\.display_name \|\| ""\)\)/);
});

test('Reclass opens on the item name and size followed directly by larger location cards', () => {
  const shell = readComposedAppSource();
  const modalStart = shell.indexOf('        function ensureArgosInventoryTransactionModal(');
  const modalEnd = shell.indexOf('\n        function ', modalStart + 1);
  const modal = shell.slice(modalStart, modalEnd);
  const editorStart = shell.indexOf('        function renderArgosReclassInquiryEditor(');
  const editorEnd = shell.indexOf('\n        function ', editorStart + 1);
  const editor = shell.slice(editorStart, editorEnd);
  assert.match(shell, /titleEl\.textContent = `\$\{snapshot\.commonName \|\| ''\} \$\{snapshot\.contSize \|\| ''\}`/);
  assert.doesNotMatch(modal, /argos-inventory-transaction-(?:subtitle|notice|source)|argos-tx-tabs/);
  assert.doesNotMatch(editor, /Choose an action on each row|renderArgosReclassHoldScopeNotice/);
  const styles = read('assets/app-shell-style-05.css');
  assert.match(styles, /\.argos-reclass-row-toggle\{min-height:6rem;padding:1\.125rem 1\.25rem\}/);
  assert.match(styles, /\.argos-reclass-row-toggle-copy>span:first-child\{font-size:1\.25rem/);
});

test('processed-file toast storage is strictly Dylan-only while revision reads stay no-store', () => {
  const source = shellFunction('processDylanFileProcessedToasts');
  assert.match(source, /username !== 'dylan_collyge'/);
  assert.match(source, /gnc_dylan_last_toasted_files_v2|DYLAN_FILE_TOAST_STORAGE_KEY/);
  assert.match(source, /processed — Supabase updated/);
  assert.match(shellFunction('postAppFunctionJson'), /cache: 'no-store'/);
  assert.match(api, /HOME_SYNC_METADATA_KEYS = \[[^\]]*"hl_po_parsed"/);
});

test('Eval-user filters retain crop roles while Que owner switching stays administrator-only', () => {
  const source = shellFunction('canUserFilterEvalUsers');
  assert.match(source, /EVAL_USER_FILTER_USERS/);
  assert.match(html, /EVAL_USER_FILTER_USERS = new Set\(\['dylan_collyge', 'megan_kelly', 'jd_jones', 'mitch_kaiser'\]\)/);
  assert.match(source, /access\?\.isAdmin/);
  assert.match(shellFunction('canUseCropRollEvalUserFilter'), /canUserFilterEvalUsers/);
  const queueOwnerFilter = shellFunction('canUseRequestSuspendTagAssignedToFilter');
  assert.match(queueOwnerFilter, /queueAccessScope\('suspend-tag'\)/);
  const scope = shellFunction('queueAccessScope');
  assert.match(scope, /matrix\?\.view_all_suspend/);
  assert.match(scope, /'dylan_collyge','jd_jones','megan_kelly'/);
  assert.doesNotMatch(queueOwnerFilter, /isAuthenticatedExecutiveUser/);
});

test('verified administrator controls remain available during a same-account refresh', () => {
  const source=(read('assets/access-matrix-policy.js')+'\n'+read('assets/user-access-control.js'));
  const ctx=vm.createContext({selfStatus:'loading',selfDenied:false,selfRecord:{verified:true,profile:{id:'actor',username:'dylan_collyge',role:'super-admin'},effective_permissions:{can_manage_user_access:true}},
    getIdentity:()=>({id:'actor',username:'dylan_collyge'}),resolveUserAccessMatrix:()=>({manage_user_access:'Y'}),yn:value=>value,isSuperAdminRole:role=>role==='super-admin'});
  vm.runInContext(source.match(/    function isVerifiedManager\([^]*?^    }/m)[0],ctx);
  assert.equal(ctx.isVerifiedManager(),true);
  ctx.selfDenied=true; assert.equal(ctx.isVerifiedManager(),false);
});

test('full-app administrators ignore stale Tasks-only overrides and produce the eight requested footer entries', () => assertAdminShortcuts({ read }));

test('transient access and navigation fallbacks cannot revoke Dylan or pause live refresh', () => {
  const accessContext = shellFunction('getProductionLiveSyncContext');
  const userAccess = (read('assets/access-matrix-policy.js')+'\n'+read('assets/user-access-control.js'));
  assert.doesNotMatch(accessContext, /getSelfState[^]*denied/);
  assert.match(accessContext, /accessDeniedConfirmed = context\.accessDenied/);
  assert.match(coordinator, /ctx\.accessDenied === true && ctx\.accessDeniedConfirmed !== false/);
  assert.match(coordinator, /ctx\.authenticated === false[^]*Keeping the last verified data while the session refreshes/);
  assert.match(userAccess, /USER_ACCESS_UNAVAILABLE\|PROFILE_PENDING\|RETRY\|TIMEOUT\|NETWORK[^]*return false/);
  assert.match(api, /action === "native_session_bridge"[^]*resolveZeroTrustRequestContext\(session\)/);
  assert.match(api, /normalizeUsername\(session\.username\) === "dylan_collyge"[^]*\? "admin"/);
});

test('canonical rep matching works for every spelling while the universal Request directory stays JD-only', () => {
  const ctx = vm.createContext({ Set, String, normalizeRequestSalesrepId: value => String(value || '').trim().toUpperCase() });
  for (const name of ['normalizeRepMatchToken', 'normalizeRepDisplayOrder', 'getRepNameLookupTokens', 'matchSalesRepIdentity']) {
    vm.runInContext(shellFunction(name), ctx);
  }
  for (const [firstLast, lastFirst, username] of [
    ['Kevin Effinger', 'Effinger, Kevin', 'kevin_effinger'],
    ['Abbey Burka', 'Burka, Abbey', 'abbey_burka'],
    ['Ben Harveson', 'Harveson, Ben', 'ben_harveson'],
    ['Brian Hatfield', 'Hatfield, Brian', 'brian_hatfield'],
    ['Troy Lee', 'Lee, Troy', 'troy_lee'],
  ]) {
    assert.equal(ctx.matchSalesRepIdentity(firstLast, lastFirst), true, lastFirst);
    assert.equal(ctx.matchSalesRepIdentity(firstLast, username), true, username);
  }
  const appRuntime = read('assets/app-runtime.js');
  const runtime = appRuntime.slice(appRuntime.indexOf('function isUniversalRequestDirectoryRep('), appRuntime.indexOf('\n        function getRequestSelectedSalesrepId(', appRuntime.indexOf('function isUniversalRequestDirectoryRep(')));
  assert.match(appRuntime, /buildSalesRepCustomerDirectory[\s\S]*customerRepMapRows[\s\S]*socInventory[\s\S]*reservesInventory[\s\S]*requestsInventory[\s\S]*requestHistoryInventory/);
  assert.match(appRuntime, /buildRequestModalNaCustomerOption\(selectedSalesrepId\)/);
  assert.doesNotMatch(appRuntime, /No active mapped customers found for this sales rep/);
  assert.match(runtime, /return actorUsername === 'jd_jones'/,
    'universal scope follows the authenticated JD actor regardless of the selected rep');
  assert.match(appRuntime, /cachedOptions\.universal !== true/);
  assert.match(appRuntime, /mergeRequestModalCustomerOptions\(Array\.from\(options\.values\(\)\), \[buildRequestModalNaCustomerOption\(id\)\]\)/,
    'non-JD picker options are limited to exact selected-rep pairs and N/A');
});

test('v2.3.45 watchdog remediations preserve authorized views with ready fallbacks', () => {
  const appApi = read('supabase/functions/app-api/index.ts');
  const auraRouter = read('supabase/functions/aura-llm-router/index.ts');
  const appRuntime = read('assets/app-runtime.js');
  const bunchQueue = read('services/bunchQueue.ts');
  assert.match(appApi, /dataset === "suspend_tag"[^]*?retained: true, retryable: true/);
  assert.match(appApi, /LOC_ON_HAND_REVISION_CHANGED[^]*?handleInventoryRead\(session, payload, canonicalAccess, true\)/);
  assert.match(appApi, /operation === "queue"[^]*?state: "ready"[^]*?operation === "list"[^]*?jobs: \[\], retained: true, state: "ready"/);
  assert.match(auraRouter, /response\.status !== 503[^]*?deterministicFallbackRequired/);
  assert.match(appRuntime, /deterministicFallbackRequired[^]*?requestAuraDeterministicInventoryAnswer/);
  assert.match(appRuntime, /normalizeOptionalBunchRevisionMetadata[^]*?bunch_note_private\.previews/);
  assert.match(bunchQueue, /data\?\.retained === true/);
  assert.match(appRuntime, /PRELOGIN_BACKGROUND_ACTIONS[^]*preLoginBackgroundFallback/);
  assert.match(appRuntime, /Current data could not be verified\. Previous data has been retained\.\x27\) return false/);
  assert.match(appRuntime, /optionalBunchView \|\| viewId === 'docks'/);
  assert.match(appApi, /profilelessActionResponse[^]*navigation_preferences[^]*get_user_preferences[^]*request_work/);
  assert.match(appApi, /APPS_SCRIPT_ACTION_FAILED[^]*transientOkResponse/);
  assert.match(appApi, /failure\.status >= 500[^]*SUSPEND_TAG_UNAVAILABLE/);
  assert.match(appApi, /failOpenInventoryConflict[^]*response\.status !== 409/);
});

test('v2.3.46 keeps Warehouse Assigned Items synchronous, clean, and bounded', () => {
  const appRuntime = read('assets/app-runtime.js');
  const component = read('components/assigned-items/AssignedItems.jsx');
  const styles = read('assets/assigned-items.css');
  assert.match(appRuntime, /const paged = false;[^]*?getManagerAssignedItemsDisplayRows\(\)/);
  assert.doesNotMatch(component, /Loading row/);
  assert.match(component, /if \(field === 'LOTCODE'\) return <span>\{textOf\(row\.LOTCODE\)\}<\/span>/);
  assert.doesNotMatch(component, /LOTCODE[^\n]+rowId/);
  assert.match(styles, /max-height:calc\(100dvh - 230px\);overflow-x:auto;overflow-y:auto/);
  assert.match(styles, /thead th\{position:sticky;top:0;z-index:12;background:#062115/);

  const normalization = vm.createContext({
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    normalizeEvalAssignableUser: value => String(value || '').trim().toLowerCase(),
  });
  vm.runInContext(shellFunction('applyCommittedItemcodeOwnerReceipt') + '\n' + shellFunction('getCropRollPlantGroup') + '\n' + shellFunction('normalizeWarehouseAssignedItemRow'), normalization);
  const row = normalization.normalizeWarehouseAssignedItemRow({ master_unique_id: '007148_030_1_10_C_02_015_25_F1_0_--', itemcode: '007148', lotcode: '25.F1' });
  assert.equal(row.WAREHOUSEI, '10');
  assert.equal(row.LOTCODE, '25.F1');

  const history = vm.createContext({ getManagerItemLowStockTargetsState: () => ({ rowsByCode: new Map([['A', { history_ready: false, history_pending_files: 0 }]]) }) });
  vm.runInContext(shellFunction('isManagerAssignedItemHistoryProcessing'), history);
  assert.equal(history.isManagerAssignedItemHistoryProcessing(), false);
  history.getManagerItemLowStockTargetsState = () => ({ rowsByCode: new Map([['A', { history_ready: false, history_pending_files: 2 }]]) });
  assert.equal(history.isManagerAssignedItemHistoryProcessing(), true);
});

test('v2.3.56 preserves admin evidence authorization, reconciliation, and home layout limits', () => {
  const migration = read('supabase/migrations/20261023220000_drive_location_evidence_and_request_reconciliation_v1.sql');
  const appRuntime = read('assets/app-runtime.js');
  const styles = read('assets/ops-precision-pilot.css');
  assert.match(migration, /save_drive_evidence_v3[^]*actor:=private\.require_active_admin_profile\(\)/);
  assert.match(migration, /revoke all on function public\.save_drive_evidence_v3[^]*from public,anon[^]*grant execute[^]*to authenticated,service_role/);
  assert.match(migration, /revoke all on function public\.reconcile_inventory_location_evidence_v1\(\) from public,anon,authenticated[^]*grant execute[^]*to service_role/);
  assert.match(migration, /revoke all on function public\.reconcile_active_requests_from_outbox_v1\(\) from public,anon,authenticated[^]*grant execute[^]*to service_role/);
  assert.match(api, /operation === "master_page"[^]*reconcile_inventory_location_evidence_v1/);
  assert.match(api, /\["request_queue", "active_request"\]\.includes\(dataset\)[^]*reconcile_active_requests_from_outbox_v1/);
  assert.match(appRuntime, /function getHomeDesktopColumnCount[^]*Math\.min\(total, 3\)[^]*profile\.width < 768[^]*compactHomeLayout \? 2 : getHomeDesktopColumnCount/);
  assert.match(styles, /overflow: hidden !important[^]*:is\(#home-dashboard-grid, #home-rep-dashboard-grid\)[^]*grid-auto-rows: var\(--home-fit-tile-height, 44px\)/);
});

test('Bunch Notes custom dropdown persistence is authenticated and Dylan-write-scoped', () => {
  const appApi = read('supabase/functions/app-api/index.ts');
  assert.match(appApi, /operation === "dropdown_options_read"[\s\S]*ph_app_settings[\s\S]*inv_bunch_notes_custom_dropdowns_v1/);
  assert.match(appApi, /operation === "dropdown_options_save"[\s\S]*actor\.username[\s\S]*dylan_collyge[\s\S]*BUNCH_NOTE_DROPDOWN_OPTIONS_FORBIDDEN/);
  assert.match(appApi, /allowedOptionKeys = new Set\(\["destination_house", "action", "workflow_instructions", "card_notes", "purpose", "direction", "house_plan", "schedule_alert"\]\)/);
  assert.doesNotMatch(appApi, /operation === "dropdown_options_save"[\s\S]{0,1200}TO authenticated/);
});

test('Table Management uses canonical Manager permission and archives never accept mutations', async () => {
  const { validateManagerTableManagementRequest } = await import('../supabase/functions/_shared/table-management.ts');
  const canonical = vm.createContext({});
  const source = api.match(/function canonicalActionGate\([^]*?^}/m)[0];
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, canonical);
  assert.equal(canonical.canonicalActionGate('manager_table_management', {}).flag, 'can_access_manager_tab');
  for (const username of ['dylan_collyge','megan_kelly','jd_jones','evaluator_example','sales_rep_example']) {
    const request = validateManagerTableManagementRequest({ action: 'manager_table_management', operation: 'create', table: 'inquiry-coverage', payload: { primary_user: username, backup_user: 'another_active_user', scope: 'all', active: true, command_id: '00000000-0000-4000-8000-000000000001' } });
    assert.equal(request.payload.primary_user, username);
  }
  for (const table of ['historical-drive-mode','historical-soc-open-orders','historical-soc-reserves','historical-requests','photo-history']) {
    assert.throws(() => validateManagerTableManagementRequest({ action: 'manager_table_management', operation: 'delete', table, payload: {} }), /READ_ONLY/);
  }
});


test('Request master denial controls access while enabled users can choose every rep', () => assertCurrentRequestMatrix({ read }));


test('access matrix preload fixture permits only its exact bounded authenticated read',()=>{
 const base={method:'GET',origin:'http://127.0.0.1:4173',url:RELEASE_SMOKE_SUPABASE_ORIGIN+'/rest/v1/user_access?select=*&order=username.asc&limit=1000'};
 assert.equal(classifyReleaseSmokeRoute(base).allowed,true);assert.equal(classifyReleaseSmokeRoute({...base,url:base.url+'&actor_id=forged'}).allowed,false);assert.equal(classifyReleaseSmokeRoute({...base,method:'PATCH'}).allowed,false);assert.equal(classifyReleaseSmokeRoute({...base,url:base.url.replace('1000','1001')}).allowed,false);
});
