begin;

create table if not exists private.ph_eval_item_low_stock_import_runs (
  run_id uuid primary key default gen_random_uuid(),
  expected_manifest jsonb not null check (jsonb_typeof(expected_manifest) = 'array'),
  status text not null default 'building' check (status in ('building', 'active', 'superseded')),
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

create table if not exists private.ph_eval_item_low_stock_import_state (
  singleton boolean primary key default true check (singleton),
  active_run_id uuid references private.ph_eval_item_low_stock_import_runs(run_id),
  pending_run_id uuid references private.ph_eval_item_low_stock_import_runs(run_id),
  updated_at timestamptz not null default now()
);

insert into private.ph_eval_item_low_stock_import_state(singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists private.ph_eval_item_low_stock_file_versions (
  file_version_id uuid primary key default gen_random_uuid(),
  drive_file_id text not null,
  source_revision text not null,
  file_name text not null,
  source_report_date date not null,
  snapshot_at timestamptz not null,
  source_created_at timestamptz,
  source_date_method text not null check (source_date_method in (
    'filename_timestamp', 'filename_date_sequence', 'filename_date',
    'filename_date_inferred_year', 'filename_date_creation_clock',
    'filename_date_inferred_year_creation_clock', 'creation_time_fallback'
  )),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  content_bytes bigint not null check (content_bytes >= 0),
  source_sheet_name text,
  source_row_count integer not null check (source_row_count >= 0),
  expected_row_count integer not null check (expected_row_count >= 0),
  exclusion_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(exclusion_counts) = 'object'),
  disposition text not null check (disposition in ('eligible', 'excluded')),
  exclusion_reason text,
  status text not null default 'importing' check (status in ('importing', 'finalized')),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (drive_file_id, source_revision),
  check (source_row_count >= expected_row_count),
  check (disposition <> 'excluded' or (expected_row_count = 0 and nullif(btrim(exclusion_reason), '') is not null)),
  check (disposition <> 'eligible' or nullif(btrim(source_sheet_name), '') is not null)
);

create table if not exists private.ph_eval_item_low_stock_order_rows (
  file_version_id uuid not null references private.ph_eval_item_low_stock_file_versions(file_version_id) on delete cascade,
  source_row_number integer not null check (source_row_number > 0),
  group_key text not null check (btrim(group_key) <> ''),
  itemcode text not null,
  itemcode_normalized text generated always as (upper(btrim(itemcode))) stored,
  quantity_ordered numeric not null check (quantity_ordered > 0 and quantity_ordered::text not in ('NaN', 'Infinity', '-Infinity')),
  dock text not null check (btrim(dock) <> ''),
  source_sheet_name text not null,
  primary key (file_version_id, source_row_number),
  check (btrim(itemcode) <> '' and upper(btrim(itemcode)) not in ('NULL', 'NAN', 'UNDEFINED'))
);

create index if not exists idx_eval_low_stock_rows_itemcode
  on private.ph_eval_item_low_stock_order_rows(itemcode_normalized, file_version_id);
create index if not exists idx_eval_low_stock_rows_group
  on private.ph_eval_item_low_stock_order_rows(file_version_id, group_key);

create table if not exists private.ph_eval_item_low_stock_run_files (
  run_id uuid not null references private.ph_eval_item_low_stock_import_runs(run_id) on delete cascade,
  drive_file_id text not null,
  source_revision text not null,
  file_version_id uuid references private.ph_eval_item_low_stock_file_versions(file_version_id),
  primary key (run_id, drive_file_id),
  unique (run_id, drive_file_id, source_revision)
);

create table if not exists private.ph_eval_item_low_stock_overrides (
  itemcode_normalized text primary key check (itemcode_normalized = upper(btrim(itemcode_normalized)) and itemcode_normalized <> ''),
  manual_override_qty integer check (manual_override_qty is null or manual_override_qty between 0 and 100000000),
  revision bigint not null default 0 check (revision >= 0),
  updated_by text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.ph_eval_item_low_stock_override_audit (
  audit_id bigint generated always as identity primary key,
  itemcode_normalized text not null,
  old_override_qty integer,
  new_override_qty integer,
  revision bigint not null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create table if not exists private.ph_eval_item_low_stock_target_stats (
  run_id uuid not null references private.ph_eval_item_low_stock_import_runs(run_id) on delete cascade,
  itemcode_normalized text not null,
  qualifying_line_count integer not null,
  qualifying_day_count integer not null,
  source_file_count integer not null,
  mean_quantity numeric not null,
  p75_quantity numeric not null,
  suggested_qty integer not null,
  history_from_date date not null,
  history_through_date date not null,
  calculated_at timestamptz not null,
  primary key (run_id, itemcode_normalized)
);
create index if not exists idx_eval_low_stock_target_stats_itemcode_run
  on private.ph_eval_item_low_stock_target_stats(itemcode_normalized, run_id);

alter table private.ph_eval_item_low_stock_import_runs enable row level security;
alter table private.ph_eval_item_low_stock_import_state enable row level security;
alter table private.ph_eval_item_low_stock_file_versions enable row level security;
alter table private.ph_eval_item_low_stock_order_rows enable row level security;
alter table private.ph_eval_item_low_stock_run_files enable row level security;
alter table private.ph_eval_item_low_stock_overrides enable row level security;
alter table private.ph_eval_item_low_stock_override_audit enable row level security;
alter table private.ph_eval_item_low_stock_target_stats enable row level security;

revoke all on table
  private.ph_eval_item_low_stock_import_runs,
  private.ph_eval_item_low_stock_import_state,
  private.ph_eval_item_low_stock_file_versions,
  private.ph_eval_item_low_stock_order_rows,
  private.ph_eval_item_low_stock_run_files,
  private.ph_eval_item_low_stock_overrides,
  private.ph_eval_item_low_stock_override_audit,
  private.ph_eval_item_low_stock_target_stats
from public, anon, authenticated, service_role;

create or replace function public.begin_eval_item_low_stock_import_v1(p_manifest jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  canonical_manifest jsonb;
  current_state private.ph_eval_item_low_stock_import_state%rowtype;
  target_run_id uuid;
  missing_files jsonb;
  is_complete boolean;
begin
  if jsonb_typeof(p_manifest) <> 'array' or jsonb_array_length(p_manifest) < 1 or jsonb_array_length(p_manifest) > 10000 then
    raise exception using errcode = '22023', message = 'LOW_STOCK_IMPORT_MANIFEST_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_manifest) as e(value)
    where nullif(btrim(value->>'drive_file_id'), '') is null
       or nullif(btrim(value->>'source_revision'), '') is null
  ) or (
    select count(*) from jsonb_array_elements(p_manifest)
  ) <> (
    select count(distinct btrim(value->>'drive_file_id'))
    from jsonb_array_elements(p_manifest) as e(value)
  ) then
    raise exception using errcode = '22023', message = 'LOW_STOCK_IMPORT_MANIFEST_INVALID';
  end if;

  select jsonb_agg(jsonb_build_object(
    'drive_file_id', btrim(value->>'drive_file_id'),
    'source_revision', btrim(value->>'source_revision')
  ) order by btrim(value->>'drive_file_id'), btrim(value->>'source_revision'))
  into canonical_manifest
  from jsonb_array_elements(p_manifest) as e(value);

  select * into current_state
  from private.ph_eval_item_low_stock_import_state
  where singleton
  for update;

  if current_state.active_run_id is not null then
    select run_id into target_run_id
    from private.ph_eval_item_low_stock_import_runs
    where run_id = current_state.active_run_id
      and expected_manifest = canonical_manifest
      and status = 'active';
    if found then
      -- A previously pending, now-reverted folder snapshot must not leave the
      -- UI permanently in Processing after the active manifest is current again.
      update private.ph_eval_item_low_stock_import_runs
      set status = 'superseded'
      where run_id = current_state.pending_run_id and status = 'building';
      if current_state.pending_run_id is not null then
        update private.ph_eval_item_low_stock_import_state
        set pending_run_id = null, updated_at = now()
        where singleton;
      end if;
      return jsonb_build_object(
        'run_id', target_run_id,
        'pending_files', '[]'::jsonb,
        'complete', true,
        'active', true
      );
    end if;
  end if;

  if current_state.pending_run_id is not null then
    select run_id into target_run_id
    from private.ph_eval_item_low_stock_import_runs
    where run_id = current_state.pending_run_id
      and expected_manifest = canonical_manifest
      and status = 'building';
    if found then
      -- Continue the same full-folder pass. Finalized immutable file versions
      -- are linked below, so another importer invocation need not parse them.
      null;
    else
      update private.ph_eval_item_low_stock_import_runs
      set status = 'superseded'
      where run_id = current_state.pending_run_id and status = 'building';
      target_run_id := null;
    end if;
  end if;

  if target_run_id is null then
    insert into private.ph_eval_item_low_stock_import_runs(expected_manifest)
    values (canonical_manifest)
    returning run_id into target_run_id;
    update private.ph_eval_item_low_stock_import_state
    set pending_run_id = target_run_id, updated_at = now()
    where singleton;
  end if;

  insert into private.ph_eval_item_low_stock_run_files(run_id, drive_file_id, source_revision, file_version_id)
  select target_run_id, value->>'drive_file_id', value->>'source_revision', v.file_version_id
  from jsonb_array_elements(canonical_manifest) as e(value)
  left join private.ph_eval_item_low_stock_file_versions v
    on v.drive_file_id = value->>'drive_file_id'
   and v.source_revision = value->>'source_revision'
   and v.status = 'finalized'
  on conflict (run_id, drive_file_id) do update
    set source_revision = excluded.source_revision,
        file_version_id = excluded.file_version_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'drive_file_id', r.drive_file_id,
    'source_revision', r.source_revision
  ) order by r.drive_file_id), '[]'::jsonb)
  into missing_files
  from private.ph_eval_item_low_stock_run_files r
  left join private.ph_eval_item_low_stock_file_versions v on v.file_version_id = r.file_version_id
  where r.run_id = target_run_id
    and (r.file_version_id is null or v.status <> 'finalized');

  is_complete := jsonb_array_length(missing_files) = 0;
  return jsonb_build_object(
    'run_id', target_run_id,
    'pending_files', missing_files,
    'complete', is_complete,
    'active', false
  );
