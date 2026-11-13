import assert from 'node:assert/strict';
import vm from 'node:vm';
import { indexReleaseDeclarations } from './release-gems-declarations.mjs';

export async function invariant97({read}) {
  await assertAssignedItemsWarehouseHydration(read);
  const load = indexReleaseDeclarations(read('assets/dataset-load-runtime.js'));
  assert.match(load('ensureDatasetLoaded'), /if \(!options\.bypassLiveSyncCoordinator\)[\s\S]*typeof canUseProductionLiveSync/);
  assert.match(load('runDatasetLoadWithRetry'), /maxRetries = options\.retryOnCancellation === true \? 4 : 0[\s\S]*getSupabaseReadErrorCode\(error\) !== 'REQUEST_ABORTED'/);
  const runtime = indexReleaseDeclarations(read('assets/app-runtime.js'));
  assert.doesNotMatch(runtime('setRealtimeSubscriptionsForView'), /options\.bypassLiveSyncCoordinator/);
  assert.match(read('scripts/build-live-shell.mjs'), /runtime\.src = '\.\/assets\/\$\{runtimeName\}\?v=\$\{ASSET_QUERY_OVERRIDES\[runtimeName\] \|\| RELEASE_QUERY\}'/);
  assert.ok(read('index.html').includes(`app-runtime.js?v=${JSON.parse(read('version.json')).version}`));
}

async function assertAssignedItemsWarehouseHydration(read) {
  const calls = [], renders = [];
  let refreshes = 0;
  const view = 'assigned';
  const context = vm.createContext({activeHomeTab:view,MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW:view,
    warehouseAssignedItemsInventory:[],canViewAssignedItemsExport:()=>true,getManagerAssignedColumnState:()=>({}),
    refreshAssignedItemLookups:()=>refreshes++,scheduleHydratedViewRender:name=>renders.push(name),
    loadManagerItemcodeDefaultOwners:()=>Promise.resolve(),
    ensureDatasetLoaded:(key,mode,options)=>{
      calls.push({key,mode,...options});
      return Promise.resolve(true);
    }});
  const find = indexReleaseDeclarations(read('assets/manager-tab-routing.js'));
  vm.runInContext(find('hydrateAssignedItemsHomeTab'),context);
  context.hydrateAssignedItemsHomeTab();
  await Promise.resolve();
  assert.deepEqual(calls, [
    {key:'master',mode:'full',preserveRequestedMode:true},
    {key:'warehouseAssignedItems',mode:'full',force:true,bypassLiveSyncCoordinator:true,retryOnCancellation:true,preserveRequestedMode:true},
  ]);
  assert.equal(refreshes,3);
  assert.deepEqual(renders,['managers','managers']);
  context.warehouseAssignedItemsInventory = [{unique_id:'warm'}];
  context.hydrateAssignedItemsHomeTab();
  assert.deepEqual(calls.at(-1), {
    key:'warehouseAssignedItems',mode:'full',force:false,bypassLiveSyncCoordinator:false,retryOnCancellation:false,preserveRequestedMode:true,
  });
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
  const context = runFunctions('assets/app-runtime.js', ['getMasterFullSelectFields', 'buildMasterFullDatasetQuery'], {
    window: { AgMetricInventoryList: { physicalColumns: ['unique_id', 'baseline_on_hand', 'ptravailable'] } },
    appendEvalMasterScopeToQuery: query => query,
  });
  const selectedFields = context.buildMasterFullDatasetQuery().slice('select='.length).split('&')[0].split(',');
  assert.deepEqual(selectedFields, ['unique_id', 'baseline_on_hand', 'ptravailable']);
  assert.equal(new Set(selectedFields).size, selectedFields.length, 'the canonical full query must not request a physical column twice');

  const entry = functionSource('assets/manager-tab-routing.js','hydrateAssignedItemsHomeTab');
  const panel = functionSource('assets/app-runtime.js', 'renderManagerAssignedItemsExportPanel');
  const contractContext = vm.createContext({});
  vm.runInContext(read('assets/inventory-list-contract.js'), contractContext);
  const physicalColumns = Array.from(contractContext.AgMetricInventoryList.physicalColumns);
  assert.equal(new Set(physicalColumns).size, physicalColumns.length, 'the full physical projection must be unique');
  assert.match(read('scripts/build-live-shell.mjs'), /live-app-styles-base-v2026090503\.css\?v=\$\{ASSET_QUERY_OVERRIDES\['live-app-styles-base-v2026090503\.css'\] \|\| RELEASE_QUERY\}/);
  assert.match(entry, /ensureDatasetLoaded\('master', 'full', \{ preserveRequestedMode: true \}\)/);
  assert.doesNotMatch(panel, /ensureDatasetLoaded|loadManagerItemcodeDefaultOwners|ensureEvalAssignableUsers/);
  assert.match(functionSource('assets/dataset-load-runtime.js','ensureCoordinatedDataset'),
    /await getProductionLiveSyncCoordinator\(\)\.ensure\(adapter,\s*!!options\.force\)/);
  const version = JSON.parse(read('version.json')).version;
  assert.ok(read('index.html').includes(`inventory-list-contract.js?v=${version}`));
  assert.ok(read('index.html').includes(`app-shell-style-05.css?v=${version}`));
  assert.match(read('scripts/build-live-shell.mjs'), /ASSET_QUERY_OVERRIDES = Object\.freeze\(\{\}\)/);
}
