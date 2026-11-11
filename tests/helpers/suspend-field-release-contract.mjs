import { getDockOrderBusinessKey } from '../../src/core/dock-order-domain.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = name => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const runtime = read('assets/app-runtime.js'), workflow = read('assets/row-workflow-functions.js');
function install(ctx, source, names) {
    for (const name of names) {
        const fn = source.match(new RegExp('^( *)((?:async )?function ' + name + '\\([^]*?^\\1})','m'));
        assert.ok(fn, name);
        vm.runInContext(fn[2],ctx);
    }
}

export async function closeUnreviewedContract() {
    const tag = {unique_id:'tag',locationcode:'0.00.111',dock_photo_link:null,match:null,dock_spec:null,av_note:null};
    const events = [], state = {completedSuspendTagKeys:new Set(),begin:()=>true,rollback(){}};
    let authorized = true, settle;
    const ctx = vm.createContext({
        canonicalFeaturePermission:()=>authorized,findDockSuspendDcRequestMirrorRowByUniqueId:()=>tag,
        canCurrentUserViewDockSuspendDcRequests:()=>true,canCurrentUserWorkRequestItem:()=>authorized,
        getSupabaseReadIdentityScope:()=>'account',getDockSuspendDcRequestSourceUid:r=>r.unique_id,canUseProductionLiveSync:()=>false,
        suspendTagInventory:[tag],suspendTagRawSourceRows:[tag],suspendTagCompletionActions:new Set(),setSuspendTagCardActionsBusy(){},getQueueCompletionState:()=>state,
        getQueueCompletionKey:()=>'suspend:tag',getQueueCompletionVersion:()=>1,getDockSuspendCompletionRevision:()=>1,
        findDockSuspendDcRequestSourceRow:()=>tag,getPendingPhotoUploadsForItem:()=>[],suspendTagEditorSaves:new Map(),suspendTagRowWrites:new Map(),
        paintOptimisticSuspendTagRemoval:()=>events.push('paint'),markViewDirty(){},yieldToUiFrame:async()=>{},
        invalidateResolvedViewStateCaches(){},serializeSuspendTagRowWrite:(...args)=>args[1](),
        refreshLocalDockSuspendDcRequestState(){},showToast(){},suspendTagErrorMessage:String
    });
    install(ctx,runtime,['closeDockSuspendDcRequestFromCard','runSuspendTagRowCommand']);
    const coordinator=ctx.runSuspendTagRowCommand;
    ctx.runSuspendTagRowCommand=(...args)=>args[4]?.serialized ? (events.push(args[0]),new Promise(r=>{settle=r;})) : coordinator(...args);
    const done=ctx.closeDockSuspendDcRequestFromCard('tag');
    assert.deepEqual(events,['paint']);
    assert.ok(state.completedSuspendTagKeys.has('tag'));
    await new Promise(setImmediate);
    assert.deepEqual(events,['paint','close']); settle(true);await done;
    authorized=false;await ctx.closeDockSuspendDcRequestFromCard('tag');assert.equal(events.length,2);
    assert.ok(!runtime.includes('and save the review before completing this tag'));
}

