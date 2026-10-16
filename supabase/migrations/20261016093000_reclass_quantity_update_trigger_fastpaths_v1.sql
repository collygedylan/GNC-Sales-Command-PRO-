begin;

-- Quantity-only Reclass writes do not affect priority/hold shields, Item6
-- protected fields, or inventory lineage. Avoid entering those row triggers
-- unless their inputs changed or the established importer header is present.
-- Importing writes continue through the original trigger functions so all
-- existing fences, aliases, overlays, and reconciliation behavior remain in
-- force.
-- Rollback is data-preserving: replace the split triggers with the original
-- event declarations (priority BEFORE INSERT OR UPDATE OR DELETE; Item6 guard
-- BEFORE UPDATE OR DELETE; Item6 lineage AFTER INSERT OR UPDATE) and restore
-- the three broad, unqualified BEFORE/AFTER UPDATE declarations below. No
-- ledger or master rows are changed by this migration.
drop trigger if exists aaa_ph_master_inventory_priority_hold_shield on public.ph_master_inventory;
create trigger aaa_ph_master_inventory_priority_hold_shield
before update on public.ph_master_inventory
for each row
when (
  coalesce(nullif(current_setting('request.headers', true), '')::jsonb->>'x-gnc-import-run-id', '') <> ''
  or old.unique_id is distinct from new.unique_id
  or old.priority is distinct from new.priority
  or old.holdstopcode is distinct from new.holdstopcode
  or old.holdstopreason is distinct from new.holdstopreason
)
execute function private.guard_ph_master_inventory_priority_hold_v1();

create trigger aaa_ph_master_inventory_priority_hold_shield_insert
before insert on public.ph_master_inventory
for each row execute function private.guard_ph_master_inventory_priority_hold_v1();

create trigger aaa_ph_master_inventory_priority_hold_shield_delete
before delete on public.ph_master_inventory
for each row execute function private.guard_ph_master_inventory_priority_hold_v1();

drop trigger if exists aab_ph_master_inventory_item6_guard_v7 on public.ph_master_inventory;
create trigger aab_ph_master_inventory_item6_guard_v7
before update on public.ph_master_inventory
for each row
when (
  coalesce(nullif(current_setting('request.headers', true), '')::jsonb->>'x-gnc-import-run-id', '') <> ''
  or (old.locationnote, old.locationptn1, old.desigitem, old.desigcust, old.desigloc,
      old.pullerresponsibility, old.oversellpercentage, old.salesnote, old.suspend)
     is distinct from
     (new.locationnote, new.locationptn1, new.desigitem, new.desigcust, new.desigloc,
      new.pullerresponsibility, new.oversellpercentage, new.salesnote, new.suspend)
)
execute function private.guard_ph_master_inventory_item6_fields_v7();

create trigger aab_ph_master_inventory_item6_guard_v7_delete
before delete on public.ph_master_inventory
for each row execute function private.guard_ph_master_inventory_item6_fields_v7();

drop trigger if exists zzz_ph_master_inventory_item6_lineage_v7 on public.ph_master_inventory;
create trigger zzz_ph_master_inventory_item6_lineage_v7
after insert on public.ph_master_inventory
for each row execute function private.refresh_ph_master_inventory_item6_lineage_v7();

create trigger zzz_ph_master_inventory_item6_lineage_v7_update
after update on public.ph_master_inventory
for each row
when (
  coalesce(nullif(current_setting('request.headers', true), '')::jsonb->>'x-gnc-import-run-id', '') <> ''
  or (old.unique_id, old.warehouseid, old.warehousei, old.itemcode, old.contsize,
      old.locationcode, old.lotcode, old.source, old.desigitem, old.desigcust, old.desigloc)
     is distinct from
     (new.unique_id, new.warehouseid, new.warehousei, new.itemcode, new.contsize,
      new.locationcode, new.lotcode, new.source, new.desigitem, new.desigcust, new.desigloc)
)
execute function private.refresh_ph_master_inventory_item6_lineage_v7();

-- These established handlers read and react only to their named columns.
drop trigger if exists trigger_inventory_changes on public.ph_master_inventory;
create trigger trigger_inventory_changes
before update on public.ph_master_inventory
for each row
when (old.priority is distinct from new.priority or old.holdstopcode is distinct from new.holdstopcode)
execute function public.check_inventory_changes_and_reset();

drop trigger if exists sync_season_sales_av_note_reset on public.ph_master_inventory;
create trigger sync_season_sales_av_note_reset
after update on public.ph_master_inventory
for each row
when (old.priority is distinct from new.priority or old.holdstopcode is distinct from new.holdstopcode
  or old.av_rule_last_cleared_at is distinct from new.av_rule_last_cleared_at)
execute function private.sync_season_sales_av_note_reset_v1();

drop trigger if exists trigger_new_assignment on public.ph_master_inventory;
create trigger trigger_new_assignment
after update on public.ph_master_inventory
for each row when (old.assignedto is distinct from new.assignedto and new.assignedto is not null)
execute function public.notify_new_assignment();

commit;
