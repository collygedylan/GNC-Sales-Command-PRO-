import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import {readComposedRuntimeSource} from '../../scripts/composed-app-source.mjs';
const source=readComposedRuntimeSource(), functions=new Map();
walk.simple(acorn.parse(source,{ecmaVersion:'latest'}),{FunctionDeclaration(n){functions.set(n.id.name,source.slice(n.start,n.end));}});
export const functionSource=name=>{assert.ok(functions.has(name),name);return functions.get(name);};
const context=(names,values={})=>{const c=vm.createContext(values);vm.runInContext(names.map(functionSource).join('\n'),c);return c;};
export function depletionContract(){
 const c=context(['calculateLiveLocPhotoMatch']);
 assert.equal(c.calculateLiveLocPhotoMatch({available:750,onhand:1000,match_pct:50},{eval_baseline_available:1000,initial_loc_photo_match:500}),250);
 assert.equal(c.calculateLiveLocPhotoMatch({PTRAVAILABLE:438,PTRONHAND:543,MATCH:80}),329);
 assert.equal(c.calculateLiveLocPhotoMatch({available:200,onhand:1000,match_pct:50,eval_baseline_available:1000,initial_loc_photo_match:500}),0);
 assert.equal(c.calculateLiveLocPhotoMatch({available:0,onhand:1000,match_pct:50,eval_baseline_available:1000,initial_loc_photo_match:500}),0);
 assert.equal(c.calculateLiveLocPhotoMatch({available:1200,onhand:1200,match_pct:50,eval_baseline_available:1000,initial_loc_photo_match:500}),500);
}

export function completionLockContract(){
 const item={UNIQUE_ID:'one',DATE_COMPLETED:'2026-11-02T19:00:00Z'};
 const c=context(['isProtectedSectionLocked','isProtectedSectionCompleted','isProtectedUnlocked','getCompletedRowUnlockKey','canRemoveProtectedPhoto','canReorderProtectedPhoto'],{activeItem:item,protectedEditState:{},firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),canEditRowDetails:()=>true,canUsePhotoDeleteOverride:()=>true,isDriveModePhotoDataEditContext:()=>true,sectionHasProtectedData:()=>true});
 assert.equal(c.isProtectedSectionLocked('ssn-'),true,'administrators lock after completion');
 assert.equal(c.canRemoveProtectedPhoto('ssn-'),false,'photo override does not bypass completion');
 assert.equal(c.canReorderProtectedPhoto('ssn-'),false);
 c.protectedEditState['ssn-']='one';assert.equal(c.isProtectedUnlocked('ssn-'),true);assert.equal(c.canRemoveProtectedPhoto('ssn-'),true);assert.equal(c.canReorderProtectedPhoto('ssn-'),true);
 c.activeItem={UNIQUE_ID:'two',DATE_COMPLETED:item.DATE_COMPLETED};assert.equal(c.isProtectedUnlocked('ssn-'),false,'unlock cannot bleed to another row');
 c.canEditRowDetails=()=>false;assert.equal(c.canReorderProtectedPhoto('ssn-'),false);
 assert.equal(c.isProtectedSectionLocked('req-'),false,'pending Request editing retains its separate contract');
}
export function fixedKeypadContract(){
 const c=context(['getDetailMeasurementKeyboardKeys'],{detailMeasurementKeyboardAvNoteMode:'letters'});
 for(const type of ['spec','caliper'])assert.ok(c.getDetailMeasurementKeyboardKeys(type).every(k=>k.action!=='choice'));
 const render=functionSource('renderDetailMeasurementKeyboard');for(const token of ['double_quote','apostrophe','HxW'])assert.ok(render.includes(token));
 assert.ok(!functionSource('updateDetailMeasurementKeyboardTargetValue').includes('renderDetail'));
 let preview={textContent:''},input={value:'',setSelectionRange(){}};
 const v=context(['updateDetailMeasurementKeyboardTargetValue'],{detailMeasurementKeyboardTarget:input,markDetailMeasurementKeyboardInteraction(){},normalizeDetailMeasurementKeyboardValueForInput:(_i,x)=>x,getNormalizedDetailMeasurementCursor:(_i,x,n)=>n,dispatchDetailMeasurementKeyboardInput(){},normalizeDetailSpecTextForSave:x=>x,document:{getElementById:()=>preview}});
 v.updateDetailMeasurementKeyboardTargetValue('24 HxW',6);assert.equal(input.value,'24 HxW');assert.equal(preview.textContent,'24 HxW');
}
export function optimisticCompletionContract(){
 const row={UNIQUE_ID:'one',PTRAVAILABLE:'1000',PTRONHAND:'1000',MATCH:'50'},sibling={UNIQUE_ID:'other',MATCH:'80'};
 let blur=0,lock=0;const c=context(['beginOptimisticCompletedRow','getCompletedRowUnlockKey','isCompletedInventoryRow'],{activeItem:row,fullInventory:[row,sibling],parseAppNumber:v=>v==null?null:Number(v),getCardPtrAvailableValue:r=>r.PTRAVAILABLE,firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),clearDetailMeasurementKeyboardKeepAlive(){},closeDetailMeasurementKeyboard(){},document:{querySelectorAll:selector=>selector==='input,textarea,[contenteditable="true"]'?[{blur(){blur++;}}]:[]},PROTECTED_EDIT_CONFIG:{'ssn-':{}},protectedEditState:{},applyProtectedEditState(){lock++;},refreshProtectedSections(){lock++;},showToast(){}});
 const payload={match:50},undo=c.beginOptimisticCompletedRow(row,'ssn-',payload);assert.equal(row.completed,true);assert.equal(row.initial_loc_photo_match,500);assert.equal(row.eval_baseline_available,1000);assert.equal(blur,1);assert.equal(lock,1);assert.equal(sibling.completed,undefined);
 undo();assert.equal(row.completed,undefined);assert.equal(row.DATE_COMPLETED,undefined);assert.equal(row.MATCH,'50','a failed save retains the evaluation draft');
}
export async function ownerAndSuspendContract(){
 let calls=[];const c=context(['reassignItemcodesToUser','getSuspendEvalOwner'],{assignEvalItemcodes:(...a)=>calls.push(a),findLinkedMasterRow:()=>({EFFECTIVE_WORKER:'nelly_aguilar'}),getMasterAssignedToValue:()=>'',normalizeEvalAssignableUser:v=>v});
 c.reassignItemcodesToUser(['A','B'],'megan_kelly');assert.deepEqual(JSON.parse(JSON.stringify(calls)),[[['A','B'],'megan_kelly']]);assert.equal(c.getSuspendEvalOwner({ASSIGNEDTO:'sales_rep'}),'nelly_aguilar','Eval filter must use inventory owner, not tag sales rep');
 const mirror=functionSource('mirrorConfirmedItemcodeOwners');assert.match(mirror,/resolution=ignore-duplicates/);assert.match(mirror,/getNativeAuthRequestHeaders/);assert.match(mirror,/getSupabaseReadIdentityScope/);
}

