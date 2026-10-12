begin;
set local lock_timeout='5s';

-- Any non-NULL dock value, including zero or an empty string, is an Order.
alter table public.ph_active_request add column if not exists dock text;
comment on column public.ph_active_request.dock is 'Historical Order discriminator: any non-NULL value is an assigned order.';
do $views$
declare view_name text; definition text;
begin
  foreach view_name in array array['ph_active_request_live_rows','ph_request_queue_live_rows'] loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=view_name and column_name='dock') then
      definition:=pg_get_viewdef(format('public.%I',view_name)::regclass,true);
      execute format('create or replace view public.%I with (security_invoker=true) as select existing.*,request.dock from (%s) existing left join public.ph_active_request request using(unique_id)',view_name,regexp_replace(definition,';[[:space:]]*$',''));
    end if;
  end loop;
end
$views$;

-- This capability comes from the verified account, never a client role or name.
create table if not exists private.request_financial_admins_v1 (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  active boolean not null default true,
  designated_at timestamptz not null default now()
);
alter table private.request_financial_admins_v1 enable row level security;
revoke all on private.request_financial_admins_v1 from public,anon,authenticated,service_role;
-- No additional accounts are designated by this release.
create or replace function private.history_dylan_financial_v1(p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=p_actor
    and (p.username='dylan_collyge' or exists(select 1 from private.request_financial_admins_v1 a where a.profile_id=p.id and a.active))
    and upper(regexp_replace(coalesce(p.role,''),'^[[:space:]]+|[[:space:]]+$','','g')) in ('ADMIN','ADMINISTRATOR','SUPERADMIN')
    and p.disabled_at is null and not coalesce(p.must_change_password,true)
    and (p.locked_until is null or p.locked_until<=statement_timestamp())
    and private.app_account_active_at_v1(p.id,p.username,statement_timestamp()))
$$;
revoke all on function private.history_dylan_financial_v1(uuid) from public,anon,authenticated,service_role;

-- Designated super-admins receive the reporting navigation capability while
-- the existing per-user deny remains authoritative.
do $navigation$
declare definition text; needle text:='in (''REP'',''SALESREP'',''ADMIN'',''ADMINISTRATOR'');';
begin
  definition:=pg_get_functiondef('private.navigation_module_allowed_v1(uuid,text)'::regprocedure);
  if position(needle in definition)>0 then
    execute replace(definition,needle,'in (''REP'',''SALESREP'',''ADMIN'',''ADMINISTRATOR'') or private.history_dylan_financial_v1(p.id);');
  elsif position('or private.history_dylan_financial_v1(p.id);' in definition)=0 then
    raise exception 'HISTORY_NAVIGATION_PATCH_SOURCE_MISMATCH';
  end if;
end $navigation$;

create or replace function private.can_read_request_history_owner_v1(p_actor uuid,p_rep uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=p_actor
    and p.disabled_at is null and not coalesce(p.must_change_password,true)
    and (p.locked_until is null or p.locked_until<=statement_timestamp())
    and private.app_account_active_at_v1(p.id,p.username,statement_timestamp())
    and (private.navigation_module_allowed_v1(p.id,'request-history')
      or private.navigation_module_allowed_v1(p.id,'historical-requests'))
    and (private.history_dylan_financial_v1(p.id) or p.id=p_rep))
