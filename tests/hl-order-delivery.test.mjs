import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const userId = '12345678-1234-1234-1234-123456789abc';
const previewId = '22345678-1234-1234-1234-123456789abc';
const eventId = '32345678-1234-1234-1234-123456789abc';
const leaseToken = '42345678-1234-1234-1234-123456789abc';
const dylan = 'dylan_collyge@greenleafnursery.com';
const token = 'native.payload.signature';
const key = 'sb_secret_synthetic';
const clone = (value) => JSON.parse(JSON.stringify(value));

export function reportFixture(overrides = {}) {
  return { contract_version: 'hl-order-report-v1', kind: 'submission', order_id: previewId, order_number: 'HL-2026-000001',
    created_at: '2026-09-11T12:00:00.000Z', total_quantity: 12,
    lines: [{ source_id: 'SOC-1', itemcode: '000748.010.1', contsize: '#3', quantity: 12, planstartdate: '2026-09-15', dock: '3', stopnumber: '4',
      commonname: 'Synthetic Azalea', locationcode: 'C.12.4', lotcode: 'LOT-1', ptravailable: 45, transactionnumber: 'ORDER-12', purchaseordernumber: 'PO-8' }], ...overrides };
}

function reportFixtureV2(overrides = {}) {
  return { ...reportFixture(), contract_version: 'hl-order-report-v2', ship_date: '2026-09-15',
    batch_id: '52345678-1234-1234-1234-123456789abc', ...overrides };
}

