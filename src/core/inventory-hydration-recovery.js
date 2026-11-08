const inventoryRecoveryCodes = Object.freeze({
    incomplete: 'INVENTORY_SNAPSHOT_INCOMPLETE',
    changed: 'INVENTORY_SNAPSHOT_CHANGED'
});
const inventoryRecoveryLegacyMessages = new Set([
    'Inventory page was incomplete; the partial snapshot was discarded.',
    'Inventory total changed between pages; the partial snapshot was discarded.',
    'Inventory keyset boundary was invalid; the partial snapshot was discarded.',
    'Inventory field coverage changed between pages; the partial snapshot was discarded.',
    'Complete inventory rows could not be verified. Retry the report.'
]);
const inventoryRecoveryTerminalMessages = new Set([
    'Full inventory field coverage was missing or invalid; the partial snapshot was discarded.',
    'Direct inventory projection is unavailable.'
]);
const inventoryRecoveryDecorators = new WeakSet();

export function createSnapshotError(kind, detail = {}) {
    const code = inventoryRecoveryCodes[kind];
    if (!code) throw new RangeError('Unknown inventory snapshot recovery reason.');
    const metadata = typeof detail === 'string' ? { message: detail } : detail || {};
    const message = metadata.message || (kind === 'incomplete'
        ? 'Inventory page was incomplete; the partial snapshot was discarded.'
        : 'Inventory changed during pagination; the partial snapshot was discarded.');
    return Object.assign(new Error(message), metadata, { code, snapshotReason: kind });
}

function inventoryRecoveryTerminalError(error) {
    return [401, 403].includes(Number(error?.status || error?.statusCode || error?.payload?.status))
        || error?.name === 'AbortError'
        || inventoryRecoveryTerminalMessages.has(error?.message)
        || /PROJECTION|UNAUTHORIZED|FORBIDDEN|ACCESS_DENIED|PERMISSION_DENIED|REQUEST_ABORTED|PGRST30[12]|^42501$/i.test(String(error?.code || error?.payload?.code || error?.payload?.sqlState || ''));
}

export function isRecoverableSnapshotError(error) {
    return !inventoryRecoveryTerminalError(error)
        && (Object.values(inventoryRecoveryCodes).includes(error?.code)
            || inventoryRecoveryLegacyMessages.has(error?.message));
}

export function isCompleteMasterInventorySnapshot({ rows, state } = {}) {
    if (!Array.isArray(rows) || !rows.length || state?.initialLoaded !== true
        || state?.fullLoaded !== true || state?.rowCompleteness !== 'complete'
        || state?.fieldCoverage && state.fieldCoverage !== 'full') return false;
    const expectedRows = Number(state?.expectedRowCount);
    return !Number.isFinite(expectedRows) || expectedRows <= 0 || expectedRows === rows.length;
}

export function shouldRetainCompleteInventorySnapshot({
    currentRows, currentState, incomingRows, incomingCompleteness
} = {}) {
    if (incomingCompleteness === 'complete' || !Array.isArray(currentRows)
        || !Array.isArray(incomingRows) || incomingRows.length >= currentRows.length) return false;
    return isCompleteMasterInventorySnapshot({ rows: currentRows, state: currentState });
}

export async function ensureCompleteMasterInventorySnapshot({ getRows, getState, isCurrent, load } = {}) {
    if (![getRows, getState, isCurrent, load].every(value => typeof value === 'function')) {
        throw new TypeError('Complete inventory recovery requires row, state, lifecycle and loader callbacks.');
    }
    if (!isCurrent()) return false;
    if (isCompleteMasterInventorySnapshot({ rows: getRows(), state: getState() })) return true;
    const loaded = await load();
    if (!isCurrent()) return false;
    if (!loaded || !isCompleteMasterInventorySnapshot({ rows: getRows(), state: getState() })) {
        throw new Error('Complete inventory hydration did not finish.');
    }
    return true;
}

export async function fetchInventoryPreviewWithRetry({ fetchPage, isCurrent, isRetryable } = {}) {
    if (![fetchPage, isCurrent, isRetryable].every(value => typeof value === 'function')) {
        throw new TypeError('Inventory preview retry requires fetch, lifecycle and retry callbacks.');
    }
    try {
        return await fetchPage();
    } catch (error) {
        if (!isCurrent() || !isRetryable(error)) throw error;
        return fetchPage();
    }
}