$$;
revoke all on function private.can_read_request_history_owner_v1(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function private.can_read_sales_history_v1(p_rep uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_read_request_history_owner_v1((select auth.uid()),p_rep)
$$;
revoke all on function private.can_read_sales_history_v1(uuid) from public,anon,service_role;
grant execute on function private.can_read_sales_history_v1(uuid) to authenticated;

-- Restrictive policies compose with existing operational policies and grants.
create or replace function private.active_request_rep_isolated_v1(p_row jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=(select auth.uid())
    and p.disabled_at is null and not coalesce(p.must_change_password,true)
    and (p.locked_until is null or p.locked_until<=statement_timestamp())
    and private.app_account_active_at_v1(p.id,p.username,statement_timestamp())
    and (not (sales_private.is_rep(p.role) or p.username in ('ben_brown','chance_alldredge'))
      or sales_private.assigned_rep(p_row)=p.id))
$$;
revoke all on function private.active_request_rep_isolated_v1(jsonb) from public,anon,service_role;
grant execute on function private.active_request_rep_isolated_v1(jsonb) to authenticated;
drop policy if exists ph_request_history_owner_isolation on public.ph_request_history;
create policy ph_request_history_owner_isolation on public.ph_request_history
as restrictive for select to authenticated using(private.can_read_sales_history_v1(assigned_rep_id));
-- Raw snapshots can contain legacy monetary fields. User reads go through the
-- redacting RPC or the nonfinancial Orders projection, not the raw table.
revoke select on public.ph_request_history from authenticated;
drop policy if exists ph_active_request_rep_isolation on public.ph_active_request;
create policy ph_active_request_rep_isolation on public.ph_active_request
as restrictive for select to authenticated using(
  private.active_request_rep_isolated_v1(to_jsonb(ph_active_request)));

-- The exact-count read formerly repeated account validation for every row.
-- Scalar subqueries produce statement initplans; authorization is unchanged.
drop policy ph_inventory_row_assignments_active_read on public.ph_inventory_row_assignments;
create policy ph_inventory_row_assignments_active_read on public.ph_inventory_row_assignments
for select to authenticated using((select (private.current_active_profile()).id) is not null
  and (select private.inventory_row_assignment_policy_active_v1()));
drop policy ph_itemcode_default_owners_active_read on public.ph_itemcode_default_owners;
create policy ph_itemcode_default_owners_active_read on public.ph_itemcode_default_owners
for select to authenticated using((select (private.current_active_profile()).id) is not null
  and (select private.inventory_row_assignment_policy_active_v1()));

-- Legacy API clients retain their nonfinancial fields, including nested snapshots.
create or replace function private.history_redact_financial_v1(p_value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb; pair record;
begin
  if jsonb_typeof(p_value)='object' then
    result:='{}';
    for pair in select key,value from jsonb_each(p_value) loop
      if lower(regexp_replace(pair.key,'[^a-zA-Z]','','g')) not in
        ('listprice','price','unitprice','totalvalue','totalamount','amount','pricedvalue','unpricedcount','unresolvedreason')
        and lower(regexp_replace(pair.key,'[^a-zA-Z]','','g')) !~ '(price|cost|amount|value)$' then
        result:=result||jsonb_build_object(pair.key,private.history_redact_financial_v1(pair.value));
      end if;
    end loop;
    return result;
  elsif jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(private.history_redact_financial_v1(value) order by ordinal),'[]') into result
      from jsonb_array_elements(p_value) with ordinality a(value,ordinal);
    return result;
  end if;
  return p_value;
end $$;
revoke all on function private.history_redact_financial_v1(jsonb) from public,anon,authenticated,service_role;

-- Current catalog pricing uses only the exact textual item code. Locations,
-- lots, sizes, old master IDs and sales years do not select the base price.
create or replace function private.history_catalog_price_v1(p_itemcode text)
returns numeric language sql stable security definer set search_path='' as $$
  select case when min(price)=max(price) then min(price) else null end
  from (select private.historical_requests_number_v1(m.listprice) as price
    from public.ph_master_inventory m where btrim(m.itemcode)=btrim(p_itemcode)) p where price>=0
$$;
revoke all on function private.history_catalog_price_v1(text) from public,anon,authenticated,service_role;
create index if not exists ph_master_inventory_catalog_itemcode_v1 on public.ph_master_inventory(btrim(itemcode));

-- Incoming financial snapshots are private. Historical rows are never rewritten
-- to price them; reporting recalculates against the current catalog on each read.
create table if not exists private.request_financial_values_v1 (
  source_table text not null check(source_table in ('ph_active_request','ph_request_history')),
  request_id text not null,
  itemcode text,
  effective_qty numeric,
  list_price numeric,
  total_value numeric,
  captured_at timestamptz not null default now(),
  primary key(source_table,request_id)
);
alter table private.request_financial_values_v1 enable row level security;
revoke all on private.request_financial_values_v1 from public,anon,authenticated,service_role;
create or replace function private.capture_request_financial_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare payload jsonb; quantity numeric; price numeric;
begin
  if tg_op='DELETE' then
    delete from private.request_financial_values_v1 where source_table=tg_table_name and request_id=old.unique_id;
    return old;
  end if;
  payload:=coalesce(to_jsonb(new)->'snapshot','{}')||jsonb_strip_nulls(to_jsonb(new));
  quantity:=private.historical_requests_number_v1(payload->>'req_qty');
  -- Retain the established request business rule for blank/zero quantities.
  if nullif(btrim(payload->>'req_qty'),'') is null or quantity=0 then quantity:=25; end if;
  if quantity<0 then quantity:=null; end if;
  if exists(select 1 from public.app_dataset_revisions where key='ph_master_inventory' and state='ready') then
    price:=private.history_catalog_price_v1(payload->>'itemcode');
  end if;
  insert into private.request_financial_values_v1(source_table,request_id,itemcode,effective_qty,list_price,total_value)
  values(tg_table_name,payload->>'unique_id',payload->>'itemcode',quantity,price,quantity*price)
  on conflict(source_table,request_id) do update set itemcode=excluded.itemcode,effective_qty=excluded.effective_qty,
    list_price=excluded.list_price,total_value=excluded.total_value,captured_at=now();
  return new;
end $$;
revoke all on function private.capture_request_financial_v1() from public,anon,authenticated,service_role;
drop trigger if exists request_financial_capture_v1 on public.ph_active_request;
create trigger request_financial_capture_v1 after insert or update of itemcode,req_qty or delete on public.ph_active_request
for each row execute function private.capture_request_financial_v1();
drop trigger if exists request_financial_capture_v1 on public.ph_request_history;
create trigger request_financial_capture_v1 after insert or update of itemcode,req_qty or delete on public.ph_request_history
for each row execute function private.capture_request_financial_v1();

-- Patch only this history API, preserving credit oversight and write permissions.
do $patch$
declare signature regprocedure:='public.request_history_command_v1(uuid,text,jsonb,uuid,bigint)'::regprocedure;
  definition text; needle text:='where not rep_scoped or rep=actor.id or sales_private.key(row->>''request_created_by_username'')=actor_key';
  scope_needle text:='rep_scoped:=sales_private.is_rep(actor.role) or actor.username in (''ben_brown'',''chance_alldredge'');';
begin
  definition:=pg_get_functiondef(signature);
  if position(needle in definition)>0 then
    if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
      raise exception 'HISTORY_OWNER_PATCH_SOURCE_MISMATCH';
    end if;
    if position(scope_needle in definition)=0 or (length(definition)-length(replace(definition,'return result;','')))/length('return result;')<>1 then
      raise exception 'HISTORY_OWNER_PATCH_SOURCE_MISMATCH';
    end if;
    definition:=replace(definition,needle,'where not rep_scoped or rep=actor.id');
    definition:=replace(definition,scope_needle,'rep_scoped:=not private.history_dylan_financial_v1(actor.id);');
    definition:=replace(definition,'return result;',
      'return case when private.history_dylan_financial_v1(actor.id) then result else private.history_redact_financial_v1(result) end;');
    execute definition;
  elsif position('rep_scoped:=not private.history_dylan_financial_v1(actor.id);' in definition)=0
    or position('history_redact_financial_v1(result)' in definition)=0 then
    raise exception 'HISTORY_OWNER_PATCH_SOURCE_MISMATCH';
  end if;
end
$patch$;

create or replace function public.historical_requests_read_v1(p_query jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer
set search_path=''
set statement_timeout='10s'
as $function$
declare
  actor public.profiles;
  actor_id uuid:=auth.uid();
  global_scope boolean;
  operation text;
  customer_filter text;
  consignee_filter text;
  rep_filter text;
  record_kind text:='all';
  requested_view text:='historical-requests';
  date_from_value date;
  date_to_value date;
  date_from_stamp timestamptz;
  date_to_stamp timestamptz;
  page_value integer:=0;
  page_size_value integer:=25;
  row_total bigint:=0;
  request_total bigint:=0;
  unpriced_total bigint:=0;
  value_total numeric:=0;
  rows_value jsonb:='[]'::jsonb;
  revision_value text;
  generated_at timestamptz:=clock_timestamp();
  revision_row record;
  revision_count integer:=0;
begin
  if actor_id is null then raise exception using errcode='42501',message='HISTORICAL_REQUESTS_AUTH_REQUIRED'; end if;
  actor:=sales_private.actor(actor_id);
  if p_query ? 'view' then
    if jsonb_typeof(p_query->'view')<>'string' or p_query->>'view' not in ('historical-requests','request-history') then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end if;
    requested_view:=p_query->>'view';
  end if;
  if not private.navigation_module_allowed_v1(actor_id,requested_view) then
    raise exception using errcode='42501',message='HISTORICAL_REQUESTS_FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_query,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_query,'{}'::jsonb)) k
      where k not in ('operation','customerKey','consigneeKey','repKey','recordKind','view','dateFrom','dateTo','page','pageSize')) then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
  end if;
  operation:=p_query->>'operation';
  if operation is null or operation not in ('customers','consignees','requests','reps','folders','months','summary') then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_OPERATION_INVALID';
  end if;
  global_scope:=private.history_dylan_financial_v1(actor_id);
  if operation='months' and not global_scope then
    raise exception using errcode='42501',message='HISTORICAL_REQUESTS_FINANCIAL_FORBIDDEN';
  end if;
  if p_query ? 'dateFrom' or p_query ? 'dateTo' then
    begin
      if p_query ? 'dateFrom' then
        if jsonb_typeof(p_query->'dateFrom')<>'string' or p_query->>'dateFrom' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
        end if;
        date_from_value:=(p_query->>'dateFrom')::date;
        date_from_stamp:=date_from_value::timestamp at time zone 'America/Chicago';
      end if;
      if p_query ? 'dateTo' then
        if jsonb_typeof(p_query->'dateTo')<>'string' or p_query->>'dateTo' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
        end if;
        date_to_value:=(p_query->>'dateTo')::date;
        date_to_stamp:=(date_to_value+1)::timestamp at time zone 'America/Chicago';
      end if;
      if date_from_value>date_to_value then raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end;
  end if;
  if p_query ? 'recordKind' then
    if jsonb_typeof(p_query->'recordKind')<>'string' or p_query->>'recordKind' not in ('all','requests','orders') then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end if;
    record_kind:=p_query->>'recordKind';
  end if;
  if p_query ? 'repKey' then
    if jsonb_typeof(p_query->'repKey')<>'string'
      or (p_query->>'repKey' !~ '^rep:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and p_query->>'repKey'<>'rep:unassigned') then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end if;
    rep_filter:=p_query->>'repKey';
    if not global_scope and rep_filter<>'rep:'||actor_id::text then
      raise exception using errcode='42501',message='HISTORICAL_REQUESTS_REP_FORBIDDEN';
    end if;
  end if;
  if p_query ? 'customerKey' then
    if jsonb_typeof(p_query->'customerKey')<>'string' or length(p_query->>'customerKey') not between 1 and 300 then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end if;
    customer_filter:=p_query->>'customerKey';
  end if;
  if p_query ? 'consigneeKey' then
    if jsonb_typeof(p_query->'consigneeKey')<>'string' or length(p_query->>'consigneeKey') not between 1 and 300 then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end if;
    consignee_filter:=p_query->>'consigneeKey';
  end if;
  if operation in ('consignees','requests') and customer_filter is null then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_CUSTOMER_REQUIRED';
  end if;
  if operation='requests' and consignee_filter is null then
    raise exception using errcode='22023',message='HISTORICAL_REQUESTS_CONSIGNEE_REQUIRED';
  end if;
  if p_query ? 'page' then
    if jsonb_typeof(p_query->'page')<>'number' or coalesce(p_query->>'page','') !~ '^(0|[1-9][0-9]{0,6})$' then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end if;
    page_value:=(p_query->>'page')::integer;
  end if;
  if p_query ? 'pageSize' then
    if jsonb_typeof(p_query->'pageSize')<>'number' or coalesce(p_query->>'pageSize','') !~ '^[1-9][0-9]{0,2}$' then
      raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID';
    end if;
    page_size_value:=(p_query->>'pageSize')::integer;
    if page_size_value not between 1 and 100 then raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;
  end if;
  if page_value>100000 then raise exception using errcode='22023',message='HISTORICAL_REQUESTS_QUERY_INVALID'; end if;

  -- Lock source revisions in key order. Source triggers acquire the same row
  -- locks, so a response is tied to one coherent active/history/master view.
  for revision_row in
    select r.key,r.revision,r.state from public.app_dataset_revisions r
    where r.key=any(array['ph_active_request','ph_customer_consignee_sales_reps','ph_master_inventory','ph_request_history']) order by r.key for share
  loop
    revision_count:=revision_count+1;
    if revision_row.state is distinct from 'ready' then
      raise exception using errcode='55000',message='HISTORICAL_REQUESTS_SOURCE_REFRESH_REQUIRED';
    end if;
  end loop;
  if revision_count<>4 then
    raise exception using errcode='55000',message='HISTORICAL_REQUESTS_SOURCE_REFRESH_REQUIRED';
  end if;
  select string_agg(k||':'||coalesce(r.revision,0)::text,',' order by k) into revision_value
  from unnest(array['ph_active_request','ph_customer_consignee_sales_reps','ph_master_inventory','ph_request_history']) k
  left join public.app_dataset_revisions r on r.key=k;

  with raw_source_rows as materialized (
    select h.unique_id,h.assigned_rep_id as owner_id,
      coalesce(nullif(h.customername,''),nullif(h.snapshot->>'customername',''),nullif(h.req_customer,''),nullif(h.request_customer,''),'Unknown customer') as customer_name,
      coalesce(nullif(h.consigneename,''),nullif(h.snapshot->>'consigneename',''),'Unknown consignee') as consignee_name,
      coalesce(nullif(h.customeridentityid,''),nullif(h.snapshot->>'customeridentityid','')) as customer_id,
      coalesce(nullif(h.consigneeidentityid,''),nullif(h.snapshot->>'consigneeidentityid','')) as consignee_id,
      coalesce(nullif(btrim(h.itemcode),''),h.snapshot->>'itemcode',h.snapshot->>'ITEMCODE') as itemcode,
      h.commonname,h.locationcode,coalesce(h.req_qty,h.snapshot->>'req_qty') as req_qty,h.req_status,
      coalesce(h.created_at,private.try_timestamptz(h.snapshot->>'created_at')) as created_at,
      coalesce(ah.dock::text,h.snapshot->>'dock') as dock,coalesce(h.snapshot,'{}')||jsonb_strip_nulls(to_jsonb(h)) as details
    from public.ph_request_history h
    left join public.ph_active_request ah on ah.unique_id=h.unique_id
    where global_scope or h.assigned_rep_id=actor_id
    union all
    select a.unique_id,rep.owner_id,
      coalesce(nullif(a.customername,''),nullif(a.req_customer,''),'Unknown customer'),
      coalesce(nullif(a.consigneename,''),'Unknown consignee'),
      nullif(a.customeridentityid,''),nullif(a.consigneeidentityid,''),
      a.itemcode,a.commonname,a.locationcode,a.req_qty,a.req_status,a.created_at,a.dock::text,to_jsonb(a)
    from public.ph_active_request a
    cross join lateral (select sales_private.assigned_rep(to_jsonb(a)) as owner_id) rep
    where not exists(select 1 from public.ph_request_history h where h.unique_id=a.unique_id)
      and (global_scope or rep.owner_id=actor_id)
  ), source_rows as materialized (
    select s.* from raw_source_rows s
    where (rep_filter is null or 'rep:'||coalesce(s.owner_id::text,'unassigned')=rep_filter)
      and (date_from_stamp is null or s.created_at>=date_from_stamp)
      and (date_to_stamp is null or s.created_at<date_to_stamp)
      and (record_kind='all' or (record_kind='orders' and s.dock is not null)
        or (record_kind='requests' and s.dock is null))
  ), mapped_folders as materialized (
    select distinct i.profile_id as owner_id,
      'customer:id:'||md5(m.customeridentityid) as customer_key,
      'customer:id:'||md5(m.customeridentityid)||'|consignee:'||
        case when nullif(m.consigneeid,'') is not null then 'id:'||md5(m.consigneeid)
          else 'name:'||md5(coalesce(nullif(sales_private.key(m.consigneename),''),'unknown')) end as full_consignee_key,
      coalesce(nullif(m.customername,''),'Unknown customer') as customer_name,
      coalesce(nullif(m.consigneename,''),'Unknown consignee') as consignee_name,
      m.customeridentityid as customer_id,m.consigneeid as consignee_id
    from public.ph_customer_consignee_sales_reps m
    join sales_private.rep_identities i on i.kind='external_id' and i.identity_key=sales_private.key(m.salesrepid)
    where m.customerstatus='A' and m.consigneestatus='A' and nullif(m.customeridentityid,'') is not null
      and (global_scope or i.profile_id=actor_id)
      and (rep_filter is null or 'rep:'||i.profile_id::text=rep_filter)
  ), catalog_prices as materialized (
    select btrim(m.itemcode) as item_code,
      case when min(private.historical_requests_number_v1(m.listprice)) filter(where private.historical_requests_number_v1(m.listprice)>=0)
          =max(private.historical_requests_number_v1(m.listprice)) filter(where private.historical_requests_number_v1(m.listprice)>=0)
        then min(private.historical_requests_number_v1(m.listprice)) filter(where private.historical_requests_number_v1(m.listprice)>=0)
        else null::numeric end as price
    from public.ph_master_inventory m
    where btrim(m.itemcode) in (select distinct btrim(itemcode) from source_rows)
    group by btrim(m.itemcode)
  ), visible as materialized (
    select s.*,cp.price::text as listprice,(cp.price is not null) as catalog_price_found,
      coalesce(nullif(p.display_name,''),p.username,'Unassigned') as rep_name,
      case when s.customer_id is not null then 'customer:id:'||md5(s.customer_id)
        else 'customer:name:'||md5(coalesce(nullif(sales_private.key(s.customer_name),''),'unknown')) end as customer_key,
      case when s.consignee_id is not null then 'id:'||md5(s.consignee_id)
        else 'name:'||md5(coalesce(nullif(sales_private.key(s.consignee_name),''),'unknown')) end as consignee_part_key,
      private.historical_requests_number_v1(s.req_qty) as parsed_qty,cp.price as parsed_price,
      case when nullif(btrim(s.req_qty),'') is null or private.historical_requests_number_v1(s.req_qty)=0 then 25::numeric
        else private.historical_requests_number_v1(s.req_qty) end as effective_qty
    from source_rows s
    left join catalog_prices cp on cp.item_code=btrim(s.itemcode)
    left join public.profiles p on p.id=s.owner_id
  ), priced as materialized (
    select v.*,
      v.customer_key||'|consignee:'||v.consignee_part_key as full_consignee_key,
      case when nullif(btrim(v.req_qty),'') is not null and v.parsed_qty is null then 'invalid_request_quantity'
        when v.parsed_qty<0 then 'invalid_request_quantity'
        when not v.catalog_price_found then 'current_catalog_list_price_unavailable_or_conflicting'
        when v.listprice is null or v.parsed_price is null or v.parsed_price<0 then 'current_list_price_unavailable_or_invalid'
        else null end as unresolved_reason
    from visible v
  ), calculated as materialized (
    select p.*,
      case when p.unresolved_reason is null then p.effective_qty*p.parsed_price else null::numeric end as total_value
    from priced p
  ), filtered as materialized (
    select c.* from calculated c
    where (customer_filter is null or c.customer_key=customer_filter)
      and (consignee_filter is null or c.full_consignee_key=consignee_filter)
  ), summary_data as (
    select count(*)::bigint as requests,coalesce(sum(total_value),0)::numeric as amount,
      count(*) filter(where total_value is null)::bigint as unpriced from filtered
  ), record_groups as (
    select case operation when 'customers' then f.customer_key when 'consignees' then f.full_consignee_key
      when 'folders' then f.full_consignee_key
      when 'months' then 'month:'||coalesce(to_char(f.created_at at time zone 'America/Chicago','YYYY-MM'),'unknown')
      else 'rep:'||coalesce(f.owner_id::text,'unassigned') end as key,
      case operation when 'customers' then min(f.customer_name) when 'consignees' then min(f.consignee_name)
      when 'folders' then min(f.customer_name)
      when 'months' then coalesce(to_char(min(f.created_at) at time zone 'America/Chicago','YYYY-MM'),'Date not recorded')
      else min(f.rep_name) end as label,
      count(*)::bigint as requests,coalesce(sum(f.total_value),0)::numeric as amount,
      count(*) filter(where f.total_value is null)::bigint as unpriced,
      min(f.customer_key) as customer_key,min(f.full_consignee_key) as consignee_key,
      min(f.consignee_name) as consignee_name,min(f.customer_id) as customer_id,min(f.consignee_id) as consignee_id
    from filtered f
    where operation in ('customers','consignees','reps','folders','months')
    group by case operation when 'customers' then f.customer_key when 'consignees' then f.full_consignee_key
      when 'folders' then f.full_consignee_key
      when 'months' then 'month:'||coalesce(to_char(f.created_at at time zone 'America/Chicago','YYYY-MM'),'unknown')
      else 'rep:'||coalesce(f.owner_id::text,'unassigned') end
  ), directory_groups as (
    select case operation when 'customers' then m.customer_key when 'consignees' then m.full_consignee_key
      else m.full_consignee_key end as key,
      case operation when 'consignees' then m.consignee_name else m.customer_name end as label,
      0::bigint as requests,0::numeric as amount,0::bigint as unpriced,
      m.customer_key,m.full_consignee_key as consignee_key,m.consignee_name,m.customer_id,m.consignee_id
    from mapped_folders m where operation in ('customers','consignees','folders')
      and (operation<>'consignees' or m.customer_key=customer_filter)
      and (customer_filter is null or m.customer_key=customer_filter)
      and (consignee_filter is null or m.full_consignee_key=consignee_filter)
    union all
    select 'rep:'||p.id::text,coalesce(nullif(p.display_name,''),p.username),0,0,0,null,null,null,null,null
    from public.profiles p where operation='reps' and p.disabled_at is null and not coalesce(p.must_change_password,true)
      and (p.locked_until is null or p.locked_until<=statement_timestamp())
      and (global_scope and (sales_private.is_rep(p.role) or p.username in ('ben_brown','chance_alldredge')) or not global_scope and p.id=actor_id)
      and (rep_filter is null or 'rep:'||p.id::text=rep_filter)
  ), group_data as (
    select key,min(label) as label,sum(requests)::bigint as requests,sum(amount) as amount,sum(unpriced)::bigint as unpriced,
      min(customer_key) as customer_key,min(consignee_key) as consignee_key,min(consignee_name) as consignee_name,
      min(customer_id) as customer_id,min(consignee_id) as consignee_id
    from (select * from record_groups union all select * from directory_groups) g group by key
  ), group_page as (
    select g.*
    from group_data g order by case when global_scope then g.amount end desc,g.label,g.key
    offset page_value*page_size_value limit page_size_value
  ), request_page as (
    select f.* from filtered f
    where operation='requests'
    order by f.created_at desc nulls last,f.unique_id desc
    offset page_value*page_size_value limit page_size_value
  )
  select (select requests from summary_data),(select amount from summary_data),(select unpriced from summary_data),
    case when operation='summary' then 0
      when operation='requests' then (select count(*) from filtered)
      else (select count(*) from group_data) end,
    case when operation='summary' then '[]'::jsonb
      when operation='requests' then coalesce((select jsonb_agg(jsonb_build_object(
        'id',f.unique_id,'customerName',f.customer_name,'consigneeName',f.consignee_name,
        'salesrepUserId',f.owner_id::text,'salesrepName',f.rep_name,'itemcode',coalesce(f.itemcode,''),
        'commonname',coalesce(f.commonname,''),'location',coalesce(f.locationcode,''),'requestedAt',f.created_at,
        'status',coalesce(f.req_status,'Pending'),
        'requestQty',case when f.parsed_qty<0 then null else f.parsed_qty end,
        'effectiveQty',case when f.unresolved_reason='invalid_request_quantity' then null else f.effective_qty end,
        'listPrice',case when global_scope and f.parsed_price>=0 then f.parsed_price else null end,
        'totalValue',case when global_scope then f.total_value else null end,
        'unresolvedReason',case when global_scope then f.unresolved_reason else null end,
        'dock',f.dock,'spec',coalesce(nullif(f.details->>'req_spec',''),f.details->>'desired_spec',''),
        'caliper',coalesce(nullif(f.details->>'req_caliper',''),f.details->>'desired_caliper',''),
        'comments',coalesce(f.details->>'req_comments',''),'photoNotes',coalesce(f.details->>'req_pic_note',''),
        'photoLinks',jsonb_build_array(nullif(f.details->>'req_photo_link',''),nullif(f.details->>'photo_link','')),
        'sentAt',coalesce(private.try_timestamptz(f.details->>'date_completed'),private.try_timestamptz(f.details->>'sent_at')),
        'deliveryState',coalesce(f.details->>'delivery_state','unknown'))
        order by f.created_at desc nulls last,f.unique_id desc) from request_page f),'[]'::jsonb)
      else coalesce((select jsonb_agg(jsonb_build_object('key',g.key,'label',g.label,'requestCount',g.requests,
        'totalValue',case when global_scope then g.amount else null end,
        'unpricedCount',case when global_scope then g.unpriced else null end,
        'customerKey',case when operation in ('customers','consignees','folders') then g.customer_key else null end,
        'consigneeKey',case when operation in ('consignees','folders') then g.consignee_key else null end,
        'consigneeName',case when operation in ('consignees','folders') then g.consignee_name else null end,
        'customerId',case when operation in ('customers','consignees','folders') then g.customer_id else null end,
        'consigneeId',case when operation in ('consignees','folders') then g.consignee_id else null end)
        order by case when global_scope then g.amount end desc,g.label,g.key) from group_page g),'[]'::jsonb)
    end
    into request_total,value_total,unpriced_total,row_total,rows_value;

  return jsonb_build_object('ok',true,'scope',case when global_scope then 'all' else 'own' end,
    'financials',global_scope,'recordKind',record_kind,'ownRepKey','rep:'||actor_id::text,
    'revision','history-v3:'||md5(actor.username||':'||actor.role)||':'||coalesce(revision_value,''),'generatedAt',generated_at,'page',page_value,'pageSize',page_size_value,
    'total',row_total,'rows',rows_value,
    'summary',jsonb_build_object('requestCount',request_total,
      'totalValue',case when global_scope then value_total else null end,
      'unpricedCount',case when global_scope then unpriced_total else null end));
end
$function$;
revoke all on function public.historical_requests_read_v1(jsonb) from public,anon,service_role;
grant execute on function public.historical_requests_read_v1(jsonb) to authenticated;

comment on function public.historical_requests_read_v1(jsonb) is
  'Owner-scoped requests and orders; designated-admin financial reports use current catalog item-code prices with Chicago calendar date boundaries.';


-- A read-only Orders projection applies the same owner gate. The security
-- barrier prevents user predicates from being pushed ahead of authorization.
create or replace view public.ph_historical_orders with (security_barrier=true) as
with source as (
  select h.unique_id,h.assigned_rep_id,h.customeridentityid,h.customername,h.consigneeidentityid,h.consigneename,
    h.itemcode,h.commonname,h.req_qty,h.req_spec,h.req_photo_link,h.date_completed::text as date_completed,h.delivery_state,
    coalesce(a.dock::text,h.snapshot->>'dock') as dock
  from public.ph_request_history h left join public.ph_active_request a on a.unique_id=h.unique_id
  union all
  select a.unique_id,sales_private.assigned_rep(to_jsonb(a)),a.customeridentityid,a.customername,a.consigneeidentityid,a.consigneename,
    a.itemcode,a.commonname,a.req_qty,a.req_spec,a.req_photo_link,a.date_completed::text,'unknown'::text,a.dock::text
  from public.ph_active_request a where not exists(select 1 from public.ph_request_history h where h.unique_id=a.unique_id)
)
select * from source s where s.dock is not null and private.can_read_sales_history_v1(s.assigned_rep_id);
revoke all on public.ph_historical_orders from public,anon,authenticated,service_role;
grant select on public.ph_historical_orders to authenticated;

commit;
