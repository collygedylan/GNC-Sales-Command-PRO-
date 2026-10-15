begin;

-- @test-runtime: isolated-supabase
-- Historical import snapshots are isolated from the live inventory tables.
-- The importer stages positional row arrays so duplicate/blank source headers
-- and blank physical data rows remain lossless.
create schema if not exists import_private;
revoke all on schema import_private from public, anon, authenticated, service_role;
grant usage on schema import_private to service_role;

create table import_private.import_history_files (
  id uuid primary key default gen_random_uuid(),
  dataset text not null check (dataset in ('drive','soc','reserves')),
  file_id text not null check (nullif(btrim(file_id),'') is not null),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  source_version text not null check (nullif(btrim(source_version),'') is not null),
  original_file_name text not null check (nullif(btrim(original_file_name),'') is not null),
  drop_folder_id text not null,
  archive_folder_id text not null,
  source_timestamp timestamptz not null,
  report_date date not null,
  daily_sequence integer not null check (daily_sequence > 0),
  display_label text not null,
  expected_rows integer not null check (expected_rows >= 0),
  staged_rows integer not null default 0 check (staged_rows >= 0 and staged_rows <= expected_rows),
  columns text[] not null check (cardinality(columns) > 0),
  status text not null default 'staging' check (status in ('staging','ready')),
  created_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  unique (dataset,file_id,source_hash),
  unique (dataset,report_date,daily_sequence),
  check (display_label = to_char(report_date,'YYYY-MM-DD') || ' ' ||
    lpad(daily_sequence::text,greatest(2,length(daily_sequence::text)),'0')),
  check ((status='staging' and published_at is null) or (status='ready' and published_at is not null))
);

create table import_private.import_history_rows (
  snapshot_id uuid not null references import_private.import_history_files(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  row_values jsonb not null check (jsonb_typeof(row_values)='array'),
  primary key (snapshot_id,row_number)
);

create index import_history_files_ready_page_idx
  on import_private.import_history_files(dataset,report_date desc,daily_sequence desc)
  include (id,display_label,expected_rows)
  where status='ready';

alter table import_private.import_history_files enable row level security;
alter table import_private.import_history_rows enable row level security;
revoke all on import_private.import_history_files,import_private.import_history_rows
  from public,anon,authenticated,service_role;

create or replace function public.begin_import_history_v1(
  p_dataset text,p_file_id text,p_source_version text,p_file_name text,
  p_report_date date,p_source_timestamp timestamptz,p_expected_rows integer,
  p_columns text[],p_source_hash text
) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='55s'
as $$
declare
  v_drop text;
  v_archive text;
  v_file import_private.import_history_files%rowtype;
  v_sequence integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode='42501',message='IMPORT_HISTORY_IMPORTER_FORBIDDEN';
  end if;
  if p_dataset is null or p_dataset not in ('drive','soc','reserves')
    or nullif(btrim(p_file_id),'') is null
    or nullif(btrim(p_source_version),'') is null
    or nullif(btrim(p_file_name),'') is null
    or p_report_date is null or p_source_timestamp is null
    or p_expected_rows is null or p_expected_rows < 0
    or p_columns is null or cardinality(p_columns)=0
    or array_position(p_columns,null) is not null
    or p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='IMPORT_HISTORY_BEGIN_INVALID';
  end if;

  case p_dataset
    when 'drive' then
      v_drop:='1MWLYsQJ41bZVcg1SzDIw93uNmQpzPn48';
      v_archive:='1hswTWk4GooXIAXFmfdx9I6IyqLJ1LqSA';
    when 'soc' then
      v_drop:='19kd-yBZZeJfhJsITpyrzzANbJBNTs9eE';
      v_archive:='13hwbF-5wUDruKnjFujjtsyuyrPFgsqpo';
    when 'reserves' then
      v_drop:='1Xiyp6WQGAF-4Tm-KwSwi9RsBqulFcSAG';
      v_archive:='1u4Vk5L92zmcXXT2qNWzImWTud73Bpole';
  end case;

  perform pg_advisory_xact_lock(hashtextextended(
    'import-history-file:'||p_dataset||':'||p_file_id||':'||p_source_hash,0));
  select * into v_file from import_private.import_history_files f
  where f.dataset=p_dataset and f.file_id=p_file_id and f.source_hash=p_source_hash
  for update;
  if found then
    if v_file.expected_rows is distinct from p_expected_rows
      or v_file.columns is distinct from p_columns then
      raise exception using errcode='22023',message='IMPORT_HISTORY_RETRY_CONFLICT';
    end if;
    return jsonb_build_object('snapshotId',v_file.id,'displayLabel',v_file.display_label,
      'status',v_file.status,'rowCount',v_file.expected_rows,'stagedRows',v_file.staged_rows);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'import-history-sequence:'||p_dataset||':'||p_report_date::text,0));
  select coalesce(max(f.daily_sequence),0)+1 into v_sequence
  from import_private.import_history_files f
  where f.dataset=p_dataset and f.report_date=p_report_date;

  insert into import_private.import_history_files(
    dataset,file_id,source_hash,source_version,original_file_name,drop_folder_id,archive_folder_id,
    source_timestamp,report_date,daily_sequence,display_label,expected_rows,columns
  ) values (
    p_dataset,p_file_id,p_source_hash,p_source_version,p_file_name,v_drop,v_archive,
    p_source_timestamp,p_report_date,v_sequence,
    to_char(p_report_date,'YYYY-MM-DD')||' '||
      lpad(v_sequence::text,greatest(2,length(v_sequence::text)),'0'),p_expected_rows,p_columns
  ) returning * into v_file;
  return jsonb_build_object('snapshotId',v_file.id,'displayLabel',v_file.display_label,
    'status',v_file.status,'rowCount',v_file.expected_rows,'stagedRows',v_file.staged_rows);
