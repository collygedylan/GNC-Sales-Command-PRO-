import assert from 'node:assert/strict';
import { validateErpSyncCommand, ERP_SYNC_STAGES } from '../../supabase/functions/_shared/erp-sync.mjs';
import { SECONDARY_ERP_STAGES } from '../../supabase/functions/_shared/erp-secondary-sync.mjs';
import { startBrowserErpSyncCommand } from '../../supabase/functions/_shared/erp-browser-start.ts';

const runId='00000000-0000-4000-8000-000000000091';
function createRpcState(done) {
  const state={calls:[],claims:0,steps:0,releases:0,wakes:0,active:false};
  state.rpc=async (name,args)=>{
    state.calls.push(name);
    if(name==='get_erp_sync_status_v1')return {data:{active:state.active,runId,status:state.active?'running':'complete',currentStage:state.active?'drive':'idle'}};
    if(name==='claim_erp_sync_job_v2') {
      state.claims++;
      return {data:{claimed:state.claims===1,runId,status:{active:state.claims>1,runId,currentStage:'drive'}}};
    }
    if(name==='update_erp_sync_job_v1'){state.initial=args.p_status;state.active=true;return {data:args.p_status};}
    if(name==='claim_erp_sync_request_step_v1'){assert.equal(args.p_run_id,runId);assert.equal(args.p_actor,'dylan_collyge');return {data:{claimed:true,workerId:runId,continuationStep:state.steps+1,status:{active:true,runId,currentStage:'drive'}}};}
    if(name==='release_erp_sync_request_step_v1'){assert.equal(args.p_run_id,runId);assert.equal(args.p_worker_id,runId);state.releases++;return {data:true};}
    throw new Error('Unexpected RPC '+name);
  };
  state.process=async()=>{
    state.steps++;state.active=!done;
    return {result:{done},status:{active:state.active,runId,status:done?'complete':'running',currentStage:done?'idle':'drive'}};
  };
  return state;
}
function createApi(runFunctions, state) {
  return runFunctions('supabase/functions/app-api/index.ts',['handleErpSyncAction','releaseCloudErpSyncStep','withCloudErpSyncLeaseHeartbeat'],{
    dispatchCloudErpSync:status=>{assert.equal(status.runId,runId);state.wakes++;},setInterval:()=>1,clearInterval(){},
    validateErpSyncCommand,startBrowserErpSyncCommand,ERP_SYNC_STAGES,SECONDARY_ERP_STAGES,FULL_ACCESS_USER_KEYS:new Set(['dylan_collyge']),
    normalizeUsername:value=>String(value).toLowerCase(),jsonObject:value=>value,jsonResponse:value=>value,
    errorResponse:(...args)=>({ok:false,status:args[1],...args[2]}),
    databaseFailureResponse:(...args)=>({ok:false,code:args[2]}),recordHandledError:(...args)=>{throw args[2];},
    processCloudErpSyncStep:state.process,supabase:{rpc:state.rpc},
  });
}
function startCommand() {
  return {action:'erp_sync',operation:'start',commandId:runId,force:true,forceRestart:true,maxAttemptsPerStage:1};
}
export async function erpApiAuthorizationContract(runFunctions) {
  const state=createRpcState(true),api=createApi(runFunctions,state),session={mustChangePassword:false};
  assert.equal((await api.handleErpSyncAction(session,{action:'erp_sync',operation:'status'},{username:'field'})).data.active,false);
  assert.equal((await api.handleErpSyncAction(session,startCommand(),{username:'field'})).code,'ERP_SYNC_FORBIDDEN');
  assert.equal((await api.handleErpSyncAction(session,{action:'erp_sync',operation:'status',force:true},{username:'dylan_collyge'})).code,'ERP_SYNC_REQUEST_INVALID');
  const result=await api.handleErpSyncAction(session,startCommand(),{username:'dylan_collyge'});
  assert.equal(result.status,'queued');assert.equal(result.data.runId,runId);
  assert.equal(state.steps,0);assert.equal(state.wakes,1);
  const continuation=await api.handleErpSyncAction(session,{action:'erp_sync',operation:'continue',runId},{username:'dylan_collyge'});
  assert.equal(continuation.status,'complete');
  assert.equal(state.steps,1);assert.equal(state.releases,1);
  assert.equal((await api.handleErpSyncAction(session,{action:'erp_sync',operation:'continue',runId},{username:'field'})).code,'ERP_SYNC_FORBIDDEN');
  assert.ok(state.calls.includes('claim_erp_sync_job_v2'));assert.ok(state.calls.includes('claim_erp_sync_request_step_v1'));
  assert.ok(!state.calls.includes('claim_erp_sync_job_v1'));
}
export async function erpApiContinuationContract(runFunctions) {
  const state=createRpcState(false),api=createApi(runFunctions,state),session={mustChangePassword:false},actor={username:'dylan_collyge'};
  const started=await api.handleErpSyncAction(session,startCommand(),actor);
  assert.equal(started.status,'queued');assert.equal(started.data.runId,runId);
  assert.deepEqual(Array.from(state.initial.stageOrder),['drive','cav','reserves','soc','hl_po_parsed']);
  assert.equal(state.steps,0,'start queues the cloud relay');assert.equal(state.wakes,1);
  const duplicate=await api.handleErpSyncAction(session,startCommand(),actor);
  assert.equal(duplicate.data.runId,runId);assert.equal(duplicate.status,'CONTINUE');assert.equal(state.steps,0);
  const next=await api.handleErpSyncAction(session,{action:'erp_sync',operation:'continue',runId},actor);
  assert.equal(next.status,'CONTINUE');assert.equal(state.steps,1);assert.equal(state.releases,1);
  assert.equal(state.calls.filter(name=>name==='claim_erp_sync_job_v2').length,2);
  assert.equal(state.calls.filter(name=>name==='claim_erp_sync_request_step_v1').length,1);
  assert.ok(!state.calls.some(name=>name.includes('worker')));
}

export async function emptyCloudCompletionContract(runFunctions) {
  const state=createRpcState(true);
  state.rpc=async(name,args)=>{
    state.calls.push(name);
    if(name==='claim_erp_sync_request_step_v1')return {data:{claimed:true,workerId:runId,continuationStep:1,
      status:{active:true,currentStage:'hl_po_parsed',continuationCursor:{stageIndex:5,stageResults:[]}}}};
    if(name==='release_erp_sync_request_step_v1'){
      assert.equal(args.p_run_id,runId);assert.equal(args.p_worker_id,runId);assert.equal(args.p_step,1);
      return {data:true};
    }
    if(name==='get_erp_sync_status_v1')return {data:{active:false,runId,status:'complete'}};
    throw new Error('Unexpected RPC '+name);
  };
  state.process=async(...args)=>{
    assert.equal(args[3].continuationCursor.stageIndex,5);
    return {result:{done:true},status:{active:false,status:'complete',currentStage:'idle',stageIndex:5,stageResults:[]}};
  };
  const api=createApi(runFunctions,state);
  const response=await api.handleErpSyncAction({mustChangePassword:false},{action:'erp_sync',operation:'continue',runId},{username:'dylan_collyge'});
  assert.equal(response.status,'complete');assert.equal(response.data.active,false);assert.equal(response.data.currentStage,'idle');
  assert.equal(response.fileId,null);assert.equal(response.nextOffset,null);
  assert.deepEqual(state.calls,['claim_erp_sync_request_step_v1','release_erp_sync_request_step_v1','get_erp_sync_status_v1']);
}
