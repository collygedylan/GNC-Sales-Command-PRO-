begin;

-- Preserve the browser's bounded Request directory projection. The raw
-- workbook payload is available to the trusted importer and manager RPCs.
revoke select on public.ph_customer_consignee_sales_reps from public,anon,authenticated;
revoke select(raw_data) on public.ph_customer_consignee_sales_reps from public,anon,authenticated;
grant select(unique_id,customeridentityid,customername,customerstatus,consigneeid,consigneename,
  consigneestatus,salesrepid,salesrepname,territorycode,territorydesc,updated_at)
on public.ph_customer_consignee_sales_reps to anon,authenticated;

create function pg_temp.repair_agdata3039(target regprocedure, prior text, replacement text)
returns void language plpgsql as $function$
declare definition text:=pg_get_functiondef(target);
begin
  if strpos(definition,replacement)>0 then
    if cardinality(string_to_array(definition,replacement))<>2 or strpos(replace(definition,replacement,''),prior)>0 then
      raise exception 'AGDATA3039_SQL_REPAIR_DUPLICATE_ANCHOR: %',target;
    end if;
    return;
  end if;
  if cardinality(string_to_array(definition,prior))<>2 then
    raise exception 'AGDATA3039_SQL_REPAIR_ANCHOR_CHANGED: %',target;
  end if;
  execute replace(definition,prior,replacement);
end
$function$;

-- Retain per-field override receipts. The two fixed stage columns can be
-- written together, once per matching physical row, after both receipts.
select pg_temp.repair_agdata3039('private.apply_inventory_live_overrides_bulk_v1(uuid)',
$prior$    execute format(
      'update pg_temp.ph_master_bulk_stage_v1 stage set %1$I=(jsonb_populate_record(stage,jsonb_build_object($1,case when $1=''s_lts'' then season_stock.open_stock::text else season_stock.season_oh::text end))).%1$I from pg_temp.ph_master_bulk_map_v1 mapped,app_sync_private.inventory_season_stock_overrides_v1 season_stock where mapped.row_number=stage.row_number and mapped.candidate_count<=1 and season_stock.itemcode=stage.itemcode and season_stock.pending and private.inventory_stock_season_v1(stage.lotcode,stage.season)=season_stock.season',
      v_field_name
    ) using v_field_name;
  end loop;$prior$,
$fixed$  end loop;

  update pg_temp.ph_master_bulk_stage_v1 stage set
    s_lts=season_stock.open_stock::text,season_oh=season_stock.season_oh::text
  from pg_temp.ph_master_bulk_map_v1 mapped,app_sync_private.inventory_season_stock_overrides_v1 season_stock
  where mapped.row_number=stage.row_number and mapped.candidate_count<=1
    and season_stock.itemcode=stage.itemcode and season_stock.pending
    and private.inventory_stock_season_v1(stage.lotcode,stage.season)=season_stock.season;$fixed$);

