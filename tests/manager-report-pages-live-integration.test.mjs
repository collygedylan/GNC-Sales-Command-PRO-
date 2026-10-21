import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: eval
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource();
function source(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(html);
  assert.ok(match, name);
  const tail = html.slice(match.index), end = /\r?\n        (?:async )?function [A-Za-z_$]/.exec(tail);
  assert.ok(end, name);
  return tail.slice(0, end.index);
}
function run(names, globals) {
  const context = vm.createContext({ Map, Set, Date, JSON, Object, Array, String, Number, ...globals });
  vm.runInContext(names.map(source).join('\n'), context);
  return context;
}

test('report query isolates sorted report/user/season choices and current configuration', () => {
  const context = run(['buildManagerReportPageQuery'], {
    managersSearchTerm:'  Maple  ', managerEvalReportSettings:{lowStockMaxSLts:150,holdAgeDays:5,locationNoteAgeDays:10},
    getConfiguredNextSaleSeasonTarget:() => ({season:'S1',salesYear:27}),
    getConfiguredCurrentSeasonCode:() => 'F1', getConfiguredCurrentSalesYearCode:() => 27,
    getManagerEvalReportCentralDateKey:() => '2026-10-12',
    getManagerEvalReport2SelectedReportIds:() => ['u2','low-stock','u1'], getManagerEvalAssignedUsers:() => ['Zoe','Mitch'],
    getManagerEvalReport2SeasonFilters:() => new Set(['U2','U1']),
    managerEvalReport2ContSizeFilter:'all', managerEvalReport2LocationFilter:'all', managerEvalReport2PriorityFilter:'all',
    managerEvalReport2SelectedCommonName:'', managerEvalReport2SelectedBlockAlpha:'', managerEvalReport2SelectedLocationCode:'',
    managerEvalReport2SelectedContSize:'', isManagerEvalReport2ItemcodeBrowseLevel:() => true, managerEvalReport2DrillLevel:0
  });
  const query = context.buildManagerReportPageQuery('eval2');
  assert.deepEqual(Array.from(query.filters.reportIds), ['low-stock','u1','u2']);
  assert.deepEqual(Array.from(query.filters.assignedUsers), ['Mitch','Zoe']);
  assert.deepEqual(Array.from(query.filters.seasons), ['U1','U2']);
  assert.equal(query.filters.search,'Maple'); assert.equal(query.filters.centralDate,'2026-10-12');
  assert.equal(query.filters.thresholds.lowStockMaxSLts,150); assert.equal(query.limit,25);
  assert.equal(context.buildManagerReportPageQuery('eval2','rows').limit,100);
});

test('Eval2 opts out of paged reports while other advertised surfaces retain the controller', () => {
  const enabled = new Set(['eval1', 'eval2', 'assigned-items']);
  const controllerCalls = [];
  const context = run(['useManagerReportPages'], {
    window:{GncReportPagesLive:{}}, currentUser:{username:'manager'},
    getManagerReportPageController:() => ({ enabled:surface => { controllerCalls.push(surface); return enabled.has(surface); } })
  });
  assert.equal(context.useManagerReportPages('eval2'), false);
  assert.equal(context.useManagerReportPages('eval1'), true);
  assert.equal(context.useManagerReportPages('assigned-items'), true);
  assert.deepEqual(controllerCalls, ['eval1', 'assigned-items']);
});

test('direct Eval2 full-snapshot ensures use bounded master-page concurrency', async () => {
  let adapter = null;
  const pageConcurrency = [];
  const context = run(['createProductionCoreLiveAdapter', 'ensureDatasetLoaded'], {
    window:{AgMetricLiveSyncRegistry:{getSourceKeys:() => ['ph_master_inventory']}},
    DATASET_DEFINITIONS:{master:{table:'ph_master_inventory',fullQuery:'select=*',initialQuery:'select=*'}},
    RETIRED_DATASET_KEYS:new Set(),
    getSupabaseReadIdentityScope:() => 'manager-scope',
    appAccessSnapshotState:{snapshot:{dataPermissionVersion:'manager-policy'}},
    currentMasterPreparationSeasonKey:() => 'F1:2026',
    prepareProductionMasterSnapshot:async (rows, options = {}) => ({
      rawRows:options.includeRawRows === false ? [] : JSON.parse(JSON.stringify(rows)),
      payload:{data:rows}, rowCount:rows.length
    }),
    getCurrentAppSeasonSettings:() => ({seasonCode:'F1',salesYear:2026}),
    getCurrentVisibleViewId:() => 'managers', activeHomeTab:'eval2', MANAGER_EVAL_REPORTS_2_VIEW:'eval2',
    getProductionLiveSyncCoordinator:() => ({ensure:value => { adapter = value; return Promise.resolve(true); }}),
    canUseProductionLiveSync:() => true,
    getProductionLiveSyncContext:() => ({ adapters: [] }),
    withProductionLiveSyncSignal:(_signal, operation) => operation({aborted:false}),
    fetchAllInventoryReadRows:async (_operation, _params, options) => {
      pageConcurrency.push(options.pageConcurrency);
      const rows = [];
      rows.readMeta = {fieldCoverage:'full',columns:[]};
      return rows;
    },
    buildDatasetPayload:() => ({}), validateInventoryReadProjection:() => true,
    canUseHlOrder:() => false
  });
  await context.ensureDatasetLoaded('master','full');
  assert.ok(adapter, 'the production ensure path must create the core adapter');
  await adapter.stage();
  assert.deepEqual(pageConcurrency, [2], 'direct ensure must share Eval2 full-master concurrency policy');
});

