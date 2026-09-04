import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260903171416_repair_season_sales_office_custom_av_staging.sql');
const accessMigration = read('../supabase/migrations/20260903193349_enforce_season_sales_note_users_and_drive_drill.sql');
const api = read('../supabase/functions/app-api/index.ts');
const html = read('../index.html');
const appsScript = read('../Code.gs');
const workflow = read('../.github/workflows/performance-monitor.yml');
const ciSalesOfficeBaseline = read('../supabase/ci/sales_office_baseline.sql');
const evalHealthV2 = read('../supabase/migrations/20260903190000_baseline_eval_itemcode_delivery_health_v2.sql');
const productionProbe = read('../scripts/probe-production-auth-health.mjs');

const sliceBetween = (source, startText, endText) => {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + startText.length);
  assert.ok(start >= 0, `missing ${startText}`);
  return source.slice(start, end >= 0 ? end : start + 16000);
};

test('Season Sales Notes reconciliation is scoped, deterministic, and independent of evidence completeness', () => {
  assert.match(migration, /lower\(btrim\(coalesce\(m\.app_tab_assignment, ''\)\)\) in \('season', 'location'\)/i);
  assert.match(migration, /row_number\(\) over \([\s\S]*partition by upper\(btrim\(m\.itemcode\)\)[\s\S]*ptravailable\), -1\) desc[\s\S]*priority[\s\S]*locationcode[\s\S]*lotcode[\s\S]*unique_id/i);
  assert.match(migration, /upper\(coalesce\(m\.holdstopcode, ''\)\) !~ '\[HS\]'/i);
  assert.match(migration, /set app_tab_assignment = case when winner_key\.unique_id = m\.unique_id then 'season' else 'location' end/i);
  assert.match(migration, /ph_sales_office is the open-work mirror only[\s\S]*state\.status = 'open'/i);
  const baseCandidate = sliceBetween(html, 'function isMasterSeasonWinnerBaseCandidate', 'function isOpenMasterSeasonCandidate');
  const picker = sliceBetween(html, 'function pickSeasonWinnerCandidate', 'function assignSeasonWinnersForItemGroups');
  assert.match(baseCandidate, /hasBlockingHoldStopCodeForAv/);
  assert.doesNotMatch(baseCandidate, /hasValidSeasonWinnerPayload|photo|av_note|loc_match_qty/i);
  assert.match(picker, /isMasterSeasonWinnerBaseCandidate/);
  assert.doesNotMatch(picker, /pickStableSeasonWinnerCandidate/);
});

