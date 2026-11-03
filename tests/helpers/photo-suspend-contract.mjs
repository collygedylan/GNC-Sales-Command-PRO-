import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {functionSource} from './completed-row-contract.mjs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export async function photoRecoveryContract(){
 const calls=[];let denied=false;
 const file=new Blob([new Uint8Array([255,216,255,1])],{type:'image/jpeg'});
 const form=new Map([['prefix','lsn-'],['masterUid','exact-row'],['file',file],['thumbnail144',file],['thumbnail320',file]]);
 class Reader {readAsDataURL(){this.result='data:image/jpeg;base64,/9j/AQ==';queueMicrotask(()=>this.onload());}}
 const c=vm.createContext({Blob,TextEncoder,crypto:webcrypto,Uint8Array,FileReader:Reader,getSupabaseReadIdentityScope:()=>'actor-one',SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']),PHOTO_BUCKETS:{'lsn-':'location_sales_notes_photos'},SUPABASE_URL:'https://example.supabase.co',APP_API_FUNCTION_URL:'https://example.supabase.co/functions/v1/app-api',getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer verified',apikey:'public'}),fetchWithTimeout:async(url,init)=>{calls.push({url,init});return {ok:url.includes('/rpc/')&&!denied,status:url.includes('/rpc/')?403:402,json:async()=>url.includes('/rpc/')&&!denied?{id:'a'.repeat(64)}:{message:'denied'}};}});
 vm.runInContext(['getDrivePhotoGatewayState','rememberDrivePhotoGatewayFailure','uploadDrivePhotoWithNativeSession'].map(functionSource).join('\n'),c);
 const result=await c.uploadDrivePhotoWithNativeSession(form);assert.equal(result.storage,'postgres');assert.match(result.publicUrl,/photo_blob=[a-f0-9]{64}$/);
 assert.equal(calls.filter(x=>x.url.includes('/storage/v1/object/')).length,3);assert.ok(calls.every(x=>x.init.headers.Authorization==='Bearer verified'));assert.equal(calls[0].init.headers['x-upsert'],'true');assert.equal(JSON.parse(calls.at(-1).init.body).p_content,'/9j/AQ==');
 denied=true;await assert.rejects(c.uploadDrivePhotoWithNativeSession(form),/denied/);
 await assert.rejects(c.uploadDrivePhotoWithNativeSession(form,{isCurrent:()=>false}),/session changed/);
 assert.match(read('assets/image-optimize-worker-v2026090401.js'),/DISPLAY_MAX_EDGE = 1280/);assert.match(read('assets/image-optimize-worker-v2026090401.js'),/DISPLAY_MAX_BYTES = 204_800/);
}
export function stagedReclassContract(){
 const state={},drafts=new Map([['one',{priority:2}],['two',{priority:3}]]),cards=['one','two'].map(uid=>({hidden:false,attrs:{'data-reclass-row-card':uid},getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;},querySelector(){return {setAttribute(){}};}}));
 const c=vm.createContext({argosInventoryTransactionState:state,argosReclassMultiActionState:{rowProposals:drafts},document:{getElementById:()=>({querySelectorAll:()=>cards,querySelector:()=>null})},hydrateArgosReclassRowCard:()=>{}});vm.runInContext(functionSource('focusArgosReclassRow'),c);
 c.focusArgosReclassRow('one');c.focusArgosReclassRow('two');assert.ok(cards.every(x=>!x.hidden));assert.equal(drafts.size,2);assert.ok(cards.every(x=>x.attrs['data-reclass-row-expanded']==='true'));
}
export function suspendLocationContract(){
 const calls=[];const master={UNIQUE_ID:'master',LOCATIONCODE:'D.20.000'};
 const c=vm.createContext({findDockSuspendDcRequestMirrorRowByUniqueId:()=>({UNIQUE_ID:'tag'}),canReadSuspendQueue:()=>true,canUseRequestSuspendTagAssignedToFilter:()=>true,isDockSuspendDcRequestMirrorRow:()=>true,hydrateSuspendTagItemOptions:()=>{},retryPendingSuspendTagInventoryReconciliations:()=>{},getMasterPhotoSyncItem:()=>master,isFalseBlockLocation:()=>false,openDetail:(...args)=>calls.push(args)});vm.runInContext(functionSource('openDockSuspendDcRequestUpdate'),c);c.openDockSuspendDcRequestUpdate('tag');assert.deepEqual(calls[0].slice(0,2),['master','drive']);assert.equal(c.lastView,'request');
 const sql=read('supabase/migrations/20261102233000_photo_recovery_suspend_locations.sql');assert.match(sql,/p_operation='replace_location' and r.unique_id=uid/);assert.match(sql,/SUSPEND_TAG_SPLIT_QUANTITY_INVALID/);assert.match(sql,/FOR EACH STATEMENT EXECUTE/);assert.match(sql,/s.locationcode=n.locationcode/);assert.match(sql,/REVOKE ALL ON public.ph_photo_blobs FROM PUBLIC,anon,authenticated/);
}

