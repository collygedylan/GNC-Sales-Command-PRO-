begin;
set local lock_timeout='1500ms';
set local statement_timeout='30s';

-- pg_cron serializes ticks of one job, but logical slot creation can wait
-- behind even one long publisher transaction. Set the deadline before SELECT.
create or replace function private.schedule_erp_stage_publication_v3057(p_stage_id uuid)
returns bigint language sql set search_path='' as $schedule$
  select cron.schedule('agdata-erp-publication-'||p_stage_id,'2 seconds',format(
    'begin; set local statement_timeout = %L; set local lock_timeout = %L; select private.run_erp_stage_publication_v3042(%L::uuid); commit',
    case when stage.dataset_key='drive_around' then '8s' else '120s' end,
    case when stage.dataset_key='drive_around' then '750ms' else '15s' end, p_stage_id))
  from private.fast_erp_stage_runs_v1 stage where stage.stage_id=p_stage_id;
$schedule$;
revoke all on function private.schedule_erp_stage_publication_v3057(uuid) from public,anon,authenticated,service_role;
commit;
