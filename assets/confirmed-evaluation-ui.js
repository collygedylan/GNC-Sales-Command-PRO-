
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
    const removed = requestsInventory.find(item => canonicalInventoryRowUid(item) === uid);
    const release = () => {
        if (scope === getSupabaseReadIdentityScope()) clearOptimisticCompletedRows([uid]);
    };
    const rollback = () => {
        if (scope !== getSupabaseReadIdentityScope()) return;
        release();
        if (removed && !hasConfirmedRequestCompletion(removed) && !requestsInventory.some(item => canonicalInventoryRowUid(item) === uid)) {
            requestsInventory.push(removed);
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


async function saveData(isComplete = false, prefix, isSilentAutoSave = false, specificItem = null, options = {}) {
            if (!specificItem && globalThis.isAvDetailReadOnlyContext()) return false;
            if (!isComplete) {
                const field = document.getElementById(String(prefix || '')+'av-note');
                if (field?.dataset.explicitAvNote === '1' && activeItem) options={...options,explicit_av_note:true,explicitAvNoteValue:String(field.value ?? ''),explicitAvNoteOwner:String(activeItem.UNIQUE_ID || activeItem.unique_id || '')};
            }
            if (!isComplete) return globalThis.persistConfirmedRowEvaluation(false,prefix,isSilentAutoSave,specificItem,options);
            if (isSilentAutoSave || options.markDoneConfirmationAccepted) return persistPhotoSettledEvaluation(prefix,isSilentAutoSave,specificItem,options);
            const item = specificItem || activeItem;
            if (!item) return false;
            if (!canEditRowDetails(prefix,item) || (prefix === 'req-' && !canCurrentUserWorkRequestItem(item,isDockSuspendDcRequestMirrorRow(item) ? 'edit' : 'complete'))
                || (prefix !== 'req-' && isProtectedSectionCompleted(prefix,item) && !isProtectedUnlocked(prefix))) {
                showRowEditRestrictedToast(prefix); return false;
            }
            const actionKey = getSupabaseReadIdentityScope() + '|' + getRowSaveCoordinatorKey(prefix,item);
            const actions = window.__agdataMarkDoneActions ||= new Map();
            if (actions.has(actionKey)) return false;
            let finish;
            const token = { finished:new Promise(resolve => { finish = resolve; }) };
            actions.set(actionKey,token);
            let optimistic = null;
            try {
                let snapshot = captureConfirmedRowEvaluation(item,prefix);
                const plan = prepareMarkDoneCompletionPrompt(snapshot.row,prefix);
                if (!await openMarkDoneConfirmModal(plan)) return false;
                if (snapshot.scope !== getSupabaseReadIdentityScope()) return false;
                snapshot = await settleDetailEvaluationPhotos(snapshot);
                if (!snapshot) return false;
                const coordinator = getRowSaveCoordinatorState(getRowSaveCoordinatorKey(prefix,item));
                if (coordinator) coordinator.completionIntentUntil = Date.now() + ROW_SAVE_COMPLETE_INTENT_MS;
                optimistic = beginConfirmedRowEvaluationUi(snapshot);
                if (optimistic.prepareBeforePersist && !await optimistic.prepareBeforePersist()) return false;
                const persistOptions = { ...options, markDoneConfirmationAccepted:true, markDoneSnapshot:snapshot,
                    optimisticCompletion:optimistic, suspendTagValues:snapshot.values || undefined,
                    suspendTagScope:snapshot.scope, suspendTagNavigationSignal:null };
                const pendingSave = globalThis.persistConfirmedRowEvaluation(true,prefix,false,snapshot.row,persistOptions);
                // Independent optional inventory edits may run alongside the canonical save.
                const followups = [pendingSave];
                if (plan.shouldSaveInventory) followups.push(Promise.resolve().then(() => saveInventoryEditMockInlineForm(plan.inventoryForm,{silent:true})));
                const results = await Promise.allSettled(followups);
                if (results[0].status === 'rejected') { optimistic.rollback(); throw results[0].reason; }
                if (!optimistic.settled) optimistic.rollback();
                for (const result of results.slice(1)) if (result.status === 'rejected' || result.value?.ok === false) showToast('Inventory Checks','The row save finished, but inventory edits need retry.',true);
                return optimistic.confirmed;
            } catch (error) {
                if (optimistic?.confirmed) { queueVisibleDatasetCatchup(0); globalThis.reportHandledRuntimeIssue?.('saveData','HANDLED_OPERATION_FAILURE'); return true; }
                optimistic?.rollback(); showToast('Evaluation not saved',error?.message || 'Your draft is retained. Please retry.',true); return false;
            }
            finally {
                if (actions.get(actionKey) === token) actions.delete(actionKey);
                finish();
            }
        }

async function persistPhotoSettledEvaluation(prefix, silent, item, options) {
    const snapshot = options.markDoneSnapshot || captureConfirmedRowEvaluation(item || activeItem,prefix);
    try {
        const settled = await settleDetailEvaluationPhotos(snapshot);
        if (!settled || settled.scope !== getSupabaseReadIdentityScope()) return false;
        return await globalThis.persistConfirmedRowEvaluation(true,prefix,silent,settled.row,{...options,markDoneSnapshot:settled});
    } catch (error) {
        options.optimisticCompletion?.rollback();
        if (!silent) showToast('Evaluation not saved',error?.message || 'Your draft is retained. Please retry.',true);
        return false;
    }
}

async function settleDetailEvaluationPhotos(snapshot) {
    if (snapshot.isSuspend || snapshot.prefix === 'req-' || SECURE_DRIVE_EVIDENCE_PREFIXES.has(snapshot.prefix)) {
        return {...snapshot, uploads:[]};
    }
    const rows = snapshot.uploadRows?.length ? snapshot.uploadRows : [snapshot.source];
    const collect = row => [...getPendingPhotoUploadsForItem(row,snapshot.prefix),
        ...(globalThis.getDetailRowPhotoUploadPromises?.(row,snapshot.prefix) || [])];
    const uploads = [...new Set([...snapshot.uploads,...rows.flatMap(collect)])];
    const unsettled = () => rows.some(row => globalThis.hasUnsettledDetailRowPhotos?.(row,snapshot.prefix));
    if (!uploads.length && !unsettled()) return snapshot;
    await globalThis.persistConfirmedRowEvaluation(false,snapshot.prefix,true,snapshot.row,{markDoneSnapshot:snapshot});
    showToast('Saving','Your entries are retained while the photo finishes uploading.');
    const results = await Promise.allSettled(uploads);
    if (snapshot.scope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
    if (results.some(result => result.status === 'rejected') || unsettled()) {
        showToast('Photos pending','Your entries are retained. Retry the photo to finish this evaluation.',true);
        return null;
    }
    const navigation = snapshot.detailNavigation;
    if (navigation?.ownsEditor && activeItem === navigation.editor && detailHydrationToken === navigation.token) {
        snapshot = captureConfirmedRowEvaluation(snapshot.source,snapshot.prefix);
    }
    mergeConfirmedRowEvaluationUploads(snapshot);
    return snapshot;
}

function getActiveDetailEvaluationDraft(row) {
    const editor = typeof activeItem === 'undefined' ? null : activeItem;
    if (!editor || !canonicalInventorySameLot(editor,row)) return null;
    const rowMaster = canonicalInventoryLinkedUid(row) || canonicalInventoryRowUid(row);
    const editorMaster = canonicalInventoryLinkedUid(editor) || canonicalInventoryRowUid(editor);
    if (rowMaster !== editorMaster) return null;
    if (canonicalInventoryRowUid(row) !== rowMaster && canonicalInventoryRowUid(row) !== canonicalInventoryRowUid(editor)) return null;
    const retained = editor.__detailEvaluationDraft;
    const sameOwner = retained?.scope === getSupabaseReadIdentityScope()
        && retained.key === getDetailEvaluationDraftIdentity(editor);
    if (!sameOwner) return null;
    const activePrefix = typeof getDetailTabPrefix === 'function' && typeof activeDetailTab !== 'undefined'
        ? getDetailTabPrefix(activeDetailTab) : '';
    const prefix = activePrefix || retained.prefix;
    if (!['req-','lsn-','ssn-','na-'].includes(prefix) || retained.prefix !== prefix) return null;
    const draft = {...readRowEvaluationDraft(editor,prefix),...retained.values};
    return Object.keys(draft).length ? {prefix,draft,retained} : null;
}

function getDetailEvaluationDraftIdentity(row) {
    const part = key => String(row?.[key] ?? row?.[key.toLowerCase()] ?? '').trim().toUpperCase();
    return JSON.stringify([canonicalInventoryRowUid(row),part('ITEMCODE'),part('LOCATIONCODE'),canonicalInventoryLot(row)]);
}

function acknowledgeDetailEvaluationDraft(row, receipt, scope) {
    if (scope !== getSupabaseReadIdentityScope() || !canonicalInventorySameLot(row,receipt)) return;
    const saved = getActiveDetailEvaluationDraft(row);
    if (!saved?.retained) return;
    const aliases = {spec:['REQ_SPEC','DOCK_SPEC','SPEC'],caliper:['REQ_CALIPER','DOCK_CALIPER','CALIPER'],
        match:['REQ_MATCH','DOCK_MATCH_PCT','MATCH','LOC_MATCH_PCT'],'av-note':['AV_NOTE'],
        pick:['REQ_PICK','REQ_PIC_NOTE','PICK','PIC_NOTE'],comments:['REQ_COMMENTS','SALES_NOTE','COMMENTS']};
    for (const [id,value] of Object.entries(saved.retained.values)) {
        const field = id.slice(saved.prefix.length);
        const key = (aliases[field] || []).find(key => Object.hasOwn(receipt,key) || Object.hasOwn(receipt,key.toLowerCase()));
        if (!key) continue;
        const stored = receipt[key] ?? receipt[key.toLowerCase()] ?? '';
        if (String(stored).trim() === String(value).trim()) delete saved.retained.values[id];
    }
    if (Object.keys(saved.retained.values).length) return;
    for (const item of [row,typeof activeItem === 'undefined' ? null : activeItem]) {
        if (item?.__detailEvaluationDraft === saved.retained) delete item.__detailEvaluationDraft;
    }
}

function acknowledgeSavedSuspendDetailDraft(snapshot, key) {
    if (!key || snapshot.scope !== getSupabaseReadIdentityScope()) return;
    const state = getDockSuspendCompletionState();
    const receipt = state.scope === snapshot.scope ? state.receipts?.[key] : null;
    if (receipt?.row) acknowledgeDetailEvaluationDraft(snapshot.source,receipt.row,snapshot.scope);
}

function applyActiveDetailEvaluationDraft(result, row) {
    if (typeof readRowEvaluationDraft !== 'function') return result;
    const saved = getActiveDetailEvaluationDraft(row);
    if (!saved) return result;
    const {prefix,draft} = saved;
    if (saved.retained) result.__detailEvaluationDraft = saved.retained;
    const fields = {spec:['SPEC'],caliper:['CALIPER'],match:['MATCH','MATCH_PCT','LOC_MATCH_PCT'],
        'av-note':['AV_NOTE'],pick:['PIC_NOTE','PICK_NOTE','PICK'],comments:['SALES_NOTE','COMMENTS']};
    for (const [field,keys] of Object.entries(fields)) {
        const id = prefix + field;
        if (!Object.hasOwn(draft,id)) continue;
        const value = field === 'match' ? getEditableLocMatchPercentValue(draft[id]) : String(draft[id] ?? '');
        for (const key of keys) result[key] = result[key.toLowerCase()] = value;
        if (prefix === 'req-') {
            const key = field === 'av-note' ? 'AV_NOTE' : 'REQ_' + field.toUpperCase();
            result[key] = result[key.toLowerCase()] = value;
        }
        if (field !== 'match') continue;
        const quantity = calculateCanonicalLocPhotoMatch(result,value);
        result.LOC_PHOTO_MATCH = result.loc_photo_match = result.LOC_MATCH_QTY = result.loc_match_qty = quantity;
    }
    return result;
}
