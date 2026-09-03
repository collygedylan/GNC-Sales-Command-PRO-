begin;

-- The existing manager-managed AV Blanks list is also the authority for the
-- external Custom AV / Season Sales Notes staging workflow. Keep the current
-- production setting when present and seed the requested safe default only
-- for environments that do not have the setting yet.
insert into public.ph_app_settings (key, value, updated_by, updated_at)
values (
  'av_blanks_photo_bypass_users',
  jsonb_build_object(
    'users', jsonb_build_array('dylan_collyge', 'kayla_knepp', 'morgan_anderson'),
    'updatedAt', now(),
    'updatedBy', 'migration'
  ),
  'migration',
  now()
)
on conflict (key) do nothing;

update private.app_access_permissions
set label = 'Season Sales Note Users',
    description = 'Manage who may enter Season Sales Notes and finish AV Blanks without photo/spec.'
where permission_key = 'manager.av_blanks_bypass.manage';

create table if not exists public.ph_season_sales_note_user_events (
  id bigint generated always as identity primary key,
  actor_username text not null,
  allowed_usernames text[] not null default '{}'::text[],
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (octet_length(metadata::text) <= 4096),
  created_at timestamptz not null default now(),
  unique (actor_username, idempotency_key)
);

alter table public.ph_season_sales_note_user_events enable row level security;
revoke all on table public.ph_season_sales_note_user_events from public, anon, authenticated;
grant all on table public.ph_season_sales_note_user_events to service_role;
grant usage, select on sequence public.ph_season_sales_note_user_events_id_seq to service_role;

drop trigger if exists ph_season_sales_note_user_events_append_only
  on public.ph_season_sales_note_user_events;
create trigger ph_season_sales_note_user_events_append_only
before update or delete on public.ph_season_sales_note_user_events
for each row execute function private.prevent_season_sales_event_mutation_v1();

create or replace function private.season_sales_note_allowed_usernames_v1()
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(candidate.username order by candidate.username), '{}'::text[])
  from (
    select distinct lower(btrim(entry.value)) as username
    from public.ph_app_settings setting
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(setting.value->'users') = 'array' then setting.value->'users'
        else '[]'::jsonb
      end
    ) entry(value)
    join public.profiles profile
      on lower(btrim(profile.username)) = lower(btrim(entry.value))
     and profile.disabled_at is null
     and (profile.locked_until is null or profile.locked_until <= now())
     and not profile.must_change_password
    where setting.key = 'av_blanks_photo_bypass_users'
      and btrim(entry.value) <> ''
  ) candidate
$function$;

create or replace function private.season_sales_assert_settings_manager_v1(p_username text)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  allowed boolean := false;
begin
  select profile.* into actor
  from public.profiles profile
  where lower(btrim(profile.username)) = lower(btrim(coalesce(p_username, '')))
    and profile.disabled_at is null
    and (profile.locked_until is null or profile.locked_until <= now())
    and not profile.must_change_password
  limit 1;
  if actor.id is null then
    raise exception using errcode = '42501', message = 'SEASON_SALES_PROFILE_NOT_ACTIVE';
  end if;

  select coalesce(permission.allowed, false) into allowed
  from private.get_effective_app_permissions_v1(
    actor.id, private.resolve_app_access_policy_id_v1(false)
  ) permission
  where permission.permission_key = 'manager.av_blanks_bypass.manage'
  limit 1;
  if not coalesce(allowed, false) then
    raise exception using errcode = '42501', message = 'SEASON_SALES_SETTINGS_PERMISSION_REQUIRED';
  end if;
  return actor;
end
$function$;

create or replace function private.season_sales_assert_actor_v1(p_username text)
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  allowed boolean := false;
  allowed_usernames text[];
begin
  select profile.* into actor
  from public.profiles profile
  where lower(btrim(profile.username)) = lower(btrim(coalesce(p_username, '')))
    and profile.disabled_at is null
    and (profile.locked_until is null or profile.locked_until <= now())
    and not profile.must_change_password
  limit 1;
  if actor.id is null then
    raise exception using errcode = '42501', message = 'SEASON_SALES_PROFILE_NOT_ACTIVE';
  end if;

  select coalesce(permission.allowed, false) into allowed
  from private.get_effective_app_permissions_v1(
    actor.id, private.resolve_app_access_policy_id_v1(false)
  ) permission
  where permission.permission_key = 'module.sales-office.view'
  limit 1;
  if not coalesce(allowed, false) then
    raise exception using errcode = '42501', message = 'SEASON_SALES_PERMISSION_REQUIRED';
  end if;

  allowed_usernames := private.season_sales_note_allowed_usernames_v1();
  if not (lower(btrim(actor.username)) = any(allowed_usernames)) then
    raise exception using errcode = '42501', message = 'SEASON_SALES_USER_NOT_ASSIGNED';
  end if;
  return actor;
end
$function$;

