begin;

create schema if not exists extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.core_employees (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 200),
  emp_number text not null unique check (length(btrim(emp_number)) between 1 and 64),
  department text not null check (length(btrim(department)) between 1 and 120),
  role text not null default '',
  hired_date date,
  vacation_balance numeric(8,2) not null default 0 check (vacation_balance >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hr_job_codes (
  job_code text primary key check (length(btrim(job_code)) between 1 and 64),
  description text not null default '',
  department text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hr_events (
  id uuid primary key default gen_random_uuid(),
  emp_number text not null references public.core_employees(emp_number) on update cascade on delete restrict,
  event_type text not null check (event_type in ('disciplinary_action','transfer','promotion')),
  effective_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.labor_timesheets (
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null references public.core_employees(id) on delete restrict,
  work_date date not null,
  job_code text not null references public.hr_job_codes(job_code) on update cascade on delete restrict,
  hours numeric(5,2) not null check (hours >= 0 and hours <= 24),
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, work_date),
  constraint labor_timesheets_employee_work_job_unique unique (employee_id, work_date, job_code)
) partition by range (work_date);

create table public.labor_timesheets_default partition of public.labor_timesheets default;
do $$
declare month_start date := date '2025-01-01';
  month_end date;
  partition_name text;
begin
  while month_start < date '2036-01-01' loop
    month_end := (month_start + interval '1 month')::date;
    partition_name := 'labor_timesheets_' || to_char(month_start, 'YYYYMM');
    execute format(
      'create table if not exists public.%I partition of public.labor_timesheets for values from (%L) to (%L)',
      partition_name, month_start, month_end
    );
    month_start := month_end;
  end loop;
end;
$$;
create index labor_timesheets_employee_date_idx on public.labor_timesheets (employee_id, work_date desc);
create index hr_events_employee_effective_idx on public.hr_events (emp_number, effective_at desc);

alter table public.ph_department_calendar_events add column if not exists hr_source_event_id text;
create unique index if not exists ph_department_calendar_hr_source_user_uidx
  on public.ph_department_calendar_events (hr_source_event_id, assigned_to_username)
  where hr_source_event_id is not null;

create table public.hr_calendar_reminder_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null check (event_type in ('time_off_tomorrow','meeting_day_before','meeting_t1h','meeting_t30m','meeting_t15m')),
  calendar_event_id text not null,
  recipient_username text not null default 'dylan_collyge' check (recipient_username = 'dylan_collyge'),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index hr_calendar_reminder_outbox_claim_idx
  on public.hr_calendar_reminder_outbox (status, next_attempt_at, created_at);

create or replace function private.hr_active_username_v1()
returns text language sql stable security definer set search_path to '' as $$
  select lower(btrim(p.username)) from public.profiles p
  where p.id = (select auth.uid()) and p.disabled_at is null and p.must_change_password is false
    and (p.locked_until is null or p.locked_until <= now()) limit 1
$$;
revoke all on function private.hr_active_username_v1() from public, anon;
grant execute on function private.hr_active_username_v1() to authenticated;
grant usage on schema private to authenticated, service_role;

create or replace function private.hr_department_access_v1(target_department text)
returns boolean language sql stable security definer set search_path to '' as $$
  select coalesce(
    private.hr_active_username_v1() = 'dylan_collyge'
    or (false and private.hr_active_username_v1() = 'megan_kelly' and target_department = 'Plant Evaluators')
    or (false and private.hr_active_username_v1() = 'sharon_combs' and target_department = 'Kiers & Counters'),
    false
  )
$$;
revoke all on function private.hr_department_access_v1(text) from public, anon;
grant execute on function private.hr_department_access_v1(text) to authenticated;

create or replace function private.hr_labor_employee_access_v1(target_employee_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.core_employees e where e.id = target_employee_id
    and private.hr_department_access_v1(e.department))
$$;
revoke all on function private.hr_labor_employee_access_v1(uuid) from public, anon;
grant execute on function private.hr_labor_employee_access_v1(uuid) to authenticated;

alter table public.core_employees enable row level security;
alter table public.hr_job_codes enable row level security;
alter table public.hr_events enable row level security;
alter table public.labor_timesheets enable row level security;
alter table public.hr_calendar_reminder_outbox enable row level security;
alter table realtime.messages enable row level security;

create policy hr_core_employees_select on public.core_employees for select to authenticated
  using (private.hr_department_access_v1(department));
create policy hr_core_employees_insert on public.core_employees for insert to authenticated
  with check (private.hr_department_access_v1(department));
create policy hr_core_employees_update on public.core_employees for update to authenticated
  using (private.hr_department_access_v1(department)) with check (private.hr_department_access_v1(department));
create policy hr_core_employees_delete on public.core_employees for delete to authenticated
  using (private.hr_department_access_v1(department));

create policy hr_job_codes_select on public.hr_job_codes for select to authenticated
  using (private.hr_department_access_v1(coalesce(department, '')));
create policy hr_job_codes_insert on public.hr_job_codes for insert to authenticated
  with check (private.hr_department_access_v1(coalesce(department, '')));
create policy hr_job_codes_update on public.hr_job_codes for update to authenticated
  using (private.hr_department_access_v1(coalesce(department, '')))
  with check (private.hr_department_access_v1(coalesce(department, '')));
create policy hr_job_codes_delete on public.hr_job_codes for delete to authenticated
  using (private.hr_department_access_v1(coalesce(department, '')));

create policy hr_events_select on public.hr_events for select to authenticated
  using (exists (select 1 from public.core_employees e where e.emp_number = hr_events.emp_number
    and private.hr_department_access_v1(e.department)));
create policy hr_events_insert on public.hr_events for insert to authenticated
  with check (created_by_profile_id = (select auth.uid()) and exists (
    select 1 from public.core_employees e where e.emp_number = hr_events.emp_number
      and private.hr_department_access_v1(e.department)));

create policy hr_labor_select on public.labor_timesheets for select to authenticated
  using (private.hr_labor_employee_access_v1(employee_id));
create policy hr_labor_insert on public.labor_timesheets for insert to authenticated
  with check (created_by_profile_id = (select auth.uid()) and private.hr_labor_employee_access_v1(employee_id));
create policy hr_labor_update on public.labor_timesheets for update to authenticated
  using (private.hr_labor_employee_access_v1(employee_id))
  with check (created_by_profile_id = (select auth.uid()) and private.hr_labor_employee_access_v1(employee_id));
create policy hr_labor_delete on public.labor_timesheets for delete to authenticated
  using (private.hr_labor_employee_access_v1(employee_id));

create policy alpha_dylan_chat_realtime_select on realtime.messages for select to authenticated
  using (private.hr_active_username_v1() = 'dylan_collyge'
    and realtime.topic() like 'alpha-chat:dylan_collyge:%');
create policy alpha_dylan_chat_realtime_insert on realtime.messages for insert to authenticated
  with check (private.hr_active_username_v1() = 'dylan_collyge'
    and realtime.topic() like 'alpha-chat:dylan_collyge:%');

create or replace function private.hr_events_append_only_v1()
returns trigger language plpgsql set search_path to '' as $$
begin
  raise exception using errcode = '42501', message = 'hr_events_append_only';
end;
$$;
create trigger hr_events_append_only before update or delete on public.hr_events
  for each row execute function private.hr_events_append_only_v1();
create trigger hr_events_no_truncate before truncate on public.hr_events
  for each statement execute function private.hr_events_append_only_v1();

create or replace function private.hr_reconcile_time_off_out_v1()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  target_username text;
  target_profile public.profiles%rowtype;
  target_employee public.core_employees%rowtype;
  derived_id text;
  target_usernames text[];
begin
  if coalesce(new.hr_source_event_id, '') <> '' or new.event_type <> 'time_off' then return new; end if;
  select coalesce(array_agg(distinct lower(btrim(value))), '{}'::text[]) into target_usernames
  from jsonb_array_elements_text(coalesce(new.assigned_usernames, '[]'::jsonb) ||
    case when nullif(btrim(coalesce(new.assigned_to_username, '')), '') is null then '[]'::jsonb
         else jsonb_build_array(new.assigned_to_username) end) value
  where nullif(btrim(value), '') is not null;

  if new.status <> 'approved' then
    update public.ph_department_calendar_events set status = 'cancelled', updated_at = now()
      where hr_source_event_id = new.unique_id and status <> 'cancelled';
    return new;
  end if;

  foreach target_username in array target_usernames loop
    select p.* into target_profile from public.profiles p where lower(btrim(p.username)) = target_username
      and p.disabled_at is null and p.must_change_password is false
      and (p.locked_until is null or p.locked_until <= now()) limit 1;
    if target_profile.id is null then continue; end if;
    select e.* into target_employee from public.core_employees e
      where e.profile_id = target_profile.id and e.active is true limit 1;
    if target_employee.id is null then continue; end if;

    derived_id := 'hr-out-' || md5(new.unique_id || ':' || target_username);
    insert into public.ph_department_calendar_events (
      unique_id, department, event_type, title, description, start_at, end_at, all_day,
      requested_by_username, requested_by_display, assigned_to_username, assigned_to_display,
      status, approved_by_username, approved_by_display, approved_at, assigned_usernames,
      assigned_displays, recurrence_type, recurrence_interval, created_at, updated_at, hr_source_event_id
    ) values (
      derived_id, target_employee.department, 'time_off', 'OUT - ' || target_employee.name,
      coalesce(new.description, 'Approved time off'), new.start_at, new.end_at, new.all_day,
      coalesce(new.requested_by_username, target_username), coalesce(new.requested_by_display, target_employee.name),
      target_username, target_employee.name, 'approved', coalesce(new.approved_by_username, 'dylan_collyge'),
      new.approved_by_display, coalesce(new.approved_at, now()), jsonb_build_array(target_username),
      jsonb_build_array(target_employee.name), 'none', 1, now(), now(), new.unique_id
    ) on conflict (hr_source_event_id, assigned_to_username) where hr_source_event_id is not null
    do update set department = excluded.department, title = excluded.title, description = excluded.description,
      start_at = excluded.start_at, end_at = excluded.end_at, all_day = excluded.all_day,
      status = 'approved', approved_by_username = excluded.approved_by_username,
      approved_by_display = excluded.approved_by_display, approved_at = excluded.approved_at, updated_at = now();
  end loop;

  update public.ph_department_calendar_events set status = 'cancelled', updated_at = now()
    where hr_source_event_id = new.unique_id and status = 'approved'
      and not (assigned_to_username = any(target_usernames));
  return new;
end;
$$;
revoke all on function private.hr_reconcile_time_off_out_v1() from public, anon, authenticated;
create trigger hr_reconcile_time_off_out after insert or update of status, start_at, end_at, assigned_to_username,
  assigned_usernames, department, title, description on public.ph_department_calendar_events
  for each row execute function private.hr_reconcile_time_off_out_v1();

create or replace function private.hr_enqueue_calendar_reminders_v1(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path to '' as $$
declare inserted_count integer;
begin
  with local_clock as (select p_now, p_now at time zone 'America/Chicago' as chicago_now), candidates as (
    select e.unique_id, e.start_at as scheduled_at, 'time_off_tomorrow'::text as event_type,
      jsonb_build_object('calendarEventId', e.unique_id, 'title', 'Time off tomorrow',
        'bodyPreview', coalesce(nullif(e.title, ''), 'Approved time off') || ' is scheduled for tomorrow.') as payload
    from public.ph_department_calendar_events e cross join local_clock c
    where e.event_type = 'time_off' and e.status = 'approved' and e.hr_source_event_id is not null
      and (e.start_at at time zone 'America/Chicago')::date = (c.chicago_now::date + 1)
      and c.chicago_now::time >= time '13:00' and c.chicago_now::time < time '13:05'
    union all
    select e.unique_id, e.start_at as scheduled_at, due.event_type,
      jsonb_build_object('calendarEventId', e.unique_id, 'title', due.title,
        'bodyPreview', coalesce(nullif(e.title, ''), 'Meeting') || due.suffix) as payload
    from public.ph_department_calendar_events e cross join local_clock c
    cross join lateral (
      select 'meeting_day_before'::text as event_type, 'Meeting tomorrow'::text as title,
        ' is scheduled for tomorrow.'::text as suffix,
        (((e.start_at at time zone 'America/Chicago')::date - 1)::timestamp + time '09:00') at time zone 'America/Chicago' as due_at
      union all select 'meeting_t1h', 'Meeting in one hour', ' starts in about one hour.', e.start_at - interval '1 hour'
      union all select 'meeting_t30m', 'Meeting in 30 minutes', ' starts in about 30 minutes.', e.start_at - interval '30 minutes'
      union all select 'meeting_t15m', 'Meeting in 15 minutes', ' starts in about 15 minutes.', e.start_at - interval '15 minutes'
    ) due
    where e.event_type = 'meeting' and e.status = 'approved' and e.start_at > c.p_now
      and c.p_now >= due.due_at and c.p_now < due.due_at + interval '5 minutes'
  ), inserted as (
    insert into public.hr_calendar_reminder_outbox (event_key, event_type, calendar_event_id, recipient_username, payload)
    select 'hr-calendar:' || md5(c.event_type || ':' || c.unique_id || ':' || c.scheduled_at::text),
      c.event_type, c.unique_id, 'dylan_collyge', c.payload from candidates c
    on conflict (event_key) do nothing returning 1
  ) select count(*)::integer into inserted_count from inserted;
  return coalesce(inserted_count, 0);
end;
$$;

create or replace function public.hr_claim_calendar_reminders_v1(p_limit integer default 50)
returns setof public.hr_calendar_reminder_outbox language sql security definer set search_path to '' as $$
  with candidates as (
    select id, status from public.hr_calendar_reminder_outbox
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'processing' and lease_expires_at <= now())
    order by created_at, id limit greatest(1, least(coalesce(p_limit, 50), 100)) for update skip locked
  )
  update public.hr_calendar_reminder_outbox o set status = 'processing', lease_expires_at = now() + interval '2 minutes',
    attempt_count = o.attempt_count + case when c.status = 'processing' then 1 else 0 end
  from candidates c where o.id = c.id returning o.*
$$;

create or replace function public.hr_finish_calendar_reminder_v1(p_id uuid, p_delivered boolean, p_error_code text default null)
returns void language plpgsql security definer set search_path to '' as $$
begin
  update public.hr_calendar_reminder_outbox
  set attempt_count = attempt_count + 1,
      status = case when p_delivered then 'sent' when attempt_count + 1 >= 5 then 'failed' else 'pending' end,
      next_attempt_at = case when p_delivered then next_attempt_at else now() + make_interval(secs => least(3600, 60 * (2 ^ least(attempt_count, 5))::integer)) end,
      lease_expires_at = null,
      last_error_code = case when p_delivered then null else left(coalesce(p_error_code, 'delivery_failed'), 80) end,
      sent_at = case when p_delivered then now() else sent_at end
  where id = p_id and status = 'processing';
end;
$$;
create or replace function private.hr_purge_calendar_reminders_v1()
returns integer language plpgsql security definer set search_path to '' as $$
declare deleted_count integer;
begin
  delete from public.hr_calendar_reminder_outbox
    where status in ('sent','failed') and coalesce(sent_at, created_at) < now() - interval '180 days';
  get diagnostics deleted_count = row_count;
  return coalesce(deleted_count, 0);
end;
$$;
revoke all on function private.hr_enqueue_calendar_reminders_v1(timestamptz) from public, anon, authenticated;
revoke all on function public.hr_claim_calendar_reminders_v1(integer) from public, anon, authenticated;
revoke all on function public.hr_finish_calendar_reminder_v1(uuid,boolean,text) from public, anon, authenticated;
revoke all on function private.hr_purge_calendar_reminders_v1() from public, anon, authenticated;
grant execute on function public.hr_claim_calendar_reminders_v1(integer) to service_role;
grant execute on function public.hr_finish_calendar_reminder_v1(uuid,boolean,text) to service_role;

create or replace function private.hr_dispatch_calendar_reminder_sweep_v1()
returns void language plpgsql security definer set search_path to '' as $$
declare project_url text; service_key text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'hr_calendar_project_url' limit 1;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'hr_calendar_service_role_key' limit 1;
  if coalesce(project_url, '') = '' or coalesce(service_key, '') = '' then
    raise warning 'HR calendar reminder Vault credentials are missing'; return;
  end if;
  perform private.hr_purge_calendar_reminders_v1();
  perform private.hr_enqueue_calendar_reminders_v1(now());
  perform net.http_post(url := rtrim(project_url, '/') || '/functions/v1/calendar-reminder-sweep',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || service_key),
    body := jsonb_build_object('source','pg_cron'), timeout_milliseconds := 5000);
end;
$$;
revoke all on function private.hr_dispatch_calendar_reminder_sweep_v1() from public, anon, authenticated;
do $$
declare prior_job bigint;
begin
  select jobid into prior_job from cron.job where jobname = 'hr_calendar_reminder_sweep' limit 1;
  if prior_job is not null then perform cron.unschedule(prior_job); end if;
  perform cron.schedule('hr_calendar_reminder_sweep', '*/5 * * * *', 'select private.hr_dispatch_calendar_reminder_sweep_v1();');
end;
$$;

revoke all on public.core_employees, public.hr_job_codes, public.hr_events, public.labor_timesheets, public.hr_calendar_reminder_outbox from anon, authenticated;
grant select, insert, update, delete on public.core_employees, public.hr_job_codes, public.labor_timesheets to authenticated;
grant select, insert on public.hr_events to authenticated;
grant all on public.core_employees, public.hr_job_codes, public.hr_events, public.labor_timesheets, public.hr_calendar_reminder_outbox to service_role;

commit;
