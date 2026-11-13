import assert from 'node:assert/strict';
import {verifiedRowSession} from './golden-verified-row-session.mjs';

export async function invariant290(runFunctions) {
  const row = { UNIQUE_ID:'tag', MASTER_ID:'master', ITEMCODE:'100.020.1', LOCATIONCODE:'A.01', LOTCODE:'27.F1',
    assignedto:'fixture_editor', DOCK_SUSPEND_DC_REQUEST:true };
  const master = { ...row, UNIQUE_ID:'master', SOURCE_TABLE:'ph_master_inventory' };
  const identity = { masterUid:master.UNIQUE_ID, itemCode:row.ITEMCODE, locationCode:row.LOCATIONCODE, lotCode:row.LOTCODE };
  const calls = [], button = { disabled:false };
  const context = runFunctions('assets/app-runtime.js',['saveDockSuspendDcRequestMirrorData'],{
    ...verifiedRowSession(), activeItem:row, window:{}, detailReturnState:null, getSupabaseReadIdentityScope:()=> 'actor',
    isDockSuspendDcRequestMirrorRow:value=>value?.DOCK_SUSPEND_DC_REQUEST === true, canCurrentUserViewDockSuspendDcRequests:()=>true,
    canUseProductionLiveSync:()=>false, getSuspendTagStatus:()=> 'pending',
    requireCurrentSuspendTagWriteProof:(_label,item)=>item===row,
    findLinkedMasterRow:item=>item.MASTER_ID===master.UNIQUE_ID?master:null, getSuspendTagInventoryIdentity:()=>identity,
    matchesSuspendTagInventoryIdentity:(target,expected)=>target.UNIQUE_ID===expected.masterUid && target.ITEMCODE===expected.itemCode
      && target.LOCATIONCODE===expected.locationCode && target.LOTCODE===expected.lotCode,
    getDockSuspendDcRequestSourceUid:value=>value.UNIQUE_ID, getDockSuspendCompletionRevision:()=> 'r1',
    findDockSuspendDcRequestSourceRow:value=>value, beginRowEvaluationMemoryPublication:()=>()=>{},
    scheduleRequestRender(){}, applyExplicitAvNotePayload(){}, readRowEvaluationDraft:()=>({}), clearSavedRowEvaluationDraft(){},
    restoreCapturedPhotoFields(){}, mergeActiveItemDetailPhotoFields(){}, syncDockSuspendDcRequestPhotoAliases(){},
    document:{getElementById:()=>button}, isViewVisible:()=>false, mergePhotoCsvList:values=>values.filter(Boolean).join(','),
    buildDockSuspendDcRequestNote:()=> 'note', firstNonEmptyValue:(...values)=>values.find(Boolean)||'',
    getSuspendTagFormDraftKey:()=> 'tag', suspendTagFormDrafts:new Map(), restoreSuspendTagFormDraft(){}, showToast(){},
    runSuspendTagRowCommand:async(op,item,patch,revision,options)=>{
      assert.equal(button.disabled,true);
      calls.push({op,item,patch,revision,options});
      return true;
    },
    suspendTagErrorMessage:error=>{throw error;},
  });
  const options = {suspendTagValues:{spec:'16-18 H',caliper:'',avNote:'Full body',match:''}};
  assert.equal(await context.saveDockSuspendDcRequestMirrorData(true,row,false,options),true);
  assert.equal(calls.length,1);
  const [call] = calls;
  assert.equal(call.op,'save');
  assert.equal(call.item,row);
  assert.equal(call.patch.dock_spec,'16-18 H');
  assert.equal(call.options.inventoryMasterUid,master.UNIQUE_ID);
  assert.equal(call.options.requireInventoryReceipt,true);
  assert.equal(call.options.inventoryIdentity,identity);
  assert.equal(button.disabled,false);
  row.assignedto='other_editor';
  assert.equal(await context.saveDockSuspendDcRequestMirrorData(true,row,false,options),false);
  assert.equal(calls.length,1);
}

