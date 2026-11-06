(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.GncCustomerMappingLiveEvents = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function dispatch(target, state) {
        if (!target || target.isConnected !== true || !state || state.authorized !== true || state.visible !== true
            || state.view !== 'managers' || state.tab !== 'customer-rep-map'
            || !/^\d+$/.test(String(state.revision ?? ''))) return false;
        const EventClass = target.ownerDocument?.defaultView?.CustomEvent || globalThis.CustomEvent;
        if (typeof EventClass !== 'function') return false;
        target.dispatchEvent(new EventClass('mapping-revision', {
            detail: Object.freeze({ revision: String(state.revision) })
        }));
        return true;
    }

    return Object.freeze({ dispatch });
});
