begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(10);

select has_function('public','aura_inventory_v2_match_v1',
  array['text','text','text','text','boolean','text'],
  'AURA bounded match RPC exists');
select ok(not (select prosecdef from pg_proc where oid='public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)'::regprocedure),
  'AURA match RPC executes with invoker privileges');
select ok(has_function_privilege('service_role','public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)','execute'),
  'service role can execute the RPC after app-api authorization');
select ok(not has_function_privilege('anon','public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)','execute'),
  'anonymous users cannot execute the RPC');
select ok(not has_function_privilege('authenticated','public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)','execute'),
  'authenticated users cannot bypass Dylan authorization');
select ok((select proconfig @> array['statement_timeout=4s'] from pg_proc where oid='public.aura_inventory_v2_match_v1(text,text,text,text,boolean,text)'::regprocedure),
  'matching query has a four-second function statement timeout');
select has_index('public','ph_master_inventory','idx_ph_master_inventory_aura_name_trgm',
  'normalized inventory names have a trigram search index');
select has_index('public','ph_master_inventory','idx_ph_master_inventory_aura_season_size',
  'season and canonical size are indexed for search scoping');

insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,ptronhand,s_lts,priority,season,saleyear,desigitem,app_tab_assignment)
values
  ('aura-match-010-a','AURA-010-A','AURA Match Zebra Baby Gem Boxwood','#3','AURA-ZZ-010','27.U3','10','12','1','1','U3','27','',''),
  ('aura-match-010-b','AURA-010-A','AURA Match Zebra Baby Gem Boxwood','#3','AURA-ZZ-010','27.U3','10','12','1','1','U3','27','',''),
  ('aura-match-010-size','AURA-010-SIZE','AURA Match Zebra Baby Gem Boxwood','#5','AURA-ZZ-010','27.U3','10','12','1','1','U3','27','',''),
  ('aura-match-010-off','AURA-010-OFF','AURA Match Zebra Baby Gem Boxwood','#3','AURA-ZZ-OTHER','27.U3','10','12','1','1','U3','27','',''),
  ('aura-match-010-denied','AURA-010-DENIED','AURA Match Zebra Baby Gem Boxwood','#3','AURA-ZZ-010','27.U3','10','12','1','1','U3','27','','not_on_inventory_denied');
set local role service_role;
select is((public.aura_inventory_v2_match_v1('AURA Match Zebra Baby Gem Boxwood','# 3','AURA-ZZ-010','ptravailable',false,'U3')->>'exactMatch')::boolean,true,
  'one exact SKU and canonical size match is unambiguous');
select is(jsonb_array_length(public.aura_inventory_v2_match_v1('AURA Match Zebra Baby Gem Boxwood','#3','AURA-ZZ-010','ptravailable',false,'U3')->'rows'),1,
  'SKU identity groups duplicate inventory rows into one choice');
reset role;

select * from finish();
rollback;
