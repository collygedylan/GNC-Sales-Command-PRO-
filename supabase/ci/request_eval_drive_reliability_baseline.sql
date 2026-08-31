begin;

-- The isolated performance database intentionally omits legacy app-user data
-- and role-promotion migrations. Supply only the already-production objects
-- required to compile and test the later canonical Drive save contract.
create schema if not exists private;

create table if not exists public.ph_app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb
);

alter table public.ph_master_inventory
  add column if not exists source text,
  add column if not exists saleyear text,
  add column if not exists initial_ptr text,
  add column if not exists end_cap_folder text,
  add column if not exists date_completed timestamptz;

create table if not exists private.drive_evidence_idempotency (
  profile_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null,
  request_hash text not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, idempotency_key),
  constraint drive_evidence_idempotency_key_check
    check (char_length(idempotency_key) between 12 and 180),
  constraint drive_evidence_idempotency_response_size_check
    check (octet_length(response_payload::text) <= 131072)
);

alter table private.drive_evidence_idempotency enable row level security;
revoke all on table private.drive_evidence_idempotency from public, anon, authenticated;

create or replace function private.require_active_admin_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  select * into v_profile from public.profiles where id = auth.uid();
  if not found
     or v_profile.disabled_at is not null
     or (v_profile.locked_until is not null and v_profile.locked_until > now())
     or upper(btrim(coalesce(v_profile.role, ''))) not in ('ADMIN', 'ADMINISTRATOR') then
    raise exception using errcode = '42501', message = 'ACTIVE_ADMIN_REQUIRED';
  end if;
  return v_profile;
end
$function$;

revoke all on function private.require_active_admin_profile() from public, anon, authenticated;

commit;
