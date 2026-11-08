import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function reportQueryGlobals() {
  return {
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
    getManagerEvalReport2Meta:() => ({label:'LowStock'}), getManagerEvalReport2LatestSourceUpdate:() => '',
    renderManagerEvalReport2MoreMenu:() => '', renderManagerEvalReport2ReportsPanel:() => '<div>Block Alpha cards</div>',
    fullInventory:[], warehouseAssignedItemsInventory:[], managerReportVisibleRows:new Map(), managerReportScopedRows:new Map(),
    managerPagedLocationScroll:new Map(), managerReportGridFilters:new Map(),
    managerEvalReport2SelectedItemsByKey:new Map(), managerEvalReport2EditsByRowKey:new Map(),
    managerEvalAssignmentSelection:new Map(),
  };
}

async function requestReport(state, _url, body) {
  if (body.operation === 'capabilities') {
    state.capabilityCalls += 1;
    return state.failCapabilities ? {ok:false,error:'capability failure',status:503} : {ok:true,data:{surfaces:['eval2']}};
  }
  state.requests.push(body.query);
  if (state.gate) await state.gate;
  return state.fail ? {ok:false,error:'database failure',status:503}
    : {ok:true,data:{rows:[],total:0,hasMore:false,sourceRevision:'r1',metadata:{counts:{'low-stock':1}}}};
}

function reportGlobals(state) {
  return { ...reportQueryGlobals(), AbortController,
    managerReportPageController:null, managerEvalReport2ProgressiveRowsState:null,
    managerEvalReport2LoadState:{loading:false,error:'',owner:'',promise:null},
    managerEvalReport2Cache:null, managerEvalReport2CacheKey:'',
    getSupabaseReadIdentityScope:() => state.account,
    appAccessSnapshotState:{get snapshot() { return {dataPermissionVersion:state.permission}; }},
    nativeAuthProfile:{id:'account-a',active:true},
    canViewManagerEvalReports2:() => true, useManagerReportPages:() => true,
    getManagerEvalReports2Api:() => ({}), getManagerEvalReport2BrowsePage:() => null,
    getCurrentVisibleViewId:() => 'managers', isViewVisible:() => true,
    activeHomeTab:'eval2', MANAGER_EVAL_REPORTS_2_VIEW:'eval2',
    APP_API_FUNCTION_URL:'mock-only', APP_VERSION:'test', SUPABASE_READ_TIMEOUT_MS:1000,
    postAppFunctionJson:requestReport.bind(null,state),
    signalProductionLiveSync() {}, syncManagerEvalReport2SelectionUi() {},
    scheduleManagersRender:() => { state.queuedRender = true; },
    setTimeout:callback => { state.timers.push(callback); return state.timers.length; },
    escapeHtml:value => String(value), getFriendlyBackendErrorMessage:error => error.message,
    reportSemanticHealthEvent() {}, showToast() {},
  };
}

function reportMount(config) {
  let current = config;
  return {
    update(next) { current = next; }, destroy() {},
    async refresh() {
      try {
        const page = await current.session.refresh(current.query);
        current.onState({page,rows:page.rows,initialLoading:false,refreshing:false});
      } catch (error) { current.onState({error,initialLoading:false,refreshing:false}); }
    },
  };
}

function reportSession({ transport }) {
  return { read:transport, refresh:transport, clear() {} };
}

async function loadReportModule() {
  return { createReportSession:reportSession, mountReportRows:(_host,config) => reportMount(config) };
}

function installReportController(context, state) {
  vm.runInContext(readFileSync(new URL('../../assets/report-pages-live.js', import.meta.url), 'utf8'), context);
  const create = context.GncReportPagesLive.createController;
  context.window.GncReportPagesLive = context.GncReportPagesLive;
  context.GncReportPagesLive.createController = options => {
    const controller = create({...options, loadModule:loadReportModule});
    const refresh = controller.refresh;
    controller.refresh = surface => { state.rowRefreshes += 1; return refresh(surface); };
    return controller;
  };
}

async function drainReportFixture(state, render) {
  for (let round = 0; round < 8; round += 1) {
    await new Promise(resolve => setImmediate(resolve));
    if (state.queuedRender) { state.queuedRender = false; render(); }
    for (const callback of state.timers.splice(0)) await callback();
  }
}

function reportFixtureApi(context, state) {
  const render = () => { state.rendered = context.renderManagerEvalReports2LegacyPanel(); return state.rendered; };
  return {
    context, requests:state.requests, render,
    open:() => { void context.loadManagerEvalReports2(false); return render(); },
    html:() => state.rendered, rowRefreshes:() => state.rowRefreshes, capabilityCalls:() => state.capabilityCalls,
    failCapabilities:() => { state.failCapabilities = true; },
    succeed:() => { state.fail = false; }, fail:() => { state.fail = true; },
    account:value => { state.account = value; }, permission:value => { state.permission = value; },
    hold:() => { let release; state.gate = new Promise(resolve => { release = resolve; }); return release; },
    fetchCount:() => state.requests.length,
    async mount() {
      const controller = context.getManagerReportPageController();
      await controller.mount({isConnected:true}, context.buildManagerReportPageQuery('eval2'), {});
    },
    drain:() => drainReportFixture(state,render),
    idle:() => !state.queuedRender && state.timers.length === 0,
  };
}

export function createManagerReportLoadFixture(run) {
  const state = {account:'account-a',permission:'p1',fail:true,gate:null,queuedRender:false,rendered:'',
    rowRefreshes:0,capabilityCalls:0,failCapabilities:false,timers:[],requests:[]};
  const context = run(['getManagerReportPageController','buildManagerReportPageQuery',
    'loadManagerEvalReports2','renderManagerEvalReports2LegacyPanel','resetManagerEvalReport2ProgressiveRowsState','createPagedManagerEvalIndex'], reportGlobals(state));
  context.getManagerEvalReport2Index = () => {
    if (!context.getManagerReportPageController().state('eval2').page) return null;
    return context.managerEvalReport2Cache;
  };
  vm.runInContext(readFileSync(new URL('../../assets/eval-reports-engine.js',import.meta.url),'utf8'),context);
  context.getManagerEvalReports2Api = () => context.window.GncEvalReports || context.GncEvalReports;
  context.getManagerEvalReportsApi = context.getManagerEvalReports2Api;
  installReportController(context,state);
  return reportFixtureApi(context,state);
}
