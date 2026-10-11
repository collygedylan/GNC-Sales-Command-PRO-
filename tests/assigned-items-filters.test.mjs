import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { noHistoryLowStockTargets } from './fixtures/hl-order-state.mjs';
import { appApiDatabaseBridge } from './helpers/database-bridge.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const names = ['getManagerAssignedColumnDefinitions', 'getManagerAssignedColumnState', 'getManagerAssignedColumnValue',
  'matchesManagerAssignedColumnFilters', 'sortManagerAssignedColumnRows', 'getManagerAssignedColumnOptions',
  'rememberManagerAssignedColumnLabels', 'getManagerAssignedColumnLabel', 'selectManagerAssignedColumnValues',
  'firstNonEmptyValue', 'normalizeWarehouseAssignedItemRow', 'getManagerAssignedItemsExportRows', 'getManagerAssignedItemsDisplayRows',
  'getManagerAssignedItemsAssigneeOptions', 'getManagerAssignedItemsActiveAssigneeLabel', 'getManagerAssignedItemsExportColumns',
  'getManagerAssignedItemsExportMetaRows', 'getManagerAssignedItemsActiveAssigneeKey', 'getFilteredManagerAssignedItemsExportRows', 'buildManagerEvalAssignmentKey', 'isManagerEvalZoneAssignment',
  'normalizeWarehouseAssignedMatchPart', 'normalizeWarehouseAssignedCompactPart', 'getWarehouseAssignedIdentityParts',
  'buildWarehouseAssignedLookupKeys', 'clearWarehouseAssignedItemCaches', 'rebuildWarehouseAssignedItemIndexes',
  'chooseWarehouseAssignedRowsForItem', 'getWarehouseAssignedRowsForItem', 'getWarehouseAssignedRowForItem',
  'getWarehouseAssignedUserForItem', 'getMasterAssignedToValue', 'getManagerEvalAssignmentReason'];
function helper(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, name);
  const end = html.slice(start + 1).search(/\r?\n        (?:async )?function \w+\(/);
  return html.slice(start, start + 1 + end);
}
const rows = [
  { UNIQUE_ID: 'b', ASSIGNEDTO: ' Dylan_Collyge ', WAREHOUSEI: '10', ITEMCODE: '001', CONTSIZE: '#3', COMMONNAME: ' Rose ', LOCATIONCODE: 'D.08.001', SOURCE: 'Import', GENUSNAME: 'Rosa' },
  { UNIQUE_ID: 'a', ASSIGNEDTO: 'dylan_collyge', WAREHOUSEI: '10', ITEMCODE: '002', CONTSIZE: '#5', COMMONNAME: 'rose', LOCATIONCODE: 'D.08.002', SOURCE: 'Import', GENUSNAME: 'Rosa' },
  { UNIQUE_ID: 'c', ASSIGNEDTO: '', WAREHOUSEI: '', ITEMCODE: '003', CONTSIZE: '#3', COMMONNAME: 'Acer', LOCATIONCODE: 'E.01.000', SOURCE: 'Manual', GENUSNAME: '' }
];
function context(data = rows, normalize = false) {
  const ctx = vm.createContext({ currentUser: 'dylan_collyge', managersSearchTerm: '', managerAssignedItemsAssignedToFilter: 'all',
    managerEvalAssignmentSelection: new Set(['001|rosa']),
    managerAssignedColumnState: { owner: 'dylan_collyge', filters: {}, sort: null, editor: null },
    managerEvalReportSettings: { lowStockMaxSLts: 150 },
    normalizeEvalAssignableUser: value => String(value || '').trim().toLowerCase(),
    getDatasetLoadSignature: () => 'warehouse-assignment-test',
    warehouseAssignedItemIndexCacheKey: '',
    warehouseAssignedItemsByLookupKey: new Map(),
    warehouseAssignedItemMatchCache: new WeakMap(),
    getManagerItemLowStockTarget: () => null,
    normalizeManagerItemLowStockTargetCode: value => String(value || '').trim().toUpperCase(),
    warehouseAssignedItemsInventory: data,
    disposeManagerAssignedColumnEditor: () => {},
    renderManagerAssignedColumnOptions: () => {},
  });
  vm.runInContext(`function managerTextMatchesSearch(values) { return values.some(value => String(value || '').toLowerCase().includes(managersSearchTerm.trim().toLowerCase())); }\n${names.map(helper).join('\n')}`, ctx);
  if (!normalize) ctx.getManagerAssignedItemsDisplayRows = () => ctx.warehouseAssignedItemsInventory;
  return ctx;
}
const ids = values => Array.from(values, row => row.UNIQUE_ID);

