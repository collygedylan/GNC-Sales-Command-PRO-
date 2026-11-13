function createRequestInventoryCardModel(context) {
    const { item } = context;
    const reqQty = String(resolveRequestCardQuantity(item) ?? '—');
    let cust = item.REQ_CUSTOMER || 'Unknown';

    let reserve = item.REQ_RESERVE || 'NO';
    let loc = item.LOCATIONCODE || 'No Loc';

    let lot = item.LOTCODE || '-';
    let priority = item.PRIORITY || '-';

    const dockSuspendCardDataHtml = isDockSuspendDcRequestMirrorRow(item) && activeReqTab === 'suspend-tag'
        ? buildDockSuspendDcRequestCardDataHtml(item)
        : '';
    const requestDone = isRequestComplete(item);
    const requestDeliverySending = requestDone && isRequestDeliverySending(item);
    const requestDeliveryNeedsAttention = requestDone && isRequestDeliveryNeedsAttention(item);
    const statusChip = requestDeliveryNeedsAttention
        ? `<span class="bg-red-50 text-red-700 px-1.5 py-0.5 rounded border border-red-200">Delivery Needs Attention</span>`
        : (requestDeliverySending
            ? `<span class="bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded border border-sky-200">Completed &mdash; Sending</span>`
            : (requestDone
                ? `<span class="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200">Complete</span>`
                : `<span class="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200">Pending</span>`));
    const reserveBadge = reserve === 'YES'
        ? `<span class="bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200">Reserve: YES</span>`
        : `<span class="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded border border-gray-200">Reserve: NO</span>`;
    const historyBadge = item.REQUEST_HISTORY
        ? `<span class="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">History</span>`
        : '';
    const actionBadge = '';
    const nestedDockActionPressAttrs = 'data-fast-press-ignore onpointerdown="return stopNestedCardActionPress(event)" ontouchstart="return stopNestedCardActionPress(event)" onmousedown="return stopNestedCardActionPress(event)"';
    return { reqQty, cust, reserve, loc, lot, priority, dockSuspendCardDataHtml, statusChip, reserveBadge, historyBadge, actionBadge, nestedDockActionPressAttrs };
}
function renderRequestInventoryCardMarkup(context) {
    let { item, nestedDockActionPressAttrs, cust, cleanHoldCode, holdReasonText, inlineThumbHtml, isSuspendTagRequestCard, seasonCardShellClass, requestCardToneClass, requestBorderClass, suspendTagPlanstartToneDataAttr, isChecked, safeCardSourceViewKey, historyBadge, reserve, reserveBadge, dockSuspendCardDataHtml, inventoryEditActionHtml, actionBadge, renderMeta, sourceView, statusChip, reqQty, loc, lot, priority } = context;
    const requestRemoveButtonHtml = '';
    const requestCustomer = normalizeRequestCardCustomer(firstNonEmptyValue(item.CUSTOMERNAME, item.customername, item.REQ_CUSTOMER, item.req_customer, item.CUSTOMER_NAME, cust, 'Unknown'));
    const requestConsignee = String(firstNonEmptyValue(item.CONSIGNEENAME, item.consigneename, item.REQ_CONSIGNEE, item.req_consignee, item.CONSIGNEE_NAME, '') || '').trim();
    const requestSalesRep = String(getRequestAssignedRep(item) || 'Unknown').trim();
    const requestCaliper = String(firstNonEmptyValue(item.REQUEST_CALIPER, item.request_caliper, item.REQ_CALIPER, item.req_caliper, item.CALIPER, item.caliper, item.DESIRED_CALIPER, item.desired_caliper, '') || '').trim();
    const requestMetaChip = (label, value) => `<span class="app-request-card-meta-chip"><span>${label}</span><strong>${escapeQueueNoteText(value || '—')}</strong></span>`;
    const requestSubmitter = String(firstNonEmptyValue(item.SUBMITTED_BY, item.submitted_by, item.REQUEST_CREATED_BY_DISPLAY, item.request_created_by_display, item.REQUEST_CREATED_BY_USERNAME, item.request_created_by_username, item.REQUESTED_BY, item.requested_by, item.CREATED_BY_DISPLAY, item.created_by_display, item.CREATED_BY, item.created_by, requestSalesRep));
    const meaningfulRequestDetail = value => value && !/^(?:N\/?A|GENERAL|-)$/i.test(String(value).trim());
    const requestDetail = firstNonEmptyValue(item.REQUEST_SPEC, item.request_spec, item.DESIRED_SPEC, item.desired_spec, item.REQUEST_NOTE, item.request_note, '');
    const displayEvidence = getQueueDisplayEvidenceRow(item);
    const displayText = displayEvidence ? [getItemDisplayValue(displayEvidence, 'SPEC', 'drive'), getItemDisplayValue(displayEvidence, 'AV_NOTE', 'drive')].filter(Boolean).join(' · ') : '';

    const requestReclassButton = '';
    const requestMetaHtml = `<div class="app-request-card-metadata">${displayText ? '<div>' + escapeQueueNoteText(displayText) + '</div>' : ''}<div>${requestMetaChip('Customer', requestCustomer)}${requestMetaChip('Consignee', requestConsignee)}</div><div>${requestMetaChip('Sales Rep', requestSalesRep)}${requestMetaChip('Submitted By', requestSubmitter)}</div>${meaningfulRequestDetail(requestDetail) || meaningfulRequestDetail(requestCaliper) ? `<div class="app-request-card-note">${escapeQueueNoteText([requestDetail, requestCaliper].filter(meaningfulRequestDetail).join(' · '))}</div>` : ''}</div>`;
    const requestHoldBar = cleanHoldCode || holdReasonText ? `<div class="app-request-card-hold" title="${esc(holdReasonText || '')}">${esc(cleanHoldCode || 'Hold/Stop')} · ${esc(holdReasonText || '—')}</div>` : '';
    const suspendSalesRep = String(firstNonEmptyValue(item.REQUESTED_BY, item.SALESREPNAME, item.SALESREP, item.SALESREPID, '') || '').trim();
    const suspendOperationalMetaHtml = `<div class="app-operational-card-meta app-request-card-meta">${requestMetaChip('Consignee', requestConsignee)}${requestMetaChip('Sales Rep', suspendSalesRep || 'N/A')}${requestCaliper ? requestMetaChip('Caliper', requestCaliper) : ''}</div>`;
    const requestMetricsHtml = window.AgMetricQueueInventory ? buildQueueInventoryMetricsHtml(item, 'request', { layout: 'row', compact: true }) : buildInventoryQuantityChipsHtml(item, { layout: 'row', compact: true, sourceView: 'request' });
    const requestPhotoCellHtml = inlineThumbHtml ? `<div class="app-drive-card-photo">${inlineThumbHtml}</div>` : '';
    const requestGridClass = `app-drive-card-grid--no-actions ${inlineThumbHtml ? '' : 'app-drive-card-grid--no-photo'}`.trim();
    if (isDockSuspendDcRequestMirrorRow(item) && activeReqTab === 'suspend-tag') {
        const falseBlock = isFalseBlockLocation(item.LOCATIONCODE || item.locationcode);
        const reclass = falseBlock ? '' : buildSuspendTagReclassActionHtml(item, nestedDockActionPressAttrs);
        const dockSuspendTagActionHtml = buildSuspendTagActions(item, nestedDockActionPressAttrs);
        const suspendOrderField = (label, value) => `<span class="app-suspend-tag-order-field"><span>${esc(label)}: </span><strong>${escapeQueueNoteText(value || '—')}</strong></span>`;
        const suspendDock = String(firstNonEmptyValue(item.DOCK_NUM, item.dock_num, item.DOCK, item.dock, '') || '').replace(/^dock\s*/i, '').trim();
        const suspendOrderStripHtml = `<div class="app-suspend-tag-order-strip">${suspendOrderField('Dock', suspendDock)}${suspendOrderField('Drop', getDockStopOrDropValue(item))}${suspendOrderField('Qty', formatDockDisplayQty(getDockDisplayQty(item)))}${suspendOrderField('Consignee', requestConsignee)}${suspendOrderField('Sales Rep', suspendSalesRep || 'N/A')}</div>`;
        const suspendHoldstopCode = String(firstNonEmptyValue(cleanHoldCode, '') || '').trim();
        const suspendHoldstopReason = String(firstNonEmptyValue(holdReasonText, '') || '').trim();
        const suspendHoldstopHtml = suspendHoldstopCode || suspendHoldstopReason || isSuspendTagRequestCard
            ? `<div class="app-suspend-tag-holdstop-row"><span><b>Hold Stop Code</b><strong>${esc(suspendHoldstopCode || 'N/A')}</strong></span><span><b>Reason</b><strong data-queue-metric="reason">${escapeQueueNoteText(suspendHoldstopReason || 'N/A')}</strong></span></div>`
            : '';
        return `<article class="flex items-start w-full mb-3 item-row app-smart-card app-smart-card--inventory app-drive-compact-card app-inventory-card-overhaul app-shared-drive-layout app-suspend-tag-compact-card ${reclass ? 'app-drive-card-with-reclass' : ''} ${seasonCardShellClass} relative ${requestCardToneClass} p-4 rounded-xl border shadow-sm active:scale-[0.99] transition-transform cursor-pointer overflow-hidden ${requestBorderClass}" data-suspend-tag-card="true" data-dom-id="${esc(item.DOM_ID)}" data-request-uid="${esc(item.UNIQUE_ID)}" data-watchdog-foreign-owner="${watchdogQueueOwnerMismatch(item)}" data-request-history="${item.REQUEST_HISTORY ? 'true' : 'false'}"${suspendTagPlanstartToneDataAttr} oncontextmenu="return handleCardContextMenu(event, '${escJsAttrValue(item.DOM_ID)}')" ${buildExactInventoryCardActivationAttrs(item, 'request', 'Open Suspend Tag photo and spec editor', getDockSuspendDcRequestSourceUid(item))}><div class="card-checkbox-container flex-shrink-0"><input type="checkbox" aria-label="Select request for ${esc(requestCustomer)}" class="card-checkbox w-6 h-6 rounded border-gray-300 text-[#007a4d] focus:ring-[#007a4d] shadow-sm" ${isChecked} onclick="event.stopPropagation(); toggleGlobalItem('${escJsAttrValue(item.DOM_ID)}', this.checked, '${safeCardSourceViewKey}')"></div>${buildSharedInventoryCardLayout(item, { operational: true, compactSuspend: true, operationalMetaHtml: suspendOperationalMetaHtml, orderStripHtml: suspendOrderStripHtml, operationalMissingValue: 'N/A', actionsHtml: reclass + buildEvalOwnerBadge(item), quantity: formatDockDisplayQty(getDockDisplayQty(item)), spec: firstNonEmptyValue(item.REQ_SPEC, item.DOCK_SPEC, item.SPEC), photoHtml: inlineThumbHtml, headerHtml: `<span class="suspend-planstart-badge">SUSPEND TAG · Plan Start ${esc(formatDockCardPlanStartValue(getDockSuspendDcRequestPlanstartValue(item)))}</span>${historyBadge}${reserve === 'YES' ? reserveBadge : ''}`, metricsHtml: renderSuspendCardMetrics(item, falseBlock), detailsHtml: `${dockSuspendCardDataHtml}${inventoryEditActionHtml}${suspendHoldstopHtml}<div class="app-request-card-bottom">${dockSuspendTagActionHtml}${actionBadge}</div>` })}</article>`;
    }
    return `<article class="flex items-start w-full mb-3 item-row app-smart-card app-smart-card--inventory app-drive-compact-card app-request-compact-card app-inventory-card-overhaul ${seasonCardShellClass} relative ${requestCardToneClass} p-4 rounded-xl border shadow-sm active:scale-[0.99] transition-transform cursor-pointer overflow-hidden ${requestBorderClass}" data-dom-id="${esc(item.DOM_ID)}" data-request-uid="${esc(item.UNIQUE_ID)}" data-watchdog-foreign-owner="${watchdogQueueOwnerMismatch(item)}" data-request-history="${item.REQUEST_HISTORY ? 'true' : 'false'}"${suspendTagPlanstartToneDataAttr} oncontextmenu="return handleCardContextMenu(event, '${escJsAttrValue(item.DOM_ID)}')" ${buildExactInventoryCardActivationAttrs(item, renderMeta.originView || sourceView, 'Open request row')}><div class="card-checkbox-container flex-shrink-0"><input type="checkbox" aria-label="Select request for ${esc(requestCustomer)}" class="card-checkbox w-6 h-6 rounded border-gray-300 text-[#007a4d] focus:ring-[#007a4d] shadow-sm" ${isChecked} onclick="event.stopPropagation(); toggleGlobalItem('${escJsAttrValue(item.DOM_ID)}', this.checked, '${safeCardSourceViewKey}')"></div><div class="app-drive-card-grid ${requestGridClass} flex-grow">${requestPhotoCellHtml}<div class="app-drive-card-main"><div class="app-drive-card-header"><div class="app-drive-card-title-row"><div class="app-drive-card-title">${esc(item.COMMONNAME || 'Unknown')} <span class="app-drive-card-title-size">${esc(item.CONTSIZE || '-')}</span></div><div class="app-request-card-status-row">${historyBadge}${statusChip}${reserveBadge}${buildEvalOwnerBadge(item)}</div></div><div class="app-drive-card-itemcode"><span class="app-request-qty-badge">Qty ${esc(reqQty)}</span> · ${esc(item.ITEMCODE || '-')}</div><div class="app-drive-card-meta">${esc(loc)} · ${esc(lot)} · PRI ${esc(priority)}</div></div></div>${requestMetaHtml}${requestHoldBar}<div class="app-request-card-extra">${dockSuspendCardDataHtml}${inventoryEditActionHtml}</div><div class="app-drive-card-quantity-band">${requestMetricsHtml}</div><div class="app-request-card-bottom">${requestReclassButton}${requestRemoveButtonHtml}${actionBadge}</div></div></article>`;
}
function renderRequestInventoryCard(context) {
    return renderRequestInventoryCardMarkup({ ...context, ...createRequestInventoryCardModel(context) });
}

