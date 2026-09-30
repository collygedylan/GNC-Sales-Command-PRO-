-- Shared authenticated configuration for the Manager > Eval Reports module.
-- Report rows continue to come directly from ph_master_inventory; this table
-- stores only the three manager-controlled thresholds.

create table if not exists public.ph_eval_report_settings (
  singleton boolean primary key default true check (singleton),
  low_stock_max_slts numeric not null default 150
    check (low_stock_max_slts >= 0 and low_stock_max_slts <= 100000000),
  hold_age_days integer not null default 5
    check (hold_age_days >= 0 and hold_age_days <= 3650),
  location_note_age_days integer not null default 10
    check (location_note_age_days >= 0 and location_note_age_days <= 3650),
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ph_eval_report_settings (
  singleton,
  low_stock_max_slts,
  hold_age_days,
  location_note_age_days
) values (true, 150, 5, 10)
on conflict (singleton) do nothing;

alter table public.ph_eval_report_settings enable row level security;

revoke all on table public.ph_eval_report_settings from public, anon, authenticated;
grant select on table public.ph_eval_report_settings to authenticated;
grant select, insert, update, delete on table public.ph_eval_report_settings to service_role;

drop policy if exists ph_eval_report_settings_manager_read on public.ph_eval_report_settings;
create policy ph_eval_report_settings_manager_read
on public.ph_eval_report_settings
for select
to authenticated
using ((select private.can_manage_eval_assignments()));

create or replace function public.get_eval_report_settings()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  settings public.ph_eval_report_settings%rowtype;
begin
  if not private.can_manage_eval_assignments() then
    raise exception using errcode = '42501', message = 'EVAL_REPORT_SETTINGS_FORBIDDEN';
  end if;

  select s.* into settings
  from public.ph_eval_report_settings s
  where s.singleton
  limit 1;

  return jsonb_build_object(
    'low_stock_max_slts', coalesce(settings.low_stock_max_slts, 150),
    'hold_age_days', coalesce(settings.hold_age_days, 5),
    'location_note_age_days', coalesce(settings.location_note_age_days, 10),
    'updated_by', settings.updated_by,
    'updated_at', settings.updated_at
  );
end;
$$;

create or replace function public.set_eval_report_settings(
  low_stock_max_slts numeric,
  hold_age_days integer,
  location_note_age_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.ph_eval_report_settings%rowtype;
  manager_username text;
begin
  if not private.can_manage_eval_assignments() then
    raise exception using errcode = '42501', message = 'EVAL_REPORT_SETTINGS_FORBIDDEN';
  end if;
  if low_stock_max_slts is null
     or low_stock_max_slts < 0
     or low_stock_max_slts > 100000000 then
    raise exception using errcode = '22023', message = 'EVAL_REPORT_LOW_STOCK_LIMIT_INVALID';
  end if;
  if hold_age_days is null or hold_age_days < 0 or hold_age_days > 3650 then
    raise exception using errcode = '22023', message = 'EVAL_REPORT_HOLD_AGE_INVALID';
  end if;
  if location_note_age_days is null
     or location_note_age_days < 0
     or location_note_age_days > 3650 then
    raise exception using errcode = '22023', message = 'EVAL_REPORT_LOCATION_NOTE_AGE_INVALID';
  end if;

  manager_username := (private.current_active_profile()).username;

  insert into public.ph_eval_report_settings (
    singleton,
    low_stock_max_slts,
    hold_age_days,
    location_note_age_days,
    updated_by,
    updated_at
  ) values (
    true,
    low_stock_max_slts,
    hold_age_days,
    location_note_age_days,
    manager_username,
    now()
  )
  on conflict (singleton) do update set
    low_stock_max_slts = excluded.low_stock_max_slts,
    hold_age_days = excluded.hold_age_days,
    location_note_age_days = excluded.location_note_age_days,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into settings;

  return jsonb_build_object(
    'low_stock_max_slts', settings.low_stock_max_slts,
    'hold_age_days', settings.hold_age_days,
    'location_note_age_days', settings.location_note_age_days,
    'updated_by', settings.updated_by,
    'updated_at', settings.updated_at
  );
end;
$$;

revoke all on function public.get_eval_report_settings() from public, anon;
revoke all on function public.set_eval_report_settings(numeric, integer, integer) from public, anon;
grant execute on function public.get_eval_report_settings() to authenticated;
grant execute on function public.set_eval_report_settings(numeric, integer, integer) to authenticated;

comment on table public.ph_eval_report_settings is
  'Single-row configuration for Manager Eval Reports; inventory rows remain canonical in ph_master_inventory.';
comment on function public.get_eval_report_settings() is
  'Returns Eval Report thresholds to authenticated Dylan/Megan manager profiles.';
comment on function public.set_eval_report_settings(numeric, integer, integer) is
  'Validates and persists Eval Report thresholds for authenticated Dylan/Megan manager profiles.';
