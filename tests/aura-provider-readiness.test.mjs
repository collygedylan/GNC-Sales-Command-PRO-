import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAuraProviderReadiness } from '../scripts/aura-provider-readiness.mjs';

const url = 'https://abcdefghijklmnopqrst.supabase.co';
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
