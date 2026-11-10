import assert from 'node:assert/strict';

export function assertRequestHistoryIsolatedSync(read) {
  const migration = read('supabase/migrations/20261025013000_agdata_v2362_canonical_requests.sql');
  const cleanup = read('supabase/migrations/20261025014500_agdata_v2362_remove_legacy_request_objects.sql');
  const runtime = read('assets/app-runtime.js');
  const navigation = read('assets/navigation-preferences.js');
  const api = read('supabase/functions/app-api/index.ts');
  assert.match(migration, /grant select on public\.ph_master_inventory,public\.ph_requests_pending[^]*to anon,authenticated/);
  assert.match(migration, /canonical-three-table-v2362/);
  assert.match(migration, /ph_requests_completed_history:'\|\|history\.unique_id/);
  assert.match(migration, /ph_requests_pending:'\|\|pending\.unique_id/);
  assert.match(cleanup, /drop table if exists public\.ph_request_sales_impact_ledger cascade/);
  assert.match(cleanup, /drop table if exists private\.request_financial_values_v1 cascade/);
  assert.match(runtime, /fetchActiveRequestLiveRows:canonicalPending[^]*requestsInventory/);
  assert.match(runtime, /homeSyncMetadata:\$\{table\}[^]*retained:\s*true/);
  assert.doesNotMatch(navigation, /Existing default/);
  assert.match(navigation, /Allow view[^]*Hide view/);
  assert.match(api, /resolveModuleAllowed\(supabase, actor, "request-sales-impact"\)/);
}
