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
export async function suspendCloseRetryContract() {
    await suspendClosePaintContract();
    for (const failures of [4, 5]) {
        const delays = [], commands = [];
        const ctx = vm.createContext({
            getSupabaseReadIdentityScope: () => 'account', APP_API_FUNCTION_URL: '/api',
            getDetailRowWriteTimeoutMs: () => 1000, applySuspendCandidateRows() {},
            setTimeout(resolve, delay) { delays.push(delay); resolve(); },
            postAppFunctionJson: async (_, body) => {
                commands.push(body.commandId);
                if (commands.length > failures) return {ok:true, data:{confirmed:true}};
                if (commands.length % 2) throw new Error('SUSPEND_TAG_DATABASE_55P03');
                return {ok:false, code:'lock_not_available'};
            }
        });
        install(ctx, row, ['suspendTagApi']);
        const result = ctx.suspendTagApi('close', {sourceUid:'tag-a'}, {commandId:'one-command'});
        if (failures === 4) assert.equal((await result).confirmed, true);
        else await assert.rejects(result, /55P03/);
        assert.deepEqual(delays, [350,800,1500,2500]);
        assert.deepEqual(commands, Array(5).fill('one-command'));
    }
}

async function suspendClosePaintContract() {
    let finishSave, finishPhoto;
    const save = new Promise(resolve => { finishSave = resolve; });
    const photo = new Promise(resolve => { finishPhoto = resolve; });
    const mirror = {unique_id:'a', revision:1}, events = [];
    const state = {completedSuspendTagKeys:new Set(), begin:()=>true, rollback(){}};
    const ctx = vm.createContext({
        canonicalFeaturePermission:()=>true, findDockSuspendDcRequestMirrorRowByUniqueId:()=>mirror,
        canCurrentUserViewDockSuspendDcRequests:()=>true, canCurrentUserWorkRequestItem:()=>true,
        getSupabaseReadIdentityScope:()=>'actor', getDockSuspendDcRequestSourceUid:r=>r.unique_id,
        canUseProductionLiveSync:()=>false, suspendTagCompletionActions:new Set(), setSuspendTagCardActionsBusy(){},
        getQueueCompletionState:()=>state, getQueueCompletionKey:()=> 'suspend:a:1', getQueueCompletionVersion:()=>1,
        getDockSuspendCompletionRevision:r=>r.revision, findDockSuspendDcRequestSourceRow:()=>mirror,
        getDockSuspendDcRequestCompletionReadiness:()=>({ready:true}), getPendingPhotoUploadsForItem:()=>[photo],
        suspendTagEditorSaves:new Map([['actor|a',new Set([save])]]), suspendTagRowWrites:new Map(),
        paintOptimisticSuspendTagRemoval:()=>events.push('paint'), markViewDirty(){}, yieldToUiFrame:async()=>{},
        invalidateResolvedViewStateCaches(){}, serializeSuspendTagRowWrite:(_,write)=>write(),
        refreshLocalDockSuspendDcRequestState(){}, showToast(){}, suspendTagErrorMessage:String
    });
    install(ctx, runtime, ['closeDockSuspendDcRequestFromCard','runSuspendTagRowCommand']);
    const command = ctx.runSuspendTagRowCommand;
    ctx.runSuspendTagRowCommand = (...args) => {
        if (!args[4]?.serialized) return command(...args);
        events.push([args[0], args[3]]);
        return true;
    };
    const done = ctx.closeDockSuspendDcRequestFromCard('a');
    assert.deepEqual(events, ['paint']);
    assert.ok(state.completedSuspendTagKeys.has('a'));
    finishPhoto();
    await new Promise(setImmediate);
    assert.deepEqual(events, ['paint']);
    mirror.revision = 2;
    finishSave(true);
    await done;
    assert.deepEqual(events, ['paint',['close',2]]);
    assert.equal(state.completedSuspendTagKeys.size, 0);
}

