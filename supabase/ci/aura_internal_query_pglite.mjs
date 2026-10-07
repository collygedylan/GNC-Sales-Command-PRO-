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
const db=new PGlite({extensions:{pg_trgm}}); const q=async(sql,params=[]) => (await db.query(sql,params)).rows;
try {
 await db.waitReady;
 await db.exec(`create role anon; create role authenticated; create role service_role; create schema private; create schema extensions;
 create function private.app_account_active_at_v1(uuid,text,timestamptz) returns boolean language sql stable as $$select true$$;
 create table public.test_module_access(actor_id uuid,view_key text,allowed boolean,primary key(actor_id,view_key));
 grant all on public.test_module_access to service_role;
 create function public.navigation_module_allowed_v1(p_actor_id uuid,p_view text) returns boolean language sql stable as $$
   select coalesce((select allowed from public.test_module_access where actor_id=p_actor_id and view_key=p_view),true)$$;
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
 create table public.ph_app_settings(key text primary key,value jsonb);
 create table public.ph_eval_assignment_users(username text primary key,display_name text,active boolean);
 create table public.ph_master_inventory(unique_id text primary key,itemcode text,commonname text,contsize text,locationcode text,lotcode text,
 ptravailable text,ptronhand text,s_lts text,season text,saleyear text,desigitem text,app_tab_assignment text,genusname text,botanicalname text);
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
 insert into public.ph_warehouse_assigned_items(assignedto,warehousei,itemcode,genusname,itemcode_normalized,genusname_normalized,assignment_key,present_in_drive,zone_override_active,assignment_reason)
 values('Mia','W1','ROSE1','Rosa','ROSE1','rosa','ROSE1|rosa',true,false,'current');
 insert into public.ph_warehouse_assigned_items(assignedto,warehousei,itemcode,genusname,itemcode_normalized,genusname_normalized,assignment_key,present_in_drive,zone_override_active,assignment_reason)
 values('Unassigned','W2','TREE1','Quercus','TREE1','quercus','TREE1|quercus',true,false,'unassigned');
 insert into public.ph_warehouse_assigned_items(assignedto,warehousei,itemcode,genusname,itemcode_normalized,genusname_normalized,assignment_key,present_in_drive,zone_override_active,assignment_reason)
 values('Mia','W3','ROSE1','Rosa','ROSE1','rosa','ROSE1|rosa',true,false,'duplicate import row');
`);
 const migration=fs.readFileSync(new URL('../migrations/20261007041448_aura_internal_query_conversation_inventory.sql',import.meta.url),'utf8');
 await db.exec(migration); await db.exec('set role service_role');
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
 const read=(await q(`select public.aura_query_conversation_v1($1,'read',$2,null,null,'{}') x`,[actor,conversation]))[0].x;
 assert.equal(read.turns[0].response.reply,'Found it');
 assert.deepEqual(read.turns[0].sources,[]);
 const replay=(await q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,$4,'{"text":"red rose","source":"typed"}') x`,[actor,conversation,tid,completed.revision]))[0].x;
 assert.equal(replay.replayed,true); assert.equal(replay.response.reply,'Found it');
 await assert.rejects(()=>q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,$4,'{"text":"different question","source":"typed"}')`,[actor,conversation,tid,completed.revision]),/AURA_TURN_ID_REUSED/);
 const tid2='20000000-0000-0000-0000-000000000002';
 const begun2=(await q(`select public.aura_query_conversation_v1($1,'begin',$2,$3,$4,'{"text":"on hand?","source":"typed"}') x`,[actor,conversation,tid2,completed.revision]))[0].x;
 await q(`select public.aura_query_conversation_v1($1,'complete',$2,$3,$4,$5::jsonb)`,[actor,conversation,tid2,begun2.revision,JSON.stringify({response:{reply:'Second'},context:{},sources:[]})]);
 const history=(await q(`select public.aura_query_conversation_v1($1,'read',$2,null,null,'{}') x`,[actor,conversation]))[0].x;
 assert.deepEqual(history.turns.map(turn=>turn.text),['red rose','on hand?'],'history page is chronological within newest-first page fetch');
 const newestPage=(await q(`select public.aura_query_conversation_v1($1,'read',$2,null,null,$3::jsonb) x`,[actor,conversation,JSON.stringify({limit:1})]))[0].x;
 assert.equal(newestPage.turns[0].text,'on hand?'); assert.equal(newestPage.hasMore,true);
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
 console.log('Aura internal query SQL passed: actor-gated memory, leases/retries/cancellation/deletion, exact itemcodes, ownership de-duplication, inventory completeness, zone boundaries, HL-order reads, and grants.');
} catch(error) { console.error(error?.code,error?.message,error?.detail,error?.where); process.exitCode=1; }
finally { await db.close(); }