test('low-stock no-history fixture returns one complete fallback summary per normalized itemcode', () => {
  assert.deepEqual(noHistoryLowStockTargets([' ab-100 ', 'AB-100', '', null, 'cedar.2', ' 0012 ', '0012']), [
    {
      itemcode_normalized: 'AB-100', qualifying_line_count: 0, qualifying_day_count: 0, source_file_count: 0,
      mean_quantity: null, p75_quantity: null, suggested_qty: null, manual_override_qty: null,
      effective_qty: 150, override_revision: 0, updated_at: null, calculated_at: null,
      history_ready: true, history_pending_files: 0, history_total_files: 0,
      history_from_date: null, history_through_date: null,
    },
    {
      itemcode_normalized: 'CEDAR.2', qualifying_line_count: 0, qualifying_day_count: 0, source_file_count: 0,
      mean_quantity: null, p75_quantity: null, suggested_qty: null, manual_override_qty: null,
      effective_qty: 150, override_revision: 0, updated_at: null, calculated_at: null,
      history_ready: true, history_pending_files: 0, history_total_files: 0,
      history_from_date: null, history_through_date: null,
    },
    {
      itemcode_normalized: '0012', qualifying_line_count: 0, qualifying_day_count: 0, source_file_count: 0,
      mean_quantity: null, p75_quantity: null, suggested_qty: null, manual_override_qty: null,
      effective_qty: 150, override_revision: 0, updated_at: null, calculated_at: null,
      history_ready: true, history_pending_files: 0, history_total_files: 0,
      history_from_date: null, history_through_date: null,
    },
  ]);
  assert.deepEqual(noHistoryLowStockTargets(null), []);
});

test('low-stock no-history fixture passes the app-api RPC response contract without weakening validation', async () => {
  const fixture = noHistoryLowStockTargets(['0012'])[0];
  const invoke = async (row) => {
    const bridge = appApiDatabaseBridge(async () => new Response(JSON.stringify([row]), {
      headers: { 'content-type': 'application/json' },
    }));
    return bridge.fetchRpc('https://fixture.invalid', 'get_eval_item_low_stock_targets_v1', {
      method: 'POST', body: JSON.stringify({ p_itemcodes: ['0012'], p_limit: 1 }),
    }, 1000, 'low-stock fixture contract');
  };

  const accepted = await invoke(fixture);
  assert.deepEqual(await accepted.json(), [fixture], 'the faithful nullable no-history row is accepted');
  await assert.rejects(invoke(Object.fromEntries(Object.entries(fixture).filter(([key]) => key !== 'qualifying_line_count'))), /Invalid.*response/);
  await assert.rejects(invoke({ ...fixture, unexpected_field: true }), /Invalid.*response/);
  await assert.rejects(invoke({ ...fixture, effective_qty: '150' }), /Invalid.*response/);
  await assert.rejects(invoke({ ...fixture, history_ready: 'true' }), /Invalid.*response/);
});

test('each data column filters normalized values without modifying source records', () => {
  const ctx = context();
  for (const [field] of ctx.getManagerAssignedColumnDefinitions()) {
    const value = ctx.getManagerAssignedColumnValue(rows[0], field);
    ctx.managerAssignedColumnState.filters = { [field]: [value] };
    const result = ctx.getFilteredManagerAssignedItemsExportRows();
    assert.ok(result.length > 0);
    assert.ok(result.every(row => ctx.getManagerAssignedColumnValue(row, field) === value));
  }
  assert.equal(rows[0].ITEMCODE, '001');
  assert.equal(rows[0].COMMONNAME, ' Rose ');
  assert.equal(rows[0].LOCATIONCODE, 'D.08.001');
});

test('OR within a column and AND between columns, search, and quick assignee filter', () => {
  const ctx = context();
  ctx.managerAssignedColumnState.filters = { CONTSIZE: ['#3', '#5'], COMMONNAME: ['rose'] };
  assert.deepEqual(ids(ctx.getFilteredManagerAssignedItemsExportRows()), ['b', 'a']);
  ctx.managersSearchTerm = ' D.08.002 ';
  assert.deepEqual(ids(ctx.getFilteredManagerAssignedItemsExportRows()), ['a']);
  ctx.managerAssignedItemsAssignedToFilter = 'unassigned';
  assert.equal(ctx.getFilteredManagerAssignedItemsExportRows().length, 0);
});

