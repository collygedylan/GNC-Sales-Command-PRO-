// Isolated contract check: never connects to Supabase or any configured project.
// Run: node supabase/ci/aura_internal_query_pglite.mjs --pglite-root <dir-with-node_modules>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const args=process.argv.slice(2); const root=args[args.indexOf('--pglite-root')+1];
if(!root) throw Error('Pass --pglite-root');
const req=createRequire(path.join(path.resolve(root),'package.json')); const {PGlite}=req('@electric-sql/pglite');
const {pg_trgm}=req(path.join(path.resolve(root),'node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.cjs'));

// A production release reuses installed extensions in a fresh, non-superuser
// connection. The main fixture below creates its indexes in the same session.
async function verifyColdSessionCommonNameMigration() {
 const seed=new PGlite({extensions:{pg_trgm}}); let snapshot;
 try {
  await seed.waitReady;
  await seed.exec(`
   create schema extensions; create extension pg_trgm with schema extensions;
   create role aura_migrator nosuperuser; create role anon; create role authenticated; create role service_role;
   grant usage,create on schema public to aura_migrator;
   grant usage on schema extensions to aura_migrator;
   create table public.ph_master_inventory(commonname text);
   create function public.aura_inventory_v2_name_v1(v text) returns text language sql immutable as 'select lower(btrim(v))';
   create index idx_ph_master_inventory_aura_name_trgm on public.ph_master_inventory using gin
    (public.aura_inventory_v2_name_v1(commonname) extensions.gin_trgm_ops);
   create function public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer) returns jsonb language sql as 'select ''{}''::jsonb';
   alter function public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer) owner to aura_migrator;
  `);
  snapshot=await seed.dumpDataDir();
 } finally { await seed.close(); }
 const cold=new PGlite({extensions:{pg_trgm},loadDataDir:snapshot});
 try {
  await cold.waitReady;
  await cold.exec('set role aura_migrator');
  assert.equal((await cold.query('select rolsuper from pg_roles where rolname=current_user')).rows[0].rolsuper,false);
  assert.equal((await cold.query("select name from pg_settings where name='pg_trgm.word_similarity_threshold'")).rows.length,0,
   'fresh connection has not registered the pg_trgm settings');
  const source=fs.readFileSync(new URL('../migrations/20261007123459_aura_inventory_common_name_priority.sql',import.meta.url),'utf8');
  const unwarmed=source.replace("select extensions.similarity('aura','aura');",'');
  await assert.rejects(()=>cold.exec(unwarmed),error=>error.code==='42501' && /pg_trgm.word_similarity_threshold/.test(error.message),
   'control reproduces the production permission failure before extension loading');
  await cold.exec('rollback');
  await cold.exec(source);
  const installed=(await cold.query(`select
   prosecdef and prosrc like '%commonName%' and prosrc like '%product_priority%'
    and 'pg_trgm.word_similarity_threshold=0.3'=any(proconfig) as installed,
   has_function_privilege('anon',oid,'execute') as anon_execute,
   has_function_privilege('authenticated',oid,'execute') as authenticated_execute,
   has_function_privilege('service_role',oid,'execute') as service_execute
   from pg_proc where oid='public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure`)).rows[0];
  assert.deepEqual(installed,{installed:true,anon_execute:false,authenticated_execute:false,service_execute:true});
  console.log('Aura common-name migration passed in a fresh non-superuser session; threshold and grants preserved.');
 } finally { await cold.close(); }
}
await verifyColdSessionCommonNameMigration();

