import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: aura
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { checkAuraProviderReadiness } from '../scripts/aura-provider-readiness.mjs';
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Gemini router executes only fixed typed caller-scoped reads and service-private memory', () => {
  const source = read('supabase/functions/_shared/aura-voice-store.ts');
  assert.match(source, /createClient<Database>/);
  assert.match(source, /user\.auth\.getUser\(bearer\)/);
  assert.match(source, /user\.rpc\("aura_voice_access_v1"/);
  assert.match(source, /user\.rpc\("aura_voice_inventory_read_v1"/);
  assert.match(source, /user\.rpc\("historical_requests_read_v1"/);
  assert.match(source, /admin\.rpc\("aura_voice_conversation_v1"/);
  assert.doesNotMatch(source, /admin\.rpc\("historical_requests|\.from\(|\.update\(|\.insert\(|\.delete\(/);
  const handler = read('supabase/functions/_shared/aura-voice-handler.ts');
  assert.ok(handler.indexOf('await withinSignal(store.authorize(signal), signal)') < handler.indexOf('await requestBody(request, signal)'));
  assert.doesNotMatch(handler, /api\.openai|OPENAI_API_KEY|user_metadata|eval\(/);
  assert.match(handler, /Nothing has been submitted or emailed/);
  assert.match(read('supabase/functions/aura-llm-router/index.ts'), /handleAuraVoiceRequest/);
  assert.doesNotMatch(read('supabase/functions/aura-query/index.ts'), /gemini|aura-voice/i);
});
test('Gemini readiness remains outside the backend deployment gate', () => {
  const workflow = yaml.safeLoad(read('.github/workflows/apps-script-sync.yml'));
  const steps = workflow.jobs['deploy-supabase'].steps;
  const deploy = steps.findIndex(step => step.name === 'Deploy changed Edge Functions');
  const provider = steps.findIndex(step => step.run?.includes('aura-provider-readiness.mjs'));
  assert.ok(deploy >= 0 && provider > deploy);
  assert.match(steps[deploy].run, /supabase functions deploy "\$function_name" --use-api --project-ref/);
  assert.equal(steps[deploy].env.RELEASE_EDGE_FUNCTIONS,"${{ needs.authorize-backend.outputs['edge-functions'] }}");
  assert.equal(steps[provider].if, '${{ false }}');
  assert.equal(workflow.jobs['publish-pages'], undefined);
  assert.match(steps[provider].env.SUPABASE_SERVICE_ROLE_KEY, /secrets\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(readComposedAppSource(), /AIza[A-Za-z0-9_-]{25,}|AQ\.[A-Za-z0-9_-]{25,}|GEMINI_API_KEY/);
});
test('production provider probe requires expected engine/model and fails closed without readiness', async () => {
  let sent;
  assert.deepEqual(await checkAuraProviderReadiness('https://abcdefghijklmnopqrst.supabase.co', 'secret', async (url, options) => {
    sent = { url, options }; return new Response(JSON.stringify({ ok: true, model: 'gemini-3.8-flash', speechModel: 'gemini-3.8-flash-tts', engine: 'gemini-tools-v1', checks: { refusal: true, inventoryRouting: true, speech: true } }));
  }), { ok: true, model: 'gemini-3.8-flash' });
  assert.equal(sent.url.pathname, '/functions/v1/aura-llm-router/health');
  assert.equal(sent.options.headers.Authorization, 'Bearer secret');
  await assert.rejects(checkAuraProviderReadiness('https://abcdefghijklmnopqrst.supabase.co', 'secret', async () => new Response('{}', { status: 503 })), /AURA_PROVIDER_NOT_READY/);
  await assert.rejects(checkAuraProviderReadiness('https://abcdefghijklmnopqrst.supabase.co', 'secret', async () => new Response(JSON.stringify({ ok: true, model: 'wrong', engine: 'gemini-tools-v1' }))), /MODEL_MISMATCH/);
  await assert.rejects(checkAuraProviderReadiness('https://abcdefghijklmnopqrst.supabase.co', 'secret', async () => new Response(JSON.stringify({ ok: true, model: 'gemini-3.8-flash', engine: 'gemini-tools-v1', checks: { refusal: true } }))), /ROUTING_UNVERIFIED/);
});