test('All, empty selection, and blanks remain distinct', () => {
  const ctx = context();
  ctx.managerAssignedColumnState.filters = { GENUSNAME: [] };
  assert.equal(ctx.getFilteredManagerAssignedItemsExportRows().length, 0);
  ctx.managerAssignedColumnState.filters.GENUSNAME = [''];
  assert.deepEqual(ids(ctx.getFilteredManagerAssignedItemsExportRows()), ['c']);
  ctx.managerAssignedColumnState.filters.GENUSNAME = null;
  assert.equal(ctx.getFilteredManagerAssignedItemsExportRows().length, 3);
  assert.equal(ctx.getManagerAssignedColumnOptions('ASSIGNEDTO').find(x => x.value === '').label, 'Unassigned');
});

test('exact warehouse-pair Unassigned is authoritative while unmatched and ambiguous pairs never borrow another genus owner', () => {
  const ctx = context([], true);
  ctx.warehouseAssignedItemsInventory = [
    { ITEMCODE: '0001', GENUSNAME: 'Acer', ASSIGNEDTO: null },
    { ITEMCODE: '0002', GENUSNAME: 'Acer', ASSIGNEDTO: 'acer_owner' },
    { ITEMCODE: '0002', GENUSNAME: 'Rosa', ASSIGNEDTO: 'rosa_owner' },
  ].map((row, index) => ctx.normalizeWarehouseAssignedItemRow(row, index));
  ctx.clearWarehouseAssignedItemCaches();

  assert.equal(ctx.getMasterAssignedToValue({ ITEMCODE: '0001', GENUSNAME: 'Acer', ASSIGNEDTO: 'stale_owner', EVAL_TASK_ASSIGNED_TO: 'old_task' }), '');
  assert.equal(ctx.getMasterAssignedToValue({ ITEMCODE: '0001', GENUSNAME: 'Pinus', ASSIGNEDTO: 'task_owner' }), 'task_owner');
  assert.deepEqual(Array.from(ctx.getWarehouseAssignedRowsForItem({ ITEMCODE: '0002' })), []);
  assert.equal(ctx.getMasterAssignedToValue({ ITEMCODE: '0002', ASSIGNEDTO: 'task_owner' }), 'task_owner');
});

test('facets ignore their own filter and retain selected values after refresh', () => {
  const ctx = context();
  ctx.managerAssignedColumnState.filters = { COMMONNAME: ['missing', 'rose'], CONTSIZE: ['#3'] };
  assert.deepEqual(Array.from(ctx.getManagerAssignedColumnOptions('COMMONNAME'), x => x.value), ['acer', 'missing', 'rose']);
  assert.equal(ctx.getManagerAssignedColumnOptions('COMMONNAME').find(x => x.value === 'missing').count, 0);
  ctx.managerAssignedColumnState.editor = { field: 'COMMONNAME', values: ['new choice'] };
  assert.ok(ctx.getManagerAssignedColumnOptions('COMMONNAME').some(x => x.value === 'new choice'));
});

test('sorting is global, stable for equal values, and does not mutate input order', () => {
  const ctx = context();
  ctx.managerAssignedColumnState.sort = { field: 'COMMONNAME', direction: 'asc' };
  assert.deepEqual(ids(ctx.getFilteredManagerAssignedItemsExportRows()), ['c', 'a', 'b']);
  ctx.managerAssignedColumnState.sort.direction = 'desc';
  assert.deepEqual(ids(ctx.getFilteredManagerAssignedItemsExportRows()), ['a', 'b', 'c']);
  ctx.managerAssignedColumnState.sort = null;
  assert.deepEqual(ids(ctx.getFilteredManagerAssignedItemsExportRows()), ['b', 'a', 'c']);
});

test('the full dataset is searchable and zero-valued fields are not blanks', () => {
  const data = Array.from({ length: 4049 }, (_, i) => ({ ...rows[0], UNIQUE_ID: String(i), ITEMCODE: String(i).padStart(6, '0'), WAREHOUSEI: 0 }));
  const ctx = context(data);
  ctx.managerAssignedColumnState.filters.ITEMCODE = ['004048'];
  assert.deepEqual(ids(ctx.getFilteredManagerAssignedItemsExportRows()), ['4048']);
  assert.equal(ctx.getManagerAssignedColumnValue(data[0], 'WAREHOUSEI'), '0');
});

