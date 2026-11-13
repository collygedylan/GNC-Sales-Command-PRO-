async function resolveSuspendPhotoMaster(item, signal) {
    if (!canCurrentUserWorkRequestItem(item, 'photo')) throw new Error('SUSPEND_TAG_FORBIDDEN');
    const scope = getSupabaseReadIdentityScope();
    const source = findDockSuspendDcRequestSourceRow(item) || item;
    const identity = getSuspendTagInventoryIdentity(item, source);
    const linked = findLinkedMasterRow(item) || getQueueCardInventoryRow(item, 'request');
    const master = matchesSuspendTagInventoryIdentity(linked, identity)
        ? linked
        : await resolveSuspendTagInventoryRow(item, source, identity, { signal });
    if (signal.aborted || scope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
    if (!master || !(master.UNIQUE_ID || master.unique_id)) throw new Error('Exact inventory row is required.');
    return master;
}

async function prepareSuspendDetailSource(row,options,writeScope) {
    const source = findDockSuspendDcRequestSourceRow(row) || row;
    if (options.markDoneSnapshot) mergeConfirmedRowEvaluationUploads(options.markDoneSnapshot);
    if (writeScope !== getSupabaseReadIdentityScope()) return null;
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
    if (!isSilentAutoSave && writeScope === getSupabaseReadIdentityScope()) showToast('Evaluation not saved', suspendTagErrorMessage(error), true);
    return false;
}

async function saveDockSuspendDcRequestMirrorData(isComplete = false, item = activeItem, isSilentAutoSave = false, options = {}) {
            const row = item || activeItem;
            if (!row || !isDockSuspendDcRequestMirrorRow(row)) return false;
            const writeScope = options.suspendTagScope || getSupabaseReadIdentityScope();
            if (writeScope !== getSupabaseReadIdentityScope()) return false;
            const values = options.suspendTagValues || getDockSuspendDcRequestFormValues(row);
            if (!canCurrentUserViewDockSuspendDcRequests()) return false;
            if (!canUseProductionLiveSync() && !requireCurrentSuspendTagWriteProof('saving row changes', row)) return true;
            if (['awaiting_rep','approved'].includes(getSuspendTagStatus(row))) {
                if (!isSilentAutoSave) showToast('Review Locked', 'This saved review is awaiting a decision or already approved.', true);
                return true;
            }
            if (!canCurrentUserWorkRequestItem(row, 'edit')) return false;
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
                const source = await prepareSuspendDetailSource(row,options,writeScope);
                if (!source) return false;
                const patch = buildSuspendDetailPatch(row,source,values,options,completing);
                const draftKey=getSuspendTagFormDraftKey();
                if (completing && !options.optimisticCompletion) undoOptimisticEvidence = beginSuspendDetailOptimisticPatch(row,source,patch,writeScope);
                const pendingSave = publishRowEvaluationToMasterAndNotes(row,patch,{suspendCompletionScope:writeScope,
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


async function changeSuspendPullLocation(uniqueId, masterUid, operation, splitQuantity = null, customRow = null) {
    const source = findDockSuspendDcRequestMirrorRowByUniqueId(uniqueId);
    if (!source || !resolveCanonicalRowAccess(currentUser, source).canManageLocations || !['replace_location','split_location','remove_location'].includes(operation)) return false;
    if (operation === 'split_location' && (!Number.isFinite(Number(splitQuantity)) || Number(splitQuantity) <= 0)) {
        showToast('Split Quantity','Enter the quantity to pull from this location.',true);
        return false;
    }
    const target = customRow || (masterUid && getRequestItemCodeOptionRows(source).find(row => getRequestItemCodeOptionMasterId(row) === masterUid));
    if (operation !== 'remove_location' && (!target || isFalseBlockLocation(target.LOCATIONCODE || target.locationcode))) return false;
    const scope = getSupabaseReadIdentityScope();
    const next = target && (target.LOCATIONCODE || target.locationcode);
    const old = source.LOCATIONCODE || source.locationcode;
    const reviewed = getSuspendTagStableSourceIdentity(source);
    if (next && operation === 'replace_location' && !await confirmSuspendLocationChange(source, [next])) return false;
    if (scope !== getSupabaseReadIdentityScope()) return false;
    const sourceUid = getDockSuspendDcRequestSourceUid(source);
    const key = JSON.stringify([operation,sourceUid,masterUid,customRow,splitQuantity,reviewed]);
    const command = { source, sourceUid, target, masterUid, operation, splitQuantity, customRow, reviewed, scope, old, next, key };
    return serializeSuspendTagRowWrite(source, () => commitSuspendPullLocation(command), key);
}

async function readCommittedFinalSuspendPull({ operation, scope, original, sourceUid, next, target, masterUid }) {
    if (operation !== 'replace_location' || scope !== getSupabaseReadIdentityScope()) return null;
    const page = query => fetchAuthenticatedSupabaseReadPage('ph_soc_master', 'select=*&' + query);
    const origin = original.SUSPEND_ORIGIN_UID || original.suspend_origin_uid || sourceUid;
    const prior = (await page('unique_id=eq.' + encodeURIComponent(origin) + '&limit=1')).rows?.[0];
    if (!prior || prior.unique_id !== origin || scope !== getSupabaseReadIdentityScope() || prior.suspend || !prior.date_completed ||
        prior.suspend_candidate_state !== 'approved' || prior.locationcode !== next || String(prior.lotcode || '') !== String(target.LOTCODE || target.lotcode || '')) return null;
    const rows = (await page('suspend_origin_uid=eq.' + encodeURIComponent(origin) + '&limit=1000')).rows || [];
    if (rows.some(row => row.suspend || !row.date_completed)) return null;
    const inventory = await fetchAuthenticatedSupabaseReadPage('ph_master_inventory','select=*&unique_id=eq.' + encodeURIComponent(masterUid) + '&limit=1');
    return inventory.rows?.length === 1 ? {ok:true,finalPull:true,originUid:origin,rows:[prior,...rows.filter(row => row.unique_id !== origin)],inventoryRows:inventory.rows} : null;
}

function stageSuspendPullRemoval(snapshot, operation) {
    if (operation !== 'remove_location') return false;
    applySuspendCandidateRows([{...snapshot,suspend_candidate_state:'replaced',suspend:null,suspend_to:null,quantityordered:'0'}]);
    return true;
}

function prepareSuspendPullLocation(command) {
    const { source, sourceUid, masterUid, operation, splitQuantity, customRow, reviewed, scope, key } = command;
    const original = findDockSuspendDcRequestSourceRow(source) || source;
    if (scope !== getSupabaseReadIdentityScope() || JSON.stringify(getSuspendTagStableSourceIdentity(original)) !== JSON.stringify(reviewed)
        || !resolveCanonicalRowAccess(currentUser, original).canManageLocations) return null;
    const state = getDockSuspendCompletionState();
    const snapshot = Object.fromEntries(Object.entries(original).map(([key,value])=>[key.toLowerCase(),value]));
    snapshot.unique_id = sourceUid;
    const pending = state.pending[key] || {requestId:crypto.randomUUID(),savedAt:Date.now()};
    const payload = {sourceUid,...(operation==='replace_location' ? {finalPull:true} : {}),sourceIdentity:reviewed,expectedLastUpdated:getDockSuspendCompletionRevision(original),inventoryIds:masterUid?[masterUid]:[],
        ...(customRow ? {customRows:[customRow]} : {}), ...(operation==='split_location'?{splitQuantity:Number(splitQuantity)}:{})};
    // An uncertain retry must replay exactly the original command, including its version.
    pending.payload ||= payload;
    if (!Object.hasOwn(pending,'version')) pending.version = getSuspendTagWriteVersion(source);
    state.pending[key]=pending; persistDockSuspendCompletionState(state);
    return { ...command, original, snapshot, state, pending };
}

async function commitSuspendPullLocation(command) {
    const prepared = prepareSuspendPullLocation(command);
    if (!prepared) return false;
    const { operation, scope, original, target, sourceUid, state, pending, snapshot, key, old, next } = prepared;
    const preview = stageSuspendPullRemoval(snapshot, operation);
    try {
        const result = await suspendTagApi(operation, pending.payload, {
            commandId:pending.requestId, expectedVersion:pending.version,
            readCommitted:() => readCommittedFinalSuspendPull(prepared),
            validateReceipt: operation === 'replace_location' ? receipt => matchesFinalSuspendPullReceipt(receipt, original, target, sourceUid) : null
        });
        if (scope !== getSupabaseReadIdentityScope()) return false;
        if (!result?.ok || !Array.isArray(result.rows)) throw new Error('The order line was not confirmed. Retry safely.');
        const order = getDockSuspendDcRequestGroupParts(original);
        delete state.pending[key]; persistDockSuspendCompletionState(state);
        requestAvOptionsDropdownOpen=false;
        if (isViewVisible('detail')) {lastView='request';goBackFromDetail();}
        scheduleRequestRender(0,16,true);
        if (operation === 'replace_location') showToast('Location Changed', 'Updated ' + old + ' → ' + next + ' across Suspend Tag, Drive Mode, and Dock ' + order.dock + ' · Drop ' + order.drop + '.');
        else showToast('Location Saved','The exact Dock and Drop now use the confirmed pull locations.');
    } catch (error) {
        if (scope !== getSupabaseReadIdentityScope()) return false;
        if (preview) applySuspendCandidateRows([snapshot]);
        showToast('Location Not Saved',suspendTagErrorMessage(error),true);
    }
    return false;
}


async function runSuspendTagRowCommand(operation, mirror, patch = {}, expectedRevision = getDockSuspendCompletionRevision(mirror), options = {}) {
    if (options.completionScope && options.completionScope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
    if (['save', 'complete', 'close', 'send', 'retry'].includes(operation) && !options.serialized) {
        return runSerializedSuspendCommand(operation, mirror, patch, expectedRevision, options, runSuspendTagRowCommand);
    }
    const photoOnly = operation === 'save' && Object.keys(patch).length === 2
        && Object.keys(patch).every(key => ['dock_photo_link', 'dock_photo_name'].includes(key))
        && isCurrentSuspendTagPhotoProof(options.photoProof, mirror)
        && expectedRevision === getDockSuspendCompletionRevision(options.photoProof.row);
    const sourceUid = getDockSuspendDcRequestSourceUid(mirror);
    const state = getDockSuspendCompletionState();
    const localSource = findDockSuspendDcRequestSourceRow(mirror) || mirror;
    if (patch.force_clear_photos !== true && !photoOnly && ['save', 'complete'].includes(operation) && Object.prototype.hasOwnProperty.call(patch, 'dock_photo_link')) {
        patch = { ...patch,
            dock_photo_link: mergePhotoCsvList([patch.dock_photo_link, localSource.DOCK_PHOTO_LINK, localSource.dock_photo_link]) || null,
            dock_photo_name: mergePhotoCsvList([patch.dock_photo_name, localSource.DOCK_PHOTO_NAME, localSource.dock_photo_name]) || null };
    }
    const retryKey = JSON.stringify([operation, sourceUid, expectedRevision, getSuspendTagWriteVersion(mirror), patch]);
    const retryCommand = state.pending[retryKey] ? { ...state.pending[retryKey], key: retryKey } : null;
    // Verify this exact row and its permissions independently of the
    // broader view, including the second command after completion.
    const writeProof = !photoOnly && operation !== 'close' && ['send', 'retry'].includes(operation) && canUseProductionLiveSync()
        ? await loadCurrentSuspendTagWriteRow(mirror, operation, retryCommand) : null;
    if (writeProof && !isCurrentSuspendTagWriteRowProof(writeProof, mirror, operation)) throw new Error('SUSPEND_TAG_FORBIDDEN');
    if ((!photoOnly && !['save', 'complete', 'close'].includes(operation) && !writeProof && !requireCurrentSuspendTagWriteProof(operation, mirror)) || !canCurrentUserViewDockSuspendDcRequests(mirror)) throw new Error('SUSPEND_TAG_FORBIDDEN');
    const source = photoOnly ? options.photoProof.row : writeProof?.row || findDockSuspendDcRequestSourceRow(mirror) || mirror;
    if (patch.force_clear_photos !== true && !photoOnly && !writeProof?.retry && ['save', 'complete'].includes(operation) && Object.prototype.hasOwnProperty.call(patch, 'dock_photo_link')) {
        patch = { ...patch,
            dock_photo_link: mergePhotoCsvList([patch.dock_photo_link, source.DOCK_PHOTO_LINK, source.dock_photo_link]) || null,
            dock_photo_name: mergePhotoCsvList([patch.dock_photo_name, source.DOCK_PHOTO_NAME, source.dock_photo_name]) || null };
    }
    const receiptScope = getSupabaseReadIdentityScope();
    const version = operation === 'close' ? null : writeProof?.retry ? writeProof.version : photoOnly || writeProof ? source.suspend_tag_version : Number(firstNonEmptyValue(mirror.suspend_tag_version,mirror.SUSPEND_TAG_VERSION,source.suspend_tag_version,source.SUSPEND_TAG_VERSION,0));
    const key = JSON.stringify([operation,sourceUid,expectedRevision,version,patch]);
    const flightKey = state.scope + '|' + sourceUid;
    if (dockSuspendCompletionInFlight.has(flightKey)) return false;
    if (photoOnly) suspendTagPhotoProofs.delete(options.photoProof);
    if (writeProof) suspendTagWriteProofs.delete(writeProof);
    const pending = state.pending[key] || { requestId: crypto.randomUUID(), savedAt: Date.now() };
    state.pending[key] = pending; persistDockSuspendCompletionState(state);
    dockSuspendCompletionInFlight.add(flightKey);
    try {
        const commandPayload = ['save', 'complete', 'close'].includes(operation)
            ? { sourceUid, sourceIdentity: { ...getSuspendTagStableSourceIdentity(mirror), ...(options.inventoryMasterUid ? {masterUid:options.inventoryMasterUid} : {}) }, expectedLastUpdated: expectedRevision, patch }
            : { sourceUid, expectedLastUpdated: expectedRevision, patch };
        return await executeSuspendRowCommand({ operation, mirror, patch, expectedRevision, options, photoOnly, sourceUid,
            state, source, version, pending, key, commandPayload, receiptScope, writeProof });
    } finally { dockSuspendCompletionInFlight.delete(flightKey); }
}

async function runSerializedSuspendCommand(operation, mirror, patch, expectedRevision, options, submit) {
    const navigationSignal = options.completionScope ? null : canUseProductionLiveSync() ? productionLiveSyncNavigation.signal : null;
    const completion = ['complete', 'close'].includes(operation) && !options.keepVisible ? getQueueCompletionState() : null;
    const completionKey = completion ? getQueueCompletionKey(mirror) : '';
    if (completion && !completion.begin(completionKey, getQueueCompletionVersion(mirror))) return false;
    const closingUid = operation === 'close' ? getDockSuspendDcRequestSourceUid(mirror) : '';
    let committedClose = false;
    const closingScope = getSupabaseReadIdentityScope(), removedSuspendRows = [];
    if (closingUid) removePendingSuspendCloseRows(closingUid, removedSuspendRows);
    if (closingUid) completion?.completedSuspendTagKeys?.add(closingUid);
    try {
        if (completion) {
            paintOptimisticSuspendTagRemoval(mirror);
            markViewDirty('request'); markViewDirty('reports'); markViewDirty('docks');
        }
        if (options.prepareClose && !await options.prepareClose()) return false;
        if (completion) {
            // Paint the pending removal before proof preparation can scan other rows.
            await yieldToUiFrame();
            invalidateResolvedViewStateCaches();
        }
        const result = await serializeSuspendTagRowWrite(mirror, () => {
            if (navigationSignal && (navigationSignal.aborted || navigationSignal !== productionLiveSyncNavigation.signal)) throw staleSupabaseReadScopeError();
            return submit(operation, mirror, patch, closingUid ? getDockSuspendCompletionRevision(mirror) : expectedRevision, { ...options, serialized: true });
        }, JSON.stringify([operation, expectedRevision, patch, !!options.keepVisible]));
        committedClose = !!closingUid && result === true;
        return result;
    } finally {
        if (!committedClose && closingScope === getSupabaseReadIdentityScope()) restorePendingSuspendCloseRows(closingUid, removedSuspendRows);
        if (closingUid) completion?.completedSuspendTagKeys?.delete(closingUid);
        completion?.rollback(completionKey);
        if (completion && !committedClose) refreshLocalDockSuspendDcRequestState('suspend-tag-completion-settled', mirror);
    }
}

function removePendingSuspendCloseRows(uid, removed) {
    for (const rows of [suspendTagInventory, suspendTagRawSourceRows]) {
        for (let index = rows.length - 1; index >= 0; index--) {
            if (getDockSuspendDcRequestSourceUid(rows[index]) !== uid) continue;
            removed.push({ rows, index, row: rows[index] });
            rows.splice(index, 1);
        }
    }
}

function restorePendingSuspendCloseRows(uid, removed) {
    for (const { rows, index, row } of removed) {
        if (!rows.some(item => getDockSuspendDcRequestSourceUid(item) === uid)) rows.splice(Math.min(index, rows.length), 0, row);
    }
}
