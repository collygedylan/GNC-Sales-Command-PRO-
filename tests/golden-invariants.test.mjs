import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { databaseBridge } from './helpers/database-bridge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceCache = new Map();
const syntaxCache = new Map();

function read(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, readFileSync(path.join(root, file), 'utf8'));
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
  let match = null;
  const visit = node => {
    if (!match && ts.isFunctionDeclaration(node) && node.name?.text === name) match = node;
    if (!match) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
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
  assert.match(runtime, /syncPanel\.open = window\.innerWidth >= 768/);
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
  assert.doesNotMatch(functionSource('assets/app-runtime.js', 'normalizeRequestRepUserOption'), /isRequestRepRoleValue/);
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
  assert.match(read('assets/app-runtime.js'), /type: 'manual_run'[^]*fast: true/);
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
  assert.match(appApi, /const APP_RUNTIME_RELEASE = "AgData v2\.3\.89"/);
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
  assert.match(worker, /navigateClientToForcedUpgrade[^]*forceupgrade[^]*APP_ASSET_VERSION/);
  assert.match(appApi, /APP_RUNTIME_VERSION = "2\.3\.89"/);
  assert.match(appApi, /"X-AgData-App-Version": APP_RUNTIME_VERSION/);
  assert.match(appApi, /const appVersion = "2\.3\.89"[^]*app_version: appVersion/);
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
  const ctx = runFunctions('assets/app-runtime.js', ['normalizeRequestCardMetrics', 'buildQueueInventoryMetricsHtml'], {
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
  const context = runFunctions('assets/app-runtime.js', ['normalizeRequestCardMetrics', 'buildQueueInventoryMetricsHtml'], {
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
  const unavailableContext = runFunctions('assets/app-runtime.js', ['normalizeRequestCardMetrics', 'buildQueueInventoryMetricsHtml'], {
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

  const frontend = runFunctions('assets/app-runtime.js', ['normalizeRequestCardMetrics', 'buildQueueInventoryMetricsHtml'], {
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
    assert.equal(frontend.buildQueueInventoryMetricsHtml({ ...falseBlock, suspend_tag_metrics: exact }), '',
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
    window: { get innerWidth() { return width; }, googleScriptRunInFlight: false },
    document: { getElementById: id => id === 'run-google-script-btn' ? button : id === 'dashboard-sync-accordion' ? panel : null },
    canRunManualInventoryImport: () => false,
    canViewDashboardSyncStatus: () => true,
    hasActiveManualSync: () => false,
    getManualSyncProgressInfo: () => ({ text: '' }),
    isAutoManualSyncStatus: () => false
  });
  context.syncGoogleScriptButton();
  assert.equal(panel.open, false, 'mobile initialization collapses the imported-file disclosure');
  width = 1024;
  context.syncGoogleScriptButton();
  assert.equal(panel.open, true, 'desktop initialization retains the expanded disclosure default');
  width = 390;
  context.syncGoogleScriptButton();
  assert.equal(panel.open, false, 'crossing into mobile reapplies the collapsed default');
  summary.onClick({ isTrusted: true });
  panel.open = true;
  context.syncGoogleScriptButton();
  width = 1024;
  context.syncGoogleScriptButton();
  assert.equal(panel.open, true, 'a user-selected disclosure state is preserved across viewport changes');
});

test('Invariant 66 (JD Uses a Complete App-Wide Request Directory With a Valid N/A Pair)', () => {
  const runtime = runFunctions('assets/app-runtime.js', [
    'normalizeRepMatchToken', 'normalizeRepDisplayOrder', 'isUniversalRequestDirectoryRep'
  ]);
  assert.equal(runtime.isUniversalRequestDirectoryRep('JD Jones'), true);
  assert.equal(runtime.isUniversalRequestDirectoryRep('jd_jones'), true);
  assert.equal(runtime.isUniversalRequestDirectoryRep('VP of Sales'), true);
  assert.equal(runtime.isUniversalRequestDirectoryRep('Rep One'), false);

  const app = read('assets/app-runtime.js');
  assert.match(app, /JD_EXECUTIVE_SALESREP_ID\s*=\s*'AGDATA_EXECUTIVE_ALL'/);
  assert.match(app, /getRequestUniversalCustomerOptions\([^]*customerRepMapRows[^]*socInventory[^]*reservesInventory[^]*requestsInventory[^]*requestHistoryInventory/);
  assert.match(app, /buildRequestModalNaCustomerOption\(JD_EXECUTIVE_SALESREP_ID\)/,
    'the executive directory always starts with the authorized N/A tuple');
  assert.match(app, /String\(currentUser \|\| ''\)[^]*=== 'jd_jones'[^]*resolveCanonicalRequestRepName\('JD Jones'\)/,
    'JD defaults the request rep selection to himself');

  const edge = read('supabase/functions/app-api/index.ts');
  assert.match(edge, /request\.operation === "options"[^]*JD_EXECUTIVE_SALESREP_ID[^]*request_jd_customer_directory_v1/);
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
  assert.match(runtime, /gnc_dylan_last_toasted_revisions_v1[^]*username !== 'dylan_collyge'/);
  assert.match(registry, /homeSyncMetadata:\s*\[[^\]]*hl_po_parsed/);
  assert.match(bunch, /normalizeBunchNoteLocationKey[^]*gnc_bunch_note_drafts_v1[^]*Saved Drafts \/ Active Bunch Notes/);
  assert.match(bunch, /function reset\(\) \{ persistLocalDraft\(\)/);
});

test('Invariant 78 (Manager Shell Enhancement Preserves Every Submodule Deep Link)', () => {
  const workspace = read('assets/mobile-workspace.js');
  assert.match(read('index.html'), /mobile-workspace\.js\?v=2\.3\.89\.1/);
  assert.match(workspace, /view==='managers'[^]*includes\('setHomeTab\('\)[^]*button\.dataset\.moduleTileId/);
  assert.match(workspace, /byTarget\.get\(targetKey\)[^]*byTarget\.set\(targetKey,keep\)/);
  assert.match(read('.codex/skills/agdata-app-shell-and-navigation/SKILL.md'), /Never deduplicate manager module cards only by their shared `managers` route/);
});