export function queuePillAndTextContract() {
    const ctx = vm.createContext({escapeHtml: value => value.replaceAll('<','&lt;')});
    install(ctx, row, ['normalizeQueueNoteText','escapeQueueNoteText']);
    install(ctx, runtime, ['formatRequestTabCount']);
    for (const value of ["5'H", "5\\'H", "5\\\\'H"]) {
        assert.equal(ctx.normalizeQueueNoteText(value), "5'H");
        assert.equal(ctx.escapeQueueNoteText('<' + value), "&lt;5'H");
    }
    assert.equal(ctx.normalizeQueueNoteText('path\\file\nnext'), 'path\\file\nnext');
    assert.equal(ctx.formatRequestTabCount(125), '125');
    const panel = {};
    Object.assign(ctx, {document:{getElementById:()=>panel}, currentRole:'REP',
        normalizeEvalAssignableUser:String, buildSuspendEvalUserFilter:(_,id)=>id,
        requestCategoryToolbarMarkupByNode:new WeakMap(), syncRequestChromeMarkup:(node,id)=>{node.id=id;}});
    install(ctx, runtime, ['canUseRequestSuspendTagAssignedToFilter']);
    install(ctx, row, ['renderQueueOwnerFilterPanel']);
    for (ctx.currentUser of ['dylan_collyge','megan_kelly','jd_jones','other']) {
        for (const [tab,id] of [['pending','request-eval-user-filter'],['suspend-tag','request-suspend-tag-assigned-filter']]) {
            ctx.renderQueueOwnerFilterPanel(tab, []);
            assert.equal(panel.hidden, ctx.currentUser === 'other');
            if (!panel.hidden) assert.equal(panel.id, id);
        }
    }
    const css = read('assets/app-shell-style-16.css');
    const pills = css.match(/#request-filter-toolbar \.request-category-chip\s*\{([^}]+)\}/)[1];
    for (const rule of ['width: auto !important','min-width: max-content !important','flex: 0 0 auto !important','height: 36px !important']) assert.ok(pills.includes(rule), rule);
    assert.match(css, /#request-filter-toolbar::-webkit-scrollbar\s*\{\s*display: none !important/);
    assert.match(css, /@media\s*\(max-width: 640px\)\s*\{\s*#app-wrapper #request-content [^{]+order-strip\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
    queueCountContract();
}
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
        getQueueCompletionState:()=>null, hasCompletionDateValue:r=>!!r.done, getSuspendTagStatus:()=> 'pending',
    });
    const state = {};
    install(ctx,row,['getActiveAssignedQueueCounts','getPhysicalSuspendTagKey','uniquePhysicalSuspendTags']);
    install(ctx,runtime,['getDockSuspendDcRequestSourceUid','getLatestSocSuspendTagSourceRows','countPendingSuspendTagQueueItems']);
    install(ctx,runtime,['getRequestQueueAlertCount']);
    for (const total of [24,87,89,93,125]) {
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

export async function confirmedPullLocationContract() {
    const tag={UNIQUE_ID:'dock_suspend_dc_tag',ITEMCODE:'008111.031.1',LOCATIONCODE:'0.00.111',COMMONNAME:'Little Lime Punch Hydrangea',CONTSIZE:'#3',DOCK:'40',STOPNUMBER:'40',QUANTITYORDERED:'8',CONSIGNEENAME:'Nursery'};
    const target={UNIQUE_ID:'master',ITEMCODE:tag.ITEMCODE,LOCATIONCODE:'F.14.000',LOTCODE:'L1',SPEC:"5'H"};
    const old={unique_id:'tag',locationcode:'0.00.111',dock:'40',stopnumber:'40',quantityordered:'8'};
    const picked={unique_id:'option',suspend_origin_uid:'tag',locationcode:'F.14.000',lotcode:'L1',itemcode:tag.ITEMCODE,dock:'40',stopnumber:'40',quantityordered:'8',dock_spec:"5'H"};
    const other={unique_id:'sibling',locationcode:'KEEP',dock:'40',stopnumber:'41'};
    const events=[],prompts=[],state={scope:'user',pending:{}};
    let accept=false, writes=0, rejectWrite=false; const commands=[];
    const inventory=[{...target,SPEC:'old'}], av=[{...target,SPEC:'old'}];
    const ctx=vm.createContext({activeItem:tag,currentUser:'user',getSupabaseReadIdentityScope:()=>'user',getManagerAssignedColumnState:()=>state,
        findDockSuspendDcRequestMirrorRowByUniqueId:()=>tag,findDockSuspendDcRequestSourceRow:()=>tag,
        getRequestItemCodeOptionRows:()=>[target],getRequestItemCodeOptionMasterId:r=>r.UNIQUE_ID,
        getDockSuspendDcRequestSourceUid:()=>'tag',resolveCanonicalRowAccess:()=>({canManageLocations:true}),
        getDockSuspendDcRequestGroupParts:()=>({dock:'40',drop:'40',consignee:'Nursery'}),getDockOrderedQtyDisplay:()=>'8',
        isFalseBlockLocation:s=>s==='0.00.111',showAppConfirm:(body,opts)=>{prompts.push([body,opts]);return accept;},
        getDockSuspendCompletionState:()=>state,dockSuspendCompletionInFlight:new Set(),crypto:{randomUUID:()=>'command'},
        suspendTagRowWrites:new Map(),persistDockSuspendCompletionState(){},getSuspendTagStableSourceIdentity:()=>({}),getDockSuspendCompletionRevision:()=>1,getSuspendTagWriteVersion:()=>1,
        buildDockSuspendDcOptionSocEntry:()=>({payload:picked}),socInventory:[{...old},other],socRawSourceRows:[{...old}],suspendTagInventory:[{...old}],suspendTagRawSourceRows:[{...old}],
        upsertRealtimeRow:(rows,r)=>{const i=rows.findIndex(v=>v.unique_id===r.unique_id); if(i<0)rows.push(r);else rows[i]=r;},
        refreshRealtimeDetailLookupIndexes(){},invalidateDockSuspendDcSourceRowLookup(){},refreshLocalDockSuspendDcRequestState(){},markViewDirty(){},isViewVisible:()=>false,scheduleRequestRender(){},
        requestAvOptionsDropdownOpen:true,requestScopedItemsCacheKey:'',showToast:(...args)=>events.push(args),suspendTagErrorMessage:String,
        APP_API_FUNCTION_URL:'/api',getDetailRowWriteTimeoutMs:()=>10000,setTimeout:resolve=>resolve(),
        reconcileConfirmedDriveEvidence:receipt=>{for(const list of [inventory,av]) for(const row of list) if(row.UNIQUE_ID===receipt.row.unique_id) row.SPEC=receipt.row.spec;},
        postAppFunctionJson:async(_,body)=>{const {operation:op,payload}=body;assert.equal(op,'replace_location');assert.deepEqual([...payload.inventoryIds],['master']);
            writes++;commands.push(body.commandId);if(rejectWrite)throw new Error('SUSPEND_TAG_FORBIDDEN');
            if(writes===1)throw new Error('SUSPEND_TAG_DATABASE_55P03');
            assert.equal(ctx.socInventory.find(r=>r.unique_id==='tag').locationcode,'F.14.000');
            const rows=[{...old,suspend_candidate_state:'replaced'},picked];
            return {ok:true,data:{ok:true,rows,inventoryRows:[{unique_id:'master',locationcode:target.LOCATIONCODE,itemcode:tag.ITEMCODE,spec:target.SPEC}]}};
        }
    });
    install(ctx,runtime,['applySuspendCandidateRows','serializeSuspendTagRowWrite']);
    install(ctx,row,['confirmSuspendLocationChange','changeSuspendPullLocation','suspendTagApi','applySuspendTagInventoryReceipt']);
    await ctx.changeSuspendPullLocation(tag.UNIQUE_ID,'master','replace_location');
    assert.equal(prompts[0][1].title,'Confirm Location Change');
    for(const text of ['008111.031.1','Dock 40','Drop 40','Qty 8','0.00.111','F.14.000','Nursery'])assert.ok(prompts[0][0].includes(text),text);
    assert.equal(events.length,0);assert.equal(writes,0);assert.equal(ctx.socInventory[0].locationcode,'0.00.111');
    accept=true;await ctx.changeSuspendPullLocation(tag.UNIQUE_ID,'master','replace_location');
    assert.equal(ctx.suspendTagInventory.length,1);assert.equal(ctx.suspendTagInventory[0].locationcode,target.LOCATIONCODE);
    assert.equal(ctx.socInventory.find(r=>r.unique_id==='option').dock_spec,target.SPEC);
    assert.equal(ctx.socInventory.find(r=>r.unique_id==='sibling'),other);assert.equal(events.at(-1)[0],'Location Changed');
    assert.deepEqual(commands,['command','command']);assert.ok(events.every(e=>!e[2]));
    assert.equal(inventory[0].SPEC,target.SPEC);assert.equal(av[0].SPEC,target.SPEC);
    rejectWrite=true;ctx.socInventory.splice(0,ctx.socInventory.length,{...old},other);
    await ctx.changeSuspendPullLocation(tag.UNIQUE_ID,'master','replace_location');
    assert.equal(events.at(-1)[2],true);assert.equal(ctx.socInventory.find(r=>r.unique_id==='tag').LOCATIONCODE,'0.00.111');
    assert.equal(ctx.socInventory.find(r=>r.unique_id==='sibling'),other);
}
export async function serializedQueueInteractionContract() {
    const state={},calls=[]; let release;
    const ctx=vm.createContext({getSupabaseReadIdentityScope:()=>'a',getDockSuspendDcRequestSourceUid:r=>r.id,suspendTagRowWrites:new Map(),getManagerAssignedColumnState:()=>state});
    install(ctx,runtime,['serializeSuspendTagRowWrite']);
    const subject={id:'tag'}, first=()=>{calls.push('save');return new Promise(resolve=>{release=resolve;});};
    const a=ctx.serializeSuspendTagRowWrite(subject,first,'save'), b=ctx.serializeSuspendTagRowWrite(subject,first,'save');
    const c=ctx.serializeSuspendTagRowWrite(subject,()=>calls.push('close'),'close');
    await new Promise(setImmediate);assert.deepEqual(calls,['save']);release('committed');
    assert.deepEqual(await Promise.all([a,b]),['committed','committed']);await c;assert.deepEqual(calls,['save','close']);
    let modal=false,now=1000;Object.assign(ctx,{Date:{now:()=>now},document:{querySelectorAll:()=>modal?[{closest:()=>null,getClientRects:()=>[{}]}]:[],body:{classList:{contains:()=>false}}},lastUserTouchOrScrollAt:900});
    install(ctx,runtime,['isBackgroundPaintInteractionActive']);assert.equal(ctx.isBackgroundPaintInteractionActive(),true);
    now=1500;assert.equal(ctx.isBackgroundPaintInteractionActive(),false);modal=true;assert.equal(ctx.isBackgroundPaintInteractionActive(),true);
    const delays=[], tokens=[], rowReceipt={ok:true,row:{unique_id:'tag',suspend_tag_status:'completed'}};
    Object.assign(ctx,{APP_API_FUNCTION_URL:'/api',getDetailRowWriteTimeoutMs:()=>1000,applySuspendCandidateRows(){},
        setTimeout:(resolve,delay)=>{delays.push(delay);resolve();},
        postAppFunctionJson:async(_,body)=>{tokens.push(body.commandId);throw Error('network connection lost');}});
    install(ctx,row,['suspendTagApi']);
    const recovered=await ctx.suspendTagApi('complete',{sourceUid:'tag'},{commandId:'mark-done',readCommitted:async()=>rowReceipt});
    assert.equal(recovered,rowReceipt);assert.deepEqual(delays,[300,800,1600]);assert.deepEqual(tokens,Array(4).fill('mark-done'));
}
