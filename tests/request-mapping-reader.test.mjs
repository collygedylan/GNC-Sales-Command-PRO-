import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { requestMappingFunctions, requestMappingSetup, mappingFixtureRow } from './helpers/customer-mapping-fixture.mjs';

function fixture(fetchPage) {
 const c=vm.createContext({document:{getElementById:()=>null},APP_API_FUNCTION_URL:'https://example.invalid',ensureDatasetLoaded:async()=>{},postAppFunctionJson:fetchPage,refreshRequestModalCustomerStepIfVisible:()=>{},resetRequestCustomerSelectionState:()=>{c.tempRequestCustomerSelectedContext=null;},renderExistingRequestFolderPicker:()=>{}});
 vm.runInContext(requestMappingSetup+'\n'+requestMappingFunctions()+`\nvar requestModalAsyncGeneration=0,requestMappingReadGeneration=0,requestModalCustomerOptionsLoadPromise=null,requestModalCustomerOptionsLoading=false,requestModalCustomerOptionsReady=false,requestModalCustomerOptionsError='',requestExistingFolderGroupsCacheKey='';`,c);
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
