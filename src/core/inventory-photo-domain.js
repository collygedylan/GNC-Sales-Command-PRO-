import { canonicalInventorySameLot, canonicalInventoryLot, canonicalInventoryRowUid, canonicalInventoryLinkedUid, resolveCanonicalInventoryTarget } from '../engine/canonical-inventory-evidence.js';
import { waitForOperationalPrerequisite } from '../services/operational-rpc-retry.js';

export function parsePhotoCsvValues(value = '') {
    return String(value || '').replace(/(data:image\/[^,]+),/gi, '$1\u0000').split(',')
        .map(entry => entry.replace('\u0000', ',').trim()).filter(Boolean);
}

export function strictInventoryPhotoLocationKey(row) {
    if (!row || !canonicalInventorySameLot(row, row)) return '';
    const master = resolveCanonicalInventoryTarget(row, masterInventoryById, masterInventoryByItemCode);
    const target = master || row;
    const table = String(row.SOURCE_TABLE || row.source_table || '').toLowerCase();
    const uid = master ? canonicalInventoryRowUid(master) : canonicalInventoryLinkedUid(row)
        || (['', 'ph_master_inventory', 'ph_location_sales_notes'].includes(table) ? canonicalInventoryRowUid(row) : '');
    if (!uid) return '';
    const part = key => String(target[key] ?? target[key.toLowerCase()] ?? '').trim().toUpperCase();
    return JSON.stringify([uid, part('ITEMCODE'), part('LOCATIONCODE'), canonicalInventoryLot(target)]);
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
    if (!isQueuedDetailPhoto(normalized)) return globalThis.queueRowPhotoUpload(item,prefix,file);
    if (normalized === 'req-') {
        if (!canCurrentUserWorkRequestItem(item, 'photo')) return false;
        const owner = getRequestPhotoOwnerItem(item) || item;
        if (owner !== item) mergeRequestPhotoFields(item, owner);
        item = owner;
    }
    const fileName = buildInventoryRowPhotoFileName(item,file,{extension:'jpg'});
    return queueDrivePhotoAttachment(item,normalized,file,fileName);
}

const ROW_PHOTO_TRANSFER_RETRY_DELAYS = [300, 800];
const DETAIL_PHOTO_RETRY_DELAYS = [1000, 2500, 5000];
const ROW_PHOTO_SAVE_RETRY_DELAYS = [300, 800, 1500];
let detailPhotoTransferTail = Promise.resolve();

function isQueuedDetailPhoto(prefix) {
    return prefix === 'req-' || SECURE_DRIVE_EVIDENCE_PREFIXES.has(prefix);
}

function isRetryablePhotoTransfer(error) {
    if (error?.name === 'AbortError' || ['REQUEST_ABORTED', 'DATASET_READ_SCOPE_CHANGED'].includes(error?.code)) return false;
    return isTransientPhotoUploadFailure(error) || Number(error?.status) === 544;
}

function isRetryableDetailPhotoTransfer(error) {
    if (error?.name === 'AbortError' || ['REQUEST_ABORTED', 'DATASET_READ_SCOPE_CHANGED'].includes(error?.code)) return false;
    const status = Number(error?.status);
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
    return (status >= 500 && status < 600) || isRetryablePhotoTransfer(error);
}

function isRetryablePhotoSave(error) {
    const status = Number(error?.status);
    const diagnostic = `${error?.code || ''} ${error?.message || ''}`;
    if ([401, 403].includes(status) || /abort|forbidden|not[ _-]found|identity.mismatch|unlock.required/i.test(diagnostic)) return false;
    return isRetryablePhotoTransfer(error) || [409, 423].includes(status)
        || /55P03|57014|40001|40P01|lock.not.available|lock(?:ing)? timeout|deadlock|could not (?:obtain|acquire) lock|serialization failure|row.locked|save.busy|version.conflict|drive.field.conflict|drive.row.stale/i.test(diagnostic);
}

function waitForRowPhotoRetry(delay) {
    return new Promise(resolve => setTimeout(resolve, delay));
}

