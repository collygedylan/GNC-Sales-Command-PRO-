begin;
set local statement_timeout = '30s';
set local lock_timeout = '1500ms';

-- Patch the installed owner rather than replacing its publication, retry,
-- receipt, or per-stage cleanup logic. Fail closed if its entry point changed.
do $single_flight$
declare
  definition text := pg_get_functiondef('private.run_erp_stage_publication_v3042(uuid)'::regprocedure);
  entry text := E'begin\n  select * into job from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id for update skip locked;';
  guard text := E'begin\n  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(''agdata:erp-publication-worker:v3078'',0)) then return; end if;\n  select * into job from private.erp_stage_publication_jobs_v3042 where stage_id=p_stage_id for update skip locked;';
begin
  if strpos(definition,guard)>0 then return; end if;
  if cardinality(string_to_array(definition,entry))<>2 then
    raise exception 'ERP_PUBLICATION_WORKER_ENTRY_CHANGED';
  end if;
  execute replace(definition,entry,guard);
end
$single_flight$;
commit;
