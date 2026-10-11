import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function checkAuraProviderReadiness(baseUrl, serviceKey, fetcher = fetch,
  { wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  const url = new URL(baseUrl);
  assert.equal(url.protocol, 'https:', 'SUPABASE_HTTPS_REQUIRED');
  assert.match(url.hostname, /^[a-z0-9]{20}\.supabase\.co$/, 'SUPABASE_HOST_REQUIRED');
  const normalizedServiceKey = String(serviceKey || '').trim();
  assert.ok(normalizedServiceKey, 'SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  if (!/^[\x21-\x7e]+$/.test(normalizedServiceKey)) throw new Error('SUPABASE_SERVICE_ROLE_KEY_INVALID');
  // Each attempt must pass both real synthetic routing checks. Retry only a
  // confirmed transient provider response; configuration and failed proofs stop.
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetcher(new URL('/functions/v1/aura-llm-router/health', url), {
      headers: { Authorization: `Bearer ${normalizedServiceKey}` }, signal: AbortSignal.timeout(45000),
    });
    if (response.status !== 200) {
      // Only fixed error codes and numeric statuses enter logs; never echo bodies,
      // provider messages, headers, or credential contents.
      const safeReasons = new Set(['AURA_FORBIDDEN', 'AURA_GEMINI_CONFIGURATION_UNAVAILABLE', 'AURA_GEMINI_BUSY', 'AURA_GEMINI_UNAVAILABLE',
        'AURA_TOOL_INVALID', 'AURA_TOOL_FORBIDDEN', 'AURA_PROVIDER_CONFINEMENT_PROBE_FAILED', 'AURA_PROVIDER_ROUTING_PROBE_FAILED']);
      let body;
      try { body = await response.json(); } catch { /* Keep malformed responses generic. */ }
      const reason = safeReasons.has(body?.reason) ? body.reason : safeReasons.has(body?.code) ? body.code : 'AURA_PROVIDER_NOT_READY';
      const providerStatus = Number.isInteger(body?.providerStatus) && body.providerStatus >= 400 && body.providerStatus <= 599
        ? `; provider HTTP ${body.providerStatus}` : '';
      if (attempt < 3 && response.status === 503
        && ['AURA_GEMINI_UNAVAILABLE', 'AURA_GEMINI_BUSY'].includes(reason)
        && [408, 429, 500, 502, 503, 504].includes(body?.providerStatus)) {
        await wait(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`AURA_PROVIDER_NOT_READY (HTTP ${response.status}; ${reason}${providerStatus})`);
    }
    const data = await response.json();
    assert.equal(data.ok, true, 'AURA_PROVIDER_NOT_READY');
    assert.equal(data.model, 'gemini-3.8-flash', 'AURA_PROVIDER_MODEL_MISMATCH');
    assert.equal(data.engine, 'gemini-tools-v1', 'AURA_PROVIDER_ENGINE_MISMATCH');
    assert.equal(data.checks?.refusal, true, 'AURA_PROVIDER_CONFINEMENT_UNVERIFIED');
    assert.equal(data.checks?.inventoryRouting, true, 'AURA_PROVIDER_ROUTING_UNVERIFIED');
    return { ok: true, model: data.model };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'CLOUD_RELEASE_RUNNER_REQUIRED');
  await checkAuraProviderReadiness(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  console.log('Aura Gemini model, credential, synthetic confinement, and inventory routing verified.');
}
