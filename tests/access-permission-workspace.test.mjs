import test from 'node:test';
import assert from 'node:assert/strict';
import {permissionFixture} from './helpers/access-permission-fixture.mjs';
export {permissionFixture};
test('role edits update all matching users immediately in one batch and user edits stay isolated',async()=>{
 const f=await permissionFixture(),p=f.api.saveAccessPermission('role','evaluator','create_project','N');
 assert.equal(f.api.resolveUserAccessMatrix('abigail_vazquez').create_project,'N');assert.equal(f.api.resolveUserAccessMatrix('zoe_green').create_project,'N');assert.equal(f.api.resolveUserAccessMatrix('wes_lugas').create_project,'Y');assert.equal(f.commands.length,1);f.finish();await p;
 const q=f.api.saveAccessPermission('user','abigail_vazquez','create_project','Y');assert.equal(f.api.resolveUserAccessMatrix('abigail_vazquez').create_project,'Y');assert.equal(f.api.resolveUserAccessMatrix('zoe_green').create_project,'N');f.finish();await q;f.dom.window.close();
});
test('failed batch rolls back every matching user',async()=>{
 const f=await permissionFixture();f.fail();const p=f.api.saveAccessPermission('role','evaluator','create_project','N');f.finish();await assert.rejects(p,/Rejected/);assert.equal(f.api.resolveUserAccessMatrix('abigail_vazquez').create_project,'Y');assert.equal(f.api.resolveUserAccessMatrix('zoe_green').create_project,'Y');f.dom.window.close();
});
test('both modes render categorized matrices with semantic headers and retain account tools',async()=>{
 const f=await permissionFixture(),host=f.dom.window.document.querySelector('#manager');f.api.renderManager(host);assert.equal(host.querySelectorAll('[data-access-edit-mode]').length,2);assert.equal(host.querySelectorAll('[data-access-category]').length,4);assert.ok(host.querySelector('.agdata-access-matrix thead'));assert.ok(host.querySelector('[data-user-create]'));host.querySelector('[data-access-edit-mode="role"]').click();assert.equal(host.querySelector('.agdata-access-matrix thead th').textContent,'Role');f.dom.window.close();
});

test('an acknowledged permission save cannot restore the previous account after reset',async()=>{
 const f=await permissionFixture(),p=f.api.saveAccessPermission('role','evaluator','create_project','N');
 f.api.reset();f.finish();await assert.rejects(p,/USER_ACCESS_ACCOUNT_CHANGED/);assert.equal(f.api.state.userAccess.length,0);assert.equal(f.api.state.roleMatrices.length,0);f.dom.window.close();
});

test('an old account receipt cannot clear the new account inflight protection',async()=>{
 const f=await permissionFixture(),old=f.api.saveAccessPermission('role','evaluator','create_project','N');f.api.reset();await f.api.loadSelf();await f.api.loadDirectory();
 const fresh=f.api.saveAccessPermission('role','evaluator','create_project','N');assert.equal(f.commands.length,2);f.finish();await assert.rejects(old,/USER_ACCESS_ACCOUNT_CHANGED/);
 assert.equal(await f.api.saveAccessPermission('role','evaluator','create_project','Y'),false);assert.equal(f.commands.length,2);f.finish();await fresh;f.dom.window.close();
});
