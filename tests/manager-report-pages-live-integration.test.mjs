// @test-group: eval
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
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
    getManagerReportPageController:() => ({ initialize:async () => { calls.push('initialize'); paged = false; }, enabled:() => false }),
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
  assert.deepEqual(calls.slice(0, 4), ['initialize','master','warehouseAssignedItems','settings']);
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
  assert.deepEqual(calls, ['initialize','load:eval2:metadata:false']);
  assert.equal(result.counts['low-stock'], 4);
});