function renderEvalWorkInventoryCard(context) {
    let { item, holdBorderClass, buildInventoryToplineHtml, buildInventorySecondarylineHtml, compactCardFieldChipsHtml, inlineThumbHtml } = context;
    const workId = String(item.EVAL_WORK_ID || '');
    const originUid = String(item.EVAL_WORK_ORIGIN_UID || item.UNIQUE_ID || '');
    const statusValue = String(item.EVAL_WORK_STATUS || 'open').trim().toLowerCase();
    const statusLabel = statusValue.replaceAll('_', ' ') || 'open';
    const statusTone = statusValue === 'submitted'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : (statusValue === 'cancelled'
            ? 'bg-slate-100 text-slate-700 border-slate-200'
            : 'bg-amber-50 text-amber-700 border-amber-200');
    const delivery = item.EVAL_WORK_DELIVERY && typeof item.EVAL_WORK_DELIVERY === 'object' ? item.EVAL_WORK_DELIVERY : {};
    const deliveryEntry = statusValue === 'submitted' ? delivery.completion : delivery.assignment;
    const deliveryStatus = String(firstNonEmptyValue(deliveryEntry && deliveryEntry.status, statusValue === 'cancelled' ? 'cancelled' : 'queued') || 'queued').replaceAll('_', ' ');
    const location = String(item.LOCATIONCODE || 'No Loc');
    const lot = String(item.LOTCODE || '-');
    const block = [item.EVAL_WORK_BLOCK_ALPHA, item.EVAL_WORK_BLOCK_NUMBER].filter(Boolean).join(' / ') || 'No block';
    const assignee = String(item.EVAL_WORK_ASSIGNEE || 'Unassigned');
    const reportLabel = String(item.EVAL_WORK_REPORT_LABEL || 'Eval Work');
    const safeWorkId = escJsAttrValue(workId);
    const safeOriginUid = escJsAttrValue(encodeURIComponent(originUid));
    const openAttrs = `role="button" tabindex="0" aria-label="Open Eval Work row" onclick="return openEvalWorkDetail('${safeWorkId}','${safeOriginUid}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();return openEvalWorkDetail('${safeWorkId}','${safeOriginUid}')}"`;
    return `<div class="flex items-center w-full mb-3 item-row app-smart-card app-smart-card--inventory relative app-request-card-surface border-purple-200 p-4 rounded-xl border shadow-sm active:scale-[0.99] transition-transform cursor-pointer overflow-hidden ${holdBorderClass}" data-dom-id="${esc(item.DOM_ID)}" data-eval-work-origin-row="true" data-eval-work-id="${esc(workId)}" data-eval-work-origin-uid="${esc(originUid)}" ${openAttrs}><div class="flex flex-col w-full min-w-0"><div class="flex justify-between items-start w-full"><div class="app-card-main flex-grow min-w-0 pr-2">${buildInventoryToplineHtml(item.COMMONNAME || 'Eval Work', item.CONTSIZE || '-', item)}${buildInventorySecondarylineHtml(location, reportLabel)}<div class="app-card-meta-grid grid grid-cols-2 gap-x-2 gap-y-1 mb-2 text-[11px] font-bold text-gray-600"><div class="truncate"><i class="ph-bold ph-user mr-1"></i>${esc(assignee)}</div><div class="truncate"><i class="ph-bold ph-map-pin mr-1"></i>Block ${esc(block)}</div></div><div class="app-card-chip-row flex flex-wrap gap-x-2 gap-y-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-600"><span class="px-1.5 py-0.5 rounded border ${statusTone}">${esc(statusLabel)}</span><span class="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-100">${esc(item.ITEMCODE || '-')}</span><span class="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">Loc: ${esc(location)}</span><span class="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">Lot: ${esc(lot)}</span><span class="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100">Email: ${esc(deliveryStatus)}</span>${compactCardFieldChipsHtml}</div></div>${inlineThumbHtml}</div></div></div>`;
}

