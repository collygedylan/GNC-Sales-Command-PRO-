begin;

-- One scheduled handover record is the source of truth for both the cutoff
-- predicate and the retryable Auth/assignment worker.  The cutoff is a fixed
-- UTC instant: 2026-10-03 04:00:00Z = 2026-10-02 23:00 America/Chicago.
create table if not exists private.scheduled_account_handover_v1 (
  transition_key text primary key check (transition_key = 'kayla_knepp_to_nelly_aguilar_20261002'),
  departing_profile_id uuid not null references public.profiles(id) on delete restrict,
  successor_profile_id uuid not null references public.profiles(id) on delete restrict,
  effective_at timestamptz not null check (effective_at = '2026-10-03 04:00:00+00'::timestamptz),
  auth_banned_at timestamptz,
  auth_ban_attempts integer not null default 0 check (auth_ban_attempts >= 0),
  auth_ban_next_attempt_at timestamptz,
  auth_ban_error_code text,
  transferred_count bigint not null default 0 check (transferred_count >= 0),
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (departing_profile_id <> successor_profile_id)
);

create table if not exists private.scheduled_account_handover_audit_v1 (
  id bigint generated always as identity primary key,
  transition_key text not null references private.scheduled_account_handover_v1(transition_key),
  event_key text not null unique,
  event_type text not null check (event_type in ('scheduled','cutoff_enforced','push_disabled','auth_ban_attempt','assignment_transferred','assignment_failed','completed','notification_queued')),
  metadata jsonb not null default '{}'::jsonb check (octet_length(metadata::text) <= 2048),
  created_at timestamptz not null default now()
);

create table if not exists private.scheduled_handover_push_outbox_v1 (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  event_type text not null check (event_type in ('scheduled_handover_complete','scheduled_handover_failed')),
  transition_key text not null references private.scheduled_account_handover_v1(transition_key),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','abandoned')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists private.scheduled_handover_assignment_state_v1 (
  target_key text primary key,
  target_kind text not null check (target_kind in ('eval_work','flyer','other')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  transferred_at timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now()
);
create index if not exists scheduled_handover_push_claim_idx
  on private.scheduled_handover_push_outbox_v1(status, next_attempt_at, created_at);

alter table private.scheduled_account_handover_v1 enable row level security;
alter table private.scheduled_account_handover_audit_v1 enable row level security;
alter table private.scheduled_handover_push_outbox_v1 enable row level security;
alter table private.scheduled_handover_assignment_state_v1 enable row level security;
revoke all on private.scheduled_account_handover_v1,
  private.scheduled_account_handover_audit_v1,
  private.scheduled_handover_push_outbox_v1,
  private.scheduled_handover_assignment_state_v1 from public, anon, authenticated;
grant all on private.scheduled_account_handover_v1,
  private.scheduled_account_handover_audit_v1,
  private.scheduled_handover_push_outbox_v1,
  private.scheduled_handover_assignment_state_v1 to service_role;

do $migration$
declare kayla_count integer; nelly_count integer; kayla_id uuid; nelly_id uuid;
        kayla_legacy integer; nelly_legacy integer;
begin
  -- A schema-only release replay is seeded just before this migration. If a
  -- replay remains completely identity-free, do not invent production users.
  if not exists (select 1 from public.profiles) then return; end if;
  select count(*) into kayla_count from public.profiles where lower(btrim(username)) = 'kayla_knepp';
  select count(*) into nelly_count from public.profiles where lower(btrim(username)) = 'nelly_aguilar';
  if kayla_count = 1 then select id into kayla_id from public.profiles where lower(btrim(username))='kayla_knepp'; end if;
  if nelly_count = 1 then select id into nelly_id from public.profiles where lower(btrim(username))='nelly_aguilar'; end if;
  if kayla_count <> 1 or nelly_count <> 1
     or kayla_id <> 'e2584b32-472c-4888-b592-394235050b5b'::uuid
     or nelly_id <> '961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid then
    raise exception 'scheduled handover identities do not match the verified account IDs';
  end if;
  select id into kayla_legacy from public.ph_app_users where lower(btrim(username))='kayla_knepp';
  select id into nelly_legacy from public.ph_app_users where lower(btrim(username))='nelly_aguilar';
  if (select count(*) from public.ph_app_users where lower(btrim(username)) = 'kayla_knepp') <> 1
     or (select count(*) from public.ph_app_users where lower(btrim(username)) = 'nelly_aguilar') <> 1
     or kayla_legacy <> 17 or nelly_legacy <> 74
     or not exists(select 1 from public.profiles where id=kayla_id and legacy_user_id=17)
     or not exists(select 1 from public.profiles where id=nelly_id and legacy_user_id=74) then
    raise exception 'scheduled handover requires exactly one legacy account for Kayla and Nelly';
  end if;
  insert into private.scheduled_account_handover_v1
    (transition_key, departing_profile_id, successor_profile_id, effective_at)
  values ('kayla_knepp_to_nelly_aguilar_20261002', kayla_id, nelly_id,
          '2026-10-03 04:00:00+00'::timestamptz)
  on conflict (transition_key) do update set
    departing_profile_id = excluded.departing_profile_id,
    successor_profile_id = excluded.successor_profile_id,
    effective_at = excluded.effective_at,
    updated_at = now();
  insert into private.scheduled_account_handover_audit_v1(transition_key, event_key, event_type, metadata)
  values ('kayla_knepp_to_nelly_aguilar_20261002', 'kayla_nelly_20261002_scheduled', 'scheduled',
    jsonb_build_object('effectiveAt','2026-10-03T04:00:00Z','successor','nelly_aguilar'))
  on conflict (event_key) do nothing;
end
$migration$;

-- Keep every RLS policy that already delegates through this helper, and add
-- the fixed-time handover predicate to it.  Existing role/username semantics
-- are otherwise unchanged.
create or replace function private.scheduled_handover_cutoff_reached_v1(p_username text, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.scheduled_account_handover_v1 h
    join public.profiles p on p.id=h.departing_profile_id
    where lower(btrim(p.username))=lower(btrim(coalesce(p_username,''))) and p_at>=h.effective_at
  )
$$;
revoke all on function private.scheduled_handover_cutoff_reached_v1(text,timestamptz) from public,anon;
grant execute on function private.scheduled_handover_cutoff_reached_v1(text,timestamptz) to authenticated,service_role;

create or replace function private.current_active_profile()
returns public.profiles
language sql stable security definer set search_path = '' as $$
  select p
  from public.profiles p
  where p.id = (select auth.uid())
    and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= statement_timestamp())
    and (p.legacy_user_id is null or exists (
      select 1 from public.ph_app_users u
      where u.id=p.legacy_user_id and lower(btrim(u.username))=lower(btrim(p.username))
        and u.disabled_at is null and (u.locked_until is null or u.locked_until<=statement_timestamp())
    ))
    and not private.scheduled_handover_cutoff_reached_v1(p.username,statement_timestamp())
  limit 1
