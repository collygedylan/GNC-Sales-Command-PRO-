export function getManagerTableManagementItems(access = getManagersToolAccess()) {
    return [
        ...(globalThis.GncNurseryModel?.TABLES || []).map(item => ({...item,visible:canViewNurseryCommandTables()})),
        { id:'assigned-items', label:'Assigned Items', section:'editable', visible:access.canViewAssignedItemsExport },
        { id:'action-discrepancy', label:'Action Discrepancy', section:'editable', visible:access.canViewTableManagement },
        { id:'company-directory', label:'Company Directory', section:'editable', visible:typeof canonicalFeaturePermission !== 'function' || canonicalFeaturePermission('can_access_manager_tab') !== false },
        { id:'inquiry-coverage', label:'Inquiry Coverage', section:'editable', visible:typeof canonicalFeaturePermission !== 'function' || canonicalFeaturePermission('can_access_manager_tab') !== false },
        { id:'customer-assignments', label:'Customer Assignments', section:'editable', visible:access.canManageCustomerRepMappings },
        { id:'user-role-access', label:'User & Role Access', section:'editable', visible:access.canManageAccessControl },
        { id:'av-note-users', label:'AV Note Users', section:'editable', visible:access.canManageAvBlanksPhotoBypass },
        { id:'season', label:'Season', section:'editable', visible:access.canManageSeasonSettings },
        { id:'season-priority', label:'Season Priority', section:'editable', visible:access.canViewSeasonPriority },
        { id:'production-schedule', label:'PROD SCHEDULE 102726 (2026-10-29_1232)', section:'schedule', visible:access.canViewProductionSchedule },
        { id:'historical-drive-mode', label:'Historical Drive Mode', section:'archive', visible:canUseHistoricalRequests() },
        { id:'historical-soc-open-orders', label:'Historical SOC Open Orders', section:'archive', visible:canUseHistoricalRequests() },
        { id:'historical-soc-reserves', label:'Historical SOC Reserves', section:'archive', visible:canUseHistoricalRequests() },
        { id:'historical-requests', label:'Historical Requests', section:'archive', visible:canUseHistoricalRequests() },
        { id:'photo-history', label:'Photo History', section:'archive', visible:canOpenPhotoHistory() }
    ].filter(item => item.visible);
}

export function managerTableDirectoryItems(items) {
    const order = ['assigned-items','user-role-access','company-directory',
        'customer-assignments','action-discrepancy','inquiry-coverage','av-note-users','season','season-priority'];
    const schedules = items.filter(item => item.nursery
        || item.section === 'schedule' && !items.some(row => row.id === 'prod-schedule'));
    return [...order.map(key => items.find(item => item.id === key)).filter(Boolean), ...schedules];
}

export function renderManagerTableWorkspaceMarkup(content, selected, items, query, escape) {
    const directory = managerTableDirectoryItems(items);
    if (!selected) return renderManagerTableDirectoryMarkup(directory, query, escape);
    const active = items.find(item => item.id === selected);
    const choices = [...directory, ...items.filter(item => item.section === 'archive')];
    const options = choices.map(item => renderManagerTableOption(item,selected,escape)).join('');
    const title = escape(active?.label || selected);
    return `<section id="view-table-management" data-table-directory-mode="table"
        data-selected-table="${escape(selected)}" aria-label="Table Management workspace">
        <nav class="table-management-selector" data-table-selector aria-label="Table navigation">
            <button type="button" data-table-all onclick="return openManagerTableManagement()">← All Tables</button>
            <strong class="table-management-title" title="${title}">${title}</strong>
            <select data-table-switch aria-label="Switch Table" onchange="return openManagerTableManagement(this.value)">
                <option value="" selected disabled>Switch Table ▾</option>${options}
            </select>
        </nav>
        <div class="table-management-workspace" data-table-workspace>${content}</div>
    </section>`;
}

export function renderManagerTableOption(item,selected,escape) {
    return `<option value="${escape(item.id)}" data-manager-table-pill="${escape(item.id)}" aria-pressed="${item.id === selected}">${escape(item.label)}</option>`;
}

export function renderManagerTableDirectoryMarkup(directory, query, escape) {
    const search = String(query || '').trim().toLowerCase();
    const cards = directory.map(item => renderManagerTableChoice(item,search,escape)).join('');
    return `<section id="view-table-management" data-table-directory-mode="index"
        data-selected-table="" aria-label="Table Management directory">
        <div class="table-management-directory" data-table-directory>${cards}</div>
    </section>`;
}

