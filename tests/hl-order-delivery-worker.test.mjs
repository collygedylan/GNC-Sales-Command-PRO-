import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto, createHash, createHmac } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const worker = readFileSync(new URL('../supabase/functions/request-delivery-worker/index.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(worker.replace(/^import .*;\r?\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const eventId = '32345678-1234-1234-1234-123456789abc';
const leaseToken = '42345678-1234-1234-1234-123456789abc';
const key = 'synthetic-service-key';
const dylan = 'dylan_collyge@greenleafnursery.com';

function harness(options = {}) {
  const calls = [], fetches = [], permanent = [];
  const event = { event_id: eventId, lease_token: leaseToken, event_type: 'hl_order_submission', event_key: 'hl-order-submission:order-1', payload: {}, ...options.event };
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'claim_request_delivery_events') return { data: [event] };
      if (name === options.rpcFailure) return { error: { code: 'synthetic_failure' } };
      return { data: {} };
    },
    from: (table) => {
      assert.equal(table, 'ph_request_delivery_outbox');
      const chain = { update(patch) { permanent.push(patch); return this; }, eq() { return this; }, select() { return this; }, maybeSingle: async () => ({ data: { event_id: eventId } }) };
      return chain;
    }
  };
  let handler;
  const context = vm.createContext({ console: { error() {} }, Request, Response, TextEncoder, AbortController, setTimeout, clearTimeout, btoa, crypto: webcrypto,
    Deno: { env: { get: (name) => ({ SUPABASE_URL: 'https://db.example.invalid', SUPABASE_SERVICE_ROLE_KEY: key, REQUEST_DELIVERY_CRON_SECRET: 'cron-secret', APPS_SCRIPT_WEB_APP_URL: 'https://script.example.invalid' })[name] } },
    createClient: () => db, serve: (fn) => { handler = fn; }, withObservedRequest: (_, __, fn) => fn(),
    fetch: async (url, input) => {
      fetches.push({ url, input }); assert.equal(url, 'https://script.example.invalid', 'HL must never send push or load unrelated request rows');
      const signed = JSON.parse(input.body);
      assert.equal(signed.signature, createHmac('sha256', key).update(signed.timestamp + '.' + signed.deliveryJson).digest('base64url'));
      if (options.fetchError) throw new Error('socket closed after request was accepted');
      if (options.invalidResponse) return new Response('<html>Gateway error</html>', { status: 502 });
      const delivery = JSON.parse(signed.deliveryJson);
      const body = options.result ?? { ok: true, gmailMessageId: 'gmail-1', threadId: 'thread-1', messageId: delivery.messageIdHeader, messageIdHeader: delivery.messageIdHeader, recipients: [dylan] };
      return new Response(JSON.stringify(body), { status: options.status || 200 });
    }
  });
  new vm.Script(compiled, { filename: 'request-delivery-worker.js' }).runInContext(context);
  const run = async (headers = { 'x-delivery-cron-secret': 'cron-secret' }) => {
    const response = await handler(new Request('https://worker.example.invalid', { method: 'POST', headers, body: JSON.stringify({ source: 'manual' }) }));
    return { status: response.status, body: await response.json() };
  };
  return { run, calls, fetches, permanent, event };
}

test('worker denies unauthorized callers before claiming or sending', async () => {
  const h = harness(); assert.equal((await h.run({ authorization: 'Bearer forged' })).status, 401); assert.equal(h.calls.length, 0); assert.equal(h.fetches.length, 0);
});

for (const event_type of ['hl_order_submission', 'hl_order_cancellation']) test(`${event_type} is signed email-only, carries lease and uses stable message id`, async () => {
  const h = harness({ event: { event_type } }); const result = await h.run(); assert.equal(result.body.delivered, 1);
  const signed = JSON.parse(h.fetches[0].input.body); const delivery = JSON.parse(signed.deliveryJson);
  assert.equal(delivery.leaseToken, leaseToken); assert.deepEqual(delivery.rows, []); assert.equal(delivery.thread, null);
  assert.equal(delivery.messageIdHeader, '<gnc-' + createHash('sha256').update(h.event.event_key).digest('hex').slice(0, 40) + '@request-delivery.agdatasolutions.local>');
  assert.deepEqual(h.calls.map((v) => v.name), ['claim_request_delivery_events', 'record_request_delivery_channel_result', 'complete_request_delivery_event', 'heartbeat_request_delivery_worker']);
  const channel = h.calls.find((v) => v.name === 'record_request_delivery_channel_result').args.p_channel_results;
  assert.equal(channel.email.status, 'sent'); assert.deepEqual(Array.from(channel.email.recipients), [dylan]); assert.equal(channel.push, undefined);
});

