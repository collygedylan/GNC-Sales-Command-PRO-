-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(51);

select has_function('public','aura_voice_access_v1',array[]::text[],'Aura Voice exposes an actor-bound capability reader');
select ok((select prosecdef and exists(select 1 from unnest(proconfig) c where c like 'search_path=%')
  from pg_proc where oid='public.aura_voice_access_v1()'::regprocedure),'capability reader is a bounded security definer');
select ok(has_function_privilege('authenticated','public.aura_voice_access_v1()','execute')
  and not has_function_privilege('anon','public.aura_voice_access_v1()','execute')
  and not has_function_privilege('service_role','public.aura_voice_access_v1()','execute'),
  'capability reader is callable only through a signed-in user JWT');
select has_function('public','aura_voice_inventory_read_v1',array['text','jsonb','jsonb','integer'],'Aura Voice exposes a typed caller-bound inventory reader');
select ok(has_function_privilege('authenticated','public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)','execute')
  and not has_function_privilege('anon','public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)','execute')
  and not has_function_privilege('service_role','public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)','execute'),
  'inventory reader is authenticated-only and has no actor-id argument');
select ok((select prosrc like '%m.unique_id,m.itemcode,m.commonname,m.contsize,m.ptravailable,m.ptronhand,m.genusname,m.botanicalname%'
    and prosrc like '%datasetRevision%' and prosrc like '%navigation_module_allowed_v1%'
    and prosrc not like '%m.*%' from pg_proc where oid='private.aura_voice_inventory_read_core_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure),
  'voice reader retains explicit projection, checks module access, and returns dataset revision');
select ok(not has_function_privilege('authenticated','private.aura_voice_inventory_read_core_v1(uuid,text,jsonb,jsonb,integer)','execute')
  and not has_function_privilege('service_role','private.aura_voice_inventory_read_core_v1(uuid,text,jsonb,jsonb,integer)','execute'),
  'private inventory implementation is not directly executable by clients or server role');
select has_function('public','aura_voice_conversation_v1',array['uuid','text','uuid','uuid','integer','jsonb'],'Aura Voice has separate conversation memory');
select ok(has_function_privilege('service_role','public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)','execute')
  and not has_function_privilege('authenticated','public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)','execute')
  and not has_function_privilege('anon','public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)','execute'),
  'voice conversation state remains service-only');
select ok((select prosrc like '%historical-requests%' and prosrc like '%p_actor_id%' from pg_proc
  where oid='public.aura_voice_conversation_v1(uuid,text,uuid,uuid,integer,jsonb)'::regprocedure),
  'service conversation validates active actor and module capability');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('f7010000-0000-4000-8000-000000000001','voice-rep@example.invalid','{}','{}'),
 ('f7010000-0000-4000-8000-000000000002','voice-history@example.invalid','{}','{}'),
 ('f7010000-0000-4000-8000-000000000003','voice-locked@example.invalid','{}','{}'),
 ('f7010000-0000-4000-8000-000000000004','voice-role@example.invalid','{}','{}'),
 ('f7010000-0000-4000-8000-000000000005','voice-disabled@example.invalid','{}','{}'),
 ('f7010000-0000-4000-8000-000000000006','voice-password@example.invalid','{}','{}'),
 ('f7010000-0000-4000-8000-000000000007','voice-csr@example.invalid','{}','{}'),
 ('f7010000-0000-4000-8000-000000000008','voice-dylan@example.invalid','{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
values ('f7010000-0000-4000-8000-000000000001','voice_rep','Voice Rep','REP',false,null,null),
 ('f7010000-0000-4000-8000-000000000002','voice_history','Voice History','SALESREP',false,null,null),
 ('f7010000-0000-4000-8000-000000000003','voice_locked','Voice Locked','REP',false,null,clock_timestamp()+interval '1 hour'),
 ('f7010000-0000-4000-8000-000000000004','voice_foreman','Voice Foreman','FOREMAN',false,null,null),
 ('f7010000-0000-4000-8000-000000000005','voice_disabled','Voice Disabled','REP',false,clock_timestamp(),null),
 ('f7010000-0000-4000-8000-000000000006','voice_password','Voice Password','REP',true,null,null),
 ('f7010000-0000-4000-8000-000000000007','voice_csr','Voice CSR','CSR',false,null,null),
 ('f7010000-0000-4000-8000-000000000008','dylan_collyge','Voice Dylan','FOREMAN',false,null,null)
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,
  must_change_password=excluded.must_change_password,disabled_at=excluded.disabled_at,locked_until=excluded.locked_until;
-- The production schema baseline excludes catalog data; seed only this fixture's modules.
insert into private.navigation_view_catalog(view_key,label,selectable)
values ('drive','Drive',true),('av','AV',true),('request','Request',true)
on conflict(view_key) do nothing;
insert into private.navigation_view_overrides(profile_id,view_key,allowed) values
 ('f7010000-0000-4000-8000-000000000001','drive',true),
 ('f7010000-0000-4000-8000-000000000001','request',true),
 ('f7010000-0000-4000-8000-000000000002','historical-requests',true),
 ('f7010000-0000-4000-8000-000000000002','drive',false),
 ('f7010000-0000-4000-8000-000000000002','av',false),
 ('f7010000-0000-4000-8000-000000000003','drive',true),
 ('f7010000-0000-4000-8000-000000000004','drive',true),
 ('f7010000-0000-4000-8000-000000000007','av',true),
 ('f7010000-0000-4000-8000-000000000007','drive',false),
 ('f7010000-0000-4000-8000-000000000008','historical-requests',true)
on conflict(profile_id,view_key) do update set allowed=excluded.allowed;
insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('current_season_salesyear','{"seasonCode":"F1","salesYear":27,"revision":43}'::jsonb,'voice_rep',clock_timestamp())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
insert into public.app_dataset_revisions(key,revision,state) values('ph_master_inventory',43,'ready')
on conflict(key) do update set revision=excluded.revision,state='ready';
insert into public.ph_eval_assignment_users(username,display_name,active)
values ('voice_shared_a','Voice Shared Staff',true),('voice_shared_b','Voice Shared Staff',true)
on conflict(username) do update set display_name=excluded.display_name,active=excluded.active;
insert into public.ph_master_inventory(unique_id,itemcode,commonname,genusname,contsize,locationcode,lotcode,season,saleyear,ptravailable,ptronhand,s_lts,desigitem)
values ('voice-rep-row','AURA-VOICE-REP','Voice Visible Plant','Acer','1 gal','A','L1','F1','27','4','5','-4',''),
 ('voice-rep-row-extra','AURA-VOICE-REP-2','Voice Visible Plant','Acer','1 gal','D','L4','F1','27','0','0','-3',''),
 ('voice-rep-row-other-size','AURA-VOICE-REP-3','Voice Visible Plant','Acer','2 gal','F','L6','F1','27','0','0','8',''),
 ('voice-rep-cone','AURA-VOICE-CONE','Voice Cone Plant','Acer','1 gal','E','L5','F1','27','0','0','6','Cone'),
 ('voice-rep-u3-lot','AURA-VOICE-REP','Voice Hidden U3 Lot','Acer','1 gal','B','L2.U3','F1','27','100','100','100',''),
 ('voice-rep-u3-season','AURA-VOICE-REP','Voice Hidden U3 Season','Acer','1 gal','C','L3','U3','27','200','200','200','');

select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.aura_voice_access_v1()$$,'42501','AURA_ACTOR_FORBIDDEN','unauthenticated access is rejected');
select set_config('request.jwt.claim.sub','f7010000-0000-4000-8000-000000000001',true);
select is((public.aura_voice_access_v1()#>>'{actor,id}'),'f7010000-0000-4000-8000-000000000001','actor identity is derived from auth.uid');
select is((public.aura_voice_access_v1()#>>'{capabilities,inventory}'),'true','REP receives inventory only with Drive navigation access');
select is((public.aura_voice_access_v1()#>>'{capabilities,drafts}'),'true','request drafts require both inventory and Request access');
select is((public.aura_voice_inventory_read_v1('stock','{"itemcode":"AURA-VOICE-REP"}',null,50)#>>'{total}')::numeric,4::numeric,
  'REP inventory scope excludes U3 lots while retaining ordinary inventory');
select is((public.aura_voice_inventory_read_v1('stock','{"itemcode":"AURA-VOICE-REP"}',null,50)#>>'{datasetRevision}')::bigint,
  (select revision from public.app_dataset_revisions where key='ph_master_inventory'),
  'inventory response freezes the current source dataset revision');
select is((public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Visible Plant","contSize":"1 gal","season":"F1","salesYear":27,"metric":"s_lts","requestedVariants":[],"expectedSettingRevision":43}',null,50)#>>'{total}')::numeric,-7::numeric,
  's_lts totals preserve signed values across exact-name rows with different item codes');
select is((public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Visible Plant","contSize":"1 gal","season":"F1","salesYear":27,"metric":"s_lts","requestedVariants":[],"expectedSettingRevision":43}',null,50)#>>'{exactMatch}'),'true',
  'multiple exact-name item codes are not treated as ambiguous fuzzy matches');
select is((public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Visible Plant","contSize":"1 gal","season":"F1","salesYear":27,"metric":"s_lts","openStockOnly":true,"requestedVariants":[],"expectedSettingRevision":43}',null,50)#>>'{total}')::numeric,-7::numeric,
  'signed s_lts values are not filtered by the positive open-stock predicate');
select is((public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Visible Plant","contSize":"1 gal","season":"F1","salesYear":27,"metric":"s_lts","countMode":"physical_rows","requestedVariants":[],"expectedSettingRevision":43}',null,50)#>>'{metric}'),'physical_rows',
  'count-mode totals retain their matching metric label');
select is((public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Visible Plant","season":"F1","salesYear":27,"metric":"s_lts","requestedVariants":[],"expectedSettingRevision":43}',null,50)#>>'{complete}'),'false',
  'an exact name spanning multiple sizes remains incomplete without a size choice');
select ok((public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Visible Plant","season":"F1","salesYear":27,"metric":"s_lts","requestedVariants":[],"expectedSettingRevision":43}',null,50)#>>'{total}') is null,
  'an unresolved size choice does not return a misleading total');
select is((public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Visible Plant","contSize":"1 gal","season":"F1","salesYear":27,"metric":"s_lts","requestedVariants":[],"expectedSettingRevision":43}',null,50)#>>'{total}')::numeric,-7::numeric,
  'an explicit exact name and size may safely aggregate across item codes');
select is((public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Visible Plant","contSize":"1 gal","season":"F1","salesYear":27,"metric":"s_lts","countMode":"unique_items","requestedVariants":[],"expectedSettingRevision":43}',null,50)#>>'{total}')::numeric,2::numeric,
  'unique_items reports two distinct item identities rather than quantity');
select is((public.aura_voice_inventory_read_v1('stock','{"itemcode":"AURA-VOICE-CONE","season":"F1","salesYear":27,"metric":"s_lts","requestedVariants":[],"expectedSettingRevision":43}',null,50)#>>'{total}')::numeric,0::numeric,
  'an exact excluded Cone item returns no inventory quantity');
select is((public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Cone Plant","season":"F1","salesYear":27,"metric":"s_lts","requestedVariants":[],"expectedSettingRevision":43}',null,50)#>>'{complete}'),'false',
  'an excluded exact Cone name does not convert fuzzy fallback into a complete match');
select ok((public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Cone Plant","season":"F1","salesYear":27,"metric":"s_lts","requestedVariants":[],"expectedSettingRevision":43}',null,50)#>>'{total}') is null,
  'fuzzy fallback after Cone exclusion does not return a fabricated total');
select ok(not exists(select 1 from jsonb_array_elements(public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Cone Plant","season":"F1","salesYear":27,"metric":"s_lts","requestedVariants":[],"expectedSettingRevision":43}',null,50)->'rows') as rows(row_value)
  where row_value->>'commonName'='Voice Cone Plant'),
  'Cone rows remain absent when the variant was not spoken');
select is((public.aura_voice_inventory_read_v1('stock','{"commonName":"Voice Cone Plant","contSize":"1 gal","season":"F1","salesYear":27,"metric":"s_lts","requestedVariants":["cone"],"expectedSettingRevision":43}',null,50)#>>'{total}')::numeric,6::numeric,
  'a spoken Cone variant is retained');
select throws_ok($$select public.aura_voice_inventory_read_v1('stock','{"itemcode":"AURA-VOICE-REP","expectedSettingRevision":42}',null,50)$$,'40001','AURA_APP_CONTEXT_STALE',
  'inventory rejects a stale app settings revision');
select ok((select (r->>'datasetRevision')::bigint=(select revision from public.app_dataset_revisions where key='ph_master_inventory')
    and r->>'yearCoverage'='manager-sales-year-cutoff'
    and r->>'unresolvedCount'='0' and jsonb_array_length(r->'candidateChoices')=2
  from (select public.aura_voice_inventory_read_v1('stock','{"assigneeText":"Voice Shared Staff"}',null,50) r) q),
  'ambiguous assignee choices retain the source revision and inventory completeness metadata for follow-up selection');
select is((public.aura_voice_inventory_read_v1('stock','{"itemcode":"AURA-VOICE-REP","season":"U3"}',null,50)#>>'{total}')::numeric,0::numeric,
  'REP role filter excludes U3-season inventory even when U3 is explicitly requested');
select set_config('request.jwt.claim.sub','f7010000-0000-4000-8000-000000000002',true);
select is((public.aura_voice_access_v1()#>>'{capabilities,inventory}'),'false','history-only rep has no Drive inventory capability');
select is((public.aura_voice_access_v1()#>>'{capabilities,history}'),'true','eligible rep receives explicitly granted history capability');
select is((public.aura_voice_access_v1()#>>'{capabilities,drafts}'),'false','history-only rep cannot draft an inventory request');
select throws_ok($$select public.aura_voice_inventory_read_v1('stock','{}',null,10)$$,'42501','AURA_MODULE_FORBIDDEN','direct inventory calls recheck Drive access');
select set_config('request.jwt.claim.sub','f7010000-0000-4000-8000-000000000007',true);
select is((public.aura_voice_access_v1()#>>'{capabilities,inventory}'),'true','CSR may receive inventory capability through AV navigation');
select is((public.aura_voice_inventory_read_v1('stock','{"itemcode":"AURA-VOICE-REP"}',null,50)#>>'{total}')::numeric,4::numeric,
  'AV-only CSR inventory remains bounded by the same non-U3 row scope');
select set_config('request.jwt.claim.sub','f7010000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.aura_voice_access_v1()$$,'42501','AURA_ACTOR_FORBIDDEN','locked accounts cannot obtain capabilities');
select set_config('request.jwt.claim.sub','f7010000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.aura_voice_access_v1()$$,'42501','AURA_ACTOR_FORBIDDEN','unlisted application roles cannot obtain capabilities');
select set_config('request.jwt.claim.sub','f7010000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.aura_voice_access_v1()$$,'42501','AURA_ACTOR_FORBIDDEN','disabled accounts cannot obtain capabilities');
select set_config('request.jwt.claim.sub','f7010000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.aura_voice_access_v1()$$,'42501','AURA_ACTOR_FORBIDDEN','password-change-required accounts cannot obtain capabilities');
select set_config('request.jwt.claim.sub','f7010000-0000-4000-8000-000000000007',true);
create temporary table voice_csr_turn(conversation_id uuid,turn_id uuid,revision integer);
insert into voice_csr_turn
select (r->>'conversationId')::uuid,(r->>'turnId')::uuid,(r->>'revision')::integer
from (select public.aura_voice_conversation_v1('f7010000-0000-4000-8000-000000000007','begin',null,
  '4b010000-0000-4000-8000-000000000001',null,'{"text":"CSR inventory question","source":"typed"}'::jsonb) r) q;
select is((select revision from voice_csr_turn),1,'AV-only CSR can begin an actor-owned conversation');
select is((public.aura_voice_conversation_v1('f7010000-0000-4000-8000-000000000007','cancel',
  (select conversation_id from voice_csr_turn),(select turn_id from voice_csr_turn),1,'{}'::jsonb)->>'revision')::integer,2,
  'cancelling a CSR turn advances its conversation revision');
select ok((public.aura_voice_conversation_v1('f7010000-0000-4000-8000-000000000007','cancel',
  (select conversation_id from voice_csr_turn),(select turn_id from voice_csr_turn),null,'{}'::jsonb)->>'cancelled')::boolean,
  'repeated cancellation is idempotent');
select throws_ok($$select public.aura_voice_conversation_v1('f7010000-0000-4000-8000-000000000007','begin',
  (select conversation_id from voice_csr_turn),(select turn_id from voice_csr_turn),null,
  '{"text":"CSR inventory question","source":"typed"}'::jsonb)$$,
  '22023','AURA_TURN_CANCELLED','a cancelled turn cannot be replayed');
select set_config('request.jwt.claim.sub','f7010000-0000-4000-8000-000000000008',true);
select ok((public.aura_voice_access_v1()->>'ok')::boolean and public.aura_voice_access_v1()->>'actor' is not null,
  'the exact Dylan account remains eligible with a legacy role');
create temporary table voice_dylan_turn(conversation_id uuid,turn_id uuid,revision integer);
insert into voice_dylan_turn
select (r->>'conversationId')::uuid,(r->>'turnId')::uuid,(r->>'revision')::integer
from (select public.aura_voice_conversation_v1('f7010000-0000-4000-8000-000000000008','begin',null,
  '4c010000-0000-4000-8000-000000000001',null,'{"text":"Dylan history question","source":"typed"}'::jsonb) r) q;
select is((select revision from voice_dylan_turn),1,'exact Dylan can begin an actor-owned conversation despite a legacy role');
select is((public.aura_voice_conversation_v1('f7010000-0000-4000-8000-000000000008','complete',
  (select conversation_id from voice_dylan_turn),(select turn_id from voice_dylan_turn),1,
  '{"response":{"reply":"Saved result"},"context":{"version":1},"sources":[{"kind":"history","revision":"scope-a"}]}'::jsonb)->>'revision')::integer,2,
  'completed turns advance the conversation revision once');
select ok((select r->>'replayed'='true' and r#>>'{sources,0,revision}'='scope-a'
  from (select public.aura_voice_conversation_v1('f7010000-0000-4000-8000-000000000008','begin',
  (select conversation_id from voice_dylan_turn),(select turn_id from voice_dylan_turn),1,
  '{"text":"Dylan history question","source":"typed"}'::jsonb) r) q),
  'completed turn retries return the frozen response and source without another revision');
select set_config('request.jwt.claim.sub','f7010000-0000-4000-8000-000000000001',true);
create temporary table voice_conversation_id(id uuid);
insert into voice_conversation_id select (public.aura_voice_conversation_v1('f7010000-0000-4000-8000-000000000001','create',null,null,null,'{"title":"Voice test"}'::jsonb)->>'conversationId')::uuid;
select set_config('request.jwt.claim.sub','f7010000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.aura_voice_conversation_v1('f7010000-0000-4000-8000-000000000002','read',(select id from voice_conversation_id),null,null,'{}'::jsonb)$$,
  'P0002','AURA_CONVERSATION_NOT_FOUND','conversation history is actor-owned even between eligible users');
select * from finish();
rollback;