async function retryPhotoOperation(job, operation, delays, isRetryable) {
    for (let attempt = 0; attempt <= delays.length && isCurrentDrivePhotoAttachment(job); attempt += 1) {
        try { return await operation(); }
        catch (error) {
            if (!isCurrentDrivePhotoAttachment(job) || attempt >= delays.length || !isRetryable(error)) throw error;
            if (delays[attempt]) await waitForRowPhotoRetry(delays[attempt]);
        }
    }
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
    delete job.commandRow.__driveEvidenceConflict;
    job.payload = {
        photo_link:appendPhotoCsvValue(job.baseline.photo_link,job.upload.publicUrl),
        photo_name:appendPhotoCsvValue(job.baseline.photo_name,job.upload.fileName)
    };
    return true;
}

function sendPreparedPhotoToEdge(formData, options) {
    if (!options.singleUploadAttempt) return postPhotoUploadWithTransientRetry(formData, options);
    return postAppFunctionFormData(APP_API_FUNCTION_URL, formData, { ...options, label:'Secure photo upload' });
}

async function sendPreparedNativeRowPhoto(formData, options) {
    const nativeForm = options.nativeMaster ? new FormData() : formData;
    if (options.nativeMaster) {
        for (const [name, value] of formData) nativeForm.append(name, value);
        nativeForm.set('prefix','lsn-');
        nativeForm.set('masterUid',options.nativeMaster.UNIQUE_ID);
    }
    const nativeOptions = options.nativeMaster ? { ...options, attachPhoto:false } : options;
    return uploadDrivePhotoWithNativeSession(nativeForm, nativeOptions);
}

export async function sendPreparedRowPhotoUpload(formData, nativeEvidenceUpload, options) {
    try {
        if (nativeEvidenceUpload) return await sendPreparedNativeRowPhoto(formData, options);
        await ensureAppApiWriteProxySession();
        return await sendPreparedPhotoToEdge(formData, options);
    } catch (error) {
        if (!isPasswordChangeRequiredError(error) || !await recoverAppApiSessionAfterPasswordRequired(error)) throw error;
        return sendPreparedPhotoToEdge(formData, options);
    }
}

function getRowPhotoUploadIdentity(job, master) {
    if (!master) return job.identity;
    return {
        UNIQUE_ID: master.UNIQUE_ID || master.unique_id,
        ITEMCODE: master.ITEMCODE || master.itemcode,
        LOCATIONCODE: master.LOCATIONCODE || master.locationcode,
        LOTCODE: master.LOTCODE || master.lotcode
    };
}

async function resolveQueuedRowPhotoMaster(job, signal) {
    if (job.prefix === 'req-' && isDockSuspendDcRequestMirrorRow(job.item)) {
        return resolveSuspendPhotoMaster(job.item, signal);
    }
    return ['req-', 'dock-'].includes(job.prefix) ? findLinkedMasterRow(job.item) : null;
}

async function prepareQueuedRowPhoto(job) {
    const cached = job.prefix === 'req-' ? findLinkedMasterRow(job.item) : null;
    const masterUid = canonicalInventoryLinkedUid(job.item);
    if (cached && canonicalInventorySameLot(job.item, cached)
        && (!masterUid || masterUid === canonicalInventoryRowUid(cached))) return cached;
    const controller = new AbortController();
    const cancel = () => controller.abort(job.uploadController.signal.reason);
    job.uploadController.signal.addEventListener('abort', cancel, {once:true});
    const timeoutMs = job.prefix === 'req-' ? 25000 : 500;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await waitForOperationalPrerequisite(() => resolveQueuedRowPhotoMaster(job, controller.signal), {
            signal:controller.signal, current:() => isCurrentDrivePhotoAttachment(job), timeoutMs
        });
    } catch (error) {
        if (controller.signal.aborted && !job.uploadController.signal.aborted) {
            throw Object.assign(new Error('Photo row preparation timed out.'), {code:'TRANSPORT_TIMEOUT'});
        }
        throw error;
    } finally {
        clearTimeout(timer);
        job.uploadController.signal.removeEventListener('abort', cancel);
    }
}

