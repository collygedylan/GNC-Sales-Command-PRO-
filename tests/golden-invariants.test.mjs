import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

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

test('Invariant 8 (Que REQUEST Live Uncached Fetch & Outbox Reconciliation)', () => {
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
});

test('Invariant 9 (Recount Tab locationcode Grouping & Completion Email)', () => {
  const context = runFunctions('assets/app-runtime.js', ['buildReclassRecountLocationGroups'], { Array, Number, String });
  const groups = plain(context.buildReclassRecountLocationGroups([{
    id: 'job', itemcode: '006737.070.1', commonname: 'Test Plant', locationcode: 'A.05.000', requested_by_username: 'requester',
    lines: [
      { source_unique_id: 's1', lotcode: '27.S1', season: 'S1', on_hand: 5, available: 4, review: 1 },
      { source_unique_id: 'u1', lotcode: '27.U1', season: 'U1', on_hand: 5, available: 3, review: 2 },
    ],
  }]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].locationcode, 'A.05.000');
  assert.equal(groups[0].system_on_hand, 10);
  assert.deepEqual(groups[0].lines.map(line => [line.lotcode, line.on_hand, line.available, line.review]), [['27.S1', 5, 4, 1], ['27.U1', 5, 3, 2]]);
  assert.match(functionSource('Code.gs', 'handleSignedReclassRecountCompletion_'), /On Hand[^]*Available[^]*Review[^]*countedTotal/);
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
  const context = runFunctions('Code.gs', ['buildReclassItemInquiryTable_'], { sortReclassInquiryCompactRows_: rows => rows });
  const table = plain(context.buildReclassItemInquiryTable_({ identity: { commonname: 'Green Velvet Boxwood' }, rows: [{ unique_id: 'source', values: { lotcode: '27.S1', locationcode: 'A.03.000', source: 'BR', ptronhand: '275' }, actionValues: {}, changedFields: [] }], completedMoveSummary: [{ direction: 'move_up', quantity: 55, source: { unique_id: 'source' }, destination: { season: 'F1' } }] }));
  assert.deepEqual(table.columns.map(column => column[1]), ['Lotcode', 'Location', 'SOURCE', 'Priority', 'OH', 'PTRREVIEWED', 'Loc Note Date', 'LOCATIONPTN1', 'Location Note']);
  assert.equal(table.rows[0][4].text, '330');
  assert.deepEqual(table.rows[0][4].proposals, ['UP 55 TO F1']);
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
  const migration = read('supabase/migrations/20261024060000_request_queue_pending_reconciliation_v3.sql');
  const runtime = read('assets/app-runtime.js');
  assert.match(api, /Promise\.resolve\(supabase\.rpc\("reconcile_active_requests_from_outbox_v1"\)\)[^]*runtime\.waitUntil\(reconciliationTask\)/);
  assert.doesNotMatch(api, /await supabase\.rpc\("reconcile_active_requests_from_outbox_v1"\)/);
  assert.doesNotMatch(migration, /order by o\.created_at desc,o\.event_id desc[^]*limit 100/);
  assert.match(migration, /jsonb_array_elements[^]*regexp_matches[^]*insert into public\.ph_active_request/);
  assert.match(migration, /request_source[^]*customeridentityid[^]*consigneeidentityid/);
  assert.match(migration, /perform private\.upsert_request_history[^]*delete from public\.ph_active_request[^]*reconcile_active_requests_from_outbox_v1/);
  assert.match(runtime, /syncPanel\.open = window\.innerWidth >= 768/);
  assert.match(runtime, /syncPanel\.dataset\.viewportDefaultApplied = 'true'/);
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

test('Invariant 20 (Dylan-Only Full-Table Request Sales Dollar Impact)', async () => {
  const impact = await import(new URL('../assets/request-sales-impact.js', import.meta.url));
  const rows = [
    { folder_id: 'REQ-A', itemcode: 'ITEM-1', locationcode: 'A.01', lotcode: 'L1', qty: 10, list_price: 100,
      status: 'Pending', sales_rep: 'Rep One', customer_name: 'Customer One', consignee_name: 'Consignee One' },
    { folder_id: 'REQ-A', itemcode: 'ITEM-1', locationcode: 'A.01', lotcode: 'L1', qty: 10, list_price: 100,
      status: 'Completed', sales_rep: 'Rep One', customer_name: 'Customer One', consignee_name: 'Consignee One' },
    { folder_id: 'REQ-B', itemcode: 'ITEM-2', locationcode: 'B.02', lotcode: 'L2', qty: null, list_price: 8.75,
      status: 'Pending', sales_rep: 'Rep One', customer_name: 'Customer One', consignee_name: 'Consignee One' },
    { folder_id: 'REQ-B', itemcode: 'ITEM-2', locationcode: 'B.02', lotcode: 'L2', qty: 0, list_price: 8.75,
      status: 'Completed', sales_rep: 'Rep One', customer_name: 'Customer One', consignee_name: 'Consignee One' },
  ];
  const result = impact.aggregateRequestSalesImpactLines(rows);
  assert.equal(result.summary.total_line_items, 2);
  assert.equal(result.summary.total_requests, 2);
  assert.equal(result.summary.total_units_requested, 35);
  assert.equal(result.summary.explicit_qty_line_count, 1);
  assert.equal(result.summary.default_25_qty_line_count, 1);
  assert.equal(result.summary.total_dollar_value, 1218.75);
  assert.equal(result.summary.completed_dollar_value, 1218.75);
  assert.equal(result.by_sales_rep[0].total_dollar_value, 1218.75);
  assert.equal(result.by_customer_consignee[0].items.find(item => item.itemcode === 'ITEM-1').line_dollar_value, 1000);
  assert.equal(result.by_customer_consignee[0].items.find(item => item.itemcode === 'ITEM-2').line_dollar_value, 218.75);

  const preserved = impact.aggregateRequestSalesImpactLines([
    { unique_id: 'UID-SHARED', source_row_id: 'ph_request_history:1', folder_id: 'REQ-SAME', itemcode: 'ITEM-3',
      locationcode: 'C.01', lotcode: 'L3', row_index: 1, qty: 2, list_price: 10, status: 'Pending' },
    { unique_id: 'UID-SHARED', source_row_id: 'ph_active_request:9', folder_id: 'REQ-SAME', itemcode: 'ITEM-3',
      locationcode: 'C.01', lotcode: 'L3', row_index: 1, qty: 2, list_price: 10, status: 'Completed' },
    { unique_id: 'UID-SEPARATE', source_row_id: 'ph_request_history:2', folder_id: 'REQ-SAME', itemcode: 'ITEM-3',
      locationcode: 'C.01', lotcode: 'L3', row_index: 1, qty: 3, list_price: 10, status: 'Completed' },
    { source_row_id: 'ph_request_history:3', folder_id: '', request_date: '2026-01-01', itemcode: 'ITEM-4',
      locationcode: '', lotcode: '', row_index: 1, qty: 1, list_price: 5, status: 'Completed' },
    { source_row_id: 'ph_request_history:4', folder_id: '', request_date: '2026-02-01', itemcode: 'ITEM-4',
      locationcode: '', lotcode: '', row_index: 1, qty: 1, list_price: 5, status: 'Completed' },
    { folder_id: 'REQ-MULTI', itemcode: 'ITEM-5', locationcode: 'D.01', lotcode: 'L5', row_index: 1,
      qty: 1, list_price: 7, status: 'Pending' },
    { folder_id: 'REQ-MULTI', itemcode: 'ITEM-5', locationcode: 'D.01', lotcode: 'L5', row_index: 1,
      qty: 1, list_price: 7, status: 'Completed' },
    { folder_id: 'REQ-MULTI', itemcode: 'ITEM-5', locationcode: 'D.01', lotcode: 'L5', row_index: 2,
      qty: 1, list_price: 7, status: 'Completed' },
  ]);
  assert.equal(preserved.summary.total_line_items, 6);
  assert.equal(preserved.line_items.filter(item => item.folder_id === 'REQ-SAME').length, 2);
  assert.equal(preserved.line_items.filter(item => item.folder_id.startsWith('ph_request_history:')).length, 2);
  assert.equal(preserved.line_items.filter(item => item.folder_id === 'REQ-MULTI').length, 2);
  assert.equal(preserved.line_items.find(item => item.unique_id === 'UID-SHARED').status, 'Completed');

  const migration = read('supabase/migrations/20261024023000_request_sales_impact_strict_dedupe_v3.sql');
  const api = functionSource('supabase/functions/app-api/index.ts', 'handleRequestSalesImpactAction');
  const databaseTypes = read('supabase/functions/_shared/database.types.ts');
  const databaseContracts = read('services/database-contracts.generated.ts');
  const runtime = read('assets/app-runtime.js');
  const moduleSource = read('assets/request-sales-impact.js');
  for (const marker of ['ph_active_request', 'ph_request_history', 'ph_request_delivery_outbox',
    'jsonb_array_elements', 'with ordinality', "regexp_matches(event.html,'<tr[^>]*>(.*?)</tr>','gis')",
    'line_identity_key', 'source_row_id', 'request_day', 'catalog_by_size', 'source_table_audit',
    'strict_9_field_cross_table_v1', 'strict_business_key', 'source_copy_ordinal',
    'exact_9_field_cross_table_mirrors_merged', 'outbox_event_types', 'ph_request_email_threads',
    'ph_master_inventory', 'ph_view_av_hot_price', 'ph_cav_import']) assert.ok(migration.replaceAll(' ', '').includes(marker.replaceAll(' ', '')), marker);
  assert.match(migration, /set statement_timeout='60s'/);
  assert.doesNotMatch(migration, /\blimit\b/i);
  assert.doesNotMatch(migration, /\.select\s*\(/);
  assert.match(migration, /revoke all on function public\.get_request_sales_impact_v2\(\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.get_request_sales_impact_v2\(\) to service_role/);
  assert.match(api, /username\s*!==\s*"dylan_collyge"[^]*enabled:\s*false[^]*visible:\s*false[^]*rows:\s*\[\]/);
  assert.match(api, /supabase\.rpc\("get_request_sales_impact_v2"\)/);
  assert.match(databaseTypes, /get_request_sales_impact_v2:\s*\{ Args: never; Returns: Json \}/);
  assert.match(databaseContracts, /"get_request_sales_impact_v2":\s*\{[^]*?"json"/);
  assert.match(moduleSource, /Source Table & Row Audit/);
  assert.match(moduleSource, /payload\.source_table_audit \|\| payload\.source_audit/);
  assert.match(moduleSource, /exact 9-field mirrors merged/);
  assert.match(api, /REQUEST_SALES_IMPACT_CONTRACT_STALE/);
  assert.match(runtime, /function isRequestSalesImpactOwner\(\)[^]*dylan_collyge/);
  assert.match(runtime, /document\.getElementById\('view-request-sales-impact'\)\?\.remove\(\)/);
  assert.doesNotMatch(read('index.html'), /id="view-request-sales-impact"|drawer-request-sales-impact-btn/);
});

test('Invariant 21 (Strict Nine-Field Cross-Table Request Deduplication)', async () => {
  const impact = await import(new URL('../assets/request-sales-impact.js', import.meta.url));
  const shared = {
    unique_id: 'STRICT-SHARED', folder_id: 'REQ-SHARED', itemcode: 'ITEM-9', contsize: '#5',
    locationcode: 'Z.09', lotcode: 'LOT-9', request_date: '2026-10-20T15:00:00Z',
    sales_rep: 'Rep One', customer_name: 'Customer One', consignee_name: 'Consignee One', qty: 2, list_price: 10,
  };
  const result = impact.aggregateRequestSalesImpactLines([
    { ...shared, source_row_id: 'ph_request_history:1', status: 'Completed' },
    { ...shared, source_row_id: 'ph_active_request:1', status: 'Pending' },
    { ...shared, source_row_id: 'ph_request_history:2', status: 'Completed' },
    { ...shared, source_row_id: 'ph_request_history:3', request_date: '2026-10-21T15:00:00Z' },
    { ...shared, source_row_id: 'ph_request_history:4', sales_rep: 'Rep Two' },
    { ...shared, source_row_id: 'ph_request_history:5', customer_name: 'Customer Two' },
    { ...shared, source_row_id: 'ph_request_history:6', consignee_name: 'Consignee Two' },
    { ...shared, source_row_id: 'ph_request_history:7', qty: 3 },
  ]);
  assert.equal(result.summary.total_line_items, 7);
  assert.equal(result.summary.total_dollar_value, 150);
  assert.equal(result.line_items.filter(row => row.source_row_id === 'ph_request_history:1').length, 1);
  assert.equal(result.line_items.some(row => row.sales_rep === 'Rep Two'), true);
  assert.equal(result.line_items.some(row => row.customer_name === 'Customer Two'), true);
  assert.equal(result.line_items.some(row => row.consignee_name === 'Consignee Two'), true);
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
  const pending = { UNIQUE_ID:'pending-1', REQ_STATUS:'Pending', DATE_COMPLETED:null, REQ_QTY:'', LOCATIONCODE:'D.09.013', LOTCODE:'27.F1' };
  assert.equal(queue.isRequestPendingVisible(pending), true);
  assert.equal(queue.buildPendingRequestRenderPlan([pending]).rows.length > 0, true);

  const migration = read('supabase/migrations/20261024070000_escaped_display_text_normalization_v1.sql');
  for (const marker of ['normalize_escaped_display_text_v1', 'a000_normalize_escaped_display_text_v1',
    'ph_master_inventory', 'ph_active_request', 'ph_request_history', 'ph_soc_master', 'ph_reserves', 'ph_cav_import']) assert.match(migration, new RegExp(marker));
  assert.match(read('supabase/migrations/20261024023000_request_sales_impact_strict_dedupe_v3.sql'), /strict_9_field_cross_table_v1/);
  assert.match(read('supabase/functions/app-api/index.ts'), /\["request_queue", "active_request"\]\.includes\(dataset\)\) query\.set\("date_completed", "is\.null"\)/);
});
