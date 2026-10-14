begin;
set local lock_timeout = '5s';

create table if not exists sales_private.customer_rep_assignment_sources (
  unique_id text primary key,
  customeridentityid text not null,
  consigneeid text not null,
  salesrepid text,
  salesrepname text,
  imported_at timestamptz not null default clock_timestamp()
);
create index if not exists customer_rep_assignment_sources_rep_idx
  on sales_private.customer_rep_assignment_sources (salesrepid, salesrepname);
create index if not exists customer_rep_assignment_sources_pair_idx
  on sales_private.customer_rep_assignment_sources (customeridentityid, consigneeid);

create table if not exists sales_private.customer_rep_assignment_overrides (
  customeridentityid text not null,
  consigneeid text not null,
  salesrepid text not null,
  salesrepname text not null,
  updated_by text not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (customeridentityid, consigneeid)
);

create table if not exists sales_private.customer_rep_assignment_receipts (
  actor_id uuid not null,
  request_id uuid not null,
  request_payload jsonb not null,
  response_payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (actor_id, request_id)
);

alter table sales_private.customer_rep_assignment_sources enable row level security;
alter table sales_private.customer_rep_assignment_overrides enable row level security;
alter table sales_private.customer_rep_assignment_receipts enable row level security;
revoke all on sales_private.customer_rep_assignment_sources,
  sales_private.customer_rep_assignment_overrides,
  sales_private.customer_rep_assignment_receipts from public, anon, authenticated;

create or replace function sales_private.normalize_imported_salesrep_name_v1(p_value text)
returns text language plpgsql immutable set search_path = '' as $function$
declare name_parts text[]; last_name text; first_name text;
  person_part constant text := '^[[:alpha:]]+([ ''’''-][[:alpha:]]+)*$';
begin
  if p_value is null then return null; end if;
  name_parts := string_to_array(p_value, ',');
  if cardinality(name_parts) <> 2 then return p_value; end if;
  last_name := btrim(name_parts[1]);
  first_name := btrim(name_parts[2]);
  if last_name = 'Alldredge' and first_name = 'Chance - South TX' then
    return 'Chance Alldredge - South TX';
  end if;
  if last_name !~ person_part or first_name !~ person_part
    or (last_name || ' ' || first_name) ~* '\m(sales|inhouse|interdivision|division|team|office|department|company|unknown|unassigned|null)\M' then
    return p_value;
  end if;
  return first_name || ' ' || last_name;
end
$function$;
revoke all on function sales_private.normalize_imported_salesrep_name_v1(text) from public, anon, authenticated;

create or replace function sales_private.is_first_last_salesrep_name_v1(p_value text)
returns boolean language plpgsql immutable set search_path = '' as $function$
declare parts text[]; part text; i integer; word_count integer := 0;
  person_token constant text := '^[[:alpha:]]+([’''-][[:alpha:]]+)*$';
begin
  if p_value is null or length(btrim(p_value)) > 240 or p_value <> btrim(p_value)
    or p_value ~ '[,@[:cntrl:]]'
    or p_value ~* '\m(sales|inhouse|interdivision|division|team|office|department|company|unknown|unassigned|null)\M' then
    return false;
  end if;
  parts := regexp_split_to_array(p_value, '[[:space:]]+');
  if cardinality(parts) < 2 or parts[1] !~ person_token or parts[2] !~ person_token then return false; end if;
  for i in 1..cardinality(parts) loop
    part := parts[i];
    if part = '-' then
      if i < 3 or i = cardinality(parts) then return false; end if;
    elsif part !~ person_token then return false;
    else word_count := word_count + 1;
    end if;
  end loop;
  return word_count >= 2;
end
$function$;
revoke all on function sales_private.is_first_last_salesrep_name_v1(text) from public, anon, authenticated;

create or replace function sales_private.customer_rep_assignment_rep_allowed_v1(p_salesrep_id text,p_salesrep_name text)
returns boolean language sql stable security definer set search_path = '' as $function$
  select nullif(btrim(p_salesrep_id),'') is not null
    and p_salesrep_id <> 'S99'
    and sales_private.is_first_last_salesrep_name_v1(p_salesrep_name)
    and exists (select 1 from sales_private.customer_rep_assignment_sources s
      where s.salesrepid=p_salesrep_id and s.salesrepname=p_salesrep_name)
    and not exists (select 1 from sales_private.customer_rep_assignment_sources s
      where s.salesrepid=p_salesrep_id and s.salesrepname is distinct from p_salesrep_name)
$function$;
revoke all on function sales_private.customer_rep_assignment_rep_allowed_v1(text,text) from public, anon, authenticated;