test('full inventory reader bounds concurrent offsets and rejects inconsistent snapshots', async () => {
  const readerSource = source('fetchAllInventoryReadRows');
  const makeReader = fetchInventoryReadPage => run(['fetchAllInventoryReadRows'], {
    fetchInventoryReadPage, yieldToUiFrame:async () => {}, console:{warn() {}}
  });
  const page = (rows, total = 5) => ({ rows, total, hasMore:rows.length > 0, projection:'full', fieldCoverage:'full', columns:['UNIQUE_ID'] });
  let active = 0, maxActive = 0;
  const offsets = [], deferred = new Map();
  const context = vm.createContext({ Map, Set, Date, JSON, Object, Array, String, Number,
    fetchInventoryReadPage:async (_operation, _params, _limit, offset) => {
      offsets.push(offset);
      if (offset === 0) return page([{unique_id:'row-0'},{unique_id:'row-1'}]);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise(resolve => deferred.set(offset, rows => { active -= 1; resolve(page(rows)); }));
    },
    yieldToUiFrame:async () => {}, console:{warn() {}}
  });
  vm.runInContext(`${readerSource};globalThis.read = fetchAllInventoryReadRows;`, context);
  const resultPromise = context.read('master_page', {projection:'full'}, {limit:2,pageConcurrency:2,requireComplete:true});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(maxActive, 2, 'the reader runs at most two subsequent pages at once');
  assert.deepEqual(offsets, [0,2,4], 'each page offset is requested exactly once');
  deferred.get(4)([{unique_id:'row-4'}]);
  deferred.get(2)([{unique_id:'row-2'},{unique_id:'row-3'}]);
  const rows = await resultPromise;
  assert.deepEqual(Array.from(rows, item => item.unique_id), ['row-0','row-1','row-2','row-3','row-4']);

  async function rejectsPageSet(nextPages, matcher) {
    const reader = makeReader(async (_operation, _params, _limit, offset) => {
      if (offset === 0) return page([{unique_id:'row-0'},{unique_id:'row-1'}]);
      return nextPages[offset]();
    });
    await assert.rejects(reader.fetchAllInventoryReadRows('master_page', {projection:'full'}, {limit:2,pageConcurrency:2,requireComplete:true}), matcher);
  }
  await rejectsPageSet({
    2:() => Promise.resolve(page([{unique_id:'row-2'},{unique_id:'row-3'}], 6)),
    4:() => Promise.resolve(page([{unique_id:'row-4'}], 6))
  }, /total changed between pages/);
  await rejectsPageSet({
    2:() => Promise.resolve(page([{unique_id:'row-2'},{unique_id:'row-3'}])),
    4:() => Promise.resolve(page([]))
  }, /page was incomplete/);
  await rejectsPageSet({
    2:() => Promise.resolve(page([{unique_id:'row-1'},{unique_id:'row-3'}])),
    4:() => Promise.resolve(page([{unique_id:'row-4'}]))
  }, /Complete inventory rows could not be verified/);
});

test('legacy LowStock All Users snapshot renders Block Alpha through ITEMCODE drill groups', () => {
  const rows = [
    {UNIQUE_ID:'low-1',ITEMCODE:'ALPHA-1',BLOCKALPHA:'A',LOCATIONCODE:'L-01',ASSIGNEDTO:'Manager A'},
    {UNIQUE_ID:'low-2',ITEMCODE:'ALPHA-2',BLOCKALPHA:'A',LOCATIONCODE:'L-01',ASSIGNEDTO:'Manager B'},
    {UNIQUE_ID:'low-3',ITEMCODE:'BETA-1',BLOCKALPHA:'B',LOCATIONCODE:'L-02',ASSIGNEDTO:''}
  ];
  const index = {reports:{'low-stock':rows},selectedReportRows:new Map()};
  const context = run([
    'getManagerEvalReport2Rows', 'getManagerEvalReport2RowsBeforeCommonName', 'managerEvalAssignedUserMatches',
    'getManagerEvalReport2DrillGroups', 'renderManagerEvalReport2DrillGroupCard'
  ], {
    getManagerEvalReport2Index:() => index,
    getManagerEvalReport2SelectedReportIds:() => ['low-stock'],
    getManagerEvalReport2RowKey:row => row.UNIQUE_ID,
    getManagerEvalAssignedUserSet:() => new Set(),
    managerEvalReport2AssignmentFilterRefreshing:false,
    getManagerEvalReport2SeasonFilters:() => new Set(),
    doesManagerEvalReport2RowMatchSeasonFilter:() => true,
    managerEvalReport2ContSizeFilter:'all', managerEvalReport2LocationFilter:'all', managerEvalReport2PriorityFilter:'all',
    getManagerEvalReportRowPriority:() => '', managerEvalReportRowMatchesSearch:() => true,
    getDriveBlockAlphaValue:row => row.BLOCKALPHA || '__NO_BLOCK_ALPHA__',
    getDriveBlockAlphaLabel:value => value === '__NO_BLOCK_ALPHA__' ? 'No Block Alpha' : value,
    getManagerEvalReportRowLocation:row => row.LOCATIONCODE,
    getManagerEvalReport2ItemCode:row => row.ITEMCODE,
    compareManagerEvalReport2Natural:(left,right) => String(left).localeCompare(String(right),undefined,{numeric:true}),
    escapeHtml:value => String(value), escJsAttrValue:value => String(value),
    managerEvalReport2BrowseMode:'location', managerEvalReport2DrillLevel:0,
    managerEvalReport2SelectedBlockAlpha:'', managerEvalReport2SelectedLocationCode:''
  });
  const selectedRows = context.getManagerEvalReport2RowsBeforeCommonName();
  assert.deepEqual(Array.from(selectedRows, row => row.ITEMCODE), ['ALPHA-1','ALPHA-2','BETA-1']);
  let groups = context.getManagerEvalReport2DrillGroups(selectedRows);
  assert.deepEqual(Array.from(groups, group => [group.kind,group.label,group.itemCount]), [['blockalpha','A',2],['blockalpha','B',1]]);
  assert.match(context.renderManagerEvalReport2DrillGroupCard(groups[0]), /Block Alpha/);
  context.managerEvalReport2DrillLevel = 1;
  context.managerEvalReport2SelectedBlockAlpha = 'A';
  groups = context.getManagerEvalReport2DrillGroups(selectedRows);
  assert.deepEqual(Array.from(groups, group => [group.kind,group.label,group.itemCount]), [['locationcode','L-01',2]]);
  context.managerEvalReport2DrillLevel = 2;
  context.managerEvalReport2SelectedLocationCode = 'L-01';
  groups = context.getManagerEvalReport2DrillGroups(selectedRows);
  assert.deepEqual(Array.from(groups, group => [group.kind,group.label,group.itemCount]), [['itemcode','ALPHA-1',1],['itemcode','ALPHA-2',1]]);
  assert.match(context.renderManagerEvalReport2DrillGroupCard(groups[0]), /ALPHA-1/);
});

