begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Keep the same typed snapshot while replacing per-row FK and index writes
-- with bounded durable batches. Previously queued jobs keep their old rows.
create table private.erp_drive_archive_batches_v3048 (
  publication_id uuid not null references private.erp_drive_archive_jobs_v3048(publication_id),
  batch_number integer not null check(batch_number>0),
  source_rows public.ph_master_inventory[] not null,
  constraint erp_drive_archive_batch_size_v3048 check(cardinality(source_rows) between 1 and 500),
  primary key(publication_id,batch_number)
);
revoke all on private.erp_drive_archive_batches_v3048 from public,anon,authenticated,service_role;

create or replace function private.freeze_erp_drive_archive_v3048(p_publication uuid,p_meta jsonb)
returns jsonb language plpgsql set search_path='' as $freeze$
declare copied integer;
begin
  insert into private.erp_drive_archive_jobs_v3048(publication_id,file_id,file_meta)
  values(p_publication,p_meta->>'file_id',p_meta);
  with ordered as (
    select master as source_row,((row_number() over(order by master.unique_id)-1)/500+1)::integer batch_number
    from public.ph_master_inventory master
  ), packed as (
    insert into private.erp_drive_archive_batches_v3048(publication_id,batch_number,source_rows)
    select p_publication,batch_number,array_agg(source_row) from ordered group by batch_number
    returning cardinality(source_rows) as row_count
  ) select coalesce(sum(row_count),0)::integer into copied from packed;
  update private.erp_drive_archive_jobs_v3048 set source_rows=copied where publication_id=p_publication;
  return jsonb_build_object('archive_state','queued','archive_source_rows',copied,'archive_publication_id',p_publication,
    'report_rows',0,'history_rows',0);
end
$freeze$;

create or replace function private.read_erp_drive_archive_rows_v3048(p_file text)
returns setof public.ph_master_inventory language sql stable set search_path='' as $rows$
  select master.* from public.ph_master_inventory master
  where nullif(current_setting('agdata.erp.drive_archive_job_v3048',true),'') is null
  union all
  select (r.source_row).* from private.erp_drive_archive_rows_v3048 r
  join private.erp_drive_archive_jobs_v3048 j using(publication_id)
  where j.publication_id=nullif(current_setting('agdata.erp.drive_archive_job_v3048',true),'')::uuid
    and j.file_id=p_file and j.archived_at is null
  union all
  select frozen.* from private.erp_drive_archive_batches_v3048 batch
  join private.erp_drive_archive_jobs_v3048 j using(publication_id)
  cross join lateral unnest(batch.source_rows) frozen
  where j.publication_id=nullif(current_setting('agdata.erp.drive_archive_job_v3048',true),'')::uuid
    and j.file_id=p_file and j.archived_at is null
$rows$;

do $drain$
declare
  definition text := pg_get_functiondef('private.drain_erp_drive_archive_v3048()'::regprocedure);
  anchor text := '    delete from private.erp_drive_archive_rows_v3048 where publication_id=job.publication_id;';
begin
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'ERP_PACKED_DRIVE_ARCHIVE_DRAIN_ANCHOR_MISSING'; end if;
  execute replace(definition,anchor,anchor||chr(10)||replace(anchor,'archive_rows','archive_batches'));
end
$drain$;

commit;
