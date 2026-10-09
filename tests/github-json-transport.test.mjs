import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeProductionRelease } from '../scripts/lib/production-release-guard.mjs';
import { fetchGitHubJson } from '../scripts/lib/github-json-transport.mjs';

const failure = code => new RegExp(`GITHUB_API_${code}`);
const response = (body, status = 200, headers = {}) => new Response(body, { status, headers });

function transport({ fetchImpl, delays = [], diagnostics = [] }) {
  return fetchGitHubJson({
    endpoint: 'repos/example/private/actions/runs?head_sha=private-sha&per_page=100',
    token: 'do-not-log-token',
    fetchImpl,
    sleepImpl: async delay => delays.push(delay),
    logger: detail => diagnostics.push(detail)
  });
}

test('a valid GitHub JSON body is returned without retry', async () => {
  let calls = 0;
  const delays = [];
  const value = await transport({ fetchImpl: async () => {
    calls++;
    return response('{"object":{"sha":"current"}}', 200, { 'content-type': 'application/json' });
  }, delays });
  assert.deepEqual(value, { object: { sha: 'current' } });
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test('a malformed successful response retries and then parses the valid response', async () => {
  let calls = 0;
  const delays = [];
  const diagnostics = [];
  const value = await transport({ fetchImpl: async () => {
    calls++;
    return calls === 1
      ? response('<html>temporary gateway response</html>', 200, {
        'content-type': 'text/html', 'x-github-request-id': 'A1B2:C3D4:E5F6'
      })
      : response('{"ok":true}', 200, { 'content-type': 'application/json' });
  }, delays, diagnostics });
  assert.deepEqual(value, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [200]);
  assert.deepEqual(diagnostics, [{
    event: 'retry',
    path: 'repos/example/private/actions/runs',
    attempt: 1,
    status: 200,
    contentType: 'text/html',
    bodyBytes: Buffer.byteLength('<html>temporary gateway response</html>'),
    requestId: 'A1B2:C3D4:E5F6',
    errorCode: 'RESPONSE_INVALID'
  }]);
  const diagnosticText = JSON.stringify(diagnostics);
  assert.doesNotMatch(diagnosticText, /private-sha|do-not-log-token|temporary gateway response|head_sha/);
});

test('malformed successful responses exhaust three attempts and retain the invalid-response code', async () => {
  let calls = 0;
  const delays = [];
  const diagnostics = [];
  await assert.rejects(transport({ fetchImpl: async () => {
    calls++;
    return response('', 200, { 'content-type': 'application/json' });
  }, delays, diagnostics }), failure('RESPONSE_INVALID'));
  assert.equal(calls, 3);
  assert.deepEqual(delays, [200, 500]);
  assert.equal(diagnostics.at(-1).event, 'failed');
  assert.equal(diagnostics.at(-1).attempt, 3);
  assert.equal(diagnostics.at(-1).bodyBytes, 0);
});

test('only explicitly retryable HTTP statuses retry; authentication and other client errors fail immediately', async () => {
  for (const status of [408, 429, 500, 502, 503, 599]) {
    let calls = 0;
    const delays = [];
    const value = await transport({ fetchImpl: async () => {
      calls++;
      return calls < 2 ? response('', status) : response('{"ok":true}');
    }, delays });
    assert.deepEqual(value, { ok: true }, `status ${status}`);
    assert.equal(calls, 2, `status ${status}`);
    assert.deepEqual(delays, [200], `status ${status}`);
  }
  for (const status of [400, 401, 403, 404]) {
    let calls = 0;
    const delays = [];
    await assert.rejects(transport({ fetchImpl: async () => {
      calls++;
      return response('', status);
    }, delays }), failure(`HTTP_${status}`));
    assert.equal(calls, 1, `status ${status} must fail immediately`);
    assert.deepEqual(delays, []);
  }
  let cancelled = 0;
  await assert.rejects(transport({ fetchImpl: async () => ({
    ok: false, status: 403, headers: new Headers(), body: { cancel: () => { cancelled++; return Promise.resolve(); } }
  }) }), failure('HTTP_403'));
  assert.equal(cancelled, 1, 'terminal HTTP response bodies are disposed without parsing or retrying');
});

test('retryable server errors exhaust three attempts without accepting an incomplete response', async () => {
  let calls = 0;
  const delays = [];
  await assert.rejects(transport({ fetchImpl: async () => {
    calls++;
    return response('', 503);
  }, delays }), failure('HTTP_503'));
  assert.equal(calls, 3);
  assert.deepEqual(delays, [200, 500]);
});

test('network errors and request/body timeouts retry within the same bound', async () => {
  const delays = [];
  let calls = 0;
  const value = await transport({ fetchImpl: async () => {
    calls++;
    if (calls === 1) throw new TypeError('network failure', { cause: { code: 'ECONNRESET' } });
    if (calls === 2) {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    }
    return response('{"ok":true}');
  }, delays });
  assert.deepEqual(value, { ok: true });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [200, 500]);

  const bodyDelays = [];
  let bodyCalls = 0;
  const bodyValue = await transport({ fetchImpl: async () => {
    bodyCalls++;
    if (bodyCalls === 1) return { ok: true, status: 200, headers: new Headers(), text: async () => {
      const error = new Error('timed out while reading body');
      error.name = 'TimeoutError';
      throw error;
    } };
    return response('{"body":"recovered"}');
  }, delays: bodyDelays });
  assert.deepEqual(bodyValue, { body: 'recovered' });
  assert.equal(bodyCalls, 2);
  assert.deepEqual(bodyDelays, [200]);

  let cancelled = 0;
  await assert.rejects(transport({ fetchImpl: async () => ({
    ok: true, status: 200, headers: new Headers(),
    body: { cancel: () => { cancelled++; return Promise.resolve(); } },
    text: async () => { throw new Error('nonretryable body failure'); }
  }) }), failure('RESPONSE_READ_FAILED'));
  assert.equal(cancelled, 1, 'a failed response read disposes the remaining body stream');
});

test('an actual request timeout uses the abort signal and remains bounded', async () => {
  let calls = 0;
  await assert.rejects(fetchGitHubJson({
    endpoint: 'repos/example/app/git/ref/heads/main',
    token: 'fixture-token',
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => {
      assert.ok(signal instanceof AbortSignal);
      calls++;
      return new Promise((_, reject) => signal.addEventListener('abort', () => {
        const error = new Error('request timeout');
        error.name = 'TimeoutError';
        reject(error);
      }, { once: true }));
    },
    sleepImpl: async () => {},
    logger: () => {}
  }), failure('TIMEOUT'));
  assert.equal(calls, 3);
});

test('an actual response-body timeout aborts and retries the response read', async () => {
  let calls = 0;
  const value = await fetchGitHubJson({
    endpoint: 'repos/example/app/git/ref/heads/main',
    token: 'fixture-token',
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      if (calls > 1) return response('{"object":{"sha":"recovered"}}');
      return {
        ok: true, status: 200, headers: new Headers(), body: { cancel: () => Promise.resolve() },
        text: () => new Promise((_, reject) => signal.addEventListener('abort', () => {
          const error = new Error('body timeout');
          error.name = 'TimeoutError';
          reject(error);
        }, { once: true }))
      };
    },
    sleepImpl: async () => {},
    logger: () => {}
  });
  assert.deepEqual(value, { object: { sha: 'recovered' } });
  assert.equal(calls, 2);
});

test('transport retries do not bypass exact-main and proof authorization checks', async () => {
  const requested = [];
  let mainCalls = 0;
  const api = endpoint => {
    requested.push(endpoint);
    return fetchGitHubJson({
      endpoint,
      token: 'fixture-token',
      fetchImpl: async () => {
        mainCalls++;
        return mainCalls === 1
          ? response('', 200, { 'content-type': 'application/json' })
          : response(JSON.stringify({ object: { sha: 'b'.repeat(40) } }), 200, { 'content-type': 'application/json' });
      },
      sleepImpl: async () => {},
      logger: () => {}
    });
  };
  await assert.rejects(authorizeProductionRelease({
    repository: 'example/app', eventName: 'push', ref: 'refs/heads/main',
    commit: 'a'.repeat(40), api
  }), /PRODUCTION_RELEASE_GUARD_COMMIT_NOT_CURRENT_MAIN/);
  assert.equal(mainCalls, 2);
  assert.deepEqual(requested, ['repos/example/app/git/ref/heads/main']);
});

