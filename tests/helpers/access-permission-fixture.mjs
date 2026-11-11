import {readAccessControlSource} from './access-policy-source.mjs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const source=readAccessControlSource();
export async function permissionFixture(){
 const dom=new JSDOM('<div id="manager"></div>',{url:'http://localhost'}),root=dom.window;let fail=false;const commands=[],completions=[];
 vm.runInContext(source,vm.createContext({window:root,crypto:root.crypto,console}));const api=root.GncUserAccessControl;
 const permissions=Object.fromEntries(api.permissionKeys.map(k=>[k,true])),base={...permissions,can_manage_user_access:false};
 const users=[{id:'a',username:'dylan_collyge',role:'super-admin',active:true},{id:'b',username:'abigail_vazquez',role:'eval',active:true},{id:'c',username:'zoe_green',role:'EVAL',active:true},{id:'d',username:'wes_lugas',role:'REP',active:true},{id:'e',username:'dormant_eval',role:'EVAL',active:false}].map(u=>({...u,display_name:u.username,baseline:{role:api.normalizeRole(u.role),permissions:u.id==='a'?permissions:base},permission_overrides:{},effective_permissions:u.id==='a'?permissions:base}));
 const directory={revision:1,role_baselines:['super_admin','evaluator','sales_rep'].map(role=>({role,permissions:role==='super_admin'?permissions:base,revision:1})),users};
 const matrices=users.map(u=>({username:u.username,role:u.role,create_project:'Y',revision:1}));
 api.configure({getSessionIdentity:()=>({id:'a',username:'dylan_collyge',authenticated:true}),transport:async request=>{
  if(request.operation==='resolve')return {ok:true,data:{revision:1,profile:users[0],baseline:{role:'super_admin',permissions},permission_overrides:{},effective_permissions:permissions,data_hydration_policy:{use_shared_instant_snapshot:true,av_season_rule:'active',av_visibility_rule:'authorized'}}};
  if(request.operation==='directory')return {ok:true,data:{...directory,matrixRows:matrices,roleMatrices:directory.role_baselines.map(r=>({role:r.role,revision:1,matrix:{create_project:'Y'}}))}};
  commands.push(request);return new Promise((resolve,reject)=>{completions.push(()=>fail?reject(Error('Rejected')):resolve({ok:true,matrixRows:api.state.userAccess.filter(r=>request.mode==='role'?api.normalizeRole(r.role)===request.target:r.username===request.target).map(r=>({...r,revision:2}))}));});
 }});await api.loadSelf();if(!api.getSelfState().verified)throw Error(JSON.stringify(api.status));await api.loadDirectory();return {api,dom,commands,finish:()=>completions.shift()(),fail:()=>{fail=true;}};
}
