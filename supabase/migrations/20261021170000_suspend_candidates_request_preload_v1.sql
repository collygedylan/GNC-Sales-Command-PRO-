begin;
set local lock_timeout='5s';
set local statement_timeout='20s';

-- Compact authorized Request choices; resolve rep ownership once per rep, not per mapping row.
CREATE OR REPLACE FUNCTION sales_private.request_mapping_rep_allowed_v1(p_actor_id uuid, p_salesrep_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles actor
    where actor.id=p_actor_id and actor.disabled_at is null and not actor.must_change_password
      and (actor.locked_until is null or actor.locked_until<=clock_timestamp())
      and (
        (upper(regexp_replace(actor.role,'[[:space:]_]','','g')) not in ('REP','SALESREP','SALES')
          and actor.username not in ('ben_brown','chance_alldredge'))
        or exists(select 1 from sales_private.rep_identities identity
          where identity.kind='external_id' and identity.identity_key=sales_private.key(p_salesrep_id)
            and identity.profile_id=actor.id)
      )
  )
$function$
;
CREATE OR REPLACE FUNCTION public.customer_rep_mapping_manage_v1(p_actor_id uuid, p_operation text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.profiles;
  operation text := lower(btrim(coalesce(p_operation, '')));
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  row_value public.ph_customer_consignee_sales_reps;
  target_uid text;
  expected_revision bigint;
  page_value integer;
  page_size_value integer;
  sort_value text;
  direction_value text;
  filters jsonb;
  query_value text;
  salesrep_filter text;
  customer_filter text;
  consignee_filter text;
  total_value bigint;
  rows_value jsonb;
  new_salesrep_id text;
  new_salesrep_name text;
  new_customer_name text;
  new_consignee_name text;
  actor_username text;
  duplicate_count integer;
  customer_identity uuid;
  row_offset integer;
  request_replay jsonb;
  response_value jsonb;
  source_count integer;
  source_row sales_private.customer_rep_assignment_sources;
  override_row sales_private.customer_rep_assignment_overrides;
begin
  if jsonb_typeof(payload) <> 'object' then raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_PAYLOAD_INVALID'; end if;
  select * into actor from public.profiles p
  where p.id = p_actor_id and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= clock_timestamp())
    and not p.must_change_password;
  if actor.id is null then raise exception using errcode='42501', message='CUSTOMER_REP_MAPPING_PROFILE_INACTIVE'; end if;
  if operation not in ('options','preload') and coalesce(upper(btrim(actor.role)),'') not in ('ADMIN','ADMINISTRATOR','MANAGER') then
    raise exception using errcode='42501', message='CUSTOMER_REP_MAPPING_FORBIDDEN';
  end if;
  actor_username := actor.username;
  if operation in ('save', 'assign', 'reset') and payload ? 'requestId' then
    request_replay := sales_private.customer_rep_assignment_receipt_replay_v1(p_actor_id, payload->>'requestId', payload || jsonb_build_object('operation',operation));
    if request_replay is not null then return request_replay; end if;
  end if;

  if operation = 'preload' then
    if payload <> '{}'::jsonb then raise exception 'CUSTOMER_REP_MAPPING_PAYLOAD_INVALID' using errcode='22023'; end if;
    with rep_ids as materialized (select distinct m.salesrepid from public.ph_customer_consignee_sales_reps m where nullif(btrim(m.salesrepid),'') is not null),
    allowed as materialized (select salesrepid from rep_ids where sales_private.request_mapping_rep_allowed_v1(p_actor_id,salesrepid)),
    active as materialized (
      select distinct m.salesrepid,m.salesrepname,m.customeridentityid,m.customername,m.consigneeid,m.consigneename
      from public.ph_customer_consignee_sales_reps m join allowed a using(salesrepid)
      where upper(btrim(coalesce(m.customerstatus,'')))='A' and upper(btrim(coalesce(m.consigneestatus,'')))='A'
        and nullif(btrim(m.customeridentityid),'') is not null and nullif(btrim(m.consigneeid),'') is not null
        and nullif(btrim(m.salesrepname),'') is not null),
    grouped as (select salesrepid,min(salesrepname) salesrepname,jsonb_agg(jsonb_build_array(customeridentityid,customername,consigneeid,consigneename)
      order by (upper(customername)='N/A') desc,customername,(upper(consigneename)='N/A') desc,consigneename) rows,count(*) total
      from active group by salesrepid)
    select jsonb_build_object('ok',true,'reps',coalesce(jsonb_agg(to_jsonb(grouped)-'total' order by salesrepname),'[]'::jsonb),
      'total',coalesce(sum(total),0),'revision',coalesce((select revision::text from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps'),'0'))
      into response_value from grouped;
    return response_value;
  end if;

  if operation = 'options' then
    if payload - array['operation','page','pageSize','q','salesrepId','customerId','consigneeId'] <> '{}'::jsonb then raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_PAYLOAD_INVALID'; end if;
    page_value := coalesce((payload->>'page')::integer,0);
    page_size_value := coalesce((payload->>'pageSize')::integer,100);
    query_value := left(btrim(coalesce(payload->>'q','')),120);
    salesrep_filter := nullif(btrim(payload->>'salesrepId'),'');
    customer_filter := nullif(btrim(payload->>'customerId'),'');
    consignee_filter := nullif(btrim(payload->>'consigneeId'),'');
    if page_value<0 or page_value>1000 or page_size_value<1 or page_size_value>200 then
      raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_FILTER_INVALID';
    end if;
    row_offset := page_value*page_size_value;
    select count(*) into total_value
    from public.ph_customer_consignee_sales_reps m
    where upper(btrim(coalesce(m.customerstatus,'')))='A'
      and upper(btrim(coalesce(m.consigneestatus,'')))='A'
      and nullif(btrim(m.salesrepid),'') is not null
      and nullif(btrim(m.customeridentityid),'') is not null
      and nullif(btrim(m.consigneeid),'') is not null
      and (salesrep_filter is null or btrim(m.salesrepid)=salesrep_filter) and sales_private.request_mapping_rep_allowed_v1(p_actor_id,m.salesrepid)
      and (customer_filter is null or m.customeridentityid=customer_filter)
      and (consignee_filter is null or m.consigneeid=consignee_filter)
      and (query_value='' or concat_ws(' ',m.salesrepid,m.salesrepname,m.customername,m.consigneename,
        m.customeridentityid,m.consigneeid) ilike '%'||replace(replace(query_value,'\','\\'),'%','\%')||'%');
    select coalesce(jsonb_agg(jsonb_build_object(
      'salesrepid', selected.salesrepid, 'salesrepname', selected.salesrepname,
      'customeridentityid', selected.customeridentityid, 'customername', selected.customername,
      'consigneeid', selected.consigneeid, 'consigneename', selected.consigneename,
      'customerstatus', selected.customerstatus, 'consigneestatus', selected.consigneestatus
    ) order by selected.salesrepname, selected.customername, selected.consigneename, selected.unique_id), '[]'::jsonb)
    into rows_value
    from (
      select m.salesrepid,m.salesrepname,m.customeridentityid,m.customername,m.consigneeid,m.consigneename,
        m.customerstatus,m.consigneestatus,m.unique_id
      from public.ph_customer_consignee_sales_reps m
      where upper(btrim(coalesce(m.customerstatus,'')))='A'
        and upper(btrim(coalesce(m.consigneestatus,'')))='A'
        and nullif(btrim(m.salesrepid),'') is not null
        and nullif(btrim(m.customeridentityid),'') is not null
        and nullif(btrim(m.consigneeid),'') is not null
        and (salesrep_filter is null or btrim(m.salesrepid)=salesrep_filter) and sales_private.request_mapping_rep_allowed_v1(p_actor_id,m.salesrepid)
        and (customer_filter is null or m.customeridentityid=customer_filter)
        and (consignee_filter is null or m.consigneeid=consignee_filter)
        and (query_value='' or concat_ws(' ',m.salesrepid,m.salesrepname,m.customername,m.consigneename,
          m.customeridentityid,m.consigneeid) ilike '%'||replace(replace(query_value,'\','\\'),'%','\%')||'%')
      order by m.salesrepname, m.customername, m.consigneename, m.unique_id
      limit page_size_value offset row_offset
    ) selected;
    return jsonb_build_object('ok',true,'rows',rows_value,'total',total_value,
      'page',page_value,'pageSize',page_size_value,
      'revision',coalesce((select r.revision::text from public.app_dataset_revisions r where r.key='ph_customer_consignee_sales_reps'),'0'));

  elsif operation = 'reps' then
    if payload - array['operation','page','pageSize','q'] <> '{}'::jsonb then
      raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_PAYLOAD_INVALID';
    end if;
    page_value := coalesce((payload->>'page')::integer,0);
    page_size_value := coalesce((payload->>'pageSize')::integer,100);
    query_value := left(btrim(coalesce(payload->>'q','')),120);
    if page_value<0 or page_value>1000 or page_size_value<1 or page_size_value>200 then
      raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_FILTER_INVALID';
    end if;
    select count(*) into total_value from (
      select s.salesrepid from sales_private.customer_rep_assignment_sources s
      where sales_private.customer_rep_assignment_rep_allowed_v1(s.salesrepid,s.salesrepname)
        and (query_value='' or concat_ws(' ',s.salesrepid,s.salesrepname) ilike '%'||replace(replace(query_value,'\','\\'),'%','\%')||'%')
      group by s.salesrepid having count(distinct s.salesrepname)=1
    ) reps;
    select coalesce(jsonb_agg(jsonb_build_object('salesrepId',p.salesrepid,'salesrepName',p.salesrepname)
      order by p.salesrepname,p.salesrepid),'[]'::jsonb) into rows_value
    from (
      select s.salesrepid,min(s.salesrepname) as salesrepname
      from sales_private.customer_rep_assignment_sources s
      where sales_private.customer_rep_assignment_rep_allowed_v1(s.salesrepid,s.salesrepname)
        and (query_value='' or concat_ws(' ',s.salesrepid,s.salesrepname) ilike '%'||replace(replace(query_value,'\','\\'),'%','\%')||'%')
      group by s.salesrepid having count(distinct s.salesrepname)=1
      order by min(s.salesrepname),s.salesrepid limit page_size_value offset page_value*page_size_value
    ) p;
    return jsonb_build_object('ok',true,'rows',rows_value,'total',total_value,'page',page_value,'pageSize',page_size_value,
      'revision',coalesce((select r.revision::text from public.app_dataset_revisions r where r.key='ph_customer_consignee_sales_reps'),'0'));
  elsif operation = 'assign' then
    if payload - array['operation','id','expectedRevision','requestId','salesrepId'] <> '{}'
      or nullif(btrim(payload->>'id'),'') is null
      or coalesce(payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,18}$'
      or coalesce(payload->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or nullif(btrim(payload->>'salesrepId'),'') is null then
      raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_PAYLOAD_INVALID';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('customer-rep-map-import',615738));
    select * into row_value from public.ph_customer_consignee_sales_reps m where m.unique_id=payload->>'id' for update;
    if not found then raise exception using errcode='P0002',message='CUSTOMER_REP_MAPPING_NOT_FOUND'; end if;
    if row_value.mapping_revision<>(payload->>'expectedRevision')::bigint then raise exception using errcode='40001',message='CUSTOMER_REP_MAPPING_CONFLICT'; end if;
    if nullif(btrim(row_value.customeridentityid),'') is null or nullif(btrim(row_value.consigneeid),'') is null then
      raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_IDENTITY_MISSING'; end if;
    select count(*) into source_count from public.ph_customer_consignee_sales_reps m
      where m.customeridentityid=row_value.customeridentityid and m.consigneeid=row_value.consigneeid;
    if source_count<>1 then raise exception using errcode='23505',message='CUSTOMER_REP_MAPPING_CONFLICT'; end if;
    select * into source_row from sales_private.customer_rep_assignment_sources s
      where s.salesrepid=btrim(payload->>'salesrepId')
        and sales_private.customer_rep_assignment_rep_allowed_v1(s.salesrepid,s.salesrepname)
      limit 1;
    if not found then raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED'; end if;
    insert into sales_private.customer_rep_assignment_overrides(customeridentityid,consigneeid,salesrepid,salesrepname,updated_by,updated_at)
      values(row_value.customeridentityid,row_value.consigneeid,source_row.salesrepid,source_row.salesrepname,actor_username,clock_timestamp())
      on conflict(customeridentityid,consigneeid) do update set salesrepid=excluded.salesrepid,salesrepname=excluded.salesrepname,
        updated_by=excluded.updated_by,updated_at=excluded.updated_at;
    update public.ph_customer_consignee_sales_reps m set salesrepid=source_row.salesrepid,salesrepname=source_row.salesrepname,
      mapping_revision=m.mapping_revision+1,mapping_updated_by=actor_username,updated_at=clock_timestamp(),
      row_hash='mapping-edit-pending:'||(m.mapping_revision+1)::text where m.unique_id=row_value.unique_id returning * into row_value;
    response_value:=jsonb_build_object('ok',true,'row',sales_private.customer_rep_assignment_row_v1(row_value.unique_id),
      'revision',row_value.mapping_revision::text);
    perform sales_private.customer_rep_assignment_receipt_store_v1(p_actor_id,payload->>'requestId',payload || jsonb_build_object('operation',operation),response_value);
    return response_value;
  elsif operation = 'reset' then
    if payload - array['operation','id','expectedRevision','requestId'] <> '{}'
      or nullif(btrim(payload->>'id'),'') is null
      or coalesce(payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,18}$'
      or coalesce(payload->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_PAYLOAD_INVALID';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('customer-rep-map-import',615738));
    select * into row_value from public.ph_customer_consignee_sales_reps m where m.unique_id=payload->>'id' for update;
    if not found then raise exception using errcode='P0002',message='CUSTOMER_REP_MAPPING_NOT_FOUND'; end if;
    if row_value.mapping_revision<>(payload->>'expectedRevision')::bigint then raise exception using errcode='40001',message='CUSTOMER_REP_MAPPING_CONFLICT'; end if;
    select count(*) into source_count from sales_private.customer_rep_assignment_sources s
      where s.customeridentityid=row_value.customeridentityid and s.consigneeid=row_value.consigneeid;
    if source_count<>1 then raise exception using errcode='P0002',message='CUSTOMER_REP_MAPPING_NOT_FOUND'; end if;
    select * into source_row from sales_private.customer_rep_assignment_sources s
      where s.customeridentityid=row_value.customeridentityid and s.consigneeid=row_value.consigneeid;
    delete from sales_private.customer_rep_assignment_overrides o
      where o.customeridentityid=row_value.customeridentityid and o.consigneeid=row_value.consigneeid;
    update public.ph_customer_consignee_sales_reps m set salesrepid=source_row.salesrepid,salesrepname=source_row.salesrepname,
      mapping_revision=m.mapping_revision+1,mapping_updated_by=null,updated_at=clock_timestamp(),
      row_hash='mapping-edit-pending:'||(m.mapping_revision+1)::text where m.unique_id=row_value.unique_id returning * into row_value;
    response_value:=jsonb_build_object('ok',true,'row',sales_private.customer_rep_assignment_row_v1(row_value.unique_id),
      'revision',row_value.mapping_revision::text);
    perform sales_private.customer_rep_assignment_receipt_store_v1(p_actor_id,payload->>'requestId',payload || jsonb_build_object('operation',operation),response_value);
    return response_value;
  elsif operation = 'detail' then
  
    if payload - array['operation','id'] <> '{}'::jsonb or nullif(payload->>'id','') is null then
      raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_PAYLOAD_INVALID';
    end if;
    select * into row_value from public.ph_customer_consignee_sales_reps m where m.unique_id=payload->>'id';
    if not found then raise exception using errcode='P0002', message='CUSTOMER_REP_MAPPING_NOT_FOUND'; end if;
    return jsonb_build_object('ok',true,'row',jsonb_build_object(
      'unique_id',row_value.unique_id,'customeridentityid',row_value.customeridentityid,
      'consigneeid',row_value.consigneeid,'salesrepid',row_value.salesrepid,
      'salesrepname',row_value.salesrepname,'customername',row_value.customername,
      'consigneename',row_value.consigneename,'customerstatus',row_value.customerstatus,
      'consigneestatus',row_value.consigneestatus,'territorycode',row_value.territorycode,
      'territorydesc',row_value.territorydesc,'filename',row_value.filename,
      'source_file_name',row_value.source_file_name,'source_row_number',row_value.source_row_number,
      'raw_data',row_value.raw_data,'revision',row_value.mapping_revision::text,
      'updated_at',row_value.updated_at,'updated_by',row_value.mapping_updated_by
    ) || sales_private.customer_rep_assignment_metadata_v1(row_value.unique_id));
  elsif operation = 'list' then
    if payload - array['operation','page','pageSize','filters','sort','direction','q'] <> '{}'::jsonb then
      raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_PAYLOAD_INVALID';
    end if;
    page_value := coalesce((payload->>'page')::integer,0);
    page_size_value := coalesce((payload->>'pageSize')::integer,50);
    sort_value := coalesce(payload->>'sort','customername');
    direction_value := lower(coalesce(payload->>'direction','asc'));
    filters := coalesce(payload->'filters','{}'::jsonb);
    if jsonb_typeof(filters)<>'object' or page_value<0 or page_value>1000
      or page_size_value<1 or page_size_value>200
      or sort_value not in ('salesrepid','salesrepname','customername','consigneename')
      or direction_value not in ('asc','desc')
      or exists(select 1 from jsonb_object_keys(filters) k where k not in ('salesrepid','salesrepname','customername','consigneename','status'))
      or coalesce(filters->>'status','all') not in ('all','active','inactive','unassigned') then
      raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_FILTER_INVALID';
    end if;
    query_value := left(btrim(coalesce(payload->>'q','')),120);
    -- A dedicated filter field may be used independently of free-text search.
    with filtered as (
      select m.* from public.ph_customer_consignee_sales_reps m
      where (query_value='' or concat_ws(' ',m.salesrepid,m.salesrepname,m.customername,m.consigneename,
              m.customeridentityid,m.consigneeid) ilike '%'||replace(replace(query_value,'\','\\'),'%','\%')||'%')
        and (nullif(filters->>'salesrepid','') is null or lower(btrim(coalesce(m.salesrepid,'')))=lower(btrim(filters->>'salesrepid')))
        and (nullif(filters->>'salesrepname','') is null or lower(btrim(coalesce(m.salesrepname,'')))=lower(btrim(filters->>'salesrepname')))
        and (nullif(filters->>'customername','') is null or lower(btrim(coalesce(m.customername,''))) like '%'||lower(btrim(filters->>'customername'))||'%')
        and (nullif(filters->>'consigneename','') is null or lower(btrim(coalesce(m.consigneename,''))) like '%'||lower(btrim(filters->>'consigneename'))||'%')
        and case coalesce(filters->>'status','all')
          when 'active' then upper(btrim(coalesce(m.customerstatus,'')))='A' and upper(btrim(coalesce(m.consigneestatus,'')))='A'
          when 'inactive' then upper(btrim(coalesce(m.customerstatus,'')))<>'A' or upper(btrim(coalesce(m.consigneestatus,'')))<>'A'
          when 'unassigned' then nullif(btrim(coalesce(m.salesrepid,'')),'') is null and nullif(btrim(coalesce(m.salesrepname,'')),'') is null
          else true end
    )
    select count(*) into total_value from filtered;
    with filtered as (
      select m.* from public.ph_customer_consignee_sales_reps m
      where (query_value='' or concat_ws(' ',m.salesrepid,m.salesrepname,m.customername,m.consigneename,
              m.customeridentityid,m.consigneeid) ilike '%'||replace(replace(query_value,'\','\\'),'%','\%')||'%')
        and (nullif(filters->>'salesrepid','') is null or lower(btrim(coalesce(m.salesrepid,'')))=lower(btrim(filters->>'salesrepid')))
        and (nullif(filters->>'salesrepname','') is null or lower(btrim(coalesce(m.salesrepname,'')))=lower(btrim(filters->>'salesrepname')))
        and (nullif(filters->>'customername','') is null or lower(btrim(coalesce(m.customername,''))) like '%'||lower(btrim(filters->>'customername'))||'%')
        and (nullif(filters->>'consigneename','') is null or lower(btrim(coalesce(m.consigneename,''))) like '%'||lower(btrim(filters->>'consigneename'))||'%')
        and case coalesce(filters->>'status','all')
          when 'active' then upper(btrim(coalesce(m.customerstatus,'')))='A' and upper(btrim(coalesce(m.consigneestatus,'')))='A'
          when 'inactive' then upper(btrim(coalesce(m.customerstatus,'')))<>'A' or upper(btrim(coalesce(m.consigneestatus,'')))<>'A'
          when 'unassigned' then nullif(btrim(coalesce(m.salesrepid,'')),'') is null and nullif(btrim(coalesce(m.salesrepname,'')),'') is null
          else true end
    ), page_rows as (
      select row_number() over(order by
        case when sort_value='salesrepid' and direction_value='asc' then m.salesrepid end asc nulls last,
        case when sort_value='salesrepname' and direction_value='asc' then m.salesrepname end asc nulls last,
        case when sort_value='customername' and direction_value='asc' then m.customername end asc nulls last,
        case when sort_value='consigneename' and direction_value='asc' then m.consigneename end asc nulls last,
        case when sort_value='salesrepid' and direction_value='desc' then m.salesrepid end desc nulls last,
        case when sort_value='salesrepname' and direction_value='desc' then m.salesrepname end desc nulls last,
        case when sort_value='customername' and direction_value='desc' then m.customername end desc nulls last,
        case when sort_value='consigneename' and direction_value='desc' then m.consigneename end desc nulls last,
        m.unique_id) as ordinal, m.* from filtered m
      order by
        case when sort_value='salesrepid' and direction_value='asc' then m.salesrepid end asc nulls last,
        case when sort_value='salesrepname' and direction_value='asc' then m.salesrepname end asc nulls last,
        case when sort_value='customername' and direction_value='asc' then m.customername end asc nulls last,
        case when sort_value='consigneename' and direction_value='asc' then m.consigneename end asc nulls last,
        case when sort_value='salesrepid' and direction_value='desc' then m.salesrepid end desc nulls last,
        case when sort_value='salesrepname' and direction_value='desc' then m.salesrepname end desc nulls last,
        case when sort_value='customername' and direction_value='desc' then m.customername end desc nulls last,
        case when sort_value='consigneename' and direction_value='desc' then m.consigneename end desc nulls last,
        m.unique_id
      limit page_size_value offset page_value*page_size_value
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'unique_id',p.unique_id,'customeridentityid',p.customeridentityid,'consigneeid',p.consigneeid,
      'salesrepid',p.salesrepid,'salesrepname',p.salesrepname,'customername',p.customername,
      'consigneename',p.consigneename,'customerstatus',p.customerstatus,'consigneestatus',p.consigneestatus,
      'territorycode',p.territorycode,'territorydesc',p.territorydesc,
      'revision',p.mapping_revision::text,'updated_at',p.updated_at,'updated_by',p.mapping_updated_by
    ) || sales_private.customer_rep_assignment_metadata_v1(p.unique_id) order by p.ordinal), '[]'::jsonb) into rows_value from page_rows p;
    return jsonb_build_object('ok',true,'rows',rows_value,'total',total_value,'page',page_value,
      'pageSize',page_size_value,'revision',coalesce((select r.revision::text from public.app_dataset_revisions r where r.key='ph_customer_consignee_sales_reps'),'0'),
      'canEdit',true);
  elsif operation = 'save' then
    if payload - array['operation','id','expectedRevision','salesrepId','salesrepName','customerName','consigneeName','requestId'] <> '{}'::jsonb
      or nullif(btrim(payload->>'id'),'') is null
      or coalesce(payload->>'expectedRevision','') !~ '^[1-9][0-9]{0,18}$'
      or jsonb_typeof(payload->'salesrepId') not in ('string','null')
      or jsonb_typeof(payload->'salesrepName') not in ('string','null')
      or jsonb_typeof(payload->'customerName') not in ('string','null')
      or jsonb_typeof(payload->'consigneeName') not in ('string','null') then
      raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_PAYLOAD_INVALID';
    end if;
    target_uid := btrim(payload->>'id');
    expected_revision := (payload->>'expectedRevision')::bigint;
    new_salesrep_id := nullif(btrim(payload->>'salesrepId'),'');
    new_salesrep_name := nullif(btrim(payload->>'salesrepName'),'');
    new_customer_name := nullif(btrim(payload->>'customerName'),'');
    new_consignee_name := nullif(btrim(payload->>'consigneeName'),'');
    if length(coalesce(new_salesrep_id,''))>100 or length(coalesce(new_salesrep_name,''))>240
      or length(coalesce(new_customer_name,''))>300 or length(coalesce(new_consignee_name,''))>300
      or new_salesrep_id is null or new_salesrep_name is null or new_customer_name is null or new_consignee_name is null then
      raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_VALUE_INVALID';
    end if;
    -- Match the import finalizer's publication lock before taking row locks.
    -- This prevents save/import lock inversion while keeping app edits atomic.
    perform pg_advisory_xact_lock(hashtextextended('customer-rep-map-import',615738));
    select * into row_value from public.ph_customer_consignee_sales_reps m where m.unique_id=target_uid for update;
    if not found then raise exception using errcode='P0002', message='CUSTOMER_REP_MAPPING_NOT_FOUND'; end if;
    if row_value.mapping_revision <> expected_revision then raise exception using errcode='40001', message='CUSTOMER_REP_MAPPING_CONFLICT'; end if;
    if (new_salesrep_id,new_salesrep_name) is distinct from (row_value.salesrepid,row_value.salesrepname) then
      if not sales_private.customer_rep_assignment_rep_allowed_v1(new_salesrep_id,new_salesrep_name) then
        raise exception using errcode='22023',message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED'; end if;
      select count(*) into source_count from public.ph_customer_consignee_sales_reps m where m.customeridentityid=row_value.customeridentityid and m.consigneeid=row_value.consigneeid;
      if source_count<>1 then raise exception using errcode='23505',message='CUSTOMER_REP_MAPPING_CONFLICT'; end if;
      insert into sales_private.customer_rep_assignment_overrides(customeridentityid,consigneeid,salesrepid,salesrepname,updated_by,updated_at) values(row_value.customeridentityid,row_value.consigneeid,new_salesrep_id,new_salesrep_name,actor_username,clock_timestamp()) on conflict(customeridentityid,consigneeid) do update set salesrepid=excluded.salesrepid,salesrepname=excluded.salesrepname,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
    end if;
    if (row_value.salesrepid,row_value.salesrepname,row_value.customername,row_value.consigneename)
      is distinct from (new_salesrep_id,new_salesrep_name,new_customer_name,new_consignee_name) then
      if nullif(btrim(row_value.customeridentityid),'') is null or nullif(btrim(row_value.consigneeid),'') is null then
        raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_IDENTITY_MISSING';
      end if;
      if (new_salesrep_id,new_salesrep_name) is distinct from (row_value.salesrepid,row_value.salesrepname)
        and not sales_private.customer_rep_assignment_rep_allowed_v1(new_salesrep_id,new_salesrep_name) then
        raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED';
      end if;
      select count(*) into duplicate_count from public.ph_customer_consignee_sales_reps m
       where m.unique_id<>target_uid and lower(btrim(coalesce(m.salesrepid,'')))=lower(new_salesrep_id)
         and m.customeridentityid=row_value.customeridentityid and m.consigneeid=row_value.consigneeid;
      if duplicate_count>0 then raise exception using errcode='23505', message='CUSTOMER_REP_MAPPING_DUPLICATE'; end if;
    end if;
    update public.ph_customer_consignee_sales_reps m set
      salesrepid=new_salesrep_id, salesrepname=new_salesrep_name,
      customername=new_customer_name, consigneename=new_consignee_name,
      mapping_revision=m.mapping_revision+1, mapping_updated_by=actor_username,
      updated_at=clock_timestamp(), row_hash='mapping-edit-pending:'||(m.mapping_revision+1)::text
    where m.unique_id=target_uid returning * into row_value;
    response_value := jsonb_build_object('ok',true,'row',jsonb_build_object(
      'unique_id',row_value.unique_id,'customeridentityid',row_value.customeridentityid,'consigneeid',row_value.consigneeid,
      'salesrepid',row_value.salesrepid,'salesrepname',row_value.salesrepname,'customername',row_value.customername,
      'consigneename',row_value.consigneename,'customerstatus',row_value.customerstatus,'consigneestatus',row_value.consigneestatus,
      'territorycode',row_value.territorycode,'territorydesc',row_value.territorydesc,
      'revision',row_value.mapping_revision::text,'updated_at',row_value.updated_at,'updated_by',row_value.mapping_updated_by
    ) || sales_private.customer_rep_assignment_metadata_v1(row_value.unique_id),'revision',row_value.mapping_revision::text);
    perform sales_private.customer_rep_assignment_receipt_store_v1(p_actor_id,payload->>'requestId',payload || jsonb_build_object('operation',operation),response_value);
    return response_value;
  end if;
  raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_OPERATION_INVALID';
end
$function$
;

-- Persistent local decisions remain separate from the imported order quantity.
alter table public.ph_soc_master add column if not exists suspend_candidate_group text;
alter table public.ph_soc_master add column if not exists suspend_candidate_state text;
alter table public.ph_soc_master add column if not exists suspend_order_quantity text;
alter table public.ph_soc_master add column if not exists suspend_origin_uid text;
alter table suspend_tag_private.approvals add column if not exists selected_source_uid text;
create index if not exists soc_suspend_candidate_group_idx on public.ph_soc_master(suspend_candidate_group) where suspend_candidate_group is not null;

create or replace function suspend_tag_private.order_key(s public.ph_soc_master)
returns text language sql immutable set search_path='' as $fn$
 select coalesce(nullif(s.suspend_candidate_group,''),md5(jsonb_build_array(coalesce(nullif(s.dock_num,''),s.dock),s.stopnumber,
   s.transactionnumber,s.planstart,s.customeridentityid,s.customername,s.consigneeidentityid,s.consigneename,s.salesrepid,s.salesrepname,
   s.itemcode,coalesce(s.suspend_order_quantity,s.quantityordered),s.purchaseordernumber)::text))
$fn$;

create or replace function suspend_tag_private.rep_for_row(s public.ph_soc_master)
returns public.profiles language plpgsql stable security definer set search_path='' as $fn$
declare rep public.profiles; ids uuid[]; rep_name text;
begin
 select array_agg(distinct profile_id) into ids from sales_private.rep_identities
 where kind='external_id' and identity_key=sales_private.key(s.salesrepid);
 if coalesce(cardinality(ids),0)=0 then
   rep_name:=case when s.salesrepname like '%,%' then btrim(split_part(s.salesrepname,',',2))||' '||btrim(split_part(s.salesrepname,',',1)) else s.salesrepname end;
   select array_agg(p.id) into ids from public.profiles p where regexp_replace(lower(coalesce(rep_name,'')),'[^a-z0-9]','','g')<>''
    and (regexp_replace(lower(p.username),'[^a-z0-9]','','g')=regexp_replace(lower(rep_name),'[^a-z0-9]','','g')
      or regexp_replace(lower(coalesce(p.display_name,'')),'[^a-z0-9]','','g')=regexp_replace(lower(rep_name),'[^a-z0-9]','','g'));
 end if;
 if coalesce(cardinality(ids),0)<>1 then raise exception 'SUSPEND_TAG_REP_EMAIL_MISSING' using errcode='22023'; end if;
 return suspend_tag_private.active_profile(ids[1]);
end $fn$;

CREATE OR REPLACE FUNCTION suspend_tag_private.request_approval(p_uid text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  w suspend_tag_private.workflows;
  s public.ph_soc_master;
  rep public.profiles;
  sender public.profiles;
  completer public.profiles;
  sender_id uuid;
  rep_email text;
  sender_email text;
  target_username text;
  target_id uuid;
  target_email text;
  decision_emails text[] := array[]::text[];
  approval_id uuid := gen_random_uuid();
  event_id uuid;
  rep_key text;
  matches integer;
begin
  select * into s from public.ph_soc_master where unique_id = p_uid;
  select * into w from suspend_tag_private.workflows where source_uid = p_uid;
  if w.status = 'awaiting_rep' then return w.current_approval_id; end if;
  if w.status <> 'completed' or w.completed_by is null then
    raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode = '22023';
  end if;
  perform suspend_tag_private.validate_review(s);

  sender_id := nullif(current_setting('app.suspend_tag_actor_id', true), '')::uuid;
  if sender_id is null then sender_id := auth.uid(); end if;
  if sender_id is null then raise exception 'SUSPEND_TAG_SENDER_REQUIRED' using errcode = '42501'; end if;
  sender := suspend_tag_private.active_profile(sender_id);
  completer := suspend_tag_private.active_profile(w.completed_by);

  rep := suspend_tag_private.rep_for_row(s);
  select lower(email) into rep_email from auth.users where id = rep.id and email_confirmed_at is not null;
  select lower(email) into sender_email from auth.users where id = sender.id and email_confirmed_at is not null;
  if coalesce(rep_email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
      or coalesce(sender_email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'SUSPEND_TAG_RECIPIENT_EMAIL_MISSING' using errcode = '22023';
  end if;

  -- Freeze the request to the assigned Rep only. Freeze the response thread
  -- to the configured decision team plus the authenticated sender.
  decision_emails := array[sender_email];
  foreach target_username in array array['dan_mccuistion', 'dylan_collyge', 'megan_kelly', 'jd_jones'] loop
    select count(*) into matches from public.profiles p where lower(p.username) = lower(target_username);
    if matches <> 1 then raise exception 'SUSPEND_TAG_APPROVAL_RECIPIENT_MISSING' using errcode = '22023'; end if;
    select p.id, lower(u.email) into target_id, target_email
      from public.profiles p join auth.users u on u.id = p.id
     where lower(p.username) = lower(target_username) and u.email_confirmed_at is not null;
    if target_id is null or coalesce(target_email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
      raise exception 'SUSPEND_TAG_APPROVAL_RECIPIENT_MISSING' using errcode = '22023';
    end if;
    perform suspend_tag_private.active_profile(target_id);
    if not (target_email = any(decision_emails)) then decision_emails := array_append(decision_emails, target_email); end if;
    target_id := null;
    target_email := null;
  end loop;

  insert into suspend_tag_private.approvals(
    id, source_uid, source_revision, round, completed_by, sent_by, rep_id,
    snapshot, submitter_email, rep_email
  ) values (
    approval_id, p_uid, s.last_updated, w.round + 1, completer.id, sender.id, rep.id,
    to_jsonb(s) || jsonb_build_object(
      'completed_by_username', completer.username,
      'completed_by_display', coalesce(completer.display_name, completer.username),
      'sent_by_username', sender.username,
      'sent_by_display', coalesce(sender.display_name, sender.username),
      'rep_username', rep.username,
      'rep_display', coalesce(rep.display_name, rep.username)
    ),
    sender_email,
    rep_email
  );
  insert into suspend_tag_private.approval_recipients(approval_id, request_email, decision_emails)
    values(approval_id, rep_email, decision_emails);
  insert into public.ph_request_delivery_outbox(event_key, event_type, request_id, request_folder, payload)
    values('suspend-tag-request:' || approval_id, 'suspend_tag_approval_requested', approval_id::text,
      'suspend-tag-' || approval_id, jsonb_build_object('approval_id', approval_id))
    returning public.ph_request_delivery_outbox.event_id into event_id;
  update suspend_tag_private.approvals set request_event_id = event_id where id = approval_id;
  update suspend_tag_private.workflows
     set current_approval_id = approval_id, status = 'awaiting_rep', round = round + 1,
         version = version + 1, updated_at = now()
   where source_uid = p_uid;
  return approval_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION suspend_tag_private.command(p_actor_id uuid, p_operation text, p_payload jsonb, p_command_id uuid, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.profiles; s public.ph_soc_master; edited public.ph_soc_master; w suspend_tag_private.workflows;
  a suspend_tag_private.approvals; receipt suspend_tag_private.commands; input jsonb; result jsonb; patch jsonb;
  uid text; was_denied boolean; event_id uuid; approval_id uuid; decision text;
begin
  actor:=suspend_tag_private.actor(p_actor_id);
  if p_operation='approval' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or (a.rep_id<>actor.id and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion')) then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    return jsonb_build_object('approval',to_jsonb(a)-'submitter_email'-'rep_email','canDecide',(a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)) and a.status='pending'
      and exists(select 1 from suspend_tag_private.workflows x join public.ph_soc_master r on r.unique_id=x.source_uid
        where x.current_approval_id=a.id and x.status='awaiting_rep' and r.last_updated is not distinct from a.source_revision and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_operation<>'decide' and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
  if p_operation='rows' then
    return jsonb_build_object('rows',(select coalesce(jsonb_agg(suspend_tag_private.row_json(r.unique_id) order by r.unique_id),'[]') from public.ph_soc_master r
      where r.unique_id in (select jsonb_array_elements_text(p_payload->'ids')) and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  if p_command_id is null then raise exception 'SUSPEND_TAG_COMMAND_REQUIRED' using errcode='22023'; end if;
  input:=jsonb_build_object('operation',p_operation,'payload',p_payload,'version',p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended('suspend-tag-v2:'||actor.id||':'||p_command_id,0));
  select * into receipt from suspend_tag_private.commands where actor_id=actor.id and command_id=p_command_id;
  if found then
    if receipt.request<>input then raise exception 'SUSPEND_TAG_TOKEN_CONFLICT' using errcode='22023'; end if;
    return receipt.response;
  end if;
  uid:=p_payload->>'sourceUid';
  if p_operation='decide' then
    select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
    if a.id is null or (a.rep_id<>actor.id and not private.is_full_app_administrator_v1(actor.username)) then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
    uid:=a.source_uid;
  end if;
  if p_operation in ('save','complete') then
    perform pg_advisory_xact_lock(hashtextextended('suspend-tag-review-item:'||r.itemcode,0))
      from public.ph_soc_master r where r.unique_id=uid;
  end if;
  select * into s from public.ph_soc_master where unique_id=uid for update;
  if not found or not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
  insert into suspend_tag_private.workflows(source_uid,source_revision) values(uid,s.last_updated) on conflict do nothing;
  select * into w from suspend_tag_private.workflows where source_uid=uid for update;
  if p_operation='decide' then
    select * into a from suspend_tag_private.approvals where id=a.id for update;
    decision:=p_payload->>'decision';
    if decision not in ('approve','deny') or decision is null then raise exception 'SUSPEND_TAG_DECISION_INVALID' using errcode='22023'; end if;
    if a.source_revision is distinct from s.last_updated or w.current_approval_id is distinct from a.id then raise exception 'SUSPEND_TAG_APPROVAL_SUPERSEDED' using errcode='40001'; end if;
    if a.status<>'pending' then
      if a.status<>(case when decision='approve' then 'approved' else 'denied' end) then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='40001'; end if;
    else
      update suspend_tag_private.approvals set status=case when decision='approve' then 'approved' else 'denied' end,decided_at=now(),decided_by=actor.id where id=a.id returning * into a;
      update suspend_tag_private.workflows set status=a.status,version=version+1,updated_at=now() where source_uid=uid;
      if decision='deny' then update public.ph_soc_master set date_completed=null where unique_id=uid; end if;
      insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,push_delivered_at)
        values('suspend-tag-decision:'||a.id,'suspend_tag_approval_decided',a.id::text,'suspend-tag-'||a.id,jsonb_build_object('approval_id',a.id),now()) returning public.ph_request_delivery_outbox.event_id into event_id;
      update suspend_tag_private.approvals set decision_event_id=event_id where id=a.id;
    end if;
    result:=jsonb_build_object('ok',true,'decision',a.status,'approvalId',a.id);
  else
    if not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz then raise exception 'SUSPEND_TAG_SOURCE_CHANGED' using errcode='40001'; end if;
    if p_expected_version is not null and w.version<>p_expected_version then raise exception 'SUSPEND_TAG_VERSION_CHANGED' using errcode='40001'; end if;
    if w.source_revision is distinct from s.last_updated then
      update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
      update suspend_tag_private.workflows set source_revision=s.last_updated,status='pending',completed_by=null,completed_at=null,current_approval_id=null,version=version+1 where source_uid=uid returning * into w;
    end if;
    if p_operation in ('save','complete') then
      if w.status in ('awaiting_rep','approved') then raise exception 'SUSPEND_TAG_REVIEW_LOCKED' using errcode='42501'; end if;
      was_denied:=w.status='denied'; patch:=coalesce(p_payload->'patch','{}');
      if jsonb_typeof(patch)<>'object' or exists(select 1 from jsonb_object_keys(patch) k where k<>all(array['dock_spec','dock_caliper','dock_note','dock_photo_link','dock_photo_name','av_note','match','loc_match_qty','initial_ptr'])) then raise exception 'SUSPEND_TAG_FIELD_FORBIDDEN' using errcode='42501'; end if;
      edited:=jsonb_populate_record(s,patch);
      if p_operation='complete' then edited:=suspend_tag_private.existing_review(edited); end if;
      if p_operation='complete' then perform suspend_tag_private.validate_review(edited); end if;
      update public.ph_soc_master set dock_spec=edited.dock_spec,dock_caliper=edited.dock_caliper,dock_note=edited.dock_note,
        dock_photo_link=edited.dock_photo_link,dock_photo_name=edited.dock_photo_name,av_note=edited.av_note,match=edited.match,
        loc_match_qty=edited.loc_match_qty,initial_ptr=edited.initial_ptr where unique_id=uid returning * into s;
      -- Share evidence only; each physical tag keeps its own completion/approval state.
      update public.ph_soc_master sibling set
        dock_photo_link=coalesce(nullif(s.dock_photo_link,''),sibling.dock_photo_link),
        dock_photo_name=coalesce(nullif(s.dock_photo_name,''),sibling.dock_photo_name),
        dock_spec=coalesce(nullif(s.dock_spec,''),sibling.dock_spec),
        av_note=coalesce(nullif(s.av_note,''),sibling.av_note),
        match=coalesce(nullif(s.match,''),sibling.match)
      where sibling.itemcode=s.itemcode and sibling.unique_id<>uid
        and ((s.suspend_candidate_group is null and sibling.suspend_candidate_group is null)
          or (sibling.locationcode=s.locationcode and coalesce(sibling.lotcode,'')=coalesce(s.lotcode,'')))
        and suspend_tag_private.eligible(sibling.suspend,sibling.suspend_to)
        and sibling.date_completed is null
        and not exists(select 1 from suspend_tag_private.workflows locked
          where locked.source_uid=sibling.unique_id and locked.status in ('awaiting_rep','approved'));
      -- Sync only the exact inventory identity; lifecycle state stays in Suspend Tag.
      update public.ph_master_inventory m set spec=coalesce(nullif(s.dock_spec,''),m.spec),caliper=coalesce(nullif(s.dock_caliper,''),m.caliper),
        av_note=coalesce(nullif(s.av_note,''),m.av_note),match=coalesce(nullif(s.match,''),m.match),
        photo_link=coalesce(nullif(s.dock_photo_link,''),m.photo_link),photo_name=coalesce(nullif(s.dock_photo_name,''),m.photo_name),
        loc_match_qty=coalesce(nullif(s.loc_match_qty,''),m.loc_match_qty),initial_ptr=coalesce(nullif(s.initial_ptr,''),m.initial_ptr)
        where m.itemcode=s.itemcode and m.locationcode=s.locationcode and coalesce(m.lotcode,'')=coalesce(s.lotcode,'');
      if p_operation='complete' then
        update public.ph_soc_master set date_completed=clock_timestamp() where unique_id=uid returning * into s;
        update suspend_tag_private.workflows set status='completed',completed_by=actor.id,completed_at=s.date_completed,version=version+1,updated_at=now() where source_uid=uid;
        if was_denied then approval_id:=suspend_tag_private.request_approval(uid); end if;
      end if;
    elsif p_operation='send' then
      approval_id:=suspend_tag_private.request_approval(uid);
    elsif p_operation='retry' then
      if w.current_approval_id is null then raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode='22023'; end if;
      update public.ph_request_delivery_outbox as outbox set status='pending',next_attempt_at=now(),sanitized_error_code=null
        where outbox.event_id in(select request_event_id from suspend_tag_private.approvals where id=w.current_approval_id) and outbox.status='failed';
    else raise exception 'SUSPEND_TAG_OPERATION_INVALID' using errcode='22023';
    end if;
    result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
  end if;
  insert into suspend_tag_private.commands(actor_id,command_id,request,response) values(actor.id,p_command_id,input,result);
  return result;
end $function$
;

create or replace function suspend_tag_private.group_command(p_actor_id uuid,p_operation text,p_payload jsonb,p_command_id uuid,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $fn$
#variable_conflict use_column
declare actor public.profiles; s public.ph_soc_master; r public.ph_soc_master; m public.ph_master_inventory;
 a suspend_tag_private.approvals; w suspend_tag_private.workflows; receipt suspend_tag_private.commands;
 input jsonb; result jsonb; candidates jsonb; candidate jsonb; group_key text; uid text; candidate_uid text;
 chosen text; decision text; remaining integer; event_id uuid; ids text[]; stamp timestamptz:=clock_timestamp();
begin
 if p_operation not in ('add_candidates','send','approval','decide','inbox','close','dock_review') then
   return suspend_tag_private.command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_version);
 end if;
 actor:=suspend_tag_private.actor(p_actor_id);
 if p_operation='inbox' then
   return jsonb_build_object('approvals',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from
     (select a.id,a.status,a.snapshot,a.created_at from suspend_tag_private.approvals a where a.status='pending'
       and (a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)) order by a.created_at desc limit 100) x));
 end if;
 if p_operation in ('approval','decide') then
   select * into a from suspend_tag_private.approvals where id=(p_payload->>'approvalId')::uuid;
   if a.id is null or (a.rep_id<>actor.id and not private.is_full_app_administrator_v1(actor.username)
       and not (p_operation='approval' and actor.username='dan_mccuistion')) then
     raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
   end if;
   uid:=a.source_uid;
 else
   if p_operation='dock_review' then
     if not private.is_full_app_administrator_v1(actor.username)
       and regexp_replace(upper(actor.role),'[^A-Z]','','g') not in ('QCSUPERVISOR','QCSUP') then
       raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
   elsif actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
   uid:=p_payload->>'sourceUid';
 end if;
 select * into s from public.ph_soc_master where unique_id=uid;
 if s.unique_id is null then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
 group_key:=suspend_tag_private.order_key(s);
 if p_operation='approval' then
   candidates:=coalesce(a.snapshot->'candidates',jsonb_build_array(a.snapshot));
   select coalesce(jsonb_agg(candidate.value||jsonb_build_object('candidate_state',coalesce(r.suspend_candidate_state,'candidate'))),'[]') into candidates
    from jsonb_array_elements(candidates) candidate left join public.ph_soc_master r on r.unique_id=candidate.value->>'unique_id';
   return jsonb_build_object('approval',to_jsonb(a)-'submitter_email'-'rep_email','candidates',candidates,
     'canDecide',a.status='pending' and (a.rep_id=actor.id or private.is_full_app_administrator_v1(actor.username)));
 end if;
 if p_command_id is null then raise exception 'SUSPEND_TAG_COMMAND_REQUIRED' using errcode='22023'; end if;
 input:=jsonb_build_object('operation',p_operation,'payload',p_payload,'version',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended('suspend-tag-v2:'||actor.id||':'||p_command_id,0));
 select * into receipt from suspend_tag_private.commands where actor_id=actor.id and command_id=p_command_id;
 if found then
   if receipt.request<>input then raise exception 'SUSPEND_TAG_TOKEN_CONFLICT' using errcode='22023'; end if;
   return receipt.response;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('suspend-tag-review-item:'||s.itemcode,0));
 perform pg_advisory_xact_lock(hashtextextended('suspend-order:'||group_key,0));
 select * into s from public.ph_soc_master where unique_id=uid for update;
 if p_operation<>'decide' then
   if p_operation<>'dock_review' and not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
   if not (p_payload ? 'expectedLastUpdated') or s.last_updated is distinct from (p_payload->>'expectedLastUpdated')::timestamptz then
     raise exception 'SUSPEND_TAG_SOURCE_CHANGED' using errcode='40001'; end if;
   select * into w from suspend_tag_private.workflows where source_uid=uid for update;
   if p_expected_version is not null and coalesce(w.version,0)<>p_expected_version then raise exception 'SUSPEND_TAG_VERSION_CHANGED' using errcode='40001'; end if;
 end if;
 if p_operation='dock_review' then
   if suspend_tag_private.eligible(s.suspend,s.suspend_to) then
     raise exception 'SUSPEND_TAG_REVIEW_REQUIRED' using errcode='22023';
   end if;
   if jsonb_typeof(p_payload->'patch')<>'object' or exists(select 1 from jsonb_object_keys(p_payload->'patch') k
      where k<>all(array['dock_spec','dock_caliper','dock_note','dock_photo_link','dock_photo_name','date_completed','av_note','match','loc_match_qty','initial_ptr'])) then
     raise exception 'SUSPEND_TAG_FIELD_FORBIDDEN' using errcode='42501'; end if;
   r:=jsonb_populate_record(s,p_payload->'patch');
   update public.ph_soc_master set dock_spec=r.dock_spec,dock_caliper=r.dock_caliper,dock_note=r.dock_note,
      dock_photo_link=r.dock_photo_link,dock_photo_name=r.dock_photo_name,date_completed=r.date_completed,
      av_note=r.av_note,match=r.match,loc_match_qty=r.loc_match_qty,initial_ptr=r.initial_ptr where unique_id=uid;
   insert into suspend_tag_private.workflows(source_uid,source_revision,status)
      values(uid,s.last_updated,'pending') on conflict(source_uid) do update set version=suspend_tag_private.workflows.version+1,updated_at=stamp;
   result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
 elsif p_operation='add_candidates' then
   if jsonb_typeof(p_payload->'inventoryIds')<>'array' or jsonb_array_length(p_payload->'inventoryIds') not between 1 and 30 then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   select array_agg(distinct value) into ids from jsonb_array_elements_text(p_payload->'inventoryIds');
   if exists(select 1 from unnest(ids) x left join public.ph_master_inventory m on m.unique_id=x
      where m.unique_id is null or m.itemcode<>s.itemcode or nullif(btrim(m.locationcode),'') is null or m.locationcode='0.00.111') then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   if s.suspend_candidate_state in ('approved','denied','canceled','replaced') then raise exception 'SUSPEND_TAG_REVIEW_LOCKED' using errcode='42501'; end if;
   -- Supersede the prior frozen round before adding a new choice.
   update suspend_tag_private.approvals a set status='superseded' where a.status='pending' and a.id in
     (select w.current_approval_id from suspend_tag_private.workflows w join public.ph_soc_master r on r.unique_id=w.source_uid
       where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key);
   update public.ph_soc_master r set suspend_candidate_group=group_key,suspend_order_quantity=coalesce(r.suspend_order_quantity,r.quantityordered),
       suspend_origin_uid=coalesce(r.suspend_origin_uid,uid),suspend_candidate_state='candidate'
     where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key and suspend_tag_private.eligible(r.suspend,r.suspend_to);
   for m in select * from public.ph_master_inventory where unique_id=any(ids) order by unique_id loop
     if exists(select 1 from public.ph_soc_master r where r.suspend_candidate_group=group_key
         and r.locationcode=m.locationcode and coalesce(r.lotcode,'')=coalesce(m.lotcode,'') and r.suspend_candidate_state='candidate') then continue; end if;
     candidate_uid:='suspend-option-'||md5(group_key||':'||m.unique_id);
     r:=jsonb_populate_record(null::public.ph_soc_master,to_jsonb(s)||jsonb_build_object(
       'unique_id',candidate_uid,'source','Suspend Tag AV Option','locationcode',m.locationcode,'lotcode',m.lotcode,
       'last_updated',stamp,'date_completed',null,'quantityordered',coalesce(s.suspend_order_quantity,s.quantityordered),
       'quantityshipped','0','suspend','SUSPEND','suspend_to','dc','suspend_candidate_group',group_key,'suspend_candidate_state','candidate',
       'suspend_origin_uid',coalesce(s.suspend_origin_uid,uid),'suspend_order_quantity',coalesce(s.suspend_order_quantity,s.quantityordered),
       'ptronhand',m.ptronhand,'ptravailable',m.ptravailable,'ptrreviewed',m.ptrreviewed,'s_lts',m.s_lts,'priority',m.priority,
       'season',m.season,'dock_spec',m.spec,'dock_caliper',m.caliper,'av_note',m.av_note,'holdstopcode',m.holdstopcode,'holdstopreason',m.holdstopreason,
       'dock_photo_link',m.photo_link,'dock_photo_name',m.photo_name,'photo_link',m.photo_link,'photo_name',m.photo_name,'match',m.match,'loc_match_qty',m.loc_match_qty));
     insert into public.ph_soc_master select (r).* on conflict(unique_id) do nothing;
   end loop;
   update public.ph_soc_master r set suspend_candidate_state='replaced',suspend=null,suspend_to=null,quantityordered='0',date_completed=stamp
     where r.suspend_candidate_group=group_key and r.locationcode='0.00.111';
   insert into suspend_tag_private.workflows(source_uid,source_revision,status)
     select r.unique_id,r.last_updated,'pending' from public.ph_soc_master r where r.suspend_candidate_group=group_key
     on conflict(source_uid) do update set current_approval_id=null,status='pending',version=suspend_tag_private.workflows.version+1,updated_at=stamp;
   result:=jsonb_build_object('ok',true);
 elsif p_operation='send' then
   -- The clicked row retains the existing completion and sender checks.
   result:=suspend_tag_private.command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_version);
   select a2.* into a from suspend_tag_private.approvals a2 join suspend_tag_private.workflows w2 on w2.current_approval_id=a2.id where w2.source_uid=uid;
   if a.snapshot->'candidates' is null then
     select jsonb_agg(to_jsonb(suspend_tag_private.existing_review(r)) order by r.locationcode,r.lotcode,r.unique_id) into candidates
       from public.ph_soc_master r where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key
         and suspend_tag_private.eligible(r.suspend,r.suspend_to) and coalesce(r.suspend_candidate_state,'candidate') not in ('denied','canceled','replaced');
     update suspend_tag_private.approvals set snapshot=snapshot||jsonb_build_object('candidates',candidates,'candidate_group_key',group_key) where id=a.id;
     update public.ph_soc_master r set suspend_candidate_group=group_key,suspend_candidate_state='candidate',
       suspend_order_quantity=coalesce(r.suspend_order_quantity,r.quantityordered),suspend_origin_uid=coalesce(r.suspend_origin_uid,uid)
       where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates));
     insert into suspend_tag_private.workflows(source_uid,source_revision,status,current_approval_id)
       select r.unique_id,r.last_updated,'awaiting_rep',a.id from public.ph_soc_master r
       where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates))
       on conflict(source_uid) do update set status='awaiting_rep',current_approval_id=a.id,version=suspend_tag_private.workflows.version+1,updated_at=stamp;
   end if;
   result:=result||jsonb_build_object('notification',jsonb_build_object('approvalId',a.id,'repUsername',a.snapshot->>'rep_username',
     'senderDisplay',a.snapshot->>'sent_by_display','customer',coalesce(a.snapshot->>'customername',a.snapshot->>'consigneename'),
     'itemDescription',concat_ws(' ',a.snapshot->>'commonname',a.snapshot->>'contsize')));
 elsif p_operation='close' then
   update suspend_tag_private.approvals set status='superseded' where id=w.current_approval_id and status='pending';
   update public.ph_soc_master set suspend=null,suspend_to=null,date_completed=stamp where unique_id=uid;
   update suspend_tag_private.workflows set status='completed',current_approval_id=null,version=version+1,updated_at=stamp where source_uid=uid;
   result:=jsonb_build_object('ok',true,'row',suspend_tag_private.row_json(uid));
 elsif p_operation='decide' then
   select * into a from suspend_tag_private.approvals where id=a.id for update;
   if a.status<>'pending' then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='40001'; end if;
   decision:=p_payload->>'decision'; chosen:=nullif(p_payload->>'candidateUid','');
   if decision not in ('approve','deny') or decision is null then raise exception 'SUSPEND_TAG_DECISION_INVALID' using errcode='22023'; end if;
   candidates:=coalesce(a.snapshot->'candidates',jsonb_build_array(a.snapshot));
   if decision='approve' and chosen is null then chosen:=a.source_uid; end if;
   if chosen is not null and not exists(select 1 from jsonb_array_elements(candidates) x where x->>'unique_id'=chosen) then
     raise exception 'SUSPEND_TAG_CANDIDATES_INVALID' using errcode='22023'; end if;
   for candidate in select value from jsonb_array_elements(candidates) order by value->>'unique_id' loop
     select * into r from public.ph_soc_master where unique_id=candidate->>'unique_id' for update;
     if r.unique_id is null or r.last_updated is distinct from (candidate->>'last_updated')::timestamptz
       or not exists(select 1 from suspend_tag_private.workflows w where w.source_uid=r.unique_id and w.current_approval_id=a.id) then
       raise exception 'SUSPEND_TAG_APPROVAL_SUPERSEDED' using errcode='40001'; end if;
     if r.unique_id=chosen and r.suspend_candidate_state in ('denied','canceled','replaced') then raise exception 'SUSPEND_TAG_DECISION_CONFLICT' using errcode='40001'; end if;
   end loop;
   update public.ph_soc_master r set
     suspend_candidate_group=group_key,suspend_order_quantity=coalesce(r.suspend_order_quantity,r.quantityordered),
     suspend_candidate_state=case when decision='approve' and r.unique_id=chosen then 'approved' else 'denied' end,
     quantityordered=case when decision='approve' and r.unique_id=chosen then coalesce(r.suspend_order_quantity,r.quantityordered) else '0' end,
     suspend=null,suspend_to=null,date_completed=stamp
     where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates)) and (decision='approve' or chosen is null or r.unique_id=chosen);
   update suspend_tag_private.workflows w set status=r.suspend_candidate_state,version=w.version+1,updated_at=stamp
     from public.ph_soc_master r where r.unique_id=w.source_uid and w.current_approval_id=a.id and r.suspend_candidate_state in ('approved','denied');
   select count(*) into remaining from public.ph_soc_master r where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates)) and suspend_tag_private.eligible(r.suspend,r.suspend_to);
   if decision='approve' or remaining=0 then
     if decision='deny' then update public.ph_soc_master r set suspend_candidate_state='canceled' where r.unique_id in(select value->>'unique_id' from jsonb_array_elements(candidates)); end if;
     update suspend_tag_private.approvals set status=case when decision='approve' then 'approved' else 'denied' end,
       selected_source_uid=case when decision='approve' then chosen end,decided_at=stamp,decided_by=actor.id where id=a.id returning * into a;
     insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,request_folder,payload,push_delivered_at)
       values('suspend-tag-decision:'||a.id,'suspend_tag_approval_decided',a.id::text,'suspend-tag-'||a.id,jsonb_build_object('approval_id',a.id),stamp)
       returning public.ph_request_delivery_outbox.event_id into event_id;
     update suspend_tag_private.approvals set decision_event_id=event_id where id=a.id;
   end if;
   result:=jsonb_build_object('ok',true,'decision',a.status,'approvalId',a.id);
 end if;
 if p_operation in ('send','close') then result:=result||jsonb_build_object('row',suspend_tag_private.row_json(uid)); end if;
 result:=result||jsonb_build_object('rows',(select coalesce(jsonb_agg(suspend_tag_private.row_json(r.unique_id) order by r.unique_id),'[]')
    from public.ph_soc_master r where r.itemcode=s.itemcode and suspend_tag_private.order_key(r)=group_key));
 insert into suspend_tag_private.commands(actor_id,command_id,request,response) values(actor.id,p_command_id,input,result)
   on conflict(actor_id,command_id) do update set response=excluded.response;
 return result;
end $fn$;

-- Import updates preserve completed local order-location decisions.
create or replace function suspend_tag_private.retain_candidate_decision()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if old.suspend_candidate_group is not null and nullif(current_setting('app.suspend_tag_actor_id',true),'') is null then
   new.suspend_candidate_group:=old.suspend_candidate_group; new.suspend_candidate_state:=old.suspend_candidate_state;
   new.suspend_order_quantity:=old.suspend_order_quantity; new.suspend_origin_uid:=old.suspend_origin_uid;
   if old.suspend_candidate_state in ('replaced','approved','denied','canceled') then
     new.locationcode:=old.locationcode; new.lotcode:=old.lotcode; new.quantityordered:=old.quantityordered;
     new.suspend:=old.suspend; new.suspend_to:=old.suspend_to; new.date_completed:=old.date_completed;
   end if;
 end if;
 return new;
end $fn$;
drop trigger if exists retain_suspend_candidate_decision on public.ph_soc_master;
create trigger retain_suspend_candidate_decision before update on public.ph_soc_master for each row execute function suspend_tag_private.retain_candidate_decision();
revoke all on function suspend_tag_private.order_key(public.ph_soc_master),suspend_tag_private.rep_for_row(public.ph_soc_master),suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint),suspend_tag_private.retain_candidate_decision() from public,anon,authenticated;
grant execute on function suspend_tag_private.order_key(public.ph_soc_master),suspend_tag_private.rep_for_row(public.ph_soc_master),suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint) to service_role;

CREATE OR REPLACE FUNCTION public.suspend_tag_command_v1(p_actor_id uuid, p_operation text, p_payload jsonb DEFAULT '{}'::jsonb, p_command_id uuid DEFAULT NULL::uuid, p_expected_version bigint DEFAULT NULL::bigint, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if not private.is_service_role_request() then
    raise exception 'SUSPEND_TAG_SERVICE_REQUIRED' using errcode = '42501';
  end if;
  if not suspend_tag_private.session_active(p_actor_id, p_session_id) then
    raise exception 'SUSPEND_TAG_SESSION_REQUIRED' using errcode = '42501';
  end if;
  perform set_config('app.suspend_tag_actor_id', p_actor_id::text, true);
  if p_operation = 'decide' then
    if jsonb_typeof(p_payload) <> 'object'
      or (p_payload ? 'decisionMessage' and jsonb_typeof(p_payload->'decisionMessage') not in ('string', 'null'))
      or char_length(coalesce(p_payload->>'decisionMessage', '')) > 1000 then
      raise exception 'SUSPEND_TAG_DECISION_MESSAGE_INVALID' using errcode = '22023';
    end if;
    perform set_config('app.suspend_tag_decision_message', coalesce(p_payload->>'decisionMessage', ''), true);
  end if;
  return suspend_tag_private.group_command(p_actor_id, p_operation, p_payload, p_command_id, p_expected_version);
end;
$function$
;

notify pgrst, 'reload schema';
commit;
