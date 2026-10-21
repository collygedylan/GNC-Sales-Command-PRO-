import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const appSource = readComposedAppSource().replace(/\r\n/g, '\n');

function extractAppFunction(name) {
  const match = appSource.match(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(match, name);
  const end = appSource.indexOf('\n        function ', match.index + match[0].length);
  assert.ok(end > match.index, `${name} boundary`);
  return appSource.slice(match.index, end);
}

function createRepAvContext() {
  const sourceRows = [
    { UNIQUE_ID: 'open', ITEMCODE: ' OPEN-1500 ', COMMONNAME: 'Open stock item', CONTSIZE: '#1', SEASON: 'F1', LOCATIONCODE: 'A.01', S_LTS: '1,500' },
    { UNIQUE_ID: 'reserve', ITEMCODE: ' case-100 ', COMMONNAME: 'Rep reserve item', CONTSIZE: '#1', SEASON: 'F1', LOCATIONCODE: 'A.02', S_LTS: '0' },
    { UNIQUE_ID: 'foreign', ITEMCODE: 'OTHER-200', COMMONNAME: 'Other rep reserve item', CONTSIZE: '#1', SEASON: 'F1', LOCATIONCODE: 'A.03', S_LTS: '0' },
    { UNIQUE_ID: 'other-own-customer', ITEMCODE: 'CUSTOMER-2', COMMONNAME: 'Second customer reserve item', CONTSIZE: '#1', SEASON: 'F1', LOCATIONCODE: 'A.06', S_LTS: '0' },
    { UNIQUE_ID: 'multi-zero', ITEMCODE: 'MULTI-300', COMMONNAME: 'Aggregated item', CONTSIZE: '#2', SEASON: 'F1', LOCATIONCODE: 'A.04', S_LTS: '0' },
    { UNIQUE_ID: 'multi-open', ITEMCODE: 'multi-300', COMMONNAME: 'Aggregated item', CONTSIZE: '#2', SEASON: 'F1', LOCATIONCODE: 'A.05', S_LTS: '12' },
  ];
  const context = {
    Array, Map, Number, String, Object, Set, WeakMap, Intl,
    activeAvSalesBucket: 'current', activeAvPhotoMode: 'all', activeAVTab: 'open', activeAvOpenTab: 'name',
    AV_FILTER_SEASON_OPTIONS: ['F1', 'S1', 'U1', 'U2'],
    AV_OPEN_ALLOWED_SEASONS: ['F1', 'S1', 'U1', 'U2'],
    avDerivationMutationEpoch: 1,
    getAvPhotoMode: () => 'all',
    getAvConfiguredCurrentSeasonCode: () => 'F1', getAvConfiguredCurrentSalesYearCode: () => 27,
    getAvNextUpSeasonTarget: () => ({ season: 'S1' }), normalizeNcrSeasonCode: value => String(value || '').toUpperCase(),
    normalizeAvSalesBucket: value => String(value || 'current').trim().toLowerCase(),
    selectedAvSalesRepName: '', selectedAvRepCustomerKey: '', selectedAvResRep: '',
    fullInventory: sourceRows, avOpenInventory: sourceRows, reservesInventory: [
      { itemcode: ' case-100 ', salesrepname: 'RILEY SALES', season: 'S1', customername: 'Riley Customer' },
      { itemcode: 'OTHER-200', salesrepname: 'Other Rep', season: 'F1', customername: 'Other Customer' },
      { itemcode: 'customer-2', salesrepname: 'Riley Sales', season: 'F1', customername: 'Second Customer' },
    ], avHotPriceKeysInventory: [], avPreparedRawTabRows: new WeakMap(), resolvedViewStateEpoch: 1,
    shouldUseRepAvOpenDataset: () => true,
    getRoleAccessState: () => ({ isRep: true, isRepLike: true, isAdmin: false }),
    isMyRep: value => String(value || '').toLowerCase().includes('riley'),
    canUseAvSalesRepFilter: () => false,
    isDatasetLoaded: (key, mode) => key === 'master' && mode === 'full',
    getDatasetLoadSignature: key => `${key}:fixture`,
    getRepU3VisibilityScopeKey: () => 'all-seasons',
    getConfiguredCurrentSeasonCode: () => 'F1', getConfiguredCurrentSalesYearCode: () => '27',
    getScopedReservesItems(items) { return items.filter(row => this.isMyRep(row.salesrepname)); },
    applyRepU3VisibilityScope: rows => rows,
    getAvSalesItemCode: row => String(row && (row.ITEMCODE ?? row.itemcode) || '').trim().toUpperCase(),
    getAvSalesSeasonValue: row => String(row && (row.SEASON ?? row.season) || '').trim().toUpperCase(),
    getAvSalesYearNumber: () => 27,
    getAvSalesReserveDemandRows: () => [],
    buildAvReserveSeasonIndex: () => ({ byItemSeason: new Map(), byItemNoSeason: new Map() }),
    getAvReserveRowsForSalesItem: () => [],
    getAvSalesInventorySourceRows: () => sourceRows,
    shouldHideU3InventoryRowForRep: () => false,
    itemMatchesAvOpenSalesWindow: () => true,
    isShiftDesigItemRow: () => false,
    shouldHideNotOnInventoryApprovalRowFromInventory: () => false,
    shouldIncludeMasterItemInAvOpenStock: row => Number(String(row.S_LTS || '0').replace(/,/g, '')) > 0,
    itemMatchesAvSalesBucket: (row, bucket, matched = [], hasOpenStock = false, hasReserve = false) =>
      bucket === 'customer-open' ? matched.length > 0 || hasOpenStock || hasReserve
        || Number(String(row.S_LTS || '0').replace(/,/g, '')) > 0 : String(row.SEASON) === 'F1',
    isAvCustomerSalesBucket: bucket => bucket === 'customer' || bucket === 'customer-open',
    getAvReserveLocationUniqueKey: row => String(row.UNIQUE_ID),
    firstNonEmptyValue: (...values) => values.find(value => value != null && value !== ''),
    decorateAvSalesReserveRow: row => row,
    getSearchWordStartsForProfile() {},
    getAvFilterGenusFacetValue: row => String(row.GENUSNAME || ''),
    getAvFilterContSizeFacetValue: row => String(row.CONTSIZE || ''),
    avItemHasPhotos: () => false,
  };
  return { context, sourceRows };
}

test('rep AV current-season visibility includes open stock and own itemcode reserves only', () => {
  const { context } = createRepAvContext();
  context.getAvSalesReserveDemandRows = () => context.reservesInventory.filter(row => context.isMyRep(row.salesrepname));
  context.getAvReserveRowsForSalesItem = item => {
    const key = String(item.ITEMCODE || '').trim().toUpperCase();
    return context.reservesInventory.filter(row => context.isMyRep(row.salesrepname)
      && String(row.itemcode || '').trim().toUpperCase() === key);
  };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('sortAvOpenItems') + extractAppFunction('createAvSalesWindowPredicates') + extractAppFunction('createAvSalesRowsDerivation'), context);

  const derivation = context.createAvSalesRowsDerivation('current');
  const visible = derivation.finalize(derivation.sourceRows.map(derivation.mapRow).filter(Boolean));
  assert.deepEqual(Array.from(visible, row => row.UNIQUE_ID), ['multi-zero', 'multi-open', 'open', 'reserve', 'other-own-customer']);
});

