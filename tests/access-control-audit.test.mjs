import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260828024750_centralized_access_control_audit_v1.sql', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const health = fs.readFileSync(new URL('../scripts/probe-production-auth-health.mjs', import.meta.url), 'utf8');
const canary = fs.readFileSync(new URL('./production-request-canary.spec.ts', import.meta.url), 'utf8');

test('access policy storage is private, normalized, immutable-audited, and audit-only', () => {
  for (const table of [
    'app_access_permissions',
    'app_access_policy_versions',
    'app_access_role_grants',
    'app_access_user_overrides',
    'app_access_maintainers',
    'app_access_change_events',
    'app_access_legacy_checks',
    'app_access_runtime_state'
  ]) {
    assert.match(migration, new RegExp(`create table if not exists private\\.${table}`));
    assert.match(migration, new RegExp(`alter table private\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table private\\.${table} from public, anon, authenticated`));
  }
  assert.match(migration, /enforcement_mode text not null default 'audit'/);
  assert.doesNotMatch(migration, /update\s+private\.app_access_runtime_state[\s\S]{0,240}enforcement_mode\s*=\s*'enforced'/i);
  assert.match(migration, /event_type text not null check/);
});

test('maintainers are exactly Dylan, Megan, and JD in the initial policy', () => {
  const seed = migration.match(/insert into private\.app_access_maintainers[\s\S]*?on conflict \(username\) do nothing;/)?.[0] || '';
  assert.match(seed, /'dylan_collyge'/);
  assert.match(seed, /'megan_kelly'/);
  assert.match(seed, /'jd_jones'/);
  assert.equal((seed.match(/\('[a-z_]+ '\)/g) || []).length, 0);
  assert.equal((seed.match(/\('[a-z_]+'\)/g) || []).length, 3);
});

test('effective policy denies invalid profiles and gives user overrides precedence', () => {
  assert.match(migration, /profile\.id is null or profile\.disabled_at is not null/);
  assert.match(migration, /profile\.locked_until is not null and profile\.locked_until > now\(\)/);
  assert.match(migration, /coalesce\(u\.allowed, r\.allowed, false\)/);
  assert.match(migration, /when u\.permission_key is not null then 'user'/);
  assert.match(migration, /when r\.permission_key is not null then 'role'/);
  assert.match(migration, /else 'default-deny'/);
  assert.match(migration, /array\['own', 'assigned', 'division', 'global'\]/);
});

test('RPC surface is least privilege and optimistic publication cannot enable enforcement', () => {
  for (const signature of [
    'public.get_my_app_permissions_v1\\(\\)',
    'public.get_access_control_matrix_v1\\(bigint\\)',
    'public.save_access_control_draft_v1\\(integer, jsonb, text\\)',
    'public.publish_access_control_policy_v1\\(integer, text\\)'
  ]) {
    assert.match(migration, new RegExp(`revoke all on function ${signature} from public, anon, authenticated`));
  }
  assert.match(migration, /grant execute on function public\.get_my_app_permissions_v1\(\) to authenticated/);
  assert.match(migration, /grant execute on function public\.get_access_control_health_snapshot_v1\(\) to service_role/);
  assert.doesNotMatch(migration, /grant usage on schema private to authenticated/);
  assert.match(migration, /ACCESS_CONTROL_VERSION_CONFLICT/);
  assert.match(migration, /'enforcementMode', 'audit'/);
});

test('Manager Access Control renders the effective matrix and saves only the draft', () => {
  assert.match(html, /const APP_ACCESS_CONTRACT_VERSION = 'app-access-v1'/);
  assert.match(html, /const MANAGER_ACCESS_CONTROL_VIEW = 'access-control'/);
  assert.match(html, /function renderAccessControlPanel\(/);
  assert.match(html, /get_access_control_matrix_v1/);
  assert.match(html, /save_access_control_draft_v1/);
  assert.match(html, /publish_access_control_policy_v1/);
  assert.match(html, /Live authorization remains unchanged/);
  assert.match(html, /exportAccessControlCsv/);
  assert.match(html, /PRIVILEGED_MANAGER_USER_KEYS\.includes/);
});

test('hosted health and exact-live canary cover the audit contract without policy mutation', () => {
  assert.match(health, /get_access_control_health_snapshot_v1/);
  assert.match(health, /production_access_control_audit_contract_unhealthy/);
  assert.match(health, /unknown_permission_count/);
  assert.match(health, /legacy_mismatch_count/);
  assert.match(canary, /live access snapshot uses app-access-v1 without policy mutations/);
  assert.match(canary, /\/rest\/v1\/rpc\/get_my_app_permissions_v1/);
  assert.match(canary, /save_access_control_draft_v1/);
  assert.match(canary, /publish_access_control_policy_v1/);
});
