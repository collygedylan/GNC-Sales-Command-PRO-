// Executes the production migration against a disposable in-memory database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const args=process.argv.slice(2),dependencyRoot=args[args.indexOf('--pglite-root')+1];
if(!args.includes('--pglite-root')||!dependencyRoot)throw new Error('Pass --pglite-root');
const {PGlite}=createRequire(path.join(path.resolve(dependencyRoot),'package.json'))('@electric-sql/pglite');
const db=new PGlite();
try {
 await db.exec(`create role anon; create role authenticated; create role service_role;
  create schema auth; create schema sales_private; create schema private;
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
  create function auth.role() returns text language sql as $$select 'service_role'::text$$;
  create table public.profiles(id uuid primary key,username text,display_name text,role text,disabled_at timestamptz,locked_until timestamptz,must_change_password boolean default false);
  create table public.app_dataset_revisions(key text primary key,revision bigint,state text);
  insert into public.app_dataset_revisions values('ph_customer_consignee_sales_reps',1,'ready');
  create table sales_private.rep_identities(kind text,identity_key text,profile_id uuid references public.profiles(id),primary key(kind,identity_key));
  create table public.ph_customer_consignee_sales_reps(unique_id text primary key,customeridentityid text,customername text,customerstatus text,consigneeid text,consigneename text,consigneestatus text,salesrepid text,salesrepname text,territorycode text,territorydesc text,raw_data jsonb,mapping_revision bigint default 1,mapping_updated_by text,updated_at timestamptz);
  create table public.ph_active_request(unique_id text primary key,customeridentityid text,customername text,consigneeidentityid text,consigneename text,requested_by text,request_selected_rep_username text,request_selected_rep_display text,request_selected_rep_email text,request_source text);
  create view public.ph_active_request_live_rows with(security_invoker=true) as select * from public.ph_active_request;
  create view public.ph_request_queue_live_rows with(security_invoker=true) as select * from public.ph_active_request;
  create function private.insert_request_batch(p_client_batch_id uuid,p_requests jsonb,p_request_source text) returns jsonb language plpgsql as $$declare entry jsonb; begin for entry in select * from jsonb_array_elements(p_requests) loop insert into public.ph_active_request(unique_id,customeridentityid,customername,consigneeidentityid,consigneename,requested_by,request_selected_rep_username, request_selected_rep_display,request_selected_rep_email,request_source) values(entry->>'unique_id',entry->>'customeridentityid',entry->>'customername',entry->>'consigneeidentityid',entry->>'consigneename',entry->>'requested_by',entry->>'request_selected_rep_username',entry->>'request_selected_rep_display', entry->>'request_selected_rep_email',p_request_source); end loop;return '{}'::jsonb;end$$;
  create function sales_private.require_active_customer_mapping_for_request_v1() returns trigger language plpgsql as $$begin return new;end$$;
  create trigger require_active_customer_mapping_for_request_v1 before insert on public.ph_active_request for each row execute function sales_private.require_active_customer_mapping_for_request_v1();`);
 const catalog=JSON.parse(fs.readFileSync('supabase/schema/baseline-private.catalog.json','utf8'));
 for(const name of ['key','identity_key','rep_name_key'])await db.exec(catalog.functions.find(f=>f.schema==='sales_private'&&f.name===name).definition);
 const management=fs.readFileSync('supabase/migrations/20261010024830_customer_rep_mapping_management.sql','utf8');
 const start=management.indexOf('create or replace function public.customer_rep_mapping_manage_v1(');
 const end=management.indexOf('$function$;',start)+12;
 await db.exec(management.slice(start,end));
 const migration=fs.readFileSync('supabase/migrations/20261011170000_request_mapping_salesrep_identity.sql','utf8');
 await db.exec(migration);
 const admin='11111111-1111-4111-8111-111111111111',rep='22222222-2222-4222-8222-222222222222';
 await db.query(`insert into public.profiles(id,username,display_name,role) values($1,'admin','Admin','ADMIN'),($2,'rep_one','Rep One','REP')`,[admin,rep]);
 await db.query(`insert into sales_private.rep_identities values('external_id','s01',$1)`,[rep]);
 await db.exec(`insert into public.ph_customer_consignee_sales_reps(unique_id,customeridentityid,customername,customerstatus,consigneeid,consigneename,consigneestatus,salesrepid,salesrepname) values
  ('m1','00001','Same Customer','A','00011','Same Consignee','A','S01','One, Rep'),
  ('m2','00002','Same Customer','A','00012','Same Consignee','A','S01','One, Rep'),
  ('m3','00003','Other Customer','A','00013','Other Consignee','A','S02','Other Rep'),
  ('m4','00004','Inactive','I','00014','Inactive','A','S01','One, Rep');`);
 const options=async(actor,id,page=0)=>(await db.query(`select public.customer_rep_mapping_manage_v1($1,'options',$2::jsonb) as data`,[actor,JSON.stringify({salesrepId:id,page,pageSize:1})])).rows[0].data;
 assert.equal((await options(rep,'S01')).total,2);
 assert.equal((await options(rep,'S01',1)).rows[0].customeridentityid,'00002');
 assert.equal((await options(rep,'S02')).total,0);
 assert.equal((await options(admin,'S02')).total,1);
 const request={unique_id:'r1',customeridentityid:'00001',customername:'Same Customer',consigneeidentityid:'00011',consigneename:'Same Consignee',requested_by:'Rep One',request_selected_rep_username:'rep_one',request_selected_rep_display:'Rep One',request_selected_salesrep_id:'S01'};
 await db.query(`select set_config('test.actor',$1,false)`,[rep]);
 const batch=async row=>db.query(`select private.insert_request_batch($1,$2::jsonb,'av')`,[admin,JSON.stringify([row])]);
 await batch(request);
 assert.equal((await db.query(`select request_selected_salesrep_id from public.ph_active_request where unique_id='r1'`)).rows[0].request_selected_salesrep_id,'S01');
 await assert.rejects(batch({...request,unique_id:'r2',request_selected_salesrep_id:'S02'}),/REQUEST_CUSTOMER_MAPPING_REQUIRED/);
 await batch({...request,unique_id:'legacy',request_selected_salesrep_id:undefined});
 assert.equal((await db.query(`select request_selected_salesrep_id from public.ph_active_request where unique_id='legacy'`)).rows[0].request_selected_salesrep_id,'S01');
 await db.query(`select set_config('test.actor','',false)`);
 await db.exec(`insert into public.ph_customer_consignee_sales_reps(unique_id,customeridentityid,customername,customerstatus,consigneeid,consigneename,consigneestatus,salesrepid,salesrepname) values('ambiguous','00001','Same Customer','A','00011','Same Consignee','A','S03','One, Rep')`);
 await assert.rejects(batch({...request,unique_id:'ambiguous-legacy',request_selected_rep_username:null,request_selected_salesrep_id:undefined}),/REQUEST_CUSTOMER_MAPPING_REQUIRED/);
 const column=(await db.query(`select column_name from information_schema.columns where table_name='ph_request_queue_live_rows' and column_name='request_selected_salesrep_id'`)).rows;
 assert.equal(column.length,1);
 await db.exec(migration);
 console.log('Request mapping migration: exact IDs, duplicate names, pagination, ownership, legacy inference, ambiguous rejection, projections and repeat execution passed.');
} finally { await db.close(); }
