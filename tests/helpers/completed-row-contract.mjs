import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import {readComposedRuntimeSource} from '../../scripts/composed-app-source.mjs';
const source=readComposedRuntimeSource(), functions=new Map();
for (const text of [source,readFileSync(new URL('../../assets/dock-order-domain.js',import.meta.url),'utf8')]) {
 walk.simple(acorn.parse(text,{ecmaVersion:'latest'}),{FunctionDeclaration(n){functions.set(n.id.name,text.slice(n.start,n.end));}});
}
export const functionSource=name=>{assert.ok(functions.has(name),name);return functions.get(name);};
const context=(names,values={})=>{const c=vm.createContext(values);vm.runInContext(names.map(functionSource).join('\n'),c);return c;};
export function depletionContract(){
 const c=context(['calculateLiveLocPhotoMatch']);
 assert.equal(c.calculateLiveLocPhotoMatch({PTRONHAND:0,on_hand:51,MATCH:80,LOC_PHOTO_MATCH:0}),0);
 assert.equal(c.calculateLiveLocPhotoMatch({PTRONHAND:0,on_hand:51},{MATCH:80,LOC_PHOTO_MATCH:0}),0);
 assert.equal(c.calculateLiveLocPhotoMatch({on_hand:51,MATCH:80,LOC_PHOTO_MATCH:0}),41);
 assert.equal(c.calculateLiveLocPhotoMatch({available:750,onhand:1000,match_pct:50},{eval_baseline_available:1000,initial_loc_photo_match:500}),250);
 assert.equal(c.calculateLiveLocPhotoMatch({PTRAVAILABLE:438,PTRONHAND:543,MATCH:80}),329);
 assert.equal(c.calculateLiveLocPhotoMatch({available:200,onhand:1000,match_pct:50,eval_baseline_available:1000,initial_loc_photo_match:500}),0);
 assert.equal(c.calculateLiveLocPhotoMatch({available:0,onhand:1000,match_pct:50,eval_baseline_available:1000,initial_loc_photo_match:500}),0);
 assert.equal(c.calculateLiveLocPhotoMatch({available:1200,onhand:1200,match_pct:50,eval_baseline_available:1000,initial_loc_photo_match:500}),500);
}