test('legacy Eval2 cold load deduplicates snapshot requests without fetching per-item LowStock targets', async () => {
  let release, settingsReads = 0, targetReads = 0, indexBuilds = 0, pagedCalls = 0;
  const datasetReads = [];
  const gate = new Promise(resolve => { release = resolve; });
  const context = run(['useManagerReportPages', 'loadManagerEvalReports2'], {
    window:{GncReportPagesLive:{}}, currentUser:{username:'manager'},
    getManagerReportPageController:() => ({
      state:() => ({pendingKey:'',promise:null,error:'',page:null}),
      enabled:() => { pagedCalls += 1; return true; },
      load:async () => { pagedCalls += 1; return {sourceRevision:'paged-r1'}; }
    }),
    canViewManagerEvalReports2:() => true,
    getSupabaseReadIdentityScope:() => 'account-a',
    managerEvalReport2LoadState:{loading:false,error:'',owner:'',promise:null},
    managerEvalReport2Cache:null, managerEvalReport2CacheKey:'',
    getDatasetLoadSignature:key => `${key}-source-r1`,
    ensureDatasetLoaded:async (key, mode) => { datasetReads.push([key, mode]); await gate; },
    loadManagerEvalReportSettings:async () => { settingsReads += 1; },
    isDatasetLoaded:() => true,
    getManagerEvalReport2SelectedReportIds:() => ['low-stock'],
    canReadItemLowStockTargets:() => true,
    loadManagerItemLowStockTargets:async force => { assert.equal(force, false); targetReads += 1; },
    managerEvalReport2LowStockTargetsReady:() => true,
    getManagerEvalReport2LatestSourceUpdate:() => '',
    scheduleManagersRender:() => {}, getCurrentVisibleViewId:() => '', activeHomeTab:'', MANAGER_EVAL_REPORTS_2_VIEW:'eval2',
    fullInventory:[{unique_id:'inventory-row',itemcode:'ALPHA-1',blockalpha:'A',s_lts:10}],
    warehouseAssignedItemsInventory:[{unique_id:'assignment-row',itemcode:'ALPHA-1',assignedto:'Manager A'}],
    buildManagerEvalReport2IndexAsync:async () => { indexBuilds += 1; return {counts:{'low-stock':1}}; },
    invalidateManagerEvalReport2Cache:() => {}, getFriendlyBackendErrorMessage:error => error.message,
    reportSemanticHealthEvent:() => {}, showToast:() => {}
  });

  const first = context.loadManagerEvalReports2(false);
  const second = context.loadManagerEvalReports2(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(datasetReads, [['master','full'],['warehouseAssignedItems','full']], 'one full master and assignments snapshot read');
  assert.equal(pagedCalls, 0, 'the production Eval2 gate must bypass report-page calls');
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult, secondResult);
  assert.equal(settingsReads, 1);
  assert.equal(targetReads, 0, 'Eval2 LowStock uses the shared threshold and must not wait on per-item target reads');
  assert.equal(indexBuilds, 1);
  assert.deepEqual(firstResult.counts, {'low-stock':1});
});

