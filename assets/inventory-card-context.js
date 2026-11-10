function buildEvalOwnerBadge(item) {
    return '<span class="card-eval-owner">EVAL: ' + escapeHtml(getSuspendEvalOwner(item) || 'Unassigned') + '</span>';
}

function prepareInventoryCardItem(item, sourceView, colorClass, renderMeta) {
    const canonicalStatusRow = item;
    if (['drive', 'av', 'av-photo', 'eval-work'].includes(String(sourceView || '').toLowerCase())) {
        const domId = item?.DOM_ID;
        item = resolveCanonicalInventoryRow(item) || item;
        if (domId !== undefined) item.DOM_ID = domId;
    }
    const statusSync = getInventoryStatusSync();
    if (statusSync && item && String(item.SOURCE_TABLE || item.source_table || 'ph_master_inventory') === 'ph_master_inventory') {
        statusSync.seed([item]);
        item = statusSync.getDisplayRow(item);
        if (item.DOM_ID) {
            inventoryStatusRenderedCards.set(String(item.DOM_ID), {
                row: canonicalStatusRow,
                uid: String(item.UNIQUE_ID || item.unique_id || ''), sourceView, colorClass, renderMeta,
                signature: inventoryStatusCardSignature(item)
            });
            if (inventoryStatusRenderedCards.size > 5000) inventoryStatusRenderedCards.delete(inventoryStatusRenderedCards.keys().next().value);
        }
    }
    if (sourceView === 'request' || sourceView === 'docks') item = getDockCardLiveInventoryDisplayRow(item);
    item = buildDockSuspendDcRequestCardDisplayItem(item, sourceView);
    item = { ...item };
    for (const field of ['COMMONNAME', 'commonname', 'DESCRIPTION', 'description']) {
        if (typeof item[field] === 'string') item[field] = normalizeEscapedDisplayText(item[field]);
    }
    normalizeRowPhotoFields(item);
    const resolvedCardUniqueId = String(firstNonEmptyValue(item && item.UNIQUE_ID, item && item.unique_id, item && item.ID, item && item.id, '') || '').trim();
    if (resolvedCardUniqueId && !String(item.UNIQUE_ID || '').trim()) item.UNIQUE_ID = resolvedCardUniqueId;
    if (resolvedCardUniqueId && !String(item.unique_id || '').trim()) item.unique_id = resolvedCardUniqueId;
    if (String(sourceView || '').trim().toLowerCase() === 'tasks') rememberTaskRenderedRow(item);
    return item;
}
function createInventoryCardBaseContext(context) {
    let { sourceView, item } = context;
    const cardSourceViewKey = String(sourceView || '').trim().toLowerCase();
    const safeCardSourceViewKey = escJsAttrValue(cardSourceViewKey);
    let thumbHtml = '';
    const canonicalCardPhotoUrls = resolveCanonicalPhotoUrls(item, sourceView);
    let photoLink = canonicalCardPhotoUrls.join(',');
    const photoDateLabel = resolveAndFormatPhotoDate(item, canonicalCardPhotoUrls[0] || photoLink);
    const photoDateHtml = photoDateLabel ? `<span class="photo-thumb-date app-inline-thumb-date" data-photo-taken-date="${esc(photoDateLabel)}">${esc(photoDateLabel)}</span>` : '';
    const hasCardPhotoEvidence = canonicalCardPhotoUrls.length > 0;
    const isChecked = selectedItems.has(item.DOM_ID) ? 'checked' : '';
    const isAvCatalogCard = sourceView === 'av' || sourceView === 'av-photo';
    const isDocksRequestCard = String(sourceView || '').trim().toLowerCase() === 'request' && (
        item.DOCK_SUSPEND_DC_REQUEST === true
        || String(firstNonEmptyValue(item.SOURCE_TABLE, item.source_table, '') || '').trim().toLowerCase() === 'ph_soc_master'
        || String(firstNonEmptyValue(item.REQUEST_SOURCE, item.request_source, '') || '').trim().toLowerCase() === 'docks'
    );
    const isSuspendTagRequestCard = String(sourceView || '').trim().toLowerCase() === 'request'
        && activeReqTab === 'suspend-tag'
        && (isDockSuspendDcRequestMirrorRow(item) || isDocksRequestCard);
    const skipLegacyInventoryChips = isAvCatalogCard || isSuspendTagRequestCard;
    const cardDesignChipsHtml = skipLegacyInventoryChips ? '' : buildInventoryCardFieldChipsHtml(item);

    const cardFieldChipsHtml = skipLegacyInventoryChips ? '' : `${buildInventoryQuantityChipsHtml(item)}${cardDesignChipsHtml}`;
    const compactCardFieldChipsHtml = skipLegacyInventoryChips ? '' : `${buildInventoryQuantityChipsHtml(item, { compact: true })}${buildInventoryCardFieldChipsHtml(item, { compact: true })}`;

    const safeUidJs = esc(item.UNIQUE_ID);
    const safeDockIssueSourceUidJs = esc(firstNonEmptyValue(item.DOCK_ISSUE_SOURCE_UID, item.UNIQUE_ID, item.unique_id, ''));
    const inventoryEditActionHtml = '';
    const holdReleaseOverrideActive = isHoldReleaseOverrideActiveForItem(item);
    return { safeCardSourceViewKey, thumbHtml, canonicalCardPhotoUrls, photoLink, photoDateHtml, hasCardPhotoEvidence, isChecked, isDocksRequestCard, isSuspendTagRequestCard, cardFieldChipsHtml, compactCardFieldChipsHtml, safeUidJs, safeDockIssueSourceUidJs, inventoryEditActionHtml, holdReleaseOverrideActive };
}
function createInventoryCardHoldContext(context) {
    let { holdReleaseOverrideActive, item, sourceView, isSuspendTagRequestCard, isDocksRequestCard } = context;
    const normalizeOptionalHoldValue = (value = '') => {
        const text = String(value === null || typeof value === 'undefined' ? '' : value).trim();
        const upper = text.toUpperCase();
        return (!text || upper === 'NULL' || upper === 'UNDEFINED' || upper === '-' || upper === '--' || upper === 'N/A' || upper === 'NA') ? '' : text;
    };
    const rawHoldCode = holdReleaseOverrideActive ? '' : firstNonEmptyValue(item.HOLDSTOPCODE, item.holdstopcode, item.HOLSTOPCODE, item.holstopcode, item.HOLD_STOP_CODE, item.HOLDSTOP);
    const cleanHoldCode = normalizeOptionalHoldValue(rawHoldCode).toUpperCase();
    const holdReasonText = holdReleaseOverrideActive ? '' : normalizeOptionalHoldValue(firstNonEmptyValue(item.HOLDSTOPREASON, item.holdstopreason, item.HOLD_STOP_REASON, item.hold_stop_reason, item.HOLDREASON, item.holdreason));
    const salesNoteText = firstNonEmptyValue(getItemDisplayValue(item, 'SALES_NOTE', sourceView), item.SALES_DESC, item.SALESDESC);
    const hasStopHold = cleanHoldCode.includes('S');
    const hasHold = !hasStopHold && cleanHoldCode.includes('H');
    const holdBorderClass = hasStopHold ? 'app-card-stop' : (hasHold ? 'app-card-hold' : 'app-card-ready');
    const holdCardToneClass = hasStopHold ? 'bg-red-50 border-red-200 text-red-800' : (hasHold ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-green-50 border-green-200 text-green-800');
    const holdLabelToneClass = hasStopHold ? 'text-red-600' : (hasHold ? 'text-yellow-700' : 'text-green-700');
    const isSeasonSalesNoteCard = isSeasonSalesNoteCardItem(item);
    const seasonCardShellClass = isSeasonSalesNoteCard ? 'app-smart-card--season' : '';
    const inventoryCardToneClass = isSeasonSalesNoteCard ? 'bg-orange-100 border-orange-600' : 'bg-white border-gray-200';
    const suspendTagPlanstartInfo = isSuspendTagRequestCard ? getDockSuspendDcRequestPlanstartInfo(item) : null;
    const suspendTagPlanstartToneClass = suspendTagPlanstartInfo ? suspendTagPlanstartInfo.className : '';
    const suspendTagLegacyPlanstartToneClass = suspendTagPlanstartInfo ? suspendTagPlanstartInfo.legacyClassName : '';
    const suspendTagPlanstartToneDataAttr = suspendTagPlanstartInfo ? ` data-planstart-value="${escJsAttrValue(suspendTagPlanstartInfo.value)}" data-planstart-tone="${escJsAttrValue(suspendTagPlanstartInfo.tone)}" data-planstart-valid="${suspendTagPlanstartInfo.valid ? 'true' : 'false'}"` : '';
    const requestCardToneClass = suspendTagPlanstartToneClass ? `${suspendTagPlanstartToneClass} ${suspendTagLegacyPlanstartToneClass}` : (isDocksRequestCard
        ? 'bg-red-50 border-red-300 ring-1 ring-red-200'
        : (isSeasonSalesNoteCard ? 'bg-orange-100 border-orange-600' : 'app-request-card-surface border-purple-200'));
    const requestBorderClass = suspendTagPlanstartToneClass ? '' : (isDocksRequestCard ? 'app-card-stop' : holdBorderClass);
    const salesOfficeCardToneClass = isSeasonSalesNoteCard ? 'bg-orange-100 border-orange-600' : 'bg-purple-50/40 border-purple-200';

    const salesOfficePanelToneClass = isSeasonSalesNoteCard ? 'border-orange-400' : 'border-purple-200';
    const salesOfficeAccentTextClass = isSeasonSalesNoteCard ? 'text-orange-900' : 'text-purple-700';
    const salesOfficeStatusClass = isSeasonSalesNoteCard ? 'status-orange' : 'status-purple';
    return { normalizeOptionalHoldValue, cleanHoldCode, holdReasonText, salesNoteText, holdBorderClass, holdCardToneClass, holdLabelToneClass, seasonCardShellClass, inventoryCardToneClass, suspendTagPlanstartToneDataAttr, requestCardToneClass, requestBorderClass, salesOfficeCardToneClass, salesOfficePanelToneClass, salesOfficeAccentTextClass, salesOfficeStatusClass };
}

function createInventoryCardNoteFormatters(context) {
    let { cleanHoldCode, holdCardToneClass, holdLabelToneClass, holdReasonText, salesNoteText } = context;
    const buildHoldReasonHtml = () => {
        if (!cleanHoldCode) return '';
        const holdTitle = cleanHoldCode ? `HOLD: ${cleanHoldCode}` : 'HOLD STATUS';
        return `<div class="app-card-note mt-2 ${holdCardToneClass} border rounded p-2 shadow-sm whitespace-pre-wrap"><div class="text-[10px] font-black ${holdLabelToneClass} uppercase tracking-wider mb-0.5">${holdTitle}</div>${holdReasonText ? `<div class="text-[12px] font-semibold leading-snug">${escapeQueueNoteText(holdReasonText)}</div>` : ''}</div>`;
    };

    const buildSalesNoteHtml = () => {
        if (!salesNoteText || String(salesNoteText).trim() === '') return '';
        return `<div class="app-card-note mt-2 text-[12px] text-sky-800 bg-sky-50 p-2 rounded border border-sky-200 shadow-sm whitespace-pre-wrap"><span class="font-black">SALES NOTE:</span> ${escapeQueueNoteText(salesNoteText)}</div>`;
    };
    return { buildHoldReasonHtml, buildSalesNoteHtml };
}

function createInventoryCardLayoutFormatters() {
    const formatCardPriceValue = (value) => {
        const raw = String(firstNonEmptyValue(value, '') || '').trim();
        if (!raw) return '-';
        const parsed = parseFloat(raw.replace(/[^0-9.-]/g, ''));
        if (!Number.isFinite(parsed)) return raw;
        return `$${parsed.toFixed(2)}`;
    };
    const parseCardPriceNumber = (value) => {
        const raw = String(firstNonEmptyValue(value, '') || '').trim();
        if (!raw) return null;
        const parsed = parseFloat(raw.replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    };
    const buildInventoryToplineHtml = (commonName = '', contSize = '', row = null) => {
        const commonText = String(firstNonEmptyValue(commonName, 'Unknown') || '').trim() || 'Unknown';
        const contSizeText = String(firstNonEmptyValue(contSize, '-') || '').trim() || '-';
        const tagColorHtml = buildInventoryCardTopTagColorHtml(row);
        return `<div class="app-card-topline"><span class="app-card-topline-common">${esc(commonText)}</span>${tagColorHtml}<span class="app-card-topline-size">${esc(contSizeText)}</span></div>`;
    };
    const buildInventorySecondarylineHtml = (locationCode = '', sourceValue = '', options = {}) => {
        const safeOptions = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
        const locationText = String(firstNonEmptyValue(locationCode, '') || '').trim();
        const sourceText = String(firstNonEmptyValue(sourceValue, '') || '').trim();
        const locationSuffixHtml = String(safeOptions.locationSuffixHtml || '').trim();
        const segments = [];
        if (locationText) segments.push(`<span class="app-card-subline-location">${esc(locationText)}</span>`);
        if (locationSuffixHtml) segments.push(locationSuffixHtml);
        if (sourceText) segments.push(`<span class="app-card-subline-source">${esc(sourceText)}</span>`);
        if (!segments.length) return '';
        return `<div class="app-card-subline">${segments.join('')}</div>`;
    };

    return { formatCardPriceValue, parseCardPriceNumber, buildInventoryToplineHtml, buildInventorySecondarylineHtml };
}

function createInventoryCardThumbnail(context) {
    let { photoLink, canonicalCardPhotoUrls, item, thumbHtml, photoDateHtml } = context;
    if (photoLink) {
        const cardPhotoUrls = canonicalCardPhotoUrls;
        const cleanUrl = cardPhotoUrls[0] || '';
        const thumbUrl = getDirectImageUrl(cleanUrl, 'card-feature');
        if (thumbUrl.startsWith('http')) {
            const safePhotoCsv = escJsAttrValue(cardPhotoUrls.join(','));
            const safePhotoCaption = escJsAttrValue(`${item.COMMONNAME || 'Inventory Item'} - ${item.CONTSIZE || '-'}`);
            const photoCountBadge = `<span class="app-av-photo-count" aria-hidden="true">1/${cardPhotoUrls.length}</span>`;
            thumbHtml = `<button type="button" data-fast-press-ignore class="app-inline-thumb-column" onclick="event.stopPropagation(); openPhotoModal('${safePhotoCsv}', '${safePhotoCaption}', 0); return false;"><div class="app-inline-thumb-box app-av-photo-carousel">${buildDeferredCardPhotoImg(thumbUrl, { className: 'active:scale-95 transition-transform', alt: `${item.COMMONNAME || 'Inventory Item'} photo 1 of ${cardPhotoUrls.length}` })}${photoCountBadge}</div>${photoDateHtml}</button>`;
        }
    }
    const inlineThumbHtml = thumbHtml || `<div class="app-inline-thumb-column app-inline-thumb-column--empty"><div class="app-inline-thumb-box app-inline-thumb-box--empty px-1 text-center text-[8px] font-black uppercase tracking-[0.12em]">No Photo</div></div>`;
    return { inlineThumbHtml };
}
function readInventoryPlantGroup(row) {
    const direct = String(firstNonEmptyValue(row.PLANTGROUPCODE, row.plantgroupcode,
        row.PLANT_GROUP_CODE, row.plant_group_code, row.PLANTGROUP, row.plantgroup, '') || '').trim().toUpperCase();
    if (direct && direct !== '—') return direct;
    if (!/^plant_?group(?:_?code)?$/i.test(String(row.key || row.name || row.label || ''))) return '';
    const field = String(row.value || '').trim().toUpperCase();
    return field === '—' ? '' : field;
}

function nestedInventoryPlantGroupRows(row) {
    return ['metadata', 'raw_row', 'details', 'detail', 'item_details', 'fields', 'data']
        .flatMap(key => row[key]).filter(value => value && typeof value === 'object');
}

function getInventoryPlantGroup(row) {
    const pending = [{ value: row, depth: 0 }];
    for (let i = 0; i < pending.length && i < 128; i++) {
        const { value, depth } = pending[i];
        if (!value || typeof value !== 'object') continue;
        const group = readInventoryPlantGroup(value);
        if (group) return group;
        if (depth < 3) pending.push(...nestedInventoryPlantGroupRows(value).map(child => ({ value: child, depth: depth + 1 })));
    }
    return '';
}
