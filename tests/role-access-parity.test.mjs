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

test('AURA owner is canonical Dylan only across browser, Edge voice, and the SQL capability RPC', async () => {
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
  assert.match(auraRuntime, /username === 'dylan_collyge'[\s\S]*?GncUserAccessControl\?\.isAuraOwner/);
  assert.match(auraRuntime, /aura-standby-control[\s\S]*?standby\.style\.display = standby\.hidden \? 'none' : ''/);
  assert.match(voiceStore, /!isCanonicalAuraOwner\(actor\.username\)/);
  assert.doesNotMatch(voiceStore, /allowedRoles/);
  assert.match(auraAuth, /isCanonicalAuraOwner\(session\.username\)/);
  assert.match(migration, /coalesce\(lower\(btrim\(actor\.username\)\),''''\)<>''dylan_collyge''/);
  assert.match(migration, /AURA_ACCESS_RPC_GRANTS_CHANGED/);
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
