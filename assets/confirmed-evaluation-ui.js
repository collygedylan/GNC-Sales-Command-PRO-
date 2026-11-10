
function applyRequestWorkValuesToItem(item, values = {}) {
    if (!item || !values || typeof values !== 'object') return;
    // The draft can retain completion intent, while lifecycle follows the receipt.
    const aliases = {
        req_match:['REQ_MATCH','req_match'], req_spec:['REQ_SPEC','req_spec'], req_caliper:['REQ_CALIPER','req_caliper'],
        req_pic_note:['REQ_PIC_NOTE','req_pic_note','REQ_PICK','req_pick','PICKNOTE','picknote'],
        req_comments:['REQ_COMMENTS','req_comments','REQUEST_COMMENTS','request_comments','COMMENTS','comments'],
        req_reserve:['REQ_RESERVE','req_reserve'], av_note:['AV_NOTE','av_note'],
        req_photo_link:['REQ_PHOTO_LINK','req_photo_link'], req_photo_name:['REQ_PHOTO_NAME','req_photo_name']
    };
    for (const [field,value] of Object.entries(values)) {
        for (const key of aliases[field] || []) item[key] = value ?? '';
    }
}

function startEvaluationRequestRemoval(uid, scope) {
    if (!uid || optimisticCompletedRowIds.has(uid)) return null;
    const removed = requestsInventory.filter(item => canonicalInventoryRowUid(item) === uid);
    const release = () => {
        if (scope === getSupabaseReadIdentityScope()) clearOptimisticCompletedRows([uid]);
    };
    const rollback = () => {
        if (scope !== getSupabaseReadIdentityScope()) return;
        release();
        if (!requestsInventory.some(item => canonicalInventoryRowUid(item) === uid)) {
            requestsInventory.push(...removed.filter(item => !hasConfirmedRequestCompletion(item)));
        }
        refreshRealtimeDetailLookupIndexes(ACTIVE_REQUEST_TABLE);
        refreshLocalRequestViewState('request-complete-retry',{forceRender:true,preferImmediate:true,userAction:true});
    };
    rollback.commit = release;
    try {
        requestsInventory = requestsInventory.filter(item => canonicalInventoryRowUid(item) !== uid);
        trackOptimisticCompletedRows([uid]);
        globalThis.prunePendingRequestCards(requestsInventory);
    } catch (error) {
        rollback();
        throw error;
    }
    return rollback;
}

function backUpConfirmedEvaluationDraft(snapshot, isRequest) {
    const {row,source,requestBaseValues} = snapshot;
    const requestDraft = isRequest ? createRequestWorkDraft(row,{
        req_spec:row.REQ_SPEC,req_caliper:row.REQ_CALIPER,req_match:row.REQ_MATCH,
        req_pic_note:row.REQ_PICK,req_comments:row.REQ_COMMENTS,av_note:row.AV_NOTE,
        req_photo_link:row.REQ_PHOTO_LINK,req_photo_name:row.REQ_PHOTO_NAME
    },requestBaseValues ?? getRequestWorkValuesFromRow(source),true) : null;
    backupLocalItem(row,requestDraft);
}

function prepareConfirmedEvaluationUi(snapshot, undo, isRequest) {
    const {row,source,prefix,scope,isSuspend,payload,uploadRows} = snapshot;
    if (isRequest) refreshRealtimeDetailLookupIndexes(ACTIVE_REQUEST_TABLE);
    const target = resolveEvaluationProjectionTarget(row,source);
    const suspendUid = isSuspend ? getDockSuspendDcRequestSourceUid(source) : '';
    const dockNote = suspendUid ? buildDockSuspendDcRequestNote(snapshot.values,source.DOCK_NOTE || '') : '';
    undo.undoEvidence = beginRowEvaluationMemoryPublication(target,payload,scope,{source,prefix,suspendUid,dockNote,uploadRows});
    undo.undoCompletion = target ? beginOptimisticCompletedRow(target,prefix,{...payload}) : null;
    backUpConfirmedEvaluationDraft(snapshot,isRequest);
}

function refreshPendingCompletionViews() {
    refreshLocalRequestViewState('row-completion-pending',{forceRender:true,preferImmediate:true,userAction:true});
}

function waitForRequestCompletionPaint() {
    return new Promise(resolve => {
        let frame, task;
        const finish = () => {
            clearTimeout(deadline);
            if (frame != null) cancelAnimationFrame(frame);
            if (task != null) clearTimeout(task);
            resolve();
        };
        const deadline = setTimeout(finish, 200);
        if (!document.hidden && typeof requestAnimationFrame === 'function') {
            frame = requestAnimationFrame(() => { task = setTimeout(finish, 0); });
        }
    });
}

function deferRequestCompletionPreparation(snapshot, undo, state) {
    let pending;
    return () => pending ||= waitForRequestCompletionPaint().then(() => {
        if (state.settled || snapshot.scope !== getSupabaseReadIdentityScope()) {
            state.rollback();
            return false;
        }
        prepareConfirmedEvaluationUi(snapshot, undo, true);
        refreshPendingCompletionViews();
        return true;
    }).catch(error => {
        state.rollback();
        throw error;
    });
}

function beginConfirmedRowEvaluationUi(snapshot) {
    const {row,prefix,scope,isSuspend} = snapshot;
    if (scope !== getSupabaseReadIdentityScope()) return {settled:true,confirmed:false,rollback() {}};
    const isRequest = prefix === 'req-' && !isSuspend;
    const undo = {scope};
    const state = createConfirmedEvaluationUiState(undo);
    try {
        if (isRequest) {
            undo.undoRemoval = startEvaluationRequestRemoval(canonicalInventoryRowUid(row), scope);
            returnFromConfirmedEvaluationDetail(snapshot);
            paintFooterRequestBadgeOnly();
            state.prepareBeforePersist = deferRequestCompletionPreparation(snapshot, undo, state);
        } else {
            prepareConfirmedEvaluationUi(snapshot, undo, false);
            returnFromConfirmedEvaluationDetail(snapshot);
            if (isSuspend) refreshPendingCompletionViews();
        }
        showToast('Saving','Your work is saving in the background.');
    } catch (error) {
        state.rollback();
        throw error;
    }
    return state;
}

function createConfirmedEvaluationUiState(undo) {
    let evidenceRolledBack = false, completionRolledBack = false;
    const state = {settled:false,confirmed:false};
    state.rollbackCompletion = () => {
        if (completionRolledBack || state.confirmed || undo.scope !== getSupabaseReadIdentityScope() || undo.undoEvidence?.isCurrent?.() === false) return;
        completionRolledBack=true;
        undo.undoCompletion?.();
    };
    state.rollbackEvidence = () => {
        if (evidenceRolledBack || state.confirmed) return;
        state.rollbackCompletion();
        evidenceRolledBack=true;
        undo.undoEvidence?.();
    };
    state.commit = () => {
        if (state.confirmed) return;
        const firstSettlement = !state.settled;
        state.confirmed=true;
        state.settled=true;
        try { undo.undoEvidence?.commit?.(); }
        finally { if (firstSettlement) undo.undoRemoval?.commit?.(); }
    };
    state.rollback = () => {
        if (state.settled) return;
        state.settled=true;
        try { state.rollbackEvidence(); }
        finally { undo.undoRemoval?.(); }
    };
    return state;
}
