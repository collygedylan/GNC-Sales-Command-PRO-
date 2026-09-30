-- Stage 1 of the native Auth migration. This migration is additive and
-- intentionally leaves the legacy ph_app_users/session path in place.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  legacy_user_id integer unique,
  username text not null unique,
  display_name text,
  role text not null default 'User',
  division text not null default '10',
  language text not null default 'English',
  disabled_at timestamptz,
  locked_until timestamptz,
  must_change_password boolean not null default false,
  passkey_pilot boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_normalized check (username = lower(btrim(username)))
);

alter table public.profiles enable row level security;

drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists profiles_update_safe_self on public.profiles;
-- Profile mutations remain admin/service-role only during the dual-auth pilot.
-- This avoids self-escalation and recursive RLS checks on authorization fields.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.profiles p
  where p.id = auth.uid()
    and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now())
  limit 1
$$;

create or replace function private.has_profile_permission(required_role text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
      and (required_role is null or lower(p.role) = lower(required_role))
  )
$$;

revoke all on function private.current_profile() from public, anon, authenticated;
revoke all on function private.has_profile_permission(text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.current_profile() to authenticated;
grant execute on function private.has_profile_permission(text) to authenticated;

-- Password-free directory used by assignment, chat, calendar, and recipient
-- controls. It deliberately returns only non-secret fields and requires an
-- active native Auth profile for the caller.
create or replace function public.get_app_user_directory(requested_roles text[] default null)
returns table (
  username text,
  display_name text,
  role text,
  division text,
  language text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.username, p.display_name, p.role, p.division, p.language
  from public.profiles p
  where exists (
    select 1
    from public.profiles caller
    where caller.id = auth.uid()
      and caller.disabled_at is null
      and (caller.locked_until is null or caller.locked_until <= now())
  )
    and p.disabled_at is null
    and (requested_roles is null or p.role = any(requested_roles))
  order by p.username
  limit 2000
$$;

revoke all on function public.get_app_user_directory(text[]) from public, anon;
grant execute on function public.get_app_user_directory(text[]) to authenticated;

comment on table public.profiles is
  'Native Supabase Auth profile linked to the legacy ph_app_users record during the dual-auth rollout.';
