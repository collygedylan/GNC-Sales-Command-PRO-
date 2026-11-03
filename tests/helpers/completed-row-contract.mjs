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
 assert.equal(c.calculateLiveLocPhotoMatch({PTRONHAND:0,on_hand:51,MATCH:80,LOC_PHOTO_MATCH:0}),41);
 assert.equal(c.calculateLiveLocPhotoMatch({PTRONHAND:0,on_hand:51},{MATCH:80,LOC_PHOTO_MATCH:0}),41);
 assert.equal(c.calculateLiveLocPhotoMatch({available:750,onhand:1000,match_pct:50},{eval_baseline_available:1000,initial_loc_photo_match:500}),250);
 assert.equal(c.calculateLiveLocPhotoMatch({PTRAVAILABLE:438,PTRONHAND:543,MATCH:80}),329);
 assert.equal(c.calculateLiveLocPhotoMatch({available:200,onhand:1000,match_pct:50,eval_baseline_available:1000,initial_loc_photo_match:500}),0);
 assert.equal(c.calculateLiveLocPhotoMatch({available:0,onhand:1000,match_pct:50,eval_baseline_available:1000,initial_loc_photo_match:500}),0);
 assert.equal(c.calculateLiveLocPhotoMatch({available:1200,onhand:1200,match_pct:50,eval_baseline_available:1000,initial_loc_photo_match:500}),500);
}

