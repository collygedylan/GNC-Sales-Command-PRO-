begin;

-- The preserved Open Orders and Reserves reports have identical 81-column
-- layouts. CONTSIZE is derived from PRINTEDCONTAINERCODE; the other four
-- generated fields identify the source snapshot. No app-owned field is staged.
create table app_sync_private.erp_snapshot_stage_v1 (
  request_id uuid primary key,
  run_id uuid not null,
  target_table text not null check (target_table in ('ph_soc_master','ph_reserves')),
  source_manifest jsonb not null,
  source_manifest_digest text not null check (source_manifest_digest ~ '^[a-f0-9]{64}$'),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  expected_rows integer not null check (expected_rows between 0 and 500000),
  expected_chunks integer not null check (expected_chunks between 0 and 1000),
  status text not null default 'staging' check (status in ('staging','published')),
  publication_run_id uuid,
  published_response jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (expected_chunks=((expected_rows+499)/500)),
  check ((status='staging' and publication_run_id is null and published_response is null)
    or (status='published' and publication_run_id is not null and published_response is not null))
);
create index erp_snapshot_stage_staging_updated_idx
  on app_sync_private.erp_snapshot_stage_v1(updated_at,request_id) where status='staging';
create table app_sync_private.erp_snapshot_stage_chunks_v1 (
  request_id uuid not null references app_sync_private.erp_snapshot_stage_v1(request_id) on delete cascade,
  chunk_index integer not null check (chunk_index between 0 and 999),
  chunk_digest text not null check (chunk_digest ~ '^[a-f0-9]{64}$'),
  row_count integer not null check (row_count between 1 and 500),
  primary key(request_id,chunk_index)
);
create table app_sync_private.erp_snapshot_stage_rows_v1 as
select null::uuid as request_id,null::integer as row_number,null::jsonb as raw_values,
  null::text[] as field_keys,null::text as source_hash,
  source.warehouseid,
  source.warehousename,
  source.isreserve,
  source.salesrepid,
  source.salesrepname,
  source.nationalaccount,
  source.idgroup,
  source.customeridentityid,
  source.customername,
  source.consigneeidentityid,
  source.consigneename,
  source.consigneecity,
  source.consigneestate,
  source.consigneezip,
  source.tripnumber,
  source.stopnumber,
  source.zonecode,
  source.tagcode,
  source.transactionnumber,
  source.purchaseordernumber,
  source.extunitprice,
  source.ordertotal,
  source.requestdate,
  source.stagename,
  source.step,
  source.customersku,
  source.formattedupc,
  source.printedcontainercode,
  source.lotcode,
  source.locationcode,
  source.descriptorcode,
  source.itemcode,
  source.plantgroupcode,
  source.sortnamevariety,
  source.containersort,
  source.qualitycode,
  source.commonname,
  source.quantityordered,
  source.quantityshipped,
  source.listprice,
  source.unitprice,
  source.handlingchargeperitem,
  source.taggingchargeperitem,
  source.combinedprice,
  source.freightrateperitem,
  source.landed,
  source.retailprice,
  source.holdstopcode,
  source.holdstopreason,
  source.salesnote,
  source.fnsalesnote,
  source.picknote,
  source.planstart,
  source.generalloadinstr,
  source.invoicedate,
  source.consigneeaddress_1,
  source.consigneeaddress_2,
  source.altshipcomment,
  source.shiptotelephone_1,
  source.okloadinstructions,
  source.txloadinstructions,
  source.ncloadinstructions,
  source.hlloadinstructions,
  source.dock,
  source.equiv_unit,
  source.equiv_uom,
  source.wingdingunits,
  source.dropweight,
  source.internalinvnote,
  source.hardinesszone,
  source.brand,
  source.tagdeptnote,
  source.ext_unit_merch_shipped,
  source.ext_eunit_shipped,
  source.avg_price_eunit_shipped,
  source.requestdateweek,
  source.carrier,
  source.suspend,
  source.suspend_to,
  source.qa_code,
  source.grower,
  source.contsize,
  source.unique_id,
  source.last_updated,
  source.filename,
  source.concat
from public.ph_soc_master source with no data;
alter table app_sync_private.erp_snapshot_stage_rows_v1
  alter column request_id set not null,
  alter column row_number set not null,
  alter column raw_values set not null,
  alter column field_keys set not null,
  alter column source_hash set not null,
  alter column unique_id set not null,
  add foreign key(request_id) references app_sync_private.erp_snapshot_stage_v1(request_id) on delete cascade,
  add primary key(request_id,row_number),
  add check(row_number>0),
  add check(jsonb_typeof(raw_values)='object'),
  add check(source_hash ~ '^[a-f0-9]{64}$');
create unique index erp_snapshot_stage_rows_uidx
  on app_sync_private.erp_snapshot_stage_rows_v1(request_id,unique_id);
create table app_sync_private.erp_snapshot_source_rows_v1 (
  target_table text not null check(target_table in ('ph_soc_master','ph_reserves')),
  unique_id text not null,
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  primary key(target_table,unique_id)
);
create table app_sync_private.erp_snapshot_bulk_context_v1 (
  request_id uuid primary key,
  run_id uuid not null,
  target_table text not null check(target_table in ('ph_soc_master','ph_reserves')),
  backend_pid integer not null,
  transaction_id bigint not null,
  mappings_changed boolean not null default false
);
alter table app_sync_private.erp_snapshot_stage_v1 enable row level security;
alter table app_sync_private.erp_snapshot_stage_chunks_v1 enable row level security;
alter table app_sync_private.erp_snapshot_stage_rows_v1 enable row level security;
alter table app_sync_private.erp_snapshot_source_rows_v1 enable row level security;
alter table app_sync_private.erp_snapshot_bulk_context_v1 enable row level security;
revoke all on app_sync_private.erp_snapshot_stage_v1,
  app_sync_private.erp_snapshot_stage_chunks_v1,app_sync_private.erp_snapshot_stage_rows_v1,
  app_sync_private.erp_snapshot_source_rows_v1,app_sync_private.erp_snapshot_bulk_context_v1
  from public,anon,authenticated,service_role;

