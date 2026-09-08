(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgMetricLiveSyncAdapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    function rows(value, label = 'Live data') {
        if (!Array.isArray(value)) throw new Error(`${label} returned an invalid response; previous data was retained.`);
        return value;
    }
    function keyed(values, normalize, key) {
        const result = new Map();
        rows(values).forEach((raw) => {
            const value = normalize(raw);
            if (value && key(value)) result.set(key(value), value);
        });
        return result;
    }
    function create(bindings, registry) {
        if (!registry) throw new Error('Live-sync registry is required.');
        function getAdapter(id, context = {}) {
            const binding = bindings[id];
            if (!binding) throw new Error(`Live-sync adapter is not implemented: ${id}`);
            if (binding.enabled && !binding.enabled(context)) return null;
            const scope = JSON.stringify([context.scope || '', id, binding.scope ? binding.scope(context) : '']);
            return {
                id, cacheKey: scope, sourceKeys: registry.getSourceKeys([id]),
                deploymentRequired: registry.adapters[id]?.deploymentRequired === true,
                unavailableReason: registry.adapters[id]?.unavailableReason || '',
                stage: async () => {
                    const value = await binding.stage(context);
                    if (value === undefined) throw new Error(`${id} did not produce a snapshot.`);
                    return value;
                },
                commit: (value) => {
                    const result = binding.commit(value, context);
                    if (result && typeof result.then === 'function') throw new Error(`${id} commit must be synchronous.`);
                }
            };
        }
        return Object.freeze({
            getAdapter,
            sourceKeys: (id) => registry.getSourceKeys([id]),
            getScope: (id, context = {}) => JSON.stringify([context.scope || '', id, bindings[id]?.scope?.(context) || '']),
            getViewAdapters(viewId, context = {}) {
                return registry.getViewAdapters(viewId, context).filter((id) => id.startsWith('side:')).flatMap((id) => {
                    const descriptor = getAdapter(id, context);
                    return descriptor ? [descriptor] : [];
                });
            }
        });
    }
    return Object.freeze({ rows, keyed, create });
});
