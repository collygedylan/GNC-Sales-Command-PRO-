import test from 'node:test';
import assert from 'node:assert/strict';
import { appApiReadinessLogSeen, appApiReadinessRequest, isAppApiReadyResponse } from '../scripts/performance-function-readiness.mjs';

test('readiness sends a harmless keyed probe and no bearer token', () => {
  const requestId = 'perf-ready-0123456789abcdef0123456789abcdef';
  const request = appApiReadinessRequest('local-anon-key', requestId);
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.headers, { apikey: 'local-anon-key', 'content-type': 'application/json', 'x-request-id': requestId });
  assert.equal(Object.hasOwn(request.headers, 'authorization'), false);
  assert.deepEqual(JSON.parse(request.body), { action: '__performance_readiness_probe__' });
});

test('readiness requires the app-api unsupported-action response, not a gateway status', async () => {
  const requestId = 'perf-ready-0123456789abcdef0123456789abcdef';
  const response = (status, body, id = requestId) => ({ status, headers: { get: name => name === 'x-request-id' ? id : null }, json: async () => body });
  assert.equal(await isAppApiReadyResponse(response(400, { error: 'Unsupported action.' }), requestId), true);
  let drained = false;
  assert.equal(await isAppApiReadyResponse({ status: 502, arrayBuffer: async () => { drained = true; return new ArrayBuffer(0); } }, requestId), false);
  assert.equal(drained, true, 'non-app responses are drained before retrying');
  for (const candidate of [
    response(400, { message: 'Bad Request' }),
    response(400, { error: 'Unauthorized' }),
    response(400, { error: 'Unsupported action.' }, 'other-request'),
    response(401, { error: 'Unsupported action.' }),
    response(403, { error: 'Unsupported action.' }),
    response(404, { error: 'Unsupported action.' }),
    response(502, { error: 'Unsupported action.' }),
    { status: 400, headers: { get: () => requestId }, json: async () => { throw new Error('not JSON'); }, arrayBuffer: async () => new ArrayBuffer(0) },
  ]) assert.equal(await isAppApiReadyResponse(candidate, requestId), false);
});

test('readiness requires the matching app-api log from the function-server child', () => {
  const requestId = 'perf-ready-0123456789abcdef0123456789abcdef';
  assert.equal(appApiReadinessLogSeen(`starting\n{"request_id":"${requestId}","function":"app-api","action":"__performance_readiness_probe__","status":400}`, requestId), true);
  assert.equal(appApiReadinessLogSeen(`{"request_id":"other","function":"app-api","action":"__performance_readiness_probe__","status":400}`, requestId), false);
  assert.equal(appApiReadinessLogSeen(`{"request_id":"${requestId}","function":"kong","action":"__performance_readiness_probe__","status":400}`, requestId), false);
});

test('readiness refuses missing publishable keys', () => {
  assert.throws(() => appApiReadinessRequest('', 'perf-ready-0123456789abcdef0123456789abcdef'), /PERFORMANCE_READINESS_API_KEY_REQUIRED/);
  assert.throws(() => appApiReadinessRequest(undefined, 'perf-ready-0123456789abcdef0123456789abcdef'), /PERFORMANCE_READINESS_API_KEY_REQUIRED/);
});

test('readiness requires a bounded opaque request id', () => {
  assert.throws(() => appApiReadinessRequest('key', 'bad'), /PERFORMANCE_READINESS_REQUEST_ID_INVALID/);
});
