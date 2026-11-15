(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgMetricMasterDetailSnapshots = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';
    const version = 'master-detail-v1';
    const sourceKey = 'ph_master_inventory';
    const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.prototype.toString.call(value) === '[object Object]';
    function invalid(message, code = 'MASTER_DETAIL_SNAPSHOT_INVALID') {
        return Object.assign(new Error('Master detail snapshot: ' + message), { code });
    }
    function normalizeIds(ids) {
        if (!Array.isArray(ids)) throw invalid('expected an array of exact unique IDs');
        const normalized = ids.map((id) => {
            if (typeof id !== 'string' || !id.trim()) throw invalid('missing exact unique ID');
            return id.trim();
        });
        return Array.from(new Set(normalized)).sort();
    }
    // Server values are JSON, not app rows with functions, drafts or prototypes.
    // Always detach before formatting, stamping or passing values to callers.
    function clone(value, ancestors = new Set()) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean'
            || typeof value === 'number' && Number.isFinite(value)) return value;
        if ((!Array.isArray(value) && !record(value)) || ancestors.has(value)) throw invalid('non-JSON canonical value');
        ancestors.add(value);
        const result = Array.isArray(value) ? [] : {};
        Object.keys(value).forEach((key) => Object.defineProperty(result, key, {
            value: clone(value[key], ancestors), enumerable: true, writable: true, configurable: true
        }));
        ancestors.delete(value);
        return result;
    }
    function freeze(value) {
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
        return value;
    }
    function rowId(row) {
        if (!record(row)) throw invalid('expected a row object');
        const lower = hasOwn(row, 'unique_id') ? row.unique_id : undefined;
        const upper = hasOwn(row, 'UNIQUE_ID') ? row.UNIQUE_ID : undefined;
        if (lower !== undefined && upper !== undefined && lower !== upper) throw invalid('conflicting row identities');
        const id = lower === undefined ? upper : lower;
        if (typeof id !== 'string' || !id.trim() || id !== id.trim()) throw invalid('invalid row identity');
        return id;
    }
    function exactRows(rows, ids, inventoryContract) {
        if (!Array.isArray(rows)) throw invalid('expected a full-row array');
        const expected = new Set(ids), byId = new Map();
        rows.forEach((row) => {
            const id = rowId(row);
            if (!expected.has(id)) throw invalid('unexpected row identity: ' + id);
            if (byId.has(id)) throw invalid('duplicate row identity: ' + id);
            if (inventoryContract.isListRow?.(row)) throw invalid('a list projection is not a full detail row');
            byId.set(id, row);
        });
        if (byId.size !== ids.length) throw invalid('an exact master row is missing or no longer permitted');
        return ids.map((id) => byId.get(id));
    }
    function createStore(options = {}) {
        if (typeof options.getContext !== 'function' || typeof options.fetchExactRows !== 'function') {
            throw invalid('getContext and fetchExactRows are required');
        }
        const inventoryContract = options.inventoryContract || root.AgMetricInventoryList;
        if (!inventoryContract || typeof inventoryContract.markDetailRow !== 'function') {
            throw invalid('the inventory completeness contract is required');
        }
        const formatRows = options.formatRows || ((rows) => rows);
        if (typeof formatRows !== 'function') throw invalid('formatRows must be a synchronous function');
        const batchSize = options.batchSize === undefined ? 100 : options.batchSize;
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw invalid('batchSize must be between 1 and 500');
        const queryVersion = String(options.queryVersion || version).trim();
        if (!queryVersion) throw invalid('missing full-row query version');
        const adapters = new Map(), canonical = new Map();
        let generation = 0, scope = '';
        const coordinator = () => typeof options.getCoordinator === 'function' ? options.getCoordinator() : options.coordinator;
        function reset() {
            generation++;
            scope = '';
            adapters.clear();
            canonical.clear();
        }
        function context() {
            const next = options.getContext();
            const nextScope = typeof next?.scope === 'string' ? next.scope : '';
            if (scope && nextScope !== scope) reset();
            scope = nextScope;
            return nextScope ? next : null;
        }
        function assertCurrent(expectedScope, expectedGeneration) {
            const current = context();
            if (!current || current.scope !== expectedScope || generation !== expectedGeneration
                || current.visible === false || current.online === false) {
                throw invalid('the authenticated read context changed', 'MASTER_DETAIL_CONTEXT_CHANGED');
            }
            return current;
        }
        function getAdapter(ids) {
            const wanted = normalizeIds(ids);
            if (!wanted.length) return null;
            const current = context();
            if (!current) throw invalid('an authenticated scope is required', 'MASTER_DETAIL_CONTEXT_CHANGED');
            const expectedScope = current.scope, expectedGeneration = generation;
            const idsKey = JSON.stringify(wanted);
            const cacheKey = JSON.stringify([version, queryVersion, inventoryContract.version, sourceKey, 'select=*', expectedScope, expectedGeneration, wanted]);
            if (adapters.has(cacheKey)) return adapters.get(cacheKey);
            const frozenIds = Object.freeze(wanted);
            const adapter = Object.freeze({
                id: 'side:master-detail:' + idsKey,
                cacheKey,
                sourceKeys: Object.freeze([sourceKey]),
                ids: frozenIds,
                stage: async () => {
                    const rows = [];
                    // No total-row cap: every requested ID participates in the
                    // same coordinator before/after revision fence.
                    for (let offset = 0; offset < frozenIds.length; offset += batchSize) {
                        const readContext = assertCurrent(expectedScope, expectedGeneration);
                        const batch = frozenIds.slice(offset, offset + batchSize);
                        const fetched = await options.fetchExactRows(batch, readContext);
                        assertCurrent(expectedScope, expectedGeneration);
                        rows.push(...clone(exactRows(fetched, batch, inventoryContract)));
                    }
                    return { contractVersion: 1, version, cacheKey, scope: expectedScope, ids: frozenIds.slice(), rows };
                },
                // Integration must forward the coordinator's final context and
                // metadata. A preview must never invoke this commit method.
                commit: (value, committedContext, metadata) => {
                    assertCurrent(expectedScope, expectedGeneration);
                    const revision = metadata?.sources?.get?.(sourceKey);
                    const permissionVersion = metadata?.permissionVersion;
                    if (!committedContext || committedContext.scope !== expectedScope
                        || typeof permissionVersion !== 'string' || !permissionVersion.trim()
                        || revision?.state !== 'ready' || typeof revision.revision !== 'string' || !/^\d+$/.test(revision.revision)) {
                        throw invalid('missing ready revision/permission commit fence');
                    }
                    if (!record(value) || value.contractVersion !== 1 || value.version !== version
                        || value.cacheKey !== cacheKey || value.scope !== expectedScope
                        || !Array.isArray(value.ids) || JSON.stringify(value.ids) !== idsKey) {
                        throw invalid('incompatible full-row cache identity');
                    }
                    const rows = clone(exactRows(value.rows, frozenIds, inventoryContract));
                    canonical.set(cacheKey, freeze({
                        identity: { contractVersion: 1, version, queryVersion, cacheKey, scope: expectedScope,
                            permissionVersion, revision: revision.revision, ids: frozenIds.slice() },
                        rows
                    }));
                }
            });
            adapters.set(cacheKey, adapter);
            return adapter;
        }
        function readVerifiedRows(ids, raw = false) {
            const wanted = normalizeIds(ids);
            if (!wanted.length) return [];
            const current = context();
            if (!current || current.visible === false || current.online === false) return null;
            const adapter = getAdapter(wanted), sync = coordinator();
            if (!sync || typeof sync.isVerified !== 'function' || !sync.isVerified(adapter)) return null;
            const entry = canonical.get(adapter.cacheKey), fence = entry?.identity;
            if (!fence || fence.scope !== current.scope || fence.permissionVersion !== current.permissionVersion
                || fence.revision !== current.revision) return null;
            const startedGeneration = generation;
            // A formatter is allowed to normalize its input. It never receives
            // the canonical copy, and no app-owned row receives a freshness tag.
            const rows = clone(exactRows(raw ? entry.rows : formatRows(clone(entry.rows)), wanted, inventoryContract));
            const after = context();
            if (!after || generation !== startedGeneration || after.scope !== fence.scope
                || after.permissionVersion !== fence.permissionVersion || after.revision !== fence.revision
                || after.visible === false || after.online === false || !sync.isVerified(adapter)) return null;
            if (raw) return rows;
            return rows.map((row) => inventoryContract.markDetailRow(row, {
                scope: fence.scope, permissionVersion: fence.permissionVersion, revision: fence.revision, uniqueId: rowId(row)
            }));
        }
        function getVerifiedRows(ids) { return readVerifiedRows(ids); }
        function getVerifiedCanonicalRows(ids) { return readVerifiedRows(ids, true); }
        async function ensure(ids) {
            const wanted = normalizeIds(ids);
            if (!wanted.length) return [];
            const current = context();
            if (!current || current.visible === false || current.online === false) return null;
            const adapter = getAdapter(wanted), sync = coordinator();
            if (!sync || typeof sync.ensure !== 'function' || typeof sync.isVerified !== 'function') {
                throw invalid('a verified live-sync coordinator is required');
            }
            const expectedScope = current.scope, expectedGeneration = generation;
            if (!await sync.ensure(adapter)) return null;
            const after = context();
            if (!after || after.scope !== expectedScope || generation !== expectedGeneration) return null;
            return getVerifiedRows(wanted);
        }
        return Object.freeze({ getAdapter, getVerifiedRows, getVerifiedCanonicalRows, ensure, reset });
    }
    return Object.freeze({ version, sourceKey, createStore });
});
