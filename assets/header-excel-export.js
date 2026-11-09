function getHeaderExcelExportCommand(view) {
    if (view === 'av') return exportCurrentAVToExcel;
    if (view === 'drive') return exportCurrentDriveModeToExcel;
    if (view === 'docks') return () => exportOperationalRows('docks');
    if (view === 'request' && ['suspend-tag', 'pending', 'reps'].includes(activeReqTab)) {
        return () => exportOperationalRows('request');
    }
    if (view === 'sales-office') return exportCurrentSalesOfficeToExcel;
    if (view === 'request-history') return exportRequestHistoryReportToExcel;
    if (view !== 'managers') return null;
    if (activeHomeTab === MANAGER_EVAL_REPORTS_2_VIEW) return exportManagerEvalReport2ToExcel;
    if (activeHomeTab === MANAGER_EVAL_REPORTS_VIEW) return exportManagerEvalReportToExcel;
    if (activeHomeTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW) return exportManagerAssignedItemsToExcel;
    if (activeHomeTab === MANAGER_TABLE_MANAGEMENT_VIEW) return exportSelectedManagerTable;
    return null;
}

function exportSelectedManagerTable() {
    const control = document.querySelector('#manager-table-management-root [data-export]');
    if (control) control.click();
    else showToast('Export to Excel', 'Open a table to export its rows.');
    return false;
}

function syncHeaderExcelExport(view) {
    const button = document.getElementById('global-excel-export');
    if (!button) return;
    button.hidden = !getHeaderExcelExportCommand(view);
    if (view !== 'av') button.removeAttribute('title');
}

function exportActiveHeaderRows() {
    return getHeaderExcelExportCommand(getCurrentVisibleViewId())?.() ?? false;
}

function rememberOperationalExport(view, rows) {
    const root = document.getElementById('view-' + view);
    if (!root) return;
    root.agdataExport = { owner:getSupabaseReadIdentityScope(), tab:view === 'request' ? activeReqTab : dockViewMode, rows };
}

function exportOperationalRows(view) {
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

function mountGlobalHeaderChrome(chromeState, { searchRow, title, searchSlot, inlineTitle, homeIdentityOnly, keepSearchMounted }) {
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
