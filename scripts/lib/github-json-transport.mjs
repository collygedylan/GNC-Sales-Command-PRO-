const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [200, 500];
const RETRYABLE_HTTP = new Set([408, 429]);
const NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EAI_AGAIN',
  'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'ERR_SOCKET_CLOSED'
]);

export class GitHubJsonTransportError extends Error {
  constructor(code) {
    super(`GITHUB_API_${code}`);
    this.name = 'GitHubJsonTransportError';
    this.code = code;
  }
}

function endpointPath(endpoint) {
  const value = String(endpoint || '').split(/[?#]/, 1)[0];
  return value.replace(/[^a-zA-Z0-9/_.,:@%+~-]/g, '_').slice(0, 240) || '/';
}

function safeHeader(value, maxLength = 96) {
  const normalized = String(value || '').trim();
  return /^[\x20-\x7e]*$/.test(normalized) ? normalized.slice(0, maxLength) : '';
}

function responseMetadata(response, endpoint, attempt, bodyBytes = null) {
  return {
    path: endpointPath(endpoint),
    attempt,
    status: Number.isInteger(response?.status) ? response.status : null,
    contentType: safeHeader(response?.headers?.get?.('content-type')) || null,
    bodyBytes: Number.isSafeInteger(bodyBytes) && bodyBytes >= 0 ? bodyBytes : null,
    requestId: safeHeader(response?.headers?.get?.('x-github-request-id'), 128) || null
  };
}

function isRetryableNetworkError(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return true;
  return error?.name === 'TypeError'
    && NETWORK_CODES.has(String(error?.cause?.code || error?.code || '').toUpperCase());
}

function retryableStatus(status) {
  return RETRYABLE_HTTP.has(status) || (status >= 500 && status <= 599);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function discardResponseBody(response) {
  try {
    const cancellation = response?.body?.cancel?.();
    cancellation?.catch?.(() => {});
  } catch {
    // Body cleanup must not change the guarded API result.
  }
}

function logDiagnostic(logger, event, metadata, errorCode) {
  try {
    logger?.({ event, ...metadata, ...(errorCode ? { errorCode } : {}) });
  } catch {
    // Diagnostics must not change transport or authorization behavior.
  }
}

/** Fetch and parse one GitHub REST JSON response with bounded, fail-closed retries. */
export async function fetchGitHubJson({
  endpoint,
  token,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  timeoutMs = 12_000,
  logger = detail => console.warn(`GITHUB_API_TRANSPORT ${JSON.stringify(detail)}`)
}) {
  if (typeof endpoint !== 'string' || !endpoint.trim() || typeof fetchImpl !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new GitHubJsonTransportError('REQUEST_INVALID');
  }
  const bearer = String(token || '').trim();
  if (!bearer) throw new GitHubJsonTransportError('TOKEN_MISSING');

  const url = `https://api.github.com/${endpoint}`;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${bearer}`,
          'x-github-api-version': '2022-11-28'
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      if (!isRetryableNetworkError(error)) throw new GitHubJsonTransportError('NETWORK_FAILED');
      const code = timedOut ? 'TIMEOUT' : 'NETWORK_FAILED';
      const metadata = responseMetadata(null, endpoint, attempt);
      if (attempt === MAX_ATTEMPTS) {
        logDiagnostic(logger, 'failed', metadata, code);
        throw new GitHubJsonTransportError(code);
      }
      logDiagnostic(logger, 'retry', metadata, code);
      await sleepImpl(RETRY_DELAYS_MS[attempt - 1]);
      continue;
    }

    if (!response?.ok) {
      const status = Number(response?.status) || 0;
      const metadata = responseMetadata(response, endpoint, attempt);
      discardResponseBody(response);
      if (status === 401 || status === 403 || !retryableStatus(status)) {
        logDiagnostic(logger, 'failed', metadata, `HTTP_${status || 'INVALID'}`);
        throw new GitHubJsonTransportError(`HTTP_${status || 'INVALID'}`);
      }
      if (attempt === MAX_ATTEMPTS) {
        logDiagnostic(logger, 'failed', metadata, `HTTP_${status}`);
        throw new GitHubJsonTransportError(`HTTP_${status}`);
      }
      logDiagnostic(logger, 'retry', metadata, `HTTP_${status}`);
      await sleepImpl(RETRY_DELAYS_MS[attempt - 1]);
      continue;
    }

    let body;
    try {
      body = await response.text();
    } catch (error) {
      discardResponseBody(response);
      const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError';
      if (!isRetryableNetworkError(error)) throw new GitHubJsonTransportError('RESPONSE_READ_FAILED');
      const code = timedOut ? 'TIMEOUT' : 'NETWORK_FAILED';
      const metadata = responseMetadata(response, endpoint, attempt);
      if (attempt === MAX_ATTEMPTS) {
        logDiagnostic(logger, 'failed', metadata, code);
        throw new GitHubJsonTransportError(code);
      }
      logDiagnostic(logger, 'retry', metadata, code);
      await sleepImpl(RETRY_DELAYS_MS[attempt - 1]);
      continue;
    }
    const bodyBytes = Buffer.byteLength(body, 'utf8');
    try {
      return JSON.parse(body);
    } catch {
      const metadata = responseMetadata(response, endpoint, attempt, bodyBytes);
      if (attempt === MAX_ATTEMPTS) {
        logDiagnostic(logger, 'failed', metadata, 'RESPONSE_INVALID');
        throw new GitHubJsonTransportError('RESPONSE_INVALID');
      }
      logDiagnostic(logger, 'retry', metadata, 'RESPONSE_INVALID');
      await sleepImpl(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
  throw new GitHubJsonTransportError('RESPONSE_INVALID');
}
