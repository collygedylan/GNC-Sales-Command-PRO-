function renderEvalReport2PickerMarkup(reports, selected, countSignals, escape) {
    const options = reports.map(report => renderEvalReport2OptionMarkup(report,selected,escape)).join('');
    return `<fieldset class="manager-eval2-report-selection" data-manager-eval2-report-picker
        data-eval-report-counts-ready="${countSignals.ready}">
        <legend>Choose reports</legend>
        <p>Select one or more reports. Apply shows rows matching any checked report.</p>
        <div class="manager-eval2-report-options">${options}</div>
        <div class="manager-eval2-report-actions">
            <button type="button" onclick="return setManagerEvalReport2PickerChecks(this,true)">Select All</button>
            <button type="button" onclick="return setManagerEvalReport2PickerChecks(this,false)">Clear All</button>
            <button type="button" onclick="return applyManagerEvalReport2ReportPicker(this)">Apply Reports</button>
            <button type="button" onclick="return showEvalAggregateDashboard()">Report overview</button>
            <button type="button" onclick="return openEvalAggregateReport('field-audit')">Season Y ≤ 2026 Field Audit</button>
        </div>
    </fieldset>`;
}

function renderEvalReport2OptionMarkup(report,selected,escape) {
    return `<label data-eval2-report-option="${escape(report.id)}" data-eval-report-count="${report.count}">
        <input type="checkbox" data-eval2-report-id value="${escape(report.id)}"
            ${selected.includes(report.id) ? 'checked' : ''} onchange="return toggleManagerEvalReport2ReportPicker(this)">
        <span>${escape(report.label)} (${escape(String(report.count))})</span>
    </label>`;
}

function renderManagerEvalReport2OptionalFilters() {
    const rows = getManagerEvalReport2Rows();
    const options = useManagerReportPages('eval2')
        ? {seasons:[],contSizes:[],...getManagerReportPageController().state('eval2').metadata.filterOptions}
        : getManagerEvalReportFilterOptions(rows);
    const locations = getManagerEvalReport2LocationOptions(rows);
    const location = buildManagerEvalReport2Select('Location','locationcode',managerEvalReport2LocationFilter,locations);
    const season = buildManagerEvalReport2SeasonPicker(options.seasons);
    const container = buildManagerEvalReport2Select('Container','contsize',managerEvalReport2ContSizeFilter,options.contSizes);
    return `<div class="manager-eval2-persistent-filters">
        ${location}${season}${container}${renderEvalReport2PriorityMarkup(managerEvalReport2PriorityFilter)}
    </div>`;
}

function renderEvalReport2PriorityMarkup(value) {
    return `<label>Priority<select onchange="return setManagerEvalReport2Filter('priority',this.value)">
        <option value="all" ${value === 'all' ? 'selected' : ''}>All</option>
        <option value="with" ${value === 'with' ? 'selected' : ''}>With Priority</option>
        <option value="without" ${value === 'without' ? 'selected' : ''}>Without Priority</option>
    </select></label>`;
}

function renderManagerEvalReport2ReportsPanel(moreHtml = '') {
    const api = getManagerEvalReports2Api();
    const index = getManagerEvalReport2Index();
    if (!api || !index) return '';
    const countSignals = getManagerEvalReport2CountSignals(index);
    const reports = api.REPORT_IDS.map(id => ({
        id,label:getManagerEvalReport2Meta(id).label,count:getManagerEvalReport2ReportCount(id)
    }));
    const picker = renderEvalReport2PickerMarkup(reports,
        getManagerEvalReport2SelectedReportIds(),countSignals,escapeHtml);
    const assigned = buildManagerEvalReport2Select('AssignedTo','assignedto',managerEvalReport2AssignedToFilter,
        getManagerEvalReport2AssignedToOptions(),true,
        !activeManagerEvalReport2 || managerEvalReport2AssignmentFilterRefreshing);
    const report = activeManagerEvalReport2
        ? `<div id="manager-eval-report-2-browse-region">${renderManagerEvalReport2BrowseRegionHtml()}</div>`
        : '<p>Choose a report from the Eval Reports dashboard, or apply the reports selected above.</p>';
    return `<div class="manager-eval2-drive-workflow" data-eval-report-counts-ready="${countSignals.ready}"
        data-eval-source-row-count="${countSignals.sourceRows}" data-eval-report-match-count="${countSignals.matches}">
        ${picker}
        <h3 id="manager-eval-report-2-report-select">${escapeHtml(getManagerEvalReport2Meta().label)}</h3>
        <div class="manager-eval2-drive-controls">
            ${assigned}${renderManagerEvalReport2OptionalFilters()}${moreHtml}
            <div id="manager-eval-report-2-lock-note" class="hidden"></div>
        </div>
        ${renderManagerEvalReport2SelectionTray()}${report}
    </div>`;
}

function renderManagerEvalReport2MoreMenu(index = null, meta = null, sourceUpdated = '') {
    if (!index || !meta) return '';
    const inventoryCount = index.inventoryRowCount ?? fullInventory.length;
    const assignmentCount = index.assignmentStats ? index.assignmentStats.assignmentCount : warehouseAssignedItemsInventory.length;
    const updated = sourceUpdated
        ? ' Source updated ' + escapeHtml(formatInventoryEditMockTimestamp(sourceUpdated)) + '.' : '';
    return `<details id="manager-eval-report-2-more-menu" class="manager-eval2-drive-more"
        ${managerEvalReport2MoreMenuOpen ? 'open' : ''} ontoggle="managerEvalReport2MoreMenuOpen=this.open">
        <summary>More</summary>
        <div class="p-4">
            <p>${escapeHtml(String(inventoryCount))} inventory rows / ${escapeHtml(String(assignmentCount))} assignments.${updated}</p>
            <div class="manager-eval2-report-actions">
                <button type="button" onclick="return loadManagerEvalReports2(true)"
                    ${managerEvalReport2LoadState.loading ? 'disabled' : ''}>Refresh</button>
            </div>
            ${renderManagerEvalReportSettingsPanel()}
        </div>
    </details>`;
}