end
$function$;

create or replace function public.prepare_eval_item_low_stock_file_v1(
  p_run_id uuid,
  p_drive_file_id text,
  p_source_revision text,
  p_file_name text,
  p_source_report_date date,
  p_snapshot_at timestamptz,
  p_source_date_method text,
  p_content_sha256 text,
  p_content_bytes bigint,
  p_source_sheet_name text,
  p_source_row_count integer,
  p_expected_row_count integer,
  p_exclusion_counts jsonb,
  p_disposition text default 'eligible',
  p_exclusion_reason text default null,
  p_source_created_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_status text;
  expected_version boolean;
  version_row private.ph_eval_item_low_stock_file_versions%rowtype;
begin
  select status into run_status
  from private.ph_eval_item_low_stock_import_runs
  where run_id = p_run_id;
  if run_status is null or run_status <> 'building' then
    raise exception using errcode = '55000', message = 'LOW_STOCK_IMPORT_RUN_NOT_BUILDING';
  end if;
  perform 1 from private.ph_eval_item_low_stock_import_state s
    where s.singleton and s.pending_run_id = p_run_id
    for update;
  if not found then
    raise exception using errcode = '55000', message = 'LOW_STOCK_IMPORT_RUN_SUPERSEDED';
  end if;
  if nullif(btrim(coalesce(p_drive_file_id, '')), '') is null
     or nullif(btrim(coalesce(p_source_revision, '')), '') is null
     or nullif(btrim(coalesce(p_file_name, '')), '') is null
     or p_source_report_date is null
     or p_snapshot_at is null
     or p_source_date_method not in (
       'filename_timestamp', 'filename_date_sequence', 'filename_date',
       'filename_date_inferred_year', 'filename_date_creation_clock',
       'filename_date_inferred_year_creation_clock', 'creation_time_fallback'
     )
     or coalesce(p_content_sha256, '') !~ '^[0-9a-f]{64}$'
     or p_content_bytes is null or p_content_bytes < 0
     or p_source_row_count is null or p_source_row_count < 0
     or p_expected_row_count is null or p_expected_row_count < 0
     or p_source_row_count < p_expected_row_count
     or jsonb_typeof(p_exclusion_counts) <> 'object'
     or p_disposition not in ('eligible', 'excluded')
     or (p_disposition = 'excluded' and (
       p_expected_row_count <> 0
       or nullif(btrim(coalesce(p_exclusion_reason, '')), '') not in ('non_soc_reserves', 'non_soc_drivearound_mc')
     ))
     or (p_disposition = 'eligible' and nullif(btrim(coalesce(p_source_sheet_name, '')), '') is null) then
    raise exception using errcode = '22023', message = 'LOW_STOCK_IMPORT_FILE_INVALID';
  end if;
  select exists (
    select 1 from private.ph_eval_item_low_stock_run_files r
    where r.run_id = p_run_id
      and r.drive_file_id = btrim(p_drive_file_id)
      and r.source_revision = btrim(p_source_revision)
  ) into expected_version;
  if not expected_version then
    raise exception using errcode = '22023', message = 'LOW_STOCK_IMPORT_FILE_NOT_IN_MANIFEST';
  end if;

  insert into private.ph_eval_item_low_stock_file_versions(
    drive_file_id, source_revision, file_name, source_report_date, snapshot_at,
    source_created_at, source_date_method, content_sha256, content_bytes, source_sheet_name,
    source_row_count, expected_row_count, exclusion_counts, disposition, exclusion_reason
  ) values (
    btrim(p_drive_file_id), btrim(p_source_revision), btrim(p_file_name), p_source_report_date, p_snapshot_at, p_source_created_at,
    p_source_date_method, p_content_sha256, p_content_bytes, nullif(btrim(p_source_sheet_name), ''),
    p_source_row_count, p_expected_row_count, p_exclusion_counts, p_disposition, nullif(btrim(p_exclusion_reason), '')
  ) on conflict (drive_file_id, source_revision) do nothing;

  select * into version_row
  from private.ph_eval_item_low_stock_file_versions v
  where v.drive_file_id = btrim(p_drive_file_id)
    and v.source_revision = btrim(p_source_revision)
  for update;

  if version_row.content_sha256 <> p_content_sha256
     or version_row.file_name <> btrim(p_file_name)
     or version_row.source_report_date <> p_source_report_date
     or version_row.snapshot_at <> p_snapshot_at
     or version_row.source_created_at is distinct from p_source_created_at
     or version_row.source_date_method <> p_source_date_method
     or version_row.content_bytes <> p_content_bytes
     or version_row.source_row_count <> p_source_row_count
     or version_row.expected_row_count <> p_expected_row_count
     or version_row.exclusion_counts <> p_exclusion_counts
     or version_row.disposition <> p_disposition
     or version_row.exclusion_reason is distinct from nullif(btrim(p_exclusion_reason), '') then
    raise exception using errcode = '22023', message = 'LOW_STOCK_IMPORT_REVISION_METADATA_CHANGED';
  end if;
  if version_row.status = 'finalized' then
    update private.ph_eval_item_low_stock_run_files
    set file_version_id = version_row.file_version_id
    where run_id = p_run_id and drive_file_id = btrim(p_drive_file_id);
  end if;
  return jsonb_build_object(
    'file_version_id', version_row.file_version_id,
    'status', case when version_row.status = 'finalized' then 'complete' else 'staging' end,
    'already_complete', version_row.status = 'finalized',
    'last_staged_row_number', coalesce((
      select max(r.source_row_number)
      from private.ph_eval_item_low_stock_order_rows r
      where r.file_version_id = version_row.file_version_id
    ), 0)
  );
end
$function$;

create or replace function public.stage_eval_item_low_stock_rows_v1(
  p_file_version_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  version_status text;
  inserted_count integer;
  input_count integer;
begin
  select status into version_status
  from private.ph_eval_item_low_stock_file_versions
  where file_version_id = p_file_version_id
  for update;
  if version_status is null or version_status <> 'importing' then
    raise exception using errcode = '55000', message = 'LOW_STOCK_IMPORT_FILE_NOT_STAGING';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then
    raise exception using errcode = '22023', message = 'LOW_STOCK_IMPORT_ROWS_INVALID';
  end if;
  select count(*) into input_count from jsonb_array_elements(p_rows);
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as x(
      group_key text, itemcode text, quantity_ordered numeric, dock text,
      source_row_number integer, source_sheet_name text
    )
    where nullif(btrim(group_key), '') is null
       or nullif(btrim(itemcode), '') is null
       or quantity_ordered is null or quantity_ordered <= 0
       or quantity_ordered::text in ('NaN', 'Infinity', '-Infinity')
       or nullif(btrim(itemcode), '') is null or upper(btrim(itemcode)) in ('NULL', 'NAN', 'UNDEFINED')
       or nullif(btrim(dock), '') is null
       or lower(btrim(dock)) in ('null', 'nan', 'undefined')
       or (regexp_replace(btrim(dock), ',', '', 'g') ~ '^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$'
           and regexp_replace(btrim(dock), ',', '', 'g')::numeric = 0)
       or source_row_number is null or source_row_number <= 0
       or nullif(btrim(source_sheet_name), '') is null
  ) or (
    select count(*) from jsonb_to_recordset(p_rows) as x(
      group_key text, itemcode text, quantity_ordered numeric, dock text,
      source_row_number integer, source_sheet_name text
    )
  ) <> (
    select count(distinct source_row_number) from jsonb_to_recordset(p_rows) as x(
      group_key text, itemcode text, quantity_ordered numeric, dock text,
      source_row_number integer, source_sheet_name text
    )
  ) then
    raise exception using errcode = '22023', message = 'LOW_STOCK_IMPORT_ROWS_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(
      group_key text, itemcode text, quantity_ordered numeric, dock text,
      source_row_number integer, source_sheet_name text
    )
    join private.ph_eval_item_low_stock_file_versions v on v.file_version_id = p_file_version_id
    where btrim(x.source_sheet_name) <> coalesce(v.source_sheet_name, '')
  ) then
    raise exception using errcode = '22023', message = 'LOW_STOCK_IMPORT_SHEET_MISMATCH';
  end if;

  insert into private.ph_eval_item_low_stock_order_rows(
    file_version_id, source_row_number, group_key, itemcode, quantity_ordered, dock, source_sheet_name
  )
  select p_file_version_id, x.source_row_number, btrim(x.group_key), btrim(x.itemcode),
    x.quantity_ordered, btrim(x.dock), btrim(x.source_sheet_name)
  from jsonb_to_recordset(p_rows) as x(
    group_key text, itemcode text, quantity_ordered numeric, dock text,
    source_row_number integer, source_sheet_name text
  )
  on conflict (file_version_id, source_row_number) do nothing;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(
      group_key text, itemcode text, quantity_ordered numeric, dock text,
      source_row_number integer, source_sheet_name text
    )
    join private.ph_eval_item_low_stock_order_rows r
      on r.file_version_id = p_file_version_id and r.source_row_number = x.source_row_number
    where r.group_key <> btrim(x.group_key)
       or r.itemcode <> btrim(x.itemcode)
       or r.quantity_ordered <> x.quantity_ordered
       or r.dock <> btrim(x.dock)
       or r.source_sheet_name <> btrim(x.source_sheet_name)
  ) then
    raise exception using errcode = '22023', message = 'LOW_STOCK_IMPORT_ROW_CHANGED';
  end if;
  return input_count;
