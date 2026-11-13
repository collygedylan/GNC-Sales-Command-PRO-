function renderSalesOfficeOrderInventoryCard(context) {
    let { item, buildHoldReasonHtml, inlineThumbHtml, holdBorderClass, renderMeta, sourceView, isChecked, safeCardSourceViewKey, compactCardFieldChipsHtml, inventoryEditActionHtml, safeUidJs } = context;
    const orderQty = firstNonEmptyValue(item.ORDER_QTY, item.REQ_QTY, '0');
    const orderStatus = firstNonEmptyValue(item.ORDER_STATUS, 'Pending Review');
    const orderReserve = firstNonEmptyValue(item.ORDER_RESERVE, 'NO');
    const desiredSpec = firstNonEmptyValue(item.ORDER_DESIRED_SPEC, item.SPEC, '');
    const desiredCaliper = firstNonEmptyValue(item.ORDER_DESIRED_CALIPER, item.CALIPER, '');
    const submittedAt = formatSalesOfficeDate(firstNonEmptyValue(item.ORDER_SUBMITTED_AT, item.COMPLETED_AT, ''));
    const holdHtml = buildHoldReasonHtml();
    const avNoteHtml = item.AV_NOTE && String(item.AV_NOTE).trim() !== '' ? `<div class="mt-2 rounded border border-blue-200 bg-blue-50 p-2 text-[12px] font-semibold text-blue-800 whitespace-pre-wrap"><span class="font-black">AV NOTE:</span> ${item.AV_NOTE}</div>` : '';
    const pickNoteText = getCorrectedPickNoteValue(item, firstNonEmptyValue(item.PIC_NOTE, item.PICK, item.REQ_PICK, item.REQ_PIC_NOTE, item.FLYER_PICK, ''), { includeStandard: true });
    const pickNoteHtml = pickNoteText ? `<div class="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-[12px] font-semibold text-emerald-800 whitespace-pre-wrap"><span class="font-black">PICK NOTE:</span> ${escapeQueueNoteText(pickNoteText)}</div>` : '';
    const orderDetailBits = [
        desiredSpec ? `<span class="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">Spec: ${desiredSpec}</span>` : '',
        desiredCaliper ? `<span class="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">Cal: ${desiredCaliper}</span>` : '',
        `<span class="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">Reserve: ${orderReserve}</span>`
    ].filter(Boolean).join('');
    const statusTone = String(orderStatus || '').toLowerCase().includes('done') ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-100';
    const specialStageBadgeHtml = getSalesOfficeOrderSpecialStageBadgeHtml(item);
    const orderRightColumnHtml = specialStageBadgeHtml ? `<div class="flex flex-col items-end gap-2">${specialStageBadgeHtml}${inlineThumbHtml}</div>` : inlineThumbHtml;
    return `<div class="flex items-center w-full mb-3 item-row app-smart-card relative bg-white p-4 rounded-xl border border-emerald-200 shadow-sm active:scale-[0.99] transition-transform cursor-pointer overflow-hidden ${holdBorderClass}" data-dom-id="${item.DOM_ID}" oncontextmenu="return handleCardContextMenu(event, '${item.DOM_ID}')" ${buildCardActivationAttrs(item.DOM_ID, item.UNIQUE_ID, renderMeta.originView || sourceView, 'Open Bloom Picker row')}><div class="card-checkbox-container flex-shrink-0"><input type="checkbox" class="card-checkbox w-6 h-6 rounded border-gray-300 text-[#007a4d] focus:ring-[#007a4d] shadow-sm" ${isChecked} onclick="event.stopPropagation(); toggleGlobalItem('${item.DOM_ID}', this.checked, '${safeCardSourceViewKey}')"></div><div class="flex flex-col w-full min-w-0"><div class="flex justify-between items-start w-full"><div class="app-card-main flex-grow min-w-0 pr-2"><div class="app-card-eyebrow text-[10px] font-black uppercase tracking-[0.16em] text-[#007a4d] mb-1">Bloom Picker</div><div class="app-card-title font-black text-gray-800 text-[16px] leading-tight break-words mb-1">${item.COMMONNAME || 'Unknown'}</div><div class="app-card-subtitle font-bold text-[#007a4d] text-sm mb-2">${item.CONTSIZE || '-'}</div><div class="app-card-chip-row flex flex-wrap gap-x-2 gap-y-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-600"><span class="bg-emerald-50 text-emerald-700 px-2 py-1 rounded border border-emerald-200">Qty ${orderQty}</span><span class="bg-white text-slate-600 px-2 py-1 rounded border border-slate-200">Order ${item.ORDER_NUMBER || '-'}</span><span class="bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-100">Loc ${item.LOCATIONCODE || '-'}</span><span class="bg-gray-100 text-gray-700 px-2 py-1 rounded border border-gray-200">Lot ${item.LOTCODE || '-'}</span><span class="px-2 py-1 rounded border ${statusTone}">${orderStatus}</span>${compactCardFieldChipsHtml}</div>${orderDetailBits ? `<div class="mt-2 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-600">${orderDetailBits}</div>` : ''}<div class="mt-2 text-[11px] font-semibold text-slate-500">Submitted ${submittedAt}</div>${pickNoteHtml}${holdHtml}${avNoteHtml}${inventoryEditActionHtml}</div>${orderRightColumnHtml}</div><div class="flex gap-2 mt-3"><button class="flex-1 bg-[#007a4d] hover:bg-green-700 text-white text-[10px] font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md active:scale-95" onclick="event.stopPropagation(); return markSalesOfficeComplete('${safeUidJs}', '${escJsAttrValue(item.DOM_ID)}', this)"><i class="ph-bold ph-check-circle text-lg"></i>DONE</button></div></div></div>`;
}
function renderSalesOfficeInventoryCard(context) {
    let { item, salesNoteText, safeUidJs, hasCardPhotoEvidence, inlineThumbHtml, renderMeta, sourceView, isChecked, safeCardSourceViewKey, compactCardFieldChipsHtml, inventoryEditActionHtml, seasonCardShellClass, salesOfficeStatusClass, salesOfficeCardToneClass, salesOfficeAccentTextClass, salesOfficePanelToneClass } = context;
    let avNoteText = getSalesOfficeDisplayAvNote(item, 'No AV Note Provided');
    let displaySalesNote = String(stripWorkflowApprovalLinesFromSalesNote(firstNonEmptyValue(item.SALES_NOTE, salesNoteText, '')) || 'No Sales Note');
    let itemCode = item.ITEMCODE || '-';

    let lotCode = item.LOTCODE || '-';
    let safeAvNote = escJsAttrValue(avNoteText);
    let safeItemCode = escJsAttrValue(itemCode);
    let safeDomId = escJsAttrValue(item.DOM_ID);
    const salesOfficeSource = String(firstNonEmptyValue(item.SO_SOURCE, item.so_source, '') || '').toLowerCase().trim();
    const stagingStatus = String(firstNonEmptyValue(item.WORKFLOW_STATUS, item.workflow_status, 'needs_photo_data') || 'needs_photo_data').trim().toLowerCase();
    const stagingStatusConfig = stagingStatus === 'ready_for_custom_av'
        ? { label: 'Ready for Custom AV', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
        : stagingStatus === 'reopened_cav_blank'
            ? { label: 'Reopened — CAV Blank', tone: 'border-amber-200 bg-amber-50 text-amber-700' }
            : stagingStatus === 'reopened_evidence_invalid'
                ? { label: 'Reopened — Evidence Invalid', tone: 'border-red-200 bg-red-50 text-red-700' }
                : { label: 'Needs Photo/Data', tone: 'border-blue-200 bg-blue-50 text-blue-700' };
    const stagingStatusBadgeHtml = salesOfficeSource === 'season'
        ? `<div class="mb-3 inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${stagingStatusConfig.tone}">${esc(stagingStatusConfig.label)}</div>`
        : '';
    const seasonArrivedAt = salesOfficeSource === 'season'
        ? formatSalesOfficeArrivedAt(firstNonEmptyValue(item.ARRIVED_AT, item.arrived_at, ''))
        : '';
    const seasonArrivedAtHtml = seasonArrivedAt
        ? `<div class="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600"><i class="ph-bold ph-clock text-base text-[#007a4d]"></i><span>Added to Sales Office ${esc(seasonArrivedAt)}</span></div>`
        : '';
    const isSeasonSalesNote = isSeasonSalesOfficeItem(item);
    const seasonSalesEntryAllowed = !isSeasonSalesNote || isAvBlanksPhotoBypassUserAllowed();
    const salesOfficeDoneHandler = isSeasonSalesNote ? 'markSeasonSalesOfficeComplete' : 'markSalesOfficeComplete';
    let seasonSalesEntryActionsHtml = seasonSalesEntryAllowed
        ? `<div class="grid grid-cols-3 gap-2 mt-3"><button class="min-h-[44px] bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[9px] sm:text-[10px] font-black py-2 rounded-lg transition-colors flex items-center justify-center gap-1 active:bg-indigo-200 uppercase tracking-[0.08em]" onclick="event.stopPropagation(); return copyTextToClipboard('${safeItemCode}', 'ITEM CODE')"><i class="ph-bold ph-barcode text-base"></i> Itemcode</button><button class="min-h-[44px] bg-purple-50 border border-purple-200 hover:bg-purple-100 text-purple-700 text-[9px] sm:text-[10px] font-black py-2 rounded-lg transition-colors flex items-center justify-center gap-1 active:bg-purple-200 uppercase tracking-[0.08em]" onclick="event.stopPropagation(); return copyTextToClipboard('${safeAvNote}', 'AV NOTE')"><i class="ph-bold ph-chat-text text-base"></i> AV Note</button><button class="min-h-[44px] bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-700 text-[9px] sm:text-[10px] font-black py-2 rounded-lg transition-colors flex items-center justify-center gap-1 active:bg-blue-200 uppercase tracking-[0.08em]" onclick="event.stopPropagation(); openSalesOfficeAvNoteModal('${safeUidJs}'); return false;"><i class="ph-bold ph-pencil-simple-line text-base"></i> Edit</button></div><button class="mt-2 w-full min-h-[48px] bg-[#007a4d] hover:bg-green-700 text-white text-[10px] font-black py-3 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md active:scale-95 uppercase tracking-[0.14em]" onclick="event.stopPropagation(); return ${salesOfficeDoneHandler}('${safeUidJs}', '${safeDomId}', this)"><i class="ph-bold ph-check-circle text-lg"></i> Done</button>`
        : `<div class="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500"><i class="ph-bold ph-lock-key mr-1 text-base align-middle"></i> Read only — not assigned for Season Sales Note entry</div>`;
    const salesOfficeCardPhotoHtml = hasCardPhotoEvidence ? `<div class="mt-3 flex justify-end">${inlineThumbHtml}</div>` : '';
    seasonSalesEntryActionsHtml = `${salesOfficeCardPhotoHtml}${seasonSalesEntryActionsHtml}`;
    if (salesOfficeSource === 'moves' || salesOfficeSource === 'move') {
        const actualMoved = String(firstNonEmptyValue(item.MOVE_ACTUAL_MOVED, item.ORDER_QTY, '0') || '0').trim() || '0';
        const taQty = String(firstNonEmptyValue(item.MOVE_TA_QTY, item.ORDER_RESERVE, '0') || '0').trim() || '0';
        const moveFrom = String(firstNonEmptyValue(item.MOVE_FROM_LOCATION, item.LOCATIONCODE, '-') || '-').trim() || '-';
        const moveTo = String(firstNonEmptyValue(item.MOVE_TO_LOCATION, item.SPEC, '') || '').replace(/^Move To:\s*/i, '').trim() || '-';
        const moveBlock = String(firstNonEmptyValue(item.MOVE_BLOCKALPHA, item.PIC_NOTE, '') || '').replace(/\|.*$/g, '').replace(/^Block\s*/i, '').trim() || 'No Block';
        const submittedAt = formatSalesOfficeDate(firstNonEmptyValue(item.ORDER_SUBMITTED_AT, item.COMPLETED_AT, ''));
        return `<div class="flex items-center w-full mb-3 item-row relative" data-dom-id="${item.DOM_ID}" oncontextmenu="return handleCardContextMenu(event, '${item.DOM_ID}')" ${buildCardActivationAttrs(item.DOM_ID, item.UNIQUE_ID, renderMeta.originView || sourceView, 'Open Sales Office move row')}><div class="card-checkbox-container flex-shrink-0"><input type="checkbox" class="card-checkbox w-6 h-6 rounded border-gray-300 text-[#007a4d] focus:ring-[#007a4d] shadow-sm" ${isChecked} onclick="event.stopPropagation(); toggleGlobalItem('${item.DOM_ID}', this.checked, '${safeCardSourceViewKey}')"></div><div class="inv-card app-smart-card status-green flex-grow !mb-0 bg-emerald-50 border border-[#007a4d] transition-transform active:scale-[0.99]"><div class="flex justify-between items-start mb-3"><div class="app-card-main font-bold text-lg text-[#007a4d] leading-tight pr-2 select-text" style="-webkit-user-select: text; user-select: text;"><div class="mb-2 flex flex-wrap gap-2"><span class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-[#007a4d]"><i class="ph-bold ph-arrows-left-right text-sm"></i>Move</span><span class="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-red-700">TA ${esc(taQty)}</span>${compactCardFieldChipsHtml}</div>${item.COMMONNAME || 'Unknown'}<br><span class="text-sm text-gray-500 font-semibold">${item.CONTSIZE || '-'}</span></div>${inlineThumbHtml}</div><div class="bg-white p-3 rounded-lg border border-emerald-200 shadow-sm mb-3 select-text cursor-text" style="-webkit-user-select: text; user-select: text;" onclick="event.stopPropagation();"><div class="flex justify-between items-center mb-1"><span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Item Code</span><span class="font-black text-[#007a4d] font-mono tracking-wide text-sm">${esc(itemCode)}</span></div><div class="flex justify-between items-center mb-1 border-b border-gray-100 pb-1"><span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Block / Lot</span><span class="font-bold text-gray-600 text-xs">${esc(moveBlock)} / ${esc(lotCode)}</span></div><div class="grid grid-cols-2 gap-2 mt-3"><div class="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2"><div class="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700">Moved</div><div class="mt-1 text-lg font-black text-emerald-800">${esc(actualMoved)}</div><div class="mt-1 text-[10px] font-bold uppercase text-emerald-700">${esc(moveFrom)} to ${esc(moveTo)}</div><div class="mt-0.5 text-[10px] font-bold uppercase text-emerald-700">Lot ${esc(lotCode)}</div></div><div class="rounded-lg border border-red-100 bg-red-50 px-3 py-2"><div class="text-[9px] font-black uppercase tracking-[0.14em] text-red-600">TA</div><div class="mt-1 text-lg font-black text-red-700">${esc(taQty)}</div><div class="mt-1 text-[10px] font-bold uppercase text-red-600">${esc(moveFrom)}</div><div class="mt-0.5 text-[10px] font-bold uppercase text-red-600">Lot ${esc(lotCode)}</div></div></div><div class="mt-3 text-[11px] font-semibold text-slate-500">Submitted ${submittedAt}</div>${displaySalesNote ? `<div class="mt-3 rounded border border-slate-200 bg-slate-50 p-2 text-[12px] font-semibold text-slate-700 whitespace-pre-wrap">${escapeQueueNoteText(displaySalesNote)}</div>` : ''}</div>${inventoryEditActionHtml}<div class="flex flex-wrap gap-2 mt-2"><button class="flex-1 min-w-[calc(50%-0.25rem)] bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 active:bg-indigo-200" onclick="event.stopPropagation(); return copyTextToClipboard('${safeItemCode}', 'ITEM CODE')"><i class="ph-bold ph-barcode text-lg"></i> COPY ITEMCODE</button><button class="flex-1 min-w-[calc(50%-0.25rem)] bg-[#007a4d] hover:bg-green-700 text-white text-[10px] font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md active:scale-95" onclick="event.stopPropagation(); return markSalesOfficeComplete('${safeUidJs}', '${safeDomId}', this)"><i class="ph-bold ph-check-circle text-lg"></i> DONE</button></div></div></div>`;
    }
    return `<div class="w-full mb-3 item-row relative" data-dom-id="${item.DOM_ID}" oncontextmenu="return handleCardContextMenu(event, '${item.DOM_ID}')" ${buildCardActivationAttrs(item.DOM_ID, item.UNIQUE_ID, renderMeta.originView || sourceView, 'Open Sales Office row')}><div class="inv-card app-smart-card ${seasonCardShellClass} ${salesOfficeStatusClass} w-full !mb-0 ${salesOfficeCardToneClass} border transition-transform active:scale-[0.99]"><div class="select-text" style="-webkit-user-select: text; user-select: text;">${stagingStatusBadgeHtml}${seasonArrivedAtHtml}<div class="text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">Item Code</div><div class="font-black ${salesOfficeAccentTextClass} font-mono tracking-wide text-[16px] break-all">${esc(itemCode)}</div><div class="mt-2 font-black text-[#007a4d] text-[20px] leading-tight">${esc(item.COMMONNAME || 'Unknown')}</div><div class="mt-1 text-[14px] font-bold text-gray-500">${esc(item.CONTSIZE || '-')}</div><div class="mt-3 bg-white p-3 rounded-lg border ${salesOfficePanelToneClass} shadow-sm cursor-text" onclick="event.stopPropagation();"><div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">AV Note</div><div class="text-[14px] font-bold text-blue-800 leading-snug whitespace-pre-wrap">${escapeQueueNoteText(avNoteText)}</div></div>${seasonSalesEntryActionsHtml}</div></div></div>`;
}
function hasDriveCardEvaluation(item) {
    return item?.completed === true || String(item?.DATE_COMPLETED || item?.date_completed || item?.completed_at || '').trim() !== '';
}

function buildCompletedRowBadge(item) {
    return '<span class="completed-row-badge" data-completed-row="'+escapeHtml(getCompletedRowUnlockKey(item))+'"'+(hasDriveCardEvaluation(item)?'':' hidden')+'>✅ COMPLETED</span>';
}

function renderDriveCardMeasurements(item, sourceView) {
    const spec = String(getItemDisplayValue(item, 'SPEC', sourceView) ?? '').trim();
    const caliper = String(getItemDisplayValue(item, 'CALIPER', sourceView) ?? '').trim();
    const fields = [
        spec ? `<span class="app-drive-card-spec">Spec: ${escapeQueueNoteText(spec)}</span>` : '',
        caliper ? `<span class="app-drive-card-caliper">Caliper: ${escapeQueueNoteText(caliper)}</span>` : ''
    ].filter(Boolean);
    return fields.length ? `<div class="app-drive-card-evidence">${fields.join(' • ')}</div>` : '';
}

function createDriveInventoryCardModel(context) {
    let { sourceView, hasCardPhotoEvidence, item, holdReleaseOverrideActive, formatCardPriceValue, renderMeta } = context;
    const displaySourceView = sourceView;
    const displayAvNote = hasCardPhotoEvidence || hasDriveCardEvaluation(item) ? getItemDisplayValue(item, 'AV_NOTE', displaySourceView) : '';
    const displayHoldStopCode = holdReleaseOverrideActive ? '' : firstNonEmptyValue(item.HOLDSTOPCODE, item.holdstopcode, item.HOLSTOPCODE, item.holstopcode, item.HOLD_STOP_CODE, item.HOLDSTOP, '');
    const displaySource = String(firstNonEmptyValue(item.SOURCE, item.source, '') || '').trim();
    const displayHoldStopReason = holdReleaseOverrideActive ? '' : firstNonEmptyValue(item.HOLDSTOPREASON, item.holdstopreason, item.HOLD_STOP_REASON, item.hold_stop_reason, item.HOLDREASON, item.holdreason, '');
    const displayHoldStopBeginDate = holdReleaseOverrideActive ? '' : getHoldStopBeginDateValueFromItem(item);
    const displayListPrice = formatCardPriceValue(firstNonEmptyValue(item.LISTPRICE, item.LISTPRI, ''));
    let noteHtml = '';
    const evalTaskHtml = buildEvalTaskCardSummaryHtml(item);
    if (evalTaskHtml) noteHtml += evalTaskHtml;
    const driveQuantityRowHtml = buildInventoryQuantityChipsHtml(renderMeta.verifiedQuantityRow || item, { layout: 'row', compact: true, locationMetricItem: item, sourceView: displaySourceView, preserveUnknown: renderMeta && renderMeta.preserveUnknownAvailability === true, knownLocationPhotoMatch: getCanonicalCardMatchDisplay(item, displaySourceView) });
    const driveAvNoteHtml = displayAvNote && String(displayAvNote).trim() !== '' ? `<div class="app-drive-card-note rounded border border-blue-200 bg-blue-50 p-2 text-[12px] font-semibold text-blue-800 shadow-sm whitespace-pre-wrap"><span class="font-black">AV NOTE:</span> ${escapeQueueNoteText(displayAvNote)}</div>` : '';
    const driveSpecHtml = renderDriveCardMeasurements(item, displaySourceView);
    const holdCodeText = String(firstNonEmptyValue(displayHoldStopCode, '') || '').trim();
    const holdReasonDisplay = String(firstNonEmptyValue(displayHoldStopReason, '') || '').trim();
    const holdDateDisplay = formatInventoryHoldSince(displayHoldStopBeginDate);
    const hasHoldData = holdCodeText && !['—', '-', 'NULL', 'N/A'].includes(holdCodeText.toUpperCase());
    const liveLocationNote = String(firstNonEmptyValue(item.LOCATIONNOTE, item.locationnote, item.LOCATION_NOTE, item.location_note, '') || '').trim();
    const liveLocationNoteDate = String(firstNonEmptyValue(item.LOCATIONNOTEDATE, item.locationnotedate, item.LOC_NOTE_DATE, item.loc_note_date, item.LOCATIONPTN1, item.locationptn1, '') || '').trim();
    const driveHoldDataHtml = `${hasHoldData ? `<div class="app-drive-card-hold-data app-inventory-card-hold-data"><span data-inventory-card-field="holdstopcode"><b>Code</b><strong>${esc(holdCodeText)}</strong></span><span data-inventory-card-field="holdstopreason"><b>Reason</b><strong>${holdReasonDisplay ? esc(holdReasonDisplay) : '—'}</strong></span><span data-inventory-card-field="holdstopbegindate"><b>Since</b><strong>${holdDateDisplay ? esc(holdDateDisplay) : '—'}</strong></span></div>` : ''}${liveLocationNote ? `<div data-location-note class="app-drive-card-note mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-[12px] font-semibold text-amber-900 shadow-sm whitespace-pre-wrap"><span class="font-black">LOCATION NOTE:</span> ${esc(liveLocationNote)}${liveLocationNoteDate ? ` <span class="font-bold">(${esc(liveLocationNoteDate)})</span>` : ''}</div>` : ''}`;
    const driveListPriceHtml = !isEvalSensitiveDataRestricted() && sourceView !== 'drive' && displayListPrice !== '-' ? `<div class="app-drive-card-list-price"><span>List price</span><strong>${esc(displayListPrice)}</strong></div>` : '';
    return { displaySourceView, displaySource, noteHtml, driveQuantityRowHtml, driveAvNoteHtml, driveSpecHtml, driveHoldDataHtml, driveListPriceHtml };
}

function renderDriveInventoryCardMarkup(context) {
    let { item, sourceView, renderMeta, displaySource, displaySourceView, isChecked, safeCardSourceViewKey, seasonCardShellClass, inventoryCardToneClass, holdBorderClass, inlineThumbHtml, driveListPriceHtml, driveQuantityRowHtml, driveSpecHtml, driveAvNoteHtml, driveHoldDataHtml, noteHtml, inventoryEditActionHtml } = context;
    const canUseDriveOptions = canCurrentUserUseDriveCardOptions(item, sourceView);
    const canSelectDriveWorkflow = canCurrentUserSelectDriveWorkflowRow(item, sourceView);
    const driveNewCropReleaseBtn = canUseDriveOptions ? getDriveNewCropReleaseButtonHtml(item) : '';
    const driveHoldReleaseBtn = canUseDriveOptions ? getDriveHoldReleaseButtonHtml(item) : '';
    const driveReverseRailBtn = canUseDriveOptions ? buildNcrApprovalReverseRailButtonHtml(item, 'drive') : '';
    const driveArgosRailHtml = sourceView === 'av' ? '' : buildArgosInventoryTransactionRailHtml(item, renderMeta.originView || 'drive');
    const driveTagColorHtml = buildInventoryCardTopTagColorHtml(item);
    const driveSourceChipHtml = displaySource ? `<span class="app-drive-card-source-chip">${esc(displaySource)}</span>` : '';
    const driveReclassMetaHtml = `${driveTagColorHtml}${driveSourceChipHtml}`;
    const driveReclassActionHtml = driveArgosRailHtml || driveReclassMetaHtml ? `<div class="app-drive-card-reclass" onclick="event.stopPropagation();">${driveArgosRailHtml}${driveTagColorHtml ? `<div class="app-drive-card-tag-row" data-inventory-card-field="fieldtagcolor">${driveTagColorHtml}</div>` : ''}${driveSourceChipHtml ? `<div class="app-drive-card-source-row">${driveSourceChipHtml}</div>` : ''}</div>` : '';
    const driveRoleAccess = getRoleAccessState();
    const includeDriveBloomPickerBtn = canAddItemToBloomPicker(item, sourceView) && (
        (driveRoleAccess.isRep && !driveRoleAccess.isCsr)
        || (canSelectDriveWorkflow && (canUseDriveBloomPickerForTakeBack() || isWarehouseAssignedDriveCardForCurrentUser(item)))
    );
    const driveBottomExtraHtml = `${driveNewCropReleaseBtn}${driveHoldReleaseBtn}${driveReverseRailBtn}`.trim();
    let quickRequestBtn = '';
    if (includeDriveBloomPickerBtn || driveBottomExtraHtml) {
        quickRequestBtn = getInventoryCardBottomRailHtml(item.DOM_ID, driveBottomExtraHtml, { includeCart: includeDriveBloomPickerBtn, sourceView });
    }
    const customerOutreachHtml = canUseDriveOptions ? buildCustomerConsigneeOutreachCardAction(item, displaySourceView) : '';
    const driveCheckboxHtml = canSelectDriveWorkflow ? `<div class="card-checkbox-container flex-shrink-0"><input type="checkbox" class="card-checkbox w-6 h-6 rounded border-gray-300 text-[#007a4d] focus:ring-[#007a4d] shadow-sm" ${isChecked} onclick="event.stopPropagation(); toggleGlobalItem('${item.DOM_ID}', this.checked, '${safeCardSourceViewKey}')"></div>` : '';
    const driveFieldChipsHtml = buildInventoryCardFieldChipsHtml(item, { compact: true });
    const driveChipRowHtml = `${buildCompletedRowBadge(item)}${buildEvalOwnerBadge(item)}${buildDriveEarlyABadgeHtml(item)}${driveFieldChipsHtml}`.trim();
    const driveCardActionClass = `${quickRequestBtn ? 'app-card-with-bottom-rail' : ''} ${driveReclassActionHtml ? 'app-drive-card-with-reclass' : ''}`.trim();

    return `<div class="flex items-center w-full mb-3 item-row app-smart-card app-smart-card--inventory app-drive-compact-card ${sourceView === 'drive' ? 'app-shared-drive-layout' : ''} app-inventory-card-overhaul ${seasonCardShellClass} ${driveCardActionClass} relative ${inventoryCardToneClass} p-4 rounded-xl border shadow-sm active:scale-[0.99] transition-transform cursor-pointer overflow-hidden ${holdBorderClass}" data-dom-id="${item.DOM_ID}" oncontextmenu="return handleCardContextMenu(event, '${item.DOM_ID}')" ${buildExactInventoryCardActivationAttrs(item, renderMeta.originView || sourceView, 'Open drive row')}>${driveCheckboxHtml}${buildSharedInventoryCardLayout(item, { photoHtml: inlineThumbHtml, actionsHtml: driveReclassActionHtml, headerHtml: driveListPriceHtml, metricsHtml: driveQuantityRowHtml, detailsHtml: `${driveSpecHtml}${driveAvNoteHtml}${quickRequestBtn ? `<div class="app-drive-card-bottom">${quickRequestBtn}</div>` : ''}${driveHoldDataHtml}${driveChipRowHtml ? `<div class="app-drive-card-chip-row">${driveChipRowHtml}</div>` : ''}${noteHtml}${customerOutreachHtml}${inventoryEditActionHtml}` })}</div>`;
}

function renderDriveInventoryCard(context) {
    return renderDriveInventoryCardMarkup({ ...context, ...createDriveInventoryCardModel(context) });
}

function renderTaskInventoryCard(context) {
    let { sourceView, hasCardPhotoEvidence, item, buildHoldReasonHtml, seasonCardShellClass, inventoryCardToneClass, holdBorderClass, renderMeta, isChecked, safeCardSourceViewKey, buildInventoryToplineHtml, buildInventorySecondarylineHtml, cardFieldChipsHtml, inventoryEditActionHtml, inlineThumbHtml } = context;
    const displaySourceView = sourceView;
    const displayAvNote = hasCardPhotoEvidence ? getItemDisplayValue(item, 'AV_NOTE', displaySourceView) : '';
    const displaySpec = getItemDisplayValue(item, 'SPEC', displaySourceView);
    const displayCaliper = getItemDisplayValue(item, 'CALIPER', displaySourceView);
    const displayMatch = hasCardPhotoEvidence ? getItemDisplayValue(item, 'MATCH', displaySourceView) : '';
    let noteHtml = '';
    const holdHtml = buildHoldReasonHtml();
    const evalTaskHtml = buildEvalTaskCardSummaryHtml(item);
    if (holdHtml) noteHtml += holdHtml;
    if (evalTaskHtml) noteHtml += evalTaskHtml;
    if (displayAvNote && String(displayAvNote).trim() !== '') { noteHtml += `<div class="mt-2 text-[12px] text-blue-800 bg-blue-100 p-2 rounded border border-blue-200 shadow-sm whitespace-pre-wrap"><span class="font-black">AV NOTE:</span> ${displayAvNote}</div>` }
    let extraData = '';
    extraData = `<div class="mt-2 flex gap-2 text-[10px] font-bold text-gray-500 uppercase">${displaySpec ? `<span class="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">Spec: ${displaySpec}</span>` : ''}${displayCaliper ? `<span class="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">Caliper: ${displayCaliper}</span>` : ''}${displayMatch ? `<span class="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">LOC MATCH %: ${displayMatch}%</span>` : ''}</div>`;
    const taskArgosRailHtml = buildArgosInventoryTransactionRailHtml(item, 'tasks');
    const taskApprovalBtn = buildInventoryAllEditRailButtonHtml(item, 'tasks');
    const taskReverseRailBtn = buildNcrApprovalReverseRailButtonHtml(item, 'tasks');
    const taskBottomRailButtonsHtml = `${taskArgosRailHtml}${taskApprovalBtn}${taskReverseRailBtn}`;
    const taskBloomPickerBtn = taskBottomRailButtonsHtml ? getInventoryCardBottomRailHtml(item.DOM_ID, taskBottomRailButtonsHtml) : '';
    return `<div class="flex items-center w-full mb-3 item-row app-smart-card app-smart-card--inventory ${seasonCardShellClass} ${taskBloomPickerBtn ? 'app-card-with-bottom-rail' : ''} relative ${inventoryCardToneClass} p-4 rounded-xl border shadow-sm active:scale-[0.99] transition-transform cursor-pointer overflow-hidden ${holdBorderClass}" data-dom-id="${item.DOM_ID}" oncontextmenu="return handleCardContextMenu(event, '${item.DOM_ID}')" ${buildCardActivationAttrs(item.DOM_ID, item.UNIQUE_ID, renderMeta.originView || sourceView, 'Open item details')}><div class="card-checkbox-container flex-shrink-0"><input type="checkbox" class="card-checkbox w-6 h-6 rounded border-gray-300 text-[#007a4d] focus:ring-[#007a4d] shadow-sm" ${isChecked} onclick="event.stopPropagation(); toggleGlobalItem('${item.DOM_ID}', this.checked, '${safeCardSourceViewKey}')"></div><div class="flex flex-grow min-w-0 flex-col"><div class="flex items-start justify-between min-w-0"><div class="app-card-main flex-grow min-w-0 pr-2">${buildInventoryToplineHtml(item.COMMONNAME || 'Unknown', item.CONTSIZE || '-', item)}${buildInventorySecondarylineHtml(item.LOCATIONCODE || 'No Loc', firstNonEmptyValue(item.SOURCE, item.source, ''))}<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-black"><span class="text-[12px] font-black uppercase">PRI ${item.PRIORITY || '-'}</span><span class="text-[12px] font-black">${item.ITEMCODE || '-'}</span><span class="text-[12px] font-black">${item.LOTCODE || '-'}</span></div><div class="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.12em]"><span class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700">LOC <span class="text-blue-900">${item.LOCATIONCODE || 'No Loc'}</span></span><span class="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-slate-700">LOT <span class="text-slate-900">${item.LOTCODE || '-'}</span></span><span class="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-orange-700">PRI <span class="text-orange-900">${item.PRIORITY || '-'}</span></span>${cardFieldChipsHtml}</div>${extraData}${noteHtml}${inventoryEditActionHtml}</div>${inlineThumbHtml}</div>${taskBloomPickerBtn}</div></div>`;
}

function renderDefaultInventoryCard(context) {
    let { item, sourceView, renderMeta, isChecked, safeCardSourceViewKey, colorClass, buildInventoryToplineHtml, buildInventorySecondarylineHtml, cardFieldChipsHtml, inventoryEditActionHtml, inlineThumbHtml } = context;
    const defaultArgosRailHtml = buildArgosInventoryTransactionRailHtml(item, sourceView);
    const defaultApprovalBtn = buildInventoryAllEditRailButtonHtml(item, sourceView);
    const defaultReverseRailBtn = buildNcrApprovalReverseRailButtonHtml(item, sourceView);
    const defaultBottomRailButtonsHtml = `${defaultArgosRailHtml}${defaultApprovalBtn}${defaultReverseRailBtn}`;
    const defaultBottomRailHtml = defaultBottomRailButtonsHtml ? getInventoryCardBottomRailHtml(item.DOM_ID, defaultBottomRailButtonsHtml, { includeCart: false }) : '';
    return `<div class="flex items-center w-full mb-2 item-row overflow-hidden" data-dom-id="${item.DOM_ID}" oncontextmenu="return handleCardContextMenu(event, '${item.DOM_ID}')" ${buildCardActivationAttrs(item.DOM_ID, item.UNIQUE_ID, renderMeta.originView || sourceView, 'Open item details')}><div class="card-checkbox-container flex-shrink-0"><input type="checkbox" class="card-checkbox w-6 h-6 rounded border-gray-300 text-[#007a4d] focus:ring-[#007a4d] shadow-sm" ${isChecked} onclick="event.stopPropagation(); toggleGlobalItem('${item.DOM_ID}', this.checked, '${safeCardSourceViewKey}')"></div><div class="inv-card app-smart-card app-smart-card--inventory ${colorClass} ${defaultBottomRailHtml ? 'app-card-with-bottom-rail' : ''} flex flex-col flex-grow !mb-0 transition-transform active:scale-[0.99]"><div class="flex items-start justify-between min-w-0"><div class="app-card-main flex-grow min-w-0 text-[#007a4d]">${buildInventoryToplineHtml(item.COMMONNAME || 'Unknown', item.CONTSIZE || '-', item)}${buildInventorySecondarylineHtml(item.LOCATIONCODE || 'No Loc', firstNonEmptyValue(item.SOURCE, item.source, ''))}<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-black"><span class="text-[12px] font-black uppercase">PRI ${item.PRIORITY || '-'}</span><span class="text-[12px] font-black">${item.ITEMCODE || '-'}</span><span class="text-[12px] font-black">${item.LOTCODE || '-'}</span></div><div class="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.12em]"><span class="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-slate-700">SUPPLY <span class="text-slate-900">${item.SEASONSUPPLY || '0'}</span></span>${cardFieldChipsHtml}</div><div class="mt-2 text-[12px] font-black text-black">${item.ITEMCODE || '-'}</div>${inventoryEditActionHtml}</div>${inlineThumbHtml}</div>${defaultBottomRailHtml}</div></div>`;
}

function renderNonSaleableBucketsReportCard(row = null) {
    const salesYear = row && row.__NON_SALEABLE_SALESYEAR != null ? `SY${row.__NON_SALEABLE_SALESYEAR}` : 'SY -';
    const season = row && row.__NON_SALEABLE_SEASON ? row.__NON_SALEABLE_SEASON : '-';
    const holdCode = String(firstNonEmptyValue(row && row.HOLDSTOPCODE, row && row.HOLSTOPCODE, '') || '').trim();
    const holdReason = String(firstNonEmptyValue(row && row.HOLDSTOPREASON, row && row.HSREASONBEGIN, '') || '').trim();
    const chips = [
        `Item ${row && row.ITEMCODE ? row.ITEMCODE : '-'}`,
        `Size ${row && row.CONTSIZE ? row.CONTSIZE : '-'}`,
        `Loc ${row && row.LOCATIONCODE ? row.LOCATIONCODE : '-'}`,
        `Lot ${row && row.LOTCODE ? row.LOTCODE : '-'}`,
        `Pri ${row && row.PRIORITY ? row.PRIORITY : '-'}`,
        `${season} ${salesYear}`
    ].map((label) => `<span class="rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-orange-700">${esc(label)}</span>`).join('');
    const metrics = [
        ['Available', formatNonSaleableNumber(firstNonEmptyValue(row && row.PTRAVAILABLE, row && row.ptravailable, ''))],
        ['On Hand', formatNonSaleableNumber(firstNonEmptyValue(row && row.PTRONHAND, row && row.ptronhand, ''))],
        ['Open Stock', formatNonSaleableNumber(firstNonEmptyValue(row && row.S_LTS, row && row.s_lts, ''))]
    ].map(([label, value]) => `<div class="rounded-xl border border-slate-100 bg-white px-3 py-2"><div class="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">${label}</div><div class="mt-1 text-lg font-black text-slate-900">${esc(value)}</div></div>`).join('');
    const noteHtml = holdCode || holdReason
        ? `<div class="mt-3 rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-[12px] font-bold text-orange-900">Hold/Stop: ${esc(holdCode || '-')} ${holdReason ? `- ${esc(holdReason)}` : ''}</div>`
        : '';
    return `<div class="rounded-2xl border border-orange-200 bg-white p-4 shadow-sm"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><div class="text-[10px] font-black uppercase tracking-[0.16em] text-orange-600">${esc(row && row.__NON_SALEABLE_BUCKET_LABEL ? row.__NON_SALEABLE_BUCKET_LABEL : 'Non Saleable')}</div><div class="mt-1 text-xl font-black leading-tight text-slate-900">${esc(row && row.COMMONNAME ? row.COMMONNAME : 'Unknown')}</div><div class="mt-2 flex flex-wrap gap-2">${chips}</div></div><div class="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">${esc(row && row.SOURCE ? row.SOURCE : 'Source -')}</div></div><div class="mt-3 grid grid-cols-3 gap-2">${metrics}</div>${noteHtml}</div>`;
}
