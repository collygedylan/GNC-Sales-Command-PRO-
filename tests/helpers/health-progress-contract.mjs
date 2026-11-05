import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {migrationBody,selectReleaseMigrations} from '../../scripts/apply-item-low-stock-migration.mjs';
export function photoHealthScopeContract(sql=readFileSync(new URL('../../supabase/migrations/20261102210000_v23140_health_progress_followup.sql',import.meta.url),'utf8')) {
 assert.ok(migrationBody(sql).length>0);assert.deepEqual(selectReleaseMigrations(JSON.stringify(['supabase/migrations/20261102210000_v23140_health_progress_followup.sql'])),['20261102210000_v23140_health_progress_followup.sql']);
 const expression=alias=>{const match=sql.match(new RegExp("regexp_replace\\(o.name, '([^']+)', '([^']*)'\\) as "+alias));assert.ok(match,alias);return name=>name.replace(new RegExp(match[1]),match[2].replace(/\\(\d)/g,'$$$1'));};
 const hash=expression('content_hash'),prefix=expression('object_prefix');
 assert.match(sql,/t144.name = originals.object_prefix \|\| '_thumbs\/v2\/'/);
 assert.match(sql,/t320.name = originals.object_prefix \|\| '_thumbs\/v2\/'/);
 const digest='a'.repeat(64),root='v2/'+digest+'.webp',scoped='drive-evidence/exact-row/v2/'+digest+'.webp';
 const keys=name=>[144,320].map(width=>prefix(name)+'_thumbs/v2/'+hash(name)+'-w'+width+'.webp');
 const rootKeys=['_thumbs/v2/'+digest+'-w144.webp','_thumbs/v2/'+digest+'-w320.webp'];
 const scopedKeys=rootKeys.map(name=>'drive-evidence/exact-row/'+name);
 assert.deepEqual(keys(root),rootKeys);assert.deepEqual(keys(scoped),scopedKeys);
 const complete=(name,objects)=>keys(name).every(key=>objects.has(key));
 assert.equal(complete(scoped,new Set(scopedKeys)),true);
 assert.equal(complete(scoped,new Set(rootKeys)),false);
 for(const missing of scopedKeys)assert.equal(complete(scoped,new Set(scopedKeys.filter(key=>key!==missing))),false);
}
export function syncModalPercentageContract() {
 const nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,{value:0,textContent:'',innerHTML:'',classList:{toggle(){}}});return nodes.get(key);};
 const modal={dataset:{owner:'fixture'},classList:{contains:()=>false},querySelector:node};
 const context=vm.createContext({document:{getElementById:()=>modal},window:{},canViewDashboardSyncStatus:()=>true,getSupabaseReadIdentityScope:()=> 'fixture',dashboardSyncMetadataSummaries:[],escapeDashboardSyncText:String,canRunManualInventoryImport:()=>true,isRunScriptActive:false,manualSyncStartPending:false,manualSyncStatusState:{}});
 vm.runInContext(readFileSync(new URL('../../assets/erp-sync-ui-functions.js',import.meta.url),'utf8'),context);
 for(const [production,partial,expected] of [[false,false,100],[true,false,100],[true,true,100]]) {
  const progress=Object.fromEntries(['drive','cav','reserves','soc','hl_po_parsed',...(production?['prod_schedule']:[])].map(key=>[key,{key,stage:'complete',checked:true,percent:100}]));
  if(partial)progress.prod_schedule={key:'prod_schedule',stage:'staging',percent:50,checked:false};
  context.manualSyncStatusState={sourceProgress:progress,active:partial};context.renderErpSyncProgressModal();
  assert.equal(node('[data-sync-overall]').value,expected);assert.match(node('[data-sync-elapsed]').textContent,new RegExp('^'+expected+'%'));
 }
}
