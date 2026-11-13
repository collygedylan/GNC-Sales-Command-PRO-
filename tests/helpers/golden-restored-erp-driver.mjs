import assert from 'node:assert/strict';

export async function foregroundDriverContract(runFunctions) {
  let calls=0, release;
  const pending = new Promise(resolve=>{release=resolve;});
  const context=runFunctions('assets/app-runtime.js',['driveManualErpSyncFromStatus'],{
    window:{},document:{hidden:false},navigator:{onLine:true},canRunManualInventoryImport:()=>true,
    getSupabaseReadIdentityScope:()=> 'actor',continueManualErpSync:async()=>{calls++;await pending;},
    scheduleManualSyncStatusPoll() {},
  });
  const status={active:true,runId:'run',currentStage:'soc',workerActive:true,leaseExpired:false};
  assert.equal(context.driveManualErpSyncFromStatus(status),true);
  assert.equal(context.driveManualErpSyncFromStatus(status),false);
  await Promise.resolve();
  assert.equal(calls,1);
  release();
  await context.window.erpSyncContinuationDriver.promise;
  assert.equal(context.window.erpSyncContinuationDriver,null);
  context.document.hidden=true;
  assert.equal(context.driveManualErpSyncFromStatus(status),false);
  let executions=0;
  const server=runFunctions('supabase/functions/app-api/index.ts',['claimAndDispatchCloudStep'],{
    jsonObject:value=>value,
    supabase:{rpc:async name=>({data:name==='get_erp_sync_status_v1'
      ? {active:true,runId:'run',requestedBy:'actor'} : {claimed:false}})},
    executeCloudErpSyncStep:()=>{executions++;},
  });
  assert.equal(await server.claimAndDispatchCloudStep('run'),false);
  assert.equal(executions,0,'an already leased run cannot execute twice');
}

export function continuationDelayContract(runFunctions) {
  const c=runFunctions('assets/app-runtime.js',['getManualErpContinuationDelay']);
  const sealed={sourceProgress:{soc:{stage:'publishing',rowsTotal:689,rowsParsed:689,rowsStaged:689}}};
  const unsealed={sourceProgress:{soc:{stage:'staging',rowsParsed:334,rowsStaged:334}}};
  assert.equal(c.getManualErpContinuationDelay(sealed,0),250);
  assert.equal(c.getManualErpContinuationDelay(unsealed,0),250);
  assert.equal(c.getManualErpContinuationDelay(sealed,2400),2400);
  assert.equal(c.getManualErpContinuationDelay(sealed,8000),5000);
  const publicationRetry = { ...sealed, retryNotBefore: Date.now() + 90000 };
  assert.equal(c.getManualErpContinuationDelay(publicationRetry,1000),60000);
  assert.equal(c.getManualErpContinuationDelay({...sealed,retryNotBefore:1},0),250);
}

export async function largeSocChunkContract() {
  const {maxErpImportRows,normalizeErpRowsChunk,resolveErpRowsPerSlice}=await import('../../supabase/functions/_shared/erp-sync.mjs');
  assert.equal(maxErpImportRows('soc'),100000);assert.equal(maxErpImportRows('drive_around'),50000);
  assert.equal(resolveErpRowsPerSlice('soc',100000),1500);
  const rows=await normalizeErpRowsChunk([{itemcode:'000909.020.1',warehouseid:'10',dock:'10',quantityordered:5,unique_id:'proof'}],
    'soc',['unique_id','itemcode','dock','quantityordered'],{start:0,limit:1,priorRowCount:51999,identityCounts:{}});
  assert.equal(rows.rowCount,52000);
}

export async function foregroundRestartContract(runFunctions) {
  const state={manualSyncStartPending:true,document:{hidden:false},navigator:{onLine:true},
    canRunManualInventoryImport:()=>true,getSupabaseReadIdentityScope:()=> 'owner',window:{},
    continueManualErpSync:()=>Promise.resolve(),scheduleManualSyncStatusPoll:()=>{}};
  const c=runFunctions('assets/erp-sync-ui-functions.js',['driveManualErpSyncFromStatus'],state);
  const run={active:true,runId:'old',currentStage:'soc',workerActive:true,sourceProgress:{soc:{rowsParsed:334,rowsStaged:334}}};
  assert.equal(c.driveManualErpSyncFromStatus(run,true),false);
  c.manualSyncStartPending=false;
  assert.equal(c.driveManualErpSyncFromStatus(run),true);
  assert.equal(c.driveManualErpSyncFromStatus(run),false,'one owner and run has one foreground driver');
  await c.window.erpSyncContinuationDriver.promise;
  const delay=runFunctions('assets/app-runtime.js',['getManualErpContinuationDelay']);
  assert.equal(delay.getManualErpContinuationDelay(run,0),250,'partial staged counts retain bounded continuation delay');
}

