import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readComposedRuntimeSource} from '../../scripts/composed-app-source.mjs';
import {liveUpdateFixture} from '../../src/ui/live-update-fixture.mjs';
import { validateDatasetReadParams } from '../../supabase/functions/app-api/dataset-read-query.ts';
import { functionSource } from './golden-test-environment.mjs';
export async function signedInCutoverContract(){
 const h=liveUpdateFixture();
 try {
  h.root.localStorage.setItem('gnc_user_v3','dylan_collyge');
  h.root.caches={delete:()=>assert.fail('update deleted a downloaded shell')};
  assert.equal(await h.root.forceAgDataVersionUpgrade('1.2.4'),true);
  assert.equal(h.navigation.length,0,'requesting an update alone cannot navigate');
  assert.equal(await h.tap(),true);
  assert.equal(await h.root.GncLiveAppUpdate.requestApply('duplicate'),false);
  assert.equal(h.navigation.length,1);
  assert.equal(new URL(h.navigation[0]).searchParams.get('v'),'1.2.4');
  assert.equal(h.root.localStorage.getItem('gnc_user_v3'),'dylan_collyge');
  assert.equal(h.root.localStorage.getItem('gnc_explicit_logout_v1'),null);
  assert.equal(h.checkpoints.length,1);
 } finally {h.close();}
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
 const edge='supabase/functions/app-api/index.ts';
 const declarations=['normalizeDatasetReadAlias','isSupersededAppVersion'].map(name=>functionSource(edge,name)).join('\n');
 const c=vm.createContext({APP_RUNTIME_VERSION:'3.0.5'});
 vm.runInContext(ts.transpileModule(declarations,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);
 for(const alias of ['requestHistory','ph_requests_completed_history','ph_request_history'])assert.equal(c.normalizeDatasetReadAlias(alias),'request_history');
 assert.equal(c.normalizeDatasetReadAlias('requests'),'request_queue');assert.equal(validateDatasetReadParams({action:'dataset_read',dataset:'requests',params:{limit:'1000',offset:'0',select:'*'}}).limit,500);
 assert.throws(()=>validateDatasetReadParams({dataset:'requests',params:{actor:'forged'}}));
 for(const version of ['AgData v'+[2,3,137].join('.'),[2,3,138].join('.'),'v2.3.9'])assert.equal(c.isSupersededAppVersion(version),true);
 for(const version of ['3.0.5','3.0.5','unknown','99999999999.1.1'])assert.equal(c.isSupersededAppVersion(version),false);
 const {selectReleaseMigrations,migrationContractQuery}=await import('../../scripts/apply-item-low-stock-migration.mjs');const name='20261102220000_v23141_client_cutover_health.sql';assert.deepEqual(selectReleaseMigrations(JSON.stringify(['supabase/migrations/'+name])),[name]);assert.ok(migrationContractQuery(name));
}
