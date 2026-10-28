import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: backend
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { migrationContractQuery, releaseDatabaseMigrations } from '../scripts/apply-item-low-stock-migration.mjs';
import { patchAppsScriptFunctions } from '../scripts/apps-script-function-patch.mjs';
import {
  APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER,
  REQUEST_LIFECYCLE_POLICY_VERSION,
  syncAppsScriptProject,
  verifyDeploymentVersion
} from '../scripts/apps-script-sync-lib.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';
const source = `const DEPLOYED_COMMIT = '${APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER}';`;

const appHtml = readComposedAppSource();
const appsScriptSource = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

test('Home imported filenames stay available with a mobile-collapsed viewport default', () => {
  const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../assets/app-runtime.js', import.meta.url), 'utf8');
  assert.doesNotMatch(indexHtml, /<details id="dashboard-sync-accordion"[^>]*\bopen\b/);
  assert.match(runtime, /syncPanel\.open = window\.innerWidth >= 768/);
  assert.match(runtime, /syncPanel\.dataset\.viewportDefaultApplied = 'true'/);
  const context = vm.createContext({ currentUser: 'dylan_collyge',
    canAccessView: view => view === 'drive', getProtectedUserTokens: () => new Set(),
    hasPrivilegedManagerAccess: () => false });
  vm.runInContext(sourceFunction(appHtml, 'canViewDashboardSyncStatus', '        '), context);
  assert.equal(context.canViewDashboardSyncStatus(), true);
});

test('Home first render exposes all four exact filenames with their import timestamps', () => {
  const importedAt = '2026-10-20T18:12:53.303Z';
  const files = ['DriveAroundMC-10-12333420261020123334.xlsx', 'SOC-10 Open Orders-12251620261020122516.xlsx',
    'SOC-10 Reserves-12370820261020123708.xlsx', 'Dylan Wide Open 2026-10-19.xlsx'];
  const elements = Object.fromEntries(['accordion', 'stamp', 'summary', 'files'].map(key =>
    [`dashboard-sync-${key}`, { classList: { toggle() {} }, innerHTML: '', innerText: '' }]));
  const context = vm.createContext({ document: { getElementById: id => elements[id] },
    canViewDashboardSyncStatus: () => true, getSupabaseReadIdentityScope: () => 'brian',
    dashboardSyncMetadataOwner: 'brian', dashboardSyncMetadataFetchedAt: Date.now(),
    dashboardSyncMetadataInFlight: null, dashboardSyncMetadataRequestOwner: '', DASHBOARD_SYNC_METADATA_TTL_MS: 60000,
    dashboardSyncMetadataSummaries: files.map((file, index) => ({ label: ['Drive', 'SOC', 'Reserves', 'CAV'][index],
      files: [file], iso: importedAt, ms: Date.parse(importedAt), authoritative: true })),
    fullInventory: [], socInventory: [], reservesInventory: [], cavInventory: [],
    collectDashboardSyncSource: () => ({ iso: '', files: [] }), mergeDashboardSyncSummaries: rows => rows,
    formatDashboardSyncDateTime: iso => iso, escapeDashboardSyncText: text => text });
  vm.runInContext(sourceFunction(appHtml, 'updateDashboardSyncSummary', '        '), context);
  context.updateDashboardSyncSummary();
  for (const file of files) assert.ok(elements['dashboard-sync-files'].innerHTML.includes(file));
  assert.equal(elements['dashboard-sync-stamp'].innerText, importedAt);
  assert.equal((elements['dashboard-sync-files'].innerHTML.match(/2026-10-20T18:12:53.303Z/g) || []).length, 4);
});

test('empty drop folders never open Processed folders, import fences or publication RPCs', () => {
  for (const name of ['processFolderLocked_', 'processLatestFileOnlyFolderLocked_',
    'processSiteSplitMasterSnapshotBatchFolderLocked_', 'processSnapshotBatchFolderLocked_']) {
    const calls = [];
    const context = vm.createContext({ console: { log() {} },
      getDriveFolderByIdWithRetry_: id => { calls.push(id); assert.equal(id, 'drop'); return {}; },
      listDriveFilesWithRetry_: () => ({ hasNext: () => false }),
      pruneImportSourceRejectionMarkers_: () => ({}), createDeltaSyncStats_: () => ({}) });
    vm.runInContext(sourceFunction(appsScriptSource, name), context);
    const result = context[name]('drop', 'processed', 'ph_soc_master', () => assert.fail('no parse'));
    assert.equal(result.filesProcessed, 0);
    assert.deepEqual(calls, ['drop']);
  }
});
function sourceFunction(text, name, indent = '') {
  const found = text.match(new RegExp(`^${indent}(?:async )?function ${name}\\([^]*?^${indent}\\}`, 'm'));
  assert.ok(found, `function ${name} exists`);
  return found[0];
}

test('Home sync metadata retains known filenames across sparse newer revisions and older row polls', () => {
  const context = vm.createContext({
    selectDashboardSyncFilename: files => (files || []).filter(Boolean).sort().at(-1) || '',
    getValidIsoTimestamp: value => value && Number.isFinite(Date.parse(value)) ? value : '',
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') || ''
  });
  vm.runInContext(sourceFunction(appHtml, 'mergeDashboardSyncSummaries', '        ') + '\n'
    + sourceFunction(appHtml, 'collectDashboardSyncSource', '        '), context);
  for (const [label, filename] of [['SOC', 'SOC-10 Open Orders-current.xlsx'], ['Reserves', 'SOC-10 Reserves-current.xlsx'],
    ['Drive', 'DriveAroundMC-current.xlsx'], ['CAV', 'Dylan-Wide-Open-current.xlsx']]) {
    let summaries = [{ label, iso: '2026-10-20T18:00:00Z', ms: 100, files: [filename] }];
    for (let poll = 0; poll < 8; poll++) {
      summaries = context.mergeDashboardSyncSummaries([...summaries,
        { label, iso: '2026-10-20T18:01:00Z', ms: 200 + poll, files: [] },
        { label, iso: '2026-10-20T17:00:00Z', ms: 50, files: ['old.xlsx'] }]);
      assert.equal(summaries[0].files[0], filename);
    }
    const authoritative = context.mergeDashboardSyncSummaries([...summaries,
      { label, iso: '2026-10-20T18:02:00Z', ms: 300, files: [filename], authoritative: true },
      { label, iso: '2026-10-20T18:03:00Z', ms: 400, files: ['old.xlsx'] }]);
    assert.equal(authoritative[0].files[0], filename);
    assert.equal(authoritative[0].ms, 300);
    const firstPaint = context.collectDashboardSyncSource([
      { filename: '', last_updated: '2026-10-20T18:02:00Z' },
      { filename, last_updated: '2026-10-20T18:00:00Z' }], label);
    assert.equal(firstPaint.files[0], filename);
  }
});