export async function folderDiscoveryContract() {
  const {listErpSourceFiles}=await import('../../supabase/functions/_shared/erp-sync.mjs');
  const visited=[];
  const fetcher=async url=>{
    const u=new URL(url);
    if(u.pathname.endsWith('/files/pending'))return {ok:true,json:async()=>({parents:['parent']})};
    const q=u.searchParams.get('q');visited.push(q);
    return {ok:true,json:async()=>({files:q.includes("'parent'")
      ? [{id:'new',name:'SOC-10 Open Orders-11250620261105112506.xlsx'}]
      : [{id:'old',name:'SOC-10 Open Orders-06250620261105062506.xlsx'}]})};
  };
  const files=await listErpSourceFiles(fetcher,'fixture',{soc:'pending',processed:{soc:'processed'}},{key:'soc'});
  for (const folder of ['pending','processed','parent']) assert.equal(visited.filter(q=>q.includes("'"+folder+"'")).length,1);
  assert.deepEqual(files.map(f=>f.id),['new']);
}

export async function manualSyncStartContract(runFunctions, plain) {
  const writes=[],applied=[];let continuation=0,context;
  context=runFunctions('assets/erp-manual-continuation.js',['getManualErpContinuationDelay','continueManualErpSync','runGoogleAppsScriptTrigger'],{
    isRunScriptActive:false,window:{},currentUser:'dylan_collyge',currentUserDisplay:'Dylan',document:{hidden:false},navigator:{onLine:true},console,
    manualSyncStartPending:false,manualSyncStartGeneration:0,nativeAuthRecoveryEpoch:1,nativeAuthProfile:{id:'fixture'},
    manualErpContinuationRequests:new Set(),MANUAL_ERP_SCAN_DEADLINE_MS:25000,MANUAL_ERP_PUBLISH_DEADLINE_MS:70000,
    manualSyncStatusState:{active:true,runId:'stale-run',currentStage:'drive',stageIndex:0},
    MANUAL_SYNC_STAGE_ORDER_CLIENT_DEFAULT:['drive','cav','reserves','soc','hl_po_parsed'],MANUAL_SYNC_SCRIPT_TIMEOUT_MS:600000,
    releaseStaleManualSyncClientStateIfNeeded(){},canRunManualInventoryImport:()=>true,
    syncGoogleScriptButton(){},renderErpSyncProgressModal(){},showToast(){},getSupabaseReadIdentityScope:()=> 'same-account',
    getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer fixture-token'}),
    applyManualSyncStatus:status=>{applied.push(status);context.manualSyncStatusState=status;return status;},
    firstNonEmptyValue:(...values)=>values.find(value=>value!==undefined&&value!==null&&value!==''),
    APP_API_FUNCTION_URL:'/app-api',crypto:{randomUUID:()=> 'sync-command-100'},
    postAppFunctionJson:async(...args)=>{
      const payload=args[1];writes.push(payload);
      if(payload.operation==='start')return {ok:true,status:'CONTINUE',data:{active:true,runId:'run-100'}};
      continuation++;const active=continuation<3;
      return {ok:true,status:active?'CONTINUE':'COMPLETE',data:{durableStatus:{active,runId:'run-100',currentStage:active?'drive':'idle',stageIndex:active?continuation:5}}};
    },
    setTimeout:callback=>{callback();return 0;},
  });
  runFunctions('assets/erp-sync-ui-functions.js',['driveManualErpSyncFromStatus'],context);
  await context.runGoogleAppsScriptTrigger();
  if(context.window.erpSyncContinuationDriver)await context.window.erpSyncContinuationDriver.promise;
  assert.deepEqual(plain(writes[0]),{action:'erp_sync',operation:'start',commandId:'sync-command-100',maxAttemptsPerStage:1,force:true,forceRestart:true,maxRowsPerSlice:2500});
  assert.deepEqual(writes.slice(1).map(write=>[write.action,write.operation,write.runId]),
    [['erp_sync','continue','run-100'],['erp_sync','continue','run-100'],['erp_sync','continue','run-100']]);
  assert.equal(applied.at(-1).active,false);assert.equal(applied.at(-1).currentStage,'idle');
  assert.equal(context.isRunScriptActive,false);assert.equal(context.window.googleScriptRunInFlight,false);
}