test('account changes reset filters and sorting; assignment identities remain independent', () => {
  const ctx = context();
  ctx.managerAssignedColumnState.filters.CONTSIZE = ['#3'];
  ctx.managerAssignedColumnState.sort = { field: 'ITEMCODE', direction: 'desc' };
  const key = ctx.buildManagerEvalAssignmentKey('001', 'Rosa');
  ctx.getFilteredManagerAssignedItemsExportRows();
  assert.equal(ctx.buildManagerEvalAssignmentKey('001', 'Rosa'), key);
  ctx.currentUser = 'megan_kelly';
  assert.equal(ctx.getFilteredManagerAssignedItemsExportRows().length, 3);
  assert.equal(ctx.managerAssignedColumnState.sort, null);
  assert.equal(ctx.managerEvalAssignmentSelection.size, 0);
});


test('searched Select All spans option batches and keeps values outside the search', () => {
  const data = Array.from({ length: 240 }, (_, i) => ({ ...rows[0], UNIQUE_ID: String(i), COMMONNAME: 'Rose ' + i }));
  data.push({ ...rows[2], COMMONNAME: 'Acer' });
  const ctx = context(data);
  ctx.managerAssignedColumnState.editor = { field: 'COMMONNAME', values: ['acer'], search: ' ROSE ', limit: 100 };
  ctx.selectManagerAssignedColumnValues(true);
  const selected = Array.from(ctx.managerAssignedColumnState.editor.values);
  assert.equal(selected.length, 241);
  assert.ok(selected.includes('rose 239'));
  assert.ok(selected.includes('acer'));
  assert.equal(ctx.getFilteredManagerAssignedItemsExportRows().length, 241, 'draft does not filter rows');
  ctx.selectManagerAssignedColumnValues(false);
  assert.equal(ctx.managerAssignedColumnState.editor.values.length, 0);
});

test('Select All stays explicit when new values arrive; removing the filter accepts them', () => {
  const ctx = context();
  ctx.managerAssignedColumnState.editor = { field: 'COMMONNAME', values: [], search: '', limit: 100 };
  ctx.selectManagerAssignedColumnValues(true);
  ctx.managerAssignedColumnState.filters.COMMONNAME = ctx.managerAssignedColumnState.editor.values;
  ctx.managerAssignedColumnState.editor = null;
  ctx.warehouseAssignedItemsInventory = [...rows, { ...rows[0], UNIQUE_ID: 'new', COMMONNAME: 'New Plant' }];
  assert.equal(ctx.getFilteredManagerAssignedItemsExportRows().length, 3);
  delete ctx.managerAssignedColumnState.filters.COMMONNAME;
  assert.equal(ctx.getFilteredManagerAssignedItemsExportRows().length, 4);
});

test('applied and draft values keep display labels after disappearance and reappearance', () => {
  const ctx = context();
  ctx.getManagerAssignedColumnOptions('COMMONNAME');
  ctx.managerAssignedColumnState.filters.COMMONNAME = ['rose'];
  ctx.managerAssignedColumnState.editor = { field: 'COMMONNAME', values: [], search: '', limit: 100 };
  ctx.warehouseAssignedItemsInventory = [rows[2]];
  let option = ctx.getManagerAssignedColumnOptions('COMMONNAME').find(x => x.value === 'rose');
  assert.equal(option.label, 'Rose');
  assert.equal(option.count, 0, 'deselected draft still exposes applied value until Apply');
  ctx.warehouseAssignedItemsInventory = rows;
  option = ctx.getManagerAssignedColumnOptions('COMMONNAME').find(x => x.value === 'rose');
  assert.equal(option.label, 'Rose');
  assert.equal(option.count, 2);
});

test('real normalization preserves zeros, codes and location codes in exported values', () => {
  const data = [{ unique_id: 'zero', itemcode: '000012', warehousei: 0, contsize: 0,
    commonname: 'Mixed Case', locationcode: 'D.08.002', source: 0, assignedto: ' ', genusname: null }];
  const ctx = context(data, true);
  ctx.managerAssignedColumnState.filters.WAREHOUSEI = ['0'];
  const result = ctx.getFilteredManagerAssignedItemsExportRows();
  assert.equal(result.length, 1);
  assert.deepEqual(Array.from(ctx.getManagerAssignedItemsExportColumns(), col => col.value(result[0])),
      ['zero', '', '', '', 'No', '0', '000012', '0', 'Mixed Case', 'D.08.002', '0', '', '', '', 150, '', '', '', 'Assignment pending reconciliation']);
  assert.equal(ctx.getManagerAssignedColumnOptions('WAREHOUSEI')[0].label, '0');
  assert.equal(data[0].warehousei, 0, 'source dataset remains unchanged');
});