export async function invariant469(runFunctions) {
  const calls=[];
  const api=runFunctions('assets/app-runtime.js',['publishRowEvaluationToMasterAndNotes','calculateDockSuspendDcRequestLocMatchQty','getDockSuspendDcRequestLocMatchBaselinePtr','calculateLocMatchQtyValue'],{
    ...verifiedRowSession(),isDockSuspendDcRequestMirrorRow:()=>true,canCurrentUserViewDockSuspendDcRequests:()=>true,
    findLinkedMasterRow: row => row, getSupabaseReadIdentityScope:()=> 'owner',
    findDockSuspendDcRequestSourceRow: row => row, getSuspendTagInventoryIdentity:()=>({masterUid:'tag'}),
    matchesSuspendTagInventoryIdentity:()=>true, beginRowEvaluationMemoryPublication:()=>()=>{},
    getDockSuspendCompletionRevision:()=> 'r1',runSuspendTagRowCommand:(...args)=>{calls.push(args);return true;},
    parseAppNumber:value=>value==null?null:Number(value),parseLocMatchPercent:Number,
    firstNonEmptyValue:(...values)=>values.find(value=>value!=null && value!=='')
  });
  const row={UNIQUE_ID:'tag',PTRONHAND:245,PTRAVAILABLE:235,assignedto:'fixture_editor'},qty=api.calculateDockSuspendDcRequestLocMatchQty(row,'50');
  assert.equal(qty,123);
  await api.publishRowEvaluationToMasterAndNotes(row,{match:50,loc_match_qty:qty,dock_spec:'38-42" H',av_note:'SPEC - 38-42" H'});
  assert.equal(calls[0][0],'save');assert.equal(calls[0][2].loc_match_qty,123);assert.equal(calls[0][4].requireInventoryReceipt,true);
  await assert.rejects(api.publishRowEvaluationToMasterAndNotes({...row,assignedto:'different_editor'},{match:50}),/ROW_EVALUATION_FORBIDDEN/);
  assert.equal(calls.length,1);
}

export function invariant471(runFunctions) {
  const target = {UNIQUE_ID:'pri-1',ITEMCODE:'005670.051.1',LOCATIONCODE:'J.03.000',LOTCODE:'27.F1',PHOTO_LINK:'target.jpg'};
  const sibling = {...target,UNIQUE_ID:'pri-10',PHOTO_LINK:''};
  const otherLot = {...sibling,UNIQUE_ID:'spring',LOTCODE:'27.S1'};
  const otherItem = {...sibling,UNIQUE_ID:'sea-green',ITEMCODE:'000310.070.1'};
  const rows = [target,sibling,otherLot,otherItem], state = {};
  const ctx = runFunctions('assets/app-runtime.js',['inventoryPhotoLocationKey','getInventoryLocationPhotos'],{
    fullInventory:rows,avOpenInventory:[],inventoryDomIdLookupCacheVersion:1,queueCardInventoryRenderVersion:1,
    getManagerAssignedColumnState:()=>state,getSupabaseReadIdentityScope:()=>'actor',
    masterInventoryById:new Map(rows.map(row=>[row.UNIQUE_ID,row])),
    masterInventoryByItemCode:new Map([[target.ITEMCODE,[target,sibling,otherLot]],[otherItem.ITEMCODE,[otherItem]]]),
    getSharedAppPhotoLinkCsvRaw:r=>r.PHOTO_LINK,getPhotoUrlList:s=>s?[s]:[],isPhotoEntryExpired:()=>false,resolveAndFormatPhotoDate:()=>{}
  });
  for (const row of [target,{...target,UNIQUE_ID:'tag',SOURCE_TABLE:'ph_soc_master',MASTER_ID:'pri-1'}]) {
    assert.deepEqual(Array.from(ctx.getInventoryLocationPhotos(row)),['target.jpg']);
  }
  for (const row of [sibling,otherLot,otherItem,{LOCATIONCODE:'J.03.000'},{ITEMCODE:target.ITEMCODE,LOCATIONCODE:'J.03.000'}]) {
    assert.deepEqual(Array.from(ctx.getInventoryLocationPhotos(row)),[]);
  }
  const guard = runFunctions('assets/app-runtime.js',['normalizeDriveEvidenceLocationPart','isSameDriveEvidenceLocation']);
  assert.equal(guard.isSameDriveEvidenceLocation(target,{...target},true),true);
  for (const row of [sibling,otherLot,otherItem]) assert.equal(guard.isSameDriveEvidenceLocation(row,target,true),false);
}

