begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- The raw Drive manifest reports the source file's count before the compact
-- projection is written. The projection gets its own end-of-write receipt.
create table private.drive_mode_projection_receipts_v3039 (
  file_id text primary key,
  report_date date not null,
  row_count integer not null check(row_count>=0),
  published_at timestamptz not null default clock_timestamp()
);
revoke all on private.drive_mode_projection_receipts_v3039 from public,anon,authenticated,service_role;

create function private.drive_mode_projection_matches_source_v3039(p_file text,p_date date,p_count integer)
returns boolean language sql stable set search_path='' as $function$
  with projected as materialized (
    select history_key,source_unique_id,report_date
    from public.ph_drive_mode_history
    where source_kind='drive_around' and archive_reason='drive_file_snapshot' and source_file_id=p_file
  )
  select (select count(*) from projected)=p_count
    and (select count(*) from public.ph_master_inventory)=p_count
    and not exists(select 1 from public.ph_master_inventory master
      where not exists(select 1 from projected
        where source_unique_id=master.unique_id and history_key=md5(p_file||'|'||master.unique_id)
          and report_date::text=p_date::text))
$function$;

create function private.finish_drive_mode_projection_v3039(p_file text,p_raw_rows integer,p_history_rows integer)
returns jsonb language plpgsql set search_path='' as $function$
declare receipt record;
begin
  select report_date,row_count into receipt from public.ph_drive_around_report_files
    where file_id=p_file and status='processed' and processed_at is not null and raw->>'pipeline'='fast-live-erp-v2369';
  if receipt.report_date is not null and receipt.row_count=p_history_rows
    and private.drive_mode_projection_matches_source_v3039(p_file,receipt.report_date,receipt.row_count) then
    insert into private.drive_mode_projection_receipts_v3039(file_id,report_date,row_count)
      values(p_file,receipt.report_date,receipt.row_count)
      on conflict(file_id) do update set report_date=excluded.report_date,row_count=excluded.row_count,
        published_at=clock_timestamp();
  else
    delete from private.drive_mode_projection_receipts_v3039 where file_id=p_file;
  end if;
  return jsonb_build_object('report_rows',p_raw_rows,'history_rows',p_history_rows);
end
$function$;

-- Preserve the fast writer's input, source metadata, auth and response. A
-- failed projection proof leaves the file ineligible without blocking ERP.
do $bind_drive_projection_receipt$
declare source text; rewritten text;
  anchor text:='return jsonb_build_object(''report_rows'',row_count,''history_rows'',history_count);';
begin
  source:=pg_get_functiondef('private.fast_archive_drive_v2369(jsonb)'::regprocedure);
  if (length(source)-length(replace(source,anchor,'')))<>length(anchor) then
    raise exception 'DRIVE_MODE_PROJECTION_WRITER_ANCHOR_INVALID';
  end if;
  rewritten:=replace(source,anchor,
    'return private.finish_drive_mode_projection_v3039(meta->>''file_id'',row_count,history_count);');
  execute rewritten;
end
$bind_drive_projection_receipt$;

revoke all on function private.drive_mode_projection_matches_source_v3039(text,date,integer),
  private.finish_drive_mode_projection_v3039(text,integer,integer) from public,anon,authenticated,service_role;

commit;
