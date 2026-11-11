set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function private.reclass_actor_matrix_v3076(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path='' as $fn$
  select coalesce(to_jsonb(u),'{}'::jsonb)||jsonb_build_object(
    'role',coalesce(nullif(btrim(u.role),''),a.role),'username',p.username,
    'is_super_admin',lower(coalesce(to_jsonb(u)->>'is_super_admin','false'))='true'
      or lower(coalesce(to_jsonb(a)->>'is_super_admin','false'))='true')
  from public.profiles p left join public.user_access u on u.profile_id=p.id
  left join public.ph_app_users a on (a.id=p.legacy_user_id or p.legacy_user_id is null)
    and lower(btrim(a.username))=lower(btrim(p.username))
  where p.id=p_actor_id and p.disabled_at is null and p.must_change_password is false
    and (p.locked_until is null or p.locked_until<=statement_timestamp())
    and (u.profile_id is null or lower(btrim(u.username))=lower(btrim(p.username)))
    and (p.legacy_user_id is null or a.id is not null)
    and (a.id is null or (a.disabled_at is null and a.must_change_password is false
      and (a.locked_until is null or a.locked_until<=statement_timestamp())))
$fn$;
revoke all on function private.reclass_actor_matrix_v3076(uuid) from public,anon,authenticated;
create or replace function private.is_reclass_administrator_v3076(p_actor_id uuid)
returns boolean language sql stable security definer set search_path='' as $fn$
 select coalesce(lower(btrim(matrix->>'role')) in ('admin','superadmin','super-admin','super_admin','super admin')
   or (matrix->>'is_super_admin')::boolean,false) from (select private.reclass_actor_matrix_v3076(p_actor_id) matrix) actor
$fn$;
revoke all on function private.is_reclass_administrator_v3076(uuid) from public,anon,authenticated;
create or replace function private.reclass_actor_role_v3076(p_actor_id uuid)
returns text language sql stable security definer set search_path='' as $fn$
 select case when private.is_reclass_administrator_v3076(p_actor_id) then 'ADMIN'
   else private.normalized_profile_role(private.reclass_actor_matrix_v3076(p_actor_id)->>'role') end
$fn$;
revoke all on function private.reclass_actor_role_v3076(uuid) from public,anon,authenticated;

create or replace function private.require_reclass_explanations_v303(p_actor_id uuid,p_map jsonb,p_uids text[])
returns void language plpgsql security definer set search_path='' as $fn$
declare actor public.profiles%rowtype; uid text; exempt boolean;
begin
 select * into actor from public.profiles where id=p_actor_id and disabled_at is null
   and not must_change_password and (locked_until is null or locked_until<=now());
 if actor.id is null then raise exception using errcode='42501',message='DRIVE_RECLASS_PROFILE_NOT_ACTIVE'; end if;
 if jsonb_typeof(p_map) is distinct from 'object' or exists(select 1 from jsonb_each(p_map) e
   where jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>4000) then
   raise exception using errcode='22023',message='DRIVE_RECLASS_EXPLANATION_INVALID';
 end if;
 exempt:=private.is_reclass_administrator_v3076(p_actor_id);
 foreach uid in array coalesce(p_uids,array[]::text[]) loop
   if not exempt and nullif(btrim(p_map->>uid),'') is null then
     raise exception using errcode='22023',message='DRIVE_RECLASS_EXPLANATION_REQUIRED';
   end if;
 end loop;
 perform set_config('gnc.reclass_explanations',p_map::text,true);
end $fn$;
revoke all on function private.require_reclass_explanations_v303(uuid,jsonb,text[]) from public,anon,authenticated;

create or replace function private.reclass_source_lot_v3076(p_lot text,p_season text,p_salesyear text,p_actor_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare suffix text; stem text;
begin
 if p_lot ~ '^.+[.](F1|S1|U1|U2|U3|X|Y|Z)$' then
   suffix:=upper(substring(p_lot from '[.]([^.]+)$'));
   stem:=regexp_replace(p_lot,'[.][^.]+$','');
 elsif p_lot='Y' and upper(btrim(p_season))='Y' and btrim(p_salesyear) ~ '^(20)?[0-9]{2}$'
   and private.is_reclass_administrator_v3076(p_actor_id) then
   suffix:='Y'; stem:=right(btrim(p_salesyear),2);
 else raise exception using errcode='22023',message='INVENTORY_RECLASS_LOT_INVALID';
 end if;
 if suffix is distinct from upper(btrim(coalesce(nullif(p_season,''),suffix))) then
   raise exception using errcode='22023',message='INVENTORY_RECLASS_LOT_SEASON_AMBIGUOUS';
 end if;
 return jsonb_build_object('season',suffix,'stem',stem);
end $fn$;
revoke all on function private.reclass_source_lot_v3076(text,text,text,uuid) from public,anon,authenticated;

create or replace function private.reclass_y_move_uids_v3076(p_command jsonb)
returns text[] language plpgsql immutable set search_path='' as $fn$
declare ids text[];
begin
 if p_command-array['action','commandId','moves']<>'{}'::jsonb
   or jsonb_typeof(p_command->'moves') is distinct from 'array'
   or jsonb_array_length(p_command->'moves') not between 1 and 100 then return null; end if;
 if exists(select 1 from jsonb_array_elements(p_command->'moves') m where
   jsonb_typeof(m) is distinct from 'object' or m-array['source','lines']<>'{}'::jsonb
   or jsonb_typeof(m->'source') is distinct from 'object'
   or jsonb_typeof(m->'lines') is distinct from 'array' or jsonb_array_length(m->'lines')=0
   or nullif(m#>>'{source,uniqueId}','') is null) then return null; end if;
 select array_agg(m#>>'{source,uniqueId}') into ids from jsonb_array_elements(p_command->'moves') m;
 return ids;
end $fn$;
revoke all on function private.reclass_y_move_uids_v3076(jsonb) from public,anon,authenticated;

create or replace function private.reclass_y_inquiry_uids_v3076(p_command jsonb)
returns text[] language plpgsql immutable set search_path='' as $fn$
declare projected jsonb; ids text[];
begin
 projected:=case when p_command->>'workflowPolicyVersion'='reclass-action-workflow-v7-editable-fields-20261009'
   then private.project_reclass_editable_fields_v7(p_command) else p_command end;
 select array_agg(distinct uid) into ids from (
   select r->>'unique_id' uid from jsonb_array_elements(coalesce(projected->'rowOverlays','[]'::jsonb)) r
   where (jsonb_array_length(coalesce(r->'proposals','[]'::jsonb))>0
       or jsonb_array_length(coalesce(r->'fieldEdits','[]'::jsonb))>0
       or r->>'resolution'='done' or r#>>'{action,included}'='true')
   union all select r->>'sourceUid' from jsonb_array_elements(coalesce(projected#>'{transaction,holdStopProposals}','[]'::jsonb)) r
 ) targets;
 return coalesce(ids,array[projected#>>'{source,unique_id}']);
end $fn$;
revoke all on function private.reclass_y_inquiry_uids_v3076(jsonb) from public,anon,authenticated;

create or replace function private.reclass_y_move_receipt_v3076(p_actor_id uuid,p_command_id text)
returns boolean language plpgsql stable security definer set search_path='' as $fn$
declare receipt private.ph_inventory_reclass_batch_receipts_v1; ids text[];
begin
 select * into receipt from private.ph_inventory_reclass_batch_receipts_v1 b
   where b.actor_id=p_actor_id and b.command_id=p_command_id;
 if not found then return true; end if;
 if receipt.result is null or receipt.result='{}'::jsonb then
   select array_agg(m#>>'{source,uniqueId}') into ids
     from jsonb_array_elements(coalesce(receipt.request->'moves','[]'::jsonb)) m;
   if coalesce(cardinality(ids),0)=0 then return true; end if;
   return cardinality(ids)=(select count(*) from public.ph_master_inventory m
     where m.unique_id=any(ids) and upper(btrim(m.season))='Y');
 end if;
 return receipt.result->>'status'='applied' and cardinality(receipt.child_request_ids)>0
   and not exists(select 1 from unnest(receipt.child_request_ids) child
     where not exists(select 1 from private.ph_inventory_reclass_movements_v1 m
       where m.request_id=child and upper(btrim(m.source_before->>'season'))='Y'))
   and not exists(select 1 from private.ph_inventory_reclass_movements_v1 m
     where m.request_id=any(receipt.child_request_ids) and upper(btrim(m.source_before->>'season')) is distinct from 'Y');
end
$fn$;
revoke all on function private.reclass_y_move_receipt_v3076(uuid,text) from public,anon,authenticated;

create or replace function private.reclass_module_allowed_v3076(p_actor_id uuid,p_command jsonb)
returns boolean language sql stable security definer set search_path='' as $fn$
 select case when p_command->>'action'='inventory_reclass_move' then exists(
   select 1 from unnest(array['can_access_drive_mode','can_access_av','can_access_que','can_access_manager_tab','can_access_eval_reports_2']) flag
   where private.user_access_has_permission_v1(p_actor_id,flag))
 else coalesce(private.user_access_has_permission_v1(p_actor_id,case p_command#>>'{sourceContext,sourceMode}'
   when 'eval-report-2' then 'can_access_eval_reports_2' when 'item-inquiry' then 'can_access_manager_tab'
   else 'can_access_drive_mode' end),false) end
$fn$;
revoke all on function private.reclass_module_allowed_v3076(uuid,jsonb) from public,anon,authenticated;

create or replace function public.can_reclass_y_administrator_v3076(p_actor_id uuid,p_command jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $fn$
declare ids text[]; actor_username text;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='INVENTORY_RECLASS_FORBIDDEN'; end if;
 if jsonb_typeof(p_command) is distinct from 'object' or not private.is_reclass_administrator_v3076(p_actor_id) then return false; end if;
 if coalesce(p_command->>'action','') not in ('inventory_reclass_move','drive_reclass_inquiry') then return false; end if;
 if not private.reclass_module_allowed_v3076(p_actor_id,p_command) then return false; end if;
 if p_command->>'action'='inventory_reclass_move' then
   if p_command->>'operation'='status' then
     if p_command-array['action','operation','commandId']<>'{}'::jsonb then return false; end if;
     return coalesce(private.reclass_y_move_receipt_v3076(p_actor_id,p_command->>'commandId'),false);
   end if;
   ids:=private.reclass_y_move_uids_v3076(p_command);
 else
   if coalesce(p_command->>'operation','create')<>'create' then return false; end if;
   select username into actor_username from public.profiles where id=p_actor_id;
   ids:=private.reclass_y_inquiry_uids_v3076(p_command||jsonb_build_object('actorUsername',actor_username));
 end if;
 if coalesce(cardinality(ids),0)=0 or cardinality(ids)<>(select count(distinct uid) from unnest(ids) uid)
   or exists(select 1 from unnest(ids) uid where nullif(uid,'') is null) then return false; end if;
 return cardinality(ids)=(select count(*) from public.ph_master_inventory m where m.unique_id=any(ids)
   and upper(btrim(m.season))='Y' and (m.lotcode='Y' or m.lotcode ~ '^.+[.]Y$'));
end $fn$;
revoke all on function public.can_reclass_y_administrator_v3076(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.can_reclass_y_administrator_v3076(uuid,jsonb) to service_role;

create or replace function private.reclass_rows_allowed_v3076(p_actor_id uuid,p_ids text[])
returns boolean language plpgsql stable security definer set search_path='' as $fn$
declare matrix jsonb:=private.reclass_actor_matrix_v3076(p_actor_id);
begin
 if matrix is null then return false; end if;
 if matrix->>'edit_any_row'='Y' then return true; end if;
 if matrix->>'edit_assigned_rows_only'='Y' and not exists(select 1 from public.ph_master_inventory m
   where m.unique_id=any(p_ids) and not private.inventory_row_assigned_to_actor_v2392(matrix->>'username',m.unique_id,m.itemcode)) then return true; end if;
 if matrix->>'flyer_folder_access'='Y' and not exists(select 1 from unnest(p_ids) uid
   where not exists(select 1 from public.ph_flyer_folder_rows f where f.master_unique_id=uid)) then return true; end if;
 return false;
end $fn$;
revoke all on function private.reclass_rows_allowed_v3076(uuid,text[]) from public,anon,authenticated;

create or replace function private.reclass_physical_standard_allowed_v3076(p_actor_id uuid,p_ids text[])
returns boolean language plpgsql stable security definer set search_path='' as $fn$
declare matrix jsonb:=private.reclass_actor_matrix_v3076(p_actor_id); role_key text:=private.reclass_actor_role_v3076(p_actor_id);
begin
 if matrix->>'edit_any_row'='Y' then return true; end if;
 if role_key not in ('ADMIN','ADMINISTRATOR','MANAGER','EVAL','EVALUATOR') and role_key not like '%EVAL%' then return false; end if;
 if role_key in ('EVAL','EVALUATOR') or role_key like '%EVAL%' then
   return not exists(select 1 from public.ph_master_inventory m where m.unique_id=any(p_ids)
     and not private.inventory_row_assigned_to_actor_v2392(matrix->>'username',m.unique_id,m.itemcode));
 end if;
 return true;
end $fn$;
revoke all on function private.reclass_physical_standard_allowed_v3076(uuid,text[]) from public,anon,authenticated;

create or replace function public.authorize_reclass_command_v3076(p_actor_id uuid,p_command jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $fn$
declare ids text[]; standard boolean;
begin
 if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='INVENTORY_RECLASS_FORBIDDEN'; end if;
 if jsonb_typeof(p_command) is distinct from 'object' then return false; end if;
 if not private.reclass_module_allowed_v3076(p_actor_id,p_command) then return false; end if;
 standard:=coalesce(private.user_access_has_permission_v1(p_actor_id,'can_submit_reclass'),false);
 if p_command->>'action'='inventory_reclass_move' and p_command->>'operation'='status' then
   return standard or public.can_reclass_y_administrator_v3076(p_actor_id,p_command);
 end if;
 if p_command->>'action'='inventory_reclass_move' then ids:=private.reclass_y_move_uids_v3076(p_command);
 elsif p_command->>'action'='drive_reclass_inquiry' and coalesce(p_command->>'operation','create')='create' then
   ids:=private.reclass_y_inquiry_uids_v3076(p_command);
 else return false;
 end if;
 if coalesce(cardinality(ids),0)=0 or cardinality(ids)<>(select count(distinct uid) from unnest(ids) uid)
   or cardinality(ids)<>(select count(*) from public.ph_master_inventory m where m.unique_id=any(ids)) then return false; end if;
 if public.can_reclass_y_administrator_v3076(p_actor_id,p_command) then return true; end if;
 return coalesce(standard and private.reclass_rows_allowed_v3076(p_actor_id,ids)
   and (p_command->>'action'<>'inventory_reclass_move' or private.reclass_physical_standard_allowed_v3076(p_actor_id,ids)),false);
end $fn$;
revoke all on function public.authorize_reclass_command_v3076(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.authorize_reclass_command_v3076(uuid,jsonb) to service_role;

create or replace function private.reclass_parent_scope_v3076(p_actor_id uuid,p_command jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $fn$
declare scope jsonb:=nullif(current_setting('gnc.reclass_parent_scope_v3076',true),'')::jsonb; ids text[];
begin
 if scope is null or scope->>'actor' is distinct from p_actor_id::text
   or p_command->>'action' is distinct from 'drive_reclass_inquiry'
   or scope->>'token' is distinct from btrim(coalesce(p_command->>'idempotencyToken',p_command->>'idempotency_token',''))
   or scope->>'sourceUid' is distinct from p_command#>>'{source,unique_id}' then return false; end if;
 ids:=private.reclass_y_inquiry_uids_v3076(p_command);
 if coalesce(cardinality(ids),0)=0 then return false; end if;
 if not exists(select 1 from unnest(ids) uid where not (scope->'ids' ? uid)) then return true; end if;
 return ids=array[scope->>'sourceUid'] and jsonb_array_length(coalesce(p_command#>'{transaction,requestActions}','[]'::jsonb))=0
   and jsonb_array_length(coalesce(p_command#>'{transaction,holdStopProposals}','[]'::jsonb))=0
   and not exists(select 1 from jsonb_array_elements(coalesce(p_command->'rowOverlays','[]'::jsonb)) r
     where jsonb_array_length(coalesce(r->'proposals','[]'::jsonb))>0 or jsonb_array_length(coalesce(r->'fieldEdits','[]'::jsonb))>0
       or r->>'resolution'='done' or r#>>'{action,included}'='true');
end $fn$;
revoke all on function private.reclass_parent_scope_v3076(uuid,jsonb) from public,anon,authenticated;

create or replace function private.run_scoped_reclass_inquiry_v3076(p_actor_id uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare previous text:=coalesce(current_setting('gnc.reclass_parent_scope_v3076',true),''); result jsonb;
begin
 if public.authorize_reclass_command_v3076(p_actor_id,p_command||jsonb_build_object('action','drive_reclass_inquiry')) is distinct from true then
   raise exception using errcode='42501',message='DRIVE_RECLASS_FORBIDDEN'; end if;
 perform set_config('gnc.reclass_parent_scope_v3076',jsonb_build_object('actor',p_actor_id,
   'token',btrim(coalesce(p_command->>'idempotencyToken',p_command->>'idempotency_token','')),
   'sourceUid',p_command#>>'{source,unique_id}','ids',to_jsonb(private.reclass_y_inquiry_uids_v3076(p_command)))::text,true);
 result:=private.enqueue_drive_reclass_inquiry_v7_rep_impl(p_command);
 perform set_config('gnc.reclass_parent_scope_v3076',previous,true);
 return result;
exception when others then
 perform set_config('gnc.reclass_parent_scope_v3076',previous,true);
 raise;
end $fn$;
revoke all on function private.run_scoped_reclass_inquiry_v3076(uuid,jsonb) from public,anon,authenticated;

create or replace function private.require_reclass_capability_v3076(p_actor_id uuid,p_command jsonb)
returns void language plpgsql stable security definer set search_path='' as $fn$
begin
 if public.authorize_reclass_command_v3076(p_actor_id,p_command) is distinct from true
   and private.reclass_parent_scope_v3076(p_actor_id,p_command) is distinct from true then
   raise exception using errcode='42501',message='DRIVE_RECLASS_FORBIDDEN';
 end if;
end $fn$;
revoke all on function private.require_reclass_capability_v3076(uuid,jsonb) from public,anon,authenticated;

do $patch$
declare definition text; changed text; fn record;
begin
 select pg_get_functiondef('public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb)'::regprocedure) into definition;
 changed:=regexp_replace(definition,
   '  source_season := upper\(btrim\(coalesce\(nullif\(source_row.season,''''\),.*?  source_stem := regexp_replace\(source_row.lotcode,''\[\.\]\[\^\.\]\+\$'',''''\);',
   '  source_season := private.reclass_source_lot_v3076(source_row.lotcode,source_row.season,source_row.saleyear,p_actor_id)->>''season'';'||E'\n'||
   '  source_stem := private.reclass_source_lot_v3076(source_row.lotcode,source_row.season,source_row.saleyear,p_actor_id)->>''stem'';', 's');
 if changed=definition then raise exception 'RECLASS_Y_SINGLE_LOT_ANCHOR_MISSING'; end if;
 changed:=replace(changed,E'  source_suffix text;\n','');
 execute changed;
 select pg_get_functiondef('private.apply_inventory_reclass_moves_set_v1(uuid,text,bigint,jsonb,uuid)'::regprocedure) into definition;
 changed:=replace(definition,
   '    regexp_replace(b.lotcode::text,''[.][^.]+$'',''''),private.reclass_numeric_v1(b.ptronhand::text),',
   '    private.reclass_source_lot_v3076(b.lotcode::text,b.season::text,b.saleyear::text,p_actor_id)->>''stem'',private.reclass_numeric_v1(b.ptronhand::text),');
 changed:=regexp_replace(changed,
   '  if exists\(select 1 from pg_temp.reclass_batch_sources_v1 s join pg_temp.reclass_batch_source_before_v1 b using\(source_index\)'||E'\n'||
   '    where b.lotcode::text !~.*?INVENTORY_RECLASS_LOT_SEASON_AMBIGUOUS'';\n  end if;\n', '', 's');
 if changed=definition or position('where b.lotcode::text !~' in changed)>0 then raise exception 'RECLASS_Y_BATCH_LOT_ANCHOR_MISSING'; end if;
 execute changed;
 for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where (n.nspname='public' and p.proname in ('apply_inventory_reclass_move_v1','apply_inventory_reclass_moves_v1'))
     or (n.nspname='private' and p.proname='apply_inventory_reclass_moves_set_v1') loop
   definition:=pg_get_functiondef(fn.oid);
   changed:=replace(definition,'  actor_role := CASE WHEN private.inventory_unrestricted_actor_v23155(actor_profile) THEN ''ADMIN'' ELSE private.normalized_profile_role(actor_profile.role) END;',
     '  perform private.require_reclass_capability_v3076(p_actor_id,jsonb_build_object(''action'',''inventory_reclass_move'',''commandId'',p_command_id,''moves'','||
     case when fn.proname='apply_inventory_reclass_move_v1' then
       'jsonb_build_array(jsonb_build_object(''source'',jsonb_build_object(''uniqueId'',p_source_uid,''identity'',p_source_identity),''lines'',p_lines))'
       else 'p_moves' end||'));');
   changed:=regexp_replace(changed,'  if actor_role not in .*?end if;\n','','s');
   changed:=regexp_replace(changed,'  select e.access_scope into permission_scope.*?end if;\n','','s');
   changed:=regexp_replace(changed,'  if not is_manager and exists\(.*?end if;\n','','s');
   changed:=regexp_replace(changed,'  if not is_manager then\n.*?\n  end if;\n','','s');
   changed:=replace(changed,E'  is_manager := actor_role in (''ADMIN'',''ADMINISTRATOR'',''MANAGER'');\n','');
   changed:=replace(changed,E'  is_manager:=actor_role in (''ADMIN'',''ADMINISTRATOR'',''MANAGER'');\n','');
   changed:=regexp_replace(changed,'  (actor_role text|permission_scope text|is_manager boolean|assigned_to_actor boolean)( := false)?;\n','','g');
   if changed=definition or position('inventory_unrestricted_actor_v23155' in changed)>0
     or position('return ' in lower(changed))=0 then raise exception 'RECLASS_TABLE_ACTOR_ANCHOR_MISSING: %',fn.oid::regprocedure; end if;
   execute changed;
 end loop;
 for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname ~ '^enqueue_drive_reclass_inquiry_v[0-9]+$' loop
   definition:=pg_get_functiondef(fn.oid);
   changed:=replace(definition,'  perform private.require_reclass_explanations_v303(',
     '  perform private.require_reclass_capability_v3076((select id from public.profiles where lower(btrim(username))=lower(btrim(p_payload->>''actorUsername''))),'||
     'p_payload||jsonb_build_object(''action'',''drive_reclass_inquiry''));'||E'\n'||'  perform private.require_reclass_explanations_v303(');
   if changed=definition then raise exception 'RECLASS_Y_INQUIRY_CAPABILITY_ANCHOR_MISSING: %',fn.oid::regprocedure; end if;
   changed:=replace(changed,'actor_role := private.normalized_profile_role(actor.role);','actor_role := private.reclass_actor_role_v3076(actor.id);');
   changed:=replace(changed,'actor_role := private.normalized_profile_role(actor_profile.role);','actor_role := private.reclass_actor_role_v3076(actor_profile.id);');
   changed:=regexp_replace(changed,'  select e.access_scope into access_scope\n.*?limit 1;\n','','s');
   changed:=replace(changed,'if access_scope is null and private.sales_rep_operation_scope_v1(actor.id) then access_scope:=''global''; end if; ','');
   changed:=replace(changed,'if access_scope is null and private.sales_rep_operation_scope_v1(actor_profile.id) then access_scope:=''global''; end if; ','');
   changed:=regexp_replace(changed,'if access_scope is null then\n.*?end if;','','s');
   changed:=replace(changed,E'  access_scope text;\n','');
   changed:=regexp_replace(changed,'if upper\(btrim\(actor.role,.*?\)\) in \(''REP'',''SALESREP'',''SALES''\) then',
     'if upper(btrim(private.reclass_actor_matrix_v3076(actor.id)->>''role'')) in (''REP'',''SALESREP'',''SALES'') then','s');
   changed:=replace(changed,'result:=private.enqueue_drive_reclass_inquiry_v7_rep_impl(p_payload);',
     'result:=private.run_scoped_reclass_inquiry_v3076(actor.id,p_payload);');
   execute changed;
 end loop;
 select pg_get_functiondef('public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)'::regprocedure) into definition;
 changed:=replace(definition,'  perform private.require_reclass_explanations_v303(',
   '  perform private.require_reclass_capability_v3076(p_actor_id,jsonb_build_object(''action'',''inventory_reclass_move'',''commandId'',p_command_id,'||
   '''moves'',(select jsonb_agg(value-''reclass_explanation'') from jsonb_array_elements(p_moves))));'||E'\n'||'  perform private.require_reclass_explanations_v303(');
 if changed=definition then raise exception 'RECLASS_Y_DELIVERY_CAPABILITY_ANCHOR_MISSING'; end if;
 changed:=replace(changed,'private.normalized_profile_role(actor_profile.role) not in (''ADMIN'',''ADMINISTRATOR'')',
   'not private.is_reclass_administrator_v3076(p_actor_id)');
 execute changed;
 select pg_get_functiondef('public.get_inventory_reclass_move_status_v1(uuid,text)'::regprocedure) into definition;
 changed:=replace(definition,'actor_role:=private.normalized_profile_role(actor_profile.role);',
   'perform private.require_reclass_capability_v3076(p_actor_id,jsonb_build_object(''action'',''inventory_reclass_move'',''operation'',''status'',''commandId'',p_command_id));');
 changed:=regexp_replace(changed,'  if actor_role not in .*?end if;\n','','s');
 changed:=regexp_replace(changed,'  select e.access_scope into permission_scope.*?end if;\n','','s');
 changed:=replace(changed,' actor_role text; permission_scope text;','');
 changed:=replace(changed,'  select case when bool_or(m.status=',
   '  if batch_row.result is null or batch_row.result=''{}''::jsonb then return jsonb_build_object(''ok'',true,''commandId'',p_command_id,''status'',''pending'',''requestId'',batch_row.request_id,''movements'',''[]''::jsonb); end if;'||E'\n'||'  select case when bool_or(m.status=');
 if changed=definition or position('if permission_scope is null then' in changed)>0 then raise exception 'RECLASS_Y_STATUS_ANCHOR_MISSING'; end if;
 execute changed;
end $patch$;
