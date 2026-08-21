-- Fast service-only health audit for the five-minute hosted monitor. The
-- heavier ItemCode reconciliation remains in request-integrity maintenance.
create or replace function public.get_hosted_health_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_service_role_request() then
    raise exception using errcode = '42501', message = 'HOSTED_HEALTH_FORBIDDEN';
  end if;
  return private.record_request_health_audit();
end;
$$;

revoke all on function public.get_hosted_health_snapshot()
  from public, anon, authenticated;
grant execute on function public.get_hosted_health_snapshot()
  to service_role;

comment on function public.get_hosted_health_snapshot() is
  'Service-only, sanitized production health snapshot used by hosted auto-repair monitoring.';
