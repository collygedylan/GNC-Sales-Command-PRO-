export async function readCompletePerformanceResponseBody(response, requestOutcome) {
  if (!response || typeof response.finished !== 'function' || typeof response.body !== 'function') {
    throw new Error('PERFORMANCE_RESPONSE_CAPTURE_INVALID');
  }
  const outcome = requestOutcome ? await requestOutcome : { type: 'finished', error: await response.finished() };
  if (outcome?.type === 'failed') {
    throw new Error(`PERFORMANCE_RESPONSE_REQUEST_FAILED:${outcome.errorText || 'request failed'}`);
  }
  if (outcome?.type !== 'finished') throw new Error('PERFORMANCE_RESPONSE_OUTCOME_INVALID');
  if (outcome.error) throw new Error(`PERFORMANCE_RESPONSE_NOT_FINISHED:${outcome.error.message || outcome.error}`);
  const body = await response.body();
  if (!(body instanceof Uint8Array)) throw new Error('PERFORMANCE_RESPONSE_BODY_INVALID');
  return body;
}

const PERFORMANCE_HEALTH_EVENT_AREAS = Object.freeze({
  dataset_load: 'data_sync',
  view_data_ready: 'rendering',
  view_render: 'rendering',
  view_switch: 'navigation',
});
const SAFE_PERFORMANCE_REASON = /^[a-z][a-z0-9_-]{0,63}(?::[a-z][a-z0-9_-]{0,31})?$/;

function safeHealthEventDetails(request, operation, path) {
  if (request.method() !== 'POST' || path !== '/rest/v1/rpc/report_app_health_event'
      || operation !== 'rpc:report_app_health_event') return null;
  try {
    const body = request.postDataJSON();
    const eventName = body?.event_name;
    const area = body?.area;
    const reason = body?.metadata?.reason;
    if (typeof eventName !== 'string' || !Object.hasOwn(PERFORMANCE_HEALTH_EVENT_AREAS, eventName)
        || area !== PERFORMANCE_HEALTH_EVENT_AREAS[eventName]
        || typeof reason !== 'string' || reason.length > 96 || !SAFE_PERFORMANCE_REASON.test(reason)) return null;
    return { eventName, area, reason };
  } catch { return null; }
}

function safeApiRequestDetails(request) {
  const url = new URL(request.url());
  const path = url.pathname;
  const rpc = path.match(/\/rpc\/([^/]+)$/);
  let operation = rpc ? `rpc:${decodeURIComponent(rpc[1])}` : null;
  if (path === '/functions/v1/app-api') {
    try {
      const body = request.postDataJSON();
      if (typeof body?.action === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(body.action)) {
        operation = `action:${body.action}`;
        if (typeof body.dataset === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(body.dataset)) operation += `;dataset:${body.dataset}`;
      }
    } catch { /* Opaque or malformed bodies stay undisclosed in diagnostics. */ }
  }
  const details = { method: request.method(), path, operation };
  const healthEvent = safeHealthEventDetails(request, operation, path);
  if (healthEvent) details.healthEvent = healthEvent;
  return details;
}

export function safePerformanceApiDiagnostic(request) {
  if (!request || typeof request.method !== 'string' || typeof request.path !== 'string'
    || !(request.operation === null || typeof request.operation === 'string')
    || typeof request.bytes !== 'number' || typeof request.canceled !== 'boolean') {
    throw new Error('PERFORMANCE_API_DIAGNOSTIC_INVALID');
  }
  const diagnostic = { method: request.method, path: request.path, operation: request.operation,
    bytes: request.bytes, canceled: request.canceled, failed: Boolean(request.error) };
  if (request.healthEvent !== undefined) {
    const event = request.healthEvent;
    if (request.method !== 'POST' || request.path !== '/rest/v1/rpc/report_app_health_event'
        || request.operation !== 'rpc:report_app_health_event'
        || !event || !Object.hasOwn(PERFORMANCE_HEALTH_EVENT_AREAS, event.eventName)
        || event.area !== PERFORMANCE_HEALTH_EVENT_AREAS[event.eventName]
        || typeof event.reason !== 'string' || event.reason.length > 96 || !SAFE_PERFORMANCE_REASON.test(event.reason)) {
      throw new Error('PERFORMANCE_API_DIAGNOSTIC_INVALID');
    }
    diagnostic.healthEvent = { eventName: event.eventName, area: event.area, reason: event.reason };
  }
  return diagnostic;
}

