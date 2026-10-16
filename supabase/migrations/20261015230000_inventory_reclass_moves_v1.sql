begin;

create table if not exists private.ph_inventory_reclass_commands_v1 (
  request_id uuid primary key default gen_random_uuid(),
  operation_order bigint generated always as identity unique,
  actor_id uuid not null,
  command_id text not null,
  request jsonb not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique(actor_id, command_id)
);
alter table private.ph_inventory_reclass_commands_v1 enable row level security;
revoke all on private.ph_inventory_reclass_commands_v1 from public, anon, authenticated, service_role;

create table if not exists private.ph_inventory_reclass_batch_receipts_v1 (
  request_id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  command_id text not null,
  request jsonb not null,
  child_request_ids uuid[] not null default '{}'::uuid[],
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique(actor_id, command_id)
);
alter table private.ph_inventory_reclass_batch_receipts_v1 enable row level security;
revoke all on private.ph_inventory_reclass_batch_receipts_v1 from public, anon, authenticated, service_role;

create table if not exists private.ph_inventory_reclass_movements_v1 (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references private.ph_inventory_reclass_commands_v1(request_id),
  line_index integer not null,
  direction text not null check (direction in ('move_up','move_down')),
  destination_season text not null,
  quantity numeric not null check (quantity > 0 and quantity = trunc(quantity)),
  source_unique_id text not null,
  destination_unique_id text not null,
  source_lineage_key text not null,
  destination_lineage_key text not null,
  source_identity jsonb not null,
  destination_identity jsonb not null,
  source_before jsonb not null,
  source_after jsonb not null,
  destination_before jsonb,
  destination_after jsonb not null,
  status text not null default 'pending' check (status in ('pending','acknowledged','conflict')),
  conflict_reason text,
  updated_at timestamptz not null default clock_timestamp(),
  unique(request_id, line_index)
);
alter table private.ph_inventory_reclass_movements_v1 enable row level security;
create index if not exists ph_inventory_reclass_movements_pending_v1_idx
  on private.ph_inventory_reclass_movements_v1(status, request_id);
create index if not exists ph_inventory_reclass_movements_rows_v1_idx
  on private.ph_inventory_reclass_movements_v1(source_unique_id, destination_unique_id, status);
revoke all on private.ph_inventory_reclass_movements_v1 from public, anon, authenticated, service_role;

create table if not exists private.ph_inventory_reclass_import_aliases_v1 (
  lineage_key text primary key,
  canonical_unique_id text not null,
  request_id uuid not null references private.ph_inventory_reclass_commands_v1(request_id),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.ph_inventory_reclass_import_aliases_v1 enable row level security;
create index if not exists ph_inventory_reclass_import_aliases_canonical_v1_idx
  on private.ph_inventory_reclass_import_aliases_v1(canonical_unique_id);
revoke all on private.ph_inventory_reclass_import_aliases_v1 from public, anon, authenticated, service_role;

create table if not exists private.ph_inventory_reclass_import_conflicts_v1 (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  import_request_id uuid not null,
  movement_request_id uuid not null references private.ph_inventory_reclass_commands_v1(request_id),
  source_unique_id text not null,
  canonical_unique_id text,
  lineage_key text,
  source_hash text not null,
  raw_values jsonb not null,
  raw_item6_fields text[] not null,
  conflict_reason text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(run_id,import_request_id,movement_request_id,source_unique_id)
);
alter table private.ph_inventory_reclass_import_conflicts_v1 enable row level security;
revoke all on private.ph_inventory_reclass_import_conflicts_v1 from public, anon, authenticated, service_role;
create index if not exists ph_inventory_reclass_import_conflicts_request_v1_idx
  on private.ph_inventory_reclass_import_conflicts_v1(movement_request_id,created_at desc);

create or replace function private.record_inventory_reclass_import_conflict_v1(
  p_run_id uuid,p_import_request_id uuid,p_movement_request_id uuid,
  p_canonical_uid text,p_lineage_key text,p_reason text,p_rows jsonb
)
returns integer
language plpgsql security definer set search_path = ''
as $function$
declare affected integer;
begin
  insert into private.ph_inventory_reclass_import_conflicts_v1(
    run_id,import_request_id,movement_request_id,source_unique_id,canonical_unique_id,lineage_key,
    source_hash,raw_values,raw_item6_fields,conflict_reason
  )
  select p_run_id,p_import_request_id,p_movement_request_id,s.unique_id,s.canonical_unique_id,s.lineage_key,
    s.source_hash,s.raw_values,s.raw_item6_fields,p_reason
  from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) as s(
    unique_id text,canonical_unique_id text,lineage_key text,source_hash text,raw_values jsonb,raw_item6_fields text[])
  on conflict(run_id,import_request_id,movement_request_id,source_unique_id) do update set
    canonical_unique_id=excluded.canonical_unique_id,lineage_key=excluded.lineage_key,
    source_hash=excluded.source_hash,raw_values=excluded.raw_values,raw_item6_fields=excluded.raw_item6_fields,
    conflict_reason=excluded.conflict_reason;
  get diagnostics affected=row_count;
  return affected;
end
$function$;
revoke all on function private.record_inventory_reclass_import_conflict_v1(uuid,uuid,uuid,text,text,text,jsonb) from public, anon, authenticated, service_role;

create or replace function private.reclass_numeric_v1(p_value text)
returns numeric
language plpgsql immutable security definer set search_path = ''
as $function$
declare normalized text := replace(btrim(coalesce(p_value,'')), ',', '');
begin
  if normalized !~ '^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$' then return null; end if;
  return normalized::numeric;
exception when others then return null;
end
$function$;
revoke all on function private.reclass_numeric_v1(text) from public, anon, authenticated, service_role;

-- Reclass validates canonical lineage for each source and destination. Keep
-- those checks index-backed without indexing unrelated wide snapshot columns.
create index if not exists ph_master_inventory_reclass_lineage_v1_idx
  on public.ph_master_inventory (
    (coalesce(warehouseid,warehousei,'')),(coalesce(itemcode,'')),(coalesce(contsize,'')),
    (coalesce(locationcode,'')),(coalesce(lotcode,'')),(coalesce(source,'')),
    (coalesce(desigitem,'')),(coalesce(desigcust,'')),(coalesce(desigloc,''))
  );