create or replace function app_sync_private.erp_snapshot_columns_v1(p_target_table text,p_alias text default null)
returns text language plpgsql stable set search_path='' as $function$
declare
  allowed_columns constant text[] := array[
    'warehouseid','warehousename','isreserve','salesrepid','salesrepname','nationalaccount',
    'idgroup','customeridentityid','customername','consigneeidentityid','consigneename','consigneecity',
    'consigneestate','consigneezip','tripnumber','stopnumber','zonecode','tagcode',
    'transactionnumber','purchaseordernumber','extunitprice','ordertotal','requestdate','stagename',
    'step','customersku','formattedupc','printedcontainercode','lotcode','locationcode',
    'descriptorcode','itemcode','plantgroupcode','sortnamevariety','containersort','qualitycode',
    'commonname','quantityordered','quantityshipped','listprice','unitprice','handlingchargeperitem',
    'taggingchargeperitem','combinedprice','freightrateperitem','landed','retailprice','holdstopcode',
    'holdstopreason','salesnote','fnsalesnote','picknote','planstart','generalloadinstr',
    'invoicedate','consigneeaddress_1','consigneeaddress_2','altshipcomment','shiptotelephone_1','okloadinstructions',
    'txloadinstructions','ncloadinstructions','hlloadinstructions','dock','equiv_unit','equiv_uom',
    'wingdingunits','dropweight','internalinvnote','hardinesszone','brand','tagdeptnote',
    'ext_unit_merch_shipped','ext_eunit_shipped','avg_price_eunit_shipped','requestdateweek','carrier','suspend',
    'suspend_to','qa_code','grower','contsize','unique_id','last_updated',
    'filename','concat'
  ];
  target_shape jsonb;
  stage_shape jsonb;
  target_count integer;
  column_names text;
begin
  if p_target_table not in ('ph_soc_master','ph_reserves') or p_target_table is null then
    raise exception using errcode='22023',message='ERP_SNAPSHOT_TARGET_INVALID';
  end if;
  select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attcollation) order by c.ordinality),
    string_agg(case when p_alias is null then format('%I',a.attname)
      else format('%I.%I',p_alias,a.attname) end,',' order by c.ordinality),count(*)::integer
    into target_shape,column_names,target_count
  from unnest(allowed_columns) with ordinality c(column_name,ordinality)
  join pg_attribute a on a.attrelid=to_regclass('public.'||p_target_table)
    and a.attname=c.column_name and a.attnum>0 and not a.attisdropped;
  select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attcollation) order by a.attnum)
    into stage_shape
  from pg_attribute a where a.attrelid='app_sync_private.erp_snapshot_stage_rows_v1'::regclass
    and a.attnum>5 and not a.attisdropped;
  if target_count<>cardinality(allowed_columns) or target_shape is distinct from stage_shape then
    raise exception using errcode='55000',message='ERP_SNAPSHOT_SCHEMA_CHANGED';
  end if;
  return column_names;
end
$function$;
revoke all on function app_sync_private.erp_snapshot_columns_v1(text,text) from public,anon,authenticated,service_role;

create or replace function app_sync_private.assert_erp_snapshot_fence_v1(p_run_id uuid,p_target_table text)
returns void language plpgsql security definer set search_path=''
set statement_timeout='120s' set lock_timeout='15s' as $function$
declare input_headers jsonb; required_keys text[];
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='ERP_SNAPSHOT_FORBIDDEN';
  end if;
  if p_run_id is null or p_target_table is null or p_target_table not in ('ph_soc_master','ph_reserves') then
    raise exception using errcode='22023',message='ERP_SNAPSHOT_INPUT_INVALID';
  end if;
  required_keys := array[p_target_table,'ph_customer_consignee_sales_reps'];
  input_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  if nullif(input_headers->>'x-gnc-import-run-id','') is not null
    and input_headers->>'x-gnc-import-run-id'<>p_run_id::text then
    raise exception using errcode='55000',message='ERP_SNAPSHOT_FENCE_MISMATCH';
  end if;
  input_headers:=jsonb_set(input_headers,'{x-gnc-import-run-id}',to_jsonb(p_run_id::text),true);
  perform set_config('request.headers',input_headers::text,true);
  -- All source/map writers follow this publication-before-business-row order.
  perform 1 from public.app_dataset_revisions where key=any(required_keys)
    order by (key='ph_customer_consignee_sales_reps') desc,key for update;
  if not exists(select 1 from app_sync_private.import_runs r where r.id=p_run_id
    and r.state='active' and r.expires_at>clock_timestamp()
    and required_keys<@r.source_keys and p_target_table=any(r.canonical_keys)
    and not ('ph_customer_consignee_sales_reps'=any(r.canonical_keys))) then
    raise exception using errcode='55000',message='ERP_SNAPSHOT_FENCE_LOST';
  end if;
  perform 1 from app_sync_private.import_leases l where l.key=any(required_keys)
    and l.run_id=p_run_id order by l.key for share;
  if exists(select 1 from unnest(required_keys) k(key) where not exists(
    select 1 from app_sync_private.import_leases l where l.key=k.key and l.run_id=p_run_id)) then
    raise exception using errcode='55000',message='ERP_SNAPSHOT_FENCE_LOST';
  end if;
end
$function$;
revoke all on function app_sync_private.assert_erp_snapshot_fence_v1(uuid,text) from public,anon,authenticated,service_role;

