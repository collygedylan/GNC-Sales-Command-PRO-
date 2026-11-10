export function createNewRequestFolderForSelectedExistingPair() {
    const { customerGroup, consigneeGroup } = getSelectedExistingRequestFolderGroups();
    if (!customerGroup || !consigneeGroup) {
        showToast('Select Consignee', 'Choose a customer and consignee before creating a request folder.', true);
        return false;
    }
    const label = getExistingRequestFolderPairLabel(customerGroup, consigneeGroup);
    const context = resolveNewRequestFolderChoice(customerGroup, consigneeGroup);
    if (!context) {
        showToast('Select Mapped Consignee', 'Choose an active mapped customer and consignee by ID before creating a new folder.', true);
        return showRequestCustomerStep('step-1.5-folder');
    }
    tempRequestCustomerSelectedContext = context;
    tempRequestCustomerSelectedFinalLabel = label;
    return goToQtyStep(null, label, 'step-1.5-folder', false);
}

function resolveNewRequestFolderChoice(customerGroup, consigneeGroup) {
    if (isRequestNaCustomerPair(customerGroup.label, consigneeGroup.consigneeName)) {
        return getRequestCustomerContext(buildRequestModalNaCustomerOption(getRequestSelectedSalesrepId(tempSelectedReqRep, false)));
    }
    const contexts = (consigneeGroup.mapRows || []).filter(isActiveRequestCustomerMapping).map(getRequestCustomerContext);
    const identities = new Map(contexts.map(context => [JSON.stringify(context), context]));
    return identities.size === 1 ? identities.values().next().value : null;
}

export function isReservedRequestNaChoice(context) {
    return context?.customeridentityid === 'AGDATA_NA_CUSTOMER'
        && context?.consigneeidentityid === 'AGDATA_NA_CONSIGNEE'
        && isRequestNaCustomerPair(context.customername, context.consigneename);
}

export function bindRequestNaRep(context) {
    if (!isReservedRequestNaChoice(context)) return { ...context };
    const capturedId = context.request_selected_salesrep_id;
    return { ...context, request_selected_salesrep_id: capturedId && capturedId !== JD_EXECUTIVE_SALESREP_ID
        ? capturedId : getRequestSelectedSalesrepId(tempSelectedReqRep, false) };
}

export function processCustStep() {
    const cust = document.getElementById('cust-search-input').value.trim();
    const context = tempRequestCustomerSelectedContext;
    const reserved = !!tempSelectedReqRep && isReservedRequestNaChoice(context);
    if (cust !== tempRequestCustomerSelectedFinalLabel || !(reserved || hasRequestCreateMappingTuple(context))) {
        showToast('Select Mapped Consignee', 'Choose an active customer and consignee mapped to this sales rep.', true);
        return false;
    }
    return goToQtyStep(null, cust, 'step-2-cust', false);
}

export function refreshRequestModalCustomerStepIfVisible() {
    const customerStep = document.getElementById('step-2-cust');
    if (customerStep && !customerStep.classList.contains('hidden')) {
        const input = document.getElementById('cust-search-input');
        const searchValue = input ? String(input.value || '') : '';
        scheduleRequestModalSearchRender('customer', searchValue, () => populateCustomerList(searchValue), { force: true });
        return;
    }
    const folderStep = document.getElementById('step-1.5-folder');
    if (folderStep && !folderStep.classList.contains('hidden')) {
        scheduleRequestModalSearchRender('existing-folder-refresh', '', () => renderExistingRequestFolderPicker(), { force: true, skipDebounce: true });
    }
    const qtyStep = document.getElementById('step-3-qty');
    if (qtyStep && !qtyStep.classList.contains('hidden')) updateRequestQtyStepSubmitButton();
}

