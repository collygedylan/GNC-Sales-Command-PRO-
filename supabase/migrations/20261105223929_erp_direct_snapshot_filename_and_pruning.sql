-- The fast ERP RPC uses the direct publisher; keep its membership contract aligned with staged publication.
SET LOCAL lock_timeout='5s';
DO $repair$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
 IF strpos(definition,$before$    where coalesce(live.date_completed,live.eval_task_completed_at,live.photo_date) is null
      and coalesce(nullif(btrim(live.photo_link),''),nullif(btrim(live.photo_name),''),
        nullif(btrim(live.photo_url),''),nullif(btrim(live.spec),''),nullif(btrim(live.caliper),''),
        nullif(btrim(live.av_note),''),nullif(btrim(live.pic_note),''),nullif(btrim(live.pick_note),''),
        nullif(btrim(live.sales_note),''),nullif(btrim(live.match),''),nullif(btrim(live.loc_match_qty),''),
        nullif(btrim(live.eval_task_status),''),nullif(btrim(live.eval_task_result_note),''),
        nullif(btrim(live.dock_spec),''),nullif(btrim(live.dock_caliper),''),nullif(btrim(live.dock_note),''),
        nullif(btrim(live.dock_photo_link),''),nullif(btrim(live.flyer_photo_link),'')) is null
      and nullif(live.photos,'[]'::jsonb) is null and live.loc_photo_match is null and live.loc_match_pct is null
$before$)=0 THEN RAISE EXCEPTION 'ERP_DIRECT_PATCH_ANCHOR_MISSING'; END IF;
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
 definition:=pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
 IF strpos(definition,$before$  touched_ids := touched_ids || batch_touched;
  if cardinality(touched_ids) > 0 then$before$)=0 THEN RAISE EXCEPTION 'ERP_DIRECT_PATCH_ANCHOR_MISSING'; END IF;
 EXECUTE replace(definition,$before$  touched_ids := touched_ids || batch_touched;
  if cardinality(touched_ids) > 0 then$before$,$after$  -- Filename is snapshot membership metadata, not a business-field source hash.
  -- Hash-identical rows and retained app/Reclass rows still belong to this publication.
  if (select count(distinct nullif(btrim(filename),'')) from pg_temp.ph_master_bulk_stage_v1)=1 then
    alter table public.ph_master_inventory disable trigger user;
    update public.ph_master_inventory live
    set filename=(select filename from pg_temp.ph_master_bulk_stage_v1 where nullif(btrim(filename),'') is not null limit 1)
    where live.filename is distinct from (select filename from pg_temp.ph_master_bulk_stage_v1 where nullif(btrim(filename),'') is not null limit 1);
    alter table public.ph_master_inventory enable trigger user;
  end if;
  touched_ids := touched_ids || batch_touched;
  if cardinality(touched_ids) > 0 then$after$);
END $repair$;
DO $repair$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
 IF strpos(definition,$before$      case when f.column_name = any(app_owned) then$before$)=0 THEN RAISE EXCEPTION 'ERP_DIRECT_PATCH_ANCHOR_MISSING'; END IF;
 EXECUTE replace(definition,$before$      case when f.column_name = any(app_owned) then$before$,$after$      case when f.column_name = 'filename' then 'filename = excluded.filename'
      when f.column_name = any(app_owned) then$after$);
END $repair$;
