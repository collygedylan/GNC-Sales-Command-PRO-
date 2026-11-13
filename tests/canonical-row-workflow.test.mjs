import { read, rows, runtime, fixture, engines } from '../src/core/canonical-row-fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

test('verified row grants and locked power profiles retain the exact session and module boundary', () => {
    const {ctx} = fixture([...engines,'canUserMakeLiveChangesOnRow','isEvalReclassRowAssigned','canUnlockCompletedRow','canEditRowDetails','canCurrentUserUpdateDrivePhotoData'], {
        resolveUserAccessMatrix:()=>({edit_any_row:'N',edit_assigned_rows_only:'N',verified:true,view_permissions:{view_drive_mode:'Y'}}),
        getRoleAccessState:()=>({}),getEditableDetailItemForPrefix:(_p,row)=>row
    });
    for (const user of ['dylan_collyge','megan_kelly','jd_jones','mitch_kaiser','nally_aguilar','nelly_aguilar','morgan_anderson']) {
        ctx.currentUser = user;
        ctx.nativeAuthProfile.username = user;
        for (const row of [{ITEMCODE:'004424.020.1'},{ITEMCODE:'001973.030.1',completed:true}]) {
            for (const action of engines.slice(-4)) assert.equal(ctx[action](user,row),true,`${user}: ${action}`);
            assert.equal(ctx.canEditRowDetails('ssn-',row),true);
            ctx.nativeAuthSessionUserId = 'other-profile';
            for (const action of engines.slice(-4)) assert.equal(ctx[action](user,row),false,`foreign session: ${action}`);
            assert.equal(ctx.canEditRowDetails('ssn-',row),false);
            ctx.nativeAuthSessionUserId = 'fixture-profile';
        }
    }
    ctx.currentUser = 'unlisted_writer';ctx.nativeAuthProfile.username = ctx.currentUser;
    ctx.resolveUserAccessMatrix = () => ({verified:true,profile_id:'fixture-profile',edit_any_row:'Y',view_permissions:{view_drive_mode:'Y'}});
    const row = {ITEMCODE:'001973.030.1',completed:true};
    assert.ok(ctx.canEditRowDetails('ssn-',row) && ctx.canUnlockCompletedRow(row) && ctx.canCurrentUserUpdateDrivePhotoData(row) && ctx.isEvalReclassRowAssigned(ctx.currentUser,row));
    ctx.resolveUserAccessMatrix = () => ({verified:true,profile_id:'fixture-profile',edit_any_row:'Y',view_permissions:{view_drive_mode:'N',view_av:'N',view_que:'N'}});
    for (const action of engines.slice(-4)) assert.equal(ctx[action](ctx.currentUser,row),false,`disabled modules: ${action}`);
});
test('assigned evaluators require exact owner evidence before mirrored fields', () => {
    const {ctx} = fixture(engines);
    for (const code of ['004380.010.1','004424.020.1']) {
        for (const action of engines.slice(-4)) assert.equal(ctx[action]('chris_fisher',{ITEMCODE:code,eval_user:'other_eval'}),true);
    }
    assert.equal(ctx.canUserEditRow('chris_fisher',{ITEMCODE:'004380.999.1',eval_user:'other_eval'}),false);
    assert.equal(ctx.canUserEditRow('chris_fisher',{ITEMCODE:'001973.030.1',eval_user:'chris_fisher'}),false);
});
test('unlock paints the exact row while native headers are still pending', () => {
    const row = {UNIQUE_ID:'northwind',completed:true,locked:true,is_completed:true,DATE_COMPLETED:'2026-11-01'};
    const {ctx,state} = fixture(['unlockProtectedSection','getCompletedRowUnlockKey'], {
        activeItem:row, canUnlockCompletedRow:()=>true, canEditRowDetails:()=>true, getSupabaseReadIdentityScope:()=>'login',
        protectedEditState:{}, clearProtectedTimers(){}, applyProtectedEditState(){}, syncCompletedRowControls(){},
        masterInventoryById:new Map(), serializeSuspendTagRowWrite:(_,run)=>run(), persistCanonicalRowUnlock:()=>new Promise(()=>{})
    });
    ctx.unlockProtectedSection('ssn-');
    assert.equal(state.unlockedRowsByKey.get('northwind'),true);
    assert.equal(row.completed,false); assert.equal(row.locked,false); assert.equal(row.is_completed,false);
    assert.equal(ctx.protectedEditState['ssn-'],'northwind');
    assert.match(rows,/p_master_uid:key,p_expected_signature:signature/); assert.match(rows,/25000, 'Unlock row'/);
    for (const file of fs.readdirSync(new URL('../assets/',import.meta.url)).filter(f=>f.endsWith('.js'))) {
        assert.doesNotMatch(read('assets/'+file), /Unlock row timed out after 4s|Database photo recovery timed out after 4s/);
    }
});
test('one physical Suspend row counts once and nonadmins see only assigned queue rows', () => {
    const names = [...engines,'getItemUniqueId','getDockSuspendDcRequestSourceUid','getPhysicalSuspendTagKey','uniquePhysicalSuspendTags',
        'hasCompletionDateValue','getDockSuspendDcSourceRows','getLatestSocSuspendTagSourceRows','countPendingSuspendTagQueueItems','getActiveAssignedQueueCounts','getRequestQueueAlertCount'];
    const {ctx,state} = fixture(names, {
        isDockSuspendDcRequestMirrorRow:r=>r.suspend==='SUSPEND',canUseRequestSuspendTagAssignedToFilter:()=>false, firstNonEmptyValue:(...xs)=>xs.find(x=>x!=null&&x!=='')||'',
        getRequestCapabilities:()=>({canViewQueue:true}), canReadSuspendQueue:()=>true, getSupabaseReadIdentityScope:()=>'fixture',
        getSuspendEvalUserFilter:()=>'chris_fisher', resolvedViewStateEpoch:1, getDatasetLoadSignature:()=>1,
        suspendTagRawSourceRowsReady:true, suspendTagInventoryScope:'fixture', socRawSourceRows:[], getCurrentVisibleViewId:()=>'request',
        isDockSuspendDcRequestSource:r=>r.suspend==='SUSPEND', getSuspendTagRequestItems:rows=>rows,
        getSuspendTagStatus:r=>r.status||'pending', getQueueCompletionState:()=>null,
        isRegularRequestQueueItem:()=>true, isRequestPendingVisible:r=>!r.completed
    });
    vm.runInContext(read('assets/request-queue-membership.js'),ctx);
    const tags=Array.from({length:89},(_,i)=>({suspend:'SUSPEND',suspend_owner_zone_override:false,unique_id:String(i+1),itemcode:i<7?'004380.010.1':'001973.030.1'}));
    ctx.suspendTagInventory=[...tags,...tags.map(r=>({...r,unique_id:'dock_suspend_dc_'+r.unique_id}))];
    const unique=ctx.uniquePhysicalSuspendTags(ctx.suspendTagInventory);
    assert.equal(unique.length,89);
    ctx.requestsInventory=[{unique_id:'REQ-foreign',itemcode:'001973.030.1'},{unique_id:'REQ-unassigned',itemcode:'unassigned'}];
    assert.equal(unique.filter(r=>ctx.isQueueOwnerVisible(r)).length,7);
    assert.equal(ctx.requestsInventory.filter(r=>ctx.isQueueOwnerVisible(r,'pending')).length,2,'Request permissions have separate scope');
    const counts=ctx.getActiveAssignedQueueCounts();
    assert.equal(counts.pending,2);assert.equal(counts['suspend-tag'],7);
    assert.equal(ctx.getActiveAssignedQueueCounts(true).pending,0);
    assert.equal(ctx.getRequestQueueAlertCount(),9);
    assert.deepEqual(ctx.getActiveAssignedQueueCounts(),counts,'unchanged source rows retain the same visible counts');
    state.dataEpoch=1;ctx.requestsInventory=[{unique_id:'REQ-1',itemcode:'004380.010.1'}];
    assert.equal(ctx.getRequestQueueAlertCount(),8);
});
test('filter geometry, WebKit width guard and Location Note contrast stay in the shell', () => {
    const css=read('assets/app-shell-style-16.css');
    assert.match(css,/height:\s*16px;[^}]*white-space:\s*nowrap/);assert.match(css,/height:\s*40px;[^}]*-webkit-appearance:\s*none/);
    assert.match(runtime,/if \(window.innerWidth === width\) return/);
    assert.match(css,/\[data-location-note\][^{]*\{[^}]*color:\s*#fef3c7 !important/);
});