test('Processed archival requires acknowledged atomic completion and source metadata', () => {
  let result = { ok: true, sourceMetadataStamped: true };
  const calls = [];
  const context = vm.createContext({
    datasetImportFenceContext_: null,
    callDatasetImportFenceRpc_: (name, payload) => { calls.push({ name, payload }); return result; },
    reconcileInventoryAssignmentsInBatches_: () => calls.push({ name: 'reconcile' })
  });
  vm.runInContext(sourceFunction(appsScriptSource, 'setDatasetImportSourceMetadata_') + '\n'
    + sourceFunction(appsScriptSource, 'closeDatasetImportFence_'), context);
  const makeFence = () => ({ runId: 'run', keys: ['ph_master_inventory'], canonicalKeys: ['ph_master_inventory'] });
  const fence = makeFence();
  context.setDatasetImportSourceMetadata_(fence, 'ph_master_inventory', [{ fileName: 'exact-original.xlsx', file: { getId: () => 'file1' } }]);
  context.closeDatasetImportFence_(fence, true);
  assert.equal(fence.closed, true);
  assert.equal(calls[0].name, 'reconcile');
  assert.equal(calls[1].name, 'finish_dataset_import_with_sources_v1');
  assert.equal(calls[1].payload.p_sources[0].fileName, 'exact-original.xlsx');
  result = { ok: true };
  const unacknowledged = makeFence();
  context.setDatasetImportSourceMetadata_(unacknowledged, 'ph_master_inventory', [{ fileName: 'exact-original.xlsx', file: { getId: () => 'file1' } }]);
  assert.throws(() => context.closeDatasetImportFence_(unacknowledged, true), /NOT_ACKNOWLEDGED/);
  assert.notEqual(unacknowledged.closed, true);
  for (const name of ['processFolderLocked_', 'processLatestFileOnlyFolderLocked_',
    'processSiteSplitMasterSnapshotBatchFolderLocked_', 'processSnapshotBatchFolderLocked_']) {
    const body = sourceFunction(appsScriptSource, name);
    assert.ok(body.indexOf('setDatasetImportSourceMetadata_') < body.indexOf('closeDatasetImportFence_'));
    const archive = body.search(/moveDriveFileToFolderWithRetry_|moveAndNormalizeDriveAroundProcessedFiles_/);
    assert.ok(archive > body.indexOf('closeDatasetImportFence_'), name);
  }
});

