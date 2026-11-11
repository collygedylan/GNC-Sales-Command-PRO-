import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = file => readFileSync(new URL('../../' + file,import.meta.url),'utf8')
    .replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const code = ['src/engine/canonical-inventory-evidence.js','src/engine/confirmed-evaluation-ui.js',
    'src/core/request-live-rows.js','src/views/request-detail-summary.js'].map(source).join('\n');

export async function assertExistingSuspendDetailContract() {
    const {detailSaveChecks,suspendUploadFailureChecks} = await import('../../src/core/suspend-detail-save-contract.mjs');
    await detailSaveChecks();
    await suspendUploadFailureChecks();
}

function fixture() {
    const master = {UNIQUE_ID:'master',ITEMCODE:'plant',LOCATIONCODE:'A.01',LOTCODE:'26.F1',PTRONHAND:100,
        SPEC:'stored spec',CALIPER:'2',MATCH:40,AV_NOTE:'server note',PHOTO_LINK:'https://fixture/photo.jpg',PHOTO_DATE:new Date().toISOString()};
    const row = {...master,UNIQUE_ID:'REQ-row',MASTER_ID:'master',REQ_SPEC:'',REQ_CALIPER:'',REQ_MATCH:'',
        REQ_PHOTO_LINK:'',AV_NOTE:'',SOURCE_TABLE:'ph_requests_pending'};
    const state = {noteScope:'account-a',locationSalesNotes:new Map()};
    const drafts = new Map(), events = [], inputs = new Map();
    const context = vm.createContext({
        window:{},scope:'account-a',activeItem:row,activeDetailTab:'request',detailHydrationToken:7,currentUser:'actor',
        masterInventoryById:new Map([['master',master]]),masterInventoryByItemCode:new Map([['PLANT',[master]]]),
        getSupabaseReadIdentityScope:() => context.scope,getManagerAssignedColumnState:() => state,
        readRowEvaluationDraft:(item,prefix) => drafts.get(context.scope+'|'+item.UNIQUE_ID+'|'+prefix) || {},
        getDetailTabPrefix:tab => ({request:'req-',location:'lsn-'})[tab] || '',
        getEditableLocMatchPercentValue:value => String(value ?? ''),
        getEditorLocMatchQtyValue:(item,value) => value === '' ? null : Math.round(item.PTRONHAND * Number(value) / 100),
        getPhotoUrlList:value => Array.isArray(value) ? value.map(entry => entry.url || entry) : String(value || '').split(',').filter(Boolean),
        getPhotoEntryDateMs:(_url,item) => Date.parse(item.PHOTO_DATE),
        getPhotoRetentionFallbackDateMs:item => Date.parse(item.PHOTO_DATE),
        hasConfirmedRequestCompletion:() => false,staleSupabaseReadScopeError:() => new Error('scope changed'),
        document:{getElementById:id => id === 'view-detail' ? {classList:{contains:() => false}} : inputs.get(id) || null},
        isAvDetailReadOnlyContext:() => false,canEditRowDetails:() => true,canCurrentUserWorkRequestItem:() => true,
        isDockSuspendDcRequestMirrorRow:() => false,isProtectedSectionCompleted:() => false,
        getRowSaveCoordinatorKey:() => 'row-key',getRowSaveCoordinatorState:() => ({}),ROW_SAVE_COMPLETE_INTENT_MS:1000,
        prepareMarkDoneCompletionPrompt:() => ({}),openMarkDoneConfirmModal:async () => true,
        getPendingPhotoUploadsForItem:() => [],getDetailRowPhotoUploadPromises:() => [],hasUnsettledDetailRowPhotos:() => false,
        mergeConfirmedRowEvaluationUploads() {},showToast:(title,message) => events.push({title,message}),
        SECURE_DRIVE_EVIDENCE_PREFIXES:new Set(['lsn-','ssn-','na-']),getDriveEvidenceConflictState:() => null,
        isLagSensitiveDetailPrefix:() => true
    });
    vm.runInContext(code,context);
    context.resolveCanonicalInventoryRow = context.projectCanonicalInventoryRow;
    context.captureConfirmedRowEvaluation = item => ({row:{...item},source:item,prefix:'req-',scope:context.scope,
        payload:{spec:item.REQ_SPEC},uploads:[],uploadRows:[item],
        detailNavigation:{ownsEditor:true,editor:item,token:7}});
    context.beginConfirmedRowEvaluationUi = () => {
        events.push({type:'navigate'});
        context.activeItem = null;
        const result = {settled:false,confirmed:false,rollback() { result.settled = true; },
            commit() { result.confirmed = result.settled = true; }};
        return result;
    };
    context.persistConfirmedRowEvaluation = async (complete,prefix,silent,item,options) => {
        events.push({type:complete ? 'complete' : 'draft',item:{...item},prefix,silent});
        if (complete) options.optimisticCompletion?.commit();
        return true;
    };
    return {context,master,row,state,drafts,events,inputs};
}

