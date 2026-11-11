export function isCompactQueueDetail(item, sourceView) {
    return sourceView === 'request' && !!item && isRequestDetailItem(item, sourceView);
}

export function renderRequestCompactSummary(snapshot) {
    const text = value => escapeShareHtml(String(value ?? '--'));
    const identity = [snapshot.commonName, snapshot.contSize, snapshot.lotCode,
        snapshot.locationCode, `PRI ${snapshot.priorityValue || '--'}`];
    return `<div class="request-reference-bar" style="height:44px;max-height:48px">
        <div class="request-reference-line" aria-label="Item identity">${identity.map(value => `<span title="${text(value)}">${text(value)}</span>`).join('<b aria-hidden="true"> · </b>')}</div>
    </div>`;
}

export function captureRequestSummaryIntent(uid) {
    return { key: String(uid || '') };
}

export function clearRequestSummaryEntry() {
    const host = document.getElementById('request-detail-info');
    if (host) host.replaceChildren();
    document.getElementById('view-detail')?.classList.remove('detail-request-reference');
}

function compactDetailCell(label, value) {
    const text = String(value ?? '').trim() || 'N/A';
    return `<div class="request-compact-cell" data-detail-field="${escapeShareHtml(label)}">
        <span class="request-compact-label">${escapeShareHtml(label)}</span>
        <span class="request-compact-value" title="${escapeShareHtml(text)}">${escapeShareHtml(text)}</span></div>`;
}

export function buildCompactRequestDetailHeader(item, snapshot) {
    const identity = { ...snapshot,
        contSize: firstNonEmptyValue(item.CONTSIZE, item.contsize, '--'),
        lotCode: firstNonEmptyValue(item.LOTCODE, item.lotcode, '--'),
        locationCode: firstNonEmptyValue(item.LOCATIONCODE, item.locationcode, '--') };
    const metrics = [['Priority',snapshot.priorityValue],['On Hand',snapshot.ptrValue],
        ['Review',snapshot.ptrReviewedValue],['Available',snapshot.ptrAvailableValue],['Open Stock',snapshot.sLtsValue]];
    const metadata = [['Qty',snapshot.requestQty],['Reserve',snapshot.reserveValue],
        ['Sales Rep',snapshot.salesRepName],['Customer / Consignee',snapshot.customerConsignee],
        ['Row Note',snapshot.requestNote],['Required Spec',snapshot.desiredSpec],['Required Caliper',snapshot.desiredCaliper]];
    const dock = isDockSuspendDcRequestMirrorRow(item)
        ? [['Dock #',firstNonEmptyValue(item.DOCKNUMBER,item.docknumber,'--')],
            ['Drop #',firstNonEmptyValue(item.DROPNUMBER,item.dropnumber,'--')],
            ['Load #',firstNonEmptyValue(item.LOADNUMBER,item.loadnumber,'--')]] : [];
    return `<div class="request-compact-header"><div class="request-compact-top">${renderRequestCompactSummary(identity)}
        ${dock.length ? `<div class="request-compact-dock">${dock.map(([label,value]) => compactDetailCell(label,value)).join('')}</div>` : ''}</div>
        <div class="request-compact-metrics" aria-label="Inventory metrics">${metrics.map(([label,value]) => compactDetailCell(label,value)).join('')}</div>
        <div class="request-compact-metadata" aria-label="Request metadata">${metadata.map(([label,value]) => compactDetailCell(label,value)).join('')}</div></div>`;
}

export function renderRequestDetailInfo(item, sourceView, options = null) {
    const host = document.getElementById('request-detail-info');
    const root = document.getElementById('view-detail');
    if (!host || !root) return;
    if (getCurrentVisibleViewId() !== 'detail') return clearRequestSummaryEntry();
    if (getItemUniqueId(item) !== getItemUniqueId(activeItem)) return;
    const compact = isCompactQueueDetail(item,sourceView);
    root.classList.toggle('detail-request-reference', compact);
    host.removeAttribute('style');
    host.replaceChildren();
    if (!compact) {
        document.getElementById('request-detail-load-state')?.after(host);
        return;
    }
    const intent = options?.requestSummaryIntent;
    if (intent?.key && intent.key !== getItemUniqueId(item)) return;
    root.prepend(host);
    host.innerHTML = buildRequestOpenInfoHtml(item,sourceView);
    root.querySelector('[data-inline-detail-share]')?.remove();
}

