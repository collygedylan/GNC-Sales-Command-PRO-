begin;
set local statement_timeout = '5s';
set local lock_timeout = '1s';

create function private.erp_manual_scan_restartable_v3064(
  p_status jsonb, p_started timestamptz, p_updated timestamptz, p_now timestamptz
) returns boolean language sql stable set search_path = '' as $restart$
  select coalesce(p_status->>'currentStage', '') in ('queued', 'scanning', 'drive')
    and nullif(p_status#>'{continuationCursor,fileContinuation}', 'null'::jsonb) is null
    and coalesce(p_status#>>'{sourceProgress,drive,stage}', 'checking') in ('queued', 'checking')
    and private.erp_sync_recovery_due_v3044(p_status, p_started, p_updated, p_now)
$restart$;
revoke all on function private.erp_manual_scan_restartable_v3064(jsonb,timestamptz,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;

do $claim$
declare
  definition text := pg_get_functiondef('public.claim_erp_sync_job_v2(text,text,boolean)'::regprocedure);
  anchor text := 'if not coalesce(p_force_restart,false) then';
begin
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'ERP_MANUAL_START_GUARD_CHANGED';
  end if;
  execute replace(definition, anchor, $guard$if not coalesce(p_force_restart,false)
      or not private.erp_manual_scan_restartable_v3064(job.status, job.started_at, job.updated_at, stamp) then$guard$);
end
$claim$;
commit;