export function completionLockContract(){
 const item={UNIQUE_ID:'one',DATE_COMPLETED:'2026-11-02T19:00:00Z',PHOTO_LINK:'https://fixture/photo.jpg',LOC_PHOTO_MATCH:5,PTRONHAND:5,MATCH:100};
 const c=context(['hasLockableInventoryEvidence','calculateLiveLocPhotoMatch','isProtectedSectionLocked','isProtectedSectionCompleted','isProtectedUnlocked','getCompletedRowUnlockKey','canRemoveProtectedPhoto','canReorderProtectedPhoto'],{isAvDetailReadOnlyContext:()=>false,getPhotoUrlList:v=>String(v||'').split(',').filter(Boolean),activeItem:item,protectedEditState:{},isRowPhotoEvaluationExpired:()=>false,firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),currentUser:'evaluator',resolveCanonicalRowAccess:()=>({canEditAnyRow:false}),getVisiblePhotoLinkCsvForPrefix:()=>item.PHOTO_LINK,canEditRowDetails:()=>true,canUsePhotoDeleteOverride:()=>true,isDriveModePhotoDataEditContext:()=>true,sectionHasProtectedData:()=>true});
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
 let blur=0,lock=0;const c=context(['beginOptimisticCompletedRow','restoreOptimisticCompletedFields','getEditorLocMatchQtyValue','getCompletedRowUnlockKey','isCompletedInventoryRow'],{activeItem:row,fullInventory:[row,sibling],masterInventoryById:new Map([['one',row],['other',sibling]]),getManagerAssignedColumnState:()=>({}),parseAppNumber:v=>v==null?null:Number(v),getCardPtrAvailableValue:r=>r.PTRAVAILABLE,firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!==''),clearDetailMeasurementKeyboardKeepAlive(){},closeDetailMeasurementKeyboard(){},document:{querySelectorAll:selector=>selector==='input,textarea,[contenteditable="true"]'?[{blur(){blur++;}}]:[]},PROTECTED_EDIT_CONFIG:{'ssn-':{}},protectedEditState:{},applyProtectedEditState(){lock++;},refreshProtectedSections(){lock++;},showToast(){}});
 vm.runInContext(readFileSync(new URL('../../assets/canonical-inventory-evidence.js',import.meta.url),'utf8'),c);
 const payload={match:50},undo=c.beginOptimisticCompletedRow(row,'ssn-',payload);assert.equal(row.completed,true);assert.equal(row.initial_loc_photo_match,500);assert.equal(row.eval_baseline_available,1000);assert.equal(blur,1);assert.equal(lock,1);assert.equal(sibling.completed,undefined);
 undo();assert.equal(row.completed,undefined);assert.equal(row.DATE_COMPLETED,undefined);assert.equal(row.MATCH,'50','a failed save retains the evaluation draft');
}
const SUSPEND_ROSTER_FIXTURE=["dylan_collyge","megan_kelly","jd_jones","abigail_vazquez","bobby_adair","charley_robertson","chris_fisher","jorge_colunga","kayla_knepp","zoe_green","mitch_kaiser","nelly_aguilar","morgan_anderson","josh_cantu","todd_dowty"];
function assertSuspendOwnerOptions(html) {
 for(const [label,count] of [['All Users',3],['Unassigned',1],['other_owner',1],['nelly_aguilar',1]]) assert.ok(html.includes(label+' ('+count+')'),label);
 for (const user of SUSPEND_ROSTER_FIXTURE.filter(user=>user!=='nelly_aguilar')) assert.ok(!html.includes('value="'+user+'"'));
}
export async function ownerAndSuspendContract(){
 const state = {itemcodeDefaultOwners:new Map([['003129.070.1',{assignedto:'nelly_aguilar'}]])};
 const inventory = [{ITEMCODE:'003129.070.1',default_owner:'wrong'}, {ITEMCODE:'004733.020.1',default_owner:'dylan_collyge',effective_worker:'wrong'},
   {ITEMCODE:'003521.030.1',eval_user:'charlie_robertson'}, {ITEMCODE:'003521.050.1',default_owner:'charley_robertson'},
   ...Array(8).fill({ITEMCODE:'003521.070.1',default_owner:'mitch_kaiser'})];
 state.fullInventory=inventory;
 const c=context(['normalizeEvalAssignableUser','getCardEvalOwnerIndex','buildEvalOwnerBadge',
   'firstDockNonEmpty','firstDockValue','normalizeDockViewDockKey','normalizeDockSuspendRequestValue','getDockSuspendValue','isDockSuspendDcRequestMirrorRow','queueAccessScope','getQueueScopeFilter','getSuspendEvalUserFilter','applySuspendEvalUserFilter','getAssignedQueueOwner','isQueueOwnerVisible','buildSuspendEvalUserFilter','setSuspendEvalUserFilter','canUseRequestSuspendTagAssignedToFilter','canReadSuspendQueue'],{
   getManagerAssignedColumnState:()=>state, fullInventory:inventory, getSupabaseReadIdentityScope:()=>'session:'+c.currentUser,
   buildManagerEvalAssignmentKey:x=>String(x||'').trim().toUpperCase(), EVAL_TASK_USER_ALIASES:{charlie_robertson:'charley_robertson',kayla_knapp:'kayla_knepp',abigail_vasquez:'abigail_vazquez'},
   isDockSuspendDcRequestSource:r=>r?.suspend==='SUSPEND', getDockSuspendToValue:r=>r?.suspend_to,
   currentUser:'dylan_collyge', activeReqTab:'suspend-tag', requestSuspendEvalUserFilter:'ALL', suspendEvalFilterScope:'', SUSPEND_EVAL_ROSTER:SUSPEND_ROSTER_FIXTURE,
   isAuthenticatedExecutiveUser:()=>false, canAccessView:()=>true, escapeHtml:String, markViewDirty(){},renderRequest(){},paintFooterRequestBadgeOnly(){},requestScopedItemsCacheKey:''});
 vm.runInContext(readFileSync(new URL('../../assets/suspend-exact-owner.js',import.meta.url),'utf8'),c);
 const tag={itemcode:' 004733.020.1 ',eval_user:'stale'};
 for (const [row,owner] of [[tag,'dylan_collyge'],[{ITEMCODE:'003129.070.1'},'nelly_aguilar'],[{ITEMCODE:'003521.999.1'},'charley_robertson'],
   [{ITEMCODE:'999999',assigned_user:'abigail_vasquez'},'abigail_vazquez'],[{eval_user:'kayla_knapp'},'kayla_knepp'],
   [{suspend:'SUSPEND',suspend_to:'AV'},'Unassigned'],[{suspend:'SUSPEND',suspend_to:'mk'},'Unassigned'],
   [{suspend:'SUSPEND',suspend_to:'av',ITEMCODE:'003129.070.1'},'nelly_aguilar'],[{},'Unassigned']]) {
   assert.equal(c.resolveSuspendOwner(row),owner);
   assert.equal(c.buildEvalOwnerBadge(row),'<span class="card-eval-owner">EVAL: '+owner+'</span>');
 }
 for(const actor of SUSPEND_ROSTER_FIXTURE) {
   c.currentUser=actor;
   c.currentRole=SUSPEND_ROSTER_FIXTURE.slice(0,3).includes(actor)?'ADMIN':'EVAL';
   assert.equal(c.canReadSuspendQueue(),true);
   assert.equal(c.getSuspendEvalUserFilter(),c.currentRole==='ADMIN'?'ALL':actor);
   c.setSuspendEvalUserFilter('ALL');
   if(SUSPEND_ROSTER_FIXTURE.slice(0,3).includes(actor)) {
     assert.equal(c.getSuspendEvalUserFilter(),'ALL');
     const tags = [{suspend:'SUSPEND',ITEMCODE:'003129.070.1'}, {suspend:'SUSPEND'}, {suspend:'SUSPEND',suspend_eval_owner:'other_owner'}];
     const html=c.buildSuspendEvalUserFilter(tags);
     assertSuspendOwnerOptions(html);
     c.setSuspendEvalUserFilter('nelly_aguilar');
     const assigned = {ITEMCODE:'003129.070.1'};
     assert.deepEqual([...c.applySuspendEvalUserFilter([assigned,tag,{}])],[assigned]);
   } else {assert.equal(c.getSuspendEvalUserFilter(),actor);assert.equal(c.buildSuspendEvalUserFilter([tag]),'');assert.equal(c.applySuspendEvalUserFilter([tag]).length,0);}
 }
 c.isAuthenticatedExecutiveUser=()=>true;c.setSuspendEvalUserFilter('ALL');assert.equal(c.getSuspendEvalUserFilter(),'todd_dowty','non-admins cannot switch to another Suspend owner');
 state.itemcodeDefaultOwners=new Map([['004733.020.1',{assignedto:'new_owner',revision:2}]]);
 assert.equal(c.resolveSuspendOwner(tag),'new_owner');
 state.itemcodeDefaultOwners=new Map();state.fullInventory=[];assert.equal(c.resolveSuspendOwner({}),'Unassigned');
 assert.match(functionSource('assignManagerCheckedItemcodes'),/assignEvalItemcodes/);
 assert.match(functionSource('assignEvalItemcodes'),/canManageEvalItemcodeAssignments/);
 assert.doesNotMatch(source,/aria-label="Reassign Eval owner"|data-eval-itemcode/);
 const mirror=functionSource('mirrorConfirmedItemcodeOwners');assert.match(mirror,/resolution=ignore-duplicates/);assert.match(mirror,/getNativeAuthRequestHeaders/);assert.match(mirror,/getSupabaseReadIdentityScope/);
}

