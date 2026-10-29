import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
const start = html.indexOf('        const REQUEST_MODAL_OPTION_PAGE_SIZE');
const end = html.indexOf('        const PRODUCTIVITY_HOME_VIEWERS', start);

test('Request rep choices render every eligible user immediately while customer and folder lists stay paged', () => {
  assert.ok(start > 0 && end > start);
  const renders = [];
  const context = vm.createContext({ requestModalVisibleOptionLimits: new Map(), esc: value => value,
    document: { getElementById: () => ({ value: 'current search' }) },
    filterRepList: query => renders.push(['rep', query]), populateCustomerList: query => renders.push(['customer', query]),
    renderExistingRequestFolderPicker: () => renders.push(['folder']) });
  vm.runInContext(html.slice(start, end), context);
  const rows = Array.from({ length: 12000 }, (_, id) => ({ id: String(id) }));
  const first = context.getRequestModalVisibleOptions('rep:all', rows);
  assert.equal(first.shown, 12000);
  assert.equal(context.buildRequestModalMoreResultsHtml(first), '');
  const customerFirst = context.getRequestModalVisibleOptions('customer:rep1', rows);
  assert.equal(customerFirst.shown, 20); assert.equal(customerFirst.total, 12000);
  assert.match(context.buildRequestModalMoreResultsHtml(customerFirst), /Show 20 More · 20 of 12000/);
  context.showMoreRequestModalOptions('customer:rep1');
  const expanded = context.getRequestModalVisibleOptions('customer:rep1', rows);
  assert.equal(expanded.shown, 40);
  assert.deepEqual(Array.from(expanded.rows, row => row.id), rows.slice(0, 40).map(row => row.id));
  assert.deepEqual(renders, [['customer', 'current search']]);
  assert.equal(context.getRequestModalVisibleOptions('customer:rep2', rows).shown, 20);
  context.resetRequestModalVisibleOptionLimits();
  assert.equal(context.getRequestModalVisibleOptions('customer:rep1', rows).shown, 20);
  assert.equal(context.buildRequestModalMoreResultsHtml(context.getRequestModalVisibleOptions('customer:rep1', rows.slice(0, 7))), '');
});

test('folder signatures reuse the already scoped rows without a duplicate inventory scan', () => {
  const functionStart = html.indexOf('        function getExistingRequestFolderRowsSignature(');
  const functionEnd = html.indexOf('\n        function ', functionStart + 1);
  let reads = 0;
  const rows = [{ UNIQUE_ID: 'request-a', REQUEST_FOLDER: 'folder-a', REQ_ARCHIVED: false }];
  const context = vm.createContext({
    getExistingRequestFolderRepRows: () => { reads++; return rows; },
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== ''),
  });
  vm.runInContext(html.slice(functionStart, functionEnd), context);
  assert.equal(context.getExistingRequestFolderRowsSignature('Rep A', rows), 'request-a:folder-a:false');
  assert.equal(reads, 0);
  assert.equal(context.getExistingRequestFolderRowsSignature('Rep A'), 'request-a:folder-a:false');
  assert.equal(reads, 1);
});

test('imperative Request modal actions claim the interaction window before background work', () => {
  const context = vm.createContext({
    Date: { now: () => 500 }, lastUserInteractionAt: 0,
    isTouchLikeInteractionStartEvent: () => false, isTouchLikeInteractionEndEvent: () => false,
    requestSubmitInFlight: true, resolveRequestRepSelectionForCurrentUser: () => '', getCartSelectedItems: () => [], showToast() {},
  });
  for (const name of ['markUserInteractionActivity', 'showRequestModalBase', 'selectRepForRequest']) {
    const functionStart = html.indexOf(`        function ${name}(`);
    const next = html.indexOf('\n        function ', functionStart + 1);
    // The interaction helper is followed by event registrations; only compile
    // its function body, excluding those global installation side effects.
    const end = name === 'markUserInteractionActivity' ? html.indexOf('\n        if (window.PointerEvent)', functionStart) : next;
    vm.runInContext(html.slice(functionStart, end), context);
  }
  assert.equal(context.showRequestModalBase(), false);
  assert.equal(context.lastUserInteractionAt, 500);
  context.lastUserInteractionAt = 0;
  assert.equal(context.selectRepForRequest(''), false);
  assert.equal(context.lastUserInteractionAt, 500);
});

test('folder lookup matches each repeated rep name once while rereading live archive and folder fields', () => {
  const functionStart = html.indexOf('        function getExistingRequestFolderRepRows(');
  const functionEnd = html.indexOf('\n        function ', functionStart + 1);
  let matches = 0;
  const rows = Array.from({ length: 12000 }, (_, id) => ({ id, REQUEST_FOLDER: 'folder', REQUESTED_BY: id % 2 ? 'Rep B' : 'Rep A' }));
  const context = vm.createContext({ requestsInventory: rows,
    resolveCanonicalRequestRepName: value => value,
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== ''),
    isRequestRowArchivedForCompletion: row => row.REQ_ARCHIVED === true,
    doesRequestRepMatchValue: (value, rep) => { matches++; return value === rep; },
  });
  vm.runInContext(html.slice(functionStart, functionEnd), context);
  assert.equal(context.getExistingRequestFolderRepRows('Rep A').length, 6000);
  assert.equal(matches, 2);
  rows[0].REQ_ARCHIVED = true; rows[2].REQUEST_FOLDER = ''; rows[4].REQUESTED_BY = 'Rep B';
  assert.equal(context.getExistingRequestFolderRepRows('Rep A').length, 5997);
  assert.equal(context.getExistingRequestFolderRepRows('Rep B').length, 6001);
  assert.equal(matches, 6, 'rep matching is recomputed for each read and selected rep');
});