-- Seed only the source baseline. Existing display corrections are not overrides.
do $seed_sources$
declare live_count bigint; source_count bigint;
begin
  if exists (
    select 1 from public.ph_customer_consignee_sales_reps m
    where not exists (select 1 from jsonb_each(coalesce(m.raw_data, '{}'::jsonb)) f
      where regexp_replace(upper(btrim(f.key)), '[^A-Z0-9]', '', 'g') = 'SALESREPID')
      or not exists (select 1 from jsonb_each(coalesce(m.raw_data, '{}'::jsonb)) f
      where regexp_replace(upper(btrim(f.key)), '[^A-Z0-9]', '', 'g') = 'SALESREPNAME')
  ) then raise exception 'CUSTOMER_REP_ASSIGNMENT_SOURCE_SEED_FIELDS_MISSING'; end if;
  if exists (
    select m.unique_id
    from public.ph_customer_consignee_sales_reps m
    cross join lateral jsonb_each(coalesce(m.raw_data, '{}'::jsonb)) f
    where regexp_replace(upper(btrim(f.key)), '[^A-Z0-9]', '', 'g') in ('SALESREPID','SALESREPNAME')
    group by m.unique_id, regexp_replace(upper(btrim(f.key)), '[^A-Z0-9]', '', 'g')
    having count(*) > 1
  ) then raise exception 'CUSTOMER_REP_ASSIGNMENT_SOURCE_SEED_FIELDS_AMBIGUOUS'; end if;
  insert into sales_private.customer_rep_assignment_sources
    (unique_id, customeridentityid, consigneeid, salesrepid, salesrepname)
  select m.unique_id, m.customeridentityid, m.consigneeid,
    nullif(nullif(btrim(raw.rep_id), ''), 'NULL'),
    nullif(nullif(btrim(sales_private.normalize_imported_salesrep_name_v1(raw.rep_name)), ''), 'NULL')
  from public.ph_customer_consignee_sales_reps m
  cross join lateral (
    select max(f.value) filter (where regexp_replace(upper(btrim(f.key)), '[^A-Z0-9]', '', 'g') = 'SALESREPID') as rep_id,
      max(f.value) filter (where regexp_replace(upper(btrim(f.key)), '[^A-Z0-9]', '', 'g') = 'SALESREPNAME') as rep_name
    from jsonb_each_text(coalesce(m.raw_data, '{}'::jsonb)) f
  ) raw
  on conflict (unique_id) do nothing;
  select count(*) into live_count from public.ph_customer_consignee_sales_reps;
  select count(*) into source_count from sales_private.customer_rep_assignment_sources;
  if live_count <> source_count then raise exception 'CUSTOMER_REP_ASSIGNMENT_SOURCE_SEED_COUNT_MISMATCH'; end if;
  if exists (select 1 from sales_private.customer_rep_assignment_sources
    group by customeridentityid, consigneeid having count(*) > 1) then
    raise exception 'CUSTOMER_REP_ASSIGNMENT_SOURCE_SEED_PAIR_AMBIGUOUS';
  end if;
end
$seed_sources$;

create or replace function sales_private.customer_rep_assignment_metadata_v1(p_unique_id text)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object(
    'sourceSalesrepId', source.salesrepid,
    'sourceSalesrepName', source.salesrepname,
    'hasOverride', exists (select 1 from sales_private.customer_rep_assignment_overrides o
      where o.customeridentityid = m.customeridentityid and o.consigneeid = m.consigneeid)
  )
  from public.ph_customer_consignee_sales_reps m
  left join sales_private.customer_rep_assignment_sources source on source.unique_id = m.unique_id
  where m.unique_id = p_unique_id
$function$;
revoke all on function sales_private.customer_rep_assignment_metadata_v1(text) from public, anon, authenticated;

