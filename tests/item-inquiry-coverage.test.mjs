import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const migration = read('supabase/migrations/20260904180407_item_inquiry_absence_coverage_v1.sql');
const app = read('index.html');
const worker = read('Code.gs');

test('coverage setting is manager-only, revisioned, idempotent and audited', () => {
  assert.match(migration, /managers\.item_inquiry_coverage\.manage/);
  for (const role of ['ADMIN', 'ADMINISTRATOR', 'MANAGER']) assert.match(migration, new RegExp(`'${role}'`));
  assert.match(migration, /p\.disabled_at is null[\s\S]*p\.locked_until[\s\S]*not p\.must_change_password/);
  assert.match(migration, /s\.revision <> p_expected_revision/);
  assert.match(migration, /unique\(actor_id, idempotency_key\)/);
  assert.match(migration, /item_inquiry_coverage_audit/);
});

test('coverage augments only new Item Inquiry and completion envelopes', () => {
  assert.match(migration, /new\.event_type not in \('reclass_inquiry','eval_work_completion'\)/);
  assert.match(migration, /sharon_email=any\(emails\)/);
  assert.match(migration, /itemInquiryCoverage/);
  assert.match(migration, /'sharonAway',s\.sharon_away,'sundayAdded',applied/);
  assert.doesNotMatch(migration, /eval_work_assignment/);
  assert.match(migration, /before insert on public\.ph_request_delivery_outbox/);
});

test('Sunday is server-derived, verified and never replaces Sharon', () => {
  assert.match(migration, /item_inquiry_verified_email_v1\('sunday_ellis'\)/);
  assert.match(migration, /item_inquiry_verified_email_v1\('sharon_combs'\)/);
  assert.match(migration, /u\.email_confirmed_at is not null/);
  assert.match(migration, /emails \|\| sunday_email/);
  assert.doesNotMatch(migration, /array_remove[\s\S]*sharon/);
});

test('signed delivery freezes the server-stamped recipient list across retries', () => {
  assert.match(worker, /contractVersion \|\| ''\) === 'item-inquiry-coverage-v1'/);
  assert.match(worker, /deliverReclassInquiryPayload_\(reclassPayload, messageIdHeader, frozenRecipients\)/);
  assert.match(worker, /Array\.isArray\(frozenRecipientEmails\)[\s\S]*dedupeEmailAddresses_\(frozenRecipientEmails\)/);
});

test('Managers has a responsive Here/Gone control and global coverage explanation', () => {
  assert.match(app, /ITEM_INQUIRY_COVERAGE_SETTINGS_VIEW = 'item-inquiry-coverage'/);
  assert.match(app, /Inquiry Coverage/);
  assert.match(app, /Mark Sharon Gone/);
  assert.match(app, /Mark Sharon Here/);
  assert.match(app, /Sharon always stays on the email/);
  assert.match(app, /New Item Inquiries keep Sharon and also add Sunday/);
  assert.match(app, /get_item_inquiry_coverage_v1/);
  assert.match(app, /set_item_inquiry_coverage_v1/);
});

