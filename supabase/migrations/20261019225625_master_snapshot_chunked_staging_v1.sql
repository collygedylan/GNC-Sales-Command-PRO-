begin;

create table app_sync_private.ph_master_snapshot_stage_v1 (
  request_id uuid primary key,
  run_id uuid not null,
  source_manifest jsonb not null,
  source_manifest_digest text not null check (source_manifest_digest ~ '^[a-f0-9]{64}$'),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  expected_rows integer not null check (expected_rows between 1 and 50000),
  expected_chunks integer not null check (expected_chunks between 1 and 100),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'staging' check (status in ('staging','published')),
  publication_run_id uuid,
  published_response jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (expected_chunks = ((expected_rows + 499) / 500)),
  check ((status = 'staging' and published_response is null and publication_run_id is null)
      or (status = 'published' and published_response is not null and publication_run_id is not null))
);
create index ph_master_snapshot_stage_v1_staging_updated_idx
  on app_sync_private.ph_master_snapshot_stage_v1(updated_at, request_id)
  where status = 'staging';

create table app_sync_private.ph_master_snapshot_stage_chunks_v1 (
  request_id uuid not null references app_sync_private.ph_master_snapshot_stage_v1(request_id) on delete cascade,
  chunk_index integer not null check (chunk_index between 0 and 99),
  chunk_digest text not null check (chunk_digest ~ '^[a-f0-9]{64}$'),
  row_count integer not null check (row_count between 1 and 500),
  created_at timestamptz not null default clock_timestamp(),
  primary key (request_id, chunk_index)
);

-- The preserved Drive Around report has 76 header cells, including two
-- SALESNOTE headers: 75 distinct source keys, 74 mapped live columns, and
-- EXT_EQUIV_UNIT retained only in raw_values. Add four generated identity/
-- revision values, leaving the 213-column live table intact.
-- CTAS copies these types without importing live defaults or NOT NULL rules.
create table app_sync_private.ph_master_snapshot_stage_rows_v1 as
select null::uuid as request_id, null::integer as row_number,
  null::jsonb as raw_values, null::integer as raw_item6_count,
  null::text[] as raw_item6_fields, null::text[] as field_keys,
  null::text as lineage_key, null::text as source_hash,
  master.warehouseid,
  master.plantgroupcode,
  master.itemcode,
  master.qualitycode,
  master.contsize,
  master.commonname,
  master.lotcode,
  master.locationcode,
  master.source,
  master.desigitem,
  master.desigcust,
  master.desigloc,
  master.priority,
  master.ptronhand,
  master.ptrreviewed,
  master.ptravailable,
  master.holdstopcode,
  master.holdstopbegindate,
  master.holdstopreason,
  master.hsreasonbegin,
  master.season_supply,
  master.season_oh,
  master.season_demand,
  master.s_lts,
  master.oversellpercentage,
  master.itemspec,
  master.locationnote,
  master.locationnotedate,
  master.suspend,
  master.suspend_to,
  master.specialpuller,
  master.pulltagnote1,
  master.pulltagnote2,
  master.fieldtagcolor,
  master.salesnote,
  master.inventorynote,
  master.locationptn1,
  master.locationptn2,
  master.prisetby,
  master.priupdated,
  master.bypassloc,
  master.largeptrqty,
  master.maxorderquantity,
  master.lochold,
  master.listprice,
  master.ext_ptronhand,
  master.varietycode,
  master.genusname,
  master.botanicalname,
  master.reversecommon,
  master.sortnamevariety,
  master.containersort,
  master.saleyear,
  master.season,
  master.blockalpha,
  master.blocknumber,
  master.bay,
  master.pullerresponsibility,
  master.grower,
  master.si_lts,
  master.a_lts,
  master.ai_lts,
  master.season_available,
  master.holdstopenddate,
  master.fnsalesnote,
  master.warehousename,
  master.mcstatus,
  master.hz,
  master.intercopo,
  master.insurancegroup,
  master.brand,
  master.printedcontainercode,
  master.salesnotebegindate,
  master.equiv_unit,
  master.unique_id,
  master.last_updated,
  master.filename,
  master.concat
from public.ph_master_inventory master with no data;
alter table app_sync_private.ph_master_snapshot_stage_rows_v1
  alter column request_id set not null,
  alter column row_number set not null,
  alter column raw_values set not null,
  alter column raw_item6_count set not null,
  alter column raw_item6_fields set not null,
  alter column field_keys set not null,
  add foreign key (request_id) references app_sync_private.ph_master_snapshot_stage_v1(request_id) on delete cascade,
  add check (row_number > 0),
  add check (raw_item6_count >= 0),
  add primary key (request_id, row_number);
create unique index ph_master_snapshot_stage_rows_uidx
  on app_sync_private.ph_master_snapshot_stage_rows_v1(request_id, unique_id);
create index ph_master_snapshot_stage_rows_lineage_idx
  on app_sync_private.ph_master_snapshot_stage_rows_v1(request_id, lineage_key);

alter table app_sync_private.ph_master_snapshot_stage_v1 enable row level security;
alter table app_sync_private.ph_master_snapshot_stage_chunks_v1 enable row level security;
alter table app_sync_private.ph_master_snapshot_stage_rows_v1 enable row level security;
revoke all on app_sync_private.ph_master_snapshot_stage_v1,
  app_sync_private.ph_master_snapshot_stage_chunks_v1,
  app_sync_private.ph_master_snapshot_stage_rows_v1 from public, anon, authenticated, service_role;

-- This fixed source contract also rejects app-owned payload fields. A future
-- source mapping or typed-column change must explicitly migrate staging.
create or replace function app_sync_private.master_snapshot_stage_columns_v1(p_alias text default null)
returns text
language plpgsql stable set search_path = ''
as $function$
declare
  allowed_columns constant text[] := array[
    'warehouseid','plantgroupcode','itemcode','qualitycode','contsize','commonname',
    'lotcode','locationcode','source','desigitem','desigcust','desigloc',
    'priority','ptronhand','ptrreviewed','ptravailable','holdstopcode','holdstopbegindate',
    'holdstopreason','hsreasonbegin','season_supply','season_oh','season_demand','s_lts','oversellpercentage',
    'itemspec','locationnote','locationnotedate','suspend','suspend_to','specialpuller',
    'pulltagnote1','pulltagnote2','fieldtagcolor','salesnote','inventorynote','locationptn1',
    'locationptn2','prisetby','priupdated','bypassloc','largeptrqty','maxorderquantity',
    'lochold','listprice','ext_ptronhand','varietycode','genusname','botanicalname',
    'reversecommon','sortnamevariety','containersort','saleyear','season','blockalpha',
    'blocknumber','bay','pullerresponsibility','grower','si_lts','a_lts',
    'ai_lts','season_available','holdstopenddate','fnsalesnote','warehousename','mcstatus',
    'hz','intercopo','insurancegroup','brand','printedcontainercode','salesnotebegindate',
    'equiv_unit','unique_id','last_updated','filename','concat'
  ];
  master_shape jsonb;
  stage_shape jsonb;
  column_list text;
  master_column_count integer;
begin
  select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attcollation) order by c.ordinality),
    string_agg(case when p_alias is null then format('%I',a.attname)
      else format('%I.%I',p_alias,a.attname) end,',' order by c.ordinality), count(*)::integer
    into master_shape,column_list,master_column_count
  from unnest(allowed_columns) with ordinality c(column_name,ordinality)
  join pg_attribute a on a.attrelid='public.ph_master_inventory'::regclass
    and a.attname=c.column_name and a.attnum>0 and not a.attisdropped;
  select jsonb_agg(jsonb_build_array(a.attname,a.atttypid,a.atttypmod,a.attcollation) order by a.attnum)
    into stage_shape
  from pg_attribute a
  where a.attrelid='app_sync_private.ph_master_snapshot_stage_rows_v1'::regclass
    and a.attnum>8 and not a.attisdropped;
  if master_column_count<>cardinality(allowed_columns) or stage_shape is distinct from master_shape then
    raise exception using errcode='55000', message='MASTER_SNAPSHOT_STAGE_SCHEMA_CHANGED';
  end if;
  return column_list;
end
$function$;
revoke all on function app_sync_private.master_snapshot_stage_columns_v1(text)
  from public, anon, authenticated, service_role;

create or replace function app_sync_private.assert_master_snapshot_stage_fence_v1(p_run_id uuid)
returns void
language plpgsql security definer set search_path = ''
set statement_timeout = '120s'
set lock_timeout = '15s'
as $function$
declare
  input_headers jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'MASTER_SNAPSHOT_STAGE_FORBIDDEN';
  end if;
  if p_run_id is null then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_INPUT_INVALID';
  end if;
  input_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  if nullif(input_headers->>'x-gnc-import-run-id', '') is not null
     and input_headers->>'x-gnc-import-run-id' <> p_run_id::text then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_FENCE_MISMATCH';
  end if;
  input_headers := jsonb_set(input_headers, '{x-gnc-import-run-id}', to_jsonb(p_run_id::text), true);
  perform set_config('request.headers', input_headers::text, true);
  if private.ph_master_inventory_import_run_v1() is distinct from p_run_id
     or not exists (
       select 1 from app_sync_private.import_runs r
       where r.id = p_run_id and r.state = 'active' and r.expires_at > clock_timestamp()
         and 'ph_master_inventory' = any(r.canonical_keys)
     ) then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_FENCE_LOST';
  end if;
  perform 1 from app_sync_private.import_leases l
  where l.key = 'ph_master_inventory' and l.run_id = p_run_id
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_FENCE_LOST';
  end if;
end
$function$;
revoke all on function app_sync_private.assert_master_snapshot_stage_fence_v1(uuid) from public, anon, authenticated, service_role;

create or replace function public.begin_master_snapshot_stage_v1(
  p_run_id uuid,
  p_request_id uuid,
  p_source_manifest jsonb,
  p_source_digest text,
  p_expected_rows integer,
  p_expected_chunks integer
)
returns jsonb
language plpgsql security definer set search_path = ''
set statement_timeout = '120s'
set lock_timeout = '15s'
as $function$
declare
  stage_row app_sync_private.ph_master_snapshot_stage_v1%rowtype;
  manifest_digest text;
  payload_hash text;
  missing_indexes jsonb;
  next_index integer;
  receipt jsonb;
  did_rebind boolean := false;
