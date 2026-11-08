async function prepareSuspendDetailSource(row,options,writeScope,writeNavigation) {
    const source = findDockSuspendDcRequestSourceRow(row) || row;
    const uploads = [...new Set([...(options.markDoneSnapshot?.uploads || []), ...getPendingPhotoUploadsForItem(row,'req-'), ...getPendingPhotoUploadsForItem(source,'req-')])];
    await Promise.all(uploads);
    if (options.markDoneSnapshot) mergeConfirmedRowEvaluationUploads(options.markDoneSnapshot);
    if (writeScope !== getSupabaseReadIdentityScope()) return null;
    if (writeNavigation && (writeNavigation.aborted || writeNavigation !== productionLiveSyncNavigation.signal)) return null;
    if (options.force_clear_photos !== true) {
        syncDockSuspendDcRequestPhotoAliases(row,source);
        if (!options.markDoneSnapshot) {
            restoreCapturedPhotoFields(row,'req-');
            mergeActiveItemDetailPhotoFields(row,'req-');
        }
    }
    return source;
}

function buildSuspendDetailPatch(row,source,values,options,completing) {
    const forceClearPhotos = options.force_clear_photos === true;
                const photo = forceClearPhotos ? row.REQ_PHOTO_LINK || '' : mergePhotoCsvList([row.REQ_PHOTO_LINK,row.REQUEST_PHOTO_LINK,row.DOCK_PHOTO_LINK,source.DOCK_PHOTO_LINK,source.dock_photo_link]);
                const names = forceClearPhotos ? row.REQ_PHOTO_NAME || '' : mergePhotoCsvList([row.REQ_PHOTO_NAME,row.REQUEST_PHOTO_NAME,row.DOCK_PHOTO_NAME,source.DOCK_PHOTO_NAME,source.dock_photo_name]);
                const patch = { dock_spec: values.spec || source.DOCK_SPEC || source.dock_spec || 'N/A', dock_caliper: values.caliper || null,
                    dock_note: buildDockSuspendDcRequestNote(values, firstNonEmptyValue(source.DOCK_NOTE,source.dock_note,'')) || null,
                    dock_photo_link: photo || null, dock_photo_name: names || null, av_note: values.avNote || null,
                    match: null, loc_match_qty: null, initial_ptr: null };
                applyExplicitAvNotePayload(patch,row,options);
                if (forceClearPhotos) Object.assign(patch,{force_clear_photos:true,dock_photo_link:photo,dock_photo_name:names});
                if (completing) {
                    patch.pick_note = values.pick || null;
                    patch.sales_note = values.comments || null;
                }
                if (values.match !== '') {
                    patch.match = getLocMatchPercentPayloadValue(values.match);
                    const metrics = buildQueueInventoryMetricsHtml(row,'request',{detailMetrics:true});
                    patch.loc_match_qty = calculateDockSuspendDcRequestLocMatchQty(metrics,values.match);
                    patch.initial_ptr = getDockSuspendDcRequestLocMatchBaselinePtr(metrics);
                }
    return patch;
}

function captureSuspendDetailTarget(target,patch) {
    const fields = Object.keys(patch).flatMap(key => [key,key.toUpperCase()]);
    return {target,fields:fields.map(key => [key,Object.hasOwn(target,key),target[key]])};
}

function restoreSuspendDetailTarget(snapshot) {
    for (const [key,exists,value] of snapshot.fields) {
        if (exists) snapshot.target[key] = value;
        else delete snapshot.target[key];
    }
}

function beginSuspendDetailOptimisticPatch(row,source,patch,writeScope) {
    const targets = [...new Set([row,source])];
    const snapshots = targets.map(target => captureSuspendDetailTarget(target,patch));
    for (const target of targets) for (const [key,value] of Object.entries(patch)) {
        target[key] = value;
        target[key.toUpperCase()] = value;
    }
    return () => {
        if (writeScope !== getSupabaseReadIdentityScope()) return;
        snapshots.forEach(restoreSuspendDetailTarget);
        scheduleRequestRender(0,0,true);
    };
}

function handleSuspendDetailSaveError(error,options,undo,isSilentAutoSave,writeScope) {
    if (options.optimisticCompletion?.confirmed) {
        queueVisibleDatasetCatchup(0);
        globalThis.reportHandledRuntimeIssue?.('saveData','HANDLED_OPERATION_FAILURE');
        return true;
    }
    undo?.();
    options.optimisticCompletion?.rollback();
    if (!isSilentAutoSave && writeScope === getSupabaseReadIdentityScope()) showToast('Save Stopped', suspendTagErrorMessage(error), true);
    return false;
}

