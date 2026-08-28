import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260828014753_restore_po_management_native_auth_access.sql', import.meta.url),
  'utf8'
);
const healthProbe = fs.readFileSync(new URL('../scripts/probe-production-auth-health.mjs', import.meta.url), 'utf8');
const productionCanary = fs.readFileSync(new URL('./production-request-canary.spec.ts', import.meta.url), 'utf8');

test('PO Management RLS permits only trusted active manager profiles', () => {
  assert.match(migration, /create or replace function private\.can_view_po_management\(\)/);
  assert.match(migration, /private\.current_active_profile\(\)/);
  assert.match(migration, /= any \(array\['ADMIN', 'MANAGER'\]::text\[\]\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /create policy ph_27f1_hl_po_manager_read[\s\S]*to authenticated[\s\S]*private\.can_view_po_management\(\)/);
  assert.match(migration, /alter view public\.ph_view_po_27f1_hl set \(security_invoker = true\)/);
  assert.match(migration, /revoke all on table public\.ph_27f1_hl_po from public, anon, authenticated/);
  assert.match(migration, /revoke all on table public\.ph_view_po_27f1_hl from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.ph_27f1_hl_po to authenticated/);
  assert.match(migration, /grant select on table public\.ph_view_po_27f1_hl to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all).*authenticated/i);
});

test('PO Management loader uses authenticated PostgREST paging with sanitized errors', () => {
  const loaderStart = html.indexOf('async function fetchPoManagementRows()');
  const loaderEnd = html.indexOf('function reloadPoManagementData()', loaderStart);
  const loader = html.slice(loaderStart, loaderEnd);
  assert.ok(loaderStart > 0 && loaderEnd > loaderStart);
  assert.match(loader, /fetchAuthenticatedSupabaseReadPage\(PO_MANAGEMENT_TABLE, query/);
  assert.doesNotMatch(loader, /runAppApiSupabaseWrite\(PO_MANAGEMENT_TABLE/);
  assert.match(loader, /DATASET_AUTH_REQUIRED/);
  assert.match(loader, /DATASET_PERMISSION_DENIED/);
  assert.match(loader, /DATASET_READ_TIMEOUT/);
  assert.match(loader, /DATASET_NETWORK_FAILURE/);
  assert.doesNotMatch(loader, /error && error\.message \? error\.message/);
});

test('hosted health and exact-live canary cover the PO authorization contract', () => {
  assert.match(migration, /get_po_management_health_snapshot/);
  assert.match(migration, /po-management-native-auth-v1/);
  assert.match(healthProbe, /get_po_management_health_snapshot/);
  assert.match(healthProbe, /production_po_management_auth_contract_unhealthy/);
  assert.match(healthProbe, /production_po_management_empty/);
  assert.match(healthProbe, /production_po_management_stale/);
  assert.match(productionCanary, /live PO Management uses authenticated PostgREST and never the retired database proxy/);
  assert.match(productionCanary, /\/rest\/v1\/ph_view_po_27f1_hl/);
  assert.match(productionCanary, /retired proxy or mutation attempted/);
});
