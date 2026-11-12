begin;
set local statement_timeout = '30s';
set local lock_timeout = '1500ms';

-- pg_cron raises for an unknown job name; a repeated idle call must not do so.
do $idle_cleanup$
declare
  definition text := pg_get_functiondef('private.run_erp_stage_publication_v3042(uuid)'::regprocedure);
  previous text := 'if not exists(select 1 from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id) then';
  guarded text := 'if not exists(select 1 from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id) and exists(select 1 from cron.job where jobname=job_name) then';
begin
  if strpos(definition,guarded)>0 then return; end if;
  if cardinality(string_to_array(definition,previous))<>2 then
    raise exception 'ERP_PUBLICATION_IDLE_CLEANUP_CHANGED';
  end if;
  execute replace(definition,previous,guarded);
end
$idle_cleanup$;
commit;
