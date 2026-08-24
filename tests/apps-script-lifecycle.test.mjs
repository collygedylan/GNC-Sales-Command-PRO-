import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const required = [
  'dylan_collyge@greenleafnursery.com',
  'kayla_knepp@greenleafnursery.com',
  'jd_jones@greenleafnursery.com'
];

function createContext() {
  const context = vm.createContext({
    console,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => '' })
    }
  });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(context);
  return context;
}

function collect(context, payload) {
  context.__payload = payload;
  return vm.runInContext('collectRequestRecipients_(__payload)', context);
}

function recipientList(context, payload) {
  return Array.from(collect(context, payload).toArray);
}

function assertRequiredRecipients(recipients) {
  for (const email of required) assert.ok(recipients.includes(email), `${email} was missing`);
}

test('username-only submitter is included with all required lifecycle recipients', () => {
  const context = createContext();
  const recipients = recipientList(context, {
    emailType: 'new_request',
    requestCreatedByUsername: 'morgan_anderson'
  });
  assertRequiredRecipients(recipients);
  assert.ok(recipients.includes('morgan_anderson@greenleafnursery.com'));
});

test('explicit-email submitter is included with all required lifecycle recipients', () => {
  const context = createContext();
  const recipients = recipientList(context, {
    emailType: 'request_complete',
    requestCreatedByEmail: 'submitter@greenleafnursery.com'
  });
  assertRequiredRecipients(recipients);
  assert.ok(recipients.includes('submitter@greenleafnursery.com'));
});

test('submitter matching a required recipient is deduplicated', () => {
  const context = createContext();
  const recipients = recipientList(context, {
    emailType: 'new_request',
    requestCreatedByUsername: 'dylan_collyge',
    recipientEmails: ['DYLAN_COLLYGE@greenleafnursery.com']
  });
  assertRequiredRecipients(recipients);
  assert.equal(recipients.filter((email) => email === required[0]).length, 1);
});

test('missing submitter information still preserves the required three', () => {
  const context = createContext();
  const recipients = recipientList(context, { emailType: 'request_complete' });
  assert.deepEqual(recipients.sort(), required.slice().sort());
});

test('malformed and duplicate values are rejected while selected and linked reps remain', () => {
  const context = createContext();
  const recipients = recipientList(context, {
    emailType: 'new_request',
    requestCreatedByUsername: 'kayla_knepp',
    recipientEmails: ['bad-address', required[2], required[2].toUpperCase()],
    selectedRepRecipients: ['selected_rep@greenleafnursery.com'],
    linkedRepEmails: ['linked_rep@greenleafnursery.com', 'missing-at-sign']
  });
  assertRequiredRecipients(recipients);
  assert.ok(recipients.includes('selected_rep@greenleafnursery.com'));
  assert.ok(recipients.includes('linked_rep@greenleafnursery.com'));
  assert.ok(!recipients.includes('bad-address'));
  assert.equal(recipients.filter((email) => email === required[2]).length, 1);
});

function prepareSendContext() {
  const context = createContext();
  context.__captured = null;
  vm.runInContext(`
    hydrateRequestCompletePayload_ = function(payload) { return payload; };
    buildRequestEmailMessage_ = function() {
      return { subject: 'Internal lifecycle test', textBody: 'test', htmlBody: '<p>test</p>' };
    };
    resolveAutomatedEmailSenderAddress_ = function() { return 'sender@greenleafnursery.com'; };
    isGmailAdvancedServiceAvailable_ = function() { return true; };
    sendGmailApiMessage_ = function(options) {
      __captured = options;
      return {
        ok: true,
        status: 200,
        threadId: options.threadId || 'new-thread',
        messageId: '<message@example.test>',
        recipients: options.toArray || [],
        mode: options.threadId ? 'gmail_api_threaded' : 'gmail_api'
      };
    };
  `, context);
  return context;
}

test('completion replies to the submitted thread when metadata exists', () => {
  const context = prepareSendContext();
  context.__payload = {
    emailType: 'request_complete',
    requestCreatedByUsername: 'dylan_collyge',
    threadId: 'thread-123',
    messageId: '<submitted@example.test>'
  };
  const result = vm.runInContext('sendRequestEmailWithFallback_(__payload)', context);
  assert.equal(result.mode, 'gmail_api_threaded');
  assert.equal(context.__captured.threadId, 'thread-123');
  assert.equal(context.__captured.inReplyTo, '<submitted@example.test>');
  assert.equal(result.requiredRecipientsSatisfied, true);
  assert.equal(result.submitterIncluded, true);
});

test('completion uses the documented fresh-email fallback without thread metadata', () => {
  const context = prepareSendContext();
  context.__payload = {
    emailType: 'request_complete',
    requestCreatedByUsername: 'dylan_collyge'
  };
  const result = vm.runInContext('sendRequestEmailWithFallback_(__payload)', context);
  assert.equal(result.mode, 'gmail_api_fresh_completion');
  assert.equal(context.__captured.threadId, '');
  assert.match(result.message, /fresh email/i);
});