export function getRequestOpenInfoSnapshot(item = activeItem, detailSourceView = '') {
            if (!item) return null;
            const commonName = String(firstNonEmptyValue(item.COMMONNAME, item.commonname, item.COMMON_NAME, item.common_name, 'Unknown') || 'Unknown').trim();
            const contSize = String(firstNonEmptyValue(item.CONTSIZE, item.contsize, item.CONTAINER_SIZE, item.container_size, '') || '').trim();
            const itemCode = String(firstNonEmptyValue(item.ITEMCODE, item.itemcode, item.ITEM_CODE, item.item_code, '') || '').trim();
            const locationCode = String(firstNonEmptyValue(item.LOCATIONCODE, item.locationcode, item.LOCATION_CODE, item.location_code, '') || '').trim();
            const lotCode = String(firstNonEmptyValue(item.LOTCODE, item.lotcode, item.LOT_CODE, item.lot_code, '') || '').trim();
            const sourceValue = String(firstNonEmptyValue(item.SOURCE, item.source, item.SOURCECODE, item.sourcecode, '') || '').trim();
            const requestFolder = typeof getRequestFolderName === 'function' ? String(getRequestFolderName(item) || '').trim() : String(firstNonEmptyValue(item.REQUEST_FOLDER, item.request_folder, '') || '').trim();
            const metrics = buildQueueInventoryMetricsHtml(item,detailSourceView || 'request',{detailMetrics:true});
            const desiredSpec = getRequestDesiredSpecValue(item);
            const desiredCaliper = getRequestDesiredCaliperValue(item);
            const requestNote = getRequestRowNoteValue(item);
            const requestQty = String(resolveRequestCardQuantity(item) ?? '').trim();
            const salesRepName = String(firstNonEmptyValue(item.REQUESTED_BY, item.requested_by, item.UPDATED_BY, item.updated_by, item.SALESREPNAME, item.SALESREP, item.SALESREPID, '') || '').trim();
            const customerConsignee = typeof getRequestCustomerConsigneeLabelForItem === 'function'
                ? getRequestCustomerConsigneeLabelForItem(item)
                : String(firstNonEmptyValue(item.REQ_CUSTOMER, item.req_customer, item.CUSTOMERNAME, item.CONSIGNEENAME, '') || '').trim();
            const topCode = [contSize, locationCode].filter(Boolean).join(' ') || itemCode || requestFolder || 'Request Row';
            const extras = [
                ['Item Code', itemCode],
                ['Location / Lot', [locationCode, lotCode].filter(Boolean).join(' / ')],
                ['Source', sourceValue],
                ['Request Folder', requestFolder]
            ];
            return {
                commonName,
                topCode,
                priorityValue: String(firstNonEmptyValue(item.PRIORITY, item.priority, '--') || '--').trim(),
                ptrValue: getCardPtrOnHandValue(metrics),
                ptrReviewedValue: getCardPtrReviewedValue(metrics),
                ptrAvailableValue: getCardPtrAvailableValue(metrics),
                sLtsValue: getCardOpenStockValue(metrics),
                locOnHand: firstNonEmptyValue(metrics.LOC_ON_HAND,metrics.loc_on_hand,''),
                locPhotoMatch: firstNonEmptyValue(metrics.LOC_PHOTO_MATCH,metrics.loc_photo_match,metrics.LOC_MATCH_QTY,''),
                requestQty: requestQty || '0',
                reserveValue: normalizeRequestReserveValue(firstNonEmptyValue(item.REQ_RESERVE, item.req_reserve, 'NO')),
                salesRepName: salesRepName || 'Unknown Rep',
                customerConsignee: customerConsignee || 'Unknown Customer',
                requestNote: String(requestNote || '').trim(),
                desiredSpec,
                desiredCaliper,
                extras
            };
        }

export function buildRequestOpenInfoHtml(item = activeItem, detailSourceView = '') {
            const snapshot = getRequestOpenInfoSnapshot(item, detailSourceView);
            return snapshot ? buildCompactRequestDetailHeader(item, snapshot) : '';
        }
