begin;
set local statement_timeout = '120s';
set local lock_timeout = '15s';

-- Release the exact current publisher before taking the schema lock. The
-- existing reviewed helper cancels its backend before changing its cron row.
do $quiesce$
begin
  if exists(select 1 from private.fast_erp_stage_runs_v1
    where stage_id='60393f40-ec61-458a-98e7-b561116da703' and stage_state='staging'
      and file_meta->>'file_name'='DriveAroundMC-10-16405820261111044058.xlsx') then
    perform private.pause_erp_publication_v3077('60393f40-ec61-458a-98e7-b561116da703',
      'Pause the exact timed-out ERP publisher before installing bounded typed preparation checkpoints.');
  end if;
end
$quiesce$;

alter table private.erp_stage_publication_jobs_v3042
  add column typed_prepared_rows integer not null default 0 check(typed_prepared_rows>=0),
  add column typed_source_fingerprint text;

create table private.erp_drive_typed_rows_v3077 (
  stage_id uuid not null references private.erp_stage_publication_jobs_v3042(stage_id) on delete cascade,
  row_number bigint not null check(row_number>0),raw_values jsonb not null,
  frozen_erp_on_hand_v3048 numeric,frozen_erp_review_v3048 numeric,frozen_erp_available_v3048 numeric,
  raw_item6_count integer not null,raw_item6_fields text[] not null,field_keys text[] not null,
  lineage_key text not null,source_hash text not null,erp_row public.ph_master_inventory not null,decoded_row_hash text not null,
  primary key(stage_id,row_number),
  check(nullif(btrim((erp_row).unique_id),'') is not null),
  check(source_hash=private.ph_master_bulk_source_hash_v1(raw_values,raw_item6_fields)),
  check(lineage_key=private.ph_master_inventory_lineage_key_v1(raw_values)),
  check(erp_row is not distinct from jsonb_populate_record(null::public.ph_master_inventory,raw_values)),
  check(frozen_erp_on_hand_v3048 is not distinct from private.inventory_location_evidence_number_v2(raw_values->>'ptronhand')),
  check(frozen_erp_review_v3048 is not distinct from private.inventory_location_evidence_number_v2(raw_values->>'ptrreviewed')),
  check(frozen_erp_available_v3048 is not distinct from private.inventory_location_evidence_number_v2(raw_values->>'ptravailable'))
);
create unique index erp_drive_typed_rows_uid_v3077 on private.erp_drive_typed_rows_v3077(stage_id,((erp_row).unique_id));
create table private.erp_drive_typed_parts_v3077 (
  stage_id uuid not null references private.erp_stage_publication_jobs_v3042(stage_id) on delete cascade,
  first_row integer not null,row_count integer not null check(row_count between 1 and 1000),
  source_first_row integer not null,source_part_hash text not null,decoded_rows_hash text not null,
  primary key(stage_id,first_row)
);
alter table private.erp_drive_typed_rows_v3077 enable row level security;
alter table private.erp_drive_typed_parts_v3077 enable row level security;
revoke all on private.erp_drive_typed_rows_v3077,private.erp_drive_typed_parts_v3077 from public,anon,authenticated,service_role;

create function private.drive_typed_metadata_hash_v3077(p_ordinal bigint,p_raw jsonb,p_stock numeric,p_review numeric,
  p_available numeric,p_count integer,p_fields text[],p_keys text[],p_lineage text,p_source_hash text)
returns text language sql immutable set search_path = '' as $hash$
  select encode(extensions.digest(convert_to(jsonb_build_array(p_ordinal,p_raw,p_stock,p_review,p_available,
    p_count,p_fields,p_keys,p_lineage,p_source_hash)::text,'UTF8'),'sha256'),'hex')
$hash$;
revoke all on function private.drive_typed_metadata_hash_v3077(bigint,jsonb,numeric,numeric,numeric,integer,text[],text[],text,text)
  from public,anon,authenticated,service_role;
alter table private.erp_drive_typed_rows_v3077 add constraint erp_typed_row_seal_v3077 check(decoded_row_hash=
  private.drive_typed_metadata_hash_v3077(row_number,raw_values,frozen_erp_on_hand_v3048,frozen_erp_review_v3048,
    frozen_erp_available_v3048,raw_item6_count,raw_item6_fields,field_keys,lineage_key,source_hash));

-- Both complete-input callers and resumed typed checkpoints compile exactly
-- the same canonical indexes/cohorts. The existing decoder remains their owner.
do $compiler$
declare definition text:=pg_get_functiondef('private.prepare_master_bulk_stage_v3046(jsonb)'::regprocedure);
  start_at integer; stop_at integer; compiler text;
