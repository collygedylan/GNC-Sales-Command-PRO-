export function parsePhotoCsvValues(value = '') {
    return String(value || '').replace(/(data:image\/[^,]+),/gi, '$1\u0000').split(',')
        .map(entry => entry.replace('\u0000', ',').trim()).filter(Boolean);
}

export function calculateLiveLocPhotoMatch(row = {}, note = null) {
    const number = (...values) => {
        for (const value of values) {
            if (value == null || String(value).trim() === '') continue;
            const parsed = Number(String(value).replace(/,/g, '').replace(/%$/, ''));
            if (Number.isFinite(parsed)) return Math.max(0, parsed);
        }
        return null;
    };
    const preferredOnHand = number(row.PTRONHAND, row.ptronhand, row.ON_HAND, row.on_hand, row.onhand, row.ONHAND, row.ptr_onhand, row.loc_on_hand);
    if (preferredOnHand === 0) return 0;
    const currentOnHand = [row.onhand, row.ONHAND, row.PTRONHAND, row.ptronhand, row.ptr_onhand, row.ON_HAND, row.on_hand, row.loc_on_hand].map(value => number(value)).find(value => value > 0) ?? 0;
    const available = number(row.available, row.AVAILABLE, row.PTRAVAILABLE, row.ptravailable, row.ptr_available, row.LOC_AVAILABLE, row.loc_available) ?? currentOnHand;
    const pct = number(note?.match_pct, note?.loc_match_pct, note?.LOC_MATCH_PCT, note?.MATCH_PCT, note?.MATCH, note?.match, row.LOC_MATCH_PCT, row.loc_match_pct, row.MATCH_PCT, row.match_pct, row.MATCH, row.match) ?? 0;
    const baseline = number(note?.eval_baseline_available, note?.EVAL_BASELINE_AVAILABLE, row.eval_baseline_available, row.EVAL_BASELINE_AVAILABLE) ?? Math.max(currentOnHand, available);
    const initial = number(note?.initial_loc_photo_match, note?.INITIAL_LOC_PHOTO_MATCH, row.initial_loc_photo_match, row.INITIAL_LOC_PHOTO_MATCH)
        ?? number(note?.initial_photo_match_qty, note?.INITIAL_PHOTO_MATCH_QTY, row.INITIAL_PHOTO_MATCH_QTY, row.initial_photo_match_qty)
        ?? number(...[note?.LOC_PHOTO_MATCH,note?.loc_photo_match,note?.LOC_MATCH_QTY,note?.loc_match_qty,row.LOC_PHOTO_MATCH,row.loc_photo_match,row.LOC_MATCH_QTY,row.loc_match_qty].filter(value => Number(value)>0))
        ?? Math.round(Math.min(100, pct) * baseline / 100);
    return Math.max(0, Math.min(available, initial - Math.max(0, baseline - available)));
}

export function hasDetachedDrivePhotoWrite(uid) {
    for (const job of drivePhotoAttachments.values()) {
        if (job.identity.UNIQUE_ID === uid && job.running && job.commandRow?.__drivePhotoAbort) return true;
    }
    return false;
}

export function queueDetailRowPhoto(item, prefix, file) {
    const normalized = String(prefix || '').trim().toLowerCase();
    if (!SECURE_DRIVE_EVIDENCE_PREFIXES.has(normalized)) return queueRowPhotoUpload(item,prefix,file);
    const fileName = buildInventoryRowPhotoFileName(item,file,{ extension:getInventoryPhotoFileExtension(file,'jpg') });
    return queueDrivePhotoAttachment(item,normalized,file,fileName);
}

function resetPhotoAttachmentConflict(job, conflict) {
    if (!['DRIVE_FIELD_CONFLICT','DRIVE_ROW_STALE'].includes(conflict.code)) {
        showToast('Photo needs review','The row identity changed. Reopen the correct inventory row before retrying.',true);
        return false;
    }
    job.baseline = {...conflict.canonicalBaseline};
    job.commandRow = {...job.commandRow,LAST_UPDATED:conflict.canonicalSignature,__drivePhotoAttachment:true};
    setPhotoAliasFieldsForPrefix(job.commandRow, job.prefix, job.baseline.photo_link, job.baseline.photo_name);
    delete job.commandRow.__driveEvidenceIdempotencyKey;
    delete job.commandRow.__driveEvidenceIdempotencySignature;
    job.payload = {
        photo_link:appendPhotoCsvValue(job.baseline.photo_link,job.upload.publicUrl),
        photo_name:appendPhotoCsvValue(job.baseline.photo_name,job.upload.fileName)
    };
    return true;
}

