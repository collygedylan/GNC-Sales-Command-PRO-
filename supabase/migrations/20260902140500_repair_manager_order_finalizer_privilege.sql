begin;

-- The shared Pikes/Stine finalizer calls a private assignment-key helper. The
-- importer is intentionally the only caller (service_role only), but the
-- service role does not have USAGE on the private schema. Execute the bounded
-- finalizer as its postgres owner so it can resolve authoritative assignments
-- without widening access to private helpers.
alter function public.finalize_pikes_order_import(text, text, text, integer, integer)
  security definer;
alter function public.finalize_pikes_order_import(text, text, text, integer, integer)
  set search_path = '';

revoke all on function public.finalize_pikes_order_import(text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.finalize_pikes_order_import(text, text, text, integer, integer)
  to service_role;

comment on function public.finalize_pikes_order_import(text, text, text, integer, integer) is
  'Service-only transactional Pikes/Stine finalizer; owner execution is required for private assignment-key resolution.';

notify pgrst, 'reload schema';

commit;