export function rowCapabilityInitializationContract(){
 const matrix={verified:true,profile_id:'profile',edit_any_row:'Y',view_permissions:{view_drive_mode:'Y'}};
 const c=context(['canUserMakeLiveChangesOnRow','canUserEditRow'],{resolveUserAccessMatrix:()=>matrix,currentUser:'dylan_collyge',currentUserDisplay:'Dylan',currentRole:'super-admin',nativeAuthSessionActive:true,nativeAuthSessionUserId:'profile',nativeAuthProfile:{id:'profile',username:'dylan_collyge'}});
 vm.runInContext(readFileSync(new URL('../../assets/row-access-policy.js',import.meta.url),'utf8'),c);
 assert.equal(c.canUserMakeLiveChangesOnRow('dylan_collyge',{UNIQUE_ID:'one'}),true);
 matrix.edit_any_row='N';c.currentUser=c.nativeAuthProfile.username='rep';assert.equal(c.canUserMakeLiveChangesOnRow('rep',{UNIQUE_ID:'one'}),false);
 matrix.edit_assigned_rows_only='Y';c.currentUser=c.nativeAuthProfile.username='eval';c.resolveInventoryRowOwner=r=>r.UNIQUE_ID==='one'?'eval':'other';
 assert.equal(c.canUserMakeLiveChangesOnRow('eval',{UNIQUE_ID:'one'}),true);assert.equal(c.canUserMakeLiveChangesOnRow('eval',{UNIQUE_ID:'two'}),false);
}