export function selectAvailableInventoryPreviewAdapterIds({ progressive, view, adapters } = {}) {
    if (!progressive || !Array.isArray(adapters)) return undefined;
    const requested = view === 'docks' ? 'core:soc'
        : ['home', 'drive', 'av', 'tasks'].includes(view) ? 'core:master' : '';
    return requested && adapters.some(adapter => adapter?.id === requested) ? [requested] : undefined;
}

function inventoryRecoveryNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback;
}

function inventoryRecoveryOwner(context) {
    return JSON.stringify(['owner', 'scope', 'readIdentity', 'accountId', 'userId', 'loginEpoch', 'authEpoch', 'viewKey']
        .map(key => String(context?.[key] ?? '')));
}

function inventoryRecoveryContextActive(context) {
    return !!context && context.visible !== false && context.online !== false
        && context.authenticated !== false && context.accessDenied !== true
        && ['owner', 'scope', 'readIdentity', 'accountId', 'userId'].some(key => !!String(context[key] || ''));
}

function inventoryRecoveryLane(lane) {
    if (typeof lane !== 'string' || !lane.trim() || lane !== lane.trim() || lane.length > 80) {
        throw new RangeError('Inventory recovery lanes require a nonempty name of at most 80 characters.');
    }
    return lane;
}

function inventoryRecoveryIdle() {
    return { status: 'idle', attempt: 0, timer: null, running: false, owner: '', context: null, error: null };
}

function inventoryRecoveryClear(scheduler, lane) {
    const state = scheduler.lanes.get(lane);
    if (!state) return;
    if (state.timer !== null) scheduler.cancelTimer(state.timer);
    scheduler.lanes.delete(lane);
}

function inventoryRecoveryReset(scheduler, lane) {
    const lanes = lane === undefined ? [...scheduler.lanes.keys()] : [inventoryRecoveryLane(lane)];
    lanes.forEach(name => inventoryRecoveryClear(scheduler, name));
}

function inventoryRecoveryCanContinue(scheduler, lane, state) {
    if (scheduler.lanes.get(lane) !== state) return false;
    const currentContext = scheduler.options.getContext();
    return inventoryRecoveryContextActive(currentContext)
        && state.owner === inventoryRecoveryOwner(currentContext)
        && (!scheduler.options.shouldContinue || scheduler.options.shouldContinue(state.context, currentContext, lane));
}

function inventoryRecoveryAccepts(scheduler, error) {
    if (inventoryRecoveryTerminalError(error)) return false;
    return isRecoverableSnapshotError(error) || scheduler.options.isRecoverable?.(error) === true;
}

function inventoryRecoveryQueue(scheduler, lane, state, error) {
    state.error = error;
    if (!inventoryRecoveryAccepts(scheduler, error)) {
        state.status = 'stopped';
        return false;
    }
    if (state.attempt >= scheduler.maxAttempts) {
        state.status = 'exhausted';
        return false;
    }
    const delay = Math.min(scheduler.maxDelayMs, scheduler.baseDelayMs * 2 ** state.attempt);
    state.attempt += 1;
    state.status = 'scheduled';
    state.timer = scheduler.later(() => inventoryRecoveryRun(scheduler, lane, state), delay);
    return true;
}

function inventoryRecoveryComplete(scheduler, lane, state, result, error) {
    if (scheduler.lanes.get(lane) !== state) return;
    state.running = false;
    if (!inventoryRecoveryCanContinue(scheduler, lane, state)) {
        inventoryRecoveryClear(scheduler, lane);
        return;
    }
    if (!error && result !== false) {
        inventoryRecoveryClear(scheduler, lane);
        return;
    }
    inventoryRecoveryQueue(scheduler, lane, state, error || state.error);
}

async function inventoryRecoveryRun(scheduler, lane, state) {
    if (scheduler.lanes.get(lane) !== state) return;
    state.timer = null;
    if (!inventoryRecoveryCanContinue(scheduler, lane, state)) {
        inventoryRecoveryClear(scheduler, lane);
        return;
    }
    state.running = true;
    state.status = 'running';
    try {
        const result = await scheduler.options.retry({ lane, attempt: state.attempt, error: state.error, context: state.context });
        inventoryRecoveryComplete(scheduler, lane, state, result, null);
    } catch (error) {
        inventoryRecoveryComplete(scheduler, lane, state, false, error);
    }
}

