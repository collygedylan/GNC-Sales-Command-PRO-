import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { requestMappingFunctions, requestMappingSetup, mappingFixtureRow } from './helpers/customer-mapping-fixture.mjs';

function fixture(fetchPage) {
 const c=vm.createContext({document:{getElementById:()=>null},APP_API_FUNCTION_URL:'https://example.invalid',ensureDatasetLoaded:async()=>{},postAppFunctionJson:fetchPage,refreshRequestModalCustomerStepIfVisible:()=>{},resetRequestCustomerSelectionState:()=>{c.tempRequestCustomerSelectedContext=null;},renderExistingRequestFolderPicker:()=>{}});
 vm.runInContext(requestMappingSetup+'\n'+requestMappingFunctions()+`\nvar requestModalAsyncGeneration=0,requestMappingReadGeneration=0,requestModalCustomerOptionsLoadPromise=null,requestModalCustomerOptionsLoading=false,requestModalCustomerOptionsReady=false,requestModalCustomerOptionsError='',requestExistingFolderGroupsCacheKey='';`,c);
 c.isRequestModalCustomerMapReady=()=>{
  const id=c.getRequestSelectedSalesrepId(),cached=c.requestMappingRpcCache.get(id);
  return !!id && !!cached && cached.signature===c.getDatasetLoadSignature('customerRepMap');
 };
 c.customerRepMapRows=[mappingFixtureRow];
 return c;
}
test('Request reader loads every rep-ID page before publishing choices',async()=>{
 const calls=[];
 const rows=Array.from({length:201},(_,i)=>({...mappingFixtureRow,unique_id:'m'+i,customeridentityid:String(i).padStart(5,'0'),consigneeid:'C'+i}));
 const c=fixture(async(_url,body)=>{calls.push(body);return {ok:true,rows:rows.slice(body.page*200,(body.page+1)*200),total:201,revision:'9'};});
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),true);
 assert.deepEqual(calls.map(body=>[body.salesrepId,body.page]),[['01',0],['01',1]]);
 assert.equal(c.getRequestModalCustomerOptionsForRep('Rep One').length,201);
 assert.equal(c.tempSelectedReqSalesrepId,'01');
 assert.equal(c.requestModalCustomerOptionsCacheKey,'01:9');
});
test('a mapping revision change between pages rejects partial results',async()=>{
 const c=fixture(async(_url,body)=>({ok:true,rows:Array.from({length:body.page?1:200},(_,i)=>({...mappingFixtureRow,customeridentityid:String(body.page*200+i),consigneeid:String(i)})),total:201,revision:body.page?'10':'9'}));
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),false);
 assert.equal(c.requestMappingRpcCache.size,0);
 assert.match(c.requestModalCustomerOptionsError,/changed during loading/);
});
test('an obsolete rep read cannot overwrite the new selection',async()=>{
 let finish;
 const c=fixture(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=c.ensureRequestModalCustomerOptionsReady();
 await new Promise(resolve=>setTimeout(resolve,0));
 c.requestMappingReadGeneration++;c.tempSelectedReqRep='Rep Two';
 finish({ok:true,rows:[mappingFixtureRow],total:1,revision:'9'});
 assert.equal(await pending,false);
 assert.equal(c.requestMappingRpcCache.size,0);
});
test('transport failure clears the selection and preserves a retryable error',async()=>{
 const c=fixture(async()=>{throw new Error('Network unavailable');});
 c.tempRequestCustomerSelectedContext={customeridentityid:'00012'};
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),false);
 assert.equal(c.tempRequestCustomerSelectedContext,null);
 assert.match(c.requestModalCustomerOptionsError,/Network unavailable/);
});

test('modal cache initialization uses only a complete RPC result for the exact rep ID',async()=>{
 let calls=0;
 const c=fixture(async()=>{calls++;return {ok:true,rows:[mappingFixtureRow],total:1,revision:'9'};});
 assert.equal(c.buildRequestModalCustomerOptionsCache(true).length,0);
 assert.equal(c.requestModalCustomerOptionsReady,false);
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),true);
 assert.equal(c.buildRequestModalCustomerOptionsCache(true).length,1);
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),true);
 assert.equal(calls,1);
 c.mappingRevision='2';
 c.tempRequestCustomerSelectedContext={customeridentityid:'00012',consigneeidentityid:'00007',customername:'Garden ®',consigneename:'North ™',request_selected_salesrep_id:'01'};
 assert.equal(c.buildRequestModalCustomerOptionsCache(true).length,0);
 assert.equal(c.requestMappingRpcCache.size,0);
 assert.equal(c.requestModalCustomerOptionsReady,false);
 assert.equal(c.tempRequestCustomerSelectedContext,null);
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),true);
 assert.equal(calls,2);
});

test('directory revision changes during a single-page RPC read reject stale choices',async()=>{
 let c;
 c=fixture(async()=>{c.mappingRevision='2';return {ok:true,rows:[mappingFixtureRow],total:1,revision:'9'};});
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),false);
 assert.equal(c.requestMappingRpcCache.size,0);
 assert.match(c.requestModalCustomerOptionsError,/changed during loading/);
});

test('CSR rep choices reuse the revision-coordinated app-user directory',async()=>{
 const c=fixture(async()=>{throw new Error('Direct duplicate read should not run');});
 let coordinatedReads=0;
 c.shouldUseProductionLiveSyncSideLoad=()=>true;
 c.ensureProductionLiveSyncSideData=async(id,force)=>{
  assert.equal(id,'users'); assert.equal(force,false); coordinatedReads++;
  c.assignableAppUsers=[
   {username:'rep_one',display:'Rep One',role:'REP'},
   {username:'manager_one',display:'Manager One',role:'MANAGER'},
  ];
  c.assignableAppUsersLoaded=true;
  return true;
 };
 const options=await c.ensureRequestRepUserOptionsReady();
 assert.deepEqual(options.map(option=>option.label),['Molly Dixon','Rep One','Rep Two']);
 assert.equal(options.some(option=>option.username==='manager_one'),false);
 assert.equal(coordinatedReads,1);
});

test('CSR rep option cache is cleared when authenticated data scope changes',async()=>{
 const c=fixture(async()=>({ok:true,rows:[{username:'rep_one',role:'REP'}]}));
 let directReads=0;
 c.shouldUseProductionLiveSyncSideLoad=()=>false;
 c.supabaseFetch=async()=>{directReads++;return [{username:'rep_one',role:'REP'}];};
 await c.ensureRequestRepUserOptionsReady();
 c.requestModalRepUserOptionsReady=true;
 c.getSupabaseReadIdentityScope=()=> 'identity-2';
 await c.ensureRequestRepUserOptionsReady();
 assert.equal(directReads,2);
});

test('mapping option cache is scoped to the current authenticated identity and permission version',async()=>{
 let calls=0;
 const rows=[mappingFixtureRow];
 const c=fixture(async()=>{calls++;return {ok:true,rows,total:1,revision:'9'};});
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),true);
 assert.equal(calls,1);
 c.identityScope='other-session';
 c.getSupabaseReadIdentityScope=()=>c.identityScope;
 assert.equal(c.buildRequestModalCustomerOptionsCache().length,0);
 assert.equal(c.requestModalCustomerOptionsReady,false);
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),true);
 assert.equal(calls,2);
});