begin
  start_at:=strpos(definition,'  create unique index ph_master_bulk_stage_v1_ordinal_uidx');
  stop_at:=strpos(definition,'  perform private.refresh_drive_stage_cohort_statistics_v3077();');
  if start_at=0 or stop_at<=start_at then raise exception 'ERP_TYPED_COMPILER_OWNER_CHANGED'; end if;
  compiler:=substring(definition from start_at for stop_at-start_at);
  execute 'create function private.compile_master_bulk_stage_v3077() returns void language plpgsql set search_path='''''||
    ' as $compile$ begin'||chr(10)||compiler||chr(10)||'end $compile$';
  execute overlay(definition placing '  perform private.compile_master_bulk_stage_v3077();'||chr(10)
    from start_at for stop_at-start_at);
end
$compiler$;
revoke all on function private.compile_master_bulk_stage_v3077() from public,anon,authenticated,service_role;

create function private.drive_master_composite_columns_v3077(p_alias text)
returns text language sql stable set search_path = '' as $columns$
  select string_agg(format('%I.%I',p_alias,attname),',' order by attnum)
  from pg_attribute where attrelid='public.ph_master_inventory'::regclass and attnum>0 and not attisdropped
$columns$;
revoke all on function private.drive_master_composite_columns_v3077(text) from public,anon,authenticated,service_role;

create function private.prepare_drive_typed_part_v3077(p_stage_id uuid)
returns boolean language plpgsql set search_path = '' as $part$
declare stage private.fast_erp_stage_runs_v1%rowtype; job private.erp_stage_publication_jobs_v3042%rowtype;
  part private.erp_drive_publication_parts_v3042%rowtype; payload jsonb; offset_rows integer; batch_rows integer; inserted integer;
begin
  select * into strict stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id;
  if stage.dataset_key<>'drive_around' then return true; end if;
  select * into strict job from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id;
  if stage.stage_state<>'staging' or stage.expires_at<=clock_timestamp() or stage.staged_rows<>stage.expected_rows
    or job.prepared_rows<>stage.expected_rows or job.typed_prepared_rows>stage.expected_rows
    or (job.typed_source_fingerprint is not null and job.typed_source_fingerprint<>stage.source_fingerprint) then
    raise exception 'ERP_TYPED_STAGE_IDENTITY_CHANGED';
  end if;
  if job.typed_prepared_rows=stage.expected_rows then return true; end if;
  select * into strict part from private.erp_drive_publication_parts_v3042 where stage_id=p_stage_id
    and first_row<=job.typed_prepared_rows+1 and first_row+row_count>job.typed_prepared_rows+1
    order by first_row desc limit 1;
  if part.row_count not between 1 and 1500 then raise exception 'ERP_TYPED_SOURCE_PART_INVALID'; end if;
  payload:=('['||part.body||']')::jsonb;
  if jsonb_array_length(payload)<>part.row_count then raise exception 'ERP_TYPED_SOURCE_PART_INVALID'; end if;
  offset_rows:=job.typed_prepared_rows+1-part.first_row;
  batch_rows:=least(1000,part.row_count-offset_rows,stage.expected_rows-job.typed_prepared_rows);
  select jsonb_agg(value order by ordinal) into payload from jsonb_array_elements(payload) with ordinality r(value,ordinal)
    where ordinal>offset_rows and ordinal<=offset_rows+batch_rows;
  perform private.prepare_master_bulk_stage_v3046(payload);
  execute format('insert into private.erp_drive_typed_rows_v3077
    select $1,s.row_number+$2,s.raw_values,s.frozen_erp_on_hand_v3048,s.frozen_erp_review_v3048,s.frozen_erp_available_v3048,
      s.raw_item6_count,s.raw_item6_fields,s.field_keys,s.lineage_key,s.source_hash,row(%s)::public.ph_master_inventory,
      private.drive_typed_metadata_hash_v3077(s.row_number+$2,s.raw_values,s.frozen_erp_on_hand_v3048,s.frozen_erp_review_v3048,
        s.frozen_erp_available_v3048,s.raw_item6_count,s.raw_item6_fields,s.field_keys,s.lineage_key,s.source_hash)
    from pg_temp.ph_master_bulk_stage_v1 s',private.drive_master_composite_columns_v3077('s'))
    using p_stage_id,job.typed_prepared_rows;
  get diagnostics inserted=row_count;
  if inserted<>batch_rows then raise exception 'ERP_TYPED_SOURCE_PART_INCOMPLETE'; end if;
  insert into private.erp_drive_typed_parts_v3077
  select p_stage_id,job.typed_prepared_rows+1,batch_rows,part.first_row,
    encode(extensions.digest(convert_to(part.body,'UTF8'),'sha256'),'hex'),
    encode(extensions.digest(convert_to(string_agg(decoded_row_hash,',' order by row_number),'UTF8'),'sha256'),'hex')
  from private.erp_drive_typed_rows_v3077 where stage_id=p_stage_id
    and row_number>job.typed_prepared_rows and row_number<=job.typed_prepared_rows+batch_rows;
  update private.erp_stage_publication_jobs_v3042 set typed_prepared_rows=job.typed_prepared_rows+batch_rows,
    typed_source_fingerprint=stage.source_fingerprint,last_progress_at=clock_timestamp(),failures=0,last_error=null
    where stage_id=p_stage_id;
  return false;
end
$part$;
revoke all on function private.prepare_drive_typed_part_v3077(uuid) from public,anon,authenticated,service_role;

create function private.assert_drive_typed_checkpoint_v3077(p_stage_id uuid)
returns void language plpgsql set search_path = '' as $proof$
declare stage private.fast_erp_stage_runs_v1%rowtype; job private.erp_stage_publication_jobs_v3042%rowtype;
  count_rows integer; first_row bigint; last_row bigint;
begin
  select * into strict stage from private.fast_erp_stage_runs_v1 where stage_id=p_stage_id;
  select * into strict job from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id;
  if stage.dataset_key<>'drive_around' or stage.stage_state<>'staging' or stage.expires_at<=clock_timestamp()
    or stage.staged_rows<>stage.expected_rows or job.typed_prepared_rows<>stage.expected_rows
    or job.typed_source_fingerprint is distinct from stage.source_fingerprint then raise exception 'ERP_TYPED_STAGE_INCOMPLETE'; end if;
  select count(*),min(row_number),max(row_number) into count_rows,first_row,last_row
    from private.erp_drive_typed_rows_v3077 where stage_id=p_stage_id;
  if count_rows<>stage.expected_rows or first_row<>1 or last_row<>stage.expected_rows then
    raise exception 'ERP_TYPED_STAGE_INCOMPLETE';
  end if;
  if (select sum(row_count) from private.erp_drive_typed_parts_v3077 where stage_id=p_stage_id) is distinct from stage.expected_rows::bigint
    or exists(select 1 from private.erp_drive_typed_parts_v3077 receipt
      left join private.erp_drive_publication_parts_v3042 source on source.stage_id=receipt.stage_id and source.first_row=receipt.source_first_row
      where receipt.stage_id=p_stage_id and (source.first_row is null
        or receipt.source_part_hash is distinct from encode(extensions.digest(convert_to(source.body,'UTF8'),'sha256'),'hex'))) then
    raise exception 'ERP_TYPED_SOURCE_PART_CHANGED';
  end if;
  if exists(select 1 from private.erp_drive_typed_parts_v3077 receipt where receipt.stage_id=p_stage_id
    and receipt.decoded_rows_hash is distinct from (select encode(extensions.digest(convert_to(
      string_agg(decoded_row_hash,',' order by row_number),'UTF8'),'sha256'),'hex')
      from private.erp_drive_typed_rows_v3077 cached where cached.stage_id=p_stage_id
        and cached.row_number>=receipt.first_row and cached.row_number<receipt.first_row+receipt.row_count)) then
    raise exception 'ERP_TYPED_DECODED_ROWS_CHANGED';
  end if;
end
$proof$;
revoke all on function private.assert_drive_typed_checkpoint_v3077(uuid) from public,anon,authenticated,service_role;

create function private.load_drive_typed_checkpoint_v3077(p_stage_id uuid)
returns void language plpgsql set search_path = '' as $load$
begin
  perform private.assert_drive_typed_checkpoint_v3077(p_stage_id);
  drop table if exists pg_temp.ph_master_bulk_stage_v1;
  create temp table ph_master_bulk_stage_v1 on commit drop as
  select row_number,raw_values,frozen_erp_on_hand_v3048,frozen_erp_review_v3048,frozen_erp_available_v3048,
    raw_item6_count,raw_item6_fields,field_keys,lineage_key,source_hash,(erp_row).*
  from private.erp_drive_typed_rows_v3077 where stage_id=p_stage_id;
  perform private.compile_master_bulk_stage_v3077();
  perform private.refresh_drive_stage_cohort_statistics_v3077();
end
$load$;
revoke all on function private.load_drive_typed_checkpoint_v3077(uuid) from public,anon,authenticated,service_role;

-- Preparation advances the same durable, locked publication job. The final
-- loader retains its payload digest/ownership proof and canonical commit call.
do $wire$
declare definition text; prior text;
begin
  definition:=pg_get_functiondef('private.prepare_erp_publication_v3077(uuid)'::regprocedure);
  prior:='  return true;';
  if cardinality(string_to_array(definition,prior))<>2 then raise exception 'ERP_TYPED_PREPARATION_OWNER_CHANGED'; end if;
  execute replace(definition,prior,'  return private.prepare_drive_typed_part_v3077(p_stage_id);');
  definition:=pg_get_functiondef('private.load_drive_erp_publication_input_v3042(uuid)'::regprocedure);
  prior:=$prior$    perform private.prepare_master_bulk_stage_v3046(
      (select i.payload from pg_temp.agdata_drive_publication_input_v3042 i where i.stage_id=p_stage_id));$prior$;
  if cardinality(string_to_array(definition,prior))<>2 then raise exception 'ERP_TYPED_INPUT_OWNER_CHANGED'; end if;
  execute replace(definition,prior,'    perform private.load_drive_typed_checkpoint_v3077(p_stage_id);');
end
$wire$;
commit;
