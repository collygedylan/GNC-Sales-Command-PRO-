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
        let activeRun = null, backgroundRunning = null, backgroundGeneration = 0, backgroundTimer = null, backgroundController = null;
        let pollTimer = null, signalTimer = null, signalAt = Infinity, unsubscribe = null, subscribedScope = '';
        let lastVerifiedAt = null, currentStatus = { state: 'Syncing', lastVerifiedAt: null };
        let backgroundStatus = { state: 'Waiting', lastVerifiedAt: null };
        const statistics = { revisionReads: 0, adapterReads: 0, discardedLoads: 0, commits: 0, signals: 0, cacheHits: 0 };
        function publish(state, message = '', extra = {}) {
            currentStatus = { state, message, lastVerifiedAt, ...extra };
            options.onStatus?.(currentStatus);
        }
        function clearTimers() {
            if (pollTimer !== null) cancel(pollTimer);
            if (signalTimer !== null) cancel(signalTimer);
            pollTimer = signalTimer = null;
            signalAt = Infinity;
            invalidateBackground();
            activeRun?.controller?.abort();
        }
        function invalidateBackground() {
            backgroundGeneration++;
            backgroundController?.abort();
            if (backgroundTimer !== null) cancel(backgroundTimer);
            backgroundTimer = null;
        }
        function publishBackground(state, message = '') {
            backgroundStatus = { state, message, lastVerifiedAt: state === 'Up to date' ? now() : backgroundStatus.lastVerifiedAt };
            options.onBackgroundStatus?.(backgroundStatus);
        }
        function closeSubscription() {
            if (unsubscribe) unsubscribe();
            unsubscribe = null; subscribedScope = '';
        }
        function reset() {
            epoch++; clearTimers(); closeSubscription(); applied.clear(); requested.clear();
            permission = ''; scope = ''; lastVerifiedAt = null; queued = false;
            backgroundStatus = { state: 'Waiting', lastVerifiedAt: null };
            publish('Syncing', 'Waiting to verify current data.');
        }
        function context() {
            const next = options.getContext();
            if (!next || !next.scope || next.visible === false || next.online === false) return next;
            if (scope !== next.scope) {
                invalidateBackground();
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
                    const next = options.getContext();
                    if (!key || [...(next?.adapters || []), ...(next?.backgroundAdapters || [])].some((adapter) => adapter.sourceKeys.includes(key))) signal('metadata');
                }, () => signal('reconnect', 0)) || null;
            }
        }
        function descriptors(ctx, background = false) {
            const result = new Map();
            const foregroundIds = new Set((ctx.adapters || []).map(adapter => adapter.id));
            const items = background ? (ctx.backgroundAdapters || []).filter(adapter => !foregroundIds.has(adapter.id)) : [...(ctx.adapters || []), ...requested.values()];
            items.forEach((adapter) => {
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
        function cacheMeta(adapter, ctx, metadata) {
            return { contractVersion: 1, scope: ctx.scope, adapterId: adapter.id, cacheKey: adapter.cacheKey, signature: signature(metadata, adapter.sourceKeys) };
        }
        function cacheMatches(entry, expected) {
            return entry && entry.value !== undefined && entry.meta && Object.keys(expected).every(key => entry.meta[key] === expected[key]);
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
            const background = !!run.background;
            const baseContext = context();
            const ctx = baseContext && { ...baseContext, priority: background ? 'background' : 'foreground' };
            run.epoch = epoch;
            run.context = ctx;
            if (background && run.generation !== backgroundGeneration) return false;
            run.controller = typeof AbortController === 'function' ? new AbortController() : null;
            if (background) backgroundController = run.controller;
            if (!background) arm(ctx);
            if (!ctx?.scope || ctx.visible === false) return false;
            const emit = background ? publishBackground : publish;
            if (ctx.online === false) { emit('Offline', 'Showing the last verified data, if available.'); return false; }
            const startedEpoch = epoch;
            const current = () => stillCurrent(ctx, startedEpoch) && (!background || run.generation === backgroundGeneration
                && JSON.stringify((options.getContext()?.backgroundAdapters || []).map(item => [item.id, item.cacheKey])) === JSON.stringify((ctx.backgroundAdapters || []).map(item => [item.id, item.cacheKey])));
            const discard = (message = '') => {
                if (!background) return discardCycle(startedEpoch, message);
                statistics.discardedLoads++;
                return false;
            };
            const adapters = descriptors(ctx, background);
            run.adapters = adapters;
            if (!background) requested.clear();
            // A deferred cohort also verifies the foreground dependencies so it
            // cannot introduce a new shared revision beside older visible joins.
            const keys = unique([...adapters, ...(background ? ctx.adapters || [] : [])].flatMap(item => item.sourceKeys));
            if (!adapters.length || !keys.length) { emit('Up to date', 'This screen has no live data.'); return true; }
            if (keys.length > 64) throw new Error('This screen exceeds the revision request limit.');
            statistics.revisionReads++;
            const beforeValue = await options.readRevisions(keys, { signal: run.controller?.signal });
            if (!current()) return discard();
            const before = snapshot(beforeValue, keys);
            if (background && (ctx.adapters || []).length && (permission !== before.permissionVersion || (ctx.adapters || []).some(adapter => applied.get(adapter.id)?.signature !== JSON.stringify([adapter.cacheKey, signature(before, adapter.sourceKeys)])))) {
                publish('Syncing', 'Source data changed; verifying visible data.');
                signal('background-source-changed', 0);
                return false;
            }
            if (permission && permission !== before.permissionVersion) {
                applied.clear(); lastVerifiedAt = null;
                await options.onPermissionChange?.(before.permissionVersion);
                if (!current()) return discard();
            }
            permission = before.permissionVersion;
            const blocked = adapters.filter((adapter) => adapter.sourceKeys.some((key) => before.sources.get(key).state !== 'ready'));
            if (blocked.length) {
                const states = blocked.flatMap(adapter => adapter.sourceKeys.map(key => before.sources.get(key).state));
                const retained = lastVerifiedAt ? ' Keeping the last verified data.' : ' No complete snapshot has been verified in this session yet.';
                const unavailableReason = blocked.filter(adapter => adapter.sourceKeys.some(key => before.sources.get(key).state === 'unavailable')).map(adapter => adapter.unavailableReason).filter(Boolean).join(' ');
                emit(states.includes('interrupted') || states.includes('unavailable') ? 'Needs attention' : 'Importing',
                    states.includes('interrupted') ? `An import was interrupted.${retained}` : states.includes('unavailable') ? (unavailableReason || 'Some data could not be verified for your current access.') : `An import is in progress.${retained}`,
                    { blockedSources: unique(blocked.flatMap(adapter => adapter.sourceKeys)) });
                return false;
            }
            const changed = adapters.filter(adapter => applied.get(adapter.id)?.signature !== JSON.stringify([adapter.cacheKey, signature(before, adapter.sourceKeys)]));
            const staged = [];
            let failure = null, cursor = 0;
            if (changed.length) {
                emit('Syncing', 'Checking and loading changed data.');
                options.onStageStart?.(ctx, before);
                await Promise.all(Array.from({ length: Math.min(background ? options.backgroundConcurrency || 1 : options.concurrency || 2, changed.length) }, async () => {
                    while (cursor < changed.length && current()) {
                        const adapter = changed[cursor++];
                        try {
                            const meta = cacheMeta(adapter, ctx, before);
                            const cached = options.readCachedSnapshot ? await Promise.resolve().then(() => options.readCachedSnapshot(adapter, meta)).catch(() => null) : null;
                            if (!current()) return;
                            let value;
                            if (cacheMatches(cached, meta)) { value = cached.value; statistics.cacheHits++; }
                            else { statistics.adapterReads++; value = await adapter.stage({ signal: run.controller?.signal }); }
                            if (value === undefined) throw new Error(`${adapter.id} did not return a snapshot.`);
                            staged.push({ adapter, value });
                        } catch (error) { failure = error; }
                    }
                }));
                // An adapter may finish after pagehide suspended this cycle.
                // Check before starting another fetch in the departing page.
                if (!current()) return discard();
                statistics.revisionReads++;
                const afterValue = await options.readRevisions(keys, { signal: run.controller?.signal });
                if (!current()) return discard('Source data changed while loading; checking again.');
                const after = snapshot(afterValue, keys);
                if (signature(before, keys) !== signature(after, keys)) {
                    if (background) { publish('Syncing', 'Source data changed; verifying visible data.'); signal('background-source-changed', 0); }
                    return discard('Source data changed while loading; checking again.');
                }
                if (failure) { emit('Needs attention', failure.message || String(failure)); return false; }
                // No asynchronous work is permitted between final validation and application.
                if (staged.length) {
                    if (options.commitSnapshots) options.commitSnapshots(staged, ctx, after);
                    else staged.forEach(({ adapter, value }) => adapter.commit(value));
                    statistics.commits++;
                    if (!current()) {
                        return discard('View settings changed; verifying the updated selection.');
                    }
                    staged.forEach(({ adapter }) => applied.set(adapter.id, { cacheKey: adapter.cacheKey, signature: JSON.stringify([adapter.cacheKey, signature(after, adapter.sourceKeys)]) }));
                    staged.forEach(({ adapter, value }) => {
                        try { Promise.resolve(options.writeCachedSnapshot?.(adapter, value, cacheMeta(adapter, ctx, after))).catch(() => {}); }
                        catch (error) { /* Cache persistence must not invalidate an authoritative commit. */ }
                    });
                }
            }
            if (failure) { emit('Needs attention', failure.message || String(failure)); return false; }
            if (!background) lastVerifiedAt = now();
            emit('Up to date');
            return true;
        }
        function scheduleBackground() {
            const ctx = options.getContext();
            if (running || backgroundRunning || !ctx?.scope || ctx.visible === false || ctx.online === false || !(ctx.backgroundAdapters || []).length) return;
            if (backgroundTimer !== null) cancel(backgroundTimer);
            const generation = backgroundGeneration;
            backgroundTimer = later(() => {
                backgroundTimer = null;
                if (running || generation !== backgroundGeneration) return;
                const run = { background: true, generation, epoch };
                const task = cycle(run).catch(error => {
                    if (epoch === run.epoch && generation === backgroundGeneration) publishBackground('Needs attention', error.message || String(error));
                    return false;
                });
                backgroundRunning = task;
                task.finally(() => {
                    if (backgroundRunning === task) backgroundRunning = null;
                    if (backgroundController === run.controller) backgroundController = null;
                    if (generation !== backgroundGeneration && run.epoch === epoch && run.context?.scope === options.getContext()?.scope
                        && currentStatus.state === 'Up to date') scheduleBackground();
                });
            }, Math.max(0, options.backgroundDelayMs ?? 250));
        }
        function check(reason = 'check') {
            invalidateBackground();
            if (activeRun && (activeRun.epoch !== epoch || identity(activeRun.context || {}) !== identity(options.getContext() || {}))) activeRun.controller?.abort();
            queued = true;
            if (running) return running;
            const task = (async () => {
                let result = false, passes = 0;
                while (queued && passes++ < 3) {
                    queued = false;
                    const run = { epoch };
                    activeRun = run;
                    try { result = await cycle(run); }
                    catch (error) {
                        if (epoch === run.epoch && stillCurrent(run.context || {}, run.epoch)) publish('Needs attention', error.message || String(error));
                        result = false;
                    }
                }
                return result;
            })();
            running = task;
            task.finally(() => {
                if (running === task) running = null;
                activeRun = null;
                if (queued) signal('changed-during-load', 1000);
                else if (currentStatus.state === 'Up to date') scheduleBackground();
            });
            return task;
        }
        function signal(reason = 'event', delay = 250) {
            statistics.signals++;
            const ctx = options.getContext();
            if (!ctx?.scope || ctx.visible === false) { clearTimers(); closeSubscription(); epoch++; return; }
            if (activeRun && identity(activeRun.context || {}) !== identity(ctx)) activeRun.controller?.abort();
            if (backgroundRunning) invalidateBackground();
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
            if (running && activeRun?.epoch === epoch && identity(activeRun.context || {}) === identity(ctx)
                && activeRun.adapters?.some(item => item.id === adapter.id && item.cacheKey === adapter.cacheKey)) {
                return running.then(() => applied.get(adapter.id)?.cacheKey === adapter.cacheKey);
            }
            requested.set(adapter.id, adapter);
            return check('loader').then((ok) => ok && applied.get(adapter.id)?.cacheKey === adapter.cacheKey);
        }
        function suspend() { epoch++; clearTimers(); closeSubscription(); queued = false; }
        return Object.freeze({ check, signal, ensure, reset, suspend, getStatus: () => ({ ...currentStatus }), getBackgroundStatus: () => ({ ...backgroundStatus }), getStatistics: () => ({ ...statistics }) });
    }
    return Object.freeze({ createCoordinator, snapshot, signature });
});
