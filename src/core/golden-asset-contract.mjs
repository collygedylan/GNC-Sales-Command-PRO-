import assert from 'node:assert/strict';
import vm from 'node:vm';

export function invariant97({read}) {
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
  assert.match(read('scripts/build-live-shell.mjs'), /runtime\.src = '\.\/assets\/\$\{runtimeName\}\?v=\$\{ASSET_QUERY_OVERRIDES\[runtimeName\] \|\| RELEASE_QUERY\}'/);
  assert.match(entry, /const ready = \(\) => \{ refreshAssignedItemLookups\(\); scheduleHydratedViewRender\('managers'\); \}/);
  assert.match(entry, /preserveRequestedMode: true[\s\S]*\.then\(ready\)/);
  assert.ok(read('index.html').includes(`app-runtime.js?v=${JSON.parse(read('version.json')).version}`));
}

export function invariant115({read, functionSource}) {
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
  assert.match(read('sw.js'), /APP_SHELL_RUNTIME_REVISION = 'cloud-relay-cache-r2'/);
  const version = JSON.parse(read('version.json')).version;
  assert.ok(read('index.html').includes(`photo-history-v2026090401.js?v=${version}`));
  assert.ok(read('index.html').includes(`app-runtime.js?v=${version}`));
  assert.match(build, /ASSET_QUERY_OVERRIDES = Object\.freeze\(\{\}\)/);
}

export function invariant124({read, functionSource, runFunctions}) {
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
  assert.match(read('scripts/build-live-shell.mjs'), /live-app-styles-base-v2026090503\.css\?v=\$\{ASSET_QUERY_OVERRIDES\['live-app-styles-base-v2026090503\.css'\] \|\| RELEASE_QUERY\}/);
  assert.match(entry, /ensureDatasetLoaded\('master', 'full', \{ preserveRequestedMode: true \}\)/);
  assert.doesNotMatch(panel, /ensureDatasetLoaded|loadManagerItemcodeDefaultOwners|ensureEvalAssignableUsers/);
  assert.match(runtime.slice(runtime.indexOf('async function ensureDatasetLoaded'), runtime.indexOf('function queueDatasetLoad')),
    /await getProductionLiveSyncCoordinator\(\)\.ensure\(adapter, !!options\.force\)/);
  const version = JSON.parse(read('version.json')).version;
  assert.ok(read('index.html').includes(`inventory-list-contract.js?v=${version}`));
  assert.ok(read('index.html').includes(`app-shell-style-05.css?v=${version}`));
  assert.match(read('scripts/build-live-shell.mjs'), /ASSET_QUERY_OVERRIDES = Object\.freeze\(\{\}\)/);
}
