begin;

-- The import RPC inserts its complete request context immediately before it
-- updates inventory rows. Refresh statistics once per statement so row-level
-- protection triggers plan against the populated context instead of stale
-- empty-table statistics. This preserves the existing lookup function and its
-- security configuration while allowing PostgreSQL to select exact-key paths.
create or replace function app_sync_private.ph_master_bulk_context_analyze_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  analyze app_sync_private.ph_master_bulk_import_context_v1;
  return null;
end
$function$;
revoke all on function app_sync_private.ph_master_bulk_context_analyze_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists ph_master_bulk_context_analyze_v1
  on app_sync_private.ph_master_bulk_import_context_v1;
create trigger ph_master_bulk_context_analyze_v1
after insert on app_sync_private.ph_master_bulk_import_context_v1
for each statement
execute function app_sync_private.ph_master_bulk_context_analyze_v1();

commit;
