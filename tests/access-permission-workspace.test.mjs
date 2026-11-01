import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const source=fs.readFileSync(new URL('../assets/user-access-control.js',import.meta.url),'utf8');
export async function permissionFixture(){
 const dom=new JSDOM('<div id="manager"></div>',{url:'http://localhost'}),root=dom.window;let fail=false;const commands=[],completions=[];
 vm.runInContext(source,vm.createContext({window:root,crypto:root.crypto,console}));const api=root.GncUserAccessControl;
 const permissions=Object.fromEntries(api.permissionKeys.map(k=>[k,true])),base={...permissions,can_manage_user_access:false};
 const users=[{id:'a',username:'dylan_collyge',role:'super-admin',active:true},{id:'b',username:'abigail_vazquez',role:'eval',active:true},{id:'c',username:'zoe_green',role:'EVAL',active:true},{id:'d',username:'wes_lugas',role:'REP',active:true}].map(u=>({...u,display_name:u.username,baseline:{role:api.normalizeRole(u.role),permissions:u.id==='a'?permissions:base},permission_overrides:{},effective_permissions:u.id==='a'?permissions:base}));
 const directory={revision:1,role_baselines:['super_admin','evaluator','sales_rep'].map(role=>({role,permissions:role==='super_admin'?permissions:base,revision:1})),users};
 const matrices=users.map(u=>({username:u.username,role:u.role,create_project:'Y',revision:1}));
 api.configure({getSessionIdentity:()=>({id:'a',username:'dylan_collyge',authenticated:true}),transport:async request=>{
  if(request.operation==='resolve')return {ok:true,data:{revision:1,profile:users[0],baseline:{role:'super_admin',permissions},permission_overrides:{},effective_permissions:permissions,data_hydration_policy:{use_shared_instant_snapshot:true,av_season_rule:'active',av_visibility_rule:'authorized'}}};
  if(request.operation==='directory')return {ok:true,data:{...directory,matrixRows:matrices,roleMatrices:directory.role_baselines.map(r=>({role:r.role,revision:1,matrix:{create_project:'Y'}}))}};
  commands.push(request);return new Promise((resolve,reject)=>{completions.push(()=>fail?reject(Error('Rejected')):resolve({ok:true,matrixRows:api.state.userAccess.filter(r=>request.mode==='role'?api.normalizeRole(r.role)===request.target:r.username===request.target).map(r=>({...r,revision:2}))}));});
 }});await api.loadSelf();if(!api.getSelfState().verified)throw Error(JSON.stringify(api.status));await api.loadDirectory();return {api,dom,commands,finish:()=>completions.shift()(),fail:()=>{fail=true;}};
}
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
