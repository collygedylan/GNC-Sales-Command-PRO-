import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fixture as rowAccessFixture,engines as rowAccessEngines} from '../../src/core/canonical-row-fixture.mjs';

export function assertRestoredReclassPermission({read,shellFunction}) {
  const {ctx} = rowAccessFixture([...rowAccessEngines,'isEvalReclassRowAssigned'],{
    currentUser:'taylor_eval',currentRole:'Evaluator',nativeAuthProfile:{id:'fixture-profile',username:'taylor_eval',role:'EVAL',active:true},
    getRoleAccessState:()=>({isEval:true,isAdmin:false}),
    resolveInventoryRowOwner:row=>row.unique_id==='assigned'?'taylor_eval':'other'
  });
  assert.equal(ctx.isEvalReclassRowAssigned('taylor_eval', { unique_id: 'assigned' }), true);
  assert.equal(ctx.isEvalReclassRowAssigned('taylor_eval', { unique_id: 'other' }), false);
  ctx.currentRole = 'Admin';ctx.currentUser='admin_user';ctx.nativeAuthProfile.username='admin_user';
  ctx.resolveUserAccessMatrix=()=>({verified:true,profile_id:'fixture-profile',role:'Admin',edit_any_row:'Y',view_permissions:{view_drive_mode:'Y'}});
  assert.equal(ctx.isEvalReclassRowAssigned('admin_user', { unique_id: 'other' }), true);
  ctx.currentRole = 'Evaluator';
  assert.equal(ctx.isEvalReclassRowAssigned('dylan_collyge', { unique_id: 'other' }), false);
  const actionContext = vm.createContext({
    currentUser: 'taylor_eval', currentUserDisplay: 'Taylor Eval',
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && value !== '') ?? '',
    canUserMakeLiveChangesOnRow: (user,row) => actionContext.isRowAssignedToUser(user,row),
    getRoleAccessState: () => ({ isEval: true, isAdmin: false, isRepLike: false }),
    isAlwaysDriveCardOptionsUser: () => false,
    isRowAssignedToUser: (user, row) => ['taylor_eval', 'taylor_eval'].includes(String(user || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')) && row?.unique_id === 'assigned',
  });
  vm.runInContext(shellFunction('isWarehouseAssignedDriveCardForCurrentUser') + shellFunction('canCurrentUserUseDriveCardOptions'), actionContext);
  assert.equal(actionContext.canCurrentUserUseDriveCardOptions({ unique_id: 'assigned' }, 'drive'), true);
  assert.equal(actionContext.canCurrentUserUseDriveCardOptions({ unique_id: 'other' }, 'drive'), false);
  const authority = read('supabase/functions/_shared/production-workflow.ts');
  const policy = read('src/views/reclass-access-policy.js');
  assert.match(authority, /\['EVAL', 'EVALUATOR'\]\.includes\(role\)/);
  assert.match(authority, /ph_inventory_row_assignments[\s\S]*?ph_warehouse_assigned_items/);
  assert.match(authority, /INVENTORY_LIVE_CHANGE_ROW_NOT_ASSIGNED/);
  assert.match(policy, /adminAccess !== true && !isEvalReclassRowAssigned\(currentUser \|\| currentUserDisplay, item\)/);
  assert.match(policy, /export function authorizeArgosReclassSubmissionRows\(payload, state\)/);
  assert.match(read('src/views/reclass-submission.js'), /canSubmitArgosReclassForRow\(state, payload\)/);
}
