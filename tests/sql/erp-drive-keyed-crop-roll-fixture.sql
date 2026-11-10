select set_config('request.jwt.claim.role','service_role',true);
select public.begin_dataset_import_v1(array['ph_master_inventory'],'a3048000-0000-4000-8000-000000000021',
  array['ph_master_inventory'])->>'state';
select set_config('request.headers','{"x-gnc-import-run-id":"a3048000-0000-4000-8000-000000000021"}',true);
select set_config('agdata.bulk_import.ph_master_inventory','on',true);
insert into app_sync_private.ph_master_bulk_import_context_v1(run_id,request_id,backend_pid,transaction_id,
  source_unique_id,canonical_unique_id,raw_values,raw_item6_fields,source_hash,new_insert_verified)
values ('a3048000-0000-4000-8000-000000000021','a3048000-0000-4000-8000-000000000022',pg_backend_pid(),txid_current(),
  'crop-keyed-keep','crop-keyed-keep','{}',array[]::text[],repeat('a',64),false);

insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,ptronhand,last_updated)
values ('crop-keyed-keep','ERP-CROP-FIXTURE','D.08.004','28.F1','7','2026-11-08T04:00:00Z'),
  ('crop-keyed-edit','ERP-CROP-FIXTURE','D.08.005','28.F1','10','2026-11-08T04:00:00Z');
delete from public.ph_crop_roll_drive_rows where unique_id in ('crop-keyed-keep','crop-keyed-edit');
insert into public.ph_crop_roll_drive_rows(unique_id,master_unique_id,itemcode,locationcode,source_table,crop_roll_view)
values ('crop-keyed-missing-projection','crop-keyed-missing-master','ERP-CROP-FIXTURE','D.08.006','ph_master_inventory','drive'),
  ('crop-keyed-unrelated','crop-keyed-unrelated-master','ERP-CROP-FIXTURE','D.08.007','ph_master_inventory','drive');

do $test$
declare
  run_id uuid := 'a3048000-0000-4000-8000-000000000021';
  request_id uuid := 'a3048000-0000-4000-8000-000000000022';
  touched text[] := array['crop-keyed-keep','crop-keyed-edit','crop-keyed-missing-master','crop-keyed-edit',null];
  result jsonb;
  keep_tid tid;
  prior_master_stamp timestamptz;
begin
  begin
    perform private.sync_ph_master_bulk_crop_roll_v1(run_id,request_id,touched);
    raise exception 'ERP_CROP_ROLL_MISSING_CONTEXT_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm<>'BULK_CROP_ROLL_SYNC_CONTEXT_INVALID' then raise; end if;
  end;

  perform set_config('gnc.master_bulk_crop_roll_deferred',run_id::text||':'||request_id::text,true);
  result:=private.sync_ph_master_bulk_crop_roll_v1(run_id,request_id,touched);
  if result is distinct from '{"touched":3,"deleted":1,"upserted":2,"context":"import"}'::jsonb
    or exists(select 1 from public.ph_crop_roll_drive_rows where unique_id='crop-keyed-missing-projection')
    or not exists(select 1 from public.ph_crop_roll_drive_rows where unique_id='crop-keyed-unrelated') then
    raise exception 'ERP_CROP_ROLL_TOUCHED_JOIN_CHANGED: %',result;
  end if;

  select ctid into keep_tid from public.ph_crop_roll_drive_rows where unique_id='crop-keyed-keep';
  select master_updated_at into prior_master_stamp from public.ph_crop_roll_drive_rows where unique_id='crop-keyed-edit';
  result:=private.sync_ph_master_bulk_crop_roll_v1(run_id,request_id,touched);
  if result->>'upserted' is distinct from '0' then raise exception 'ERP_CROP_ROLL_REWROTE_IDENTICAL_PROJECTION: %',result; end if;

  update public.ph_master_inventory set last_updated='2026-11-09T04:00:00Z' where unique_id='crop-keyed-edit';
  update public.ph_crop_roll_drive_rows set master_updated_at=prior_master_stamp where unique_id='crop-keyed-edit';
  result:=private.sync_ph_master_bulk_crop_roll_v1(run_id,request_id,touched);
  if result->>'upserted' is distinct from '1'
    or not exists(select 1 from public.ph_crop_roll_drive_rows where unique_id='crop-keyed-edit'
      and master_updated_at='2026-11-09T04:00:00Z' and ptronhand='10')
    or not exists(select 1 from public.ph_crop_roll_drive_rows where unique_id='crop-keyed-keep' and ctid=keep_tid) then
    raise exception 'ERP_CROP_ROLL_CHANGED_PROJECTION_NOT_PUBLISHED: %',result;
  end if;
end
$test$;