export async function confirmedLocationContract() {
    const source={UNIQUE_ID:'tag',ITEMCODE:'084871.013.1',COMMONNAME:'Nandina',LOCATIONCODE:'0.00.111',LOTCODE:'27.F1',DOCK:'7',STOPNUMBER:'2',QUANTITYORDERED:'3'};
    const target={UNIQUE_ID:'master',ITEMCODE:'084871.013.1',LOCATIONCODE:'F.14.000',LOTCODE:'27.F1',PTRREVIEWED:'2'};
    const av={...target}, dock={...source}, queue={...source}, receipts=[], prompts=[];
    let confirm=false, finish;
    const ctx=vm.createContext({
        currentUser:'actor',findDockSuspendDcRequestMirrorRowByUniqueId:()=>source,findDockSuspendDcRequestSourceRow:()=>source,
        resolveCanonicalRowAccess:()=>({canManageLocations:true}),getRequestItemCodeOptionRows:()=>[target],getRequestItemCodeOptionMasterId:r=>r.UNIQUE_ID,
        getSupabaseReadIdentityScope:()=>'account',isFalseBlockLocation:v=>v==='0.00.111',getSuspendTagStableSourceIdentity:()=>({dock:'7',stopnumber:'2'}),
        getDockSuspendDcRequestGroupParts:()=>({dock:'7',drop:'2',consignee:'Buyer'}),getDockOrderedQtyDisplay:()=>'3',
        showAppConfirm:(message,options)=>{prompts.push([message,options]);return confirm;},getDockSuspendDcRequestSourceUid:()=>'tag',
        serializeSuspendTagRowWrite:(...args)=>args[1](),getDockSuspendCompletionState:()=>({pending:{}}),crypto:{randomUUID:()=>'once'},
        getDockSuspendCompletionRevision:()=>1,getSuspendTagWriteVersion:()=>1,persistDockSuspendCompletionState(){},
        buildDockSuspendDcOptionSocEntry:()=>({payload:{locationcode:'F.14.000',lotcode:'27.F1',dock:'7',stopnumber:'2'}}),
        socInventory:[dock],socRawSourceRows:[],suspendTagInventory:[queue],suspendTagRawSourceRows:[],
        upsertRealtimeRow:(list,row)=>{const old=list.find(r=>r.UNIQUE_ID===row.UNIQUE_ID);if(old)Object.assign(old,row);else list.push(row);},
        refreshRealtimeDetailLookupIndexes(){},invalidateDockSuspendDcSourceRowLookup(){},invalidateResolvedViewStateCaches(){},markViewDirty(){},isViewVisible:()=>false,
        parseAppNumber:Number,masterInventoryById:new Map([['master',target]]),avOpenInventory:[av],
        suspendTagApi:(op,payload)=>{receipts.push([op,payload]);return new Promise(r=>{finish=r;});},
        showToast(){},suspendTagErrorMessage:String,scheduleRequestRender(){}
    });
    install(ctx,workflow,['isSuspendPullItemMatch','isFalseBlockLocation','previewSuspendPullAllocation','confirmSuspendLocationChange','changeSuspendPullLocation']);
    install(ctx,runtime,['applySuspendCandidateRows']);
    assert.equal(ctx.isSuspendPullItemMatch('084871.031.1',source.ITEMCODE),false);
    assert.ok(ctx.isSuspendPullItemMatch(target.ITEMCODE,source.ITEMCODE));
    await ctx.changeSuspendPullLocation('tag','master','replace_location');
    assert.equal(receipts.length,0);assert.equal(dock.LOCATIONCODE,'0.00.111');
    confirm=true;const changed=ctx.changeSuspendPullLocation('tag','master','replace_location');await new Promise(setImmediate);
    assert.equal(prompts[1][1].title,'Confirm Final Pull Location');assert.match(prompts[1][0],/Pull Order From: F.14.000/);assert.match(prompts[1][0],/FALSE BLOCK/);
    assert.match(prompts[1][0],/Dock 7 · Drop 2/);
    assert.deepEqual([queue.LOCATIONCODE,dock.LOCATIONCODE,target.PTRREVIEWED,av.PTRREVIEWED],['F.14.000','F.14.000','5','5']);
    assert.equal(receipts[0][0],'replace_location');assert.equal(receipts[0][1].inventoryIds[0],'master');
    finish({ok:true,finalPull:true,rows:[{unique_id:'tag',date_completed:'2026-11-04',suspend:null,locationcode:'F.14.000',lotcode:'27.F1',dock:'7',stopnumber:'2'}]});await changed;
}

export function activeSocContract() {
    const ctx=vm.createContext({getDockOrderBusinessKey, getDockSuspendToValue:()=>'', getCurrentVisibleViewId:()=>'request',activeReqTab:'suspend-tag',activeDetailSourceView:'',
        getSupabaseReadIdentityScope:()=>'actor',getDatasetState:()=>({rowCompleteness:'complete'}),socRawSourceRowsReady:true,
        socInventory:Array.from(Array(89).keys(),i=>({unique_id:'soc-'+i})),suspendTagInventory:Array.from(Array(78).keys(),i=>({unique_id:'stale-'+i})),
        suspendTagInventoryScope:'actor',getDockSuspendDcRequestSourceUid:r=>r.unique_id,isDockSuspendDcRequestSource:()=>true,
        isDockSuspendDcRequestMirrorRow:()=>true,getQueueCompletionState:()=>({completedSuspendTagKeys:new Set(['soc-88'])}),
        isOptimisticallyCompletedRow:()=>false,hasCompletionDateValue:()=>false,firstNonEmptyValue:(...v)=>v.find(Boolean)||'',
        buildManagerEvalAssignmentKey:String,getManagerAssignedColumnState:()=>({}),getCardEvalOwnerIndex:()=>({exact:new Map(),family:new Map()}),
        normalizeEvalAssignableUser:v=>v||''});
    install(ctx,runtime,['getDockSuspendDcSourceRows','getSuspendTagRequestItems']);
    install(ctx,workflow,['uniquePhysicalSuspendTags','getPhysicalSuspendTagKey']);
    install(ctx,read('assets/suspend-exact-owner.js'),['resolveSuspendOwner','resolveExactSuspendOwner']);
    const source=ctx.getDockSuspendDcSourceRows();assert.equal(source,ctx.socInventory);
    assert.equal(ctx.getSuspendTagRequestItems(ctx.uniquePhysicalSuspendTags([...source,...source])).length,88);
    for(const itemcode of ['005511.015.1','005921.015.1']) assert.equal(ctx.resolveSuspendOwner({itemcode,suspend_owner_zone_override:false,suspend_eval_owner:'abigail_vazquez'}),'abigail_vazquez');
}
