begin;

create table if not exists app_sync_private.ph_master_bulk_import_receipts_v1 (
  request_id uuid primary key,
  run_id uuid not null,
  payload_hash text not null,
  source_digest text not null,
  response jsonb,
  created_at timestamptz not null default clock_timestamp()
);
alter table app_sync_private.ph_master_bulk_import_receipts_v1 enable row level security;
revoke all on app_sync_private.ph_master_bulk_import_receipts_v1 from public, anon, authenticated, service_role;

create table if not exists app_sync_private.ph_master_bulk_import_context_v1 (
  run_id uuid not null,
  request_id uuid not null,
  backend_pid integer not null,
  transaction_id bigint not null,
  source_unique_id text not null,
  canonical_unique_id text,
  raw_values jsonb not null,
  raw_item6_fields text[] not null,
  source_hash text not null,
  primary key (run_id, backend_pid, transaction_id, source_unique_id)
);
alter table app_sync_private.ph_master_bulk_import_context_v1 enable row level security;
revoke all on app_sync_private.ph_master_bulk_import_context_v1 from public, anon, authenticated, service_role;
create index if not exists ph_master_bulk_import_context_run_pid_xid_idx
  on app_sync_private.ph_master_bulk_import_context_v1(run_id, backend_pid, transaction_id, canonical_unique_id);
create index if not exists ph_master_bulk_import_context_request_canonical_idx
  on app_sync_private.ph_master_bulk_import_context_v1(run_id, request_id, backend_pid, transaction_id, canonical_unique_id);

create table if not exists app_sync_private.ph_master_bulk_import_source_v1 (
  canonical_unique_id text primary key,
  source_unique_id text not null,
  source_hash text not null,
  import_run_id uuid not null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table app_sync_private.ph_master_bulk_import_source_v1 enable row level security;
revoke all on app_sync_private.ph_master_bulk_import_source_v1 from public, anon, authenticated, service_role;

create or replace function private.ph_master_bulk_source_hash_v1(p_values jsonb, p_raw_fields text[])
returns text
language sql immutable security definer set search_path = ''
as $function$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'values', coalesce((select jsonb_object_agg(k.key, k.value order by k.key)
      from jsonb_each(coalesce(p_values, '{}'::jsonb)) k(key, value)
      where k.key not in (
        'last_updated','filename','concat','assignedto'
      )), '{}'::jsonb),
    'rawFields', to_jsonb(coalesce(p_raw_fields, '{}'::text[]))
  )::text, 'UTF8'), 'sha256'), 'hex')
$function$;
revoke all on function private.ph_master_bulk_source_hash_v1(jsonb, text[]) from public, anon, authenticated, service_role;

create or replace function private.ph_master_bulk_has_value_v1(p_value text)
returns boolean
language sql immutable security definer set search_path = ''
as $function$
  select nullif(nullif(btrim(p_value), ''), 'NULL') is not null
$function$;
revoke all on function private.ph_master_bulk_has_value_v1(text) from public, anon, authenticated, service_role;

create or replace function private.ph_master_bulk_context_v1(p_run_id uuid, p_unique_id text)
returns app_sync_private.ph_master_bulk_import_context_v1
language sql volatile security definer set search_path = ''
as $function$
  -- Separate indexed branches avoid scanning the complete import context for
  -- every trigger invocation. Later branches handle aliases resolved in-flight.
  select matched.* from (
    select c.* from app_sync_private.ph_master_bulk_import_context_v1 c
    where c.run_id = p_run_id and c.backend_pid = pg_backend_pid()
      and c.transaction_id = txid_current() and c.source_unique_id = p_unique_id
    union all
    select c.* from app_sync_private.ph_master_bulk_import_context_v1 c
    where c.run_id = p_run_id and c.backend_pid = pg_backend_pid()
      and c.transaction_id = txid_current() and c.canonical_unique_id = p_unique_id
    union all
    select c.* from app_sync_private.ph_master_inventory_import_lineage_seen seen
    join app_sync_private.ph_master_bulk_import_context_v1 c
      on c.run_id = seen.run_id and c.source_unique_id = seen.imported_unique_id
    where seen.run_id = p_run_id and seen.canonical_unique_id = p_unique_id
      and c.backend_pid = pg_backend_pid() and c.transaction_id = txid_current()
    union all
    select c.* from app_sync_private.ph_master_inventory_item6_alias_seen_v7 seen
    join app_sync_private.ph_master_bulk_import_context_v1 c
      on c.run_id = seen.run_id and c.source_unique_id = seen.imported_unique_id
    where seen.run_id = p_run_id and seen.canonical_unique_id = p_unique_id
      and c.backend_pid = pg_backend_pid() and c.transaction_id = txid_current()
  ) matched limit 1