export function validateRequestQtyStepItems(allItems = false) {
    const domIds = requestQtyStepDomIds.length ? requestQtyStepDomIds : getRequestSourceDomIds();
    const indexes = allItems ? domIds.map((_, index) => index) : [requestQtyStepIndex];
    for (const index of indexes) {
        const item = findItemByDomId(domIds[index]);
        const data = getRequestQtyStepData(getRequestQtyStepUid(item, domIds[index]));
        data.spec = String(data.spec || '').trim() || 'N/A';
        const enteredQuantity = String(data.qty ?? '').trim();
        if (!enteredQuantity) continue;
        const quantity = parseAppNumber(enteredQuantity);
        if (!Number.isFinite(quantity) || quantity < 0) {
            requestQtyEmailStepActive = false;
            requestQtyStepIndex = index;
            renderRequestQtyStepCurrentItem();
            const input = document.querySelector('#qty-list-container .item-qty-input');
            input?.focus?.(); input?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            showToast('Invalid Quantity', 'Enter a nonnegative Quantity for Item ' + (index + 1) + ' or leave it blank.', true);
            return false;
        }
        data.qty = quantity === 0 ? '' : String(quantity);
    }
    return true;
}

export function scheduleSelectedRequestRepDirectoryRefresh() {
    const generation = requestMappingReadGeneration;
    const modalGeneration = requestModalAsyncGeneration;
    window.setTimeout(() => {
        if (generation !== requestMappingReadGeneration || modalGeneration !== requestModalAsyncGeneration) return;
        ensureRequestModalCustomerOptionsReady();
    }, 0);
}

function hasRequestCreateMappingTuple(context) {
    return !!(context?.customeridentityid && context.customername && context.consigneeidentityid && context.consigneename);
}

function resolveRequestCreateMapping(customer, folderId, selectedRep) {
    const context = resolveRequestCustomerContext(customer, folderId);
    const customerName = String(context?.customername || customer || '').trim();
    if (!customerName || isRequestNaCustomerValue(customerName)) {
        const pickedId = context?.request_selected_salesrep_id;
        const salesrepId = pickedId && pickedId !== JD_EXECUTIVE_SALESREP_ID
            ? pickedId : getRequestSelectedSalesrepId(selectedRep, false);
        return window.AgMetricRequestSubmission.resolveCustomerMappingPayload({
            customername: 'N/A', consigneename: 'N/A', request_selected_salesrep_id: salesrepId
        }, [], false) || getRequestCustomerContext(buildRequestModalNaCustomerOption(salesrepId));
    }
    const tuple = getRequestCustomerContext(context);
    // The server transaction verifies ownership of the tuple the user selected.
    return hasRequestCreateMappingTuple(tuple) ? tuple : null;
}

function captureRequestCreateRows(itemsDataObj, resolvedRequestEntriesOverride, formSnapshot) {
    const overrideEntries = Array.isArray(resolvedRequestEntriesOverride) ? resolvedRequestEntriesOverride.filter((entry) => entry && entry.item) : null;
    const sourceDomIds = overrideEntries ? overrideEntries.map((entry) => String(entry.domId || (entry.item && entry.item.DOM_ID) || '').trim()).filter(Boolean) : getRequestSourceDomIds();
    const requestSourceEntries = JSON.parse(JSON.stringify(overrideEntries || sourceDomIds.map((domId) => {
        const item = findItemByDomId(domId);
        const uid = String(firstNonEmptyValue(item && item.UNIQUE_ID, item && item.unique_id, '') || '').trim();
        return item ? { domId, item, data: (itemsDataObj && itemsDataObj[uid]) || {} } : null;
    }).filter(Boolean)));
    const visibleRequestSource = String(firstNonEmptyValue(
        typeof getCurrentVisibleViewId === 'function' ? getCurrentVisibleViewId() : '',
        activeDetailSourceView,
        lastView,
        ''
    ) || '').trim().toLowerCase();
    const requestSource = visibleRequestSource === 'av' ? 'av' : 'general';
    const selectionSnapshot = (formSnapshot.domIds.length ? formSnapshot.domIds : sourceDomIds).map(domId => ({
        domId, item: JSON.parse(JSON.stringify(findItemByDomId(domId))), sourceView: selectedItemSources.get(domId) || visibleRequestSource,
        selectionToken: getRequestSelectionIntentToken(domId)
    })).filter(source => source.item);
    return { requestSourceEntries, requestSource, selectionSnapshot };
}

