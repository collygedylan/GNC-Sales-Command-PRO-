begin;

-- Freeze canonical master writes while the initial lineage/value baseline and
-- approved-release cutover shields are installed.
lock table public.ph_master_inventory in share row exclusive mode;

-- App-managed priority and hold fields survive legacy imports until the
-- importer has observed the exact app value. The private lineage key excludes
-- priority because Code.gs includes priority in unique_id.
create table if not exists app_sync_private.ph_master_inventory_app_edits (
  canonical_unique_id text primary key,
  lineage_key text not null,
  legacy_priority text,
  legacy_holdstopcode text,
  legacy_holdstopreason text,
  pending_legacy_sync boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  revision bigint not null default 1 check (revision > 0)
);
create index if not exists ph_master_inventory_app_edits_lineage_idx
  on app_sync_private.ph_master_inventory_app_edits (lineage_key);
alter table app_sync_private.ph_master_inventory_app_edits enable row level security;
revoke all on app_sync_private.ph_master_inventory_app_edits from public, anon, authenticated, service_role;

create table if not exists app_sync_private.ph_master_inventory_import_lineage_seen (
  run_id uuid not null,
  canonical_unique_id text not null,
  imported_unique_id text not null,
  lineage_key text not null,
  seen_at timestamptz not null default clock_timestamp(),
  primary key (run_id, canonical_unique_id)
);
alter table app_sync_private.ph_master_inventory_import_lineage_seen enable row level security;
revoke all on app_sync_private.ph_master_inventory_import_lineage_seen from public, anon, authenticated, service_role;
create index if not exists ph_master_inventory_import_lineage_seen_expiry_idx
  on app_sync_private.ph_master_inventory_import_lineage_seen (seen_at);

create table if not exists app_sync_private.ph_master_inventory_source_baselines (
  canonical_unique_id text primary key,
  lineage_key text not null,
  priority text,
  holdstopcode text,
  holdstopreason text,
  imported_at timestamptz not null default clock_timestamp(),
  import_run_id uuid
);
alter table app_sync_private.ph_master_inventory_source_baselines enable row level security;
revoke all on app_sync_private.ph_master_inventory_source_baselines from public, anon, authenticated, service_role;
create index if not exists ph_master_inventory_source_baselines_lineage_idx
  on app_sync_private.ph_master_inventory_source_baselines (lineage_key, canonical_unique_id);

create or replace function private.ph_master_inventory_lineage_key_v1(p_row jsonb)
returns text
language sql immutable security definer set search_path = ''
as $function$
  select encode(extensions.digest(convert_to(jsonb_build_array(
    coalesce(p_row->>'warehouseid', p_row->>'warehousei', ''),
    coalesce(p_row->>'itemcode', ''),
    coalesce(p_row->>'contsize', ''),
    coalesce(p_row->>'locationcode', ''),
    coalesce(p_row->>'lotcode', ''),
    coalesce(p_row->>'source', ''),
    coalesce(p_row->>'desigitem', ''),
    coalesce(p_row->>'desigcust', ''),
    coalesce(p_row->>'desigloc', '')
  )::text, 'UTF8'), 'sha256'), 'hex')
$function$;
revoke all on function private.ph_master_inventory_lineage_key_v1(jsonb) from public, anon, authenticated, service_role;

create or replace function private.ph_master_inventory_import_run_v1()
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  headers jsonb;
  run_text text;
  run_row app_sync_private.import_runs;
begin
  begin
    headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    raise exception using errcode = '55000', message = 'MASTER_PRIORITY_HOLD_IMPORT_HEADERS_INVALID';
  end;
  run_text := nullif(headers->>'x-gnc-import-run-id', '');
  if run_text is null then return null; end if;
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'MASTER_PRIORITY_HOLD_IMPORT_FORBIDDEN';
  end if;
  begin
    select * into run_row from app_sync_private.import_runs r where r.id = run_text::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '55000', message = 'MASTER_PRIORITY_HOLD_IMPORT_TOKEN_INVALID';
  end;
  if run_row.id is null then
    raise exception using errcode = '55000', message = 'MASTER_PRIORITY_HOLD_IMPORT_TOKEN_INVALID';
  end if;
  if run_row.state <> 'active' or run_row.expires_at <= clock_timestamp() then
    raise exception using errcode = '55000', message = 'MASTER_PRIORITY_HOLD_IMPORT_FENCE_LOST';
  end if;
  if not ('ph_master_inventory' = any(run_row.source_keys)) then
    raise exception using errcode = '55000', message = 'MASTER_PRIORITY_HOLD_IMPORT_FENCE_LOST';
  end if;
  if not exists (
       select 1 from app_sync_private.import_leases l
       where l.key = 'ph_master_inventory' and l.run_id = run_row.id
     ) then
    raise exception using errcode = '55000', message = 'MASTER_PRIORITY_HOLD_IMPORT_FENCE_LOST';
  end if;
  return run_row.id;
end
$function$;
revoke all on function private.ph_master_inventory_import_run_v1() from public, anon, authenticated, service_role;

-- Preserve the pre-shield source identity/value baseline for rows already in
-- the canonical table. This is metadata-only and is required to resolve a
-- later legacy UID whose only changed identity component is priority.
insert into app_sync_private.ph_master_inventory_source_baselines(
  canonical_unique_id, lineage_key, priority, holdstopcode, holdstopreason
)
select m.unique_id, private.ph_master_inventory_lineage_key_v1(to_jsonb(m)),
  m.priority, m.holdstopcode, m.holdstopreason
from public.ph_master_inventory m
on conflict (canonical_unique_id) do nothing;

-- Preserve already-approved legacy hold releases until the importer presents
-- the released tuple. Historical Code.gs could suppress the incoming hold;
-- seed only rows with explicit approval evidence and a fully clear live hold.
insert into app_sync_private.ph_master_inventory_app_edits(
  canonical_unique_id,lineage_key,legacy_priority,legacy_holdstopcode,legacy_holdstopreason,pending_legacy_sync
)
select m.unique_id,private.ph_master_inventory_lineage_key_v1(to_jsonb(m)),b.priority,b.holdstopcode,b.holdstopreason,true
from public.ph_master_inventory m
join app_sync_private.ph_master_inventory_source_baselines b on b.canonical_unique_id=m.unique_id
where m.hold_release_approved_at is not null
  and nullif(btrim(coalesce(m.holdstopcode,'')),'') is null
  and nullif(btrim(coalesce(m.holdstopreason,'')),'') is null
  and b.holdstopcode is null
on conflict (canonical_unique_id) do nothing;
update public.ph_master_inventory m set concat='smart-shield-pending:' || encode(extensions.digest(
  convert_to(m.unique_id || ':approved-hold-release-cutover:' || clock_timestamp()::text,'UTF8'),'sha256'),'hex')
where exists(select 1 from app_sync_private.ph_master_inventory_app_edits s
  where s.canonical_unique_id=m.unique_id and s.pending_legacy_sync)
  and m.hold_release_approved_at is not null
  and nullif(btrim(coalesce(m.holdstopcode,'')),'') is null
  and nullif(btrim(coalesce(m.holdstopreason,'')),'') is null;

