import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyReleaseSmokeRoute, isProvenReleaseSmokeReadCancellation,
  RELEASE_SMOKE_SUPABASE_ORIGIN as api } from './helpers/release-smoke-route-policy.mjs';

const read = (body, extra = {}) => ({ method: 'POST', url: `${api}/functions/v1/app-api`,
  body: JSON.stringify(body), failure: 'net::ERR_ABORTED', ...extra });

test('browser-aborted reads accept evolving payloads without exact shapes or stack evidence', () => {
  for (const body of [
    { action: 'inventory_read', operation: 'master_page', params: { dataset: 'master', offset: 7500, newFilter: true } },
    { action: 'dataset_read', dataset: 'new_fixture_dataset', params: { limit: 25, cursor: 'next' } },
    { action: 'eval_work', operation: 'list', payload: { status: 'all', limit: 300 } },
    { action: 'request_history', operation: 'compatibility', payload: { nextVersion: 2 } },
    { action: 'navigation_preferences', operation: 'get', futureReadOption: true },
    { action: 'user_access', operation: 'resolve' },
    { action: 'av_read', dataset: 'settings' },
  ]) {
    for (const failure of ['AbortError', 'net::ERR_ABORTED', 'Load request cancelled', 'Request canceled', 'The operation was aborted.']) {
      const resource = read(body, { failure });
      assert.equal(isProvenReleaseSmokeReadCancellation(resource), true, JSON.stringify(resource));
      assert.equal(isProvenReleaseSmokeReadCancellation(resource, []), true, 'no per-fetch cancellation receipt is required');
    }
  }
});

test('cancelled telemetry and allowlisted GET/RPC reads do not depend on request-body contracts', () => {
  for (const resource of [
    { method: 'GET', url: `${api}/rest/v1/ph_app_settings?select=value`, failure: 'net::ERR_ABORTED' },
    { method: 'POST', url: `${api}/rest/v1/rpc/get_my_dataset_revisions_v1`, body: '{"future":true}', failure: 'AbortError' },
    { method: 'POST', url: `${api}/rest/v1/rpc/report_app_health_event`, body: '{"kind":"view_render"}', failure: 'Load request cancelled' },
    read({ action: 'health-telemetry', payload: { duration: 45, reason: 'request' } }),
  ]) assert.equal(isProvenReleaseSmokeReadCancellation(resource), true, resource.url);
});

test('unknown URLs, non-cancellations and mutations remain failures even when aborted', () => {
  const resource = read({ action: 'inventory_read', operation: 'master_page' });
  for (const extra of [
    { url: 'https://unmocked.example.test/read' },
    { url: `${api}/functions/v1/unmocked` },
    { url: `${api}/rest/v1/rpc/unmocked` },
    { method: 'PATCH', url: `${api}/rest/v1/ph_app_settings` },
    { method: 'DELETE', url: `${api}/rest/v1/ph_app_settings` },
    { failure: 'net::ERR_FAILED' }, { failure: 'TimeoutError' },
    { idempotencyKey: 'write-command' }, { body: 'invalid-json' },
  ]) assert.equal(isProvenReleaseSmokeReadCancellation({ ...resource, ...extra }), false, JSON.stringify(extra));
  for (const body of [
    { action: 'drive_reclass_inquiry', operation: 'create' },
    { action: 'inventory_reclass_move', operation: 'status' },
    { action: 'eval_work', operation: 'complete' },
    { action: 'eval_work', operation: 'update' },
    { action: 'navigation_preferences', operation: 'set' },
    { action: 'dataset_read', operation: 'delete' },
    { action: 'unknown_mutation' },
  ]) assert.equal(isProvenReleaseSmokeReadCancellation(read(body)), false, JSON.stringify(body));
  const site = 'http://127.0.0.1:43124';
  for (const request of [
    { method: 'POST', url: `${api}/functions/v1/unmocked` },
    { method: 'PATCH', url: `${api}/rest/v1/ph_app_settings` },
    { method: 'POST', url: `${site}/unmocked-write` },
  ]) assert.equal(classifyReleaseSmokeRoute({ ...request, origin: site }).allowed, false);
});