export function createHlBackend(options = {}) {
  const rendered = [], sent = [], reads = [], records = [];
  const properties = new Map([['SUPABASE_SERVICE_ROLE_KEY', key]]);
  const eventKey = 'hl-order-submission:' + previewId;
  const messageId = '<gnc-' + createHash('sha256').update(eventKey).digest('hex').slice(0, 40) + '@request-delivery.agdatasolutions.local>';
  const state = { event_id: eventId, event_key: eventKey, event_type: 'hl_order_submission', created_by: userId, order_id: previewId,
    report: reportFixture(), recipients: [dylan], delivery_status: 'queued', reconciliation_only: false, receipt: null, ...options.saved };
  const profile = { id: userId, username: 'dylan_collyge', must_change_password: false, disabled_at: null, locked_until: null, ...options.profile };
  const context = vm.createContext({ console, MimeType: { PDF: 'application/pdf' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => properties.get(k) || '', setProperty: (k, v) => properties.set(k, v),
      getProperties: () => Object.fromEntries(properties), deleteProperty: (k) => properties.delete(k) }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, v) => [...createHash('sha256').update(v).digest()], computeHmacSha256Signature: (v, k) => [...createHmac('sha256', k).update(v).digest()],
      base64EncodeWebSafe: (v) => Buffer.from(v).toString('base64url'), base64Encode: (v) => Buffer.from(v).toString('base64'),
      formatDate: (_, __, format) => format === 'MMM d, yyyy' ? 'Sep 15, 2026' : 'Sep 11, 2026 7:00 AM CDT' },
    LockService: { getScriptLock: () => ({ tryLock: () => options.busy !== true, releaseLock() {} }) },
    HtmlService: { createHtmlOutput: (html) => { if (options.renderError) throw new Error('renderer failed'); rendered.push(html);
      const blob = { getAs() { return this; }, setName(name) { this.name = name; return this; }, getBytes() { return [...Buffer.from('%PDF-1.7\nSynthetic fixture')]; } };
      return { getBlob: () => blob }; } },
    Gmail: { Users: { Messages: { send() {}, list: () => ({ messages: [] }) } } },
    GmailApp: { sendEmail() { throw new Error('HL must never use legacy GmailApp delivery'); } },
    UrlFetchApp: { fetch: (url, request) => {
      reads.push({ url, request });
      const path = new URL(url).pathname;
      let body, status = 200;
      if (path === '/auth/v1/user') { body = options.authUser ?? { id: userId }; status = options.authStatus ?? 200; }
      else if (path === '/rest/v1/profiles') body = [profile];
      else if (path === '/rest/v1/ph_hl_order_previews') body = [{ id: previewId, created_by: userId, expires_at: '2999-01-01T00:00:00Z', report: state.report, ...options.preview }];
      else if (path === '/rest/v1/rpc/hl_order_delivery_lookup_v1') body = state;
      else if (path === '/rest/v1/rpc/hl_order_delivery_record_v1') {
        const p = JSON.parse(request.payload); records.push(p);
        assert.equal(p.p_lease_token, leaseToken);
        if (options.recordError === p.p_status) throw new Error('RPC acknowledgement lost');
        if (p.p_status === 'sending') {
          body = { allow_send: !['sending', 'sent', 'unknown'].includes(state.delivery_status) };
          if (body.allow_send) state.delivery_status = 'sending';
        } else if (p.p_status === 'sent') { state.receipt = p.p_result; state.delivery_status = 'sent'; body = { status: 'sent' }; }
        else { if (state.delivery_status !== 'sent') state.delivery_status = p.p_status; body = { status: state.delivery_status }; }
      } else throw new Error('Unexpected test request ' + path);
      return { getResponseCode: () => status, getContentText: () => JSON.stringify(body) };
    } }
  });
  new vm.Script(source, { filename: 'Code.gs' }).runInContext(context);
  context.jsonOutput_ = (value) => value;
  context.resolveAutomatedEmailSenderAddress_ = () => 'automation@example.invalid';
  context.findSentRequestDeliveryByMessageId_ = () => options.sentReceipt || null;
  context.sendGmailApiMessage_ = (mail) => { sent.push(mail); if (options.sendError) throw new Error('timeout after acceptance'); return { ok: true, gmailMessageId: 'gmail-1', threadId: 'thread-1', messageId }; };
  const delivery = (changes = {}) => ({ eventId, leaseToken, eventKey, eventType: state.event_type, messageIdHeader: messageId, payload: {}, ...changes });
  const signed = (changes) => {
    const deliveryJson = JSON.stringify(delivery(changes)), timestamp = new Date().toISOString();
    return { type: 'request_delivery_event', timestamp, signature: createHmac('sha256', key).update(timestamp + '.' + deliveryJson).digest('base64url'), deliveryJson };
  };
  const dispatch = (payload) => clone(context.doPost({ postData: { contents: JSON.stringify(payload) } }));
  return { context, state, reads, records, rendered, sent, properties, messageId, delivery, signed, dispatch,
    preview: (changes = {}) => dispatch({ type: 'hl_order_preview', nativeAuthAccessToken: token, previewId, ...changes }),
    send: (changes) => dispatch(signed(changes)) };
}

test('preview authenticates native JWT then reads an owned frozen report; it never sends', () => {
  const h = createHlBackend(); const result = h.preview();
  assert.equal(result.ok, true); assert.equal(result.recipient, dylan); assert.equal(result.previewId, previewId);
  assert.equal(result.mimeType, 'application/pdf'); assert.equal(Buffer.from(result.pdfBase64, 'base64').subarray(0, 5).toString(), '%PDF-');
  assert.equal(h.reads[0].request.headers.Authorization, 'Bearer ' + token);
  assert.match(h.reads[2].url, /ph_hl_order_previews\?select=id,created_by,expires_at,report&id=eq\./);
  assert.equal(h.sent.length, 0); assert.equal(h.records.length, 0);
});

test('preview denies recipient/content injection before fetching protected data', () => {
  for (const field of ['report', 'sourceRows', 'recipientEmails', 'recipients', 'cc', 'bcc', 'requestedBy', 'accessToken']) {
    const h = createHlBackend(); assert.equal(h.preview({ [field]: 'injected' }).ok, false);
    assert.equal(h.reads.length, 0); assert.equal(h.rendered.length, 0);
  }
});

