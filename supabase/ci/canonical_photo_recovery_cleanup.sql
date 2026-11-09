begin;
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_PHOTO_CLEANUP_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
  if (select count(*) from app_sync_private.inventory_location_evidence_v1
      where itemcode like 'CI312.%' and updated_by='agdata312_calendar_recovery'
        and clear_reason is null and current_photo_match_qty=4)<>16
    or (select count(*) from public.ph_master_inventory where itemcode like 'CI312.%' and
        photos<>'[]'::jsonb and loc_photo_match=4)<>228 then
    raise exception 'CANONICAL_PHOTO_RECOVERY_RECEIPT_MISMATCH';
  end if;
end $$;
set local session_replication_role=replica;
delete from public.ph_location_sales_notes where itemcode like 'CI312.%';
delete from app_sync_private.inventory_location_evidence_v1 where itemcode like 'CI312.%';
delete from public.ph_master_inventory where itemcode like 'CI312.%';
commit;
