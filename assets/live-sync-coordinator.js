(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgMetricLiveSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const unique = (values) => Array.from(new Set(values)).sort();
    const optionalReadySources = new Set(['bunch_note_private.jobs', 'bunch_note_private.previews']);
    function snapshot(value, keys) {
        if (!value || value.contractVersion !== 1 || !Array.isArray(value.sources) || !value.permissionVersion) throw new Error('Data revision service returned an invalid response.');
        const sources = new Map();
        value.sources.forEach((source) => {
            const normalized = optionalReadySources.has(source.key) && source.state === 'unavailable'
                ? { ...source, revision: String(source.revision ?? '0'), state: 'ready', optional: true }
                : source;
            if (!keys.includes(normalized.key) || sources.has(normalized.key) || !(normalized.state === 'unavailable' && normalized.revision == null || /^\d+$/.test(String(normalized.revision))) || !['ready', 'importing', 'interrupted', 'unavailable'].includes(normalized.state)) throw new Error('Invalid data revision metadata.');
            sources.set(normalized.key, { ...normalized, revision: normalized.revision == null ? null : String(normalized.revision) });
        });
        // A denied/missing source must never look like an unchanged successful read.
        keys.forEach((key) => { if (!sources.has(key)) sources.set(key, { key, revision: '0', state: optionalReadySources.has(key) ? 'ready' : 'unavailable', ...(optionalReadySources.has(key) ? { optional: true } : {}) }); });
        return { sources, permissionVersion: String(value.permissionVersion), serverTime: value.serverTime };
    }
    function publishedReadable(source) {
        return !!source && ['importing', 'interrupted'].includes(source.state)
            && source.publishedReadable === true && typeof source.publishedRevision === 'string'
            && source.publishedRevision.length > 0 && Number.isFinite(Date.parse(source.publishedAt));
    }
    function readable(source) { return source?.state === 'ready' || publishedReadable(source); }
    function signature(meta, keys) {
        return JSON.stringify([meta.permissionVersion, ...unique(keys).map((key) => [key, meta.sources.get(key)?.revision, meta.sources.get(key)?.state, ...(publishedReadable(meta.sources.get(key)) ? [meta.sources.get(key).publishedRevision] : [])])]);
    }
    function canContinueRead(ctx) {
        return ctx?.authenticated === true && ctx.accessDenied === false && !!String(ctx.readIdentity || '');
    }
    function contextKey(ctx, permissionVersion = ctx.dataPermissionVersion || '') {
        const parts = [ctx.scope, permissionVersion, ctx.viewKey,
            (ctx.adapters || []).map((item) => [item.id, item.cacheKey])];
        if (Array.isArray(ctx.previewAdapterIds)) parts.push([...ctx.previewAdapterIds].sort());
        return JSON.stringify(parts);
    }
    function readContextKey(ctx) {
        // Permission hashes are proof/cache versions, not authenticated owners.
        // A real login epoch, account, role, view or filter change still fences reads.
        const key = contextKey(ctx, canContinueRead(ctx) ? '' : ctx.dataPermissionVersion || '');
        return ctx.readIdentity ? JSON.stringify([key, String(ctx.readIdentity)]) : key;
    }
    function createCoordinator(options) {
        const now = options.now || Date.now;
        const later = options.setTimeout || setTimeout;
        const cancel = options.clearTimeout || clearTimeout;
        const cacheFreshnessMs = Math.max(1000, Number(options.cacheFreshnessMs) || 30000);
        let revisionNotification = '';
        function notifyRevision(value, metadata, ctx, keys) {
            const incomingRevision = JSON.stringify([contextKey(ctx, metadata.permissionVersion), signature(metadata, keys)]);
            const accept = globalThis.AgDataKernel?.sync?.shouldAcceptRevision;
            if (accept ? !accept(revisionNotification, incomingRevision, value.hasRowDelta === true)
                : incomingRevision === revisionNotification && value.hasRowDelta !== true) return false;
            options.onRevisionRead?.(value, metadata, ctx);
            revisionNotification = incomingRevision;
            return true;
        }
        const applied = new Map();
        const appliedKey = adapter => JSON.stringify([adapter.id, adapter.cacheKey]);
        const appliedFor = adapter => applied.get(appliedKey(adapter));
        function rememberApplied(adapter, value, metadata, ctx, readOnlySnapshot = false) {
            const sourceSignature = signature(metadata, adapter.sourceKeys);
            const key = appliedKey(adapter);
            // Browse and full reads share an identity, but are distinct verified
            // contracts. Retain both at the same source revision so a full read
            // cannot cause the background cohort to downgrade it to browse.
            // Only an explicitly declared full superset can retain browse proof.
            // Different filters, seasons, revisions, and all non-master adapters
            // replace their prior contract. A browse commit always invalidates full.
            for (const [otherKey, entry] of applied) {
                if (entry.id !== adapter.id) continue;
                const coveredBrowse = adapter.projection === 'full' && entry.projection === 'browse'
                    && !!adapter.projectionFamily && adapter.projectionFamily === entry.projectionFamily
                    && entry.sourceSignature === sourceSignature;
                if (!coveredBrowse || otherKey === key) applied.delete(otherKey);
            }
            applied.set(key, { id: adapter.id, value, cacheKey: adapter.cacheKey, scope: String(ctx?.scope || ''),
                readIdentity: String(ctx?.readIdentity || ''),
                readOnlySnapshot,
                permissionVersion: String(metadata.permissionVersion || ''), sourceSignature,
                projection: adapter.projection, projectionFamily: adapter.projectionFamily,
                signature: JSON.stringify([adapter.cacheKey, sourceSignature]) });
            const siblings = [...applied].filter(([, entry]) => entry.id === adapter.id);
            while (siblings.length > 2) applied.delete(siblings.shift()[0]);
        }
        const requested = new Map();
        const forcedReloads = new Map();
        let epoch = 0, scope = '', readOwner = '', permission = '', running = null, queued = false;
        let activeRun = null, backgroundRunning = null, backgroundGeneration = 0, backgroundTimer = null, backgroundController = null;
        let pollTimer = null, signalTimer = null, signalAt = Infinity, signalReason = '', signalIdentity = '', unsubscribe = null, subscribedScope = '';
        let sourceGate = null, sourceGateTimer = null;
        const revisionChurnCounts = new Map();
        const readinessReasons = new Set(['visible-view', 'view-entry', 'login-shell-open', 'drive-detail-tab', 'av-notes-input']);
        let lastVerifiedAt = null, currentStatus = { state: 'Syncing', lastVerifiedAt: null };
        const verifiedAtByIdentity = new Map();
        let backgroundStatus = { state: 'Waiting', lastVerifiedAt: null };
        const statistics = { revisionReads: 0, adapterReads: 0, discardedLoads: 0, commits: 0, signals: 0, cacheHits: 0 };
        function publish(state, message = '', extra = {}) {
            if (state === 'Syncing' && currentStatus.state === 'Needs attention'
                && (!extra.contextKey || extra.contextKey === currentStatus.contextKey)) {
                state = 'Needs attention'; message = currentStatus.message;
            }
            currentStatus = { state, message, lastVerifiedAt, ...extra };
            options.onStatus?.(currentStatus);
        }
        function clearTimers() {
            if (pollTimer !== null) cancel(pollTimer);
            if (signalTimer !== null) cancel(signalTimer);
            if (sourceGateTimer !== null) cancel(sourceGateTimer);
            pollTimer = signalTimer = null;
            sourceGateTimer = null;
            signalAt = Infinity;
            invalidateBackground();
            activeRun?.controller?.abort();
            sourceGate?.probeController?.abort();
            sourceGate?.baselineController?.abort();
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
            if (unsubscribe) {
                try { Promise.resolve(unsubscribe()).catch(error => { globalThis.GncRuntimeWatchdog?.capture?.(error, 'closeSubscription'); }); } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'closeSubscription');}
            }
            unsubscribe = null; subscribedScope = '';
        }
        function reset() {
            epoch++; clearTimers(); running = null; activeRun = null; backgroundRunning = null; sourceGate = null; revisionChurnCounts.clear(); closeSubscription(); applied.clear(); requested.clear(); forcedReloads.clear(); verifiedAtByIdentity.clear();
            permission = ''; scope = ''; readOwner = ''; lastVerifiedAt = null; queued = false;
            backgroundStatus = { state: 'Waiting', lastVerifiedAt: null };
            publish('Syncing', 'Waiting to verify current data.');
        }
        function context() {
            const next = options.getContext();
            if (!next || !next.scope || next.visible === false || next.online === false) return next;
            if (scope !== next.scope || readOwner !== String(next.readIdentity || '')) {
                invalidateBackground();
                clearSourceGate();
                revisionChurnCounts.clear();
                epoch++; applied.clear(); requested.clear(); forcedReloads.clear(); verifiedAtByIdentity.clear(); permission = ''; lastVerifiedAt = null;
                scope = next.scope; readOwner = String(next.readIdentity || ''); closeSubscription();
            }
            return { ...next, adapters: (next.adapters || []).map((adapter) => ({ ...adapter, sourceKeys: [...adapter.sourceKeys] })) };
        }
        function arm(ctx) {
            if (pollTimer !== null) cancel(pollTimer);
            pollTimer = null;
            if (!ctx?.scope || ctx.visible === false) { closeSubscription(); return; }
            const pollMs = Math.max(8000, Number(options.getPollInterval?.(ctx)) || 30000);
            pollTimer = later(() => {
                pollTimer = null;
                const next = options.getContext();
                if (!next?.scope || next.visible === false || next.online === false) { clearTimers(); closeSubscription(); return; }
                options.onHeartbeat?.(next);
                check('foreground-safeguard');
            }, pollMs);
            if (ctx.online === false) { closeSubscription(); return; }
            if (ctx.online !== false && options.subscribe && subscribedScope !== ctx.scope) {
                closeSubscription(); subscribedScope = ctx.scope;
                unsubscribe = options.subscribe((event) => {
                    const key = event?.new?.key || event?.old?.key;
                    const next = options.getContext();
                    if (!key || [...(next?.adapters || []), ...(next?.backgroundAdapters || [])].some((adapter) => adapter.sourceKeys.includes(key))) signal('metadata', 0);
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
        function retainDisplay(ctx = context()) {
            if (!ctx?.progressive || ctx.visible === false || ctx.authenticated === false || ctx.accessDenied === true || !ctx.scope || scope !== ctx.scope
                || !options.retainAppliedDisplay) return false;
            const entries = (ctx.adapters || []).map(adapter => {
                const previous = appliedFor(adapter);
                return isDisplayRetainable(previous, adapter, ctx) ? { adapter, value: previous.value } : null;
            });
            if (!entries.length || !entries.every(Boolean)) return false;
            options.retainAppliedDisplay(ctx, entries);
            return true;
        }
        function hasFreshPermissionSnapshot(ctx) {
            if (Object.prototype.hasOwnProperty.call(ctx || {}, 'dataPermissionSnapshotFresh'))
                return ctx.dataPermissionSnapshotFresh === true;
            return !!String(ctx?.dataPermissionVersion || '');
        }
        function isDisplayRetainable(entry, adapter, ctx) {
            if (!entry || entry.cacheKey !== adapter.cacheKey || entry.scope !== String(ctx?.scope || '')
                || entry.readIdentity !== String(ctx?.readIdentity || '')
                || !entry.permissionVersion) return false;
            const currentVersion = String(ctx?.dataPermissionVersion || '');
            // A pending/stale access refresh is not evidence of revocation. Keep
            // the same-identity display while the server revalidates it, but do
            // not use this display-only path as a read/write authorization proof.
            if (!hasFreshPermissionSnapshot(ctx) || !currentVersion) return true;
            return currentVersion === entry.permissionVersion;
        }
        function identity(ctx) {
            return contextKey(ctx);
        }
        function isTrustedApplied(entry, adapter, ctx) {
            if (ctx?.authenticated === false || ctx?.accessDenied === true
                || !entry || entry.cacheKey !== adapter.cacheKey || entry.scope !== String(ctx?.scope || '')
                || entry.readIdentity !== String(ctx?.readIdentity || '')
                || !entry.permissionVersion || entry.readOnlySnapshot) return false;
            if (Object.prototype.hasOwnProperty.call(ctx || {}, 'dataPermissionVersion'))
                return !!String(ctx.dataPermissionVersion || '') && String(ctx.dataPermissionVersion) === entry.permissionVersion;
            return true;
        }
        function isReadAvailable(adapter, ctx) {
            if (isTrustedApplied(appliedFor(adapter), adapter, ctx)) return true;
            const entry = appliedFor(adapter);
            // This is loader availability only. Disk reuse and write/freshness
            // proof still require the exact permission hash above.
            return canContinueRead(ctx) && entry?.cacheKey === adapter.cacheKey
                && entry.scope === String(ctx.scope) && entry.readIdentity === String(ctx.readIdentity)
                && !!entry.permissionVersion && currentStatus.dataReadable === true
                && currentStatus.readContextKey === readContextKey(ctx);
        }
        function isAuthorizationDenied(error) {
            const status = Number(error?.status || error?.payload?.status || 0);
            const code = String(error?.code || error?.payload?.code || error?.payload?.sqlState || '').trim().toUpperCase();
            return [401, 403].includes(status) || ['42501', 'PGRST301', 'PGRST302', 'UNAUTHORIZED', 'FORBIDDEN', 'AUTHORIZATION_DENIED'].includes(code);
        }
        function discardAppliedAfterDenial(ctx, error) {
            if (!isAuthorizationDenied(error)) return false;
            const currentContext = options.getContext() || {};
            if (readContextKey(currentContext) !== readContextKey(ctx || {})) return false;
            applied.clear();
            verifiedAtByIdentity.clear();
            lastVerifiedAt = null;
            try {
                Promise.resolve(options.onPermissionChange?.(null, { reason: 'authorization-denied' })).catch(() => {});
            } catch (_) { globalThis.reportHandledRuntimeIssue?.("discardAppliedAfterDenial", 'HANDLED_OPERATION_FAILURE'); }
            return true;
        }
        function isRetainableTransientError(error) {
            const status = Number(error?.status || error?.payload?.status || 0);
            const code = String(error?.code || error?.payload?.code || error?.payload?.sqlState || '').trim().toUpperCase();
            const message = String(error?.message || error || '').toLowerCase();
            return status === 408 || status === 409 || status === 422 || status === 423 || status === 429 || status >= 500
                || code === 'SUPABASE_READ_COOLDOWN'
                || /timed out|timeout|failed to fetch|network(?:error| request)?|connection (?:closed|reset|interrupted)/i.test(message);
        }
        function getTransientRetryDelay(error) {
            const retryAfterMs = Number(error?.retryAfterMs || error?.payload?.retryAfterMs || 0);
            if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return Math.min(60000, Math.max(250, retryAfterMs + 50));
            const status = Number(error?.status || error?.payload?.status || 0);
            return status === 429 || status >= 500 || /timed out|timeout/i.test(String(error?.message || error || '')) ? 10000 : 1000;
        }
        function isSilentBackgroundRetry(error) {
            return String(error?.code || error?.payload?.code || '').trim().toUpperCase() === 'NATIVE_PROFILE_RETRY_REQUIRED';
        }
        function isInventoryRevisionAdoption(error) {
            const code = String(error?.code || error?.payload?.code || '').trim().toUpperCase();
            const message = String(error?.message || error || '');
            return ['LOC_ON_HAND_REVISION_CHANGED', 'LOC_REVISION_CHANGED'].includes(code)
                || /\b(?:LOC_ON_HAND_REVISION_CHANGED|LOC_REVISION_CHANGED)\b/i.test(message);
        }
        function stillCurrent(ctx, startedEpoch) {
            const next = options.getContext();
            return epoch === startedEpoch && next?.visible !== false && next?.online !== false
                && next?.authenticated !== false && next?.accessDenied !== true
                && readContextKey(next || {}) === readContextKey(ctx);
        }
        function cacheMeta(adapter, ctx, metadata) {
            return { contractVersion: 1, scope: ctx.scope, adapterId: adapter.id, cacheKey: adapter.cacheKey,
                dataPermissionVersion: String(ctx.dataPermissionVersion || ''), signature: signature(metadata, adapter.sourceKeys) };
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
        const sourceReadinessCodes = new Set(['LOC_ON_HAND_SOURCE_NOT_READY', 'LOC_SOURCE_NOT_READY', 'DATASET_NOT_READY', 'LOC_ON_HAND_REVISION_CHANGED', 'LOC_REVISION_CHANGED', 'MANAGER_REPORT_SOURCE_REVISION_CHANGED']);
        function sourceReadinessCode(error) {
            const direct = String(error?.code || error?.payload?.code || error?.payload?.sqlState || '').trim().toUpperCase();
            if (sourceReadinessCodes.has(direct)) return direct;
            const message = String(error?.message || error || '');
            return (message.match(/\b(LOC_ON_HAND_SOURCE_NOT_READY|LOC_SOURCE_NOT_READY|DATASET_NOT_READY|LOC_ON_HAND_REVISION_CHANGED|LOC_REVISION_CHANGED|MANAGER_REPORT_SOURCE_REVISION_CHANGED)\b/i) || [])[1]?.toUpperCase() || '';
        }
        function sourceGateMatches(ctx) {
            return !!sourceGate && sourceGate.scope === ctx?.scope
                && sourceGate.permissionVersion === String(ctx?.dataPermissionVersion || permission || '');
        }
        function clearSourceGate() {
            cancelSourceGateTimer();
            sourceGate?.probeController?.abort();
            sourceGate?.baselineController?.abort();
            sourceGate = null;
        }
        function getSourceGateKeys(error, sourceKeys = []) {
            const code = sourceReadinessCode(error);
            const status = Number(error?.status || error?.payload?.status || 0);
            if ([401, 403].includes(status) || !sourceKeys.includes('ph_master_inventory')) return [];
            if (['LOC_ON_HAND_SOURCE_NOT_READY', 'LOC_SOURCE_NOT_READY', 'LOC_ON_HAND_REVISION_CHANGED', 'LOC_REVISION_CHANGED'].includes(code)) return ['ph_master_inventory'];
            if (['DATASET_NOT_READY', 'MANAGER_REPORT_SOURCE_REVISION_CHANGED'].includes(code)
                && String(error?.source || error?.payload?.source || '').trim() === 'ph_master_inventory') return ['ph_master_inventory'];
            return [];
        }
        function cancelSourceGateTimer() {
            if (sourceGateTimer !== null) cancel(sourceGateTimer);
            sourceGateTimer = null;
        }
        function scheduleSourceGateProbe(delay = null) {
            if (!sourceGate || sourceGateTimer !== null) return;
            const ctx = options.getContext();
            if (!ctx?.scope || ctx.visible === false || ctx.online === false || !sourceGateMatches(ctx)) return;
            const slots = [30000, 60000, 120000];
            const base = delay == null ? slots[Math.min(sourceGate.probeIndex, slots.length - 1)] : Math.max(0, delay);
            const jitteredDelay = delay == null ? Math.min(120000, Math.floor(base * (1 + Math.random() * 0.2))) : Math.floor(base);
            sourceGateTimer = later(() => {
                sourceGateTimer = null;
                void probeSourceGate();
            }, jitteredDelay);
        }
        function startSourceGateBaseline(gate) {
            if (!gate || sourceGate !== gate || !gate.baselinePending || gate.baselineProbe) return gate?.baselineProbe || null;
            const ctx = options.getContext();
            if (!ctx?.scope || ctx.visible === false || ctx.online === false || !sourceGateMatches(ctx)) return null;
            gate.baselineController = typeof AbortController === 'function' ? new AbortController() : null;
            const baselineProbe = Promise.resolve().then(() => options.readRevisions(gate.sourceKeys, { signal: gate.baselineController?.signal })).then((value) => {
                if (sourceGate !== gate || !sourceGateMatches(options.getContext())) return;
                const metadata = snapshot(value, gate.sourceKeys);
                if (gate.permissionVersion && String(metadata.permissionVersion || '') !== gate.permissionVersion) {
                    clearSourceGate();
                    return;
                }
                if (!gate.permissionVersion) gate.permissionVersion = String(metadata.permissionVersion || '');
                permission = String(metadata.permissionVersion || permission || '');
                gate.baseline = new Map(gate.sourceKeys.map((key) => [key, metadata.sources.get(key)]));
                gate.baselinePending = false;
            }).catch(() => {
                if (sourceGate !== gate) return;
                const currentContext = options.getContext();
                gate.baselinePending = !currentContext?.scope || currentContext.visible === false || currentContext.online === false;
            }).finally(() => {
                if (gate.baselineProbe === baselineProbe) gate.baselineProbe = null;
                gate.baselineController = null;
            });
            gate.baselineProbe = baselineProbe;
            return baselineProbe;
        }
        async function probeSourceGate() {
            const gate = sourceGate;
            const ctx = options.getContext();
            if (!gate || !ctx?.scope || ctx.visible === false || ctx.online === false) return false;
            if (!sourceGateMatches(ctx)) { clearSourceGate(); return check('source-gate-context-changed'); }
            if (gate.probing) return gate.probing;
            const probe = (async () => {
                try {
                    if (gate.baselinePending) {
                        const baselineProbe = startSourceGateBaseline(gate);
                        if (baselineProbe) await baselineProbe;
                    }
                    const latestContext = options.getContext();
                    if (sourceGate !== gate || !latestContext?.scope || latestContext.visible === false || latestContext.online === false) return false;
                    gate.probeController = typeof AbortController === 'function' ? new AbortController() : null;
                    statistics.revisionReads++;
                    const value = await options.readRevisions(gate.sourceKeys, { signal: gate.probeController?.signal });
                    if (sourceGate !== gate) return false;
                    if (!sourceGateMatches(options.getContext())) { clearSourceGate(); return check('source-gate-context-changed'); }
                    const metadata = snapshot(value, gate.sourceKeys);
                    if (String(metadata.permissionVersion || '') !== gate.permissionVersion) {
                        clearSourceGate();
                        return check('source-gate-permission-changed');
                    }
                    const currentBaseline = new Map(gate.sourceKeys.map((key) => [key, metadata.sources.get(key)]));
                    const stableReadyRevision = gate.sourceKeys.every((key) => {
                        const source = metadata.sources.get(key);
                        const baseline = gate.baseline.get(key);
                        return source?.state === 'ready' && baseline?.state === 'ready' && source.revision === baseline.revision;
                    });
                    const readyRevisionKey = stableReadyRevision
                        ? JSON.stringify(gate.sourceKeys.map((key) => [key, metadata.sources.get(key)?.revision]))
                        : '';
                    if (stableReadyRevision && readyRevisionKey !== gate.lastHalfOpenRevision) {
                        gate.lastHalfOpenRevision = readyRevisionKey;
                        gate.halfOpenAllowed = true;
                        cancelSourceGateTimer();
                        return check('source-gate-half-open');
                    }
                    // A changed revision or the first ready observation becomes the new
                    // baseline. Require a later probe to confirm that exact ready revision
                    // is stable before spending the episode's one read attempt.
                    gate.baseline = currentBaseline;
                    gate.probeIndex += 1;
                    scheduleSourceGateProbe();
                    return false;
                } catch (_) {
                    if (sourceGate === gate) { gate.probeIndex += 1; scheduleSourceGateProbe(); }
                    return false;
                }
            })();
            gate.probing = probe;
            try { return await probe; }
            finally { if (gate.probing === probe) gate.probing = null; gate.probeController = null; }
        }
        function suspendForSourceReadiness(error, adapter, metadata, ctx) {
            const sourceKeys = getSourceGateKeys(error, adapter?.sourceKeys || []);
            if (!sourceKeys.length) return false;
            const permissionVersion = String(ctx?.dataPermissionVersion || metadata?.permissionVersion || '');
            if (sourceGateMatches(ctx) && sourceKeys.every((key) => sourceGate.sourceKeys.includes(key))) return true;
            clearSourceGate();
            sourceGate = {
                scope: ctx.scope,
                permissionVersion,
                sourceKeys,
                baseline: new Map(sourceKeys.map((key) => [key, metadata.sources.get(key)])),
                probeIndex: 0,
                probing: null,
                lastHalfOpenRevision: '',
                halfOpenAllowed: false,
                halfOpenInFlight: false
            };
            cancelSourceGateTimer();
            scheduleSourceGateProbe();
            return true;
        }
        function suspendDirectSourceRead(error, sourceKeys = []) {
            const gatedKeys = getSourceGateKeys(error, sourceKeys);
            if (!gatedKeys.length) return false;
            const ctx = options.getContext();
            if (!ctx?.scope) return false;
            if (sourceGateMatches(ctx)) return true;
            clearSourceGate();
            const keys = gatedKeys;
            const gate = {
                scope: ctx.scope,
                permissionVersion: String(ctx.dataPermissionVersion || permission || ''),
                sourceKeys: keys,
                baseline: new Map(),
                probeIndex: 0,
                probing: null,
                baselinePending: true,
                baselineProbe: null,
                baselineController: null,
                lastHalfOpenRevision: '',
                halfOpenAllowed: false,
                halfOpenInFlight: false
            };
            sourceGate = gate;
            cancelSourceGateTimer();
            scheduleSourceGateProbe();
            if (running) activeRun?.controller?.abort(error);
            startSourceGateBaseline(gate);
            return true;
        }
        function suspendForRevisionChurn(ctx, keys, metadata, contextKey) {
            const count = (revisionChurnCounts.get(contextKey) || 0) + 1;
            revisionChurnCounts.set(contextKey, count);
            if (revisionChurnCounts.size > 128) revisionChurnCounts.delete(revisionChurnCounts.keys().next().value);
            if (count < 3) return false;
            const normalizedKeys = unique(keys);
            const priorHalfOpenRevision = sourceGateMatches(ctx)
                && JSON.stringify(sourceGate.sourceKeys) === JSON.stringify(normalizedKeys)
                ? sourceGate.lastHalfOpenRevision : '';
            clearSourceGate();
            sourceGate = {
                scope: ctx.scope,
                permissionVersion: String(ctx.dataPermissionVersion || metadata.permissionVersion || ''),
                sourceKeys: normalizedKeys,
                baseline: new Map(keys.map((key) => [key, metadata.sources.get(key)])),
                probeIndex: 0,
                probing: null,
                lastHalfOpenRevision: priorHalfOpenRevision || '',
                halfOpenAllowed: false,
                halfOpenInFlight: false
            };
            cancelSourceGateTimer();
            scheduleSourceGateProbe();
            return true;
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
            let proofContextKey = identity(ctx);
            if (!background) lastVerifiedAt = verifiedAtByIdentity.get(proofContextKey) ?? null;
            const emit = background ? publishBackground : (state, message = '', extra = {}) => publish(state, message, { ...extra, contextKey: proofContextKey });
            if (ctx.online === false) { emit('Offline', 'Showing the last verified data, if available.'); return false; }
            if (ctx.accessDenied === true && ctx.accessDeniedConfirmed !== false) {
                discardAppliedAfterDenial(ctx, { status: 403 });
                emit('Needs attention', 'Access to this screen has been revoked.', { authorizationDenied: true, status: 403 });
                return false;
            }
            if (ctx.authenticated === false) {
                retainDisplay(ctx);
                emit('Refreshing', 'Keeping the last verified data while the session refreshes.', { retained: true, retryable: true });
                return false;
            }
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
            const visibleAdapters = ctx.adapters || [];
            let previewAdapters = visibleAdapters;
            if (ctx.previewAdapterIds !== undefined) {
                const requestedPreviewIds = ctx.previewAdapterIds;
                const visibleIds = new Set(visibleAdapters.map(adapter => adapter.id));
                if (!Array.isArray(requestedPreviewIds) || !requestedPreviewIds.length
                    || requestedPreviewIds.some(id => typeof id !== 'string' || !id || !visibleIds.has(id))
                    || new Set(requestedPreviewIds).size !== requestedPreviewIds.length) {
                    throw new Error('The progressive preview adapter subset is invalid.');
                }
                const previewIdSet = new Set(requestedPreviewIds);
                previewAdapters = visibleAdapters.filter(adapter => previewIdSet.has(adapter.id));
            }
            // Keep a previously applied complete cohort on screen during
            // revalidation. Replaying its old values as part of a newer
            // progressive preview can overwrite row-level realtime updates
            // before the replacement cohort passes the final revision check.
            const retainAppliedPreviewCohort = previewAdapters.length > 0
                && previewAdapters.every(adapter => appliedFor(adapter)?.cacheKey === adapter.cacheKey);
            if (!background) requested.clear();
            // A current, canonical access snapshot can authorize showing this
            // user's previously verified display cache while the revision RPC
            // is pending. It does not establish freshness or action permission.
            // Require the complete adapter cohort so joined views never mix
            // cached and missing data, and never preview on a background pass.
            const needsCachedDisplay = (ctx.adapters || []).some(adapter => {
                const previous = appliedFor(adapter);
                return !previous || previous.cacheKey !== adapter.cacheKey;
            });
            let lastPreview = null;
            const emitPreview = (entries, partialCohort, revisions) => {
                const samePreview = lastPreview
                    && lastPreview.partialCohort === partialCohort
                    && lastPreview.entries.length === entries.length
                    && entries.every((entry, index) => lastPreview.entries[index].adapter === entry.adapter
                        && lastPreview.entries[index].value === entry.value);
                if (samePreview) return;
                lastPreview = { entries, partialCohort };
                options.previewSnapshots(entries, { ...ctx, partialCohort }, revisions);
            };
            if (!background) retainDisplay(ctx);
            // A disk preview is safe only for a cold cohort. If even one
            // adapter is already applied, its current display may include
            // newer row-level realtime data that the cached cohort would undo.
            const hasAppliedPreviewAdapter = previewAdapters.some(adapter => appliedFor(adapter)?.cacheKey === adapter.cacheKey);
            if (!background && needsCachedDisplay && !hasAppliedPreviewAdapter
                && ctx.progressive && options.readDisplaySnapshot && options.previewSnapshots
                && ctx.dataPermissionVersion && current()) {
                const displayEntries = await Promise.all(previewAdapters.map(async (adapter) => {
                    const meta = { contractVersion: 1, scope: ctx.scope, adapterId: adapter.id, cacheKey: adapter.cacheKey,
                        dataPermissionVersion: String(ctx.dataPermissionVersion) };
                    try {
                        const value = await options.readDisplaySnapshot(adapter, meta);
                        return value === undefined || value === null ? null : { adapter, value };
                    } catch (_) { return null; }
                }));
                if (current() && displayEntries.length && displayEntries.every(Boolean)) {
                    const partialCohort = previewAdapters.length < visibleAdapters.length;
                    emitPreview(displayEntries, partialCohort, null);
                }
            }
            // A deferred cohort also verifies the foreground dependencies so it
            // cannot introduce a new shared revision beside older visible joins.
            let keys = unique([...adapters, ...(background ? ctx.adapters || [] : [])].flatMap(item => item.sourceKeys));
            if (!adapters.length || !keys.length) {
                const connectionKeys = unique(typeof options.connectionSourceKeys === 'function' ? options.connectionSourceKeys(ctx) || [] : []);
                if (!keys.length && connectionKeys.length) {
                    statistics.revisionReads++;
                    const connectionValue = await options.readRevisions(connectionKeys, { signal: run.controller?.signal });
                    if (!current()) return discard();
                    const connectionMetadata = snapshot(connectionValue, connectionKeys);
                    try { notifyRevision(connectionValue, connectionMetadata, ctx, connectionKeys); }
                    catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'revision-connected'); }
                }
                emit('Up to date', 'Connected; background data may continue loading.', { connectionOnly: !!connectionKeys.length });
                return true;
            }
            if (keys.length > 64) throw new Error('This screen exceeds the revision request limit.');
            statistics.revisionReads++;
            const beforeValue = await options.readRevisions(keys, { signal: run.controller?.signal });
            if (!current()) return discard();
            const before = snapshot(beforeValue, keys);
            try { notifyRevision(beforeValue, before, ctx, keys); }
            catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'revision-connected'); }
            if (canContinueRead(ctx)) proofContextKey = contextKey(ctx, before.permissionVersion);
            if (background && (ctx.adapters || []).length && (permission !== before.permissionVersion || (ctx.adapters || []).some(adapter => appliedFor(adapter)?.signature !== JSON.stringify([adapter.cacheKey, signature(before, adapter.sourceKeys)])))) {
                publish('Syncing', 'Source data changed; verifying visible data.');
                signal('background-source-changed', 0);
                return false;
            }
            const accessSnapshotPermissionVersion = String(ctx.dataPermissionVersion || '');
            const accessSnapshotFresh = hasFreshPermissionSnapshot(ctx);
            if ((permission && permission !== before.permissionVersion)
                || (accessSnapshotFresh && accessSnapshotPermissionVersion
                    && accessSnapshotPermissionVersion !== before.permissionVersion)) {
                applied.clear(); verifiedAtByIdentity.clear(); lastVerifiedAt = null;
                if (canContinueRead(ctx)) {
                    // The app applies confirmed revocation through its access
                    // context. Its background refresh is not a prerequisite for
                    // independently authorized, revision-bracketed server reads.
                    try { Promise.resolve(options.onPermissionChange?.(before.permissionVersion)).catch(error => { globalThis.GncRuntimeWatchdog?.capture?.(error, 'cycle'); }); }
                    catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'cycle');}
                } else await options.onPermissionChange?.(before.permissionVersion);
                if (!current()) return discard();
                // The revision contract and the fresh access snapshot are
                // independent reads. Never prove or render a joined snapshot
                // when their canonical permission hashes disagree, including
                // the first cycle before the coordinator has seen a hash.
                const refreshedContext = options.getContext();
                if (accessSnapshotFresh && accessSnapshotPermissionVersion
                    && String(refreshedContext?.dataPermissionVersion || '') !== before.permissionVersion
                    && !canContinueRead(refreshedContext)) {
                    emit('Needs attention', 'Access permissions changed while this screen was loading. Refresh access, then retry.');
                    return false;
                }
            }
            permission = before.permissionVersion;
            const blocked = adapters.filter((adapter) => adapter.sourceKeys.some((key) => !readable(before.sources.get(key))));
            // Revision visibility and endpoint authorization are independent.
            // E.g. a report may read private sources through a guarded RPC that
            // the metadata endpoint does not expose. Only a successful real
            // adapter read may supply display data; it cannot establish proof.
            const metadataReadOnly = !background && canContinueRead(ctx) && blocked.length > 0
                && blocked.every(adapter => adapter.sourceKeys.every(key => readable(before.sources.get(key))
                    || before.sources.get(key).state === 'unavailable'));
            if (metadataReadOnly) proofContextKey = JSON.stringify(['read-only-metadata', proofContextKey]);
            if (blocked.length && !metadataReadOnly) {
                const states = blocked.flatMap(adapter => adapter.sourceKeys.map(key => before.sources.get(key).state));
                const retained = lastVerifiedAt ? ' Keeping the last verified data.' : ' No complete snapshot has been verified in this session yet.';
                const unavailableReason = blocked.filter(adapter => adapter.sourceKeys.some(key => before.sources.get(key).state === 'unavailable')).map(adapter => adapter.unavailableReason).filter(Boolean).join(' ');
                const interrupted = states.includes('interrupted');
                emit(interrupted ? (lastVerifiedAt ? 'Published data' : 'Syncing') : states.includes('unavailable') ? 'Needs attention' : 'Importing',
                    interrupted ? (lastVerifiedAt ? 'Showing the last verified data while import recovery completes.' : 'Checking the last completed snapshot while import recovery completes.') : states.includes('unavailable') ? (unavailableReason || 'Some data could not be verified for your current access.') : `An import is in progress.${retained}`,
                    { blockedSources: unique(blocked.flatMap(adapter => adapter.sourceKeys)), unavailableSources: keys.filter(key => before.sources.get(key).state === 'unavailable'), ...(interrupted && lastVerifiedAt ? { dataReadable:true, readOnlySnapshot:true } : {}) });
                return false;
            }
            const changed = adapters.filter(adapter => metadataReadOnly || appliedFor(adapter)?.readOnlySnapshot
                || appliedFor(adapter)?.signature !== JSON.stringify([adapter.cacheKey, signature(before, adapter.sourceKeys)]));
            const staged = [];
            const display = new Map(adapters.filter(adapter => {
                const entry = appliedFor(adapter);
                return entry?.cacheKey === adapter.cacheKey
                    && entry.signature === JSON.stringify([adapter.cacheKey, signature(before, adapter.sourceKeys)]);
            })
                .map(adapter => [adapter.id, { adapter, value: appliedFor(adapter).value }]));
            const preview = (adapter, value) => {
                if (!ctx.progressive || background || retainAppliedPreviewCohort
                    || !options.previewSnapshots || !current() || value === undefined) return;
                const old = display.get(adapter.id)?.value;
                if (value.partial && old && !old.partial) return;
                display.set(adapter.id, { adapter, value });
                if (previewAdapters.length && previewAdapters.every(item => display.get(item.id)?.value !== undefined)) {
                    const partialCohort = previewAdapters.length < visibleAdapters.length;
                    emitPreview(previewAdapters.map(item => display.get(item.id)), partialCohort, before);
                }
            };
            let failure = null, cursor = 0;
            const fail = (error, adapter = null) => {
                if (failure) return;
                failure = error;
                if (isSilentBackgroundRetry(error) || isInventoryRevisionAdoption(error)) {
                    retainDisplay(ctx);
                    if (current()) emit('Syncing', 'Refreshing the latest account and inventory revision in the background.', { dataReadable: true, readContextKey: readContextKey(ctx) });
                    signal(isSilentBackgroundRetry(error) ? 'native-profile-retry' : 'inventory-revision-adopt', 1000);
                    run.controller?.abort(error);
                    return;
                }
                if (isRetainableTransientError(error) && !sourceReadinessCode(error)) {
                    const retained = retainDisplay(ctx);
                    if (current()) emit('Syncing', 'The connection was interrupted. Retrying current data in the background.', retained
                        ? { dataReadable: true, readContextKey: readContextKey(ctx), retryable: true }
                        : { retryable: true });
                    signal('transient-read-retry', getTransientRetryDelay(error));
                    run.controller?.abort(error);
                    return;
                }
                const permissionDenied = discardAppliedAfterDenial(ctx, error);
                suspendForSourceReadiness(error, adapter, before, ctx);
                if (current()) emit('Needs attention', error?.message || String(error), permissionDenied
                    ? { status: Number(error?.status || error?.payload?.status || 0), code: String(error?.code || error?.payload?.code || '').toUpperCase(), authorizationDenied: true }
                    : {});
                run.controller?.abort(error);
            };
            if (changed.length) {
                emit('Syncing', 'Checking and loading changed data.');
                options.onStageStart?.(ctx, before);
                const foregroundConcurrency = typeof options.getForegroundConcurrency === 'function'
                    ? options.getForegroundConcurrency(ctx) : options.concurrency;
                const stageConcurrency = background ? options.backgroundConcurrency || 1 : foregroundConcurrency || 2;
                await Promise.all(Array.from({ length: Math.min(stageConcurrency, changed.length) }, async () => {
                    while (cursor < changed.length && !failure && current()) {
                        const adapter = changed[cursor++];
                        try {
                            const meta = cacheMeta(adapter, ctx, before);
                            const cached = !metadataReadOnly && options.readCachedSnapshot ? await Promise.resolve().then(() => options.readCachedSnapshot(adapter, meta)).catch(() => null) : null;
                            if (!current()) return;
                            let value;
                            if (ctx.progressive && !background && !display.has(adapter.id)
                                && appliedFor(adapter)?.cacheKey !== adapter.cacheKey
                                && !cacheMatches(cached, meta) && options.readDisplaySnapshot) {
                                const displayValue = await options.readDisplaySnapshot(adapter, meta).catch(() => null);
                                if (displayValue) preview(adapter, displayValue);
                            }
                            if (cacheMatches(cached, meta)) { value = cached.value; statistics.cacheHits++; }
                            else {
                                const stage = () => {
                                    statistics.adapterReads++;
                                    return adapter.stage({ signal: run.controller?.signal, preview: ctx.progressive && !background ? value => preview(adapter, value) : undefined });
                                };
                                try { value = await stage(); }
                                catch (error) {
                                    if (!current() || !canContinueRead(ctx) || run.controller?.signal.aborted
                                        || !['DATASET_READ_SCOPE_CHANGED', 'LOC_ON_HAND_REVISION_CHANGED', 'LOC_REVISION_CHANGED'].includes(String(error?.code || error?.payload?.code || '').toUpperCase())) throw error;
                                    value = await stage();
                                }
                            }
                            if (value === undefined) throw new Error(`${adapter.id} did not return a snapshot.`);
                            // Replace a first-page display as soon as its full
                            // source finishes, even if another cohort member is
                            // slow. Revision validation and commit still follow.
                            if (!display.has(adapter.id) || !adapter.id.startsWith('core:')
                                || display.get(adapter.id)?.value?.partial === true && value.partial !== true) preview(adapter, value);
                            staged.push({ adapter, value });
                        } catch (error) { fail(error, adapter); }
                    }
                }));
                // An adapter may finish after pagehide suspended this cycle.
                // Check before starting another fetch in the departing page.
                if (!current()) return discard();
                if (failure) return false;
                statistics.revisionReads++;
                const afterValue = await options.readRevisions(keys, { signal: run.controller?.signal });
                if (!current()) return discard('Source data changed while loading; checking again.');
                const after = snapshot(afterValue, keys);
                if (signature(before, keys) !== signature(after, keys)) {
                    if (background) { publish('Syncing', 'Source data changed; verifying visible data.'); signal('background-source-changed', 0); }
                    else if (suspendForRevisionChurn(ctx, keys, after, proofContextKey)) {
                        emit('Needs attention', 'Source data is changing repeatedly. Pausing verification before another read.');
                        return false;
                    }
                    return discard('Source data changed while loading; checking again.');
                }
                // No asynchronous work is permitted between final validation and application.
                if (staged.length) {
                    if (options.commitSnapshots) options.commitSnapshots(staged, ctx, after);
                    else staged.forEach(({ adapter, value }) => adapter.commit(value));
                    statistics.commits++;
                    if (!current()) {
                        return discard('View settings changed; verifying the updated selection.');
                    }
                    staged.forEach(({ adapter, value }) => rememberApplied(adapter, value, after, ctx, metadataReadOnly));
                    if (!metadataReadOnly) staged.forEach(({ adapter, value }) => {
                        try { Promise.resolve(options.writeCachedSnapshot?.(adapter, value, cacheMeta(adapter, ctx, after))).catch(error => { globalThis.GncRuntimeWatchdog?.capture?.(error, 'cycle'); }); }
                        catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'cycle'); /* Cache persistence must not invalidate an authoritative commit. */ }
                    });
                }
            }
            if (!background && !metadataReadOnly) {
                revisionChurnCounts.delete(proofContextKey);
                lastVerifiedAt = now();
                verifiedAtByIdentity.set(proofContextKey, lastVerifiedAt);
            }
            if (!background && sourceGate?.halfOpenInFlight && sourceGateMatches(ctx)) clearSourceGate();
            const publishedSources = keys.filter(key => publishedReadable(before.sources.get(key)));
            const readableStatus = canContinueRead(ctx) ? { dataReadable: true, readContextKey: readContextKey(ctx) } : {};
            if (metadataReadOnly) {
                emit('Available data', 'Showing authorized data while source metadata refreshes.', { ...readableStatus, readOnlySnapshot: true });
            } else if (publishedSources.length) {
                emit('Published data', 'Showing the last completed data. The latest import is recovering.', {
                    ...readableStatus, publishedSources, dataReadable: true, readOnlySnapshot: true,
                    publishedAt: publishedSources.map(key => before.sources.get(key).publishedAt).sort()[0]
                });
            } else emit('Up to date', '', readableStatus);
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
                    if (epoch === run.epoch && generation === backgroundGeneration) {
                        if (isSilentBackgroundRetry(error) || isInventoryRevisionAdoption(error)) signal(isSilentBackgroundRetry(error) ? 'native-profile-retry' : 'inventory-revision-adopt', 1000);
                        else publishBackground('Needs attention', error.message || String(error));
                    }
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
            const gateContext = options.getContext();
            if (sourceGate) {
                if (!gateContext?.scope || gateContext.visible === false || gateContext.online === false) {
                    cancelSourceGateTimer();
                    sourceGate?.probeController?.abort();
                    sourceGate?.baselineController?.abort();
                    return Promise.resolve(false);
                }
                if (!sourceGateMatches(gateContext)) {
                    clearSourceGate();
                } else if (sourceGate.halfOpenAllowed && !sourceGate.halfOpenInFlight) {
                    sourceGate.halfOpenAllowed = false;
                    sourceGate.halfOpenInFlight = true;
                } else if (sourceGate.halfOpenInFlight) {
                    return running || Promise.resolve(false);
                } else {
                    // Signals and user view entry must not turn one failed
                    // source proof into a burst of identical row downloads.
                    startSourceGateBaseline(sourceGate);
                    scheduleSourceGateProbe();
                    return sourceGate.probing || Promise.resolve(false);
                }
            }
            const nextIdentity = identity(options.getContext() || {});
            if (readinessReasons.has(reason)) {
                if (signalTimer !== null && readinessReasons.has(signalReason) && signalIdentity === nextIdentity) {
                    cancel(signalTimer); signalTimer = null; signalAt = Infinity;
                }
                // Rendering and navigation ask for the same proof. Real source,
                // permission and reconnect signals still queue another pass.
                if (running && activeRun?.epoch === epoch && readContextKey(activeRun.context || {}) === readContextKey(gateContext || {})) return running;
                if (!running && !queued && signalTimer === null && currentStatus.state === 'Up to date' && currentStatus.contextKey === nextIdentity) return Promise.resolve(true);
            }
            invalidateBackground();
            if (activeRun && (activeRun.epoch !== epoch || readContextKey(activeRun.context || {}) !== readContextKey(options.getContext() || {}))) {
                activeRun.controller?.abort();
                // Navigation owns a new foreground read. A cancelled transport
                // may ignore AbortSignal; fence its late result without waiting
                // for it or discarding the same-account applied snapshots.
                epoch++;
                running = null;
                activeRun = null;
            }
            queued = true;
            if (running) return running;
            const task = (async () => {
                let result = false, passes = 0;
                while (queued && passes++ < 3) {
                    if (passes > 1 && running !== task) break;
                    queued = false;
                    const run = { epoch };
                    activeRun = run;
                    try { result = await cycle(run); }
                    catch (error) {
                        if (epoch === run.epoch && stillCurrent(run.context || {}, run.epoch)) {
                            if (isSilentBackgroundRetry(error) || isInventoryRevisionAdoption(error)) {
                                retainDisplay(run.context || {});
                                publish('Syncing', 'Refreshing the latest account and inventory revision in the background.', {
                                    contextKey: identity(run.context || {}), dataReadable: true, readContextKey: readContextKey(run.context || {})
                                });
                                signal(isSilentBackgroundRetry(error) ? 'native-profile-retry' : 'inventory-revision-adopt', 1000);
                                result = false;
                                break;
                            }
                            if (isRetainableTransientError(error) && !sourceReadinessCode(error)) {
                                const retryContext = run.context || {};
                                const retained = retainDisplay(retryContext);
                                publish('Syncing', 'The connection was interrupted. Retrying current data in the background.', {
                                    contextKey: identity(retryContext), retryable: true,
                                    ...(retained ? { dataReadable: true, readContextKey: readContextKey(retryContext) } : {})
                                });
                                signal('transient-read-retry', getTransientRetryDelay(error));
                                result = false;
                                break;
                            }
                            const permissionDenied = discardAppliedAfterDenial(run.context, error);
                            publish('Needs attention', error.message || String(error), {
                                contextKey: identity(run.context || {}),
                                ...(permissionDenied ? { status: Number(error?.status || error?.payload?.status || 0),
                                    code: String(error?.code || error?.payload?.code || error?.payload?.sqlState || '').toUpperCase(),
                                    authorizationDenied: true } : {})
                            });
                        }
                        result = false;
                    }
                }
                return result;
            })();
            running = task;
            task.finally(() => {
                if (running !== task) return;
                running = null;
                activeRun = null;
                if (sourceGate?.halfOpenInFlight) {
                    sourceGate.halfOpenInFlight = false;
                    sourceGate.probeIndex += 1;
                    scheduleSourceGateProbe();
                }
                if (queued) signal('changed-during-load', 1000);
                else if (currentStatus.state === 'Up to date') scheduleBackground();
            });
            return task;
        }
        function signal(reason = 'event', delay = 250) {
            statistics.signals++;
            const ctx = options.getContext();
            if (!ctx?.scope || ctx.visible === false) { clearTimers(); closeSubscription(); epoch++; return; }
            if (readinessReasons.has(reason) && running && activeRun?.epoch === epoch && readContextKey(activeRun.context || {}) === readContextKey(ctx)) return;
            if (readinessReasons.has(reason) && !running && !queued && currentStatus.state === 'Up to date' && currentStatus.contextKey === identity(ctx)) return;
            if (activeRun && readContextKey(activeRun.context || {}) !== readContextKey(ctx)) activeRun.controller?.abort();
            if (backgroundRunning) invalidateBackground();
            const due = now() + Math.max(0, delay);
            if (signalTimer !== null && signalAt <= due) return;
            if (signalTimer !== null) cancel(signalTimer);
            signalAt = due;
            signalReason = reason; signalIdentity = identity(ctx);
            signalTimer = later(() => { signalTimer = null; signalAt = Infinity; check(reason); }, Math.max(0, delay));
        }
        function ensure(adapter, force = false) {
            const ctx = context();
            if (!ctx?.scope || ctx.visible === false || ctx.online === false || ctx.authenticated === false || ctx.accessDenied === true) return Promise.resolve(false);
            const ensureEpoch = epoch;
            const ensureKey = appliedKey(adapter);
            if (force && forcedReloads.has(ensureKey)) return forcedReloads.get(ensureKey);
            const appliedEntry = appliedFor(adapter);
            const hasCurrentPermissionSnapshot = Object.prototype.hasOwnProperty.call(ctx, 'dataPermissionVersion');
            if (appliedEntry && appliedEntry.scope === String(ctx.scope)
                && hasCurrentPermissionSnapshot && hasFreshPermissionSnapshot(ctx)
                && String(ctx.dataPermissionVersion || '')
                && appliedEntry.permissionVersion !== String(ctx.dataPermissionVersion)) {
                applied.clear(); verifiedAtByIdentity.clear(); lastVerifiedAt = null;
                try { Promise.resolve(options.onPermissionChange?.(String(ctx.dataPermissionVersion || ''), { reason: 'access-snapshot-changed' })).catch(error => { globalThis.GncRuntimeWatchdog?.capture?.(error, 'ensure'); }); } catch (error) { globalThis.GncRuntimeWatchdog?.capture?.(error, 'ensure');}
            }
            const wasApplied = isTrustedApplied(appliedFor(adapter), adapter, ctx);
            if (!force && wasApplied) {
                const contextKey = identity(ctx);
                const verifiedAt = verifiedAtByIdentity.get(contextKey);
                if (verifiedAt != null && now() - verifiedAt < cacheFreshnessMs) return Promise.resolve(true);
                // Keep the last complete snapshot on screen, but refresh its
                // revision in the background once the 30s freshness window ends.
                signal('cache-expired', 0);
                return Promise.resolve(true);
            }
            if (running && activeRun?.epoch === epoch && readContextKey(activeRun.context || {}) === readContextKey(ctx)
                && (!force || !wasApplied) && activeRun.adapters?.some(item => item.id === adapter.id && item.cacheKey === adapter.cacheKey)) {
                return running.then(() => epoch === ensureEpoch && isReadAvailable(adapter, options.getContext() || {}));
            }
            // Invalidate freshness without dropping the same-owner display value.
            // A forced loader must reapply its adapter even at an unchanged revision.
            if (force && appliedFor(adapter)) appliedFor(adapter).signature = null;
            requested.set(adapter.id, adapter);
            const result = check('loader').then(() => epoch === ensureEpoch
                && isReadAvailable(adapter, options.getContext() || {}));
            if (force) {
                forcedReloads.set(ensureKey, result);
                result.finally(() => { if (forcedReloads.get(ensureKey) === result) forcedReloads.delete(ensureKey); });
            }
            return result;
        }
        function suspend() { epoch++; clearTimers(); running = null; activeRun = null; backgroundRunning = null; closeSubscription(); queued = false; }
        return Object.freeze({ check, signal, ensure, reset, suspend, retainDisplay,
            isSourceReadSuspended: () => {
                const ctx = options.getContext();
                if (sourceGate && !sourceGateMatches(ctx)) clearSourceGate();
                if (sourceGate?.halfOpenInFlight && ctx?.scope && ctx.visible !== false && ctx.online !== false
                    && sourceGateMatches(ctx)) return false;
                return sourceGateMatches(ctx);
            },
            suspendSourceReads: (error, sourceKeys) => suspendDirectSourceRead(error, sourceKeys),
            getStatus: () => ({ ...currentStatus }), getBackgroundStatus: () => ({ ...backgroundStatus }), getStatistics: () => ({ ...statistics }) });
    }
    return Object.freeze({ createCoordinator, snapshot, signature, readContextKey, isPublishedReadable: publishedReadable, isReadableSource: readable,
        readSourceToken: source => JSON.stringify([source?.revision, source?.state, ...(publishedReadable(source) ? [source.publishedRevision] : [])]) });
});
