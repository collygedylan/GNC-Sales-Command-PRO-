import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAuraProviderReadiness } from '../scripts/aura-provider-readiness.mjs';

const url = 'https://abcdefghijklmnopqrst.supabase.co';
const ready = () => Response.json({ ok: true, model: 'gemini-3.8-flash', engine: 'gemini-tools-v1', checks: { refusal: true, inventoryRouting: true } });
test('readiness retries confirmed transient provider errors with bounded exponential backoff', async () => {
  const delays = []; let attempts = 0;
  const result = await checkAuraProviderReadiness(url, 'test-key', async () => ++attempts < 4
    ? Response.json({ reason: 'AURA_GEMINI_UNAVAILABLE', providerStatus: 503 }, { status: 503 }) : ready(),
  { wait: async milliseconds => delays.push(milliseconds) });
  assert.deepEqual(result, { ok: true, model: 'gemini-3.8-flash' });
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
});
test('persistent provider errors fail after four attempts without bypassing readiness', async () => {
  let attempts = 0; const delays = [];
  await assert.rejects(checkAuraProviderReadiness(url, 'test-key', async () => {
    attempts++; return Response.json({ reason: 'AURA_GEMINI_UNAVAILABLE', providerStatus: 503 }, { status: 503 });
  }, { wait: async milliseconds => delays.push(milliseconds) }), /provider HTTP 503/);
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
});
test('authentication, malformed responses and failed confinement are never retried', async () => {
  for (const response of [Response.json({ reason: 'AURA_FORBIDDEN' }, { status: 403 }),
    Response.json({ reason: 'AURA_GEMINI_UNAVAILABLE', providerStatus: 403 }, { status: 503 }),
    Response.json({ reason: 'AURA_PROVIDER_CONFINEMENT_PROBE_FAILED' }, { status: 503 }),
    Response.json({ message: 'private-message' }, { status: 503 }),
    Response.json({ ok: true, model: 'gemini-3.8-flash', engine: 'gemini-tools-v1', checks: { refusal: false, inventoryRouting: true } })]) {
    let attempts = 0;
    await assert.rejects(checkAuraProviderReadiness(url, 'test-key', async () => { attempts++; return response; },
      { wait: async () => { throw new Error('WAIT_MUST_NOT_RUN'); } }));
    assert.equal(attempts, 1);
  }
});
test('readiness trims BOM and surrounding whitespace without changing the token', async () => {
  await checkAuraProviderReadiness(url, '\uFEFF test-key\r\n', async (_url, options) => {
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer test-key');
    return Response.json({ ok: true, model: 'gemini-3.8-flash', engine: 'gemini-tools-v1', checks: { refusal: true, inventoryRouting: true } });
  });
});
test('readiness rejects malformed or empty input before fetching', async () => {
  for (const key of ['', '\uFEFF ', 'bad\uFEFFkey', 'test key', 'key\nvalue']) {
    await assert.rejects(checkAuraProviderReadiness(url, key, () => { throw new Error('FETCH_MUST_NOT_RUN'); }), /SUPABASE_SERVICE_ROLE_KEY_(?:REQUIRED|INVALID)/);
  }
});
test('readiness reports only fixed diagnostic codes and statuses', async () => {
  await assert.rejects(checkAuraProviderReadiness(url, 'test-key', async () => Response.json({
    code: 'AURA_PROVIDER_NOT_READY', reason: 'AURA_GEMINI_UNAVAILABLE', providerStatus: 403, message: 'private-provider-message',
  }, { status: 503 })), /AURA_PROVIDER_NOT_READY \(HTTP 503; AURA_GEMINI_UNAVAILABLE; provider HTTP 403\)/);
  await assert.rejects(checkAuraProviderReadiness(url, 'test-key', async () => Response.json({
    code: 'private-credential', reason: 'private-provider-message', providerStatus: 'private-credential',
  }, { status: 503 })), error => error.message === 'AURA_PROVIDER_NOT_READY (HTTP 503; AURA_PROVIDER_NOT_READY)');
});
