// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';
const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const names = ['syncWarehouseAssignedItemsSheet_', 'readWarehouseAssignmentExportRevision_', 'exportWarehouseAssignedItemsToSheet_'];
const code = parse(source, { ecmaVersion: 'latest' }).body.filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name)).map(node => source.slice(node.start, node.end)).join('\n');
const keys = ['ph_master_inventory', 'ph_inventory_row_assignments', 'private.ph_eval_item_low_stock_overrides', 'private.ph_eval_item_low_stock_import_state'];
function fixture() {
  const events = []; const props = new Map(); let revision = 1; let state = 'ready'; let failWrite = false;
  const ctx = { console: { warn: message => events.push(message) }, SUPABASE_URL: 'https://fixture.invalid', SUPABASE_KEY: 'fixture-key',
    WAREHOUSE_ASSIGNED_ITEMS_SHEET_ID: 'sheet', WAREHOUSE_EFFECTIVE_ASSIGNMENTS_TABLE: 'assignments',
    getSupabaseHeadersForKey_: () => ({}),
    UrlFetchApp: { fetch: url => { events.push(['revision', url]); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(keys.map(key => ({ key, revision, state }))) }; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props.get(key), setProperty: (key, value) => props.set(key, value) }) },
    fetchAllSupabaseData: () => { events.push('full-read'); return { row: { itemcode: 'ITEM', master_unique_id: 'row', assignedto: 'crew' } }; },
    getSupabaseFetchOptionsForTable_: () => ({}), getAssignedItemLowStockExportTargets_: () => ({}),
    SpreadsheetApp: { openById: () => ({ getSheets: () => [{ getLastRow: () => 3, getLastColumn: () => 24,
      getRange: () => ({ setValues: () => { events.push('write'); if (failWrite) throw new Error('sheet unavailable'); }, clearContent: () => events.push('clear'), setFontWeight() {} }),
      setFrozenRows() {} }] }) }, emitTableSyncLiveEvent_: () => events.push('event') };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { ctx, events, props, set state(value) { state = value; }, set failWrite(value) { failWrite = value; } };
}
test('Warehouse unchanged export performs one bounded metadata read and skips all row/Sheet work', () => {
  const f = fixture(); const signature = f.ctx.readWarehouseAssignmentExportRevision_();
  f.props.set('WAREHOUSE_EXPORT_REVISION_sheet', JSON.stringify(['assignments', signature])); f.events.length = 0;
  const result = f.ctx.syncWarehouseAssignedItemsSheet_('sheet', 'unused-folder', 'assignments');
  assert.equal(result.skippedUnchanged, true); assert.equal(result.filesProcessed, 0);
  assert.equal(f.events.length, 1); assert.equal(f.events[0][0], 'revision');
});
test('Warehouse refreshing source defers only the export without changing import state or throwing', () => {
  const f = fixture(); f.state = 'interrupted'; const result = f.ctx.syncWarehouseAssignedItemsSheet_('sheet', 'unused', 'assignments');
  assert.equal(result.deferred, true); assert.equal(result.failedFiles, 0); assert.equal(result.warningCode, 'WAREHOUSE_EXPORT_DEFERRED');
  assert.equal(f.events.includes('full-read'), false); assert.equal(f.props.size, 0);
});
test('Warehouse failed Sheet write retains old cells and never records a successful export', () => {
  const f = fixture(); f.failWrite = true; const result = f.ctx.syncWarehouseAssignedItemsSheet_('sheet', 'unused', 'assignments');
  assert.equal(result.deferred, true); assert.equal(f.events.includes('write'), true); assert.equal(f.events.includes('clear'), false); assert.equal(f.props.size, 0);
});
test('Warehouse successful export writes complete values before trimming stale cells and records revision', () => {
  const f = fixture(); const result = f.ctx.syncWarehouseAssignedItemsSheet_('sheet', 'unused', 'assignments');
  assert.equal(result.exportedRows, 1); assert.ok(f.events.indexOf('write') < f.events.indexOf('clear')); assert.equal(f.props.size, 1);
});