create or replace function public.apply_inventory_reclass_move_v1(
  p_actor_id uuid,
  p_command_id text,
  p_expected_revision bigint,
  p_source_uid text,
  p_source_identity jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
set statement_timeout = '5s'
set lock_timeout = '2s'
as $function$
declare
  actor_profile public.profiles%rowtype;
  source_row public.ph_master_inventory%rowtype;
  source_json jsonb;
  source_after_json jsonb;
  destination_row public.ph_master_inventory%rowtype;
  destination_json jsonb;
  destination_after_json jsonb;
  command_row private.ph_inventory_reclass_commands_v1%rowtype;
  source_on_hand numeric;
  source_available numeric;
  total_quantity numeric := 0;
  destination_quantity numeric;
  destination_on_hand numeric;
  destination_available numeric;
  current_revision bigint;
  line jsonb;
  line_index integer := 0;
  line_quantity numeric;
  destination_season text;
  quantity_field text;
  source_season text;
  source_suffix text;
  source_stem text;
  destination_lot text;
  destination_count integer;
  v_destination_uid text;
  v_destination_lineage text;
  source_lineage text;
  actor_username text;
  is_manager boolean;
  assigned_to_actor boolean;
  target_row jsonb;
  target_payload jsonb;
  safe_fields text[] := array[
    'itemcode','commonname','contsize','locationcode','source','warehousei','warehouseid','season',
    'qualitycode','field_tag_color','fieldtagcolor','s_lts','plantgroupcode','listprice','itemspec',
    'desigitem','desigcust','desigloc','priority','saleyear','blockalpha','blocknumber','bay',
    'grower','si_lts','a_lts','ai_lts','varietycode','genusname','botanicalname','reversecommon',
    'sortnamevariety','containersort','nationalaccount','salesrepid','salesrepname','printedcontainercode'
  ];
  zero_quantity_fields text[] := array[
    'ptronhand','ptravailable','ptrreviewed','season_supply','season_oh','season_demand','season_available',
    'ext_ptronhand','end_cap_qty','loc_match_qty','initial_ptr','largeptrqty','maxorderquantity'
  ];
  request_value jsonb;
  movements_value jsonb := '[]'::jsonb;
  rows_value jsonb := '[]'::jsonb;
  audit_id text;
  actor_role text;
  permission_scope text;
  destination_aggregates record;
  before_source_on_hand numeric;
  before_source_available numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'INVENTORY_RECLASS_FORBIDDEN';
  end if;
  if p_actor_id is null or p_expected_revision is null or p_expected_revision < 1
     or p_command_id is null or p_command_id !~ '^[A-Za-z0-9:_.-]{12,180}$'
     or p_source_uid is null or length(p_source_uid) > 1000
     or jsonb_typeof(p_source_identity) is distinct from 'object'
     or jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_PAYLOAD_INVALID';
  end if;
  select * into actor_profile from public.profiles p
  where p.id = p_actor_id and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now()) and not p.must_change_password;
  if actor_profile.id is null then
    raise exception using errcode = '42501', message = 'INVENTORY_RECLASS_PROFILE_INACTIVE';
  end if;
  actor_role := private.normalized_profile_role(actor_profile.role);
  actor_username := lower(btrim(coalesce(actor_profile.username,'')));
  is_manager := actor_role in ('ADMIN','ADMINISTRATOR','MANAGER');
  if actor_role not in ('ADMIN','ADMINISTRATOR','MANAGER','EVAL','EVALUATOR') and actor_role not like '%EVAL%' then
    raise exception using errcode = '42501', message = 'INVENTORY_RECLASS_FORBIDDEN';
  end if;
  select e.access_scope into permission_scope
  from private.get_effective_app_permissions_v1(actor_profile.id,private.resolve_app_access_policy_id_v1(false)) e
  where e.permission_key = 'drive.reclass.submit' and e.allowed limit 1;
  if permission_scope is null then
    raise exception using errcode = '42501', message = 'INVENTORY_RECLASS_PERMISSION_REQUIRED';
  end if;

  request_value := jsonb_build_object('expectedRevision',p_expected_revision,'sourceUid',p_source_uid,
    'sourceIdentity',p_source_identity,'lines',p_lines);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text || ':' || p_command_id,0));
  select * into command_row from private.ph_inventory_reclass_commands_v1 c
  where c.actor_id = p_actor_id and c.command_id = p_command_id for update;
  if found then
    if command_row.request is distinct from request_value then
      raise exception using errcode = '40001', message = 'INVENTORY_RECLASS_COMMAND_CONFLICT';
    end if;
    return command_row.result;
  end if;

  current_revision := private.lock_ph_master_inventory_for_live_edit_v6();
  if current_revision is distinct from p_expected_revision then
    raise exception using errcode = '40001', message = 'INVENTORY_RECLASS_REVISION_CONFLICT';
  end if;
  select * into source_row from public.ph_master_inventory m
  where m.unique_id = p_source_uid for update;
  if source_row.unique_id is null then
    raise exception using errcode = '40001', message = 'INVENTORY_RECLASS_SOURCE_MISSING';
  end if;
  if not is_manager then
    select exists(select 1 from public.ph_warehouse_assigned_items a
      where a.present_in_drive
        and upper(btrim(coalesce(a.itemcode_normalized,a.itemcode,'')))=upper(btrim(coalesce(source_row.itemcode,'')))
        and lower(regexp_replace(btrim(coalesce(a.genusname_normalized,a.genusname,'')),'[[:space:]]+',' ','g'))
          =lower(regexp_replace(btrim(coalesce(source_row.genusname,'')),'[[:space:]]+',' ','g'))
        and lower(regexp_replace(btrim(coalesce(a.assignedto,'')),'[^a-z0-9]+','_','g'))=actor_username)
      into assigned_to_actor;
    if not assigned_to_actor then raise exception using errcode='42501',message='DRIVE_RECLASS_ROW_NOT_ASSIGNED'; end if;
  end if;
  source_json := to_jsonb(source_row);
  source_lineage := private.ph_master_inventory_lineage_key_v1(source_json);
  if p_source_identity - array['unique_id','itemcode','contsize','locationcode','lotcode','season','ptronhand','ptravailable']
       <> '{}'::jsonb
     or p_source_identity->>'unique_id' is distinct from source_row.unique_id
     or p_source_identity->>'itemcode' is distinct from source_row.itemcode
     or p_source_identity->>'contsize' is distinct from source_row.contsize
     or p_source_identity->>'locationcode' is distinct from source_row.locationcode
     or p_source_identity->>'lotcode' is distinct from source_row.lotcode
     or p_source_identity->>'season' is distinct from source_row.season
     or p_source_identity->>'ptronhand' is distinct from source_row.ptronhand
     or p_source_identity->>'ptravailable' is distinct from source_row.ptravailable then
    raise exception using errcode = '40001', message = 'INVENTORY_RECLASS_SOURCE_CHANGED';
  end if;
  if (select count(*) from public.ph_master_inventory m
      where coalesce(m.warehouseid,m.warehousei,'') = coalesce(source_row.warehouseid,source_row.warehousei,'')
        and coalesce(m.itemcode,'') = coalesce(source_row.itemcode,'')
        and coalesce(m.contsize,'') = coalesce(source_row.contsize,'')
        and coalesce(m.locationcode,'') = coalesce(source_row.locationcode,'')
        and coalesce(m.lotcode,'') = coalesce(source_row.lotcode,'')
        and coalesce(m.source,'') = coalesce(source_row.source,'')
        and coalesce(m.desigitem,'') = coalesce(source_row.desigitem,'')
        and coalesce(m.desigcust,'') = coalesce(source_row.desigcust,'')
        and coalesce(m.desigloc,'') = coalesce(source_row.desigloc,'')) <> 1 then
    raise exception using errcode = '40001', message = 'INVENTORY_RECLASS_SOURCE_AMBIGUOUS';
  end if;
  source_on_hand := private.reclass_numeric_v1(source_row.ptronhand);
  source_available := private.reclass_numeric_v1(source_row.ptravailable);
  if source_on_hand is null or source_available is null then
    raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_QUANTITY_UNKNOWN';
  end if;
  before_source_on_hand := source_on_hand;
  before_source_available := source_available;
  source_season := upper(btrim(coalesce(nullif(source_row.season,''),nullif(regexp_replace(coalesce(source_row.lotcode,''),'^.*[.]',''),''),'')));
  if source_row.lotcode !~ '^.+[.](F1|S1|U1|U2|U3|X|Y|Z)$' then
    raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_LOT_INVALID';
  end if;
  source_suffix := upper(substring(source_row.lotcode from '[.]([^.]+)$'));
  if source_suffix is distinct from source_season then
    raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_LOT_SEASON_AMBIGUOUS';
  end if;
  source_stem := regexp_replace(source_row.lotcode,'[.][^.]+$','');

  for line in select value from jsonb_array_elements(p_lines) loop
    line_index := line_index + 1;
    if jsonb_typeof(line) is distinct from 'object'
       or line - array['direction','destinationSeason','quantity'] <> '{}'::jsonb
       or not (line ?& array['direction','destinationSeason','quantity'])
       or jsonb_typeof(line->'direction') <> 'string'
       or jsonb_typeof(line->'destinationSeason') <> 'string'
       or jsonb_typeof(line->'quantity') <> 'number'
       or line->>'direction' not in ('move_up','move_down') then
      raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_LINE_INVALID';
    end if;
    destination_season := upper(btrim(line->>'destinationSeason'));
    if destination_season not in ('F1','S1','U1','U2','U3','X','Y','Z') or destination_season = source_season then
      raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_DESTINATION_INVALID';
    end if;
    line_quantity := (line->>'quantity')::numeric;
    if line_quantity < 1 or line_quantity <> trunc(line_quantity) or line_quantity > 2147483647 then
      raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_QUANTITY_INVALID';
    end if;
    total_quantity := total_quantity + line_quantity;
  end loop;
  if total_quantity > source_on_hand or total_quantity > source_available then
    raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_QUANTITY_UNDERFLOW';
  end if;
  source_after_json := source_json || jsonb_build_object(
    'ptronhand',(source_on_hand-total_quantity)::text,
    'ptravailable',(source_available-total_quantity)::text,
    'last_updated',clock_timestamp()
  );

  create temporary table if not exists reclass_move_targets_v1 (
    destination_season text primary key,
    destination_lot text not null,
    quantity numeric not null,
    destination_uid text,
    destination_lineage text,
    destination_before jsonb,
    destination_after jsonb
  ) on commit drop;
  truncate table pg_temp.reclass_move_targets_v1;
  insert into pg_temp.reclass_move_targets_v1(destination_season,destination_lot,quantity)
  select upper(btrim(value->>'destinationSeason')), source_stem || '.' || upper(btrim(value->>'destinationSeason')),
    sum((value->>'quantity')::numeric)
  from jsonb_array_elements(p_lines)
  group by upper(btrim(value->>'destinationSeason'));

  for destination_aggregates in select target.* from pg_temp.reclass_move_targets_v1 target order by target.destination_lot loop
    select count(*), min(m.unique_id) into destination_count,v_destination_uid
    from public.ph_master_inventory m
    where coalesce(m.warehouseid,m.warehousei,'') = coalesce(source_row.warehouseid,source_row.warehousei,'')
      and coalesce(m.itemcode,'') = coalesce(source_row.itemcode,'')
      and coalesce(m.contsize,'') = coalesce(source_row.contsize,'')
      and coalesce(m.locationcode,'') = coalesce(source_row.locationcode,'')
      and coalesce(m.lotcode,'') = destination_aggregates.destination_lot
      and coalesce(m.source,'') = coalesce(source_row.source,'')
      and coalesce(m.desigitem,'') = coalesce(source_row.desigitem,'')
      and coalesce(m.desigcust,'') = coalesce(source_row.desigcust,'')
      and coalesce(m.desigloc,'') = coalesce(source_row.desigloc,'');
    if destination_count > 1 then
      raise exception using errcode = '40001', message = 'INVENTORY_RECLASS_DESTINATION_AMBIGUOUS';
    end if;
    if destination_count = 1 then
      select * into destination_row from public.ph_master_inventory m
      where m.unique_id = v_destination_uid for update;
      if upper(btrim(coalesce(destination_row.season,''))) is distinct from destination_aggregates.destination_season then
        raise exception using errcode = '40001', message = 'INVENTORY_RECLASS_DESTINATION_SEASON_MISMATCH';
      end if;
      destination_json := to_jsonb(destination_row);
      destination_on_hand := private.reclass_numeric_v1(destination_row.ptronhand);
      destination_available := private.reclass_numeric_v1(destination_row.ptravailable);
      if destination_on_hand is null or destination_available is null then
        raise exception using errcode = '22023', message = 'INVENTORY_RECLASS_DESTINATION_QUANTITY_UNKNOWN';
      end if;
      destination_after_json := destination_json || jsonb_build_object(
        'ptronhand',(destination_on_hand+destination_aggregates.quantity)::text,
        'ptravailable',(destination_available+destination_aggregates.quantity)::text,
        'last_updated',clock_timestamp()
      );
    else
      v_destination_uid := gen_random_uuid()::text;
      select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) into target_payload
      from jsonb_each(source_json) e
      where e.key = any(safe_fields);
      target_payload := target_payload || jsonb_build_object(
        'unique_id',v_destination_uid,'lotcode',destination_aggregates.destination_lot,
        'season',destination_aggregates.destination_season,'last_updated',clock_timestamp()
      );
      foreach quantity_field in array zero_quantity_fields loop target_payload := jsonb_set(target_payload,array[quantity_field],to_jsonb('0'::text),true); end loop;
      target_payload := target_payload || jsonb_build_object(
        'ptronhand',destination_aggregates.quantity::text,
        'ptravailable',destination_aggregates.quantity::text
      );
      target_payload := target_payload || jsonb_build_object(
        'concat','reclass-move:' || encode(extensions.digest(convert_to(p_command_id || ':' || v_destination_uid,'UTF8'),'sha256'),'hex')
      );
      destination_json := null;
      destination_after_json := target_payload;
    end if;
    v_destination_lineage := private.ph_master_inventory_lineage_key_v1(destination_after_json);
    update pg_temp.reclass_move_targets_v1 as target set destination_uid=v_destination_uid,
      destination_lineage=v_destination_lineage,destination_before=destination_json,destination_after=destination_after_json
    where target.destination_season=destination_aggregates.destination_season;
    total_quantity := 0; -- reset below to the validated full request quantity after per-target records are prepared.
  end loop;
  select coalesce(sum((value->>'quantity')::numeric),0) into total_quantity from jsonb_array_elements(p_lines);
  source_after_json := source_json || jsonb_build_object(
    'ptronhand',(before_source_on_hand-total_quantity)::text,
    'ptravailable',(before_source_available-total_quantity)::text,
    'last_updated',clock_timestamp()
  );
  update public.ph_master_inventory m set
    ptronhand=(before_source_on_hand-total_quantity)::text,
    ptravailable=(before_source_available-total_quantity)::text,
    last_updated=clock_timestamp()
  where m.unique_id=p_source_uid returning to_jsonb(m.*) into source_after_json;

  insert into private.ph_inventory_reclass_commands_v1(actor_id,command_id,request,result)
  values(p_actor_id,p_command_id,request_value,'{}'::jsonb) returning * into command_row;
  for destination_aggregates in select target.* from pg_temp.reclass_move_targets_v1 target order by target.destination_lot loop
    if destination_aggregates.destination_before is null then
      insert into public.ph_master_inventory
      select (jsonb_populate_record(null::public.ph_master_inventory,destination_aggregates.destination_after)).*;
      select to_jsonb(m.*) into destination_after_json from public.ph_master_inventory m
      where m.unique_id=destination_aggregates.destination_uid;
    else
      update public.ph_master_inventory m set
        ptronhand=destination_aggregates.destination_after->>'ptronhand',
        ptravailable=destination_aggregates.destination_after->>'ptravailable',
        last_updated=clock_timestamp()
      where m.unique_id=destination_aggregates.destination_uid returning to_jsonb(m.*) into destination_after_json;
    end if;
    insert into private.ph_inventory_reclass_import_aliases_v1(lineage_key,canonical_unique_id,request_id)
    values(destination_aggregates.destination_lineage,destination_aggregates.destination_uid,command_row.request_id)
    on conflict(lineage_key) do update set canonical_unique_id=excluded.canonical_unique_id,request_id=excluded.request_id
    where private.ph_inventory_reclass_import_aliases_v1.canonical_unique_id=excluded.canonical_unique_id;
    if not found then raise exception using errcode='40001',message='INVENTORY_RECLASS_DESTINATION_AMBIGUOUS'; end if;
    insert into private.ph_inventory_reclass_movements_v1(
      request_id,line_index,direction,destination_season,quantity,source_unique_id,destination_unique_id,
      source_lineage_key,destination_lineage_key,source_identity,destination_identity,
      source_before,source_after,destination_before,destination_after
    )
    select command_row.request_id,ordinality::integer,value->>'direction',destination_aggregates.destination_season,
      (value->>'quantity')::numeric,p_source_uid,destination_aggregates.destination_uid,source_lineage,destination_aggregates.destination_lineage,
      jsonb_build_object('unique_id',p_source_uid,'itemcode',source_row.itemcode,'contsize',source_row.contsize,
        'locationcode',source_row.locationcode,'lotcode',source_row.lotcode,'season',source_row.season,
        'source',source_row.source,'warehouseid',coalesce(source_row.warehouseid,source_row.warehousei),
        'desigitem',source_row.desigitem,'desigcust',source_row.desigcust,'desigloc',source_row.desigloc),
      jsonb_build_object('unique_id',destination_aggregates.destination_uid,'itemcode',source_row.itemcode,
        'contsize',source_row.contsize,'locationcode',source_row.locationcode,'lotcode',destination_aggregates.destination_lot,
        'season',destination_aggregates.destination_season,'source',source_row.source,
        'warehouseid',coalesce(source_row.warehouseid,source_row.warehousei),'desigitem',source_row.desigitem,
        'desigcust',source_row.desigcust,'desigloc',source_row.desigloc),
      source_json,source_after_json,destination_aggregates.destination_before,destination_after_json
    from jsonb_array_elements(p_lines) with ordinality as line_rows(value,ordinality)
    where upper(btrim(value->>'destinationSeason'))=destination_aggregates.destination_season;

    select to_jsonb(m.*) into destination_after_json from public.ph_master_inventory m
    where m.unique_id=destination_aggregates.destination_uid;
    rows_value := rows_value || jsonb_build_array(jsonb_build_object('table','ph_master_inventory','row',destination_after_json));
    movements_value := movements_value || (
      select coalesce(jsonb_agg(jsonb_build_object('line',ordinality,'direction',value->>'direction',
        'destinationSeason',upper(btrim(value->>'destinationSeason')),'quantity',(value->>'quantity')::numeric,
        'sourceUniqueId',p_source_uid,'destinationUniqueId',destination_aggregates.destination_uid)
        order by ordinality),'[]'::jsonb)
      from jsonb_array_elements(p_lines) with ordinality as line_rows(value,ordinality)
      where upper(btrim(value->>'destinationSeason'))=destination_aggregates.destination_season
    );
    for line in select value from jsonb_array_elements(p_lines) where upper(btrim(value->>'destinationSeason'))=destination_aggregates.destination_season loop
      audit_id := gen_random_uuid()::text;
      insert into public.ph_inventory_transactions(
        unique_id,action,actor_id,actor_username,actor_display,source_table,source_unique_id,destination_table,destination_unique_id,
        source_itemcode,source_lotcode,source_locationcode,destination_itemcode,destination_lotcode,destination_locationcode,
        quantity,source_before,source_after,destination_before,destination_after,status,event_type,raw_payload,search_text
      ) values(audit_id,line->>'direction',p_actor_id,actor_profile.username,coalesce(actor_profile.display_name,actor_profile.username),
        'ph_master_inventory',p_source_uid,'ph_master_inventory',destination_aggregates.destination_uid,
        source_row.itemcode,source_row.lotcode,source_row.locationcode,source_row.itemcode,destination_aggregates.destination_lot,
        source_row.locationcode,(line->>'quantity')::numeric,source_json,source_after_json,destination_aggregates.destination_before,
        destination_after_json,'applied','inventory_reclass_move',jsonb_build_object('commandId',p_command_id,'requestId',command_row.request_id),
        lower(concat_ws(' ',actor_profile.username,source_row.itemcode,source_row.lotcode,source_row.locationcode,
          destination_aggregates.destination_lot,destination_aggregates.destination_season)));
    end loop;
  end loop;
  select r.revision into current_revision from public.app_dataset_revisions r where r.key='ph_master_inventory';
  rows_value := jsonb_build_array(jsonb_build_object('table','ph_master_inventory','row',source_after_json)) || rows_value;
  request_value := jsonb_build_object('ok',true,'commandId',p_command_id,'requestId',command_row.request_id,'revision',current_revision,
    'rows',rows_value,'movements',movements_value,'status','applied','importStatus','pending');
  update private.ph_inventory_reclass_commands_v1 set result=request_value where request_id=command_row.request_id;
  return request_value;
