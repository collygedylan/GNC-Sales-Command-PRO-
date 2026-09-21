import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const names = ['getManagerAssignedColumnDefinitions', 'getManagerAssignedColumnState', 'getManagerAssignedColumnValue',
  'matchesManagerAssignedColumnFilters', 'sortManagerAssignedColumnRows', 'getManagerAssignedColumnOptions',
  'getManagerAssignedItemsActiveAssigneeKey', 'getFilteredManagerAssignedItemsExportRows', 'buildManagerEvalAssignmentKey'];
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
function context(data = rows) {
  const ctx = vm.createContext({ currentUser: 'dylan_collyge', managersSearchTerm: '', managerAssignedItemsAssignedToFilter: 'all',
    managerAssignedColumnState: { owner: 'dylan_collyge', filters: {}, sort: null, editor: null },
    normalizeEvalAssignableUser: value => String(value || '').trim().toLowerCase(),
    getManagerAssignedItemsDisplayRows: () => data,
  });
  vm.runInContext(`function managerTextMatchesSearch(values) { return values.some(value => String(value || '').toLowerCase().includes(managersSearchTerm.trim().toLowerCase())); }\n${names.map(helper).join('\n')}`, ctx);
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
});
