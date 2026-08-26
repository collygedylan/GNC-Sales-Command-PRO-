begin;

-- Ben and Chance may create the existing general/plant and AV Request types,
-- but their Request visibility and mutations remain limited to rows they
-- created or rows assigned/requested for their normalized identity.
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
       (select username_key from actor) not in ('ben_brown', 'chance_alldredge')
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
  from public, anon;
grant execute on function private.can_work_request_identity(text, text, text)
  to authenticated;

create or replace function private.can_create_general_requests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.current_active_profile()).id is not null
     and (
       lower(btrim((private.current_active_profile()).username)) in
         ('ben_brown', 'chance_alldredge')
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

revoke all on function private.can_create_general_requests()
  from public, anon, authenticated;

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
  general_create_access := private.can_create_general_requests();
  av_create_access := private.can_create_av_requests();

  request_scope := case
    when global_access then 'global'
    when username_key in ('ben_brown', 'chance_alldredge') then 'own'
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

revoke all on function public.get_request_capabilities()
  from public, anon;
grant execute on function public.get_request_capabilities()
  to authenticated;

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
  if lower(btrim(coalesce(profile.username, ''))) in ('ben_brown', 'chance_alldredge') then
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
