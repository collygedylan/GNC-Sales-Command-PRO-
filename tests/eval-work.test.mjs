import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260827005258_eval_work_v1.sql', import.meta.url), 'utf8');
const batchMigration = readFileSync(new URL('../supabase/migrations/20260827161513_eval_work_create_batch_v1.sql', import.meta.url), 'utf8');
const multiAssigneeMigration = readFileSync(new URL('../supabase/migrations/20260831030457_eval_work_multi_assignee_v1.sql', import.meta.url), 'utf8');
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

test('legacy creation remains Dylan/Megan while V2 management adds JD and every selected evaluator can work', () => {
  assert.match(migration, /lower\(actor\.username\) not in \('dylan_collyge', 'megan_kelly'\)[\s\S]*eval_work_create_forbidden/);
  assert.match(migration, /lower\(work\.assignee_username\) <> lower\(actor\.username\)[\s\S]*eval_work_edit_forbidden/);
  assert.match(migration, /lower\(work\.assignee_username\) <> lower\(actor\.username\)[\s\S]*eval_work_submit_forbidden/);
  assert.match(appApi, /const EVAL_WORK_MANAGER_USERS = new Set\(\["dylan_collyge", "megan_kelly", "jd_jones"\]\)/);
  assert.match(appApi, /Only an assigned evaluator can update this work/);
  assert.match(appApi, /resolveEvalWorkAssignees\(payload\.assigneeUsernames \|\| payload\.assigneeUsername\)/);
  assert.match(appApi, /query = query\.contains\("assignee_usernames", \[actor\]\)/);
  assert.match(appApi, /isEvalWorkAssignedTo\(row, actor\)/);
  assert.match(appApi, /supabase\.auth\.admin\.getUserById/);
  assert.match(multiAssigneeMigration, /assignee_usernames text\[\] not null/);
  assert.match(multiAssigneeMigration, /lower\(\(private\.current_active_profile\(\)\)\.username\) = any\(assignee_usernames\)/);
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
  assert.match(appsScript, /kind === 'assignment'[\s\S]*eventPayload\.assignmentRecipients \|\| eventPayload\.assigneeEmail[\s\S]*eventPayload\.completionRecipients/);
  assert.match(html, /evaluator.*will receive the assignment email\. Completion recipients will be emailed after submission/);
  assert.match(multiAssigneeMigration, /'assignmentRecipients', to_jsonb\(assignment_recipients\)/);
  assert.doesNotMatch(appsScript.slice(appsScript.indexOf('function handleSignedEvalWorkDelivery_'), appsScript.indexOf('function handleSignedRequestDeliveryEvent_')), /requiredRecipient|requiredRecipients|hiddenRecipient/i);
});

test('delivery worker sends Eval Work through Apps Script without request rows or push', () => {
  assert.match(worker, /\["reclass_inquiry", "eval_work_assignment", "eval_work_completion", "shear_location_inquiry"\]\.includes\(eventType\)/);
  const routeStart = worker.indexOf('if (["reclass_inquiry", "eval_work_assignment", "eval_work_completion", "shear_location_inquiry"]');
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
  const detailBlock = html.slice(html.indexOf('function renderEvalWorkDetail'), html.indexOf('function getEvalWorkOriginEntries'));
  assert.doesNotMatch(detailBlock, /eval-work-action-tray|Save Draft|> Submit</);
  assert.match(html, /function scheduleEvalWorkServerDraftSync\(delay = 900\)/);
  assert.match(html, /function syncEvalWorkDraftAutomatically\(\)/);
  assert.match(html, /Draft saved automatically/);
  assert.doesNotMatch(html, /getManagerEvalReport2OriginBlock/);
  assert.match(html, /function getEvalWorkOriginEntries\(work = null\)[\s\S]*snapshot\.BLOCKALPHA[\s\S]*locationParts\[1\]/);
});