function acceptQueuedRowPhotoUpload(job, uploaded) {
    if (!isCurrentDrivePhotoAttachment(job)) return;
    const publicUrl = normalizeStoragePublicUrl(uploaded.publicUrl);
    if (!publicUrl) throw new Error('Photo upload did not return a saved photo.');
    job.upload = {
        publicUrl, fileName:String(uploaded.filePath || job.fileName).split('/').pop(),
        filePath:uploaded.filePath, receipt:uploaded.receipt
    };
    setDrivePhotoAttachmentStatus(job,'Uploaded');
}

async function getQueuedRowPhotoHeaders(job) {
    if (nativeAuthSessionActive && nativeAuthAccessToken && nativeAuthProfile?.id
        && nativeAuthProfile.active !== false && !nativeAuthProfile.disabled_at
        && String(nativeAuthProfile.username || '').trim().toLowerCase() === String(currentUser || '').trim().toLowerCase()) {
        return {apikey:SUPABASE_KEY, Authorization:'Bearer ' + nativeAuthAccessToken};
    }
    return waitForOperationalPrerequisite(() => getNativeAuthRequestHeaders(), {
        signal:job.uploadController.signal, current:() => isCurrentDrivePhotoAttachment(job), timeoutMs:25000
    });
}

async function retainPreparedRowPhoto(job, optimized) {
    if (!isCurrentDrivePhotoAttachment(job)) return;
    await job.blobBackup;
    if (!isCurrentDrivePhotoAttachment(job)) return;
    job.optimizedPhoto = optimized;
    job.blobBackup = retainDetailPhotoBlob(job, optimized.blob);
    await job.blobBackup;
}

async function uploadRowPhotoAttachment(job) {
    setDrivePhotoAttachmentStatus(job,'Uploading');
    job.uploadController = new AbortController();
    const detailPhoto = isQueuedDetailPhoto(job.prefix);
    if (detailPhoto && !job.optimizedPhoto) {
        const optimized = await optimizePhotoBlobForUpload(job.file, job.fileName, {mainOnly:false});
        await retainPreparedRowPhoto(job, optimized);
    }
    if (!isCurrentDrivePhotoAttachment(job)) return;
    const master = await prepareQueuedRowPhoto(job);
    const nativeHeaders = SECURE_DRIVE_EVIDENCE_PREFIXES.has(job.prefix) ? await getQueuedRowPhotoHeaders(job) : null;
    if (!isCurrentDrivePhotoAttachment(job)) return;
    const identity = getRowPhotoUploadIdentity(job, master);
    const nativeMaster = master && SECURE_DRIVE_EVIDENCE_PREFIXES.has(job.prefix) ? { UNIQUE_ID: identity.UNIQUE_ID } : null;
    const uploaded = await uploadPhotoViaAppApi(job.prefix, job.file, job.fileName, job.file.type || 'image/jpeg', {
        timeoutMs:detailPhoto ? 25000 : 4000,
        signal:job.uploadController.signal, isCurrent:() => isCurrentDrivePhotoAttachment(job),
        singleUploadAttempt:job.prefix !== 'dock-',
        preparedPhoto:job.optimizedPhoto,
        nativeMaster, nativeHeaders, onStorageUploaded:uploaded => acceptQueuedRowPhotoUpload(job, uploaded),
        formFields:{...(job.formFields || {masterUid:identity.UNIQUE_ID,itemCode:identity.ITEMCODE,
            locationCode:identity.LOCATIONCODE,lotCode:identity.LOTCODE}),...capturedPhotoSourceFields(job)}
    });
    acceptQueuedRowPhotoUpload(job, uploaded);
    if (!uploaded.thumbnailUploads) return;
    job.thumbnailSettlement = uploaded.thumbnailUploads.then(results => {
        if (results.some(result => result.status === 'rejected')) {
            globalThis.reportHandledRuntimeIssue?.('uploadRowPhotoAttachment','PHOTO_THUMBNAIL_UPLOAD_FAILED');
        }
    });
    registerPendingPhotoUpload(job.item,job.prefix,job.thumbnailSettlement,true);
    if (detailPhoto) globalThis.protectCameraPhotoUpload?.(job.thumbnailSettlement);
}