$$;
revoke all on function private.current_active_profile() from public, anon;
grant execute on function private.current_active_profile() to authenticated, service_role;

create or replace function private.is_kayla_limited_access_manager_v1()
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(btrim(coalesce((private.current_active_profile()).username, '')))
    in ('kayla_knepp','nelly_aguilar')
$$;
revoke all on function private.is_kayla_limited_access_manager_v1() from public, anon;
grant execute on function private.is_kayla_limited_access_manager_v1() to authenticated, service_role;

-- Copy current live limited-access decisions to Nelly without overwriting any
-- choices she already has; append an audit record and bump the shared revision.
do $overrides$
declare kayla_id uuid; nelly_id uuid; copied integer;
begin
  if not exists (select 1 from public.profiles) then return; end if;
  select id into strict kayla_id from public.profiles where lower(btrim(username)) = 'kayla_knepp';
  select id into strict nelly_id from public.profiles where lower(btrim(username)) = 'nelly_aguilar';
  with copied_rows as (
    insert into private.app_limited_live_overrides
      (profile_id, permission_key, allowed, updated_by_username, updated_at)
    select nelly_id, o.permission_key, o.allowed, 'dylan_collyge', now()
    from private.app_limited_live_overrides o
    where o.profile_id = kayla_id and o.allowed is true
    on conflict (profile_id, permission_key) do nothing
    returning permission_key, allowed
  )
  insert into private.app_limited_access_events
    (actor_username, target_username, target_role, permission_key, previous_value, next_value, reason)
  select 'dylan_collyge', 'nelly_aguilar', private.normalized_profile_role(p.role), c.permission_key,
    null, jsonb_build_object('allowed',c.allowed), 'Kayla to Nelly scheduled handover'
  from copied_rows c join public.profiles p on p.id=nelly_id;
  get diagnostics copied = row_count;
  if copied > 0 then
    update private.app_limited_access_state set revision = revision + 1, updated_at = now()
      where singleton;
  end if;
end
$overrides$;

do $manager_overrides$
declare kayla_id uuid; nelly_id uuid; audit_rows integer;
begin
  if not exists (select 1 from public.profiles) then return; end if;
  select id into strict kayla_id from public.profiles where lower(btrim(username))='kayla_knepp';
  select id into strict nelly_id from public.profiles where lower(btrim(username))='nelly_aguilar';
  with copied as (
    insert into private.app_access_user_overrides
      (policy_id,profile_id,permission_key,allowed,access_scope,updated_at)
    select o.policy_id,nelly_id,o.permission_key,o.allowed,o.access_scope,now()
    from private.app_access_user_overrides o where o.profile_id=kayla_id and o.allowed is true
    on conflict(policy_id,profile_id,permission_key) do nothing
    returning policy_id,permission_key,allowed,access_scope
  ), audited as (
    insert into private.app_access_change_events
      (policy_id,actor_username,event_type,target_type,target_key,permission_key,previous_value,next_value,reason)
    select c.policy_id,'dylan_collyge','draft_changed','user','nelly_aguilar',c.permission_key,null,
      jsonb_build_object('allowed',c.allowed,'scope',c.access_scope),
      'Kayla to Nelly scheduled handover'
    from copied c returning policy_id
  )
  select count(*) into audit_rows from audited;
  if audit_rows>0 then
    update private.app_access_policy_versions v set revision=revision+1
    where v.id in (select distinct policy_id from private.app_access_user_overrides where profile_id=nelly_id);
  end if;
end
$manager_overrides$;

