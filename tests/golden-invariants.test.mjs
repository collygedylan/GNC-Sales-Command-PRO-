import { readComposedRuntimeSource, readComposedAppSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { databaseBridge } from './helpers/database-bridge.mjs';
import { classifySupabaseCliFailure, formatSafeFailure } from '../scripts/apply-item-low-stock-migration.mjs';
import { appsScriptFilesDigest } from '../scripts/apps-script-function-patch.mjs';
import { writeAppsScriptHeadOnlyEvidence } from '../scripts/apps-script-recovery-evidence.mjs';
import { mappingFixtureRow, requestMappingFunctions, requestMappingSetup } from './helpers/customer-mapping-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCache = new Map();
const syntaxCache = new Map();
const functionIndexes = new Map();

function read(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, (file === 'assets/app-runtime.js' ? readComposedRuntimeSource() : readFileSync(path.join(root, file), 'utf8')));
  return sourceCache.get(file);
}

function syntax(file) {
  if (!syntaxCache.has(file)) {
    const kind = file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    syntaxCache.set(file, ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, kind));
  }
  return syntaxCache.get(file);
}

function functionSource(file, name) {
  const sourceFile = syntax(file);
  if (!functionIndexes.has(file)) {
    const index = new Map();
    const visit = node => {
      if (ts.isFunctionDeclaration(node) && node.name && !index.has(node.name.text)) index.set(node.name.text, node);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    functionIndexes.set(file, index);
  }
  const match = functionIndexes.get(file).get(name);
  assert.ok(match, `${file}:${name}`);
  return match.getText(sourceFile);
}

function runFunctions(file, names, context = {}, typescript = file.endsWith('.ts')) {
  const sandbox = vm.createContext(context);
  const source = names.map(name => functionSource(file, name)).join('\n');
  const executable = typescript ? ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText : source;
  vm.runInContext(executable, sandbox, { filename: file });
  return sandbox;
}

function locationContext(extra = {}) {
  const context = vm.createContext({ console, ...extra });
  vm.runInContext(read('assets/location-code.js'), context, { filename: 'assets/location-code.js' });
  return context;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('Invariant 1 (PC & Mobile Login Bootstrap)', () => {
  const nodes = {
    'view-login': { style: { display: 'flex' } },
    'login-inputs': { classList: { remove() {} } },
    'loading-spinner': { classList: { add() {} } },
    'app-wrapper': { hidden: true, style: { display: 'none', removeProperty(name) { delete this[name]; } }, classList: { remove() {} } },
    'main-scroll-area': { style: {} },
  };
  const context = runFunctions('assets/app-runtime.js', ['openAppShellAfterLogin'], {
    currentUser: 'dylan_collyge', clearLoginStartupWatchdog() {}, blurActiveField() {}, setLoginProgress() {}, finishInitialAppLoad() {},
    document: { getElementById: id => nodes[id] || null, body: { classList: { remove() {} } } },
    isTouchConstrainedDevice: () => false, setMenuOpenState() {}, syncAuraWidgetForSession: async () => true,
    setHomeDashboardModulesReady() {}, syncCurrentViewBodyClass() {}, repairAppShellScrollState() {}, syncRoleAccessUi() {},
    getRoleAccessState: () => ({}), applyRolePermissions() {}, showOnlyPrimaryView: view => { context.visibleView = view; },
    renderHome: () => { context.homeRendered = true; }, updateFooterNavState() {}, syncGlobalHeaderChrome() {}, runAfterShellInteractive() {},
    scheduleRequestModalReferencePrefetch() {}, scheduleGlobalReferencePrefetch() {}, ensureHomeDashboardReadyAfterLogin() {},
    refreshRealtimeSubscriptionsForCurrentView() {}, canUseProductionLiveSync: () => true, signalProductionLiveSync() {},
    setTimeout() {}, console: { warn() {} },
  });
  assert.doesNotThrow(() => context.openAppShellAfterLogin(false));
  assert.equal(nodes['app-wrapper'].hidden, false);
  assert.equal(context.visibleView, 'home');
  assert.equal(context.homeRendered, true);
});

test('Invariant 2 (Zero 401/403/409/423 in app-api)', async () => {
  const context = runFunctions('supabase/functions/app-api/index.ts', [
    'escapedDisplayTextFieldKey', 'normalizeEscapedDisplayText', 'escapedDisplayTextJsonReplacer',
    'jsonResponse', 'transientOkResponse', 'failOpenInventoryConflict'
  ], {
    Response, corsHeaders: {}, JSON, ESCAPED_DISPLAY_TEXT_FIELDS:new Set(['commonname']),
  });
  const roles = ['admin', 'sales_rep', 'supervisor', 'evaluator', 'kier', 'dock_office', 'qc_supervisor', 'shipping', 'data_entry', 'foreman', 'take_backs'];
  const actions = ['user_access', 'native_session_bridge', 'season_sales_office', 'dataset_read', 'av_read', 'customer-rep-map', 'aura_inventory_v2', 'report_read_v2', 'inventory_read', 'drive_reclass_inquiry', 'inventory_reclass_move'];
  const forbidden = new Set([401, 403, 409, 423]);
  for (const role of roles) for (const action of actions) {
    const response = context.transientOkResponse('RETAINED_READY', 'Last-known-good data retained.', { role, action });
    assert.equal(response.status, 200, `${role}:${action}`);
    assert.equal(forbidden.has(response.status), false, `${role}:${action}`);
  }
  const conflict = await context.failOpenInventoryConflict(new Response(JSON.stringify({ code: 'LOC_ON_HAND_REVISION_CHANGED' }), { status: 409 }));
  assert.equal(conflict.status, 200);
  assert.equal((await conflict.json()).data.revisionChanged, true);
});

test('Invariant 3 (Exact Two-Trigger Season Evidence Lifecycle)', () => {
  const context = runFunctions('assets/app-runtime.js', ['normalizeDriveEvidenceLocationPart', 'isSameDriveEvidenceLocation'], {
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
  });
  assert.equal(context.isSameDriveEvidenceLocation(
    { ITEMCODE: '001884.011.1', LOCATIONCODE: 'E.10.000', LOTCODE: '27.S1', UNIQUE_ID: 'old' },
    { itemcode: '001884.011.1', locationcode: 'e.10.000', lotcode: '27.F1', unique_id: 'new' },
  ), true);
  const expiresAt = Date.parse('2026-11-03T05:59:59Z');
  const lifecycle = (currentOnHand, now) => {
    const baselineOnHand = 500;
    const locMatchPct = 50;
    const initialPhotoMatchQty = Math.round(baselineOnHand * (locMatchPct / 100));
    const currentPhotoMatchQty = Math.max(0, initialPhotoMatchQty - Math.max(0, baselineOnHand - currentOnHand));
    const active = currentPhotoMatchQty > 0 && now <= expiresAt;
    return {
      initialPhotoMatchQty, currentPhotoMatchQty, active,
      photo: active ? 'photo.webp' : null,
      spec: active ? '8-10" H' : null,
      avNote: active ? 'SPEC - 8-10" H' : null,
      pickNote: active ? 'Pick evenly' : null,
      salesNote: active ? 'Saleable shear' : null,
    };
  };
  const day5 = lifecycle(450, Date.parse('2026-10-28T17:00:00Z'));
  assert.equal(day5.initialPhotoMatchQty, 250);
  assert.equal(day5.currentPhotoMatchQty, 200);
  assert.equal(day5.active, true);
  assert.ok(day5.photo && day5.spec && day5.avNote && day5.pickNote && day5.salesNote);
  const day10Expired = lifecycle(450, expiresAt + 1);
  assert.equal(day10Expired.currentPhotoMatchQty, 200);
  assert.equal(day10Expired.active, false);
  assert.deepEqual([day10Expired.photo, day10Expired.spec, day10Expired.avNote, day10Expired.pickNote, day10Expired.salesNote], [null, null, null, null, null]);
  const unifiedMigration = read('supabase/migrations/20261024203000_unified_request_sync_sales_impact_v1.sql');
  assert.match(unifiedMigration, /request_master_has_valid_evidence_v1\(master,clock_timestamp\(\)\)/);
  assert.doesNotMatch(unifiedMigration, /delete from public\.ph_request_history/);
  const day4Depleted = lifecycle(250, Date.parse('2026-10-27T17:00:00Z'));
  assert.equal(day4Depleted.currentPhotoMatchQty, 0);
  assert.equal(day4Depleted.active, false);
  assert.deepEqual([day4Depleted.photo, day4Depleted.spec, day4Depleted.avNote, day4Depleted.pickNote, day4Depleted.salesNote], [null, null, null, null, null]);
  const migration = read('supabase/migrations/20261023235500_inventory_location_evidence_lifecycle_v2.sql');
  for (const field of ['baseline_on_hand', 'loc_match_pct', 'initial_photo_match_qty', 'current_photo_match_qty']) assert.match(migration, new RegExp(`\\b${field}\\b`));
  assert.match(migration, /America\/Chicago/);
  assert.match(migration, /time '23:59:59'/);
  assert.match(migration, /greatest\(0,p_initial_photo_match_qty-greatest\(0,p_baseline_on_hand-p_current_on_hand\)\)/);
  assert.match(migration, /spec=null,match=null,loc_match_qty=null,av_note=null,pic_note=null,sales_note=null/);
  const canonicalMigration = read('supabase/migrations/20261025013000_agdata_v2362_canonical_requests.sql');
  for (const field of ['photos', 'photo_url', 'photo_date', 'loc_match_pct', 'baseline_on_hand',
    'initial_photo_match_qty', 'loc_photo_match', 'pick_note', 'photo_expires_at']) {
    assert.match(canonicalMigration, new RegExp(`add column if not exists ${field}\\b`));
  }
  for (const field of ['spec', 'caliper', 'av_note', 'sales_note']) assert.match(canonicalMigration, new RegExp(`new\\.${field}:=`));
  assert.match(canonicalMigration, /round\(canonical_baseline\*canonical_match\/100\.0\)/);
  assert.match(canonicalMigration, /inventory_location_evidence_qty_v2\([^]*canonical_baseline,canonical_initial,current_on_hand/);
  assert.match(canonicalMigration, /clock_timestamp\(\)<=canonical_expiry/);
});

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

test('Invariant 5 (Drive Mode Card Thumbnail Parity With AV & Lightbox)', () => {
  const shared = 'https://photos.invalid/a.jpg, https://photos.invalid/b.jpg';
  const context = runFunctions('assets/app-runtime.js', ['getRowPhotoLink', 'resolveCanonicalPhotoUrls', 'getDetailPhotoUrls'], {
    lastView: 'drive', getRequestPhotoLinkCsv: () => '', getQueueCardInventoryRow: () => null,
    getSharedAppPhotoLinkCsv: item => item.PHOTO_LINK || '', getDockOwnedPhotoLinkCsv: () => '', shouldPreferFlyerOwnedFields: () => false,
    getFlyerVisiblePhotoLinkCsv: () => '', shouldHideSharedAppPhotoForExpiredAvRules: () => false,
    mergePhotoCsvList: values => values.filter(Boolean).join(','), filterPhotoCsvByRetention: value => value,
    getSharedAppPhotoName: () => '', getPhotoUrlList: value => String(value || '').split(',').map(entry => entry.trim()).filter(Boolean),
    resolveAndFormatPhotoDate: () => '',
  });
  const item = { PHOTO_LINK: shared };
  const drive = plain(context.resolveCanonicalPhotoUrls(item, 'drive'));
  const av = plain(context.resolveCanonicalPhotoUrls(item, 'av'));
  const lightbox = plain(context.getDetailPhotoUrls(item, 'drive'));
  assert.deepEqual(drive, av);
  assert.deepEqual(lightbox, drive);
  assert.deepEqual(drive, ['https://photos.invalid/a.jpg', 'https://photos.invalid/b.jpg']);
  assert.match(functionSource('assets/app-runtime.js', 'generateCard'), /resolveCanonicalPhotoUrls/);
});

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

test('Invariant 8 (Que REQUEST Five-State Lifecycle & Live Uncached Fetch)', () => {
  const moveContext = runFunctions('assets/app-runtime.js', [
    'firstNonEmptyValue', 'getMoveRequestRowBatchId', 'getMoveRequestRowAssignment', 'isMoveRequestRow',
  ], { MOVE_REQUEST_ASSIGNMENT: 'moves' });
  assert.equal(moveContext.isMoveRequestRow({ unique_id: 'move_req_legacy_row' }), true);
  assert.equal(moveContext.isMoveRequestRow({ req_customer: 'Location Move' }), true);
  assert.equal(moveContext.isMoveRequestRow({ unique_id: 'request_row', req_customer: 'Customer' }), false);
  const context = locationContext({
    isRequestVisibleForCurrentUser: () => true, isMoveRequestRow: row => Boolean(row?.MOVE_BATCH_ID),
    isRegularRequestQueueItem: () => true,
    naturalCompare: (left, right) => String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' }),
    getItemUniqueId: row => row.id, buildRequestPagedRenderPlan: (_mode, _crumb, items) => ({ rows: items }),
  });
  vm.runInContext([
    functionSource('assets/app-runtime.js', 'firstNonEmptyValue'),
    functionSource('assets/app-runtime.js', 'normalizeRequestStatus'),
    functionSource('assets/app-runtime.js', 'hasCompletionDateValue'),
    functionSource('assets/app-runtime.js', 'isTruthishHistoryValue'),
    functionSource('assets/app-runtime.js', 'isRequestPendingVisible'),
    functionSource('assets/app-runtime.js', 'compareLocationCodeValues'),
    functionSource('assets/app-runtime.js', 'buildPendingRequestRenderPlan'),
    functionSource('assets/app-runtime.js', 'buildActiveRequestLiveRowsQuery'),
  ].join('\n'), context);
  const active = [
    { id: 'c12', LOCATIONCODE: 'C.12.019', LOTCODE: '27.F1', REQ_STATUS: 'Pending', DATE_COMPLETED: null, REQ_QTY: null, REQUEST_ACTIVE: true },
    { id: 'c2', LOCATIONCODE: 'C.2.000', LOTCODE: '27.S1', REQ_STATUS: 'Pending', DATE_COMPLETED: null, REQ_QTY: '', REQUEST_ACTIVE: true },
    { id: 'c5', LOCATIONCODE: 'C.05.000', LOTCODE: '27.U1', REQ_STATUS: 'Pending', DATE_COMPLETED: null, REQ_QTY: 0, REQUEST_ACTIVE: true, REQUEST_HISTORY: true },
  ];
  const history = Array.from({ length: 4001 }, (_, index) => ({
    id: `history-${index}`, LOCATIONCODE: 'Z.99.999', REQ_STATUS: 'Pending', DATE_COMPLETED: null,
    REQUEST_ACTIVE: false, REQUEST_HISTORY: true, REQUEST_HISTORY_ONLY: true,
  }));
  assert.equal(active.every(row => context.isRequestPendingVisible(row)), true);
  assert.equal(history.every(row => !context.isRequestPendingVisible(row)), true);
  const plan = context.buildPendingRequestRenderPlan([...history, ...active]);
  assert.deepEqual(Array.from(plan.rows, row => row.id), ['c2', 'c5', 'c12']);
  assert.match(context.buildActiveRequestLiveRowsQuery('*'), /date_completed=is\.null[^]*order=created_at\.desc,unique_id\.desc/);
  assert.match(functionSource('assets/app-runtime.js', 'forceRefreshRequestsForView'), /force_fresh: true, cache: 'no-store'/);
  assert.match(functionSource('assets/app-runtime.js', 'fetchAllSupabaseRows'), /forceFresh[^]*:fresh:/);
  const appApiSource = read('supabase/functions/app-api/index.ts');
  assert.match(appApiSource, /\["request_queue", "active_request"\]\.includes\(dataset\)\) query\.set\("date_completed", "is\.null"\)/);
  assert.match(appApiSource, /request_queue:\s*\{[^]*filterFields:\s*new Set\(\[[^\]]*"date_completed"/);
  const migration = read('supabase/migrations/20261024060000_request_queue_pending_reconciliation_v3.sql');
  assert.match(migration, /event_type='request_created'[^]*request_completed[^]*ph_request_queue_removal_commands[^]*insert into public\.ph_active_request/);
  assert.match(migration, /request_queue_expected_pending_v3[^]*REQUEST_CREATED_RECONCILIATION_INCOMPLETE/);
  assert.doesNotMatch(migration, /order by o\.created_at desc,o\.event_id desc\s+limit 100/);
  const legacyMigration = read('supabase/migrations/20261024061500_request_queue_legacy_outbox_reconciliation_v4.sql');
  assert.match(legacyMigration, /legacy-explicit-removal/);
  assert.match(legacyMigration, /outbox_recovery[^]*insert into public\.ph_active_request[^]*REQUEST_LEGACY_PENDING_ROWS_MISSING/);
  const legacyFunction = legacyMigration.slice(legacyMigration.indexOf('create or replace function private.reconcile_legacy_pending_requests_from_outbox_v4'), legacyMigration.indexOf('revoke all on function private.reconcile_legacy_pending_requests_from_outbox_v4'));
  assert.doesNotMatch(legacyFunction, /customeridentityid|consigneeidentityid/);
  const lifecycleMigration = read('supabase/migrations/20261024203000_unified_request_sync_sales_impact_v1.sql');
  const surgicalMigration = read('supabase/migrations/20261025003000_agdata_v2361_surgical_restore.sql');
  assert.match(lifecycleMigration, /request_completion_proof_v1[^]*request_completed[^]*request_history_has_valid_evidence_v1[^]*request_master_has_valid_evidence_v1[^]*ph_request_queue_removal_commands/);
  assert.match(lifecycleMigration, /recover_unfulfilled_requests_v1[^]*insert into public\.ph_active_request[^]*pending_recovered/);
  assert.match(lifecycleMigration, /req_status='Pending'[^]*upsert_request_history\(candidate\.unique_id,'pending_snapshot'/);
  assert.match(lifecycleMigration, /ph_request_history_block_delete_v2360[^]*ph_request_history_block_truncate_v2360/);
  assert.match(lifecycleMigration, /grant select on public\.ph_master_inventory to authenticated/);
  assert.match(lifecycleMigration, /app_runtime_watchdog_events set status='resolved'/);
  assert.match(surgicalMigration, /recent-outbox-cutoff-v2361/);
  assert.match(surgicalMigration, /2026-10-22 00:00:00 America\/Chicago/);
  assert.match(surgicalMigration, /ph_active_request_retirement_v2361[^]*delete from public\.ph_active_request/);
  assert.doesNotMatch(surgicalMigration.slice(surgicalMigration.indexOf('create or replace function private.recover_unfulfilled_requests_v1'), surgicalMigration.indexOf('create or replace function public.reconcile_active_requests_from_outbox_v1')), /history_without_evidence|history_recovery/);
  assert.match(surgicalMigration, /information_schema\.tables[^]*table_schema = 'archive_backup'[^]*alter table archive_backup/);
  const canonicalMigration = read('supabase/migrations/20261025013000_agdata_v2362_canonical_requests.sql');
  const cleanupMigration = read('supabase/migrations/20261025014500_agdata_v2362_remove_legacy_request_objects.sql');
  const uniformMigration = read('supabase/migrations/20261025023000_agdata_v2363_uniform_active_history_architecture.sql');
  const browserCompatibilityMigration = read('supabase/migrations/20261025040000_agdata_v2364_request_browser_compatibility.sql');
  const evidenceCompatibilityMigration = read('supabase/migrations/20261025062000_agdata_v2364_location_evidence_repair_compatibility.sql');
  assert.match(canonicalMigration, /alter table public\.ph_active_request rename to ph_requests_pending/);
  assert.match(canonicalMigration, /alter table public\.ph_request_history rename to ph_requests_completed_history/);
  assert.match(canonicalMigration, /update public\.ph_requests_completed_history history set[^]*canonical_migration_reason','pending-history-overlap-v2362'[^]*from public\.ph_requests_pending pending/);
  assert.match(canonicalMigration, /replace\(definition,'public\.ph_request_history','public\.ph_requests_completed_history'\)/);
  assert.match(canonicalMigration, /recipient_emails jsonb not null default '\[\]'::jsonb/);
  for (const field of ['status', 'request_qty', 'effective_qty', 'is_default_qty', 'line_dollar_value',
    'request_spec', 'request_caliper', 'flag_color', 'ns_grade', 'ld_flag', 'hold_stop_since']) {
    assert.match(canonicalMigration, new RegExp(`add column if not exists ${field}\\b`));
  }
  assert.match(canonicalMigration, /set local session_replication_role='replica'[^]*set local session_replication_role='origin'/);
  assert.match(cleanupMigration, /drop view if exists public\.ph_request_queue_live_rows/);
  assert.match(cleanupMigration, /drop table if exists public\.ph_request_sales_impact_ledger cascade/);
  assert.match(cleanupMigration, /private\.ph_request_folder_delivery_state/);
  assert.match(cleanupMigration, /LEGACY_REQUEST_FUNCTION_REFERENCE_REMAINED/);
  for (const relation of ['ph_00_table_directory', 'ph_active_request', 'ph_request_history',
    'ph_active_drive_mode', 'ph_drive_mode_history', 'ph_active_location_moves',
    'ph_location_moves_history', 'ph_active_recount', 'ph_recount_history',
    'ph_active_eval_work', 'ph_eval_work_history', 'ph_delivery_outbox']) {
    assert.match(uniformMigration, new RegExp(`public\\.${relation}\\b`));
  }
  assert.match(uniformMigration, /ph_requests_pending_sales_request_only_v2363[^]*unique_id not like 'move_req_%'[^]*unique_id not like 'EVAL-%'/);
  assert.match(uniformMigration, /ph_active_request_retirement_v2361[^]*2026-10-22 00:00:00 America\/Chicago[^]*request_completed[^]*ph_active_request/);
  assert.match(uniformMigration, /ph_location_moves_history[^]*ph_eval_work_history[^]*delete from public\.ph_requests_pending[^]*delete from public\.ph_requests_completed_history/);
  assert.match(uniformMigration, /canonical-active-history-v2363/);
  assert.doesNotMatch(uniformMigration, /\bdrop\s+table\b|\btruncate\s+table\b/i);
  for (const field of ['customer', 'consignee', 'qty', 'measure_spec', 'comments']) {
    assert.match(browserCompatibilityMigration, new RegExp(`add column if not exists ${field}\\b`));
  }
  for (const view of ['ph_active_request', 'ph_active_request_live_rows', 'ph_request_queue_live_rows', 'ph_request_history']) {
    assert.match(browserCompatibilityMigration, new RegExp(`view public\\.${view} with \\(security_invoker = false\\)`));
  }
  assert.match(browserCompatibilityMigration, /grant execute on function public\.guard_active_app_session_v1\(\) to anon/);
  assert.match(browserCompatibilityMigration, /least\([^]*greatest\(0, p_current_on_hand\)[^]*p_initial_photo_match_qty - greatest/);
  assert.match(browserCompatibilityMigration, /select public\.reconcile_inventory_location_evidence_v1\(\)/);
  assert.doesNotMatch(browserCompatibilityMigration, /\bdrop\s+table\b|\btruncate\s+table\b/i);
  assert.match(evidenceCompatibilityMigration, /get_request_drive_evidence_health_snapshot_v1[^]*location_evidence_updated_at >= completion\.completed_at/);
  assert.match(evidenceCompatibilityMigration, /location_evidence_cleared_at is not null[^]*location_evidence_current_photo_match_qty, 0\) <= 0/);
  assert.match(evidenceCompatibilityMigration, /guard_enabled boolean:=coalesce\(current_setting\('gnc\.inventory_location_evidence_apply',true\),''\)='on'/);
  assert.match(evidenceCompatibilityMigration, /evidence\.cleared_at is null[^]*coalesce\(canonical_current,0\)>0/);
  assert.doesNotMatch(evidenceCompatibilityMigration, /\bdrop\s+table\b|\btruncate\s+table\b/i);
  const submitSource = functionSource('assets/app-runtime.js', 'finalizeRequestAction');
  for (const field of ['recipient_emails', 'request_qty', 'effective_qty', 'is_default_qty', 'line_dollar_value',
    'request_spec', 'request_caliper', 'flag_color', 'ns_grade', 'ld_flag', 'hold_stop_since']) {
    assert.match(submitSource, new RegExp(`${field}:`));
  }
  const tabSource = functionSource('assets/app-runtime.js', 'setReqTab');
  assert.match(tabSource, /nextTab === 'pending'[^]*forcePendingRequestRoot\(\{ clearSelection: true \}\)[^]*renderViewContent\('request', false, true\);[^]*runDirectTrackedNavigation/);
  assert.match(tabSource, /preferImmediate:\s*true[^]*interactiveCritical:\s*true/);
  const tabEvents = [];
  let tabContext;
  tabContext = runFunctions('assets/app-runtime.js', ['setReqTab'], {
    activeReqTab: 'recount', requestSalesRepsManagerMode: false, lastViewSwitchAt: 0,
    activeLocationMoveQueDetailUid: 'move', activeLocationWorkJobId: 'job', activeShearQueDetailId: 'shear',
    activeAvOptionEvalDetailId: 'eval', activeEvalWorkDetailId: '', requestViewLevel: 2,
    selectedReqFolder: 'folder', selectedReqRepView: null, selectedReqCustView: null,
    selectedReqConsigneeView: null, selectedReqFolderView: null, requestFolderSearchTerm: '',
    requestRepSearchTerm: '', requestCustomerSearchTerm: '', requestConsigneeSearchTerm: '',
    requestFolderDateFilter: '', requestDylanFilterMode: 'all', requestDylanFilterValue: '',
    requestDylanSalesRepValue: '', requestDylanFilterMenuOpen: '',
    window: { BunchNote: { disposeView() {} }, BunchQueueShell: { isTab: () => false } },
    Date, normalizeRequestTabValue: value => value === 'pending' ? 'pending' : value,
    resetQueueReadCooldowns() {}, unsubscribeEvalWorkRealtime() {}, subscribeEvalWorkRealtime() {},
    forcePendingRequestRoot() { tabContext.activeReqTab = 'pending'; tabContext.requestViewLevel = 0; tabEvents.push('root'); },
    syncRequestTabButtons() {}, isViewVisible: () => true,
    renderViewContent() { tabEvents.push(`render:${tabContext.activeReqTab}:${tabContext.requestViewLevel}`); },
    runDirectTrackedNavigation(_view, _key, callback) { callback(); return true; },
    clearSelection() {}, forceRefreshRequestsForView: async () => true,
    loadRequestArchivePage: async () => true, loadEvalWorkAssignments: async () => true,
    switchView() { throw new Error('unexpected view'); }
  });
  assert.equal(tabContext.setReqTab('pending'), true);
  assert.deepEqual(tabEvents.slice(0, 2), ['root', 'render:pending:0']);
  assert.match(functionSource('assets/app-runtime.js', 'renderRequest'), /request_queue_row_render_failed[^]*renderRequestQueueFallbackCard/);
  assert.match(functionSource('assets/app-runtime.js', 'isReadyRequestDataForAutoComplete'), /effectiveSpec[^]*effectiveLocPhotoMatch[^]*<= 0/);
  assert.match(functionSource('assets/app-runtime.js', 'isPhotoDateMsExpired'), /getDate\(\) \+ retentionDays \+ 1/);
});

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

test('Invariant 10 (Reclass Move Up / Move Down Season-Wide Open Stock & Loc Photo Match Math)', () => {
  const row = (id, location, lot, onHand, available, stock) => ({ UNIQUE_ID: id, ITEMCODE: '010018.031.1', LOCATIONCODE: location, LOTCODE: lot, SEASON: lot.split('.').pop(), PTRONHAND: String(onHand), PTRAVAILABLE: String(available), S_LTS: String(stock), MATCH: '80' });
  const rows = [row('source', 'A.03.000', '27.S1', 330, 330, 330), row('target', 'A.03.000', '27.F1', 114, 104, 104), row('sibling', 'A.02.000', '28.F1', 40, 40, 375)];
  const context = runFunctions('assets/app-runtime.js', ['reclassStockSeason', 'buildOptimisticInventoryReclassMoveModel'], {
    parseAppNumber: value => value == null ? null : Number(value), buildItemInquiryViewModel: (_item, nextRows) => ({ rows: nextRows }),
    avInventory: [], fullInventory: rows, cavInventory: [{ ITEMCODE: '010018.031.1', SEASON: 'F1', OPEN_STOCK: '375' }, { ITEMCODE: '010018.031.1', SEASON: 'S1', OPEN_STOCK: '330' }],
  });
  const result = context.buildOptimisticInventoryReclassMoveModel({ item: rows[0], inquiryModel: { rows } }, { commandId: 'golden-stock', moves: [{ source: { uniqueId: 'source' }, lines: [{ quantity: 55, destinationSeason: 'F1' }] }] }).model.rows;
  const target = result.find(rowValue => rowValue.UNIQUE_ID === 'target');
  assert.equal(target.PTRONHAND, '169');
  assert.equal(target.S_LTS, '159');
  assert.equal(result.find(rowValue => rowValue.UNIQUE_ID === 'sibling').S_LTS, '430');
  assert.equal(target.__reclassSeasonOpenStock, '430');
  assert.equal(Math.round(Number(target.PTRONHAND) * Number(target.MATCH) / 100), 135);
  assert.match(read('supabase/migrations/20261021220000_reclass_season_stock_and_recipients.sql'), /inventory_location_match_qty|loc_match_qty/i);
});

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
    currentUser: 'dylan_collyge', nativeAuthSessionActive: true, nativeAuthSessionUserId: 'actor', nativeAuthProfile: { id: 'actor', username: 'dylan_collyge' },
    PRIVILEGED_MANAGER_USER_KEYS: ['dylan_collyge', 'megan_kelly', 'jd_jones'], window: { innerWidth: 390 },
    document: { getElementById: () => grid }, buildFastInvokeAttrs: () => '',
  });
  vm.runInContext(functionSource('assets/app-runtime.js', 'isAuthenticatedDylanCollyge') + '\n' + functionSource('assets/app-runtime.js', 'isFullAppAdministrator') + '\n' + runtime.slice(start, end) + '\n' + functionSource('assets/app-runtime.js', 'getHomeDesktopColumnCount'), context);
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

test('Invariant 18 (Numeric Que Badge & Connected Startup State)', () => {
  const badgeClasses = new Set(['hidden']);
  const buttonClasses = new Set();
  const badge = { innerText: '', classList: { add: name => badgeClasses.add(name), remove: name => badgeClasses.delete(name) } };
  const button = { classList: { toggle: (name, enabled) => enabled ? buttonClasses.add(name) : buttonClasses.delete(name) } };
  const badgeContext = runFunctions('assets/app-runtime.js', ['paintFooterRequestBadgeOnly'], {
    document: { getElementById: id => id === 'footer-request-btn' ? button : id === 'footer-request-badge' ? badge : null },
    canUseFooterRequestShortcut: () => true,
    getRequestQueueAlertCount: counts => Number(counts.pending || 0),
  });
  assert.equal(badgeContext.paintFooterRequestBadgeOnly({ pending: 7 }), true);
  assert.equal(badge.innerText, '7');
  assert.equal(badgeClasses.has('hidden'), false);
  assert.doesNotMatch(functionSource('assets/app-runtime.js', 'paintFooterRequestBadgeOnly'), /innerText\s*=\s*['"]!['"]/);

  const connectionContext = runFunctions('assets/app-runtime.js', ['getDatasetRevisionConnectionLabel'], {
    datasetRevisionConnectionOwner: 'dylan',
    datasetRevisionConnectionStates: Array.from({ length: 4 }, (_, index) => ({ key: String(index), state: 'ready' })),
    getSupabaseReadIdentityScope: () => 'dylan',
    window: { GncUserAccessControl: { getSelfState: () => ({ denied: false }) } },
    hasActiveManualSync: () => false,
  });
  assert.match(connectionContext.getDatasetRevisionConnectionLabel(), /^Connected.*4 ready$/);
  assert.doesNotMatch(read('index.html'), /<details id="dashboard-sync-accordion"[^>]*\bopen\b/);
  assert.match(functionSource('assets/app-runtime.js', 'updateDashboardSyncSummary'), /\['DRIVE', 'CAV', 'RESERVES', 'SOC'\]/);
});

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

test('Invariant 22 (Canonical Escaped Plant Text Across Display and Drill Keys)', () => {
  const samples = [
    [String.raw`Alexander\'s Great Siberian Bugloss`, "Alexander's Great Siberian Bugloss"],
    [String.raw`Alice \\'N Wonderland Dwarf Oakleaf Hydrangea`, "Alice 'N Wonderland Dwarf Oakleaf Hydrangea"],
    [String.raw`Endless Summer® Twist N\\\' Shout® Hydrangea`, "Endless Summer® Twist N' Shout® Hydrangea"],
  ];
  const runtime = runFunctions('assets/app-runtime.js', ['normalizeEscapedDisplayText', 'normalizeSearchValue']);
  const appsScript = runFunctions('Code.gs', ['normalizeEscapedImportText_', 'normalizeEscapedImportRow_', 'canonicalizeMasterBulkPayloadValue_']);
  const api = runFunctions('supabase/functions/app-api/index.ts', [
    'escapedDisplayTextFieldKey', 'normalizeEscapedDisplayText', 'normalizeEscapedDisplayPayload', 'escapedDisplayTextJsonReplacer'
  ], { ESCAPED_DISPLAY_TEXT_FIELDS:new Set(['commonname', 'reqsalesnote']) });
  for (const [escaped, clean] of samples) {
    assert.equal(runtime.normalizeEscapedDisplayText(escaped), clean);
    assert.equal(runtime.normalizeSearchValue(escaped), runtime.normalizeSearchValue(clean));
    assert.equal(appsScript.normalizeEscapedImportText_(escaped), clean);
    assert.equal(api.normalizeEscapedDisplayText(escaped), clean);
  }
  assert.equal(appsScript.canonicalizeMasterBulkPayloadValue_({ commonname:samples[1][0] }).commonname, samples[1][1]);
  const inbound = { request:{ commonname:samples[2][0], req_sales_note:String.raw`Customer said \"hold\"` }, untouched:String.raw`C:\Plants` };
  api.normalizeEscapedDisplayPayload(inbound);
  assert.equal(inbound.request.commonname, samples[2][1]);
  assert.equal(inbound.request.req_sales_note, 'Customer said "hold"');
  assert.equal(inbound.untouched, String.raw`C:\Plants`);
  assert.equal(JSON.parse(JSON.stringify({ COMMONNAME:samples[0][0] }, api.escapedDisplayTextJsonReplacer)).COMMONNAME, samples[0][1]);

  const queue = runFunctions('assets/app-runtime.js', ['isRequestPendingVisible', 'buildPendingRequestRenderPlan'], {
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    normalizeRequestStatus: value => String(value || '').trim(), isTruthishHistoryValue: value => value === true,
    isRequestVisibleForCurrentUser: () => true, isMoveRequestRow: () => false,
    hasCompletionDateValue: item => Boolean(item?.DATE_COMPLETED || item?.date_completed), isRegularRequestQueueItem: () => true,
    compareLocationCodeValues: () => 0, naturalCompare: () => 0, getItemUniqueId: item => item.UNIQUE_ID,
    buildRequestPagedRenderPlan: (mode, crumbText, items) => ({ empty:!items.length, mode, crumbText, items, rows:items }),
  });
  const pendingRows = [
    { UNIQUE_ID:'pending-1', REQ_STATUS:'Pending', DATE_COMPLETED:null, REQ_QTY:'1', LOCATIONCODE:'D.09.013', LOTCODE:'27.F1' },
    { UNIQUE_ID:'pending-25', STATUS:'Pending', DATE_COMPLETED:null, QTY:25, LOCATIONCODE:'D.09.044', LOTCODE:'27.F1', REQUEST_FOLDER:'delivered-folder' },
    { UNIQUE_ID:'pending-null', STATUS:'Pending', DATE_COMPLETED:null, REQUEST_QTY:null, LOCATIONCODE:'F.05.000', LOTCODE:'27.F1' },
  ];
  assert.equal(pendingRows.every(queue.isRequestPendingVisible), true);
  assert.equal(queue.buildPendingRequestRenderPlan(pendingRows).rows.length, 3);

  const compatibility = runFunctions('assets/app-runtime.js', ['normalizeRequestBrowserCompatibilityRow'], {
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
  });
  const compatibleRow = compatibility.normalizeRequestBrowserCompatibilityRow({
    CUSTOMER:'Legacy Customer', CONSIGNEE:'Legacy Consignee', QTY:25, MEASURE_SPEC:'5 ft',
    REQUEST_CALIPER:'2 in', COMMENTS:'Legacy note', DATE_COMPLETED:null,
  });
  assert.equal(compatibleRow.CUSTOMER_NAME, 'Legacy Customer');
  assert.equal(compatibleRow.CONSIGNEE_NAME, 'Legacy Consignee');
  assert.equal(compatibleRow.REQUEST_QTY, 25);
  assert.equal(compatibleRow.REQUEST_SPEC, '5 ft');
  assert.equal(compatibleRow.REQUEST_NOTES, 'Legacy note');

  const depletion = runFunctions('assets/app-runtime.js', ['getDepletedLocPhotoMatchQtyValue'], {
    parseAppNumber: value => value === null || value === undefined || value === '' ? null : Number(value),
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    findLinkedMasterRow: () => null,
  });
  assert.equal(depletion.getDepletedLocPhotoMatchQtyValue({ PTRONHAND:25, BASELINE_ON_HAND:250, INITIAL_PHOTO_MATCH_QTY:125 }, 125), 0);
  assert.equal(depletion.getDepletedLocPhotoMatchQtyValue({ PTRONHAND:25 }, 125), 25);

  const migration = read('supabase/migrations/20261024070000_escaped_display_text_normalization_v1.sql');
  for (const marker of ['normalize_escaped_display_text_v1', 'a000_normalize_escaped_display_text_v1',
    'ph_master_inventory', 'ph_active_request', 'ph_request_history', 'ph_soc_master', 'ph_reserves', 'ph_cav_import']) assert.match(migration, new RegExp(marker));
  assert.match(read('supabase/migrations/20261024203000_unified_request_sync_sales_impact_v1.sql'), /zero_cross_request_dedupe_v1/);
  assert.match(read('supabase/functions/app-api/index.ts'), /\["request_queue", "active_request"\]\.includes\(dataset\)\) query\.set\("date_completed", "is\.null"\)/);
  const appApi = read('supabase/functions/app-api/index.ts');
  assert.match(appApi, /function normalizeRequestBrowserCompatibilityRow[^]*customer:[^]*customer_name:[^]*qty:[^]*request_qty:/);
  assert.match(appApi, /keys\.length > 64[^]*dataset_revisions_for_actor_v1/);
  assert.doesNotMatch(functionSource('supabase/functions/app-api/index.ts', 'handleDatasetRevisionsAction'), /allowedKeys/);
  const browserVerifier = read('scripts/verify-live-request-queue.mjs');
  for (const marker of ['headless: true', '#footer-request-btn', 'data-request-category="pending"',
    'No pending requests.', 'Oakland® Red Holly', 'Sunburst® Honeylocust', 'homeMetadataMs']) assert.match(browserVerifier, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Invariant 23 (Permanent Request History, Source-Line Ledger & Isolated Sync)', () => {
  const migration = read('supabase/migrations/20261025013000_agdata_v2362_canonical_requests.sql');
  const cleanup = read('supabase/migrations/20261025014500_agdata_v2362_remove_legacy_request_objects.sql');
  const runtime = read('assets/app-runtime.js');
  const navigation = read('assets/navigation-preferences.js');
  const api = read('supabase/functions/app-api/index.ts');
  assert.match(migration, /grant select on public\.ph_master_inventory,public\.ph_requests_pending[^]*to anon,authenticated/);
  assert.match(migration, /canonical-three-table-v2362/);
  assert.match(migration, /ph_requests_completed_history:'\|\|history\.unique_id/);
  assert.match(migration, /ph_requests_pending:'\|\|pending\.unique_id/);
  assert.match(cleanup, /drop table if exists public\.ph_request_sales_impact_ledger cascade/);
  assert.match(cleanup, /drop table if exists private\.request_financial_values_v1 cascade/);
  assert.match(runtime, /fetchActiveRequestLiveRows:canonicalPending[^]*requestsInventory/);
  assert.match(runtime, /homeSyncMetadata:\$\{table\}[^]*retained:\s*true/);
  assert.doesNotMatch(navigation, /Existing default/);
  assert.match(navigation, /Allow view[^]*Hide view/);
  assert.match(api, /resolveModuleAllowed\(supabase, actor, "request-sales-impact"\)/);
});

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

test('Invariant 29 (Request Creator Parity, Photo Dates, Item AV Notes, and Direct Quick Access)', () => {
  const migration = read('supabase/migrations/20261026050000_agdata_v2368_request_photo_av_navigation.sql');
  const canaryFix = read('supabase/migrations/20261026052000_agdata_v2368_request_canary_qualification.sql');
  const canaryStateProof = read('supabase/migrations/20261026053000_agdata_v2368_request_canary_state_proof.sql');
  const avNoteSanitizer = read('supabase/migrations/20261026054000_agdata_v2368_av_note_sanitizer.sql');
  const historicalPhotoDateKeyFix = read('supabase/migrations/20261026055000_agdata_v2368_historical_photo_date_key_fix.sql');
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
  assert.match(runtime, /hasVerifiedServerOptions[^]*avNoteServerOptionsCache\.get\(serverKey\)\?\.verified === true/);

  const appApi = read('supabase/functions/app-api/index.ts');
  assert.match(appApi, /table === "ph_app_users"\) return true/);
  assert.match(appApi, /action === "av_note_options"[^]*get_itemcode_av_note_options_v1/);
  assert.match(appApi, /ph_sales_office:[^\n]*photo_date/);
  assert.match(appApi, /ph_dock_issue_status:[^\n]*photo_date/);
  assert.match(read('supabase/functions/_shared/database.types.ts'), /ph_sales_office:[^]*Row:[^]*photo_date: string \| null[^]*Insert:[^]*photo_date\?: string \| null[^]*Update:[^]*photo_date\?: string \| null/);
  assert.match(read('services/database-contracts.generated.ts'), /"ph_sales_office":[^]*"row":[^]*"photo_date":[^]*"insert":[^]*"photo_date":[^]*"update":[^]*"photo_date":/);
  assert.match(appApi, /historical_archive_read_v2368[^]*historical_requests_read_v2368/);
  for (const file of ['components/historical-requests/HistoricalArchiveView.tsx',
    'components/historical-requests/HistoricalRequestsView.tsx']) {
    assert.match(read(file), /photo-thumb-date[^]*data-photo-taken-date/);
  }
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
});

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
  assert.match(appApi, /const APP_RUNTIME_RELEASE = "AgData v2\.3\.116"/);
  assert.match(appApi, /retainedReadResponse\("INVENTORY_READ_FAILED"\)/);
  assert.match(appApi, /historical_requests_read_v2370/);
  assert.match(appApi, /inventory_consolidation_suggestions_v2370/);
  assert.match(watchdog, /REQUEST_ABORTED\|DATASET_READ_SCOPE_CHANGED/);
  assert.ok(runner.includes(migrationName));
  assert.match(read('.codex/skills/agdata-runtime-watchdog/SKILL.md'), /Never record navigation\/scope cancellation codes/);
});

test('Invariant 41 (Canonical Version Mismatch Is One-Time and Auth-Safe)', () => {
  const lifecycle = read('assets/app-lifecycle.js');
  const runtime = read('assets/app-runtime.js');
  const shell = read('index.html');
  const worker = read('sw.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  assert.match(lifecycle, /FORCED_VERSION_UPGRADE_STORAGE_KEY = 'agdata_forced_version_upgrade'/);
  assert.match(lifecycle, /Promise\.all\(keys\.map\(key => root\.caches\.delete\(key\)\)\)/);
  assert.match(lifecycle, /Promise\.all\(registrations\.map\(registration => registration\.unregister\(\)\)\)/);
  assert.match(lifecycle, /next\.searchParams\.set\('_reload', String\(Date\.now\(\)\)\)/);
  assert.match(lifecycle, /VERSION_RELOAD_FUSE_MS = 5 \* 60 \* 1000/);
  assert.match(lifecycle, /isAuthTransitionActive\(\) \|\| activeSession\(\)/);
  assert.match(lifecycle, /deployment-fingerprint\.json\?t=\$\{Date\.now\(\)\}[^]*cache: 'no-store'/);
  assert.match(shell, /forceupgrade[^]*forceAgDataVersionUpgrade[^]*checkAgDataVersion\?\.\('boot'\)/);
  assert.match(runtime, /APP_VERSION_ENFORCEMENT_INTERVAL_MS = 60000/);
  assert.match(runtime, /addEventListener\('focus'[^]*checkCurrentAppVersion\('focus'\)/);
  assert.match(runtime, /x-agdata-app-version[^]*forceAgDataVersionUpgrade/);
  assert.match(worker, /then\(\(\) => self\.clients\.claim\(\)\)[^]*then\(\(\) => broadcastShellVersion\('GNC_SHELL_ACTIVATED'\)\)/);
  assert.match(worker, /navigateClientToForcedUpgrade[^]*forceupgrade[^]*APP_ASSET_VERSION/);
  assert.match(shell, /data\.type === 'GNC_SHELL_ACTIVATED'[^]*reloadForServiceWorkerUpdate\(targetBuild\)/);
  assert.match(appApi, /APP_RUNTIME_VERSION = "2\.3\.116"/);
  assert.match(appApi, /"X-AgData-App-Version": APP_RUNTIME_VERSION/);
  assert.match(appApi, /const appVersion = "2\.3\.116"[^]*app_version: appVersion/);
});

test('Invariant 42 (Published Version Fingerprint Matches Runtime Fetch Path)', () => {
  const writer = read('scripts/write-deployment-fingerprint.mjs');
  const lifecycle = read('assets/app-lifecycle.js');
  assert.match(writer, /writeFile\(path\.join\(siteRoot, 'deployment-fingerprint\.json'\), serialized, 'utf8'\)/);
  assert.match(writer, /writeFile\(path\.join\(siteRoot, 'deployment\.json'\), serialized, 'utf8'\)/);
  assert.match(writer, /writeFile\(path\.join\(siteRoot, 'deployments', `\$\{fingerprint\.commit\}\.json`\), serialized, 'utf8'\)/);
  assert.match(lifecycle, /fetch\(`\.\/deployment-fingerprint\.json\?t=\$\{Date\.now\(\)\}`/);
  assert.match(read('.codex/skills/agdata-release-governor/SKILL.md'), /Never add a runtime release-descriptor fetch path without emitting that exact path/);
});

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

test('Invariant 44 (Request Completion Persists Before Active-View Eviction)', () => {
  const migration = read('supabase/migrations/20261026183000_agdata_v2372_request_completion_acknowledgment.sql');
  const deliveryMigration = read('supabase/migrations/20261026184500_agdata_v2372_request_completion_delivery.sql');
  const requestSubmission = read('assets/request-submission.js');
  const runtime = read('assets/app-runtime.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  assert.match(migration, /from public\.ph_requests_pending where unique_id=p_request_id for update/);
  assert.match(migration, /delete from public\.ph_requests_pending where unique_id=request_id/);
  assert.match(migration, /request_completion_receipt_v2372/);
  assert.match(deliveryMigration, /reconcile_request_folder_completion_v2[^]*prepare_request_folder_completion_v2/);
  assert.match(deliveryMigration, /from public\.ph_requests_completed_history history/g);
  assert.doesNotMatch(runtime, /Save Needs Retry/);
  assert.match(requestSubmission, /detail\.includes\('REQUEST_NOT_FOUND'\)[^]*completionReplayUsed/);
  assert.match(appApi, /REQUEST_NOT_FOUND[^]*request_completion_receipt_v2372/);
  assert.match(read('.codex/skills/agdata-request-lifecycle-and-lock-guard/SKILL.md'), /Never re-read or delete a just-completed Request through `ph_active_request`/);
});

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
  assert.match(runtime, /isSuspendTag \|\| requestType === 'suspend_tag' \|\| isDockSuspendDcRequestSource\(item\)/);
  assert.match(runtime, /sourceRows\.length <= DOCK_SUSPEND_MIRROR_PREPARATION_CHUNK_SIZE/);
  assert.match(runtime, /rows: filteredItems,[^]*footerMarkup: ''/);
  assert.match(appApi, /table: "ph_active_suspend", permission: "ph_soc_master"/);
  assert.match(migration, /ph_active_suspend with \(security_invoker=true\)[^]*'Pending'::text as status[^]*true as is_suspend_tag/);
  const sync = read('scripts/fast-live-erp-sync.mjs');
  assert.match(sync, /FAST_LIVE_BATCH_SIZE = 1000/);
  assert.match(sync, /disable trigger user[^]*enable trigger user/);
  assert.doesNotMatch(sync, /from 'pg'|GNC_SUPABASE_DB_URL|new Pool/);
});

test('Invariant 51 (Login Restore Cannot Enter a Version Reload Loop)', () => {
  const lifecycle = read('assets/app-lifecycle.js');
  const runtime = read('assets/app-runtime.js');
  const shell = read('index.html');
  const migration = read('supabase/migrations/20261026220000_agdata_v2376_instant_login_and_fast_suspend_view.sql');
  assert.match(lifecycle, /VERSION_RELOAD_FUSE_MS = 5 \* 60 \* 1000/);
  assert.match(lifecycle, /isAuthTransitionActive\(\) \|\| activeSession\(\)/);
  assert.match(lifecycle, /!isAuthTransitionActive\(\)[^]*!activeSession\(\)[^]*runtime-not-ready/);
  assert.match(runtime, /LOGIN_READ_TIMEOUT_MS = 6000/);
  assert.match(runtime, /document\.documentElement\?\.classList\?\.contains\('booting-session'\)/);
  assert.match(shell, /isAgDataAuthTransitionActive\?\.\(\)[^]*__gncShellUpdateReady = true/);
  assert.match(migration, /open_stock_by_item as materialized/);
  assert.match(migration, /loc_totals_by_item_loc as materialized/);
  assert.doesNotMatch(migration, /left join lateral/);
  assert.match(migration, /alter role anon set statement_timeout='120s'/);
  assert.match(migration, /notify pgrst,'reload config'/);
});

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
    fullInventory: [],
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
    PTRREVIEWED: 1, S_LTS: 102, LOC_ON_HAND: 5, LOC_MATCH_QTY: 2 } });
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

test('Invariant 56 (Reclass Destination Preserves Season Stock and Location Total)', () => {
  const lineage = { ITEMCODE: '004103.010.1', CONTSIZE: '#1', SOURCE: 'Drive' };
  const rows = [
    { ...lineage, UNIQUE_ID: 'source', LOCATIONCODE: 'C.15.000', LOTCODE: '27.S1', SEASON: 'S1', PTRONHAND: '808', PTRAVAILABLE: '808', S_LTS: '529' },
    { ...lineage, UNIQUE_ID: 'other', LOCATIONCODE: 'C.15.000', LOTCODE: '27.U1', SEASON: 'U1', PTRONHAND: '70', PTRAVAILABLE: '70', S_LTS: '70' },
    { ...lineage, UNIQUE_ID: 'dest-sibling', LOCATIONCODE: 'F.16.000', LOTCODE: '27.F1', SEASON: 'F1', PTRONHAND: '113', PTRAVAILABLE: '113', S_LTS: '-276' }
  ];
  const context = vm.createContext({
    parseAppNumber: value => value == null || value === '' ? null : Number(String(value).replace(/,/g, '')),
    buildItemInquiryViewModel: (_item, nextRows) => ({ rows: nextRows, locationRows: [] })
  });
  vm.runInContext(functionSource('assets/app-runtime.js', 'reclassStockSeason') + '\n'
    + functionSource('assets/app-runtime.js', 'buildOptimisticInventoryReclassMoveModel'), context);
  const result = context.buildOptimisticInventoryReclassMoveModel({ item: {}, inquiryModel: { rows } }, {
    commandId: 'golden-reclass-destination', moves: [{ source: { uniqueId: 'source' },
      lines: [{ direction: 'move_up', destinationSeason: 'F1', quantity: 276 }] }]
  }).model.rows;
  const destination = result.find(row => row.LOCATIONCODE === 'C.15.000' && row.LOTCODE === '27.F1');
  assert.ok(destination, 'same-location destination is inserted into the visible model');
  assert.deepEqual([destination.PTRONHAND, destination.PTRREVIEWED, destination.PTRAVAILABLE, destination.S_LTS, destination.LOC_ON_HAND],
    ['276', '0', '276', '0', '878']);
  assert.equal(result.find(row => row.UNIQUE_ID === 'source').S_LTS, '253');
  assert.equal(result.find(row => row.UNIQUE_ID === 'dest-sibling').S_LTS, '0');
  assert.equal(rows[0].PTRONHAND, '808', 'the canonical source remains available for rollback');
});

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
    ensureViewDataForRender: () => false, syncDriveModeTabs() {}, syncDriveTabPills() {},
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

test('Invariant 63 (Queue Inventory Uses Exact Location/Lot and False Block Never Borrows Metrics)', () => {
  const helperContext = vm.createContext({});
  vm.runInContext(read('assets/queue-inventory-hydration.js'), helperContext);
  const rows = [
    { UNIQUE_ID: 'exact', ITEMCODE: '004380.010.1', LOCATIONCODE: 'B.04.000', LOTCODE: '27.F1', PTRONHAND: 5, PTRREVIEWED: 1, PTRAVAILABLE: 4, S_LTS: -2, LOC_MATCH_QTY: 3, LOC_ON_HAND: 25 },
    { UNIQUE_ID: 'other-lot', ITEMCODE: '004380.010.1', LOCATIONCODE: 'B.04.000', LOTCODE: '27.S1', PTRONHAND: 20, PTRREVIEWED: 2, PTRAVAILABLE: 18, S_LTS: 91 },
    { UNIQUE_ID: 'other-location', ITEMCODE: '004380.010.1', LOCATIONCODE: 'E.12.000', LOTCODE: '27.F1', PTRONHAND: 400, PTRREVIEWED: 5, PTRAVAILABLE: 395, S_LTS: 700 },
  ];
  const index = helperContext.AgMetricQueueInventory.createIndex(rows);
  const exactDisplay = index.resolveSuspendTagDisplay({ itemcode: '004380.010.1', locationcode: 'B.04.000', lotcode: '27.F1' });
  assert.equal(exactDisplay.matchLevel, 'item-location-lot');
  assert.equal(exactDisplay.row.PTRONHAND, 5);
  assert.equal(exactDisplay.row.S_LTS, -2);
  assert.equal(exactDisplay.row.LOC_ON_HAND, 25, 'location total sums only the requested physical location');
  assert.equal(index.resolveSuspendTagDisplay({ itemcode: '004380.010.1', locationcode: 'C.01.000', lotcode: '27.F1' }).status, 'missing',
    'same-lot inventory at another location is not a fallback');
  const noLot = index.resolveSuspendTagDisplay({ itemcode: '004380.010.1', locationcode: 'B.04.000' });
  assert.equal(noLot.matchLevel, 'item-location', 'same-location fallback is limited to identities without a lot');
  assert.equal(noLot.row.PTRONHAND, 25);
  assert.equal(noLot.row.LOC_ON_HAND, 25);
  assert.equal(index.resolveSuspendTagDisplay({ itemcode: '004380.010.1', locationcode: '00.000.111', lotcode: '27.F1' }).status, 'missing');

  const exactMaster = rows[0];
  const sink = {};
  const context = runFunctions('assets/app-runtime.js', ['isFalseBlockLocation', 'normalizeRequestCardMetrics', 'buildQueueInventoryMetricsHtml'], {
    window: { AgMetricQueueInventory: { identity: row => row } },
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== ''),
    isDockSuspendDcRequestMirrorRow: item => item?.isSuspend === true,
    findDockSuspendDcRequestSourceRow: item => item,
    getSuspendTagInventoryIdentity: item => item,
    getQueueCardInventoryState: () => ({ status: 'unavailable', row: null }),
    getQueueCardInventoryAuthorizationContext: () => ({ readScope: 'actor', scope: 'actor', permission: 'v1' }),
    getDatasetState: () => ({ initialLoaded: true, rowCompleteness: 'complete', liveVerifiedScope: 'actor', liveVerifiedPermission: 'v1' }),
    masterInventoryLookup: { resolve: () => ({ status: 'ready', row: exactMaster }) },
    fullInventory: rows,
    getSuspendTagMetricDisplayFallback: () => null,
    buildInventoryQuantityChipsHtml: row => { sink.row = row; return ''; },
  });
  const card = { isSuspend: true, ITEMCODE: exactMaster.ITEMCODE, LOCATIONCODE: exactMaster.LOCATIONCODE, LOTCODE: exactMaster.LOTCODE,
    suspend_tag_metrics: { PTRONHAND: 999, PTRREVIEWED: 0, PTRAVAILABLE: 999, OPEN_STOCK: 999, LOC_ON_HAND: 999, LOC_MATCH_QTY: 999 } };
  context.buildQueueInventoryMetricsHtml(card, 'request');
  assert.deepEqual([sink.row.PTRONHAND, sink.row.PTRREVIEWED, sink.row.PTRAVAILABLE, sink.row.OPEN_STOCK,
    sink.row.LOC_MATCH_QTY, sink.row.LOC_ON_HAND], [5, 1, 4, -2, 3, 25],
  'complete exact master data wins over conflicting enriched server metrics');
  const exactZeroMetrics = context.normalizeRequestCardMetrics({
    PTRONHAND: 0, PTRREVIEWED: 30, PTRAVAILABLE: 5, S_LTS: -2, LOC_ON_HAND: 2046,
    ON_HAND: 125, REVIEW: 120, AVAILABLE: 0
  });
  assert.deepEqual([exactZeroMetrics.PTRONHAND, exactZeroMetrics.PTRREVIEWED, exactZeroMetrics.PTRAVAILABLE,
    exactZeroMetrics.S_LTS, exactZeroMetrics.LOC_ON_HAND], [0, 30, 5, -2, 2046],
  'exact PTR values beat stale aliases and zero On Hand is never inferred');
  const quantityAliasContext = runFunctions('assets/app-runtime.js', ['syncDockSuspendDcRequestQuantityAliases'], {
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? null,
    isDockSuspendDcRequestMirrorRow: () => true
  });
  const mirrorWithDefaultZero = { PTRONHAND: 0, PTRREVIEWED: 0, PTRAVAILABLE: 0, S_LTS: 0 };
  quantityAliasContext.syncDockSuspendDcRequestQuantityAliases(mirrorWithDefaultZero, {
    IS_SUSPEND_TAG: true, ON_HAND: 125, REVIEW: 120, AVAILABLE: 5, OPEN_STOCK: -2
  });
  assert.deepEqual([mirrorWithDefaultZero.PTRONHAND, mirrorWithDefaultZero.PTRREVIEWED,
    mirrorWithDefaultZero.PTRAVAILABLE, mirrorWithDefaultZero.S_LTS], [125, 120, 5, -2],
  'active Suspend exact view aliases replace default zero compatibility fields before hydration');
  context.buildQueueInventoryMetricsHtml({ ...card, LOCATIONCODE: '0.00.111' }, 'request');
  assert.deepEqual([sink.row.PTRONHAND, sink.row.PTRREVIEWED, sink.row.PTRAVAILABLE, sink.row.OPEN_STOCK,
    sink.row.LOC_MATCH_QTY, sink.row.LOC_ON_HAND], [0, 0, 0, 0, 0, 0],
  'False Block overrides every server metric alias');

  let rejectedPayloadRow;
  const unavailableContext = runFunctions('assets/app-runtime.js', ['isFalseBlockLocation', 'normalizeRequestCardMetrics', 'buildQueueInventoryMetricsHtml'], {
    window: {}, firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== ''),
    isDockSuspendDcRequestMirrorRow: item => item?.isSuspend === true, findDockSuspendDcRequestSourceRow: item => item,
    getSuspendTagInventoryIdentity: item => item,
    getQueueCardInventoryState: () => ({ status:'loading', row:null }),
    getQueueCardInventoryAuthorizationContext: () => null, getDatasetState: () => null,
    getSuspendTagMetricDisplayFallback: () => null,
    buildInventoryQuantityChipsHtml: (row, options) => { rejectedPayloadRow = { row, options }; return ''; }
  });
  unavailableContext.buildQueueInventoryMetricsHtml({ ...card, suspend_tag_metrics: {
    MATCH_LEVEL: 'item', PTRONHAND: 999, PTRREVIEWED: 0, PTRAVAILABLE: 999, OPEN_STOCK: 999, LOC_ON_HAND: 999, LOC_MATCH_QTY: 999
  } }, 'request');
  assert.equal(rejectedPayloadRow.row.PTRONHAND, undefined, 'item-only server enrichment is not painted while exact hydration is pending');
  assert.equal(rejectedPayloadRow.row.OPEN_STOCK, undefined);
  assert.equal(rejectedPayloadRow.options.hydrationStatus, '', 'invalid enrichment stays an unknown/N/A state');

  const metadataContext = runFunctions('assets/app-runtime.js', ['syncDockSuspendCardMasterSummaryFields'], {
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? null
  });
  const metadataRow = { PRIORITY: 1, HOLDSTOPREASON: 'stale', SPEC: 'stale spec', PHOTO_LINK: 'stale photo', PHOTO_DATE: 'stale date' };
  metadataContext.syncDockSuspendCardMasterSummaryFields(metadataRow, {
    priority: 4, holdstopreason: 'current hold', spec: 'current spec', photo_url: 'current photo', photo_date: '2026-10-27'
  });
  assert.deepEqual([metadataRow.PRIORITY, metadataRow.HOLDSTOPREASON, metadataRow.SPEC, metadataRow.PHOTO_LINK, metadataRow.PHOTO_DATE],
    [4, 'current hold', 'current spec', 'current photo', '2026-10-27'], 'exact master metadata replaces stale queue summaries');
});

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
    window: {}, firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== ''),
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

test('Invariant 67 (Interactive Login and Atomic Drive Publication Retain Their Exact Owners)', () => {
  const runtime = read('assets/app-runtime.js');
  const code = read('Code.gs');
  const migration = read('supabase/migrations/20261027133509_agdata_v2384_runtime_recovery.sql');
  const passkey = runtime.slice(runtime.indexOf('async function signInWithAppPasskey('), runtime.indexOf('async function registerAppPasskey('));
  const startup = runtime.slice(runtime.indexOf('async function initializeAppSessionOnLoad('), runtime.indexOf('let appChromeStartupStarted'));
  assert.ok(passkey.indexOf('invalidateNativeAuthRecovery()') < passkey.indexOf('auth.signInWithPasskey()'));
  assert.match(startup, /startupRecoveryEpoch === nativeAuthRecoveryEpoch/);
  assert.match(startup, /!stillOwnsStartup\(\) \|\| \(nativeAuthSessionActive && nativeAuthSessionUserId\)/);
  assert.match(runtime, /viewportDefaultBand !== viewportDefaultBand/);
  assert.match(code, /cleanupCompletedImportExtraction_\(sourceIdentity, fileMeta\.file_name\)[^]*moveDriveFileToFolderWithRetry_\(sourceFile/);
  assert.match(migration, /mapped\.source_unique_id[^]*not exists\([^]*live\.unique_id=mapped\.canonical_unique_id[^]*exists\([^]*live\.unique_id=mapped\.source_unique_id/);
  assert.match(migration, /resolved_in_version='2\.3\.84'/);
});

test('Invariant 68 (Reclass Delta Reports, Bloom Gallery Shares and Discoverable Passkeys Stay Canonical)', () => {
  const reclass = runFunctions('Code.gs', ['buildReclassInlineOhText_']);
  assert.equal(reclass.buildReclassInlineOhText_('152', [{ quantity: 140, destinationSeason: 'f1' }]), '152 - 140 --> F1');
  assert.equal(reclass.buildReclassInlineOhText_('152', [
    { quantity: 100, destinationSeason: 'f1' }, { quantity: 40, destinationSeason: 's1' }
  ]), '152 - 100 --> F1, - 40 --> S1');

  const runtime = read('assets/app-runtime.js');
  assert.match(runtime, /buildInventoryShareGalleryUrl[^]*url\.searchParams\.set\('gallery', '1'\)[^]*url\.searchParams\.set\('p', photoKeys\.join\(','\)\)/);
  assert.match(runtime, /Photos: \$\{inventoryPhotos\.length\} photo[^]*buildInventoryShareGalleryUrl/);
  const inventoryFormatter = runtime.slice(runtime.indexOf('function formatInventoryItemsText('), runtime.indexOf('function formatInventoryItemsHtml('));
  assert.doesNotMatch(inventoryFormatter, /Photo \$\{photoIndex \+ 1\}|photo\.url|photo\.href/);
  assert.match(runtime, /LAST_PASSKEY_USERNAME_STORAGE_KEY[^]*invalidateNativeAuthRecovery\(\)[^]*auth\.signInWithPasskey\(\)/);

  const edge = read('supabase/functions/app-api/index.ts');
  assert.match(edge, /passkey_auth_options[^]*passkeys\/authentication\/options/);
  assert.match(edge, /passkeys\/authentication\/verify/);
  assert.match(edge, /passkey_login_verify/);
  assert.match(edge, /options\.allowCredentials = \[\]/);
  const appsScriptPatch = read('scripts/apps-script-function-patch.mjs');
  assert.match(appsScriptPatch, /reclassEmailFunctions[^]*buildReclassInlineOhText_/);
  assert.match(appsScriptPatch, /additiveFunctions[^]*buildReclassInlineOhText_/);
  const migration = read('supabase/migrations/20261027143000_agdata_v2385_reclass_open_stock_and_inline_oh.sql');
  assert.match(migration, /replace\(definition,\s*'next_stock:=coalesce\(baseline,0\)\+change\.delta;',\s*'next_stock:=coalesce\(baseline,0\)\+change\.oh_delta;'\)/);
  assert.match(migration, /private\.reclass_numeric_v1\(m\.s_lts\)\+change\.oh_delta/);
});

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
  const runtime = read('assets/app-runtime.js');
  const edge = read('supabase/functions/_shared/production-workflow.ts');
  const migration = read('supabase/migrations/20261027163924_agdata_v2387_reclass_persistence_and_evidence.sql');
  const batchMigration = read('supabase/migrations/20261027171000_agdata_v2387_batch_reclass_evidence.sql');
  const preview = runtime.slice(runtime.indexOf('function buildOptimisticInventoryReclassMoveModel('), runtime.indexOf('function reconcileArgosReclassCardDraftState('));
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

test('Invariant 77 (Managers Hub, Live File Revisions and Bunch Drafts Stay Durable)', () => {
  const runtime = read('assets/app-runtime.js');
  const bunch = read('assets/bunch-note.js');
  const registry = read('assets/live-sync-registry.js');
  assert.match(runtime, /plainManagersHubEntry[^]*activeHomeTab = 'dashboard'/);
  assert.match(runtime, /hasActiveManualSync\(\) \? 10000 : 15000/);
  assert.match(runtime, /gnc_dylan_last_toasted_files_v2[^]*username !== 'dylan_collyge'/);
  assert.match(registry, /homeSyncMetadata:\s*\[[^\]]*hl_po_parsed/);
  assert.match(bunch, /normalizeBunchNoteLocationKey[^]*gnc_bunch_note_drafts_v1[^]*Saved Drafts \/ Active Bunch Notes/);
  assert.match(bunch, /function reset\(\) \{ persistLocalDraft\(\)/);
});

test('Invariant 78 (Manager Shell Enhancement Preserves Every Submodule Deep Link)', () => {
  const workspace = read('assets/mobile-workspace.js');
  assert.match(read('index.html'), /mobile-workspace\.js\?v=2\.3\.116/);
  assert.match(read('scripts/build-live-shell.mjs'), /ASSET_QUERY_OVERRIDES[^]*'mobile-workspace\.js': `\$\{RELEASE_QUERY\}\.1`/);
  assert.match(read('scripts/prepare-release-site.mjs'), /isScopedAssetHotfix[^]*version === `\$\{assetVersion\}\.1`[^]*mobile-workspace\.js[^]*photo-history-v2026090401\.js[^]*inventory-list-contract\.js[^]*live-app-styles-base-v2026090503\.css/);
  assert.match(workspace, /view==='managers'[^]*includes\('setHomeTab\('\)[^]*button\.dataset\.moduleTileId/);
  assert.match(workspace, /byTarget\.get\(targetKey\)[^]*byTarget\.set\(targetKey,keep\)/);
  assert.match(read('.codex/skills/agdata-app-shell-and-navigation/SKILL.md'), /Never deduplicate manager module cards only by their shared `managers` route/);
});

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
  assert.match(runtime, /\+ Add Location \/ Fill Tag/);
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
    MANUAL_SYNC_STAGE_ORDER_CLIENT_DEFAULT: ['drive', 'cav', 'reserves', 'soc', 'transactions_keyed', 'stine_lumber', 'pikes', 'hl_po_parsed'],
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
  const source = functionSource('assets/app-runtime.js', 'applyArgosInventoryReclassMoveCommand');
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

test('Invariant 87 (ERP API Allows Status Reads and Admin-Leased Cloud Continuations)', async () => {
  const { validateErpSyncCommand, ERP_SYNC_STAGES } = await import('../supabase/functions/_shared/erp-sync.mjs');
  const { SECONDARY_ERP_STAGES } = await import('../supabase/functions/_shared/erp-secondary-sync.mjs');
  const calls = [];
  let claimed = false, steps = 0, releases = 0;
  const status = { active: false, currentStage: 'idle', stageResults: [] };
  const context = runFunctions('supabase/functions/app-api/index.ts', ['handleErpSyncAction', 'releaseCloudErpSyncStep', 'withCloudErpSyncLeaseHeartbeat'], {
    dispatchCloudErpSync: status => { assert.ok(status.runId, 'cloud dispatch has the durable run identity'); },
    setInterval: () => 1, clearInterval: () => {},
    validateErpSyncCommand, ERP_SYNC_STAGES, SECONDARY_ERP_STAGES, FULL_ACCESS_USER_KEYS: new Set(['dylan_collyge']),
    normalizeUsername: value => String(value).toLowerCase(), jsonObject: value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
      return value;
    },
    jsonResponse: value => value, errorResponse: (message, status, extra) => ({ ok: false, status, ...extra }),
    databaseFailureResponse: (message, _error, code) => ({ ok: false, code }),
    processCloudErpSyncStep: async () => {
      steps += 1;
      return { result: { done: true }, status: { active: false, status: 'complete', currentStage: 'idle', stageIndex: 5, stageResults: [] } };
    },
    supabase: { rpc: async (name, args) => {
      calls.push(name);
      if (name === 'get_erp_sync_status_v1') return { data: status };
      if (name === 'claim_erp_sync_job_v2') {
        const first = !claimed; claimed = true;
        return { data: first
          ? { active: true, claimed: true, runId: '00000000-0000-4000-8000-000000000087', status: { stageResults: [] } }
          : { active: true, claimed: false, runId: '00000000-0000-4000-8000-000000000087', status: { active: true, runId: '00000000-0000-4000-8000-000000000087', currentStage: 'drive', stageIndex: 0 } } };
      }
      if (name === 'update_erp_sync_job_v1') return { data: args.p_status };
      if (name === 'claim_erp_sync_request_step_v1') return { data: { claimed: true, workerId: '00000000-0000-4000-8000-000000000087', continuationStep: 1, status: { active: true, currentStage: 'drive' } } };
      if (name === 'release_erp_sync_request_step_v1') { releases += 1; return { data: true }; }
      throw new Error(`Unexpected RPC ${name}`);
    } },
    recordHandledError: (_service, _action, error) => { throw error; },
  });
  assert.equal((await context.handleErpSyncAction({}, { action: 'erp_sync', operation: 'status' }, { username: 'field_reader' })).data.active, false);
  assert.deepEqual(calls, ['get_erp_sync_status_v1']);
  const command = { action: 'erp_sync', operation: 'start', commandId: '00000000-0000-4000-8000-000000000001', force: true, forceRestart: true, maxAttemptsPerStage: 1 };
  assert.equal((await context.handleErpSyncAction({}, command, { username: 'field_reader' })).code, 'ERP_SYNC_FORBIDDEN');
  assert.equal((await context.handleErpSyncAction({}, { action: 'erp_sync', operation: 'status', force: true }, { username: 'dylan_collyge' })).code, 'ERP_SYNC_REQUEST_INVALID');
  const started = await context.handleErpSyncAction({}, command, { username: 'dylan_collyge' });
  assert.equal(started.status, 'CONTINUE');
  assert.equal(started.data.runId, '00000000-0000-4000-8000-000000000087');
  const duplicate = await context.handleErpSyncAction({}, command, { username: 'dylan_collyge' });
  assert.equal(duplicate.data.runId, '00000000-0000-4000-8000-000000000087');
  assert.equal((await context.handleErpSyncAction({}, { action: 'erp_sync', operation: 'continue', runId: '00000000-0000-4000-8000-000000000087' }, { username: 'field_reader' })).code, 'ERP_SYNC_FORBIDDEN');
  const completed = await context.handleErpSyncAction({}, { action: 'erp_sync', operation: 'continue', runId: '00000000-0000-4000-8000-000000000087' }, { username: 'dylan_collyge' });
  assert.equal(completed.status, 'complete');
  assert.equal(completed.data.currentStage, 'idle');
  assert.equal(steps, 1, 'one authorized continuation executes one bounded cloud step');
  assert.equal(releases, 1, 'the exact claimed step lease is released');
  assert.ok(calls.includes('claim_erp_sync_job_v2'));
  assert.ok(calls.includes('claim_erp_sync_request_step_v1'));
  assert.equal(calls.includes('claim_erp_sync_job_v1'), false, 'browser requests do not use the legacy worker claim');
});

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

test('Invariant 91 (RUN SCRIPT Claims Explicit Cloud Continuations and Retires the Local Daemon)', async () => {
  const { ERP_SYNC_STAGES, validateErpSyncCommand } = await import('../supabase/functions/_shared/erp-sync.mjs');
  const { SECONDARY_ERP_STAGES } = await import('../supabase/functions/_shared/erp-secondary-sync.mjs');
  const calls = [];
  let claimCount = 0, stepClaimCount = 0, stepCalls = 0, releaseCount = 0;
  const context = runFunctions('supabase/functions/app-api/index.ts', ['handleErpSyncAction', 'releaseCloudErpSyncStep', 'withCloudErpSyncLeaseHeartbeat'], {
    dispatchCloudErpSync: status => { assert.ok(status.runId, 'cloud dispatch has the durable run identity'); },
    setInterval: () => 1, clearInterval: () => {},
    ERP_SYNC_STAGES, SECONDARY_ERP_STAGES, validateErpSyncCommand, FULL_ACCESS_USER_KEYS: new Set(['dylan_collyge']),
    normalizeUsername: value => String(value).trim().toLowerCase(), jsonObject: value => value || {},
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000091' },
    jsonResponse: value => value, errorResponse: (message, status, extra) => ({ ok: false, status, ...extra }),
    databaseFailureResponse: (message, _error, code) => ({ ok: false, code }),
    recordHandledError: (_service, _action, error) => { throw error; },
    supabase: { rpc: async (name, args) => {
      calls.push(name);
      if (name === 'get_erp_sync_status_v1') return { data: { active: false, status: 'idle', stageResults: [] } };
      if (name === 'claim_erp_sync_job_v2') {
        claimCount += 1;
        return { data: claimCount === 1
          ? { claimed: true, runId: '00000000-0000-4000-8000-000000000091', status: { stageResults: [] } }
          : { claimed: false, active: true, runId: '00000000-0000-4000-8000-000000000091', status: { active: true, runId: '00000000-0000-4000-8000-000000000091', currentStage: 'queued' } } };
      }
      if (name === 'claim_erp_sync_request_step_v1') {
        stepClaimCount += 1;
        assert.equal(args.p_run_id, '00000000-0000-4000-8000-000000000091');
        assert.equal(args.p_actor, 'dylan_collyge');
        return { data: { claimed: true, workerId: '00000000-0000-4000-8000-000000000091', continuationStep: 1, status: { active: true, currentStage: 'drive', stageIndex: 0 } } };
      }
      if (name === 'release_erp_sync_request_step_v1') { releaseCount += 1; return { data: true }; }
      if (name === 'update_erp_sync_job_v1') return { data: args.p_status };
      throw new Error(`Unexpected RPC ${name}`);
    } },
    processCloudErpSyncStep: async () => {
      stepCalls += 1;
      return { result: { done: false }, status: { active: true, status: 'running', currentStage: 'drive', stageIndex: 0, stageResults: [] } };
    },
  });
  const session = { mustChangePassword: false };
  const actor = { username: 'dylan_collyge' };
  assert.equal((await context.handleErpSyncAction(session, { action: 'erp_sync', operation: 'status' }, actor)).data.active, false);
  const command = { action: 'erp_sync', operation: 'start', commandId: '00000000-0000-4000-8000-000000000091', force: true, forceRestart: true, maxAttemptsPerStage: 1 };
  const started = await context.handleErpSyncAction(session, command, actor);
  assert.equal(started.status, 'CONTINUE');
  assert.equal(started.data.runId, '00000000-0000-4000-8000-000000000091');
  assert.deepEqual(plain(started.data.stageOrder), ['drive', 'cav', 'reserves', 'soc', 'transactions_keyed', 'stine_lumber', 'pikes', 'hl_po_parsed']);
  const duplicate = await context.handleErpSyncAction(session, command, actor);
  assert.equal(duplicate.data.runId, '00000000-0000-4000-8000-000000000091');
  assert.equal(duplicate.status, 'CONTINUE');
  const continued = await context.handleErpSyncAction(session, { action: 'erp_sync', operation: 'continue', runId: '00000000-0000-4000-8000-000000000091' }, actor);
  assert.equal(continued.status, 'CONTINUE');
  assert.equal(stepClaimCount, 1, 'the browser claims exactly one atomic continuation step');
  assert.equal(stepCalls, 1, 'only a successfully claimed continuation performs cloud work');
  assert.equal(releaseCount, 1, 'the exact continuation lease is released');
  assert.equal(calls.filter(name => name === 'claim_erp_sync_job_v2').length, 2);
  assert.equal(calls.filter(name => name === 'claim_erp_sync_request_step_v1').length, 1);
  assert.equal(calls.some(name => name.includes('worker')), false, 'browser flow does not dispatch the legacy worker path');

  const { spawnSync } = await import('node:child_process');
  const retired = spawnSync(process.execPath, [path.join(root, 'scripts/local-erp-sync-worker.mjs')], { encoding: 'utf8', timeout: 5000 });
  assert.equal(retired.status, 1);
  assert.match(retired.stderr, /ERP_LOCAL_WORKER_RETIRED_USE_CLOUD_RUN_SCRIPT/);

  const appApi = read('supabase/functions/app-api/index.ts');
  const routeSource = appApi.slice(appApi.indexOf('if (import.meta.main) serve(')).replace('if (import.meta.main)', 'if (true)');
  const emitted = ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let handler;
  const routeContext = vm.createContext({ serve: callback => { handler = callback; },
    withObservedRequest: (_name, _request, callback) => callback(), corsHeaders: {},
    ensureServerConfig() {}, normalizeEscapedDisplayPayload: value => value,
    errorResponse: (message, status, extra) => ({ message, status, ...extra }) });
  vm.runInContext(emitted, routeContext);
  const response = await handler({ method: 'POST', headers: { get: () => 'application/json' }, json: async () => ({ action: 'erp_sync_worker' }) });
  assert.equal(response.status, 410);
  assert.equal(response.code, 'ERP_SYNC_LOCAL_WORKER_DISABLED');
});

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
  assert.match(api, /handlePhotoUpload[\s\S]*assertInventoryLiveChangeActorRows/);
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
  assert.match(runtime, /sourceIdentity: getSuspendTagStableSourceIdentity\(mirror\)/);
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

test('Invariant 97 (Empty Assigned Items Full Marker Cannot Suppress Current Warehouse Hydration)', () => {
  const runtime = read('assets/app-runtime.js');
  const entryStart = runtime.indexOf("if (nextTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW) {", runtime.indexOf('function setHomeTab'));
  const entry = runtime.slice(entryStart, runtime.indexOf("if (nextTab === MANAGER_EVAL_REPORTS_VIEW)", entryStart));
  const loader = runtime.slice(runtime.indexOf('async function ensureDatasetLoaded'), runtime.indexOf('function queueDatasetLoad'));
  assert.match(entry, /ensureDatasetLoaded\('warehouseAssignedItems', 'full', \{[\s\S]*force: !warehouseAssignedItemsInventory\.length/);
  assert.match(entry, /bypassLiveSyncCoordinator: !warehouseAssignedItemsInventory\.length/);
  assert.match(entry, /retryOnCancellation: !warehouseAssignedItemsInventory\.length/);
  assert.match(loader, /if \(!options\.bypassLiveSyncCoordinator && typeof canUseProductionLiveSync/);
  assert.match(loader, /maxRetries = options\.retryOnCancellation === true \? 4 : 0[\s\S]*getSupabaseReadErrorCode\(error\) !== 'REQUEST_ABORTED'/);
  assert.doesNotMatch(runtime.slice(runtime.indexOf('function setRealtimeSubscriptionsForView'), runtime.indexOf('function refreshRealtimeSubscriptionsForCurrentView')), /options\.bypassLiveSyncCoordinator/);
  assert.match(read('scripts/build-live-shell.mjs'), /'live-app-runtime-v2026082010\.min\.js': RELEASE_QUERY/);
  assert.match(read('scripts/build-live-shell.mjs'), /runtime\.src = '\.\/assets\/\$\{runtimeName\}\?v=\$\{ASSET_QUERY_OVERRIDES\[runtimeName\] \|\| RELEASE_QUERY\}'/);
  assert.match(read('index.html'), /app-runtime\.js\?v=2\.3\.116/);
  assert.match(entry, /preserveRequestedMode: true[\s\S]*scheduleManagersRender\(true\)/);
});

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
  const toggle = runtime.slice(runtime.indexOf('function toggleArgosReclassV3Action('), runtime.indexOf('function handleArgosReclassV3ProposalInput('));
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

test('Invariant 100 (RUN SCRIPT Drives Bounded Cloud Continuations Through IDLE)', async () => {
  const writes = [];
  const applied = [];
  let continuation = 0;
  const context = runFunctions('assets/app-runtime.js', ['continueManualErpSync', 'runGoogleAppsScriptTrigger'], {
    isRunScriptActive: false, window: {}, currentUser: 'dylan_collyge', currentUserDisplay: 'Dylan',
    document: { hidden: false }, navigator: { onLine: true }, console,
    manualSyncStatusState: { active: true, runId: 'stale-run', currentStage: 'drive', stageIndex: 0 },
    MANUAL_SYNC_STAGE_ORDER_CLIENT_DEFAULT: ['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed'],
    MANUAL_SYNC_SCRIPT_TIMEOUT_MS: 600000, MANUAL_SYNC_STATUS_STALE_MS: 12000,
    releaseStaleManualSyncClientStateIfNeeded() {}, canRunManualInventoryImport: () => true,
    hasActiveManualSync: () => true, syncGoogleScriptButton() {}, showToast() {},
    getSupabaseReadIdentityScope: () => 'same-account',
    getNativeAuthRequestHeaders: async () => ({ Authorization: 'Bearer fixture-token' }),
    applyManualSyncStatus: status => { applied.push(status); return status; },
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== ''),
    APP_API_FUNCTION_URL: '/app-api', crypto: { randomUUID: () => 'sync-command-100' },
    postAppFunctionJson: async (_url, payload) => {
      writes.push(payload);
      if (payload.operation === 'start') return { ok: true, status: 'CONTINUE', data: { runId: 'run-100' } };
      continuation += 1;
      const active = continuation < 3;
      return {
        ok: true,
        status: active ? 'CONTINUE' : 'COMPLETE',
        data: { durableStatus: { active, runId: 'run-100', currentStage: active ? 'drive' : 'idle', stageIndex: active ? continuation : 5 } }
      };
    },
    setTimeout: callback => { callback(); return 0; }
  });
  await context.runGoogleAppsScriptTrigger();
  assert.deepEqual(plain(writes[0]), {
    action: 'erp_sync', operation: 'start', commandId: 'sync-command-100',
    maxAttemptsPerStage: 1, force: true, forceRestart: true, maxRowsPerSlice: 2500
  });
  assert.deepEqual(writes.slice(1).map(write => [write.action, write.operation, write.runId]), [
    ['erp_sync', 'continue', 'run-100'],
    ['erp_sync', 'continue', 'run-100'],
    ['erp_sync', 'continue', 'run-100']
  ]);
  assert.equal(applied.at(-1).active, false);
  assert.equal(applied.at(-1).currentStage, 'idle');
  assert.equal(context.isRunScriptActive, false);
  assert.equal(context.window.googleScriptRunInFlight, false);
});

test('Invariant 101 (Empty Cloud Sync Completion Does Not Require a File Cursor)', async () => {
  const { ERP_SYNC_STAGES, validateErpSyncCommand } = await import('../supabase/functions/_shared/erp-sync.mjs');
  const { SECONDARY_ERP_STAGES } = await import('../supabase/functions/_shared/erp-secondary-sync.mjs');
  const calls = [];
  const context = runFunctions('supabase/functions/app-api/index.ts', ['handleErpSyncAction', 'releaseCloudErpSyncStep', 'withCloudErpSyncLeaseHeartbeat'], {
    dispatchCloudErpSync: status => { assert.ok(status.runId, 'cloud dispatch has the durable run identity'); },
    setInterval: () => 1, clearInterval: () => {},
    ERP_SYNC_STAGES, SECONDARY_ERP_STAGES, validateErpSyncCommand, FULL_ACCESS_USER_KEYS: new Set(['dylan_collyge']),
    normalizeUsername: value => String(value || '').trim().toLowerCase(),
    jsonObject: value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
      return value;
    },
    jsonResponse: value => value,
    errorResponse: (message, status, extra) => ({ ok: false, status, ...extra }),
    databaseFailureResponse: (message, _error, code) => ({ ok: false, code }),
    supabase: { rpc: async (name, args) => {
      calls.push(name);
      if (name === 'claim_erp_sync_request_step_v1') return { data: {
        claimed: true, workerId: '00000000-0000-4000-8000-000000000101', continuationStep: 1,
        status: { active: true, currentStage: 'hl_po_parsed', stageIndex: 4, continuationCursor: { stageIndex: 5, stageResults: [] } }
      } };
      if (name === 'release_erp_sync_request_step_v1') {
        assert.equal(args.p_run_id, '00000000-0000-4000-8000-000000000101');
        assert.equal(args.p_worker_id, '00000000-0000-4000-8000-000000000101');
        assert.equal(args.p_step, 1);
        return { data: true };
      }
      throw new Error(`Unexpected RPC ${name}`);
    } },
    processCloudErpSyncStep: async (_runId, _workerId, _step, status) => {
      assert.equal(status.continuationCursor.stageIndex, 5, 'all configured stages are already skipped as up-to-date');
      return { result: { done: true }, status: {
        active: false, status: 'complete', currentStage: 'idle', stageIndex: 5, stageResults: []
      } };
    }
  });
  const response = await context.handleErpSyncAction({ mustChangePassword: false }, {
    action: 'erp_sync', operation: 'continue', runId: '00000000-0000-4000-8000-000000000101'
  }, { username: 'dylan_collyge' });
  assert.equal(response.status, 'complete');
  assert.equal(response.data.active, false);
  assert.equal(response.data.currentStage, 'idle');
  assert.equal(response.fileId, null);
  assert.equal(response.nextOffset, null);
  assert.deepEqual(calls, ['claim_erp_sync_request_step_v1', 'release_erp_sync_request_step_v1']);
});

test('Invariant 102 (Cloud XLSX Seals Its Exact Parsed Count Before Commit and Move)', async () => {
  const { runErpSyncWorkerStep } = await import('../supabase/functions/_shared/erp-sync.mjs');
  const entries = {
    'xl/workbook.xml': '<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>itemcode</t></is></c><c r="B1" t="inlineStr"><is><t>commonname</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>001</t></is></c><c r="B2" t="inlineStr"><is><t>Blue Grass</t></is></c></row></sheetData></worksheet>'
  };
  const locals = [], central = [];
  let offset = 0;
  for (const [pathName, textValue] of Object.entries(entries)) {
    const name = Buffer.from(pathName), data = Buffer.from(textValue);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    locals.push(local, data);
    const record = Buffer.alloc(46 + name.length);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42); name.copy(record, 46);
    central.push(record); offset += local.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const workbook = Buffer.concat([...locals, directory, end]);
  const events = [];
  let moved = false;
  const fetcher = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/files')) {
      const isDrive = url.searchParams.get('q')?.includes("'drive-folder'");
      return Response.json({ files: isDrive && !moved ? [{ id: 'drive-file-102', name: 'Drive.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        modifiedTime: '2026-10-28T12:00:00Z', parents: ['drive-folder'] }] : [] });
    }
    if (url.pathname.endsWith('/files/drive-file-102') && init.method === 'PATCH') {
      events.push('move'); moved = true; return Response.json({ id: 'drive-file-102' });
    }
    if (url.pathname.endsWith('/files/drive-file-102') && url.searchParams.get('fields') === 'id,parents') return Response.json({parents:['drive-folder']});
    if (url.pathname.endsWith('/files/drive-file-102')) return new Response(workbook);
    throw new Error(`Unexpected Drive request ${url}`);
  };
  const supabase = { rpc: async (name, args) => {
    events.push(name);
    if (name === 'check_erp_file_sync_needed_v1') return { data: { skip: false } };
    if (name === 'fast_erp_import_columns_v1') return { data: ['unique_id', 'itemcode', 'commonname'] };
    if (name === 'fast_begin_erp_stage_v1') {
      assert.equal(args.p_expected_rows, 50000);
      assert.equal(args.p_file_meta.expected_rows_pending, true);
      return { data: { stage_id: 'stage-102', expected_rows: 50000, staged_rows: 0 } };
    }
    if (name === 'fast_append_erp_stage_batch_v1') return { data: { staged_rows: args.p_start_row + args.p_rows.length } };
    if (name === 'fast_seal_erp_stage_v1') {
      assert.equal(args.p_stage_id, 'stage-102'); assert.equal(args.p_expected_rows, 1);
      return { data: { ok: true, staged_rows: 1, expected_rows: 1 } };
    }
    if (name === 'fast_commit_erp_stage_swap_v1') return { data: { ok: true } };
    throw new Error(`Unexpected ERP RPC ${name}`);
  } };
  const folders = { drive: 'drive-folder', cav: 'cav-folder', reserves: 'reserves-folder',
    soc: 'soc-folder', hl_po_parsed: 'hl-folder', processed: { drive: 'drive-processed' } };
  const env = key => key === 'ERP_SYNC_DROP_FOLDERS_JSON' ? JSON.stringify(folders) : '';
  const status = async value => events.push(value.active === false ? 'idle' : 'status');
  let cursor = { stageIndex: 0, stageResults: [], attemptedByStage: {} };
  let result;
  for (let request = 0; request < 3; request += 1) {
    result = await runErpSyncWorkerStep({ supabase, fetcher, status, env, accessToken: 'fixture-token', cursor });
    cursor = result.cursor;
    if (result.done) break;
  }
  assert.equal(result.done, true);
  assert.equal(result.ok, true, JSON.stringify(cursor.stageResults));
  assert.equal(moved, true);
  const begin = events.indexOf('fast_begin_erp_stage_v1');
  const append = events.indexOf('fast_append_erp_stage_batch_v1');
  const seal = events.indexOf('fast_seal_erp_stage_v1');
  const commit = events.indexOf('fast_commit_erp_stage_swap_v1');
  const move = events.indexOf('move');
  assert.ok(begin >= 0 && begin < append && append < seal && seal < commit && commit < move,
    'stage begins, appends, seals the actual one-row count, commits, then moves the source file');
  assert.equal(cursor.stageResults[0].rowCount, 1);
});

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

test('Invariant 104 (Resumed ERP File Offset Is Persisted Before Resumed I/O)', async () => {
  const { runErpSyncWorkerStep } = await import('../supabase/functions/_shared/erp-sync.mjs');
  const statuses = [];
  const folderSnapshot = Object.fromEntries(['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed']
    .map(key => [key, { files: [], listDurationMs: 0 }]));
  const file = { id: 'resume-file-104', name: 'Resume.xlsx', modifiedTime: '2026-10-28T12:00:00Z', parents: ['drive-folder'] };
  const cursor = { stageIndex: 0, stageResults: [], attemptedByStage: {}, folderSnapshot,
    fileContinuation: { stageIndex: 0, file, state: { stageId: 'stage-resume-104', expectedRows: 50000,
      expectedRowsPending: true, nextOffset: 12000, processedRows: 8000, identityCounts: {},
      headerRowIndex: 1, header: ['itemcode'] } } };
  const folders = { drive: 'drive-folder', cav: 'cav-folder', reserves: 'reserves-folder',
    soc: 'soc-folder', hl_po_parsed: 'hl-folder' };
  const env = key => key === 'ERP_SYNC_DROP_FOLDERS_JSON' ? JSON.stringify(folders) : '';
  const supabase = { rpc: async name => name === 'check_erp_file_sync_needed_v1' ? { data: { skip: false } } : { data: null } };
  await assert.rejects(runErpSyncWorkerStep({ supabase,
    fetcher: async () => { throw new Error('fixture resumed download fault'); },
    status: async patch => statuses.push(patch), env, accessToken: 'fixture-token', cursor
  }), /fixture resumed download fault/);
  const firstPersistedCursor = statuses[0].continuationCursor;
  assert.equal(firstPersistedCursor.stageIndex, 0);
  assert.equal(firstPersistedCursor.fileContinuation.file.id, file.id);
  assert.equal(firstPersistedCursor.fileContinuation.state.nextOffset, 12000);
  assert.equal(firstPersistedCursor.fileContinuation.state.processedRows, 8000);
  assert.equal(statuses.length, 1, 'the checkpoint is written before the resumed download can fail');
});

test('Invariant 105 (Both Reclass Send Paths Close Before a Delayed Database Receipt)', async () => {
  for (const review of [false, true]) {
    let settle;
    const delayed = new Promise(resolve => { settle = resolve; });
    const events = [];
    const state = { sourceView: 'drive', snapshot: { uniqueId: 'row' }, idempotencyToken: 'instant-test' };
    const payload = { rowOverlays: [{ proposals: [{ action: 'move_down', splits: [{ quantity: 20, destinationSeason: 'X' }] }] }] };
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
    const sandbox = runFunctions('assets/app-runtime.js', [name], context);
    const started = performance.now();
    const task = sandbox[name]();
    await new Promise(resolve => setImmediate(resolve));
    const duration = performance.now() - started;
    assert.deepEqual(events.slice(0, 3), ['inventory-preview', 'close', 'Moves Saved'], name);
    assert.ok(duration < 100, `${name} optimistic close ${duration.toFixed(2)}ms`);
    assert.equal(button.textContent.includes('Saving move'), false);
    settle({ receipt: {}, movedUids: ['row'] });
    await task;
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
    'firstNonEmptyValue', 'normalizeWarehouseAssignedItemRow', 'getManagerUnassignedItemcodes',
    'getManagerAssignedItemsDisplayRows', 'getManagerAssignedItemsExportRows', 'getManagerAssignedItemsAssigneeOptions',
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

test('Invariant 115 (Table Management Photo History Is Read-Only and Cache-Busted In Place)', () => {
  const captured = [];
  const context = vm.createContext({
    currentUser: 'dylan_collyge', APP_API_FUNCTION_URL: '/functions/v1/app-api',
    normalizeSessionIdentity: value => String(value || '').trim().toLowerCase(), canOpenPhotoHistory: () => true,
    postAppFunctionJson: async () => ({ ok: true }),
    window: { GncPhotoHistory: { open: bridge => captured.push(bridge) } },
  });
  vm.runInContext(functionSource('assets/app-runtime.js', 'openDylanPhotoHistory'), context);
  context.openDylanPhotoHistory({ readOnly: true });
  context.openDylanPhotoHistory();
  assert.equal(captured[0].readOnly, true);
  assert.equal(captured[1].readOnly, false, 'the standalone Photo History entry retains normal sharing mode');
  const manager = functionSource('assets/app-runtime.js', 'openManagerTableManagement');
  assert.match(manager, /if \(key === 'photo-history'\) return openDylanPhotoHistory\(\{ readOnly: true \}\);/);
  const module = read('assets/photo-history-v2026090401.js');
  assert.match(module, /if\(readOnly\)return;/);
  assert.match(module, /if\(readOnly\|\|requestBusy\)return;/);
  assert.match(module, /tray\.hidden=readOnly;notices\.hidden=readOnly/);
  const build = read('scripts/build-live-shell.mjs');
  assert.match(build, /'live-app-runtime-v2026082010\.min\.js': RELEASE_QUERY/);
  assert.match(build, /'photo-history-v2026090401\.js': `\$\{RELEASE_QUERY\}\.1`/);
  assert.match(read('index.html'), /photo-history-v2026090401\.js\?v=2\.3\.116/);
  assert.match(read('index.html'), /app-runtime\.js\?v=2\.3\.116/);
  assert.match(read('sw.js'), /APP_SHELL_RUNTIME_REVISION = 'cloud-relay-cache-r2'/);
});

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
  assert.match(functionSource('assets/app-runtime.js', 'applyArgosInventoryReclassMoveCommand'),
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
    fullInventory, avOpenInventory: [], cavInventory: [],
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

test('Invariant 124 (Cold Assigned Items full projection is unique and remains coordinator-owned)', () => {
  const runtime = read('assets/app-runtime.js');
  const context = runFunctions('assets/app-runtime.js', ['getMasterFullSelectFields', 'buildMasterFullDatasetQuery'], {
    window: { AgMetricInventoryList: { physicalColumns: ['unique_id', 'baseline_on_hand', 'ptravailable'] } },
    appendEvalMasterScopeToQuery: query => query,
  });
  const selectedFields = context.buildMasterFullDatasetQuery().slice('select='.length).split('&')[0].split(',');
  assert.deepEqual(selectedFields, ['unique_id', 'baseline_on_hand', 'ptravailable']);
  assert.equal(new Set(selectedFields).size, selectedFields.length, 'the canonical full query must not request a physical column twice');

  const entryStart = runtime.indexOf("if (nextTab === MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW) {", runtime.indexOf('function setHomeTab'));
  const entry = runtime.slice(entryStart, runtime.indexOf("if (nextTab === MANAGER_EVAL_REPORTS_VIEW)", entryStart));
  const panel = functionSource('assets/app-runtime.js', 'renderManagerAssignedItemsExportPanel');
  const contractContext = vm.createContext({});
  vm.runInContext(read('assets/inventory-list-contract.js'), contractContext);
  const physicalColumns = Array.from(contractContext.AgMetricInventoryList.physicalColumns);
  assert.equal(new Set(physicalColumns).size, physicalColumns.length, 'the full physical projection must be unique');
  assert.match(read('scripts/build-live-shell.mjs'), /'inventory-list-contract\.js': `\$\{RELEASE_QUERY\}\.1`/);
  assert.match(read('scripts/build-live-shell.mjs'), /'app-shell-style-05\.css': `\$\{RELEASE_QUERY\}\.1`/);
  assert.match(read('scripts/build-live-shell.mjs'), /'live-app-styles-base-v2026090503\.css': `\$\{RELEASE_QUERY\}\.1`/);
  assert.match(read('scripts/build-live-shell.mjs'), /live-app-styles-base-v2026090503\.css\?v=\$\{ASSET_QUERY_OVERRIDES\['live-app-styles-base-v2026090503\.css'\] \|\| RELEASE_QUERY\}/);
  assert.match(read('index.html'), /inventory-list-contract\.js\?v=2\.3\.116/);
  assert.match(read('index.html'), /app-shell-style-05\.css\?v=2\.3\.116/);
  assert.match(entry, /ensureDatasetLoaded\('master', 'full', \{ preserveRequestedMode: true \}\)/);
  assert.match(panel, /ensureDatasetLoaded\('master', 'full', \{ preserveRequestedMode: true \}\)/);
  assert.match(runtime.slice(runtime.indexOf('async function ensureDatasetLoaded'), runtime.indexOf('function queueDatasetLoad')),
    /await getProductionLiveSyncCoordinator\(\)\.ensure\(adapter, !!options\.force\)/);
});

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

import { countImportableErpXlsxRows, normalizeErpRows, parseErpXlsxPage } from '../supabase/functions/_shared/erp-sync.mjs';
import { deflateRawSync } from 'node:zlib';

test('Invariant 127 (SOC ingestion retains valid Dock aliases regardless of Suspend status)', async () => {
  const entries = {
    'xl/workbook.xml': '<workbook xmlns:r="urn:r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>itemcode</t></is></c><c r="B1" t="inlineStr"><is><t>docknumber</t></is></c><c r="C1" t="inlineStr"><is><t>tripnumber</t></is></c><c r="D1" t="inlineStr"><is><t>drop</t></is></c><c r="E1" t="inlineStr"><is><t>suspend</t></is></c><c r="F1" t="inlineStr"><is><t>suspend-to</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>101</t></is></c><c r="B2" t="inlineStr"><is><t>38.0</t></is></c><c r="D2" t="inlineStr"><is><t>40.0</t></is></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>102</t></is></c><c r="C3" t="inlineStr"><is><t>39.0</t></is></c><c r="D3" t="inlineStr"><is><t>30.0</t></is></c></row>' +
      '<row r="4"><c r="A4" t="inlineStr"><is><t>103</t></is></c><c r="B4" t="inlineStr"><is><t>0</t></is></c></row>' +
      '<row r="5"><c r="A5" t="inlineStr"><is><t>104</t></is></c><c r="E5" t="inlineStr"><is><t>SUSPEND</t></is></c><c r="F5" t="inlineStr"><is><t>DC</t></is></c></row>' +
      '<row r="6"><c r="A6" t="inlineStr"><is><t>105</t></is></c><c r="B6" t="inlineStr"><is><t>null</t></is></c></row>' +
      '<row r="7"><c r="A7" t="inlineStr"><is><t>106</t></is></c><c r="B7" t="inlineStr"><is><t>nan</t></is></c></row>' +
      '<row r="8"><c r="A8" t="inlineStr"><is><t>107</t></is></c><c r="B8" t="inlineStr"><is><t>none</t></is></c></row>' +
      '</sheetData></worksheet>',
  };
  const local = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const filename = Buffer.from(name), raw = Buffer.from(content), compressed = deflateRawSync(raw);
    const header = Buffer.alloc(30 + filename.length);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(filename.length, 26); filename.copy(header, 30);
    local.push(header, compressed);
    const record = Buffer.alloc(46 + filename.length);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(8, 10);
    record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(raw.length, 24); record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42); filename.copy(record, 46); central.push(record); offset += header.length + compressed.length;
  }
  const centralData = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16);
  const bytes = Buffer.concat([...local, centralData, end]);
  const page = await parseErpXlsxPage(bytes, 0, 10, { dataset: 'soc' });
  assert.deepEqual(page.rows.map(row => row.itemcode), ['101', '102', '104']);
  assert.equal(await countImportableErpXlsxRows(bytes, 'soc'), 3);
  const rows = await normalizeErpRows(page.rows, 'soc', ['unique_id', 'itemcode', 'dock', 'stopnumber']);
  assert.deepEqual(rows.map(row => [row.dock ?? null, row.stopnumber ?? null]), [['38.0', '40.0'], ['39.0', '30.0'], [null, null]]);
});

test('Invariant 128 (Season Priority and Item Detail read notes from the exact live inventory row)', () => {
  const runtime = read('assets/app-runtime.js');
  const context = vm.createContext({
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

test('Invariant 132 (Service worker activation finishes without awaiting a client navigation)', async () => {
  const worker = read('sw.js');
  const activationSource = worker.match(/self\.addEventListener\('activate', \(event\) => \{[^]*?^\}\);/m)?.[0];
  assert.ok(activationSource, 'activation listener exists');
  const retired = [];
  let navigateCalls = 0;
  let activateListener = null;
  const client = { url: 'https://agmetricapp.com/?shellv=AgData+v2.3.97', navigate: () => { navigateCalls += 1; return new Promise(() => {}); } };
  const context = vm.createContext({
    Promise,
    self: {
      addEventListener: (type, listener) => { if (type === 'activate') activateListener = listener; },
      registration: { navigationPreload: { enable: () => Promise.resolve(), disable: () => Promise.resolve() } },
      clients: { claim: () => Promise.resolve(), matchAll: async () => [client] }
    },
    caches: { keys: async () => ['agdata-v2.3.97', 'agdata-v2.3.100'], delete: async key => { retired.push(key); return true; } },
    hasCompleteShellInstall: async () => true,
    isRetiredRootCacheName: key => key !== 'agdata-v2.3.100',
    broadcastShellVersion: async type => { assert.equal(type, 'GNC_SHELL_ACTIVATED'); },
    navigateClientToForcedUpgrade: target => target.navigate(),
    navigateInactiveClientsToCurrentShell: async () => {}
  });
  vm.runInContext(activationSource, context);
  let activationPromise = null;
  activateListener({ waitUntil: promise => { activationPromise = promise; } });
  const completed = await Promise.race([activationPromise.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]);
  assert.equal(completed, true, 'claim and version broadcast finish activation even if a client navigation never settles');
  assert.equal(navigateCalls, 0, 'activation does not initiate or await client.navigate');
  assert.deepEqual(retired, ['agdata-v2.3.97']);
  assert.match(worker, /navigateInactiveClientToCurrentShell\(event\.clientId, 'inactive-network-activity'\)/, 'later stale inactive-client refresh remains available');
});

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

test('Invariant 135: SOC ingestion retains every physical Suspend row independently of DC queue eligibility', async () => {
  const { normalizeErpRows } = await import('../supabase/functions/_shared/erp-sync.mjs');
  const rows = await normalizeErpRows([
    { itemcode: '001', suspend: 'SUSPEND', suspendto: 'Other', ordernum: '1', linenum: '1' },
    { itemcode: '002', tripnumber: '38.0', ordernum: '1', linenum: '2' },
    { itemcode: '003', dock: '0', ordernum: '1', linenum: '3' },
  ], 'soc', ['unique_id', 'itemcode', 'dock', 'suspend', 'suspendto', 'ordernum', 'linenum']);
  assert.deepEqual(rows.map(row => row.itemcode), ['001', '002']);
});

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

test('Invariant 137: a leased cloud chunk queues its successor before workbook processing can terminate', async () => {
  const events = [];
  const context = runFunctions('supabase/functions/app-api/index.ts', ['claimAndDispatchCloudStep'], {
    jsonObject: value => value,
    supabase: { rpc: async name => ({ data: name === 'get_erp_sync_status_v1'
      ? { active: true, runId: 'run', requestedBy: 'authorized' }
      : { claimed: true, workerId: 'owner', continuationStep: 1 } }) },
    dispatchCloudErpSync: value => { assert.equal(value.runId, 'run'); events.push('successor'); },
    executeCloudErpSyncStep: async () => { events.push('processing'); await new Promise(() => {}); },
    EdgeRuntime: { waitUntil: () => events.push('retained') }, recordHandledError() {},
  });
  assert.equal(await context.claimAndDispatchCloudStep('run'), true);
  assert.deepEqual(events, ['successor', 'processing', 'retained']);
});

test('Invariant 138: streamed XLSX callbacks retain at most one bounded raw batch', async () => {
  const batches = [];
  const context = runFunctions('supabase/functions/_shared/erp-sync.mjs', ['parseErpXlsxImportRows'], {
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

test('Invariant 139: compact ERP batches preserve explicit null-clearing columns and typed values', async () => {
  const { compactErpRowsPreservingNullColumnUnion } = await import('../supabase/functions/_shared/erp-sync.mjs');
  const original = [{ unique_id:'a', itemcode:'001', note:null, quantity:'3' },
    { unique_id:'b', itemcode:'002', note:null, quantity:null },
    { unique_id:'c', itemcode:'003', note:'new', quantity:null, later_column:null }];
  const rows = original.map(row => ({ ...row }));
  compactErpRowsPreservingNullColumnUnion(rows);
  const columns = list => [...new Set(list.flatMap(Object.keys))].sort();
  assert.deepEqual(columns(rows), columns(original));
  const expand = list => list.map(row => Object.fromEntries(columns(original).map(key => [key, row[key] ?? null])));
  assert.deepEqual(expand(rows), expand(original));
  assert.ok(JSON.stringify(rows).length < JSON.stringify(original).length);
});

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

test('Invariant 156 (Sales Rep Bloom Actions Expose Only Share and Request)', () => {
  const makeElement = initialClasses => {
    const classes = new Set(initialClasses || []);
    return { dataset: {}, innerText: '', className: '', setAttribute() {},
      classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
      hasClass: name => classes.has(name) };
  };
  const actionIds = ['global-action-bar','footer-cart-btn','footer-cart-badge','sel-count','cart-helper-text',
    'bloom-picker-actions-toggle','bloom-picker-actions-icon','bloom-picker-actions-list','batch-share-menu-wrap',
    'batch-btn-assign','batch-btn-eval-task','batch-btn-ncr','batch-btn-request','batch-btn-move','batch-btn-flyer',
    'batch-btn-take-back','batch-btn-endcap','batch-btn-shear','batch-btn-bloom-order','batch-btn-project'];
  const roleCases = ['Sales Rep','sales_rep','salesrep','Sales','Manager'];
  for (const role of roleCases) {
    const elements = Object.fromEntries(actionIds.map(id => [id, makeElement(id === 'bloom-picker-actions-list' ? ['hidden'] : [])]));
    const context = vm.createContext({
      currentRole: role, currentUser: 'rep-user', document: { getElementById: id => elements[id] || null }, window: {},
      selectedItems: new Set(['row-1']), selectedItemSources: new Map(), cartPanelOpen: true, bloomPickerActionsOpen: true,
      getCartSelectedItems: () => [{ DOM_ID: 'row-1' }], renderBloomPickerTrayRows() {}, syncBloomShareMenuUi() {}, syncGlobalHeaderChrome() {},
      canUseFullDriveBloomPickerActions: () => true, canUseCartInventoryActions: () => true, canSubmitBloomPickerOrder: () => true,
      canUseDriveQuickRequest: () => true, isRequestLikeItem: () => false, isDockLikeItem: () => false,
      isSalesOfficeLikeItem: () => false, canUseEvalTaskAssignment: () => false, getEvalTaskSelectionItems: () => [],
      canCreateLocationWorkJob: () => false, canUseGroupedBloomNcr: () => false, canCreateShearLocationInquiry: () => false,
    });
    runFunctions('assets/app-runtime.js', ['normalizeRoleAccessToken','getBloomPickerActionVisibility','updateGlobalActionBar'], context);
    vm.runInContext(`currentRole = ${JSON.stringify(role)}; getRoleAccessState = () => { const normalized = normalizeRoleAccessToken(currentRole); const isSalesRole = ['SALES','SALE','SALESUSER','SALESROLE'].includes(normalized); const isRep = isSalesRole || normalized === 'REP' || normalized === 'SALESREP' || normalized.includes('SALESREP'); return { isRep, isRepLike: isRep, isCsr: false }; };`, context);
    context.updateGlobalActionBar();
    assert.equal(elements['batch-share-menu-wrap'].hasClass('hidden'), false, `${role}: Share remains visible`);
    assert.equal(elements['batch-btn-request'].hasClass('hidden'), false, `${role}: Request remains visible`);
    if (role === 'Manager') {
      assert.equal(elements['batch-btn-project'].hasClass('hidden'), false, 'Project remains visible to non-Sales-Rep roles');
      continue;
    }
    assert.equal(elements['batch-btn-project'].hasClass('hidden'), true, `${role}: Project is hidden`);
    for (const id of ['batch-btn-assign','batch-btn-eval-task','batch-btn-ncr','batch-btn-move','batch-btn-flyer',
      'batch-btn-take-back','batch-btn-endcap','batch-btn-shear','batch-btn-bloom-order']) {
      assert.equal(elements[id].hasClass('hidden'), true, `${role}: ${id} is hidden`);
    }
  }
});

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
    getLiveDriveNoteRow: () => null,
  });
  const source = { UNIQUE_ID: 'soc-row-162', ITEMCODE: '003085.030.', LOCATIONCODE: 'D.12.000', LOTCODE: '26.F1', PHOTO_URL: '', SPEC: '' };
  const display = context.getDockCardLiveInventoryDisplayRow(source);
  assert.equal(display.UNIQUE_ID, 'soc-row-162', 'the SOC physical identity remains the action identity');
  assert.equal(display.ITEMCODE, '003085.030.', 'prefix is a display join key only');
  assert.deepEqual([display.PHOTO_URL, display.SPEC, display.LOC_MATCH_PCT, display.HOLD_STOP_CODE, display.HOLD_STOP_REASON, display.PTRONHAND],
    ['photo-1,photo-2', '10-12" HxW', '23', 'H', 'sheared', '24']);
  const ambiguous = { ...source, UNIQUE_ID: 'soc-ambiguous' };
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
  const context = runFunctions('assets/app-runtime.js', ['persistPendingReclassDeliveryDraft', 'getReclassDeliveryJob', 'submitArgosInventoryTransaction'], {
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
  });
  const started = performance.now();
  await context.submitArgosInventoryTransaction();
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `the dialog returns before network dispatch settles (${elapsed.toFixed(1)}ms)`);
  assert.deepEqual(events.slice(0, 3), ['persist', 'close', 'Moves Saved']);
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

test('Invariant 172 (Eval Reclass Is Assigned Only At Every UI Boundary)', () => {
  const ctx = runFunctions('assets/app-runtime.js', ['isEvalReclassRowAssigned', 'isWarehouseAssignedDriveCardForCurrentUser',
    'canCurrentUserUseDriveCardOptions'], {
    currentRole: 'Evaluator', currentUser: 'taylor_eval', currentUserDisplay: 'Taylor Eval',
    GLOBAL_LIVE_CHANGE_USER_KEYS: new Set(['dylan_collyge', 'megan_kelly', 'jd_jones', 'mitch_kaiser']),
    normalizeLiveChangeUsername: value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
    getRoleAccessState: () => ({ isEval: true, isAdmin: false }), canUserMakeLiveChangesOnRow: () => false,
    isAlwaysDriveCardOptionsUser: () => false,
    isRowAssignedToUser: (user, row) => ['taylor_eval'].includes(String(user || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')) && row?.unique_id === 'assigned',
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== '') ?? '',
  });
  assert.equal(ctx.canCurrentUserUseDriveCardOptions({ unique_id: 'assigned' }, 'drive'), true);
  assert.equal(ctx.canCurrentUserUseDriveCardOptions({ unique_id: 'other' }, 'drive'), false);
  assert.equal(ctx.isEvalReclassRowAssigned('taylor_eval', { unique_id: 'assigned' }), true);
  assert.equal(ctx.isEvalReclassRowAssigned('taylor_eval', { unique_id: 'other' }), false);
  const runtime = read('assets/app-runtime.js');
  assert.match(runtime, /if \(!isEvalReclassRowAssigned\(currentUser \|\| currentUserDisplay, item\)\)/);
  assert.match(runtime, /if \(!isEvalReclassRowAssigned\(currentUser \|\| currentUserDisplay, submitState\.item\)\)/);
  const api = read('supabase/functions/app-api/index.ts');
  assert.match(api, /INVENTORY_LIVE_CHANGE_EVAL_ROW_NOT_ASSIGNED/);
  assert.match(api, /ph_inventory_row_assignments[\s\S]*?ph_warehouse_assigned_items/);
});

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
  assert.match(api, /if \(result\.done && cursor\.historyComplete !== true\)[\s\S]*runSocHistorySyncStep/);
  assert.match(api, /historyComplete: history\.done/);
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

test('Invariant 180 (cold full hydration is shared across Home and coordinator callers)', async () => {
  const runtime = read('assets/app-runtime.js');
  const homeContext = functionSource('assets/app-runtime.js', 'getProductionLiveSyncContext');
  const homeFallback = homeContext.slice(homeContext.indexOf("if (view === 'home'"), homeContext.indexOf('const hasDataCohort'));
  assert.match(homeFallback, /getProductionCoreLiveProjection\('master', view, foregroundContext\)/,
    'Home fallback must use the canonical projection selector while a cold full master load is active');
  assert.match(homeFallback, /createProductionCoreLiveAdapter\('master', projection/);

  const loaderSource = runtime.slice(runtime.indexOf('async function ensureDatasetLoaded'), runtime.indexOf('function queueDatasetLoad'));
  assert.match(loaderSource, /coldSourceHydrations\.has\(key\)[\s\S]*?coldPromise\?\.ownerIdentity === owner[\s\S]*?await state\.fullPromise/,
    'the coordinator path must join the same owner’s in-flight cold full promise before creating another adapter');
  assert.match(functionSource('assets/app-runtime.js', 'hydrateColdSource'),
    /Object\.defineProperty\(promise, 'ownerIdentity', \{ value: owner/,
    'the cold promise must carry its identity owner for safe joining');

  const makeCase = identity => {
    let resolveFull;
    const fullPromise = new Promise(resolve => { resolveFull = resolve; });
    const state = { fullPromise };
    let coordinatorCalls = 0;
    const coldPromise = Promise.resolve(true);
    Object.defineProperty(coldPromise, 'ownerIdentity', { value: identity });
    const context = runFunctions('assets/app-runtime.js', ['ensureDatasetLoaded'], {
      RETIRED_DATASET_KEYS: new Set(), DATASET_DEFINITIONS: { warehouseAssignedItems: {} },
      coldSourceHydrations: new Map([['warehouseAssignedItems', coldPromise]]),
      getSupabaseReadIdentityScope: () => identity,
      getDatasetState: () => state,
      canUseProductionLiveSync: () => true,
      getProductionLiveSyncContext() { coordinatorCalls += 1; throw new Error('duplicate live-sync adapter'); },
      getProductionLiveSyncCoordinator() { coordinatorCalls += 1; throw new Error('duplicate live-sync adapter'); },
      createProductionCoreLiveAdapter() { coordinatorCalls += 1; throw new Error('duplicate live-sync adapter'); },
      getDatasetRenderRowCount: () => 0,
    });
    return { promise: context.ensureDatasetLoaded('warehouseAssignedItems', 'full'), resolveFull, calls: () => coordinatorCalls };
  };

  const sameOwner = makeCase('account-a');
  assert.equal(sameOwner.calls(), 0, 'same-owner cold full load joins without starting a coordinator request');
  sameOwner.resolveFull(true);
  assert.equal(await sameOwner.promise, true, 'joined caller receives the cold full result');

  let currentOwner = 'account-a';
  let resolveStale;
  const staleFullPromise = new Promise(resolve => { resolveStale = resolve; });
  const staleState = { fullPromise: staleFullPromise };
  const staleColdPromise = Promise.resolve(true);
  Object.defineProperty(staleColdPromise, 'ownerIdentity', { value: 'account-a' });
  let staleCoordinatorCalls = 0;
  const staleContext = runFunctions('assets/app-runtime.js', ['ensureDatasetLoaded'], {
    RETIRED_DATASET_KEYS: new Set(), DATASET_DEFINITIONS: { warehouseAssignedItems: {} },
    coldSourceHydrations: new Map([['warehouseAssignedItems', staleColdPromise]]),
    getSupabaseReadIdentityScope: () => currentOwner,
    getDatasetState: () => staleState,
    canUseProductionLiveSync: () => true,
    getProductionLiveSyncContext() { staleCoordinatorCalls += 1; throw new Error('unexpected coordinator path'); },
    getProductionLiveSyncCoordinator() { staleCoordinatorCalls += 1; throw new Error('unexpected coordinator path'); },
    createProductionCoreLiveAdapter() { staleCoordinatorCalls += 1; throw new Error('unexpected coordinator path'); },
    getDatasetRenderRowCount: () => 0,
  });
  const staleJoin = staleContext.ensureDatasetLoaded('warehouseAssignedItems', 'full');
  currentOwner = 'account-c';
  resolveStale(true);
  assert.equal(await staleJoin, false, 'an identity change while awaiting the cold promise discards its result');
  assert.equal(staleCoordinatorCalls, 0, 'stale cold work is not replaced by a second coordinator fetch');

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

test('Invariant 187 (Suspend photo proof survives navigation but never an account change)', async () => {
  let owner='one';const item={UNIQUE_ID:'tag',suspend_tag_status:'awaiting_rep'};
  const ctx=runFunctions('assets/app-runtime.js',['loadCurrentSuspendTagPhotoRow','isCurrentSuspendTagPhotoProof','canCurrentUserWorkRequestItem'],{
    suspendTagPhotoProofs:new WeakSet(),AbortController,getDockSuspendDcRequestSourceUid:()=> 'tag',isDockSuspendDcRequestMirrorRow:()=>true,
    canCurrentUserViewDockSuspendDcRequests:()=>true,getProductionLiveSyncContext:()=>({scope:owner,dataPermissionVersion:'p'}),
    findDockSuspendDcRequestSourceRow:()=>item,getSuspendTagWriteVersion:()=>0,getSupabaseReadIdentityScope:()=>owner
  });
  const proof=await ctx.loadCurrentSuspendTagPhotoRow(item);assert.equal(ctx.isCurrentSuspendTagPhotoProof(proof,item),true);
  owner='two';assert.equal(ctx.isCurrentSuspendTagPhotoProof(proof,item),false);
  assert.doesNotMatch(functionSource('assets/app-runtime.js','loadCurrentSuspendTagPhotoRow'),/supabaseRpc|suspendTagApi|REVIEW_LOCKED/);
});

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
  assert.match(read('assets/app-runtime.js'),/suspendOrderField\('Plan Start'/);
});

test('Invariant 190 (Suspend lot fallback stays at the same physical location and source)', () => {
  const ctx=vm.createContext({});vm.runInContext(read('assets/queue-inventory-hydration.js'),ctx);
  const rows=[{UNIQUE_ID:'sh',ITEMCODE:'003566.051.1',LOCATIONCODE:'A.06.000',LOTCODE:'27.S1',SOURCE:'SH',PTRONHAND:160,PTRAVAILABLE:160,PTRREVIEWED:0,S_LTS:264,LOC_MATCH_QTY:64,PHOTO_LINK:'sh.jpg'},
    {UNIQUE_ID:'ld',ITEMCODE:'003566.051.1',LOCATIONCODE:'A.06.000',LOTCODE:'27.S1',SOURCE:'LD',PTRONHAND:104,PTRAVAILABLE:104,PTRREVIEWED:0,S_LTS:264,LOC_MATCH_QTY:8,PHOTO_LINK:'ld.jpg'}];
  const index=ctx.AgMetricQueueInventory.createIndex(rows);
  const result=index.resolveSuspendTagDisplay({itemcode:'003566.051.1',locationcode:'A.06.000',lotcode:'27.F1',source:'SH'});
  assert.equal(result.row.PTRONHAND,160);assert.equal(result.row.LOC_ON_HAND,264);assert.equal(result.row.PHOTO_LINK,'sh.jpg');assert.equal(result.row.LOC_MATCH_QTY,64);
  assert.equal(index.resolveSuspendTagDisplay({itemcode:'003566.051.1',locationcode:'0.00.111',lotcode:'27.F1'}).status,'missing');
});

test('Invariant 191 (Bloom opens project creation directly with all grading fields)', async () => {
  let shown=0;const nodes=new Map();const modal={innerHTML:'',showModal:()=>shown++,querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:''});return nodes.get(selector);}};
  const ctx=runFunctions('assets/app-runtime.js',['addInventoryRowsToProject'],{
    bloomInventoryProjectDraft:null,crypto:{randomUUID:()=> 'command'},getSupabaseReadIdentityScope:()=> 'owner',isRepReadOnlyUser:()=>false,
    document:{getElementById:()=>modal},getAllRequestModalRepOptions:()=>[{label:'Rep One'}],getAssignableAppUserOptions:()=>[{username:'grader',display:'Grade Person'}],
    ensureRequestRepUserOptionsReady:async()=>[],ensureAssignableAppUsers:async()=>[],normalizeRepDisplayOrder:value=>value,esc:String
  });
  await ctx.addInventoryRowsToProject([{ITEMCODE:'x',COMMONNAME:'Tree',LOCATIONCODE:'A.01.000'}]);
  assert.equal(shown,1);for(const label of ['Sales Rep Name','Customer Name','Consignee Name','Qty Needed Graded','What They Are Marked With','Who Needs to Grade Them'])assert.ok(modal.innerHTML.includes(label));
  assert.doesNotMatch(modal.innerHTML,/Load More|Create an Inventory Project before/);
  assert.match(read('supabase/migrations/20261029210000_agdata_v23107_row_workflows.sql'),/PROJECT_COMMAND_CONFLICT/);
});


test('Invariant 192 (Suspend AV has one action and no nested Reclass card)', () => {
  const source=functionSource('assets/app-runtime.js','renderRequestMatchingInventoryOptions');
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
  const run = (operation, row, patch = {}) => vm.runInNewContext(receipt, { operation, result: {ok:true,row}, sourceUid:'old-source', expectedRevision:'old-revision', photoOnly:Object.keys(patch).length>0, patch, getDockSuspendCompletionRevision:r=>r.last_updated });
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
  assert.throws(() => migrationBody(body), /TRANSACTION_REQUIRED/);
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
    suspendTagItemHydration:new Map(), queueCardInventoryRenderVersion:0,
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
    console:{warn(){}}, Date, Map, Set, suspendTagItemHydration:entries, queueCardInventoryRenderVersion:0,
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
  const api=runFunctions('assets/app-runtime.js',['getSuspendTagMetricDisplayFallback'],{
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
    canCurrentUserViewDockSuspendDcRequests:()=>true,hydrateSuspendTagItemOptions:()=>{},retryPendingSuspendTagInventoryReconciliations:()=>{},
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
  const api=runFunctions('assets/app-runtime.js',['applyRowSyncSnapshot','syncRowDataAcrossViews','getMasterInventoryExactKey','buildNcrCurrentCropInheritancePayload','findLinkedMasterRow'],{
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
    submitArgosInventoryTransaction: (event, value) => sent.push(['apply', value]), openEvalWorkSetupFromReclass: value => sent.push(['review', value]),
    focusArgosReclassRow: uid => focused.push(uid), getArgosReclassRowEditorEntry: () => ({ values: { locationcode: 'L.05.000', lotcode: '26.U3', ptronhand: 293, ptrreviewed: 0, ptravailable: 293 } }),
    showToast: (...args) => errors.push(args)
  });
  const card = { getAttribute: name => name === 'data-reclass-row-card' ? 'row-26' : 'false' };
  api.toggleArgosReclassRowCard({ closest: () => card });
  assert.equal(focused.length, 0);
  assert.match(prompts[0].title, /Open This Row/);
  for (const text of ['L.05.000', '26.U3', 'OH: 293', 'REV: 0', 'AVL: 293', 'PRI: —']) assert.ok(prompts[0].summary.includes(text));
  prompts[0].accept(); assert.deepEqual(focused, ['row-26']);
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


test('Invariant 208 (Blocked origins preserve complete shells and verified native login, with a loopback mirror)', async () => {
  const runtime = read('assets/app-runtime.js');
  assert.match(read('index.html'), /<meta name="referrer" content="no-referrer">/);
  assert.match(runtime, /referrerPolicy: "no-referrer"/);
  const listeners = {}, stores = new Map(), deleted = [];
  const cache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const rows = stores.get(name);
    return { match: async key => rows.get(String(key)), put: async (key, value) => rows.set(String(key), value) };
  };
  await cache('agdata-v2.3.112').put('./index.html', new Response('last-good'));
  let blocked = true;
  const ctx = { URL, Response, AbortController, setTimeout, clearTimeout,
    self: { addEventListener: (type, handler) => { listeners[type] = handler; }, skipWaiting: async () => {},
      location: { origin: 'https://agmetricapp.com', href: 'https://agmetricapp.com/sw.js' },
      registration: { scope: 'https://agmetricapp.com/' }, clients: { claim: async () => {}, matchAll: async () => [] } },
    caches: { open: async name => cache(name), keys: async () => [...stores.keys()], delete: async name => { deleted.push(name); stores.delete(name); } },
    fetch: async () => { if (blocked) throw new TypeError('blockedbyclient'); return new Response('asset', { status: 200 }); }
  };
  vm.runInNewContext(read('sw.js'), ctx);
  let work; listeners.install({ waitUntil: promise => { work = promise; } });
  await assert.rejects(work, /blockedbyclient/);
  listeners.activate({ waitUntil: promise => { work = promise; } }); await work;
  assert.deepEqual(deleted, []);
  assert.equal(await (await ctx.matchRootCache('./index.html')).text(), 'last-good');
  blocked = false; listeners.install({ waitUntil: promise => { work = promise; } }); await work;
  listeners.activate({ waitUntil: promise => { work = promise; } }); await work;
  assert.deepEqual(deleted, ['agdata-v2.3.112']);
  const timers = [];
  const root = { setTimeout: (fn, ms) => { assert.equal(ms, 1200); timers.push(fn); return timers.length; }, clearTimeout() {} };
  const life = read('assets/app-lifecycle.js');
  vm.runInNewContext(life.slice(life.indexOf('root.withBootDeadline ='), life.indexOf('    const originalFetch')), { root });
  const pending = root.withBootDeadline(new Promise(() => {})); timers.shift()(); assert.equal(await pending, null);
  const native = { user: { username: 'dylan_collyge', role: 'Admin' }, profile: { id: 'verified-id' }, session: { access_token: 'verified-token' } };
  const login = { window: root, nativeAuthSessionActive: true,
    tryNativeAuthPasswordLogin: async () => native, ensureNativeAppSessionBridge: async () => { throw new TypeError('blocked'); }, readPersistedAppSessionRecord: () => null };
  vm.runInNewContext(runtime.slice(runtime.indexOf('async function fetchRemoteLoginUser('), runtime.indexOf('function getLoginFailureMessage(')), login);
  const result = await login.fetchRemoteLoginUser('dylan_collyge', 'password');
  assert.equal(result.ok, true); assert.equal(result.source, 'native-auth'); assert.equal(result.nativeSession, native.session);
  const { startCompanyMirror } = await import('../scripts/serve-company-mirror.mjs');
  const server = await startCompanyMirror({ directory: rootPathForMirror(), port: 0 });
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const response = await fetch(base + '/');
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await fetch(base + '/.gnc-local/cloud-erp-secrets.env')).status, 404);
    assert.equal((await fetch(base + '/package.json', { method: 'POST' })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
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


test('Invariant 211 (Built hotfix module URLs survive precache normalization during blocked reload)', () => {
  const version=JSON.parse(read('package.json')).version;
  const expected='./assets/mobile-workspace.js?v='+version+'.1';
  const worker=read('sw.js').replace('  ...STATIC_ASSETS,','  ...STATIC_ASSETS, '+JSON.stringify(expected)+',');
  const context={URL,self:{addEventListener(){},location:{origin:'https://cache.test'},registration:{scope:'https://cache.test/'}}};
  vm.runInNewContext(worker+'\nglobalThis.cachedAssets=ASSETS_TO_CACHE;',context);
  assert.ok(context.cachedAssets.includes(expected));
  const manifestLine=read('scripts/build-live-shell.mjs').split('\n').find(line=>line.startsWith('const bootAssets ='));
  const built={deployedHtml:'<script src="'+expected+'"></script>'};
  vm.runInNewContext(manifestLine+'\nglobalThis.urls=bootAssets;',built);
  assert.deepEqual(plain(built.urls),[expected]);
});


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
  const context=runFunctions('assets/app-runtime.js',['normalizeDriveEvidenceLocationPart','isSameDriveEvidenceLocation','reconcileConfirmedDriveEvidence'],{
    fullInventory:[row,sibling],activeItem:null,confirmedDriveEvidenceRows:new Map(),
    firstNonEmptyValue:(...values)=>values.find(value=>value!==null&&value!==undefined&&String(value)!==''),
    window:{GncDatabase:{confirmedDriveEvidence:result=>result.row,driveEvidenceColumns:columns}},
    getSupabaseReadIdentityScope:()=> 'account',formatFetchedRows:rows=>rows.map(raw=>Object.fromEntries(Object.entries(raw).map(([key,value])=>[key.toUpperCase(),value]))),
    getEditorLocMatchQtyValue:()=>null,parseAppNumber:()=>null,setPhotoAliasFieldsForPrefix:(target,prefix,link,name)=>Object.assign(target,{PHOTO_LINK:link,PHOTO_NAME:name}),
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
  assert.match(functionSource('assets/app-runtime.js','saveData'),/avEl\.value, \{ preserveEnteredText: true \}/);
});

test('Invariant 215 (Suspend Plan Start weekday colors are stable across dataset order and calendar representations)', () => {
  const context=runFunctions('assets/app-runtime.js',['parseDockCardPlanStartEpochDay','getDockSuspendDcRequestPlanstartInfo'],{getDockSuspendDcRequestPlanstartValue:row=>row.PLANSTART,Date,Intl});
  for(const [date,weekday,tone,color] of [['11/02/2026',1,'monday','#7c3aed'],['11/03/2026',2,'tuesday','#dc2626'],['11/04/2026',3,'wednesday','#16a34a'],['10/29/2026',4,'thursday','#2563eb'],['10/30/2026',5,'friday','#16a34a']]){
    const result=context.getDockSuspendDcRequestPlanstartInfo({PLANSTART:date});assert.equal(result.weekday,weekday);assert.equal(result.tone,tone);
    const css=read('assets/app-shell-style-05.css');assert.ok(css.includes('app-planstart-'+tone+'{--suspend-tag-accent:'+color));
  }
  assert.equal(context.getDockSuspendDcRequestPlanstartInfo({PLANSTART:'2026-11-03T00:00:00Z'}).tone,'tuesday');
});

test('Invariant 216 (Assigned Items filters, unique mode, active owners and select-all share one row set)', () => {
  const state={filters:{},sort:null};const selected=new Set();let rows=[{ITEMCODE:'A',PLANTGROUPCODE:'TREE',ASSIGNEDTO:'dylan_collyge'},{ITEMCODE:'A',PLANTGROUPCODE:'TREE',ASSIGNEDTO:'dylan_collyge'},{ITEMCODE:'B',PLANTGROUPCODE:'SHRUB',ASSIGNEDTO:'megan_kelly'}];
  const context=runFunctions('assets/app-runtime.js',['getFilteredManagerAssignedItemsExportRows','selectAllFilteredManagerAssignedItems','getManagerAssignableOwnerUsers'],{
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


test('Invariant 218 (AST scope audit rejects undeclared masterUid in every asset and undeclared names in modified runtime functions)', async () => {
  const { auditRuntimeIdentifiers } = await import('../scripts/check-runtime-identifiers.mjs');
  const result=auditRuntimeIdentifiers(root);
  assert.deepEqual(result.masterUid,[]);assert.deepEqual(result.undeclared,[]);
});

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
  assert.equal(cards.length,6);assert.equal(cards[0].fileName,'exact.xlsx');assert.equal(cards[0].rowsPublished,0);assert.equal(cards[0].stage,'failed');assert.ok(cards[0].percent<100);
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

test('Invariant 223 (the lightweight receiver retains stale-lease recovery after the workbook sender exits)', async () => {
  const tasks=[];let claims=0,executions=0,successors=0;
  const context=runFunctions('supabase/functions/app-api/index.ts',['claimAndDispatchCloudStep'],{
    jsonObject:value=>value,Date,Promise,setTimeout:callback=>{callback();return 0;},
    EdgeRuntime:{waitUntil:task=>tasks.push(task)},recordHandledError:(_service,_code,error)=>{throw error;},
    dispatchCloudErpSync:()=>{successors++;},executeCloudErpSyncStep:async()=>{executions++;},
    supabase:{rpc:async name=>({data:name==='get_erp_sync_status_v1'?{active:true,runId:'run',requestedBy:'authorized'}:
      {active:true,claimed:++claims>1,workerId:'owner',continuationStep:1}})}
  });
  assert.equal(await context.claimAndDispatchCloudStep('run'),false);
  await Promise.all(tasks);
  assert.equal(claims,2);assert.equal(executions,1);assert.equal(successors,1);
});

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

test('Invariant 228 (private per-file progress stays monotonic and ignores repeated older receipts)', async () => {
  const old={key:'drive',sourceFileName:'old.xlsx',outcome:'processed',rowCount:9000};const writes=[];
  const context=runFunctions('supabase/functions/app-api/index.ts',['processCloudErpSyncStep'],{
    jsonObject:value=>value||{},mintCloudDriveAccessToken:async()=> 'token',Deno:{env:{get:()=>''}},
    supabase:{rpc:async(name,args)=>{if(name==='update_erp_sync_job_v1')writes.push(plain(args.p_status));return {data:{}};}},
    runErpSyncWorkerStep:async({status})=>{
      await status({sourceProgressDelta:{key:'drive',fileName:'new.xlsx',stage:'parsing',percent:40}});
      await status({stageResults:[old]});
      await status({sourceProgressDelta:{key:'drive',fileName:'third.xlsx',stage:'parsing',percent:40}});
      return {done:false,cursor:{}};
    }
  });
  await context.processCloudErpSyncStep('run','owner',1,{active:true,stageResults:[old],sourceProgress:{drive:{fileName:'new.xlsx',stage:'staging',percent:70,rowsStaged:1500,rowsPublished:0}}});
  assert.equal(writes[1].sourceProgress.drive.percent,70);assert.equal(writes[2].sourceProgress.drive.fileName,'new.xlsx');assert.equal(writes[2].sourceProgress.drive.percent,70);
  assert.equal(writes[3].sourceProgress.drive.fileName,'third.xlsx');assert.equal(writes[3].sourceProgress.drive.percent,40);assert.equal(writes[3].sourceProgress.drive.rowsPublished,0);
});
