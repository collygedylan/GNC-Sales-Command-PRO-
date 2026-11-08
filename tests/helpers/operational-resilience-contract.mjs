import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {readComposedRuntimeSource} from '../../scripts/composed-app-source.mjs';
import {patchAppsScriptFunctions} from '../../scripts/apps-script-function-patch.mjs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const source=process.env.GNC_OPERATIONS_BASELINE==='1'?execFileSync('git',['show','HEAD:assets/app-runtime.js'],{encoding:'utf8',maxBuffer:32*1024*1024}):readComposedRuntimeSource();
function fn(name,text=source){const start=text.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);const indent=text.slice(text.lastIndexOf('\n',start)+1,start);const end=text.indexOf('\n'+indent+'}',start);assert.ok(end>start,name);return text.slice(start,end+indent.length+2);}
const plain=v=>JSON.parse(JSON.stringify(v));
export function requestContract(){
 const c=vm.createContext({getSupabaseReadIdentityScope:()=> 'fixture',optimisticRequestIds:new Set(['REQ-1']),optimisticCompletedRowIds:new Set(),requestsInventory:[{UNIQUE_ID:'REQ-1',REQ_STATUS:'Pending'}],firstNonEmptyValue:(...v)=>v.find(x=>x!==undefined&&x!==null&&x!==''),isRequestPendingVisible:r=>r.REQ_STATUS==='Pending',hasConfirmedRequestCompletion:r=>c.optimisticCompletedRowIds.has(r.UNIQUE_ID)});
 vm.runInContext(fn('reconcileIncomingRequestRows'),c);
 assert.equal(c.reconcileIncomingRequestRows([{UNIQUE_ID:'REQ-1',REQ_STATUS:'Pending'}]).length,1);
 assert.equal(c.reconcileIncomingRequestRows([]).length,1,'a later empty read must retain the acknowledged pending request');
 c.optimisticCompletedRowIds.add('REQ-1');assert.equal(c.reconcileIncomingRequestRows([]).length,0);
}
export function emailContract(){
 const code=read('Code.gs'),c=vm.createContext({REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_:['dylan','kayla','jd','megan','nelly'],dedupeEmailAddresses_:values=>[...new Set(values.flat(Infinity).filter(Boolean))]});
 vm.runInContext(fn('buildRequestDeliveryEmailPayload_',code),c);
 const payload=c.buildRequestDeliveryEmailPayload_({event_type:'request_created',payload:{recipientEmails:['extra']}},[{unique_id:'REQ-1',req_customer:'N/A',consigneename:'N/A',recipient_emails:['selected'],request_selected_rep_email:'wes',request_created_by_email:'actor'}]);
 assert.deepEqual(plain(payload.internalRecipients),['dylan','kayla','jd','megan','nelly','extra','selected']);assert.equal(payload.requestCreator.selectedRepEmail,'wes');assert.equal(payload.submittedByEmail,'actor');assert.equal(payload.customer,'N/A');
 const remote=code+'\nfunction productionOnlyRoute(){return 137;}\n';
 const patched=patchAppsScriptFunctions({remoteSource:remote,localSource:code,functionNames:['REQUEST_LIFECYCLE_REQUIRED_RECIPIENT_EMAILS_','buildRequestDeliveryEmailPayload_','requestDeliveryRest_']});
 const out=typeof patched==='string'?patched:patched.source||patched.content||patched.patchedSource;assert.ok(out?.includes('function productionOnlyRoute(){return 137;}'));
}
export function aliasContract(){
 const c=vm.createContext({currentUser:'nelly_aguilar'});vm.runInContext(fn('getRequestCapabilityUsernameKey'),c);
 for(const name of ['nelly_aguilar','nally_aguilar','nelly_aguliar'])assert.equal(c.getRequestCapabilityUsernameKey(name),'nelly_aguilar');assert.equal(c.getRequestCapabilityUsernameKey('dylan_collyge'),'dylan_collyge');
}
export function photoContract(){
 const c=vm.createContext({getExpandedImageUrl:v=>v,resolveAndFormatPhotoDate:()=>'',getPendingPhotoPreviewEntries:()=>[{url:'blob:failed',status:'Save failed'}],getRowPhotoLink:r=>r.photos});vm.runInContext(fn('getPhotoUrlList')+'\n'+fn('resolveCanonicalPhotoUrls'),c);
 const row={photos:JSON.stringify(['blob:expired','https://example.test/two.jpg','https://example.test/three.jpg'])};
 assert.deepEqual(plain(c.resolveCanonicalPhotoUrls(row,'drive')),['https://example.test/two.jpg','https://example.test/three.jpg']);assert.deepEqual(plain(c.resolveCanonicalPhotoUrls(row,'av')),plain(c.resolveCanonicalPhotoUrls(row,'drive')));assert.deepEqual(plain(c.getPhotoUrlList('data:image/png;base64,AAAA')),['data:image/png;base64,AAAA']);
}
export function touchContract(){
 let press=0;const c=vm.createContext({Date,window:{PointerEvent:function(){}},isIOSDevice:()=>true,shouldPreferDetailMeasurementKeyboard:()=>true,detailMeasurementKeyboardLastPointerToken:'',detailMeasurementKeyboardLastPointerAt:0,detailMeasurementKeyboardLastPointerType:'',markDetailMeasurementKeyboardInteraction:()=>{},pressDetailMeasurementKeyboardToken:()=>{press++;},startDetailMeasurementKeyboardRepeat:()=>{},detailMeasurementKeyboardChoiceOpen:''});
 vm.runInContext(fn('shouldApplyDetailMeasurementReadonly')+'\n'+fn('handleDetailMeasurementKeyboardButtonPress'),c);assert.equal(c.shouldApplyDetailMeasurementReadonly({}),true);
 for(const type of ['pointerdown','touchstart','click'])c.handleDetailMeasurementKeyboardButtonPress({type,preventDefault(){},stopPropagation(){}},'8');assert.equal(press,1);c.handleDetailMeasurementKeyboardButtonPress({type:'pointerdown',preventDefault(){},stopPropagation(){}},'8');assert.equal(press,2,'a second intentional tap remains responsive');
 let options;c.document={getElementById:()=>({value:'big hit',classList:{toggle(){}}})};c.resetAvSearchDrilldownState=()=>{};c.scheduleExactAvSearchHydration=()=>{};c.scheduleTrackedSearchViewRender=(...args)=>{options=args.at(-1);};c.isTouchConstrainedDevice=()=>true;c.isViewVisible=()=>true;c.fullInventory=[];c.isDatasetLoaded=()=>false;
 vm.runInContext(fn('handleAVSearch'),c);c.handleAVSearch();assert.ok(options.allowWhileTyping&&options.allowDuringExtendedBlock&&options.debounceDelay<=60);
 let renders=0;c.fullInventory=[{UNIQUE_ID:'ready'}];c.isDatasetLoaded=()=>true;c.markViewDirty=()=>{};c.renderAV=()=>{renders++;};options=null;c.handleAVSearch();assert.equal(renders,1,'hydrated AV search paints synchronously');assert.equal(options,null);
}
export async function syncContract(){
 const {buildOperationalStageCheckpoint}=await import('../../supabase/functions/_shared/erp-sync.mjs');
 const failed=buildOperationalStageCheckpoint('soc',[{key:'soc',outcome:'failed',rowCount:0}]);assert.equal(failed.checked,false);assert.equal(failed.upToDate,false);
 const done=buildOperationalStageCheckpoint('soc',[{key:'soc',outcome:'processed',rowCount:473,sourceFileName:'SOC.xlsx'}]);assert.equal(done.percent,100);assert.equal(done.rowsParsed,473);assert.equal(done.rowsStaged,473);assert.equal(done.rowsPublished,473);
 const sql=read('supabase/migrations/20261102160000_v23138_operational_resilience.sql');assert.doesNotMatch(sql,/delete from private\.fast_erp_stage_runs_v1/i);assert.match(sql,/FAST_ERP_STAGE_FORBIDDEN/);assert.match(sql,/expires_at=clock_timestamp\(\)\+interval '24 hours'/);
}

export function dispatcherContract(){
 const source=fs.readFileSync(new URL('../../Code.gs',import.meta.url),'utf8');const names=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8')).appsScriptPatchFunctions;
 const merged=patchAppsScriptFunctions({remoteSource:source.replace(/const RECLASS_RECOUNT_COMPLETION_EVENT_TYPE_ = [^;]+;/,''),localSource:source,functionNames:names}).source;
 const dispatcher=fn('handleSignedRequestDeliveryEvent_',merged);const declarations=[...merged.matchAll(/const ([A-Z][A-Z0-9_]+) = ('[^']*'|"[^"]*");/g)].map(m=>m[0]).join('\n');
 const ctx={verifySignedRequestDelivery_:()=>({eventType:'request_created',messageIdHeader:'<one@test>'}),LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},getRequestDeliveryReceipt_:()=>({gmailMessageId:'existing-message'})};
 vm.runInNewContext(declarations+'\n'+dispatcher,ctx);assert.equal(ctx.handleSignedRequestDeliveryEvent_({}).gmailMessageId,'existing-message');
}
