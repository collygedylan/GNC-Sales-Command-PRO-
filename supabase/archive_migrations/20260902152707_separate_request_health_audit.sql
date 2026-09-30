begin;

-- The hosted probe already calls get_hosted_health_snapshot immediately after
-- bounded maintenance.  Avoid running the same multi-table health audit inside
-- this eight-second RPC transaction; keep assignment reconciliation and AV
-- expiry here, then execute the audit through its dedicated service-only RPC.
create or replace function public.run_request_integrity_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_result jsonb;
  expired_count integer;
  maintenance_status text;
begin
  assignment_result := public.reconcile_eval_itemcodes();
  expired_count := private.expire_shared_av_results();
  maintenance_status := coalesce(assignment_result->>'status', 'completed');

  return jsonb_strip_nulls(jsonb_build_object(
    'status', maintenance_status,
    'errorCode', case when maintenance_status = 'deferred' then 'MAINTENANCE_DEFERRED' end,
    'assignments', assignment_result,
    'expired_av_rows', expired_count,
    'health', jsonb_build_object(
      'status', 'delegated',
      'operation', 'get_hosted_health_snapshot'
    )
  ));
end;
$$;

revoke all on function public.run_request_integrity_maintenance()
  from public, anon, authenticated;
grant execute on function public.run_request_integrity_maintenance()
  to service_role;

notify pgrst, 'reload schema';

commit;
