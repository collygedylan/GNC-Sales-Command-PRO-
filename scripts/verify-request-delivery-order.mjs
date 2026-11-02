import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { agdataV23133DeliveryOrderMigrationName } from './apply-item-low-stock-migration.mjs';
export function assertDeliveryOrderHealth(health) {
  assert.equal(health?.contract_version,'eval-request-delivery-health-v2');
  assert.equal(Number(health.required_manager_recipient_count),2);
  for(const key of ['creation_order_violation_count','completion_membership_mismatch_count','missing_completion_event_count','eval_origin_scope_mismatch_count','eval_required_recipient_violation_count']) assert.equal(Number(health[key]),0,key);
  return true;
}
export function buildRollbackValidationSql(fixture,migration) {
 const body=fixture.replace(/CREATE ROLE \w+;/g,'').replace('CREATE SCHEMA private;','')
   .replace(/  if to_regclass\('cron\.job_run_details'\)[\s\S]*?(?=  -- Keep every referenced delivery receipt)/,'')
   .replaceAll('-- APPLY_RELEASE_MIGRATION',()=>migration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,''))
   .replaceAll('public.','pg_temp.').replaceAll('private.','pg_temp.')
   .replace(/CREATE TABLE /g,'CREATE TEMP TABLE ').replace(/search_path\s*=\s*public,\s*pg_temp/gi,'search_path = pg_temp')
   .replaceAll("hashtext('ph_prune_supabase_bloat_v1')","hashtext('isolated_delivery_order_validation')");
 assert.doesNotMatch(body,/\bCOMMIT\b|(?:public|private|cron)\./i);
 return 'BEGIN;\nCREATE TEMP TABLE validation_scope(id integer);\n'+body+"\nDO $final_validation$ BEGIN IF (pg_temp.get_eval_request_delivery_health_snapshot_v2()->>'creation_order_violation_count')::int<>0 THEN RAISE EXCEPTION 'FINAL_HEALTH_FAILED'; END IF; END $final_validation$;\nROLLBACK;\nSELECT 'delivery-order-rollback-proof' AS proof, true AS passed;\n";
}
async function verify() {
 const root=fileURLToPath(new URL('../',import.meta.url)),name='agdata-delivery-order-proof';
 const run=(args,input)=>{const r=spawnSync('docker',args,{cwd:root,input,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});if(r.status!==0)throw Error((r.stderr||r.error?.message||'Docker failed').slice(-1800));return r.stdout;};
 const started=Date.now();let created=false;
 if(process.argv.includes('--linked-rollback')) {
  const evidence=process.env.RELEASE_EVIDENCE_DIR||'G:/My Drive/GNC/AgData/Release Evidence';
  const fixture=await fs.readFile(path.join(root,'tests/sql/request-delivery-order.sql'),'utf8'),migration=await fs.readFile(path.join(root,'supabase/migrations',agdataV23133DeliveryOrderMigrationName),'utf8');
  const file=path.join(evidence,'delivery-order-rollback.sql');await fs.writeFile(file,buildRollbackValidationSql(fixture,migration));
  const r=spawnSync(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'db','query','--linked','--file',file,'--output','json'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
  if(r.status!==0)throw Error((r.stderr||r.stdout||'Linked rollback validation failed').slice(-2000));
  const proof=JSON.parse(r.stdout);assert.ok(proof.some(row=>row.proof==='delivery-order-rollback-proof'&&row.passed===true));
  console.log(JSON.stringify({pass:true,seconds:(Date.now()-started)/1000,mode:'temporary-schema-rollback',productionRowsModified:0,checks:8}));return;
 }
 try {
  const engine=run(['context','show']).trim();assert.ok(!/cloud/i.test(engine),'SQL tests require local Docker Desktop');
  assert.match(run(['info','--format','{{.OperatingSystem}}']),/Docker Desktop/i);
  run(['run','--rm','-d','--name',name,'-e','POSTGRES_PASSWORD=local-proof-only','postgres:15']);created=true;
  let ready=false;for(let i=0;i<30;i++){const r=spawnSync('docker',['exec',name,'pg_isready','-U','postgres'],{windowsHide:true,stdio:'ignore'});if(r.status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}assert.ok(ready,'Local Postgres ready');
  const migration=await fs.readFile(path.join(root,'supabase/migrations',agdataV23133DeliveryOrderMigrationName),'utf8');
  const fixture=(await fs.readFile(path.join(root,'tests/sql/request-delivery-order.sql'),'utf8')).replaceAll('-- APPLY_RELEASE_MIGRATION',()=>migration);
  const output=run(['exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-qAt'],fixture);
  const health=JSON.parse(output.trim().split(/\r?\n/).at(-1));assertDeliveryOrderHealth(health);
  console.log(JSON.stringify({pass:true,seconds:(Date.now()-started)/1000,health,checks:['reproduce_two','idempotent_twice','unchanged_receipts','private_boundary','retain_json_dependency','evict_unreferenced','reject_late_receipt','reject_unaudited_missing'],cloudMinutes:0}));
 }finally{if(created)run(['stop',name]);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await verify();
