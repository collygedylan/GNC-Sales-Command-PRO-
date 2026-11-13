function clearSelection({ clearBloom = false } = {}) {
    isMultiSelectMode = false;
    document.body.classList.remove('multi-select-mode');
    const retained = clearBloom ? new Set() : getPersistedBloomCartIds();
    for (const domId of selectedItems) {
        if (retained.has(domId)) continue;
        requestSelectionTokens.delete(domId);
        selectedItemSources.delete(domId);
        selectedItems.delete(domId);
    }
    cartPanelOpen = false;
    bloomPickerActionsOpen = false;
    bloomShareMenuOpen = false;
    updateGlobalActionBar();
    refreshCartButtons();
    syncDriveReturnedSelectionToolbar();
}

function clearBloomPickerSelection() {
    clearPersistedBloomCart();
    clearSelection({ clearBloom: true });
    return false;
}

function confirmBloomCartClearAfterEmail(owner, rows) {
    if (owner !== getSupabaseReadIdentityScope()) return;
    const selection = getPersistedBloomCartIds();
    if (rows.some(row => selection.has(row?.DOM_ID))
        && window.confirm('Email sent. Clear the Bloom Picker selection?')) {
        clearBloomPickerSelection();
    }
}

function canToggleBloomSelectionOn(domId, sourceView) {
    const item = findItemByDomId(domId);
    const fromBloom = sourceView === 'drive-bloom';
    if ((fromBloom || isCurrentDriveCardOptionsContext(sourceView)) && !canCurrentUserSelectDriveWorkflowRow(item, 'drive')
        && !(fromBloom && canAddItemToBloomPicker(item, 'drive-bloom'))) {
        showToast('View Only', 'This Drive Mode row is not available for your workflows.', true);
        return false;
    }
    if (!getRoleAccessState().isForeman || canAddItemToBloomPicker(item, sourceView)) return true;
    showToast('Restricted', 'Foreman users can add priority Drive Mode rows to Take Back.', true);
    return false;
}

function toggleGlobalItem(domId, isChecked = null, sourceView = '') {
    const id = String(domId || '').trim();
    if (!id) return;
    if (id.startsWith('hl-order:')) {
        if (isChecked !== true) void removeHlDraftRow(id.slice(9));
        return;
    }
    restoreBloomCartSelection();
    const source = String(sourceView || '').trim().toLowerCase();
    const hadItem = selectedItems.has(id);
    const wantsAdd = isChecked === null ? !hadItem : !!isChecked;
    if (wantsAdd && !canToggleBloomSelectionOn(id, source)) return;
    if (wantsAdd) {
        selectedItems.add(id);
        selectedItemSources.set(id, source);
    } else {
        selectedItems.delete(id);
        selectedItemSources.delete(id);
    }
    if (hadItem === wantsAdd) return;
    if (wantsAdd) requestSelectionTokens.set(id, createStableClientBatchId());
    else requestSelectionTokens.delete(id);
    persistBloomCartSelection([id], !wantsAdd);
    if (!selectedItems.size) {
        cartPanelOpen = false;
        bloomPickerActionsOpen = false;
        bloomShareMenuOpen = false;
    }
    updateGlobalActionBar();
    refreshCartButtons(id);
    syncDriveReturnedSelectionToolbar();
    const count = selectedItems.size;
    const rows = `${count} row${count === 1 ? '' : 's'}`;
    if (wantsAdd) showToast('Added To Bloom Picker', `${rows} in Bloom Picker.`);
    else showToast('Removed', `${rows} left in Bloom Picker.`);
}

function initializeCartUi() {
    if (cartUiObserver) {
        cartUiObserver.disconnect();
        cartUiObserver = null;
    }
    bindBloomCartLifecycle();
    restoreBloomCartSelection();
    scheduleCartUiRefresh();
}
