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

    const isShellRelease = value => /^(?:V?\d{4}\.\d{2}\.\d{2}\.\d+|AgData v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.test(value);
    // Filters are disposable UI state. Auth, inventory, drafts and outboxes are not.
    root.invalidateAppFiltersForVersion = targetBuild => {
        const target = String(targetBuild || '').trim();
        if (!isShellRelease(target)) return false;
        let updated = false;
        for (const storageName of ['localStorage', 'sessionStorage']) {
            try {
                const storage = root[storageName];
                const previous = storage.getItem('gnc_app_filter_version_v1') || '';
                const keys = [];
                for (let index = 0; index < storage.length; index += 1) {
                    const key = storage.key(index);
                    if (key === 'gnc_app_filter_state_v1' || key?.startsWith('gnc_app_filter_state_v1:')) keys.push(key);
                }
                // Unversioned legacy snapshots are also obsolete on first use.
                if (previous !== target) for (const key of keys) storage.removeItem(key);
                storage.setItem('gnc_app_filter_version_v1', target);
                updated = true;
            } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle');}
        }
        return updated;
    };
    // One reload owner per document; the worker's version reply can refine the
    // target during the short toast, even when its registration URL is older.
    root.reloadForServiceWorkerUpdate = targetBuild => {
        const target = String(targetBuild || '').trim();
        if (isShellRelease(target)) root.__gncPwaTargetBuild = target;
        if (root.__gncPwaReloadPending) return false;
        root.__gncPwaReloadPending = true;
        if (!root.__gncShellUpdateToastShown && typeof root.showToast === 'function') {
            try { root.showToast('Updating', 'New version detected. Updating...', false); } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle');}
        } else if (!root.__gncShellUpdateToastShown && doc.body) {
            const toast = doc.createElement('div');
            toast.setAttribute('role', 'status');
            toast.textContent = 'New version detected. Updating...';
            toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:99999;padding:12px 16px;border-radius:12px;background:#16372a;color:#fff;pointer-events:none';
            doc.body.appendChild(toast);
        }
        root.__gncShellUpdateToastShown = true;
        root.setTimeout(() => {
            const nextBuild = root.__gncPwaTargetBuild || root.__APP_SHELL_BUILD__ || root.__APP_SHELL_VERSION__;
            root.invalidateAppFiltersForVersion(nextBuild);
            if (nextBuild) {
                try {
                    const next = new URL(root.location.href);
                    next.searchParams.set('shellv', nextBuild);
                    next.searchParams.set('shellts', String(Date.now()));
                    root.history.replaceState(root.history.state, '', next.toString());
                } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle');}
            }
            root.location.reload();
        }, 700);
        return true;
    };

    function isOwnedShellRegistration(registration) {
        try {
            const appScope = new URL('./', root.location.href);
            const expectedScript = new URL('./sw.js', root.location.href);
            const scope = new URL(registration?.scope || '');
            if (scope.origin !== appScope.origin || scope.href !== appScope.href) return false;
            const worker = registration.active || registration.waiting || registration.installing;
            const script = new URL(worker?.scriptURL || '');
            return script.origin === expectedScript.origin && script.pathname === expectedScript.pathname;
        } catch (_) { return false; }
    }

    root.clearOwnedShellControllerState = async targetBuild => {
        const safeTarget = String(targetBuild || '').trim();
        const prefix = 'ag-data-v4.3-rebuild-';
        try {
            const serviceWorker = root.navigator?.serviceWorker;
            if (typeof serviceWorker?.getRegistrations === 'function') {
                const registrations = await serviceWorker.getRegistrations();
                await Promise.allSettled(registrations.filter(isOwnedShellRegistration)
                    .map(registration => registration.unregister()));
            }
        } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle');}
        try {
            if (typeof root.caches?.keys === 'function' && typeof root.caches?.delete === 'function') {
                const keys = await root.caches.keys();
                const obsoleteShellCaches = keys.filter(key => key.startsWith(prefix)
                    && (!safeTarget || !key.includes(safeTarget)));
                await Promise.allSettled(obsoleteShellCaches.map(key => root.caches.delete(key)));
            }
        } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle');}
        root.__swReg = null;
        return true;
    };

    root.registerGncServiceWorkerSafely = async (serviceWorker, scriptUrl, options, handlers = {}) => {
        const unavailable = reason => {
            try { handlers.onUnavailable?.(reason); } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle');}
            return null;
        };
        if (typeof serviceWorker?.register !== 'function') return unavailable('registration-api-unavailable');
        try {
            const registrationPromise = serviceWorker.register(scriptUrl, options);
            if (!registrationPromise || typeof registrationPromise.then !== 'function') {
                return unavailable('registration-promise-unavailable');
            }
            const registration = await registrationPromise;
            if (!registration || typeof registration !== 'object') return unavailable('registration-result-unavailable');
            return registration;
        } catch (error) {
            try { handlers.onError?.(error); } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle');}
            return null;
        }
    };

    // Available before the application runtime, including when an old runtime fails.
    // CacheStorage contains downloaded assets; IndexedDB contains unsent field work.
    let shellRecovery = null;
    root.recoverShellVersionMismatch = (currentBuild, targetBuild) => {
        if (root.__gncPwaReloadPending) return Promise.resolve(false);
        const current = String(currentBuild || '').trim();
        const target = String(targetBuild || '').trim();
        if (!current || current === target || !isShellRelease(target)
            || root.navigator?.onLine === false) return Promise.resolve(false);
        if (shellRecovery) return Promise.resolve(false);
        const marker = `${current}:${target}`;
        const next = new URL(root.location.href);
        if (next.searchParams.get('shellrecovered') === marker) return Promise.resolve(false);
        try {
            if (root.sessionStorage.getItem('gnc_shell_recovery_v1') === marker) return Promise.resolve(false);
            root.sessionStorage.setItem('gnc_shell_recovery_v1', marker);
        } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle'); /* The URL also bounds recovery when storage is disabled. */ }
        shellRecovery = (async () => {
            suspendNavigation();
            await root.clearOwnedShellControllerState(target);
            next.searchParams.set('shellv', target);
            next.searchParams.set('shellts', String(Date.now()));
            next.searchParams.set('shellrecovered', marker);
            // reload(true) is ignored by some browsers; a fresh URL also bypasses HTTP caches.
            try {
                root.history.replaceState(root.history.state, '', next.toString());
                root.location.reload(true);
            } catch (_) { root.location.replace(next.toString()); }
            return true;
        })();
        return shellRecovery;
    };
})(typeof window !== 'undefined' ? window : globalThis);
