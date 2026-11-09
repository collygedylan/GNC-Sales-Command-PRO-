import assert from 'node:assert/strict';

function historicalEvidenceChecks(read) {
  const migration = read('supabase/migrations/20261026050000_agdata_v2368_request_photo_av_navigation.sql');
  const canaryFix = read('supabase/migrations/20261026052000_agdata_v2368_request_canary_qualification.sql');
  const canaryStateProof = read('supabase/migrations/20261026053000_agdata_v2368_request_canary_state_proof.sql');
  const inventoryProjections = read('supabase/functions/_shared/inventory-projections.ts');
  const inventoryListContract = read('assets/inventory-list-contract.js');
  for (const marker of ['safe_parse_timestamptz', 'verify_request_batch_submission_v2368', 'REQUEST_CANARY_ROLLBACK',
    "'requested_by',profile.username", 'request_selected_rep_display:=canonical_name',
    'sanitize_av_note_without_spec_caliper', 'get_itemcode_av_note_options_v1',
    'historical_photo_date_for_record_v2368', 'historical_archive_read_v2368', 'historical_requests_read_v2368',
    'REQUEST_SELECTED_USER_REQUIRED',
    "to_char(photo_at at time zone 'America/Chicago','MM/DD/YY')", "('eval_reports_2','Eval Reports #2'",
    'update private.navigation_view_catalog set selectable=true']) {
    assert.ok(migration.includes(marker), marker);
  }
  assert.match(canaryFix, /from public\.ph_active_request active\s+where active\.client_batch_id=verify_request_batch_submission_v2368\.client_batch_id/);
  assert.match(canaryStateProof, /from public\.ph_active_request active[^]*union all[^]*from public\.ph_request_history history/);
  assert.match(canaryStateProof, /history\.client_batch_id=verify_request_batch_submission_v2368\.client_batch_id/);
  assert.ok((inventoryProjections.match(/"photo_date"/g) || []).length >= 3, 'master inventory projections expose photo_date');
  assert.match(inventoryListContract, /const version = 'master-list-v3'/);
  assert.match(inventoryListContract, /'oversellpercentage', 'photo_date',\s*'photo_link', 'photo_name'/);
  assert.match(read('assets/app-runtime.js'), /app-av-photo-slide[^]*\$\{imgHtml\}\$\{photoDateHtml\}\$\{photoStatusHtml\}/);
  const persistStart = migration.indexOf('create or replace function private.persist_completed_request_history_v1');
  const persistEnd = migration.indexOf('revoke all on function private.persist_completed_request_history_v1', persistStart);
  assert.ok(persistStart >= 0 && persistEnd > persistStart, 'completed history function slice');
  assert.doesNotMatch(migration.slice(persistStart, persistEnd), /photo_date\s*=\s*coalesce\(photo_at\s*,\s*history\.photo_date\)/i);
  assert.doesNotMatch(read('assets/request-submission.js'), /requested_by:\s*mapping\.salesrepname/);

}

function runtimeNotesChecks(read,runFunctions,functionSource) {  const historicalPhotoDateKeyFix = read('supabase/migrations/20261026055000_agdata_v2368_historical_photo_date_key_fix.sql');
  const avNoteSanitizer = read('supabase/migrations/20261026054000_agdata_v2368_av_note_sanitizer.sql');
  const runtime = read('assets/app-runtime.js');
  for (const marker of ['createStandardRequestFolderName', 'data-request-folder-name',
    'requested_by:requestedBy', 'sales_rep:selectedRepName', 'resolveAndFormatPhotoDate',
    "timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', year: '2-digit'",
    'class="photo-thumb-date" data-photo-taken-date=', 'sanitizeAvNoteWithoutSpecCaliper', 'salesOfficeCardPhotoHtml',
    'getRequestGlobalCustomerOptions', "request_selected_salesrep_id: ''",
    "action: 'av_note_options'", 'QUICK_ACCESS_NESTED_ROUTES', "eval_reports_2: { parent: 'managers', tab: 'eval-reports-2' }"]) {
    assert.ok(runtime.includes(marker), marker);
  }
  const sanitizer = runFunctions('assets/app-runtime.js', ['sanitizeAvNoteWithoutSpecCaliper']);
  const requesterRoleFilter = runFunctions('assets/app-runtime.js', ['normalizeRoleAccessToken', 'isRequestRepRoleValue']);
  for (const role of ['REP', 'Sales Rep', 'sales_rep', 'Sales', 'CSR', 'Customer Service', 'Sales Office', 'Office', 'Admin', 'Administrator', 'Manager']) {
    assert.equal(requesterRoleFilter.isRequestRepRoleValue(role), true, role);
  }
  for (const role of ['Eval', 'Evaluator', 'Production', 'QC', 'Docks']) assert.equal(requesterRoleFilter.isRequestRepRoleValue(role), false, role);
  assert.equal(sanitizer.sanitizeAvNoteWithoutSpecCaliper('HEAVY BUD / SPEC - 3.5-4\'H'), 'HEAVY BUD');
  assert.equal(sanitizer.sanitizeAvNoteWithoutSpecCaliper('SCATTERED BLOOMS / SPEC - 12-14"'), 'SCATTERED BLOOMS');
  assert.equal(sanitizer.sanitizeAvNoteWithoutSpecCaliper('N/A / SPEC - 20-22"H'), '');
  assert.equal(sanitizer.sanitizeAvNoteWithoutSpecCaliper('2" Cal'), '');
  assert.equal(sanitizer.sanitizeAvNoteWithoutSpecCaliper('16-18" HxW'), '');
  assert.equal(sanitizer.sanitizeAvNoteWithoutSpecCaliper('20" H X 30" W'), '');
  assert.equal(sanitizer.sanitizeAvNoteWithoutSpecCaliper('14-16" H - 18-20" W'), '');
  assert.equal(sanitizer.sanitizeAvNoteWithoutSpecCaliper('24" T GOOD BRANCHING'), 'GOOD BRANCHING');
  assert.match(avNoteSanitizer, /create or replace function public\.sanitize_av_note_without_spec_caliper[^]*regexp_replace/);
  assert.match(historicalPhotoDateKeyFix, /history\.source_unique_id=p_row->>'id'[^]*history\.history_key=p_row->>'id'/);
  assert.doesNotMatch(historicalPhotoDateKeyFix, /from public\.ph_drive_mode_history history\s+where history\.unique_id/);
  const cacheOwner=functionSource('assets/app-runtime.js','ensureItemcodeAvNoteOptions');
  assert.match(cacheOwner,/entry\.verified = true/);assert.match(cacheOwner,/entry\.verified = false/);
  assert.match(cacheOwner,/sanitizeAvNoteWithoutSpecCaliper/);

}

