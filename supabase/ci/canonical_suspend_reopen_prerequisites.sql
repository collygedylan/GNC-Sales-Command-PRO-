-- Reproduce the physical row that the historical reopen migration verifies.
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'CANONICAL_SUSPEND_REOPEN_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

insert into public.ph_soc_master(unique_id,itemcode,locationcode,lotcode,suspend,suspend_to,date_completed)
values ('Dock_30-10-0045192-0001-60-007541_031_1-C_15_000-27_F1-10-Breshear_s_Nursery-Breshear_s_Nursery-3DP---',
  '007541.031.1','C.15.000','27.F1','SUSPEND','DC','2026-11-01T00:13:50.696427Z');
