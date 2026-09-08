import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function source(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `Missing production helper ${name}`);
  const tail = html.slice(start + 1);
  const next = tail.search(/\r?\n        (?:async )?function \w+\(/);
  assert.ok(next >= 0, `Missing boundary after ${name}`);
  return html.slice(start, start + 1 + next);
}

const helpers = [
  'normalizeAppFilterStateUserKey', 'getAppFilterStateStorageKey',
  'appFilterArrayToSet', 'appFilterSetToArray', 'readAppFilterStateSnapshot', 'persistAppFilterStateNow',
  'normalizeDockSelectionMode', 'captureDockRepCustomerFilterState', 'restoreDockRepCustomerFilterState',
  'getDockSelectionMode', 'normalizeDockFilterValue', 'getDockRepFilterValue', 'getDockCustomerFilterValue',
  'buildDockFilterOptions', 'buildDockFilterState', 'applyDockRepCustomerFiltersOnly',
  'normalizeDockMobileFilterKind', 'getDockFilterOptionsForKind', 'getDockMobileFilterConfig',
  'setDockMobileFilterSelectionForKind', 'selectAllDockFilterSelection', 'selectNoDockFilterSelection',
  'clearDockInlineFilterSearchTerms', 'closeDockInlineFilterDropdowns', 'openDockInlineFilterDropdownForKind',
  'clearDockFilterSearchTermForKind', 'resetDockDrillForFilterChange',
  'toggleDockMobileFilterSheetOption', 'toggleDockFilterSelection', 'clearDockFilterSelection',
  'clearRemovedDockTopFilterState', 'buildDockFilterSummary', 'updateDockFilterSummary', 'clearDocksFilters',
  'filterDockMobileFilterOptions', 'buildDockMobileFilterSheetFragments', 'buildDockFilterOptionHtml'
];

function storage(seed = {}) {
  const entries = new Map(Object.entries(seed));
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key), clear: () => entries.clear(), entries };
}

function device({ local = storage(), session = storage(), user = 'dylan_collyge' } = {}) {
  const status = { innerHTML: '', classList: { toggle() {} } };
  const search = { value: '' };
  const clearSearch = { classList: { add() {} } };
  const escaped = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const ctx = vm.createContext({
    Set, Map, Array, Object, String, Number, Math, JSON, Date,
    currentUser: user, currentUserDisplay: '', APP_FILTER_STATE_STORAGE_KEY: 'gnc_app_filter_state_v1',
    localStorage: local, sessionStorage: session,
    selectedDockReps: new Set(), selectedDockCustomers: new Set(), dockRepSelectionMode: 'all', dockCustomerSelectionMode: 'all',
    selectedDockGenusNames: new Set(), selectedDockContSizes: new Set(), selectedDockLocationCodes: new Set(),
    dockGenusSearchTerm: '', dockContSizeSearchTerm: '', dockLocationSearchTerm: '', dockRepSearchTerm: '', dockCustomerSearchTerm: '',
    dockGenusFilterOpen: false, dockContSizeFilterOpen: false, dockLocationFilterOpen: false, dockRepFilterOpen: false, dockCustomerFilterOpen: false,
    dockColumnFilters: {}, dockColumnFilterDrafts: {}, dockColumnFilterSelectedHeaders: new Set(), dockColumnFilterDropdownOpen: false,
    dockColumnFilterStep: 'select', dockColumnFilterFieldKey: '', dockColumnFilterMode: 'values', dockColumnFilterValueSearchTerm: '',
    dockColumnFilterFieldSearchTerm: '', dockColumnFilterHeaderFieldsCache: [],
    dockFilterItemsCache: [], dockFilterStateCacheKey: '', dockFilterStateCache: null, dockWorkflowStateEpoch: 1,
    dockMobileFilterSheetState: { open: false, kind: '', search: '' }, dockViewMode: 'docks', dockViewLevel: 0,
    selectedDockNum: null, selectedDockStop: null, selectedDockName: null, selectedDockSize: null, selectedDockItemCode: null,
    selectedDockCustomer: '', selectedDockTrip: '', selectedDockRep: '', selectedDockIssueUid: null, selectedDockIssueAllocationId: '',
    docksSearchRestoreState: null,
    document: { querySelector: selector => selector === '[data-dock-filter-status]' ? status : null,
      getElementById: id => id === 'docks-search' ? search : id === 'docks-search-clear' ? clearSearch : null },
    getDatasetLoadSignature: () => 'soc:same-revision',
    buildSelectionStateKey: values => [...values].sort().join('|'),
    buildDockColumnFilterStateKey: () => JSON.stringify(ctx.dockColumnFilters),
    buildDockColumnFilterStateKeyFromMap: map => JSON.stringify(map),
    getDockColumnFilterActiveCount: () => Object.keys(ctx.dockColumnFilters).length,
    getRoleAccessState: () => ({ isAdmin: true }),
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim()) ?? '',
    normalizeDockViewDockKey: value => String(value ?? '').trim(),
    normalizeExcelFilterSearchTerm: value => String(value ?? '').trim().toLowerCase(),
    filterExcelOptionValues: (values, term) => values.filter(value => value.toLowerCase().includes(term.toLowerCase())),
    doesExcelFilterSearchMatchStart: (value, term) => value.toLowerCase().startsWith(term.toLowerCase()),
    updateRenderSignatureHash: (hash, value) => (hash * 31 + String(value).length) >>> 0,
    incrementInternalPerfCounter() {}, schedulePersistAppFilterState() {}, scheduleDocksRender() {},
    refreshDockFilterControls() {}, renderDockMobileFilterSheetOptionsOnly() {},
    cancelDockColumnFilterWindow() { ctx.dockColumnFilterDropdownOpen = false; },
    closeDockMobileFilterSheet() { ctx.dockMobileFilterSheetState = { open: false, kind: '', search: '' }; },
    escapeHtml: escaped, escJsAttrValue: escaped,
    // Any accidental backend access fails this isolated production-helper harness.
    fetch() { throw Error('Docks filtering must not write or fetch backend state'); }
  });
  vm.runInContext(helpers.map(source).join('\n'), ctx);
  ctx.captureAppFilterState = () => ({ docks: ctx.captureDockRepCustomerFilterState() });
  return { ctx, local, session, status, search };
}

