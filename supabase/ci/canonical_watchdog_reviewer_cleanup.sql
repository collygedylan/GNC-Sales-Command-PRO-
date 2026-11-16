begin;
do $fixture$
begin
 if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
 or (select count(*) from private.runtime_watchdog_reviewers_v3074 where profile_id in (
 'ad740000-0000-4000-8000-000000000001','ad740000-0000-4000-8000-000000000002','ad740000-0000-4000-8000-000000000003'))<>3 then
 raise exception 'CANONICAL_WATCHDOG_REVIEWER_RECEIPT_CHANGED'; end if;
end $fixture$;
delete from public.profiles where id in (
 'ad740000-0000-4000-8000-000000000001','ad740000-0000-4000-8000-000000000002','ad740000-0000-4000-8000-000000000003');
delete from auth.users where id in (
 'ad740000-0000-4000-8000-000000000001','ad740000-0000-4000-8000-000000000002','ad740000-0000-4000-8000-000000000003');
commit;
