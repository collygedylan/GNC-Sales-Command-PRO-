(function installAppLifecycle(root) {
    'use strict';
    if (root.AgMetricLifecycle) return;
    // Shell maintenance must never own login or authenticated view readiness.
    root.withBootDeadline = (work, fallback = null) => new Promise(resolve => {
        const timer = root.setTimeout(() => resolve(fallback), 1200);
        Promise.resolve(work).then(value => { root.clearTimeout(timer); resolve(value); },
            () => { root.clearTimeout(timer); resolve(fallback); });
    });
    const originalFetch = typeof root.fetch === 'function' ? root.fetch.bind(root) : null;
    if (originalFetch) root.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, root.location.href);
        return originalFetch(input, url.hostname === 'kzrnyjsosryejjejliii.supabase.co'
            ? { ...init, referrerPolicy: "no-referrer" } : init);
    };
    const doc = root.document;
    const controllers = new Map(['document', 'session', 'view', 'foreground'].map(key => [key, new root.AbortController()]));
    const subscribers = new Set();
    let navigationCommitted = false;
    let viewKey = '';
    let runtimeRecoveryTimer = null;
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

    root.markAgDataRuntimeReady = () => {
        root.__AGDATA_RUNTIME_READY__ = true;
        if (runtimeRecoveryTimer) root.clearTimeout(runtimeRecoveryTimer);
        runtimeRecoveryTimer = null;
        return true;
    };

    const isShellRelease = value => /^(?:V?\d{4}\.\d{2}\.\d{2}\.\d+|AgData v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.test(value);
    const FORCED_VERSION_UPGRADE_STORAGE_KEY = 'agdata_forced_version_upgrade';
    const VERSION_RELOAD_FUSE_STORAGE_KEY = 'gnc_version_reload_fuse_v1';
    const VERSION_RELOAD_FUSE_MS = 5 * 60 * 1000;
    const normalizeAgDataVersion = value => String(value || '').trim().match(/(?:AgData\s+v|v)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))/i)?.[1] || '';
    const compareAgDataVersions = (left, right) => {
        const a = normalizeAgDataVersion(left).split('.').map(Number);
        const b = normalizeAgDataVersion(right).split('.').map(Number);
        for (let index = 0; index < 3; index += 1) {
            const delta = (a[index] || 0) - (b[index] || 0);
            if (delta) return Math.sign(delta);
        }
        return 0;
    };
    root.compareAgDataVersions = compareAgDataVersions;
    const isAuthTransitionActive = () => {
        const spinner = doc.getElementById?.('loading-spinner');
        const loginView = doc.getElementById?.('view-login');
        const spinnerVisible = !!spinner && !spinner.classList?.contains?.('hidden') && spinner.style?.display !== 'none';
        return !!doc.documentElement?.classList?.contains?.('booting-session')
            || (spinnerVisible && (!loginView || loginView.style?.display !== 'none'));
    };
    root.isAgDataAuthTransitionActive = isAuthTransitionActive;
    const recentlyReloadedForVersion = target => {
        try {
            const marker = JSON.parse(root.localStorage.getItem(VERSION_RELOAD_FUSE_STORAGE_KEY) || 'null');
            return marker?.target === target && Date.now() - Number(marker.at || 0) < VERSION_RELOAD_FUSE_MS;
        } catch (_) { return false; }
    };
    const markVersionReload = target => {
        try { root.localStorage.setItem(VERSION_RELOAD_FUSE_STORAGE_KEY, JSON.stringify({ target, at: Date.now() })); }
        catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle'); }
    };
    const clearVersionUpgradeSession = () => {
        const exactKeys = new Set([
            'gnc_user_v3', 'gnc_pin_v3', 'gnc_role_v3', 'gnc_division_v1', 'gnc_language_v1',
            'gnc_user_display_v1', 'gnc_verified_login_v1', 'gnc_native_auth_profile_v1', 'gnc_app_session_v1'
        ]);
        try {
            const keys = [];
            for (let index = 0; index < root.localStorage.length; index += 1) keys.push(root.localStorage.key(index));
            keys.filter(key => exactKeys.has(key) || /^sb-.+-auth-token$/i.test(key || '')).forEach(key => root.localStorage.removeItem(key));
            root.localStorage.setItem('gnc_explicit_logout_v1', '1');
        } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle'); }
        try { root.sessionStorage.clear(); } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle'); }
    };
    let forcedVersionUpgrade = null;
    root.forceAgDataVersionUpgrade = (targetVersion, currentVersion = '', options = {}) => {
        const target = normalizeAgDataVersion(targetVersion);
        const current = normalizeAgDataVersion(currentVersion || root.__APP_SHELL_VERSION__ || root.__APP_RELEASE_VERSION__);
        if (!target || (!options.force && (!current || compareAgDataVersions(target, current) <= 0)) || root.navigator?.onLine === false) return Promise.resolve(false);
        if (isAuthTransitionActive() || activeSession()) {
            root.__gncShellUpdateReady = true;
            return Promise.resolve(false);
        }
        if (recentlyReloadedForVersion(target)) {
            root.__gncShellUpdateReady = true;
            return Promise.resolve(false);
        }
        try {
            if (current === target && root.localStorage.getItem(FORCED_VERSION_UPGRADE_STORAGE_KEY) === target) return Promise.resolve(false);
            root.localStorage.setItem(FORCED_VERSION_UPGRADE_STORAGE_KEY, target);
        } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle'); }
        if (forcedVersionUpgrade) return forcedVersionUpgrade;
        forcedVersionUpgrade = (async () => {
            const reachable = await root.withBootDeadline(root.fetch?.('./index.html?verify=' + encodeURIComponent(target), { cache: 'no-store' }));
            if (!reachable || reachable.status !== 200) return false;
            const shellText = await root.withBootDeadline(reachable.text(), '');
            if (!shellText.includes('AgData v' + target)) return false;
            suspendNavigation();
            clearVersionUpgradeSession();
            markVersionReload(target);
            // Retire only owned generations after the worker's complete 200-response receipt.
            const targetCache = 'agdata-v' + target;
            const installed = await root.caches?.open?.(targetCache);
            const complete = await installed?.match?.('./__agdata_shell_install_complete__');
            if (complete?.status === 200 && (await complete.text()) === 'AgData v' + target) {
                const keys = (await root.caches.keys()).filter(key => key !== targetCache && /^(?:agdata-(?:v|shell-)|ag-data-v4\.3-rebuild-)/.test(key));
                await Promise.all(keys.map(key => root.caches.delete(key)));
                const registrations = (await root.navigator?.serviceWorker?.getRegistrations?.() || []).filter(isOwnedShellRegistration);
                await Promise.all(registrations.map(registration => registration.unregister()));
            }
            const next = new URL(root.location.href);
            next.search = '';
            next.searchParams.set('v', target);
            next.searchParams.set('shellv', `AgData v${target}`);
            next.searchParams.set('_reload', String(Date.now()));
            root.location.replace(`${next.pathname}?${next.searchParams.toString()}${next.hash}`);
            return true;
        })();
        return forcedVersionUpgrade;
    };
    let versionCheck = null;
    root.checkAgDataVersion = reason => {
        if (versionCheck || root.navigator?.onLine === false) return versionCheck || Promise.resolve(false);
        versionCheck = Promise.resolve().then(async () => {
            const response = await root.fetch(`./deployment-fingerprint.json?t=${Date.now()}`, {
                cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' }
            });
            if (!response?.ok) return false;
            const payload = await response.json();
            return root.forceAgDataVersionUpgrade(payload?.release, root.__APP_SHELL_VERSION__ || root.__APP_RELEASE_VERSION__, { reason });
        }).catch(() => false).finally(() => { versionCheck = null; });
        return versionCheck;
    };
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
    const activeSession = () => {
        try { return root.isAuthenticatedAppSessionActive?.() === true; } catch (_) { return false; }
    };
    // One reload owner per document; the worker's version reply can refine the
    // target during the short toast, even when its registration URL is older.
    root.reloadForServiceWorkerUpdate = targetBuild => {
        const target = String(targetBuild || '').trim();
        if (isShellRelease(target)) root.__gncPwaTargetBuild = target;
        if (activeSession() || isAuthTransitionActive()) { root.__gncShellUpdateReady = true; return false; }
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
            if (activeSession()) { root.__gncPwaReloadPending = false; root.__gncShellUpdateReady = true; return; }
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
        // Keep the active worker and downloaded shell available during origin failures.
        const registration = await root.withBootDeadline(root.navigator?.serviceWorker?.getRegistration?.('./'));
        if (registration) void root.withBootDeadline(registration.update?.());
        return Boolean(safeTarget);

    };

    let appLoadRecovery = null;
    root.recoverAppLoadFailure = reason => {
        if (isAuthTransitionActive() || activeSession()) {
            root.__gncShellUpdateReady = true;
            return Promise.resolve(false);
        }
        if (appLoadRecovery) return appLoadRecovery;
        const safeReason = String(reason || 'runtime-load-failure').trim().slice(0, 48) || 'runtime-load-failure';
        const marker = `${root.__APP_SHELL_VERSION__ || 'current'}:${safeReason}`;
        try {
            if (root.sessionStorage.getItem('gnc_app_load_recovery_v1') === marker) return Promise.resolve(false);
            root.sessionStorage.setItem('gnc_app_load_recovery_v1', marker);
        } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'app-lifecycle'); }
        appLoadRecovery = (async () => {
            suspendNavigation();
            await root.clearOwnedShellControllerState('');
            const next = new URL(root.location.href);
            next.searchParams.set('shellv', String(root.__APP_SHELL_VERSION__ || 'latest'));
            next.searchParams.set('shellts', String(Date.now()));
            next.searchParams.set('shellreason', safeReason);
            try { root.location.replace(next.toString()); }
            catch (_) { root.location.reload(true); }
            return true;
        })();
        return appLoadRecovery;
    };

    doc.addEventListener('click', event => {
        const target = event.target?.closest?.('button,a');
        if (String(target?.textContent || '').trim().toLowerCase() !== 'reload app') return;
        event.preventDefault();
        event.stopImmediatePropagation?.();
        void root.recoverAppLoadFailure('reload-app');
    }, true);

    root.addEventListener('error', event => {
        if (root.__AGDATA_RUNTIME_READY__ === true) return;
        const source = String(event?.filename || event?.target?.src || '');
        if (/\/assets\/app-runtime\.js(?:\?|$)/i.test(source)) void root.recoverAppLoadFailure('runtime-script-error');
    }, true);

    const armRuntimeRecovery = () => {
        if (root.__AGDATA_RUNTIME_READY__ === true || runtimeRecoveryTimer) return;
        runtimeRecoveryTimer = root.setTimeout(() => {
            runtimeRecoveryTimer = null;
            if (root.__AGDATA_RUNTIME_READY__ !== true && !isAuthTransitionActive() && !activeSession()) {
                void root.recoverAppLoadFailure('runtime-not-ready');
            }
        }, 8000);
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', armRuntimeRecovery, { once: true });
    else armRuntimeRecovery();

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
            const registration = await root.withBootDeadline(registrationPromise);
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
        if (activeSession()) return root.forceAgDataVersionUpgrade(target, current, { reason: 'service-worker-version-mismatch' });
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
