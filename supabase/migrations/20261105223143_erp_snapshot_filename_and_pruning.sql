-- Publish actual snapshot membership even when the business-field hash is unchanged.
-- Preserve exact-row app evidence, active Reclass movement balances, and unfinished Suspend work.
SET LOCAL lock_timeout = '5s';
DO $repair$ DECLARE definition text; BEGIN
  definition:=pg_get_functiondef('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure);
  IF strpos(definition,$before$    where coalesce(live.date_completed,live.eval_task_completed_at,live.photo_date) is null
      and coalesce(nullif(btrim(live.photo_link),''),nullif(btrim(live.photo_name),''),
        nullif(btrim(live.photo_url),''),nullif(btrim(live.spec),''),nullif(btrim(live.caliper),''),
        nullif(btrim(live.av_note),''),nullif(btrim(live.pic_note),''),nullif(btrim(live.pick_note),''),
        nullif(btrim(live.sales_note),''),nullif(btrim(live.match),''),nullif(btrim(live.loc_match_qty),''),
        nullif(btrim(live.eval_task_status),''),nullif(btrim(live.eval_task_result_note),''),
        nullif(btrim(live.dock_spec),''),nullif(btrim(live.dock_caliper),''),nullif(btrim(live.dock_note),''),
        nullif(btrim(live.dock_photo_link),''),nullif(btrim(live.flyer_photo_link),'')) is null
      and nullif(live.photos,'[]'::jsonb) is null and live.loc_photo_match is null and live.loc_match_pct is null
$before$)=0 THEN RAISE EXCEPTION 'ERP_SNAPSHOT_PATCH_ANCHOR_MISSING'; END IF;
  EXECUTE replace(definition,$before$    where coalesce(live.date_completed,live.eval_task_completed_at,live.photo_date) is null
      and coalesce(nullif(btrim(live.photo_link),''),nullif(btrim(live.photo_name),''),
        nullif(btrim(live.photo_url),''),nullif(btrim(live.spec),''),nullif(btrim(live.caliper),''),
        nullif(btrim(live.av_note),''),nullif(btrim(live.pic_note),''),nullif(btrim(live.pick_note),''),
        nullif(btrim(live.sales_note),''),nullif(btrim(live.match),''),nullif(btrim(live.loc_match_qty),''),
        nullif(btrim(live.eval_task_status),''),nullif(btrim(live.eval_task_result_note),''),
        nullif(btrim(live.dock_spec),''),nullif(btrim(live.dock_caliper),''),nullif(btrim(live.dock_note),''),
        nullif(btrim(live.dock_photo_link),''),nullif(btrim(live.flyer_photo_link),'')) is null
      and nullif(live.photos,'[]'::jsonb) is null and live.loc_photo_match is null and live.loc_match_pct is null
$before$,$after$    where not exists (select 1 from app_sync_private.ph_master_inventory_app_edits e where e.canonical_unique_id=live.unique_id and e.updated_at>=date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago')
      and not exists (select 1 from app_sync_private.inventory_live_overrides_v1 e where e.canonical_unique_id=live.unique_id and nullif(btrim(e.updated_by::text),'') is not null and e.updated_at>=date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago')
      and not exists (select 1 from app_sync_private.inventory_location_evidence_v1 e where e.source_unique_id=live.unique_id and nullif(btrim(e.updated_by::text),'') is not null and e.updated_at>=date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago')
      and not exists (select 1 from public.ph_productivity_history e where e.source_table in ('ph_master_inventory','public.ph_master_inventory') and e.source_unique_id=live.unique_id and e.completed_at>=date_trunc('day',statement_timestamp() at time zone 'America/Chicago') at time zone 'America/Chicago')
$after$);
END $repair$;
DO $repair$ DECLARE definition text; BEGIN
  definition:=pg_get_functiondef('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure);
  IF strpos(definition,$before$  touched_ids := touched_ids || batch_touched;
  if cardinality(touched_ids) > 0 then$before$)=0 THEN RAISE EXCEPTION 'ERP_SNAPSHOT_PATCH_ANCHOR_MISSING'; END IF;
  EXECUTE replace(definition,$before$  touched_ids := touched_ids || batch_touched;
  if cardinality(touched_ids) > 0 then$before$,$after$  -- Filename is snapshot membership metadata, not a business-field source hash.
  -- Hash-identical rows and retained app/Reclass rows still belong to this publication.
  if (select count(distinct nullif(btrim(filename),'')) from pg_temp.ph_master_bulk_stage_v1)=1 then
    update public.ph_master_inventory live
    set filename=(select filename from pg_temp.ph_master_bulk_stage_v1 where nullif(btrim(filename),'') is not null limit 1)
    where live.filename is distinct from (select filename from pg_temp.ph_master_bulk_stage_v1 where nullif(btrim(filename),'') is not null limit 1);
  end if;
  touched_ids := touched_ids || batch_touched;
  if cardinality(touched_ids) > 0 then$after$);
END $repair$;
DO $repair$ DECLARE definition text; BEGIN
  definition:=pg_get_functiondef('public.finalize_master_snapshot_stage_v2374_base(uuid,uuid,text)'::regprocedure);
  IF strpos(definition,$before$      case when f.column_name = any(app_owned) then$before$)=0 THEN RAISE EXCEPTION 'ERP_SNAPSHOT_PATCH_ANCHOR_MISSING'; END IF;
  EXECUTE replace(definition,$before$      case when f.column_name = any(app_owned) then$before$,$after$      case when f.column_name = 'filename' then 'filename = excluded.filename'
      when f.column_name = any(app_owned) then$after$);
END $repair$;
DO $repair$ DECLARE definition text; BEGIN
  definition:=pg_get_functiondef('private.fast_ingest_snapshot_v2369(regclass,jsonb,text[],boolean)'::regprocedure);
  IF strpos(definition,$before$p_table,stage_name,case when p_table='public.ph_soc_master'::regclass then ' and not private.soc_tag_has_saved_work_v23188(to_jsonb(target))' else '' end);$before$)=0 THEN RAISE EXCEPTION 'ERP_SNAPSHOT_PATCH_ANCHOR_MISSING'; END IF;
  EXECUTE replace(definition,$before$p_table,stage_name,case when p_table='public.ph_soc_master'::regclass then ' and not private.soc_tag_has_saved_work_v23188(to_jsonb(target))' else '' end);$before$,$after$p_table,stage_name,(case when p_table='public.ph_soc_master'::regclass then ' and not private.soc_tag_has_saved_work_v23188(to_jsonb(target))' else '' end)
      || format(' and not exists(select 1 from public.ph_productivity_history e where e.source_table in (%L,%L) and e.source_unique_id=target.unique_id and e.completed_at>=%s)',p_table::text,'public.'||p_table::text,'date_trunc(''day'',statement_timestamp() at time zone ''America/Chicago'') at time zone ''America/Chicago''')
      || case when p_table='public.ph_soc_master'::regclass then ' and not exists(select 1 from suspend_tag_private.workflows w where w.source_uid=target.unique_id and w.completed_at>=date_trunc(''day'',statement_timestamp() at time zone ''America/Chicago'') at time zone ''America/Chicago'')' else '' end);$after$);
END $repair$;
DO $repair$ DECLARE definition text; BEGIN
  definition:=pg_get_functiondef('private.fast_ingest_snapshot_v2369(regclass,jsonb,text[],boolean)'::regprocedure);
  IF strpos(definition,$before$  return jsonb_build_object('source_rows'$before$)=0 THEN RAISE EXCEPTION 'ERP_SNAPSHOT_PATCH_ANCHOR_MISSING'; END IF;
  EXECUTE replace(definition,$before$  return jsonb_build_object('source_rows'$before$,$after$  if p_table in ('public.ph_soc_master'::regclass,'public.ph_reserves'::regclass) and 'filename'=any(columns) then
    execute format('update %s target set filename=(select filename from %I limit 1) where target.filename is distinct from (select filename from %I limit 1)',p_table,stage_name,stage_name);
  end if;
  return jsonb_build_object('source_rows'$after$);
END $repair$;
