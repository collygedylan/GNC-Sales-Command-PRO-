export function resolveDetailKeypadInsertion(type, { value, start, end }, key) {
    let inserted = String(key || '');
    const emptyMeasurement = ['', 'N/A', '-'].includes(value.trim().toUpperCase());
    if (['spec', 'caliper'].includes(type) && ['"', "'"].includes(inserted)
        && (emptyMeasurement || !/\d/.test(value.slice(0, start)))) {
        return { nextValue: value, nextCursor: start };
    }
    if (inserted && emptyMeasurement) {
        value = '';
        start = end = 0;
    }
    if (['spec', 'caliper'].includes(type) && ['H', 'W', 'x', 'HxW'].includes(inserted)) {
        const prefix = start > 0 && !/\s/.test(value[start - 1]) ? ' ' : '';
        const suffix = inserted === 'x' && !/^\s/.test(value.slice(end)) ? ' ' : '';
        inserted = prefix + inserted + suffix;
    }
    return { nextValue: value.slice(0, start) + inserted + value.slice(end), nextCursor: start + inserted.length };
}

let pinnedDetailField = null;

export function releasePinnedDetailField() {
    if (!pinnedDetailField) return;
    const { input, style, placeholder } = pinnedDetailField;
    if (style === null) input.removeAttribute('style');
    else input.setAttribute('style', style);
    placeholder.remove();
    pinnedDetailField = null;
}

export function pinActiveDetailField(input) {
    if (!input?.closest('#view-detail') || !input.isConnected) return;
    if (pinnedDetailField?.input !== input) {
        releasePinnedDetailField();
        const rect = input.getBoundingClientRect();
        const placeholder = document.createElement('span');
        placeholder.style.cssText = `display:block;width:${rect.width}px;height:${rect.height}px`;
        input.before(placeholder);
        pinnedDetailField = { input, placeholder, style:input.getAttribute('style') };
    }
    const viewport = window.visualViewport;
    const rect = pinnedDetailField.placeholder.getBoundingClientRect();
    const summary = document.querySelector('#request-detail-info .request-reference-bar');
    const summaryBottom = summary?.getBoundingClientRect().bottom || 0;
    const visualTop = viewport?.offsetTop || 0;
    const bottom = visualTop + (viewport?.height || window.innerHeight) - getDetailMeasurementKeyboardVisibleHeight();
    const top = Math.min(Math.max(visualTop + 64, summaryBottom + 6), bottom - Math.min(rect.height, 96) - 8);
    const width = Math.min(rect.width, (viewport?.width || window.innerWidth) - 16);
    const left = Math.max(8, Math.min(rect.left, (viewport?.width || window.innerWidth) - width - 8));
    input.style.cssText = `position:fixed!important;top:${Math.max(visualTop,top)}px!important;left:${left}px!important;width:${width}px!important;height:${Math.min(rect.height,96)}px!important;z-index:81!important;margin:0!important;color:#FACC15!important;-webkit-text-fill-color:#FACC15!important;font-weight:800!important;background:#064e3b!important`;
}

export function initializePinnedDetailFields() {
    document.addEventListener('focusout', event => {
        if (event.target === pinnedDetailField?.input) releasePinnedDetailField();
    });
    document.addEventListener('beforeinput', event => {
        const input = event.target;
        if (!input?.closest?.('#view-detail') || !event.inputType?.startsWith('insert')) return;
        if (String(input.value).trim().toUpperCase() === 'N/A') input.value = '';
    });
}

export function bringFocusedDetailFieldIntoView(target, options = {}) {
    if (!isDetailEditableField(target)) return;
    if (shouldSkipDetailFieldAutoScroll(target, options) && document.activeElement !== target) return;
    if (detailFieldBringIntoViewTimer) clearTimeout(detailFieldBringIntoViewTimer);
    const run = () => {
        if (!isDetailEditableField(target) || !target.isConnected) return;
        if (document.activeElement === target || target === detailMeasurementKeyboardTarget) {
            pinActiveDetailField(target);
            rememberDetailFieldAutoScroll(target);
            return;
        }
        const viewport = window.visualViewport;
        const bottom = (viewport?.height || window.innerHeight) + (viewport?.offsetTop || 0);
        scrollDetailFieldWithinMainArea(target, 64, bottom);
    };
    requestAnimationFrame(run);
    if (options.followUp === false || isDetailFieldAutoScrollTyping(options)) return;
    detailFieldBringIntoViewTimer = setTimeout(() => {
        detailFieldBringIntoViewTimer = null;
        run();
    }, Math.max(80, Number(options.followUpDelay) || 140));
}
