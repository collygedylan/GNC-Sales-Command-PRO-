(function installLoginTrace(root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root && typeof root === 'object') root.GncLoginTrace = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function createLoginTrace(root) {
    'use strict';

    const MAX_ATTEMPTS = 3;
    const MAX_EVENTS = 128;
    const MAX_AGE_MS = 120000;
    const PHASES = new Set([
        'native-sign-in', 'profile', 'session-read', 'session-bridge',
        'request-capabilities', 'access-permissions', 'remote-login',
        'cached-login', 'password-change'
    ]);
    const PHASE_ALIASES = Object.freeze({
        capabilities: 'request-capabilities',
        access: 'access-permissions'
    });
    const KINDS = new Set(['password', 'restore', 'passkey', 'password-change']);
    const OUTCOMES = new Set(['shell-ready', 'failed', 'password-change-required', 'timed-out', 'superseded']);
    const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
    const ERROR_CLASSES = new Set(['AbortError', 'TimeoutError', 'TypeError', 'Error']);
    const nativeFetch = typeof root?.fetch === 'function' ? root.fetch.bind(root) : null;
    let apiFetch = null;
    let configured = { supabaseOrigin: '', appApiOrigin: '', appApiPath: '', release: '' };
    let attempts = [];
    let active = null;
    let nextAttemptId = 1;

    function now() {
        try {
            const value = root?.performance?.now?.();
            return Number.isFinite(value) ? value : Date.now();
        } catch (_) { return Date.now(); }
    }

    function round(value) {
        return Number.isFinite(Number(value)) ? Math.round(Number(value) * 10) / 10 : null;
    }

    function configuredUrl(value) {
        try {
            const parsed = new URL(String(value || ''), root?.location?.href || 'https://invalid.local/');
            if (!/^https?:$/.test(parsed.protocol) || parsed.origin === 'https://invalid.local') return null;
            return parsed;
        } catch (_) { return null; }
    }

    function canonicalPhase(value) {
        const name = String(value || '');
        const canonical = PHASE_ALIASES[name] || name;
        return PHASES.has(canonical) ? canonical : '';
    }

    function sanitizedRelease(value) {
        const text = String(value || '').trim();
        return /^V\d{4}\.\d{2}\.\d{2}\.\d{3}$/.test(text) ? text : '';
    }

    function configure(options = {}) {
        try {
            const supabase = configuredUrl(options.supabaseUrl);
            const appApi = configuredUrl(options.appApiUrl);
            configured = {
                supabaseOrigin: supabase ? supabase.origin : '',
                appApiOrigin: appApi ? appApi.origin : '',
                appApiPath: appApi ? appApi.pathname.replace(/\/$/, '') || '/' : '',
                release: sanitizedRelease(options.release)
            };
        } catch (_) {
            configured = { supabaseOrigin: '', appApiOrigin: '', appApiPath: '', release: '' };
        }
        return true;
    }

    function safeCall(callback) {
        try { return callback(); } catch (_) { return undefined; }
    }

    function flushPendingResourceTimings(target = active) {
        if (!target || !target.active) return;
        safeCall(() => {
            const entries = root.performance?.getEntriesByType?.('resource') || [];
            for (const entry of entries) {
                if (!entry || !Number.isFinite(Number(entry.startTime)) || entry.startTime < target.startedAt) continue;
                const label = endpointLabel(entry.name);
                if (!label) continue;
                const key = `${label}|${round(entry.startTime)}|${round(entry.duration)}`;
                if (target.resourceKeys.has(key)) continue;
                target.resourceKeys.add(key);
                const requestStart = Number(entry.requestStart);
                append(target, {
                    type: 'resource-timing',
                    endpoint: label,
                    startOffsetMs: round(entry.startTime - target.startedAt),
                    durationMs: round(entry.duration),
                    networkStartAvailable: Number.isFinite(requestStart) && requestStart > 0,
                    requestStartOffsetMs: Number.isFinite(requestStart) && requestStart > 0 ? round(requestStart - target.startedAt) : null,
                    responseStartOffsetMs: Number(entry.responseStart) > 0 ? round(Number(entry.responseStart) - target.startedAt) : null,
                    responseEndOffsetMs: Number(entry.responseEnd) > 0 ? round(Number(entry.responseEnd) - target.startedAt) : null,
                    transferSize: nonnegative(entry.transferSize),
                    encodedBodySize: nonnegative(entry.encodedBodySize),
                    decodedBodySize: nonnegative(entry.decodedBodySize)
                });
            }
        });
    }

    function nonnegative(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
    }

    function endpointLabel(input) {
        try {
            const raw = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input || '');
            const url = new URL(raw, root?.location?.href || 'https://invalid.local/');
            if (configured.supabaseOrigin && url.origin === configured.supabaseOrigin) {
                if (url.pathname === '/auth/v1/token') return 'auth-token';
                if (url.pathname === '/auth/v1/user') return 'auth-user';
                if (url.pathname === '/rest/v1/profiles') return 'profiles';
                if (url.pathname === '/rest/v1/rpc/get_request_capabilities') return 'request-capabilities';
                if (url.pathname === '/rest/v1/rpc/get_my_app_permissions_v1') return 'access-permissions';
            }
            if (configured.appApiOrigin && url.origin === configured.appApiOrigin && url.pathname === configured.appApiPath) return 'app-api';
        } catch (_) { /* Unparseable and unapproved URLs are deliberately ignored. */ }
        return '';
    }

    function append(target, event) {
        if (!target || !target.active || target.events.length >= MAX_EVENTS) {
            if (target && target.active) target.droppedEvents += 1;
            return null;
        }
        try { target.events.push(event); return event; } catch (_) { target.droppedEvents += 1; return null; }
    }

    function stopObserver(target) {
        if (!target) return;
        safeCall(() => target.observer?.disconnect?.());
        target.observer = null;
    }

    function finish(outcome) {
        const target = active;
        if (!target || !target.active) return false;
        const normalized = OUTCOMES.has(String(outcome || '')) ? String(outcome) : 'failed';
        safeCall(() => flushPendingResourceTimings(target));
        target.finishedOffsetMs = round(now() - target.startedAt);
        target.outcome = normalized;
        target.active = false;
        if (target.expiryTimer != null) safeCall(() => root.clearTimeout?.(target.expiryTimer));
        target.expiryTimer = null;
        stopObserver(target);
        active = null;
        return true;
    }

    function expireIfNeeded() {
        if (active && active.active && now() - active.startedAt >= MAX_AGE_MS) finish('timed-out');
    }

    function begin(kind) {
        expireIfNeeded();
        if (active) finish('superseded');
        const normalizedKind = KINDS.has(String(kind || '')) ? String(kind) : 'password';
        const startedAt = now();
        const attempt = {
            id: nextAttemptId++, kind: normalizedKind, release: configured.release,
            startedAt, startedAtIso: safeCall(() => new Date().toISOString()) || '',
            finishedOffsetMs: null, outcome: 'active', active: true, events: [], droppedEvents: 0,
            resourceKeys: new Set(), observer: null, observerAvailable: false, expiryTimer: null,
            requestSequence: 0, activePhases: new Map(), nextPhaseToken: 0
        };
        attempts.push(attempt);
        if (attempts.length > MAX_ATTEMPTS) attempts = attempts.slice(-MAX_ATTEMPTS);
        active = attempt;
        try {
            const Observer = root?.PerformanceObserver;
            if (typeof Observer === 'function') {
                attempt.observer = new Observer((list) => safeCall(() => {
                    if (active !== attempt || !attempt.active) return;
                    for (const entry of list.getEntries()) {
                        append(attempt, {
                            type: 'long-task',
                            startOffsetMs: round(entry.startTime - attempt.startedAt),
                            durationMs: round(entry.duration)
                        });
                    }
                }));
                attempt.observer.observe({ type: 'longtask', buffered: false });
                attempt.observerAvailable = true;
            }
        } catch (_) {
            attempt.observerAvailable = false;
            stopObserver(attempt);
        }
        try {
            if (typeof root?.setTimeout === 'function') {
                attempt.expiryTimer = root.setTimeout(() => {
                    if (active === attempt) finish('timed-out');
                }, MAX_AGE_MS);
            }
        } catch (_) { attempt.expiryTimer = null; }
        return attempt.id;
    }

    function settlePhase(target, event, startedAt, phaseToken, outcome) {
        safeCall(() => {
            if (event) {
                event.durationMs = round(now() - startedAt);
                event.outcome = outcome;
            }
            target.activePhases.delete(phaseToken);
            flushPendingResourceTimings(target);
        });
    }

    function measure(name, task) {
        const callback = typeof task === 'function' ? task : () => task;
        expireIfNeeded();
        const phaseName = canonicalPhase(name);
        if (!active || !phaseName) return callback();
        const target = active;
        const startedAt = now();
        const phaseToken = ++target.nextPhaseToken;
        target.activePhases.set(phaseToken, phaseName);
        const phaseEvent = append(target, {
            type: 'phase', name: phaseName,
            startOffsetMs: round(startedAt - target.startedAt), durationMs: null, outcome: 'pending'
        });
        let value;
        try { value = callback(); }
        catch (error) {
            settlePhase(target, phaseEvent, startedAt, phaseToken, 'rejected');
            throw error;
        }
        const then = value && safeCall(() => value.then);
        if (typeof then !== 'function') {
            settlePhase(target, phaseEvent, startedAt, phaseToken, 'resolved');
            return value;
        }
        return Promise.resolve(value).then((result) => {
            settlePhase(target, phaseEvent, startedAt, phaseToken, 'resolved');
            return result;
        }, (error) => {
            settlePhase(target, phaseEvent, startedAt, phaseToken, 'rejected');
            throw error;
        });
    }

    function safeErrorClass(error) {
        try {
            const name = error && typeof error === 'object' ? String(error.name || '') : '';
            return ERROR_CLASSES.has(name) ? name : 'UnknownError';
        } catch (_) { return 'UnknownError'; }
    }

    function fetch(input, init) {
        const currentFetch = safeCall(() => typeof root?.fetch === 'function' && root.fetch !== apiFetch
            ? root.fetch.bind(root)
            : nativeFetch) || nativeFetch;
        if (!currentFetch) return Promise.reject(new TypeError('fetch is unavailable'));
        expireIfNeeded();
        const target = active;
        const endpoint = target ? endpointLabel(input) : '';
        if (!target || !target.active || !endpoint) {
            try { return currentFetch(input, init); }
            catch (error) { return Promise.reject(error); }
        }
        const methodValue = safeCall(() => init && init.method || (input && typeof input === 'object' && input.method) || 'GET') || 'GET';
        const method = safeCall(() => String(methodValue).toUpperCase()) || 'GET';
        const safeMethod = METHODS.has(method) ? method : 'OTHER';
        const startedAt = now();
        const requestId = ++target.requestSequence;
        const fetchEvent = append(target, {
            type: 'fetch', requestId, endpoint, method: safeMethod,
            activePhases: Array.from(new Set(target.activePhases.values())),
            startOffsetMs: round(startedAt - target.startedAt),
            durationMs: null, status: null, errorClass: '', outcome: 'pending'
        });
        const record = (status, errorClass) => safeCall(() => {
            if (!fetchEvent) return;
            fetchEvent.durationMs = round(now() - startedAt);
            fetchEvent.status = Number.isInteger(status) && status >= 0 ? status : null;
            fetchEvent.errorClass = errorClass || '';
            fetchEvent.outcome = errorClass ? 'rejected' : 'resolved';
        });
        let request;
        try { request = currentFetch(input, init); }
        catch (error) {
            record(null, safeErrorClass(error));
            throw error;
        }
        const then = request && safeCall(() => request.then);
        if (typeof then !== 'function') return request;
        return Promise.resolve(request).then((response) => {
            const status = safeCall(() => response && Number(response.status));
            record(status, '');
            return response;
        }, (error) => {
            record(null, safeErrorClass(error));
            throw error;
        });
    }

    function snapshot() {
        expireIfNeeded();
        safeCall(() => flushPendingResourceTimings(active));
        const boot = safeCall(() => root.__gncRuntimeBootTiming) || {};
        const bootStates = new Set(['waiting', 'loading', 'ready', 'failed']);
        const runtimeBoot = {
            state: bootStates.has(String(boot.state || '')) ? String(boot.state) : 'unavailable',
            scriptLoadStartMs: round(boot.scriptLoadStartMs),
            scriptOnloadMs: round(boot.scriptOnloadMs),
            runtimeReadyMs: round(boot.runtimeReadyMs),
            responseEndMs: round(boot.responseEndMs),
            afterResponseToReadyMs: round(boot.afterResponseToReadyMs),
            transferSize: nonnegative(boot.transferSize),
            encodedBodySize: nonnegative(boot.encodedBodySize),
            decodedBodySize: nonnegative(boot.decodedBodySize)
        };
        return {
            schemaVersion: 'gnc-login-network-trace-v1',
            localOnly: true,
            runtimeBoot,
            attempts: attempts.map((attempt) => ({
                id: attempt.id,
                kind: attempt.kind,
                release: attempt.release,
                startedAt: attempt.startedAtIso,
                finishedOffsetMs: attempt.finishedOffsetMs,
                outcome: attempt.outcome,
                observerAvailable: attempt.observerAvailable,
                droppedEvents: attempt.droppedEvents,
                events: attempt.events.map((event) => ({ ...event }))
            }))
        };
    }

    function download() {
        const data = safeCall(() => JSON.stringify(snapshot(), null, 2));
        if (!data || !root?.document || typeof root.Blob !== 'function' || !root.URL?.createObjectURL) return false;
        let objectUrl = '';
        try {
            objectUrl = root.URL.createObjectURL(new root.Blob([data], { type: 'application/json' }));
            const anchor = root.document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = 'gnc-login-network-trace.json';
            anchor.style.display = 'none';
            root.document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            root.setTimeout(() => safeCall(() => root.URL.revokeObjectURL(objectUrl)), 1000);
            return true;
        } catch (_) {
            if (objectUrl) safeCall(() => root.URL.revokeObjectURL(objectUrl));
            return false;
        }
    }

    function clear() {
        if (active) finish('superseded');
        attempts = [];
        nextAttemptId = 1;
        return true;
    }

    function measuredPhase(name, task) {
        return measure(name, task);
    }

    apiFetch = fetch;
    return Object.freeze({ configure, begin, measure: measuredPhase, fetch, finish, snapshot, download, clear });
});
