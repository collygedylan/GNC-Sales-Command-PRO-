import assert from 'node:assert/strict';
import vm from 'node:vm';
import {read,functionSource,runFunctions} from './golden-test-environment.mjs';

export function invariant12() {
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
    hasExplicitLogoutMarker: () => false, hasConfirmedCurrentAccountRevocation: () => false,
  });
  vm.runInContext(read('assets/navigation-visibility.js') + '\n' + runtime.slice(start, end)
    + '\n' + functionSource('assets/app-runtime.js', 'getHomeDesktopColumnCount'), context);
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
}

export async function invariant13() {
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
  assert.match(functionSource('assets/app-runtime.js', 'switchView'), /preparePrimaryNavigationTarget\(context\)/);
  assert.match(functionSource('assets/app-runtime.js', 'preparePrimaryNavigationTarget'), /smart-moves[^]*warmSalesIntelligenceData/);
}

export async function invariant17() {
  const api = read('supabase/functions/app-api/index.ts');
  const migration = read('supabase/migrations/20261025003000_agdata_v2361_surgical_restore.sql');
  const canonicalMigration = read('supabase/migrations/20261025013000_agdata_v2362_canonical_requests.sql');
  const uniformMigration = read('supabase/migrations/20261025023000_agdata_v2363_uniform_active_history_architecture.sql');
  const runtime = read('assets/app-runtime.js');
  assert.match(api, /queueRequestOutboxReconciliation\(\(\) => supabase\.rpc\("reconcile_active_requests_from_outbox_v1"\)/, 'The queue delegates recovery to its non-blocking owner');
  let pending;
  let reconciled = false;
  const deferred = runFunctions('supabase/functions/app-api/request-queue-delivery.ts', ['queueRequestOutboxReconciliation'], {
    EdgeRuntime: { waitUntil: task => { pending = task; } }, console,
  });
  deferred.queueRequestOutboxReconciliation(() => { reconciled = true; return Promise.resolve({ error: null }); });
  assert.equal(reconciled, false);
  await pending;
  assert.equal(reconciled, true);
  assert.doesNotMatch(api, /await supabase\.rpc\("reconcile_active_requests_from_outbox_v1"\)/);
  assert.match(migration, /scope','recent-outbox-cutoff-v2361/);
  assert.match(migration, /jsonb_array_elements[^]*insert into public\.ph_active_request/);
  assert.match(migration, /request_source[^]*customeridentityid[^]*consigneeidentityid/);
  assert.match(migration, /perform private\.upsert_request_history[^]*pending_recovered/);
  assert.match(runtime, /fetchAllSupabaseRows\(ACTIVE_REQUEST_TABLE, query, readOptions\)/);
  assert.match(runtime, /fetchActiveRequestLiveRows:canonicalPending/);
  assert.match(runtime, /homeSyncMetadata:\$\{table\}[^]*retained:\s*true/);
  assert.match(runtime, /\['DRIVE', 'CAV', 'RESERVES', 'SOC'\]\.map/);
  assert.match(runtime, /\['ph_master_inventory', 'ph_soc_master', 'ph_reserves', 'ph_cav_import', 'hl_po_parsed'\]/, 'Home revision checks include all five operational datasets');
  const panel = functionSource('assets/app-runtime.js', 'bindErpHomeStatusPanel');
  assert.match(panel, /panel\.open = true/);
  assert.match(panel, /panel\.dataset\.viewportDefaultApplied = 'true'/);
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
}

export function invariant33() {
  const runtime = read('assets/app-runtime.js');
  const directSet = runtime.match(/const DIRECT_POSTGREST_READ_TABLES = new Set\(\[[^]*?\]\);/)?.[0] || '';
  const context = vm.createContext({ normalizeAppTableName: value => String(value || '').trim().toLowerCase() });
  vm.runInContext(`${directSet}\n${functionSource('assets/app-runtime.js', 'isDirectPostgrestReadTable')}`, context);
  assert.equal(context.isDirectPostgrestReadTable('ph_active_suspend'), true);
  assert.match(runtime, /suspendTag:\s*\{\s*table:\s*'ph_active_suspend',\s*sourceTable:\s*'ph_soc_master'/);
  const refreshSource = functionSource('assets/app-runtime.js', 'refreshActiveRequestQueueSideData');
  assert.match(refreshSource, /requestQueueSideRefreshPending\s*=\s*\{/);
  assert.match(refreshSource, /refreshActiveRequestQueueSideData\(pending\.reason, pending\.options\)/);
  assert.match(functionSource('assets/app-runtime.js', 'setReqTab'), /scheduleQueCategoryRefresh/);
  assert.match(functionSource('assets/app-runtime.js', 'scheduleQueCategoryRefresh'), /suspend-tag[^]*refreshQueSuspendCategory/);
  const suspend = functionSource('assets/app-runtime.js', 'refreshQueSuspendCategory');
  assert.match(suspend, /key: 'suspendTag', mode: 'full'[^]*key: 'soc', mode: 'full'/);
  assert.match(suspend, /isCurrentNavigationTransition\(navigationSeq, 'request'\)/);
  assert.match(read('.codex/skills/agdata-queue-and-reclass-specialist/SKILL.md'), /Never render `Que -> SUSPEND` from a synthetic API dataset/);
}