async function saveDockSuspendDcRequestMirrorData(isComplete = false, item = activeItem, isSilentAutoSave = false, options = {}) {
            const row = item || activeItem;
            if (!row || !isDockSuspendDcRequestMirrorRow(row)) return false;
            const writeScope = options.suspendTagScope || getSupabaseReadIdentityScope();
            const writeNavigation = options.markDoneConfirmationAccepted ? null : options.suspendTagNavigationSignal || (canUseProductionLiveSync() ? productionLiveSyncNavigation.signal : null);
            if (writeScope !== getSupabaseReadIdentityScope()) return false;
            const values = options.suspendTagValues || getDockSuspendDcRequestFormValues(row);
            if (!canCurrentUserViewDockSuspendDcRequests()) return true;
            if (!canUseProductionLiveSync() && !requireCurrentSuspendTagWriteProof('saving row changes', row)) return true;
            if (['awaiting_rep','approved'].includes(getSuspendTagStatus(row))) {
                if (!isSilentAutoSave) showToast('Review Locked', 'This saved review is awaiting a decision or already approved.', true);
                return true;
            }
            if (!canCurrentUserWorkRequestItem(row, 'edit')) return true;
            const button = document.getElementById('req-btn-save-complete');
            const completing = isComplete || options.completeSuspendTag;
            const savedDraft = readRowEvaluationDraft(row,'req-');
            const tagUid = getDockSuspendDcRequestSourceUid(row), returnState = detailReturnState;
            const returnToRequestAfterCompletion = completing && !isSilentAutoSave && tagUid && isViewVisible('detail')
                && getDockSuspendDcRequestSourceUid(activeItem) === tagUid;
            // Blur autosaves share the row coordinator. Disabling Mark Done
            // during a blur can swallow the user's subsequent tap on iOS.
            if (button && completing) button.disabled = true;
            let undoOptimisticEvidence = null;
            try {
                const source = await prepareSuspendDetailSource(row,options,writeScope,writeNavigation);
                if (!source) return false;
                const patch = buildSuspendDetailPatch(row,source,values,options,completing);
                const draftKey=getSuspendTagFormDraftKey();
                if (completing && !options.optimisticCompletion) undoOptimisticEvidence = beginSuspendDetailOptimisticPatch(row,source,patch,writeScope);
                const pendingSave = publishRowEvaluationToMasterAndNotes(row,patch,{suspendCompletionScope:writeScope,preserveNavigation:!completing,
                    ...(completing ? {memoryRollback:options.optimisticCompletion?.rollbackEvidence,onConfirmed:options.optimisticCompletion?.commit} : {})});
                if (returnToRequestAfterCompletion && returnState === detailReturnState && getDockSuspendDcRequestSourceUid(activeItem) === tagUid) {
                    goBackFromDetail();
                    showToast('Saving','Task completion is saving in the background.');
                }
                const applied = await pendingSave;
                if (!applied && completing) { undoOptimisticEvidence?.(); options.optimisticCompletion?.rollback(); return false; }
                if (applied) options.optimisticCompletion?.commit();
                if (applied && suspendTagFormDrafts.has(draftKey)) {
                    const nextKey=getSuspendTagFormDraftKey();
                    if (nextKey!==draftKey) { suspendTagFormDrafts.set(nextKey,suspendTagFormDrafts.get(draftKey)); suspendTagFormDrafts.delete(draftKey); }
                }
                restoreSuspendTagFormDraft();
                if (applied && !isSilentAutoSave && writeScope === getSupabaseReadIdentityScope()) showToast(completing ? 'Success' : 'Saved', completing ? 'Task Completed!' : 'Suspend Tag review saved.');
                if (applied) {
                    clearSavedRowEvaluationDraft(row,'req-',savedDraft);
                    const key = getSuspendTagFormDraftKey(row);
                    const remaining = readRowEvaluationDraft(row,'req-');
                    if (Object.keys(remaining).length) suspendTagFormDrafts.set(key,remaining);
                    else suspendTagFormDrafts.delete(key);
                }
            } catch (error) {
                return handleSuspendDetailSaveError(error,options,undoOptimisticEvidence,isSilentAutoSave,writeScope);
            }
            finally { restoreSuspendTagFormDraft(); if (button && completing) { button.disabled = false; button.innerText = 'MARK DONE'; } }
            return true;
        }

