\set ON_ERROR_STOP on
begin;
insert into cron.job(jobid,jobname,schedule,command,nodename,nodeport,database,username,active)
values(987654321,'agdata-erp-publication-00000000-0000-0000-0000-000000000099','* * * * *',
  'select 1','localhost',5432,'postgres','postgres',true);
set local role postgres;
create temporary table idle_durations(ms double precision) on commit drop;
do $fixture$
declare started timestamptz; i integer;
begin
  perform private.run_erp_stage_publication_v3042('00000000-0000-0000-0000-000000000099');
  if exists(select 1 from cron.job where jobid=987654321) then
    raise exception 'stale publication cron was not removed';
  end if;
  for i in 1..100 loop
    started:=clock_timestamp();
    perform private.run_erp_stage_publication_v3042('00000000-0000-0000-0000-000000000099');
    insert into idle_durations values(1000*extract(epoch from clock_timestamp()-started));
  end loop;
end
$fixture$;
select count(*),round(percentile_cont(0.5) within group(order by ms)::numeric,3) p50_ms,
  round(max(ms)::numeric,3) max_ms from idle_durations;
rollback;