test('preview rejects missing JWT, forged identity, inactive profiles and wrong ownership', () => {
  for (const nativeAuthAccessToken of ['', 'dylan_collyge', 'a.b.c\ninjected']) {
    const h = createHlBackend(); assert.equal(h.preview({ nativeAuthAccessToken }).code, 'HL_ORDER_AUTH_REQUIRED'); assert.equal(h.reads.length, 0);
  }
  for (const options of [{ authStatus: 401 }, { authUser: { user_metadata: { username: 'dylan_collyge' } } },
    ...[{ username: 'other' }, { disabled_at: '2026-01-01' }, { locked_until: '2999-01-01' }, { locked_until: 'invalid' }, { must_change_password: true }].map((profile) => ({ profile })),
    { preview: { created_by: eventId } }]) {
    const h = createHlBackend(options); assert.equal(h.preview().ok, false); assert.equal(h.rendered.length, 0); assert.equal(h.sent.length, 0);
  }
});

test('expired preview still permits an authenticated owner to read the immutable historical PDF', () => {
  const h = createHlBackend({ preview: { expires_at: '2020-01-01' } });
  assert.equal(h.preview().ok, true); assert.equal(h.sent.length, 0); assert.equal(h.records.length, 0);
});

test('frozen PDF includes all six columns, grouped natural dock/stop order, exact totals and escaped details', () => {
  const input = reportFixture(); const line = input.lines[0];
  input.lines = [{ ...line, source_id: 'third', dock: '10', stopnumber: '1' }, { ...line, source_id: 'second', dock: '2', stopnumber: '10' },
    { ...line, source_id: 'first', dock: '2', stopnumber: '2', commonname: '<img src=x onerror=attack>' }]; input.total_quantity = 36;
  const h = createHlBackend({ saved: { report: input } }); assert.equal(h.preview().ok, true); const html = h.rendered[0];
  for (const field of ['Item Code', 'Container Size', 'HL Order Quantity', 'Plan Start Date', 'Dock', 'Stop Number', 'Location: C.12.4', 'Lot: LOT-1', 'Availability: 45', 'Order ref: ORDER-12', 'PO: PO-8', 'Total HL order quantity: 36', 'counter(page)', 'counter(pages)', 'table-header-group']) assert.ok(html.includes(field), field);
  assert.ok(html.indexOf('Dock 2 / Stop 2') < html.indexOf('Dock 2 / Stop 10')); assert.ok(html.indexOf('Dock 2 / Stop 10') < html.indexOf('Dock 10 / Stop 1'));
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
});

test('v1 frozen reports retain their historical PDF view and filename', () => {
  const h = createHlBackend(); const result = h.preview();
  assert.equal(result.fileName, 'GNC_PH_HL_Order_HL-2026-000001.pdf');
  assert.doesNotMatch(h.rendered[0], /Ship date:|ADDITIONS/);
});

test('v2 submission, additions, and cancellation show the canonical ship date beneath the order number', () => {
  const submission = createHlBackend({ saved: { report: reportFixtureV2() } }); assert.equal(submission.send().ok, true);
  assert.match(submission.rendered[0], /HL Order HL-2026-000001<\/h1><div class="meta"><b>Ship date:<\/b> Sep 15, 2026/);
  assert.match(submission.sent[0].textBody, /Order: HL-2026-000001\nShip date: Sep 15, 2026\nHL order quantity: 12/);

  const additionLine = { ...reportFixture().lines[0], source_id: 'SOC-ADDITION', quantity: 2, ptravailable: 0 };
  const additionReport = reportFixtureV2({ kind: 'addition', lines: [additionLine, { ...additionLine, source_id: 'SOC-ADDITION-UNKNOWN', quantity: 1, ptravailable: null }], total_quantity: 3 });
  const addition = createHlBackend({ saved: { report: additionReport } }); assert.equal(addition.send().ok, true);
  assert.match(addition.rendered[0], /HL Order ADDITIONS HL-2026-000001/); assert.match(addition.rendered[0], /Ship date:<\/b> Sep 15, 2026/);
  assert.match(addition.rendered[0], /Added quantity: 3/); assert.match(addition.rendered[0], /Availability: 0/); assert.match(addition.rendered[0], /Availability: Unknown/);
  assert.match(addition.sent[0].textBody, /Ship date: Sep 15, 2026\nADDITIONS\nAdded quantity: 3/);
  assert.equal(addition.sent[0].subject, 'HL TAGS'); assert.equal(addition.sent[0].attachments[0].name, 'GNC_PH_HL_Order_HL-2026-000001_ADDITIONS_52345678-1234-1234-1234-123456789abc.pdf');

  const cancellationReport = reportFixtureV2({ kind: 'cancellation', batch_id: '', original_order_number: 'HL-2026-000001', reason: 'Correction' });
  const cancellation = createHlBackend({ saved: { report: cancellationReport, event_type: 'hl_order_cancellation' } }); assert.equal(cancellation.send().ok, true);
  assert.match(cancellation.rendered[0], /HL Order Cancellation HL-2026-000001/); assert.match(cancellation.rendered[0], /Ship date:<\/b> Sep 15, 2026/);
  assert.match(cancellation.sent[0].textBody, /Order: HL-2026-000001\nShip date: Sep 15, 2026\nOriginal order:/);
  assert.equal(cancellation.sent[0].subject, 'HL TAGS \u2014 CANCELLATION');
});