function inventoryRecoverySchedule(scheduler, lane, error) {
    inventoryRecoveryLane(lane);
    const context = scheduler.options.getContext();
    if (!inventoryRecoveryContextActive(context) || !inventoryRecoveryAccepts(scheduler, error)) return false;
    let state = scheduler.lanes.get(lane) || inventoryRecoveryIdle();
    const owner = inventoryRecoveryOwner(context);
    if (state.owner && state.owner !== owner) {
        inventoryRecoveryClear(scheduler, lane);
        state = inventoryRecoveryIdle();
    }
    if (state.timer !== null || state.running) return false;
    if (!scheduler.lanes.has(lane) && scheduler.lanes.size >= 32) return false;
    scheduler.lanes.set(lane, state);
    state.context = Object.freeze({ ...context });
    state.owner = owner;
    if (!inventoryRecoveryCanContinue(scheduler, lane, state)) return false;
    return inventoryRecoveryQueue(scheduler, lane, state, error);
}

function inventoryRecoveryState(scheduler, lane) {
    const state = scheduler.lanes.get(inventoryRecoveryLane(lane)) || inventoryRecoveryIdle();
    return { status: state.status, attempt: state.attempt, maxAttempts: scheduler.maxAttempts,
        scheduled: state.timer !== null, running: state.running, owner: state.owner, error: state.error };
}

export function createRecoveryScheduler(options) {
    if (typeof options?.getContext !== 'function' || typeof options?.retry !== 'function') {
        throw new TypeError('Inventory recovery requires getContext and retry callbacks.');
    }
    const scheduler = { options, later: options.setTimeout || setTimeout, cancelTimer: options.clearTimeout || clearTimeout,
        maxAttempts: inventoryRecoveryNumber(options.maxAttempts, 4, 1, 8),
        baseDelayMs: inventoryRecoveryNumber(options.baseDelayMs, 1000, 1, 60000),
        maxDelayMs: inventoryRecoveryNumber(options.maxDelayMs, 30000, 1, 60000),
        lanes: new Map() };
    const reset = lane => inventoryRecoveryReset(scheduler, lane);
    return { schedule: (lane, error) => inventoryRecoverySchedule(scheduler, lane, error),
        success: reset, reset, cancel: reset, getState: lane => inventoryRecoveryState(scheduler, lane) };
}

function inventoryCoordinatorTransient(error) {
    if (inventoryRecoveryTerminalError(error)) return false;
    const status = Number(error?.status || error?.payload?.status);
    return [408, 409, 422, 423, 429].includes(status) || status >= 500 && status <= 599
        || error?.code === 'SUPABASE_READ_COOLDOWN'
        || /timed out|timeout|failed to fetch|network(?:error| request)?|connection (?:closed|reset|interrupted)/i.test(String(error?.message || ''));
}

function inventoryCoordinatorCancel(state) {
    state.epoch += 1;
    state.scheduler.cancel();
    state.waiters.forEach(waiter => waiter.resolve(false));
    state.waiters.clear();
    state.errors.clear();
    state.owner = '';
}

function inventoryCoordinatorContext(state) {
    const context = state.options.getContext();
    if (state.owner && (!inventoryRecoveryContextActive(context) || state.owner !== inventoryRecoveryOwner(context))) {
        inventoryCoordinatorCancel(state);
    }
    return context;
}

async function inventoryCoordinatorRead(state, lane, read) {
    const owner = inventoryRecoveryOwner(inventoryCoordinatorContext(state)), epoch = state.epoch;
    try { return await read(); }
    catch (error) {
        if (state.epoch === epoch && (lane === 'revision' || isRecoverableSnapshotError(error) || inventoryRecoveryTerminalError(error))) {
            state.errors.set(lane, { error, owner });
        }
        throw error;
    }
}

function inventoryCoordinatorAdapter(state, adapter, lane) {
    return { ...adapter, stage: (...args) => inventoryCoordinatorRead(state, lane, () => adapter.stage(...args)) };
}

function inventoryCoordinatorWrappedContext(state) {
    const context = inventoryCoordinatorContext(state);
    if (!context) return context;
    return { ...context,
        adapters: (context.adapters || []).map(adapter => inventoryCoordinatorAdapter(state, adapter, 'foreground')),
        backgroundAdapters: (context.backgroundAdapters || []).map(adapter => inventoryCoordinatorAdapter(state, adapter, 'background')) };
}

function inventoryCoordinatorSettle(state, lane, error = null) {
    const waiter = state.waiters.get(lane);
    if (!waiter) return;
    state.waiters.delete(lane);
    if (error) waiter.reject(error);
    else waiter.resolve(true);
}

