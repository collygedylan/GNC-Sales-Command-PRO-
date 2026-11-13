export function renderInventoryCardAvHero(context) {
    const { hasValidAvPhotos, validAvPhotoUrls, resolvedAvPhotoLink, item, photoCaption } = context;
    if (!hasValidAvPhotos) {
        return '<div class="app-av-hero"><div class="app-av-hero-empty"><span class="app-av-catalog-photo-status"><i class="ph-bold ph-leaf" aria-hidden="true"></i>No photo yet</span></div></div>';
    }
    const photoCount = validAvPhotoUrls.length;
    const name = item.COMMONNAME || 'AV Item';
    const safePhotoCsv = escJsAttrValue(resolvedAvPhotoLink);
    const src = normalizeStoragePublicUrl(getDirectImageUrl(validAvPhotoUrls[0], 'card-feature'));
    const fallback = normalizeStoragePublicUrl(validAvPhotoUrls[0]);
    const fallbackAttr = fallback && fallback !== src ? ` data-av-photo-fallback="${escapeHtml(fallback)}"` : '';
    const label = escapeHtml(`View ${photoCount} photo${photoCount === 1 ? '' : 's'} of ${name}`);
    const previewHtml = `<button type="button" class="app-av-photo-slide" data-fast-press-ignore data-av-photo-index="0" aria-label="${label}" onclick="event.stopPropagation(); openPhotoModal('${safePhotoCsv}', '${photoCaption}', 0); return false;">
        <img src="${escapeHtml(src)}"${fallbackAttr} loading="lazy" decoding="async" alt="${escapeHtml(`${name} photo 1 of ${photoCount}`)}" onerror="handleAvCardPhotoError(this)">
        <span class="app-av-catalog-photo-status" hidden>Photo unavailable</span>
    </button>`;
    return `<div class="app-av-hero"><div class="app-av-photo-carousel" data-fast-press-ignore><div class="app-av-photo-track">${previewHtml}</div><span class="app-av-photo-count" aria-hidden="true">1/${photoCount}</span></div></div>`;
}

export function handleAvCardPhotoError(image) {
    const fallback = image.dataset.avPhotoFallback;
    if (fallback) {
        delete image.dataset.avPhotoFallback;
        image.src = fallback;
        return;
    }
    image.hidden = true;
    image.nextElementSibling.hidden = false;
}

export function createAvInventoryCardModel(context) {
    let { sourceView, parseCardPriceNumber, item, formatCardPriceValue, canonicalCardPhotoUrls, holdReleaseOverrideActive, normalizeOptionalHoldValue } = context;
    const kiosk = ['av', 'av-photo'].includes(sourceView) && window.__agdataAvKioskState?.active === true;
    const listPriceNumber = parseCardPriceNumber(firstNonEmptyValue(item.LISTPRICE, item.LISTPRI, ''));
    const listPriceText = listPriceNumber === null ? formatCardPriceValue(firstNonEmptyValue(item.LISTPRICE, item.LISTPRI, '')) : `$${listPriceNumber.toFixed(2)}`;
    const liveEvidenceRow = getLiveDriveNoteRow(item) || item;
    const avNoteText = String(firstNonEmptyValue(liveEvidenceRow.AV_NOTE, liveEvidenceRow.av_note, item.AV_NOTE, item.av_note, '') || '').trim();
    const validAvPhotoUrls = canonicalCardPhotoUrls.length ? canonicalCardPhotoUrls : resolveCanonicalPhotoUrls(item, 'drive');
    const resolvedAvPhotoLink = validAvPhotoUrls.join(',');
    const hasValidAvPhotos = validAvPhotoUrls.length > 0;
    const pickNoteText = hasValidAvPhotos ? getCorrectedPickNoteValue(item, firstNonEmptyValue(getItemDisplayValue(item, 'PICK', sourceView), item.PIC_NOTE, item.PICK, item.PICKNOTE, item.REQ_PICK, item.REQ_PIC_NOTE, item.FLYER_PICK, ''), { includeStandard: true }) : '';
    const holdReasonValue = holdReleaseOverrideActive ? '' : normalizeOptionalHoldValue(firstNonEmptyValue(item.HOLDSTOPREASON, item.holdstopreason, item.HOLD_STOP_REASON, item.hold_stop_reason, item.HOLDREASON, item.holdreason, ''));
    const activePriceText = listPriceText;
    const priceLabel = 'List price';
    const photoCaption = escJsAttrValue(`${item.COMMONNAME || 'AV Item'} - ${item.CONTSIZE || '-'}`);
    const heroHtml = renderInventoryCardAvHero({ ...context, hasValidAvPhotos, validAvPhotoUrls, resolvedAvPhotoLink, photoCaption });
    return { kiosk, liveEvidenceRow, avNoteText, validAvPhotoUrls, resolvedAvPhotoLink, hasValidAvPhotos, pickNoteText, holdReasonValue, activePriceText, priceLabel, photoCaption, heroHtml };
}