create or replace function private.apply_ph_master_inventory_live_edits_v6(p_edits jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  edit_row jsonb;
  target jsonb;
  expected jsonb;
  row_value public.ph_master_inventory;
  seen_ids text[] := '{}'::text[];
  result_rows jsonb := '[]'::jsonb;
  current_revision bigint;
  row_uid text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode = '42501', message = 'RECLASS_V6_LIVE_EDIT_FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_edits,'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_edits) > 10000 then
    raise exception using errcode='22023',message='RECLASS_V6_LIVE_EDIT_LIMIT_EXCEEDED';
  end if;
  perform 1 from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory' and r.state = 'ready'
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'RECLASS_V6_INVENTORY_REFRESH_REQUIRED';
  end if;
  for edit_row in
    select value from jsonb_array_elements(p_edits)
    order by value->>'unique_id'
  loop
    if jsonb_typeof(edit_row) <> 'object'
       or (select count(*) from jsonb_object_keys(edit_row)) <> 3
       or not (edit_row ?& array['unique_id','expected','target'])
       or jsonb_typeof(edit_row->'expected') <> 'object'
       or jsonb_typeof(edit_row->'target') <> 'object'
       or exists(select 1 from jsonb_object_keys(edit_row->'expected') k
         where k not in ('priority','holdstopcode','holdstopreason'))
       or exists(select 1 from jsonb_object_keys(edit_row->'target') k
         where k not in ('priority','holdstopcode','holdstopreason'))
       or not ((edit_row->'expected') ?& array['priority','holdstopcode','holdstopreason'])
       or not ((edit_row->'target') ?& array['priority','holdstopcode','holdstopreason']) then
      raise exception using errcode = '22023', message = 'RECLASS_V6_LIVE_EDIT_SHAPE_INVALID';
    end if;
    row_uid := nullif(btrim(coalesce(edit_row->>'unique_id','')),'');
    if row_uid is null or row_uid = any(seen_ids) then
      raise exception using errcode = '22023', message = 'RECLASS_V6_LIVE_EDIT_ID_INVALID';
    end if;
    seen_ids := array_append(seen_ids,row_uid);
    expected := edit_row->'expected';
    target := edit_row->'target';
    if exists(select 1 from jsonb_each(expected) e where e.value <> 'null'::jsonb and jsonb_typeof(e.value) <> 'string')
       or exists(select 1 from jsonb_each(target) e where e.value <> 'null'::jsonb and jsonb_typeof(e.value) <> 'string') then
      raise exception using errcode = '22023', message = 'RECLASS_V6_LIVE_EDIT_VALUE_INVALID';
    end if;
    select m.* into row_value from public.ph_master_inventory m
    where m.unique_id = row_uid for update;
    if row_value.unique_id is null then
      raise exception using errcode = '40001', message = 'RECLASS_V6_LIVE_EDIT_ROW_MISSING';
    end if;
    if coalesce(row_value.priority,'') is distinct from coalesce(expected->>'priority','')
       or coalesce(row_value.holdstopcode,'') is distinct from coalesce(expected->>'holdstopcode','')
       or coalesce(row_value.holdstopreason,'') is distinct from coalesce(expected->>'holdstopreason','') then
      raise exception using errcode = '40001', message = 'RECLASS_V6_LIVE_EDIT_CONFLICT';
    end if;
    if coalesce(row_value.priority,'') is distinct from coalesce(target->>'priority','')
       or coalesce(row_value.holdstopcode,'') is distinct from coalesce(target->>'holdstopcode','')
       or coalesce(row_value.holdstopreason,'') is distinct from coalesce(target->>'holdstopreason','') then
      update public.ph_master_inventory m set
        priority = nullif(target->>'priority',''),
        holdstopcode = nullif(target->>'holdstopcode',''),
        holdstopreason = nullif(target->>'holdstopreason',''),
        last_updated = clock_timestamp()
      where m.unique_id = row_uid
      returning m.* into row_value;
    end if;
    result_rows := result_rows || jsonb_build_array(jsonb_build_object(
      'unique_id',row_value.unique_id,
      'priority',row_value.priority,
      'holdstopcode',row_value.holdstopcode,
      'holdstopreason',row_value.holdstopreason,
      'av_rule_last_clear_reason',row_value.av_rule_last_clear_reason,
      'av_rule_last_cleared_at',row_value.av_rule_last_cleared_at,
      'last_updated',row_value.last_updated,
      'evidence',jsonb_build_object(
        'unique_id',row_value.unique_id,
        'itemcode',row_value.itemcode,
        'locationcode',row_value.locationcode,
        'lotcode',row_value.lotcode,
        'last_updated',row_value.last_updated,
        'photo_link',row_value.photo_link,
        'photo_name',row_value.photo_name,
        'match',row_value.match,
        'spec',row_value.spec,
        'caliper',row_value.caliper,
        'initial_ptr',row_value.initial_ptr,
        'loc_match_qty',row_value.loc_match_qty,
        'ptravailable',row_value.ptravailable,
        'av_note',row_value.av_note,
        'pic_note',row_value.pic_note,
        'sales_note',row_value.sales_note,
        'date_completed',row_value.date_completed,
        'app_tab_assignment',row_value.app_tab_assignment,
        'av_rule_av_note_updated_at',row_value.av_rule_av_note_updated_at,
        'av_rule_bundle_updated_at',row_value.av_rule_bundle_updated_at,
        'av_rule_caliper_updated_at',row_value.av_rule_caliper_updated_at,
        'av_rule_holdstop_snapshot',row_value.av_rule_holdstop_snapshot,
        'av_rule_last_clear_reason',row_value.av_rule_last_clear_reason,
        'av_rule_last_cleared_at',row_value.av_rule_last_cleared_at,
        'av_rule_match_updated_at',row_value.av_rule_match_updated_at,
        'av_rule_photo_updated_at',row_value.av_rule_photo_updated_at,
        'av_rule_priority_snapshot',row_value.av_rule_priority_snapshot,
        'av_rule_spec_updated_at',row_value.av_rule_spec_updated_at
      )
    ));
  end loop;
  select r.revision into current_revision from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory';
  if current_revision is null then
    raise exception using errcode = '55000', message = 'RECLASS_V6_INVENTORY_REVISION_MISSING';
  end if;
  return jsonb_build_object('liveEdits',result_rows,'inventoryRevision',current_revision::text);
end
$function$;
revoke all on function private.apply_ph_master_inventory_live_edits_v6(jsonb) from public, anon, authenticated;
revoke all on function private.apply_ph_master_inventory_live_edits_v6(jsonb) from service_role;

create or replace function private.guard_ph_master_inventory_priority_hold_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  import_run_id uuid;
  lineage text;
  current_lineage text;
  state_row app_sync_private.ph_master_inventory_app_edits;
  live_rows integer;
  pending_marker text;
  canonical_master_run boolean := false;
  alias_import boolean := false;
  seen_row app_sync_private.ph_master_inventory_import_lineage_seen;
  baseline_row app_sync_private.ph_master_inventory_source_baselines;
