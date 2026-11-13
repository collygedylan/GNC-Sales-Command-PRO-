function evalOverviewInventoryEntry(row) {
    const canonical = resolveCanonicalInventoryRow(row) || row;
    const audit = fieldAuditNormalizeRow(canonical, false);
    const price = [canonical.listprice, canonical.LISTPRICE, canonical.list_price, canonical.LIST_PRICE]
        .find(value => value !== undefined && value !== null && value !== '');
    const priceText = String(price ?? '').replace(/[$,\s]/g, '');
    return { audit, canonical, missingPrice: !priceText || !Number.isFinite(Number(priceText)) };
}

function summarizeEvalOverviewReport(id, rows, meta, entries, rowKeys, suppressed, includeCohortKeys) {
    const result = { id, label: meta.label || id, description: meta.description || '', lots: 0, units: 0, value: 0, missingPrices: 0 };
    const seen = new Set();
    rows.forEach((row, index) => {
        const key = rowKeys.get(row) || getManagerEvalReport2RowKey(row, index);
        const entry = entries.get(key);
        if (!entry || seen.has(key) || suppressed.has(getManagerEvalReport2ItemCode(row))) return;
        seen.add(key);
        result.lots++;
        result.units += entry.audit.on_hand;
        result.value += entry.audit.extended_value;
        if (entry.missingPrice) result.missingPrices++;
    });
    if (includeCohortKeys) result.cohortKeys = [...seen];
    return result;
}

function summarizeEvalOverviewAudit(entries, includeCohortKeys) {
    const rows = [...entries.values()].map(entry => entry.audit);
    const cohort = fieldAuditMatchingRows(rows, {
        season: 'Y', year: '2026max', status: 'all', search: '', block: '', location: '', sort: 'locationcode', direction: 1
    });
    const matching = new Set(cohort);
    const { lots, units, value } = fieldAuditMetrics(cohort, {});
    const result = { id: 'field-audit', label: 'Season Y ≤ 2026 Field Audit', description: 'Season Y inventory through 2026.',
        lots, units, value, missingPrices: 0 };
    const keys = [];
    for (const [key, entry] of entries) {
        if (!matching.has(entry.audit)) continue;
        if (entry.missingPrice) result.missingPrices++;
        if (includeCohortKeys) keys.push(key);
    }
    if (includeCohortKeys) result.cohortKeys = keys;
    return result;
}

function buildEvalAggregateDashboardModel(inventoryRows, assignmentRows, options = {}) {
    const api = getManagerEvalReports2Api();
    const source = Array.isArray(inventoryRows) ? inventoryRows : [];
    const { rows } = api.buildAuthoritativeAssignmentModel(source, assignmentRows, { assignmentContract: 'inventory-row-assignments-v1' });
    const index = api.classifyScriptCompatibleRows(rows, options.classifierOptions);
    const byItem = new Map();
    const rowKeys = new Map();
    const entries = new Map();
    rows.forEach((row, index) => {
        const code = getManagerEvalReport2ItemCode(row);
        const key = getManagerEvalReport2RowKey(row, index);
        if (!byItem.has(code)) byItem.set(code, []);
        byItem.get(code).push(row);
        rowKeys.set(row, key);
        if (!entries.has(key)) entries.set(key, evalOverviewInventoryEntry(row));
    });
    const suppressed = new Set();
    for (const [code, itemRows] of byItem) {
        if (api.isSuppressedEvalReportCardRows(itemRows)) suppressed.add(code);
    }
    const reports = api.REPORT_IDS.map(id => summarizeEvalOverviewReport(
        id, index.reports[id] || [], api.REPORT_META[id] || {}, entries, rowKeys, suppressed, options.includeCohortKeys
    ));
    const audit = summarizeEvalOverviewAudit(entries, options.includeCohortKeys);
    return { reports: [audit, ...reports], entries, sourceRowCount: entries.size };
}