function renderManagerEvalReports2Panel() {
    if (!canViewManagerEvalReports2()) return renderManagerEvalReports2LegacyPanel();
    if (isEvalAggregateDashboardVisible()) {
        return getManagerEvalReports2Api() ? renderEvalAggregateDashboard() : renderManagerEvalReports2LegacyPanel();
    }
    if (fieldAuditState().modes.eval !== 'audit') return renderManagerEvalReports2LegacyPanel();
    syncEvalOverviewAuditRows();
    return renderFieldAuditReport('eval');
}

function evalReport2DrillAttrs(kind, value, audit = false) {
    return `data-manager-eval2-drill-kind="${escapeHtml(kind)}" data-manager-eval2-drill-value="${escapeHtml(String(value || ''))}"
        ${audit ? 'data-eval2-field-audit' : ''}`;
}

function renderManagerEvalReport2DrillGroupCard(group, presentation = null) {
    const isBlock = group.kind === 'blockalpha';
    const eyebrow = isBlock ? 'Block Alpha' : 'LocationCode';
    const detail = isBlock
        ? `${group.locationCount} LocationCode${group.locationCount === 1 ? '' : 's'}`
        : `${group.itemCount} ITEMCODE${group.itemCount === 1 ? '' : 's'}`;
    const label = isBlock && /^[A-Z]$/i.test(String(group.value).trim())
        ? String(group.value).trim().toUpperCase() : group.label || group.value || 'Unknown';
    const attrs = evalReport2DrillAttrs(group.kind, group.value, presentation?.audit);
    return `<button type="button" class="manager-eval2-drill-card flex min-h-[92px] w-full items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-white p-4 text-left shadow-sm" ${attrs}>
        <span class="min-w-0"><span class="block text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700">${eyebrow}</span>
        <span class="mt-1 block break-words text-xl font-black text-slate-900">${escapeHtml(label)}</span>
        <span class="mt-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">${escapeHtml(detail)} &bull; ${group.rowCount} row${group.rowCount === 1 ? '' : 's'}</span></span>
        <i class="ph-bold ph-caret-right shrink-0 text-2xl text-[#007a4d]" aria-hidden="true"></i></button>`;
}

function openManagerEvalReport2DrillValue(kind = '', encodedValue = '') {
    if (!['commonname', 'contsize', 'blockalpha', 'locationcode', 'blockrows'].includes(kind)) return false;
    let value = String(encodedValue || '');
    try { value = decodeURIComponent(value); } catch { return false; }
    rememberManagerEvalReport2DrillScroll();
    setEvalReport2DrillValue(kind, value);
    refreshManagerEvalReport2BrowseRegion({ fallbackToFullRender: true });
    queueScrollMainAreaToTop(`manager-eval2:${kind}:${value}`);
    return false;
}

function setEvalReport2DrillValue(kind, value) {
    if (kind === 'commonname') {
        managerEvalReport2SelectedCommonName = value;
        managerEvalReport2SelectedContSize = '';
        managerEvalReport2DrillLevel = 1;
        return;
    }
    if (kind === 'contsize') {
        managerEvalReport2SelectedContSize = value;
        managerEvalReport2DrillLevel = 2;
        return;
    }
    if (kind === 'blockalpha') {
        managerEvalReport2SelectedBlockAlpha = value;
        managerEvalReport2SelectedBlockNumber = '';
        managerEvalReport2SelectedLocationCode = '';
        managerEvalReport2DrillLevel = 1;
        return;
    }
    managerEvalReport2SelectedLocationCode = kind === 'blockrows' ? '' : value;
    managerEvalReport2DrillLevel = 2;
}

function bindEvalReport2DrillCommands(container) {
    if (container.dataset.eval2DrillBound) return;
    container.dataset.eval2DrillBound = 'true';
    // Native buttons dispatch the same click for touch, Enter, and Space.
    container.addEventListener('click', dispatchEvalReport2Drill);
}

function dispatchEvalReport2Drill(event) {
    const button = event.target.closest('button[data-manager-eval2-drill-kind]');
    if (!button || !canViewManagerEvalReports2()) return;
    const { managerEval2DrillKind: kind, managerEval2DrillValue: value } = button.dataset;
    if (button.hasAttribute('data-eval2-field-audit')) {
        const block = fieldAuditState().block;
        if (kind === 'blockalpha') fieldAuditDrill(value);
        else fieldAuditDrill(block, kind === 'blockrows' ? '' : value, kind === 'blockrows');
        queueScrollMainAreaToTop('field-audit:' + kind);
        updateGlobalBackButton();
    } else openManagerEvalReport2DrillValue(kind, encodeURIComponent(value));
}

function renderEvalReport2BlockRowsButton(block, audit = false) {
    return `<button type="button" class="min-h-[40px] rounded-xl border border-emerald-300 px-4 text-sm font-bold"
        ${evalReport2DrillAttrs('blockrows', block, audit)}>View All Block Rows</button>`;
}