function apiNavigationChecks(read) {  const appApi = read('supabase/functions/app-api/index.ts');
  assert.match(appApi, /table === "ph_app_users"\) return true/);
  assert.match(appApi, /action === "av_note_options"[^]*get_itemcode_av_note_options_v1/);
  assert.match(appApi, /ph_sales_office:[^\n]*photo_date/);
  assert.match(appApi, /ph_dock_issue_status:[^\n]*photo_date/);
  assert.match(read('supabase/functions/_shared/database.types.ts'), /ph_sales_office:[^]*Row:[^]*photo_date: string \| null[^]*Insert:[^]*photo_date\?: string \| null[^]*Update:[^]*photo_date\?: string \| null/);
  assert.match(read('services/database-contracts.generated.ts'), /"ph_sales_office":[^]*"row":[^]*"photo_date":[^]*"insert":[^]*"photo_date":[^]*"update":[^]*"photo_date":/);
  assert.match(appApi, /operation[.]startsWith\("archive-"\) [^;]*"historical_archive_read_v2370"/);
  const archive3039 = read('supabase/migrations/20261109008000_agdata3039_request_archive_reader.sql');
  assert.match(archive3039, /create or replace function public[.]historical_archive_read_v2370/);
  assert.match(archive3039, /recordKind[^]*requests[^]*historical_request_archive_read_v3039/);
  assert.match(read('src/views/historical-archive-browser.tsx'), /photo-thumb-date[^]*data-photo-taken-date/);
  assert.match(read('components/historical-requests/HistoricalRequestsView.tsx'), /<HistoricalArchiveView[^]*recordKind="requests"/);
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'),
    /agdataV2368RequestPhotoAvNavigationMigrationName[^]*registeredReleaseDatabaseMigrations/);
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'),
    /agdataV2368AvNoteSanitizerMigrationName[^]*registeredReleaseDatabaseMigrations/);
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'),
    /agdataV2368HistoricalPhotoDateKeyFixMigrationName[^]*registeredReleaseDatabaseMigrations/);
  const masterPhotoMigration = read('supabase/migrations/20261026051000_agdata_v2368_master_photo_date_preservation.sql');
  for (const marker of ['sync_master_inventory_canonical_v2362', 'new.photo_date:=case',
    'V2368_MASTER_PHOTO_DATE_BACKFILL_INCOMPLETE', "concat_ws(',',row.photo_link,row.dock_photo_link,row.flyer_photo_link)"]) {
    assert.ok(masterPhotoMigration.includes(marker), marker);
  }
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'),
    /agdataV2368MasterPhotoDatePreservationMigrationName[^]*registeredReleaseDatabaseMigrations/);
  const verifier = read('scripts/verify-live-request-queue.mjs');
  for (const marker of ['verifyRequestSubmissionCanary', 'verify_request_batch_submission_v2368',
    '008866.031.1', '10/20/26', 'verifyQuickAccessEvalReports', 'canary_rolled_back',
    'active_request !== 6', 'active_recount !== 0', 'active_bunch_notes !== 0']) assert.ok(verifier.includes(marker), marker);
}

export function requestPhotoNavigationContract(read,runFunctions,functionSource) {
  historicalEvidenceChecks(read);runtimeNotesChecks(read,runFunctions,functionSource);apiNavigationChecks(read);
}