test('a selected rep customer narrows reserve-only items but keeps positive open stock', () => {
  const { context } = createRepAvContext();
  context.activeAvSalesBucket = 'customer-open';
  context.selectedAvRepCustomerKey = 'riley-customer';
  context.getAvSalesReserveDemandRows = bucket => context.reservesInventory.filter(row => context.isMyRep(row.salesrepname)
    && (!['customer', 'customer-open'].includes(bucket) || !context.selectedAvRepCustomerKey
      || row.customername.toLowerCase().replace(/\s+/g, '-') === context.selectedAvRepCustomerKey));
  context.getAvReserveRowsForSalesItem = item => {
    const key = String(item.ITEMCODE || '').trim().toUpperCase();
    return context.reservesInventory.filter(row => context.isMyRep(row.salesrepname)
      && String(row.itemcode || '').trim().toUpperCase() === key
      && row.customername.toLowerCase().replace(/\s+/g, '-') === context.selectedAvRepCustomerKey);
  };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('sortAvOpenItems') + extractAppFunction('createAvSalesWindowPredicates') + extractAppFunction('createAvSalesRowsDerivation'), context);

  const derivation = context.createAvSalesRowsDerivation('customer-open');
  const visible = derivation.finalize(derivation.sourceRows.map(derivation.mapRow).filter(Boolean));
  assert.deepEqual(Array.from(visible, row => row.UNIQUE_ID), ['multi-zero', 'multi-open', 'open', 'reserve']);
});