test('RUN SCRIPT defaults to the ordered five-stage pass and temp cleanup falls back to DriveApp', () => {
  const context = vm.createContext({
    MANUAL_SYNC_STAGE_ORDER_DEFAULT: Object.freeze(['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed']),
    String,
    Drive: { Files: { remove: id => { context.removed = id; } } },
    DriveApp: { getFileById: id => ({ isTrashed: () => false, setTrashed: value => { context.trashed = [id, value]; } }) },
    withDriveRetry_: (_label, action) => action(),
  });
  vm.runInContext(sourceFunction(appsScriptSource, 'getManualSyncStageOrder_') + '\n'
    + sourceFunction(appsScriptSource, 'cleanupTempGoogleSheet_'), context);
  assert.deepEqual(Array.from(context.getManualSyncStageOrder_('all')), ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed']);
  assert.deepEqual(Array.from(context.getManualSyncStageOrder_('drive_soc_reserves')), ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed']);
  assert.deepEqual(Array.from(context.getManualSyncStageOrder_('cav')), ['cav'], 'single-stage operator jobs remain available');
  context.cleanupTempGoogleSheet_('temp-id', 'source.xlsx');
  assert.equal(context.removed, 'temp-id');

  context.Drive.Files.remove = () => { throw new Error('Drive remove unavailable'); };
  context.cleanupTempGoogleSheet_('fallback-id', 'source.xlsx');
  assert.deepEqual(Array.from(context.trashed), ['fallback-id', true]);
  assert.match(sourceFunction(appsScriptSource, 'cleanupTempGoogleSheet_'), /IMPORT_TEMP_CLEANUP_FAILED/);
  const extraction = sourceFunction(appsScriptSource, 'extractDataFromFile');
  assert.match(extraction, /cleanupTempOnExit === true[\s\S]*clearImportExtractionCheckpoint_\(identity\)/);
});

test('Apps Script scoped merge accepts only the registered stage order and cleanup functions', () => {
  const fingerprint = appsScriptSource.match(/^const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = [^\n]+;/m)?.[0];
  assert.ok(fingerprint);
  const stageDeclaration = appsScriptSource.match(/^const MANUAL_SYNC_STAGE_ORDER_DEFAULT = Object\.freeze\([^\n]+;/m)?.[0];
  assert.ok(stageDeclaration);
  const cleanupFunction = sourceFunction(appsScriptSource, 'cleanupTempGoogleSheet_');
  const extractFunction = sourceFunction(appsScriptSource, 'extractDataFromFile');
  const remoteOnly = "function remoteOnlyProductionRoute_() { return 'preserved'; }";
  const remote = "const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = 'remote';\nconst MANUAL_SYNC_STAGE_ORDER_DEFAULT = Object.freeze(['legacy']);\n"
    + "function cleanupTempGoogleSheet_() { return 'old cleanup'; }\n"
    + "function extractDataFromFile() { return 'old extraction'; }\n" + remoteOnly;
  const merged = patchAppsScriptFunctions({ remoteSource: remote, localSource: `${fingerprint}\n${stageDeclaration}\n${cleanupFunction}\n${extractFunction}`,
    functionNames: ['MANUAL_SYNC_STAGE_ORDER_DEFAULT', 'cleanupTempGoogleSheet_', 'extractDataFromFile'] });
  assert.ok(merged.source.includes(stageDeclaration));
  assert.match(merged.source, /Drive\.Files\.remove\(tempSheetId\)/);
  assert.match(merged.source, /cleanupTempOnExit === true/);
  assert.ok(merged.source.includes(remoteOnly));
});

test('manual sync has authenticated exact-run kick, serial worker, per-stage refresh and retrying poll', () => {
  assert.match(appsScriptSource, /\['manual_run', 'manual_continue', 'manual_clear_status'/);
  const continuation = appsScriptSource.slice(appsScriptSource.indexOf("if (payload.type === 'manual_continue')"),
    appsScriptSource.indexOf("if (payload.type === 'manual_run')"));
  assert.match(continuation, /String\(pending.runId\) !== String\(payload.run_id/);
  assert.match(continuation, /runQueuedManualSyncStage_\(\{ expectedRunId: payload.run_id \}\)/);
  assert.match(sourceFunction(appsScriptSource, 'runQueuedManualSyncStage_'), /lock.tryLock/);
  const start = sourceFunction(appHtml, 'runGoogleAppsScriptTrigger', '        ');
  assert.match(start, /await getNativeAuthRequestHeaders\(\)/);
  assert.match(start, /importScope !== getSupabaseReadIdentityScope\(\)/);
  assert.match(start, /action: 'erp_sync'[\s\S]*operation: 'start'[\s\S]*commandId: crypto\.randomUUID\(\)/);
  assert.doesNotMatch(start, /manual_continue|postGoogleScriptJsonPayload/);
  assert.match(sourceFunction(appHtml, 'applyManualSyncStatus', '        '), /next.stageIndex > previous.stageIndex[\s\S]*refreshDashboardSyncMetadata\(true\)/);
  assert.match(sourceFunction(appHtml, 'scheduleManualSyncStatusPoll', '        '), /catch\([\s\S]*scheduleManualSyncStatusPoll/);
});

test('source metadata and Manager read migrations are registered with secure deploy contracts', () => {
  for (const name of ['20261021014500_manager_published_read_continuity_v1.sql', '20261021020000_import_source_metadata_v1.sql',
    '20261021021000_master_priority_split_identity_v1.sql', '20261021133149_aura_dylan_owner_only_guard.sql']) {
    assert.ok(releaseDatabaseMigrations.includes(name));
    assert.match(migrationContractQuery(name), /as installed/);
  }
  const migration = readFileSync(new URL('../supabase/migrations/20261021020000_import_source_metadata_v1.sql', import.meta.url), 'utf8');
  assert.match(migration, /coalesce\(auth.role\(\),''\) <> 'service_role'/);
  assert.match(migration, /IMPORT_SOURCE_REPLAY_SUPERSEDED/);
  assert.match(migration, /result := public.finish_dataset_import_v1\(p_run_id\)/);
  assert.match(migration, /result := app_sync_private.advance_import\(p_run_id,'finish'\)/);
  assert.match(migration, /foreach dataset in array run.canonical_keys loop/);
  assert.match(migration, /source_import_run_id=p_run_id/);
  assert.match(migration, /case when allowed then r.source_file_name else null end/);
  assert.doesNotMatch(migration, /update public.ph_master_inventory|delete from/);
});

test('ingestion deployment selects every changed function and preserves remote scheduling outside the patch', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.appsScriptPatchFunctions, [
    'buildSuspendTagApprovalEmail_',
    'buildReclassInlineOhText_', 'buildReclassItemInquiryTable_', 'buildCompletedInventoryReclassReportModel_', 'buildReclassItemInquiryHtml_', 'buildReclassItemInquiryPdf_',
    'buildReclassInquiryReportModel_', 'getReclassInquiryEmailRecipients_', 'buildReclassInquiryCompactReportHtml_',
    'buildReclassInquiryEmailHtml_', 'deliverReclassInquiryPayload_', 'handleSignedInventoryReclassMoveDelivery_', 'handleSignedBunchNoteDelivery_',
    'setupDropFolderAutoSyncTrigger', 'removeDropFolderAutoSyncTrigger', 'runAutoDropFolderSync_',
    'removeUrgentDriveAroundTriggers_', 'scheduleUrgentDriveAroundTrigger_', 'hasPendingDriveAroundSource_',
    'cleanupStaleDriveAroundWorkspace_', 'runUrgentDriveAroundSync_', 'runUrgentDriveAroundSync',
    'failDatasetImportFence_', 'runQueuedManualSyncStage_', 'MANUAL_SYNC_STAGE_ORDER_DEFAULT', 'URGENT_DRIVE_AROUND_TRIGGER_HANDLER_',
    'URGENT_DRIVE_AROUND_REQUEST_KEY_', 'URGENT_DRIVE_AROUND_RETRY_MS_', 'URGENT_DRIVE_AROUND_STALE_MS_',
    'URGENT_DRIVE_AROUND_EXECUTION_BUDGET_MS_', 'canonicalizeMasterBulkPayloadValue_',
    'normalizeEscapedImportText_', 'normalizeEscapedImportRow_', 'buildMasterBulkSnapshotPayload_',
    'buildStandardPayload', 'buildMasterPayload', 'buildCavPayload',
    'getImportHistoryRoute_', 'isLiveImportTemporaryFile_', 'isCheckpointedLatestImportTable_', 'cleanupTempGoogleSheet_', 'cleanupCompletedImportExtraction_', 'extractDataFromFile', 'listRoutedDropFiles_',
    'getFastLiveIngestDatasetKey_', 'getFastLiveIngestRpc_', 'getFastLiveFileMeta_',
    'getFastLiveIngestRows_', 'processFastLiveFile_', 'runRoutedDropImport_',
    'buildRequestDeliveryEmailPayload_', 'runSOCOnly', 'runDriveAroundOnly',
    'runWarehouseAssignedOnly', 'runCavOnly', 'resolveSupabaseServiceRoleKey_', 'getSupabaseHeaders_',
    'reconcileAppsScriptActionSigningKey_', 'verifyAppsScriptActionEnvelope_', 'mintDriveToken_', 'doPost',
  ]);
  assert.equal(manifest.appsScriptPatchRelease, true);
  const untouched = 'const HISTORICAL_BACKFILL_PAUSED = true;\nconst AUTO_SYNC_PAUSED = true;';
  const remote = `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = 'old';\nconst APP_RELEASE_VERSION_ = 'old';\n${untouched}\nfunction doPost() { return 'old'; }`;
  const local = `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = 'new';\nconst APP_RELEASE_VERSION_ = 'new';\nfunction doPost() { return 'new'; }\nfunction setDatasetImportSourceMetadata_() { return 'metadata'; }`;
  const patch = patchAppsScriptFunctions({ remoteSource: remote, localSource: local,
    functionNames: ['doPost', 'setDatasetImportSourceMetadata_'], includeRelease: true });
  assert.ok(patch.source.includes(untouched));
  assert.match(patch.source, /const APP_RELEASE_VERSION_ = 'new'/);
  assert.match(patch.source, /function setDatasetImportSourceMetadata_\(\) \{ return 'metadata'; \}/);
  const bunchPrefix = "const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = 'old';\n";
  const bunchPatch = patchAppsScriptFunctions({ remoteSource: bunchPrefix,
    localSource: `${bunchPrefix}function handleSignedBunchNoteDelivery_() { return 'dylan-only'; }`,
    functionNames: ['handleSignedBunchNoteDelivery_'] });
  assert.match(bunchPatch.source, /function handleSignedBunchNoteDelivery_\(\) \{ return 'dylan-only'; \}/);
  assert.throws(() => patchAppsScriptFunctions({ remoteSource: remote, localSource: local,
    functionNames: ['startImportHistoryBackfill'] }), /ALLOWLIST_INVALID/);
  const localDispatch = sourceFunction(appsScriptSource, 'doPost');
  const start = localDispatch.indexOf("    if (payload.type === 'manual_continue') {");
  const next = localDispatch.indexOf("    if (payload.type === 'manual_run') {", start);
  const remoteOnly = "    if (payload.type === 'remote_only') return jsonOutput_({ preserved: true });\n\n";
  const wakeRoute = "    if (payload.type === 'wake_delivery_worker') {\n      const deliveryLimit = Math.max(1, Math.min(100, Number(payload.limit) || 40));\n      return jsonOutput_(processRequestDeliveryOutbox_(deliveryLimit));\n    }\n";
  const priorDispatch = (localDispatch.slice(0, start) + remoteOnly + localDispatch.slice(next))
    .replace(wakeRoute, '')
    .replace("['manual_run', 'manual_continue', 'manual_clear_status', 'manual_clear_stale_status']",
      "['manual_run', 'manual_clear_status', 'manual_clear_stale_status']");
  const prefix = "const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = 'old';\n";
  const merged = patchAppsScriptFunctions({ remoteSource: prefix + priorDispatch,
    localSource: prefix + localDispatch, functionNames: ['doPost'] });
  assert.ok(merged.source.includes(remoteOnly), 'remote-only dispatch remains byte-for-byte intact');
  assert.match(merged.source, /type === 'manual_continue'/);
  assert.match(merged.source, /type === 'wake_delivery_worker'/);
  assert.equal(patchAppsScriptFunctions({ remoteSource: merged.source,
    localSource: prefix + localDispatch, functionNames: ['doPost'] }).source, merged.source);
  const mintSource = sourceFunction(appsScriptSource, 'mintDriveToken_');
  const mintRoute = "    if (payload.type === 'mint_drive_token') return jsonOutput_(mintDriveToken_());";
  const mintPatch = patchAppsScriptFunctions({ remoteSource: `${prefix}${priorDispatch}`,
    localSource: `${prefix}${localDispatch}\n${mintSource}`, functionNames: ['doPost', 'mintDriveToken_'] });
  assert.match(mintPatch.source, /function mintDriveToken_\(\)/);
  assert.ok(mintPatch.source.includes(mintRoute), 'the merger inserts mint dispatch into remote doPost without the local route');
  assert.ok(mintPatch.source.includes(remoteOnly), 'adding the signed mint action preserves unrelated remote-only routes');

  const mergedPostContext = vm.createContext({
    getAppsScriptActionSigningKeys_: () => ['test-service-key'],
    requestDeliveryBase64Url_: () => 'valid-signature',
    appsScriptActionConstantTimeEqual_: (left, right) => left === right,
    Utilities: { computeHmacSha256Signature: () => [1, 2, 3], Charset: { UTF_8: 'UTF-8' } },
    verifyAppsScriptActionActor_: () => { throw new Error('mint route must use its restricted system actor'); },
    jsonOutput_: value => value,
    ScriptApp: { getOAuthToken: () => 'test-oauth-token' },
  });
  for (const name of ['verifyAppsScriptActionEnvelope_', 'authorizeAppsScriptPost_']) {
    vm.runInContext(sourceFunction(appsScriptSource, name), mergedPostContext);
  }
  for (const name of ['mintDriveToken_', 'doPost']) vm.runInContext(sourceFunction(mintPatch.source, name), mergedPostContext);
  const command = { contractVersion: 'apps-script-action-v1', action: 'mint_drive_token',
    payload: { type: 'mint_drive_token' }, actor: { system: 'erp-sync-cloud-worker' } };
  const tokenResponse = await mergedPostContext.doPost({ postData: { contents: JSON.stringify({
    type: 'apps_script_action_v1', timestamp: new Date().toISOString(), signature: 'valid-signature',
    deliveryJson: JSON.stringify(command),
  }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(tokenResponse)), { ok: true, accessToken: 'test-oauth-token' },
    'remote-only doPost verifies the signed command then returns the mint result');
});

test('Drive OAuth token mint requires the exact signed cloud-worker actor and stays server-only', () => {
  const tokenContext = vm.createContext({ ScriptApp: { getOAuthToken: () => 'test-oauth-token' } });
  vm.runInContext(sourceFunction(appsScriptSource, 'mintDriveToken_'), tokenContext);
  assert.deepEqual(JSON.parse(JSON.stringify(tokenContext.mintDriveToken_())), { ok: true, accessToken: 'test-oauth-token' });

  const envelopeContext = vm.createContext({
    getAppsScriptActionSigningKeys_: () => ['test-service-key'],
    requestDeliveryBase64Url_: () => 'valid-signature',
    appsScriptActionConstantTimeEqual_: (left, right) => left === right,
    Utilities: { computeHmacSha256Signature: () => [1, 2, 3], Charset: { UTF_8: 'UTF-8' } },
    verifyAppsScriptActionActor_: () => { throw new Error('system mint must not be treated as a user actor'); },
  });
  vm.runInContext(sourceFunction(appsScriptSource, 'verifyAppsScriptActionEnvelope_'), envelopeContext);
  const signedEnvelope = actor => ({ type: 'apps_script_action_v1', timestamp: new Date().toISOString(), signature: 'valid-signature',
    deliveryJson: JSON.stringify({ contractVersion: 'apps-script-action-v1', action: 'mint_drive_token',
      payload: { type: 'mint_drive_token' }, actor }) });
  assert.equal(envelopeContext.verifyAppsScriptActionEnvelope_(signedEnvelope({ system: 'erp-sync-cloud-worker' })).type, 'mint_drive_token');
  assert.throws(() => envelopeContext.verifyAppsScriptActionEnvelope_(signedEnvelope({ system: 'browser' })), /APPS_SCRIPT_DRIVE_TOKEN_ACTOR_INVALID/);
  const extraPayload = signedEnvelope({ system: 'erp-sync-cloud-worker' });
  extraPayload.deliveryJson = JSON.stringify({ contractVersion: 'apps-script-action-v1', action: 'mint_drive_token',
    payload: { type: 'mint_drive_token', exposeToBrowser: true }, actor: { system: 'erp-sync-cloud-worker' } });
  assert.throws(() => envelopeContext.verifyAppsScriptActionEnvelope_(extraPayload), /APPS_SCRIPT_DRIVE_TOKEN_ACTOR_INVALID/);
  const appApi = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  const proxyStart = appApi.indexOf('const APPS_SCRIPT_PROXY_ACTIONS = new Set([');
  const proxyEnd = appApi.indexOf(']);', proxyStart);
  assert.ok(proxyStart >= 0 && proxyEnd > proxyStart);
  assert.doesNotMatch(appApi.slice(proxyStart, proxyEnd), /mint_drive_token/);
});

test('urgent Drive cleanup respects the staging RPC minimum age', () => {
  assert.match(appsScriptSource, /const stagingCutoffMs = Date\.now\(\) - 25 \* 60 \* 60 \* 1000;/);
  assert.match(appsScriptSource, /cleanup_master_snapshot_staging_v1'[\s\S]*p_older_than: new Date\(stagingCutoffMs\)\.toISOString\(\)/);
});

function makeScript({ versionCount = 0, createdVersion = 201, deployedVersion = createdVersion, observedVersions } = {}) {
  const calls = [];
  let deploymentReads = 0;
  const script = {
    projects: {
      versions: {
        list: async () => {
          calls.push('versions.list');
          return { data: { versions: Array.from({ length: versionCount }, (_, index) => ({ versionNumber: index + 1 })) } };
        },
        create: async () => {
          calls.push('versions.create');
          return { data: { versionNumber: createdVersion } };
        }
      },
      getContent: async () => {
        calls.push('getContent');
        return { data: { files: [{ name: 'Code', type: 'SERVER_JS', source: 'old' }] } };
      },
      updateContent: async (request) => {
        calls.push('updateContent');
        script.updatedSource = request.requestBody.files[0].source;
        return { data: {} };
      },
      deployments: {
        update: async (request) => {
          calls.push('deployments.update');
          script.lastDeploymentUpdate = request.requestBody;
          return { data: {} };
        },
        get: async (request, options) => {
          calls.push('deployments.get');
          script.lastDeploymentRead = { request, options };
          const version = observedVersions
            ? observedVersions[Math.min(deploymentReads++, observedVersions.length - 1)] : deployedVersion;
          return { data: { deploymentConfig: { versionNumber: version } } };
        }
      }
    }
  };
  return { script, calls };
}

function healthyFetch(overrides = {}) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      ok: true,
      deployedCommit: sha,
      lifecycleRecipientPolicyVersion: REQUEST_LIFECYCLE_POLICY_VERSION,
      requiredRecipientCount: 3,
      ...overrides
    })
  });
}

test('full version capacity updates HEAD and deploys the latest existing version as a successful fallback', async () => {
  const { script, calls } = makeScript({ versionCount: 200, deployedVersion: 200 });
  const warnings = [];
  const healthCalls = [];
  const result = await syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key', script, scriptId: 'script',
    deploymentId: 'deployment', source, githubSha: sha, logger: { warn: message => warnings.push(message) },
    fetchImpl: async (_url, options) => { healthCalls.push(options); return healthyFetch()(); }, sleep: async () => {}, healthAttempts: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.headUpdated, true);
  assert.equal(result.versionCapacityExhausted, true);
  assert.equal(result.versionCreated, false);
  assert.equal(result.sourceUpdated, true);
  assert.equal(result.deploymentUpdated, true);
  assert.equal(result.versionNumber, 200);
  assert.equal(result.deployedVersionNumber, 200);
  assert.equal(result.health, null, 'HEAD-only fallback does not claim new-commit health');
  assert.ok(script.updatedSource.includes(sha));
  assert.match(warnings.join('\n'), /APPS_SCRIPT_VERSION_CAPACITY_EXHAUSTED/);
  assert.deepEqual(healthCalls, []);
  assert.equal(script.lastDeploymentUpdate?.deploymentConfig?.versionNumber, 200);
  assert.deepEqual(calls, ['getContent', 'updateContent', 'versions.list', 'deployments.update', 'deployments.get']);
});

test('version cleanup skips every deployed version across pages and deletes only the oldest unused version', async () => {
  const { script, calls } = makeScript({ versionCount: 200, createdVersion: 201, deployedVersion: 201 });
  const deploymentListCalls = [];
  script.projects.deployments.list = async request => {
    deploymentListCalls.push(request);
    return request.pageToken
      ? { data: { deployments: [{ deploymentConfig: { versionNumber: 2 } }, { deploymentConfig: { versionNumber: 200 } }] } }
      : { data: { deployments: [{ deploymentConfig: { versionNumber: 1 } }], nextPageToken: 'next-page' } };
  };
  const deleted = [];
  const guards = [];
  const result = await syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key', script, scriptId: 'script/id',
    deploymentId: 'deployment', source, githubSha: sha, deleteVersionRequest: async request => {
      deleted.push(request); return { status: 204 };
    }, beforeMutation: async () => { guards.push('guard'); }, fetchImpl: healthyFetch(),
    sleep: async () => {}, healthAttempts: 1 });
  assert.equal(result.versionCapacityExhausted, false);
  assert.equal(result.versionCreated, true);
  assert.equal(result.versionCountBefore, 200);
  assert.equal(result.versionCountAfter, 200);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].method, 'DELETE');
  assert.equal(deleted[0].url, 'https://script.googleapis.com/v1/projects/script%2Fid/versions/3');
  assert.deepEqual(deploymentListCalls.map(request => request.pageToken || ''), ['', 'next-page']);
  assert.equal(guards.length, 4, 'source update, delete, version create, and deployment update are each guarded');
  assert.deepEqual(calls, ['getContent', 'updateContent', 'versions.list', 'versions.create', 'deployments.update', 'deployments.get']);
});

