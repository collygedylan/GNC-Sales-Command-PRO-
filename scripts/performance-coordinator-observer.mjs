function observedTimer(state, now, originalSetTimeout, callback, delay, args) {
  const delayMs = Number(delay) || 0;
  const source = Function.prototype.toString.call(callback);
  const kind = source.includes('foreground-safeguard') ? 'poll'
    : source.includes('background: true') || source.includes('background:!0') ? 'background'
    : source.includes('check(reason)') ? 'signal' : 'other';
  let handle;
  const observedCallback = function (...callbackArgs) {
    state.timers.delete(handle);
    return callback.apply(this, callbackArgs);
  };
  handle = originalSetTimeout(observedCallback, delay, ...args);
  state.timers.set(handle, { kind, delayMs, dueAt: now() + delayMs });
  return handle;
}

function observedRevision(options, state, args) {
  state.activeRevisionReads++;
  let result;
  try { result = options.readRevisions(...args); }
  catch (error) { state.activeRevisionReads--; throw error; }
  const finish = () => { state.activeRevisionReads--; };
  Promise.resolve(result).then(finish, finish);
  return result;
}

function observerOptions(root, options, state, now) {
  const originalSetTimeout = options.setTimeout || root.setTimeout.bind(root);
  const originalClearTimeout = options.clearTimeout || root.clearTimeout.bind(root);
  return {
    ...options,
    setTimeout(callback, delay, ...args) {
      return observedTimer(state, now, originalSetTimeout.bind(this), callback, delay, args);
    },
    clearTimeout(handle) {
      state.timers.delete(handle);
      return originalClearTimeout.call(this, handle);
    },
    readRevisions(...args) { return observedRevision(options, state, args); },
    onStatus(value) {
      state.foregroundStatus = value;
      state.foregroundActive = value?.state === 'Syncing' && !String(value?.message || '').startsWith('Waiting to verify');
      return options.onStatus?.(value);
    },
    onBackgroundStatus(value) {
      state.backgroundStatus = value;
      state.backgroundActive = value?.state === 'Syncing';
      return options.onBackgroundStatus?.(value);
    }
  };
}

function observerCoordinator(coordinator, state) {
        const wrapPromiseMethod = method => {
          if (typeof coordinator[method] !== 'function') return coordinator[method];
          return (...args) => {
            state.activeChecks++;
            let result;
            try { result = coordinator[method](...args); }
            catch (error) { state.activeChecks--; throw error; }
            const finish = () => { state.activeChecks--; };
            Promise.resolve(result).then(finish, finish);
            return result;
          };
        };
        const observedCoordinator = {};
        for (const [method, value] of Object.entries(coordinator)) {
          observedCoordinator[method] = method === 'check' || method === 'ensure'
            ? wrapPromiseMethod(method)
            : typeof value === 'function' ? value.bind(coordinator) : value;
        }
        return Object.freeze(observedCoordinator);
}

function recordObserverTimers(state, now, snapshot) {
  for (const timer of state.timers.values()) {
    if (timer.kind !== 'poll') {
      snapshot.pendingTimers.push({ kind: timer.kind, delayMs: timer.delayMs });
      continue;
    }
    snapshot.persistentPollTimers++;
    const dueInMs = Math.max(0, timer.dueAt - now());
    snapshot.nextPersistentPollInMs = snapshot.nextPersistentPollInMs === null
      ? dueInMs : Math.min(snapshot.nextPersistentPollInMs, dueInMs);
  }
}

function observerActivity(coordinators, now) {
  const snapshot = { pendingTimers: [], activeRevisionReads: 0, activeChecks: 0,
    foregroundStatus: null, backgroundStatus: null, persistentPollTimers: 0, nextPersistentPollInMs: null };
  for (const state of coordinators) {
    recordObserverTimers(state, now, snapshot);
    snapshot.activeRevisionReads += state.activeRevisionReads;
    snapshot.activeChecks += state.activeChecks;
    snapshot.foregroundStatus = state.foregroundStatus || snapshot.foregroundStatus;
    snapshot.backgroundStatus = state.backgroundStatus || snapshot.backgroundStatus;
  }
  const foregroundActive = coordinators.size > 0 && Array.from(coordinators).some(state => state.foregroundActive);
  const backgroundActive = coordinators.size > 0 && Array.from(coordinators).some(state => state.backgroundActive);
  const pending = coordinators.size === 0 || snapshot.pendingTimers.length > 0 || snapshot.activeRevisionReads > 0
    || snapshot.activeChecks > 0 || foregroundActive || backgroundActive;
  return Object.freeze({ ...snapshot, pendingTimers: Object.freeze(snapshot.pendingTimers), pending, foregroundActive, backgroundActive });
}

function observerSnapshot(coordinators, now) {
  return Object.freeze({ getPendingActivity: () => observerActivity(coordinators, now) });
}

function observerWrapApi(api, root, coordinators, observedApis, now) {
    if (!api || typeof api.createCoordinator !== 'function' || observedApis.has(api)) return api;
    const originalCreate = api.createCoordinator;
    const wrappedApi = Object.freeze({
      ...api,
      createCoordinator(options = {}) {
        const state = {
          timers: new Map(), activeRevisionReads: 0, activeChecks: 0,
          foregroundStatus: null, backgroundStatus: null,
          foregroundActive: false, backgroundActive: false
        };
        coordinators.add(state);
        const wrappedOptions = observerOptions(root, options, state, now);
        const coordinator = originalCreate.call(this, wrappedOptions);
        return observerCoordinator(coordinator, state);
      }
    });
    observedApis.add(wrappedApi);
    return wrappedApi;
  }

export function installPerformanceCoordinatorObserver(root = globalThis) {
  const observerKey = '__phase6CoordinatorObserver';
  if (root[observerKey]) return root[observerKey];
  const coordinators = new Set();
  const observedApis = new WeakSet();
  const now = () => Number(root.Date?.now?.() ?? Date.now());
  const observer = observerSnapshot(coordinators, now);
  Object.defineProperty(root, observerKey, { configurable: false, enumerable: false, value: observer });
  const wrapApi = api => observerWrapApi(api, root, coordinators, observedApis, now);



  const descriptor = Object.getOwnPropertyDescriptor(root, 'AgMetricLiveSync');
  if (descriptor && 'value' in descriptor) {
    Object.defineProperty(root, 'AgMetricLiveSync', { configurable: true, enumerable: descriptor.enumerable, writable: true, value: wrapApi(descriptor.value) });
  } else {
    let current = descriptor?.get ? descriptor.get.call(root) : undefined;
    Object.defineProperty(root, 'AgMetricLiveSync', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return current; },
      set(value) { current = wrapApi(value); }
    });
  }
  return observer;
}


const observerFunctions = [observedTimer, observedRevision, observerOptions, observerCoordinator,
  recordObserverTimers, observerActivity, observerSnapshot, observerWrapApi, installPerformanceCoordinatorObserver];

export function performanceCoordinatorObserverScript() {
  const definitions = observerFunctions.map(fn => Function.prototype.toString.call(fn)).join('\n');
  return `(() => { ${definitions}; return installPerformanceCoordinatorObserver(globalThis); })()`;
}

