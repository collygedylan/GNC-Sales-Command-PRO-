-- Use the real guarded importer and confine destructive pruning to fixture rows.
do $fixture$
declare
  definition text := pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
  anchor text := '    delete from public.ph_master_inventory live'||chr(10)||'    where not exists';
begin
  if strpos(definition,anchor)=0 then raise exception 'ERP_DELTA_FIXTURE_PRUNE_ANCHOR'; end if;
  execute replace(definition,anchor,'    delete from public.ph_master_inventory live'||chr(10)||
    '    where live.unique_id like ''erp-delta-fixture-%'' and not exists');
end
$fixture$;

select set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,
  ptronhand,ptrreviewed,ptravailable,erp_on_hand,erp_ptrreview,erp_available,erp_source_present,spec,photo_link,filename)
values
 ('erp-delta-fixture-same','ERP-DELTA-3046','#fixture','#2','X.91.001','28.F1','PH',
  '10','2','8',10,2,8,true,'keep spec','https://fixture/same.jpg','old.xlsx'),
 ('erp-delta-fixture-stock','ERP-DELTA-3046','#fixture','#2','X.91.002','28.F1','PH',
  '10','2','8',10,2,8,true,'keep spec','https://fixture/stock.jpg','old.xlsx');
do $evaluation$
declare uid text;
begin
  perform set_config('app.eval_publication_v309','on',true);
  foreach uid in array array['erp-delta-fixture-same','erp-delta-fixture-stock'] loop
    perform set_config('app.eval_publication_uid_v309',uid,true);
    update public.ph_master_inventory set spec='keep spec',match='80',loc_match_qty='6',
      loc_match_pct=80,loc_photo_match=6,initial_loc_photo_match=6,eval_baseline_available=8,photo_date=clock_timestamp()
    where unique_id=uid;
  end loop;
  perform set_config('app.eval_publication_v309','off',true);
end
$evaluation$;
create temporary table erp_delta_fixture_input as
select m.unique_id as canonical_uid,'raw-'||m.unique_id as source_uid,m.ctid as before_location,
  jsonb_build_object('unique_id','raw-'||m.unique_id,'itemcode',m.itemcode,
    'commonname',case when m.unique_id='erp-delta-fixture-stock' then 'Changed nursery name' else m.commonname end,
    'contsize',m.contsize,'locationcode',m.locationcode,'lotcode',m.lotcode,'source',m.source,
    'ptronhand',case when m.unique_id='erp-delta-fixture-stock' then '12' else m.ptronhand end,
    'ptrreviewed',m.ptrreviewed,'ptravailable',case when m.unique_id='erp-delta-fixture-stock' then '10' else m.ptravailable end,
    'filename','new.xlsx','spec',null,'photo_link',null) as incoming
from public.ph_master_inventory m where m.unique_id in ('erp-delta-fixture-same','erp-delta-fixture-stock');
select public.begin_dataset_import_v1(array['ph_master_inventory'],'a3046000-0000-4000-8000-000000000046',
  array['ph_master_inventory'])->>'state';
insert into app_sync_private.ph_master_bulk_import_source_v1(canonical_unique_id,source_unique_id,source_hash,import_run_id)
select canonical_uid,source_uid,repeat('f',64),'a3046000-0000-4000-8000-000000000046'
from erp_delta_fixture_input on conflict(canonical_unique_id) do update
set source_unique_id=excluded.source_unique_id,source_hash=excluded.source_hash;
insert into app_sync_private.ph_master_inventory_source_baselines(canonical_unique_id,lineage_key,import_run_id)
select canonical_uid,private.ph_master_inventory_lineage_key_v1(incoming),'a3046000-0000-4000-8000-000000000046'
from erp_delta_fixture_input on conflict(canonical_unique_id) do update set lineage_key=excluded.lineage_key;
insert into app_sync_private.ph_master_inventory_item6_source_v7(canonical_unique_id,stable_identity_key,field_values)
select canonical_uid,private.ph_master_inventory_stable_identity_v7(incoming),'{}'
from erp_delta_fixture_input on conflict(canonical_unique_id) do nothing;

do $test$
declare
  run_id uuid := 'a3046000-0000-4000-8000-000000000046';
  payload jsonb;
  result jsonb;
begin
  select jsonb_agg(jsonb_build_object('values',incoming,'rawFields','[]'::jsonb)) into payload from erp_delta_fixture_input;
  result:=public.bulk_import_master_snapshot_v1(run_id,'a3046000-0000-4000-8000-000000000047',payload,repeat('a',64));
  if (select count(*) from pg_temp.ph_master_bulk_prior_alias_v3046)<>2
    or not exists(select 1 from public.ph_master_inventory m join erp_delta_fixture_input i on i.canonical_uid=m.unique_id
      where m.unique_id='erp-delta-fixture-same' and m.ctid=i.before_location and m.filename='old.xlsx')
    or not exists(select 1 from public.ph_master_inventory where unique_id='erp-delta-fixture-stock'
      and commonname='Changed nursery name' and erp_on_hand=12)
    or exists(select 1 from public.ph_master_inventory where unique_id in ('erp-delta-fixture-same','erp-delta-fixture-stock')
      and (spec is distinct from 'keep spec' or photo_link is null)) then
    raise exception 'ERP_DELTA_FIXTURE_RESULT: %, aliases: %, rows: %',result,
      (select count(*) from pg_temp.ph_master_bulk_prior_alias_v3046),
      (select jsonb_agg(jsonb_build_array(m.unique_id,m.spec,m.photo_link,m.ptronhand,m.filename))
        from public.ph_master_inventory m join erp_delta_fixture_input i on i.canonical_uid=m.unique_id);
  end if;
  insert into pg_temp.ph_master_bulk_stage_v1(row_number,unique_id)
  values (100,'erp-delta-fixture-same');
  if exists(select 1 from private.prior_drive_source_aliases_v3046()
    where canonical_unique_id='erp-delta-fixture-same') then
    raise exception 'ERP_DELTA_FIXTURE_ALIAS_BEAT_EXACT_UID';
  end if;
end
$test$;
