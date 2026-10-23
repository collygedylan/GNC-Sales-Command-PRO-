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
  const context = runFunctions('supabase/functions/app-api/index.ts', ['jsonResponse', 'transientOkResponse', 'failOpenInventoryConflict'], {
    Response, corsHeaders: {}, JSON,
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

test('Invariant 3 (Season Photo Persistence Across DriveAround Imports)', () => {
  const context = runFunctions('assets/app-runtime.js', ['normalizeDriveEvidenceLocationPart', 'isSameDriveEvidenceLocation'], {
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
  });
  assert.equal(context.isSameDriveEvidenceLocation(
    { ITEMCODE: '001884.011.1', LOCATIONCODE: 'E.10.000', LOTCODE: '27.S1', UNIQUE_ID: 'old' },
    { itemcode: '001884.011.1', locationcode: 'e.10.000', lotcode: '27.F1', unique_id: 'new' },
  ), true);
  const migration = read('supabase/migrations/20261023220000_drive_location_evidence_and_request_reconciliation_v1.sql');
  for (const field of ['photo_link', 'date_completed', 'spec', 'match', 'loc_match_qty', 'av_note', 'pic_note', 'sales_note']) assert.match(migration, new RegExp(`\\b${field}\\b`));
  assert.match(migration, /primary key\(itemcode_key,locationcode_key\)/);
  assert.match(migration, /inventory_location_match_qty_v1\(m\.ptronhand,evidence\.match,evidence\.loc_match_qty\)/);
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
    isRequestPendingVisible: () => true, isRegularRequestQueueItem: () => true,
    naturalCompare: (left, right) => String(left || '').localeCompare(String(right || ''), undefined, { numeric: true, sensitivity: 'base' }),
    getItemUniqueId: row => row.id, buildRequestPagedRenderPlan: (_mode, _crumb, items) => ({ rows: items }),
  });
  vm.runInContext(functionSource('assets/app-runtime.js', 'compareLocationCodeValues') + '\n' + functionSource('assets/app-runtime.js', 'buildPendingRequestRenderPlan'), context);
  const plan = context.buildPendingRequestRenderPlan([
    { id: 'c12', LOCATIONCODE: 'C.12.019', LOTCODE: '27.F1' },
    { id: 'c2', LOCATIONCODE: 'C.2.000', LOTCODE: '27.S1' },
    { id: 'c5', LOCATIONCODE: 'C.05.000', LOTCODE: '27.U1' },
  ]);
  assert.deepEqual(Array.from(plan.rows, row => row.id), ['c2', 'c5', 'c12']);
  assert.match(functionSource('assets/app-runtime.js', 'forceRefreshRequestsForView'), /force_fresh: true, cache: 'no-store'/);
  assert.match(functionSource('assets/app-runtime.js', 'fetchAllSupabaseRows'), /forceFresh[^]*:fresh:/);
  assert.match(read('supabase/migrations/20261023220000_drive_location_evidence_and_request_reconciliation_v1.sql'), /ph_request_delivery_outbox[^]*event_type='request_created'[^]*insert into public\.ph_active_request/);
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
  assert.equal(context.getHomeDesktopColumnCount(12), 6);
  assert.match(read('assets/ops-precision-pilot.css'), /grid-template-rows:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
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
  const window = { __APP_RELEASE_VERSION__: 'AgData v2.3.55', activeHomeTab: '',
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
    assert.equal(event.app_version, 'AgData v2.3.55');
    const skillPath = path.join(root, '.codex', 'skills', event.owning_skill, 'SKILL.md');
    assert.equal(readFileSync(skillPath, 'utf8').length > 0, true);
    const domain = index.domains[event.owning_skill];
    assert.ok(domain);
    assert.equal(Object.values(domain).flatMap(value => Array.isArray(value) ? value : []).includes(symbol), true, `${event.owning_skill}:${symbol}`);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal([...storage.values()].some(value => String(value).includes('AgData v2.3.54')), false);
  assert.equal(reports.every(event => event.app_version === 'AgData v2.3.55'), true);
});
