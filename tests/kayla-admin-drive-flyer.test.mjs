import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('index.html');
const edge = read('supabase/functions/app-api/index.ts');
const migration = read('supabase/migrations/20260828153252_promote_kayla_admin_drive_flyer_access.sql');
const flyerAccessMigration = read('supabase/migrations/20260903013541_repair_reclass_task_flyer_access_v1.sql');
const accessMigration = read('supabase/migrations/20260828024750_centralized_access_control_audit_v1.sql');

test('Kayla promotion is transactional, identity-linked, active-only, and audited', () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /where lower\(btrim\(username\)\) = 'kayla_knepp'[\s\S]*for update/);
  assert.match(migration, /where id = v_profile\.legacy_user_id[\s\S]*lower\(btrim\(username\)\) = 'kayla_knepp'/);
  assert.match(migration, /update public\.profiles[\s\S]*set role = 'ADMIN'/);
  assert.match(migration, /update public\.ph_app_users[\s\S]*set role = 'ADMIN'/);
  assert.match(migration, /PROMOTE_STANDARD_ADMIN/);
  assert.match(migration, /private\.role_access_change_events/);
  assert.match(migration, /revoke all on table private\.role_access_change_events from public, anon, authenticated/);
  assert.match(migration, /commit;\s*$/);
});

test('Drive evidence RPC is Admin-only, exact-row, stale-safe, and field-limited', () => {
  const rpc = migration.slice(
    migration.indexOf('create or replace function public.save_drive_evidence_v1'),
    migration.indexOf('create or replace function public.create_flyer_folder_batch_v1')
  );
  assert.match(rpc, /private\.require_active_admin_profile\(\)/);
  assert.match(rpc, /where unique_id = btrim\(p_master_uid\)[\s\S]*for update/);
  assert.match(rpc, /DRIVE_ROW_IDENTITY_CONFLICT/);
  assert.match(rpc, /DRIVE_ROW_STALE/);
  assert.match(rpc, /UNSUPPORTED_DRIVE_EVIDENCE_FIELD/);
  for (const allowed of ['spec', 'caliper', 'match', 'loc_match_qty', 'initial_ptr', 'av_note', 'pick_note', 'comments', 'photo_link', 'photo_name']) {
    assert.match(rpc, new RegExp(`'${allowed}'`));
  }
  const masterUpdate = rpc.slice(rpc.indexOf('update public.ph_master_inventory'), rpc.indexOf('returning * into v_saved'));
  assert.doesNotMatch(masterUpdate, /\boh\b|priority|holdstop|movement|assignedto/);
  assert.match(rpc, /update public\.ph_active_request[\s\S]*where master_id = v_row\.unique_id/);
  assert.match(rpc, /IDEMPOTENCY_CONFLICT/);
  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger on public\.ph_master_inventory from anon, authenticated/);
});