test('worker HTTP timeout, invalid response, missing Gmail receipt and explicit unknown block blind retries', async () => {
  for (const options of [{ fetchError: true }, { invalidResponse: true }, { result: { ok: true } },
    { result: { ok: false, deliveryUncertain: true, retryable: false, code: 'HL_ORDER_DELIVERY_UNKNOWN' } }]) {
    const h = harness(options); const result = await h.run(); assert.equal(result.body.failed, 1);
    const record = h.calls.find((v) => v.name === 'hl_order_delivery_record_v1'); assert.equal(record.args.p_status, 'unknown'); assert.equal(record.args.p_result.safe_to_retry, false);
    assert.equal(h.permanent[0].status, 'failed'); assert.equal(h.permanent[0].sanitized_error_code, 'HL_ORDER_DELIVERY_UNKNOWN');
    assert.ok(!h.calls.some((v) => v.name === 'fail_request_delivery_event')); assert.equal(h.fetches.length, 1);
  }
});

test('known pre-send renderer failure retains safe retry, while forbidden delivery fails permanently', async () => {
  for (const retryable of [true, false]) {
    const h = harness({ result: { ok: false, deliveryUncertain: false, retryable, code: retryable ? 'HL_ORDER_PDF_BUILD_FAILED' : 'HL_ORDER_FORBIDDEN' } });
    await h.run(); const record = h.calls.find((v) => v.name === 'hl_order_delivery_record_v1');
    assert.equal(record.args.p_status, 'failed'); assert.equal(record.args.p_result.safe_to_retry, true);
    assert.equal(h.calls.some((v) => v.name === 'fail_request_delivery_event'), retryable); assert.equal(h.permanent.length, retryable ? 0 : 1);
  }
});

test('lost channel acknowledgement persists unknown without sending a second message in that run', async () => {
  const h = harness({ rpcFailure: 'record_request_delivery_channel_result' }); await h.run();
  assert.equal(h.fetches.length, 1); assert.equal(h.calls.find((v) => v.name === 'hl_order_delivery_record_v1').args.p_status, 'unknown');
  assert.ok(!h.calls.some((v) => v.name === 'complete_request_delivery_event')); assert.equal(h.permanent.length, 1);
});

test('local pre-send error after a persisted send intent remains unknown, including reclaimed ScriptLock contention', async () => {
  for (const status of ['sending', 'unknown', 'sent']) {
    const h = harness({ event: { channel_results: { email: { status } } },
      result: { ok: false, deliveryUncertain: false, retryable: true, code: 'HL_ORDER_DELIVERY_BUSY' } });
    await h.run();
    const record = h.calls.find((v) => v.name === 'hl_order_delivery_record_v1');
    assert.equal(record.args.p_status, 'unknown'); assert.equal(record.args.p_result.safe_to_retry, false);
    assert.equal(h.permanent[0].sanitized_error_code, 'HL_ORDER_DELIVERY_UNKNOWN');
    assert.ok(!h.calls.some((v) => v.name === 'fail_request_delivery_event'));
  }
});

test('retry of an interrupted/unknown event is explicitly reconciliation-only with the same identity', async () => {
  for (const status of ['sending', 'unknown', 'sent']) {
    const h = harness({ event: { channel_results: { email: { status } } } }); await h.run();
    const delivery = JSON.parse(JSON.parse(h.fetches[0].input.body).deliveryJson); assert.equal(delivery.reconciliationOnly, true);
    assert.equal(delivery.eventId, eventId); assert.equal(delivery.eventKey, h.event.event_key);
  }
});

test('already acknowledged email finishes without another external send or a push', async () => {
  const h = harness({ event: { email_delivered_at: '2026-09-11T12:00:00Z', channel_results: { email: { status: 'sent', gmail_message_id: 'prior' } } } });
  assert.equal((await h.run()).body.delivered, 1); assert.equal(h.fetches.length, 0);
});
