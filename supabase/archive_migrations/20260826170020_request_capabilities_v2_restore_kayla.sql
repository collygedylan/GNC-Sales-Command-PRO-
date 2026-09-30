begin;

-- Global Request managers must be evaluated before sales-role exclusions.
-- Kayla is intentionally both a SalesRep and a global Request manager.
create or replace function private.can_create_general_requests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with profile as (
    select
      (private.current_active_profile()).id as id,
      lower(btrim(coalesce((private.current_active_profile()).username, ''))) as username_key,
      private.normalized_profile_role((private.current_active_profile()).role) as role_key
  )
  select (select id from profile) is not null
     and (
       (select username_key from profile) in
         ('dylan_collyge', 'jd_jones', 'megan_kelly', 'kayla_knepp')
       or (select username_key from profile) in
         ('ben_brown', 'chance_alldredge')
       or (
         not private.is_sales_request_role()
         and (select role_key from profile) not like 'QC%'
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
    'contract_version', 2,
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

commit;
