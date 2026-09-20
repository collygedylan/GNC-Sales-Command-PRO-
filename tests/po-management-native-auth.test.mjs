import { readReleaseWorkflowSources } from '../scripts/release-workflow-sources.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { verifyPoManagementHealth } from '../scripts/po-management-health.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260828014753_restore_po_management_native_auth_access.sql', import.meta.url),
  'utf8'
);
const healthRepair = fs.readFileSync(
  new URL('../supabase/migrations/20260902160400_optimize_po_management_health_snapshot.sql', import.meta.url),
  'utf8'
);
const healthProbe = fs.readFileSync(new URL('../scripts/probe-production-auth-health.mjs', import.meta.url), 'utf8')
  + fs.readFileSync(new URL('../scripts/po-management-health.mjs', import.meta.url), 'utf8');
const productionCanary = fs.readFileSync(new URL('./production-request-canary.spec.ts', import.meta.url), 'utf8');
const performanceWorkflow = readReleaseWorkflowSources('.github/workflows/performance-monitor.yml').text;

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
  const loaderStart = html.indexOf('async function fetchPoManagementRows(');
  const loaderEnd = html.indexOf('function reloadPoManagementData()', loaderStart);
  const loader = html.slice(loaderStart, loaderEnd);
  assert.ok(loaderStart > 0 && loaderEnd > loaderStart);
  assert.match(loader, /fetchAuthenticatedSupabaseReadPage\(table, query/);
  assert.doesNotMatch(loader, /runAppApiSupabaseWrite\(PO_MANAGEMENT_TABLE/);
  assert.match(loader, /DATASET_AUTH_REQUIRED/);
  assert.match(loader, /DATASET_PERMISSION_DENIED/);
  assert.match(loader, /DATASET_READ_TIMEOUT/);
  assert.match(loader, /DATASET_NETWORK_FAILURE/);
  assert.doesNotMatch(loader, /error && error\.message \? error\.message/);
});

