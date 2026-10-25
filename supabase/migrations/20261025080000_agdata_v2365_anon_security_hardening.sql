begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

revoke insert, update, delete, truncate on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from public;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from public;

do $lockdown$
declare
  column_row record;
  policy_row record;
  read_policy_name text;
  relation_name text;
  relation_oid regclass;
  relation_kind "char";
  authenticated_can_select boolean;
  remaining_roles text[];
  sensitive_relations constant text[] := array[
    'ph_app_users',
    'profiles',
    'user_access_control',
    'user_access_control_audit',
    'user_access_control_commands',
    'user_access_control_state',
    'role_access_baselines',
    'ph_request_delivery_outbox',
    'ph_delivery_outbox',
    'ph_request_delivery_status',
    'ph_request_delivery_worker_state',
    'ph_request_email_threads',
    'hr_calendar_reminder_outbox',
    'hr_events',
    'hr_job_codes',
    'labor_timesheets',
    'core_employees',
    'ph_labor_hours',
    'ph_push_subscriptions',
    'ph_requests_pending',
    'ph_active_request',
    'ph_active_request_live_rows',
    'ph_request_queue_live_rows',
    'ph_requests_completed_history',
    'ph_request_history'
  ];
begin
  for column_row in
    select namespace_row.nspname, relation.relname, attribute.attname
    from pg_class relation
    join pg_namespace namespace_row on namespace_row.oid = relation.relnamespace
    join pg_attribute attribute on attribute.attrelid = relation.oid
      and attribute.attnum > 0 and not attribute.attisdropped
    where namespace_row.nspname = 'public' and relation.relkind in ('r', 'p', 'v', 'f')
  loop
    execute format('revoke insert (%I), update (%I) on table %I.%I from public, anon',
      column_row.attname, column_row.attname, column_row.nspname, column_row.relname);
  end loop;

  for policy_row in
    select schemaname, tablename, policyname, cmd, roles, qual
    from pg_policies
    where schemaname = 'public'
      and permissive = 'PERMISSIVE'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and roles && array['anon'::name, 'public'::name]
  loop
    execute format('drop policy if exists %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
    if policy_row.cmd = 'ALL' then
      read_policy_name := left(policy_row.policyname, 42) || '_' ||
        substr(md5(policy_row.policyname), 1, 8) || '_ro65';
      execute format('create policy %I on %I.%I for select to %s using (%s)',
        read_policy_name, policy_row.schemaname, policy_row.tablename,
        (select string_agg(quote_ident(role_name::text), ', ') from unnest(policy_row.roles) as original(role_name)),
        coalesce(policy_row.qual, 'true'));
    end if;
  end loop;

  foreach relation_name in array sensitive_relations loop
    relation_oid := to_regclass(format('public.%I', relation_name));
    if relation_oid is null then continue; end if;

    select relation.relkind into relation_kind from pg_class relation where relation.oid = relation_oid;
    authenticated_can_select := has_table_privilege('authenticated', relation_oid, 'SELECT');

    execute format('revoke all privileges on table public.%I from public, anon', relation_name);
    if authenticated_can_select then
      execute format('grant select on table public.%I to authenticated', relation_name);
    end if;
    execute format('grant all privileges on table public.%I to service_role', relation_name);

    if relation_kind in ('r', 'p') then
      execute format('alter table public.%I enable row level security', relation_name);
    end if;

    for policy_row in
      select schemaname, tablename, policyname, roles
      from pg_policies
      where schemaname = 'public' and tablename = relation_name
        and cmd in ('SELECT', 'ALL')
        and roles && array['anon'::name, 'public'::name]
    loop
      select array_agg(role_name order by role_name) into remaining_roles
      from (
        select role_name::text
        from unnest(policy_row.roles) as original(role_name)
        where role_name::text not in ('anon', 'public')
        union
        select 'authenticated' where 'public'::name = any(policy_row.roles) and authenticated_can_select
      ) retained_roles;

      if coalesce(cardinality(remaining_roles), 0) = 0 then
        execute format('drop policy if exists %I on %I.%I',
          policy_row.policyname, policy_row.schemaname, policy_row.tablename);
      else
        execute format('alter policy %I on %I.%I to %s',
          policy_row.policyname, policy_row.schemaname, policy_row.tablename,
          (select string_agg(quote_ident(role_name), ', ') from unnest(remaining_roles) as retained(role_name)));
      end if;
    end loop;
  end loop;

  if exists (
    select 1 from pg_class relation
    join pg_namespace namespace_row on namespace_row.oid = relation.relnamespace
    where namespace_row.nspname = 'public' and relation.relkind in ('r', 'p', 'v', 'm', 'f')
      and (has_table_privilege('anon', relation.oid, 'INSERT')
        or has_table_privilege('anon', relation.oid, 'UPDATE')
        or has_table_privilege('anon', relation.oid, 'DELETE')
        or has_table_privilege('anon', relation.oid, 'TRUNCATE')
        or has_any_column_privilege('anon', relation.oid, 'INSERT')
        or has_any_column_privilege('anon', relation.oid, 'UPDATE'))
  ) then
    raise exception 'ZERO_TRUST_ANON_WRITE_GRANT_REMAINED';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and permissive = 'PERMISSIVE'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and roles && array['anon'::name, 'public'::name]
  ) then
    raise exception 'ZERO_TRUST_ANON_MUTATION_POLICY_REMAINED';
  end if;

  foreach relation_name in array sensitive_relations loop
    relation_oid := to_regclass(format('public.%I', relation_name));
    if relation_oid is null then continue; end if;
    if has_table_privilege('anon', relation_oid, 'SELECT') then
      raise exception 'ZERO_TRUST_ANON_SENSITIVE_READ_REMAINED:%', relation_name;
    end if;
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = relation_name and cmd in ('SELECT', 'ALL')
        and roles && array['anon'::name, 'public'::name]
    ) then
      raise exception 'ZERO_TRUST_ANON_SENSITIVE_POLICY_REMAINED:%', relation_name;
    end if;
  end loop;

  if exists (
    select 1 from pg_class relation
    join pg_namespace namespace_row on namespace_row.oid = relation.relnamespace
    where namespace_row.nspname = 'public' and relation.relname = any(sensitive_relations)
      and relation.relkind in ('r', 'p') and not relation.relrowsecurity
  ) then
    raise exception 'ZERO_TRUST_SENSITIVE_RLS_DISABLED';
  end if;
end
$lockdown$;

notify pgrst, 'reload schema';
commit;
