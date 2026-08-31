import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const code = read('Code.gs');
const html = read('index.html');
const migration = read('supabase/migrations/20260831165043_pikes_orders_manager_history.sql');
const repairMigration = read('supabase/migrations/20260831224251_repair_pikes_assignments_and_maintenance.sql');
const repairAuditHardening = read('supabase/migrations/20260831230825_harden_pikes_assignment_repair_audit.sql');
const performanceWorkflow = read('.github/workflows/performance-monitor.yml');
const rlsTest = read('supabase/tests/pikes_orders_rls_test.sql');

function loadPikesParser() {
  const start = code.indexOf('const PIKES_ORDER_COLUMNS');
  const end = code.indexOf('function upsertPikesOrderSourceRows_');
  assert.ok(start >= 0 && end > start, 'Pikes parser block should exist');
  const context = vm.createContext({ MimeType: { CSV: 'text/csv' } });
  vm.runInContext(`${code.slice(start, end)}\nthis.parser = { normalizePikesOrderHeader_, inspectPikesOrderHeaderRow_, buildPikesOrderSourceRows_ };`, context);
  return context.parser;
}

test('Pikes parser accepts harmless header differences and retains only approved fields', () => {
  const parser = loadPikesParser();
  const inspection = parser.inspectPikesOrderHeaderRow_([' item ', 'ORDER   TOT', 'Pick-Notes', 'Do Not Retain']);
  assert.equal(inspection.valid, true);
  assert.deepEqual(JSON.parse(JSON.stringify(inspection.indexByKey)), { itemcode: 0, order_tot: 1, pick_notes: 2 });

  const rows = parser.buildPikesOrderSourceRows_({
    headerRowIndex: 0,
    indexByKey: inspection.indexByKey,
    values: [
      ['Item', 'Order TOT', 'Pick Notes', 'Other'],
      [' abc.1 ', 7, ' keep upright ', 'secret'],
      ['ABC.1', 2, 'second source row', 'ignore'],
      ['', '', '', 'ignored blank row']
    ],
    displayValues: [
      ['Item', 'Order TOT', 'Pick Notes', 'Other'],
      [' abc.1 ', '7', ' keep upright ', 'secret'],
      ['ABC.1', '2', 'second source row', 'ignore'],
      ['', '', '', 'ignored blank row']
    ]
  }, 'batch-1', 'orders.csv');

  assert.equal(rows.length, 2, 'repeated Item rows must be retained');
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'batch_id', 'itemcode', 'itemcode_normalized', 'matched',
    'order_tot', 'pick_notes', 'source_row_number'
  ]);
  assert.equal(rows[0].itemcode, 'abc.1');
  assert.equal(rows[0].itemcode_normalized, 'ABC.1');
  assert.equal(rows[0].order_tot, '7');
  assert.equal(rows[0].pick_notes, 'keep upright');
});

test('Pikes parser rejects invalid headers and ignores footer rows without Item', () => {
  const parser = loadPikesParser();
  assert.equal(parser.inspectPikesOrderHeaderRow_(['Item', 'Order TOT']).valid, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(parser.inspectPikesOrderHeaderRow_(['Item', 'ITEM', 'Order TOT', 'Pick Notes']).duplicateHeaders)),
    ['Item']
  );
  const rows = parser.buildPikesOrderSourceRows_({
    headerRowIndex: 0,
    indexByKey: { itemcode: 0, order_tot: 1, pick_notes: 2 },
    values: [['Item', 'Order TOT', 'Pick Notes'], ['', '5', 'note']],
    displayValues: [['Item', 'Order TOT', 'Pick Notes'], ['', '5', 'note']]
  }, 'batch-1', 'orders.csv');
  assert.equal(rows.length, 0);
});

