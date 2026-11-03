import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = name => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const runtime = read('assets/app-runtime.js');
const row = read('assets/row-workflow-functions.js');
const component = read('components/assigned-items/AssignedItems.jsx');
function install(context, source, names) {
    for (const name of names) {
        const match = source.match(new RegExp('^( *)(?:export )?((?:async )?function ' + name + '\\([^]*?^\\1})', 'm'));
        assert.ok(match, name);
        vm.runInContext(match[2], context);
    }
}
const tabs = ['pending','suspend-tag','moves','recount','shear-list','eval-work','bunch-notes','bunch-count-review'];
export function queueTabContract() {
    const toolbar = {dataset:{}};
    const ctx = vm.createContext({
        getRoleAccessState: () => ({}), getRequestCapabilities: () => ({canViewQueue:true}),
        canAccessView: () => true, REQUEST_TAB_LABELS: Object.fromEntries(tabs.map(tab => [tab,tab])),
        requestSalesRepsManagerMode: false, requestArchiveUndo: {}, escapeHtml:String, formatRequestTabCount:String,
        document:{getElementById:id => id === 'request-filter-toolbar' ? toolbar : null},
        syncQueueCategoryToolbarMarkup:(_,markup) => { toolbar.markup = markup; }
    });
    install(ctx, runtime, ['getAuthorizedRequestCategories','normalizeRequestTabValue','renderRequestCategoryToolbar']);
    for (ctx.currentUser of ['megan_kelly','dylan_collyge','jd_jones','chris_fisher']) {
        for (const tab of tabs) {
            ctx.activeReqTab = ctx.normalizeRequestTabValue(tab);
            ctx.renderRequestCategoryToolbar({});
            assert.deepEqual([...toolbar.markup.matchAll(/data-request-category="([^"]+)"/g)].map(m => m[1]), tabs);
            assert.ok(toolbar.markup.includes('data-request-category="' + tab + '" aria-pressed="true"'));
        }
    }
    const never = () => new Promise(() => {});
    const painted = [];
    Object.assign(ctx, {window:{}, resetQueueReadCooldowns(){}, unsubscribeEvalWorkRealtime(){},
        forcePendingRequestRoot(){ctx.activeReqTab='pending';}, syncRequestTabButtons(){},
        isViewVisible:()=>true, renderViewContent:()=>painted.push(ctx.activeReqTab),
        runDirectTrackedNavigation:()=>true, scheduleRequestRenderSideData(){},
        loadDatasetTargetsWithLimit:never, forceRefreshRequestsForView:never});
    install(ctx,runtime,['setReqTab']);
    for (ctx.currentUser of ['megan_kelly','dylan_collyge','jd_jones','chris_fisher']) {
        ctx.setReqTab('suspend-tag'); ctx.setReqTab('pending');
        assert.deepEqual(painted.splice(0), ['suspend-tag','pending']);
    }
    const shell = read('index.html').split('id="request-filter-toolbar"')[1].split('</div></div>')[0];
    assert.equal((shell.match(/data-request-category=/g) || []).length, 8);
}

export function queueCountContract() {
    const ctx = vm.createContext({
        currentUser:'megan_kelly', getManagerAssignedColumnState:()=>state,
        getRequestCapabilities:()=>({canViewQueue:true}), canReadSuspendQueue:()=>true,
        getSupabaseReadIdentityScope:()=>'scope', suspendTagRawSourceRowsReady:true, suspendTagInventoryScope:'scope',
        getSuspendEvalUserFilter:()=>'ALL', resolvedViewStateEpoch:1, getDatasetLoadSignature:()=>1,
        isRegularRequestQueueItem:r=>!r.suspend, isRequestPendingVisible:r=>!r.done,
        normalizeEvalAssignableUser:String, getAssignedQueueOwner:r=>r.owner, isQueueOwnerVisible:r=>r.owner===ctx.currentUser, getItemUniqueId:r=>r.unique_id,
        firstNonEmptyValue:(...values)=>values.find(value=>value!=null && value!=='') || '',
        isDockSuspendDcRequestSource:r=>r.suspend, getSuspendTagRequestItems:()=>[], socRawSourceRows:[],
        getQueueCompletionState:()=>null, getSuspendTagStatus:()=> 'pending',
    });
    const state = {};
    install(ctx,row,['getActiveAssignedQueueCounts','getPhysicalSuspendTagKey','uniquePhysicalSuspendTags']);
    install(ctx,runtime,['getDockSuspendDcRequestSourceUid','getLatestSocSuspendTagSourceRows','countPendingSuspendTagQueueItems']);
    install(ctx,runtime,['getRequestQueueAlertCount']);
    for (const total of [87,93]) {
        ctx.suspendTagInventory=Array.from({length:2*total},(_,i)=>({unique_id:(i<total?'':'dock_suspend_dc_')+'line-'+(i%total),suspend:true,owner:ctx.currentUser}));
        ctx.requestsInventory=[{unique_id:'REQ-1',owner:ctx.currentUser},{unique_id:'REQ-1',owner:ctx.currentUser},
            {unique_id:'REQ-2',owner:'other'},{unique_id:'REQ-3',done:true,owner:ctx.currentUser}];
        assert.equal(ctx.getRequestQueueAlertCount(),total+1);
        ctx.requestsInventory=[];
        assert.equal(ctx.getRequestQueueAlertCount(),total);
    }
}
export function assignedPagingContract() {
    const ctx=vm.createContext({});
    install(ctx,component,['nextAssignedRowLimit']);
    for(const count of [3352,9512]) {
        let limit=150;
        for(let i=0;limit<count;i++) {
            assert.equal(ctx.nextAssignedRowLimit(limit,count,401),limit);
            const next=ctx.nextAssignedRowLimit(limit,count,400);
            assert.equal(next,Math.min(count,limit+150));
            limit=next;
        }
        assert.equal(limit,count);
    }
    assert.match(component,/onScroll=\{[^}]*appendLocalRows/);
}
export function mobileQueueLayoutContract() {
    const css=read('assets/app-shell-style-16.css');
    assert.match(css,/@media\s*\(max-width:\s*640px\)[^{]*\{[^]*?#request-content \.app-request-compact-card \.app-drive-card-title\s*\{[^}]*word-break:\s*normal/);
    assert.match(css,/#request-filter-toolbar\s*\{[^}]*display:\s*flex !important[^}]*overflow-x:\s*auto !important/);
}

export async function assignedOwnerContract() {
    const rows = Array.from({length:9512}, (_, i) => ({
        ITEMCODE: 'I' + (i % 3352), COMMONNAME:'Test plant', PLANTGROUPCODE:'Tree',
        ASSIGNEDTO:'previous', DEFAULT_ASSIGNEDTO:'previous', MASTER_UNIQUE_ID:'row-'+i
    }));
    const state = {filters:{},labels:new Map(),fullInventory:rows,itemcodeDefaultOwners:new Map()};
    const selected = new Set(), toolbar = {value:'megan_kelly'};
    let confirm;
    const calls = [];
    const ctx = vm.createContext({Map,Set,currentUser:'manager',fullInventory:rows,warehouseAssignedItemsInventory:rows,
        managerEvalAssignmentSelection:selected,managersSearchTerm:'',getManagerAssignedColumnState:()=>state,
        getManagerAssignedItemsDisplayRows:()=>rows, getManagerAssignedItemsActiveAssigneeKey:()=>'all',
        normalizeEvalAssignableUser:v=>String(v||'').trim().toLowerCase(),buildManagerEvalAssignmentKey:String,
        sortManagerAssignedColumnRows:rows=>rows,updateManagerAssignedItemsView(){},scheduleManagersRender(){},
        clearWarehouseAssignedItemCaches(){},invalidateManagerEvalReport2Cache(){},
        canManageEvalItemcodeAssignments:()=>true,isManagerAssignedSnapshotCurrent:()=>true,
        parseManagerEvalAssignmentKey:itemcode=>({itemcode}),document:{getElementById:()=>toolbar},crypto:{randomUUID:()=>String(calls.length)},
        supabaseRpc:(name,args)=>{calls.push({name,args});return new Promise(resolve=>{confirm=resolve;});},
        applyAcknowledgedEvalAssignmentResults(){},mirrorConfirmedItemcodeOwners:async()=>{},getSupabaseReadIdentityScope:()=>'test',
        reloadWarehouseAssignmentsAfterMutation:async()=>{},showToast(){},reportSemanticHealthEvent(){}
    });
    install(ctx,runtime,['getFilteredManagerAssignedItemsExportRows','sortManagerAssignedColumnRows','assignEvalItemcodes','assignSelectedEvalItemcodes',
        'normalizeSearchValue','tokenizeSearchValue','getManagerAssignedColumnValue','getManagerAssignedColumnDefinitions','rememberManagerAssignedColumnLabels']);
    install(ctx,row,['getManagerAssignedSelectionSnapshot','selectAllFilteredManagerAssignedItems','assignManagerCheckedItemcodes','applyOptimisticItemcodeOwners','getCardEvalOwnerIndex']);
    assert.equal(ctx.getFilteredManagerAssignedItemsExportRows().length,3352);
    ctx.managersSearchTerm='test'; state.filters.PLANTGROUPCODE=['tree'];
    const started=performance.now();
    assert.equal(ctx.getFilteredManagerAssignedItemsExportRows().length,3352);
    const filterMs=performance.now()-started;
    state.viewMode='rows';
    assert.equal(ctx.getFilteredManagerAssignedItemsExportRows().length,9512);
    ctx.selectAllFilteredManagerAssignedItems(true);
    assert.equal(selected.size,3352);
    const batch=ctx.assignSelectedEvalItemcodes(true);
    assert.equal(calls.length,1);
    assert.equal(calls[0].name,'set_itemcode_default_owners_v1');
    assert.equal(calls[0].args.p_itemcodes.length,3352);
    assert.ok(rows.every(r=>r.effective_worker==='megan_kelly'));
    assert.equal(state.itemcodeDefaultOwners.get('I3351').assignedto,'megan_kelly');
    assert.equal(state.ownerByExactItemcodeMap.get('I3351'),'megan_kelly');
    confirm({}); await batch;
    for(const [codes,trigger] of [[['I201','I202'],'I201'],[['I203'],'I203']]) {
        for(const code of codes) selected.add(code);
        const save=ctx.assignManagerCheckedItemcodes(trigger,'jd_jones');
        assert.deepEqual([...calls.at(-1).args.p_itemcodes],codes);
        for(const code of codes) {
            assert.equal(state.ownerByExactItemcodeMap.get(code),'jd_jones');
            assert.equal(rows.find(r=>r.ITEMCODE===code).effective_worker,'jd_jones');
        }
        confirm({}); await save;
    }
    console.log('Assigned Items fixture: 9512 rows, 3352 codes, indexed group + search '+filterMs.toFixed(3)+' ms');
}
