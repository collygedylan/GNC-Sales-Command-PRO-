import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const migration = read('supabase/migrations/20260901121622_dylan_location_work_worksheets_v1.sql');
const api = read('supabase/functions/app-api/index.ts');
const worker = read('supabase/functions/request-delivery-worker/index.ts');
const app = read('index.html');
const appsScript = read('Code.gs');

test('Location Work uses append-only protected tables and service-role-only RPCs', () => {
  for (const table of [
    'ph_location_work_jobs', 'ph_location_work_lines', 'ph_location_work_assignments',
    'ph_location_work_delivery_events', 'ph_location_work_audit',
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${table} \\(`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`));
    assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role;`));
  }
  for (const rpc of [
    'create_location_work_job_v1', 'update_location_work_job_v1',
    'resolve_location_work_line_v1', 'cancel_location_work_job_v1',
    'retry_location_work_delivery_v1',
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${rpc}\\(`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${rpc}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`));
  }
  assert.doesNotMatch(migration, /alter table public\.ph_active_request|update public\.ph_active_request|delete from public\.ph_active_request/i);
});

test('creation is Dylan-only, idempotent, locks inventory, and validates each frozen line', () => {
  assert.match(migration, /actor\.username <> 'dylan_collyge'/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('location-work:' \|\| idempotency_value/);
  assert.match(migration, /where m\.unique_id = btrim\(line_record\.line->>'sourceUniqueId'\) for update/);
  assert.match(migration, /unique \(job_id, source_unique_id\)/);
  assert.match(migration, /action_type in \('ta', 'move', 'grade', 'save'\)/);
  assert.match(migration, /planned_qty > 0 and planned_qty <= snapshotted_on_hand/);
  assert.match(migration, /lower\(btrim\(m\.itemcode\)\) = lower\(btrim\(source_row\.itemcode\)\)/);
  assert.match(migration, /lower\(btrim\(m\.saleyear\)\) = lower\(btrim\(source_row\.saleyear\)\)/);
  assert.match(migration, /lower\(btrim\(m\.locationcode\)\) <> lower\(btrim\(source_row\.locationcode\)\)/);
  assert.match(migration, /ph_master_inventory_location_work_match_idx/);
});

test('completion enforces Done, Not Completed, variance confirmation, and completion email to Dylan', () => {
  assert.match(migration, /resolution_status in \('pending', 'done', 'not_completed'\)/);
  assert.match(migration, /p_actual_qty > line\.planned_qty and not coalesce\(p_variance_confirmed, false\)/);
  assert.match(migration, /location_work_reason_required/);
  assert.match(migration, /actor\.username = any\(job\.assigned_usernames\)/);
  assert.match(migration, /'location_work_completion'/);
  assert.match(migration, /recipient_email := lower\(btrim\(job\.completion_recipient->>'email'\)\)/);
  assert.doesNotMatch(migration, /update public\.ph_master_inventory set/i);
});

test('app API resolves verified recipients and scopes reads to assigned users', () => {
  assert.match(api, /const LOCATION_WORK_CREATOR = "dylan_collyge"/);
  assert.match(api, /const LOCATION_WORK_ACTIONS = new Set\(\["ta", "move", "grade", "save"\]\)/);
  assert.match(api, /await listActiveEmailProfiles\(\)/);
  assert.match(api, /query = query\.contains\("assigned_usernames", \[actor\]\)/);
  assert.match(api, /supabase\.rpc\("create_location_work_job_v1"/);
  assert.match(api, /supabase\.rpc\("resolve_location_work_line_v1"/);
  assert.match(api, /action === "location_work"/);
});

test('Bloom Picker exposes one Dylan-only Location Work editor with deduped destinations', () => {
  assert.match(app, /id="batch-btn-move"[\s\S]{0,500}> Location Work<\/button>/);
  assert.match(app, /function canCreateLocationWorkJob/);
  assert.match(app, /const canUseMoveQueue = canUseInventoryActions && canCreateLocationWorkJob\(\)/);
  assert.match(app, /function getLocationWorkDestinationGroups/);
  assert.match(app, /current\.matchingRows \+= 1/);
  assert.match(app, /Action Qty/);
  assert.match(app, /\[\['ta','TA'\],\['move','Move'\],\['grade','Grade'\],\['save','Save'\]\]/);
  assert.match(app, /Move requires an eligible destination; TA cannot have one/);
  assert.match(app, /recipientProfileIds: Array\.from\(locationWorkSelectedRecipientIds\)/);
});

test('Queue resolves lines and only shows terminal email states', () => {
  assert.match(app, /function renderLocationWorkDeliveryState/);
  assert.match(app, />Email Sent<\/span>/);
  assert.match(app, />Email Failed\$\{canRetry/);
  assert.doesNotMatch(app, /Location Work[\s\S]{0,80}Sending in Background/i);
  assert.match(app, /function resolveLocationWorkLine/);
  assert.match(app, /Actual Qty Required/);
  assert.match(app, /Not Completed/);
  assert.match(app, /Actual Qty \$\{actualQty\} is above planned Qty/);
});

test('delivery worker and Apps Script support idempotent assignment and completion PDFs', () => {
  assert.match(worker, /"location_work_assignment", "location_work_completion"/);
  assert.match(appsScript, /LOCATION_WORK_ASSIGNMENT_EVENT_TYPE_ = 'location_work_assignment'/);
  assert.match(appsScript, /LOCATION_WORK_COMPLETION_EVENT_TYPE_ = 'location_work_completion'/);
  assert.match(appsScript, /function handleSignedLocationWorkDelivery_/);
  assert.match(appsScript, /findSentRequestDeliveryByMessageId_/);
  assert.match(appsScript, /Worker Initials/);
  assert.match(appsScript, /Worker Signature/);
  assert.match(appsScript, /Completion Date/);
  assert.match(appsScript, /Actual Qty/);
  assert.match(appsScript, /GNC_PH_Location_Work_/);
});
