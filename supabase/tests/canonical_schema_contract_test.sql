-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(16);

select has_function('public','aura_manager_season_settings_v1',array['uuid','text','bigint','text','integer'],'Manager season settings reader exists');
select has_function('public','aura_resolve_season_v1',array['uuid','text'],'relative season resolver exists');
select has_function('public','aura_query_inventory_v1',array['uuid','text','jsonb','jsonb','integer'],'inventory reader exists');
select ok((select prosecdef and proconfig @> array['search_path=""','statement_timeout=5s'] from pg_proc where oid='public.aura_manager_season_settings_v1(uuid,text,bigint,text,integer)'::regprocedure),'Manager settings RPC is bounded and pinned');
select ok((select prosecdef and proconfig @> array['search_path=""','statement_timeout=5s'] from pg_proc where oid='public.aura_resolve_season_v1(uuid,text)'::regprocedure),'Season resolver is bounded and pinned');
select ok((select prosecdef and proconfig @> array['pg_trgm.word_similarity_threshold=0.3','statement_timeout=5s'] from pg_proc where oid='public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure),'Inventory reader keeps its trigram settings and timeout');
select ok(has_function_privilege('service_role','public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)','execute') and not has_function_privilege('authenticated','public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)','execute') and not has_function_privilege('anon','public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)','execute'),'Inventory reads are server-only');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('9f8b0000-0000-4000-8000-000000000001','canonical-season@example.invalid','{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('9f8b0000-0000-4000-8000-000000000001','dylan_collyge','Canonical Season Fixture','ADMIN',false)
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,must_change_password=false,disabled_at=null,locked_until=null;
insert into private.navigation_view_catalog(view_key,label,selectable)
values('bunch-note','Bunch Notes',false),('drive','Drive',true)
on conflict(view_key) do nothing;
insert into private.navigation_view_overrides(profile_id,view_key,allowed)
values('9f8b0000-0000-4000-8000-000000000001','bunch-note',true),
  ('9f8b0000-0000-4000-8000-000000000001','drive',true)
on conflict(profile_id,view_key) do update set allowed=true;
insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('current_season_salesyear','{"seasonCode":"F1","salesYear":27,"revision":0}'::jsonb,'dylan_collyge',now())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
insert into public.app_dataset_revisions(key,revision,state)
values('ph_master_inventory',1,'ready')
on conflict(key) do update set revision=greatest(public.app_dataset_revisions.revision,1),state='ready';

select is(public.aura_resolve_season_v1('9f8b0000-0000-4000-8000-000000000001','current')->>'seasonCode','F1','current season comes from Manager settings');
select is(public.aura_resolve_season_v1('9f8b0000-0000-4000-8000-000000000001','next')->>'seasonCode','S1','next season follows F1 with S1');
select is((public.aura_resolve_season_v1('9f8b0000-0000-4000-8000-000000000001','next')->>'salesYear')::integer,27,'F1 to S1 retains the configured sales year');
select is(public.aura_query_inventory_v1('9f8b0000-0000-4000-8000-000000000001','stock','{"seasonReference":"next"}'::jsonb,null,1)->>'season','S1','inventory read applies the resolved next season');
select is((public.aura_query_inventory_v1('9f8b0000-0000-4000-8000-000000000001','stock','{"seasonReference":"next"}'::jsonb,null,1)->>'salesYear')::integer,27,'inventory read applies the resolved sales year');
select is((public.aura_query_inventory_v1('9f8b0000-0000-4000-8000-000000000001','stock','{"seasonReference":"next"}'::jsonb,null,1)->>'settingRevision')::integer,0,'inventory read reports the setting revision');
select ok((select position('select m.*' in lower(prosrc))=0 and position('m.unique_id,m.itemcode,m.commonname,m.contsize,m.ptravailable,m.ptronhand,m.genusname,m.botanicalname' in prosrc)>0 from pg_proc where oid='public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure),'inventory aggregation uses the explicit source projection');

select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$select public.aura_query_bunch_v1('9f8b0000-0000-4000-8000-000000000001','list','{"dateFrom":"2026-10-01T00:00:00-05:00"}'::jsonb,null,10)$$,
  '22023','AURA_BUNCH_CREATION_DATE_UNAVAILABLE','creation-date filters fail clearly instead of reading a missing timestamp column');
select lives_ok($$select public.aura_query_bunch_v1('9f8b0000-0000-4000-8000-000000000001','list','{}'::jsonb,null,10)$$,
  'Bunch Notes read executes against authorized scoped data without a nonexistent creation timestamp');

select * from finish();
rollback;
