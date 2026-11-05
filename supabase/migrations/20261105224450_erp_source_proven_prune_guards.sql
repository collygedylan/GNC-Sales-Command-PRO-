-- Only canonical, source-absent pruning bypasses legacy BEFORE DELETE shields.
-- Same-day app edits and pending physical Reclass movements remain protected by the publisher predicate.
SET LOCAL lock_timeout='5s';
DO $repair$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
 IF strpos(definition,$before$  with deleted as (
    delete from public.ph_master_inventory live$before$)=0 THEN RAISE EXCEPTION 'ERP_PRUNE_GUARD_ANCHOR_MISSING'; END IF;
 EXECUTE replace(definition,$before$  with deleted as (
    delete from public.ph_master_inventory live$before$,$after$  alter table public.ph_master_inventory disable trigger aa00_inventory_override_delete;
  alter table public.ph_master_inventory disable trigger aaa_ph_master_inventory_priority_hold_shield_delete;
  alter table public.ph_master_inventory disable trigger aab_ph_master_inventory_item6_guard_v7_delete;
  with deleted as (
    delete from public.ph_master_inventory live$after$);
END $repair$;
DO $repair$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.bulk_import_master_snapshot_v2374_base(uuid,uuid,jsonb,text)'::regprocedure);
 IF strpos(definition,$before$    into deleted_rows, batch_touched from deleted;
$before$)=0 THEN RAISE EXCEPTION 'ERP_PRUNE_GUARD_ANCHOR_MISSING'; END IF;
 EXECUTE replace(definition,$before$    into deleted_rows, batch_touched from deleted;
$before$,$after$    into deleted_rows, batch_touched from deleted;
  alter table public.ph_master_inventory enable trigger aa00_inventory_override_delete;
  alter table public.ph_master_inventory enable trigger aaa_ph_master_inventory_priority_hold_shield_delete;
  alter table public.ph_master_inventory enable trigger aab_ph_master_inventory_item6_guard_v7_delete;
$after$);
END $repair$;
