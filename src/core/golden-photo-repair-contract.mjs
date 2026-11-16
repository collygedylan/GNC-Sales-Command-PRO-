import {parse} from 'acorn';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
const source=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');

export function assertPhotoSurfaceScope() {
 const c=vm.createContext({activeDetailSourceView:'av',lastView:'drive'});
 vm.runInContext(source('src/engine/photo-workflow-policy.js'),c);
 for(const view of ['av','eval-report2','studio','sales','sales-office','qc','inventory','production','po-management','docks','smart-moves']) {
  assert.equal(c.isPhotoMutationSurface('lsn-',view),false,view);
  assert.equal(c.isPhotoMutationSurface('req-',view),false,view);
 }
 for(const prefix of ['ssn-','lsn-','na-','global-']) assert.equal(c.isPhotoMutationSurface(prefix,'drive'),true);
 assert.equal(c.isPhotoMutationSurface('req-','request'),true);
 for(const prefix of ['eval-','dock-','credit-','flyer-','ncr-']) assert.equal(c.isPhotoMutationSurface(prefix,'drive'),false);
}

export async function assertPhotoFallback() {
 let uploads=0;
 const c=vm.createContext({FormData,Blob,nativeAuthSessionActive:true,
  ensureAppApiWriteProxySession:async()=>{},postPhotoUploadWithTransientRetry:async()=>{throw Error('Unknown database operation');},
  isPasswordChangeRequiredError:()=>false,uploadDrivePhotoWithNativeSession:async()=>{uploads++;return {ok:true,publicUrl:'confirmed-storage'};}});
 vm.runInContext(source('src/services/row-photo-send.js'),c);
 const form=new FormData();form.set('prefix','lsn-');form.set('masterUid','exact-row');
 const result=await c.sendPreparedRowPhotoUpload(form,false,{});
 assert.equal(result.publicUrl,'confirmed-storage');assert.equal(uploads,1);
 c.postPhotoUploadWithTransientRetry=async()=>{throw Object.assign(Error('Forbidden'),{status:403});};
 await c.sendPreparedRowPhotoUpload(form,false,{});assert.equal(uploads,2);
 c.uploadDrivePhotoWithNativeSession=async()=>{throw Error('Storage denied');};
 await assert.rejects(c.sendPreparedRowPhotoUpload(form,false,{}),/Storage denied/);
 c.nativeAuthSessionActive=false;
 await assert.rejects(c.sendPreparedRowPhotoUpload(form,false,{}),/Forbidden/);
}

