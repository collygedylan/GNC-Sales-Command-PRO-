import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readComposedRuntimeSource} from '../../scripts/composed-app-source.mjs';
export async function signedInCutoverContract(){
 const source=readFileSync(new URL('../../assets/app-lifecycle.js',import.meta.url),'utf8');
 const previous=[2,3,137].join('.');
 const storage=new Map([['gnc_user_v3','dylan_collyge']]),session=new Map(),deleted=[],navigation=[];let updates=0,waiting=0;
 const store=map=>({getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)});
 const root={__APP_SHELL_VERSION__:'AgData v'+previous,localStorage:store(storage),sessionStorage:store(session),navigator:{onLine:true,serviceWorker:{getRegistrations:async()=>[{scope:'https://agmetricapp.com/',update:async()=>{updates++;},waiting:{postMessage:()=>waiting++}}]}},location:{href:'https://agmetricapp.com/?v=2.3.149',replace:value=>navigation.push(value)},fetch:async()=>({status:200,text:async()=> 'AgData v2.3.149'}),withBootDeadline:async value=>value,caches:{open:async()=>({match:async()=>({status:200,text:async()=> 'AgData v2.3.149'})}),keys:async()=>['agdata-v'+previous,'agdata-v2.3.149','other-cache'],delete:async key=>deleted.push(key)}};
 const context=vm.createContext({root,doc:{getElementById:()=>null},activeSession:()=>true,URL,Promise,Date,Set,suspendNavigation(){},isOwnedShellRegistration:()=>true});
 vm.runInContext(source.slice(source.indexOf('    const isShellRelease'),source.indexOf('    let versionCheck = null;')),context);
 assert.equal(await root.forceAgDataVersionUpgrade('2.3.149'),true);assert.equal(await root.forceAgDataVersionUpgrade('2.3.149'),false);
 assert.equal(navigation.length,1);assert.equal(new URL(navigation[0],'https://agmetricapp.com').searchParams.get('v'),'2.3.149');
 assert.equal(storage.get('gnc_user_v3'),'dylan_collyge');assert.equal(storage.has('gnc_explicit_logout_v1'),false);assert.deepEqual(deleted,['agdata-v'+previous]);assert.equal(updates,1);assert.equal(waiting,1);
}
export function cancellationAndFallbackContract(){
 const source=readComposedRuntimeSource(),start=source.indexOf('        function classifyDatasetLoadFailureCode('),end=source.indexOf('        function hasAuthenticatedOperationalReadIdentity',start);
 const c=vm.createContext({});vm.runInContext(source.slice(start,end),c);
 for(const code of ['REQUEST_ABORTED','DATASET_READ_SCOPE_CHANGED','DATASET_READ_RETAINED'])assert.equal(c.classifyDatasetLoadFailureCode({code,message:'cancelled'}),null);
 assert.equal(c.classifyDatasetLoadFailureCode({message:'permission denied'}),'DATASET_PERMISSION_DENIED');assert.equal(c.classifyDatasetLoadFailureCode({message:'unexpected row failure'}),'DATASET_LOAD_FAILED');
 assert.match(source,/DATASET_READ_RETAINED/);
 const component=readFileSync(new URL('../../components/assigned-items/AssignedItems.jsx',import.meta.url),'utf8');assert.match(component,/fallbackHtml/);assert.match(component,/overscan: mobile \? 2 : 20/);
}

export async function legacyDatasetEnvelopeContract(){
 const ts=(await import('typescript')).default;
 const source=readFileSync(new URL('../../supabase/functions/app-api/index.ts',import.meta.url),'utf8');
 const block=source.slice(source.indexOf('function normalizeDatasetReadAlias'),source.indexOf('function datasetReadScalar'));
 const version=source.slice(source.indexOf('function isSupersededAppVersion'),source.indexOf('function jsonResponse'));
 const c=vm.createContext({DATASET_READ_PAGE_MAX:500,APP_RUNTIME_VERSION:'2.3.149'});vm.runInContext(ts.transpileModule(block+version,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);
 for(const alias of ['requestHistory','ph_requests_completed_history','ph_request_history'])assert.equal(c.normalizeDatasetReadAlias(alias),'request_history');
 assert.equal(c.normalizeDatasetReadAlias('requests'),'request_queue');assert.equal(c.validateDatasetReadParams({action:'dataset_read',dataset:'requests',params:{limit:'1000',offset:'0',select:'*'}}).limit,500);
 assert.throws(()=>c.validateDatasetReadParams({dataset:'requests',params:{actor:'forged'}}));
 for(const version of ['AgData v'+[2,3,137].join('.'),[2,3,138].join('.'),'v2.3.9'])assert.equal(c.isSupersededAppVersion(version),true);
 for(const version of ['2.3.149','2.3.149','unknown','99999999999.1.1'])assert.equal(c.isSupersededAppVersion(version),false);
 const {selectReleaseMigrations,migrationContractQuery}=await import('../../scripts/apply-item-low-stock-migration.mjs');const name='20261102220000_v23141_client_cutover_health.sql';assert.deepEqual(selectReleaseMigrations(JSON.stringify(['supabase/migrations/'+name])),[name]);assert.ok(migrationContractQuery(name));
}
