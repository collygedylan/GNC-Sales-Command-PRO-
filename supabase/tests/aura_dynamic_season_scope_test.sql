-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(22);

select has_function('public','aura_manager_season_settings_v1',array['uuid','text','bigint','text','integer'],'Manager season settings RPC exists');
select ok((select prosecdef and proconfig @> array['search_path=""','statement_timeout=5s'] from pg_proc where oid='public.aura_manager_season_settings_v1(uuid,text,bigint,text,integer)'::regprocedure),'Manager settings RPC is a bounded definer with empty search path');
select ok(has_function_privilege('service_role','public.aura_manager_season_settings_v1(uuid,text,bigint,text,integer)','execute') and not has_function_privilege('authenticated','public.aura_manager_season_settings_v1(uuid,text,bigint,text,integer)','execute') and not has_function_privilege('anon','public.aura_manager_season_settings_v1(uuid,text,bigint,text,integer)','execute'),'Manager settings are server-only');
select has_function('public','aura_resolve_season_v1',array['uuid','text'],'relative season resolver exists');
select ok((select prosecdef and proconfig @> array['search_path=""','statement_timeout=5s'] from pg_proc where oid='public.aura_resolve_season_v1(uuid,text)'::regprocedure),'Relative season resolver is bounded and pinned');
select has_function('public','aura_query_seasonal_records_v1',array['uuid','text','jsonb','jsonb','integer'],'season-aware sales read RPC exists');
select ok((select prosecdef and proconfig @> array['search_path=""','statement_timeout=8s'] from pg_proc where oid='public.aura_query_seasonal_records_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure),'Sales read RPC is bounded and pinned');
select ok(has_function_privilege('service_role','public.aura_query_seasonal_records_v1(uuid,text,jsonb,jsonb,integer)','execute') and not has_function_privilege('authenticated','public.aura_query_seasonal_records_v1(uuid,text,jsonb,jsonb,integer)','execute') and not has_function_privilege('anon','public.aura_query_seasonal_records_v1(uuid,text,jsonb,jsonb,integer)','execute'),'Seasonal source reader is server-only');
select ok((select prosecdef and proconfig @> array['pg_trgm.word_similarity_threshold=0.3'] and prosrc like '%seasonReference%' and prosrc like '%settingRevision%' from pg_proc where oid='public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure),'Inventory reader resolves current/next scope and returns setting revision');
select ok((select position('select m.*' in lower(prosrc))=0 and position('m.unique_id,m.itemcode,m.commonname,m.contsize,m.ptravailable,m.ptronhand,m.genusname,m.botanicalname' in prosrc)>0 from pg_proc where oid='public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure),'Inventory reader explicitly projects physical columns so assignment fields cannot collide');

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('9f8b0000-0000-4000-8000-000000000001','aura-season-fixture@example.invalid','{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('9f8b0000-0000-4000-8000-000000000001','dylan_collyge','Aura Season Fixture','ADMIN',false)
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,must_change_password=false,disabled_at=null,locked_until=null;
insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('current_season_salesyear','{"seasonCode":"F1","salesYear":27,"revision":0}'::jsonb,'dylan_collyge',now())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
insert into public.app_dataset_revisions(key,revision,state)
values('ph_master_inventory',1,'ready')
on conflict(key) do update set revision=greatest(public.app_dataset_revisions.revision,1),state='ready';

create function pg_temp.aura_season_readers_smoke(p_actor uuid) returns integer language plpgsql as $$
declare capability text; result jsonb; n integer:=0;
begin
  result:=public.aura_query_inventory_v1(p_actor,'stock','{"seasonReference":"next"}'::jsonb,null,5);
  if result->>'season'<>'S1' or (result->>'salesYear')::integer<>27 or (result->>'settingRevision')::integer<>0 then
    raise exception 'Inventory next-season contract mismatch: %',result;
  end if;
  n:=1;
  foreach capability in array array['request_queue','active_request','request_history','sales_orders','soc_orders','reserves','av','credits','credit_requests'] loop
    result:=public.aura_query_seasonal_records_v1(p_actor,capability,'{"seasonReference":"current"}'::jsonb,null,5);
    if result->>'ok'<>'true' or (result->>'settingRevision')::integer<>0 then
      raise exception 'Season reader % failed contract: %',capability,result;
    end if;
    n:=n+1;
  end loop;
  return n;
end $$;
select is(pg_temp.aura_season_readers_smoke('9f8b0000-0000-4000-8000-000000000001'),10,'inventory and all seasonal source adapters execute with the verified season contract');

select is(public.aura_manager_season_settings_v1('9f8b0000-0000-4000-8000-000000000001','read')->>'seasonCode','F1','Manager reads the authoritative season');
select is((public.aura_manager_season_settings_v1('9f8b0000-0000-4000-8000-000000000001','read')->>'revision')::integer,0,'Manager reads a JS-safe revision');
select is(public.aura_resolve_season_v1('9f8b0000-0000-4000-8000-000000000001','next')->>'seasonCode','S1','F1 resolves next season to S1');
select is((public.aura_resolve_season_v1('9f8b0000-0000-4000-8000-000000000001','next')->>'salesYear')::integer,27,'F1 to S1 stays in the same sales year');
select is((public.aura_manager_season_settings_v1('9f8b0000-0000-4000-8000-000000000001','save',0,'S1',27)->>'revision')::integer,1,'Manager saves with compare-and-swap and increments revision');
create function pg_temp.aura_stale_season_save() returns text language plpgsql as $$
begin
  perform public.aura_manager_season_settings_v1('9f8b0000-0000-4000-8000-000000000001','save',0,'F1',27);
  return 'NO_CONFLICT';
exception when sqlstate '40001' then return sqlstate;
end $$;
select is(pg_temp.aura_stale_season_save(),'40001','stale Manager revisions are rejected');
select is(public.aura_resolve_season_v1('9f8b0000-0000-4000-8000-000000000001','next')->>'seasonCode','F1','S1 resolves next season to F1');
select is((public.aura_resolve_season_v1('9f8b0000-0000-4000-8000-000000000001','next')->>'salesYear')::integer,28,'S1 to F1 advances the sales year');

insert into public.ph_cav_import(unique_id,itemcode,commonname,contsize,season)
values('AURA-SEASON-MISSING-AV','AURA-SEASON-MISSING-AV','Fixture AV without season','#3',null);
select ok((public.aura_query_seasonal_records_v1('9f8b0000-0000-4000-8000-000000000001','av',
  '{"itemcode":"AURA-SEASON-MISSING-AV","seasonReference":"current"}'::jsonb,null,5)->>'complete')::boolean=false
  and (public.aura_query_seasonal_records_v1('9f8b0000-0000-4000-8000-000000000001','av',
  '{"itemcode":"AURA-SEASON-MISSING-AV","seasonReference":"current"}'::jsonb,null,5)->>'unresolvedCount')::integer=1
  and public.aura_query_seasonal_records_v1('9f8b0000-0000-4000-8000-000000000001','av',
  '{"itemcode":"AURA-SEASON-MISSING-AV","seasonReference":"current"}'::jsonb,null,5)->'total'='null'::jsonb,
  'season-missing AV rows are excluded and make totals explicitly incomplete');

insert into public.ph_master_inventory(unique_id,itemcode,commonname,season,saleyear)
values('AURA-SEASON-MASTER','AURA-SEASON-STATE','Fixture seasonal master','S1','27');
insert into public.ph_sales_office(unique_id,itemcode,commonname,master_id,so_source)
values('AURA-SEASON-SO-STATE','AURA-SEASON-STATE','Fixture Sales Office row','AURA-SEASON-MASTER','season'),
      ('AURA-SEASON-SO-NO-STATE','AURA-SEASON-NO-STATE','Fixture Sales Office row without state','AURA-SEASON-MISSING-MASTER','season');
insert into public.ph_season_sales_office_state(season_code,sales_year,itemcode_normalized,winner_unique_id,status,retained_av_note_at)
values('F1',27,'AURA-SEASON-STATE','AURA-SEASON-MASTER','open',now());
select ok((public.aura_query_seasonal_records_v1('9f8b0000-0000-4000-8000-000000000001','sales_orders',
  '{"itemcode":"AURA-SEASON-STATE","seasonReference":"current"}'::jsonb,null,5)->>'total')::integer=0,
  'Sales Office state season wins over a conflicting mutable master season');
select ok((public.aura_query_seasonal_records_v1('9f8b0000-0000-4000-8000-000000000001','sales_orders',
  '{"itemcode":"AURA-SEASON-NO-STATE","seasonReference":"current"}'::jsonb,null,5)->>'complete')::boolean=false
  and (public.aura_query_seasonal_records_v1('9f8b0000-0000-4000-8000-000000000001','sales_orders',
  '{"itemcode":"AURA-SEASON-NO-STATE","seasonReference":"current"}'::jsonb,null,5)->>'unresolvedCount')::integer=1,
  'seasonal Sales Office rows without a state association are reported unresolved');
select * from finish();
rollback;
