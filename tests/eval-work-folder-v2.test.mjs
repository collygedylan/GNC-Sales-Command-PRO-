import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260828213612_multi_origin_eval_work_folder_completion_v2.sql');
const itemcodeMigration = read('../supabase/migrations/20260829042809_itemcode_wide_eval_work.sql');
const resolutionMigration = read('../supabase/migrations/20260830213039_eval_work_item_inquiry_row_resolution_v3.sql');
const parityMigration = read('../supabase/migrations/20260831004047_eval_work_request_drive_parity.sql');
const appApi = read('../supabase/functions/app-api/index.ts');
const worker = read('../supabase/functions/request-delivery-worker/index.ts');
const html = read('../index.html');
const appsScript = read('../Code.gs');

test('multi-origin Eval Work storage is append-only, service-owned, and V1 compatible', () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /contract_version in \('eval-work-v1', 'eval-work-v2-multi-origin'\)/);
  assert.match(migration, /create table if not exists public\.ph_eval_work_origin_rows/);
  assert.match(migration, /primary key \(eval_work_id, origin_unique_id\)/);
  assert.match(migration, /alter table public\.ph_eval_work_origin_rows enable row level security/);
  assert.match(migration, /revoke all on table public\.ph_eval_work_origin_rows from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.ph_eval_work_origin_rows to service_role/);
  assert.match(migration, /origin_unique_id, itemcode, locationcode, lotcode, source/);
  assert.match(migration, /first_origin\.unique_id[\s\S]*origin_count/);
});

