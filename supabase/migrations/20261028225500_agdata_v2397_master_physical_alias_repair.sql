begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

create table if not exists private.ph_master_identity_alias_repair_audit_v2397 (
  alias_unique_id text primary key,
  canonical_unique_id text not null,
  lineage_key text not null,
  stable_identity_key text not null,
  source_stage_id uuid not null,
  source_stage_created_at timestamptz not null,
  source_file_name text,
  source_values jsonb not null,
  source_raw_fields text[] not null,
  canonical_master jsonb not null,
  alias_master jsonb not null,
  related_rows jsonb not null,
  repaired_at timestamptz not null default clock_timestamp()
);
revoke all on private.ph_master_identity_alias_repair_audit_v2397 from public,anon,authenticated,service_role;

-- Collapse only exact full-lineage Drive aliases with one protected canonical
-- row, committed raw source evidence, and matching assignment/crop witnesses.
do $repair_master_identity_aliases$
declare
  original_replication_role text := current_setting('session_replication_role');
  set_list text;
  target_count integer;
  restored_role text;
begin
  drop table if exists pg_temp.ph_master_identity_alias_repair_pairs_v2397;
  create temp table ph_master_identity_alias_repair_pairs_v2397 on commit drop as
  with master_rows as materialized (
    select m.unique_id,to_jsonb(m) as row_json,
      private.ph_master_inventory_lineage_key_v1(to_jsonb(m)) as lineage_key,
      private.ph_master_inventory_stable_identity_v7(to_jsonb(m)) as stable_identity_key,
      exists(select 1 from app_sync_private.inventory_live_overrides_v1 e
        where e.canonical_unique_id=m.unique_id and e.pending) as has_pending_override,
      exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7 e
        where e.canonical_unique_id=m.unique_id and e.pending) as has_pending_item6_edit,
      exists(select 1 from app_sync_private.ph_master_inventory_app_edits e
        where e.canonical_unique_id=m.unique_id and e.pending_legacy_sync) as has_pending_priority_edit,
      m.itemcode,m.lotcode,m.season
    from public.ph_master_inventory m
  ), grouped as materialized (
    select lineage_key,stable_identity_key,count(*) as physical_count,
      min(unique_id) filter(where unique_id like 'drive-%') as alias_unique_id,
      min(unique_id) filter(where unique_id not like 'drive-%') as canonical_unique_id,
      count(*) filter(where unique_id like 'drive-%') as alias_count,
      count(*) filter(where unique_id not like 'drive-%' and has_pending_override) as protected_canonical_count,
      count(*) filter(where unique_id like 'drive-%' and
        (has_pending_override or has_pending_item6_edit or has_pending_priority_edit)) as unsafe_alias_count
    from master_rows group by lineage_key,stable_identity_key
  ), aliases as materialized (
    select g.*,c.row_json as canonical_master,a.row_json as alias_master,
      c.itemcode as canonical_itemcode,c.lotcode as canonical_lotcode,c.season as canonical_season
    from grouped g
    join master_rows c on c.unique_id=g.canonical_unique_id
    join master_rows a on a.unique_id=g.alias_unique_id
    where g.physical_count=2 and g.alias_count=1 and g.protected_canonical_count=1 and g.unsafe_alias_count=0
      and c.lineage_key=a.lineage_key and c.stable_identity_key=a.stable_identity_key
      and not exists(select 1 from private.ph_inventory_reclass_movements_v1 x
        where x.source_unique_id=g.alias_unique_id or x.destination_unique_id=g.alias_unique_id)
      and not exists(select 1 from public.ph_inventory_transactions x
        where x.source_unique_id=g.alias_unique_id or x.destination_unique_id=g.alias_unique_id)
      and not exists(select 1 from app_sync_private.inventory_location_evidence_v1 x
        where x.source_unique_id=g.alias_unique_id
          and (x.itemcode_key<>upper(btrim(coalesce(c.itemcode,'')))
            or x.locationcode_key<>upper(btrim(coalesce((c.row_json->>'locationcode'),'')))))
      and not exists(select 1 from public.ph_sales_office alias_sales
        join public.ph_sales_office canonical_sales on canonical_sales.unique_id=g.canonical_unique_id
        where alias_sales.unique_id=g.alias_unique_id
          and to_jsonb(alias_sales)-'unique_id' is distinct from to_jsonb(canonical_sales)-'unique_id')
      and not exists(select 1 from private.inventory_row_assignment_reconcile_worklist x
        where x.master_unique_id=g.alias_unique_id)
      and not exists(select 1 from app_sync_private.ph_master_inventory_item6_aliases_v7 x
        where x.imported_unique_id=g.alias_unique_id and x.canonical_unique_id not in(g.alias_unique_id,g.canonical_unique_id))
      and not exists(select 1 from app_sync_private.ph_master_inventory_item6_aliases_v7 x
        where x.canonical_unique_id=g.alias_unique_id and x.imported_unique_id<>g.alias_unique_id)
      and (select count(*) from public.ph_inventory_row_assignments x
        where x.master_unique_id=g.canonical_unique_id)=1
      and (select count(*) from public.ph_inventory_row_assignments x
        where x.master_unique_id=g.alias_unique_id)=1
      and (select to_jsonb(x)-array['master_unique_id','unique_id','revision','updated_at']::text[]
        from public.ph_inventory_row_assignments x where x.master_unique_id=g.canonical_unique_id)
        is not distinct from
        (select to_jsonb(x)-array['master_unique_id','unique_id','revision','updated_at']::text[]
        from public.ph_inventory_row_assignments x where x.master_unique_id=g.alias_unique_id)
      and (select count(*) from public.ph_crop_roll_drive_rows x
        where x.unique_id=g.canonical_unique_id and x.master_unique_id=g.canonical_unique_id)=1
      and (select count(*) from public.ph_crop_roll_drive_rows x
        where x.unique_id=g.alias_unique_id and x.master_unique_id=g.alias_unique_id)=1
      and not exists(
        select 1 from unnest(array['date_completed','app_tab_assignment','av_note','sales_note','match','spec','caliper',
          'pic_note','loc_match_qty','initial_ptr','photo_link','photo_name','hold_release_approved_at',
          'hold_release_approved_by','hold_release_approved_by_display','hold_release_approved_holdstopbegindate',
          'locationnote']::text[]) f(field_name)
        join public.ph_crop_roll_drive_rows canon_crop on canon_crop.unique_id=g.canonical_unique_id
        join public.ph_crop_roll_drive_rows alias_crop on alias_crop.unique_id=g.alias_unique_id
        where to_jsonb(alias_crop)->f.field_name is not null and to_jsonb(alias_crop)->f.field_name<>'null'::jsonb
          and to_jsonb(alias_crop)->f.field_name is distinct from to_jsonb(canon_crop)->f.field_name
      )
  ), latest_stage as materialized (
    select distinct on(r.unique_id) r.unique_id,r.row_value,s.stage_id,s.created_at,s.file_meta,s.committed_result
    from private.fast_erp_stage_rows_v1 r
    join private.fast_erp_stage_runs_v1 s using(stage_id)
    where s.dataset_key='drive_around' and s.stage_state='committed'
      and r.unique_id in(select alias_unique_id from aliases)
    order by r.unique_id,s.created_at desc,s.stage_id desc
  ), staged as (
    select a.*,s.stage_id,s.created_at as stage_created_at,s.file_meta,s.committed_result,
      s.row_value->'values' as source_values,
      array(select distinct jsonb_array_elements_text(s.row_value->'rawFields') order by 1) as source_raw_fields,
      b.source_hash as alias_source_hash,b.import_run_id as alias_import_run_id,
      b.source_unique_id as alias_source_unique_id,
      private.ph_master_bulk_source_hash_v1(s.row_value->'values',
        array(select distinct jsonb_array_elements_text(s.row_value->'rawFields') order by 1)) as staged_source_hash
    from aliases a
    join latest_stage s on s.unique_id=a.alias_unique_id
    join lateral (select source.source_hash,source.import_run_id,source.source_unique_id
      from app_sync_private.ph_master_bulk_import_source_v1 source
      where source.source_unique_id=a.alias_unique_id
        and source.canonical_unique_id in(a.alias_unique_id,a.canonical_unique_id)
      order by source.updated_at desc,source.canonical_unique_id limit 1) b on true
    where jsonb_typeof(s.row_value->'values')='object'
      and private.ph_master_inventory_lineage_key_v1(s.row_value->'values')=a.lineage_key
      and private.ph_master_inventory_stable_identity_v7(s.row_value->'values')=a.stable_identity_key
      and s.file_meta->>'file_name'=a.alias_master->>'filename'
      and b.source_unique_id=a.alias_unique_id
      and b.source_hash=private.ph_master_bulk_source_hash_v1(s.row_value->'values',
        array(select distinct jsonb_array_elements_text(s.row_value->'rawFields') order by 1))
  )
  select staged.*,
    (source_values - array['unique_id','warehouseid','warehousei','itemcode','contsize','locationcode','lotcode','source',
      'desigitem','desigcust','desigloc','assignedto','holdstopcode','holdstopreason','locationnote','last_updated','updated_at',
      'date_completed','app_tab_assignment','av_note','sales_note','match','spec','caliper','pic_note','loc_match_qty','initial_ptr',
      'photo_link','photo_name','hold_release_approved_at','hold_release_approved_by','hold_release_approved_by_display',
      'hold_release_approved_holdstopbegindate']::text[]
      - coalesce((select array_agg(e.field_name) from app_sync_private.inventory_live_overrides_v1 e
        where e.canonical_unique_id=staged.canonical_unique_id and e.pending),'{}'::text[])
      - coalesce((select array_agg(e.field_name) from app_sync_private.ph_master_inventory_item6_edits_v7 e
        where e.canonical_unique_id=staged.canonical_unique_id and e.pending),'{}'::text[])
      - case when exists(select 1 from app_sync_private.ph_master_inventory_app_edits e
          where e.canonical_unique_id=staged.canonical_unique_id and e.pending_legacy_sync)
        then array['priority','holdstopcode','holdstopreason']::text[] else '{}'::text[] end
      - case when exists(select 1 from app_sync_private.inventory_season_stock_overrides_v1 e
          where e.itemcode=staged.canonical_itemcode and e.pending
            and e.season=private.inventory_stock_season_v1(staged.canonical_lotcode,staged.canonical_season))
        then array['s_lts','season_oh']::text[] else '{}'::text[] end) as merge_values
  from staged;

  select count(*)::integer into target_count from pg_temp.ph_master_identity_alias_repair_pairs_v2397;

  insert into private.ph_master_identity_alias_repair_audit_v2397(
    alias_unique_id,canonical_unique_id,lineage_key,stable_identity_key,source_stage_id,
    source_stage_created_at,source_file_name,source_values,source_raw_fields,canonical_master,alias_master,related_rows
  )
  select p.alias_unique_id,p.canonical_unique_id,p.lineage_key,p.stable_identity_key,p.stage_id,
    p.stage_created_at,p.file_meta->>'file_name',p.source_values,p.source_raw_fields,p.canonical_master,p.alias_master,
    jsonb_build_object(
      'source_file_meta',p.file_meta,'stage_committed_result',p.committed_result,
      'canonical_live_overrides',(select coalesce(jsonb_agg(to_jsonb(x) order by x.field_name),'[]'::jsonb) from app_sync_private.inventory_live_overrides_v1 x where x.canonical_unique_id=p.canonical_unique_id),
      'alias_live_overrides',(select coalesce(jsonb_agg(to_jsonb(x) order by x.field_name),'[]'::jsonb) from app_sync_private.inventory_live_overrides_v1 x where x.canonical_unique_id=p.alias_unique_id),
      'canonical_item6_edits',(select coalesce(jsonb_agg(to_jsonb(x) order by x.field_name),'[]'::jsonb) from app_sync_private.ph_master_inventory_item6_edits_v7 x where x.canonical_unique_id=p.canonical_unique_id),
      'alias_item6_edits',(select coalesce(jsonb_agg(to_jsonb(x) order by x.field_name),'[]'::jsonb) from app_sync_private.ph_master_inventory_item6_edits_v7 x where x.canonical_unique_id=p.alias_unique_id),
      'canonical_season_stock_overrides',(select coalesce(jsonb_agg(to_jsonb(x) order by x.season),'[]'::jsonb)
        from app_sync_private.inventory_season_stock_overrides_v1 x
        where x.itemcode=p.canonical_itemcode and x.pending
          and x.season=private.inventory_stock_season_v1(p.canonical_lotcode,p.canonical_season)),
      'canonical_priority_edits',coalesce((select to_jsonb(x) from app_sync_private.ph_master_inventory_app_edits x where x.canonical_unique_id=p.canonical_unique_id),'null'::jsonb),
      'alias_priority_edits',coalesce((select to_jsonb(x) from app_sync_private.ph_master_inventory_app_edits x where x.canonical_unique_id=p.alias_unique_id),'null'::jsonb),
      'canonical_source_baseline',(select to_jsonb(x) from app_sync_private.ph_master_inventory_source_baselines x where x.canonical_unique_id=p.canonical_unique_id),
      'alias_source_baseline',(select to_jsonb(x) from app_sync_private.ph_master_inventory_source_baselines x where x.canonical_unique_id=p.alias_unique_id),
      'canonical_item6_source',(select to_jsonb(x) from app_sync_private.ph_master_inventory_item6_source_v7 x where x.canonical_unique_id=p.canonical_unique_id),
      'alias_item6_source',(select to_jsonb(x) from app_sync_private.ph_master_inventory_item6_source_v7 x where x.canonical_unique_id=p.alias_unique_id),
      'canonical_bulk_source',(select to_jsonb(x) from app_sync_private.ph_master_bulk_import_source_v1 x where x.canonical_unique_id=p.canonical_unique_id),
      'alias_bulk_source',(select to_jsonb(x) from app_sync_private.ph_master_bulk_import_source_v1 x where x.canonical_unique_id=p.alias_unique_id),
      'canonical_alias_maps',(select coalesce(jsonb_agg(to_jsonb(x) order by x.imported_unique_id),'[]'::jsonb) from app_sync_private.ph_master_inventory_item6_aliases_v7 x where x.canonical_unique_id=p.canonical_unique_id or x.imported_unique_id=p.canonical_unique_id),
      'alias_alias_maps',(select coalesce(jsonb_agg(to_jsonb(x) order by x.imported_unique_id),'[]'::jsonb) from app_sync_private.ph_master_inventory_item6_aliases_v7 x where x.canonical_unique_id=p.alias_unique_id or x.imported_unique_id=p.alias_unique_id),
      'canonical_alias_seen',(select coalesce(jsonb_agg(to_jsonb(x) order by x.run_id),'[]'::jsonb) from app_sync_private.ph_master_inventory_item6_alias_seen_v7 x where x.canonical_unique_id=p.canonical_unique_id or x.imported_unique_id=p.canonical_unique_id),
      'alias_alias_seen',(select coalesce(jsonb_agg(to_jsonb(x) order by x.run_id),'[]'::jsonb) from app_sync_private.ph_master_inventory_item6_alias_seen_v7 x where x.canonical_unique_id=p.alias_unique_id or x.imported_unique_id=p.alias_unique_id),
      'canonical_location_evidence',(select coalesce(jsonb_agg(to_jsonb(x) order by x.itemcode_key,x.locationcode_key),'[]'::jsonb) from app_sync_private.inventory_location_evidence_v1 x where x.source_unique_id=p.canonical_unique_id),
      'alias_location_evidence',(select coalesce(jsonb_agg(to_jsonb(x) order by x.itemcode_key,x.locationcode_key),'[]'::jsonb) from app_sync_private.inventory_location_evidence_v1 x where x.source_unique_id=p.alias_unique_id),
      'canonical_sales_office',(select coalesce(jsonb_agg(to_jsonb(x) order by x.unique_id),'[]'::jsonb) from public.ph_sales_office x where x.unique_id=p.canonical_unique_id),
      'alias_sales_office',(select coalesce(jsonb_agg(to_jsonb(x) order by x.unique_id),'[]'::jsonb) from public.ph_sales_office x where x.unique_id=p.alias_unique_id),
      'canonical_assignment',(select to_jsonb(x) from public.ph_inventory_row_assignments x where x.master_unique_id=p.canonical_unique_id),
      'alias_assignment',(select to_jsonb(x) from public.ph_inventory_row_assignments x where x.master_unique_id=p.alias_unique_id),
      'canonical_crop',(select to_jsonb(x) from public.ph_crop_roll_drive_rows x where x.unique_id=p.canonical_unique_id),
      'alias_crop',(select to_jsonb(x) from public.ph_crop_roll_drive_rows x where x.unique_id=p.alias_unique_id)
    )
  from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
  on conflict(alias_unique_id) do nothing;

  if exists(select 1 from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
    where not exists(select 1 from private.ph_master_identity_alias_repair_audit_v2397 a
      where a.alias_unique_id=p.alias_unique_id and a.canonical_unique_id=p.canonical_unique_id
        and a.source_stage_id=p.stage_id and a.source_values=p.source_values)) then
    raise exception 'V2397_MASTER_ALIAS_AUDIT_SNAPSHOT_MISSING';
  end if;

  if target_count>0 then
    perform 1 from public.ph_master_inventory m
      join pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
        on m.unique_id in(p.canonical_unique_id,p.alias_unique_id)
      order by m.unique_id for update of m;

    -- The candidate/audit snapshot was collected before row locks. Revalidate
    -- the exact rows and edit ledgers after locking, before applying staged data.
    if exists(select 1 from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      where (select to_jsonb(m) from public.ph_master_inventory m where m.unique_id=p.canonical_unique_id)
          is distinct from p.canonical_master
        or (select to_jsonb(m) from public.ph_master_inventory m where m.unique_id=p.alias_unique_id)
          is distinct from p.alias_master
        or (select coalesce(jsonb_agg(to_jsonb(x) order by x.field_name),'[]'::jsonb)
            from app_sync_private.inventory_live_overrides_v1 x where x.canonical_unique_id=p.canonical_unique_id)
          is distinct from (select a.related_rows from private.ph_master_identity_alias_repair_audit_v2397 a where a.alias_unique_id=p.alias_unique_id)->'canonical_live_overrides'
        or (select coalesce(jsonb_agg(to_jsonb(x) order by x.field_name),'[]'::jsonb)
            from app_sync_private.inventory_live_overrides_v1 x where x.canonical_unique_id=p.alias_unique_id)
          is distinct from (select a.related_rows from private.ph_master_identity_alias_repair_audit_v2397 a where a.alias_unique_id=p.alias_unique_id)->'alias_live_overrides'
        or (select coalesce(jsonb_agg(to_jsonb(x) order by x.field_name),'[]'::jsonb)
            from app_sync_private.ph_master_inventory_item6_edits_v7 x where x.canonical_unique_id=p.canonical_unique_id)
          is distinct from (select a.related_rows from private.ph_master_identity_alias_repair_audit_v2397 a where a.alias_unique_id=p.alias_unique_id)->'canonical_item6_edits'
        or (select coalesce(jsonb_agg(to_jsonb(x) order by x.field_name),'[]'::jsonb)
            from app_sync_private.ph_master_inventory_item6_edits_v7 x where x.canonical_unique_id=p.alias_unique_id)
          is distinct from (select a.related_rows from private.ph_master_identity_alias_repair_audit_v2397 a where a.alias_unique_id=p.alias_unique_id)->'alias_item6_edits'
        or (select coalesce(jsonb_agg(to_jsonb(x) order by x.season),'[]'::jsonb)
            from app_sync_private.inventory_season_stock_overrides_v1 x
            where x.itemcode=p.canonical_itemcode and x.pending
              and x.season=private.inventory_stock_season_v1(p.canonical_lotcode,p.canonical_season))
          is distinct from (select a.related_rows from private.ph_master_identity_alias_repair_audit_v2397 a where a.alias_unique_id=p.alias_unique_id)->'canonical_season_stock_overrides'
        or coalesce((select to_jsonb(x) from app_sync_private.ph_master_inventory_app_edits x where x.canonical_unique_id=p.canonical_unique_id),'null'::jsonb)
          is distinct from (select a.related_rows from private.ph_master_identity_alias_repair_audit_v2397 a where a.alias_unique_id=p.alias_unique_id)->'canonical_priority_edits'
        or coalesce((select to_jsonb(x) from app_sync_private.ph_master_inventory_app_edits x where x.canonical_unique_id=p.alias_unique_id),'null'::jsonb)
          is distinct from (select a.related_rows from private.ph_master_identity_alias_repair_audit_v2397 a where a.alias_unique_id=p.alias_unique_id)->'alias_priority_edits') then
      raise exception 'V2397_MASTER_ALIAS_LOCKED_SNAPSHOT_CHANGED';
    end if;

    execute 'set local session_replication_role = replica';

    select string_agg(format('%1$I=(jsonb_populate_record(live,p.merge_values)).%1$I',k.field_name),',' order by k.field_name)
      into set_list
    from (select distinct keys.field_name from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      cross join lateral jsonb_object_keys(p.merge_values) as keys(field_name)
      join pg_attribute a on a.attrelid='public.ph_master_inventory'::regclass
        and a.attname=keys.field_name and a.attnum>0 and not a.attisdropped) k;
    if set_list is null then raise exception 'V2397_MASTER_ALIAS_NO_SOURCE_FIELDS'; end if;

    execute 'update public.ph_master_inventory live set '||set_list||
      ' from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p where live.unique_id=p.canonical_unique_id';

    -- The row-assignment ledger is authoritative. Mirror its verified owner onto
    -- the master before normal publication so crop consumers see no owner delta.
    update public.ph_master_inventory live set assignedto=a.assignedto
    from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
    join public.ph_inventory_row_assignments a on a.master_unique_id=p.canonical_unique_id
    where live.unique_id=p.canonical_unique_id;

    insert into app_sync_private.ph_master_inventory_source_baselines(
      canonical_unique_id,lineage_key,priority,holdstopcode,holdstopreason,imported_at,import_run_id
    )
    select p.canonical_unique_id,p.lineage_key,
      case when p.source_values?'priority' then p.source_values->>'priority' else b.priority end,
      case when p.source_values?'holdstopcode' then p.source_values->>'holdstopcode' else b.holdstopcode end,
      case when p.source_values?'holdstopreason' then p.source_values->>'holdstopreason' else b.holdstopreason end,
      p.stage_created_at,coalesce(b.import_run_id,p.alias_import_run_id)
    from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
    left join app_sync_private.ph_master_inventory_source_baselines b on b.canonical_unique_id=p.alias_unique_id
    on conflict(canonical_unique_id) do update set
      lineage_key=excluded.lineage_key,priority=excluded.priority,holdstopcode=excluded.holdstopcode,
      holdstopreason=excluded.holdstopreason,imported_at=excluded.imported_at,import_run_id=excluded.import_run_id;

    insert into app_sync_private.ph_master_inventory_item6_source_v7(
      canonical_unique_id,stable_identity_key,field_values,imported_at,import_run_id
    )
    select p.canonical_unique_id,p.stable_identity_key,
      coalesce(c.field_values,'{}'::jsonb)||coalesce(a.field_values,'{}'::jsonb)||
        coalesce((select jsonb_object_agg(k.key,p.source_values->k.key) from jsonb_object_keys(p.source_values) k(key)
          where k.key=any(p.source_raw_fields) and k.key=any(array['locationnote','locationptn1','desigitem','desigcust','desigloc',
            'pullerresponsibility','oversellpercentage','salesnote','suspend']::text[])),'{}'::jsonb),
      p.stage_created_at,coalesce(a.import_run_id,p.alias_import_run_id)
    from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
    left join app_sync_private.ph_master_inventory_item6_source_v7 c on c.canonical_unique_id=p.canonical_unique_id
    left join app_sync_private.ph_master_inventory_item6_source_v7 a on a.canonical_unique_id=p.alias_unique_id
    on conflict(canonical_unique_id) do update set
      stable_identity_key=excluded.stable_identity_key,field_values=excluded.field_values,
      imported_at=excluded.imported_at,import_run_id=excluded.import_run_id;

    insert into app_sync_private.ph_master_bulk_import_source_v1(
      canonical_unique_id,source_unique_id,source_hash,import_run_id
    )
    select p.canonical_unique_id,p.alias_unique_id,p.staged_source_hash,p.alias_import_run_id
    from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
    on conflict(canonical_unique_id) do update set
      source_unique_id=excluded.source_unique_id,source_hash=excluded.source_hash,
      import_run_id=excluded.import_run_id,updated_at=clock_timestamp();

    insert into app_sync_private.ph_master_inventory_item6_aliases_v7(imported_unique_id,canonical_unique_id,stable_identity_key)
    select alias_unique_id,canonical_unique_id,stable_identity_key
    from pg_temp.ph_master_identity_alias_repair_pairs_v2397
    on conflict(imported_unique_id) do update set
      canonical_unique_id=excluded.canonical_unique_id,stable_identity_key=excluded.stable_identity_key;

    delete from public.ph_inventory_row_assignments a using pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      where a.master_unique_id=p.alias_unique_id;
    delete from public.ph_crop_roll_drive_rows c using pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      where c.unique_id=p.alias_unique_id and c.master_unique_id=p.alias_unique_id;
    update app_sync_private.inventory_location_evidence_v1 e
      set source_unique_id=p.canonical_unique_id
      from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      where e.source_unique_id=p.alias_unique_id;
    update public.ph_sales_office alias_sales set unique_id=p.canonical_unique_id
      from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      where alias_sales.unique_id=p.alias_unique_id
        and not exists(select 1 from public.ph_sales_office canonical_sales where canonical_sales.unique_id=p.canonical_unique_id);
    delete from public.ph_sales_office alias_sales using pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      where alias_sales.unique_id=p.alias_unique_id
        and exists(select 1 from public.ph_sales_office canonical_sales where canonical_sales.unique_id=p.canonical_unique_id
          and to_jsonb(canonical_sales)-'unique_id'=to_jsonb(alias_sales)-'unique_id');
    delete from public.ph_master_inventory m using pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      where m.unique_id=p.alias_unique_id;
    delete from app_sync_private.ph_master_inventory_source_baselines b using pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      where b.canonical_unique_id=p.alias_unique_id;
    delete from app_sync_private.ph_master_inventory_item6_source_v7 i using pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      where i.canonical_unique_id=p.alias_unique_id;
    delete from app_sync_private.ph_master_bulk_import_source_v1 b using pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      where b.canonical_unique_id=p.alias_unique_id;

    execute format('set local session_replication_role = %L',original_replication_role);
    restored_role:=current_setting('session_replication_role');
    if restored_role is distinct from original_replication_role then
      raise exception 'V2397_MASTER_ALIAS_REPLICATION_ROLE_NOT_RESTORED';
    end if;

    update public.ph_master_inventory m set last_updated=clock_timestamp()
    from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
    where m.unique_id=p.canonical_unique_id;

    -- Publish the UID-only sales-office remap through its existing revision and
    -- live-event triggers without changing workflow fields or timestamps.
    update public.ph_sales_office s set unique_id=s.unique_id
    from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
    where s.unique_id=p.canonical_unique_id and (select a.related_rows from private.ph_master_identity_alias_repair_audit_v2397 a where a.alias_unique_id=p.alias_unique_id)->'alias_sales_office'<>'[]'::jsonb;

    if exists(select 1 from pg_temp.ph_master_identity_alias_repair_pairs_v2397 p
      where exists(select 1 from public.ph_master_inventory m where m.unique_id=p.alias_unique_id)
        or not exists(select 1 from public.ph_master_inventory m where m.unique_id=p.canonical_unique_id)
        or exists(select 1 from public.ph_inventory_row_assignments a where a.master_unique_id=p.alias_unique_id)
        or exists(select 1 from public.ph_crop_roll_drive_rows c where c.unique_id=p.alias_unique_id)
        or exists(select 1 from public.ph_sales_office s where s.unique_id=p.alias_unique_id)
        or exists(select 1 from app_sync_private.inventory_location_evidence_v1 e where e.source_unique_id=p.alias_unique_id)
        or not exists(select 1 from public.ph_crop_roll_drive_rows c where c.unique_id=p.canonical_unique_id)
        or not exists(select 1 from app_sync_private.ph_master_inventory_item6_aliases_v7 a
          where a.imported_unique_id=p.alias_unique_id and a.canonical_unique_id=p.canonical_unique_id)
        or exists(select 1 from app_sync_private.ph_master_inventory_item6_aliases_v7 a
          where a.canonical_unique_id=p.alias_unique_id and a.imported_unique_id<>p.alias_unique_id)
        or exists(select 1 from app_sync_private.inventory_live_overrides_v1 e
          where e.canonical_unique_id=p.canonical_unique_id and e.pending
            and (to_jsonb((select m from public.ph_master_inventory m where m.unique_id=p.canonical_unique_id))->e.field_name
              is distinct from p.canonical_master->e.field_name))) then
      raise exception 'V2397_MASTER_ALIAS_REPAIR_POSTCONDITION_FAILED';
    end if;
  end if;
end
$repair_master_identity_aliases$;

notify pgrst,'reload schema';
commit;