export function keyboardCloseDoesNotMeasureContract(){
 const events=[];const c=context(['clearDetailMeasurementKeyboardLayout'],{document:{documentElement:{style:{setProperty:(name,value)=>events.push([name,value])}},body:{classList:{remove:name=>events.push(name)}}},scheduleStickyRailOffsetSync:(reason,force)=>{assert.equal(force,true,'keyboard teardown must enqueue layout without measuring synchronously');events.push(reason);}});c.clearDetailMeasurementKeyboardLayout();assert.deepEqual(events,[['--detail-keyboard-height','0px'],'measurement-keyboard-open','measurement-keyboard-close']);
}

export function inventoryScrollContract() {
 const c=context(['buildFastPressAttrs'],{esc:String,encodeFastPressArgs:JSON.stringify});
 for(const [kind,action] of [['card','drive'],['card','av'],['invoke','openDockSuspendDcRequestUpdate']]){
   const attrs=c.buildFastPressAttrs(kind,action,[],'Open');
   assert.match(attrs,/onclick=/);assert.match(attrs,/onkeydown=/);assert.doesNotMatch(attrs,/on(?:pointer|touch|wheel)/);
 }
 assert.doesNotMatch(source,/trackInventoryListTouches|getInventoryListScrollDelay|deferInventoryListPaint/);
 const scroller={scrollTop:427},win={scrollY:51,scrollX:0,scrollTo(x,y){this.scrollY=y;}};
 const paint=context(['preserveInventoryScrollPosition'],{getMainAreaScrollTarget:()=>scroller,window:win});
 let painted=0;paint.preserveInventoryScrollPosition(()=>{painted++;scroller.scrollTop=0;win.scrollY=0;});
 assert.equal(painted,1);assert.equal(scroller.scrollTop,427);assert.equal(win.scrollY,51);
}

export async function suspendOwnerHydrationContract(){
 let currentState={}, scope='first', complete, paints=0, reads=0;
 const c=context(['loadManagerItemcodeDefaultOwners','getCardEvalOwnerIndex'],{normalizeEvalAssignableUser:v=>v,
   getManagerAssignedColumnState:()=>currentState, getSupabaseReadIdentityScope:()=>scope,
   fetchAllSupabaseRows:(table,query)=>{assert.equal(table,'ph_itemcode_default_owners');assert.match(query,/order=itemcode_normalized.asc/);reads++;return new Promise(resolve=>{complete=resolve;});},
   buildManagerEvalAssignmentKey:s=>s.trim().toUpperCase(),refreshSuspendOwnerViews:()=>paints++,isViewVisible:()=>false
 });
 const stale=c.loadManagerItemcodeDefaultOwners();
 currentState={};scope='next';complete([{itemcode_normalized:'old',assignedto:'old'}]);await stale;
 assert.equal(currentState.itemcodeDefaultOwners,undefined);assert.equal(paints,0);
 const load=c.loadManagerItemcodeDefaultOwners();const concurrent=c.loadManagerItemcodeDefaultOwners();assert.equal(reads,2);
 complete([{itemcode_normalized:'001234.01',assignedto:'abigail_vazquez'}]);await Promise.all([load,concurrent]);
 assert.equal(currentState.itemcodeDefaultOwners.get('001234.01').assignedto,'abigail_vazquez');assert.equal(paints,1);
 assert.match(functionSource('finalizeLogin'),/void loadManagerItemcodeDefaultOwners\(\)/);
 assert.match(functionSource('refreshSuspendOwnerViews'),/scheduleHydratedViewRender\('request'\)/);
}

