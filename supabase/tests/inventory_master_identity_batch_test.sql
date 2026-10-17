-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(37);

select ok(has_function_privilege('service_role','public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)','execute')
  and not has_function_privilege('authenticated','public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)','execute')
  and not has_function_privilege('anon','public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)','execute'),
  'batch identity read is service-only');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid='public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)'::regprocedure),
  'batch identity read is security definer with pinned search path');
select is(private.master_identity_item_key_v1('004380.010.1'),'0043800101','recognized dotted ERP item codes map to their ten digit key');
select is(private.master_identity_item_key_v1('43800101'),'0043800101','integer ERP item codes are padded to the same ten digit key');
select is(private.master_identity_item_key_v1('ABC-1'),'ABC-1','non-numeric item punctuation is preserved');
select is(private.master_identity_location_key_v1(' c . 9 . 0 '),'C.09.000','recognized structured location segments normalize case and padding');
select is(private.master_identity_location_key_v1('C-9-0'),'C-9-0','unrecognized location punctuation is preserved');

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values('9f8b0000-0000-4000-8000-000000000381','master-identity@example.invalid',now(),'{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('9f8b0000-0000-4000-8000-000000000381','master_identity_fixture','Master Identity Fixture','ADMIN',false)
on conflict(id) do update set role='ADMIN',must_change_password=false,disabled_at=null,locked_until=null;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values('9f8b0000-0000-4000-8000-000000000382','master-identity-foreman@example.invalid',now(),'{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('9f8b0000-0000-4000-8000-000000000382','master_identity_foreman','Master Identity Foreman','FOREMAN',false)
on conflict(id) do update set role='FOREMAN',must_change_password=false,disabled_at=null,locked_until=null;
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,source,saleyear,ptronhand,ptravailable,s_lts,priority)
values
 ('MIB-UID','004380.010.1','C.09.000','LOT-UID','SRC-A','25','31','29','13','1'),
 ('MIB-RAW','0043800101','C.9.0','LOT-RAW','SRC-A','25','41','39','23','1'),
 ('MIB-INT','43800101','C.09.000','LOT-INT','SRC-B','25','51','49','33','1'),
 ('MIB-AMB-1','004380.010.1','C.09.000','LOT-AMB','SRC-A','25','61','59','43','1'),
 ('MIB-AMB-2','0043800101','C.09.000','LOT-AMB','SRC-B','25','71','69','53','1'),
 ('MIB-FOREMAN','004380.010.1','C.09.000','LOT-F','SRC-A','25','81','79','63','-'),
 ('MIB-EMPTY','004380.010.1','C.09.000','','Src-Mixed','25','91','89','73','1')
on conflict(unique_id) do update set itemcode=excluded.itemcode,locationcode=excluded.locationcode,lotcode=excluded.lotcode,
  source=excluded.source,saleyear=excluded.saleyear,ptronhand=excluded.ptronhand,ptravailable=excluded.ptravailable,
  s_lts=excluded.s_lts,priority=excluded.priority;
insert into public.app_dataset_revisions(key,revision,state)
values('ph_master_inventory',8101,'ready') on conflict(key) do update set revision=8101,state='ready';

create temporary table identity_result as
select public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000381',
  jsonb_build_array(
    jsonb_build_object('masterUid','MIB-UID','lotCode','LOT-UID'),
    jsonb_build_object('itemCode','004380.010.1','locationCode','C.09.000','lotCode','LOT-RAW','source','SRC-A'),
    jsonb_build_object('itemCode','43800101','locationCode','C.09.000','lotCode','LOT-INT','source','SRC-B'),
    jsonb_build_object('itemCode','004380.010.1','locationCode','C.09.000','lotCode','lot-raw','source','src-a'),
    jsonb_build_object('itemCode','004380.010.1','locationCode','C.09.000','lotCode','LOT-AMB'),
    jsonb_build_object('itemCode','004380.010.1','locationCode','C.09.000','lotCode','LOT-UID','source','SRC-B'),
    jsonb_build_object('itemCode','004380.010.1','locationCode','C.09.000','lotCode','MISSING'),
    jsonb_build_object('itemCode','004380.010.1','locationCode','C.09.000','lotCode','LOT-UID','source','DOCKS')
  ),'8101') result;