create or replace function sales_private.customer_rep_assignment_receipt_replay_v1(
  p_actor_id uuid, p_request_id text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare request_id_value uuid; prior sales_private.customer_rep_assignment_receipts;
begin
  if nullif(btrim(p_request_id), '') is null then return null; end if;
  if p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'CUSTOMER_REP_MAPPING_VALUE_INVALID';
  end if;
  request_id_value := p_request_id::uuid;
  perform pg_advisory_xact_lock(hashtextextended('customer-rep-assignment-request:' || request_id_value::text, 615738));
  select * into prior from sales_private.customer_rep_assignment_receipts r
    where r.actor_id = p_actor_id and r.request_id = request_id_value;
  if not found then return null; end if;
  if prior.request_payload is distinct from p_payload then
    raise exception using errcode = '22023', message = 'CUSTOMER_REP_MAPPING_VALUE_INVALID';
  end if;
  return prior.response_payload;
end
$function$;

create or replace function sales_private.customer_rep_assignment_receipt_store_v1(
  p_actor_id uuid, p_request_id text, p_payload jsonb, p_response jsonb
) returns void language plpgsql security definer set search_path = '' as $function$
begin
  if nullif(btrim(p_request_id), '') is null then return; end if;
  insert into sales_private.customer_rep_assignment_receipts(actor_id, request_id, request_payload, response_payload)
  values (p_actor_id, p_request_id::uuid, p_payload, p_response)
  on conflict (actor_id, request_id) do nothing;
end
$function$;
revoke all on function sales_private.customer_rep_assignment_receipt_replay_v1(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function sales_private.customer_rep_assignment_receipt_store_v1(uuid,text,jsonb,jsonb) from public, anon, authenticated;

create or replace function sales_private.customer_rep_assignment_prepare_import_v1(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  if exists (
    select 1 from sales_private.customer_rep_mapping_import_stage s
    join sales_private.customer_rep_assignment_overrides o
      on o.customeridentityid = s.row_data->>'customeridentityid'
      and o.consigneeid = s.row_data->>'consigneeid'
    where s.run_id = p_run_id
    group by o.customeridentityid, o.consigneeid having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'CUSTOMER_REP_ASSIGNMENT_IMPORT_AMBIGUOUS_OVERRIDE';
  end if;
  -- Explicitly scope the snapshot replacement for PostgREST safe-update checks.
  delete from sales_private.customer_rep_assignment_sources where unique_id is not null;
  insert into sales_private.customer_rep_assignment_sources
    (unique_id, customeridentityid, consigneeid, salesrepid, salesrepname, imported_at)
  select s.unique_id, s.row_data->>'customeridentityid', s.row_data->>'consigneeid',
    nullif(nullif(btrim(s.row_data->>'salesrepid'), ''), 'NULL'),
    nullif(nullif(btrim(s.row_data->>'salesrepname'), ''), 'NULL'), clock_timestamp()
  from sales_private.customer_rep_mapping_import_stage s where s.run_id = p_run_id;
end
$function$;
revoke all on function sales_private.customer_rep_assignment_prepare_import_v1(uuid) from public, anon, authenticated;

create or replace function sales_private.customer_rep_assignment_apply_overrides_v1(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  update public.ph_customer_consignee_sales_reps m set
    salesrepid = o.salesrepid, salesrepname = o.salesrepname,
    mapping_updated_by = o.updated_by, mapping_revision = m.mapping_revision + 1,
    updated_at = clock_timestamp(), row_hash = 'mapping-edit-pending:' || (m.mapping_revision + 1)::text
  from sales_private.customer_rep_assignment_overrides o
  where exists (select 1 from sales_private.customer_rep_mapping_import_stage s
      where s.run_id = p_run_id and s.unique_id = m.unique_id)
    and m.customeridentityid = o.customeridentityid and m.consigneeid = o.consigneeid;
end
$function$;
revoke all on function sales_private.customer_rep_assignment_apply_overrides_v1(uuid) from public, anon, authenticated;

do $patch_finalizer$
declare definition text; patched text;
begin
  definition := replace(pg_get_functiondef('public.finalize_customer_rep_mapping_import_v1(uuid)'::regprocedure), E'\r\n', E'\n');
  if position('customer_rep_assignment_prepare_import_v1' in definition) > 0 then return; end if;
  if position('import_result:=app_sync_private.begin_import' in definition) = 0
    or position('using p_run_id;' in definition) = 0
    or position('delete from public.ph_customer_consignee_sales_reps m where not exists(' in definition) = 0 then
    raise exception 'CUSTOMER_REP_ASSIGNMENT_FINALIZER_SHAPE_INVALID';
  end if;
  patched := replace(definition,
    '  import_result:=app_sync_private.begin_import',
    '  perform sales_private.customer_rep_assignment_prepare_import_v1(p_run_id);' || E'\n  import_result:=app_sync_private.begin_import');
  patched := replace(patched,
    '    using p_run_id;' || E'\n  delete from public.ph_customer_consignee_sales_reps',
    '    using p_run_id;' || E'\n  perform sales_private.customer_rep_assignment_apply_overrides_v1(p_run_id);' || E'\n  delete from public.ph_customer_consignee_sales_reps');
  if position('customer_rep_assignment_prepare_import_v1' in patched) = 0
    or position('customer_rep_assignment_apply_overrides_v1' in patched) = 0 then
    raise exception 'CUSTOMER_REP_ASSIGNMENT_FINALIZER_PATCH_FAILED';
  end if;
  execute patched;
  alter function public.finalize_customer_rep_mapping_import_v1(uuid) set statement_timeout = '55s';
end
$patch_finalizer$;

-- New RPC operations are added to the existing protected manager function so
-- app-api keeps its service-only database boundary and profile checks.
create or replace function sales_private.customer_rep_assignment_row_v1(p_unique_id text)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object(
    'unique_id', m.unique_id, 'customeridentityid', m.customeridentityid, 'consigneeid', m.consigneeid,
    'salesrepid', m.salesrepid, 'salesrepname', m.salesrepname, 'customername', m.customername,
    'consigneename', m.consigneename, 'customerstatus', m.customerstatus, 'consigneestatus', m.consigneestatus,
    'territorycode', m.territorycode, 'territorydesc', m.territorydesc,
    'revision', m.mapping_revision::text, 'updated_at', m.updated_at, 'updated_by', m.mapping_updated_by
  ) || sales_private.customer_rep_assignment_metadata_v1(m.unique_id)
  from public.ph_customer_consignee_sales_reps m where m.unique_id = p_unique_id
$function$;
revoke all on function sales_private.customer_rep_assignment_row_v1(text) from public, anon, authenticated;

do $patch_manager_rpc$
declare definition text; patched text; save_start integer; save_body text;
  old_rep_guard text; new_rep_guard text;
begin
  definition := replace(pg_get_functiondef('public.customer_rep_mapping_manage_v1(uuid,text,jsonb)'::regprocedure), E'\r\n', E'\n');
  if position('customer_rep_assignment_receipt_replay_v1' in definition) > 0 then return; end if;
  if position('actor_username := actor.username;' in definition) = 0
    or position('  elsif operation = ''save'' then' in definition) = 0
    or position('''updated_by'',p.mapping_updated_by' in definition) = 0 then
    raise exception 'CUSTOMER_REP_ASSIGNMENT_MANAGER_SHAPE_INVALID';
  end if;
  patched := replace(definition, '  row_offset integer;',
    '  row_offset integer;' || E'\n  request_replay jsonb;' || E'\n  response_value jsonb;' || E'\n  source_count integer;' || E'\n  source_row sales_private.customer_rep_assignment_sources;' || E'\n  override_row sales_private.customer_rep_assignment_overrides;');
  patched := replace(patched, '  actor_username := actor.username;',
    '  actor_username := actor.username;' || E'\n  if operation in (''save'', ''assign'', ''reset'') and payload ? ''requestId'' then' || E'\n    request_replay := sales_private.customer_rep_assignment_receipt_replay_v1(p_actor_id, payload->>''requestId'', payload || jsonb_build_object(''operation'',operation));' || E'\n    if request_replay is not null then return request_replay; end if;' || E'\n  end if;');
  patched := replace(patched, '  elsif operation = ''detail'' then', $insert$
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
  $insert$);
  patched := replace(patched,
    '''updated_by'',row_value.mapping_updated_by' || E'\n    ));',
    '''updated_by'',row_value.mapping_updated_by' || E'\n    ) || sales_private.customer_rep_assignment_metadata_v1(row_value.unique_id));');
  patched := replace(patched,
    '''updated_by'',p.mapping_updated_by' || E'\n    ) order by p.ordinal)',
    '''updated_by'',p.mapping_updated_by' || E'\n    ) || sales_private.customer_rep_assignment_metadata_v1(p.unique_id) order by p.ordinal)');
  patched := replace(patched,
    '''updated_by'',row_value.mapping_updated_by' || E'\n    ),''revision'',row_value.mapping_revision::text);',
    '''updated_by'',row_value.mapping_updated_by' || E'\n    ) || sales_private.customer_rep_assignment_metadata_v1(row_value.unique_id),''revision'',row_value.mapping_revision::text);');
  -- The existing free-form save remains available for display-name corrections,
  -- but any changed rep pair must come from the canonical imported catalog.
  patched := replace(patched,
    '    if (row_value.salesrepid,row_value.salesrepname,row_value.customername,row_value.consigneename)' || E'\n      is distinct from (new_salesrep_id,new_salesrep_name,new_customer_name,new_consignee_name) then',
    '    if (new_salesrep_id,new_salesrep_name) is distinct from (row_value.salesrepid,row_value.salesrepname) then' || E'\n'
    || '      if not sales_private.customer_rep_assignment_rep_allowed_v1(new_salesrep_id,new_salesrep_name) then' || E'\n'
    || '        raise exception using errcode=''22023'',message=''CUSTOMER_REP_MAPPING_REP_UNVERIFIED''; end if;' || E'\n'
    || '      select count(*) into source_count from public.ph_customer_consignee_sales_reps m where m.customeridentityid=row_value.customeridentityid and m.consigneeid=row_value.consigneeid;' || E'\n'
    || '      if source_count<>1 then raise exception using errcode=''23505'',message=''CUSTOMER_REP_MAPPING_CONFLICT''; end if;' || E'\n'
    || '      insert into sales_private.customer_rep_assignment_overrides(customeridentityid,consigneeid,salesrepid,salesrepname,updated_by,updated_at) values(row_value.customeridentityid,row_value.consigneeid,new_salesrep_id,new_salesrep_name,actor_username,clock_timestamp()) on conflict(customeridentityid,consigneeid) do update set salesrepid=excluded.salesrepid,salesrepname=excluded.salesrepname,updated_by=excluded.updated_by,updated_at=excluded.updated_at;' || E'\n'
    || '    end if;' || E'\n'
    || '    if (row_value.salesrepid,row_value.salesrepname,row_value.customername,row_value.consigneename)' || E'\n      is distinct from (new_salesrep_id,new_salesrep_name,new_customer_name,new_consignee_name) then');
  old_rep_guard := $old_rep_guard$      if new_salesrep_id is distinct from row_value.salesrepid and not exists(
          select 1 from public.ph_customer_consignee_sales_reps known_rep
          where lower(btrim(coalesce(known_rep.salesrepid,'')))=lower(new_salesrep_id)
            and sales_private.rep_name_key(known_rep.salesrepname)=sales_private.rep_name_key(new_salesrep_name)
        ) then
        raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED';
      end if;$old_rep_guard$;
  new_rep_guard := $new_rep_guard$      if (new_salesrep_id,new_salesrep_name) is distinct from (row_value.salesrepid,row_value.salesrepname)
        and not sales_private.customer_rep_assignment_rep_allowed_v1(new_salesrep_id,new_salesrep_name) then
        raise exception using errcode='22023', message='CUSTOMER_REP_MAPPING_REP_UNVERIFIED';
      end if;$new_rep_guard$;
  if position(old_rep_guard in patched) = 0 then raise exception 'CUSTOMER_REP_ASSIGNMENT_LEGACY_GUARD_SHAPE_INVALID'; end if;
  patched := replace(patched, old_rep_guard, new_rep_guard);
  patched := replace(patched,
    'payload - array[''operation'',''id'',''expectedRevision'',''salesrepId'',''salesrepName'',''customerName'',''consigneeName''] <>',
    'payload - array[''operation'',''id'',''expectedRevision'',''salesrepId'',''salesrepName'',''customerName'',''consigneeName'',''requestId''] <>');
  save_start := strpos(patched, '  elsif operation = ''save'' then');
  if save_start = 0 then raise exception 'CUSTOMER_REP_ASSIGNMENT_SAVE_BRANCH_MISSING'; end if;
  save_body := substring(patched from save_start);
  save_body := replace(save_body,
    '    return jsonb_build_object(''ok'',true,''row'',jsonb_build_object(',
    '    response_value := jsonb_build_object(''ok'',true,''row'',jsonb_build_object(');
  save_body := replace(save_body,
    '''updated_by'',row_value.mapping_updated_by' || E'\n    ) || sales_private.customer_rep_assignment_metadata_v1(row_value.unique_id),''revision'',row_value.mapping_revision::text);' || E'\n  end if;',
    '''updated_by'',row_value.mapping_updated_by' || E'\n    ) || sales_private.customer_rep_assignment_metadata_v1(row_value.unique_id),''revision'',row_value.mapping_revision::text);' || E'\n    perform sales_private.customer_rep_assignment_receipt_store_v1(p_actor_id,payload->>''requestId'',payload || jsonb_build_object(''operation'',operation),response_value);' || E'\n    return response_value;' || E'\n  end if;');
  patched := left(patched,save_start-1) || save_body;
  if position('customer_rep_assignment_receipt_replay_v1' in patched) = 0
    or position('customer_rep_assignment_metadata_v1(p.unique_id)' in patched) = 0
    or position('elsif operation = ''assign'' then' in patched) = 0 then
    raise exception 'CUSTOMER_REP_ASSIGNMENT_MANAGER_PATCH_FAILED';
  end if;
  execute patched;
end
$patch_manager_rpc$;

commit;
