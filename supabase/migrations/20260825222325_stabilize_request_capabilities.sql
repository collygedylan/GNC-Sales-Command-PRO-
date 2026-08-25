begin;

create or replace function private.can_work_request_identity(
  creator_username text,
  selected_rep_username text,
  requested_by_value text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select
      lower(btrim(coalesce((private.current_active_profile()).username, ''))) as username_key,
      regexp_replace(split_part(lower(coalesce((private.current_active_profile()).username, '')), '@', 1), '[^a-z0-9]+', '', 'g') as identity_key
  )
  select (private.current_active_profile()).id is not null
     and (
       (select username_key from actor) <> 'ben_brown'
       or (
         (select identity_key from actor) <> ''
         and (select identity_key from actor) in (
           regexp_replace(split_part(lower(coalesce(creator_username, '')), '@', 1), '[^a-z0-9]+', '', 'g'),
           regexp_replace(split_part(lower(coalesce(selected_rep_username, '')), '@', 1), '[^a-z0-9]+', '', 'g'),
           regexp_replace(split_part(lower(coalesce(requested_by_value, '')), '@', 1), '[^a-z0-9]+', '', 'g')
         )
       )
     )
$$;

revoke all on function private.can_work_request_identity(text, text, text)
  from public, anon, authenticated;