test('legacy Eval2 cache key tracks source, settings, and report date but ignores target revision', () => {
  const dimensions = {
    master:'master-r1', warehouseAssignedItems:'assign-r1',
    currentSeason:'F1', currentYear:27, nextSeason:'S1', nextYear:27,
    lowStockMax:150, holdAge:5, noteAge:10, targetRevision:1, date:'2026-10-14'
  };
  const context = run(['getManagerEvalReport2CacheKeyValue'], {
    getDatasetLoadSignature:key => dimensions[key],
    fullInventory:[], warehouseAssignedItemsInventory:[],
    getConfiguredCurrentSeasonCode:() => dimensions.currentSeason,
    getConfiguredCurrentSalesYearCode:() => dimensions.currentYear,
    getConfiguredNextSaleSeasonTarget:() => ({season:dimensions.nextSeason,salesYear:dimensions.nextYear}),
    managerEvalReportSettings:{get lowStockMaxSLts(){return dimensions.lowStockMax;},get holdAgeDays(){return dimensions.holdAge;},get locationNoteAgeDays(){return dimensions.noteAge;}},
    getManagerItemLowStockTargetsState:() => ({revision:dimensions.targetRevision}),
    getManagerEvalReportCentralDateKey:() => dimensions.date
  });
  const baseline = context.getManagerEvalReport2CacheKeyValue();
  for (const [key, value] of Object.entries({master:'master-r2',warehouseAssignedItems:'assign-r2',lowStockMax:151,holdAge:6,noteAge:11,targetRevision:2,date:'2026-10-15'})) {
    const previous = dimensions[key]; dimensions[key] = value;
    if (key === 'targetRevision') assert.equal(context.getManagerEvalReport2CacheKeyValue(), baseline, 'a warmed per-item target override is not part of Eval2 classification');
    else assert.notEqual(context.getManagerEvalReport2CacheKeyValue(), baseline, `${key} changes must invalidate the derived index`);
    dimensions[key] = previous;
  }
});

test('warm legacy Eval2 index reuses its exact cache key without starting classification', async () => {
  const cached = {reports:{'low-stock':[]},rowsByItemCode:new Map()};
  let classifications = 0, reconciliations = 0;
  const context = run(['getManagerEvalReport2CacheKeyValue','performManagerEvalReport2IndexBuild'], {
    getDatasetLoadSignature:key => `${key}-r1`, fullInventory:[{unique_id:'a'}], warehouseAssignedItemsInventory:[{unique_id:'b'}],
    getConfiguredCurrentSeasonCode:() => 'F1', getConfiguredCurrentSalesYearCode:() => 27,
    getConfiguredNextSaleSeasonTarget:() => ({season:'S1',salesYear:27}),
    managerEvalReportSettings:{lowStockMaxSLts:150,holdAgeDays:5,locationNoteAgeDays:10},
    getManagerItemLowStockTargetsState:() => ({revision:1}), getManagerEvalReportCentralDateKey:() => '2026-10-14',
    getSupabaseReadIdentityScope:() => 'account-a',
    managerEvalReport2Cache:cached, managerEvalReport2NeedsReconcile:true,
    reconcileManagerEvalReport2Navigation:() => { reconciliations += 1; },
    getManagerEvalReports2Api:() => { classifications += 1; throw new Error('unexpected classification'); }
  });
  context.managerEvalReport2CacheKey = context.getManagerEvalReport2CacheKeyValue();
  assert.equal(await context.performManagerEvalReport2IndexBuild({}), cached);
  assert.equal(classifications, 0);
  assert.equal(reconciliations, 1);
});

test('paged action rows cannot fall back to a shared full inventory snapshot', () => {
  const state = { revision:'r2',completeItems:new Map() }, current = [{unique_id:'current'}];
  const context = run(['getManagerEvalReport2AllCurrentItemRows'], {
    useManagerReportPages:() => true, getManagerReportPageController:() => ({state:() => state}),
    getManagerEvalReport2Index:() => ({currentAssignedRowsByCode:new Map([['ABC',current]])}),
    fullInventory:[{unique_id:'old',itemcode:'ABC'}]
  });
  assert.equal(context.getManagerEvalReport2AllCurrentItemRows('ABC').length,0);
  state.completeItems.set('ABC','r1'); assert.equal(context.getManagerEvalReport2AllCurrentItemRows('ABC').length,0);
  state.completeItems.set('ABC','r2'); assert.equal(context.getManagerEvalReport2AllCurrentItemRows('ABC'),current);
});

test('complete item hydration uses bounded detail reads and populates action membership independently', async () => {
  const state = {revision:'r1',completeItems:new Map()}, requests = [];
  const index = {paged:true,sourceRevision:'r1',rowsByItemCode:new Map(),currentAssignedRowsByCode:new Map(),rowByKey:new Map(),
    reportMembershipByKey:new Map(),itemReportIds:new Map(),reports:{u1:[],'no-pri':[]},selectedReportRows:new Map([['u1',[]]])};
  const rows = [{unique_id:'a',itemcode:'ABC',reportIds:['u1']},{unique_id:'b',itemcode:'ABC',reportIds:['no-pri']}];
  const context = run(['normalizePagedManagerRow','loadPagedManagerItem'], {
    getManagerReportPageController:() => ({state:() => state,readComplete:async query => {requests.push(query);return {rows,sourceRevision:'r1'};}}),
    buildManagerReportPageQuery:(surface,operation,extra) => ({surface,operation,...extra,offset:0,limit:100}),
    getManagerEvalReport2Index:() => index, getManagerEvalReport2RowKey:row => row.UNIQUE_ID,
    getManagerEvalReport2ItemCode:row => row.ITEMCODE, getSupabaseReadIdentityScope:() => 'account-a',
    appAccessSnapshotState:{snapshot:{dataPermissionVersion:'p1'}},managerReportScopedRows:new Map()
  });
  const complete = await context.loadPagedManagerItem('ABC');
  assert.equal(complete.length,2); assert.equal(requests[0].operation,'detail'); assert.equal(requests[0].limit,100);
  assert.deepEqual(Array.from(requests[0].filters.seasons),[]); assert.deepEqual(Array.from(requests[0].filters.assignedUsers),[]);
  assert.equal(requests[0].filters.cardRows,true); assert.equal(requests[0].sourceRevision,'r1');
  assert.equal(state.completeItems.get('ABC'),'r1'); assert.equal(index.currentAssignedRowsByCode.get('ABC').length,2);
  assert.equal(index.reports.u1.length,1); assert.equal(index.selectedReportRows.size,0);
  assert.equal(context.managerReportScopedRows.get(JSON.stringify(['account-a','p1','a'])).UNIQUE_ID,'a');
});

