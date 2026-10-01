-- Isolated CI fixture for the existing production calendar table. The full
-- production baseline defines this table; the historical CI subset does not.
create table public.ph_department_calendar_events (
  unique_id text primary key,
  department text not null default 'General',
  event_type text not null default 'meeting'
    check (event_type in ('time_off', 'project', 'meeting')),
  title text not null default 'Calendar Event',
  description text,
  start_at timestamptz not null default now(),
  end_at timestamptz not null default now(),
  all_day boolean not null default false,
  requested_by_username text,
  requested_by_display text,
  assigned_to_username text,
  assigned_to_display text,
  status text not null default 'approved'
    check (status in ('requested', 'approved', 'denied', 'cancelled')),
  approved_by_username text,
  approved_by_display text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  assigned_usernames jsonb not null default '[]'::jsonb,
  assigned_displays jsonb not null default '[]'::jsonb,
  recurrence_type text not null default 'none'
    check (recurrence_type in ('none', 'weekly', 'biweekly', 'monthly')),
  recurrence_interval integer not null default 1,
  recurrence_until timestamptz
);

alter table public.ph_department_calendar_events enable row level security;
create policy "Allow app department calendar events"
  on public.ph_department_calendar_events using (true) with check (true);
grant select on table public.ph_department_calendar_events to anon, authenticated;
grant all on table public.ph_department_calendar_events to service_role;