-- The authenticated actor, not browser-supplied JSON, is authoritative for
-- the creator username on every newly submitted Request row.
create or replace function private.stamp_request_batch_creator(p_requests jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  stamped jsonb;
begin
  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'REQUEST_PROFILE_REQUIRED';
  end if;
  if jsonb_typeof(p_requests) <> 'array' then
    return p_requests;
  end if;

  select coalesce(
    jsonb_agg(
      item.value || jsonb_build_object('request_created_by_username', profile.username)
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  into stamped
  from jsonb_array_elements(p_requests) with ordinality as item(value, ordinality);

  return stamped;
end;
$$;

revoke all on function private.stamp_request_batch_creator(jsonb)
  from public, anon, authenticated;

-- Request permissions are returned through one authenticated capability contract.
-- The function exposes no row data and preserves the existing active-profile guard.
create or replace function public.get_request_capabilities()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile public.profiles%rowtype;
  username_key text;
  role_key text;
  global_access boolean;
  save_access boolean;
  general_create_access boolean;
  av_create_access boolean;
  request_scope text;
begin
  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'REQUEST_PROFILE_REQUIRED';
  end if;

  username_key := lower(btrim(coalesce(profile.username, '')));
  role_key := private.normalized_profile_role(profile.role);
  global_access := private.can_manage_requests();
  save_access := private.can_save_request_work();
  general_create_access := private.can_create_general_requests() or username_key = 'ben_brown';
  av_create_access := private.can_create_av_requests() or username_key = 'ben_brown';

  request_scope := case
    when global_access then 'global'
    when username_key = 'ben_brown' then 'own'
    when private.is_sales_request_role() then 'rep'
    when role_key = 'CSR' then 'created'
    when role_key like 'EVAL%' then 'eval'
    else 'role'
  end;

  return jsonb_build_object(
    'contract_version', 1,
    'username', username_key,
    'scope', request_scope,
    'can_create_general', general_create_access,
    'can_create_av', av_create_access,
    'can_view_queue', true,
    'can_take_photo', save_access,
    'can_edit', save_access,
    'can_complete', save_access,
    'can_archive', global_access
  );
end;
$$;

revoke all on function public.get_request_capabilities() from public, anon;
grant execute on function public.get_request_capabilities() to authenticated;

-- Ben is the only sales-role exception allowed to create the existing general/plant
-- request type. Other role behavior remains unchanged.
create or replace function private.can_create_general_requests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.current_active_profile()).id is not null
     and (
       lower(btrim((private.current_active_profile()).username)) = 'ben_brown'
       or (
         not private.is_sales_request_role()
         and (
           lower(btrim((private.current_active_profile()).username)) in
             ('dylan_collyge', 'jd_jones', 'megan_kelly', 'kayla_knepp')
           or private.normalized_profile_role((private.current_active_profile()).role) not like 'QC%'
         )
       )
     )
$$;

revoke all on function private.can_create_general_requests() from public, anon, authenticated;

create or replace function public.create_request_batch(
  client_batch_id uuid,
  requests jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_create_general_requests() then
    raise exception using errcode = '42501', message = 'GENERAL_REQUEST_CREATE_FORBIDDEN';
  end if;
  return private.insert_request_batch(
    client_batch_id,
    private.stamp_request_batch_creator(requests),
    'general'
  );
end;
$$;

create or replace function public.create_av_request_batch(
  client_batch_id uuid,
  requests jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_create_av_requests() then
    raise exception using errcode = '42501', message = 'AV_REQUEST_CREATE_FORBIDDEN';
  end if;
  return private.insert_request_batch(
    client_batch_id,
    private.stamp_request_batch_creator(requests),
    'av'
  );
end;
$$;

revoke all on function public.create_request_batch(uuid, jsonb) from public, anon;
grant execute on function public.create_request_batch(uuid, jsonb) to authenticated;
revoke all on function public.create_av_request_batch(uuid, jsonb) from public, anon;
grant execute on function public.create_av_request_batch(uuid, jsonb) to authenticated;

-- Keep existing active-profile access for every user except Ben, whose read,
-- insert, and direct-update boundaries are enforced at the database row.
drop policy if exists ph_active_request_authenticated_read on public.ph_active_request;
create policy ph_active_request_authenticated_read
on public.ph_active_request
for select
to authenticated
using (
  (private.current_active_profile()).id is not null
  and private.can_work_request_identity(
    request_created_by_username,
    request_selected_rep_username,
    requested_by
  )
);

drop policy if exists ph_active_request_general_insert on public.ph_active_request;
create policy ph_active_request_general_insert
on public.ph_active_request
for insert
to authenticated
with check (
  private.can_create_general_requests()
  and private.can_work_request_identity(
    request_created_by_username,
    request_selected_rep_username,
    requested_by
  )
);

drop policy if exists ph_active_request_general_update on public.ph_active_request;
create policy ph_active_request_general_update
on public.ph_active_request
for update
to authenticated
using (
  private.can_create_general_requests()
  and private.can_work_request_identity(
    request_created_by_username,
    request_selected_rep_username,
    requested_by
  )
)
with check (
  private.can_create_general_requests()
  and private.can_work_request_identity(
    request_created_by_username,
    request_selected_rep_username,
    requested_by
  )
);

drop policy if exists ph_request_history_authenticated_read on public.ph_request_history;
create policy ph_request_history_authenticated_read
on public.ph_request_history
for select
to authenticated
using (
  (private.current_active_profile()).id is not null
  and private.can_work_request_identity(
    request_created_by_username,
    request_selected_rep_username,
    requested_by
  )
);

-- Preserve the hardened completion authority and add Ben's server-side own/assigned
-- row boundary before any acknowledgement or mutation can occur.
create or replace function public.save_request_work(
  request_id text,
  expected_version bigint,
  patch jsonb,
  complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.ph_active_request%rowtype;
  profile public.profiles%rowtype;
  profile_email text;
  canonical jsonb;
  safe_patch jsonb;
begin
  if not private.can_save_request_work() then
    raise exception using errcode = '42501', message = 'REQUEST_SAVE_FORBIDDEN';
  end if;
  if nullif(btrim(coalesce(request_id, '')), '') is null or expected_version is null then
    raise exception using errcode = '22023', message = 'REQUEST_ID_AND_VERSION_REQUIRED';
  end if;
  if patch is null or jsonb_typeof(patch) <> 'object' then
    raise exception using errcode = '22023', message = 'REQUEST_PATCH_INVALID';
  end if;

  select * into existing from public.ph_active_request where unique_id = request_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_NOT_FOUND';
  end if;

  profile := private.current_active_profile();
  if profile.id is null then
    raise exception using errcode = '42501', message = 'REQUEST_PROFILE_REQUIRED';
  end if;
  if lower(btrim(coalesce(profile.username, ''))) = 'ben_brown' then
    if not private.can_work_request_identity(
      existing.request_created_by_username,
      existing.request_selected_rep_username,
      existing.requested_by
    ) then
      raise exception using errcode = '42501', message = 'REQUEST_ROW_FORBIDDEN';
    end if;
  end if;

  if lower(coalesce(existing.req_status, '')) in ('complete', 'completed')
     or nullif(btrim(coalesce(existing.date_completed, '')), '') is not null then
    canonical := coalesce(private.canonical_request_json(request_id), to_jsonb(existing));
    return jsonb_build_object(
      'row', canonical, 'row_version', existing.row_version,
      'delivery_state', coalesce((
        select o.status from public.ph_request_delivery_outbox o
        where o.request_id = existing.unique_id and o.event_type = 'request_completed'
        order by o.created_at desc limit 1
      ), 'already_completed'),
      'acknowledged', true
    );
  end if;
  if existing.row_version <> expected_version then
    raise exception using errcode = '40001', message = 'REQUEST_VERSION_CONFLICT',
      detail = jsonb_build_object('current_version', existing.row_version)::text;
  end if;

  safe_patch := patch - 'completed_by_username' - 'completed_by_display' - 'completed_by_email';
  if complete then
    select u.email into profile_email from auth.users u where u.id = profile.id;
    safe_patch := safe_patch || jsonb_build_object(
      'completed_by_username', profile.username,
      'completed_by_display', coalesce(nullif(profile.display_name, ''), profile.username),
      'completed_by_email', coalesce(profile_email, '')
    );
  end if;

  return public.save_request_work_v1(request_id, expected_version, safe_patch, complete);
end;
$$;

revoke all on function public.save_request_work(text, bigint, jsonb, boolean)
  from public, anon;
grant execute on function public.save_request_work(text, bigint, jsonb, boolean)
  to authenticated;

commit;