function inventoryCoordinatorStatus(state, lane, status) {
    if (['Up to date', 'Published data'].includes(status.state)) {
        inventoryCoordinatorSettle(state, lane);
        state.scheduler.success(lane);
        state.errors.delete(lane);
        return;
    }
    const key = state.errors.has(lane) ? lane : 'revision';
    const record = state.errors.get(key);
    if (!record) return;
    state.errors.delete(key);
    if (record.owner !== inventoryRecoveryOwner(inventoryCoordinatorContext(state))) return;
    const allowed = isRecoverableSnapshotError(record.error) || lane === 'background' && key === 'revision' && inventoryCoordinatorTransient(record.error);
    if (!allowed) {
        state.scheduler.cancel(lane);
        inventoryCoordinatorSettle(state, lane);
        if (lane === 'foreground' && inventoryRecoveryTerminalError(record.error)) {
            state.scheduler.cancel('background');
            inventoryCoordinatorSettle(state, 'background');
        }
        return;
    }
    state.owner = record.owner;
    if (state.waiters.has(lane)) inventoryCoordinatorSettle(state, lane, record.error);
    else state.scheduler.schedule(lane, record.error);
}

function inventoryCoordinatorRetry(state, details) {
    return new Promise((resolve, reject) => {
        state.waiters.set(details.lane, { resolve, reject });
        state.coordinator.check('changed-during-load').catch(error => inventoryCoordinatorSettle(state, details.lane, error));
    });
}

function inventoryCoordinatorInvoke(state, method, args) {
    inventoryCoordinatorContext(state);
    const foregroundPending = ['scheduled', 'running'].includes(state.scheduler.getState('foreground').status);
    const backgroundPending = ['scheduled', 'running'].includes(state.scheduler.getState('background').status);
    if (foregroundPending || backgroundPending && method !== 'ensure') return method === 'signal' ? undefined : Promise.resolve(false);
    if (method === 'ensure') args = [inventoryCoordinatorAdapter(state, args[0], 'foreground'), ...args.slice(1)];
    return state.coordinator[method](...args);
}

function inventoryCoordinatorStop(state, method, args) {
    inventoryCoordinatorCancel(state);
    return state.coordinator[method](...args);
}

function inventoryCoordinatorDecorate(factory, options) {
    const state = { options, epoch: 0, owner: '', errors: new Map(), waiters: new Map(), coordinator: null, scheduler: null };
    state.scheduler = createRecoveryScheduler({ ...options.hydrationRecovery,
        getContext: () => inventoryCoordinatorContext(state),
        setTimeout: options.setTimeout, clearTimeout: options.clearTimeout,
        isRecoverable: inventoryCoordinatorTransient, retry: details => inventoryCoordinatorRetry(state, details) });
    state.coordinator = factory({ ...options, getContext: () => inventoryCoordinatorWrappedContext(state),
        readRevisions: (...args) => inventoryCoordinatorRead(state, 'revision', () => options.readRevisions(...args)),
        onStatus: status => { inventoryCoordinatorStatus(state, 'foreground', status); options.onStatus?.(status); },
        onBackgroundStatus: status => { inventoryCoordinatorStatus(state, 'background', status); options.onBackgroundStatus?.(status); } });
    return Object.freeze({ ...state.coordinator,
        check: (...args) => inventoryCoordinatorInvoke(state, 'check', args),
        signal: (...args) => inventoryCoordinatorInvoke(state, 'signal', args),
        ensure: (...args) => inventoryCoordinatorInvoke(state, 'ensure', args),
        reset: (...args) => inventoryCoordinatorStop(state, 'reset', args),
        suspend: (...args) => inventoryCoordinatorStop(state, 'suspend', args) });
}

export function installLiveSyncRecovery(root = globalThis) {
    const original = root.AgMetricLiveSync;
    if (!original?.createCoordinator || inventoryRecoveryDecorators.has(original)) return false;
    const decorated = Object.freeze({ ...original, createCoordinator: options => inventoryCoordinatorDecorate(original.createCoordinator, options) });
    inventoryRecoveryDecorators.add(decorated);
    root.AgMetricLiveSync = decorated;
    return true;
}

(function (root, api) {
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.GncInventoryHydrationRecovery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this,
    Object.freeze({ createSnapshotError, isRecoverableSnapshotError, isCompleteMasterInventorySnapshot,
        shouldRetainCompleteInventorySnapshot, ensureCompleteMasterInventorySnapshot, fetchInventoryPreviewWithRetry,
        selectAvailableInventoryPreviewAdapterIds, createRecoveryScheduler, installLiveSyncRecovery }));

installLiveSyncRecovery();