const row = (id, customer, dock = '28', rep = 'Rep A') => ({ UNIQUE_ID: id, CUSTOMERNAME: customer, SALESREPNAME: rep, DOCK_NUM: dock });
const ids = rows => Array.from(rows, item => item.UNIQUE_ID);

test('All is future-inclusive; custom empty means no rows, not All', () => {
  const { ctx } = device();
  ctx.dockFilterItemsCache = [row('old', 'Customer A')];
  ctx.selectAllDockFilterSelection('customer');
  assert.equal(ctx.dockCustomerSelectionMode, 'all');
  assert.equal(ctx.selectedDockCustomers.size, 0);
  const imported = [...ctx.dockFilterItemsCache, row('new', 'New Customer', '29')];
  assert.deepEqual(ids(ctx.applyDockRepCustomerFiltersOnly(imported)), ['old', 'new']);
  ctx.selectNoDockFilterSelection('customer');
  assert.equal(ctx.dockCustomerSelectionMode, 'custom');
  assert.deepEqual(ids(ctx.applyDockRepCustomerFiltersOnly(imported)), []);
  ctx.selectAllDockFilterSelection('customer');
  assert.deepEqual(ids(ctx.applyDockRepCustomerFiltersOnly(imported)), ['old', 'new']);
});

test('legacy nonempty selections become Custom, even if once equal to all options', () => {
  const { ctx } = device();
  ctx.restoreDockRepCustomerFilterState({ selectedDockReps: [], selectedDockCustomers: ['Customer A'] });
  assert.equal(ctx.dockRepSelectionMode, 'all');
  assert.equal(ctx.dockCustomerSelectionMode, 'custom');
  assert.deepEqual(ids(ctx.applyDockRepCustomerFiltersOnly([row('a', 'Customer A'), row('b', 'Customer B')])), ['a']);
  ctx.restoreDockRepCustomerFilterState({ selectedDockCustomers: [], dockCustomerSelectionMode: 'custom' });
  assert.equal(ctx.dockCustomerSelectionMode, 'custom');
  assert.equal(ctx.applyDockRepCustomerFiltersOnly([row('a', 'Customer A')]).length, 0);
  ctx.restoreDockRepCustomerFilterState({ selectedDockCustomers: ['old'], dockCustomerSelectionMode: 'all' });
  assert.equal(ctx.selectedDockCustomers.size, 0);
});

test('rebuilding options never prunes unavailable custom choices; a later import restores their matches', () => {
  const { ctx } = device();
  ctx.restoreDockRepCustomerFilterState({ selectedDockCustomers: ['Removed Customer'] });
  const state = ctx.buildDockFilterState([row('a', 'Customer A')]);
  assert.deepEqual(Array.from(state.missingCustomers), ['Removed Customer']);
  assert.deepEqual(Array.from(ctx.selectedDockCustomers), ['Removed Customer']);
  const restored = [row('returned', 'Removed Customer')];
  ctx.buildDockFilterState(restored);
  assert.deepEqual(ids(ctx.applyDockRepCustomerFiltersOnly(restored)), ['returned']);
});