test('unsupported Apps Script version deletion warns and keeps the latest-version fallback green', async () => {
  const { script, calls } = makeScript({ versionCount: 200, deployedVersion: 200 });
  script.projects.deployments.list = async () => ({ data: { deployments: [{ deploymentConfig: { versionNumber: 1 } }] } });
  const warnings = [];
  const result = await syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key', script, scriptId: 'script',
    deploymentId: 'deployment', source, githubSha: sha, logger: { warn: message => warnings.push(message) },
    deleteVersionRequest: async () => { throw Object.assign(new Error('not supported'), { response: { status: 404 } }); },
    fetchImpl: async () => { throw new Error('head-only fallback must not run health checks'); }, sleep: async () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.versionCapacityExhausted, true);
  assert.equal(result.versionNumber, 200, 'latest existing version is retained as the fallback');
  assert.equal(result.health, null);
  assert.equal(warnings.filter(message => /APPS_SCRIPT_VERSION_DELETE_SKIPPED/.test(message)).length, 1);
  assert.deepEqual(calls, ['getContent', 'updateContent', 'versions.list', 'deployments.update', 'deployments.get']);
});

test('capacity at 180 warns but still permits an editable-source-only sync', async () => {
  const { script, calls } = makeScript({ versionCount: 180 });
  const warnings = [];
  const result = await syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key',
    script,
    scriptId: 'script',
    source: 'const healthy = true;',
    logger: { warn: (message) => warnings.push(message) }
  });
  assert.equal(result.versionCountBefore, 180);
  assert.equal(result.deploymentUpdated, false);
  assert.equal(result.versionCapacityExhausted, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /APPS_SCRIPT_VERSION_CAPACITY_LOW/);
  assert.deepEqual(calls, ['getContent', 'updateContent', 'versions.list']);
});