$function$;
revoke all on function private.ph_master_bulk_context_v1(uuid, text) from public, anon, authenticated, service_role;

create or replace function private.ph_master_bulk_assignedto_override_v1(p_row jsonb)
returns text
language plpgsql immutable security definer set search_path = ''
as $function$
declare
  common_name text := lower(btrim(coalesce(p_row->>'commonname', p_row->>'COMMONNAME', p_row->>'description', p_row->>'DESCRIPTION', '')));
  genus_name text := lower(btrim(coalesce(p_row->>'genusname', p_row->>'GENUSNAME', p_row->>'genus', p_row->>'GENUS', '')));
  plant_group text := upper(btrim(coalesce(p_row->>'plantgroupcode', p_row->>'PLANTGROUPCODE', p_row->>'plantgroup', p_row->>'PLANTGROUP', '')));
  location_code text := upper(btrim(coalesce(p_row->>'locationcode', p_row->>'LOCATIONCODE', p_row->>'location', p_row->>'LOCATION', '')));
  location_parts text[];
  block_number integer;
begin
  if position('hydrangea m' in genus_name) > 0 then return 'megan_kelly'; end if;
  if plant_group = '140_GRASS' then return 'dylan_collyge'; end if;
  if position('hosta' in common_name || ' ' || genus_name) = 0 then return null; end if;
  location_parts := regexp_match(location_code, '^([A-Z])\.([0-9]{1,2})(\.|$)');
  if location_parts is null then return 'bobby_adair'; end if;
  block_number := location_parts[2]::integer;
  if (location_parts[1] = 'D' and block_number between 6 and 10)
     or (location_parts[1] = 'C' and block_number in (6, 7)) then
    return 'zoe_green';
  end if;
  return 'bobby_adair';
end
$function$;
revoke all on function private.ph_master_bulk_assignedto_override_v1(jsonb) from public, anon, authenticated, service_role;

create or replace function private.ph_master_bulk_isolation_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_run_id uuid;
  context_row app_sync_private.ph_master_bulk_import_context_v1;
  baseline_row app_sync_private.ph_master_inventory_source_baselines;
  field_name text;
  item6_fields constant text[] := array[
    'locationnote','locationptn1','desigitem','desigcust','desigloc',
    'pullerresponsibility','oversellpercentage','salesnote','suspend'
  ];
