begin;

alter table public.ph_customer_consignee_sales_reps
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists mapping_revision bigint not null default 1,
  add column if not exists mapping_updated_by text;

create index if not exists idx_customer_rep_mapping_tuple
  on public.ph_customer_consignee_sales_reps
  (salesrepid, salesrepname, customername, consigneename);
create index if not exists idx_customer_rep_mapping_external_tuple
  on public.ph_customer_consignee_sales_reps (salesrepid, customeridentityid, consigneeid);

create table if not exists sales_private.customer_rep_mapping_import_state (
  singleton boolean primary key default true check (singleton),
  published_file_id text,
  published_modified_at timestamptz,
  published_content_hash text,
  published_row_count integer not null default 0,
  changed_at timestamptz not null default clock_timestamp()
);
insert into sales_private.customer_rep_mapping_import_state(singleton) values (true)
on conflict(singleton) do nothing;

create table if not exists sales_private.customer_rep_mapping_import_runs (
  run_id uuid primary key,
  source_file_id text not null,
  source_modified_at timestamptz not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  expected_rows integer not null check (expected_rows between 0 and 500000),
  status text not null check (status in ('active','published','failed')),
  expires_at timestamptz not null,
  row_count integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
create unique index if not exists customer_rep_mapping_one_active_import
  on sales_private.customer_rep_mapping_import_runs ((status)) where status='active';

create table if not exists sales_private.customer_rep_mapping_import_stage (
  run_id uuid not null references sales_private.customer_rep_mapping_import_runs(run_id) on delete cascade,
  unique_id text not null,
  source_row_number integer not null check (source_row_number > 0),
  row_data jsonb not null check (jsonb_typeof(row_data)='object'),
  staged_at timestamptz not null default clock_timestamp(),
  primary key (run_id, unique_id),
  unique (run_id, source_row_number)
);
alter table sales_private.customer_rep_mapping_import_state enable row level security;
alter table sales_private.customer_rep_mapping_import_runs enable row level security;
alter table sales_private.customer_rep_mapping_import_stage enable row level security;
revoke all on sales_private.customer_rep_mapping_import_state, sales_private.customer_rep_mapping_import_runs,
  sales_private.customer_rep_mapping_import_stage from public, anon, authenticated;

create or replace function public.begin_customer_rep_mapping_import_v1(
  p_run_id uuid, p_source_file_id text, p_source_modified_at timestamptz,
  p_source_hash text, p_expected_rows integer
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare current_state sales_private.customer_rep_mapping_import_state;
  prior_run sales_private.customer_rep_mapping_import_runs;
  active_run sales_private.customer_rep_mapping_import_runs;
begin
  if coalesce(auth.role(),'') <> 'service_role' or p_run_id is null
    or nullif(btrim(p_source_file_id),'') is null or length(p_source_file_id)>200
    or p_source_modified_at is null or coalesce(p_source_hash,'') !~ '^[0-9a-f]{64}$'
    or p_expected_rows is null or p_expected_rows<1 or p_expected_rows>500000 then
    raise exception using errcode='22023',message='CUSTOMER_REP_IMPORT_MANIFEST_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('customer-rep-map-import',615738));
  select * into current_state from sales_private.customer_rep_mapping_import_state where singleton for update;
  if current_state.published_file_id=btrim(p_source_file_id)
    and current_state.published_modified_at=p_source_modified_at
    and current_state.published_content_hash=p_source_hash then
    return jsonb_build_object('ok',true,'alreadyPublished',true,'runId',p_run_id,
      'rowCount',current_state.published_row_count,
      'revision',(select revision::text from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps'));
  end if;
  if current_state.published_modified_at is not null and p_source_modified_at<=current_state.published_modified_at then
    raise exception using errcode='22023',message='CUSTOMER_REP_IMPORT_STALE_SOURCE';
  end if;
  select * into active_run from sales_private.customer_rep_mapping_import_runs r
    where r.status='active' and r.expires_at>clock_timestamp()
    for update;
  if active_run.run_id is not null then
    if active_run.source_file_id=btrim(p_source_file_id) and active_run.source_modified_at=p_source_modified_at then
      if active_run.content_hash<>p_source_hash or active_run.expected_rows<>p_expected_rows then
        raise exception using errcode='22023',message='CUSTOMER_REP_IMPORT_SOURCE_CONFLICT';
      end if;
      return jsonb_build_object('ok',true,'runId',active_run.run_id,'status','active','rowCount',active_run.row_count,'stagedRows',active_run.row_count);
    end if;
    raise exception using errcode='55P03',message='CUSTOMER_REP_IMPORT_BUSY';
  end if;
  select * into prior_run from sales_private.customer_rep_mapping_import_runs where run_id=p_run_id for update;
  if prior_run.run_id is not null then
    if prior_run.source_file_id<>p_source_file_id or prior_run.source_modified_at<>p_source_modified_at
      or prior_run.content_hash<>p_source_hash or prior_run.expected_rows<>p_expected_rows then
      raise exception using errcode='22023',message='CUSTOMER_REP_IMPORT_TOKEN_CONFLICT';
    end if;
    if prior_run.status='published' then
      return jsonb_build_object('ok',true,'alreadyPublished',true,'runId',p_run_id,'rowCount',prior_run.row_count,
        'revision',(select revision::text from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps'));
    end if;
    if prior_run.status='active' and prior_run.expires_at>clock_timestamp() then
      return jsonb_build_object('ok',true,'runId',p_run_id,'status','active','rowCount',prior_run.row_count,'stagedRows',prior_run.row_count);
    end if;
    delete from sales_private.customer_rep_mapping_import_stage where run_id=p_run_id;
    update sales_private.customer_rep_mapping_import_runs set status='active',expires_at=clock_timestamp()+interval '20 minutes',
      row_count=0,finished_at=null where run_id=p_run_id;
  else
    delete from sales_private.customer_rep_mapping_import_stage s where s.run_id in
      (select r.run_id from sales_private.customer_rep_mapping_import_runs r where r.status='active' and r.expires_at<=clock_timestamp());
    update sales_private.customer_rep_mapping_import_runs set status='failed',finished_at=clock_timestamp()
      where status='active' and expires_at<=clock_timestamp();
    if exists(select 1 from sales_private.customer_rep_mapping_import_runs where status='active' and expires_at>clock_timestamp()) then
      raise exception using errcode='55P03',message='CUSTOMER_REP_IMPORT_BUSY';
    end if;
    insert into sales_private.customer_rep_mapping_import_runs(run_id,source_file_id,source_modified_at,content_hash,expected_rows,status,expires_at)
      values(p_run_id,btrim(p_source_file_id),p_source_modified_at,p_source_hash,p_expected_rows,'active',clock_timestamp()+interval '20 minutes');
  end if;
  return jsonb_build_object('ok',true,'runId',p_run_id,'status','active','rowCount',0,'stagedRows',0);
end
$function$;

create or replace function public.stage_customer_rep_mapping_rows_v1(p_run_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare row_value jsonb; row_payload jsonb; uid text; row_number_value integer; affected integer;
  last_source_row integer := 0; staged_max_source_row integer := 0; existing_row jsonb;
  existing_uid text; existing_source_row integer;
begin
  if coalesce(auth.role(),'')<>'service_role' or p_run_id is null or jsonb_typeof(p_rows)<>'array'
    or jsonb_array_length(p_rows)>500 then raise exception using errcode='22023',message='CUSTOMER_REP_IMPORT_CHUNK_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('customer-rep-map-run:'||p_run_id::text,615738));
  if not exists(select 1 from sales_private.customer_rep_mapping_import_runs r
    where r.run_id=p_run_id and r.status='active' and r.expires_at>clock_timestamp()) then
    raise exception using errcode='55000',message='CUSTOMER_REP_IMPORT_RUN_INACTIVE';
  end if;
  select coalesce(max(s.source_row_number),0) into staged_max_source_row
    from sales_private.customer_rep_mapping_import_stage s where s.run_id=p_run_id;
  last_source_row:=staged_max_source_row;
  for row_value in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(row_value)<>'object' or nullif(btrim(row_value->>'unique_id'),'') is null
      or jsonb_typeof(row_value->'raw_data')<>'object'
      or coalesce(row_value->>'source_row_number','') !~ '^[1-9][0-9]{0,8}$'
      or row_value - array['unique_id','source_row_number','raw_data','row'] <> '{}'::jsonb
      or jsonb_typeof(row_value->'row')<>'object'
      or row_value->'row'->>'unique_id' is distinct from row_value->>'unique_id' then
      raise exception using errcode='22023',message='CUSTOMER_REP_IMPORT_ROW_INVALID';
    end if;
    uid:=btrim(row_value->>'unique_id');
    row_number_value:=(row_value->>'source_row_number')::integer;
    row_payload:=row_value->'row'||jsonb_build_object('raw_data',row_value->'raw_data');
    if nullif(btrim(row_payload->>'customeridentityid'),'') is null
      or nullif(btrim(row_payload->>'customername'),'') is null
      or nullif(btrim(row_payload->>'consigneeid'),'') is null
      or nullif(btrim(row_payload->>'consigneename'),'') is null
      or not (row_value->'row' ?& array['customeridentityid','customername','consigneeid','consigneename','salesrepid','salesrepname','customerstatus','consigneestatus'])
      or exists(select 1 from jsonb_each(row_value->'raw_data') raw_field where jsonb_typeof(raw_field.value)<>'string')
      or exists(select 1 from unnest(array['CUSTOMERIDENTITYID','CUSTOMERNAME','CONSIGNEEID','CONSIGNEENAME','SALESREPID','SALESREPNAME','CUSTOMERSTATUS','CONSIGNEESTATUS']) required(header_key)
        where not exists(select 1 from jsonb_object_keys(row_value->'raw_data') raw_header(header_name)
          where regexp_replace(upper(btrim(raw_header.header_name)),'[^A-Z0-9]','','g')=required.header_key)) then
      raise exception using errcode='22023',message='CUSTOMER_REP_IMPORT_REQUIRED_SOURCE_FIELD_MISSING';
    end if;
    select s.row_data,s.unique_id,s.source_row_number into existing_row,existing_uid,existing_source_row
      from sales_private.customer_rep_mapping_import_stage s
      where s.run_id=p_run_id and (s.unique_id=uid or s.source_row_number=row_number_value);
    if found then
      if existing_uid is distinct from uid or existing_source_row is distinct from row_number_value
        or (existing_row - array['imported_at','updated_at']) is distinct from (row_payload - array['imported_at','updated_at']) then
        raise exception using errcode='23505',message='CUSTOMER_REP_IMPORT_DUPLICATE_ROW';
      end if;
    else
      if row_number_value<=last_source_row then
        raise exception using errcode='22023',message='CUSTOMER_REP_IMPORT_ROWS_OUT_OF_ORDER';
      end if;
      last_source_row:=row_number_value;
    end if;
    insert into sales_private.customer_rep_mapping_import_stage(run_id,unique_id,source_row_number,row_data)
      values(p_run_id,uid,row_number_value,row_payload)
      on conflict(run_id,unique_id) do nothing;
  end loop;
  select count(*)::integer into affected from sales_private.customer_rep_mapping_import_stage where run_id=p_run_id;
  update sales_private.customer_rep_mapping_import_runs set row_count=affected,expires_at=clock_timestamp()+interval '20 minutes'
    where run_id=p_run_id;
  return jsonb_build_object('ok',true,'runId',p_run_id,'stagedRows',affected);
end
$function$;

create or replace function public.finalize_customer_rep_mapping_import_v1(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare run_value sales_private.customer_rep_mapping_import_runs;
  import_result jsonb; revision_value bigint; upsert_columns text; update_columns text;
begin
  if coalesce(auth.role(),'')<>'service_role' or p_run_id is null then
    raise exception using errcode='42501',message='CUSTOMER_REP_IMPORT_FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('customer-rep-map-import',615738));
  select * into run_value from sales_private.customer_rep_mapping_import_runs where run_id=p_run_id for update;
  if not found then raise exception using errcode='P0002',message='CUSTOMER_REP_IMPORT_RUN_MISSING'; end if;
  if run_value.status='published' then
    return jsonb_build_object('ok',true,'runId',p_run_id,'rowCount',run_value.row_count,'idempotent',true,
      'revision',(select revision::text from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps'));
  end if;
  if run_value.status<>'active' or run_value.expires_at<=clock_timestamp() then
    raise exception using errcode='55000',message='CUSTOMER_REP_IMPORT_RUN_INACTIVE'; end if;
  if run_value.row_count<>run_value.expected_rows or
    (select count(*) from sales_private.customer_rep_mapping_import_stage where run_id=p_run_id)<>run_value.expected_rows then
    raise exception using errcode='22023',message='CUSTOMER_REP_IMPORT_INCOMPLETE'; end if;
  if exists(select 1 from sales_private.customer_rep_mapping_import_stage s where s.run_id=p_run_id
    group by s.row_data->>'customeridentityid',s.row_data->>'consigneeid',lower(btrim(coalesce(s.row_data->>'salesrepid','')))
    having count(*)>1) then
    raise exception using errcode='23505',message='CUSTOMER_REP_IMPORT_DUPLICATE_RELATIONSHIP';
  end if;
  if exists(select 1 from sales_private.customer_rep_mapping_import_state st
    where st.singleton and st.published_modified_at is not null and run_value.source_modified_at<=st.published_modified_at) then
    raise exception using errcode='22023',message='CUSTOMER_REP_IMPORT_STALE_SOURCE'; end if;

  import_result:=app_sync_private.begin_import(array['ph_customer_consignee_sales_reps'],p_run_id,array['ph_customer_consignee_sales_reps']);
  if coalesce(import_result->>'state','')<>'active' then raise exception using errcode='55000',message='CUSTOMER_REP_IMPORT_FENCE_FAILED'; end if;
  perform set_config('request.headers',jsonb_build_object('x-gnc-import-run-id',p_run_id::text)::text,true);

  select string_agg(format('%I',c.column_name),',' order by c.ordinal_position),
    string_agg(format('%1$I=excluded.%1$I',c.column_name),',' order by c.ordinal_position)
    into upsert_columns,update_columns
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='ph_customer_consignee_sales_reps'
    and c.column_name not in ('unique_id','created_at','mapping_revision','mapping_updated_by');
  execute format(
    'insert into public.ph_customer_consignee_sales_reps (unique_id,%s,created_at,mapping_revision) '
    ||'select staged.unique_id,%s,clock_timestamp(),1 '
    ||'from (select s.unique_id,coalesce(to_jsonb(existing),''{}''::jsonb)||s.row_data as row_data '
    ||'from sales_private.customer_rep_mapping_import_stage s left join public.ph_customer_consignee_sales_reps existing on existing.unique_id=s.unique_id '
    ||'where s.run_id=$1) staged '
    ||'cross join lateral jsonb_populate_record(null::public.ph_customer_consignee_sales_reps,staged.row_data) populated '
    ||'on conflict(unique_id) do update set %s,mapping_revision=public.ph_customer_consignee_sales_reps.mapping_revision+1,mapping_updated_by=null',
    upsert_columns,upsert_columns,update_columns)
    using p_run_id;
  delete from public.ph_customer_consignee_sales_reps m where not exists(
    select 1 from sales_private.customer_rep_mapping_import_stage s where s.run_id=p_run_id and s.unique_id=m.unique_id);
  import_result:=app_sync_private.advance_import(p_run_id,'finish');
  if coalesce(import_result->>'state','')<>'completed' then raise exception using errcode='55000',message='CUSTOMER_REP_IMPORT_PUBLISH_FAILED'; end if;
  select revision into revision_value from public.app_dataset_revisions where key='ph_customer_consignee_sales_reps';
  update sales_private.customer_rep_mapping_import_state set published_file_id=run_value.source_file_id,
    published_modified_at=run_value.source_modified_at,published_content_hash=run_value.content_hash,
    published_row_count=run_value.expected_rows,changed_at=clock_timestamp() where singleton;
  update sales_private.customer_rep_mapping_import_runs set status='published',finished_at=clock_timestamp(),row_count=run_value.expected_rows where run_id=p_run_id;
  delete from sales_private.customer_rep_mapping_import_stage where run_id=p_run_id;
  return jsonb_build_object('ok',true,'runId',p_run_id,'rowCount',run_value.expected_rows,'revision',revision_value::text);
end
$function$;

revoke all on function public.begin_customer_rep_mapping_import_v1(uuid,text,timestamptz,text,integer) from public,anon,authenticated;
revoke all on function public.stage_customer_rep_mapping_rows_v1(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.finalize_customer_rep_mapping_import_v1(uuid) from public,anon,authenticated;
grant execute on function public.begin_customer_rep_mapping_import_v1(uuid,text,timestamptz,text,integer) to service_role;
grant execute on function public.stage_customer_rep_mapping_rows_v1(uuid,jsonb) to service_role;
grant execute on function public.finalize_customer_rep_mapping_import_v1(uuid) to service_role;

-- Existing source rows can legitimately repeat the display tuple (for example
-- when external customer/consignee IDs differ), so this index is deliberately
-- non-unique. The edit RPC checks conflicts under an advisory lock.

-- raw_data contains the unprojected source record. Keep the existing safe
-- column-level read surface while removing table-wide SELECT grants.
revoke select on table public.ph_customer_consignee_sales_reps from anon, authenticated;
grant select (unique_id,customeridentityid,customername,customerstatus,consigneeid,consigneename,
  consigneestatus,salesrepid,salesrepname,territorycode,territorydesc,filename,source_file_name,
  source_row_number,imported_at,created_at,updated_at,mapping_revision,mapping_updated_by)
  on table public.ph_customer_consignee_sales_reps to anon, authenticated;

create or replace function public.customer_rep_mapping_manage_v1(
  p_actor_id uuid,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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
begin
  if jsonb_typeof(payload) <> 'object' then raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_PAYLOAD_INVALID'; end if;
  select * into actor from public.profiles p
  where p.id = p_actor_id and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= clock_timestamp())
    and not p.must_change_password;
  if actor.id is null then raise exception using errcode='42501', message='CUSTOMER_REP_MAPPING_PROFILE_INACTIVE'; end if;
  if operation <> 'options' and coalesce(upper(btrim(actor.role)),'') not in ('ADMIN','ADMINISTRATOR','MANAGER') then
    raise exception using errcode='42501', message='CUSTOMER_REP_MAPPING_FORBIDDEN';
  end if;
  actor_username := actor.username;

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
      and (salesrep_filter is null or m.salesrepid=salesrep_filter)
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
        and (salesrep_filter is null or m.salesrepid=salesrep_filter)
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
    ));
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
    ) order by p.ordinal), '[]'::jsonb) into rows_value from page_rows p;
    return jsonb_build_object('ok',true,'rows',rows_value,'total',total_value,'page',page_value,
      'pageSize',page_size_value,'revision',coalesce((select r.revision::text from public.app_dataset_revisions r where r.key='ph_customer_consignee_sales_reps'),'0'),
      'canEdit',true);
  elsif operation = 'save' then
    if payload - array['operation','id','expectedRevision','salesrepId','salesrepName','customerName','consigneeName'] <> '{}'::jsonb
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
    if (row_value.salesrepid,row_value.salesrepname,row_value.customername,row_value.consigneename)
      is distinct from (new_salesrep_id,new_salesrep_name,new_customer_name,new_consignee_name) then
      if nullif(btrim(row_value.customeridentityid),'') is null or nullif(btrim(row_value.consigneeid),'') is null then
        raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_IDENTITY_MISSING';
      end if;
      if new_salesrep_id is distinct from row_value.salesrepid and not exists(
          select 1 from public.ph_customer_consignee_sales_reps known_rep
          where lower(btrim(coalesce(known_rep.salesrepid,'')))=lower(new_salesrep_id)
            and sales_private.rep_name_key(known_rep.salesrepname)=sales_private.rep_name_key(new_salesrep_name)
        ) then
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
    return jsonb_build_object('ok',true,'row',jsonb_build_object(
      'unique_id',row_value.unique_id,'customeridentityid',row_value.customeridentityid,'consigneeid',row_value.consigneeid,
      'salesrepid',row_value.salesrepid,'salesrepname',row_value.salesrepname,'customername',row_value.customername,
      'consigneename',row_value.consigneename,'customerstatus',row_value.customerstatus,'consigneestatus',row_value.consigneestatus,
      'territorycode',row_value.territorycode,'territorydesc',row_value.territorydesc,
      'revision',row_value.mapping_revision::text,'updated_at',row_value.updated_at,'updated_by',row_value.mapping_updated_by
    ),'revision',row_value.mapping_revision::text);
  end if;
  raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_OPERATION_INVALID';
end
$function$;

revoke all on function public.customer_rep_mapping_manage_v1(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.customer_rep_mapping_manage_v1(uuid,text,jsonb) to service_role;

-- The two public request batch RPCs ultimately insert into this table using
-- SECURITY DEFINER helpers. Enforce mapped customer/consignee membership at
-- the row boundary as well, so direct RPC/table paths cannot bypass the rule.
-- Exact existing IDs are allowed through to the existing idempotency checks.
create or replace function sales_private.require_active_customer_mapping_for_request_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op='UPDATE' then
    if (old.customeridentityid,old.customername,old.consigneeidentityid,old.consigneename,
        old.requested_by,old.request_selected_rep_username,old.request_selected_rep_display,old.request_source)
      is not distinct from (new.customeridentityid,new.customername,new.consigneeidentityid,new.consigneename,
        new.requested_by,new.request_selected_rep_username,new.request_selected_rep_display,new.request_source) then
      return new;
    end if;
  else
    if exists(select 1 from public.ph_active_request existing where existing.unique_id=new.unique_id) then
      return new;
    end if;
  end if;
  if lower(btrim(coalesce(new.request_source,''))) not in ('general','av') then
    if coalesce(auth.role(),'')='service_role' then return new; end if;
    raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED';
  end if;
  if nullif(btrim(new.customeridentityid),'') is null
    or nullif(btrim(new.consigneeidentityid),'') is null
    or nullif(btrim(new.customername),'') is null
    or nullif(btrim(new.consigneename),'') is null
    or not exists (
      select 1 from public.ph_customer_consignee_sales_reps mapping
      where btrim(coalesce(mapping.customeridentityid,''))=btrim(new.customeridentityid)
        and btrim(coalesce(mapping.consigneeid,''))=btrim(new.consigneeidentityid)
        and lower(btrim(coalesce(mapping.customername,'')))=lower(btrim(new.customername))
        and lower(btrim(coalesce(mapping.consigneename,'')))=lower(btrim(new.consigneename))
        and sales_private.rep_name_key(mapping.salesrepname)=sales_private.rep_name_key(
          coalesce(nullif(btrim(new.request_selected_rep_display),''),
            nullif(btrim(new.request_selected_rep_username),''),new.requested_by))
        and upper(btrim(coalesce(mapping.customerstatus,'')))='A'
        and upper(btrim(coalesce(mapping.consigneestatus,'')))='A'
    ) then
    raise exception using errcode='22023',message='REQUEST_CUSTOMER_MAPPING_REQUIRED';
  end if;
  return new;
end
$function$;
revoke all on function sales_private.require_active_customer_mapping_for_request_v1() from public,anon,authenticated;
drop trigger if exists require_active_customer_mapping_for_request_v1 on public.ph_active_request;
create trigger require_active_customer_mapping_for_request_v1
  before insert on public.ph_active_request
  for each row execute function sales_private.require_active_customer_mapping_for_request_v1();
drop trigger if exists require_active_customer_mapping_for_request_update_v1 on public.ph_active_request;
create trigger require_active_customer_mapping_for_request_update_v1
  before update of customeridentityid,customername,consigneeidentityid,consigneename,requested_by,
    request_selected_rep_username,request_selected_rep_display,request_source on public.ph_active_request
  for each row execute function sales_private.require_active_customer_mapping_for_request_v1();

commit;