test('ITEMCODE batch creation derives all rows, expands cached hints, and is retry-safe', () => {
  assert.match(itemcodeMigration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(itemcodeMigration, /create or replace function public\.create_eval_work_batch_v2/);
  assert.match(itemcodeMigration, /private\.eval_work_itemcode_context_rows_v1\(item->>'itemcode'\)/);
  assert.match(itemcodeMigration, /jsonb_array_length\(context_rows\) > 100/);
  assert.match(itemcodeMigration, /private\.eval_work_expand_inquiry_rows_v1/);
  assert.match(itemcodeMigration, /'scopeContract', 'itemcode-all-rows-v1'/);
  assert.match(itemcodeMigration, /'membershipSignature', membership_signature/);
  assert.match(itemcodeMigration, /matchedAssignedToUsers/);
  assert.match(itemcodeMigration, /where create_token = create_token_value/);
  assert.match(itemcodeMigration, /return next work;[\s\S]*continue;/);
  assert.match(itemcodeMigration, /create or replace function public\.get_eval_itemcode_work_health_snapshot_v1/);
  assert.match(itemcodeMigration, /stored_membership_mismatch_count/);
  assert.match(itemcodeMigration, /pdf_origin_mismatch_count/);
  assert.match(itemcodeMigration, /excel_attachment_violation_count/);
  assert.match(itemcodeMigration, /grant execute on function public\.get_eval_itemcode_work_health_snapshot_v1\(\) to service_role/);
  const setup = html.slice(html.indexOf('function ensureManagerEvalReport2BatchSetupModal'), html.indexOf('function closeManagerEvalReport2BatchSetup'));
  assert.doesNotMatch(setup, /Select All Lots|Clear Lots|Select All Shown|Block Alpha|Block Number|Location\/Lot/);
  assert.match(setup, /Every current row for each selected ITEMCODE is included in Eval Work and the PDF/);
  assert.match(html, /getManagerEvalReport2AllCurrentItemRows\(entry\.itemCode\)/);
  assert.match(html, /selectedUserFilters/);
  assert.match(html, /matchedAssignedToUsers/);
});

test('assignment and completion delivery visibly includes required managers and PDF-only selected origins', () => {
  assert.match(migration, /required_recipients := private\.eval_work_required_manager_emails_v2\(\)/);
  assert.match(migration, /assignment_recipients[\s\S]*required_recipients[\s\S]*assigneeEmail/);
  assert.match(migration, /completion_recipients[\s\S]*required_recipients[\s\S]*extra_recipients/);
  assert.match(migration, /'lockedManagerRecipients', jsonb_build_array\('dylan_collyge', 'megan_kelly'\)/);
  assert.match(html, /Assignment email[\s\S]*Evaluator[\s\S]*Dylan[\s\S]*Megan/);
  assert.match(html, /Dylan and Megan are always included/);
  assert.match(appsScript, /eventPayload\.assignmentRecipients \|\| eventPayload\.assigneeEmail/);
  assert.match(appsScript, /selectedOrigins[\s\S]*authoritativeRows = selectedOrigins\.length \? selectedOrigins\.map/);
  assert.match(appsScript, /model\.evaluationResultsRows = selectedOrigins\.map/);
  assert.match(appsScript, /validate_eval_work_delivery_v1/);
  assert.match(appsScript, /ITEMCODE_MEMBERSHIP_CHANGED/);
  assert.doesNotMatch(appsScript.slice(appsScript.indexOf('function handleSignedEvalWorkDelivery_'), appsScript.indexOf('function handleSignedRequestDeliveryEvent_')), /Excel|xlsx/i);
});

test('every origin has isolated evidence and exact-row photo scope', () => {
  assert.match(migration, /eval_work_all_origin_evidence_required/);
  assert.match(migration, /for origin_row in select \* from public\.ph_eval_work_origin_rows/);
  for (const code of ['eval_work_photo_required', 'eval_work_spec_required', 'eval_work_loc_match_invalid', 'eval_work_av_note_required']) {
    assert.match(migration, new RegExp(code));
  }
  assert.match(migration, /'eval\/' \|\| work\.id::text \|\| '\/' \|\| origin_row\.origin_unique_id \|\| '\/'/);
  const exactUpdate = migration.slice(migration.indexOf('update public.ph_master_inventory set'), migration.indexOf('where unique_id = origin.unique_id;') + 36);
  assert.match(exactUpdate, /spec = spec_value/);
  assert.match(exactUpdate, /where unique_id = origin\.unique_id/);
  assert.doesNotMatch(exactUpdate, /priority\s*=|holdstopcode\s*=|holdstopreason\s*=|ptronhand\s*=|season\s*=/i);
  assert.match(appApi, /p_evidence_by_origin: evidence/);
  assert.match(appApi, /requiredPrefix = isV2 \? `eval\/\$\{workId\}\/\$\{originUid\}\//);
  assert.match(html, /same exact-row Pictures &amp; Specs work used by Request and Drive Mode/);
  assert.match(html, /class="eval-work-detail-tabs"[\s\S]*Pictures &amp; Specs[\s\S]*Item Inquiry/);
  assert.doesNotMatch(html.slice(html.indexOf('const detailTabs ='), html.indexOf('const evaluationPanel =', html.indexOf('const detailTabs ='))), /Loc Sales Note/);
  assert.match(html, /requiredEvidence\.forEach/);
  assert.match(html, /picturesSpecsResolution/);
  assert.match(html, /markEvalWorkPicturesSpecsDone/);
});

test('Eval Work completion uses the Request and Drive Mode row contract transactionally', () => {
  assert.match(parityMigration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(parityMigration, /create or replace function private\.eval_work_apply_request_drive_parity_v1/);
  assert.match(parityMigration, /eval_work_all_pictures_specs_mark_done_required/);
  assert.match(parityMigration, /date_completed = completed_at/);
  assert.match(parityMigration, /av_rule_bundle_updated_at = completed_at/);
  assert.match(parityMigration, /av_rule_priority_snapshot = m\.priority/);
  assert.match(parityMigration, /create or replace function private\.eval_work_safe_numeric_v1/);
  assert.match(parityMigration, /create or replace function private\.eval_work_normalized_sales_year_v1/);
  assert.match(parityMigration, /app_tab_assignment = case[\s\S]*then 'endcap'[\s\S]*when m\.unique_id = winner_id then 'season'[\s\S]*else 'location'/);
  assert.match(parityMigration, /not like 'ncr\\_%' escape '\\'/);
  assert.match(parityMigration, /not_on_inventory_dylan/);
  assert.match(parityMigration, /insert into public\.ph_sales_office/);
  assert.match(parityMigration, /on conflict \(unique_id\) do update/);
  assert.match(parityMigration, /perform private\.eval_work_apply_request_drive_parity_v1/);
  assert.match(parityMigration, /revoke all on function private\.eval_work_apply_request_drive_parity_v1[\s\S]*from public, anon, authenticated/);
  assert.match(parityMigration, /grant execute on function public\.submit_eval_work_v2[\s\S]*to service_role/);
});

test('Queue shows every origin as a Request-style row card while opening one shared assignment', () => {
  assert.match(html, /function getEvalWorkOriginEntries/);
  assert.match(html, /function buildEvalWorkQueueOriginDisplayItem/);
  assert.match(html, /rows\.flatMap\(\(row\) => getEvalWorkOriginEntries\(row\)\.map/);
  assert.match(html, /sourceView === 'eval-work'/);
  assert.match(html, /data-eval-work-origin-row="true"/);
  assert.match(html, /app-request-card-surface/);
  assert.match(html, /openEvalWorkDetail\('\$\{safeWorkId\}','\$\{safeOriginUid\}'\)/);
  assert.match(html, /evalWorkActiveOriginUid/);
  assert.match(html, /evidenceByOrigin/);
});

test('submission requires one explicit Item Inquiry resolution per origin and locks manager recipients', () => {
  assert.match(resolutionMigration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(resolutionMigration, /create or replace function private\.enforce_eval_work_row_resolution_v3\(\)/);
  assert.match(resolutionMigration, /jsonb_array_length\(overlays\) <> new\.origin_count/);
  assert.match(resolutionMigration, /overlay_matches <> 1/);
  assert.match(resolutionMigration, /resolution_value not in \('done', 'no_action'\)/);
  assert.match(resolutionMigration, /eval_work_all_rows_resolution_required/);
  assert.match(resolutionMigration, /eval_work_no_action_has_proposals/);
  assert.match(resolutionMigration, /required_recipients := private\.eval_work_required_manager_emails_v2\(\)/);
  assert.match(resolutionMigration, /into new\.completion_recipients/);
  assert.match(resolutionMigration, /before update of status on public\.ph_eval_work/);
  assert.match(resolutionMigration, /revoke all on function private\.enforce_eval_work_row_resolution_v3\(\)[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(resolutionMigration, /delete from|update public\.ph_master_inventory/i);
});

test('folder completion V2 waits for creation, revalidates membership, and sends one full-folder event', () => {
  assert.match(migration, /create table if not exists private\.ph_request_folder_delivery_state/);
  assert.match(migration, /membership_version = membership_version \+ 1/);
  assert.match(migration, /request-folder-completed:[\s\S]*membership_version/);
  assert.match(migration, /'activeRequestIds', to_jsonb\(request_ids\)/);
  assert.match(migration, /waiting_for_request_created_event/);
  assert.match(migration, /dependencyEventKeys/);
  assert.match(migration, /created\.status <> 'delivered'/);
  assert.match(migration, /FOLDER_COMPLETION_STALE/);
  assert.match(migration, /FOLDER_MEMBERSHIP_SUPERSEDED/);
  assert.match(migration, /'updatedCompletion', state_row\.last_delivered_version > 0/);
  assert.match(migration, /route_legacy_request_completion_v2/);
  assert.doesNotMatch(migration, /insert into public\.ph_request_history|update public\.ph_active_request set/i);
});

test('delivery worker gates folder completion before loading or emailing rows', () => {
  const gate = worker.indexOf('if (isFolderCompletionV2(event))');
  const load = worker.indexOf('const rows = await loadRequestRows(event)', gate);
  assert.ok(gate > 0 && load > gate);
  assert.match(worker.slice(gate, load), /prepareFolderCompletionV2/);
  assert.match(worker.slice(gate, load), /readiness\.ready !== true/);
  assert.match(worker, /acknowledgeFolderCompletionV2/);
  assert.match(appsScript, /Updated Plant Request Completion/);
  assert.match(appsScript, /Updated Completion -/);
});
