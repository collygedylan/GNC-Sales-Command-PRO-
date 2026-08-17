-- Approval-gated execution support for V2026.08.16.10 backend cleanup.
-- The source relation remains authoritative until the separate finalize
-- migration is applied after parity verification.

create or replace function private.mirror_drive_around_compact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.ph_drive_around_report_rows%rowtype;
begin
  if tg_op = 'DELETE' then
    delete from public.ph_drive_around_report_rows_compact
    where unique_id = old.unique_id;
    return old;
  end if;

  v_row := new;
  if v_row.report_date < date '2025-08-16' then
    delete from public.ph_drive_around_report_rows_compact
    where unique_id = v_row.unique_id;
    return new;
  end if;

  insert into public.ph_drive_around_report_rows_compact (
    unique_id, file_id, file_name, report_date, row_number, item_key,
    itemcode, commonname, genus, contsize, locationcode, lotcode, season,
    blockalpha, salesyear, ptravailable, holdstopcode, holdstopreason,
    holdstopbegindate_raw, hold_reason_category, row_hash, created_at, updated_at
  ) values (
    v_row.unique_id, v_row.file_id, v_row.file_name, v_row.report_date,
    v_row.row_number, v_row.item_key, v_row.itemcode, v_row.commonname,
    v_row.genus, v_row.contsize, v_row.locationcode, v_row.lotcode,
    v_row.season, v_row.blockalpha, v_row.salesyear, v_row.ptravailable,
    v_row.holdstopcode, v_row.holdstopreason, v_row.holdstopbegindate_raw,
    v_row.hold_reason_category, v_row.row_hash, v_row.created_at, v_row.updated_at
  )
  on conflict (unique_id) do update set
    file_id = excluded.file_id,
    file_name = excluded.file_name,
    report_date = excluded.report_date,
    row_number = excluded.row_number,
    item_key = excluded.item_key,
    itemcode = excluded.itemcode,
    commonname = excluded.commonname,
    genus = excluded.genus,
    contsize = excluded.contsize,
    locationcode = excluded.locationcode,
    lotcode = excluded.lotcode,
    season = excluded.season,
    blockalpha = excluded.blockalpha,
    salesyear = excluded.salesyear,
    ptravailable = excluded.ptravailable,
    holdstopcode = excluded.holdstopcode,
    holdstopreason = excluded.holdstopreason,
    holdstopbegindate_raw = excluded.holdstopbegindate_raw,
    hold_reason_category = excluded.hold_reason_category,
    row_hash = excluded.row_hash,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;
  return new;
end;
$function$;

revoke all on function private.mirror_drive_around_compact()
  from public, anon, authenticated;

drop trigger if exists ph_drive_around_compact_mirror
  on public.ph_drive_around_report_rows;
create trigger ph_drive_around_compact_mirror
after insert or update or delete on public.ph_drive_around_report_rows
for each row execute function private.mirror_drive_around_compact();

create or replace function private.copy_drive_around_compact_batch_v2(
  p_cutoff_date date,
  p_after_unique_id text default '',
  p_batch_size integer default 100000
)
returns table(copied_rows bigint, next_cursor text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 100000), 1), 250000);
begin
  return query
  with source_batch as (
    select
      r.unique_id, r.file_id, r.file_name, r.report_date, r.row_number,
      r.item_key, r.itemcode, r.commonname, r.genus, r.contsize,
      r.locationcode, r.lotcode, r.season, r.blockalpha, r.salesyear,
      r.ptravailable, r.holdstopcode, r.holdstopreason,
      r.holdstopbegindate_raw, r.hold_reason_category, r.row_hash,
      r.created_at, r.updated_at
    from public.ph_drive_around_report_rows r
    where r.report_date >= p_cutoff_date
      and r.unique_id > coalesce(p_after_unique_id, '')
    order by r.unique_id
    limit v_batch_size
  ), written as (
    insert into public.ph_drive_around_report_rows_compact (
      unique_id, file_id, file_name, report_date, row_number, item_key,
      itemcode, commonname, genus, contsize, locationcode, lotcode, season,
      blockalpha, salesyear, ptravailable, holdstopcode, holdstopreason,
      holdstopbegindate_raw, hold_reason_category, row_hash, created_at, updated_at
    )
    select
      unique_id, file_id, file_name, report_date, row_number, item_key,
      itemcode, commonname, genus, contsize, locationcode, lotcode, season,
      blockalpha, salesyear, ptravailable, holdstopcode, holdstopreason,
      holdstopbegindate_raw, hold_reason_category, row_hash, created_at, updated_at
    from source_batch
    on conflict (unique_id) do update set
      file_id = excluded.file_id,
      file_name = excluded.file_name,
      report_date = excluded.report_date,
      row_number = excluded.row_number,
      item_key = excluded.item_key,
      itemcode = excluded.itemcode,
      commonname = excluded.commonname,
      genus = excluded.genus,
      contsize = excluded.contsize,
      locationcode = excluded.locationcode,
      lotcode = excluded.lotcode,
      season = excluded.season,
      blockalpha = excluded.blockalpha,
      salesyear = excluded.salesyear,
      ptravailable = excluded.ptravailable,
      holdstopcode = excluded.holdstopcode,
      holdstopreason = excluded.holdstopreason,
      holdstopbegindate_raw = excluded.holdstopbegindate_raw,
      hold_reason_category = excluded.hold_reason_category,
      row_hash = excluded.row_hash,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
    returning unique_id
  )
  select count(*)::bigint, max(unique_id) from written;
end;
$function$;

revoke all on function private.copy_drive_around_compact_batch_v2(date, text, integer)
  from public, anon, authenticated;
grant execute on function private.copy_drive_around_compact_batch_v2(date, text, integer)
  to service_role;

insert into public.ph_drive_around_compaction_runs (
  phase, cutoff_date, manifest
) values (
  'mirror_active',
  date '2025-08-16',
  jsonb_build_object(
    'release', 'V2026.08.16.10-backend-cleanup',
    'source_backup', 'Supabase physical backup 1389891049',
    'mirror_activated_at', now()
  )
);
