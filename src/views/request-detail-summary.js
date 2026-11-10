export function renderRequestCompactSummary(snapshot) {
    const text = value => escapeShareHtml(String(value ?? 'N/A'));
    const locationLot = snapshot.extras.find(entry => entry[0] === 'Location / Lot')?.[1];
    return `<div class="request-reference-bar">
        <div class="request-reference-identity"><strong>${text(snapshot.commonName)} · ${text(snapshot.topCode)} · ${text(locationLot)}</strong><button type="button" onclick="return openRequestSummaryDialog()">ℹ️ Full Info</button></div>
        <div class="request-reference-line">Qty <b>${text(snapshot.requestQty)}</b> · Reserve <b>${text(snapshot.reserveValue)}</b> · ${text(snapshot.salesRepName)} · ${text(snapshot.customerConsignee)}</div>
        <div class="request-reference-line" title="${text(snapshot.requestNote)}">Note: ${text(snapshot.requestNote || 'N/A')} · Req Spec: ${text(snapshot.desiredSpec)}</div>
        <div class="request-reference-line">On Hand <b>${text(snapshot.ptrValue)}</b> · Avail <b>${text(snapshot.ptrAvailableValue)}</b> · Open <b>${text(snapshot.sLtsValue)}</b></div>
    </div>`;
}

export function openRequestSummaryDialog() {
    const dialog = document.getElementById('request-summary-dialog');
    if (dialog && !dialog.open) dialog.showModal();
    syncGlobalModalBack();
    return false;
}

export function closeRequestSummaryDialog(restoreFocus = true) {
    document.getElementById('request-summary-dialog')?.close();
    if (restoreFocus) document.querySelector('#request-detail-info .request-reference-identity button')?.focus({ preventScroll: true });
    syncGlobalModalBack();
    return false;
}

export function renderRequestDetailInfo(item, sourceView, options = null) {
    const host = document.getElementById('request-detail-info');
    const root = document.getElementById('view-detail');
    if (!host || !root) return;
    const entry = `${getSupabaseReadIdentityScope()}|${item?.UNIQUE_ID}`;
    if (options === null && sourceView === 'request' && host.dataset.summaryEntry === entry) {
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
    host.dataset.summaryEntry = isRequest ? entry : '';
    if (!isRequest) {
        document.getElementById('request-detail-load-state')?.after(host);
        host.innerHTML = sourceView === 'request' && isRequestDetailItem(item, sourceView)
            ? buildRequestOpenInfoHtml(item, sourceView) : '';
        return;
    }
    root.prepend(host);
    const snapshot = getRequestOpenInfoSnapshot(item, sourceView);
    host.innerHTML = renderRequestCompactSummary(snapshot) + `<dialog id="request-summary-dialog" aria-label="Full Request Info" onclose="syncGlobalModalBack()">
        <button type="button" data-secondary-back="true" aria-hidden="true" class="back-btn" onclick="return closeRequestSummaryDialog()">Back</button>
        ${buildRequestOpenInfoHtml(item, sourceView)}
        <div class="request-summary-footer"><button type="button" autofocus onclick="return closeRequestSummaryDialog()">Got It / Start Evaluation</button></div>
    </dialog>`;
    if (options && options.skipRequestOpenInfoModal !== true) openRequestSummaryDialog();
}
