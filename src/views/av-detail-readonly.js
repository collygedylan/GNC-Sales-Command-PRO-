export function isAvDetailSource(source) {
    return ['av', 'av-photo'].includes(String(source || '').trim().toLowerCase());
}

export function buildAvCardPhotoActivationAttrs(hasPhotos) {
    if (!hasPhotos) return '';
    return 'role="button" tabindex="0" aria-label="Open card photos" onclick="return activateAvCardPhotos(event)" onkeydown="return activateAvCardPhotos(event)"';
}

export function buildAuthorizedAvCardActivationAttrs(item, sourceView, hasPhotos) {
    if (isAvDetailSource(sourceView) && !globalThis.canEditEvidenceWorkflow?.('lsn-',item,sourceView)) {
        return buildAvCardPhotoActivationAttrs(hasPhotos);
    }
    return buildCardActivationAttrs(item.DOM_ID,item.UNIQUE_ID,sourceView === 'reserves_drill' ? 'av' : sourceView,'Open Item Detail');
}

export function activateAvCardPhotos(event) {
    if (event.type === 'keydown' && (event.repeat || !['Enter', ' '].includes(event.key))) return true;
    const photoSurface = event.type === 'click'
        && event.target.matches('.app-av-photo-carousel, .app-av-photo-track, .app-av-photo-count');
    if (!photoSurface && shouldIgnoreFastPressTarget(event)) return true;
    const preview = event.currentTarget.querySelector('button.app-av-photo-slide');
    if (!preview) return true;
    event.preventDefault();
    preview.click();
    return false;
}

export function openAvGallery(item, options = {}) {
    if (!item) return;
    const photoLink = resolveCanonicalPhotoUrls(item, 'av').join(',');
    if (!photoLink) {
        if (!options?.silentIfMissing) showToast('No Photo', 'There is no AV photo on file for this item.', true);
        return false;
    }
    openPhotoModal(photoLink, `${esc(item.COMMONNAME)} (${esc(item.CONTSIZE)}) - Loc: ${item.LOCATIONCODE || 'N/A'}`);
    return true;
}

export function openAvInventoryCardPhotos(domId, uniqueId) {
    const item = (domId && findItemByDomId(domId)) || (uniqueId && findItemByUniqueId(uniqueId));
    return openAvGallery(item, { silentIfMissing: true });
}

export function isAvDetailReadOnlyContext() {
    return isAvDetailSource(activeDetailSourceView || lastView || '')
        && ['av', 'detail'].includes(getCurrentVisibleViewId())
        && !globalThis.canEditEvidenceWorkflow?.('lsn-',activeItem);
}

export function setAvDetailControlDisabled(control, readOnly) {
    if (readOnly) {
        if (!control.hasAttribute('data-av-disabled')) control.dataset.avDisabled = String(control.disabled);
        control.disabled = true;
    } else if (control.hasAttribute('data-av-disabled')) {
        control.disabled = control.dataset.avDisabled === 'true';
        delete control.dataset.avDisabled;
    }
}

export function applyAvDetailReadOnlyState(sourceView = activeDetailSourceView || lastView || '') {
    const root = document.getElementById('view-detail');
    if (!root) return;
    const readOnly = isAvDetailSource(sourceView) && !globalThis.canEditEvidenceWorkflow?.('lsn-',activeItem);
    root.classList.toggle('detail-av-readonly', readOnly);
    const editors = ['global-inputs-container', 'det-season-content', 'det-location-content',
        'det-notes-content', 'det-request-content', 'detail-shared-panels', 'task-detail-camera-quick'];
    for (const id of editors) {
        const panel = document.getElementById(id);
        panel?.querySelectorAll('input, select, textarea, button').forEach(control => setAvDetailControlDisabled(control, readOnly));
    }
    if (!readOnly) return;
    root.querySelectorAll('#det-tabs-container .detail-tab').forEach(tab => {
        tab.classList.toggle('hidden', !['dtab-overview', 'dtab-gallery'].includes(tab.id));
    });
}

export function getPrimaryDetailTabForItemContext(item = activeItem, detailSourceView = '') {
            const safeSourceView = String(detailSourceView || activeDetailSourceView || lastView || '').trim().toLowerCase();
            const assignment = String(firstNonEmptyValue(item && item.APP_TAB_ASSIGNMENT, item && item.app_tab_assignment, '')).toLowerCase();
            if (safeSourceView === 'tasks' && activeTaskTab) return getTaskDetailTabForItem(item, activeTaskTab);
            if (safeSourceView === 'not-on-inventory') return 'not-on-inventory';
            if (safeSourceView === 'request') return 'request';
            if (safeSourceView === 'docks') return 'docks';
            if (safeSourceView === 'review' || safeSourceView === 'move-up') return 'ncr';
            if (globalThis.isAvDetailSource(safeSourceView)) return globalThis.canEditEvidenceWorkflow?.('lsn-',item,safeSourceView) ? 'location' : 'overview';
            if (safeSourceView === 'drive') return 'location';
            if (safeSourceView === 'low-stock') {
                if (assignment === 'season' && isCurrentSeasonSalesNotesRow(item)) return 'season';
                if (assignment === 'season' || assignment === 'location') return 'location';
            }
            return 'overview';
        }
