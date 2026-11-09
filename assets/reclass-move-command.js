const activeReclassMoveCommands = new Map();
const reclassMoveRecovery = { timer: null, identityKey: '', attempts: 0, state: null };

function prepareArgosReclassMove(state, payload, identityKey, command) {
    const preview = buildOptimisticInventoryReclassMoveModel(state, command);
    const pending = {
        command, inquiryPayload: payload && typeof payload === 'object' ? JSON.parse(JSON.stringify(payload)) : null,
        originalModel: buildArgosInventoryReclassRollbackModel(state),
        movedUids: preview.movedUids, uncertain: false, inFlight: false,
        deferInitialPublication: state.backgroundSubmission === true, ownerIdentityKey: identityKey, ownerState: state
    };
    state.pendingReclassMove = pending;
    state.inquiryModel = preview.model;
    publishOptimisticReclassRows(pending, preview.model.rows);
    if (!state.backgroundSubmission) {
        renderArgosInventoryTransactionInquiryModel(state);
        setArgosReclassMoveInputsLocked(true);
    }
    return pending;
}

function getArgosReclassReceiptRevision(identityKey, receipt) {
    const masterState = getDatasetState('master');
    const liveContext = getProductionLiveSyncContext();
    const currentRevisionText = String(masterState.liveVerifiedRevision || '');
    const currentRevisionValid = masterState.liveVerifiedScope === liveContext.scope
        && masterState.liveVerifiedPermission === liveContext.dataPermissionVersion
        && /^[1-9]\d*$/.test(currentRevisionText);
    const previousRevisionText = String(confirmedArgosReclassLiveEditRevisions.get(identityKey) || '0');
    const currentRevision = currentRevisionValid ? BigInt(currentRevisionText) : 0n;
    const previousRevision = /^[1-9]\d*$/.test(previousRevisionText) ? BigInt(previousRevisionText) : 0n;
    const knownRevision = currentRevision > previousRevision ? currentRevision : previousRevision;
    return { masterState, liveContext, currentRevisionValid, currentRevision, previousRevision, knownRevision,
        receiptRevision: BigInt(receipt.revision) };
}

function publishArgosReclassMoveReceiptRows(pending, receipt) {
    const rollbackRows = publishOptimisticReclassRows(pending, null, { deferPublication: true });
    const restoredRows = Array.isArray(rollbackRows) ? rollbackRows : [];
    applyReclassSeasonStocks(receipt.seasonStocks || []);
    const published = new Map();
    for (const row of restoredRows) {
        const uid = String(row && (row.UNIQUE_ID ?? row.unique_id) || '');
        if (uid) published.set(uid, row);
    }
    try {
        for (const entry of receipt.rows) {
            const applied = applyArgosInventoryTransactionReturnedRow(entry.row, entry.row.unique_id, { deferPublication: true });
            if (!applied) throw Object.assign(new Error('The inventory receipt needs reconciliation.'),
                { code: 'INVENTORY_RECLASS_RECEIPT_APPLY_FAILED' });
            published.set(entry.row.unique_id, applied);
        }
    } finally {
        publishArgosInventoryTransactionReturnedRows(Array.from(published.values()));
    }
}

async function reconcileArgosReclassMoveReceipt(identityKey, pending, receipt) {
    const { masterState, liveContext, currentRevisionValid, currentRevision, previousRevision,
        knownRevision, receiptRevision } = getArgosReclassReceiptRevision(identityKey, receipt);
    const staleReceipt = receiptRevision < knownRevision;
    if (!staleReceipt) publishArgosReclassMoveReceiptRows(pending, receipt);
    const nextRevision = staleReceipt ? knownRevision : receiptRevision;
    if (nextRevision > previousRevision) confirmedArgosReclassLiveEditRevisions.set(identityKey, nextRevision.toString());
    if (!staleReceipt) {
        masterState.liveVerifiedRevision = receiptRevision.toString();
        masterState.liveVerifiedScope = liveContext.scope;
        masterState.liveVerifiedPermission = liveContext.dataPermissionVersion;
        invalidateArgosReclassLiveEditCaches('inventory-reclass-move-confirmed', { preserveMasterProof: true });
        if (typeof persistCurrentCache === 'function') {
            await persistCurrentCache(true, 'inventory-reclass-move-confirmed');
        }
    } else if (!currentRevisionValid || currentRevision < knownRevision) {
        invalidateArgosReclassLiveEditCaches('inventory-reclass-move-stale-receipt');
    }
}

function clearArgosReclassMove(state, pending, identityKey) {
    state.pendingReclassMove = null;
    state.moveCommandId = '';
    persistPendingArgosInventoryReclassMove(null, identityKey, pending.command.commandId);
    if (!state.backgroundSubmission) setArgosReclassMoveInputsLocked(false);
}

function isUncertainReclassMove(error) {
    const status = Number(error?.status);
    const code = String(error?.code || '');
    return isInventoryStatusOutcomeUncertain(error) || status === 401 || code === 'REQUEST_ABORTED'
        || /^INVENTORY_RECLASS_RECEIPT|^RECLASS_(SESSION_REQUIRED|TICKET_FORBIDDEN)$/.test(code);
}

