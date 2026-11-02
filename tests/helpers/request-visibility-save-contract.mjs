import assert from 'node:assert/strict';
import {permissionFixture} from './access-permission-fixture.mjs';
export async function requestVisibilitySaveContract(){
 const f=await permissionFixture();try{
 f.api.renderManager(f.dom.window.document.querySelector("#manager"));const dormant=f.dom.window.document.querySelector('[data-matrix-user="dormant_eval"][data-matrix-key="view_all_requests"]');assert.ok(dormant);assert.equal(dormant.disabled,false);assert.equal(f.dom.window.document.querySelector('[data-matrix-user="dormant_eval"][data-matrix-key="create_project"]').disabled,true);
 const role=f.api.saveAccessPermission('role','evaluator','view_all_requests','Y');
 assert.equal(f.api.resolveUserAccessMatrix('abigail_vazquez').view_all_requests,'Y');assert.equal(f.api.resolveUserAccessMatrix('zoe_green').view_all_requests,'Y');assert.equal(f.api.resolveUserAccessMatrix('dormant_eval').view_all_requests,'Y');assert.equal(f.api.state.roleMatrices.find(r=>r.role==='evaluator').matrix.view_all_requests,'Y');f.finish();await role;
 const user=f.api.saveAccessPermission('user','abigail_vazquez','view_all_requests','N');assert.equal(f.api.resolveUserAccessMatrix('abigail_vazquez').view_all_requests,'N');assert.equal(f.api.resolveUserAccessMatrix('zoe_green').view_all_requests,'Y');f.finish();await user;
 f.fail();const failed=f.api.saveAccessPermission('role','evaluator','view_all_requests','N');assert.equal(f.api.resolveUserAccessMatrix('zoe_green').view_all_requests,'N');f.finish();await assert.rejects(failed,/Rejected/);assert.equal(f.api.resolveUserAccessMatrix('zoe_green').view_all_requests,'Y');
 assert.deepEqual(f.commands.map(c=>[c.mode,c.target,c.permission,c.value]),[['role','evaluator','view_all_requests','Y'],['user','abigail_vazquez','view_all_requests','N'],['role','evaluator','view_all_requests','N']]);
 }finally{f.dom.window.close();}
}
