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
 const c=vm.createContext({Blob,TextEncoder,crypto:webcrypto,Uint8Array,FileReader:Reader,SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']),PHOTO_BUCKETS:{'lsn-':'location_sales_notes_photos'},SUPABASE_URL:'https://example.supabase.co',APP_API_FUNCTION_URL:'https://example.supabase.co/functions/v1/app-api',getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer verified',apikey:'public'}),fetchWithTimeout:async(url,init)=>{calls.push({url,init});return {ok:url.includes('/rpc/')&&!denied,status:url.includes('/rpc/')?403:402,json:async()=>url.includes('/rpc/')&&!denied?{id:'a'.repeat(64)}:{message:'denied'}};}});
 vm.runInContext(functionSource('uploadDrivePhotoWithNativeSession'),c);
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
 const c=vm.createContext({findDockSuspendDcRequestMirrorRowByUniqueId:()=>({UNIQUE_ID:'tag'}),canCurrentUserViewDockSuspendDcRequests:()=>true,isDockSuspendDcRequestMirrorRow:()=>true,hydrateSuspendTagItemOptions:()=>{},retryPendingSuspendTagInventoryReconciliations:()=>{},getMasterPhotoSyncItem:()=>master,isFalseBlockLocation:()=>false,openDetail:(...args)=>calls.push(args)});vm.runInContext(functionSource('openDockSuspendDcRequestUpdate'),c);c.openDockSuspendDcRequestUpdate('tag');assert.deepEqual(calls[0].slice(0,2),['master','drive']);assert.equal(c.lastView,'request');
 const sql=read('supabase/migrations/20261102233000_photo_recovery_suspend_locations.sql');assert.match(sql,/p_operation='replace_location' and r.unique_id=uid/);assert.match(sql,/SUSPEND_TAG_SPLIT_QUANTITY_INVALID/);assert.match(sql,/FOR EACH STATEMENT EXECUTE/);assert.match(sql,/s.locationcode=n.locationcode/);assert.match(sql,/REVOKE ALL ON public.ph_photo_blobs FROM PUBLIC,anon,authenticated/);
}