begin
  perform app_sync_private.assert_master_snapshot_stage_fence_v1(p_run_id);
  perform app_sync_private.master_snapshot_stage_columns_v1();
  perform set_config('statement_timeout','120s',true);
  perform set_config('lock_timeout','15s',true);
  if p_request_id is null or p_source_digest is null or p_source_digest !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_source_manifest) is distinct from 'array'
     or jsonb_array_length(p_source_manifest) < 1 or jsonb_array_length(p_source_manifest) > 100
     or p_expected_rows is null or p_expected_rows not between 1 and 50000
     or p_expected_chunks is null
     or p_expected_chunks <> ((p_expected_rows + 499) / 500)
     or exists (
       select 1 from jsonb_array_elements(p_source_manifest) m(value)
       where jsonb_typeof(m.value) is distinct from 'object'
         or nullif(btrim(m.value->>'fileId'), '') is null
         or nullif(btrim(m.value->>'modifiedAt'), '') is null
         or (m.value ? 'size' and jsonb_typeof(m.value->'size') not in ('number','null'))
     ) then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_INPUT_INVALID';
  end if;
  if exists(select 1 from jsonb_array_elements(p_source_manifest) m(value)
    group by m.value->>'fileId' having count(*) > 1) then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_MANIFEST_DUPLICATE';
  end if;
  manifest_digest := encode(extensions.digest(convert_to(p_source_manifest::text, 'UTF8'), 'sha256'), 'hex');
  payload_hash := encode(extensions.digest(convert_to(
    p_source_digest || ':' || manifest_digest || ':' || p_expected_rows::text || ':' || p_expected_chunks::text,
    'UTF8'), 'sha256'), 'hex');

  insert into app_sync_private.ph_master_snapshot_stage_v1(
    request_id, run_id, source_manifest, source_manifest_digest, source_digest,
    expected_rows, expected_chunks, payload_hash
  ) values (
    p_request_id, p_run_id, p_source_manifest, manifest_digest, p_source_digest,
    p_expected_rows, p_expected_chunks, payload_hash
  ) on conflict (request_id) do nothing;

  select * into stage_row from app_sync_private.ph_master_snapshot_stage_v1 s
  where s.request_id = p_request_id for update;
  if not found then
    raise exception using errcode = '40001', message = 'MASTER_SNAPSHOT_STAGE_CONCURRENT_CHANGE';
  end if;
  if stage_row.source_manifest is distinct from p_source_manifest
     or stage_row.source_manifest_digest is distinct from manifest_digest
     or stage_row.source_digest is distinct from p_source_digest
     or stage_row.expected_rows is distinct from p_expected_rows
     or stage_row.expected_chunks is distinct from p_expected_chunks
     or stage_row.payload_hash is distinct from payload_hash then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_REQUEST_REUSED';
  end if;

  if stage_row.status = 'staging' and stage_row.run_id is distinct from p_run_id then
    -- The fence helper proves the new run owns the only canonical lease. That
    -- row lock cannot be acquired until an old in-flight publisher releases it.
    if exists(select 1 from app_sync_private.import_runs r
      where r.id=stage_row.run_id and r.state='active' and r.expires_at>clock_timestamp()) then
      raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_REBIND_BLOCKED';
    end if;
    if exists(select 1 from app_sync_private.import_leases l
      where l.key = 'ph_master_inventory' and l.run_id = stage_row.run_id) then
      raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_REBIND_BLOCKED';
    end if;
    update app_sync_private.ph_master_snapshot_stage_v1
    set run_id = p_run_id, updated_at = clock_timestamp()
    where request_id = p_request_id returning * into stage_row;
    did_rebind := true;
  end if;

  if not exists (select 1 from app_sync_private.ph_master_bulk_import_receipts_v1 r where r.request_id = p_request_id)
     and stage_row.status = 'published' then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_RECEIPT_MISSING';
  end if;
  select r.response into receipt from app_sync_private.ph_master_bulk_import_receipts_v1 r
  where r.request_id = p_request_id
    and r.run_id = stage_row.publication_run_id
    and r.source_digest = stage_row.source_digest;
  if stage_row.status = 'published' and receipt is null then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_RECEIPT_MISSING';
  end if;
  if stage_row.status = 'staging' and receipt is not null then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_RECEIPT_CONFLICT';
  end if;

  select coalesce(jsonb_agg(n.i order by n.i), '[]'::jsonb), min(n.i)
  into missing_indexes, next_index
  from generate_series(0, p_expected_chunks - 1) n(i)
  where not exists(select 1 from app_sync_private.ph_master_snapshot_stage_chunks_v1 c
    where c.request_id = p_request_id and c.chunk_index = n.i);

  return jsonb_build_object(
    'status', stage_row.status, 'requestId', p_request_id, 'runId', p_run_id,
    'sourceDigest', stage_row.source_digest,
    'sourceManifestDigest', stage_row.source_manifest_digest,
    'sourceCount', jsonb_array_length(stage_row.source_manifest), 'chunkSize', 500,
    'expectedRows', stage_row.expected_rows, 'expectedChunks', stage_row.expected_chunks,
    'chunksReceived', (select count(*) from app_sync_private.ph_master_snapshot_stage_chunks_v1 c where c.request_id=p_request_id),
    'rowsReceived', (select coalesce(sum(c.row_count),0) from app_sync_private.ph_master_snapshot_stage_chunks_v1 c where c.request_id=p_request_id),
    'missingChunkIndexes', missing_indexes, 'nextChunkIndex', next_index,
    'rebound', did_rebind,
    'replayed', stage_row.status = 'published',
    'publicationRunId', stage_row.publication_run_id,
    'publishedResponse', receipt
  );
end
$function$;
revoke all on function public.begin_master_snapshot_stage_v1(uuid,uuid,jsonb,text,integer,integer) from public, anon, authenticated;
grant execute on function public.begin_master_snapshot_stage_v1(uuid,uuid,jsonb,text,integer,integer) to service_role;

create or replace function public.append_master_snapshot_stage_chunk_v1(
  p_run_id uuid,
  p_request_id uuid,
  p_chunk_index integer,
  p_rows jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
set statement_timeout = '120s'
set lock_timeout = '15s'
as $function$
declare
  stage_row app_sync_private.ph_master_snapshot_stage_v1%rowtype;
  prior_chunk app_sync_private.ph_master_snapshot_stage_chunks_v1%rowtype;
  allowed_item6 constant text[] := array[
    'locationnote','locationptn1','desigitem','desigcust','desigloc',
    'pullerresponsibility','oversellpercentage','salesnote','suspend'
  ];
  chunk_size integer;
  chunk_digest text;
  rows_written integer;
  typed_columns text;
  typed_values text;
  missing_indexes jsonb;
  next_index integer;
begin
  perform app_sync_private.assert_master_snapshot_stage_fence_v1(p_run_id);
  typed_columns := app_sync_private.master_snapshot_stage_columns_v1();
  typed_values := app_sync_private.master_snapshot_stage_columns_v1('typed');
  perform set_config('statement_timeout','120s',true);
  perform set_config('lock_timeout','15s',true);
  if p_request_id is null or p_chunk_index is null or p_chunk_index < 0
     or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500
     or octet_length(p_rows::text) > 16777216 then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_CHUNK_INVALID';
  end if;
  select * into stage_row from app_sync_private.ph_master_snapshot_stage_v1 s
  where s.request_id = p_request_id for update;
  if not found or stage_row.status <> 'staging' or stage_row.run_id is distinct from p_run_id then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_NOT_ACTIVE';
  end if;
  if p_chunk_index >= stage_row.expected_chunks then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_CHUNK_INDEX_INVALID';
  end if;
  chunk_size := case when p_chunk_index = stage_row.expected_chunks - 1
    then stage_row.expected_rows - p_chunk_index * 500 else 500 end;
  if jsonb_array_length(p_rows) <> chunk_size then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_CHUNK_SIZE_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e(value)
    where jsonb_typeof(e.value) is distinct from 'object'
       or jsonb_typeof(e.value->'values') is distinct from 'object'
       or jsonb_typeof(e.value->'rawFields') is distinct from 'array'
       or (e.value - 'values' - 'rawFields') <> '{}'::jsonb
       or nullif(btrim(e.value->'values'->>'unique_id'), '') is null
       or exists(select 1 from jsonb_array_elements(e.value->'rawFields') f(value)
         where jsonb_typeof(f.value) is distinct from 'string')
  ) then
    raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_ROW_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) e(value)
    where cardinality(array(
        select distinct jsonb_array_elements_text(e.value->'rawFields') order by 1
      )) <> jsonb_array_length(e.value->'rawFields')
       or exists(select 1 from jsonb_array_elements_text(e.value->'rawFields') f(field_name)
         where not (f.field_name = any(allowed_item6))
            or not ((e.value->'values') ? f.field_name))
       or exists(select 1 from unnest(allowed_item6) f(field_name)
         where (e.value->'values') ? f.field_name
           and not ((e.value->'rawFields') ? f.field_name))
  ) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_ITEM6_MASK_INVALID';
  end if;
  if exists (
    select 1
    from (
      select distinct k.key
      from jsonb_array_elements(p_rows) e(value)
      cross join lateral jsonb_object_keys(e.value->'values') k(key)
    ) incoming_columns
    -- This source-only report column has no live target column. Keep its
    -- exact raw value for audit/digests, never in the typed update key set.
    where incoming_columns.key<>'ext_equiv_unit' and not exists (
      select 1 from pg_attribute a
      where a.attrelid = 'app_sync_private.ph_master_snapshot_stage_rows_v1'::regclass
        and a.attname = incoming_columns.key and a.attnum > 8 and not a.attisdropped
    )
  ) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_COLUMN_INVALID';
  end if;
  chunk_digest := encode(extensions.digest(convert_to(p_rows::text, 'UTF8'), 'sha256'), 'hex');
  select * into prior_chunk from app_sync_private.ph_master_snapshot_stage_chunks_v1 c
  where c.request_id=p_request_id and c.chunk_index=p_chunk_index;
  if found then
    if prior_chunk.chunk_digest is distinct from chunk_digest or prior_chunk.row_count <> chunk_size then
      raise exception using errcode = '22023', message = 'MASTER_SNAPSHOT_STAGE_CHUNK_REUSED';
    end if;
    rows_written := 0;
  else
    insert into app_sync_private.ph_master_snapshot_stage_chunks_v1(request_id,chunk_index,chunk_digest,row_count)
    values(p_request_id,p_chunk_index,chunk_digest,chunk_size);
    execute format($stage_insert$
      insert into app_sync_private.ph_master_snapshot_stage_rows_v1(
        request_id,row_number,raw_values,raw_item6_count,raw_item6_fields,field_keys,
        lineage_key,source_hash,%s
      )
      select $1, (($2 * 500) + e.ordinality)::integer,
        e.value->'values', jsonb_array_length(e.value->'rawFields'),
        array(select distinct jsonb_array_elements_text(e.value->'rawFields') order by 1),
        array(select k.key from jsonb_object_keys(e.value->'values') k(key)
          where k.key<>'ext_equiv_unit' order by k.key),
        private.ph_master_inventory_lineage_key_v1(e.value->'values'),
        private.ph_master_bulk_source_hash_v1(e.value->'values',
          array(select distinct jsonb_array_elements_text(e.value->'rawFields') order by 1)),
        %s
      from jsonb_array_elements($3) with ordinality e(value,ordinality)
      cross join lateral jsonb_populate_record(
        null::app_sync_private.ph_master_snapshot_stage_rows_v1,e.value->'values') typed
    $stage_insert$,typed_columns,typed_values) using p_request_id,p_chunk_index,p_rows;
    get diagnostics rows_written = row_count;
  end if;
  select coalesce(jsonb_agg(n.i order by n.i), '[]'::jsonb), min(n.i)
  into missing_indexes,next_index
  from generate_series(0,stage_row.expected_chunks-1) n(i)
  where not exists(select 1 from app_sync_private.ph_master_snapshot_stage_chunks_v1 c
    where c.request_id=p_request_id and c.chunk_index=n.i);
  return jsonb_build_object(
    'status','staging','requestId',p_request_id,'runId',p_run_id,
    'chunkIndex',p_chunk_index,'rowCount',chunk_size,'accepted',true,'replayed',rows_written=0,
    'chunksReceived',(select count(*) from app_sync_private.ph_master_snapshot_stage_chunks_v1 c where c.request_id=p_request_id),
    'rowsReceived',(select coalesce(sum(c.row_count),0) from app_sync_private.ph_master_snapshot_stage_chunks_v1 c where c.request_id=p_request_id),
    'missingChunkIndexes',missing_indexes,'nextChunkIndex',next_index
  );
