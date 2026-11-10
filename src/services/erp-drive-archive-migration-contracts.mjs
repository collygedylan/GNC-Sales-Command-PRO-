export function erpDeferredDriveArchiveContract() {
  return `select
    (select strpos(prosrc,'freeze_erp_drive_archive_v3048(run_id,meta)')>0 and strpos(prosrc,'fast_archive_drive_v2369(meta)')=0
      from pg_proc where oid=to_regprocedure('public.fast_ingest_drive_around_v2374_base(jsonb,jsonb)'))
    and (select strpos(prosrc,'read_erp_drive_archive_rows_v3048')>0 from pg_proc
      where oid=to_regprocedure('private.fast_archive_drive_v2369(jsonb)'))
    and not has_table_privilege('service_role',to_regclass('private.erp_drive_archive_rows_v3048'),'SELECT')
    and not has_function_privilege('authenticated',to_regprocedure('private.drain_erp_drive_archive_v3048()'),'EXECUTE')
    and exists(select 1 from cron.job where jobname='agdata-erp-drive-archive-v3048'
      and position('20s' in command)>0 and position('private.drain_erp_drive_archive_v3048()' in command)>0) as installed`;
}

export function erpPackedDriveArchiveContract() {
  return `select
    exists(select 1 from pg_attribute where attrelid=to_regclass('private.erp_drive_archive_batches_v3048')
      and attname='source_rows' and atttypid=to_regtype('public.ph_master_inventory[]') and attnotnull)
    and exists(select 1 from pg_constraint where conrelid=to_regclass('private.erp_drive_archive_batches_v3048')
      and conname='erp_drive_archive_batch_size_v3048' and convalidated
      and strpos(pg_get_constraintdef(oid),'cardinality(source_rows) <= 500')>0)
    and strpos(pg_get_functiondef(to_regprocedure('private.freeze_erp_drive_archive_v3048(uuid,jsonb)')),
      'array_agg(source_row)')>0
    and (select strpos(prosrc,'from private.erp_drive_archive_rows_v3048')>0
      and strpos(prosrc,'unnest(batch.source_rows)')>0 from pg_proc
      where oid=to_regprocedure('private.read_erp_drive_archive_rows_v3048(text)'))
    and strpos(pg_get_functiondef(to_regprocedure('private.drain_erp_drive_archive_v3048()')),
      'delete from private.erp_drive_archive_batches_v3048')>0
    and not has_table_privilege('service_role',to_regclass('private.erp_drive_archive_batches_v3048'),'SELECT') as installed`;
}