end
$function$;

create or replace function public.finalize_eval_item_low_stock_file_v1(
  p_file_version_id uuid,
  p_content_sha256 text,
  p_expected_row_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target private.ph_eval_item_low_stock_file_versions%rowtype;
  actual_row_count integer;
begin
  select * into target
  from private.ph_eval_item_low_stock_file_versions
  where file_version_id = p_file_version_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'LOW_STOCK_IMPORT_FILE_NOT_FOUND'; end if;
  if target.content_sha256 <> p_content_sha256
     or target.expected_row_count <> p_expected_row_count then
    raise exception using errcode = '22023', message = 'LOW_STOCK_IMPORT_FILE_MANIFEST_MISMATCH';
  end if;
  select count(*)::integer into actual_row_count
  from private.ph_eval_item_low_stock_order_rows
  where file_version_id = p_file_version_id;
  if actual_row_count <> target.expected_row_count then
    raise exception using errcode = '22023', message = 'LOW_STOCK_IMPORT_ROW_COUNT_MISMATCH';
  end if;
  update private.ph_eval_item_low_stock_file_versions
  set status = 'finalized', finalized_at = coalesce(finalized_at, now())
  where file_version_id = p_file_version_id;
  update private.ph_eval_item_low_stock_run_files r
  set file_version_id = target.file_version_id
  from private.ph_eval_item_low_stock_import_runs run
  where run.run_id = r.run_id
    and run.status = 'building'
    and r.drive_file_id = target.drive_file_id
    and r.source_revision = target.source_revision;
  return jsonb_build_object(
    'file_version_id', target.file_version_id,
    'status', 'finalized',
    'eligible_row_count', actual_row_count
  );
end
$function$;

create or replace function public.activate_eval_item_low_stock_import_v1(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '55s'
as $function$
declare
  current_state private.ph_eval_item_low_stock_import_state%rowtype;
  run_status text;
  expected_count integer;
  linked_count integer;
  pending_count integer;
begin
  select * into current_state
  from private.ph_eval_item_low_stock_import_state
  where singleton
  for update;
  select status into run_status
  from private.ph_eval_item_low_stock_import_runs
  where run_id = p_run_id
  for update;
  if run_status is null then raise exception using errcode = 'P0002', message = 'LOW_STOCK_IMPORT_RUN_NOT_FOUND'; end if;
  if run_status = 'active' and current_state.active_run_id = p_run_id then
    return jsonb_build_object('status', 'active', 'run_id', p_run_id);
  end if;
  if run_status <> 'building' or current_state.pending_run_id is distinct from p_run_id then
    raise exception using errcode = '55000', message = 'LOW_STOCK_IMPORT_RUN_SUPERSEDED';
  end if;

  select jsonb_array_length(expected_manifest) into expected_count
  from private.ph_eval_item_low_stock_import_runs where run_id = p_run_id;
  select count(*)::integer into linked_count
  from private.ph_eval_item_low_stock_run_files r
  join private.ph_eval_item_low_stock_file_versions v on v.file_version_id = r.file_version_id
  where r.run_id = p_run_id and v.status = 'finalized'
    and r.drive_file_id = v.drive_file_id and r.source_revision = v.source_revision;
  select count(*)::integer into pending_count
  from private.ph_eval_item_low_stock_run_files r
  left join private.ph_eval_item_low_stock_file_versions v on v.file_version_id = r.file_version_id
  where r.run_id = p_run_id and (r.file_version_id is null or v.status <> 'finalized'
    or r.drive_file_id <> v.drive_file_id or r.source_revision <> v.source_revision);
  if linked_count <> expected_count or pending_count > 0 then
    raise exception using errcode = '55000', message = 'LOW_STOCK_IMPORT_COVERAGE_INCOMPLETE';
  end if;
  -- Compute the expensive full-history group/day reduction exactly once for this
  -- immutable manifest. Public reads and Eval #2 then join this compact cache.
  delete from private.ph_eval_item_low_stock_target_stats where run_id = p_run_id;
  insert into private.ph_eval_item_low_stock_target_stats(
    run_id, itemcode_normalized, qualifying_line_count, qualifying_day_count,
    source_file_count, mean_quantity, p75_quantity, suggested_qty,
    history_from_date, history_through_date, calculated_at
  )
  with active_rows as materialized (
    select
      v.file_version_id, v.drive_file_id, v.source_report_date, v.snapshot_at, v.source_created_at,
      r.group_key, r.itemcode_normalized, r.quantity_ordered
    from private.ph_eval_item_low_stock_run_files rf
    join private.ph_eval_item_low_stock_file_versions v on v.file_version_id = rf.file_version_id
    join private.ph_eval_item_low_stock_order_rows r on r.file_version_id = v.file_version_id
    where rf.run_id = p_run_id and v.status = 'finalized' and v.disposition = 'eligible'
  ), group_files as (
    select distinct source_report_date, group_key, file_version_id, drive_file_id, snapshot_at, source_created_at
    from active_rows
  ), ranked_groups as (
    select source_report_date, group_key, file_version_id,
      snapshot_at, source_created_at, drive_file_id,
      row_number() over (
        partition by source_report_date, group_key
        order by snapshot_at desc, source_created_at desc nulls last, drive_file_id collate "C" desc, file_version_id desc
      ) as file_rank
    from group_files
  ), selected_daily_bags as (
    select a.*
    from active_rows a
    join ranked_groups g using (source_report_date, group_key, file_version_id)
    where g.file_rank = 1
  )
  select
    p_run_id,
    itemcode_normalized,
    count(*)::integer,
    count(distinct source_report_date)::integer,
    count(distinct file_version_id)::integer,
    avg(quantity_ordered)::numeric,
    percentile_disc(0.75) within group (order by quantity_ordered)::numeric,
    ceil(avg(quantity_ordered) + greatest(avg(quantity_ordered), percentile_disc(0.75) within group (order by quantity_ordered)))::integer,
    min(source_report_date),
    max(source_report_date),
    now()
  from selected_daily_bags
  group by itemcode_normalized;
  update private.ph_eval_item_low_stock_import_runs
  set status = 'superseded'
  where run_id = current_state.active_run_id and status = 'active';
  update private.ph_eval_item_low_stock_import_runs
  set status = 'active', activated_at = now()
  where run_id = p_run_id;
  update private.ph_eval_item_low_stock_import_state
  set active_run_id = p_run_id, pending_run_id = null, updated_at = now()
  where singleton;
  return jsonb_build_object('status', 'active', 'run_id', p_run_id);
end
$function$;

create or replace view private.eval_item_low_stock_target_stats_v1
with (security_barrier = true)
as
select
  stats.itemcode_normalized,
  stats.qualifying_line_count,
  stats.qualifying_day_count,
  stats.source_file_count,
  stats.mean_quantity,
  stats.p75_quantity,
  stats.suggested_qty,
  stats.calculated_at as updated_at,
  stats.history_from_date,
  stats.history_through_date
from private.ph_eval_item_low_stock_import_state state
join private.ph_eval_item_low_stock_target_stats stats on stats.run_id = state.active_run_id
where state.singleton;

create or replace function private.can_view_eval_item_low_stock_targets_v1()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from private.current_active_profile() actor
    cross join lateral private.get_effective_app_permissions_v1(
      actor.id, private.resolve_app_access_policy_id_v1(false)
    ) permission
    where permission.allowed
      and permission.permission_key in ('manager.assigned_items_export.view', 'manager.eval_reports_2.view')
  )
$function$;

create or replace function public.get_eval_item_low_stock_targets_v1(
  p_itemcodes text[] default null,
  p_after_itemcode text default null,
  p_limit integer default 500
)
returns table (
  itemcode_normalized text,
  qualifying_line_count integer,
  qualifying_day_count integer,
  source_file_count integer,
  mean_quantity numeric,
  p75_quantity numeric,
  suggested_qty integer,
  manual_override_qty integer,
  effective_qty integer,
  override_revision bigint,
  history_ready boolean,
  history_pending_files integer,
  history_total_files integer,
  history_from_date date,
  history_through_date date,
  calculated_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  requested_count integer;
  fallback_qty integer;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    actor := private.current_active_profile();
    if actor.id is null or not private.can_view_eval_item_low_stock_targets_v1() then
      raise exception using errcode = '42501', message = 'LOW_STOCK_TARGETS_FORBIDDEN';
    end if;
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'LOW_STOCK_TARGETS_LIMIT_INVALID';
  end if;
  if p_itemcodes is not null then
    select count(*) into requested_count from unnest(p_itemcodes);
    if requested_count > 500 then
      raise exception using errcode = '22023', message = 'LOW_STOCK_TARGETS_LIMIT_INVALID';
    end if;
  end if;
  select coalesce((select s.low_stock_max_slts from public.ph_eval_report_settings s where s.singleton limit 1), 150)
  into fallback_qty;

  return query
  with requested as (
    select distinct upper(btrim(code)) as itemcode_normalized
  from unnest(coalesce(p_itemcodes, '{}'::text[])) as requested_codes(code)
    where nullif(btrim(code), '') is not null
    union
    select stats.itemcode_normalized
    from private.eval_item_low_stock_target_stats_v1 stats
    where p_itemcodes is null
    union
    select o.itemcode_normalized
    from private.ph_eval_item_low_stock_overrides o
    where p_itemcodes is null
  ), page as (
    select r.itemcode_normalized
    from requested r
    where p_itemcodes is not null
       or p_after_itemcode is null
       or r.itemcode_normalized > upper(btrim(p_after_itemcode))
    order by r.itemcode_normalized
    limit p_limit
  ), history_state as (
    select
      s.active_run_id is not null and s.pending_run_id is null as history_ready,
      coalesce(jsonb_array_length(scan.expected_manifest), 0)::integer as history_total_files,
      coalesce((
        select count(*)::integer
        from private.ph_eval_item_low_stock_run_files rf
        left join private.ph_eval_item_low_stock_file_versions fv on fv.file_version_id = rf.file_version_id
        where rf.run_id = scan.run_id
          and (rf.file_version_id is null or fv.status <> 'finalized')
      ), 0) as history_pending_files
    from private.ph_eval_item_low_stock_import_state s
    left join private.ph_eval_item_low_stock_import_runs scan
      on scan.run_id = coalesce(s.pending_run_id, s.active_run_id)
    where s.singleton
  )
  select
    p.itemcode_normalized,
    coalesce(s.qualifying_line_count, 0),
    coalesce(s.qualifying_day_count, 0),
    coalesce(s.source_file_count, 0),
    s.mean_quantity,
    s.p75_quantity,
    s.suggested_qty,
    o.manual_override_qty,
    coalesce(o.manual_override_qty, s.suggested_qty, fallback_qty),
    coalesce(o.revision, 0),
    coalesce(h.history_ready, false),
    coalesce(h.history_pending_files, 0),
    coalesce(h.history_total_files, 0),
    s.history_from_date,
    s.history_through_date,
    s.updated_at,
    greatest(s.updated_at, o.updated_at)
  from page p
  left join private.eval_item_low_stock_target_stats_v1 s
    on s.itemcode_normalized = p.itemcode_normalized
  left join private.ph_eval_item_low_stock_overrides o
    on o.itemcode_normalized = p.itemcode_normalized
  cross join history_state h
  order by p.itemcode_normalized;
end
$function$;

create or replace function public.set_eval_item_low_stock_override_v1(
  p_itemcode text,
  p_override_qty integer,
  p_expected_revision bigint
)
returns table (
  itemcode_normalized text,
  qualifying_line_count integer,
  qualifying_day_count integer,
  source_file_count integer,
  mean_quantity numeric,
  p75_quantity numeric,
  suggested_qty integer,
  manual_override_qty integer,
  effective_qty integer,
  override_revision bigint,
  history_ready boolean,
  history_pending_files integer,
  history_total_files integer,
  history_from_date date,
  history_through_date date,
  calculated_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor public.profiles;
  item_key text := upper(btrim(coalesce(p_itemcode, '')));
  current_row private.ph_eval_item_low_stock_overrides%rowtype;
  current_revision bigint;
  next_revision bigint;
  fallback_qty integer;
begin
  actor := private.current_active_profile();
  if actor.id is null or lower(btrim(actor.username)) not in ('dylan_collyge', 'megan_kelly', 'jd_jones') then
    raise exception using errcode = '42501', message = 'LOW_STOCK_OVERRIDE_FORBIDDEN';
  end if;
  if item_key = '' or p_expected_revision is null
     or (p_override_qty is not null and p_override_qty not between 0 and 100000000) then
    raise exception using errcode = '22023', message = 'LOW_STOCK_OVERRIDE_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(item_key, 904221));
  select * into current_row
  from private.ph_eval_item_low_stock_overrides o
  where o.itemcode_normalized = item_key
  for update;
  current_revision := coalesce(current_row.revision, 0);
  if current_revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'LOW_STOCK_OVERRIDE_CONFLICT';
  end if;

  if p_override_qty is not distinct from current_row.manual_override_qty
     and (current_row.itemcode_normalized is not null or p_override_qty is null) then
    null;
  else
    next_revision := current_revision + 1;
    insert into private.ph_eval_item_low_stock_overrides(
      itemcode_normalized, manual_override_qty, revision, updated_by, updated_at
    ) values (item_key, p_override_qty, next_revision, lower(btrim(actor.username)), now())
    on conflict on constraint ph_eval_item_low_stock_overrides_pkey do update
      set manual_override_qty = excluded.manual_override_qty,
          revision = excluded.revision,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;
    insert into private.ph_eval_item_low_stock_override_audit(
      itemcode_normalized, old_override_qty, new_override_qty, revision, changed_by
    ) values (
      item_key,
      case when current_row.itemcode_normalized is null then null else current_row.manual_override_qty end,
      p_override_qty,
      next_revision,
      lower(btrim(actor.username))
    );
  end if;

  select coalesce((select s.low_stock_max_slts from public.ph_eval_report_settings s where s.singleton limit 1), 150)
  into fallback_qty;
  return query
  select
    item_key,
    coalesce(s.qualifying_line_count, 0),
    coalesce(s.qualifying_day_count, 0),
    coalesce(s.source_file_count, 0),
    s.mean_quantity,
    s.p75_quantity,
    s.suggested_qty,
    o.manual_override_qty,
    coalesce(o.manual_override_qty, s.suggested_qty, fallback_qty),
    coalesce(o.revision, 0),
    coalesce(h.history_ready, false),
    coalesce(h.history_pending_files, 0),
    coalesce(h.history_total_files, 0),
    s.history_from_date,
    s.history_through_date,
    s.updated_at,
    greatest(s.updated_at, o.updated_at)
  from (select item_key as itemcode_normalized) item
  left join private.eval_item_low_stock_target_stats_v1 s
    on s.itemcode_normalized = item.itemcode_normalized
  left join private.ph_eval_item_low_stock_overrides o
    on o.itemcode_normalized = item.itemcode_normalized
  cross join (
    select
      state.active_run_id is not null and state.pending_run_id is null as history_ready,
      coalesce(jsonb_array_length(scan.expected_manifest), 0)::integer as history_total_files,
      coalesce((
        select count(*)::integer
        from private.ph_eval_item_low_stock_run_files rf
        left join private.ph_eval_item_low_stock_file_versions fv on fv.file_version_id = rf.file_version_id
        where rf.run_id = scan.run_id
          and (rf.file_version_id is null or fv.status <> 'finalized')
      ), 0) as history_pending_files
    from private.ph_eval_item_low_stock_import_state state
    left join private.ph_eval_item_low_stock_import_runs scan
      on scan.run_id = coalesce(state.pending_run_id, state.active_run_id)
    where state.singleton
  ) h;
end
$function$;

create or replace function private.eval_report2_item_qualifies_v1(
  p_report_id text,
  p_itemcode text,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  report_id text := lower(btrim(coalesce(p_report_id, '')));
  item_key text := upper(btrim(coalesce(p_itemcode, '')));
  app_settings jsonb := private.eval_work_settings_v1();
  current_season text := upper(btrim(coalesce(app_settings->>'seasonCode', 'F1')));
  current_sales_year integer := private.eval_work_normalized_sales_year_v1(app_settings->>'salesYear');
  next_season text;
  next_sales_year integer;
  low_stock_limit numeric := 150;
  hold_age_limit integer := 5;
  location_note_age_limit integer := 10;
  central_today date := (p_now at time zone 'America/Chicago')::date;
  result_value boolean := false;
begin
  if report_id not in (
    's1-with-pri', 'u1', 'u2', 'u3', 'od-loc-note-date', 'hs-plus-5-days',
    'get-off-hold', 'low-stock', 'no-pri', 'culls', 'not-in-f1'
  ) then
    raise exception using errcode = '22023', message = 'eval_report2_report_invalid';
  end if;
  if item_key = '' then return false; end if;
  current_sales_year := coalesce(current_sales_year, 27);
  next_season := case when current_season = 'F1' then 'S1' else 'F1' end;
  next_sales_year := case when current_season = 'F1' then current_sales_year else current_sales_year + 1 end;

  select
    coalesce((select s.low_stock_max_slts from public.ph_eval_report_settings s where s.singleton limit 1), 150),
    coalesce((select s.hold_age_days from public.ph_eval_report_settings s where s.singleton limit 1), 5),
    coalesce((select s.location_note_age_days from public.ph_eval_report_settings s where s.singleton limit 1), 10)
  into low_stock_limit, hold_age_limit, location_note_age_limit;
  select coalesce(o.manual_override_qty, s.suggested_qty, low_stock_limit)
  into low_stock_limit
  from (select item_key as itemcode_normalized) requested
  left join private.eval_item_low_stock_target_stats_v1 s
    on s.itemcode_normalized = requested.itemcode_normalized
  left join private.ph_eval_item_low_stock_overrides o
    on o.itemcode_normalized = requested.itemcode_normalized;

  with item_rows as materialized (
    select
      m.*,
      upper(regexp_replace(btrim(coalesce(m.season, '')), '[[:space:]]+', '', 'g')) as season_key,
      private.eval_work_normalized_sales_year_v1(m.saleyear) as sales_year_key,
      private.eval_report2_inventory_date_v1(m.holdstopbegindate) as hold_start_date,
      private.eval_report2_inventory_date_v1(m.locationnotedate) as location_note_date,
      coalesce(private.eval_work_safe_numeric_v1(m.s_lts), 0) as slts_value
    from public.ph_master_inventory m
    where upper(btrim(coalesce(m.itemcode, ''))) = item_key
      and not private.eval_report2_is_excluded_row_v1(m.season, m.desigitem)
  ), aggregate_flags as (
    select
      count(*) > 0 as has_rows,
      bool_or(nullif(btrim(coalesce(priority, '')), '') is not null) as has_priority,
      bool_or(season_key = 'F1' and sales_year_key between 1 and current_sales_year) as has_valid_f1,
      bool_or(
        upper(btrim(coalesce(holdstopcode, ''))) in ('H', 'S')
        and hold_start_date is not null
        and central_today - hold_start_date > hold_age_limit
      ) as has_old_hold,
      bool_or(
        season_key = current_season
        and sales_year_key between 1 and current_sales_year
        and slts_value < low_stock_limit
      ) as qualifies_low_stock
    from item_rows
  )
  select case report_id
    when 's1-with-pri' then exists (
      select 1 from item_rows where nullif(btrim(coalesce(priority, '')), '') is not null and season_key <> 'F1'
    )
    when 'u1' then exists (select 1 from item_rows where season_key = 'U1')
    when 'u2' then exists (select 1 from item_rows where season_key = 'U2')
    when 'u3' then exists (select 1 from item_rows where season_key = 'U3')
    when 'od-loc-note-date' then exists (
      select 1 from item_rows
      where location_note_date is not null and central_today - location_note_date > location_note_age_limit
    )
    when 'hs-plus-5-days' then exists (
      select 1 from item_rows
      where upper(btrim(coalesce(holdstopcode, ''))) in ('H', 'S')
        and hold_start_date is not null and central_today - hold_start_date > hold_age_limit
    )
    when 'get-off-hold' then (select has_old_hold from aggregate_flags)
      and exists (select 1 from item_rows where nullif(btrim(coalesce(holdstopcode, '')), '') is null)
    when 'low-stock' then (select qualifies_low_stock from aggregate_flags)
      and exists (
        select 1 from item_rows
        where (
          season_key in ('U1', 'U2', 'U3', 'X')
          and sales_year_key between 1 and current_sales_year
        ) or (season_key = next_season and sales_year_key = next_sales_year)
      )
    when 'no-pri' then (select has_rows from aggregate_flags) and not (select has_priority from aggregate_flags)
    when 'culls' then exists (select 1 from item_rows where season_key = 'X')
    when 'not-in-f1' then (select has_rows from aggregate_flags) and not (select has_valid_f1 from aggregate_flags)
    else false
  end into result_value;

  return coalesce(result_value, false);
end
$function$;

revoke all on function public.begin_eval_item_low_stock_import_v1(jsonb) from public, anon, authenticated;
revoke all on function public.prepare_eval_item_low_stock_file_v1(uuid,text,text,text,date,timestamptz,text,text,bigint,text,integer,integer,jsonb,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.stage_eval_item_low_stock_rows_v1(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.finalize_eval_item_low_stock_file_v1(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.activate_eval_item_low_stock_import_v1(uuid) from public, anon, authenticated;
revoke all on function public.get_eval_item_low_stock_targets_v1(text[],text,integer) from public, anon;
revoke all on function public.set_eval_item_low_stock_override_v1(text,integer,bigint) from public, anon;
revoke all on function private.can_view_eval_item_low_stock_targets_v1() from public, anon, authenticated;
revoke all on function private.eval_report2_item_qualifies_v1(text,text,timestamptz) from public, anon, authenticated;

grant execute on function public.begin_eval_item_low_stock_import_v1(jsonb) to service_role;
grant execute on function public.prepare_eval_item_low_stock_file_v1(uuid,text,text,text,date,timestamptz,text,text,bigint,text,integer,integer,jsonb,text,text,timestamptz) to service_role;
grant execute on function public.stage_eval_item_low_stock_rows_v1(uuid,jsonb) to service_role;
grant execute on function public.finalize_eval_item_low_stock_file_v1(uuid,text,integer) to service_role;
grant execute on function public.activate_eval_item_low_stock_import_v1(uuid) to service_role;
grant execute on function public.get_eval_item_low_stock_targets_v1(text[],text,integer) to authenticated, service_role;
grant execute on function public.set_eval_item_low_stock_override_v1(text,integer,bigint) to authenticated;
grant execute on function private.can_view_eval_item_low_stock_targets_v1() to service_role;
grant execute on function private.eval_report2_item_qualifies_v1(text,text,timestamptz) to service_role;

-- Invalidate manager clients when an override changes or a complete history
-- manifest becomes active. Raw import rows stay out of the realtime contract.
insert into app_sync_private.sources(key, modules, dylan_only) values
  ('private.ph_eval_item_low_stock_overrides', '{managers}', false),
  ('private.ph_eval_item_low_stock_import_state', '{managers}', false)
on conflict (key) do update set modules = excluded.modules, dylan_only = excluded.dylan_only;
insert into public.app_dataset_revisions(key)
values ('private.ph_eval_item_low_stock_overrides'), ('private.ph_eval_item_low_stock_import_state')
on conflict (key) do nothing;
do $triggers$
declare table_name text;
begin
  foreach table_name in array array['ph_eval_item_low_stock_overrides', 'ph_eval_item_low_stock_import_state'] loop
    execute format('create trigger app_dataset_revision_inserted after insert on private.%I referencing new table as app_dataset_new_rows for each statement execute function app_sync_private.touch_source()', table_name);
    execute format('create trigger app_dataset_revision_updated after update on private.%I referencing new table as app_dataset_new_rows for each statement execute function app_sync_private.touch_source()', table_name);
    execute format('create trigger app_dataset_revision_deleted after delete on private.%I referencing old table as app_dataset_old_rows for each statement execute function app_sync_private.touch_source()', table_name);
    execute format('create trigger app_dataset_revision_truncated after truncate on private.%I for each statement execute function app_sync_private.touch_source()', table_name);
  end loop;
end
$triggers$;

comment on table private.ph_eval_item_low_stock_import_runs is
  'Immutable full-folder SOC order-history scan manifests. Only a completely reconciled manifest becomes active.';
comment on table private.ph_eval_item_low_stock_file_versions is
  'Service-only immutable SOC report file revisions, including explicitly excluded non-SOC files.';
comment on table private.ph_eval_item_low_stock_order_rows is
  'Service-only qualifying positive-order rows with Dock data, staged by source file revision and original sheet row.';
comment on table private.ph_eval_item_low_stock_overrides is
  'Persistent itemcode-wide manual low-stock quantity overrides, kept separate from re-imported order-history suggestions.';

notify pgrst, 'reload schema';

commit;
