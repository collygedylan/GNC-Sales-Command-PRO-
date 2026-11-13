import assert from 'node:assert/strict';
import {read,functionSource,runFunctions} from './golden-test-environment.mjs';

export function invariant93() {
  const runtime = read('assets/app-runtime.js');
  const api = read('supabase/functions/app-api/index.ts');
  const workflow = read('supabase/functions/_shared/production-workflow.ts');
  const migration = read('supabase/migrations/20261028070752_agdata_v2392_jorge_assigned_live_changes.sql');
  assert.match(runtime, /function canUserMakeLiveChangesOnRow\([\s\S]*SCOPED_LIVE_CHANGE_USER_KEY[\s\S]*isRowAssignedToUser/);
  assert.match(runtime, /warmLiveChangeAssignmentsAfterLogin\(\);/);
  assert.match(functionSource('assets/app-runtime.js','canUserMakeLiveChangesOnRow'), /return canUserEditRow\(user \|\| currentUser, row\)/);
  const calls=[];
  const policy=runFunctions('assets/app-runtime.js',['canUserMakeLiveChangesOnRow'], {
    currentUser:'jorge_colunga',canUserEditRow:(user,row)=>{calls.push([user,row]);return row?.assignedto===user;}
  });
  const own={assignedto:'jorge_colunga'},foreign={assignedto:'other'};
  assert.equal(policy.canUserMakeLiveChangesOnRow('',own),true);
  assert.equal(policy.canUserMakeLiveChangesOnRow('',foreign),false);
  assert.deepEqual(calls,[['jorge_colunga',own],['jorge_colunga',foreign]]);
  assert.match(workflow, /GLOBAL_INVENTORY_LIVE_CHANGE_USERS[\s\S]*mitch_kaiser/);
  assert.match(workflow, /ph_inventory_row_assignments[\s\S]*ph_warehouse_assigned_items/);
  assert.match(api, /handlePhotoUpload[\s\S]*authorize:\(activeSession,request,form,prefix\)=>authorizePhotoUpload/);
  assert.match(read('src/services/photo-upload-handler.ts'), /protectedPrefixes\.has\(prefix\) \? await deps\.authorize\(session,request,form,prefix\)/);
  assert.match(read('src/services/photo-upload-authorization.ts'), /await deps\.rpc\("authorize_photo_upload_v3074"/);
  assert.match(migration, /require_drive_live_change_profile_v2392[\s\S]*save_drive_evidence_v3/);
  assert.match(migration, /can_access_drive_mode[\s\S]*can_access_av[\s\S]*can_access_que[\s\S]*can_access_manager_tab[\s\S]*can_submit_reclass/);
}

export function invariant96() {
  const runtime = read('assets/app-runtime.js');
  const requestRefresh = runtime.slice(runtime.indexOf('function refreshRequestViewInBackground'), runtime.indexOf('function renderRequest()'));
  const requestSwitch = functionSource('assets/navigation-routing.js','shouldRenderViewSynchronouslyOnSwitch');
  const assignedPanel = runtime.slice(runtime.indexOf('function renderManagerAssignedItemsExportPanel'), runtime.indexOf('function renderManagerEvalReportsPanel'));
  const managerRender = read('assets/manager-module-render.js');
  assert.match(runtime, /const REQUEST_VIEW_BACKGROUND_TIMEOUT_MS = 2500/);
  assert.match(requestSwitch, /targetViewId === 'request'[\s\S]*!requestState\.initialized \|\| !!requestState\.dirty/);
  assert.match(requestRefresh, /withTimeout\(getProductionLiveSyncCoordinator\(\)\.check\('queue-visible'\), REQUEST_VIEW_BACKGROUND_TIMEOUT_MS/);
  assert.match(requestRefresh, /withTimeout\(loadDatasetTargetsWithLimit\(pending/);
  assert.doesNotMatch(assignedPanel, /Loading AssignedTo rows/);
  assert.match(managerRender, /activeHomeTab !== MANAGER_ASSIGNED_ITEMS_EXPORT_VIEW && ensureViewDataForRender\('managers'\)/);
  assert.match(runtime, /plainManagersHubEntry[\s\S]*activeHomeTab = 'dashboard'/);
}

export function invariant113() {
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
  assert.deepEqual(Array.from(options, option => [option.key, option.count]), [['current_owner', 1],['stale_master_owner',9550]]);
  assert.equal(displayed.filter(row=>row.ASSIGNEDTO==='stale_master_owner').length,9550,'rows without an exact override retain their master owner');
  assert.equal(context.getManagerUnassignedItemcodes(displayed).length, 9551);
}
