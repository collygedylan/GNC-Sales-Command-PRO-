begin;

-- The Request queue reads several thousand rows at once. The previous policy
-- passed row values into a helper that resolved the authenticated profile for
-- every row. Keep the exact access boundary, but expose the two actor-only
-- decisions as no-argument helpers so PostgreSQL can cache each `(select ...)`
-- as an initPlan once per statement.
create or replace function private.can_read_all_request_rows_v1()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  username_key text;
begin
  profile := private.current_active_profile();
  if profile.id is null then
    return false;
  end if;

  username_key := lower(btrim(coalesce(profile.username, '')));
  return username_key not in ('ben_brown', 'chance_alldredge');
end
$$;

create or replace function private.current_restricted_request_identity_v1()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  username_key text;
begin
  profile := private.current_active_profile();
  if profile.id is null then
    return '';
  end if;

  username_key := lower(btrim(coalesce(profile.username, '')));
  if username_key not in ('ben_brown', 'chance_alldredge') then
    return '';
  end if;

  return regexp_replace(
    split_part(lower(coalesce(profile.username, '')), '@', 1),
    '[^a-z0-9]+',
    '',
    'g'
  );
end
$$;

revoke all on function private.can_read_all_request_rows_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.current_restricted_request_identity_v1()
  from public, anon, authenticated, service_role;

drop policy if exists ph_active_request_authenticated_read on public.ph_active_request;
create policy ph_active_request_authenticated_read
on public.ph_active_request
for select
to authenticated
using (
  (select private.can_read_all_request_rows_v1())
  or (
    nullif((select private.current_restricted_request_identity_v1()), '') is not null
    and (select private.current_restricted_request_identity_v1()) in (
      regexp_replace(split_part(lower(coalesce(request_created_by_username, '')), '@', 1), '[^a-z0-9]+', '', 'g'),
      regexp_replace(split_part(lower(coalesce(request_selected_rep_username, '')), '@', 1), '[^a-z0-9]+', '', 'g'),
      regexp_replace(split_part(lower(coalesce(requested_by, '')), '@', 1), '[^a-z0-9]+', '', 'g')
    )
  )
);

drop policy if exists ph_request_history_authenticated_read on public.ph_request_history;
create policy ph_request_history_authenticated_read
on public.ph_request_history
for select
to authenticated
using (
  (select private.can_read_all_request_rows_v1())
  or (
    nullif((select private.current_restricted_request_identity_v1()), '') is not null
    and (select private.current_restricted_request_identity_v1()) in (
      regexp_replace(split_part(lower(coalesce(request_created_by_username, '')), '@', 1), '[^a-z0-9]+', '', 'g'),
      regexp_replace(split_part(lower(coalesce(request_selected_rep_username, '')), '@', 1), '[^a-z0-9]+', '', 'g'),
      regexp_replace(split_part(lower(coalesce(requested_by, '')), '@', 1), '[^a-z0-9]+', '', 'g')
    )
  )
);

commit;