test('release sync head-only mode updates source and never creates a version or updates a deployment', async () => {
  const { script, calls } = makeScript({ versionCount: 200 });
  const result = await syncAppsScriptProject({ script, scriptId: 'script', deploymentId: 'deployment',
    source, githubSha: sha, headOnly: true, logger: { warn() {} } });
  assert.equal(result.headUpdated, true);
  assert.equal(result.headOnly, true);
  assert.equal(result.versionCapacityExhausted, true);
  assert.equal(result.versionCreated, false);
  assert.equal(result.deploymentUpdated, false);
  assert.ok(script.updatedSource.includes(sha));
  assert.deepEqual(calls, ['getContent', 'updateContent', 'versions.list']);

  const entrypoint = readFileSync(new URL('../scripts/sync-codegs-to-apps-script.js', import.meta.url), 'utf8');
  assert.match(entrypoint, /headOnly:\s*true/);
  assert.match(entrypoint, /no version creation or deployment update was attempted/);
  const headOnlyBranch = entrypoint.slice(entrypoint.indexOf('if (result.headOnly) {'), entrypoint.indexOf('} else if (result.versionCapacityExhausted)', entrypoint.indexOf('if (result.headOnly) {')));
  assert.match(headOnlyBranch, /apps-script-head-only-evidence-v1/);
  assert.match(headOnlyBranch, /headSourceDigest: publishedDigest/);
  assert.match(headOnlyBranch, /deploymentAfterVersion !== existingDeploymentVersion/);
  assert.match(headOnlyBranch, /deploymentUpdated: false/);
  assert.doesNotMatch(headOnlyBranch, /versions\.create|deployments\.update/);
});