function renderDockOrderMetadata(item) {
    const fields = [
        ['Dock', formatDockViewDockLabel(item.DOCK_NUM || item.DOCK)],
        ['Drop', String(getDockStopOrDropValue(item) || '')],
        ['Qty', getDockOrderedQtyDisplay(item)],
        ['Plan Start', formatDockCardPlanStartValue(getDockSuspendDcRequestPlanstartValue(item))],
        ['Consignee', String(item.CONSIGNEENAME || item.CONSIGNEE || '')],
        ['Sales Rep', firstNonEmptyValue(item.SALESREPNAME, item.SALESREP, item.SALES_REP, item.SALESREPID, '')],
    ];
    const chips = fields.map(([label, raw]) => {
        const value = String(raw || '').trim();
        const display = value && value.toUpperCase() !== 'UNKNOWN REP' ? value : 'N/A';
        return `<span class="app-request-card-meta-chip" style="min-width:0;color:#ecfdf5;background:#064e3bd9;border-color:#34d39966;overflow-wrap:anywhere"><span style="color:inherit">${esc(label)}</span><strong style="color:inherit">${esc(display)}</strong></span>`;
    });
    return `<div class="app-operational-card-meta">${chips.join('')}</div>`;
}

function renderDockInventoryCard(context) {
    let { item, safeUidJs, safeDockIssueSourceUidJs, renderMeta, sourceView, isChecked, safeCardSourceViewKey, inlineThumbHtml, inventoryEditActionHtml } = context;
    const dockQuantityRaw = firstNonEmptyValue(getDockOrderedQtyRaw(item), item.PTRAVAILABLE, item.ptravailable, '');
    const qty = String(dockQuantityRaw == null ? '' : dockQuantityRaw).trim()
        ? (getDockOrderedQtyDisplay(item) || formatDockDisplayQty(getDockDisplayQty(item)))
        : 'N/A';
    const dockPlanstartInfo = getDockSuspendDcRequestPlanstartInfo(item);
    const dockPlanstartClass = dockPlanstartInfo.valid ? `app-operational-planstart-card ${dockPlanstartInfo.className} ${dockPlanstartInfo.legacyClassName}` : '';
    const dockPlanstartData = ` data-docks-stop-card="${escapeHtml(item.DOM_ID || item.UNIQUE_ID || '')}" data-docks-inventory-uid="${escapeHtml(item.__dockInventoryUid || '')}"` + (dockPlanstartInfo.valid ? ` data-planstart-value="${esc(dockPlanstartInfo.value)}" data-planstart-tone="${esc(dockPlanstartInfo.tone)}" data-planstart-valid="true"` : '');
    const dockInventoryRow = getOperationalCardInventoryRow(item);
    const dockMetaHtml = renderDockOrderMetadata(item);
    const noteText = String(firstNonEmptyValue(item.DOCK_ISSUE_NOTE, item.DOCK_NOTE, '')).trim();
    const issueState = String(firstNonEmptyValue(item.DOCK_ISSUE_STATE, '')).trim().toLowerCase();
    let noteHtml = '';
    if (noteText) noteHtml += `<div class="mt-2 text-[12px] text-orange-800 bg-orange-100 p-2 rounded border border-orange-200 shadow-sm whitespace-pre-wrap"><span class="font-black">Dock Note:</span> ${esc(noteText)}</div>`;
    const checkState = getDockItemProgress(item.UNIQUE_ID);
    const isDimmed = checkState.checker && checkState.inspector;
    let cardOpacity = isDimmed ? 'opacity-50' : 'opacity-100';
    let chkClass = checkState.checker ? 'bg-[#007a4d] text-white border-[#007a4d]' : 'bg-gray-50 text-gray-500 border-gray-200';
    let inspClass = checkState.inspector ? 'bg-[#007a4d] text-white border-[#007a4d]' : 'bg-gray-50 text-gray-500 border-gray-200';
    const issueBadgeHtml = issueState === 'open'
        ? `<span class="bg-red-50 text-red-700 px-2 py-1 rounded border border-red-200">Issue Open</span>`
        : (issueState === 'resolved' ? `<span class="bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-200">Issue Resolved</span>` : '');
    const syntheticBadgeHtml = item.IS_SYNTHETIC_DOCK_ROW
        ? `<span class="bg-blue-50 text-blue-700 px-2 py-1 rounded border border-blue-200">Alt Loc</span>`
        : '';
    const dockViewOnlyForRep = getRoleAccessState().isRep;
    noteHtml += buildDocksCreditAction(item);
    let actionBtns = dockViewOnlyForRep ? '' : `<div class="flex gap-2 mt-3 pt-3 border-t border-gray-100"><button class="flex-1 py-2.5 rounded-lg text-[10px] uppercase font-black border shadow-sm transition-colors ${chkClass} active:scale-95" onclick="event.stopPropagation(); toggleDockItemState('${safeUidJs}', 'checker')"><i class="ph-bold ph-check-square mr-1 text-lg align-middle"></i> Verified</button><button class="flex-1 py-2.5 rounded-lg text-[10px] uppercase font-black border shadow-sm transition-colors ${inspClass} active:scale-95" onclick="event.stopPropagation(); toggleDockItemState('${safeUidJs}', 'inspector')"><i class="ph-bold ph-magnifying-glass mr-1 text-lg align-middle"></i> Inspect</button><button class="flex-1 py-2.5 rounded-lg text-[10px] uppercase font-black border border-red-200 bg-red-50 text-red-600 shadow-sm transition-colors hover:bg-red-100 active:scale-95" onclick="event.stopPropagation(); openDockItemMistakeModal('${safeDockIssueSourceUidJs}')"><i class="ph-bold ph-flag mr-1 text-lg align-middle"></i> Flag Issue</button></div>`;
    return `<div class="flex items-start w-full item-row app-smart-card app-smart-card--inventory app-drive-compact-card app-inventory-card-overhaul app-shared-drive-layout ${dockPlanstartClass} relative bg-white p-4 rounded-xl border border-gray-300 shadow-sm active:scale-[.99] transition-transform cursor-pointer overflow-hidden ${cardOpacity}" data-dom-id="${item.DOM_ID}"${dockPlanstartData} oncontextmenu="return handleCardContextMenu(event, '${item.DOM_ID}')" ${buildCardActivationAttrs(item.DOM_ID, item.UNIQUE_ID, renderMeta.originView || sourceView, 'Open dock row')}><div class="card-checkbox-container flex-shrink-0 mt-1"><input type="checkbox" class="card-checkbox w-6 h-6 rounded border-gray-300 text-[#007a4d] focus:ring-[#007a4d] shadow-sm" ${isChecked} onclick="event.stopPropagation(); toggleGlobalItem('${item.DOM_ID}', this.checked, '${safeCardSourceViewKey}')"></div>${buildSharedInventoryCardLayout(item, { operational: true, planstartValue: formatDockCardPlanStartValue(getDockSuspendDcRequestPlanstartValue(item)), operationalMetaHtml: dockMetaHtml, operationalMissingValue: 'N/A', quantity: qty, spec: firstNonEmptyValue(item.SPEC, item.DOCK_SPEC), photoHtml: inlineThumbHtml, headerHtml: `${issueBadgeHtml}${syntheticBadgeHtml}`, metricsHtml: (window.AgMetricQueueInventory ? buildQueueInventoryMetricsHtml(item, 'docks', { layout: 'row', compact: true }) : buildInventoryQuantityChipsHtml(dockInventoryRow, { layout: 'row', compact: true, locationMetricItem: dockInventoryRow, sourceView: 'docks', preserveUnknown: true, missingValue: 'N/A' })), detailsHtml: `${buildInventoryCardFieldChipsHtml(item, { compact: true })}${noteHtml}${inventoryEditActionHtml}${actionBtns}` })}</div>`;
}

