begin;

-- The isolated CI stack intentionally does not replay the historical
-- Kayla account-promotion migration that originally introduced this RPC.
-- Preserve only the callable contract and its legacy authorization hook so
-- later migrations can prove that they replace the hook safely.
create schema if not exists private;

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

  select * into v_profile
  from public.profiles
  where id = auth.uid();

  if not found
     or v_profile.disabled_at is not null
     or (v_profile.locked_until is not null and v_profile.locked_until > now())
     or upper(btrim(coalesce(v_profile.role, ''))) not in ('ADMIN', 'ADMINISTRATOR') then
    raise exception using errcode = '42501', message = 'ACTIVE_ADMIN_REQUIRED';
  end if;

  return v_profile;
end
$function$;

create or replace function public.create_flyer_folder_batch_v1(
  p_name text,
  p_request_ids text[],
  p_source_folders text[],
  p_create_shortcut boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_active_admin_profile();
  return jsonb_build_object(
    'ok', true,
    'name', p_name,
    'request_ids', coalesce(p_request_ids, array[]::text[]),
    'source_folders', coalesce(p_source_folders, array[]::text[]),
    'create_shortcut', coalesce(p_create_shortcut, false),
    'idempotency_key', p_idempotency_key
  );
end
$function$;

revoke all on function private.require_active_admin_profile() from public, anon, authenticated;
revoke all on function public.create_flyer_folder_batch_v1(text, text[], text[], boolean, text) from public, anon;
grant execute on function public.create_flyer_folder_batch_v1(text, text[], text[], boolean, text) to authenticated;

commit;
