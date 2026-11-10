function renderInventoryCardAvHero(context) {
    let { hasValidAvPhotos, validAvPhotoUrls, resolvedAvPhotoLink, renderMeta, sourceView, item, photoCaption } = context;
    let heroHtml = '<div class="app-av-hero"><div class="app-av-hero-empty"><span class="app-av-catalog-photo-status"><i class="ph-bold ph-leaf" aria-hidden="true"></i>No photo yet</span></div></div>';
    if (hasValidAvPhotos) {
        const photoCount = validAvPhotoUrls.length;
        const safePhotoCsv = escJsAttrValue(resolvedAvPhotoLink);
        const rowIndex = Number(renderMeta && renderMeta.rowIndex);
        const hasKnownRowIndex = Number.isFinite(rowIndex);
        const isAvPhotoFeed = sourceView === 'av-photo'
            || (typeof getIsAvPhotoSubview === 'function' && getIsAvPhotoSubview());
        const eagerHeroRowLimit = isTouchConstrainedDevice() ? 24 : 72;
        const hydrateAheadRowLimit = isTouchConstrainedDevice() ? 120 : 240;
        const imgHtml = buildDeferredCardPhotoImg(getDirectImageUrl(validAvPhotoUrls[0], 'card-feature'), {
            fetchPriority: isAvPhotoFeed && (!hasKnownRowIndex || rowIndex < eagerHeroRowLimit) ? 'high' : 'low',
            loading: isAvPhotoFeed && (!hasKnownRowIndex || rowIndex < eagerHeroRowLimit) ? 'eager' : 'lazy',
            hydrateNow: !hasKnownRowIndex || rowIndex < hydrateAheadRowLimit,
            avLoadStatus: true,
            alt: `${item.COMMONNAME || 'AV Item'} photo 1 of ${photoCount}`
        });
        const photoStatusHtml = '<span class="app-av-catalog-photo-status app-av-catalog-photo-loading" role="status">Loading…</span><span class="app-av-catalog-photo-status app-av-catalog-photo-error">Photo unavailable</span>';
        const label = escapeHtml(`View ${photoCount} photo${photoCount === 1 ? '' : 's'} of ${item.COMMONNAME || 'AV Item'}`);
        const previewHtml = `<button type="button" class="app-av-photo-slide" data-fast-press-ignore data-av-photo-index="0" aria-label="${label}" onclick="event.stopPropagation(); openPhotoModal('${safePhotoCsv}', '${photoCaption}', 0); return false;">${imgHtml}${photoStatusHtml}</button>`;
        heroHtml = `<div class="app-av-hero"><div class="app-av-photo-carousel" data-fast-press-ignore><div class="app-av-photo-track">${previewHtml}</div><span class="app-av-photo-count" aria-hidden="true">1/${photoCount}</span></div></div>`;
    }
    return heroHtml;
}

