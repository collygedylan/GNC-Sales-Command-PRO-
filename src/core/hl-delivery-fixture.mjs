import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import vm from 'node:vm';
const source = readFileSync(new URL('../../Code.gs', import.meta.url), 'utf8');
const userId = '12345678-1234-1234-1234-123456789abc';
export const previewId = '22345678-1234-1234-1234-123456789abc';
export const eventId = '32345678-1234-1234-1234-123456789abc';
const leaseToken = '42345678-1234-1234-1234-123456789abc';
export const dylan = 'dylan_collyge@greenleafnursery.com';
export const token = 'native.payload.signature';
export const key = 'sb_secret_synthetic';
const clone = (value) => JSON.parse(JSON.stringify(value));

export function reportFixture(overrides = {}) {
  return { contract_version: 'hl-order-report-v1', kind: 'submission', order_id: previewId, order_number: 'HL-2026-000001',
    created_at: '2026-09-11T12:00:00.000Z', total_quantity: 12,
    lines: [{ source_id: 'SOC-1', itemcode: '000748.010.1', contsize: '#3', quantity: 12, planstartdate: '2026-09-15', dock: '3', stopnumber: '4',
      commonname: 'Synthetic Azalea', locationcode: 'C.12.4', lotcode: 'LOT-1', ptravailable: 45, transactionnumber: 'ORDER-12', purchaseordernumber: 'PO-8' }], ...overrides };
}

export function reportFixtureV2(overrides = {}) {
  return { ...reportFixture(), contract_version: 'hl-order-report-v2', ship_date: '2026-09-15',
    batch_id: '52345678-1234-1234-1234-123456789abc', ...overrides };
}

export function reportFixtureV3(overrides = {}) {
  return reportFixtureV2({ contract_version: 'hl-order-report-v3', lines: [{ source_id: 'RESTOCK-1', source_kind: 'restock',
    itemcode: '000748.010.1', contsize: '#3', quantity: 12, planstartdate: '2026-09-15',
    commonname: 'Synthetic Restocking <Holly>', lotcode: '27.F1', ptravailable: 0 }], ...overrides });
}

export function createHlBackend(options = {}) {
  const rendered = [], sent = [], reads = [], records = [];
  const properties = new Map([['SUPABASE_SERVICE_ROLE_KEY', key]]);
  const eventKey = 'hl-order-submission:' + previewId;
  const messageId = '<gnc-' + createHash('sha256').update(eventKey).digest('hex').slice(0, 40) + '@request-delivery.agdatasolutions.local>';
  const state = { event_id: eventId, event_key: eventKey, event_type: 'hl_order_submission', created_by: userId, order_id: previewId,
    report: reportFixture(), recipients: [dylan], delivery_status: 'queued', reconciliation_only: false, receipt: null, ...options.saved };
  const profile = { id: userId, username: 'dylan_collyge', must_change_password: false, disabled_at: null, locked_until: null, ...options.profile };
  const context = vm.createContext({ console, ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) }, MimeType: { PDF: 'application/pdf' },
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
    UrlFetchApp: { fetch: (url, request) => fetchHlFixture({ options, state, profile, reads, records }, url, request) }
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
    preview: (changes = {}) => clone(context.handleHlOrderPreview_({ type: 'hl_order_preview', nativeAuthAccessToken: token, previewId, ...changes })),
    send: (changes) => dispatch(signed(changes)) };
}

function fetchHlFixture({ options, state, profile, reads, records }, url, request) {
  reads.push({ url, request });
  const path = new URL(url).pathname;
  const reply = (body, status = 200) => ({ getResponseCode: () => status, getContentText: () => JSON.stringify(body) });
  if (path === '/auth/v1/user') return reply(options.authUser ?? { id: userId }, options.authStatus ?? 200);
  if (path === '/rest/v1/profiles') return reply([profile]);
  if (path === '/rest/v1/ph_hl_order_previews') {
    return reply([{ id: previewId, created_by: userId, expires_at: '2999-01-01T00:00:00Z', report: state.report, ...options.preview }]);
  }
  if (path === '/rest/v1/rpc/hl_order_delivery_lookup_v1') return reply(state);
  if (path === '/rest/v1/rpc/hl_order_delivery_record_v1') return reply(recordHlFixture({ options, state, records }, request));
  throw new Error('Unexpected test request ' + path);
}
function recordHlFixture({ options, state, records }, request) {
  const p = JSON.parse(request.payload); records.push(p);
        assert.equal(p.p_lease_token, leaseToken);
        if (options.recordError === p.p_status) throw new Error('RPC acknowledgement lost');
        if (p.p_status === 'sending') {
          const body = { allow_send: !['sending', 'sent', 'unknown'].includes(state.delivery_status) };
          if (body.allow_send) state.delivery_status = 'sending';
          return body;
        } else if (p.p_status === 'sent') { state.receipt = p.p_result; state.delivery_status = 'sent'; }
        else if (state.delivery_status !== 'sent') state.delivery_status = p.p_status;
  return { status: state.delivery_status };
}
