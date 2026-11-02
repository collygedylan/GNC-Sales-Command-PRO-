(function installAgDataKernel(root) {
    'use strict';
    const kernel = root.AgDataKernel || { state: {}, sync: {}, watchdog: {}, metrics: {} };
    function shouldAcceptRevision(committedRevision, incomingRevision, hasRowDelta = false) {
        return !!hasRowDelta || !incomingRevision || incomingRevision !== committedRevision;
    }
    function createViewRenderScheduler(options) {
        const dirtyViews = new Set();
        const pending = new Map();
        const signatures = new Map();
        let queued = false;
        let epoch = 0;
        const enqueue = options.enqueue || (callback => queueMicrotask(callback));
        function scheduleCoalescedViewRender(view, render, signature) {
            dirtyViews.add(view);
            options.markDirty?.(view);
            if (view !== options.getActiveView()) return false;
            pending.set(view, { render, signature });
            if (queued) return true;
            queued = true;
            const scheduledEpoch = epoch;
            enqueue(() => {
                if (scheduledEpoch !== epoch) return;
                queued = false;
                const active = options.getActiveView();
                const callback = pending.get(active);
                pending.clear();
                if (!callback) return;
                dirtyViews.delete(active);
                if (callback.signature !== undefined && signatures.get(active) === callback.signature) return;
                try { const result=callback.render(); if (result !== false && callback.signature !== undefined) signatures.set(active, callback.signature); }
                catch (_) { options.onError?.(); }
            });
            return true;
        }
        return { scheduleCoalescedViewRender, dirtyViews, reset() { epoch++; queued = false; pending.clear(); dirtyViews.clear(); signatures.clear(); } };
    }
    Object.assign(kernel.sync, { createViewRenderScheduler, shouldAcceptRevision });
    root.AgDataKernel = kernel;
    if (typeof module === 'object' && module.exports) module.exports = kernel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