test('version-create quota errors use the latest existing deployment while unrelated errors remain fatal', async () => {
  const quota = makeScript({ versionCount: 12, deployedVersion: 12 });
  quota.script.projects.versions.create = async () => {
    quota.calls.push('versions.create');
    throw new Error('Quota exceeded: maximum number of versions');
  };
  const healthCalls = [];
  const result = await syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key', script: quota.script,
    scriptId: 'script', deploymentId: 'deployment', source, githubSha: sha, fetchImpl: async (...args) => {
      healthCalls.push(args); return healthyFetch()();
    }, sleep: async () => {}, healthAttempts: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.headUpdated, true);
  assert.equal(result.versionCapacityExhausted, true);
  assert.equal(result.versionCreated, false);
  assert.equal(result.versionNumber, 12);
  assert.equal(result.deployedVersionNumber, 12);
  assert.equal(result.health, null);
  assert.equal(quota.script.lastDeploymentUpdate?.deploymentConfig?.versionNumber, 12);
  assert.deepEqual(healthCalls, []);
  assert.deepEqual(quota.calls, ['getContent', 'updateContent', 'versions.list', 'versions.create',
    'deployments.update', 'deployments.get']);

  const failure = makeScript({ versionCount: 12 });
  failure.script.projects.versions.create = async () => {
    failure.calls.push('versions.create');
    throw new Error('permission denied');
  };
  await assert.rejects(syncAppsScriptProject({ script: failure.script, scriptId: 'script', deploymentId: 'deployment',
    source, githubSha: sha }), /permission denied/);
  assert.deepEqual(failure.calls, ['getContent', 'updateContent', 'versions.list', 'versions.create']);
});

