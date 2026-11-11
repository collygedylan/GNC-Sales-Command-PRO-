import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {retryOperationalRpc, operationalRpcIsReplaySafe} from '../../src/services/rpc-recovery-domain.js';
import {hasValidCommunicationFilters} from '../../src/services/rpc-recovery-domain.js';

const read = file => fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const run = (file, context) => vm.runInContext(read(file).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),context);

export async function assertWatchdogRpcRecovery() {
    for (const code of ['55P03','LOCK_TIMEOUT','XX000']) {
        let calls=0;
        const waits=[];
        const status=code === 'XX000' ? 500 : 503;
        const response=await retryOperationalRpc(async()=>++calls<4
            ? Response.json({code},{status}) : Response.json({ok:true}),{
            safe:true,current:()=>true,wait:async delay=>waits.push(delay),random:()=>0
        });
        assert.equal(response.ok,true);
        assert.equal(calls,4);
        assert.deepEqual(waits,[150,400,900]);
    }
    for (const [status,code] of [[403,'42501'],[409,'IDEMPOTENCY_CONFLICT'],[400,'22023']]) {
        let calls=0;
        await retryOperationalRpc(async()=>{calls++;return Response.json({code},{status});},
            {safe:true,current:()=>true,wait:async()=>assert.fail('No replay of rejected commands')});
        assert.equal(calls,1);
    }
    assert.equal(operationalRpcIsReplaySafe('create_av_request_batch',{client_batch_id:'same-batch'}),true);
    assert.equal(operationalRpcIsReplaySafe('create_av_request_batch',{}),false);
    assert.equal(operationalRpcIsReplaySafe('send_email',{}),false);
    let current=false;
    await assert.rejects(retryOperationalRpc(()=>assert.fail('Changed owner cannot dispatch'),{
        safe:true,current:()=>current}),/account changed/);
    current=true;
    await assert.rejects(retryOperationalRpc(async()=>{current=false;throw {code:'55P03'};},{
        safe:true,current:()=>current,wait:async()=>{}}),/account changed/);
}

export async function assertWatchdogReadContinuity() {
    const rows=[{UNIQUE_ID:'retained-request'}];
    let retries=0,reads=0,view='home';
    const context=vm.createContext({window:{GncRuntimeWatchdog:{capture:()=>assert.fail('Recovered refresh is not terminal')}},
        ACTIVE_REQUEST_TABLE:'ph_requests_pending',requestsInventory:rows,productionLiveSyncNavigation:{signal:new AbortController().signal},
        buildActiveRequestLiveRowsQuery:()=>'',getSupabaseReadIdentityScope:()=> 'same-owner',
        fetchAllSupabaseRows:async()=>{throw {code:'TRANSPORT_TIMEOUT'};},queueRequestForceRefreshRetry:()=>retries++,
        getCurrentVisibleViewId:()=>view,getAuthorizedDatasetRead:()=>({dataset:'suspend_tag'}),
        postAppFunctionJson:async()=>{reads++;},Error,Map,Set,URLSearchParams,structuredClone});
    run('assets/rpc-recovery-domain.js',context);
    run('assets/request-live-rows.js',context);
    const retained=await context.fetchActiveRequestLiveRows();
    assert.equal(retained[0],rows[0]);
    assert.equal(retries,1);
    assert.equal(retained.requestReadMeta.authoritative,false);
    assert.equal(retained.requestReadMeta.retained,true);
    Object.assign(context,{navTransitionSeq:1,currentUser:'same-owner',navigator:{onLine:true},
        isRequestViewReadTerminalForCurrentIdentity:()=>false,requestViewForceRefreshInFlight:false,
        requestViewReadCooldownRemaining:()=>0,shouldDeferInteractiveBackgroundWork:()=>false,
        REQUEST_VIEW_FORCE_REFRESH_MIN_INTERVAL_MS:0,lastRequestViewForceRefreshAt:0,
        getNativeForegroundRequestRefreshAdapter:()=>null,fetchActiveRequestLiveRows:async()=>retained,
        requestViewRetryAttempts:1,requestViewForceRefreshRetryTimer:'retained-retry',
        recordRequestViewReadFailure:()=>assert.fail('Retained rows are not a terminal load failure')});
    assert.equal(await context.forceRefreshRequestsForView('retained',{force:true}),false);
    assert.equal(context.requestViewRetryAttempts,1);
    assert.equal(context.requestViewForceRefreshRetryTimer,'retained-retry');
    await assert.rejects(context.requestAuthorizedDatasetReadPage('ph_active_suspend'),error=>error.code==='DATASET_READ_RETAINED' && error.retryOnViewChange);
    assert.equal(reads,0,'Home does not contend with boot on a Suspend prefetch');
    for (const query of ['conversation_id=in.()','username=eq.','conversation_id=eq.null','conversation_id=in.(,abc)']) {
        assert.equal(hasValidCommunicationFilters('ph_chat_messages',query),false,query);
    }
    assert.equal(hasValidCommunicationFilters('ph_chat_messages','conversation_id=in.(abc,def)'),true);
}