function renderSuspendCardMetrics(item, falseBlock) {
    const layout = { layout: 'row', compact: true };
    if (!falseBlock && window.AgMetricQueueInventory) return buildQueueInventoryMetricsHtml(item, 'request', layout);
    const row = falseBlock ? getSuspendTagMetricDisplayFallback(item, true)?.row : getOperationalCardInventoryRow(item);
    const source = falseBlock ? { ...row, LOC_ON_HAND: 0, LOC_PHOTO_MATCH: 0 } : row || {};
    const tiles = buildInventoryQuantityChipsHtml(source, { ...layout, sourceView: 'request',
        canonical: true, preserveUnknown: true, missingValue: 'N/A', queueMetricTelemetry: true,
        knownLocationOnHand: falseBlock ? 0 : item.suspend_tag_metrics?.LOC_ON_HAND,
        knownLocationPhotoMatch: falseBlock ? 0 : undefined });
    return falseBlock
        ? '<p class="app-suspend-tag-data-note" data-false-block="true">False Block · Add a location to fill this tag</p>' + tiles
        : tiles;
}

function resolveTargetedSuspendMetricFallback(item, targeted, helper) {
    const source = findDockSuspendDcRequestSourceRow(item) || item;
    const wanted = helper.identity(getSuspendTagInventoryIdentity(item, source));
    const found = targeted.index.resolveSuspendTagDisplay(wanted);
    if (!found?.row || found.matchLevel !== 'item-location') return found;
    const representative = (targeted.rows || []).filter(row => {
        const actual = helper.identity(row);
        return actual.itemCode === wanted.itemCode && actual.locationCode === wanted.locationCode
            && (!wanted.source || actual.source === wanted.source);
    }).reduce((best, row) => !best || Number(row.PTRONHAND) > Number(best.PTRONHAND) ? row : best, null);
    if (!representative) return found;
    const row = { ...found.row };
    for (const key of ['PTRONHAND', 'PTRREVIEWED', 'PTRAVAILABLE']) {
        row[key] = firstNonEmptyValue(representative[key], representative[key.toLowerCase()], row[key]);
    }
    return { ...found, row };
}