function validateRequestCreateRows(requestSourceEntries, requestSource) {
    const requestCapabilities = getRequestEntryCapabilities();
    if (requestSourceEntries.length > 100) {
        showToast('Too Many Rows', 'Submit at most 100 rows per Request. Your cart and form are unchanged.', true);
        return false;
    }
    if (!requestSourceEntries.length) {
        showToast('Required', 'Please select a row first.', true);
        return false;
    }
    if (requestSource === 'av' ? !requestCapabilities?.canCreateAv : !requestCapabilities?.canCreateGeneral) {
        showToast('Request Restricted', requestSource === 'av' ? 'AV request entry is not available for this login.' : 'General and plant request entry is not available for this login.', true);
        return false;
    }
    return true;
}

function buildRequestCreateEvidence(item, dataObj) {
    const reusable = getRequestReusableData(item);
    const desiredSpec = normalizeRequestDesiredMeasurementValue(dataObj.spec) || 'N/A';
    const desiredCaliper = normalizeRequestDesiredMeasurementValue(dataObj.caliper);
    const requestNote = String(firstNonEmptyValue(dataObj.note, '') || '').trim();
    const requestSpec = reusable.spec || item.SPEC || item.spec || '';
    const requestCaliper = reusable.caliper || item.CALIPER || item.caliper || '';
    const requestMatch = firstNonEmptyValue(reusable.match,item.MATCH,item.match,item.LOC_MATCH_PCT,'');
    const requestPick = getRequestResolvedPickNoteValue(Object.assign({}, item, { REQ_PICK: reusable.pick, REQ_PIC_NOTE: reusable.pick, req_pic_note: reusable.pick, req_pick: reusable.pick }), item, { includeStandard: true });
    const requestPhotoLink = mergePhotoCsvList([reusable.photoLink,item.PHOTO_LINK,item.photo_link,item.SAVED_PHOTO_LINK]);
    const requestPhotoName = firstNonEmptyValue(reusable.photoName,item.PHOTO_NAME,item.photo_name,'');
    const requestAvNote = firstNonEmptyValue(reusable.avNote,item.AV_NOTE,item.av_note,'');
    return {
        desired_spec: desiredSpec,
        desired_caliper: desiredCaliper,
        est_ship: dataObj.estShip||'',
        req_reserve: dataObj.reserve||'NO',
        req_match: requestMatch!==''?requestMatch:null,
        req_spec: requestSpec||null,
        req_caliper: requestCaliper||null,
        req_pic_note: requestPick||null,
        req_comments: null,
        av_note: requestAvNote||null,
        req_photo_link: requestPhotoLink||'',
        req_photo_name: requestPhotoName||'',
        photos: requestPhotoLink?requestPhotoLink.split(',').map((url)=>({url:String(url||'').trim()})).filter((entry)=>entry.url):[],
        photo_url: getPhotoUrlList(requestPhotoLink)[0] || null,
        photo_date: firstNonEmptyValue(item.PHOTO_DATE,item.photo_date,item.DATE_COMPLETED,item.date_completed,null),
        spec: requestSpec||null,
        caliper: requestCaliper||null,
        loc_match_pct: requestMatch!==''?parseAppNumber(requestMatch):null,
        baseline_on_hand: parseAppNumber(firstNonEmptyValue(item.BASELINE_ON_HAND,item.baseline_on_hand,item.INITIAL_PTR,item.initial_ptr,item.PTRONHAND,item.ptronhand,'')),
        initial_photo_match_qty: parseAppNumber(firstNonEmptyValue(item.INITIAL_PHOTO_MATCH_QTY,item.initial_photo_match_qty,'')),
        loc_photo_match: parseAppNumber(firstNonEmptyValue(item.LOC_PHOTO_MATCH,item.loc_photo_match,item.LOC_MATCH_QTY,item.loc_match_qty,'')),
        pick_note: requestPick||null,
        sales_note: firstNonEmptyValue(item.SALES_NOTE,item.sales_note,null),
        photo_expires_at: firstNonEmptyValue(item.PHOTO_EXPIRES_AT,item.photo_expires_at,null),
        request_spec: desiredSpec||null,
        request_caliper: desiredCaliper||null,
        estimated_ship: dataObj.estShip||null,
        reserve_flag: dataObj.reserve||'NO',
        request_notes: requestNote||null,
        ...(requestNote ? { request_note: requestNote } : {})
    };
}

