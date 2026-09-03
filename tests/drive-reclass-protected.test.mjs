import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const migration = read('supabase/migrations/20260903032040_protected_drive_reclass_inquiry_v1.sql');
const auditBaseline = read('supabase/migrations/20260903035800_drive_reclass_access_audit_baseline_v1.sql');
const api = read('supabase/functions/app-api/index.ts');
const app = read('index.html');
const worker = read('Code.gs');

test('Drive Reclass enqueue is service-only, idempotent, actor-bound, and source-locked', () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /create or replace function public\.enqueue_drive_reclass_inquiry_v1\(p_payload jsonb\)/);
  assert.match(migration, /from public\.profiles p[\s\S]*disabled_at is null[\s\S]*locked_until[\s\S]*must_change_password/);
  assert.match(migration, /from public\.ph_master_inventory m[\s\S]*where btrim\(coalesce\(m\.unique_id, ''\)\) = source_uid[\s\S]*for share/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(event_key_value, 0\)\)/);
  assert.match(migration, /drive-reclass-protected-v1/);
  assert.match(migration, /DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT/);
  assert.match(migration, /DRIVE_RECLASS_TOKEN_CONFLICT/);
  for (const rpc of [
    'enqueue_drive_reclass_inquiry_v1\\(jsonb\\)',
    'get_drive_reclass_inquiry_status_v1\\(text, text\\)',
    'retry_drive_reclass_inquiry_v1\\(text, text\\)',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${rpc}\\s+from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc} to service_role`));
  }
  assert.match(migration, /commit;\s*$/);
});

test('Drive Reclass manager and evaluator scopes use centralized policy and authoritative assignment', () => {
  assert.match(migration, /'drive\.reclass\.submit'/);
  for (const role of ['ADMIN', 'ADMINISTRATOR', 'MANAGER']) assert.match(migration, new RegExp(`\\('${role}', 'global'\\)`));
  for (const role of ['EVAL', 'EVALUATOR']) assert.match(migration, new RegExp(`\\('${role}', 'assigned'\\)`));
  assert.match(migration, /private\.resolve_app_access_policy_id_v1\(false\)/);
  assert.match(migration, /from public\.ph_warehouse_assigned_items a[\s\S]*a\.present_in_drive[\s\S]*a\.assignedto/);
  assert.match(migration, /if is_evaluator and not is_manager[\s\S]*DRIVE_RECLASS_ROW_NOT_ASSIGNED/);
});

test('Drive Reclass permission receives immutable access-audit baseline coverage', () => {
  assert.match(auditBaseline, /insert into private\.app_access_legacy_baseline/i);
  assert.match(auditBaseline, /effective\.permission_key = 'drive\.reclass\.submit'/i);
  assert.match(auditBaseline, /on conflict \(profile_id, permission_key\) do nothing/i);
});

test('Drive Reclass recipients are active verified profiles derived on the server', () => {
  for (const username of ['dylan_collyge', 'megan_kelly', 'sharon_combs']) assert.match(migration, new RegExp(`'${username}'`));
  assert.match(migration, /auth\.users u on u\.id = p\.id/);
  assert.match(migration, /u\.email_confirmed_at is not null/);
  assert.match(migration, /unavailableUsernames/);
  assert.match(migration, /recipientEmails/);
  assert.match(migration, /required_drive_reclass/);
});

test('app API discards browser actor and recipients and returns only allowlisted errors', () => {
  const sanitizer = api.slice(api.indexOf('function sanitizeDriveReclassPayload'), api.indexOf('function driveReclassErrorResponse'));
  assert.doesNotMatch(sanitizer, /actor|recipientEmails|emailRecipients|recipients/);
  assert.match(api, /actorUsername/);
  assert.match(api, /enqueue_drive_reclass_inquiry_v1/);
  assert.match(api, /get_drive_reclass_inquiry_status_v1/);
  assert.match(api, /retry_drive_reclass_inquiry_v1/);
  assert.match(api, /action === "drive_reclass_inquiry"/);
  const errors = api.slice(api.indexOf('function driveReclassErrorResponse'), api.indexOf('async function handleDriveReclassAction'));
  assert.doesNotMatch(errors, /code:\s*raw|code:\s*code/);
  assert.match(errors, /DRIVE_RECLASS_SERVICE_UNAVAILABLE/);
});

test('Drive Mode keeps one eight-action V3 editor and routes only Drive through the protected API', () => {
  const modal = app.slice(app.indexOf('function ensureArgosInventoryTransactionModal'), app.indexOf('function renderArgosInventoryTransactionSource'));
  for (const removed of ['Send As', 'Request / Hold-Stop']) assert.doesNotMatch(modal, new RegExp(removed));
  assert.match(app, /ARGOS_INVENTORY_TRANSACTION_REQUEST_LABELS\[action\] \|\| rule\.label/);
  assert.match(app, /sourceMode: 'drive'/);
  assert.match(app, /driveReclassApi\('create'/);
  assert.match(app, /driveReclassApi\('status'/);
  assert.match(app, /driveReclassApi\('retry'/);
  assert.match(app, /if \(isArgosEvalReport2Inquiry\(\)\)/);
});

test('Apps Script rejects public Drive enqueue and renders requested changes without PROPOSED', () => {
  const enqueueStart = worker.indexOf('function enqueueReclassInquiryEmail_');
  const enqueue = worker.slice(enqueueStart, worker.indexOf('function handleInventoryTransaction_', enqueueStart));
  assert.match(enqueue, /sourceMode[\s\S]*=== 'drive'[\s\S]*status: 'unauthorized'/);
  assert.match(worker, /drive-reclass-protected-v1/);
  const reportStart = worker.indexOf('function buildReclassInquiryCompactReportHtml_');
  const report = worker.slice(reportStart, worker.indexOf('function handleInventoryTransaction_', reportStart));
  assert.match(report, /Yellow, boxed values are requested changes/);
  assert.match(report, /no inventory was changed/);
  assert.doesNotMatch(report, />PROPOSED</i);
});
