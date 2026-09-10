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
    // Only caller-owned, stable graphs may be copied across a yield. Generic
    // adapter results keep the immediate capture above: their producers may
    // retain and mutate them as soon as stage() returns.
    async function copyOwnedSnapshot(value, options = {}) {
        const clock = options.now || (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
        const pause = options.yieldToUi || (() => new Promise((resolve) => setTimeout(resolve, 0)));
        const seen = new Map(), pending = [];
        function allocate(source) {
            if (source === null || typeof source !== 'object') return source;
            if (seen.has(source)) return seen.get(source);
            const kind = Object.prototype.toString.call(source);
            if (kind === '[object Date]') {
                const target = new source.constructor(source.getTime()); seen.set(source, target); return target;
            }
            const target = kind === '[object Map]' || kind === '[object Set]' ? new source.constructor()
                : Array.isArray(source) ? new source.constructor(source.length) : Object.create(Object.getPrototypeOf(source));
            seen.set(source, target);
            const iterator = kind === '[object Map]' ? source.entries() : kind === '[object Set]' ? source.values()
                : (function* () { for (const key in source) if (Object.prototype.hasOwnProperty.call(source, key)) yield key; })();
            pending.push({ source, target, kind, iterator });
            return target;
        }
        options.assertCurrent?.();
        const result = allocate(value);
        let started = clock(), operations = 0;
        while (pending.length) {
            const frame = pending[pending.length - 1], next = frame.iterator.next();
            if (next.done) pending.pop();
            else if (frame.kind === '[object Map]') frame.target.set(allocate(next.value[0]), allocate(next.value[1]));
            else if (frame.kind === '[object Set]') frame.target.add(allocate(next.value));
            else Object.defineProperty(frame.target, next.value, { value: allocate(frame.source[next.value]), writable: true, enumerable: true, configurable: true });
            operations++;
            if (pending.length && (operations >= 8192 || clock() - started >= 8)) {
                options.assertCurrent?.(); options.onYield?.();
                await pause();
                options.assertCurrent?.(); started = clock(); operations = 0;
            }
        }
        options.assertCurrent?.();
        return result;
    }
    function createCoordinator(options) {
        const now = options.now || Date.now, later = options.setTimeout || setTimeout, cancel = options.clearTimeout || clearTimeout;
        const canonical = new Map(), applied = new Map(), verified = new Map(), knownSources = new Map();
        const jobs = new Map(), loads = new Map(), ownedLoadIdentities = new Map();
        let sequence = 0, metadataSequence = 0, epoch = 0, scope = '', permission = '';
        let permissionRefresh = null;
        let pollTimer = null, signalTimer = null, signalAt = Infinity, unsubscribe = null, subscribedScope = '';
        let lastVerifiedAt = null, currentStatus = { state: 'Syncing', lastVerifiedAt: null };
        const statistics = { revisionReads: 0, adapterReads: 0, discardedLoads: 0, commits: 0, signals: 0, cacheHits: 0, previews: 0 };
        const adapterKey = (adapter, ctx) => JSON.stringify([ctx.scope, adapter.id, adapter.cacheKey, unique(adapter.sourceKeys)]);
        const appliedSignature = (adapter, meta) => JSON.stringify([adapter.cacheKey, signature(meta, adapter.sourceKeys)]);
        const ownsMasterSnapshot = (adapter) => adapter.id === 'core:master' && adapter.snapshotOwnership === 'coordinator';
        function copyCancellation() { return Object.assign(new Error('Data changed while preparing a snapshot.'), { code: 'SNAPSHOT_COPY_CANCELLED' }); }
        function readIdentity() { return options.getSnapshotReadIdentity?.(); }
        function prepareCopy(value, ctx, startedEpoch, adapters, copyState) {
            // One identity anchor covers the entire copy phase, including the
            // microtask gaps between sequential disk/UI copies.
            const capturedIdentity = copyState.readIdentity;
            return copyOwnedSnapshot(value, { yieldToUi: options.yieldToUi,
                assertCurrent: () => { if (!validWork(ctx, startedEpoch, adapters) || readIdentity() !== capturedIdentity) throw copyCancellation(); },
                onYield: () => { copyState.yielded = true; }
            });
        }
        function stageKey(adapter, ctx, meta, startedEpoch, capturedIdentity = readIdentity()) {
            const parts = [startedEpoch, adapterKey(adapter, ctx), signature(meta, adapter.sourceKeys)];
            if (ownsMasterSnapshot(adapter)) parts.push(capturedIdentity);
            return JSON.stringify(parts);
        }
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
            epoch++; applied.clear(); verified.clear(); canonical.clear(); knownSources.clear(); loads.clear(); ownedLoadIdentities.clear();
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
        async function loadCanonical(adapter, ctx, startedEpoch, copyState) {
            const existing = canonical.get(adapterKey(adapter, ctx));
            if (existing) return existing;
            try {
                if (ownsMasterSnapshot(adapter) && options.loadStableSnapshot) {
                    const entry = await options.loadStableSnapshot(adapter, ctx);
                    return entry ? await prepareCopy(entry, ctx, startedEpoch, [adapter], copyState) : null;
                }
                return clone(await options.loadSnapshot?.(adapter, ctx)) || null;
            } catch (error) { if (error?.code === 'SNAPSHOT_COPY_CANCELLED') throw error; return null; }
        }
        function canonicalEntry(adapter, ctx, meta, value) {
            return { contractVersion: 1, id: adapter.id, cacheKey: adapter.cacheKey, scope: ctx.scope,
                permissionVersion: meta.permissionVersion,
                sources: adapter.sourceKeys.map((key) => { const source = meta.sources.get(key); return { key, revision: source.revision, state: source.state }; }),
                verifiedAt: now(), value };
        }
        function saveCanonical(adapter, ctx, meta, value, preparedDiskEntry) {
            if (ownsMasterSnapshot(adapter)) {
                const entry = canonicalEntry(adapter, ctx, meta, value);
                canonical.set(adapterKey(adapter, ctx), entry);
                if (preparedDiskEntry) {
                    preparedDiskEntry.verifiedAt = entry.verifiedAt;
                    // This dedicated graph is transferred exactly once. Neither
                    // canonical nor the later UI commit shares mutable values.
                    try { Promise.resolve((options.saveOwnedSnapshot || options.saveSnapshot)?.(preparedDiskEntry)).catch(() => {}); } catch (_) { /* Optional storage. */ }
                }
                return entry;
            }
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
            const capturedIdentity = readIdentity();
            if (ownsMasterSnapshot(adapter)) ownedLoadIdentities.forEach((identity, key) => {
                if (identity !== capturedIdentity) { loads.delete(key); ownedLoadIdentities.delete(key); }
            });
            const key = stageKey(adapter, ctx, meta, startedEpoch, capturedIdentity);
            if (loads.has(key)) return loads.get(key);
            const task = Promise.resolve().then(async () => {
                if (ownsMasterSnapshot(adapter) && capturedIdentity !== readIdentity()) throw copyCancellation();
                statistics.adapterReads++;
                const value = await adapter.stage();
                if (value === undefined) throw new Error(adapter.id + ' did not return a snapshot.');
                if (ownsMasterSnapshot(adapter)) {
                    if (!validWork(ctx, startedEpoch, [adapter]) || capturedIdentity !== readIdentity()) throw copyCancellation();
                    // The explicit descriptor transfers a detached master graph;
                    // it is never handed directly to UI or persistence callers.
                    return value;
                }
                return clone(value);
            });
            loads.set(key, task);
            if (ownsMasterSnapshot(adapter)) ownedLoadIdentities.set(key, capturedIdentity);
            task.catch(() => { if (loads.get(key) === task) { loads.delete(key); ownedLoadIdentities.delete(key); } });
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
            const copyState = { yielded: false, readIdentity: readIdentity() };
            let [before, entries] = await Promise.all([readMetadata(keys), Promise.all(adapters.map((adapter) => loadCanonical(adapter, ctx, startedEpoch, copyState)))]);
            if (!validWork(ctx, startedEpoch, adapters)) return aborted();
            if (!await acceptMetadata(before, ctx, startedEpoch, adapters)) return retry();
            if (!validWork(ctx, startedEpoch, adapters)) return aborted();
            const cached = new Map(), previews = [];
            entries.forEach((entry, index) => {
                const adapter = adapters[index];
                if (!eligible(entry, adapter, ctx, before)) return;
                canonical.set(adapterKey(adapter, ctx), entry);
                if (entryMatches(entry, adapter, before)) { cached.set(adapter.id, entry); statistics.cacheHits++; }
                else previews.push({ adapter, value: ownsMasterSnapshot(adapter) ? entry.value : clone(entry.value) });
            });
            // A matching saved master must still be visible while a changed
            // joined source loads. Keep the entire preview read-only until
            // the final source-vector fence commits the dependency group.
            if (adapters.some((adapter) => !cached.has(adapter.id))) {
                adapters.forEach((adapter) => {
                    const entry = cached.get(adapter.id);
                    if (entry && applied.get(adapter.id) !== appliedSignature(adapter, before)) previews.push({ adapter, value: ownsMasterSnapshot(adapter) ? entry.value : clone(entry.value) });
                });
            }
            for (const preview of previews) if (ownsMasterSnapshot(preview.adapter)) {
                preview.value = await prepareCopy(preview.value, ctx, startedEpoch, [preview.adapter], copyState);
            }
            // An authorized saved preview must not wait for changed row reads.
            // Recheck access after yielding copies, before exposing that preview.
            if (previews.length && copyState.yielded) {
                const previewMeta = await readMetadata(keys);
                if (!validWork(ctx, startedEpoch, adapters)) return aborted();
                if (readIdentity() !== copyState.readIdentity) throw copyCancellation();
                if (!await acceptMetadata(previewMeta, ctx, startedEpoch, adapters)) return retry();
                if (signature(before, keys) !== signature(previewMeta, keys)
                    || signature(previewMeta, keys) !== signature({ permissionVersion: permission, sources: knownSources }, keys)) return retry();
                before = previewMeta; copyState.yielded = false;
            }
            if (previews.some((item) => ownsMasterSnapshot(item.adapter)) && readIdentity() !== copyState.readIdentity) throw copyCancellation();
            if (previews.length && signature(before, keys) !== signature({ permissionVersion: permission, sources: knownSources }, keys)) return retry();
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
                // onStageStart may initialize the accepted permission identity.
                copyState.readIdentity = readIdentity();
                await Promise.all(Array.from({ length: Math.min(options.concurrency || 2, changed.length) }, async () => {
                    while (cursor < changed.length) {
                        const adapter = changed[cursor++];
                        try { staged.push({ adapter, value: await stage(adapter, ctx, before, startedEpoch) }); }
                        catch (error) { failed.add(adapter.id); failure = error; }
                    }
                }));
            }
            const preparedCommits = new Map(), preparedDisk = new Map();
            for (const adapter of adapters) if (ownsMasterSnapshot(adapter) && !failed.has(adapter.id)) {
                const loaded = staged.find((item) => item.adapter.id === adapter.id);
                const value = loaded ? loaded.value : cached.get(adapter.id)?.value;
                if (value === undefined) continue;
                if (loaded && (options.saveOwnedSnapshot || options.saveSnapshot)) {
                    preparedDisk.set(adapter.id, await prepareCopy(canonicalEntry(adapter, ctx, before, value), ctx, startedEpoch, [adapter], copyState));
                }
                if (applied.get(adapter.id) !== appliedSignature(adapter, before)) {
                    preparedCommits.set(adapter.id, await prepareCopy(value, ctx, startedEpoch, [adapter], copyState));
                }
            }
            if (failure?.code === 'SNAPSHOT_COPY_CANCELLED') throw failure;
            const after = changed.length || copyState.yielded ? await readMetadata(keys) : before;
            if (!validWork(ctx, startedEpoch, adapters)) return aborted();
            if (adapters.some(ownsMasterSnapshot) && readIdentity() !== copyState.readIdentity) throw copyCancellation();
            if (!await acceptMetadata(after, ctx, startedEpoch, adapters)) return retry();
            if (!validWork(ctx, startedEpoch, adapters)) return aborted();
            if (adapters.some(ownsMasterSnapshot) && readIdentity() !== copyState.readIdentity) throw copyCancellation();
            if (signature(after, keys) !== signature({ permissionVersion: permission, sources: knownSources }, keys)) return retry();
            // Keep stable datasets across a retry. Only adapters whose own
            // source vectors changed need another complete download.
            staged.forEach(({ adapter, value }) => {
                if (ready(after, adapter) && signature(before, adapter.sourceKeys) === signature(after, adapter.sourceKeys)) cached.set(adapter.id, saveCanonical(adapter, ctx, after, value, preparedDisk.get(adapter.id)));
            });
            changed.forEach((adapter) => { const key = stageKey(adapter, ctx, before, startedEpoch); loads.delete(key); ownedLoadIdentities.delete(key); });
            if (signature(before, keys) !== signature(after, keys)) {
                statistics.discardedLoads++;
                report('Syncing', 'Source data changed while loading; checking again.');
                return retry();
            }
            // No asynchronous work between final validation and application.
            // A past screen can populate storage but cannot paint its view.
            if (!sameView(ctx)) return { result: false };
            // Another navigation cycle may change applied while the metadata
            // request is pending. Never substitute an unprepared/undefined UI
            // graph for a newly necessary commit; prepare it in a fresh cycle.
            if (adapters.some((adapter) => ownsMasterSnapshot(adapter) && cached.has(adapter.id) && !failed.has(adapter.id)
                && applied.get(adapter.id) !== appliedSignature(adapter, after) && !preparedCommits.has(adapter.id))) return retry();
            const commits = adapters.filter((adapter) => cached.has(adapter.id) && !failed.has(adapter.id)
                && applied.get(adapter.id) !== appliedSignature(adapter, after)).map((adapter) => ({ adapter,
                    value: ownsMasterSnapshot(adapter) ? preparedCommits.get(adapter.id) : clone(cached.get(adapter.id).value) }));
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
                        if (error?.code === 'SNAPSHOT_COPY_CANCELLED') job.queued = true;
                        else if (foreground && sameView(active)) publish('Needs attention', error.message || String(error));
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
        function suspend() { epoch++; verified.clear(); loads.clear(); ownedLoadIdentities.clear(); clearTimers(); closeSubscription(); }
        return Object.freeze({ check, signal, ensure, isVerified, reset, suspend, getStatus: () => ({ ...currentStatus }), getStatistics: () => ({ ...statistics }) });
    }
    return Object.freeze({ createCoordinator, snapshot, signature, copyOwnedSnapshot });
});
