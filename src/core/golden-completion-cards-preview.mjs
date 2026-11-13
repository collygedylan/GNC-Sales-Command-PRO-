import { checkPhotoPreview } from '../../tests/helpers/golden-completion-photo-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {parseExpressionAt} from 'acorn';
const read = file => process.env.AGDATA_TEST_REVISION ? execFileSync('git',['show',process.env.AGDATA_TEST_REVISION+':'+file],{encoding:'utf8',maxBuffer:24*1024*1024}) : fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const extract = (source,name) => { let at=source.indexOf('function '+name+'('); assert.ok(at>=0,name); if(source.slice(at-6,at)==='async ')at-=6; const node=parseExpressionAt(source,at,{ecmaVersion:'latest'}); return source.slice(node.start,node.end); };
const ticks = async () => { for(let n=0;n<8;n++) await Promise.resolve(); };
function checkCompletionReturn(runtime) {
  for(const origin of ['drive','av','request','tasks','docks','av-photo']) {
   let restored;const context={window:{},activeItem:{UNIQUE_ID:'exact'},lastView:origin,detailReturnState:{viewId:origin,scrollTop:714},detailHydrationToken:1,
    activeDetailSourceView:origin,isRequestDetailItem:()=>origin==='request',isDockSuspendDcRequestMirrorRow:()=>false,
    optimisticCompletedRowIds:new Set(),getItemUniqueId:item=>item.UNIQUE_ID,
    beginInternalPerfMeasure:()=>0,cancelDriveEvidenceSavesForItem:()=>{},teardownDetailPresentation:()=>{},clearPendingDetailHydration:()=>{},markDetailTransitionActivity:()=>{},setDetailEditingChromeState:()=>{},resetDetailOverviewFieldSearch:()=>{},getViewElementById:()=>({}),isTouchConstrainedDevice:()=>false,recordInternalPerfDuration:()=>{},fastBackToView:(view,options)=>{restored={view,top:options.targetScrollTop};}};
   vm.runInNewContext(extract(runtime,'goBackFromDetail'),context);context.goBackFromDetail();
   assert.deepEqual(restored,{view:origin,top:714});assert.equal(context.activeItem,null);
  }
}

async function checkSuspendReceipt(runtime) {
  for(const fail of [false,true]) {
   let settle,closed=0;const toasts=[],row={UNIQUE_ID:'tag',dock_spec:'before',DOCK_SPEC:'before',suspend:'SUSPEND'},promise=new Promise((resolve,reject)=>{settle=fail?reject:resolve});
   const c={activeItem:row,detailReturnState:{viewId:'docks',scrollTop:714},getSupabaseReadIdentityScope:()=>'owner',isDockSuspendDcRequestMirrorRow:()=>true,
    canUseProductionLiveSync:()=>false,getDockSuspendDcRequestFormValues:()=>({spec:'after',caliper:'2',avNote:'note',pick:'pick',comments:'comment',match:''}),
    canCurrentUserViewDockSuspendDcRequests:()=>true,requireCurrentSuspendTagWriteProof:()=>true,getSuspendTagStatus:()=>'',canCurrentUserWorkRequestItem:()=>true,
    document:{getElementById:()=>null},readRowEvaluationDraft:()=>({}),getDockSuspendDcRequestSourceUid:r=>r?.UNIQUE_ID,isViewVisible:()=>true,
    findDockSuspendDcRequestSourceRow:()=>row,getPendingPhotoUploadsForItem:()=>[],syncDockSuspendDcRequestPhotoAliases:()=>{},restoreCapturedPhotoFields:()=>{},mergeActiveItemDetailPhotoFields:()=>{},applyExplicitAvNotePayload:()=>{},mergePhotoCsvList:()=>'',buildDockSuspendDcRequestNote:()=>'',firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),getSuspendTagFormDraftKey:()=> 'tag',
    publishRowEvaluationToMasterAndNotes:(target,patch,options)=>{assert.equal(target,row);assert.equal(options.suspendCompletionScope,'owner');assert.equal(patch.dock_spec,'after');return promise;},
    goBackFromDetail:()=>{closed++;c.activeItem=null;},showToast:(...args)=>toasts.push(args),suspendTagFormDrafts:new Map(),restoreSuspendTagFormDraft:()=>{},clearSavedRowEvaluationDraft:()=>{},scheduleRequestRender:()=>{},suspendTagErrorMessage:e=>e.message};
   const domain = runtime.includes('@runtime-fragment assets/suspend-detail-save-domain.js') ? read('assets/suspend-detail-save-domain.js') : extract(runtime,'saveDockSuspendDcRequestMirrorData');
   vm.runInNewContext(domain,c);
   const pending=c.saveDockSuspendDcRequestMirrorData(true,row);await ticks();
   assert.equal(closed,1,'Suspend returns while receipt is pending');assert.equal(row.dock_spec,'after');assert.equal(row.suspend,'SUSPEND');assert.equal(row.completed,undefined);
   assert.ok(!toasts.some(t=>t[0]==='Success'));
   settle(fail?new Error('offline'):true);await pending;
   assert.equal(row.dock_spec,fail?'before':'after');assert.equal(toasts.some(t=>t[0]==='Success'),!fail);
  }
}

