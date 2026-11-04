import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const rows = read('assets/row-workflow-functions.js');
const runtime = read('assets/app-runtime.js');
function fixture(names, extra = {}) {
    const ctx = vm.createContext({
        GLOBAL_LIVE_CHANGE_USER_KEYS: new Set(['dylan_collyge','megan_kelly','jd_jones','mitch_kaiser','nelly_aguilar','morgan_anderson']),
        currentUser: 'chris_fisher', currentRole: 'EVAL', fullInventory: [],
        getManagerAssignedColumnState: () => state, resolveUserAccessMatrix: () => ({}),
        buildManagerEvalAssignmentKey: code => String(code || '').trim().toUpperCase(),
        EVAL_TASK_USER_ALIASES: { nally_aguilar: 'nelly_aguilar', charlie_robertson: 'charley_robertson', kayla_knapp: 'kayla_knepp', abigail_vasquez: 'abigail_vazquez' },
        ...extra
    });
    const state = { itemcodeDefaultOwners: new Map([['004380.010.1','chris_fisher'],['004424.020.1','chris_fisher'],['001973.030.1','other_eval']]) };
    for (const name of names) {
        const marker = 'function ' + name + '(';
        const source = rows.includes(marker) ? rows : runtime;
        const at = source.indexOf(marker);
        assert.ok(at >= 0, name);
        const start = source.lastIndexOf('\n', at) + 1;
        const indent = source.slice(start, at).replace('async ', '');
        const end = source.indexOf('\n' + indent + '}', at) + indent.length + 2;
        vm.runInContext(source.slice(start, end), ctx);
    }
    return {ctx, state};
}
const engines = ['normalizeEvalAssignableUser','getCardEvalOwnerIndex','getAssignedQueueOwner','resolveInventoryRowOwner','resolveCanonicalRowAccess','canUserReclassRow','canUserUnlockRow','canUserEditRow','canUserUploadRowPhoto'];
test('named power users can act on foreign and completed inventory rows', () => {
    const {ctx} = fixture([...engines,'canUserMakeLiveChangesOnRow','isEvalReclassRowAssigned','canUnlockCompletedRow','canEditRowDetails','canCurrentUserUpdateDrivePhotoData'], {
        resolveUserAccessMatrix:()=>({edit_any_row:'N',edit_assigned_rows_only:'N',verified:true}),
        getRoleAccessState:()=>({}),getEditableDetailItemForPrefix:(_p,row)=>row
    });
    for (const user of ['dylan_collyge','megan_kelly','jd_jones','mitch_kaiser','nally_aguilar','nelly_aguilar','morgan_anderson']) {
        ctx.currentUser = user;
        for (const row of [{ITEMCODE:'004424.020.1'},{ITEMCODE:'001973.030.1',completed:true}]) {
            for (const action of engines.slice(-4)) assert.equal(ctx[action](user,row),true,action);
            assert.ok(ctx.canEditRowDetails('ssn-',row) && ctx.canUnlockCompletedRow(row) && ctx.canCurrentUserUpdateDrivePhotoData(row) && ctx.isEvalReclassRowAssigned(user,row));
        }
    }
});
test('assigned evaluators use exact then six-digit owner before mirrored fields', () => {
    const {ctx} = fixture(engines);
    for (const code of ['004380.010.1','004424.020.1','004380.999.1']) {
        for (const action of engines.slice(-4)) assert.equal(ctx[action]('chris_fisher',{ITEMCODE:code,eval_user:'other_eval'}),true);
    }
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
    assert.match(rows,/masterUid:key,expectedSignature:signature[^\n]*25000, 'Unlock row'/);
    for (const file of fs.readdirSync(new URL('../assets/',import.meta.url)).filter(f=>f.endsWith('.js'))) {
        assert.doesNotMatch(read('assets/'+file), /Unlock row timed out after 4s|Database photo recovery timed out after 4s/);
    }
});
test('one physical Suspend row counts once and nonadmins see only assigned queue rows', () => {
    const names = [...engines,'getItemUniqueId','getDockSuspendDcRequestSourceUid','getPhysicalSuspendTagKey','uniquePhysicalSuspendTags',
        'hasCompletionDateValue','isQueueOwnerVisible','getDockSuspendDcSourceRows','getLatestSocSuspendTagSourceRows','countPendingSuspendTagQueueItems','getActiveAssignedQueueCounts','getRequestQueueAlertCount'];
    const {ctx,state} = fixture(names, {
        canUseRequestSuspendTagAssignedToFilter:()=>false, firstNonEmptyValue:(...xs)=>xs.find(x=>x!=null&&x!=='')||'',
        getRequestCapabilities:()=>({canViewQueue:true}), canReadSuspendQueue:()=>true, getSupabaseReadIdentityScope:()=>'fixture',
        getSuspendEvalUserFilter:()=>'chris_fisher', resolvedViewStateEpoch:1, getDatasetLoadSignature:()=>1,
        suspendTagRawSourceRowsReady:true, suspendTagInventoryScope:'fixture', socRawSourceRows:[], getCurrentVisibleViewId:()=>'request',
        isDockSuspendDcRequestSource:r=>r.suspend==='SUSPEND', getSuspendTagRequestItems:rows=>rows,
        getSuspendTagStatus:r=>r.status||'pending', getQueueCompletionState:()=>null,
        isRegularRequestQueueItem:()=>true, isRequestPendingVisible:r=>!r.completed
    });
    const tags=Array.from({length:89},(_,i)=>({suspend:'SUSPEND',unique_id:String(i+1),itemcode:i<7?'004380.010.1':'001973.030.1'}));
    ctx.suspendTagInventory=[...tags,...tags.map(r=>({...r,unique_id:'dock_suspend_dc_'+r.unique_id}))];
    const unique=ctx.uniquePhysicalSuspendTags(ctx.suspendTagInventory);
    assert.equal(unique.length,89);
    ctx.requestsInventory=[{itemcode:'001973.030.1'},{itemcode:'unassigned'}];
    assert.equal(unique.filter(r=>ctx.isQueueOwnerVisible(r)).length,7);
    assert.equal(ctx.requestsInventory.filter(r=>ctx.isQueueOwnerVisible(r)).length,0);
    const counts=ctx.getActiveAssignedQueueCounts();
    assert.equal(counts.pending,0);assert.equal(counts['suspend-tag'],7);
    assert.equal(ctx.getRequestQueueAlertCount(),7);
    assert.equal(ctx.getActiveAssignedQueueCounts(),counts,'unchanged revisions reuse the same count snapshot');
    state.dataEpoch=1;ctx.requestsInventory=[{unique_id:'REQ-1',itemcode:'004380.010.1'}];
    assert.equal(ctx.getRequestQueueAlertCount(),8);
});
test('10,000 warm exact/family owner lookups finish within 15 milliseconds', t => {
    const {ctx,state}=fixture(engines);
    for(let i=0;i<3352;i++)state.itemcodeDefaultOwners.set(String(100000+i)+'.010.1','worker');
    const index=ctx.getCardEvalOwnerIndex(state,true);
    assert.equal(index.exact,state.ownerByExactItemcodeMap); assert.equal(index.family,state.ownerByPrefix6Map);
    assert.equal(state.usersWithAssignedItemsSet.has('chris_fisher'),true);
    const exact={itemcode:'004380.010.1'},family={itemcode:'004380.999.1'};
    const start=performance.now(); let hits=0;
    for(let i=0;i<5000;i++){if(ctx.getAssignedQueueOwner(exact,index)==='chris_fisher')hits++;if(ctx.getAssignedQueueOwner(family,index)==='chris_fisher')hits++;}
    const elapsed=performance.now()-start; assert.equal(hits,10000); assert.ok(elapsed<15, String(elapsed)); t.diagnostic(elapsed.toFixed(3)+' ms');
});
test('filter geometry, WebKit width guard and Location Note contrast stay in the shell', () => {
    const css=read('assets/app-shell-style-16.css');
    assert.match(css,/height:\s*16px;[^}]*white-space:\s*nowrap/);assert.match(css,/height:\s*40px;[^}]*-webkit-appearance:\s*none/);
    assert.match(runtime,/if \(window.innerWidth === width\) return/);
    assert.match(css,/\[data-location-note\][^{]*\{[^}]*color:\s*#fef3c7 !important/);
});