do $operational_capabilities$
declare kayla_display text; nelly_display text; current_users jsonb;
begin
  if not exists (select 1 from public.profiles) then return; end if;
  select coalesce(nullif(display_name,''),username) into strict kayla_display
    from public.profiles where lower(btrim(username))='kayla_knepp';
  select coalesce(nullif(display_name,''),username) into strict nelly_display
    from public.profiles where lower(btrim(username))='nelly_aguilar';
  insert into public.ph_eval_assignment_users(username,display_name,active,source,updated_at)
  values('nelly_aguilar',nelly_display,true,'scheduled_handover',now())
  on conflict(username) do update set active=true,display_name=excluded.display_name,updated_at=now();

  select coalesce(value->'users','[]'::jsonb) into current_users
    from public.ph_app_settings where key='av_blanks_photo_bypass_users';
  current_users := (select coalesce(jsonb_agg(distinct lower(btrim(item.value))), '[]'::jsonb)
    from jsonb_array_elements_text(coalesce(current_users,'[]'::jsonb) || '["nelly_aguilar"]'::jsonb) as item(value));
  insert into public.ph_app_settings(key,value,updated_by,updated_at)
  values('av_blanks_photo_bypass_users',jsonb_build_object('users',current_users,'updatedBy','dylan_collyge','updatedAt',now()),
    'dylan_collyge',now())
  on conflict(key) do update set value=jsonb_set(coalesce(ph_app_settings.value,'{}'::jsonb),'{users}',current_users,true)
    || jsonb_build_object('updatedBy','dylan_collyge','updatedAt',now()),updated_by='dylan_collyge',updated_at=now();
end
$operational_capabilities$;

create or replace function private.app_account_active_at_v1(
  p_profile_id uuid,
  p_username text,
  p_at timestamptz
) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare profile_row public.profiles; legacy_row public.ph_app_users;
        uname text := lower(btrim(coalesce(p_username,'')));
begin
  if p_profile_id is not null then
    select * into profile_row from public.profiles where id = p_profile_id;
    if profile_row.id is null or (uname <> '' and lower(btrim(profile_row.username)) <> uname)
       or profile_row.disabled_at is not null
       or (profile_row.locked_until is not null and profile_row.locked_until > p_at)
       or exists (select 1 from private.scheduled_account_handover_v1 h
                  where h.departing_profile_id = profile_row.id and h.effective_at <= p_at) then
      return false;
    end if;
    if profile_row.legacy_user_id is not null then
      select * into legacy_row from public.ph_app_users where id=profile_row.legacy_user_id;
      if legacy_row.id is null or legacy_row.disabled_at is not null
         or (legacy_row.locked_until is not null and legacy_row.locked_until>p_at)
         or lower(btrim(legacy_row.username))<>lower(btrim(profile_row.username)) then return false; end if;
    end if;
    return true;
  end if;
  if uname = '' then return false; end if;
  if regexp_replace(uname,'[^a-z0-9]+','','g')='kaylaknepp' then uname:='kayla_knepp'; end if;
  select * into legacy_row from public.ph_app_users where lower(btrim(username))=uname;
  if legacy_row.id is null or legacy_row.disabled_at is not null
     or (legacy_row.locked_until is not null and legacy_row.locked_until>p_at) then return false; end if;
  select * into profile_row from public.profiles where lower(btrim(username))=uname;
  if profile_row.id is not null and (profile_row.disabled_at is not null
     or (profile_row.locked_until is not null and profile_row.locked_until>p_at)
     or profile_row.legacy_user_id is distinct from legacy_row.id
     or private.scheduled_handover_cutoff_reached_v1(profile_row.username,p_at)) then return false; end if;
  if profile_row.id is null and private.scheduled_handover_cutoff_reached_v1(uname,p_at) then return false; end if;
  return true;
