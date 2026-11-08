import assert from 'node:assert/strict';
import vm from 'node:vm';
import { transform } from 'esbuild';

function cloudRpc(state, name) {
  if (name === 'get_erp_sync_status_v1') return {data:{runId:'run',active:state.active,requestedBy:'authorized_actor'}};
  if (name === 'claim_erp_sync_request_step_v1') {
    if (state.leased || !state.active) {state.events.push('duplicate-denied');return {data:{claimed:false}};}
    state.leased=true;state.step++;state.events.push('claim');
    return {data:{claimed:true,workerId:'owner',continuationStep:state.step}};
  }
  if (name === 'release_erp_sync_request_step_v1') {
    if (state.releaseErrors-- > 0) {
      if (state.releaseErrors === 0 && state.releaseFailures >= 2) state.pendingLeaseRecovery=true;
      return {error:{message:'temporary connection error'}};
    }
    state.leased=false;state.events.push('release');return {data:true};
  }
  throw Error(name);
}
function cloudFetch(state, context, options) {
  state.cloudCalls++;
  assert.equal(options.headers.authorization,'Bearer fixture-private-key');
  const request=JSON.parse(options.body);
  assert.deepEqual(request,{action:'erp_sync',operation:'continue',runId:'run',relayHop:request.relayHop});
  assert.ok(Number.isSafeInteger(request.relayHop) && request.relayHop>=1 && request.relayHop<=40);
  assert.equal(options.headers['x-agdata-internal-relay'],'1');
  return context.claimAndDispatchCloudStep('run',request.relayHop).then(claimed=>({ok:true,json:async()=>({claimed,active:state.active})}));
}
function createCloudContext(state) {
  let context;
  context=vm.createContext({
    ERP_SYNC_CLOUD_WORKER_KEY:'fixture-private-key',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',SUPABASE_URL:'https://fixture.invalid',
    EdgeRuntime:{waitUntil:task=>state.pending.push(task)},AbortSignal,jsonObject:value=>value,
    recordHandledError:(...args)=>{if(args[1]!=='ERP_SYNC_LEASE_RELEASE_FAILED')throw new Error(JSON.stringify(args));},
    setTimeout:callback=>{state.waits++;if(state.pendingLeaseRecovery){state.leased=false;state.pendingLeaseRecovery=false;}setImmediate(callback);},
    setInterval:()=>({inert:true}),clearInterval(){},supabase:{rpc:async name=>cloudRpc(state,name)},
    processCloudErpSyncStep:async()=>{
      await Promise.resolve();assert.equal(state.leased,true);state.processed++;state.events.push('process');
      state.active=state.processed<5;return {result:{done:!state.active}};
    },
    fetch:async(...args)=>cloudFetch(state,context,args[1]),
  });
  return context;
}
export async function verifyCloudErpChaining(source, {releaseFailures=0}={}) {
  const pick=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  const code=[pick('function dispatchCloudErpSync(','async function handleErpSyncContinuation('),
    pick('async function releaseCloudErpSyncStep(','async function mintCloudDriveAccessToken('),
    pick('async function withCloudErpSyncLeaseHeartbeat<','async function processCloudErpSyncStep(')].join('\n');
  const state={pending:[],events:[],active:true,leased:false,step:0,processed:0,cloudCalls:0,waits:0,
    pendingLeaseRecovery:false,releaseErrors:releaseFailures,releaseFailures};
  const context=createCloudContext(state);
  const exposed=code+'\nglobalThis.claimAndDispatchCloudStep = claimAndDispatchCloudStep; globalThis.dispatchCloudErpSync = dispatchCloudErpSync;';
  vm.runInContext((await transform(exposed,{loader:'ts',format:'iife'})).code,context);
  const first=context.claimAndDispatchCloudStep('run'),overlap=context.claimAndDispatchCloudStep('run');
  assert.deepEqual(await Promise.all([first,overlap]),[true,false]);
  for(let index=0;index<state.pending.length;index++)await state.pending[index];
  assert.equal(state.processed,5,'all stages finish with no browser continuation');
  assert.ok(state.cloudCalls>=4,'the four remaining chunks receive cloud continuations');
  assert.equal(state.leased,false);
  assert.equal(state.events.filter(value=>value==='release').length,releaseFailures>=2?4:5);
  assert.ok(state.events.includes('duplicate-denied'));
  return {processed:state.processed,cloudCalls:state.cloudCalls,waits:state.waits};
}
