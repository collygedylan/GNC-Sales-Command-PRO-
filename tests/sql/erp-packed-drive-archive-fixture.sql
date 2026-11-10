-- Run after erp-deferred-drive-archive-fixture.sql in the same rollback.
do $legacy$
declare publication uuid := 'a3048000-0000-4000-8000-000000000043';
  meta jsonb := private.fast_erp_file_meta_v2369('{"file_id":"drive-archive-legacy-fixture","file_name":"legacy.xlsx","modified_at":"2026-11-09T12:00:00Z"}');
  drained integer;
begin
  insert into private.erp_drive_archive_jobs_v3048(publication_id,file_id,file_meta,source_rows)
  values(publication,meta->>'file_id',meta,1);
  insert into private.erp_drive_archive_rows_v3048(publication_id,source_uid,source_row)
  select publication,m.unique_id,m from public.ph_master_inventory m where unique_id='drive-archive-fixture-c';
  update public.ph_master_inventory set ptronhand='37' where unique_id='drive-archive-fixture-c';
  drained:=private.drain_erp_drive_archive_v3048();
  if drained<>1
    or not exists(select 1 from public.ph_drive_around_report_rows where file_id=meta->>'file_id'
      and unique_id=md5((meta->>'file_id')||'|drive-archive-fixture-c') and ptronhand is distinct from '37')
    or exists(select 1 from private.erp_drive_archive_rows_v3048 where publication_id=publication) then
    raise exception 'ERP_PACKED_DRIVE_ARCHIVE_LOST_LEGACY_QUEUE';
  end if;
end
$legacy$;

create function pg_temp.fail_drive_archive_after_raw_write()
returns trigger language plpgsql as $fault$
begin
  if current_setting('gnc.fixture_drive_archive_cancel',true)='on' then
    raise query_canceled using message='fixture archive cancellation after raw writes';
  end if;
  return null;
end
$fault$;
create trigger erp_drive_fixture_archive_fault after insert on public.ph_drive_mode_history
for each row when (new.source_file_id='drive-archive-partial-fixture')
execute function pg_temp.fail_drive_archive_after_raw_write();

do $partial$
declare publication uuid := 'a3048000-0000-4000-8000-000000000044';
  meta jsonb := private.fast_erp_file_meta_v2369('{"file_id":"drive-archive-partial-fixture","file_name":"partial.xlsx","modified_at":"2026-11-09T12:00:00Z"}');
  drained integer;
begin
  perform private.freeze_erp_drive_archive_v3048(publication,meta);
  perform set_config('gnc.fixture_drive_archive_cancel','on',true);
  drained:=private.drain_erp_drive_archive_v3048();
  if drained<>0
    or not exists(select 1 from private.erp_drive_archive_jobs_v3048 where publication_id=publication
      and attempts=1 and last_sqlstate='57014' and archived_at is null and next_attempt_at>clock_timestamp())
    or not exists(select 1 from private.erp_drive_archive_batches_v3048 where publication_id=publication
      and cardinality(source_rows)=2)
    or exists(select 1 from public.ph_drive_around_report_files where file_id=meta->>'file_id')
    or exists(select 1 from public.ph_drive_around_report_rows where file_id=meta->>'file_id') then
    raise exception 'ERP_PACKED_DRIVE_ARCHIVE_CANCEL_DID_NOT_ROLL_BACK';
  end if;
  perform set_config('gnc.fixture_drive_archive_cancel','off',true);
  if private.drain_erp_drive_archive_v3048()<>0 then raise exception 'ERP_PACKED_DRIVE_ARCHIVE_RETRY_TOO_EARLY'; end if;
  update private.erp_drive_archive_jobs_v3048 set next_attempt_at=clock_timestamp() where publication_id=publication;
  drained:=private.drain_erp_drive_archive_v3048();
  if drained<>1
    or not exists(select 1 from private.drive_mode_projection_receipts_v3039 where file_id=meta->>'file_id' and row_count=2)
    or exists(select 1 from private.erp_drive_archive_batches_v3048 where publication_id=publication) then
    raise exception 'ERP_PACKED_DRIVE_ARCHIVE_RETRY_DID_NOT_PUBLISH';
  end if;
end
$partial$;

create temporary table drive_archive_batch_source (like public.ph_master_inventory including defaults);
insert into drive_archive_batch_source(unique_id,itemcode,locationcode,lotcode)
select 'drive-archive-fixture-pack-'||lpad(ordinal::text,4,'0'),'DRIVE-PACKED-FIXTURE','D.08.000','28.F1'
from generate_series(1,501) ordinal;
do $capacity$
declare definition text := pg_get_functiondef('private.freeze_erp_drive_archive_v3048(uuid,jsonb)'::regprocedure);
  publication uuid := 'a3048000-0000-4000-8000-000000000045';
begin
  definition:=replace(definition,'public.ph_master_inventory master','pg_temp.drive_archive_batch_source master');
  execute replace(definition,'select master as source_row','select row(master.*)::public.ph_master_inventory as source_row');
  perform private.freeze_erp_drive_archive_v3048(publication,'{"file_id":"drive-archive-capacity-fixture"}');
  perform set_config('agdata.erp.drive_archive_job_v3048',publication::text,true);
  if (select array_agg(cardinality(source_rows) order by batch_number) from private.erp_drive_archive_batches_v3048
      where publication_id=publication) is distinct from array[500,1]
    or (select count(distinct unique_id) from private.read_erp_drive_archive_rows_v3048('drive-archive-capacity-fixture'))<>501
    or exists(select 1 from private.read_erp_drive_archive_rows_v3048('another-file')) then
    raise exception 'ERP_PACKED_DRIVE_ARCHIVE_CAP_OR_JOB_FENCE_LOST';
  end if;
  perform set_config('agdata.erp.drive_archive_job_v3048','',true);
end
$capacity$;
