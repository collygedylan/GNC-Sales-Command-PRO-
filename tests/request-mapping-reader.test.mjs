import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { patchAppsScriptFunctions } from '../scripts/apps-script-function-patch.mjs';
import { requestMappingFunctions, requestMappingSetup, mappingFixtureRow } from './helpers/customer-mapping-fixture.mjs';

const codeSource = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

test('retained mapping choices remain usable during revision refresh', () => {
 const source=readFileSync(new URL('../assets/app-runtime.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/New submissions remain blocked until verification completes/);
 const ready=source.match(/        function isRequestModalCustomerMapReady\([^]*?^        }/m)[0];
 assert.doesNotMatch(ready,/cached\.signature === getRequestModalCustomerMappingCacheSignature/);
});

test('request login does not await customer map hydration', () => {
 const source=readFileSync(new URL('../assets/app-runtime.js',import.meta.url),'utf8');
 const login=source.match(/        async function finalizeLogin\([^]*?^        }/m)[0];
 assert.doesNotMatch(login,/await prepareRequestModalChoicesForStartup/);
});

test('Apps Script scoped patch ships the release manifest and preserves protected functions',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 const remoteSource=execFileSync('git',['show','HEAD:Code.gs'],{encoding:'utf8',maxBuffer:16*1024*1024})
  +"\nfunction protectedRemoteOnly_() { return 'unchanged'; }\n";
 const patch=patchAppsScriptFunctions({remoteSource,localSource:codeSource,functionNames:manifest.appsScriptPatchFunctions});
 assert.deepEqual(patch.functions,manifest.appsScriptPatchFunctions);
 assert.ok(manifest.appsScriptPatchFunctions.includes('scheduleSocOrderHistoryTrigger_'));
 assert.ok(manifest.appsScriptPatchFunctions.includes('runSocOrderHistoryBackfillChunk_'));
 const historyWorker=patch.source.match(/function runSocOrderHistoryBackfillChunk_\(\) \{[^]*?^}/m)?.[0]||'';
 assert.match(historyWorker,/status: 'cloud_owned'/);
 assert.doesNotMatch(historyWorker,/DriveApp|callSupabaseRpc_|scheduleSocOrderHistoryTrigger_\(/);
 for(const name of patch.functions)assert.ok(patch.source.includes(`function ${name}(`)||patch.source.includes(`const ${name} =`),`${name} is included in the scoped patch`);
 assert.equal(patch.source.split("return jsonOutput_(handleRuntimeWatchdogAlert_(payload));").length-1,1,'the watchdog handler dispatch is present exactly once');
 assert.match(patch.source,/const payload = authorizeAppsScriptPost_\(JSON\.parse\(e\.postData\.contents\)\)/,'the scoped patch installs the doPost authentication entry gate');
 assert.ok(patch.source.includes("function protectedRemoteOnly_() { return 'unchanged'; }"));
 assert.equal(patch.protectedSourceDigest.length,64);
});

function fixture(fetchPage) {
 const c=vm.createContext({document:{getElementById:()=>null},window:{setTimeout,clearTimeout},APP_API_FUNCTION_URL:'https://example.invalid',ensureDatasetLoaded:async()=>true,postAppFunctionJson:async(url,body)=>{
  const response=await fetchPage(url,body.operation==='preload'?{...body,page:0,pageSize:200}:body);
  if(body.operation!=='preload'||!Array.isArray(response.rows)) return response;
  const groups=new Map();
  response.rows.forEach(row=>{ if(!groups.has(row.salesrepid)) groups.set(row.salesrepid,{salesrepid:row.salesrepid,salesrepname:row.salesrepname,rows:[]});
    groups.get(row.salesrepid).rows.push([row.customeridentityid,row.customername,row.consigneeid,row.consigneename]); });
  return {...response,reps:[...groups.values()]};
 },refreshRequestModalCustomerStepIfVisible:()=>{},resetRequestCustomerSelectionState:()=>{c.tempRequestCustomerSelectedContext=null;},renderExistingRequestFolderPicker:()=>{}});
 vm.runInContext(requestMappingSetup+'\n'+requestMappingFunctions()+`\nvar requestModalAsyncGeneration=0,requestMappingReadGeneration=0,requestModalCustomerOptionsLoadPromise=null,requestModalCustomerOptionsLoading=false,requestModalCustomerOptionsReady=false,requestModalCustomerOptionsError='',requestExistingFolderGroupsCacheKey='';`,c);
 c.customerRepMapRows=[mappingFixtureRow];
 return c;
}
test('Request reader resolves a rep ID with a bounded direct name query when the picker has no ID',async()=>{
 const calls=[];
 const rows=[mappingFixtureRow,{...mappingFixtureRow,unique_id:'map-2',customeridentityid:'00013',consigneeid:'00008'}];
 const c=fixture(async()=>({ok:true,rows:[],total:0,revision:'9'}));
 c.fetchAllSupabaseRows=async(table,query,options)=>{calls.push({table,query,options});return rows;};
 c.customerRepMapRows=[];
 c.tempSelectedReqRep='Rep One';
 const result=await c.loadRequestModalCustomerOptionsForRep('Rep One');
 assert.equal(result.rows.length,2);
 assert.equal(calls[0].table,'ph_customer_consignee_sales_reps');
 assert.match(calls[0].query,/salesrepname=eq\.Rep%20One/);
 assert.equal(c.tempSelectedReqSalesrepId,'01');
 assert.equal(c.getRequestSelectedSalesrepId('Rep One'),'01');
 assert.equal(c.getRequestModalCustomerOptionsForRep('Rep One').length,2);
});
test('Request reader loads every rep-ID page before publishing choices',async()=>{
 const calls=[];
 const rows=Array.from({length:201},(_,i)=>({...mappingFixtureRow,unique_id:'m'+i,customeridentityid:String(i).padStart(5,'0'),consigneeid:'C'+i}));
 const c=fixture(async(_url,body)=>{calls.push(body);return {ok:true,rows:rows.slice(body.page*200,(body.page+1)*200),total:201,revision:'9'};});
 await c.loadRequestModalCustomerOptionsForRep('Rep One');
 assert.deepEqual(calls.map(body=>[body.salesrepId,body.page]),[['01',0],['01',1]]);
 assert.equal(c.getRequestModalCustomerOptionsForRep('Rep One').length,201);
 assert.equal(c.requestMappingRpcCache.get('01').revision,'9');
});
test('N/A Customer and Consignee map to an authorized tuple and stay pinned first',()=>{
 const c=fixture(async()=>({ok:true,rows:[],total:0,revision:'9'}));
 const options=[
  {...mappingFixtureRow,customerName:'Garden ®',consigneeName:'North ™',label:'Garden ® | North ™'},
  {...mappingFixtureRow,unique_id:'garden-south',consigneeid:'00008',consigneeidentityid:'00008',consigneename:'South ™',consigneeName:'South ™',label:'Garden ® | South ™'},
  {...mappingFixtureRow,unique_id:'garden-na-consignee',consigneeid:'AGDATA_NA_CONSIGNEE',consigneeidentityid:'AGDATA_NA_CONSIGNEE',consigneename:'N/A',consigneeName:'N/A',label:'Garden ® | N/A'},
  {...mappingFixtureRow,unique_id:'na-map',customeridentityid:'AGDATA_NA_CUSTOMER',customername:'N/A',customerName:'N/A',
   consigneeid:'AGDATA_NA_CONSIGNEE',consigneeidentityid:'AGDATA_NA_CONSIGNEE',consigneename:'N/A',consigneeName:'N/A',label:'N/A | N/A'}
 ];
 const groups=Array.from(c.buildRequestCustomerPickerGroups(options));
 assert.equal(groups[0].label,'N/A');
 assert.equal(groups[0].consignees[0].consigneeName,'N/A');
 assert.equal(groups[0].consignees[0].customeridentityid,'AGDATA_NA_CUSTOMER');
 assert.equal(groups[0].consignees[0].consigneeidentityid,'AGDATA_NA_CONSIGNEE');
 const garden=groups.find(group=>group.label==='Garden ®');
 assert.equal(garden.consignees[0].consigneeName,'N/A','N/A Consignee is pinned first inside an ordinary Customer');
 assert.equal(garden.consignees[0].customeridentityid,'00012');
 assert.equal(garden.consignees[0].consigneeidentityid,'AGDATA_NA_CONSIGNEE');
});

test('customer map import adds one active protected N/A row for each active mapped Sales Rep',()=>{
 const start=codeSource.indexOf('function requestNaMappingDigest_(');
 const end=codeSource.indexOf('\nfunction buildCustomerRepMapSnapshot_(',start);
 assert.ok(start>=0&&end>start,'import helper exists');
 const context=vm.createContext({
  Utilities:{DigestAlgorithm:{MD5:'MD5'},Charset:{UTF_8:'UTF-8'},computeDigest:(_algorithm,value)=>{
   const seed=Array.from(String(value||'')).reduce((sum,char)=>sum+char.charCodeAt(0),0);
   return Array.from({length:16},(_,index)=>(seed+index)%256);
  }},
  normalizeImportedSalesRepName_:value=>String(value||'').trim(),
  buildRowSyncHash_:()=> 'stable-row-hash'
 });
 vm.runInContext("const REQUEST_NA_CUSTOMER_ID_='AGDATA_NA_CUSTOMER'; const REQUEST_NA_CONSIGNEE_ID_='AGDATA_NA_CONSIGNEE';\n"+codeSource.slice(start,end),context);
 const rows=context.ensureProtectedRequestNaCustomerMappings_([
  {...mappingFixtureRow,salesrepid:'01',salesrepname:'Rep One'},
  {...mappingFixtureRow,unique_id:'rep-one-2',customeridentityid:'00012',consigneeid:'00008',salesrepid:'01',salesrepname:'Rep One'},
  {...mappingFixtureRow,unique_id:'rep-two',salesrepid:'02',salesrepname:'Rep Two'},
  {...mappingFixtureRow,unique_id:'inactive-rep',salesrepid:'03',salesrepname:'Rep Three',customerstatus:'I'}
  ],'customers.csv','2026-10-21T00:00:00.000Z');
 const naConsigneeRows=Array.from(rows).filter(row=>row.consigneeid==='AGDATA_NA_CONSIGNEE'&&row.consigneename==='N/A');
 assert.equal(naConsigneeRows.length,4,'each active mapped customer plus the universal N/A customer gets one active N/A Consignee per rep');
 assert.deepEqual(Array.from(naConsigneeRows, row=>[row.salesrepid,row.customeridentityid,row.customername,row.customerstatus,row.consigneestatus]),[
  ['01','AGDATA_NA_CUSTOMER','N/A','A','A'],['01','00012','Garden ®','A','A'],
  ['02','AGDATA_NA_CUSTOMER','N/A','A','A'],['02','00012','Garden ®','A','A']
 ]);
 assert.equal(new Set(Array.from(naConsigneeRows,row=>row.unique_id)).size,4);
});
test('a 103-customer rep directory is fully available without a short display cap',async()=>{
 const rows=Array.from({length:103},(_,index)=>({...mappingFixtureRow,
  unique_id:`customer-${index+1}`,customeridentityid:String(index+1).padStart(5,'0'),
  consigneeid:`consignee-${index+1}`,customername:`Customer ${String(index+1).padStart(3,'0')}`,
  consigneename:`Consignee ${String(index+1).padStart(3,'0')}`}));
 const calls=[];
 const c=fixture(async(_url,body)=>{calls.push(body);return{ok:true,rows:rows.slice(body.page*200,(body.page+1)*200),total:rows.length,revision:'customers-r1'};});
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),true);
 assert.equal(c.getRequestModalCustomerOptionsForRep('Rep One').length,103);
 assert.deepEqual(calls.map(body=>body.page),[0]);
});
test('JD receives the paged app-wide directory with N/A pinned and no rep-map row',async()=>{
 const rows=Array.from({length:205},(_,index)=>({
  ...mappingFixtureRow,unique_id:`jd-${index}`,salesrepid:'AGDATA_EXECUTIVE_ALL',salesrepname:'JD Jones',
  customeridentityid:`JDC${index}`,consigneeid:`JDN${index}`,
  customername:`Executive Customer ${String(index).padStart(3,'0')}`,
  consigneename:`Executive Consignee ${String(index).padStart(3,'0')}`
 }));
 rows.unshift({...mappingFixtureRow,unique_id:'jd-na',salesrepid:'AGDATA_EXECUTIVE_ALL',salesrepname:'JD Jones',
  customeridentityid:'AGDATA_NA_CUSTOMER',customername:'N/A',consigneeid:'AGDATA_NA_CONSIGNEE',consigneename:'N/A'});
 const calls=[];
 const c=fixture(async(_url,body)=>{
  calls.push(body);
  return {ok:true,rows:rows.slice(body.page*200,(body.page+1)*200),total:rows.length,page:body.page,pageSize:200,revision:'jd-r1'};
 });
 c.customerRepMapRows=[];
 c.tempSelectedReqRep='JD Jones';
 assert.equal(c.getRequestSelectedSalesrepId('JD Jones'),'AGDATA_EXECUTIVE_ALL');
 const result=await c.loadRequestModalCustomerOptionsForRep('JD Jones');
 assert.equal(result.rows.length,rows.length);
 assert.equal(result.rows[0].customerName,'N/A');
 assert.equal(result.rows[0].consigneeName,'N/A');
 assert.equal(result.rows[0].request_selected_salesrep_id,'AGDATA_EXECUTIVE_ALL');
 assert.deepEqual(calls.map(body=>[body.salesrepId,body.page]),[
  ['AGDATA_EXECUTIVE_ALL',0],['AGDATA_EXECUTIVE_ALL',1]
 ]);
 assert.doesNotMatch(c.requestModalCustomerOptionsError,/directory is unavailable/i);
});

