-- Dispose of the fixture only after the exact historical completion was cleared.
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or not exists(select 1 from public.ph_soc_master
       where unique_id='Dock_30-10-0045192-0001-60-007541_031_1-C_15_000-27_F1-10-Breshear_s_Nursery-Breshear_s_Nursery-3DP---'
         and itemcode='007541.031.1' and date_completed is null) then
    raise exception 'CANONICAL_SUSPEND_REOPEN_UNVERIFIED';
  end if;
end;
$fixture$;

delete from public.ph_soc_master
where unique_id='Dock_30-10-0045192-0001-60-007541_031_1-C_15_000-27_F1-10-Breshear_s_Nursery-Breshear_s_Nursery-3DP---'
  and itemcode='007541.031.1' and date_completed is null;
