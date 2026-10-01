import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../supabase/functions/scheduled-offboarding/handler.ts', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../supabase/functions/scheduled-offboarding/index.ts', import.meta.url), 'utf8');
const compiled = (await transform(source, { loader: 'ts', format: 'esm' })).code;
const { createScheduledOffboardingHandler, TRANSITION_ID } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const serviceKey = 'test-service-role';
const profileId = 'e2584b32-472c-4888-b592-394235050b5b';
const request = (body = { source: 'pg_cron' }, authorization = `Bearer ${serviceKey}`) => new Request('https://function.test/scheduled-offboarding', {
  method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

function fakeClient({ tickError = null, authBanError = null, authBanThrows = false, claimError = null, claims = [] } = {}) {
  const calls = [];
  let tickCount = 0;
  return {
    calls,
    rpc: async (name, args = {}) => {
      calls.push({ kind: 'rpc', name, args });
      if (name === 'scheduled_handover_tick_v1') {
        tickCount += 1;
        if (tickError) return { data: null, error: tickError };
        return { data: tickCount === 1
          ? { due: true, authBanPending: true, profileId }
          : { due: true, complete: true, authBanPending: false }, error: null };
      }
      if (name === 'scheduled_handover_claim_push_v1') return { data: claims, error: claimError };
      return { data: true, error: null };
    },
    auth: { admin: { updateUserById: async (id, attributes) => {
      calls.push({ kind: 'auth', id, attributes });
      if (authBanThrows) throw new Error('simulated Auth network failure');
      return { error: authBanError };
    } } },
  };
}

test('scheduled worker rejects unauthorized callers and invalid payloads before touching Supabase', async () => {
  const supabase = fakeClient();
  const handler = createScheduledOffboardingHandler({ supabase, supabaseUrl: 'https://project.test', serviceRoleKey: serviceKey });
  assert.equal((await handler(request({ source: 'pg_cron' }, 'Bearer wrong-key'))).status, 401);
  assert.equal((await handler(request({ source: 'client' }))).status, 400);
  assert.equal((await handler(new Request('https://function.test', { method: 'GET' }))).status, 405);
  assert.equal(supabase.calls.length, 0);
});

test('Auth Admin network failures are checkpointed and the notification claim is reconciled', async () => {
  const supabase = fakeClient({ authBanThrows: true, claims: [{ id: 44, event_type: 'scheduled_handover_failed' }] });
  const pushCalls = [];
  const handler = createScheduledOffboardingHandler({
    supabase,
    supabaseUrl: 'https://project.test/',
    serviceRoleKey: serviceKey,
    fetcher: async (url, options) => {
      pushCalls.push({ url, options });
      return new Response(JSON.stringify({ subscriptions: 0, delivered: 0 }), { status: 200 });
    },
  });
  const result = await handler(request());
  assert.equal(result.status, 503);
  assert.equal(supabase.calls.filter(call => call.name === 'scheduled_handover_tick_v1').length, 2);
  const ban = supabase.calls.find(call => call.kind === 'auth');
  assert.equal(ban.id, profileId);
  assert.equal(ban.attributes.ban_duration, '876000h');
  const checkpoint = supabase.calls.find(call => call.name === 'scheduled_handover_auth_checkpoint_v1');
  assert.equal(checkpoint.args.p_ok, false);
  assert.equal(checkpoint.args.p_error_code, 'auth_admin_network_error');
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].url, 'https://project.test/functions/v1/send-push-alert');
  assert.ok(pushCalls[0].options.signal instanceof AbortSignal);
  const payload = JSON.parse(pushCalls[0].options.body);
  assert.equal(payload.eventType, 'scheduled_handover_failed');
  assert.equal(payload.transitionId, TRANSITION_ID);
  assert.deepEqual(payload.targetUsers, ['dylan_collyge']);
  const finished = supabase.calls.find(call => call.name === 'scheduled_handover_finish_push_v1');
  assert.equal(finished.args.p_ok, false);
  assert.equal(finished.args.p_error_code, 'push_no_subscriptions');
});

test('Auth Admin returned errors and claim failures are handled without duplicate external delivery', async () => {
  const supabase = fakeClient({ authBanError: { code: '429_RATE_LIMITED' }, claimError: new Error('claim unavailable') });
  const pushCalls = [];
  const handler = createScheduledOffboardingHandler({
    supabase, supabaseUrl: 'https://project.test', serviceRoleKey: serviceKey,
    fetcher: async (...args) => { pushCalls.push(args); return new Response('{}', { status: 200 }); },
  });
  const result = await handler(request());
  assert.equal(result.status, 503);
  const checkpoint = supabase.calls.find(call => call.name === 'scheduled_handover_auth_checkpoint_v1');
  assert.equal(checkpoint.args.p_ok, false);
  assert.equal(checkpoint.args.p_error_code, '429_rate_limited');
  assert.equal(pushCalls.length, 0);
  assert.equal(supabase.calls.some(call => call.name === 'scheduled_handover_finish_push_v1'), false);
});

test('worker bounds Auth and push fetches and keeps recipient target server-defined', () => {
  assert.match(entry, /AbortSignal\.timeout\(requestTimeoutMs\)/);
  assert.match(entry, /AbortSignal\.any\(\[init\.signal, timeout\]\)/);
  assert.match(source, /AbortSignal\.timeout\(PUSH_TIMEOUT_MS\)/);
  assert.match(source, /targetUsers:\s*\["dylan_collyge"\]/);
  assert.match(source, /rows\.slice\(0, 3\)/);
});