test('paged Eval2 detail pruning retains selected, open, and drafted ITEMCODEs only', () => {
  const rows = [
    { UNIQUE_ID:'selected-row', ITEMCODE:'SELECTED' },
    { UNIQUE_ID:'open-row', ITEMCODE:'OPEN' },
    { UNIQUE_ID:'draft-row', ITEMCODE:'DRAFT' },
    { UNIQUE_ID:'closed-row', ITEMCODE:'CLOSED' }
  ];
  const index = {
    paged:true,
    rowsByItemCode:new Map(rows.map(row => [row.ITEMCODE,[row]])),
    currentAssignedRowsByCode:new Map(rows.map(row => [row.ITEMCODE,[row]])),
    itemReportIds:new Map(rows.map(row => [row.ITEMCODE,new Set(['r1'])])),
    rowByKey:new Map(rows.map(row => [row.UNIQUE_ID,row])),
    reportMembershipByKey:new Map(rows.map(row => [row.UNIQUE_ID,new Set(['r1'])])),
    reports:{r1:rows.slice()}
  };
  const scoped = new Map(rows.map(row => [JSON.stringify(['account','p1',row.UNIQUE_ID]),row]));
  const state = {completeItems:new Map(rows.map(row => [row.ITEMCODE,'rev']))};
  const context = run(['prunePagedManagerEval2ItemDetails'], {
    useManagerReportPages:() => true, getManagerEvalReport2Index:() => index,
    getManagerEvalReport2SelectedEntries:() => [{itemCode:'SELECTED'}],
    managerEvalReport2DetailItemKey:'item:OPEN',
    managerEvalReport2EditsByRowKey:new Map([['draft-row',{rowKey:'draft-row'}]]),
    getManagerEvalReport2ItemCode:row => String(row?.ITEMCODE || '').toUpperCase(),
    getManagerEvalReport2RowKey:row => row.UNIQUE_ID,
    managerReportScopedRows:scoped,
    getManagerReportPageController:() => ({state:() => state})
  });
  assert.equal(context.prunePagedManagerEval2ItemDetails(),1);
  assert.deepEqual(Array.from(index.rowsByItemCode.keys()).sort(),['DRAFT','OPEN','SELECTED']);
  assert.equal(index.rowByKey.has('closed-row'),false);
  assert.equal(index.reports.r1.some(row => row.ITEMCODE === 'CLOSED'),false);
  assert.equal(state.completeItems.has('CLOSED'),false);
  assert.equal(scoped.has(JSON.stringify(['account','p1','closed-row'])),false);
  assert.equal(scoped.has(JSON.stringify(['account','p1','selected-row'])),true);
});

test('paged action proof rejects changed revisions, failed refreshes, and changed draft baselines', () => {
  const state={revision:'r1',error:'',completeItems:new Map([['ABC','r1']])};
  const context=run(['hasPagedManagerEvalActionProof'], {
    getManagerReportPageController:() => ({state:() => state}),
    managerEvalReport2Cache:{paged:true,rowByKey:new Map([['a',{priority:'2'}]])},managerEvalReport2DetailItemKey:'',
    getManagerEvalReport2SelectedEntries:() => [{itemCode:'ABC'}],managerEvalReport2EditsByRowKey:new Map(),
    buildManagerEvalReport2EditBaseline:row => ({priority:row.priority})
  });
  assert.equal(context.hasPagedManagerEvalActionProof(),true);
  state.revision='r2'; assert.equal(context.hasPagedManagerEvalActionProof(),false); state.revision='r1';
  state.error='offline'; assert.equal(context.hasPagedManagerEvalActionProof(),false); state.error='';
  context.managerEvalReport2EditsByRowKey.set('a',{rowKey:'a',baseline:{priority:'1'}});
  assert.equal(context.hasPagedManagerEvalActionProof(),false);
});

test('visible row lookup drops detached hosts and rejects a different permission scope', () => {
  let permission='p1'; const host={isConnected:true};
  const rows = new Map([[host,{owner:'account-a',permission:'p1',rows:[{UNIQUE_ID:'a'}]}]]);
  const context=run(['findVisibleManagerReportRow'], {
    getSupabaseReadIdentityScope:() => 'account-a',appAccessSnapshotState:{get snapshot(){return {dataPermissionVersion:permission};}},
    managerReportVisibleRows:rows
  });
  assert.equal(context.findVisibleManagerReportRow('a').UNIQUE_ID,'a');
  permission='p2'; assert.equal(context.findVisibleManagerReportRow('a'),null); assert.equal(rows.size,0);
  rows.set(host,{owner:'account-a',permission:'p2',rows:[{UNIQUE_ID:'a'}]}); host.isConnected=false;
  assert.equal(context.findVisibleManagerReportRow('a'),null); assert.equal(rows.size,0);
});

