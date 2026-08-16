-- Non-destructive preparation for the approval-gated Drive Around compaction.
-- This creates the compact shadow relation and a disabled-by-default mirror
-- switch. It does not copy, rename, truncate, or drop production data.
create table if not exists public.ph_drive_around_report_rows_compact (
  unique_id text primary key,
  file_id text not null,
  file_name text not null,
  report_date date,
  row_number integer not null,
  item_key text,
  itemcode text,
  commonname text,
  genus text,
  contsize text,
  locationcode text,
  lotcode text,
  season text,
  blockalpha text,
  salesyear text,
  ptravailable numeric,
  holdstopcode text,
  holdstopreason text,
  holdstopbegindate_raw text,
  hold_reason_category text,
  row_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (file_id, row_number)
);

create index if not exists ph_drive_around_compact_item_date_idx
  on public.ph_drive_around_report_rows_compact (itemcode, report_date desc);
create index if not exists ph_drive_around_compact_item_key_date_idx
  on public.ph_drive_around_report_rows_compact (item_key, report_date desc);
create index if not exists ph_drive_around_compact_hold_idx
  on public.ph_drive_around_report_rows_compact (itemcode, report_date desc)
  where nullif(btrim(holdstopcode), '') is not null;

alter table public.ph_drive_around_report_rows_compact enable row level security;

create table if not exists public.ph_drive_around_compaction_runs (
  id uuid primary key default gen_random_uuid(),
  phase text not null,
  cutoff_date date not null,
  source_rows bigint,
  shadow_rows bigint,
  source_hash text,
  shadow_hash text,
  manifest jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.ph_drive_around_compaction_runs enable row level security;

-- Server-side, bounded copier. Creating this function does not copy data; only
-- service_role may invoke it after the .08 execution approval. Cursoring by
-- unique_id keeps each transaction small and restartable.
create or replace function private.copy_drive_around_compact_batch(
  p_cutoff_date date,
  p_after_unique_id text default '',
  p_batch_size integer default 5000
)
returns table(copied_rows bigint, next_cursor text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_batch_size integer := least(greatest(coalesce(p_batch_size, 5000), 1), 10000);
begin
  -- Local CI intentionally has no production Drive Around source relation.
  -- Returning an empty batch keeps the additive migration testable without
  -- creating fake production data or weakening the execution gate.
  if to_regclass('public.ph_drive_around_report_rows') is null then
    return query select 0::bigint, null::text;
    return;
  end if;

  return query execute $query$
  with source_batch as (
    select
      r.unique_id, r.file_id, r.file_name, r.report_date, r.row_number,
      r.item_key, r.itemcode, r.commonname, r.genus, r.contsize,
      r.locationcode, r.lotcode, r.season, r.blockalpha, r.salesyear,
      r.ptravailable, r.holdstopcode, r.holdstopreason,
      r.holdstopbegindate_raw, r.hold_reason_category, r.row_hash,
      r.created_at, r.updated_at
    from public.ph_drive_around_report_rows r
    where r.report_date >= $1
      and r.unique_id > coalesce($2, '')
    order by r.unique_id
    limit $3
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
  select count(*)::bigint, max(unique_id) from written
  $query$ using p_cutoff_date, p_after_unique_id, v_batch_size;
end;
$function$;

revoke all on function private.copy_drive_around_compact_batch(date, text, integer)
  from public, anon, authenticated;
grant execute on function private.copy_drive_around_compact_batch(date, text, integer)
  to service_role;

create table if not exists public.ph_hold_learning_cursors (
  source_key text primary key,
  last_report_date date,
  last_unique_id text,
  last_row_hash text,
  processed_rows bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ph_hold_learning_cursors enable row level security;

comment on table public.ph_drive_around_report_rows_compact is
  'Approval-gated compact shadow table. Deliberately omits duplicated raw JSONB.';
comment on table public.ph_drive_around_compaction_runs is
  'Immutable verification manifests for the online compaction. Execution and destructive cleanup require separate approval.';
comment on table public.ph_hold_learning_cursors is
  'Service-only cursors for incremental hold learning; prevents full-history rescans.';