test('Queue navigation is focused while Sales Reps and Delivery Recovery live in Managers', () => {
  assert.match(html, /const REQUEST_TAB_LABELS = Object\.freeze\(\{[\s\S]*pending: 'Request'[\s\S]*'suspend-tag': 'Suspend'[\s\S]*moves: 'Location Moves'[\s\S]*recount: 'Recount'[\s\S]*'shear-list': 'Shear List'[\s\S]*'eval-work': 'Eval Work'/);
  const labelsStart = html.indexOf('const REQUEST_TAB_LABELS = Object.freeze');
  const labelsEnd = html.indexOf('function getRequestTabQueueCounts', labelsStart);
  const labelsBlock = html.slice(labelsStart, labelsEnd);
  assert.doesNotMatch(labelsBlock, /Sales Reps|AV Check/);
  const categoriesStart = html.indexOf('function getAuthorizedRequestCategories');
  const categoriesEnd = html.indexOf('function renderRequestCategoryToolbar', categoriesStart);
  const categoriesBlock = html.slice(categoriesStart, categoriesEnd);
  assert.doesNotMatch(categoriesBlock, /categories\.push\('reps'\)|categories\.push\('av-check'\)/);
  assert.doesNotMatch(html, /id="tab-req-reps"|id="tab-req-av-check"|id="request-delivery-recovery-panel"/);
  assert.match(html, /const MANAGER_SALES_REPS_VIEW = 'sales-reps'/);
  assert.match(html, /const MANAGER_DELIVERY_RECOVERY_VIEW = 'delivery-recovery'/);
  assert.match(html, /if \(access\.canViewSalesReps\) tabs\.push\(\{ id: MANAGER_SALES_REPS_VIEW, label: 'Sales Reps' \}\)/);
  assert.match(html, /if \(access\.canManageDeliveryRecovery\) tabs\.push\(\{ id: MANAGER_DELIVERY_RECOVERY_VIEW, label: 'Delivery Recovery' \}\)/);
  assert.match(html, /activeHomeTab === MANAGER_DELIVERY_RECOVERY_VIEW\) html \+= renderManagerDeliveryRecoveryPanel\(\)/);
  assert.match(html, /function openManagerSalesRepsModule\(\)[\s\S]*switchView\('request', \{ managerSalesReps: true, force: true \}\)/);
  assert.match(html, /const sendToEvalHtml = ''/);
});

test('Eval Work opens the selected Queue row with exactly two top-level work tabs', () => {
  assert.match(html, /function openEvalWorkDetail\(workId = '', encodedOriginUid = ''\)[\s\S]*evalWorkActiveOriginUid = decodeURIComponent[\s\S]*evalWorkDetailView = 'pictures-specs'/);
  assert.match(html, /class="eval-work-detail-tabs"[\s\S]*Pictures &amp; Specs[\s\S]*Item Inquiry/);
  const tabsBlock = html.slice(html.indexOf('const detailTabs ='), html.indexOf('const evaluationPanel =', html.indexOf('const detailTabs =')));
  assert.equal((tabsBlock.match(/class="eval-work-detail-tab"/g) || []).length, 2);
  assert.doesNotMatch(tabsBlock, /Lot Evaluation|Loc Sales Note/);
  assert.match(html, /detailView === 'pictures-specs' \? `<section class="eval-work-evidence"/);
  assert.match(html, /detailView === 'item-inquiry' \? `<section class="eval-work-inquiry"/);
  assert.match(html, /same exact-row Pictures &amp; Specs work used by Request and Drive Mode/);
  assert.doesNotMatch(html.slice(html.indexOf('function renderEvalWorkDetail'), html.indexOf('function getEvalWorkOriginEntries')), /eval-work-origin-tabs/);
  assert.doesNotMatch(html, /Current Loc Sales Note/);
  assert.match(html, /Spec \(Size\/Dims\)/);
  assert.match(html, /function buildEvalWorkRequestDriveBaselineEvidence/);
  assert.match(html, /function filterEvalWorkAvNotes/);
  assert.match(html, /function calculateEvalWorkMatchQty/);
  assert.match(html, /function markEvalWorkPicturesSpecsDone/);
  assert.match(html, /class="eval-work-pictures-done"/);
  assert.match(html, /function collectEvalWorkEvidence\(work = null\)[\s\S]*if \(element\) return String\(element\.value/);
});

test('Item Inquiry requires every Eval Work row to be Mark Done or No Action', () => {
  assert.match(html, /function setEvalWorkInquiryRowResolution\(button = null, resolution = ''\)/);
  assert.match(html, /data-eval-row-resolution-action="done"[\s\S]*Mark Done/);
  assert.match(html, /data-eval-row-resolution-action="no_action"[\s\S]*No Action/);
  assert.match(html, /rowResolutions: new Map\(\)/);
  assert.match(html, /resolution: getEvalWorkInquiryRowResolution\(uid\)/);
  assert.match(html, /function validateEvalWorkInquiryRowResolutions\(work = null, inquiry = null\)/);
  assert.match(html, /Every Item Inquiry row must be Mark Done or No Action before sending/);
  assert.match(html, /validateEvalWorkInquiryRowResolutions\(work, inquiry\)/);
  assert.match(html, /function completeEvalWorkAfterFinalRowDecision\(\)/);
  assert.match(html, /function queueEvalWorkAutomaticCompletion\(\)/);
  assert.match(html, /progress\.remaining === 0[\s\S]*queueEvalWorkAutomaticCompletion/);
  assert.match(html, /submitEvalWork\(null, \{ automatic: true \}\)/);
  assert.match(html, /final row decision sends the completed Item Inquiry PDF to Dylan and Megan for review/);
  assert.match(html, /Item Inquiry Sent[\s\S]*completed Item Inquiry PDF are sending to Dylan and Megan for review/);
});

test('assigned sales reps can use only the ownership-checked Eval photo scope', () => {
  assert.match(appApi, /REP_ALLOWED_PHOTO_PREFIXES = new Set\(\["req-", "credit-", "eval-"\]\)/);
  assert.match(appApi, /prefix === "eval-"[\s\S]*loadAuthorizedEvalWork\(session, evalWorkId\)/);
  assert.match(appApi, /!isEvalWorkAssignedTo\(row, actor\)/);
  assert.match(appApi, /originAllowed = row[\s\S]*row\.origins[\s\S]*origin_unique_id/);
  assert.match(appApi, /evalMultiOrigin \? `eval\/\$\{evalWorkId\}\/\$\{String\(evalOriginUid\)\}\/\$\{fileName\}` : `eval\/\$\{evalWorkId\}\/\$\{fileName\}`/);
});

test('Review setup is manager-only, searchable, explicit, and supports blank inquiries', () => {
  assert.match(html, /Email Item Inquiry/);
  assert.match(html, /Send as Review/);
  assert.match(html, /isEvalWorkManagerUser/);
  assert.match(html, /id="eval-work-setup-assignee-button"[\s\S]*chooseEvalWorkAssignee/);
  assert.match(html, /function chooseEvalWorkAssignee\(\)[\s\S]*openGroupedBloomNcrRecipientModal[\s\S]*appUsersOnly: true[\s\S]*allowedUsernames: EVAL_ASSIGNMENT_ROSTER_USERS/);
  assert.doesNotMatch(html.slice(html.indexOf('async function chooseEvalWorkAssignee'), html.indexOf('async function chooseEvalWorkCompletionRecipients')), /singleSelect: true/);
  assert.match(html, /getEvalWorkAssigneesByEmails/);
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

test('Eval Reports #2 batch creation is service-only, atomic, complete-row, and retry-safe', () => {
  assert.match(batchMigration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(batchMigration, /create or replace function public\.create_eval_work_batch_v1\(p_payload jsonb\)/);
  assert.match(batchMigration, /lower\(actor\.username\) not in \('dylan_collyge', 'megan_kelly'\)/);
  assert.match(batchMigration, /Validate every member before creating any durable assignment/);
  assert.ok(batchMigration.indexOf('perform private.validate_eval_work_inquiry_v1') < batchMigration.indexOf('select * into new_work from public.create_eval_work_v1'));
  assert.match(batchMigration, /eval_work_batch_complete_row_set_required/);
  assert.match(batchMigration, /batch_token = batch_token_value/);
  assert.match(batchMigration, /revoke all on function public\.create_eval_work_batch_v1\(jsonb\) from public, anon, authenticated/);
  assert.match(batchMigration, /grant execute on function public\.create_eval_work_batch_v1\(jsonb\) to service_role/);
  assert.doesNotMatch(batchMigration, /update public\.ph_master_inventory|delete from public\./i);
  assert.match(appApi, /operation === "create_batch"/);
  assert.match(appApi, /normalizeEvalWorkBatchInquiry/);
  assert.match(appApi, /supabase\.rpc\("create_eval_work_batch_multi_v2"/);
  assert.match(appApi, /Access-Control-Allow-Headers": "[^"]*idempotency-key[^"]*"/);
  assert.match(html, /evalWorkApi\('create_batch'[\s\S]*idempotencyKey:\s*managerEvalReport2BatchSetupState\.batchToken/);
  assert.doesNotMatch(appApi, /useMultiOriginV2/);
});

test('Eval Reports #2 uses PDF Eval Work delivery and preserves temporary report overlays', () => {
  assert.match(html, /function getManagerEvalReport2AllCurrentItemRows\(itemCode = ''\)/);
  assert.match(html, /function openManagerEvalReport2BatchSetup\(\)/);
  assert.match(html, /evalWorkApi\('create_batch'/);
  assert.doesNotMatch(html, /eval_reports_2_item_inquiry_excel/);
  assert.match(html, /evalWorkTemporaryRowOverlays = new Map\(\)/);
  assert.match(html, /overlay\.temporaryChangedFields = Object\.keys\(temporaryValues\)/);
  assert.match(appsScript, /applyReclassInquiryTemporaryOverlayV3_/);
  assert.match(appsScript, /Temporary Report Edits/);
  assert.match(appsScript, /allowEmptyActions: true/);
});

test('Eval Reports #2 uses the shared searchable evaluator picker and refreshes complete Queue origins', () => {
  assert.match(html, /id="manager-eval2-batch-assignee-button"[\s\S]*chooseManagerEvalReport2BatchAssignee\(\)/);
  assert.match(html, /async function chooseManagerEvalReport2BatchAssignee\(\)[\s\S]*appUsersOnly:\s*true[\s\S]*allowedUsernames:\s*EVAL_ASSIGNMENT_ROSTER_USERS/);
  assert.match(html, /assigneeUsernames:\s*assignees\.map/);
  assert.doesNotMatch(html, /id="manager-eval2-batch-assignee"\s+list=/);
  assert.match(html, /evalWorkApi\('create_batch'[\s\S]*await loadEvalWorkAssignments\(true\)[\s\S]*Eval Work Queued/);
});

test('Eval picker supports multiple roster users and labels Kayla and JD as honorary evaluators', () => {
  assert.match(html, /const EVAL_ASSIGNMENT_HONORARY_USERS = Object\.freeze\(\['kayla_knepp', 'jd_jones'\]\)/);
  assert.match(html, /role: honorary\.has[\s\S]*'Honorary Eval User'/);
  assert.match(html, /title: 'Reassign Eval Work'[\s\S]*allowedUsernames: EVAL_ASSIGNMENT_ROSTER_USERS/);
  assert.match(appApi, /"kayla_knepp", "jd_jones"/);
  assert.match(multiAssigneeMigration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(multiAssigneeMigration, /create or replace function public\.reassign_eval_work_v2\(p_payload jsonb\)/);
  assert.match(multiAssigneeMigration, /revoke all on function public\.reassign_eval_work_v2\(jsonb\) from public, anon, authenticated/);
  assert.match(multiAssigneeMigration, /grant execute on function public\.reassign_eval_work_v2\(jsonb\) to service_role/);
});
