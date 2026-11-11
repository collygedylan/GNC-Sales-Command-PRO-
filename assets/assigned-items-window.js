function renderManagerAssignedFallbackRows(rows = [], preview = false) {
    const state = getManagerAssignedColumnState(), limit = 100;
    const columns = getManagerAssignedColumnDefinitions().slice(0, 9), editable = canManageEvalItemcodeAssignments();
    const roster = editable && !preview ? getManagerAssignableOwnerUsers() : [];
    const options = new Map();
    const ownerOptions = value => {
        if (!options.has(value)) options.set(value, getManagerEvalAssigneeOptionsHtml(value, roster));
        return options.get(value);
    };
    return '<div data-assigned-fallback style="max-height:65vh;overflow:auto"' + (preview ? '' : ' onscroll="appendManagerAssignedFallbackPage(this)"') + '><table class="ai-primary-columns"><colgroup>' + (editable ? '<col class="ai-select-col">' : '')
        + columns.map(([field]) => '<col data-field="' + field + '">').join('') + '</colgroup><thead><tr>' + (editable ? '<th>Select</th>' : '')
        + columns.map(([field,label]) => '<th>' + (preview ? escapeHtml(label) : renderManagerAssignedColumnTrigger(field,label)) + '</th>').join('') + '</tr></thead><tbody>'
        + assignedFallbackSpacer(state.fallbackStart || 0, columns.length + Number(editable))
        + rows.slice(state.fallbackStart || 0, (state.fallbackStart || 0) + limit)
            .map(row => assignedFallbackRowHtml(row, { state, columns, editable, preview, ownerOptions })).join('') + assignedFallbackSpacer(Math.max(0, rows.length - (state.fallbackStart || 0) - limit), columns.length + Number(editable)) + '</tbody></table>' + (!preview && rows.length > limit ? '<button type="button" data-assigned-more onclick="appendManagerAssignedFallbackPage(this.parentElement,true)">Show more items</button>' : '') + '</div>';
}

function appendManagerAssignedFallbackPage(scroller, force = false) {
    const state = getManagerAssignedColumnState();
    const rows = getManagerAssignedSelectionSnapshot().rows;
    const start = force ? (state.fallbackStart || 0) + 100 : Math.max(0, Math.floor(scroller.scrollTop / 48) - 10);
    if (state.fallbackStart === start || state.fallbackFrame) return;
    state.fallbackFrame = requestAnimationFrame(() => {
        state.fallbackFrame = 0;
        if (!scroller.isConnected || state !== getManagerAssignedColumnState()) return;
        state.fallbackStart = Math.min(start, Math.max(0, rows.length - 100));
        const template = document.createElement('template');
        template.innerHTML = renderManagerAssignedFallbackRows(rows);
        scroller.querySelector('tbody').replaceChildren(...template.content.querySelector('tbody').childNodes);
    });
}

async function mountManagerAssignedItemsView(host, rows = null, totalRows = null) {
    if (!host || !canViewAssignedItemsExport()) return null;
    const state = getManagerAssignedColumnState();
    const visibleRows = Array.isArray(rows) ? rows : getManagerAssignedItemsDisplayRows();
    const fullSourcesReady = isDatasetLoaded('master', 'full') && isDatasetLoaded('warehouseAssignedItems', 'full');
    if (!visibleRows.length && !fullSourcesReady) return state.view || null;
    let pageSource = null;
    if (!host.isConnected || !canViewAssignedItemsExport()) return null;
    state.viewPageSource = pageSource;
    state.viewRows = pageSource ? [] : rows;
    state.viewTotalRows = pageSource ? null : totalRows;
    const restoreScroll = state.restoreScroll ? state.scroll : null;
    if (state.viewHost === host && state.view) { updateManagerAssignedItemsView(); return state.view; }
    if (state.viewHost !== host) destroyManagerAssignedItemsView();
    state.viewHost = host;
    const ticket = state.viewTicket = (state.viewTicket || 0) + 1;
    if (!document.getElementById('manager-assigned-items-style')) {
        const link = document.createElement('link');
        link.id = 'manager-assigned-items-style'; link.rel = 'stylesheet';
        link.href = `./assets/assigned-items.css?v=${encodeURIComponent(APP_VERSION)}`;
        document.head.appendChild(link);
    }
    try {
        state.viewModule ||= import(new URL(`./assets/assigned-items-table.js?v=${encodeURIComponent(APP_VERSION)}`, document.baseURI).href);
        const module = await state.viewModule;
        if (state !== getManagerAssignedColumnState() || state.viewTicket !== ticket || !host.isConnected || !canViewAssignedItemsExport()) return null;
        state.view = module.mountAssignedItems(host, getManagerAssignedItemsViewProps(rows, totalRows));
        scheduleAssignedMountedScroll(state, ticket, host, restoreScroll);
        return state.view;
    } catch {
        if (state !== getManagerAssignedColumnState() || state.viewTicket !== ticket || !host.isConnected) return null;
        state.viewModule = null;
        globalThis.GncRuntimeWatchdog?.captureHandled?.('assigned_items_module_fallback');
        const update = () => { const props = getManagerAssignedItemsViewProps(); host.dataset.logicalRowCount = String(props.rows.length); host.innerHTML = renderManagerAssignedFallbackRows(props.rows); };
        state.view = { update, destroy() {} }; update(); return state.view;
    }
}