export function completionLockContract(){
 const item={UNIQUE_ID:'one',DATE_COMPLETED:'2026-11-02T19:00:00Z'};
 const c=context(['isProtectedSectionLocked','isProtectedSectionCompleted','isProtectedUnlocked','getCompletedRowUnlockKey','canRemoveProtectedPhoto','canReorderProtectedPhoto'],{activeItem:item,protectedEditState:{},isRowPhotoEvaluationExpired:()=>false,firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),canEditRowDetails:()=>true,canUsePhotoDeleteOverride:()=>true,isDriveModePhotoDataEditContext:()=>true,sectionHasProtectedData:()=>true});
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
 const v=context(['updateDetailMeasurementKeyboardTargetValue'],{detailMeasurementKeyboardTarget:input,activeItem:{UNIQUE_ID:'row'},getCompletedRowUnlockKey:()=> 'row',getSupabaseReadIdentityScope:()=> 'actor',setTimeout:()=>0,clearTimeout(){},markDetailMeasurementKeyboardInteraction(){},normalizeDetailMeasurementKeyboardValueForInput:(_i,x)=>x,getNormalizedDetailMeasurementCursor:(_i,x,n)=>n,dispatchDetailMeasurementKeyboardInput(){},normalizeDetailSpecTextForSave:x=>x,document:{getElementById:()=>preview}});
 v.updateDetailMeasurementKeyboardTargetValue('24 HxW',6);assert.equal(input.value,'24 HxW');assert.equal(preview.textContent,'24 HxW');
}
export function optimisticCompletionContract(){
 const row={UNIQUE_ID:'one',PTRAVAILABLE:'1000',PTRONHAND:'1000',MATCH:'50'},sibling={UNIQUE_ID:'other',MATCH:'80'};
 let blur=0,lock=0;const c=context(['beginOptimisticCompletedRow','getCompletedRowUnlockKey','isCompletedInventoryRow'],{activeItem:row,fullInventory:[row,sibling],parseAppNumber:v=>v==null?null:Number(v),getCardPtrAvailableValue:r=>r.PTRAVAILABLE,firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),clearDetailMeasurementKeyboardKeepAlive(){},closeDetailMeasurementKeyboard(){},document:{querySelectorAll:selector=>selector==='input,textarea,[contenteditable="true"]'?[{blur(){blur++;}}]:[]},PROTECTED_EDIT_CONFIG:{'ssn-':{}},protectedEditState:{},applyProtectedEditState(){lock++;},refreshProtectedSections(){lock++;},showToast(){}});
 const payload={match:50},undo=c.beginOptimisticCompletedRow(row,'ssn-',payload);assert.equal(row.completed,true);assert.equal(row.initial_loc_photo_match,500);assert.equal(row.eval_baseline_available,1000);assert.equal(blur,1);assert.equal(lock,1);assert.equal(sibling.completed,undefined);
 undo();assert.equal(row.completed,undefined);assert.equal(row.DATE_COMPLETED,undefined);assert.equal(row.MATCH,'50','a failed save retains the evaluation draft');
}
export async function ownerAndSuspendContract(){
 const state={itemcodeDefaultOwners:[{itemcode_normalized:'003129.070.1',assignedto:'nelly_aguilar'}],defaultOwnersByCode:new Map()};
 const inventory=[{ITEMCODE:'004733.020.1',ASSIGNEDTO:'dylan_collyge'},{ITEMCODE:'003521.030.1',ASSIGNEDTO:'mitch'},
   {ITEMCODE:'003521.070.1',ASSIGNEDTO:'morgan'},{ITEMCODE:'009373.031.1',effective_worker:'megan_kelly'}];
 const c=context(['getCardEvalOwnerIndex','getSuspendEvalOwner','buildEvalOwnerBadge','applySuspendEvalUserFilter','buildSuspendEvalUserFilter'],{
   getManagerAssignedColumnState:()=>state,fullInventory:inventory,warehouseAssignedItemsInventory:[],masterInventoryByItemCode:new Map(),
   buildManagerEvalAssignmentKey:x=>String(x||'').trim().toUpperCase(),normalizeEvalAssignableUser:x=>String(x||'').trim().toLowerCase(),
   findLinkedMasterRow:()=>null,getMasterAssignedToValue:()=>'',escapeHtml:String,requestSuspendEvalUserFilter:'dylan_collyge',
   canUseRequestSuspendTagAssignedToFilter:()=>true,getManagerAssignableOwnerUsers:()=>[],getEvalAssignableUserLabel:String});
 const tag={itemcode:' 004733.020.1 ',ASSIGNEDTO:'stale'};
 for (const [row,owner] of [[tag,'dylan_collyge'],[{ITEMCODE:'003129.070.1'},'nelly_aguilar'],[{ITEMCODE:'009373.999.1'},'megan_kelly'],
   [{ITEMCODE:'003521.999.1'},''],[{ITEMCODE:'003521.030.1'},'mitch']]) {
   assert.equal(c.getSuspendEvalOwner(row),owner);
   assert.equal(c.buildEvalOwnerBadge(row),'<span class="card-eval-owner">EVAL: '+(owner||'Unassigned')+'</span>');
 }
 assert.deepEqual([...c.applySuspendEvalUserFilter([tag,{ITEMCODE:'003129.070.1'}])],[tag]);
 assert.match(c.buildSuspendEvalUserFilter([tag]),/dylan_collyge \(1\)/);
 state.defaultOwnersByCode=new Map([['004733.020.1',{assignedto:'new_owner',revision:2}]]);
 assert.equal(c.getSuspendEvalOwner(tag),'new_owner');
 state.defaultOwnersByCode=new Map([['004733.020.1',{assignedto:null,updated_by:'manager'}]]);
 assert.equal(c.getSuspendEvalOwner(tag),'');
 assert.match(functionSource('assignManagerCheckedItemcodes'),/assignEvalItemcodes/);
 assert.match(functionSource('assignEvalItemcodes'),/canManageEvalItemcodeAssignments/);
 assert.doesNotMatch(source,/aria-label="Reassign Eval owner"|data-eval-itemcode/);
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

export function inventoryScrollContract() {
 const state={touching:true,lastUserScrollAt:100}, scroller={scrollTop:427};
 let now=1800, pending, paints=0, scope='one';
 const c=context(['getInventoryListScrollDelay','deferInventoryListPaint'],{inventoryScrollState:state,
   activeReqTab:'suspend-tag',Date:{now:()=>now},getSupabaseReadIdentityScope:()=>scope,
   getCurrentVisibleViewId:()=> 'request',getMainAreaScrollTarget:()=>scroller,scheduleUiRender:(_k,fn)=>{pending=fn;}});
 for(const view of ['request','drive','av']) assert.equal(c.getInventoryListScrollDelay(view),600);
 assert.equal(c.deferInventoryListPaint('request','page',()=>{paints++;scroller.scrollTop=0;}),true);
 pending();assert.equal(paints,0);
 state.touching=false;state.lastUserScrollAt=now;now+=599;pending();assert.equal(paints,0);
 now++;pending();assert.equal(paints,1);assert.equal(scroller.scrollTop,427);
 state.touching=true;c.deferInventoryListPaint('request','page',()=>paints++);scope='two';pending();assert.equal(paints,1);
 const click=context(['beginFastPress','trackFastPressMove','finishFastPress','clearActiveFastPress'],{
   activeFastPress:null,getFastPressActionKey:()=> 'row',shouldIgnoreFastPressTarget:()=>false,
   dispatchFastPressAction:()=>{paints++;return true;},armFastPressGhostClickSuppression(){},armDriveDrillCardClickSuppression(){},
   getFastPressActionScope:()=>'',lastFastPressActionScope:'',FAST_PRESS_MOVE_THRESHOLD_PX:14});
 const pointer=(x,y)=>({pointerId:1,pointerType:'touch',clientX:x,clientY:y});
 for(const [x,y,opens] of [[7,7,true],[8,0,false],[0,-8,false]]) {
   const before=paints;click.beginFastPress(pointer(30,30),'card','drive','row');
   click.finishFastPress(pointer(30+x,30+y),'card','drive','row');assert.equal(paints-before,Number(opens));
 }
}
