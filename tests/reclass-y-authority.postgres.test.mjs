import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {exerciseReclassPostgresTransport} from './helpers/reclass-postgres-transport.mjs';

const container=process.env.GNC_RECLASS_Y_SQL_CONTAINER;
function execute(args,input) {
  const result=spawnSync('docker',['exec','-i',container,...args],
    {input,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:64*1024*1024});
  const failure=result.stderr||result.error?.message||'';
  assert.equal(result.status,0,failure.slice(0,1600)+'\n'+failure.slice(-700));return result.stdout.trim();
}
const sql=(database,input)=>execute(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',database],input);
test('Reclass Y authority and lot parsing preserve actual actor, row and permission boundaries',{skip:!container},async()=>{
  const database='reclass_y_'+process.pid;
  execute(['createdb','-U','supabase_admin',database]);
  try {
    const schema=execute(['pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--no-owner','--no-privileges',
      '--exclude-extension=pg_cron','--exclude-schema=cron']);
    sql(database,schema);
    const installed=JSON.parse(fs.readFileSync('tests/fixtures/reclass-y-installed.json','utf8'));
    const actionSource=fs.readFileSync('supabase/migrations/20261111120000_agdata3070_action_discrepancies.sql','utf8');
    const actionHelper=actionSource.match(/create function private\.action_move_map_v3070[\s\S]*?\$\$;/)?.[0];
    assert.ok(actionHelper);sql(database,actionHelper);
    sql(database,installed.functions.map(fn=>fn.definition+';').join('\n'));
    const signatures=JSON.parse(sql(database,"SELECT jsonb_object_agg(n.nspname||'.'||p.proname,md5(p.prosrc)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private');"));
    for(const fn of installed.functions) assert.equal(signatures[fn.name],fn.source_md5,fn.name+' predecessor source digest');
    const migrationName=fs.readdirSync('supabase/migrations').filter(name=>name.endsWith('_agdata3076_reclass_y_authority.sql'));
    assert.equal(migrationName.length,1);
    const migration=fs.readFileSync('supabase/migrations/'+migrationName[0],'utf8');
    sql(database,'BEGIN;'+migration+'COMMIT;');
    const baseline=JSON.parse(sql('postgres',"SELECT permissions FROM public.role_access_baselines WHERE role='admin';"));
    const permissions={...baseline,can_access_drive_mode:true,can_access_av:true,can_access_que:true,
      can_access_manager_tab:true,can_access_eval_reports_2:true,can_submit_reclass:false};
    sql(database,"INSERT INTO public.role_access_baselines(role,permissions) VALUES ('admin','"+
      JSON.stringify(permissions).replaceAll("'","''")+"'::jsonb);");
    const keys=sql('postgres',"SELECT jsonb_agg(key) FROM public.app_dataset_revisions;");
    sql(database,"BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO app_sync_private.sources(key,modules) SELECT jsonb_array_elements_text('"+
      keys.replaceAll("'","''")+"'::jsonb),ARRAY['drive'];INSERT INTO public.app_dataset_revisions(key) SELECT jsonb_array_elements_text('"+
      keys.replaceAll("'","''")+"'::jsonb);COMMIT;");
    assert.match(sql(database,fs.readFileSync('tests/sql/reclass-y-authority-fixture.sql','utf8')),/RECLASS_Y_AUTHORITY_PASS/);
    await exerciseReclassPostgresTransport(database,sql);
    assert.equal(sql(database,"SELECT has_function_privilege('authenticated','public.can_reclass_y_administrator_v3076(uuid,jsonb)','EXECUTE');"),'f');
  } finally {execute(['dropdb','-U','supabase_admin',database]);}
});
