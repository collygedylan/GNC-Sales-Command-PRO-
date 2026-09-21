import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const names = ['getManagerAssignedColumnDefinitions', 'getManagerAssignedColumnState', 'getManagerAssignedColumnValue',
  'matchesManagerAssignedColumnFilters', 'sortManagerAssignedColumnRows', 'getManagerAssignedColumnOptions',
  'rememberManagerAssignedColumnLabels', 'getManagerAssignedColumnLabel', 'selectManagerAssignedColumnValues',
  'firstNonEmptyValue', 'normalizeWarehouseAssignedItemRow', 'getManagerAssignedItemsExportRows', 'getManagerAssignedItemsDisplayRows',
  'getManagerAssignedItemsAssigneeOptions', 'getManagerAssignedItemsActiveAssigneeLabel', 'getManagerAssignedItemsExportColumns',
  'getManagerAssignedItemsExportMetaRows', 'getManagerAssignedItemsActiveAssigneeKey', 'getFilteredManagerAssignedItemsExportRows', 'buildManagerEvalAssignmentKey'];
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
    normalizeEvalAssignableUser: value => String(value || '').trim().toLowerCase(),
    warehouseAssignedItemsInventory: data,
    disposeManagerAssignedColumnEditor: () => {},
    renderManagerAssignedColumnOptions: () => {},
  });
  vm.runInContext(`function managerTextMatchesSearch(values) { return values.some(value => String(value || '').toLowerCase().includes(managersSearchTerm.trim().toLowerCase())); }\n${names.map(helper).join('\n')}`, ctx);
  if (!normalize) ctx.getManagerAssignedItemsDisplayRows = () => ctx.warehouseAssignedItemsInventory;
  return ctx;
}
const ids = values => Array.from(values, row => row.UNIQUE_ID);

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
    ['', '0', '000012', '0', 'Mixed Case', 'D.08.002', '0', '']);
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
  assert.equal(metadata.get('Column Filters'), 'AssignedTo: Unassigned; Common Name: Acer; Genus Name: (Blanks)');
  assert.equal(metadata.get('Sort'), 'Item Code descending');
});
