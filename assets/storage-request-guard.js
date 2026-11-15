(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgDataStorageGuard = api;
    root.navigator?.serviceWorker?.addEventListener?.('message', event => {
        if (event.data?.type === 'AGDATA_STORAGE_FAILURE' && [400, 404].includes(event.data.status)) api.noteFailure(event.data.url, event.data.status);
    });
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const failedStorageUrls = new Set();
    const failures = new Map();
    const inFlight = new Map();
    function isPublicStorage(raw) {
        try { const u = new URL(raw); return /(?:^|\.)supabase\.(?:co|in)$/.test(u.hostname) && /^\/storage\/v1\/(?:object|render\/image)\/public\//.test(u.pathname); } catch { return false; }
    }
    function normalize(raw) {
        if (!isPublicStorage(raw)) return String(raw || '');
        try {
            const u = new URL(raw);
            const parts = u.pathname.replace(/^\/storage\/v1\/(?:object|render\/image)\/public\//, '').split('/');
            if (parts.length < 2 || parts.some(part => !part || /^(?:null|undefined|\[object Object\]|\.{1,2})$/i.test(decodeURIComponent(part)))) return '';
            u.pathname = '/storage/v1/object/public/' + parts.join('/');
            ['width', 'height', 'resize', 'quality', 'format'].forEach(key => u.searchParams.delete(key));
            return u.href;
        } catch { return ''; }
    }
    function key(raw) { const value = normalize(raw); return isPublicStorage(value) ? new URL(value).origin + new URL(value).pathname : ''; }
    function noteFailure(raw, status, now = Date.now()) {
        const id = key(raw);
        if (!id) return;
        if ([400, 404].includes(Number(status))) { failedStorageUrls.add(id); failures.delete(id); return; }
        if ((failures.get(id)?.until || 0) > now) return;
        const count = Math.min(5, (failures.get(id)?.count || 0) + 1);
        failures.set(id, { count, until: now + Math.min(300000, 15000 * 2 ** (count - 1)) });
    }
    function blocked(raw, now = Date.now()) {
        if (!isPublicStorage(raw)) return false;
        const id = key(raw);
        return !id || failedStorageUrls.has(id) || (failures.get(id)?.until || 0) > now;
    }
    function original(raw) {
        if (!isPublicStorage(raw)) return '';
        const value = normalize(raw);
        return value.replace(/\/_thumbs\/v2\/([a-f0-9]{64})-w(?:144|320|640)\.(webp|jpe?g)(?=[?#]|$)/i, '/v2/$1.$2');
    }
    async function fetchOnce(request, fetcher = fetch) {
        const id = key(request.url);
        if (!id) return isPublicStorage(request.url) ? new Response(null, { status: 400 }) : fetcher(request);
        if (blocked(request.url)) return new Response(null, { status: failedStorageUrls.has(id) ? 404 : 503 });
        if (!inFlight.has(id)) {
            const pending = Promise.resolve().then(() => fetcher(request)).then(response => {
                if (!response.ok && response.type !== 'opaque') noteFailure(request.url, response.status);
                else failures.delete(id);
                return response;
            }).catch(error => { noteFailure(request.url, 0); throw error; }).finally(() => inFlight.delete(id));
            inFlight.set(id, pending);
        }
        return (await inFlight.get(id)).clone();
    }
    return { failedStorageUrls, normalize, original, isPublicStorage, noteFailure, blocked, fetchOnce };
});
