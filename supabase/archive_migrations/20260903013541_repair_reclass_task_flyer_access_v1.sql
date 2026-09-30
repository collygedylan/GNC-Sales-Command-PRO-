begin;

-- Flyer creation is an authenticated workflow for active Administrators plus
-- Dylan and Megan. Keep this separate from require_active_admin_profile():
-- Drive evidence writes and every other Admin operation retain their existing
-- authorization boundary.
create or replace function private.require_active_flyer_creator_profile()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.profiles%rowtype;
  v_username text;
  v_role text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid();

  v_username := lower(btrim(coalesce(v_profile.username, '')));
  v_role := upper(btrim(coalesce(v_profile.role, '')));

  if not found
     or v_profile.disabled_at is not null
     or (v_profile.locked_until is not null and v_profile.locked_until > now())
     or not (
       v_role in ('ADMIN', 'ADMINISTRATOR')
       or v_username in ('dylan_collyge', 'megan_kelly')
     ) then
    raise exception using errcode = '42501', message = 'ACTIVE_FLYER_CREATOR_REQUIRED';
  end if;

  return v_profile;
end
$function$;

revoke all on function private.require_active_flyer_creator_profile() from public, anon, authenticated;

-- Preserve the proven atomic/idempotent V1 implementation while replacing
-- only its authorization helper. The guard makes migration drift fail closed.
do $migration$
declare
  v_definition text;
  v_old_call constant text := 'private.require_active_admin_profile()';
  v_new_call constant text := 'private.require_active_flyer_creator_profile()';
begin
  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('public.create_flyer_folder_batch_v1(text,text[],text[],boolean,text)')
  ) into v_definition;

  if v_definition is null then
    raise exception using errcode = '42883', message = 'FLYER_CREATE_CONTRACT_MISSING';
  end if;
  if pg_catalog.strpos(v_definition, v_old_call) = 0 then
    raise exception using errcode = '55000', message = 'FLYER_CREATE_AUTH_GUARD_MISMATCH';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old_call, v_new_call);
  execute v_definition;
end
$migration$;

revoke all on function public.create_flyer_folder_batch_v1(text, text[], text[], boolean, text) from public, anon;
grant execute on function public.create_flyer_folder_batch_v1(text, text[], text[], boolean, text) to authenticated;

comment on function public.create_flyer_folder_batch_v1(text, text[], text[], boolean, text)
  is 'Active Admin, dylan_collyge, or megan_kelly server-authoritative Flyer folder batch writer. Contract create-flyer-folder-batch-v1.';

commit;