test('open staging has durable revisioned state and append-only audit while browser writes stay denied', () => {
  assert.match(migration, /create table if not exists public\.ph_season_sales_office_state/i);
  assert.match(migration, /status text not null default 'open'.*'open', 'done', 'retired'/i);
  assert.match(migration, /create table if not exists public\.ph_season_sales_office_events/i);
  assert.match(migration, /ph_season_sales_office_events_append_only[\s\S]*before update or delete/i);
  assert.match(migration, /revoke all on table public\.ph_season_sales_office_state from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.reconcile_season_sales_office_v1[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.reconcile_season_sales_office_v1[\s\S]*to service_role/i);
  assert.match(migration, /workflow_status[\s\S]*workflow_detail[\s\S]*state_revision[\s\S]*source_revision/i);
});

test('Done records the Custom AV watermark and reopens only for later authoritative changes', () => {
  assert.match(migration, /cav_watermark = watermark/i);
  assert.match(migration, /completed_evidence_snapshot = evidence/i);
  assert.match(migration, /c\.last_updated > coalesce\(state_row\.cav_watermark, state_row\.completed_at/i);
  assert.match(migration, /reopen_reason_value := 'cav_blank'/i);
  assert.match(migration, /av_rule_last_cleared_at[\s\S]*reopen_reason_value := 'evidence_invalid'/i);
  assert.match(migration, /evidence_ready_seen_after_completion[\s\S]*not coalesce\(\(evidence->>'ready'\)::boolean, false\)/i);
  assert.match(migration, /winner_unique_id <> winner\.unique_id[\s\S]*status = 'open'/i);
  assert.match(migration, /delete from public\.ph_sales_office[\s\S]*'season'/i);
});

test('AV Note save, Done, and refresh run through authenticated protected API operations', () => {
  assert.match(api, /async function handleSeasonSalesOfficeAction/);
  assert.match(api, /resolveActiveSessionProfile/);
  assert.match(api, /supabase\.rpc\("save_season_sales_office_av_note_v1"/);
  assert.match(api, /supabase\.rpc\("complete_season_sales_office_v1"/);
  assert.match(api, /supabase\.rpc\("refresh_season_sales_office_v1"/);
  assert.match(api, /p_actor_username: actorUsername/);
  assert.match(api, /if \(action === "season_sales_office"\)/);
  const saveBlock = sliceBetween(html, 'async function saveSalesOfficeAvNote', 'function removeSalesOfficeRowByUniqueId');
  const completeBlock = sliceBetween(html, 'async function markSalesOfficeComplete', 'function getSalesOfficeOrderSpecialStage');
  const syncBlock = sliceBetween(html, 'function syncSeasonSalesOfficeStateForItemCodes', 'function syncSeasonSalesOfficeAfterSeasonDataSave');
  assert.match(saveBlock, /seasonSalesOfficeApi\('save_av_note'/);
  assert.match(completeBlock, /seasonSalesOfficeApi\('complete'/);
  assert.match(syncBlock, /seasonSalesOfficeApi\('refresh'/);
  assert.doesNotMatch(syncBlock, /supabaseFetch\('ph_sales_office'/);
});

test('manager-controlled AV users are authoritative for Season Sales Note entry', () => {
  assert.match(accessMigration, /av_blanks_photo_bypass_users/);
  assert.match(accessMigration, /dylan_collyge'[\s\S]*'kayla_knepp'[\s\S]*'morgan_anderson'/);
  assert.match(accessMigration, /create or replace function private\.season_sales_note_allowed_usernames_v1/);
  assert.match(accessMigration, /SEASON_SALES_USER_NOT_ASSIGNED/);
  assert.match(accessMigration, /manager\.av_blanks_bypass\.manage/);
  assert.match(accessMigration, /create or replace function public\.save_season_sales_note_users_v1/);
  assert.match(accessMigration, /revoke all on function public\.save_season_sales_note_users_v1[\s\S]*grant execute[\s\S]*to service_role/);
  assert.match(api, /operation === "access"[\s\S]*get_season_sales_note_access_v1/);
  assert.match(api, /operation === "save_users"[\s\S]*save_season_sales_note_users_v1/);
  const settingsSave = sliceBetween(html, 'async function saveAvBlanksPhotoBypassSettingsToRemote', 'function canManageAvBlanksPhotoBypassSettings');
  assert.match(settingsSave, /seasonSalesOfficeApi\('save_users'/);
  assert.doesNotMatch(settingsSave, /rest\/v1|Authorization': 'Bearer ' \+ SUPABASE_KEY/);
  assert.match(html, /Read only — not assigned for Season Sales Note entry/);
});

test('every committed canonical import and scheduled maintenance invoke the service reconciliation', () => {
  assert.match(appsScript, /function reconcileSeasonSalesOfficeAfterImport_/);
  assert.match(appsScript, /callSupabaseRpc_\('reconcile_season_sales_office_v1'/);
  assert.match(appsScript, /afterCommit: function\(context\)[\s\S]*reconcileSeasonSalesOfficeAfterImport_/);
  assert.match(appsScript, /if \(!anySiteRows\)[\s\S]*reconcileSeasonSalesOfficeAfterImport_\(syncStartTime, 'master_inventory'\)/);
  assert.match(appsScript, /if \(isMasterInventoryTable_\(tableName\)\)[\s\S]*reconcileSeasonSalesOfficeAfterImport_\(syncStartTime, 'master_inventory'\)/);
  assert.match(appsScript, /runRequestIntegrityScheduledWorker_[\s\S]*seasonSalesOffice = reconcileSeasonSalesOfficeAfterImport_/);
});

test('Sales Office surfaces readiness and the release is activated as one shell build', () => {
  assert.match(html, /Ready for Custom AV/);
  assert.match(html, /Needs Photo\/Data/);
  assert.match(html, /Reopened — CAV Blank/);
  assert.match(html, /Reopened — Evidence Invalid/);
  assert.match(html, /V2026\.09\.04\.01/);
});

test('hosted database checks reproduce the protected legacy Sales Office dependency', () => {
  assert.match(workflow, /sales_office_baseline\.sql/);
  assert.match(ciSalesOfficeBaseline, /create table if not exists public\.ph_sales_office/i);
  assert.match(ciSalesOfficeBaseline, /alter table public\.ph_sales_office enable row level security/i);
  assert.match(ciSalesOfficeBaseline, /revoke all on table public\.ph_sales_office from public, anon, authenticated/i);
  assert.doesNotMatch(ciSalesOfficeBaseline, /grant (insert|update|delete|all) on table public\.ph_sales_office to (anon|authenticated)/i);
  assert.match(ciSalesOfficeBaseline, /create table if not exists public\.ph_cav_import/i);
});

test('hosted health preserves old delivery history but blocks every post-release mismatch', () => {
  assert.match(evalHealthV2, /delivery\.created_at >= contract_started_at/);
  assert.match(evalHealthV2, /historical_pdf_origin_mismatch_count/);
  assert.match(evalHealthV2, /coalesce\(work\.origin_count, -1\)/);
  assert.match(productionProbe, /get_eval_itemcode_work_health_snapshot_v2/);
  assert.match(productionProbe, /eval-itemcode-work-health-v2/);
});
