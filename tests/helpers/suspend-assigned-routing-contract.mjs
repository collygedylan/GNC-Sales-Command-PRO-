import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {readComposedRuntimeSource} from '../../scripts/composed-app-source.mjs';
import {extractGoldenFunction} from '../../src/core/golden-function-extractor.mjs';

export const suspendRoutingFunctions = [
    'resolveExactSuspendOwner','resolveSuspendOwner','getAssignedQueueOwner',
    'queueAccessScope','getQueueScopeFilter','getSuspendEvalUserFilter','isQueueOwnerVisible',
    'buildSuspendEvalUserFilter','setSuspendEvalUserFilter','applySuspendEvalUserFilter',
    'canCurrentUserViewDockSuspendDcRequests','canCurrentUserWorkRequestItem',
    'getLatestSocSuspendTagSourceRows','getSuspendTagRequestItems',
    'getDockSuspendDcSourceRows',
    'resolveManagerAssignedOwnerEvidence','isManagerEvalZoneAssignment',
];

export function suspendRoutingSource() {
    const source = readComposedRuntimeSource();
    return suspendRoutingFunctions.map(name => extractGoldenFunction(source,name)).join('\n');
}

export function createSuspendRoutingFixture() {
    const defaults = new Map([['111111.030.1',{assignedto:'worker_a'}],['222222.030.1',{assignedto:'worker_b'}],['333333.030.1',{assignedto:'zero_tags'}]]);
    const state = {itemcodeDefaultOwners:defaults,defaultOwnersByCode:defaults};
    const context = vm.createContext({
        currentUser:'administrator',currentRole:'ADMIN',activeReqTab:'suspend-tag',
        normalizeEvalAssignableUser:value=>String(value||'').trim().toLowerCase(),
        buildManagerEvalAssignmentKey:value=>String(value||'').trim().toUpperCase(),
        getManagerAssignedColumnState:()=>state,
        getCardEvalOwnerIndex:()=>({exact:new Map([...defaults].map(([code,row])=>[code,row.assignedto])),family:new Map()}),
        isDockSuspendDcRequestMirrorRow:row=>row?.DOCK_SUSPEND_DC_REQUEST === true,
        isDockSuspendDcRequestSource:row=>row?.suspend === 'SUSPEND' && !row?.suspend_completed,
        canReadSuspendQueue:()=>true,escapeHtml:String,markViewDirty(){},renderRequest(){},paintFooterRequestBadgeOnly(){},
        getQueueCompletionState:()=>({completedSuspendTagKeys:new Set()}),getDockSuspendDcRequestSourceUid:row=>row.unique_id,
        uniquePhysicalSuspendTags:rows=>[...new Map(rows.map(row=>[row.unique_id,row])).values()],
        getSupabaseReadIdentityScope:()=> 'fixture',suspendTagInventoryScope:'fixture',socRawSourceRows:[],
        getCurrentVisibleViewId:()=> 'request',socRawSourceRowsReady:true,socInventory:[{unique_id:'stale-soc'}],
        getDatasetState:()=>({rowCompleteness:'complete'}),
        getWarehouseAssignedRowForItem:row=>row.LOCATIONCODE === 'C.06.001'
            ? {assignedto:'zoe_green',default_assignedto:'worker_a',zone_override_active:true,assignment_reason:'zone_zoe'} : null,
    });
    vm.runInContext(suspendRoutingSource(),context);
    const rows = Array.from({length:90},(_,index)=>({unique_id:'tag-'+index,DOCK_SUSPEND_DC_REQUEST:true,
        itemcode:index<45?'111111.030.':'222222.030.1',LOCATIONCODE:index===0?'C.06.001':'G.12.001',lotcode:'27.F1',
        suspend:'SUSPEND',suspend_to:['dc','ms','mk','unknown',''][index%5],assignedto:'stale_erp_owner'}));
    return {context,state,rows};
}