begin
  import_run_id := private.ph_master_inventory_import_run_v1();
  if import_run_id is not null then
    select 'ph_master_inventory' = any(r.canonical_keys) into canonical_master_run
    from app_sync_private.import_runs r where r.id = import_run_id;
  end if;
  if tg_op = 'DELETE' then
    if canonical_master_run then
      select * into seen_row
      from app_sync_private.ph_master_inventory_import_lineage_seen s
      where s.run_id = import_run_id and s.canonical_unique_id = old.unique_id;
      if seen_row.run_id is not null then
        -- Keep the run-scoped alias marker through retries and later delete
        -- chunks. Prune only expired markers when a new fenced insert arrives.
        return null;
      end if;
    end if;
    delete from app_sync_private.ph_master_inventory_app_edits s
    where s.canonical_unique_id = old.unique_id;
    delete from app_sync_private.ph_master_inventory_source_baselines b
    where b.canonical_unique_id = old.unique_id;
    return old;
  end if;

  lineage := private.ph_master_inventory_lineage_key_v1(to_jsonb(new));
  if tg_op = 'INSERT' then
    if canonical_master_run then
      delete from app_sync_private.ph_master_inventory_import_lineage_seen s
      where s.seen_at < clock_timestamp() - interval '3 days';

      -- Exact IDs are ordinary importer upserts. Only a new ID may resolve to
      -- an existing canonical row by lineage, and that lookup must be unique.
      if not exists(select 1 from public.ph_master_inventory m where m.unique_id = new.unique_id) then
        select count(*) into live_rows
        from app_sync_private.ph_master_inventory_source_baselines b
        join public.ph_master_inventory m on m.unique_id = b.canonical_unique_id
        where b.lineage_key = lineage;
        if live_rows > 1 then
          raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
        elsif live_rows = 1 then
          select b.canonical_unique_id into current_lineage
          from app_sync_private.ph_master_inventory_source_baselines b
          join public.ph_master_inventory m on m.unique_id = b.canonical_unique_id
          where b.lineage_key = lineage
          limit 1 for update of m;
          select * into seen_row
          from app_sync_private.ph_master_inventory_import_lineage_seen s
          where s.run_id = import_run_id and s.canonical_unique_id = current_lineage;
          if seen_row.run_id is not null and seen_row.imported_unique_id <> new.unique_id then
            raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
          end if;
          insert into app_sync_private.ph_master_inventory_import_lineage_seen(
            run_id, canonical_unique_id, imported_unique_id, lineage_key
          ) values (import_run_id, current_lineage, new.unique_id, lineage)
          on conflict (run_id, canonical_unique_id) do update set
            imported_unique_id = case
              when app_sync_private.ph_master_inventory_import_lineage_seen.imported_unique_id = excluded.imported_unique_id
                then excluded.imported_unique_id
              else app_sync_private.ph_master_inventory_import_lineage_seen.imported_unique_id
            end,
            seen_at = clock_timestamp()
          where app_sync_private.ph_master_inventory_import_lineage_seen.imported_unique_id = excluded.imported_unique_id;
          if not found then
            raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
          end if;
          new.unique_id := current_lineage;
        end if;
      else
        -- An exact-UID import is not an alias, but recording it prevents a
        -- later changed UID with the same lineage from being silently merged.
        select * into seen_row
        from app_sync_private.ph_master_inventory_import_lineage_seen s
        where s.run_id = import_run_id and s.canonical_unique_id = new.unique_id;
        if seen_row.run_id is not null and seen_row.imported_unique_id <> new.unique_id then
          raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
        end if;
        insert into app_sync_private.ph_master_inventory_import_lineage_seen(
          run_id, canonical_unique_id, imported_unique_id, lineage_key
        ) values (import_run_id, new.unique_id, new.unique_id, lineage)
        on conflict (run_id, canonical_unique_id) do update set seen_at = clock_timestamp()
        where app_sync_private.ph_master_inventory_import_lineage_seen.imported_unique_id = excluded.imported_unique_id;
        if not found then
          raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
        end if;
      end if;
      insert into app_sync_private.ph_master_inventory_source_baselines(
        canonical_unique_id, lineage_key, priority, holdstopcode, holdstopreason, import_run_id
      ) values (
        new.unique_id, lineage, new.priority, new.holdstopcode, new.holdstopreason, import_run_id
      ) on conflict (canonical_unique_id) do update set
        lineage_key = excluded.lineage_key,
        priority = excluded.priority,
        holdstopcode = excluded.holdstopcode,
        holdstopreason = excluded.holdstopreason,
        imported_at = clock_timestamp(),
        import_run_id = excluded.import_run_id;
    elsif import_run_id is not null then
      -- Fenced auxiliary reconciliation may update master rows as a dependent
      -- source, but it neither acknowledges the DriveAround tuple nor creates
      -- an app-edit shield. Preserve these fields exactly on existing rows.
      return new;
    end if;
    return new;
  end if;

  current_lineage := private.ph_master_inventory_lineage_key_v1(to_jsonb(old));
  if import_run_id is not null then
    if not canonical_master_run then
      new.priority := old.priority;
      new.holdstopcode := old.holdstopcode;
      new.holdstopreason := old.holdstopreason;
      return new;
    end if;
    select coalesce(s.imported_unique_id <> old.unique_id, false) into alias_import
    from app_sync_private.ph_master_inventory_import_lineage_seen s
    where s.run_id = import_run_id and s.canonical_unique_id = old.unique_id;
    insert into app_sync_private.ph_master_inventory_source_baselines(
      canonical_unique_id, lineage_key, priority, holdstopcode, holdstopreason, import_run_id
    ) values (
      old.unique_id, lineage, new.priority, new.holdstopcode, new.holdstopreason, import_run_id
    ) on conflict (canonical_unique_id) do update set
      lineage_key = excluded.lineage_key,
      priority = excluded.priority,
      holdstopcode = excluded.holdstopcode,
      holdstopreason = excluded.holdstopreason,
      imported_at = clock_timestamp(),
      import_run_id = excluded.import_run_id;
    select * into state_row
    from app_sync_private.ph_master_inventory_app_edits s
    where s.canonical_unique_id = old.unique_id
    for update;
    if state_row.canonical_unique_id is not null then
      if state_row.lineage_key <> current_lineage then
        raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_CHANGED';
      end if;
      update app_sync_private.ph_master_inventory_app_edits s set
        legacy_priority = new.priority,
        legacy_holdstopcode = new.holdstopcode,
        legacy_holdstopreason = new.holdstopreason,
        pending_legacy_sync = case when s.pending_legacy_sync
          then not (
            new.priority is not distinct from old.priority
            and new.holdstopcode is not distinct from old.holdstopcode
            and new.holdstopreason is not distinct from old.holdstopreason
          )
          else false end,
        revision = s.revision + 1,
        updated_at = clock_timestamp()
      where s.canonical_unique_id = state_row.canonical_unique_id
      returning * into state_row;
      if state_row.pending_legacy_sync then
        new.priority := old.priority;
        new.holdstopcode := old.holdstopcode;
        new.holdstopreason := old.holdstopreason;
        new.concat := 'smart-shield-pending:' || encode(extensions.digest(convert_to(
          old.unique_id || ':' || current_lineage || ':' || clock_timestamp()::text, 'UTF8'), 'sha256'), 'hex');
        -- Code.gs clears these app-owned evidence fields before writing a
        -- newly introduced blocking hold. If that hold is blocked by the
        -- shield, the clear must be rolled back with the hold transition.
        new.date_completed := old.date_completed;
        new.av_note := old.av_note;
        new.sales_note := old.sales_note;
        new.match := old.match;
        new.spec := old.spec;
        new.caliper := old.caliper;
        new.pic_note := old.pic_note;
        new.loc_match_qty := old.loc_match_qty;
        new.initial_ptr := old.initial_ptr;
        new.photo_link := old.photo_link;
        new.photo_name := old.photo_name;
      end if;
    end if;
    if alias_import then
      -- Code.gs cannot find an old row after priority changes the source UID.
      -- Mirror its app-owned merge against the canonical row, while preserving
      -- its existing new-blocking-hold clear policy.
      if not (
        coalesce(old.holdstopcode, '') !~* '[HS]'
        and coalesce(new.holdstopcode, '') ~* '[HS]'
      ) then
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
        new.date_completed := null;
        new.av_note := null;
        new.sales_note := null;
        new.match := null;
        new.spec := null;
        new.caliper := null;
        new.pic_note := null;
        new.loc_match_qty := null;
        new.initial_ptr := null;
        new.photo_link := null;
        new.photo_name := null;
      end if;
      -- The import builder keeps an existing assignment when the source omits it.
      if nullif(nullif(btrim(new.assignedto::text), ''), 'NULL') is null
         and nullif(nullif(btrim(old.assignedto::text), ''), 'NULL') is not null then
        new.assignedto := old.assignedto;
      end if;
    end if;
    return new;
  end if;

  if new.unique_id is distinct from old.unique_id then
    raise exception using errcode = '42501', message = 'MASTER_PRIORITY_HOLD_IDENTITY_IMMUTABLE';
  end if;
  if new.priority is distinct from old.priority
     or new.holdstopcode is distinct from old.holdstopcode
     or new.holdstopreason is distinct from old.holdstopreason then
    select * into state_row
    from app_sync_private.ph_master_inventory_app_edits s
    where s.canonical_unique_id = old.unique_id
    for update;
    if state_row.canonical_unique_id is null then
      select * into baseline_row
      from app_sync_private.ph_master_inventory_source_baselines b
      where b.canonical_unique_id = old.unique_id;
      insert into app_sync_private.ph_master_inventory_source_baselines(
        canonical_unique_id,lineage_key,priority,holdstopcode,holdstopreason
      ) values (
        old.unique_id,current_lineage,old.priority,old.holdstopcode,old.holdstopreason
      ) on conflict (canonical_unique_id) do nothing;
      insert into app_sync_private.ph_master_inventory_app_edits(
        canonical_unique_id, lineage_key, legacy_priority, legacy_holdstopcode, legacy_holdstopreason,
        pending_legacy_sync
      ) values (
        old.unique_id, current_lineage,
        coalesce(baseline_row.priority, old.priority),
        coalesce(baseline_row.holdstopcode, old.holdstopcode),
        coalesce(baseline_row.holdstopreason, old.holdstopreason), true
      ) returning * into state_row;
    else
      if state_row.lineage_key is distinct from current_lineage then
        raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
      end if;
        update app_sync_private.ph_master_inventory_app_edits s set
        pending_legacy_sync = true,
        revision = s.revision + 1,
        updated_at = clock_timestamp()
      where s.canonical_unique_id = old.unique_id
      returning * into state_row;
    end if;
    pending_marker := 'smart-shield-pending:' || encode(extensions.digest(convert_to(
      new.unique_id || ':' || lineage || ':' || clock_timestamp()::text, 'UTF8'), 'sha256'), 'hex');
    new.concat := pending_marker;
  end if;
  return new;
end
$function$;

revoke all on function private.guard_ph_master_inventory_priority_hold_v1() from public, anon, authenticated, service_role;
drop trigger if exists aaa_ph_master_inventory_priority_hold_shield on public.ph_master_inventory;
create trigger aaa_ph_master_inventory_priority_hold_shield
before insert or update or delete on public.ph_master_inventory
for each row execute function private.guard_ph_master_inventory_priority_hold_v1();

create or replace function private.project_reclass_smart_shield_v6(p_payload jsonb)
returns jsonb
language plpgsql immutable security definer set search_path = ''
as $function$
declare
  v5_input jsonb;
  v5_projected jsonb;
  row_overlay jsonb;
  v5_overlay jsonb;
  expected jsonb;
  rows_out jsonb := '[]'::jsonb;
  idx integer := 0;
  hold_proposals jsonb;
  hold_proposal jsonb;
  needs_live_snapshot boolean;
  row_uid text;