function evalAggregateDashboardState() {
    const owner = getSupabaseReadIdentityScope();
    const permission = String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '');
    const previous = window.__evalAggregateDashboard;
    if (previous?.owner === owner && previous.permission === permission) return previous;
    const selected = previous?.owner === owner ? previous.selected : '';
    return window.__evalAggregateDashboard = { owner, permission, selected, model: null, source: null,
        pending: null, attempted: false, error: '' };
}

function isEvalAggregateDashboardVisible() {
    return !evalAggregateDashboardState().selected;
}

function enterEvalAggregateDashboard() {
    evalAggregateDashboardState().selected = '';
}

function showEvalAggregateDashboard() {
    if (!canViewManagerEvalReports2()) return false;
    enterEvalAggregateDashboard();
    renderManagers();
    queueScrollMainAreaToTop('eval-aggregate-dashboard');
    updateGlobalBackButton();
    return false;
}

function backEvalAggregateDashboard() {
    const { selected } = evalAggregateDashboardState();
    if (!selected) return false;
    if (selected === 'field-audit') {
        const audit = fieldAuditState();
        if (audit.blockRows) fieldAuditDrill(audit.block);
        else if (audit.block) fieldAuditBack();
        else showEvalAggregateDashboard();
        return true;
    }
    if (managerEvalReport2DetailItemKey || managerEvalReport2BrowseMode === 'location' && managerEvalReport2DrillLevel > 0) return false;
    showEvalAggregateDashboard();
    return true;
}

function evalAggregateDashboardSource() {
    const receipt = productionDisplayMasterReceipt;
    const master = getDatasetState('master');
    const owner = getSupabaseReadIdentityScope();
    const permission = String(appAccessSnapshotState.snapshot?.dataPermissionVersion || '');
    const notes = getManagerAssignedColumnState();
    const ready = receipt?.rows === fullInventory && receipt.readScope === owner && receipt.permission === permission
        || master.rowCompleteness === 'complete' && master.liveVerifiedScope === getProductionLiveSyncContext().scope && master.liveVerifiedPermission === permission;
    return { ready, rows: fullInventory, assignments: isDatasetLoaded('warehouseAssignedItems', 'full') ? warehouseAssignedItemsInventory : null,
        notes: notes.locationSalesNotes, photoGeneration: notes.photoGeneration,
        epoch: resolvedViewStateEpoch, key: getManagerEvalReport2CacheKeyValue(), count: fullInventory.length };
}

function getEvalAggregateDashboardModel(state = evalAggregateDashboardState()) {
    const source = evalAggregateDashboardSource();
    if (state.model && Object.keys(source).every(key => source[key] === state.source[key])) return state.model;
    const next = getConfiguredNextSaleSeasonTarget();
    state.model = buildEvalAggregateDashboardModel(source.rows, source.assignments || [], {
        classifierOptions: { currentSeason: getConfiguredCurrentSeasonCode(), currentSalesYear: getConfiguredCurrentSalesYearCode(),
            nextSeason: next.season, nextSalesYear: next.salesYear, settings: managerEvalReportSettings, now: new Date() }
    });
    state.source = source;
    if (source.ready) state.error = '';
    return state.model;
}

function queueEvalAggregateDashboardRefresh(force = false) {
    if (!canViewManagerEvalReports2()) return;
    const state = evalAggregateDashboardState();
    if (state.pending || !force && (state.source?.ready || state.attempted)) return;
    state.attempted = true;
    state.error = '';
    state.pending = Promise.resolve().then(() => ensureDatasetLoaded('master', 'full', { force })).catch(() => {
        state.error = 'Inventory refresh failed. Showing loaded rows.';
    }).finally(() => {
        state.pending = null;
        if (getCurrentVisibleViewId() !== 'managers' || activeHomeTab !== MANAGER_EVAL_REPORTS_2_VIEW
            || evalAggregateDashboardState() !== state || !canViewManagerEvalReports2()) return;
        if (!evalAggregateDashboardSource().ready) state.error ||= 'Showing loaded rows. Retry to refresh inventory.';
        if (!state.selected || state.selected === 'field-audit') scheduleManagersRender(true);
    });
}