test('replacement snapshots with the same row count rebuild filter options', () => {
  const { ctx } = device();
  assert.deepEqual(Array.from(ctx.buildDockFilterState([row('a', 'Customer A')]).customerOptions), ['Customer A']);
  assert.deepEqual(Array.from(ctx.buildDockFilterState([row('b', 'Customer B')]).customerOptions), ['Customer B']);
});

test('rep/customer filters intersect and preserve distinct consignee selections', () => {
  const { ctx } = device();
  ctx.restoreDockRepCustomerFilterState({ selectedDockReps: ['Rep B'], selectedDockCustomers: ['Customer A | Site 1'] });
  const rows = [
    { ...row('match', 'Customer A', '28', 'Rep B'), CONSIGNEENAME: 'Site 1' },
    { ...row('other-site', 'Customer A', '28', 'Rep B'), CONSIGNEENAME: 'Site 2' },
    { ...row('other-rep', 'Customer A'), CONSIGNEENAME: 'Site 1' }
  ];
  assert.deepEqual(ids(ctx.applyDockRepCustomerFiltersOnly(rows)), ['match']);
});

test('desktop and mobile toggles use identical All-to-Custom and empty-selection behavior', () => {
  for (const handler of ['toggleDockFilterSelection', 'toggleDockMobileFilterSheetOption']) {
    const { ctx } = device();
    ctx.dockFilterItemsCache = [row('a', 'Customer A'), row('b', 'Customer B')];
    ctx[handler]('customer', 'Customer A');
    assert.equal(ctx.dockCustomerSelectionMode, 'custom');
    assert.deepEqual(Array.from(ctx.selectedDockCustomers), ['Customer B']);
    ctx[handler]('customer', 'Customer B');
    assert.equal(ctx.dockCustomerSelectionMode, 'custom');
    assert.equal(ctx.applyDockRepCustomerFiltersOnly(ctx.dockFilterItemsCache).length, 0);
  }
});

test('two devices keep intentional 55 vs 117 row results; new Dock 29 appears only where filters match', () => {
  const android = device(), iphone = device();
  const rows = [
    ...Array.from({ length: 55 }, (_, i) => row(`selected-${i}`, `Selected ${i % 4}`)),
    ...Array.from({ length: 62 }, (_, i) => row(`other-${i}`, 'Other Customer')),
    ...Array.from({ length: 32 }, (_, i) => row(`dock29-${i}`, 'New Customer', '29'))
  ];
  iphone.ctx.restoreDockRepCustomerFilterState({ selectedDockCustomers: ['Selected 0', 'Selected 1', 'Selected 2', 'Selected 3'] });
  for (const d of [android, iphone]) d.ctx.dockFilterItemsCache = rows;
  const all = android.ctx.applyDockRepCustomerFiltersOnly(rows);
  const filtered = iphone.ctx.applyDockRepCustomerFiltersOnly(rows);
  assert.equal(all.filter(item => item.DOCK_NUM === '28').length, 117);
  assert.equal(filtered.length, 55);
  assert.equal(all.filter(item => item.DOCK_NUM === '29').length, 32);
  assert.equal(filtered.some(item => item.DOCK_NUM === '29'), false);
  iphone.ctx.updateDockFilterSummary(rows, filtered);
  assert.match(iphone.status.innerHTML, /Showing 55 of 149 rows across docks · 1 dock hidden by filters/);
  assert.match(iphone.status.innerHTML, /Customers: 4 selected/);
  assert.match(iphone.status.innerHTML, /Saved on this device/);
  iphone.ctx.clearDocksFilters();
  assert.deepEqual(ids(iphone.ctx.applyDockRepCustomerFiltersOnly(rows)), ids(all));
  assert.equal(android.ctx.dockCustomerSelectionMode, 'all');
});

test('real per-user storage functions preserve each device across session clear/relaunch', () => {
  const android = device(), iphone = device();
  iphone.ctx.restoreDockRepCustomerFilterState({ selectedDockCustomers: ['Customer A'], dockRepSelectionMode: 'custom', selectedDockReps: [] });
  assert.equal(iphone.ctx.persistAppFilterStateNow(), true);
  assert.equal(android.ctx.persistAppFilterStateNow(), true);
  iphone.session.clear(); // The actual logout removes session storage, not the per-user local preference.
  const relaunched = device({ local: iphone.local });
  relaunched.ctx.restoreDockRepCustomerFilterState(relaunched.ctx.readAppFilterStateSnapshot().docks);
  assert.equal(relaunched.ctx.dockCustomerSelectionMode, 'custom');
  assert.deepEqual(Array.from(relaunched.ctx.selectedDockCustomers), ['Customer A']);
  assert.equal(relaunched.ctx.dockRepSelectionMode, 'custom');
  assert.equal(relaunched.ctx.selectedDockReps.size, 0);
  assert.equal(android.ctx.readAppFilterStateSnapshot().docks.dockCustomerSelectionMode, 'all');
  const otherUser = device({ local: iphone.local, user: 'another_user' });
  assert.equal(otherUser.ctx.readAppFilterStateSnapshot(), null);
});

