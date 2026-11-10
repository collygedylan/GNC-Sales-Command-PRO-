function renderRequestCompactSummary(snapshot, canOpen = true) {
    const text = value => escapeShareHtml(String(value ?? 'N/A'));
    const locationLot = snapshot.extras.find(entry => entry[0] === 'Location / Lot')?.[1];
    return `<div class="request-reference-bar">
        <div class="request-reference-identity"><strong>${text(snapshot.commonName)} · ${text(snapshot.topCode)} · ${text(locationLot)}</strong>${canOpen ? '<button type="button" onclick="return openRequestSummaryDialog()">ℹ️ Full Info</button>' : ''}</div>
        <div class="request-reference-line">Qty <b>${text(snapshot.requestQty)}</b> · Reserve <b>${text(snapshot.reserveValue)}</b> · ${text(snapshot.salesRepName)} · ${text(snapshot.customerConsignee)}</div>
        <div class="request-reference-line" title="${text(snapshot.requestNote)}">Note: ${text(snapshot.requestNote || 'N/A')} · Req Spec: ${text(snapshot.desiredSpec)}</div>
        <div class="request-reference-line">On Hand <b>${text(snapshot.ptrValue)}</b> · Avail <b>${text(snapshot.ptrAvailableValue)}</b> · Open <b>${text(snapshot.sLtsValue)}</b></div>
    </div>`;
}

function requestSummaryKey(item) {
    const uid = getItemUniqueId(item);
    return uid ? JSON.stringify([getSupabaseReadIdentityScope(), uid]) : '';
}

function captureRequestSummaryIntent(uid) {
    if (getCurrentVisibleViewId() !== 'request' || activeReqTab !== 'pending') return null;
    return { key:requestSummaryKey(uid), opened:false };
}

function activeRequestSummaryKey(item, sourceView) {
    if (sourceView !== 'request' || activeDetailSourceView !== 'request' || getCurrentVisibleViewId() !== 'detail'
        || !item || getItemUniqueId(item) !== getItemUniqueId(activeItem) || !isRequestDetailItem(item, sourceView)
        || isDockSuspendDcRequestMirrorRow(item) || !isRequestPendingVisible(item)) return '';
    return requestSummaryKey(item);
}

function openRequestSummaryDialog() {
    const key = activeRequestSummaryKey(activeItem, activeDetailSourceView);
    if (!key || document.getElementById('request-detail-info')?.dataset.summaryEntry !== key) return false;
    const dialog = document.getElementById('request-summary-dialog');
    if (dialog && !dialog.open) dialog.showModal();
    syncGlobalModalBack();
    return false;
}

function closeRequestSummaryDialog(restoreFocus = true) {
    document.getElementById('request-summary-dialog')?.close();
    if (restoreFocus) document.querySelector('#request-detail-info .request-reference-identity button')?.focus({ preventScroll: true });
    syncGlobalModalBack();
    return false;
}

function clearRequestSummaryEntry() {
    const host = document.getElementById('request-detail-info');
    if (host) delete host.dataset.summaryEntry;
    if (document.getElementById('request-summary-dialog')?.open) closeRequestSummaryDialog(false);
}

function renderRequestDetailInfo(item, sourceView, options = null) {
    const host = document.getElementById('request-detail-info');
    const root = document.getElementById('view-detail');
    if (!host || !root) return;
    if (getCurrentVisibleViewId() !== 'detail') return clearRequestSummaryEntry();
    if (getItemUniqueId(item) !== getItemUniqueId(activeItem)) return;
    const entry = activeRequestSummaryKey(item, sourceView);
    const intent = options?.requestSummaryIntent;
    const explicit = !!entry && intent?.key === entry;
    const canOpen = !!entry && (explicit || host.dataset.summaryEntry === entry);
    if (options === null && canOpen) {
        const snapshot = getRequestOpenInfoSnapshot(item, sourceView);
        const bar = host.querySelector('.request-reference-bar');
        const info = host.querySelector('.request-open-info-card');
        if (bar) bar.outerHTML = renderRequestCompactSummary(snapshot);
        if (info) info.outerHTML = buildRequestOpenInfoHtml(item, sourceView);
        return;
    }
    document.getElementById('request-summary-dialog')?.close();
    host.replaceChildren();
    const isRequest = sourceView === 'request' && isRequestDetailItem(item, sourceView)
        && !isDockSuspendDcRequestMirrorRow(item);
    root.classList.toggle('detail-request-reference', isRequest);
    host.dataset.summaryEntry = canOpen ? entry : '';
    if (!isRequest) {
        document.getElementById('request-detail-load-state')?.after(host);
        host.innerHTML = sourceView === 'request' && isRequestDetailItem(item, sourceView)
            ? buildRequestOpenInfoHtml(item, sourceView) : '';
        return;
    }
    root.prepend(host);
    const snapshot = getRequestOpenInfoSnapshot(item, sourceView);
    host.innerHTML = renderRequestCompactSummary(snapshot, canOpen);
    if (!canOpen) return;
    host.insertAdjacentHTML('beforeend', `<dialog id="request-summary-dialog" aria-label="Full Request Info" onclose="syncGlobalModalBack()">
        <button type="button" data-secondary-back="true" aria-hidden="true" class="back-btn" onclick="return closeRequestSummaryDialog()">Back</button>
        ${buildRequestOpenInfoHtml(item, sourceView)}
        <div class="request-summary-footer"><button type="button" autofocus onclick="return closeRequestSummaryDialog()">Got It / Start Evaluation</button></div>
    </dialog>`);
    if (explicit && !intent.opened && options.skipRequestOpenInfoModal !== true) {
        intent.opened = true;
        openRequestSummaryDialog();
    }
}
