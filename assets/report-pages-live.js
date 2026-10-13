(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.GncReportPagesLive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const abortError = () => Object.assign(new Error('Report session changed.'), { name: 'AbortError' });
    function createController(options) {
        let owner = '', permission = '', session = null, module = null, ready = null, generation = 0, mountGeneration = 0;
        let capabilities = null;
        const states = new Map(), mounts = new Map(), controllers = new Set();
        function current() {
            const scope = String(options.scope() || '');
            const version = String(options.permission() || '');
            if (owner !== scope || permission !== version) {
                clear(); owner = scope; permission = version;
            }
            return scope;
        }
        function clear() {
            generation += 1;
            mountGeneration += 1;
            controllers.forEach(controller => controller.abort()); controllers.clear();
            mounts.forEach(mount => mount.destroy()); mounts.clear();
            session?.clear(); session = null; states.clear(); capabilities = null; ready = null;
            if (owner) options.onClear?.();
        }
        function state(surface) {
            current();
            if (!states.has(surface)) states.set(surface, { rows: [], metadata: {}, page: null, loading: false, error: '', revision: '', queryKey: '', completeItems: new Map(), itemRows: new Map() });
            return states.get(surface);
        }
        async function initialize() {
            current();
            if (session && capabilities) return session;
            if (ready) return ready;
            const token = generation, scope = owner, version = permission;
            ready = (async () => {
                module = module || await options.loadModule();
                const controller = new AbortController(); controllers.add(controller);
                try {
                    const reply = await options.transport(null, controller.signal);
                    if (token !== generation || scope !== options.scope() || version !== options.permission()) throw abortError();
                    capabilities = reply;
                    session = module.createReportSession({ scopeKey: scope, permissionVersion: version, transport: (query, signal) => options.transport(query, signal) });
                    options.onReady?.();
                    return session;
                } catch (error) {
                    if (token === generation && [404, 400, 501].includes(Number(error.status))) {
                        capabilities = { surfaces: [] }; options.onReady?.();
                    }
                    throw error;
                } finally { controllers.delete(controller); }
            })().finally(() => { if (token === generation) ready = null; });
            return ready;
        }
        function enabled(surface) {
            if (!current() || !options.allowed(surface)) return false;
            if (surface === 'approval' && capabilities && !(capabilities.approvalTabs || []).includes(options.variant?.(surface))) return false;
            return capabilities === null || (capabilities.surfaces || []).includes(surface);
        }
        function apply(surface, query, result) {
            const target = state(surface), key = JSON.stringify(query);
            if (target.queryKey !== key) return;
            const page = result.page;
            if (page) {
                if (target.expectedRevision && page.sourceRevision !== target.expectedRevision) return;
                const changed = target.revision !== page.sourceRevision || JSON.stringify(target.metadata) !== JSON.stringify(page.metadata || {});
                if (target.revision && target.revision !== page.sourceRevision) {
                    target.completeItems.clear(); target.itemRows.clear();
                }
                target.page = page; target.metadata = page.metadata || target.metadata;
                target.revision = page.sourceRevision;
                target.expectedRevision = '';
                target.rows = Array.isArray(result.rows) ? result.rows : page.rows;
                if (changed) options.onMetadata?.(surface, target);
            }
            target.loading = !!(result.initialLoading || result.refreshing);
            target.error = result.error ? String(result.error.message || result.error) : '';
            options.onState?.(surface, target);
        }
        async function mount(host, query, config) {
            const scope = current(), token = generation, mountToken = mountGeneration;
            const target = state(query.surface);
            const key = JSON.stringify(query);
            if (!config.isolated) {
                if (target.queryKey !== key) target.rows = [];
                target.queryKey = key; target.loading = true;
            }
            try {
                await initialize();
                if (token !== generation || mountToken !== mountGeneration || scope !== options.scope() || !host.isConnected || !enabled(query.surface)) return null;
                for (const [element, instance] of mounts) if (!element.isConnected) { instance.destroy(); mounts.delete(element); }
                const next = { ...config, session, query, onState: result => {
                    if (token !== generation || mountToken !== mountGeneration || scope !== options.scope()) return;
                    if (!config.isolated) apply(query.surface, query, result);
                    config.onState?.(result);
                } };
                let instance = mounts.get(host);
                if (instance) instance.update(next);
                else { instance = module.mountReportRows(host, next); mounts.set(host, instance); }
                return instance;
            } catch (error) {
                if (token !== generation || error.name === 'AbortError') return null;
                target.loading = false; target.error = String(error.message || error);
                options.onState?.(query.surface, target);
                return null;
            }
        }
        async function load(query) {
            const scope = current(), token = generation, target = state(query.surface);
            const key = JSON.stringify(query);
            if (target.pendingKey === key) return target.promise;
            target.pendingKey = key; target.queryKey = key; target.loading = true;
            target.promise = initialize().then(() => session.read(query)).then(page => {
                if (token !== generation || scope !== options.scope()) throw abortError();
                apply(query.surface, query, { page, rows:page.rows, initialLoading:false, refreshing:false });
                return page;
            }).catch(error => {
                if (token === generation && error.name !== 'AbortError') {
                    target.error = String(error.message || error); target.loading = false;
                    options.onMetadata?.(query.surface, target);
                }
                return null;
            }).finally(() => { if (token === generation) target.pendingKey = ''; });
            return target.promise;
        }
        async function readComplete(query, fresh = true) {
            const scope = current(), token = generation;
            await initialize();
            if (!enabled(query.surface)) throw new Error('Paged reports are unavailable.');
            const controller = new AbortController(); controllers.add(controller);
            try {
                const rows = [], seen = new Set(); let offset = 0, revision = query.sourceRevision || '', total = null;
                do {
                    const request = { ...query, offset, limit: query.operation === 'groups' ? 25 : 100, ...(revision ? { sourceRevision: revision } : {}) };
                    const page = await (fresh ? session.refresh(request, controller.signal) : session.read(request, controller.signal));
                    if (token !== generation || scope !== options.scope()) throw abortError();
                    if (revision && page.sourceRevision !== revision) throw new Error('Report source changed. Refresh and retry.');
                    revision = page.sourceRevision; total = page.total;
                    for (const row of page.rows) {
                        const key = String(row.unique_id || row.master_unique_id || row.key || row.itemCode || JSON.stringify(row));
                        if (seen.has(key)) throw new Error('Report pages overlapped. Refresh and retry.');
                        seen.add(key); rows.push(row);
                    }
                    if (!page.hasMore) break;
                    if (!page.rows.length) throw new Error('Report returned an incomplete page.');
                    offset += page.rows.length;
                } while (offset <= 2_000_000);
                if (total !== null && rows.length !== total) throw new Error('Complete report rows could not be verified.');
                return { rows, sourceRevision: revision };
            } finally { controllers.delete(controller); }
        }
        function refresh(surface) {
            current(); const target = state(surface);
            target.completeItems.clear();
            mounts.forEach((instance, host) => { if (!host.isConnected) { instance.destroy(); mounts.delete(host); } else instance.refresh?.(); });
        }
        async function readPage(query, signal) {
            const scope = current(), token = generation;
            await initialize();
            const page = await session.refresh(query, signal);
            if (token !== generation || scope !== options.scope()) throw abortError();
            return page;
        }
        function acceptMetadata(surface, page) {
            const target = state(surface);
            if (target.revision && target.revision !== page.sourceRevision) {
                target.completeItems.clear(); target.itemRows.clear();
                target.expectedRevision = page.sourceRevision;
            } else {
                target.metadata = page.metadata || {};
                target.revision = page.sourceRevision;
            }
            options.onMetadata?.(surface, target);
            refresh(surface);
        }
        function suspendMounts() {
            mountGeneration += 1;
            mounts.forEach(instance => instance.destroy()); mounts.clear();
            options.onSuspend?.();
        }
        return { state, enabled, initialize, mount, load, readPage, acceptMetadata, readComplete, refresh, clear, suspendMounts, getSession:() => { current(); return session; } };
    }
    return { createController };
});