create or replace function app_sync_private.erp_snapshot_progress_v1(p_request_id uuid,p_run_id uuid)
returns jsonb language sql stable security definer set search_path='' as $function$
  select jsonb_build_object('status',s.status,'requestId',s.request_id,'runId',p_run_id,
    'targetTable',s.target_table,'sourceDigest',s.source_digest,'sourceManifestDigest',s.source_manifest_digest,
    'expectedRows',s.expected_rows,'expectedChunks',s.expected_chunks,'chunkSize',500,
    'chunksReceived',(select count(*) from app_sync_private.erp_snapshot_stage_chunks_v1 c where c.request_id=s.request_id),
    'rowsReceived',(select coalesce(sum(c.row_count),0) from app_sync_private.erp_snapshot_stage_chunks_v1 c where c.request_id=s.request_id),
    'missingChunkIndexes',(select coalesce(jsonb_agg(n.i order by n.i),'[]'::jsonb)
      from generate_series(0,s.expected_chunks-1) n(i) where not exists(select 1
        from app_sync_private.erp_snapshot_stage_chunks_v1 c where c.request_id=s.request_id and c.chunk_index=n.i)),
    'nextChunkIndex',(select min(n.i) from generate_series(0,s.expected_chunks-1) n(i) where not exists(select 1
      from app_sync_private.erp_snapshot_stage_chunks_v1 c where c.request_id=s.request_id and c.chunk_index=n.i)),
    'replayed',s.status='published','publicationRunId',s.publication_run_id,'publishedResponse',s.published_response)
  from app_sync_private.erp_snapshot_stage_v1 s where s.request_id=p_request_id
$function$;
revoke all on function app_sync_private.erp_snapshot_progress_v1(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.begin_erp_snapshot_stage_v1(
  p_run_id uuid,p_request_id uuid,p_target_table text,p_source_manifest jsonb,
  p_source_digest text,p_expected_rows integer,p_expected_chunks integer
) returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='120s' set lock_timeout='15s' as $function$
declare stage app_sync_private.erp_snapshot_stage_v1; manifest_digest text; payload_digest text;
begin
  perform app_sync_private.assert_erp_snapshot_fence_v1(p_run_id,p_target_table);
  perform app_sync_private.erp_snapshot_columns_v1(p_target_table);
  perform set_config('statement_timeout','120s',true);
  perform set_config('lock_timeout','15s',true);
  if p_request_id is null or coalesce(p_source_digest,'')!~'^[a-f0-9]{64}$'
    or p_expected_rows is null or p_expected_rows not between 0 and 500000
    or p_expected_chunks is null or p_expected_chunks<>((p_expected_rows+499)/500)
    or jsonb_typeof(p_source_manifest) is distinct from 'array'
    or jsonb_array_length(p_source_manifest) not between 1 and 100
    or exists(select 1 from jsonb_array_elements(p_source_manifest) e(value)
      where jsonb_typeof(e.value) is distinct from 'object'
        or nullif(btrim(e.value->>'fileId'),'') is null or nullif(btrim(e.value->>'modifiedAt'),'') is null
        or (e.value?'size' and jsonb_typeof(e.value->'size') not in ('null','number')))
    or exists(select 1 from jsonb_array_elements(p_source_manifest) e(value)
      group by e.value->>'fileId' having count(*)>1) then
    raise exception using errcode='22023',message='ERP_SNAPSHOT_MANIFEST_INVALID';
  end if;
  manifest_digest:=encode(extensions.digest(convert_to(p_source_manifest::text,'UTF8'),'sha256'),'hex');
  payload_digest:=encode(extensions.digest(convert_to(p_target_table||':'||p_source_digest||':'||manifest_digest||':'||p_expected_rows::text||':'||p_expected_chunks::text,'UTF8'),'sha256'),'hex');
  insert into app_sync_private.erp_snapshot_stage_v1(request_id,run_id,target_table,source_manifest,
    source_manifest_digest,source_digest,payload_hash,expected_rows,expected_chunks)
  values(p_request_id,p_run_id,p_target_table,p_source_manifest,manifest_digest,p_source_digest,payload_digest,p_expected_rows,p_expected_chunks)
  on conflict(request_id) do nothing;
  select * into stage from app_sync_private.erp_snapshot_stage_v1 where request_id=p_request_id for update;
  if stage.target_table is distinct from p_target_table or stage.source_manifest is distinct from p_source_manifest
    or stage.source_manifest_digest is distinct from manifest_digest or stage.source_digest is distinct from p_source_digest
    or stage.payload_hash is distinct from payload_digest or stage.expected_rows<>p_expected_rows
    or stage.expected_chunks<>p_expected_chunks then
    raise exception using errcode='22023',message='ERP_SNAPSHOT_REQUEST_REUSED';
  end if;
  if stage.status='staging' and stage.run_id is distinct from p_run_id then
    if exists(select 1 from app_sync_private.import_runs r where r.id=stage.run_id
      and r.state='active' and r.expires_at>clock_timestamp())
      or exists(select 1 from app_sync_private.import_leases l where l.run_id=stage.run_id
        and l.key=any(array[p_target_table,'ph_customer_consignee_sales_reps'])) then
      raise exception using errcode='55000',message='ERP_SNAPSHOT_REBIND_BLOCKED';
    end if;
    update app_sync_private.erp_snapshot_stage_v1 set run_id=p_run_id,updated_at=clock_timestamp()
      where request_id=p_request_id;
  end if;
  return app_sync_private.erp_snapshot_progress_v1(p_request_id,p_run_id);
end
$function$;
revoke all on function public.begin_erp_snapshot_stage_v1(uuid,uuid,text,jsonb,text,integer,integer) from public,anon,authenticated;
grant execute on function public.begin_erp_snapshot_stage_v1(uuid,uuid,text,jsonb,text,integer,integer) to service_role;

create or replace function public.append_erp_snapshot_stage_chunk_v1(
  p_run_id uuid,p_request_id uuid,p_target_table text,p_chunk_index integer,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='120s' set lock_timeout='15s' as $function$
declare stage app_sync_private.erp_snapshot_stage_v1; prior app_sync_private.erp_snapshot_stage_chunks_v1;
  columns_sql text; values_sql text; expected_chunk_rows integer; chunk_digest text; rows_written integer:=0;
begin
  perform app_sync_private.assert_erp_snapshot_fence_v1(p_run_id,p_target_table);
  columns_sql:=app_sync_private.erp_snapshot_columns_v1(p_target_table);
  values_sql:=app_sync_private.erp_snapshot_columns_v1(p_target_table,'typed');
  perform set_config('statement_timeout','120s',true);
  perform set_config('lock_timeout','15s',true);
  if p_request_id is null or p_chunk_index is null or p_chunk_index<0
    or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500
    or octet_length(p_rows::text)>16777216 then
    raise exception using errcode='22023',message='ERP_SNAPSHOT_CHUNK_INVALID';
  end if;
  select * into stage from app_sync_private.erp_snapshot_stage_v1 where request_id=p_request_id for update;
  if not found or stage.status<>'staging' or stage.run_id is distinct from p_run_id
    or stage.target_table is distinct from p_target_table then
    raise exception using errcode='55000',message='ERP_SNAPSHOT_NOT_ACTIVE';
  end if;
  if p_chunk_index>=stage.expected_chunks then
    raise exception using errcode='22023',message='ERP_SNAPSHOT_CHUNK_INDEX_INVALID';
  end if;
  expected_chunk_rows:=case when p_chunk_index=stage.expected_chunks-1
    then stage.expected_rows-p_chunk_index*500 else 500 end;
  if jsonb_array_length(p_rows)<>expected_chunk_rows then
    raise exception using errcode='22023',message='ERP_SNAPSHOT_CHUNK_SIZE_INVALID';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) e(value)
    where jsonb_typeof(e.value) is distinct from 'object' or nullif(btrim(e.value->>'unique_id'),'') is null
      or nullif(btrim(e.value->>'last_updated'),'') is null or nullif(btrim(e.value->>'filename'),'') is null)
    or exists(select 1 from jsonb_array_elements(p_rows) e(value)
      cross join lateral jsonb_each(e.value) k(key,value) where jsonb_typeof(k.value) not in ('string','null')
        or not exists(select 1 from pg_attribute a where a.attrelid='app_sync_private.erp_snapshot_stage_rows_v1'::regclass
          and a.attnum>5 and not a.attisdropped and a.attname=k.key))
    or exists(select 1 from jsonb_array_elements(p_rows) e(value)
      where exists(select 1 from pg_attribute a
        where a.attrelid='app_sync_private.erp_snapshot_stage_rows_v1'::regclass and a.attnum>5 and not a.attisdropped
          and a.attname<>'concat' and not (e.value?a.attname::text))) then
    raise exception using errcode='22023',message='ERP_SNAPSHOT_ROW_OR_COLUMN_INVALID';
  end if;
  if p_target_table='ph_soc_master' and exists(select 1 from jsonb_array_elements(p_rows) e(value)
    where nullif(nullif(upper(btrim(e.value->>'invoicedate')),''),'NULL') is not null) then
    raise exception using errcode='22023',message='ERP_SNAPSHOT_SOC_INVOICED_ROW';
  end if;
  chunk_digest:=encode(extensions.digest(convert_to(p_rows::text,'UTF8'),'sha256'),'hex');
  select * into prior from app_sync_private.erp_snapshot_stage_chunks_v1
    where request_id=p_request_id and chunk_index=p_chunk_index;
  if found then
    if prior.chunk_digest is distinct from chunk_digest or prior.row_count<>expected_chunk_rows then
      raise exception using errcode='22023',message='ERP_SNAPSHOT_CHUNK_REUSED';
    end if;
  else
    insert into app_sync_private.erp_snapshot_stage_chunks_v1 values(p_request_id,p_chunk_index,chunk_digest,expected_chunk_rows);
    execute format($stage_insert$
      insert into app_sync_private.erp_snapshot_stage_rows_v1(request_id,row_number,raw_values,field_keys,source_hash,%s)
      select $1,(($2*500)+e.ordinality)::integer,e.value,
        array(select k.key from jsonb_object_keys(e.value) k(key) order by k.key),
        encode(extensions.digest(convert_to((e.value-array['last_updated','filename','concat'])::text,'UTF8'),'sha256'),'hex'),%s
      from jsonb_array_elements($3) with ordinality e(value,ordinality)
      cross join lateral jsonb_populate_record(null::app_sync_private.erp_snapshot_stage_rows_v1,e.value) typed
    $stage_insert$,columns_sql,values_sql) using p_request_id,p_chunk_index,p_rows;
    get diagnostics rows_written=row_count;
  end if;
  update app_sync_private.erp_snapshot_stage_v1 set updated_at=clock_timestamp() where request_id=p_request_id;
  return app_sync_private.erp_snapshot_progress_v1(p_request_id,p_run_id)
    || jsonb_build_object('accepted',true,'chunkIndex',p_chunk_index,'rowCount',expected_chunk_rows,'replayed',rows_written=0);
