import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260827005258_eval_work_v1.sql', import.meta.url), 'utf8');
const appApi = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../supabase/functions/request-delivery-worker/index.ts', import.meta.url), 'utf8');
const appsScript = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

test('Eval Work schema is append-only, durable, scoped, and not directly writable', () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /create table if not exists public\.ph_eval_work \(/);
  assert.match(migration, /create table if not exists public\.ph_eval_work_events \(/);
  assert.match(migration, /check \(status in \('open', 'in_progress', 'submitted', 'cancelled'\)\)/);
  assert.match(migration, /contract_version text not null default 'eval-work-v1'/);
  assert.match(migration, /alter table public\.ph_eval_work enable row level security/);
  assert.match(migration, /lower\(assignee_username\) = lower\(\(private\.current_active_profile\(\)\)\.username\)/);
  assert.match(migration, /revoke all on table public\.ph_eval_work from public, anon, authenticated/);
  assert.match(migration, /grant select on table public\.ph_eval_work to authenticated/);
  assert.match(migration, /revoke all on function public\.submit_eval_work_v1[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.submit_eval_work_v1[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /delete from public\.(?:ph_master_inventory|ph_active_request|ph_request_history)/i);
});

test('creation and management are Dylan/Megan-only while assigned users alone save and submit', () => {
  assert.match(migration, /lower\(actor\.username\) not in \('dylan_collyge', 'megan_kelly'\)[\s\S]*eval_work_create_forbidden/);
  assert.match(migration, /lower\(work\.assignee_username\) <> lower\(actor\.username\)[\s\S]*eval_work_edit_forbidden/);
  assert.match(migration, /lower\(work\.assignee_username\) <> lower\(actor\.username\)[\s\S]*eval_work_submit_forbidden/);
  assert.match(appApi, /const EVAL_WORK_MANAGER_USERS = new Set\(\["dylan_collyge", "megan_kelly"\]\)/);
  assert.match(appApi, /Only the assigned evaluator can update this work/);
  assert.match(appApi, /resolveEvalWorkAssignee\(payload\.assigneeUsername\)/);
  assert.match(appApi, /supabase\.auth\.admin\.getUserById/);
});

test('create and submit tokens make assignment and completion idempotent', () => {
  assert.match(migration, /create_token text not null unique/);
  assert.match(migration, /where create_token = create_token_value/);
  assert.match(migration, /submission_token text/);
  assert.match(migration, /work\.status = 'submitted' and work\.submission_token = trim/);
  assert.match(migration, /on conflict \(event_key\) do update set updated_at = now\(\)/);
  assert.match(html, /createToken: `eval-create-\$\{argosInventoryTransactionState\.idempotencyToken\}`/);
  assert.match(html, /submissionToken = `eval-submit-/);
});

test('submission validates current identities and updates only exact-row evaluation evidence', () => {
  assert.match(migration, /where unique_id = work\.origin_unique_id for update/);
  assert.match(migration, /eval_work_origin_identity_conflict/);
  assert.match(migration, /eval_work_target_conflict/);
  assert.match(migration, /eval_work_settings_conflict/);
  assert.match(migration, /eval_work_photo_required/);
  assert.match(migration, /eval_work_spec_required/);
  assert.match(migration, /eval_work_loc_match_invalid/);
  assert.match(migration, /eval_work_av_note_required/);
  assert.match(migration, /photo_path[\s\S]*'eval\/' \|\| work\.id::text \|\| '\/'/);
  const updateStart = migration.indexOf('update public.ph_master_inventory set');
  const updateEnd = migration.indexOf('where unique_id = origin.unique_id;', updateStart);
  const update = migration.slice(updateStart, updateEnd);
  for (const field of ['spec =', 'match =', 'loc_match_qty =', 'av_note =', 'caliper =', 'pic_note =', 'sales_note =', 'photo_link =', 'photo_name =']) {
    assert.match(update, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(update, /priority\s*=|holdstopcode\s*=|holdstopreason\s*=|ptronhand\s*=|season\s*=/i);
  assert.match(migration, /where unique_id = origin\.unique_id/);
});

test('assignment and completion recipient paths remain strictly separated', () => {
  assert.match(migration, /'eval_work_assignment'[\s\S]*'assigneeEmail', new_work\.assignee_email/);
  assert.match(migration, /'eval_work_completion'[\s\S]*'completionRecipients', to_jsonb\(work\.completion_recipients\)/);
  assert.match(appsScript, /kind === 'assignment'[\s\S]*dedupeEmailAddresses_\(\[eventPayload\.assigneeEmail\]\)[\s\S]*dedupeEmailAddresses_\(\[eventPayload\.completionRecipients\]\)/);
  assert.match(html, /Only .* is receiving the assignment email\. Completion recipients will be emailed after submission/);
  assert.doesNotMatch(appsScript.slice(appsScript.indexOf('function handleSignedEvalWorkDelivery_'), appsScript.indexOf('function handleSignedRequestDeliveryEvent_')), /requiredRecipient|requiredRecipients|hiddenRecipient/i);
});

test('delivery worker sends Eval Work through Apps Script without request rows or push', () => {
  assert.match(worker, /\["reclass_inquiry", "eval_work_assignment", "eval_work_completion"\]\.includes\(eventType\)/);
  const routeStart = worker.indexOf('if (["reclass_inquiry", "eval_work_assignment", "eval_work_completion"]');
  const routeEnd = worker.indexOf('const rows = await loadRequestRows', routeStart);
  const route = worker.slice(routeStart, routeEnd);
  assert.match(route, /callAppsScript\(event, \[\], null\)/);
  assert.doesNotMatch(route, /sendPush|loadRequestRows/);
  assert.match(appsScript, /findSentRequestDeliveryByMessageId_/);
  assert.match(appsScript, /messageIdHeader: messageIdHeader/);
});

test('Queue exposes only authorized Eval Work and supports offline-safe editing', () => {
  assert.match(html, /id="tab-req-eval-work"/);
  assert.match(html, /if \(canUseGeneralQueue[\s\S]*if \(canSeeEvalWorkRequestTab\(\)\) categories\.push\('eval-work'\)/);
  assert.match(html, /if \(requested === 'eval-work' && canSeeEvalWorkRequestTab\(\)\) return 'eval-work'/);
  assert.match(html, /EVAL_WORK_DRAFT_STORAGE_PREFIX = 'gnc_eval_work_draft_v1:'/);
  assert.match(html, /function readEvalWorkOfflineDraftRows\(\)[\s\S]*draft\.workSnapshot/);
  assert.match(html, /workSnapshot: work \? \{ \.\.\.work \} : null/);
  assert.match(html, /Offline draft recovery is active\. Retry before submitting/);
  assert.match(html, /persistEvalWorkLocalDraft/);
  assert.match(html, /eval_work_version_conflict|code\.includes\('conflict'\)/);
  assert.match(html, /class="eval-work-action-tray"/);
  assert.match(html, /Save Draft/);
  assert.match(html, /Submit/);
});

test('assigned sales reps can use only the ownership-checked Eval photo scope', () => {
  assert.match(appApi, /REP_ALLOWED_PHOTO_PREFIXES = new Set\(\["req-", "credit-", "eval-"\]\)/);
  assert.match(appApi, /prefix === "eval-"[\s\S]*loadAuthorizedEvalWork\(session, evalWorkId\)/);
  assert.match(appApi, /normalizeUsername\(row\.assignee_username\) !== actor/);
  assert.match(appApi, /String\(row\.origin_unique_id \|\| ""\) !== originUid/);
  assert.match(appApi, /`eval\/\$\{evalWorkId\}\/\$\{fileName\}`/);
});

test('Review setup is manager-only, searchable, explicit, and supports blank inquiries', () => {
  assert.match(html, /Email Item Inquiry/);
  assert.match(html, /Send as Review/);
  assert.match(html, /isEvalWorkManagerUser/);
  assert.match(html, /list="eval-work-setup-assignee-options"/);
  assert.match(html, /chooseEvalWorkCompletionRecipients/);
  assert.match(html, /completionRecipients: recipients/);
  assert.match(html, /proposalCount/);
  assert.match(html, /requestActions: \[\], holdStopProposals: \[\]/);
});

test('completed PDF reuses the Reclass report and adds compact evidence once', () => {
  assert.match(appsScript, /function buildEvalWorkReportModel_/);
  assert.match(appsScript, /fetchReclassInquiryItemRows_/);
  assert.match(appsScript, /buildReclassInquiryReportModel_/);
  assert.match(appsScript, /model\.evaluationResults/);
  assert.match(appsScript, /<div class="section-title">Evaluation Results<\/div>/);
  assert.match(appsScript, /evidence\.photos\.slice\(0, 8\)/);
  assert.match(appsScript, /sortReclassInquiryCompactRows_/);
  assert.match(appsScript, /edited-cell/);
});
