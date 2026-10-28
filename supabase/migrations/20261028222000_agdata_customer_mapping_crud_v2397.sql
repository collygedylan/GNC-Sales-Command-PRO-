begin;
set local lock_timeout = '1500ms';

-- Retain manager-created tuples and explicit removals independently of ERP.
create table if not exists sales_private.customer_mapping_rows_v2397 (
  unique_id text primary key,
  customeridentityid text not null,
  consigneeid text not null,
  row_data jsonb not null,
  removed boolean not null default false,
  updated_by text not null,
  updated_at timestamptz not null default statement_timestamp(),
  unique(customeridentityid,consigneeid)
);
alter table sales_private.customer_mapping_rows_v2397 enable row level security;
revoke all on sales_private.customer_mapping_rows_v2397 from public,anon,authenticated,service_role;

create or replace function sales_private.replay_customer_mapping_rows_v2397()
returns void language plpgsql security definer set search_path='' as $function$
begin
  insert into public.ph_customer_consignee_sales_reps
    (unique_id,customeridentityid,consigneeid,customername,consigneename,salesrepid,salesrepname,
     customerstatus,consigneestatus,territorycode,territorydesc,mapping_revision,mapping_updated_by,row_hash)
  select r.unique_id,r.customeridentityid,r.consigneeid,r.row_data->>'customername',r.row_data->>'consigneename',
    r.row_data->>'salesrepid',r.row_data->>'salesrepname','A','A',r.row_data->>'territorycode',r.row_data->>'territorydesc',
    coalesce((r.row_data->>'mapping_revision')::bigint,1),r.updated_by,'manager-row:'||r.unique_id
  from sales_private.customer_mapping_rows_v2397 r
  where not r.removed and not exists(select 1 from public.ph_customer_consignee_sales_reps m
    where m.customeridentityid=r.customeridentityid and m.consigneeid=r.consigneeid)
  on conflict(unique_id) do nothing;
  -- Delete only the maintained mapping; history and the original ERP source remain intact.
  delete from public.ph_customer_consignee_sales_reps m using sales_private.customer_mapping_rows_v2397 r
  where r.removed and m.customeridentityid=r.customeridentityid and m.consigneeid=r.consigneeid;
end
$function$;
revoke all on function sales_private.replay_customer_mapping_rows_v2397() from public,anon,authenticated,service_role;