begin
  if jsonb_typeof(coalesce(p_payload,'null'::jsonb)) <> 'object'
     or p_payload->>'workflowPolicyVersion' <> 'reclass-action-workflow-v6-smart-shield-20261009'
     or jsonb_typeof(coalesce(p_payload #> '{transaction,holdStopProposals}','[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_payload->'rowOverlays','null'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_SHAPE_INVALID';
  end if;
  hold_proposals := coalesce(p_payload #> '{transaction,holdStopProposals}','[]'::jsonb);
  if jsonb_array_length(hold_proposals) > 1 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_HOLD_PROPOSAL_INVALID';
  end if;
  for hold_proposal in select value from jsonb_array_elements(hold_proposals) loop
    if jsonb_typeof(hold_proposal) <> 'object'
       or (select count(*) from jsonb_object_keys(hold_proposal)) <> 3
       or not (hold_proposal ?& array['action','reason','sourceUid'])
       or jsonb_typeof(hold_proposal->'action') <> 'string'
       or hold_proposal->>'action' not in ('hold','take_off_hold','stop_ship','off_stop_ship')
       or jsonb_typeof(hold_proposal->'sourceUid') <> 'string'
       or nullif(btrim(coalesce(hold_proposal->>'sourceUid','')),'') is null
       or jsonb_typeof(hold_proposal->'reason') <> 'string'
       or length(coalesce(hold_proposal->>'reason','')) > 1000 then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_HOLD_PROPOSAL_INVALID';
    end if;
    if hold_proposal->>'action' in ('hold','stop_ship') and btrim(hold_proposal->>'reason') = '' then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_HOLD_REASON_REQUIRED';
    end if;
  end loop;

  v5_input := p_payload || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v5-sheared-20261008',
    'transaction',(p_payload->'transaction') || jsonb_build_object('holdStopProposals',coalesce((
      select jsonb_agg(value - 'sourceUid') from jsonb_array_elements(hold_proposals)
    ),'[]'::jsonb)),
    'rowOverlays',(select coalesce(jsonb_agg(
      (value - 'expected') || jsonb_build_object('expected', (value->'expected') - 'priority' - 'holdstopcode' - 'holdstopreason')
      order by ordinality
    ),'[]'::jsonb) from jsonb_array_elements(p_payload->'rowOverlays') with ordinality a(value,ordinality))
  );
  for row_overlay in select value from jsonb_array_elements(p_payload->'rowOverlays') loop
    if jsonb_typeof(row_overlay) <> 'object'
       or jsonb_typeof(coalesce(row_overlay->'expected','null'::jsonb)) <> 'object' then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_ROW_INVALID';
    end if;
    expected := row_overlay->'expected';
    if exists(select 1 from jsonb_object_keys(expected) k
       where k not in ('itemcode','lotcode','locationcode','ptronhand','desigitem','priority','holdstopcode','holdstopreason')) then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_EXPECTED_FIELDS_INVALID';
    end if;
    row_uid := btrim(coalesce(row_overlay->>'unique_id',''));
    needs_live_snapshot := exists(
      select 1 from jsonb_array_elements(coalesce(row_overlay->'proposals','[]'::jsonb)) proposal
      where proposal->>'action' = 'priority_change'
    ) or exists(
      select 1 from jsonb_array_elements(hold_proposals) hp
      where hp->>'sourceUid' = row_uid
    );
    if needs_live_snapshot and exists(select 1 from unnest(array['priority','holdstopcode','holdstopreason']) key
       where not (expected ? key)
          or (expected->key <> 'null'::jsonb and jsonb_typeof(expected->key) <> 'string')) then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_EXPECTED_FIELDS_INVALID';
    end if;
  end loop;
  v5_projected := private.project_reclass_sheared_v5(v5_input);
  for row_overlay in select value from jsonb_array_elements(p_payload->'rowOverlays') loop
    v5_overlay := v5_projected->'rowOverlays'->idx;
    expected := row_overlay->'expected';
    rows_out := rows_out || jsonb_build_array((v5_overlay - 'expected') || jsonb_build_object(
      'expected',(v5_overlay->'expected') || (expected - 'itemcode' - 'lotcode' - 'locationcode' - 'ptronhand' - 'desigitem')
    ));
    idx := idx + 1;
  end loop;
  return p_payload || jsonb_build_object('rowOverlays',rows_out);
end
$function$;
revoke all on function private.project_reclass_smart_shield_v6(jsonb) from public, anon, authenticated;
grant execute on function private.project_reclass_smart_shield_v6(jsonb) to service_role;

create or replace function private.validate_reclass_smart_shield_v6(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  projected jsonb;
  v5_payload jsonb;
  hold_proposals jsonb;
  hold_proposal jsonb;
  row_overlay jsonb;
  proposal jsonb;
  source_uid text;
  action_names text[];
  has_priority boolean := false;
  has_move_up boolean := false;
  has_row_hold boolean := false;
begin
  projected := private.project_reclass_smart_shield_v6(p_payload);
  hold_proposals := coalesce(projected #> '{transaction,holdStopProposals}','[]'::jsonb);
  select array_agg(value order by ordinality) into action_names
  from jsonb_array_elements_text(projected #> '{transaction,requestActions}') with ordinality a(value,ordinality);
  for hold_proposal in select value from jsonb_array_elements(hold_proposals) loop
    source_uid := btrim(coalesce(hold_proposal->>'sourceUid',''));
    if source_uid is null or source_uid = ''
       or not exists(select 1 from jsonb_array_elements(projected->'rowOverlays') r where r->>'unique_id' = source_uid) then
      raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_HOLD_SOURCE_INVALID';
    end if;
  end loop;
  for row_overlay in select value from jsonb_array_elements(projected->'rowOverlays') loop
    for proposal in select value from jsonb_array_elements(coalesce(row_overlay->'proposals','[]'::jsonb)) loop
      if proposal->>'action' = 'priority_change' then
        has_priority := true;
        if jsonb_typeof(proposal->'priority') <> 'string'
           or (proposal->>'priority' <> '' and proposal->>'priority' !~ '^[1-9][0-9]?$') then
          raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_PRIORITY_INVALID';
        end if;
      end if;
      if proposal->>'action' = 'move_up' then
        has_move_up := true;
      end if;
      if proposal->'applyHold' = 'true'::jsonb
         or nullif(btrim(coalesce(proposal->>'holdReason','')),'') is not null then
        has_row_hold := true;
      end if;
    end loop;
  end loop;
  if has_move_up and (jsonb_array_length(hold_proposals) > 0 or has_row_hold) then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_MOVE_UP_HOLD_CONFLICT';
  end if;
  if not has_priority and jsonb_array_length(hold_proposals) = 0 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_LIVE_ACTION_REQUIRED';
  end if;
  v5_payload := projected || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v5-sheared-20261008',
    'transaction',(projected->'transaction') || jsonb_build_object('holdStopProposals',coalesce((
      select jsonb_agg(value - 'sourceUid') from jsonb_array_elements(hold_proposals)
    ),'[]'::jsonb)),
    'rowOverlays',(select coalesce(jsonb_agg(
      (value - 'expected') || jsonb_build_object('expected', (value->'expected') - 'priority' - 'holdstopcode' - 'holdstopreason')
      order by ordinality
    ),'[]'::jsonb) from jsonb_array_elements(projected->'rowOverlays') with ordinality a(value,ordinality))
  );
  perform private.validate_drive_reclass_sheared_v5(v5_payload);
  return projected;
end
$function$;
revoke all on function private.validate_reclass_smart_shield_v6(jsonb) from public, anon, authenticated;
grant execute on function private.validate_reclass_smart_shield_v6(jsonb) to service_role;

create or replace function private.lock_ph_master_inventory_for_live_edit_v6()
returns bigint
language plpgsql security definer set search_path = ''
as $function$
declare revision_value bigint;
begin
  select r.revision into revision_value
  from public.app_dataset_revisions r
  where r.key = 'ph_master_inventory' and r.state = 'ready'
  for update;
  if revision_value is null then
    raise exception using errcode = '40001', message = 'RECLASS_V6_INVENTORY_REFRESH_REQUIRED';
  end if;
  return revision_value;
end
$function$;
revoke all on function private.lock_ph_master_inventory_for_live_edit_v6() from public, anon, authenticated, service_role;

create or replace function private.lock_manager_season_priority_sources_v2()
returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  perform r.key from public.app_dataset_revisions r
  where r.key in ('ph_cav_import','ph_master_inventory','ph_warehouse_assigned_items')
  order by r.key for update;
  if exists (
    select 1 from unnest(array['ph_cav_import','ph_master_inventory','ph_warehouse_assigned_items']) required(key)
    left join public.app_dataset_revisions r on r.key=required.key
    where r.key is null or r.state <> 'ready'
  ) then
    raise exception using errcode='40001',message='SEASON_PRIORITY_SOURCE_REFRESH_REQUIRED';
  end if;
end
$function$;
revoke all on function private.lock_manager_season_priority_sources_v2() from public, anon, authenticated, service_role;

create or replace function private.reclass_v6_hold_target_v1(
  p_code text, p_reason text, p_action text, p_requested_reason text
)
returns jsonb
language sql immutable security definer set search_path = ''
as $function$
  with current_value as (
    select upper(btrim(coalesce(p_code,''))) as codes
  ), changed as (
    select case
      when p_action in ('hold','stop_ship') and p_action = 'hold'
        then case when position('H' in codes)=0 then codes || 'H' else codes end
      when p_action in ('hold','stop_ship')
        then case when position('S' in codes)=0 then codes || 'S' else codes end
      when p_action = 'take_off_hold' then replace(codes,'H','')
      when p_action = 'off_stop_ship' then replace(codes,'S','')
      else codes end as codes
    from current_value
  )
  select jsonb_build_object(
    'holdstopcode', nullif(codes,''),
    'holdstopreason', case
      when p_action in ('hold','stop_ship') then nullif(btrim(coalesce(p_requested_reason,'')),'')
      when codes = '' then null
      else p_reason end
  ) from changed
$function$;
revoke all on function private.reclass_v6_hold_target_v1(text,text,text,text) from public, anon, authenticated, service_role;

create or replace function private.prepare_reclass_live_edits_v6(p_payload jsonb, p_actor_username text)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  projected jsonb := private.validate_reclass_smart_shield_v6(p_payload);
  overlay jsonb;
  proposal jsonb;
  hold_proposal jsonb;
  source_row public.ph_master_inventory;
  sibling public.ph_master_inventory;
  row_value public.ph_master_inventory;
  expected jsonb;
  target jsonb;
  hold_target jsonb;
  edits_by_uid jsonb := '{}'::jsonb;
  frozen_by_uid jsonb := '{}'::jsonb;
  old_edit jsonb;
  new_edit jsonb;
  uid text;
  action_name text;
  source_uid text;
  source_itemcode text;
  source_season text;
  source_sales_year integer;
  current_season text;
  current_sales_year integer;
  is_fanout_actor boolean := false;
  settings jsonb;
  fanout_allowed boolean := false;
  fanout_count integer := 0;
begin
  if jsonb_typeof(coalesce(projected,'null'::jsonb)) <> 'object'
     or nullif(btrim(coalesce(p_actor_username,'')),'') is null then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_LIVE_EDIT_INVALID';
  end if;

  -- Capture the exact source rows before any live mutation for immutable PDF
  -- rendering. All rows are locked in UID order to match the update order.
  for overlay in
    select value from jsonb_array_elements(projected->'rowOverlays')
    order by value->>'unique_id'
  loop
    uid := btrim(coalesce(overlay->>'unique_id',''));
    select m.* into row_value from public.ph_master_inventory m
    where m.unique_id = uid for update;
    if row_value.unique_id is null then
      raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V6_LIVE_EDIT_ROW_MISSING';
    end if;
    frozen_by_uid := frozen_by_uid || jsonb_build_object(uid,to_jsonb(row_value));
  end loop;

  for overlay in select value from jsonb_array_elements(projected->'rowOverlays') loop
    uid := btrim(coalesce(overlay->>'unique_id',''));
    select m.* into row_value from public.ph_master_inventory m where m.unique_id = uid;
    expected := overlay->'expected';
    target := jsonb_build_object(
      'priority',row_value.priority,
      'holdstopcode',row_value.holdstopcode,
      'holdstopreason',row_value.holdstopreason
    );
    if exists(select 1 from jsonb_array_elements(coalesce(overlay->'proposals','[]'::jsonb)) p
      where p->>'action' = 'priority_change') then
      if coalesce(row_value.priority,'') is distinct from coalesce(expected->>'priority','')
         or coalesce(row_value.holdstopcode,'') is distinct from coalesce(expected->>'holdstopcode','')
         or coalesce(row_value.holdstopreason,'') is distinct from coalesce(expected->>'holdstopreason','') then
        raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V6_LIVE_EDIT_CONFLICT';
      end if;
      select value into proposal from jsonb_array_elements(coalesce(overlay->'proposals','[]'::jsonb)) p
      where p->>'action' = 'priority_change' limit 1;
      target := target || jsonb_build_object('priority',nullif(proposal->>'priority',''));
    end if;
    if exists(select 1 from jsonb_array_elements(coalesce(overlay->'proposals','[]'::jsonb)) p
      where p->>'action' = 'priority_change') then
      new_edit := jsonb_build_object('unique_id',uid,'expected',jsonb_build_object(
        'priority',row_value.priority,'holdstopcode',row_value.holdstopcode,'holdstopreason',row_value.holdstopreason
      ),'target',target);
      old_edit := edits_by_uid->uid;
      if old_edit is not null then
        if old_edit->'expected' is distinct from new_edit->'expected' then
          raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V6_LIVE_EDIT_CONFLICT';
        end if;
        new_edit := old_edit || jsonb_build_object('target',(old_edit->'target') || (new_edit->'target'));
      end if;
      edits_by_uid := jsonb_set(edits_by_uid,array[uid],new_edit,true);
    end if;
  end loop;

  select value into hold_proposal from jsonb_array_elements(coalesce(projected #> '{transaction,holdStopProposals}','[]'::jsonb)) limit 1;
  if hold_proposal is not null then
    source_uid := btrim(hold_proposal->>'sourceUid');
    select m.* into source_row from public.ph_master_inventory m
    where m.unique_id = source_uid for update;
    if source_row.unique_id is null then
      raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V6_HOLD_SOURCE_MISSING';
    end if;
    select overlay_row.value->'expected' into expected
    from jsonb_array_elements(projected->'rowOverlays') as overlay_row(value)
    where overlay_row.value->>'unique_id' = source_uid limit 1;
    if coalesce(source_row.priority,'') is distinct from coalesce(expected->>'priority','')
       or coalesce(source_row.holdstopcode,'') is distinct from coalesce(expected->>'holdstopcode','')
       or coalesce(source_row.holdstopreason,'') is distinct from coalesce(expected->>'holdstopreason','') then
      raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V6_LIVE_EDIT_CONFLICT';
    end if;
    frozen_by_uid := frozen_by_uid || jsonb_build_object(source_uid,to_jsonb(source_row));
    action_name := hold_proposal->>'action';
    hold_target := private.reclass_v6_hold_target_v1(
      source_row.holdstopcode,source_row.holdstopreason,action_name,hold_proposal->>'reason'
    );
    target := jsonb_build_object(
      'priority',source_row.priority,
      'holdstopcode',hold_target->'holdstopcode',
      'holdstopreason',hold_target->'holdstopreason'
    );
    new_edit := jsonb_build_object('unique_id',source_uid,'expected',jsonb_build_object(
      'priority',source_row.priority,'holdstopcode',source_row.holdstopcode,'holdstopreason',source_row.holdstopreason
    ),'target',target);
    old_edit := edits_by_uid->source_uid;
    if old_edit is not null then
      if old_edit->'expected' is distinct from new_edit->'expected' then
        raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V6_LIVE_EDIT_CONFLICT';
      end if;
      new_edit := old_edit || jsonb_build_object('target',(old_edit->'target') || jsonb_build_object(
        'holdstopcode',hold_target->'holdstopcode','holdstopreason',hold_target->'holdstopreason'
      ));
    end if;
    edits_by_uid := jsonb_set(edits_by_uid,array[source_uid],new_edit,true);

    is_fanout_actor := lower(btrim(p_actor_username)) = any(array[
      'dylan_collyge','megan_kelly','mitch_kaiser','jd_jones'
    ]);
    if is_fanout_actor then
      select s.value into settings from public.ph_app_settings s
      where s.key='current_season_salesyear' for share;
      current_season := upper(btrim(coalesce(settings->>'seasonCode','')));
      current_sales_year := private.season_sales_year_v1(settings->>'salesYear');
      if current_season !~ '^[SF][1-9]$' or current_sales_year is null then
        raise exception using errcode = '55000', message = 'DRIVE_RECLASS_V6_FANOUT_SCOPE_UNAVAILABLE';
      end if;
    end if;
    source_season := upper(btrim(coalesce(source_row.season,'')));
    source_sales_year := private.season_sales_year_v1(source_row.saleyear);
    source_itemcode := upper(btrim(coalesce(source_row.itemcode,'')));
    fanout_allowed := is_fanout_actor and source_itemcode <> ''
      and source_season = current_season and source_sales_year is not null
      and source_sales_year <= current_sales_year;
    if fanout_allowed then
      for sibling in
        select m.* from public.ph_master_inventory m
        where upper(btrim(coalesce(m.itemcode,''))) = source_itemcode
          and upper(btrim(coalesce(m.season,''))) = source_season
          and private.season_sales_year_v1(m.saleyear) <= current_sales_year
        order by m.unique_id for update
      loop
        if sibling.unique_id = source_uid then continue; end if;
        fanout_count := fanout_count + 1;
        hold_target := private.reclass_v6_hold_target_v1(
          sibling.holdstopcode,sibling.holdstopreason,action_name,hold_proposal->>'reason'
        );
        new_edit := jsonb_build_object(
          'unique_id',sibling.unique_id,
          'expected',jsonb_build_object('priority',sibling.priority,'holdstopcode',sibling.holdstopcode,'holdstopreason',sibling.holdstopreason),
          'target',jsonb_build_object('priority',sibling.priority,
            'holdstopcode',hold_target->'holdstopcode','holdstopreason',hold_target->'holdstopreason')
        );
        old_edit := edits_by_uid->sibling.unique_id;
        if old_edit is not null then
          if old_edit->'expected' is distinct from new_edit->'expected' then
            raise exception using errcode = '40001', message = 'DRIVE_RECLASS_V6_LIVE_EDIT_CONFLICT';
          end if;
          new_edit := old_edit || jsonb_build_object('target',(old_edit->'target') || jsonb_build_object(
            'holdstopcode',hold_target->'holdstopcode','holdstopreason',hold_target->'holdstopreason'
          ));
        end if;
        edits_by_uid := jsonb_set(edits_by_uid,array[sibling.unique_id],new_edit,true);
      end loop;
    end if;
  end if;

  if edits_by_uid = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_LIVE_ACTION_REQUIRED';
  end if;
  if (select count(*) from jsonb_object_keys(edits_by_uid)) > 10000 then
    raise exception using errcode='22023',message='DRIVE_RECLASS_V6_LIVE_EDIT_LIMIT_EXCEEDED';
  end if;
  return jsonb_build_object(
    'edits',(select coalesce(jsonb_agg(value order by key),'[]'::jsonb) from jsonb_each(edits_by_uid)),
    'v6FrozenRows',(select coalesce(jsonb_agg(value order by key),'[]'::jsonb) from jsonb_each(frozen_by_uid)),
    'liveEditScope',jsonb_build_object(
      'holdSourceUid',source_uid,
      'holdFanoutApplied',fanout_allowed,
      'holdFanoutCount',case when source_uid is null then 0 else fanout_count + 1 end,
      'holdFanoutSiblingCount',fanout_count,
      'holdItemcode',source_itemcode,
      'holdSeason',source_season,
      'holdSalesYearMax',case when fanout_allowed then current_sales_year else null end
    )
  );
end
$function$;
revoke all on function private.prepare_reclass_live_edits_v6(jsonb,text) from public, anon, authenticated, service_role;

create or replace function public.enqueue_drive_reclass_inquiry_v6(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  actor_username text := lower(btrim(coalesce(p_payload->>'actorUsername','')));
  token text := btrim(coalesce(p_payload->>'idempotencyToken',p_payload->>'idempotency_token',''));
  event_key_value text;
  fingerprint text;
  projected jsonb;
  v5_payload jsonb;
  prepared jsonb;
  live_result jsonb;
  final_payload jsonb;
  event_result jsonb;
  event_row public.ph_request_delivery_outbox;
  actor_profile public.profiles;
  actor_role text;
  access_scope text;
  existing_fingerprint text;
begin
  if actor_username = '' or length(token) < 12 or length(token) > 180 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_TOKEN_INVALID';
  end if;
  projected := private.project_reclass_smart_shield_v6(p_payload);
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'workflowPolicyVersion',projected->>'workflowPolicyVersion',
    'source',projected->'source','transaction',projected->'transaction','rowOverlays',projected->'rowOverlays'
  )::text,'UTF8'),'sha256'),'hex');
  event_key_value := 'reclass-inquiry:' || left(encode(extensions.digest(token,'sha256'),'hex'),40);
  perform pg_advisory_xact_lock(hashtextextended(event_key_value,0));
  select o.* into event_row from public.ph_request_delivery_outbox o
  where o.event_key=event_key_value and o.event_type='reclass_inquiry' for update;
  if event_row.event_id is not null then
    if lower(btrim(coalesce(event_row.payload #>> '{reclassPayload,actor,username}',''))) <> actor_username then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT';
    end if;
    select p.* into actor_profile from public.profiles p
    where lower(btrim(p.username))=actor_username and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now()) and not p.must_change_password limit 1;
    if actor_profile.id is null then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_PROFILE_NOT_ACTIVE';
    end if;
    actor_role := private.normalized_profile_role(actor_profile.role);
    if actor_role not in ('ADMIN','ADMINISTRATOR','MANAGER','EVAL','EVALUATOR') and actor_role not like '%EVAL%' then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_FORBIDDEN';
    end if;
    select e.access_scope into access_scope
    from private.get_effective_app_permissions_v1(actor_profile.id,private.resolve_app_access_policy_id_v1(false)) e
    where e.permission_key='drive.reclass.submit' and e.allowed limit 1;
    if access_scope is null then
      raise exception using errcode = '42501', message = 'DRIVE_RECLASS_PERMISSION_REQUIRED';
    end if;
    existing_fingerprint := event_row.payload #>> '{reclassPayload,protectedDelivery,requestFingerprint}';
    if event_row.payload #>> '{reclassPayload,workflowPolicyVersion}' <> 'reclass-action-workflow-v6-smart-shield-20261009'
       or existing_fingerprint is distinct from fingerprint then
      raise exception using errcode = 'P0001', message = 'DRIVE_RECLASS_TOKEN_CONFLICT';
    end if;
    return private.drive_reclass_delivery_result_v1(event_row) || jsonb_build_object(
      'duplicate',true,
      'liveEdits',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,liveEdits}','[]'::jsonb),
      'inventoryRevision',event_row.payload #>> '{reclassPayload,protectedDelivery,inventoryRevision}',
      'liveEditScope',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,liveEditScope}','{}'::jsonb),
      'unavailableUsernames',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,unavailableUsernames}','[]'::jsonb)
    );
  end if;

  -- Only a new token reads and validates mutable inventory state. Exact
  -- retries return the saved, authorized receipt above even after the live
  -- values have changed as part of the original submission.
  perform private.lock_ph_master_inventory_for_live_edit_v6();
  projected := private.validate_reclass_smart_shield_v6(p_payload);

  v5_payload := projected || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v5-sheared-20261008',
    'transaction',(projected->'transaction') || jsonb_build_object('holdStopProposals',coalesce((
      select jsonb_agg(value - 'sourceUid') from jsonb_array_elements(coalesce(projected #> '{transaction,holdStopProposals}','[]'::jsonb))
    ),'[]'::jsonb)),
    'rowOverlays',(select coalesce(jsonb_agg(
      (value - 'expected') || jsonb_build_object('expected',(value->'expected') - 'priority' - 'holdstopcode' - 'holdstopreason')
      order by ordinality
    ),'[]'::jsonb) from jsonb_array_elements(projected->'rowOverlays') with ordinality a(value,ordinality))
  );
  event_result := public.enqueue_drive_reclass_inquiry_v5(v5_payload);
  select o.* into event_row from public.ph_request_delivery_outbox o
  where o.event_key=event_key_value and o.event_type='reclass_inquiry' for update;
  if event_row.event_id is null or lower(btrim(coalesce(event_row.payload #>> '{reclassPayload,actor,username}',''))) <> actor_username then
    raise exception using errcode = '42501', message = 'DRIVE_RECLASS_TOKEN_OWNERSHIP_CONFLICT';
  end if;
  if coalesce(event_result->>'duplicate','false') = 'true' then
    raise exception using errcode = 'P0001', message = 'DRIVE_RECLASS_TOKEN_CONFLICT';
  end if;

  prepared := private.prepare_reclass_live_edits_v6(p_payload,actor_username);
  live_result := private.apply_ph_master_inventory_live_edits_v6(prepared->'edits');
  final_payload := jsonb_set(event_row.payload,'{reclassPayload}',
    (event_row.payload->'reclassPayload') || jsonb_build_object(
      'workflowPolicyVersion','reclass-action-workflow-v6-smart-shield-20261009',
      'transaction',projected->'transaction',
      'rowOverlays',projected->'rowOverlays',
      'protectedDelivery',(coalesce(event_row.payload #> '{reclassPayload,protectedDelivery}','{}'::jsonb)) || jsonb_build_object(
        'requestFingerprint',fingerprint,
        'v6FrozenRows',prepared->'v6FrozenRows',
        'liveEdits',live_result->'liveEdits',
        'inventoryRevision',live_result->'inventoryRevision',
        'liveEditScope',prepared->'liveEditScope'
      )
    ),false);
  if octet_length(convert_to(final_payload::text,'UTF8')) > 4 * 1024 * 1024 then
    raise exception using errcode = '22023', message = 'DRIVE_RECLASS_V6_PAYLOAD_TOO_LARGE';
  end if;
  update public.ph_request_delivery_outbox o set payload=final_payload,updated_at=clock_timestamp()
  where o.event_id=event_row.event_id returning * into event_row;
  update public.ph_inventory_transactions t set raw_payload=jsonb_build_object(
    'workflowPolicyVersion',event_row.payload #>> '{reclassPayload,workflowPolicyVersion}',
    'transaction',event_row.payload #> '{reclassPayload,transaction}',
    'rowOverlays',event_row.payload #> '{reclassPayload,rowOverlays}',
    'protectedDelivery',event_row.payload #> '{reclassPayload,protectedDelivery}'
  )
  where t.delivery_event_id=event_row.event_id
    and t.status='requested' and t.event_type='inventory_change_request';
  if not found then
    raise exception using errcode='55000',message='DRIVE_RECLASS_V6_REQUESTED_AUDIT_MISSING';
  end if;
  return private.drive_reclass_delivery_result_v1(event_row) || jsonb_build_object(
    'duplicate',false,
    'liveEdits',live_result->'liveEdits',
    'inventoryRevision',live_result->'inventoryRevision',
    'liveEditScope',prepared->'liveEditScope',
    'unavailableUsernames',coalesce(event_row.payload #> '{reclassPayload,protectedDelivery,unavailableUsernames}','[]'::jsonb)
  );
end
$function$;
revoke all on function public.enqueue_drive_reclass_inquiry_v6(jsonb) from public, anon, authenticated;
grant execute on function public.enqueue_drive_reclass_inquiry_v6(jsonb) to service_role;

create or replace function public.submit_manager_season_priority_v2(
  p_actor_id uuid, p_source_unique_id text, p_expected_priority integer,
  p_scope_fingerprint text, p_idempotency_token text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  result_value jsonb;
  event_row public.ph_request_delivery_outbox;
  payload_value jsonb;
  overlay jsonb;
  proposal jsonb;
  row_value public.ph_master_inventory;
  edits jsonb := '[]'::jsonb;
  frozen_rows jsonb := '[]'::jsonb;
  live_result jsonb;
  final_payload jsonb;
  request_fingerprint text;
  token_has_receipt boolean := false;
  itemcode_value text;
begin
  -- Reauthenticate the caller before probing the idempotency key. A known
  -- token can return its saved receipt without reading mutable inventory.
  perform private.manager_season_priority_actor_v1(p_actor_id);
  if p_expected_priority is null or p_expected_priority not between 2 and 4
     or coalesce(p_scope_fingerprint,'') !~ '^[0-9a-f]{64}$'
     or length(btrim(coalesce(p_idempotency_token,''))) < 12
     or length(btrim(coalesce(p_idempotency_token,''))) > 180 then
    return public.submit_manager_season_priority_v1(
      p_actor_id,p_source_unique_id,p_expected_priority,p_scope_fingerprint,p_idempotency_token
    );
  end if;
  select exists(
    select 1 from private.manager_season_priority_receipts r
    join public.ph_request_delivery_outbox o on o.event_id=r.event_id
    where o.event_key='reclass-inquiry:' || left(encode(extensions.digest(btrim(p_idempotency_token),'sha256'),'hex'),40)
      and o.event_type='reclass_inquiry'
  ) into token_has_receipt;
  if not token_has_receipt then
    -- V1 acquires three dataset revisions in key order. Use the same order
    -- before its reads so later live updates never upgrade a shared lock.
    perform private.lock_manager_season_priority_sources_v2();
  end if;
  result_value := public.submit_manager_season_priority_v1(
    p_actor_id,p_source_unique_id,p_expected_priority,p_scope_fingerprint,p_idempotency_token
  );
  if nullif(result_value->>'jobId','') is null then
    raise exception using errcode = '55000', message = 'SEASON_PRIORITY_V2_OUTBOX_MISSING';
  end if;
  select o.* into event_row from public.ph_request_delivery_outbox o
  where o.event_id = (result_value->>'jobId')::uuid and o.event_type='reclass_inquiry'
  for update;
  if event_row.event_id is null then
    raise exception using errcode = '55000', message = 'SEASON_PRIORITY_V2_OUTBOX_MISSING';
  end if;
  payload_value := event_row.payload->'reclassPayload';
  request_fingerprint := payload_value #>> '{transaction,seasonPriority,requestFingerprint}';
  if coalesce(payload_value->>'workflowPolicyVersion','') not in (
       'reclass-action-workflow-v3-row-actions-20260826','reclass-action-workflow-v4-split-moves-20261006'
     ) or request_fingerprint is null then
    raise exception using errcode = '40001', message = 'SEASON_PRIORITY_V2_TOKEN_CONFLICT';
  end if;
  if coalesce(result_value->>'duplicate','false') = 'true' then
    if payload_value #>> '{transaction,seasonPriority,contractVersion}' <> 'manager-season-priority-v2'
       or payload_value #>> '{protectedDelivery,managerV2RequestFingerprint}' is distinct from request_fingerprint then
      raise exception using errcode = '40001', message = 'SEASON_PRIORITY_V2_TOKEN_CONFLICT';
    end if;
    return result_value || jsonb_build_object(
      'duplicate',true,
      'liveEdits',coalesce(payload_value #> '{protectedDelivery,liveEdits}','[]'::jsonb),
      'inventoryRevision',payload_value #>> '{protectedDelivery,inventoryRevision}',
      'liveEditScope',coalesce(payload_value #> '{protectedDelivery,liveEditScope}','{}'::jsonb)
    );
  end if;
  itemcode_value := upper(btrim(coalesce(payload_value #>> '{transaction,seasonPriority,itemcode}',payload_value #>> '{source,itemcode}','')));

  for overlay in select value from jsonb_array_elements(coalesce(payload_value->'rowOverlays','[]'::jsonb)) loop
    select value into proposal from jsonb_array_elements(coalesce(overlay->'proposals','[]'::jsonb)) p
    where p->>'action'='priority_change' limit 1;
    if proposal is null then continue; end if;
    select m.* into row_value from public.ph_master_inventory m
    where m.unique_id=btrim(coalesce(overlay->>'unique_id',''));
    if row_value.unique_id is null then
      raise exception using errcode='40001',message='SEASON_PRIORITY_V2_ROW_MISSING';
    end if;
    edits := edits || jsonb_build_array(jsonb_build_object(
      'unique_id',row_value.unique_id,
      'expected',jsonb_build_object(
        'priority',overlay #>> '{expected,priority}',
        'holdstopcode',row_value.holdstopcode,
        'holdstopreason',row_value.holdstopreason
      ),
      'target',jsonb_build_object(
        'priority',proposal->>'priority',
        'holdstopcode',row_value.holdstopcode,
        'holdstopreason',row_value.holdstopreason
      )
    ));
  end loop;
  if jsonb_array_length(edits)=0 then
    raise exception using errcode='22023',message='SEASON_PRIORITY_V2_EDITS_MISSING';
  end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.unique_id),'[]'::jsonb) into frozen_rows
  from public.ph_master_inventory m
  join jsonb_array_elements(coalesce(payload_value->'rowOverlays','[]'::jsonb)) as overlay(value)
    on overlay.value->>'unique_id'=m.unique_id;
  live_result := private.apply_ph_master_inventory_live_edits_v6(edits);
  final_payload := jsonb_set(event_row.payload,'{reclassPayload}',
    payload_value || jsonb_build_object(
      'transaction',(payload_value->'transaction') || jsonb_build_object('seasonPriority',
        (payload_value->'transaction'->'seasonPriority') || jsonb_build_object('contractVersion','manager-season-priority-v2')),
      'protectedDelivery',(coalesce(payload_value->'protectedDelivery','{}'::jsonb)) || jsonb_build_object(
        'managerV2RequestFingerprint',request_fingerprint,
        'liveEditVersion','manager-season-priority-v2',
        'v6FrozenRows',frozen_rows,
        'liveEdits',live_result->'liveEdits',
        'inventoryRevision',live_result->'inventoryRevision',
        'liveEditScope',jsonb_build_object('kind','manager-season-priority','itemcode',itemcode_value,'affectedCount',jsonb_array_length(edits))
      )
    ),false);
  update public.ph_request_delivery_outbox o set payload=final_payload,updated_at=clock_timestamp()
  where o.event_id=event_row.event_id returning * into event_row;
  update public.ph_inventory_transactions t set raw_payload=jsonb_build_object(
    'workflowPolicyVersion',event_row.payload #>> '{reclassPayload,workflowPolicyVersion}',
    'transaction',event_row.payload #> '{reclassPayload,transaction}',
    'rowOverlays',event_row.payload #> '{reclassPayload,rowOverlays}',
    'protectedDelivery',event_row.payload #> '{reclassPayload,protectedDelivery}'
  )
  where t.delivery_event_id=event_row.event_id
    and t.status='requested' and t.event_type='inventory_change_request';
  if not found then
    raise exception using errcode='55000',message='SEASON_PRIORITY_V2_REQUESTED_AUDIT_MISSING';
  end if;
  return result_value || jsonb_build_object(
    'duplicate',false,
    'liveEdits',live_result->'liveEdits',
    'inventoryRevision',live_result->'inventoryRevision',
    'liveEditScope',jsonb_build_object('kind','manager-season-priority','itemcode',itemcode_value,'affectedCount',jsonb_array_length(edits))
  );
end
$function$;
revoke all on function public.submit_manager_season_priority_v2(uuid,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.submit_manager_season_priority_v2(uuid,text,integer,text,text) to service_role;

-- Eval Work uses the same V6 proposal shape, but draft saves remain inert.
-- This adapter removes only the V6 live-edit snapshot fields before reusing
-- the existing V5 Eval Work context validator.
create or replace function private.eval_work_smart_shield_v6_to_v5(p_inquiry jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  projected jsonb := private.project_reclass_smart_shield_v6(p_inquiry);
begin
  return projected || jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v5-sheared-20261008',
    'transaction',(projected->'transaction') || jsonb_build_object('holdStopProposals',coalesce((
      select jsonb_agg(value - 'sourceUid')
      from jsonb_array_elements(coalesce(projected #> '{transaction,holdStopProposals}','[]'::jsonb))
    ),'[]'::jsonb)),
    'rowOverlays',(select coalesce(jsonb_agg(
      (value - 'expected') || jsonb_build_object('expected',(value->'expected') - 'priority' - 'holdstopcode' - 'holdstopreason')
      order by ordinality
    ),'[]'::jsonb) from jsonb_array_elements(projected->'rowOverlays') with ordinality a(value,ordinality))
  );
end
$function$;
revoke all on function private.eval_work_smart_shield_v6_to_v5(jsonb) from public, anon, authenticated, service_role;

create or replace function private.validate_eval_work_inquiry_v1(
  p_inquiry jsonb, p_itemcode text, p_context_rows jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $function$
declare projected jsonb; overlay jsonb; current_row jsonb; uid text;
begin
  if coalesce(p_inquiry->>'workflowPolicyVersion','') = 'reclass-action-workflow-v6-smart-shield-20261009' then
    perform private.validate_reclass_smart_shield_v6(p_inquiry);
    projected := private.eval_work_smart_shield_v6_to_v5(p_inquiry);
    perform private.validate_eval_work_inquiry_sheared_v5(projected,p_itemcode,p_context_rows);
  elsif coalesce(p_inquiry->>'workflowPolicyVersion','') = 'reclass-action-workflow-v5-sheared-20261008' then
    perform private.validate_eval_work_inquiry_sheared_v5(p_inquiry,p_itemcode,p_context_rows);
  elsif coalesce(p_inquiry->>'workflowPolicyVersion','') = 'reclass-action-workflow-v4-split-moves-20261006' then
    for overlay in select value from jsonb_array_elements(coalesce(p_inquiry->'rowOverlays','[]'::jsonb)) loop
      uid := btrim(coalesce(overlay->>'unique_id',''));
      select value into current_row from jsonb_array_elements(coalesce(p_context_rows,'[]'::jsonb))
      where value->>'unique_id' = uid limit 1;
      if current_row is null then
        raise exception using errcode = '40001', message = 'eval_work_original_oh_conflict';
      end if;
      if overlay->'expected' ? 'ptronhand' and exists (
        select 1 from jsonb_array_elements(coalesce(overlay->'proposals','[]'::jsonb)) proposal
        where proposal->>'action' in ('move_up','move_down')
      ) and overlay #>> '{expected,ptronhand}' is distinct from current_row->>'ptronhand' then
        raise exception using errcode = '40001', message = 'eval_work_original_oh_conflict';
      end if;
    end loop;
    projected := private.project_reclass_split_move_v4(p_inquiry,true);
    perform private.validate_eval_work_inquiry_legacy_v1(projected,p_itemcode,p_context_rows);
  else
    perform private.validate_eval_work_inquiry_legacy_v1(p_inquiry,p_itemcode,p_context_rows);
  end if;
end
$function$;
revoke all on function private.validate_eval_work_inquiry_v1(jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function private.validate_eval_work_inquiry_v1(jsonb,text,jsonb) to service_role;

-- Preserve the installed V5 submit paths verbatim for every existing contract.
-- The public wrappers below add one explicit V6 branch for atomic live edits.
alter function public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) set schema private;
alter function private.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) rename to submit_eval_work_v1_v5_impl;
alter function public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) set schema private;
alter function private.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) rename to submit_eval_work_v2_v5_impl;
revoke all on function private.submit_eval_work_v1_v5_impl(uuid,text,integer,jsonb,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function private.submit_eval_work_v2_v5_impl(uuid,text,integer,jsonb,jsonb,text) from public, anon, authenticated, service_role;

create or replace function public.submit_eval_work_v1(
  p_work_id uuid, p_actor_username text, p_expected_version integer,
  p_inquiry jsonb, p_evidence jsonb, p_submission_token text
)
returns public.ph_eval_work
language plpgsql security definer set search_path = ''
as $function$
declare
  actor public.profiles;
  work public.ph_eval_work;
  submitted public.ph_eval_work;
  final_inquiry jsonb;
  legacy_inquiry jsonb;
  current_rows jsonb;
  projected jsonb;
  prepared jsonb;
  live_result jsonb;
  fingerprint text;
  delivery public.ph_request_delivery_outbox;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id=p_work_id for update;
  if work.id is null or lower(work.assignee_username) <> lower(actor.username) then
    raise exception using errcode='42501',message='eval_work_submit_forbidden';
  end if;
  final_inquiry := coalesce(p_inquiry,work.inquiry_draft);
  if coalesce(final_inquiry->>'workflowPolicyVersion','') <> 'reclass-action-workflow-v6-smart-shield-20261009' then
    return private.submit_eval_work_v1_v5_impl(
      p_work_id,p_actor_username,p_expected_version,p_inquiry,p_evidence,p_submission_token
    );
  end if;
  if work.status='submitted' and work.submission_token=trim(coalesce(p_submission_token,''))
     and work.submission_request_fingerprint is not null then
    fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidence',p_evidence)::text,'UTF8'),'sha256'),'hex');
    if work.submission_request_fingerprint is distinct from fingerprint then
      raise exception using errcode='P0001',message='eval_work_submission_token_conflict';
    end if;
    return work;
  end if;
  if work.status not in ('open','in_progress') or work.version <> p_expected_version then
    raise exception using errcode='40001',message='eval_work_version_conflict';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidence',p_evidence)::text,'UTF8'),'sha256'),'hex');
  perform private.lock_ph_master_inventory_for_live_edit_v6();
  current_rows := private.eval_work_context_rows_v1(work.itemcode);
  perform private.validate_eval_work_inquiry_v1(final_inquiry,work.itemcode,current_rows);
  projected := private.project_reclass_smart_shield_v6(final_inquiry);
  legacy_inquiry := private.eval_work_smart_shield_v6_to_v5(final_inquiry);
  prepared := private.prepare_reclass_live_edits_v6(final_inquiry,actor.username);
  submitted := public.submit_eval_work_legacy_v1(
    p_work_id,p_actor_username,p_expected_version,legacy_inquiry,p_evidence,p_submission_token
  );
  live_result := private.apply_ph_master_inventory_live_edits_v6(prepared->'edits');
  update public.ph_eval_work w set
    inquiry_draft=final_inquiry,submitted_inquiry=projected,
    submission_request_fingerprint=fingerprint
  where w.id=submitted.id returning * into submitted;
  select * into delivery from public.ph_request_delivery_outbox o
  where o.event_id=submitted.completion_event_id and o.event_type='eval_work_completion' for update;
  if delivery.event_id is null then
    raise exception using errcode='55000',message='EVAL_WORK_V6_COMPLETION_OUTBOX_MISSING';
  end if;
  update public.ph_request_delivery_outbox o set payload=o.payload || jsonb_build_object(
    'inquiry',projected,
    'protectedDelivery',jsonb_build_object(
      'liveEditVersion','reclass-action-workflow-v6-smart-shield-20261009',
      'v6FrozenRows',prepared->'v6FrozenRows','liveEdits',live_result->'liveEdits',
      'inventoryRevision',live_result->'inventoryRevision','liveEditScope',prepared->'liveEditScope'
    )
  ),updated_at=clock_timestamp()
  where o.event_id=delivery.event_id;
  return submitted;
end
$function$;
revoke all on function public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text) to service_role;

create or replace function public.submit_eval_work_v2(
  p_work_id uuid, p_actor_username text, p_expected_version integer,
  p_inquiry jsonb, p_evidence_by_origin jsonb, p_submission_token text
)
returns public.ph_eval_work
language plpgsql security definer set search_path = ''
as $function$
declare
  actor public.profiles;
  work public.ph_eval_work;
  submitted public.ph_eval_work;
  final_inquiry jsonb;
  legacy_inquiry jsonb;
  current_rows jsonb;
  origin_ids text[];
  projected jsonb;
  prepared jsonb;
  live_result jsonb;
  fingerprint text;
  delivery public.ph_request_delivery_outbox;
begin
  actor := private.eval_work_assert_actor_v1(p_actor_username);
  select * into work from public.ph_eval_work where id=p_work_id for update;
  if work.id is null or work.contract_version <> 'eval-work-v2-multi-origin'
     or not (lower(actor.username)=any(coalesce(work.assignee_usernames,array[lower(work.assignee_username)]))) then
    raise exception using errcode='42501',message='eval_work_submit_forbidden';
  end if;
  final_inquiry := coalesce(p_inquiry,work.inquiry_draft);
  if coalesce(final_inquiry->>'workflowPolicyVersion','') <> 'reclass-action-workflow-v6-smart-shield-20261009' then
    return private.submit_eval_work_v2_v5_impl(
      p_work_id,p_actor_username,p_expected_version,p_inquiry,p_evidence_by_origin,p_submission_token
    );
  end if;
  if work.status='submitted' and work.submission_token=trim(coalesce(p_submission_token,''))
     and work.submission_request_fingerprint is not null then
    fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidenceByOrigin',p_evidence_by_origin)::text,'UTF8'),'sha256'),'hex');
    if work.submission_request_fingerprint is distinct from fingerprint then
      raise exception using errcode='P0001',message='eval_work_submission_token_conflict';
    end if;
    return work;
  end if;
  if work.status not in ('open','in_progress') or work.version <> p_expected_version then
    raise exception using errcode='40001',message='eval_work_version_conflict';
  end if;
  fingerprint := encode(extensions.digest(convert_to(jsonb_build_object('inquiry',final_inquiry,'evidenceByOrigin',p_evidence_by_origin)::text,'UTF8'),'sha256'),'hex');
  perform private.lock_ph_master_inventory_for_live_edit_v6();
  if coalesce(work.source_context->>'scopeContract','')='itemcode-all-rows-v1' then
    current_rows := private.eval_work_assert_itemcode_membership_v1(p_work_id);
  else
    select array_agg(origin_unique_id order by ordinal) into origin_ids
    from public.ph_eval_work_origin_rows where eval_work_id=work.id;
    current_rows := private.eval_work_context_rows_for_origins_v2(origin_ids);
  end if;
  perform private.validate_eval_work_inquiry_v1(final_inquiry,work.itemcode,current_rows);
  projected := private.project_reclass_smart_shield_v6(final_inquiry);
  legacy_inquiry := private.eval_work_smart_shield_v6_to_v5(final_inquiry);
  prepared := private.prepare_reclass_live_edits_v6(final_inquiry,actor.username);
  submitted := public.submit_eval_work_legacy_v2(
    p_work_id,p_actor_username,p_expected_version,legacy_inquiry,p_evidence_by_origin,p_submission_token
  );
  live_result := private.apply_ph_master_inventory_live_edits_v6(prepared->'edits');
  update public.ph_eval_work w set
    inquiry_draft=final_inquiry,submitted_inquiry=projected,
    submission_request_fingerprint=fingerprint
  where w.id=submitted.id returning * into submitted;
  select * into delivery from public.ph_request_delivery_outbox o
  where o.event_id=submitted.completion_event_id and o.event_type='eval_work_completion' for update;
  if delivery.event_id is null then
    raise exception using errcode='55000',message='EVAL_WORK_V6_COMPLETION_OUTBOX_MISSING';
  end if;
  update public.ph_request_delivery_outbox o set payload=o.payload || jsonb_build_object(
    'inquiry',projected,
    'protectedDelivery',jsonb_build_object(
      'liveEditVersion','reclass-action-workflow-v6-smart-shield-20261009',
      'v6FrozenRows',prepared->'v6FrozenRows','liveEdits',live_result->'liveEdits',
      'inventoryRevision',live_result->'inventoryRevision','liveEditScope',prepared->'liveEditScope'
    )
  ),updated_at=clock_timestamp()
  where o.event_id=delivery.event_id;
  return submitted;
end
$function$;
revoke all on function public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text) to service_role;

insert into private.app_access_legacy_checks(check_key,permission_key,enforcement_surface,notes)
values
  ('edge.drive.reclass.v6','drive.reclass.submit','edge','V6 authenticated Reclass requests use a service-only atomic queue and live-edit RPC.'),
  ('rpc.drive.reclass.v6','drive.reclass.submit','rpc','V6 validates source identity and atomically queues the frozen inquiry with authorized priority/hold edits.'),
  ('rpc.manager.season_priority.v2','managers.season_priority.submit','rpc','V2 manager priority submissions preserve the V1 receipt and apply live priority changes atomically.')
on conflict(check_key) do update set permission_key=excluded.permission_key,enforcement_surface=excluded.enforcement_surface,notes=excluded.notes;

notify pgrst,'reload schema';
commit;