end
$function$;
revoke all on function public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_inventory_reclass_move_v1(uuid,text,bigint,text,jsonb,jsonb) to service_role;

create or replace function public.apply_inventory_reclass_moves_v1(
  p_actor_id uuid,p_command_id text,p_expected_revision bigint,p_moves jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '2s'
as $function$
declare
  actor_profile public.profiles%rowtype;
  batch_row private.ph_inventory_reclass_batch_receipts_v1%rowtype;
  actor_role text;
  permission_scope text;
  request_value jsonb;
  move jsonb;
  source_value jsonb;
  source_uid text;
  source_row public.ph_master_inventory%rowtype;
  source_json jsonb;
  target_lot text;
  target_season text;
  source_season text;
  line_value jsonb;
  line_count integer:=0;
  source_count integer:=0;
  current_revision bigint;
  move_index integer:=0;
  child_command text;
  child_result jsonb;
  child_ids uuid[]:='{}'::uuid[];
  rows_value jsonb:='[]'::jsonb;
  movements_value jsonb:='[]'::jsonb;
  result_value jsonb;
  destination_seasons text[];
  claimed_lineage text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception using errcode='42501',message='INVENTORY_RECLASS_FORBIDDEN'; end if;
  if p_actor_id is null or p_expected_revision is null or p_expected_revision < 1
    or p_command_id is null or p_command_id !~ '^[A-Za-z0-9:_.-]{12,180}$'
    or jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves)<1 or jsonb_array_length(p_moves)>100 then
    raise exception using errcode='22023',message='INVENTORY_RECLASS_PAYLOAD_INVALID';
  end if;
  select * into actor_profile from public.profiles p where p.id=p_actor_id and p.disabled_at is null
    and (p.locked_until is null or p.locked_until<=now()) and not p.must_change_password;
  if actor_profile.id is null then raise exception using errcode='42501',message='INVENTORY_RECLASS_PROFILE_INACTIVE'; end if;
  actor_role:=private.normalized_profile_role(actor_profile.role);
  if actor_role not in ('ADMIN','ADMINISTRATOR','MANAGER','EVAL','EVALUATOR') and actor_role not like '%EVAL%' then
    raise exception using errcode='42501',message='INVENTORY_RECLASS_FORBIDDEN';
  end if;
  select e.access_scope into permission_scope from private.get_effective_app_permissions_v1(actor_profile.id,private.resolve_app_access_policy_id_v1(false)) e
    where e.permission_key='drive.reclass.submit' and e.allowed limit 1;
  if permission_scope is null then raise exception using errcode='42501',message='INVENTORY_RECLASS_PERMISSION_REQUIRED'; end if;
  request_value:=jsonb_build_object('expectedRevision',p_expected_revision,'moves',p_moves);
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_command_id,0));
  select * into batch_row from private.ph_inventory_reclass_batch_receipts_v1 b
    where b.actor_id=p_actor_id and b.command_id=p_command_id for update;
  if found then
    if batch_row.request is distinct from request_value then raise exception using errcode='40001',message='INVENTORY_RECLASS_COMMAND_CONFLICT'; end if;
    return batch_row.result;
  end if;
  current_revision:=private.lock_ph_master_inventory_for_live_edit_v6();
  if current_revision is distinct from p_expected_revision then raise exception using errcode='40001',message='INVENTORY_RECLASS_REVISION_CONFLICT'; end if;

  create temporary table if not exists reclass_move_claims_v1(lineage_key text primary key,source_uid text,claim_type text) on commit drop;
  truncate table pg_temp.reclass_move_claims_v1;
  if exists(select 1 from jsonb_array_elements(p_moves) e(value)
    where jsonb_typeof(value) is distinct from 'object' or value - array['source','lines'] <> '{}'::jsonb
      or not (value ?& array['source','lines']) or jsonb_typeof(value->'source') is distinct from 'object'
      or jsonb_typeof(value->'lines') is distinct from 'array' or jsonb_array_length(value->'lines')<1) then
    raise exception using errcode='22023',message='INVENTORY_RECLASS_MOVE_INVALID';
  end if;
  if exists(select 1 from jsonb_array_elements(p_moves) e(value) group by value #>> '{source,uniqueId}' having count(*)>1) then
    raise exception using errcode='22023',message='INVENTORY_RECLASS_OVERLAP_INVALID';
  end if;
  select sum(jsonb_array_length(value->'lines'))::integer into line_count from jsonb_array_elements(p_moves) e(value);
  if line_count>100 then raise exception using errcode='22023',message='INVENTORY_RECLASS_LINES_INVALID'; end if;
  for move in select value from jsonb_array_elements(p_moves) loop
    move_index:=move_index+1; source_count:=source_count+1;
    source_value:=move->'source'; source_uid:=btrim(coalesce(source_value->>'uniqueId',''));
    if source_uid='' or length(source_uid)>1000 or jsonb_typeof(source_value->'identity') is distinct from 'object' then
      raise exception using errcode='22023',message='INVENTORY_RECLASS_SOURCE_INVALID';
    end if;
    select * into source_row from public.ph_master_inventory m where m.unique_id=source_uid;
    if source_row.unique_id is null then raise exception using errcode='40001',message='INVENTORY_RECLASS_SOURCE_MISSING'; end if;
    source_json:=to_jsonb(source_row);
    claimed_lineage:=private.ph_master_inventory_lineage_key_v1(source_json);
    insert into pg_temp.reclass_move_claims_v1(lineage_key,source_uid,claim_type) values(claimed_lineage,source_uid,'source')
      on conflict do nothing;
    if not found then raise exception using errcode='22023',message='INVENTORY_RECLASS_OVERLAP_INVALID'; end if;
    source_season:=upper(btrim(coalesce(nullif(source_row.season,''),nullif(regexp_replace(coalesce(source_row.lotcode,''),'^.*[.]',''),''),'')));
    if source_row.lotcode !~ '^.+[.](F1|S1|U1|U2|U3|X|Y|Z)$'
      or upper(substring(source_row.lotcode from '[.]([^.]+)$')) is distinct from source_season then
      raise exception using errcode='22023',message='INVENTORY_RECLASS_LOT_INVALID';
    end if;
    destination_seasons:=array(select distinct upper(btrim(value->>'destinationSeason')) from jsonb_array_elements(move->'lines') e(value));
    foreach target_season in array destination_seasons loop
      if target_season not in ('F1','S1','U1','U2','U3','X','Y','Z') or target_season=source_season then
        raise exception using errcode='22023',message='INVENTORY_RECLASS_DESTINATION_INVALID';
      end if;
      target_lot:=regexp_replace(source_row.lotcode,'[.][^.]+$','')||'.'||target_season;
      claimed_lineage:=private.ph_master_inventory_lineage_key_v1(source_json||jsonb_build_object('lotcode',target_lot,'season',target_season));
      insert into pg_temp.reclass_move_claims_v1(lineage_key,source_uid,claim_type) values(claimed_lineage,source_uid,'target')
        on conflict do nothing;
      if not found then raise exception using errcode='22023',message='INVENTORY_RECLASS_OVERLAP_INVALID'; end if;
    end loop;
    for line_value in select value from jsonb_array_elements(move->'lines') loop
      if jsonb_typeof(line_value) is distinct from 'object' or line_value - array['direction','destinationSeason','quantity'] <> '{}'::jsonb
        or jsonb_typeof(line_value->'quantity') is distinct from 'number'
        or line_value->>'direction' not in ('move_up','move_down') then
        raise exception using errcode='22023',message='INVENTORY_RECLASS_LINE_INVALID';
      end if;
    end loop;
  end loop;
  insert into private.ph_inventory_reclass_batch_receipts_v1(actor_id,command_id,request)
    values(p_actor_id,p_command_id,request_value) returning * into batch_row;
  move_index:=0;
  for move in select value from jsonb_array_elements(p_moves) loop
    move_index:=move_index+1;
    source_value:=move->'source'; source_uid:=source_value->>'uniqueId';
    child_command:='reclass-batch:'||left(encode(extensions.digest(convert_to(p_command_id||':'||move_index::text,'UTF8'),'sha256'),'hex'),40);
    select revision into current_revision from public.app_dataset_revisions where key='ph_master_inventory';
    child_result:=public.apply_inventory_reclass_move_v1(p_actor_id,child_command,current_revision,source_uid,source_value->'identity',move->'lines');
    child_ids:=array_append(child_ids,(child_result->>'requestId')::uuid);
    rows_value:=rows_value||coalesce(child_result->'rows','[]'::jsonb);
    movements_value:=movements_value||coalesce((select jsonb_agg(value||jsonb_build_object('sourceIndex',move_index)) from jsonb_array_elements(child_result->'movements') e(value)),'[]'::jsonb);
  end loop;
  select revision into current_revision from public.app_dataset_revisions where key='ph_master_inventory';
  result_value:=jsonb_build_object('ok',true,'commandId',p_command_id,'requestId',batch_row.request_id,'revision',current_revision,
    'rows',rows_value,'movements',movements_value,'status','applied','importStatus','pending');
  update private.ph_inventory_reclass_batch_receipts_v1 set child_request_ids=child_ids,result=result_value where request_id=batch_row.request_id;
  return result_value;
end
$function$;
revoke all on function public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.apply_inventory_reclass_moves_v1(uuid,text,bigint,jsonb) to service_role;

create or replace function public.get_inventory_reclass_move_status_v1(p_actor_id uuid,p_command_id text)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare actor_profile public.profiles%rowtype; batch_row private.ph_inventory_reclass_batch_receipts_v1%rowtype; actor_role text; permission_scope text; status_value text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception using errcode='42501',message='INVENTORY_RECLASS_FORBIDDEN'; end if;
  select * into actor_profile from public.profiles p where p.id=p_actor_id and p.disabled_at is null
    and (p.locked_until is null or p.locked_until<=now()) and not p.must_change_password;
  if actor_profile.id is null then raise exception using errcode='42501',message='INVENTORY_RECLASS_PROFILE_INACTIVE'; end if;
  actor_role:=private.normalized_profile_role(actor_profile.role);
  if actor_role not in ('ADMIN','ADMINISTRATOR','MANAGER','EVAL','EVALUATOR') and actor_role not like '%EVAL%' then raise exception using errcode='42501',message='INVENTORY_RECLASS_FORBIDDEN'; end if;
  select e.access_scope into permission_scope from private.get_effective_app_permissions_v1(actor_profile.id,private.resolve_app_access_policy_id_v1(false)) e
    where e.permission_key='drive.reclass.submit' and e.allowed limit 1;
  if permission_scope is null then raise exception using errcode='42501',message='INVENTORY_RECLASS_PERMISSION_REQUIRED'; end if;
  select * into batch_row from private.ph_inventory_reclass_batch_receipts_v1 b where b.actor_id=p_actor_id and b.command_id=p_command_id;
  if batch_row.request_id is null then return jsonb_build_object('ok',true,'status','missing','requestId',null,'movements','[]'::jsonb); end if;
  select case when bool_or(m.status='conflict') then 'conflict' when bool_or(m.status='pending') then 'pending' else 'acknowledged' end
    into status_value from private.ph_inventory_reclass_movements_v1 m where m.request_id=any(batch_row.child_request_ids);
  return batch_row.result || jsonb_build_object('status','applied','importStatus',coalesce(status_value,'acknowledged'),
    'movements',(select coalesce(jsonb_agg(jsonb_build_object('line',m.line_index,'direction',m.direction,
      'destinationSeason',m.destination_season,'quantity',m.quantity,'sourceUniqueId',m.source_unique_id,
      'destinationUniqueId',m.destination_unique_id,'status',m.status,'conflictReason',m.conflict_reason)
      order by m.request_id,m.line_index),'[]'::jsonb) from private.ph_inventory_reclass_movements_v1 m
      where m.request_id=any(batch_row.child_request_ids)));
end
$function$;
revoke all on function public.get_inventory_reclass_move_status_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.get_inventory_reclass_move_status_v1(uuid,text) to service_role;

create or replace function private.apply_inventory_reclass_import_overlay_v1(p_run_id uuid,p_import_request_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  movement_request record;
  movement record;
  source_stage record;
  target_stage record;
  source_rows integer;
  source_matches boolean;
  all_pre boolean;
  all_post boolean;
  target_count integer;
  target_pre boolean;
  target_post boolean;
  desired_status text;
  conflict_reason_value text;
begin
  for movement_request in
    select c.request_id, c.operation_order, min(m.source_unique_id) source_uid,
      (array_agg(m.source_before order by m.line_index))[1] source_before,
      (array_agg(m.source_after order by m.line_index))[1] source_after
    from private.ph_inventory_reclass_commands_v1 c
    join private.ph_inventory_reclass_movements_v1 m using(request_id)
    where m.status in ('pending','conflict')
    group by c.request_id,c.operation_order
    order by c.operation_order
  loop
    all_pre := true;
    all_post := true;
    conflict_reason_value := null;
    select count(*) into source_rows
    from pg_temp.ph_master_bulk_map_v1 mapped
    where mapped.canonical_unique_id=movement_request.source_uid;
    if source_rows <> 1 then
      all_pre := false; all_post := false; conflict_reason_value := case when source_rows=0 then 'source_absent' else 'source_duplicate' end;
      if source_rows > 1 then
        perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
          movement_request.request_id,movement_request.source_uid,null,'source_duplicate',
          coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where mapped.canonical_unique_id=movement_request.source_uid),'[]'::jsonb));
        delete from pg_temp.ph_master_bulk_map_v1 mapped where mapped.canonical_unique_id=movement_request.source_uid;
      end if;
    else
      select s.* into source_stage
      from pg_temp.ph_master_bulk_stage_v1 s
      join pg_temp.ph_master_bulk_map_v1 mapped using(row_number)
      where mapped.canonical_unique_id=movement_request.source_uid;
      source_matches := source_stage.itemcode is not distinct from movement_request.source_before->>'itemcode'
        and source_stage.contsize is not distinct from movement_request.source_before->>'contsize'
        and source_stage.locationcode is not distinct from movement_request.source_before->>'locationcode'
        and source_stage.lotcode is not distinct from movement_request.source_before->>'lotcode'
        and source_stage.source is not distinct from movement_request.source_before->>'source';
      all_pre := source_matches
        and source_stage.ptronhand is not distinct from movement_request.source_before->>'ptronhand'
        and source_stage.ptravailable is not distinct from movement_request.source_before->>'ptravailable';
      all_post := source_matches
        and (source_stage.ptronhand is not distinct from movement_request.source_after->>'ptronhand'
          and source_stage.ptravailable is not distinct from movement_request.source_after->>'ptravailable'
          or exists(select 1 from private.ph_inventory_reclass_movements_v1 later
            join private.ph_inventory_reclass_commands_v1 later_command using(request_id)
            where (later.source_unique_id=movement_request.source_uid
                and source_stage.ptronhand is not distinct from later.source_after->>'ptronhand'
                and source_stage.ptravailable is not distinct from later.source_after->>'ptravailable'
              or later.destination_unique_id=movement_request.source_uid
                and source_stage.ptronhand is not distinct from later.destination_after->>'ptronhand'
                and source_stage.ptravailable is not distinct from later.destination_after->>'ptravailable')
              and later_command.operation_order>movement_request.operation_order));
      if not source_matches then
        conflict_reason_value := 'source_identity_changed';
        perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
          movement_request.request_id,movement_request.source_uid,null,'source_identity_changed',
          coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where mapped.canonical_unique_id=movement_request.source_uid),'[]'::jsonb));
        delete from pg_temp.ph_master_bulk_map_v1 mapped where mapped.canonical_unique_id=movement_request.source_uid;
      end if;
    end if;

    for movement in select * from private.ph_inventory_reclass_movements_v1 m where m.request_id=movement_request.request_id order by m.destination_unique_id loop
      select count(*) into target_count
      from pg_temp.ph_master_bulk_stage_v1 s
      where s.lineage_key=movement.destination_lineage_key;
      if target_count=1 then
        update pg_temp.ph_master_bulk_map_v1 mapped set canonical_unique_id=alias.canonical_unique_id,candidate_count=1
        from pg_temp.ph_master_bulk_stage_v1 s
        join private.ph_inventory_reclass_import_aliases_v1 alias on alias.lineage_key=s.lineage_key
        where mapped.row_number=s.row_number and s.lineage_key=movement.destination_lineage_key
          and alias.canonical_unique_id=movement.destination_unique_id
          and (mapped.canonical_unique_id is null or mapped.canonical_unique_id=alias.canonical_unique_id);
      elsif target_count>1 then
        all_pre := false; all_post := false; conflict_reason_value := coalesce(conflict_reason_value,'target_duplicate');
        perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
          movement.request_id,null,movement.destination_lineage_key,'target_duplicate',
          coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where s.lineage_key=movement.destination_lineage_key),'[]'::jsonb));
        update private.ph_inventory_reclass_movements_v1 set status='conflict',conflict_reason='target_duplicate',updated_at=clock_timestamp()
        where request_id=movement.request_id and destination_lineage_key=movement.destination_lineage_key;
        delete from pg_temp.ph_master_bulk_map_v1 mapped
        using pg_temp.ph_master_bulk_stage_v1 s
        where mapped.row_number=s.row_number and s.lineage_key=movement.destination_lineage_key;
        continue;
      end if;
      if target_count=0 then
        target_pre := movement.destination_before is null or exists(
          select 1 from private.ph_inventory_reclass_movements_v1 prior
          join private.ph_inventory_reclass_commands_v1 prior_command using(request_id)
          where prior.destination_lineage_key=movement.destination_lineage_key
            and prior.destination_unique_id=movement.destination_unique_id
            and prior.status in ('pending','acknowledged')
            and prior_command.operation_order < movement_request.operation_order
            and prior.destination_after->>'ptronhand'=movement.destination_before->>'ptronhand'
            and prior.destination_after->>'ptravailable'=movement.destination_before->>'ptravailable'
          );
        target_post := false;
      else
        if exists(select 1 from pg_temp.ph_master_bulk_stage_v1 s
          join pg_temp.ph_master_bulk_map_v1 mapped using(row_number)
          where s.lineage_key=movement.destination_lineage_key
            and mapped.canonical_unique_id is distinct from movement.destination_unique_id) then
          all_pre:=false; all_post:=false; conflict_reason_value:=coalesce(conflict_reason_value,'target_alias_conflict');
          target_pre:=false; target_post:=false;
          perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
            movement.request_id,null,movement.destination_lineage_key,'target_alias_conflict',
            coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where s.lineage_key=movement.destination_lineage_key),'[]'::jsonb));
          delete from pg_temp.ph_master_bulk_map_v1 mapped using pg_temp.ph_master_bulk_stage_v1 s
            where mapped.row_number=s.row_number and s.lineage_key=movement.destination_lineage_key;
          continue;
        end if;
        select s.* into target_stage
        from pg_temp.ph_master_bulk_stage_v1 s where s.lineage_key=movement.destination_lineage_key limit 1;
        if target_stage.itemcode is distinct from movement.destination_identity->>'itemcode'
          or target_stage.contsize is distinct from movement.destination_identity->>'contsize'
          or target_stage.locationcode is distinct from movement.destination_identity->>'locationcode'
          or target_stage.source is distinct from movement.destination_identity->>'source'
          or coalesce(target_stage.warehouseid,target_stage.warehousei) is distinct from movement.destination_identity->>'warehouseid'
          or target_stage.season is distinct from movement.destination_identity->>'season'
          or target_stage.desigitem is distinct from movement.destination_identity->>'desigitem'
          or target_stage.desigcust is distinct from movement.destination_identity->>'desigcust'
          or target_stage.desigloc is distinct from movement.destination_identity->>'desigloc' then
          all_pre:=false; all_post:=false; conflict_reason_value:=coalesce(conflict_reason_value,'target_identity_changed');
          perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
            movement.request_id,null,movement.destination_lineage_key,'target_identity_changed',
            coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where s.lineage_key=movement.destination_lineage_key),'[]'::jsonb));
        end if;
        target_pre := movement.destination_before is not null
          and target_stage.ptronhand is not distinct from movement.destination_before->>'ptronhand'
          and target_stage.ptravailable is not distinct from movement.destination_before->>'ptravailable'
          and target_stage.lotcode is not distinct from movement.destination_identity->>'lotcode';
        target_post := target_stage.lotcode is not distinct from movement.destination_identity->>'lotcode'
          and (target_stage.ptronhand is not distinct from movement.destination_after->>'ptronhand'
            and target_stage.ptravailable is not distinct from movement.destination_after->>'ptravailable'
            or exists(select 1 from private.ph_inventory_reclass_movements_v1 later
              join private.ph_inventory_reclass_commands_v1 later_command using(request_id)
              where (later.destination_unique_id=movement.destination_unique_id
                  and target_stage.ptronhand is not distinct from later.destination_after->>'ptronhand'
                  and target_stage.ptravailable is not distinct from later.destination_after->>'ptravailable'
                or later.source_unique_id=movement.destination_unique_id
                  and target_stage.ptronhand is not distinct from later.source_after->>'ptronhand'
                  and target_stage.ptravailable is not distinct from later.source_after->>'ptravailable')
                and later_command.operation_order>movement_request.operation_order));
      end if;
      all_pre := all_pre and target_pre;
      all_post := all_post and target_post;
      if not target_pre and not target_post then
        conflict_reason_value := coalesce(conflict_reason_value,'target_quantity_changed');
        perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
          movement.request_id,null,movement.destination_lineage_key,'target_quantity_changed',
          coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where s.lineage_key=movement.destination_lineage_key),'[]'::jsonb));
      end if;
    end loop;

    desired_status := case when all_post then 'acknowledged' when all_pre then 'pending' else 'conflict' end;
    if desired_status='pending' then
      update pg_temp.ph_master_bulk_stage_v1 s set
        ptronhand=movement_request.source_after->>'ptronhand',ptravailable=movement_request.source_after->>'ptravailable'
      from pg_temp.ph_master_bulk_map_v1 mapped
      where mapped.row_number=s.row_number and mapped.canonical_unique_id=movement_request.source_uid;
      for movement in select * from private.ph_inventory_reclass_movements_v1 m where m.request_id=movement_request.request_id loop
        update pg_temp.ph_master_bulk_stage_v1 s set
          ptronhand=movement.destination_after->>'ptronhand',ptravailable=movement.destination_after->>'ptravailable'
        from pg_temp.ph_master_bulk_map_v1 mapped
        where mapped.row_number=s.row_number and mapped.canonical_unique_id=movement.destination_unique_id;
      end loop;
    elsif desired_status='conflict' then
      perform private.record_inventory_reclass_import_conflict_v1(p_run_id,p_import_request_id,
        movement_request.request_id,movement_request.source_uid,null,coalesce(conflict_reason_value,'incoming_state_ambiguous'),
        coalesce((select jsonb_agg(jsonb_build_object('unique_id',s.unique_id,'canonical_unique_id',mapped.canonical_unique_id,'lineage_key',s.lineage_key,'source_hash',s.source_hash,'raw_values',s.raw_values,'raw_item6_fields',s.raw_item6_fields)) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 mapped using(row_number) where mapped.canonical_unique_id=movement_request.source_uid),'[]'::jsonb));
      update pg_temp.ph_master_bulk_stage_v1 s set ptronhand=live.ptronhand,ptravailable=live.ptravailable
      from pg_temp.ph_master_bulk_map_v1 mapped,public.ph_master_inventory live
      where mapped.row_number=s.row_number and live.unique_id=mapped.canonical_unique_id
        and (mapped.canonical_unique_id=movement_request.source_uid or exists(
          select 1 from private.ph_inventory_reclass_movements_v1 m where m.request_id=movement_request.request_id
            and m.destination_unique_id=mapped.canonical_unique_id));
    end if;
    update private.ph_inventory_reclass_movements_v1 set status=desired_status,
      conflict_reason=case when desired_status='conflict' then coalesce(conflict_reason_value,'incoming_state_ambiguous') else null end,
      updated_at=clock_timestamp()
    where request_id=movement_request.request_id;
  end loop;
