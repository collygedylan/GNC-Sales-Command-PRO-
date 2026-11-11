export function inspectWatchdogFooter(view, doc, report) {
    const nav = doc.getElementById('bottom-nav');
    if (!nav) return report('UI_GEOMETRY_ANOMALY','navigation','FOOTER_MISSING');
    const viewport = view.visualViewport;
    const bottom = viewport?.height ? viewport.offsetTop + viewport.height : Math.max(view.innerHeight || 0,doc.documentElement?.clientHeight || 0);
    const editing = ['detail-measurement-keyboard-open','keyboard-open','measurement-keyboard-open'].some(key => doc.body?.classList?.contains(key))
        || (doc.activeElement?.matches?.('input,textarea,[contenteditable=true]') && viewport && viewport.height < view.innerHeight - 80);
    const style = view.getComputedStyle?.(nav);
    if (editing || style?.position === 'fixed' && parseFloat(style.bottom) === 0 || !(nav.getBoundingClientRect?.().bottom > bottom + 8)) return;
    nav.style.setProperty('position','fixed','important');
    nav.style.setProperty('bottom','0','important');
    if (nav.getBoundingClientRect().bottom > Math.max(bottom,view.innerHeight) + 8) report('UI_GEOMETRY_ANOMALY','navigation','FOOTER_OFFSCREEN');
}

export function inspectWatchdogQueueControls(toolbar, visible) {
    const select = toolbar?.querySelector?.('#que-view-select');
    if (select?.offsetWidth > 0 && visible(select)) {
        const selectable = Array.from(select.options || []).some(option =>
            String(option.value || '').trim() && !option.disabled && !option.hidden);
        return selectable ? '' : 'EMPTY_TABS';
    }
    const tabs = Array.from(toolbar?.querySelectorAll?.('.request-category-chip, [role="tab"]') || [])
        .filter(tab => tab.offsetWidth > 0 && visible(tab));
    if (!tabs.length) return 'EMPTY_TABS';
    return toolbar.clientWidth > 0 && tabs.some(tab => tab.offsetWidth >= toolbar.clientWidth * 0.90) ? 'WIDE_TAB' : '';
}
