begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('app_version','2.3.78','release','AgData v2.3.78'),'release-v2.3.78',now())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

-- Restore the explicitly requested operational read paths while granting no
-- anonymous or authenticated mutation privilege.
grant select on public.ph_soc_master, public.ph_active_suspend,
  public.ph_requests_pending, public.ph_active_request,
  public.ph_requests_completed_history, public.ph_master_inventory,
  public.ph_reserves, public.ph_cav_import, public.ph_suspend_history,
  public.ph_productivity_history
  to anon, authenticated, service_role;

-- The two public queue views intentionally use their owner's read capability;
-- the underlying mutation grants and RPC authorization remain unchanged.
alter view public.ph_active_suspend set (security_invoker = false);
alter view public.ph_active_request set (security_invoker = false);

-- Remove only the named read gates from the operational relations. Existing
-- mutation policies are not touched. Add explicit read policies for the
-- requested operational relations so SELECT does not depend on a legacy policy.
do $read_policies$
declare
  relation_name text;
  policy_row record;
  policy_roles text;
  policy_suffix text;
begin
  for policy_row in
    select schemaname, tablename, policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname='public'
      and tablename=any(array['ph_soc_master','ph_active_suspend','ph_requests_pending',
        'ph_active_request','ph_requests_completed_history','ph_master_inventory',
        'ph_reserves','ph_cav_import','ph_suspend_history','ph_productivity_history'])
      and policyname=any(array['scheduled_handover_active_session','suspend_tag_read',
        'ph_active_request_rep_isolation','canonical_user_access_inventory_read_v1'])
      and permissive='RESTRICTIVE'
  loop
    if policy_row.cmd='ALL' then
      select string_agg(quote_ident(role_name::text),', ' order by role_name::text) into policy_roles
        from unnest(policy_row.roles) as original(role_name);
      policy_suffix:=substr(md5(policy_row.policyname),1,8);
      execute format('drop policy if exists %I on %I.%I',policy_row.policyname,policy_row.schemaname,policy_row.tablename);
      execute format('create policy %I on %I.%I as restrictive for insert to %s with check (%s)',
        left(policy_row.policyname,38)||'_'||policy_suffix||'_v2378_i',policy_row.schemaname,policy_row.tablename,
        policy_roles,coalesce(policy_row.with_check,policy_row.qual,'true'));
      execute format('create policy %I on %I.%I as restrictive for update to %s using (%s) with check (%s)',
        left(policy_row.policyname,38)||'_'||policy_suffix||'_v2378_u',policy_row.schemaname,policy_row.tablename,
        policy_roles,coalesce(policy_row.qual,'true'),coalesce(policy_row.with_check,policy_row.qual,'true'));
      execute format('create policy %I on %I.%I as restrictive for delete to %s using (%s)',
        left(policy_row.policyname,38)||'_'||policy_suffix||'_v2378_d',policy_row.schemaname,policy_row.tablename,
        policy_roles,coalesce(policy_row.qual,'true'));
    else
    execute format('drop policy if exists %I on %I.%I',policy_row.policyname,policy_row.schemaname,policy_row.tablename);
    end if;
  end loop;
  foreach relation_name in array array['ph_soc_master','ph_requests_pending',
    'ph_requests_completed_history','ph_master_inventory','ph_reserves','ph_cav_import','ph_suspend_history']
  loop
    if relation_name<>'ph_suspend_history' then
      execute format('alter table public.%I enable row level security',relation_name);
      execute format('drop policy if exists agdata_v2378_operational_select on public.%I',relation_name);
      execute format('create policy agdata_v2378_operational_select on public.%I for select to anon, authenticated using (true)',relation_name);
    end if;
  end loop;
  execute 'alter table public.ph_productivity_history enable row level security';
  execute 'drop policy if exists agdata_v2378_suspend_history_select on public.ph_productivity_history';
  execute $policy$create policy agdata_v2378_suspend_history_select on public.ph_productivity_history
    for select to anon, authenticated
    using (lower(coalesce(source_kind,'')) like '%suspend%' or lower(coalesce(source_table,'')) like '%suspend%')$policy$;
end
$read_policies$;