export async function allSuspendDestinationsContract(){
 const eligibility=context(['firstDockNonEmpty','firstDockValue','normalizeDockViewDockKey','normalizeDockViewStopKey','getDockOrderBusinessKey','isDockSuspendDcRequestSource','getLatestSocSuspendTagSourceRows','uniquePhysicalSuspendTags','getPhysicalSuspendTagKey','getDockSuspendDcRequestSourceUid'],{firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!=='')||'',
   getDockSuspendValue:r=>String(r?.suspend||'').trim().toUpperCase(),getDockSuspendToValue:r=>r?.suspend_to,socRawSourceRows:[]
 });
 const destinations=['dc','ms','av','ba','cr','jc','zg','mk','dan','ew',''];
 const rows=destinations.map((suspend_to,i)=>({unique_id:'tag-'+i,itemcode:'same',dock:'1',suspend:' SUSPEND ',suspend_to}));
 const ordinary={unique_id:'ordinary',suspend:'HOLD',suspend_to:'dc'};
 assert.deepEqual([...eligibility.getLatestSocSuspendTagSourceRows([...rows,ordinary],[],{})],rows);
 const {shouldIncludeSocLiveRow}=await import('../../scripts/fast-live-erp-sync.mjs');
 for(const row of rows)assert.ok(shouldIncludeSocLiveRow(row),'undocked '+row.suspend_to);
 assert.equal(shouldIncludeSocLiveRow(ordinary),false);
 const edge=await (await import('node:fs/promises')).readFile(new URL('../../supabase/functions/app-api/index.ts',import.meta.url),'utf8');
 assert.doesNotMatch(edge,/query\.append\("suspend_to", "eq\.dc"\)/);
}

