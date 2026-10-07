// Production checks are owned by the release runner; this script never logs bodies or tokens.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function checkAuraAuthorization(baseUrl, fetcher = fetch) {
  const url = new URL(baseUrl);
  assert.equal(url.protocol, 'https:', 'SUPABASE_HTTPS_REQUIRED');
  assert.match(url.hostname, /^[a-z0-9]{20}\.supabase\.co$/, 'SUPABASE_HOST_REQUIRED');
  for (const route of ['aura-query', 'aura-llm-router']) {
    for (const mode of ['command', 'list', 'read', 'delete']) {
      for (const authorization of ['', 'Bearer invalid-token']) {
        const response = await fetcher(new URL(`/functions/v1/${route}`, url), {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
          body: JSON.stringify({ mode, text: 'How many plants?', conversationId: '00000000-0000-4000-8000-000000000001' }),
          signal: AbortSignal.timeout(20_000),
        });
        await response.body?.cancel();
        assert.equal(response.status, 403, `${route}:${mode}:AUTHORIZATION_REFUSAL_REQUIRED`);
      }
    }
  }
  return { routes: 2, assertions: 16 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'CLOUD_RELEASE_RUNNER_REQUIRED');
  await checkAuraAuthorization(process.env.SUPABASE_URL || '');
  console.log('Aura production authorization smoke passed on both internal endpoints.');
}