async function uploadRowPhotoAttachment(job) {
    setDrivePhotoAttachmentStatus(job,'Uploading');
    job.uploadController = new AbortController();
    if (SECURE_DRIVE_EVIDENCE_PREFIXES.has(job.prefix) && !nativeAuthSessionActive) {
        await getNativeAuthRequestHeaders().catch(() => null);
    }
    if (!isCurrentDrivePhotoAttachment(job)) return;
    const uploaded = await uploadPhotoViaAppApi(job.prefix, job.file, job.fileName, job.file.type || 'image/jpeg', {
        timeoutMs:30000, signal:job.uploadController.signal, isCurrent:() => isCurrentDrivePhotoAttachment(job),
        nativeMaster:['req-','dock-'].includes(job.prefix) ? findLinkedMasterRow(job.item) : null,
        formFields:job.formFields || {masterUid:job.identity.UNIQUE_ID,itemCode:job.identity.ITEMCODE,
            locationCode:job.identity.LOCATIONCODE,lotCode:job.identity.LOTCODE}
    });
    if (!isCurrentDrivePhotoAttachment(job)) return;
    if (!uploaded.publicUrl) throw new Error('Photo upload did not return a saved photo.');
    job.upload = {
        publicUrl:normalizeStoragePublicUrl(uploaded.publicUrl), fileName:String(uploaded.filePath || job.fileName).split('/').pop(),
        filePath:uploaded.filePath, receipt:uploaded.receipt
    };
    setDrivePhotoAttachmentStatus(job,'Uploaded');
}

async function runRowPhotoAttachment(job) {
    if (!job.upload) await uploadRowPhotoAttachment(job);
    if (!isCurrentDrivePhotoAttachment(job)) return;
    if (SECURE_DRIVE_EVIDENCE_PREFIXES.has(job.prefix)) {
        const actionKey = job.scope + '|' + getRowSaveCoordinatorKey(job.prefix,job.item);
        await window.__agdataMarkDoneActions?.get(actionKey)?.finished;
        if (!isCurrentDrivePhotoAttachment(job)) return;
    }
    const key = JSON.stringify([job.scope,job.identity.UNIQUE_ID]);
    const previous = drivePhotoSaveChains.get(key) || Promise.resolve();
    const saving = previous.catch(() => {}).then(() => persistDrivePhotoAttachment(job));
    drivePhotoSaveChains.set(key,saving);
    try { await saving; }
    finally {
        if (drivePhotoSaveChains.get(key) === saving) drivePhotoSaveChains.delete(key);
    }
}

async function runRowPhotoAttachmentWithRetry(job) {
    try { await runRowPhotoAttachment(job); }
    catch (error) {
        if (!isCurrentDrivePhotoAttachment(job) || !isTransientPhotoUploadFailure(error)) throw error;
        await runRowPhotoAttachment(job);
    }
}

export function retryDrivePhotoAttachment(id) {
    const job = drivePhotoAttachments.get(id);
    if (!job || job.running || !isCurrentDrivePhotoAttachment(job)) return false;
    const conflict = job.commandRow?.__driveEvidenceConflict;
    if (conflict && !resetPhotoAttachmentConflict(job,conflict)) return false;
    job.running = true;
    const run = runRowPhotoAttachmentWithRetry(job);
    // An exact-row Drive job owns its append independently of the text evaluation.
    // Keep it in the shared activity registry for update and session safety.
    registerPendingPhotoUpload(job.item,job.prefix,run,SECURE_DRIVE_EVIDENCE_PREFIXES.has(job.prefix));
    run.catch(error => {
        if (!isCurrentDrivePhotoAttachment(job)) return;
        setDrivePhotoAttachmentStatus(job,'Save failed');
        showToast('Photo not saved',String(error?.message || 'Retry photo without retaking it.'),true);
    }).finally(() => { job.running = false; });
    return false;
}