alter function public.customer_rep_mapping_manage_v1(uuid,text,jsonb) rename to customer_rep_mapping_manage_v2397_base;
revoke all on function public.customer_rep_mapping_manage_v2397_base(uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.customer_rep_mapping_manage_v1(p_actor_id uuid,p_operation text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare actor public.profiles; target public.ph_customer_consignee_sales_reps; result jsonb; replay jsonb;
  op text:=lower(btrim(coalesce(p_operation,''))); payload jsonb:=coalesce(p_payload,'{}'::jsonb); rep_name text;
begin
  if op not in ('create','delete') then
    result:=public.customer_rep_mapping_manage_v2397_base(p_actor_id,p_operation,p_payload);
    if op in ('save','assign','reset') and result->>'ok'='true' then
      update sales_private.customer_mapping_rows_v2397 r set row_data=to_jsonb(m),updated_at=statement_timestamp()
      from public.ph_customer_consignee_sales_reps m where r.unique_id=m.unique_id and m.unique_id=payload->>'id' and not r.removed;
    end if;
    return result;
  end if;
  select * into actor from public.profiles where id=p_actor_id and disabled_at is null
    and (locked_until is null or locked_until<=statement_timestamp()) and not must_change_password;
  if actor.id is null or coalesce(upper(btrim(actor.role)),'') not in ('ADMIN','ADMINISTRATOR','MANAGER') then
    raise exception 'CUSTOMER_REP_MAPPING_FORBIDDEN' using errcode='42501'; end if;
  if jsonb_typeof(payload)<>'object' or coalesce(payload->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'CUSTOMER_REP_MAPPING_PAYLOAD_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('customer-rep-map-import',615738));
  replay:=sales_private.customer_rep_assignment_receipt_replay_v1(p_actor_id,payload->>'requestId',payload||jsonb_build_object('operation',op));
  if replay is not null then return replay; end if;
  if op='create' then
    if payload-array['requestId','salesrepId','customerId','customerName','consigneeId','consigneeName','territory']<>'{}'::jsonb
      or exists(select 1 from unnest(array['salesrepId','customerId','customerName','consigneeId','consigneeName']) k
        where jsonb_typeof(payload->k)<>'string' or nullif(btrim(payload->>k),'') is null or length(payload->>k)>240)
      or length(coalesce(payload->>'territory',''))>120 then
      raise exception 'CUSTOMER_REP_MAPPING_PAYLOAD_INVALID' using errcode='22023'; end if;
    select min(s.salesrepname) into rep_name from sales_private.customer_rep_assignment_sources s
      where s.salesrepid=btrim(payload->>'salesrepId') and sales_private.customer_rep_assignment_rep_allowed_v1(s.salesrepid,s.salesrepname);
    if rep_name is null then raise exception 'CUSTOMER_REP_MAPPING_REP_UNVERIFIED' using errcode='22023'; end if;
    if upper(btrim(payload->>'customerName'))='N/A' or upper(btrim(payload->>'consigneeName'))='N/A'
      or exists(select 1 from public.ph_customer_consignee_sales_reps m
        where m.customeridentityid=btrim(payload->>'customerId') and m.consigneeid=btrim(payload->>'consigneeId')) then
      raise exception 'CUSTOMER_REP_MAPPING_DUPLICATE' using errcode='23505'; end if;
    insert into public.ph_customer_consignee_sales_reps
      (unique_id,customeridentityid,consigneeid,customername,consigneename,salesrepid,salesrepname,
       customerstatus,consigneestatus,territorycode,mapping_revision,mapping_updated_by,row_hash)
    values('manager_'||(payload->>'requestId'),btrim(payload->>'customerId'),btrim(payload->>'consigneeId'),
      btrim(payload->>'customerName'),btrim(payload->>'consigneeName'),btrim(payload->>'salesrepId'),rep_name,
      'A','A',nullif(btrim(payload->>'territory'),''),1,actor.username,'manager-row:'||(payload->>'requestId')) returning * into target;
    insert into sales_private.customer_mapping_rows_v2397(unique_id,customeridentityid,consigneeid,row_data,updated_by)
      values(target.unique_id,target.customeridentityid,target.consigneeid,to_jsonb(target),actor.username)
      on conflict(customeridentityid,consigneeid) do update set unique_id=excluded.unique_id,row_data=excluded.row_data,
        removed=false,updated_by=excluded.updated_by,updated_at=statement_timestamp();
    result:=public.customer_rep_mapping_manage_v2397_base(p_actor_id,'detail',jsonb_build_object('id',target.unique_id));
  else
    if payload-array['requestId','id','expectedRevision']<>'{}'::jsonb
      or coalesce(payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,18}$' then
      raise exception 'CUSTOMER_REP_MAPPING_PAYLOAD_INVALID' using errcode='22023'; end if;
    select * into target from public.ph_customer_consignee_sales_reps where unique_id=payload->>'id' for update;
    if not found then raise exception 'CUSTOMER_REP_MAPPING_NOT_FOUND' using errcode='P0002'; end if;
    if target.mapping_revision<>(payload->>'expectedRevision')::bigint then raise exception 'CUSTOMER_REP_MAPPING_CONFLICT' using errcode='40001'; end if;
    if upper(btrim(target.customername))='N/A' or upper(btrim(target.consigneename))='N/A' then
      raise exception 'CUSTOMER_REP_MAPPING_VALUE_PROTECTED' using errcode='22023'; end if;
    insert into sales_private.customer_mapping_rows_v2397(unique_id,customeridentityid,consigneeid,row_data,removed,updated_by)
      values(target.unique_id,target.customeridentityid,target.consigneeid,to_jsonb(target),true,actor.username)
      on conflict(customeridentityid,consigneeid) do update set removed=true,row_data=excluded.row_data,updated_by=excluded.updated_by,updated_at=statement_timestamp();
    delete from public.ph_customer_consignee_sales_reps where unique_id=target.unique_id;
    result:=jsonb_build_object('ok',true,'deleted',target.unique_id);
  end if;
  perform sales_private.customer_rep_assignment_receipt_store_v1(p_actor_id,payload->>'requestId',payload||jsonb_build_object('operation',op),result);
  return result;
end
$function$;
revoke all on function public.customer_rep_mapping_manage_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.customer_rep_mapping_manage_v1(uuid,text,jsonb) to service_role;

alter function public.finalize_customer_rep_mapping_import_v1(uuid) rename to finalize_customer_rep_mapping_import_v2397_base;
revoke all on function public.finalize_customer_rep_mapping_import_v2397_base(uuid) from public,anon,authenticated,service_role;
create function public.finalize_customer_rep_mapping_import_v1(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='55s' as $function$
declare result jsonb;
begin
  result:=public.finalize_customer_rep_mapping_import_v2397_base(p_run_id);
  perform sales_private.replay_customer_mapping_rows_v2397();
  return result;
end
$function$;
revoke all on function public.finalize_customer_rep_mapping_import_v1(uuid) from public,anon,authenticated;
grant execute on function public.finalize_customer_rep_mapping_import_v1(uuid) to service_role;
commit;
