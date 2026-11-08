import assert from 'node:assert/strict';

export async function monotonicProgressContract(runFunctions,plain) {
  const old={key:'drive',sourceFileName:'old.xlsx',outcome:'processed',rowCount:9000};const writes=[];
  const context=runFunctions('supabase/functions/app-api/index.ts',['processCloudErpSyncStep'],{
    isOperationalErpSyncComplete:(await import('../../supabase/functions/_shared/erp-sync.mjs')).isOperationalErpSyncComplete,
    jsonObject:value=>value||{},mintCloudDriveAccessToken:async()=> 'token',prefetchSecondaryFolders:async()=>({}),SECONDARY_ERP_STAGES:[],fetch:async()=>{throw Error('unexpected network read');},Deno:{env:{get:()=>''}},
    supabase:{rpc:async(name,args)=>{if(name==='update_erp_sync_job_v1')writes.push(plain(args.p_status));return {data:{}};}},
    runErpSyncWorkerStep:async({status})=>{
      await status({sourceProgressDelta:{key:'drive',fileName:'new.xlsx',stage:'parsing',percent:40}});
      await status({stageResults:[old]});
      await status({sourceProgressDelta:{key:'drive',fileName:'third.xlsx',stage:'parsing',percent:40}});
      return {done:false,cursor:{}};
    }
  });
  await context.processCloudErpSyncStep('run','owner',1,{active:true,continuationCursor:{stageIndex:0,secondaryFolders:{}},stageResults:[old],sourceProgress:{drive:{fileName:'new.xlsx',stage:'staging',percent:70,rowsStaged:1500,rowsPublished:0}}});
  assert.equal(writes[1].sourceProgress.drive.percent,70,JSON.stringify(writes.map(w=>w.sourceProgress?.drive)));assert.equal(writes[2].sourceProgress.drive.fileName,'new.xlsx');assert.equal(writes[2].sourceProgress.drive.percent,70);
  assert.equal(writes[3].sourceProgress.drive.fileName,'third.xlsx');assert.equal(writes[3].sourceProgress.drive.percent,40);assert.equal(writes[3].sourceProgress.drive.rowsPublished,0);
}

export async function slowMetadataContract(runFunctions) {
  const {compareErpFiles}=await import('../../supabase/functions/_shared/erp-sync.mjs');
  for(const resumed of [false,true]){
    let clock=0,chunks=0;
    const file={id:'cav-232',name:'CAV.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
    const ctx=runFunctions('supabase/functions/_shared/erp-sync.mjs',['runErpSyncWorkerStep'],{
      exports:{},compareErpFiles,performance:{now:()=>clock},STAGES:[{key:'cav',dataset:'cav'}],ERP_SLICE_BUDGET_MS:700,
      prefetchErpFolders:async()=>({cav:{files:[file],listDurationMs:800}}),resolveErpRowsPerSlice:()=>1500,
      shouldIgnoreErpFile:()=>false,stageFileContinuation:async options=>{chunks++;assert.ok(options.maxRowsPerSlice<=1500);return {done:false,state:{nextOffset:(options.state?.nextOffset||0)+1500}};}
    },true);
    const cursor=resumed?{stageIndex:0,fileContinuation:{stageIndex:0,file,state:{nextOffset:1500}}}:{stageIndex:0};
    const result=await ctx.runErpSyncWorkerStep({supabase:{},env:()=>JSON.stringify({cav:'cav-folder'}),fetcher:async()=>{throw Error('Unexpected fetch');},status:async()=>{clock+=800;},cursor,accessToken:'fixture-token',maxRowsPerSlice:1500});
    assert.equal(chunks,1,'one bounded chunk must run even after slow network status calls: '+JSON.stringify({resumed,result}));
    assert.equal(result.cursor.fileContinuation.state.nextOffset,resumed?3000:1500);
  }
}

export async function completedCheckpointContract(runFunctions,plain) {
 const {isOperationalErpSyncComplete}=await import('../../supabase/functions/_shared/erp-sync.mjs');const writes=[];
 const context=runFunctions('supabase/functions/app-api/index.ts',['processCloudErpSyncStep'],{isOperationalErpSyncComplete,jsonObject:value=>value||{},mintCloudDriveAccessToken:async()=> 'token',prefetchSecondaryFolders:async()=>({}),SECONDARY_ERP_STAGES:[],fetch:async()=>{throw Error('unexpected network read');},Deno:{env:{get:()=>''}},supabase:{rpc:async(name,args)=>{if(name==='update_erp_sync_job_v1'){writes.push(plain(args.p_status));return {data:args.p_status};}return {data:{}};}},runErpSyncWorkerStep:async({status})=>{await status({sourceProgressDelta:{key:'drive',stage:'complete',checked:true,percent:100}});await status({stageResults:[{key:'drive',sourceFileName:'exact.xlsx',outcome:'processed',rowCount:9498}]});return {done:false,cursor:{stageIndex:1}};}});
 await context.processCloudErpSyncStep('run','owner',1,{runId:'run',active:true,status:'running',sourceProgress:{drive:{fileName:'exact.xlsx',stage:'published',percent:100,rowsPublished:9498}},stageResults:[]});
 assert.equal(writes.at(-1).sourceProgress.drive.stage,'complete');assert.equal(writes.at(-1).sourceProgress.drive.checked,true);
 assert.equal(isOperationalErpSyncComplete(writes.at(-1)),false);
}



export async function productionScheduleContract() {
  const {isOperationalErpSyncComplete}=await import('../../supabase/functions/_shared/erp-sync.mjs');
  const sourceProgress=Object.fromEntries(['drive','cav','reserves','soc','hl_po_parsed'].map(key=>[key,{stage:'complete',percent:100,checked:true}]));
  sourceProgress.prod_schedule={stage:'queued',percent:0,checked:false};
  assert.equal(isOperationalErpSyncComplete({sourceProgress}),true,'maintenance does not block operational completion');
  sourceProgress.soc.checked=false;
  assert.equal(isOperationalErpSyncComplete({sourceProgress}),false,'each operational source still needs a receipt');
  sourceProgress.soc.checked=true;sourceProgress.prod_schedule={stage:'complete',percent:100,checked:true};
  assert.equal(isOperationalErpSyncComplete({sourceProgress}),true);
}
