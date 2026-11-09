export async function publishSeasonSalesOfficeEvaluation(item, patch, options) {
    const scope = options.scope || getSupabaseReadIdentityScope(), authEpoch = nativeAuthRecoveryEpoch;
    const uid = String(item.UNIQUE_ID || item.unique_id || '').trim();
    const expectedRevision = options.expectedRevision;
    if (!uid || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || typeof options.persist !== 'function') throw new Error('SEASON_AV_NOTE_COMMAND_INVALID');
    if (scope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
    const result = await options.persist();
    if (scope !== getSupabaseReadIdentityScope() || authEpoch !== nativeAuthRecoveryEpoch) throw staleSupabaseReadScopeError();
    if (result?.ok !== true || result.status !== 'saved' || result.error || String(result.masterId || '') !== uid
        || typeof result.avNote !== 'string' || result.avNote !== String(patch?.av_note ?? '').trim()
        || !Number.isSafeInteger(result.revision) || result.revision !== expectedRevision + 1) throw new Error('SEASON_AV_NOTE_RECEIPT_UNCONFIRMED');
    return result;
}

export async function publishRequestWorkEvaluation(item, patch, options) {
    const scope = options.scope || getSupabaseReadIdentityScope();
    const target = findLinkedMasterRow(item);
    const evidence = target ? buildRequestMasterUpdatePayloadFromSave(item, patch, target) : null;
    if (evidence && patch?.explicit_av_note === true) { evidence.explicit_av_note = true; evidence.av_note = String(patch.av_note ?? ''); }
    const rollback = options.memoryRollback || beginRowEvaluationMemoryPublication(target, evidence, scope);
    let outcome, completedReceipt = false, photoReceipt = false;
    try {
        outcome = await options.persist();
        if (scope !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
        if (outcome.status !== 'saved') { rollback(); return outcome; }
        const result = outcome.result, saved = result?.row;
        if (result?.ok === false || result?.error || options.complete && result?.active === true || !saved || String(saved.unique_id || saved.UNIQUE_ID || '') !== String(item.UNIQUE_ID || item.unique_id || '')) throw new Error('REQUEST_SAVE_UNCONFIRMED');
        if (options.complete && (result.lifecycle_state !== 'completed_history' || !hasRequestCompletionState(saved))) throw new Error('REQUEST_COMPLETION_RECEIPT_UNCONFIRMED');
        if (options.complete) {
            completedReceipt = true;
            options.onConfirmed?.(result);
        }
        if (options.photoAttachmentUrl) {
            if (result.lifecycle_state !== 'pending_active' || result.active === false
                || !parsePhotoCsvValues(saved.req_photo_link).includes(options.photoAttachmentUrl)) throw new Error('REQUEST_PHOTO_RECEIPT_UNCONFIRMED');
            photoReceipt = true;
            options.onConfirmed?.(result);
        }
        reconcileRequestPublicationMaster({ result, saved, item, target, options, completedReceipt, photoReceipt, scope });
        return outcome;
    } catch (error) {
        if (completedReceipt || photoReceipt) {
            // The exact Request completion/photo is durable; only its local inventory projection is deferred.
            reportDeferredRequestPublication(error, photoReceipt);
            queueVisibleDatasetCatchup(0);
            return outcome;
        }
        rollback(); throw error;
    }
}

function reconcileRequestPublicationMaster({ result, saved, item, target, options, completedReceipt, photoReceipt, scope }) {
    const expected = String(saved.master_id || item.MASTER_ID || item.master_id || target?.UNIQUE_ID || target?.unique_id || '');
    if (result.master_row) {
        if (!expected || String(result.master_row.unique_id) !== expected) throw new Error('REQUEST_MASTER_RECEIPT_MISMATCH');
        if (photoReceipt && !parsePhotoCsvValues(result.master_row.photo_link).includes(options.photoAttachmentUrl)) throw new Error('REQUEST_MASTER_PHOTO_RECEIPT_UNCONFIRMED');
        if (!completedReceipt && !photoReceipt) options.onConfirmed?.(result);
        const master = target || formatFetchedRows([result.master_row], 'ph_master_inventory')[0];
        reconcileConfirmedDriveEvidence({ ok: true, row: result.master_row, canonicalConfirmed: true }, master, 'req-', { scope, preserveDetailDraft: true });
    } else if (target || expected) throw new Error('REQUEST_MASTER_RECEIPT_UNCONFIRMED');
    else if (!completedReceipt && !photoReceipt) options.onConfirmed?.(result);
}

function reportDeferredRequestPublication(error, photoReceipt) {
    if (error?.message === 'REQUEST_MASTER_RECEIPT_UNCONFIRMED') return;
    globalThis.reportHandledRuntimeIssue?.('request_work', photoReceipt ? 'REQUEST_PHOTO_PROJECTION_DEFERRED' : 'REQUEST_COMPLETION_PROJECTION_DEFERRED');
}
