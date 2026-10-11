import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function checkAuraProviderReadiness(baseUrl, serviceKey, fetcher = fetch) {
  const url = new URL(baseUrl);
  assert.equal(url.protocol, 'https:', 'SUPABASE_HTTPS_REQUIRED');
  assert.match(url.hostname, /^[a-z0-9]{20}\.supabase\.co$/, 'SUPABASE_HOST_REQUIRED');
  assert.ok(serviceKey, 'SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  // A release-only, synthetic refusal checks the real model/key without reading business data.
  const response = await fetcher(new URL('/functions/v1/aura-llm-router/health', url), {
    headers: { Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(20000),
  });
  if (response.status !== 200) { await response.body?.cancel(); throw new Error('AURA_PROVIDER_NOT_READY'); }
  const data = await response.json();
  assert.equal(data.ok, true, 'AURA_PROVIDER_NOT_READY');
  assert.equal(data.model, 'gemini-3.8-flash', 'AURA_PROVIDER_MODEL_MISMATCH');
  assert.equal(data.engine, 'gemini-tools-v1', 'AURA_PROVIDER_ENGINE_MISMATCH');
  return { ok: true, model: data.model };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'CLOUD_RELEASE_RUNNER_REQUIRED');
  await checkAuraProviderReadiness(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  console.log('Aura Gemini model, credential, and synthetic confinement readiness verified.');
}