begin
  v_run_id := private.ph_master_inventory_import_run_v1();
  if v_run_id is null then return new; end if;
  context_row := private.ph_master_bulk_context_v1(v_run_id, new.unique_id);
  if context_row.source_unique_id is null then return new; end if;
  select * into baseline_row
  from app_sync_private.ph_master_inventory_source_baselines b
  where b.canonical_unique_id = coalesce(context_row.canonical_unique_id, new.unique_id);

  -- Pass source values through the existing acknowledgement guards. The bulk
  -- INSERT/UPDATE projection deliberately omits these live protected columns.
  foreach field_name in array array['priority','holdstopcode','holdstopreason'] loop
    if context_row.raw_values ? field_name then
      if field_name = 'priority' then new.priority := nullif(context_row.raw_values->>field_name, '');
      elsif field_name = 'holdstopcode' then new.holdstopcode := nullif(context_row.raw_values->>field_name, '');
      else new.holdstopreason := nullif(context_row.raw_values->>field_name, ''); end if;
    elsif baseline_row.canonical_unique_id is not null then
      if field_name = 'priority' then new.priority := baseline_row.priority;
      elsif field_name = 'holdstopcode' then new.holdstopcode := baseline_row.holdstopcode;
      else new.holdstopreason := baseline_row.holdstopreason; end if;
    end if;
  end loop;
  foreach field_name in array item6_fields loop
    if context_row.raw_values ? field_name then
      if field_name = 'locationnote' then new.locationnote := nullif(context_row.raw_values->>field_name, '');
      elsif field_name = 'locationptn1' then new.locationptn1 := nullif(context_row.raw_values->>field_name, '');
      elsif field_name = 'desigitem' then new.desigitem := nullif(context_row.raw_values->>field_name, '');
      elsif field_name = 'desigcust' then new.desigcust := nullif(context_row.raw_values->>field_name, '');
      elsif field_name = 'desigloc' then new.desigloc := nullif(context_row.raw_values->>field_name, '');
      elsif field_name = 'pullerresponsibility' then new.pullerresponsibility := nullif(context_row.raw_values->>field_name, '');
      elsif field_name = 'oversellpercentage' then new.oversellpercentage := nullif(context_row.raw_values->>field_name, '');
      elsif field_name = 'salesnote' then new.salesnote := nullif(context_row.raw_values->>field_name, '');
      elsif field_name = 'suspend' then new.suspend := nullif(context_row.raw_values->>field_name, ''); end if;
    elsif tg_op = 'UPDATE' then
      if field_name = 'locationnote' then new.locationnote := old.locationnote;
      elsif field_name = 'locationptn1' then new.locationptn1 := old.locationptn1;
      elsif field_name = 'desigitem' then new.desigitem := old.desigitem;
      elsif field_name = 'desigcust' then new.desigcust := old.desigcust;
      elsif field_name = 'desigloc' then new.desigloc := old.desigloc;
      elsif field_name = 'pullerresponsibility' then new.pullerresponsibility := old.pullerresponsibility;
      elsif field_name = 'oversellpercentage' then new.oversellpercentage := old.oversellpercentage;
      elsif field_name = 'salesnote' then new.salesnote := old.salesnote;
      elsif field_name = 'suspend' then new.suspend := old.suspend; end if;
    end if;
  end loop;
  return new;
end
$function$;
revoke all on function private.ph_master_bulk_isolation_v1() from public, anon, authenticated, service_role;
drop trigger if exists aa00_ph_master_bulk_raw_context_v1 on public.ph_master_inventory;
create trigger aa00_ph_master_bulk_raw_context_v1
before insert or update on public.ph_master_inventory
for each row execute function private.ph_master_bulk_isolation_v1();

create or replace function private.ph_master_bulk_live_field_isolation_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_run_id uuid;
  context_row app_sync_private.ph_master_bulk_import_context_v1;
begin
  v_run_id := private.ph_master_inventory_import_run_v1();
  if v_run_id is null then return new; end if;
  context_row := private.ph_master_bulk_context_v1(v_run_id, new.unique_id);
  if context_row.source_unique_id is null then return new; end if;
  if tg_op = 'UPDATE' then
    -- Omission preserves live priority; the early trigger keeps the prior raw
    -- baseline available to acknowledgement guards without publishing it.
    if not (context_row.raw_values ? 'priority') then new.priority := old.priority; end if;
    new.holdstopcode := old.holdstopcode;
    new.holdstopreason := old.holdstopreason;
    new.locationnote := old.locationnote;
    if nullif(nullif(btrim(old.date_completed::text), ''), 'NULL') is not null then new.date_completed := old.date_completed; end if;
    if nullif(nullif(btrim(old.app_tab_assignment::text), ''), 'NULL') is not null then new.app_tab_assignment := old.app_tab_assignment; end if;
    if nullif(nullif(btrim(old.av_note::text), ''), 'NULL') is not null then new.av_note := old.av_note; end if;
    if nullif(nullif(btrim(old.sales_note::text), ''), 'NULL') is not null then new.sales_note := old.sales_note; end if;
    if nullif(nullif(btrim(old.match::text), ''), 'NULL') is not null then new.match := old.match; end if;
    if nullif(nullif(btrim(old.spec::text), ''), 'NULL') is not null then new.spec := old.spec; end if;
    if nullif(nullif(btrim(old.caliper::text), ''), 'NULL') is not null then new.caliper := old.caliper; end if;
    if nullif(nullif(btrim(old.pic_note::text), ''), 'NULL') is not null then new.pic_note := old.pic_note; end if;
    if nullif(nullif(btrim(old.loc_match_qty::text), ''), 'NULL') is not null then new.loc_match_qty := old.loc_match_qty; end if;
    if nullif(nullif(btrim(old.initial_ptr::text), ''), 'NULL') is not null then new.initial_ptr := old.initial_ptr; end if;
    if nullif(nullif(btrim(old.photo_link::text), ''), 'NULL') is not null then new.photo_link := old.photo_link; end if;
    if nullif(nullif(btrim(old.photo_name::text), ''), 'NULL') is not null then new.photo_name := old.photo_name; end if;
    if nullif(nullif(btrim(old.hold_release_approved_at::text), ''), 'NULL') is not null then new.hold_release_approved_at := old.hold_release_approved_at; end if;
    if nullif(nullif(btrim(old.hold_release_approved_by::text), ''), 'NULL') is not null then new.hold_release_approved_by := old.hold_release_approved_by; end if;
    if nullif(nullif(btrim(old.hold_release_approved_by_display::text), ''), 'NULL') is not null then new.hold_release_approved_by_display := old.hold_release_approved_by_display; end if;
    if nullif(nullif(btrim(old.hold_release_approved_holdstopbegindate::text), ''), 'NULL') is not null then new.hold_release_approved_holdstopbegindate := old.hold_release_approved_holdstopbegindate; end if;
  else
    new.holdstopcode := null;
    new.holdstopreason := null;
    new.locationnote := null;
  end if;
  return new;