const db=new PGlite({extensions:{pg_trgm}}); const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
try {
 await db.waitReady;
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema private; create schema extensions; create schema app_sync_private;
 grant usage on schema app_sync_private to service_role;
 create function private.app_account_active_at_v1(uuid,text,timestamptz) returns boolean language sql stable as $$select true$$;
 create table public.app_dataset_revisions(key text primary key,state text,revision bigint not null default 1);
 grant all on public.app_dataset_revisions to service_role;
 insert into public.app_dataset_revisions values('ph_master_inventory','ready',1);
 create table app_sync_private.import_leases(key text,run_id uuid);
 grant all on app_sync_private.import_leases to service_role;
 create table public.test_module_access(actor_id uuid,view_key text,allowed boolean,primary key(actor_id,view_key));
 grant all on public.test_module_access to service_role;
 create function public.navigation_module_allowed_v1(p_actor_id uuid,p_view text) returns boolean language sql stable as $$
   select coalesce((select allowed from public.test_module_access where actor_id=p_actor_id and view_key=p_view),true)$$;
 create table public.test_assignment_policy(singleton boolean primary key default true,active boolean not null default false);
 grant all on public.test_assignment_policy to service_role;
 insert into public.test_assignment_policy values(true,false);
 create table public.ph_inventory_row_assignments(master_unique_id text primary key,unique_id text,itemcode text,itemcode_normalized text,
   genusname text,commonname text,contsize text,locationcode text,lotcode text,source text,warehousei text,assignedto text,assigned_at timestamptz,
   assignment_reason text,zone_override_active boolean,review_required boolean,present_in_drive boolean);
 create function public.aura_inventory_v2_name_v1(v text) returns text language sql immutable as $$select btrim(regexp_replace(lower(normalize(regexp_replace(coalesce(v,''),'[®™℠]','','g'),NFKC)),'[^[:alnum:]]+',' ','g'))$$;
 create function private.eval_location_zone(p_location text) returns text language plpgsql immutable as $$
 declare value text:=upper(regexp_replace(btrim(coalesce(p_location,'')),'[[:space:]]+','','g')); parts text[];
 begin if value !~ '^[A-Z]\\.[0-9]{2}(\\.[0-9]{3})?$' then return null; end if; parts:=string_to_array(value,'.');
 if parts[1]='C' and parts[2] in ('06','07') then return 'inside'; end if;
 if parts[1]='D' and parts[2] between '04' and '09' then return 'inside'; end if;
 if parts[1]='D' and parts[2]='10' and cardinality(parts)<>3 then return null; end if;
 if parts[1]='D' and parts[2]='10' and cardinality(parts)=3 and parts[3]::integer<=21 then return 'inside'; end if;
 return 'outside'; end $$;
 create table public.profiles(id uuid primary key,username text,disabled_at timestamptz,must_change_password boolean,locked_until timestamptz);
 create schema bunch_note_private;
 create table bunch_note_private.jobs(id uuid primary key,batch_id uuid,note_number text,block text,location text,status text,owner_id uuid,
   revision bigint,instruction_revision integer,body jsonb,progress jsonb,created_by uuid,created_at timestamptz,updated_at timestamptz);
 create function bunch_note_private.actor(p_id uuid) returns public.profiles language sql stable security definer set search_path='' as $$
   select p from public.profiles p where p.id=p_id and p.username='dylan_collyge' and p.disabled_at is null
     and p.must_change_password=false and (p.locked_until is null or p.locked_until<=now())$$;
 create function bunch_note_private.can_read(p_actor public.profiles,p_job bunch_note_private.jobs) returns boolean language sql immutable as $$
   select coalesce((p_actor).username='dylan_collyge' or (p_job).owner_id=(p_actor).id
     or ((p_job).status='open' and (p_job).owner_id is null),false)$$;
 create function bunch_note_private.job_json(j bunch_note_private.jobs) returns jsonb language sql stable as $$select to_jsonb(j)$$;
 create table public.ph_app_settings(key text primary key,value jsonb);
 create table public.ph_eval_assignment_users(username text primary key,display_name text,active boolean);
 create table public.ph_master_inventory(unique_id text primary key,itemcode text,commonname text,contsize text,locationcode text,lotcode text,
 ptravailable text,ptronhand text,s_lts text,season text,saleyear text,desigitem text,app_tab_assignment text,genusname text,botanicalname text);
 create extension if not exists pg_trgm with schema extensions;
 create index idx_ph_master_inventory_aura_name_trgm on public.ph_master_inventory using gin
   (public.aura_inventory_v2_name_v1(commonname) extensions.gin_trgm_ops);
 create function private.inventory_row_assignment_policy_active_v1() returns boolean language sql stable security definer set search_path='' as $$
   select active from public.test_assignment_policy where singleton$$;
 create function private.eval_assignment_profile_active_v1(p_username text) returns boolean language sql stable security definer set search_path='' as $$
   select exists(select 1 from public.ph_eval_assignment_users u left join public.profiles p on lower(btrim(p.username))=lower(btrim(u.username))
     where u.active and lower(btrim(u.username))=lower(btrim(p_username)) and (p.id is null or (p.disabled_at is null and (p.locked_until is null or p.locked_until<=now()))))$$;
 create function private.inventory_effective_owner_v1(p_unique_id text) returns text language sql stable security definer set search_path='' as $$
   select case when private.eval_assignment_profile_active_v1(a.assignedto) then a.assignedto else null end
   from public.ph_inventory_row_assignments a where a.master_unique_id=p_unique_id and a.present_in_drive
     and private.inventory_row_assignment_policy_active_v1()$$;
 create table public.ph_warehouse_assigned_items(id uuid primary key default gen_random_uuid(),assignedto text,warehousei text,itemcode text,
 genusname text,itemcode_normalized text,genusname_normalized text,assignment_key text,present_in_drive boolean,zone_override_active boolean,
 assignment_reason text,updated_at timestamptz default now());
 create schema hl_order_private;
 create table hl_order_private.orders(id uuid primary key,order_number text,status text,created_at timestamptz,sent_at timestamptz);
 create table hl_order_private.order_lines(id uuid primary key,order_id uuid,source_id text,source jsonb);
 create table hl_order_private.receipts(id uuid primary key,command_id uuid,order_id uuid,line_id uuid,received_quantity numeric,
   previous_quantity numeric,quantity_delta numeric,reason text,created_by uuid,created_at timestamptz);
 create table hl_order_private.test_balances(itemcode text,size text,lot text,status text,imported numeric,receipt_adjustment numeric,remaining numeric,po_ordered numeric,commonname text);
 create function hl_order_private.order_json(p_id uuid) returns jsonb language sql stable as $$
   select to_jsonb(o)||jsonb_build_object('lines','[]'::jsonb,'receipts','[]'::jsonb,'fulfillment_status','open') from hl_order_private.orders o where o.id=p_id$$;
 create function hl_order_private.po_balances_v2() returns table(itemcode text,size text,lot text,status text,imported numeric,
   receipt_adjustment numeric,remaining numeric,po_ordered numeric,commonname text) language sql stable as $$
   select * from hl_order_private.test_balances$$;
 insert into hl_order_private.orders values('40000000-0000-0000-0000-000000000001','HL-TEST-1','sent',now(),now());
 insert into hl_order_private.order_lines values('40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','hl-source-1',
   '{"itemcode":"ROSE1","commonname":"Red Rose","contsize":"3DP","lotcode":"27.F1"}');
 insert into hl_order_private.receipts values('40000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000004',
   '40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',2,0,2,'received',
   '00000000-0000-0000-0000-000000000001',now());
 insert into hl_order_private.test_balances values('ROSE1','3DP','27.F1','ready',10,2,8,12,'Red Rose');
 insert into public.profiles values('00000000-0000-0000-0000-000000000001','dylan_collyge',null,false,null);
 insert into public.profiles values('00000000-0000-0000-0000-000000000002','other',null,false,null);
 insert into public.profiles values('00000000-0000-0000-0000-000000000003','dylan_collyge',null,true,null);
 insert into public.profiles values('00000000-0000-0000-0000-000000000004','dylan_collyge',now(),false,null);
 insert into public.profiles values('00000000-0000-0000-0000-000000000005','Dylan_Collyge',null,false,null);
 insert into public.profiles values('00000000-0000-0000-0000-000000000006','dylan_collyge',null,false,now()+interval '1 hour');
 insert into public.ph_app_settings values('current_season_salesyear','{"seasonCode":"F1","salesYear":"27"}');
 insert into public.ph_eval_assignment_users values('mia','Mia Jones',true),('zoe_green','Zoe Green',true),('zoey_green','Zoey Green',true);
 insert into bunch_note_private.jobs values
 ('60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000101','BN-100','C','C.06.001','open','00000000-0000-0000-0000-000000000001',1,1,
   '{"source":[{"unique_id":"i1","itemcode":"ROSE1","commonname":"Red Rose","lotcode":"27.F1"}]}','{}','00000000-0000-0000-0000-000000000001',now()-interval '2 days',now()-interval '1 day'),
 ('60000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000102','BN-101','D','D.04.001','complete','00000000-0000-0000-0000-000000000002',2,1,
   '{"source":[{"unique_id":"i3","itemcode":"TREE1","commonname":"Oak","lotcode":"27.F1"}]}','{}','00000000-0000-0000-0000-000000000002',now()-interval '1 day',now());
 insert into public.ph_master_inventory values
 ('i1','ROSE1','Red Rose','3DP','D.04.001','27.F1','12','20','1','F1','27','','','Rosa','Rosa rubiginosa'),
 ('i2','ROSE1','Red Rose','3DP','U1','27.F1','bad','20','1','F1','27','','','Rosa','Rosa rubiginosa'),
 ('i3','TREE1','Oak','5DP','C.06.001','27.F1','4','5','1','F1','27','','','Quercus','Quercus alba'),
 ('i4','PINE1','Pine','1G','D.10','27.F1','100','100','bad','F1','27','','','Pinus','Pinus strobus'),
 ('i5','OTHERROSE','Red Rose Select','3DP','C.06.002','27.F1','90','90','1','F1','27','','','Rosa','Rosa rubiginosa'),
 ('i6','OLD1','Old Rose','1G','U1','26.U1','8','10','1','U1','26','','','Rosa','Rosa rugosa'),
 ('i7','ROSE_C07','Rose C07','3DP','C.07.001','27.F1','1','2','1','F1','27','','','Rosa','Rosa alba'),
 ('i8','ROSE_D09','Rose D09','3DP','D.09.001','27.F1','1','2','1','F1','27','','','Rosa','Rosa alba'),
 ('i9','ROSE_D10021','Rose D10 inside edge','3DP','D.10.021','27.F1','1','2','1','F1','27','','','Rosa','Rosa alba'),
 ('i10','ROSE_D10022','Rose D10 outside edge','3DP','D.10.022','27.F1','1','2','1','F1','27','','','Rosa','Rosa alba'),
 ('i11','ROSE_D03','Rose D03','3DP','D.03.001','27.F1','1','2','1','F1','27','','','Rosa','Rosa alba'),
 ('i12','0012','Leading Zero Item','3DP','C.06.003','27.F1','7','9','1','F1','27','','','Rosa','Rosa alba');
 insert into public.ph_inventory_row_assignments(master_unique_id,unique_id,itemcode,itemcode_normalized,genusname,commonname,contsize,locationcode,lotcode,source,warehousei,assignedto,assignment_reason,zone_override_active,review_required,present_in_drive)
 values('i1','i1','ROSE1','ROSE1','Rosa','Red Rose','3DP','D.04.001','27.F1','drive','W1','zoe_green','zone_zoe',true,false,true),
       ('i2','i2','ROSE1','ROSE1','Rosa','Red Rose','3DP','U1','27.F1','drive','W1',null,'unassigned',false,false,true),
       ('i5','i5','OTHERROSE','OTHERROSE','Rosa','Red Rose Select','3DP','C.06.002','27.F1','drive','W1','zoe_green','zone_zoe',true,false,true);
 insert into public.ph_warehouse_assigned_items(assignedto,warehousei,itemcode,genusname,itemcode_normalized,genusname_normalized,assignment_key,present_in_drive,zone_override_active,assignment_reason)
 values('Mia','W1','ROSE1','Rosa','ROSE1','rosa','ROSE1|rosa',true,false,'current');
 insert into public.ph_warehouse_assigned_items(assignedto,warehousei,itemcode,genusname,itemcode_normalized,genusname_normalized,assignment_key,present_in_drive,zone_override_active,assignment_reason)
 values('Unassigned','W2','TREE1','Quercus','TREE1','quercus','TREE1|quercus',true,false,'unassigned');
 insert into public.ph_warehouse_assigned_items(assignedto,warehousei,itemcode,genusname,itemcode_normalized,genusname_normalized,assignment_key,present_in_drive,zone_override_active,assignment_reason)
 values('Mia','W3','ROSE1','Rosa','ROSE1','rosa','ROSE1|rosa',true,false,'duplicate import row');
`);
 const migration=fs.readFileSync(new URL('../migrations/20261007041448_aura_internal_query_conversation_inventory.sql',import.meta.url),'utf8');
 await db.exec(migration);
 const commonNameMigration=fs.readFileSync(new URL('../migrations/20261007123459_aura_inventory_common_name_priority.sql',import.meta.url),'utf8');
 await db.exec(commonNameMigration);
 await db.exec('set role service_role');
 const actor='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',cid='10000000-0000-0000-0000-000000000001',tid='20000000-0000-0000-0000-000000000001';
 await assert.rejects(()=>q(`select public.aura_query_conversation_v1($1,'create',null,null,null,'{}')`,[other]),/AURA_ACTOR_FORBIDDEN/);
 for(const denied of ['00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006']) {
   await assert.rejects(()=>q(`select public.aura_query_inventory_v1($1,'stock','{}')`,[denied]),/AURA_ACTOR_FORBIDDEN/);
 }
 const created=(await q(`select public.aura_query_conversation_v1($1,'create',null,null,null,'{"title":""}') x`,[actor]))[0].x;
 assert.equal(created.ok,true); const conversation=created.conversationId;
 await assert.rejects(()=>q(`select public.aura_query_conversation_v1($1,'read',$2,null,null,'{}')`,[other,conversation]),/AURA_ACTOR_FORBIDDEN/,'conversation reads are actor-gated');
 const begun=(await q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,0,'{"text":"red rose","source":"typed"}') x`,[actor,conversation,tid]))[0].x;
 assert.equal((await q(`select public.aura_query_conversation_v1($1,'list',null,null,null,'{}') x`,[actor]))[0].x.conversations[0].title,'red rose','first turn names a blank conversation');
 const completed=(await q(`select public.aura_query_conversation_v1($1,'complete',$2,$3,$4,$5::jsonb) x`,[actor,conversation,tid,begun.revision,JSON.stringify({response:{reply:'Found it'},context:{selectionId:'ROSE1|rosa|3dp'},sources:[]})]))[0].x;
 assert.equal(completed.revision,begun.revision+1);
 const clientOnlyTurn='21000000-0000-0000-0000-000000000001';
 const clientOnly=(await q(`select public.aura_query_conversation_v1($1,'begin',null,$2,null,'{"text":"without conversation id","source":"typed"}') x`,[actor,clientOnlyTurn]))[0].x;
 const clientOnlyDone=(await q(`select public.aura_query_conversation_v1($1,'complete',$2,$3,$4,'{"response":{"reply":"saved once"},"context":{},"sources":[]}') x`,[actor,clientOnly.conversationId,clientOnlyTurn,clientOnly.revision]))[0].x;
 const clientOnlyReplay=(await q(`select public.aura_query_conversation_v1($1,'begin',null,$2,0,'{"text":"without conversation id","source":"typed"}') x`,[actor,clientOnlyTurn]))[0].x;
 assert.equal(clientOnlyReplay.replayed,true,'a lost conversation ID still replays the original completed turn');
 assert.equal(clientOnlyReplay.conversationId,clientOnly.conversationId);
 await assert.rejects(()=>q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,null,'{"text":"without conversation id","source":"typed"}')`,[actor,conversation,clientOnlyTurn]),/AURA_TURN_ID_REUSED/,'a turn ID cannot be rebound to another conversation');
 const read=(await q(`select public.aura_query_conversation_v1($1,'read',$2,null,null,'{}') x`,[actor,conversation]))[0].x;
 assert.equal(read.turns[0].response.reply,'Found it');
 assert.deepEqual(read.turns[0].sources,[]);
 const replay=(await q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,$4,'{"text":"red rose","source":"typed"}') x`,[actor,conversation,tid,completed.revision]))[0].x;
 assert.equal(replay.replayed,true); assert.equal(replay.response.reply,'Found it');
 await assert.rejects(()=>q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,$4,'{"text":"different question","source":"typed"}')`,[actor,conversation,tid,completed.revision]),/AURA_TURN_ID_REUSED/);
 const tid2='20000000-0000-0000-0000-000000000002';
 const begun2=(await q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,$4,'{"text":"on hand?","source":"typed"}') x`,[actor,conversation,tid2,completed.revision]))[0].x;
 await q(`select public.aura_query_conversation_v1($1,'complete',$2,$3,$4,$5::jsonb)`,[actor,conversation,tid2,begun2.revision,JSON.stringify({response:{reply:'Second '+ 'x'.repeat(5000)},context:{},sources:[]})]);
 const history=(await q(`select public.aura_query_conversation_v1($1,'read',$2,null,null,'{}') x`,[actor,conversation]))[0].x;
 assert.deepEqual(history.turns.map(turn=>turn.text),['red rose','on hand?'],'history page is chronological within newest-first page fetch');
 const newestPage=(await q(`select public.aura_query_conversation_v1($1,'read',$2,null,null,$3::jsonb) x`,[actor,conversation,JSON.stringify({limit:1})]))[0].x;
 assert.equal(newestPage.turns[0].text,'on hand?'); assert.equal(newestPage.hasMore,true);
 assert.deepEqual(Object.keys(newestPage.nextCursor).sort(),['createdAt','id'],'history cursors contain only stable pagination keys');
 assert.ok(JSON.stringify(newestPage.nextCursor).length<500,'long turn responses are not copied into history cursors');
 const olderPage=(await q(`select public.aura_query_conversation_v1($1,'read',$2,null,null,$3::jsonb) x`,[actor,conversation,JSON.stringify({limit:1,cursor:newestPage.nextCursor})]))[0].x;
 assert.equal(olderPage.turns[0].text,'red rose'); assert.equal(olderPage.hasMore,false);
 const cancelId='30000000-0000-0000-0000-000000000001';
 await q(`select public.aura_query_conversation_v1($1,'cancel',$2,$3,null,'{}')`,[actor,conversation,cancelId]);
 await assert.rejects(()=>q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,null,'{"text":"cancelled first","source":"typed"}')`,[actor,conversation,cancelId]),/AURA_TURN_CANCELLED/);
 const activeId='30000000-0000-0000-0000-000000000002';
 const active=(await q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,$4,'{"text":"cancel me","source":"typed"}') x`,[actor,conversation,activeId,history.revision]))[0].x;
 await q(`select public.aura_query_conversation_v1($1,'cancel',$2,$3,null,'{}')`,[actor,conversation,activeId]);
 await assert.rejects(()=>q(`select public.aura_query_conversation_v1($1,'complete',$2,$3,$4,'{"response":{"reply":"late"},"context":{},"sources":[]}')`,[actor,conversation,activeId,active.revision]),/AURA_REVISION_CONFLICT/);
 const failedId='30000000-0000-0000-0000-000000000003';
 const failed=(await q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,$4,'{"text":"retry this","source":"typed"}') x`,[actor,conversation,failedId,active.revision+1]))[0].x;
 const markedFailed=(await q(`select public.aura_query_conversation_v1($1,'fail',$2,$3,$4,'{}') x`,[actor,conversation,failedId,failed.revision]))[0].x;
 assert.equal(markedFailed.failed,true);
 const retried=(await q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,$4,'{"text":"retry this","source":"typed"}') x`,[actor,conversation,failedId,markedFailed.revision]))[0].x;
 assert.equal(retried.turnId,failedId,'failed turns can retry with their id');
 await assert.rejects(()=>q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,$4,'{"text":"different text","source":"typed"}')`,[actor,conversation,failedId,retried.revision]),/AURA_TURN_ID_REUSED/,'expired retries cannot change the question');
 await assert.rejects(()=>q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,$4,'{"text":"retry this","source":"voice"}')`,[actor,conversation,failedId,retried.revision]),/AURA_TURN_ID_REUSED/,'expired retries cannot change the source');
 await assert.rejects(()=>q(`select public.aura_query_inventory_v1($1,'stock','{"itemcode":"ROSE1"}')`,[other]),/AURA_ACTOR_FORBIDDEN/);
 const inv=(await q(`select public.aura_query_inventory_v1($1,'stock','{"itemcode":"ROSE1","countMode":"quantity"}') x`,[actor]))[0].x;
 assert.equal(inv.complete,false,'unknown available quantity is never reported as a complete total'); assert.equal(inv.total,null);
 assert.equal(inv.rows[0].assignedTo,'mia');
 await q(`update public.app_dataset_revisions set state='importing' where key='ph_master_inventory'`);
 const importing=(await q(`select public.aura_query_inventory_v1($1,'stock','{"itemcode":"ROSE1"}') x`,[actor]))[0].x;
 assert.equal(importing.code,'AURA_INVENTORY_IMPORT_INCOMPLETE'); assert.equal(importing.rows.length,0); assert.equal(importing.total,null);
 await q(`update public.app_dataset_revisions set state='ready' where key='ph_master_inventory'`);
 await q(`insert into app_sync_private.import_leases values('ph_master_inventory','70000000-0000-0000-0000-000000000001')`);
 const leased=(await q(`select public.aura_query_inventory_v1($1,'stock','{}') x`,[actor]))[0].x;
 assert.equal(leased.code,'AURA_INVENTORY_IMPORT_INCOMPLETE','a live source lease blocks partial-snapshot answers');
 await q(`delete from app_sync_private.import_leases where key='ph_master_inventory'`);
 const unique=(await q(`select public.aura_query_inventory_v1($1,'stock','{"itemcode":"ROSE1","countMode":"unique_items"}') x`,[actor]))[0].x;
 assert.equal(unique.total,1); assert.equal(unique.complete,true);
 const leadingZero=(await q(`select public.aura_query_inventory_v1($1,'stock','{"itemcode":"0012"}') x`,[actor]))[0].x;
 assert.equal(leadingZero.rows[0].itemcode,'0012','itemcodes remain strings and preserve leading zeros');
 assert.equal(leadingZero.total,7);
 await q(`insert into public.test_module_access values($1,'drive',false) on conflict(actor_id,view_key) do update set allowed=false`,[actor]);
 await assert.rejects(()=>q(`select public.aura_query_inventory_v1($1,'stock','{}')`,[actor]),/AURA_MODULE_FORBIDDEN/,'inventory definer RPC enforces Drive access itself');
 await q(`update public.test_module_access set allowed=true where actor_id=$1 and view_key='drive'`,[actor]);
 const fuzzy=(await q(`select public.aura_query_inventory_v1($1,'match','{"productText":"red roes"}') x`,[actor]))[0].x;
 assert.equal(fuzzy.exactMatch,false,'fuzzy results require the user to choose a candidate'); assert.ok(fuzzy.rows.length>0);
 assert.ok(fuzzy.candidateChoices.length<=5);
 assert.equal(new Set(fuzzy.candidateChoices.map(choice=>choice.selectionId)).size,fuzzy.candidateChoices.length,'fuzzy choices are distinct plant identities');
 const commonNameOnly=(await q(`select public.aura_query_inventory_v1($1,'match','{"commonName":"Quercus"}') x`,[actor]))[0].x;
 assert.equal(commonNameOnly.rows.length,0,'commonName filters search the common-name field only, not botanical names');
 assert.equal(commonNameOnly.exactMatch,false);
 const commonNameFuzzy=(await q(`select public.aura_query_inventory_v1($1,'match','{"commonName":"Red Roes"}') x`,[actor]))[0].x;
 assert.equal(commonNameFuzzy.exactMatch,false,'misspelled common names request a choice instead of silently choosing');
 assert.equal(commonNameFuzzy.candidateChoices[0].commonName,'Red Rose','fuzzy common-name candidates sort by common-name similarity');
 const commonNameAndItemcode=(await q(`select public.aura_query_inventory_v1($1,'match',$2::jsonb) x`,[actor,JSON.stringify({commonName:'Red Roes',itemcode:'ROSE1'})]))[0].x;
 assert.ok(commonNameAndItemcode.rows.length>0);
 assert.ok(commonNameAndItemcode.rows.every(row=>row.itemcode==='ROSE1'),'explicit itemcode remains a hard filter with a common name');
 const commonNameAndGenus=(await q(`select public.aura_query_inventory_v1($1,'match',$2::jsonb) x`,[actor,JSON.stringify({commonName:'Red Roes',genus:'Quercus'})]))[0].x;
 assert.equal(commonNameAndGenus.rows.length,0,'explicit genus remains a hard filter with a common name');
 const chosenCommonName=(await q(`select public.aura_query_inventory_v1($1,'match',$2::jsonb) x`,[actor,JSON.stringify({commonName:'Red Roes',selectionId:commonNameFuzzy.candidateChoices[0].selectionId})]))[0].x;
 assert.equal(chosenCommonName.exactMatch,true,'selecting a fuzzy common-name candidate resolves the ambiguity');
 assert.ok(chosenCommonName.rows.length>0);
 await db.exec('reset role');
 await q(`insert into public.ph_master_inventory values('i13','BOTANICAL_COLLISION','Rosa rubiginosa','3DP','U1','27.F1','3','4','1','F1','27','','','Rosa','Rosa setigera')`);
 await db.exec('set role service_role');
 const rankedCrossField=(await q(`select public.aura_query_inventory_v1($1,'match','{"productText":"Rosa rubiginosa"}') x`,[actor]))[0].x;
 assert.equal(rankedCrossField.exactMatch,false,'cross-field exact matches remain ambiguous');
 assert.equal(rankedCrossField.candidateChoices[0].itemcode,'BOTANICAL_COLLISION','exact common-name match ranks before a botanical-name match');
 const commonNameScope=(await q(`select public.aura_query_inventory_v1($1,'match','{"commonName":"Rosa rubiginosa"}') x`,[actor]))[0].x;
 assert.equal(commonNameScope.rows.length,1,'explicit commonName avoids matching a different row only through its botanical name');
 assert.equal(commonNameScope.rows[0].itemcode,'BOTANICAL_COLLISION');
 const exact=(await q(`select public.aura_query_inventory_v1($1,'stock','{"productText":"Red Rose","metric":"ptronhand"}') x`,[actor]))[0].x;
 assert.equal(exact.exactMatch,true); assert.equal(exact.total,40,'an exact plant match excludes fuzzy neighboring names from totals');
 const firstInventoryPage=(await q(`select public.aura_query_inventory_v1($1,'stock','{"itemcode":"ROSE1","metric":"ptronhand"}',null,1) x`,[actor]))[0].x;
 assert.equal(firstInventoryPage.rows.length,1); assert.equal(firstInventoryPage.hasMore,true);
 const secondInventoryPage=(await q(`select public.aura_query_inventory_v1($1,'stock','{"itemcode":"ROSE1","metric":"ptronhand"}',$2::jsonb,1) x`,[actor,JSON.stringify(firstInventoryPage.nextCursor)]))[0].x;
 assert.equal(secondInventoryPage.rows.length,1); assert.equal(secondInventoryPage.hasMore,false); assert.equal(secondInventoryPage.total,40);
 const owners=(await q(`select public.aura_query_inventory_v1($1,'ownership','{"assignee":"mia"}') x`,[actor]))[0].x;
 assert.equal(owners.rows.length,1,'ownership groups inventory locations by assignment key');
 assert.equal(owners.rows[0].currentLocationCount,2);
 assert.equal(owners.rows[0].currentLocations.length,2);
 const duplicateAssignmentStock=(await q(`select public.aura_query_inventory_v1($1,'stock','{"itemcode":"ROSE1","metric":"ptronhand"}') x`,[actor]))[0].x;
 assert.equal(duplicateAssignmentStock.total,40,'duplicate assignment rows do not fan out inventory quantities');
 const aliasOwner=(await q(`select public.aura_query_inventory_v1($1,'ownership','{"assigneeText":"Mia Jones"}') x`,[actor]))[0].x;
 assert.equal(aliasOwner.rows[0].assignedTo,'mia','exact display-name alias resolves to a username');
 await q(`update public.test_assignment_policy set active=true where singleton`);
 const rowOwner=(await q(`select public.aura_query_inventory_v1($1,'ownership','{"itemcode":"ROSE1","assignee":"zoe_green"}') x`,[actor]))[0].x;
 assert.equal(rowOwner.rows.length,1,'active authority is queried per exact master row');
 assert.equal(rowOwner.rows[0].uniqueId,'i1');
 assert.equal(rowOwner.rows[0].ownershipSource,'inventory_row');
 assert.equal(rowOwner.rows[0].rowOwnerStatus,'assigned');
 assert.equal(rowOwner.rows[0].currentLocationCount,1);
 const rowUnassigned=(await q(`select public.aura_query_inventory_v1($1,'unassigned','{"itemcode":"ROSE1"}') x`,[actor]))[0].x;
 assert.equal(rowUnassigned.rows.length,1,'explicit row unassignment does not inherit legacy Eval ownership');
 assert.equal(rowUnassigned.rows[0].uniqueId,'i2');
 assert.equal(rowUnassigned.rows[0].rowOwnerStatus,'unassigned');
 const noLegacyFallback=(await q(`select public.aura_query_inventory_v1($1,'ownership','{"itemcode":"ROSE1","assignee":"mia"}') x`,[actor]))[0].x;
 assert.equal(noLegacyFallback.rows.length,0,'active row ownership never falls back to the Eval itemcode/genus assignment');
 const rowFuzzy=(await q(`select public.aura_query_inventory_v1($1,'ownership','{"productText":"red roes"}') x`,[actor]))[0].x;
 assert.equal(new Set(rowFuzzy.candidateChoices.map(choice=>choice.selectionId)).size,rowFuzzy.candidateChoices.length,
   'row-level fuzzy ownership choices deduplicate repeated physical rows of the same plant identity');
 const rowQuantity=(await q(`select public.aura_query_inventory_v1($1,'stock','{"itemcode":"ROSE1","metric":"ptronhand"}') x`,[actor]))[0].x;
 assert.equal(rowQuantity.total,40,'row ownership lookups do not fan out stock totals');
 await q(`update public.test_assignment_policy set active=false where singleton`);
 const personChoice=(await q(`select public.aura_query_inventory_v1($1,'ownership','{"assigneeText":"Zoe"}') x`,[actor]))[0].x;
 assert.equal(personChoice.choiceKind,'assignee','partial person names require a reviewed choice');
 assert.ok(personChoice.candidateChoices.length>0);
 assert.equal(personChoice.rows.length,0);
 const maximum=(await q(`select public.aura_query_inventory_v1($1,'maximum','{"itemcode":"ROSE1","metric":"ptronhand"}') x`,[actor]))[0].x;
 assert.equal(maximum.total,20);
 const explicitSeason=(await q(`select public.aura_query_inventory_v1($1,'stock','{"itemcode":"OLD1","season":"U1"}') x`,[actor]))[0].x;
 assert.equal(explicitSeason.total,8); assert.equal(explicitSeason.season,'U1'); assert.equal(explicitSeason.activeSeason,'F1');
 const explicitUnassigned=(await q(`select public.aura_query_inventory_v1($1,'unassigned','{"itemcode":"TREE1"}') x`,[actor]))[0].x;
 assert.equal(explicitUnassigned.rows[0].ownerStatus,'unassigned');
 const missingAssignment=(await q(`select public.aura_query_inventory_v1($1,'unassigned','{"itemcode":"PINE1"}') x`,[actor]))[0].x;
 assert.equal(missingAssignment.rows[0].ownerStatus,'missing');
 const hlOrders=(await q(`select public.aura_query_hl_order_v1($1,'orders','{"itemcode":"ROSE1"}') x`,[actor]))[0].x;
 assert.equal(hlOrders.rows[0].orderId,'40000000-0000-0000-0000-000000000001');
 assert.equal(hlOrders.rows[0].fulfillment_status,'open','native computed order detail is retained');
 const hlReceipts=(await q(`select public.aura_query_hl_order_v1($1,'receipts','{"lot":"27.F1"}') x`,[actor]))[0].x;
 assert.equal(hlReceipts.rows[0].receiptId,'40000000-0000-0000-0000-000000000003');
 const hlBalances=(await q(`select public.aura_query_hl_order_v1($1,'balances','{"itemcode":"ROSE1"}') x`,[actor]))[0].x;
 assert.equal(hlBalances.rows[0].poId,'27.F1|ROSE1|3DP'); assert.equal(hlBalances.rows[0].remaining,8);
 await q(`insert into public.test_module_access values($1,'hl-order',false) on conflict(actor_id,view_key) do update set allowed=false`,[actor]);
 await assert.rejects(()=>q(`select public.aura_query_hl_order_v1($1,'orders','{}')`,[actor]),/AURA_MODULE_FORBIDDEN/,'HL definer RPC enforces HL Order access itself');
 await q(`update public.test_module_access set allowed=true where actor_id=$1 and view_key='hl-order'`,[actor]);
 const bunchPage=(await q(`select public.aura_query_bunch_v1($1,'list','{}',null,1) x`,[actor]))[0].x;
 assert.equal(bunchPage.total,2,'Bunch Notes total is independent of page size');
 assert.equal(bunchPage.rows[0].recordId,'60000000-0000-0000-0000-000000000002');
 assert.equal(bunchPage.hasMore,true);
 const bunchNext=(await q(`select public.aura_query_bunch_v1($1,'list','{}',$2::jsonb,1) x`,[actor,JSON.stringify(bunchPage.nextCursor)]))[0].x;
 assert.equal(bunchNext.rows[0].recordId,'60000000-0000-0000-0000-000000000001');
 assert.equal(bunchNext.hasMore,false);
 const bunchFiltered=(await q(`select public.aura_query_bunch_v1($1,'list',$2::jsonb) x`,[actor,JSON.stringify({productText:'red rose',locationCode:'C.06',locationMode:'prefix',status:'open',dateFrom:'2020-01-01T00:00:00Z',dateTo:'9999-12-31T00:00:00Z'})]))[0].x;
 assert.equal(bunchFiltered.total,1,'Bunch Notes fixed filters cover product, status, location prefix, and date');
 const bunchDateExclusive=(await q(`select public.aura_query_bunch_v1($1,'list',$2::jsonb) x`,[actor,JSON.stringify({dateTo:bunchPage.rows[0].created_at})]))[0].x;
 assert.equal(bunchDateExclusive.total,1,'dateTo is an exclusive timestamp bound');
 const bunchGet=(await q(`select public.aura_query_bunch_v1($1,'get',$2::jsonb) x`,[actor,JSON.stringify({recordId:'60000000-0000-0000-0000-000000000001'})]))[0].x;
 assert.equal(bunchGet.rows[0].location,'C.06.001');
 await assert.rejects(()=>q(`select public.aura_query_bunch_v1($1,'list','{}')`,[other]),/AURA_ACTOR_FORBIDDEN/,'Bunch Notes adapter is Dylan-gated');
 await q(`insert into public.test_module_access values($1,'bunch-note',false) on conflict(actor_id,view_key) do update set allowed=false`,[actor]);
 await assert.rejects(()=>q(`select public.aura_query_bunch_v1($1,'list','{}')`,[actor]),/AURA_MODULE_FORBIDDEN/,'Bunch Notes adapter enforces module permission');
 await q(`update public.test_module_access set allowed=true where actor_id=$1 and view_key='bunch-note'`,[actor]);
 await assert.rejects(()=>q(`select public.aura_query_inventory_v1($1,'stock','{"zone":"moon"}')`,[actor]),/AURA_ZONE_INVALID/);
 const unknownOpen=(await q(`select public.aura_query_inventory_v1($1,'stock','{"itemcode":"PINE1","openStockOnly":true}') x`,[actor]))[0].x;
 assert.equal(unknownOpen.rows.length,1,'unknown open-stock state is surfaced rather than silently excluded');
 assert.equal(unknownOpen.complete,false); assert.equal(unknownOpen.total,null);
 const loc=(await q(`select public.aura_query_inventory_v1($1,'locations','{"zone":"INSIDE"}') x`,[actor]))[0].x;
 assert.equal(loc.rows.length,7,'C.06, C.07, D.04, D.09, and D.10.021 are inside');
 assert.ok(loc.rows.some(row=>row.locationCode==='D.10.021' && row.zone==='inside'));
 const outsideLoc=(await q(`select public.aura_query_inventory_v1($1,'locations','{"zone":"OUTSIDE"}') x`,[actor]))[0].x;
 assert.ok(outsideLoc.rows.some(row=>row.locationCode==='D.10.022' && row.zone==='outside'));
 assert.ok(outsideLoc.rows.some(row=>row.locationCode==='D.03.001' && row.zone==='outside'));
 const unresolved=(await q(`select public.aura_query_inventory_v1($1,'locations','{"locationCode":"D.10","locationMode":"exact"}') x`,[actor]))[0].x;
 assert.equal(unresolved.rows[0].zone,null,'a bayless D.10 location remains unresolved');
 const deleted=(await q(`select public.aura_query_conversation_v1($1,'create',null,null,null,'{"title":"delete me"}') x`,[actor]))[0].x;
 const deleteTurnId='50000000-0000-0000-0000-000000000001';
 const deleteBegin=(await q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,0,'{"text":"delete turn","source":"typed"}') x`,[actor,deleted.conversationId,deleteTurnId]))[0].x;
 await q(`select public.aura_query_conversation_v1($1,'complete',$2,$3,$4,'{"response":{"reply":"stored"},"context":{},"sources":[]}')`,[actor,deleted.conversationId,deleteTurnId,deleteBegin.revision]);
 await q(`select public.aura_query_conversation_v1($1,'delete',$2,null,null,'{}')`,[actor,deleted.conversationId]);
 await assert.rejects(()=>q(`select public.aura_query_conversation_v1($1,'read',$2,null,null,'{}')`,[actor,deleted.conversationId]),/AURA_CONVERSATION_NOT_FOUND/,'conversation deletion removes access to its history');
 await db.exec('reset role; set role anon');
 await assert.rejects(()=>q(`select public.aura_query_conversation_v1($1,'list')`,[actor]),/permission denied/);
 await db.exec('reset role; set role service_role');
 await assert.rejects(()=>q(`select * from aura_private.aura_query_conversations`),/permission denied/,'service role can use RPCs but cannot directly read private memory tables');
 console.log('Aura internal query SQL passed: private memory retry/deletion, row assignment authority, inventory readiness and zones, HL-order/Bunch Notes bounded reads, actor/module gates, and grants.');
} catch(error) { console.error(error?.code,error?.message,error?.detail,error?.where); process.exitCode=1; }
finally { await db.close(); }
