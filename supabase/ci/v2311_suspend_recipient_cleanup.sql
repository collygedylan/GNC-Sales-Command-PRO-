-- Remove only disposable fixture identities after the fail-closed migration
-- preflight has been exercised and before later tests create their own actors.
do $$
begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
     or (select count(*) from public.profiles where id in (
       'a9110000-0000-4000-8000-000000000001','a9110000-0000-4000-8000-000000000002',
       'a9110000-0000-4000-8000-000000000003','a9110000-0000-4000-8000-000000000004'))<>4 then
    raise exception 'V2311_SYNTHETIC_RECIPIENT_CLEANUP_PRECONDITION_FAILED';
  end if;
end;
$$;

delete from public.profiles where id in (
  'a9110000-0000-4000-8000-000000000001','a9110000-0000-4000-8000-000000000002',
  'a9110000-0000-4000-8000-000000000003','a9110000-0000-4000-8000-000000000004');
delete from auth.users where id in (
  'a9110000-0000-4000-8000-000000000001','a9110000-0000-4000-8000-000000000002',
  'a9110000-0000-4000-8000-000000000003','a9110000-0000-4000-8000-000000000004');
