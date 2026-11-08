export function releaseManagerTablePinnedLayout(view) {
    if (!view || view.id !== 'view-managers') return;
    view.classList.remove('agdata-pinned-view');
    view.querySelectorAll('.agdata-results-host,.agdata-results-scroll,.agdata-results-bridge').forEach(node => {
        node.classList.remove('agdata-results-host','agdata-results-scroll','agdata-results-bridge');
    });
}

export function applyUniversalPinnedResultsLayout(document, viewId, releaseRail) {
    const view = document.getElementById('view-' + viewId);
    const resultIds = {
        av:'av-content', drive:'drive-content', request:'request-content', docks:'docks-content',
        reports:'reports-content', 'smart-moves':'smart-moves-intelligence-panel'
    };
    const result = document.getElementById(resultIds[viewId] || '');
    const enabled = !!(view && result && !view.classList.contains('hidden'));
    document.body.classList.toggle('agdata-pinned-results', enabled);
    releaseManagerTablePinnedLayout(view);
    if (!enabled) return false;
    view.classList.add('agdata-pinned-view');
    const nestedScroll = viewId === 'smart-moves'
        ? result.querySelector('.sales-intelligence-cards') : null;
    result.classList.toggle('agdata-results-host', !!nestedScroll);
    result.classList.toggle('agdata-results-scroll', !nestedScroll);
    if (nestedScroll) nestedScroll.classList.add('agdata-results-scroll');
    for (let parent = result.parentElement; parent && parent !== view; parent = parent.parentElement) {
        parent.classList.add('agdata-results-bridge');
    }
    view.querySelectorAll('.fixed-filter-rail').forEach(releaseRail);
    view.querySelectorAll('.fixed-filter-spacer').forEach(spacer => spacer.remove());
    view.querySelectorAll('.freeze-panel').forEach(rail => {
        releaseRail(rail);
        rail.style.setProperty('--freeze-panel-offset', '0px');
    });
    const chrome = '.sticky-search,.amazon-search-host,.status-banner,.summary-strip,.toolbar-slot,.empty-banner';
    view.querySelectorAll(chrome).forEach(slot => {
        const hasText = String(slot.textContent || '').trim().length > 0;
        const hasControl = !!slot.querySelector('input,select,textarea,button,img,canvas,video');
        slot.classList.toggle('agdata-empty-chrome-slot', !hasText && !hasControl);
    });
    return true;
}
