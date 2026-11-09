export function loadPoManagementData(force = false) {
    if (typeof shouldUseProductionLiveSyncSideLoad === 'function' && shouldUseProductionLiveSyncSideLoad()) {
        const options = { state: poManagementState, context: { poSeason: poManagementState.season, explicitPoRead: true } };
        return ensureProductionLiveSyncSideData('po', force || !poManagementState.loaded, options).then(() => {
            if ((poManagementState.loaded || poManagementState.error) && isViewVisible('po-management')) renderPoManagement();
            return poManagementState;
        });
    }
    if (poManagementState.promise && !force) return poManagementState.promise;
    if (poManagementState.loaded && !force) return Promise.resolve(poManagementState);
    poManagementState.loading = true;
    poManagementState.error = '';
    const state = poManagementState, season = state.season, owner = getSupabaseReadIdentityScope();
    const current = () => state === poManagementState && owner === getSupabaseReadIdentityScope();
    state.promise = (async () => {
        try {
            const rows = await fetchPoManagementRows(season);
            if (!current()) return state;
            state.rows = rows;
            state.loaded = true;
        } catch (error) {
            if (current()) state.error = getPoManagementLoadErrorMessage(error);
        } finally {
            state.loading = false;
            state.promise = null;
            if (current() && isViewVisible('po-management')) renderPoManagement();
        }
        return state;
    })();
    return state.promise;
}