function handleArgosReclassMoveFailure(error, state, pending, identityKey, serverConfirmed) {
    if (identityKey !== getArgosReclassLiveEditIdentityKey()) throw error;
    if (serverConfirmed || isUncertainReclassMove(error)) {
        pending.uncertain = true;
        if (typeof document !== 'undefined') queueArgosReclassMoveRecovery(identityKey, state);
        throw Object.assign(error instanceof Error ? error : new Error('Move confirmation is delayed.'),
            { inventoryMovePending: true });
    }
    publishOptimisticReclassRows(pending);
    state.inquiryModel = pending.originalModel;
    clearArgosReclassMove(state, pending, identityKey);
    if (!state.backgroundSubmission) renderArgosInventoryTransactionInquiryModel(state);
    throw error;
}

async function requestArgosReclassMoveReceipt(pending) {
    const command = pending.command;
    const service = getInventoryReclassMovesService();
    if (pending.uncertain) {
        const status = await service.status(command.commandId, command);
        if (status.status === 'applied' || status.status === 'acknowledged') return status.receipt;
    }
    return await service.submit(command);
}

async function dispatchArgosInventoryReclassMove(state, pending, identityKey) {
    let serverConfirmed = false;
    try {
        if (!isPendingReclassMoveDurable(state, identityKey)) {
            throw Object.assign(new Error('This device could not preserve the pending move. Keep the worksheet open and retry.'),
                { code: 'INVENTORY_RECLASS_PENDING_STORAGE_UNAVAILABLE' });
        }
        pending.inFlight = true;
        const receipt = await requestArgosReclassMoveReceipt(pending);
        serverConfirmed = true;
        if (identityKey !== getArgosReclassLiveEditIdentityKey()) return null;
        await reconcileArgosReclassMoveReceipt(identityKey, pending, receipt);
        if (identityKey !== getArgosReclassLiveEditIdentityKey()) return null;
        if (!state.backgroundSubmission) retireConfirmedArgosReclassMoveProposals(state, pending.movedUids);
        clearArgosReclassMove(state, pending, identityKey);
        return { receipt, movedUids: pending.movedUids };
    } catch (error) {
        handleArgosReclassMoveFailure(error, state, pending, identityKey, serverConfirmed);
    } finally {
        pending.inFlight = false;
    }
}

async function applyArgosInventoryReclassMoveCommand(state = null, payload = null, identityKey = '') {
    const command = state?.pendingReclassMove?.command || buildInventoryReclassMoveCommand(payload, state);
    if (!command) return null;
    const key = JSON.stringify([identityKey, command.commandId]);
    const existing = activeReclassMoveCommands.get(key);
    if (existing) return await existing;
    const pending = state.pendingReclassMove || prepareArgosReclassMove(state, payload, identityKey, command);
    const work = dispatchArgosInventoryReclassMove(state, pending, identityKey);
    activeReclassMoveCommands.set(key, work);
    try {
        return await work;
    } finally {
        activeReclassMoveCommands.delete(key);
    }
}

function createRecoveredArgosMoveState(saved) {
    return {
        sourceView: saved.sourceView || 'drive', snapshot: { uniqueId: saved.sourceUid }, backgroundSubmission: true,
        pendingReclassMove: { command: saved.command, inquiryPayload: saved.inquiryPayload, movedUids: saved.movedUids, uncertain: true }
    };
}

function canRecoverArgosReclassMove() {
    return !document.hidden && navigator.onLine !== false && canUseProductionLiveSync();
}

function queueArgosReclassMoveRecovery(identityKey = getArgosReclassLiveEditIdentityKey(), state = null) {
    const recovery = reclassMoveRecovery;
    if (identityKey !== recovery.identityKey) {
        clearTimeout(recovery.timer);
        Object.assign(recovery, { timer: null, identityKey, attempts: 0, state: null });
    }
    if (state) recovery.state = state;
    if (!canRecoverArgosReclassMove() || recovery.timer !== null || !readPendingArgosInventoryReclassMove(identityKey)) return;
    const delay = state ? Math.min(60000, 2000 * 2 ** Math.min(recovery.attempts++, 5)) : 0;
    recovery.timer = setTimeout(() => {
        recovery.timer = null;
        void recoverArgosReclassMove(identityKey);
    }, delay);
}

async function recoverArgosReclassMove(identityKey) {
    if (!canRecoverArgosReclassMove() || identityKey !== getArgosReclassLiveEditIdentityKey()) return;
    const saved = readPendingArgosInventoryReclassMove(identityKey);
    if (!saved || activeReclassMoveCommands.has(JSON.stringify([identityKey, saved.command.commandId]))) return;
    const previous = reclassMoveRecovery.state;
    const state = previous?.pendingReclassMove?.command.commandId === saved.command.commandId
        ? previous : createRecoveredArgosMoveState(saved);
    try {
        const result = await applyArgosInventoryReclassMoveCommand(state, null, identityKey);
        if (!result || identityKey !== getArgosReclassLiveEditIdentityKey()) return;
        reclassMoveRecovery.state = null;
        reclassMoveRecovery.attempts = 0;
        showToast('Moves Saved', 'Inventory moves were saved and confirmed.');
        queueArgosReclassMoveRecovery(identityKey);
    } catch (error) {
        if (error.inventoryMovePending || identityKey !== getArgosReclassLiveEditIdentityKey()) return;
        reclassMoveRecovery.state = null;
        showToast('Move Not Saved', getFriendlyBackendErrorMessage(error, 'Review the worksheet before trying again.'), true);
    }
}