export function rowCapabilityInitializationContract(){
 const c=context(['canUserMakeLiveChangesOnRow'],{normalizeLiveChangeUsername:v=>v,resolveUserAccessMatrix:()=>({edit_any_row:'Y'}),currentUser:'dylan_collyge',currentUserDisplay:'Dylan'});
 assert.equal(c.canUserMakeLiveChangesOnRow('dylan_collyge',{UNIQUE_ID:'one'}),true);
 c.resolveUserAccessMatrix=()=>({edit_any_row:'N',edit_assigned_rows_only:'N',verified:true});assert.equal(c.canUserMakeLiveChangesOnRow('rep',{UNIQUE_ID:'one'}),false);
 c.resolveUserAccessMatrix=()=>({edit_any_row:'N',edit_assigned_rows_only:'Y',verified:true});c.isRowAssignedToUser=(_u,r)=>r.UNIQUE_ID==='one';assert.equal(c.canUserMakeLiveChangesOnRow('eval',{UNIQUE_ID:'one'}),true);assert.equal(c.canUserMakeLiveChangesOnRow('eval',{UNIQUE_ID:'two'}),false);
}

export function keyboardCloseDoesNotMeasureContract(){
 const events=[];const c=context(['clearDetailMeasurementKeyboardLayout'],{document:{documentElement:{style:{setProperty:(name,value)=>events.push([name,value])}},body:{classList:{remove:name=>events.push(name)}}},scheduleStickyRailOffsetSync:(reason,force)=>{assert.equal(force,true,'keyboard teardown must enqueue layout without measuring synchronously');events.push(reason);}});c.clearDetailMeasurementKeyboardLayout();assert.deepEqual(events,[['--detail-keyboard-height','0px'],'measurement-keyboard-open','measurement-keyboard-close']);
}
