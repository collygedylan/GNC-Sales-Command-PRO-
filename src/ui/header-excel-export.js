export function inventoryExcelBarHtml(scope) {
    const state = getInventoryExcelState(scope);
    const fields = getVisibleInventoryExcelFields(scope);
    const headers = fields.map(([key, label]) => renderInventoryExcelHeader(scope, state, key, label));
    const chips = fields.filter(([key]) => state.filters[key]).map(([key, label]) =>
        '<button type="button" data-field="' + key + '" onclick="return clearInventoryExcelFilter(\'' + scope + '\',this.dataset.field)">'
        + escapeHtml(label) + ': ' + state.filters[key].size + ' ×</button>');
    return '<div class="inventory-excel-fields">' + headers.join('') + '</div><div class="inventory-excel-chips">'
        + chips.join('') + '</div><div data-excel-popover></div>';
}

function renderInventoryExcelHeader(scope, state, key, label) {
    const summary = (state.filters[key] ? state.filters[key].size + ' selected' : 'All') + ' ▾';
    const title = escapeHtml(label);
    const trigger = '<button type="button" data-field="' + key + '" onclick="return openInventoryExcelFilter(\'' + scope + '\',this.dataset.field';
    if (scope === 'av') {
        return '<div class="inventory-excel-field">' + trigger + ',this)"><span>' + title + '</span><span>' + summary + '</span></button></div>';
    }
    return '<div class="inventory-excel-field"><span>' + title + '</span>' + trigger + ')">' + summary + '</button></div>';
}

export function getHeaderExcelExportCommand(view) {
    if (view === 'av') return exportCurrentAVToExcel;
    if (view === 'drive') return exportCurrentDriveModeToExcel;
    if (view === 'docks') return () => exportOperationalRows('docks');
    if (view === 'request') {
        return () => exportOperationalRows('request');
    }
    if (view === 'sales-office') return exportCurrentSalesOfficeToExcel;
    if (view === 'request-history') return exportRequestHistoryReportToExcel;
    if (view === 'smart-moves') return exportSmartMoveRows;
    if (view === 'hl-order') return exportHlCurrentRows;
    if (view === 'low-stock') return () => exportManagerReportSurface('ncr','Low Stock');
    if (view !== 'managers') return getAdditionalViewExportCommand(view);
    if (activeHomeTab === MANAGER_EVAL_REPORTS_2_VIEW) return exportManagerEvalReport2ToExcel;
    if (activeHomeTab === MANAGER_EVAL_REPORTS_VIEW) return exportManagerEvalReportToExcel;
    if (activeHomeTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW) return exportManagerAssignedItemsToExcel;
    if (activeHomeTab === MANAGER_TABLE_MANAGEMENT_VIEW) return exportSelectedManagerTable;
    if (isManagerApprovalTab(activeHomeTab)) return () => exportManagerReportSurface('approval',getManagerModuleMeta(activeHomeTab).label);
    return getManagerTableExcelCommand();
}

function exportSelectedManagerTable() {
    return getManagerTableExcelCommand()?.() ?? false;
}

export function syncHeaderExcelExport(view) {
    scheduleAssignedItemsPrewarm();
    const button = document.getElementById('global-excel-export');
    if (!button) return;
    if (button.parentElement) button.parentElement.dataset.exportView = view || '';
    button.hidden = !getHeaderExcelExportCommand(view);
    if (view !== 'av') button.removeAttribute('title');
}

export function exportActiveHeaderRows() {
    const command = getHeaderExcelExportCommand(getCurrentVisibleViewId());
    if (!command) {
        showToast('Export to Excel', 'Open a table or report to export.');
        return false;
    }
    setExcelExportFeedback('Exporting…', true);
    requestAnimationFrame(() => setTimeout(() => runActiveExcelExport(command), 0));
    return false;
}

async function runActiveExcelExport(command) {
    try {
        await command();
    } catch (error) {
        setExcelExportFeedback('Export failed — retry');
        showToast('Export Failed', String(error?.message || error), true);
    } finally {
        const button = document.getElementById('global-excel-export');
        if (button) button.disabled = false;
    }
}