test('successful sync advances and verifies the exact deployment version and health policy', async () => {
  const { script, calls } = makeScript({ versionCount: 30, createdVersion: 202, deployedVersion: 202 });
  const healthRequests = [];
  const result = await syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key',
    script,
    scriptId: 'script',
    deploymentId: 'deployment',
    source,
    githubSha: sha,
    fetchImpl: async (_url, options) => {
      healthRequests.push(JSON.parse(options.body));
      return healthyFetch()();
    },
    sleep: async () => {},
    healthAttempts: 1
  });
  assert.equal(result.versionNumber, 202);
  assert.equal(result.deployedVersionNumber, 202);
  assert.equal(result.health.requiredRecipientCount, 3);
  assert.ok(script.updatedSource.includes(sha));
  assert.ok(!script.updatedSource.includes(APPS_SCRIPT_DEPLOYMENT_COMMIT_PLACEHOLDER));
  assert.equal(healthRequests.length, 2, 'deployment reconciles the signer key before the ordinary health read');
  assert.equal(healthRequests[0].reconcileSigningKey, true);
  assert.equal(healthRequests[0].serverAuthorization, 'synthetic-signing-key');
  assert.equal(healthRequests[0].type, 'apps_script_action_v1');
  assert.equal(healthRequests[1].type, 'apps_script_action_v1');
  assert.equal(Object.hasOwn(healthRequests[1], 'reconcileSigningKey'), false, 'ordinary health remains read-only');
  assert.equal(Object.hasOwn(healthRequests[1], 'serverAuthorization'), false, 'ordinary health sends no key candidate');
  assert.deepEqual(calls, [
    'getContent',
    'updateContent',
    'versions.list',
    'versions.create',
    'deployments.update',
    'deployments.get'
  ]);
});

test('semantic releases label the Apps Script version and deployment consistently', async () => {
  const { script } = makeScript();
  const descriptions = [];
  script.projects.versions.create = async request => {
    descriptions.push(request.requestBody.description);
    return { data: { versionNumber: 201 } };
  };
  script.projects.deployments.update = async request => {
    descriptions.push(request.requestBody.deploymentConfig.description);
    return { data: {} };
  };
  await syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key', script, scriptId: 'script', deploymentId: 'deployment',
    source: `${source}\nconst APP_RELEASE_VERSION_ = 'AgData v2.0.0';`, githubSha: sha,
    fetchImpl: healthyFetch(), sleep: async () => {}, healthAttempts: 1 });
  assert.deepEqual(descriptions, ['AgData v2.0.0 (0123456)', 'AgData v2.0.0 (0123456)']);
});

test('production authorization is checked immediately before each source, version, and deployment mutation', async () => {
  const { script, calls } = makeScript();
  await syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key', script, scriptId: 'script', deploymentId: 'deployment', source, githubSha: sha,
    beforeMutation: async () => { calls.push('authorize'); }, fetchImpl: healthyFetch(), healthAttempts: 1 });
  for (const name of ['updateContent', 'versions.create', 'deployments.update']) {
    assert.equal(calls[calls.indexOf(name) - 1], 'authorize');
  }
});

for (const deniedMutation of [1, 2, 3]) test(`a superseded main stops mutation ${deniedMutation} without retrying publication`, async () => {
  const { script, calls } = makeScript();
  let checks = 0;
  await assert.rejects(syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key', script, scriptId: 'script', deploymentId: 'deployment', source, githubSha: sha,
    beforeMutation: async () => { if (++checks === deniedMutation) throw new Error('CURRENT_MAIN_CHANGED'); },
    fetchImpl: healthyFetch(), healthAttempts: 1 }), /CURRENT_MAIN_CHANGED/);
  const mutations = calls.filter(name => ['updateContent', 'versions.create', 'deployments.update'].includes(name));
  assert.equal(mutations.length, deniedMutation - 1);
});

test('deployment version mismatch is rejected before health is accepted', async () => {
  const { script, calls } = makeScript({ versionCount: 30, createdVersion: 202, deployedVersion: 201 });
  const sleeps = [];
  let healthReads = 0;
  await assert.rejects(
    syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key',
      script,
      scriptId: 'script',
      deploymentId: 'deployment',
      source,
      githubSha: sha,
      fetchImpl: async () => { healthReads += 1; return healthyFetch()(); },
      sleep: async ms => { sleeps.push(ms); },
      logger: { warn() {} },
      healthAttempts: 1
    }),
    (error) => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH'
  );
  assert.equal(healthReads, 0);
  assert.equal(calls.filter(call => call === 'deployments.get').length, 13);
  assert.deepEqual(sleeps, Array(12).fill(5000));
  for (const mutation of ['updateContent', 'versions.create', 'deployments.update']) {
    assert.equal(calls.filter(call => call === mutation).length, 1, `${mutation} is never retried`);
  }
});

