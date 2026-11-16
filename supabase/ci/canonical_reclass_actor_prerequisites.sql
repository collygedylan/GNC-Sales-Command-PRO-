-- Restore the installed predecessor only inside the disposable replay.
begin;
do $fixture$
begin
 if to_regclass('private.ci_schema_workspace_guard') is null then
 raise exception 'CANONICAL_RECLASS_ACTOR_FIXTURE_ONLY'; end if;
 if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
 or to_regprocedure('private.inventory_unrestricted_actor_v23155(public.profiles)') is not null then
 raise exception 'CANONICAL_RECLASS_ACTOR_PRECONDITION_CHANGED'; end if;
end $fixture$;

CREATE OR REPLACE FUNCTION private.inventory_unrestricted_actor_v23155(p_actor public.profiles)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'pg_catalog' AS $function$
 SELECT p_actor.id IS NOT NULL AND p_actor.disabled_at IS NULL AND p_actor.must_change_password IS FALSE
 AND (p_actor.locked_until IS NULL OR p_actor.locked_until <= statement_timestamp())
 AND (private.normalized_profile_role(p_actor.role) IN ('SUPERADMIN','ADMIN','ADMINISTRATOR')
 OR private.normalize_inventory_live_change_username_v2392(p_actor.username) IN ('dylan_collyge','megan_kelly','jd_jones','mitch_kaiser','nelly_aguilar','morgan_anderson')
 OR EXISTS (SELECT 1 FROM public.user_access u WHERE u.profile_id=p_actor.id AND u.edit_any_row='Y'));
$function$;
revoke all on function private.inventory_unrestricted_actor_v23155(public.profiles) from public,anon,authenticated;

do $predecessor$
declare fn record; definition text; changed text; anchor text; patched integer:=0;
begin
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname in ('apply_inventory_reclass_move_v1','apply_inventory_reclass_moves_v1'))
 or (n.nspname='private' and p.proname='apply_inventory_reclass_moves_set_v1') loop
  definition:=pg_get_functiondef(fn.oid);
  anchor:=substring(definition from '  actor_role\s*:=\s*private\.normalized_profile_role\(actor_profile\.role\);');
  if anchor is null then raise exception 'CANONICAL_RECLASS_ACTOR_ANCHOR_MISSING: %',fn.oid::regprocedure; end if;
  changed:=replace(definition,anchor,'  actor_role := CASE WHEN private.inventory_unrestricted_actor_v23155(actor_profile) THEN ''ADMIN'' ELSE private.normalized_profile_role(actor_profile.role) END;');
  execute changed;
  patched:=patched+1;
 end loop;
 if patched<>3 then raise exception 'CANONICAL_RECLASS_ACTOR_FUNCTIONS_MISSING'; end if;
end $predecessor$;
commit;
