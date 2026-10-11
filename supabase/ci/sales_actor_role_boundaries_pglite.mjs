import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const args=process.argv.slice(2),dependencyRoot=args[args.indexOf('--pglite-root')+1];
if(!args.includes('--pglite-root')||!dependencyRoot)throw new Error('Pass --pglite-root');
const {PGlite}=createRequire(path.join(path.resolve(dependencyRoot),'package.json'))('@electric-sql/pglite');
const db=new PGlite();
try {
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema sales_private;
  create table public.profiles(id uuid primary key,username text,role text,disabled_at timestamptz,must_change_password boolean default false,locked_until timestamptz);
  create table sales_private.rep_identities(kind text,identity_key text,profile_id uuid);
  create function sales_private.key(value text) returns text language sql immutable as $$select lower(btrim(value))$$;
  insert into profiles(id,username,role) values('11111111-1111-4111-8111-111111111111','role_diagnostic',E'\\nREP\\r\\n');
  insert into sales_private.rep_identities values('external_id','02','11111111-1111-4111-8111-111111111111');`);
 const sql=fs.readFileSync('supabase/migrations/20261011224500_normalize_sales_actor_role_boundaries.sql','utf8');
 await db.exec(sql);
 const result=(await db.query(`select (sales_private.actor('11111111-1111-4111-8111-111111111111')).role as role,
  sales_private.request_mapping_rep_allowed_v1('11111111-1111-4111-8111-111111111111','02') as own,
  sales_private.request_mapping_rep_allowed_v1('11111111-1111-4111-8111-111111111111','03') as other`)).rows[0];
 assert.deepEqual(result,{role:'REP',own:true,other:false});
 assert.equal((await db.query('select role from profiles')).rows[0].role,'\nREP\r\n');
 await db.exec("update profiles set must_change_password=true");
 await assert.rejects(db.query("select sales_private.actor('11111111-1111-4111-8111-111111111111')"),/SALES_ACTOR_NOT_ACTIVE/);
 assert.equal((await db.query("select sales_private.request_mapping_rep_allowed_v1('11111111-1111-4111-8111-111111111111','02') as allowed")).rows[0].allowed,false);
 await db.exec(sql);
 await db.exec(`create schema private;
  create table private.navigation_view_catalog(view_key text primary key);
  create table private.navigation_view_overrides(profile_id uuid,view_key text,allowed boolean,primary key(profile_id,view_key));
  create table private.navigation_reports_legacy(profile_id uuid);
  create function private.navigation_is_manager_v1(uuid) returns boolean language sql as $$select false$$;
  create function private.navigation_legacy_allowed_v1(uuid,text) returns boolean language sql as $$select false$$;
  insert into private.navigation_view_catalog values('historical-requests'),('home'),('request');
  update profiles set must_change_password=false;`);
 const navigationSource=fs.readFileSync('supabase/migrations/20261010165013_historical_requests_financial_dashboard.sql','utf8');
 const start=navigationSource.indexOf('create or replace function private.navigation_module_allowed_v1(');
 const end=navigationSource.indexOf('$function$;',start)+'$function$;'.length;
 assert.ok(start>=0&&end>start);
 await db.exec(navigationSource.slice(start,end));
 await db.exec(`revoke all on function private.navigation_module_allowed_v1(uuid,text) from public,anon,authenticated;
  grant execute on function private.navigation_module_allowed_v1(uuid,text) to service_role;`);
 const id='11111111-1111-4111-8111-111111111111';
 const allowed=async view=>(await db.query('select private.navigation_module_allowed_v1($1,$2) as allowed',[id,view])).rows[0].allowed;
 assert.equal(await allowed('historical-requests'),false,'Reproduce the real newline-role navigation failure');
 const navigationSql=fs.readFileSync('supabase/migrations/20261011230000_normalize_navigation_role_boundaries.sql','utf8');
 await db.exec(navigationSql);
 for(const role of ['\nREP\r\n','\tSALESREP\n','ADMIN','ADMINISTRATOR']){
  await db.query('update profiles set role=$1',[role]);
  assert.equal(await allowed('historical-requests'),true);
  assert.equal((await db.query('select role from profiles')).rows[0].role,role,'Stored profile values are unchanged by permission reads');
 }
 await db.exec(`insert into private.navigation_view_overrides values('${id}','historical-requests',false)`);
 assert.equal(await allowed('historical-requests'),false,'An explicit denial remains authoritative');
 await db.exec('update private.navigation_view_overrides set allowed=true');
 await db.query('update profiles set role=$1',['FOREMAN']);
 assert.equal(await allowed('historical-requests'),false,'An allow override cannot grant protected history to unrelated roles');
 await db.query('update profiles set role=$1',['\nREP\r\n']);
 for(const condition of ["must_change_password=true","disabled_at=now()","locked_until=now()+interval '1 hour'"]){
  await db.exec('update profiles set '+condition);
  assert.equal(await allowed('historical-requests'),false,'Inactive, locked and forced-password accounts remain denied');
  await db.exec('update profiles set must_change_password=false,disabled_at=null,locked_until=null');
 }
 assert.equal(await allowed('unknown-module'),false);
 await db.exec(navigationSql);
 assert.equal(await allowed('historical-requests'),true,'The migration is repeatable');
 assert.deepEqual((await db.query(`select has_function_privilege('authenticated','private.navigation_module_allowed_v1(uuid,text)','execute') as authenticated,
  has_function_privilege('service_role','private.navigation_module_allowed_v1(uuid,text)','execute') as service`)).rows[0],{authenticated:false,service:true});
 console.log('Sales role boundaries: whitespace, exact leading-zero ownership, isolation, inactive actors, unchanged stored data passed.');
} finally {await db.close();}