test('JD local fallback unions loaded Map, SOC, Reserves, and Request history before the RPC finishes',()=>{
 const c=fixture(async()=>new Promise(()=>{}));
 c.customerRepMapRows=[];
 c.socInventory=[{customeridentityid:'SOC-C',customername:'SOC Customer',consigneeidentityid:'SOC-N',consigneename:'SOC Consignee'}];
 c.reservesInventory=[{customeridentityid:'RES-C',customername:'Reserve Customer',consigneeidentityid:'RES-N',consigneename:'Reserve Consignee'}];
 c.requestsInventory=[{customeridentityid:'REQ-C',customername:'Request Customer',consigneeidentityid:'REQ-N',consigneename:'Request Consignee'}];
 c.requestHistoryInventory=[{customeridentityid:'HIS-C',customername:'History Customer',consigneeidentityid:'HIS-N',consigneename:'History Consignee'}];
 const options=Array.from(c.getRequestModalCustomerOptionsForRep('JD Jones'));
 assert.equal(options[0].label,'N/A | N/A');
 assert.deepEqual(Array.from(options.slice(1),option=>option.customerName),[
  'History Customer','Request Customer','Reserve Customer','SOC Customer'
 ]);
 assert.ok(options.every(option=>option.request_selected_salesrep_id==='AGDATA_EXECUTIVE_ALL'));
});
test('a mapping revision change between pages rejects partial results',async()=>{
 const c=fixture(async(_url,body)=>({ok:true,rows:Array.from({length:body.page?1:200},(_,i)=>({...mappingFixtureRow,customeridentityid:String(body.page*200+i),consigneeid:String(i)})),total:201,revision:body.page?'10':'9'}));
 await assert.rejects(c.loadRequestModalCustomerOptionsForRep('Rep One'),/changed during loading/);
 assert.equal(c.requestMappingRpcCache.size,0);
});
test('an obsolete rep read cannot overwrite the new selection',async()=>{
 let finish;
 const c=fixture(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=c.ensureRequestModalCustomerOptionsReady();
 await new Promise(resolve=>setTimeout(resolve,0));
 c.requestMappingReadGeneration++;c.tempSelectedReqRep='Rep Two';
 finish({ok:true,rows:[mappingFixtureRow],total:1,revision:'9'});
 assert.equal(await pending,false);
 assert.equal(c.tempSelectedReqRep,'Rep Two');
});
test('transport failure preserves the customer draft but leaves mapping unverified and retryable',async()=>{
 const c=fixture(async()=>{throw new Error('Network unavailable');});
 const selection={customeridentityid:'00012'};
 c.tempRequestCustomerSelectedContext=selection;
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),false);
 assert.equal(c.tempRequestCustomerSelectedContext,selection);
 assert.equal(c.requestModalCustomerOptionsReady,false);
 assert.equal(c.requestMappingRpcCache.size,0);
 assert.match(c.requestModalCustomerOptionsError,/Network unavailable/);
});
test('same-identity mapping options remain submittable after a refresh failure',async()=>{
 let shouldFail=false;
 const c=fixture(async()=>{
  if(shouldFail)throw new Error('Network unavailable');
  return{ok:true,rows:[mappingFixtureRow],total:1,revision:'9'};
 });
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),true);
 const prior=c.getRequestModalCustomerOptionsForRep('Rep One');
 shouldFail=true;
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(true),false);
 assert.equal(c.requestModalCustomerOptionsReady,true);
 assert.equal(c.getRequestModalCachedCustomerOptionsForRep('Rep One').length,1);
 assert.deepEqual(Array.from(c.getRequestModalCustomerOptionsForRep('Rep One'),row=>row.customeridentityid),['00012']);
 assert.equal(c.requestMappingRpcCache.get('01').stale,true);
 assert.equal(c.requestModalCustomerOptionsReady,true,'same-owner choices remain usable; submission revalidates the tuple on the server');
 assert.match(c.requestModalCustomerOptionsError,/Network unavailable/);
 assert.equal(c.getSupabaseReadIdentityScope(),'identity-1');
 assert.equal(prior.length,1);
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
 assert.equal(c.buildRequestModalCustomerOptionsCache(true).length,1,'same-owner choices remain available as stale display data');
 assert.equal(c.requestMappingRpcCache.size,1);
 assert.equal(c.requestModalCustomerOptionsReady,true);
 assert.notEqual(c.tempRequestCustomerSelectedContext,null);
 assert.equal(c.isRequestModalCustomerMapReady(),true,'revision drift retains complete same-account choices');
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),true);
 assert.equal(calls,1);
});

