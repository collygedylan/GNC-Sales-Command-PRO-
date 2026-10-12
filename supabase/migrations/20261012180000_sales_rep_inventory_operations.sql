begin;
set local lock_timeout='5s';

-- Reads include every lot and season. Writes continue through the audited,
-- revision-checked API; a browser cannot update quantities or import state.
grant select on public.ph_master_inventory to authenticated;
drop policy if exists sales_rep_inventory_read_v1 on public.ph_master_inventory;
create policy sales_rep_inventory_read_v1 on public.ph_master_inventory
for select to authenticated using (exists (
  select 1 from public.profiles p where p.id=auth.uid()
    and upper(btrim(p.role, E' \t\n\r')) in ('REP','SALESREP','SALES')
    and p.disabled_at is null and not p.must_change_password
    and (p.locked_until is null or p.locked_until<=now())
));

-- Only the service-only V7 entry point can open this transaction-local scope.
create or replace function private.sales_rep_operation_scope_v1(p_actor_id uuid)
returns boolean language sql stable set search_path='' as $function$
  select coalesce(auth.role()='service_role'
    and nullif(current_setting('gnc.sales_rep_operation_actor',true),'')=p_actor_id::text,false)
$function$;
revoke all on function private.sales_rep_operation_scope_v1(uuid) from public,anon,authenticated,service_role;

do $repair$
declare definition text; original text; replacement text;
begin
  definition:=replace(pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v1(jsonb)'::regprocedure),E'\r\n',E'\n');
  if position('sales_rep_operation_scope_v1' in definition)=0 then
    original:='if not is_manager and not is_evaluator then';
    replacement:='if not is_manager and not is_evaluator and not private.sales_rep_operation_scope_v1(actor.id) then';
    if position(original in definition)=0 then raise exception 'SALES_REP_V1_ROLE_GUARD_CHANGED'; end if;
    definition:=replace(definition,original,replacement);
    original:='if access_scope is null then';
    replacement:='if access_scope is null and private.sales_rep_operation_scope_v1(actor.id) then access_scope:=''global''; end if; if access_scope is null then';
    if position(original in definition)=0 then raise exception 'SALES_REP_V1_PERMISSION_GUARD_CHANGED'; end if;
    execute replace(definition,original,replacement);
  end if;
  definition:=replace(pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v6(jsonb)'::regprocedure),E'\r\n',E'\n');
  if position('sales_rep_operation_scope_v1' in definition)=0 then
    original:='and actor_role not like ''%EVAL%'' then';
    replacement:='and actor_role not like ''%EVAL%'' and not private.sales_rep_operation_scope_v1(actor_profile.id) then';
    if position(original in definition)=0 then raise exception 'SALES_REP_V6_ROLE_GUARD_CHANGED'; end if;
    definition:=replace(definition,original,replacement);
    original:='if access_scope is null then';
    replacement:='if access_scope is null and private.sales_rep_operation_scope_v1(actor_profile.id) then access_scope:=''global''; end if; if access_scope is null then';
    if position(original in definition)=0 then raise exception 'SALES_REP_V6_PERMISSION_GUARD_CHANGED'; end if;
    execute replace(definition,original,replacement);
  end if;
  if to_regprocedure('private.enqueue_drive_reclass_inquiry_v7_rep_impl(jsonb)') is null then
    alter function public.enqueue_drive_reclass_inquiry_v7(jsonb) rename to enqueue_drive_reclass_inquiry_v7_rep_impl;
    alter function public.enqueue_drive_reclass_inquiry_v7_rep_impl(jsonb) set schema private;
  end if;
end
$repair$;
revoke all on function private.enqueue_drive_reclass_inquiry_v7_rep_impl(jsonb) from public,anon,authenticated,service_role;

create or replace function public.enqueue_drive_reclass_inquiry_v7(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare actor public.profiles; actor_count integer; projected jsonb; result jsonb;
  previous_scope text:=coalesce(current_setting('gnc.sales_rep_operation_actor',true),'');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',message='DRIVE_RECLASS_FORBIDDEN';
  end if;
  select count(*) into actor_count from public.profiles p
    where lower(btrim(p.username))=lower(btrim(coalesce(p_payload->>'actorUsername','')));
  select p.* into actor from public.profiles p
    where lower(btrim(p.username))=lower(btrim(coalesce(p_payload->>'actorUsername','')));
  if actor_count<>1 or actor.disabled_at is not null or actor.must_change_password
    or actor.locked_until>now() then
    raise exception using errcode='42501',message='DRIVE_RECLASS_PROFILE_NOT_ACTIVE';
  end if;
  if upper(btrim(actor.role,E' \t\n\r')) in ('REP','SALESREP','SALES') then
    if not private.navigation_module_allowed_v1(actor.id,'drive') or exists (
      select 1 from private.app_access_user_overrides o
      where o.policy_id=private.resolve_app_access_policy_id_v1(false) and o.profile_id=actor.id
        and o.permission_key='drive.reclass.submit' and not o.allowed
    ) then
      raise exception using errcode='42501',message='DRIVE_RECLASS_FORBIDDEN';
    end if;
    projected:=private.project_reclass_editable_fields_v7(p_payload);
    if coalesce(projected#>>'{sourceContext,sourceMode}','drive')<>'drive'
      or jsonb_array_length(projected#>'{transaction,requestActions}')=0
      or exists(select 1 from jsonb_array_elements_text(projected#>'{transaction,requestActions}') a(value)
        where value not in ('priority_change','hold','take_off_hold','stop_ship','off_stop_ship'))
      or exists(select 1 from jsonb_array_elements(projected->'rowOverlays') r(value)
        where jsonb_array_length(coalesce(value->'fieldEdits','[]'::jsonb))>0)
    then raise exception using errcode='42501',message='SALES_REP_OPERATION_FORBIDDEN'; end if;
    perform set_config('gnc.sales_rep_operation_actor',actor.id::text,true);
  else
    perform set_config('gnc.sales_rep_operation_actor','',true);
  end if;
  result:=private.enqueue_drive_reclass_inquiry_v7_rep_impl(p_payload);
  perform set_config('gnc.sales_rep_operation_actor',previous_scope,true);
  return result;
exception when others then
  perform set_config('gnc.sales_rep_operation_actor',previous_scope,true);
  raise;
end
$function$;
revoke all on function public.enqueue_drive_reclass_inquiry_v7(jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_drive_reclass_inquiry_v7(jsonb) to service_role;

-- Invoker import triggers call this pure reducer. Browser writes stay denied.
grant execute on function private.ph_holdstop_strict_reduction_v1(text,text) to service_role;
commit;
