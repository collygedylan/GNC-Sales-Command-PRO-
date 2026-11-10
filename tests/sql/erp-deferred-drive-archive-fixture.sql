-- Limit the real freeze to fixture UIDs without changing the archived type.
do $scope$
declare
  definition text := pg_get_functiondef('private.freeze_erp_drive_archive_v3048(uuid,jsonb)'::regprocedure);
  anchor text := 'from public.ph_master_inventory master';
begin
  if strpos(definition,anchor)=0 then raise exception 'ERP_ARCHIVE_FIXTURE_SCOPE_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,anchor||' where unique_id like ''drive-archive-fixture-%''');
end
$scope$;

select set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,ptronhand,ptravailable,spec,holdstopcode)
values ('drive-archive-fixture-a','DRIVE-ARCHIVE-FIXTURE','D.08.000','28.F1','7','6','Frozen spec','H'),
  ('drive-archive-fixture-b','DRIVE-ARCHIVE-FIXTURE','D.08.001','28.F1','8','5','Second exact row',null);

do $test$
declare
  publication uuid := 'a3048000-0000-4000-8000-000000000041';
  metadata jsonb := private.fast_erp_file_meta_v2369('{"file_id":"drive-archive-fixture-file","file_name":"fixture.xlsx","modified_at":"2026-11-09T12:00:00Z"}');
  uid text;
  receipt jsonb;
begin
  perform set_config('app.eval_publication_v309','on',true);
  foreach uid in array array['drive-archive-fixture-a','drive-archive-fixture-b'] loop
    perform set_config('app.eval_publication_uid_v309',uid,true);
    update public.ph_master_inventory set spec=case when uid='drive-archive-fixture-a' then 'Frozen spec' else 'Second exact row' end
    where unique_id=uid;
  end loop;
  perform set_config('app.eval_publication_v309','off',true);
  receipt:=private.freeze_erp_drive_archive_v3048(publication,metadata);
  if receipt->>'archive_state' is distinct from 'queued' or receipt->>'archive_source_rows' is distinct from '2'
    or exists(select 1 from public.ph_drive_around_report_files where file_id=metadata->>'file_id') then
    raise exception 'ERP_ARCHIVE_FREEZE_NOT_DEFERRED: %',receipt;
  end if;
  update public.ph_master_inventory set spec='Later edit',ptronhand='99' where unique_id='drive-archive-fixture-a';
  delete from public.ph_master_inventory where unique_id='drive-archive-fixture-b';
  insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode)
  values ('drive-archive-fixture-c','DRIVE-ARCHIVE-FIXTURE','D.08.002','28.F1');

  if private.drain_erp_drive_archive_v3048()<>1 then
    raise exception 'ERP_ARCHIVE_FIXTURE_DRAIN_FAILED: %',
      (select last_sqlstate from private.erp_drive_archive_jobs_v3048 where publication_id=publication);
  end if;
  if not exists(select 1 from public.ph_drive_around_report_files where file_id=metadata->>'file_id'
    and row_count=2 and hold_row_count=1 and status='processed')
    or not exists(select 1 from public.ph_drive_around_report_rows where file_id=metadata->>'file_id'
      and unique_id=md5((metadata->>'file_id')||'|drive-archive-fixture-a') and ptronhand='7')
    or not exists(select 1 from public.ph_drive_mode_history where source_file_id=metadata->>'file_id'
      and source_unique_id='drive-archive-fixture-a' and spec='Frozen spec')
    or not exists(select 1 from public.ph_drive_mode_history where source_file_id=metadata->>'file_id'
      and source_unique_id='drive-archive-fixture-b' and spec='Second exact row')
    or exists(select 1 from public.ph_drive_mode_history where source_file_id=metadata->>'file_id' and source_unique_id='drive-archive-fixture-c')
    or not exists(select 1 from private.drive_mode_projection_receipts_v3039 where file_id=metadata->>'file_id' and row_count=2)
    or exists(select 1 from private.erp_drive_archive_rows_v3048 where publication_id=publication) then
    raise exception 'ERP_ARCHIVE_DID_NOT_PRESERVE_PUBLISHED_SNAPSHOT: manifest %, raw %, history %, frozen %',
      (select jsonb_build_array(row_count,hold_row_count,status) from public.ph_drive_around_report_files where file_id=metadata->>'file_id'),
      (select jsonb_agg(jsonb_build_array(unique_id,ptronhand)) from public.ph_drive_around_report_rows where file_id=metadata->>'file_id'),
      (select jsonb_agg(jsonb_build_array(source_unique_id,spec)) from public.ph_drive_mode_history where source_file_id=metadata->>'file_id'),
      (select count(*) from private.erp_drive_archive_rows_v3048 where publication_id=publication);
  end if;
end
$test$;

do $retry$
declare
  publication uuid := 'a3048000-0000-4000-8000-000000000042';
  drained integer;
begin
  perform private.freeze_erp_drive_archive_v3048(publication,'{"file_id":"drive-archive-fixture-invalid"}');
  update private.erp_drive_archive_jobs_v3048 set attempts=2 where publication_id=publication;
  drained:=private.drain_erp_drive_archive_v3048();
  perform set_config('agdata.erp.drive_archive_job_v3048',publication::text,true);
  if drained<>0
    or not exists(select 1 from private.erp_drive_archive_jobs_v3048 where publication_id=publication
      and attempts=3 and last_sqlstate='22023' and next_attempt_at>clock_timestamp() and archived_at is null)
    or (select count(*) from private.read_erp_drive_archive_rows_v3048('drive-archive-fixture-invalid'))<>2
    or exists(select 1 from public.ph_drive_around_report_files where file_id='drive-archive-fixture-invalid') then
    raise exception 'ERP_ARCHIVE_FAILURE_LOST_SNAPSHOT_OR_BOUNDED_RETRY';
  end if;
  perform set_config('agdata.erp.drive_archive_job_v3048','',true);
end
$retry$;
