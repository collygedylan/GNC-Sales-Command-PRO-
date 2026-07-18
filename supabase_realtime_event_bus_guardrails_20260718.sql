-- Quota-safe Realtime guardrails for app shell V2026.07.18.04.
--
-- Professional standard used here:
--   * Direct Supabase Realtime is reserved for small, urgent communication and
--     request tables.
--   * Inventory, Crop Roll, AV, Reserves, Sales Office, Dock, and task data use
--     the tiny v2_app_live_events bus. The app then fetches compact indexed
--     rows/views instead of streaming large tables.
--   * Triggers are statement-level, so a bulk import creates one live signal
--     per statement/table instead of one signal per row.

create extension if not exists pgcrypto;

create table if not exists public.v2_app_live_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  area text not null,
  source_table text not null,
  row_ids text[] not null default '{}'::text[],
  payload jsonb not null default '{}'::jsonb,
  actor_username text,
  actor_display text,
  client_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_v2_app_live_events_created_at
  on public.v2_app_live_events (created_at desc);

create index if not exists idx_v2_app_live_events_area_created_at
  on public.v2_app_live_events (area, created_at desc);

create index if not exists idx_v2_app_live_events_source_created_at
  on public.v2_app_live_events (source_table, created_at desc);

alter table public.v2_app_live_events replica identity full;
alter table public.v2_app_live_events enable row level security;

drop policy if exists "Allow app live event reads" on public.v2_app_live_events;
create policy "Allow app live event reads"
  on public.v2_app_live_events
  for select
  using (true);

drop policy if exists "Allow app live event inserts" on public.v2_app_live_events;
create policy "Allow app live event inserts"
  on public.v2_app_live_events
  for insert
  with check (true);

drop policy if exists "Allow app live event cleanup" on public.v2_app_live_events;
create policy "Allow app live event cleanup"
  on public.v2_app_live_events
  for delete
  using (true);

grant select, insert, delete on public.v2_app_live_events to anon, authenticated, service_role;

create or replace function public.emit_v2_app_live_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_area text := nullif(btrim(coalesce(tg_argv[0], '')), '');
  safe_table text := tg_table_name;
  safe_method text := lower(tg_op);
  bucket text := to_char(date_trunc('second', clock_timestamp()), 'YYYYMMDDHH24MISS');
  safe_event_key text;
begin
  if safe_area is null or safe_table = 'v2_app_live_events' then
    return null;
  end if;

  safe_event_key := 'db:' || safe_area || ':' || safe_table || ':' || safe_method || ':' || bucket;

  insert into public.v2_app_live_events (
    event_key,
    event_type,
    area,
    source_table,
    row_ids,
    payload,
    client_id,
    created_at
  ) values (
    safe_event_key,
    safe_area || ':' || safe_method,
    safe_area,
    safe_table,
    '{}'::text[],
    jsonb_build_object(
      'method', tg_op,
      'bulk', true,
      'db_trigger', true,
      'coalesced_count', 1,
      'bucket', bucket,
      'client_id', 'db_trigger'
    ),
    'db_trigger',
    clock_timestamp()
  )
  on conflict (event_key) do update
  set
    payload = jsonb_set(
      coalesce(public.v2_app_live_events.payload, '{}'::jsonb),
      '{coalesced_count}',
      to_jsonb(
        case
          when coalesce(public.v2_app_live_events.payload->>'coalesced_count', '') ~ '^[0-9]+$'
            then (public.v2_app_live_events.payload->>'coalesced_count')::integer + 1
          else 2
        end
      ),
      true
    ),
    created_at = excluded.created_at;

  return null;
exception
  when others then
    return null;
end;
$$;