function capturedPhotoSourceFields(job) {
    if (job.prefix!=='req-') return {};
    return isDockSuspendDcRequestMirrorRow(job.item)
        ? {suspendTagId:getDockSuspendDcRequestSourceUid(job.item)}
        : {requestId:job.identity.UNIQUE_ID};
}

async function persistQueuedRowPhoto(job) {
    return retryPhotoOperation(job, () => {
        const conflict = job.commandRow?.__driveEvidenceConflict;
        if (conflict && !resetPhotoAttachmentConflict(job, conflict)) throw new Error('Photo row identity changed.');
        return globalThis.persistDrivePhotoAttachment(job);
    }, ROW_PHOTO_SAVE_RETRY_DELAYS, isRetryablePhotoSave);
}

function rowPhotoSaveKey(job) {
    if (job.prefix === 'eval-') return JSON.stringify([job.scope, 'eval-work', job.formFields.workId]);
    const locationKey = job.prefix === 'req-' ? inventoryPhotoLocationKey(job.item) : '';
    const masterUid = locationKey.startsWith('uid:') ? locationKey.slice(4) : '';
    return JSON.stringify([job.scope, masterUid || job.identity.UNIQUE_ID]);
}

async function enqueueRowPhotoSave(job, uploaded, persist = persistQueuedRowPhoto) {
    const key = rowPhotoSaveKey(job);
    const previous = drivePhotoSaveChains.get(key) || Promise.resolve();
    const saving = Promise.allSettled([previous, uploaded]).then(([, upload]) => {
        if (!isCurrentDrivePhotoAttachment(job)) return;
        if (upload.status === 'rejected') throw upload.reason;
        return persist(job);
    });
    drivePhotoSaveChains.set(key,saving);
    try { await saving; }
    finally {
        if (drivePhotoSaveChains.get(key) === saving) drivePhotoSaveChains.delete(key);
    }
}

function runRowPhotoAttachmentWithRetry(job) {
    const upload = () => job.upload ? undefined : uploadRowPhotoAttachment(job);
    if (job.prefix === 'dock-') return retryPhotoOperation(job, async () => {
        await upload();
        return enqueueRowPhotoSave(job, null, globalThis.persistDrivePhotoAttachment);
    }, [0], isTransientPhotoUploadFailure);
    if (!isQueuedDetailPhoto(job.prefix)) {
        return enqueueRowPhotoSave(job, retryPhotoOperation(job, upload, ROW_PHOTO_TRANSFER_RETRY_DELAYS, isRetryablePhotoTransfer));
    }
    const transfer = () => retryPhotoOperation(job, upload, DETAIL_PHOTO_RETRY_DELAYS, isRetryableDetailPhotoTransfer);
    const uploaded = detailPhotoTransferTail.then(transfer);
    detailPhotoTransferTail = Promise.allSettled([uploaded]).then(() => job.thumbnailSettlement);
    return enqueueRowPhotoSave(job, uploaded);
}

export function retryDrivePhotoAttachment(id) {
    const job = drivePhotoAttachments.get(id);
    if (!job || job.running || !isCurrentDrivePhotoAttachment(job)) return false;
    const conflict = job.commandRow?.__driveEvidenceConflict;
    if (conflict && !resetPhotoAttachmentConflict(job,conflict)) return false;
    job.running = true;
    const run = runRowPhotoAttachmentWithRetry(job);
    job.promise = run;
    // An exact-row Drive job owns its append independently of the text evaluation.
    // Keep it in the shared activity registry for update and session safety.
    registerPendingPhotoUpload(job.item,job.prefix,run,SECURE_DRIVE_EVIDENCE_PREFIXES.has(job.prefix) || isSuspendDetailPhoto(job));
    if (isQueuedDetailPhoto(job.prefix)) globalThis.protectCameraPhotoUpload?.(run);
    run.catch(error => {
        if (!isCurrentDrivePhotoAttachment(job)) return;
        setDrivePhotoAttachmentStatus(job,'Save failed');
        showToast('Photo not saved',formatPhotoUploadErrorMessage(error),true);
    }).finally(() => { job.running = false; });
    return false;
}

function isSuspendDetailPhoto(job) {
    return job.prefix === 'req-' && isDockSuspendDcRequestMirrorRow(job.item);
}