export function renderManagerTableChoice(item,search,escape) {
    const hidden = search && !item.label.toLowerCase().includes(search) ? 'hidden' : '';
    return `<button type="button" class="manager-module-card" data-manager-table-card="${escape(item.id)}" ${hidden}
        onclick="return openManagerTableManagement(this.dataset.managerTableCard)">
        <span class="manager-module-icon" aria-hidden="true"><i class="ph-bold ph-table"></i></span>
        <span class="manager-module-title">${escape(item.label)}</span>
    </button>`;
}
export function indexAssignedPlantGroupSources(sources, index, indexRow) {
    for (const source of new Set(sources)) indexAssignedPlantGroupEntries(source, index, indexRow);
}

function indexAssignedPlantGroupEntries(source, index, indexRow) {
    for (const entry of source?.values?.() || []) {
        if (Array.isArray(entry)) entry.forEach(row => indexRow(index, row));
        else indexRow(index, entry);
    }
}

export function getManagerToolTabs(access = getManagersToolAccess()) {
    const tabs = [];
    if (access.canViewApproval) tabs.push({ id: MANAGER_APPROVAL_HOME_VIEW, label: 'Approval' });
    if (access.canViewMoves) tabs.push({ id: 'moves', label: 'Move' });
    if (access.canManageSeasonSettings) tabs.push({ id: APP_SEASON_SETTINGS_VIEW, label: 'Season' });
    if (access.canViewSeasonPriority) tabs.push({ id: MANAGER_SEASON_PRIORITY_VIEW, label: 'Season Priority' });
    if (access.canViewProductionSchedule) tabs.push({ id: MANAGER_PRODUCTION_SCHEDULE_VIEW, label: 'Production Schedule' });
    if (access.canViewHrCommand) tabs.push({ id: MANAGER_HR_COMMAND_VIEW, label: 'HR & Labor' });
    if (access.canManageCompanyDirectory) tabs.push({ id: MANAGER_COMPANY_DIRECTORY_VIEW, label: 'Company Directory' });
    if (access.canManageAvBlanksPhotoBypass) tabs.push({ id: AV_BLANKS_PHOTO_BYPASS_SETTINGS_VIEW, label: 'AV Note Users' });
    if (access.canManageItemInquiryCoverage) tabs.push({ id: ITEM_INQUIRY_COVERAGE_SETTINGS_VIEW, label: 'Inquiry Coverage' });
    if (access.canViewInventoryTransactions) tabs.push({ id: INVENTORY_TRANSACTION_HISTORY_VIEW, label: 'Transaction History' });
    if (access.canViewTransactionsKeyed) tabs.push({ id: MANAGER_TRANSACTIONS_KEYED_VIEW, label: 'Transactions Keyed' });
    if (access.canViewOrders) tabs.push({ id: MANAGER_ORDERS_VIEW, label: 'Orders' });
    if (access.canViewTableManagement) {
        tabs.push({ id: MANAGER_TABLE_MANAGEMENT_VIEW, label: 'Table Management' });
        tabs.push({ id: 'action-discrepancy', label: 'Action Discrepancy' });
    }
    if (access.canViewAssignedItemsExport) tabs.push({ id: MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW, label: 'Assigned Items' });
    if (access.canManageCustomerRepMappings) tabs.push({ id: MANAGER_CUSTOMER_REP_MAP_VIEW, label: 'Customer Assignments' });
    if (access.canViewEvalReports) tabs.push({ id: MANAGER_EVAL_REPORTS_VIEW, label: 'Eval Reports' });
    if (access.canViewEvalReports2) tabs.push({ id: MANAGER_EVAL_REPORTS_2_VIEW, label: 'Eval Reports #2' });
    if (access.canViewHistoricalReport) tabs.push({ id: MANAGER_HISTORICAL_REPORT_VIEW, label: 'Historical Report' });
    if (access.canViewShortageCancel) tabs.push({ id: MANAGER_SHORTAGE_CANCEL_VIEW, label: 'Shortage/Cancel' });
    if (access.canViewBlockClearing) tabs.push({ id: MANAGER_BLOCK_CLEARING_VIEW, label: 'Block Clearing' });
    if (access.canManageAccessControl) tabs.push({ id: MANAGER_ACCESS_CONTROL_VIEW, label: 'User & Role Access' });
    if (access.canViewCodexOperations) tabs.push({ id: MANAGER_CODEX_OPERATIONS_VIEW, label: 'Codex Operations' });

    if (access.canManageDeliveryRecovery) tabs.push({ id: MANAGER_DELIVERY_RECOVERY_VIEW, label: 'Delivery Recovery' });
    if (access.canViewLaborHours) tabs.push({ id: 'hours', label: 'Labor Hours' });
    return tabs;
}