export async function photoCooldownContract(){
 let now=1000,owner='first',mode='timeout',storageCalls=0,blobCalls=0,deny=false;
 const file=new Blob([new Uint8Array([255,216,255,1])],{type:'image/jpeg'}),form=new Map([['prefix','lsn-'],['masterUid','exact-row'],['file',file],['thumbnail144',file],['thumbnail320',file]]);
 class Reader{readAsDataURL(){this.result='data:image/jpeg;base64,/9j/AQ==';queueMicrotask(()=>this.onload());}}
 const c=vm.createContext({Date:{now:()=>now},Blob,TextEncoder,crypto:webcrypto,Uint8Array,FileReader:Reader,SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']),PHOTO_BUCKETS:{'lsn-':'location_sales_notes_photos'},SUPABASE_URL:'https://example.supabase.co',APP_API_FUNCTION_URL:'https://example.supabase.co/functions/v1/app-api',getSupabaseReadIdentityScope:()=>owner,getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer verified'}),fetchWithTimeout:async(url,init,ms)=>{
 if(url.includes('/storage/')){storageCalls++;assert.equal(ms,900);if(mode==='timeout')throw new Error('Request timed out');return {ok:mode==='healthy',status:mode==='healthy'?200:504,json:async()=>({})};}
 blobCalls++;return {ok:!deny,status:deny?403:200,json:async()=>deny?{message:'denied'}:{id:'a'.repeat(64)}};
 }});vm.runInContext(['getDrivePhotoGatewayState','rememberDrivePhotoGatewayFailure','uploadDrivePhotoWithNativeSession'].map(functionSource).join('\n'),c);
 await c.uploadDrivePhotoWithNativeSession(form);assert.equal(storageCalls,3);assert.equal(c.uploadDrivePhotoWithNativeSession.state.storageGatewayCooldownUntil,1801000);
 for(let i=0;i<3;i++)await c.uploadDrivePhotoWithNativeSession(form);assert.equal(storageCalls,3);assert.equal(blobCalls,4);
 deny=true;await assert.rejects(c.uploadDrivePhotoWithNativeSession(form),/denied/);deny=false;
 now=1801001;mode='healthy';assert.equal((await c.uploadDrivePhotoWithNativeSession(form)).storage,undefined);assert.equal(storageCalls,6);
 mode='504';await c.uploadDrivePhotoWithNativeSession(form);assert.equal(storageCalls,9);await c.uploadDrivePhotoWithNativeSession(form);assert.equal(storageCalls,9);
 owner='second';await c.uploadDrivePhotoWithNativeSession(form);assert.equal(storageCalls,12);
 const before=blobCalls;await assert.rejects(c.uploadDrivePhotoWithNativeSession(form,{isCurrent:()=>false}),/session changed/);assert.equal(blobCalls,before);
}
export async function fallbackHistoryContract(){
 const ts=await import('typescript');const exports={};vm.runInNewContext(ts.transpileModule(read('supabase/functions/_shared/photo-history.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Set});
 const asset={bucket:'ph_photo_blobs',path:'a'.repeat(64),storage_available:true};const expected='https://example.supabase.co/functions/v1/app-api?photo_blob='+asset.path;
 assert.equal(exports.historyPhotoUrl('https://example.supabase.co',asset),expected);assert.equal(exports.historyPhotoUrl('https://example.supabase.co',asset,true),expected);assert.equal(exports.publicHistoryPhoto('https://example.supabase.co',asset).thumbnailUrl,expected);
 assert.throws(()=>exports.historyPhotoUrl('https://example.supabase.co',{...asset,path:'../secret'}));
 assert.equal(exports.publicHistoryPhoto('https://example.supabase.co',{bucket:'request_photos',path:'old.jpg',storage_available:false,drive_file_id:'archive'}).archived,true);
 const sql=read('supabase/migrations/20261103000100_photo_cooldown_history_cache.sql');assert.match(sql,/WHERE m.unique_id=NEW.master_uid/);assert.match(sql,/AFTER INSERT ON public.ph_photo_blobs/);assert.match(sql,/a.bucket<>''ph_photo_blobs''/);
 const gs=read('Code.gs');assert.ok(gs.includes("bucket === 'ph_photo_blobs' &&"));assert.ok(JSON.parse(read('package.json')).appsScriptPatchFunctions.includes('photoHistoryEmailImage_'));
}
export function boundedCacheContract(){
 const sql=read('supabase/migrations/20261103000100_photo_cooldown_history_cache.sql');assert.match(sql,/LIMIT 200 FOR UPDATE SKIP LOCKED/);assert.match(sql,/SET LOCAL statement_timeout = '30s'/);assert.match(sql,/SET LOCAL lock_timeout = '5s'/);assert.match(sql,/FROM batch WHERE o.id=batch.id/);assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.repair_photo_cache_metadata_batch_v1() FROM PUBLIC,anon,authenticated'));assert.doesNotMatch(sql,/DROP.*storage.objects|DISABLE.*TRIGGER|UPDATE public.ph_master_inventory/i);
 assert.ok(read('scripts/apply-item-low-stock-migration.mjs').includes('photoCooldownHistoryMigrationName'));
}

export async function historyPatchContract(){
 const {patchAppsScriptFunctions}=await import('../../scripts/apps-script-function-patch.mjs');
 const source=read('Code.gs'),sentinel='\nfunction productionOnlyPhotoRoute_(){ return "retained"; }\n';
 const remote=source.replace("bucket === 'ph_photo_blobs'", "bucket === 'legacy_photo_blobs'")+sentinel;
 const patched=patchAppsScriptFunctions({remoteSource:remote,localSource:source,functionNames:['photoHistoryEmailImage_']}).source;
 assert.ok(patched.includes(sentinel));assert.ok(patched.includes("bucket === 'ph_photo_blobs'"));assert.ok(!patched.includes("bucket === 'legacy_photo_blobs'"));
}

export async function persistentPhotoWarmupContract(){
 assert.ok(functionSource('openDetail').includes('void warmDrivePhotoSaveForRow(nextItem)'));
 assert.ok(!functionSource('openDetail').includes('await warmDrivePhotoSaveForRow'));
 let now=1000;const saved=new Map(),calls=[];
 const c=vm.createContext({Date:{now:()=>now},TextEncoder,localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},getSupabaseReadIdentityScope:()=> 'actor',uploadDrivePhotoWithNativeSession:function(){},getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer native'}),getPhotoOptimizerWorker:()=>null,SUPABASE_URL:'https://example.supabase.co',APP_API_FUNCTION_URL:'https://example.supabase.co/functions/v1/app-api',resolveCanonicalPhotoUrls:()=>[],fetchWithTimeout:async(url,init,timeout)=>{calls.push({url,init,timeout});return {status:url.includes('/storage/')?504:200};}});
 vm.runInContext(['getDrivePhotoGatewayState','rememberDrivePhotoGatewayFailure','warmDrivePhotoSaveForRow'].map(functionSource).join('\n'),c);
 const state=c.getDrivePhotoGatewayState();c.rememberDrivePhotoGatewayFailure(state);assert.equal(saved.get('agdata_storage_gateway_cooldown_until_v1'),'1801000');
 c.uploadDrivePhotoWithNativeSession.state=undefined;assert.equal(c.getDrivePhotoGatewayState().storageGatewayCooldownUntil,1801000,'reload preserves TTL');
 await Promise.all([c.warmDrivePhotoSaveForRow({UNIQUE_ID:'row'}),c.warmDrivePhotoSaveForRow({UNIQUE_ID:'row'})]);assert.equal(calls.length,3,'single flight and no Storage probe during cooldown');
 assert.equal(calls[0].init.method,'HEAD');assert.equal(calls[1].init.method,'OPTIONS');assert.equal(calls[1].init.body,undefined);assert.equal(calls[2].init.headers.Authorization,'Bearer native');assert.ok(calls[2].url.endsWith('/rpc/can_upload_drive_evidence_v23115'));assert.equal(JSON.parse(calls[2].init.body).p_name,'drive-evidence/726f77/v2/'+'0'.repeat(64)+'.jpg');
 now=1801001;c.uploadDrivePhotoWithNativeSession.state=undefined;assert.equal(c.getDrivePhotoGatewayState().storageGatewayCooldownUntil,0);await c.warmDrivePhotoSaveForRow({UNIQUE_ID:'row'});assert.equal(calls.filter(x=>x.url.includes('/storage/')).length,1);assert.equal(saved.get('agdata_storage_gateway_cooldown_until_v1'),String(now+1800000));
 saved.set('agdata_storage_gateway_cooldown_until_v1','999999999999999');c.uploadDrivePhotoWithNativeSession.state=undefined;assert.equal(c.getDrivePhotoGatewayState().storageGatewayCooldownUntil,0,'reject corrupt/future timestamps');
 c.localStorage={getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}};c.uploadDrivePhotoWithNativeSession.state=undefined;assert.doesNotThrow(()=>c.rememberDrivePhotoGatewayFailure(c.getDrivePhotoGatewayState()));
}
