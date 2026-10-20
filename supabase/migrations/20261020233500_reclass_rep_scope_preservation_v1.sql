begin;
set local lock_timeout='5s';

-- Restore the narrow service-owned REP scope without replacing the current
-- canonical recipient, publication, revision, or replay implementation.
create or replace function private.sales_rep_operation_scope_v1(p_actor_id uuid)
returns boolean language sql stable set search_path='' as $function$
  select coalesce(auth.role()='service_role'
    and nullif(current_setting('gnc.sales_rep_operation_actor',true),'')=p_actor_id::text,false)
$function$;
revoke all on function private.sales_rep_operation_scope_v1(uuid) from public,anon,authenticated,service_role;

do $legacy_scope$
declare
  target record;
  definition text;
  original text;
  replacement text;
  function_oid oid;
  owner_before oid; acl_before aclitem[]; config_before text[]; security_before boolean;
begin
  for target in select * from (values
    ('public.enqueue_drive_reclass_inquiry_v1(jsonb)',
      'if not is_manager and not is_evaluator then',
      'if not is_manager and not is_evaluator and not private.sales_rep_operation_scope_v1(actor.id) then','actor.id'),
    ('public.enqueue_drive_reclass_inquiry_v6(jsonb)',
      'and actor_role not like ''%EVAL%'' then',
      'and actor_role not like ''%EVAL%'' and not private.sales_rep_operation_scope_v1(actor_profile.id) then','actor_profile.id')
  ) guards(signature,role_original,role_replacement,actor_expression) loop
    function_oid:=target.signature::regprocedure;
    select replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),p.proowner,p.proacl,p.proconfig,p.prosecdef
      into definition,owner_before,acl_before,config_before,security_before
      from pg_proc p where p.oid=function_oid;
    if position(target.role_replacement in definition)=0 then
      if length(definition)-length(replace(definition,target.role_original,''))<>length(target.role_original) then
        raise exception 'RECLASS_REP_ROLE_GUARD_CHANGED:%',target.signature;
      end if;
      definition:=replace(definition,target.role_original,target.role_replacement);
    end if;
    original:='if access_scope is null then';
    replacement:='if access_scope is null and private.sales_rep_operation_scope_v1('||target.actor_expression||') then access_scope:=''global''; end if; if access_scope is null then';
    if position(replacement in definition)=0 then
      if length(definition)-length(replace(definition,original,''))<>length(original) then
        raise exception 'RECLASS_REP_PERMISSION_GUARD_CHANGED:%',target.signature;
      end if;
      definition:=replace(definition,original,replacement);
    end if;
    execute definition;
    if not exists(select 1 from pg_proc p where p.oid=function_oid and p.proowner=owner_before
      and p.proacl is not distinct from acl_before and p.proconfig is not distinct from config_before
      and p.prosecdef=security_before) then raise exception 'RECLASS_REP_LEGACY_SECURITY_CHANGED:%',target.signature; end if;
  end loop;
end
$legacy_scope$;

do $preserve_current_implementation$
declare
  public_oid oid:='public.enqueue_drive_reclass_inquiry_v7(jsonb)'::regprocedure;
  definition text; public_body text; inner_body text;
  source_header constant text:='CREATE OR REPLACE FUNCTION public.enqueue_drive_reclass_inquiry_v7(';
  target_header constant text:='CREATE OR REPLACE FUNCTION private.enqueue_drive_reclass_inquiry_v7_rep_impl(';
  owner_before oid; acl_before aclitem[]; config_before text[]; security_before boolean;
begin
  select pg_get_functiondef(p.oid),p.prosrc,p.proowner,p.proacl,p.proconfig,p.prosecdef
    into definition,public_body,owner_before,acl_before,config_before,security_before
    from pg_proc p where p.oid=public_oid;
  if not security_before or has_function_privilege('authenticated',public_oid,'execute')
    or has_function_privilege('anon',public_oid,'execute')
    or not has_function_privilege('service_role',public_oid,'execute') then
    raise exception 'RECLASS_REP_PUBLIC_SECURITY_PRECONDITION_FAILED';
  end if;
  if position('private.enqueue_drive_reclass_inquiry_v7_rep_impl(p_payload)' in public_body)=0 then
    if position('reclass-dylan-megan-submitter-v1' in public_body)=0
      or position('private.reclass_delivery_recipients_v1(actor_username)' in public_body)=0
      or position('gnc.sales_rep_operation_actor' in public_body)>0
      or left(definition,length(source_header))<>source_header then
      raise exception 'RECLASS_REP_CANONICAL_IMPLEMENTATION_CHANGED';
    end if;
    -- Copy the live definition, including every later LKG/revision repair.
    execute target_header||substr(definition,length(source_header)+1);
  elsif position('gnc.sales_rep_operation_actor' in public_body)=0 then
    raise exception 'RECLASS_REP_WRAPPER_PRECONDITION_FAILED';
  end if;
  select p.prosrc into inner_body from pg_proc p
    where p.oid=to_regprocedure('private.enqueue_drive_reclass_inquiry_v7_rep_impl(jsonb)');
  if inner_body is null or position('reclass-dylan-megan-submitter-v1' in inner_body)=0
    or position('private.reclass_delivery_recipients_v1(actor_username)' in inner_body)=0
    or position('gnc.sales_rep_operation_actor' in inner_body)>0 then
    raise exception 'RECLASS_REP_PRESERVED_IMPLEMENTATION_INVALID';
  end if;

  execute $wrapper$
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
$function$
$wrapper$;
  if not exists(select 1 from pg_proc p where p.oid=public_oid and p.proowner=owner_before
    and p.proacl is not distinct from acl_before and p.proconfig is not distinct from config_before
    and p.prosecdef=security_before) then raise exception 'RECLASS_REP_PUBLIC_SECURITY_CHANGED'; end if;
end
$preserve_current_implementation$;

revoke all on function private.enqueue_drive_reclass_inquiry_v7_rep_impl(jsonb) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