function buildRequestCreateMetrics(item, dataObj) {
    const requestRawQty = window.AgMetricRequestSubmission.normalizeOptionalQuantity(dataObj.qty);
    const requestQtyNumber = parseAppNumber(requestRawQty);
    const requestEffectiveQty = requestQtyNumber!=null&&requestQtyNumber>0?requestQtyNumber:25;
    const requestUnitListPrice = Math.max(0,parseAppNumber(firstNonEmptyValue(item.LISTPRICE,item.listprice,item.UNIT_LIST_PRICE,item.unit_list_price,0))||0);
    return {
        req_qty: requestQtyNumber === 0 ? null : requestRawQty,
        request_qty: requestQtyNumber!=null&&requestQtyNumber>0?requestQtyNumber:null,
        effective_qty: requestEffectiveQty,
        is_default_qty: requestQtyNumber==null||requestQtyNumber<=0,
        unit_list_price: requestUnitListPrice,
        line_dollar_value: Math.round(requestEffectiveQty*requestUnitListPrice*100)/100,
        on_hand: parseAppNumber(firstNonEmptyValue(item.PTRONHAND,item.ptronhand,item.ON_HAND,item.on_hand,'')),
        review_qty: parseAppNumber(firstNonEmptyValue(item.PTRREVIEWED,item.ptrreviewed,item.REVIEW_QTY,item.review_qty,'')),
        available_qty: parseAppNumber(firstNonEmptyValue(item.PTRAVAILABLE,item.ptravailable,item.AVAILABLE_QTY,item.available_qty,'')),
        open_stock: parseAppNumber(firstNonEmptyValue(item.S_LTS,item.s_lts,item.OPEN_STOCK,item.open_stock,'')),
        loc_on_hand: parseAppNumber(firstNonEmptyValue(item.LOC_ON_HAND,item.loc_on_hand,item.PTRONHAND,item.ptronhand,'')),
        pri: firstNonEmptyValue(item.PRIORITY,item.priority,null),
        flag_color: firstNonEmptyValue(item.FLAG_COLOR,item.flag_color,item.FIELDTAGCOLOR,item.fieldtagcolor,item.FIELD_TAG_COLOR,item.field_tag_color,null),
        ns_grade: firstNonEmptyValue(item.NS_GRADE,item.ns_grade,item.QUALITYCODE,item.qualitycode,null),
        ld_flag: firstNonEmptyValue(item.LD_FLAG,item.ld_flag,item.LD,item.ld,null),
        hold_stop_code: firstNonEmptyValue(item.HOLDSTOPCODE,item.holdstopcode,null),
        hold_stop_reason: firstNonEmptyValue(item.HOLDSTOPREASON,item.holdstopreason,null),
        hold_stop_since: firstNonEmptyValue(item.HOLDSTOPBEGINDATE,item.holdstopbegindate,item.HOLD_STOP_SINCE,item.hold_stop_since,null),
        source_snapshot: {unique_id:item.UNIQUE_ID,itemcode:item.ITEMCODE,locationcode:item.LOCATIONCODE,lotcode:item.LOTCODE,commonname:item.COMMONNAME,contsize:item.CONTSIZE}
    };
}

