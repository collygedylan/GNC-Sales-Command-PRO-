begin;
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_EXPLICIT_NOTE_ROW_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
end $$;
set local session_replication_role=replica;
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,source,commonname,ptronhand,ptravailable)
values('drive-03695daa254c39fd89a7a4d1a940e3e9','008737.031.1','D.17.000','27.S1','LD','Synthetic Explicit Note','5','4');
insert into public.ph_location_sales_notes(unique_id,itemcode,locationcode,lotcode,source)
values('drive-03695daa254c39fd89a7a4d1a940e3e9','008737.031.1','D.17.000','27.S1','LD');
commit;