async function checkEvalWorkReceipt(runtime) {
  for(const fail of [false,true]) {
   let settle,closed=0;const toasts=[],work={id:'work',version:1},origin={origin_unique_id:'one'},pending=new Promise(resolve=>{settle=resolve});
   const c={getSupabaseReadIdentityScope:()=> 'owner',prepareMarkDoneCompletionPrompt:()=>({}),openMarkDoneConfirmModal:async()=>true,
    getPhotoUrlList:()=>[],buildSecureDriveEvidenceBaseline:()=>({}),beginRowEvaluationMemoryPublication:()=>()=>{},publishRowEvaluationToMasterAndNotes:async()=>true,
    activeEvalWorkDetailId:'work',evalWorkActiveOriginUid:'one',evalWorkEvidenceByOrigin:{},getEvalWorkById:()=>work,getEvalWorkOriginEntries:()=>[origin],getArgosReclassLiveEditIdentityKey:()=>'owner',getPendingPhotoUploadsForItem:()=>[],evalPhotoRow:()=>({}),collectEvalWorkEvidence:()=>({spec:'saved',photos:[]}),validateEvalWorkPicturesSpecsEvidence:()=>{},getEvalWorkOriginSourceRow:()=>({}),collectEvalWorkInquiryPayload:()=>({}),collectEvalWorkEvidenceByOrigin:()=>({one:{picturesSpecsResolution:'done'}}),persistEvalWorkLocalDraft:()=>{},getEvalWorkInquiryResolutionProgress:()=>({total:2,remaining:1}),getEvalWorkPicturesSpecsProgress:()=>({total:2,remaining:1}),
    saveEvalWorkDraft:(...args)=>{const options=args[2];assert.equal(options.snapshot.work,work);assert.equal(options.snapshot.evidence.picturesSpecsResolution,'done');return pending;},closeEvalWorkDetail:()=>{closed++;c.activeEvalWorkDetailId='';c.evalWorkActiveOriginUid='';},showToast:(...args)=>toasts.push(args),scheduleRequestRender:()=>{}};
   vm.runInNewContext(extract(runtime,'markEvalWorkPicturesSpecsDone'),c);const saving=c.markEvalWorkPicturesSpecsDone();await ticks();assert.equal(closed,1);assert.ok(!toasts.some(t=>t[0]==='Success'));settle(!fail);await saving;assert.equal(toasts.some(t=>t[0]==='Success'),!fail);
  }
}

async function checkEvalWorkSubmission(runtime) {
  for(const stale of [false,true]) {
   let settle,requests=0;const work={id:'work',version:1},toasts=[];
   const c={activeEvalWorkDetailId:'another-editor',evalWorkDetailGeneration:2,evalWorkSubmitToken:null,evalWorkSubmitInFlight:false,evalWorkAutoSubmitting:false,identity:'owner',getEvalWorkById:id=>id==='work'?work:null,getArgosReclassLiveEditIdentityKey:()=>c.identity,
    validateEvalWorkInquiryRowResolutions:()=>({total:1,done:1,noAction:0}),getEvalWorkOriginEntries:()=>[],validateEvalWorkPicturesSpecsEvidence:()=>{},getEvalWorkOriginSourceRow:()=>({}),firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),persistEvalWorkLocalDraft:()=>{},runInventoryStatusMutation:(...args)=>args[1](),evalWorkApi:()=>{requests++;return new Promise(resolve=>{settle=resolve;});},RECLASS_ACTION_WORKFLOW_V6_POLICY_VERSION:'v6',RECLASS_ACTION_WORKFLOW_V7_POLICY_VERSION:'v7',applyEvalWorkEvidenceLocally:async()=>true,clearEvalWorkLocalDraft:()=>{},showToast:(...args)=>toasts.push(args),getEvalWorkCompletionRecipientCopy:()=> 'reviewers',loadEvalWorkAssignments:async()=>{},queueVisibleDatasetCatchup:()=>{}};
   vm.runInNewContext(extract(runtime,'submitEvalWork'),c);
   const snapshot={work,identityKey:'owner',inquiry:{workflowPolicyVersion:'v5'},evidence:{picturesSpecsResolution:'done'},evidenceByOrigin:null};
   const saving=c.submitEvalWork(null,{automatic:true,snapshot});assert.equal(requests,1);
   if(stale)c.identity='other-account';settle({data:{status:'submitted'}});await saving;
   assert.equal(work.status,stale?undefined:'submitted');assert.equal(c.activeEvalWorkDetailId,'another-editor');assert.equal(toasts.some(t=>t[0]==='Success'),!stale);
  }
}


export async function assertCompletionCardsContract() {
  const runtime=read('assets/app-runtime.js'), workflow=read('assets/row-workflow-functions.js');
  const save=extract(runtime,'persistConfirmedRowEvaluation');
  assert.ok(!save.includes('keepCompletedDetail'),'MARK DONE must not keep an editor open');
  assert.ok(!save.includes('openDetail(nextRequestId') && !save.includes('openDetail(nextTaskId'),'receipt must not open another editor');
  assert.ok(save.indexOf('goBackFromDetail();',save.indexOf('completionArtifacts = buildCompletionArtifacts();')) < save.lastIndexOf('await persistSave();'));
  checkCompletionReturn(runtime);
  await checkSuspendReceipt(runtime);
  await checkEvalWorkReceipt(runtime);
  await checkEvalWorkSubmission(runtime);
  checkPhotoPreview(runtime, workflow, extract);
  const css=read('assets/ops-precision-pilot.css');for(const rule of ['white-space: nowrap','word-break: keep-all','overflow-wrap: normal','font-size: 11px','padding: 4px 8px'])assert.ok(css.includes(rule),rule);
}

