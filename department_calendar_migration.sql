-- Safe, repeatable department calendar schema migration for Supabase.
-- Supports time off requests, supervisor approval, projects, and meetings.

create extension if not exists pgcrypto;

create table if not exists public.v2_department_calendar_events (
    unique_id text primary key
);

alter table public.v2_department_calendar_events add column if not exists unique_id text;
alter table public.v2_department_calendar_events add column if not exists department text;
alter table public.v2_department_calendar_events add column if not exists event_type text;
alter table public.v2_department_calendar_events add column if not exists title text;
alter table public.v2_department_calendar_events add column if not exists description text;
alter table public.v2_department_calendar_events add column if not exists start_at timestamptz;
alter table public.v2_department_calendar_events add column if not exists end_at timestamptz;
alter table public.v2_department_calendar_events add column if not exists all_day boolean;
alter table public.v2_department_calendar_events add column if not exists requested_by_username text;
alter table public.v2_department_calendar_events add column if not exists requested_by_display text;
alter table public.v2_department_calendar_events add column if not exists assigned_to_username text;
alter table public.v2_department_calendar_events add column if not exists assigned_to_display text;
alter table public.v2_department_calendar_events add column if not exists status text;
alter table public.v2_department_calendar_events add column if not exists approved_by_username text;
alter table public.v2_department_calendar_events add column if not exists approved_by_display text;
alter table public.v2_department_calendar_events add column if not exists approved_at timestamptz;
alter table public.v2_department_calendar_events add column if not exists created_at timestamptz;
alter table public.v2_department_calendar_events add column if not exists updated_at timestamptz;

update public.v2_department_calendar_events
set
    unique_id = coalesce(nullif(unique_id, ''), gen_random_uuid()::text),
    department = coalesce(nullif(department, ''), 'General'),
    event_type = case
        when coalesce(nullif(event_type, ''), 'meeting') in ('time_off', 'project', 'meeting')
            then coalesce(nullif(event_type, ''), 'meeting')
        else 'meeting'
    end,
    title = coalesce(nullif(title, ''), 'Calendar Event'),
    start_at = coalesce(start_at, now()),
    end_at = coalesce(end_at, start_at, now()),
    all_day = coalesce(all_day, false),
    status = case
        when coalesce(nullif(status, ''), 'approved') in ('requested', 'approved', 'denied', 'cancelled')
            then coalesce(nullif(status, ''), 'approved')
        else 'approved'
    end,
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, created_at, now());

alter table public.v2_department_calendar_events alter column unique_id set not null;
alter table public.v2_department_calendar_events alter column department set default 'General';
alter table public.v2_department_calendar_events alter column department set not null;
alter table public.v2_department_calendar_events alter column event_type set default 'meeting';
alter table public.v2_department_calendar_events alter column event_type set not null;
alter table public.v2_department_calendar_events alter column title set default 'Calendar Event';
alter table public.v2_department_calendar_events alter column title set not null;
alter table public.v2_department_calendar_events alter column start_at set default now();
alter table public.v2_department_calendar_events alter column start_at set not null;
alter table public.v2_department_calendar_events alter column end_at set default now();
alter table public.v2_department_calendar_events alter column end_at set not null;
alter table public.v2_department_calendar_events alter column all_day set default false;
alter table public.v2_department_calendar_events alter column all_day set not null;
alter table public.v2_department_calendar_events alter column status set default 'approved';
alter table public.v2_department_calendar_events alter column status set not null;
alter table public.v2_department_calendar_events alter column created_at set default now();
alter table public.v2_department_calendar_events alter column created_at set not null;
alter table public.v2_department_calendar_events alter column updated_at set default now();
alter table public.v2_department_calendar_events alter column updated_at set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'v2_department_calendar_events_event_type_check'
          and conrelid = 'public.v2_department_calendar_events'::regclass
    ) then
        alter table public.v2_department_calendar_events
            add constraint v2_department_calendar_events_event_type_check
            check (event_type in ('time_off', 'project', 'meeting'));
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'v2_department_calendar_events_status_check'
          and conrelid = 'public.v2_department_calendar_events'::regclass
    ) then
        alter table public.v2_department_calendar_events
            add constraint v2_department_calendar_events_status_check
            check (status in ('requested', 'approved', 'denied', 'cancelled'));
    end if;
end $$;

create unique index if not exists uq_v2_department_calendar_events_unique_id
    on public.v2_department_calendar_events (unique_id);

create index if not exists idx_v2_department_calendar_events_department_start
    on public.v2_department_calendar_events (department, start_at);

create index if not exists idx_v2_department_calendar_events_status
    on public.v2_department_calendar_events (status);

create index if not exists idx_v2_department_calendar_events_assigned
    on public.v2_department_calendar_events (assigned_to_username);

alter table public.v2_department_calendar_events enable row level security;

drop policy if exists "Allow app department calendar events" on public.v2_department_calendar_events;
create policy "Allow app department calendar events"
    on public.v2_department_calendar_events
    for all
    using (true)
    with check (true);

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1
            from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'v2_department_calendar_events'
        ) then
            begin
                alter publication supabase_realtime add table public.v2_department_calendar_events;
            exception
                when duplicate_object then null;
                when invalid_parameter_value then null;
                when object_not_in_prerequisite_state then null;
            end;
        end if;
    end if;
end $$;
