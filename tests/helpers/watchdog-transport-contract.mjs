import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {dispatchRpcWithRecovery} from '../../src/services/rpc-recovery-domain.js';

export async function assertWatchdogTransportRecovery() {
    const sent=[];
    const request={method:'POST',body:JSON.stringify({client_batch_id:'same-batch',requests:[{unique_id:'exact-row'}]}),headers:{Authorization:'same-session'}};
    const response=await dispatchRpcWithRecovery({bridge:{fetchRpc:async(_url,name,init)=>{
        sent.push({name,body:init.body,authorization:init.headers.Authorization});
        return sent.length===1?Response.json({code:'55P03'},{status:503}):Response.json({ok:true});
    }},baseUrl:'fixture',rpcName:'create_av_request_batch',body:{client_batch_id:'same-batch'},
    request,requestOptions:{},timeoutMs:1000,inScope:()=>true});
    assert.equal(response.ok,true);
    assert.equal(sent.length,2);
    assert.deepEqual(sent[0],sent[1],'AV retry retains the durable batch identity and actor');
    let calls=0,observed=0;
    const context=vm.createContext({Response,Headers,AbortController,setTimeout,clearTimeout,URL,URLSearchParams,Map,Set,
        window:{GncRuntimeWatchdog:{observeError:()=>observed++,record:()=>observed++}},document:{body:{dataset:{currentView:'request'}},hidden:false},
        navigator:{},SUPABASE_URL:'https://kzrnyjsosryejjejliii.supabase.co',APP_API_FUNCTION_URL:'https://api.fixture',SUPABASE_KEY:'fixture',
        SUPABASE_WRITE_TIMEOUT_MS:1000,APP_VERSION:'3.0.72',nativeAuthRecoveryEpoch:1,currentUser:'same-owner',PRELOGIN_BACKGROUND_ACTIONS:new Set(),
        isAllowedAppHostname:()=>true,isLoginScreenVisible:()=>false,getCurrentAppSessionToken:()=> 'same-session',
        getSupabaseReadIdentityScope:()=> 'same-owner',getNativeAuthRequestHeaders:async()=>({Authorization:'same-session'}),
        fetchSupabaseRestViaAppApiIfNeeded:async()=>null,
        fetch:async()=>++calls===1?Response.json({code:'XX000',message:'Temporary revision update'},{status:500}):Response.json({ok:true,data:{rows:[{unique_id:'retained'}]}})});
    for(const file of ['rpc-recovery-domain','app-api-transport']) {
        const source=fs.readFileSync(new URL('../../assets/'+file+'.js',import.meta.url),'utf8');
        vm.runInContext(source,context);
    }
    context.waitForOperationalRetry=async()=>{};
    const saved=await context.postAppFunctionJson('https://api.fixture',{action:'dataset_read',dataset:'request_queue'});
    assert.equal(saved.data.rows[0].unique_id,'retained');
    assert.equal(calls,2);
    assert.equal(observed,0,'A recovered HTTP 500 is not reported as a terminal incident');
    calls=0;
    context.fetch=async()=>{calls++;return Response.json({code:'XX000',message:'Persistent failure'},{status:500});};
    await assert.rejects(context.postAppFunctionJson('https://api.fixture',{action:'dataset_read',dataset:'request_queue'}),error=>error.status===500);
    assert.equal(calls,4);
    assert.equal(observed,2,'Terminal failures retain both RPC and app-api observations');
}
