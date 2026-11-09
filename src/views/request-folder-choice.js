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
        return getRequestCustomerContext(buildRequestModalNaCustomerOption(getRequestSelectedSalesrepId(tempSelectedReqRep)));
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
    if (!isReservedRequestNaChoice(context) || context.request_selected_salesrep_id) return { ...context };
    return { ...context, request_selected_salesrep_id: getRequestSelectedSalesrepId(tempSelectedReqRep) };
}

export function processCustStep() {
    const cust = document.getElementById('cust-search-input').value.trim();
    const context = tempRequestCustomerSelectedContext;
    const reserved = !!tempSelectedReqRep && isReservedRequestNaChoice(context) && !context.request_selected_salesrep_id;
    if (cust !== tempRequestCustomerSelectedFinalLabel || !(reserved || isCurrentRequestCustomerContext(context))) {
        showToast('Select Mapped Consignee', 'Choose an active customer and consignee mapped to this sales rep.', true);
        return false;
    }
    return goToQtyStep(null, cust, 'step-2-cust', false);
}
