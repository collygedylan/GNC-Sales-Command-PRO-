function mountCustomerRepMappingView(root) {
    if (!root || !canManageCustomerRepMappings()) { destroyCustomerRepMappingView(); return; }
    const identity = getSupabaseReadIdentityScope();
    if (customerRepMappingView && customerRepMappingView.root === root && customerRepMappingView.identity === identity) return;
    destroyCustomerRepMappingView();
    if (!window.GncDatabase?.mountCustomerRepMapping) { root.textContent = 'Mapping editor is unavailable. Reload the app to update it.'; return; }
    const destroy = window.GncDatabase.mountCustomerRepMapping(root,
        createManagerExcelTransport(root, (payload, signal) => postAppFunctionJson(APP_API_FUNCTION_URL, payload, {signal, timeoutMs:30000, label:'Customer mapping'})),
        () => {
            requestModalCustomerOptionsCacheKey = '';
            requestExistingFolderGroupsCacheKey = '';
            void ensureDatasetLoaded('customerRepMap', 'full', {force:true}).catch(error => showToast('Mapping Saved', 'Refresh Request options before submitting: ' + error.message, true));
        }, identity);
    customerRepMappingView = {root, identity, destroy};
}

function mountManagerTableManagementPanel(root) {
    if (!root || !canAccessView('managers')) { destroyManagerTableManagement(); return; }
    if (managerTableManagementInstance?.root === root) return;
    if (canViewNurseryCommandTables()) void ensureDatasetLoaded('master', 'full', {preserveRequestedMode:true}).catch(() => false);
    destroyManagerTableManagement();
    if (!window.GncManagerTableManagement?.mountManagerTableManagement) {
        root.textContent = 'Table Management is unavailable. Reload the app to retry.';
        return;
    }
    const identity = getSupabaseReadIdentityScope();
    managerTableManagementInstance = {
        root,
        identity,
        selected: managerTableManagementSelection, tableKeys: getManagerTableManagementItems().map(item => item.id).join('|'),
        ...window.GncManagerTableManagement.mountManagerTableManagement(root, {
            selected: managerTableManagementSelection,
            onSelect: key => openManagerTableManagement(key),
            ...getNurseryTableManagementOptions(identity),
            tables: getManagerTableManagementItems().map(item => item.id),
            request: createManagerExcelTransport(root, async payload => {
                const response = await postAppFunctionJson(APP_API_FUNCTION_URL, payload, { timeoutMs:30000, label:'Table Management' });
                if (!response || response.ok === false) throw new Error(response?.message || response?.error || response?.code || 'Table Management request failed.');
                return response;
            }),
            legacyCoverage: () => renderItemInquiryCoveragePanel(),
            canOpenLegacyDirectory: getManagersToolAccess().canManageCompanyDirectory === true,
            openLegacyDirectory: () => {
                if (!getManagersToolAccess().canManageCompanyDirectory) return false;
                managerTableManagementDirectOpen = true;
                try { return setHomeTab(MANAGER_COMPANY_DIRECTORY_VIEW); }
                finally { managerTableManagementDirectOpen = false; }
            },
            openTable: key => openManagerTableManagement(key)
        })
    };
}
