-- V2026.08.16.10 backend cleanup: approval-gated online table swap.
-- The pre-cleanup relation is retained under a rollback name until the
-- post-swap smoke checks pass. A separate migration performs the final drop.

do $guard$
begin
  if not exists (
    select 1
    from public.ph_drive_around_compaction_runs
    where phase = 'copy_verified'
      and cutoff_date = date '2025-08-16'
      and source_rows = shadow_rows
      and source_hash = shadow_hash
      and verified_at is not null
  ) then
    raise exception 'Drive Around compaction has not passed row/file/hash parity verification.';
  end if;
end;
$guard$;

set local lock_timeout = '15s';
set local statement_timeout = '5min';

lock table public.ph_drive_around_report_rows in access exclusive mode;
lock table public.ph_drive_around_report_rows_compact in access exclusive mode;

drop trigger if exists ph_drive_around_compact_mirror
  on public.ph_drive_around_report_rows;
drop function if exists private.mirror_drive_around_compact();
drop function if exists private.copy_drive_around_compact_batch_v2(date, text, integer);
drop function if exists private.copy_drive_around_compact_batch(date, text, integer);

drop view if exists public.v2_drive_around_report_rows;

alter table public.ph_drive_around_report_rows
  rename to ph_drive_around_report_rows_precleanup_20260816;
alter table public.ph_drive_around_report_rows_compact
  rename to ph_drive_around_report_rows;

alter table public.ph_drive_around_report_rows enable row level security;

revoke all on table public.ph_drive_around_report_rows from public, anon, authenticated;
grant select on table public.ph_drive_around_report_rows to anon, authenticated;
grant all on table public.ph_drive_around_report_rows to service_role;

drop policy if exists "Allow app read drive around compact rows"
  on public.ph_drive_around_report_rows;
create policy "Allow app read drive around compact rows"
  on public.ph_drive_around_report_rows
  for select
  using (true);

drop policy if exists "Allow service write drive around compact rows"
  on public.ph_drive_around_report_rows;
create policy "Allow service write drive around compact rows"
  on public.ph_drive_around_report_rows
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger trg_touch_v2_drive_around_report_rows_updated_at
before update on public.ph_drive_around_report_rows
for each row execute function public.touch_v2_drive_around_report_rows_updated_at();

create trigger trg_v2_drive_around_report_rows_classify_hold_reason
before insert or update of holdstopreason, hold_reason_category
on public.ph_drive_around_report_rows
for each row execute function public.v2_drive_around_report_rows_classify_hold_reason();

create view public.v2_drive_around_report_rows
with (security_invoker = true)
as
select
  unique_id,
  file_id,
  file_name,
  report_date,
  row_number,
  item_key,
  itemcode,
  commonname,
  genus,
  contsize,
  locationcode,
  lotcode,
  season,
  blockalpha,
  salesyear,
  ptravailable,
  holdstopcode,
  holdstopreason,
  holdstopbegindate_raw,
  hold_reason_category,
  row_hash,
  '{}'::jsonb as raw,
  created_at,
  updated_at
from public.ph_drive_around_report_rows;

revoke all on table public.v2_drive_around_report_rows from public;
grant select on table public.v2_drive_around_report_rows to anon, authenticated;
grant all on table public.v2_drive_around_report_rows to service_role;

update public.ph_drive_around_compaction_runs
set phase = 'swapped_pending_drop',
    manifest = coalesce(manifest, '{}'::jsonb) || jsonb_build_object(
      'swapped_at', now(),
      'rollback_relation', 'ph_drive_around_report_rows_precleanup_20260816'
    )
where id = (
  select id
  from public.ph_drive_around_compaction_runs
  where phase = 'copy_verified'
    and cutoff_date = date '2025-08-16'
  order by verified_at desc
  limit 1
);