end;
$$;

create or replace function public.stage_import_history_rows_v1(p_snapshot_id uuid,p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='55s'
as $$
declare
  v_file import_private.import_history_files%rowtype;
  v_item jsonb;
  v_number integer;
  v_number_numeric numeric;
  v_accepted integer:=0;
  v_previous integer;
  v_start integer;
  v_last integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode='42501',message='IMPORT_HISTORY_IMPORTER_FORBIDDEN';
  end if;
  if p_snapshot_id is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode='22023',message='IMPORT_HISTORY_STAGE_INVALID';
  end if;
  if jsonb_array_length(p_rows)>500 then
    raise exception using errcode='22023',message='IMPORT_HISTORY_STAGE_INVALID';
  end if;
  select * into v_file from import_private.import_history_files f
  where f.id=p_snapshot_id for update;
  if not found then raise exception using errcode='P0002',message='IMPORT_HISTORY_SNAPSHOT_NOT_FOUND'; end if;
  if v_file.status='ready' then
    if jsonb_array_length(p_rows)=0 then
      return jsonb_build_object('snapshotId',p_snapshot_id,'acceptedRows',0,'stagedRows',v_file.staged_rows);
    end if;
    raise exception using errcode='55000',message='IMPORT_HISTORY_ALREADY_PUBLISHED';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_rows) with ordinality e(value,ordinality) order by e.ordinality loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    if (select count(*) from jsonb_object_keys(v_item))<>2
      or not (v_item ? 'row_number') or not (v_item ? 'values')
    then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    if jsonb_typeof(v_item->'row_number') is distinct from 'number'
      or (v_item->>'row_number') !~ '^[0-9]{1,10}$' then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    if jsonb_typeof(v_item->'values') is distinct from 'array' then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    if jsonb_array_length(v_item->'values')<>cardinality(v_file.columns) then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_INVALID';
    end if;
    v_number_numeric:=(v_item->>'row_number')::numeric;
    if v_number_numeric<1 or v_number_numeric>v_file.expected_rows then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_OUT_OF_RANGE';
    end if;
    v_number:=v_number_numeric::integer;
    if v_previous is null then
      v_start:=v_number;
      if v_start>v_file.staged_rows+1 then
        raise exception using errcode='22023',message='IMPORT_HISTORY_STAGE_GAP';
      end if;
    elsif v_number<>v_previous+1 then
      raise exception using errcode='22023',message='IMPORT_HISTORY_ROWS_NOT_CONTIGUOUS';
    end if;
    v_previous:=v_number;
    v_last:=v_number;
  end loop;
  if jsonb_array_length(p_rows)>0 and exists (
    select 1
    from jsonb_array_elements(p_rows) e(value)
    join import_private.import_history_rows r
      on r.snapshot_id=p_snapshot_id and r.row_number=(e.value->>'row_number')::integer
    where r.row_values is distinct from e.value->'values'
  ) then
    raise exception using errcode='22023',message='IMPORT_HISTORY_ROW_RETRY_CONFLICT';
  end if;
  insert into import_private.import_history_rows(snapshot_id,row_number,row_values)
  select p_snapshot_id,(e.value->>'row_number')::integer,e.value->'values'
  from jsonb_array_elements(p_rows) e(value)
  on conflict do nothing;
  get diagnostics v_accepted=row_count;
  update import_private.import_history_files f
  set staged_rows=greatest(f.staged_rows,coalesce(v_last,f.staged_rows))
  where f.id=p_snapshot_id and f.status='staging' returning f.staged_rows into v_file.staged_rows;
  return jsonb_build_object('snapshotId',p_snapshot_id,'acceptedRows',v_accepted,'stagedRows',v_file.staged_rows);