end
$$;
revoke all on function private.app_account_active_at_v1(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function private.app_account_active_at_v1(uuid,text,timestamptz) to service_role;

create or replace function public.app_account_active_v1(
  p_profile_id uuid default null,
  p_username text default null
) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.app_account_active_at_v1(p_profile_id,p_username,clock_timestamp())
$$;
revoke all on function public.app_account_active_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.app_account_active_v1(uuid,text) to service_role;

create or replace function private.resolve_operational_recipients_at_v1(p_recipients text[], p_kind text, p_at timestamptz)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  kind text := lower(btrim(coalesce(p_kind,'')));
  recipient text;
  key text;
  profile_row public.profiles;
  auth_email text;
  result text[] := '{}'::text[];
  kayla_id uuid;
  nelly_id uuid;
  cutoff_at timestamptz;
  scheduled boolean := false;
  kayla_username text;
  nelly_username text;
begin
  if kind not in ('username','email') then raise exception 'recipient_kind_invalid'; end if;
  select effective_at into cutoff_at from private.scheduled_account_handover_v1
    where transition_key='kayla_knepp_to_nelly_aguilar_20261002';
  scheduled := cutoff_at is not null and p_at>=cutoff_at;
  select departing_profile_id,successor_profile_id into kayla_id,nelly_id
    from private.scheduled_account_handover_v1 where transition_key='kayla_knepp_to_nelly_aguilar_20261002';
  select username into kayla_username from public.profiles where id=kayla_id;
  select username into nelly_username from public.profiles where id=nelly_id;
  foreach recipient in array coalesce(p_recipients, '{}'::text[]) loop
    recipient := lower(btrim(coalesce(recipient,'')));
    if recipient = '' then continue; end if;
    key := regexp_replace(split_part(recipient, '@', 1), '[^a-z0-9]+', '', 'g');
    if (kind = 'username' and key = 'kaylaknepp')
       or (kind = 'email' and exists (select 1 from auth.users u where lower(u.email) = recipient and u.id = kayla_id)) then
      if not scheduled and private.app_account_active_at_v1(kayla_id,kayla_username,p_at) then
        if kind = 'username' then result := array_append(result,'kayla_knepp');
        else select lower(u.email) into auth_email from auth.users u where u.id = kayla_id; result := array_append(result,auth_email); end if;
      end if;
      if private.app_account_active_at_v1(nelly_id,nelly_username,p_at) then
        if kind = 'username' then result := array_append(result,'nelly_aguilar');
        else select lower(u.email) into auth_email from auth.users u where u.id = nelly_id; if auth_email is not null then result := array_append(result,auth_email); end if; end if;
      end if;
      continue;
    end if;
    if kind = 'username' then
      select * into profile_row from public.profiles p where lower(btrim(p.username)) = recipient;
      if profile_row.id is null then result := array_append(result,recipient);
      elsif private.app_account_active_at_v1(profile_row.id,profile_row.username,p_at)
        and not private.scheduled_handover_cutoff_reached_v1(profile_row.username,p_at)
        then result := array_append(result,lower(profile_row.username)); end if;
    else
      select p.* into profile_row
      from public.profiles p join auth.users u on u.id=p.id where lower(u.email)=recipient limit 1;
      select lower(u.email) into auth_email from auth.users u where u.id=profile_row.id;
      if profile_row.id is null then result := array_append(result,recipient);
      elsif private.app_account_active_at_v1(profile_row.id,profile_row.username,p_at)
        and not private.scheduled_handover_cutoff_reached_v1(profile_row.username,p_at)
        then result := array_append(result,auth_email); end if;
    end if;
  end loop;
  select coalesce(array_agg(distinct v order by v), '{}'::text[]) into result from unnest(result) v where v is not null and v <> '';
  return result;
end
$$;
revoke all on function private.resolve_operational_recipients_at_v1(text[],text,timestamptz) from public,anon,authenticated;
grant execute on function private.resolve_operational_recipients_at_v1(text[],text,timestamptz) to service_role;

create or replace function public.resolve_operational_recipients_v1(p_recipients text[],p_kind text)
returns text[] language sql stable security definer set search_path = '' as $$
  select private.resolve_operational_recipients_at_v1(p_recipients,p_kind,clock_timestamp())
$$;
revoke all on function public.resolve_operational_recipients_v1(text[],text) from public, anon, authenticated;
grant execute on function public.resolve_operational_recipients_v1(text[],text) to service_role;

create or replace function private.guard_active_app_session_v1()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); active public.profiles; caller_role text := coalesce(auth.role(),'');
begin
  if caller_role in ('service_role','supabase_admin') then return; end if;
  if caller_role='anon' and uid is null then return; end if;
  if uid is null then raise exception using errcode='42501',message='APP_ACCOUNT_INACTIVE'; end if;
  active := private.current_active_profile();
  if active.id is null then
    raise exception using errcode = '42501', message = 'APP_ACCOUNT_INACTIVE';
  end if;
end
$$;
revoke all on function private.guard_active_app_session_v1() from public, anon;
grant execute on function private.guard_active_app_session_v1() to authenticator, authenticated, service_role;
grant usage on schema private to authenticated, authenticator, service_role;

-- PostgREST runs its pre-request hook under the caller's role. A narrow
-- no-argument wrapper lets anonymous login requests proceed without granting
-- that role access to the private schema or any of its other helpers.
create or replace function public.guard_active_app_session_v1()
returns void language sql security definer set search_path = '' as $$
  select private.guard_active_app_session_v1()
$$;
revoke all on function public.guard_active_app_session_v1() from public, anon, authenticated;
grant execute on function public.guard_active_app_session_v1() to anon, authenticator, authenticated, service_role;

-- Restrictive policy means pre-existing permissive policies remain in place
-- for active staff but cannot keep an offboarded account connected.
do $policies$
declare t record;
begin
  -- Realtime postgres_changes rechecks the underlying table policies. Apply
  -- one restrictive predicate to every public base table that already has
  -- RLS enabled, so a legacy permissive policy cannot keep a stale JWT alive.
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
  loop
    if not exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and c.relname=t.relname and p.polname='scheduled_handover_active_session') then
      execute format('create policy scheduled_handover_active_session on public.%I as restrictive for all to authenticated using ((select (private.current_active_profile()).id) is not null) with check ((select (private.current_active_profile()).id) is not null)',t.relname);
    end if;
  end loop;
  if to_regclass('storage.objects') is not null and not exists (
      select 1 from pg_policy where polrelid='storage.objects'::regclass and polname='scheduled_handover_active_session') then
    execute 'create policy scheduled_handover_active_session on storage.objects as restrictive for all to authenticated using ((select (private.current_active_profile()).id) is not null) with check ((select (private.current_active_profile()).id) is not null)';
  end if;
  -- Existing Broadcast/Presence channels are Dylan-only. Avoid altering the
  -- managed Realtime table; PostgresChanges is covered by the public policies.
end
$policies$;

do $pre_request$
declare hook text;
begin
  select split_part(cfg.setting,'=',2) into hook
  from pg_db_role_setting rs
  cross join lateral unnest(rs.setconfig) as cfg(setting)
  where rs.setdatabase in (0,(select oid from pg_database where datname=current_database()))
    and rs.setrole in (0,(select oid from pg_roles where rolname='authenticator'))
    and cfg.setting like 'pgrst.db_pre_request=%'
  limit 1;
  if hook is not null and hook <> 'public.guard_active_app_session_v1' then
    raise exception 'existing pgrst.db_pre_request hook must be composed explicitly, found %', hook;
  end if;
  execute 'alter role authenticator set pgrst.db_pre_request = ''public.guard_active_app_session_v1''';
  perform pg_notify('pgrst','reload config');
