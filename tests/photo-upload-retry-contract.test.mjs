import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../assets/row-workflow-functions.js', import.meta.url), 'utf8');
const start = source.indexOf('async function postPhotoUploadWithTransientRetry(');
const end = source.indexOf('        function applySuspendTagInventoryReceipt(', start);
assert.ok(start >= 0 && end > start);
function fixture(post) {
  const delays = [];
  const ctx = vm.createContext({ APP_API_FUNCTION_URL: '/app-api', SUPABASE_UPLOAD_TIMEOUT_MS: 12000,
    SECURE_DRIVE_EVIDENCE_PREFIXES: new Set(), navigator: { onLine: true }, TypeError,
    setTimeout: (resolve, delay) => { delays.push(delay); resolve(); }, postAppFunctionFormData: post });
  vm.runInContext(source.slice(start, end), ctx);
  return { ctx, delays };
}
test('photo upload retries are bounded and retain the same form and timeout', async () => {
  const calls = [], form = { get: () => '' };
  const f = fixture(async (_url, body, options) => {
    calls.push({ body, options });
    if (calls.length < 4) throw new TypeError('network error');
    return { ok: true };
  });
  assert.equal((await f.ctx.postPhotoUploadWithTransientRetry(form, {})).ok, true);
  assert.deepEqual(f.delays, [500, 1200, 2500]);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => call.body === form && call.options.timeoutMs === 12000));
});
test('aborted or changed-owner photo uploads do not start a transport', async () => {
  let calls = 0;
  const f = fixture(async () => { calls += 1; });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.ctx.postPhotoUploadWithTransientRetry({}, { signal: controller.signal }), /session changed/);
  await assert.rejects(f.ctx.postPhotoUploadWithTransientRetry({}, { isCurrent: () => false }), /session changed/);
  assert.equal(calls, 0);
});