async function assertCompletionWaitsForPhotos() {
    const f = fixture();
    let finish;
    const upload = new Promise(resolve => { finish = resolve; });
    f.context.getDetailRowPhotoUploadPromises = () => [upload];
    f.context.hasUnsettledDetailRowPhotos = () => true;
    f.row.REQ_SPEC = 'typed spec';
    const saving = f.context.saveData(true,'req-');
    await new Promise(setImmediate);
    assert.equal(f.events.filter(event => event.type === 'draft').length,1);
    assert.equal(f.context.activeItem,f.row);
    assert.equal(f.events.some(event => event.type === 'complete' || event.type === 'navigate'),false);
    f.row.REQ_SPEC = 'later typed spec';
    f.context.hasUnsettledDetailRowPhotos = () => false;
    finish();
    assert.equal(await saving,true);
    assert.equal(f.events.find(event => event.type === 'complete').item.REQ_SPEC,'later typed spec');
}

async function assertFailedPhotoRetainsEditor() {
    for (const failedRpc of [false,true]) {
        const f = fixture();
        f.row.REQ_SPEC = 'retained spec';
        f.context.hasUnsettledDetailRowPhotos = () => true;
        if (failedRpc) f.context.persistConfirmedRowEvaluation = async () => { throw new Error('draft write failed'); };
        assert.equal(await f.context.saveData(true,'req-'),false);
        assert.equal(f.context.activeItem,f.row);
        assert.equal(f.row.REQ_SPEC,'retained spec');
        assert.equal(f.events.some(event => event.type === 'complete' || event.type === 'navigate'),false);
        assert.equal(f.events.some(event => /saved (?:on|to|in) (?:the )?(?:server|Supabase)/i.test(event.message || '')),false);
    }
}

async function assertPhotoHoldRejectsOtherAccount() {
    const f = fixture();
    let finish;
    const upload = new Promise(resolve => { finish = resolve; });
    f.context.getDetailRowPhotoUploadPromises = () => [upload];
    const saving = f.context.saveData(true,'req-');
    await new Promise(setImmediate);
    f.context.scope = 'account-b';
    const replacement = {...f.row,UNIQUE_ID:'REQ-new-account'};
    f.context.activeItem = replacement;
    finish();
    assert.equal(await saving,false);
    assert.equal(f.context.activeItem,replacement);
    assert.equal(f.events.some(event => event.type === 'complete' || event.type === 'navigate'),false);
}

async function assertDirectCompletionCannotBypassPhotoHold() {
    for (const silent of [true,false]) {
        const f = fixture();
        f.context.hasUnsettledDetailRowPhotos = () => true;
        const snapshot = f.context.captureConfirmedRowEvaluation(f.row);
        assert.equal(await f.context.saveData(true,'req-',silent,f.row,
            {markDoneConfirmationAccepted:true,markDoneSnapshot:snapshot}),false);
        assert.equal(f.context.activeItem,f.row);
        assert.equal(f.events.some(event => event.type === 'complete'),false);
        f.context.hasUnsettledDetailRowPhotos = () => false;
        assert.equal(await f.context.saveData(true,'req-',silent,f.row,
            {markDoneConfirmationAccepted:true,markDoneSnapshot:snapshot}),true);
        assert.equal(f.events.filter(event => event.type === 'complete').length,1);
    }
}

