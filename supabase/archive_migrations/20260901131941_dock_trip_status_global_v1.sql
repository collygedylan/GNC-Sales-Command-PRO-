-- Shared dock team/status assignments are keyed by TRIPNUMBER. The previous
-- dock-number/local-storage implementation is retained only as historical
-- compatibility data; new writes use this protected contract.

create table if not exists public.ph_dock_trip_status (
  tripnumber text primary key,
  dock_num text,
  checker text,
  inspector text,
  mistake text,
  status text not null default 'Loading',
  revision bigint not null default 1,
  updated_by_username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ph_dock_trip_status_tripnumber_required check (btrim(tripnumber) <> '' and length(tripnumber) <= 80),
  constraint ph_dock_trip_status_dock_num_length check (dock_num is null or length(dock_num) <= 80),
  constraint ph_dock_trip_status_checker_length check (checker is null or length(checker) <= 120),
  constraint ph_dock_trip_status_inspector_length check (inspector is null or length(inspector) <= 120),
  constraint ph_dock_trip_status_mistake_length check (mistake is null or length(mistake) <= 120),
  constraint ph_dock_trip_status_actor_required check (btrim(updated_by_username) <> '' and length(updated_by_username) <= 120),
  constraint ph_dock_trip_status_revision_positive check (revision > 0),
  constraint ph_dock_trip_status_value check (status in ('Loading', 'Missing > 10', 'Missing < 5', 'Palletize', 'Complete'))
);

create index if not exists ph_dock_trip_status_dock_num_idx
  on public.ph_dock_trip_status (dock_num, tripnumber);
create index if not exists ph_dock_trip_status_updated_at_idx
  on public.ph_dock_trip_status (updated_at desc, tripnumber);

create table if not exists public.ph_dock_trip_status_audit (
  id bigint generated always as identity primary key,
  tripnumber text not null,
  prior_value jsonb,
  next_value jsonb not null,
  actor_username text not null,
  created_at timestamptz not null default now(),
  constraint ph_dock_trip_status_audit_trip_required check (btrim(tripnumber) <> '' and length(tripnumber) <= 80),
  constraint ph_dock_trip_status_audit_actor_required check (btrim(actor_username) <> '' and length(actor_username) <= 120)
);

create index if not exists ph_dock_trip_status_audit_trip_idx
  on public.ph_dock_trip_status_audit (tripnumber, created_at desc, id desc);

alter table public.ph_dock_trip_status enable row level security;
alter table public.ph_dock_trip_status_audit enable row level security;

revoke all on table public.ph_dock_trip_status from public, anon, authenticated;
revoke all on table public.ph_dock_trip_status_audit from public, anon, authenticated;
grant select, insert, update, delete on table public.ph_dock_trip_status to service_role;
grant select, insert on table public.ph_dock_trip_status_audit to service_role;
grant usage, select on sequence public.ph_dock_trip_status_audit_id_seq to service_role;

create or replace function public.save_dock_trip_status_v1(
  p_tripnumber text,
  p_dock_num text,
  p_checker text,
  p_inspector text,
  p_mistake text,
  p_status text,
  p_actor_username text,
  p_expected_revision bigint default null
)
returns public.ph_dock_trip_status
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  trip_value text := btrim(coalesce(p_tripnumber, ''));
  dock_value text := nullif(btrim(coalesce(p_dock_num, '')), '');
  checker_value text := nullif(btrim(coalesce(p_checker, '')), '');
  inspector_value text := nullif(btrim(coalesce(p_inspector, '')), '');
  mistake_value text := nullif(btrim(coalesce(p_mistake, '')), '');
  status_value text := btrim(coalesce(p_status, ''));
  actor_value text := btrim(coalesce(p_actor_username, ''));
  current_row public.ph_dock_trip_status%rowtype;
  saved_row public.ph_dock_trip_status%rowtype;
  prior_json jsonb;
begin
  if trip_value = '' or length(trip_value) > 80 then
    raise exception using errcode = '22023', message = 'dock_trip_required';
  end if;
  if actor_value = '' or length(actor_value) > 120 then
    raise exception using errcode = '22023', message = 'dock_trip_actor_required';
  end if;
  if status_value not in ('Loading', 'Missing > 10', 'Missing < 5', 'Palletize', 'Complete') then
    raise exception using errcode = '22023', message = 'dock_trip_status_invalid';
  end if;
  if length(coalesce(dock_value, '')) > 80
     or length(coalesce(checker_value, '')) > 120
     or length(coalesce(inspector_value, '')) > 120
     or length(coalesce(mistake_value, '')) > 120 then
    raise exception using errcode = '22023', message = 'dock_trip_value_too_long';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('dock-trip-status:' || upper(trip_value), 0));

  select * into current_row
  from public.ph_dock_trip_status
  where upper(btrim(tripnumber)) = upper(trip_value)
  for update;

  if found then
    if p_expected_revision is not null and p_expected_revision <> current_row.revision then
      raise exception using errcode = '40001', message = 'dock_trip_revision_conflict';
    end if;
    prior_json := to_jsonb(current_row);
    update public.ph_dock_trip_status
    set
      dock_num = dock_value,
      checker = checker_value,
      inspector = inspector_value,
      mistake = mistake_value,
      status = status_value,
      revision = current_row.revision + 1,
      updated_by_username = actor_value,
      updated_at = now()
    where tripnumber = current_row.tripnumber
    returning * into saved_row;
  else
    if p_expected_revision is not null and p_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'dock_trip_revision_conflict';
    end if;
    insert into public.ph_dock_trip_status (
      tripnumber, dock_num, checker, inspector, mistake, status,
      revision, updated_by_username, created_at, updated_at
    ) values (
      trip_value, dock_value, checker_value, inspector_value, mistake_value, status_value,
      1, actor_value, now(), now()
    )
    returning * into saved_row;
  end if;

  insert into public.ph_dock_trip_status_audit (
    tripnumber, prior_value, next_value, actor_username
  ) values (
    saved_row.tripnumber, prior_json, to_jsonb(saved_row), actor_value
  );

  return saved_row;
end;
$$;

revoke all on function public.save_dock_trip_status_v1(text, text, text, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.save_dock_trip_status_v1(text, text, text, text, text, text, text, bigint)
  to service_role;

comment on table public.ph_dock_trip_status is
  'Shared Dock workflow team and status keyed by normalized TRIPNUMBER. Browser table writes are denied.';
comment on table public.ph_dock_trip_status_audit is
  'Append-only audit trail for shared TRIPNUMBER Dock workflow updates.';
comment on function public.save_dock_trip_status_v1(text, text, text, text, text, text, text, bigint) is
  'Service-role-only transactional Dock status save with revision checking and audit.';