test('selection tray counts use complete server metadata independently of retained rows', () => {
  const state={revision:'r1',selectionStatsKey:JSON.stringify(['r1',['ABC']]),selectedRowCount:680,selectedLocationCount:12};
  const context=run(['getManagerEvalReport2SelectionCounts'],{
    getManagerEvalReport2SelectedRows:() => [],useManagerReportPages:() => true,
    getManagerEvalReport2VisibleSelectionState:() => ({}),getManagerReportPageController:() => ({state:() => state}),
    getManagerEvalReport2SelectedEntries:() => [{itemCode:'ABC'}],getManagerEvalReportRowLocation:row => row.locationcode
  });
  assert.equal(context.getManagerEvalReport2SelectionCounts().rowCount,680);
  assert.equal(context.getManagerEvalReport2SelectionCounts().locationCount,12);
  state.revision='r2';assert.equal(context.getManagerEvalReport2SelectionCounts().rowCount,0);
});

test('Eval2 report index waits for verified metadata and then exposes populated report counts', () => {
  const state = { revision:'', metadata:{}, page:null, rows:[] };
  const context = run(['createPagedManagerEvalIndex','getManagerEvalReport2Index'], {
    useManagerReportPages:() => true,
    getManagerReportPageController:() => ({ state:() => state }),
    getSupabaseReadIdentityScope:() => 'account-a',
    appAccessSnapshotState:{snapshot:{dataPermissionVersion:'p1'}},
    managerEvalReport2Cache:null,
    getManagerEvalReportsApi:() => ({ REPORT_IDS:['low-stock','s1-with-pri'] }),
    getConfiguredCurrentSeasonCode:() => 'S1', getConfiguredCurrentSalesYearCode:() => 27,
    getConfiguredNextSaleSeasonTarget:() => ({season:'S2',salesYear:27}),
    managerEvalReportSettings:{}
  });
  assert.equal(context.getManagerEvalReport2Index(), null);
  state.revision = 'rev-1';
  state.metadata = { counts:{'low-stock':3,'s1-with-pri':2} };
  state.page = { rows:[], sourceRevision:'rev-1', metadata:state.metadata };
  const index = context.getManagerEvalReport2Index();
  assert.equal(index.counts['low-stock'], 3);
  assert.equal(index.counts['s1-with-pri'], 2);
  state.metadata = { counts:{}, inventoryRowCount:0 };
  state.revision = 'empty-rev';
  assert.equal(context.getManagerEvalReport2Index().inventoryRowCount, 0);
});

test('Eval2 loader falls back to full inventory after paged capabilities resolve unsupported', async () => {
  const calls = [];
  let paged = true;
  const context = run(['loadManagerEvalReports2'], {
    canViewManagerEvalReports2:() => true,
    useManagerReportPages:() => paged,
    getManagerReportPageController:() => ({
      state:() => ({}),
      load:async () => { calls.push('metadata'); paged = false; return null; }, enabled:() => false
    }),
    buildManagerReportPageQuery:(surface, operation) => ({surface,operation}),
    getSupabaseReadIdentityScope:() => 'account-a',
    managerEvalReport2LoadState:{loading:false,error:'',owner:'',promise:null},
    managerEvalReport2Cache:null, managerEvalReport2CacheKey:'',
    getDatasetLoadSignature:key => `${key}-signature`,
    ensureDatasetLoaded:async key => { calls.push(key); },
    loadManagerEvalReportSettings:async () => { calls.push('settings'); },
    isDatasetLoaded:() => true,
    managerEvalReport2NeedsLowStockTargets:() => false,
    getManagerEvalReport2LatestSourceUpdate:() => '',
    scheduleManagersRender:() => {},
    getCurrentVisibleViewId:() => '',
    activeHomeTab:'', MANAGER_EVAL_REPORTS_2_VIEW:'eval2',
    fullInventory:[{unique_id:'inventory'}], warehouseAssignedItemsInventory:[{unique_id:'assignment'}],
    buildManagerEvalReport2IndexAsync:async () => ({ counts:{'low-stock':1} }),
    invalidateManagerEvalReport2Cache:() => {},
    getFriendlyBackendErrorMessage:error => error.message,
    reportSemanticHealthEvent:() => {}, showToast:() => {}
  });
  const result = await context.loadManagerEvalReports2(false);
  assert.deepEqual(calls.slice(0, 4), ['metadata','master','warehouseAssignedItems','settings']);
  assert.deepEqual(result.counts, {'low-stock':1});
});

test('supported Eval2 load explicitly fetches report metadata before rendering the index', async () => {
  const calls = [];
  const controller = {
    refresh:surface => calls.push(`refresh:${surface}`),
    initialize:async () => { calls.push('initialize'); return {}; },
    enabled:() => true,
    load:async (query, fresh) => { calls.push(`load:${query.surface}:${query.operation}:${fresh}`); return { metadata:{counts:{'low-stock':4}}, rows:[] }; },
    state:() => ({page:{sourceRevision:'r1'}})
  };
  const context = run(['loadManagerEvalReports2'], {
    canViewManagerEvalReports2:() => true, useManagerReportPages:() => true,
    getManagerReportPageController:() => controller,
    buildManagerReportPageQuery:(surface, operation) => ({surface,operation}),
    getSupabaseReadIdentityScope:() => 'account-a',
    managerEvalReport2LoadState:{loading:false,error:'',owner:'',promise:null},
    managerEvalReport2Cache:{paged:true,counts:{'low-stock':4}}, managerEvalReport2CacheKey:'',
    getDatasetLoadSignature:() => '', scheduleManagersRender:() => {},
    MANAGER_EVAL_REPORTS_2_VIEW:'eval2', activeHomeTab:'',
    getCurrentVisibleViewId:() => '',
    getManagerEvalReport2Index:() => ({paged:true,counts:{'low-stock':4}})
  });
  const result = await context.loadManagerEvalReports2(false);
  assert.deepEqual(calls, ['load:eval2:metadata:false']);
  assert.equal(result.counts['low-stock'], 4);
});