function syncEvalOverviewAuditRows() {
    const state = evalAggregateDashboardState();
    if (state.selected !== 'field-audit') return;
    const model = getEvalAggregateDashboardModel(state);
    queueEvalAggregateDashboardRefresh();
    const audit = fieldAuditState();
    if (audit.inventoryReady && !state.source.ready && audit.rows.length > model.sourceRowCount) return;
    model.auditRows ||= [...model.entries.values()].map(entry => fieldAuditNormalizeRow(entry.canonical));
    audit.rows = model.auditRows;
    audit.inventoryReady = state.source.ready;
}

function refreshVisibleEvalOverview() {
    if (activeHomeTab !== MANAGER_EVAL_REPORTS_2_VIEW || getCurrentVisibleViewId() !== 'managers' || !canViewManagerEvalReports2()) return;
    const { selected } = evalAggregateDashboardState();
    if (!selected || selected === 'field-audit') scheduleManagersRender(true);
}

function openEvalAggregateReport(reportId) {
    if (!canViewManagerEvalReports2()) return false;
    const state = evalAggregateDashboardState();
    const api = getManagerEvalReports2Api();
    if (reportId !== 'field-audit' && !api?.REPORT_IDS.includes(reportId)) return false;
    const audit = fieldAuditState();
    if (reportId === 'field-audit') {
        Object.assign(audit, { season: 'Y', year: '2026max', status: 'all', search: '', block: '', location: '',
            flat: false, blockRows: false, page: 0 });
        audit.modes.eval = 'audit';
    } else {
        if (!setManagerEvalReport2Reports([reportId])) return false;
        clearManagerEvalReport2Filters();
        setManagerEvalReport2BrowseMode('location');
        audit.modes.eval = 'legacy';
    }
    state.selected = reportId;
    renderManagers();
    queueScrollMainAreaToTop('eval-aggregate-report:' + reportId);
    updateGlobalBackButton();
    return false;
}

function renderEvalOverviewCard(report) {
    return `<article class="eval-aggregate-card" data-eval-aggregate-report="${escapeHtml(report.id)}">
        <div class="eval-aggregate-card-copy"><h3>${escapeHtml(report.label)}</h3><p>${escapeHtml(report.description)}</p></div>
        <dl class="eval-aggregate-metrics"><div><dt>Total On Hand</dt><dd data-eval-aggregate-units>${report.units.toLocaleString('en-US')}</dd></div>
        <div><dt>Extended Value</dt><dd data-eval-aggregate-value>${fieldAuditMoney(report.value)}</dd></div></dl>
        <p class="eval-aggregate-coverage">${report.lots.toLocaleString('en-US')} inventory ${report.lots === 1 ? 'row' : 'rows'}
        ${report.missingPrices ? ' · ' + report.missingPrices + ' without a list price' : ''}</p>
        <button type="button" class="eval-aggregate-go" onclick="return openEvalAggregateReport('${escJsAttrValue(report.id)}')"
            aria-label="View report: ${escapeHtml(report.label)}">View Report <span aria-hidden="true">→</span></button>
    </article>`;
}

function renderEvalAggregateDashboard() {
    const state = evalAggregateDashboardState();
    const model = getEvalAggregateDashboardModel(state);
    queueEvalAggregateDashboardRefresh();
    const status = state.error || (state.source.ready ? 'Live inventory' : 'Showing loaded inventory');
    return `<section class="eval-aggregate-dashboard" aria-labelledby="eval-aggregate-title" data-eval-aggregate-dashboard>
        <header class="eval-aggregate-heading"><div><h2 id="eval-aggregate-title">Eval Reports #2</h2><p role="status">${escapeHtml(status)}</p></div>
        ${state.error ? '<button type="button" class="eval-aggregate-retry" onclick="queueEvalAggregateDashboardRefresh(true)">Retry totals</button>' : ''}</header>
        <div class="eval-aggregate-grid">${model.reports.map(renderEvalOverviewCard).join('')}</div></section>`;
}