export function rememberOperationalExport(view, rows) {
    const root = document.getElementById('view-' + view);
    if (!root) return;
    root.agdataExport = { owner:getSupabaseReadIdentityScope(), tab:view === 'request' ? activeReqTab : dockViewMode, rows };
}

function exportOperationalRows(view) {
    const taskScope = { 'eval-work':'evalwork','location-work':'locationwork',moves:'locationwork',recount:'recount','shear-list':'queueshear' }[activeReqTab];
    if (view === 'request' && taskScope) return exportInventoryExcelScope(taskScope,'Que ' + activeReqTab);
    const current = document.getElementById('view-' + view)?.agdataExport;
    if (!isViewVisible(view) || current?.owner !== getSupabaseReadIdentityScope() || current?.tab !== (view === 'request' ? activeReqTab : dockViewMode) || !current?.rows?.length) {
        showToast('Export Excel','No matching rows in this view.'); return false;
    }
    const fields = ['ITEMCODE', 'COMMONNAME', 'CONTSIZE', 'LOCATIONCODE', 'LOTCODE', 'CONSIGNEENAME', 'SALESREPNAME', 'PLANSTART'];
    const columns = fields.map(key => ({ label: key, value: row => row[key] ?? row[key.toLowerCase()] ?? '' }));
    columns.push(
        { label: 'Dock', value: row => row.DOCK_NUM || row.DOCK || row.dock || '' },
        { label: 'Drop', value: getDockStopOrDropValue },
        { label: 'Quantity', value: row => view === 'docks' || activeReqTab === 'suspend-tag' ? getDockDisplayQty(row) : row.REQ_QTY ?? row.req_qty ?? '' },
        { label: 'Spec', value: row => row.REQ_SPEC || row.DOCK_SPEC || row.SPEC || row.spec || '' },
        { label: 'Status', value: row => row.ORDER_STATUS || row.REQ_STATUS || row.status || '' }
    );
    if (view === 'request') columns.push(...buildQueueMetricExportColumns(activeReqTab === 'suspend-tag'));
    downloadExcelWorkbook(columns, current.rows, view === 'docks' ? 'Docks' : 'Que', '', 'operational-' + view, null, { exactColumns: true });
    return false;
}

function buildQueueMetricExportColumns(suspend) {
    const template = document.createElement('template');
    const values = new WeakMap();
    const labels = ['On Hand', 'Review', 'Available', 'Open Stock', 'Loc Photo Match', 'Loc On Hand'];
    const getMetrics = row => {
        if (values.has(row)) return values.get(row);
        template.innerHTML = suspend
            ? renderSuspendCardMetrics(row, isFalseBlockLocation(row.LOCATIONCODE || row.locationcode))
            : buildQueueInventoryMetricsHtml(row, 'request', { layout: 'row', compact: true });
        const metrics = Array.from(template.content.querySelectorAll('.app-card-qty-value'), node => node.textContent.trim());
        values.set(row, metrics);
        return metrics;
    };
    return labels.map((label, index) => ({ label, value: row => getMetrics(row)[index] || '' }));
}

export function mountGlobalHeaderChrome(chromeState, { searchRow, title, searchSlot, inlineTitle, homeIdentityOnly, keepSearchMounted }) {
    const headerUser = document.getElementById('header-user');
    const headerVersion = document.getElementById('header-version');
    if (headerUser) headerUser.innerText = currentUserDisplay || currentUser || 'User';
    if (headerVersion) headerVersion.innerText = `AgData v${APP_VERSION}`;
    syncGoogleScriptButton();
    if (title) title.innerText = chromeState.resolvedTitle;
    lastGlobalHeaderChromeSignature = chromeState.signature;
    if (!keepSearchMounted) {
        restoreGlobalHeaderSearchContainers();
        if (searchSlot) clearNodeChildren(searchSlot);
    }
    if (homeIdentityOnly) {
        syncGlobalHeaderSearchOwnership(null);
        if (searchSlot) searchSlot.classList.add('hidden');
        if (inlineTitle) inlineTitle.classList.add('hidden');
        if (searchRow) searchRow.classList.add('hidden');
    } else if (searchSlot && chromeState.searchContainer && chromeState.searchVisible) {
        if (searchRow) searchRow.classList.remove('hidden');
        searchSlot.classList.remove('hidden');
        if (!keepSearchMounted) searchSlot.appendChild(chromeState.searchContainer);
        syncGlobalHeaderSearchOwnership(chromeState.searchContainer);
        if (inlineTitle) inlineTitle.classList.add('hidden');
    } else {
        syncGlobalHeaderSearchOwnership(null);
        if (searchSlot) searchSlot.classList.add('hidden');
        if (inlineTitle) inlineTitle.classList.remove('hidden');
        if (searchRow) searchRow.classList.remove('hidden');
    }
}