function evalLoadFixture(paged) {
  let account = 'account-a', permission = 'p1', fail = true, gate = null;
  let queuedRender = false, rendered = '', rowRefreshes = 0, capabilityCalls = 0;
  let failCapabilities = false;
  const timers = [], requests = [], loaded = new Set();
  const index = { counts:{'low-stock':1}, diagnostics:{} };
  const context = run([
    'getManagerReportPageController', 'buildManagerReportPageQuery',
    'ensurePagedManagerReportMetadata', 'managerEvalReport2DisplaySourcesReady',
    'loadManagerEvalReports2', 'renderManagerEvalReports2Panel'
  ], {
    AbortController,
    managerReportPageController:null,
    managerEvalReport2LoadState:{loading:false,error:'',owner:'',promise:null},
    managerEvalReport2Cache:null, managerEvalReport2CacheKey:'',
    getSupabaseReadIdentityScope:() => account,
    appAccessSnapshotState:{get snapshot() { return {dataPermissionVersion:permission}; }},
    canViewManagerEvalReports2:() => true, useManagerReportPages:() => paged,
    getManagerEvalReports2Api:() => ({}),
    getManagerEvalReport2Index:() => paged
      ? context.getManagerReportPageController().state('eval2').page && index
      : context.managerEvalReport2Cache,
    createPagedManagerEvalIndex:() => index,
    getCurrentVisibleViewId:() => 'managers', isViewVisible:() => true,
    activeHomeTab:'eval2', MANAGER_EVAL_REPORTS_2_VIEW:'eval2',
    APP_API_FUNCTION_URL:'mock-only', SUPABASE_READ_TIMEOUT_MS:1000,
    postAppFunctionJson:async (_url, body) => {
      if (body.operation === 'capabilities') {
        capabilityCalls += 1;
        return failCapabilities ? {ok:false,error:'capability failure',status:503}
          : {ok:true,data:{surfaces:['eval2']}};
      }
      requests.push(body.query);
      if (gate) await gate;
      return fail ? {ok:false,error:'database failure',status:503}
        : {ok:true,data:{rows:[],sourceRevision:'r1',metadata:{counts:{'low-stock':1}}}};
    },
    signalProductionLiveSync:() => {}, syncManagerEvalReport2SelectionUi:() => {},
    scheduleManagersRender:() => { queuedRender = true; },
    setTimeout:callback => { timers.push(callback); return timers.length; },
    escapeHtml:value => String(value),
    managersSearchTerm:'', managerEvalReportSettings:{lowStockMaxSLts:150,holdAgeDays:5,locationNoteAgeDays:10},
    getConfiguredNextSaleSeasonTarget:() => ({season:'S1',salesYear:27}),
    getConfiguredCurrentSeasonCode:() => 'F1', getConfiguredCurrentSalesYearCode:() => 27,
    getManagerEvalReportCentralDateKey:() => '2026-10-14',
    getManagerEvalReport2SelectedReportIds:() => ['low-stock'], getManagerEvalAssignedUsers:() => [],
    getManagerEvalReport2SeasonFilters:() => new Set(),
    managerEvalReport2ContSizeFilter:'all', managerEvalReport2LocationFilter:'all', managerEvalReport2PriorityFilter:'all',
    managerEvalReport2SelectedCommonName:'', managerEvalReport2SelectedBlockAlpha:'', managerEvalReport2SelectedLocationCode:'',
    managerEvalReport2SelectedContSize:'', isManagerEvalReport2ItemcodeBrowseLevel:() => false, managerEvalReport2DrillLevel:0,
    managerEvalReport2AssignmentFilterRefreshing:false, managerEvalReport2DetailItemKey:'',
    getManagerEvalReport2Meta:() => ({label:'LowStock'}),
    getManagerEvalReport2LatestSourceUpdate:() => '',
    renderManagerEvalReport2MoreMenu:() => '', renderManagerEvalReport2ReportsPanel:() => '<div>Block Alpha cards</div>',
    getDatasetLoadSignature:key => `${key}-signature`,
    ensureDatasetLoaded:async key => {
      requests.push(key);
      if (key === 'master') {
        if (gate) await gate;
        if (fail) throw new Error('database failure');
      }
      loaded.add(key);
    },
    isDatasetLoaded:key => loaded.has(key), canUseProductionLiveSync:() => false,
    loadManagerEvalReportSettings:async () => {}, managerEvalReport2NeedsLowStockTargets:() => false,
    fullInventory:[], warehouseAssignedItemsInventory:[],
    invalidateManagerEvalReport2Cache:() => {},
    buildManagerEvalReport2IndexAsync:async () => { context.managerEvalReport2Cache = index; return index; },
    getFriendlyBackendErrorMessage:error => error.message, reportSemanticHealthEvent:() => {}, showToast:() => {},
    managerReportVisibleRows:new Map(), managerReportScopedRows:new Map(),
    managerPagedLocationScroll:new Map(), managerReportGridFilters:new Map(),
    managerEvalReport2SelectedItemsByKey:new Map(), managerEvalReport2EditsByRowKey:new Map(),
    managerEvalAssignmentSelection:new Map()
  });
  vm.runInContext(readFileSync(new URL('../assets/report-pages-live.js', import.meta.url), 'utf8'), context);
  const create = context.GncReportPagesLive.createController;
  context.GncReportPagesLive.createController = options => {
    const controller = create({...options, loadModule:async () => ({
      createReportSession:({transport}) => ({read:query => transport(query),refresh:query => transport(query),clear() {}})
    })});
    const refresh = controller.refresh;
    controller.refresh = surface => { rowRefreshes += 1; return refresh(surface); };
    return controller;
  };
  function render() { rendered = context.renderManagerEvalReports2Panel(); return rendered; }
  return {
    context, requests, render, html:() => rendered, rowRefreshes:() => rowRefreshes,
    capabilityCalls:() => capabilityCalls,
    failCapabilities:() => { failCapabilities = true; },
    succeed:() => { fail = false; }, fail:() => { fail = true; },
    account:value => { account = value; }, permission:value => { permission = value; },
    hold:() => { let release; gate = new Promise(resolve => { release = resolve; }); return release; },
    fetchCount:() => paged ? requests.length : requests.filter(key => key === 'master').length,
    async drain() {
      // Bound the queue so the regression fails with a count instead of hanging.
      for (let round = 0; round < 8; round += 1) {
        await new Promise(resolve => setImmediate(resolve));
        if (queuedRender) { queuedRender = false; render(); }
        for (const callback of timers.splice(0)) await callback();
      }
    },
    idle:() => !queuedRender && timers.length === 0
  };
}

