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
