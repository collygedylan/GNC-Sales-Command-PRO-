import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseExpressionAt } from 'acorn';
import { getActiveSuspendDockRows } from './dock-order-domain.js';

function read(path) {
  return readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
}

function install(context, source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const { end } = parseExpressionAt(source, start, { ecmaVersion: 'latest' });
  vm.runInContext(source.slice(start, end), context);
}

export function invariant594() {
  const rows = [
    { unique_id: 'cancel', dock: '35', stopnumber: '80', transactionnumber: '1', suspend_candidate_state: 'canceled', cancel_reason: 'per Fixture Rep', status: 'Canceled' },
    { unique_id: 'option', dock: '35', stopnumber: '80', transactionnumber: '1', suspend_candidate_state: 'canceled' },
    { unique_id: 'sibling', dock: '35', stopnumber: '80', transactionnumber: '2', locationcode: 'A.01.000' }
  ];
  assert.deepEqual(getActiveSuspendDockRows(rows).map(row => row.unique_id), ['cancel', 'sibling']);
  assert.equal(rows[0].status, 'Canceled');
  assert.equal(rows[2].locationcode, 'A.01.000');
}

export function invariant595() {
  const context = vm.createContext({
    window: {},
    getSuspendTagMetricDisplayFallback: (row, itemOnly) => {
      assert.equal(row.LOCATIONCODE, '0.00.111');
      assert.equal(itemOnly, true);
      return { row: { PTRONHAND: 8, LOC_ON_HAND: 20, LOC_PHOTO_MATCH: 12 } };
    },
    buildInventoryQuantityChipsHtml: row => JSON.stringify([row.PTRONHAND, row.LOC_ON_HAND, row.LOC_PHOTO_MATCH])
  });
  install(context, read('assets/request-inventory-card.js'), 'renderSuspendCardMetrics');
  const result = context.renderSuspendCardMetrics({ LOCATIONCODE: '0.00.111' }, true);
  assert.match(result, /False Block/);
  assert.ok(result.endsWith('[8,0,0]'));
}

export function invariant596() {
  const exports = [], root = {};
  const context = vm.createContext({
    document: { getElementById: () => root, createElement: () => ({}) },
    getSupabaseReadIdentityScope: () => context.owner,
    getCurrentVisibleViewId: () => 'request',
    isViewVisible: view => view === 'request',
    activeReqTab: 'suspend-tag',
    dockViewMode: 'docks',
    owner: 'fixture',
    getDockStopOrDropValue: row => row.DROP,
    getDockDisplayQty: row => row.ORDER_QTY,
    showToast: () => {},
    downloadExcelWorkbook: (columns, rows) => exports.push({ columns, rows })
  });
  vm.runInContext(read('assets/header-excel-export.js'), context);
  const rows = [{ ITEMCODE: 'A', ORDER_QTY: 8 }, { ITEMCODE: 'B', ORDER_QTY: 6 }];
  context.rememberOperationalExport('request', rows);
  context.exportActiveHeaderRows();
  assert.deepEqual(exports[0].rows, rows);
  const qty = exports[0].columns.find(column => column.label === 'Quantity');
  assert.equal(qty.value(rows[0]), 8);
  context.owner = 'another account';
  context.exportActiveHeaderRows();
  assert.equal(exports.length, 1);
}

export function invariant597() {
  const context = vm.createContext({
    mode: 'all',
    selectedAvSeasons: new Set(['F1']),
    avGenusSelectionMode: 'all',
    selectedAvGenusNames: new Set(),
    avContSizeSelectionMode: 'all',
    selectedAvContSizes: new Set(),
    getAvPhotoMode: () => context.mode,
    normalizeAvSelectedSeasons: () => {},
    getAvFilterSeasonValue: row => row.SEASON,
    itemMatchesAvHoldFilter: row => row.hold !== true
  });
  install(context, read('assets/app-runtime.js'), 'createAvTopFilterPredicate');
  const rows = [{ SEASON: 'F1' }, { SEASON: 'S1' }, { SEASON: 'Y', hold: true }];
  for (const [mode, count] of [['all', 1], ['photos', 1], ['valid_photos', 2]]) {
    context.mode = mode;
    assert.equal(rows.filter(context.createAvTopFilterPredicate()).length, count);
    assert.equal(context.selectedAvSeasons.size, 1);
  }
}