async function assertSourceCompletionSkipsActivePhysicalRows() {
    const f = fixture(), complete = new Set();
    const sibling = {...f.row,UNIQUE_ID:'REQ-sibling'};
    const other = {...f.row,UNIQUE_ID:'REQ-other',LOCATIONCODE:'B.01'};
    Object.assign(f.context,{requestsInventory:[f.row,sibling,other],navigator:{onLine:true},
        pendingRequestSourceCompletionReconcileInFlight:false,isRequestPendingVisible:() => true,
        findExactCompletedSourceForPendingRequestRow:row => row,isExactLinkedRequestCompletionMatch:() => true,
        buildLinkedRequestCompletionPayload:() => ({req_status:'Complete'}),yieldToUiFrame:async () => {},
        hasConfirmedRequestCompletion:row => complete.has(row.UNIQUE_ID),persistCurrentCache() {}});
    f.context.saveData = async (...args) => { complete.add(args[3].UNIQUE_ID); };
    assert.equal(await f.context.reconcileExactPendingRequestsFromCompletedSources(),true);
    assert.deepEqual([...complete],['REQ-other']);
}

function assertBlankRefreshKeepsExactEvidence() {
    const f = fixture();
    f.drafts.set('account-a|REQ-row|req-',{'req-spec':'typed spec','req-caliper':'3','req-match':'70','req-av-note':''});
    f.row.__detailEvaluationDraft = {key:f.context.getDetailEvaluationDraftIdentity(f.row),scope:'account-a',prefix:'req-',values:{}};
    const fresh = f.context.mergeRequestLiveCanonicalEvidence({...f.row});
    assert.equal(fresh.UNIQUE_ID,'REQ-row');
    assert.equal(fresh.REQ_SPEC,'typed spec');
    assert.equal(fresh.REQ_CALIPER,'3');
    assert.equal(fresh.REQ_MATCH,'70');
    assert.equal(fresh.LOC_PHOTO_MATCH,70);
    assert.equal(fresh.REQ_PHOTO_LINK,f.master.PHOTO_LINK);
    assert.equal(fresh.AV_NOTE,'','explicit draft clear survives a nonblank table value');
    const canonical = f.context.projectCanonicalInventoryRow(f.master);
    assert.equal(canonical.SPEC,'typed spec');
    assert.equal(canonical.LOC_PHOTO_MATCH,70);
    assert.equal(f.context.mergeRequestLiveCanonicalEvidence({...f.row,LOTCODE:'26.S1',SPEC:''}).REQ_SPEC,'');
    assert.equal(f.context.mergeRequestLiveCanonicalEvidence({...f.row,UNIQUE_ID:'REQ-sibling'}).REQ_SPEC,'stored spec');
    f.context.activeDetailTab = 'location';
    assert.equal(f.context.mergeRequestLiveCanonicalEvidence({...f.row}).REQ_SPEC,'stored spec');
    f.context.activeDetailTab = 'request';
    const reused = {...f.row,LOTCODE:'26.S1',SPEC:''};
    f.context.activeItem = reused;
    assert.equal(f.context.mergeRequestLiveCanonicalEvidence(reused).REQ_SPEC,'','a reused UID cannot restore another lot draft');
    f.context.activeItem = f.row;
    f.context.scope = 'account-b';
    assert.equal(f.context.mergeRequestLiveCanonicalEvidence({...f.row}).REQ_SPEC,'stored spec');
    f.context.scope = 'account-a';
    f.drafts.clear();
    delete f.row.__detailEvaluationDraft;
    f.master.PHOTO_LINK = '';
    f.master.LOC_PHOTO_MATCH = 0;
    const cleared = f.context.mergeRequestLiveCanonicalEvidence({...f.row});
    assert.equal(cleared.REQ_PHOTO_LINK,'','a deliberate canonical depletion does not revive the photo');
}

