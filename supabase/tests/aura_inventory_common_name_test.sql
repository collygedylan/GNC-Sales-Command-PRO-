-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(6);
select has_function('public','aura_query_inventory_v1',array['uuid','text','jsonb','jsonb','integer'],'common-name search uses the existing typed inventory RPC');
select ok((select prosecdef and proconfig @> array['statement_timeout=5s']
  from pg_proc where oid='public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure),
  'replacement keeps the inventory RPC security-definer and execution bound');
select ok((select prosrc like '%commonName%' and prosrc like '%common_score%'
  and prosrc like '%product_priority%' from pg_proc
  where oid='public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)'::regprocedure),
  'RPC has first-class common-name filtering and candidate ranking');
select has_index('public','ph_master_inventory','idx_ph_master_inventory_aura_name_trgm',
  'name lookup reuses the existing trigram common-name index');
select ok(not has_function_privilege('anon','public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)','execute'),
  'anonymous clients cannot call the service-only reader');
select ok(has_function_privilege('service_role','public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer)','execute'),
  'service role retains execute access');
select * from finish();
rollback;