function buildAvCardSelection(context, commonNameText) {
    const { item, isChecked, safeCardSourceViewKey } = context;
    return `<div class="card-checkbox-container flex-shrink-0 mt-1"><input type="checkbox" aria-label="Select ${escapeHtml(commonNameText)}" class="card-checkbox w-6 h-6 rounded border-gray-300 text-teal-600 focus:ring-teal-600 shadow-sm" ${isChecked} onclick="event.stopPropagation(); toggleGlobalItem('${escJsAttrValue(item.DOM_ID)}', this.checked, '${safeCardSourceViewKey}')"></div>`;
}

function buildAvCardActions(context) {
    const { item, kiosk, sourceView, safeCardSourceViewKey } = context;
    const domIdText = String(firstNonEmptyValue(item.DOM_ID, '') || '').trim();
    if (kiosk || !domIdText) return '';
    const safeDomId = escJsAttrValue(domIdText);
    const inBloomPicker = selectedItems.has(domIdText);
    const bloomButtonHtml = `<button type="button" class="app-av-primary-action ${inBloomPicker ? 'is-selected' : ''}" data-cart-dom-id="${escapeHtml(domIdText)}" aria-pressed="${inBloomPicker ? 'true' : 'false'}" onclick="return handleInventoryCardBottomCartAction(event, '${safeDomId}', '${safeCardSourceViewKey}')"><i class="ph-bold ${inBloomPicker ? 'ph-check-circle' : 'ph-handbag'}"></i><span>${inBloomPicker ? 'In Bloom Picker' : 'Add To Bloom Picker'}</span></button>`;
    const projectButtonHtml = !['av', 'av-photo'].includes(String(sourceView || '').trim().toLowerCase())
        ? `<button type="button" class="app-av-secondary-action" onclick="event.stopPropagation(); return addInventoryRowToProject('${safeDomId}')"><i class="ph-bold ph-folder-plus"></i><span>+ Project</span></button>` : '';
    return `<div class="app-av-catalog-bloom-row">${bloomButtonHtml}${projectButtonHtml}</div>`;
}

function renderAvCardHeading(context, commonNameText) {
    const { item, kiosk, activePriceText, priceLabel } = context;
    const itemCodeText = String(firstNonEmptyValue(item.ITEMCODE, '-') || '-').trim() || '-';
    const locationCodeText = firstNonEmptyValue(item.LOCATIONCODE, item.locationcode, item.LOCATION_CODE, item.location_code, '—');
    const contSizeText = String(firstNonEmptyValue(item.CONTSIZE, '-') || '-').trim() || '-';
    const lotText = firstNonEmptyValue(item.LOTCODE, item.lotcode, item.SEASON, item.season, '—');
    const priceHtml = !isEvalSensitiveDataRestricted() && activePriceText && activePriceText !== '-'
        ? `<div class="app-av-catalog-price"><span class="app-av-catalog-price-label">${escapeHtml(priceLabel)}</span><span class="app-av-catalog-price-value">${escapeHtml(activePriceText)}</span></div>`
        : '';
    const priorityHtml = `<span class="app-av-priority-badge">PRI ${escapeHtml(firstNonEmptyValue(item.PRIORITY, item.priority, '—'))}</span>`;
    const metaHtml = kiosk ? '' : `<div class="app-av-catalog-meta"><span>Location ${escapeHtml(locationCodeText)} · ${escapeHtml(lotText)} <span class="app-av-internal-priority">· ${priorityHtml}</span></span></div>`;
    return `<div class="app-av-catalog-heading"><div class="app-av-catalog-identity"><div class="app-av-catalog-title-row"><h3 class="app-av-catalog-title">${escapeHtml(commonNameText)}<span class="app-av-catalog-size">${escapeHtml(contSizeText)}</span></h3>${priceHtml}</div><div class="app-av-catalog-code">${escapeHtml(itemCodeText)}</div>${metaHtml}</div></div>`;
}

