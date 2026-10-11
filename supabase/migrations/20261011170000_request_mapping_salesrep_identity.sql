begin;
set local lock_timeout = '5s';

alter table public.ph_active_request add column if not exists request_selected_salesrep_id text;

-- External rep IDs are text and belong to imported relationships, not UUID
-- profiles. The verified identity directory owns the existing profile FK.
create or replace function sales_private.request_mapping_rep_allowed_v1(p_actor_id uuid, p_salesrep_id text)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (
    select 1 from public.profiles actor
    where actor.id=p_actor_id and actor.disabled_at is null and not actor.must_change_password
      and (actor.locked_until is null or actor.locked_until<=clock_timestamp())
      and (
        (upper(btrim(actor.role)) not in ('REP','SALESREP','SALES')
          and actor.username not in ('ben_brown','chance_alldredge'))
        or exists(select 1 from sales_private.rep_identities identity
          where identity.kind='external_id' and identity.identity_key=sales_private.key(p_salesrep_id)
            and identity.profile_id=actor.id)
      )
  )
$function$;
revoke all on function sales_private.request_mapping_rep_allowed_v1(uuid,text) from public,anon,authenticated;

-- Preserve the existing management permissions and projections. Apply the
-- ownership predicate to BOTH the count and the returned options page.
do $upgrade_options$
declare source text;
begin
  source:=pg_get_functiondef('public.customer_rep_mapping_manage_v1(uuid,text,jsonb)'::regprocedure);
  if position('request_mapping_rep_allowed_v1' in source)=0 then
    if position('and (salesrep_filter is null or m.salesrepid=salesrep_filter)' in source)=0 then
      raise exception 'REQUEST_MAPPING_OPTIONS_UPGRADE_SHAPE_INVALID';
    end if;
    source:=replace(source,'and (salesrep_filter is null or m.salesrepid=salesrep_filter)',
      'and (salesrep_filter is null or btrim(m.salesrepid)=salesrep_filter) and sales_private.request_mapping_rep_allowed_v1(p_actor_id,m.salesrepid)');
    execute source;
  end if;
end
$upgrade_options$;

-- Keep the existing batch transaction, idempotency, actor stamping and
-- delivery behavior; append the new identity to its existing row projection.
do $upgrade_batch$
declare source text;
begin
  source:=pg_get_functiondef('private.insert_request_batch(uuid,jsonb,text)'::regprocedure);
  if position('request_selected_salesrep_id' in source)=0 then
    if position('request_selected_rep_username, request_selected_rep_display,' in source)=0
      or position('entry->>''request_selected_rep_display'', entry->>''request_selected_rep_email'',' in source)=0 then
      raise exception 'REQUEST_MAPPING_BATCH_UPGRADE_SHAPE_INVALID';
    end if;
    source:=replace(source,'request_selected_rep_username, request_selected_rep_display,',
      'request_selected_rep_username, request_selected_rep_display, request_selected_salesrep_id,');
    source:=replace(source,'entry->>''request_selected_rep_display'', entry->>''request_selected_rep_email'',',
      'entry->>''request_selected_rep_display'', entry->>''request_selected_salesrep_id'', entry->>''request_selected_rep_email'',');
    execute source;
  end if;
end
$upgrade_batch$;

create or replace function sales_private.require_active_customer_mapping_for_request_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare matches integer; selected_id text; caller_id uuid:=auth.uid();
begin
  if tg_op='UPDATE' and
    (old.customeridentityid,old.customername,old.consigneeidentityid,old.consigneename,
      old.requested_by,old.request_selected_rep_username,old.request_selected_rep_display,old.request_source,old.request_selected_salesrep_id)
    is not distinct from
    (new.customeridentityid,new.customername,new.consigneeidentityid,new.consigneename,
      new.requested_by,new.request_selected_rep_username,new.request_selected_rep_display,new.request_source,new.request_selected_salesrep_id) then
    return new;
  elsif tg_op='INSERT' and exists(select 1 from public.ph_active_request existing where existing.unique_id=new.unique_id) then
    return new;
  end if;
  if lower(btrim(coalesce(new.request_source,''))) not in ('general','av') then
    if coalesce(auth.role(),'')='service_role' then return new; end if;
    raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED';
  end if;
  if nullif(btrim(new.customeridentityid),'') is null or nullif(btrim(new.consigneeidentityid),'') is null
    or nullif(btrim(new.customername),'') is null or nullif(btrim(new.consigneename),'') is null then
    raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED';
  end if;
  select count(distinct btrim(mapping.salesrepid)), min(btrim(mapping.salesrepid)) into matches,selected_id
  from public.ph_customer_consignee_sales_reps mapping
  where btrim(mapping.customeridentityid)=btrim(new.customeridentityid)
    and btrim(mapping.consigneeid)=btrim(new.consigneeidentityid)
    and lower(btrim(mapping.customername))=lower(btrim(new.customername))
    and lower(btrim(mapping.consigneename))=lower(btrim(new.consigneename))
    and nullif(btrim(mapping.salesrepid),'') is not null
    and upper(btrim(mapping.customerstatus))='A' and upper(btrim(mapping.consigneestatus))='A'
    and (case when nullif(btrim(new.request_selected_salesrep_id),'') is not null
      then btrim(mapping.salesrepid)=btrim(new.request_selected_salesrep_id)
      else sales_private.rep_name_key(mapping.salesrepname)=sales_private.rep_name_key(
        coalesce(nullif(btrim(new.request_selected_rep_display),''),nullif(btrim(new.request_selected_rep_username),''),new.requested_by)) end)
    and (caller_id is null or sales_private.request_mapping_rep_allowed_v1(caller_id,mapping.salesrepid))
    and (nullif(btrim(new.request_selected_rep_username),'') is null or exists(
      select 1 from sales_private.rep_identities identity join public.profiles rep on rep.id=identity.profile_id
      where identity.kind='external_id' and identity.identity_key=sales_private.key(mapping.salesrepid)
        and sales_private.identity_key(rep.username)=sales_private.identity_key(new.request_selected_rep_username)
        and rep.disabled_at is null and not rep.must_change_password
        and (rep.locked_until is null or rep.locked_until<=clock_timestamp())));
  if matches<>1 then raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED'; end if;
  new.request_selected_salesrep_id:=selected_id;
  return new;
end
$function$;
revoke all on function sales_private.require_active_customer_mapping_for_request_v1() from public,anon,authenticated;
drop trigger if exists require_active_customer_mapping_for_request_update_v1 on public.ph_active_request;
create trigger require_active_customer_mapping_for_request_update_v1
  before update of customeridentityid,customername,consigneeidentityid,consigneename,requested_by,
    request_selected_rep_username,request_selected_rep_display,request_source,request_selected_salesrep_id
  on public.ph_active_request for each row execute function sales_private.require_active_customer_mapping_for_request_v1();

-- Append to both live read projections without dropping dependent views or
-- changing the existing invoker/RLS behavior.
do $upgrade_views$
declare view_name text; source text;
begin
  foreach view_name in array array['ph_active_request_live_rows','ph_request_queue_live_rows'] loop
    if not exists(select 1 from information_schema.columns where table_schema='public' and table_name=view_name and column_name='request_selected_salesrep_id') then
      source:=rtrim(pg_get_viewdef(('public.'||view_name)::regclass,true), E';\n ');
      execute format('create or replace view public.%I with (security_invoker=true) as select existing.*,request.request_selected_salesrep_id from (%s) existing left join public.ph_active_request request on request.unique_id=existing.unique_id',view_name,source);
    end if;
  end loop;
end
$upgrade_views$;

commit;
