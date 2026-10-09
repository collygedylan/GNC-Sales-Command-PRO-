/**
 * Installs transparent, test-only observation around AgMetricLiveSync.
 * The injected timer functions keep their original handles, delays and callback
 * ordering; only a read-only activity snapshot is added to the supplied root.
 */
export function installPerformanceCoordinatorObserver(root = globalThis) {
  const observerKey = '__phase6CoordinatorObserver';
  if (root[observerKey]) return root[observerKey];

  const coordinators = new Set();
  const observedApis = new WeakSet();
  const now = () => Number(root.Date?.now?.() ?? Date.now());
  const observer = Object.freeze({
    getPendingActivity() {
      const pendingTimers = [];
      let activeRevisionReads = 0;
      let activeChecks = 0;
      let foregroundStatus = null;
      let backgroundStatus = null;
      let persistentPollTimers = 0;
      let nextPersistentPollInMs = null;
      for (const state of coordinators) {
        for (const timer of state.timers.values()) {
          if (timer.kind === 'poll') {
            persistentPollTimers++;
            const dueInMs = Math.max(0, timer.dueAt - now());
            nextPersistentPollInMs = nextPersistentPollInMs === null ? dueInMs : Math.min(nextPersistentPollInMs, dueInMs);
          }
          else pendingTimers.push({ kind: timer.kind, delayMs: timer.delayMs });
        }
        activeRevisionReads += state.activeRevisionReads;
        activeChecks += state.activeChecks;
        foregroundStatus = state.foregroundStatus || foregroundStatus;
        backgroundStatus = state.backgroundStatus || backgroundStatus;
      }
      const foregroundActive = coordinators.size > 0 && Array.from(coordinators).some(state => state.foregroundActive);
      const backgroundActive = coordinators.size > 0 && Array.from(coordinators).some(state => state.backgroundActive);
      return Object.freeze({
        pending: coordinators.size === 0 || pendingTimers.length > 0 || activeRevisionReads > 0 || activeChecks > 0 || foregroundActive || backgroundActive,
        pendingTimers: Object.freeze(pendingTimers),
        activeRevisionReads,
        activeChecks,
        foregroundActive,
        backgroundActive,
        foregroundStatus,
        backgroundStatus,
        persistentPollTimers,
        nextPersistentPollInMs
      });
    }
  });
  Object.defineProperty(root, observerKey, { configurable: false, enumerable: false, value: observer });

  const wrapApi = api => {
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
        const originalSetTimeout = options.setTimeout || root.setTimeout.bind(root);
        const originalClearTimeout = options.clearTimeout || root.clearTimeout.bind(root);
        const wrappedOptions = {
          ...options,
          setTimeout(callback, delay, ...args) {
            const delayMs = Number(delay) || 0;
            const source = Function.prototype.toString.call(callback);
            const isPoll = delayMs === 30000 && source.includes('foreground-safeguard');
            const kind = isPoll ? 'poll' : source.includes('background: true') || source.includes('background:!0')
              ? 'background' : source.includes('check(reason)') ? 'signal' : 'other';
            let handle;
            const observedCallback = function (...callbackArgs) {
              state.timers.delete(handle);
              return callback.apply(this, callbackArgs);
            };
            handle = originalSetTimeout.call(this, observedCallback, delay, ...args);
            state.timers.set(handle, { kind, delayMs, dueAt: now() + delayMs });
            return handle;
          },
          clearTimeout(handle) {
            state.timers.delete(handle);
            return originalClearTimeout.call(this, handle);
          },
          readRevisions(...args) {
            state.activeRevisionReads++;
            let result;
            try { result = options.readRevisions(...args); }
            catch (error) { state.activeRevisionReads--; throw error; }
            const finish = () => { state.activeRevisionReads--; };
            Promise.resolve(result).then(finish, finish);
            return result;
          },
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
        const coordinator = originalCreate.call(this, wrappedOptions);
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
    });
    observedApis.add(wrappedApi);
    return wrappedApi;
  };

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