for (const paged of [true, false]) {
  const mode = paged ? 'paged' : 'legacy';
  test(`Eval2 ${mode} LowStock All Users Block Alpha fetches once after an initial error`, async () => {
    const fixture = evalLoadFixture(paged);
    fixture.render(); fixture.render(); // Includes timers queued before a request starts.
    await fixture.drain();
    assert.equal(fixture.fetchCount(), 1);
    assert.match(fixture.html(), /database failure/);
    assert.match(fixture.html(), /loadManagerEvalReports2\(true\)/);
    assert.equal(fixture.idle(), true);
    for (let repeat = 0; repeat < 3; repeat += 1) {
      await fixture.context.loadManagerEvalReports2(false);
      fixture.render();
    }
    await fixture.drain();
    assert.equal(fixture.fetchCount(), 1, 'queued automatic calls must respect the failed state');
    if (paged) {
      assert.deepEqual(Array.from(fixture.requests[0].filters.reportIds), ['low-stock']);
      assert.deepEqual(Array.from(fixture.requests[0].filters.assignedUsers), []);
      assert.equal(fixture.requests[0].filters.groupBy, 'blockalpha');
    }
  });

  test(`Eval2 ${mode} Retry makes one attempt, recovers, and retains cached results on later failure`, async () => {
    const fixture = evalLoadFixture(paged);
    fixture.render(); await fixture.drain();
    await fixture.context.loadManagerEvalReports2(true); await fixture.drain();
    assert.equal(fixture.fetchCount(), 2);
    assert.equal(fixture.rowRefreshes(), 0, 'failed metadata must not trigger row refreshes');
    assert.match(fixture.html(), /database failure/);
    fixture.succeed();
    await fixture.context.loadManagerEvalReports2(true); await fixture.drain();
    assert.equal(fixture.fetchCount(), 3);
    assert.equal(fixture.context.managerEvalReport2LoadState.error, '');
    assert.match(fixture.html(), /Block Alpha cards/);
    assert.equal(fixture.rowRefreshes(), paged ? 1 : 0);
    const retained = fixture.context.managerEvalReport2Cache;
    fixture.fail();
    await fixture.context.loadManagerEvalReports2(true); await fixture.drain();
    assert.equal(fixture.fetchCount(), 4);
    assert.equal(fixture.context.managerEvalReport2Cache, retained);
    assert.match(fixture.html(), /last complete results remain visible/);
    assert.equal(fixture.rowRefreshes(), paged ? 1 : 0);
  });

  test(`Eval2 ${mode} concurrent retries share one pending fetch`, async () => {
    const fixture = evalLoadFixture(paged), release = fixture.hold();
    fixture.succeed();
    const first = fixture.context.loadManagerEvalReports2(true);
    const second = fixture.context.loadManagerEvalReports2(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.fetchCount(), 1);
    release(); await Promise.all([first, second]); await fixture.drain();
    assert.equal(fixture.fetchCount(), 1);
    assert.equal(fixture.rowRefreshes(), paged ? 1 : 0);
  });

  test(`Eval2 ${mode} account changes permit a fresh attempt after failure`, async () => {
    const fixture = evalLoadFixture(paged);
    fixture.render(); await fixture.drain();
    fixture.account('account-b'); fixture.render(); await fixture.drain();
    assert.equal(fixture.fetchCount(), 2);
    assert.match(fixture.html(), /database failure/);
    assert.equal(fixture.idle(), true);
  });
}

test('Eval2 paged permission changes clear the previous scoped failure', async () => {
  const fixture = evalLoadFixture(true);
  fixture.render(); await fixture.drain();
  fixture.permission('p2'); fixture.render(); await fixture.drain();
  assert.equal(fixture.fetchCount(), 2);
  assert.equal(fixture.idle(), true);
});

test('Eval2 paged capability failure makes one attempt and waits for explicit Retry', async () => {
  const fixture = evalLoadFixture(true);
  fixture.failCapabilities();
  await fixture.context.loadManagerEvalReports2(false); await fixture.drain();
  assert.equal(fixture.capabilityCalls(), 1);
  assert.equal(fixture.fetchCount(), 0);
  assert.match(fixture.html(), /capability failure/);
  assert.equal(fixture.idle(), true);
});
