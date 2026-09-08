-- Disposable local CI/PGlite database ONLY. The harness must opt in explicitly.
do $$ begin
  if current_setting('app.sync_test',true) is distinct from 'isolated' then
    raise exception 'This fixture requires an isolated test harness';
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists private;
create schema if not exists bloomscapes_private;
do $$ begin
  -- A real local Supabase stack owns Auth DDL. Only the in-memory SQL runner
  -- lacks these tables; don't issue even CREATE IF NOT EXISTS against native
  -- Auth, whose schema intentionally denies CREATE to the postgres role.
  if to_regclass('auth.users') is null then
    create table auth.users(id uuid primary key);
  end if;
  if to_regclass('auth.sessions') is null then
    create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);
  end if;
  if to_regprocedure('auth.jwt()') is null then
    execute 'create function auth.jwt() returns jsonb language sql stable as $fn$ select nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb $fn$';
  end if;
  if to_regprocedure('auth.uid()') is null then
    execute 'create function auth.uid() returns uuid language sql stable as $fn$ select (auth.jwt()->>''sub'')::uuid $fn$';
  end if;
end $$;
create table public.profiles(id uuid primary key,username text,role text default 'User',division text default '10',
  disabled_at timestamptz,locked_until timestamptz,must_change_password boolean not null default false);
create table private.fixture_permissions(profile_id uuid,module text,allowed boolean default true);
create function private.current_active_profile() returns public.profiles language sql stable security definer set search_path='' as $$
  select p from public.profiles p where p.id=auth.uid() and p.disabled_at is null
    and (p.locked_until is null or p.locked_until<=now()) limit 1
$$;
create function private.resolve_app_access_policy_id_v1(boolean) returns bigint language sql stable as $$select 1::bigint$$;
create function private.get_effective_app_permissions_v1(uuid,bigint)
returns table(permission_key text,permission_kind text,module_key text,allowed boolean)
language sql stable security definer set search_path='' as $$
  select 'module.'||p.module||'.view','module',p.module,p.allowed
  from private.fixture_permissions p where p.profile_id=$1
$$;
create function private.can_view_access_control_v2() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('Admin','Manager'))
$$;
create table public.ph_soc_master(unique_id text primary key,dock text,quantityordered integer,date_completed timestamptz,last_updated timestamptz);
create table public.ph_master_inventory(unique_id text primary key,ptronhand integer,last_updated timestamptz);
create table public.ph_app_settings(key text primary key,value jsonb);
create table public.ph_cav_import(unique_id text primary key,value text);
create table public.ph_request_delivery_outbox(event_id uuid primary key,status text);
create table public.tx_soc_master(like public.ph_soc_master including all);
create table bloomscapes_private.orders(id uuid primary key,status text);
create table bloomscapes_private.order_lines(id uuid primary key,quantity integer);
do $$ declare source text; begin
  foreach source in array array['profiles','ph_master_inventory','ph_app_settings','ph_cav_import','ph_request_delivery_outbox','tx_soc_master'] loop
    execute format('alter table public.%I enable row level security',source);
    execute format('revoke all on public.%I from anon,authenticated',source);
  end loop;
end $$;
alter table public.ph_soc_master enable row level security;
grant select on public.ph_soc_master to authenticated;
create policy fixture_soc_read on public.ph_soc_master for select to authenticated using (true);
grant all on public.ph_soc_master to service_role;
grant usage on schema public to anon,authenticated,service_role;
