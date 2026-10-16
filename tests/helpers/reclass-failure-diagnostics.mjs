/** Install temporary Reclass setup diagnostics without changing request results. */
export async function captureReclassFailureDiagnostics(originalError, capture, fallback = {}) {
  const loadError = originalError instanceof Error
    ? `${originalError.name}: ${originalError.message}\n${originalError.stack || ''}`
    : String(originalError);
  try {
    return { loadError, diagnostics: await capture(), diagnosticCaptureError: '' };
  } catch (diagnosticError) {
    const diagnosticCaptureError = diagnosticError instanceof Error
      ? `${diagnosticError.name}: ${diagnosticError.message}\n${diagnosticError.stack || ''}`
      : String(diagnosticError);
    return { loadError, diagnostics: fallback, diagnosticCaptureError };
  }
}

export function installReclassFailureDiagnostics(target = globalThis) {
  const records = [];
  const contextSnapshots = [];
  const coordinatorEvents = [];
  const restore = [];
  const coordinatorProxies = new WeakMap();
  const safeError = error => ({
    name: String(error?.name || 'Error'),
    code: String(error?.code || ''),
    stack: String(error?.stack || '')
  });
  const describeRequest = (url, options = {}) => {
    const path = (() => {
      try { return new URL(String(url || ''), target.location?.href || 'http://localhost/').pathname; }
      catch (_) { return String(url || '').split('?')[0].slice(0, 180); }
    })();
    let body = options?.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = null; }
    }
    return {
      urlPath: path,
      method: String(options?.method || 'GET').toUpperCase(),
      action: typeof body?.action === 'string' ? body.action : '',
      operation: typeof body?.operation === 'string' ? body.operation : '',
      dataset: typeof body?.dataset === 'string' ? body.dataset : ''
    };
  };
  const wrap = (owner, key, wrapperFactory) => {
    if (!owner || typeof owner[key] !== 'function') return;
    const original = owner[key];
    owner[key] = wrapperFactory(original);
    restore.push(() => { owner[key] = original; });
  };
  const observe = (source, details, original, receiver, args) => {
    const recordError = error => records.push({ source, ...details, error: safeError(error) });
    let result;
    try { result = original.apply(receiver, args); }
    catch (error) { recordError(error); throw error; }
    if (result && typeof result.then === 'function') result.then(undefined, recordError);
    return result;
  };
  const wrapAdapter = adapter => {
    if (!adapter || adapter.__reclassDiagnosticWrapped) return adapter;
    const wrapped = { ...adapter, __reclassDiagnosticWrapped: true };
    for (const key of ['stage', 'commit']) {
      if (typeof adapter[key] !== 'function') continue;
      wrapped[key] = function () {
        return observe(`adapter.${key}`, { adapterId: String(adapter.id || ''), cacheKey: String(adapter.cacheKey || '') }, adapter[key], adapter, arguments);
      };
    }
    return wrapped;
  };

  wrap(target, 'fetchWithTimeout', original => function (url, options, timeoutMs, label) {
    return observe('fetchWithTimeout', { label: String(label || ''), request: describeRequest(url, options) }, original, this, arguments);
  });
  wrap(target, 'fetch', original => function (url, options) {
    return observe('window.fetch', { request: describeRequest(url, options) }, original, this, arguments);
  });
  if (target.GncLoginTrace && typeof target.GncLoginTrace.fetch === 'function') {
    wrap(target.GncLoginTrace, 'fetch', original => function (url, options) {
      return observe('GncLoginTrace.fetch', { request: describeRequest(url, options) }, original, this, arguments);
    });
  }
  wrap(target, 'getProductionLiveSyncContext', original => function () {
    const context = original.apply(this, arguments);
    if (context && contextSnapshots.length < 12) contextSnapshots.push({
      view: String(context.view || ''), viewKey: String(context.viewKey || ''), visible: context.visible === true,
      adapters: (Array.isArray(context.adapters) ? context.adapters : []).map(adapter => ({
        id: String(adapter?.id || ''), cacheKey: String(adapter?.cacheKey || ''),
        sourceKeys: Array.isArray(adapter?.sourceKeys) ? adapter.sourceKeys.map(String) : []
      }))
    });
    if (!context || !Array.isArray(context.adapters)) return context;
    return { ...context, adapters: context.adapters.map(wrapAdapter) };
  });
  wrap(target, 'createProductionCoreLiveAdapter', original => function () {
    return wrapAdapter(original.apply(this, arguments));
  });
  if (target.AgMetricLiveSync && typeof target.AgMetricLiveSync.createCoordinator === 'function') {
    wrap(target.AgMetricLiveSync, 'createCoordinator', original => function (options = {}) {
      const wrapCallback = (name, callback) => typeof callback === 'function' ? function () {
        const arg = arguments[1] || arguments[0] || {};
        let metadata = {};
        try { metadata = JSON.parse(JSON.stringify(arg)); } catch (_) {}
        const result = observe(name, {}, callback, this, arguments);
        if (name === 'onStageStart' || name === 'onStatus') coordinatorEvents.push({ source: name, metadata });
        return result;
      } : callback;
      const instrumented = { ...options };
      for (const key of ['onStageStart', 'onStatus', 'commitSnapshots', 'readRevisions']) {
        if (typeof options[key] !== 'function') continue;
        const callback = options[key];
        instrumented[key] = function () {
          let context = {};
          try { context = JSON.parse(JSON.stringify(arguments[1] || {})); } catch (_) {}
          return observe(key, { context }, callback, this, arguments);
        };
        if (key === 'onStageStart' || key === 'onStatus') instrumented[key] = wrapCallback(key, callback);
      }
      return original.call(this, instrumented);
    });
  }
  wrap(target, 'getProductionLiveSyncCoordinator', original => function () {
    const coordinator = original.apply(this, arguments);
    if (!coordinator || typeof coordinator !== 'object') return coordinator;
    if (coordinatorProxies.has(coordinator)) return coordinatorProxies.get(coordinator);
    // The production coordinator is frozen. Copy its public API, wrapping only
    // at this test boundary while forwarding each exact result/Promise.
    const wrapped = { ...coordinator };
    for (const key of ['ensure', 'check']) {
      const originalMethod = coordinator[key];
      if (typeof originalMethod !== 'function') continue;
      wrapped[key] = function () {
        const adapter = key === 'ensure' ? arguments[0] : null;
        const event = { source: `coordinator.${key}`, adapterId: String(adapter?.id || ''), cacheKey: String(adapter?.cacheKey || ''), force: arguments[1] === true };
        const result = observe(event.source, event, originalMethod, coordinator, arguments);
        const complete = outcome => {
          try { coordinatorEvents.push({ ...event, result: outcome, status: coordinator.getStatus?.(), statistics: coordinator.getStatistics?.() }); } catch (_) {}
          return outcome;
        };
        if (result && typeof result.then === 'function') result.then(complete, () => {});
        else complete(result);
        return result;
      };
    }
    coordinatorProxies.set(coordinator, wrapped);
    return wrapped;
  });

  let restored = false;
  return {
    records,
    contextSnapshots,
    coordinatorEvents,
    restore() {
      if (restored) return;
      restored = true;
      for (const undo of restore.reverse()) undo();
    }
  };
}