end;
$$;

create or replace function public.publish_import_history_v1(p_snapshot_id uuid)
returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='55s'
as $$
declare
  v_file import_private.import_history_files%rowtype;
  v_count integer;
  v_min integer;
  v_max integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode='42501',message='IMPORT_HISTORY_IMPORTER_FORBIDDEN';
  end if;
  select * into v_file from import_private.import_history_files f
  where f.id=p_snapshot_id for update;
  if not found then raise exception using errcode='P0002',message='IMPORT_HISTORY_SNAPSHOT_NOT_FOUND'; end if;
  if v_file.status='ready' then
    return jsonb_build_object('snapshotId',v_file.id,'displayLabel',v_file.display_label,
      'status','ready','rowCount',v_file.expected_rows,'stagedRows',v_file.staged_rows);
  end if;
  select count(*)::integer,min(row_number),max(row_number) into v_count,v_min,v_max
  from import_private.import_history_rows r where r.snapshot_id=v_file.id;
  if v_count<>v_file.expected_rows
    or (v_count>0 and (v_min<>1 or v_max<>v_file.expected_rows))
    or (v_count=0 and v_file.expected_rows<>0) then
    raise exception using errcode='55000',message='IMPORT_HISTORY_ROWS_INCOMPLETE';
  end if;
  update import_private.import_history_files f
  set status='ready',published_at=clock_timestamp() where f.id=v_file.id
  returning * into v_file;
  return jsonb_build_object('snapshotId',v_file.id,'displayLabel',v_file.display_label,
    'status','ready','rowCount',v_file.expected_rows,'stagedRows',v_file.staged_rows);
end;
$$;