function assignedFallbackSpacer(count, columns) {
    return count > 0 ? '<tr aria-hidden="true"><td colspan="' + columns + '" style="padding:0;height:' + count * 48 + 'px"></td></tr>' : '';
}

function scheduleAssignedItemsPrewarm() {
    if (typeof currentUser !== 'string' || !currentUser || !canViewAssignedItemsExport() || !fullInventory.length) return;
    const state = getManagerAssignedColumnState();
    if (state.prewarmPending) return;
    state.prewarmPending = true;
    setTimeout(() => {
        state.prewarmPending = false;
        if (state !== getManagerAssignedColumnState() || !canViewAssignedItemsExport()) return;
        prewarmAssignedItems(state);
    }, 0);
}

function prewarmAssignedItems(state) {
    const rows = getManagerAssignedItemsDisplayRows();
    rememberManagerAssignedColumnLabels(rows);
    state.viewModule ||= import(new URL('./assets/assigned-items-table.js?v=' + encodeURIComponent(APP_VERSION), document.baseURI).href);
    state.viewModule.catch(() => { if (state === getManagerAssignedColumnState()) state.viewModule = null; });
}

function openAssignedItemsFirstFrame(state) {
    const host = document.getElementById('managers-content');
    if (!host) return;
    state.fallbackStart = 0;
    const input = fullInventory.length ? fullInventory : warehouseAssignedItemsInventory;
    const warm = state.displayCache?.input === input && state.displayCache.signature === getManagerAssignedDisplaySignature(state, input === fullInventory, getManagerItemLowStockTargetsState().revision);
    if (warm) {
        state.opening = null;
        return renderManagers();
    }
    const ticket = state.opening = {};
    const rows = getManagerAssignedItemsDisplayRows(input.slice(0, 100), { useMaster: input === fullInventory });
    host.innerHTML = renderManagerTableManagementWorkspace(renderManagerAssignedFallbackRows(rows, true), 'assigned-items');
    requestAnimationFrame(() => setTimeout(() => finishAssignedItemsFirstFrame(state, ticket), 0));
}

function finishAssignedItemsFirstFrame(state, ticket) {
    if (state !== getManagerAssignedColumnState() || state.opening !== ticket
        || activeHomeTab !== MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW || !isViewVisible('managers') || !canViewAssignedItemsExport()) return;
    prewarmAssignedItems(state);
    state.opening = null;
    renderManagers();
}

function assignedFallbackRowHtml(row, { state, columns, editable, preview, ownerOptions }) {
            const code = buildManagerEvalAssignmentKey(row.ITEMCODE), attr = escapeHtml(JSON.stringify(code));
            return '<tr style="height:48px;white-space:nowrap" data-manager-assigned-item-row="' + escapeHtml(code) + '">'
                + (editable ? '<td><input type="checkbox" aria-label="Select ' + escapeHtml(code) + ' for bulk assignment" data-itemcode="' + escapeHtml(code) + '"' + (preview ? ' disabled' : '') + (managerEvalAssignmentSelection.has(code) ? ' checked' : '') + ' onchange="toggleManagerEvalAssignmentItem(' + attr + ',&quot;&quot;,this.checked);updateManagerAssignedItemsView()"></td>' : '')
                + columns.map(([field]) => assignedFallbackCellHtml(row, field, code, attr, { state, editable, preview, ownerOptions })).join('') + '</tr>';
}

function assignedFallbackCellHtml(row, field, code, attr, { state, editable, preview, ownerOptions }) {
    if (field === 'DEFAULT_ASSIGNEDTO' && editable && !preview) {
        return '<td><select aria-label="Itemcode Default Owner ' + escapeHtml(code) + '" data-default-owner="' + escapeHtml(code)
            + '" onchange="assignManagerCheckedItemcodes(' + attr + ',this.value)">'
            + ownerOptions(state.defaultDrafts?.[code]?.assignedto ?? row[field]) + '</select></td>';
    }
    return '<td>' + escapeHtml(row[field] || (field === 'LOCATIONCODE' ? '—' : row[field] ?? '')) + '</td>';
}

function restoreAssignedMountedScroll(state, ticket, host, restoreScroll) {
    if (state !== getManagerAssignedColumnState() || state.viewTicket !== ticket || !host.isConnected) return;
    schedulePostRenderMainAreaScrollRestore('managers', 'assigned-items-mounted', restoreScroll);
}

function scheduleAssignedMountedScroll(state, ticket, host, restoreScroll) {
    if (restoreScroll == null || state.viewUi?.anchor) return;
    requestAnimationFrame(() => requestAnimationFrame(() => restoreAssignedMountedScroll(state, ticket, host, restoreScroll)));
}