test('Native Auth Drive saves and protected photos cannot fall back to direct Storage', () => {
  assert.match(html, /saveSecureDriveEvidence\(itemToSave, prefix, payload, isComplete\)/);
  assert.match(html, /supabaseRpc\('save_drive_evidence_v1'/);
  assert.match(html, /p_master_uid:[\s\S]*p_expected_itemcode:[\s\S]*p_expected_locationcode:[\s\S]*p_expected_lotcode:/);
  assert.match(html, /PROTECTED_DRIVE_PHOTO_PREFIXES\.has[\s\S]*throw \(secureUploadError/);
  assert.match(html, /masterUid:[\s\S]*itemCode:[\s\S]*locationCode:[\s\S]*lotCode:/);
  assert.match(edge, /PROTECTED_DRIVE_PHOTO_PREFIXES/);
  assert.match(edge, /if \(!access\.isAdmin\)/);
  assert.match(edge, /from\("ph_master_inventory"\)[\s\S]*eq\("unique_id", protectedMasterUid\)/);
  assert.match(edge, /drive_photo_row_conflict/);
});

test('Flyer batches use authoritative rows, active users, atomic history, and retry recovery', () => {
  const rpc = migration.slice(migration.indexOf('create or replace function public.create_flyer_folder_batch_v1'));
  assert.match(rpc, /from public\.profiles[\s\S]*disabled_at is null[\s\S]*locked_until/);
  assert.match(rpc, /from public\.ph_master_inventory m[\s\S]*where m\.unique_id = any\(v_master_uids\)/);
  assert.match(rpc, /insert into public\.ph_flyer_folder_rows/);
  assert.match(rpc, /insert into public\.ph_flyer_folder_history/);
  assert.match(rpc, /on conflict \(unique_id\) do update/);
  assert.ok(rpc.indexOf('from private.flyer_folder_batch_idempotency') < rpc.indexOf('FLYER_FOLDER_ALREADY_EXISTS'));
  assert.match(html, /supabaseRpc\('create_flyer_folder_batch_v1'/);
  assert.match(html, /p_master_uids: masterUids/);
  assert.match(html, /p_assignee_usernames: selectedAssignees/);
  assert.doesNotMatch(html.slice(html.indexOf('async function createFlyerFolderRowsForItems'), html.indexOf('async function createDriveQuickFlyers')), /supabaseFetch\(FLYER_FOLDER_ROWS_TABLE, 'POST'/);
});

test('Flyer creation is server-authorized for active Admins, Dylan, and Megan without a stale client role gate', () => {
  assert.match(flyerAccessMigration, /^begin;/);
  assert.match(flyerAccessMigration, /create or replace function private\.require_active_flyer_creator_profile\(\)/);
  assert.match(flyerAccessMigration, /disabled_at is not null/);
  assert.match(flyerAccessMigration, /locked_until is not null[\s\S]*locked_until > now\(\)/);
  assert.match(flyerAccessMigration, /v_role in \('ADMIN', 'ADMINISTRATOR'\)/);
  assert.match(flyerAccessMigration, /v_username in \('dylan_collyge', 'megan_kelly'\)/);
  assert.match(flyerAccessMigration, /pg_catalog\.pg_get_functiondef/);
  assert.match(flyerAccessMigration, /private\.require_active_flyer_creator_profile\(\)/);
  assert.match(flyerAccessMigration, /FLYER_CREATE_AUTH_GUARD_MISMATCH/);
  assert.match(flyerAccessMigration, /revoke all on function public\.create_flyer_folder_batch_v1[\s\S]*from public, anon/);
  assert.match(flyerAccessMigration, /grant execute on function public\.create_flyer_folder_batch_v1[\s\S]*to authenticated/);
  assert.match(flyerAccessMigration, /commit;\s*$/);

  const clientCreate = html.slice(
    html.indexOf('function showFlyerFolderCreationFailure'),
    html.indexOf('async function createDriveQuickFlyers')
  );
  assert.match(clientCreate, /if \(!nativeAuthSessionActive\)/);
  assert.doesNotMatch(clientCreate, /getRoleAccessState\(\)\.isAdmin/);
  assert.match(clientCreate, /supabaseRpc\('create_flyer_folder_batch_v1'/);
  assert.match(clientCreate, /showFlyerFolderCreationFailure\(err\)/);
  assert.doesNotMatch(clientCreate, /showToast\('Error', err && err\.message/);
});

test('Dylan and Megan can open Reclass for every Drive row regardless of AssignedTo', () => {
  const driveOptions = html.slice(
    html.indexOf('const DRIVE_CARD_OPTIONS_ALWAYS_USERS'),
    html.indexOf('function canCurrentUserSelectDriveWorkflowRow')
  );
  assert.match(driveOptions, /DRIVE_CARD_OPTIONS_ALWAYS_USERS[\s\S]*'dylan_collyge'[\s\S]*'megan_kelly'/);
  const gate = driveOptions.slice(driveOptions.indexOf('function canCurrentUserUseDriveCardOptions'));
  assert.ok(gate.indexOf('isAlwaysDriveCardOptionsUser') < gate.indexOf('isWarehouseAssignedDriveCardForCurrentUser'));
  assert.match(gate, /if \(isAlwaysDriveCardOptionsUser\(userOverride, displayOverride\)\) return true/);
});

test('role refresh invalidates role-scoped caches without granting policy-maintainer access', () => {
  assert.match(html, /refreshNativeRoleAndCapabilities\('foreground'\)/);
  assert.match(html, /event === 'TOKEN_REFRESHED' \|\| event === 'SIGNED_IN' \|\| event === 'USER_UPDATED'/);
  assert.match(html, /clearRoleScopedClientCaches\(profile\.username \|\| currentUser\)/);
  assert.match(html, /initializeRequestCapabilities\(\{ force: true/);
  assert.match(html, /initializeAppAccessSnapshot\(\{ force: true/);
  const maintainerSeed = accessMigration.slice(
    accessMigration.indexOf('insert into private.app_access_maintainers'),
    accessMigration.indexOf('insert into private.app_access_permissions')
  );
  assert.match(maintainerSeed, /dylan_collyge/);
  assert.match(maintainerSeed, /megan_kelly/);
  assert.match(maintainerSeed, /jd_jones/);
  assert.doesNotMatch(maintainerSeed, /kayla_knepp/);
});
