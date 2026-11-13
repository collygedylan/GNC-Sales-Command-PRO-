function suspendTagReceiptMatchesSource(operation, payload, result) {
    if (!['save', 'complete', 'close'].includes(operation)) return true;
    const sourceUid = String(payload?.sourceUid || '').trim();
    const receiptUid = String(result?.row?.unique_id || '');
    if (!sourceUid || receiptUid !== sourceUid) return false;
    if (operation === 'complete' && !Number.isFinite(Date.parse(result.row.date_completed))) return false;
    if (operation === 'close') return Number.isFinite(Date.parse(result.row.date_completed))
        && result.row.suspend === null && result.row.suspend_to === null
        && (!result.rows || result.rows.every(row => row.unique_id && Number.isFinite(Date.parse(row.date_completed))
            && row.suspend === null && row.suspend_to === null));
    return true;
}

function refreshConfirmedSuspendQueueBadges() {
    paintFooterRequestBadgeOnly();
    if (isViewVisible('request')) renderRequestCategoryToolbar();
}

function matchesFinalSuspendPullReceipt(result, source, target, sourceUid) {
    if (!result?.ok || !result.finalPull || !Array.isArray(result.rows) || !result.rows.length) return false;
    const origin = String(source.SUSPEND_ORIGIN_UID || source.suspend_origin_uid || sourceUid);
    const lot = String(target.LOTCODE || target.lotcode || '');
    const location = String(target.LOCATIONCODE || target.locationcode || '');
    const order = getDockSuspendDcRequestGroupParts(source);
    const row = result.rows.find(entry => entry.unique_id === result.originUid);
    return !!row && (row.unique_id === origin || row.suspend_origin_uid === origin)
        && row.locationcode === location && String(row.lotcode || '') === lot
        && String(row.dock_num || row.dock) === String(order.dock) && String(row.stopnumber) === String(order.drop)
        && String(row.itemcode || '').trim().toUpperCase() === String(order.itemcode || source.ITEMCODE || source.itemcode || '').trim().toUpperCase()
        && row.suspend_candidate_state === 'approved'
        && result.rows.every(entry => entry.unique_id && entry.date_completed && !entry.suspend && !entry.suspend_to
            && (entry.unique_id === origin || entry.suspend_origin_uid === origin)
            && String(entry.itemcode || '').trim().toUpperCase() === String(row.itemcode || '').trim().toUpperCase()
            && String(entry.dock_num || entry.dock) === String(order.dock) && String(entry.stopnumber) === String(order.drop));
}

async function recoverSuspendRowCommand({ receiptScope, state, sourceUid, expectedRevision, pending, operation, version, patch }) {
    if (receiptScope !== getSupabaseReadIdentityScope()) return null;
    const receipt = state.receipts[JSON.stringify([sourceUid,expectedRevision])];
    if (receipt?.commandId === pending.requestId) return {ok:true,row:receipt.row};
    if (operation === 'close') {
        const id = encodeURIComponent(sourceUid);
        const [source,history] = await Promise.all([
            fetchAuthenticatedSupabaseReadPage('ph_soc_master','select=*&unique_id=eq.' + id + '&limit=1'),
            fetchAuthenticatedSupabaseReadPage('ph_productivity_history','select=source_unique_id,completed_at&event_key=eq.suspend-tag-complete:' + id + '&limit=1')
        ]);
        const row = source.rows?.[0], event = history.rows?.[0];
        if (row?.unique_id !== sourceUid || row.suspend !== null || row.suspend_to !== null
            || event?.source_unique_id !== sourceUid || !Number.isFinite(Date.parse(row.date_completed))
            || Date.parse(row.date_completed) !== Date.parse(event.completed_at)) return null;
        return {ok:true,closedByReadback:true,row,rows:[row]};
    }
    if (operation !== 'complete' && operation !== 'save') return null;
    const response = await suspendTagApi('rows', {ids:[sourceUid]});
    const row = response?.rows?.find(value => value.unique_id === sourceUid);
    if (!row || !Number.isSafeInteger(row.suspend_tag_version) || row.suspend_tag_version <= Number(version)
        || operation === 'complete' && !['completed','awaiting_rep'].includes(row.suspend_tag_status)
        || !Object.entries(patch).filter(([field]) => !['force_clear_photos','explicit_av_note'].includes(field)).every(([field,value]) => Object.hasOwn(row,field) && String(row[field] ?? '') === String(value ?? ''))) return null;
    return {ok:true,row,rows:[row]};
}