create or replace function public.list_import_history_v1(
  p_dataset text,p_before_date date default null,p_before_sequence integer default null,p_limit integer default 50
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_rows jsonb;
  v_count integer;
  v_last_date date;
  v_last_sequence integer;
  v_limit integer;
begin
  if private.can_manage_eval_assignments() is not true then
    raise exception using errcode='42501',message='IMPORT_HISTORY_FORBIDDEN';
  end if;
  if p_dataset is null or p_dataset not in ('drive','soc','reserves') or p_limit is null or p_limit<1 or p_limit>100
    or ((p_before_date is null)<>(p_before_sequence is null))
    or (p_before_sequence is not null and p_before_sequence<1) then
    raise exception using errcode='22023',message='IMPORT_HISTORY_LIST_INVALID';
  end if;
  v_limit:=p_limit;
  with page as (
    select f.id,f.dataset,f.display_label,f.report_date,f.daily_sequence,f.expected_rows,f.columns
    from import_private.import_history_files f
    where f.dataset=p_dataset and f.status='ready'
      and (p_before_date is null or (f.report_date,f.daily_sequence)<(p_before_date,p_before_sequence))
    order by f.report_date desc,f.daily_sequence desc
    limit v_limit+1
  )
  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object('snapshotId',page.id,'dataset',page.dataset,
      'displayLabel',page.display_label,'reportDate',page.report_date,'sequence',page.daily_sequence,
      'rowCount',page.expected_rows,'columns',page.columns)
      order by page.report_date desc,page.daily_sequence desc)
      filter (where ordinal<=v_limit),'[]'::jsonb),
    (array_agg(page.report_date order by page.report_date asc,page.daily_sequence asc)
      filter (where ordinal<=v_limit))[1],
    (array_agg(page.daily_sequence order by page.report_date asc,page.daily_sequence asc)
      filter (where ordinal<=v_limit))[1]
  into v_count,v_rows,v_last_date,v_last_sequence
  from (select page.*,row_number() over(order by page.report_date desc,page.daily_sequence desc) ordinal from page) page;
  return jsonb_build_object('files',v_rows,'hasMore',v_count>v_limit,
    'nextCursor',case when v_count>v_limit then jsonb_build_object('reportDate',v_last_date,'sequence',v_last_sequence) else null end);
end;
$$;

create or replace function public.get_import_history_rows_v1(
  p_snapshot_id uuid,p_after_row integer default 0,p_limit integer default 50
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_file import_private.import_history_files%rowtype;
  v_rows jsonb;
  v_count integer;
  v_next integer;
begin
  if private.can_manage_eval_assignments() is not true then
    raise exception using errcode='42501',message='IMPORT_HISTORY_FORBIDDEN';
  end if;
  if p_snapshot_id is null or p_after_row is null or p_after_row<0
    or p_limit is null or p_limit<1 or p_limit>200 then
    raise exception using errcode='22023',message='IMPORT_HISTORY_ROWS_QUERY_INVALID';
  end if;
  select * into v_file from import_private.import_history_files f
  where f.id=p_snapshot_id and f.status='ready';
  if not found then raise exception using errcode='P0002',message='IMPORT_HISTORY_SNAPSHOT_NOT_FOUND'; end if;
  with page as (
    select r.row_number,r.row_values from import_private.import_history_rows r
    where r.snapshot_id=p_snapshot_id and r.row_number>p_after_row
    order by r.row_number limit p_limit+1
  )
  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object('rowNumber',page.row_number,'values',page.row_values)
      order by page.row_number) filter (where page.ordinal<=p_limit),'[]'::jsonb),
    max(page.row_number) filter (where page.ordinal<=p_limit)
  into v_count,v_rows,v_next
  from (select page.*,row_number() over(order by page.row_number) ordinal from page) page;
  return jsonb_build_object('snapshotId',p_snapshot_id,'rows',v_rows,'hasMore',v_count>p_limit,
    'nextRow',case when v_count>p_limit then v_next else null end);
end;
$$;

revoke all on function public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text) from public,anon,authenticated;
revoke all on function public.stage_import_history_rows_v1(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.publish_import_history_v1(uuid) from public,anon,authenticated;
revoke all on function public.list_import_history_v1(text,date,integer,integer) from public,anon;
revoke all on function public.get_import_history_rows_v1(uuid,integer,integer) from public,anon;
grant execute on function public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text) to service_role;
grant execute on function public.stage_import_history_rows_v1(uuid,jsonb) to service_role;
grant execute on function public.publish_import_history_v1(uuid) to service_role;
grant execute on function public.list_import_history_v1(text,date,integer,integer) to authenticated,service_role;
grant execute on function public.get_import_history_rows_v1(uuid,integer,integer) to authenticated,service_role;

commit;
