-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(5);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,
  ptronhand,ptravailable,source,season,saleyear)
values('drive-proof-3040-a','PROOF-A','Projection A','#3','C.17.001','27.F1','10','10','PH','F1','27'),
  ('drive-proof-3040-b','PROOF-B','Projection B','#3','C.17.001','27.F1','10','10','PH','F1','27');

insert into public.ph_drive_mode_history(history_key,source_kind,source_unique_id,source_file_id,report_date,archive_reason)
select md5('drive-proof-3040|'||unique_id),'drive_around',unique_id,'drive-proof-3040','2026-11-09','drive_file_snapshot'
from public.ph_master_inventory;
create temporary table drive_proof_count on commit drop as
select count(*)::integer as total from public.ph_master_inventory;

select ok(private.drive_mode_projection_matches_source_v3039('drive-proof-3040','2026-11-09',
  (select total from drive_proof_count)), 'the exact projection earns a publication receipt');
update public.ph_drive_mode_history set source_unique_id='different-source'
where history_key=md5('drive-proof-3040|drive-proof-3040-a');
select ok(not private.drive_mode_projection_matches_source_v3039('drive-proof-3040','2026-11-09',
  (select total from drive_proof_count)), 'equal counts do not excuse a mismatched physical source');
update public.ph_drive_mode_history set source_unique_id='drive-proof-3040-a',report_date='2026-11-08'
where history_key=md5('drive-proof-3040|drive-proof-3040-a');
select ok(not private.drive_mode_projection_matches_source_v3039('drive-proof-3040','2026-11-09',
  (select total from drive_proof_count)), 'the receipt requires the exact report date');

with cases(values_json,raw_fields) as (values
  ('{"itemcode":"003129.030.1","ptronhand":"0","filename":"source.xlsx","assignedto":"owner","spec":null}'::jsonb,
    array['spec','ptronhand']),
  ('{}'::jsonb,array[]::text[]),(null::jsonb,null::text[]))
select ok(bool_and(private.ph_master_bulk_source_hash_v1(values_json,raw_fields) =
  encode(extensions.digest(convert_to(jsonb_build_object(
    'values',coalesce((select jsonb_object_agg(key,value order by key) from jsonb_each(values_json)
      where key not in ('last_updated','filename','concat','assignedto')),'{}'::jsonb),
    'rawFields',to_jsonb(coalesce(raw_fields,'{}'::text[])))::text,'UTF8'),'sha256'),'hex')),
  'bulk source hashes preserve the original digest bytes') from cases;

select ok(not has_function_privilege('service_role','private.drive_mode_projection_matches_source_v3039(text,date,integer)','execute'),
  'the projection proof remains private to the publisher');
select * from finish();
rollback;
