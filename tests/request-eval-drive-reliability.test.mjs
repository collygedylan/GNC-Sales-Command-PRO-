import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260831210000_request_eval_drive_reliability_repair.sql');
const currentMembershipHealth = read('../supabase/migrations/20260902165500_current_request_membership_health.sql');
const html = read('../index.html');
const appApi = read('../supabase/functions/app-api/index.ts');
const observability = read('../supabase/functions/_shared/observability.ts');
const performanceWorkflow = read('../.github/workflows/performance-monitor.yml');
const sqlTest = read('../supabase/tests/request_eval_drive_reliability_test.sql');

test('folder completion recovery binds the unnested request id and is service-only', () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /from unnest\(request_ids\) as active_request\(request_id\)/);
  assert.match(migration, /created\.payload->'request_ids'[\s\S]*\? active_request\.request_id/);
  assert.match(migration, /create or replace function public\.reconcile_request_folder_completion_window_v2/);
  assert.match(migration, /p_to - p_from > interval '8 days'/);
  assert.match(migration, /not private\.is_service_role_request\(\)/);
  assert.match(migration, /grant execute on function public\.reconcile_request_folder_completion_window_v2[\s\S]*to service_role/);
  assert.match(migration, /missing_completion_event_count/);
  assert.match(performanceWorkflow, /20260831210000_request_eval_drive_reliability_repair\.sql/);
  assert.match(performanceWorkflow, /request_eval_drive_reliability_test\.sql/);
  assert.match(performanceWorkflow, /request_eval_drive_reliability_baseline\.sql/);
  assert.match(sqlTest, /pg_advisory_xact_lock/);
  assert.doesNotMatch(migration, /delete from public\.ph_active_request|delete from public\.ph_request_history/i);
});

test('delivery health checks the latest completion only for currently complete folders', () => {
  assert.match(currentMembershipHealth, /^begin;[\s\S]*commit;\s*$/);
  assert.match(currentMembershipHealth, /select distinct on \(completion\.request_folder\)/);
  assert.match(currentMembershipHealth, /order by completion\.request_folder, completion\.created_at desc, completion\.event_id desc/);
  assert.match(currentMembershipHealth, /where active\.all_complete/);
  assert.match(currentMembershipHealth, /completion_membership_mismatch_count/);
  assert.match(currentMembershipHealth, /grant execute on function public\.get_eval_request_delivery_health_snapshot_v2\(\)[\s\S]*to service_role/);
  assert.match(performanceWorkflow, /20260902165500_current_request_membership_health\.sql/);
});