select is((select result->>'inventoryRevision' from identity_result),'8101','the complete batch carries its exact source revision');
select is((select result#>>'{rows,0,matchCount}' from identity_result),'1','explicit master UID resolves exactly');
select is((select result#>>'{rows,0,row,unique_id}' from identity_result),'MIB-UID','explicit UID is the primary identity');
select is((select result#>>'{rows,0,row,ptronhand}' from identity_result),'31','a resolved row includes canonical full master fields');
select is((select result#>>'{rows,1,row,unique_id}' from identity_result),'MIB-RAW','dotted ItemCode and recognized padded location match raw ERP values');
select is((select result#>>'{rows,2,row,unique_id}' from identity_result),'MIB-INT','integer ItemCode variant resolves with exact lot and source');
select is((select result#>>'{rows,3,row,unique_id}' from identity_result),'MIB-RAW','lot and source matching is case-insensitive after trimming');
select is((select result#>>'{rows,4,matchCount}' from identity_result),'2','multiple source candidates are explicitly reported as ambiguous');
select is((select result#>'{rows,4,row}' from identity_result),'null'::jsonb,'ambiguous identities never return an arbitrary master row');
select is((select result#>>'{rows,5,matchCount}' from identity_result),'0','a mismatching supplied source cannot select another row');
select is((select result#>>'{rows,6,matchCount}' from identity_result),'0','a missing exact lot is not resolved by ItemCode and location alone');
select is((select result#>>'{rows,7,row,unique_id}' from identity_result),'MIB-UID','non-master queue source labels do not overconstrain identity matching');
select is((public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000381',
  '[{"itemCode":"004380.010.1","locationCode":"C.09.000","lotCode":"","source":"SRC-MIXED"}]'::jsonb,'8101')#>>'{rows,0,row,unique_id}'),
  'MIB-EMPTY','an explicit empty lot matches only an empty-lot inventory row');
select is((public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000381',
  '[{"masterUid":"MIB-EMPTY","lotCode":""}]'::jsonb,'8101')#>>'{rows,0,matchCount}'),'1',
  'an explicit UID may be disambiguated by an explicit empty lot');
select is((public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000382',
  '[{"masterUid":"MIB-FOREMAN","lotCode":"LOT-F"}]'::jsonb,'8101')#>>'{rows,0,matchCount}'),'0','Foreman priority restrictions also apply to explicit UIDs');

select throws_ok($$select public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000381','[{"masterUid":"MIB-UID","lotCode":"LOT-UID"}]'::jsonb,'8100')$$,
  '40001','MASTER_IDENTITY_REVISION_CHANGED','stale expected revision is rejected');
select throws_ok($$select public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000399','[]'::jsonb,null)$$,
  '42501','MASTER_IDENTITY_ACTOR_FORBIDDEN','missing actor is rejected');
select throws_ok($$select public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000381','[]'::jsonb,null)$$,
  '22023','MASTER_IDENTITY_QUEUE_INVALID','empty batches are rejected');
select throws_ok($$select public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000381',(select jsonb_agg(jsonb_build_object('itemCode','1','locationCode','L','lotCode','A')) from generate_series(1,101)),'8101')$$,
  '22023','MASTER_IDENTITY_QUEUE_INVALID','batches above the 100 identity cap are rejected');
select throws_ok($$select public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000381','[{"itemCode":"AB-1","locationCode":"C.09.000"}]'::jsonb,'8101')$$,
  '22023','MASTER_IDENTITY_QUEUE_INVALID','non-UID fallback requires an exact lot identity');
select throws_ok($$select public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000381','[{"masterUid":"MIB-UID"}]'::jsonb,'8101')$$,
  '22023','MASTER_IDENTITY_QUEUE_INVALID','every identity must explicitly provide lotCode, including UID lookups');
select throws_ok($$select public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000381','[{"itemCode":"AB-1","locationCode":"C.09.000","lotCode":"LOT","extra":"no"}]'::jsonb,'8101')$$,
  '22023','MASTER_IDENTITY_QUEUE_INVALID','unrecognized identity properties are rejected');

insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,source,saleyear,ptronhand,ptravailable,s_lts,priority)
select 'MIB-BENCH-'||g::text,'BENCH'||lpad(g::text,5,'0'),'B.09.001','BENCH-LOT-'||g::text,'BENCH-SOURCE','25','1','1','1','1'
from generate_series(1,10000) g;
analyze public.ph_master_inventory;
create temporary table identity_batch_benchmark(elapsed_ms numeric, loc_elapsed_ms numeric, combined_elapsed_ms numeric, full_column_count integer, result jsonb, loc_result jsonb);
create temporary table identity_batch_plan(plan jsonb);
create temporary table identity_batch_actual_plan(plan jsonb);
do $benchmark$
declare
  queue jsonb;
  response jsonb;
  loc_response jsonb;
  on_hand_pairs jsonb;
  query_plan jsonb;
  started_at timestamptz;
  batch_done_at timestamptz;
  loc_done_at timestamptz;
begin
  select jsonb_agg(jsonb_build_object('itemCode','BENCH'||lpad(g::text,5,'0'),
    'locationCode','B.09.001','lotCode','BENCH-LOT-'||g::text,'source','BENCH-SOURCE') order by g)
    into queue from generate_series(1,100) g;
  execute $plan$
    explain (format json)
    with identity as (select private.master_identity_item_key_v1('BENCH00001') item_key,
      private.master_identity_location_key_v1('B.09.001') location_key,'BENCH-LOT-1'::text lot_key,'BENCH-SOURCE'::text source_key)
    select inv.unique_id from identity i join lateral (
      select m.unique_id from public.ph_master_inventory m
      where private.master_identity_item_key_v1(m.itemcode)=i.item_key
        and private.master_identity_location_key_v1(m.locationcode)=i.location_key
      and upper(btrim(coalesce(m.lotcode,'')))=upper(i.lot_key)
      and upper(btrim(coalesce(m.source,'')))=upper(i.source_key)
      order by m.unique_id limit 2
    ) inv on true
  $plan$ into query_plan;
  insert into identity_batch_plan values(query_plan);
  execute $actual_plan$
    explain (analyze, buffers, format json)
    with input_rows as materialized (
      select ordinality::integer input_index,value identity,nullif(btrim(value->>'masterUid'),'') master_uid,
        private.master_identity_item_key_v1(value->>'itemCode') item_key,
        private.master_identity_location_key_v1(value->>'locationCode') location_key,
        upper(btrim(value->>'lotCode')) lot_key,
        case when upper(btrim(coalesce(value->>'source',''))) in ('','DOCK','DOCKS','SOC') then null
          else upper(btrim(value->>'source')) end source_key
      from jsonb_array_elements($1) with ordinality q(value,ordinality)
    ), matched as (
      select i.input_index,m.unique_id,to_jsonb(m) full_row from input_rows i
    left join lateral (
      select candidate.* from (
        select inv.* from public.ph_master_inventory inv
        where i.master_uid is not null and inv.unique_id=i.master_uid
          and (regexp_replace(upper('ADMIN'), '[^A-Z0-9]+', '', 'g') not like '%FOREMAN%'
            or (inv.priority is not null and inv.priority not in ('','-','--','---','N/A','NA','NULL','NONE')))
        union all
        select inv.* from public.ph_master_inventory inv
        where i.master_uid is null
          and private.master_identity_item_key_v1(inv.itemcode)=i.item_key
          and private.master_identity_location_key_v1(inv.locationcode)=i.location_key
          and upper(btrim(coalesce(inv.lotcode,'')))=i.lot_key
          and (i.source_key is null or upper(btrim(coalesce(inv.source,'')))=i.source_key)
          and (regexp_replace(upper('ADMIN'), '[^A-Z0-9]+', '', 'g') not like '%FOREMAN%'
            or (inv.priority is not null and inv.priority not in ('','-','--','---','N/A','NA','NULL','NONE')))
      ) candidate
      order by candidate.unique_id limit 2
    ) m on true
    ), grouped as (
      select input_index,count(unique_id)::integer match_count,
        case when count(unique_id)=1 then (array_agg(full_row) filter(where unique_id is not null))[1] else null end row
      from matched group by input_index
    )
    select coalesce(jsonb_agg(jsonb_build_object('inputIndex',input_index-1,
      'matchCount',least(match_count,2),'row',row) order by input_index),'[]'::jsonb)
    from grouped
  $actual_plan$ into query_plan using queue;
  insert into identity_batch_actual_plan values(query_plan);
  started_at:=clock_timestamp();
  response:=public.inventory_master_identity_batch_read_v1('9f8b0000-0000-4000-8000-000000000381',queue,'8101');
  batch_done_at:=clock_timestamp();
  select jsonb_agg(jsonb_build_object('itemcode',r.value#>>'{row,itemcode}',
    'locationcode',r.value#>>'{row,locationcode}') order by (r.value->>'inputIndex')::integer)
    into on_hand_pairs from jsonb_array_elements(response->'rows') r(value);
  loc_response:=public.inventory_location_on_hand_read_v1('9f8b0000-0000-4000-8000-000000000381',on_hand_pairs,'8101');
  loc_done_at:=clock_timestamp();
  insert into identity_batch_benchmark values(extract(epoch from batch_done_at-started_at)*1000,
    extract(epoch from loc_done_at-batch_done_at)*1000,
    extract(epoch from loc_done_at-started_at)*1000,
    (select count(*)::integer from information_schema.columns where table_schema='public' and table_name='ph_master_inventory'),
    response,loc_response);
end
$benchmark$;
select ok((select plan::text like '%ph_master_inventory_identity_batch_v1_idx%' from identity_batch_plan),
  'representative identity lookup plan uses the normalized selective expression index');
select is(jsonb_array_length((select result->'rows' from identity_batch_benchmark)),100,'the maximum 100 identity batch returns every requested result');
select is((select count(*) from jsonb_array_elements((select result->'rows' from identity_batch_benchmark)) r(value)
  where value->>'matchCount'='1'),100::bigint,'the representative batch resolves 100 of 100 unique identities');
select diag('identity lookup plan='||(select plan::text from identity_batch_plan));
select diag('actual branched lookup plan='||(select plan::text from identity_batch_actual_plan));
select ok((select plan::text like '%ph_master_inventory_identity_batch_v1_idx%' from identity_batch_actual_plan),
  'actual RPC-shaped lookup plan uses the normalized selective identity index');
select diag('100-source identity batch ms='||(select round(elapsed_ms,3)::text from identity_batch_benchmark)||
  '; LOC_ON_HAND RPC ms='||(select round(loc_elapsed_ms,3)::text from identity_batch_benchmark)||
  '; combined full-row plus LOC_ON_HAND ms='||(select round(combined_elapsed_ms,3)::text from identity_batch_benchmark)||
  '; physical columns='||(select full_column_count::text from identity_batch_benchmark));
select ok((select elapsed_ms<100 from identity_batch_benchmark),'100-source identity batch is under the interactive 100 ms gate on 10000 synthetic inventory rows');
select is((select count(*)::integer from jsonb_object_keys((select result#>'{rows,0,row}' from identity_batch_benchmark))),
  (select full_column_count from identity_batch_benchmark),'resolved rows preserve every physical master column');
select is(jsonb_array_length((select loc_result->'rows' from identity_batch_benchmark)),100,
  'the resolved full rows are enriched with all 100 receipt-fenced LOC_ON_HAND aggregates');
select ok((select combined_elapsed_ms<100 from identity_batch_benchmark),
  '100 full rows plus receipt-fenced LOC_ON_HAND aggregates remain under the interactive 100 ms DB gate');

select * from finish();
rollback;