function buildRequestCreateRow(entry, submission) {
    const item = resolveCanonicalInventoryRow(entry.item) || entry.item;
    const dataObj = entry.data || submission.itemsDataObj?.[entry.item.UNIQUE_ID] || {};
    const { requestSource, requestedBy, folderId, cust, selectedRepName, requestMappingPayload, requestRecipientEmails } = submission;
    const sourceAppTabAssignment = String(firstNonEmptyValue(item.APP_TAB_ASSIGNMENT, item.app_tab_assignment, item.MASTER_APP_TAB_ASSIGNMENT, item.master_app_tab_assignment, '') || '').trim().toLowerCase();
    const requestStatus = 'Pending';
    const requestCompletedAt = null;
    const newReqId = 'REQ-' + Date.now().toString(36) + Math.random().toString(36).substring(2);
    const row = {
        unique_id: newReqId,
        master_id: item.UNIQUE_ID,
        commonname: item.COMMONNAME,
        contsize: item.CONTSIZE,
        locationcode: item.LOCATIONCODE,
        lotcode: item.LOTCODE,
        itemcode: item.ITEMCODE,
        ptravailable: item.PTRAVAILABLE,
        season_supply: item.SEASONSUPPLY,
        priority: item.PRIORITY,
        qualitycode: item.QUALITYCODE,
        field_tag_color: item.FIELDTAGCOLOR,
        requested_by: requestedBy,
        request_folder: folderId,
        req_customer: cust,
        ...buildRequestCreateEvidence(item, dataObj),
        req_archived: false,
        date_completed: requestCompletedAt,
        req_status: requestStatus,
        app_tab_assignment: sourceAppTabAssignment||null,
        master_app_tab_assignment: sourceAppTabAssignment||null,
        sales_rep: selectedRepName,
        customer_name: firstNonEmptyValue(requestMappingPayload.customername,cust,'Unknown Customer'),
        consignee_name: firstNonEmptyValue(requestMappingPayload.consigneename,'N/A'),
        customer_consignee_label: [firstNonEmptyValue(requestMappingPayload.customername,cust,'Unknown Customer'),firstNonEmptyValue(requestMappingPayload.consigneename,'N/A')].join(' / '),
        recipient_emails: requestRecipientEmails,
        status: requestStatus,
        ...buildRequestCreateMetrics(item, dataObj),
        request_source: requestSource
    };
    Object.assign(row, requestMappingPayload);
    applyRequestCreatorAuditFields(row, submission.requestCreatorAudit);
    return row;
}

async function isRequestCreateSchemaReady() {
    if (navigator.onLine !== false && !(await ensureRequestSchemaCompatible())) {
        showToast('Request Entry Paused', 'The hosted request schema is not compatible with this app build. Your selections are still here; try again after the database update.', true);
        if (window.__gncOpsPilot && typeof window.__gncOpsPilot.captureFailure === 'function') {
            window.__gncOpsPilot.captureFailure('request_schema_mismatch', new Error('REQUEST_SCHEMA_MISMATCH'));
        }
        return false;
    }
    return true;
}

