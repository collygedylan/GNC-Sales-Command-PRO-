import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: suspend
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261019113414_suspend_tag_sender_identity.sql');
const worker = read('supabase/functions/request-delivery-worker/index.ts');
const push = read('supabase/functions/send-push-alert/index.ts');
const ui = readComposedAppSource();
const appsScript = read('Code.gs');

test('Suspend approval keeps actor identity distinct, freezes authorized recipients, and validates optional decision text', () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /add column if not exists sent_by uuid references public\.profiles\(id\)/);
  assert.match(migration, /sender_id := nullif\(current_setting\('app\.suspend_tag_actor_id', true\), ''\)::uuid/);
  assert.match(migration, /completed_by, sent_by, rep_id/);
  assert.match(migration, /'dan_mccuistion', 'dylan_collyge', 'megan_kelly', 'jd_jones'/);
  assert.match(migration, /suspend_tag_private\.active_profile\(target_id\)/);
  assert.match(migration, /approval_recipients\(approval_id, request_email, decision_emails\)/);
  assert.match(migration, /SUSPEND_TAG_APPROVAL_RECIPIENTS_NOT_READY/);
  assert.match(migration, /decision_message text/);
  assert.match(migration, /char_length\(coalesce\(p_payload->>'decisionMessage', ''\)\) > 1000/);
  assert.match(migration, /'deliveryRecipients', to_jsonb\(recipients\)/);
  assert.match(migration, /'decisionMessage', coalesce\(a\.decision_message, ''\)/);
  assert.match(migration, /commit;\s*$/);
});

test('approval request email and push target the assigned Rep; decision email targets the fixed team plus sender', () => {
  assert.match(worker, /preparedRecord\.deliveryRecipients/);
  assert.match(worker, /preparedRecord\.decisionMessage/);
  assert.match(worker, /deliveryRecipients, decisionMessage/);
  assert.match(worker, /if \(eventType === "suspend_tag_approval_requested" && !event\.push_delivered_at\)/);
  assert.match(worker, /repUsername: snapshot\.rep_username/);
  assert.doesNotMatch(worker, /responseUsernames:/);
  assert.match(migration, /when o\.event_type = 'suspend_tag_approval_requested' then array\[r\.request_email\]/);
  assert.match(migration, /else r\.decision_emails/);
  assert.match(push, /eventType === "suspend_tag_approval_requested"/);
  assert.match(push, /return normalizePayloadUserList\(payload\.repUsername\)/);
  assert.match(push, /SUSPEND_TAG_PUSH_RECEIPT_FAILED/);
  assert.doesNotMatch(migration, /decision_push_receipt/);
  assert.doesNotMatch(worker, /eventType === "suspend_tag_approval_decided" && !event\.push_delivered_at/);
});

test('email decision links only preselect; authenticated explicit submit persists the optional message', () => {
  assert.match(appsScript, /suspendDecision=approve/);
  assert.match(appsScript, /suspendDecision=deny/);
  assert.match(appsScript, /deliveryRecipients/);
  assert.match(appsScript, /dedupeEmailAddresses_\(rawRecipients\)/);
  assert.match(appsScript, /resolveOperationalEmailHeaders_\(model\.toArray, \[\], \[\]\)/);
  assert.match(appsScript, /toList: model\.toArray\.join\(','\)/);
  assert.match(ui, /suspendTagApprovalQuery\.get\('suspendDecision'\)/);
  assert.match(ui, /submitButton\.textContent = 'Submit decision'/);
  assert.match(ui, /suspendTagApi\('decide',\{approvalId,decision,decisionMessage\}/);
  assert.match(ui, /if \(!decision\) return/);
  assert.doesNotMatch(ui, /suspendTagApi\('decide',\{approvalId,decision:requestedDecision/);
});
