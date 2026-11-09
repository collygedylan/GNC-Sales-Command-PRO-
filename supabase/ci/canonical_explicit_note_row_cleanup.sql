begin;
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_EXPLICIT_NOTE_CLEANUP_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
  if not exists (select 1 from public.ph_master_inventory m join public.ph_location_sales_notes n using(unique_id)
    where m.unique_id='drive-03695daa254c39fd89a7a4d1a940e3e9'
      and m.commonname='Synthetic Explicit Note'
      and m.av_note='SPEC - 12-14" H' and m.av_note=n.av_note and n.spec='12-14" H') then
    raise exception 'CANONICAL_EXPLICIT_NOTE_RECEIPT_MISMATCH';
  end if;
end $$;
set local session_replication_role=replica;
delete from public.ph_location_sales_notes where unique_id='drive-03695daa254c39fd89a7a4d1a940e3e9';
delete from app_sync_private.inventory_location_evidence_v1 where source_unique_id='drive-03695daa254c39fd89a7a4d1a940e3e9';
delete from public.ph_master_inventory where unique_id='drive-03695daa254c39fd89a7a4d1a940e3e9';
commit;
