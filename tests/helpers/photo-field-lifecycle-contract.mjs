import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {functionSource} from './completed-row-contract.mjs';
import {nativePhotoTransportFunctions} from './photo-suspend-contract.mjs';
const context=(names,values)=>{const c=vm.createContext(values);vm.runInContext(names.map(functionSource).join('\n'),c);return c;};
export async function photoFieldLifecycleContract(){
 const now=new Date('2026-11-02T12:00:00');
 class Clock extends Date {static now(){return +now;}}
 const c=context(['getPhotoUrlList','parsePhotoCsvValues','calculateLiveLocPhotoMatch','isPhotoDateMsExpired','isRowPhotoEvaluationExpired','canUnlockCompletedRow','canUserUnlockRow','resolveCanonicalRowAccess'],{GLOBAL_LIVE_CHANGE_USER_KEYS:new Set(['dylan_collyge','mitch_kaiser','nelly_aguilar']),resolveUserAccessMatrix:()=>null,resolveInventoryRowOwner:r=>r.owner,Date:Clock,PHOTO_RETENTION_MAX_AGE_MS:10*86400000,getPhotoRetentionFallbackDateMs:r=>Date.parse(r.photo_date||''),getExpandedImageUrl:u=>u,getMasterAssignedToValue:r=>r.owner,normalizeEvalAssignableUser:u=>String(u||'').toLowerCase(),currentUser:'jorge_colunga',currentRole:'eval'});
 const urls=['data:image/jpeg;base64,/9j/AA==','https://test.supabase.co/functions/v1/app-api?photo_blob='+'a'.repeat(64),...Array.from({length:40},(_,i)=>'https://test.supabase.co/storage/v1/object/public/photos/'+i+'.jpg')];
 assert.deepEqual(Array.from(c.getPhotoUrlList(urls.join(','))),urls,'mixed data, blob-RPC and unlimited Storage references survive');
 assert.deepEqual(Array.from(c.parsePhotoCsvValues('first.jpg,second.jpg')),['first.jpg','second.jpg']);
 assert.equal(c.isRowPhotoEvaluationExpired({photo_date:'2026-10-23T23:00:00',MATCH:50,PTRAVAILABLE:100}),false,'day ten stays active');
 assert.equal(c.isRowPhotoEvaluationExpired({photo_date:'2026-10-22T23:00:00',MATCH:50,PTRAVAILABLE:100}),true,'day eleven expires');
 assert.equal(c.isRowPhotoEvaluationExpired({MATCH:0,PTRAVAILABLE:100}),true,'explicit zero expires');
 assert.equal(c.isRowPhotoEvaluationExpired({MATCH:null,PTRAVAILABLE:100,LOC_PHOTO_MATCH:0}),false,'unentered draft is not evaluated zero');
 assert.equal(c.isRowPhotoEvaluationExpired({MATCH:0,photo_date:'2020-01-01'},'dock-'),false,'Docks is exempt');
 for(const [user,role,allowed] of [['jorge_colunga','eval',true],['nelly_aguilar','admin',true],['dylan_collyge','super-admin',true],['wes_lugas','REP',false],['mitch_kaiser','eval',true],['other_evaluator','eval',false]]){
   c.currentUser=user;c.currentRole=role;assert.equal(c.canUnlockCompletedRow({owner:'jorge_colunga'}),allowed,user);
 }
 let signal;
 const timeout=context(['fetchWithTimeout'],{SUPABASE_WRITE_TIMEOUT_MS:900,AbortController,setTimeout,clearTimeout,fetchSupabaseRestViaAppApiIfNeeded:async()=>null,window:{},fetch:(_u,init)=>{signal=init.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('abort'),{name:'AbortError'}))));}});
 await assert.rejects(timeout.fetchWithTimeout('https://test/storage',{method:'POST'},5,'Storage'),/timed out/);assert.equal(signal.aborted,true,'timeout closes the native fetch');
 let queued;const input={value:'',isConnected:true,setSelectionRange(){}};let dispatched=0,owner='one';const tap=context(['updateDetailMeasurementKeyboardTargetValue'],{detailMeasurementKeyboardTarget:input,activeItem:{UNIQUE_ID:'row'},getCompletedRowUnlockKey:()=> 'row',getSupabaseReadIdentityScope:()=>owner,setTimeout:fn=>{queued=fn;return 1;},clearTimeout(){},markDetailMeasurementKeyboardInteraction(){},normalizeDetailMeasurementKeyboardValueForInput:(_i,v)=>v,getNormalizedDetailMeasurementCursor:(...args)=>args[2],dispatchDetailMeasurementKeyboardInput(){dispatched++;},normalizeDetailSpecTextForSave:v=>v,document:{getElementById:()=>null}});tap.updateDetailMeasurementKeyboardTargetValue('24',2);assert.equal(input.value,'24');assert.equal(dispatched,0,'tap updates the value before background autosave');queued();assert.equal(dispatched,1);tap.updateDetailMeasurementKeyboardTargetValue('25',2);owner='two';queued();assert.equal(dispatched,1,'stale-account queued work cannot save');
 const docks=context(['getDockOwnedPhotoLinkCsv'],{window:{},getLinkedMasterPhotoState:()=>({photoCsv:'',photoNameCsv:''}),mergePhotoCsvList:xs=>xs.filter(Boolean).join(','),getSharedAppPhotoLinkCsvRaw:()=>'',getSharedAppPhotoName:()=>'',getDisplayPhotoLinkCsv:(csv,_i,_p,opts)=>{assert.equal(opts.respectRetention,false);return csv;}});assert.equal(docks.getDockOwnedPhotoLinkCsv({DOCK_PHOTO_LINK:'https://test/photos/2020-01-01.jpg'}),'https://test/photos/2020-01-01.jpg');
 let view='detail',notices=0;const runs=new Map();const noticesContext=context(['notifyManagerUnassignedItemsAfterSync'],{currentUser:'manager',getCurrentVisibleViewId:()=>view,getSupabaseReadIdentityScope:()=> 'manager',sessionStorage:{getItem:k=>runs.get(k),setItem:(k,v)=>runs.set(k,v)},notifyManagerUnassignedItems:()=>++notices});noticesContext.notifyManagerUnassignedItemsAfterSync('run');assert.equal(notices,0);view='home';noticesContext.notifyManagerUnassignedItemsAfterSync('run');noticesContext.notifyManagerUnassignedItemsAfterSync('run');assert.equal(notices,1);
 const revoked=[];const previews=new Map([['row::lsn',[{id:'preview',url:'blob:preview'}]]]);const cleanup=context(['clearPendingPhotoPreview'],{getPhotoBucketKeysForItem:()=>['lsn'],pendingPhotoPreviews:previews,URL:{revokeObjectURL:url=>revoked.push(url)}});cleanup.clearPendingPhotoPreview({UNIQUE_ID:'row'},'lsn-','preview');assert.equal(previews.size,0);assert.equal(revoked.length,0,'mounted preview is not revoked in the receipt turn');assert.deepEqual(revoked,[],'session-owned previews remain available to other mounted consumers');
 const calls=[];const file=new Blob([new Uint8Array([255,216,255,1])],{type:'image/jpeg'});
 class Reader {readAsDataURL(){this.result='data:image/jpeg;base64,/9j/AQ==';queueMicrotask(()=>this.onload());}}
 const upload=context(nativePhotoTransportFunctions,{Blob,TextEncoder,Uint8Array,crypto:webcrypto,FileReader:Reader,nativeAuthRecoveryEpoch:0,getSupabaseReadIdentityScope:()=> 'native-owner',getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer native'}),SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-']),PHOTO_BUCKETS:{'lsn-':'location_sales_notes_photos'},SUPABASE_URL:'https://test',APP_API_FUNCTION_URL:'https://test/functions/v1/app-api',fetchWithTimeout:async(url,init)=>{calls.push({url,init});return{ok:true,json:async()=>({id:'a'.repeat(64),receipt:{ok:true,row:{unique_id:'exact',date_completed:null}}})};}});
 const result=await upload.uploadDrivePhotoWithNativeSession(new Map([['prefix','lsn-'],['masterUid','exact'],['file',file]]),{attachPhoto:true,attachmentId:'unique-photo-job'});
 assert.equal(calls.length,1);assert.match(calls[0].url,/attach_drive_photo_blob_v1$/);assert.equal(JSON.parse(calls[0].init.body).p_workflow,'location');assert.equal(result.receipt.row.date_completed,null);assert.equal(result.receipt.writeConfirmed,true);
 const persist=functionSource('persistDrivePhotoAttachment');
  assert.ok(persist.indexOf('reconcileConfirmedDriveEvidence') < persist.indexOf('confirmRowPhotoSlot'));
  const slot={id:'preview',url:'blob:preview',status:'Uploading'}, jobs=new Map([['preview',{}]]);
  const receiptContext=context(['confirmRowPhotoSlot','verifyPublishedPhotoPreview'],{getSupabaseReadIdentityScope:()=>'fixture',getPendingPhotoPreviewEntries:()=>[slot],drivePhotoAttachments:jobs,refreshPendingPhotoUiForItem(){}});
  receiptContext.confirmRowPhotoSlot({id:'preview',item:{},prefix:'lsn-',upload:{publicUrl:'https://test/photo.jpg',fileName:'photo.jpg'}});
  assert.deepEqual(slot,{id:'preview',url:'blob:preview',status:'Uploaded',localPreviewUrl:'blob:preview',publicUrl:'https://test/photo.jpg',name:'photo.jpg'});
  assert.equal(jobs.size,0,'a receipt releases the job but keeps the displayed preview');
 const merge=functionSource('restoreDriveEvidenceEditor');assert.match(merge,/PHOTO_DATE/);assert.match(merge,/AV_RULE_PHOTO_UPDATED_AT/);
 const saved=functionSource('renderSavedPhotos');assert.match(saved,/✓ UPLOADED/);assert.ok(saved.includes('photoIndex + 1'));
}

