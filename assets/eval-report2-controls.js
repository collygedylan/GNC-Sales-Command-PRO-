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
        <button type="button" onclick="return clearManagerEvalReport2Filters()">Clear Optional Filters</button>
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
                <button type="button" onclick="return exportManagerEvalReport2ToExcel()">Export Excel</button>
            </div>
            ${renderManagerEvalReportSettingsPanel()}
        </div>
    </details>`;
}

function renderManagerEvalReports2Panel() {
    if (!canViewManagerEvalReports2()) return renderManagerEvalReports2LegacyPanel();
    if (isEvalAggregateDashboardVisible()) return renderEvalAggregateDashboard();
    return fieldAuditState().modes.eval === 'audit' ? renderFieldAuditReport('eval') : renderManagerEvalReports2LegacyPanel();
}