create or replace function public.prune_v2_app_live_events_by_count(max_events integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  with doomed as (
    select id
    from public.v2_app_live_events
    order by created_at desc
    offset greatest(coalesce(max_events, 5000), 500)
  )
  delete from public.v2_app_live_events e
  using doomed d
  where e.id = d.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.prune_v2_app_live_events_by_count(integer) to anon, authenticated, service_role;

do $$
declare
  target_table text;
  safe_area text;
begin
  for target_table, safe_area in
    select *
    from (values
      ('v2_active_request', 'request'),
      ('v2_request_history', 'request'),
      ('v2_inventory_edit_requests', 'request'),
      ('v2_crop_roll_rows', 'crop-roll'),
      ('v2_crop_roll_drive_rows', 'crop-roll'),
      ('v2_sales_office', 'sales-office'),
      ('v2_take_back_queue', 'take-back'),
      ('v2_shear_list', 'shear-list'),
      ('v2_production_workflow_rows', 'production'),
      ('v2_spread_counts', 'sales-inventory'),
      ('v2_bunch_counts', 'sales-inventory'),
      ('v2_flyer_folder_rows', 'tasks'),
      ('v2_flyer_folder_history', 'tasks'),
      ('v2_ml_image_jobs', 'diagnostics'),
      ('v2_grower_scout_reports', 'grower'),
      ('v2_grower_scout_assets', 'grower'),
      ('v2_master_inventory', 'inventory'),
      ('v2_reserves', 'reserves'),
      ('v2_customer_consignee_sales_reps', 'customer-rep-map'),
      ('v2_soc_master', 'docks'),
      ('v2_cav_import', 'av'),
      ('v2_av_notes', 'av'),
      ('v2_dock_team_status', 'docks'),
      ('v2_dock_item_status', 'docks'),
      ('v2_dock_issue_status', 'docks'),
      ('v2_dock_issue_allocations', 'docks'),
      ('v2_department_calendar_events', 'department-calendar')
    ) as live_targets(table_name, area_name)
  loop
    if to_regclass('public.' || target_table) is not null then
      execute format('drop trigger if exists trg_emit_v2_app_live_event on public.%I', target_table);
      execute format(
        'create trigger trg_emit_v2_app_live_event after insert or update or delete on public.%I for each statement execute function public.emit_v2_app_live_event(%L)',
        target_table,
        safe_area
      );
    end if;
  end loop;
end $$;

do $$
declare
  target_table text;
  allowed_realtime_tables text[] := array[
    'v2_app_live_events',
    'v2_active_request',
    'v2_request_history',
    'v2_chat_conversations',
    'v2_chat_participants',
    'v2_chat_messages',
    'v2_walkie_channels',
    'v2_walkie_channel_members',
    'v2_walkie_calls',
    'v2_walkie_call_members',
    'v2_walkie_signal_events',
    'v2_department_calendar_events'
  ];
begin
  foreach target_table in array allowed_realtime_tables loop
    if to_regclass('public.' || target_table) is not null
      and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = target_table
      ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;

  for target_table in
    select tablename
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and not (tablename = any (allowed_realtime_tables))
  loop
    execute format('alter publication supabase_realtime drop table public.%I', target_table);
  end loop;
exception
  when undefined_object then null;
end $$;

create or replace view public.v2_app_database_health
with (security_invoker = true)
as
select
  c.relname as table_name,
  c.relkind,
  s.n_live_tup::bigint as live_rows,
  s.n_dead_tup::bigint as dead_rows,
  pg_total_relation_size(c.oid)::bigint as total_bytes,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
  coalesce(i.index_count, 0)::integer as index_count,
  c.relrowsecurity as rls_enabled,
  coalesce(p.policy_count, 0)::integer as policy_count,
  exists (
    select 1
    from pg_publication_tables pt
    where pt.pubname = 'supabase_realtime'
      and pt.schemaname = 'public'
      and pt.tablename = c.relname
  ) as in_realtime_publication,
  s.seq_scan::bigint as seq_scan,
  s.idx_scan::bigint as idx_scan,
  s.last_vacuum,
  s.last_autovacuum,
  s.last_analyze,
  s.last_autoanalyze
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
left join (
  select indrelid, count(*) as index_count
  from pg_index
  group by indrelid
) i on i.indrelid = c.oid
left join (
  select schemaname, tablename, count(*) as policy_count
  from pg_policies
  group by schemaname, tablename
) p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind in ('r', 'm');

grant select on public.v2_app_database_health to anon, authenticated, service_role;

create or replace view public.v2_app_realtime_budget_state
with (security_invoker = true)
as
select
  pt.tablename as table_name,
  case
    when pt.tablename in (
      'v2_app_live_events',
      'v2_active_request',
      'v2_request_history',
      'v2_chat_conversations',
      'v2_chat_participants',
      'v2_chat_messages',
      'v2_walkie_channels',
      'v2_walkie_channel_members',
      'v2_walkie_calls',
      'v2_walkie_call_members',
      'v2_walkie_signal_events',
      'v2_department_calendar_events'
    ) then 'direct-realtime-approved'
    else 'review-remove-from-realtime'
  end as budget_status,
  pg_size_pretty(pg_total_relation_size(format('public.%I', pt.tablename)::regclass)) as total_size
from pg_publication_tables pt
where pt.pubname = 'supabase_realtime'
  and pt.schemaname = 'public'
order by pt.tablename;

grant select on public.v2_app_realtime_budget_state to anon, authenticated, service_role;

select public.prune_v2_app_live_events_by_count(5000) as pruned_live_events;

-- VACUUM cannot run inside an explicit transaction block.
vacuum (full, analyze) public.v2_app_live_events;

notify pgrst, 'reload schema';