test('malformed snapshots fail closed before preview/send: quantities, totals, duplicate identities and bounds', () => {
  for (const quantity of [0, -1, 1.5, NaN, Infinity, '12', 1000000001]) {
    const report = reportFixture(); report.lines[0].quantity = quantity;
    const h = createHlBackend({ saved: { report } }); assert.equal(h.preview().ok, false); assert.equal(h.rendered.length, 0);
  }
  for (const mutate of [(r) => { r.total_quantity = 999; }, (r) => { r.lines.push(r.lines[0]); r.total_quantity = 24; }, (r) => { r.lines[0].commonname = 'x'.repeat(201); }]) {
    const report = reportFixture(); mutate(report); const h = createHlBackend({ saved: { report } }); assert.equal(h.preview().ok, false);
  }
});

test('v2 rejects forged kinds, malformed ship dates, and missing or forged batch identifiers', () => {
  for (const changes of [
    { kind: 'forged' }, { ship_date: '2026-9-15' }, { ship_date: '2026-02-30' }, { ship_date: '0000-00-00' },
    { batch_id: '' }, { batch_id: 'not-a-uuid' }, { kind: 'addition', batch_id: null }
  ]) {
    const h = createHlBackend({ saved: { report: reportFixtureV2(changes) } });
    assert.equal(h.preview().ok, false); assert.equal(h.rendered.length, 0); assert.equal(h.sent.length, 0);
  }
});

test('signed submission uses one canonical PDF and only Dylan; untrusted payload/rows/recipients are ignored', () => {
  const h = createHlBackend(); const result = h.send({ payload: { report: { evil: true }, recipients: ['attacker@example.com'] }, rows: [{ itemcode: 'evil' }] });
  assert.equal(result.ok, true); assert.deepEqual(result.recipients, [dylan]); assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].toList, dylan); assert.equal(h.sent[0].attachments.length, 1); assert.equal(h.sent[0].messageIdHeader, h.messageId);
  assert.equal(h.sent[0].subject, 'HL TAGS'); assert.match(h.sent[0].textBody, /Order: HL-2026-000001/);
  assert.deepEqual(h.records.map((r) => r.p_status), ['sending', 'sent']); assert.doesNotMatch(h.rendered[0], /evil|attacker/);
});

test('cancellation PDF preserves original order number and canceled quantities', () => {
  const report = reportFixture({ kind: 'cancellation', original_order_number: 'HL-2026-000001', order_number: 'HL-2026-000001', reason: 'Synthetic correction <check>' });
  const h = createHlBackend({ saved: { report, event_type: 'hl_order_cancellation' } }); assert.equal(h.send().ok, true);
  assert.match(h.rendered[0], /HL Order Cancellation HL-2026-000001/); assert.match(h.rendered[0], /Original order:<\/b> HL-2026-000001/);
  assert.match(h.rendered[0], /Total Canceled quantity: 12/); assert.match(h.sent[0].textBody, /Canceled quantity: 12/);
  assert.equal(h.sent[0].subject, 'HL TAGS \u2014 CANCELLATION'); assert.match(h.sent[0].textBody, /Original order: HL-2026-000001/);
});