end
$pre_request$;

create or replace function public.scheduled_handover_auth_checkpoint_v1(p_ok boolean, p_error_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h private.scheduled_account_handover_v1;
begin
  update private.scheduled_account_handover_v1
  set auth_ban_attempts = auth_ban_attempts + 1,
      auth_banned_at = case when p_ok then coalesce(auth_banned_at,now()) else auth_banned_at end,
      auth_ban_next_attempt_at = case when p_ok then null else now()+make_interval(mins=>least(60,power(2,least(auth_ban_attempts,6))::integer)) end,
      auth_ban_error_code = case when p_ok then null else left(regexp_replace(coalesce(p_error_code,'auth_ban_failed'),'[^a-zA-Z0-9_-]','','g'),80) end,
      last_error_code = case when p_ok then null else left(regexp_replace(coalesce(p_error_code,'auth_ban_failed'),'[^a-zA-Z0-9_-]','','g'),80) end,
      updated_at=now()
  where transition_key='kayla_knepp_to_nelly_aguilar_20261002' and effective_at<=now()
  returning * into h;
  if h.transition_key is null then return jsonb_build_object('due',false); end if;
  insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
  values(h.transition_key,'kayla_nelly_auth_ban_try_'||h.auth_ban_attempts,'auth_ban_attempt',
    jsonb_build_object('ok',p_ok,'errorCode',h.auth_ban_error_code)) on conflict(event_key) do nothing;
  if not p_ok then
    insert into private.scheduled_handover_push_outbox_v1(event_key,event_type,transition_key)
    values(h.transition_key||':failed:auth', 'scheduled_handover_failed', h.transition_key) on conflict(event_key) do nothing;
  end if;
  return jsonb_build_object('due',true,'authBanned',h.auth_banned_at is not null,'attempts',h.auth_ban_attempts);
end
$$;

create or replace function public.scheduled_handover_tick_v1()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h private.scheduled_account_handover_v1;
  w public.ph_eval_work;
  flyer public.ph_flyer_folder_rows;
  assignees jsonb;
  before_eval jsonb;
  nelly public.profiles;
  nelly_display text;
  nelly_email text;
  changed integer := 0;
  flyer_changed integer := 0;
  other_transfer jsonb := '{}'::jsonb;
  other_transfer_attempt integer;
  new_flyer_assigned text;
  remaining_names text;
  transfer_error text;
  still_pending boolean;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('scheduled_handover_kayla_nelly_v1',0)) then
    return jsonb_build_object('due',now()>='2026-10-03 04:00:00+00'::timestamptz,'busy',true);
  end if;
  select * into h from private.scheduled_account_handover_v1
    where transition_key='kayla_knepp_to_nelly_aguilar_20261002' for update;
  if h.transition_key is null then return jsonb_build_object('configured',false,'due',false); end if;
  if now() < h.effective_at then
    return jsonb_build_object('due',false,'effectiveAt',h.effective_at);
  end if;

  update public.profiles set disabled_at=coalesce(disabled_at,h.effective_at), updated_at=now()
    where id=h.departing_profile_id;
  update public.ph_app_users set disabled_at=coalesce(disabled_at,h.effective_at)
    where lower(btrim(username))='kayla_knepp';
  update public.ph_eval_assignment_users set active=false,updated_at=now()
    where lower(btrim(username))='kayla_knepp' and active is distinct from false;
  insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
  values(h.transition_key,'kayla_nelly_cutoff_enforced','cutoff_enforced',jsonb_build_object('effectiveAt',h.effective_at))
  on conflict(event_key) do nothing;
  update public.ph_push_subscriptions set notifications_enabled=false
    where profile_id=h.departing_profile_id or lower(btrim(username))='kayla_knepp';
  insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
  values(h.transition_key,'kayla_nelly_push_disabled','push_disabled',jsonb_build_object('profileId',h.departing_profile_id))
  on conflict(event_key) do nothing;

  select p.* into strict nelly from public.profiles p where p.id=h.successor_profile_id;
  nelly_display := coalesce(nullif(nelly.display_name,''),nelly.username);
  select lower(u.email) into strict nelly_email from auth.users u where u.id=h.successor_profile_id;
  for w in select * from public.ph_eval_work x
    where x.status in ('open','in_progress')
      and (lower(x.assignee_username)='kayla_knepp' or 'kayla_knepp'=any(x.assignee_usernames)
        or exists(select 1 from jsonb_array_elements(x.assignee_profiles) a where lower(a->>'username')='kayla_knepp'))
      and not exists(select 1 from private.scheduled_handover_assignment_state_v1 s
        where s.target_key='eval_work:'||x.id::text and s.transferred_at is null and s.next_attempt_at>now())
    order by x.updated_at, x.id for update skip locked limit 50
  loop
    begin
      before_eval := jsonb_build_object('assignee_username',w.assignee_username,
        'assignee_usernames',w.assignee_usernames,'assignee_profiles',w.assignee_profiles,'version',w.version);
      select jsonb_build_array(jsonb_build_object('username',lower(nelly.username),
        'display',coalesce(nullif(nelly.display_name,''),nelly.username),'email',nelly_email))
        || coalesce((select jsonb_agg(a.value order by a.ordinality)
          from jsonb_array_elements(w.assignee_profiles) with ordinality a(value,ordinality)
          where lower(btrim(a.value->>'username')) not in ('kayla_knepp','nelly_aguilar')),'[]'::jsonb)
        into assignees;
      perform public.reassign_eval_work_v2(jsonb_build_object(
        'workId',w.id,'actorUsername','dylan_collyge','expectedVersion',w.version,'assignees',assignees));
      select * into w from public.ph_eval_work where id=w.id;
      changed := changed+1;
      insert into private.scheduled_handover_assignment_state_v1(target_key,target_kind,transferred_at,next_attempt_at)
      values('eval_work:'||w.id::text,'eval_work',now(),now())
      on conflict(target_key) do update set transferred_at=coalesce(scheduled_handover_assignment_state_v1.transferred_at,now()),
        next_attempt_at=now(),last_error_code=null,updated_at=now();
      insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
      values(h.transition_key,'kayla_nelly_assignment_'||w.id::text,'assignment_transferred',
        jsonb_build_object('workId',w.id,'before',before_eval,'after',jsonb_build_object(
          'assignee_username',w.assignee_username,'assignee_usernames',w.assignee_usernames,
          'assignee_profiles',w.assignee_profiles,'version',w.version)))
      on conflict(event_key) do nothing;
    exception when others then
      transfer_error := case when SQLSTATE in ('40001','55P03','57014') then 'assignment_retryable_conflict_'||SQLSTATE else 'assignment_transfer_failed_'||SQLSTATE end;
      insert into private.scheduled_handover_assignment_state_v1(target_key,target_kind,attempts,next_attempt_at,last_error_code,updated_at)
      values('eval_work:'||w.id::text,'eval_work',1,now()+interval '2 minutes',transfer_error,now())
      on conflict(target_key) do update set attempts=scheduled_handover_assignment_state_v1.attempts+1,
        next_attempt_at=now()+make_interval(mins=>least(60,power(2,least(scheduled_handover_assignment_state_v1.attempts,6))::integer)),
        last_error_code=excluded.last_error_code,updated_at=now();
      insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
      values(h.transition_key,'kayla_nelly_assignment_failure_'||w.id::text||'_v'||w.version,'assignment_failed',
        jsonb_build_object('workId',w.id,'version',w.version,'errorCode',transfer_error)) on conflict(event_key) do nothing;
    end;
  end loop;

  -- Transfer only live, unfinished flyer cards. Completed cards and the
  -- history mirror are intentionally untouched. The table scan is bounded;
  -- each updated UID receives a durable audit key for safe retries.
  for flyer in select * from public.ph_flyer_folder_rows f
    where lower(btrim(coalesce(f.assignedto,'')))='kayla_knepp'
      and f.flyer_completed is null and f.date_completed is null
      and not exists(select 1 from private.scheduled_handover_assignment_state_v1 s
        where s.target_key='flyer:'||md5(f.unique_id) and s.transferred_at is null and s.next_attempt_at>now())
    order by f.updated_at,f.unique_id for update skip locked limit 100
  loop
    begin
      select string_agg(trim(names.name),', ' order by names.ordinality)
        into remaining_names
      from regexp_split_to_table(coalesce(flyer.flyer_assigned,''),'\s*,\s*') with ordinality as names(name,ordinality)
      where regexp_replace(lower(btrim(names.name)),'[^a-z0-9]+','','g') not in ('kaylaknepp','nellyaguilar');
      new_flyer_assigned := nelly_display || case when coalesce(remaining_names,'')='' then '' else ', '||remaining_names end;
      update public.ph_flyer_folder_rows set
        assignedto='nelly_aguilar',flyer_assigned=new_flyer_assigned,updated_at=now()
      where unique_id=flyer.unique_id;
      flyer_changed := flyer_changed+1;
      insert into private.scheduled_handover_assignment_state_v1(target_key,target_kind,transferred_at,next_attempt_at)
      values('flyer:'||md5(flyer.unique_id),'flyer',now(),now())
      on conflict(target_key) do update set transferred_at=coalesce(scheduled_handover_assignment_state_v1.transferred_at,now()),
        next_attempt_at=now(),last_error_code=null,updated_at=now();
      insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
      values(h.transition_key,'kayla_nelly_flyer_'||md5(flyer.unique_id),'assignment_transferred',
        jsonb_build_object('uniqueId',flyer.unique_id,'kind','active_flyer',
          'before',jsonb_build_object('assignedto',flyer.assignedto,'flyer_assigned',flyer.flyer_assigned),
          'after',jsonb_build_object('assignedto','nelly_aguilar','flyer_assigned',new_flyer_assigned)))
      on conflict(event_key) do nothing;
    exception when others then
      transfer_error := case when SQLSTATE in ('40001','55P03','57014') then 'flyer_transfer_retryable_conflict_'||SQLSTATE else 'flyer_transfer_failed_'||SQLSTATE end;
      insert into private.scheduled_handover_assignment_state_v1(target_key,target_kind,attempts,next_attempt_at,last_error_code,updated_at)
      values('flyer:'||md5(flyer.unique_id),'flyer',1,now()+interval '2 minutes',transfer_error,now())
      on conflict(target_key) do update set attempts=scheduled_handover_assignment_state_v1.attempts+1,
        next_attempt_at=now()+make_interval(mins=>least(60,power(2,least(scheduled_handover_assignment_state_v1.attempts,6))::integer)),
        last_error_code=excluded.last_error_code,updated_at=now();
      insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
      values(h.transition_key,'kayla_nelly_flyer_failure_'||md5(flyer.unique_id)||'_v'||flyer.updated_at::text,'assignment_failed',
        jsonb_build_object('uniqueId',flyer.unique_id,'errorCode',transfer_error)) on conflict(event_key) do nothing;
    end;
  end loop;
  changed := changed+flyer_changed;

  -- Remaining business tables are handled by the companion, bounded
  -- transfer function shipped in the same release migration set.
  if exists(select 1 from private.scheduled_handover_assignment_state_v1 s
      where s.target_key='companion' and s.transferred_at is not null) then
    other_transfer := jsonb_build_object('remaining',false,'changed',0);
  elsif to_regprocedure('private.transfer_remaining_handover_assignments_v1(text,integer)') is null then
    transfer_error := 'remaining_transfer_missing';
    other_transfer := jsonb_build_object('remaining',true,'errorCode',transfer_error);
    insert into private.scheduled_handover_push_outbox_v1(event_key,event_type,transition_key)
    values(h.transition_key||':failed:remaining-missing','scheduled_handover_failed',h.transition_key) on conflict(event_key) do nothing;
  elsif not exists(select 1 from private.scheduled_handover_assignment_state_v1 s
    where s.target_key='companion' and s.transferred_at is null and s.next_attempt_at>now()) then
    select attempts into other_transfer_attempt from private.scheduled_handover_assignment_state_v1
      where target_key='companion';
    begin
      execute 'select private.transfer_remaining_handover_assignments_v1($1,$2)'
        into other_transfer using h.transition_key,100;
      if nullif(other_transfer->>'errorCode','') is not null then
        transfer_error := other_transfer->>'errorCode';
        raise exception using errcode='PT409',message='remaining_transfer_reported_error';
      end if;
      insert into private.scheduled_handover_assignment_state_v1(target_key,target_kind,attempts,next_attempt_at,transferred_at,last_error_code,updated_at)
      values('companion','other',0,now(),case when coalesce((other_transfer->>'remaining')::boolean,true) then null else now() end,null,now())
      on conflict(target_key) do update set attempts=0,next_attempt_at=now(),
        transferred_at=case when coalesce((other_transfer->>'remaining')::boolean,true) then null else coalesce(scheduled_handover_assignment_state_v1.transferred_at,now()) end,
        last_error_code=null,updated_at=now();
    exception when others then
      transfer_error := coalesce(transfer_error,case when SQLSTATE in ('40001','55P03','57014') then 'remaining_transfer_retryable_conflict_'||SQLSTATE else 'remaining_transfer_failed_'||SQLSTATE end);
      other_transfer := jsonb_build_object('remaining',true,'errorCode',transfer_error);
      insert into private.scheduled_handover_assignment_state_v1(target_key,target_kind,attempts,next_attempt_at,last_error_code,updated_at)
      values('companion','other',coalesce(other_transfer_attempt,0)+1,
        now()+make_interval(mins=>least(60,power(2,least(coalesce(other_transfer_attempt,0),6))::integer)),transfer_error,now())
      on conflict(target_key) do update set attempts=scheduled_handover_assignment_state_v1.attempts+1,
        next_attempt_at=now()+make_interval(mins=>least(60,power(2,least(scheduled_handover_assignment_state_v1.attempts,6))::integer)),
        last_error_code=excluded.last_error_code,updated_at=now();
      insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
      values(h.transition_key,'kayla_nelly_remaining_failure_'||(coalesce(other_transfer_attempt,0)+1)::text,'assignment_failed',
        jsonb_build_object('errorCode',transfer_error)) on conflict(event_key) do nothing;
      insert into private.scheduled_handover_push_outbox_v1(event_key,event_type,transition_key)
      values(h.transition_key||':failed:remaining','scheduled_handover_failed',h.transition_key) on conflict(event_key) do nothing;
    end;
  else
    transfer_error := 'remaining_transfer_backoff';
    other_transfer := jsonb_build_object('remaining',true,'errorCode',transfer_error);
  end if;
  changed := changed+coalesce((other_transfer->>'changed')::integer,0);
  if nullif(other_transfer->>'errorCode','') is not null then transfer_error:=other_transfer->>'errorCode'; end if;
  update private.scheduled_account_handover_v1 set transferred_count=transferred_count+changed,
    last_error_code=transfer_error,updated_at=now()
    where transition_key=h.transition_key returning * into h;
  select exists(select 1 from public.ph_eval_work x where x.status in ('open','in_progress')
    and (lower(x.assignee_username)='kayla_knepp' or 'kayla_knepp'=any(x.assignee_usernames)
      or exists(select 1 from jsonb_array_elements(x.assignee_profiles) a where lower(a->>'username')='kayla_knepp')))
    or exists(select 1 from public.ph_flyer_folder_rows f where lower(btrim(coalesce(f.assignedto,'')))='kayla_knepp'
      and f.flyer_completed is null and f.date_completed is null)
    or coalesce((other_transfer->>'remaining')::boolean,true)
    into still_pending;
  if h.auth_banned_at is not null and not still_pending then
    update private.scheduled_account_handover_v1 set completed_at=coalesce(completed_at,now()),last_error_code=null,updated_at=now()
      where transition_key=h.transition_key returning * into h;
    insert into private.scheduled_handover_push_outbox_v1(event_key,event_type,transition_key)
    values(h.transition_key||':complete','scheduled_handover_complete',h.transition_key) on conflict(event_key) do nothing;
    insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
    values(h.transition_key,'kayla_nelly_handover_completed','completed',jsonb_build_object('transferredCount',h.transferred_count))
    on conflict(event_key) do nothing;
  end if;
  return jsonb_build_object('due',true,'authBanPending',h.auth_banned_at is null
      and (h.auth_ban_next_attempt_at is null or h.auth_ban_next_attempt_at<=now()),
    'transferredThisRun',changed,'flyerTransferredThisRun',flyer_changed,
    'transferredTotal',h.transferred_count,'assignmentsPending',still_pending,
    'complete',h.completed_at is not null,'errorCode',h.last_error_code,'profileId',h.departing_profile_id);