test('every column sorts both ways, puts blanks at the edge, and breaks ties by row identity', () => {
  for (const [field] of context().getManagerAssignedColumnDefinitions()) {
    const data = [
      { ...rows[0], UNIQUE_ID: 'z', [field]: 'value 2' },
      { ...rows[0], UNIQUE_ID: 'a', [field]: 'VALUE 2' },
      { ...rows[0], UNIQUE_ID: 'last', [field]: 'value 10' },
      { ...rows[0], UNIQUE_ID: 'blank', [field]: '  ' },
    ];
    const ctx = context(data);
    ctx.managerAssignedColumnState.sort = { field, direction: 'asc' };
    assert.deepEqual(ids(ctx.getFilteredManagerAssignedItemsExportRows()), ['blank', 'a', 'z', 'last'], field);
    ctx.managerAssignedColumnState.sort.direction = 'desc';
    assert.deepEqual(ids(ctx.getFilteredManagerAssignedItemsExportRows()), ['last', 'a', 'z', 'blank'], field);
    assert.deepEqual(ids(data), ['z', 'a', 'last', 'blank']);
  }
});

test('export metadata uses retained display labels, Unassigned, and readable sort direction', () => {
  const ctx = context(rows, true);
  ctx.managerAssignedColumnState.filters = { ASSIGNEDTO: [''], GENUSNAME: [''], COMMONNAME: ['acer'] };
  ctx.managerAssignedColumnState.sort = { field: 'ITEMCODE', direction: 'desc' };
  const matching = ctx.getFilteredManagerAssignedItemsExportRows();
  const metadata = new Map(Array.from(ctx.getManagerAssignedItemsExportMetaRows(matching), row => Array.from(row)));
  assert.equal(metadata.get('Rows'), '1');
  assert.equal(metadata.get('Column Filters'), 'Effective Worker: Unassigned; Common Name: Acer; Genus Name: (Blanks)');
  assert.equal(metadata.get('Sort'), 'Item Code descending');
});

test('compact Assigned Items controls expose values and sort in triggers without collapsible or chip rows', () => {
  const trigger = helper('renderManagerAssignedColumnTrigger');
  const controls = helper('renderManagerAssignedColumnControls');
  assert.match(trigger, /assigned-filter-value/);
  assert.match(trigger, /state\.filters\[field\]\.length === 1/);
  assert.match(trigger, /selectedLabel/);
  assert.match(trigger, /sort\.direction === 'desc' \? '↓' : '↑'/);
  assert.match(controls, /<div class="assigned-phone-filters">/);
  assert.match(controls, /hasFilters \? '<button[^']*assigned-filter-clear/);
  assert.doesNotMatch(controls, /<details|<summary|assigned-filter-chip/);
});

test('Assigned Items filter panel clamps wide visual viewports to the layout viewport', () => {
  const style = { setProperty(name, value) { this[name] = value; } };
  const panel = { style };
  const scope = { querySelector: () => ({ getBoundingClientRect: () => ({ left: 40, bottom: 80 }) }) };
  const ctx = vm.createContext({
    document: {
      documentElement: { clientWidth: 412 },
      getElementById: id => id === 'manager-assigned-filter-panel' ? panel : null,
      querySelector: () => scope,
    },
    window: { visualViewport: { offsetLeft: 0, offsetTop: 0, width: 432, height: 800 }, innerWidth: 412, innerHeight: 800 },
    getManagerAssignedColumnState: () => ({ editor: { field: 'COMMONNAME' } }),
  });
  vm.runInContext(`${helper('positionManagerAssignedColumnFilter')}\npositionManagerAssignedColumnFilter()`, ctx);
  const left = Number.parseFloat(style.left);
  const width = Number.parseFloat(style.width);
  assert.ok(left >= 0);
  assert.ok(left + width <= 412);
});

test('Assigned Items fixed dialog opts out of the generic non-fixed modal width rule', () => {
  const source = helper('openManagerAssignedColumnFilter');
  assert.match(source, /class="excel-filter-panel assigned-column-panel fixed"/);
});