test('signed delivery denies mismatched event identity, message id, inactive Dylan and recipient injection in storage', () => {
  for (const changes of [{ eventKey: 'forged' }, { messageIdHeader: '<forged@example.com>' }]) {
    const h = createHlBackend(); const r = h.send(changes); assert.equal(r.ok, false); assert.equal(r.retryable, false); assert.equal(h.sent.length, 0);
  }
  for (const options of [{ profile: { disabled_at: '2026-01-01' } }, { saved: { recipients: [dylan, 'attacker@example.com'] } }, { saved: { recipients: ['attacker@example.com'] } }]) {
    const h = createHlBackend(options); assert.equal(h.send().ok, false); assert.equal(h.sent.length, 0); assert.equal(h.records.length, 0);
  }
  const h = createHlBackend(); assert.throws(() => h.context.handleSignedRequestDeliveryEvent_({ ...h.signed(), signature: 'forged' }), /SIGNATURE_INVALID/); assert.equal(h.reads.length, 0);
});

test('acknowledgement loss and duplicate signed request recover durable receipt without resending', () => {
  const h = createHlBackend(); assert.equal(h.send().ok, true);
  h.properties.clear(); h.properties.set('SUPABASE_SERVICE_ROLE_KEY', key);
  assert.equal(h.send().recovered, true); assert.equal(h.sent.length, 1); assert.equal(h.rendered.length, 1);
});

test('uncertain Gmail result persists unknown and will not blindly send on a later attempt', () => {
  const h = createHlBackend({ sendError: true }); let r = h.send();
  assert.equal(r.deliveryUncertain, true); assert.equal(r.retryable, false); assert.equal(h.state.delivery_status, 'unknown');
  r = h.send(); assert.equal(r.code, 'HL_ORDER_DELIVERY_UNKNOWN'); assert.equal(h.sent.length, 1);
});

test('unknown and interrupted sending reconcile via Sent or remain blocked with no resend', () => {
  for (const delivery_status of ['sending', 'unknown']) {
    const blocked = createHlBackend({ saved: { delivery_status } }); assert.equal(blocked.send().deliveryUncertain, true); assert.equal(blocked.sent.length, 0);
    const recovered = createHlBackend({ saved: { delivery_status }, sentReceipt: { gmailMessageId: 'prior-message', threadId: 'prior-thread' } });
    assert.equal(recovered.send().recovered, true); assert.equal(recovered.sent.length, 0); assert.equal(recovered.state.delivery_status, 'sent');
  }
});

test('render failure is retryable without durable send intent or attachment-free fallback', () => {
  const h = createHlBackend({ renderError: true }); const result = h.send();
  assert.equal(result.ok, false); assert.equal(result.deliveryUncertain, false); assert.equal(result.retryable, true);
  assert.equal(h.sent.length, 0); assert.equal(h.records.length, 0);
});

test('lost durable receipt write keeps send intent unknown; Script receipt recovers without duplicate', () => {
  const options = { recordError: 'sent' };
  const h = createHlBackend(options); assert.equal(h.send().deliveryUncertain, true); assert.equal(h.sent.length, 1);
  options.recordError = null;
  assert.equal(h.send().recovered, true); assert.equal(h.sent.length, 1); assert.equal(h.rendered.length, 1);
});

test('legacy Apps Script outbox excludes HL before claiming and legacy direct HL TAGS requires app update', () => {
  assert.match(source, /event_type=not\.in\.\(photo_history_share,hl_order_submission,hl_order_cancellation\)/);
  const h = createHlBackend(); const result = h.dispatch({ type: 'email', emailType: 'bloom_purpose_report', emailSubType: 'hl_tags', accessToken: token, sourceRows: [] });
  assert.equal(result.code, 'hl_order_update_app_required'); assert.match(result.message, /Update the app/); assert.equal(h.sent.length, 0); assert.equal(h.reads.length, 0);
});