end
$function$;
revoke all on function public.append_master_snapshot_stage_chunk_v1(uuid,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.append_master_snapshot_stage_chunk_v1(uuid,uuid,integer,jsonb) to service_role;

do $migration$
declare
  definition text;
  transformed text;
  start_at integer;
  end_at integer;
  anchor text;
  replacement text;
  count_anchor integer;
begin
  select pg_get_functiondef('public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)'::regprocedure)
  into definition;
  if definition is null then raise exception 'MASTER_SNAPSHOT_CHUNK_BULK_FUNCTION_MISSING'; end if;
  transformed := regexp_replace(definition,
    'CREATE OR REPLACE FUNCTION public\.bulk_import_master_snapshot_v1\s*\([^)]*\)',
    'CREATE OR REPLACE FUNCTION public.finalize_master_snapshot_stage_v1(p_run_id uuid, p_request_id uuid, p_source_digest text)', 'i');
  if transformed = definition then raise exception 'MASTER_SNAPSHOT_CHUNK_SIGNATURE_ANCHOR_INVALID'; end if;
  transformed := replace(transformed, '  v_rows jsonb := p_rows;', '');
  anchor := '  request_row app_sync_private.ph_master_bulk_import_receipts_v1;';
  if length(transformed)-length(replace(transformed,anchor,'')) <> length(anchor) then
    raise exception 'MASTER_SNAPSHOT_CHUNK_RECEIPT_DECLARATION_ANCHOR_INVALID';
  end if;
  transformed := replace(transformed,anchor,anchor || E'\n  stage_row app_sync_private.ph_master_snapshot_stage_v1%rowtype;\n  stage_relation_kind "char";\n  stage_error_message text;\n  stage_columns text;');
  transformed := replace(transformed,'if source_rows <> jsonb_array_length(p_rows)','if source_rows <> stage_row.expected_rows');

  start_at := position('  if p_run_id is null or p_request_id is null' in transformed);
  end_at := position('  insert into app_sync_private.ph_master_bulk_import_receipts_v1(' in transformed);
  if start_at = 0 or end_at <= start_at then raise exception 'MASTER_SNAPSHOT_CHUNK_INPUT_ANCHOR_INVALID'; end if;
  replacement := $body$
  if p_run_id is null or p_request_id is null
     or p_source_digest is null or p_source_digest !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_INPUT_INVALID';
  end if;
  perform set_config('statement_timeout','120s',true);
  perform set_config('lock_timeout','15s',true);
  perform app_sync_private.assert_master_snapshot_stage_fence_v1(p_run_id);
  select * into stage_row from app_sync_private.ph_master_snapshot_stage_v1 s
  where s.request_id=p_request_id for update;
  if not found or stage_row.source_digest is distinct from p_source_digest then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_NOT_ACTIVE';
  end if;
  if stage_row.status not in ('staging','published')
     or (stage_row.status='staging' and stage_row.run_id is distinct from p_run_id) then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_NOT_ACTIVE';
  end if;
  if stage_row.status='published' then
    select * into request_row from app_sync_private.ph_master_bulk_import_receipts_v1 r
    where r.request_id=p_request_id for update;
    if not found or request_row.run_id is distinct from stage_row.publication_run_id
       or request_row.source_digest is distinct from stage_row.source_digest
       or request_row.response is distinct from stage_row.published_response then
      raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_RECEIPT_MISSING';
    end if;
    return (stage_row.published_response - 'runId' - 'replayed')
      || jsonb_build_object('runId',p_run_id,'publicationRunId',stage_row.publication_run_id,
        'sourceManifestDigest',stage_row.source_manifest_digest,'replayed',true);
  end if;
  if (select count(*) from app_sync_private.ph_master_snapshot_stage_chunks_v1 c where c.request_id=p_request_id)
       <> stage_row.expected_chunks
     or (select coalesce(sum(c.row_count),0) from app_sync_private.ph_master_snapshot_stage_chunks_v1 c where c.request_id=p_request_id)
       <> stage_row.expected_rows
     or (select count(*) from app_sync_private.ph_master_snapshot_stage_rows_v1 s where s.request_id=p_request_id)
       <> stage_row.expected_rows then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_INCOMPLETE';
  end if;
  stage_columns := app_sync_private.master_snapshot_stage_columns_v1('s');
  payload_hash := stage_row.payload_hash;
$body$;
  transformed := substr(transformed,1,start_at-1) || replacement || substr(transformed,end_at);

  start_at := position('  insert into app_sync_private.ph_master_bulk_import_receipts_v1(' in transformed);
  end_at := position('  create unique index ph_master_bulk_stage_v1_uidx' in transformed);
  if start_at = 0 or end_at <= start_at then raise exception 'MASTER_SNAPSHOT_CHUNK_RECEIPT_BLOCK_ANCHOR_INVALID'; end if;
  replacement := $body$
  insert into app_sync_private.ph_master_bulk_import_receipts_v1(
    request_id, run_id, payload_hash, source_digest
  ) values (p_request_id,p_run_id,payload_hash,p_source_digest)
  on conflict (request_id) do nothing;
  select * into request_row from app_sync_private.ph_master_bulk_import_receipts_v1 r
  where r.request_id=p_request_id for update;
  if request_row.run_id is distinct from p_run_id
     or request_row.payload_hash is distinct from payload_hash
     or request_row.source_digest is distinct from p_source_digest then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_REQUEST_ID_REUSED';
  end if;
  if request_row.response is not null then
    raise exception using errcode = '55000', message = 'MASTER_SNAPSHOT_STAGE_RECEIPT_CONFLICT';
  end if;

  if (select count(*) from app_sync_private.ph_master_snapshot_stage_rows_v1 s where s.request_id=p_request_id) <> stage_row.expected_rows
     or exists(select 1 from app_sync_private.ph_master_snapshot_stage_rows_v1 s
       where s.request_id=p_request_id and (jsonb_typeof(s.raw_values) is distinct from 'object'
         or s.unique_id is null or btrim(s.unique_id)=''
         or cardinality(s.raw_item6_fields) <> s.raw_item6_count)) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_ROW_INVALID';
  end if;
  if exists(select 1 from app_sync_private.ph_master_snapshot_stage_rows_v1 s
    where s.request_id=p_request_id group by s.unique_id having count(*)>1) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_DUPLICATE_UNIQUE_ID';
  end if;

  select c.relkind into stage_relation_kind
  from pg_class c where c.oid=to_regclass('pg_temp.ph_master_bulk_stage_v1');
  if stage_relation_kind='v' then
    drop view pg_temp.ph_master_bulk_stage_v1;
  elsif stage_relation_kind in ('r','p') then
    drop table pg_temp.ph_master_bulk_stage_v1;
  end if;
  execute format(
    'create temp view ph_master_bulk_stage_v1 as
     select s.row_number::bigint as row_number,s.raw_values,s.raw_item6_count,
       s.raw_item6_fields,s.field_keys,s.lineage_key,s.source_hash,%s,
       null::text as warehousei
     from app_sync_private.ph_master_snapshot_stage_rows_v1 s
     where s.request_id=%L::uuid',stage_columns,p_request_id);
$body$;
  transformed := substr(transformed,1,start_at-1) || replacement || substr(transformed,end_at);

  anchor := '  create unique index ph_master_bulk_stage_v1_uidx on pg_temp.ph_master_bulk_stage_v1(unique_id);';
  if length(transformed)-length(replace(transformed,anchor,'')) <> length(anchor) then
    raise exception 'MASTER_SNAPSHOT_CHUNK_TEMP_STAGE_INDEX_ANCHOR_INVALID';
  end if;
  transformed := replace(transformed,anchor,'');
  anchor := '  create index ph_master_bulk_stage_v1_lineage_idx on pg_temp.ph_master_bulk_stage_v1(lineage_key);';
  if length(transformed)-length(replace(transformed,anchor,'')) <> length(anchor) then
    raise exception 'MASTER_SNAPSHOT_CHUNK_TEMP_LINEAGE_INDEX_ANCHOR_INVALID';
  end if;
  transformed := replace(transformed,anchor,'');

  anchor := '  create index if not exists reclass_bulk_stage_lineage_idx on pg_temp.ph_master_bulk_stage_v1(lineage_key);';
  if length(transformed)-length(replace(transformed,anchor,'')) <> length(anchor) then
    raise exception 'MASTER_SNAPSHOT_CHUNK_RECLASS_STAGE_INDEX_ANCHOR_INVALID';
  end if;
  transformed := replace(transformed,anchor,'');

  anchor := E'  if exists (\n    select 1 from pg_temp.ph_master_bulk_stage_v1 s\n    where exists(select 1 from unnest(s.raw_item6_fields) f(field_name)\n      where not (f.field_name = any(allowed_item6)) or not (s.raw_values ? f.field_name))\n       or exists(select 1 from unnest(allowed_item6) f(field_name)\n      where s.raw_values ? f.field_name and not (f.field_name = any(s.raw_item6_fields)))\n  ) then\n    raise exception using errcode = ''22023'', message = ''BULK_MASTER_IMPORT_ITEM6_MASK_INVALID'';\n  end if;';
  if length(transformed)-length(replace(transformed,anchor,'')) <> length(anchor) then
    raise exception 'MASTER_SNAPSHOT_CHUNK_ITEM6_VALIDATION_ANCHOR_INVALID';
  end if;
  transformed := replace(transformed,anchor,'');

  anchor := E'  if exists (\n    select 1\n    from (select distinct unnest(s.field_keys) as key from pg_temp.ph_master_bulk_stage_v1 s) k\n    where not exists (\n        select 1 from pg_attribute a\n        where a.attrelid = ''public.ph_master_inventory''::regclass\n          and a.attname = k.key and a.attnum > 0 and not a.attisdropped\n    )\n  ) then\n    raise exception using errcode = ''22023'', message = ''BULK_MASTER_IMPORT_COLUMN_INVALID'';\n  end if;';
  if length(transformed)-length(replace(transformed,anchor,'')) <> length(anchor) then
    raise exception 'MASTER_SNAPSHOT_CHUNK_COLUMN_VALIDATION_ANCHOR_INVALID';
  end if;
  transformed := replace(transformed,anchor,'');

  if position('p_rows' in transformed) > 0 or position('v_rows jsonb := p_rows' in transformed) > 0 then
    raise exception 'MASTER_SNAPSHOT_CHUNK_UNREPLACED_ROWS_ARGUMENT';
  end if;
  anchor := '  response_value := jsonb_build_object(';
  count_anchor := length(transformed)-length(replace(transformed,anchor,''));
  if count_anchor <> length(anchor) then raise exception 'MASTER_SNAPSHOT_CHUNK_RESPONSE_ANCHOR_INVALID'; end if;
  anchor := '    ''unchanged'', unchanged_rows';
  if position(anchor in transformed)=0 then raise exception 'MASTER_SNAPSHOT_CHUNK_RESPONSE_FIELDS_ANCHOR_INVALID'; end if;
  transformed := replace(transformed,anchor,anchor || E'\n    ,''status'',''published'',''replayed'',false' ||
    E'\n    ,''sourceManifestDigest'',stage_row.source_manifest_digest,''publicationRunId'',p_run_id');
  anchor := E'  update app_sync_private.ph_master_bulk_import_receipts_v1\n  set response = response_value\n  where request_id = p_request_id;';
  if position(anchor in transformed)=0 then raise exception 'MASTER_SNAPSHOT_CHUNK_FINAL_RECEIPT_ANCHOR_INVALID'; end if;
  transformed := replace(transformed,anchor,anchor || E'\n  update app_sync_private.ph_master_snapshot_stage_v1\n  set status=''published'', publication_run_id=p_run_id, published_response=response_value, updated_at=clock_timestamp()\n  where request_id=p_request_id and status=''staging'';');
  anchor := E'  update app_sync_private.ph_master_snapshot_stage_v1\n  set status=''published'', publication_run_id=p_run_id, published_response=response_value, updated_at=clock_timestamp()\n  where request_id=p_request_id and status=''staging'';';
  if position(anchor in transformed)=0 then raise exception 'MASTER_SNAPSHOT_CHUNK_ROW_CLEANUP_ANCHOR_INVALID'; end if;
  transformed := replace(transformed,anchor,anchor || E'\n  delete from app_sync_private.ph_master_snapshot_stage_rows_v1 where request_id=p_request_id;');
  anchor := '  return response_value;';
  if length(transformed)-length(replace(transformed,anchor,'')) <> length(anchor) then
    raise exception 'MASTER_SNAPSHOT_CHUNK_TEMP_VIEW_CLEANUP_ANCHOR_INVALID';
  end if;
  transformed := replace(transformed,anchor,'  drop view pg_temp.ph_master_bulk_stage_v1;' || E'\n' || anchor);
  anchor := '  return response_value;';
  if length(transformed)-length(replace(transformed,anchor,'')) <> length(anchor) then
    raise exception 'MASTER_SNAPSHOT_CHUNK_ERROR_TRANSLATION_ANCHOR_INVALID';
  end if;
  replacement := $body$
  return response_value;
exception when sqlstate '40001' then
  get stacked diagnostics stage_error_message = message_text;
  if left(stage_error_message,length('MASTER_ITEM6_'))='MASTER_ITEM6_'
     or left(stage_error_message,length('MASTER_PRIORITY_HOLD_'))='MASTER_PRIORITY_HOLD_'
     or left(stage_error_message,length('BULK_MASTER_IMPORT_'))='BULK_MASTER_IMPORT_' then
    raise exception using errcode='55000', message=stage_error_message;
  end if;
  raise;
$body$;
  transformed := replace(transformed,anchor,replacement);
  execute transformed;
  execute 'alter function public.finalize_master_snapshot_stage_v1(uuid,uuid,text) set statement_timeout to ''120s''';
  execute 'alter function public.finalize_master_snapshot_stage_v1(uuid,uuid,text) set lock_timeout to ''15s''';
end
$migration$;

-- Restrict value comparisons to keys actually present in this source tuple.
-- Pending acknowledgements still execute the existing protection triggers even
-- when incoming values already equal the live values.
do $incoming_value_guard$
declare
  function_oid oid := 'public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure;
  definition text;
  anchor text;
  replacement text;
begin
  select pg_get_functiondef(function_oid) into definition;
  anchor := '  direct_set_values text;';
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_SNAPSHOT_VALUE_GUARD_DECLARATION_INVALID';
  end if;
  definition := replace(definition,anchor,anchor || E'\n  incoming_target_values text;\n  incoming_source_values text;\n  upsert_target_values text;\n  upsert_incoming_values text;\n  direct_difference text;\n  upsert_difference text;');
  anchor := $anchor$    set_values := coalesce(set_values || ', ', '')
      || 'assignedto = coalesce(private.ph_master_bulk_assignedto_override_v1(to_jsonb(excluded)), '
      || 'private.ph_master_bulk_assignedto_override_v1(to_jsonb(target)), target.assignedto)';$anchor$;
  replacement := $body$    -- Source reports do not own existing assignments. Retain the established
    -- INSERT default; legacy assignment reconciliation is a separate worker.
    set_values := coalesce(set_values,'assignedto = target.assignedto');

    select string_agg(format('target.%I',f.column_name),',' order by f.ordinality),
      string_agg(format('s.%I',f.column_name),',' order by f.ordinality)
      into incoming_target_values,incoming_source_values
    from unnest(tuple_value.field_keys) with ordinality f(column_name,ordinality)
    where f.column_name<>'unique_id';

    select string_agg(format('target.%I',f.column_name),',' order by f.ordinality),
      string_agg(case when f.column_name=any(app_owned) then
        format('case when private.ph_master_bulk_has_value_v1(target.%1$I::text) then target.%1$I else excluded.%1$I end',f.column_name)
        else format('excluded.%I',f.column_name) end,',' order by f.ordinality)
      into upsert_target_values,upsert_incoming_values
    from unnest(update_fields) with ordinality f(column_name,ordinality);
    upsert_difference := format('(ROW(%s) IS DISTINCT FROM ROW(%s))',
      upsert_target_values,upsert_incoming_values);$body$;
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_SNAPSHOT_VALUE_GUARD_ASSIGNMENT_INVALID';
  end if;
  definition := replace(definition,anchor,replacement);

  -- Compare only incoming fields. Source absence never changes existing
  -- assignments or app-owned values.
  anchor := $anchor$    direct_set_values := replace(set_values, 'excluded', 's');$anchor$;
  replacement := anchor || $body$
    direct_difference := format('(ROW(%s) IS DISTINCT FROM ROW(%s) or private.ph_master_bulk_pending_ack_v1(target.unique_id,s.raw_values))',
      incoming_target_values,incoming_source_values);$body$;
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_SNAPSHOT_VALUE_GUARD_DIRECT_ASSIGNMENT_INVALID';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$         returning target.unique_id
       ) select count(*)::integer, coalesce(array_agg(unique_id), ''{}''::text[]) from affected',
      direct_set_values$anchor$;
  replacement := $body$           and %s
         returning target.unique_id
       ) select count(*)::integer, coalesce(array_agg(unique_id), ''{}''::text[]) from affected',
      direct_set_values,direct_difference$body$;
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_SNAPSHOT_VALUE_GUARD_DIRECT_QUERY_INVALID';
  end if;
  definition := replace(definition,anchor,replacement);

  anchor := $anchor$    sql_text := format(
      'with affected as (
         insert into public.ph_master_inventory as target (%s)$anchor$;
  replacement := $body$    -- Keep raw protected-field changes and pending acknowledgements eligible
    -- for the canonical guards, even when effective SET values are unchanged.
    changed_predicate := '(' || changed_predicate || ') and (' || upsert_difference
      || ' or exists(select 1 from private.ph_master_bulk_context_v1('
      || quote_literal(p_run_id::text) || '::uuid,target.unique_id) c where '
      || 'private.ph_master_bulk_pending_ack_v1(target.unique_id,c.raw_values)'
      || ' or (c.raw_values ? ''holdstopcode'' and target.holdstopcode IS DISTINCT FROM c.raw_values->>''holdstopcode'')'
      || ' or (c.raw_values ? ''holdstopreason'' and target.holdstopreason IS DISTINCT FROM c.raw_values->>''holdstopreason'')'
      || ' or (c.raw_values ? ''locationnote'' and target.locationnote IS DISTINCT FROM c.raw_values->>''locationnote'')))';
    sql_text := format(
      'with affected as (
         insert into public.ph_master_inventory as target (%s)$body$;
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_SNAPSHOT_VALUE_GUARD_UPSERT_QUERY_INVALID';
  end if;
  definition := replace(definition,anchor,replacement);
  execute definition;
end
$incoming_value_guard$;

-- Serialize only the assignment helper's source fields for new-row defaults,
-- preserving its precedence and null/blank behavior.
do $assignedto_projection$
declare
  function_oid oid := 'public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure;
  helper_oid oid := 'private.ph_master_bulk_assignedto_override_v1(jsonb)'::regprocedure;
  function_definition text;
  helper_definition text;
  expected_keys constant text[] := array[
    'COMMONNAME','DESCRIPTION','GENUS','GENUSNAME','LOCATION','LOCATIONCODE',
    'PLANTGROUP','PLANTGROUPCODE','commonname','description','genus','genusname',
    'location','locationcode','plantgroup','plantgroupcode'
  ];
  actual_keys text[];
  row_alias text;
  arguments_sql text;
  projection_sql text;
  old_expression text;
  new_expression text;
  old_owner oid;
  old_acl aclitem[];
  old_config text[];
  old_security_definer boolean;
begin
  select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
    into function_definition,old_owner,old_acl,old_config,old_security_definer
  from pg_proc p where p.oid=function_oid;
  if function_definition is null or old_security_definer is distinct from true then
    raise exception 'MASTER_ASSIGNEDTO_PROJECTION_FUNCTION_INVALID';
  end if;

  select pg_get_functiondef(helper_oid) into helper_definition;
  select array_agg(distinct matched_keys.parts[1] collate "C" order by matched_keys.parts[1] collate "C")
    into actual_keys
  from regexp_matches(helper_definition, $pattern$p_row->>'([^']+)'$pattern$, 'g') as matched_keys(parts);
  if actual_keys is distinct from expected_keys then
    raise exception 'MASTER_ASSIGNEDTO_PROJECTION_HELPER_KEYS_CHANGED';
  end if;

  foreach row_alias in array array['s'] loop
    select string_agg(format('%L,%s.%I',a.attname,row_alias,a.attname),',' order by a.attnum)
      into arguments_sql
    from pg_attribute a
    where a.attrelid=(case when row_alias='s'
        then 'app_sync_private.ph_master_snapshot_stage_rows_v1'::regclass
        else 'public.ph_master_inventory'::regclass end)
      and a.attnum>(case when row_alias='s' then 8 else 0 end) and not a.attisdropped
      and a.attname=any(expected_keys);
    projection_sql := 'jsonb_build_object(' || coalesce(arguments_sql,'') || ')';
    old_expression := format('private.ph_master_bulk_assignedto_override_v1(to_jsonb(%s))',row_alias);
    -- This anchor occurs inside a dynamic-SQL string literal in the
    -- finalizer source. Double the projection's quotes at this nesting level.
    new_expression := 'private.ph_master_bulk_assignedto_override_v1('
      || replace(projection_sql,'''','''''') || ')';
    if length(function_definition)-length(replace(function_definition,old_expression,''))
       <> length(old_expression) then
      raise exception 'MASTER_ASSIGNEDTO_PROJECTION_ANCHOR_INVALID: %',row_alias;
    end if;
    function_definition := replace(function_definition,old_expression,new_expression);
  end loop;
  execute function_definition;
  if not exists (
    select 1 from pg_proc p where p.oid=function_oid
      and p.proowner=old_owner and p.proacl is not distinct from old_acl
      and p.proconfig is not distinct from old_config and p.prosecdef=old_security_definer
  ) then
    raise exception 'MASTER_ASSIGNEDTO_PROJECTION_SECURITY_CHANGED';
  end if;
end
$assignedto_projection$;


-- Only the fenced finalizer can populate this private transaction proof.
alter table app_sync_private.ph_master_bulk_import_context_v1
  add column new_insert_verified boolean not null default false;

create table app_sync_private.ph_master_new_insert_statement_v1(
  backend_pid integer not null, transaction_id bigint not null,
  run_id uuid not null, request_id uuid not null,
  primary key(backend_pid,transaction_id)
);
alter table app_sync_private.ph_master_new_insert_statement_v1 enable row level security;
revoke all on app_sync_private.ph_master_new_insert_statement_v1 from public,anon,authenticated,service_role;
create or replace function private.validate_ph_master_new_insert_statement_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  -- A caller-supplied GUC is never sufficient. Only a private, transaction-bound
  -- proof set immediately around the finalizer's dedicated INSERT enables it.
  perform set_config('gnc.master_snapshot_verified_insert','',true);
  if pg_trigger_depth()=1 and exists(
    select 1 from app_sync_private.ph_master_new_insert_statement_v1 p
    join app_sync_private.import_runs r on r.id=p.run_id and r.state='active' and r.expires_at>clock_timestamp()
    join app_sync_private.import_leases l on l.run_id=r.id and l.key='ph_master_inventory'
    where p.backend_pid=pg_backend_pid() and p.transaction_id=txid_current()
      and 'ph_master_inventory'=any(r.canonical_keys)
  ) then
    perform set_config('gnc.master_snapshot_verified_insert',pg_backend_pid()::text||':'||txid_current()::text,true);
  end if;
  return null;
end
$function$;
revoke all on function private.validate_ph_master_new_insert_statement_v1() from public,anon,authenticated,service_role;
create trigger aa000_validate_master_insert_statement before insert on public.ph_master_inventory
for each statement execute function private.validate_ph_master_new_insert_statement_v1();

-- New-row source baselines are inserted once after the set-based target INSERT.
-- Existing/aliased rows retain the original acknowledgement and edit guards.
do $new_insert_guards$
declare fn text; definition text; anchor text; replacement text;
begin
  foreach fn in array array[
    'private.ph_master_bulk_isolation_v1()',
    'private.resolve_ph_master_inventory_item6_alias_v7()',
    'private.guard_ph_master_inventory_priority_hold_v1()',
    'private.ph_master_bulk_live_field_isolation_v1()',
    'private.refresh_ph_master_inventory_item6_lineage_v7()'
  ] loop
    select pg_get_functiondef(fn::regprocedure) into definition;
    anchor := E'\nbegin\n';
    replacement := anchor || E'  if tg_op=''INSERT'' and current_setting(''gnc.master_snapshot_verified_insert'',true)=pg_backend_pid()::text||'':''||txid_current()::text then\n    return '
      || case when fn like '%refresh_%' then 'null' else 'new' end || E';\n  end if;\n';
    if strpos(definition,anchor)=0 then raise exception 'MASTER_NEW_INSERT_GUARD_ANCHOR: %',fn; end if;
    definition := overlay(definition placing replacement from strpos(definition,anchor) for length(anchor));
    execute definition;
  end loop;
end
$new_insert_guards$;

do $new_insert_batch$
declare definition text; anchor text; replacement text;
begin
  select pg_get_functiondef('public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure) into definition;
  anchor := '  batch_touched text[];';
  if strpos(definition,anchor)=0 then raise exception 'MASTER_NEW_INSERT_DECLARATION_ANCHOR'; end if;
  definition := replace(definition,anchor,anchor || E'\n  batch_new_ids text[];');

  -- Serialize competing identity mutations on the same established Item6 locks.
  anchor := '  drop table if exists pg_temp.ph_master_bulk_map_v1;';
  replacement := $body$
  drop table if exists pg_temp.ph_master_new_insert_ids_v1;
  create temp table ph_master_new_insert_ids_v1(unique_id text primary key) on commit drop;
  perform pg_advisory_xact_lock(lock_key)
  from (
    select distinct hashtextextended('ph-master-item6:'||private.ph_master_inventory_stable_identity_v7(s.raw_values),0) as lock_key
    from pg_temp.ph_master_bulk_stage_v1 s
    where not exists(select 1 from public.ph_master_inventory m where m.unique_id=s.unique_id)
    order by lock_key
  ) identity_locks;
  drop table if exists pg_temp.ph_master_bulk_map_v1;$body$;
  if strpos(definition,anchor)=0 then raise exception 'MASTER_NEW_INSERT_LOCK_ANCHOR'; end if;
  definition := replace(definition,anchor,replacement);

  anchor := '  previous_crop_roll_marker := current_setting(''gnc.master_bulk_crop_roll_deferred'', true);';
  replacement := $body$
  -- Only genuinely new, unique physical tuples take the batch path. Known
  -- aliases, orphan aliases, and duplicate source/stable tuples execute the
  -- complete original row guards, including all ambiguity rejection rules.
  with incoming as materialized (
    select s.unique_id,s.lineage_key,private.ph_master_inventory_stable_identity_v7(s.raw_values) as stable_key
    from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 m using(row_number)
    where m.canonical_unique_id is null
  ), unique_tuples as materialized (
    select i.*,count(*) over(partition by lineage_key) as lineage_count,
      count(*) over(partition by stable_key) as stable_count from incoming i
  )
  update app_sync_private.ph_master_bulk_import_context_v1 c set new_insert_verified=true
  from unique_tuples i
  where c.run_id=p_run_id and c.request_id=p_request_id and c.backend_pid=pg_backend_pid()
    and c.transaction_id=txid_current() and c.canonical_unique_id is null
    and c.source_unique_id=i.unique_id and i.lineage_count=1 and i.stable_count=1
    and not exists(select 1 from app_sync_private.ph_master_inventory_item6_aliases_v7 a where a.imported_unique_id=i.unique_id)
    and not exists(select 1 from app_sync_private.ph_master_inventory_item6_source_v7 b
      join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id where b.stable_identity_key=i.stable_key);
  previous_crop_roll_marker := current_setting('gnc.master_bulk_crop_roll_deferred', true);$body$;
  if strpos(definition,anchor)=0 then raise exception 'MASTER_NEW_INSERT_MARKER_ANCHOR'; end if;
  definition := replace(definition,anchor,replacement);
  anchor := $anchor$    changed_predicate := '(select c.source_hash from private.ph_master_bulk_context_v1('$anchor$;
  replacement := $body$    -- Insert proven, genuinely new tuples in their own statement. A race on
    -- unique_id falls back to the original guarded upsert below.
    insert into app_sync_private.ph_master_new_insert_statement_v1(backend_pid,transaction_id,run_id,request_id)
    values(pg_backend_pid(),txid_current(),p_run_id,p_request_id);
    sql_text := format(
      'with affected as (
        insert into public.ph_master_inventory (%s)
        select %s from pg_temp.ph_master_bulk_stage_v1 s
        join app_sync_private.ph_master_bulk_import_context_v1 c on c.source_unique_id=s.unique_id
          and c.run_id=$3 and c.request_id=$4 and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()
        where c.new_insert_verified and s.raw_item6_fields=$1 and s.field_keys=$2
        on conflict(unique_id) do nothing returning unique_id
      ) select count(*)::integer,coalesce(array_agg(unique_id),''{}''::text[]) from affected',
      column_names,select_values);
    execute sql_text into batch_inserted,batch_new_ids using tuple_value.raw_item6_fields,tuple_value.field_keys,p_run_id,p_request_id;
    inserted_rows := inserted_rows+batch_inserted;
    insert into pg_temp.ph_master_new_insert_ids_v1 select unnest(batch_new_ids) on conflict do nothing;
    touched_ids := touched_ids||batch_new_ids;
    delete from app_sync_private.ph_master_new_insert_statement_v1
    where backend_pid=pg_backend_pid() and transaction_id=txid_current();
    perform set_config('gnc.master_snapshot_verified_insert','',true);
    changed_predicate := '(select c.source_hash from private.ph_master_bulk_context_v1('$body$;
  if strpos(definition,anchor)=0 then raise exception 'MASTER_NEW_INSERT_DEDICATED_ANCHOR'; end if;
  definition := replace(definition,anchor,replacement);
  anchor := '           and mapped.canonical_unique_id is distinct from s.unique_id';
  if strpos(definition,anchor)=0 then raise exception 'MASTER_NEW_INSERT_REMAINDER_ANCHOR'; end if;
  definition := replace(definition,anchor,anchor || E'\n           and not exists(select 1 from pg_temp.ph_master_new_insert_ids_v1 ni where ni.unique_id=s.unique_id)');
  anchor := $anchor$           coalesce(array_agg(unique_id), ''{}''::text[]) from affected',
      column_names, select_values, set_values, changed_predicate$anchor$;
  replacement := $body$           coalesce(array_agg(unique_id), ''{}''::text[]),
           coalesce(array_agg(unique_id) filter (where inserted), ''{}''::text[]) from affected',
      column_names, select_values, set_values, changed_predicate$body$;
  if strpos(definition,anchor)=0 then raise exception 'MASTER_NEW_INSERT_RETURNING_ANCHOR'; end if;
  definition := replace(definition,anchor,replacement);
  anchor := '    execute sql_text into batch_inserted, batch_updated, batch_touched using tuple_value.raw_item6_fields, tuple_value.field_keys;';
  replacement := replace(anchor,'batch_touched using','batch_touched,batch_new_ids using') || E'\n    insert into pg_temp.ph_master_new_insert_ids_v1 select unnest(batch_new_ids) on conflict do nothing;';
  if strpos(definition,anchor)=0 then raise exception 'MASTER_NEW_INSERT_EXECUTE_ANCHOR'; end if;
  definition := replace(definition,anchor,replacement);

  anchor := '  unchanged_rows := greatest(0, source_rows - inserted_rows - updated_rows);';
  replacement := anchor || $body$
  insert into app_sync_private.ph_master_inventory_source_baselines(
    canonical_unique_id,lineage_key,priority,holdstopcode,holdstopreason,import_run_id
  )
  select s.unique_id,s.lineage_key,s.priority,s.holdstopcode,s.holdstopreason,p_run_id
  from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_new_insert_ids_v1 ni using(unique_id)
  on conflict(canonical_unique_id) do nothing;
  insert into app_sync_private.ph_master_inventory_item6_source_v7(
    canonical_unique_id,stable_identity_key,field_values,imported_at,import_run_id
  )
  select s.unique_id,private.ph_master_inventory_stable_identity_v7(s.raw_values),
    jsonb_build_object('locationnote',s.locationnote,'locationptn1',s.locationptn1,
      'desigitem',s.desigitem,'desigcust',s.desigcust,'desigloc',s.desigloc,
      'pullerresponsibility',s.pullerresponsibility,'oversellpercentage',s.oversellpercentage,
      'salesnote',s.salesnote,'suspend',s.suspend),clock_timestamp(),p_run_id
  from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_new_insert_ids_v1 ni using(unique_id)
  on conflict(canonical_unique_id) do nothing;
  $body$;
  if strpos(definition,anchor)=0 then raise exception 'MASTER_NEW_INSERT_BASELINE_ANCHOR'; end if;
  definition := replace(definition,anchor,replacement);
  execute definition;
end
$new_insert_batch$;


-- The canonical bulk context is transaction-local. Preserve the prior UNION
-- branch priority while avoiding planning all branches for every inserted row.
create or replace function private.ph_master_bulk_context_v1(p_run_id uuid, p_unique_id text)
returns app_sync_private.ph_master_bulk_import_context_v1
language plpgsql volatile security definer set search_path = ''
as $function$
declare matched app_sync_private.ph_master_bulk_import_context_v1;
begin
  select c.* into matched from app_sync_private.ph_master_bulk_import_context_v1 c
  where c.run_id=p_run_id and c.backend_pid=pg_backend_pid()
    and c.transaction_id=txid_current() and c.source_unique_id=p_unique_id limit 1;
  if found then return matched; end if;
  select c.* into matched from app_sync_private.ph_master_bulk_import_context_v1 c
  where c.run_id=p_run_id and c.backend_pid=pg_backend_pid()
    and c.transaction_id=txid_current() and c.canonical_unique_id=p_unique_id limit 1;
  if found then return matched; end if;
  select c.* into matched from app_sync_private.ph_master_inventory_import_lineage_seen seen
  join app_sync_private.ph_master_bulk_import_context_v1 c
    on c.run_id=seen.run_id and c.source_unique_id=seen.imported_unique_id
  where seen.run_id=p_run_id and seen.canonical_unique_id=p_unique_id
    and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current() limit 1;
  if found then return matched; end if;
  select c.* into matched from app_sync_private.ph_master_inventory_item6_alias_seen_v7 seen
  join app_sync_private.ph_master_bulk_import_context_v1 c
    on c.run_id=seen.run_id and c.source_unique_id=seen.imported_unique_id
  where seen.run_id=p_run_id and seen.canonical_unique_id=p_unique_id
    and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current() limit 1;
  return matched;
end
$function$;
revoke all on function private.ph_master_bulk_context_v1(uuid, text)
  from public, anon, authenticated, service_role;

-- The item6 alias trigger only needs identity columns and three designations.
-- Avoid serializing the full 213-column master row for each trigger call.
do $narrow_item6_alias$
declare
  function_oid oid := 'private.resolve_ph_master_inventory_item6_alias_v7()'::regprocedure;
  definition text;
  old_owner oid;
  old_acl aclitem[];
  old_config text[];
  old_security_definer boolean;
  old_lineage constant text := 'private.ph_master_inventory_lineage_key_v1(to_jsonb(new))';
  new_lineage constant text := 'private.ph_master_inventory_lineage_key_v1(new)';
  old_stable constant text := 'private.ph_master_inventory_stable_identity_v7(to_jsonb(new))';
  new_stable constant text := 'private.ph_master_inventory_stable_identity_v7(new)';
  old_incoming constant text := 'incoming := to_jsonb(new);';
  new_incoming constant text := 'incoming := jsonb_build_object(''desigitem'',new.desigitem,''desigcust'',new.desigcust,''desigloc'',new.desigloc);';
begin
  select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
    into definition,old_owner,old_acl,old_config,old_security_definer
  from pg_proc p where p.oid=function_oid;
  if definition is null or old_security_definer is distinct from true
     or length(definition)-length(replace(definition,old_lineage,'')) <> length(old_lineage)
     or length(definition)-length(replace(definition,old_stable,'')) <> length(old_stable)
     or length(definition)-length(replace(definition,old_incoming,'')) <> length(old_incoming) then
    raise exception 'MASTER_ITEM6_ALIAS_PROJECTION_ANCHOR_INVALID';
  end if;
  definition := replace(definition,old_lineage,new_lineage);
  definition := replace(definition,old_stable,new_stable);
  definition := replace(definition,old_incoming,new_incoming);
  execute definition;
  if not exists (
    select 1 from pg_proc p where p.oid=function_oid
      and p.proowner=old_owner and p.proacl is not distinct from old_acl
      and p.proconfig is not distinct from old_config and p.prosecdef=old_security_definer
  ) then
    raise exception 'MASTER_ITEM6_ALIAS_SECURITY_CHANGED';
  end if;
end
$narrow_item6_alias$;

-- The set-based crop/roll sync only needs this projection from master rows.
-- Keeping the existing public JSON mapper avoids changing its normalization or
-- defaults, while avoiding serialization of the inventory table's unrelated
-- columns. Two jsonb_build_object calls keep each call below PostgreSQL's
-- function-argument limit.
create or replace function private.ph_master_crop_roll_mapper_input_v1(
  p_master public.ph_master_inventory
)
returns jsonb
language sql immutable strict
set search_path = ''
as $function$
  select jsonb_build_object(
    'unique_id', p_master.unique_id,
    'locationcode', p_master.locationcode,
    'itemcode', p_master.itemcode,
    'last_updated', p_master.last_updated,
    'warehouseid', p_master.warehouseid,
    'plantgroupcode', p_master.plantgroupcode,
    'qualitycode', p_master.qualitycode,
    'contsize', p_master.contsize,
    'itemspec', p_master.itemspec,
    'commonname', p_master.commonname,
    'genusname', p_master.genusname,
    'botanicalname', p_master.botanicalname,
    'lotcode', p_master.lotcode,
    'source', p_master.source,
    'desigitem', p_master.desigitem,
    'desigcust', p_master.desigcust,
    'desigloc', p_master.desigloc,
    'priority', p_master.priority,
    'ptravailable', p_master.ptravailable,
    'ptronhand', p_master.ptronhand,
    'ptrreviewed', p_master.ptrreviewed,
    's_lts', p_master.s_lts,
    'season_supply', p_master.season_supply,
    'saleyear', p_master.saleyear,
    'locationnote', p_master.locationnote,
    'locationnotedate', p_master.locationnotedate,
    'locationptn1', p_master.locationptn1,
    'fieldtagcolor', p_master.fieldtagcolor,
    'field_tag_color', p_master.field_tag_color,
    'holdstopcode', p_master.holdstopcode
  ) || jsonb_build_object(
    'holdstopreason', p_master.holdstopreason,
    'holdstopbegindate', p_master.holdstopbegindate,
    'season', p_master.season,
    'blockalpha', p_master.blockalpha,
    'blocknumber', p_master.blocknumber,
    'app_tab_assignment', p_master.app_tab_assignment,
    'assignedto', p_master.assignedto,
    'date_completed', p_master.date_completed,
    'av_note', p_master.av_note,
    'sales_note', p_master.sales_note,
    'salesnote', p_master.salesnote,
    'match', p_master.match,
    'loc_match_qty', p_master.loc_match_qty,
    'initial_ptr', p_master.initial_ptr,
    'spec', p_master.spec,
    'caliper', p_master.caliper,
    'photo_link', p_master.photo_link,
    'photo_name', p_master.photo_name,
    'dock_photo_link', p_master.dock_photo_link,
    'dock_photo_name', p_master.dock_photo_name,
    'flyer_photo_link', p_master.flyer_photo_link,
    'flyer_photo_name', p_master.flyer_photo_name,
    'flyer_completed', p_master.flyer_completed,
    'flyer_av_note', p_master.flyer_av_note,
    'flyer_match', p_master.flyer_match,
    'flyer_loc_match_qty', p_master.flyer_loc_match_qty,
    'flyer_spec', p_master.flyer_spec,
    'flyer_caliper', p_master.flyer_caliper,
    'flyer_pick', p_master.flyer_pick,
    'flyer_initial_ptr', p_master.flyer_initial_ptr
  );
$function$;
alter function private.ph_master_crop_roll_mapper_input_v1(public.ph_master_inventory) owner to postgres;
revoke all on function private.ph_master_crop_roll_mapper_input_v1(public.ph_master_inventory)
  from public, anon, authenticated, service_role;

-- Patch only the mapper input expression in the existing fenced sync routine.
-- CREATE OR REPLACE preserves the routine's ACL/owner; verify security-definer
-- and execution settings as well so this performance change cannot broaden or
-- weaken the established import fence.
do $crop_projection$
declare
  function_oid oid := 'private.sync_ph_master_bulk_crop_roll_v1(uuid,uuid,text[])'::regprocedure;
  function_definition text;
  old_expression constant text := 'public.v2_crop_roll_drive_row_from_json(to_jsonb(master))';
  new_expression constant text := 'public.v2_crop_roll_drive_row_from_json(private.ph_master_crop_roll_mapper_input_v1(master))';
  old_owner oid;
  old_acl aclitem[];
  old_config text[];
  old_security_definer boolean;
begin
  select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
    into function_definition,old_owner,old_acl,old_config,old_security_definer
  from pg_proc p where p.oid=function_oid;
  if function_definition is null or old_security_definer is distinct from true
     or length(function_definition)-length(replace(function_definition,old_expression,'')) <> length(old_expression) then
    raise exception 'MASTER_CROP_ROLL_MAPPER_PATCH_ANCHOR_INVALID';
  end if;
  execute replace(function_definition,old_expression,new_expression);
  if not exists (
    select 1 from pg_proc p where p.oid=function_oid
      and p.proowner=old_owner and p.proacl is not distinct from old_acl
      and p.proconfig is not distinct from old_config and p.prosecdef=old_security_definer
  ) then
    raise exception 'MASTER_CROP_ROLL_SYNC_SECURITY_CHANGED';
  end if;
end
$crop_projection$;

revoke all on function public.finalize_master_snapshot_stage_v1(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.finalize_master_snapshot_stage_v1(uuid,uuid,text) to service_role;

create or replace function public.cleanup_master_snapshot_staging_v1(p_older_than timestamptz,p_limit integer default 20)
returns integer
language plpgsql security definer set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '2s'
as $function$
declare deleted_count integer;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501', message='MASTER_SNAPSHOT_STAGE_FORBIDDEN';
  end if;
  if p_older_than is null or p_older_than > clock_timestamp() - interval '24 hours'
     or p_limit not between 1 and 20 then
    raise exception using errcode='22023', message='MASTER_SNAPSHOT_STAGE_CLEANUP_INPUT_INVALID';
  end if;
  with doomed as materialized (
    select s.request_id from app_sync_private.ph_master_snapshot_stage_v1 s
    where s.status='staging' and s.updated_at < p_older_than
      and not exists(select 1 from app_sync_private.import_runs r
        where r.id=s.run_id and r.state='active' and r.expires_at>clock_timestamp())
      and not exists(select 1 from app_sync_private.import_leases l
        where l.key='ph_master_inventory' and l.run_id=s.run_id)
      and not exists(select 1 from app_sync_private.ph_master_bulk_import_receipts_v1 r
        where r.request_id=s.request_id and r.response is not null)
    order by s.updated_at,s.request_id for update skip locked limit p_limit
  )
  delete from app_sync_private.ph_master_snapshot_stage_v1 s
  using doomed d where d.request_id=s.request_id;
  get diagnostics deleted_count=row_count;
  return deleted_count;
end
$function$;
revoke all on function public.cleanup_master_snapshot_staging_v1(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.cleanup_master_snapshot_staging_v1(timestamptz,integer) to service_role;

-- Ignored integration delta: apply AFTER the current Drive migration's final
-- function transformations, inside its transaction. No live/public rows change.
-- Private stage shape grows86 ->87 physical columns:78 imported/generated
-- target values,8 existing metadata values,1 computed stable identity cache.
-- The target table remains213 columns and source contract remains unchanged.
alter table app_sync_private.ph_master_snapshot_stage_rows_v1
  add column stable_identity_key text generated always as
    (private.ph_master_inventory_stable_identity_v7(raw_values)) stored;
create index ph_master_snapshot_stage_rows_stable_idx
  on app_sync_private.ph_master_snapshot_stage_rows_v1(request_id,stable_identity_key);

do $stable_key_cache$
declare definition text; anchor text; replacement text; function_oid oid;
  owner_before oid; acl_before aclitem[]; config_before text[]; security_before boolean;
begin
  -- The source/type contract excludes the extra computed metadata column.
  function_oid:='app_sync_private.master_snapshot_stage_columns_v1(text)'::regprocedure;
  select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
    into definition,owner_before,acl_before,config_before,security_before from pg_proc p where p.oid=function_oid;
  anchor:='and a.attnum>8 and not a.attisdropped;';
  replacement:='and a.attnum>8 and not a.attisdropped and a.attname<>''stable_identity_key'';';
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_STABLE_CACHE_SHAPE_ANCHOR_INVALID';
  end if;
  execute replace(definition,anchor,replacement);
  if not exists(select 1 from pg_proc p where p.oid=function_oid and p.proowner=owner_before
    and p.proacl is not distinct from acl_before and p.proconfig is not distinct from config_before
    and p.prosecdef=security_before) then raise exception 'MASTER_STABLE_CACHE_SHAPE_SECURITY_CHANGED'; end if;

  -- A caller cannot populate computed metadata or add it to field_keys.
  function_oid:='public.append_master_snapshot_stage_chunk_v1(uuid,uuid,integer,jsonb)'::regprocedure;
  select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
    into definition,owner_before,acl_before,config_before,security_before from pg_proc p where p.oid=function_oid;
  anchor:='and a.attname = incoming_columns.key and a.attnum > 8 and not a.attisdropped';
  replacement:=anchor||' and a.attname<>''stable_identity_key''';
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_STABLE_CACHE_INPUT_ANCHOR_INVALID';
  end if;
  execute replace(definition,anchor,replacement);
  if not exists(select 1 from pg_proc p where p.oid=function_oid and p.proowner=owner_before
    and p.proacl is not distinct from acl_before and p.proconfig is not distinct from config_before
    and p.prosecdef=security_before) then raise exception 'MASTER_STABLE_CACHE_INPUT_SECURITY_CHANGED'; end if;

  function_oid:='public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure;
  select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
    into definition,owner_before,acl_before,config_before,security_before from pg_proc p where p.oid=function_oid;
  anchor:='s.raw_item6_fields,s.field_keys,s.lineage_key,s.source_hash,%s,';
  replacement:='s.raw_item6_fields,s.field_keys,s.lineage_key,s.source_hash,s.stable_identity_key,%s,';
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_STABLE_CACHE_VIEW_ANCHOR_INVALID';
  end if;
  definition:=replace(definition,anchor,replacement);
  anchor:='private.ph_master_inventory_stable_identity_v7(s.raw_values)';
  if position(anchor in definition)=0 then raise exception 'MASTER_STABLE_CACHE_IDENTITY_ANCHOR_MISSING'; end if;
  -- Exact pure-function substitution: source masks/digests, live existence,
  -- historical aliases, row guard fallback, active leases and locks stay intact.
  definition:=replace(definition,anchor,'s.stable_identity_key');
  execute definition;
  if not exists(select 1 from pg_proc p where p.oid=function_oid and p.proowner=owner_before
    and p.proacl is not distinct from acl_before and p.proconfig is not distinct from config_before
    and p.prosecdef=security_before) then raise exception 'MASTER_STABLE_CACHE_FINALIZE_SECURITY_CHANGED'; end if;
end
$stable_key_cache$;



-- Use the exact established crop mapper against typed live fields. This avoids
-- building a JSON object for every changed/new row and retains app-only values.
do $typed_crop_mapper$
declare mapper_body text; projection_definition text; view_body text;
  projected_keys text[]; key_name text; replacement text; type_oid oid;
  sync_definition text; anchor text;
begin
  select prosrc into mapper_body from pg_proc where oid='public.v2_crop_roll_drive_row_from_json(jsonb)'::regprocedure;
  select pg_get_functiondef('private.ph_master_crop_roll_mapper_input_v1(public.ph_master_inventory)'::regprocedure) into projection_definition;
  select array_agg(distinct parts[1]) into projected_keys
    from regexp_matches(projection_definition, $pattern$'([^']+)'\s*,\s*p_master\.$pattern$,'g') m(parts);
  if cardinality(projected_keys)<>60 then raise exception 'MASTER_TYPED_CROP_PROJECTION_CHANGED'; end if;
  -- Keep the existing shared season classifier; only its two required input
  -- fields are serialized, rather than all60 mapper fields or213 table fields.
  anchor:='public.get_v2_crop_roll_drive_view(row_data)';
  if strpos(mapper_body,anchor)=0 then raise exception 'MASTER_TYPED_CROP_VIEW_ANCHOR'; end if;
  mapper_body:=replace(mapper_body,anchor,
    'public.get_v2_crop_roll_drive_view(jsonb_build_object(''saleyear'',p_master.saleyear,''desigitem'',p_master.desigitem))');
  for key_name in select distinct parts[1] from regexp_matches(mapper_body,$pattern$row_data->>'([^']+)'$pattern$,'g') m(parts) loop
    if key_name=any(projected_keys) then
      select atttypid into type_oid from pg_attribute where attrelid='public.ph_master_inventory'::regclass
        and attname=key_name and attnum>0 and not attisdropped;
      if type_oid is null then raise exception 'MASTER_TYPED_CROP_COLUMN_MISSING:%',key_name; end if;
      replacement:=case when type_oid='text'::regtype then format('p_master.%I',key_name)
        else format('(pg_catalog.to_jsonb(p_master.%I)#>>''{}'')',key_name) end;
    else replacement:='null::text'; end if;
    mapper_body:=replace(mapper_body,format('row_data->>%L',key_name),replacement);
  end loop;
  if strpos(mapper_body,'row_data')>0 then raise exception 'MASTER_TYPED_CROP_UNHANDLED_INPUT'; end if;
  execute 'create function private.ph_master_crop_roll_from_master_v1(p_master public.ph_master_inventory) '
    ||'returns public.ph_crop_roll_drive_rows language plpgsql stable set search_path=''''
       as '||quote_literal(mapper_body);
  execute 'revoke all on function private.ph_master_crop_roll_from_master_v1(public.ph_master_inventory) from public,anon,authenticated,service_role';
  select pg_get_functiondef('private.sync_ph_master_bulk_crop_roll_v1(uuid,uuid,text[])'::regprocedure) into sync_definition;
  anchor:='public.v2_crop_roll_drive_row_from_json(private.ph_master_crop_roll_mapper_input_v1(master))';
  if length(sync_definition)-length(replace(sync_definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_TYPED_CROP_SYNC_ANCHOR'; end if;
  execute replace(sync_definition,anchor,'private.ph_master_crop_roll_from_master_v1(master)');
end
$typed_crop_mapper$;

-- Ignored integration delta. Apply after the stable-key cache / current finalizer
-- transformations, inside the parent migration transaction. No target shape,
-- source allowlist, lease, alias, pending-ack or publication contract changes.
-- Proven-new rows need no per-row raw context during their dedicated INSERT.
-- One real context witness is retained for the existing fenced crop sync.

do $reduced_new_context$
declare
  function_oid oid := 'public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure;
  definition text; anchor text; replacement text;
  owner_before oid; acl_before aclitem[]; config_before text[]; security_before boolean;
begin
  select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
    into definition,owner_before,acl_before,config_before,security_before
  from pg_proc p where p.oid=function_oid;

  -- Remove the previous post-copy classifier. The exact same eligibility tests
  -- are moved before the context INSERT, into a narrow indexed temp relation.
  anchor := $anchor$  -- Only genuinely new, unique physical tuples take the batch path. Known
  -- aliases, orphan aliases, and duplicate source/stable tuples execute the
  -- complete original row guards, including all ambiguity rejection rules.
  with incoming as materialized (
    select s.unique_id,s.lineage_key,s.stable_identity_key as stable_key
    from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 m using(row_number)
    where m.canonical_unique_id is null
  ), unique_tuples as materialized (
    select i.*,count(*) over(partition by lineage_key) as lineage_count,
      count(*) over(partition by stable_key) as stable_count from incoming i
  )
  update app_sync_private.ph_master_bulk_import_context_v1 c set new_insert_verified=true
  from unique_tuples i
  where c.run_id=p_run_id and c.request_id=p_request_id and c.backend_pid=pg_backend_pid()
    and c.transaction_id=txid_current() and c.canonical_unique_id is null
    and c.source_unique_id=i.unique_id and i.lineage_count=1 and i.stable_count=1
    and not exists(select 1 from app_sync_private.ph_master_inventory_item6_aliases_v7 a where a.imported_unique_id=i.unique_id)
    and not exists(select 1 from app_sync_private.ph_master_inventory_item6_source_v7 b
      join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id where b.stable_identity_key=i.stable_key);
$anchor$;
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_REDUCED_CONTEXT_OLD_CLASSIFIER_ANCHOR_INVALID';
  end if;
  definition:=replace(definition,anchor,'');

  anchor := $anchor$  insert into app_sync_private.ph_master_bulk_import_context_v1(
    run_id, request_id, backend_pid, transaction_id, source_unique_id,
    canonical_unique_id, raw_values, raw_item6_fields, source_hash
  )
  select p_run_id, p_request_id, pg_backend_pid(), txid_current(), m.source_unique_id,
    m.canonical_unique_id, s.raw_values, s.raw_item6_fields, s.source_hash
  from pg_temp.ph_master_bulk_map_v1 m
  join pg_temp.ph_master_bulk_stage_v1 s using (row_number);$anchor$;
  replacement := $body$  drop table if exists pg_temp.ph_master_proven_new_ids_v1;
  create temp table ph_master_proven_new_ids_v1(unique_id text primary key) on commit drop;
  with incoming as materialized (
    select s.unique_id,s.lineage_key,s.stable_identity_key as stable_key
    from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 m using(row_number)
    where m.canonical_unique_id is null
  ), unique_tuples as materialized (
    select i.*,count(*) over(partition by lineage_key) as lineage_count,
      count(*) over(partition by stable_key) as stable_count from incoming i
  )
  insert into pg_temp.ph_master_proven_new_ids_v1(unique_id)
  select i.unique_id from unique_tuples i
  where i.lineage_count=1 and i.stable_count=1
    and not exists(select 1 from app_sync_private.ph_master_inventory_item6_aliases_v7 a where a.imported_unique_id=i.unique_id)
    and not exists(select 1 from app_sync_private.ph_master_inventory_item6_source_v7 b
      join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id where b.stable_identity_key=i.stable_key);
  analyze pg_temp.ph_master_proven_new_ids_v1;

  -- The retained witness is a real complete context row, with the original
  -- source mask/hash. It is not a synthetic acknowledgement or alias mapping.
  insert into app_sync_private.ph_master_bulk_import_context_v1(
    run_id, request_id, backend_pid, transaction_id, source_unique_id,
    canonical_unique_id, raw_values, raw_item6_fields, source_hash
  )
  select p_run_id, p_request_id, pg_backend_pid(), txid_current(), m.source_unique_id,
    m.canonical_unique_id, s.raw_values, s.raw_item6_fields, s.source_hash
  from pg_temp.ph_master_bulk_map_v1 m
  join pg_temp.ph_master_bulk_stage_v1 s using (row_number)
  where not exists(select 1 from pg_temp.ph_master_proven_new_ids_v1 n where n.unique_id=s.unique_id)
    or s.unique_id=(select n.unique_id from pg_temp.ph_master_proven_new_ids_v1 n order by n.unique_id limit 1);$body$;
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_REDUCED_CONTEXT_COPY_ANCHOR_INVALID';
  end if;
  definition:=replace(definition,anchor,replacement);

  anchor := $anchor$        join app_sync_private.ph_master_bulk_import_context_v1 c on c.source_unique_id=s.unique_id
          and c.run_id=$3 and c.request_id=$4 and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()
        where c.new_insert_verified and s.raw_item6_fields=$1 and s.field_keys=$2$anchor$;
  replacement := $body$        join pg_temp.ph_master_proven_new_ids_v1 n using(unique_id)
        where s.raw_item6_fields=$1 and s.field_keys=$2$body$;
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_REDUCED_CONTEXT_INSERT_JOIN_ANCHOR_INVALID';
  end if;
  definition:=replace(definition,anchor,replacement);

  -- A failed fast INSERT has no acknowledgement yet. Before any ordinary
  -- guarded upsert, restore its complete raw context for this mask group. The
  -- existing witness is retained unchanged; no source mask is synthesized.
  anchor := $anchor$    perform set_config('gnc.master_snapshot_verified_insert','',true);
    changed_predicate := '(select c.source_hash from private.ph_master_bulk_context_v1('$anchor$;
  replacement := $body$    perform set_config('gnc.master_snapshot_verified_insert','',true);
    if exists(
      select 1 from pg_temp.ph_master_proven_new_ids_v1 n
      join pg_temp.ph_master_bulk_stage_v1 s using(unique_id)
      where s.raw_item6_fields=tuple_value.raw_item6_fields and s.field_keys=tuple_value.field_keys
        and not exists(select 1 from pg_temp.ph_master_new_insert_ids_v1 ni where ni.unique_id=s.unique_id)
    ) then
    insert into app_sync_private.ph_master_bulk_import_context_v1(
      run_id,request_id,backend_pid,transaction_id,source_unique_id,
      canonical_unique_id,raw_values,raw_item6_fields,source_hash
    )
    select p_run_id,p_request_id,pg_backend_pid(),txid_current(),s.unique_id,
      m.canonical_unique_id,s.raw_values,s.raw_item6_fields,s.source_hash
    from pg_temp.ph_master_bulk_stage_v1 s
    join pg_temp.ph_master_bulk_map_v1 m using(row_number)
    join pg_temp.ph_master_proven_new_ids_v1 n on n.unique_id=s.unique_id
    where s.raw_item6_fields=tuple_value.raw_item6_fields and s.field_keys=tuple_value.field_keys
      and not exists(select 1 from pg_temp.ph_master_new_insert_ids_v1 ni where ni.unique_id=s.unique_id)
    on conflict(run_id,backend_pid,transaction_id,source_unique_id) do nothing;
    end if;
    changed_predicate := '(select c.source_hash from private.ph_master_bulk_context_v1('$body$;
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_REDUCED_CONTEXT_FALLBACK_ANCHOR_INVALID';
  end if;
  definition:=replace(definition,anchor,replacement);

  -- Original baseline publication below still handles all normal/aliased
  -- contexts. Fast-success IDs additionally need their source hash here because
  -- most of those rows deliberately have no copied context.
  anchor := '  unchanged_rows := greatest(0, source_rows - inserted_rows - updated_rows);';
  replacement := anchor || $body$
  insert into app_sync_private.ph_master_bulk_import_source_v1(
    canonical_unique_id,source_unique_id,source_hash,import_run_id
  )
  select s.unique_id,s.unique_id,s.source_hash,p_run_id
  from pg_temp.ph_master_bulk_stage_v1 s
  join pg_temp.ph_master_proven_new_ids_v1 n using(unique_id)
  join pg_temp.ph_master_new_insert_ids_v1 ni using(unique_id)
  on conflict(canonical_unique_id) do update set
    source_unique_id=excluded.source_unique_id,source_hash=excluded.source_hash,
    import_run_id=excluded.import_run_id,updated_at=clock_timestamp()
  where app_sync_private.ph_master_bulk_import_source_v1.source_hash is distinct from excluded.source_hash
     or app_sync_private.ph_master_bulk_import_source_v1.source_unique_id is distinct from excluded.source_unique_id;
$body$;
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_REDUCED_CONTEXT_SOURCE_BASELINE_ANCHOR_INVALID';
  end if;
  definition:=replace(definition,anchor,replacement);
  execute definition;
  if not exists(select 1 from pg_proc p where p.oid=function_oid and p.proowner=owner_before
    and p.proacl is not distinct from acl_before and p.proconfig is not distinct from config_before
    and p.prosecdef=security_before) then raise exception 'MASTER_REDUCED_CONTEXT_FINALIZE_SECURITY_CHANGED'; end if;
end
$reduced_new_context$;

-- A caller-set GUC cannot activate this branch: the BEFORE INSERT STATEMENT
-- validator always clears it first, then requires the private run/transaction
-- proof. UPDATE and DELETE continue through the complete original validator.
do $crop_verified_insert_defer$
declare
  function_oid oid := 'public.upsert_v2_crop_roll_drive_row_from_master()'::regprocedure;
  definition text; anchor text := E'\nbegin\n'; replacement text;
  owner_before oid; acl_before aclitem[]; config_before text[]; security_before boolean;
begin
  select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
    into definition,owner_before,acl_before,config_before,security_before
  from pg_proc p where p.oid=function_oid;
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'MASTER_CROP_VERIFIED_INSERT_ANCHOR_INVALID';
  end if;
  replacement:=anchor||$body$  if tg_op='INSERT' and current_setting('gnc.master_snapshot_verified_insert',true)
    =pg_backend_pid()::text||':'||txid_current()::text then
    return new;
  end if;
$body$;
  execute replace(definition,anchor,replacement);
  if not exists(select 1 from pg_proc p where p.oid=function_oid and p.proowner=owner_before
    and p.proacl is not distinct from acl_before and p.proconfig is not distinct from config_before
    and p.prosecdef=security_before) then raise exception 'MASTER_CROP_VERIFIED_INSERT_SECURITY_CHANGED'; end if;
end
$crop_verified_insert_defer$;

-- Required disposable checks before promotion (not executed here):
-- * Existing new/changed/unchanged/retry, eight duplicate/orphan differential
--   canaries, source-mask acknowledgement and forged-GUC protections unchanged.
-- * Before crop sync, all-new context count is1; mixed source keeps every
--   nonproven context plus at most1 proven witness. Context is empty afterwards.
-- * Every new live UID has the exact staged source_hash/source_unique_id in
--   import_source, and an immediate unchanged snapshot performs zero updates.
-- * Controlled competing unique_id INSERT between classification and fast
--   INSERT must use ordinary guards, preserve app edits, and retain exact masks.
-- * Forged verified-insert GUC plus normal INSERT cannot skip crop mapping;
--   forged GUC plus UPDATE/DELETE must not skip the existing crop side effect.
-- * Full typed crop row parity and mapper timestamp formatting remain exact.
-- * Retain all500-row append and finalizer performance gates. No timing claim
--   is made by this draft; no SQL/test/production execution was performed.

-- Ignored integration delta. Apply AFTER reduced-new-context delta, inside the
-- same migration transaction. This adds a narrowly proved new split row; it
-- does not map the new UID to any existing sibling or weaken ordinary guards.
do $genuine_new_split$
declare
 function_oid oid:='public.finalize_master_snapshot_stage_v1(uuid,uuid,text)'::regprocedure;
 definition text; anchor text; replacement text;
 owner_before oid; acl_before aclitem[]; config_before text[]; security_before boolean;
begin
 select pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig,p.prosecdef
 into definition,owner_before,acl_before,config_before,security_before from pg_proc p where p.oid=function_oid;
 anchor:=$anchor$    and not exists(select 1 from app_sync_private.ph_master_inventory_item6_source_v7 b
      join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id where b.stable_identity_key=i.stable_key);$anchor$;
 replacement:=$body$    and (
      not exists(select 1 from app_sync_private.ph_master_inventory_item6_source_v7 b
        join public.ph_master_inventory m on m.unique_id=b.canonical_unique_id where b.stable_identity_key=i.stable_key)
      or (
        -- No historical v6 identity, including an orphan baseline, may be
        -- silently reinterpreted as this new split. Candidate aliases remain
        -- excluded by the unchanged preceding eligibility predicate.
        not exists(select 1 from app_sync_private.ph_master_inventory_source_baselines prior_v6
          where prior_v6.lineage_key=i.lineage_key)
        and not exists(select 1 from public.ph_master_inventory live where live.unique_id=i.unique_id)
        -- The unresolved-only window counts above are insufficient if an
        -- exact sibling changes designation to this same incoming lineage.
        and not exists(select 1 from pg_temp.ph_master_bulk_stage_v1 other_source
          where other_source.lineage_key=i.lineage_key and other_source.unique_id<>i.unique_id)
        -- Every live stable sibling must retain its exact source UID in this
        -- complete immutable snapshot. A missing sibling cannot prove a split.
        and not exists(
          select 1 from app_sync_private.ph_master_inventory_item6_source_v7 b
          join public.ph_master_inventory live on live.unique_id=b.canonical_unique_id
          where b.stable_identity_key=i.stable_key
            and not exists(select 1 from pg_temp.ph_master_bulk_stage_v1 retained
              where retained.unique_id=live.unique_id and retained.stable_identity_key=i.stable_key)
        )
        -- A pending designation is an unresolved ownership decision, even
        -- when a stale edit record references a no-longer-live canonical UID.
        and not exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 e
          where e.pending and e.field_name in('desigitem','desigcust','desigloc')
            and (e.stable_identity_key=i.stable_key or exists(
              select 1 from app_sync_private.ph_master_inventory_item6_source_v7 b
              where b.canonical_unique_id=e.canonical_unique_id and b.stable_identity_key=i.stable_key)))
        -- A retained exact UID cannot simultaneously prove another canonical
        -- sibling through the historical alias ledger.
        and not exists(
          select 1 from app_sync_private.ph_master_inventory_item6_source_v7 b
          join public.ph_master_inventory live on live.unique_id=b.canonical_unique_id
          join app_sync_private.ph_master_inventory_item6_aliases_v7 a on a.imported_unique_id=live.unique_id
          where b.stable_identity_key=i.stable_key and a.canonical_unique_id<>live.unique_id
        )
      )
    );$body$;
 if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
  raise exception 'MASTER_GENUINE_SPLIT_ELIGIBILITY_ANCHOR_INVALID';
 end if;
 execute replace(definition,anchor,replacement);
 if not exists(select 1 from pg_proc p where p.oid=function_oid and p.proowner=owner_before
  and p.proacl is not distinct from acl_before and p.proconfig is not distinct from config_before
  and p.prosecdef=security_before) then raise exception 'MASTER_GENUINE_SPLIT_SECURITY_CHANGED'; end if;
end
$genuine_new_split$;

notify pgrst, 'reload schema';
commit;