export function invariant472(runFunctions) {
  const row = {ITEMCODE:'002769.150.1',LOCATIONCODE:'C.08.000',LOTCODE:'27.F1',PRIORITY:'1',UNIQUE_ID:'jewel',PHOTO_LINK:'photo-a'};
  const empty = {...row,UNIQUE_ID:'other',PHOTO_LINK:'',PRIORITY:'10'};
  const wrong = {...row,UNIQUE_ID:'wrong',ITEMCODE:'else',PHOTO_LINK:'wrong-photo'};
  const ctx=runFunctions('assets/app-runtime.js',['getQueueDisplayEvidenceRow','getQueueDisplayPhotoUrls','inventoryPhotoLocationKey'],{
    window:{AgMetricQueueInventory:{normalizeLocation:s=>s}},getRequestItemCodeOptionItemCode:r=>r.ITEMCODE,
    isFalseBlockLocation:()=>false,isRequestOwnedPhotoRow:()=>true,isDockSuspendDcRequestMirrorRow:()=>false,
    getSupabaseReadIdentityScope:()=>'actor',getManagerAssignedColumnState:()=>({}),suspendTagItemHydration:new Map(),
    masterInventoryByNormalizedItemLocation:new Map([['bed',[empty,row,wrong]]]),getInventoryCardItemLocationKey:()=>'bed',
    resolveLiveInventoryForCard: value => value.MASTER_ID === 'other' ? empty : row,
    masterInventoryById:new Map([[row.UNIQUE_ID,row],[empty.UNIQUE_ID,empty]]),masterInventoryByItemCode:new Map(),
    getSharedAppPhotoLinkCsvRaw:r=>r.PHOTO_LINK,getPhotoUrlList:v=>v?[v]:[],getInventoryLocationPhotos:()=>[]
  });
  const request={...empty,SOURCE_TABLE:'ph_requests_pending',UNIQUE_ID:'request',MASTER_ID:'other'};
  const display=ctx.getQueueDisplayEvidenceRow(request);
  assert.equal(display.UNIQUE_ID,'other');assert.deepEqual(Array.from(ctx.getQueueDisplayPhotoUrls(display)),[]);
  const unlinked=ctx.getQueueDisplayEvidenceRow({...request,MASTER_ID:''});
  assert.equal(unlinked.UNIQUE_ID,'jewel');assert.deepEqual(Array.from(ctx.getQueueDisplayPhotoUrls(unlinked)),['photo-a']);
  assert.equal(ctx.getQueueDisplayEvidenceRow({...empty,SOURCE_TABLE:'ph_master_inventory'}),null);
  assert.deepEqual(JSON.parse(ctx.inventoryPhotoLocationKey(request)),['other',row.ITEMCODE,row.LOCATIONCODE,row.LOTCODE]);assert.equal(empty.PHOTO_LINK,'');
}

export function invariant496(runFunctions) {
 const move={action:'move_up',splits:[{quantity:'125',destinationSeason:'F1'}]};
 const rowMap={move_up:move,priority_change:{action:'priority_change',priority:'10'}};
 const state={activeReclassAction:{one:'priority_change'}};
 const c=runFunctions('assets/app-runtime.js',['toggleArgosReclassV3Action','cloneArgosReclassProposal','buildArgosReclassV3ProposalHtml'],{
  ...verifiedRowSession(),
  argosInventoryTransactionState:state,argosReclassMultiActionState:{rowProposals:new Map([['one',rowMap]])},
  canCurrentUserSubmitRepInventoryOperations:()=>false,getArgosReclassRowEditorEntry:()=>({unique_id:'one',sourceRow:{UNIQUE_ID:'one',LOTCODE:'27.S1'},values:{ptronhand:'401'}}),
  getReclassActionWorkflowV5Config:a=>({kind:a==='priority_change'?'priority':'move',label:a}),RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS:[],
  getArgosReclassV3HoldProposal:()=>null,getArgosReclassV3Proposal:(uid,a)=>uid==='one'?rowMap[a]:null,getArgosReclassRowProposalMap:()=>rowMap,
  window:{confirm(){throw Error('Native confirmation is forbidden');}},refreshArgosReclassMultiActionUi(){},captureEvalWorkLocalDraftSoon(){},generateArgosInventoryTransactionId:()=>'new',
  escapeHtml:String,getArgosReclassMoveUpLotState:()=>({rowMaximum:401}),getArgosReclassRowCurrentSeason:()=>'S1',RECLASS_ACTION_WORKFLOW_V2_SEASONS:['F1','S1'],
  getArgosReclassMoveBalanceText:()=>'',getArgosReclassMoveBalance:()=>({remaining:276})});
 c.toggleArgosReclassV3Action(null,'priority_change','one');
 assert.equal(rowMap.priority_change,undefined);assert.equal(rowMap.move_up,move);assert.equal(move.splits[0].quantity,'125');assert.equal(move.splits[0].destinationSeason,'F1');
 const html=c.buildArgosReclassV3ProposalHtml({unique_id:'one',values:{ptronhand:'401'}},'move_up');
 assert.match(html,/value="125"/);assert.match(html,/<option value="F1" selected>F1/);assert.match(html,/toggleArgosReclassDestinationMenu\(this\)">F1 /);
 let expanded='';const card={getAttribute:k=>k==='data-reclass-row-card'?'one':'false'};
 const w=runFunctions('assets/row-workflow-functions.js',['toggleArgosReclassRowCard'],{getArgosReclassRowEditorEntry:()=>({}),focusArgosReclassRow:uid=>{expanded=uid;return false;}});
 w.toggleArgosReclassRowCard({closest:()=>card});assert.equal(expanded,'one');
}