export function assertSuspendAssignedRouting() {
    const {context:c,rows} = createSuspendRoutingFixture();
    assert.equal(c.getSuspendTagRequestItems(rows).length,90);
    assert.equal(c.resolveSuspendOwner(rows[0]),'zoe_green');
    assert.equal(c.resolveSuspendOwner(rows[1]),'worker_a');
    assert.equal(c.resolveSuspendOwner(rows[70]),'worker_b');
    assert.equal(c.resolveSuspendOwner({...rows[1],suspend_eval_owner:'zoe_green',suspend_owner_zone_override:true}),'zoe_green');
    assert.equal(c.resolveSuspendOwner({...rows[1],suspend_eval_owner:null,suspend_owner_zone_override:true}),'Unassigned');
    assert.equal(c.resolveSuspendOwner({...rows[1],itemcode:'missing',suspend_to:'worker_a'}),'Unassigned');
    for (const role of ['admin','super-admin','SUPER_ADMIN']) {
        c.currentRole=role;
        assert.equal(c.getSuspendEvalUserFilter(),'ALL');
        assert.equal(c.applySuspendEvalUserFilter(rows).length,90);
        assert.ok(c.buildSuspendEvalUserFilter(rows).includes('zero_tags (0)'));
        for (const row of rows) assert.equal(c.canCurrentUserWorkRequestItem(row,'photo'),true);
        c.setSuspendEvalUserFilter('worker_b');
        assert.equal(c.applySuspendEvalUserFilter(rows).length,45);
        c.setSuspendEvalUserFilter('ALL');
    }
    c.currentRole='EVAL';c.currentUser='worker_a';
    c.GncUserAccessControl={resolveUserAccessMatrix:()=>({role:'EVAL',view_all_suspend:'Y',edit_any_row:'Y'})};
    assert.equal(c.applySuspendEvalUserFilter(rows).length,44);
    assert.equal(c.buildSuspendEvalUserFilter(rows),'');
    c.setSuspendEvalUserFilter('ALL');
    assert.equal(c.getSuspendEvalUserFilter(),'worker_a');
    assert.equal(c.canCurrentUserWorkRequestItem(rows[1],'edit'),true);
    assert.equal(c.canCurrentUserWorkRequestItem(rows[0],'photo'),false);
    assert.equal(c.canCurrentUserWorkRequestItem(rows[70],'edit'),false);
    c.currentUser='zoe_green';
    assert.equal(c.applySuspendEvalUserFilter(rows).length,1);
    assert.equal(c.canCurrentUserWorkRequestItem(rows[0],'edit'),true);
    c.currentUser='dylan_collyge';
    assert.equal(c.applySuspendEvalUserFilter(rows).length,0,'a named standard user has no cross-owner exception');
    c.resolveCanonicalRowAccess=()=>({canCompleteTag:true});
    assert.equal(c.canCurrentUserViewDockSuspendDcRequests({...rows[70],DOCK_SUSPEND_DC_REQUEST:false}),true,'raw Dock callers retain their existing authorization');
    assertSuspendProjectionIdentity();
}

function assertSuspendProjectionIdentity() {
    const {context:c,rows}=createSuspendRoutingFixture();
    const source=readComposedRuntimeSource();
    c.firstNonEmptyValue=(...values)=>values.find(value=>value!=null && value!=='') || '';
    c.normalizeMasterInventorySourceCode=value=>String(value||'').toUpperCase();
    c.window={};c.getWarehouseAssignedRowForItem=()=>null;
    vm.runInContext(['getSuspendTagInventoryIdentity','matchesSuspendTagInventoryIdentity']
        .map(name=>extractGoldenFunction(source,name)).join('\n'),c);
    c.suspendTagInventory=[{...rows[0],suspend_owner_zone_override:true,suspend_eval_owner:'zoe_green'}];
    c.suspendTagRawSourceRowsReady=true;
    assert.equal(c.resolveSuspendOwner(rows[0]),'zoe_green','SOC membership consumes matching authoritative ownership');
    assert.equal(c.resolveSuspendOwner({...rows[0],LOCATIONCODE:'G.12.001'}),'Unassigned');
    assert.equal(c.resolveSuspendOwner({...rows[0],lotcode:'27.S1'}),'Unassigned');
}

