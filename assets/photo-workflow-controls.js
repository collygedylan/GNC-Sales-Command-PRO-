function canRemoveProtectedPhoto(prefix, item = activeItem) {
    if (!isPhotoMutationSurface(prefix) || globalThis.isAvDetailReadOnlyContext()) return false;
    if (!item) return false;
    if (isProtectedSectionCompleted(prefix, item) && !isProtectedUnlocked(prefix)) return false;
    if (canUsePhotoDeleteOverride()) return true;
    if (!canEditRowDetails(prefix)) return false;
    if (!isProtectedSectionCompleted(prefix, item)) return true;
    return isProtectedUnlocked(prefix);
}

function updateTaskDetailQuickCameraState(sourceView = activeDetailSourceView || lastView || '', item = activeItem) {
    const wrapper = document.getElementById('task-detail-camera-quick');
    const input = document.getElementById('task-detail-camera-input');
    const label = document.getElementById('task-detail-camera-label');
    if (!wrapper || !input) return;
    const safeSourceView = String(sourceView || '').trim().toLowerCase();
    const isRequestContext = safeSourceView === 'request' || (safeSourceView !== 'tasks' && item && (isRequestLikeItem(item) || isRequestDetailItem(item, safeSourceView)));
    const tabPrefix = getDetailPhotoUpdatePrefixFromTab(activeDetailTab);
    if (!tabPrefix || !item) {
        wrapper.classList.add('hidden');
        wrapper.classList.remove('task-detail-camera-quick--request');
        input.dataset.detailPhotoPrefix = '';
        return;
    }
    const prefix = tabPrefix || (isRequestContext ? 'req-' : getTaskDetailQuickPhotoPrefix(item, activeTaskTab, safeSourceView));
    const canCapture = prefix === 'ncr-' ? canEditNcrWorkflow(item) : canEditRowDetails(prefix, item);
    if (!prefix || !isPhotoMutationSurface(prefix,safeSourceView) || !canCapture) {
        wrapper.classList.add('hidden');
        wrapper.classList.remove('task-detail-camera-quick--request');
        input.dataset.detailPhotoPrefix = '';
        return;
    }
    input.dataset.detailPhotoPrefix = prefix;
    if (label) label.innerText = getTaskDetailQuickPhotoLabel(prefix);
    wrapper.classList.toggle('task-detail-camera-quick--request', true);
    wrapper.classList.remove('hidden');
}

function applyCameraPermissions(sourceView, taskContextItem = activeItem) {
    const safeSourceView = String(sourceView || '').trim().toLowerCase();
    document.body.dataset.photoMutationSource = safeSourceView;
    document.body.dataset.photoMutationSource = safeSourceView;
    const camSsn = document.getElementById('camera-btn-ssn');
    const camLsn = document.getElementById('camera-btn-lsn');
    const camNa = document.getElementById('camera-btn-na');
    const camReq = document.getElementById('camera-btn-req');
    const camDock = document.getElementById('camera-btn-dock');
    const camFlyer = document.getElementById('camera-btn-flyer');
    const camNcr = document.getElementById('camera-btn-ncr');

    [
        [camSsn, 'ssn-'],
        [camLsn, 'lsn-'],
        [camNa, 'na-'],
        [camReq, 'req-'],
        [camDock, 'dock-'],
        [camFlyer, 'flyer-']
    ].forEach(([element,prefix])=>setPhotoCameraControl(element,prefix,safeSourceView,taskContextItem));
    if (camNcr) camNcr.style.display = 'none';

    updateTaskDetailQuickCameraState(safeSourceView, taskContextItem);
}

async function handlePhotoUpload(input, prefix) {
    window.finishCameraCapture?.();
    if (!isPhotoMutationSurface(prefix)) { if (input) input.value = ''; return false; }
    try { sessionStorage.removeItem('agdata_camera_detail_v1'); } catch { globalThis.safeIgnoreProbeError?.('camera-detail-state'); }
    if (!input.files || input.files.length === 0 || !activeItem) return;
    if (isRepReadOnlyUser() && !canRepEditDetailPrefix(prefix)) {
        showRowEditRestrictedToast(prefix);
        input.value = '';
        return;
    }
    markCameraActivity();
    if (String(activeDetailSourceView || lastView || '').trim().toLowerCase() === 'av' && !canEditRowDetails(prefix)) {
        showToast('View Only', 'AV detail is read-only. Photos can be viewed but not updated here.', true);
        input.value = '';
        return;
    }
    if (!canEditRowDetails(prefix)) {
        showRowEditRestrictedToast(prefix);
        input.value = '';
        return;
    }
    if (String(prefix || '').trim().toLowerCase() === 'req-' && !canCurrentUserWorkRequestItem(activeItem, 'photo')) {
        showRowEditRestrictedToast(prefix);
        input.value = '';
        return;
    }
    const itemToUpload = activeItem;
    if ((isIOSDevice() || isStandaloneApp()) && document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {
        document.activeElement.blur();
    }
    if (navigator.onLine === false && !['ssn-','lsn-','na-','req-','dock-'].includes(prefix)) {
        showToast('Offline', 'No service. Photo could not upload.', true);
        input.value = '';
        return;
    }
    const selectedFiles = Array.from(input.files || []);
    input.value = '';
    const imageFiles = selectedFiles.filter((file) => file && String(file.type || '').startsWith('image/'));
    if (!imageFiles.length) {
        showToast('Error', 'Please select an image file.', true);
        return;
    }
    if (imageFiles.length > 1) {
        showToast('Uploading', `Uploading ${imageFiles.length} photos...`, false);
    }
    imageFiles.forEach(file => queueDetailRowPhoto(itemToUpload,prefix,file));
    if (String(prefix || '').trim().toLowerCase() === 'req-' && isRequestDetailItem(itemToUpload, activeDetailSourceView || lastView || '') && activeDetailTab !== 'request' && isDetailTabVisible('request')) {
        switchDetailTab('request', { suppressScroll: true });
    }
}

function setPhotoCameraControl(element,prefix,source,item) {
    const canCapture = prefix==='req-' ? canCurrentUserWorkRequestItem(item || activeItem,'photo') : canEditRowDetails(prefix);
    const enabled = isPhotoMutationSurface(prefix,source) && canCapture;
    if (!element) return;
    element.style.display = enabled ? 'flex' : 'none';
    if (prefix!=='req-') return;
    element.classList.toggle('request-camera-enabled',enabled);
    document.getElementById('det-request-camera-panel')?.classList.toggle('hidden',!enabled);
}
