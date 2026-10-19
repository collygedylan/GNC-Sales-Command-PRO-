// @test-group: backend
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

function emailContext() {
  const sent = [];
  const saved = [];
  const properties = new Map();
  const ctx = vm.createContext({
    sent,
    saved,
    properties,
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) || null,
      setProperty: (key, value) => properties.set(key, value),
      deleteProperty: key => properties.delete(key),
    }) },
    dedupeEmailAddresses_: emails => [...new Set(emails.map(email => String(email).trim().toLowerCase()))],
    escapeEmailHtml_: value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]),
    buildRequestEmailTableItemsHtml_: () => '<table>synthetic item row</table>',
    resolveOperationalEmailHeaders_: (to, cc, bcc) => ({ to, cc, bcc }),
    resolveAutomatedEmailSenderAddress_: () => 'robot@example.test',
    getRequestDeliveryReceipt_: () => null,
    findSentRequestDeliveryByMessageId_: () => null,
    sendGmailApiMessage_: model => {
      sent.push(model);
      return { gmailMessageId: 'synthetic-gmail-id', threadId: 'synthetic-gmail-thread' };
    },
    saveRequestDeliveryReceipt_: (id, result) => saved.push({ id, result }),
  });
  vm.runInContext(`${functionSource('buildSuspendTagApprovalEmail_')}\n${functionSource('handleSignedSuspendTagDelivery_')}`, ctx);
  return ctx;
}

const decisionRecipients = [
  'dan@example.test', 'dylan@example.test', 'megan@example.test', 'jd@example.test', 'sender@example.test',
];
function delivery(eventType, overrides = {}) {
  return {
    eventType,
    messageIdHeader: '<suspend-tag-v1@example.test>',
    thread: { threadId: 'original-thread-id', messageId: '<original-message-id@example.test>' },
    payload: {
      approval: {
        id: 'b0000000-0000-4000-8000-000000000001',
        status: eventType === 'suspend_tag_approval_decided' ? 'approved' : 'pending',
        rep_email: 'assigned-rep@example.test',
        submitter_email: 'sender@example.test',
        snapshot: {
          customername: 'Synthetic Customer', consigneename: 'Synthetic Consignee',
          commonname: 'Neptune Grape', contsize: '2DP', locationcode: 'B.01.000',
          quantityordered: 10, dock_spec: 'Tall & strong', dock_caliper: '', match: 80,
          loc_match_qty: 8, initial_ptr: 424, av_note: 'Synthetic only', dock_note: 'none',
          dock_photo_link: '', dock_photo_name: '', completed_by_display: 'Synthetic Worker', sent_by_display: 'Synthetic Sender',
        },
      },
      ...(eventType === 'suspend_tag_approval_requested'
        ? { deliveryRecipients: ['assigned-rep@example.test'] }
        : { deliveryRecipients: decisionRecipients }),
      ...(eventType === 'suspend_tag_approval_decided' ? { decisionMessage: 'Check <aisle> & recount' } : {}),
      ...overrides,
    },
  };
}

test('Suspend request email addresses only the assigned Rep and supplies safe one-click decision links', () => {
  const ctx = emailContext();
  ctx.__delivery = delivery('suspend_tag_approval_requested');
  const model = vm.runInContext('buildSuspendTagApprovalEmail_(__delivery)', ctx);
  assert.deepEqual(Array.from(model.toArray), ['assigned-rep@example.test']);
  assert.equal(model.replyTo, 'sender@example.test');
  assert.match(model.htmlBody, /href="https:\/\/agmetricapp\.com\/\?suspendApproval=b0000000-0000-4000-8000-000000000001&amp;suspendDecision=approve"/);
  assert.match(model.htmlBody, /href="https:\/\/agmetricapp\.com\/\?suspendApproval=b0000000-0000-4000-8000-000000000001&amp;suspendDecision=deny"/);
  assert.match(model.textBody, /suspendDecision=approve/);
  assert.match(model.textBody, /suspendDecision=deny/);
  assert.doesNotMatch(model.htmlBody, /Check &lt;aisle&gt;/);
  assert.equal(ctx.sent.length, 0, 'model construction must never send email');
});

test('decision email deduplicates the frozen team plus sender, escapes the custom note, and replies in the original Gmail thread', () => {
  const ctx = emailContext();
  ctx.__delivery = delivery('suspend_tag_approval_decided');
  const model = vm.runInContext('buildSuspendTagApprovalEmail_(__delivery)', ctx);
  assert.deepEqual(Array.from(model.toArray), decisionRecipients);
  assert.equal(model.replyTo, 'assigned-rep@example.test');
  assert.match(model.htmlBody, /Decision message:<\/strong> Check &lt;aisle&gt; &amp; recount/);
  assert.doesNotMatch(model.htmlBody, /suspendDecision=approve|suspendDecision=deny/);

  const result = vm.runInContext('handleSignedSuspendTagDelivery_(__delivery)', Object.assign(ctx, { __delivery: delivery('suspend_tag_approval_decided') }));
  assert.equal(result.gmailMessageId, 'synthetic-gmail-id');
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].toList, decisionRecipients.join(','));
  assert.deepEqual(Array.from(ctx.sent[0].toArray), decisionRecipients);
  assert.equal(ctx.sent[0].threadId, 'original-thread-id');
  assert.equal(ctx.sent[0].inReplyTo, '<original-message-id@example.test>');
  assert.equal(ctx.sent[0].references, '<original-message-id@example.test>');
  assert.equal(ctx.saved.length, 1);
  assert.equal(ctx.properties.size, 0, 'successful fake delivery clears the attempt intent');
});

test('approval email fails closed on malformed, duplicate, and overlong delivery data without sending', () => {
  const ctx = emailContext();
  const base = delivery('suspend_tag_approval_decided');
  for (const recipients of [
    ['valid@example.test', 'not-an-email'],
    ['duplicate@example.test', 'duplicate@example.test'],
    [],
  ]) {
    ctx.__delivery = { ...base, payload: { ...base.payload, deliveryRecipients: recipients } };
    assert.throws(() => vm.runInContext('buildSuspendTagApprovalEmail_(__delivery)', ctx), /SUSPEND_TAG_RECIPIENTS_INVALID/);
  }
  ctx.__delivery = { ...base, payload: { ...base.payload, decisionMessage: 'x'.repeat(1001) } };
  assert.throws(() => vm.runInContext('buildSuspendTagApprovalEmail_(__delivery)', ctx), /SUSPEND_TAG_DECISION_MESSAGE_INVALID/);
  assert.equal(ctx.sent.length, 0, 'invalid models never reach the fake sender');
});
