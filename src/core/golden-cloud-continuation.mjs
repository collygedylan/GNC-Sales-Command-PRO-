import assert from 'node:assert/strict';
import vm from 'node:vm';

export async function cloudContinuationContract(runFunctions) {
    const events = [];
    let finish;
    let started;
    const processing = new Promise(resolve => { started = resolve; });
    const context = runFunctions('supabase/functions/app-api/index.ts', ['claimAndDispatchCloudStep'], {
      jsonObject: value => value,
      supabase: { rpc: async name => ({ data: name === 'get_erp_sync_status_v1'
        ? { active: true, runId: 'run', requestedBy: 'authorized' }
        : { claimed: true, workerId: 'owner', continuationStep: 1 } }) },
      dispatchCloudErpSync: value => { assert.equal(value.runId, 'run'); events.push('successor'); },
      executeCloudErpSyncStep: async () => {
        events.push('processing');
        started();
        await new Promise(resolve => { finish = resolve; });
      },
    });
    const work = context.claimAndDispatchCloudStep('run');
    await processing;
    assert.deepEqual(events, ['processing'], 'a successor cannot race the active lease');
    finish();
    assert.equal(await work, true);
    assert.deepEqual(events, ['processing', 'successor']);
}

export async function socIngestionContract() {
    const { normalizeErpRows } = await import('../../supabase/functions/_shared/erp-sync.mjs');
    const rows = await normalizeErpRows([
      { itemcode:'001', warehouseid:'10', dock:'1', suspend:'SUSPEND', suspendto:'Other', ordernum:'1', linenum:'1' },
      { itemcode:'002', warehouseid:'10', docknumber:'38', ordernum:'1', linenum:'2' },
      { itemcode:'003', warehouseid:'10', dock:'0', ordernum:'1', linenum:'3' },
      { itemcode:'004', warehouseid:'10', tripnumber:'38', suspend:'SUSPEND', ordernum:'1', linenum:'4' },
      { itemcode:'005', warehouseid:'9', dock:'1', ordernum:'1', linenum:'5' },
    ], 'soc', ['unique_id','itemcode','dock','suspend','suspendto','ordernum','linenum']);
    assert.deepEqual(rows.map(row => row.itemcode), ['001', '002']);
}

export async function socYearContract(runFunctions, read) {
  const file='supabase/functions/_shared/erp-sync.mjs';
  const ctx=runFunctions(file,['normalizeErpHeader','clean','first','validSocDock','firstSocDock','hasImportableSocDock','isImportableSocRow'],{exports:{}},true);
  const rows=[
    {itemcode:'A',warehouseid:'10',dock:'Dock 41',planstart:'46330.3333333333',tripnumber:'T1'},
    {itemcode:'B',warehouseid:'10',dock:'Dock 41',planstart:'44635.4'},
    {itemcode:'C',warehouseid:'10',dock:'',tripnumber:'T38265',planstart:'46330.3',suspend:'SUSPEND'},
  ];
  assert.deepEqual(rows.map(row=>ctx.isImportableSocRow(row,2026)),[true,false,false]);
  const worker=await import('../../supabase/functions/_shared/erp-sync.mjs');
  const normalized=await worker.normalizeErpRows(rows,'soc',['unique_id','itemcode','dock','planstart','tripnumber']);
  assert.deepEqual(normalized.map(row=>row.itemcode),['A','B']);
  assert.match(read(file),/eligible=pageXml\.filter[\s\S]*?isImportableSocRow\([\s\S]*?,2026\)/);
}



export async function busyLeaseContract(runFunctions) {
  let claims=0,executions=0,successors=0;
  const context=runFunctions('supabase/functions/app-api/index.ts',['claimAndDispatchCloudStep'],{
    jsonObject:value=>value,dispatchCloudErpSync:()=>{successors++;},executeCloudErpSyncStep:async()=>{executions++;},
    supabase:{rpc:async name=>({data:name==='get_erp_sync_status_v1'?{active:true,runId:'run',requestedBy:'authorized'}:
      {active:true,claimed:++claims>1,workerId:'owner',continuationStep:1}})},
  });
  assert.equal(await context.claimAndDispatchCloudStep('run'),false);
  assert.equal(claims,1);assert.equal(executions,0,'a busy lease cannot start a duplicate step');
  assert.equal(await context.claimAndDispatchCloudStep('run'),true);
  assert.equal(claims,2);assert.equal(executions,1);assert.equal(successors,1);
}

export async function privateRecoveryContract(runFunctions, read) {
  let claims=0;
  const runId='00000000-0000-4000-8000-000000000231';
  const ctx=runFunctions('supabase/functions/app-api/index.ts',['handleErpSyncContinuation'],{
    ERP_SYNC_CLOUD_WORKER_KEY:'internal-secret',SUPABASE_SERVICE_ROLE_KEY:'server-secret',
    claimAndDispatchCloudStep:async()=>{claims++;return true;},jsonResponse:body=>body,jsonObject:value=>value,
    supabase:{rpc:async()=>({data:{runId,active:true}})},errorResponse:(...args)=>({status:args[1]}),recordHandledError(){},
  });
  const payload={operation:'continue',runId,relayHop:1};
  assert.equal((await ctx.handleErpSyncContinuation(payload,new Request('https://example.test',{headers:{authorization:'Bearer browser-token'}}))).status,401);
  assert.equal(claims,0);
  assert.equal((await ctx.handleErpSyncContinuation(payload,new Request('https://example.test',{headers:{authorization:'Bearer server-secret'}}))).claimed,true);
  assert.equal(claims,1);
  let relays=0;const bounded=runFunctions('supabase/functions/app-api/index.ts',['dispatchCloudErpSync'],{fetch:async()=>{relays++;}});
  bounded.dispatchCloudErpSync({runId},40);assert.equal(relays,0);
  const api=read('supabase/functions/app-api/index.ts');
  const begin=api.indexOf('  if (!contentType.includes("multipart/form-data") && (action === "erp_sync_continue"');
  const end=api.indexOf('\n  if (!contentType.includes("multipart/form-data") && action === "erp_sync_worker")',begin);
  assert.ok(begin>0&&end>begin);
  const gate=api.slice(begin,end);
  const route=authorization=>vm.runInNewContext('(async()=>{'+gate+';return "native";})()',{
    contentType:'application/json',action:'erp_sync',payload:{action:'erp_sync',operation:'continue'},
    req:new Request('https://example.test',{headers:{authorization}}),SUPABASE_SERVICE_ROLE_KEY:'server-secret',handleErpSyncContinuation:async()=> 'internal',
  });
  assert.equal(await route('Bearer server-secret'),'internal');assert.equal(await route('Bearer browser-token'),'native');
  const sql=read('supabase/migrations/20261030193000_agdata_v23116_erp_recovery_wake.sql');
  assert.match(sql,/private\.wake_erp_sync_job_v23116/);assert.match(sql,/request_lease_until/);assert.match(sql,/interval '10 seconds'/);
  assert.match(sql,/revoke all[\s\S]*from public, anon, authenticated/i);assert.match(sql,/cron\.schedule[\s\S]*\* \* \* \* \*/);
}
