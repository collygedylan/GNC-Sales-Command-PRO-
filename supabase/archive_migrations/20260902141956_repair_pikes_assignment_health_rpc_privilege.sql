begin;

-- This health RPC resolves its answer through a private-schema helper.  The
-- Stine history migration accidentally replaced the prior narrow definer
-- wrapper with SECURITY INVOKER, so the service role lost private schema
-- access and the production probe received a 403.  Restore the service-only
-- wrapper; the empty search path remains explicit to prevent object shadowing.
alter function public.get_pikes_order_assignment_health_v1()
  security definer
  set search_path = '';

revoke all on function public.get_pikes_order_assignment_health_v1()
  from public, anon, authenticated;
grant execute on function public.get_pikes_order_assignment_health_v1()
  to service_role;

notify pgrst, 'reload schema';

commit;
