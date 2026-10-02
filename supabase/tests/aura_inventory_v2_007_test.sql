begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(15);

select has_function('public','aura_inventory_v2_read_v1',
  array['text','text','text','text','text','boolean','numeric','text','jsonb','integer','jsonb'],
  'AURA V2 bounded inventory RPC exists');
select ok(not (select prosecdef from pg_proc where oid='public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)'::regprocedure),
  'AURA V2 RPC is SECURITY INVOKER');
select ok(has_function_privilege('service_role',
  'public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)','execute'),
  'service role can call the inventory RPC after app-api authorization');
select ok(not has_function_privilege('anon',
  'public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)','execute'),
  'anonymous users cannot call the inventory RPC');
select ok(not has_function_privilege('authenticated',
  'public.aura_inventory_v2_read_v1(text,text,text,text,text,boolean,numeric,text,jsonb,integer,jsonb)','execute'),
  'authenticated users cannot bypass Dylan authorization');
select ok(not has_function_privilege('anon','public.aura_inventory_v2_number_v1(text)','execute'),
  'anonymous users cannot execute parser helpers');
select ok(has_function_privilege('service_role','public.aura_inventory_v2_size_v1(text)','execute'),
  'service role can execute the size parser');
select is(public.aura_inventory_v2_number_v1('1,234.5'),1234.5::numeric,
  'numeric text accepts formatted inventory values');
select is(public.aura_inventory_v2_number_v1('unknown'),null::numeric,
  'unknown numeric values remain null rather than becoming zero');
select is(public.aura_inventory_v2_salesyear_v1('2027'),27,
  'four-digit sales year normalizes without overflow');
select is(public.aura_inventory_v2_salesyear_v1('100000000000000000000000'),null::integer,
  'out-of-range sales years fail closed before integer conversion');
select is(public.aura_inventory_v2_size_v1('# 3'),'3',
  'container size normalization removes its display marker');
select throws_ok($$select public.aura_inventory_v2_read_v1('maximum',null,null,null,'ptravailable',false,null,'F2',null,100,'[]'::jsonb)$$,
  '22023','AURA_V2_SEASON_INVALID','season is checked against supported application seasons');
select throws_ok($$select public.aura_inventory_v2_read_v1('lots','SKU','#3',null,'ptravailable',false,1.5,'F1',null,100,'[]'::jsonb)$$,
  '22023','AURA_V2_QUANTITY_INVALID','lot quantities must be whole numbers');
select throws_ok($$select public.aura_inventory_v2_read_v1('catalog',null,null,null,'priority',false,null,null,null,100,'[]'::jsonb)$$,
  '22023','AURA_V2_METRIC_INVALID','only fixed inventory metrics are accepted');

select * from finish();
rollback;
