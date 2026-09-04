import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260902002912_flatten_eval_reports_2_and_reconcile_work.sql');
const creationRepair = read('../supabase/migrations/20260902032807_repair_eval_work_assignee_insert_contract.sql');
const lookupOptimization = read('../supabase/migrations/20260902034335_optimize_eval_work_itemcode_lookup.sql');
const fullLookupOptimization = read('../supabase/migrations/20260902034603_optimize_eval_work_master_lookup_full.sql');
const assignmentBatchMigration = read('../supabase/migrations/20260902105411_group_eval_report2_assignment_email.sql');
const multiAssigneeMigration = read('../supabase/migrations/20260831030457_eval_work_multi_assignee_v1.sql');
const completionRouting = read('../supabase/migrations/20260901201209_eval_report2_completion_routing.sql');
const productionProbe = read('../scripts/probe-production-auth-health.mjs');
const deliveryWorker = read('../supabase/functions/request-delivery-worker/index.ts');
const appApi = read('../supabase/functions/app-api/index.ts');
const codeGs = read('../Code.gs');
const html = read('../index.html');

test('flat Eval Reports #2 cards show every current row and separate selection from card activation', () => {
  assert.match(html, /function getManagerEvalReport2AllCurrentAssignedRows/);
  assert.match(html, /safeGroup\.rows[\s\S]*LOCATIONCODE[\s\S]*LOTCODE[\s\S]*PTRONHAND[\s\S]*PTRAVAILABLE/);
  assert.match(html, /data-role="manager-eval2-selection-toggle"[\s\S]*event\.stopPropagation\(\)/);
  assert.match(html, /onclick="return openManagerEvalReport2DirectInquiry/);
  assert.match(html, /openArgosInventoryTransactionModal\(uid, 'reclass', 'eval-report-2'\)/);
  assert.match(html, /getManagerEvalReport2RenderedItemGroups\(\)/);
  assert.match(html, /renderMarkupChunkedByKey\([\s\S]*'manager-eval-report-2'/);
  assert.match(html, /Loading all \$\{totalItemcodes\} matching ITEMCODEs automatically/);
  assert.match(html, /All \$\{totalItemcodes\} matching ITEMCODEs loaded/);
  assert.match(html, /verifyRowSelector: '\.manager-eval2-item-card'/);
  assert.doesNotMatch(html, /managerEvalReport2VisibleItemLimit|showMoreManagerEvalReport2Items|Load .* more ITEMCODE/);
  assert.doesNotMatch(html, /\$\{modeButton\('inquiry'/);
  assert.doesNotMatch(html, /originRows\.length > 100/);
});

test('protected batch creation recomputes report membership and permits partial success', () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /create or replace function private\.eval_report2_item_qualifies_v1/);
  assert.match(migration, /create or replace function public\.create_eval_report2_batch_v1/);
  assert.match(migration, /private\.eval_report2_item_qualifies_v1\(report_id, itemcode, now\(\)\)/);
  assert.match(migration, /'result', 'already_resolved'/);
  assert.match(migration, /'partial_success'/);
  assert.match(migration, /create_old_clause[\s\S]*jsonb_array_length\(context_rows\) > 100/);
  assert.match(migration, /replace\(definition, create_old_clause, create_new_clause\)/);
  assert.match(appApi, /operation === "report_page"/);
  assert.match(appApi, /create_eval_report2_batch_v1/);
  assert.match(appApi, /resolvedItemcodes/);
  assert.match(html, /outcome === 'already_resolved'/);
  assert.match(html, /Eval Work Partially Queued/);
});

test('canonical imports close cleared report work without a completion delivery', () => {
  assert.match(migration, /check \(status in \('open', 'in_progress', 'submitted', 'cancelled', 'resolved_import'\)\)/);
  assert.match(migration, /create or replace function public\.reconcile_eval_report2_work_v1/);
  assert.match(migration, /pg_try_advisory_xact_lock/);
  assert.match(migration, /p_dry_run boolean default true/);
  assert.match(migration, /set status = 'resolved_import'/);
  assert.match(migration, /'deliveryQueued', false/);
  assert.match(migration, /'deliveryEventsCreated', 0/);
  assert.doesNotMatch(migration.slice(migration.indexOf('create or replace function public.reconcile_eval_report2_work_v1')), /insert into public\.ph_request_delivery_outbox/);
  assert.match(codeGs, /reconcile_eval_report2_work_v1/);
  assert.match(codeGs, /evalReport2ResolvedCount/);
  assert.match(html, /Resolved by Import/);
  assert.match(html, /preserved — no completion email/);
});

test('report predicates preserve Y and U3 SHFT exclusions and configured rules', () => {
  assert.match(migration, /p_season[\s\S]*in \('Y', 'U3'\)[\s\S]*like '%SHFT%'/);
  for (const reportId of ['s1-with-pri', 'u1', 'u2', 'u3', 'od-loc-note-date', 'hs-plus-5-days', 'get-off-hold', 'low-stock', 'no-pri', 'culls', 'not-in-f1']) {
    assert.match(migration, new RegExp(`'${reportId}'`));
  }
  assert.match(migration, /ph_eval_report_settings/);
  assert.match(migration, /low_stock_max_slts/);
  assert.match(migration, /hold_age_days/);
  assert.match(migration, /location_note_age_days/);
});

test('direct and assignment recipient contracts are server-owned', () => {
  assert.match(migration, /get_eval_report2_direct_inquiry_recipients_v1/);
  for (const username of ['dylan_collyge', 'megan_kelly', 'sharon_combs']) {
    assert.match(migration, new RegExp(`'${username}'`));
  }
  assert.match(migration, /actor_username = 'jd_jones'/);
  assert.match(migration, /p\.disabled_at is null/);
  assert.match(migration, /p\.locked_until is null or p\.locked_until <= now\(\)/);
  assert.match(migration, /u\.email_confirmed_at is not null/);
  assert.match(codeGs, /get_eval_report2_direct_inquiry_recipients_v1/);
  assert.match(codeGs, /expectedCount = actorKey === 'jd_jones' \? 4 : 3/);
  assert.match(migration, /assignmentRecipients/);
  assert.match(migration, /array_append\(usernames, 'jd_jones'\)/);
});

test('Eval Work creation satisfies multi-assignee constraints before the base insert returns', () => {
  assert.match(creationRepair, /^begin;[\s\S]*commit;\s*$/);
  assert.match(creationRepair, /normalized_assignees := private\.eval_work_normalize_assignees_v1/);
  assert.match(creationRepair, /inquiry_draft, origin_count, assigned_to_users, assignee_usernames, assignee_profiles/);
  assert.match(creationRepair, /cardinality\(origin_ids\), matched_users, normalized_usernames, normalized_profiles/);
  assert.match(creationRepair, /inquiry_draft,[\s\S]*assignee_usernames, assignee_profiles/);
  assert.match(creationRepair, /create or replace function public\.get_eval_work_creation_health_snapshot_v1/);
  assert.match(creationRepair, /revoke all on function public\.get_eval_work_creation_health_snapshot_v1\(\) from public, anon, authenticated/);
  assert.match(productionProbe, /production_eval_work_creation_contract_unhealthy/);
});

test('Eval Work ITEMCODE expansion uses the exact normalized lookup expressions', () => {
  assert.match(lookupOptimization, /^begin;[\s\S]*commit;\s*$/);
  assert.match(lookupOptimization, /upper\(btrim\(coalesce\(itemcode, ''\)\)\)/);
  assert.match(lookupOptimization, /upper\(btrim\(coalesce\(itemcode_normalized, itemcode, ''\)\)\)/);
  assert.match(lookupOptimization, /where coalesce\(present_in_drive, true\)/);
  assert.match(lookupOptimization, /analyze public\.ph_master_inventory/);
  assert.match(fullLookupOptimization, /^begin;[\s\S]*commit;\s*$/);
  assert.match(fullLookupOptimization, /drop index if exists public\.idx_ph_master_inventory_eval_itemcode_lookup/);
  assert.match(fullLookupOptimization, /create index idx_ph_master_inventory_eval_itemcode_lookup[\s\S]*upper\(btrim\(coalesce\(itemcode, ''\)\)\)/);
  assert.doesNotMatch(fullLookupOptimization, /where nullif/);
});

test('assignment and completion recipients remain separate for Eval Reports #2', () => {
  const reportCreateStart = migration.indexOf('create or replace function public.create_eval_report2_batch_v1');
  const directRecipientsStart = migration.indexOf('create or replace function public.get_eval_report2_direct_inquiry_recipients_v1');
  const reportCreate = migration.slice(reportCreateStart, directRecipientsStart);
  assert.ok(reportCreateStart >= 0 && directRecipientsStart > reportCreateStart);
  assert.doesNotMatch(reportCreate, /sharon_combs/);
  assert.match(multiAssigneeMigration, /private\.eval_work_required_manager_emails_v2\(\) \|\| emails/);
  assert.doesNotMatch(multiAssigneeMigration, /sharon_combs/);
  assert.match(completionRouting, /'sharon_combs'/);
  assert.match(completionRouting, /submitter_username = 'jd_jones'/);
});

test('one Eval Reports #2 multi-select sends one email with one PDF per ITEMCODE', () => {
  assert.match(assignmentBatchMigration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(assignmentBatchMigration, /create or replace function private\.eval_report2_group_assignment_delivery_v1/);
  assert.match(assignmentBatchMigration, /'contractVersion', 'eval-work-assignment-batch-v1'/);
  assert.match(assignmentBatchMigration, /'assignments', assignment_payloads/);
  assert.match(assignmentBatchMigration, /status = 'suppressed'[\s\S]*EVAL_WORK_ASSIGNMENT_GROUPED/);
  assert.match(assignmentBatchMigration, /set assignment_event_id = envelope\.event_id/);
  assert.match(assignmentBatchMigration, /outbox\.status = 'processing' or outbox\.email_delivered_at is not null or outbox\.status = 'delivered'/);
  assert.match(assignmentBatchMigration, /private\.eval_report2_group_assignment_delivery_v1\([\s\S]*p_payload->>''batchToken''/);
  assert.match(assignmentBatchMigration, /from public\.ph_eval_work sibling/);
  assert.match(assignmentBatchMigration, /'envelopeViolationCount', envelope_violation_count/);
  assert.match(assignmentBatchMigration, /envelope_violation_count = 0/);
  assert.match(assignmentBatchMigration, /revoke all on function private\.eval_report2_group_assignment_delivery_v1\(jsonb, text\)[\s\S]*from public, anon, authenticated/);
  assert.match(codeGs, /function getEvalWorkDeliveryPayloads_/);
  assert.match(codeGs, /eval-work-assignment-batch-v1/);
  assert.match(codeGs, /function buildEvalWorkPdfBlob_/);
  assert.match(codeGs, /const pdfBlobs = models\.map/);
  assert.match(codeGs, /attachments: pdfBlobs/);
  assert.match(codeGs, /18 \* 1024 \* 1024/);
  assert.match(codeGs, /Assigned: ' \+ String\(models\.length\) \+ ' ITEMCODEs/);
  assert.match(deliveryWorker, /const timeoutMs = \[[^\]]*"eval-work-assignment-batch-v1"[^\]]*\]\.includes[\s\S]*\? 120000 : 45000/);
  assert.match(deliveryWorker, /EVAL_WORK\.\*CONFLICT[\s\S]*return "EVAL_WORK_CONFLICT"/);
  assert.match(deliveryWorker, /EVAL_WORK\.\*VALIDATION[\s\S]*return "EVAL_WORK_VALIDATION"/);
  assert.match(productionProbe, /get_eval_work_assignment_batch_health_v1/);
  assert.match(productionProbe, /envelopeViolationCount\) === 0/);
  assert.match(productionProbe, /production_eval_work_assignment_batch_contract_unhealthy/);
});

test('new operations are service-only', () => {
  for (const signature of [
    'public.create_eval_report2_batch_v1(jsonb)',
    'public.get_eval_report2_direct_inquiry_recipients_v1(text)',
    'public.list_eval_report2_itemcodes_v1(jsonb)',
    'public.reconcile_eval_report2_work_v1(text, boolean, integer)',
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(migration, new RegExp(`revoke all on function ${escaped} from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant execute on function ${escaped} to service_role`));
  }
});