function renderAvCardQuantities(context) {
    const { item, sourceView, kiosk } = context;
    if (kiosk) return '';
    const chips = buildInventoryQuantityChipsHtml(item, { layout: 'row', compact: true, locationMetricItem: item, sourceView,
        preserveUnknown: true, missingValue: 'N/A', knownLocationPhotoMatch: getCanonicalCardMatchDisplay(item, sourceView) });
    const seasonOhHtml = rowSourceContainsHl(item)
        ? `<div class="app-av-catalog-season-oh"><span>Season OH</span><strong>${escapeHtml(getCardSeasonOhValue(item))}</strong></div>` : '';
    return `<div class="app-av-catalog-highlight">${chips}${seasonOhHtml}</div>`;
}

function renderAvCardNote(label, value) {
    return value ? `<section class="app-av-catalog-note"><span class="app-av-catalog-note-label">${label}</span><div class="app-av-catalog-note-text">${escapeHtml(value)}</div></section>` : '';
}

function renderAvCardHold(context) {
    const { item, kiosk, holdReleaseOverrideActive, cleanHoldCode, holdReasonValue } = context;
    if (kiosk) return '';
    const holdBeginDateValue = holdReleaseOverrideActive ? '' : formatInventoryHoldSince(getHoldStopBeginDateValueFromItem(item));
    return cleanHoldCode || holdReasonValue || holdBeginDateValue
        ? `<section class="app-av-catalog-note app-av-catalog-note--hold app-av-catalog-hold-data app-inventory-card-hold-data"><span data-inventory-card-field="holdstopcode"><b>Code</b><strong>${cleanHoldCode ? escapeHtml(cleanHoldCode) : '—'}</strong></span><span data-inventory-card-field="holdstopreason"><b>Reason</b><strong>${holdReasonValue ? escapeHtml(holdReasonValue) : '—'}</strong></span><span data-inventory-card-field="holdstopbegindate"><b>Since</b><strong>${holdBeginDateValue ? escapeHtml(holdBeginDateValue) : '—'}</strong></span></section>`
        : '';
}

export function renderAvInventoryCardMarkup(context) {
    const { item, kiosk, sourceView, liveEvidenceRow, avNoteText, pickNoteText, hasValidAvPhotos, holdBorderClass, heroHtml, photoDateHtml } = context;
    const commonNameText = String(firstNonEmptyValue(item.COMMONNAME, 'Unknown') || 'Unknown').trim() || 'Unknown';
    const cardActivationAttrs = kiosk ? buildAvCardPhotoActivationAttrs(hasValidAvPhotos)
        : buildAuthorizedAvCardActivationAttrs(item, sourceView, hasValidAvPhotos);
    const contextMenu = kiosk ? '' : `oncontextmenu="return handleCardContextMenu(event, '${escJsAttrValue(item.DOM_ID)}')"`;
    const specText = String(firstNonEmptyValue(liveEvidenceRow.SPEC, liveEvidenceRow.spec, item.SPEC, item.spec, item.SPECIFICATION, item.AV_SPEC, item.SPECS, '') || '').trim();
    const caliperText = String(firstNonEmptyValue(item.CALIPER, item.caliper, item.AV_CALIPER, '') || '').trim();
    const avNoteDisplay = avNoteText || String(firstNonEmptyValue(item.AVNOTE, item.AV_NOTES, '') || '').trim();
    return `<div class="flex items-start w-full mb-3 item-row app-smart-card app-smart-card--inventory app-smart-card--av app-av-catalog-card app-inventory-card-overhaul ${hasValidAvPhotos ? '' : 'app-av-catalog-card--no-photo'} relative rounded-xl border shadow-sm ${cardActivationAttrs ? 'cursor-pointer' : ''} overflow-hidden ${kiosk ? '' : holdBorderClass}" data-dom-id="${escapeHtml(item.DOM_ID)}" ${contextMenu} ${cardActivationAttrs}>
        ${kiosk ? '' : buildAvCardSelection(context, commonNameText)}
        <div class="app-av-catalog-frame">
            ${renderAvCardHeading(context, commonNameText)}
            <div class="app-av-catalog-media app-inline-thumb-column"><div class="app-av-catalog-photo-wrap">${heroHtml}</div>${photoDateHtml}</div>
            <div class="app-av-catalog-info">${renderAvCardQuantities(context)}${renderAvCardNote('Spec', specText)}${renderAvCardNote('Caliper', caliperText)}${renderAvCardNote('AV Note', avNoteDisplay)}${kiosk ? '' : renderAvCardNote('Pick note', pickNoteText)}${buildAvCardActions(context)}${renderAvCardHold(context)}</div>
        </div>
    </div>`;
}

export function renderAvInventoryCard(context) {
    return renderAvInventoryCardMarkup({ ...context, ...createAvInventoryCardModel(context) });
}