test('rep AV chooses a complete master snapshot over a smaller initial AV preview', () => {
  const { context } = createRepAvContext();
  context.fullInventory = Array.from({ length: 5 }, (_, index) => ({ UNIQUE_ID: `master-${index}` }));
  context.avOpenInventory = [{ UNIQUE_ID: 'preview-only' }];
  vm.createContext(context);
  vm.runInContext(extractAppFunction('selectAvSalesInventorySourceRows'), context);
  assert.equal(context.selectAvSalesInventorySourceRows(), context.fullInventory);
});

test('rep AV reserve base rows use the complete inventory selector instead of a partial AV preview', () => {
  const { context } = createRepAvContext();
  context.fullInventory = [{ UNIQUE_ID: 'complete-master' }];
  context.avOpenInventory = [{ UNIQUE_ID: 'partial-preview' }];
  context.applyAvOpenSalesWindowScope = rows => rows;
  context.shouldIncludeMasterItemInAvSeasonView = () => true;
  vm.createContext(context);
  vm.runInContext(extractAppFunction('selectAvSalesInventorySourceRows') + extractAppFunction('getAvOpenRowsForView'), context);

  assert.deepEqual(Array.from(context.getAvOpenRowsForView(), row => row.UNIQUE_ID), ['complete-master']);
});

test('production live sync requests complete master and reserves snapshots for rep AV', () => {
  const context = {
    activeAVTab: 'open',
    shouldUseRepAvOpenDataset: () => true,
    pendingMasterFullHydrations: new Map(),
    getSupabaseReadIdentityScope: () => 'rep-scope',
    MANAGER_EVAL_REPORTS_2_VIEW: 'eval-reports-2',
    activeHomeTab: '',
  };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('getProductionCoreLiveProjection'), context);

  assert.equal(context.getProductionCoreLiveProjection('avOpen', 'av', {}), 'full');
  assert.equal(context.getProductionCoreLiveProjection('master', 'av', {}), 'full');
  assert.equal(context.getProductionCoreLiveProjection('reserves', 'av', {}), 'full');
  assert.equal(context.getProductionCoreLiveProjection('reserves', 'drive', {}), 'browse');
});

test('production live adapter preserves the full reserves projection requested for rep AV', () => {
  const context = {
    DATASET_DEFINITIONS: { reserves: { table: 'ph_reserves', fullQuery: 'select=*&order=itemcode', initialQuery: 'select=*' } },
    window: { AgMetricLiveSyncRegistry: { getSourceKeys: keys => keys } },
  };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('createProductionCoreLiveAdapter'), context);

  const adapter = context.createProductionCoreLiveAdapter('reserves', 'full');
  assert.equal(adapter.projection, 'full');
  assert.equal(adapter.cacheKey.includes('select=*&order=itemcode'), true);
});

test('legacy AV load plan requires complete reserves with complete rep season inventory', () => {
  const context = {
    getActiveManagerReportPageSurface: () => null,
    useManagerReportPages: () => false,
    canUseProductionLiveSync: () => false,
    activeAVTab: 'open',
    shouldUseRepAvOpenDataset: () => true,
    shouldPrepareAvRepCustomerFilterData: () => false,
    withEvalInventoryEditRequestsForRowView: value => value,
  };
  vm.createContext(context);
  vm.runInContext(extractAppFunction('getViewLoadingConfig'), context);
  const config = context.getViewLoadingConfig('av');
  assert.deepEqual(Array.from(config.required, item => [item.key, item.mode]), [['avOpen', 'full'], ['reserves', 'full']]);
});

test('mobile AV customer options remain in the compact Filters panel scroll flow', () => {
  const mobileRule = appSource.match(/@media \(max-width:720px\),\(pointer:coarse\)\{\s*\/\* The AV customer chooser[\s\S]*?\n\s*\}/);
  assert.ok(mobileRule, 'scoped mobile customer panel rule');
  const rule = mobileRule[0];
  assert.match(rule, /#view-av\s+#av-top-filters\.av-top-inline\s+\.mobile-browse-filter-panel\s+\[data-av-filter-shell="customer"\]\.av-filter-shell--open\s*>\s*\.task-top-control-panel\.av-excel-filter-panel--floating/);
  assert.match(rule, /position:\s*static\s*!important/);
  assert.match(rule, /width:\s*100%\s*!important/);
  assert.match(rule, /max-height:\s*min\(38vh,\s*22rem\)\s*!important/);
  assert.match(rule, /z-index:\s*auto\s*!important/);
});