test('PO inventory detail reads every RLS-visible exact item-and-size row without HL access', () => {
  const start = html.indexOf('function renderPoManagementInventoryRows(');
  const end = html.indexOf('function getWeatherHoldNumber(', start);
  const detail = html.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(detail, /fetchAuthenticatedSupabaseReadPage\('ph_master_inventory', query/);
  assert.match(detail, /itemcode=eq\.\$\{encodeURIComponent\(itemcode\)\}/);
  assert.match(detail, /contsize=eq\.\$\{encodeURIComponent\(contsize\)\}/);
  assert.match(detail, /order=unique_id\.asc/);
  assert.match(detail, /offset=\$\{offset\}/);
  assert.match(detail, /owner !== getSupabaseReadIdentityScope\(\)/);
  assert.match(detail, /!canAccessView\('po-management'\)/);
  assert.match(detail, /Exact item, size, location and lot match/);
  assert.match(detail, /Related item and size · other locations or lots/);
  assert.match(detail, /renderVerifiedInventoryDetailRow/);
  assert.match(html, /PTRAVAILABLE/);
  assert.doesNotMatch(detail, /canUseHlOrder/);
  assert.doesNotMatch(detail, /fullInventory/);
});

test('PO inventory detail is invalidated and cleared on role reset and logout', () => {
  assert.match(html, /function resetPoManagementInventoryState\(\)[\s\S]*poManagementInventoryRequest\+\+[\s\S]*content\.textContent = ''[\s\S]*po-inventory-detail.*close/);
  assert.match(html, /function clearRoleScopedClientCaches[\s\S]*resetPoManagementInventoryState\(\)/);
  assert.match(html, /async function performLogout\(\)[\s\S]*resetPoManagementInventoryState\(\)/);
  assert.match(html, /Inventory verification failed\. Try again\./);
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

test('PO health reads the bounded latest source scope instead of rebuilding the live view', () => {
  assert.match(healthRepair, /ph_27f1_hl_po_latest_import_idx/);
  assert.match(healthRepair, /ph_27f1_hl_po_scope_key_idx/);
  assert.match(healthRepair, /with latest_scope as materialized/);
  assert.match(healthRepair, /from public\.ph_27f1_hl_po p/);
  assert.doesNotMatch(healthRepair, /from public\.ph_view_po_27f1_hl/);
  assert.match(healthRepair, /security definer/);
  assert.match(healthRepair, /grant execute on function public\.get_po_management_health_snapshot\(\)[\s\S]*to service_role/);
  assert.match(performanceWorkflow, /20260809011735_ph_27f1_hl_po\.sql/);
  assert.match(performanceWorkflow, /20260902160400_optimize_po_management_health_snapshot\.sql/);
});

const now = Date.parse('2026-09-20T12:00:00Z');
const confirmedPdf = () => ({ contract_version: 'po-management-native-auth-v1', row_count: 463,
  source_authority_valid: true,
  latest_built_at: '2026-09-17T02:45:04Z', source_format: 'pdf', freshness_mode: 'manual_pdf',
  pdf_health_contract: 'confirmed-pdf-ledger-v1', pdf_report_valid: true, projection_matches_ledger: true,
  season_access_healthy: true, source_authenticated_select: true, view_authenticated_select: true,
  anonymous_access_denied: true, authenticated_writes_denied: true, manager_policy_present: true,
  security_invoker_enabled: true });

test('an older confirmed PDF remains healthy only with proven provenance and current ledger parity', () => {
  const report = confirmedPdf();
  const before = structuredClone(report);
  const result = verifyPoManagementHealth(report, now);
  assert.equal(result.freshnessMode, 'manual_pdf');
  assert.equal(result.reportAgeNotice, 'confirmed_pdf_older_than_72_hours');
  assert.deepEqual(report, before, 'health must not reset source timestamps');
  for (const key of ['pdf_report_valid', 'projection_matches_ledger', 'season_access_healthy']) {
    for (const value of [false, undefined, 'true']) {
      assert.throws(() => verifyPoManagementHealth({...report, [key]: value}, now), /pdf_contract_unhealthy/);
    }
  }
  assert.throws(() => verifyPoManagementHealth({...report, pdf_health_contract: undefined}, now), /pdf_contract_unhealthy/);
});

test('missing, future, unauthorized, empty and stale scheduled data still block release', () => {
  const report = confirmedPdf();
  for (const latest_built_at of ['', 'invalid', '2026-09-21T00:00:00Z']) {
    assert.throws(() => verifyPoManagementHealth({...report, latest_built_at}, now), /production_po_management_stale/);
  }
  assert.throws(() => verifyPoManagementHealth({...report, anonymous_access_denied:false}, now), /auth_contract_unhealthy/);
  assert.throws(() => verifyPoManagementHealth({...report, row_count:0}, now), /production_po_management_empty/);
  assert.throws(() => verifyPoManagementHealth({...report, source_authority_valid:false, source_format:'legacy', freshness_mode:'scheduled_import', latest_built_at:'2026-09-20T00:00:00Z'}, now), /source_invalid/);
  assert.throws(() => verifyPoManagementHealth({...report, source_format:'legacy', freshness_mode:'scheduled_import'}, now), /production_po_management_stale/);
  assert.throws(() => verifyPoManagementHealth({...report, source_format:'sheet'}, now), /production_po_management_stale/);
  assert.doesNotThrow(() => verifyPoManagementHealth({...report, source_format:'legacy', freshness_mode:'scheduled_import', latest_built_at:'2026-09-20T00:00:00Z'}, now));
});

test('pending replacements and flagged negative balances do not replace the confirmed PDF', () => {
  assert.equal(verifyPoManagementHealth({...confirmedPdf(),pending_pdf_count:2,review_balance_count:1}, now).freshnessMode, 'manual_pdf');
  const handler = fs.readFileSync(new URL('../Code.gs',import.meta.url),'utf8');
  const importer = handler.slice(handler.indexOf('function syncHlPoParsedFolder_('),handler.indexOf('const TRANSACTIONS_KEYED_COLUMNS'));
  assert.match(importer,/application\/pdf/);
  assert.match(importer,/else unsupportedFiles\+\+/);
});