test('five-minute Pikes importer is bounded, file-id idempotent, and archives only after database finalization', () => {
  assert.match(code, /PIKES_ORDERS_PENDING_FOLDER_ID = '178W6cp2r9ZKfcKRg-4c06SRnwG9LgqmL'/);
  assert.match(code, /PIKES_ORDERS_PROCESSED_FOLDER_ID = '1zbwb0U31IOhOoLyNDXea3P_fqEB5EsWE'/);
  assert.match(code, /PIKES_ORDERS_MAX_FILES_PER_RUN = 3/);
  assert.match(code, /MANUAL_SYNC_STAGE_ORDER_DEFAULT[^\n]*'pikes_orders'/);
  assert.match(code, /normalized === 'pikes_orders'[\s\S]*return \['pikes_orders'\]/);
  assert.match(code, /getPikesOrderFileHash_[\s\S]*getBlob\(\)\.getBytes\(\)/);
  assert.match(code, /prepare_pikes_order_import/);
  assert.match(code, /finalize_pikes_order_import/);
  assert.match(code, /finalized\.status[\s\S]*archive_pending[\s\S]*moveDriveFileToFolderWithRetry_[\s\S]*mark_pikes_order_file_archived/);
  assert.match(code, /reconcilePikesOrderArchives_[\s\S]*status=eq\.archive_pending/);
  const pikesSync = code.slice(code.indexOf('function syncPikesOrdersFolder_'), code.indexOf('function syncNotesToSupabase'));
  assert.doesNotMatch(pikesSync, /failedFiles\.push\([^\n]*errorMessage/);
});

test('manual sync client status is run-scoped and never exposes raw stage errors', () => {
  const statusBlock = code.slice(
    code.indexOf('function getManualSyncStatusForClient_'),
    code.indexOf('// =========================================================================\n// HIGH-PERFORMANCE DELTA SYNC ENGINE')
  );
  assert.match(statusBlock, /sanitizeManualSyncStatusForClient_/);
  assert.match(statusBlock, /next\.runId = String\(next\.runId/);
  assert.match(statusBlock, /Error code: \$\{safeCode\}/);
  assert.match(statusBlock, /failedFileErrors: failedFileErrors\.map/);
  assert.doesNotMatch(statusBlock, /firstError/);
  assert.doesNotMatch(statusBlock, /Could not start the manual sync trigger: \$\{status\.error\}/);
});

test('database freezes one inventory card per master row while retaining every source order row', () => {
  assert.match(migration, /create table if not exists public\.ph_pikes_order_batches/);
  assert.match(migration, /create table if not exists public\.ph_pikes_order_source_rows/);
  assert.match(migration, /create table if not exists public\.ph_pikes_order_inventory_rows/);
  assert.match(migration, /primary key \(batch_id, source_row_number\)/);
  assert.match(migration, /primary key \(batch_id, master_unique_id\)/);
  assert.match(migration, /select distinct on \(m\.unique_id\)/);
  assert.match(migration, /requested\.itemcode_normalized = upper\(btrim\(m\.itemcode\)\)/);
  assert.match(migration, /effective_name := 'Pikes ' \|\| to_char\(effective_date, 'MM-DD-YYYY'\)/);
  assert.match(migration, /case when effective_sequence > 1 then ' \(' \|\| effective_sequence::text \|\| '\)'/);
  assert.match(migration, /unique \(source_key, batch_date, daily_sequence\)/);
  assert.match(migration, /where b\.drive_file_id = p_drive_file_id/);
  assert.doesNotMatch(migration, /unique\s*\(content_sha256\)/);
});

test('Pikes snapshots use authoritative assignments and historical repair is service-only', () => {
  assert.match(repairMigration, /assignment_authority_key text/);
  assert.match(repairMigration, /left join public\.ph_warehouse_assigned_items a/);
  assert.match(repairMigration, /a\.assignment_key = private\.normalize_eval_assignment_key\(m\.itemcode, m\.genusname\)/);
  assert.doesNotMatch(repairMigration, /m\.lotcode, m\.assignedto/);
  assert.match(repairMigration, /repair_pikes_order_batch_assignments_v1/);
  assert.match(repairMigration, /p_dry_run boolean/);
  assert.match(repairMigration, /nullif\(btrim\(coalesce\(i\.assignedto, ''\)\), ''\) is null/);
  assert.match(repairMigration, /a\.assigned_at <= t\.imported_at/);
  assert.match(repairMigration, /itemcode_unique_assignee/);
  assert.match(repairMigration, /ph_pikes_order_assignment_repair_audit/);
  assert.match(repairMigration, /revoke all on function public\.repair_pikes_order_batch_assignments_v1\(uuid, boolean, text\) from public, anon, authenticated/);
  assert.match(repairMigration, /grant execute on function public\.repair_pikes_order_batch_assignments_v1\(uuid, boolean, text\) to service_role/);
  assert.match(repairAuditHardening, /as restrictive[\s\S]*to anon, authenticated[\s\S]*using \(false\)[\s\S]*with check \(false\)/);
});

test('assignment reconciliation is incremental, indexed, and overlap-safe', () => {
  assert.match(repairMigration, /pg_try_advisory_xact_lock/);
  assert.match(repairMigration, /MAINTENANCE_DEFERRED/);
  assert.match(repairMigration, /on conflict \(assignment_key\)[\s\S]*do update set[\s\S]*where public\.ph_warehouse_assigned_items/);
  assert.match(repairMigration, /not exists \([\s\S]*private\.normalize_eval_assignment_key\(m\.itemcode, m\.genusname\) = a\.assignment_key/);
  assert.doesNotMatch(repairMigration, /set present_in_drive = false, updated_at = now\(\)\s*where assignment_key is not null/);
  assert.match(performanceWorkflow, /20260831224251_repair_pikes_assignments_and_maintenance\.sql/);
  assert.match(performanceWorkflow, /20260831230825_harden_pikes_assignment_repair_audit\.sql/);
  assert.match(performanceWorkflow, /REQUIRE_BOUNDED_MAINTENANCE: '1'/);
});

test('Orders data is manager-read-only and service-write-only', () => {
  for (const table of ['batches', 'source_rows', 'inventory_rows']) {
    assert.match(migration, new RegExp(`alter table public\\.ph_pikes_order_${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.ph_pikes_order_${table} from public, anon, authenticated`));
  }
  assert.match(migration, /p\.disabled_at is null/);
  assert.match(migration, /p\.locked_until is null or p\.locked_until <= now\(\)/);
  assert.match(migration, /in \('ADMIN', 'ADMINISTRATOR', 'MANAGER'\)/);
  assert.match(migration, /revoke all on function public\.prepare_pikes_order_import[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.prepare_pikes_order_import[\s\S]*to service_role/);
  assert.match(migration, /'manager\.orders\.view'/);
  assert.match(migration, /limit safe_limit \+ 1/);
  assert.match(migration, /limit 200/);
  assert.match(performanceWorkflow, /20260831165043_pikes_orders_manager_history\.sql/);
  assert.match(performanceWorkflow, /pikes_orders_rls_test\.sql/);
  assert.match(rlsTest, /active Admin can view Orders/);
  assert.match(rlsTest, /locked Manager cannot view Orders/);
  assert.match(rlsTest, /every matching Drive row is frozen once/);
});

test('Managers Orders UI provides Pikes history, multi-assignee filters, warnings, and Drive cards', () => {
  assert.match(html, /const MANAGER_ORDERS_VIEW = 'orders'/);
  assert.match(html, /label: 'Orders'/);
  assert.match(html, /supabaseRpc\('get_manager_order_sources_v1'/);
  assert.match(html, /supabaseRpc\('get_manager_order_batches_v1'/);
  assert.match(html, /supabaseRpc\('get_manager_order_batch_v1'/);
  assert.match(html, /selectedAssigneeKeys:new Set\(\)/);
  assert.match(html, /toggleManagerOrderAssignee/);
  assert.match(html, /Unassigned/);
  assert.match(html, /unmatched Item/);
  assert.match(html, /buildInventoryQuantityChipsHtml/);
  assert.match(html, /buildInventoryCardFieldChipsHtml/);
  assert.match(html, /min-h-\[44px\]/);
});
