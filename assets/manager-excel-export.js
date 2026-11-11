function createManagerExcelTransport(root, transport) {
    return (payload, signal) => {
        if (['read','list'].includes(payload.operation)) root.agdataExcelQuery = { ...payload };
        return transport(payload, signal);
    };
}

function getManagerTableExcelCommand() {
    const key = getManagerTableManagementKey(activeHomeTab) || (activeHomeTab === MANAGER_TABLE_MANAGEMENT_VIEW ? managerTableManagementSelection : '');
    const root = document.getElementById('manager-table-management-root');
    if (root?.agdataExcelProvider) return () => downloadOwnerExcelProjection(root);
    if (['company-directory', 'inquiry-coverage'].includes(key)) return () => exportMaintainedManagerTable(key);
    if (key === 'user-role-access') return exportManagerUserAccess;
    if (key === 'customer-assignments') return exportCustomerAssignments;
    if (key === 'season') return () => exportObjectRows('Season', [getCurrentAppSeasonSettings()]);
    if (key === 'av-note-users') return () => exportObjectRows('AV Note Users', getAvBlanksPhotoBypassUserOptions(Array.from(getAvBlanksPhotoBypassDraftUsers())));
    if (key === 'season-priority') return exportSeasonPriorityRows;
    if (activeHomeTab === MANAGER_HISTORICAL_REPORT_VIEW) return exportManagerHistoricalLoadedRowsToExcel;
    return getAdditionalViewExportCommand('managers');
}

function exportObjectRows(title, rows, fields = null) {
    const keys = fields || Array.from(new Set(rows.flatMap(row => Object.keys(row))));
    const columns = keys.map(field => ({ label: field, value: row => {
        const value = row[field];
        return value && typeof value === 'object' ? JSON.stringify(value) : value ?? '';
    } }));
    return downloadExcelWorkbook(columns, rows, title, '', title, null, {exactColumns:true});
}

async function readManagerExportPages(read, current) {
    const rows = [];
    let total = null, revision;
    for (let page = 0; total == null || rows.length < total; page++) {
        if (!current()) throw Error('The active table or account changed. Retry export.');
        const response = await read(page);
        const data = response?.data || response;
        if (!Array.isArray(data?.rows)) throw Error('The table did not return export rows.');
        const nextTotal = Number(data.total);
        if (!Number.isSafeInteger(nextTotal) || nextTotal < 0 || total != null && nextTotal !== total
            || revision !== undefined && data.revision !== revision) throw Error('The table changed during export. Refresh and retry.');
        total = nextTotal;
        revision = data.revision;
        if (!data.rows.length && rows.length < total) throw Error('The table export is incomplete.');
        rows.push(...data.rows);
    }
    if (!current() || rows.length !== total) throw Error('The table export is incomplete or its account changed.');
    return rows;
}

async function exportMaintainedManagerTable(key) {
    const owner = getSupabaseReadIdentityScope();
    const root = document.getElementById('manager-table-management-root');
    const query = root?.querySelector('[data-search]')?.value || '';
    const current = () => owner === getSupabaseReadIdentityScope() && root?.isConnected
        && managerTableManagementSelection === key && (root.querySelector('[data-search]')?.value || '') === query;
    const read = page => postAppFunctionJson(APP_API_FUNCTION_URL,
        {action:'manager_table_management',operation:'read',table:key,payload:{page,pageSize:100,q:query}},
        {timeoutMs:30000,label:'Table Excel export'});
    const rows = await readManagerExportPages(read, current);
    const fields = key === 'company-directory'
        ? ['name','username','email','phone','userrole','department','territory','active']
        : ['scope','block','location','group_name','primary_user','backup_user','active'];
    const labels = [...root.querySelectorAll('thead th')].slice(0,fields.length).map(node => node.textContent.trim());
    const columns = fields.map((field,index) => ({label:labels[index] || field,value:row => row[field] ?? ''}));
    return downloadExcelWorkbook(columns, rows, key, query, key, null, {exactColumns:true});
}

function exportManagerUserAccess() {
    const root = document.querySelector('#canonical-user-access-editor');
    const query = String(root?.dataset.query || '').toLowerCase();
    const role = root?.dataset.roleFilter || '';
    const rows = window.GncUserAccessControl.users.filter(user => (!role || user.canonical_role === role)
        && (!query || [user.username,user.display_name,user.email,user.salesrep_id,...(user.salesrep_match_names || [])]
            .some(value => String(value || '').toLowerCase().includes(query))))
        .sort((left,right) => left.display_name.localeCompare(right.display_name));
    return exportObjectRows('User and Role Access', rows, ['username','display_name','canonical_role','active','permissions']);
}

async function exportCustomerAssignments() {
    const owner = getSupabaseReadIdentityScope();
    const root = document.getElementById('manager-customer-rep-map-root');
    if (!root) throw Error('Open Customer Assignments first.');
    const fields = ['customername','consigneename','salesrepid','salesrepname'];
    const labels = ['Customer Name','Consignee Name','Sales Rep ID','Sales Rep Name'];
    const filters = Object.fromEntries(fields.map((field,index) => [field,
        root.querySelector('[aria-label="Filter ' + labels[index] + '"]')?.value || '']));
    filters.status = root.querySelector('select')?.value || 'all';
    const query = root.agdataExcelQuery || {};
    const read = page => postAppFunctionJson(APP_API_FUNCTION_URL,
        {action:'customer-rep-map',operation:'list',page,pageSize:100,filters,sort:query.sort || 'customername',direction:query.direction || 'asc'},
        {timeoutMs:30000,label:'Customer Assignments Excel export'});
    const rows = await readManagerExportPages(read, () => owner === getSupabaseReadIdentityScope() && root.isConnected);
    const columns = fields.map((field,index) => ({label:labels[index],value:row => row[field] ?? ''}));
    columns.push({label:'Status',value:row => row.customerstatus || ''},
        {label:'Assignment source',value:row => row.hasOverride ? 'Override' : 'ERP'});
    return downloadExcelWorkbook(columns, rows, 'Customer Assignments', '', 'Customer_Assignments', null, {exactColumns:true});
}

function exportSeasonPriorityRows() {
    const state = getManagerSeasonPriorityState();
    if (state.pageEnabled) return exportManagerReportSurface('season-priority','Season Priority');
    const rows = (state.rows || []).filter(row => (!state.block || (row.blockalpha || 'UNASSIGNED') === state.block)
        && (!state.location || (row.locationcode || 'UNASSIGNED') === state.location)
        && managerTextMatchesSearch([row.itemcode,row.commonname,row.contsize,row.blockalpha,row.locationcode,row.lotcode,...(row.resolvedAssignedTo || row.warehouseAssignedTo || [])]));
    return exportObjectRows('Season Priority', rows);
}


function downloadOwnerExcelProjection(root) {
    const context = root.agdataExcelProvider();
    return downloadExcelWorkbook(context.columns, context.rows, context.title, '', context.title, null, {exactColumns:true});
}

function exportAccessControlCsv() {
    const permissions = getFilteredAccessControlPermissions();
    const rows = getFilteredAccessControlSubjects();
    const columns = [
        {label:accessControlAdminState.viewMode === 'roles' ? 'Role' : 'Username / Name',value:row => row.displayName || row.username || row.roleKey || ''},
        {label:'Role',value:row => row.roleKey || ''},
        ...permissions.map(permission => ({label:permission.label,value:row => row.decisions?.[permission.permissionKey]?.allowed === true ? 'Y' : 'N'}))
    ];
    return downloadExcelWorkbook(columns,rows,'User Access Audit','','User_Access_Audit',null,{exactColumns:true});
}
