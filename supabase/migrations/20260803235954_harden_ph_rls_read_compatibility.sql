-- Live-safe RLS stage 1 for PH app tables.
--
-- Why this is compatibility-first:
-- The production app still has cached browser clients and realtime/read paths that
-- may touch these public tables with the anon role. Enabling RLS without a SELECT
-- policy would immediately block those users. This migration turns RLS on, keeps
-- read compatibility, and removes direct write-style table privileges from anon
-- and authenticated. A later hardening pass can remove broad SELECT policies after
-- all clients are fully proxy-only through app-api.

do $$
declare
  table_name text;
  table_names text[] := array[
    'ph_active_request',
    'ph_cav_import',
    'ph_chat_members',
    'ph_chat_threads',
    'ph_crop_roll_completed_drive_keys',
    'ph_dock_issue_allocations',
    'ph_dock_issue_status',
    'ph_dock_item_status',
    'ph_dock_team_status',
    'ph_drive_around_report_rows_archive_manifest',
    'ph_master_inventory',
    'ph_master_inventory_user_assignments',
    'ph_reserves',
    'ph_sales_office'
  ];
begin
  foreach table_name in array table_names loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);

      execute format('drop policy if exists "app_public_read" on public.%I', table_name);
      execute format(
        'create policy "app_public_read" on public.%I for select to anon, authenticated using (true)',
        table_name
      );

      execute format('grant select on table public.%I to anon, authenticated', table_name);
      execute format(
        'revoke insert, update, delete, truncate, references, trigger on table public.%I from anon, authenticated',
        table_name
      );
    end if;
  end loop;
end $$;