function createAvInventoryCardModel(context) {
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

function renderAvInventoryCardMarkup(context) {
    let { item, avNoteText, liveEvidenceRow, safeCardSourceViewKey, sourceView, activePriceText, priceLabel, kiosk, holdReleaseOverrideActive, cleanHoldCode, holdReasonValue, hasValidAvPhotos, holdBorderClass, isChecked, heroHtml, photoDateHtml, pickNoteText } = context;
    const cardActivationAttrs = isAvDetailSource(sourceView)
        ? buildAvCardPhotoActivationAttrs(hasValidAvPhotos)
        : buildCardActivationAttrs(item.DOM_ID, item.UNIQUE_ID, sourceView === 'reserves_drill' ? 'av' : sourceView, 'Open Item Detail');
    const buildAvMediaHtml = (imgHtml, photoDateHtml, photoStatusHtml = '') =>
        `<div class="app-av-catalog-media app-inline-thumb-column">${imgHtml}${photoDateHtml}${photoStatusHtml}</div>`;
    const domIdText = String(firstNonEmptyValue(item.DOM_ID, '') || '').trim();
    const itemCodeText = String(firstNonEmptyValue(item.ITEMCODE, '-') || '-').trim() || '-';
    const locationCodeText = String(firstNonEmptyValue(item.LOCATIONCODE, item.locationcode, item.LOCATION_CODE, item.location_code, '-') || '-').trim() || '-';
    const contSizeText = String(firstNonEmptyValue(item.CONTSIZE, '-') || '-').trim() || '-';
    const commonNameText = String(firstNonEmptyValue(item.COMMONNAME, 'Unknown') || 'Unknown').trim() || 'Unknown';
    const avNoteDisplay = avNoteText || String(firstNonEmptyValue(item.AVNOTE, item.AV_NOTES, '') || '').trim();
    const specText = String(firstNonEmptyValue(liveEvidenceRow.SPEC, liveEvidenceRow.spec, item.SPEC, item.spec, item.SPECIFICATION, item.AV_SPEC, item.SPECS, '') || '').trim();
    const caliperText = String(firstNonEmptyValue(item.CALIPER, item.caliper, item.AV_CALIPER, '') || '').trim();
    const showSeasonOh = rowSourceContainsHl(item);
    const seasonOhText = showSeasonOh ? getCardSeasonOhValue(item) : '';
    const seasonText = String(firstNonEmptyValue(item.SEASON, item.season, '-') || '-').trim() || '-';
    const safeDomId = escJsAttrValue(domIdText);
    const inBloomPicker = domIdText && selectedItems.has(domIdText);
    const bloomButtonHtml = domIdText
        ? `<button type="button" class="app-av-primary-action ${inBloomPicker ? 'is-selected' : ''}" data-cart-dom-id="${escapeHtml(domIdText)}" aria-pressed="${inBloomPicker ? 'true' : 'false'}" onclick="return handleInventoryCardBottomCartAction(event, '${safeDomId}', '${safeCardSourceViewKey}')"><i class="ph-bold ${inBloomPicker ? 'ph-check-circle' : 'ph-handbag'}"></i><span>${inBloomPicker ? 'In Bloom Picker' : 'Add To Bloom Picker'}</span></button>`
        : '';
    const projectButtonHtml = domIdText && !['av', 'av-photo'].includes(String(sourceView || '').trim().toLowerCase()) ? `<button type="button" class="app-av-secondary-action" onclick="event.stopPropagation(); return addInventoryRowToProject('${safeDomId}')"><i class="ph-bold ph-folder-plus"></i><span>+ Project</span></button>` : '';
    const priceHtml = !isEvalSensitiveDataRestricted() && activePriceText && activePriceText !== '-'
        ? `<div class="app-av-catalog-price"><span class="app-av-catalog-price-label">${escapeHtml(priceLabel)}</span><span class="app-av-catalog-price-value">${escapeHtml(activePriceText)}</span></div>`
        : '';
    const avQuantityRowHtml = kiosk ? '' : buildInventoryQuantityChipsHtml(item, { layout: 'row', compact: true, locationMetricItem: item, sourceView, preserveUnknown: true, missingValue: 'N/A' });
    const seasonOhHtml = !kiosk && showSeasonOh ? `<div class="app-av-catalog-season-oh"><span>Season OH</span><strong>${escapeHtml(seasonOhText)}</strong></div>` : '';
    const priorityHtml = `<span class="app-av-priority-badge">PRI ${escapeHtml(firstNonEmptyValue(item.PRIORITY, item.priority, '—'))}</span>`;
    const avSpecHtml = specText
        ? `<section class="app-av-catalog-note"><span class="app-av-catalog-note-label">Spec</span><div class="app-av-catalog-note-text">${escapeHtml(specText)}</div></section>`
        : '';
    const avCaliperHtml = caliperText
        ? `<section class="app-av-catalog-note"><span class="app-av-catalog-note-label">Caliper</span><div class="app-av-catalog-note-text">${escapeHtml(caliperText)}</div></section>`
        : '';
    const avNoteCatalogHtml = avNoteDisplay
        ? `<section class="app-av-catalog-note"><span class="app-av-catalog-note-label">AV Note</span><div class="app-av-catalog-note-text">${escapeHtml(avNoteDisplay)}</div></section>`
        : '';
    const holdBeginDateValue = holdReleaseOverrideActive ? '' : formatInventoryHoldSince(getHoldStopBeginDateValueFromItem(item));
    const holdReasonCatalogHtml = cleanHoldCode || holdReasonValue || holdBeginDateValue
        ? `<section class="app-av-catalog-note app-av-catalog-note--hold app-av-catalog-hold-data app-inventory-card-hold-data"><span data-inventory-card-field="holdstopcode"><b>Code</b><strong>${cleanHoldCode ? escapeHtml(cleanHoldCode) : '—'}</strong></span><span data-inventory-card-field="holdstopreason"><b>Reason</b><strong>${holdReasonValue ? escapeHtml(holdReasonValue) : '—'}</strong></span><span data-inventory-card-field="holdstopbegindate"><b>Since</b><strong>${holdBeginDateValue ? escapeHtml(holdBeginDateValue) : '—'}</strong></span></section>`
        : '';
    return `<div class="flex items-start w-full mb-3 item-row app-smart-card app-smart-card--inventory app-smart-card--av app-av-catalog-card app-inventory-card-overhaul ${hasValidAvPhotos ? '' : 'app-av-catalog-card--no-photo'} relative rounded-xl border shadow-sm ${cardActivationAttrs ? 'cursor-pointer' : ''} overflow-hidden ${holdBorderClass}" data-dom-id="${escapeHtml(item.DOM_ID)}" oncontextmenu="return handleCardContextMenu(event, '${escJsAttrValue(item.DOM_ID)}')" ${cardActivationAttrs}>
        <div class="card-checkbox-container flex-shrink-0 mt-1"><input type="checkbox" aria-label="Select ${escapeHtml(commonNameText)}" class="card-checkbox w-6 h-6 rounded border-gray-300 text-teal-600 focus:ring-teal-600 shadow-sm" ${isChecked} onclick="event.stopPropagation(); toggleGlobalItem('${safeDomId}', this.checked, '${safeCardSourceViewKey}')"></div>
        <div class="app-av-catalog-frame">
            <div class="app-av-catalog-heading"><div class="app-av-catalog-identity"><div class="app-av-catalog-title-row"><h3 class="app-av-catalog-title">${escapeHtml(commonNameText)}<span class="app-av-catalog-size">${escapeHtml(contSizeText)}</span></h3>${priceHtml}</div><div class="app-av-catalog-code">${escapeHtml(itemCodeText)}</div>${kiosk ? '' : `<div class="app-av-catalog-meta"><span>Location ${escapeHtml(locationCodeText)} · ${escapeHtml(firstNonEmptyValue(item.LOTCODE, item.lotcode, seasonText))} <span class="app-av-internal-priority">· ${priorityHtml}</span></span></div>`}</div></div>
            ${buildAvMediaHtml(`<div class="app-av-catalog-photo-wrap">${heroHtml}</div>`, photoDateHtml)}
            <div class="app-av-catalog-info">${kiosk ? '' : `<div class="app-av-catalog-highlight">${avQuantityRowHtml}${seasonOhHtml}</div>`}${avSpecHtml}${avCaliperHtml}${avNoteCatalogHtml}${pickNoteText ? `<section class="app-av-catalog-note"><span class="app-av-catalog-note-label">Pick note</span><div class="app-av-catalog-note-text">${escapeHtml(pickNoteText)}</div></section>` : ''}${bloomButtonHtml ? `<div class="app-av-catalog-bloom-row">${bloomButtonHtml}${projectButtonHtml}</div>` : ''}${holdReasonCatalogHtml}</div>
        </div>
    </div>`;
}

function renderAvInventoryCard(context) {
    return renderAvInventoryCardMarkup({ ...context, ...createAvInventoryCardModel(context) });
}