end
$function$;
revoke all on function private.apply_inventory_reclass_import_overlay_v1(uuid,uuid) from public,anon,authenticated,service_role;

do $migration$
declare definition text; hook text := '  if exists(select 1 from pg_temp.ph_master_bulk_map_v1 where candidate_count > 1) then';
begin
  select pg_get_functiondef('public.bulk_import_master_snapshot_v1(uuid,uuid,jsonb,text)'::regprocedure) into definition;
  if definition is null or length(definition)-length(replace(definition,hook,'')) <> length(hook) then
    raise exception 'INVENTORY_RECLASS_IMPORT_HOOK_ANCHOR_INVALID';
  end if;
  definition := replace(definition,hook,
    '  create index if not exists reclass_bulk_stage_lineage_idx on pg_temp.ph_master_bulk_stage_v1(lineage_key);' || E'\n' ||
    '  perform private.apply_inventory_reclass_import_overlay_v1(p_run_id,p_request_id);' || E'\n' || hook);
  hook := E'    delete from public.ph_master_inventory live\n    where not exists (';
  if position(hook in definition)=0 then raise exception 'INVENTORY_RECLASS_IMPORT_DELETE_ANCHOR_INVALID'; end if;
  definition := replace(definition,hook,
    '    delete from public.ph_master_inventory live' || E'\n' ||
    '    where not exists (select 1 from private.ph_inventory_reclass_movements_v1 held where held.status in (''pending'',''conflict'') and (held.source_unique_id=live.unique_id or held.destination_unique_id=live.unique_id))' || E'\n' ||
    '      and not exists (');
  execute definition;
end
$migration$;

insert into private.app_access_legacy_checks(check_key,permission_key,enforcement_surface,notes)
values('rpc.inventory.reclass.move.v1','drive.reclass.submit','rpc',
  'Actual split movement uses the same Reclass permission and active profile contract as inquiry submission; source and destination balances publish atomically.')
on conflict(check_key) do update set permission_key=excluded.permission_key,enforcement_surface=excluded.enforcement_surface,notes=excluded.notes;

commit;
