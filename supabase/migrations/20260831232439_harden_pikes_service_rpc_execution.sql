begin;

-- These RPCs intentionally depend on a helper in the private schema. Keep the
-- private schema undiscoverable to API roles and execute through narrowly
-- granted SECURITY DEFINER wrappers instead of granting schema-wide USAGE.
alter function public.repair_pikes_order_batch_assignments_v1(uuid, boolean, text)
  security definer;
alter function public.get_pikes_order_assignment_health_v1()
  security definer;

revoke all on function public.repair_pikes_order_batch_assignments_v1(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.get_pikes_order_assignment_health_v1()
  from public, anon, authenticated;
grant execute on function public.repair_pikes_order_batch_assignments_v1(uuid, boolean, text)
  to service_role;
grant execute on function public.get_pikes_order_assignment_health_v1()
  to service_role;

commit;