function exportSmartMoveRows() {
    const model = buildSalesIntelligenceModel();
    const mode = getSalesIntelligenceMode();
    const selectedRep = getSalesIntelligenceSelectedRep(model);
    const repCards = mode === 'rep' ? buildSalesRepIntelligenceCards(model, selectedRep) : null;
    const special = mode === 'admin' && ['hold-risk', 'shear-guard'].includes(salesIntelligenceFilters.move);
    const candidates = special ? buildSmartHoldCards(model) : mode === 'admin' ? model.moveCards : [...repCards.missed, ...repCards.customers];
    const filtered = applyInventoryExcelFilters('smart', candidates.filter(salesIntelligenceCardMatchesFilters));
    const rows = mode === 'admin' && salesIntelligenceFilters.move === 'all'
        ? prioritizeSalesIntelligenceCards(filtered) : filtered.slice().sort((left, right) => right.value - left.value);
    const columns = ['title', 'reason', 'value'].map(key => ({ label: key, value: card => card[key] ?? '' }));
    columns.push(...getDriveReportExportColumns().map(column => ({ ...column, value: card => column.value(card.row || card) })));
    return downloadExcelWorkbook(columns, rows, 'Smart Sales and Move Intelligence', '', 'Smart_Sales_Move');
}

function getAdditionalViewExportCommand(view) {
    const scope = view === 'shear-list' ? 'shear' : '';
    if (scope) return () => exportInventoryExcelScope(scope, view);
    const root = document.getElementById('view-' + view);
    const control = Array.from(root?.querySelectorAll('button') || []).find(button =>
        button.id !== 'global-excel-export' && !button.closest('.hidden')
        && /export.*(?:excel|csv)|excel.*export/i.test(button.textContent));
    return control ? () => control.click() : null;
}

async function exportManagerReportSurface(surface, title) {
    const owner = getSupabaseReadIdentityScope();
    const query = buildManagerReportPageQuery(surface,'rows',{filters:{projection:'full',cardRows:false}});
    const result = await getManagerReportPageController().readComplete(query);
    if (owner !== getSupabaseReadIdentityScope()) throw staleSupabaseReadScopeError();
    const rows = result.rows.map(normalizePagedManagerRow);
    return downloadExcelWorkbook(getDriveReportExportColumns(), rows, title, managersSearchTerm, title);
}

function exportHlCurrentRows() {
    if (!canUseHlOrder()) return false;
    return exportObjectRows('HL Order ' + hlOrderTab, getHlExcelRows());
}

function exportInventoryExcelScope(scope, title) {
    const state = getInventoryExcelState(scope);
    const rows = applyInventoryExcelFilters(scope, state.rows);
    return downloadExcelWorkbook(getDriveReportExportColumns(), rows, title, '', title);
}

function getHlExcelRows() {
    if (hlOrderTab === 'needed') return getHlOrderNeededGroups()
        .filter(group => !hlOrderDetailKey || group.key === hlOrderDetailKey).flatMap(group => group.rows);
    if (hlOrderTab === 'cart') return hlOrderStateData?.draft || [];
    if (hlOrderTab === 'restocking') return getHlRestockItems();
    if (['removed','needs-review'].includes(hlOrderTab)) {
        const status = hlOrderTab === 'removed' ? 'removed' : 'needs_review';
        return (hlOrderStateData?.dispositions || []).filter(row => row.status === status);
    }
    return (hlOrderStateData?.orders || []).filter(row => !hlOrderTrackingId || row.id === hlOrderTrackingId);
}
