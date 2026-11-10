begin;
set local lock_timeout='4s';
set local statement_timeout='15s';

-- Completed history canonicalizes every insert/update as completed. A draft
-- receipt comes from the pending row and never writes the completed archive.
do $pending$
declare
  definition text := pg_get_functiondef('public.save_request_work_v1_pre_state_machine_v2359(text,bigint,jsonb,boolean)'::regprocedure);
  pending_write text := '  else'||chr(10)||
    '    perform private.upsert_request_history(request_id, ''updated'', ''not_queued'', false);'||chr(10);
  completion_write text := 'perform private.upsert_request_history(request_id, ''completed'', ''pending'', false);';
begin
  if strpos(definition,completion_write)=0
    or strpos(definition,pending_write)<=strpos(definition,completion_write)
    or length(definition)-length(replace(definition,pending_write,''))<>length(pending_write) then
    raise exception 'REQUEST_AUTOSAVE_HISTORY_ANCHOR_MISSING';
  end if;
  execute replace(definition,pending_write,'');
end
$pending$;
commit;
