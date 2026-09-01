import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const api = read('supabase/functions/app-api/index.ts');
const worker = read('supabase/functions/request-delivery-worker/index.ts');
const appsScript = read('Code.gs');
const migration = read('supabase/migrations/20260901024608_drive_eval_shear_location_inquiries_v1.sql');

test('Drive Mode Eval Work uses ITEMCODE-wide V2 creation for Dylan, Megan, and JD', () => {
  assert.match(api, /const EVAL_WORK_MANAGER_USERS = new Set\(\["dylan_collyge", "megan_kelly", "jd_jones"\]\)/);
  assert.match(migration, /not in \(''dylan_collyge'', ''megan_kelly'', ''jd_jones''\)/);
  assert.match(html, /function openDriveEvalWorkBatch\(itemsOverride = null\)/);
  assert.match(html, /sourceMode: 'drive'/);
  assert.match(html, /reportLabel: sourceMode === 'drive' \? 'Drive Mode'/);
  assert.match(html, /const selectedUserFilters = sourceMode === 'drive' \? \['all_users'\]/);
  assert.match(html, /if\(action==='eval_work'\)\{pendingActionOptions = null; openDriveEvalWorkBatch\(\);return\}/);
  assert.match(html, /Every current row for each selected ITEMCODE is included in Eval Work and the PDF/);
});

test('Shear V2 tables are append-only, private, and service-role-only', () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  for (const table of ['ph_shear_location_submissions', 'ph_shear_location_inquiries', 'ph_shear_location_items', 'ph_shear_location_rows', 'ph_shear_location_events']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
  assert.match(migration, /grant all on table public\.ph_shear_location_inquiries to service_role/);
  assert.match(migration, /revoke all on function public\.create_shear_location_inquiries_v1\(jsonb\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.create_shear_location_inquiries_v1\(jsonb\) to service_role/);
  assert.doesNotMatch(migration, /delete from public\.(?:ph_master_inventory|ph_shear_list)/i);
});

test('server derives, locks, deduplicates, and freezes all current ITEMCODE/location rows', () => {
  assert.match(migration, /actor\.username <> 'dylan_collyge'[\s\S]*shear_create_forbidden/);
  assert.match(migration, /lower\(btrim\(m\.locationcode\)\)[\s\S]*lower\(btrim\(m\.itemcode\)\)/);
  assert.match(migration, /perform m\.unique_id[\s\S]*for update/);
  assert.match(migration, /unique \(inquiry_id, itemcode_key\)/);
  assert.match(migration, /unique \(inquiry_id, origin_unique_id\)/);
  assert.match(migration, /floor\(\(total_on_hand_value \* decision_record\.percent_to_shear \/ 100\) \+ 0\.5\)::integer/);
  assert.match(migration, /percent_to_shear > 0 and percent_to_shear <= 100/);
  for (const type of ['shape_shear', 'saleable_shear', 'hard_shear', 'corrective_shear']) assert.match(migration, new RegExp(type));
  assert.match(migration, /ph_shear_location_inquiries_one_active_location_idx[\s\S]*where status in \('open', 'in_progress'\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('shear-active-location:'/);
});

test('dedicated API validates live profiles and recipient profile IDs without exposing email addresses', () => {
  assert.match(api, /resolveActiveSessionProfile\(session\)/);
  assert.match(api, /session\?\.authUserId[\s\S]*query\.eq\("id", String\(session\.authUserId\)\)/);
  assert.match(api, /operation === "recipient_options"[\s\S]*directory\.map\(\(\{ profileId, username, display \}\)/);
  assert.match(api, /resolveShearRecipients\(payload\.recipientProfileIds\)/);
  assert.match(api, /supabase\.rpc\("create_shear_location_inquiries_v1"/);
  assert.match(api, /if \(table === "ph_warehouse_assigned_items" \|\| table === "ph_push_subscriptions" \|\| table === "ph_shear_list"\) return false/);
  assert.doesNotMatch(html, /supabaseFetch\(SHEAR_LIST_TABLE, '(?:POST|PATCH|DELETE)'/);
});

test('one outbox event per location produces an idempotent Item Inquiry-style PDF and email', () => {
  assert.match(migration, /'shear_location_inquiry'/);
  assert.match(migration, /'shear-location:' \|\| inquiry\.id::text \|\| ':created:v1'/);
  assert.match(migration, /on conflict \(event_key\) do update/);
  assert.match(worker, /"shear_location_inquiry"/);
  assert.match(appsScript, /function handleSignedShearLocationDelivery_/);
  assert.match(appsScript, /findSentRequestDeliveryByMessageId_/);
  assert.match(appsScript, /GNC_PH_Shear_Location_Inquiry_/);
  assert.match(appsScript, /Location Summary/);
  assert.match(appsScript, /Percent to Shear/);
  assert.match(appsScript, /Quantity to Shear/);
});

test('Queue renders terminal email states only and lazily expands large frozen row sets', () => {
  const cardStart = html.indexOf('function renderShearLocationInquiryCard');
  const cardEnd = html.indexOf('async function completeShearLocationInquiry', cardStart);
  const card = html.slice(cardStart, cardEnd);
  assert.match(card, /Email Sent/);
  assert.match(card, /Email Failed/);
  assert.doesNotMatch(card, /Sending|Queued|Processing|spinner/i);
  assert.match(html, /async function toggleShearLocationInquiryDetails/);
  assert.match(html, /shearLocationWorkApi\('get'/);
  assert.match(html, /inquiryRowLimits/);
  assert.match(html, /Show More Rows/);
  assert.match(html, /content-visibility:auto/);
});

test('client groups by normalized location and ITEMCODE with per-item decisions', () => {
  assert.match(html, /const key = `\$\{locationCode\}\|\$\{itemCode\}`/);
  assert.match(html, /currentRows\.reduce\(\(total, row\)[\s\S]*PTRONHAND/);
  assert.match(html, /shear-percent-input/);
  assert.match(html, /shear-type-select/);
  assert.match(html, /shear-instructions-input/);
  assert.match(html, /const quantity = Number\(percent\) > 0 \? Math\.floor\(\(onHand \* Number\(percent\) \/ 100\) \+ 0\.5\)/);
  assert.match(html, /defaultUsers = \['dylan_collyge', 'megan_kelly', 'jd_jones'\]/);
  assert.match(html, /recipientProfileIds/);
});
