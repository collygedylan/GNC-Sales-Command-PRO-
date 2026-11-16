begin;
set local lock_timeout='2s';
set local statement_timeout='20s';
do $migration$
declare name text; original text; revised text;
begin
  foreach name in array array['authorize_photo_upload_v3074','authorize_request_photo_intent_v3079'] loop
    select pg_get_functiondef(p.oid) into strict original from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=name;
    revised:=replace(original,'IF NOT private.is_service_role_request() THEN',
      'IF NOT private.is_service_role_request() AND NOT coalesce((auth.uid()=p_actor_id AND p_session_id IS NOT NULL AND p_session_id=nullif(auth.jwt()->>''session_id'','''')::uuid),false) THEN');
    revised:=replace(revised,'IF private.is_service_role_request() IS DISTINCT FROM true THEN',
      'IF private.is_service_role_request() IS DISTINCT FROM true AND NOT coalesce((auth.uid()=p_actor_id AND p_session_id IS NOT NULL AND p_session_id=nullif(auth.jwt()->>''session_id'','''')::uuid),false) THEN');
    if revised=original then raise exception 'Photo authority guard changed: %',name; end if;
    execute revised;
  end loop;
end $migration$;
create function public.prepare_request_photo_upload_v3100(p_identity jsonb,p_photo_id text,p_object_path text)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='8s' set statement_timeout='20s' as $fn$
declare actor public.profiles; session_id uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
  actor:=private.current_evidence_actor_v3074();
  if actor.id is null or actor.id is distinct from auth.uid() or session_id is null then
    raise exception 'REQUEST_PHOTO_SESSION_REQUIRED' using errcode='42501'; end if;
  return public.authorize_request_photo_intent_v3079(actor.id,actor.username,session_id,p_identity,p_photo_id,p_object_path);
end $fn$;
revoke all on function public.prepare_request_photo_upload_v3100(jsonb,text,text) from public,anon,service_role;
grant execute on function public.prepare_request_photo_upload_v3100(jsonb,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
