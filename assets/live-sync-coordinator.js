(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgMetricLiveSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const unique = (values) => Array.from(new Set(values)).sort();
    function snapshot(value, keys) {
        if (!value || value.contractVersion !== 1 || !Array.isArray(value.sources) || !value.permissionVersion) throw new Error('Data revision service returned an invalid response.');
        const sources = new Map();
        value.sources.forEach((source) => {
            if (!keys.includes(source.key) || sources.has(source.key) || !(source.state === 'unavailable' && source.revision == null || /^\d+$/.test(String(source.revision))) || !['ready', 'importing', 'interrupted', 'unavailable'].includes(source.state)) throw new Error('Invalid data revision metadata.');
            sources.set(source.key, { ...source, revision: source.revision == null ? null : String(source.revision) });
        });
        // A denied/missing source must never look like an unchanged successful read.
        keys.forEach((key) => { if (!sources.has(key)) sources.set(key, { key, revision: '0', state: 'unavailable' }); });
        return { sources, permissionVersion: String(value.permissionVersion), serverTime: value.serverTime };
    }
    function signature(meta, keys) {
        return JSON.stringify([meta.permissionVersion, ...unique(keys).map((key) => [key, meta.sources.get(key)?.revision, meta.sources.get(key)?.state])]);
    }
    function createCoordinator(options) {
        const now = options.now || Date.now;
        const later = options.setTimeout || setTimeout;
        const cancel = options.clearTimeout || clearTimeout;
        const applied = new Map();
        const requested = new Map();
        let epoch = 0, scope = '', permission = '', running = null, queued = false;
        let pollTimer = null, signalTimer = null, signalAt = Infinity, unsubscribe = null, subscribedScope = '';
        let lastVerifiedAt = null, currentStatus = { state: 'Syncing', lastVerifiedAt: null };
        const statistics = { revisionReads: 0, adapterReads: 0, discardedLoads: 0, commits: 0, signals: 0 };
        function publish(state, message = '', extra = {}) {
            currentStatus = { state, message, lastVerifiedAt, ...extra };
            options.onStatus?.(currentStatus);
        }
        function clearTimers() {
            if (pollTimer !== null) cancel(pollTimer);
            if (signalTimer !== null) cancel(signalTimer);
            pollTimer = signalTimer = null;
            signalAt = Infinity;
        }
        function closeSubscription() {
            if (unsubscribe) unsubscribe();
            unsubscribe = null; subscribedScope = '';
        }
        function reset() {
            epoch++; clearTimers(); closeSubscription(); applied.clear(); requested.clear();
            permission = ''; scope = ''; lastVerifiedAt = null; queued = false;
            publish('Syncing', 'Waiting to verify current data.');
        }
        function context() {
            const next = options.getContext();
            if (!next || !next.scope || next.visible === false || next.online === false) return next;
            if (scope !== next.scope) {
                epoch++; applied.clear(); requested.clear(); permission = ''; lastVerifiedAt = null;
                scope = next.scope; closeSubscription();
            }
            return { ...next, adapters: (next.adapters || []).map((adapter) => ({ ...adapter, sourceKeys: [...adapter.sourceKeys] })) };
        }
        function arm(ctx) {
            if (pollTimer !== null) cancel(pollTimer);
            pollTimer = null;
            if (!ctx?.scope || ctx.visible === false) { closeSubscription(); return; }
            pollTimer = later(() => { pollTimer = null; check('foreground-safeguard'); }, 30000);
            if (ctx.online === false) { closeSubscription(); return; }
            if (ctx.online !== false && options.subscribe && subscribedScope !== ctx.scope) {
                closeSubscription(); subscribedScope = ctx.scope;
                unsubscribe = options.subscribe((event) => {
                    const key = event?.new?.key || event?.old?.key;
                    if (!key || (options.getContext()?.adapters || []).some((adapter) => adapter.sourceKeys.includes(key))) signal('metadata');
                }, () => signal('reconnect', 0)) || null;
            }
        }
        function descriptors(ctx) {
            const result = new Map();
            [...(ctx.adapters || []), ...requested.values()].forEach((adapter) => {
                if (!adapter || !adapter.id || !adapter.cacheKey || !Array.isArray(adapter.sourceKeys) || !adapter.sourceKeys.length) throw new Error('A live data adapter is missing its source contract.');
                result.set(adapter.id, adapter);
            });
            return Array.from(result.values());
        }
        function identity(ctx) {
            return JSON.stringify([ctx.scope, ctx.viewKey, (ctx.adapters || []).map((item) => [item.id, item.cacheKey])]);
        }
        function stillCurrent(ctx, startedEpoch) {
            const next = options.getContext();
            return epoch === startedEpoch && next?.visible !== false && next?.online !== false && identity(next || {}) === identity(ctx);
        }
        function discardCycle(startedEpoch, message = '') {
            statistics.discardedLoads++;
            // Suspension/reset invalidates this cycle, not work requested after
            // it. Never revive an old epoch or clear a newer queued check.
            if (epoch === startedEpoch) {
                queued = true;
                if (message) publish('Syncing', message);
            }
            return false;
        }
        async function cycle(run) {
            const ctx = context();
            run.epoch = epoch;
            arm(ctx);
            if (!ctx?.scope || ctx.visible === false) return false;
            if (ctx.online === false) { publish('Offline', 'Showing the last verified data, if available.'); return false; }
            const startedEpoch = epoch;
            const adapters = descriptors(ctx);
            requested.clear();
            const keys = unique(adapters.flatMap((item) => item.sourceKeys));
            if (!keys.length) { publish('Up to date', 'This screen has no live data.'); return true; }
            if (keys.length > 64) throw new Error('This screen exceeds the revision request limit.');
            statistics.revisionReads++;
            const beforeValue = await options.readRevisions(keys);
            if (!stillCurrent(ctx, startedEpoch)) return discardCycle(startedEpoch);
            const before = snapshot(beforeValue, keys);
            if (permission && permission !== before.permissionVersion) {
                applied.clear(); lastVerifiedAt = null;
                await options.onPermissionChange?.(before.permissionVersion);
                if (!stillCurrent(ctx, startedEpoch)) return discardCycle(startedEpoch);
            }
            permission = before.permissionVersion;
            const blocked = adapters.filter((adapter) => adapter.sourceKeys.some((key) => before.sources.get(key).state !== 'ready'));
            const blockedIds = new Set(blocked.map((item) => item.id));
            const changed = adapters.filter((adapter) => !blockedIds.has(adapter.id) && applied.get(adapter.id)?.signature !== JSON.stringify([adapter.cacheKey, signature(before, adapter.sourceKeys)]));
            const staged = [];
            let failure = null, cursor = 0;
            if (changed.length) {
                publish('Syncing', 'Checking and loading changed data.');
                options.onStageStart?.(ctx, before);
                await Promise.all(Array.from({ length: Math.min(options.concurrency || 2, changed.length) }, async () => {
                    while (cursor < changed.length && stillCurrent(ctx, startedEpoch)) {
                        const adapter = changed[cursor++];
                        try {
                            statistics.adapterReads++;
                            const value = await adapter.stage();
                            if (value === undefined) throw new Error(`${adapter.id} did not return a snapshot.`);
                            staged.push({ adapter, value });
                        } catch (error) { failure = error; }
                    }
                }));
                // An adapter may finish after pagehide suspended this cycle.
                // Check before starting another fetch in the departing page.
                if (!stillCurrent(ctx, startedEpoch)) return discardCycle(startedEpoch);
                statistics.revisionReads++;
                const afterValue = await options.readRevisions(keys);
                if (!stillCurrent(ctx, startedEpoch)) return discardCycle(startedEpoch, 'Source data changed while loading; checking again.');
                const after = snapshot(afterValue, keys);
                if (signature(before, keys) !== signature(after, keys)) {
                    return discardCycle(startedEpoch, 'Source data changed while loading; checking again.');
                }
                // No asynchronous work is permitted between final validation and application.
                if (staged.length) {
                    if (options.commitSnapshots) options.commitSnapshots(staged, ctx, after);
                    else staged.forEach(({ adapter, value }) => adapter.commit(value));
                    statistics.commits++;
                    if (!stillCurrent(ctx, startedEpoch)) {
                        return discardCycle(startedEpoch, 'View settings changed; verifying the updated selection.');
                    }
                    staged.forEach(({ adapter }) => applied.set(adapter.id, { cacheKey: adapter.cacheKey, signature: JSON.stringify([adapter.cacheKey, signature(after, adapter.sourceKeys)]) }));
                }
            }
            if (failure) { publish('Needs attention', failure.message || String(failure)); return false; }
            if (blocked.length) {
                const states = blocked.flatMap((adapter) => adapter.sourceKeys.map((key) => before.sources.get(key).state));
                const retained = lastVerifiedAt ? ' Keeping the last verified data.' : ' No complete snapshot has been verified in this session yet.';
                const unavailableReason = blocked.filter((adapter) => adapter.sourceKeys.some((key) => before.sources.get(key).state === 'unavailable')).map((adapter) => adapter.unavailableReason).filter(Boolean).join(' ');
                publish(states.includes('interrupted') || states.includes('unavailable') ? 'Needs attention' : 'Importing',
                    states.includes('interrupted') ? `An import was interrupted.${retained}` : states.includes('unavailable') ? (unavailableReason || 'Some data could not be verified for your current access.') : `An import is in progress.${retained}`,
                    { blockedSources: unique(blocked.flatMap((adapter) => adapter.sourceKeys)) });
                return false;
            }
            lastVerifiedAt = now();
            publish('Up to date');
            return true;
        }
        function check(reason = 'check') {
            queued = true;
            if (running) return running;
            const task = (async () => {
                let result = false, passes = 0;
                while (queued && passes++ < 3) {
                    queued = false;
                    const run = { epoch };
                    try { result = await cycle(run); }
                    catch (error) {
                        if (epoch === run.epoch) publish('Needs attention', error.message || String(error));
                        result = false;
                    }
                }
                return result;
            })();
            running = task;
            task.finally(() => {
                if (running === task) running = null;
                if (queued) signal('changed-during-load', 1000);
            });
            return task;
        }
        function signal(reason = 'event', delay = 250) {
            statistics.signals++;
            const ctx = options.getContext();
            if (!ctx?.scope || ctx.visible === false) { clearTimers(); closeSubscription(); epoch++; return; }
            const due = now() + Math.max(0, delay);
            if (signalTimer !== null && signalAt <= due) return;
            if (signalTimer !== null) cancel(signalTimer);
            signalAt = due;
            signalTimer = later(() => { signalTimer = null; signalAt = Infinity; check(reason); }, Math.max(0, delay));
        }
        function ensure(adapter, force = false) {
            const ctx = context();
            if (!ctx?.scope || ctx.visible === false || ctx.online === false) return Promise.resolve(false);
            if (!force && applied.get(adapter.id)?.cacheKey === adapter.cacheKey) return Promise.resolve(true);
            requested.set(adapter.id, adapter);
            return check('loader').then((ok) => ok && applied.get(adapter.id)?.cacheKey === adapter.cacheKey);
        }
        function suspend() { epoch++; clearTimers(); closeSubscription(); queued = false; }
        return Object.freeze({ check, signal, ensure, reset, suspend, getStatus: () => ({ ...currentStatus }), getStatistics: () => ({ ...statistics }) });
    }
    return Object.freeze({ createCoordinator, snapshot, signature });
});