test('stale deployment reads converge without another version or deployment write', async () => {
  const { script, calls } = makeScript({ createdVersion: 202, observedVersions: [200, 201, 202] });
  const sleeps = [];
  const warnings = [];
  let healthReads = 0;
  const result = await syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key',
    script, scriptId: 'script', deploymentId: 'deployment', source, githubSha: sha,
    sleep: async ms => { sleeps.push(ms); }, logger: { warn: value => warnings.push(value) },
    fetchImpl: async () => { healthReads += 1; return healthyFetch()(); }
  });
  assert.equal(result.deployedVersionNumber, 202);
  assert.equal(healthReads, 2, 'one reconciliation request precedes the normal health read');
  assert.deepEqual(sleeps, [5000, 5000]);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every(value => value.startsWith('APPS_SCRIPT_DEPLOYMENT_VERSION_PENDING ')));
  assert.deepEqual(calls, ['getContent', 'updateContent', 'versions.list', 'versions.create',
    'deployments.update', 'deployments.get', 'deployments.get', 'deployments.get']);
  assert.deepEqual(script.lastDeploymentRead, {
    request: { scriptId: 'script', deploymentId: 'deployment' },
    options: { timeout: 12000, retry: false }
  });
});

test('newer, missing, and malformed deployment versions fail without polling or health acceptance', async () => {
  for (const [version, expectedCode] of [
    [203, 'ADVANCED'], [undefined, 'INVALID'], [null, 'INVALID'], [true, 'INVALID'],
    ['202', 'INVALID'], [0, 'INVALID'], [202.5, 'INVALID']
  ]) {
    const { script, calls } = makeScript({ createdVersion: 202, observedVersions: [version] });
    await assert.rejects(syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key',
      script, scriptId: 'script', deploymentId: 'deployment', source, githubSha: sha,
      sleep: async () => assert.fail('must not wait'), fetchImpl: async () => assert.fail('must not accept health')
    }), error => error.code === `APPS_SCRIPT_DEPLOYMENT_VERSION_${expectedCode}`);
    assert.equal(calls.filter(call => call === 'deployments.get').length, 1);
    assert.equal(calls.filter(call => call === 'deployments.update').length, 1);
  }
});

test('version visibility deadline bounds reads even when requests consume the wait budget', async () => {
  let clock = 0;
  const requests = [];
  const script = { projects: { deployments: { get: async (_request, options) => {
    requests.push(options);
    clock += 11000;
    return { data: { deploymentConfig: { versionNumber: 201 } } };
  } } } };
  await assert.rejects(verifyDeploymentVersion({
    script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    now: () => clock, sleep: async ms => { clock += ms; }
  }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH');
  assert.equal(requests.length, 6);
  assert.deepEqual(requests.at(-1), { timeout: 10000, retry: false });
});

test('a newer deployment observed after a stale read stops verification immediately', async () => {
  const { script, calls } = makeScript({ observedVersions: [201, 203, 202] });
  const sleeps = [];
  await assert.rejects(verifyDeploymentVersion({
    script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    sleep: async ms => { sleeps.push(ms); }
  }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_ADVANCED');
  assert.deepEqual(calls, ['deployments.get', 'deployments.get']);
  assert.deepEqual(sleeps, [5000]);
});

test('an expired deadline prevents the first read or any read after sleep', async () => {
  const first = makeScript({ deployedVersion: 201 });
  let ticks = 0;
  await assert.rejects(verifyDeploymentVersion({
    script: first.script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    now: () => ticks++ === 0 ? 0 : 90000
  }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH');
  assert.deepEqual(first.calls, []);
  const afterSleep = makeScript({ deployedVersion: 201 });
  let clock = 0;
  await assert.rejects(verifyDeploymentVersion({
    script: afterSleep.script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    now: () => clock, sleep: async () => { clock = 90000; }
  }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH');
  assert.deepEqual(afterSleep.calls, ['deployments.get']);
});

test('a matching read after the deadline is not accepted and transport errors are not masked', async () => {
  let clock = 0;
  const script = { projects: { deployments: { get: async () => {
    clock = 90001;
    return { data: { deploymentConfig: { versionNumber: 202 } } };
  } } } };
  await assert.rejects(verifyDeploymentVersion({
    script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    now: () => clock, sleep: async () => assert.fail('deadline is exhausted')
  }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERSION_MISMATCH');
  const denied = Object.assign(new Error('permission denied'), { code: 403 });
  script.projects.deployments.get = async () => { throw denied; };
  await assert.rejects(verifyDeploymentVersion({
    script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202,
    sleep: async () => assert.fail('transport errors are not retried')
  }), error => error === denied);
});

test('invalid verification bounds fail before any API read', async () => {
  for (const invalid of [{ attempts: 0 }, { attempts: 14 }, { retryDelayMs: -1 },
    { retryDelayMs: 5001 }, { versionNumber: 0 }]) {
    const { script, calls } = makeScript();
    await assert.rejects(verifyDeploymentVersion({
      script, scriptId: 'script', deploymentId: 'deployment', versionNumber: 202, ...invalid
    }), error => error.code === 'APPS_SCRIPT_DEPLOYMENT_VERIFICATION_CONFIGURATION_INVALID');
    assert.deepEqual(calls, []);
  }
});

test('stale lifecycle recipient policy is rejected after deployment advancement', async () => {
  const { script } = makeScript({ versionCount: 30, createdVersion: 202, deployedVersion: 202 });
  await assert.rejects(
    syncAppsScriptProject({ serviceRoleKey: 'synthetic-signing-key',
      script,
      scriptId: 'script',
      deploymentId: 'deployment',
      source,
      githubSha: sha,
      fetchImpl: healthyFetch({ lifecycleRecipientPolicyVersion: 'stale-policy' }),
      sleep: async () => {},
      healthAttempts: 1
    }),
    (error) => error.code === 'APPS_SCRIPT_DEPLOYMENT_HEALTH_POLICY_MISMATCH'
  );
});