end
$function$;
revoke all on function private.ph_master_bulk_live_field_isolation_v1() from public, anon, authenticated, service_role;
drop trigger if exists aabz_ph_master_bulk_import_field_isolation_v1 on public.ph_master_inventory;
create trigger aabz_ph_master_bulk_import_field_isolation_v1
before insert or update on public.ph_master_inventory
for each row execute function private.ph_master_bulk_live_field_isolation_v1();

create or replace function public.bulk_import_master_snapshot_v1(
  p_run_id uuid,
  p_request_id uuid,
  p_rows jsonb,
  p_source_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
set statement_timeout = '55s'
set lock_timeout = '5s'
as $function$
declare
  current_run_id uuid;
  v_rows jsonb := p_rows;
  request_row app_sync_private.ph_master_bulk_import_receipts_v1;
  payload_hash text;
  source_rows integer;
  inserted_rows integer := 0;
  updated_rows integer := 0;
  unchanged_rows integer := 0;
  deleted_rows integer := 0;
  tuple_value record;
  allowed_item6 constant text[] := array[
    'locationnote','locationptn1','desigitem','desigcust','desigloc',
    'pullerresponsibility','oversellpercentage','salesnote','suspend'
  ];
  app_owned constant text[] := array[
    'date_completed','app_tab_assignment','av_note','sales_note','match','spec','caliper',
    'pic_note','loc_match_qty','initial_ptr','photo_link','photo_name',
    'hold_release_approved_at','hold_release_approved_by','hold_release_approved_by_display',
    'hold_release_approved_holdstopbegindate'
  ];
  input_headers jsonb;
  column_names text;
  select_values text;
  set_values text;
  sql_text text;
  batch_inserted integer;
  batch_updated integer;
  response_value jsonb;
  changed_predicate text;
  update_fields text[];
  insert_fields text[];
  protected_fields constant text[] := array['holdstopcode','holdstopreason','locationnote'];
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'BULK_MASTER_IMPORT_FORBIDDEN';
  end if;
  if p_run_id is null or p_request_id is null
     or p_source_digest is null or p_source_digest !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 50000
     or octet_length(p_rows::text) > 67108864 then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_INPUT_INVALID';
  end if;
  payload_hash := encode(extensions.digest(convert_to(p_rows::text, 'UTF8'), 'sha256'), 'hex');

  insert into app_sync_private.ph_master_bulk_import_receipts_v1(
    request_id, run_id, payload_hash, source_digest
  ) values (p_request_id, p_run_id, payload_hash, p_source_digest)
  on conflict (request_id) do nothing;
  select * into request_row
  from app_sync_private.ph_master_bulk_import_receipts_v1 r
  where r.request_id = p_request_id
  for update;
  if request_row.run_id is distinct from p_run_id
     or request_row.payload_hash is distinct from payload_hash
     or request_row.source_digest is distinct from p_source_digest then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_REQUEST_ID_REUSED';
  end if;
  if request_row.response is not null then return request_row.response; end if;

  input_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  if nullif(input_headers->>'x-gnc-import-run-id', '') is not null
     and input_headers->>'x-gnc-import-run-id' <> p_run_id::text then
    raise exception using errcode = '55000', message = 'BULK_MASTER_IMPORT_FENCE_MISMATCH';
  end if;
  input_headers := jsonb_set(input_headers, '{x-gnc-import-run-id}', to_jsonb(p_run_id::text), true);
  perform set_config('request.headers', input_headers::text, true);
  current_run_id := private.ph_master_inventory_import_run_v1();
  if current_run_id is distinct from p_run_id then
    raise exception using errcode = '55000', message = 'BULK_MASTER_IMPORT_FENCE_LOST';
  end if;
  if not exists (
    select 1 from app_sync_private.import_runs r
    where r.id = p_run_id and 'ph_master_inventory' = any(r.canonical_keys)
  ) then
    raise exception using errcode = '55000', message = 'BULK_MASTER_IMPORT_FENCE_LOST';
  end if;
  perform 1 from app_sync_private.import_runs r
  where r.id = p_run_id and r.state = 'active' and r.expires_at > clock_timestamp()
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'BULK_MASTER_IMPORT_FENCE_LOST';
  end if;
  perform 1 from app_sync_private.import_leases l
  where l.key = 'ph_master_inventory' and l.run_id = p_run_id
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'BULK_MASTER_IMPORT_FENCE_LOST';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) as e(value)
    where jsonb_typeof(e.value) is distinct from 'object'
       or jsonb_typeof(e.value->'values') is distinct from 'object'
       or jsonb_typeof(e.value->'rawFields') is distinct from 'array'
       or (e.value - 'values' - 'rawFields') <> '{}'::jsonb
       or nullif(btrim(e.value->'values'->>'unique_id'), '') is null
       or exists(select 1 from jsonb_array_elements(e.value->'rawFields') f(value)
         where jsonb_typeof(f.value) is distinct from 'string')
  ) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_ROW_INVALID';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) as e(value)
    group by e.value->'values'->>'unique_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_DUPLICATE_UNIQUE_ID';
  end if;

  drop table if exists pg_temp.ph_master_bulk_stage_v1;
  -- The composite is expanded once per row via LATERAL, avoiding repeated
  -- jsonb_populate_record evaluation for every master column.
  create temp table ph_master_bulk_stage_v1 on commit drop as
  select e.ordinality::bigint as row_number,
         e.value->'values' as raw_values,
         jsonb_array_length(e.value->'rawFields') as raw_item6_count,
         array(select distinct jsonb_array_elements_text(e.value->'rawFields') order by 1) as raw_item6_fields,
         array(select k.key from jsonb_object_keys(e.value->'values') as k(key) order by k.key) as field_keys,
         private.ph_master_inventory_lineage_key_v1(e.value->'values') as lineage_key,
         private.ph_master_bulk_source_hash_v1(e.value->'values', array(select distinct jsonb_array_elements_text(e.value->'rawFields') order by 1)) as source_hash,
         typed.*
  from jsonb_array_elements(v_rows) with ordinality as e(value, ordinality)
  cross join lateral jsonb_populate_record(null::public.ph_master_inventory, e.value->'values') as typed;
  create unique index ph_master_bulk_stage_v1_uidx on pg_temp.ph_master_bulk_stage_v1(unique_id);
  create index ph_master_bulk_stage_v1_lineage_idx on pg_temp.ph_master_bulk_stage_v1(lineage_key);

  select count(*)::integer into source_rows from pg_temp.ph_master_bulk_stage_v1;
  if source_rows <> jsonb_array_length(p_rows)
     or exists(select 1 from pg_temp.ph_master_bulk_stage_v1 where unique_id is null or btrim(unique_id) = '')
     or exists(select 1 from pg_temp.ph_master_bulk_stage_v1 s
       where cardinality(s.raw_item6_fields) <> s.raw_item6_count) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_ROW_INVALID';
  end if;
  if exists (
    select 1
    from (select distinct unnest(s.field_keys) as key from pg_temp.ph_master_bulk_stage_v1 s) k
    where not exists (
        select 1 from pg_attribute a
        where a.attrelid = 'public.ph_master_inventory'::regclass
          and a.attname = k.key and a.attnum > 0 and not a.attisdropped
    )
  ) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_COLUMN_INVALID';
  end if;
  if exists (
    select 1 from pg_temp.ph_master_bulk_stage_v1 s
    where exists(select 1 from unnest(s.raw_item6_fields) f(field_name)
      where not (f.field_name = any(allowed_item6)) or not (s.raw_values ? f.field_name))
       or exists(select 1 from unnest(allowed_item6) f(field_name)
      where s.raw_values ? f.field_name and not (f.field_name = any(s.raw_item6_fields)))
  ) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_ITEM6_MASK_INVALID';
  end if;
  if exists (select 1 from pg_temp.ph_master_bulk_stage_v1 s where s.lineage_key is null) then
    raise exception using errcode = '22023', message = 'BULK_MASTER_IMPORT_IDENTITY_INVALID';
  end if;

  drop table if exists pg_temp.ph_master_bulk_map_v1;
  create temp table ph_master_bulk_map_v1 on commit drop as
  with candidates as materialized (
    select s.row_number, m.unique_id as canonical_unique_id
    from pg_temp.ph_master_bulk_stage_v1 s
    join public.ph_master_inventory m on m.unique_id = s.unique_id
    union all
    select s.row_number, m.unique_id
    from pg_temp.ph_master_bulk_stage_v1 s
    join app_sync_private.ph_master_inventory_source_baselines b on b.lineage_key = s.lineage_key
    join public.ph_master_inventory m on m.unique_id = b.canonical_unique_id
    where not exists(select 1 from public.ph_master_inventory exact_row where exact_row.unique_id = s.unique_id)
    union all
    select s.row_number, m.unique_id
    from pg_temp.ph_master_bulk_stage_v1 s
    join app_sync_private.ph_master_inventory_item6_source_v7 item6
      on item6.stable_identity_key = private.ph_master_inventory_stable_identity_v7(s.raw_values)
    join public.ph_master_inventory m on m.unique_id = item6.canonical_unique_id
    where not exists(select 1 from public.ph_master_inventory exact_row where exact_row.unique_id = s.unique_id)
      and exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 edit
        where edit.canonical_unique_id = item6.canonical_unique_id and edit.pending
          and edit.field_name in ('desigitem','desigcust','desigloc'))
  )
  select s.row_number, s.unique_id as source_unique_id, min(c.canonical_unique_id) as canonical_unique_id,
         count(distinct c.canonical_unique_id)::integer as candidate_count
  from pg_temp.ph_master_bulk_stage_v1 s
  left join candidates c on c.row_number = s.row_number
  group by s.row_number, s.unique_id;
  create unique index ph_master_bulk_map_v1_row_idx on pg_temp.ph_master_bulk_map_v1(row_number);
  create index ph_master_bulk_map_v1_canonical_idx on pg_temp.ph_master_bulk_map_v1(canonical_unique_id);
  if exists(select 1 from pg_temp.ph_master_bulk_map_v1 where candidate_count > 1) then
    raise exception using errcode = '40001', message = 'BULK_MASTER_IMPORT_LINEAGE_AMBIGUOUS';
  end if;
  if exists(select 1 from pg_temp.ph_master_bulk_map_v1 group by canonical_unique_id
    having canonical_unique_id is not null and count(*) > 1) then
    raise exception using errcode = '40001', message = 'BULK_MASTER_IMPORT_LINEAGE_AMBIGUOUS';
  end if;

  insert into app_sync_private.ph_master_bulk_import_context_v1(
    run_id, request_id, backend_pid, transaction_id, source_unique_id,
    canonical_unique_id, raw_values, raw_item6_fields, source_hash
  )
  select p_run_id, p_request_id, pg_backend_pid(), txid_current(), m.source_unique_id,
    m.canonical_unique_id, s.raw_values, s.raw_item6_fields, s.source_hash
  from pg_temp.ph_master_bulk_map_v1 m
  join pg_temp.ph_master_bulk_stage_v1 s using (row_number);

  for tuple_value in
    select s.raw_item6_fields, s.field_keys,
      bool_and(s.raw_values ? 'priority' and s.raw_values ? 'holdstopcode' and s.raw_values ? 'holdstopreason') as complete_hold_tuple
    from pg_temp.ph_master_bulk_stage_v1 s
    group by s.raw_item6_fields, s.field_keys
    order by array_to_string(s.raw_item6_fields, ','), array_to_string(s.field_keys, ',')
  loop
    input_headers := jsonb_build_object(
      'x-gnc-import-run-id', p_run_id::text,
      'x-gnc-master-item6-fields', to_jsonb(tuple_value.raw_item6_fields)::text
    );
    if tuple_value.complete_hold_tuple then
      input_headers := input_headers || jsonb_build_object('x-gnc-master-tuple-policy', 'raw-priority-hold-v1');
    end if;
    perform set_config('request.headers', input_headers::text, true);

    select array_agg(f.column_name order by f.ordinality)
    into insert_fields
    from unnest(tuple_value.field_keys) with ordinality as f(column_name, ordinality)
    where f.column_name <> 'unique_id'
      and f.column_name <> 'assignedto'
      and not (f.column_name = any(protected_fields));
    update_fields := insert_fields;
    select string_agg(format('%I', f.column_name), ', ' order by f.ordinality),
           string_agg('s.' || format('%I', f.column_name), ', ' order by f.ordinality)
      into column_names, select_values
    from unnest(insert_fields) with ordinality as f(column_name, ordinality);
    column_names := 'unique_id' || case when column_names is null then '' else ', ' || column_names end || ', assignedto';
    select_values := 's.unique_id' || case when select_values is null then '' else ', ' || select_values end
      || ', private.ph_master_bulk_assignedto_override_v1(to_jsonb(s))';

    select string_agg(
      case when f.column_name = any(app_owned) then
        format('%1$I = case when private.ph_master_bulk_has_value_v1(target.%1$I::text) then target.%1$I else excluded.%1$I end', f.column_name)
      else format('%I = excluded.%I', f.column_name, f.column_name) end,
      ', ' order by f.ordinality
    )
      into set_values
    from unnest(update_fields) with ordinality as f(column_name, ordinality);
    set_values := coalesce(set_values || ', ', '')
      || 'assignedto = coalesce(private.ph_master_bulk_assignedto_override_v1(to_jsonb(excluded)), '
      || 'private.ph_master_bulk_assignedto_override_v1(to_jsonb(target)), target.assignedto)';

    changed_predicate := '(select c.source_hash from private.ph_master_bulk_context_v1('
      || quote_literal(p_run_id::text) || '::uuid, target.unique_id) c) is distinct from '
      || '(select prior_source.source_hash from app_sync_private.ph_master_bulk_import_source_v1 prior_source '
      || 'where prior_source.canonical_unique_id = target.unique_id)';

    sql_text := format(
      'with affected as (
         insert into public.ph_master_inventory as target (%s)
         select %s from pg_temp.ph_master_bulk_stage_v1 s
         join pg_temp.ph_master_bulk_map_v1 mapped using (row_number)
         where s.raw_item6_fields = $1 and s.field_keys = $2
           and (mapped.canonical_unique_id is null or not exists(
             select 1 from app_sync_private.ph_master_bulk_import_source_v1 prior_source
             where prior_source.canonical_unique_id = mapped.canonical_unique_id
               and prior_source.source_hash = s.source_hash
           ))
         on conflict (unique_id) do update set %s where %s
         returning (xmax = 0) as inserted
       ) select count(*) filter (where inserted)::integer, count(*) filter (where not inserted)::integer from affected',
      column_names, select_values, set_values, changed_predicate
    );
    execute sql_text into batch_inserted, batch_updated using tuple_value.raw_item6_fields, tuple_value.field_keys;
    inserted_rows := inserted_rows + batch_inserted;
    updated_rows := updated_rows + batch_updated;
  end loop;
  unchanged_rows := greatest(0, source_rows - inserted_rows - updated_rows);

  update pg_temp.ph_master_bulk_map_v1 mapped
  set canonical_unique_id = priority_seen.canonical_unique_id
  from app_sync_private.ph_master_inventory_import_lineage_seen priority_seen
  where mapped.canonical_unique_id is null and priority_seen.run_id = p_run_id
    and priority_seen.imported_unique_id = mapped.source_unique_id;
  update pg_temp.ph_master_bulk_map_v1 mapped
  set canonical_unique_id = coalesce(mapped.canonical_unique_id, item6_seen.canonical_unique_id, mapped.source_unique_id)
  from app_sync_private.ph_master_inventory_item6_alias_seen_v7 item6_seen
  where item6_seen.run_id = p_run_id and item6_seen.imported_unique_id = mapped.source_unique_id
    and mapped.canonical_unique_id is null;
  update pg_temp.ph_master_bulk_map_v1 mapped
  set canonical_unique_id = mapped.source_unique_id
  where mapped.canonical_unique_id is null;

  -- locationnote is source-acknowledged by the existing Item6 guard, while the
  -- live column remains isolated. New rows need the same private source value.
  update app_sync_private.ph_master_inventory_item6_source_v7 i
  set field_values = jsonb_set(i.field_values, '{locationnote}', c.raw_values->'locationnote', true),
      imported_at = clock_timestamp(), import_run_id = p_run_id
  from app_sync_private.ph_master_bulk_import_context_v1 c
  left join app_sync_private.ph_master_inventory_import_lineage_seen priority_seen
    on priority_seen.run_id = c.run_id and priority_seen.imported_unique_id = c.source_unique_id
  left join app_sync_private.ph_master_inventory_item6_alias_seen_v7 item6_seen
    on item6_seen.run_id = c.run_id and item6_seen.imported_unique_id = c.source_unique_id
  where c.run_id = p_run_id and c.request_id = p_request_id
    and c.backend_pid = pg_backend_pid() and c.transaction_id = txid_current()
    and c.raw_item6_fields @> array['locationnote']
    and i.canonical_unique_id = coalesce(c.canonical_unique_id,
      priority_seen.canonical_unique_id, item6_seen.canonical_unique_id, c.source_unique_id)
    and i.field_values->'locationnote' is distinct from c.raw_values->'locationnote';

  insert into app_sync_private.ph_master_bulk_import_source_v1(
    canonical_unique_id, source_unique_id, source_hash, import_run_id
  )
  select coalesce(c.canonical_unique_id, priority_seen.canonical_unique_id,
    item6_seen.canonical_unique_id, c.source_unique_id), c.source_unique_id, c.source_hash, p_run_id
  from app_sync_private.ph_master_bulk_import_context_v1 c
  left join app_sync_private.ph_master_inventory_import_lineage_seen priority_seen
    on priority_seen.run_id = c.run_id and priority_seen.imported_unique_id = c.source_unique_id
  left join app_sync_private.ph_master_inventory_item6_alias_seen_v7 item6_seen
    on item6_seen.run_id = c.run_id and item6_seen.imported_unique_id = c.source_unique_id
  where c.run_id = p_run_id and c.request_id = p_request_id
    and c.backend_pid = pg_backend_pid() and c.transaction_id = txid_current()
  on conflict (canonical_unique_id) do update set
    source_unique_id = excluded.source_unique_id, source_hash = excluded.source_hash,
    import_run_id = excluded.import_run_id, updated_at = clock_timestamp()
  where app_sync_private.ph_master_bulk_import_source_v1.source_hash is distinct from excluded.source_hash
     or app_sync_private.ph_master_bulk_import_source_v1.source_unique_id is distinct from excluded.source_unique_id;

  perform set_config('request.headers', jsonb_build_object('x-gnc-import-run-id', p_run_id::text)::text, true);
  delete from public.ph_master_inventory live
  where not exists (
    select 1 from pg_temp.ph_master_bulk_map_v1 m where m.canonical_unique_id = live.unique_id
  );
  get diagnostics deleted_rows = row_count;
  delete from app_sync_private.ph_master_bulk_import_source_v1 s
  where not exists(select 1 from public.ph_master_inventory m where m.unique_id = s.canonical_unique_id);

  response_value := jsonb_build_object(
    'published', true,
    'runId', p_run_id,
    'requestId', p_request_id,
    'sourceDigest', p_source_digest,
    'sourceRows', source_rows,
    'inserted', inserted_rows,
    'updated', updated_rows,
    'deleted', deleted_rows,
    'unchanged', unchanged_rows
  );
  delete from app_sync_private.ph_master_bulk_import_context_v1
  where run_id = p_run_id and request_id = p_request_id
    and backend_pid = pg_backend_pid() and transaction_id = txid_current();
  update app_sync_private.ph_master_bulk_import_receipts_v1
  set response = response_value
  where request_id = p_request_id;
  return response_value;
end
$function$;
revoke all on function public.bulk_import_master_snapshot_v1(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.bulk_import_master_snapshot_v1(uuid, uuid, jsonb, text) to service_role;

notify pgrst, 'reload schema';
commit;