end
$$;

create or replace function public.scheduled_handover_claim_push_v1()
returns setof private.scheduled_handover_push_outbox_v1
language sql security definer set search_path = '' as $$
  with picked as (
    select id from private.scheduled_handover_push_outbox_v1
    where (status='pending' and next_attempt_at<=now())
      or (status='failed' and attempt_count<10 and next_attempt_at<=now())
      or (status='processing' and lease_expires_at<=now())
    order by created_at for update skip locked limit 3
  )
  update private.scheduled_handover_push_outbox_v1 o
  set status='processing',attempt_count=attempt_count+1,lease_expires_at=now()+interval '90 seconds'
  from picked where o.id=picked.id returning o.*
$$;

create or replace function public.scheduled_handover_finish_push_v1(p_id bigint,p_ok boolean,p_error_code text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update private.scheduled_handover_push_outbox_v1 set
    status=case when p_ok then 'sent' when attempt_count>=10 then 'abandoned' else 'failed' end,
    sent_at=case when p_ok then now() else sent_at end,
    error_code=case when p_ok then null else left(regexp_replace(coalesce(p_error_code,'push_failed'),'[^a-zA-Z0-9_-]','','g'),80) end,
    next_attempt_at=now()+make_interval(mins=>least(60, power(2,least(attempt_count,5))::integer)),
    lease_expires_at=null
  where id=p_id and status='processing';
  return found;
end
$$;

revoke all on function public.scheduled_handover_auth_checkpoint_v1(boolean,text) from public,anon,authenticated;
revoke all on function public.scheduled_handover_tick_v1() from public,anon,authenticated;
revoke all on function public.scheduled_handover_claim_push_v1() from public,anon,authenticated;
revoke all on function public.scheduled_handover_finish_push_v1(bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.scheduled_handover_auth_checkpoint_v1(boolean,text) to service_role;
grant execute on function public.scheduled_handover_tick_v1() to service_role;
grant execute on function public.scheduled_handover_claim_push_v1() to service_role;
grant execute on function public.scheduled_handover_finish_push_v1(bigint,boolean,text) to service_role;

create or replace function private.scheduled_handover_dispatch_v1()
returns void language plpgsql security definer set search_path = '' as $$
declare project_url text; service_key text; h private.scheduled_account_handover_v1;
begin
  select * into h from private.scheduled_account_handover_v1
    where transition_key='kayla_knepp_to_nelly_aguilar_20261002';
  if h.transition_key is null or now()<h.effective_at then return; end if;
  -- Enforce the scheduled cutoff locally before any Edge invocation. The
  -- profile/RLS predicate already uses effective_at, so a delayed HTTP worker
  -- or missing Vault secret cannot extend database access.
  update public.profiles set disabled_at=coalesce(disabled_at,h.effective_at),updated_at=now()
    where id=h.departing_profile_id;
  update public.ph_app_users set disabled_at=coalesce(disabled_at,h.effective_at)
    where lower(btrim(username))='kayla_knepp';
  update public.ph_eval_assignment_users set active=false,updated_at=now()
    where lower(btrim(username))='kayla_knepp' and active is distinct from false;
  update public.ph_push_subscriptions set notifications_enabled=false
    where profile_id=h.departing_profile_id or lower(btrim(username))='kayla_knepp';
  insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
  values(h.transition_key,'kayla_nelly_cutoff_enforced','cutoff_enforced',jsonb_build_object('effectiveAt',h.effective_at))
  on conflict(event_key) do nothing;
  insert into private.scheduled_account_handover_audit_v1(transition_key,event_key,event_type,metadata)
  values(h.transition_key,'kayla_nelly_push_disabled','push_disabled',jsonb_build_object('profileId',h.departing_profile_id))
  on conflict(event_key) do nothing;
  if h.completed_at is not null and not exists (
      select 1 from private.scheduled_handover_push_outbox_v1 o where o.transition_key=h.transition_key
        and o.status in ('pending','processing','failed')) then
    perform cron.unschedule(jobid) from cron.job where jobname='scheduled_handover_kayla_nelly_20261002';
    return;
  end if;
  select decrypted_secret into project_url from vault.decrypted_secrets where name='hr_calendar_project_url' limit 1;
  select decrypted_secret into service_key from vault.decrypted_secrets where name='hr_calendar_service_role_key' limit 1;
  if coalesce(project_url,'')='' or coalesce(service_key,'')='' then
    update private.scheduled_account_handover_v1 set last_error_code='worker_vault_missing',updated_at=now()
      where transition_key=h.transition_key;
    return;
  end if;
  perform net.http_post(url:=rtrim(project_url,'/')||'/functions/v1/scheduled-offboarding',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||service_key),
    body:=jsonb_build_object('source','pg_cron'),timeout_milliseconds:=55000);
end
$$;
revoke all on function private.scheduled_handover_dispatch_v1() from public,anon,authenticated;

do $cron$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='scheduled_handover_kayla_nelly_20261002' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('scheduled_handover_kayla_nelly_20261002','* * * * *',
    'select private.scheduled_handover_dispatch_v1();');
end
$cron$;

commit;
