import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const api = read('supabase/functions/app-api/index.ts');
const authAdmin = read('supabase/functions/auth-admin/index.ts');
const migration = read('supabase/migrations/20261028222500_agdata_user_lifecycle_v2397.sql');
const editor = read('assets/user-access-control.js');
const runtime = read('assets/app-runtime.js');

test('user lifecycle stays on the canonical admin and dual credential boundaries', () => {
  assert.match(authAdmin, /role\.includes\("ADMIN"\).*role\.includes\("MANAGER"\)/s);
  assert.match(authAdmin, /provision_native_auth_app_user/);
  assert.match(authAdmin, /sync_native_auth_app_access_code_v2397/);
  assert.match(authAdmin, /reconciliationRequired: true/);
  assert.match(migration, /update public\.ph_app_users set password=p_access_code/);
  assert.match(migration, /update public\.profiles set must_change_password=true/);
  assert.match(migration, /update public\.user_access_control set active=false/);
  assert.match(migration, /update public\.profiles set disabled_at=statement_timestamp\(\)/);
  assert.match(migration, /update public\.ph_app_users set disabled_at=statement_timestamp\(\)/);
  assert.match(migration, /USER_ACCESS_SELF_DEACTIVATION_FORBIDDEN/);
  assert.match(migration, /USER_ACCESS_LAST_ADMIN_FORBIDDEN/);
  assert.match(migration, /update public\.profiles set display_name=v_display_name,role=v_role/);
  assert.match(migration, /update public\.ph_app_users set role=v_role/);
  assert.match(migration, /USER_ACCESS_ADMIN_ROLE_IMMUTABLE/);
  assert.match(api, /"deactivate_user"/);
  assert.match(editor, /data-user-create/);
  assert.match(editor, /data-user-reset-code/);
  assert.match(editor, /data-user-deactivate/);
  assert.match(editor, /data-user-profile-save/);
  assert.match(editor, /access codes are write-only/i);
  assert.match(runtime, /functions\.invoke\('auth-admin'/);
  assert.doesNotMatch(editor, /access_code\s*[:=]\s*user\./i);
});
