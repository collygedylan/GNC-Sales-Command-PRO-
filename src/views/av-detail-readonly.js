export function isAvDetailSource(source) {
    return ['av', 'av-photo'].includes(String(source || '').trim().toLowerCase());
}

export function isAvDetailReadOnlyContext() {
    return isAvDetailSource(activeDetailSourceView || lastView || '')
        && ['av', 'detail'].includes(getCurrentVisibleViewId());
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
    const readOnly = isAvDetailSource(sourceView);
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
