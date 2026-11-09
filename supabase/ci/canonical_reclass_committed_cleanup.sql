-- Dispose of the fixture after the migration confirms all three physical rows.
do $fixture$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or (select count(*) from public.ph_master_inventory where itemcode='006192.010.1'
           and unique_id like 'ci-reclass-committed-%')<>3 then
    raise exception 'CANONICAL_RECLASS_COMMITTED_CLEANUP_PRECONDITION_FAILED';
  end if;
end;
$fixture$;

delete from public.ph_master_inventory where itemcode='006192.010.1' and unique_id in
  ('ci-reclass-committed-f1','ci-reclass-committed-s1','ci-reclass-committed-other');
