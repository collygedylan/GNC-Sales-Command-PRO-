(function installAppLifecycle(root) {
    'use strict';
    if (root.AgMetricLifecycle) return;
    const doc = root.document;
    const controllers = new Map(['document', 'session', 'view', 'foreground'].map(key => [key, new root.AbortController()]));
    const subscribers = new Set();
    let navigationCommitted = false;
    let viewKey = '';
    const signal = kind => {
        if (!controllers.has(kind)) throw new TypeError('Unknown lifecycle lifetime.');
        return controllers.get(kind).signal;
    };
    const abort = kind => controllers.get(kind).abort();
    const renew = kind => { if (signal(kind).aborted) controllers.set(kind, new root.AbortController()); };
    const notify = (type, reason) => {
        for (const fn of [...subscribers]) {
            try { fn({ type, reason }); } catch (error) { root.console?.error('Lifecycle subscriber failed.', error); }
        }
    };
    function suspendNavigation(committed = true) {
        navigationCommitted = navigationCommitted || committed;
        for (const key of controllers.keys()) abort(key);
        notify('suspend', committed ? 'pagehide' : 'beforeunload');
    }
    function resume(event) {
        if (!event.isTrusted) return;
        if (event.type === 'pageshow') navigationCommitted = false;
        if (doc.hidden || navigationCommitted) return;
        const suspended = signal('document').aborted;
        for (const key of controllers.keys()) renew(key);
        if (suspended || event.type === 'focus' || event.type === 'pageshow') notify('resume', event.type);
    }
    function resetSession() {
        for (const key of ['session', 'view']) {
            abort(key);
            if (!signal('document').aborted) renew(key);
        }
        viewKey = '';
        notify('session', 'session-reset');
    }
    function enterView(key) {
        const next = String(key || '');
        if (next === viewKey) return;
        viewKey = next;
        abort('view');
        if (!signal('document').aborted) renew('view');
        notify('view', 'view-change');
    }
    function createScope({ lifetime = 'view', foreground = false } = {}) {
        if (!['document', 'session', 'view'].includes(lifetime)) throw new TypeError('Unknown lifecycle lifetime.');
        const controller = new root.AbortController();
        const cleanups = new Set();
        const parents = ['document', ...(lifetime !== 'document' ? ['session'] : []), ...(lifetime === 'view' ? ['view'] : []), ...(foreground ? ['foreground'] : [])].map(signal);
        const dispose = () => {
            controller.abort();
            for (const cleanup of [...cleanups]) cleanup();
            cleanups.clear();
        };
        const isCurrent = () => !controller.signal.aborted && parents.every(parent => !parent.aborted);
        for (const parent of parents) {
            parent.addEventListener('abort', dispose, { once: true });
            cleanups.add(() => parent.removeEventListener('abort', dispose));
        }
        if (parents.some(parent => parent.aborted) || foreground && doc.hidden) dispose();
        const guard = fn => (...args) => isCurrent() ? fn(...args) : undefined;
        function schedule(fn, delay, idle) {
            if (!isCurrent()) return () => {};
            const useIdle = idle && typeof root.requestIdleCallback === 'function';
            let id;
            const cancel = () => {
                if (useIdle) root.cancelIdleCallback?.(id);
                else root.clearTimeout(id);
                cleanups.delete(cancel);
            };
            const run = (...args) => { cleanups.delete(cancel); if (isCurrent()) fn(...args); };
            id = useIdle ? root.requestIdleCallback(run, delay) : root.setTimeout(run, idle ? 0 : delay);
            cleanups.add(cancel);
            return cancel;
        }
        return Object.freeze({ signal: controller.signal, isCurrent, guard, dispose,
            timeout: (fn, ms = 0) => schedule(fn, ms, false),
            idle: (fn, options = {}) => schedule(fn, options, true) });
    }
    root.AgMetricLifecycle = Object.freeze({ getSignal: (kind = 'document') => signal(kind),
        suspendNavigation, resetSession, enterView, createScope,
        subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); } });
    // Compatibility adapters: existing callers share this owner, not another controller.
    root.getShellMaintenanceSignal = () => signal('document');
    root.suspendShellMaintenanceForNavigation = suspendNavigation;
    root.addEventListener('beforeunload', () => suspendNavigation(false));
    root.addEventListener('pagehide', () => suspendNavigation());
    root.addEventListener('pageshow', resume);
    root.addEventListener('focus', resume);
    doc.addEventListener('pointerdown', resume, { capture: true, passive: true });
    doc.addEventListener('keydown', resume, { capture: true });
    doc.addEventListener('visibilitychange', event => {
        if (doc.hidden) abort('foreground');
        else resume(event);
        notify('visibility', doc.hidden ? 'hidden' : 'visible');
    });
    root.addEventListener('online', () => notify('online', 'online'));
    root.addEventListener('offline', () => notify('offline', 'offline'));
})(typeof window !== 'undefined' ? window : globalThis);