async function executeSuspendRowCommand(command) {
    const { operation, mirror, patch, expectedRevision, options, photoOnly, sourceUid,
        state, source, version, pending, key, commandPayload, receiptScope, writeProof } = command;
    const result = await suspendTagApi(operation, commandPayload, {
        commandId: pending.requestId, expectedVersion: version,
        readCommitted: () => recoverSuspendRowCommand(command)
    });
    if (options.requireInventoryReceipt) {
        const identity = options.inventoryIdentity || getSuspendTagInventoryIdentity(mirror, source);
        const receipts = result?.inventoryRows || (result?.inventoryRow ? [result.inventoryRow] : []);
        if (receipts.length !== 1 || !receipts[0]?.unique_id || !matchesSuspendTagInventoryIdentity(receipts[0], identity)) {
            throw new Error('Inventory did not confirm the evaluation for this item, location and lot. Your entries are retained.');
        }
    }
    if (operation === 'close' && result?.closedByReadback && receiptScope === getSupabaseReadIdentityScope()) {
        delete state.pending[key]; persistDockSuspendCompletionState(state);
        getQueueCompletionState()?.confirm(getQueueCompletionKey(mirror), getQueueCompletionVersion(mirror));
        publishClosedSuspendOrder(result);
        return true;
    }
    const editableOperation = ['save', 'complete', 'close'].includes(operation);
    if (!result || result.ok !== true || !result.row || (!editableOperation && result.row.unique_id !== sourceUid) || !Number.isSafeInteger(result.row.suspend_tag_version)
        || (!editableOperation && getDockSuspendCompletionRevision(result.row) !== expectedRevision)
        || (photoOnly && String(patch.dock_photo_link || '').split(',').filter(Boolean).some(link => !String(result.row.dock_photo_link || '').split(',').includes(link)))
        || !['pending','completed','awaiting_rep','approved','denied'].includes(result.row.suspend_tag_status)
        || (['send', 'retry'].includes(operation) && result.row.suspend_tag_status !== 'awaiting_rep')
        || (operation === 'complete' && !['completed', 'awaiting_rep'].includes(result.row.suspend_tag_status))
        || (operation === 'close' && !Number.isFinite(Date.parse(result.row.date_completed)))
        || (operation === 'close' && (result.row.suspend !== null || result.row.suspend_to !== null))) throw new Error('The server did not confirm the saved row. Retry safely.');
    options.onConfirmed?.();
    const receiptRow = photoOnly ? Object.fromEntries(['unique_id', 'last_updated', 'date_completed', 'suspend_tag_status',
        'suspend_tag_version', 'dock_photo_link', 'dock_photo_name'].map(key => [key, result.row[key]])) : result.row;
    state.receipts[JSON.stringify([sourceUid,expectedRevision])] = { row:receiptRow,commandId:pending.requestId,completedAt:result.row.date_completed,savedAt:Date.now() };
    delete state.pending[key]; persistDockSuspendCompletionState(state);
    if (['complete', 'close'].includes(operation) && !options.keepVisible && receiptScope === getSupabaseReadIdentityScope()) {
        getQueueCompletionState()?.confirm(getQueueCompletionKey(mirror), result.row.suspend_tag_version);
    }
    if (writeProof && (writeProof.owner !== getSupabaseReadIdentityScope()
        || writeProof.navigationSignal.aborted || writeProof.navigationSignal !== productionLiveSyncNavigation.signal
        || writeProof.view !== getCurrentVisibleViewId()
        || writeProof.permissionVersion !== getProductionLiveSyncContext().dataPermissionVersion)) return false;
    if (photoOnly && (options.photoProof.owner !== getSupabaseReadIdentityScope()
        || options.photoProof.signal.aborted
        || !canCurrentUserWorkRequestItem(mirror))) return { acknowledged: true, applied: false };
    if (getDockSuspendCompletionState().scope !== state.scope || receiptScope !== getSupabaseReadIdentityScope()) return photoOnly ? { acknowledged: true, applied: false } : false;
    const current = findDockSuspendDcRequestSourceRow(mirror);
    if (current && !editableOperation && getDockSuspendCompletionRevision(current) !== expectedRevision) return photoOnly ? { acknowledged: true, applied: false } : false;
    return applySuspendRowCommandState(command, result, current);
}

function applySuspendRowCommandState(command, result, current) {
    const { operation, mirror, patch, expectedRevision, options, photoOnly, sourceUid, source, receiptScope } = command;
    const editableOperation = ['save', 'complete', 'close'].includes(operation);
    const rows = new Set([source,mirror,current,...(Array.isArray(requestsInventory) ? requestsInventory : []),
        ...(typeof suspendTagRawSourceRows !== 'undefined' && Array.isArray(suspendTagRawSourceRows) ? suspendTagRawSourceRows : []), ...socInventory, ...socRawSourceRows, ...suspendTagInventory]);
    rows.forEach(row => {
        if (row && getDockSuspendDcRequestSourceUid(row) === sourceUid
            && (editableOperation || getDockSuspendCompletionRevision(row) === expectedRevision)) {
            const draftKey = getSuspendTagFormDraftKey(row);
            if (photoOnly) applySuspendTagServerPhoto(row,result.row,isDockSuspendDcRequestMirrorRow(row));
            else applySuspendTagServerRow(row,result.row,isDockSuspendDcRequestMirrorRow(row));
            const nextDraftKey = getSuspendTagFormDraftKey(row);
            if (draftKey && draftKey !== nextDraftKey && suspendTagFormDrafts.has(draftKey)) {
                suspendTagFormDrafts.set(nextDraftKey, { ...suspendTagFormDrafts.get(draftKey), ...suspendTagFormDrafts.get(nextDraftKey) });
                suspendTagFormDrafts.delete(draftKey);
            }
        }
    });
    invalidateDockSuspendDcSourceRowLookup(current || source); requestScopedItemsCacheKey = '';
    if (['save', 'complete', 'close'].includes(operation)) invalidateSuspendTagInventoryRows(current || source);
    if (operation === 'close') {
        publishClosedSuspendOrder(result);
    } else refreshLocalDockSuspendDcRequestState('suspend-tag-' + operation,current || source);
    if (['save', 'complete', 'close'].includes(operation)) {
        const applied = applySuspendTagInventoryReceipt(result, receiptScope, options.inventoryIdentity || getSuspendTagInventoryIdentity(mirror, source));
        if (!applied && operation === 'save') applySavedSuspendDisplay(mirror,result.row,patch);
        if (!applied && operation !== 'close') void queueSuspendTagInventoryReconciliation(mirror, result.row);
    }
    return photoOnly ? { acknowledged: true, applied: true } : true;
}

function publishClosedSuspendOrder(result) {
    applySuspendCandidateRows(result.rows || [result.row], { close:true });
    refreshConfirmedSuspendQueueBadges();
    if (isViewVisible('request')) scheduleRequestRender(0, 16, true);
    persistCurrentCache(false, 'suspend-tag-close');
}
