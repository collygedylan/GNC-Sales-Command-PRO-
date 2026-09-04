import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appAuth = fs.readFileSync(new URL('../supabase/functions/_shared/app-auth.ts', import.meta.url), 'utf8');
const appApi = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260904003007_sales_marketing_and_kayla_limited_access.sql', import.meta.url), 'utf8');

test('sales/marketing is a known limited role in the client and server', () => {
  assert.match(html, /isSalesMarketingRoleValue[\s\S]*SALESMARKETING/);
  assert.match(html, /isKnownLimitedRole = isRepLike \|\| isSalesMarketing/);
  assert.match(html, /isSalesMarketing && !isAdmin[\s\S]*\['drive', 'tasks'\]/);
  assert.match(appAuth, /const isSalesMarketing = compactRole === "SALESMARKETING"/);
  assert.match(appAuth, /!isQc && !isSalesMarketing/);
  assert.match(appAuth, /isSalesMarketing[\s\S]*\["drive", "tasks"\]/);
  assert.match(appApi, /SALES_MARKETING_READ_TABLES/);
  assert.match(appApi, /if \(access\.isSalesMarketing\) return SALES_MARKETING_READ_TABLES\.has\(table\)/);
});

test('sales/marketing Tasks is restricted to Season Sales Notes', () => {
  assert.match(html, /getAvailableTaskViewValues[\s\S]*access\.isSalesMarketing[\s\S]*return \['av-blanks'\]/);
  assert.match(html, /normalizeTaskFilterValue[\s\S]*access\.isSalesMarketing[\s\S]*return 'season'/);
  assert.match(html, /getDefaultTaskSubviewForView[\s\S]*access\.isSalesMarketing[\s\S]*return 'season'/);
  assert.match(html, /getTaskFilterValues[\s\S]*access\.isSalesMarketing[\s\S]*return \['season'\]/);
  assert.match(html, /safeFilter === 'season'\) return 'SEASON SALES NOTES'/);
});

test('Kayla limited access management is live, user-only, role-bounded, and audited', () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /lower\(btrim\(p\.username\)\) = 'kayla_knepp'/);
  assert.match(migration, /in \('CSR', 'SALESREP', 'SALESMARKETING'\)/);
  assert.match(migration, /target_type_value <> 'user'/);
  assert.match(migration, /permission_kind = 'module'/);
  assert.match(migration, /module_key not in \('managers', 'access-control', 'disease-pest', 'pest-management'\)/);
  assert.match(migration, /create table if not exists private\.app_limited_access_events/);
  assert.match(migration, /revoke all on table private\.app_limited_live_overrides from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.save_limited_access_override_v1\(integer, jsonb, text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.save_limited_access_override_v1\(integer, jsonb, text\) to authenticated/);
  assert.match(migration, /commit;\s*$/);
});

test('Kayla receives only the bounded matrix and uses the protected live save RPC', () => {
  assert.match(html, /isKaylaLimitedAccessManagerUser\(\) \? 'get_limited_access_control_matrix_v1' : 'get_access_control_matrix_v2'/);
  assert.match(html, /editScope === 'limited-users'/);
  assert.match(html, /limitedLive \? 'save_limited_access_override_v1' : 'save_access_control_draft_v1'/);
  assert.match(html, /canPublishAccessControl\(\)/);
  assert.match(html, /Limited Live Access/);
  assert.match(html, /Managed Users Only/);
});

test('the Sales/Marketing role defaults are Drive and Tasks only', () => {
  const roleSeed = migration.slice(0, migration.indexOf('create table if not exists private.app_limited_live_overrides'));
  assert.match(roleSeed, /'SALESMARKETING'/);
  assert.match(roleSeed, /'module\.drive\.view', 'module\.tasks\.view'/);
  assert.doesNotMatch(roleSeed, /module\.managers\.view/);
});