export async function operationalSourcesContract(runFunctions) {
  const {isOperationalErpSyncComplete}=await import('../../supabase/functions/_shared/erp-sync.mjs');
  assert.equal(isOperationalErpSyncComplete({stageResults:['drive','cav','reserves','soc'].map(key=>({key,outcome:'UP_TO_DATE'}))}),false);
  assert.equal(isOperationalErpSyncComplete({stageResults:['drive','cav','reserves','soc','hl_po_parsed'].map(key=>({key,outcome:'UP_TO_DATE'}))}),true);
  const {runSecondaryErpSyncStep,SECONDARY_ERP_STAGES}=await import('../../supabase/functions/_shared/erp-secondary-sync.mjs');
  const urls=[],writes=[];
  const result=await runSecondaryErpSyncStep({operationalOnly:true,accessToken:'fixture',supabase:{rpc:async()=>{throw Error('No import expected');}},
    env:()=>'',fetcher:async url=>{urls.push(String(url));return Response.json({files:[]});},status:async patch=>writes.push(patch)});
  const allowed=SECONDARY_ERP_STAGES.find(stage=>stage.key==='hl_po_parsed');
  assert.equal(result.done,true);assert.equal(urls.length,1);
  assert.ok(urls.some(url=>url.includes(allowed.folder)));assert.ok(urls.every(url=>!url.includes(allowed.processed)));
  for(const stage of SECONDARY_ERP_STAGES.filter(stage=>stage.key!=='hl_po_parsed')) assert.ok(urls.every(url=>!url.includes(stage.folder)));
  assert.deepEqual(result.cursor.stageResults.map(row=>row.key),['hl_po_parsed']);assert.equal(writes.at(-1).active,false);
  const context=runFunctions('supabase/functions/app-api/index.ts',['processCloudErpSyncStep'],{
    isOperationalErpSyncComplete,jsonObject:value=>value||{},mintCloudDriveAccessToken:async()=>{throw Error('Completed jobs must never access Drive');},
    supabase:{rpc:async()=>({data:{}})},
  });
  const finished=await context.processCloudErpSyncStep('run','worker',1,{active:true,currentStage:'order_history',stageIndex:4,
    stageResults:['drive','cav','reserves','soc','hl_po_parsed'].map(key=>({key,outcome:'UP_TO_DATE'}))});
  assert.equal(finished.result.done,true);assert.equal(finished.status.active,false);assert.equal(finished.status.percent,100);
}

export async function busyStageContract() {
  const {stageFileContinuation}=await import('../../supabase/functions/_shared/erp-sync.mjs');
  const state={phase:'finalize',stageId:'saved-stage',expectedRows:425,processedRows:425},updates=[];
  let calls=0;
  const preparedRows=123, publicationProgressAt=Date.now();
  const result=await stageFileContinuation({
    supabase:{rpc:async(name,args)=>{
      calls++;
      assert.equal(name,'fast_commit_erp_stage_swap_v1');
      assert.deepEqual(args,{p_stage_id:'saved-stage',p_async:true});
      return {data:{ok:true,busy:true,preparedRows,publicationProgressAt},error:null};
    }},
    fetcher:async()=>{throw Error('must not move unpublished file');},token:'fixture',file:{id:'file',name:'morning.xlsx'},
    dataset:'soc',stageKey:'soc',parentId:'pending',processedId:'processed',state,status:async patch=>updates.push(patch),
  });
  assert.equal(calls,1);assert.equal(result.done,false);
  const { retryNotBefore, ...checkpoint } = result.state;
  assert.deepEqual(checkpoint,{...state,publicationPreparedRows:preparedRows,publicationProgressAt});
  assert.ok(retryNotBefore>Date.now());
  assert.equal(updates.length,1);
  assert.equal(updates[0].retryNotBefore,retryNotBefore);
  assert.deepEqual([updates[0].sourceProgressDelta.stage,updates[0].sourceProgressDelta.rowsPrepared,updates[0].sourceProgressDelta.rowsPublished],['publishing',preparedRows,0]);
}

export async function sealedPublicationContract() {
  const { finishStageContinuation } = await import('../../supabase/functions/_shared/erp-stage-publication.mjs');
  const calls = [];
  const saved = { stageId: 'drive-receipt', expectedRowsPending: true, expectedRows: 50000, processedRows: 9549 };
  const context = {
    supabase: { rpc: async (name, args) => {
      assert.equal(args.p_stage_id, saved.stageId);
      calls.push(name);
      if (name === 'fast_seal_erp_stage_v1') {
        assert.equal(args.p_expected_rows, 9549);
        return { data: { ok: true } };
      }
      return { error: { code: '57014' } };
    } },
    file: { name: 'drive.xlsx' }, dataset: 'drive_around', stageKey: 'drive', maxRows: 50000,
    status: async patch => calls.push(patch.sourceProgressDelta || patch.errorCode),
    moveProcessed: async () => assert.fail('Unpublished input must stay pending'), next: saved
  };
  const result = await finishStageContinuation(context);
  assert.equal(result.done, false);
  assert.equal(result.state.stageId, saved.stageId);
  assert.equal(result.state.expectedRowsPending, false);
  assert.equal(calls[0], 'fast_seal_erp_stage_v1');
  assert.deepEqual([calls[1].stage, calls[1].rowsTotal, calls[1].rowsPublished], ['publishing', 9549, 0]);
  assert.deepEqual(calls.slice(2), ['fast_commit_erp_stage_swap_v1', 'ERP_PUBLICATION_RETRY']);
  assert.deepEqual(await finishStageContinuation({ ...context, next: result.state }), result);
  assert.equal(calls.length, 4);
}
