
function parsePhotoCsvValues(value = '') {
    return String(value || '').replace(/(data:image\/[^,]+),/gi, '$1\u0000').split(',')
        .map(entry => entry.replace('\u0000', ',').trim()).filter(Boolean);
}

function strictInventoryPhotoLocationKey(row) {
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

function calculateLiveLocPhotoMatch(row = {}, note = null) {
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

function hasDetachedDrivePhotoWrite(uid) {
    for (const job of drivePhotoAttachments.values()) {
        if (job.identity.UNIQUE_ID === uid && job.running && job.commandRow?.__drivePhotoAbort) return true;
    }
    return false;
}

function queueDetailRowPhoto(item, prefix, file) {
    const normalized = String(prefix || '').trim().toLowerCase();
    if (!SECURE_DRIVE_EVIDENCE_PREFIXES.has(normalized)) return queueRowPhotoUpload(item,prefix,file);
    const fileName = buildInventoryRowPhotoFileName(item,file,{ extension:getInventoryPhotoFileExtension(file,'jpg') });
    return queueDrivePhotoAttachment(item,normalized,file,fileName);
}

const ROW_PHOTO_TRANSFER_RETRY_DELAYS = [300, 800];
const ROW_PHOTO_SAVE_RETRY_DELAYS = [300, 800, 1500];

function isRetryablePhotoTransfer(error) {
    if (error?.name === 'AbortError' || ['REQUEST_ABORTED', 'DATASET_READ_SCOPE_CHANGED'].includes(error?.code)) return false;
    return isTransientPhotoUploadFailure(error) || Number(error?.status) === 544;
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
    try {
        return await uploadDrivePhotoWithNativeSession(nativeForm, nativeOptions);
    } catch (error) {
        if (options.signal?.aborted || (options.isCurrent && !options.isCurrent())
            || [401,403].includes(Number(error?.status)) || error?.code === '42501') throw error;
        try {
            return await postAppFunctionFormData(APP_API_FUNCTION_URL, formData, { ...options, label:'Secure photo upload' });
        } catch (edgeError) {
            if (Number(edgeError?.status) !== 403 || options.signal?.aborted || (options.isCurrent && !options.isCurrent())) throw edgeError;
            return uploadDrivePhotoWithNativeSession(nativeForm, nativeOptions);
        }
    }
}

async function sendPreparedRowPhotoUpload(formData, nativeEvidenceUpload, options) {
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

async function resolveQueuedRowPhotoMaster(job) {
    if (job.prefix === 'req-' && isDockSuspendDcRequestMirrorRow(job.item)) {
        return resolveSuspendPhotoMaster(job.item, job.uploadController.signal);
    }
    return ['req-', 'dock-'].includes(job.prefix) ? findLinkedMasterRow(job.item) : null;
}

async function uploadRowPhotoAttachment(job) {
    setDrivePhotoAttachmentStatus(job,'Uploading');
    job.uploadController = new AbortController();
    const master = await resolveQueuedRowPhotoMaster(job);
    if ((master || SECURE_DRIVE_EVIDENCE_PREFIXES.has(job.prefix)) && !nativeAuthSessionActive) {
        await getNativeAuthRequestHeaders().catch(() => null);
    }
    if (!isCurrentDrivePhotoAttachment(job)) return;
    const identity = getRowPhotoUploadIdentity(job, master);
    const nativeMaster = master ? { UNIQUE_ID: identity.UNIQUE_ID } : null;
    const uploaded = await uploadPhotoViaAppApi(job.prefix, job.file, job.fileName, job.file.type || 'image/jpeg', {
        timeoutMs:30000, signal:job.uploadController.signal, isCurrent:() => isCurrentDrivePhotoAttachment(job),
        singleUploadAttempt:job.prefix !== 'dock-',
        nativeMaster,
        formFields:job.formFields || {masterUid:identity.UNIQUE_ID,itemCode:identity.ITEMCODE,
            locationCode:identity.LOCATIONCODE,lotCode:identity.LOTCODE}
    });
    if (!isCurrentDrivePhotoAttachment(job)) return;
    if (!uploaded.publicUrl) throw new Error('Photo upload did not return a saved photo.');
    job.upload = {
        publicUrl:normalizeStoragePublicUrl(uploaded.publicUrl), fileName:String(uploaded.filePath || job.fileName).split('/').pop(),
        filePath:uploaded.filePath, receipt:uploaded.receipt
    };
    if (job.prefix === 'dock-') setDrivePhotoAttachmentStatus(job,'Uploaded');
}

async function persistQueuedRowPhoto(job) {
    if (SECURE_DRIVE_EVIDENCE_PREFIXES.has(job.prefix)) {
        const actionKey = job.scope + '|' + getRowSaveCoordinatorKey(job.prefix,job.item);
        await window.__agdataMarkDoneActions?.get(actionKey)?.finished;
    }
    return retryPhotoOperation(job, () => {
        const conflict = job.commandRow?.__driveEvidenceConflict;
        if (conflict && !resetPhotoAttachmentConflict(job, conflict)) throw new Error('Photo row identity changed.');
        return persistDrivePhotoAttachment(job);
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
        return enqueueRowPhotoSave(job, null, persistDrivePhotoAttachment);
    }, [0], isTransientPhotoUploadFailure);
    const uploaded = retryPhotoOperation(job, upload, ROW_PHOTO_TRANSFER_RETRY_DELAYS, isRetryablePhotoTransfer);
    return enqueueRowPhotoSave(job, uploaded);
}

function retryDrivePhotoAttachment(id) {
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
        showToast('Photo not saved',formatPhotoUploadErrorMessage(error),true);
    }).finally(() => { job.running = false; });
    return false;
}

async function uploadPhotoViaAppApi(prefix = 'default', blob = null, fileName = 'photo.jpg', contentType = 'image/jpeg', options = {}) {
    if (!blob) throw new Error('Missing photo file.');
    const hasDirectFallback = hasDirectSupabaseWriteFallbackConfigured();
    const useNativeUpload = (nativeAuthSessionActive && SECURE_DRIVE_EVIDENCE_PREFIXES.has(prefix)) || !APP_API_DB_WRITE_PROXY_ENABLED || (hasDirectFallback && isAppApiWriteProxyTemporarilyUnavailable());
    const nativeEvidenceUpload = (nativeAuthSessionActive && options.nativeMaster) || (useNativeUpload && SECURE_DRIVE_EVIDENCE_PREFIXES.has(prefix));
    const optimized = await optimizePhotoBlobForUpload(blob, fileName, {mainOnly:false});
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


function collectStrictItemDetailPhotos(targetRow = null, prefix = '') {
    if (!targetRow) return [];
    const state = getManagerAssignedColumnState();
    const master = findLinkedMasterRow(targetRow) || masterInventoryById.get(String(targetRow.UNIQUE_ID || targetRow.unique_id || ''));
    const masterUid = String(master?.UNIQUE_ID || master?.unique_id || targetRow.MASTER_ID || targetRow.master_id || targetRow.MASTER_UNIQUE_ID || targetRow.master_unique_id || '');
    const rowUid = row => String(row?.MASTER_ID || row?.master_id || row?.MASTER_UNIQUE_ID || row?.master_unique_id || row?.UNIQUE_ID || row?.unique_id || '');
    const matches = row => canonicalInventorySameLot(row,targetRow) && (!masterUid || rowUid(row) === masterUid);
    const urls = new Set(), visited = new Set();
    const add = input => {
        if (!input) return;
        if (Array.isArray(input)) { input.forEach(add); return; }
        if (typeof input === 'object') {
            if (visited.has(input)) return;
            visited.add(input);
            for (const key of ['url','publicUrl','photo_url','photo_urls','photos','request_photos','photo_link','saved_photo_link','req_photo_link','request_photo_link','dock_photo_link','flyer_photo_link']) {
                add(input[key]); add(input[key.toUpperCase()]);
            }
            return;
        }
        getPhotoUrlList(input).forEach(url => { if (/^https?:\/\//i.test(url)) urls.add(url); });
    };
    add(targetRow);
    const active = typeof activeItem !== 'undefined' && activeItem;
    const activeMatches = active && (active === targetRow || matches(active));
    const evalMatches = prefix === 'eval-' && String(evalWorkActiveOriginUid || '') === String(masterUid || rowUid(targetRow)) && !!getEvalWorkById(activeEvalWorkDetailId);
    if (activeMatches || evalMatches) {
        if (activeMatches) add(active);
        if (evalMatches) add(evalWorkActivePhotos);
        add(state.activeItemDetailPhotos); add(state.itemDetailDraft?.photos);
        const detail = evalMatches ? document.querySelector('#request-content .eval-work-evidence') : document.getElementById('view-detail');
        if (detail && !detail.classList.contains('hidden')) {
            const strip = evalMatches ? detail : document.getElementById(prefix + 'photo-list-container') || detail;
            strip.querySelectorAll('[data-photo-url], [data-eval-photo-url], .photo-card img, .saved-photo-tile img').forEach(node => {
                const canonical = node.getAttribute('data-photo-url') || node.getAttribute('data-eval-photo-url') || node.closest('[data-photo-url]')?.getAttribute('data-photo-url');
                add(canonical || node.getAttribute('data-src') || node.currentSrc || node.src);
            });
        }
    }
    const sources = [typeof fullInventory !== 'undefined' ? fullInventory : [],state.fullInventory];
    if (state.noteScope === getSupabaseReadIdentityScope()) sources.push(state.locationSalesNotes);
    for (const source of sources) {
        const list = source instanceof Map ? [...source.values()].flat() : Array.isArray(source) ? source : Object.values(source || {}).flat();
        list.filter(matches).forEach(add);
    }
    return [...urls];
}