test('Clear Docks filters clears query, columns and drill without changing mode or another device', () => {
  const d = device();
  const { ctx } = d;
  ctx.dockViewMode = 'dropoff'; ctx.dockViewLevel = 2;
  ctx.selectedDockNum = '29'; ctx.selectedDockStop = '2'; ctx.selectedDockIssueUid = 'issue';
  ctx.dockColumnFilters = { CONTSIZE: { mode: 'values', values: ['#3'] } };
  ctx.dockColumnFilterDrafts = { CONTSIZE: { mode: 'values', values: ['#5'] } };
  ctx.dockColumnFilterDropdownOpen = true;
  ctx.dockRepSearchTerm = 'rep'; ctx.dockCustomerSearchTerm = 'customer';
  ctx.docksSearchRestoreState = { selectedDockNum: '28' }; d.search.value = 'maple';
  ctx.restoreDockRepCustomerFilterState({ selectedDockCustomers: ['Customer A'] });
  ctx.clearDocksFilters();
  assert.equal(ctx.dockViewMode, 'dropoff');
  assert.equal(ctx.dockViewLevel, 0);
  assert.equal(ctx.selectedDockNum, null);
  assert.equal(ctx.selectedDockStop, null);
  assert.equal(ctx.selectedDockIssueUid, null);
  assert.equal(ctx.docksSearchRestoreState, null);
  assert.deepEqual(Object.keys(ctx.dockColumnFilters), []);
  assert.deepEqual(Object.keys(ctx.dockColumnFilterDrafts), []);
  assert.equal(ctx.dockColumnFilterDropdownOpen, false);
  assert.equal(d.search.value, '');
  assert.equal(ctx.dockRepSearchTerm, '');
  assert.equal(ctx.dockCustomerSearchTerm, '');
  assert.equal(ctx.readAppFilterStateSnapshot().docks.dockCustomerSelectionMode, 'all');
});

test('mobile choices expose All/None and distinguish custom-all from future-inclusive All', () => {
  const { ctx } = device();
  ctx.dockFilterItemsCache = [row('a', 'Customer A')];
  ctx.dockMobileFilterSheetState = { open: true, kind: 'customer', search: '' };
  let fragments = ctx.buildDockMobileFilterSheetFragments('customer');
  assert.match(fragments.optionsHtml, /All — includes new options/);
  assert.match(fragments.footerHtml, />All<.*>None<.*>Done</s);
  ctx.restoreDockRepCustomerFilterState({ selectedDockCustomers: ['Customer A', 'Missing Customer'] });
  fragments = ctx.buildDockMobileFilterSheetFragments('customer');
  assert.match(fragments.optionsHtml, /Custom · 2 selected · 1 not in current data/);
  ctx.restoreDockRepCustomerFilterState({ selectedDockCustomers: [], dockCustomerSelectionMode: 'custom' });
  assert.match(ctx.buildDockMobileFilterSheetFragments('customer').optionsHtml, /Custom · 0 selected/);
});

test('summary safely escapes customer and query text', () => {
  const d = device();
  d.ctx.restoreDockRepCustomerFilterState({ selectedDockCustomers: ['<img onerror="alert(1)">'] });
  d.ctx.updateDockFilterSummary([], [], '<script>bad</script>');
  assert.doesNotMatch(d.status.innerHTML, /<script>|<img /);
  assert.match(d.status.innerHTML, /&lt;script&gt;/);
  assert.match(d.status.innerHTML, /saved selection is not in the current data/);
});

test('production capture/restore and render are wired to the tested helpers', () => {
  assert.match(source('captureAppFilterState'), /\.\.\.captureDockRepCustomerFilterState\(\)/);
  assert.match(source('captureAppFilterState'), /dockColumnFilters: cloneDockColumnFilters\(dockColumnFilters\)/);
  assert.match(source('restorePersistedAppFilterStateForCurrentUser'), /restoreDockRepCustomerFilterState\(docks\)/);
  assert.match(source('renderDocks'), /updateDockFilterSummary\(unfilteredDockItems, items, term\)/);
  assert.match(source('buildDockFilterControlHtml'), /selectNoDockFilterSelection/);
  assert.doesNotMatch(source('buildDockFilterState'), /pruneDockFilterSelection/);
});
