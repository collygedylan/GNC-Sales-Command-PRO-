-- This row exists only within the guarded migration's disposable transaction.
do $fixture$
begin
 if to_regclass('private.ci_schema_workspace_guard') is null then
 raise exception 'CANONICAL_DELIVERY_CRON_FIXTURE_ONLY'; end if;
 if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay')
 or exists(select 1 from cron.job where jobname='gnc-request-delivery-worker') then
 raise exception 'CANONICAL_DELIVERY_CRON_PRECONDITION_CHANGED'; end if;
end $fixture$;
create temporary table ci_delivery_cron_identity(
 production_job_id bigint primary key check(production_job_id=45),jobid bigint not null unique
) on commit drop;
insert into ci_delivery_cron_identity values(45,cron.schedule('gnc-request-delivery-worker','* * * * *',
 'select private.wake_request_delivery_worker_now(''cron'')'));
