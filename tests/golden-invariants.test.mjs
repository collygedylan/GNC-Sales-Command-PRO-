import {withGoldenReclassAuthority,assertGoldenEvalReclassBoundaries,assertGoldenReclassExplanations} from './helpers/golden-reclass-authority.mjs';
import { buildColdHydrationJoinFixture } from '../src/core/golden-cold-hydration-fixture.mjs';
import {assertAuthenticatedTransientGateway} from '../src/core/golden-fail-open-contract.mjs';
import {assertEvidenceLifecycle} from '../src/core/golden-evidence-lifecycle.mjs';
import { boundedPilotIdleChecks } from '../src/core/pilot-idle-contract.mjs';
import { assertSourceGitWorktreeIsolation } from '../src/core/git-worktree-invariant.mjs';
import { assertWarmOwnerBenchmarkContract } from '../src/core/golden-warm-owner-contract.mjs';
import { assertExactRowEvaluationContract, assertDocksSuspendIntegrity, assertCurrentSocDockContract,
  assertCompletionCardsContract, assertErpFilenameAndWatchdogContract, assertSocSuspendMembership,
  assertSuspendRoutingAndDefaults } from '../src/core/golden-extracted-contracts.mjs';
import { sharePasskeyContract } from '../src/core/golden-share-contract.mjs';
import {invariant208, invariant492, invariant502, invariant523} from '../src/core/golden-boot-contract.mjs';
import { requestPhotoNavigationContract } from '../src/core/golden-request-photo-navigation.mjs';
import {invariant67, invariant78, invariant211, invariant218, invariant248, invariant322} from '../src/core/golden-shell-contract.mjs';
import { escapedTextContract } from '../src/core/golden-request-text.mjs';
import { invariant241, invariant306, invariant525 } from '../src/core/golden-request-access-contract.mjs';
import { badgeConnectionContract } from '../src/core/golden-badge-fixture.mjs';
import { monotonicProgressContract, slowMetadataContract, completedCheckpointContract, productionScheduleContract } from '../src/core/golden-erp-progress.mjs';
import { requestLifecycleContract } from '../src/core/golden-request-lifecycle.mjs';
import { erpXlsxCommitContract } from '../src/core/golden-erp-xlsx.mjs';
import {invariant41, invariant42, invariant51, invariant476, invariant522} from '../src/core/golden-update-policy.mjs';
import { boundedShellInstallation, networkFirstShell, staleUpdateNavigation, upgradeOpenWindows } from './helpers/pwa-shell-upgrade-contract.mjs';
import {invariant97, invariant115, invariant124} from '../src/core/golden-asset-contract.mjs';
import { erpApiAuthorizationContract, erpApiContinuationContract, emptyCloudCompletionContract } from '../src/core/golden-erp-api.mjs';
import { socXlsxContract } from '../src/core/golden-soc-xlsx.mjs';
import { reclassSeasonContract, reclassDestinationContract } from '../src/core/golden-reclass-fixtures.mjs';
import { photoParityContract } from '../src/core/golden-photo-parity.mjs';
import { workerActivationContract } from '../src/core/golden-worker-activation.mjs';
import { loginBootstrapContract } from '../src/core/golden-login-fixture.mjs';
import { foregroundDriverContract, continuationDelayContract, foregroundRestartContract, largeSocChunkContract, folderDiscoveryContract, manualSyncStartContract, operationalSourcesContract, busyStageContract, sealedPublicationContract } from '../src/core/golden-erp-driver.mjs';
import { watchdogDatesContract, progressStyleContract, weekdayContract, weekdaySerialContract, requestPublicationContract, facetRetirementContract, requestCompletionContract, managerSyncContract } from '../src/core/golden-support-contract.mjs';
import { bloomRoleActionContract, bloomProjectContract } from '../src/core/golden-bloom-role.mjs';
import { cloudContinuationContract, socIngestionContract, socYearContract, busyLeaseContract, privateRecoveryContract } from '../src/core/golden-cloud-continuation.mjs';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import {root,read,syntax,functionSource,expectedAppApiVersion,runFunctions,locationContext,plain} from './helpers/golden-test-environment.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { databaseBridge } from './helpers/database-bridge.mjs';
import { classifySupabaseCliFailure, formatSafeFailure } from '../scripts/apply-item-low-stock-migration.mjs';
import { appsScriptFilesDigest } from '../scripts/apps-script-function-patch.mjs';
import { writeAppsScriptHeadOnlyEvidence } from '../scripts/apps-script-recovery-evidence.mjs';
import { mappingFixtureRow, requestMappingFunctions, requestMappingSetup } from './helpers/customer-mapping-fixture.mjs';
import { invariant556, invariant557, invariant558, invariant559, invariant560, invariant561, invariant562 } from './helpers/golden-release-hydration-guard.mjs';
test('Invariant 1 (PC & Mobile Login Bootstrap)', () => loginBootstrapContract(runFunctions));
test('Invariant 2 (Zero 401/403/409/423 in app-api)', () => assertAuthenticatedTransientGateway(runFunctions));
test('Invariant 3 (Exact Two-Trigger Season Evidence Lifecycle)', () => assertEvidenceLifecycle({ runFunctions, read }));
test('Invariant 4 (Multi-Row Location Photo Upload & Retry)', async () => {
  let uploadOptions = null;
  const storage = { from: () => ({
    upload: async (_path, _blob, options) => { uploadOptions = options; return { error: null }; },
    getPublicUrl: filePath => ({ data: { publicUrl: `https://photos.invalid/${filePath}` } }),
  }) };
  const context = runFunctions('assets/app-runtime.js', ['uploadOptimizedBlobToStorage'], {
    PHOTO_BUCKETS: { REQUEST: 'request_photos' }, HIGH_VOLUME_PLANT_PHOTO_BUCKETS: new Set(),
    optimizePhotoBlobForUpload: async () => ({ blob: new Blob(['photo'], { type: 'image/jpeg' }), fileName: 'photo.jpg', contentType: 'image/jpeg', hash: 'sha' }),
    getSupabaseStorageClient: () => storage, withTimeout: promise => promise, SUPABASE_UPLOAD_TIMEOUT_MS: 30000,
    Blob, Object, String, Math,
  });
  const result = await context.uploadOptimizedBlobToStorage('request_photos', '007779.021.1/C.12.019/27.F1/photo.jpg', new Blob(['raw'], { type: 'image/jpeg' }));
  assert.equal(uploadOptions.upsert, true);
  assert.match(result.publicUrl, /photo\.jpg$/);
  const identity = runFunctions('assets/app-runtime.js', ['normalizeDriveEvidenceLocationPart', 'isSameDriveEvidenceLocation'], {
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
  });
  assert.equal(identity.isSameDriveEvidenceLocation(
    { ITEMCODE: '007779.021.1', LOCATIONCODE: 'C.12.019', LOTCODE: '27.F1' },
    { ITEMCODE: '007779.021.1', LOCATIONCODE: 'C.12.019', LOTCODE: '27.F1', DESIGITEM: 'DESIGITEM #' },
  ), true);
  assert.match(read('supabase/migrations/20261023220000_drive_location_evidence_and_request_reconciliation_v1.sql'), /where upper\(btrim\(m\.itemcode\)\)=stable_item and upper\(btrim\(m\.locationcode\)\)=stable_location[^]*limit 1/);
});
test('Invariant 5 (Drive Mode Card Thumbnail Parity With AV & Lightbox)', () => photoParityContract(runFunctions, functionSource, plain));
test('Invariant 6 (Eval Reports #2 Stacked locationcode Sorting & Zero Truncation)', () => {
  const client = locationContext({
    getManagerEvalReportRowLocation: row => row.locationcode,
    getDriveColumnItemValue: (row, key) => row[String(key).toLowerCase()] ?? row[key] ?? '',
    getManagerEvalReports2Api: () => ({ SEASON_ORDER: ['S1', 'F1'], normalizeSalesYear: Number }),
  });
  vm.runInContext([
    functionSource('assets/app-runtime.js', 'compareLocationCodeValues'),
    functionSource('assets/app-runtime.js', 'compareManagerEvalReport2Natural'),
    functionSource('assets/app-runtime.js', 'compareManagerEvalReport2InventoryRows'),
  ].join('\n'), client);
  const rows = [{ locationcode: 'G.20.000' }, { locationcode: 'D.04.000' }, { locationcode: 'F.19.000' }, { locationcode: 'D.04.000', lotcode: '27.F1' }];
  rows.sort(client.compareManagerEvalReport2InventoryRows);
  assert.deepEqual(rows.map(row => row.locationcode), ['D.04.000', 'D.04.000', 'F.19.000', 'G.20.000']);
  const server = runFunctions('supabase/functions/app-api/index.ts', ['compareLocationCodeNatural', 'sortManagerEval2PreviewRows']);
  const previewRows = Array.from({ length: 12 }, (_, index) => ({ locationcode: `C.${12 - index}.000`, lotcode: `27.${index}` }));
  const sorted = plain(server.sortManagerEval2PreviewRows({ rows: [{ previewRows }] }));
  assert.equal(sorted.rows[0].previewRows.length, 12);
  assert.deepEqual(sorted.rows[0].previewRows.slice(0, 3).map(row => row.locationcode), ['C.1.000', 'C.2.000', 'C.3.000']);
});
test('Invariant 7 (Eval Reports #2 BLOCK / LOCATION 2-Step Drill-Down)', () => {
  const context = locationContext();
  const codes = ['C.05.026', 'C.06.000', 'C.05.017', 'C.05.000'];
  const groups = context.LocationCode.group(codes);
  assert.deepEqual(Array.from(groups.keys()), ['C.05', 'C.06']);
  assert.deepEqual(Array.from(groups.get('C.05')), ['C.05.000', 'C.05.017', 'C.05.026']);
  assert.equal(context.LocationCode.base('C.05.017'), 'C.05');
  assert.equal(context.LocationCode.normalize('c.05.017').startsWith('C'), true);
});
test('Invariant 8 (Que REQUEST Five-State Lifecycle & Live Uncached Fetch)', () => requestLifecycleContract(runFunctions,locationContext,functionSource,read));
test('Invariant 9 (Recount Tab locationcode Grouping & Completion Email)', () => {
  const context = runFunctions('assets/app-runtime.js', ['buildReclassRecountLocationGroups'], {
    Array, Number, String, requestsInventory: [],
    fullInventory: [{ ITEMCODE: '000745.250.9', COMMONNAME: 'Taylor Juniper', CONTSIZE: '#25' }]
  });
  const groups = plain(context.buildReclassRecountLocationGroups([{
    id: 'job-1', itemcode: '006737.070.1', commonname: 'Unknown', locationcode: 'A.05.000', requested_by_username: 'requester',
    lines: [{ source_unique_id: 's1', lotcode: '27.S1', season: 'S1', on_hand: 5, available: 4, review: 1 }],
  }, {
    id: 'job-2', itemcode: '006737.070.1', commonname: 'Test Plant', locationcode: 'A.05.000', requested_by_username: 'requester',
    lines: [
      { source_unique_id: 's1', lotcode: '27.S1', season: 'S1', on_hand: 5, available: 4, review: 1 },
      { source_unique_id: 'u1', lotcode: '27.U1', season: 'U1', on_hand: 5, available: 3, review: 2 },
    ],
  }, {
    id: 'job-3', itemcode: '000745.250.1', commonname: 'Unknown', locationcode: 'B.05.000', requested_by_username: 'requester',
    lines: [{ source_unique_id: 't1', lotcode: '27.F1', season: 'F1', on_hand: 8, available: 6, review: 2 }],
  }]));
  assert.equal(groups.length, 2);
  assert.equal(groups[0].job_ids.length, 2);
  assert.equal(groups[0].commonname, 'Test Plant');
  assert.equal(groups[0].contsize, '#7');
  assert.equal(groups[0].locationcode, 'A.05.000');
  assert.equal(groups[0].system_on_hand, 10);
  assert.deepEqual(groups[0].lines.map(line => [line.lotcode, line.on_hand, line.available, line.review]), [['27.S1', 5, 4, 1], ['27.U1', 5, 3, 2]]);
  assert.equal(groups[1].commonname, 'Taylor Juniper');
  assert.equal(groups[1].contsize, '#25');
  assert.equal(new Set(groups.map(group => `${group.itemcode.toUpperCase()}|${group.locationcode.toUpperCase()}`)).size, groups.length);
  assert.match(functionSource('Code.gs', 'handleSignedReclassRecountCompletion_'), /On Hand[^]*Available[^]*Review[^]*countedTotal/);
  const surgicalMigration = read('supabase/migrations/20261025003000_agdata_v2361_surgical_restore.sql');
  const canonicalMigration = read('supabase/migrations/20261025013000_agdata_v2362_canonical_requests.sql');
  const uniformMigration = read('supabase/migrations/20261025023000_agdata_v2363_uniform_active_history_architecture.sql');
  assert.match(surgicalMigration, /ph_reclass_recount_jobs_pending_item_location_v2361_idx/);
  assert.match(surgicalMigration, /RECOUNT_NAME_UNRESOLVED/);
  assert.match(uniformMigration, /ph_active_recount[^]*ph_historical_inventory_dimensions[^]*regexp_replace[^]*identity_rank = 1/);
  assert.match(read('supabase/functions/app-api/index.ts'), /ph_active_recount\?select=id,itemcode,commonname/);
  assert.doesNotMatch(canonicalMigration, /drop table[^;]*ph_reclass_recount_jobs/i);
});
test('Invariant 10 (Reclass Move Up / Move Down Season-Wide Open Stock & Loc Photo Match Math)', () => reclassSeasonContract(runFunctions,read));
test('Invariant 11 (Green Velvet Boxwood 9-Column Reclass Inquiry Table)', () => {
  const context = runFunctions('Code.gs', ['buildReclassInlineOhText_', 'buildReclassItemInquiryTable_'], { sortReclassInquiryCompactRows_: rows => rows });
  const table = plain(context.buildReclassItemInquiryTable_({ identity: { commonname: 'Green Velvet Boxwood' }, rows: [{ unique_id: 'source', values: { lotcode: '27.S1', locationcode: 'A.03.000', source: 'BR', ptronhand: '275' }, actionValues: {}, changedFields: [] }], completedMoveSummary: [{ direction: 'move_up', quantity: 55, source: { unique_id: 'source' }, destination: { season: 'F1' } }] }));
  assert.deepEqual(table.columns.map(column => column[1]), ['Lotcode', 'Location', 'SOURCE', 'Priority', 'OH', 'PTRREVIEWED', 'Loc Note Date', 'LOCATIONPTN1', 'Location Note']);
  assert.equal(table.rows[0][4].text, '330 - 55 --> F1');
  assert.deepEqual(table.rows[0][4].proposals, []);
  assert.doesNotMatch(JSON.stringify(table.columns), /Action(?: Details)?/);
});
test('Invariant 12 (Zero-Scroll Home 12-Tile Fit)', () => {
  const runtime = read('assets/app-runtime.js');
  const styles = read('assets/app-styles.css');
  const pilotStyles = read('assets/ops-precision-pilot.css');
  const start = runtime.indexOf('        const HOME_MODULE_REGISTRY = Object.freeze([');
  const end = runtime.indexOf('        function normalizeRoleAccessToken', start);
  assert.ok(start >= 0 && end > start);
  const grid = { dataset: {}, innerHTML: '' };
  const context = vm.createContext({
    currentUser: 'dylan_collyge', nativeAuthSessionActive: true, nativeAuthSessionUserId: 'actor', nativeAuthProfile: { id: 'actor', username: 'dylan_collyge', role: 'super-admin' },
    PRIVILEGED_MANAGER_USER_KEYS: ['dylan_collyge', 'megan_kelly', 'jd_jones'], window: { innerWidth: 390 },
    document: { getElementById: () => grid }, buildFastInvokeAttrs: () => '', isAuthenticatedExecutiveUser: () => true,
  });
  vm.runInContext(runtime.slice(start, end) + '\n' + functionSource('assets/app-runtime.js', 'getHomeDesktopColumnCount'), context);
  context.ensureHomeModuleRegistry();
  assert.equal([...grid.innerHTML.matchAll(/data-home-module-view=/g)].length, 12);
  assert.equal(context.getHomeDesktopColumnCount(12), 3);
  assert.doesNotMatch(pilotStyles, /grid-template-rows:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
  const mobileStart = styles.lastIndexOf('@media (max-width: 767px)');
  const desktopStart = styles.indexOf('@media (min-width: 768px)', mobileStart);
  assert.ok(mobileStart >= 0 && desktopStart > mobileStart);
  const mobileStyles = styles.slice(mobileStart, desktopStart);
  assert.match(mobileStyles, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important/);
  assert.match(mobileStyles, /grid-auto-rows:\s*clamp\(/);
  assert.match(mobileStyles, /gap:\s*8px\s*!important/);
  assert.match(mobileStyles, /grid-template-rows:\s*none\s*!important/);
  assert.match(mobileStyles, /grid-auto-rows:\s*clamp\(54px,\s*calc\(\(100dvh - 265px\) \/ 6\),\s*72px\)\s*!important/);
  assert.match(mobileStyles, /\.home-module-tile\s*\{[^}]*min-height:\s*0\s*!important[^}]*height:\s*100%\s*!important[^}]*max-height:\s*100%\s*!important/);
  for (const viewportHeight of [568, 667, 740, 844, 932]) {
    const tileHeight = Math.min(72, Math.max(54, (viewportHeight - 265) / 6));
    const rows = Array.from({ length: 6 }, (_, index) => ({ top: index * (tileHeight + 8), bottom: index * (tileHeight + 8) + tileHeight }));
    assert.ok(rows.every(row => row.bottom - row.top >= 50 && row.bottom - row.top <= 72));
    for (let index = 0; index < rows.length - 1; index += 1) assert.ok(rows[index + 1].top >= rows[index].bottom + 6);
    assert.ok(rows[5].bottom + 185 <= viewportHeight);
  }
  assert.match(grid.innerHTML, /Production[^]*Smart Sales (?:&amp;|&) Move|Smart Sales (?:&amp;|&) Move[^]*Production/);
});
test('Invariant 13 (#view-smart-moves Immediate Hydration)', async () => {
  const calls = [];
  let rendered = 0;
  const context = runFunctions('assets/app-runtime.js', ['warmSalesIntelligenceData'], {
    currentUser: 'dylan_collyge', salesIntelligenceWarmPromise: null, salesIntelligenceWarmAttemptedAt: 0,
    salesIntelligenceCache: { key: 'stale', model: {} }, fullInventory: [{ ITEMCODE: 'A' }],
    selectAvSalesInventorySourceRows: () => [{ ITEMCODE: 'A' }], isDatasetLoaded: () => false,
    ensureDatasetLoaded: async (key, mode, options) => { calls.push([key, mode, options.force]); return true; },
    getCurrentVisibleViewId: () => 'smart-moves', renderSmartMovesIntelligence: () => { rendered += 1; }, Date, Promise,
  });
  await context.warmSalesIntelligenceData();
  assert.deepEqual(calls.slice(0, 3), [['master', 'full', true], ['soc', 'full', true], ['reserves', 'full', true]]);
  assert.equal(rendered, 1);
  assert.match(functionSource('assets/app-runtime.js', 'switchView'), /smart-moves[^]*warmSalesIntelligenceData/);
});
test('Invariant 14 (RUN SCRIPT Lock Override & Instant Home File Cards)', () => {
  const code = runFunctions('Code.gs', ['getManualSyncStageOrder_'], { MANUAL_SYNC_STAGE_ORDER_DEFAULT: ['drive', 'soc', 'reserves', 'cav'], String });
  assert.deepEqual(Array.from(code.getManualSyncStageOrder_('all')), ['drive', 'soc', 'reserves', 'cav']);
  const runtime = runFunctions('assets/app-runtime.js', ['dashboardFilenameTimestamp', 'selectDashboardSyncFilename']);
  assert.equal(runtime.selectDashboardSyncFilename(['DriveAround_20261022090000.xlsx', 'DriveAround_20261023123000.xlsx']), 'DriveAround_20261023123000.xlsx');
  assert.match(functionSource('assets/app-runtime.js', 'runGoogleAppsScriptTrigger'), /force:\s*true/);
  assert.match(functionSource('Code.gs', 'queueManualSyncRequest_'), /force/);
  assert.match(functionSource('Code.gs', 'moveAndNormalizeDriveAroundProcessedFiles_'), /processedFolder/);
});
test('Invariant 15 (Cross-Layer Seam & Schema Contract Integrity)', () => {
  const normalizer = runFunctions('assets/app-runtime.js', ['normalizeDriveEvidenceLocationPart'], {});
  assert.equal(normalizer.normalizeDriveEvidenceLocationPart(' e.10.000 '), 'E.10.000');
  const migration = read('supabase/migrations/20261023220000_drive_location_evidence_and_request_reconciliation_v1.sql');
  const api = read('supabase/functions/app-api/index.ts');
  const appsScript = read('Code.gs');
  for (const key of ['itemcode', 'locationcode', 'lotcode']) {
    assert.match(migration, new RegExp(`\\b${key}\\b`));
    assert.match(api, new RegExp(`\\b${key}\\b`, 'i'));
    assert.match(appsScript, new RegExp(`\\b${key}\\b`, 'i'));
  }
  assert.match(migration, /inventory_location_evidence_v1[^]*reconcile_active_requests_from_outbox_v1/);
  assert.doesNotMatch(migration, /delete from public\.ph_active_request/i);
});
test('Invariant 16 (Watchdog-to-Skill & Symbol Index Auto-Triage)', async () => {
  const storage = new Map([['agdata.runtime-watchdog.pending.v2:dylan_collyge', JSON.stringify([{ username: 'dylan_collyge', fingerprint: 'old', app_version: 'AgData v2.3.54' }])]]);
  const rootNode = { querySelectorAll: () => [] };
  const document = { hidden: false, body: { ...rootNode, dataset: { currentView: 'drive' } }, documentElement: null,
    querySelector: () => null, getElementById: () => null, addEventListener() {} };
  const reports = [];
  const window = { __APP_RELEASE_VERSION__: 'AgData v2.3.57', activeHomeTab: '',
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout, clearTimeout, addEventListener() {} };
  const context = vm.createContext({ window, document, MutationObserver: class { observe() {} }, setTimeout, clearTimeout, console });
  vm.runInContext(read('assets/runtime-watchdog.js'), context, { filename: 'assets/runtime-watchdog.js' });
  window.GncRuntimeWatchdog.configure({ username: 'dylan_collyge', role: 'Admin', reportEvent: async event => { reports.push(event); return { ok: true }; } });
  const index = JSON.parse(read('docs/architecture/agdata-symbol-index.json'));
  const cases = [
    ['home', 'refreshDashboardSyncMetadata'], ['drive', 'renderDrive'], ['av', 'renderAV'], ['docks', 'renderDocks'],
    ['request', 'renderRequest'], ['managers', 'renderManagerEvalReports2Panel'], ['bloom', 'renderBloomPickerTrayRows'], ['chat', 'renderCommunicationHub'],
  ];
  for (const [viewId, symbol] of cases) {
    const event = window.GncRuntimeWatchdog.record('GOLDEN_TRIAGE', { view_id: viewId, suspected_functions: [symbol] });
    assert.equal(event.app_version, 'AgData v2.3.57');
    const skillPath = path.join(root, '.codex', 'skills', event.owning_skill, 'SKILL.md');
    assert.equal(readFileSync(skillPath, 'utf8').length > 0, true);
    const domain = index.domains[event.owning_skill];
    assert.ok(domain);
    assert.equal(Object.values(domain).flatMap(value => Array.isArray(value) ? value : []).includes(symbol), true, `${event.owning_skill}:${symbol}`);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal([...storage.values()].some(value => String(value).includes('AgData v2.3.54')), false);
  assert.equal(reports.every(event => event.app_version === 'AgData v2.3.57'), true);
});
test('Invariant 17 (Non-Blocking Que Recovery & Mobile Home Fit)', () => {
  const api = read('supabase/functions/app-api/index.ts');
  const migration = read('supabase/migrations/20261025003000_agdata_v2361_surgical_restore.sql');
  const canonicalMigration = read('supabase/migrations/20261025013000_agdata_v2362_canonical_requests.sql');
  const uniformMigration = read('supabase/migrations/20261025023000_agdata_v2363_uniform_active_history_architecture.sql');
  const runtime = read('assets/app-runtime.js');
  assert.match(api, /Promise\.resolve\(supabase\.rpc\("reconcile_active_requests_from_outbox_v1"\)\)[^]*runtime\.waitUntil\(reconciliationTask\)/);
  assert.doesNotMatch(api, /await supabase\.rpc\("reconcile_active_requests_from_outbox_v1"\)/);
  assert.match(migration, /scope','recent-outbox-cutoff-v2361/);
  assert.match(migration, /jsonb_array_elements[^]*insert into public\.ph_active_request/);
  assert.match(migration, /request_source[^]*customeridentityid[^]*consigneeidentityid/);
  assert.match(migration, /perform private\.upsert_request_history[^]*pending_recovered/);
  assert.match(runtime, /fetchAllSupabaseRows\(ACTIVE_REQUEST_TABLE, query, readOptions\)/);
  assert.match(runtime, /fetchActiveRequestLiveRows:canonicalPending/);
  assert.match(runtime, /homeSyncMetadata:\$\{table\}[^]*retained:\s*true/);
  assert.match(runtime, /\['DRIVE', 'CAV', 'RESERVES', 'SOC'\]\.map/);
  assert.match(runtime, /\['ph_master_inventory', 'ph_soc_master', 'ph_reserves', 'ph_cav_import'\]/);
  assert.match(runtime, /syncPanel\.open = true/);
  assert.match(runtime, /syncPanel\.dataset\.viewportDefaultApplied = 'true'/);
  assert.match(runtime, /clearPersistedManualSyncStartupState\(\)[^]*manualSyncStatusState = null/);
  assert.match(functionSource('assets/app-runtime.js', 'renderHome'), /syncGoogleScriptButton\(\);[^]*updateDashboardSyncSummary\(\);/);
  assert.match(api, /currentStage:"idle"[^]*message:"Connected • ready"/);
  assert.match(migration, /stageIndex',0[^]*currentStage','idle'/);
  assert.match(canonicalMigration, /table_schema='archive_backup'[^]*alter table archive_backup/);
  assert.match(canonicalMigration, /MANUAL_SYNC_NOT_IDLE/);
  assert.match(canonicalMigration, /when 'drive' then array\['public\.ph_master_inventory'\]/);
  assert.match(canonicalMigration, /when 'request' then array\['public\.ph_requests_pending'\]/);
  assert.match(uniformMigration, /ph_00_table_directory[^]*\(210, 'Walkie'/);
  const malformedMiddleDot = String.fromCodePoint(0x00c3, 0x201a, 0x00c2, 0x00b7);
  assert.equal(read('assets/request-sales-impact.js').includes(malformedMiddleDot), false);
  assert.equal(runtime.includes(malformedMiddleDot), false);
  assert.match(read('assets/request-sales-impact.js'), /final lines \\u2022/);
});
test('Invariant 18 (Numeric Que Badge & Connected Startup State)', () => badgeConnectionContract(runFunctions,functionSource,read));
test('Invariant 19 (Exact Pending Request Quantity Recovery)', () => {
  const migration = read('supabase/migrations/20261023234500_request_quantity_recovery_v3.sql');
  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  for (const uniqueId of ['REQ-mvlgbfl7p8r8zxrj97j', 'REQ-mvlg4t85vlzf7053pv', 'REQ-mvlfib5eqwa3typzcqq',
    'REQ-mvlfib5evawvlvvx09', 'REQ-mvlex5bay7ngnehzi7', 'REQ-mvlbp5hkkk58akaubms', 'REQ-mvk1xgv2ty9fttuqj2']) assert.match(migration, new RegExp(uniqueId));
  assert.equal((migration.match(/,'1'::text\)/g) || []).length >= 10, true);
  assert.match(migration, /'REQ-mvlbp5hkkk58akaubms','003139\.250\.1','A\.08\.000','10'::text/);
  assert.match(migration, /'REQ-mvk1xgv2ty9fttuqj2','008280\.150\.1','C\.05\.000','4'::text/);
  assert.match(migration, /app_dataset_revision_updated/);
  assert.doesNotMatch(migration, /update\s+public\.ph_request_delivery_outbox/i);
  assert.match(runner, /requestQuantityRecoveryMigrationName[^]*20261023234500_request_quantity_recovery_v3\.sql/);
});
test('Invariant 20 (Role-Controlled Exact-ID Request Sales Dollar Impact)', async () => {
  const impact = await import(new URL('../assets/request-sales-impact.js', import.meta.url));
  const rows = [
    { unique_id: 'LINE-A', folder_id: 'REQ-A', itemcode: 'ITEM-1', locationcode: 'A.01', lotcode: 'L1', qty: 10, list_price: 100,
      status: 'Pending', sales_rep: 'Rep One', customer_name: 'Customer One', consignee_name: 'Consignee One' },
    { unique_id: 'LINE-A', folder_id: 'REQ-A', itemcode: 'ITEM-1', locationcode: 'A.01', lotcode: 'L1', qty: 10, list_price: 100,
      status: 'Completed', sales_rep: 'Rep One', customer_name: 'Customer One', consignee_name: 'Consignee One' },
    { unique_id: 'LINE-B', folder_id: 'REQ-B', itemcode: 'ITEM-2', locationcode: 'B.02', lotcode: 'L2', qty: null, list_price: 8.75,
      status: 'Pending', sales_rep: 'Rep One', customer_name: 'Customer One', consignee_name: 'Consignee One' },
    { unique_id: 'LINE-B', folder_id: 'REQ-B', itemcode: 'ITEM-2', locationcode: 'B.02', lotcode: 'L2', qty: 0, list_price: 8.75,
      status: 'Completed', sales_rep: 'Rep One', customer_name: 'Customer One', consignee_name: 'Consignee One' },
  ];
  const result = impact.aggregateRequestSalesImpactLines(rows);
  assert.equal(result.summary.total_line_items, 4);
  assert.equal(result.summary.total_requests, 2);
  assert.equal(result.summary.total_units_requested, 70);
  assert.equal(result.summary.explicit_qty_line_count, 2);
  assert.equal(result.summary.default_25_qty_line_count, 2);
  assert.equal(result.summary.total_dollar_value, 2437.5);
  assert.equal(result.summary.completed_dollar_value, 1218.75);
  assert.equal(result.by_sales_rep[0].total_dollar_value, 2437.5);
  assert.equal(result.by_customer_consignee[0].items.find(item => item.itemcode === 'ITEM-1').line_dollar_value, 1000);
  assert.equal(result.by_customer_consignee[0].items.find(item => item.itemcode === 'ITEM-2').line_dollar_value, 218.75);
  const billyBobs = impact.aggregateRequestSalesImpactLines([
    { unique_id: 'BILLY-1', source_row_id: 'ph_requests_completed_history:BILLY-1', folder_id: 'Billy Bobs',
      sales_rep: 'Sammy Cult', itemcode: '001723.030.1', qty: 35, list_price: 3, status: 'Completed' },
    { unique_id: 'BILLY-2', source_row_id: 'ph_requests_completed_history:BILLY-2', folder_id: 'Billy Bobs',
      sales_rep: 'Sammy Cult', itemcode: '009372.010.1', qty: null, list_price: 2, status: 'Completed' },
  ]);
  assert.equal(billyBobs.summary.total_dollar_value, 155);
  assert.deepEqual(billyBobs.line_items.map(item => item.effective_qty), [35, 25]);

  const preserved = impact.aggregateRequestSalesImpactLines([
    { unique_id: 'UID-SHARED', source_row_id: 'ph_requests_completed_history:1', folder_id: 'REQ-SAME', itemcode: 'ITEM-3',
      locationcode: 'C.01', lotcode: 'L3', row_index: 1, qty: 2, list_price: 10, status: 'Pending' },
    { unique_id: 'UID-SHARED', source_row_id: 'ph_requests_pending:9', folder_id: 'REQ-SAME', itemcode: 'ITEM-3',
      locationcode: 'C.01', lotcode: 'L3', row_index: 1, qty: 2, list_price: 10, status: 'Completed' },
    { unique_id: 'UID-SEPARATE', source_row_id: 'ph_requests_completed_history:2', folder_id: 'REQ-SAME', itemcode: 'ITEM-3',
      locationcode: 'C.01', lotcode: 'L3', row_index: 1, qty: 3, list_price: 10, status: 'Completed' },
    { source_row_id: 'ph_requests_completed_history:3', folder_id: '', request_date: '2026-01-01', itemcode: 'ITEM-4',
      locationcode: '', lotcode: '', row_index: 1, qty: 1, list_price: 5, status: 'Completed' },
    { source_row_id: 'ph_requests_completed_history:4', folder_id: '', request_date: '2026-02-01', itemcode: 'ITEM-4',
      locationcode: '', lotcode: '', row_index: 1, qty: 1, list_price: 5, status: 'Completed' },
    { folder_id: 'REQ-MULTI', itemcode: 'ITEM-5', locationcode: 'D.01', lotcode: 'L5', row_index: 1,
      qty: 1, list_price: 7, status: 'Pending' },
    { folder_id: 'REQ-MULTI', itemcode: 'ITEM-5', locationcode: 'D.01', lotcode: 'L5', row_index: 1,
      qty: 1, list_price: 7, status: 'Completed' },
    { folder_id: 'REQ-MULTI', itemcode: 'ITEM-5', locationcode: 'D.01', lotcode: 'L5', row_index: 2,
      qty: 1, list_price: 7, status: 'Completed' },
  ]);
  assert.equal(preserved.summary.total_line_items, 8);
  assert.equal(preserved.line_items.filter(item => item.folder_id === 'REQ-SAME').length, 3);
  assert.equal(preserved.line_items.filter(item => item.folder_id.startsWith('ph_requests_completed_history:')).length, 2);
  assert.equal(preserved.line_items.filter(item => item.folder_id === 'REQ-MULTI').length, 3);
  assert.deepEqual(new Set(preserved.line_items.filter(item => item.unique_id === 'UID-SHARED').map(item => item.status)), new Set(['Pending', 'Completed']));

  const migration = read('supabase/migrations/20261025013000_agdata_v2362_canonical_requests.sql');
  const api = functionSource('supabase/functions/app-api/index.ts', 'handleRequestSalesImpactAction');
  const databaseTypes = read('supabase/functions/_shared/database.types.ts');
  const databaseContracts = read('services/database-contracts.generated.ts');
  const runtime = read('assets/app-runtime.js');
  const moduleSource = read('assets/request-sales-impact.js');
  for (const marker of ['ph_requests_pending', 'ph_requests_completed_history', 'line_identity_key',
    'source_row_id', 'source_table_audit', 'canonical-three-table-v2362', 'ph_master_inventory',
    'request_qty', 'effective_qty', 'unit_list_price', '00_app_view_table_map']) {
    assert.ok(migration.replaceAll(' ', '').includes(marker.replaceAll(' ', '')), marker);
  }
  assert.match(migration, /set statement_timeout='10s'/);
  assert.doesNotMatch(migration, /\.select\s*\(/);
  assert.match(migration, /revoke all on function public\.get_request_sales_impact_v2\(\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.get_request_sales_impact_v2\(\) to service_role/);
  assert.match(api, /resolveModuleAllowed\(supabase, actor, "request-sales-impact"\)[^]*enabled:\s*false[^]*visible:\s*false[^]*rows:\s*\[\]/);
  assert.match(api, /supabase\.rpc\("get_request_sales_impact_v2"\)/);
  assert.match(databaseTypes, /ph_requests_pending:\s*\{/);
  assert.match(databaseTypes, /ph_requests_completed_history:\s*\{/);
  assert.match(databaseTypes, /get_request_sales_impact_v2:\s*\{ Args: never; Returns: Json \}/);
  assert.match(databaseContracts, /"get_request_sales_impact_v2":\s*\{[^]*?"json"/);
  assert.match(moduleSource, /canonical-active-history-v2363/);
  assert.match(moduleSource, /payload\.source_table_audit \|\| payload\.source_audit/);
  assert.match(moduleSource, /One permanent line per request/);
  assert.match(api, /REQUEST_SALES_IMPACT_CONTRACT_STALE/);
  assert.match(runtime, /function isRequestSalesImpactOwner\(\)[^]*navigationPreferencesAllowed\('request-sales-impact'/);
  assert.match(runtime, /document\.getElementById\('view-request-sales-impact'\)\?\.remove\(\)/);
  assert.doesNotMatch(read('index.html'), /id="view-request-sales-impact"|drawer-request-sales-impact-btn/);
});
test('Invariant 21 (Zero Cross-Request Deduplication)', async () => {
  const impact = await import(new URL('../assets/request-sales-impact.js', import.meta.url));
  const shared = {
    unique_id: 'STRICT-SHARED', folder_id: 'REQ-SHARED', itemcode: 'ITEM-9', contsize: '#5',
    locationcode: 'Z.09', lotcode: 'LOT-9', request_date: '2026-10-20T15:00:00Z',
    sales_rep: 'Rep One', customer_name: 'Customer One', consignee_name: 'Consignee One', qty: 2, list_price: 10,
  };
  const result = impact.aggregateRequestSalesImpactLines([
    { ...shared, source_row_id: 'ph_requests_completed_history:1', status: 'Completed' },
    { ...shared, source_row_id: 'ph_requests_pending:1', status: 'Pending' },
    { ...shared, unique_id: 'STRICT-SEPARATE-1', source_row_id: 'ph_requests_completed_history:2', status: 'Completed' },
    { ...shared, unique_id: 'STRICT-SEPARATE-2', source_row_id: 'ph_requests_completed_history:3', status: 'Completed' },
  ]);
  assert.equal(result.summary.total_line_items, 4);
  assert.equal(result.summary.total_dollar_value, 80);
  assert.equal(result.line_items.filter(row => row.source_row_id === 'ph_requests_completed_history:1').length, 1);
  assert.equal(result.line_items.filter(row => row.folder_id === 'REQ-SHARED').length, 4);
  assert.equal(new Set(result.line_items.map(row => row.unique_id)).size, 3);
});
test('Invariant 22 (Canonical Escaped Plant Text Across Display and Drill Keys)', () => escapedTextContract(runFunctions,read,functionSource));
import { assertRequestHistoryIsolatedSync } from '../src/core/golden-request-history-isolated-sync.mjs';
test('Invariant 23 (Permanent Request History, Source-Line Ledger & Isolated Sync)', () => assertRequestHistoryIsolatedSync(read));
test('Invariant 24 (Anonymous Security Lockdown & Authenticated Request Browser Gate)', () => {
  const migration = read('supabase/migrations/20261025080000_agdata_v2365_anon_security_hardening.sql');
  assert.match(migration, /revoke insert, update, delete, truncate on all tables in schema public from anon/);
  assert.match(migration, /permissive = 'PERMISSIVE'[^]*cmd in \('ALL', 'INSERT', 'UPDATE', 'DELETE'\)/);
  assert.match(migration, /ZERO_TRUST_ANON_WRITE_GRANT_REMAINED/);
  assert.match(migration, /ZERO_TRUST_ANON_MUTATION_POLICY_REMAINED/);
  assert.match(migration, /ZERO_TRUST_ANON_SENSITIVE_READ_REMAINED/);
  for (const relation of ['ph_app_users', 'profiles', 'user_access_control', 'role_access_baselines',
    'ph_request_delivery_outbox', 'ph_request_email_threads', 'ph_requests_pending',
    'ph_requests_completed_history', 'ph_request_history']) {
    assert.match(migration, new RegExp(`'${relation}'`));
  }
  assert.doesNotMatch(migration, /\bdrop\s+table\b|\btruncate\s+table\b/i);

  const authenticatedRead = functionSource('assets/app-runtime.js', 'fetchAuthenticatedSupabaseReadPage');
  assert.match(authenticatedRead, /requestAuthorizedDatasetReadPage/);
  assert.doesNotMatch(authenticatedRead, /fetchPublicActiveRequestFallbackPage|anon-compatibility/);
  assert.doesNotMatch(read('assets/app-runtime.js'), /rest\/v1\/ph_active_request/);
  assert.match(functionSource('assets/app-runtime.js', 'historicalRequestsTransport'),
    /postAppFunctionJson[^]*action:\s*'historical_requests_read'/);

  const historyHandler = functionSource('supabase/functions/app-api/index.ts', 'handleHistoricalRequestsReadAction');
  assert.match(historyHandler, /session\.authUserId[^]*actorId/);
  assert.match(historyHandler, /operation\.startsWith\("archive-"\)[^]*historical_archive_read_v2368[^]*historical_requests_read_v2368/);
  assert.match(historyHandler, /SUPABASE_SERVICE_ROLE_KEY[^]*Authorization:\s*authorization/);
  assert.match(functionSource('supabase/functions/app-api/index.ts', 'handleRequestSalesImpactAction'),
    /canonical-active-history-v2363/);

  const impactFix = read('supabase/migrations/20261025081000_agdata_v2365_sales_impact_union_fix.sql');
  assert.doesNotMatch(impactFix, /select history\.\*,/);
  assert.match(impactFix, /history\.unique_id, history\.request_folder[^]*explicit-completed-history-union-v2365/);
  assert.match(impactFix, /completed_dollar_value'\)::numeric, 0\) < 6067786\.53/);

  const appApi = read('supabase/functions/app-api/index.ts');
  const projectionFields = appApi.match(/ph_requests_pending:\s*"([^"]+)"/)?.[1].split(',') || [];
  const contracts = read('services/database-contracts.generated.ts');
  const requestContractStart = contracts.indexOf('"ph_requests_pending":');
  const requestContractEnd = contracts.indexOf('"insert":', requestContractStart);
  const requestRowContract = contracts.slice(requestContractStart, requestContractEnd);
  assert.ok(projectionFields.length >= 116, 'the complete request projection stays guarded');
  for (const field of projectionFields) assert.match(requestRowContract, new RegExp(`"${field}"\\s*:`));
  assert.match(read('supabase/functions/_shared/database.types.ts'), /ph_requests_pending:[^]*photos: Json[^]*source_snapshot: Json/);

  const verifier = read('scripts/verify-live-request-queue.mjs');
  for (const marker of ['ph_app_users', 'user_access_control', 'ph_request_delivery_outbox',
    'ph_requests_completed_history', "['POST'", "['PATCH'", "['DELETE'", '#historical-requests-title',
    '#historical-request-sales-impact-btn', 'requestSalesImpactTotal', 'minimumRequestImpact', "release.includes('2.3.69')"]) {
    assert.match(verifier, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(verifier, /response\.ok[^]*payload\.length !== 0/);
  assert.match(verifier, /!\[401, 403\]\.includes\(response\.status\)/);

  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  assert.match(runner, /agdataV2365AnonSecurityHardeningMigrationName[^]*registeredReleaseDatabaseMigrations/);
  assert.match(runner, /agdataV2365SalesImpactUnionFixMigrationName[^]*registeredReleaseDatabaseMigrations/);
});
test('Invariant 25 (Indexed Four-Domain Historical Archive)', () => {
  const migration = read('supabase/migrations/20261025220000_agdata_v2366_historical_archive.sql');
  for (const table of ['ph_orders_history', 'ph_reserves_history', 'ph_drive_mode_history_files', 'ph_drive_mode_history']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`${table}[^]*create index|create index[^]*${table}`));
  }
  for (const marker of ['historical_archive_read_v1', 'ph_soc_master_archive_v2366', 'ph_reserves_archive_v2366',
    'ph_drive_files_archive_v2366', 'ph_drive_evidence_archive_v2366', 'HISTORICAL_ARCHIVE_RETENTION_PROTECTED',
    'HISTORICAL_PHOTO_RETENTION_PROTECTED', 'row.file_id=path_2', 'source.itemcode=dimension.itemcode']) assert.match(migration, new RegExp(marker));
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i);
  assert.doesNotMatch(migration, /(?:^|\n)\s*truncate\s/i);
  assert.doesNotMatch(migration, /count\(\*\)[^;]*ph_drive_around_report_rows/i);

  const view = read('components/historical-requests/HistoricalRequestsView.tsx');
  for (const label of ['Historical Requests', 'Historical SOC Open Orders', 'Historical SOC Reserves', 'Historical Drive Around']) {
    assert.match(view, new RegExp(label));
  }
  assert.match(view, /Search this archive/);
  const importer = read('scripts/fast-historical-archive-import.mjs');
  for (const marker of ['defaultBatchSize = 2_000', 'defaultWorkers = 16', 'jsonb_to_recordset', 'sha256',
    'historicalImportWindowOpen', 'application\/vnd\.google-apps\.spreadsheet', 'supportedExtensions = new Set']) assert.match(importer, new RegExp(marker));
  assert.match(importer, /'\.csv', '\.xlsx'/);
  assert.match(read('assets/app-runtime.js'), /\['master', 'soc', 'reserves', 'requests', 'requestHistory', 'customerRepMap'\]/);
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'), /agdataV2366HistoricalArchiveMigrationName[^]*registeredReleaseDatabaseMigrations/);
});
test('Invariant 26 (Silent Recount and Bunch Notes Queue Resolution)', () => {
  const migration = read('supabase/migrations/20261025234500_agdata_v2366_queue_resolution_cleanup.sql');
  for (const marker of ['queue_cleanup_recount_jobs_v2366', 'queue_cleanup_bunch_jobs_v2366',
    'queue_cleanup_sales_recounts_v2366', "status = 'completed'", "then 'retired'",
    'ph_ncr_completions', 'QUEUE_CLEANUP_RECOUNT_ACTIVE_ROWS_REMAIN',
    'QUEUE_CLEANUP_BUNCH_ACTIVE_ROWS_REMAIN', 'QUEUE_CLEANUP_OUTBOX_CHANGED',
    'REQ-mvk1xgv2ty9fttuqj2', 'REQ-mvlbp5hkkk58akaubms', 'REQ-mvlfib5eqwa3typzcqq',
    'REQ-mvlfib5evawvlvvx09', 'REQ-mvlg4t85vlzf7053pv', 'REQ-mvlgbfl7p8r8zxrj97j',
    'Pink Delight Butterfly Bush', 'queue-resolution-cleanup-v2366']) {
    assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.ph_request_delivery_outbox/i);
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.ph_delivery_outbox/i);
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.ph_requests_pending/i);
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.ph_soc_master/i);
  assert.doesNotMatch(migration, /\btruncate\b|\bdrop\s+table\b/i);

  const verifier = read('scripts/verify-live-request-queue.mjs');
  for (const marker of ['queueProof', 'RECOUNT ${recountBadgeCount}', 'BUNCH NOTES ${bunchBadgeCount}',
    'SUSPEND ${suspendBadgeCount}', 'No recount rows.', 'No Bunch Notes in this filter.',
    'Pink Delight Butterfly Bush', '[data-bunch-card]']) {
    assert.match(verifier, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'),
    /agdataV2366QueueResolutionCleanupMigrationName[^]*registeredReleaseDatabaseMigrations/);
});
test('Invariant 27 (Historical State Deduplication and Manual Inventory Consolidation)', () => {
  const dedup = read('supabase/migrations/20261026003000_agdata_v2366_historical_state_dedup.sql');
  for (const marker of ['deduplicate_drive_around_report_rows_batch_v1(p_max_files integer default 25)',
    'row_state_hash', 'seen_count', "time '23:30'", "time '06:15'", "set statement_timeout='4500ms'",
    'historical_archive_read_v2']) assert.match(dedup, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(dedup, /(?:^|\n)\s*truncate\s/i);

  const consolidation = read('supabase/migrations/20261026004500_agdata_v2366_inventory_consolidation.sql');
  for (const marker of ["array['#2','#3','#1','2DP','3DP','1GP','8DP','8 IN.','5DP','7DP','QT','2QTD','6QTD','8\" P','3GP','1DP']",
    'source.loc_on_hand>0 and source.loc_on_hand<100', 'source.sales_year<current_sales_year or candidate.sales_year=source.sales_year',
    'inventoryConsolidation', 'destination_salesyear']) assert.match(consolidation, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(consolidation, /insert\s+into\s+public\.ph_requests_pending/i);

  const html = read('index.html');
  for (const marker of ['inventory-open-suggestions', 'view-inventory-suggestion', 'view-inv-consolidation']) assert.match(html, new RegExp(marker));
  const runtime = read('assets/app-runtime.js');
  for (const marker of ['INVENTORY_CONSOLIDATION_SIZES', 'openInventorySuggestionView', 'openInventoryConsolidationView',
    'Nothing enters Location Moves until you click Send.', 'Send to Location Moves']) assert.match(runtime, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(read('supabase/functions/app-api/index.ts'), /inventory_consolidation_suggestions_v1/);
  assert.match(read('supabase/migrations/20261026010000_agdata_v2366_inventory_consolidation_sales_year_fix.sql'),
    /inventory_consolidation_sales_year_v2366\(private\.season_sales_settings_v1\(\)->>''salesYear'',null\)/);
  const consolidationCache = read('supabase/migrations/20261026011500_agdata_v2366_inventory_consolidation_cache.sql');
  for (const marker of ['inventory_consolidation_cache_v2366', 'refresh_inventory_consolidation_cache_v2366',
    "set statement_timeout='500ms'", 'background refresh never creates Queue work']) assert.match(consolidationCache, new RegExp(marker));
  assert.match(read('supabase/migrations/20261026013000_agdata_v2366_historical_archive_page_dedup.sql'),
    /select distinct on \(state_hash\)[^]*state-dedup-v2366/);
  assert.match(read('supabase/migrations/20261026014500_agdata_v2366_drive_archive_search_hash_fix.sql'),
    /drive-search-row-alias-v2366[^]*drive_around_report_state_hash_v2366\(raw_row\)/);
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'), /agdataV2366HistoricalStateDedupMigrationName[^]*agdataV2366InventoryConsolidationMigrationName[^]*registeredReleaseDatabaseMigrations/);
});
test('Invariant 28 (Strict Crop Tiers and Canonical AURA Nursery Glossary)', () => {
  const migration = read('supabase/migrations/20261026020000_agdata_v2367_crop_tier_aura_glossary.sql');
  for (const marker of ['get_consolidation_move_candidates_v1', "'CARRY_OVER'", "'CURRENT_CROP'", "'FUTURE_CROP'",
    'source_profile.max_sales_year<settings.current_sales_year', 'source_profile.min_sales_year=settings.current_sales_year',
    'destination_profile.max_sales_year<settings.current_sales_year', 'destination_profile.min_sales_year=settings.current_sales_year',
    'candidate.sales_year=source.sales_year', 'get_consolidation_move_candidates_v1() candidate',
    'aura_inventory_crop_tier_v1', 'definition text', "synonyms text[]"]) {
    assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const term of ['carry over','current crop','future crop','inv consolidation','loc photo match','request sales impact',
    'mistake guy','historical orders','historical reserves','historical drive around','location moves','suspend tag',
    'recount','bunch notes','eval work','shear list']) assert.match(migration, new RegExp(`'${term}'`));
  assert.match(read('supabase/migrations/20261026034500_agdata_v2367_historical_drive_fast_read.sql'),
    /historical_drive_file_page_v2367[^]*item_key_v2367[^]*state_hash_v2367/);

  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  for (const marker of ['006138.021.1', 'G.15.000', 'E.22.000', '008404.010.1', 'C.11.034', 'C.11.054']) {
    assert.match(runner, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const runtime = read('assets/app-runtime.js');
  for (const marker of ['getInventoryConsolidationValidDestinations', 'All Crop Tiers', 'Carry Over (&lt; SY',
    'Current Crop (SY', 'Future Crop (&gt; SY', 'CARRY_OVER', 'CURRENT_CROP', 'FUTURE_CROP']) assert.ok(runtime.includes(marker), marker);
  assert.doesNotMatch(runtime, /OLDER SY -> ANY SY|Current SY -> Same SY|Older SY -> Any SY/);

  const parser = runFunctions('supabase/functions/app-api/index.ts', ['parseAuraDeterministicInventoryQuestion'], { exports: {} });
  assert.equal(parser.parseAuraDeterministicInventoryQuestion('show carry-over boxwood').cropTier, 'CARRY_OVER');
  assert.equal(parser.parseAuraDeterministicInventoryQuestion('show current crop').cropTier, 'CURRENT_CROP');
  assert.equal(parser.parseAuraDeterministicInventoryQuestion('show future crop').cropTier, 'FUTURE_CROP');
  const verifier = read('scripts/verify-live-request-queue.mjs');
  for (const marker of ['requestBadgeCount !== 6', 'badPairExcluded', 'CARRY OVER -> CARRY OVER',
    'CURRENT CROP -> CURRENT CROP', 'auraGlossaryTerms']) assert.match(verifier, new RegExp(marker));
});

test('Invariant 29 (Request Creator Parity, Photo Dates, Item AV Notes, and Direct Quick Access)', () => requestPhotoNavigationContract(read,runFunctions,functionSource));

test('Invariant 30 (Set-Based Live ERP Ingestion and Queue Isolation)', () => {
  const migration = read('supabase/migrations/20261026070000_agdata_v2369_fast_live_erp_ingestion.sql');
  const appsScript = read('Code.gs');
  const appApi = read('supabase/functions/app-api/index.ts');
  const fastSync = read('scripts/fast-live-erp-sync.mjs');
  for (const rpc of ['check_erp_file_sync_needed_v1', 'fast_ingest_drive_around_v1',
    'fast_ingest_soc_orders_v1', 'fast_ingest_soc_reserves_v1', 'fast_ingest_cav_v1',
    'fast_ingest_warehouse_assigned_v1']) assert.ok(migration.includes(rpc), rpc);
  for (const marker of ["set statement_timeout='200ms'", "'target_ms',50", "'target_ms',2000",
    'jsonb_populate_record(null::%s,source_row.value)', 'bulk_import_master_snapshot_v1',
    'reconcile_inventory_location_evidence_v1', 'refresh_soc_order_history_v2366',
    'refresh_reserve_history_v2366', 'row_state_hash', 'source_content_hash', 'source_modified_at']) {
    assert.ok(migration.includes(marker), marker);
  }
  assert.doesNotMatch(migration, /\b(?:drop\s+table|truncate)\b/i);
  assert.doesNotMatch(migration, /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.ph_(?:active_request|requests_pending|reclass_recount|bunch_note)/i);
  assert.match(migration, /revoke all on function public\.fast_ingest_drive_around_v1\(jsonb,jsonb\) from public,anon,authenticated/);
  assert.match(migration, /current_setting\('agdata\.fast_erp_defer_history',true\)='on'/);
  for (const marker of ['processFastLiveFile_', 'check_erp_file_sync_needed_v1',
    'FAST_ERP_COMPLETE_SNAPSHOT_REQUIRED', 'runWarehouseAssignedOnly']) assert.ok(appsScript.includes(marker), marker);
  assert.match(appApi, /action === "fast_erp_ingest"[^]*FULL_ACCESS_USER_KEYS[^]*check_erp_file_sync_needed_v1[^]*rpcByDataset/);
  for (const marker of ['objectRows', 'latestSources', 'check_erp_file_sync_needed_v1',
    'FAST_LIVE_BATCH_SIZE', 'shouldIncludeSocLiveRow', 'disable trigger user', "'--linked'", 'supabase.js']) assert.ok(fastSync.includes(marker), marker);
  assert.doesNotMatch(fastSync, /FAST_LIVE_ERP_DATABASE_URL|GNC_SUPABASE_DB_URL|new Pool|from 'pg'/);
  assert.match(functionSource('assets/app-runtime.js', 'runGoogleAppsScriptTrigger'), /action: 'erp_sync'[^]*operation: 'start'[^]*maxAttemptsPerStage: 1/);
  assert.doesNotMatch(functionSource('assets/app-runtime.js', 'runGoogleAppsScriptTrigger'), /postGoogleScriptJsonPayload|manual_run|manual_continue/);
});

test('Invariant 31 (Four-Caller Delivery and Direct Hydration Recovery)', () => {
  const migrationName = '20261026140000_agdata_v2369_emergency_recovery.sql';
  const migration = read(`supabase/migrations/${migrationName}`);
  const runtime = read('assets/app-runtime.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  const appsScript = read('Code.gs');
  for (const relation of ['ph_master_inventory', 'ph_cav_import', 'ph_reserves', 'ph_soc_master',
    'ph_customer_consignee_sales_reps', 'ph_request_delivery_outbox', 'ph_request_delivery_worker_state',
    'ph_request_email_threads', 'ph_requests_pending', 'ph_requests_completed_history']) {
    assert.ok(migration.includes(relation), relation);
  }
  for (const marker of ['grant select on table public.%I to anon,authenticated',
    'agdata_v2369_operational_read', 'security_invoker=true', 'claim_request_delivery_events(integer,text)',
    'safe_parse_timestamptz', "status='pending',attempt_count=0", "event_type<>'delivery_canary'",
    'old.photo_url is distinct from new.photo_url', 'old.ptronhand is distinct from new.ptronhand',
    'when (old is distinct from new)']) assert.ok(migration.includes(marker), marker);
  assert.doesNotMatch(migration, /\b(?:drop\s+table|truncate)\b/i);
  assert.match(migration, /revoke all on table public\.ph_app_users from anon[^]*revoke all on table public\.user_access_control from anon/);
  for (const marker of ['DIRECT_POSTGREST_READ_TABLES', 'fetchDirectPostgrestReadPage',
    'fetchDirectMasterInventoryPage', 'skipCustomerMapShortcut', "scheduleRequestDeliveryWake('request_created')",
    "scheduleRequestDeliveryWake('request_completed')"]) assert.ok(runtime.includes(marker), marker);
  assert.doesNotMatch(functionSource('assets/app-runtime.js', 'getLoginWarmupPlan'), /avNotes|requestHistory|reserves|soc|cav/);
  assert.doesNotMatch(functionSource('assets/app-runtime.js', 'getLoginReadyDatasetTargets'), /avNotes|requestHistory|reserves|soc|cav/);
  for (const name of ['filterEvalWorkAvNotes', 'filterPaperNcrSalesNotes', 'filterAvNotes']) {
    assert.doesNotMatch(functionSource('assets/app-runtime.js', name), /ensureDatasetLoaded\('avNotes'/);
  }
  for (const marker of ['delivery_wake', 'wake_delivery_worker', 'dispatchAuthenticatedDeliveryWake',
    'dispatchRequestDeliveryWorkerNow', 'eval_work_', 'shear_location_', 'location_work_']) assert.ok(appApi.includes(marker), marker);
  assert.match(appsScript, /payload\.type === 'wake_delivery_worker'[^]*processRequestDeliveryOutbox_/);
  const manifest = JSON.parse(read('package.json'));
  for (const name of ['verifyAppsScriptActionEnvelope_', 'doPost']) assert.ok(manifest.appsScriptPatchFunctions.includes(name), name);
  assert.match(read('scripts/apps-script-function-patch.mjs'), /mergeRequestDeliveryWakeDispatch[^]*DELIVERY_WAKE_REMOTE_ANCHOR/);
  const impactHeading = 'Mandatory 4-Caller & All-11-Gems Impact Contract';
  assert.ok(read('AGENTS.md').includes(impactHeading));
  for (const skill of ['agdata-app-shell-and-navigation', 'agdata-aura-assistant',
    'agdata-bloom-and-request-specialist', 'agdata-docks-and-orders-specialist',
    'agdata-drive-and-av-specialist', 'agdata-field-ops-and-qc',
    'agdata-queue-and-reclass-specialist', 'agdata-release-governor',
    'agdata-runtime-watchdog', 'agdata-skill-learner',
    'agdata-sync-and-supabase-architect', 'agdata-zero-lockout-guard']) {
    const body = read(`.codex/skills/${skill}/SKILL.md`);
    assert.ok(body.includes(impactHeading), skill);
    assert.ok(body.includes("Never approve a cross-layer change from one caller's tests alone"), skill);
  }
  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  assert.match(runner, /agdataV2369EmergencyRecoveryMigrationName[^]*registeredReleaseDatabaseMigrations/);
  assert.ok(runner.includes(migrationName));
});

test('Invariant 32 (Bounded Selected-Rep Customer Hydration)', async () => {
  const calls = [];
  const context = runFunctions('assets/app-runtime.js', ['fetchRequestCustomerMapRowsForRepName'], {
    resolveCanonicalRequestRepName: value => value,
    normalizeRepDisplayOrder: value => String(value || '').trim(),
    normalizeRepMatchToken: value => String(value || '').trim().toLowerCase(),
    fetchAllSupabaseRows: async (table, query, options) => {
      calls.push({ table, query, options });
      if (calls.length === 1) throw Object.assign(new Error('direct read cancelled'), { code: 'REQUEST_ABORTED' });
      return [
        { unique_id: 'one', salesrepid: 'S27', salesrepname: 'Josh Ringleb' },
        { unique_id: 'two', salesrepid: 'S27', salesrepname: 'Josh Ringleb' },
      ];
    },
    isActiveRequestCustomerMapping: () => true,
    getCustomerRepMapRepValue: row => row.salesrepname,
    matchSalesRepIdentity: (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase(),
    window: { setTimeout },
  });
  const result = await context.fetchRequestCustomerMapRowsForRepName('Josh Ringleb');
  assert.equal(result.salesrepId, 'S27');
  assert.equal(result.rows.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].table, 'ph_customer_consignee_sales_reps');
  assert.match(calls[1].query, /salesrepname=eq\.Josh%20Ringleb/);
  assert.match(calls[1].query, /customerstatus=eq\.A&consigneestatus=eq\.A/);
  assert.equal(calls[1].options.requireComplete, true);
  assert.equal(calls[1].options.skipCustomerMapShortcut, true);
  assert.equal(calls[1].options.forceFresh, true);
  const ensureSource = functionSource('assets/app-runtime.js', 'ensureRequestModalCustomerOptionsReady');
  assert.match(ensureSource, /if \(!rep\) await prefetchRequestModalCustomerOptions\(force\)/);
  assert.ok(ensureSource.indexOf('await loadRequestModalCustomerOptionsForRep') < ensureSource.indexOf('const id = getRequestSelectedSalesrepId'));
  assert.match(read('.codex/skills/agdata-bloom-and-request-specialist/SKILL.md'), /Never block Customer\/Consignee selection on a full mapping download/);
});

test('Invariant 33 (Suspend Queue Uses Authorized Direct LKG Read)', () => {
  const runtime = read('assets/app-runtime.js');
  const directSet = runtime.match(/const DIRECT_POSTGREST_READ_TABLES = new Set\(\[[^]*?\]\);/)?.[0] || '';
  const context = vm.createContext({ normalizeAppTableName: value => String(value || '').trim().toLowerCase() });
  vm.runInContext(`${directSet}\n${functionSource('assets/app-runtime.js', 'isDirectPostgrestReadTable')}`, context);
  assert.equal(context.isDirectPostgrestReadTable('ph_active_suspend'), true);
  assert.match(runtime, /suspendTag:\s*\{\s*table:\s*'ph_active_suspend',\s*sourceTable:\s*'ph_soc_master'/);
  const refreshSource = functionSource('assets/app-runtime.js', 'refreshActiveRequestQueueSideData');
  assert.match(refreshSource, /requestQueueSideRefreshPending\s*=\s*\{/);
  assert.match(refreshSource, /refreshActiveRequestQueueSideData\(pending\.reason, pending\.options\)/);
  assert.match(functionSource('assets/app-runtime.js', 'setReqTab'), /loadDatasetTargetsWithLimit\(\[\{ key: 'suspendTag', mode: 'full' \}, \{ key: 'soc', mode: 'full' \}\]/);
  assert.match(read('.codex/skills/agdata-queue-and-reclass-specialist/SKILL.md'), /Never render `Que -> SUSPEND` from a synthetic API dataset/);
});

test('Invariant 34 (Suspend Direct View Retains Typed Browser Boundary)', async () => {
  const calls = [];
  const bridge = databaseBridge(async (...args) => {
    calls.push(args);
    return new Response('[]');
  });
  await bridge.fetchTable('https://fixture.invalid', 'ph_active_suspend',
    'select=unique_id,commonname,locationcode&order=unique_id.asc&limit=1', { method: 'GET' }, 1000, 'suspend queue');
  assert.equal(new URL(calls[0][0]).pathname, '/rest/v1/ph_active_suspend');
  await assert.rejects(bridge.fetchTable('https://fixture.invalid', 'ph_active_suspend',
    'select=unknown_suspend_field', { method: 'GET' }, 1000, 'suspend queue'), /Unknown.*column/);
  assert.equal(calls.length, 1);
  assert.match(read('.codex/skills/agdata-queue-and-reclass-specialist/SKILL.md'), /Never add a direct operational view to the runtime allowlist without a finite typed browser alias/);
});

test('Invariant 35 (AV Uses One Canonical Master Hydration)', () => {
  const context = runFunctions('assets/app-runtime.js', ['canonicalizeProductionCoreLiveKeys'], { Array, Set });
  assert.deepEqual(Array.from(context.canonicalizeProductionCoreLiveKeys(['avOpen', 'master', 'reserves', 'master'])),
    ['master', 'reserves']);
  const liveContext = functionSource('assets/app-runtime.js', 'getProductionLiveSyncContext');
  assert.match(liveContext, /canonicalizeProductionCoreLiveKeys\(registry\.getCoreKeys\(targetView, targetContext\)\)/);
  assert.match(read('.codex/skills/agdata-drive-and-av-specialist/SKILL.md'), /Never let `avOpen` and `master` create duplicate live-sync adapters/);
});

test('Invariant 36 (Master Hydration Avoids Exact Count Timeouts)', () => {
  const directSource = functionSource('assets/app-runtime.js', 'fetchDirectMasterInventoryPage');
  const pagingSource = functionSource('assets/app-runtime.js', 'fetchAllInventoryReadRows');
  const adapterSource = functionSource('assets/app-runtime.js', 'createProductionCoreLiveAdapter');
  assert.match(directSource, /count:\s*false/);
  assert.doesNotMatch(directSource, /count:\s*true/);
  assert.match(directSource, /unique_id=gt\.\$\{encodeURIComponent\(afterUniqueId\)\}/);
  assert.match(pagingSource, /afterUniqueId \? \{ \.\.\.options, afterUniqueId \} : options/);
  assert.match(pagingSource, /nextUniqueId = String\(page\.rows\.at\(-1\)\?\.unique_id/);
  assert.match(adapterSource, /Math\.min\(2, Math\.max\(1, Math\.floor\(Number\(stageOptions\.pageConcurrency\) \|\| 1\)\)\)/);
  assert.match(read('.codex/skills/agdata-drive-and-av-specialist/SKILL.md'), /Never request `count=exact` or use deep offsets on wide `ph_master_inventory` pages/);
});

test('Invariant 37 (Exact AV Search Does Not Wait For Full Hydration)', () => {
  const directSource = functionSource('assets/app-runtime.js', 'fetchDirectMasterInventoryItemRows');
  const scheduleSource = functionSource('assets/app-runtime.js', 'scheduleExactAvSearchHydration');
  const searchSource = functionSource('assets/app-runtime.js', 'handleAVSearch');
  assert.match(directSource, /fetchDirectMasterInventoryPage\(\{ projection: 'full', itemCode: safeItemCode \}, 100/);
  assert.match(directSource, /new Set\(ids\)\.size !== ids\.length/);
  assert.match(scheduleSource, /invalidateResolvedViewStateCaches\(\{ preserveAvPreparation: true \}\)/);
  assert.match(scheduleSource, /owner === getSupabaseReadIdentityScope\(\)/);
  assert.match(scheduleSource, /installExactAvSearchHydrationRows\(rows, owner, permissionVersion, itemCode\)/);
  assert.match(scheduleSource, /isViewVisible\('av'\) && remainsCurrent\(\)\) renderAV\(\)/);
  assert.match(scheduleSource, /preferAnon: true/);
  assert.doesNotMatch(scheduleSource, /setTimeout\(async/);
  assert.match(searchSource, /scheduleExactAvSearchHydration\(term\)/);
  assert.match(functionSource('assets/app-runtime.js', 'fetchDirectPostgrestReadPage'), /opts\.preferAnon === true \? null : await getNativeAuthRequestHeaders/);
  assert.match(functionSource('assets/app-runtime.js', 'canUseDatasetForImmediateRender'), /hasCurrentExactAvSearchHydration\(\)/);
  assert.match(functionSource('assets/app-runtime.js', 'previewProductionSnapshots'), /mergeExactAvSearchRowsIntoPreview\(payload\.data, context\)/);
  assert.match(functionSource('assets/app-runtime.js', 'getCurrentExactAvSearchHydrationRows'), /context\.readIdentity/);
  assert.match(functionSource('assets/app-runtime.js', 'buildResolvedAVBaseState'), /getAvSalesRowsForBucket\(activeAvSalesBucket, exactSearchRows\)/);
  assert.match(read('.codex/skills/agdata-drive-and-av-specialist/SKILL.md'), /Never make an exact AV itemcode search wait for a near-tail full-cohort page/);
});

test('Invariant 38 (Visible Focused AV Search Survives Startup Reset)', () => {
  const resetSource = functionSource('assets/app-runtime.js', 'resetAVView');
  assert.match(resetSource, /preserveFocusedSearch = isViewVisible\('av'\) && document\.activeElement === searchInput/);
  assert.match(resetSource, /if \(!preserveFocusedSearch && searchInput\) searchInput\.value=""/);
  assert.match(read('.codex/skills/agdata-drive-and-av-specialist/SKILL.md'), /Never let a delayed AV view reset erase a focused search/);
});

test('Invariant 39 (Delivery Recovery Keeps Private Worker Boundary)', () => {
  const migrationName = '20261026150000_agdata_v2369_private_delivery_boundary.sql';
  const migration = read(`supabase/migrations/${migrationName}`);
  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  const runtime = read('assets/app-runtime.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  const appsScript = read('Code.gs');
  for (const relation of ['ph_request_delivery_outbox', 'ph_request_delivery_worker_state',
    'ph_request_email_threads', 'ph_requests_completed_history', 'ph_delivery_outbox',
    'ph_request_delivery_status']) {
    assert.match(migration, new RegExp(`revoke all privileges on table public\\.${relation} from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant all privileges on table public\\.${relation} to service_role`));
  }
  for (const worker of ['claim_request_delivery_events', 'complete_request_delivery_event',
    'fail_request_delivery_event', 'heartbeat_request_delivery_worker',
    'record_request_delivery_channel_result', 'requeue_request_delivery',
    'get_request_delivery_recovery_queue']) {
    assert.match(migration, new RegExp(`revoke all privileges on function public\\.${worker}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${worker}`));
  }
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\./i);
  assert.match(runner, /agdataV2369PrivateDeliveryBoundaryMigrationName[^]*registeredReleaseDatabaseMigrations/);
  assert.ok(runner.includes(migrationName));
  const directSet = runtime.match(/const DIRECT_POSTGREST_READ_TABLES = new Set\(\[[^]*?\]\);/)?.[0] || '';
  assert.doesNotMatch(directSet, /ph_request_delivery|ph_request_email_threads|ph_requests_completed_history/);
  assert.match(appApi, /createClient<Database>\(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(appsScript, /resolveSupabaseServiceRoleKey_[^]*const SUPABASE_KEY = resolveSupabaseServiceRoleKey_/);
  assert.match(read('.codex/skills/agdata-bloom-and-request-specialist/SKILL.md'), /Never restore a delivery worker by granting browser roles access/);
});

test('Invariant 40 (Request Completion and Watchdog Recovery Stay Fail-Open)', () => {
  const migrationName = '20261026160000_agdata_v2370_watchdog_and_request_recovery.sql';
  const migration = read(`supabase/migrations/${migrationName}`);
  const runtime = read('assets/app-runtime.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  const watchdog = read('assets/runtime-watchdog.js');
  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  assert.match(migration, /add column if not exists pick text/);
  assert.match(migration, /add column if not exists submitted_by text/);
  assert.match(migration, /pick_note=coalesce/);
  assert.match(migration, /lock_timeout to '15s'/);
  assert.match(migration, /statement_timeout to '30s'/);
  assert.match(migration, /inventory_consolidation_suggestions_v2370/);
  assert.match(migration, /historical_requests_read_v2370/);
  assert.match(migration, /set status = 'resolved'/);
  assert.match(runtime, /function naturalCompare\(a, b\)/);
  assert.match(runtime, /window\.naturalCompare = naturalCompare/);
  assert.match(runtime, /globalThis\.naturalCompare = naturalCompare/);
  const assignedRep = functionSource('assets/app-runtime.js', 'getRequestAssignedRep');
  assert.ok(assignedRep.indexOf('REQUEST_SELECTED_REP_DISPLAY') < assignedRep.indexOf('REQUESTED_BY'));
  assert.doesNotMatch(functionSource('assets/app-runtime.js', 'finalizeLogin'), /scheduleInventoryConsolidationWarmup/);
  assert.ok(appApi.includes('const APP_RUNTIME_RELEASE = "AgData v' + expectedAppApiVersion() + '"'));
  assert.match(appApi, /retainedReadResponse\("INVENTORY_READ_FAILED"\)/);
  assert.match(appApi, /historical_requests_read_v2370/);
  assert.match(appApi, /inventory_consolidation_suggestions_v2370/);
  assert.match(watchdog, /REQUEST_ABORTED\|DATASET_READ_SCOPE_CHANGED/);
  assert.ok(runner.includes(migrationName));
  assert.match(read('.codex/skills/agdata-runtime-watchdog/SKILL.md'), /Never record navigation\/scope cancellation codes/);
});

test('Invariant 41 (Canonical Version Mismatch Is One-Time and Auth-Safe)', () => invariant41({read, expectedAppApiVersion}));

test('Invariant 42 (Published Version Fingerprint Matches Runtime Fetch Path)', () => invariant42({read}));

test('Invariant 43 (Request, Suspend, Reclass, Import, Outbox, and AV Boundaries Stay Separated)', () => {
  const runtime = read('assets/app-runtime.js');
  const codeGs = read('Code.gs');
  const appApi = read('supabase/functions/app-api/index.ts');
  const migration = read('supabase/migrations/20261026170000_agdata_v2371_request_suspend_email_and_lock_cleanup.sql');
  const reclass = read('supabase/migrations/20261015230000_inventory_reclass_moves_v1.sql');
  assert.match(runtime, /const actionBadge = '';/);
  assert.match(runtime, /function updateRequestWorkConflictReview[^]*panel\.classList\.add\('hidden'\);[^]*return;/);
  assert.match(runtime, /if \(prefix === 'req-'\) return false/);
  assert.match(runtime, /isDriveModePhotoDataEditContext\(prefix, item\)[^]*getRoleAccessState\(\)\?\.isAdmin/);
  assert.match(runtime, /sanitizeAvNoteWithoutSpecCaliper/);
  assert.match(codeGs, /setProperty\('SUPABASE_SERVICE_ROLE_KEY', candidateKey\)/);
  assert.doesNotMatch(functionSource('Code.gs', 'resolveSupabaseServiceRoleKey_'), /SUPABASE_KEY|SUPABASE_API_KEY/);
  assert.match(migration, /revoke all privileges on table public\.ph_request_delivery_outbox from public, anon, authenticated/);
  assert.match(migration, /grant all privileges on table public\.ph_request_delivery_outbox to service_role/);
  assert.match(migration, /lower\(btrim\(coalesce\(pending\.req_status, 'Pending'\)\)\) in \('', 'pending', 'open'\)/);
  assert.match(migration, /RECLASS_STALE_QUANTITY_GUARD_NOT_FOUND/);
  assert.match(reclass, /insert into public\.ph_master_inventory/);
  assert.doesNotMatch(read('supabase/functions/_shared/production-workflow.ts'), /Inventory identity changed before this move could be confirmed/);
  assert.match(read('.codex/skills/agdata-email-outbox-and-worker-guard/SKILL.md'), /Never repair a missing worker credential by granting anonymous operational writes/);
});

test('Invariant 44 (Request Completion Persists Before Active-View Eviction)', () => requestCompletionContract(read,functionSource));

test('Invariant 45 (Bulk ERP Imports Cannot Re-enter Per-Row Archive Locks)', () => {
  const migration = read('supabase/migrations/20261026180000_agdata_v2373_fast_apps_script_erp_import_unblock.sql');
  const code = read('Code.gs');
  assert.match(migration, /drop trigger if exists ph_drive_around_report_state_merge_v2366/);
  assert.match(migration, /ph_master_bulk_crop_roll_defer_active_v1/);
  assert.match(code, /TEMP_IMPORT_\|TEMP_\|~\\\$/);
  assert.match(code, /trashDriveFileWithRetry_\(file, 'orphaned live import temporary file'\)/);
  assert.match(read('.codex/skills/agdata-sync-and-supabase-architect/SKILL.md'), /Never retain orphaned `TEMP_IMPORT_\*`/);
});

test('Invariant 46 (Drive Fast Ingest Outlives Its Guarded Snapshot Publication)', () => {
  const migration = read('supabase/migrations/20261026190000_agdata_v2373_drive_timeout_recovery.sql');
  const code = read('Code.gs');
  const packageJson = JSON.parse(read('package.json'));
  assert.match(migration, /alter function public\.fast_ingest_drive_around_v1\(jsonb,jsonb\)[^]*statement_timeout='120s'/);
  assert.match(migration, /V2373_DRIVE_TIMEOUT_RECOVERY_MISSING/);
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'), /agdataV2373DriveTimeoutRecoveryMigrationName[^]*statement_timeout=120s/);
  assert.match(code, /return logical === 'ph_master_inventory' \|\| logical === 'ph_soc_master' \|\| logical === 'ph_reserves'/);
  assert.ok(packageJson.appsScriptPatchFunctions.includes('isCheckpointedLatestImportTable_'));
  assert.match(read('.codex/skills/agdata-sync-and-supabase-architect/SKILL.md'), /Never give the outer Drive fast-ingest RPC a shorter timeout/);
});

test('Invariant 47 (Drive Publication Uses Trigger-Suppressed Fast Ingest)', () => {
  const code = read('Code.gs');
  const routedImport = functionSource('Code.gs', 'runRoutedDropImport_');
  assert.match(routedImport, /processFastLiveFile_\(dataset, route, files, dataset === 'drive' \? buildMasterPayload : buildStandardPayload\)/);
  assert.doesNotMatch(routedImport, /processSnapshotBatchFolderLocked_/);
  assert.match(read('supabase/migrations/20261026200000_agdata_v2374_unified_fast_baseline_suspend_reclass_email.sql'), /disable trigger user[^]*enable trigger user/);
  assert.match(code, /MANUAL_SYNC_EXECUTION_BUDGET_MS = 330000/);
});

test('Invariant 48 (Drive Failures Retain Structured Safe Codes)', () => {
  const failureCode = functionSource('Code.gs', 'getSafeImportFailureCode_');
  assert.match(failureCode, /\^MASTER_BULK_\[A-Z0-9_\]\+\$/);
  assert.match(failureCode, /Supabase RPC \[a-zA-Z0-9_\]\+ failed/);
  assert.match(failureCode, /IMPORT_DATABASE_/);
  assert.match(failureCode, /masterBulkError\[1\]/);
  assert.match(functionSource('Code.gs', 'processSnapshotBatchFolderLocked_'), /MANUAL_SYNC_' \+ String\(failurePhase \|\| 'stage'\)\.toUpperCase\(\) \+ '_FAILED'/);
  assert.match(read('.codex/skills/agdata-sync-and-supabase-architect/SKILL.md'), /Never collapse a structured master-bulk or SQLSTATE failure/);
});

test('Invariant 49 (Unified Fast Import Preserves Physical Orders, Metrics, Reclass, and Email Actors)', () => {
  const migration = read('supabase/migrations/20261026200000_agdata_v2374_unified_fast_baseline_suspend_reclass_email.sql');
  const runtime = read('assets/app-runtime.js');
  assert.match(migration, /ph_soc_suspend_tag_rows with \(security_invoker=true\)/);
  assert.match(migration, /sum\(coalesce\(private\.request_numeric_v2362\(master\.ptravailable\),0\)\) open_stock/);
  assert.match(migration, /repaired like '%INVENTORY_RECLASS_REVISION_CONFLICT%'/);
  assert.match(migration, /new\.requested_by:=coalesce\(selected_rep,new\.requested_by\)/);
  assert.match(read('Code.gs'), /tagVal[^]*qtyVal[^]*consVal/);
  assert.match(runtime, /normalizedKey === 'AV_NOTE'\) return sanitizeAvNoteWithoutSpecCaliper/);
  assert.match(read('assets/app-shell-style-05.css'), /\.photo-date-badge-host[^]*flex-direction: column[^]*\.photo-thumb-date \{[^]*position: static/);
});

test('Invariant 50 (Suspend Active View Renders Every Physical Line)', () => {
  const runtime = read('assets/app-runtime.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  const migration = read('supabase/migrations/20261026210000_agdata_v2375_suspend_17_cards_and_fast_batch_sync.sql');
  assert.match(runtime, /isSuspendTag \|\| text\('REQUEST_TYPE', 'request_type'\) === 'suspend_tag' \|\| isDockSuspendDcRequestSource\(item\)/);
  assert.match(runtime, /sourceRows\.length <= DOCK_SUSPEND_MIRROR_PREPARATION_CHUNK_SIZE/);
  assert.match(runtime, /rows: filteredItems,[^]*footerMarkup: ''/);
  assert.match(appApi, /table: "ph_active_suspend", permission: "ph_soc_master"/);
  assert.match(migration, /ph_active_suspend with \(security_invoker=true\)[^]*'Pending'::text as status[^]*true as is_suspend_tag/);
  const sync = read('scripts/fast-live-erp-sync.mjs');
  assert.match(sync, /FAST_LIVE_BATCH_SIZE = 1000/);
  assert.match(sync, /disable trigger user[^]*enable trigger user/);
  assert.doesNotMatch(sync, /from 'pg'|GNC_SUPABASE_DB_URL|new Pool/);
});

test('Invariant 51 (Login Restore Cannot Enter a Version Reload Loop)', () => invariant51({read}));

test('Invariant 52 (Suspend Reads Fail Open Without Weakening Mutations)', () => {
  const runtime = read('assets/app-runtime.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  const migration = read('supabase/migrations/20261026230000_agdata_v2377_suspend_read_continuity.sql');
  const readStart = appApi.indexOf('async function handleDatasetRead(');
  const readEnd = appApi.indexOf('function hasTableWriteAccess(', readStart);
  assert.doesNotMatch(appApi.slice(readStart, readEnd), /verifySuspendTagSession/);
  assert.match(appApi, /if \(action === "suspend_tag"\)[^]*session\?\.authUserId[^]*verifySuspendTagSession/);
  assert.match(appApi, /table: "ph_active_suspend", permission: "ph_soc_master"/);
  assert.match(read('supabase/functions/_shared/database.types.ts'), /ph_active_suspend:/);
  assert.match(read('services/database-contracts.generated.ts'), /"ph_active_suspend":/);
  assert.match(runtime, /socRows\.filter\(isDockSuspendDcRequestSource\)[^]*directRows\.filter\(isDockSuspendDcRequestSource\)/);
  assert.match(runtime, /\{ key: 'suspendTag', mode: 'full' \}, \{ key: 'soc', mode: 'full' \}/);
  assert.match(migration, /grant select on public\.ph_active_suspend to anon,authenticated,service_role/);
  assert.match(migration, /SUSPEND_ACTIVE_COUNT_MISMATCH/);
});

test('Invariant 53 (False Block Variants Never Become Email Pull Options)', () => {
  const ctx = runFunctions('Code.gs', ['buildSuspendTagApprovalEmail_'], {
    dedupeEmailAddresses_: values => [...new Set(values)],
    escapeEmailHtml_: value => String(value),
    buildRequestEmailTableItemsHtml_: payload => JSON.stringify(payload.requestItems),
  });
  const approval = { id: 'approval', status: 'pending', rep_email: 'rep@example.test',
    submitter_email: 'actor@example.test', snapshot: { locationcode: '0.00.111',
      candidates: [
        { unique_id: 'false-one', locationcode: '0.00.111' },
        { unique_id: 'false-two', locationcode: '00.000.111' },
        { unique_id: 'real', locationcode: 'G.19.000', quantityordered: 20 },
      ] } };
  const result = ctx.buildSuspendTagApprovalEmail_({ eventType: 'suspend_tag_approval_requested', payload: { approval } });
  for (const body of [result.textBody, result.htmlBody]) {
    assert.match(body, /G\.19\.000/);
    assert.doesNotMatch(body, /0\.00\.111|00\.000\.111|false-one|false-two/);
  }
  assert.equal(result.to, 'rep@example.test');
  assert.throws(() => ctx.buildSuspendTagApprovalEmail_({ eventType: 'suspend_tag_approval_requested',
    payload: { approval: { ...approval, snapshot: { locationcode: '00.000.111' } } } }), /NO_PULL_CANDIDATES/);
});

test('Invariant 54 (Suspend Queue Preserves Server Open Stock Unless an Exact Tuple Exists)', () => {
  const metricSink = {};
  const ctx = runFunctions('assets/app-runtime.js', ['isFalseBlockLocation', 'normalizeRequestCardMetrics', 'buildQueueInventoryMetricsHtml'], {
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== ''),
    isDockSuspendDcRequestMirrorRow: item => item?.isSuspend === true,
    getQueueCardInventoryState: item => {
      const row = item?.testInventoryRow;
      const exact = row && row.ITEMCODE === item.ITEMCODE && row.LOCATIONCODE === item.LOCATIONCODE && row.LOTCODE === item.LOTCODE;
      return exact ? { status: 'ready', row } : { status: 'unavailable', row: null };
    },
    getQueueCardInventoryAuthorizationContext: () => null,
    getDatasetState: () => null,
    getSuspendTagMetricDisplayFallback: () => null,
    findLinkedMasterRow: () => null,
    buildInventoryQuantityChipsHtml: row => { metricSink.row = row; return ''; },
    window: {}, resolveLiveInventoryForCard: item => {
      const row = item?.testInventoryRow;
      return row && row.ITEMCODE === item.ITEMCODE && row.LOCATIONCODE === item.LOCATIONCODE && row.LOTCODE === item.LOTCODE ? row : null;
    },
    getQueueDisplayEvidenceRow: () => null, fullInventory: [],
  });
  ctx.isDockSuspendDcRequestMirrorRow = item => item?.isSuspend === true;
  ctx.getQueueCardInventoryState = item => {
    const row = item?.testInventoryRow;
    const exact = row && row.ITEMCODE === item.ITEMCODE && row.LOCATIONCODE === item.LOCATIONCODE && row.LOTCODE === item.LOTCODE;
    return exact ? { status: 'ready', row } : { status: 'unavailable', row: null };
  };
  const base = { isSuspend: true, ITEMCODE: '008280.150.1', LOCATIONCODE: 'C.05.000', LOTCODE: '27.F1',
    PTRONHAND: 4, PTRREVIEWED: 0, PTRAVAILABLE: 4, OPEN_STOCK: 73, S_LTS: 102, LOC_ON_HAND: 4, LOC_MATCH_QTY: 0 };

  ctx.buildQueueInventoryMetricsHtml({ ...base, testInventoryRow: { ITEMCODE: base.ITEMCODE,
    LOCATIONCODE: base.LOCATIONCODE, LOTCODE: 'OTHER-LOT', PTRONHAND: 8, PTRAVAILABLE: 9, S_LTS: 102 } });
  assert.equal(metricSink.row.PTRONHAND, 4, 'nonmatching lot must not replace queue metrics');
  assert.equal(metricSink.row.S_LTS, 73, 'Open Stock must win over the unrelated Drive S_LTS value');
  assert.equal(metricSink.row.PTRREVIEWED, 0, 'explicit zero remains a known metric');

  ctx.buildQueueInventoryMetricsHtml({ ...base, testInventoryRow: { ITEMCODE: base.ITEMCODE,
    LOCATIONCODE: base.LOCATIONCODE, LOTCODE: base.LOTCODE, PTRONHAND: 5, PTRAVAILABLE: 6,
    PTRREVIEWED: 1, S_LTS: 102, LOC_ON_HAND: 5, LOC_MATCH_QTY: 2, LOC_PHOTO_MATCH: 2 } });
  assert.equal(metricSink.row.PTRONHAND, 5, 'an exact hydrated tuple takes precedence');
  assert.equal(metricSink.row.S_LTS, 102, 'an exact master tuple supplies the Drive Open Stock value');
  assert.equal(metricSink.row.LOC_ON_HAND, 5, 'an exact master tuple supplies its verified location aggregate');
  assert.equal(metricSink.row.LOC_MATCH_QTY, 2, 'an exact master tuple supplies its photo-match value');

  ctx.buildQueueInventoryMetricsHtml({ isSuspend: true, ITEMCODE: base.ITEMCODE, LOCATIONCODE: base.LOCATIONCODE, LOTCODE: base.LOTCODE });
  assert.equal(metricSink.row.PTRONHAND, undefined, 'missing metrics remain unknown instead of becoming zero');
  assert.equal(metricSink.row.S_LTS, null);
});

test('Invariant 55 (Apps Script Version Capacity Never Blocks Authorized HEAD Sync)', async () => {
  const { syncAppsScriptProject } = await import('../scripts/apps-script-sync-lib.mjs');
  const calls = [];
  const script = { projects: {
    getContent: async () => ({ data: { files: [{ name: 'Code', type: 'SERVER_JS', source: 'old' }] } }),
    updateContent: async () => { calls.push('head'); },
    versions: {
      list: async () => ({ data: { versions: Array.from({ length: 200 }, (_, index) => ({ versionNumber: index + 166 })) } }),
      create: async () => { throw new Error('a full project must reuse a version'); }
    },
    deployments: {
      update: async ({ requestBody }) => { calls.push(requestBody.deploymentConfig.versionNumber); },
      get: async () => ({ data: { deploymentConfig: { versionNumber: 365 } } })
    }
  } };
  const result = await syncAppsScriptProject({ script, scriptId: 'fixture', deploymentId: 'fixture',
    source: "const APP_DEPLOYMENT_COMMIT_ = '__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__';", githubSha: 'a'.repeat(40),
    logger: { warn() {} }, fetchImpl: async () => { throw new Error('must not certify new web code'); } });
  assert.deepEqual(calls, ['head', 365]);
  assert.equal(result.ok, true);
  assert.equal(result.headUpdated, true);
  assert.equal(result.versionCapacityExhausted, true);
  assert.equal(result.versionCreated, false);
  assert.equal(result.health, null);
});

test('Invariant 56 (Reclass Destination Preserves Season Stock and Location Total)', () => reclassDestinationContract(functionSource));

test('Invariant 57 (Completed Reclass Report Uses Only Frozen Pre-Edit ERP Rows)', () => {
  const fields = ['lotcode', 'locationcode', 'source', 'priority', 'ptronhand', 'ptrreviewed', 'locationnotedate', 'locationptn1', 'locationnote']
    .map(key => ({ key, aliases: [key] }));
  const context = vm.createContext({
    RECLASS_INQUIRY_ROW_FIELDS_: fields,
    normalizeInventoryTransactionText_: value => String(value ?? '').trim(),
    getInventoryTransactionRowUid_: row => String(row?.unique_id || ''),
    firstNonEmptyRequestValue_: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim()) ?? '',
    getReclassInquiryExactValue_: (row, aliases, fallback) => {
      for (const alias of aliases) if (Object.hasOwn(row || {}, alias)) return row[alias] ?? '';
      return fallback;
    },
    buildReclassInquiryReportModel_: (_source, _rows, reportRows) => ({ identity: {}, rows: reportRows }),
    sortReclassInquiryCompactRows_: rows => rows
  });
  vm.runInContext(functionSource('Code.gs', 'buildCompletedInventoryReclassReportModel_') + '\n'
    + functionSource('Code.gs', 'buildReclassInlineOhText_') + '\n'
    + functionSource('Code.gs', 'buildReclassItemInquiryTable_'), context);
  const report_rows = [
    { unique_id: 'source', lotcode: '27.S1', locationcode: 'C.15.000', source: 'LD', priority: '3', ptronhand: '808', ptrreviewed: '0' },
    ...['70', '113', '175', '1', '1596'].map((ptronhand, index) => ({ unique_id: `erp-${index}`, lotcode: '27.S1',
      locationcode: `A.${index + 1}.000`, source: 'LD', priority: '', ptronhand, ptrreviewed: '0' }))
  ];
  const verified = {
    report_rows,
    appliedRows: [...report_rows.map(row => ({ ...row, ptronhand: row.unique_id === 'source' ? '532' : row.ptronhand })),
      { unique_id: 'created-destination', lotcode: '27.F1', locationcode: 'C.15.000', ptronhand: '276' }],
    moves: [{ direction: 'move_up', quantity: 276, source: { unique_id: 'source' }, destination: { unique_id: 'created-destination', season: 'F1' } }]
  };
  const model = context.buildCompletedInventoryReclassReportModel_(verified, new Date('2026-10-26T12:00:00Z'));
  const table = context.buildReclassItemInquiryTable_(model);
  assert.equal(table.rows.length, 6);
  const source = table.rows.find(row => row[0].text === '27.S1' && row[1].text === 'C.15.000');
  assert.equal(source[4].text, '808 - 276 --> F1', 'origin OH stays pre-edit and carries the inline move notation');
  assert.equal(source[5].text, '0', 'origin PTRREVIEWED stays pre-edit');
  assert.deepEqual(Array.from(source[4].proposals), []);
  assert.equal(table.rows.some(row => row[0].text === '27.F1' && row[1].text === 'C.15.000'), false,
    'an app-created destination in appliedRows never enters the ERP report');
});

test('Invariant 58 (Unassigned Itemcode Notices Are Unique, Manager-Scoped and Open the Assignment Filter)', () => {
  const seen = new Map(), notices = [], routes = [];
  const state = { filters: { SOURCE: ['stale'] }, sort: { field: 'SOURCE' } };
  const context = vm.createContext({ currentUser: 'manager', warehouseAssignedItemsInventory: [
    { ITEMCODE: 'new.1', ASSIGNEDTO: '' }, { ITEMCODE: 'NEW.1', ASSIGNEDTO: null },
    { ITEMCODE: 'owned.1', ASSIGNEDTO: 'grower' }],
    canViewAssignedItemsExport: () => context.currentUser === 'manager',
    getSupabaseReadIdentityScope: () => context.currentUser,
    sessionStorage: { getItem: key => seen.get(key), setItem: (key, value) => seen.set(key, value) },
    showToast: (...args) => notices.push(args), getManagerAssignedColumnState: () => state,
    switchView: view => routes.push(view), setHomeTab: tab => routes.push(tab),
    MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW: 'assigned-items-export', managersSearchTerm: 'stale', managerAssignedItemsAssignedToFilter: 'all' });
  vm.runInContext(['getManagerUnassignedItemcodes', 'notifyManagerUnassignedItems', 'openManagerUnassignedItems']
    .map(name => functionSource('assets/app-runtime.js', name)).join('\n'), context);
  assert.equal(context.notifyManagerUnassignedItems(), 1);
  assert.equal(context.notifyManagerUnassignedItems(), 0);
  context.openManagerUnassignedItems();
  assert.deepEqual(routes, ['managers', 'assigned-items-export']);
  assert.equal(context.managerAssignedItemsAssignedToFilter, 'unassigned');
  assert.equal(context.managersSearchTerm, '');
  context.currentUser = 'rep';
  assert.equal(context.notifyManagerUnassignedItems(), 0);
  context.openManagerUnassignedItems();
  assert.equal(routes.length, 2);
  assert.equal(notices.length, 1);
});

test('Invariant 59 (Completed Reclass Preserves Existing ERP Destination Snapshot)', () => {
  const fields = ['lotcode', 'locationcode', 'source', 'priority', 'ptronhand', 'ptrreviewed', 'locationnotedate', 'locationptn1', 'locationnote']
    .map(key => ({ key, aliases: [key] }));
  const context = vm.createContext({
    RECLASS_INQUIRY_ROW_FIELDS_: fields,
    normalizeInventoryTransactionText_: value => String(value ?? '').trim(),
    getInventoryTransactionRowUid_: row => String(row?.unique_id || ''),
    firstNonEmptyRequestValue_: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim()) ?? '',
    getReclassInquiryExactValue_: (row, aliases, fallback) => {
      for (const alias of aliases) if (Object.hasOwn(row || {}, alias)) return row[alias] ?? '';
      return fallback;
    },
    buildReclassInquiryReportModel_: (_source, _rows, reportRows) => ({ identity: { commonname: 'Hummingbird', itemcode: '004103.010.1' }, rows: reportRows }),
    sortReclassInquiryCompactRows_: rows => rows,
    escapeEmailHtml_: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  });
  vm.runInContext(functionSource('Code.gs', 'buildCompletedInventoryReclassReportModel_') + '\n'
    + functionSource('Code.gs', 'buildReclassInlineOhText_') + '\n'
    + functionSource('Code.gs', 'buildReclassItemInquiryTable_') + '\n'
    + functionSource('Code.gs', 'buildReclassItemInquiryHtml_'), context);
  const report_rows = [
    { unique_id: 'origin', lotcode: '27.S1', locationcode: 'C.15.000', source: 'LD', priority: '3', ptronhand: '808', ptrreviewed: '7' },
    { unique_id: 'other-70', lotcode: '27.S1', locationcode: 'A.01.000', source: 'LD', priority: '', ptronhand: '70', ptrreviewed: '0' },
    { unique_id: 'existing-destination', lotcode: '27.F1', locationcode: 'F.16.000', source: 'LD', priority: '', ptronhand: '113', ptrreviewed: '4' },
    { unique_id: 'other-175', lotcode: '27.S1', locationcode: 'A.03.000', source: 'LD', priority: '', ptronhand: '175', ptrreviewed: '0' },
    { unique_id: 'other-1', lotcode: '27.S1', locationcode: 'A.04.000', source: 'LD', priority: '', ptronhand: '1', ptrreviewed: '0' },
    { unique_id: 'other-1596', lotcode: '27.S1', locationcode: 'A.05.000', source: 'LD', priority: '', ptronhand: '1596', ptrreviewed: '0' }
  ];
  const verified = {
    report_rows,
    appliedRows: report_rows.map(row => ({ ...row,
      ptronhand: row.unique_id === 'origin' ? '532' : row.unique_id === 'existing-destination' ? '389' : row.ptronhand,
      ptrreviewed: row.unique_id === 'origin' ? '0' : row.unique_id === 'existing-destination' ? '9' : row.ptrreviewed
    })),
    moves: [{ direction: 'move_up', quantity: 276, source: { unique_id: 'origin' },
      destination: { unique_id: 'existing-destination', season: 'F1' } }]
  };
  const model = context.buildCompletedInventoryReclassReportModel_(verified, new Date('2026-10-26T12:00:00Z'));
  const table = context.buildReclassItemInquiryTable_(model);
  assert.equal(table.columns.length, 9);
  assert.equal(table.rows.length, 6);
  const origin = table.rows.find(row => row[0].text === '27.S1' && row[1].text === 'C.15.000');
  const destination = table.rows.find(row => row[0].text === '27.F1' && row[1].text === 'F.16.000');
  assert.equal(origin[4].text, '808 - 276 --> F1', 'origin displays frozen pre-move quantity with the inline destination move');
  assert.equal(origin[5].text, '7', 'origin review quantity remains frozen');
  assert.deepEqual(Array.from(origin[4].proposals), []);
  assert.equal(destination[4].text, '113', 'pre-existing ERP destination displays its frozen quantity, not applied 389');
  assert.equal(destination[5].text, '4', 'pre-existing ERP destination review quantity remains frozen');
  const html = context.buildReclassItemInquiryHtml_(model);
  assert.match(html, /808 - 276 --&gt; F1/);
  assert.doesNotMatch(html, /UP 276 TO F1/);
  assert.match(html, /proposal-box/);
  assert.match(html, /background:#fef08a/);
});

test('Invariant 60 (Full Manager Assigned Items Uses Its Core Live-Sync Cohort)', () => {
  const context = vm.createContext({
    activeHomeTab: 'assigned-items-export', currentUser: 'manager',
    MANAGER_EVAL_REPORTS_VIEW: 'eval-reports', MANAGER_EVAL_REPORTS_2_VIEW: 'eval-reports-2',
    MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW: 'assigned-items-export', MANAGER_SEASON_PRIORITY_VIEW: 'season-priority',
    getCurrentVisibleViewId: () => 'managers', isManagerApprovalTab: () => false,
    window: { GncReportPagesLive: {} },
    getManagerReportPageController: () => ({ enabled: surface => surface === 'assigned-items' })
  });
  vm.runInContext(functionSource('assets/app-runtime.js', 'getActiveManagerReportPageSurface') + '\n'
    + functionSource('assets/app-runtime.js', 'useManagerReportPages') + '\n'
    + read('assets/live-sync-registry.js'), context);
  assert.equal(context.useManagerReportPages('assigned-items'), true, 'the report reader can remain available independently');
  assert.equal(context.getActiveManagerReportPageSurface('managers'), '',
    'the active full-row panel must not advertise a paged-only coordinator cohort');
  const adapters = Array.from(context.AgMetricLiveSyncRegistry.getViewAdapters('managers', {
    surfaces: ['managers:assigned-items-export']
  }));
  for (const id of ['core:master', 'core:warehouseAssignedItems', 'side:itemLowStockTargets', 'side:settings']) {
    assert.ok(adapters.includes(id), `full Assigned Items cohort includes ${id}`);
  }
});

test('Invariant 61 (Low Stock Revisions Use an App-API-Compatible Public Signal)', () => {
  const context = vm.createContext({});
  vm.runInContext(read('assets/live-sync-registry.js'), context);
  const registry = context.AgMetricLiveSyncRegistry;
  const privateKeys = ['private.ph_eval_item_low_stock_overrides', 'private.ph_eval_item_low_stock_import_state'];
  const targets = Array.from(registry.getSourceKeys(['side:itemLowStockTargets']));
  assert.deepEqual(targets, ['ph_eval_report_settings'],
    'the SQL revision mirror keeps low-stock freshness on the public key accepted by app-api');
  for (const [view, options] of [
    ['managers', { surfaces: ['managers:assigned-items-export'] }],
    ['managers', { pagedReportSurface: 'eval2', surfaces: ['managers:eval-reports-2'] }]
  ]) {
    const adapters = Array.from(registry.getViewAdapters(view, options));
    const keys = Array.from(registry.getSourceKeys(adapters));
    assert.ok(keys.includes('ph_eval_report_settings'), 'each low-stock consumer observes the mirrored revision');
    assert.ok(!keys.some(key => privateKeys.includes(key)), 'no private-schema key reaches the revision API');
  }
});

test('Invariant 62 (Loaded Drive Rows Paint Before Background Catalog Verification)', () => {
  const attrs = new Map();
  const container = { innerHTML: '', setAttribute: (key, value) => attrs.set(key, value),
    hasAttribute: key => attrs.has(key), removeAttribute: key => attrs.delete(key) };
  const rows = Array.from({ length: 9560 }, (_, i) => ({ UNIQUE_ID: String(i) }));
  let paints = 0;
  const context = runFunctions('assets/app-runtime.js', ['renderDrive'], {
    fullInventory: rows, activeDriveTab: 'name', activeDriveMode: 'ok', driveViewLevel: 0,
    DRIVE_MODE_LABELS: { ok: 'Drive Mode' }, productionDisplayMasterReceipt: null,
    document: { getElementById: id => id === 'drive-content' ? container : { classList: { remove() {} } } },
    ensureViewDataForRender: () => false, ensureDriveToolbarControls() {}, syncDriveModeTabs() {}, syncDriveTabPills() {},
    renderDriveUniversalSearchResultsOnly: () => false, hideDrivePlantFilters() {},
    buildDriveVisibleItemsState: () => ({ visibleItems: rows, baseSearchFilteredItems: rows }),
    scheduleDriveTopControlsRender() {}, renderDriveQuickRequestBar() {}, syncDriveCrumb() {},
    canUseProductionLiveSync: () => true, getDatasetState: () => ({ rowCompleteness: 'partial' }),
    renderDriveCommonNameDrill: () => { paints += 1; },
  });
  context.renderDrive();
  assert.equal(paints, 1, 'authorized rows paint without awaiting the final background receipt');
  assert.doesNotMatch(container.innerHTML, /Preparing the full plant catalog/);
  assert.equal(attrs.has('data-complete-name-catalog'), false, 'displaying rows does not claim complete verification');
});
import { queueInventoryExactContract } from '../src/core/golden-queue-exact.mjs';

test('Invariant 63 (Queue Inventory Uses Exact Location/Lot and False Block Never Borrows Metrics)', () => queueInventoryExactContract({read,runFunctions}));

test('Invariant 64 (Queue API and Rendered Cards Preserve Exact Stock and Hide False Block Metrics)', () => {
  const backend = runFunctions('supabase/functions/app-api/index.ts', [
    'normalizeSuspendTagMetricKey', 'sumSuspendTagMetric', 'sumSuspendTagAvailable',
    'firstSuspendTagMetricValue', 'buildSuspendTagMetricFallback'
  ]);
  const source = { itemcode: '004380.010.1', locationcode: 'B.04.000', lotcode: '27.F1',
    ptronhand: '125', ptrreviewed: '120', ptravailable: '5', s_lts: '-2', loc_photo_match: null, loc_match_qty: '999' };
  const rows = [source, { ...source, lotcode: '26.S1', ptronhand: '1921', s_lts: '777' },
    { ...source, locationcode: 'OTHER', ptronhand: '9000', s_lts: '888' }];
  const exact = backend.buildSuspendTagMetricFallback(source, rows, [], true);
  assert.deepEqual([exact.PTRONHAND, exact.PTRREVIEWED, exact.PTRAVAILABLE, exact.S_LTS,
    exact.LOC_PHOTO_MATCH, exact.LOC_ON_HAND], [125, 120, 5, -2, null, 2046]);
  const wrongLot = backend.buildSuspendTagMetricFallback({ ...source, lotcode: '99.F1' }, rows, [], true);
  assert.equal(wrongLot.PTRONHAND, null, 'an explicit missing lot never borrows another lot');
  const missingLot = backend.buildSuspendTagMetricFallback({ ...source, lotcode: '' }, rows, [], true);
  assert.equal(missingLot.MATCH_LEVEL, 'item-location');
  assert.equal(missingLot.PTRONHAND, 2046, 'lotless fallback stays at the exact item/location');

  const frontend = runFunctions('assets/app-runtime.js', ['isFalseBlockLocation', 'normalizeRequestCardMetrics', 'buildQueueInventoryMetricsHtml'], {
    window: {}, resolveLiveInventoryForCard: () => null, getQueueDisplayEvidenceRow: () => null, firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== ''),
    isDockSuspendDcRequestMirrorRow: () => true,
    getQueueCardInventoryState: () => { throw new Error('False Block must not start inventory hydration'); },
    getQueueCardInventoryAuthorizationContext: () => null,
    getSuspendTagMetricDisplayFallback: () => null,
    buildInventoryQuantityChipsHtml: () => '<div>inventory metrics</div>'
  });
  for (const locationcode of ['0.00.111', '00.00.111', '00.000.111']) {
    const falseBlock = { ...source, locationcode };
    const metrics = backend.buildSuspendTagMetricFallback(falseBlock, [...rows, falseBlock], [], true);
    for (const field of ['PTRONHAND', 'PTRREVIEWED', 'PTRAVAILABLE', 'S_LTS', 'LOC_PHOTO_MATCH', 'LOC_ON_HAND']) {
      assert.equal(metrics[field], null, `${locationcode}: ${field}`);
    }
    const falseBlockHtml = frontend.buildQueueInventoryMetricsHtml({ ...falseBlock, suspend_tag_metrics: exact });
    assert.match(falseBlockHtml, /FALSE BLOCK — Add Location\(s\) to Fill Tag/,
      `${locationcode} renders the explicit Fill Tag helper`);
    assert.doesNotMatch(falseBlockHtml, /inventory metrics/,
      `${locationcode} renders no inventory metric boxes even with a stale enriched payload`);
  }
});

test('Invariant 65 (Mobile Home Keeps All Dashboard Rows in the Header-to-Dock Fit)', () => {
  const styles = read('assets/app-styles.css');
  assert.match(styles, /current-view-home\.home-dashboard-mode[\s\S]{0,5000}grid-template-rows:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/,
    'mobile Home allocates six bounded rows inside its flex-filled dashboard');
  assert.match(styles, /current-view-home\.home-dashboard-mode[\s\S]{0,1200}padding:\s*8px 8px calc\(64px \+ env\(safe-area-inset-bottom\)\)/,
    'the Home content reserves the shared bottom dock clearance');

  const button = { disabled: false, classList: { toggle() {} }, querySelector: () => ({ innerText: '' }) };
  const summary = { dataset: {}, addEventListener: (_type, handler) => { summary.onClick = handler; } };
  const panel = { open: true, dataset: {}, classList: { toggle() {} }, querySelector: () => summary };
  let width = 390;
  const context = runFunctions('assets/app-runtime.js', ['syncGoogleScriptButton'], {
    isRunScriptActive: false,
    window: { get innerWidth() { return width; }, googleScriptRunInFlight: false },
    document: { getElementById: id => id === 'run-google-script-btn' ? button : id === 'dashboard-sync-accordion' ? panel : null },
    canRunManualInventoryImport: () => false,
    canViewDashboardSyncStatus: () => true,
    hasActiveManualSync: () => false,
    getManualSyncProgressInfo: () => ({ text: '' }),
    isAutoManualSyncStatus: () => false
  });
  context.syncGoogleScriptButton();
  assert.equal(panel.open, true, 'mobile initialization expands the imported-file disclosure');
  width = 1024;
  context.syncGoogleScriptButton();
  assert.equal(panel.open, true, 'desktop initialization retains the expanded disclosure default');
  width = 390;
  context.syncGoogleScriptButton();
  assert.equal(panel.open, true, 'crossing into mobile retains the expanded default');
  summary.onClick({ isTrusted: true });
  panel.open = true;
  context.syncGoogleScriptButton();
  width = 1024;
  context.syncGoogleScriptButton();
  assert.equal(panel.open, true, 'a user-selected disclosure state is preserved across viewport changes');
});

test('Invariant 66 (JD Universal Request Directory and Valid N/A Pair)', () => {
  const runtime = runFunctions('assets/app-runtime.js', [
    'normalizeRepMatchToken', 'normalizeRepDisplayOrder', 'isUniversalRequestDirectoryRep'
  ], { currentUser: 'jd_jones', nativeAuthProfile: { username: 'jd_jones' }, normalizePushUsername: value => String(value || '').trim().toLowerCase() });
  assert.equal(runtime.isUniversalRequestDirectoryRep('JD Jones'), true);
  assert.equal(runtime.isUniversalRequestDirectoryRep('jd_jones'), true);
  assert.equal(runtime.isUniversalRequestDirectoryRep('VP of Sales'), true);
  assert.equal(runtime.isUniversalRequestDirectoryRep('Rep One'), true, 'JD receives the global directory while any rep is selected');

  const app = read('assets/app-runtime.js');
  assert.match(app, /JD_EXECUTIVE_SALESREP_ID\s*=\s*'AGDATA_EXECUTIVE_ALL'/);
  assert.match(app, /getRequestUniversalCustomerOptions\([^]*customerRepMapRows[^]*socInventory[^]*reservesInventory[^]*requestsInventory[^]*requestHistoryInventory/);
  assert.match(app, /buildRequestModalNaCustomerOption\(selectedSalesrepId\)/,
    'every selected rep directory always starts with the authorized N/A tuple');
  assert.match(app, /String\(currentUser \|\| ''\)[^]*=== 'jd_jones'[^]*resolveCanonicalRequestRepName\('JD Jones'\)/,
    'JD defaults the request rep selection to himself');

  const edge = read('supabase/functions/app-api/index.ts');
  assert.match(edge, /request\.operation === "options"[^]*request_customer_directory_v23102/);
  const migration = read('supabase/migrations/20261027124800_agdata_v2383_jd_universal_customer_directory.sql');
  for (const source of ['ph_customer_consignee_sales_reps','ph_soc_master','ph_reserves','ph_active_request','ph_request_history']) {
    assert.match(migration, new RegExp(source), `${source} contributes to JD's complete directory`);
  }
  assert.match(migration, /selected_id='AGDATA_EXECUTIVE_ALL'[^]*is_jd_universal_request_tuple_v1/,
    'submission validates the exact executive tuple against the same app-wide sources');
  assert.match(migration, /AGDATA_NA_CUSTOMER[^]*AGDATA_NA_CONSIGNEE/);
});

test('Invariant 67 (Interactive Login and Atomic Drive Publication Retain Their Exact Owners)', () => invariant67({read}));

test('Invariant 68 (Reclass Delta Reports, Bloom Gallery Shares and Discoverable Passkeys Stay Canonical)', () => sharePasskeyContract(runFunctions,read,functionSource));

test('Invariant 69 (Season Winner AV Notes and Shared Card Evidence Stay Exact)', () => {
  const runtime = read('assets/app-runtime.js');
  const styles = read('assets/ops-precision-pilot.css');
  assert.match(runtime, /function requiresAvNoteForCompletion\(item = null\) \{[^]*return isSeasonSalesNoteWinner\(item\);/);
  assert.match(runtime, /function isSeasonSalesNoteWinner\(item = null\)/);
  assert.doesNotMatch(runtime, /const displaySpec = hasCardPhotoEvidence/);
  assert.doesNotMatch(runtime, /const displayCaliper = hasCardPhotoEvidence/);
  assert.match(runtime, /app-bloom-card-evidence[^]*Spec:[^]*Caliper:/);
  assert.match(runtime, /CALIPER:/);
  assert.match(styles, /--drive-card-photo-width:\s*92px;[^]*--drive-card-photo-height:\s*92px;/);
  assert.match(styles, /--drive-card-photo-width:\s*80px;[^]*--drive-card-photo-height:\s*80px;/);
  assert.match(styles, /app-drive-card-photo img[^}]*object-fit:\s*cover\s*!important/);
});

test('Invariant 70 (Reclass New Seasons Persist Zero-Baseline Stock and Durable Evidence)', () => {
  const edge = read('supabase/functions/_shared/production-workflow.ts');
  const migration = read('supabase/migrations/20261027163924_agdata_v2387_reclass_persistence_and_evidence.sql');
  const batchMigration = read('supabase/migrations/20261027171000_agdata_v2387_batch_reclass_evidence.sql');
  const preview = read('assets/reclass-move-worksheet.js');
  assert.match(preview, /physicalSeasonKeys = new Set\(rows\.map\(stockKey\)\)/);
  assert.match(preview, /if \(!current && !physicalSeasonKeys\.has\(destinationSeasonKey\)\) seasonOpenStocks\.set\(destinationSeasonKey, 0\)/);
  assert.match(edge, /receipt\.ok !== true[^]*receipt\.status[^]*'applied'[^]*Array\.isArray\(receipt\.rows\)[^]*INVENTORY_RECLASS_COMMIT_UNCONFIRMED/);
  for (const field of ['photo_link','date_completed','spec','caliper','loc_match_pct','loc_match_qty','loc_photo_match']) assert.match(migration, new RegExp(field));
  assert.match(migration, /ptronhand='325'[^]*ptravailable='325'[^]*s_lts='325'/);
  assert.match(migration, /ptronhand='1843'[^]*ptravailable='1843'[^]*s_lts='998'/);
  assert.match(batchMigration, /source_before->>'loc_photo_match'/);
  for (const field of ['photo_link','photo_name','date_completed','pick_note','sales_note']) assert.match(batchMigration, new RegExp(field));
});

test('Invariant 71 (Pages Fast Gate Retains a Bounded Cleanup Margin)', () => {
  const workflow = read('.github/workflows/pages-static.yml');
  const fastGate = workflow.slice(workflow.indexOf('  fast-gate:'), workflow.indexOf('\n  backend-publication:'));
  assert.match(fastGate, /timeout-minutes:\s*4/);
  assert.match(fastGate, /Focused release contracts only \(15 second budget\)/);
});

test('Invariant 72 (Every v2.3.87 Migration Has a Live Installed-State Contract)', () => {
  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  assert.match(runner, /name === agdataV2387ReclassPersistenceEvidenceMigrationName[^]*20261027163924[^]*010585\.031\.1/);
  assert.match(runner, /name === agdataV2387BatchReclassEvidenceMigrationName[^]*20261027171000[^]*reclass-batch-evidence-v2387/);
});

test('Invariant 73 (Full Inventory Reads Preserve Durable Reclass Photo Evidence)', () => {
  const projections = read('supabase/functions/_shared/inventory-projections.ts');
  const browserContract = read('assets/inventory-list-contract.js');
  const fullStart = projections.indexOf('export const INVENTORY_MASTER_FULL_COLUMNS');
  const fullEnd = projections.indexOf('export const INVENTORY_MASTER_BROWSE_COLUMNS', fullStart);
  assert.ok(fullStart >= 0 && fullEnd > fullStart, 'full inventory projection block exists');
  const full = projections.slice(fullStart, fullEnd);
  for (const field of ['loc_match_pct', 'loc_photo_match', 'baseline_on_hand', 'initial_photo_match_qty']) {
    assert.match(full, new RegExp(`"${field}"`), `${field} survives the app-api full-row boundary`);
    assert.match(projections, new RegExp(`INVENTORY_MASTER_BROWSE_COLUMNS[^]*"${field}"`), `${field} survives the app-api startup browse boundary`);
    assert.match(browserContract, new RegExp(`'${field}'`), `${field} survives the direct browser full-row boundary`);
  }
});

test('Invariant 74 (AV Invalidation Checks Never Rewrite Durable Loc Photo Match)', () => {
  const runtime = read('assets/app-runtime.js');
  const start = runtime.indexOf('function getMasterAvInvalidationReasons(item)');
  const end = runtime.indexOf('function getMasterAvOpenLtsValue(item)', start);
  assert.ok(start >= 0 && end > start, 'AV invalidation helper exists');
  const helper = runtime.slice(start, end);
  assert.doesNotMatch(helper, /item\.LOC_MATCH_QTY\s*=/);
  assert.match(helper, /calculateLocMatchQtyValue\(item\)\s*\?\?\s*parseAppNumber\(item\.LOC_MATCH_QTY\)/);
});

test('Invariant 75 (v2.3.88 Existing Evidence, Docks, Navigation and Watchdog Stay Fail-Open)', () => {
  const runtime = read('assets/app-runtime.js');
  const edge = read('supabase/functions/app-api/index.ts');
  const workflow = read('supabase/functions/_shared/production-workflow.ts');
  const bunch = read('assets/bunch-note.js');
  const navigation = read('assets/navigation-preferences.js');
  const migration = read('supabase/migrations/20261027184835_agdata_v2388_unified_runtime_recovery.sql');
  assert.match(runtime, /getSuspendTagExistingReviewPatch[^]*dock_photo_link:[^]*loc_match_qty:/);
  assert.match(runtime, /getScopedDocksItems[^]*dock !== 'Unassigned'/);
  assert.doesNotMatch(runtime.slice(runtime.indexOf('function getScopedDocksItems'), runtime.indexOf('function rebuildSocOrderLineIdentityIndex')), /filter\(isDockRowWithinPlanStartWindow\)/);
  assert.match(edge, /customer-rep-map[^]*CUSTOMER_REP_MAPPING_REVALIDATING/);
  assert.match(workflow, /resolveCurrentReclassSourceIds[^]*\.eq\('itemcode'[^]*\.eq\('locationcode'/);
  assert.match(bunch, /bn-suggestion-menu[^]*Type custom…/);
  assert.match(navigation, /data-nav-slot[^]*data-nav-module[^]*data-nav-left[^]*data-nav-right/);
  assert.match(migration, /reclass-source-alias-v2388/);
  assert.match(migration, /where status='open'/);
});

test('Invariant 76 (Bunch Notes Back Treats Each Visible Drill Screen as One Step)', () => {
  const bunch = read('assets/bunch-note.js');
  const start = bunch.indexOf('function back()');
  const end = bunch.indexOf('const destinationList', start);
  assert.ok(start >= 0 && end > start, 'Bunch Notes Back helper exists');
  const back = bunch.slice(start, end);
  assert.match(back, /else if\(state\.location\)\{state\.location='';state\.locationStep='setup';\}/);
  assert.doesNotMatch(back, /state\.location&&state\.locationStep==='items'/);
});

test('Invariant 77 (Managers Hub, Live File Revisions and Bunch Drafts Stay Durable)', () => managerSyncContract(read));

test('Invariant 78 (Manager Shell Enhancement Preserves Every Submodule Deep Link)', () => invariant78({read}));

test('Invariant 79 (CAV Revision Refresh Accepts Every Published Read Column)', () => {
  const types = read('supabase/functions/_shared/database.types.ts');
  const contracts = read('services/database-contracts.generated.ts');
  const browserBridge = read('assets/vendor/supabase-browser-2.112.3.min.js');
  assert.match(types, /ph_cav_import:[^]*Row:[^]*open_stock: string \| null[^]*season_oh: string \| null/);
  assert.match(contracts, /"ph_cav_import"[^]*"open_stock"[^]*"season_oh"/);
  assert.match(browserBridge, /ph_cav_import[^]*open_stock[^]*season_oh/);
  assert.match(read('.codex/skills/agdata-sync-and-supabase-architect/SKILL.md'), /Never let generated database contracts lag live read-only columns/);
});

test('Invariant 80 (Higher File Revision Repaints Home Metadata Even at the Same Timestamp)', () => {
  const runtime = read('assets/app-runtime.js');
  const start = runtime.indexOf('function mergeDashboardSyncSummaries(summaries = [])');
  const end = runtime.indexOf('async function prefetchDashboardSyncMetadataAfterLogin()', start);
  assert.ok(start >= 0 && end > start, 'Home metadata merge helper exists');
  const merge = runtime.slice(start, end);
  assert.match(merge, /entryRevision[^]*existingRevision[^]*entryRevision > existingRevision/);
  assert.match(merge, /revision: entryRevision === null \? '' : String\(entry\.revision\)/);
  assert.match(runtime, /revision: String\(source\.revision \?\? ''\)[^]*authoritative:/);
  assert.match(read('.codex/skills/agdata-sync-and-supabase-architect/SKILL.md'), /Never resolve equal-timestamp Home filename metadata lexically/);
});

test('Invariant 81 (Fill Tag, Bunch Delivery, and Move Up Preserve Physical Boundaries)', () => {
  const runtime = read('assets/app-runtime.js');
  const bunch = read('assets/bunch-note.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  const workflow = read('supabase/functions/_shared/production-workflow.ts');
  const gas = read('Code.gs');
  const migration = read('supabase/migrations/20261027211049_agdata_v2390_universal_fill_tag_bunch_dylan_reclass_lot_cap.sql');
  assert.match(runtime, /function isFalseBlockLocation[^]*\^0\+\\\.0\+\\\.111/);
  assert.match(runtime, /action\('Change \/ Add Location','fill-tag'\)/);
  assert.match(runtime, /customRows: normalizedCustomRows/);
  assert.match(runtime, /Open Stock \(Max Move Up\)[^]*Cannot Move Up more than Open Stock/);
  assert.match(bunch, /return \[dylan\.email\.trim\(\)\.toLowerCase\(\)\]/);
  assert.doesNotMatch(bunch, /Card assignees are added automatically/);
  assert.match(appApi, /forceBunchNoteDylanRecipient[^]*recipient_ids: \[dylanProfileId\]/);
  assert.match(workflow, /enforceReclassMoveUpOpenStock[^]*INVENTORY_RECLASS_MOVE_UP_OPEN_STOCK_EXCEEDED/);
  assert.match(gas, /const recipients = \[dylan\]/);
  for (const marker of ['suspend-fill-tag-v2390','location-sales-notes-v2390','reclass-move-up-open-stock-v2390']) assert.ok(migration.includes(marker), marker);
});

test('Invariant 82 (Bunch Worker Patch Reaches Apps Script HEAD Through the Scoped Merger)', () => {
  const merger = read('scripts/apps-script-function-patch.mjs');
  const manifest = JSON.parse(read('package.json'));
  assert.ok(manifest.appsScriptPatchFunctions.includes('handleSignedBunchNoteDelivery_'));
  assert.match(merger, /bunchNoteEmailHandler = 'handleSignedBunchNoteDelivery_'/);
  assert.match(merger, /additiveEmailHandler, bunchNoteEmailHandler/);
  assert.match(merger, /!bunchNoteEmailFunctions\.has\(name\)/);
  assert.match(read('.codex/skills/agdata-email-outbox-and-worker-guard/SKILL.md'), /scoped merger allowlist and additive-function set/);
});

test('Invariant 83 (One Click Starts One Sync and Status Polling Never Dispatches Work)', async () => {
  let releaseHeaders;
  const pendingHeaders = new Promise(resolve => { releaseHeaders = resolve; });
  const writes = [];
  const context = runFunctions('assets/app-runtime.js', ['runGoogleAppsScriptTrigger', 'refreshManualSyncStatus'], {
    isRunScriptActive: false, window: {}, currentUser: 'dylan_collyge', currentUserDisplay: 'Dylan',
    document: { hidden: false }, navigator: { onLine: true }, console,
    manualSyncStatusState: null, manualSyncStatusPollInFlight: false, lastManualSyncStatusCheckedAt: 0,
    MANUAL_SYNC_STAGE_ORDER_CLIENT_DEFAULT: ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed'],
    MANUAL_SYNC_SCRIPT_TIMEOUT_MS: 600000, MANUAL_SYNC_STATUS_STALE_MS: 12000,
    releaseStaleManualSyncClientStateIfNeeded() {}, canRunManualInventoryImport: () => true,
    hasActiveManualSync: () => false, syncGoogleScriptButton() {}, showToast() {},
    getSupabaseReadIdentityScope: () => 'same-account', getNativeAuthRequestHeaders: () => pendingHeaders,
    applyManualSyncStatus: status => status, firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== ''),
    handleDeferredManualSyncStart: () => false,
    APP_API_FUNCTION_URL: '/app-api', crypto: { randomUUID: () => 'sync-command' },
    postAppFunctionJson: async (url, payload) => { writes.push(payload); return { ok: true, data: { active: false, status: 'complete' } }; },
    fetchManualSyncStatusFromScript: async () => ({ active: false, currentStage: 'idle' })
  });
  const firstClick = context.runGoogleAppsScriptTrigger();
  assert.equal(context.isRunScriptActive, true);
  await context.runGoogleAppsScriptTrigger();
  releaseHeaders({ Authorization: 'Bearer fixture-token' });
  await firstClick;
  assert.equal(writes.length, 1);
  assert.equal(writes[0].action, 'erp_sync');
  assert.equal(writes[0].operation, 'start');
  assert.equal(writes[0].commandId, 'sync-command');
  assert.equal(writes[0].maxAttemptsPerStage, 1);
  assert.equal(writes[0].force, true);
  assert.equal(context.isRunScriptActive, false);
  await context.refreshManualSyncStatus(true);
  await context.refreshManualSyncStatus(true);
  assert.equal(writes.length, 1);
  for (const name of ['applyManualSyncStatus', 'releaseStaleManualSyncClientStateIfNeeded']) {
    assert.doesNotMatch(functionSource('assets/app-runtime.js', name), /postGoogleScriptJsonPayload|requestManualSyncServerStaleSweep|manual_continue/);
  }
  const hydration = runFunctions('assets/app-runtime.js', ['isDatasetFrozenDuringManualSync'], {
    hasActiveManualSync: () => true, MANUAL_SYNC_FROZEN_DATASET_KEYS: new Set(['master', 'cav']),
    manualSyncStatusState: { stageOrder: ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed'], stageIndex: 1 },
    datasetLoadState: { master: { fullLoaded: true }, cav: { fullLoaded: true } }
  });
  assert.equal(hydration.isDatasetFrozenDuringManualSync('master', 'full'), false, 'published Drive data can hot-reload while later stages run');
  assert.equal(hydration.isDatasetFrozenDuringManualSync('cav', 'full'), true, 'current CAV import retains its completed snapshot');
});

test('Invariant 84 (Committed Reclass Receipt Advances and Persists the Matching Snapshot)', async () => {
  const source = ['reconcileArgosReclassMoveReceipt', 'publishArgosReclassMoveReceiptRows']
    .map(name => functionSource('assets/app-runtime.js', name)).join('\n');
  assert.match(source, /masterState\.liveVerifiedRevision\s*=\s*receiptRevision\.toString\(\)/);
  assert.match(source, /masterState\.liveVerifiedScope\s*=\s*liveContext\.scope/);
  assert.match(source, /await persistCurrentCache\(true, 'inventory-reclass-move-confirmed'\)/);
  assert.match(source, /publishArgosInventoryTransactionReturnedRows\(Array\.from\(published\.values\(\)\)\)/);

  const runMove = async (revision) => {
    const rows = [{ UNIQUE_ID: 'source', PTRONHAND: '50' }];
    const masterState = { liveVerifiedRevision: revision, liveVerifiedScope: 'scope', liveVerifiedPermission: 'permission' };
    const receipt = { revision: '42', seasonStocks: [], rows: [
      { row: { unique_id: 'source', ptronhand: '30' } },
      { row: { unique_id: 'destination', ptronhand: '20' } },
    ] };
    const command = { commandId: 'receipt-command', moves: [] };
    const stored = { command, inquiryPayload: null };
    const persisted = [];
    const context = runFunctions('assets/app-runtime.js', ['applyArgosInventoryReclassMoveCommand'], {
      getArgosReclassLiveEditIdentityKey: () => 'actor',
      getDatasetState: () => masterState,
      getProductionLiveSyncContext: () => ({ scope: 'scope', dataPermissionVersion: 'permission' }),
      confirmedArgosReclassLiveEditRevisions: new Map(),
      persistPendingArgosInventoryReclassMove() { return true; },
      readPendingArgosInventoryReclassMove: () => stored,
      getInventoryReclassMovesService: () => ({ status: async () => ({ status: 'applied', receipt }) }),
      publishOptimisticReclassRows() { return []; }, applyReclassSeasonStocks() {},
      applyArgosInventoryTransactionReturnedRow(row) {
        const updated = { ...row, UNIQUE_ID: row.unique_id, PTRONHAND: row.ptronhand };
        const index = rows.findIndex(existing => existing.UNIQUE_ID === updated.UNIQUE_ID);
        if (index < 0) rows.push(updated); else rows[index] = updated;
        return updated;
      },
      publishArgosInventoryTransactionReturnedRows() {},
      invalidateArgosReclassLiveEditCaches() {}, retireConfirmedArgosReclassMoveProposals() {},
      setArgosReclassMoveInputsLocked() {}, isInventoryStatusOutcomeUncertain: () => false,
      persistCurrentCache: async (immediate, reason) => {
        persisted.push({ immediate, reason, rows: rows.map(row => ({ ...row })) });
        return true;
      },
    });
    const state = { pendingReclassMove: { command, inquiryPayload: null, movedUids: ['source'], uncertain: true }, inquiryModel: {} };
    await context.applyArgosInventoryReclassMoveCommand(state, null, 'actor');
    return { rows, masterState, persisted };
  };

  const current = await runMove('41');
  assert.equal(current.masterState.liveVerifiedRevision, '42');
  assert.deepEqual(plain(current.rows.map(row => [row.UNIQUE_ID, row.PTRONHAND])), [['source', '30'], ['destination', '20']]);
  assert.equal(current.persisted.length, 1);
  assert.equal(current.persisted[0].immediate, true);
  assert.deepEqual(plain(current.persisted[0].rows.map(row => [row.UNIQUE_ID, row.PTRONHAND])), [['source', '30'], ['destination', '20']]);

  const stale = await runMove('43');
  assert.equal(stale.masterState.liveVerifiedRevision, '43');
  assert.deepEqual(plain(stale.rows.map(row => [row.UNIQUE_ID, row.PTRONHAND])), [['source', '50']]);
  assert.equal(stale.persisted.length, 0, 'an older receipt cannot persist over the newer snapshot');
});

test('Invariant 85 (Release Builds Reuse One Directory Without Following Links or Retaining Stale Payloads)', async () => {
  const fs = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { prepareReleaseSiteDirectory, releaseSiteDirectory } = await import('../scripts/release-disk-policy.mjs');
  const fixture = await fs.mkdtemp(path.join(tmpdir(), 'agdata-site-policy-'));
  const site = path.join(fixture, '_site');
  const assets = path.join(site, 'assets');
  const outside = path.join(fixture, 'source');
  async function clearTemporaryTree(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) await fs.unlink(file);
      else if (entry.isDirectory()) await clearTemporaryTree(file);
      else { await fs.writeFile(file, ''); await fs.unlink(file); }
    }
    await fs.rmdir(directory);
  }
  try {
    await fs.mkdir(assets, { recursive: true });
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'keep.js'), 'source remains intact');
    const originalDirectory = await fs.stat(site);
    for (const contents of ['old build', 'second build']) {
      await fs.writeFile(path.join(assets, 'obsolete.js'), contents);
      assert.equal(await prepareReleaseSiteDirectory(fixture, { clear: true, env: {} }), site);
      assert.deepEqual(await fs.readdir(assets), ['obsolete.js']);
      assert.equal(await fs.readFile(path.join(assets, 'obsolete.js'), 'utf8'), '');
      assert.equal((await fs.stat(site)).ino, originalDirectory.ino, 'the output directory is retained');
    }
    assert.equal(releaseSiteDirectory(fixture, {}), site);
    assert.throws(() => releaseSiteDirectory(fixture, { LIVE_SITE_DIR: '_site-copy' }), /PATH_INVALID/);
    assert.throws(() => releaseSiteDirectory(fixture, { LIVE_SITE_DIR: '../escape' }), /PATH_INVALID/);
    await fs.writeFile(path.join(assets, 'keep-until-valid.js'), 'prior output');
    await fs.symlink(outside, path.join(assets, 'redirect'), 'junction');
    await assert.rejects(prepareReleaseSiteDirectory(fixture, { clear: true, env: {} }), /SYMLINK_FORBIDDEN/);
    assert.equal(await fs.readFile(path.join(assets, 'keep-until-valid.js'), 'utf8'), 'prior output');
    assert.equal(await fs.readFile(path.join(outside, 'keep.js'), 'utf8'), 'source remains intact');
  } finally {
    await clearTemporaryTree(fixture);
  }
});

test('Invariant 86 (PostgreSQL Sync Status Cannot Dispatch Imports Through Background Reads)', async () => {
  const calls = [];
  const status = runFunctions('assets/app-runtime.js', ['fetchManualSyncStatusFromScript'], {
    normalizeManualSyncStatusPayload: value => value,
    supabaseRpc: async (rpc, body) => {
      calls.push({ rpc, body });
      return { active: false, currentStage: 'idle' };
    }
  });
  assert.equal((await status.fetchManualSyncStatusFromScript()).currentStage, 'idle');
  assert.deepEqual(plain(calls), [{ rpc: 'get_my_erp_sync_progress_v23116', body: {} }]);
  const { erpSyncProgressReadFixture, releaseSnapshotReadFixture } = await import('./helpers/release-smoke-route-policy.mjs');
  assert.equal(erpSyncProgressReadFixture(calls[0].body).active, false);
  assert.equal(releaseSnapshotReadFixture({ action: 'erp_sync', operation: 'start' }), null);
  assert.equal(erpSyncProgressReadFixture({ force: true }), null);
  assert.equal(erpSyncProgressReadFixture({ actorId: 'forged' }), null);
});

test('Invariant 87 (ERP API Allows Status Reads and Admin-Leased Cloud Continuations)', () => erpApiAuthorizationContract(runFunctions));

test('Invariant 88 (Selected Edge Syntax Validation Writes No Build Artifacts and Rejects Path Injection)', async () => {
  const workflow = read('.github/workflows/pages-static.yml');
  const start = workflow.indexOf('- name: Parse and bundle selected Edge Functions with esbuild');
  const block = workflow.slice(start, workflow.indexOf('      - uses:', start));
  const script = block.split("<<'NODE'\n")[1].split('\n          NODE')[0]
    .replace(/^\s*import .*;\s*$/gm, '');
  const builds = [];
  const context = vm.createContext({ process: { env: { RELEASE_EDGE_FUNCTIONS: '["app-api"]' } },
    resolve: path.resolve, build: async options => builds.push(options), console: { log() {} } });
  await vm.runInContext(`(async () => { ${script} })()`, context);
  assert.equal(builds.length, 1);
  assert.equal(builds[0].write, false);
  assert.equal(builds[0].bundle, true);
  assert.ok(builds[0].external.includes('https://*'));
  context.process.env.RELEASE_EDGE_FUNCTIONS = '["../outside"]';
  await assert.rejects(vm.runInContext(`(async () => { ${script} })()`, context), /RELEASE_EDGE_NAME_INVALID/);
  assert.equal(builds.length, 1);
});

test('Invariant 89 (Local ERP Worker Requires Service Authorization and an Active Bound Lease)', async () => {
  const calls = [];
  const secret = 'isolated-fixture-service-key';
  const context = runFunctions('supabase/functions/app-api/index.ts', ['handleErpSyncWorker'], {
    ERP_SYNC_LOCAL_WORKER_KEY: secret, jsonObject: value => value || {}, jsonResponse: value => value,
    errorResponse: (_message, status, extra) => ({ ok: false, status, ...extra }),
    ERP_SYNC_WORKER_OPERATIONS: { columns: { rpc: 'fast_erp_import_columns_v1', argKeys: ['p_dataset_key'] } },
    supabase: { rpc: async name => {
      calls.push(name);
      if (name === 'get_erp_sync_status_v1') return { data: { active: false } };
      if (name === 'assert_erp_sync_worker_v1') return { error: { code: 'LEASE_INVALID' } };
      throw new Error(`Unexpected RPC ${name}`);
    } },
  });
  const request = key => new Request('https://fixture.invalid', { headers: { authorization: `Bearer ${key}`, apikey: key } });
  const body = { action: 'erp_sync_worker', payload: { operation: 'status' } };
  assert.equal((await context.handleErpSyncWorker(body, request('anon'))).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await context.handleErpSyncWorker(body, request(secret))).data.active, false);
  const scoped = { action: 'erp_sync_worker', payload: { operation: 'columns',
    runId: '00000000-0000-4000-8000-000000000001', workerId: '00000000-0000-4000-8000-000000000002', args: { p_dataset_key: 'drive_around' } } };
  assert.equal((await context.handleErpSyncWorker(scoped, request(secret))).code, 'ERP_SYNC_WORKER_LEASE_INVALID');
  assert.deepEqual(calls, ['get_erp_sync_status_v1', 'assert_erp_sync_worker_v1']);
  scoped.payload.args.sql = 'forged';
  assert.equal((await context.handleErpSyncWorker(scoped, request(secret))).status, 400);
  assert.equal(calls.length, 2);
});

test('Invariant 90 (IPv6 CLI Link Failures Are Classified Without Exposing Connection Details)', () => {
  const sensitiveRef = 'private-project-ref-must-not-leak';
  const observed = `IPv6 is not supported on your current network. Run supabase link --project-ref ${sensitiveRef} to setup IPv4 connection.`;
  const code = classifySupabaseCliFailure({ status: 1, stderr: observed });
  assert.equal(code, 'LOW_STOCK_SUPABASE_CLI_PROJECT_LINK_FAILED');
  const report = formatSafeFailure({ phase: 'linked_cli_migrations', error: new Error(code) });
  assert.match(report, /LOW_STOCK_SUPABASE_CLI_PROJECT_LINK_FAILED phase=linked_cli_migrations/);
  assert.equal(report.includes(sensitiveRef), false);
  assert.equal(report.includes('IPv6'), false);
});

test('Invariant 91 (RUN SCRIPT Claims Explicit Cloud Continuations and Retires the Local Daemon)', () => erpApiContinuationContract(runFunctions));

test('Invariant 92 (Apps Script Head-Only Receipts Prove Source and Preserve the Existing Deployment)', async () => {
  const commit = 'a'.repeat(40);
  const files = [{ name: 'Code', type: 'SERVER_JS', source: `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = '${commit}';` }];
  const expectedFilesDigest = appsScriptFilesDigest(files);
  const written = [];
  const fileSystem = { mkdirSync: (...args) => written.push(['mkdir', ...args]),
    writeFileSync: (...args) => written.push(['write', ...args]) };
  const makeScript = ({ currentFiles = files, version = 17 } = {}) => ({ projects: {
    getContent: async () => ({ data: { files: currentFiles } }),
    deployments: { get: async () => ({ data: { deploymentId: 'deployment', deploymentConfig: { versionNumber: version } } }) }
  } });
  const receipt = await writeAppsScriptHeadOnlyEvidence({ script: makeScript(), scriptId: 'script', deploymentId: 'deployment',
    expectedCommit: commit, expectedDeploymentVersion: 17, expectedFilesDigest, evidenceDirectory: 'evidence',
    fileSystem, now: () => Date.parse('2026-10-27T12:00:00Z') });
  assert.equal(receipt.schemaVersion, 'gnc-apps-script-head-only-evidence-v1');
  assert.equal(receipt.deploymentUnchanged, true);
  assert.equal(receipt.deploymentUpdated, false);
  assert.equal(receipt.versionCreated, false);
  assert.equal(written.length, 2);

  for (const script of [
    makeScript({ currentFiles: [{ ...files[0], source: files[0].source + '\nchanged' }] }),
    makeScript({ version: 18 })
  ]) {
    const forbiddenWrites = [];
    await assert.rejects(writeAppsScriptHeadOnlyEvidence({ script, scriptId: 'script', deploymentId: 'deployment',
      expectedCommit: commit, expectedDeploymentVersion: 17, expectedFilesDigest, evidenceDirectory: 'evidence',
      fileSystem: { mkdirSync: (...args) => forbiddenWrites.push(args), writeFileSync: (...args) => forbiddenWrites.push(args) } }));
    assert.deepEqual(forbiddenWrites, [], 'source or deployment mismatch prevents evidence publication');
  }
  const workflow = read('.github/workflows/apps-script-deploy.yml');
  assert.match(workflow, /path: \.gnc-local\/apps-script-recovery-evidence\.json\n\s+include-hidden-files: true/);
});

test('Invariant 93 (Jorge Live Changes Require Canonical Assigned-Row Proof at Every Write Layer)', () => {
  const runtime = read('assets/app-runtime.js');
  const api = read('supabase/functions/app-api/index.ts');
  const workflow = read('supabase/functions/_shared/production-workflow.ts');
  const migration = read('supabase/migrations/20261028070752_agdata_v2392_jorge_assigned_live_changes.sql');
  assert.match(runtime, /function canUserMakeLiveChangesOnRow\([\s\S]*SCOPED_LIVE_CHANGE_USER_KEY[\s\S]*isRowAssignedToUser/);
  assert.match(runtime, /warmLiveChangeAssignmentsAfterLogin\(\);/);
  assert.match(runtime, /Live changes are only enabled for rows assigned to you in the Assigned Items tab\./);
  assert.match(workflow, /GLOBAL_INVENTORY_LIVE_CHANGE_USERS[\s\S]*mitch_kaiser/);
  assert.match(workflow, /ph_inventory_row_assignments[\s\S]*ph_warehouse_assigned_items/);
  assert.match(api, /handlePhotoUpload[\s\S]*authorize:\(activeSession,request,form,prefix\)=>authorizePhotoUpload/);
  assert.match(read('src/services/photo-upload-handler.ts'), /protectedPrefixes\.has\(prefix\) \? await deps\.authorize\(session,request,form,prefix\)/);
  assert.match(read('src/services/photo-upload-authorization.ts'), /await deps\.rpc\("authorize_photo_upload_v3074"/);
  assert.match(migration, /require_drive_live_change_profile_v2392[\s\S]*save_drive_evidence_v3/);
  assert.match(migration, /can_access_drive_mode[\s\S]*can_access_av[\s\S]*can_access_que[\s\S]*can_access_manager_tab[\s\S]*can_submit_reclass/);
});

test('Invariant 94 (Suspend Close, AV Options, Processed Toasts, and Eval Filters Stay Stable)', () => {
  const runtime = read('assets/app-runtime.js');
  const edge = read('supabase/functions/_shared/suspend-tag.ts');
  const migration = read('supabase/migrations/20261028114955_agdata_v2392_suspend_close_av_options_toast_eval_filter.sql');
  const context = runFunctions('assets/app-runtime.js', ['processedFileRevisionToken'], {
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') ?? '',
  });
  const base = { key: 'ph_soc_master', sourceFileName: 'SOC.xlsx', sourceFileId: 'drive-file-1' };
  assert.equal(context.processedFileRevisionToken({ ...base, revision: 10, changedAt: '2026-10-28T10:00:00Z' }),
    context.processedFileRevisionToken({ ...base, revision: 11, changedAt: '2026-10-28T10:01:00Z' }),
    'revision-only polling cannot repeat a processed-file toast');
  assert.notEqual(context.processedFileRevisionToken(base), context.processedFileRevisionToken({ ...base, sourceFileName: 'SOC-2.xlsx' }));
  const requestItemOptions = functionSource('assets/app-runtime.js', 'loadRequestItemCodeOptions');
  assert.match(requestItemOptions, /const retainedRows = forceRefresh \? sharedRows : \[\.\.\.sharedRows, \.\.\.\(Array\.isArray\(state\.rows\) \? state\.rows : \[\]\)\];/);
  assert.match(requestItemOptions, /formatFetchedRows\(forceRefresh \? \[\.\.\.rawRows, \.\.\.retainedRows\] : \[\.\.\.retainedRows, \.\.\.rawRows\]/);
  assert.match(runtime, /operation !== 'close' && \['send', 'retry'\]/);
  assert.match(runtime, /!\['save', 'complete', 'close'\]\.includes\(operation\) && !writeProof/);
  assert.match(runtime, /sourceIdentity: \{ \.\.\.getSuspendTagStableSourceIdentity\(mirror\)/);
  assert.match(functionSource('assets/app-runtime.js', 'openDockSuspendDcRequestUpdate'), /skipRequestOpenInfoModal:\s*true/);
  assert.match(runtime, /EVAL_USER_FILTER_USERS = new Set\(\['dylan_collyge', 'megan_kelly', 'jd_jones', 'mitch_kaiser'\]\)/);
  assert.match(edge, /sourceIdentity[\s\S]*!\['close', 'add_candidates', 'save', 'complete'\]\.includes\(operation\)/);
  assert.match(migration, /suspend-close-stable-identity-v2392[\s\S]*p_operation<>'close'[\s\S]*suspend-tag-complete:/);
  assert.match(migration, /ph_suspend_history[\s\S]*security_invoker=true/);
});

test('Invariant 95 (Bunch Note Multi-Select Choices Learn Per Field Without Repeating Card Direction)', () => {
  const bunch = read('assets/bunch-note.js');
  const css = read('assets/bunch-note.css');
  const pdf = read('services/bunch-note-pdf.mjs');
  const api = read('supabase/functions/app-api/index.ts');
  const gas = read('Code.gs');
  for (const house of ['North House','South House','East House','West House','Center House']) assert.match(bunch, new RegExp(house));
  assert.match(bunch, /BUNCH_NOTE_DROPDOWN_STORE_KEY = 'inv_bunch_notes_custom_dropdowns_v1'/);
  assert.match(bunch, /function renderBunchNoteMultiSelectDropdown[\s\S]*aria-multiselectable="true"[\s\S]*Or type custom/);
  assert.match(bunch, /ensureBunchNoteDropdownOptionSaved[\s\S]*dropdown_options_save/);
  assert.match(api, /operation === "dropdown_options_save"[\s\S]*inv_bunch_notes_custom_dropdowns_v1[\s\S]*dylan_collyge/);
  assert.match(css, /\.bn-card-picker[^}]*padding-bottom:108px/);
  assert.doesNotMatch(bunch, /Card direction/);
  assert.doesNotMatch(pdf, /routeParts\.push\(`Direction/);
  assert.doesNotMatch(pdf, /\['Default house plan', report\.default_house_plan\]/);
  assert.doesNotMatch(gas, /Default house plan: ' \+ \(r\.default_house_plan/);
});

test('Invariant 96 (Request and Assigned Items Always Paint Last-Known-Good Rows Before Refresh)', () => {
  const runtime = read('assets/app-runtime.js');
  const requestRefresh = runtime.slice(runtime.indexOf('function refreshRequestViewInBackground'), runtime.indexOf('function renderRequest()'));
  const requestSwitch = runtime.slice(runtime.indexOf('function shouldRenderViewSynchronouslyOnSwitch'), runtime.indexOf('function switchView'));
  const assignedPanel = runtime.slice(runtime.indexOf('function renderManagerAssignedItemsExportPanel'), runtime.indexOf('function renderManagerEvalReportsPanel'));
  const managerRender = runtime.match(/function renderManagers\(\)[\s\S]*?^        }/m)[0];
  assert.match(runtime, /const REQUEST_VIEW_BACKGROUND_TIMEOUT_MS = 2500/);
  assert.match(requestSwitch, /targetViewId === 'request'[\s\S]*!requestState\.initialized \|\| !!requestState\.dirty/);
  assert.match(requestRefresh, /withTimeout\(getProductionLiveSyncCoordinator\(\)\.check\('queue-visible'\), REQUEST_VIEW_BACKGROUND_TIMEOUT_MS/);
  assert.match(requestRefresh, /withTimeout\(loadDatasetTargetsWithLimit\(pending/);
  assert.doesNotMatch(assignedPanel, /Loading AssignedTo rows/);
  assert.match(managerRender, /activeHomeTab !== MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && ensureViewDataForRender\('managers'\)/);
  assert.match(runtime, /plainManagersHubEntry[\s\S]*activeHomeTab = 'dashboard'/);
});

test('Invariant 97 (Empty Assigned Items Full Marker Cannot Suppress Current Warehouse Hydration)', () => invariant97({read}));

test('Invariant 98 (Universal Request Directory and Complete Tag Preserve Physical Identity)', () => {
  const runtime = read('assets/app-runtime.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  const suspendHandler = read('supabase/functions/_shared/suspend-tag.ts');
  const migration = read('supabase/migrations/20261028145127_agdata_v2394_universal_request_directory_suspend_identity.sql');
  assert.match(runtime, /matchSalesRepIdentity[\s\S]*buildSalesRepCustomerDirectory[\s\S]*selectCustomRequestCustomer[\s\S]*selectCustomRequestConsignee/);
  assert.match(runtime, /getSuspendTagStableSourceIdentity[\s\S]*tagcode[\s\S]*quantityshipped/);
  assert.match(appApi, /request_customer_directory_v23102/);
  assert.match(appApi, /const username = normalizeUsername\(String\(actor\.username \|\| ""\)\);[\s\S]*const executiveDirectory = username === "jd_jones"/);
  assert.match(appApi, /Boolean\(\(data as Record<string, unknown>\)\.universal\) !== executiveDirectory/);
  assert.match(suspendHandler, /SUSPEND_TAG_DATABASE_\$\{rpcCode\}/);
  assert.match(migration, /quantityshipped[\s\S]*tagcode[\s\S]*rep_for_row\(s\)\)\.id is distinct from actor\.id/);
  assert.match(migration, /values\('app_version',jsonb_build_object\('release','AgData v2\.3\.94','app_version','2\.3\.94'/);
});

test('Invariant 99 (Reclass Is Optimistic Without Premature Validation and Inventory Back Unwinds Locally)', () => {
  const runtime = read('assets/app-runtime.js');
  const migration = read('supabase/migrations/20261028172852_agdata_v2395_instant_reclass_and_navigation.sql');
  const toggle = functionSource('assets/app-runtime.js', 'createArgosReclassActionProposal') + functionSource('assets/app-runtime.js', 'toggleArgosReclassV3Action');
  const collect = runtime.slice(runtime.indexOf('function collectArgosReclassMoveProposal('), runtime.indexOf('function getArgosReclassV3ScopeActionsForEntry('));
  const publish = runtime.slice(runtime.indexOf('function publishArgosInventoryTransactionReturnedRows('), runtime.indexOf('const confirmedArgosReclassLiveEditRevisions'));
  const back = runtime.slice(runtime.indexOf('function goBackUniversal('), runtime.indexOf("if (currentView === 'crop-roll')"));
  const revisions = new Map([['actor', '52418']]);
  const context = runFunctions('assets/app-runtime.js', ['isConfirmedInventoryReadRevisionCurrent'], {
    argosInventoryTransactionState: { pendingReclassMove: { command: { commandId: 'pending' } } },
    confirmedArgosReclassLiveEditRevisions: revisions,
    getArgosReclassLiveEditIdentityKey: () => 'actor',
  });
  assert.equal(context.isConfirmedInventoryReadRevisionCurrent('52419'), false, 'pending optimistic rows fence every background snapshot');
  context.argosInventoryTransactionState.pendingReclassMove = null;
  assert.equal(context.isConfirmedInventoryReadRevisionCurrent('52417'), false);
  assert.equal(context.isConfirmedInventoryReadRevisionCurrent('52418'), true);
  assert.match(toggle, /rule\.kind === 'sheared'/);
  assert.doesNotMatch(toggle, /\['move', 'sheared'\]\.includes/);
  assert.match(collect, /Cannot Move Up more than Open Stock/);
  assert.match(publish, /rebuildMasterInventoryIndexes[\s\S]*invalidateResolvedViewStateCaches/);
  assert.match(back, /driveViewLevel >= 4[\s\S]*backToDrivePrograms\(\)[\s\S]*driveViewLevel >= 3[\s\S]*backToDriveSeasons\(\)/);
  assert.match(migration, /C\.16\.000','27\.F1','220','0','220','150'/);
  assert.match(migration, /H\.03\.000','27\.S1','4000','0','4000','4074'/);
  assert.match(migration, /AGDATA_V2395_RECLASS_MOVE_STATE_MISMATCH/);
});

test('Invariant 100 (RUN SCRIPT Drives Bounded Cloud Continuations Through IDLE)', () => manualSyncStartContract(runFunctions, plain));

test('Invariant 101 (Empty Cloud Sync Completion Does Not Require a File Cursor)', () => emptyCloudCompletionContract(runFunctions));

test('Invariant 102 (Cloud XLSX Seals Its Exact Parsed Count Before Commit and Move)', erpXlsxCommitContract);

test('Invariant 103 (Compressed XLSX Bytes Stream in Bounded, Cancellable Chunks)', async () => {
  const { createBoundedByteStream } = await import('../supabase/functions/_shared/erp-sync.mjs');
  const bytes = Uint8Array.from({ length: 100003 }, (_, index) => index % 251);
  const chunks = [];
  const reader = createBoundedByteStream(bytes).getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 16 * 1024));
  const copy = new Uint8Array(bytes.length);
  let offset = 0;
  for (const chunk of chunks) { copy.set(chunk, offset); offset += chunk.length; }
  assert.equal(offset, bytes.length);
  assert.ok(copy.every((value, index) => value === bytes[index]), 'stream output is byte-for-byte identical');

  let pullCount = 0;
  class PullCountBytes extends Uint8Array {
    subarray(start, end) { pullCount += 1; return super.subarray(start, end); }
  }
  const largeInput = new PullCountBytes(2 * 1024 * 1024);
  const cancelReader = createBoundedByteStream(largeInput).getReader();
  const firstChunk = await cancelReader.read();
  assert.equal(firstChunk.done, false);
  assert.ok(firstChunk.value.length <= 16 * 1024);
  const pullsAtCancel = pullCount;
  await cancelReader.cancel();
  assert.equal((await cancelReader.read()).done, true);
  await Promise.resolve();
  assert.equal(pullCount, pullsAtCancel, 'cancellation prevents further source pulls');
  assert.ok(pullCount < largeInput.length / (16 * 1024), 'the rest of the source remains unread');
});

import {assertErpResumedOffset} from './helpers/erp-resume-offset-contract.mjs';

test('Invariant 104 (Resumed ERP File Offset Is Persisted Before Resumed I/O)', assertErpResumedOffset);

test('Invariant 105 (Both Reclass Send Paths Close Before a Delayed Database Receipt)', async () => {
  for (const review of [false, true]) {
    let settle;
    const delayed = new Promise(resolve => { settle = resolve; });
    const events = [];
    const state = { sourceView: 'drive', snapshot: { uniqueId: 'row' }, idempotencyToken: 'instant-test' };
    const payload = { rowOverlays: [{ unique_id: 'row', proposals: [{ action: 'move_down', splits: [{ quantity: 20, destinationSeason: 'X' }] }] }] };
    const button = { disabled: false, textContent: '' };
    const context = {
      argosInventoryTransactionState: state, evalWorkSetupState: {}, currentUser: 'dylan_collyge', currentUserDisplay: 'Dylan Collyge',
      getArgosReclassLiveEditIdentityKey: () => 'actor', getCurrentReclassDeliveryActor: () => 'actor',
      isEvalReclassRowAssigned: () => true,
      ensureArgosReclassSubmissionVerification: async () => {},
      getArgosInventoryTransactionPayloadForPendingMove: () => null,
      buildArgosInventoryTransactionPayload: () => payload,
      applyArgosInventoryTransactionSourceContext: value => value,
      applyArgosInventoryReclassMoveCommand: (submission) => {
        events.push('inventory-preview'); submission.pendingReclassMove = { inFlight: true };
        return delayed;
      },
      closeArgosInventoryTransactionModal: options => {
        assert.equal(options.background, true); events.push('close'); context.argosInventoryTransactionState = null;
      },
      showToast: title => events.push(title), getCurrentVisibleViewId: () => 'drive', queueInteractiveViewRender() {},
      removeConfirmedMoveProposalsFromInquiryPayload: () => ({ rowOverlays: [] }), hasRemainingArgosReclassInquiry: () => false,
      isEvalWorkManagerUser: () => true, buildEvalWorkSetupInquiry: () => payload,
      ensureAssignableAppUsers: async () => [], ensureEvalWorkSetupModal: () => ({ classList: { remove() {} } }),
      syncEvalWorkSetupSummary() {}, setTimeout() {},
      document: { getElementById: () => button }, window: {},
    };
    const name = review ? 'openEvalWorkSetupFromReclass' : 'submitArgosInventoryTransaction';
    const sandbox = runFunctions('assets/app-runtime.js', [name], withGoldenReclassAuthority(context));
    const started = performance.now();
    const task = sandbox[name]();
    await new Promise(resolve => setImmediate(resolve));
    const duration = performance.now() - started;
    assert.deepEqual(events.slice(0, 3), ['inventory-preview', 'close', 'Saving Moves'], name);
    assert.ok(duration < 100, `${name} optimistic close ${duration.toFixed(2)}ms`);
    assert.equal(button.textContent.includes('Saving move'), false);
    settle({ receipt: {}, movedUids: ['row'] });
    await task;
    assert.ok(events.includes('Moves Saved'), name);
  }
});

test('Invariant 106 (Closed Reclass Still Fences Stale Reads and Email Wake Never Blocks)', () => {
  const row = { __optimisticReclassMove: 'pending-command' };
  const context = runFunctions('assets/app-runtime.js', ['isConfirmedInventoryReadRevisionCurrent'], {
    argosInventoryTransactionState: null, fullInventory: [row],
    confirmedArgosReclassLiveEditRevisions: new Map(), getArgosReclassLiveEditIdentityKey: () => 'actor',
  });
  assert.equal(context.isConfirmedInventoryReadRevisionCurrent('999999'), false);
  delete row.__optimisticReclassMove;
  assert.equal(context.isConfirmedInventoryReadRevisionCurrent('999999'), true);
  let task;
  const sandbox = runFunctions('supabase/functions/app-api/index.ts', ['dispatchRequestDeliveryWorkerNow', 'dispatchReclassDeliveryNow'], {
    invokeRequestDeliveryWorkerNow: () => new Promise(() => {}),
    EdgeRuntime: { waitUntil: value => { task = value; } },
  });
  const receipt = { deliveryEventId: 'queued', status: 'queued' };
  assert.equal(sandbox.dispatchReclassDeliveryNow(receipt, '', ''), receipt);
  assert.ok(task && typeof task.then === 'function');
});

test('Invariant 107 (Suspend AV Selection Does Not Require a Request Folder)', async () => {
  const calls = [];
  const row = { unique_id: 'physical-suspend-row' };
  const selected = [{ unique_id: 'master-option', locationcode: 'A.09.000', lotcode: '27.S1' }];
  const sandbox = runFunctions('assets/app-runtime.js', ['addSelectedRequestItemCodeOptions'], {
    activeItem: row, activeDetailSourceView: 'request', lastView: 'request',
    isRequestDetailItem: () => true, canAddRequestItemCodeOptions: () => true,
    collectSelectedRequestItemCodeOptionRows: () => selected, isDockSuspendDcRequestMirrorRow: () => true,
    addSelectedDockSuspendDcRequestOptions: (options, source) => { calls.push({ options, source }); return true; },
    getRequestFolderName: () => { throw new Error('Suspend must not require Request folders'); },
    showToast: () => { throw new Error('valid Suspend selection must dispatch'); },
  });
  assert.equal(await sandbox.addSelectedRequestItemCodeOptions(), true);
  assert.equal(calls.length, 1); assert.equal(calls[0].source, row); assert.equal(calls[0].options, selected);
});

test('Invariant 108 (Table Management Archives Reject Every Mutation and Fixtures Reject Unknown Reads)', async () => {
  const { validateManagerTableManagementRequest } = await import('../supabase/functions/_shared/table-management.ts');
  const { releaseSnapshotReadFixture } = await import('./helpers/release-smoke-route-policy.mjs');
  for (const table of ['historical-drive-mode','historical-soc-open-orders','historical-soc-reserves','historical-requests','photo-history']) {
    for (const operation of ['create','update','delete']) assert.throws(() => validateManagerTableManagementRequest({
      action: 'manager_table_management', table, operation, payload: {},
    }), /MANAGER_TABLE_READ_ONLY/);
  }
  const request = { action: 'manager_table_management', table: 'inquiry-coverage', operation: 'users', payload: {} };
  assert.equal(releaseSnapshotReadFixture(request).data.rows[0].username, 'fixture_user');
  assert.equal(releaseSnapshotReadFixture({ ...request, operation: 'create' }), null);
  assert.equal(releaseSnapshotReadFixture({ ...request, actorId: 'forged' }), null);
  assert.equal(releaseSnapshotReadFixture({ ...request, payload: { secret: true } }), null);
  assert.throws(() => validateManagerTableManagementRequest({ ...request, operation: 'create', payload: { primary_user: 'any_user', scope: 'location', active: true, access_code: 'forbidden' } }), /FIELDS_FORBIDDEN/);
});

test('Invariant 109 (Eval Work Setup Remains Bound to Its Reclass Row and Account)', async () => {
  const firstRow = { snapshot: { uniqueId: 'first-row' } };
  const secondRow = { snapshot: { uniqueId: 'second-row' } };
  let inquiryBuilds = 0;
  const openContext = {
    argosInventoryTransactionState: firstRow, evalWorkSetupState: {},
    getArgosReclassLiveEditIdentityKey: () => 'account-a', isEvalWorkManagerUser: () => true,
    ensureArgosReclassSubmissionVerification: () => { openContext.argosInventoryTransactionState = secondRow; },
    buildEvalWorkSetupInquiry: () => { inquiryBuilds++; return { row: 'first-row' }; },
    buildArgosInventoryTransactionPayload: () => ({ rowOverlays: [] }),
    applyArgosInventoryTransactionSourceContext: value => value,
    showToast() {}, ensureAssignableAppUsers: async () => [],
    ensureEvalWorkSetupModal: () => ({ classList: { remove() {} } }),
    document: { getElementById: () => null }, syncEvalWorkSetupSummary() {}, setTimeout() {},
  };
  const openSandbox = runFunctions('assets/app-runtime.js', ['openEvalWorkSetupFromReclass'], openContext);
  const opening = openSandbox.openEvalWorkSetupFromReclass();
  assert.equal(await opening, false);
  assert.equal(inquiryBuilds, 0, 'a row change during the synchronous verification guard cannot build the stale setup');

  const capturedInquiry = { row: 'captured-row' };
  const capturedContext = {
    argosInventoryTransactionState: firstRow, evalWorkSetupState: {},
    getArgosReclassLiveEditIdentityKey: () => 'account-a', isEvalWorkManagerUser: () => true,
    ensureArgosReclassSubmissionVerification: async () => {},
    buildEvalWorkSetupInquiry: () => capturedInquiry,
    buildArgosInventoryTransactionPayload: () => ({ rowOverlays: [] }),
    applyArgosInventoryTransactionSourceContext: value => value,
    showToast() {}, ensureAssignableAppUsers: async () => [],
    ensureEvalWorkSetupModal: () => ({ classList: { remove() {} } }),
    document: { getElementById: () => null }, syncEvalWorkSetupSummary() {}, setTimeout() {},
  };
  const capturedSandbox = runFunctions('assets/app-runtime.js', ['openEvalWorkSetupFromReclass'], capturedContext);
  await capturedSandbox.openEvalWorkSetupFromReclass();
  assert.equal(capturedContext.evalWorkSetupState.transactionState, firstRow);
  assert.equal(capturedContext.evalWorkSetupState.inquirySnapshot, capturedInquiry,
    'no-move Eval setup keeps its exact original draft');

  const inquiry = { row: 'captured-row' };
  const setupState = { transactionState: firstRow, inquirySnapshot: inquiry, identityKey: 'account-a',
    assigneeUsernames: ['evaluator'], completionRecipients: ['recipient@example.test'] };
  let releaseConfirmation;
  const confirmation = new Promise(resolve => { releaseConfirmation = resolve; });
  let apiCalls = 0; let closed = 0; let identity = 'account-a';
  const createContext = {
    evalWorkSetupState: setupState, argosInventoryTransactionState: firstRow,
    getArgosReclassLiveEditIdentityKey: () => identity,
    getEvalWorkAssigneeOptions: () => [{ username: 'evaluator' }],
    dedupeRequestEmailRecipients: values => values,
    resolveRequestRecipientEmail: () => 'evaluator@example.test',
    getEvalWorkSetupProposalCount: () => 0, getEvalWorkAssigneeLabel: () => 'Evaluator',
    showAppConfirm: () => confirmation, evalWorkApi: async () => { apiCalls++; return { data: {} }; },
    evalWorkRows: [], document: { getElementById: () => null },
    showToast() {}, closeEvalWorkSetup() { closed++; }, closeArgosInventoryTransactionModal() {},
    syncRequestTabButtons() {},
  };
  const createSandbox = runFunctions('assets/app-runtime.js', ['createEvalWorkFromSetup'], createContext);
  const creating = createSandbox.createEvalWorkFromSetup();
  await new Promise(resolve => setImmediate(resolve));
  identity = 'account-b';
  createContext.evalWorkSetupState = { transactionState: secondRow };
  releaseConfirmation(true);
  assert.equal(await creating, false);
  assert.equal(apiCalls, 0, 'confirmation returning after an account switch cannot submit');
  assert.equal(createContext.evalWorkRows.length, 0);
  assert.equal(closed, 0, 'a stale response cannot close the newer setup');
  assert.equal(setupState.inquirySnapshot, inquiry);

  let releaseApi;
  const apiResult = new Promise(resolve => { releaseApi = resolve; });
  identity = 'account-a'; apiCalls = 0; closed = 0;
  const delayedSetup = { ...setupState, submitting: false };
  const delayedContext = { ...createContext, evalWorkSetupState: delayedSetup,
    showAppConfirm: async () => true, evalWorkApi: () => { apiCalls++; return apiResult; },
    evalWorkRows: [], closeEvalWorkSetup() { closed++; } };
  const delayedSandbox = runFunctions('assets/app-runtime.js', ['createEvalWorkFromSetup'], delayedContext);
  const delayedCreate = delayedSandbox.createEvalWorkFromSetup();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(apiCalls, 1);
  identity = 'account-b';
  delayedContext.evalWorkSetupState = { transactionState: secondRow };
  releaseApi({ data: { id: 'old-account-work' } });
  assert.equal(await delayedCreate, false);
  assert.equal(delayedContext.evalWorkRows.length, 0, 'stale API data cannot enter the next account cache');
  assert.equal(closed, 0, 'a stale API response cannot close the next account dialog');
});

test('Invariant 110 (Suspend Candidate Mutation Carries Stable Physical Source Identity)', async () => {
  const sourceIdentity = { transactionnumber: '10-0051426', tagcode: '0230', dock: 'Dock 38', stopnumber: '30',
    itemcode: '004207.031.1', locationcode: 'A.09.000', lotcode: '27.S1', quantityshipped: '20',
    customer: '10043', consignee: '53285', salesrep: 'S25' };
  const calls = [];
  const handlerSource = read('supabase/functions/_shared/suspend-tag.ts')
    .replace(/^import[^]*?;\s*$/gm, '').replace(/^export /gm, '');
  const sandbox = vm.createContext({ jsonValue: value => value });
  vm.runInContext(ts.transpileModule(handlerSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, sandbox);
  const result = await sandbox.handleSuspendTag({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: { ok: true, rows: [] }, error: null };
  } }, { id: 'actor', username: 'dylan_collyge', role: 'MANAGER', nativeSessionId: 'session' }, {
    operation: 'add_candidates', commandId: 'stable-command-1234', expectedVersion: 0,
    payload: { sourceUid: 'stale-soc-uid', sourceIdentity, expectedLastUpdated: '2026-10-28T18:00:00Z', inventoryIds: ['inventory-option'] },
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].name, 'suspend_tag_command_v1');
  assert.deepEqual(calls[0].args.p_payload.sourceIdentity, sourceIdentity);
  const migration = read('supabase/migrations/20261028220500_agdata_v2397_bulk_reclass_override_import.sql');
  assert.match(migration, /suspend-add-candidates-physical-identity-v2397/);
  assert.match(migration, /having count\(\*\)=1/);
  assert.match(migration, /if s\.unique_id is null and p_operation=''add_candidates''/);
  assert.match(migration, /suspend_tag_private\.eligible\(candidate\.suspend,candidate\.suspend_to\)/);
});

test('Invariant 111 (Customer Mapping CRUD Uses Strict Idempotent Revision Envelopes)', () => {
  const source = read('supabase/functions/_shared/customer-rep-mapping.ts');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const sandbox = vm.createContext({ exports, module: { exports } });
  vm.runInContext(compiled, sandbox);
  const validate = sandbox.module.exports.validateCustomerRepMappingRequest;
  const requestId = '11111111-1111-4111-8111-111111111111';
  const create = validate({ action: 'customer-rep-map', operation: 'create', requestId, salesrepId: '01',
    customerId: '10001', customerName: 'Garden', consigneeId: '20001', consigneeName: 'North', territory: 'TX' });
  assert.equal(create.operation, 'create');
  assert.equal(create.payload.requestId, requestId);
  assert.equal(create.payload.customerId, '10001');
  assert.throws(() => validate({ action: 'customer-rep-map', operation: 'create', requestId, salesrepId: '01',
    customerId: '10001', customerName: 'Garden', consigneeId: '20001', consigneeName: 'North', access_code: 'secret' }),
  /CUSTOMER_REP_MAPPING_PAYLOAD_INVALID/);
  assert.throws(() => validate({ action: 'customer-rep-map', operation: 'delete', requestId, id: 'ordinary-row' }),
    /CUSTOMER_REP_MAPPING_PAYLOAD_INVALID/);
  const remove = validate({ action: 'customer-rep-map', operation: 'delete', requestId, id: 'ordinary-row', expectedRevision: '9' });
  assert.equal(remove.payload.expectedRevision, '9');
  assert.equal(remove.payload.requestId, requestId);
  assert.throws(() => validate({ action: 'customer-rep-map', operation: 'delete', requestId, id: 'ordinary-row', expectedRevision: '9', actorId: 'forged' }),
    /CUSTOMER_REP_MAPPING_PAYLOAD_INVALID/);
});

test('Invariant 112 (User Lifecycle Keeps Credentials Write-Only and Updates Canonical Identity)', () => {
  const editor = read('assets/user-access-control.js');
  const api = read('supabase/functions/app-api/index.ts');
  const authAdmin = read('supabase/functions/auth-admin/index.ts');
  const migration = read('supabase/migrations/20261028222500_agdata_user_lifecycle_v2397.sql');
  assert.match(editor, /data-user-create/);
  assert.match(editor, /data-user-reset-code/);
  assert.match(editor, /data-user-deactivate/);
  assert.match(editor, /data-user-profile-save/);
  assert.match(editor, /Contact email is maintained in Company Directory/);
  assert.doesNotMatch(editor, /access_code\s*[:=]\s*user\./i);
  assert.match(authAdmin, /provision_native_auth_app_user/);
  assert.match(authAdmin, /updateUserById\(profile\.id, \{ password \}\)/);
  assert.match(authAdmin, /sync_native_auth_app_access_code_v2397/);
  assert.match(authAdmin, /reconciliationRequired: true/);
  assert.match(api, /update_user_access_profile_v2397/);
  assert.match(api, /deactivate_user_access_v2397/);
  assert.match(migration, /update public\.ph_app_users set password=p_access_code/);
  assert.match(migration, /update public\.profiles set display_name=v_display_name,role=v_role/);
  assert.match(migration, /update public\.ph_app_users set role=v_role/);
  assert.match(migration, /update public\.user_access_control set active=false/);
  assert.match(migration, /USER_ACCESS_SELF_DEACTIVATION_FORBIDDEN/);
  assert.match(migration, /USER_ACCESS_LAST_ADMIN_FORBIDDEN/);
  assert.match(migration, /USER_ACCESS_ADMIN_ROLE_IMMUTABLE/);
});

test('Invariant 113 (Assigned Items Joins Full Master and Honors Exact Empty Ownership)', () => {
  const assignments = new Map([
    ['master-00001', { assignedto: '', default_assignedto: '', default_revision: 7 }],
    ['master-00002', { assignedto: 'current_owner', default_assignedto: 'current_owner', default_revision: 8 }],
  ]);
  const fullInventory = Array.from({ length: 9552 }, (_, index) => ({
    UNIQUE_ID: `master-${String(index + 1).padStart(5, '0')}`,
    ITEMCODE: `ITEM-${String(index + 1).padStart(5, '0')}`,
    COMMONNAME: `Plant ${index + 1}`, CONTSIZE: '#3', LOCATIONCODE: `A.${String(index % 100).padStart(2, '0')}.001`,
    GENUSNAME: 'Rosa', WAREHOUSEI: '10', ASSIGNEDTO: 'stale_master_owner',
  }));
  const state = {};
  const context = runFunctions('assets/app-runtime.js', [
    'firstNonEmptyValue', 'applyCommittedItemcodeOwnerReceipt', 'normalizeWarehouseAssignedItemRow', 'getManagerUnassignedItemcodes',
    'compareAssignedItemCodes', 'buildManagerEvalAssignmentKey', 'getManagerAssignedDisplaySignature', 'getManagerAssignedItemsDisplayRows', 'getManagerAssignedItemsExportRows', 'getManagerAssignedItemsAssigneeOptions',
  ], {
    fullInventory,
    warehouseAssignedItemsInventory: [],
    managerEvalReportSettings: { lowStockMaxSLts: 150 },
    getManagerAssignedColumnState: () => state,
    getDatasetLoadSignature: key => `${key}:revision-1`,
    normalizeEvalAssignableUser: value => String(value || '').trim().toLowerCase(),
    getWarehouseAssignedRowForItem: row => assignments.get(row.UNIQUE_ID) || null,
    getManagerItemLowStockTarget: () => null,
  }, false);
  const displayed = context.getManagerAssignedItemsDisplayRows();
  assert.equal(displayed.length, 9552, 'all master rows render when warehouse ownership is empty');
  const exactEmpty = displayed.find(row => row.MASTER_UNIQUE_ID === 'master-00001');
  assert.equal(exactEmpty.ASSIGNEDTO, '', 'the exact empty assignment overrides stale master ASSIGNEDTO');
  assert.equal(exactEmpty.DEFAULT_ASSIGNEDTO, '');
  assert.equal(displayed.find(row => row.MASTER_UNIQUE_ID === 'master-00002').ASSIGNEDTO, 'current_owner');
  const options = context.getManagerAssignedItemsAssigneeOptions(displayed);
  assert.deepEqual(Array.from(options, option => [option.key, option.count]), [['current_owner', 1]]);
  assert.equal(options.some(option => option.key === 'stale_master_owner'), false);
  assert.equal(context.getManagerUnassignedItemcodes(displayed).length, 9551);
});

test('Invariant 114 (Historical Archive Quick Access Waits for Owned Module Mount)', async () => {
  let currentView = 'managers';
  let mounted = false;
  let releaseMount;
  let selectedTab = '';
  let owner = 'account-a';
  let activeObserver = null;
  let pendingTimeout = null;
  let mountPromise = new Promise(resolve => { releaseMount = resolve; });
  const host = { querySelector: selector => mounted ? { click() { selectedTab = selector; } } : null };
  const context = vm.createContext({
    QUICK_ACCESS_NESTED_ROUTES: {
      'archive-requests': { parent: 'historical-requests', archiveTab: 'requests' },
      'archive-drive': { parent: 'historical-requests', archiveTab: 'drive' },
      'archive-orders': { parent: 'historical-requests', archiveTab: 'orders' },
      'archive-reserves': { parent: 'historical-requests', archiveTab: 'reserves' },
    },
    quickAccessNavigationGeneration: 0,
    getCurrentVisibleViewId: () => currentView,
    getSupabaseReadIdentityScope: () => owner,
    getHistoricalRequestsOwnerKey: () => `${owner}|${currentView}`,
    MutationObserver: class { constructor(callback) { this.callback = callback; activeObserver = this; } observe() {} disconnect() { if (activeObserver === this) activeObserver = null; } },
    setTimeout: callback => { pendingTimeout = callback; return 1; }, clearTimeout: () => { pendingTimeout = null; },
    canAccessQuickAccessView: () => true,
    isViewVisible: view => currentView === view,
    ensureHistoricalRequestsIsland: () => mountPromise,
    switchView: view => { currentView = view; },
    document: { getElementById: id => id === 'historical-requests-content' ? host : null },
  });
  vm.runInContext(functionSource('assets/app-runtime.js', 'navigateQuickAccessView'), context);
  const openTable = functionSource('assets/app-runtime.js', 'openManagerTableManagement');
  assert.equal((openTable.match(/return navigateQuickAccessView\('archive-/g) || []).length, 8,
    'all archive table entries use the canonical quick-access router');
  assert.equal(context.navigateQuickAccessView('archive-drive'), false);
  assert.equal(currentView, 'historical-requests');
  assert.equal(selectedTab, '', 'the requested tab waits for the lazy archive mount');
  releaseMount();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(selectedTab, '', 'module readiness can precede the tab control commit');
  assert.ok(activeObserver, 'a bounded DOM observer waits for the archive tab control');
  mounted = true;
  activeObserver.callback([]);
  assert.match(selectedTab, /data-archive-tab="drive"/);

  selectedTab = '';
  mounted = false;
  mountPromise = new Promise(resolve => { releaseMount = resolve; });
  context.navigateQuickAccessView('archive-orders');
  currentView = 'managers';
  mounted = true;
  releaseMount();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(selectedTab, '', 'a delayed mount cannot change the tab after navigation leaves Historical Requests');
});

test('Invariant 115 (Table Management Photo History Is Read-Only and Cache-Busted In Place)', () => invariant115({read, functionSource}));

test('Invariant 116 (Verified Same-Account Queue Fallback Preserves Suspend Navigation)', () => {
  const base = {
    currentUser: 'dylan_collyge', currentRole: 'Admin',
    requestCapabilityState: { username: 'dylan_collyge', capabilities: null },
    nativeAuthProfile: { id: 'profile-1', username: 'dylan_collyge', role: 'Admin', active: true, must_change_password: false },
    nativeAuthSessionActive: true, nativeAuthSessionUserId: 'profile-1',
    window: { GncUserAccessControl: { getSelfState: () => ({ denied: false }) } },
    getRequestCapabilityUsernameKey: value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    normalizeRoleAccessToken: value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ''),
    canonicalFeaturePermission: flag => flag === 'can_access_que' ? true : null,
    getRoleAccessState: () => ({}), canSeeRegularRequestTabs: () => false,
    canUseInvBunchNotes: () => false, canSeeEvalWorkRequestTab: () => false,
    canSeeSuspendTagRequestTab: () => true, canSeeMovesRequestTab: () => false,
    canSeeRecountRequestTab: () => false, canSeeShearListRequestTab: () => false,
    isRestrictedEvalUser: () => false, requestSalesRepsManagerMode: false,
  };
  const names = ['getRequestCapabilities', 'getRequestEntryCapabilities', 'normalizeRequestTabValue'];
  const runtime = runFunctions('assets/app-runtime.js', names, base);
  assert.equal(runtime.getRequestCapabilities().canViewQueue, true);
  assert.equal(runtime.normalizeRequestTabValue('suspend-tag'), 'suspend-tag');

  runtime.requestCapabilityState.capabilities = { canViewQueue: false };
  assert.equal(runtime.normalizeRequestTabValue('suspend-tag'), 'pending', 'explicit server denial remains authoritative');

  runtime.requestCapabilityState.capabilities = null;
  runtime.canonicalFeaturePermission = flag => flag === 'can_access_que' ? false : null;
  assert.equal(runtime.normalizeRequestTabValue('suspend-tag'), 'pending', 'canonical permission denial blocks the fallback');

  runtime.canonicalFeaturePermission = flag => flag === 'can_access_que' ? true : null;
  runtime.window.GncUserAccessControl.getSelfState = () => ({ denied: true });
  assert.equal(runtime.getRequestCapabilities(), null, 'confirmed current-account revocation blocks the fallback');
  runtime.window.GncUserAccessControl.getSelfState = () => ({ denied: false });
  runtime.nativeAuthSessionUserId = 'different-profile';
  assert.equal(runtime.getRequestCapabilities(), null, 'a different auth profile cannot inherit the prior account fallback');
});

test('Invariant 117 (Reclass paints full optimistic rows before guarded deferred publication)', () => {
  const sourceRow = { UNIQUE_ID: 'rollback-row', S_LTS: '4' };
  const rollbackRuntime = runFunctions('assets/app-runtime.js', ['buildArgosInventoryReclassRollbackModel'], {
    buildItemInquiryViewModel: (item, rows) => ({ item, rows }),
  });
  const rollbackModel = rollbackRuntime.buildArgosInventoryReclassRollbackModel({
    item: { ITEMCODE: 'ITEM' }, inquiryModel: { rows: [sourceRow] },
  });
  sourceRow.S_LTS = '2';
  assert.equal(rollbackModel.rows[0].S_LTS, '4', 'rollback snapshot preserves pre-move quantity after canonical rows mutate in place');
  assert.notEqual(rollbackModel.rows[0], sourceRow, 'rollback snapshot owns a detached source row');
  assert.match(functionSource('assets/app-runtime.js', 'prepareArgosReclassMove'),
    /originalModel:\s*buildArgosInventoryReclassRollbackModel\(state\)/, 'the move lifecycle uses the detached model for failure/retry');

  let currentIdentity = 'profile-a';
  let scheduled = null;
  let publicationCalls = 0;
  let metricCalls = 0;
  const fullInventory = [
    { UNIQUE_ID: 'source', ITEMCODE: 'ITEM', SOURCE_TABLE: 'ph_master_inventory', SEASON: 'F1', S_LTS: '4' },
    { UNIQUE_ID: 'destination', ITEMCODE: 'ITEM', SOURCE_TABLE: 'ph_master_inventory', SEASON: 'S1', S_LTS: '0' },
  ];
  const byId = new Map(fullInventory.map(row => [row.UNIQUE_ID, row]));
  const state = {};
  const context = {
    fullInventory, masterInventoryById:byId, avOpenInventory: [], cavInventory: [],
    reclassStockSeason: row => String(row.SEASON || ''),
    applyArgosInventoryTransactionReturnedRow: row => Object.assign(byId.get(String(row.UNIQUE_ID)), row),
    applyReclassSeasonStocks: () => { metricCalls += 1; },
    publishArgosInventoryTransactionReturnedRows: () => { publicationCalls += 1; },
    getCurrentVisibleViewId: () => '', queueInteractiveViewRender() {},
    getArgosReclassLiveEditIdentityKey: () => currentIdentity,
    setTimeout: callback => { scheduled = callback; return 1; },
  };
  const runtime = runFunctions('assets/app-runtime.js', ['publishOptimisticReclassRows'], context);
  const pending = {
    command: { commandId: 'move-1' }, ownerIdentityKey: 'profile-a', ownerState: state,
    deferInitialPublication: true,
  };
  state.pendingReclassMove = pending;
  runtime.publishOptimisticReclassRows(pending, [
    { UNIQUE_ID: 'source', ITEMCODE: 'ITEM', SOURCE_TABLE: 'ph_master_inventory', SEASON: 'F1', S_LTS: '2' },
    { UNIQUE_ID: 'destination', ITEMCODE: 'ITEM', SOURCE_TABLE: 'ph_master_inventory', SEASON: 'S1', S_LTS: '2' },
  ]);
  assert.equal(fullInventory[0].S_LTS, '2', 'source quantity is optimistic immediately');
  assert.equal(fullInventory[1].S_LTS, '2', 'destination quantity is optimistic immediately');
  assert.equal(metricCalls, 1, 'season metrics are applied before the task yields');
  assert.equal(publicationCalls, 0, 'global index/view publication is kept off the submit stack');
  assert.equal(typeof scheduled, 'function');
  scheduled();
  assert.equal(publicationCalls, 1, 'the still-owned command publishes after the task yields');

  publicationCalls = 0;
  runtime.publishOptimisticReclassRows(pending, [
    { UNIQUE_ID: 'source', ITEMCODE: 'ITEM', SOURCE_TABLE: 'ph_master_inventory', SEASON: 'F1', S_LTS: '1' },
  ]);
  currentIdentity = 'profile-b';
  scheduled();
  assert.equal(publicationCalls, 0, 'an account switch suppresses stale deferred publication');
});

test('Invariant 118 (Eval Work setup opens after Reclass close and skips stale navigation)', async () => {
  const createContext = () => {
    const transactionState = { snapshot: { uniqueId: 'physical-row' }, item: { ITEMCODE: 'ITEM' } };
    let frameCallback = null;
    let timerCallback = null;
    let visibleView = 'drive';
    let closeCount = 0;
    let modalCount = 0;
    const context = {
      argosInventoryTransactionState: transactionState, evalWorkSetupState: {},
      getArgosReclassLiveEditIdentityKey: () => 'profile-a', isEvalWorkManagerUser: () => true,
      ensureArgosReclassSubmissionVerification() {},
      buildEvalWorkSetupInquiry: () => ({ row: 'physical-row' }),
      buildArgosInventoryTransactionPayload: () => ({ rowOverlays: [{ proposals: [{ action: 'move_up' }] }] }),
      applyArgosInventoryTransactionSourceContext: value => value,
      applyArgosInventoryReclassMoveCommand: state => {
        state.pendingReclassMove = { inFlight: true, command: { commandId: 'move-118' } };
        return new Promise(() => {});
      },
      removeConfirmedMoveProposalsFromInquiryPayload: value => value,
      closeArgosInventoryTransactionModal: () => { closeCount += 1; },
      showToast() {}, ensureAssignableAppUsers: async () => [],
      ensureEvalWorkSetupModal: () => { modalCount += 1; return { classList: { remove() {} } }; },
      document: { getElementById: () => null }, syncEvalWorkSetupSummary() {},
      getCurrentVisibleViewId: () => visibleView,
      requestAnimationFrame: callback => { frameCallback = callback; return 1; },
      setTimeout: callback => { timerCallback = callback; return 1; },
      setVisibleView(value) { visibleView = value; },
      runFrame() { frameCallback?.(); }, runTimer() { timerCallback?.(); },
      counts: () => ({ closeCount, modalCount }),
    };
    return runFunctions('assets/app-runtime.js', ['openEvalWorkSetupFromReclass'], context);
  };
  const current = createContext();
  await current.openEvalWorkSetupFromReclass();
  assert.deepEqual(current.counts(), { closeCount: 1, modalCount: 0 }, 'move submit closes the Reclass modal before setup rendering');
  current.runFrame();
  current.runTimer();
  assert.deepEqual(current.counts(), { closeCount: 1, modalCount: 1 }, 'setup opens after the post-paint task while still on the source view');

  const stale = createContext();
  await stale.openEvalWorkSetupFromReclass();
  stale.setVisibleView('manager');
  stale.runFrame();
  stale.runTimer();
  assert.deepEqual(stale.counts(), { closeCount: 1, modalCount: 0 }, 'navigation away suppresses a stale deferred setup');
});

test('Invariant 119 (bulk master import maps only exact full-lineage aliases to one canonical row)', () => {
  const migration = read('supabase/migrations/20261028225000_agdata_v2397_master_identity_alias_repair.sql');
  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  const baseMigration = read('supabase/migrations/20261015012249_bulk_master_snapshot_v1.sql');
  const stableCandidate = /item6\.stable_identity_key = private\.ph_master_inventory_stable_identity_v7\(s\.raw_values\)/;
  const pendingDesignationGate = /and exists\(select 1 from app_sync_private\.ph_master_inventory_item6_edits_v7 edit[\s\S]*?edit\.field_name in \('desigitem','desigcust','desigloc'\)\)/;
  assert.match(baseMigration, stableCandidate, 'the import map resolves an incoming physical row through its stable identity');
  assert.match(baseMigration, pendingDesignationGate, 'fixture represents the former condition that incorrectly blocked mapping');
  assert.match(migration, /definition := replace\(definition,anchor,replacement\)/);
  assert.match(migration, /private\.ph_master_inventory_lineage_key_v1\(to_jsonb\(m\)\) = s\.lineage_key/);
  assert.match(migration, /alias_select_values := replace\(select_values, ''s\.unique_id'', ''coalesce\(mapped\.canonical_unique_id,s\.unique_id\)''\)/);
  assert.match(migration, /column_names, alias_select_values, set_values, changed_predicate/);
  assert.match(migration, /position\('coalesce\(mapped\.canonical_unique_id,s\.unique_id\)' in definition\)=0/);
  assert.match(migration, /begin;[\s\S]*set local statement_timeout[\s\S]*set local lock_timeout[\s\S]*commit;/i);
  assert.match(runner, /agdataV2397MasterIdentityAliasRepairMigrationName[^]*registeredReleaseDatabaseMigrations/);
  assert.match(runner, /position\('coalesce\(mapped\.canonical_unique_id,s\.unique_id\)' in pg_get_functiondef/);
  assert.match(baseMigration, /count\(distinct c\.canonical_unique_id\)::integer as candidate_count/);
  assert.match(baseMigration, /candidate_count > 1/);
  assert.match(baseMigration, /canonical_unique_id, source_unique_id, source_hash, import_run_id[\s\S]*c\.source_unique_id/);

  const incoming = { uniqueId: 'drive-synthetic-row', stableIdentity: 'fixed-physical-line', lineage: 'same-designations' };
  const canonicalRows = [
    { uniqueId: 'different-designation-row', stableIdentity: incoming.stableIdentity, lineage: 'different-designations', pendingDesignationEdit: false },
    { uniqueId: 'legacy-canonical-row', stableIdentity: incoming.stableIdentity, lineage: incoming.lineage, pendingDesignationEdit: false, pendingStockEdit: true },
  ];
  const candidates = canonicalRows.filter(row => row.stableIdentity === incoming.stableIdentity
    && (row.pendingDesignationEdit || row.lineage === incoming.lineage));
  assert.deepEqual(candidates.map(row => row.uniqueId), ['legacy-canonical-row'], 'stock-only pending edits do not block an exact full-lineage match, while a different designation does');
  const mappedCanonicalId = candidates[0].uniqueId;
  const insertedMasterId = mappedCanonicalId ?? incoming.uniqueId;
  assert.equal(insertedMasterId, 'legacy-canonical-row', 'the alias upsert targets the canonical row, not a second synthetic UID');
  assert.equal(incoming.uniqueId, 'drive-synthetic-row', 'the original source UID remains available for import provenance');
});

test('Invariant 120 (Historical archive owner is captured after switching to its parent view)', async () => {
  let currentView = 'managers';
  let releaseMount;
  let selectedTab = '';
  let domCommitted = false;
  let activeObserver = null;
  let pendingTimeout = null;
  const ownerViews = [];
  const mount = new Promise(resolve => { releaseMount = resolve; });
  const host = { querySelector: selector => domCommitted ? { click() { selectedTab = selector; } } : null };
  const context = vm.createContext({
    QUICK_ACCESS_NESTED_ROUTES: { 'archive-drive': { parent: 'historical-requests', archiveTab: 'drive' } },
    quickAccessNavigationGeneration: 0,
    getCurrentVisibleViewId: () => currentView,
    getSupabaseReadIdentityScope: () => 'profile-a',
    getHistoricalRequestsOwnerKey: () => { ownerViews.push(currentView); return `profile-a|${currentView}`; },
    MutationObserver: class { constructor(callback) { this.callback = callback; activeObserver = this; } observe() {} disconnect() { if (activeObserver === this) activeObserver = null; } },
    setTimeout: callback => { pendingTimeout = callback; return 1; }, clearTimeout: () => { pendingTimeout = null; },
    canAccessQuickAccessView: () => true,
    isViewVisible: view => currentView === view,
    ensureHistoricalRequestsIsland: () => mount,
    switchView: view => { currentView = view; },
    document: { getElementById: id => id === 'historical-requests-content' ? host : null },
  });
  vm.runInContext(functionSource('assets/app-runtime.js', 'navigateQuickAccessView'), context);
  context.navigateQuickAccessView('archive-drive');
  assert.deepEqual(ownerViews, ['historical-requests'], 'archive ownership is read only after the parent view becomes current');
  releaseMount();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(selectedTab, '', 'the lazy module promise can resolve before React commits its tab buttons');
  assert.ok(activeObserver, 'DOM commit is observed instead of guessed with a timer');
  domCommitted = true;
  activeObserver.callback([]);
  assert.match(selectedTab, /data-archive-tab="drive"/, 'the current owner can select the requested tab after mounting');
});

test('Invariant 121 (Physical alias repair is provenance-backed, locked, and preserves pending edits)', () => {
  const migration = read('supabase/migrations/20261028225500_agdata_v2397_master_physical_alias_repair.sql');
  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  assert.match(migration, /c\.lineage_key=a\.lineage_key and c\.stable_identity_key=a\.stable_identity_key/);
  assert.match(migration, /private\.ph_master_bulk_source_hash_v1\(s\.row_value->'values'/);
  assert.match(migration, /source\.source_unique_id=a\.alias_unique_id/);
  assert.match(migration, /perform 1 from public\.ph_master_inventory m[\s\S]*?for update of m;[\s\S]*?V2397_MASTER_ALIAS_LOCKED_SNAPSHOT_CHANGED[\s\S]*?set local session_replication_role = replica/);
  assert.match(migration, /inventory_live_overrides_v1 x where x\.canonical_unique_id=p\.canonical_unique_id[\s\S]*?canonical_live_overrides/);
  assert.match(migration, /canonical_season_stock_overrides[\s\S]*?inventory_season_stock_overrides_v1 x[\s\S]*?inventory_stock_season_v1\(p\.canonical_lotcode,p\.canonical_season\)/);
  assert.match(migration, /set source_unique_id=p\.canonical_unique_id/);
  assert.match(migration, /to_jsonb\(canonical_sales\)-'unique_id'=to_jsonb\(alias_sales\)-'unique_id'/);
  assert.match(migration, /set local session_replication_role = %L/);
  assert.match(migration, /update public\.ph_master_inventory m set last_updated=clock_timestamp\(\)/);
  assert.match(migration, /begin;[\s\S]*set local statement_timeout[\s\S]*set local lock_timeout[\s\S]*commit;/i);
  assert.match(runner, /agdataV2397MasterPhysicalAliasRepairMigrationName[^]*registeredReleaseDatabaseMigrations/);
  assert.match(runner, /to_regclass\('private\.ph_master_identity_alias_repair_audit_v2397'\)/);
});

test('Invariant 122 (Stale scoped AV totals keep numeric LKG and refresh once per newer receipt)', () => {
  const runtime = read('assets/app-runtime.js');
  const focused = read('tests/inventory-card-location-on-hand.test.mjs');
  assert.match(runtime, /scheduleStaleRequestOptionMetricRefresh\(optionContext, requestItemCodeOptionState, acceptedReceipt\.revision\)/);
  assert.match(runtime, /function scheduleStaleRequestOptionMetricRefresh[\s\S]*?BigInt\(safeRevision\) <= BigInt\(handledRevision\)[\s\S]*?loadRequestItemCodeOptions\(item, state\.key, \{ forceRefresh: true \}\)/);
  assert.match(runtime, /const optionContext = activeItem \|\| item;[\s\S]*?getRequestItemCodeOptionStateKey\(optionContext\) === requestItemCodeOptionState\.key/);
  assert.match(runtime, /function loadRequestItemCodeOptions\(item = activeItem, stateKey = '', options = \{\}\)[\s\S]*?const forceRefresh = options\?\.forceRefresh === true[\s\S]*?fetchRequestItemCodeOptionRowsFromSupabase\(itemCode, \{ pageSize: 100, maxRows: 2500 \}\)/);
  assert.match(runtime, /const acceptedMetricRevision = \(row\) =>[\s\S]*?incomingRevision > existingRevision/);
  assert.match(runtime, /function retainVerifiedCardLocationOnHandRows\(rows = \[\]\)[\s\S]*?getCardLocationOnHandServerAggregate\(row[\s\S]*?preserveCardLocationOnHand\(row, aggregate\.value\)/);
  assert.match(runtime, /const pageRows = Array\.isArray\(page\) \? page : \[\];[\s\S]*?retainVerifiedCardLocationOnHandRows\(pageRows\)/);
  assert.match(runtime, /if \(forceRefresh && acceptedLocOnHandAggregateReceipt\?\.valid === true[\s\S]*?state\.metricRefreshRevision = String\(acceptedLocOnHandAggregateReceipt\.revision/);
  assert.match(focused, /a newer authorized aggregate receipt triggers one bounded option refresh and rejects stale totals/);
  assert.match(focused, /repeat card renders do not schedule duplicate reads/);
  assert.match(focused, /identity-bound prior location total remains visible while the stale receipt is rejected/);
});

test('Invariant 123 (Reclass season stock touches every matching lot and skips unrelated identities)', () => {
  const runtime = read('assets/app-runtime.js');
  const seen = [];
  const sourceRow = (id, itemcode, season) => ({ UNIQUE_ID: id, ITEMCODE: itemcode, SEASON: season, S_LTS: '1', SEASON_OH: '1', PTRAVAILABLE: '1' });
  const fullInventory = [sourceRow('a', 'I', 'F1'), sourceRow('b', 'I', 'F1'), sourceRow('other-full', 'OTHER', 'F1')];
  const avOpenInventory = [sourceRow('a', 'I', 'F1'), sourceRow('other-av', 'OTHER', 'F1')];
  const cavInventory = [sourceRow('cav-a', 'I', 'F1'), sourceRow('other-cav', 'OTHER', 'F1')];
  const context = vm.createContext({
    fullInventory, avOpenInventory, cavInventory,
    reclassStockSeason: row => { seen.push(row.UNIQUE_ID); return row.SEASON; },
  });
  vm.runInContext(functionSource('assets/app-runtime.js', 'applyReclassSeasonStocks'), context);
  context.applyReclassSeasonStocks([{ itemcode: 'I', season: 'F1', openStock: '12', seasonOnHand: '7',
    rows: [{ uniqueId: 'a', openStock: '4' }] }]);
  assert.deepEqual(seen, ['a', 'b', 'a', 'cav-a'], 'season parsing is limited to the affected itemcode across all inventory arrays');
  assert.equal(fullInventory[0].S_LTS, '4');
  assert.equal(fullInventory[0].SEASON_OH, '7');
  assert.equal(fullInventory[1].SEASON_OH, '7', 'all matching lots receive the season total');
  assert.equal(avOpenInventory[0].S_LTS, '4');
  assert.equal(cavInventory[0].OPEN_STOCK, '12');
  for (const row of [fullInventory[2], avOpenInventory[1], cavInventory[1]]) {
    assert.equal(row.SEASON_OH, '1', `${row.UNIQUE_ID} remains untouched`);
    assert.equal(row.PTRAVAILABLE, '1');
  }
});

test('Invariant 124 (Cold Assigned Items full projection is unique and remains coordinator-owned)', () => invariant124({read, functionSource, runFunctions}));

test('Invariant 125 (AV metric grid keeps three columns under the Drive-only precision override)', () => {
  const avStyle = read('assets/app-shell-style-05.css');
  const opsStyle = read('assets/ops-precision-pilot.css');
  assert.match(avStyle, /body #view-detail \.request-av-option-card-shell \.app-card-qty-row,\s*body\.viewport-compact #view-detail \.request-av-option-card-shell \.app-card-qty-row\s*\{\s*grid-template-columns:repeat\(3,minmax\(0,1fr\)\) !important/);
  assert.match(avStyle, /body\.viewport-compact #view-detail \.request-av-option-card-shell \.app-drive-card-grid:not\(\.app-drive-card-grid--no-photo\)[\s\S]*grid-template-areas:"photo header reclass" "details details details" !important/);
  assert.match(avStyle, /body\.viewport-compact #view-detail \.request-av-option-card-shell \.app-drive-card-details \{grid-area:details;width:100%;min-width:0\}/);
  assert.match(opsStyle, /body\.ops-precision-pilot \.app-drive-compact-card\.app-inventory-card-overhaul \.app-card-qty-row\s*\{\s*container-type: inline-size;\s*grid-template-columns:[^;]+!important;\s*gap: clamp\(2px, \.7vw, 6px\) !important;/);
});

test('Invariant 126 (Selected Suspend AV action remains viewport-fixed above the footer)', () => {
  const style = read('assets/app-shell-style-05.css');
  const runtimeFunction = functionSource('assets/app-runtime.js', 'syncSuspendAvOptionSelectionControls');
  const stickyRule = style.slice(style.indexOf('body #view-detail [data-suspend-av-sticky]'), style.indexOf('.photo-date-badge-host', style.indexOf('body #view-detail [data-suspend-av-sticky]')));
  assert.match(stickyRule, /position:fixed !important/);
  assert.match(stickyRule, /bottom:calc\(max\(var\(--gnc-footer-height,var\(--footer-nav-reserve/);
  assert.match(stickyRule, /var\(--gnc-personal-footer-height,0px\)\) \+ 8px \+ env\(safe-area-inset-bottom\)\) !important/);
  assert.match(stickyRule, /left:max\(var\(--shell-gutter/);
  assert.match(stickyRule, /right:max\(var\(--shell-gutter/);
  assert.doesNotMatch(stickyRule, /display\s*:/, 'the shared hidden class continues to control visibility');
  let selectedCount = 1;
  const toggles = [];
  const sticky = { classList: { toggle(name, hidden) { toggles.push([name, hidden]); } }, querySelector: selector => selector === '[data-suspend-av-add]' ? stickyAction : countLabel };
  const stickyAction = { disabled: true };
  const countLabel = { textContent: '' };
  const panel = {
    querySelectorAll: () => Array.from({ length: selectedCount }, () => ({})),
    querySelector: selector => selector === '[data-suspend-av-header-action="true"]' ? headerAction : sticky,
  };
  const headerAction = { disabled: true };
  const context = vm.createContext({ document: { getElementById: () => panel } });
  vm.runInContext(runtimeFunction, context);
  context.syncSuspendAvOptionSelectionControls();
  assert.deepEqual(toggles.pop(), ['hidden', false]);
  assert.equal(headerAction.disabled, false);
  assert.equal(stickyAction.disabled, false);
  assert.equal(countLabel.textContent, '1 selected');
  selectedCount = 0;
  context.syncSuspendAvOptionSelectionControls();
  assert.deepEqual(toggles.pop(), ['hidden', true]);
});

test('Invariant 127 (SOC ingestion retains valid Dock aliases regardless of Suspend status)', socXlsxContract);

test('Invariant 128 (Season Priority and Item Detail read notes from the exact live inventory row)', () => {
  const runtime = read('assets/app-runtime.js');
  const context = vm.createContext({
    get masterInventoryById() { return new Map(this.fullInventory.map(row=>[row.UNIQUE_ID || row.unique_id,row])); },
    get masterInventoryByItemCode() { return Map.groupBy(this.fullInventory,row=>row.ITEMCODE || row.itemcode); },
    fullInventory: [
      { UNIQUE_ID: 'old-sibling', ITEMCODE: 'ITEM-1', LOCATIONCODE: 'A.01.000', LOTCODE: '27.F1', SOURCE: 'SH', HOLDSTOPCODE: '', HOLDSTOPREASON: 'stale hold', HOLDSTOPBEGINDATE: '2026-01-01', LOCATIONNOTE: 'wrong note' },
      { UNIQUE_ID: 'current-row', ITEMCODE: 'ITEM-1', LOCATIONCODE: 'A.01.000', LOTCODE: '27.F1', SOURCE: 'SH', HOLDSTOPCODE: '', HOLDSTOPREASON: 'stale hold', HOLDSTOPBEGINDATE: '2026-01-01', LOCATIONNOTE: 'Current location note', LOCATIONNOTEDATE: '2026-10-28', LOCATIONPTN1: 'Legacy text' }
    ],
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== ''),
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  });
  for (const name of ['getLiveDriveNoteRow', 'renderManagerSeasonPriorityLiveNotes', 'getDriveDetailFieldKeys', 'getDriveDetailFieldRawValue']) {
    vm.runInContext(functionSource('assets/app-runtime.js', name), context);
  }
  const aliasMap = runtime.match(/        const DRIVE_DETAIL_ITEM_FIELD_ALIASES = Object\.freeze\(\{[^]*?\n        \}\);/)?.[0];
  assert.ok(aliasMap, 'detail note aliases exist');
  vm.runInContext(aliasMap, context);
  const reportRow = { UNIQUE_ID: 'current-row', ITEMCODE: 'ITEM-1', LOCATIONCODE: 'A.01.000', LOTCODE: '27.F1', SOURCE: 'SH' };
  const note = context.renderManagerSeasonPriorityLiveNotes(reportRow);
  assert.match(note, /Location Note: Current location note/);
  assert.doesNotMatch(note, /Hold\/Stop|stale hold|wrong note/);
  assert.equal(context.getDriveDetailFieldRawValue({ ...reportRow, HOLDSTOPREASON: 'stale report reason' }, 'HOLDSTOPREASON'), '');
  assert.equal(context.getDriveDetailFieldRawValue(reportRow, 'LOCATIONNOTE'), 'Current location note');
  assert.equal(context.getDriveDetailFieldRawValue(reportRow, 'LOC NOTE DATE'), '2026-10-28');
});

test('Invariant 129 (Docks retains distinct Dock and Drop levels and one-step shell Back)', () => {
  const render = functionSource('assets/app-runtime.js', 'renderDocks');
  for (const marker of ['Drops ·', 'Rows · Qty', 'Drop ${escapeHtml(stopCard.stopNum)}', 'Back to Drops', 'selectDockStop', 'compareLocationCodeValues']) assert.ok(render.includes(marker), marker);
  assert.match(render, /data-docks-drop-card/);
  assert.doesNotMatch(render, /STOP \$\{stopCard\.stopNum\}/);
  const context = vm.createContext({
    dockViewMode: 'docks', dockViewLevel: 0, selectedDockNum: null, selectedDockStop: null, selectedDockIssueUid: null,
    selectedDockIssueAllocationId: '', viewHistoryStack: [],
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== ''),
    runDirectTrackedNavigation: (_view, _key, callback) => { callback(); return false; }, updateDockModeToggleUi: () => {},
    scheduleDocksRender: () => {}, updateGlobalBackButton: () => {}, getVisibleSecondaryBack: () => null,
    getManagerAssignedColumnState: () => ({ editor: false }), getCurrentVisibleViewId: () => 'docks', isDrawerOpen: () => false,
    closeOpenInteractiveSurfaceForBack: () => false, setMenuOpenState: () => {}, BunchNote: { back: () => false },
    window: { SalesWorkspace: null }, LocationCode: { back: () => false }, restorePreviousViewFromHistory: () => false,
    fastBackHome: () => {}, document: { getElementById: () => ({ value: '', classList: { add: () => {} } }) }
  });
  for (const name of ['normalizeDockViewDockKey', 'normalizeDockViewStopKey', 'selectDock', 'selectDockStop', 'resetDockView', 'goBackUniversal']) {
    vm.runInContext(functionSource('assets/app-runtime.js', name), context);
  }
  context.selectDock('38.0');
  context.selectDockStop('40.0');
  assert.deepEqual([context.dockViewLevel, context.selectedDockNum, context.selectedDockStop], [2, '38', '40']);
  context.goBackUniversal();
  assert.deepEqual([context.dockViewLevel, context.selectedDockNum, context.selectedDockStop], [1, '38', null]);
  context.goBackUniversal();
  assert.deepEqual([context.dockViewLevel, context.selectedDockNum, context.selectedDockStop], [0, null, null]);
});
import { contracts } from '../services/database-contracts.generated.ts';

test('Invariant 130 (SOC select-star contract includes live photo and status columns)', async () => {
  const fields = contracts.tables.ph_soc_master.row.object;
  const row = Object.fromEntries(Object.entries(fields).map(([key, field]) => {
    const schema = field.schema;
    const nullable = typeof schema === 'object' && 'oneOf' in schema && schema.oneOf.includes('null');
    return [key, schema === 'json' ? [] : nullable ? null : schema === 'number' ? 1 : schema === 'boolean' ? true : 'fixture'];
  }));
  row.unique_id = 'invariant-130';
  row.photos = [];
  const bridge = databaseBridge(async () => new Response(JSON.stringify([row])));
  const result = await bridge.fetchTable('https://fixture.invalid', 'ph_soc_master', 'select=*', { method: 'GET' }, 1000, 'SOC');
  assert.deepEqual(await result.json(), [row]);
  for (const [key, type] of [['photo_url', 'string'], ['photos', 'json'], ['pick_note', 'string'], ['status', 'string']]) {
    const schema = fields[key]?.schema;
    assert.ok(schema, `${key} is represented in the physical table contract`);
    assert.ok(schema === type || (typeof schema === 'object' && 'oneOf' in schema && schema.oneOf.includes(type)), `${key} has ${type} contract`);
  }
});

test('Invariant 131 (Cold Season Priority hydrates exact live notes without report-cache fallback)', async () => {
  const context = vm.createContext({
    get masterInventoryById() { return new Map(this.fullInventory.map(row=>[row.UNIQUE_ID || row.unique_id,row])); },
    get masterInventoryByItemCode() { return Map.groupBy(this.fullInventory,row=>row.ITEMCODE || row.itemcode); },
    fullInventory: [],
    AbortController,
    clearTimeout,
    masterRevision: '76',
    currentUser: 'manager-a',
    managerSeasonPriorityState: { account: 'manager-a', inventoryRevision: '77', liveNoteRevision: '76', liveNoteRows: new Map(), liveNotePending: new Set(), liveNoteControllers: new Set() },
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== ''),
    normalizeSessionIdentity: value => String(value || '').toLowerCase(),
    getSupabaseReadIdentityScope: () => 'manager-a-scope',
    getDatasetState: () => ({ liveVerifiedRevision: context.masterRevision }),
    getProductionLiveSyncContext: () => ({ dataPermissionVersion: 'manager-a-permission' }),
    canViewManagerSeasonPriority: () => true,
    isManagerSeasonPriorityVisible: () => true,
    scheduleManagersRender: () => { context.renderCount++; }, renderCount: 0,
    validateInventoryReadProjection: () => true,
    getMasterInventorySourceCode: row => String(row?.SOURCE ?? row?.source ?? '').trim().toUpperCase(),
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  });
  const live = { unique_id: 'source-1', itemcode: '003754.050.1', locationcode: 'A.09.000', lotcode: '27.F1', source: 'SH',
    holdstopcode: null, holdstopbegindate: null, holdstopreason: null, locationnote: '12"h, light roots', locationnotedate: '2026-06-29', locationptn1: 'south end' };
  context.requestInventoryRead = async (operation, payload) => {
    assert.equal(operation, 'master_identity_batch');
    assert.deepEqual(Object.keys(payload), ['queueIdentities']);
    assert.equal(payload.queueIdentities[0].masterUid, 'source-1');
    return { rows: [{ inputIndex: 0, matchCount: 1, row: live }], inventoryRevision: '77', projection: 'full', fieldCoverage: 'full' };
  };
  for (const name of ['getLiveDriveNoteRow', 'renderManagerSeasonPriorityLiveNotes', 'getManagerSeasonPriorityContextNotes', 'resetManagerSeasonPriorityLiveNoteRows', 'loadManagerSeasonPriorityLiveNoteRows']) {
    vm.runInContext(functionSource('assets/app-runtime.js', name), context);
  }
  const report = { sourceUid: 'source-1', itemcode: '003754.050.1', locationcode: 'A.09.000', lotcode: '27.F1', source: 'SH',
    noteContext: { locationNote: 'stale report note', avNote: 'AV checked', salesNote: 'Call customer', picNote: 'Needs photo' } };
  assert.equal(await context.loadManagerSeasonPriorityLiveNoteRows([report]), true);
  assert.equal(context.fullInventory.length, 0, 'an exact visible-row read does not masquerade as a complete inventory snapshot');
  assert.equal(context.renderCount, 1);
  assert.match(context.renderManagerSeasonPriorityLiveNotes(report), /Location Note: 12"h, light roots/);
  context.fullInventory = [{ ...live, locationnote: 'older complete snapshot note' }];
  assert.match(context.renderManagerSeasonPriorityLiveNotes(report), /Location Note: 12"h, light roots/, 'the exact report-revision row outranks an older full snapshot');
  context.masterRevision = '78';
  context.fullInventory = [{ ...live, locationnote: 'newer complete snapshot note' }];
  assert.match(context.renderManagerSeasonPriorityLiveNotes(report), /Location Note: newer complete snapshot note/, 'a newer complete master snapshot remains canonical');
  assert.deepEqual(Array.from(context.getManagerSeasonPriorityContextNotes(report)), ['AV Note: AV checked', 'Sales Note: Call customer', 'PIC Note: Needs photo']);
});

test('Invariant 132 (Service worker activation finishes without awaiting a client navigation)', () => workerActivationContract(read));

test('Invariant 133: cloud ERP owns all remaining stages under the same lease after the browser leaves', async () => {
  const { verifyCloudErpChaining } = await import('./helpers/erp-cloud-chain.mjs');
  await verifyCloudErpChaining(read('supabase/functions/app-api/index.ts'));
});

test('Invariant 134: three-digit patch releases advance numerically without remote downgrade', () => {
  const source = read('assets/app-lifecycle.js');
  const context = vm.createContext({ root: {} });
  vm.runInContext(source.slice(source.indexOf('    const normalizeAgDataVersion ='), source.indexOf('    const isAuthTransitionActive =')), context);
  assert.equal(context.root.compareAgDataVersions('2.3.100', '2.3.99'), 1);
  assert.equal(context.root.compareAgDataVersions('2.3.99', '2.3.100'), -1);
  assert.equal(context.root.compareAgDataVersions('2.10.0', '2.9.999'), 1);
});

test('Invariant 135: SOC ingestion retains each eligible physical Suspend row', socIngestionContract);

test('Invariant 136: Home completion metadata precedes every full-row completion refresh', async () => {
  const events = [];
  let timer, finishMetadata;
  const context = runFunctions('assets/app-runtime.js', ['scheduleManualSyncCompletionRefresh'], {
    manualSyncPostRefreshInFlight: false, currentUser: 'authorized-user', navigator: { onLine: true },
    MANUAL_SYNC_COMPLETION_REFRESH_DELAY_MS: 0, MANUAL_SYNC_COMPLETION_CATCHUP_DELAY_MS: 0,
    setTimeout: callback => { timer = callback; }, liveSyncMode: 'idle', updateSyncDiagnostics() {},
    refreshDashboardSyncMetadata: () => new Promise(resolve => { events.push('metadata'); finishMetadata = resolve; }),
    forceRefreshViewDatasets: () => { events.push('rows'); return Promise.resolve(); },
    getManualSyncCompletionViewId: () => 'home', queueVisibleDatasetCatchup() {}, isTouchConstrainedDevice: () => false,
  });
  context.scheduleManualSyncCompletionRefresh();
  const work = timer();
  assert.deepEqual(events, ['metadata']);
  finishMetadata();
  await work;
  assert.deepEqual(events, ['metadata', 'rows']);
});

test('Invariant 137: a cloud lease dispatches its successor after the claimed chunk finishes', () => cloudContinuationContract(runFunctions));

test('Invariant 138: streamed XLSX callbacks retain at most one bounded raw batch', async () => {
  const batches = [];
  const context = runFunctions('supabase/functions/_shared/erp-sync.mjs', ['parseErpXlsxImportRows','maxErpImportRows'], {
    exports: {}, BATCH_SIZE: 5000, xlsxSheetContext: async () => ({ zip: {}, sheetPath: 'sheet' }), zipText: async () => '',
    visitXlsxRows: async (_zip, _sheet, callback) => {
      await callback('header');
      for (let index = 0; index < 10001; index += 1) await callback(String(index));
    },
    parseXlsxRowXml: value => ({ cells: value === 'header' ? ['itemcode'] : [value] }),
    normalizeErpHeader: value => value,
  }, true);
  const result = await context.parseErpXlsxImportRows(new Uint8Array(), 'reserves', {
    batchSize: 5000, onBatch: async rows => { batches.push(rows.length); assert.ok(rows.length <= 5000); },
  });
  assert.deepEqual(batches, [5000, 5000, 1]);
  assert.deepEqual(plain(result), { rowCount: 10001 });
});

import {assertCompactErpBatchContract} from './helpers/erp-compact-batch-contract.mjs';

test('Invariant 139: compact ERP batches preserve explicit null-clearing columns and typed values', assertCompactErpBatchContract);

test('Invariant 140: SOC cell selection decodes only exact requested columns including sparse shared values', () => {
  const context = runFunctions('supabase/functions/_shared/erp-sync.mjs',
    ['xlsxColumnLetters', 'selectedCellPattern', 'parseXlsxSelectedCells', 'sharedValue', 'xmlText'],
    { selectedCellPatternCache: new WeakMap() }, true);
  const wanted = new Set([1, 27]);
  const selected = context.parseXlsxSelectedCells('<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="inlineStr"><is><t>excluded</t></is></c><c r="AA2" t="inlineStr"><is><t>38&amp;A</t></is></c></row>', ['001'], wanted);
  assert.deepEqual(plain([...selected.entries()]), [[1, '001'], [27, '38&A']]);
  assert.equal(context.selectedCellPattern(wanted), context.selectedCellPattern(wanted));
});

test('Invariant 141: drawer identity and active row follow the current account and exact primary view', () => {
  const buttons = ['home', 'drive', 'docks', 'request-sales-impact'].map(view => ({
    dataset: { drawerView: view }, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  }));
  const nodes = { 'side-drawer': { querySelectorAll: () => buttons }, 'drawer-user-name': {}, 'drawer-user-role': {} };
  const context = runFunctions('assets/app-runtime.js', ['syncDrawerPresentation'], {
    document: { getElementById: id => nodes[id] }, nativeAuthProfile: { username: 'first-user' },
    currentUser: 'first-user', currentPrimaryViewId: 'drive', getCurrentRoleAccessValue: () => 'Admin',
  });
  context.syncDrawerPresentation();
  assert.equal(nodes['drawer-user-name'].textContent, 'first-user');
  assert.equal(nodes['drawer-user-role'].textContent, 'Admin');
  assert.deepEqual(buttons.filter(button => button.attributes['aria-current'] === 'page').map(button => button.dataset.drawerView), ['drive']);
  context.nativeAuthProfile = { username: 'second-user' };
  context.currentPrimaryViewId = 'request-sales-impact';
  context.getCurrentRoleAccessValue = () => 'Rep';
  context.syncDrawerPresentation();
  assert.equal(nodes['drawer-user-name'].textContent, 'second-user');
  assert.equal(nodes['drawer-user-role'].textContent, 'Rep');
  assert.deepEqual(buttons.filter(button => button.attributes['aria-current'] === 'page').map(button => button.dataset.drawerView), ['request-sales-impact']);
});

test('Invariant 142: removing the drawer freshness card preserves write gates without a stale Menu warning', () => {
  const gates = [];
  const dot = { hidden: false };
  const menu = { removeAttribute: name => gates.push(name) };
  const context = runFunctions('assets/app-runtime.js', ['renderProductionDataFreshness'], {
    document: { getElementById: id => ({ 'live-data-warning-dot': dot, 'footer-menu-btn': menu })[id] || null },
    updateDocksWriteControlGate: () => gates.push('docks'), updateSuspendTagWriteControlGate: () => gates.push('suspend'),
  });
  context.renderProductionDataFreshness({ state: 'Needs attention' });
  assert.equal(dot.hidden, true);
  assert.deepEqual(gates, ['aria-description', 'docks', 'suspend']);
});

test('Invariant 143: owner-scoped Sales Impact shares the drawer row contract and stays before Historical Requests', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<section><button id="drawer-office-btn"></button><button id="drawer-historical-requests-btn"></button></section>');
  let owner = true, opened = 0;
  const context = runFunctions('assets/app-runtime.js', ['createRequestSalesImpactEntry', 'syncRequestSalesImpactEntrypoints'], {
    document: dom.window.document, isRequestSalesImpactOwner: () => owner, openRequestSalesImpact: () => opened++,
  });
  try {
    context.syncRequestSalesImpactEntrypoints();
    context.syncRequestSalesImpactEntrypoints();
    const button = dom.window.document.getElementById('drawer-request-sales-impact-btn');
    assert.equal(dom.window.document.querySelectorAll('#drawer-request-sales-impact-btn').length, 1);
    assert.equal(button.nextElementSibling.id, 'drawer-historical-requests-btn');
    assert.equal(button.classList.contains('drawer-item'), true);
    assert.equal(button.dataset.drawerView, 'request-sales-impact');
    button.click();
    assert.equal(opened, 1);
    owner = false;
    context.syncRequestSalesImpactEntrypoints();
    assert.equal(dom.window.document.getElementById('drawer-request-sales-impact-btn'), null);
  } finally { dom.window.close(); }
});

test('Invariant 144: drawer theme isolation preserves dark contrast, compact close control and hidden role rows', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<body class="ops-precision-pilot"><div id="side-drawer"><header class="drawer-header"><button class="drawer-close-btn">Close</button></header><nav id="drawer-modules"><button class="drawer-item">Drive</button><button class="drawer-item hidden">Restricted</button></nav></div></body>');
  try {
    const style = dom.window.document.createElement('style');
    // Exercise the theme-owned important declarations that caused the live regression.
    style.textContent = read('assets/ops-precision-pilot.css') + '\n' + read('assets/app-styles.css');
    dom.window.document.head.appendChild(style);
    for (const theme of ['light', 'dark']) {
      dom.window.document.body.dataset.opsTheme = theme;
      for (const outdoor of [false, true]) {
        dom.window.document.body.classList.toggle('outdoor-mode', outdoor);
        const computed = selector => dom.window.getComputedStyle(dom.window.document.querySelector(selector));
        assert.equal(computed('#side-drawer').backgroundColor, 'rgb(7, 26, 18)');
        assert.equal(computed('.drawer-item').color, 'rgb(236, 253, 245)');
        assert.equal(computed('.drawer-item').fontWeight, '500');
        assert.equal(computed('.drawer-close-btn').width, '36px');
        assert.equal(computed('.drawer-close-btn').height, '36px');
        assert.equal(computed('.drawer-close-btn').minHeight, '36px');
        assert.equal(computed('.drawer-item.hidden').display, 'none');
      }
    }
  } finally { dom.window.close(); }
});

test('Invariant 145 (Sales Rep Identity Aliases Resolve to One Canonical Owner)', () => {
  const context = runFunctions('assets/app-runtime.js', [
    'normalizeRepMatchToken', 'normalizeRepDisplayOrder', 'getRepNameLookupTokens', 'matchSalesRepIdentity'
  ], { normalizeRequestSalesrepId: value => String(value || '').trim().toUpperCase() });
  for (const alias of ['Kevin Effinger', 'Effinger, Kevin', 'kevin_effinger', 'KEVIN.EFFINGER']) {
    assert.equal(context.matchSalesRepIdentity('Kevin Effinger', alias, 'S07', 'S07'), true, alias);
  }
  assert.equal(context.matchSalesRepIdentity('Kevin Effinger', 'Morgan Smith', 'S07', 'S08'), false,
    'a different name and ERP identity cannot inherit the canonical rep');
});

test('Invariant 146 (Request Customer and Consignee Options Stay Within the Selected Rep Pair Set)', () => {
  const context = vm.createContext({ window: {}, document: { getElementById: () => ({ value: '' }) } });
  vm.runInContext(requestMappingSetup + '\n' + requestMappingFunctions(), context);
  const base = mappingFixtureRow;
  context.customerRepMapRows = [
    { ...base, unique_id: 'pair-1', salesrepid: '01', salesrepname: 'Rep One', customername: 'Shared Customer', consigneename: 'North', customeridentityid: '00012', consigneeid: '00007' },
    { ...base, unique_id: 'pair-2', salesrepid: '01', salesrepname: 'Rep One', customername: 'Shared Customer', consigneename: 'South', customeridentityid: '00012', consigneeid: '00008' },
    { ...base, unique_id: 'pair-other-rep', salesrepid: '02', salesrepname: 'Rep Two', customername: 'Shared Customer', consigneename: 'North', customeridentityid: '00099', consigneeid: '00009' },
    { ...base, unique_id: 'pair-source-alias', salesrepid: 'S17', salesrepname: 'Rep One', customername: 'Other Customer', consigneename: 'South Texas', customeridentityid: '00013', consigneeid: '00010' },
  ];
  context.tempSelectedReqRep = 'Rep One';
  context.tempSelectedReqSalesrepId = '01';
  const options = context.getRequestModalCustomerOptionsForRep('Rep One');
  assert.deepEqual(Array.from(options, option => [option.customeridentityid, option.consigneeidentityid]), [
    ['AGDATA_NA_CUSTOMER', 'AGDATA_NA_CONSIGNEE'], ['00013', '00010'], ['00012', '00007'], ['00012', '00008'],
  ]);
  assert.equal(Array.from(options).find(option => option.customeridentityid === '00013').request_selected_salesrep_id, 'S17',
    'an alternate physical source ID is preserved on the mapped pair');
  assert.equal(Array.from(options).some(option => option.customeridentityid === '00099'), false,
    'same display names owned by another rep are not selectable');
});

test('Invariant 147 (Stale Universal Request Cache Is JD-Only)', () => {
  const context = vm.createContext({ window: {}, document: { getElementById: () => ({ value: '' }) } });
  vm.runInContext(requestMappingSetup + '\n' + requestMappingFunctions(), context);
  const owner = context.syncRequestModalCustomerMappingOwner();
  const own = { ...mappingFixtureRow, salesrepid: '01', salesrepname: 'Rep One' };
  const leaked = { ...own, unique_id: 'global-stale', customeridentityid: '99999', consigneeid: '88888', customername: 'Other Territory' };
  context.customerRepMapRows = [own];
  context.tempSelectedReqRep = 'Rep One';
  context.tempSelectedReqSalesrepId = '01';
  context.requestMappingRpcCache.set('01', { owner, rows: [leaked], universal: true });
  context.requestModalCustomerOptionRowsCache.set('01', { owner, rows: [leaked], universal: true });
  const ordinaryOptions = context.getRequestModalCustomerOptionsForRep('Rep One');
  assert.deepEqual(Array.from(ordinaryOptions, option => option.customeridentityid), ['AGDATA_NA_CUSTOMER', '00012']);
  context.currentUser = 'employee';
  context.nativeAuthProfile = { username: 'employee' };
  assert.equal(context.isUniversalRequestDirectoryRep('JD Jones'), false);
  context.currentUser = 'jd_jones';
  context.nativeAuthProfile = { username: 'jd_jones' };
  assert.equal(context.isUniversalRequestDirectoryRep('JD Jones'), true);
  assert.equal(context.getRequestSelectedSalesrepId('JD Jones'), 'AGDATA_EXECUTIVE_ALL');
});

test('Invariant 148 (Empty Customer Options Bind REP Actors and Require Manager Rep Selection)', async () => {
  let actor = { id: 'admin', username: 'dylan_collyge', role: 'ADMIN' };
  const calls = [];
  const context = runFunctions('supabase/functions/app-api/index.ts', ['handleCustomerRepMappingAction'], {
    resolveActiveSessionProfile: async () => actor,
    validateCustomerRepMappingRequest: input => ({ operation: input.operation, payload: input }),
    hasTableReadAccess: () => true, isCustomerRepMappingEditorRole: () => true,
    normalizeUsername: value => String(value).trim().toLowerCase(), jsonValue: value => value,
    jsonResponse: data => ({ status: 200, data }),
    errorResponse: (message, status, details) => ({ status, message, ...details }),
    supabase: { rpc: async (name, payload) => {
      calls.push({ name, payload });
      return { data: { ok: true, rows: [], universal: actor.username === 'jd_jones' } };
    } },
  });
  assert.equal((await context.handleCustomerRepMappingAction({ role: 'ADMIN' }, { operation: 'options' })).status, 400);
  assert.equal(calls.length, 0, 'an empty manager selection cannot enumerate every rep');
  actor = { id: 'kevin', username: 'kevin_effinger', role: 'SALES_REP' };
  assert.equal((await context.handleCustomerRepMappingAction({ role: actor.role }, { operation: 'options' })).status, 200);
  assert.equal(calls.at(-1).name, 'request_customer_directory_v23102');
  assert.equal(calls.at(-1).payload.p_actor_id, 'kevin');
  assert.equal(calls.at(-1).payload.p_salesrep_identity, 'kevin_effinger');
  actor = { id: 'admin', username: 'dylan_collyge', role: 'ADMIN' };
  assert.equal((await context.handleCustomerRepMappingAction({ role: 'ADMIN' }, { operation: 'options', salesrepId: 'S25' })).status, 200);
  assert.equal(calls.at(-1).payload.p_salesrep_id, 'S25');
  actor = { id: 'jd', username: 'jd_jones', role: 'ADMIN' };
  const executive = await context.handleCustomerRepMappingAction({ role: 'ADMIN' }, { operation: 'options' });
  assert.equal(executive.status, 200);
  assert.equal(executive.data.universal, true);
  assert.ok(calls.every(call => call.name === 'request_customer_directory_v23102'));
});

test('Invariant 149 (Request Folder Picker Enforces Current Physical Pair Ownership)', () => {
  const context = vm.createContext({ window: {}, document: { getElementById: () => null } });
  vm.runInContext(requestMappingSetup + '\n' + requestMappingFunctions(), context);
  context.customerRepMapRows = [mappingFixtureRow];
  context.canUseRequestMappedFoldersForCurrentUser = () => true;
  context.isRequestRowArchivedForCompletion = () => false;
  context.getRequestCustomerFolderLabel = (customer, consignee) => customer || consignee || 'Unknown Customer';
  context.getRequestConsigneeFolderLabel = consignee => consignee || 'No Consignee';
  context.normalizeRequestConsigneeFolderKey = value => context.normalizeRepMatchToken(value);
  context.parseExistingRequestFolderMetadata = folderId => ({ dateIso: '', dateLabel: '', requestNumber: '', requestIdLabel: folderId });
  const owner = context.syncRequestModalCustomerMappingOwner();
  const staleSynthetic = { ...mappingFixtureRow, CUSTOMERIDENTITYID: '00999', customeridentityid: '00999', CUSTOMERNAME: 'Stale Synthetic Customer', customername: 'Stale Synthetic Customer',
    CONSIGNEEID: 'AGDATA_NA_CONSIGNEE', consigneeid: 'AGDATA_NA_CONSIGNEE', consigneename: 'N/A' };
  context.requestMappingRpcCache.set('01', { owner, rows: [mappingFixtureRow, staleSynthetic], universal: false, revision: 'old' });
  context.requestsInventory = [
    { UNIQUE_ID: 'owned-folder', REQUEST_FOLDER: 'Rep One-REQ-1', REQUESTED_BY: 'Rep One', CUSTOMERIDENTITYID: '00012', CUSTOMERNAME: 'Garden ®', CONSIGNEEID: '00007', CONSIGNEENAME: 'North ™' },
    { UNIQUE_ID: 'foreign-folder', REQUEST_FOLDER: 'Rep One-REQ-2', REQUESTED_BY: 'Rep One', CUSTOMERIDENTITYID: '99999', CUSTOMERNAME: 'Foreign Customer', CONSIGNEEID: '88888', CONSIGNEENAME: 'Foreign Site' },
  ];
  const groups = context.buildExistingRequestFolderCustomerGroups('Rep One');
  assert.equal(context.getRequestModalCustomerOptionsForRep('Rep One').some(option => option.customeridentityid === '00999'), false,
    'stale same-account cache cannot attach an N/A consignee to a real customer');
  assert.equal(groups.some(group => group.key === 'id:99999'), false, 'foreign active folders cannot add an unowned customer pair');
  assert.equal(groups.flatMap(group => group.consignees).flatMap(consignee => consignee.folders).some(folder => folder.folderId === 'Rep One-REQ-2'), false);
  assert.ok(groups.every(group => group.mapCount > 0), 'visible folders attach only to current owned mappings');
  assert.equal(context.addCustomRequestCustomerOption('Unmapped Customer', 'Unmapped Site'), null,
    'ordinary reps cannot add synthetic customer/consignee identities');
});

test('Invariant 150 (RPC Customer Options Retain the Physical Pair IDs Used by Validation)', async () => {
  const context = vm.createContext({ window: {}, document: { getElementById: () => null } });
  vm.runInContext(requestMappingSetup + '\n' + requestMappingFunctions(), context);
  const s07 = { ...mappingFixtureRow, unique_id: 'chance-s07', salesrepid: 'S07', salesrepname: 'Chance Alldredge',
    salesrep_canonical_key: 'profile-chance', customeridentityid: '00060', customername: 'Chance Customer', consigneeid: '00070', consigneename: 'North' };
  const s17 = { ...mappingFixtureRow, unique_id: 'chance-s17', salesrepid: 'S17', salesrepname: 'Chance Alldredge',
    salesrep_canonical_key: 'profile-chance', customeridentityid: '00061', customername: 'Chance Customer', consigneeid: '00071', consigneename: 'South' };
  context.customerRepMapRows = [s07, s17];
  context.tempSelectedReqRep = 'Chance Alldredge';
  context.tempSelectedReqSalesrepId = 'S17';
  context.isRequestRowArchivedForCompletion = () => false;
  context.fetchRequestUniversalCustomerOptions = async () => ({ rows: [s07, s17], revision: 'rpc-r1', salesrepId: 'S17', salesrepCanonicalKey: 'profile-chance', universal: false });
  const entry = await context.loadRequestModalCustomerOptionsForRep('Chance Alldredge', true);
  const pairs = entry.rows.filter(option => option.customeridentityid !== 'AGDATA_NA_CUSTOMER');
  assert.deepEqual(plain(pairs.map(option => [option.salesrepid, option.request_selected_salesrep_id, option.consigneeid, option.consigneeidentityid])),
    [['S07', 'S07', '00070', '00070'], ['S17', 'S17', '00071', '00071']]);
  assert.ok(pairs.every(option => context.isActiveRequestCustomerMapping(option)),
    'built RPC options preserve every physical identity field consumed by active-pair validation');
});

test('Invariant 151 (Cold Name-Resolved RPC Pairs Bind the Selected Rep Before Picker Rendering)', async () => {
  const context = vm.createContext({ window: {}, document: { getElementById: () => null } });
  vm.runInContext(requestMappingSetup + '\n' + requestMappingFunctions(), context);
  const pairs = ['00031', '00032', '00033', '00034'].map((customerId, index) => ({
    ...mappingFixtureRow, unique_id: `casey-${index}`, salesrepid: 'S03', salesrepname: 'Casey Rufener',
    salesrep_canonical_key: 'profile-casey', customeridentityid: customerId, customername: `Casey Customer ${index}`, consigneeid: `0004${index}`,
    consigneename: `Casey Site ${index}`,
  }));
  context.customerRepMapRows = [];
  context.tempSelectedReqRep = 'Casey Rufener';
  context.tempSelectedReqSalesrepId = 'S03';
  context.REQUEST_MODAL_REP_OPTIONS = [{ label: 'Casey Rufener', token: context.normalizeRepMatchToken('Casey Rufener'), collapsedToken: 'caseyrufener' }];
  context.isRequestRowArchivedForCompletion = () => false;
  context.canUseRequestMappedFoldersForCurrentUser = () => true;
  context.getRequestCustomerFolderLabel = (customer, consignee) => customer || consignee || 'Unknown Customer';
  context.getRequestConsigneeFolderLabel = consignee => consignee || 'No Consignee';
  context.normalizeRequestConsigneeFolderKey = value => context.normalizeRepMatchToken(value);
  context.parseExistingRequestFolderMetadata = folderId => ({ dateIso: '', dateLabel: '', requestNumber: '', requestIdLabel: folderId });
  context.fetchRequestUniversalCustomerOptions = async () => ({ rows: pairs, revision: 'casey-cold-r1', salesrepId: 'S03', salesrepCanonicalKey: 'profile-casey', universal: false });
  assert.equal(context.getRequestSelectedSalesrepId('Casey Rufener'), '', 'the fixture begins without a loaded directory index');
  const loaded = await context.loadRequestModalCustomerOptionsForRep('Casey Rufener', true);
  assert.equal(loaded.rows.length, pairs.length);
  assert.equal(context.getRequestSelectedSalesrepId('Casey Rufener'), 'S03', 'validated RPC rows bind the source rep identity');
  const options = context.getRequestModalCustomerOptionsForRep('Casey Rufener');
  assert.deepEqual(plain(options.map(option => [option.salesrepid, option.customeridentityid, option.consigneeidentityid])), [
    ['S03', 'AGDATA_NA_CUSTOMER', 'AGDATA_NA_CONSIGNEE'], ...pairs.map(pair => ['S03', pair.customeridentityid, pair.consigneeid]),
  ]);
  const groups = context.buildExistingRequestFolderCustomerGroups('Casey Rufener');
  assert.deepEqual(plain(groups.map(group => group.key)), ['id:AGDATA_NA_CUSTOMER', ...pairs.map(pair => `id:${pair.customeridentityid}`)]);
  assert.ok(groups.slice(1).every(group => group.mapCount > 0), 'the actual existing-folder picker retains every validated physical customer pair');
});

test('Invariant 152 (Canonical Rep Keys Preserve Alias-Owned Physical Pairs and Reject Foreign Profiles)', async () => {
  const context = vm.createContext({ window: {}, document: { getElementById: () => null } });
  vm.runInContext(requestMappingSetup + '\n' + requestMappingFunctions(), context);
  const s07 = { ...mappingFixtureRow, unique_id: 'chance-s07', salesrepid: 'S07', salesrepname: 'Chance Alldredge',
    salesrep_canonical_key: 'profile-chance', customeridentityid: '00060', customername: 'Chance Customer', consigneeid: '00070', consigneename: 'North' };
  const s17 = { ...mappingFixtureRow, unique_id: 'chance-s17', salesrepid: 'S17', salesrepname: 'Chance Alldredge - South TX',
    salesrep_canonical_key: 'profile-chance', customeridentityid: '00061', customername: 'Chance Customer', consigneeid: '00071', consigneename: 'South' };
  const foreign = { ...mappingFixtureRow, unique_id: 'foreign-s99', salesrepid: 'S99', salesrepname: 'Chance Alldredge - South TX',
    salesrep_canonical_key: 'profile-foreign', customeridentityid: '99999', customername: 'Foreign Customer', consigneeid: '99998', consigneename: 'Foreign Site' };
  const unverified = { ...mappingFixtureRow, unique_id: 'unverified-s07', salesrepid: 'S07', salesrepname: 'Chance Alldredge',
    customeridentityid: '99997', customername: 'Unverified Customer', consigneeid: '99996', consigneename: 'Unverified Site' };
  context.customerRepMapRows = [];
  context.tempSelectedReqRep = 'Chance Alldredge';
  context.tempSelectedReqSalesrepId = 'S07';
  context.REQUEST_MODAL_REP_OPTIONS = [{ label: 'Chance Alldredge', token: context.normalizeRepMatchToken('Chance Alldredge'), collapsedToken: 'chancealldredge' }];
  context.isRequestRowArchivedForCompletion = () => false;
  context.canUseRequestMappedFoldersForCurrentUser = () => true;
  context.getRequestCustomerFolderLabel = (customer, consignee) => customer || consignee || 'Unknown Customer';
  context.getRequestConsigneeFolderLabel = consignee => consignee || 'No Consignee';
  context.normalizeRequestConsigneeFolderKey = value => context.normalizeRepMatchToken(value);
  context.parseExistingRequestFolderMetadata = folderId => ({ dateIso: '', dateLabel: '', requestNumber: '', requestIdLabel: folderId });
  context.fetchRequestUniversalCustomerOptions = async () => ({ rows: [s07, s17, foreign, unverified], revision: 'chance-alias-r1',
    salesrepId: 'S07', salesrepCanonicalKey: 'profile-chance', universal: false });
  const loaded = await context.loadRequestModalCustomerOptionsForRep('Chance Alldredge', true);
  assert.equal(loaded.salesrepCanonicalKey, 'profile-chance');
  const options = context.getRequestModalCustomerOptionsForRep('Chance Alldredge');
  assert.deepEqual(plain(options.map(option => [option.salesrepid, option.customeridentityid, option.consigneeidentityid])), [
    ['S07', 'AGDATA_NA_CUSTOMER', 'AGDATA_NA_CONSIGNEE'], ['S07', '00060', '00070'], ['S17', '00061', '00071'],
  ]);
  const groups = context.buildExistingRequestFolderCustomerGroups('Chance Alldredge');
  assert.deepEqual(plain(groups.map(group => group.key)), ['id:AGDATA_NA_CUSTOMER', 'id:00060', 'id:00061']);
  assert.equal(options.some(option => option.customeridentityid === foreign.customeridentityid), false,
    'matching display text cannot substitute for an authoritative matching canonical key');
  assert.equal(options.some(option => option.customeridentityid === unverified.customeridentityid), false,
    'a missing canonical key cannot be inferred from an exact display-name match');
});

test('Invariant 153 (Warm Partial Rep Cache Stays Visible While Normal Selection Loads Canonical Aliases)', async () => {
  const context = vm.createContext({ window: {}, document: { getElementById: () => null } });
  vm.runInContext(requestMappingSetup + '\n' + requestMappingFunctions(), context);
  const s07 = { ...mappingFixtureRow, unique_id: 'chance-s07', salesrepid: 'S07', salesrepname: 'Chance Alldredge',
    customeridentityid: '00060', customername: 'Chance Customer', consigneeid: '00070', consigneename: 'North' };
  const s17 = { ...mappingFixtureRow, unique_id: 'chance-s17', salesrepid: 'S17', salesrepname: 'Chance Alldredge - South TX',
    customeridentityid: '00061', customername: 'Chance Customer', consigneeid: '00071', consigneename: 'South' };
  context.customerRepMapRows = [s17];
  context.tempSelectedReqRep = 'Chance Alldredge - South TX';
  context.tempSelectedReqSalesrepId = 'S17';
  context.isRequestRowArchivedForCompletion = () => false;
  context.canUseRequestMappedFoldersForCurrentUser = () => true;
  context.getRequestCustomerFolderLabel = (customer, consignee) => customer || consignee || 'Unknown Customer';
  context.getRequestConsigneeFolderLabel = consignee => consignee || 'No Consignee';
  context.normalizeRequestConsigneeFolderKey = value => context.normalizeRepMatchToken(value);
  context.parseExistingRequestFolderMetadata = folderId => ({ dateIso: '', dateLabel: '', requestNumber: '', requestIdLabel: folderId });
  const owner = context.syncRequestModalCustomerMappingOwner();
  context.requestMappingRpcCache.set('S17', { owner, rows: [s17], universal: false, revision: 'partial-preload-r1' });
  let resolveRpc;
  context.fetchRequestUniversalCustomerOptions = () => new Promise(resolve => { resolveRpc = resolve; });
  const before = context.getRequestModalCustomerOptionsForRep('Chance Alldredge - South TX');
  assert.equal(before[0].customeridentityid, 'AGDATA_NA_CUSTOMER');
  assert.deepEqual(plain(before.filter(option => option.customeridentityid !== 'AGDATA_NA_CUSTOMER')
    .map(option => [option.salesrepid, option.customeridentityid, option.consigneeidentityid])), [['S17', '00061', '00071']]);
  const pending = context.ensureRequestModalCustomerOptionsReady();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof resolveRpc, 'function', 'normal selection fetches even when the warm local cache has an exact pair');
  assert.equal(context.requestModalCustomerOptionsLoading, true);
  assert.ok(context.getRequestModalCustomerOptionsForRep('Chance Alldredge - South TX').some(option => option.customeridentityid === '00061'),
    'available same-account LKG remains visible while the canonical directory refreshes');
  resolveRpc({ rows: [
    { ...s07, salesrep_canonical_key: 'profile-chance' }, { ...s17, salesrep_canonical_key: 'profile-chance' },
  ], revision: 'canonical-refresh-r2', salesrepId: 'S17', salesrepCanonicalKey: 'profile-chance', universal: false });
  await pending;
  assert.equal(context.hasVerifiedRequestRepCanonicalDirectory(context.requestMappingRpcCache.get('S17'), owner), true);
  assert.deepEqual(plain(context.getRequestModalCustomerOptionsForRep('Chance Alldredge - South TX')
    .filter(option => option.customeridentityid !== 'AGDATA_NA_CUSTOMER')
    .map(option => [option.salesrepid, option.customeridentityid, option.consigneeidentityid])), [
    ['S07', '00060', '00070'], ['S17', '00061', '00071'],
  ]);
  assert.deepEqual(plain(context.buildExistingRequestFolderCustomerGroups('Chance Alldredge - South TX').map(group => group.key)),
    ['id:AGDATA_NA_CUSTOMER', 'id:00060', 'id:00061']);
});

test('Invariant 154 (JD Global Directory Retries After Same-Actor Ownership Refresh)', async () => {
  const context = vm.createContext({ window: {}, document: { getElementById: () => null } });
  vm.runInContext(requestMappingSetup + '\n' + requestMappingFunctions(), context);
  context.currentUser = 'jd_jones';
  context.nativeAuthProfile = { username: 'jd_jones' };
  context.tempSelectedReqRep = 'Rep Two';
  context.tempSelectedReqSalesrepId = '02';
  context.resetRequestCustomerSelectionState = () => {};
  context.isRequestRowArchivedForCompletion = () => false;
  context.canUseRequestMappedFoldersForCurrentUser = () => true;
  context.getRequestCustomerFolderLabel = (customer, consignee) => customer || consignee || 'Unknown Customer';
  context.getRequestConsigneeFolderLabel = consignee => consignee || 'No Consignee';
  context.normalizeRequestConsigneeFolderKey = value => context.normalizeRepMatchToken(value);
  context.parseExistingRequestFolderMetadata = folderId => ({ dateIso: '', dateLabel: '', requestNumber: '', requestIdLabel: folderId });
  context.syncRequestModalCustomerMappingOwner();
  const globalPair = { ...mappingFixtureRow, unique_id: 'jd-global-refresh', salesrepid: 'AGDATA_EXECUTIVE_ALL',
    salesrepname: 'JD Jones', customeridentityid: '00999', customername: 'Other Territory',
    consigneeid: '00888', consigneename: 'Global Site' };
  let fetchCount = 0;
  context.fetchRequestUniversalCustomerOptions = async (_repName, salesrepId) => {
    fetchCount += 1;
    if (fetchCount === 1) context.appAccessSnapshotState.snapshot.dataPermissionVersion = 'perm-2';
    return { rows: [globalPair], revision: `jd-refresh-${fetchCount}`, salesrepId,
      salesrepCanonicalKey: '', universal: true };
  };
  const ready = await context.ensureRequestModalCustomerOptionsReady();
  assert.equal(fetchCount, 2, 'the owner-scoped response is discarded and retried once under the current permission version');
  assert.equal(ready, true);
  assert.equal(context.requestModalCustomerOptionsLoading, false);
  assert.equal(context.requestModalCustomerOptionsError, '');
  const entry = context.requestMappingRpcCache.get('AGDATA_EXECUTIVE_ALL');
  assert.equal(entry.owner, context.getRequestModalLookupOwnerSignature());
  assert.equal(entry.universal, true);
  assert.equal(context.getRequestSelectedSalesrepId('Rep Two'), 'AGDATA_EXECUTIVE_ALL');
  assert.ok(context.getRequestModalCustomerOptionsForRep('Rep Two').some(option => option.customeridentityid === '00999'),
    'the authenticated JD actor keeps global customer pairs while another rep is selected');
});

test('Invariant 155 (Cloud ERP Retries Persist Bounded Rows Before Atomic Publication)', async () => {
  const { stageFileContinuation } = await import('../supabase/functions/_shared/erp-sync.mjs');
  const lines=Array.from({length:1201},(_,index)=>`item-${index},Plant ${index},1`).join('\n');
  const bytes=`itemcode,commonname,ptravailable\n${lines}\n`;
  const file={id:'golden-erp-bounded',name:'Drive.csv',modifiedTime:'2026-10-29T12:00:00Z',parents:['drop-folder','shared-folder']};
  const appended=[];let committed=0,archived=false;
  const fetcher=async(input,init={})=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/files/golden-erp-bounded')&&url.searchParams.get('alt')==='media')return new Response(bytes);
    if(url.pathname.endsWith('/files/golden-erp-bounded')&&url.searchParams.has('fields')&&init.method!=='PATCH')
      return Response.json({id:file.id,parents:file.parents});
    if(url.pathname.endsWith('/files/golden-erp-bounded')&&init.method==='PATCH'){
      assert.equal(url.searchParams.get('removeParents'),'drop-folder,shared-folder');archived=true;return Response.json({id:file.id});
    }
    throw new Error(`unexpected Drive request ${url}`);
  };
  const supabase={rpc:async(name,args)=>{
    if(name==='check_erp_file_sync_needed_v1')return {data:{skip:false}};
    if(name==='fast_erp_import_columns_v1')return {data:['unique_id','itemcode','commonname','ptravailable']};
    if(name==='fast_begin_erp_stage_v1')return {data:{stage_id:'golden-stage',expected_rows:1201,staged_rows:0}};
    if(name==='fast_append_erp_stage_batch_v1'){
      appended.push(args.p_rows.length);return {data:{staged_rows:args.p_start_row+args.p_rows.length}};
    }
    if(name==='fast_commit_erp_stage_swap_v1'){committed+=1;return {data:{ok:true}};}
    throw new Error(`unexpected ERP RPC ${name}`);
  }};
  let state=null,result;
  for(let slice=0;slice<5;slice+=1){
    result=await stageFileContinuation({supabase,fetcher,token:'fixture-token',file,dataset:'drive_around',stageKey:'drive',
      parentId:'drop-folder',processedId:'processed-folder',status:async()=>{},state,maxRowsPerSlice:600});
    if(result.done)break;
    state=result.state;
    assert.ok(state.processedRows<1201||state.phase==='finalize'||state.phase==='move');
  }
  assert.equal(result.done,true);
  assert.deepEqual(appended,[600,600,1]);
  assert.equal(committed,1);
  assert.equal(archived,true);
});

test('Invariant 156 (Sales Rep Bloom Actions Expose Only Share and Request)', () => bloomRoleActionContract(runFunctions));

test('Invariant 157 (Transient RUN SCRIPT Slice Failures Reduce Rows and Stop After Six Retries)', async () => {
  const context = vm.createContext({ module: { exports: {} }, Date, Promise,
    MANUAL_SYNC_SCRIPT_TIMEOUT_MS: 600000, APP_API_FUNCTION_URL: '/app-api',
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== ''),
    applyManualSyncStatus() {}, setTimeout: callback => { callback(); return 0; } });
  context.postAppFunctionJson = async (_url, body) => {
    context.sliceRowLimits.push(body.maxRowsPerSlice);
    if (context.sliceFailures-- > 0) throw Object.assign(new Error('worker limit'), { status: 546 });
    return { ok: true, status: 'DONE', data: { runStatus: { active: false, runId: 'run-six-retries' } } };
  };
  context.sliceRowLimits = [];
  context.sliceFailures = 6;
  runFunctions('assets/app-runtime.js', ['getTransientManualErpSliceStatus','reduceManualErpSliceLimit','continueManualErpSync'], context);
  const result = await context.continueManualErpSync({ runId: 'run-six-retries' });
  assert.equal(result.active, false);
  assert.deepEqual(plain(context.sliceRowLimits), [2500,1250,600,600,600,600,600]);
});

test('Invariant 158 (Secondary Cloud Imports Finalize Before Moving Actual Drive Parents)', async () => {
  const {runSecondaryErpSyncStep,SECONDARY_ERP_STAGES}=await import('../supabase/functions/_shared/erp-secondary-sync.mjs');
  const stage=SECONDARY_ERP_STAGES.find(row=>row.key==='pikes'),calls=[];
  const folders=Object.fromEntries(SECONDARY_ERP_STAGES.map(row=>[row.key,{files:[],listDurationMs:0}]));
  folders.pikes.files=[{id:'source-file',name:'order.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}];
  const db={rpc:async(name,args)=>{calls.push(name);if(name==='prepare_manager_order_import_v2')return {data:{status:'importing',batchId:'00000000-0000-4000-8000-000000000001'}};
    if(name==='upsert_secondary_erp_delta_v23103'){assert.equal(args.p_rows.length,1);assert.match(args.p_rows[0].row_state_hash,/^[a-f0-9]{64}$/);return {data:{changed:1}};}
    return {data:{status:'archive_pending'}};}};
  const fetcher=async(url,options={})=>{const parsed=new URL(url);if(parsed.searchParams.get('alt')==='media')return new Response(new Uint8Array([1,2,3]));
    if(options.method==='PATCH'){assert.ok(calls.includes('finalize_pikes_order_import'));assert.equal(parsed.searchParams.get('removeParents'),'actual-parent,pending-parent');assert.equal(parsed.searchParams.get('addParents'),stage.processed);calls.push('moved');return Response.json({id:'source-file'});}
    return Response.json({parents:['actual-parent','pending-parent']});};
  const first=await runSecondaryErpSyncStep({supabase:db,fetcher,accessToken:'fixture',env:()=>'',status:async()=>{},cursor:{secondaryFolders:folders},
    parseWorkbook:async()=>[{name:'Order',rows:[['Item','Order Tot','Pick Notes'],['001','4','North']]}]});
  assert.equal(first.done,false);assert.ok(calls.indexOf('moved')>calls.indexOf('finalize_pikes_order_import'));
  assert.ok(calls.indexOf('mark_pikes_order_file_archived')>calls.indexOf('moved'));
  const final=await runSecondaryErpSyncStep({supabase:db,fetcher:()=>{throw Error('No repeat download');},accessToken:'fixture',env:()=>'',status:async()=>{},cursor:first.cursor});
  assert.equal(final.done,true);
});

test('Invariant 159 (HL PDF Drop Skips Historical Native Sheets Without Moving Them)', async () => {
  const {prefetchSecondaryFolders,SECONDARY_ERP_STAGES}=await import('../supabase/functions/_shared/erp-secondary-sync.mjs');
  const hl=SECONDARY_ERP_STAGES.find(s=>s.key==='hl_po_parsed');
  const fetcher=async(input,init={})=>{assert.notEqual(init.method,'PATCH');const url=new URL(input);
    if(url.pathname.endsWith('/files'))return Response.json({files:url.searchParams.get('q').includes(hl.folder)?[
      {id:'historical-sheet',name:'HL PO 2026-10-19',mimeType:'application/vnd.google-apps.spreadsheet'},
      {id:'pending-pdf',name:'HL PO 2026-10-29.pdf',mimeType:'application/pdf'}]:[]});
    return Response.json({parents:[]});};
  const folders=await prefetchSecondaryFolders(fetcher,'fixture');
  assert.deepEqual(folders.hl_po_parsed.files.map(file=>file.id),['pending-pdf']);
});

test('Invariant 160 (Cloud ERP Finalization Renews Its Lease and Stops Safely)', async () => {
  let tick = null;
  let cleared = false;
  let renewals = 0;
  const context = runFunctions('supabase/functions/app-api/index.ts', ['withCloudErpSyncLeaseHeartbeat'], {
    supabase: { rpc: async (name, args) => {
      assert.equal(name, 'assert_erp_sync_worker_v1');
      assert.deepEqual(plain(args), { p_run_id: 'run-160', p_worker_id: 'worker-160' });
      renewals += 1;
      return { error: null };
    } },
    setInterval: callback => { tick = callback; return 1; },
    clearInterval: () => { cleared = true; },
  });
  let finishWork;
  const pendingWork = new Promise(resolve => { finishWork = resolve; });
  const work = context.withCloudErpSyncLeaseHeartbeat('run-160', 'worker-160', () => pendingWork);
  tick();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(renewals, 1, 'the in-flight atomic work renews its canonical lease');
  finishWork('committed');
  assert.equal(await work, 'committed');
  assert.equal(cleared, true, 'the timer stops when work completes');

  let terminalTick = null;
  const terminalContext = runFunctions('supabase/functions/app-api/index.ts', ['withCloudErpSyncLeaseHeartbeat'], {
    supabase: { rpc: async () => ({ error: { code: 'LEASE_INVALID' } }) },
    setInterval: callback => { terminalTick = callback; return 1; },
    clearInterval() {},
  });
  let finishTerminalWork;
  const terminalPending = new Promise(resolve => { finishTerminalWork = resolve; });
  const terminalWork = terminalContext.withCloudErpSyncLeaseHeartbeat('run-160', 'worker-160', () => terminalPending);
  terminalTick();
  await Promise.resolve();
  await Promise.resolve();
  finishTerminalWork('terminal-write-already-committed');
  assert.equal(await terminalWork, 'terminal-write-already-committed',
    'an already-started renewal may observe the terminal inactive status after durable completion');

  let failedTick = null;
  let failedTimerCleared = false;
  const failedContext = runFunctions('supabase/functions/app-api/index.ts', ['withCloudErpSyncLeaseHeartbeat'], {
    supabase: { rpc: async () => ({ error: { code: 'LEASE_INVALID' } }) },
    setInterval: callback => { failedTick = callback; return 1; },
    clearInterval: () => { failedTimerCleared = true; },
  });
  const failedWork = failedContext.withCloudErpSyncLeaseHeartbeat('run-160', 'expired-worker', async () => {
    failedTick();
    await Promise.resolve();
    throw new Error('ERP_SYNC_WORKER_LEASE_INVALID');
  });
  await assert.rejects(failedWork, /ERP_SYNC_WORKER_LEASE_INVALID/);
  assert.equal(failedTimerCleared, true, 'the timer stops when worker work fails');
});

test('Invariant 161 (Universal Realtime Patches Cache In Place Without Losing Aliased Drafts)', () => {
  const cached = { unique_id: 'master-161', itemcode: 'ITEM.1', ptravailable: 24, av_note: 'old', spec: 'draft spec' };
  const rerenders = [], restored = [];
  const context = runFunctions('assets/app-runtime.js', ['getUniversalLiveSyncTables', 'applyUniversalLiveSyncPatch'], {
    ACTIVE_REQUEST_TABLE: 'ph_requests_pending', REQUEST_HISTORY_TABLE: 'ph_requests_completed_history',
    WAREHOUSE_ASSIGNED_ITEMS_TABLE: 'ph_inventory_row_assignments', fullInventory: [cached], activeItem: cached,
    cartPanelOpen: false, getCurrentVisibleViewId: () => 'detail', captureProductionRefreshAnchor: () => ({ view: 'detail', top: 38 }),
    hasProductionLiveSyncDraft: () => true, hasActiveTextEntryFocus: () => false,
    applyRealtimeChange: (_table, payload) => { Object.assign(context.fullInventory[0], payload.new); return true; },
    flushRealtimeDatasetUpdates() {}, rebuildMasterInventoryIndexes() {}, markViewDirty() {}, isViewVisible: () => false,
    scheduleDocksRender() {}, updateGlobalActionBar() {}, restoreProductionRefreshAnchor: anchor => restored.push(anchor),
    scheduleProductionLiveSyncRender: immediate => rerenders.push(immediate),
  });
  const tables = Array.from(context.getUniversalLiveSyncTables());
  assert.ok(tables.includes('ph_master_inventory') && tables.includes('ph_soc_master') && tables.includes('ph_warehouse_assigned_items'));
  assert.equal(context.applyUniversalLiveSyncPatch('ph_master_inventory', { eventType: 'UPDATE', new: { ptravailable: 17, av_note: 'fresh' } }), true);
  assert.deepEqual([context.fullInventory[0].ptravailable, context.fullInventory[0].av_note], [17, 'fresh'], 'the canonical cache row keeps the realtime values');
  assert.equal(context.activeItem.spec, 'draft spec');
  assert.equal(context.activeItem.av_note, 'old', 'the open edit draft stays isolated from the cache patch');
  assert.notEqual(context.activeItem, context.fullInventory[0]);
  assert.deepEqual(rerenders, [true]);
  assert.equal(restored[0].top, 38, 'the active view scroll anchor is restored');
  assert.equal(context.applyUniversalLiveSyncPatch('credential-table', { eventType: 'UPDATE', new: {} }), false);
  assert.equal(rerenders.length, 1, 'unknown tables never repaint the active view');
  const coordinator = functionSource('assets/app-runtime.js', 'getProductionLiveSyncCoordinator');
  assert.match(coordinator, /\.on\('broadcast', \{ event: 'row_patch' \}/);
  assert.match(coordinator, /getUniversalLiveSyncTables\(\)\.includes\(payload\?\.table\)[\s\S]*readySources\.get\(payload\.table\) === false[\s\S]*payload\.rows\.length > 16/);
  assert.doesNotMatch(coordinator, /channel\.send\(/, 'browser clients cannot forge Broadcast row patches');
});

test('Invariant 162 (Docks Uses Exact Physical Pair to Hydrate the Canonical Drive Row)', () => {
  const context = runFunctions('assets/app-runtime.js', ['getDockCardLiveInventoryDisplayRow'], {
    fullInventory: [{ UNIQUE_ID: 'drive-row-162', ITEMCODE: '003085.030.1', LOCATIONCODE: 'D.12.000', LOTCODE: '26.F1',
      PHOTO_URL: 'photo-1,photo-2', SPEC: '10-12" HxW', LOC_MATCH_PCT: '23', HOLD_STOP_CODE: 'H', HOLD_STOP_REASON: 'sheared', PTRONHAND: '24' }],
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== ''),
    getQueueDisplayEvidenceRow: row => context.fullInventory.find(candidate => candidate.ITEMCODE === row.ITEMCODE && candidate.LOCATIONCODE === row.LOCATIONCODE && candidate.LOTCODE === row.LOTCODE) || null,
    getLiveDriveNoteRow: () => null,
  });
  const source = { UNIQUE_ID: 'soc-row-162', ITEMCODE: '003085.030.1', LOCATIONCODE: 'D.12.000', LOTCODE: '26.F1', PHOTO_URL: '', SPEC: '' };
  const display = context.getDockCardLiveInventoryDisplayRow(source);
  assert.equal(display.UNIQUE_ID, 'soc-row-162', 'the SOC physical identity remains the action identity');
  assert.equal(display.ITEMCODE, '003085.030.1', 'the exact displayed item code is preserved');
  assert.deepEqual([display.PHOTO_URL, display.SPEC, display.LOC_MATCH_PCT, display.HOLD_STOP_CODE, display.HOLD_STOP_REASON, display.PTRONHAND],
    ['photo-1,photo-2', '10-12" HxW', '23', 'H', 'sheared', '24']);
  const ambiguous = { ...source, UNIQUE_ID: 'soc-ambiguous', ITEMCODE:'003085.030.' };
  context.fullInventory.push({ ...context.fullInventory[0], UNIQUE_ID: 'drive-row-162b', ITEMCODE: '003085.030.2' });
  assert.equal(context.getDockCardLiveInventoryDisplayRow(ambiguous), ambiguous, 'ambiguous canonical candidates do not hydrate another physical row');
});

test('Invariant 163 (Table Management Presents Five Editable Tables and Five Read-Only Archives)', async () => {
  const access = { canViewAssignedItemsExport: true, canManageCustomerRepMappings: true, canManageAccessControl: true };
  const managerItems = runFunctions('assets/app-runtime.js', ['getManagerTableManagementItems'], {
    canUseHistoricalRequests: () => true, canOpenPhotoHistory: () => true,
  }).getManagerTableManagementItems(access);
  const editable = managerItems.filter(item => item.section === 'editable').map(item => item.id);
  const archive = managerItems.filter(item => item.section === 'archive').map(item => item.id);
  assert.deepEqual(plain(editable), ['assigned-items', 'company-directory', 'inquiry-coverage', 'customer-assignments', 'user-role-access']);
  assert.deepEqual(plain(archive), ['historical-drive-mode', 'historical-soc-open-orders', 'historical-soc-reserves', 'historical-requests', 'photo-history']);

  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'https://agdata.invalid/' });
  try {
    dom.window.confirm = () => true;
    vm.runInContext(read('assets/manager-table-management.js'), vm.createContext({ window: dom.window, document: dom.window.document,
      Blob: dom.window.Blob, FormData: dom.window.FormData, URL: dom.window.URL, CSS: { escape: value => String(value) }, setTimeout, clearTimeout }));
    const rootNode = dom.window.document.getElementById('root');
    const view = dom.window.GncManagerTableManagement.mountManagerTableManagement(rootNode, {
      tables: managerItems.map(item => item.id), request: async request => ({ rows: request.operation === 'users' ? [{ username: 'any_app_user', display_name: 'Any App User' }] : [], total: 487 }), openTable() {},
    });
    assert.equal(rootNode.querySelectorAll('[data-table-select]').length, 10);
    assert.equal(rootNode.querySelectorAll('.tm-choice em').length, 10);
    rootNode.querySelector('[data-table-select="inquiry-coverage"]').click();
    await new Promise(resolve => setImmediate(resolve));
    rootNode.querySelector('[data-add]').click();
    assert.equal(rootNode.querySelector('[name="primary_user"] option[value="any_app_user"]')?.textContent.includes('Any App User'), true,
      'coverage user options are supplied by the app-wide users read');
    view.destroy();
  } finally { dom.window.close(); }
});

test('Invariant 164 (Photo Upload Retries Transient Failures and Detail Hero Keeps Saved Photos)', async () => {
  const retryContext = runFunctions('assets/app-runtime.js', ['postPhotoUploadWithTransientRetry'], {
    APP_API_FUNCTION_URL: '/app-api', SUPABASE_UPLOAD_TIMEOUT_MS: 20000,
    setTimeout: (callback, delay) => { retryContext.delays.push(delay); callback(); }, delays: [],
    postAppFunctionFormData: async () => {
      retryContext.attempts += 1;
      if (retryContext.attempts < 3) throw Object.assign(new Error('temporary photo service error'), { status: retryContext.attempts === 1 ? 500 : 502 });
      return { ok: true, data: { photo: 'stored' } };
    }, attempts: 0,
  });
  const uploaded = await retryContext.postPhotoUploadWithTransientRetry({ append() {} });
  assert.equal(uploaded.data.photo, 'stored');
  assert.deepEqual(plain(retryContext.delays), [500, 1200]);

  const hero = { classList: { add() {}, remove() {} }, innerHTML: '' };
  const item = { COMMONNAME: 'Big Hit Hibiscus', CONTSIZE: '#3', PHOTO_LINK: 'photo-a,photo-b', SPEC: '18-22" H' };
  const detail = runFunctions('assets/app-runtime.js', ['renderAvDetailHero'], {
    document: { getElementById: id => id === 'det-av-hero' ? hero : null }, activeDetailSourceView: 'av', activeItem: item,
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== ''),
    getRowPhotoLink: row => row.PHOTO_LINK, getSharedAppPhotoLinkCsv: () => '', getPhotoUrlList: value => String(value || '').split(',').filter(Boolean),
    getDirectImageUrl: value => value, formatLocPhotoMatchQtyValue: () => '23', getAvDetailPickNoteText: () => '',
    getCardPtrOnHandValue: () => '20', getCardPtrReviewedValue: () => '2', getCardPtrAvailableValue: () => '18', getCardOpenStockValue: () => '18',
    escJsAttrValue: value => String(value), escapeShareHtml: value => String(value),
  });
  detail.renderAvDetailHero(item, 'av');
  const savedImages = hero.innerHTML.match(/<img src="photo-[ab]"/g);
  assert.equal(savedImages.length, 1);
  assert.match(hero.innerHTML, /2 Photos/);
  item.SPEC = 'Updated while editing';
  detail.renderAvDetailHero(item, 'av');
  assert.match(hero.innerHTML, /<img src="photo-a"/, 'unrelated spec edits keep the saved photo preview visible');
});

test('Invariant 165 (Non-Move Reclass Closes After Durable Idempotent Draft Staging)', async () => {
  const events = [], jobs = new Map(), button = { disabled: false, textContent: '' };
  const state = { sourceView: 'drive', snapshot: { uniqueId: 'source-165' } };
  let dispatchResolve;
  const delayedDispatch = new Promise(resolve => { dispatchResolve = resolve; });
  const context = runFunctions('assets/app-runtime.js', ['persistPendingReclassDeliveryDraft', 'getReclassDeliveryJob', 'submitArgosInventoryTransaction'], withGoldenReclassAuthority({
    argosInventoryTransactionState: state, currentUser: 'dylan_collyge', Date, JSON, String, Array, Object,
    getArgosReclassLiveEditIdentityKey: () => 'actor-165', getCurrentReclassDeliveryActor: () => 'dylan_collyge',
    isEvalReclassRowAssigned: () => true,
    getArgosInventoryTransactionRequestLabel: action => String(action || 'inquiry'),
    getArgosInventoryTransactionRequestAction: () => 'hold',
    getFriendlyBackendErrorMessage: (_error, fallback) => fallback,
    setArgosInventoryTransactionAction: () => {},
    upsertReclassDeliveryJob: job => { events.push('persist'); jobs.set(job.token, job); return job; },
    readReclassDeliveryJobs: () => Array.from(jobs.values()),
    getReclassDeliveryJob: token => jobs.get(token) || null,
    ensureArgosReclassSubmissionVerification() {}, getArgosInventoryTransactionPayloadForPendingMove: () => null,
    buildArgosInventoryTransactionPayload: () => ({ idempotencyToken: 'reclass_inquiry_165', source: { unique_id: 'source-165' }, transaction: { requestActions: ['hold'] }, rowOverlays: [] }),
    applyArgosInventoryTransactionSourceContext: payload => payload, applyArgosInventoryTransactionEmailRecipients: async payload => payload,
    persistPendingReclassDeliveryDraft: payload => {
      const job = context.persistPendingReclassDeliveryDraft(payload, 'dylan_collyge', 'drive');
      events.push(job?.status); return job;
    },
    dispatchPendingReclassDeliveryDraft: job => { events.push(`dispatch:${job.token}`); return delayedDispatch; },
    closeArgosInventoryTransactionModal: options => { assert.equal(options.background, true); events.push('close'); context.argosInventoryTransactionState = null; },
    showToast: title => events.push(title), window: { __gncOpsPilot: { captureFailure() {} } }, document: { getElementById: () => button },
  }));
  const started = performance.now();
  await context.submitArgosInventoryTransaction();
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `the dialog returns before network dispatch settles (${elapsed.toFixed(1)}ms)`);
  assert.deepEqual(events.slice(0, 3), ['persist', 'close', 'Queueing Inquiry']);
  assert.ok(events[3].startsWith('dispatch:reclass_inquiry_165'));
  assert.equal(jobs.get('reclass_inquiry_165')?.pendingCreate, true, 'the exact idempotent body remains recoverable');
  dispatchResolve({ status: 'queued' });
});

test('Invariant 166 (Suspend AV Selection Enables Only Checked Options)', async () => {
  const calls = [];
  const checked = [{ value: 'master-166' }];
  const countLabel = { textContent: '' };
  const headerAction = { disabled: true };
  const stickyAction = { disabled: true };
  const sticky = { classList: { toggle: (name, hidden) => calls.push(['sticky', name, hidden]) }, querySelector: selector => selector === '[data-suspend-av-add]' ? stickyAction : countLabel };
  const panel = {
    querySelectorAll: () => checked,
    querySelector: selector => selector === '[data-suspend-av-header-action="true"]' ? headerAction : selector === '[data-suspend-av-sticky]' ? sticky : null,
  };
  const sourceRow = { unique_id: 'suspend-source-166' }, selectedRows = [{ unique_id: 'master-166' }];
  const context = runFunctions('assets/app-runtime.js', ['syncSuspendAvOptionSelectionControls', 'addSelectedRequestItemCodeOptions'], {
    activeItem: sourceRow, activeDetailSourceView: 'request', lastView: 'request', document: { getElementById: () => panel, querySelectorAll: () => checked },
    isRequestDetailItem: () => true, canAddRequestItemCodeOptions: () => true,
    collectSelectedRequestItemCodeOptionRows: () => selectedRows, isDockSuspendDcRequestMirrorRow: () => true,
    addSelectedDockSuspendDcRequestOptions: (rows, item) => { calls.push(['submit', rows, item]); return true; },
    getRequestFolderName: () => { throw new Error('Suspend selection cannot require a Request folder'); }, showToast() {},
  });
  context.syncSuspendAvOptionSelectionControls();
  assert.equal(headerAction.disabled, false);
  assert.equal(stickyAction.disabled, false);
  assert.equal(countLabel.textContent, '1 selected');
  assert.equal(await context.addSelectedRequestItemCodeOptions(), true);
  assert.deepEqual(calls.find(call => call[0] === 'submit'), ['submit', selectedRows, sourceRow]);
  const layout = read('assets/ops-precision-pilot.css');
  assert.match(layout, /request-av-option-card-shell \.app-card-qty-row[^\n]*repeat\(3,minmax\(0,1fr\)\)/);
});

test('Invariant 167 (Menu Uses the Compact Uniform Drawer Contract)', async () => {
  const { JSDOM } = await import('jsdom');
  const html = read('index.html');
  const dom = new JSDOM(html);
  try {
    const drawer = dom.window.document.getElementById('side-drawer');
    assert.ok(drawer);
    assert.equal(drawer.querySelector('#live-data-freshness'), null);
    assert.ok(drawer.querySelector('.drawer-header #drawer-user-name'));
    assert.ok(drawer.querySelector('.drawer-header #drawer-user-role'));
    assert.ok(drawer.querySelector('#drawer-quick-actions .drawer-action-tile'));
    for (const section of ['field-inventory', 'sales-orders-docks', 'management-production-qc']) {
      const group = drawer.querySelector(`[data-drawer-section="${section}"]`);
      assert.ok(group, section);
      assert.ok(group.querySelector('[data-drawer-section-title]'));
      for (const row of group.querySelectorAll('.drawer-item')) assert.equal(row.classList.contains('drawer-item'), true);
    }
    assert.equal(drawer.querySelectorAll('#drawer-disease-pest-btn').length, 1);
    assert.ok(drawer.querySelector('[data-drawer-section="field-inventory"] [data-drawer-action="bloom-picker"]'));
    assert.ok(drawer.querySelector('#drawer-preferences-security'));
    assert.ok(drawer.querySelector('#drawer-footer #drawer-logout-btn'));
  } finally { dom.window.close(); }
});

test('Invariant 168 (Cold Row Patches Cannot Establish Base Hydration)', async () => {
  const states = { master: { fullLoaded: false, rowCompleteness: 'unknown' } };
  let rows = 0, owner = 'alice', loads = 0;
  const applied = [];
  const ctx = runFunctions('assets/app-runtime.js', ['getRowPatchDatasetKey', 'resetPendingRowPatchesForOwner', 'isRowPatchSourceReady', 'bufferRowPatchUntilHydrated', 'replayHydratedRowPatches'], {
    pendingRowPatchesBySource: new Map(), coldSourceHydrations: new Map(), pendingRowPatchOwner: '',
    getDatasetKeysForTable: () => ['master'], getDatasetState: key => states[key], getDatasetRenderRowCount: () => rows,
    getSupabaseReadIdentityScope: () => owner, hydrateColdSource: async () => { loads++; },
    applyRowSyncSnapshot: snapshot => applied.push(snapshot), applyUniversalLiveSyncPatch: (_source, payload) => applied.push(payload),
  });
  const patch = { kind: 'realtime', payload: { eventType: 'UPDATE', new: { unique_id: 'm-168', qty: 8 } } };
  assert.equal(ctx.bufferRowPatchUntilHydrated('ph_master_inventory', patch), true);
  assert.equal(loads, 1); assert.equal(states.master.fullLoaded, false);
  ctx.replayHydratedRowPatches(); assert.equal(applied.length, 0);
  states.master.fullLoaded = true; states.master.rowCompleteness = 'complete';
  ctx.replayHydratedRowPatches(); assert.equal(applied.length, 0, 'an empty base is still not ready');
  rows = 9553; ctx.replayHydratedRowPatches(); assert.equal(applied.length, 1);
  assert.equal(ctx.pendingRowPatchesBySource.size, 0);
  rows = 0; ctx.bufferRowPatchUntilHydrated('ph_master_inventory', patch);
  owner = 'bob'; rows = 9553; ctx.replayHydratedRowPatches();
  assert.equal(applied.length, 1, 'account switching discards the previous owner buffer');
});

test('Invariant 169 (Cold Hydration Joins One Full Load And Repaints After Completion)', async () => {
  let resolve, loads = 0, renders = 0, rows = 0;
  const state = { fullLoaded: false, rowCompleteness: 'unknown' };
  const ctx = runFunctions('assets/app-runtime.js', ['hydrateColdSource'], {
    coldSourceHydrations: new Map(), resetPendingRowPatchesForOwner: () => 'owner', getSupabaseReadIdentityScope: () => 'owner',
    canUseProductionLiveSync: () => true, getDatasetState: () => state, getDatasetRenderRowCount: () => rows,
    ensureDatasetLoaded: (_key, mode, options) => { loads++; assert.equal(mode, 'full'); assert.equal(options.bypassLiveSyncCoordinator, true); return new Promise(r => { resolve = r; }); },
    replayHydratedRowPatches() {}, rebuildMasterInventoryIndexes() {}, invalidateResolvedViewStateCaches() {}, TRACKED_VIEW_IDS: ['managers', 'docks', 'detail'], markViewDirty() {},
    scheduleProductionLiveSyncRender: () => { renders++; },
  });
  const first = ctx.hydrateColdSource('master'), second = ctx.hydrateColdSource('master');
  assert.equal(loads, 1); assert.equal(renders, 0);
  rows = 9553; state.fullLoaded = true; state.rowCompleteness = 'complete'; resolve(true);
  assert.equal(await first, true); assert.equal(await second, true); assert.equal(renders, 1);
});

test('Invariant 170 (Requester Picker Is Complete And Role Scoped)', () => {
  const ctx = runFunctions('assets/app-runtime.js', ['isRequestRepRoleValue', 'normalizeRequestRepUserOption',
    'dedupeRequestModalRepUsers', 'getAllowedRequestModalRepOptions', 'getRequestModalVisibleOptions',
    'buildRequestModalMoreResultsHtml'], {
    REQUEST_MODAL_OPTION_PAGE_SIZE: 20, requestModalVisibleOptionLimits: new Map(), requestModalRepUserOptions: [],
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? '',
    normalizeRoleAccessToken: value => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''),
    normalizePushUsername: value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
    normalizeRepDisplayOrder: value => String(value || '').trim().replace(/\b\w/g, char => char.toUpperCase()),
    normalizeRequestSalesrepId: value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''),
    buildRequestModalRepOption: (label, meta) => { const token = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); return { label, token, collapsedToken: token.replace(/\s+/g, ''), ...meta }; },
    getRequestMappedRepDirectory: () => ({ options: [{ label: 'Kevin Effinger', salesrepId: 'S-K1', salesrepIds: ['S-K1'] }] }),
  });
  const rows = [
    { username: 'chris_evans', role: 'CSR' }, { username: 'claudia_castillo', role: 'Sales Office' },
    { username: 'dan_mcendree', role: 'Manager' }, { username: 'ignored_eval', role: 'Evaluator' },
    { username: 'ignored_qc', role: 'QC' },
  ].map(row => ctx.normalizeRequestRepUserOption(row)).filter(Boolean);
  ctx.requestModalRepUserOptions = ctx.dedupeRequestModalRepUsers([...rows, ...rows]);
  const allowed = Array.from(ctx.getAllowedRequestModalRepOptions());
  const labels = allowed.map(option => option.label).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(labels, ['Claudia Castillo', 'Chris Evans', 'Dan Mcendree', 'Kevin Effinger'].sort((a, b) => a.localeCompare(b)));
  const visible = ctx.getRequestModalVisibleOptions('rep:all', Array.from({ length: 73 }, (_, id) => ({ id })));
  assert.equal(visible.shown, 73); assert.equal(ctx.buildRequestModalMoreResultsHtml(visible), '');
});

test('Invariant 171 (Reclass Modal Starts With Item Identity And Location Cards)', () => {
  const created = { innerHTML: '', setAttribute() {} };
  const ctx = runFunctions('assets/app-runtime.js', ['ensureArgosInventoryTransactionModal'], {
    document: { getElementById: () => null, createElement: () => created, body: { appendChild() {} } },
  });
  const modal = ctx.ensureArgosInventoryTransactionModal();
  assert.match(modal.innerHTML, /argos-inventory-transaction-title/);
  assert.match(modal.innerHTML, /argos-reclass-item-inquiry/);
  assert.doesNotMatch(modal.innerHTML, /argos-inventory-transaction-(?:subtitle|notice|source)|argos-tx-tabs/);
  const runtime = read('assets/app-runtime.js');
  assert.match(runtime, /titleEl\.textContent = `\$\{snapshot\.commonName \|\| ''\} \$\{snapshot\.contSize \|\| ''\}`/);
  const styles = read('assets/app-shell-style-05.css');
  assert.match(styles, /\.argos-reclass-row-toggle\{min-height:6rem;padding:1\.125rem 1\.25rem\}/);
  assert.match(styles, /\.argos-reclass-row-toggle-copy>span:first-child\{font-size:1\.25rem/);
});

test('Invariant 172 (Eval Reclass Is Assigned Only At Every UI Boundary)', () => assertGoldenEvalReclassBoundaries({runFunctions,functionSource,read}));

test('Invariant 173 (Cloud Order History Owns Imports And Incremental Average Publication)', async () => {
  const { runSocHistorySyncStep } = await import('../supabase/functions/_shared/erp-history-sync.mjs');
  const files = ['history-a', 'history-b'].map((id, index) => ({ id, name: `SOC 2026-09-2${index + 5}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    modifiedTime: `2026-09-2${index + 6}T00:00:00Z`, createdTime: `2026-09-2${index + 5}T20:00:00Z`, size: '512' }));
  let downloads = 0;
  const fetcher = async url => {
    if (String(url).includes('/files?')) return { ok: true, json: async () => ({ files }) };
    downloads += 1; throw new Error('unchanged finalized history must not be downloaded');
  };
  const calls = [];
  const supabase = { rpc: async (name, args) => {
    calls.push({ name, args }); return { data: { run_id: 'active-history', complete: true, active: true }, error: null };
  } };
  const result = await runSocHistorySyncStep({ supabase, fetcher, token: 'test-token' });
  assert.equal(result.done, true);
  assert.equal(result.result.outcome, 'UP_TO_DATE');
  assert.equal(downloads, 0);
  assert.deepEqual(calls.map(call => call.name), ['begin_eval_item_low_stock_import_v1']);
  assert.deepEqual(calls[0].args.p_manifest.map(file => file.source_revision),
    files.map(file => `${file.modifiedTime}|soc-history-v1`));

  const api = read('supabase/functions/app-api/index.ts');
  assert.doesNotMatch(functionSource('supabase/functions/app-api/index.ts','processCloudErpSyncStep'), /runSocHistorySyncStep/);
  assert.match(api, /operationalOnly: true/);
  const code = read('Code.gs');
  const worker = code.match(/function runSocOrderHistoryBackfillChunk_\(\) \{[^]*?^}/m)?.[0] || '';
  assert.match(worker, /status: 'cloud_owned'/);
  assert.doesNotMatch(worker, /DriveApp|callSupabaseRpc_|scheduleSocOrderHistoryTrigger_\(/);
  const trigger = [{ getHandlerFunction: () => 'runSocOrderHistoryBackfillChunk_' }];
  const context = vm.createContext({ SOC_ORDER_HISTORY_TRIGGER: 'runSocOrderHistoryBackfillChunk_', ScriptApp: {
    getProjectTriggers: () => trigger,
    deleteTrigger: value => { const index = trigger.indexOf(value); if (index >= 0) trigger.splice(index, 1); },
  } });
  vm.runInContext(`${code.match(/function scheduleSocOrderHistoryTrigger_\([^]*?^}/m)?.[0]}\n${worker}\nthis.result=runSocOrderHistoryBackfillChunk_();`, context);
  assert.equal(context.result.status, 'cloud_owned');
  assert.equal(trigger.length, 0);
});

test('Invariant 174 (Cold Master Preview Precedes Eight-Way Complete Snapshot With Server Page Caps)', async () => {
  let active = 0, peak = 0, previewAt = 0, firstRows = 0, countFinished = false;
  const started = performance.now(), total = 54322;
  const ctx = runFunctions('assets/app-runtime.js', ['fetchAllInventoryReadRows'], {
    canUseProductionLiveSync: () => true, yieldToUiFrame: async () => {},
    fetchAuthenticatedSupabaseReadPage: async (table, query, options) => {
      assert.equal(table, 'ph_master_inventory'); assert.equal(query, 'select=unique_id&limit=1'); assert.equal(options.count, true);
      await new Promise(resolve => setTimeout(resolve, 25)); countFinished = true; return { total };
    },
    fetchInventoryReadPage: async (_operation, _params, requested, offset) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      const size = Math.min(requested, 1000, total - offset);
      return { rows: Array.from({ length: size }, (_, index) => ({ unique_id: 'row-' + (offset + index) })),
        total: null, hasMore: size === requested, projection: 'full', fieldCoverage: 'full', columns: ['unique_id'] };
    },
  });
  const rows = await ctx.fetchAllInventoryReadRows('master_page', { dataset: 'master', projection: 'full' }, {
    sharedSnapshotOwner: true, limit: 5000, pageConcurrency: 8, requireComplete: true,
    onFirstPage: rows => { firstRows = rows.length; previewAt = performance.now(); assert.equal(active, 0); assert.equal(countFinished, false); },
  });
  assert.equal(firstRows, 1000, 'publish the actual server-capped first page immediately');
  assert.ok(previewAt - started < 1000, 'the bounded Node fixture publishes a preview within one second');
  assert.equal(peak, 8); assert.equal(rows.length, total); assert.equal(rows.readMeta.total, total);
  assert.equal(rows.readMeta.rowCompleteness, 'complete'); assert.equal(new Set(rows.map(row => row.unique_id)).size, total);
});

test('Invariant 175 (Authenticated Login Starts Master And SOC Before Permission Waits)', () => {
  const started = [];
  const ctx = runFunctions('assets/app-runtime.js', ['ensureColdOperationalHydration'], {
    canUseProductionLiveSync: () => true, hydrateColdSource: key => { started.push(key); return new Promise(() => {}); },
  });
  ctx.ensureColdOperationalHydration('home');
  assert.deepEqual(started, ['master', 'soc', 'requests', 'suspendTag', 'warehouseAssignedItems']);
  const login = functionSource('assets/app-runtime.js', 'finalizeLogin');
  assert.ok(login.indexOf("ensureColdOperationalHydration('home')") < login.indexOf('await Promise.all([capabilitiesTask, accessTask])'));
  const denied = runFunctions('assets/app-runtime.js', ['ensureColdOperationalHydration'], {
    canUseProductionLiveSync: () => false, hydrateColdSource: () => { throw new Error('Unauthenticated fetch'); },
  });
  denied.ensureColdOperationalHydration('home');
});

test('Invariant 176 (Cancelled Cold Hydration Releases Its Shared Loading Promise)', async () => {
  const pending = new Map();
  const ctx = runFunctions('assets/app-runtime.js', ['hydrateColdSource'], {
    coldSourceHydrations: pending, resetPendingRowPatchesForOwner: () => 'owner', getSupabaseReadIdentityScope: () => 'owner',
    canUseProductionLiveSync: () => true, getDatasetState: () => ({ fullLoaded: false }), getDatasetRenderRowCount: () => 0,
    ensureDatasetLoaded: async () => { throw Object.assign(new Error('cancelled'), { code: 'REQUEST_ABORTED' }); },
  });
  assert.equal(await ctx.hydrateColdSource('master'), false); assert.equal(pending.size, 0);
  assert.match(functionSource('assets/app-runtime.js', 'ensureDatasetLoaded'), /finally\(\(\) => \{\s*state\.fullPromise = null/);
});

test('Invariant 177 (Heavy Reads Require An Authenticated Owner And Retain Same-Account Flights)', async () => {
  let sessionLookups = 0, networkReads = 0;
  const unauthenticated = runFunctions('assets/app-runtime.js', ['hasAuthenticatedOperationalReadIdentity', 'fetchDirectPostgrestReadPage'], {
    WAREHOUSE_ASSIGNED_ITEMS_TABLE: 'ph_inventory_row_assignments', SUPABASE_READ_TIMEOUT_MS: 1000,
    SUPABASE_KEY: 'fixture-key', SUPABASE_URL: 'https://fixture.invalid', currentUser: '', nativeAuthReadRequired: false,
    nativeAuthSessionActive: false, nativeAuthProfile: null, normalizeAppTableName: value => value,
    getRequestCapabilityUsernameKey: value => String(value || '').trim().toLowerCase(), getCurrentAppSessionToken: () => '',
    readPersistedAppSessionRecord: () => null, getNativeAuthRequestHeaders: async () => { sessionLookups++; return null; },
    window: { GncDatabase: { fetchTable: async () => { networkReads++; throw new Error('pre-login network read'); } } },
  });
  for (const table of ['ph_master_inventory', 'ph_customer_consignee_sales_reps', 'ph_soc_master', 'ph_inventory_row_assignments', 'ph_warehouse_assigned_items']) {
    await assert.rejects(unauthenticated.fetchDirectPostgrestReadPage(table), { code: 'DATASET_AUTH_REQUIRED' }, table);
  }
  assert.equal(sessionLookups, 0); assert.equal(networkReads, 0);

  const authenticated = runFunctions('assets/app-runtime.js', ['hasAuthenticatedOperationalReadIdentity'], {
    currentUser: 'dylan_collyge', nativeAuthReadRequired: true, nativeAuthSessionActive: true,
    nativeAuthProfile: { id: 'profile-1', username: 'dylan_collyge' }, appAccessSnapshotState: { status: 'loading' },
    getRequestCapabilityUsernameKey: value => String(value || '').trim().toLowerCase(),
  });
  assert.equal(authenticated.hasAuthenticatedOperationalReadIdentity(), true, 'same-account reads do not wait for access readiness');

  let resolveRead;
  const readPromise = new Promise(resolve => { resolveRead = resolve; });
  const readContext = runFunctions('assets/app-runtime.js', [
    'getSupabaseReadIdentityScope', 'abortSupabaseReadsBeforeGeneration', 'getSupabaseReadCooldownKey',
    'getSupabaseReadTerminalKey', 'staleSupabaseReadScopeError', 'runDedupeSupabaseRead',
  ], {
    coalescedProductionRenderScheduler: null,
    AbortController,
    SUPABASE_URL: 'https://fixture.invalid', nativeAuthSessionActive: true, nativeAuthProfile: { id: 'profile-1' },
    currentUser: 'dylan_collyge', currentRole: 'admin', currentUserDivision: '10', productionLiveSyncReadAuthEpoch: 1,
    productionLiveSyncReadGeneration: 1, getCurrentLoginCacheScopeKey: () => 'account-1',
    supabaseReadLatestByKey: new Map(), supabaseReadInFlight: new Map(), supabaseReadTerminalDenials: new Map(),
    supabaseReadFailureCooldowns: new Map(), incrementInternalPerfCounter() {}, runSupabaseReadTask: task => task(),
    runSupabaseReadWithBackoff: (_key, task) => task(), redactEvalSensitiveData: value => value,
  });
  let transportSignal;
  const first = readContext.runDedupeSupabaseRead('all:customer-map', ({ signal }) => { transportSignal = signal; return readPromise; }, { retainOnGenerationChange: true });
  await Promise.resolve();
  readContext.productionLiveSyncReadGeneration++;
  readContext.abortSupabaseReadsBeforeGeneration();
  const second = readContext.runDedupeSupabaseRead('all:customer-map', () => assert.fail('duplicate transport'), { retainOnGenerationChange: true });
  assert.equal(transportSignal.aborted, false); assert.strictEqual(first, second);
  resolveRead(['current-account-rows']);
  assert.deepEqual(await first, ['current-account-rows']);

  let resolveStaleRead;
  const stalePromise = new Promise(resolve => { resolveStaleRead = resolve; });
  let staleSignal;
  const staleRead = readContext.runDedupeSupabaseRead('all:customer-map-after-account-change', ({ signal }) => {
    staleSignal = signal; return stalePromise;
  }, { retainOnGenerationChange: true });
  await Promise.resolve();
  readContext.currentUser = 'another_user';
  readContext.productionLiveSyncReadAuthEpoch++;
  readContext.productionLiveSyncReadGeneration++;
  readContext.abortSupabaseReadsBeforeGeneration();
  assert.equal(staleSignal.aborted, true, 'identity changes still abort retained transports');
  resolveStaleRead(['stale-account-rows']);
  await assert.rejects(staleRead, { code: 'DATASET_READ_SCOPE_CHANGED' });

  const runtime = read('assets/app-runtime.js');
  assert.match(runtime, /retainOnGenerationChange: true/);
  assert.match(runtime, /identityScope !== getSupabaseReadIdentityScope\(\)/);
});

test('Invariant 178 (Denied Push Permission Help Is User-Initiated, Not Startup-Opened)', async () => {
  let enrollmentCallback = null, helpCount = 0, warningCount = 0;
  const ctx = runFunctions('assets/app-runtime.js', ['scheduleCellularPushEnrollment', 'manuallyEnablePushNotifications'], {
    cellularPushEnrollmentTimer: null, currentUser: 'dylan_collyge', pushBlockedNoticeShown: false,
    Notification: { permission: 'denied' }, document: { hidden: false }, navigator: { userAgent: 'Desktop Chrome' },
    isPushSupported: () => true, getPushPromptUserScope: () => 'dylan_collyge:profile',
    maybeWarnPushPermissionBlocked: () => { warningCount++; }, showPushPermissionHelp: () => { helpCount++; },
    setTimeout: callback => { enrollmentCallback = callback; return 1; }, clearTimeout() {},
  });
  ctx.scheduleCellularPushEnrollment('login', 0);
  assert.equal(typeof enrollmentCallback, 'function');
  await enrollmentCallback();
  assert.equal(warningCount, 1, 'background enrollment may retain the nonmodal permission warning');
  assert.equal(helpCount, 0, 'startup enrollment must not open the help modal');

  await ctx.manuallyEnablePushNotifications();
  assert.equal(helpCount, 1, 'an explicit Menu Enable Notifications action retains the help flow');
  const schedule = functionSource('assets/app-runtime.js', 'scheduleCellularPushEnrollment');
  assert.doesNotMatch(schedule, /showPushPermissionHelp\(\)/);
  assert.match(functionSource('assets/app-runtime.js', 'manuallyEnablePushNotifications'), /showPushPermissionHelp\(\)/);
});

test('Invariant 179 (Eval Redaction Preserves Safe Array Read Metadata)', async () => {
  const ctx = runFunctions('assets/app-runtime.js', [
    'isEvalSensitiveDataRestricted', 'redactEvalSensitiveData', 'getSupabaseReadIdentityScope',
    'getSupabaseReadCooldownKey', 'getSupabaseReadTerminalKey', 'staleSupabaseReadScopeError', 'runDedupeSupabaseRead',
  ], {
    AbortController,
    SUPABASE_URL: 'https://fixture.invalid', nativeAuthSessionActive: true,
    nativeAuthProfile: { id: 'eval-profile', username: 'taylor_eval', role: 'Evaluator' },
    currentUser: 'taylor_eval', currentRole: 'Evaluator', safeRole: 'Evaluator', currentUserDivision: '10',
    productionLiveSyncReadAuthEpoch: 1, productionLiveSyncReadGeneration: 1,
    getCurrentLoginCacheScopeKey: () => 'eval-account',
    supabaseReadLatestByKey: new Map(), supabaseReadInFlight: new Map(), supabaseReadTerminalDenials: new Map(),
    supabaseReadFailureCooldowns: new Map(), incrementInternalPerfCounter() {},
    runSupabaseReadTask: task => task(), runSupabaseReadWithBackoff: (_key, task) => task(),
  });
  const sourceRows = [{ unique_id: 'row-1', COMMONNAME: 'Plant', list_price: 42, revenue: 84 }];
  Object.defineProperty(sourceRows, 'readMeta', { value: { total: 1, rowCompleteness: 'complete', fieldCoverage: 'full', columns: ['unique_id', 'list_price'], search: 'sensitive' } });
  const rows = await ctx.runDedupeSupabaseRead('all:ph_master_inventory', async () => sourceRows, { retainOnGenerationChange: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].list_price, undefined);
  assert.equal(rows[0].revenue, undefined);
  assert.equal(rows.readMeta.total, 1);
  assert.equal(rows.readMeta.rowCompleteness, 'complete');
  assert.equal(rows.readMeta.fieldCoverage, 'full');
  assert.equal(rows.readMeta.search, undefined);
});

const createColdHydrationJoinFixture = (identity, getIdentity) => buildColdHydrationJoinFixture(runFunctions,identity,getIdentity);

test('Invariant 180 (cold full hydration is shared across Home and coordinator callers)', async () => {
  const homeContext = functionSource('assets/app-runtime.js', 'getProductionLiveSyncContext');
  const homeFallback = homeContext.slice(homeContext.indexOf("if (view === 'home'"), homeContext.indexOf('const hasDataCohort'));
  assert.match(homeFallback, /getProductionCoreLiveProjection\('master', view, foregroundContext\)/,
    'Home fallback must use the canonical projection selector while a cold full master load is active');
  assert.match(homeFallback, /createProductionCoreLiveAdapter\('master', projection/);

  const loaderSource = functionSource('assets/app-runtime.js','getOwnedColdDatasetLoad');
  assert.match(functionSource('assets/app-runtime.js','ensureDatasetLoaded'),/getOwnedColdDatasetLoad\(key,mode\)[\s\S]*?ensureCoordinatedDataset/);
  assert.match(loaderSource, /coldSourceHydrations\.has\(key\)[\s\S]*?ownerIdentity !== owner[\s\S]*?state\.fullPromise\.then/,
    'the coordinator path must join the same owner’s in-flight cold full promise before creating another adapter');
  assert.match(functionSource('assets/app-runtime.js', 'hydrateColdSource'),
    /Object\.defineProperty\(promise, 'ownerIdentity', \{ value: owner/,
    'the cold promise must carry its identity owner for safe joining');

  const sameOwner = createColdHydrationJoinFixture('account-a');
  assert.equal(sameOwner.calls(), 0, 'same-owner cold full load joins without starting a coordinator request');
  sameOwner.resolveFull(true);
  assert.equal(await sameOwner.promise, true, 'joined caller receives the cold full result');

  let currentOwner = 'account-a';
  const stale = createColdHydrationJoinFixture('account-a',() => currentOwner);
  currentOwner = 'account-c';
  stale.resolveFull(true);
  assert.equal(await stale.promise,false,'an identity change while awaiting the cold promise discards its result');
  assert.equal(stale.calls(),0,'stale cold work is not replaced by a second coordinator fetch');

  const assignmentReader = functionSource('assets/app-runtime.js', 'fetchAllSupabaseRows');
  assert.match(assignmentReader, /identityScopedAssignmentRead = String\(table \|\| ''\)\.trim\(\) === WAREHOUSE_ASSIGNED_ITEMS_TABLE/,
    'the physical assignment table must share its canonical full-snapshot query across callers');
  const routed = [];
  const routing = runFunctions('assets/app-runtime.js', ['fetchAllSupabaseRows'], {
    REQUEST_HISTORY_TABLE: 'history', SALES_CREDIT_REQUESTS_TABLE: 'credits', WAREHOUSE_ASSIGNED_ITEMS_TABLE: 'ph_inventory_row_assignments',
    runDedupeSupabaseRead: (_key, _task, options) => { routed.push(options); return Promise.resolve([]); },
  });
  const signal = new AbortController().signal;
  await routing.fetchAllSupabaseRows('ph_inventory_row_assignments', 'select=*', { signal });
  assert.equal(routed[0].signal, null); assert.equal(routed[0].retainOnGenerationChange, true);
  await routing.fetchAllSupabaseRows('ph_soc_master', 'select=*', { signal, retainOnGenerationChange: true });
  assert.equal(routed[1].signal, null); assert.equal(routed[1].retainOnGenerationChange, true);
  await routing.fetchAllSupabaseRows('ph_soc_master', 'select=*', { signal });
  assert.equal(routed[2].signal, signal); assert.equal(routed[2].retainOnGenerationChange, false);
});

test('Invariant 181 (Assigned History Shares Four Bounded Parallel Batches And Rejects Missing Codes)', async () => {
  let active = 0, peak = 0, calls = 0, omitCode = false;
  const ctx = runFunctions('assets/app-runtime.js', ['fetchManagerItemLowStockTargets', 'normalizeManagerItemLowStockTargetCode', 'runDedupeSupabaseRead'], {
    AbortController, SUPABASE_READ_TIMEOUT_MS: 1000, productionLiveSyncReadGeneration: 1,
    getSupabaseReadIdentityScope: () => 'same-account',
    getSupabaseReadCooldownKey: (owner, key) => owner + key,
    getSupabaseReadTerminalKey: (owner, key) => owner + key,
    supabaseReadInFlight: new Map(), supabaseReadLatestByKey: new Map(), supabaseReadTerminalDenials: new Map(),
    supabaseReadFailureCooldowns: new Map(), incrementInternalPerfCounter() {},
    runSupabaseReadTask: task => task(), runSupabaseReadWithBackoff: (_key, task) => task(),
    redactEvalSensitiveData: value => value,
    supabaseRpc: async (name, body, options) => {
      assert.equal(name, 'get_eval_item_low_stock_targets_v1');
      assert.ok(body.p_itemcodes.length <= 500); assert.equal(options.signal.aborted, false);
      calls++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 3)); active--;
      return body.p_itemcodes.filter(code => !omitCode || code !== 'CODE-0000').map(itemcode_normalized => ({ itemcode_normalized, mean_quantity: 12.5 }));
    },
  });
  const codes = Array.from({ length: 2101 }, (_, index) => 'CODE-' + String(index).padStart(4, '0'));
  const [first, second] = await Promise.all([ctx.fetchManagerItemLowStockTargets(codes), ctx.fetchManagerItemLowStockTargets(codes.slice().reverse())]);
  assert.equal(calls, 5, 'UI and coordinator share one request set despite source ordering');
  assert.equal(peak, 4); assert.equal(first.length, codes.length); assert.equal(second.length, codes.length);
  assert.equal(new Set(first.map(row => row.itemcode_normalized)).size, codes.length);
  assert.equal((await ctx.fetchManagerItemLowStockTargets([])).length, 0); assert.equal(calls, 5);
  omitCode = true;
  await assert.rejects(ctx.fetchManagerItemLowStockTargets(codes), /omitted 1 requested ItemCode summaries/);
});

test('Invariant 182 (cold reads and revision metadata survive view generations but remain identity fenced)', async () => {
  const runtime = read('assets/app-runtime.js');
  const coldLoader = functionSource('assets/app-runtime.js', 'hydrateColdSource');
  assert.match(coldLoader, /retryOnCancellation: true,\s*retainOnGenerationChange: true/);
  const datasetLoader = runtime.slice(runtime.indexOf('async function ensureDatasetLoaded'), runtime.indexOf('function queueDatasetLoad'));
  assert.match(datasetLoader, /options\.retainOnGenerationChange === true \? \{ retainOnGenerationChange: true \} : \{\}/,
    'explicit cold-read retention must reach generic full dataset fetches');
  const genericReader = functionSource('assets/app-runtime.js', 'fetchAllSupabaseRows');
  assert.match(genericReader, /signal: identityScopedAssignmentRead \|\| identityScopedOperationalRead \|\| opts\.retainOnGenerationChange === true \? null/,
    'explicitly retained generic reads must detach their initiating view signal');

  let owner = 'same-account';
  let callCount = 0;
  const transportSignals = [];
  const dedupeOptions = [];
  const ctx = runFunctions('assets/app-runtime.js', ['supabaseRpc'], {
    APP_API_FUNCTION_URL: '/app-api',
    assertEvalDataSourceAllowed() {},
    getSupabaseReadIdentityScope: () => owner,
    staleSupabaseReadScopeError: () => Object.assign(new Error('stale identity'), { code: 'STALE_SCOPE' }),
    runDedupeSupabaseRead: async (key, task, options) => {
      callCount += 1; dedupeOptions.push({ key, ...options });
      return task({ signal: new AbortController().signal });
    },
    SUPABASE_URL: 'https://fixture.test', getNativeAuthRequestHeaders: async () => ({ Authorization: 'Bearer native' }),
    window: { GncDatabase: { fetchRpc: async (_url, _rpc, options) => {
      transportSignals.push(options.signal);
      return Response.json({ accepted: JSON.parse(options.body).p_dataset_keys });
    } } },
  });
  const external = new AbortController();
  const result = await ctx.supabaseRpc('get_my_dataset_revisions_v1', {
    p_dataset_keys: [' ph_soc_master ', 'ph_master_inventory', 'ph_soc_master'],
  }, { signal: external.signal });
  assert.deepEqual(Array.from(result.accepted), ['ph_master_inventory', 'ph_soc_master']);
  assert.equal(callCount, 1);
  assert.equal(dedupeOptions[0].key, 'dataset-revisions:["ph_master_inventory","ph_soc_master"]');
  assert.equal(dedupeOptions[0].signal, null, 'a view cancellation cannot abort the shared revisions transport');
  assert.equal(dedupeOptions[0].retainOnGenerationChange, true, 'navigation/permission generation changes retain same-account metadata work');
  assert.ok(transportSignals[0] instanceof AbortSignal);

  const preAborted = new AbortController(); preAborted.abort();
  await assert.rejects(ctx.supabaseRpc('get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master'] }, { signal: preAborted.signal }),
    error => error?.code === 'REQUEST_ABORTED');
  assert.equal(callCount, 1, 'an already-cancelled caller must not start the network request');

  let releaseTransport;
  const fenced = runFunctions('assets/app-runtime.js', ['supabaseRpc'], {
    APP_API_FUNCTION_URL: '/app-api', assertEvalDataSourceAllowed: () => {},
    getSupabaseReadIdentityScope: () => owner,
    staleSupabaseReadScopeError: () => Object.assign(new Error('stale identity'), { code: 'STALE_SCOPE' }),
    runDedupeSupabaseRead: (_key, task) => task({ signal: new AbortController().signal }),
    SUPABASE_URL: 'https://fixture.test', getNativeAuthRequestHeaders: async () => ({ Authorization: 'Bearer native' }),
    window: { GncDatabase: { fetchRpc: () => new Promise(resolve => { releaseTransport = resolve; }) } },
  });
  const pending = fenced.supabaseRpc('get_my_dataset_revisions_v1', { p_dataset_keys: ['ph_soc_master'] });
  await new Promise(resolve => setImmediate(resolve));
  owner = 'different-account';
  releaseTransport(Response.json({ shouldNotEscape: true }));
  await assert.rejects(pending, error => error?.code === 'STALE_SCOPE', 'a retained response cannot cross an account change');

  let readOwner = 'owner-a';
  let generation = 1;
  let factoryCalls = 0;
  let finishFirstRead;
  const readCtx = runFunctions('assets/app-runtime.js', ['runDedupeSupabaseRead'], {
    AbortController,
    productionLiveSyncReadGeneration: generation,
    getSupabaseReadIdentityScope: () => readOwner,
    getSupabaseReadCooldownKey: (identity, key) => `${identity}:${key}`,
    getSupabaseReadTerminalKey: (identity, key) => `${identity}:${key}`,
    supabaseReadInFlight: new Map(), supabaseReadLatestByKey: new Map(),
    supabaseReadTerminalDenials: new Map(), supabaseReadFailureCooldowns: new Map(),
    incrementInternalPerfCounter() {},
    runSupabaseReadTask: task => task(), runSupabaseReadWithBackoff: (_key, task) => task(),
    redactEvalSensitiveData: value => value,
    staleSupabaseReadScopeError: () => Object.assign(new Error('stale read'), { code: 'STALE_SCOPE' }),
  });
  const coldRead = readCtx.runDedupeSupabaseRead('all:ph_soc_master:select=*', () => {
    factoryCalls += 1; return new Promise(resolve => { finishFirstRead = resolve; });
  }, { retainOnGenerationChange: true });
  generation += 1;
  readCtx.productionLiveSyncReadGeneration = generation;
  const coordinatorRead = readCtx.runDedupeSupabaseRead('all:ph_soc_master:select=*', () => {
    factoryCalls += 1; return Promise.resolve('duplicate');
  });
  assert.equal(factoryCalls, 1, 'ordinary coordinator callers join a retained same-owner cold transport across generations');
  finishFirstRead('shared');
  assert.equal(await coldRead, 'shared');
  assert.equal(await coordinatorRead, 'shared');

  readOwner = 'owner-b';
  let finishSecondRead;
  const otherAccountRead = readCtx.runDedupeSupabaseRead('all:ph_soc_master:select=*', () => {
    factoryCalls += 1; return new Promise(resolve => { finishSecondRead = resolve; });
  });
  assert.equal(factoryCalls, 2, 'a different account cannot join the previous owner’s retained result');
  finishSecondRead('owner-b');
  assert.equal(await otherAccountRead, 'owner-b');
});

test('Invariant 183 (Authenticated Inventory And Operational Reads Survive Caller Navigation)', async () => {
  let owner = 'account-a', finish, transportSignal, readCount = 0;
  const internal = new AbortController();
  const ctx = runFunctions('assets/app-runtime.js', ['requestInventoryRead'], {
    productionLiveSyncCoordinator: null, SUPABASE_READ_TIMEOUT_MS: 1000, APP_API_FUNCTION_URL: 'https://fixture.invalid',
    appAccessSnapshotState: { snapshot: { dataPermissionVersion: 'v1' } },
    getSupabaseReadIdentityScope: () => owner, hasAuthenticatedOperationalReadIdentity: () => true,
    staleSupabaseReadScopeError: () => new Error('owner changed'), suspendProductionInventoryReadForReadiness() {},
    runDedupeSupabaseRead: (_key, task, options) => {
      assert.equal(options.signal, null); assert.equal(options.retainOnGenerationChange, true);
      readCount++; return task({ signal: internal.signal });
    },
    postAppFunctionJson: async (_url, _body, options) => { transportSignal = options.signal; return new Promise(resolve => { finish = resolve; }); },
  });
  const caller = new AbortController();
  const pending = ctx.requestInventoryRead('master_page', { dataset: 'avOpen' }, { signal: caller.signal });
  assert.equal(transportSignal, internal.signal); caller.abort(); assert.equal(transportSignal.aborted, false);
  finish({ ok: true, data: { rows: [] } }); assert.equal((await pending).rows.length, 0);
  await assert.rejects(ctx.requestInventoryRead('master_page', {}, { signal: caller.signal }), /cancelled/); assert.equal(readCount, 1);
  const stale = ctx.requestInventoryRead('master_page', {}); owner = 'account-b';
  finish({ ok: true, data: { rows: [] } }); await assert.rejects(stale, /owner changed/);
  let routed;
  const snapshots = runFunctions('assets/app-runtime.js', ['fetchAllSupabaseRows'], {
    REQUEST_HISTORY_TABLE: 'history', SALES_CREDIT_REQUESTS_TABLE: 'credits', WAREHOUSE_ASSIGNED_ITEMS_TABLE: 'assignments',
    hasAuthenticatedOperationalReadIdentity: () => true,
    runDedupeSupabaseRead: (_key, _task, options) => { routed = options; return Promise.resolve([]); },
  });
  await snapshots.fetchAllSupabaseRows('ph_sales_office', 'select=*', { signal: new AbortController().signal });
  assert.equal(routed.signal, null); assert.equal(routed.retainOnGenerationChange, true);
});

test('Invariant 184 (master CSV contract decodes exact text, null, numeric and timestamp values)', () => {
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(read('assets/inventory-list-contract.js'), context);
  const contract = context.module.exports;
  assert.equal(contract.physicalColumns.length, 218, 'CSV support leaves the audited physical projection unchanged');
  const columns = ['unique_id', 'commonname', 'loc_match_pct', 'last_updated', 'av_note'];
  const decoded = contract.decodeCsvRows('unique_id,commonname,loc_match_pct,last_updated,av_note\n'
    + 'row-a,"Rose, ""Maple""\nTree",0.25,2026-10-29 12:30:45.123456+00,""\n'
    + 'row-b,,,,""', columns);
  assert.equal(decoded.length, 2);
  assert.equal(decoded[0].commonname, 'Rose, "Maple"\nTree');
  assert.equal(decoded[0].loc_match_pct, 0.25);
  assert.equal(decoded[0].last_updated, '2026-10-29T12:30:45.123456+00:00');
  assert.equal(decoded[1].commonname, null);
  assert.equal(decoded[1].loc_match_pct, null);
  assert.equal(decoded[1].last_updated, null);
  assert.equal(decoded[1].av_note, '');
  assert.throws(() => contract.decodeCsvRows('unique_id,unknown\nrow-a,x', columns), /unexpected CSV header/);
  assert.throws(() => contract.decodeCsvRows('unique_id,commonname,loc_match_pct,last_updated,av_note\nrow-a,Rose,0.25', columns), /unexpected CSV row width/);
});

test('Invariant 185 (typed master CSV bridge validates before returning cached rows)', async () => {
  const bridge = databaseBridge(async () => new Response('unique_id\nrow-1\n', {headers:{'content-type':'text/csv'}}), (text,columns) => {
    assert.deepEqual([...columns],['unique_id']); return [{unique_id:'row-1'}];
  });
  assert.equal(bridge.supportsInventoryCsv,true);
  const response = await bridge.fetchTable('https://example.com','ph_master_inventory','select=unique_id',{headers:{accept:'text/csv'}},100,'master');
  assert.deepEqual(response.__gncValidatedData,[{unique_id:'row-1'}]);
  assert.equal(await response.text(),'unique_id\nrow-1\n');
});

test('Invariant 186 (Drive and AV open LOCATION for reviewed negative and stopped rows)', () => {
  const ctx=runFunctions('assets/app-runtime.js',['getPrimaryDetailTabForItemContext','formatInventoryHoldSince'],{
    activeDetailSourceView:'',lastView:'',activeTaskTab:'',activeAVTab:'reserves',firstNonEmptyValue:(...values)=>values.find(v=>v!==undefined&&v!==null&&v!==''),Date
  });
  for(const source of ['drive','av']) for(const row of [{PTRREVIEWED:12,PTRAVAILABLE:-2,HOLDSTOPCODE:'S'},{DATE_COMPLETED:'2026-10-29',APP_TAB_ASSIGNMENT:'season'}]) assert.equal(ctx.getPrimaryDetailTabForItemContext(row,source),'location');
  assert.equal(ctx.formatInventoryHoldSince(46259),'8/25/2026');
  assert.equal(ctx.formatInventoryHoldSince('1/1/46259'),'8/25/2026');
});

test('Invariant 187 (Suspend photo proof survives navigation but never an account change)', () => assertSuspendPhotoAccountProof({runFunctions,functionSource}));

test('Invariant 188 (Reclass metrics occupy their own full-width unbroken row)', () => {
  const css=read('assets/app-shell-style-05.css');
  assert.match(css,/\.argos-reclass-row-toggle\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;[^}]*height:74px/);
  assert.match(css,/\.argos-reclass-row-toggle-meta\{grid-column:1\/-1;display:grid;width:100%;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/\.argos-reclass-row-toggle-meta span\{[^}]*white-space:nowrap/);
  const html=read('assets/app-runtime.js');
  assert.ok(html.indexOf('<span class="argos-reclass-row-toggle-meta">${metrics}</span></button>')>0);
});

test('Invariant 189 (Suspend colors distinguish dates across weeks and print Plan Start)', () => {
  const rows=[{PLANSTART:'10/26/2026'},{PLANSTART:'11/02/2026'},{PLANSTART:'11/03/2026'}];
  const ctx=runFunctions('assets/app-runtime.js',['parseDockCardPlanStartEpochDay','getDockSuspendDcRequestPlanstartInfo','formatDockCardPlanStartValue'],{
    socInventory:rows,DOCK_SUSPEND_PLANSTART_ALIASES:['PLANSTART'],getDockSuspendDcRequestPlanstartValue:row=>row.PLANSTART,isDockSuspendDcRequestRowAnyStatus:()=>true,Date,Intl
  });
  assert.equal(new Set(rows.map(row=>ctx.getDockSuspendDcRequestPlanstartInfo(row).tone)).size,2);
  assert.equal(ctx.getDockSuspendDcRequestPlanstartInfo(rows[0]).tone,ctx.getDockSuspendDcRequestPlanstartInfo(rows[1]).tone);
  assert.equal(ctx.getDockSuspendDcRequestPlanstartInfo(rows[2]).tone,'tuesday');
  assert.equal(ctx.formatDockCardPlanStartValue(rows[0].PLANSTART),'10/26/2026');
  assert.match(read('assets/request-inventory-card.js'), /suspend-planstart-badge">SUSPEND TAG · Plan Start/);
});

test('Invariant 190 (Suspend lot fallback stays at the same physical location and source)', () => {
  const ctx=vm.createContext({});vm.runInContext(read('assets/queue-inventory-hydration.js'),ctx);
  const rows=[{UNIQUE_ID:'sh',ITEMCODE:'003566.051.1',LOCATIONCODE:'A.06.000',LOTCODE:'27.S1',SOURCE:'SH',PTRONHAND:160,PTRAVAILABLE:160,PTRREVIEWED:0,S_LTS:264,LOC_MATCH_QTY:64,PHOTO_LINK:'sh.jpg'},
    {UNIQUE_ID:'ld',ITEMCODE:'003566.051.1',LOCATIONCODE:'A.06.000',LOTCODE:'27.S1',SOURCE:'LD',PTRONHAND:104,PTRAVAILABLE:104,PTRREVIEWED:0,S_LTS:264,LOC_MATCH_QTY:8,PHOTO_LINK:'ld.jpg'}];
  const index=ctx.AgMetricQueueInventory.createIndex(rows);
  const missing=index.resolveSuspendTagDisplay({itemcode:'003566.051.1',locationcode:'A.06.000',lotcode:'27.F1',source:'SH'});
  assert.equal(missing.row,null, 'a different lot never becomes a physical-row receipt');
  const result=index.resolveSuspendTagDisplay({masterUid:'sh',itemcode:'003566.051.1',locationcode:'A.06.000',lotcode:'27.S1',source:'SH'});
  assert.equal(result.row.PTRONHAND,160);assert.equal(result.row.LOC_ON_HAND,264);assert.equal(result.row.PHOTO_LINK,'sh.jpg');assert.equal(result.row.LOC_MATCH_QTY,64);
  assert.equal(index.resolveSuspendTagDisplay({itemcode:'003566.051.1',locationcode:'0.00.111',lotcode:'27.F1'}).status,'missing');
});

test('Invariant 191 (Bloom opens project creation directly with all grading fields)', () => bloomProjectContract(runFunctions,read));

test('Invariant 192 (Suspend AV has one action and no nested Reclass card)', () => {
  const source=['renderRequestMatchingInventoryOptions','renderLegacyRequestAvOptions','renderRequestAvOptionCard'].map(name=>functionSource('assets/app-runtime.js',name)).join('\n');
  assert.ok(source.includes('suspendFillTag ? `<div class="suspend-av-option-evidence">'));
  assert.ok(source.includes('+ ADD SELECTED LOCATION(S) TO TAG'));
  assert.ok(!source.includes('${suspendFillTag && addButtonHtml ? addButtonHtml'));
  const api=runFunctions('supabase/functions/_shared/suspend-tag.ts',['handleSuspendTag'],{
    exports:{},SUSPEND_TAG_EDITORS:new Set(['dylan_collyge']),SUSPEND_TAG_AUTHORIZED_ROLES:new Set(['ADMIN']),jsonValue:value=>value,
  },true);
  return api.handleSuspendTag({rpc:async(name,args)=>{assert.equal(name,'suspend_tag_command_v1');assert.equal(args.p_payload.sourceIdentity.dock,'36');return {data:{ok:true,rows:[]}};}},
    {id:'actor',username:'dylan_collyge',role:'Admin'}, {operation:'add_candidates',expectedVersion:0,payload:{sourceUid:'tag',sourceIdentity:{dock:'36'},inventoryIds:['master']}}).then(result=>assert.equal(result.ok,true));
});

test('Invariant 193 (Suspend edit receipts accept newer sources and concurrent photos without relaxing send confirmation)', () => {
  const source = functionSource('assets/app-runtime.js', 'runSuspendTagRowCommand');
  const receipt = source.slice(source.indexOf('const editableOperation ='), source.indexOf('const receiptRow ='));
  const run = (operation, row, patch = {}) => vm.runInNewContext(receipt, { operation, result: {ok:true,row}, sourceUid:'old-source', expectedRevision:'old-revision', options:{}, photoOnly:Object.keys(patch).length>0, patch, getDockSuspendCompletionRevision:r=>r.last_updated });
  const row = {unique_id:'current-source',last_updated:'current-revision',suspend_tag_version:4,suspend_tag_status:'pending',dock_photo_link:'old,new'};
  assert.doesNotThrow(()=>run('save',row,{dock_photo_link:'new'}));
  assert.throws(()=>run('save',{...row,dock_photo_link:'old'},{dock_photo_link:'new'}),/did not confirm/);
  assert.throws(()=>run('send',row),/did not confirm/);
  assert.doesNotThrow(()=>run('complete',{...row,suspend_tag_status:'completed',date_completed:'2026-10-29T12:00:00Z'}));
});

test('Invariant 194 (Release migration transaction envelope is accepted by the canonical publisher)', async () => {
  const { migrationBody } = await import('../scripts/apply-item-low-stock-migration.mjs');
  const source = read('supabase/migrations/20261029210000_agdata_v23107_row_workflows.sql');
  const body = migrationBody(source);
  assert.match(body, /CREATE OR REPLACE FUNCTION public\.create_inventory_project_v1/);
  assert.throws(() => migrationBody('-- misplaced comment\n' + source), /TRANSACTION_REQUIRED/);
  assert.equal(migrationBody(body), body);
  assert.throws(() => migrationBody(body + '\ncommit;'), /TRANSACTION_REQUIRED/);
});

test('Invariant 195 (Suspend fractional Excel serials retain calendar dates and distinct days)', () => {
  const api = runFunctions('assets/app-runtime.js', ['parseDockCardPlanStartEpochDay', 'formatDockCardPlanStartValue']);
  assert.equal(api.formatDockCardPlanStartValue('46329.333333333328'), '11/03/2026');
  assert.equal(api.formatDockCardPlanStartValue('46330.75'), '11/04/2026');
  assert.equal(api.parseDockCardPlanStartEpochDay('invalid'), null);
});

test('Invariant 196 (Numeric master evidence crosses typed PATCH as text with authorization intact)', async () => {
  const input = { match:100, initial_ptr:-2, loc_match_qty:0, spec:'22-26" H' };
  const browser = runFunctions('assets/app-runtime.js', ['normalizeSupabaseWriteBodyForTable','stripSupabaseWriteFields'], { ACTIVE_REQUEST_TABLE:'ph_requests_pending' });
  assert.deepEqual(plain(browser.normalizeSupabaseWriteBodyForTable('ph_master_inventory','PATCH',input)), {match:'100',initial_ptr:'-2',loc_match_qty:'0',spec:'22-26" H'});
  let writes = 0, permitted = true;
  const api = runFunctions('supabase/functions/app-api/index.ts', ['handleDb'], {
    URLSearchParams, normalizeTableName:value=>value, protectCustomerRequestDbWrite:()=>null,
    hasTableWriteAccess:()=>permitted, AV_OPTION_EVAL_REQUESTS_TABLE:'other',
    restRequest:async(table,method,query,body)=>{ writes++; assert.deepEqual(plain(body),{match:'100',initial_ptr:'-2',loc_match_qty:'0',spec:'22-26" H'}); return {ok:true}; },
    readResponsePayload:async()=>null, jsonResponse:value=>({status:200,...value}), errorResponse:(error,status)=>({error,status})
  });
  assert.equal((await api.handleDb({role:'Admin',username:'actor'},{table:'ph_master_inventory',method:'PATCH',query:'unique_id=eq.row-0',body:input})).status,200);
  assert.equal((await api.handleDb({role:'Admin',username:'actor'},{table:'ph_master_inventory',method:'PATCH',query:'itemcode=eq.item',body:input})).status,400);
  permitted = false;
  assert.equal((await api.handleDb({role:'User',username:'actor'},{table:'ph_master_inventory',method:'PATCH',body:input})).status,403);
  assert.equal(writes,1);
});

test('Invariant 197 (Suspend item hydration survives navigation and rejects changed accounts)', async () => {
  let owner = 'account-a', resolve;
  const pending = new Promise(done => { resolve = done; });
  const context = { console, Date, URLSearchParams, Map, Set,
    hasCompleteRequestOptionSnapshot:()=>false, getManagerAssignedColumnState:()=>({}), suspendTagItemHydration:new Map(), queueCardInventoryRenderVersion:0,
    getSupabaseReadIdentityScope:()=>owner, hasAuthenticatedOperationalReadIdentity:()=>true,
    getRequestItemCodeOptionItemCode:item=>item.ITEMCODE,
    fetchRequestItemCodeOptionRowsFromSupabase:()=>pending,
    runDedupeSupabaseRead:(key,fn,options)=>{assert.equal(options.retainOnGenerationChange,true);assert.equal(options.signal,null);return fn({signal:undefined});},
    fetchAuthenticatedSupabaseReadPage:async()=>({rows:[{unique_id:'exact-master',source:'LD',itemcode:'item',locationcode:'A.06.000',lotcode:'27.S1',spec:'22-26" H'}]}),
    formatFetchedRows:rows=>rows, buildSearchIndex:row=>row, normalizeRowPhotoFields:row=>row,
    window:{AgMetricQueueInventory:{createIndex:rows=>({rows})}}, markViewDirty:()=>{}, isViewVisible:()=>false
  };
  const api=runFunctions('assets/app-runtime.js',['hydrateSuspendTagItemOptions'],context);
  api.hydrateSuspendTagItemOptions([{ITEMCODE:'item'}]);
  const entry=context.suspendTagItemHydration.get('item');
  resolve([{unique_id:'exact-master',source:'LD',itemcode:'item',locationcode:'A.06.000',lotcode:'27.S1',ptronhand:'160'}]);
  await entry.promise;
  assert.equal(entry.rows[0].spec,'22-26" H'); assert.equal(entry.rows[0].ptronhand,'160');
  context.suspendTagItemHydration.clear();
  api.hydrateSuspendTagItemOptions([{ITEMCODE:'item'}]);
  const discarded=context.suspendTagItemHydration.get('item'); owner='account-b';
  await discarded.promise;
  assert.equal(discarded.rows.length,0);
});

test('Invariant 198 (Scoped location notes are registered in the browser database contract)', async () => {
  let reads=0;
  const bridge=databaseBridge(async(url,init)=>{ reads++; assert.equal(init.method,'GET'); assert.match(url,/ph_location_sales_notes/); return new Response(JSON.stringify([{unique_id:'exact-master',source:'LD',itemcode:'item',locationcode:'A.06.000',lotcode:'27.S1',spec:'22-26" H',updated_at:'2026-10-29T12:00:00Z'}]),{status:200}); });
  const response=await bridge.fetchTable('https://example.test','ph_location_sales_notes','select=unique_id,source,itemcode,locationcode,lotcode,spec,updated_at&itemcode=eq.item&limit=1000',{method:'GET'},1000,'notes');
  assert.equal(response.status,200); assert.equal(reads,1);
});

test('Invariant 199 (Optional location notes cannot discard successful master item hydration)', async () => {
  const entries=new Map();
  const api=runFunctions('assets/app-runtime.js',['hydrateSuspendTagItemOptions'],{
    console:{warn(){}}, Date, Map, Set, hasCompleteRequestOptionSnapshot:()=>false, getManagerAssignedColumnState:()=>({}), suspendTagItemHydration:entries, queueCardInventoryRenderVersion:0,
    getSupabaseReadIdentityScope:()=> 'actor',hasAuthenticatedOperationalReadIdentity:()=>true,
    getRequestItemCodeOptionItemCode:item=>item.ITEMCODE,
    fetchRequestItemCodeOptionRowsFromSupabase:async()=>[{itemcode:'item',locationcode:'A.06.000',lotcode:'27.S1',ptronhand:'160',spec:'22-26" H'}],
    runDedupeSupabaseRead:(key,fn)=>fn({}),fetchAuthenticatedSupabaseReadPage:async()=>{throw Error('Notes unavailable');},
    formatFetchedRows:rows=>rows, buildSearchIndex:row=>row,normalizeRowPhotoFields:row=>row,
    window:{AgMetricQueueInventory:{createIndex:rows=>({rows})}},markViewDirty:()=>{},isViewVisible:()=>false
  });
  api.hydrateSuspendTagItemOptions([{ITEMCODE:'item'}]); await entries.get('item').promise;
  assert.equal(entries.get('item').rows[0].ptronhand,'160'); assert.equal(entries.get('item').rows[0].spec,'22-26" H');
});

test('Invariant 200 (Stale Suspend lot retains physical-row quantities and the complete location total)', () => {
  const row={PTRONHAND:264,PTRREVIEWED:0,PTRAVAILABLE:264,LOC_ON_HAND:264};
  const index={resolveSuspendTagDisplay:()=>({matchLevel:'item-location',row:{...row}}),resolveDisplay:()=>({row:{PTRONHAND:160,PTRREVIEWED:0,PTRAVAILABLE:160}})};
  const api=runFunctions('assets/app-runtime.js',['getSuspendTagMetricDisplayFallback','resolveTargetedSuspendMetricFallback'],{
    window:{AgMetricQueueInventory:{identity:value=>({itemCode:value.ITEMCODE,locationCode:value.LOCATIONCODE,source:value.SOURCE||''})}},isDockSuspendDcRequestMirrorRow:()=>true,
    suspendTagItemHydration:new Map([['item',{owner:'actor',index,rows:[{ITEMCODE:'item',LOCATIONCODE:'A.06.000',PTRONHAND:104,PTRAVAILABLE:104,PTRREVIEWED:0},{ITEMCODE:'item',LOCATIONCODE:'A.06.000',PTRONHAND:160,PTRAVAILABLE:160,PTRREVIEWED:0}]}]]),getRequestItemCodeOptionItemCode:()=> 'item',
    getSupabaseReadIdentityScope:()=> 'actor',findDockSuspendDcRequestSourceRow:row=>row,getSuspendTagInventoryIdentity:row=>row,
    firstNonEmptyValue:(...values)=>values.find(value=>value!==null&&value!==undefined&&value!=='')
  });
  const result=api.getSuspendTagMetricDisplayFallback({ITEMCODE:'item',LOCATIONCODE:'A.06.000',LOTCODE:'27.F1'});
  assert.equal(result.row.PTRONHAND,160);assert.equal(result.row.PTRAVAILABLE,160);assert.equal(result.row.LOC_ON_HAND,264);
});


test('Invariant 201 (Opening Suspend AV paints once and never schedules a second checkbox-tree replacement)', () => {
  let renders=0; const delayed=[]; const item={UNIQUE_ID:'tag'};
  const api=runFunctions('assets/app-runtime.js',['openDockSuspendDcRequestUpdate'],{
    activeItem:item,activeDetailSourceView:'request',lastView:'request',requestAvOptionsDropdownOpen:false,
    findDockSuspendDcRequestMirrorRowByUniqueId:()=>item,isDockSuspendDcRequestMirrorRow:()=>true,
    canReadSuspendQueue:()=>true,canUseRequestSuspendTagAssignedToFilter:()=>true,hydrateSuspendTagItemOptions:()=>{},retryPendingSuspendTagInventoryReconciliations:()=>{},
    firstNonEmptyValue:(...values)=>values.find(value=>value!==null&&value!==undefined&&value!==''),
    openDetail:(uid,view,options)=>{assert.equal(options.skipRequestOpenInfoModal,true);},ensureRequestItemCodeOptionState:()=>({}),
    renderRequestMatchingInventoryOptions:()=>{renders++;},syncRequestDetailScrollMode:()=>{},syncSuspendFillTagDetailAction:()=>{},
    setTimeout:callback=>delayed.push(callback)
  });
  api.openDockSuspendDcRequestUpdate('tag',{openAvOptions:true}); assert.equal(renders,1);
  delayed.forEach(callback=>callback()); assert.equal(renders,1); assert.equal(api.requestAvOptionsDropdownOpen,true);
});


test('Invariant 202 (Hetzi evaluation saves and snapshots isolate every lot and source in Drive and AV)', () => {
  const first=(...values)=>values.find(value=>value!==null&&value!==undefined&&value!=='');
  const rows=['28.F1','28.S1','26.U3','27.U3','27.Y','28.Y','28.F1'].map((lot,i)=>({UNIQUE_ID:'row-'+i,ITEMCODE:'000180.008.1',LOCATIONCODE:'L.05.000',LOTCODE:lot,SOURCE:i===2||i===6?'HL':'LD',SOURCE_TABLE:'ph_master_inventory'}));
  const av=rows.map(row=>({...row}));
  const keys=['PHOTO_LINK','SPEC','MATCH','AV_NOTE'];
  const api=runFunctions('assets/app-runtime.js',['applyRowSyncSnapshot','syncRowDataAcrossViews','getMasterInventoryExactKey','buildNcrCurrentCropInheritancePayload','inventoryPhotoLocationKey','findLinkedMasterRow'],{
    fullInventory:rows,avOpenInventory:av,masterInventoryById:new Map(rows.map(row=>[row.UNIQUE_ID,row])),masterInventoryByExactKey:new Map(),masterInventoryByNormalizedItemLocation:new Map(),
    window:{GncDatabase:{driveEvidenceRevision:()=>0}},firstNonEmptyValue:first,getMasterInventorySourceCode:row=>row.SOURCE||row.source||'',
    isDockSuspendDcRequestMirrorRow:()=>false,bufferRowPatchUntilHydrated:()=>false,findItemByUniqueId:id=>rows.find(row=>row.UNIQUE_ID===id),findRequestRowByUniqueId:()=>null,
    FLYER_FOLDER_ROWS_TABLE:'flyer',MASTER_EVIDENCE_SYNC_KEYS:keys,EXACT_ROW_SYNC_KEYS:keys,LINKED_ROW_SYNC_KEYS:[],
    getInventoryCardItemLocationKey:()=>'',getCardPtrOnHandValue:()=>0,isRowScopedDesignationSyncKey:()=>false,
    repairDisplayFieldsOnRow:()=>{},normalizeFlyerShadowFields:()=>{},normalizeRowPhotoFields:row=>row,syncSharedFlyerPhotoFields:()=>{},buildSearchIndex:row=>row,
    isFlyerFolderRow:()=>false,syncMasterFieldsToRow:(from,to,fields)=>fields.forEach(key=>{to[key]=from[key];}),shouldIncludeMasterItemInAvSeasonView:()=>true,rebuildInventoryByIdMap:()=>new Map(),
    lowStockInventory:[],managerReviewInventory:[],moveUpInventory:[],salesOfficeInventory:[],socInventory:[],reservesInventory:[],requestsInventory:[],flyerFolderInventory:[],activeItem:null
  });
  const patch={PHOTO_LINK:'f1-photo-1,f1-photo-2,f1-photo-3',SPEC:'16-18" H',MATCH:60,AV_NOTE:'F1 ONLY'};
  assert.equal(api.applyRowSyncSnapshot({uniqueId:'row-0',masterUniqueId:'row-1',sourceTable:'ph_master_inventory',data:patch}),true);
  for(const collection of [rows,av]) {
    for(const key of keys) assert.equal(collection[0][key],patch[key]);
    for(const sibling of collection.slice(1)) for(const key of keys) assert.equal(sibling[key],undefined);
  }
  for(const sibling of rows.slice(1)) assert.equal(api.buildNcrCurrentCropInheritancePayload(rows[0],sibling),null);
  assert.equal(api.findLinkedMasterRow({...rows[1],MASTER_ID:'row-0'}).UNIQUE_ID,'row-1');
  const sql=read('supabase/migrations/20261029230000_agdata_v23109_strict_row_evidence.sql');
  assert.match(sql,/add primary key\(source_unique_id\)/);
  assert.match(sql,/add primary key\(unique_id\)/);
  assert.match(sql,/where m.unique_id=btrim\(p_master_uid\)/);
  assert.match(sql,/where m.unique_id=new.unique_id/);
  assert.match(sql,/on e.source_unique_id=m.unique_id/);
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'),/agdataV23109StrictRowEvidenceMigrationName/);
});


test('Invariant 203 (Reclass confirms exact rows and validated immutable submissions before dispatch)', () => {
  const state = { snapshot: {}, submitting: false };
  const row = { unique_id: 'row-26', expected: { locationcode: 'L.05.000', lotcode: '26.U3', ptronhand: '293' }, proposals: [{ action: 'move_down', splits: [{ quantity: 50, destinationSeason: 'F1' }] }] };
  let payload = { rowOverlays: [row], transaction: { holdStopProposals: [] } };
  const prompts = [], sent = [], focused = [], errors = [];
  const api = runFunctions('assets/app-runtime.js', ['buildArgosReclassSubmissionSummary', 'requestArgosReclassSubmission', 'toggleArgosReclassRowCard'], {
    argosInventoryTransactionState: state, escapeHtml: value => String(value).replaceAll('<', '&lt;'),
    document: { getElementById: () => ({ textContent: 'Hetzi Column Juniper 8 IN.' }) },
    ARGOS_INVENTORY_TRANSACTION_REQUEST_LABELS: { move_down: 'Move Down' }, getReclassActionWorkflowV5Config: () => ({ label: 'Move Down' }),
    getArgosReclassLiveEditIdentityKey: () => 'actor', ensureArgosReclassSubmissionVerification: () => {},
    buildArgosInventoryTransactionPayload: () => JSON.parse(JSON.stringify(payload)), applyArgosInventoryTransactionSourceContext: value => value,
    showArgosReclassConfirmation: (title, summary, accept) => { prompts.push({ title, summary, accept }); return false; },
    submitArgosInventoryTransaction: (...args) => sent.push(['apply', args[1]]), openEvalWorkSetupFromReclass: value => sent.push(['review', value]),
    focusArgosReclassRow: uid => focused.push(uid), getArgosReclassRowEditorEntry: () => ({ values: { locationcode: 'L.05.000', lotcode: '26.U3', ptronhand: 293, ptrreviewed: 0, ptravailable: 293 } }),
    showToast: (...args) => errors.push(args)
  });
  const card = { getAttribute: name => name === 'data-reclass-row-card' ? 'row-26' : 'false' };
  api.toggleArgosReclassRowCard({ closest: () => card });
  assert.deepEqual(focused, ['row-26'], 'the selected exact row opens directly');
  for (const mode of ['apply', 'review']) {
    api.requestArgosReclassSubmission(null, mode);
    const prompt = prompts.at(-1);
    assert.match(prompt.title, /Confirm Reclass Submission/);
    for (const text of ['L.05.000', '26.U3', 'Move Down: 50 → Lot 26.F1', 'Remaining: 243']) assert.ok(prompt.summary.includes(text));
    const before = sent.length; assert.equal(sent.length, before); // Cancel/no acceptance dispatches nothing.
    prompt.accept(); assert.equal(sent.length, before + 1); assert.equal(sent.at(-1)[0], mode);
    assert.deepEqual(plain(sent.at(-1)[1]), payload);
  }
  api.requestArgosReclassSubmission(); payload.rowOverlays[0].proposals[0].splits[0].quantity = 51;
  prompts.at(-1).accept(); assert.equal(sent.length, 2); assert.equal(errors.length, 1);
  api.buildArgosInventoryTransactionPayload = () => { throw new Error('Invalid quantity'); };
  const count = prompts.length; api.requestArgosReclassSubmission(); assert.equal(prompts.length, count);
  assert.match(readComposedAppSource(), /grid-template-columns:88px minmax\(0,1fr\) 36px/);
  assert.match(readComposedAppSource(), /height:50px;min-height:48px;max-height:54px/);
  assert.match(functionSource('assets/app-runtime.js', 'showArgosReclassConfirmation'), /data-reclass-confirm-cancel/);
  assert.match(functionSource('assets/app-runtime.js', 'showArgosReclassConfirmation'), /data-reclass-confirm-ok/);
});


test('Invariant 204 (Bloom project and Reclass controls stay dark-emerald)', () => {
  const runtime = read('assets/app-runtime.js');
  const projectStart = runtime.indexOf('let bloomInventoryProjectDraft');
  const projectEnd = runtime.indexOf('async function submitBloomInventoryProject', projectStart);
  const project = runtime.slice(projectStart, projectEnd);
  assert.ok(projectStart >= 0 && projectEnd > projectStart);
  assert.doesNotMatch(project, /<\/?datalist\b|\blist=/i);
  assert.match(project, /toggleBloomProjectPicker/);
  assert.match(project, /normalizeRepDisplayOrder/);
  assert.match(project, /setBloomProjectPickerOptions/);
  assert.match(runtime, /toggleArgosReclassDestinationMenu/);
  assert.match(runtime, /selectArgosReclassDestination/);
  const shell = readComposedAppSource();
  assert.match(shell, /bloom-picker-actions-list #batch-btn-request/);
  assert.match(shell, /min-height:78px/);
  assert.match(shell, /\.argos-reclass-confirmation::backdrop/);
  assert.match(shell, /rgba\(255,255,255,\.06\)/);
});


test('Invariant 205 (Seven operational datasets share identity-scoped in-flight reads and reject an old owner)', async () => {
  let owner = 'a';
  const ctx = runFunctions('assets/app-runtime.js', ['runDedupeSupabaseRead'], {
    AbortController, productionLiveSyncReadGeneration: 1,
    getSupabaseReadIdentityScope: () => owner,
    getSupabaseReadCooldownKey: (identity, key) => identity + ':' + key,
    getSupabaseReadTerminalKey: (identity, key) => identity + ':' + key,
    supabaseReadInFlight: new Map(), supabaseReadLatestByKey: new Map(),
    supabaseReadTerminalDenials: new Map(), supabaseReadFailureCooldowns: new Map(),
    incrementInternalPerfCounter() {}, runSupabaseReadTask: task => task(),
    runSupabaseReadWithBackoff: (_key, task) => task(), redactEvalSensitiveData: value => value,
    staleSupabaseReadScopeError: () => Object.assign(new Error('stale'), { code: 'STALE_SCOPE' })
  });
  for (const key of ['ph_master_inventory', 'ph_soc_master', 'ph_active_suspend', 'ph_reserves', 'ph_warehouse_assigned_items', 'ph_location_sales_notes', 'app_dataset_revisions']) {
    let complete; let reads = 0;
    const task = () => { reads++; return new Promise(resolve => { complete = resolve; }); };
    const first = ctx.runDedupeSupabaseRead(key, task);
    assert.equal(ctx.runDedupeSupabaseRead(key, task), first);
    assert.equal(reads, 1); complete(key); assert.equal(await first, key);
  }
  let releaseOld;
  const old = ctx.runDedupeSupabaseRead('ph_master_inventory', () => new Promise(resolve => { releaseOld = resolve; }));
  owner = 'b';
  const next = ctx.runDedupeSupabaseRead('ph_master_inventory', async () => 'new');
  assert.notEqual(old, next); assert.equal(await next, 'new');
  releaseOld('old'); await assert.rejects(old, { code: 'STALE_SCOPE' });
});

test('Invariant 206 (Unchanged revision polls do not mutate state and a changed revision still commits)', async () => {
  const context = { module: { exports: {} }, setTimeout: () => 1, clearTimeout() {}, AbortController };
  vm.runInNewContext(read('assets/agdata-kernel.js'), context);
  vm.runInNewContext(read('assets/live-sync-coordinator.js'), context);
  let revision = '1', connected = 0, reads = 0, commits = 0;
  const adapter = { id: 'soc', cacheKey: 'soc/all', sourceKeys: ['ph_soc_master'], stage: async () => { reads++; return []; }, commit: () => { commits++; } };
  const coordinator = context.AgMetricLiveSync.createCoordinator({
    getContext: () => ({ scope: 'same-account', viewKey: 'docks', visible: true, online: true, adapters: [adapter] }),
    readRevisions: async keys => ({ contractVersion: 1, permissionVersion: 'p1', sources: keys.map(key => ({ key, revision, state: 'ready' })) }),
    onRevisionRead: () => { connected++; }, setTimeout: () => 1, clearTimeout() {}
  });
  await coordinator.check(); await coordinator.check(); await coordinator.check();
  assert.deepEqual([connected, reads, commits], [1, 1, 1]);
  revision = '2'; await coordinator.check();
  assert.deepEqual([connected, reads, commits], [2, 2, 2]);
  assert.equal(context.AgDataKernel.sync.shouldAcceptRevision('2', '2', true), true, 'row deltas remain actionable');
});

test('Invariant 207 (Same-tick active renders coalesce and navigation or reset discards stale callbacks)', () => {
  const ctx = { module: { exports: {} } }; vm.runInNewContext(read('assets/agdata-kernel.js'), ctx);
  let active = 'drive'; const jobs = [], rendered = [], dirty = [];
  const scheduler = ctx.AgDataKernel.sync.createViewRenderScheduler({ getActiveView: () => active, enqueue: fn => jobs.push(fn), markDirty: view => dirty.push(view) });
  scheduler.scheduleCoalescedViewRender('drive', () => rendered.push('old'));
  scheduler.scheduleCoalescedViewRender('drive', () => rendered.push('latest'));
  scheduler.scheduleCoalescedViewRender('request', () => rendered.push('hidden'));
  assert.equal(jobs.length, 1); jobs.shift()(); assert.deepEqual(rendered, ['latest']);
  assert.equal(scheduler.dirtyViews.has('request'), true);
  scheduler.scheduleCoalescedViewRender('drive', () => rendered.push('departed'));
  active = 'request'; jobs.shift()(); assert.deepEqual(rendered, ['latest']);
  scheduler.scheduleCoalescedViewRender('request', () => rendered.push('old-account'));
  scheduler.reset(); jobs.shift()(); assert.deepEqual(rendered, ['latest']);
  assert.ok(dirty.includes('request'));
});


test('Invariant 208 (Blocked origins preserve complete shells and verified native login, with a loopback mirror)', () => invariant208({read, rootPathForMirror}));
function rootPathForMirror() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); }


test('Invariant 209 (Signed detached relay owns active sync while browser start and foreground remain bounded)', async () => {
  const tasks = [], calls = [];
  const relay = runFunctions('supabase/functions/app-api/index.ts', ['dispatchCloudErpSync'], {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', ERP_SYNC_CLOUD_WORKER_KEY: 'private-worker',
    EdgeRuntime: { waitUntil: task => tasks.push(task) }, AbortSignal, Date, Promise,
    setTimeout: callback => { callback(); return 0; }, recordHandledError() {},
    fetch: async (url, options) => { calls.push({ url, ...options, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ claimed: true }) }; }
  });
  await relay.dispatchCloudErpSync({ runId: 'durable-run' }, 0); await Promise.all(tasks);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://example.supabase.co/functions/v1/app-api');
  assert.deepEqual(plain(calls[0].body), { action: 'erp_sync', operation: 'continue', runId: 'durable-run', relayHop: 1 });
  assert.equal(calls[0].headers.authorization, 'Bearer private-worker');
  relay.dispatchCloudErpSync({ runId: 'durable-run' }, 40); assert.equal(calls.length, 1);
  const { validateErpSyncCommand } = await import('../supabase/functions/_shared/erp-sync.mjs');
  assert.equal(validateErpSyncCommand({ action: 'erp_sync', operation: 'status', autoRelay: false }).ok, true);
  assert.equal(validateErpSyncCommand({ action: 'erp_sync', operation: 'status', autoRelay: 'false' }).ok, false);
  let wakes = 0;
  const status = runFunctions('supabase/functions/app-api/index.ts', ['handleErpSyncAction'], {
    validateErpSyncCommand, jsonObject: value => value, jsonResponse: value => value,
    supabase: { rpc: async () => ({ data: { active: true, runId: 'durable-run' } }) }, dispatchCloudErpSync: () => { wakes++; }
  });
  await status.handleErpSyncAction({}, { operation: 'status', autoRelay: false }, {}); assert.equal(wakes, 0);
  await status.handleErpSyncAction({}, { operation: 'status' }, {}); assert.equal(wakes, 1);
  const auth = runFunctions('supabase/functions/app-api/index.ts', ['handleErpSyncContinuation'], {
    ERP_SYNC_CLOUD_WORKER_KEY: 'private-worker', errorResponse: (_message, code) => ({ status: code })
  });
  assert.equal((await auth.handleErpSyncContinuation({ operation: 'continue' }, new Request('https://example.test', {headers:{authorization:'Bearer anon','x-agdata-internal-relay':'1'}}))).status, 401);
  const writes = [], updates = [];
  const client = runFunctions('assets/app-runtime.js', ['runGoogleAppsScriptTrigger', 'continueManualErpSync', 'refreshManualSyncOnForeground'], {
    isRunScriptActive: false, window: {}, currentUser: 'dylan_collyge', document: { hidden: false }, navigator: { onLine: true },
    releaseStaleManualSyncClientStateIfNeeded() {}, canRunManualInventoryImport: () => true, syncGoogleScriptButton() {}, showToast() {},
    getSupabaseReadIdentityScope: () => 'same', getNativeAuthRequestHeaders: async () => ({ Authorization:'Bearer verified' }),
    crypto: { randomUUID: () => 'command' }, MANUAL_SYNC_STAGE_ORDER_CLIENT_DEFAULT: [], APP_API_FUNCTION_URL: '/api',
    applyManualSyncStatus: value => updates.push(value), lastManualSyncStatusCheckedAt: 1,
    postAppFunctionJson: async (_url, body, options) => { writes.push({body,options}); return { ok:true,cloudRelay:true,data:{active:true,runId:'durable-run'} }; },
    refreshManualSyncStatus: async force => { assert.equal(force,true); updates.push('status'); },
    refreshDashboardSyncMetadata: async () => updates.push('metadata'),
    getProductionLiveSyncCoordinator: () => ({ check: async () => updates.push('revisions') }),
    MANUAL_SYNC_SCRIPT_TIMEOUT_MS: 60000, Date, Promise,
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== '')
  });
  await client.runGoogleAppsScriptTrigger(); assert.equal(writes.length,1); assert.equal(writes[0].body.operation,'start');
  assert.equal(writes[0].options.keepalive,true); assert.equal(client.isRunScriptActive,false);
  client.document.hidden=true; await client.continueManualErpSync({runId:'durable-run'}); assert.equal(writes.length,1);
  client.document.hidden=false; assert.equal(client.refreshManualSyncOnForeground(),true);
  assert.ok(updates.includes('status')); assert.ok(updates.includes('metadata')); assert.ok(updates.includes('revisions'));
  const source=read('assets/app-runtime.js');
  assert.match(source,/pageshow[^]*refreshManualSyncOnForeground/);
  assert.match(source,/visibilitychange[^]*refreshManualSyncOnForeground/);
  assert.doesNotMatch(source,/throw new Error\([^\n]*ERP_SYNC_CONTINUE_DEADLINE/);
});


test('Invariant 210 (A slow successor HTTP response cannot consume the current worker lease before heartbeat)', async () => {
  const tasks = []; let issued = false, finishResponse;
  const context = runFunctions('supabase/functions/app-api/index.ts', ['dispatchCloudErpSync'], {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', ERP_SYNC_CLOUD_WORKER_KEY: 'private',
    EdgeRuntime: { waitUntil: task => tasks.push(task) }, AbortSignal, Date, Promise,
    setTimeout: callback => { callback(); return 0; }, recordHandledError() {},
    fetch: () => { issued = true; return new Promise(resolve => { finishResponse = resolve; }); }
  });
  await context.dispatchCloudErpSync({runId:'run'});
  assert.equal(issued,true); assert.equal(tasks.length,1);
  finishResponse({ok:true,json:async()=>({claimed:true})}); await Promise.all(tasks);
});


test('Invariant 211 (Built hotfix module URLs survive precache normalization during blocked reload)', () => invariant211({read, plain}));


test('Invariant 212 (Drive MD5 metadata never enters the SHA-256 fast-skip RPC)', async () => {
  const calls=[];
  const context=vm.createContext({moveProcessed:async()=>{},Date});
  vm.runInContext(['stageFile','stageFileContinuation'].map(name=>functionSource('supabase/functions/_shared/erp-sync.mjs',name).replace(/^export\s+/, '')).join('\n'),context);
  const supabase={rpc:async(name,args)=>{
    assert.equal(name,'check_erp_file_sync_needed_v1');calls.push(args);
    assert.ok(args.p_content_hash===null || /^[a-f0-9]{64}$/.test(args.p_content_hash));
    return {data:{skip:args.p_file_id === 'file'}};
  }};
  const options={supabase,file:{id:'file',name:'Drive.xlsx',modifiedTime:'2026-10-30T12:00:00Z',md5Checksum:'a'.repeat(32)},dataset:'drive_around',maxRowsPerSlice:1000,sliceStartMs:0};
  await context.stageFile(options);await context.stageFileContinuation(options);
  assert.equal(calls.length,2);assert.equal(calls[0].p_modified_at,options.file.modifiedTime);
});

test('Invariant 213 (Drive save receipts resolve masterUid and publish only the exact physical row)', () => {
  const row={UNIQUE_ID:'row-a',ITEMCODE:'005243.031.1',LOCATIONCODE:'D.26.000',LOTCODE:'27.F1',SOURCE:'DRIVE'};
  const sibling={...row,UNIQUE_ID:'row-b',LOTCODE:'26.F1',PHOTO_LINK:'keep.jpg',AV_NOTE:'KEEP'};
  const receipt={ok:true,canonicalConfirmed:true,row:{unique_id:'row-a',itemcode:row.ITEMCODE,locationcode:row.LOCATIONCODE,lotcode:row.LOTCODE,source:'DRIVE',photo_link:'one.jpg,two.jpg,three.jpg',photo_name:'a,b,c',av_note:'FULL BODY / SPEC - 16-18" H'},locationRows:[]};
  const columns=['unique_id','itemcode','locationcode','lotcode','source','photo_link','photo_name','av_note'];
  const context=runFunctions('assets/app-runtime.js',['normalizeDriveEvidenceLocationPart','isSameDriveEvidenceLocation','reconcileConfirmedDriveEvidence',
    'getConfirmedDriveEvidenceRow','applyConfirmedDriveLocationEvidence','reconcileConfirmedDriveMasterRows','updateConfirmedDriveEvidenceState',
    'preserveDriveEvidenceEditor','restoreDriveEvidenceEditor','reapplyPendingEvaluationProjection'],{
    getManagerAssignedColumnState:()=>({}), fullInventory:[row,sibling],masterInventoryById:new Map([[row.UNIQUE_ID,row],[sibling.UNIQUE_ID,sibling]]),activeItem:null,confirmedDriveEvidenceRows:new Map(),
    firstNonEmptyValue:(...values)=>values.find(value=>value!==null&&value!==undefined&&String(value)!==''),
    window:{GncDatabase:{confirmedDriveEvidence:result=>result.row,driveEvidenceColumns:columns}},
    getRequestItemCodeOptionItemCode: value => value.ITEMCODE || value.itemcode || '',
    getSupabaseReadIdentityScope:()=> 'account',formatFetchedRows:rows=>rows.map(raw=>Object.fromEntries(Object.entries(raw).map(([key,value])=>[key.toUpperCase(),value]))),
    getEditorLocMatchQtyValue:()=>null,parseAppNumber:()=>null,setPhotoAliasFieldsForPrefix:(...args)=>Object.assign(args[0],{PHOTO_LINK:args[2],PHOTO_NAME:args[3]}),
    normalizeRowPhotoFields(){},buildSearchIndex(){},buildConfirmedDriveEvidenceState:target=>({...target}),getDatasetKeysForTable:()=>[],
    rebuildMasterInventoryIndexes(){},touchDatasetLoadStateForLocalChange(){},propagateCommittedEdit(){}
  });
  const result=context.reconcileConfirmedDriveEvidence(receipt,row,'ssn-');
  assert.equal(result.row.PHOTO_LINK,'one.jpg,two.jpg,three.jpg');assert.equal(result.row.AV_NOTE,receipt.row.av_note);
  assert.equal(sibling.PHOTO_LINK,'keep.jpg');assert.equal(sibling.AV_NOTE,'KEEP');
  context.activeItem={...row,SOURCE_TABLE:'ph_master_inventory',AV_NOTE:'UNSAVED / SPEC - 18 inches'};
  context.reconcileConfirmedDriveEvidence(receipt,row,'ssn-',{photoOnly:true});
  assert.equal(context.activeItem.AV_NOTE,'UNSAVED / SPEC - 18 inches');
  assert.equal(context.activeItem.PHOTO_LINK,receipt.row.photo_link);
  assert.throws(()=>context.reconcileConfirmedDriveEvidence({...receipt,row:{...receipt.row,unique_id:'other'}},row,'ssn-'),/IDENTITY_MISMATCH/);
});
test('Invariant 214 (Entered AV Note and pending exact-row photos render without waiting for a server receipt)', () => {
  const context=runFunctions('assets/app-runtime.js',['sanitizeAvNoteWithoutSpecCaliper','resolveCanonicalPhotoUrls'],{
    getRowPhotoLink:()=> 'saved.jpg',getPhotoUrlList:value=>value.split(','),resolveAndFormatPhotoDate(){},
    getPendingPhotoPreviewEntries:(row,prefix)=>row.UNIQUE_ID==='row-a'&&prefix==='ssn-'?[{url:'blob:pending'}]:[]
  });
  assert.equal(context.sanitizeAvNoteWithoutSpecCaliper('FULL BODY / SPEC - 16-18" H',{preserveEnteredText:true}),'FULL BODY / SPEC - 16-18" H');
  assert.deepEqual(plain(context.resolveCanonicalPhotoUrls({UNIQUE_ID:'row-a'},'drive')),['saved.jpg','blob:pending']);
  assert.deepEqual(plain(context.resolveCanonicalPhotoUrls({UNIQUE_ID:'row-b'},'drive')),['saved.jpg']);
  assert.match(functionSource('assets/app-runtime.js','populateDetailInputsForPrefix'),/preserveEnteredText: true/);
  assert.match(functionSource('assets/app-runtime.js','persistConfirmedRowEvaluation'),/itemToSave\.AV_NOTE = String\(avEl\.value \?\? ''\)/);
});
test('Invariant 215 (Suspend Plan Start weekday colors are stable across dataset order and calendar representations)', () => weekdayContract(runFunctions, read));
test('Invariant 216 (Assigned Items filters, unique mode, active owners and select-all share one row set)', () => {
  const state={filters:{},sort:null};const selected=new Set();let rows=[{ITEMCODE:'A',PLANTGROUPCODE:'TREE',ASSIGNEDTO:'dylan_collyge'},{ITEMCODE:'A',PLANTGROUPCODE:'TREE',ASSIGNEDTO:'dylan_collyge'},{ITEMCODE:'B',PLANTGROUPCODE:'SHRUB',ASSIGNEDTO:'megan_kelly'}];
  const context=runFunctions('assets/app-runtime.js',['getFilteredManagerAssignedItemsExportRows','getManagerAssignedSelectionSnapshot','selectAllFilteredManagerAssignedItems','getManagerAssignableOwnerUsers'],{
    getManagerAssignedColumnState:()=>state,getManagerAssignedItemsDisplayRows:()=>rows,rememberManagerAssignedColumnLabels(){},getManagerAssignedItemsActiveAssigneeKey:()=> 'all',managersSearchTerm:'',managerEvalAssignmentSelection:selected,
    matchesManagerAssignedColumnFilters:row=>!state.filters.PLANTGROUPCODE||state.filters.PLANTGROUPCODE.includes(row.PLANTGROUPCODE.toLowerCase()),normalizeEvalAssignableUser:value=>String(value||'').toLowerCase(),managerTextMatchesSearch:()=>true,
    buildManagerEvalAssignmentKey:value=>value,sortManagerAssignedColumnRows:value=>value,updateManagerAssignedItemsView(){},scheduleManagersRender(){},
    getAssignableAppUserOptions:()=>[{username:'dylan_collyge'},{username:'new_manager'}],EVAL_ASSIGNMENT_ROSTER_USERS:['ellen_ward','megan_kelly'],evalAssignableUsers:[],EVAL_TASK_INACTIVE_USERS:new Set()
  });
  assert.equal(context.getFilteredManagerAssignedItemsExportRows().length,2);state.viewMode='rows';assert.equal(context.getFilteredManagerAssignedItemsExportRows().length,3);
  state.filters.PLANTGROUPCODE=['tree'];context.selectAllFilteredManagerAssignedItems(true);assert.deepEqual([...selected],['A']);context.selectAllFilteredManagerAssignedItems(false);assert.equal(selected.size,0);
  assert.deepEqual(plain(context.getManagerAssignableOwnerUsers()),['dylan_collyge','megan_kelly','new_manager']);
  const jsx=read('components/assigned-items/AssignedItems.jsx');assert.match(jsx,/data-assigned-select-all-visible/);assert.doesNotMatch(jsx,/Refreshing history|Use suggestion|>Bulk</);
  assert.match(functionSource('assets/app-runtime.js','getManagerAssignedColumnDefinitions'),/PLANTGROUPCODE/);
});
test('Invariant 217 (Home controls retain inline size bounds and expanded sync cards)', () => {
  const html=read('index.html');assert.match(html,/<details open id="dashboard-sync-accordion"/);
  assert.match(html,/#dashboard-print-btn svg\{width:16px;height:16px/);
  assert.match(html,/#dashboard-sync-files\{display:grid!important;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(functionSource('assets/app-runtime.js','syncGoogleScriptButton'),/syncPanel\.open = true/);
});

test('Invariant 218 (AST scope audit rejects undeclared masterUid in every asset and undeclared names in modified runtime functions)', () => invariant218({read, root}));
test('Invariant 219 (loaded assignment controls survive background verification and mobile cards omit removed history)', () => {
  let loaded=true; const state={};
  const context=runFunctions('assets/app-runtime.js',['isManagerAssignedSnapshotCurrent'],{getManagerAssignedColumnState:()=>state,isDatasetLoaded:()=>loaded,useManagerReportPages:()=>false,canUseProductionLiveSync:()=>true,productionLiveSyncVerifiedView:'',productionVerifiedViewKey:()=> 'background-pending'});
  assert.equal(context.isManagerAssignedSnapshotCurrent(),true);loaded=false;assert.equal(context.isManagerAssignedSnapshotCurrent(),false);
  assert.doesNotMatch(read('components/assigned-items/AssignedItems.jsx'),/<History\b/);
});
test('Invariant 220 (revision reads use canonical authenticated PostgREST without Edge compute)', async () => {
  let reads=0;
  const context=runFunctions('assets/app-runtime.js',['supabaseRpc'],{
    assertEvalDataSourceAllowed(){},getSupabaseReadIdentityScope:()=> 'same-account',
    runDedupeSupabaseRead:(_key,work)=>work({signal:null}),getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer native'}),
    SUPABASE_URL:'https://example.test',window:{GncDatabase:{fetchRpc:async(_url,name,options)=>{
      assert.equal(name,'get_my_dataset_revisions_v1');assert.equal(options.headers.Authorization,'Bearer native');reads++;
      return Response.json({contractVersion:1,permissionVersion:'same',sources:[{key:'ph_master_inventory',revision:'7',state:'importing',publishedReadable:true,publishedRevision:'6'}]});
    }}},postAppFunctionJson:()=>{throw new Error('Unexpected Edge read');}
  });
  const result=await context.supabaseRpc('get_my_dataset_revisions_v1',{p_dataset_keys:['ph_master_inventory']});
  assert.equal(reads,1);assert.equal(result.sources[0].publishedRevision,'6');assert.equal(result.permissionVersion,'same');
});
test('Invariant 221 (sync progress never labels failed staging as live publication)', () => {
  const context=runFunctions('assets/app-runtime.js',['erpSyncProgressCards'],{});
  const cards=plain(context.erpSyncProgressCards({sourceProgress:{drive:{fileName:'exact.xlsx',percent:95,rowsParsed:1500,rowsPublished:0}},stageResults:[{key:'drive',outcome:'failed',error:'SQL publication failed',rowCount:1500}]}));
  assert.equal(cards.length,5);assert.equal(cards[0].fileName,'exact.xlsx');assert.equal(cards[0].rowsPublished,0);assert.equal(cards[0].stage,'failed');assert.ok(cards[0].percent<100);
  const published=plain(context.erpSyncProgressCards({stageResults:[{key:'drive',outcome:'processed',rowCount:1500,sourceFileName:'exact.xlsx'}]}));
  assert.equal(published[0].percent,100);assert.equal(published[0].rowsPublished,1500);
});
test('Invariant 222 (local history recovery preserves continuation and stops only after canonical activation)', async () => {
  const {finishPendingHistoryFiles}=await import('../scripts/finish-pending-history-files.mjs');
  let calls=0;const progress=[];
  const result=await finishPendingHistoryFiles({supabase:{},token:'authorized',concurrency:1,onProgress:p=>progress.push(p),runStep:async options=>{
    assert.equal(options.maxRowsPerFile,1000000);calls++;return {done:calls===2,result:{pendingFiles:calls===2?0:1,outcome:calls===2?'processed':'CONTINUE'}};
  }});
  assert.equal(calls,2);assert.equal(result.pendingFiles,0);assert.equal(progress.length,2);
  await assert.rejects(finishPendingHistoryFiles({supabase:{},token:'authorized',concurrency:1,maxSteps:1,runStep:async()=>({done:false,result:{pendingFiles:1}})}),/HISTORY_RECOVERY_STEP_LIMIT/);
  const sql=read('supabase/migrations/20261030180000_agdata_v23116_sync_progress.sql');
  assert.match(sql,/private\.current_active_profile\(\)/);assert.match(sql,/revoke all[^;]*from public,anon/);
  assert.doesNotMatch(sql,/grant[^;]*(?:anon|ph_app_users|user_access_control)/i);
});
test('Invariant 223 (the lightweight receiver retains stale-lease recovery after the workbook sender exits)', () => busyLeaseContract(runFunctions));
test('Invariant 224 (local Drive range recovery verifies every byte and rejects changed or truncated parts)', async () => {
  const {fetchHistoryDriveResource}=await import('../scripts/finish-pending-history-files.mjs');
  const bytes=new Uint8Array(3*1024*1024+17).map((_v,index)=>index%251);let active=0,peak=0;
  const fetcher=async(_url,init)=>{
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));
    const match=init.headers.Range.match(/bytes=(\d+)-(\d+)/),start=Number(match[1]),end=Math.min(bytes.length-1,Number(match[2]));active--;
    return new Response(bytes.slice(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`}});
  };
  const response=await fetchHistoryDriveResource('https://www.googleapis.com/drive/v3/files/exact?alt=media',{},fetcher);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);assert.ok(peak<=4);
  await assert.rejects(fetchHistoryDriveResource('https://www.googleapis.com/drive/v3/files/exact?alt=media',{},async()=>new Response(new Uint8Array(1),{status:206,headers:{'content-range':'bytes 0-2/3'}})),/HISTORY_DOWNLOAD_RANGE_TRUNCATED/);
});
test('Invariant 225 (local history partitions stay bounded and canonical activation follows every partition)', async () => {
  const {finishPendingHistoryFiles}=await import('../scripts/finish-pending-history-files.mjs');
  const finished=new Set();let activated=false;
  const result=await finishPendingHistoryFiles({supabase:{},token:'authorized',runStep:async options=>{
    if(options.filePartition){assert.equal(options.filePartition.count,3);finished.add(options.filePartition.index);return {done:false,result:{partitionComplete:true}};}
    assert.deepEqual([...finished].sort(),[0,1,2]);activated=true;return {done:true,result:{pendingFiles:0}};
  }});
  assert.equal(activated,true);assert.equal(result.pendingFiles,0);
});

test('Invariant 226 (verified completed history retains the exact latest published filename)', async () => {
  const {runSocHistorySyncStep}=await import('../supabase/functions/_shared/erp-history-sync.mjs');
  const files=[
    {id:'older',name:'SOC-older.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',modifiedTime:'2026-10-28T12:00:00Z'},
    {id:'latest',name:'SOC-latest.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',modifiedTime:'2026-10-30T12:00:00Z'}
  ];
  const result=await runSocHistorySyncStep({token:'authorized',fetcher:async()=>Response.json({files}),supabase:{rpc:async name=>{
    assert.equal(name,'begin_eval_item_low_stock_import_v1');return {data:{run_id:'verified',complete:true,active:true}};
  }}});
  assert.equal(result.done,true);assert.equal(result.result.outcome,'UP_TO_DATE');assert.equal(result.result.sourceFileName,'SOC-latest.xlsx');
});

test('Invariant 227 (a newly staging file cannot inherit a prior file publication receipt)', () => {
  const context=runFunctions('assets/app-runtime.js',['erpSyncProgressCards'],{});
  const cards=plain(context.erpSyncProgressCards({sourceProgress:{drive:{fileName:'new.xlsx',stage:'staging',percent:70,rowsStaged:1500,rowsTotal:9000,rowsPublished:0}},stageResults:[{key:'drive',sourceFileName:'old.xlsx',outcome:'processed',rowCount:9000}]}));
  assert.equal(cards[0].fileName,'new.xlsx');assert.equal(cards[0].stage,'staging');assert.equal(cards[0].percent,70);assert.equal(cards[0].rowsPublished,0);assert.equal(cards[0].rowsTotal,9000);
});

test('Invariant 228 (private per-file progress stays monotonic and ignores repeated older receipts)', () => monotonicProgressContract(runFunctions,plain));

test('Invariant 229 (healthy ERP publication renews ownership before the four-second request lease expires)', async () => {
  let now=0,expiresAt=4000,tick,period,finish,stopped=false;
  const context=runFunctions('supabase/functions/app-api/index.ts',['withCloudErpSyncLeaseHeartbeat'],{
    supabase:{rpc:async()=>{if(now>=expiresAt)return {error:new Error('ERP_SYNC_WORKER_LEASE_INVALID')};expiresAt=now+4000;return {error:null};}},
    setInterval:(callback,delay)=>{tick=callback;period=delay;return 1;},clearInterval:()=>{stopped=true;}
  });
  const pending=new Promise(resolve=>{finish=resolve;});
  const work=context.withCloudErpSyncLeaseHeartbeat('run-229','worker-229',()=>pending);
  try {
    for(now=1000;now<=9000;now+=1000){
      if(now%period===0){tick();for(let turn=0;turn<5;turn++)await Promise.resolve();}
      assert.ok(now<expiresAt,'a healthy atomic publisher must remain leased before a successor can claim');
    }
  } finally {finish('published');await work;}
  assert.equal(stopped,true);
});

test('Invariant 230 (ERP readers preserve prefixed OOXML worksheet cells and shared strings)', async () => {
  const {deflateRawSync}=await import('node:zlib');
  const fixture=runFunctions('tests/erp-sync-staging.test.mjs',['makeZip'],{Buffer,deflateRawSync});
  const bytes=fixture.makeZip({
    'xl/workbook.xml':'<x:workbook xmlns:x="urn:sheet" xmlns:r="urn:rels"><x:sheets><x:sheet name="ReportLayout" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml':'<x:sst><x:si><x:t>ITEMCODE</x:t></x:si><x:si><x:t>AVAILABLE</x:t></x:si><x:si><x:t>ABC</x:t></x:si></x:sst>',
    'xl/worksheets/sheet1.xml':'<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c></x:row><x:row r="2"><x:c r="A2" t="s"><x:v>2</x:v></x:c><x:c r="B2"><x:v>4</x:v></x:c></x:row></x:sheetData></x:worksheet>'
  });
  const parser=await import('../supabase/functions/_shared/erp-sync.mjs');
  const sheets=await parser.parseErpXlsxSheets(bytes);
  assert.equal(sheets[0].name,'ReportLayout');assert.deepEqual(sheets[0].rows,[['ITEMCODE','AVAILABLE'],['ABC','4']]);
  const page=await parser.parseErpXlsxPage(bytes,0,10,{dataset:'cav'});
  assert.deepEqual(page.rows,[{itemcode:'ABC',available:'4'}]);
});

test('Invariant 231 (private recovery wakes accepted ERP jobs without relaxing the forty-hop relay or browser authorization)', () => privateRecoveryContract(runFunctions, read));

test('Invariant 232 (slow metadata status calls cannot yield an ERP step without advancing its bounded file cursor)', () => slowMetadataContract(runFunctions));

test('Invariant 233 (printed CAV Item # rows retain availability and exclude report group headings)', async () => {
  const {deflateRawSync}=await import('node:zlib');
  const fixture=runFunctions('tests/erp-sync-staging.test.mjs',['makeZip','inlineRow'],{Buffer,deflateRawSync});
  const headers=['Item #','Product Description','Brand Code','Size','*Season','Available'];
  const xml=[fixture.inlineRow(1,['Dylan wide open']),fixture.inlineRow(2,headers),fixture.inlineRow(3,['Quality 1']),fixture.inlineRow(4,['A123','Abelia','','3 gal','F1','15']),fixture.inlineRow(5,['Shrubs']),fixture.inlineRow(6,['A124','Maple','','5 gal','S1','0'])].join('');
  const bytes=fixture.makeZip({'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="ReportLayout" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':'<worksheet><sheetData>'+xml+'</sheetData></worksheet>'});
  const parser=await import('../supabase/functions/_shared/erp-sync.mjs');
  const page=await parser.parseErpXlsxPage(bytes,0,1500,{dataset:'cav'});
  const normalized=await parser.normalizeErpRowsChunk(page.rows,'cav',['unique_id','itemcode','commonname','contsize','season','ptravailable','available','brand_code']);
  assert.equal(normalized.rows.length,2);assert.equal(normalized.rows[0].itemcode,'A123');assert.equal(normalized.rows[0].commonname,'Abelia');assert.equal(normalized.rows[0].contsize,'3 gal');
  assert.equal(Number(normalized.rows[0].ptravailable),15);assert.equal(Number(normalized.rows[1].ptravailable),0);assert.equal(normalized.rows[1].itemcode,'A124');
});

test('Invariant 234 (HL PO live progress outranks its empty summary placeholder and retains its exact source filename)', () => {
  const ctx=runFunctions('assets/app-runtime.js',['erpSyncProgressCards'],{});
  const cards=plain(ctx.erpSyncProgressCards({sourceProgress:{hl_po:{fileName:null,stage:'idle',percent:0},hl_po_parsed:{fileName:'HL-PO-exact.pdf',stage:'staging',percent:70,rowsStaged:12,rowsTotal:20}},stageResults:[]}));
  const card=cards.find(row=>row.key==='hl_po');assert.equal(card.fileName,'HL-PO-exact.pdf');assert.equal(card.percent,70);assert.equal(card.rowsStaged,12);assert.equal(card.stage,'staging');
});

test('Invariant 235 (the shipped browser bridge accepts native ERP progress while rejecting unknown operations)', async () => {
  const calls=[];
  const fixture={runId:'run-235',active:true,status:'running',stageResults:[{key:'drive',outcome:'processed',sourceFileName:'Drive.xlsx',rowCount:2}]};
  const sandbox=vm.createContext({window:{fetchWithTimeout:async(url,init)=>{calls.push({url,init});return Response.json(fixture);}},URL,URLSearchParams,Headers,Request,Response,TextEncoder,TextDecoder,AbortController,Event,EventTarget,fetch:async()=>{throw Error('Unexpected SDK network');},setTimeout,clearTimeout,setInterval,clearInterval,console});
  vm.runInContext(readFileSync(path.join(root,'assets/vendor/supabase-browser-2.112.3.min.js'),'utf8'),sandbox);
  const bridge=sandbox.window.GncDatabase;
  const response=await bridge.fetchRpc('https://example.test','get_my_erp_sync_progress_v23116',{method:'POST',headers:{Authorization:'Bearer fixture-native-session'},body:'{}'},2500,'ERP progress');
  assert.equal(response.ok,true);assert.equal((await response.json()).runId,fixture.runId);assert.equal(calls.length,1);
  assert.equal(new URL(calls[0].url).pathname,'/rest/v1/rpc/get_my_erp_sync_progress_v23116');
  await assert.rejects(async()=>bridge.fetchRpc('https://example.test','unknown_private_operation',{method:'POST',body:'{}'},2500,'Unknown'),/Unknown database operation/);
  assert.equal(calls.length,1,'an unregistered operation must never reach the network');
});

test('Invariant 236 (history recovery loads without machine-only parser packages and preserves canonical workbook values)', async () => {
  const {pathToFileURL}=await import('node:url');
  const original=readFileSync(path.join(root,'scripts/finish-pending-history-files.mjs'),'utf8');
  const isolated=original.replace("'@supabase/supabase-js'",JSON.stringify(import.meta.resolve('@supabase/supabase-js')))
    .replace("'../supabase/functions/_shared/erp-history-sync.mjs'",JSON.stringify(pathToFileURL(path.join(root,'supabase/functions/_shared/erp-history-sync.mjs')).href));
  const helper=await import('data:text/javascript;base64,'+Buffer.from(isolated).toString('base64'));
  const {deflateRawSync}=await import('node:zlib');
  const fixture=runFunctions('tests/erp-sync-staging.test.mjs',['makeZip','inlineRow'],{Buffer,deflateRawSync});
  const bytes=fixture.makeZip({'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="History" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':'<worksheet><sheetData>'+fixture.inlineRow(1,['ITEMCODE','QUANTITY'])+fixture.inlineRow(2,['000909.020.1','15'])+'</sheetData></worksheet>'});
  const {parseErpXlsxSheets}=await import('../supabase/functions/_shared/erp-sync.mjs');let steps=0;
  const result=await helper.finishPendingHistoryFiles({supabase:{},token:'fixture',concurrency:1,runStep:async options=>{
    const sheets=await (options.parseWorkbook||parseErpXlsxSheets)(bytes);assert.deepEqual(sheets[0].rows[1],['000909.020.1','15']);steps++;
    return {done:true,result:{key:'order_history',outcome:'UP_TO_DATE',pendingFiles:0}};
  }});
  assert.equal(steps,1);assert.equal(result.outcome,'UP_TO_DATE');
});


test('Invariant 237 (authorized stale itemcode owner saves apply returned revisions and use direct Storage object URLs)', () => {
  const ownerMigration = read('supabase/migrations/20261030220000_agdata_v23117_itemcode_owner_lww.sql');
  const appRuntime = read('assets/app-runtime.js');
  const ownerSave = appRuntime.slice(appRuntime.indexOf('function applyAcknowledgedEvalAssignmentResults'), appRuntime.indexOf('async function reloadWarehouseAssignmentsAfterMutation'));
  const storageBuilder = appRuntime.slice(appRuntime.indexOf('function buildSupabaseStorageThumbnailUrl'), appRuntime.indexOf('function getDirectImageUrl'));
  assert.doesNotMatch(ownerMigration, /ITEMCODE_DEFAULT_OWNER_REVISION_CONFLICT/);
  assert.match(ownerMigration, /current_row\.revision \+ 1/);
  assert.match(ownerSave, /default_owner: saved\.assignedto/);
  assert.match(ownerSave, /default_revision: Number\(saved\.revision/);
  assert.match(storageBuilder, /nextUrl\.pathname = objectPrefix \+ publicPath/);
  assert.match(storageBuilder, /searchParams\.delete\(key\)/);
  assert.doesNotMatch(storageBuilder, /nextUrl\.pathname = renderPrefix \+ publicPath|searchParams\.set\('(width|height|resize|quality|format)'/);
  assert.match(appRuntime, /cacheControl: String\(options\.cacheControl \|\| '31536000'\)/);
});


test('Invariant 238 (committed exact-row receipts survive normalized values and transport recovery)', async () => {
  const context=runFunctions('assets/app-runtime.js',['getCommittedDriveEvidenceReceipt','firstNonEmptyValue'],{});
  const item={UNIQUE_ID:'physical-a',ITEMCODE:'005687.031.1',LOCATIONCODE:'A.06.000',LOTCODE:'27.F1'};
  const row={unique_id:'physical-a',itemcode:item.ITEMCODE,locationcode:item.LOCATIONCODE,lotcode:item.LOTCODE,av_note:'FULL BODY / SPEC - 16-18" H',loc_photo_match:41};
  const receipt=context.getCommittedDriveEvidenceReceipt({ok:true,row},item);
  assert.equal(receipt.canonicalConfirmed,true);assert.equal(receipt.writeConfirmed,true);assert.equal(receipt.row.av_note,row.av_note);
  assert.throws(()=>context.getCommittedDriveEvidenceReceipt({ok:true,row:{...row,unique_id:'physical-b'}},item),/IDENTITY/);
  assert.equal(context.getCommittedDriveEvidenceReceipt({ok:false,code:'DRIVE_FIELD_CONFLICT'},item),null);
  const calls=[];
  const transport=runFunctions('assets/app-runtime.js',['supabaseRpc'],{
    assertEvalDataSourceAllowed(){},getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer verified'}),
    SUPABASE_WRITE_TIMEOUT_MS:1000,SUPABASE_URL:'https://database.test',
    window:{GncDatabase:{fetchRpc:async(url,name,init)=>{calls.push({url,name,body:JSON.parse(init.body),authorization:init.headers.Authorization});
      if(calls.length===1)throw new TypeError('Failed to fetch');return new Response(JSON.stringify({ok:true,row}));}}},
    redactEvalSensitiveData:value=>value,Response
  });
  const command={p_master_uid:item.UNIQUE_ID,p_idempotency_key:'same-command'};
  const saved=await transport.supabaseRpc('save_drive_evidence_v3',command);
  assert.equal(saved.ok,true);assert.equal(calls.length,2);assert.deepEqual(plain(calls[1].body),command);assert.equal(calls[1].authorization,'Bearer verified');
});

test('Invariant 239 (positive match percentages use positive exact-row stock and recover zero published quantities)', () => {
  const context=runFunctions('assets/app-runtime.js',['getEditorLocMatchQtyValue','getDisplayLocMatchQtyValue','firstNonEmptyValue','parseAppNumber'],{
    findLinkedMasterRow:()=>({PTRONHAND:0,on_hand:51}),getCardLocationOnHandValue:()=>91,
    calculateLocMatchQtyValue:(row,pct)=>Math.round(Number(row.PTRAVAILABLE)*Number(pct)/100),
    shouldPreferFlyerOwnedFields:()=>false,getLocPhotoEvidenceState:()=>({context:'shared',qualified:true}),
    getPhotoQualifiedLocMatchQtyValue:()=>41,getDepletedLocPhotoMatchQtyValue:()=>0,
    getLocPhotoOwnedValue:()=>'',getLocPhotoEvidenceContext:()=> 'shared'
  });
  assert.equal(context.getEditorLocMatchQtyValue({PTRONHAND:0,on_hand:51},80),0);
  assert.equal(context.getDisplayLocMatchQtyValue({PTRONHAND:0,on_hand:51,MATCH:80,LOC_PHOTO_MATCH:0},'av'),'0');
  assert.equal(context.getDisplayLocMatchQtyValue({PTRONHAND:0,on_hand:51,loc_match_pct:80,LOC_PHOTO_MATCH:'N/A'},'drive'),'0');
});

test('Invariant 240 (date observer keeps photo dates below a full-bleed square and AV evidence below metrics)', async () => {
  const {JSDOM}=await import('jsdom');
  const dom=new JSDOM('<div class="app-inline-thumb-column"><div class="app-inline-thumb-box app-av-photo-carousel"><img src="https://photo.test/a.jpg"><span class="app-av-photo-count">1/3</span></div></div>');
  const context=runFunctions('assets/app-runtime.js',['ensurePhotoTakenDateBadges'],{document:dom.window.document,resolveAndFormatPhotoDate:()=> '10/30/26',esc:value=>value});
  context.ensurePhotoTakenDateBadges();
  const box=dom.window.document.querySelector('.app-inline-thumb-box'),date=dom.window.document.querySelector('.photo-thumb-date');
  assert.equal(box.contains(date),false);assert.equal(date.parentElement,box.parentElement);
  const runtime=read('assets/app-runtime.js'),css=read('assets/app-shell-style-05.css');
  const preview=runtime.slice(runtime.indexOf('const previewHtml = isReserveAvCard'),runtime.indexOf('const buildAvMediaHtml'));
  assert.doesNotMatch(preview,/\$\{imgHtml\}\$\{photoDateHtml\}/);
  assert.match(css,/app-inline-thumb-box[^}]*display:block!important/);
  assert.match(css,/app-inline-thumb-box[^}]*width:84px!important/);
  assert.match(runtime,/buildAvMediaHtml\(`<div class="app-av-catalog-photo-wrap">\$\{heroHtml\}<\/div>`, photoDateHtml\)/);
  assert.match(runtime,/\$\{avQuantityRowHtml\}\$\{seasonOhHtml\}<\/div>`\}\$\{avSpecHtml\}\$\{avCaliperHtml\}\$\{avNoteCatalogHtml\}/);
  dom.window.close();
});


test('Invariant 241 (request matrix renders synchronously, normalizes aliases and honors master denial)', () => invariant241({ read, functionSource }));


test('Invariant 242 (Suspend receipts publish every exact real-location row without waiting or discarding drafts)',()=>{
 const saved=[],scope='actor-a';const ctx=runFunctions('assets/app-runtime.js',['applySuspendTagInventoryReceipt'],{getSupabaseReadIdentityScope:()=>scope,isFalseBlockLocation:value=>value==='0.00.111',reconcileConfirmedDriveEvidence:(receipt,target,prefix,options)=>saved.push({receipt,target,prefix,options})});
 const row={unique_id:'physical-row',itemcode:'006916.150.1',locationcode:'G.11.000',lotcode:'26.F1',spec:'LIVE SPEC',av_note:'FULL / SPEC NOTE',loc_match_qty:'41'};
 assert.equal(ctx.applySuspendTagInventoryReceipt({inventoryRows:[row,{...row,unique_id:'false',locationcode:'0.00.111'}]},scope),true);assert.equal(saved.length,1);assert.equal(saved[0].receipt.row.av_note,row.av_note);assert.equal(saved[0].options.preserveDetailDraft,true);assert.equal(ctx.applySuspendTagInventoryReceipt({inventoryRows:[row]},'other-account'),false);
 const sql=read('supabase/migrations/20261031010000_agdata_v23119_access_matrix_and_publication.sql');assert.match(sql,/result:=public.save_drive_evidence_v3/);assert.match(sql,/candidate.locationcode/);assert.match(sql,/target.lotcode/);assert.match(sql,/round\(pct\*stock\/100\)/);
});


test('Invariant 243 (committed Suspend saves and reads accept absent optional notification metadata)',()=>{
 const api=read('supabase/functions/app-api/index.ts');const at=api.lastIndexOf('if (action === \"suspend_tag\")');const route=api.slice(at,api.indexOf('if (action === \"get_user_preferences\"',at));
 const statement=route.match(/const notification = [^;]+;/)?.[0];assert.ok(statement);
 const ctx=runFunctions('services/database-contract-runtime.ts',['isJson','jsonObject'],{exports:{}});
 vm.runInContext('function notificationFor(data){'+statement+'return notification;} var saved={ok:true,row:{unique_id:\"physical-tag\"}};var rows={rows:[]};var withNotice={notification:{approvalId:\"approval-a\",repUsername:\"rep-a\"}};',ctx);
 assert.deepEqual(Object.keys(ctx.notificationFor(ctx.saved)),[]);assert.deepEqual(Object.keys(ctx.notificationFor(ctx.rows)),[]);assert.equal(ctx.notificationFor(ctx.withNotice).approvalId,'approval-a');
 assert.match(route,/verifySuspendTagSession/);assert.match(route,/handleSuspendTag/);assert.match(route,/notification.approvalId && notification.repUsername/);
});


test('Invariant 244 (verified native photo writes never wait for the optional legacy session bridge)',async()=>{
 let bridges=0;const ctx=runFunctions('assets/app-runtime.js',['ensureAppApiWriteProxySession'],{getCurrentAppSessionToken:()=>'',getNativeAuthSession:async()=>({access_token:'verified-native-token',user:{id:'actor-a'}}),nativeAuthSessionActive:true,nativeAuthSessionUserId:'actor-a',nativeAuthProfile:{id:'actor-a'},ensureNativeAppSessionBridge:async()=>{bridges++;return null;},window:{}});
 assert.equal(await ctx.ensureAppApiWriteProxySession(),true);assert.equal(bridges,0);
 ctx.nativeAuthProfile={id:'other-account'};assert.equal(await ctx.ensureAppApiWriteProxySession(),false);assert.equal(bridges,1);
});


test('Invariant 245 (canonical photo receipts retain typed timestamps and exact-row evidence)',()=>{
 const ctx=runFunctions('assets/app-runtime.js',['getCommittedDriveEvidenceReceipt','firstNonEmptyValue'],{});const item={UNIQUE_ID:'row-a',ITEMCODE:'item-a',LOCATIONCODE:'C.15.000',LOTCODE:'27.S1'};const row={unique_id:'row-a',itemcode:'item-a',locationcode:'C.15.000',lotcode:'27.S1',photo_date:'2026-10-31T03:00:00Z',photo_link:'https://photos.test/proof.jpg',loc_photo_match:234,av_note:'FULL NOTE'};
 const receipt=ctx.getCommittedDriveEvidenceReceipt({ok:true,row},item);assert.equal(receipt.row.photo_date,row.photo_date);assert.equal(receipt.row.loc_photo_match,234);assert.equal(receipt.row.av_note,'FULL NOTE');
 const sql=read('supabase/migrations/20261031012000_agdata_v23119_typed_photo_publication.sql');assert.match(sql,/ELSE saved_at END ELSE m.photo_date END/);assert.doesNotMatch(sql,/to_char\(saved_at/);
});


test('Invariant 246 (committed Suspend photo receipts use the canonical proof signal)',()=>{
 const body=functionSource('assets/app-runtime.js','runSuspendTagRowCommand');const expression=body.match(/if \(photoOnly && \((options.photoProof.owner[^]*?)\)\) return \{ acknowledged: true, applied: false \};/)?.[1];assert.ok(expression);
 const controller=new AbortController();const ctx=vm.createContext({getSupabaseReadIdentityScope:()=> 'actor-a',canCurrentUserWorkRequestItem:()=>true});vm.runInContext('function shouldDefer(options,mirror){return ('+expression+');}',ctx);const options={photoProof:{owner:'actor-a',signal:controller.signal}};assert.equal(ctx.shouldDefer(options,{}),false);controller.abort();assert.equal(ctx.shouldDefer(options,{}),true);
});


test('Invariant 247 (Suspend lock contention retries the same command without retrying authorization denials)',async()=>{
 const calls=[];const ctx=runFunctions('assets/app-runtime.js',['suspendTagReceiptMatchesSource','currentSuspendSourceSnapshot','suspendSourceSnapshotChanged','sendSuspendTagTransport','suspendTagRetryDecision','retrySuspendTagTransport','suspendTagApi'],{getSupabaseReadIdentityScope:()=> 'actor-a',APP_API_FUNCTION_URL:'https://api.test',getDetailRowWriteTimeoutMs:()=>1000,applySuspendCandidateRows(){},setTimeout:resolve=>resolve(),postAppFunctionJson:async(_url,body)=>{calls.push(body);if(calls.length===1)throw Error('SUSPEND_TAG_DATABASE_55P03');return{ok:true,data:{ok:true,row:{unique_id:'tag-a'}}};}});
 const result=await ctx.suspendTagApi('save',{sourceUid:'tag-a',patch:{av_note:'FULL NOTE'}},{commandId:'same-command',expectedVersion:5});assert.equal(result.ok,true);assert.equal(calls.length,2);assert.equal(calls[0].commandId,calls[1].commandId);assert.deepEqual(plain(calls[0].payload),plain(calls[1].payload));
 let denied=0;ctx.postAppFunctionJson=async()=>{denied++;throw Error('SUSPEND_TAG_SESSION_REQUIRED');};await assert.rejects(ctx.suspendTagApi('save',{}, {commandId:'denied'}),/SESSION_REQUIRED/);assert.equal(denied,1);
});


test('Invariant 248 (late initial access hydration preserves an already opened operational view)', () => invariant248({functionSource}));


test('Invariant 249 (default and stale requester selections obey the same per-rep matrix as visible buttons)',()=>{
 const permission={allowed:false};const ctx=runFunctions('assets/app-runtime.js',['resolveRequestRepSelectionForCurrentUser'],{resolveCanonicalRequestRepName:value=>String(value).trim(),resolveUserAccessMatrix:()=>({make_request:'Y'}),window:{GncUserAccessControl:{canRequestSalesRep:()=>permission.allowed}},showToast(){}});
 assert.equal(ctx.resolveRequestRepSelectionForCurrentUser('Abbey Burka'),'');permission.allowed=true;assert.equal(ctx.resolveRequestRepSelectionForCurrentUser('Abbey Burka'),'Abbey Burka');permission.allowed=false;assert.equal(ctx.resolveRequestRepSelectionForCurrentUser('Abbey Burka',{showToast:true}),'');
});


test('Invariant 250 (operational sync completes at five sources and excludes historical progress)',()=>{
  const context=runFunctions('assets/app-runtime.js',['erpSyncProgressCards'],{});
  const keys=['drive','cav','reserves','soc','hl_po_parsed'];
  const stuck={active:true,status:'running',currentStage:'order_history',startedAt:'2026-10-30T00:00:00Z',sourceProgress:{order_history:{percent:0}},stageResults:keys.map(key=>({key,outcome:'UP_TO_DATE'}))};
  const cards=plain(context.erpSyncProgressCards(stuck));
  assert.deepEqual(cards.map(card=>card.key),['drive','cav','reserves','soc','hl_po']);
  assert.equal(cards.reduce((sum,card)=>sum+card.percent,0)/5,100);
  const complete=runFunctions('assets/app-runtime.js',['erpSyncProgressCards','completeOperationalErpSyncStatus'],{});
  const done=plain(complete.completeOperationalErpSyncStatus(stuck));
  assert.equal(done.active,false);assert.equal(done.status,'complete');assert.equal(done.percent,100);assert.equal(done.currentStage,'idle');
  const fresh=plain(complete.completeOperationalErpSyncStatus({active:true,currentStage:'drive',startedAt:new Date().toISOString(),stageResults:[]}));
  assert.equal(fresh.active,true);assert.equal(context.erpSyncProgressCards(fresh).every(card=>card.percent===0),true);
});


test('Invariant 251 (five-source cloud sync never lists history or unrelated secondary folders)', () => operationalSourcesContract(runFunctions));

test('Invariant 252 (operational recovery and SOC averages stay private, atomic and independent of Drive history)',()=>{
  const sql=read('supabase/migrations/20261031020000_agdata_v23120_operational_sync_completion.sql');
  assert.match(sql,/^begin;/);assert.match(sql,/interval '90 seconds'/);assert.match(sql,/currentStage'='order_history'/);
  assert.match(sql,/update private\.erp_sync_jobs/);assert.match(sql,/'percent',100/);assert.match(sql,/for update/);
  assert.match(sql,/private\.fold_soc_average_orders_v23120\(p_file_meta,p_rows\)/);assert.match(sql,/private\.fast_finish_live_ingest_v2369/);
  assert.match(sql,/row_number\(\) over\(partition by source_day,group_key/);assert.match(sql,/r\.itemcode_normalized=any\(affected\)/);
  assert.match(sql,/on conflict\(run_id,itemcode_normalized\) do update/);assert.match(sql,/revoke all on private\.soc_live_average_rows_v23120 from public,anon,authenticated,service_role/);
  assert.doesNotMatch(sql,/create trigger[^;]*on public\.ph_master_inventory/i);assert.doesNotMatch(sql,/update private\.ph_eval_item_low_stock_(file_versions|import_runs)/);
});


test('Invariant 253 (a healthy 147-second Drive slice never completes the four unchecked sources)',()=>{
 const now=Date.parse('2026-10-31T13:24:35Z');
 const context=runFunctions('assets/app-runtime.js',['erpSyncProgressCards','completeOperationalErpSyncStatus'],{});
 const status={active:true,status:'running',runId:'current',currentStage:'drive',startedAt:new Date(now-147000).toISOString(),updatedAt:new Date(now).toISOString(),sourceProgress:{drive:{fileName:'drive.xlsx',stage:'downloading',percent:95,rowsPublished:9498,rowsTotal:9498,publicationConfirmed:true,publishedFileName:'drive.xlsx',updatedAt:new Date(now-100000).toISOString()}},stageResults:[]};
 const state=plain(context.completeOperationalErpSyncStatus(status,now));
 assert.equal(state.active,true);assert.notEqual(state.status,'complete');assert.equal(state.percent,20);
 const cards=plain(context.erpSyncProgressCards(state));assert.equal(cards[0].percent,100);assert.equal(cards[0].stage,'published');assert.equal(cards.slice(1).every(card=>card.percent===0),true);
 const cached=plain(context.completeOperationalErpSyncStatus({...status,active:false,status:'complete',percent:100},now));assert.notEqual(cached.status,'complete');assert.equal(cached.percent,20);
});


test('Invariant 254 (foreground continuation is single-flight and server leases prevent competing workers)', () => foregroundDriverContract(runFunctions));

test('Invariant 255 (unchecked sources stay queued and checked unchanged sources retain published filename and rows)',()=>{
 const context=runFunctions('assets/app-runtime.js',['erpSyncProgressCards','completeOperationalErpSyncStatus'],{});
 const source={active:true,status:'running',startedAt:'2020-01-01',sourceProgress:{cav:{fileName:'published-cav.xlsx',lastPublishedRows:52000,stage:'complete',percent:100,checked:true,upToDate:true}},stageResults:[]};
 const cards=plain(context.erpSyncProgressCards(source));assert.equal(cards[0].percent,0);assert.equal(cards[0].stage,'queued');assert.equal(cards[1].percent,100);assert.equal(cards[1].rowsPublished,52000);assert.equal(cards[1].fileName,'published-cav.xlsx');assert.equal(cards[1].stage,'up_to_date');
 const state=plain(context.completeOperationalErpSyncStatus({...source,percent:100}));assert.equal(state.active,true);assert.equal(state.percent,20);
});

test('Invariant 256 (SOC can cross 52,000 rows while each continuation remains bounded to 1,500)', largeSocChunkContract);

test('Invariant 257 (late publication receipts cannot erase a checked complete source checkpoint)', () => completedCheckpointContract(runFunctions,plain));

test('Invariant 258 (custom Park Hill GDD clamps and projects forecast calendar dates)',()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(read('assets/smart-hold-intelligence.js'),ctx);const H=ctx.AgDataHoldIntelligence;
 const weather=Array.from({length:14},(_,i)=>({date:H.addDays('2026-10-31',i),high:70,low:50}));
 assert.equal(H.dailyGdd(70,50),35);assert.equal(H.dailyGdd(20,20),0);assert.equal(H.sumGdd('2026-10-31','2026-11-14',weather),490);assert.equal(H.projectDate(70,'2026-10-31',weather),'2026-11-02');
});

test('Invariant 259 (hold history cannot borrow recovery from another physical lot)',()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(read('assets/smart-hold-intelligence.js'),ctx);const H=ctx.AgDataHoldIntelligence;
 const row={itemcode:'A',locationcode:'L',lotcode:'X',holdstopcode:'H',holdstopreason:'SHEARED'};
 const history=[{...row,report_date:'2026-10-01'},{...row,lotcode:'Y',report_date:'2026-10-02',holdstopcode:''}];
 const risk=H.holdRisk(row,[],history,'2026-10-03');assert.equal(risk.sampleCount,0);assert.equal(risk.onRemaining,0);assert.match(risk.basis,/Uncalibrated/);
});

test('Invariant 260 (load protection retains undated commitments and ignores known sibling lots)',()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(read('assets/smart-hold-intelligence.js'),ctx);const H=ctx.AgDataHoldIntelligence;
 const row={itemcode:'A',locationcode:'L',lotcode:'X'};const index=H.buildLoadIndex([{...row,quantityordered:20,quantityshipped:3,transactionnumber:'one'},{...row,lotcode:'Y',quantityordered:99,transactionnumber:'other'}]);
 const guard=H.shearGuard(row,index,[],[],[],'2026-10-31');assert.equal(guard.conflict,true);assert.equal(guard.qty,17);assert.equal(guard.orders,1);assert.equal(guard.shipDate,'');
});

test('Invariant 261 (all-row selection count follows visible column-filtered blank defaults)',()=>{
 const rows=[{ITEMCODE:'A',ASSIGNEDTO:'zoe_green',DEFAULT_ASSIGNEDTO:''},{ITEMCODE:'A',ASSIGNEDTO:'zoe_green',DEFAULT_ASSIGNEDTO:''},{ITEMCODE:'B',ASSIGNEDTO:'mitch_kaiser',DEFAULT_ASSIGNEDTO:''}];const selection=new Set();
 const ctx=runFunctions('assets/app-runtime.js',['getManagerAssignedSelectionSnapshot','selectAllFilteredManagerAssignedItems'],{getFilteredManagerAssignedItemsExportRows:r=>r.filter(x=>x.ASSIGNEDTO==='zoe_green'&&x.DEFAULT_ASSIGNEDTO===''),getManagerAssignedItemsDisplayRows:()=>rows,buildManagerEvalAssignmentKey:x=>x,managerEvalAssignmentSelection:selection,getManagerAssignedColumnState:()=>({filters:{ASSIGNEDTO:['zoe_green'],DEFAULT_ASSIGNEDTO:['']}}),managersSearchTerm:'',getManagerAssignedItemsActiveAssigneeKey:()=> 'all',updateManagerAssignedItemsView:()=>{},scheduleManagersRender:()=>{}});
 assert.equal(ctx.getManagerAssignedSelectionSnapshot().rows.length,2);ctx.selectAllFilteredManagerAssignedItems(true);assert.equal(selection.size,1);assert.equal(ctx.getManagerAssignedSelectionSnapshot().selectedRows.length,2);ctx.selectAllFilteredManagerAssignedItems(false);assert.equal(selection.size,0);
});

test('Invariant 262 (explicit owner optimism updates defaults and effective worker together and rolls back on failure)',()=>{
 const row={ITEMCODE:'A',ASSIGNEDTO:'zoe_green',DEFAULT_ASSIGNEDTO:'',zone_override_active:true},other={ITEMCODE:'B',ASSIGNEDTO:'mitch_kaiser'},master={ITEMCODE:'A',ASSIGNEDTO:'zoe_green'};const state={filters:{}};
 const ctx=runFunctions('assets/app-runtime.js',['applyOptimisticItemcodeOwners'],{warehouseAssignedItemsInventory:[row,other],fullInventory:[master],getManagerAssignedColumnState:()=>state,buildManagerEvalAssignmentKey:x=>x,clearWarehouseAssignedItemCaches:()=>{},invalidateManagerEvalReport2Cache:()=>{}});
 const undo=ctx.applyOptimisticItemcodeOwners(['A'],'morgan_anderson');assert.equal(row.ASSIGNEDTO,'morgan_anderson');assert.equal(row.default_owner,'morgan_anderson');assert.equal(master.effective_worker,'morgan_anderson');assert.equal(other.ASSIGNEDTO,'mitch_kaiser');assert.equal(row.zone_override_active,false);undo();assert.equal(row.ASSIGNEDTO,'zoe_green');assert.equal(row.DEFAULT_ASSIGNEDTO,'');assert.equal(row.zone_override_active,true);
});


test('Invariant 263 (owner batch overload crosses the shared validator while malformed fields stay rejected)',async()=>{
 let calls=0;const bridge=databaseBridge(async()=>{calls++;return new Response(JSON.stringify({contractVersion:'inventory-row-assignments-v1',assignments:[],defaults:[]}),{status:200,headers:{'Content-Type':'application/json'}});});
 const send=args=>bridge.fetchRpc('https://example.test','set_itemcode_default_owners_v1',{method:'POST',body:JSON.stringify(args)},1000,'owners');
 await send({p_itemcodes:['A','B'],p_assignedto:'zoe_green',p_request_id:'00000000-0000-4000-8000-000000000001'});
 await send({p_changes:[{itemcode:'A',assignedto:'zoe_green',expectedRevision:0}],p_request_id:'00000000-0000-4000-8000-000000000002'});
 assert.equal(calls,2);await assert.rejects(send({p_itemcodes:['A'],p_assignedto:'zoe_green',p_request_id:'x',actor:'dylan_collyge'}),/Invalid/);assert.equal(calls,2);
});

test('Invariant 264 (optimistic owner publication keeps the mapped display cache current after invalidation)',()=>{
 const master=[{ITEMCODE:'A',ASSIGNEDTO:'zoe_green'}],display=[{...master[0]}],state={dataEpoch:0,defaultDrafts:{},displayCache:{input:master,rows:display,signature:'old'},filteredCache:new Map([['stale',[]]])};
 const ctx=runFunctions('assets/app-runtime.js',['applyOptimisticItemcodeOwners','getManagerAssignedDisplaySignature'],{warehouseAssignedItemsInventory:[{...master[0]}],fullInventory:master,getManagerAssignedColumnState:()=>state,buildManagerEvalAssignmentKey:x=>x,clearWarehouseAssignedItemCaches:()=>{state.dataEpoch++;},invalidateManagerEvalReport2Cache:()=>{},getManagerItemLowStockTargetsState:()=>({revision:1}),getDatasetLoadSignature:key=>key,managerEvalReportSettings:{lowStockMaxSLts:150}});
 ctx.applyOptimisticItemcodeOwners(['A'],'morgan_anderson');assert.equal(display[0].DEFAULT_ASSIGNEDTO,'morgan_anderson');assert.equal(display[0].ASSIGNEDTO,'morgan_anderson');assert.equal(state.displayCache.signature,ctx.getManagerAssignedDisplaySignature(state,true,1));assert.equal(state.filteredCache.size,0);
});


test('Invariant 265 (explicit owner reconciliation removes the legacy zone veto while retaining audit and actor checks)',()=>{
 const sql=read('supabase/migrations/20261031210000_agdata_v23122_smart_hold_and_explicit_owners.sql');
 const audit=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION private.audit_eval_assignment_change'),sql.indexOf('CREATE OR REPLACE FUNCTION public.set_itemcode_default_owners_v1'));
 assert.ok(audit.includes('ph_warehouse_assignment_audit'));assert.ok(audit.includes('auth.uid()'));assert.doesNotMatch(audit,/EVAL_ASSIGNMENT_ZONE_LOCKED/);
 assert.match(sql,/RETURN public.set_itemcode_default_owners_v1\(changes, p_request_id\)/);
 const legacy=read('supabase/migrations/20261030220000_agdata_v23117_itemcode_owner_lww.sql');assert.match(legacy,/actor\.id/);assert.match(legacy,/ITEMCODE_DEFAULT_OWNER_IDEMPOTENCY_CONFLICT/);assert.match(legacy,/ASSIGNEE_NOT_IN_EVAL_ROSTER_OR_ACTIVE_PROFILE/);
});


test('Invariant 266 (older same-account assignment snapshots cannot erase a committed exact-row owner receipt)',()=>{
 const state={ownerReceiptUser:'dylan_collyge',ownerReceipts:new Map([['row-a',{assignedto:'zoe_green',default_assignedto:'zoe_green',default_revision:2,revision:9,zone_override_active:false}]])};
 const ctx=runFunctions('assets/app-runtime.js',['applyCommittedItemcodeOwnerReceipt'],{Map,managerAssignedColumnState:state,currentUser:'dylan_collyge'});
 const stale={master_unique_id:'row-a',default_revision:1,revision:8,assignedto:'old',default_assignedto:''};ctx.applyCommittedItemcodeOwnerReceipt(stale);assert.equal(stale.assignedto,'zoe_green');assert.equal(stale.default_assignedto,'zoe_green');assert.equal(stale.default_revision,2);
 const sibling={master_unique_id:'row-b',default_revision:0,assignedto:'mitch_kaiser'};ctx.applyCommittedItemcodeOwnerReceipt(sibling);assert.equal(sibling.assignedto,'mitch_kaiser');
 ctx.currentUser='another_user';const other={master_unique_id:'row-a',assignedto:'other'};ctx.applyCommittedItemcodeOwnerReceipt(other);assert.equal(other.assignedto,'other');
 ctx.currentUser='dylan_collyge';const newer={master_unique_id:'row-a',default_revision:3,revision:10,assignedto:'morgan_anderson'};ctx.applyCommittedItemcodeOwnerReceipt(newer);assert.equal(newer.assignedto,'morgan_anderson');
});

test('Invariant 267 (mobile reason and Trace minimum heights win the shared touch-target cascade)',()=>{
 const css=read('assets/app-styles.css');
 const minimum=(selectorToken)=>{
  const rules=[{weight:2000400,value:44}];
  for(const match of css.matchAll(/([^{}]+)\{([^{}]+)\}/g)){
   if(!match[1].includes(selectorToken))continue;
   const min=match[2].match(/min-height:\s*(\d+)px\s*!important/);if(!min)continue;
   const weight=(match[1].match(/#[\w-]+/g)||[]).length*1000000+(match[1].match(/\.[\w-]+/g)||[]).length*100;
   rules.push({weight,value:Number(min[1])});
  }
  return rules.sort((a,b)=>a.weight-b.weight).at(-1).value;
 };
 assert.equal(minimum('.smart-reason-tabs button'),36);
 assert.equal(minimum('.smart-kpi-footer .sales-intelligence-trace-toggle'),22);
});

test('Invariant 268 (uncommitted shear rows never scan recovery history or alternate inventory)',()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(read('assets/smart-hold-intelligence.js'),ctx);
 const forbidden={filter(){throw Error('unnecessary full scan');}};
 const guard=ctx.AgDataHoldIntelligence.shearGuard({itemcode:'NONE',locationcode:'L',lotcode:'X'},new Map(),[],forbidden,forbidden,'2026-10-31');
 assert.equal(guard.conflict,false);assert.equal(guard.loads.length,0);
});
test('Invariant 269 (account changes restore the optimistic draft before discarding an acknowledgment)',async()=>{
 const prior={},next={};let active=prior,undo=0,ack=0;
 const ctx=runFunctions('assets/app-runtime.js',['assignEvalItemcodes'],{
  canManageEvalItemcodeAssignments:()=>true,isManagerAssignedSnapshotCurrent:()=>true,
  buildManagerEvalAssignmentKey:x=>x,parseManagerEvalAssignmentKey:x=>({itemcode:x}),getManagerAssignedColumnState:()=>active,
  warehouseAssignedItemsInventory:[{itemcode:'A',default_revision:1}],normalizeEvalAssignableUser:x=>x,crypto:{randomUUID:()=> 'request'},
  applyOptimisticItemcodeOwners:()=>()=>{undo++;},requestAnimationFrame:()=>{},
  supabaseRpc:async()=>{active=next;return {};},applyAcknowledgedEvalAssignmentResults:()=>{ack++;}
 });
 assert.equal(await ctx.assignEvalItemcodes(['A'],'zoe_green'),false);assert.equal(undo,1);assert.equal(ack,0);assert.deepEqual(next,{});
});

test('Invariant 270 (background errors retain the loaded Shear List and Drive tab)',()=>{
 const nodes={'shear-list-content':{},'shear-list-crumb':{},'shear-list-back-btn':{classList:{toggle(){},add(){}}}};
 const state={loaded:true,loading:false,error:'Customer mapping snapshot is incomplete.',rows:[{status:'open'}],inquiries:[],activeTab:'drive'};
 const ctx=runFunctions('assets/app-runtime.js',['renderShearList'],{shearListState:state,document:{getElementById:id=>nodes[id]},renderShearListHeaderSlot(){},warmSalesIntelligenceData(){},warmSmartHoldContext(){},fullInventory:[],renderSmartWeatherBar:()=> 'weather',renderShearListTabsHtml:()=> 'Drive Mode Open Shear List',renderShearDriveMode:()=> 'cached exact row',setContainerHtml:(node,html)=>node.html=html});
 ctx.renderShearList();assert.match(nodes['shear-list-content'].html,/Drive Mode.*cached exact row/);assert.doesNotMatch(nodes['shear-list-content'].html,/Setup Required|table needed/);assert.equal(state.rows.length,1);
});

test('Invariant 271 (repeated hold estimates reuse an exact-identity historical index)',()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(read('assets/smart-hold-intelligence.js'),ctx);const H=ctx.AgDataHoldIntelligence;let reads=0;
 const observation={get itemcode(){reads++;return 'A';},locationcode:'L',lotcode:'X',report_date:'2026-10-01',holdstopcode:'H',holdstopreason:'SHEARED'};
 const history=[observation],row={itemcode:'A',locationcode:'L',lotcode:'X'};
 assert.equal(H.historyModel(row,history,[]).observations,1);const first=reads;
 assert.equal(H.historyModel(row,history,[]).observations,1);assert.equal(reads,first);
 assert.equal(H.historyModel({...row,lotcode:'Y'},history,[]).observations,0);
 history.push({...row,report_date:'2026-10-03',holdstopcode:''});assert.equal(H.historyModel(row,history,[]).cycles.length,1);
});

test('Invariant 272 (Shear sorting evaluates outbound demand only once per visible candidate)',()=>{
 const rows=Array.from({length:200},(_,i)=>({id:i,COMMONNAME:'Item '+i,LOCATIONCODE:'L'+i}));let calls=0;
 const ctx=runFunctions('assets/app-runtime.js',['getShearDriveFilteredRows'],{shearListState:{},getShearDecisionNumber:()=>NaN,getShearDriveBaseRows:()=>rows.slice(),getShearDriveShippingDemand:row=>{calls++;return {qty:row.id};},firstNonEmptyValue:(...v)=>v.find(x=>x!==undefined&&x!==null&&x!=='')||''});
 const sorted=ctx.getShearDriveFilteredRows();assert.equal(calls,rows.length);assert.equal(sorted[0].id,199);assert.equal(sorted.at(-1).id,0);assert.equal(rows[0].id,0);
});


test('Invariant 273 (owner receipt completes before background refresh while optimism and account gates remain authoritative)',async()=>{
 const state={}, events=[];let releaseRefresh,finished=false,allowed=true;
 const refresh=new Promise(resolve=>{releaseRefresh=resolve;});
 const ctx=runFunctions('assets/app-runtime.js',['assignEvalItemcodes'],{
  canManageEvalItemcodeAssignments:()=>allowed,isManagerAssignedSnapshotCurrent:()=>true,
  buildManagerEvalAssignmentKey:x=>x,parseManagerEvalAssignmentKey:x=>({itemcode:x}),getManagerAssignedColumnState:()=>state,
  warehouseAssignedItemsInventory:[{itemcode:'A',default_revision:1}],normalizeEvalAssignableUser:x=>x,crypto:{randomUUID:()=> 'request'},
  applyOptimisticItemcodeOwners:()=>{events.push('optimistic');return ()=>events.push('rollback');},requestAnimationFrame:fn=>fn(),
  supabaseRpc:async()=>{events.push('rpc');return {defaults:[{itemcode:'A',assignedto:'zoe_green',revision:2}]};},
  applyAcknowledgedEvalAssignmentResults:()=>events.push('receipt'),managerEvalAssignmentSelection:new Set(['A']),
  showToast:()=>{},updateManagerAssignedItemsView:()=>events.push('render'),scheduleManagersRender:()=>{},
  reloadWarehouseAssignmentsAfterMutation:()=>{events.push('refresh');return refresh;},reportSemanticHealthEvent:()=>{}
 });
 const save=ctx.assignEvalItemcodes(['A'],'zoe_green').then(()=>{finished=true;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(finished,true,'durable acknowledgment must not await the background snapshot');
 assert.ok(events.indexOf('optimistic')<events.indexOf('rpc'));assert.ok(events.indexOf('receipt')<events.indexOf('refresh'));
 assert.equal(state.defaultPending.size,0);assert.equal(state.defaultCommands.size,0);assert.equal(Object.keys(state.defaultDrafts).length,0);
 allowed=false;await ctx.assignEvalItemcodes(['A'],'zoe_green');assert.equal(events.filter(x=>x==='rpc').length,1);
 releaseRefresh();await save;assert.equal(events.includes('rollback'),false);
});


test('Invariant 274 (owner saves hedge only an identical authenticated command and preserve denial, cancellation and account boundaries)',async()=>{
 const body={p_itemcodes:['A'],p_assignedto:'zoe_green',p_request_id:'00000000-0000-4000-8000-000000000001'};
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 const harness=()=>{
  let scope='account-a',native=true;const timers=new Map(),calls=[];
  const context=runFunctions('assets/app-runtime.js',['supabaseRpc'],{AbortController,
   assertEvalDataSourceAllowed:()=>{},getNativeAuthRequestHeaders:async()=>native?{Authorization:'Bearer native-session'}:null,
   getSupabaseReadIdentityScope:()=>scope,nativeSessionRecoveryError:()=>new Error('Native session required'),
   SUPABASE_URL:'https://example.test',SUPABASE_WRITE_TIMEOUT_MS:22000,redactEvalSensitiveData:value=>value,
   getResponseError:async()=> 'Forbidden',setTimeout:(fn,ms)=>{assert.equal(ms,75);timers.set(1,fn);return 1;},clearTimeout:id=>timers.delete(id),
   window:{GncDatabase:{fetchRpc:(url,name,request)=>new Promise((resolve,reject)=>calls.push({url,name,request,resolve,reject}))}}
  });
  return {context,calls,timers,setScope:value=>{scope=value;},denyNative:()=>{native=false;}};
 };
 const h=harness();const pending=h.context.supabaseRpc('set_itemcode_default_owners_v1',body);await flush();assert.equal(h.calls.length,1);
 h.timers.get(1)();await flush();assert.equal(h.calls.length,2);assert.equal(h.calls[0].request.body,h.calls[1].request.body);
 assert.deepEqual(h.calls[0].request.headers,h.calls[1].request.headers);assert.equal(h.calls[0].request.ownerReplayRelay,false);assert.equal(h.calls[1].request.ownerReplayRelay,true);assert.equal(JSON.parse(h.calls[1].request.body).p_request_id,body.p_request_id);
 h.calls[1].resolve(new Response(JSON.stringify({requestId:body.p_request_id,defaults:[{itemcode:'A',assignedto:'zoe_green'}]})));
 assert.equal((await pending).requestId,body.p_request_id);assert.equal(h.timers.size,0);assert.equal(h.calls[0].request.signal.aborted,true);assert.equal(h.calls[1].request.signal.aborted,false);
 h.calls[0].reject(new Error('superseded transport'));await flush();assert.equal(h.calls.length,2);
 const denied=harness();const deniedSave=denied.context.supabaseRpc('set_itemcode_default_owners_v1',body);await flush();
 denied.calls[0].resolve(new Response(JSON.stringify({code:'42501'}),{status:403}));await assert.rejects(deniedSave,error=>error.status===403&&error.code==='42501');assert.equal(denied.calls.length,1);assert.equal(denied.timers.size,0);
 const switched=harness();const switchedSave=switched.context.supabaseRpc('set_itemcode_default_owners_v1',body);await flush();switched.setScope('account-b');switched.timers.get(1)();await assert.rejects(switchedSave,error=>error.code==='REQUEST_SCOPE_CHANGED');assert.equal(switched.calls.length,1);assert.equal(switched.calls[0].request.signal.aborted,true);
 const cancelled=harness(),abort=new AbortController();const cancelledSave=cancelled.context.supabaseRpc('set_itemcode_default_owners_v1',body,{signal:abort.signal});await flush();cancelled.timers.get(1)();abort.abort();await assert.rejects(cancelledSave,error=>error.code==='REQUEST_ABORTED');assert.ok(cancelled.calls.every(call=>call.request.signal.aborted));
 const unauthenticated=harness();unauthenticated.denyNative();await assert.rejects(unauthenticated.context.supabaseRpc('set_itemcode_default_owners_v1',body),/Native session required/);assert.equal(unauthenticated.calls.length,0);
 const unavailable=harness();const continued=unavailable.context.supabaseRpc('set_itemcode_default_owners_v1',body);await flush();unavailable.timers.get(1)();unavailable.calls[1].resolve(new Response('{}',{status:503}));await flush();unavailable.calls[0].resolve(new Response('{}'));await continued;assert.equal(unavailable.calls.length,2);
 const other=harness();const otherSave=other.context.supabaseRpc('other_authorized_rpc',{});await flush();assert.equal(other.timers.size,0);other.calls[0].resolve(new Response('{}'));await otherSave;assert.equal(other.calls.length,1);
});


test('Invariant 275 (owner replay retains native SQL identity and cannot become a service-role or arbitrary mutation proxy)',async()=>{
 const calls=[];const context=runFunctions('supabase/functions/app-api/index.ts',['handleAssignedOwnerSaveRelay'],{
  Request,Response,SUPABASE_URL:'https://project.test',corsHeaders:{},Deno:{env:{get:name=>name==='SUPABASE_ANON_KEY'?'public-key':undefined}},
  errorResponse:(message,status,details)=>new Response(JSON.stringify(details),{status}),
  fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({requestId:'saved'}));}
 });
 const request=new Request('https://project.test/functions/v1/app-api',{method:'POST',headers:{Authorization:'Bearer native-session'}});
 const payload={action:'assigned_owner_save',p_itemcodes:['A','B'],p_assignedto:'zoe_green',p_request_id:'00000000-0000-4000-8000-000000000001'};
 const response=await context.handleAssignedOwnerSaveRelay(request,payload,'verified-native-actor');assert.equal(response.status,200);assert.equal((await response.json()).requestId,'saved');
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://project.test/rest/v1/rpc/set_itemcode_default_owners_v1');assert.equal(calls[0].options.headers.Authorization,'Bearer native-session');assert.equal(calls[0].options.headers.apikey,'public-key');assert.deepEqual(JSON.parse(calls[0].options.body),{p_itemcodes:payload.p_itemcodes,p_assignedto:payload.p_assignedto,p_request_id:payload.p_request_id});
 for(const invalid of [{...payload,actor:'dylan_collyge'},{...payload,p_itemcodes:[]},{...payload,p_request_id:'invalid'}])assert.equal((await context.handleAssignedOwnerSaveRelay(request,invalid,'verified-native-actor')).status,400);
 assert.equal((await context.handleAssignedOwnerSaveRelay(request,payload,'')).status,401);assert.equal(calls.length,1);
 const api=read('supabase/functions/app-api/index.ts');assert.ok(api.lastIndexOf('const context = await resolveZeroTrustRequestContext(session)')<api.lastIndexOf('return await handleAssignedOwnerSaveRelay(req, payload'));assert.ok(api.includes('if (action === "assigned_owner_save") return { flag: "can_access_manager_tab" }'));
});


test('Invariant 276 (only the marked canonical owner replay changes transport and preserves its native command)',async()=>{
 const sent=[];const context=runFunctions('assets/app-runtime.js',['fetchWithTimeout'],{
  AbortController,SUPABASE_URL:'https://project.test',APP_API_FUNCTION_URL:'https://project.test/functions/v1/app-api',SUPABASE_WRITE_TIMEOUT_MS:22000,
  fetchSupabaseRestViaAppApiIfNeeded:async()=>null,window:{},setTimeout:()=>1,clearTimeout:()=>{},
  fetch:async(url,options)=>{sent.push({url,options});return new Response('{}');}
 });
 const body={p_itemcodes:['A'],p_assignedto:'zoe_green',p_request_id:'00000000-0000-4000-8000-000000000001'};
 const options={method:'POST',headers:{Authorization:'Bearer native-session'},body:JSON.stringify(body),ownerReplayRelay:true};
 await context.fetchWithTimeout('https://project.test/rest/v1/rpc/set_itemcode_default_owners_v1',options);
 assert.equal(sent[0].url,'https://project.test/functions/v1/app-api');assert.equal(sent[0].options.headers.Authorization,'Bearer native-session');assert.deepEqual(JSON.parse(sent[0].options.body),{...body,action:'assigned_owner_save'});
 await context.fetchWithTimeout('https://project.test/rest/v1/rpc/another_rpc',options);assert.equal(sent[1].url,'https://project.test/rest/v1/rpc/another_rpc');assert.equal(sent[1].options.body,options.body);
 const abort=new AbortController();abort.abort();await assert.rejects(context.fetchWithTimeout('https://project.test/rest/v1/rpc/set_itemcode_default_owners_v1',{...options,signal:abort.signal}),error=>error.code==='REQUEST_ABORTED');assert.equal(sent.length,2);
});


test('Invariant 277 (optional relay metadata failures cannot override an authorized canonical owner receipt)',async()=>{
 for(const status of [401,403,503]){
  const calls=[];let replay,settled=false;
  const context=runFunctions('assets/app-runtime.js',['supabaseRpc'],{AbortController,
   assertEvalDataSourceAllowed:()=>{},getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer native-session'}),getSupabaseReadIdentityScope:()=> 'same-account',SUPABASE_URL:'https://example.test',SUPABASE_WRITE_TIMEOUT_MS:22000,redactEvalSensitiveData:x=>x,
   window:{GncDatabase:{fetchRpc:(url,name,request)=>new Promise((resolve,reject)=>calls.push({request,resolve,reject}))}},setTimeout:fn=>{replay=fn;return 1;},clearTimeout:()=>{}
  });
  const pending=context.supabaseRpc('set_itemcode_default_owners_v1',{p_itemcodes:['A'],p_assignedto:'zoe_green',p_request_id:'00000000-0000-4000-8000-000000000001'}).then(x=>{settled=true;return x;});
  await new Promise(resolve=>setImmediate(resolve));replay();calls[1].resolve(new Response('{}',{status}));await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  assert.ok(calls.every(x=>x.request.priority==='high'));calls[0].resolve(new Response(JSON.stringify({requestId:'canonical',defaults:[{itemcode:'A',assignedto:'zoe_green'}]})));assert.equal((await pending).requestId,'canonical');assert.equal(calls.length,2);
 }
});


test('Invariant 278 (owner relay reuses only the current verified native profile and retains fresh capability authorization)',async()=>{
 let profileReads=0,accessReads=0;
 const actor={id:'native-id',username:'dylan_collyge',display_name:'Dylan',role:'Admin'};
 const session={authUserId:actor.id,username:actor.username,displayName:actor.display_name,role:actor.role,mustChangePassword:false};
 const context=runFunctions('supabase/functions/app-api/index.ts',['resolveZeroTrustRequestContext'],{
  supabase:{},normalizeUsername:value=>String(value||'').trim().toLowerCase(),
  resolveActiveSessionProfile:async()=>{profileReads++;return actor;},
  resolveCanonicalUserAccess:async(_db,id)=>{accessReads++;assert.equal(id,actor.id);return {username:actor.username,canonicalRole:'admin'};}
 });
 const result=await context.resolveZeroTrustRequestContext(session,true);
 assert.equal(result.actor.id,actor.id);assert.equal(profileReads,0);assert.equal(accessReads,1);
 await context.resolveZeroTrustRequestContext(session,true);assert.equal(accessReads,2,'authorization is fresh on every request');
 await context.resolveZeroTrustRequestContext(session);assert.equal(profileReads,1,'legacy and all other actions retain full profile checks');
 await assert.rejects(context.resolveZeroTrustRequestContext({...session,mustChangePassword:true},true),/PASSWORD_CHANGE_REQUIRED/);
 await assert.rejects(context.resolveZeroTrustRequestContext(null,true),/AUTH_REQUIRED/);
 await assert.rejects(context.resolveZeroTrustRequestContext({...session,authUserId:''},true),/AUTH_REQUIRED/);
 await assert.rejects(context.resolveZeroTrustRequestContext({...session,username:'another_actor'},true),/AUTH_IDENTITY_MISMATCH/);
 context.resolveCanonicalUserAccess=async()=>{throw new Error('USER_ACCESS_FORBIDDEN');};
 await assert.rejects(context.resolveZeroTrustRequestContext(session,true),/USER_ACCESS_FORBIDDEN/);
 const api=read('supabase/functions/app-api/index.ts');
 assert.ok(api.includes('action === "assigned_owner_save" && !req.headers.get("x-gnc-session")'));
 assert.ok(api.includes('!req.headers.get("x-app-session")'));
 assert.match(api,/verifiedNativeOwnerSession/);
 assert.ok(api.includes('readSupabaseOrAppSessionFromRequest(req, supabase)'));
});


test('Invariant 279 (native owner relay headers satisfy Edge CORS while retaining canonical RPC authorization and identity)',async()=>{
 const allowed=new Set(read('supabase/functions/app-api/index.ts').match(/"Access-Control-Allow-Headers": "([^"]+)"/)[1].split(',').map(s=>s.trim().toLowerCase()));
 const sent=[];
 const context=runFunctions('assets/app-runtime.js',['fetchWithTimeout'],{AbortController,setTimeout,clearTimeout,SUPABASE_WRITE_TIMEOUT_MS:22000,SUPABASE_URL:'https://project.test',APP_API_FUNCTION_URL:'https://project.test/functions/v1/app-api',
  fetchSupabaseRestViaAppApiIfNeeded:async()=>null,window:{},fetch:async(url,request)=>{if(url.endsWith('/functions/v1/app-api'))for(const key of Object.keys(request.headers))assert.ok(allowed.has(key.toLowerCase()),'Browser preflight rejects '+key);sent.push({url,request});return new Response('{}');}
 });
 const payload={p_itemcodes:['A'],p_assignedto:'zoe_green',p_request_id:'00000000-0000-4000-8000-000000000001'};
 const headers={apikey:'public-key',Authorization:'Bearer native-session','Content-Type':'application/json',Prefer:'return=representation'};
 const options={method:'POST',headers,body:JSON.stringify(payload),ownerReplayRelay:true};
 await context.fetchWithTimeout('https://project.test/rest/v1/rpc/set_itemcode_default_owners_v1',options);
 assert.equal(sent[0].request.headers.Authorization,headers.Authorization);assert.equal(sent[0].request.headers.apikey,headers.apikey);
 assert.deepEqual(JSON.parse(sent[0].request.body),{...payload,action:'assigned_owner_save'});assert.equal(headers.Prefer,'return=representation','caller request is immutable');
 await context.fetchWithTimeout('https://project.test/rest/v1/rpc/set_itemcode_default_owners_v1',{...options,ownerReplayRelay:false});
 assert.equal(sent[1].request.headers.Prefer,headers.Prefer);assert.equal(sent[1].request.body,options.body);
});


test('Invariant 280 (owner replay runs beside the database without changing native identity or other RPC routes)',async()=>{
 const calls=[];let replay;
 const context=runFunctions('assets/app-runtime.js',['supabaseRpc'],{AbortController,
  assertEvalDataSourceAllowed:()=>{},getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer native-session'}),getSupabaseReadIdentityScope:()=> 'same-account',SUPABASE_URL:'https://project.test',SUPABASE_WRITE_TIMEOUT_MS:22000,redactEvalSensitiveData:x=>x,
  setTimeout:fn=>{replay=fn;return 1;},clearTimeout:()=>{},window:{GncDatabase:{fetchRpc:(url,name,request)=>new Promise(resolve=>calls.push({url,name,request,resolve}))}}
 });
 const body={p_itemcodes:['A'],p_assignedto:'zoe_green',p_request_id:'00000000-0000-4000-8000-000000000001'};
 const pending=context.supabaseRpc('set_itemcode_default_owners_v1',body);await new Promise(resolve=>setImmediate(resolve));replay();
 assert.equal(calls[0].request.ownerReplayRegion,undefined);assert.equal(calls[1].request.ownerReplayRegion,'us-east-1');assert.equal(calls[0].request.body,calls[1].request.body);
 calls[1].resolve(new Response(JSON.stringify({requestId:body.p_request_id})));assert.equal((await pending).requestId,body.p_request_id);
 const sent=[];const transport=runFunctions('assets/app-runtime.js',['fetchWithTimeout'],{URL,AbortController,setTimeout,clearTimeout,SUPABASE_URL:'https://project.test',APP_API_FUNCTION_URL:'https://project.test/functions/v1/app-api',SUPABASE_WRITE_TIMEOUT_MS:22000,fetchSupabaseRestViaAppApiIfNeeded:async()=>null,window:{},fetch:async(url,options)=>{sent.push({url,options});return new Response('{}');}});
 await transport.fetchWithTimeout('https://project.test/rest/v1/rpc/set_itemcode_default_owners_v1',{...calls[1].request,signal:undefined});
 assert.equal(sent[0].url,'https://project.test/functions/v1/app-api?forceFunctionRegion=us-east-1');assert.equal(sent[0].options.headers.Authorization,'Bearer native-session');assert.equal(JSON.parse(sent[0].options.body).p_request_id,body.p_request_id);
 await transport.fetchWithTimeout('https://project.test/rest/v1/rpc/other_rpc',{...calls[1].request,signal:undefined});assert.equal(sent[1].url,'https://project.test/rest/v1/rpc/other_rpc');assert.equal(sent[1].options.body,calls[1].request.body);
});


test('Invariant 281 (native owner verification overlaps fresh capability and profile reads without reusing authority across requests)',async()=>{
 const request=new Request('https://app.test',{headers:{Authorization:'Bearer native.jwt.token',apikey:'public-key'}});
 let profileStarted=false,accessStarted=false,releaseProfile,releaseAccess,defaultChecks=0;
 const profile={username:'dylan_collyge',display_name:'Dylan',role:'Admin',must_change_password:false,disabled_at:null,locked_until:null};
 const client={auth:{getUser:async()=>({data:{user:{id:'native-id'}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:()=>{profileStarted=true;return new Promise(resolve=>{releaseProfile=()=>resolve({data:profile,error:null});});}})})})};
 const auth=runFunctions('supabase/functions/_shared/app-auth.ts',['readSupabaseOrAppSessionFromRequest'],{exports:{},normalizeUsername:s=>s.trim().toLowerCase(),readSupabaseBearerRole:()=> 'authenticated',readAppSessionFromRequest:async()=>null,isAppAccountActive:async()=>{defaultChecks++;return true;}});
 const pending=auth.readSupabaseOrAppSessionFromRequest(request,client,async id=>{assert.equal(id,'native-id');accessStarted=true;return new Promise(resolve=>{releaseAccess=resolve;});});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(profileStarted,true);assert.equal(accessStarted,true,'capability verification must start before the profile response');
 releaseProfile();releaseAccess(true);const session=await pending;assert.equal(session.authUserId,'native-id');assert.equal(defaultChecks,0);
 const instantClient={auth:client.auth,from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:profile,error:null})})})})};
 assert.equal((await auth.readSupabaseOrAppSessionFromRequest(request,instantClient)).authUserId,'native-id');assert.equal(defaultChecks,1);
 assert.equal(await auth.readSupabaseOrAppSessionFromRequest(request,instantClient,async()=>false),null);
 assert.equal(await auth.readSupabaseOrAppSessionFromRequest(request,instantClient,async()=>{throw new Error('revoked');}),null);
 assert.equal(await auth.readSupabaseOrAppSessionFromRequest(request,{...instantClient,auth:{getUser:async()=>({error:new Error('bad JWT')})}},async()=>{throw new Error('must not verify an untrusted actor');}),null);
 assert.equal(await auth.readSupabaseOrAppSessionFromRequest(new Request('https://app.test',{headers:{'x-gnc-session':'legacy'}}),instantClient,async()=>{throw new Error('legacy cannot enter native verification');}),null);
 let accessReads=0;const access={username:profile.username,canonicalRole:'admin',permissions:{can_access_manager_tab:true}};
 const context=runFunctions('supabase/functions/app-api/index.ts',['resolveZeroTrustRequestContext'],{normalizeUsername:s=>String(s).trim().toLowerCase(),supabase:{},resolveActiveSessionProfile:async()=>({...profile,id:'native-id'}),resolveCanonicalUserAccess:async()=>{accessReads++;return access;}});
 const result=await context.resolveZeroTrustRequestContext(session,true,{profileId:'native-id',access});assert.equal(result.access.username,profile.username);assert.equal(accessReads,0,'the current request already verified capabilities');
 await context.resolveZeroTrustRequestContext(session,true);assert.equal(accessReads,1,'no proof survives into the next request');
 await context.resolveZeroTrustRequestContext(session,false,{profileId:'native-id',access});assert.equal(accessReads,2,'legacy still resolves current authority');
 await assert.rejects(context.resolveZeroTrustRequestContext(session,true,{profileId:'other-id',access}),/AUTH_IDENTITY_MISMATCH/);
 await assert.rejects(context.resolveZeroTrustRequestContext({...session,mustChangePassword:true},true,{profileId:'native-id',access}),/PASSWORD_CHANGE_REQUIRED/);
 await assert.rejects(context.resolveZeroTrustRequestContext(session,true,{profileId:'native-id',access:{...access,username:'another_actor'}}),/AUTH_IDENTITY_MISMATCH/);
});


test('Invariant 282 (owner capability prefetch retains the active-account cutoff check before publishing a request-local proof)',async()=>{
 const tree=syntax('supabase/functions/app-api/index.ts');let verifier;
 const visit=node=>{if(ts.isCallExpression(node)&&node.expression.getText(tree)==='readSupabaseOrAppSessionFromRequest'&&node.arguments.length===3)verifier=node.arguments[2].getText(tree);ts.forEachChild(node,visit);};visit(tree);assert.ok(verifier);
 const access={username:'dylan_collyge',canonicalRole:'admin'};let allow=true,capCalls=0,activeCalls=0;
 const context=vm.createContext({supabase:{},nativeOwnerAccessProof:null,resolveCanonicalUserAccess:async(_db,id)=>{capCalls++;assert.equal(id,'native-id');return access;},isAppAccountActive:async(_db,identity)=>{activeCalls++;assert.equal(identity.id,'native-id');return allow;}});
 vm.runInContext(ts.transpileModule('globalThis.verify='+verifier+';', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
 assert.equal(await context.verify('native-id'),true);assert.equal(context.nativeOwnerAccessProof.profileId,'native-id');assert.equal(context.nativeOwnerAccessProof.access.username,access.username);assert.equal(capCalls,1);assert.equal(activeCalls,1);
 context.nativeOwnerAccessProof=null;allow=false;assert.equal(await context.verify('native-id'),false);assert.equal(context.nativeOwnerAccessProof,null);assert.equal(capCalls,2);assert.equal(activeCalls,2);
 context.resolveCanonicalUserAccess=async()=>{throw new Error('permission revoked');};await assert.rejects(context.verify('native-id'),/permission revoked/);assert.equal(context.nativeOwnerAccessProof,null);
});


test('Invariant 283 (paged Assigned Items saves publish immediately and never preflight owner reads)',async()=>{
 const state={viewPageSource:{page:'assigned-items'}};const rows=[{ITEMCODE:'A',default_revision:2}];const events=[];let allowed=true,resolveSave,rejectSave,reads=0;
 const rpc=new Promise((resolve,reject)=>{resolveSave=resolve;rejectSave=reject;});
 const ctx=runFunctions('assets/app-runtime.js',['assignEvalItemcodes'],{canManageEvalItemcodeAssignments:()=>allowed,buildManagerEvalAssignmentKey:x=>String(x||'').toUpperCase(),parseManagerEvalAssignmentKey:x=>({itemcode:x}),isManagerAssignedSnapshotCurrent:()=>true,getManagerAssignedColumnState:()=>state,readFreshPagedAssignedDefaults:async()=>{reads++;return new Map([['A',rows[0]]]);},warehouseAssignedItemsInventory:rows,normalizeEvalAssignableUser:x=>x,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000283'},applyOptimisticItemcodeOwners:()=>{events.push('optimistic');return ()=>events.push('undo');},requestAnimationFrame:()=>{},updateManagerAssignedItemsView:()=>{},supabaseRpc:(_name,body)=>{events.push('rpc');assert.deepEqual(plain(body.p_itemcodes),['A']);return rpc;},applyAcknowledgedEvalAssignmentResults:()=>events.push('ack'),managerEvalAssignmentSelection:new Set(['A']),showToast:()=>{},scheduleManagersRender:()=>{},getManagerReportPageController:()=>({refresh:()=>events.push('refresh')}),reportSemanticHealthEvent:()=>{}});
 const pending=ctx.assignEvalItemcodes(['A'],'mitch_kaiser');assert.deepEqual(events,['optimistic','rpc']);assert.equal(reads,0);assert.equal(state.defaultPending.has('A'),true);
 assert.equal(await ctx.assignEvalItemcodes(['A'],'zoe_green'),false);assert.equal(events.length,2);resolveSave({ok:true});assert.equal(await pending,false);assert.ok(events.includes('ack'));assert.equal(state.defaultPending.size,0);
 allowed=false;assert.equal(await ctx.assignEvalItemcodes(['A'],'zoe_green'),false);assert.equal(reads,0);
 allowed=true;events.length=0;ctx.supabaseRpc=async()=>{throw new Error('server denied');};assert.equal(await ctx.assignEvalItemcodes(['A'],'zoe_green'),false);assert.deepEqual(events,['optimistic','undo']);
});


test('Invariant 284 (owner acknowledgments normalize only returned rows and retain unrelated row objects)',()=>{
 const rows=Array.from({length:9487},(_,i)=>({master_unique_id:'row-'+i,ITEMCODE:'I'+i,revision:1,present_in_drive:i!==9486,ASSIGNEDTO:'zoe_green',DEFAULT_ASSIGNEDTO:'zoe_green'}));const untouched=rows[3];const state={};let normalized=0;
 const ctx=runFunctions('assets/app-runtime.js',['applyAcknowledgedEvalAssignmentResults'],{warehouseAssignedItemsInventory:rows,currentUser:'dylan_collyge',getManagerAssignedColumnState:()=>state,unwrapEvalAssignmentRpcRow:x=>x,normalizeWarehouseAssignedItemRow:r=>{normalized++;return {...r,ITEMCODE:r.itemcode||r.ITEMCODE};},clearWarehouseAssignedItemCaches:()=>{},invalidateManagerEvalReport2Cache:()=>{}});
 const receipt={contractVersion:'inventory-row-assignments-v1',defaults:[{itemcode:'I2',assignedto:'mitch_kaiser',revision:2}],assignments:[{master_unique_id:'row-2',itemcode:'I2',revision:2,default_revision:2,assignedto:'mitch_kaiser',present_in_drive:true}]};
 assert.equal(ctx.applyAcknowledgedEvalAssignmentResults([], [receipt]),1);assert.equal(normalized,1);assert.equal(ctx.warehouseAssignedItemsInventory.length,9486);assert.equal(ctx.warehouseAssignedItemsInventory.find(r=>r.master_unique_id==='row-3'),untouched);assert.equal(ctx.warehouseAssignedItemsInventory.find(r=>r.master_unique_id==='row-2').ASSIGNEDTO,'mitch_kaiser');assert.equal(state.ownerReceiptUser,'dylan_collyge');assert.equal(state.ownerReceipts.get('row-2').revision,2);
 receipt.assignments[0].revision=1;receipt.assignments[0].default_revision=1;receipt.assignments[0].assignedto='zoe_green';receipt.defaults=[];normalized=0;ctx.applyAcknowledgedEvalAssignmentResults([], [receipt]);assert.equal(normalized,0);assert.equal(ctx.warehouseAssignedItemsInventory.find(r=>r.master_unique_id==='row-2').ASSIGNEDTO,'mitch_kaiser');
});

test('Invariant 285 (RPCs reuse the contract-validated JSON receipt without a second body read)',async()=>{
 const receipt={requestId:'durable',defaults:[{itemcode:'A',assignedto:'zoe_green'}]};const response=new Response(JSON.stringify(receipt));Object.defineProperty(response,'__gncValidatedData',{value:receipt});response.text=async()=>{throw new Error('duplicate body read');};let redacted=0;
 const ctx=runFunctions('assets/app-runtime.js',['supabaseRpc'],{AbortController,getSupabaseReadIdentityScope:()=> 'account-a',setTimeout:()=>1,clearTimeout:()=>{},assertEvalDataSourceAllowed:()=>{},getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer native-session'}),SUPABASE_URL:'https://example.test',SUPABASE_WRITE_TIMEOUT_MS:1000,redactEvalSensitiveData:value=>{redacted++;return value;},window:{GncDatabase:{fetchRpc:async()=>response}}});
 assert.equal(await ctx.supabaseRpc('set_itemcode_default_owners_v1',{p_itemcodes:['A'],p_request_id:'00000000-0000-4000-8000-000000000285'}),receipt);assert.equal(redacted,1);
 ctx.window.GncDatabase.fetchRpc=async()=>new Response(JSON.stringify({fallback:true}));assert.equal((await ctx.supabaseRpc('set_itemcode_default_owners_v1',{p_itemcodes:['A'],p_request_id:'00000000-0000-4000-8000-000000000285'})).fallback,true);assert.equal(redacted,2);
});


test('Invariant 286 (batch owner saves scan displayed rows once before optimistic dispatch)',async()=>{
 const rows=Array.from({length:9487},(_,i)=>({ITEMCODE:'I'+i,default_revision:i}));const codes=rows.slice(-45).map(r=>r.ITEMCODE);const state={};let lookups=0,dispatches=0;
 const ctx=runFunctions('assets/app-runtime.js',['assignEvalItemcodes'],{canManageEvalItemcodeAssignments:()=>true,buildManagerEvalAssignmentKey:x=>{lookups++;return x;},parseManagerEvalAssignmentKey:x=>({itemcode:x}),isManagerAssignedSnapshotCurrent:()=>true,getManagerAssignedColumnState:()=>state,warehouseAssignedItemsInventory:rows,normalizeEvalAssignableUser:x=>x,crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000286'},applyOptimisticItemcodeOwners:()=>()=>{},requestAnimationFrame:()=>{},updateManagerAssignedItemsView:()=>{},supabaseRpc:async()=>{dispatches++;return {};},applyAcknowledgedEvalAssignmentResults:()=>{},managerEvalAssignmentSelection:new Set(),showToast:()=>{},scheduleManagersRender:()=>{},reloadWarehouseAssignmentsAfterMutation:async()=>{},reportSemanticHealthEvent:()=>{}});
 await ctx.assignEvalItemcodes(codes,'mitch_kaiser');assert.equal(dispatches,1);assert.ok(lookups<=rows.length+codes.length*2,'one scan must replace one full scan per item');
});


test('Invariant 287 (row owner dropdown sends every checked visible item through one canonical batch)',async()=>{
 const calls=[],select={value:''};let selected=[{ITEMCODE:'A'},{ITEMCODE:'A'},{ITEMCODE:'B'}];
 const ctx=runFunctions('assets/app-runtime.js',['assignManagerCheckedItemcodes'],{getManagerAssignedSelectionSnapshot:()=>({selectedRows:selected}),buildManagerEvalAssignmentKey:x=>x,document:{getElementById:()=>select},assignEvalItemcodes:async(codes,owner)=>{calls.push({codes:Array.from(codes),owner});return true;}});
 await ctx.assignManagerCheckedItemcodes('A','abigail_vazquez');assert.deepEqual(calls,[{codes:['A','B'],owner:'abigail_vazquez'}]);assert.equal(select.value,'abigail_vazquez');
 selected=[];await ctx.assignManagerCheckedItemcodes('C','');assert.deepEqual(calls[1],{codes:['C'],owner:''});
});

test('Invariant 288 (holdreason is authoritative and model medians never manufacture a recovery threshold)',()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(read('assets/smart-hold-intelligence.js'),ctx);const H=ctx.AgDataHoldIntelligence;
 assert.equal(H.holdReason({holdreason:'size',holdstopreason:'ignored',spec:'Sheared',av_note:'flushing'}).exact,'size');assert.equal(H.holdReason({holdreason:'',holdstopreason:'stale'}).held,false);
 const row={itemcode:'A',holdreason:'size'},risk=H.holdRisk(row,[],[],'2026-10-31');assert.equal(risk.recovery,null);assert.equal(risk.offDate,'');
 const model=[{itemcode:'A',holdreason:'size',completed_cycles:2,sample_count:2,recovery:70,onset:35,on_date:'2026-10-30',as_of:'2026-10-31',elapsed_gdd:35}];
 const weather=[{date:'2026-10-31',high:70,low:50}];const known=H.holdRisk(row,weather,model,'2026-10-31');assert.equal(known.offRemaining,35);assert.equal(known.offDate,'2026-11-01');
});

test('Invariant 289 (shearing requires recorded Sheared history and retains unknown outbound conflicts)',()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(read('assets/smart-hold-intelligence.js'),ctx);const H=ctx.AgDataHoldIntelligence;
 const row={itemcode:'A',locationcode:'L',lotcode:'X'},index=H.buildLoadIndex([{...row,quantityordered:12,quantityshipped:2,planstart:'2026-11-02'}]);
 const unknown=H.shearGuard(row,index,[],[{itemcode:'A',holdreason:'size',completed_cycles:1,sample_count:1,recovery:1}],[],'2026-10-31');assert.equal(unknown.conflict,true);assert.equal(unknown.recovery,null);assert.equal(unknown.qty,10);
 const history=[{itemcode:'A',holdreason:'Sheared*',completed_cycles:1,sample_count:1,recovery:35}];const weather=Array.from({length:3},(_,i)=>({date:H.addDays('2026-10-31',i),high:70,low:50}));assert.equal(H.shearGuard(row,index,weather,history,[],'2026-10-31').conflict,false);
});


test('Invariant 290 (Suspend detail Mark Done saves exact evidence without issuing tag completion)',async()=>{
 const row={UNIQUE_ID:'tag'},calls=[],button={disabled:false};
 const ctx=runFunctions('assets/app-runtime.js',['saveDockSuspendDcRequestMirrorData'],{activeItem:row,window:{},findLinkedMasterRow:()=>row,getSuspendTagInventoryIdentity:()=>({masterUid:'tag'}),matchesSuspendTagInventoryIdentity:()=>true,beginRowEvaluationMemoryPublication:()=>()=>{},detailReturnState:null,scheduleRequestRender:()=>{},applyExplicitAvNotePayload:()=>{},readRowEvaluationDraft:()=>({}),getDockSuspendDcRequestSourceUid:()=> 'tag',restoreCapturedPhotoFields:()=>{},mergeActiveItemDetailPhotoFields:()=>{},clearSavedRowEvaluationDraft:()=>{},isDockSuspendDcRequestMirrorRow:()=>true,getSupabaseReadIdentityScope:()=> 'actor',canUseProductionLiveSync:()=>false,canCurrentUserViewDockSuspendDcRequests:()=>true,requireCurrentSuspendTagWriteProof:()=>true,getSuspendTagStatus:()=> 'pending',canCurrentUserWorkRequestItem:(r,action)=>{assert.equal(r,row);assert.equal(action,'edit');return true;},document:{getElementById:()=>button},isViewVisible:()=>false,findDockSuspendDcRequestSourceRow:()=>row,getPendingPhotoUploadsForItem:()=>[],syncDockSuspendDcRequestPhotoAliases:()=>{},mergePhotoCsvList:a=>a.filter(Boolean).join(','),buildDockSuspendDcRequestNote:()=> 'note',firstNonEmptyValue:(...a)=>a.find(Boolean)||'',getDockSuspendDcRequestCompletionReadiness:()=>({ready:true}),getSuspendTagFormDraftKey:()=> 'tag',suspendTagFormDrafts:new Map(),runSuspendTagRowCommand:async(op,r,patch)=>{calls.push({op,r,patch});return true;},restoreSuspendTagFormDraft:()=>{},showToast:()=>{},suspendTagErrorMessage:e=>{throw e;}});
 await ctx.saveDockSuspendDcRequestMirrorData(true,row,false,{suspendTagValues:{spec:'16-18 H',caliper:'',avNote:'Full body',match:''}});assert.equal(calls.length,1);assert.equal(calls[0].op,'save');assert.equal(calls[0].r,row);assert.equal(calls[0].patch.dock_spec,'16-18 H');assert.equal(button.disabled,false);
});

test('Invariant 291 (acknowledged owner rows retain the mapped display cache without a full remap)',()=>{
 const row={master_unique_id:'A',ITEMCODE:'A',default_revision:1,default_owner:'old'},state={displayCache:{input:[],rows:[row],signature:'before'}};let normalized=0;
 const ctx=runFunctions('assets/app-runtime.js',['applyAcknowledgedEvalAssignmentResults','unwrapEvalAssignmentRpcRow'],{warehouseAssignedItemsInventory:[row],fullInventory:state.displayCache.input,currentUser:'dylan_collyge',getManagerAssignedColumnState:()=>state,normalizeWarehouseAssignedItemRow:r=>{normalized++;return r;},clearWarehouseAssignedItemCaches:()=>{},invalidateManagerEvalReport2Cache:()=>{},getManagerAssignedDisplaySignature:()=> 'current',getManagerItemLowStockTargetsState:()=>({revision:1})});
 ctx.applyAcknowledgedEvalAssignmentResults([],[{contractVersion:'inventory-row-assignments-v1',assignments:[{master_unique_id:'A',itemcode:'A',revision:2,present_in_drive:true}],defaults:[{itemcode:'A',assignedto:'new',revision:2}]}]);assert.equal(row.default_owner,'new');assert.equal(row.effective_worker,'new');assert.equal(state.displayCache.signature,'current');assert.equal(normalized,1);
});


test('Invariant 292 (role and user permission patches preserve unrelated views and rep overrides)',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('assets/user-access-control.js'),ctx);const access=ctx.GncUserAccessControl;
 const original={make_request:'Y',can_make_request:'Y',view_permissions:{view_av:'N',view_docks:'Y'},sales_rep_access:{a:'N',b:'Y'}};
 const view=access.patchAccessPermission(original,'view_av','Y');assert.equal(view.view_permissions.view_av,'Y');assert.equal(view.view_permissions.view_docks,'Y');assert.equal(original.view_permissions.view_av,'N');
 const rep=access.patchAccessPermission(original,'rep:b','N');assert.equal(rep.sales_rep_access.a,'N');assert.equal(rep.sales_rep_access.b,'N');assert.equal(rep.request_all_reps,'N');assert.equal(original.sales_rep_access.b,'Y');
 const alias=access.patchAccessPermission(original,'make_request','N');assert.equal(alias.can_make_request,'N');assert.equal(access.accessPermissionColumns('views').some(([key])=>key==='legacy:can_access_eval_reports_2'),true);
});


test('Invariant 293 (explicit selected and all-filtered toolbar actions use their exact independent targets)',()=>{
 const calls=[],snapshot={codes:new Set(['A','B','C']),selectedRows:[{ITEMCODE:'B'}],filtered:true};
 const ctx=runFunctions('assets/app-runtime.js',['assignSelectedEvalItemcodes'],{document:{getElementById:()=>({value:'abigail_vazquez'})},getManagerAssignedSelectionSnapshot:()=>snapshot,buildManagerEvalAssignmentKey:x=>x,assignEvalItemcodes:(codes,owner)=>calls.push({codes:[...codes],owner})});
 ctx.assignSelectedEvalItemcodes(false);ctx.assignSelectedEvalItemcodes(true);snapshot.selectedRows=[];ctx.assignSelectedEvalItemcodes(false);
 assert.deepEqual(calls.map(c=>c.codes),[['B'],['A','B','C'],[]]);assert.ok(calls.every(c=>c.owner==='abigail_vazquez'));
});


test('Invariant 294 (low-stock sync scopes reuse canonical ItemCodes and invalidate for source or account changes)',()=>{
 let calls=0;const ctx=runFunctions('assets/app-runtime.js',['getManagerItemLowStockTargetCodes'],{managerItemLowStockCodesCache:null,currentUser:'one',warehouseAssignedItemsInventory:[{itemcode:'B'}],fullInventory:[{ITEMCODE:'A'}],getDatasetLoadSignature:()=> 'ready',normalizeManagerItemLowStockTargetCode:c=>{calls++;return c;}});
 const first=ctx.getManagerItemLowStockTargetCodes();for(let i=0;i<100;i++)assert.equal(ctx.getManagerItemLowStockTargetCodes(),first);assert.equal(calls,2);
 ctx.warehouseAssignedItemsInventory=[{itemcode:'C'}];assert.deepEqual(Array.from(ctx.getManagerItemLowStockTargetCodes()),['A','C']);assert.equal(calls,4);ctx.currentUser='two';ctx.getManagerItemLowStockTargetCodes();assert.equal(calls,6);ctx.fullInventory.push({ITEMCODE:'D'});assert.deepEqual(Array.from(ctx.getManagerItemLowStockTargetCodes()),['A','C','D']);
});


test('Invariant 295 (a stale permission receipt cannot release another account inflight lock)',async()=>{
 let finish;const pending=new Set(),ctx=runFunctions('assets/user-access-control.js',['saveAccessPermission'],{requireVerifiedManager:()=>{},matrixSaves:pending,getIdentity:()=>({id:'a'}),generation:1,normalizeRole:x=>x,clone:v=>structuredClone(v),state:{userAccess:[],roleMatrices:[]},directoryRecord:{users:[]},patchAccessPermission:(r,k,v)=>({...r,[k]:v}),publish:()=>{},makeCommandId:()=> 'command',transport:()=>new Promise(resolve=>{finish=resolve;})});
 const saving=ctx.saveAccessPermission('role','evaluator','create_project','N');ctx.generation=2;pending.clear();pending.add('role:evaluator');finish({ok:true,matrixRows:[]});await assert.rejects(saving,/USER_ACCESS_ACCOUNT_CHANGED/);assert.equal(pending.has('role:evaluator'),true);
});


test('Invariant 296 (pinned Manager workspace scrolling never clips another active view)',async()=>{
 const {JSDOM}=await import('jsdom');const dom=new JSDOM('<body class="current-view-managers viewport-phone"><div id="app-wrapper"><div id="main-scroll-area"><div id="view-wrapper"><div class="assigned-items-workspace"></div></div></div></div></body>');
 const css=read('assets/app-shell-style-05.css'),selector=css.match(/([^{}]+:has\(\.assigned-items-workspace\)[^{}]*)\{overflow:hidden!important\}/)[1].trim();
 assert.ok(dom.window.document.querySelector(selector));dom.window.document.body.className='current-view-home viewport-phone';assert.equal(dom.window.document.querySelector(selector),null);dom.window.close();
});


test('Invariant 297 (explicit single-write owner batches preserve native authorization and durable receipt timing)',async()=>{
 let finish,calls=0;const ctx=runFunctions('assets/app-runtime.js',['supabaseRpc'],{assertEvalDataSourceAllowed:()=>{},getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer verified'}),SUPABASE_URL:'https://project.test',SUPABASE_WRITE_TIMEOUT_MS:22000,redactEvalSensitiveData:x=>x,window:{GncDatabase:{fetchRpc:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}}}});
 let done=false;const pending=ctx.supabaseRpc('set_itemcode_default_owners_v1',{p_itemcodes:['A','B','C'],p_assignedto:'abigail_vazquez',p_request_id:'00000000-0000-4000-8000-000000000001'},{singleWrite:true}).then(v=>{done=true;return v;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);assert.equal(done,false);finish(new Response(JSON.stringify({contractVersion:'inventory-row-assignments-v1',assignments:[]})));assert.equal((await pending).contractVersion,'inventory-row-assignments-v1');assert.equal(calls,1);
});

test('Invariant 298 (real summary reasons and profile thresholds drive remaining GDD without note inference)',()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(read('assets/smart-hold-intelligence.js'),ctx);const H=ctx.AgDataHoldIntelligence;
 const history=H.historicalModels({summaries:[{itemcode:'A',current_holdstopreason:'Sheared*',open_episode_start_date:'2026-10-30',last_release_date:'2026-10-30',median_gdd_base_50_to_release:105,released_cycle_count:2}],profiles:[{itemcode:'A',hold_reason_category:'Sheared*',median_gdd_base_50_30d:70}]});
 const weather=[{date:'2026-10-30',high:70,low:50},{date:'2026-10-31',high:70,low:50},{date:'2026-11-01',high:70,low:50}];
 const clear=H.holdRisk({itemcode:'A',holdstopreason:'',spec:'sheared'},weather,history,'2026-10-31');assert.equal(clear.held,false);assert.equal(clear.onRemaining,35);assert.equal(clear.onDate,'2026-11-01');
 const held=H.holdRisk({itemcode:'A',holdstopreason:'Sheared*'},weather,history,'2026-10-31');assert.equal(held.offRemaining,70);assert.equal(held.offDate,'2026-11-02');assert.equal(H.holdReason({av_note:'SHEARED',spec:'size'}).exact,'');assert.deepEqual(Array.from(H.reasonsFor([],history)),['Sheared*']);
});

test('Invariant 299 (nursery stages consolidate before filling and keep shift lots and whole beds distinct)',()=>{
 const ctx=vm.createContext({Intl,Date});vm.runInContext(read('assets/smart-hold-intelligence.js'),ctx);const H=ctx.AgDataHoldIntelligence;
 assert.equal(H.nurseryStages.length,12);assert.equal(H.nurseryStages[2].label,'Consolidate Inventory');assert.equal(H.nurseryStages[3].label,'Can Filling');assert.equal(H.nurseryStages[4].label,'Plant');
 const row={itemcode:'A',locationcode:'L1',lotcode:'27.F1',salesyear:2027};assert.equal(H.wholeGroupKey(row),H.wholeGroupKey({...row,lotcode:'27.S1'}));assert.notEqual(H.wholeGroupKey(row),H.wholeGroupKey({...row,locationcode:'L2'}));assert.notEqual(H.wholeGroupKey(row),H.wholeGroupKey({...row,salesyear:2028}));
 assert.equal(H.isShiftLot({...row,lotcode:'27.Y'}),true);assert.equal(H.lifecycleFor({...row,season:'Y'},3).stage,5);assert.deepEqual(Array.from(H.seasonalWorkflow('overwinter')),['Bunch Notes','Bunch Counts','House Cover']);assert.deepEqual(Array.from(H.seasonalWorkflow('spring')),['Spread Notes','Spread Counts','Pull Shade']);
});

test('Invariant 300 (direct hold fallback fixtures accept exact scoped reads and reject forged or unbounded requests)',async()=>{
 const {smartHoldDirectReadFixture:f}=await import('./helpers/release-smoke-route-policy.mjs');const url='https://kzrnyjsosryejjejliii.supabase.co/rest/v1/ph_hold_stop_itemcode_summaries?select=*&itemcode=in.(A,B)&order=unique_id.asc&limit=30&offset=0';assert.deepEqual(f('GET',url),[]);assert.equal(f('POST',url),null);assert.equal(f('GET',url+'&actor=dylan_collyge'),null);assert.equal(f('GET',url.replace('in.(A,B)','in.(*)')),null);
});


test('Invariant 301 (unchanged owner selections still obtain separate authorized durable command receipts)',async()=>{
 const calls=[];const ctx=runFunctions('assets/app-runtime.js',['supabaseRpc'],{assertEvalDataSourceAllowed:()=>{},getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer verified'}),SUPABASE_URL:'https://project.test',SUPABASE_WRITE_TIMEOUT_MS:22000,redactEvalSensitiveData:x=>x,window:{GncDatabase:{fetchRpc:async(u,n,r)=>{calls.push(JSON.parse(r.body));return new Response(JSON.stringify({requestId:JSON.parse(r.body).p_request_id}));}}}});
 for(const p_request_id of ['first','second'])assert.equal((await ctx.supabaseRpc('set_itemcode_default_owners_v1',{p_itemcodes:['A'],p_assignedto:'owner',p_request_id},{singleWrite:true})).requestId,p_request_id);
 assert.equal(calls.length,2);const sql=read('supabase/migrations/20261101010000_agdata_v23127_permissions_and_hold_history.sql');assert.match(sql,/unchanged authorized command[^]*if exists[^]*d.assignedto is distinct from[^]*with requested as materialized/);assert.match(sql,/insert into private.ph_itemcode_default_owner_commands/);
});


test('Invariant 302 (owner-only paints reuse mounted rows and defer full filtering until writes settle)',()=>{
 const timers=[],rows=[{ITEMCODE:'A',DEFAULT_ASSIGNEDTO:'abigail_vazquez'}],updates=[],state={viewProps:{rows},viewHost:{isConnected:true},view:{update:p=>updates.push(p)},defaultDrafts:{A:{assignedto:'abigail_vazquez'}},defaultPending:new Set(['A'])};
 const ctx=runFunctions('assets/app-runtime.js',['updateManagerAssignedItemsView'],{getManagerAssignedColumnState:()=>state,managerEvalAssignmentSelection:new Set(['A']),clearTimeout:()=>{},setTimeout:fn=>{timers.push(fn);return timers.length;},getManagerAssignedItemsViewProps:()=>{throw Error('Unexpected full row rebuild');}});
 ctx.updateManagerAssignedItemsView({ownerOnly:true});assert.equal(updates.length,1);assert.equal(updates[0].rows,rows);assert.equal(updates[0].ownerDrafts.A.assignedto,'abigail_vazquez');assert.equal(updates[0].pendingCodes.has('A'),true);timers[0]();assert.equal(updates.length,1);
});


test('Invariant 303 (background inventory decoding yields to owner writes without delaying mutations or access reads)',async()=>{
 const state={defaultPending:new Set(['A']),ownerWriteAt:0};let ticks=0;
 const ctx=runFunctions('assets/app-runtime.js',['waitForInteractiveOwnerWrites'],{managerAssignedColumnState:state,Date:{now:()=>10000+ticks*25},setTimeout:fn=>{ticks++;state.defaultPending.clear();fn();}});
 await ctx.waitForInteractiveOwnerWrites('https://project/rest/v1/user_access?select=*',{method:'GET'});await ctx.waitForInteractiveOwnerWrites('https://project/rest/v1/rpc/set_itemcode_default_owners_v1',{method:'POST'});assert.equal(ticks,0);
 await ctx.waitForInteractiveOwnerWrites('https://project/rest/v1/ph_master_inventory?select=*',{method:'GET'});assert.equal(ticks,1);state.defaultPending.add('A');await assert.rejects(ctx.waitForInteractiveOwnerWrites('https://project/rest/v1/ph_master_inventory?select=*',{method:'GET',signal:{aborted:true}}),e=>e.code==='REQUEST_ABORTED');
});


test('Invariant 304 (partial owner previews cannot replace an already displayed larger assignment snapshot)',()=>{
 const ctx=runFunctions('assets/app-runtime.js',['previewProductionSnapshots'],{hasProductionLiveSyncDraft:()=>false,getDatasetRenderRowCount:()=>9485});
 assert.equal(ctx.previewProductionSnapshots([{adapter:{id:'core:warehouseAssignedItems'},value:{rowCount:1000,rowCompleteness:'partial'}}],{progressive:true,visible:true,view:'managers'}),false);
});


test('Invariant 305 (role confirmations count canonical committed rows instead of only active directory entries)',async()=>{
 const ctx=runFunctions('assets/user-access-control.js',['saveAccessPermission'],{requireVerifiedManager:()=>{},matrixSaves:new Set(),getIdentity:()=>({id:'a'}),generation:1,normalizeRole:x=>x,clone:v=>structuredClone(v),state:{userAccess:[],roleMatrices:[]},directoryRecord:{users:[]},patchAccessPermission:(r,k,v)=>({...r,[k]:v}),publish:()=>{},makeCommandId:()=> 'command',transport:async()=>({ok:true,matrixRows:[{username:'one'},{username:'two'}]}),setAccessMatrixRows:()=>{}});
 assert.equal((await ctx.saveAccessPermission('role','evaluator','create_project','Y')).count,2);
});


test('Invariant 306 (territory rep aliases share one identity and master denial survives merging)', () => invariant306({ read }));


test('Invariant 307 (verified identity cache expires and invalidates without caching mutation authority)',async()=>{
 const entries=new Map();let now=1000;const ctx=runFunctions('supabase/functions/app-api/index.ts',['readVerifiedWriteSession','rememberVerifiedWriteSession','invalidateVerifiedWriteSessions','verifiedWriteSessionKey'],{verifiedWriteSessions:entries,VERIFIED_WRITE_SESSION_TTL_MS:60000,verifiedWriteSessionEpoch:0,Date:{now:()=>now},crypto:globalThis.crypto,TextEncoder,Uint8Array,atob});
 const req=new Request('https://app.test',{headers:{Authorization:'Bearer a.'+btoa(JSON.stringify({exp:120}))+'.signature'}}),session={authUserId:'actor',username:'chance_alldredge',mustChangePassword:false};const key=await ctx.verifiedWriteSessionKey(req);assert.equal(key.length,64);
 ctx.rememberVerifiedWriteSession(key,req,session,0);assert.equal(ctx.readVerifiedWriteSession(key).authUserId,'actor');now=61000;assert.equal(ctx.readVerifiedWriteSession(key),null);
 now=1000;ctx.rememberVerifiedWriteSession(key,req,session,0);ctx.invalidateVerifiedWriteSessions();assert.equal(ctx.readVerifiedWriteSession(key),null);ctx.rememberVerifiedWriteSession(key,req,session,0);assert.equal(entries.size,0);
 assert.equal(await ctx.verifiedWriteSessionKey(new Request('https://app.test',{headers:{'x-gnc-session':'legacy'}})),'');
 const sql=read('supabase/migrations/20261101020000_agdata_v23127_canonical_sales_reps.sql');assert.match(sql,/bool_or\(value='N'\)/);assert.match(sql,/sync_access_matrix_aliases_v23119/);
});


test('Invariant 308 (canonical Request options retain every physical ERP rep ID)',()=>{
 const roster=vm.createContext({});vm.runInContext(read('assets/user-access-control.js'),roster);
 const ctx=runFunctions('assets/app-runtime.js',['normalizeRepMatchToken','normalizeRepDisplayOrder','buildRequestModalRepOption','mergeRequestModalRepOptions'],{window:{GncUserAccessControl:roster.GncUserAccessControl}});
 const rows=ctx.mergeRequestModalRepOptions([{label:'Alldredge, Chance - South TX',salesrepId:'south'},{label:'Chance Alldredge',salesrepId:'primary'}]);assert.equal(rows.length,1);assert.equal(rows[0].label,'Chance Alldredge');assert.deepEqual(Array.from(rows[0].salesrepIds).sort(),['primary','south']);assert.equal(rows[0].salesrepId,'');
});


test('Invariant 309 (rep display indexing reuses roster work and invalidates when the safe roster changes)',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('assets/user-access-control.js'),ctx);const access=ctx.GncUserAccessControl;let reads=0;
 access.state.userAccess.push({get username(){reads++;return 'sample_rep';},role:'REP'});assert.equal(access.formatSalesRepDisplayName('Sample Rep - North'),'Sample Rep');const initial=reads;for(let i=0;i<100;i++)assert.equal(access.formatSalesRepDisplayName('Sample Rep - North'),'Sample Rep');assert.equal(reads,initial);
 assert.equal(access.formatSalesRepDisplayName('Another Rep - South'),'Another Rep - South');access.setAccessMatrixRows([{username:'another_rep',role:'REP'}]);assert.equal(access.formatSalesRepDisplayName('Another Rep - South'),'Another Rep');
});


test('Invariant 310 (bulk decoding cannot outwait active saves and block their receipts)',async()=>{
 const state={defaultPending:new Set(['A']),ownerWriteAt:0};let ticks=0,clock=0;
 const ctx=runFunctions('assets/app-runtime.js',['waitForInteractiveOwnerWrites'],{managerAssignedColumnState:state,Date:{now:()=>clock+=1000},setTimeout:fn=>{ticks++;if(ticks===7)state.defaultPending.clear();fn();}});
 await ctx.waitForInteractiveOwnerWrites('https://project/rest/v1/ph_inventory_row_assignments?select=*',{method:'GET'});assert.equal(ticks,7);assert.equal(state.defaultPending.size,0);
});


test('Invariant 311 (snapshot preparation yields until interactive writes release the scheduler)',async()=>{
 let release,checked=0,held=0;const ctx=runFunctions('assets/app-runtime.js',['createMasterPreparationYieldController'],{MASTER_PREPARATION_MAX_ROWS_PER_YIELD:1,MASTER_PREPARATION_TIME_BUDGET_MS:8,yieldToUiFrame:async()=>{},waitForInteractiveOwnerWrites:async()=>{held++;await new Promise(resolve=>release=resolve);}});
 const pending=ctx.createMasterPreparationYieldController(()=>checked++)();await new Promise(resolve=>setImmediate(resolve));assert.equal(held,1);assert.equal(checked,0);release();await pending;assert.equal(checked,1);
});

test('Invariant 312 (nursery permission follows the super-admin role and explicit matrix N)',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('assets/user-access-control.js'),ctx);const access=ctx.GncUserAccessControl;
 access.setAccessMatrixRows([{username:'dylan_collyge',role:'super-admin'}]);
 assert.equal(access.resolveUserAccessMatrix('dylan_collyge').view_nursery_command_tables,'Y');
 assert.equal(access.resolveUserAccessMatrix('megan_kelly','ADMIN').view_nursery_command_tables,'N');
 access.setAccessMatrixRows([{username:'megan_kelly',role:'Admin',view_permissions:{view_nursery_command_tables:'N'}}]);
 assert.equal(access.resolveUserAccessMatrix('megan_kelly').view_nursery_command_tables,'N');
});

test('Invariant 313 (Production Schedule filters physical AX even when another warehouse column says 10)',async()=>{
 const {mapProductionScheduleRecords}=await import('../supabase/functions/_shared/erp-sync.mjs');
 const rows=['10','20'].map(warehouse=>{const row=Array(250).fill('');row[49]=warehouse;row[62]='001000.030.1';row[54]='100';row[200]='10';return row;});
 const result=mapProductionScheduleRecords(rows);assert.equal(result.rows.length,1);assert.equal(result.rows[0]._warehouse,'10');
});

test('Invariant 314 (nursery capacity uses native warehouse and physical on-hand fields)',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('assets/nursery-command-model.js'),ctx);
 const refs={ph_nursery_locations:[{location_code:'G.10.000',total_beds:101}],ph_nursery_items_cpb:[{itemcode:'001000.030.1',cpb:100}]};
 const inventory=[{warehousei:'10',itemcode:'001000.030.1',locationcode:'G.10.030',ptronhand:500,source:'LD',saleyear:'2027',lotcode:'27.F1'}];
 assert.equal(ctx.GncNurseryModel.compile(inventory,refs).kpis['Occupied Beds'],5);
 inventory[0].ptronhand=600;assert.equal(ctx.GncNurseryModel.compile(inventory,refs).kpis['Occupied Beds'],6);
});

test('Invariant 315 (Production Schedule is tracked independently of the five operational sources)', productionScheduleContract);

test('Invariant 316 (nursery controller initializes without duplicate lexical declarations or eager DOM access)',()=>{
 const ctx=vm.createContext({});ctx.window=ctx;vm.runInContext(read('assets/nursery-command-model.js'),ctx);vm.runInContext(read('assets/nursery-command-tables.js'),ctx);
 assert.equal(ctx.GncNurseryModel.TABLES.length,9);assert.equal(typeof ctx.GncNurseryTables.mount,'function');
});

test('Invariant 317 (nursery native RPC passes the canonical transport contract before dispatch)',async()=>{
 const {build}=await import('esbuild');
 const bundled=await build({entryPoints:['services/databaseRest.ts'],bundle:true,format:'cjs',platform:'node',write:false,logLevel:'silent'});
 const context=vm.createContext({exports:{},module:{exports:{}},Response,Request,Headers,URL,AbortController});vm.runInContext(bundled.outputFiles[0].text,context);
 assert.equal(context.module.exports.rpcName('nursery_command_v23127'),'nursery_command_v23127');
 assert.throws(()=>context.module.exports.rpcName('unregistered_nursery_operation'),/Unknown database operation/);
 const {nurseryCommandReadFixture}=await import('./helpers/release-smoke-route-policy.mjs');
 const url='https://kzrnyjsosryejjejliii.supabase.co/rest/v1/rpc/nursery_command_v23127',body={p_table:'ph_nursery_locations',p_operation:'read',p_payload:{limit:1000,offset:0}};
 assert.deepEqual(nurseryCommandReadFixture('POST',url,body),{rows:[]});assert.equal(nurseryCommandReadFixture('POST',url,{...body,p_operation:'save'}),null);assert.equal(nurseryCommandReadFixture('POST',url,{...body,p_payload:{...body.p_payload,unknown:true}}),null);
});

test('Invariant 318 (exact WH10 schedule columns and split-block tier priority)',async()=>{
 const {mapProductionScheduleRecords,parseNurseryBlockAllocations}=await import('../supabase/functions/_shared/erp-sync.mjs');
 const row=Array(476).fill('');Object.assign(row,{49:'WH 10',50:'.27.1',52:'615',54:'0',61:'LD',62:'001000.030.1',66:'Abelia',68:'Plant',76:'100',204:'D22=280+E17=335',152:'G10',423:'G11',475:'A1'});
 const scheduled=mapProductionScheduleRecords([row]).rows[0];assert.equal(scheduled.planned_qty,615);assert.equal(scheduled.req_qty,615);assert.equal(scheduled.beds_needed,6.15);
 assert.deepEqual(parseNurseryBlockAllocations('D22=280+E17=335'),[{location:'D.22.000',weight:280},{location:'E.17.000',weight:335}]);for(const invalid of ['0','#N/A','FALSE','A00','A27'])assert.deepEqual(parseNurseryBlockAllocations(invalid),[]);
 for(const change of [{49:'20'},{61:'>'},{52:'0',54:'0'}])assert.equal(mapProductionScheduleRecords([Object.assign([...row],change)]).rows.length,0);
 const alternate=mapProductionScheduleRecords([Object.assign([...row],{62:'',203:'002000.030.1',61:'',207:'LM'})]).rows[0];assert.equal(alternate.itemcode,'002000.030.1');assert.equal(alternate.source,'LM');
 const ctx=vm.createContext({});vm.runInContext(read('assets/nursery-command-model.js'),ctx);const model=ctx.GncNurseryModel;
 const refs={ph_nursery_locations:['D.22.000','E.17.000','G.10.000','G.11.000','A.01.000'].map(location_code=>({location_code,total_beds:100,permanent_shade:'N',house_orientation:'East-West'})),ph_nursery_water_rating:[{common_name:'Plant',genus:'Abelia',hydro_zone:'Z2'}],ph_prod_schedule_active:[scheduled]};
 let result=model.compile([],refs,{location:'ALL_LOCATIONS'});assert.deepEqual(Array.from(result.plans,p=>[p.target,p.qty,p.beds]),[['D.22.000',280,2.8],['E.17.000',335,3.35]]);assert.equal(result.kpis['Reserved Planting Beds'],6.15);
 scheduled.location_shield.tier_cells[0]=[[{location:'L.26.000',weight:1}],[{location:'G.10.000',weight:1}]];assert.equal(model.compile([],refs).plans[0].target,'G.10.000');
 scheduled.location_shield.tier_cells[0]=[];assert.match(model.compile([],refs).plans[0].tier,/^Tier 2/);assert.equal(model.compile([],refs).plans[0].target,'G.11.000');scheduled.location_shield.tier_cells[1]=[];assert.match(model.compile([],refs).plans[0].tier,/^Tier 3/);
});
test('Invariant 319 (Tier 4 selects highest non-Y exact stock then matching shaded genus)',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('assets/nursery-command-model.js'),ctx);const model=ctx.GncNurseryModel;
 const base={warehousei:'10',itemcode:'001000.030.1',source:'LD',commonname:'Camellia',genusname:'CAMELLIA',lotcode:'27.F1',season:'F1',saleyear:'2027'};
 const stock=[{...base,locationcode:'G.10.010',ptronhand:9000,lotcode:'27.Y'},{...base,locationcode:'G.10.020',ptronhand:100},{...base,locationcode:'G.11.010',ptronhand:900}];
 const schedule={id:1,line_id:'.27.1',itemcode:base.itemcode,commonname:'Camellia',source:'LD',planned_qty:100,cpb:100,location_shield:{tiers:[[],[],[]],genus:'CAMELLIA'}};
 const refs={ph_nursery_locations:[{location_code:'G.10.000',total_beds:200,permanent_shade:'N',house_orientation:'EW'},{location_code:'G.11.000',total_beds:200,permanent_shade:'Y',house_orientation:'EW'}],ph_nursery_water_rating:[{common_name:'Camellia',genus:'CAMELLIA',hydro_zone:'Z2'}],ph_prod_schedule_active:[schedule]};
 const planting=rows=>model.compile(rows,refs).plans.find(p=>p.workflow.includes('PLANTING'));assert.equal(planting(stock).target,'G.11.000');stock[1].ptronhand=2000;assert.equal(planting(stock).target,'G.10.000');
 schedule.itemcode='009999.030.1';assert.equal(planting(stock).target,'G.11.000');schedule.itemcode=base.itemcode;assert.equal(planting([stock[0]]).target,'');
});
test('Invariant 320 (all active scheduled beds and prior move beds remain separate capacity shields)',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('assets/nursery-command-model.js'),ctx);const model=ctx.GncNurseryModel;
 const refs={ph_nursery_locations:['A.01.000','G.10.000','G.11.000','D.22.000'].map(location_code=>({location_code,total_beds:10,permanent_shade:'N',house_orientation:'EW'})),ph_nursery_items_cpb:[{itemcode:'001000.030.1',cpb:100}],ph_nursery_water_rating:[{common_name:'Plant',hydro_zone:'Z2'}],ph_prod_schedule_active:[{id:1,line_id:'.27.1',itemcode:'001000.030.1',commonname:'Plant',source:'LD',planned_qty:100,cutoff_qty:1,cpb:100,location_shield:{tiers:[[{location:'G.11.000',weight:1}],[],[]]}}]};
 const stock=[['A.01.020',100],['G.10.020',100],['D.22.020',200],['G.11.020',600]].map(([locationcode,ptronhand])=>({warehousei:'10',itemcode:'001000.030.1',locationcode,ptronhand,source:'LD',saleyear:'2027',lotcode:'27.F1',commonname:'Plant'}));
 let result=model.compile(stock,refs,{location:'ALL_LOCATIONS'});assert.equal(result.locations.get('G.11.000').reserved,1);assert.equal(result.locations.get('G.11.000').prior,2);assert.equal(result.plans.find(p=>p.from==='D.22.000').score<100,true);assert.equal(result.kpis['Reserved Planting Beds'],1);
 const plan=result.plans.find(p=>p.workflow.includes('PLANTING'));refs.ph_dylan_decisions_store=[{plan_id:plan.plan_id,decision:model.DECISIONS[2]}];result=model.compile(stock,refs,{location:'ALL_LOCATIONS'});assert.equal(result.locations.get('G.11.000').reserved,1);
});

test('Invariant 321 (schedule sequence numbers cannot replace the leading sales year or remove reserved beds)',()=>{
 const ctx=vm.createContext({});vm.runInContext(read('assets/nursery-command-model.js'),ctx);const model=ctx.GncNurseryModel;
 const scheduled=Array.from({length:100},(_,i)=>({id:i+1,line_id:'.27.'+(2000+i),itemcode:'001000.030.1',commonname:'Plant',source:'LD',planned_qty:100,cpb:100,plant_date:'9/20/2026',location_shield:{tiers:[i===77?[]:[{location:'G.10.000',weight:1}],[],[]]}}));
 scheduled.push({...scheduled[0],id:101,line_id:'.26.2027',plant_date:'4/25/2027'});
 scheduled.push({...scheduled[0],id:102,line_id:'external',plant_date:'4/25/2027'});
 const refs={ph_nursery_locations:[{location_code:'G.10.000',total_beds:200,permanent_shade:'N',house_orientation:'EW'}],ph_nursery_water_rating:[{common_name:'Plant',hydro_zone:'Z2'}],ph_prod_schedule_active:scheduled};
 const result=model.compile([],refs,{location:'ALL_LOCATIONS'}),plantings=result.plans.filter(p=>p.workflow.includes('PLANTING'));
 assert.equal(plantings.length,101);assert.equal(plantings.some(p=>p.plan_id.includes('.26.2027')),false);
 assert.equal(plantings.find(p=>p.plan_id.includes('.27.2077')).target,'');
 assert.equal(result.locations.get('G.10.000').reserved,100);assert.equal(result.kpis['Reserved Planting Beds'],100);
});

test('Invariant 322 (super-admin and explicit Y/N capabilities replace literal executive usernames end to end)', () => invariant322({read, functionSource}));


test('Invariant 323 (public photo requests strip transformation parameters before network and cache)',()=>{
 const c=runFunctions('sw.js',['normalizeStoragePhotoRequest'],{URL,Request});
 const request=c.normalizeStoragePhotoRequest(new Request('https://p.supabase.co/storage/v1/render/image/public/b/photo.jpg?width=320&height=80&resize=cover&quality=20&format=webp&v=receipt'));
 assert.equal(request.url,'https://p.supabase.co/storage/v1/object/public/b/photo.jpg?v=receipt');
 assert.equal(request.referrerPolicy,'no-referrer');
});
test('Invariant 324 (origin and visibility gates reject spoofed hosts and unobserved polling)',()=>{
 const c=runFunctions('supabase/functions/app-api/index.ts',['isAllowedAppOrigin'],{URL});
 assert.equal(c.isAllowedAppOrigin('https://agmetricapp.com'),true);assert.equal(c.isAllowedAppOrigin('https://agmetricapp.com.evil.test'),false);
 assert.equal(c.isAllowedAppOrigin('https://github.io.evil.test'),false);assert.equal(c.isAllowedAppOrigin(null),true);
 const document={hidden:false,getElementById:()=>null};const r=runFunctions('assets/app-runtime.js',['isQuotaBackgroundPollingAllowed'],{document});
 assert.equal(r.isQuotaBackgroundPollingAllowed(),false);document.hidden=true;assert.equal(r.isQuotaBackgroundPollingAllowed(),false);
});
test('Invariant 325 (preexisting empty CLI receipts require a successful installed-contract check)',async()=>{
 const {applyScopedMigrationWithSupabaseCli,agdataV23130QuotaSecurityMigrationName:name}=await import('../scripts/apply-item-low-stock-migration.mjs');
 const source=read('supabase/migrations/'+name);let calls=0;
 const result=await applyScopedMigrationWithSupabaseCli({source,targetMigrationName:name,query:async sql=>{calls++;if(calls===1)return [{release_migration_state:{prior:{name:'v23130_supabase_quota_and_rls_security',statements:[]}}}];assert.match(sql,/LOW_STOCK_DATABASE_CONTRACT_MISSING/);assert.match(sql,/security_invoker=true/);return [];}});
 assert.equal(result.status,'already_applied');assert.equal(calls,2);
});
test('Invariant 326 (watchdog production mode sends one fatal report without persisting payloads)',async()=>{
 const reports=[],writes=[];const document={hidden:false,body:{dataset:{currentView:'home'},querySelectorAll:()=>[]},documentElement:null,querySelector:()=>null,getElementById:()=>null,addEventListener(){}};
 const window={__APP_RELEASE_VERSION__:'AgData v3.0.5',localStorage:{getItem:()=>null,setItem:v=>writes.push(v),removeItem(){}},setTimeout,clearTimeout,addEventListener(){}};
 vm.runInNewContext(read('assets/runtime-watchdog.js'),{window,document,MutationObserver:class{observe(){}},setTimeout,clearTimeout,console});
 window.GncRuntimeWatchdog.configure({memoryOnly:true,username:'dylan_collyge',role:'super-admin',reportEvent:async event=>{reports.push(event);return {ok:true};}});
 window.GncRuntimeWatchdog.record('VIEW_LOAD_STALL');window.GncRuntimeWatchdog.record('UNHANDLED_JS_EXCEPTION',{error_message:'secret'});window.GncRuntimeWatchdog.record('UNHANDLED_PROMISE_REJECTION');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(reports.length,1);assert.equal(writes.length,0);assert.equal(reports[0].error_message,'UNHANDLED_JS_EXCEPTION');
});


test('Invariant 327 (consolidated table aliases retain their exact legacy editors)',()=>{
 const c=runFunctions('assets/app-runtime.js',['getManagerTableManagementKey','getManagerTableManagementLegacyTab'],{});
 for(const [route,key] of Object.entries({'assigned-items-export':'assigned-items','customer-rep-map':'customer-assignments','access-control':'user-role-access','item-inquiry-coverage':'inquiry-coverage','av-blanks-photo-bypass':'av-note-users','season-settings':'season'}))assert.equal(c.getManagerTableManagementKey(route),key);
 assert.equal(c.getManagerTableManagementLegacyTab('assigned-items'),'assigned-items-export');assert.equal(c.getManagerTableManagementLegacyTab('user-role-access'),'access-control');assert.equal(c.getManagerTableManagementKey('orders'),'');
 assert.match(functionSource('assets/app-runtime.js','renderManagerModulePicker'),/filter\(option => !getManagerTableManagementKey\(option.id\)\)/);
 assert.match(functionSource('assets/app-runtime.js','renderManagers'),/getManagerTableManagementKey\(activeHomeTab\)\) && activeHomeTab !== MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && ensureViewDataForRender/);
 const auth=runFunctions('assets/app-runtime.js',['canManageCustomerRepMappings'],{canAccessView:()=>true,isFullAppAdministrator:()=>true,normalizeRoleAccessToken:String,currentRole:'SUPER_ADMIN'});assert.equal(auth.canManageCustomerRepMappings(),true);auth.canAccessView=()=>false;assert.equal(auth.canManageCustomerRepMappings(),false);
 const season=runFunctions('assets/app-runtime.js',['canViewManagerSeasonPriority'],{canAccessView:()=>true,isFullAppAdministrator:()=>true,normalizeRoleAccessToken:String,currentRole:'SUPER_ADMIN',getAuditedAppPermission:()=>({allowed:true})});assert.equal(season.canViewManagerSeasonPriority(),true);season.getAuditedAppPermission=()=>({allowed:false});assert.equal(season.canViewManagerSeasonPriority(),false);
});
test('Invariant 328 (authorized table selectors retain the full editor and deny unavailable pills)',()=>{
 const items=[{id:'assigned-items',label:'Assigned Items',section:'editable'},{id:'president-command-center',label:'PRESIDENT_COMMAND_CENTER',nursery:true}];
 const c=runFunctions('assets/app-runtime.js',['renderManagerTableManagementWorkspace'],{getManagerTableManagementItems:()=>items,esc:String});
 const html=c.renderManagerTableManagementWorkspace('<div id="full-editor">rows</div>','assigned-items');assert.match(html,/data-manager-table-pill="assigned-items" aria-pressed="true"/);assert.match(html,/PRESIDENT_COMMAND_CENTER/);assert.match(html,/<div id="full-editor">rows/);assert.doesNotMatch(html,/data-manager-table-pill="user-role-access"/);
});
test('Invariant 329 (scroll proof fails when real headers or controls leave the viewport)',async()=>{
 const {assertPinnedTableGeometry}=await import('../scripts/verify-table-management-browser.mjs');
 const before={selectorTop:100,toolbarTop:260,headerTop:320};
 assert.doesNotThrow(()=>assertPinnedTableGeometry(before,{...before,scrollTop:1000,viewportHeight:1000}));
 assert.throws(()=>assertPinnedTableGeometry(before,{...before,headerTop:-680,scrollTop:1000,viewportHeight:1000}));
 assert.throws(()=>assertPinnedTableGeometry(before,{...before,toolbarTop:0,scrollTop:1000,viewportHeight:1000}));
 assert.throws(()=>assertPinnedTableGeometry(before,{...before,scrollTop:0,viewportHeight:1000}));
});

test('Invariant 330 (nursery reference tables never compile inventory plans)',async()=>{
 const {JSDOM}=await import('jsdom');const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});let calls=0;
 dom.window.GncNurseryModel={TABLES:[{id:'water-rating',label:'Water_Rating',relation:'water'}],FIELDS:{water:['id']},DECISIONS:[],compile(){calls++;throw Error('Reference view must not compile plans');}};
 dom.window.eval(readFileSync(path.join(root,'assets/nursery-command-tables.js'),'utf8'));
 const table=dom.window.GncNurseryTables.mount(dom.window.document.getElementById('root'),{identity:'verified-account',selected:'water-rating',inventory:()=>[],authorized:()=>true,request:async()=>({rows:[{id:'row-1'}]})});
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);assert.equal(dom.window.document.querySelectorAll('tbody tr').length,1);assert.match(dom.window.document.querySelector('h2').textContent,/Water_Rating/);}finally{table.destroy();dom.window.close();}
});

test('Invariant 331 (same-table SWR retains both scroll axes across pending and committed refresh)',async()=>{
 const {JSDOM}=await import('jsdom');const dom=new JSDOM('<div id="root"></div>',{runScripts:'outside-only'});dom.window.eval(readFileSync(path.join(root,'assets/manager-table-management.js'),'utf8'));
 let calls=0,finish;const rows=[{id:1,display_name:'A',username:'a',active:true,revision:1}];
 const host=dom.window.document.getElementById('root'),view=dom.window.GncManagerTableManagement.mountManagerTableManagement(host,{selected:'company-directory',tables:['company-directory'],request:()=>++calls===1?Promise.resolve({rows,total:1}):new Promise(resolve=>finish=resolve),openTable(){}});
 try{await new Promise(resolve=>setImmediate(resolve));host.querySelector('.tm-scroll').scrollTop=1000;host.querySelector('.tm-scroll').scrollLeft=90;host.querySelector('[data-refresh]').click();assert.equal(host.querySelector('.tm-scroll').scrollTop,1000);finish({rows,total:1});await new Promise(resolve=>setImmediate(resolve));assert.equal(host.querySelector('.tm-scroll').scrollTop,1000);assert.equal(host.querySelector('.tm-scroll').scrollLeft,90);}finally{view.destroy();dom.window.close();}
});

test('Invariant 332 (Table Management directory deduplicates the schedule and hides all editor content)',()=>{
 const nursery={};vm.runInNewContext(readFileSync(path.join(root,'assets/nursery-command-model.js'),'utf8'),{window:nursery});
 const c=runFunctions('assets/app-runtime.js',['getManagerTableManagementItems','renderManagerTableManagementWorkspace'],{GncNurseryModel:nursery.GncNurseryModel,getManagersToolAccess:()=>({canViewAssignedItemsExport:true,canManageCustomerRepMappings:true,canManageAccessControl:true,canManageAvBlanksPhotoBypass:true,canManageSeasonSettings:true,canViewSeasonPriority:true,canViewCropRoll:true,canViewProductionSchedule:true}),canViewNurseryCommandTables:()=>true,canUseHistoricalRequests:()=>true,canOpenPhotoHistory:()=>true,esc:String});
 const html=c.renderManagerTableManagementWorkspace('OLD_EDITOR','');assert.equal((html.match(/data-manager-table-card=/g)||[]).length,18);assert.equal((html.match(/PROD SCHEDULE 102726/g)||[]).length,1);assert.doesNotMatch(html,/OLD_EDITOR|table-management-pills|Maintained nursery reference data/);
 for(const key of ['company-directory','assigned-items','user-role-access','president-command-center']){const table=c.renderManagerTableManagementWorkspace('FULL_EDITOR',key);assert.match(table,/data-table-all/);assert.match(table,/data-table-switch/);assert.match(table,/data-table-workspace>FULL_EDITOR/);assert.doesNotMatch(table,/data-table-directory>|data-manager-table-card=/);}
});
test('Invariant 333 (drilled table global Back takes a synchronous directory step)',()=>{
 let opened=0;const c=runFunctions('assets/app-runtime.js',['goBackUniversal'],{getVisibleSecondaryBack:()=>null,getManagerAssignedColumnState:()=>({}),getCurrentVisibleViewId:()=> 'managers',isDrawerOpen:()=>false,closeOpenInteractiveSurfaceForBack:()=>false,getManagerTableManagementKey:key=>key==='assigned-items-export'?'assigned-items':'',activeHomeTab:'assigned-items-export',openManagerTableManagement(){opened++;return false;},updateGlobalBackButton(){}});assert.equal(c.goBackUniversal(),false);assert.equal(opened,1);
});

test('Invariant 334 (photo eviction uses explicit recency independently of insertion order)',async()=>{
 const removed=[],metadata={entries:{newest:{cachedAt:3000,size:1},oldest:{cachedAt:1000,size:1},middle:{cachedAt:2000,size:1}}};
 const c=runFunctions('sw.js',['pruneRuntimeImageCache'],{Date:{now:()=>4000},IMAGE_CACHE_MAX_ENTRIES:2,IMAGE_CACHE_MAX_BYTES:100,IMAGE_CACHE_MAX_AGE_MS:10000,OPAQUE_IMAGE_ESTIMATED_BYTES:1,writeImageCacheMetadata:async()=>{}});
 await c.pruneRuntimeImageCache({keys:async()=>['newest','oldest','middle'].map(url=>({url})),delete:async key=>{removed.push(key.url);return true;}},metadata);
 assert.deepEqual(removed,['oldest']);assert.deepEqual(Object.keys(metadata.entries),['newest','middle']);
});

test('Invariant 335 (delivery release acceptance rejects any residual order violation or incomplete health contract)',async()=>{
 const {assertDeliveryOrderHealth}=await import('../scripts/verify-request-delivery-order.mjs');
 const health={contract_version:'eval-request-delivery-health-v2',required_manager_recipient_count:2,creation_order_violation_count:0,completion_membership_mismatch_count:0,missing_completion_event_count:0,eval_origin_scope_mismatch_count:0,eval_required_recipient_violation_count:0};
 assert.equal(assertDeliveryOrderHealth(health),true);for(const key of ['creation_order_violation_count','completion_membership_mismatch_count','missing_completion_event_count','eval_origin_scope_mismatch_count','eval_required_recipient_violation_count'])assert.throws(()=>assertDeliveryOrderHealth({...health,[key]:2}),new RegExp(key));assert.throws(()=>assertDeliveryOrderHealth({creation_order_violation_count:0}));
});


test('Invariant 336 (Bunch Notes keeps thirteen rules, exact UID receipts and unverified targets blocked)',()=>{
 const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../assets/nursery-command-model.js',import.meta.url),'utf8'),ctx);const M=ctx.GncNurseryModel;
 const row={unique_id:'exact',warehousei:'10',itemcode:'A.030.1',commonname:'Hydrangea',contsize:'#3',locationcode:'G.10.000',lotcode:'27.F1',source:'LD',saleyear:'2027',ptronhand:10,locationnote:'Haul to ??'};
 const refs={ph_nursery_locations:[{location_code:'G.10.000',house_count:1,total_beds:10,permanent_shade:'N',house_orientation:'EW'}],ph_nursery_items_cpb:[{itemcode:row.itemcode,cpb:100}]};
 const c=M.buildBunchNoteContext([row],refs),p=M.evaluateBunchNoteRowAndIssues(row,c,{target:'G.99.000'});assert.equal(M.BUNCH_RULES.length,13);assert.equal(p.canApprove,false);assert.ok(p.bunchNoteIssues.some(i=>i.category==='destination'));assert.match(p.autoSuggestedBunchNote,/inside drape plastic/);
 M.publishBunchDecisions('one',[{plan_id:p.plan_id,decision:M.DECISIONS[0],notes:'approved exact row'}]);assert.equal(M.approvedBunchNote(row,'one'),'approved exact row');assert.equal(M.approvedBunchNote({...row,unique_id:'sibling'},'one'),'');assert.equal(M.approvedBunchNote(row,'two'),'');
});


test('Invariant 337 (generated same-color separation never changes the required work crew)',()=>{
 const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../assets/nursery-command-model.js',import.meta.url),'utf8'),ctx);const M=ctx.GncNurseryModel;
 const row={unique_id:'crew-one',warehousei:'10',itemcode:'A.030.1',commonname:'Hydrangea',contsize:'#3',locationcode:'G.10.000',lotcode:'27.F1',source:'LD',saleyear:'2027',ptronhand:10,fieldtagcolor:'Blue',locationnote:'Haul to ??'},other={...row,unique_id:'crew-two',itemcode:'B.030.1'};
 const refs={ph_nursery_locations:[{location_code:'G.10.000',house_count:1,total_beds:10,permanent_shade:'N',house_orientation:'EW'}],ph_nursery_items_cpb:[{itemcode:row.itemcode,cpb:100}]},c=M.buildBunchNoteContext([row,other],refs),p=M.evaluateBunchNoteRowAndIssues(row,c);
 assert.match(p.autoSuggestedBunchNote,/same-color tags/);const again=M.evaluateBunchNoteRowAndIssues(row,c,{...p.choices,note:p.autoSuggestedBunchNote});assert.equal(again.crew,p.crew);assert.equal(again.bunchNoteIssues.length,0);
});


test('Invariant 338 (zero-house reference blocks never become fabricated Center Houses)',()=>{
 const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../assets/nursery-command-model.js',import.meta.url),'utf8'),ctx);const M=ctx.GncNurseryModel;
 const row={unique_id:'open-block',warehousei:'10',itemcode:'A.030.1',commonname:'Falsecypress',contsize:'#3',locationcode:'G.10.000',lotcode:'27.F1',source:'LD',saleyear:'2027',ptronhand:10};
 const refs={ph_nursery_locations:[{location_code:'G.10.000',house_count:0,total_beds:10,permanent_shade:'N',house_orientation:'EW'}],ph_nursery_items_cpb:[{itemcode:row.itemcode,cpb:100}]},c=M.buildBunchNoteContext([row],refs),p=M.evaluateBunchNoteRowAndIssues(row,c);assert.equal(p.canApprove,true);assert.match(p.autoSuggestedBunchNote,/Open block \(no house\)/);assert.doesNotMatch(p.autoSuggestedBunchNote,/1 house — Center House/);row.commonname='Hydrangea';assert.ok(M.evaluateBunchNoteRowAndIssues(row,c).blockers.some(b=>b[0]===9));
});

test('Invariant 339 (all historical Bunch exceptions resolve complete deterministic identities without creating live stock)',()=>{
 const c={};vm.runInNewContext(read('assets/nursery-command-model.js'),c);const M=c.GncNurseryModel,defs=JSON.parse(read('supabase/migrations/20261102020000_v23134_bunch_note_historical_identities.sql').split('$bunch_catalog$')[1]),inventory=[];
 assert.equal(defs.length,750);for(const def of defs){const a=M.resolveBunchNoteExceptionRowIdentity(def,inventory,[]),b=M.resolveBunchNoteExceptionRowIdentity(def,inventory,[]);assert.equal(a.unique_id,b.unique_id);for(const key of ['unique_id','locationcode','itemcode','lotcode','commonname','contsize'])assert.ok(a[key]);assert.equal(a.synthetic,true);assert.equal(a.ptronhand,0);}assert.equal(inventory.length,0);
});
test('Invariant 340 (Bunch approval projects before network, rolls back and survives durable remount)',async()=>{
 const {assertBunchOptimisticContract}=await import('./helpers/bunch-note-approval-contract.mjs');await assertBunchOptimisticContract();
});

test('Invariant 341 (customer mapping accepts canonical super-admin aliases while ordinary roles remain denied)',()=>{
 const compiled=ts.transpileModule(read('supabase/functions/_shared/customer-rep-mapping.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const exports={},sandbox=vm.createContext({exports,module:{exports}});vm.runInContext(compiled,sandbox);const allowed=sandbox.module.exports.isCustomerRepMappingEditorRole;
 for(const role of ['Admin','Administrator','Manager','super-admin','super_admin','SUPER ADMIN'])assert.equal(allowed(role),true,role);for(const role of ['REP','Eval','Production','',null,'super-user'])assert.equal(allowed(role),false,role);
 const migration=read('supabase/migrations/20261102023000_v23134_customer_mapping_super_admin.sql');assert.match(migration,/customer_rep_mapping_manage_v23102_base/);assert.match(migration,/customer_rep_mapping_manage_v2397_base/);assert.match(migration,/CUSTOMER_MAPPING_SERVICE_BOUNDARY_CHANGED/);
});

test('Invariant 342 (Edge runtime version follows the package release before publication)',()=>{
 const version=expectedAppApiVersion(),edge=read('supabase/functions/app-api/index.ts');assert.equal(edge.match(/const APP_RUNTIME_VERSION = "([^"]+)"/)?.[1],version);assert.equal(edge.match(/const APP_RUNTIME_RELEASE = "([^"]+)"/)?.[1],'AgData v'+version);
});

test('Invariant 343 (pre-commit version synchronization is transactional and artifact parity is strict)',async()=>{const {versionTransactionContract}=await import('./helpers/release-automation-contract.mjs');versionTransactionContract();});
test('Invariant 344 (green backend-only recovery publishes previously unpublished frontend work)',async()=>{const {frontendRecoveryContract}=await import('./helpers/release-automation-contract.mjs');await frontendRecoveryContract();});
test('Invariant 345 (interrupted release finalization resumes without duplicate version writes)',async()=>{const {finalizationContract}=await import('./helpers/release-automation-contract.mjs');await finalizationContract();});
test('Invariant 346 (push-triggered Pages discovery waits through the grace boundary without duplicate same-SHA CI)',async()=>{const {pushDiscoveryContract}=await import('./helpers/release-automation-contract.mjs');await pushDiscoveryContract();});

test('Invariant 347 (nursery drill-down preserves visible card space and confirmed approvals precede PDF email)',async()=>{const {assertBunchDrillContract}=await import('./helpers/bunch-drill-contract.mjs');await assertBunchDrillContract();});

test('Invariant 348 (nursery batches tolerate their own optimistic revision and parse a single thumbnail URL)',async()=>{const {assertBunchDrillContract}=await import('./helpers/bunch-drill-contract.mjs');await assertBunchDrillContract();});

test('Invariant 349 (nursery PDF delivery resolves the active recipient without private directory reads)',async()=>{const {assertNurseryPdfRecipientContract}=await import('./helpers/bunch-drill-contract.mjs');assertNurseryPdfRecipientContract();});

test('Invariant 350 (planting approvals retain four-level exact-location cards and atomically relocate reservations)',async()=>{const {assertCoupledPlantingContract}=await import('./helpers/bunch-drill-contract.mjs');await assertCoupledPlantingContract();});

test('Invariant 351 (frame coalescing skips unchanged signatures and rejects obsolete view work)',async()=>{const {assertStableRenderContract}=await import('./helpers/bunch-drill-contract.mjs');assertStableRenderContract();});

test('Invariant 352 (forced shared chrome refresh retains the mounted search node in every view)',async()=>{const {assertStableHeaderMountContract}=await import('./helpers/bunch-drill-contract.mjs');assertStableHeaderMountContract();});

test('Invariant 353 (documented planting water ranges prove the full 250 mL tolerance without guessed midpoints)',async()=>{const {assertDocumentedWaterRangeContract}=await import('./helpers/bunch-drill-contract.mjs');assertDocumentedWaterRangeContract();});

test('Invariant 354 (planting cards validate one target and defer destination scans until the picker opens)',async()=>{const {assertLazyPlantingPickerContract}=await import('./helpers/bunch-drill-contract.mjs');await assertLazyPlantingPickerContract();});

test('Invariant 355 (planting derives its T-14 date and links only same-year shift source lots)',async()=>{const {assertPlantingDateAndSourceYearContract}=await import('./helpers/bunch-drill-contract.mjs');await assertPlantingDateAndSourceYearContract();});

test('Invariant 356 (pending requests survive superseded empty reads and retire only on lifecycle proof)',async()=>{const {requestContract}=await import('./helpers/operational-resilience-contract.mjs');await requestContract();});

test('Invariant 357 (Request email preserves core, submitter, selected rep and extra recipients without replacing remote routes)',async()=>{const {emailContract}=await import('./helpers/operational-resilience-contract.mjs');await emailContract();});

test('Invariant 358 (Nelly account aliases resolve identically across Request capability checks)',async()=>{const {aliasContract}=await import('./helpers/operational-resilience-contract.mjs');await aliasContract();});

test('Invariant 359 (durable exact-row photos win over failed blob stubs across Drive and AV)',async()=>{const {photoContract}=await import('./helpers/operational-resilience-contract.mjs');await photoContract();});

test('Invariant 360 (iOS custom keypads isolate native input and AV search renders during typing)',async()=>{const {touchContract}=await import('./helpers/operational-resilience-contract.mjs');await touchContract();});

test('Invariant 361 (SOC startup avoids cascading retention and confirmed progress reports real row counts)',async()=>{const {syncContract}=await import('./helpers/operational-resilience-contract.mjs');await syncContract();});

test('Invariant 362 (scoped Apps Script dispatcher patches retain every event constant before Request delivery)',async()=>{const {dispatcherContract}=await import('./helpers/operational-resilience-contract.mjs');dispatcherContract();});

test('Invariant 363 (Assigned Items paints cached rows during module failure and preserves checked-row intent)',async()=>{const {assignmentFallbackContract}=await import('./helpers/table-roster-contract.mjs');await assignmentFallbackContract();});
test('Invariant 364 (all legacy roster roles appear without creating login identities or overriding denials)',async()=>{const {rosterParityContract}=await import('./helpers/table-roster-contract.mjs');rosterParityContract();});
test('Invariant 365 (pending Request reads accept the live submitted_by field without loosening schema validation)',async()=>{const {requestSchemaContract}=await import('./helpers/table-roster-contract.mjs');requestSchemaContract();});
test('Invariant 366 (AV card bodies open Item Detail and display receipts compare matching scope formats)',async()=>{const {avCardDetailContract}=await import('./helpers/table-roster-contract.mjs');avCardDetailContract();});

test('Invariant 367 (complete AV display survives optional joins and permission refresh without crossing accounts)',async()=>{const {avDisplayContinuityContract}=await import('./helpers/table-roster-contract.mjs');avDisplayContinuityContract();});

test('Invariant 368 (AV search previews reuse bounded preparation and explicit AURA denial prevents startup probes)',async()=>{const {avPreparationAndAuraProbeContract}=await import('./helpers/table-roster-contract.mjs');avPreparationAndAuraProbeContract();});

test('Invariant 369 (every v3.0.5 migration passes scoped publication registration while unknown SQL remains denied)',async()=>{const {selectReleaseMigrations,migrationContractQuery}=await import('../scripts/apply-item-low-stock-migration.mjs');const names=['20261102160000_v23138_operational_resilience.sql','20261102173000_v23138_assigned_items_and_role_sync.sql'];assert.deepEqual(selectReleaseMigrations(JSON.stringify(names.map(n=>'supabase/migrations/'+n))),names);for(const name of names)assert.match(migrationContractQuery(name),/as installed/);assert.throws(()=>selectReleaseMigrations(JSON.stringify(['supabase/migrations/unreviewed.sql'])),/NOT_ALLOWLISTED/);});

test('Invariant 370 (v3.0.5 migration sources satisfy the exact transactional CLI wrapper)',async()=>{const {migrationBody,buildScopedMigrationApplySql}=await import('../scripts/apply-item-low-stock-migration.mjs');for(const targetMigrationName of ['20261102160000_v23138_operational_resilience.sql','20261102173000_v23138_assigned_items_and_role_sync.sql']){const source=read('supabase/migrations/'+targetMigrationName);assert.ok(migrationBody(source).length>0);assert.match(buildScopedMigrationApplySql({source,targetMigrationName}),/schema_migrations/);}assert.equal(migrationBody('select 1;'),'select 1;');assert.throws(()=>migrationBody('select 1; commit;'),/TRANSACTION_REQUIRED/);});

test('Invariant 371 (View All Requests follows top-level Y/N, exact item ownership and submitting identity)',async()=>{const {requestVisibilityContract}=await import('./helpers/request-visibility-contract.mjs');requestVisibilityContract();});
test('Invariant 372 (View All Requests role cascade, single-user isolation and rollback are immediate)',async()=>{const {requestVisibilitySaveContract}=await import('./helpers/request-visibility-save-contract.mjs');await requestVisibilitySaveContract();});

test('Invariant 373 (permission fixtures import without registering or executing test suites)',()=>{const output=execFileSync(process.execPath,['--input-type=module','-e',"await import('./tests/helpers/access-permission-fixture.mjs');"],{cwd:process.cwd(),encoding:'utf8'});assert.equal(output.trim(),'');});

test('Invariant 374 (finalize retries preserve all staged rows through repeated lock contention)',async()=>{const {finalizeResilienceContract}=await import('./helpers/finalize-resilience-contract.mjs');await finalizeResilienceContract();});
test('Invariant 375 (unassigned code sets emit only one summary until the set changes)',async()=>{const {summaryNotificationContract}=await import('./helpers/finalize-resilience-contract.mjs');summaryNotificationContract();});
test('Invariant 376 (Apps Script health requires the deployed source fingerprint)',async()=>{const {fingerprintHealthContract}=await import('./helpers/finalize-resilience-contract.mjs');fingerprintHealthContract();});

test('Invariant 377 (photo health checks exact scoped derivatives and still rejects missing thumbnails)',async()=>{const {photoHealthScopeContract}=await import('./helpers/health-progress-contract.mjs');photoHealthScopeContract();});
test('Invariant 378 (sync modal percentages count the same sources as its rendered cards)',async()=>{const {syncModalPercentageContract}=await import('./helpers/health-progress-contract.mjs');syncModalPercentageContract();});

test('Invariant 379 (confirmed older signed-in clients cut over once without erasing identity)', () => invariant522({read, functionSource, runFunctions}));
test('Invariant 380 (retained or cancelled datasets preserve inventory-backed Assigned Items)',async()=>{const {cancellationAndFallbackContract}=await import('./helpers/client-cutover-contract.mjs');cancellationAndFallbackContract();});
test('Invariant 381 (legacy dataset names remain bounded and superseded versions compare numerically)',async()=>{const {legacyDatasetEnvelopeContract}=await import('./helpers/client-cutover-contract.mjs');await legacyDatasetEnvelopeContract();});

test('Invariant 382 (completed inventory rows lock immediately and failed saves retain drafts)',async()=>{const {completionLockContract,optimisticCompletionContract}=await import('./helpers/completed-row-contract.mjs');completionLockContract();optimisticCompletionContract();});
test('Invariant 383 (Available depletion is one-for-one and never resurrects zero quantities)',async()=>{const {depletionContract}=await import('./helpers/completed-row-contract.mjs');depletionContract();});
test('Invariant 384 (measurement unit keys are permanent and input never rebuilds Item Detail)',async()=>{const {fixedKeypadContract}=await import('./helpers/completed-row-contract.mjs');fixedKeypadContract();});
test('Invariant 385 (inline reassignment retains canonical authorization and Suspend filters inventory Eval owners)',async()=>{const {ownerAndSuspendContract}=await import('./helpers/completed-row-contract.mjs');await ownerAndSuspendContract();});
test('Invariant 386 (explicit row capability resolves before role fallback without a temporal-dead-zone error)',async()=>{const {rowCapabilityInitializationContract}=await import('./helpers/completed-row-contract.mjs');rowCapabilityInitializationContract();});
test('Invariant 387 (keyboard teardown queues chrome measurement after completed controls lock)',async()=>{const {keyboardCloseDoesNotMeasureContract}=await import('./helpers/completed-row-contract.mjs');keyboardCloseDoesNotMeasureContract();});

test('Invariant 388 (completed evaluation metadata extends full reads without changing the audited v3 physical contract)',()=>{const ctx=vm.createContext({module:{exports:{}}});vm.runInContext(read('assets/inventory-list-contract.js'),ctx);const c=ctx.module.exports;assert.equal(c.physicalColumns.length,218);assert.equal(c.readColumns.length,220);for(const key of ['eval_baseline_available','initial_loc_photo_match'])assert.ok(c.readColumns.includes(key));const row=c.decodeCsvRows('eval_baseline_available,initial_loc_photo_match\n1000,500',['eval_baseline_available','initial_loc_photo_match'])[0];assert.equal(row.eval_baseline_available,1000);assert.equal(row.initial_loc_photo_match,500);});
test('Invariant 389 (order depletion preserves authoritative zero On Hand over stale aliases)',()=>{const ctx=runFunctions('assets/app-runtime.js',['calculateLiveLocPhotoMatch']);assert.equal(ctx.calculateLiveLocPhotoMatch({PTRONHAND:0,on_hand:51,MATCH:80,LOC_PHOTO_MATCH:0}),0);});

test('Invariant 390 (isolated runtime fixtures retain the caller context for live account and row transitions)',()=>{const supplied={marker:'same'};const ctx=runFunctions('assets/app-runtime.js',['parseAppNumber'],supplied);assert.equal(ctx,supplied);assert.equal(supplied.parseAppNumber('42'),42);supplied.marker='updated';assert.equal(ctx.marker,'updated');});

test('Invariant 391 (Storage quota recovery retains exact-row native authority and rejects unconfirmed persistence)',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');await m.photoRecoveryContract();});
test('Invariant 392 (opening another Reclass row preserves staged proposals and visible rows)',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');m.stagedReclassContract();});
test('Invariant 393 (Suspend uses canonical Drive evidence and exact-source quantity-preserving commands)',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');m.suspendLocationContract();});

test('Invariant 394 (indexed Reclass controllers resolve to their owning fragment and preserve two staged rows)',async()=>{const domain=JSON.parse(read('docs/architecture/agdata-symbol-index.json')).domains['agdata-queue-and-reclass-specialist'];for(const name of ['focusArgosReclassRow','toggleArgosReclassRowCard','refreshArgosReclassMultiActionUi'])assert.ok(domain.supportingFiles['assets/row-workflow-functions.js'].includes(name));const m=await import('./helpers/photo-suspend-contract.mjs');m.stagedReclassContract();});

test('Invariant 395 (Storage gateway cooldown skips probes, expires and preserves exact-row authorization)',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');await m.photoCooldownContract();});
test('Invariant 396 (database fallback photos share the authorized history catalog with bucket and Drive archives)',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');await m.fallbackHistoryContract();});
test('Invariant 397 (cache metadata repair uses bounded skipped-lock batches and retains the storage deletion guard)',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');await m.boundedCacheContract();});
test('Invariant 398 (photo attachment patch retains remote-only production routes)',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');await m.historyPatchContract();});

test('Invariant 399 (reload retains a bounded gateway cooldown and detail prewarm is single-flight and read-only)',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');await m.persistentPhotoWarmupContract();});

test('Invariant 400 (photo drafts stay visible, completion requires Mark Done, strict unlock and expiry retain native authorization)',async()=>{const m=await import('./helpers/photo-field-lifecycle-contract.mjs');await m.photoFieldLifecycleContract();});

test('Invariant 401 (async Assigned Items preserves detail plant groups and one eligible-owner roster)',async()=>{const m=await import('./helpers/assigned-items-hydration-contract.mjs');await m.assignedItemsHydrationContract();m.assignedItemsOwnerOptionsContract();});

test('Invariant 402 (Assigned Items metadata helper stays in the canonical declaration fragment)',async()=>{const domain=JSON.parse(read('docs/architecture/agdata-symbol-index.json')).domains['agdata-table-management-and-directory'];assert.ok(domain['assets/row-workflow-functions.js'].includes('enrichManagerAssignedPlantGroups'));assert.doesNotMatch(readFileSync(path.join(root,'assets/app-runtime.js'),'utf8'),/function enrichManagerAssignedPlantGroups\(/);const m=await import('./helpers/assigned-items-hydration-contract.mjs');await m.assignedItemsHydrationContract();});

test('Invariant 403 (dormant six-digit families preserve owners and additive metadata never weakens writes)',async()=>{const m=await import('./helpers/fast-release-contract.mjs');m.dormantFamilyContract();m.additiveReadContract();});
test('Invariant 404 (fast mode resets after one audit and Apps Script health proves identical source)',async()=>{const m=await import('./helpers/fast-release-contract.mjs');m.fastDefaultContract();m.sourceFingerprintContract();});

test('Invariant 405 (Assigned Items accepts canonical owners and empty checkbox selection restores All)',async()=>{const m=await import('./helpers/assigned-owner-save-contract.mjs');m.assignedFilterResetContract();m.assignedOwnerSaveContract();});

test('Invariant 406 (warm group lookups reuse the inventory index and split worker health rejects drift)',async()=>{await (await import('./helpers/assigned-items-hydration-contract.mjs')).assignedItemsHydrationContract();await (await import('./helpers/fast-release-contract.mjs')).verifiedHeadOnlyContract();});

test('Invariant 407 (morning capture dates remain current and bulk owner resolution preserves row auditing)',async()=>{(await import('./helpers/assigned-owner-save-contract.mjs')).earlyPhotoAndBatchContract();});

test('Invariant 408 (hosted health verifies the pinned deployment using projected identity and the full trigger digest)',async()=>{await (await import('./helpers/fast-release-contract.mjs')).projectedDeploymentHealthContract();});

test('Invariant 409 (hosted OAuth reads BOM-prefixed, flat and account-mapped clasp credentials)',async()=>{(await import('./helpers/fast-release-contract.mjs')).hostedClaspCredentialContract();});

test('Invariant 410 (physical splits reserve exact IDs and allocate each eligible lineage once)', async () => {
  const { ordinalLineageContract } = await import('./helpers/master-ordinal-lineage.mjs');
  ordinalLineageContract();
});

test('Invariant 411 (Eval badges and the Suspend filter resolve the same canonical itemcode owner)', async () => {
  const {ownerAndSuspendContract} = await import('./helpers/completed-row-contract.mjs');
  await ownerAndSuspendContract();
});

test('Invariant 412 (inventory list refresh waits for touch release and 600ms of scroll quiet)', async () => {
  const {inventoryScrollContract} = await import('./helpers/completed-row-contract.mjs');
  inventoryScrollContract();
});

test('Invariant 413 (Suspend owners, session defaults and native scrolling agree across card views)',async()=>{const m=await import('./helpers/completed-row-contract.mjs');await m.ownerAndSuspendContract();await m.suspendOwnerHydrationContract();m.inventoryScrollContract();});
test('Invariant 414 (successful Pages runs wait for both public descriptors before recovery)',async()=>{await (await import('./helpers/release-automation-contract.mjs')).cdnPropagationContract();});

test('Invariant 415 (every active physical SOC Suspend line is eligible regardless of destination)',async()=>{await (await import('./helpers/completed-row-contract.mjs')).allSuspendDestinationsContract();});

test('Invariant 416 (captured field photos survive stale refresh and stopped completion)', async () => {
    const { fieldPhotoContract } = await import('./helpers/field-photo-contract.mjs');
    fieldPhotoContract();
});

test('Invariant 417 (live queues use physical assignments and server pending state; Assigned Items opens in code order)', async () => {
    const { liveQueueAssignmentContract } = await import('./helpers/completed-row-contract.mjs');
    liveQueueAssignmentContract();
});

test('Invariant 418 (Assigned Items activates before reading inventory and prepares a bounded first viewport)', async () => {
    const { firstAssignedFrameContract } = await import('./helpers/completed-row-contract.mjs');
    await firstAssignedFrameContract();
});

test('Invariant 419 (background hydration retains visible nodes and iOS height changes preserve layout)', async () => {
    (await import('../tests/helpers/ios-frame-contract.mjs')).iosFrameContract();
});
test('Invariant 420 (worker and manifest updates share one version reload and a sixty-second cooldown)', async () => {
    (await import('../tests/helpers/ios-frame-contract.mjs')).iosReloadContract();
});
test('Invariant 421 (Assigned Items ownership authorizes evaluator edits and non-admin Que scope and badge counts)', async () => {
    (await import('./helpers/queue-owner-contract.mjs')).queueOwnerContract();
});

test('Invariant 422 (row mutations and queue visibility use the same indexed Assigned Items source)', async () => {
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, ['--test', 'tests/canonical-row-workflow.test.mjs'], { stdio: 'pipe' });
});

test('Invariant 423 (all eight Queue tabs switch synchronously for authorized accounts)', async () => {
    const { queueTabContract } = await import('./helpers/queue-table-interaction-contract.mjs');
    await queueTabContract();
});

test('Invariant 424 (personal Queue badges deduplicate active request and physical suspend identities)', async () => {
    const { queueCountContract } = await import('./helpers/queue-table-interaction-contract.mjs');
    await queueCountContract();
});

test('Invariant 425 (Assigned Items appends 150 rows within 400 pixels through the complete dataset)', async () => {
    const { assignedPagingContract } = await import('./helpers/queue-table-interaction-contract.mjs');
    await assignedPagingContract();
});

test('Invariant 426 (row and bulk saves update full-dataset assignments before the canonical RPC resolves)', async () => {
    const { assignedOwnerContract } = await import('./helpers/queue-table-interaction-contract.mjs');
    await assignedOwnerContract();
});

test('Invariant 427 (mobile Request titles and the horizontal Queue rail retain readable layout)', async () => {
    const { mobileQueueLayoutContract } = await import('./helpers/queue-table-interaction-contract.mjs');
    await mobileQueueLayoutContract();
});

test('Invariant 428 (verified worker installs activate with open clients and upgrade only stale AgData windows)', upgradeOpenWindows);

test('Invariant 429 (network-first shell and release descriptors refresh stable offline copies)', networkFirstShell);

test('Invariant 430 (authenticated screens share a visible fixed footer outside their scroll area)', async () => {
    const { authenticatedFooter } = await import('./helpers/pwa-shell-upgrade-contract.mjs');
    await authenticatedFooter();
});

test("Invariant 431 (Suspend close retries the same command through four transient lock errors)", async () => {
    const { suspendCloseRetryContract } = await import('./helpers/queue-table-interaction-contract.mjs');
    await suspendCloseRetryContract();
});

test("Invariant 432 (Queue renders exact counts, compact pills and clean measurement text)", async () => {
    const { queuePillAndTextContract } = await import('./helpers/queue-table-interaction-contract.mjs');
    await queuePillAndTextContract();
});

test('Invariant 433 (requires confirmation before changing the exact Suspend and Dock pull location)', async () => {
    const { confirmedPullLocationContract } = await import('./helpers/queue-table-interaction-contract.mjs');
    await confirmedPullLocationContract();
});

test('Invariant 434 (coalesces identical row writes and defers background paint through touch and dialogs)', async () => {
    const { serializedQueueInteractionContract } = await import('./helpers/queue-table-interaction-contract.mjs');
    await serializedQueueInteractionContract();
});

import {fieldWatchdogContract,watchdogReviewContract,reviewedQueueWatchdogContract} from './helpers/watchdog-field-contract.mjs';
test('Invariant 435 (field failures, geometry and personal Queue mismatches reach the sanitized Watchdog)', fieldWatchdogContract);

test('Invariant 436 (Watchdog reviews seven days of unresolved fingerprints and routes all three named administrators)', watchdogReviewContract);

test('Invariant 437 (Complete Tag closes blank False Block rows on the first paint)', async () => {
    const { closeUnreviewedContract } = await import('./helpers/suspend-field-release-contract.mjs');
    await closeUnreviewedContract();
});

test('Invariant 438 (confirmed pulls preview the exact Dock, Drop, Drive and AV allocation)', async () => {
    const { confirmedLocationContract } = await import('./helpers/suspend-field-release-contract.mjs');
    await confirmedLocationContract();
});

test('Invariant 439 (canonical SOC membership excludes stale and completed lines and honors resolved owners)', async () => {
    const { activeSocContract } = await import('./helpers/suspend-field-release-contract.mjs');
    await activeSocContract();
});

test('Invariant 440 (priority-independent location photos serve the queue, detail and AV search)', async () => {
    const { mediaParity } = await import('./helpers/field-parity-contract.mjs');
    await mediaParity();
});

test('Invariant 441 (queue scope settings govern both tabs, counts and empty membership)', async () => {
    const { queueParity } = await import('./helpers/field-parity-contract.mjs');
    await queueParity();
});

test('Invariant 442 (search coalesces and completion preserves the mounted list)', async () => {
    const { interactionParity } = await import('./helpers/field-parity-contract.mjs');
    await interactionParity();
});

test('Invariant 443 (incident copy emits one current release brief)', async () => {
    const { watchdogParity } = await import('./helpers/field-parity-contract.mjs');
    await watchdogParity();
});

test('Invariant 444 (authenticated Watchdog review sends the exact remote-only command)', async () => {
    const { reviewerParity } = await import('./helpers/field-parity-contract.mjs');
    await reviewerParity();
});

test('Invariant 445 (AV Photos hydrates named matches when the local catalog lacks their media)', async () => {
    const { avNameParity } = await import('./helpers/field-parity-contract.mjs');
    await avNameParity();
});

test('Invariant 446 (AV showroom keeps operational filters, canonical photo matches and immediate ready cards)', async () => {
    const { showroomContract } = await import('./helpers/field-parity-contract.mjs');
    await showroomContract();
});

test('Invariant 447 (measurement keypad owns the draft cursor and displays exact dimension tokens)', async () => {
    (await import('./helpers/mobile-detail-continuity-contract.mjs')).keypadContract();
});
test('Invariant 448 (queue refresh retains cards and a hydrated detail opens its local AV options)', async () => {
    await (await import('./helpers/mobile-detail-continuity-contract.mjs')).queueDetailContract();
});
test('Invariant 449 (Watchdog distinguishes cancelled reads and mobile viewport geometry)', async () => {
    (await import('./helpers/mobile-detail-continuity-contract.mjs')).watchdogViewportContract();
});

test('Invariant 450 (owned Request outbox commands retire only against exact durable receipts)', async () => {
    await (await import('./helpers/request-receipt-contract.mjs')).receiptContract();
});
test('Invariant 451 (Request work reconciles exact completion versions and preserves newer edits)', async () => {
    await (await import('./helpers/request-receipt-contract.mjs')).workReceiptContract();
});
test('Invariant 452 (required Request fields stay actionable and genuine errors remain observable)', async () => {
    (await import('./helpers/request-receipt-contract.mjs')).requestGuidanceContract();
});

test('Invariant 453 (operator-retained Request drafts remain individually reviewable without dispatch)', async () => {
    await (await import('./helpers/request-receipt-contract.mjs')).retainedDraftContract();
});

test('Invariant 454 (exact item candidates and confirmed order selection)', async () => {
    await (await import('./helpers/suspend-location-release-contract.mjs')).suspendSelectionContract();
});
test('Invariant 455 (indexed assignment metadata and append-only measurement keypad)', async () => {
    await (await import('./helpers/suspend-location-release-contract.mjs')).assignmentKeypadContract();
});
test('Invariant 456 (foreground revision budget, direct photos and pinned navigation)', async () => {
    await (await import('./helpers/suspend-location-release-contract.mjs')).quotaContract();
});

test('Invariant 457 (direct Request detail replaces its summary on each card)', () => {
  assertDirectRequestSummaryReplacement(runFunctions);
});

test('Invariant 458 (AV keeps the View and Season filters on one accessible rail)', () => {
  const names = ['ensureAvTopControlsShell','buildAvRailMarkup','buildAvRailViewFields','buildAvRailAccountFields'];
  const ctx = runFunctions('assets/av-filter-markup.js', names, {
    ensureAvControlsVisible() {}, setContainerHtml: (node, html) => { node.innerHTML = html; },
    buildExcelFilterFastAttrs: handler => 'data-handler="' + handler + '"'
  });
  const rail = { dataset: {} };
  assert.equal(ctx.ensureAvTopControlsShell(rail), true);
  assert.match(rail.innerHTML, /id="av-filter-options" class="av-top-controls-row">/);
  assert.match(rail.innerHTML, /data-handler="toggleAvSeasonDropdown"/);
  assert.match(read('assets/app-styles.css'), /#av-top-filters\.av-top-inline[^{}]+\{\s*position:sticky!important; top:0; display:flex!important; flex-wrap:nowrap!important; overflow-x:auto!important/);
  assert.equal(ctx.ensureAvTopControlsShell(rail), false);
});

test('Invariant 459 (an uncertain Reclass checks its receipt without treating a permission denial as transport loss)', () => {
  const api = runFunctions('assets/app-runtime.js', ['isInventoryStatusOutcomeUncertain']);
  assert.equal(api.isInventoryStatusOutcomeUncertain({ status: 504 }), true);
  assert.equal(api.isInventoryStatusOutcomeUncertain({ status: 403, code: '42501' }), false);
  assert.equal(api.isInventoryStatusOutcomeUncertain({ status: 409, code: 'SOURCE_CHANGED' }), false);
});

test('Invariant 460 (Watchdog clipboard dates use the observed Central instant)', () => watchdogDatesContract(read));

test('Invariant 461 (an AV read denial preserves verified cards and leaves retry available on a cold view)', () => {
  const calls = [];
  const api = runFunctions('assets/app-runtime.js', ['showAvReadUnavailableState'], {
    hasConfirmedCurrentAccountRevocation: () => false,
    hasProgressiveViewData: () => false,
    markViewDirty: view => calls.push(view),
    showViewLoadingState: () => calls.push('loading'),
    scheduleViewLoadRetry: () => calls.push('retry')
  });
  assert.equal(api.showAvReadUnavailableState({status:403}, true, 'av'), false);
  assert.deepEqual(calls, ['av']);
  assert.equal(api.showAvReadUnavailableState({status:403}, false, 'drive'), true);
  assert.deepEqual(calls, ['av','loading','retry']);
});

test('Invariant 462 (Suspend confirmation uses the same False Block predicate as location selection)', () => {
  const code = 'assets/row-workflow-functions.js';
  const api = runFunctions(code, ['confirmSuspendLocationChange', 'isFalseBlockLocation'], {
    getDockSuspendDcRequestGroupParts: () => ({ dock:'7', drop:'2', consignee:'Nursery' }),
    getDockOrderedQtyDisplay: () => 8, showAppConfirm: text => text
  });
  assert.match(api.confirmSuspendLocationChange({ LOCATIONCODE:'00.00.111' }, ['F.14.000']), /Previous: 00\.00\.111 FALSE BLOCK/);
  assert.doesNotMatch(api.confirmSuspendLocationChange({ LOCATIONCODE:'F.14.000' }, ['F.15.000']), /Previous: F\.14\.000 FALSE BLOCK/);
});

test('Invariant 463 (ERP start renews the native bearer once, retains its command, and ignores an earlier idle poll)', async () => {
  const sends = [];
  const api = runFunctions('assets/app-runtime.js', ['postAppFunctionJson','applyAppApiSessionHeaders'], {
    currentUser:'dylan_collyge', nativeAuthRecoveryEpoch:1, APP_VERSION:'fixture', SUPABASE_KEY:'public-fixture',
    window:{}, PRELOGIN_BACKGROUND_ACTIONS:new Set(), isAllowedAppHostname:() => true,
    getCurrentAppSessionToken:() => 'unusable-legacy-token',
    getNativeAuthRequestHeaders: async refresh => ({ Authorization: refresh ? 'Bearer renewed' : 'Bearer prior' }),
    canRunManualInventoryImport:() => true,
    fetchWithTimeout: async (_url, request) => {
      sends.push({ headers:request.headers, payload:JSON.parse(request.body) });
      const ok = sends.length === 2;
      return { ok, status:ok ? 200 : 401, headers:{get:() => null},
        text:async () => JSON.stringify(ok ? {ok:true,cloudRelay:true} : {code:'AUTH_REQUIRED'}) };
    }
  });
  const command = { action:'erp_sync', operation:'start', commandId:'fixture-command', force:true };
  const receipt = await api.postAppFunctionJson('/app-api', command);
  assert.equal(receipt.cloudRelay, true);
  assert.deepEqual(sends.map(send => send.headers.Authorization), ['Bearer prior', 'Bearer renewed']);
  assert.ok(sends.every(send => !('x-gnc-session' in send.headers)));
  assert.deepEqual(sends.map(send => send.payload), [command, command]);
  const legacy = {};
  api.applyAppApiSessionHeaders(legacy, null, true);
  assert.equal(legacy['x-gnc-session'], 'unusable-legacy-token');
  api.staleSupabaseReadScopeError = () => new Error('Account changed');
  api.getNativeAuthRequestHeaders = async () => { api.nativeAuthRecoveryEpoch++; return null; };
  await assert.rejects(api.postAppFunctionJson('/app-api', command), /Account changed/);
  assert.equal(sends.length, 2);

  let release;
  const oldStatus = new Promise(resolve => { release = resolve; });
  const current = { runId:'new', active:true, startedAt:'2026-11-04T18:00:00Z' };
  const poll = runFunctions('assets/app-runtime.js', ['refreshManualSyncStatus'], {
    currentUser:'dylan_collyge', document:{hidden:false}, navigator:{onLine:true},
    manualSyncStatusPollInFlight:false, manualSyncStatusState:null, getSupabaseReadIdentityScope:() => 'fixture-owner',
    fetchManualSyncStatusFromScript:() => oldStatus, applyManualSyncStatus:() => assert.fail('superseded status applied')
  });
  const observed = poll.refreshManualSyncStatus(true);
  poll.manualSyncStartGeneration++;
  poll.manualSyncStatusState = current;
  release({runId:'yesterday',active:false,percent:100});
  assert.equal(await observed, current);
});

test('Invariant 464 (Suspend save and camera upload replay an early authentication rejection once)', async () => {
  for (const multipart of [false,true]) {
    const calls = [];
    const api = runFunctions('assets/app-runtime.js', ['postAppFunctionJson','postAppFunctionFormData','applyAppApiSessionHeaders'], {
      currentUser:'fixture', nativeAuthRecoveryEpoch:1, APP_VERSION:'fixture', SUPABASE_KEY:'public', SUPABASE_UPLOAD_TIMEOUT_MS:1000,
      window:{}, PRELOGIN_BACKGROUND_ACTIONS:new Set(), isAllowedAppHostname:()=>true,
      getNativeAuthRequestHeaders:async refresh=>({Authorization:refresh?'Bearer fresh':'Bearer prior'}),
      getCurrentAppSessionToken:()=>'', isLoginScreenVisible:()=>false,
      fetchWithTimeout:async (_url,request)=>{
        calls.push(request);
        const ok = calls.length === 2;
        return {ok,status:ok?200:401,headers:{get:()=>null},text:async()=>JSON.stringify(ok?{ok:true}:{code:'AUTH_REQUIRED'})};
      }
    });
    const body = multipart ? new FormData() : {action:'suspend_tag',operation:'save',commandId:'row-command'};
    if (multipart) body.set('prefix','req-');
    const result = await api[multipart?'postAppFunctionFormData':'postAppFunctionJson']('/app-api',body);
    assert.equal(result.ok,true);
    assert.deepEqual(calls.map(call=>call.headers.Authorization),['Bearer prior','Bearer fresh']);
    assert.equal(calls[0].body,calls[1].body);
  }
});

test('Invariant 465 (Assigned Items fallback keeps eight labeled filter controls and selection state)', () => {
  const api = runFunctions('assets/app-runtime.js', ['renderManagerAssignedFallbackRows','renderManagerAssignedColumnTrigger','getManagerAssignedColumnDefinitions'], {
    getManagerAssignedColumnState:()=>({filters:{WAREHOUSEI:['North']}}), canManageEvalItemcodeAssignments:()=>false,
    getManagerAssignedColumnLabel:(_field,value)=>value, escapeHtml:value=>String(value)
  });
  const html = api.renderManagerAssignedFallbackRows([]);
  assert.equal((html.match(/data-assigned-filter-trigger="(?!LOCATIONCODE")/g) || []).length,8);
  assert.ok(html.includes('<span>Effective Worker</span><span class="assigned-filter-value">All</span>'));
  assert.ok(html.includes('<span>Warehouse</span><span class="assigned-filter-value">North</span>'));
  assert.ok(html.includes('data-assigned-filter-trigger="PLANTGROUPCODE"'));
});

test('Invariant 466 (Plant Group cross-filter offers only owners with matching rows)', () => {
  const rows = [{group:'330_TREES',owner:'josh'}, {group:'330_TREES',owner:'josh'}, {group:'130_SHRUB',owner:'nelly'}];
  const field = 'DEFAULT_ASSIGNEDTO';
  const state = {filters:{PLANTGROUPCODE:['330_TREES'],DEFAULT_ASSIGNEDTO:['nelly']}};
  const api = runFunctions('assets/app-runtime.js',['getManagerAssignedColumnOptions'], {
    getManagerAssignedColumnState:()=>state,
    getFilteredManagerAssignedItemsExportRows:(_rows,except)=>{assert.equal(except,field); return rows.filter(row=>state.filters.PLANTGROUPCODE.includes(row.group));},
    getManagerAssignedColumnValue:row=>row.owner, getManagerAssignedColumnLabel:(_field,value)=>value
  });
  const options = Array.from(api.getManagerAssignedColumnOptions(field), option=>[option.value,option.count]);
  assert.deepEqual(options,[['josh',2]]);
});

test('Invariant 467 (Location is pinned after Warehouse and each location matches independently)', () => {
  const api = runFunctions('assets/app-runtime.js',['getManagerAssignedColumnDefinitions','getAssignedLocationTokens','matchesManagerAssignedColumnFilters']);
  const fields = Array.from(api.getManagerAssignedColumnDefinitions(), entry=>entry[0]);
  assert.deepEqual(fields.slice(2,5),['WAREHOUSEI','LOCATIONCODE','ITEMCODE']);
  const row = {LOCATIONCODE:'D.18.000, D.22.000, d.18.000'};
  assert.equal(api.getAssignedLocationTokens(row).length,2);
  assert.equal(api.matchesManagerAssignedColumnFilters(row,{LOCATIONCODE:['d.22.000']}),true);
  assert.equal(api.matchesManagerAssignedColumnFilters(row,{LOCATIONCODE:['d.99.000']}),false);
});

test('Invariant 468 (searched Apply and Enter exclude hidden values and clearing search restores the original draft)', () => {
  const state = {filters:{}, editor:{field:'COMMONNAME',values:null,search:'',limit:100}};
  const options = [{label:'Asian Moon Butterfly Bush',value:'moon'}, {label:'Blue Heaven Butterfly-Bush',value:'blue'}, {label:'Rose',value:'rose'}];
  const api = runFunctions('assets/app-runtime.js',['searchManagerAssignedColumnOptions','getManagerAssignedPopoverOptions','scopeManagerAssignedSearch','toggleManagerAssignedColumnValue','handleManagerAssignedFilterKey','applyManagerAssignedColumnFilter'],{
    getManagerAssignedColumnState:()=>state, getManagerAssignedColumnOptions:()=>options,
    canViewAssignedItemsExport:()=>true, closeManagerAssignedColumnFilter:()=>{}, requestAnimationFrame:()=>{},
    renderManagerAssignedColumnOptions:()=>api.scopeManagerAssignedSearch(state.editor,api.getManagerAssignedPopoverOptions(state.editor))
  });
  api.searchManagerAssignedColumnOptions('bush butterfly');
  assert.deepEqual(Array.from(state.editor.values),['moon','blue']);
  api.searchManagerAssignedColumnOptions('butterflybush');
  api.toggleManagerAssignedColumnValue('moon',false);
  api.handleManagerAssignedFilterKey({key:'Enter',target:{id:'manager-assigned-value-search'},preventDefault(){},stopPropagation(){}});
  assert.deepEqual(Array.from(state.filters.COMMONNAME),['blue']);
  api.searchManagerAssignedColumnOptions('');
  assert.equal(state.editor.values,null);
  api.searchManagerAssignedColumnOptions('missing');
  api.applyManagerAssignedColumnFilter();
  assert.deepEqual(Array.from(state.filters.COMMONNAME),[]);
});

test('Invariant 469 (Suspend Mark Done uses On Hand and requires an inventory receipt without closing the tag)', async () => {
  const calls=[];
  const api=runFunctions('assets/app-runtime.js',['publishRowEvaluationToMasterAndNotes','calculateDockSuspendDcRequestLocMatchQty','getDockSuspendDcRequestLocMatchBaselinePtr','calculateLocMatchQtyValue'],{
    findLinkedMasterRow: row => row, getSupabaseReadIdentityScope:()=> 'owner',
    findDockSuspendDcRequestSourceRow: row => row, getSuspendTagInventoryIdentity:()=>({masterUid:'tag'}),
    matchesSuspendTagInventoryIdentity:()=>true, beginRowEvaluationMemoryPublication:()=>()=>{},
    getDockSuspendCompletionRevision:()=> 'r1',runSuspendTagRowCommand:(...args)=>{calls.push(args);return true;},
    parseAppNumber:value=>value==null?null:Number(value),parseLocMatchPercent:Number,
    firstNonEmptyValue:(...values)=>values.find(value=>value!=null && value!=='')
  });
  const row={UNIQUE_ID:'tag',PTRONHAND:245,PTRAVAILABLE:235},qty=api.calculateDockSuspendDcRequestLocMatchQty(row,'50');
  assert.equal(qty,123);
  await api.publishRowEvaluationToMasterAndNotes(row,{match:50,loc_match_qty:qty,dock_spec:'38-42" H',av_note:'SPEC - 38-42" H'});
  assert.equal(calls[0][0],'save');assert.equal(calls[0][2].loc_match_qty,123);assert.equal(calls[0][4].requireInventoryReceipt,true);
});

test('Invariant 470 (open ERP modal advances a fully staged run once and shows five operational sources)',async()=>{
  let calls=0,release;
  const ctx=runFunctions('assets/app-runtime.js',['erpSyncProgressCards','driveManualErpSyncFromStatus'],{
    window:{},document:{hidden:false},navigator:{onLine:true},canRunManualInventoryImport:()=>true,getSupabaseReadIdentityScope:()=>'owner',
    continueManualErpSync:()=>{calls++;return new Promise(resolve=>{release=resolve;});}
  });
  const status={active:true,runId:'existing',workerActive:true,currentStage:'soc',sourceProgress:{soc:{stage:'staging',rowsStaged:338,rowsParsed:338},prod_schedule:{stage:'queued'}}};
  assert.deepEqual(Array.from(ctx.erpSyncProgressCards(status),card=>card.key),['drive','cav','reserves','soc','hl_po']);
  assert.equal(ctx.driveManualErpSyncFromStatus(status,true),true);
  assert.equal(ctx.driveManualErpSyncFromStatus(status,true),false);
  await Promise.resolve();assert.equal(calls,1);release();await ctx.window.erpSyncContinuationDriver.promise;
});

test('Invariant 471 (same-bed cards with separate physical UIDs never share evaluation evidence)', () => {
  const target = {UNIQUE_ID:'pri-1',ITEMCODE:'005670.051.1',LOCATIONCODE:'J.03.000',LOTCODE:'27.F1',PHOTO_LINK:'target.jpg'};
  const sibling = {...target,UNIQUE_ID:'pri-10',PHOTO_LINK:''};
  const otherLot = {...sibling,UNIQUE_ID:'spring',LOTCODE:'27.S1'};
  const otherItem = {...sibling,UNIQUE_ID:'sea-green',ITEMCODE:'000310.070.1'};
  const rows = [target,sibling,otherLot,otherItem], state = {};
  const ctx = runFunctions('assets/row-workflow-functions.js',['inventoryPhotoLocationKey','getInventoryLocationPhotos'],{
    fullInventory:rows,avOpenInventory:[],inventoryDomIdLookupCacheVersion:1,queueCardInventoryRenderVersion:1,
    getManagerAssignedColumnState:()=>state,getSupabaseReadIdentityScope:()=>'actor',
    getSharedAppPhotoLinkCsvRaw:r=>r.PHOTO_LINK,getPhotoUrlList:s=>s?[s]:[],isPhotoEntryExpired:()=>false,resolveAndFormatPhotoDate:()=>{}
  });
  for (const row of [target,{...target,UNIQUE_ID:'tag',SOURCE_TABLE:'ph_soc_master',MASTER_ID:'pri-1'}]) {
    assert.deepEqual(Array.from(ctx.getInventoryLocationPhotos(row)),['target.jpg']);
  }
  for (const row of [sibling,otherLot,otherItem,{LOCATIONCODE:'J.03.000'},{ITEMCODE:target.ITEMCODE,LOCATIONCODE:'J.03.000'}]) {
    assert.deepEqual(Array.from(ctx.getInventoryLocationPhotos(row)),[]);
  }
  const guard = runFunctions('assets/app-runtime.js',['normalizeDriveEvidenceLocationPart','isSameDriveEvidenceLocation']);
  assert.equal(guard.isSameDriveEvidenceLocation(target,{...target},true),true);
  for (const row of [sibling,otherLot,otherItem]) assert.equal(guard.isSameDriveEvidenceLocation(row,target,true),false);
});

test('Invariant 472 (Queue photos can be borrowed for display without changing either physical master)', () => {
  const row = {ITEMCODE:'002769.150.1',LOCATIONCODE:'C.08.000',LOTCODE:'27.F1',PRIORITY:'1',UNIQUE_ID:'jewel',PHOTO_LINK:'photo-a'};
  const empty = {...row,UNIQUE_ID:'other',PHOTO_LINK:'',PRIORITY:'10'};
  const wrong = {...row,UNIQUE_ID:'wrong',ITEMCODE:'else',PHOTO_LINK:'wrong-photo'};
  const ctx=runFunctions('assets/row-workflow-functions.js',['getQueueDisplayEvidenceRow','getQueueDisplayPhotoUrls','inventoryPhotoLocationKey'],{
    window:{AgMetricQueueInventory:{normalizeLocation:s=>s}},getRequestItemCodeOptionItemCode:r=>r.ITEMCODE,
    isFalseBlockLocation:()=>false,isRequestOwnedPhotoRow:()=>true,isDockSuspendDcRequestMirrorRow:()=>false,
    getSupabaseReadIdentityScope:()=>'actor',getManagerAssignedColumnState:()=>({}),suspendTagItemHydration:new Map(),
    masterInventoryByNormalizedItemLocation:new Map([['bed',[empty,row,wrong]]]),getInventoryCardItemLocationKey:()=>'bed',
    resolveLiveInventoryForCard: value => value.MASTER_ID === 'other' ? empty : row,
    masterInventoryById:new Map(),getSharedAppPhotoLinkCsvRaw:r=>r.PHOTO_LINK,getPhotoUrlList:v=>v?[v]:[],getInventoryLocationPhotos:()=>[]
  });
  const request={...empty,SOURCE_TABLE:'ph_requests_pending',UNIQUE_ID:'request',MASTER_ID:'other'};
  const display=ctx.getQueueDisplayEvidenceRow(request);
  assert.equal(display.UNIQUE_ID,'other');assert.deepEqual(Array.from(ctx.getQueueDisplayPhotoUrls(display)),[]);
  const unlinked=ctx.getQueueDisplayEvidenceRow({...request,MASTER_ID:''});
  assert.equal(unlinked.UNIQUE_ID,'jewel');assert.deepEqual(Array.from(ctx.getQueueDisplayPhotoUrls(unlinked)),['photo-a']);
  assert.equal(ctx.getQueueDisplayEvidenceRow({...empty,SOURCE_TABLE:'ph_master_inventory'}),null);
  assert.equal(ctx.inventoryPhotoLocationKey(request),'uid:other');assert.equal(empty.PHOTO_LINK,'');
});

test('Invariant 473 (an inventory completion lock needs both a photo and positive match stock)', () => {
  const domain={}; vm.runInNewContext(read('assets/inventory-photo-domain.js'),domain);
  const ctx=runFunctions('assets/row-workflow-functions.js',['hasLockableInventoryEvidence','isCompletedInventoryRow'],{
    calculateLiveLocPhotoMatch:domain.calculateLiveLocPhotoMatch,
    getPhotoUrlList:v=>v?[v]:[]
  });
  const row={DATE_COMPLETED:'2026-11-04',PTRONHAND:130,PTRAVAILABLE:130,MATCH:80,PHOTO_LINK:'photograph'};
  assert.equal(ctx.isCompletedInventoryRow(row),true);
  assert.equal(ctx.isCompletedInventoryRow({...row,PHOTO_LINK:''}),false);
  assert.equal(ctx.isCompletedInventoryRow({...row,MATCH:0}),false);
  assert.equal(ctx.isCompletedInventoryRow({...row,LOC_PHOTO_MATCH:'N/A'}),false);
  assert.equal(ctx.isCompletedInventoryRow({...row,LOC_PHOTO_MATCH:0}),false);
});
import { assertPublishedPhotoRetainsLocalPreview } from './helpers/photo-field-lifecycle-contract.mjs';
test('Invariant 474 (a completed photo keeps its local preview until the permanent image loads)', () => assertPublishedPhotoRetainsLocalPreview(runFunctions));

test('Invariant 475 (a save receipt cannot remove newer detail text or another account’s draft)', () => {
  let owner='a'; const storage=new Map(),input={value:''};
  const ctx=runFunctions('assets/row-workflow-functions.js',['rowEvaluationDraftKey','readRowEvaluationDraft','restoreRowEvaluationDraft','clearSavedRowEvaluationDraft'],{
    currentUser:'worker',getSupabaseReadIdentityScope:()=>owner,document:{getElementById:()=>input},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
  });
  const row={UNIQUE_ID:'one'},key=ctx.rowEvaluationDraftKey(row,'lsn-');
  storage.set(key,JSON.stringify({'lsn-spec':'new'}));ctx.clearSavedRowEvaluationDraft(row,'lsn-',{'lsn-spec':'old'});
  ctx.restoreRowEvaluationDraft(row,'lsn-');assert.equal(input.value,'new');
  owner='b';assert.equal(Object.keys(ctx.readRowEvaluationDraft(row,'lsn-')).length,0);
  owner='a';ctx.clearSavedRowEvaluationDraft(row,'lsn-',{'lsn-spec':'new'});assert.equal(storage.has(key),false);
});

test('Invariant 476 (the service worker gives an older page control of its own upgrade)', () => invariant476({runFunctions}));

test('Invariant 477 (Reclass transport recovery replays one command and honors a permission denial)', async () => {
  let fail=503,calls=0;
  const command={action:'drive_reclass_inquiry',operation:'create',idempotencyToken:'fixture-command'};
  const ctx=runFunctions('assets/app-runtime.js',['postReclassCommand'],{
    getSupabaseReadIdentityScope:()=>'actor',APP_API_FUNCTION_URL:'edge',SUPABASE_URL:'db',nativeAuthSessionActive:true,
    postAppFunctionJson:async()=>{throw Object.assign(new Error('request'),{status:fail})},getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer fixture'}),
    fetchWithTimeout:async(_url,options)=>{const body=JSON.parse(options.body);calls++;if(calls===1)assert.deepEqual(body.p_command,command);else assert.equal(body.p_ticket,15);
      return {ok:true,json:async()=>calls===1?{ticket:15,pending:true}:{ticket:15,status:200,body:{ok:true}}};},
    setTimeout:fn=>fn()
  });
  assert.equal((await ctx.postReclassCommand(command)).ok,true);assert.equal(calls,2);
  fail=403;await assert.rejects(ctx.postReclassCommand(command));assert.equal(calls,2);
});

test('Invariant 478 (fully staged SOC resumes its own run while it still needs a publication receipt)',async()=>{
  let runs=[];const ctx=runFunctions('assets/erp-sync-ui-functions.js',['driveManualErpSyncFromStatus'],{
    window:{},document:{hidden:false},navigator:{onLine:true},canRunManualInventoryImport:()=>true,getSupabaseReadIdentityScope:()=>'owner',
    continueManualErpSync:async s=>runs.push(s.runId)
  });
  const state={active:true,runId:'same-run',workerActive:true,currentStage:'soc',sourceProgress:{soc:{rowsParsed:338,rowsStaged:338,publicationConfirmed:false}}};
  assert.equal(ctx.driveManualErpSyncFromStatus(state),true);assert.equal(ctx.driveManualErpSyncFromStatus(state),false);
  await ctx.window.erpSyncContinuationDriver.promise;assert.deepEqual(runs,['same-run']);
});

test('Invariant 479 (revision bursts debounce once and a session owns one channel)', async () => {
  const { assertRealtimeQuotaContract } = await import('./helpers/realtime-quota-contract.mjs');
  await assertRealtimeQuotaContract();
});

test('Invariant 480 (live progress dialog retains bounded centered width)', () => progressStyleContract(read));

test('Invariant 481 (photo encoders start at Full HD and 0.90 while retaining bounded thumbnails)', async () => {
  const { assertPhotoTargetContract } = await import('./helpers/realtime-quota-contract.mjs');
  await assertPhotoTargetContract();
});

test('Invariant 482 (evaluation previews and saves isolate the full physical row)', assertExactRowEvaluationContract);

test('Invariant 483 (Docks and Suspend retain exact display evidence and closed-tag receipts)', assertDocksSuspendIntegrity);

test('Invariant 484 (numeric Docks and active evaluated Suspend tags share current SOC membership)', assertCurrentSocDockContract);

test('Invariant 485 (Mark Done returns to cards before persistence and retains uploaded previews)', assertCompletionCardsContract);

test('Invariant 486 (ERP source dates outrank leading clocks and watchdog repairs stay local)', assertErpFilenameAndWatchdogContract);

test('Invariant 487 (Suspend membership follows workbook destination and terminal receipts)', assertSocSuspendMembership);

test('Invariant 488 (all Suspend routes, owner defaults and saved-work retention)', assertSuspendRoutingAndDefaults);


test('Invariant 489 (all-season photos bypass season and sales year while selected-season views retain them)', () => {
  for (const mode of ['valid_photos','photos','all']) {
    const c=runFunctions('assets/app-runtime.js',['createAvTopFilterPredicate','applyAvColumnFiltersToItems','getAvSeasonSummaryLabel'],{
      getAvPhotoMode:()=>mode,normalizeAvSelectedSeasons(){},selectedAvSeasons:new Set(['F1']),
      avGenusSelectionMode:'all',avContSizeSelectionMode:'all',selectedAvGenusNames:new Set(),selectedAvContSizes:new Set(),
      normalizeAvFacetCompareKey:v=>String(v).toLowerCase(),getAvFilterSeasonValue:r=>r.SEASON,itemMatchesAvHoldFilter:r=>!r.blocked,
      avColumnFilters:{SEASON:{},SALEYEAR:{}},normalizeDriveColumnFilterKey:v=>v,isDriveColumnFilterActive:()=>true,getAvColumnFilterForField:()=>({}),
      doesAvColumnFilterMatchItem:(r,k)=>k==='SEASON'?r.SEASON==='F1':r.SALEYEAR===2027,areAllAvSeasonsSelected:()=>false,getOrderedAvSeasonOptions:()=>['F1','S1']
    });
    const rows=[{SEASON:'F1',SALEYEAR:2026},{SEASON:'S1',SALEYEAR:2027},{SEASON:'F1',SALEYEAR:2028},{SEASON:'X',SALEYEAR:2027},{SEASON:'F1',SALEYEAR:2027,blocked:true}];
    const result=c.applyAvColumnFiltersToItems(rows).filter(c.createAvTopFilterPredicate());
    assert.equal(result.length,mode==='valid_photos'?4:0);
    assert.equal(c.getAvSeasonSummaryLabel(),mode==='valid_photos'?'All Seasons':'F1');
  }
});

test('Invariant 490 (shared Excel facets cascade, search, commit displayed checks and isolate accounts)', () => {
  const names=['getInventoryExcelState','inventoryExcelKey','getInventoryExcelFacts','inventoryExcelFactMatches','inventoryExcelRowMatches','getInventoryExcelOptions','getInventoryExcelDisplayedOptions','searchInventoryExcelFilter','toggleInventoryExcelOption','bulkInventoryExcelFilter','applyInventoryExcelFilter'];
  const c=runFunctions('assets/row-workflow-functions.js',names,{getSupabaseReadIdentityScope:()=> 'first',resolveSuspendOwner:r=>r.assignedto,paintInventoryExcelOptions(){},refreshInventoryExcelView(){},doesExcelFilterSearchMatchStart:(v,q)=>String(v).toLowerCase().includes(String(q).toLowerCase())});
  const state=c.getInventoryExcelState('eval2');state.rows=[{assignedto:'dylan',commonname:'Everlow Yew',plantgroupcode:'TAX',contsize:'#3'},{assignedto:'megan',commonname:'Everlow Yew',plantgroupcode:'TAX',contsize:'#5'},{assignedto:'dylan',commonname:'Red Oak',plantgroupcode:'QUE',contsize:'#3'}];
  state.filters.username=new Set(['dylan']);assert.deepEqual(Array.from(c.getInventoryExcelOptions(state,'contsize'),o=>[o.label,o.count]),[['#3',2]]);
  assert.equal(c.getInventoryExcelOptions(state,'username').length,2);
  state.open={field:'commonname',options:c.getInventoryExcelOptions(state,'commonname'),draft:new Set(['everlow yew','red oak']),query:'',beforeSearch:null};
  c.searchInventoryExcelFilter('eval2','everlow');c.bulkInventoryExcelFilter('eval2',false);assert.equal(state.open.draft.has('red oak'),true);
  c.searchInventoryExcelFilter('eval2','');assert.equal(state.open.draft.has('everlow yew'),true);
  c.searchInventoryExcelFilter('eval2','everlow');c.applyInventoryExcelFilter('eval2');assert.deepEqual(Array.from(state.filters.commonname),['everlow yew']);
  c.getSupabaseReadIdentityScope=()=> 'second';assert.equal(Object.keys(c.getInventoryExcelState('eval2').filters).length,0);
});

test('Invariant 491 (Excel serial dates match calendar dates and location drills never expand siblings)', () => {
  const c={};vm.runInNewContext(read('assets/eval-reports-engine.js'),c);const api=c.GncEvalReports;
  const day=api.parseInventoryDateEpochDay('11/5/2026'),serial=day-Math.floor(Date.UTC(1899,11,30)/86400000);
  for(const value of [String(serial),String(serial)+'.75','11/5/26','11/05/2026','2026-11-05T12:30:00Z'])assert.equal(api.parseInventoryDateEpochDay(value),day);
  for(const value of ['60','0','02/30/2026','not a date'])assert.equal(api.parseInventoryDateEpochDay(value),null);
  const columns=['unique_id','itemcode','commonname','locationcode','blockalpha','season','reportIds'];
  const metadata={browseColumns:columns,browseRows:[['one','A','Everlow','A.01.001','A','F1',['low-stock']],['two','A','Everlow','B.02.001','B','S1',['low-stock']]]};
  const page=api.buildBrowsePage(metadata,{surface:'eval2',operation:'groups',filters:{reportIds:['low-stock'],groupBy:'itemcode',blockalpha:'A',drillLocation:'A.01.001'}},'one');
  assert.equal(page.rows.length,1);assert.equal(page.rows[0].previewRows.length,1);assert.equal(page.rows[0].previewRows[0].unique_id,'one');
});

test('Invariant 492 (preboot recovery is bounded, sanitized and preserves unrelated workers and login storage)', () => invariant492({read}));

test('Invariant 493 (all required views share the inventory facet engine and Reclass keeps drafts mounted)', () => {
  const names=['getInventoryExcelFields','inventoryExcelKey'];const c=runFunctions('assets/row-workflow-functions.js',names);
  assert.deepEqual(Array.from(c.getInventoryExcelFields(),f=>f[0]),['username','plantgroupcode','commonname','contsize','blockalpha','locationcode','season','lotcode']);
  const runtime=read('assets/app-runtime.js'),workflow=read('assets/row-workflow-functions.js');
  for(const scope of ['drive','av','docks','suspend','request','evalwork','locationwork','recount','shear','queueshear','smart','eval1','eval2','reclass']) assert.ok((runtime+workflow).includes("applyInventoryExcelFilters('"+scope+"'"),scope);
  const fn=functionSource('assets/row-workflow-functions.js','paintReclassInventoryExcel');assert.match(fn,/card\.hidden=/);assert.doesNotMatch(fn,/innerHTML|replaceChildren/);
});

test('Invariant 494 (inventory facet bars retire when the owning Manager module or queue tab changes)', () => facetRetirementContract(runFunctions));

test('Invariant 495 (Reclass source stock is exact-year and current destinations share only the current/carryover pool)', () => {
 const c=runFunctions('assets/app-runtime.js',['reclassStockSeason','normalizeNcrSalesYearValue','buildOptimisticInventoryReclassMoveModel'],{
  parseAppNumber:v=>v==null||v===''?null:Number(v),getNcrExplicitSalesYear:()=>null,getConfiguredCurrentSalesYearCode:()=>27,getConfiguredCurrentSeasonCode:()=>'F1',
  cavInventory:[{itemcode:'A',season:'F1',ptravailable:'151'}],buildItemInquiryViewModel:(item,rows)=>({rows})});
 const row=(uid,lot,oh,stock,loc='A')=>({UNIQUE_ID:uid,ITEMCODE:'A',LOCATIONCODE:loc,LOTCODE:lot,SALEYEAR:'20'+lot.slice(0,2),PTRONHAND:String(oh),PTRAVAILABLE:String(oh),S_LTS:String(stock),PRIORITY:'10'});
 const rows=[row('source','27.S1',401,401),row('carry','26.F1',69,69,'G'),row('future-f','28.F1',151,151),row('future-s','28.S1',151,151)];
 const command={commandId:'move-up',moves:[{source:{uniqueId:'source'},lines:[{quantity:125,destinationSeason:'F1'}]}]};
 let result=c.buildOptimisticInventoryReclassMoveModel({item:{},inquiryModel:{rows}},command).model.rows;
 const at=lot=>result.find(r=>r.LOTCODE===lot);
 assert.equal(result.length,5);assert.equal(at('27.S1').S_LTS,'276');assert.equal(at('27.S1').PTRONHAND,'276');
 for(const lot of ['26.F1','27.F1'])assert.equal(at(lot).S_LTS,'194');
 for(const lot of ['28.F1','28.S1']){assert.equal(at(lot).S_LTS,'151');assert.equal(at(lot).PTRONHAND,'151');}
 assert.equal(at('27.F1').PRIORITY,'10');assert.equal(at('27.F1').PTRAVAILABLE,'125');
 const existing={...row('target','27.F1',0,69),SOURCE:'different display alias'};
 result=c.buildOptimisticInventoryReclassMoveModel({item:{},inquiryModel:{rows:[...rows,existing]}},command).model.rows;
 assert.equal(result.filter(r=>r.LOTCODE==='27.F1').length,1);assert.equal(at('27.F1').UNIQUE_ID,'target');
 const beforeCarry=at('26.F1').S_LTS;
 result=c.buildOptimisticInventoryReclassMoveModel({item:{},inquiryModel:{rows:result}},{commandId:'move-down',moves:[{source:{uniqueId:'target'},lines:[{quantity:125,destinationSeason:'S1'}]}]}).model.rows;
 assert.equal(at('26.F1').S_LTS,beforeCarry);assert.equal(at('27.S1').S_LTS,'401');
 assert.equal(at('28.S1').S_LTS,'151');assert.equal(at('28.F1').S_LTS,'151');
});

test('Invariant 496 (removing Priority retains the row Move Up quantity and rendered destination without native confirmation)', () => {
 const move={action:'move_up',splits:[{quantity:'125',destinationSeason:'F1'}]};
 const rowMap={move_up:move,priority_change:{action:'priority_change',priority:'10'}};
 const state={activeReclassAction:{one:'priority_change'}};
 const c=runFunctions('assets/app-runtime.js',['toggleArgosReclassV3Action','cloneArgosReclassProposal','buildArgosReclassV3ProposalHtml'],{
  argosInventoryTransactionState:state,argosReclassMultiActionState:{rowProposals:new Map([['one',rowMap]])},
  canCurrentUserSubmitRepInventoryOperations:()=>false,getArgosReclassRowEditorEntry:()=>({unique_id:'one',values:{ptronhand:'401'}}),
  getReclassActionWorkflowV5Config:a=>({kind:a==='priority_change'?'priority':'move',label:a}),RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS:[],
  getArgosReclassV3HoldProposal:()=>null,getArgosReclassV3Proposal:(uid,a)=>rowMap[a],getArgosReclassRowProposalMap:()=>rowMap,
  window:{confirm(){throw Error('Native confirmation is forbidden');}},refreshArgosReclassMultiActionUi(){},captureEvalWorkLocalDraftSoon(){},generateArgosInventoryTransactionId:()=>'new',
  escapeHtml:String,getArgosReclassMoveUpLotState:()=>({rowMaximum:401}),getArgosReclassRowCurrentSeason:()=>'S1',RECLASS_ACTION_WORKFLOW_V2_SEASONS:['F1','S1'],
  getArgosReclassMoveBalanceText:()=>'',getArgosReclassMoveBalance:()=>({remaining:276})});
 c.toggleArgosReclassV3Action(null,'priority_change','one');
 assert.equal(rowMap.priority_change,undefined);assert.equal(rowMap.move_up,move);assert.equal(move.splits[0].quantity,'125');assert.equal(move.splits[0].destinationSeason,'F1');
 const html=c.buildArgosReclassV3ProposalHtml({unique_id:'one',values:{ptronhand:'401'}},'move_up');
 assert.match(html,/value="125"/);assert.match(html,/<option value="F1" selected>F1/);assert.match(html,/toggleArgosReclassDestinationMenu\(this\)">F1 /);
 let expanded='';const card={getAttribute:k=>k==='data-reclass-row-card'?'one':'false'};
 const w=runFunctions('assets/row-workflow-functions.js',['toggleArgosReclassRowCard'],{getArgosReclassRowEditorEntry:()=>({}),focusArgosReclassRow:uid=>{expanded=uid;return false;}});
 w.toggleArgosReclassRowCard({closest:()=>card});assert.equal(expanded,'one');
});

test('Invariant 497 (history keeps Eval Reports subview, cloned drill state and exact return scroll)', () => {
 const restored={};
 const context={structuredClone,Date,viewHistoryStack:[],activeHomeTab:'eval-reports-2',MANAGER_EVAL_REPORTS_2_VIEW:'eval-reports-2',driveViewLevel:3,activeDriveTab:'name',
  shouldResetIosPhoneMainScrollForView:()=>false,getMainAreaScrollTop:()=>640,captureAppFilterState:()=>({drive:{driveViewLevel:3}}),
  getCurrentVisibleViewId:()=>'drive',markViewDirty(){},restorePersistedAppFilterStateForCurrentUser(force,snapshot){restored.snapshot=snapshot;},
  fastBackToView(view,options){restored.view=view;restored.options=options;}};
 const fields=["activeManagerEvalReport2","managerEvalReport2Mode","managerEvalReport2DisplayMode","managerEvalReport2SeasonFilters","managerEvalReport2ContSizeFilter","managerEvalReport2AssignedToFilter","managerEvalReport2AssignedToFilters","managerEvalReport2LocationFilter","managerEvalReport2PriorityFilter","managerEvalReport2BrowseMode","managerEvalReport2DrillLevel","managerEvalReport2SelectedCommonName","managerEvalReport2SelectedContSize","managerEvalReport2SelectedBlockAlpha","managerEvalReport2SelectedBlockNumber","managerEvalReport2SelectedLocationCode","managerEvalReport2DrillScrollByKey","managerEvalReport2SelectedReportIds","managerEvalReport2DetailItemKey","managerEvalReport2DetailReturnScrollTop","managersSearchTerm"];
 for(const field of fields)context[field]='';
 Object.assign(context,{activeManagerEvalReport2:'low-stock',managerEvalReport2DrillLevel:3,managerEvalReport2SelectedLocationCode:'A.09.000',managerEvalReport2SeasonFilters:new Set(['F1']),managerEvalReport2DrillScrollByKey:new Map([['location',640]]),managerEvalReport2SelectedReportIds:['low-stock']});
 const c=runFunctions('assets/app-runtime.js',['pushViewHistoryEntry','pruneViewHistoryStack','restorePreviousViewFromHistory'],context);
 c.pushViewHistoryEntry('managers',640,'drive');
 assert.equal(c.viewHistoryStack[0].view,'eval-reports-2');assert.equal(c.viewHistoryStack[0].directDriveEntry,true);
 c.managerEvalReport2SelectedLocationCode='OTHER';c.managerEvalReport2SeasonFilters.add('S1');c.activeHomeTab='dashboard';
 assert.equal(c.restorePreviousViewFromHistory(),true);assert.equal(c.activeHomeTab,'eval-reports-2');assert.equal(c.managerEvalReport2SelectedLocationCode,'A.09.000');
 assert.deepEqual(Array.from(c.managerEvalReport2SeasonFilters),['F1']);assert.equal(restored.options.targetScrollTop,640);assert.equal(restored.view,'managers');
});

test('Invariant 498 (ordinary Drive Back steps within the drill; direct report entry restores its history)', () => {
 let stepped=0,restored=0;
 const c=runFunctions('assets/app-runtime.js',['goBackUniversal'],{
  getVisibleSecondaryBack:()=>null,getManagerAssignedColumnState:()=>({}),getCurrentVisibleViewId:()=>'drive',isDrawerOpen:()=>false,closeOpenInteractiveSurfaceForBack:()=>false,
  viewHistoryStack:[{viewId:'managers',subView:'dashboard'}],window:{SalesWorkspace:{back:()=>false}},LocationCode:{back:()=>false},
  activeDriveTab:'name',driveViewLevel:3,selectedDriveName:'Gold Mop',selectedDriveSize:'#5',selectedDriveSeason:'F1',
  backToDriveSeasons:()=>stepped++,updateGlobalBackButton(){},restorePreviousViewFromHistory:()=>{restored++;return true;}});
 c.goBackUniversal();assert.equal(stepped,1);assert.equal(restored,0);
 c.viewHistoryStack[0]={viewId:'managers',subView:'eval-reports-2',directDriveEntry:true};c.goBackUniversal();assert.equal(restored,1);assert.equal(stepped,1);
});

test('Invariant 499 (committed Reclass rows invalidate and repaint Eval Reports while preserving scroll)', () => {
 const dirty=[],restored=[];let repainted=0,invalidated=0;
 const c=runFunctions('assets/app-runtime.js',['publishArgosInventoryTransactionReturnedRows'],{
  rebuildMasterInventoryIndexes(){},invalidateResolvedViewStateCaches(){},refreshRealtimeDetailLookupIndexes(){},getDatasetKeysForTable:()=>['master'],getVisibleAffectedViewIds:()=>['managers'],propagateCommittedEdit(){},refreshLiveLocMatchQuantityPreviews(){},
  invalidateManagerEvalReport2Cache:()=>invalidated++,getCurrentVisibleViewId:()=>'managers',getMainAreaScrollTop:()=>640,markViewDirty:v=>dirty.push(v),
  activeHomeTab:'eval-reports-2',MANAGER_EVAL_REPORTS_2_VIEW:'eval-reports-2',refreshManagerEvalReport2BrowseRegion:()=>repainted++,schedulePostRenderMainAreaScrollRestore:(...args)=>restored.push(args)});
 c.publishArgosInventoryTransactionReturnedRows([{UNIQUE_ID:'confirmed',SOURCE_TABLE:'ph_master_inventory'}]);
 assert.equal(invalidated,1);assert.equal(repainted,1);assert.equal(restored[0][2],640);assert.deepEqual(dirty,['managers','drive','av','request']);
});


test('Invariant 500 (Plan Start colors use calendar dates at local noon including Excel serials)', () => weekdaySerialContract(runFunctions));

test('Invariant 501 (native filter surfaces exclude duplicate queue and AV controls)', () => {
 const c=runFunctions('assets/row-workflow-functions.js',['getInventoryExcelFields']);
 assert.deepEqual(Array.from(c.getInventoryExcelFields('suspend'),x=>x[0]),['plantgroupcode']);
 assert.equal(c.getInventoryExcelFields('request').length,0);
 assert.equal(c.getInventoryExcelFields('av').some(x=>x[0]==='contsize'),false);
 assert.equal(c.getInventoryExcelFields('av').filter(x=>x[0]==='season').length,1);
 assert.equal(c.getInventoryExcelFields('drive').some(x=>x[0]==='username'),true);
});
test('Invariant 502 (remembered session suppresses preboot recovery without bypassing logout)', () => invariant502({read}));
test('Invariant 503 (request publication rejects older reads and accepts authoritative empty snapshots)', () => requestPublicationContract(runFunctions, functionSource));
test('Invariant 504 (sync continuations honor server backoff even after staging)', () => continuationDelayContract(runFunctions));
test('Invariant 505 (Suspend membership uses source identities without a current-day cutoff)', () => {
 const rows=[{UNIQUE_ID:'old-date',PLANSTART:'2026-11-04'},{UNIQUE_ID:'today',PLANSTART:'2026-11-05'}];
 const c=runFunctions('assets/app-runtime.js',['getLatestSocSuspendTagSourceRows'],{socRawSourceRows:[],suspendTagInventory:[],suspendTagInventoryScope:'owner',getSupabaseReadIdentityScope:()=> 'owner',uniquePhysicalSuspendTags:r=>r,isDockSuspendDcRequestSource:()=>true});
 assert.equal(c.getLatestSocSuspendTagSourceRows(rows).length,2);
 assert.equal(c.getLatestSocSuspendTagSourceRows([]).length,0);
});


test('Invariant 506 (SOC imports exclude old years and trip-only rows without a daily cutoff)', () => socYearContract(runFunctions, read));

test('Invariant 507 (ERP report ordering uses the final report timestamp descending)', async () => {
 const {compareErpFiles}=await import('../supabase/functions/_shared/erp-sync.mjs');
 const rows=[{name:'SOC-10 Open Orders-11250620261105112506.xlsx',modifiedTime:'2026-11-05T18:00:00Z'},{name:'SOC-10 Open Orders-06250620261105062506.xlsx',modifiedTime:'2026-11-05T19:00:00Z'}];
 rows.sort(compareErpFiles);assert.match(rows[0].name,/112506/);
});
test('Invariant 508 (newest report discovery scans pending, processed and parent folders)', folderDiscoveryContract);
test('Invariant 509 (fresh manual starts prevent old modal continuations and partial counts never imply EOF)', () => foregroundRestartContract(runFunctions));

test('Invariant 510 (fresh manual SOC migration retains a scoped transactional publication contract)',async()=>{
 const m=await import('../scripts/apply-item-low-stock-migration.mjs');
 assert.deepEqual(m.selectReleaseMigrations(JSON.stringify([m.freshManualSocMigrationName])),[m.freshManualSocMigrationName]);
 assert.ok(m.migrationBody(read('supabase/migrations/'+m.freshManualSocMigrationName)).includes('soc_operational_source_row_v23191'));
 assert.match(m.migrationContractQuery(m.freshManualSocMigrationName),/as installed/);
 assert.throws(()=>m.selectReleaseMigrations(JSON.stringify(['unreviewed.sql'])),/NOT_ALLOWLISTED/);
});

test('Invariant 511 (SOC compact-history conflict statements keep independent physical inputs)',async()=>{
 const {migrationBody,freshManualSocMigrationName}=await import('../scripts/apply-item-low-stock-migration.mjs');
 const sql=migrationBody(read('supabase/migrations/'+freshManualSocMigrationName));
 const projection=sql.slice(sql.indexOf('for history_row in with history_input'));
 assert.ok(projection.indexOf('select * from history_input loop')<projection.indexOf('insert into public.ph_orders_history('));
 assert.match(projection,/values \(history_row\.order_line_key,history_row\.source_unique_id/);
 assert.match(projection,/get diagnostics step_count=row_count;[\s\S]*affected:=affected\+step_count;[\s\S]*end loop;/);
 assert.doesNotMatch(projection,/disable trigger|archive_dedup.*on/);
});

test('Invariant 512 (operational HL PO discovery selects one newest original PDF across all folders)',async()=>{
 const {prefetchSecondaryFolders}=await import('../supabase/functions/_shared/erp-secondary-sync.mjs');const visited=[];
 const fetcher=async url=>{const u=new URL(url);if(u.pathname.endsWith('/files/pending'))return {ok:true,json:async()=>({parents:['parent']})};const q=u.searchParams.get('q');visited.push(q);return {ok:true,json:async()=>({files:q.includes("'processed'")?[{id:'new',name:'HL PO 11-5-2026.pdf',modifiedTime:'2026-11-05T12:00:00Z',mimeType:'application/pdf'}]:[{id:'old',name:'HL PO 11-4-2026.pdf',modifiedTime:'2026-11-04T12:00:00Z',mimeType:'application/pdf'}]})};};
 const result=await prefetchSecondaryFolders(fetcher,'fixture',[{key:'hl_po_parsed',folder:'pending',processed:'processed',includeParent:true}]);
 assert.equal(visited.length,3);assert.deepEqual(result.hl_po_parsed.files.map(f=>f.id),['new']);
});

test('Invariant 513 (every ERP stage row carries the current snapshot filename without changing evidence)',assertSnapshotFilenameEvidence);

test('Invariant 514 (afternoon ERP clocks and explicit Warehouse 10 docks govern source membership)',assertAfternoonErpSources);

test('Invariant 515 (expired ERP photo references remain archiveable after exact-row unlock)',async()=>{
 const {pendingErpArchiveCandidates,parseStorageObjectUrl}=await import('../scripts/archive-expired-photos.mjs');
 const source_url='https://example.supabase.co/storage/v1/object/public/location_sales_notes_photos/row/photo.webp';
 const object=parseStorageObjectUrl(source_url);const job={source_key:object.sourceKey,source_bucket:object.bucket,source_path:object.path,source_url,status:'pending',invalid_reasons:['ERP_ORDER_OR_TEN_DAY_EXPIRY'],master_unique_ids:['exact-row']};
 const candidates=pendingErpArchiveCandidates([job]);assert.equal(candidates.length,1);assert.equal(candidates[0].refs[0].row.unique_id,'exact-row');
 assert.equal(pendingErpArchiveCandidates([job],candidates).length,0);assert.equal(pendingErpArchiveCandidates([{...job,source_path:'other-row/photo.webp'}]).length,0);assert.equal(pendingErpArchiveCandidates([{...job,verified_at:'2026-11-05'}]).length,0);
});

test('Invariant 516 (already-Processed ERP files require no repeated parent reads)',async()=>{
 const {moveProcessed}=await import('../supabase/functions/_shared/erp-sync.mjs');
 let calls=0;await moveProcessed(async()=>{calls++;throw Error('unexpected Drive call');},'fixture',{id:'archived',parents:['processed']},'pending','processed');assert.equal(calls,0);
});

test('Invariant 517 (busy ERP publication retains its exact staged cursor without claiming completion)', busyStageContract);

test('Invariant 518 (five operational receipts finish independently of queued production maintenance)',async()=>{
 const {isOperationalErpSyncComplete}=await import('../supabase/functions/_shared/erp-sync.mjs');
 const sourceProgress=Object.fromEntries(['drive','cav','reserves','soc','hl_po_parsed'].map(key=>[key,{checked:true,stage:'complete',percent:100}]));
 sourceProgress.prod_schedule={checked:false,stage:'queued',percent:0};
 assert.equal(isOperationalErpSyncComplete({sourceProgress}),true);
 sourceProgress.soc.checked=false;assert.equal(isOperationalErpSyncComplete({sourceProgress}),false);
});
test('Invariant 519 (queued ERP status-only updates accept absent progress and file cursors)',async()=>{
 const source=read('supabase/functions/app-api/index.ts');
 const start=source.indexOf('async function processCloudErpSyncStep(');
 const end=source.indexOf('async function releaseCloudErpSyncStep(',start);
 const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const context={...erpScanFixtureDependencies,Date,Number,String,Math,Array,Error,Deno:{env:{get:()=>''}},jsonObject:value=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected a JSON object.');return value;},
 isOperationalErpSyncComplete:()=>false,mintCloudDriveAccessToken:async()=>'fixture',
 SECONDARY_ERP_STAGES:[{key:'hl_po_parsed'}],prefetchSecondaryFolders:async()=>({}),fetch:async()=>{},
 supabase:{rpc:async(name,args)=>({data:name==='update_erp_sync_job_v1'?args.p_status:{},error:null})},
 runErpSyncWorkerStep:async({status})=>{await status({sourceProgressDelta:{key:'drive',rowsStaged:1}});return {done:false,cursor:{stageIndex:0}};}};
 vm.createContext(context);vm.runInContext(code,context);
 const result=await context.processCloudErpSyncStep('run','worker',1,{runId:'run',active:true,stageIndex:0,stageResults:[],sourceProgress:{},continuationCursor:{},error:'recovered'});
 assert.equal(result.status.sourceProgress.drive.rowsStaged,1);assert.equal(result.status.error,'');
});

test('Invariant 520 (Reclass explanations are required per changed row except canonical administrators)', () => assertGoldenReclassExplanations({functionSource}));

test('Invariant 521 (field audit preset excludes unknown years and follows exact block/location lot identity)',()=>{
 const context={};vm.createContext(context);vm.runInContext(['fieldAuditNumber','fieldAuditYear','fieldAuditNormalizeRow','fieldAuditMatchingRows','fieldAuditMetrics'].map(name=>functionSource('assets/row-workflow-functions.js',name)).join('\n'),context);
 const rows=[{unique_id:'a',itemcode:'001',locationcode:'A.05.000',lotcode:'26.Y',ptronhand:10,listprice:2},{unique_id:'b',itemcode:'002',locationcode:'B.02.000',lotcode:'25.Y',saleyear:'25',ptronhand:5,listprice:3},{unique_id:'c',locationcode:'A.01.000',lotcode:'27.Y',ptronhand:50},{unique_id:'unknown',locationcode:'C.01.000',lotcode:'Y',ptronhand:10},{unique_id:'spring',locationcode:'A.02.000',lotcode:'26.F1'}].map(context.fieldAuditNormalizeRow);
 const state={season:'Y',year:'2026max',status:'all',search:'',block:'',location:'',sort:'locationcode',direction:1};
 const audit={};audit[rows[0].row_uid]={is_product_there:'YES'};
 const match=context.fieldAuditMatchingRows(rows,state,audit);assert.deepEqual(Array.from(match,r=>r.id),['a','b']);assert.equal(rows[0].row_uid,'001|A.05.000|26.Y');assert.equal(rows[3].saleyear,null);
 const metrics=context.fieldAuditMetrics(match,audit);assert.equal(metrics.units,15);assert.equal(metrics.value,35);assert.equal(metrics.yes,1);assert.equal(metrics.left,1);assert.equal(metrics.percent,50);
 assert.deepEqual(Array.from(context.fieldAuditMatchingRows(rows,{...state,block:'B',location:'B.02.000'},audit),r=>r.id),['b']);
 assert.deepEqual(Array.from(context.fieldAuditMatchingRows(rows,{...state,status:'UNCHECKED'},audit),r=>r.id),['b']);
 assert.equal(context.fieldAuditYear('2026','27.Y'),2026);assert.equal(context.fieldAuditYear('','24.Y'),2024);
});
test('Invariant 522 (a verified live version upgrades remembered sessions and Force Data Sync without clearing identity)', () => invariant522({read, functionSource, runFunctions}));
test('Invariant 523 (shell-ready disarms preboot and copied briefs omit resolved history)', () => invariant523({read, functionSource}));
test('Invariant 524 (Request Next accepts missing quantity, defaults Desired Spec and rejects an invalid entered value)', () => {
 const items=[{UNIQUE_ID:'a',SPEC:'existing spec'},{UNIQUE_ID:'b'}],data={a:{qty:''},b:{qty:'0'}};let focused=0,blurred=0,emails=0;const prompts=[];
 const context={requestQtyStepDomIds:['0','1'],requestQtyStepIndex:0,requestQtyEmailStepActive:false,captureRequestQtyStepRenderedInputs:()=>{},getRequestSourceDomIds:()=>[],findItemByDomId:id=>items[Number(id)],getRequestQtyStepUid:item=>item.UNIQUE_ID,getRequestQtyStepData:id=>data[id],parseAppNumber:Number,requireCurrentRequestReuseDecision:()=>true,renderRequestQtyStepCurrentItem:()=>{},showRequestEmailChainFinalStep:()=>{emails++;return true;},showToast:title=>prompts.push(title),document:{activeElement:{blur:()=>blurred++},querySelector:()=>({focus:()=>focused++})}};
 vm.createContext(context);vm.runInContext(functionSource('assets/app-runtime.js','validateRequestQtyStepItems')+'\n'+functionSource('assets/app-runtime.js','advanceRequestQtyStepIfNeeded'),context);
 assert.equal(context.advanceRequestQtyStepIfNeeded(),true);assert.equal(context.requestQtyStepIndex,1);assert.equal(data.a.spec,'N/A');assert.deepEqual(prompts,[]);
 data.b.qty='-1';context.advanceRequestQtyStepIfNeeded();assert.equal(emails,0);assert.equal(focused,1);assert.deepEqual(prompts,['Invalid Quantity']);
 data.b.qty='0';context.advanceRequestQtyStepIfNeeded();assert.equal(emails,1);assert.equal(blurred,2);assert.deepEqual(data.b,{qty:'',spec:'N/A'});
});
test('Invariant 525 (enabled Request users select every rep while original reports remain alongside Field Audit)', () => invariant525({ read, functionSource }));
test('Invariant 526 (explicit physical On Hand zero controls live photo match)', async () => {
  const { dockZeroProjectionContract } = await import('./helpers/golden-dock-domain-contract.mjs');
  dockZeroProjectionContract();
});

import {assertTableDrivenRowAuthorization,assertExistingSuspendExactReceiptContract} from './helpers/table-row-authorization-contract.mjs';
test('Invariant 527 (Suspend editable receipts must identify the requested source)', assertExistingSuspendExactReceiptContract);

test('Invariant 528 (Suspend Plan Start index preserves unique and ambiguous fallback)', async () => {
  const { suspendPlanstartIndexContract } = await import('./helpers/golden-dock-domain-contract.mjs');
  suspendPlanstartIndexContract();
});

test('Invariant 529 (Request creation stays Pending with inherited evidence for either choice)', async () => {
  const { createRequestWithChoice } = await import('../src/core/request-inheritance-fixture.mjs');
  for (const choice of ['YES', 'NO']) {
    const outbox = await createRequestWithChoice(choice);
    assert.equal(outbox.status, 'pending');
    assert.equal(outbox.requests[0].req_status, 'Pending');
    assert.equal(outbox.requests[0].date_completed, null);
    assert.equal(outbox.requests[0].req_photo_link, 'saved-photo');
    assert.equal(outbox.requests[0].req_spec, 'saved spec');
    assert.equal(outbox.requests[0].completed_by_username, undefined);
  }
  const migration = read('supabase/migrations/20261106200000_agdata309_eval_publication_shield.sql');
  assert.match(migration, /CREATE TRIGGER a00000_inherit_request_eval_v309 BEFORE INSERT ON public\.ph_requests_pending/);
  assert.match(migration, /new\.req_status:='Pending';new\.status:='Pending';new\.date_completed:=NULL/);
});

test('Invariant 530 (native API identity cannot be overridden by a stale legacy actor)', async () => {
  const { transportFixture } = await import('../src/core/app-api-auth-fixture.mjs');
  const native = transportFixture({ legacy: 'different-actor', responses: [401, 200] });
  await native.context.postAppFunctionJson('/api', { action: 'erp_sync' });
  assert.equal(native.refreshed, 1);
  assert.deepEqual(native.calls.map(call => call.headers.Authorization), ['Bearer native-a', 'Bearer native-renewed']);
  assert.ok(native.calls.every(call => call.headers['x-gnc-session'] === undefined));
  const legacy = transportFixture({ native: '', legacy: 'signed-legacy' });
  await legacy.context.postAppFunctionJson('/api', { action: 'erp_sync' });
  assert.equal(legacy.calls[0].headers['x-gnc-session'], 'signed-legacy');
  const revoked = transportFixture({ legacy: 'different-actor', responses: [401, 401] });
  await assert.rejects(revoked.context.postAppFunctionJson('/api', { action: 'erp_sync' }));
});

test('Invariant 531 (Request read fallback never crosses an account change)', async () => {
  const { requestSnapshotInvariant } = await import('../src/core/golden-request-snapshot.mjs');
  await requestSnapshotInvariant();
});
// Archive identities remain stable when unrelated notes are inserted.
test('Invariant 532 (archive note identities survive insertion and distinguish duplicates and rows)', async () => {
  const { archiveNoteIdentities } = await import('../src/ui/archive-note-identity.ts');
  const initial = archiveNoteIdentities('row-a', ['first', 'second', 'first']);
  const inserted = archiveNoteIdentities('row-a', ['new', 'first', 'second', 'first']);
  assert.deepEqual(inserted.slice(1), initial);
  assert.equal(new Set(initial.map(item => item.key)).size, 3);
  assert.notEqual(archiveNoteIdentities('row-b', ['first'])[0].key, initial[0].key);
});
test('Invariant 533 (idempotent RPC recovery uses the authenticated checked bridge)', async () => {
  const { rpcRecoveryInvariant } = await import('../src/core/golden-transport-invariants.mjs');
  await rpcRecoveryInvariant(databaseBridge);
});
test('Invariant 534 (transactionless migrations remain enclosed by one atomic runner transaction)', async () => {
  const { migrationAtomicityInvariant } = await import('../src/core/golden-transport-invariants.mjs');
  migrationAtomicityInvariant();
});
import {assertDetailLiveDraftRetention,assertExistingSuspendDetailContract} from './helpers/detail-live-draft-contract.mjs';
test('Invariant 535 (Suspend detail rejects failed pending uploads before publishing or navigation)', assertExistingSuspendDetailContract);
test('Invariant 536 (Suspend completion receipts require current source and a valid completion time)', async () => {
  const { lateSuspendReceiptChecks } = await import('../src/core/suspend-late-receipt-contract.mjs');
  const { suspendTagReceiptMatchesSource } = await import('../src/core/suspend-receipt-domain.js');
  const payload = {sourceUid:'source-1'};
  for (const date of [null, '', 'invalid']) {
    assert.equal(suspendTagReceiptMatchesSource('complete', payload, {row:{unique_id:'source-1',date_completed:date}}), false);
  }
  assert.equal(suspendTagReceiptMatchesSource('complete', payload, {row:{unique_id:'source-1',date_completed:'2026-09-08T16:00:00Z'}}), true);
  await lateSuspendReceiptChecks();
});
test('Invariant 537 (release synchronization updates the source version descriptor and discovers it)',async()=>{
 const {versionDescriptorContract}=await import('./helpers/release-automation-contract.mjs');
 versionDescriptorContract();
});
test('Invariant 538 (preboot uses a bounded lifecycle deadline and never polls a loading document)',async()=>{
 const {invariant538}=await import('../src/core/golden-boot-contract.mjs');
 invariant538({read});
});
test('Invariant 539 (pilot layout retry is single-flight and bounded)', boundedPilotIdleChecks);
test('Invariant 540 (artifact hooks inspect the canonical source Git index)', assertSourceGitWorktreeIsolation);
test('Invariant 541 (Golden contract imports never register nested tests)', async () => {
  const { verifyGoldenTestDependencies } = await import('../src/core/golden-test-dependency.mjs');
  verifyGoldenTestDependencies(read, assert);
});
test('Invariant 542 (owner lookup benchmarks warm the same realm and retain the strict budget)', assertWarmOwnerBenchmarkContract);
test('Invariant 543 (canonical owner timing runs alone before functional tooling)', async () => {
  const { assertIsolatedToolingBenchmark } = await import('../src/core/golden-tooling-lanes.mjs');
  assertIsolatedToolingBenchmark();
});
test('Invariant 544 (Manager tables retain compact controls and Eval2 commits persistent multi-report choices)', async () => {
  const { assertManagerWorkspaceRestoration } = await import('./helpers/manager-workspace-restoration.mjs');
  assertManagerWorkspaceRestoration();
});
test('Invariant 545 (Apps Script fingerprint repair changes metadata only and preserves deployed routes)', async () => {
  const { prepareFingerprintRepair } = await import('../scripts/repair-apps-script-fingerprint.mjs');
  const previous = 'a'.repeat(40), expected = 'b'.repeat(40);
  const source = `const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = '${previous}';\n`
    + 'function getAppsScriptDeploymentHealth_() { return {ok: true}; }\n'
    + 'function deployedOnlyRoute_() { return "preserved"; }\n';
  const webFiles = [{name:'Code',type:'SERVER_JS',source},
    {name:'appsscript',type:'JSON',source:'{"timeZone":"America/Chicago"}'}];
  const localSource = source.replace(previous,'__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__');
  const repaired = prepareFingerprintRepair({webFiles,localSource,expectedCommit:expected});
  assert.equal(repaired.files[0].source,source.replace(previous,expected));
  assert.match(repaired.files[0].source,/deployedOnlyRoute_/);
  assert.throws(() => prepareFingerprintRepair({webFiles,
    localSource:localSource.replace('ok: true','ok: false'),expectedCommit:expected}),/RUNTIME_CHANGED/);
});
test('Invariant 546 (isolated Drive geometry loads every extracted pinned-layout owner)', () => invariant546({ read }));
test('Invariant 547 (partial inventory previews always recover the complete catalog and assignments)', async () => {
  const { invariant547 } = await import('../src/core/golden-inventory-hydration-recovery.mjs');
  await invariant547({ read });
});
test('Invariant 548 (complete inventory cannot be downgraded by a bounded preview)', () => invariant548({ read }));
test('Invariant 549 (physical-row hydration always supplies the canonical photo parser)', () => invariant549({ read }));
test('Invariant 550 (progressive preview IDs are drawn only from active hydration adapters)', () => invariant550({ read }));
test('Invariant 551 (canonical full inventory retains every physical hydrated row)', () => invariant551({ read }));
test('Invariant 552 (Drive Common Name batching is modular and coordinator-lifecycle safe)', () => invariant552({ read }));
test('Invariant 553 (staged refresh completion tolerates an uncreated coordinator)', () => invariant553({ read }));
test('Invariant 554 (card aggregates use complete physical rows without mutating canonical inventory)', () => invariant554({ read }));
test('Invariant 555 (Reclass move explanations cross the strict browser transport boundary)', () => invariant555({ read }));
test('Invariant 556 (release hydration timing profiles run without cross-browser contention)', () => invariant556({ read }));
test('Invariant 557 (bounded workflow pages cannot stop on an interaction-paced partial batch)', invariant557);
test('Invariant 558 (fresh bounded pages cannot repeat retained-DOM audits)', invariant558);
test('Invariant 559 (published hydration rejoins superseded cycles before exact settings evidence)', invariant559);
test('Invariant 560 (Suspend page staging stays modular with a bounded runtime adapter)', () => invariant560({ read }));
test('Invariant 561 (extracted classic owners remain callable across the runtime seam)', () => invariant561({ read }));
test('Invariant 562 (version sync preserves canonical symbol-index formatting)', () => invariant562({ read }));
import { invariant563, invariant570, invariant572 } from '../src/core/golden-history-delta-archive.mjs';
import { invariant565, invariant569, invariant571 } from '../src/services/golden-request-photo-archive.mjs';
import { invariant566, invariant568 } from '../src/services/golden-apps-script-rollback.mjs';
import { invariant567 } from '../src/core/golden-history-reader-routes.mjs';
test('Invariant 563 (consecutive history retains reversions, coverage and the canonical Request hierarchy)', invariant563);
import { assertPhasebRuntimeExtraction } from './helpers/phaseb-runtime-extraction-contract.mjs';
test('Invariant 564: extracted canonical evidence and publication branches retain exact receipts and account scope', assertPhasebRuntimeExtraction);
test('Invariant 565: signed Request archive paths retain verified receipts across replay and later associations', invariant565);
test('Invariant 566: scoped Apps Script rollback restores the captured deployment only while its candidate is active', invariant566);
test('Invariant 567: direct Smart Hold history retains logical observations after delta compaction', () => invariant567({ read }));
test('Invariant 568: scoped Apps Script switching follows verified HEAD restoration and recovers incomplete publication', invariant568);
test('Invariant 569: deleted Request photos recover from verified Drive receipts before source cleanup', invariant569);
test('Invariant 570: compacted observations own immutable state and require exact complete-file receipts', () => invariant570({ read }));
test('Invariant 571: Request photo recovery proves identity and routes cross-bucket leaves safely', invariant571);
test('Invariant 572: Request archive search retains the historical folder and canonical path', () => invariant572({ read }));
import { invariant548, invariant549, invariant550, invariant551, invariant552 } from '../src/core/golden-complete-inventory-preview-guard.mjs';
import { invariant546, invariant553, invariant554, invariant555, invariant573, invariant574, invariant575, invariant576, invariant577, invariant578, invariant579, invariant580, invariant581, invariant582, invariant583, invariant584, invariant585, invariant586, invariant587, invariant588, invariant589, invariant590 } from '../src/services/golden-release-recovery.mjs';
test('Invariant 573: generated bundle exemption requires exact canonical build parity', invariant573);
test('Invariant 574: app-api history routing loads from the isolated Edge functions tree', () => invariant574({ read }));
test('Invariant 575: AURA inventory scope follows explicit season and year', invariant575);
test('Invariant 576: backend recovery retains unpublished Apps Script work', invariant576);
test('Invariant 577: historical Suspend fixture uses its exact command version', invariant577);
test('Invariant 578: historical Request replay supplies evidence only in the disposable timeline', invariant578);
test('Invariant 579: bulk photo evidence uses the existing exact item and location index', () => invariant579({ read }));
test('Invariant 580: generated database type parts preserve the full native schema within their line limits', invariant580);
test('Invariant 581: bulk override lint derives the stage and map before the exact work table', invariant581);
test('Invariant 582: sandbox native type parts retain the pending Request write contract and legacy read alias', invariant582);
test('Invariant 583: Suspend fixture times its one receipt-producing RPC on the database clock', invariant583);
test('Invariant 584: owner concurrency verifies optimistic and last-write-wins receipts against their installed timelines', invariant584);
test('Invariant 585: staged publication protects exact-row edits and proves only unresolved splits', () => invariant585({ read }));
test('Invariant 586: historical login replays the rate limit and AURA tests exercise native role claims', () => invariant586({ read }));
test('Invariant 587: Edge response fixtures preserve versioned retained receipts', invariant587);
test('Invariant 588: native revision CI proves pinned file receipts and unpinned zero-delta recovery', () => invariant588({ read }));
test('Invariant 589: import close rejects equal-count worklist drift and active orphan assignments', () => invariant589({ read }));
test('Invariant 590: the installed archive contract proves the current authorization and legacy handoff', () => invariant590({ read }));
import { invariant591 } from '../src/core/golden-reclass-durable-outbox.mjs';
test('Invariant 591: Reclass survives reload and retries the same saved command for the original account', invariant591);
import { invariant592 } from '../src/core/golden-erp-run-isolation.mjs';
test('Invariant 592: a fresh ERP run passes staged Drive and ignores a superseded response', invariant592);
import { assertSuspendExactOwnerReceipt } from '../src/core/golden-soc-suspend-routing.mjs';
test('Invariant 593: Suspend resolves exact Assigned Items ownership and clears immediately', assertSuspendExactOwnerReceipt);
import { invariant594, invariant595, invariant596, invariant597 } from '../src/core/golden-suspend-and-excel-release.mjs';
test('Invariant 594: only the original canceled order stays visible on the exact Dock and Drop', invariant594);
test('Invariant 595: False Block uses verified item metrics and has zero location totals', invariant595);
test('Invariant 596: header export uses the full filtered result and rejects another account', invariant596);
test('Invariant 597: selected-season views retain the season and all-season photos bypass it', invariant597);
test('Invariant 598: update navigation rejects stale network HTML and uses the installed target shell', staleUpdateNavigation);
test('Invariant 599: sealed Drive publication keeps its exact count and receipt through backoff', sealedPublicationContract);
import { loginBloomContinuity } from '../src/core/golden-login-bloom-continuity.mjs';
test('Invariant 600: saved sign-in, reserved Request selection and Bloom links work before network refresh', () => loginBloomContinuity({ read }));
import { invariant601 } from '../src/core/golden-erp-scan-recovery.mjs';
import { erpScanFixtureDependencies } from '../src/core/golden-runtime-fixture.mjs';
test('Invariant 601: timed-out Drive scans reclaim the saved run without advancing its checkpoint', invariant601);
import { assertDetachedDriveEvaluation } from './helpers/drive-photo-mark-done-contract.mjs';
test('Invariant 602: Drive completion saves exact-row evaluation while its photos upload independently', assertDetachedDriveEvaluation);
import { assertOperationalColdDisplay, assertOperationalColdDisplayFences } from './helpers/operational-cold-display-contract.mjs';
test('Invariant 603: verified operational snapshots display during live reads and reject stale owners', async () => {
  await assertOperationalColdDisplay();
  await assertOperationalColdDisplayFences();
});
import { assertForcedPwaRecovery } from './helpers/forced-pwa-recovery-contract.mjs';
test('Invariant 604: explicit updates and logout release stale work locks and upgrade legacy clients', assertForcedPwaRecovery);
import { assertBoundedErpFinalReceipt } from './helpers/erp-final-receipt-contract.mjs';
test('Invariant 605: exhausted ERP publication retains its exact stage and only a commit receipt releases the file', assertBoundedErpFinalReceipt);
import { assertDemandOnlyPoManagement } from './helpers/po-management-demand-contract.mjs';
test('Invariant 606: background shell hydration never downloads joined PO report rows', assertDemandOnlyPoManagement);
test('Invariant 607: worker installation deduplicates and bounds downloads before activation', boundedShellInstallation);
import { assertCanonicalEvaluationProjection } from './helpers/canonical-evaluation-projection-contract.mjs';
test('Invariant 608: evaluation projects exact-row evidence before persistence and rolls back only its own fields', assertCanonicalEvaluationProjection);
import { verifyAvCompactFilterContract } from './helpers/av-compact-filter-contract.mjs';
test('Invariant 609: AV column headers open account-scoped facets synchronously without changing other views', verifyAvCompactFilterContract);
import { assertErpMigrationInstalledReadback, assertRequestAutosaveMigrationInstalledReadback } from './helpers/erp-migration-installed-contract.mjs';
test('Invariant 610: scoped ERP migration receipts require verified installed definitions', assertErpMigrationInstalledReadback);
test('Invariant 611: Request autosave repair refuses an unverified installed lifecycle contract', assertRequestAutosaveMigrationInstalledReadback);
import { assertCropRollRetiredFromLiveApp } from './helpers/crop-roll-retirement-contract.mjs';
test('Invariant 612: retired Crop Roll routes and source reads stay unavailable while Office resumes Move Up', assertCropRollRetiredFromLiveApp);
import { assertErpOrderHandoverNullGuard } from './helpers/erp-order-handover-guard-contract.mjs';
test('Invariant 613: blank ERP assignments bypass handover while each explicit assignment lane remains eligible', assertErpOrderHandoverNullGuard);
import { assertOrderHistoryWholeRowProjection } from './helpers/erp-order-history-row-contract.mjs';
test('Invariant 614: RESERVES and SOC history retain the whole row when Source is null or populated', assertOrderHistoryWholeRowProjection);
import { assertDeferredCardPhotoQueue } from './helpers/deferred-card-photo-queue-contract.mjs';
test('Invariant 615: bounded eager batches keep visible AV photos and unrelated renders cannot steal their timer', assertDeferredCardPhotoQueue);
import { assertAfternoonErpSources, assertManualErpRestart, assertManualErpMetadata, assertPreparedIsNotPublished } from './helpers/erp-manual-sync-contract.mjs';
test('Invariant 616: manual ERP restart preserves healthy checkpoints and refreshes authoritative Home metadata', async () => {
  await assertManualErpRestart();
  await assertManualErpMetadata();
  await assertPreparedIsNotPublished();
});

import { assertRequestRowIsolation } from './helpers/request-row-isolation-contract.mjs';
test('Invariant 617: physical UID and full lot identity isolate Green Giant evidence and retain qualified aliases',assertRequestRowIsolation);

import { assertRequestCompletionBatch } from './helpers/request-completion-batch-contract.mjs';
test('Invariant 618: completion delivery rejects partial folders and renders all rows from the durable receipt',assertRequestCompletionBatch);

import { assertDetailKeyboardVisibility } from './helpers/detail-keyboard-visibility-contract.mjs';
test('Invariant 619: Request summary stays compact and the real focused field remains above its keypad',assertDetailKeyboardVisibility);
import { assertPortableRollup } from '../src/core/portable-rollup-contract.mjs';
test('Invariant 620: the release bundler generates output with every native addon load rejected',assertPortableRollup);
import { assertAssignedExportSnapshot } from './helpers/assigned-export-contract.mjs';
test('Invariant 621: Assigned Items exports every filtered row and eight exact columns from memory while warehouse pages are pending',assertAssignedExportSnapshot);
import { assertCompactRequestHeader, assertDirectRequestSummaryReplacement } from './helpers/request-detail-compact-contract.mjs';
test('Invariant 622: Request and Suspend keep ordered compact identity and read-only Reserve without redundant banners',assertCompactRequestHeader);
import {assertSuspendGoldenRouting,assertSuspendPhotoAccountProof} from './helpers/suspend-assigned-routing-contract.mjs';
test('Invariant 623: SUSPEND follows exact Assigned Items ownership, admin scope and current ERP membership',assertSuspendGoldenRouting);
import {assertQueHeaderContract} from './helpers/que-header-contract.mjs';
test('Invariant 624: Que retains expanded header commands and normalized exact owners without ambiguous grants',assertQueHeaderContract);
import {assertSnapshotFilenameEvidence, assertCheckedRunTime} from '../src/core/golden-erp-run-receipts.mjs';
test('Invariant 625: a completed manual check advances Home using the exact server receipt', assertCheckedRunTime);
import {assertPublicationDeadline} from './helpers/erp-publication-deadline-contract.mjs';
test('Invariant 626: staged ERP publication yields within its RPC deadline and reaches 100 only on a durable receipt',assertPublicationDeadline);
test('Invariant 627: normalized exact Assigned Items owners precede stale projections and base-prefix aliases',assertQueHeaderContract);

import {assertWatchdogRpcRecovery,assertWatchdogReadContinuity} from './helpers/watchdog-recovery-contract.mjs';
test('Invariant 628: RPC lock and server failures recover through bounded identical-command retries without unsafe replay',assertWatchdogRpcRecovery);
test('Invariant 629: Request refresh retains same-account rows, Home defers Suspend boot reads and chat rejects empty filters',assertWatchdogReadContinuity);

import {assertWatchdogTransportRecovery} from './helpers/watchdog-transport-contract.mjs';
test('Invariant 630: native AV retry retains its batch identity and app-api reads recover HTTP 500 without terminal telemetry',assertWatchdogTransportRecovery);

import {bannerUpdateContract} from './helpers/banner-update-contract.mjs';
test('Invariant 631: only a real update banner tap with a current idle checkpoint can navigate an editing tab',bannerUpdateContract);

import {verifyColdProfileIsolation,verifyLateReadIsDiscarded} from './helpers/cold-access-retry-contract.mjs';
test('Invariant 632: a cold alias sees full navigation only for its verified current profile',verifyColdProfileIsolation);
test('Invariant 633: a successful operational read from a previous account cannot settle the new session',verifyLateReadIsDiscarded);

test('Invariant 634: exact-row drafts publish before photo completion and survive failed uploads and blank Request refreshes',assertDetailLiveDraftRetention);
test('Invariant 635: photo, evaluation and completion entrypoints require verified table grants and exact ownership without named-user exceptions',assertTableDrivenRowAuthorization);
test('Invariant 636: a populated Que dropdown passes Watchdog and review reads preserve open incidents under the same native session',reviewedQueueWatchdogContract);
test('Invariant 637: Season Y moves bind preview and receipt to the physical source sales year', async () => (await import('./helpers/reclass-season-y-receipt.mjs')).reclassSeasonYReceiptContract());
import {assertErpPublicationRecovery} from './helpers/erp-publication-recovery-contract.mjs';
test('Invariant 638: unchanged ERP publication resumes its exact saved stage once after ninety seconds and requires a durable receipt', assertErpPublicationRecovery);
import {assertErpPublicationCheckpoint} from './helpers/erp-publication-checkpoint-contract.mjs';
test('Invariant 639: sealed ERP publication drops parser-only state while parsing and durable receipt identity remain intact', assertErpPublicationCheckpoint);
import {assertErpTypedPreparationProgress} from './helpers/erp-typed-progress-contract.mjs';
test('Invariant 640: bounded typed ERP preparation advances its durable stall clock without publishing or archiving before a receipt', assertErpTypedPreparationProgress);
test('Invariant 641: operational ERP completion requires DRIVE, CAV, RESERVES, SOC and HL PO', async () => (await import('./helpers/erp-cron-release-contract.mjs')).assertErpStageSequence());
test('Invariant 642: 250-row DRIVE preparation and its sealed digest require a later matching publication receipt', async () =>
  (await import('./helpers/erp-incremental-drive-preparation.mjs')).assertIncrementalDrivePublication());
test('Invariant 643: bounded compiled DRIVE progress preserves the same fully typed stage without premature recovery', async () =>
  (await import('./helpers/erp-compiled-drive-work.mjs')).assertCompiledDrivePublicationClock());
test('Invariant 644: the release gate accepts removal of planner maintenance and rejects changes to compiled DRIVE readiness witnesses', async () =>
  (await import('./helpers/erp-readiness-maintenance-contract.mjs')).assertIndependentDriveReadiness());
test('Invariant 645: final certificate release rejects removal of input invalidation, stage locks, or either proof phase', async () =>
  (await import('./helpers/erp-certified-input-release.mjs')).assertCertifiedDriveRelease());
test('Invariant 646: a prior DRIVE alias requires unique matching lineage and retains staged exact-row ownership', async () =>
  (await import('./helpers/erp-prior-drive-alias-release.mjs')).assertPriorDriveAliasRelease());
test('Invariant 647: compiled DRIVE reconciliation retains zero deltas, current live evidence and exact raw caller fallback', async () =>
  (await import('./helpers/erp-compiled-order-delta-release.mjs')).assertCompiledOrderDeltaRelease());
test('Invariant 648: six field photos transfer in order with bounded retries and verified preview fallback', async () =>
  (await import('./helpers/ordered-detail-photo-contract.mjs')).assertOrderedDetailPhotoUploads());
test('Invariant 649: Request completion transports exact queued photo IDs and reports a missing registration receipt', async () =>
  (await import('./helpers/request-photo-intent-contract.mjs')).assertRequestPhotoIntentContract());

test('Invariant 650: warm AV uses the active account and a final Suspend receipt clears only its exact order', async () => {
  const {assertWarmAvAndFinalSuspendReceipt} = await import('../src/core/warm-av-suspend-receipt-fixture.mjs');
  assertWarmAvAndFinalSuspendReceipt();
});