export async function assertPhotoRpcContracts() {
 const root=new URL('../../',import.meta.url);
 const built=buildSync({entryPoints:[new URL('services/databaseRest.ts',root).pathname.replace(/^\/(?:([A-Za-z]:))/,'$1')],bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;
 const module={exports:{}};vm.runInNewContext(built,{module,exports:module.exports,Response,URLSearchParams,TextDecoder,Uint8Array});
 const api=module.exports;
 for(const name of ['prepare_request_photo_upload_v3100','authorize_photo_upload_v3074','authorize_request_photo_intent_v3079',
  'append_request_photo_intent_v3079','store_drive_photo_blob_v1','attach_drive_photo_blob_v1','save_eval_work_v1','save_eval_work_v2','submit_eval_work_v1','submit_eval_work_v2']) assert.equal(api.rpcName(name),name);
 assert.throws(()=>api.rpcName('arbitrary_photo_operation'),/Unknown database operation/);
 let calls=0;
 const bridge=api.createDatabaseRestBridge(async()=>{calls++;return new Response('{}',{status:200,headers:{'Content-Type':'application/json'}});});
 const args={p_identity:{masterUid:'exact'},p_photo_id:'photo-1',p_object_path:'v2/hash.jpg'};
 await bridge.fetchRpc('https://example.invalid','prepare_request_photo_upload_v3100',{method:'POST',body:JSON.stringify(args)},1000,'photo');
 assert.equal(calls,1);
 await assert.rejects(bridge.fetchRpc('https://example.invalid','prepare_request_photo_upload_v3100',
  {method:'POST',body:JSON.stringify({...args,p_photo_id:3})},1000,'photo'),/arguments/);
 assert.equal(calls,1);
}

export function assertPhotoControlOrigin() {
 const button={style:{},classList:{toggle(){}}};
 const document={body:{className:'current-view-home',dataset:{}},getElementById:id=>id==='camera-btn-ssn'?button:null};
 const c=vm.createContext({document,activeItem:{},activeDetailSourceView:'drive',lastView:'home',canEditRowDetails:()=>true,
  canCurrentUserWorkRequestItem:()=>true});
 vm.runInContext(source('src/engine/photo-workflow-policy.js')+'\n'+source('src/ui/photo-workflow-controls.js'),c);
 c.applyCameraPermissions('drive',c.activeItem);assert.equal(document.body.dataset.photoMutationSource,'drive');assert.equal(button.style.display,'flex');
 c.applyCameraPermissions('av',c.activeItem);assert.equal(document.body.dataset.photoMutationSource,'av');assert.equal(button.style.display,'none');
}

export async function assertPhotoPublicationStatus() {
 const row={UNIQUE_ID:'row',ITEMCODE:'item',LOCATIONCODE:'A',LOTCODE:'lot'},preview={id:'photo',createdAt:Date.now()};
 const job={id:'photo',fileName:'exact.jpg',scope:'owner',prefix:'ssn-',sourceView:'drive',item:row,identity:row,preview};
 let resolve;
 const pending=new Promise(done=>{resolve=done;});
 const c=vm.createContext({drivePhotoAttachments:new Map([['photo',job]]),getSupabaseReadIdentityScope:()=> 'owner',
  getPendingPhotoPreviewEntries:()=>[preview],refreshPendingPhotoUiForItem(){},activeItem:row,
  normalizeStoragePublicUrl:value=>value,getMasterPhotoSyncItem:()=>row,canEditEvidenceWorkflow:()=>true,isSameDriveEvidenceLocation:()=>true,
  buildSecureDriveEvidenceBaseline:()=>({}),appendPhotoCsvValue:(_before,value)=>value,
  publishRowEvaluationToMasterAndNotes:()=>pending});
 vm.runInContext(source('src/engine/photo-workflow-policy.js')+'\n'+source('src/core/inventory-photo-domain.js')+'\n'+source('src/core/detail-photo-attachments.js'),c);
 const legacy=source('assets/row-workflow-functions.js');
 const functions=parse(legacy,{ecmaVersion:'latest'}).body.filter(node=>node.type==='FunctionDeclaration'
  && ['verifyPublishedPhotoPreview','confirmRowPhotoSlot'].includes(node.id.name)).map(node=>legacy.slice(node.start,node.end)).join('\n');
 vm.runInContext(functions,c);
 c.acceptQueuedRowPhotoUpload(job,{ok:true,publicUrl:'https://photo.example/exact.jpg',fileName:'exact.jpg'});
 assert.equal(job.status,'Saving');assert.equal(preview.status,'Saving');
 const saving=c.persistDrivePhotoAttachment(job);
 assert.equal(c.drivePhotoAttachments.size,1);assert.equal(preview.status,'Saving');
 resolve({applied:{row,applied:false},projectionDeferred:false});await saving;
 assert.equal(c.drivePhotoAttachments.size,0);assert.equal(preview.status,'Uploaded');
 assertPublishedGallery(c,row);
}

function assertPublishedGallery(c,row) {
 const entry={url:'https://photo.example/exact.jpg',persistedIndex:0,pending:false,dateLabel:'11/16/26'};
 const host={dataset:{},innerHTML:''},wrapper={classList:{remove(){},add(){}}};
 Object.assign(c,{document:{getElementById:id=>id==='host'?host:wrapper},
  getDisplayPhotoEntries:()=>[entry,{...entry,url:'https://photo.example/second.jpg',persistedIndex:1}],getInventoryLocationPhotos:()=>[],getPhotoUrlList:value=>String(value || '').split(',').filter(Boolean),
  canReorderProtectedPhoto:()=>true,canRemoveProtectedPhoto:()=>false,getCompletedRowUnlockKey:()=>row.UNIQUE_ID,
  escJsAttrValue:String,escapeHtml:String,getDirectImageUrl:value=>value,buildDeferredCardPhotoImg:()=>'<img>',
  replaceDetailMediaPreservingImages:(node,html)=>{node.innerHTML=html;},scheduleDeferredCardPhotoHydration(){},
  resolveAndFormatPhotoDate:()=>entry.dateLabel});
 vm.runInContext(source('src/ui/detail-photo-gallery.js'),c);
 c.renderSavedPhotoGallery(entry.url,'host','wrapper','ssn-','Photos');
 assert.match(host.innerHTML,/✓ SAVED/);assert.match(host.innerHTML,/LEFT/);assert.match(host.innerHTML,/11\/16\/26/);
 entry.pending=true;entry.status='Saving';
 c.renderSavedPhotoGallery(entry.url,'host','wrapper','ssn-','Photos');
 assert.match(host.innerHTML,/Saving/);assert.doesNotMatch(host.innerHTML,/✓ SAVED/);
}