create or replace function public.get_season_sales_note_access_v1(p_actor_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  can_view boolean := false;
  can_manage boolean := false;
  allowed_usernames text[] := private.season_sales_note_allowed_usernames_v1();
  setting_row public.ph_app_settings;
begin
  select profile.* into actor
  from public.profiles profile
  where lower(btrim(profile.username)) = lower(btrim(coalesce(p_actor_username, '')))
    and profile.disabled_at is null
    and (profile.locked_until is null or profile.locked_until <= now())
    and not profile.must_change_password
  limit 1;
  if actor.id is null then
    raise exception using errcode = '42501', message = 'SEASON_SALES_PROFILE_NOT_ACTIVE';
  end if;

  select coalesce(permission.allowed, false) into can_view
  from private.get_effective_app_permissions_v1(
    actor.id, private.resolve_app_access_policy_id_v1(false)
  ) permission
  where permission.permission_key = 'module.sales-office.view'
  limit 1;

  select coalesce(permission.allowed, false) into can_manage
  from private.get_effective_app_permissions_v1(
    actor.id, private.resolve_app_access_policy_id_v1(false)
  ) permission
  where permission.permission_key = 'manager.av_blanks_bypass.manage'
  limit 1;

  select setting.* into setting_row
  from public.ph_app_settings setting
  where setting.key = 'av_blanks_photo_bypass_users'
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'allowed', can_view and lower(btrim(actor.username)) = any(allowed_usernames),
    'canManage', can_manage,
    'users', to_jsonb(allowed_usernames),
    'updatedAt', setting_row.updated_at,
    'updatedBy', coalesce(setting_row.updated_by, '')
  );
end
$function$;

create or replace function public.save_season_sales_note_users_v1(
  p_actor_username text,
  p_usernames text[],
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles := private.season_sales_assert_settings_manager_v1(p_actor_username);
  normalized_usernames text[];
  active_count integer := 0;
  request_hash text;
  prior_hash text;
  prior_response jsonb;
  response_value jsonb;
begin
  perform set_config('lock_timeout', '2000', true);
  perform set_config('statement_timeout', '10000', true);
  if length(btrim(coalesce(p_idempotency_key, ''))) not between 12 and 180 then
    raise exception using errcode = '22023', message = 'SEASON_SALES_TOKEN_INVALID';
  end if;

  select coalesce(array_agg(requested.username order by requested.username), '{}'::text[])
  into normalized_usernames
  from (
    select distinct lower(btrim(value)) as username
    from unnest(coalesce(p_usernames, '{}'::text[])) as requested_value(value)
    where btrim(coalesce(requested_value.value, '')) <> ''
  ) requested;
  if cardinality(normalized_usernames) > 100 then
    raise exception using errcode = '22023', message = 'SEASON_SALES_USER_LIMIT';
  end if;

  select count(*) into active_count
  from public.profiles profile
  where lower(btrim(profile.username)) = any(normalized_usernames)
    and profile.disabled_at is null
    and (profile.locked_until is null or profile.locked_until <= now())
    and not profile.must_change_password
    and exists (
      select 1
      from private.get_effective_app_permissions_v1(
        profile.id, private.resolve_app_access_policy_id_v1(false)
      ) permission
      where permission.permission_key = 'module.sales-office.view'
        and permission.allowed
    );
  if active_count <> cardinality(normalized_usernames) then
    raise exception using errcode = '22023', message = 'SEASON_SALES_USER_INVALID';
  end if;

  request_hash := encode(extensions.digest(coalesce(array_to_string(normalized_usernames, '|'), ''), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('season-sales-note-users-v1', 0));
  select saved.request_hash, saved.response into prior_hash, prior_response
  from private.season_sales_office_idempotency saved
  where saved.operation = 'save_users'
    and saved.actor_username = lower(btrim(actor.username))
    and saved.idempotency_key = btrim(p_idempotency_key);
  if prior_response is not null then
    if prior_hash is distinct from request_hash then
      raise exception using errcode = '22023', message = 'SEASON_SALES_TOKEN_CONFLICT';
    end if;
    return prior_response;
  end if;

  insert into public.ph_app_settings (key, value, updated_by, updated_at)
  values (
    'av_blanks_photo_bypass_users',
    jsonb_build_object(
      'users', to_jsonb(normalized_usernames),
      'updatedAt', now(),
      'updatedBy', lower(btrim(actor.username))
    ),
    lower(btrim(actor.username)),
    now()
  )
  on conflict (key) do update set
    value = excluded.value,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  response_value := jsonb_build_object(
    'ok', true,
    'status', 'saved',
    'users', to_jsonb(normalized_usernames),
    'updatedAt', now(),
    'updatedBy', lower(btrim(actor.username))
  );
  insert into public.ph_season_sales_note_user_events (
    actor_username, allowed_usernames, idempotency_key, metadata
  ) values (
    lower(btrim(actor.username)), normalized_usernames, btrim(p_idempotency_key),
    jsonb_build_object('count', cardinality(normalized_usernames))
  );
  insert into private.season_sales_office_idempotency (
    operation, actor_username, idempotency_key, request_hash, response
  ) values (
    'save_users', lower(btrim(actor.username)), btrim(p_idempotency_key),
    request_hash, response_value
  );
  return response_value;
end
$function$;

revoke all on function private.season_sales_note_allowed_usernames_v1() from public, anon, authenticated;
revoke all on function private.season_sales_assert_settings_manager_v1(text) from public, anon, authenticated;
revoke all on function private.season_sales_assert_actor_v1(text) from public, anon, authenticated;
revoke all on function public.get_season_sales_note_access_v1(text) from public, anon, authenticated;
revoke all on function public.save_season_sales_note_users_v1(text, text[], text) from public, anon, authenticated;
grant execute on function public.get_season_sales_note_access_v1(text) to service_role;
grant execute on function public.save_season_sales_note_users_v1(text, text[], text) to service_role;

commit;