async function assertInputDispatchesExactSnapshot() {
    const f = fixture();
    f.row.REQ_SPEC = 'first input';
    f.inputs.set('req-spec',{value:'first input'});
    await f.context.queueLagSensitiveInputSave('req-','req-spec');
    f.row.REQ_SPEC = 'next input';
    const sent = f.events.find(event => event.type === 'draft');
    assert.equal(sent.item.REQ_SPEC,'first input');
    assert.equal(sent.item.UNIQUE_ID,'REQ-row');
    assert.equal(f.context.mergeRequestLiveCanonicalEvidence({...f.row,REQ_SPEC:''}).REQ_SPEC,'first input',
        'the row memory draft survives unavailable localStorage');
}

function assertOnlyMatchingReceiptsReleaseDrafts() {
    const f = fixture();
    f.row.__detailEvaluationDraft = {key:f.context.getDetailEvaluationDraftIdentity(f.row),scope:'account-a',prefix:'req-',
        values:{'req-spec':'newer spec','req-av-note':''}};
    const old = {...f.row,REQ_SPEC:'older spec',AV_NOTE:'older note'};
    f.context.acknowledgeDetailEvaluationDraft(f.row,old,'account-a');
    assert.equal(f.row.__detailEvaluationDraft.values['req-spec'],'newer spec');
    f.context.acknowledgeDetailEvaluationDraft({...f.row,UNIQUE_ID:'REQ-sibling'},{...old,REQ_SPEC:'newer spec'},'account-a');
    assert.equal(f.row.__detailEvaluationDraft.values['req-spec'],'newer spec');
    f.context.acknowledgeDetailEvaluationDraft(f.row,{...old,REQ_SPEC:'newer spec'},'account-b');
    assert.equal(f.row.__detailEvaluationDraft.values['req-spec'],'newer spec');
    f.context.acknowledgeDetailEvaluationDraft(f.row,{...old,REQ_SPEC:'newer spec',AV_NOTE:''},'account-a');
    assert.equal(f.row.__detailEvaluationDraft,undefined);
    f.drafts.set('account-a|REQ-row|req-',{'req-spec':'old localStorage draft'});
    assert.equal(f.context.mergeRequestLiveCanonicalEvidence({...f.row}).REQ_SPEC,'stored spec');
}

function assertSuspendDraftNeedsExactSavedLedger() {
    const f = fixture(), key = 'exact-tag-command';
    const snapshot = {scope:'account-a',source:f.row};
    const marker = {key:f.context.getDetailEvaluationDraftIdentity(f.row),scope:'account-a',prefix:'req-',
        values:{'req-spec':'persisted spec','req-caliper':'3','req-match':'70','req-av-note':''}};
    f.row.__detailEvaluationDraft = marker;
    const receipt = {...f.row,REQ_SPEC:undefined,REQ_CALIPER:undefined,REQ_MATCH:undefined,
        DOCK_SPEC:'persisted spec',DOCK_CALIPER:'3',MATCH:70,AV_NOTE:''};
    delete receipt.REQ_SPEC;
    delete receipt.REQ_CALIPER;
    delete receipt.REQ_MATCH;
    const ledger = {scope:'account-b',receipts:{[key]:{row:receipt}}};
    f.context.getDockSuspendCompletionState = () => ledger;
    f.context.acknowledgeSavedSuspendDetailDraft(snapshot,key);
    assert.equal(f.row.__detailEvaluationDraft,marker);
    ledger.scope = 'account-a';
    f.context.acknowledgeSavedSuspendDetailDraft(snapshot,'wrong-tag-command');
    assert.equal(f.row.__detailEvaluationDraft,marker);
    f.context.acknowledgeSavedSuspendDetailDraft(snapshot,key);
    assert.equal(f.row.__detailEvaluationDraft,undefined);
}

export async function assertDetailLiveDraftRetention() {
    await assertCompletionWaitsForPhotos();
    await assertFailedPhotoRetainsEditor();
    await assertPhotoHoldRejectsOtherAccount();
    await assertDirectCompletionCannotBypassPhotoHold();
    await assertSourceCompletionSkipsActivePhysicalRows();
    assertBlankRefreshKeepsExactEvidence();
    await assertInputDispatchesExactSnapshot();
    assertOnlyMatchingReceiptsReleaseDrafts();
    assertSuspendDraftNeedsExactSavedLedger();
}
