export const APP_API_READINESS_REQUEST = Object.freeze({
  method: 'POST',
  body: JSON.stringify({ action: '__performance_readiness_probe__' }),
});

/** A status code alone can be returned by Kong or a stale listener. */
export async function isAppApiReadyResponse(response, requestId) {
  if (!response || response.status !== 400 || typeof requestId !== 'string') {
    try { await response?.arrayBuffer?.(); } catch { /* drain best-effort on rejected responses */ }
    return false;
  }
  try {
    const body = await response.json();
    return body !== null && typeof body === 'object' && !Array.isArray(body)
      && body.error === 'Unsupported action.'
      && response.headers?.get('x-request-id') === requestId;
  } catch {
    return false;
  }
}

/** Match an emitted request log from this child process, not a listener on the port. */
export function appApiReadinessLogSeen(logText, requestId) {
  if (typeof logText !== 'string' || typeof requestId !== 'string') return false;
  return logText.split(/\r?\n/).some(line => {
    const start = line.indexOf('{');
    if (start < 0) return false;
    try {
      const entry = JSON.parse(line.slice(start));
      return entry?.request_id === requestId && entry?.function === 'app-api'
        && entry?.action === '__performance_readiness_probe__' && entry?.status === 400;
    } catch { return false; }
  });
}

export function appApiReadinessRequest(apiKey, requestId) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('PERFORMANCE_READINESS_API_KEY_REQUIRED');
  if (typeof requestId !== 'string' || !/^perf-ready-[a-f0-9]{32}$/.test(requestId)) {
    throw new Error('PERFORMANCE_READINESS_REQUEST_ID_INVALID');
  }
  return {
    ...APP_API_READINESS_REQUEST,
    headers: { apikey: apiKey, 'content-type': 'application/json', 'x-request-id': requestId },
  };
}