export function assertSuspendSourceTurnover() {
    const {context:c,rows} = createSuspendRoutingFixture();
    rows[0].dock_photo_link='https://fixture.test/photo.jpg';
    rows[0].dock_spec='saved evidence';
    c.suspendTagInventory=rows;
    assert.equal(c.getDockSuspendDcSourceRows(),c.socInventory,'current complete SOC membership wins over a stale projection');
    assert.equal(c.getLatestSocSuspendTagSourceRows(rows).length,90);
    c.suspendTagInventory=rows.slice(1);
    const next = c.getLatestSocSuspendTagSourceRows(c.suspendTagInventory);
    assert.equal(next.length,89);
    assert.ok(next.every(row=>row.unique_id !== rows[0].unique_id));
    assert.equal(c.getLatestSocSuspendTagSourceRows([]).length,0);
    const source = fs.readFileSync('src/core/suspend-detail-save-domain.js','utf8');
    assert.match(source,/publishRowEvaluationToMasterAndNotes\(row,patch/);
}

export async function assertSuspendPhotoAccountProof({runFunctions,functionSource}) {
  let owner='one';const item={UNIQUE_ID:'tag',suspend_tag_status:'awaiting_rep'};
  const ctx=runFunctions('assets/app-runtime.js',['loadCurrentSuspendTagPhotoRow','isCurrentSuspendTagPhotoProof','canCurrentUserWorkRequestItem'],{
    suspendTagPhotoProofs:new WeakSet(),AbortController,getDockSuspendDcRequestSourceUid:()=> 'tag',isDockSuspendDcRequestMirrorRow:()=>true,
    canCurrentUserViewDockSuspendDcRequests:()=>true,getProductionLiveSyncContext:()=>({scope:owner,dataPermissionVersion:'p'}),
    findDockSuspendDcRequestSourceRow:()=>item,getSuspendTagWriteVersion:()=>0,getSupabaseReadIdentityScope:()=>owner
  });
  const proof=await ctx.loadCurrentSuspendTagPhotoRow(item);assert.equal(ctx.isCurrentSuspendTagPhotoProof(proof,item),true);
  owner='two';assert.equal(ctx.isCurrentSuspendTagPhotoProof(proof,item),false);
  assert.doesNotMatch(functionSource('assets/app-runtime.js','loadCurrentSuspendTagPhotoRow'),/supabaseRpc|suspendTagApi|REVIEW_LOCKED/);
}

export async function assertSuspendUnauthorizedSave() {
    const source=fs.readFileSync('src/core/suspend-detail-save-domain.js','utf8');
    const declaration=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body
        .find(node=>node.declaration?.id?.name==='saveDockSuspendDcRequestMirrorData').declaration;
    const context=vm.createContext({activeItem:{DOCK_SUSPEND_DC_REQUEST:true},isDockSuspendDcRequestMirrorRow:()=>true,
        getSupabaseReadIdentityScope:()=> 'actor',getDockSuspendDcRequestFormValues:()=>({}),
        canCurrentUserViewDockSuspendDcRequests:()=>false,canUseProductionLiveSync:()=>true,
        getSuspendTagStatus:()=> 'pending',canCurrentUserWorkRequestItem:()=>false});
    vm.runInContext(source.slice(declaration.start,declaration.end),context);
    assert.equal(await context.saveDockSuspendDcRequestMirrorData(),false);
    context.canCurrentUserViewDockSuspendDcRequests=()=>true;
    assert.equal(await context.saveDockSuspendDcRequestMirrorData(),false);
}