export function attachPerformanceResponseTracker(page, totals) {
  if (!page || typeof page.on !== 'function' || !totals || !Array.isArray(totals.apiRequests)
    || !Array.isArray(totals.pending) || !Array.isArray(totals.errors)) {
    throw new Error('PERFORMANCE_RESPONSE_TRACKER_OPTIONS_INVALID');
  }
  const requestOutcomes = new WeakMap();
  const requestOutcomeResolvers = new WeakMap();
  const requestRecords = new WeakMap();
  page.on('request', request => {
    let resolveOutcome;
    const outcome = new Promise(resolve => { resolveOutcome = resolve; });
    requestOutcomes.set(request, outcome);
    requestOutcomeResolvers.set(request, resolveOutcome);
    if (request.method() === 'OPTIONS' || !/\/(?:rest|functions)\/v1\//.test(request.url())) return;
    const record = { index: totals.apiRequests.length, ...safeApiRequestDetails(request), request, outcome, resolveOutcome, response: null,
      bytes: 0, canceled: false, error: null, capturePromise: null };
    requestRecords.set(request, record);
    totals.apiRequests.push(record);
  });
  page.on('requestfinished', request => requestOutcomeResolvers.get(request)?.({ type: 'finished' }));
  page.on('requestfailed', request => {
    const errorText = request.failure()?.errorText || 'request failed before a response';
    const record = requestRecords.get(request);
    if (record) {
      if (errorText === 'net::ERR_ABORTED') record.canceled = true;
      else record.error = `${new URL(request.url()).pathname}: ${errorText}`;
    }
    requestOutcomeResolvers.get(request)?.({ type: 'failed', errorText });
  });
  page.on('response', response => {
    const request = response.request();
    if (request.method() === 'OPTIONS') return;
    const api = /\/(?:rest|functions)\/v1\//.test(response.url());
    if (!api && request.resourceType() !== 'script') return;
    if (api) {
      const record = requestRecords.get(request);
      if (!record) {
        totals.errors.push(`${new URL(response.url()).pathname}: API response has no request record`);
        return;
      }
      record.response = response;
      if (response.status() >= 400) {
        record.error = `${new URL(response.url()).pathname}: HTTP ${response.status()}`;
        return;
      }
      record.capturePromise = readCompletePerformanceResponseBody(response, requestOutcomes.get(request)).then(body => {
        record.bytes = body.length;
      }).catch(error => {
        if (!record.canceled) record.error = `${new URL(response.url()).pathname} (HTTP ${response.status()}): ${error.message}`;
      });
      return;
    }
    const pending = readCompletePerformanceResponseBody(response, requestOutcomes.get(request)).then(body => {
      totals.scriptBytes += body.length;
    }).catch(error => {
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
        totals.errors.push(`${new URL(response.url()).pathname} (HTTP ${response.status()}): ${error.message}`);
      }
    });
    totals.pending.push(pending);
  });
  return totals;
}

export async function drainPerformanceResponseBodies(totals, { maxBatches = 8, timeoutMs = 15_000 } = {}) {
  if (!totals || !Array.isArray(totals.pending) || !Array.isArray(totals.errors)
    || !Number.isInteger(maxBatches) || maxBatches < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('PERFORMANCE_RESPONSE_DRAIN_OPTIONS_INVALID');
  }

  const deadline = Date.now() + timeoutMs;
  let batches = 0;
  while (totals.pending.length) {
    if (++batches > maxBatches) throw new Error('PERFORMANCE_RESPONSE_DRAIN_LIMIT');
    const batch = totals.pending.splice(0);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('PERFORMANCE_RESPONSE_DRAIN_TIMEOUT');
    let timeout;
    try {
      await Promise.race([
        Promise.all(batch),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('PERFORMANCE_RESPONSE_DRAIN_TIMEOUT')), remainingMs);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function drainPerformanceApiRequests(totals, { startIndex = 0, endIndex, timeoutMs = 15_000 } = {}) {
  if (!totals || !Array.isArray(totals.apiRequests)
    || !Number.isInteger(startIndex) || startIndex < 0
    || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('PERFORMANCE_API_DRAIN_OPTIONS_INVALID');
  }
  const end = endIndex ?? totals.apiRequests.length;
  if (!Number.isInteger(end) || end < startIndex || end > totals.apiRequests.length) {
    throw new Error('PERFORMANCE_API_DRAIN_RANGE_INVALID');
  }
  const requests = totals.apiRequests.slice(startIndex, end);
  const settled = Promise.all(requests.map(async request => {
    if (!request || !request.outcome || typeof request.outcome.then !== 'function') {
      throw new Error('PERFORMANCE_API_REQUEST_RECORD_INVALID');
    }
    const outcome = await request.outcome;
    if (request.capturePromise) await request.capturePromise;
    if (request.canceled && outcome?.type === 'failed') return;
    if (request.error) throw new Error(`PERFORMANCE_API_REQUEST_FAILED:${request.error}`);
    if (outcome?.type !== 'finished' || !request.response || !request.capturePromise) {
      throw new Error('PERFORMANCE_API_RESPONSE_MISSING');
    }
  }));
  let timeout;
  try {
    await Promise.race([
      settled,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('PERFORMANCE_API_DRAIN_TIMEOUT')), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function settlePerformanceApiBoundary(totals, fixtureControl, { maxBatches = 4, timeoutMs = 15_000 } = {}) {
  if (!totals || !Array.isArray(totals.apiRequests) || !Array.isArray(totals.pending) || !Array.isArray(totals.errors)
    || (fixtureControl != null && typeof fixtureControl.waitForApiIdle !== 'function')
    || !Number.isInteger(maxBatches) || maxBatches < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('PERFORMANCE_API_BOUNDARY_OPTIONS_INVALID');
  }
  const deadline = Date.now() + timeoutMs;
  for (let batch = 0; batch < maxBatches; batch++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('PERFORMANCE_API_BOUNDARY_TIMEOUT');
    if (fixtureControl) {
      let timer;
      try {
        await Promise.race([
          fixtureControl.waitForApiIdle({ timeoutMs: remainingMs }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PERFORMANCE_API_BOUNDARY_TIMEOUT')), remainingMs); })
        ]);
      } finally { clearTimeout(timer); }
    }
    const endIndex = totals.apiRequests.length;
    await drainPerformanceApiRequests(totals, { startIndex: 0, endIndex, timeoutMs: Math.max(1, deadline - Date.now()) });
    await drainPerformanceResponseBodies(totals, { timeoutMs: Math.max(1, deadline - Date.now()) });
    if (totals.apiRequests.length === endIndex) return endIndex;
  }
  throw new Error('PERFORMANCE_API_BOUNDARY_UNSTABLE');
}