end
$function$;
revoke all on function public.append_erp_snapshot_stage_chunk_v1(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.append_erp_snapshot_stage_chunk_v1(uuid,uuid,text,integer,jsonb) to service_role;


-- Enrichment is additive and follows existing customer/consignee identity
-- tuples. Existing nonempty mappings and app assignment overrides win.
create or replace function app_sync_private.enrich_erp_customer_mappings_v1(p_request_id uuid)
returns integer language plpgsql security definer set search_path='' as $function$
declare affected integer:=0; current_count integer;
begin
  drop table if exists pg_temp.erp_snapshot_mapping_candidates_v1;
  create temp table erp_snapshot_mapping_candidates_v1 on commit drop as
  with raw_rep_names as materialized (
    select distinct coalesce(s.salesrepname,'') as source_name
    from app_sync_private.erp_snapshot_stage_rows_v1 s where s.request_id=p_request_id
  ), rep_names as materialized (
    select source_name,nullif(btrim(sales_private.normalize_imported_salesrep_name_v1(source_name)),'') as normalized_name
    from raw_rep_names
  )
  select s.customeridentityid,s.consigneeidentityid as consigneeid,
    case when count(distinct nullif(btrim(s.customername),''))=1 then max(nullif(btrim(s.customername),'')) end as customername,
    case when count(distinct nullif(btrim(s.consigneename),''))=1 then max(nullif(btrim(s.consigneename),'')) end as consigneename,
    case when count(distinct nullif(btrim(s.salesrepid),''))=1 then max(nullif(btrim(s.salesrepid),'')) end as salesrepid,
    case when count(distinct rep.normalized_name)=1 then max(rep.normalized_name) end as salesrepname,
    min(s.filename) as filename
  from app_sync_private.erp_snapshot_stage_rows_v1 s
  join rep_names rep on rep.source_name=coalesce(s.salesrepname,'')
  where s.request_id=p_request_id and nullif(btrim(s.customeridentityid),'') is not null
    and nullif(btrim(s.consigneeidentityid),'') is not null
  group by s.customeridentityid,s.consigneeidentityid;
  create unique index on pg_temp.erp_snapshot_mapping_candidates_v1(customeridentityid,consigneeid);
  update pg_temp.erp_snapshot_mapping_candidates_v1 c set salesrepid=o.salesrepid,salesrepname=o.salesrepname
  from sales_private.customer_rep_assignment_overrides o
  where o.customeridentityid=c.customeridentityid and o.consigneeid=c.consigneeid;

  -- Avoid even an empty mapping statement: its established statement triggers
  -- otherwise perform unnecessary identity refresh work.
  if exists(select 1 from public.ph_customer_consignee_sales_reps m
    join pg_temp.erp_snapshot_mapping_candidates_v1 c using(customeridentityid,consigneeid)
    where (nullif(btrim(m.customername),'') is null and c.customername is not null)
      or (nullif(btrim(m.consigneename),'') is null and c.consigneename is not null)
      or (nullif(btrim(m.salesrepid),'') is null and c.salesrepid is not null)
      or (nullif(btrim(m.salesrepname),'') is null and c.salesrepname is not null)) then
    update public.ph_customer_consignee_sales_reps m set
      customername=case when nullif(btrim(m.customername),'') is null then c.customername else m.customername end,
      consigneename=case when nullif(btrim(m.consigneename),'') is null then c.consigneename else m.consigneename end,
      salesrepid=case when nullif(btrim(m.salesrepid),'') is null then c.salesrepid else m.salesrepid end,
      salesrepname=case when nullif(btrim(m.salesrepname),'') is null then c.salesrepname else m.salesrepname end,
      mapping_revision=m.mapping_revision+1,mapping_updated_by='erp-snapshot:blank-enrichment',updated_at=clock_timestamp()
    from pg_temp.erp_snapshot_mapping_candidates_v1 c
    where m.customeridentityid=c.customeridentityid and m.consigneeid=c.consigneeid
      and ((nullif(btrim(m.customername),'') is null and c.customername is not null)
        or (nullif(btrim(m.consigneename),'') is null and c.consigneename is not null)
        or (nullif(btrim(m.salesrepid),'') is null and c.salesrepid is not null)
        or (nullif(btrim(m.salesrepname),'') is null and c.salesrepname is not null));
    get diagnostics current_count=row_count;
    affected:=affected+current_count;
  end if;
  if exists(select 1 from pg_temp.erp_snapshot_mapping_candidates_v1 c
    where c.customername is not null and c.consigneename is not null
      and not exists(select 1 from public.ph_customer_consignee_sales_reps m
        where m.customeridentityid=c.customeridentityid and m.consigneeid=c.consigneeid)) then
    insert into public.ph_customer_consignee_sales_reps(unique_id,customeridentityid,consigneeid,
      customername,consigneename,salesrepid,salesrepname,filename,source_file_name,raw_data,
      mapping_updated_by,imported_at,updated_at)
    select 'soc10:'||encode(extensions.digest(convert_to(jsonb_build_array(c.customeridentityid,c.consigneeid)::text,'UTF8'),'sha256'),'hex'),
      c.customeridentityid,c.consigneeid,c.customername,c.consigneename,c.salesrepid,c.salesrepname,c.filename,c.filename,
      jsonb_build_object('CUSTOMERIDENTITYID',c.customeridentityid,'CONSIGNEEID',c.consigneeid,
        'CUSTOMERNAME',c.customername,'CONSIGNEENAME',c.consigneename,'SALESREPID',c.salesrepid,'SALESREPNAME',c.salesrepname),
      'erp-snapshot:blank-enrichment',clock_timestamp(),clock_timestamp()
    from pg_temp.erp_snapshot_mapping_candidates_v1 c
    where c.customername is not null and c.consigneename is not null
      and not exists(select 1 from public.ph_customer_consignee_sales_reps m
        where m.customeridentityid=c.customeridentityid and m.consigneeid=c.consigneeid)
    on conflict(unique_id) do nothing;
    get diagnostics current_count=row_count;
    affected:=affected+current_count;
  end if;
  -- Newly generated mapping tuples also retain their source assignment for the
  -- existing mapping management UI; existing source assignments stay intact.
  insert into sales_private.customer_rep_assignment_sources(unique_id,customeridentityid,consigneeid,salesrepid,salesrepname,imported_at)
  select m.unique_id,m.customeridentityid,m.consigneeid,m.salesrepid,m.salesrepname,clock_timestamp()
  from public.ph_customer_consignee_sales_reps m
  join pg_temp.erp_snapshot_mapping_candidates_v1 c using(customeridentityid,consigneeid)
  where m.mapping_updated_by='erp-snapshot:blank-enrichment'
    and not exists(select 1 from sales_private.customer_rep_assignment_sources prior where prior.unique_id=m.unique_id)
  on conflict(unique_id) do nothing;
  return affected;
end
$function$;
revoke all on function app_sync_private.enrich_erp_customer_mappings_v1(uuid) from public,anon,authenticated,service_role;

create or replace function app_sync_private.erp_snapshot_bulk_active_v1(p_target_table text)
returns boolean language sql stable security definer set search_path='' as $function$
  select exists(select 1 from app_sync_private.erp_snapshot_bulk_context_v1 c
    where c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current() and c.target_table=p_target_table)
$function$;
revoke all on function app_sync_private.erp_snapshot_bulk_active_v1(text) from public,anon,authenticated,service_role;

-- Preserve normal user-write archive semantics. Only a validated finalizer's
-- private transaction context can defer archive capture to its set-based phase.
do $erp_bulk_archive$
declare definition text; anchor text; owner_before oid; acl_before aclitem[];
  config_before text[]; security_before boolean;
  function_oid oid:='sales_private.capture_docks_trigger()'::regprocedure;
begin
  select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
    into definition,owner_before,acl_before,config_before,security_before
  from pg_proc p where p.oid=function_oid;
  anchor:='perform sales_private.capture_source(''docks'',to_jsonb(new));';
  if security_before is distinct from true or
    length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'ERP_SNAPSHOT_ARCHIVE_ANCHOR_INVALID';
  end if;
  definition:=replace(definition,anchor,
    'if app_sync_private.erp_snapshot_bulk_active_v1(''ph_soc_master'') then return new; end if; '||anchor);
  execute definition;
  if not exists(select 1 from pg_proc p where p.oid=function_oid and p.proowner=owner_before
    and p.proacl is not distinct from acl_before and p.proconfig is not distinct from config_before
    and p.prosecdef=security_before) then raise exception 'ERP_SNAPSHOT_ARCHIVE_SECURITY_CHANGED'; end if;
end
$erp_bulk_archive$;

-- A no-op ERP map companion publication has no new identities to rebuild.
-- Other importers and any enrichment that actually changed mappings retain the
-- established refresh and ownership repair behavior.
do $erp_map_publication$
declare definition text; anchor text; owner_before oid; acl_before aclitem[];
  config_before text[]; security_before boolean;
  function_oid oid:='sales_private.refresh_rep_identities_after_import()'::regprocedure;
begin
  select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
    into definition,owner_before,acl_before,config_before,security_before
  from pg_proc p where p.oid=function_oid;
  anchor:='  -- advance_import has already completed the run before publishing ready.';
  if security_before is distinct from true or
    length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'ERP_SNAPSHOT_REP_PUBLICATION_ANCHOR_INVALID';
  end if;
  definition:=replace(definition,anchor,$patch$  if exists(select 1 from app_sync_private.erp_snapshot_bulk_context_v1 c
    where c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()
      and c.run_id::text=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-gnc-import-run-id','')
      and not c.mappings_changed) then return null; end if;
$patch$||anchor);
  execute definition;
  if not exists(select 1 from pg_proc p where p.oid=function_oid and p.proowner=owner_before
    and p.proacl is not distinct from acl_before and p.proconfig is not distinct from config_before
    and p.prosecdef=security_before) then raise exception 'ERP_SNAPSHOT_REP_PUBLICATION_SECURITY_CHANGED'; end if;
end
$erp_map_publication$;

create or replace function app_sync_private.archive_erp_soc_snapshot_v1(p_request_id uuid)
returns integer language plpgsql security definer set search_path='' as $function$
declare affected integer;
begin
  -- Resolve owners/customer identities once per distinct incoming identity.
  -- Existing archive owners still take precedence in the upsert below.
  with raw_reps as materialized (
    select distinct coalesce(s.salesrepid,'') as rep_id,coalesce(s.salesrepname,'') as rep_name
    from app_sync_private.erp_snapshot_stage_rows_v1 s
    join pg_temp.erp_snapshot_touched_v1 touched using(unique_id) where s.request_id=p_request_id
  ), rep_owners as materialized (
    select rep_id,rep_name,sales_private.assigned_rep(jsonb_build_object('salesrepid',rep_id,'salesrepname',rep_name)) as owner_id
    from raw_reps
  ), raw_customers as materialized (
    select distinct coalesce(s.customeridentityid,'') as customer_id,coalesce(s.customername,'') as customer_name,
      coalesce(s.consigneeidentityid,'') as consignee_id,coalesce(s.consigneename,'') as consignee_name
    from app_sync_private.erp_snapshot_stage_rows_v1 s
    join pg_temp.erp_snapshot_touched_v1 touched using(unique_id) where s.request_id=p_request_id
  ), customer_keys as materialized (
    select customer_id,customer_name,consignee_id,consignee_name,
      sales_private.customer_key(jsonb_build_object('customeridentityid',customer_id,'customername',customer_name,
        'consigneeidentityid',consignee_id,'consigneename',consignee_name)) as customer_key
    from raw_customers
  ), incoming as materialized (
    -- Keep the materialized candidate relation narrow. Build source/archive
    -- JSON only at the final INSERT, avoiding a large JSON tuplestore spill.
    select s.unique_id,customer.customer_key,rep.owner_id,prior.id as prior_archive_id,s.transactionnumber,
      sales_private.key(s.itemcode) as item_key,sales_private.key(s.contsize) as size_key,
      sales_private.key(s.lotcode) as lot_key
    from app_sync_private.erp_snapshot_stage_rows_v1 s
    join pg_temp.erp_snapshot_touched_v1 touched using(unique_id)
    join rep_owners rep on rep.rep_id=coalesce(s.salesrepid,'') and rep.rep_name=coalesce(s.salesrepname,'')
    join customer_keys customer on customer.customer_id=coalesce(s.customeridentityid,'')
      and customer.customer_name=coalesce(s.customername,'') and customer.consignee_id=coalesce(s.consigneeidentityid,'')
      and customer.consignee_name=coalesce(s.consigneename,'')
    left join public.ph_credit_sources prior on prior.source_kind='docks' and prior.source_id=s.unique_id
    where s.request_id=p_request_id
  ), replacement_keys as materialized (
    -- capture_source computes replacements ONLY when creating an archive. No
    -- historical candidate scan is needed for an already archived source UID.
    select distinct customer_key,transactionnumber,item_key,size_key,lot_key
    from incoming where prior_archive_id is null and nullif(transactionnumber,'') is not null
  ), missing_prior_sources as materialized (
    select prior.id,prior.customer_key,prior.snapshot->>'transactionnumber' as transactionnumber,
      sales_private.key(prior.snapshot->>'itemcode') as item_key,
      sales_private.key(prior.snapshot->>'contsize') as size_key,
      sales_private.key(prior.snapshot->>'lotcode') as lot_key
    from public.ph_credit_sources prior
    join (select distinct customer_key from replacement_keys) needed using(customer_key)
    where prior.source_kind='docks'
      and not exists(select 1 from public.ph_soc_master live where live.unique_id=prior.source_id)
  ), replacement_groups as materialized (
    select candidate.customer_key,candidate.transactionnumber,candidate.item_key,candidate.size_key,candidate.lot_key,
      array_agg(prior.id) as ids
    from replacement_keys candidate join missing_prior_sources prior
      using(customer_key,transactionnumber,item_key,size_key,lot_key)
    group by candidate.customer_key,candidate.transactionnumber,candidate.item_key,candidate.size_key,candidate.lot_key
  ), archived as (
    insert into public.ph_credit_sources as existing(source_kind,source_id,customer_key,
      assigned_rep_id,snapshot,needs_review,possible_replacements)
    select 'docks',i.unique_id,i.customer_key,i.owner_id,
      s.raw_values||jsonb_build_object(
        'assignedto',live.assignedto,'date_completed',live.date_completed,
        'dock_spec',live.dock_spec,'dock_caliper',live.dock_caliper,'dock_note',live.dock_note,
        'dock_photo_link',live.dock_photo_link,'dock_photo_name',live.dock_photo_name,
        'av_note',live.av_note,'match',live.match,'loc_match_qty',live.loc_match_qty,'initial_ptr',live.initial_ptr),
      coalesce(cardinality(replacements.ids),0)>0,coalesce(replacements.ids,'{}'::uuid[])
    from incoming i left join replacement_groups replacements
      using(customer_key,transactionnumber,item_key,size_key,lot_key)
    join app_sync_private.erp_snapshot_stage_rows_v1 s on s.request_id=p_request_id and s.unique_id=i.unique_id
    join public.ph_soc_master live on live.unique_id=i.unique_id
    on conflict(source_kind,source_id) do update set
      snapshot=existing.snapshot||excluded.snapshot,
      assigned_rep_id=coalesce(existing.assigned_rep_id,excluded.assigned_rep_id),
      revision=existing.revision+1,updated_at=clock_timestamp()
    returning id,revision,snapshot
  )
  insert into sales_private.source_versions(source_id,revision,snapshot)
    select id,revision,snapshot from archived;
  get diagnostics affected=row_count;
  return affected;
end
$function$;
revoke all on function app_sync_private.archive_erp_soc_snapshot_v1(uuid) from public,anon,authenticated,service_role;

create or replace function public.finalize_erp_snapshot_stage_v1(
  p_run_id uuid,p_request_id uuid,p_target_table text,p_source_digest text
) returns jsonb language plpgsql security definer set search_path=''
set statement_timeout='120s' set lock_timeout='15s' as $function$
declare stage app_sync_private.erp_snapshot_stage_v1;
  tuple_value record; field_names text; source_values text; set_values text;
  compare_target text; compare_source text; compare_excluded text; difference_sql text;
  sql_text text; inserted_count integer:=0; updated_count integer:=0; deleted_count integer:=0;
  batch_inserted integer; batch_updated integer; touched_ids text[];
  mappings_count integer:=0; archive_count integer:=0; response_value jsonb;
  original_headers text; final_revision text;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception using errcode='42501',message='ERP_SNAPSHOT_FORBIDDEN';
  end if;
  select * into stage from app_sync_private.erp_snapshot_stage_v1 where request_id=p_request_id;
  if found and stage.status='published' and stage.target_table=p_target_table
    and stage.source_digest=p_source_digest and stage.publication_run_id=p_run_id
    and exists(select 1 from app_sync_private.import_runs r where r.id=p_run_id and r.state='completed') then
    return stage.published_response||jsonb_build_object('replayed',true);
  end if;
  perform app_sync_private.assert_erp_snapshot_fence_v1(p_run_id,p_target_table);
  perform app_sync_private.erp_snapshot_columns_v1(p_target_table);
  perform set_config('statement_timeout','120s',true);
  perform set_config('lock_timeout','15s',true);
  select * into stage from app_sync_private.erp_snapshot_stage_v1 where request_id=p_request_id for update;
  if not found or stage.target_table is distinct from p_target_table or stage.source_digest is distinct from p_source_digest
    or (stage.status='staging' and stage.run_id is distinct from p_run_id) then
    raise exception using errcode='55000',message='ERP_SNAPSHOT_NOT_ACTIVE';
  end if;
  if stage.status='published' then
    insert into app_sync_private.erp_snapshot_bulk_context_v1(request_id,run_id,target_table,backend_pid,transaction_id)
      values(p_request_id,p_run_id,p_target_table,pg_backend_pid(),txid_current());
    perform app_sync_private.advance_import(p_run_id,'finish');
    delete from app_sync_private.erp_snapshot_bulk_context_v1 where request_id=p_request_id;
    return (stage.published_response-'runId'-'replayed')||jsonb_build_object('runId',p_run_id,'replayed',true);
  end if;
  if (select count(*) from app_sync_private.erp_snapshot_stage_chunks_v1 where request_id=p_request_id)<>stage.expected_chunks
    or (select coalesce(sum(row_count),0) from app_sync_private.erp_snapshot_stage_chunks_v1 where request_id=p_request_id)<>stage.expected_rows
    or (select count(*) from app_sync_private.erp_snapshot_stage_rows_v1 where request_id=p_request_id)<>stage.expected_rows then
    raise exception using errcode='55000',message='ERP_SNAPSHOT_INCOMPLETE';
  end if;
  insert into app_sync_private.erp_snapshot_bulk_context_v1(request_id,run_id,target_table,backend_pid,transaction_id)
    values(p_request_id,p_run_id,p_target_table,pg_backend_pid(),txid_current());
  mappings_count:=app_sync_private.enrich_erp_customer_mappings_v1(p_request_id);
  update app_sync_private.erp_snapshot_bulk_context_v1 set mappings_changed=mappings_count>0 where request_id=p_request_id;
  drop table if exists pg_temp.erp_snapshot_touched_v1;
  create temp table erp_snapshot_touched_v1(unique_id text primary key) on commit drop;

  for tuple_value in select field_keys from app_sync_private.erp_snapshot_stage_rows_v1
    where request_id=p_request_id group by field_keys order by field_keys loop
    select string_agg(format('%I',f.column_name),',' order by f.ordinality),
      string_agg(format('s.%I',f.column_name),',' order by f.ordinality),
      string_agg(format('%1$I=excluded.%1$I',f.column_name),',' order by f.ordinality)
        filter(where f.column_name<>'unique_id')
      into field_names,source_values,set_values
    from unnest(tuple_value.field_keys) with ordinality f(column_name,ordinality);
    -- Metadata changes alone never rewrite the business row or its protected
    -- app completion state. All comparison columns originate in this source.
    select string_agg(format('target.%I',f.column_name),',' order by f.ordinality),
      string_agg(format('s.%I',f.column_name),',' order by f.ordinality),
      string_agg(format('excluded.%I',f.column_name),',' order by f.ordinality)
      into compare_target,compare_source,compare_excluded
    from unnest(tuple_value.field_keys) with ordinality f(column_name,ordinality)
    where f.column_name not in ('unique_id','last_updated','filename','concat');
    difference_sql:=format('ROW(%s) IS DISTINCT FROM ROW(%s)',compare_target,compare_excluded);
    set_values:=coalesce(set_values,'unique_id=target.unique_id');
    sql_text:=format($merge$
      with changed as (
        insert into public.%I as target(%s)
        select %s from app_sync_private.erp_snapshot_stage_rows_v1 s
        left join app_sync_private.erp_snapshot_source_rows_v1 baseline
          on baseline.target_table=$2 and baseline.unique_id=s.unique_id
        left join public.%I live on live.unique_id=s.unique_id
        where s.request_id=$1 and s.field_keys=$3
          and (live.unique_id is null or baseline.source_hash IS DISTINCT FROM s.source_hash)
        on conflict(unique_id) do update set %s where %s
        returning (xmax=0) as inserted,unique_id
      ) select count(*) filter(where inserted)::integer,count(*) filter(where not inserted)::integer,
        coalesce(array_agg(unique_id),'{}'::text[]) from changed
    $merge$,p_target_table,field_names,source_values,p_target_table,set_values,difference_sql);
    execute sql_text into batch_inserted,batch_updated,touched_ids using p_request_id,p_target_table,tuple_value.field_keys;
    inserted_count:=inserted_count+batch_inserted;
    updated_count:=updated_count+batch_updated;
    insert into pg_temp.erp_snapshot_touched_v1 select unnest(touched_ids) on conflict do nothing;
  end loop;
  execute format($delete$
    delete from public.%I target where not exists(select 1 from app_sync_private.erp_snapshot_stage_rows_v1 s
      where s.request_id=$1 and s.unique_id=target.unique_id)
  $delete$,p_target_table) using p_request_id;
  get diagnostics deleted_count=row_count;
  insert into app_sync_private.erp_snapshot_source_rows_v1(target_table,unique_id,source_hash)
    select p_target_table,unique_id,source_hash from app_sync_private.erp_snapshot_stage_rows_v1 where request_id=p_request_id
    on conflict(target_table,unique_id) do update set source_hash=excluded.source_hash
      where erp_snapshot_source_rows_v1.source_hash IS DISTINCT FROM excluded.source_hash;
  delete from app_sync_private.erp_snapshot_source_rows_v1 baseline where baseline.target_table=p_target_table
    and not exists(select 1 from app_sync_private.erp_snapshot_stage_rows_v1 s
      where s.request_id=p_request_id and s.unique_id=baseline.unique_id);

  -- Validate once more before the atomic ready transition. Any failure rolls
  -- back target changes, mapping enrichment, private cursors and publication.
  perform app_sync_private.assert_erp_snapshot_fence_v1(p_run_id,p_target_table);
  perform app_sync_private.advance_import(p_run_id,'finish');
  original_headers:=current_setting('request.headers',true);
  perform set_config('request.headers',(coalesce(nullif(original_headers,'')::jsonb,'{}'::jsonb)-'x-gnc-import-run-id')::text,true);
  if p_target_table='ph_soc_master' then
    archive_count:=app_sync_private.archive_erp_soc_snapshot_v1(p_request_id);
  end if;
  perform set_config('request.headers',coalesce(original_headers,''),true);
  select revision::text into final_revision from public.app_dataset_revisions where key=p_target_table;
  response_value:=jsonb_build_object('status','published','requestId',p_request_id,'runId',p_run_id,
    'targetTable',p_target_table,'sourceDigest',stage.source_digest,'sourceManifestDigest',stage.source_manifest_digest,
    'publicationRunId',p_run_id,'sourceRows',stage.expected_rows,'inserted',inserted_count,'updated',updated_count,
    'unchanged',greatest(0,stage.expected_rows-inserted_count-updated_count),'deleted',deleted_count,
    'replayed',false,'revision',final_revision,'mappingsEnriched',mappings_count,'archivesSynced',archive_count);
  update app_sync_private.erp_snapshot_stage_v1 set status='published',publication_run_id=p_run_id,
    published_response=response_value,updated_at=clock_timestamp() where request_id=p_request_id and status='staging';
  delete from app_sync_private.erp_snapshot_stage_rows_v1 where request_id=p_request_id;
  delete from app_sync_private.erp_snapshot_bulk_context_v1 where request_id=p_request_id;
  return response_value;
end
$function$;
revoke all on function public.finalize_erp_snapshot_stage_v1(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.finalize_erp_snapshot_stage_v1(uuid,uuid,text,text) to service_role;

notify pgrst,'reload schema';
commit;
