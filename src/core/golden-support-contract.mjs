import assert from 'node:assert/strict';
import vm from 'node:vm';

export async function watchdogDatesContract(read) {
  const context = vm.createContext({Intl, Date});
  vm.runInContext(read('assets/runtime-watchdog-panel.js'), context);
  let brief = '';
  const row = {status:'open', username:'dan_mccuistion', normalized_role:'qc_supervisor', occurrence_count:2,
    first_seen_at:'2026-07-05T05:01:02Z', last_seen_at:'2026-11-04T17:40:12Z'};
  const controller = context.AgMetricRuntimeWatchdogPanel.createController({
    document:{getElementById:()=>null}, getUsername:()=> 'dylan_collyge', postJson:async()=>({data:[row]}),
    clipboard:{writeText:text=>{brief=text;}}, showToast() {},
  });
  await controller.copyFixBrief();
  assert.match(brief, /^11\/04\/2026 11:40:12 AM CST \| dan_mccuistion/m);
  assert.match(brief, /First seen 07\/05\/2026 12:01:02 AM CDT/);
}

export function progressStyleContract(read) {
  const css = read('assets/erp-sync-progress.css');
  assert.match(css, /width:min\(94vw,480px\);max-width:100%;margin:0 auto;box-sizing:border-box/);
  assert.match(css, /align-items:center;justify-content:center/);
  assert.match(read('index.html'), /assets\/erp-sync-progress\.css\?v=/);
}

export function weekdayContract(runFunctions, read) {
  const context=runFunctions('assets/app-runtime.js',['parseDockCardPlanStartEpochDay','getDockSuspendDcRequestPlanstartInfo'],{
    getDockSuspendDcRequestPlanstartValue:row=>row.PLANSTART,Date,Intl,
  });
  const css=read('assets/app-shell-style-05.css').toLowerCase();
  const dates=[['11/02/2026',1,'monday','#7c3aed'],['11/03/2026',2,'tuesday','#dc2626'],
    ['11/04/2026',3,'wednesday','#16a34a'],['10/29/2026',4,'thursday','#2563eb'],['10/30/2026',5,'friday','#64748b']];
  for (const [date,weekday,tone,color] of dates) {
    const result=context.getDockSuspendDcRequestPlanstartInfo({PLANSTART:date});
    assert.equal(result.weekday,weekday);assert.equal(result.tone,tone);
    assert.equal(result.color.toLowerCase(),color);
    assert.ok(css.includes('app-planstart-'+tone+'{--suspend-tag-accent:'+color));
  }
  assert.equal(context.getDockSuspendDcRequestPlanstartInfo({PLANSTART:'2026-11-03T00:00:00Z'}).tone,'tuesday');
}

export function weekdaySerialContract(runFunctions) {
  const c=runFunctions('assets/app-runtime.js',['parseDockCardPlanStartEpochDay','getWeekdayColorForPlanStart']);
  for(const [date,color] of [['2026-11-02','#7C3AED'],['11/03/2026','#DC2626'],['2026-11-04','#16A34A'],
    ['2026-11-05','#2563EB'],['11/06/2026','#64748B'],['46331.333333333328','#2563EB']]) {
    assert.equal(c.getWeekdayColorForPlanStart(date),color,date);
  }
  assert.equal(c.getWeekdayColorForPlanStart('2026-02-30'),'');
}

export function requestPublicationContract(runFunctions, functionSource) {
  const old={UNIQUE_ID:'REQ-old'};
  const c=runFunctions('assets/row-workflow-functions.js',['reconcileIncomingRequestRows'],{
    requestsInventory:[old],optimisticRequestIds:new Set(),optimisticCompletedRowIds:new Set(),
    getSupabaseReadIdentityScope:()=> 'owner',firstNonEmptyValue:(...v)=>v.find(x=>x!==undefined&&x!==null&&x!==''),
    isRequestPendingVisible:()=>true,getItemUniqueId:row=>row.UNIQUE_ID,getQueueCompletionState:()=>null,
  });
  vm.runInContext(functionSource('assets/app-runtime.js','hasConfirmedRequestCompletion'),c);
  const tagged=(rows,sequence)=>Object.assign(rows,{requestReadMeta:{owner:'owner',sequence,authoritative:true}});
  c.requestsInventory=c.reconcileIncomingRequestRows(tagged([{UNIQUE_ID:'REQ-live'}],2));
  assert.equal(c.reconcileIncomingRequestRows(tagged([],1))[0].UNIQUE_ID,'REQ-live');
  assert.equal(c.reconcileIncomingRequestRows(tagged([],3)).length,0);
  c.getQueueCompletionState=()=>({confirmedVersion:()=>1});
  c.getQueueCompletionKey=row=>row.UNIQUE_ID;c.getQueueCompletionVersion=()=>1;
  assert.equal(c.reconcileIncomingRequestRows(tagged([{UNIQUE_ID:'REQ-done'}],4)).length,0);
}