function getScopedDetailRowPhotoJobs(item, prefix) {
    const uid = String(item?.UNIQUE_ID || item?.unique_id || '');
    return [...drivePhotoAttachments.values()].filter(job => uid && isCurrentDrivePhotoAttachment(job)
        && String(job.identity.UNIQUE_ID) === uid && (!prefix || job.prefix === prefix));
}

export function getDetailRowPhotoUploadPromises(item, prefix = '') {
    return getScopedDetailRowPhotoJobs(item, prefix).map(job => job.promise).filter(Boolean);
}

export function hasUnsettledDetailRowPhotos(item, prefix = '') {
    return getScopedDetailRowPhotoJobs(item, prefix).length > 0
        || getPendingPhotoPreviewEntries(item, prefix).some(entry => entry.status !== 'Uploaded');
}

export function setDrivePhotoAttachmentStatus(job, status) {
    if (!isCurrentDrivePhotoAttachment(job)) return;
    job.status = status;
    getPendingPhotoPreviewEntries(job.item, job.prefix).forEach(entry => {
        if (entry.id === job.preview.id) Object.assign(entry, { status, uploadId:job.id, scope:job.scope, storageUrl:job.upload?.publicUrl });
    });
    refreshPendingPhotoUiForItem(job.item, job.prefix);
}

export async function uploadPhotoViaAppApi(prefix = 'default', blob = null, fileName = 'photo.jpg', contentType = 'image/jpeg', options = {}) {
    if (!blob) throw new Error('Missing photo file.');
    const hasDirectFallback = hasDirectSupabaseWriteFallbackConfigured();
    const useNativeUpload = (nativeAuthSessionActive && SECURE_DRIVE_EVIDENCE_PREFIXES.has(prefix)) || !APP_API_DB_WRITE_PROXY_ENABLED || (hasDirectFallback && isAppApiWriteProxyTemporarilyUnavailable());
    const nativeEvidenceUpload = (nativeAuthSessionActive && options.nativeMaster) || (useNativeUpload && SECURE_DRIVE_EVIDENCE_PREFIXES.has(prefix));
    const optimized = options.preparedPhoto || await optimizePhotoBlobForUpload(blob, fileName, {mainOnly:false});
    if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())) throw Object.assign(new Error('Photo session changed.'), { code: 'REQUEST_ABORTED' });
    blob = optimized.blob || blob;
    contentType = optimized.contentType || contentType;
    const safeFileName = String(optimized.fileName || fileName || 'photo.jpg').trim() || 'photo.jpg';
    const formData = new FormData();
    formData.append('prefix', String(prefix || 'default').trim() || 'default');
    formData.append('uploadContract', 'plant-photo-v2');
    formData.append('fileName', safeFileName);
    formData.append('file', blob, safeFileName);
    if (optimized.thumbnail144Blob) formData.append('thumbnail144', optimized.thumbnail144Blob, safeFileName);
    if (optimized.thumbnail320Blob) formData.append('thumbnail320', optimized.thumbnail320Blob, safeFileName);
    formData.append('displayWidth', String(optimized.width || 0));
    formData.append('displayHeight', String(optimized.height || 0));
    formData.append('thumbnail144Width', String(optimized.thumbnail144Width || 0));
    formData.append('thumbnail144Height', String(optimized.thumbnail144Height || 0));
    formData.append('thumbnail320Width', String(optimized.thumbnail320Width || 0));
    formData.append('thumbnail320Height', String(optimized.thumbnail320Height || 0));
    if (options && options.formFields && typeof options.formFields === 'object') {
        Object.entries(options.formFields).forEach(([key, value]) => {
            const safeKey = String(key || '').trim();
            if (safeKey && value !== null && typeof value !== 'undefined') formData.append(safeKey, String(value));
        });
    }
    const payload = await sendPreparedRowPhotoUpload(formData, nativeEvidenceUpload, options);
    if (!payload || payload.ok !== true || !payload.publicUrl) {
        throw new Error(String(payload && (payload.error || payload.message) || 'Secure photo upload failed.'));
    }
    return payload;
}