test('Eval Work accepts advisory assignment drift but retains current server filtering', () => {
  const create = migration.slice(
    migration.indexOf('create or replace function public.create_eval_work_batch_v2'),
    migration.indexOf('-- Drive evidence is canonical')
  );
  assert.match(create, /matched_users := private\.eval_work_match_assignment_users_v1/);
  assert.doesNotMatch(create, /hinted_users is distinct from matched_users then[\s\S]*raise exception/);
  assert.match(create, /assignment_refreshed := cardinality\(hinted_users\) > 0/);
  assert.match(create, /'assignmentRefreshed', assignment_refreshed/);
  assert.match(appApi, /assignmentRefreshed/);
  assert.match(appApi, /current AssignedTo value no longer matches the selected user filter/);
  assert.match(observability, /source\.code \|\| messageToken/);
  assert.doesNotMatch(observability, /String\(value instanceof Error \? value\.name : value/);
});

test('Drive evidence save is canonical, linked, timestamped, idempotent, and read back', () => {
  const save = migration.slice(
    migration.indexOf('create or replace function public.save_drive_evidence_v1'),
    migration.indexOf('create or replace function public.get_request_drive_evidence_health_snapshot_v1')
  );
  assert.match(save, /where unique_id = btrim\(p_master_uid\) for update/);
  assert.match(save, /av_rule_bundle_updated_at = case/);
  assert.match(save, /req_spec = v_saved\.spec/);
  assert.match(save, /req_photo_link = v_saved\.photo_link/);
  assert.match(save, /returning request\.\*/);
  assert.match(save, /'requestRows', v_request_rows/);
  assert.match(save, /'canonicalConfirmed', true/);
  assert.match(save, /drive_evidence_idempotency/);
  assert.match(migration, /get_request_drive_evidence_health_snapshot_v1/);
  assert.match(migration, /repair_request_drive_evidence_v1/);
  assert.match(migration, /skipped_newer_count/);
  assert.match(html, /DRIVE_SAVE_READBACK_UNCONFIRMED/);
  assert.match(html, /discardPendingLocalEdits\(\[itemToSave\.UNIQUE_ID\], true\)/);
  assert.match(html, /canonicalRequestRows/);
});

test('AV choices wait for click and Request rendering gets a bounded settle retry', () => {
  assert.doesNotMatch(html, /addEventListener\('pointerdown', handleAvNoteOptionPressStart/);
  assert.doesNotMatch(html, /addEventListener\('touchstart', handleAvNoteOptionPressStart/);
  assert.match(html, /request-av-note-sheet #req-av-dropdown-list\{[\s\S]*overflow-y:auto!important[\s\S]*touch-action:pan-y!important/);
  assert.match(html, /body\.request-av-note-sheet-open #main-scroll-area\{[\s\S]*touch-action:pan-y!important/);
  assert.match(html, /verifyRequestDetailRendered\(reason = '', attempt = 0\)/);
  assert.match(html, /render-verify-retry/);
  assert.match(html, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => verifyRequestDetailRendered/);
});

test('Request reuse separates reusable evidence from auto-completion and requires an explicit choice', () => {
  const reusableData = html.slice(
    html.indexOf('function getEmptyRequestReusableData()'),
    html.indexOf('function dismissSearchKeyboard(')
  );
  assert.match(reusableData, /hasReusableEvidence:\s*false/);
  assert.match(reusableData, /readyForAutoComplete:\s*false/);
  assert.match(reusableData, /const hasReusableSupportingData = !!\(avNote \|\| spec \|\| caliper \|\| pick \|\| match\)/);
  assert.match(reusableData, /const sharedSpec = getMeasuredSpecInputValue\(item\)/);
  assert.match(reusableData, /const hasReusableEvidence = !!photoLink && hasReusableSupportingData/);
  assert.match(reusableData, /const readyForAutoComplete = isReadyRequestDataForAutoComplete/);
  assert.match(reusableData, /if \(!reusable\.hasReusableEvidence\) return ''/);
  assert.match(reusableData, /Choose how to start this request/);
  assert.match(reusableData, /Use Saved Pictures &amp; Data/);
  assert.match(reusableData, /Start Request Blank/);
  assert.doesNotMatch(reusableData, /selectedValue = 'YES'/);

  assert.match(html, /collect\('\.item-reuse-data-input', 'reuse'\)/);
  assert.match(html, /if \(!requireCurrentRequestReuseDecision\(\)\) return true/);
  assert.match(html, /const missingReuseEntry = requestSourceEntries\.find/);
  assert.match(html, /const useExistingData=reuseChoice==='YES' && reusable\.hasReusableEvidence/);
  assert.match(html, /const autoCompleteEligible = useExistingData && reusable\.readyForAutoComplete/);
  assert.match(html, /reusableRequestData\.hasReusableEvidence/);
  assert.doesNotMatch(html, /reusable(?:RequestData)?\.hasData/);
});

test('Request reuse behavior accepts photo plus N/A Spec while keeping a missing-AV-note row pending', () => {
  const reusableDataSource = html.slice(
    html.indexOf('function getEmptyRequestReusableData()'),
    html.indexOf('function dismissSearchKeyboard(')
  );
  const context = {
    firstNonEmptyValue: (...values) => values.find((value) => value !== undefined && value !== null && String(value) !== '') ?? '',
    isRequestOwnedPhotoRow: () => false,
    shouldHideSharedAppPayloadForInvalidAvRules: (item) => Boolean(item.INVALID),
    getItemDisplayValue: (item, key) => item[key] ?? '',
    getMeasuredSpecInputValue: (item) => String(item.SPEC || ''),
    getSharedAppPhotoLinkCsv: (item) => item.EXPIRED ? '' : String(item.SAVED_PHOTO_LINK || ''),
    getSharedAppPhotoName: (item) => String(item.SAVED_PHOTO_NAME || ''),
    filterPhotoCsvByRetention: (csv, item) => item.EXPIRED ? '' : String(csv || ''),
    mergePhotoCsvList: (values) => [...new Set((Array.isArray(values) ? values : [values]).filter(Boolean))].join(','),
    getRequestPhotoLinkCsv: () => '',
    getRequestResolvedPickNoteValue: () => '',
    parseLocMatchPercent: (value) => {
      const parsed = Number(String(value ?? '').trim());
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
    },
    requiresAvNoteForCompletion: () => true,
    getMasterInventorySourceCode: (item) => item.SOURCE || '',
    esc: (value) => String(value ?? ''),
  };
  vm.createContext(context);
  vm.runInContext(reusableDataSource, context);

  const row = {
    SOURCE_TABLE: 'ph_master_inventory',
    ITEMCODE: '007850.031.1',
    LOCATIONCODE: 'A.06.000',
    LOTCODE: '27.S1',
    SOURCE: 'LD',
    CONTSIZE: '3DP',
    SAVED_PHOTO_LINK: 'https://example.test/photo.jpg',
    SAVED_PHOTO_NAME: 'photo 9/2/26',
    SPEC: 'N/A',
    MATCH: '50',
  };
  const partial = context.getRequestReusableData(row);
  assert.equal(partial.hasReusableEvidence, true);
  assert.equal(partial.readyForAutoComplete, false);
  assert.equal(partial.spec, 'N/A');
  assert.equal(partial.match, '50');

  const complete = context.getRequestReusableData({ ...row, AV_NOTE: 'Current valid row' });
  assert.equal(complete.hasReusableEvidence, true);
  assert.equal(complete.readyForAutoComplete, true);
  assert.equal(context.getRequestReusableData({ ...row, SPEC: '', ITEMSPEC: 'CATALOG SPEC', MATCH: '' }).hasReusableEvidence, false);
  assert.equal(context.getRequestReusableData({ ...row, EXPIRED: true }).hasReusableEvidence, false);
  assert.equal(context.getRequestReusableData({ ...row, INVALID: true }).hasReusableEvidence, false);
  assert.equal(context.isSameRequestReusableRow(row, { ...row }), true);
  assert.equal(context.isSameRequestReusableRow(row, { ...row, LOTCODE: '27.F1' }), false);
  assert.equal(context.isSameRequestReusableRow(row, { ...row, LOCATIONCODE: 'D.14.000' }), false);
  assert.equal(context.isSameRequestReusableRow(row, { ...row, SOURCE: 'NC' }), false);
  assert.equal(context.isSameRequestReusableRow(row, { ...row, CONTSIZE: '#1' }), false);

  const prompt = context.buildRequestReusePromptHtml(row, 'row-id', '');
  assert.match(prompt, /value="" selected disabled/);
  assert.match(prompt, /Use Saved Pictures &amp; Data/);
  assert.match(prompt, /Start Request Blank/);
});
