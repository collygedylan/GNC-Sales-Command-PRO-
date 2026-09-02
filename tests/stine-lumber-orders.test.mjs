import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const code = read('Code.gs');
const html = read('index.html');
const migration = read('supabase/migrations/20260902131328_stine_orders_history.sql');
const workflow = read('.github/workflows/performance-monitor.yml');

function loadSharedOrderParser() {
  const start = code.indexOf('const PIKES_ORDER_COLUMNS');
  const end = code.indexOf('function upsertPikesOrderSourceRows_');
  assert.ok(start >= 0 && end > start, 'shared order parser block should exist');
  const context = vm.createContext({ MimeType: { CSV: 'text/csv' } });
  vm.runInContext(`${code.slice(start, end)}\nthis.parser = { inspectPikesOrderHeaderRow_, buildPikesOrderSourceRows_ };`, context);
  return context.parser;
}

test('Stine Lumber uses the supplied pending and processed Drive folders', () => {
  assert.match(code, /STINE_LUMBER_ORDERS_PENDING_FOLDER_ID = '1R9NDclDdlLhyHDKlUyG-KuSwN2mrUNRt'/);
  assert.match(code, /STINE_LUMBER_ORDERS_PROCESSED_FOLDER_ID = '1Ped8i4nyegI1Ikvv8O_BJUTLFGAq8AjN'/);
  assert.match(code, /STINE_LUMBER_ORDERS_DROP: STINE_LUMBER_ORDERS_PENDING_FOLDER_ID/);
  assert.match(code, /STINE_LUMBER_ORDERS_PROCESSED: STINE_LUMBER_ORDERS_PROCESSED_FOLDER_ID/);
  assert.match(code, /runStineLumberOrdersOnly[\s\S]*sourceKey: 'stine_lumber'[\s\S]*sourceLabel: 'Stine Lumber'/);
});

test('scheduled and manual sync routes include the independent Stine stage', () => {
  assert.match(code, /MANUAL_SYNC_STAGE_ORDER_DEFAULT[^\n]*'stine_lumber_orders'/);
  assert.match(code, /stine_lumber_orders: \{ label: 'Stine Lumber Orders', run: runStineLumberOrdersOnly \}/);
  assert.match(code, /normalized === 'stine_lumber_orders'[\s\S]*return \['stine_lumber_orders'\]/);
  assert.match(code, /prepare_manager_order_import_v2[\s\S]*p_source_key: sourceKey/);
  assert.match(code, /source_key=eq\.\$\{encodeURIComponent\(sourceKey\)\}[\s\S]*status=eq\.archive_pending/);
});

test('Stine workbook rows reuse the approved three-column parser and ignore footer data', () => {
  const parser = loadSharedOrderParser();
  const inspection = parser.inspectPikesOrderHeaderRow_(['', ' Item ', 'ORDER TOT', 'Pick Notes', 'Vendor Cost']);
  assert.equal(inspection.valid, true);
  assert.deepEqual(JSON.parse(JSON.stringify(inspection.indexByKey)), { itemcode: 1, order_tot: 2, pick_notes: 3 });

  const rows = parser.buildPikesOrderSourceRows_({
    headerRowIndex: 0,
    indexByKey: inspection.indexByKey,
    values: [
      ['', 'Item', 'ORDER TOT', 'Pick Notes', 'Vendor Cost'],
      [1, ' 010347.021.1 ', 35, '-', 'not retained'],
      [2, '010347.021.1', 4, 'second order line', 'not retained'],
      ['', '', '', 'footer', 'not retained']
    ],
    displayValues: [
      ['', 'Item', 'ORDER TOT', 'Pick Notes', 'Vendor Cost'],
      ['1', ' 010347.021.1 ', '35', '-', 'not retained'],
      ['2', '010347.021.1', '4', 'second order line', 'not retained'],
      ['', '', '', 'footer', 'not retained']
    ]
  }, 'stine-batch', 'Stein Lumber 9-1-26.xlsx');

  assert.equal(rows.length, 2);
  assert.equal(rows[0].itemcode_normalized, '010347.021.1');
  assert.equal(rows[0].order_tot, '35');
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'batch_id', 'itemcode', 'itemcode_normalized', 'matched',
    'order_tot', 'pick_notes', 'source_row_number'
  ]);
});

test('database contract keeps sources independent and service-owned', () => {
  assert.match(migration, /check \(source_key in \('pikes', 'stine_lumber'\)\)/);
  assert.match(migration, /prepare_manager_order_import_v2/);
  assert.match(migration, /where b\.drive_file_id = p_drive_file_id[\s\S]*for update/);
  assert.match(migration, /existing\.source_key <> safe_source_key[\s\S]*MANAGER_ORDER_FILE_SOURCE_MISMATCH/);
  assert.match(migration, /where b\.source_key = target\.source_key and b\.batch_date = effective_date/);
  assert.match(migration, /when 'stine_lumber' then 'Stine Lumber'/);
  assert.match(migration, /left join public\.ph_warehouse_assigned_items a/);
  assert.match(migration, /a\.assignment_key = private\.normalize_eval_assignment_key\(m\.itemcode, m\.genusname\)/);
  assert.match(migration, /revoke all on function public\.prepare_manager_order_import_v2[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.prepare_manager_order_import_v2[\s\S]*to service_role/);
  assert.match(migration, /safe_source_key not in \('pikes', 'stine_lumber'\)/);
  assert.match(migration, /get_pikes_order_assignment_health_v1[\s\S]*where b\.source_key = 'pikes'/);
  assert.match(workflow, /20260902131328_stine_orders_history\.sql/);
});

test('Managers Orders UI labels Stine history and source rows dynamically', () => {
  assert.match(html, /safeKey === 'stine_lumber' \? 'Stine Lumber' : 'Pikes'/);
  assert.match(html, /escapeHtml\(getManagerOrderSourceLabel\(\)\)\} source rows/);
  assert.match(html, /state\.level === 'batches' \? sourceLabel : 'Orders'/);
  assert.doesNotMatch(html, /No Pikes order batches/);
});