export function facetRetirementContract(runFunctions) {
  const bars=[{dataset:{inventoryExcelScope:'eval2'},hidden:false},{dataset:{inventoryExcelScope:'request'},hidden:true}],closed=[];
  const c=runFunctions('assets/row-workflow-functions.js',['syncInventoryExcelBars'],{
    document:{querySelectorAll:()=>bars},getInventoryExcelHost:scope=>scope==='request'?{}:null,
    getCurrentVisibleViewId:()=> 'request',closeInventoryExcelPopover:scope=>closed.push(scope),
  });
  c.syncInventoryExcelBars();assert.equal(bars[0].hidden,true);assert.equal(bars[1].hidden,false);assert.deepEqual(closed,['drive']);
}

export function requestCompletionContract(read,functionSource) {
  const migration = read('supabase/migrations/20261026183000_agdata_v2372_request_completion_acknowledgment.sql');
  const deliveryMigration = read('supabase/migrations/20261026184500_agdata_v2372_request_completion_delivery.sql');
  const requestSubmission = read('assets/request-submission.js');
  const runtime = read('assets/app-runtime.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  assert.match(migration, /from public\.ph_requests_pending where unique_id=p_request_id for update/);
  assert.match(migration, /delete from public\.ph_requests_pending where unique_id=request_id/);
  assert.match(migration, /request_completion_receipt_v2372/);
  assert.match(deliveryMigration, /reconcile_request_folder_completion_v2[^]*prepare_request_folder_completion_v2/);
  assert.match(deliveryMigration, /from public\.ph_requests_completed_history history/g);
  assert.doesNotMatch(runtime, /Save Needs Retry/);
  assert.match(requestSubmission, /REQUEST_NOT_FOUND[^]*options\.readCanonical/);
  const owner=functionSource('assets/app-runtime.js','applyConfirmedRequestCompletionReceipt');
  assert.match(owner,/REQUEST_COMPLETION_RECEIPT_UNCONFIRMED/);assert.match(owner,/getItemUniqueId\(row\) !== id/);
  assert.match(appApi, /REQUEST_NOT_FOUND[^]*request_completion_receipt_v2372/);
  assert.match(read('.codex/skills/agdata-request-lifecycle-and-lock-guard/SKILL.md'), /Never re-read or delete a just-completed Request through `ph_active_request`/);
}

export function managerSyncContract(read) {
  const runtime=read('assets/app-runtime.js'),bunch=read('assets/bunch-note.js'),registry=read('assets/live-sync-registry.js');
  assert.match(runtime,/plainManagersHubEntry[^]*activeHomeTab = 'dashboard'/);
  assert.match(runtime,/QUOTA_SAFE_VISIBLE_POLL_STANDALONE_MS = 240000/);
  assert.match(runtime,/QUOTA_SAFE_VISIBLE_POLL_BROWSER_MS = 360000/);
  assert.match(runtime,/LIVE_SYNC_POLL_STANDALONE_MS[^]*: 60000/);
  assert.match(runtime,/LIVE_SYNC_POLL_BROWSER_MS[^]*: 90000/);
  assert.match(runtime,/gnc_dylan_last_toasted_files_v2[^]*username !== 'dylan_collyge'/);
  assert.match(registry,/homeSyncMetadata:\s*\[[^\]]*hl_po_parsed/);
  assert.match(bunch,/normalizeBunchNoteLocationKey[^]*gnc_bunch_note_drafts_v1[^]*Saved Drafts \/ Active Bunch Notes/);
  assert.match(bunch,/function reset\(\) \{ persistLocalDraft\(\)/);
}