export function liveQueueAssignmentContract() {
  const state = {itemcodeDefaultOwners: new Map([
    ['004110.070.1', {assignedto:'megan_kelly'}], ['004110.150.1', {assignedto:'megan_kelly'}],
    ['004110.020.1', {assignedto:'dylan_collyge'}], ['002000.010.1', {assignedto:'chris_fisher'}]
  ])};
  const c = context(['firstDockNonEmpty','firstDockValue','normalizeDockViewDockKey','normalizeDockSuspendRequestValue','getDockSuspendValue','isDockSuspendDcRequestMirrorRow','getCardEvalOwnerIndex','getAssignedQueueOwner','resolveSuspendOwner','resolveExactSuspendOwner','buildSuspendEvalUserFilter',
    'resolveRequestCardQuantity','isRequestPendingVisible','compareAssignedItemCodes'], {
    getManagerAssignedColumnState:()=>state, fullInventory:[{itemcode:'001111.010.1',assignedto:'jd_jones'}],
    normalizeEvalAssignableUser:v=>String(v||'').trim().toLowerCase(), buildManagerEvalAssignmentKey:v=>String(v||'').trim().toUpperCase(),
    isDockSuspendDcRequestSource:r=>r?.suspend==='SUSPEND', getDockSuspendToValue:r=>r?.suspend_to, canUseRequestSuspendTagAssignedToFilter:()=>true,
    getSuspendEvalUserFilter:()=>'ALL', queueAccessScope:()=>({all:true}), escapeHtml:String, isRequestVisibleForCurrentUser:()=>false,
    isMoveRequestRow:()=>false,hasConfirmedRequestCompletion:r=>!!r.receiptConfirmed,isTruthishHistoryValue:Boolean,hasCompletionDateValue:r=>!!r.date_completed,
    normalizeRequestStatus:v=>v,firstNonEmptyValue:(...v)=>v.find(x=>x!=null&&x!=='')||''
  });
  const tags=[' 004110.020.1 ','004110.070.','001111.010.1'].map(itemcode=>({suspend:'SUSPEND',itemcode,assignedto:'jd_jones'}));
  assert.deepEqual(tags.map(r=>c.resolveSuspendOwner(r)),['dylan_collyge','megan_kelly','Unassigned']);
  const html=c.buildSuspendEvalUserFilter(tags);
  for (const label of ['All Users (3)','megan_kelly (1)','dylan_collyge (1)','Unassigned (1)']) assert.ok(html.includes(label),label);
  assert.ok(!html.includes('jd_jones')); assert.ok(!c.buildSuspendEvalUserFilter(tags.slice(0,2)).includes('Unassigned'));
  const row={REQUEST_ACTIVE:true,REQ_STATUS:'Pending',ITEMCODE:'004110.070.1'};
  assert.ok(c.isRequestPendingVisible(row)); assert.ok(!c.isRequestPendingVisible({...row,REQ_STATUS:'Complete'}));
  assert.ok(!c.isRequestPendingVisible({...row,receiptConfirmed:true}));
  for (const qty of [0,null,'  ']) assert.equal(String(c.resolveRequestCardQuantity({qty})), '0');
  assert.equal(String(c.resolveRequestCardQuantity({qty:'',req_qty:8})), '8');
  assert.deepEqual(['009000.001.1',' 000105.001.1','000110.001.1'].map(ITEMCODE=>({ITEMCODE})).sort(c.compareAssignedItemCodes).map(r=>r.ITEMCODE.trim()),['000105.001.1','000110.001.1','009000.001.1']);
}

export async function firstAssignedFrameContract() {
  const state = {}, host = {innerHTML:'',querySelector:()=>slot}, slot = {innerHTML:''}, frames = [], jobs = [];
  const input = Array.from({length:205}, (_,i)=>({ITEMCODE:String(205-i).padStart(6,'0'),UNIQUE_ID:String(i)}));
  let reads = 0, renders = 0;
  const c = context(['openAssignedItemsFirstFrame','compareAssignedItemCodes'], {
    document:{getElementById:()=>host},renderManagerTableManagementWorkspace:html=>html,
    requestAnimationFrame:fn=>frames.push(fn),setTimeout:fn=>jobs.push(fn),getManagerAssignedColumnState:()=>state,
    activeHomeTab:'assigned',MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW:'assigned',isViewVisible:()=>true,canViewAssignedItemsExport:()=>true,
    fullInventory:input,warehouseAssignedItemsInventory:[],getManagerAssignedDisplaySignature:()=>'same',
    getManagerItemLowStockTargetsState:()=>({revision:1}),buildManagerEvalAssignmentKey:v=>v,
    getFilteredManagerAssignedItemsExportRows:rows=>rows,getManagerAssignedItemsDisplayRows:batch=>{reads++;assert.ok(batch.length <= (reads === 1 ? 150 : 100));return batch;},
    renderManagerAssignedFallbackRows:rows=>rows.length+' preview rows',renderManagers:()=>renders++
  });
  c.openAssignedItemsFirstFrame(state);
  assert.match(host.innerHTML,/Assigned Items/); assert.equal(reads,0);
  frames.shift()(); assert.equal(slot.innerHTML,'150 preview rows');
  const preparation=jobs.shift()();
  while(jobs.length){jobs.shift()(); await new Promise(resolve=>setImmediate(resolve));}
  await preparation;
  assert.equal(reads,4);assert.equal(renders,1);assert.equal(state.displayCache.rows.length,205);
  assert.equal(state.displayCache.rows[0].ITEMCODE,'000001');
}

