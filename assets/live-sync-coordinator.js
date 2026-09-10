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
    // Commits can attach drafts or mutate rows. Storage and the app each
    // receive their own copy, separate from the canonical server snapshot.
    function clone(value, seen = new Map()) {
        if (value === null || typeof value !== 'object') return value;
        if (seen.has(value)) return seen.get(value);
        const kind = Object.prototype.toString.call(value);
        if (kind === '[object Date]') return new value.constructor(value.getTime());
        if (kind === '[object Map]' || kind === '[object Set]') {
            const result = new value.constructor(); seen.set(value, result);
            if (kind === '[object Map]') value.forEach((item, key) => result.set(clone(key, seen), clone(item, seen)));
            else value.forEach((item) => result.add(clone(item, seen)));
            return result;
        }
        const result = Array.isArray(value) ? value.slice(0, 0) : Object.create(Object.getPrototypeOf(value));
        seen.set(value, result);
        Object.keys(value).forEach((key) => Object.defineProperty(result, key, { value: clone(value[key], seen), writable: true, enumerable: true, configurable: true }));
        return result;
    }
    function createCoordinator(options) {
        const now = options.now || Date.now, later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
        const canonical = new Map(), applied = new Map(), verified = new Map(), knownSources = new Map();
        const jobs = new Map(), loads = new Map();
        let sequence = 0, metadataSequence = 0, epoch = 0, scope = '', permission = '';
        let permissionRefresh = null;
        let pollTimer = null, signalTimer = null, signalAt = Infinity, unsubscribe = null, subscribedScope = '';
        let lastVerifiedAt = null, currentStatus = { state: 'Syncing', lastVerifiedAt: null };
        const statistics = { revisionReads: 0, adapterReads: 0, discardedLoads: 0, commits: 0, signals: 0, cacheHits: 0, previews: 0 };
        const adapterKey = (adapter, ctx) => JSON.stringify([ctx.scope, adapter.id, adapter.cacheKey, unique(adapter.sourceKeys)]);
        const appliedSignature = (adapter, meta) => JSON.stringify([adapter.cacheKey, signature(meta, adapter.sourceKeys)]);
        function publish(state, message = '', extra = {}) {
            currentStatus = { state, message, lastVerifiedAt, ...extra };
            options.onStatus?.(currentStatus);
        }
        function clearTimers() {
            if (pollTimer !== null) cancel(pollTimer);
            if (signalTimer !== null) cancel(signalTimer);
            pollTimer = signalTimer = null; signalAt = Infinity;
        }
        function closeSubscription() {
            if (unsubscribe) unsubscribe();
            unsubscribe = null; subscribedScope = '';
        }
        function invalidate() {
            epoch++; applied.clear(); verified.clear(); canonical.clear(); knownSources.clear(); loads.clear();
            permission = ''; permissionRefresh = null; lastVerifiedAt = null;
        }
        function reset() {
            invalidate(); clearTimers(); closeSubscription(); scope = '';
            publish('Syncing', 'Waiting to verify current data.');
        }
        function descriptors(items = []) {
            const result = new Map();
            items.forEach((adapter) => {
                if (!adapter || !adapter.id || !adapter.cacheKey || !Array.isArray(adapter.sourceKeys) || !adapter.sourceKeys.length) throw new Error('A live data adapter is missing its source contract.');
                result.set(adapter.id, { ...adapter, sourceKeys: unique(adapter.sourceKeys) });
            });
            return Array.from(result.values());
        }
        function context() {
            const next = options.getContext();
            if (!next?.scope) return next;
            if (scope !== next.scope) { invalidate(); scope = next.scope; closeSubscription(); }
            return { ...next, adapters: descriptors(next.adapters), backgroundAdapters: descriptors(next.backgroundAdapters) };
        }
        function identity(ctx) {
            return JSON.stringify([ctx?.scope, ctx?.viewKey, descriptors(ctx?.adapters).map((adapter) => [adapter.id, adapter.cacheKey, adapter.sourceKeys])]);
        }
        function sameView(ctx) { return identity(options.getContext()) === identity(ctx); }
        function validWork(ctx, startedEpoch, adapters) {
            const next = options.getContext();
            if (epoch !== startedEpoch || next?.scope !== ctx.scope || next.visible === false || next.online === false) return false;
            const current = [...(next.adapters || []), ...(next.backgroundAdapters || [])];
            // Navigation can stop displaying a shared dataset; changed query
            // parameters, account, and visibility remain cancellation fences.
            return adapters.every((adapter) => !current.some((item) => item.id === adapter.id
                && (item.cacheKey !== adapter.cacheKey || JSON.stringify(unique(item.sourceKeys)) !== JSON.stringify(adapter.sourceKeys))));
        }
        function arm(ctx) {
            if (pollTimer !== null) cancel(pollTimer);
            pollTimer = null;
            if (!ctx?.scope || ctx.visible === false) { closeSubscription(); return; }
            pollTimer = later(() => { pollTimer = null; check('foreground-safeguard'); }, 30000);
            if (ctx.online === false) { closeSubscription(); return; }
            if (options.subscribe && subscribedScope !== ctx.scope) {
                closeSubscription(); subscribedScope = ctx.scope;
                unsubscribe = options.subscribe((event) => {
                    const key = event?.new?.key || event?.old?.key, current = options.getContext();
                    if (!key || [...(current?.adapters || []), ...(current?.backgroundAdapters || [])].some((adapter) => adapter.sourceKeys.includes(key))) signal('metadata');
                }, () => signal('reconnect', 0)) || null;
            }
        }
        function ready(meta, adapter) { return adapter.sourceKeys.every((key) => meta.sources.get(key)?.state === 'ready'); }
        function recordMetadata(meta) {
            meta.sources.forEach((source, key) => {
                const known = knownSources.get(key);
                if (known?.observedOrder > meta.observedOrder) return;
                if (source.state !== 'unavailable' && known?.state !== 'unavailable'
                    && source.revision !== null && known?.revision !== null && known?.revision !== undefined
                    && BigInt(known.revision) > BigInt(source.revision)) return;
                knownSources.set(key, { ...source, observedOrder: meta.observedOrder });
            });
            const current = options.getContext();
            const visibleKeys = new Set((current?.adapters || []).map((adapter) => adapterKey(adapter, current)));
            let visibleInvalidated = false;
            verified.forEach((entry, key) => {
                if (entry.permissionVersion !== permission || entry.signature !== signature({ permissionVersion: permission, sources: knownSources }, entry.sourceKeys)) {
                    verified.delete(key);
                    visibleInvalidated ||= visibleKeys.has(key);
                }
            });
            if (visibleInvalidated && current?.visible !== false && current?.online !== false) {
                publish('Syncing', 'Source data changed; checking current data.');
                signal('dependency-change', 0);
            }
        }
        async function acceptMetadata(meta, ctx, startedEpoch, adapters) {
            if (!validWork(ctx, startedEpoch, adapters)) return false;
            if (permissionRefresh) { await permissionRefresh.promise; return false; }
            if (permission && permission !== meta.permissionVersion) {
                const previousPermission = permission;
                invalidate(); permission = previousPermission;
                publish('Syncing', 'Verifying updated access.');
                const refresh = { epoch, promise: null };
                refresh.promise = Promise.resolve().then(() => options.onPermissionChange?.(meta.permissionVersion)).then(() => {
                    if (epoch === refresh.epoch) permission = meta.permissionVersion;
                    if (permissionRefresh === refresh) permissionRefresh = null;
                    signal('permission-change', 0);
                }, (error) => {
                    if (permissionRefresh === refresh) permissionRefresh = null;
                    // Keep the old version until the authoritative access
                    // refresh succeeds. A later check must retry that fence.
                    throw error;
                });
                permissionRefresh = refresh;
                await refresh.promise;
                return false;
            }
            permission = meta.permissionVersion; recordMetadata(meta); return true;
        }
        function eligible(entry, adapter, ctx, meta) {
            if (!entry || entry.contractVersion !== 1 || entry.id !== adapter.id || entry.cacheKey !== adapter.cacheKey
                || entry.scope !== ctx.scope || entry.permissionVersion !== meta.permissionVersion
                || !Number.isFinite(entry.verifiedAt) || entry.value === undefined || !Array.isArray(entry.sources)
                || entry.sources.length !== adapter.sourceKeys.length) return false;
            const keys = new Set();
            return entry.sources.every((source) => {
                if (!adapter.sourceKeys.includes(source.key) || keys.has(source.key) || source.state !== 'ready' || !/^\d+$/.test(String(source.revision))) return false;
                keys.add(source.key);
                return meta.sources.get(source.key)?.state !== 'unavailable';
            });
        }
        function entryMatches(entry, adapter, meta) {
            return ready(meta, adapter) && signature({ permissionVersion: entry.permissionVersion, sources: new Map(entry.sources.map((source) => [source.key, source])) }, adapter.sourceKeys) === signature(meta, adapter.sourceKeys);
        }
        async function loadCanonical(adapter, ctx) {
            const existing = canonical.get(adapterKey(adapter, ctx));
            if (existing) return existing;
            try { return clone(await options.loadSnapshot?.(adapter, ctx)) || null; } catch (_) { return null; }
        }
        function saveCanonical(adapter, ctx, meta, value) {
            const entry = { contractVersion: 1, id: adapter.id, cacheKey: adapter.cacheKey, scope: ctx.scope,
                permissionVersion: meta.permissionVersion,
                sources: adapter.sourceKeys.map((key) => { const source = meta.sources.get(key); return { key, revision: source.revision, state: source.state }; }),
                verifiedAt: now(), value: clone(value) };
            canonical.set(adapterKey(adapter, ctx), entry);
            try { Promise.resolve(options.saveSnapshot?.(clone(entry))).catch(() => {}); } catch (_) { /* Storage is optional acceleration. */ }
            return entry;
        }
        async function readMetadata(keys) {
            statistics.revisionReads++;
            const observedOrder = ++metadataSequence;
            return { ...snapshot(await options.readRevisions(keys), keys), observedOrder };
        }
        function stage(adapter, ctx, meta, startedEpoch) {
            const key = JSON.stringify([startedEpoch, adapterKey(adapter, ctx), signature(meta, adapter.sourceKeys)]);
            if (loads.has(key)) return loads.get(key);
            const task = Promise.resolve().then(async () => {
                statistics.adapterReads++;
                const value = await adapter.stage();
                if (value === undefined) throw new Error(adapter.id + ' did not return a snapshot.');
                return clone(value);
            });
            loads.set(key, task);
            task.catch(() => { if (loads.get(key) === task) loads.delete(key); });
            // Keep a finished read available until its metadata fence stores
            // the canonical entry so navigation can share the same request.
            return task;
        }
        function isVerified(adapter) {
            const ctx = options.getContext();
            if (!ctx?.scope || ctx.scope !== scope || ctx.visible === false || ctx.online === false) return false;
            if ([...(ctx.adapters || []), ...(ctx.backgroundAdapters || [])].some((item) => item.id === adapter.id
                && (item.cacheKey !== adapter.cacheKey || JSON.stringify(unique(item.sourceKeys)) !== JSON.stringify(unique(adapter.sourceKeys))))) return false;
            const entry = verified.get(adapterKey(adapter, ctx));
            const meta = { permissionVersion: permission, sources: knownSources };
            return !!entry && entry.epoch === epoch && ready(meta, adapter) && entry.signature === signature(meta, adapter.sourceKeys)
                && applied.get(adapter.id) === appliedSignature(adapter, meta);
        }
        function blockedStatus(blocked, meta) {
            const states = blocked.flatMap((adapter) => adapter.sourceKeys.map((key) => meta.sources.get(key).state));
            const retained = lastVerifiedAt ? ' Keeping the last verified data.' : ' No complete snapshot has been verified in this session yet.';
            const unavailableReason = blocked.filter((adapter) => adapter.sourceKeys.some((key) => meta.sources.get(key).state === 'unavailable')).map((adapter) => adapter.unavailableReason).filter(Boolean).join(' ');
            publish(states.includes('interrupted') || states.includes('unavailable') ? 'Needs attention' : 'Importing',
                states.includes('interrupted') ? 'An import was interrupted.' + retained : states.includes('unavailable') ? (unavailableReason || 'Some data could not be verified for your current access.') : 'An import is in progress.' + retained,
                { blockedSources: unique(blocked.flatMap((adapter) => adapter.sourceKeys)) });
        }
        async function cycle(ctx, adapters, foreground) {
            const startedEpoch = epoch;
            const report = (state, message) => { if (foreground && sameView(ctx)) publish(state, message); };
            const retry = () => ({ result: false, retry: true });
            const aborted = () => {
                statistics.discardedLoads++;
                const next = options.getContext();
                return { result: false, retry: foreground && !!next?.scope && next.visible !== false && next.online !== false
                    && (next.scope !== ctx.scope || identity(next) !== identity(ctx)) };
            };
            adapters.forEach((adapter) => verified.delete(adapterKey(adapter, ctx)));
            const keys = unique(adapters.flatMap((adapter) => adapter.sourceKeys));
            if (!keys.length) { report('Up to date', 'This screen has no live data.'); return { result: true }; }
            if (keys.length > 64) throw new Error('This screen exceeds the revision request limit.');
            const [before, entries] = await Promise.all([readMetadata(keys), Promise.all(adapters.map((adapter) => loadCanonical(adapter, ctx)))]);
            if (!validWork(ctx, startedEpoch, adapters)) return aborted();
            if (!await acceptMetadata(before, ctx, startedEpoch, adapters)) return retry();
            if (!validWork(ctx, startedEpoch, adapters)) return aborted();
            const cached = new Map(), previews = [];
            entries.forEach((entry, index) => {
                const adapter = adapters[index];
                if (!eligible(entry, adapter, ctx, before)) return;
                canonical.set(adapterKey(adapter, ctx), entry);
                if (entryMatches(entry, adapter, before)) { cached.set(adapter.id, entry); statistics.cacheHits++; }
                else previews.push({ adapter, value: clone(entry.value) });
            });
            // A matching saved master must still be visible while a changed
            // joined source loads. Keep the entire preview read-only until
            // the final source-vector fence commits the dependency group.
            if (adapters.some((adapter) => !cached.has(adapter.id))) {
                adapters.forEach((adapter) => {
                    const entry = cached.get(adapter.id);
                    if (entry && applied.get(adapter.id) !== appliedSignature(adapter, before)) previews.push({ adapter, value: clone(entry.value) });
                });
            }
            if (previews.length && sameView(ctx) && validWork(ctx, startedEpoch, adapters)) {
                options.previewSnapshots?.(previews, ctx, before); statistics.previews += previews.length;
            }
            const blocked = adapters.filter((adapter) => !ready(before, adapter));
            const changed = adapters.filter((adapter) => ready(before, adapter) && !cached.has(adapter.id));
            const staged = [], failed = new Set();
            let failure = null, cursor = 0;
            if (changed.length) {
                report('Syncing', 'Checking and loading changed data.');
                if (sameView(ctx)) options.onStageStart?.(ctx, before);
                await Promise.all(Array.from({ length: Math.min(options.concurrency || 2, changed.length) }, async () => {
                    while (cursor < changed.length) {
                        const adapter = changed[cursor++];
                        try { staged.push({ adapter, value: await stage(adapter, ctx, before, startedEpoch) }); }
                        catch (error) { failed.add(adapter.id); failure = error; }
                    }
                }));
            }
            const after = changed.length ? await readMetadata(keys) : before;
            if (!validWork(ctx, startedEpoch, adapters)) return aborted();
            if (!await acceptMetadata(after, ctx, startedEpoch, adapters)) return retry();
            if (!validWork(ctx, startedEpoch, adapters)) return aborted();
            if (signature(after, keys) !== signature({ permissionVersion: permission, sources: knownSources }, keys)) return retry();
            // Keep stable datasets across a retry. Only adapters whose own
            // source vectors changed need another complete download.
            staged.forEach(({ adapter, value }) => {
                if (ready(after, adapter) && signature(before, adapter.sourceKeys) === signature(after, adapter.sourceKeys)) cached.set(adapter.id, saveCanonical(adapter, ctx, after, value));
            });
            changed.forEach((adapter) => loads.delete(JSON.stringify([startedEpoch, adapterKey(adapter, ctx), signature(before, adapter.sourceKeys)])));
            if (signature(before, keys) !== signature(after, keys)) {
                statistics.discardedLoads++;
                report('Syncing', 'Source data changed while loading; checking again.');
                return retry();
            }
            // No asynchronous work between final validation and application.
            // A past screen can populate storage but cannot paint its view.
            if (!sameView(ctx)) return { result: false };
            const commits = adapters.filter((adapter) => cached.has(adapter.id) && !failed.has(adapter.id)
                && applied.get(adapter.id) !== appliedSignature(adapter, after)).map((adapter) => ({ adapter, value: clone(cached.get(adapter.id).value) }));
            if (commits.length) {
                if (options.commitSnapshots) options.commitSnapshots(commits, ctx, after);
                else commits.forEach(({ adapter, value }) => adapter.commit(value));
                commits.forEach(({ adapter }) => applied.set(adapter.id, appliedSignature(adapter, after)));
                statistics.commits++;
            }
            if (!validWork(ctx, startedEpoch, adapters) || !sameView(ctx)) return aborted();
            let verifiedCount = 0;
            adapters.forEach((adapter) => {
                if (ready(after, adapter) && !failed.has(adapter.id) && applied.get(adapter.id) === appliedSignature(adapter, after)) {
                    verified.set(adapterKey(adapter, ctx), { epoch, sequence: ++sequence, permissionVersion: permission, sourceKeys: adapter.sourceKeys, signature: signature(after, adapter.sourceKeys) });
                    verifiedCount++;
                }
            });
            if (verifiedCount) options.onVerified?.(ctx);
            if (failure) { report('Needs attention', failure.message || String(failure)); return { result: false }; }
            if (blocked.length) { if (foreground && sameView(ctx)) blockedStatus(blocked, before); return { result: false }; }
            if (foreground) { lastVerifiedAt = now(); report('Up to date'); }
            return { result: true };
        }
        function start(ctx, adapters, foreground) {
            const key = JSON.stringify([epoch, identity(ctx), foreground, adapters.map((adapter) => adapterKey(adapter, ctx))]);
            const existing = jobs.get(key);
            if (existing) { existing.queued = true; return existing.promise; }
            const job = { queued: false, promise: null };
            job.promise = (async () => {
                let result = false, passes = 0, active = ctx, group = adapters;
                do {
                    job.queued = false;
                    try {
                        const outcome = await cycle(active, group, foreground);
                        result = outcome.result; job.queued ||= !!outcome.retry;
                    } catch (error) {
                        if (foreground && sameView(active)) publish('Needs attention', error.message || String(error));
                        result = false;
                    }
                    if (job.queued && foreground) {
                        const next = context(); arm(next);
                        if (!next?.scope || next.visible === false || next.online === false) { job.queued = false; break; }
                        active = next; group = next.adapters;
                    }
                } while (job.queued && ++passes < 3);
                if (job.queued) signal('changed-during-load', 1000);
                return result;
            })();
            jobs.set(key, job);
            job.promise.finally(() => { if (jobs.get(key) === job) jobs.delete(key); });
            return job.promise;
        }
        function check(reason = 'check') {
            const ctx = context(); arm(ctx);
            if (!ctx?.scope || ctx.visible === false) return Promise.resolve(false);
            if (ctx.online === false) { publish('Offline', 'Showing the last verified data, if available.'); return Promise.resolve(false); }
            const task = start(ctx, ctx.adapters, true);
            task.then(() => {
                const next = context();
                if (next?.scope && next.visible !== false && next.online !== false && sameView(ctx)) {
                    const critical = new Set(next.adapters.map((adapter) => adapter.id));
                    const background = next.backgroundAdapters.filter((adapter) => !critical.has(adapter.id));
                    if (background.length) start(next, background, false);
                }
            });
            return task;
        }
        function signal(reason = 'event', delay = 250) {
            statistics.signals++;
            const ctx = options.getContext();
            if (!ctx?.scope || ctx.visible === false) { suspend(); return; }
            const due = now() + Math.max(0, delay);
            if (signalTimer !== null && signalAt <= due) return;
            if (signalTimer !== null) cancel(signalTimer);
            signalAt = due;
            signalTimer = later(() => { signalTimer = null; signalAt = Infinity; check(reason); }, Math.max(0, delay));
        }
        function ensure(adapter, force = false) {
            const ctx = context();
            if (!ctx?.scope || ctx.visible === false || ctx.online === false) return Promise.resolve(false);
            if (!force && isVerified(adapter)) return Promise.resolve(true);
            const startedEpoch = epoch, startedSequence = sequence;
            const visible = ctx.adapters.some((item) => item.id === adapter.id && item.cacheKey === adapter.cacheKey);
            // Explicit auxiliary loaders own their requested dependency group;
            // a badge cannot delay a visible loader's completion.
            const task = visible ? check('loader') : start(ctx, descriptors([adapter]), false);
            return task.then(() => epoch === startedEpoch && options.getContext()?.scope === ctx.scope
                && isVerified(adapter) && verified.get(adapterKey(adapter, ctx))?.sequence > startedSequence);
        }
        function suspend() { epoch++; verified.clear(); loads.clear(); clearTimers(); closeSubscription(); }
        return Object.freeze({ check, signal, ensure, isVerified, reset, suspend, getStatus: () => ({ ...currentStatus }), getStatistics: () => ({ ...statistics }) });
    }
    return Object.freeze({ createCoordinator, snapshot, signature });
});
