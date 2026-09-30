begin;

-- Private command receipts make retries durable without replaying side effects.
create schema if not exists workflow_private;
revoke all on schema workflow_private from public, anon, authenticated;
create table workflow_private.commands (
  actor_id uuid not null, command_id text not null, request jsonb not null,
  result jsonb not null, created_at timestamptz not null default now(),
  primary key (actor_id, command_id)
);
alter table workflow_private.commands enable row level security;
revoke all on workflow_private.commands from public, anon, authenticated;

create table public.ph_production_workflow_rows (
  unique_id text primary key default gen_random_uuid()::text,
  workflow_type text not null check (workflow_type in ('propagation','planting')),
  source_unique_id text not null, status text not null default 'open' check (status in ('open','complete')),
  itemcode text, commonname text, genus text, contsize text, locationcode text,
  lotcode text, season text, blockalpha text, ptravailable numeric,
  quantity numeric not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  baynumber text not null default '', instructions text not null default '', snapshot jsonb not null,
  revision bigint not null default 1,
  created_by_username text not null, created_by_display text not null,
  updated_by_username text not null, updated_by_display text not null,
  completed_by_username text, completed_by_display text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create unique index production_one_open_source on public.ph_production_workflow_rows(workflow_type,source_unique_id) where status='open';
create index production_open_locations on public.ph_production_workflow_rows(workflow_type,status,blockalpha,locationcode);
alter table public.ph_production_workflow_rows enable row level security;
revoke all on public.ph_production_workflow_rows from public, anon, authenticated;
grant select on public.ph_production_workflow_rows to authenticated;
grant all on public.ph_production_workflow_rows to service_role;

create function workflow_private.active_actor(p_actor_id uuid) returns public.profiles
language plpgsql security invoker set search_path='' as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles where id=p_actor_id and disabled_at is null
    and (locked_until is null or locked_until<=now()) and must_change_password=false;
  if actor.id is null then raise exception using errcode='42501',message='WORKFLOW_PROFILE_INACTIVE'; end if;
  return actor;
end $$;

-- The navigation RPC is service-only. This narrow RLS wrapper binds it to the
-- current validated session; a caller cannot ask about another user's grants.
create function workflow_private.can_read_production(p_kind text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare actor_id uuid := app_sync_private.active_actor();
begin
  if actor_id is null then return false; end if;
  return public.navigation_module_allowed_v1(actor_id,'production-workflow')
    and public.navigation_module_allowed_v1(actor_id,'production:'||p_kind);
end $$;
revoke all on function workflow_private.can_read_production(text) from public, anon, authenticated;
grant usage on schema workflow_private to authenticated;
grant execute on function workflow_private.can_read_production(text) to authenticated;
create policy production_read on public.ph_production_workflow_rows for select to authenticated
using (workflow_private.can_read_production(workflow_type));

create function public.production_workflow_command_v1(p_actor_id uuid,p_operation text,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor public.profiles := workflow_private.active_actor(p_actor_id);
  kind text:=p_payload->>'workflow_type'; command_value text:=btrim(p_payload->>'command_id');
  source_row jsonb; row_value public.ph_production_workflow_rows; receipt workflow_private.commands;
  result jsonb; request_value jsonb:=jsonb_build_object('operation',p_operation,'payload',p_payload);
  amount numeric; expected bigint; source_id text:=btrim(p_payload->>'source_unique_id');
begin
  if not public.navigation_module_allowed_v1(actor.id,'production-workflow') then
    raise exception using errcode='42501',message='PRODUCTION_FORBIDDEN'; end if;
  if kind is null or kind not in ('propagation','planting') then raise exception 'PRODUCTION_TYPE_INVALID'; end if;
  if not public.navigation_module_allowed_v1(actor.id,'production:'||kind) then
    raise exception using errcode='42501',message='PRODUCTION_FORBIDDEN'; end if;
  if p_operation='list' then
    select jsonb_build_object('ok',true,'rows',coalesce(jsonb_agg(to_jsonb(w) order by w.blockalpha,w.locationcode,w.updated_at desc,w.unique_id),'[]'))
      into result from public.ph_production_workflow_rows w where workflow_type=kind and status=coalesce(nullif(p_payload->>'status',''),'open');
    return result;
  end if;
  if p_operation not in ('add','complete') then raise exception 'PRODUCTION_OPERATION_INVALID'; end if;
  if command_value is null or length(command_value)<12 or length(command_value)>180 then raise exception 'WORKFLOW_COMMAND_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||':'||command_value,0));
  select * into receipt from workflow_private.commands c where c.actor_id=actor.id and c.command_id=command_value;
  if found then
    if receipt.request<>request_value then raise exception using errcode='40001',message='WORKFLOW_COMMAND_CONFLICT'; end if;
    return receipt.result||jsonb_build_object('duplicate',true);
  end if;
  expected:=(p_payload->>'expected_revision')::bigint;
  if expected is null then raise exception 'WORKFLOW_REVISION_REQUIRED'; end if;
  if p_operation='add' then
    if expected<>0 then raise exception using errcode='40001',message='WORKFLOW_REVISION_CONFLICT'; end if;
    amount:=(p_payload->>'quantity')::numeric;
    if amount is null or amount<=0 or amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) then raise exception 'PRODUCTION_QUANTITY_REQUIRED'; end if;
    if length(coalesce(p_payload->>'instructions',''))>12000 or length(coalesce(p_payload->>'baynumber',''))>150 then raise exception 'PRODUCTION_TEXT_TOO_LONG'; end if;
    perform pg_advisory_xact_lock(hashtextextended('production:'||kind||':'||source_id,0));
    select to_jsonb(m) into source_row from public.ph_master_inventory m where m.unique_id=source_id for share;
    if source_row is null then raise exception using errcode='40001',message='PRODUCTION_SOURCE_MISSING'; end if;
    if jsonb_typeof(p_payload->'source_identity') is distinct from 'object'
      or not (p_payload->'source_identity') ?& array['unique_id','itemcode','contsize','locationcode','lotcode']
      or not source_row @> (p_payload->'source_identity') then
      raise exception using errcode='40001',message='PRODUCTION_SOURCE_CHANGED'; end if;
    if exists(select 1 from public.ph_production_workflow_rows where workflow_type=kind and source_unique_id=source_id and status='open') then
      raise exception using errcode='40001',message='PRODUCTION_ALREADY_OPEN'; end if;
    insert into public.ph_production_workflow_rows(workflow_type,source_unique_id,itemcode,commonname,genus,contsize,locationcode,lotcode,season,blockalpha,ptravailable,
      quantity,baynumber,instructions,snapshot,created_by_username,created_by_display,updated_by_username,updated_by_display)
    values(kind,source_id,source_row->>'itemcode',source_row->>'commonname',coalesce(source_row->>'genus',source_row->>'genusname'),source_row->>'contsize',source_row->>'locationcode',
      source_row->>'lotcode',source_row->>'season',source_row->>'blockalpha',
      case when replace(btrim(source_row->>'ptravailable'),',','') ~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$'
        then replace(btrim(source_row->>'ptravailable'),',','')::numeric else null end,amount,
      coalesce(p_payload->>'baynumber',''),coalesce(p_payload->>'instructions',''),source_row,actor.username,coalesce(actor.display_name,actor.username),
      actor.username,coalesce(actor.display_name,actor.username)) returning * into row_value;
  else
    select * into row_value from public.ph_production_workflow_rows where unique_id=p_payload->>'unique_id' and workflow_type=kind for update;
    if row_value.unique_id is null then raise exception 'PRODUCTION_ROW_MISSING'; end if;
    if row_value.revision<>expected or row_value.status<>'open' then raise exception using errcode='40001',message='WORKFLOW_REVISION_CONFLICT'; end if;
    update public.ph_production_workflow_rows set status='complete',revision=revision+1,completed_at=now(),updated_at=now(),
      completed_by_username=actor.username,completed_by_display=coalesce(actor.display_name,actor.username),updated_by_username=actor.username,
      updated_by_display=coalesce(actor.display_name,actor.username) where unique_id=row_value.unique_id returning * into row_value;
  end if;
  result:=jsonb_build_object('ok',true,'row',to_jsonb(row_value));
  insert into workflow_private.commands(actor_id,command_id,request,result) values(actor.id,command_value,request_value,result);
  return result;
end $$;
revoke all on function public.production_workflow_command_v1(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.production_workflow_command_v1(uuid,text,jsonb) to service_role;

create table public.ph_inventory_transactions (
  unique_id text primary key, created_at timestamptz not null default now(), action text not null,
  actor_id uuid, actor_username text, actor_display text, actor_email text,
  source_table text, source_unique_id text, destination_table text, destination_unique_id text,
  source_itemcode text, source_lotcode text, source_locationcode text,
  destination_itemcode text, destination_lotcode text, destination_locationcode text,
  quantity numeric, source_before jsonb, source_after jsonb, destination_before jsonb, destination_after jsonb,
  raw_payload jsonb not null default '{}', status text not null check (status in ('applied','requested')),
  event_type text not null default 'inventory_mutation', delivery_event_id uuid,
  search_text text not null default ''
);
create index inventory_transactions_chronological on public.ph_inventory_transactions(created_at desc,unique_id desc);
create index inventory_transactions_action on public.ph_inventory_transactions(action,created_at desc);
alter table public.ph_inventory_transactions enable row level security;
revoke all on public.ph_inventory_transactions from public, anon, authenticated;
grant select,insert on public.ph_inventory_transactions to service_role;

create function workflow_private.require_inventory_manager(p_actor_id uuid) returns public.profiles
language plpgsql security invoker set search_path='' as $$
declare actor public.profiles:=workflow_private.active_actor(p_actor_id);
begin
  if actor.username not in ('dylan_collyge','jd_jones','megan_kelly')
    and upper(regexp_replace(actor.role,'[^A-Za-z]','','g')) not in ('ADMIN','ADMINISTRATOR','MANAGER') then
    raise exception using errcode='42501',message='INVENTORY_MANAGER_REQUIRED'; end if;
  return actor;
end $$;

create function public.inventory_workflow_session_actor_v1(p_actor_id uuid,p_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles:=workflow_private.require_inventory_manager(p_actor_id);
begin
  if not exists(select 1 from auth.sessions where id=p_session_id and user_id=actor.id and (not_after is null or not_after>now())) then
    raise exception using errcode='42501',message='WORKFLOW_PROFILE_INACTIVE'; end if;
  return jsonb_build_object('id',actor.id,'username',actor.username,'display_name',actor.display_name,'role',actor.role);
end $$;
revoke all on function public.inventory_workflow_session_actor_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.inventory_workflow_session_actor_v1(uuid,uuid) to service_role;

-- Server-prepared changes, source comparisons, destination creation, hold scope,
-- audit, and command receipt commit in ONE PostgreSQL transaction. No client role
-- can execute this privileged bridge or supply trusted operations directly.
create function public.apply_inventory_transaction_v1(p_actor_id uuid,p_command_id text,p_request jsonb,p_operations jsonb,p_audit jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor public.profiles:=workflow_private.require_inventory_manager(p_actor_id);
  receipt workflow_private.commands; operation jsonb; old_row jsonb; changed_row jsonb; rows jsonb:='[]'; result jsonb;
  table_name text; row_id text; columns_sql text; values_sql text; patch jsonb; audit_record jsonb;
begin
  if length(coalesce(p_command_id,''))<12 or length(p_command_id)>180 then raise exception 'WORKFLOW_COMMAND_ID_REQUIRED'; end if;
  if p_audit->>'action' not in ('qty','transfer') or p_audit->>'action' is null then raise exception 'INVENTORY_ACTION_INVALID'; end if;
  if jsonb_typeof(p_operations)<>'array' or jsonb_array_length(p_operations)=0 or jsonb_array_length(p_operations)>5000 then raise exception 'INVENTORY_OPERATIONS_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor.id::text||':'||p_command_id,0));
  select * into receipt from workflow_private.commands c where c.actor_id=actor.id and c.command_id=p_command_id;
  if found then
    if receipt.request<>p_request then raise exception using errcode='40001',message='WORKFLOW_COMMAND_CONFLICT'; end if;
    return receipt.result||jsonb_build_object('duplicate',true);
  end if;
  -- Stable lock ordering prevents source/destination inversions between requests.
  for operation in select value from jsonb_array_elements(p_operations) order by value->>'table',value->>'unique_id' loop
    table_name:=operation->>'table'; row_id:=operation->>'unique_id';
    if table_name not in ('ph_master_inventory','tx_master_inventory','nc_master_inventory','hl_master_inventory') or table_name is null or row_id is null
      or operation->>'kind' is null or operation->>'kind' not in ('insert','update') then
      raise exception 'INVENTORY_TARGET_INVALID'; end if;
    execute format('select to_jsonb(m) from public.%I m where unique_id=$1 for update',table_name) into old_row using row_id;
    if operation->>'kind'='insert' then
      if old_row is not null then raise exception using errcode='40001',message='INVENTORY_DESTINATION_CHANGED'; end if;
      patch:=operation->'row';
      if patch->>'unique_id' is distinct from row_id then raise exception 'INVENTORY_TARGET_INVALID'; end if;
      select string_agg(format('%I',a.attname),',' order by a.attnum), string_agg(format('r.%I',a.attname),',' order by a.attnum)
        into columns_sql,values_sql from pg_catalog.pg_attribute a
        where a.attrelid=format('public.%I',table_name)::regclass and a.attnum>0 and not a.attisdropped
        and a.attgenerated='' and a.attidentity='' and patch ? a.attname;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r returning to_jsonb(%I.*)',
        table_name,columns_sql,values_sql,table_name,table_name) into changed_row using patch;
    else
      if old_row is null or old_row is distinct from operation->'expected' then raise exception using errcode='40001',message='INVENTORY_SOURCE_CHANGED'; end if;
      patch:=operation->'patch';
      if jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) k where k not in ('ptronhand','ptrreviewed','ptravailable','last_updated','holdstopcode','holdstopreason')) then
        raise exception 'INVENTORY_PATCH_INVALID'; end if;
      select string_agg(format('%I=r.%I',key,key),',') into columns_sql from jsonb_object_keys(patch) key;
      execute format('update public.%I m set %s from jsonb_populate_record(null::public.%I,$1) r where m.unique_id=$2 returning to_jsonb(m.*)',table_name,columns_sql,table_name)
        into changed_row using old_row||patch,row_id;
    end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('table',table_name,'row',changed_row));
  end loop;
  audit_record:=p_audit||jsonb_build_object('unique_id',gen_random_uuid()::text,'actor_id',actor.id,'actor_username',actor.username,
    'actor_display',coalesce(actor.display_name,actor.username),'actor_email',null,'created_at',now(),'status','applied','event_type','inventory_mutation',
    'raw_payload',p_request,'search_text',lower(concat_ws(' ',actor.username,p_audit->>'action',p_audit->>'source_itemcode',p_audit->>'source_lotcode',p_audit->>'source_locationcode',
      p_audit->>'destination_itemcode',p_audit->>'destination_lotcode',p_audit->>'destination_locationcode')));
  audit_record:=audit_record||jsonb_build_object('source_after',(select value->'row' from jsonb_array_elements(rows) where value->>'table'=p_audit->>'source_table' and value#>>'{row,unique_id}'=p_audit->>'source_unique_id'),
    'destination_after',(select value->'row' from jsonb_array_elements(rows) where value->>'table'=p_audit->>'destination_table' and value#>>'{row,unique_id}'=p_audit->>'destination_unique_id'));
  insert into public.ph_inventory_transactions select (jsonb_populate_record(null::public.ph_inventory_transactions,audit_record)).*;
  result:=jsonb_build_object('ok',true,'transactionId',audit_record->>'unique_id','rows',rows,'audit',audit_record);
  insert into workflow_private.commands(actor_id,command_id,request,result) values(actor.id,p_command_id,p_request,result);
  return result;
end $$;
revoke all on function public.apply_inventory_transaction_v1(uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_inventory_transaction_v1(uuid,text,jsonb,jsonb,jsonb) to service_role;

create function public.inventory_transaction_history_v1(p_actor_id uuid,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor public.profiles:=workflow_private.require_inventory_manager(p_actor_id); result jsonb;
  requested_limit integer:=least(500,greatest(1,coalesce((p_payload->>'limit')::integer,100)));
  requested_offset integer:=greatest(0,coalesce((p_payload->>'offset')::integer,0));
begin
  if not public.navigation_module_allowed_v1(actor.id,'inventory-transaction-history') then raise exception using errcode='42501',message='INVENTORY_HISTORY_FORBIDDEN'; end if;
  with matching as (
    select t.* from public.ph_inventory_transactions t
    where (coalesce(p_payload->>'action','all')='all' or t.action=p_payload->>'action')
      and (nullif(p_payload->>'dateStart','') is null or t.created_at>=(p_payload->>'dateStart')::timestamptz)
      and (nullif(p_payload->>'dateEnd','') is null or t.created_at<=(p_payload->>'dateEnd')::timestamptz)
      and not exists(select 1 from regexp_split_to_table(lower(btrim(coalesce(p_payload->>'search',''))),'\s+') token where token<>'' and position(token in t.search_text)=0)
  ), page as (select * from matching order by created_at desc,unique_id desc limit requested_limit offset requested_offset)
  select jsonb_build_object('ok',true,'rows',coalesce((select jsonb_agg(to_jsonb(p)-'search_text' order by p.created_at desc,p.unique_id desc) from page p),'[]'),
    'count',(select count(*) from matching),'offset',requested_offset,'limit',requested_limit,'hasMore',(select count(*) from matching)>requested_offset+requested_limit)
    into result;
  return result;
end $$;
revoke all on function public.inventory_transaction_history_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.inventory_transaction_history_v1(uuid,jsonb) to service_role;

-- Only future protected inquiry outbox events are recorded. This is a requested
-- change, never an applied stock transaction, and does not send any new email.
create function workflow_private.record_inventory_request() returns trigger
language plpgsql security definer set search_path='' as $$
declare p jsonb:=new.payload->'reclassPayload'; actor public.profiles; action_value text;
begin
  if new.event_type<>'reclass_inquiry' or p#>>'{protectedDelivery,contractVersion}' is distinct from 'drive-reclass-protected-v1' then return new; end if;
  select * into actor from public.profiles where id=(p#>>'{protectedDelivery,actorProfileId}')::uuid;
  action_value:=case when p#>>'{transaction,requestAction}'='priority_change'
    or coalesce(p#>'{transaction,requestActions}','[]') @> '["priority_change"]'::jsonb then 'priority_change' else 'reclass' end;
  insert into public.ph_inventory_transactions(unique_id,action,actor_id,actor_username,actor_display,source_table,source_unique_id,source_itemcode,source_lotcode,source_locationcode,
    raw_payload,status,event_type,delivery_event_id,search_text)
  values('request:'||new.event_id::text,action_value,actor.id,actor.username,coalesce(actor.display_name,actor.username),'ph_master_inventory',p#>>'{source,unique_id}',
    p#>>'{source,itemcode}',p#>>'{source,lotcode}',p#>>'{source,locationcode}',
    jsonb_build_object('transaction',p->'transaction','rowOverlays',p->'rowOverlays'),'requested','inventory_change_request',new.event_id,
    lower(concat_ws(' ',actor.username,action_value,p#>>'{source,itemcode}',p#>>'{source,lotcode}',p#>>'{source,locationcode}')))
  on conflict(unique_id) do nothing;
  return new;
end $$;
revoke all on function workflow_private.record_inventory_request() from public,anon,authenticated;
create trigger inventory_requested_audit after insert on public.ph_request_delivery_outbox for each row execute function workflow_private.record_inventory_request();

-- Activate the existing metadata-only sync sources after adding their tables.
insert into public.app_dataset_revisions(key) values('ph_production_workflow_rows'),('ph_inventory_transactions') on conflict(key) do nothing;
create trigger app_dataset_revision_inserted after insert on public.ph_production_workflow_rows referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated after update on public.ph_production_workflow_rows referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted after delete on public.ph_production_workflow_rows referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated after truncate on public.ph_production_workflow_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_inserted after insert on public.ph_inventory_transactions referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_updated after update on public.ph_inventory_transactions referencing new table as app_dataset_new_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_deleted after delete on public.ph_inventory_transactions referencing old table as app_dataset_old_rows
for each statement execute function app_sync_private.touch_source();
create trigger app_dataset_revision_truncated after truncate on public.ph_inventory_transactions
for each statement execute function app_sync_private.touch_source();
revoke all on all functions in schema workflow_private from public,anon;
grant usage on schema workflow_private to service_role;
grant all on workflow_private.commands to service_role;
grant execute on all functions in schema workflow_private to service_role;

commit;