select pg_temp.repair_agdata3039('private.apply_inventory_live_overrides_bulk_v1(uuid)',
$prior$  foreach v_field_name in array array['ptronhand','ptrreviewed','ptravailable'] loop
    execute format('update pg_temp.ph_master_bulk_stage_v1 s set %1$I=(greatest(0,private.inventory_location_evidence_number_v2(s.raw_values->>$1)+private.inventory_location_evidence_number_v2(e.app_override_value#>>''{}'')-private.inventory_location_evidence_number_v2(e.erp_baseline_value#>>''{}'')))::text from pg_temp.ph_master_bulk_map_v1 map join app_sync_private.inventory_live_overrides_v1 e on e.canonical_unique_id=map.canonical_unique_id where map.row_number=s.row_number and map.candidate_count=1 and e.field_name=$1 and e.pending and s.raw_values ? $1 and e.erp_baseline_value is not null',v_field_name) using v_field_name;
    execute format('update app_sync_private.inventory_live_overrides_v1 e set erp_baseline_value=s.raw_values->$1,app_override_value=to_jsonb(s.%1$I),latest_erp_value=s.raw_values->$1 from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 map using(row_number) where map.canonical_unique_id=e.canonical_unique_id and map.candidate_count=1 and e.field_name=$1 and e.pending and s.raw_values ? $1 and e.erp_baseline_value is not null',v_field_name) using v_field_name;
  end loop;$prior$,
$fixed$  with adjusted as materialized (
    select s.row_number,e.canonical_unique_id,e.field_name,s.raw_values->e.field_name next_baseline,
      case when e.field_name in ('ptronhand','ptravailable') and exists(
        select 1 from private.ph_inventory_reclass_movements_v1 movement
        where movement.status='pending' and (
          movement.source_unique_id=e.canonical_unique_id
            and movement.source_before->>'ptronhand'=s.raw_values->>'ptronhand'
            and movement.source_before->>e.field_name=s.raw_values->>e.field_name
          or movement.destination_unique_id=e.canonical_unique_id
            and movement.destination_before->>'ptronhand'=s.raw_values->>'ptronhand'
            and movement.destination_before->>e.field_name=s.raw_values->>e.field_name
        )
      ) then e.app_override_value#>>'{}'
      else greatest(0,private.inventory_location_evidence_number_v2(s.raw_values->>e.field_name)
        +private.inventory_location_evidence_number_v2(e.app_override_value#>>'{}')
        -private.inventory_location_evidence_number_v2(e.erp_baseline_value#>>'{}'))::text end next_value
    from pg_temp.ph_master_bulk_stage_v1 s
    join pg_temp.ph_master_bulk_map_v1 map using(row_number)
    join app_sync_private.inventory_live_overrides_v1 e using(canonical_unique_id)
    where map.candidate_count=1 and e.field_name in ('ptronhand','ptrreviewed','ptravailable')
      and e.pending and s.raw_values ? e.field_name
      and private.inventory_location_evidence_number_v2(e.erp_baseline_value#>>'{}') is not null
      and private.inventory_location_evidence_number_v2(e.app_override_value#>>'{}') is not null
      and private.inventory_location_evidence_number_v2(s.raw_values->>e.field_name) is not null
  ), by_row as (
    select row_number,max(next_value) filter(where field_name='ptronhand') ptronhand,
      max(next_value) filter(where field_name='ptrreviewed') ptrreviewed,
      max(next_value) filter(where field_name='ptravailable') ptravailable
    from adjusted group by row_number
  ), staged as (
    update pg_temp.ph_master_bulk_stage_v1 s set ptronhand=coalesce(a.ptronhand,s.ptronhand),
      ptrreviewed=coalesce(a.ptrreviewed,s.ptrreviewed),ptravailable=coalesce(a.ptravailable,s.ptravailable)
    from by_row a where a.row_number=s.row_number returning s.row_number
  )
  update app_sync_private.inventory_live_overrides_v1 e set erp_baseline_value=a.next_baseline,
    app_override_value=to_jsonb(a.next_value),latest_erp_value=a.next_baseline
  from adjusted a join staged using(row_number)
  where e.canonical_unique_id=a.canonical_unique_id and e.field_name=a.field_name;$fixed$);

-- The proven-ID temp table has exactly one unique constraint.
select pg_temp.repair_agdata3039('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)',
$prior$  on conflict(unique_id) do nothing;
  analyze pg_temp.ph_master_proven_new_ids_v1;$prior$,
$fixed$  on conflict do nothing;
  analyze pg_temp.ph_master_proven_new_ids_v1;$fixed$);

-- Replay the maintained mapping while its exact import fence is still
-- active. A retry of the published receipt has no overlay writes to repeat.
select pg_temp.repair_agdata3039('public.finalize_customer_rep_mapping_import_v2397_base(uuid)',
$prior$  import_result:=app_sync_private.advance_import(p_run_id,'finish');$prior$,
$fixed$  perform sales_private.replay_customer_mapping_rows_v2397();
  import_result:=app_sync_private.advance_import(p_run_id,'finish');$fixed$);

select pg_temp.repair_agdata3039('public.finalize_customer_rep_mapping_import_v1(uuid)',
$prior$declare result jsonb;
begin
  result:=public.finalize_customer_rep_mapping_import_v2397_base(p_run_id);
  perform sales_private.replay_customer_mapping_rows_v2397();
  return result;$prior$,
$fixed$begin
  return public.finalize_customer_rep_mapping_import_v2397_base(p_run_id);$fixed$);

select pg_temp.repair_agdata3039('private.recover_unfulfilled_requests_v1()',
$prior$or nullif(btrim(coalesce(history.date_completed,'')),'') is not null$prior$,
$fixed$or history.date_completed is not null$fixed$);

-- Last-write-wins accepts stale observations, but invalid quantities can
-- never satisfy the movement cap against the currently locked row.
select pg_temp.repair_agdata3039('private.validate_drive_reclass_sheared_v5(jsonb)',
$prior$      if current_oh is null or expected_oh is null or expected_oh < 0 then
        NULL; /* agdata308_reclass_lww: retain current locked row */
      end if;$prior$,
$fixed$      if current_oh is null or expected_oh is null or expected_oh < 0 then
        raise exception using errcode='PT409',message='DRIVE_RECLASS_V5_ORIGINAL_SNAPSHOT_CONFLICT';
      end if;$fixed$);

select pg_temp.repair_agdata3039('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)',
$prior$jsonb_typeof(custom)<>'object' or custom-jsonb_build_object('locationcode',custom->'locationcode','lotcode',custom->'lotcode')<>'{}'::jsonb$prior$,
$fixed$(case when jsonb_typeof(custom)='object' then custom-array['locationcode','lotcode']<>'{}'::jsonb else true end)$fixed$);

do $location_work$
declare definition text:=pg_get_functiondef('public.create_location_work_job_v1(jsonb)'::regprocedure);
begin
  if strpos(definition,'candidate.source_sales_year=work_source_sales_year')>0 then return; end if;
  if cardinality(string_to_array(definition,'candidate.source_sales_year=source_sales_year'))<>2
    or cardinality(string_to_array(definition,'candidate.destination_sales_year=destination_sales_year'))<>2 then
    raise exception 'AGDATA3039_LOCATION_WORK_REPAIR_ANCHOR_CHANGED';
  end if;
  execute regexp_replace(definition,'(?<![.[:alnum:]_])(source_sales_year|destination_sales_year)\M','work_\1','g');
end
$location_work$;

do $aura_soc$
declare definition text:=pg_get_functiondef('public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)'::regprocedure);
begin
  if strpos(definition,'=requested_common_name')>0 then return; end if;
  if cardinality(string_to_array(definition,'=common_name'))<>3 then
    raise exception 'AGDATA3039_AURA_SOC_REPAIR_ANCHOR_CHANGED';
  end if;
  execute regexp_replace(definition,'\mcommon_name\M','requested_common_name','g');
end
$aura_soc$;

select pg_temp.repair_agdata3039('public.ph_prune_supabase_bloat_v1()',
$prior$  if to_regclass('public.ph_erp_sync_runs') is not null then
    execute 'update public.ph_erp_sync_runs set status=''failed'' where status=''running'' and updated_at < now()-interval ''90 seconds''';
    execute 'delete from public.ph_erp_sync_runs where status in (''completed'',''complete'') and updated_at < now()-interval ''14 days'' and id not in (select id from public.ph_erp_sync_runs order by updated_at desc limit 50)';$prior$,
$fixed$  if to_regclass('public.ph_erp_sync_runs') is not null then
    execute format('update %s set status=''failed'' where status=''running'' and updated_at < now()-interval ''90 seconds''',
      to_regclass('public.ph_erp_sync_runs'));
    execute format('delete from %1$s where status in (''completed'',''complete'') and updated_at < now()-interval ''14 days'' and id not in (select id from %1$s order by updated_at desc limit 50)',
      to_regclass('public.ph_erp_sync_runs'));$fixed$);

select pg_temp.repair_agdata3039('public.ph_prune_supabase_bloat_v1()',
$prior$  foreach target in array array['ph_runtime_watchdog_events','app_runtime_watchdog_events','ph_watchdog_events'] loop$prior$,
$fixed$  for target in select unnest(array['ph_runtime_watchdog_events','app_runtime_watchdog_events','ph_watchdog_events']) loop$fixed$);

-- Preserve the complete physical row payload and leave generated SOC fields
-- to PostgreSQL. The writable list is resolved from the actual table shape.
select pg_temp.repair_agdata3039('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)',
$prior$     insert into public.ph_soc_master select (r).* on conflict(unique_id) do update set
       locationcode=excluded.locationcode,lotcode=excluded.lotcode,quantityordered=excluded.quantityordered,
       suspend=excluded.suspend,suspend_to=excluded.suspend_to,suspend_candidate_state=excluded.suspend_candidate_state,
       dock_spec=excluded.dock_spec,dock_caliper=excluded.dock_caliper,av_note=excluded.av_note,
       dock_photo_link=excluded.dock_photo_link,dock_photo_name=excluded.dock_photo_name,
       photo_link=excluded.photo_link,photo_name=excluded.photo_name,photo_url=excluded.photo_url,photos=excluded.photos,
       match=excluded.match,loc_match_qty=excluded.loc_match_qty,date_completed=null,last_updated=excluded.last_updated;$prior$,
$fixed$     declare writable_columns text;
     begin
       select string_agg(quote_ident(attname),',' order by attnum) into strict writable_columns
       from pg_attribute where attrelid='public.ph_soc_master'::regclass and attnum>0
         and not attisdropped and attgenerated='' and attidentity='';
       execute format('insert into public.ph_soc_master(%1$s) select %1$s
         from jsonb_populate_record(null::public.ph_soc_master,$1)
         on conflict(unique_id) do update set
         locationcode=excluded.locationcode,lotcode=excluded.lotcode,quantityordered=excluded.quantityordered,
         suspend=excluded.suspend,suspend_to=excluded.suspend_to,suspend_candidate_state=excluded.suspend_candidate_state,
         dock_spec=excluded.dock_spec,dock_caliper=excluded.dock_caliper,av_note=excluded.av_note,
         dock_photo_link=excluded.dock_photo_link,dock_photo_name=excluded.dock_photo_name,
         photo_link=excluded.photo_link,photo_name=excluded.photo_name,photo_url=excluded.photo_url,photos=excluded.photos,
         match=excluded.match,loc_match_qty=excluded.loc_match_qty,date_completed=null,last_updated=excluded.last_updated',
       writable_columns) using to_jsonb(r);
     end;$fixed$);

drop function pg_temp.repair_agdata3039(regprocedure,text,text);
commit;