export async function submitRequestCreateBatch(existingFolderId, existingCust, itemsDataObj, resolvedRequestEntriesOverride = null) {
    const ownerKey = getRequestSubmissionOwnerKey();
    const generation = requestSubmissionGeneration;
    const formSnapshot = captureRequestSubmissionForm();
    const rejected = getActiveRequestSubmissionEntry();
    const existingFolder = String(existingFolderId || '').trim();
    const selectedRepName = resolveRequestRepSelectionForCurrentUser(String(tempSelectedReqRep || getDefaultRequestRepName() || '').trim(), { showToast: false });
    if (!selectedRepName) {
        showToast('Required', 'Please choose a sales rep for this request.', true);
        return false;
    }
    tempSelectedReqRep = selectedRepName;
    syncRequestEmailChainSelectionFromInputs();
    const requestCreatorAudit = selectedRepName ? buildRequestCreatorAuditInfo(selectedRepName) : null;
    const requestedBy = String(firstNonEmptyValue(requestCreatorAudit && requestCreatorAudit.creatorUsername, currentUser, '') || '').trim();

    const emailChainRecipients = canUseRequestEmailChainPicker() ? getRequestEmailChainSelectedRecipients() : [];
    const { requestSourceEntries, requestSource, selectionSnapshot } = captureRequestCreateRows(itemsDataObj, resolvedRequestEntriesOverride, formSnapshot);
    if (!validateRequestCreateRows(requestSourceEntries, requestSource)) return false;
    const unresolved = Array.from(requestSubmissionEntries.values()).find(entry => entry.ownerKey === ownerKey
        && !['review-required', 'mapping-review'].includes(entry.status)
        && (entry.selectionSnapshot || []).some(source => selectionSnapshot.some(selected => selected.domId === source.domId)));
    if (unresolved) {
        restoreRequestSubmissionForm(unresolved);
        return await performRequestSubmission(unresolved, { navigate: true });
    }
    const requestMappingPayload = resolveRequestCreateMapping(existingCust, existingFolder, selectedRepName);
    if (!requestMappingPayload) {
        showToast('Request Details Incomplete', 'The selected sales rep or customer details could not be identified. Your cart and form are still here.', true);
        return false;
    }
    if (!(await isRequestCreateSchemaReady())) return false;
    if (!ownerKey || ownerKey !== getRequestSubmissionOwnerKey() || generation !== requestSubmissionGeneration) return false;
    const cust = existingCust || requestMappingPayload.customername;
    const folderId = existingFolder || createStandardRequestFolderName(cust, requestMappingPayload, selectedRepName);
    const requestRecipientEmails = emailChainRecipients.map(recipient => String(firstNonEmptyValue(recipient?.email, recipient?.address, '') || '').trim().toLowerCase()).filter(Boolean);
    const submission = { itemsDataObj, requestSource, requestedBy, folderId, cust, selectedRepName, requestMappingPayload, requestRecipientEmails, requestCreatorAudit };
    const requests = requestSourceEntries.map(entry => buildRequestCreateRow(entry, submission));
    const outboxEntry = {
        clientBatchId: createStableClientBatchId(), ownerKey, requestSource, requests,
        supersedesBatchId: rejected && ['review-required', 'mapping-review'].includes(rejected.status) ? rejected.clientBatchId : null,
        folderId, customer: cust, requestedBy, createdAt: new Date().toISOString(),
        status: 'pending', attempts: 0, selectionSnapshot, formSnapshot, emailChainRecipients
    };
    return await performRequestSubmission(outboxEntry, { navigate: true });
}

let retainedRequestFolderSelection = null;

export function clearRetainedRequestFolderSelection() {
    retainedRequestFolderSelection = null;
}

export function getSelectedExistingRequestFolderGroups(groups = null) {
    const source = Array.isArray(groups) ? groups : buildExistingRequestFolderCustomerGroups(tempSelectedReqRep);
    const owner = getRequestModalLookupOwnerSignature();
    const previous = retainedRequestFolderSelection?.owner === owner
        && retainedRequestFolderSelection.rep === tempSelectedReqRep ? retainedRequestFolderSelection : null;
    const customerKey = tempExistingReqSelectedCustomer;
    const consigneeKey = tempExistingReqSelectedConsignee;
    const sameCustomer = previous?.customerGroup?.key === customerKey;
    const customerGroup = source.find(group => group.key === customerKey) || (sameCustomer ? previous.customerGroup : null);
    const consigneeGroup = customerGroup?.consignees?.find(group => group.key === consigneeKey)
        || (sameCustomer && previous.consigneeGroup?.key === consigneeKey ? previous.consigneeGroup : null);
    retainedRequestFolderSelection = customerGroup ? { owner, rep: tempSelectedReqRep, customerGroup, consigneeGroup } : null;
    return { customerGroup, consigneeGroup };
}
