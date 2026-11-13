export function clearDrivePhotoAttachments() {
    drivePhotoAttachments.forEach(job => {
        job.uploadController?.abort();
        job.commandRow?.__drivePhotoAbort?.();
        clearPendingPhotoPreview(job.item, job.prefix, job.preview.id);
    });
    drivePhotoAttachments.clear();
    drivePhotoSaveChains.clear();
    const urls = new Set([...rowPhotosByKey.values()].flat().map(entry => entry.url));
    rowPhotosByKey.clear();
    urls.forEach(url => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
}

function isCurrentDrivePhotoAttachment(job) {
    return drivePhotoAttachments.get(job.id) === job && job.scope === getSupabaseReadIdentityScope();
}

async function persistDrivePhotoAttachment(job) {
    if (!isCurrentDrivePhotoAttachment(job)) throw new Error('Photo session changed.');
    if (job.prefix === 'eval-') return persistEvalPhotoAttachment(job);
    const current = getMasterPhotoSyncItem(job.item) || job.item;
    if (job.prefix === 'req-' || job.prefix === 'dock-') return persistQueuePhotoAttachment(job);
    if (!canEditEvidenceWorkflow(job.prefix, current, job.sourceView) || !isSameDriveEvidenceLocation(current, job.identity, true)) {
        throw new Error('The inventory row or access changed. Reopen the item before retrying.');
    }
    if (!job.commandRow) {
        job.commandRow = { ...current, __drivePhotoAttachment: true, __drivePhotoIsCurrent: () => isCurrentDrivePhotoAttachment(job) };
        job.baseline = buildSecureDriveEvidenceBaseline(current);
        job.payload = {
            photo_link: appendPhotoCsvValue(job.baseline.photo_link, job.upload.publicUrl),
            photo_name: appendPhotoCsvValue(job.baseline.photo_name, job.upload.fileName)
        };
    }
    // The location-scoped RPC owns authorization, replay, and serialization.
    const {applied:reconciled,projectionDeferred} = await publishRowEvaluationToMasterAndNotes(job.commandRow,job.payload,{
        prefix:job.prefix,scope:job.scope,complete:false,baseline:job.baseline,receipt:job.upload.receipt,
        photoOnly:true,photoIdentity:job.identity,sourceView:job.sourceView,isCurrent:()=>isCurrentDrivePhotoAttachment(job)
    });
    if (!isCurrentDrivePhotoAttachment(job)) return;
    if (projectionDeferred) { confirmRowPhotoSlot(job); return; }
    const saved = reconciled.row;
    confirmRowPhotoSlot(job);
    if (job.item !== saved && job.item !== activeItem) {
        setPhotoAliasFieldsForPrefix(job.item, job.prefix, saved.PHOTO_LINK || '', saved.PHOTO_NAME || '');
        MASTER_EVIDENCE_SYNC_KEYS.forEach(key => { if (Object.prototype.hasOwnProperty.call(saved, key)) job.item[key] = saved[key]; });
    }
    if (reconciled.applied) queueAppLiveEventForWrite('ph_master_inventory', 'PATCH', [{ unique_id: saved.UNIQUE_ID }], '');
    refreshPendingPhotoUiForItem(job.item, job.prefix);
}

globalThis.persistDrivePhotoAttachment = persistDrivePhotoAttachment;

export function retryFailedSeasonDrivePhotoAttachments(item = null) {
    if (navigator.onLine === false) return false;
    let retried = false;
    drivePhotoAttachments.forEach((job) => {
        if (job.status !== 'Save failed' || job.running || !isCurrentDrivePhotoAttachment(job)) return;
        if (item && String(job.identity.UNIQUE_ID) !== String(item.UNIQUE_ID || item.unique_id || '')) return;
        retried = true;
        retryDrivePhotoAttachment(job.id);
    });
    return retried;
}

export function requestCompletionPhotoPatch(body) {
    if (body.complete !== true) return body.patch;
    const ids = getQueuedRequestPhotoIds({unique_id:body.request_id});
    return ids.length ? {...body.patch,queued_photo_ids:ids} : body.patch;
}

export function acknowledgeRequestPhotoIntentReceipt(patch, receipt) {
    if (patch?.queued_photo_ids?.length && receipt?.photo_intents_registered !== true) {
        globalThis.reportHandledRuntimeIssue?.('requestCompletionPhotoPatch','REQUEST_PHOTO_INTENT_UNCONFIRMED');
    }
}

function retainDetailPhotoBlob(job, blob) {
    return putRequestBlobRecord({
        blobId:job.blobId, requestId:job.identity.UNIQUE_ID, fileName:job.fileName,
        contentType:blob.type, blob, createdAt:job.preview.createdAt, acknowledged:false,
        detailPhoto:{prefix:job.prefix,identity:job.identity,sourceView:job.sourceView}
    }).catch(error => {
        globalThis.GncRuntimeWatchdog?.capture?.(error, 'retainDetailPhotoBlob');
        return false;
    });
}

function stageDetailPhotoCapture(job) {
    job.blobId = 'detail:' + job.identity.UNIQUE_ID + ':' + job.id;
    job.blobBackup = retainDetailPhotoBlob(job, job.file);
}

export function queueDrivePhotoAttachment(item, prefix, file, fileName, formFields = null, inquiry = null) {
    markLocalRowSaveRefreshQuiet('photo-attachment');
    const localBlobUrl = URL.createObjectURL(file);
    const preview = createPendingPhotoPreview(item, prefix, localBlobUrl, fileName);
    if (!preview) { URL.revokeObjectURL(localBlobUrl); return false; }
    const job = { id: preview.id, preview, item, prefix, file, fileName, formFields, inquiry, scope: getSupabaseReadIdentityScope(), running: false,
        sourceView:activeDetailSourceView || lastView,
        identity: Object.fromEntries(['UNIQUE_ID', 'ITEMCODE', 'LOCATIONCODE', 'LOTCODE'].map(key => [key, String(item[key] || item[key.toLowerCase()] || '')])) };
    drivePhotoAttachments.set(job.id, job);
    if (isQueuedDetailPhoto(prefix)) stageDetailPhotoCapture(job);
    setDrivePhotoAttachmentStatus(job, 'Uploading');
    retryDrivePhotoAttachment(job.id);
    return true;
}

export function persistCameraDetailSession(input = null) {
    if (!activeItem || !currentUser) return;
    const state = window.GncCameraState;
    if (state) {
        state.captureId = (Number(state.captureId) || 0) + 1;
        if (input?.type === 'file') input.__gncCameraCaptureId = state.captureId;
        window.beginCameraCapture?.();
    }
    persistAppFilterStateNow();
    try {
        sessionStorage.setItem('agdata_camera_detail_v1',JSON.stringify({owner:getSupabaseReadIdentityScope(),captureId:state?.captureId || 0,createdAt:Date.now(),row:{...activeItem},rowUid:getCompletedRowUnlockKey(activeItem),source:activeDetailSourceView || lastView || 'drive',tab:activeDetailTab,scrollY:getMainAreaScrollTop(),filterKey:getAppFilterStateStorageKey(),filters:JSON.stringify(readAppFilterStateSnapshot())}));
        window.persistCameraCaptureState?.();
    } catch { /* Camera capture remains usable when storage is disabled. */ }
}

export function restoreCameraDetailSession() {
    if (!currentUser) return false;
    try {
        const saved = JSON.parse(sessionStorage.getItem('agdata_camera_detail_v1') || 'null');
        if (!saved) return false;
        if (saved.owner !== getSupabaseReadIdentityScope() || Date.now()-saved.createdAt > 30*60_000) { sessionStorage.removeItem('agdata_camera_detail_v1'); return false; }
        sessionStorage.removeItem('agdata_camera_detail_v1');
        const row = fullInventory.find(item => getCompletedRowUnlockKey(item) === saved.rowUid) || saved.row;
        if (!row || getCompletedRowUnlockKey(row) !== saved.rowUid) return false;
        if (saved.filters && saved.filterKey === getAppFilterStateStorageKey()) {
            try { localStorage.setItem(saved.filterKey,saved.filters); restorePersistedAppFilterStateForCurrentUser(true); } catch { /* Restore the row even if filter storage is unavailable. */ }
        }
        openDetail(saved.rowUid,saved.source,{__masterDetailRow:row,preferredTab:saved.tab || 'location'});
        requestAnimationFrame(() => setMainAreaScrollTop(Number(saved.scrollY)||0));
        window.finishCameraCapture?.();
        return true;
    } catch { return false; }
}

async function persistQueuePhotoAttachment(job) {
    const { item, prefix, upload } = job;
    const uid = String(item.UNIQUE_ID);
    if (prefix === 'req-' && isDockSuspendDcRequestMirrorRow(item)) {
        const proof = await loadCurrentSuspendTagPhotoRow(item);
        const receipt = await persistSuspendTagUploadedPhoto(item, proof, upload.publicUrl, upload.fileName);
        if (!receipt?.acknowledged) throw new Error('Suspend photo save was not confirmed.');
    } else if (prefix === 'req-') {
        await persistRegularRequestPhotoAttachment(job,uid);
    } else {
        const patch = {dock_photo_link:appendPhotoCsvValue(item.DOCK_PHOTO_LINK,upload.publicUrl),
            dock_photo_name:appendPhotoCsvValue(item.DOCK_PHOTO_NAME,upload.fileName)};
        const receipt = await writeSocReviewThroughAppApi('PATCH',patch,'unique_id=eq.' + encodeURIComponent(uid));
        if (!receipt?.row || String(receipt.row.unique_id) !== uid || !parsePhotoCsvValues(receipt.row.dock_photo_link).includes(upload.publicUrl)) throw new Error('Dock photo save was not confirmed.');
        if (isCurrentDrivePhotoAttachment(job)) setPhotoAliasFieldsForPrefix(item,prefix,receipt.row.dock_photo_link,receipt.row.dock_photo_name);
    }
    if (isCurrentDrivePhotoAttachment(job)) confirmRowPhotoSlot(job);
}

async function persistRegularRequestPhotoAttachment(job,uid) {
    const {item,prefix,upload} = job;
    const patch = {req_photo_link:upload.publicUrl,req_photo_name:upload.fileName};
    const publication = await publishRowEvaluationToMasterAndNotes(item,patch,{requestWork:true,scope:job.scope,complete:false,
        photoAttachmentUrl:upload.publicUrl,queuedPhotoId:job.id,memoryRollback:()=>{},persist:async () => {
            const result = await supabaseRpc('append_request_photo_intent_v3079', {
                p_request_id:uid,p_photo_id:job.id,p_url:patch.req_photo_link,p_name:patch.req_photo_name
            }, {timeoutMs:25000,signal:job.uploadController.signal});
            if (result?.queued_photo_id !== job.id) throw new Error('Request photo save was not confirmed.');
            return {status:'saved',result};
        }});
    const saved = publication.result.row;
    if (!isCurrentDrivePhotoAttachment(job)) return;
    const live = findRequestRowByUniqueId(uid);
    for (const target of new Set([item, live, activeItem].filter(row => row?.UNIQUE_ID === uid))) {
        setPhotoAliasFieldsForPrefix(target,prefix,saved.req_photo_link,saved.req_photo_name);
        target.ROW_VERSION = target.row_version = Math.max(Number(target.ROW_VERSION || 0), Number(saved.row_version || 0));
    }
}
