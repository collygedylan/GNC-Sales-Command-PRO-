-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(28);

select ok(has_function_privilege('service_role','public.inventory_location_on_hand_read_v1(uuid,jsonb,text)','execute')
  and not has_function_privilege('authenticated','public.inventory_location_on_hand_read_v1(uuid,jsonb,text)','execute')
  and not has_function_privilege('anon','public.inventory_location_on_hand_read_v1(uuid,jsonb,text)','execute'),
  'aggregate read is service-only');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid='public.inventory_location_on_hand_read_v1(uuid,jsonb,text)'::regprocedure),
  'public aggregate RPC is security definer with pinned search path');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid='private.inventory_location_item_on_hand_v1(jsonb,boolean)'::regprocedure),
  'private aggregate helper is security definer with pinned search path');
select ok(to_regclass('public.ph_master_inventory_item_location_on_hand_idx') is not null
  and lower(pg_get_indexdef('public.ph_master_inventory_item_location_on_hand_idx'::regclass)) ~ 'upper.*btrim.*itemcode.*upper.*btrim.*locationcode',
  'normalized item and location expression index exists');

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values('9f8b0000-0000-4000-8000-000000000191','loc-hand-manager@example.invalid',now(),'{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('9f8b0000-0000-4000-8000-000000000191','dylan_collyge','Loc On Hand Fixture','ADMIN',false)
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,
  must_change_password=false,disabled_at=null,locked_until=null;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values('9f8b0000-0000-4000-8000-000000000192','loc-hand-denied@example.invalid',now(),'{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('9f8b0000-0000-4000-8000-000000000192','loc_hand_foreman','Loc On Hand Foreman','FOREMAN',false)
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,
  must_change_password=false,disabled_at=null,locked_until=null;
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,saleyear,ptronhand,priority)
values
 ('LOH-001','001973.030.1','C.16.000','24.F1','24','2,000','1'),
 ('LOH-002','OTHER.ITEM','C.16.000','25.F1','25','35492','1'),
 ('LOH-003','1973.030.1','C.16.000','25.F1','25','50','1'),
 ('LOH-004','001973.030.1','I.12.000','25.F1','25','7','1'),
 ('LOH-005','INVALID.I12','I.12.000','26.F1','26','not-a-number','1'),
 ('LOH-006','ZERO.ITEM','Z.01.001','25.F1','25','0','1'),
 ('LOH-007','001973.030.1','C.17.000','24.F1','24','1200','1'),
 ('LOH-008','001973.030.1','C.17.000','25.F1','25','800','2'),
 ('LOH-009','001973.030.1','C.17.000','26.F1','26','123','-'),
 ('LOH-010','INVALID.OTHER','C.16.000','25.F1','25','not-a-number','1')
on conflict(unique_id) do update set itemcode=excluded.itemcode,locationcode=excluded.locationcode,lotcode=excluded.lotcode,
  saleyear=excluded.saleyear,ptronhand=excluded.ptronhand,priority=excluded.priority;
insert into public.app_dataset_revisions(key,revision,state)
values('ph_master_inventory',1,'ready') on conflict(key) do update set revision=1,state='ready';

create temporary table on_hand_result as
select public.inventory_location_on_hand_read_v1('9f8b0000-0000-4000-8000-000000000191',
  '[{"itemcode":"001973.030.1","locationcode":"C.16.000"},{"itemcode":"other.item","locationcode":"c.16.000"},{"itemcode":"1973.030.1","locationcode":"C.16.000"},{"itemcode":"001973.030.1","locationcode":"I.12.000"},{"itemcode":"INVALID.I12","locationcode":"I.12.000"},{"itemcode":"001973.030.1","locationcode":"C.17.000"},{"itemcode":"ZERO.ITEM","locationcode":"Z.01.001"},{"itemcode":"INVALID.OTHER","locationcode":"C.16.000"},{"itemcode":"MISSING.ITEM","locationcode":"MISSING"}]'::jsonb,'1') result;
select is((select result->'rows'->0->>'loc_on_hand' from on_hand_result),'2000',
  'the item total at C.16.000 is exactly 2000 and excludes other item codes');
select is((select result->'rows'->1->>'loc_on_hand' from on_hand_result),'35492',
  'case normalization matches a requested item and location pair');
select is((select result->'rows'->2->>'loc_on_hand' from on_hand_result),'50',
  'item code with a leading zero remains distinct from a similar code');
select is((select result->'rows'->3->>'loc_on_hand' from on_hand_result),'7',
  'valid item total is available at I.12.000');
select is((select result->'rows'->4->'loc_on_hand' from on_hand_result),'null'::jsonb,
  'an invalid contributing quantity preserves an unknown total');
select is((select result->'rows'->5->>'loc_on_hand' from on_hand_result),'2123',
  'multiple lots and years aggregate at the same item and location');
select is((select result->'rows'->6->>'loc_on_hand' from on_hand_result),'0',
  'valid zero is returned as numeric zero');
select is((select result->'rows'->7->'loc_on_hand' from on_hand_result),'null'::jsonb,
  'invalid quantity for another item does not contaminate the C.16.000 total');
select is((select result->'rows'->5->>'loc_on_hand_revision' from on_hand_result),'1',
  'each result carries the source revision used for its total');
select is((select result->'rows'->8->'loc_on_hand' from on_hand_result),'null'::jsonb,
  'missing item and location source remains unknown');
select is(private.inventory_location_item_on_hand_v1('[{"itemcode":"001973.030.1","locationcode":"C.17.000"}]'::jsonb,true)->0->>'loc_on_hand','2000',
  'foreman row constraints exclude priority dash rows');
select is(private.inventory_location_item_on_hand_v1('[{"itemcode":"001973.030.1","locationcode":"C.17.000"}]'::jsonb)->0->>'loc_on_hand','2123',
  'non-foreman aggregation includes the priority dash row');
select is(private.inventory_location_item_on_hand_v1('[{"itemcode":"001973.030.1","locationcode":"C.16.000"}]'::jsonb,true)->0->>'loc_on_hand','2000',
  'valid item total remains exact under the foreman filter');
select is(private.manager_report_enrich_location_on_hand_v1('{"rows":[{"itemcode":"001973.030.1","locationcode":"C.16.000"}]}'::jsonb)->'rows'->0->>'loc_on_hand','2000',
  'Manager item rows receive the shared item and location total');
select is(private.manager_report_enrich_location_on_hand_v1('{"rows":[{"representativeRow":{"itemcode":"001973.030.1","locationcode":"C.16.000"}}]}'::jsonb)->'rows'->0->'representativeRow'->>'loc_on_hand','2000',
  'Manager grouped representative rows receive the shared item and location total');
select is(private.manager_report_enrich_location_on_hand_v1('{"rows":[{"itemcode":"001973.030.1","locationcode":"C.16.000","rows":[{"itemcode":"001973.030.1","locationcode":"C.16.000"}]}]}'::jsonb)->'rows'->0->'rows'->0->>'loc_on_hand_revision','1',
  'nested Manager rows receive the inventory revision stamp');
select is(private.manager_report_enrich_location_on_hand_v1('{"rows":[]}'::jsonb)->>'inventoryRevision','1',
  'Manager envelope carries inventory revision for empty pages');
select is(jsonb_array_length(private.manager_report_enrich_location_on_hand_v1(
  jsonb_build_object('rows',(select jsonb_agg(jsonb_build_object('itemcode','001973.030.1','locationcode','C.16.000')) from generate_series(1,501)))
)->'rows'),501,
  'Manager enrichment deduplicates repeated nested item-location pairs before enforcing the distinct-pair cap');
select throws_ok($$select public.inventory_location_on_hand_read_v1('9f8b0000-0000-4000-8000-000000000191','[]'::jsonb,'stale')$$,
  '40001','LOC_ON_HAND_REVISION_CHANGED','stale expected revision is rejected');
select throws_ok($$select private.inventory_location_item_on_hand_v1('[{"itemcode":"x"}]'::jsonb)$$,
  '22023','LOC_ON_HAND_PAIRS_INVALID','malformed pair is rejected');
select throws_ok($$select private.inventory_location_item_on_hand_v1((select jsonb_agg(jsonb_build_object('itemcode',g::text,'locationcode','x') order by g) from generate_series(1,501) g))$$,
  '22023','LOC_ON_HAND_PAIRS_INVALID','more than 500 pairs is rejected');
select throws_ok($$select public.inventory_location_on_hand_read_v1('9f8b0000-0000-4000-8000-000000000199','[]'::jsonb,null)$$,
  '42501','LOC_ON_HAND_ACTOR_FORBIDDEN','missing actor is rejected');
select is((public.inventory_location_on_hand_read_v1('9f8b0000-0000-4000-8000-000000000192','[]'::jsonb,null)->>'inventoryRevision'),'1',
  'active role decisions remain at the canonical app-api access boundary');
update public.app_dataset_revisions set state='importing' where key='ph_master_inventory';
select throws_ok($$select public.inventory_location_on_hand_read_v1('9f8b0000-0000-4000-8000-000000000191','[]'::jsonb,null)$$,
  '40001','LOC_ON_HAND_SOURCE_NOT_READY','non-ready inventory source is rejected');

select * from finish();
rollback;