-- Keep completed orphan request rows under their own exact physical UID.
-- The history uniqueness key makes retries safe; no name/item-code matching is
-- used to infer that a distinct UID is the same request.
do $archive_completed$
declare
  common_columns text;
  typed_columns text;
begin
  select string_agg(format('%I',history_column.column_name),',' order by history_column.ordinal_position),
    string_agg(format('typed.%I',history_column.column_name),',' order by history_column.ordinal_position)
    into common_columns,typed_columns
  from information_schema.columns history_column
  join information_schema.columns pending_column
    on pending_column.table_schema='public' and pending_column.table_name='ph_requests_pending'
    and pending_column.column_name=history_column.column_name
  where history_column.table_schema='public' and history_column.table_name='ph_requests_completed_history'
    and history_column.is_generated='NEVER' and history_column.is_identity='NO'
    and history_column.column_name<>'id';
  if common_columns is null or position('unique_id' in common_columns)=0 then
    raise exception 'AGDATA_V2378_REQUEST_HISTORY_COLUMNS_MISSING';
  end if;
  execute format('insert into public.ph_requests_completed_history (%1$s) select %2$s from (
    select (jsonb_populate_record(null::public.ph_requests_completed_history,to_jsonb(pending))).*
    from public.ph_requests_pending pending
    where lower(btrim(coalesce(nullif(pending.status,''''),pending.req_status,''''))) in (''complete'',''completed'')
  ) typed on conflict (unique_id) do nothing',common_columns,typed_columns);

  delete from public.ph_requests_pending pending
  where lower(btrim(coalesce(nullif(pending.status,''),pending.req_status,''))) in ('complete','completed')
    and exists(select 1 from public.ph_requests_completed_history history where history.unique_id=pending.unique_id);
end
$archive_completed$;

-- Preserve separate order-line identity while bundling candidate locations.
create or replace function suspend_tag_private.order_key(s public.ph_soc_master)
returns text language sql immutable set search_path='' as $fn$
 select md5(jsonb_build_array(coalesce(nullif(s.dock_num,''),s.dock),s.stopnumber,
   s.transactionnumber,s.salesrepid,s.salesrepname,s.customeridentityid,s.customername,
   s.consigneeidentityid,s.consigneename,s.itemcode,coalesce(nullif(s.suspend_origin_uid,''),s.unique_id),s.tagcode)::text)
$fn$;

create or replace function suspend_tag_private.is_false_block_v2378(p_location text)
returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(p_location,'') ~ '^0+[.]0+[.]111$'
$fn$;

-- Re-key previously persisted candidate groups using the canonical order-line
-- key. Only Suspend candidate rows are touched.
select set_config('app.suspend_tag_actor_id','agdata-v2378-migration',true);
update public.ph_soc_master soc_row
set suspend_candidate_group=suspend_tag_private.order_key(soc_row)
where soc_row.suspend_candidate_group is not null
  and (soc_row.suspend_candidate_state is not null or soc_row.suspend_origin_uid is not null);
select set_config('app.suspend_tag_actor_id','',true);

-- Forward-compatible, exact-source patch of the canonical group command:
-- exclude either False Block spelling from choices and copy candidate evidence
-- fields into the frozen review snapshot.
do $patch_group_command$
declare
  definition text;
  original text;
  replacement text;
begin
  definition:=pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure);
  original:=$old$'dock_photo_link',m.photo_link,'dock_photo_name',m.photo_name,'photo_link',m.photo_link,'photo_name',m.photo_name,'match'$old$;
  replacement:=$new$'dock_photo_link',m.photo_link,'dock_photo_name',m.photo_name,'photo_link',m.photo_link,'photo_name',m.photo_name,'photo_url',m.photo_url,'photos',m.photos,'pick_note',m.pick_note,'sales_note',m.sales_note,'match'$new$;
  if position(original in definition)>0 then
    definition:=replace(definition,original,replacement);
  end if;
  original:=$old$and suspend_tag_private.eligible(r.suspend,r.suspend_to) and coalesce(r.suspend_candidate_state,'candidate') not in ('denied','canceled','replaced')$old$;
  replacement:=original||' and not suspend_tag_private.is_false_block_v2378(r.locationcode)';
  if position(original in definition)>0 then definition:=replace(definition,original,replacement); end if;
  original:=$old$m.locationcode='0.00.111'$old$;
  if position(original in definition)>0 then definition:=replace(definition,original,'suspend_tag_private.is_false_block_v2378(m.locationcode)'); end if;
  original:=$old$r.locationcode='0.00.111'$old$;
  if position(original in definition)>0 then definition:=replace(definition,original,'suspend_tag_private.is_false_block_v2378(r.locationcode)'); end if;
  if position('is_false_block_v2378(m.locationcode)' in definition)=0
    or position('is_false_block_v2378(r.locationcode)' in definition)=0
    or position('and not suspend_tag_private.is_false_block_v2378(r.locationcode)' in definition)=0
    or position('''photo_url'',m.photo_url' in definition)=0 then
    raise exception 'AGDATA_V2378_GROUP_COMMAND_PATCH_MISSING';
  end if;
  execute definition;
end
$patch_group_command$;

-- Candidate images and notes must survive on the SOC mirror rows that power
-- the Docks Checker Copy after an approval.
alter table public.ph_soc_master
  add column if not exists photo_url text,
  add column if not exists photos jsonb not null default '[]'::jsonb,
  add column if not exists pick_note text,
  add column if not exists sales_note text,
  add column if not exists status text,
  add column if not exists step text,
  add column if not exists stagename text;

create or replace function suspend_tag_private.apply_decision_to_order_v2378()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare chosen jsonb; target_uid text; candidate_uid text;
begin
  if old.status is distinct from new.status or old.selected_source_uid is distinct from new.selected_source_uid then
    if new.status not in ('approved','denied') then return new; end if;
    if new.status='approved' then
      select value into chosen from jsonb_array_elements(coalesce(new.snapshot->'candidates','[]'::jsonb))
        where value->>'unique_id'=new.selected_source_uid limit 1;
      if chosen is null then raise exception 'AGDATA_V2378_APPROVED_CANDIDATE_MISSING'; end if;
      target_uid:=coalesce(nullif(chosen->>'suspend_origin_uid',''),new.source_uid);
      update public.ph_soc_master target set
        locationcode=coalesce(chosen->>'locationcode',target.locationcode),
        lotcode=coalesce(chosen->>'lotcode',target.lotcode),
        quantityordered=coalesce(chosen->>'suspend_order_quantity',chosen->>'quantityordered',target.quantityordered),
        photo_url=coalesce(chosen->>'photo_url',chosen->>'photo_link',target.photo_url),
        photos=coalesce(chosen->'photos',target.photos),
        photo_link=coalesce(chosen->>'dock_photo_link',chosen->>'photo_link',target.photo_link),
        photo_name=coalesce(chosen->>'dock_photo_name',chosen->>'photo_name',target.photo_name),
        dock_photo_link=coalesce(chosen->>'dock_photo_link',chosen->>'photo_link',target.dock_photo_link),
        dock_photo_name=coalesce(chosen->>'dock_photo_name',chosen->>'photo_name',target.dock_photo_name),
        dock_spec=coalesce(chosen->>'dock_spec',chosen->>'spec',target.dock_spec),
        dock_caliper=coalesce(chosen->>'dock_caliper',chosen->>'caliper',target.dock_caliper),
        dock_note=coalesce(chosen->>'dock_note',target.dock_note),
        spec=coalesce(chosen->>'spec',chosen->>'dock_spec',target.spec),
        caliper=coalesce(chosen->>'caliper',chosen->>'dock_caliper',target.caliper),
        av_note=coalesce(chosen->>'av_note',target.av_note),
        picknote=coalesce(chosen->>'pick_note',chosen->>'picknote',target.picknote),
        pick_note=coalesce(chosen->>'pick_note',chosen->>'picknote',target.pick_note),
        sales_note=coalesce(chosen->>'sales_note',target.sales_note),
        suspend=null,suspend_to=null,suspend_candidate_state='approved'
      where target.unique_id=target_uid;
      if not found then raise exception 'AGDATA_V2378_ORDER_SOURCE_MISSING'; end if;
      -- The physical source owns the approved pull. Synthetic options retain
      -- their frozen approval receipt but must not become duplicate load rows.
      update public.ph_soc_master option_row set
        quantityordered='0',quantityshipped='0',status='Canceled',step='CANCELED',stagename='Canceled',
        suspend=null,suspend_to=null,suspend_candidate_state='replaced'
      where option_row.unique_id<>target_uid
        and option_row.unique_id in (select value->>'unique_id'
          from jsonb_array_elements(coalesce(new.snapshot->'candidates','[]'::jsonb)))
        and nullif(option_row.suspend_origin_uid,'') is not null;
    else
      update public.ph_soc_master target set status='Canceled',step='CANCELED',stagename='Canceled',
        quantityordered='0',quantityshipped='0',
        suspend=null,suspend_to=null,suspend_candidate_state='rejected',date_completed=coalesce(date_completed,clock_timestamp())
      where target.unique_id=new.source_uid
        or target.unique_id in (select coalesce(nullif(value->>'suspend_origin_uid',''),value->>'unique_id')
          from jsonb_array_elements(coalesce(new.snapshot->'candidates','[]'::jsonb)))
        or target.unique_id in (select value->>'unique_id'
          from jsonb_array_elements(coalesce(new.snapshot->'candidates','[]'::jsonb)));
    end if;
  end if;
  return new;
end
$fn$;

drop trigger if exists agdata_v2378_suspend_decision_to_order on suspend_tag_private.approvals;
create trigger agdata_v2378_suspend_decision_to_order
after update of status,selected_source_uid on suspend_tag_private.approvals
for each row execute function suspend_tag_private.apply_decision_to_order_v2378();

-- ph_soc_master is the canonical Docks source; keep its statement event so the
-- order-row decision is visible to Docks, Checker and Inspector subscribers.
drop trigger if exists trg_emit_v2_app_live_event on public.ph_soc_master;
create trigger trg_emit_v2_app_live_event after insert or delete or update on public.ph_soc_master
for each statement execute function public.emit_v2_app_live_event('docks');

revoke all on function suspend_tag_private.is_false_block_v2378(text),
  suspend_tag_private.apply_decision_to_order_v2378() from public, anon, authenticated;
grant execute on function suspend_tag_private.is_false_block_v2378(text) to service_role;

-- Revision reads and app-access snapshots must use one identity-scoped hash.
-- Guard the source replacements so future edits fail closed rather than
-- silently leaving a second permission fingerprint in the read path.
do $permission_fingerprint$
declare
  definition text;
  old_expression text;
  new_expression text;
begin
  definition:=pg_get_functiondef('app_sync_private.snapshot(text[])'::regprocedure);
  old_expression:='version := md5(actor_scope::text||permissions::text);';
  new_expression:='version := app_sync_private.data_permission_version(actor);';
  if position(new_expression in definition)=0 then
    if length(definition)-length(replace(definition,old_expression,''))<>length(old_expression) then
      raise exception 'AGDATA_V2378_SNAPSHOT_PERMISSION_SOURCE_MISMATCH';
    end if;
    definition:=replace(definition,old_expression,new_expression);
    execute definition;
  end if;
  definition:=pg_get_functiondef('app_sync_private.snapshot(text[])'::regprocedure);
  if position(new_expression in definition)=0 or position(old_expression in definition)>0 then
    raise exception 'AGDATA_V2378_SNAPSHOT_PERMISSION_FINGERPRINT_INVALID';
  end if;

  definition:=pg_get_functiondef('public.dataset_revisions_for_actor_v1(uuid,text[])'::regprocedure);
  old_expression:='permission_version := md5(actor_scope::text||permissions::text);';
  new_expression:='permission_version := app_sync_private.data_permission_version(p_actor_id);';
  if position(new_expression in definition)=0 then
    if length(definition)-length(replace(definition,old_expression,''))<>length(old_expression) then
      raise exception 'AGDATA_V2378_API_REVISION_PERMISSION_SOURCE_MISMATCH';
    end if;
    definition:=replace(definition,old_expression,new_expression);
    execute definition;
  end if;
  definition:=pg_get_functiondef('public.dataset_revisions_for_actor_v1(uuid,text[])'::regprocedure);
  if position(new_expression in definition)=0 or position(old_expression in definition)>0 then
    raise exception 'AGDATA_V2378_API_REVISION_PERMISSION_FINGERPRINT_INVALID';
  end if;
end
$permission_fingerprint$;

do $v2378_contract$
begin
  if not exists(select 1 from pg_class where oid='public.ph_active_suspend'::regclass and reloptions @> array['security_invoker=false'])
    or not exists(select 1 from pg_class where oid='public.ph_active_request'::regclass and reloptions @> array['security_invoker=false']) then
    raise exception 'AGDATA_V2378_VIEW_SECURITY_CONTRACT_FAILED';
  end if;
  if not exists(select 1 from pg_class where oid='public.ph_suspend_history'::regclass and reloptions @> array['security_invoker=true'])
    or not has_table_privilege('anon','public.ph_suspend_history','select')
    or not has_table_privilege('anon','public.ph_productivity_history','select')
    or not exists(select 1 from pg_policies where schemaname='public' and tablename='ph_productivity_history'
      and policyname='agdata_v2378_suspend_history_select' and cmd='SELECT') then
    raise exception 'AGDATA_V2378_SUSPEND_HISTORY_READ_CONTRACT_FAILED';
  end if;
  if (select value->>'app_version' from public.ph_app_settings where key='app_version') is distinct from '2.3.78' then
    raise exception 'AGDATA_V2378_APP_VERSION_CONTRACT_FAILED';
  end if;
  if position('app_sync_private.data_permission_version(actor)' in
      pg_get_functiondef('app_sync_private.snapshot(text[])'::regprocedure))=0
    or position('app_sync_private.data_permission_version(p_actor_id)' in
      pg_get_functiondef('public.dataset_revisions_for_actor_v1(uuid,text[])'::regprocedure))=0 then
    raise exception 'AGDATA_V2378_PERMISSION_FINGERPRINT_CONTRACT_FAILED';
  end if;
  if position('app_limited_live_overrides' in
      pg_get_functiondef('app_sync_private.data_permission_version(uuid)'::regprocedure))=0
    or position('state.revision' in
      pg_get_functiondef('app_sync_private.data_permission_version(uuid)'::regprocedure))=0
    or position('user-access:' in
      pg_get_functiondef('app_sync_private.data_permission_version(uuid)'::regprocedure))=0 then
    raise exception 'AGDATA_V2378_CANONICAL_PERMISSION_HASH_CONTRACT_FAILED';
  end if;
  if exists(select 1 from unnest(array['ph_soc_master','ph_requests_pending','ph_requests_completed_history','ph_master_inventory','ph_reserves','ph_cav_import','ph_suspend_history']) t(name)
    where not has_table_privilege('anon','public.'||name,'select') or not has_table_privilege('authenticated','public.'||name,'select')) then
    raise exception 'AGDATA_V2378_READ_GRANT_CONTRACT_FAILED';
  end if;
  if exists(select 1 from unnest(array['ph_soc_master','ph_requests_pending','ph_requests_completed_history','ph_master_inventory','ph_reserves','ph_cav_import','ph_suspend_history']) t(name)
    where has_table_privilege('anon','public.'||name,'insert') or has_table_privilege('anon','public.'||name,'update') or has_table_privilege('anon','public.'||name,'delete')) then
    raise exception 'AGDATA_V2378_MUTATION_PRIVILEGE_CHANGED';
  end if;
  if exists(select 1 from public.ph_requests_pending p where lower(btrim(coalesce(nullif(p.status,''),p.req_status,''))) in ('complete','completed')) then
    raise exception 'AGDATA_V2378_COMPLETED_REQUEST_REMAINS_PENDING';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='suspend_tag_private.approvals'::regclass and tgname='agdata_v2378_suspend_decision_to_order' and not tgisinternal) then
    raise exception 'AGDATA_V2378_APPROVAL_TRIGGER_MISSING';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.ph_soc_master'::regclass and tgname='trg_emit_v2_app_live_event' and not tgisinternal) then
    raise exception 'AGDATA_V2378_DOCKS_EVENT_TRIGGER_MISSING';
  end if;
end
$v2378_contract$;

notify pgrst, 'reload schema';
commit;