function buildSuspendTagActions(item, pressAttrs = '') {
    initializeSuspendTagCardActionDelegation();
    const status = getSuspendTagStatus(item), uid = esc(item.UNIQUE_ID || '');
    const sourceUid = getDockSuspendDcRequestSourceUid(item);
    const actionBusy = !!sourceUid && suspendTagCompletionActions.has(getSupabaseReadIdentityScope() + '|' + sourceUid);
    const labels = { pending:'Pending',completed:'Completed — Ready to Email',awaiting_rep:'Awaiting Rep',approved:'Approved',denied:'Denied / Needs Changes' };
    const action = (label,actionName) => '<button type="button" ' + pressAttrs + ' class="app-suspend-tag-action rounded-xl border border-emerald-200 text-xs font-bold" style="flex:1 1 8rem;min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere;text-overflow:clip" data-action="' + actionName + '" data-unique-id="' + uid + '"' + (actionBusy ? ' disabled aria-disabled="true" data-suspend-action-busy="' + esc(getSupabaseReadIdentityScope() + '|' + sourceUid) + '" title="This Suspend Tag action is already in progress."' : '') + '>' + label + '</button>';
    return '<div class="app-suspend-tag-status border-t" data-suspend-tag-status="' + esc(status) + '">' + (status === 'pending' ? '' : '<div class="app-suspend-tag-status-label font-bold">' + esc(labels[status] || status) + '</div>') + '<div class="app-suspend-tag-actions" style="display:flex;flex-wrap:wrap;min-width:0;max-width:100%;box-sizing:border-box">'
        + action('Change / Add Location','fill-tag')
        + (!isFalseBlockLocation(item.LOCATIONCODE || item.locationcode) ? action('Select ' + esc(item.LOCATIONCODE || item.locationcode), 'final-location') : '')
        + action('Remove Location','remove-location')
        + (['pending','denied','completed'].includes(status) ? action('Email','email-tag') : '')
        + (status === 'awaiting_rep' && (item.suspend_tag_delivery_status || item.SUSPEND_TAG_DELIVERY_STATUS) === 'failed' ? action('Retry Delivery','email-tag') : '')
        + action('Complete Tag','complete-tag') + '</div></div>';
}