test('an atomic preload remains usable when the background revision signal advances',async()=>{
 let c;
 c=fixture(async()=>{c.mappingRevision='2';return {ok:true,rows:[mappingFixtureRow],total:1,revision:'9'};});
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),true);
 assert.equal(c.getRequestModalCustomerOptionsForRep('Rep One').length,1);
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
 // Normalize into the test realm; VM arrays have a different prototype.
 assert.deepEqual(Array.from(options,option=>option.label),['Molly Dixon','Rep One','Rep Two']);
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

test('mapped rep ID lookup reuses a revision-scoped index and preserves aliases and ambiguity',()=>{
 const c=fixture(async()=>({ok:true,rows:[mappingFixtureRow],total:1,revision:'r1'}));
 let eligibilityChecks=0;
 c.isActiveRequestCustomerMapping=()=>{eligibilityChecks++;return true;};
 c.customerRepMapRows=Array.from({length:12000},(_,index)=>({...mappingFixtureRow,
  unique_id:`map-${index}`,salesrepid:'01',salesrepname:index===11999?'One, Rep':'Rep One'}));
 assert.equal(c.getRequestSelectedSalesrepId('Rep One'),'01');
 const firstIndexChecks=eligibilityChecks;
 assert.equal(firstIndexChecks,12000);
 assert.equal(c.getRequestSelectedSalesrepId('Rep One'),'01');
 assert.equal(eligibilityChecks,firstIndexChecks);

 c.mappingRevision='2';
 c.customerRepMapRows=[{...mappingFixtureRow,salesrepid:'01',salesrepname:'One, Rep'}];
 assert.equal(c.getRequestSelectedSalesrepId('One, Rep'),'01');
 c.mappingRevision='3';
 c.customerRepMapRows=[
  {...mappingFixtureRow,salesrepid:'01',salesrepname:'One, Rep'},
  {...mappingFixtureRow,unique_id:'map-2',salesrepid:'02',salesrepname:'Rep One'},
 ];
 assert.equal(c.getRequestSelectedSalesrepId('Rep One'),'');
 c.tempSelectedReqRep='Rep One';
 c.tempSelectedReqSalesrepId='02';
 assert.equal(c.getRequestSelectedSalesrepId(),'02');
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

test('startup preload indexes every server-authorized rep in one snapshot',async()=>{
 const rows=[mappingFixtureRow,{...mappingFixtureRow,unique_id:'map-2',salesrepid:'02',salesrepname:'Rep Two',customeridentityid:'00013',consigneeid:'00008'}];
 const calls=[];
 const c=fixture(async(_url,body)=>{calls.push(body);return {ok:true,rows,total:rows.length,revision:'r1'};});
 assert.equal(await c.prefetchRequestModalCustomerOptions(),true);
 assert.equal(calls.length,1); assert.equal(calls[0].operation,'preload');
 assert.deepEqual(Array.from(c.requestMappingRpcCache.keys()).sort(),['01','02']);
 const start=performance.now();
 assert.equal(c.getRequestModalCustomerOptionsForRep('Rep Two').length,1);
 assert.ok(performance.now()-start<50);
});

test('cold startup retries a stale lookup only after its permission scope changes',async()=>{
 const c=fixture(async()=>({ok:true,rows:[mappingFixtureRow],total:1,revision:'r1'}));
 let attempts=0;
 c.prefetchRequestModalCustomerOptions=async()=>{
  attempts++;
  if(attempts===1){c.getSupabaseReadIdentityScope=()=> 'identity-after-access';return false;}
  c.prefetchRequestModalCustomerOptions.completedOwner=c.getRequestModalCustomerMappingCacheSignature();
  return true;
 };
 assert.equal(await c.prepareRequestModalChoicesForStartup(250),true);
 assert.equal(attempts,2);
});

test('cold startup does not retry a stable failed scope or a logged-out session',async()=>{
 const stable=fixture(async()=>({ok:true,rows:[mappingFixtureRow],total:1,revision:'r1'}));
 let stableAttempts=0;
 stable.prefetchRequestModalCustomerOptions=async()=>{stableAttempts++;return false;};
 assert.equal(await stable.prepareRequestModalChoicesForStartup(250),false);
 assert.equal(stableAttempts,1);

 const loggedOut=fixture(async()=>({ok:true,rows:[mappingFixtureRow],total:1,revision:'r1'}));
 let logoutAttempts=0;
 loggedOut.prefetchRequestModalCustomerOptions=async()=>{logoutAttempts++;loggedOut.currentUser='';return false;};
 assert.equal(await loggedOut.prepareRequestModalChoicesForStartup(250),false);
 assert.equal(logoutAttempts,1);
});

test('cold startup retains a finite timeout when a lookup never settles',async()=>{
 const c=fixture(async()=>({ok:true,rows:[mappingFixtureRow],total:1,revision:'r1'}));
 c.prefetchRequestModalCustomerOptions=()=>new Promise(()=>{});
 assert.equal(await c.prepareRequestModalChoicesForStartup(250),false);
});

test('a warm rep directory renders the Request picker inline on modal open',()=>{
 const c=fixture(async()=>({ok:true,rows:[mappingFixtureRow],total:1,revision:'r1'}));
 c.requestModalRepUserOptionsReady=true;
 const calls=[];
 c.filterRepList=term=>calls.push(['render',term]);
 c.scheduleRequestModalSearchRender=(...args)=>calls.push(['schedule',...args]);
 assert.equal(c.renderRequestModalRepPickerOnOpen(null),true);
 assert.deepEqual(calls,[['render','']]);
});

test('an unavailable rep directory keeps the deferred loading and retry render',async()=>{
 const c=fixture(async()=>({ok:true,rows:[mappingFixtureRow],total:1,revision:'r1'}));
 c.requestModalRepUserOptionsReady=false;
 const calls=[];
 c.filterRepList=term=>calls.push(['render',term]);
 c.scheduleRequestModalSearchRender=(...args)=>calls.push(['schedule',...args]);
 let release;
 const optionsReady=new Promise(resolve=>{release=resolve;});
 assert.equal(c.renderRequestModalRepPickerOnOpen(optionsReady),false);
 assert.equal(calls.length,1);
 c.requestModalRepUserOptionsReady=true;
 release();
 await Promise.resolve();
 assert.equal(calls.length,2);
 assert.deepEqual(calls.map(call=>call[0]),['schedule','schedule']);
});

test('modal mapping ensure reuses a prefetched page set without another API read',async()=>{
 let calls=0;
 const c=fixture(async()=>{calls++;return {ok:true,rows:[mappingFixtureRow],total:1,revision:'r1'};});
 c.customerRepMapRows=[mappingFixtureRow];
 c.getAllowedRequestModalRepOptions=()=>[{label:'Rep One'}];
 assert.equal(await c.prefetchRequestModalCustomerOptions(),true);
 assert.equal(calls,1);
 assert.equal(await c.ensureRequestModalCustomerOptionsReady(),true);
 assert.equal(calls,1);
});

test('startup preload rejects a response after the account changes',async()=>{
 let finish;
 const c=fixture(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=c.prefetchRequestModalCustomerOptions();
 const rejected=assert.rejects(pending,/account changed/);
 await Promise.resolve(); c.getSupabaseReadIdentityScope=()=> 'different-identity';
 finish({ok:true,rows:[mappingFixtureRow],total:1,revision:'r1'});
 await rejected;
 assert.equal(c.requestMappingRpcCache.size,0);
});

test('startup mapping prefetch stays idle when Request access is denied',async()=>{
 let datasetReads=0,rpcCalls=0;
 const c=fixture(async()=>{rpcCalls++;return {ok:true,rows:[mappingFixtureRow],total:1,revision:'r1'};});
 c.ensureDatasetLoaded=async()=>{datasetReads++;};
 c.canAccessView=()=>false;
 c.canUseRequestRepScopedAccess=()=>false;
 assert.equal(await c.prefetchRequestModalCustomerOptions(),false);
 assert.equal(datasetReads,0);
 assert.equal(rpcCalls,0);
});

test('all 26 rep customer trees are warm under 50ms with N/A first',async()=>{
 const rows=Array.from({length:26},(_,i)=>[
  {...mappingFixtureRow,salesrepid:String(i),salesrepname:'Representative '+i,customeridentityid:'A',consigneeid:'A',customername:'A & M Flowers',consigneename:'Garden'},
  {...mappingFixtureRow,salesrepid:String(i),salesrepname:'Representative '+i,customeridentityid:'NA',consigneeid:'NA',customername:'N/A',consigneename:'N/A'}
 ]).flat();
 let reads=0;
 const c=fixture(async()=>{reads++;return {ok:true,rows,total:rows.length,revision:'26-reps'};});
 await c.prefetchRequestModalCustomerOptions();
 const start=performance.now();
 for(let i=0;i<26;i++) {
  const options=c.getRequestModalCustomerOptionsForRep('Representative '+i);
  const groups=c.buildRequestCustomerPickerGroups(options);
  assert.equal(groups[0].label,'N/A');
  assert.equal(groups[0].consignees[0].consigneeName,'N/A');
 }
 const elapsed=performance.now()-start;
 assert.ok(elapsed<50,'warm lookup '+elapsed.toFixed(2)+'ms'); assert.equal(reads,1);
 console.log('26 warm rep trees: '+elapsed.toFixed(2)+'ms');
});
test('sales_rep accounts bind themselves even with broad view grants; office users keep the picker',()=>{
 const source=readFileSync(new URL('../assets/app-runtime.js',import.meta.url),'utf8');
 const extract=name=>source.match(new RegExp('        function '+name+'\\([^]*?^        }','m'))[0];
 const c=vm.createContext({getRoleAccessState:()=>({isRep:true}),canUseGlobalRequestAccess:()=>true,
  currentUser:'ben_brown',currentUserDisplay:'Ben Brown',resolveCanonicalRequestRepName:value=>value});
 vm.runInContext(extract('getDefaultRequestRepName')+extract('isRequestRepPickerLockedForCurrentUser'),c);
 for(const [username,label] of [['ben_brown','Ben Brown'],['brian_hatfield','Brian Hatfield']]) {
  c.currentUser=username; assert.equal(c.isRequestRepPickerLockedForCurrentUser(),true);
  assert.equal(c.getDefaultRequestRepName(),label);
 }
 c.getRoleAccessState=()=>({isRep:false});
 for(const username of ['nelly_aguilar','dylan_collyge']) {c.currentUser=username;assert.equal(c.isRequestRepPickerLockedForCurrentUser(),false);}
 const modal=source.match(/        function showRequestModalBase\([^]*?^        }/m)[0];
 assert.match(modal,/if \(repPickerLocked\)/); assert.match(modal,/renderExistingRequestFolderPicker\(\)/);
});
