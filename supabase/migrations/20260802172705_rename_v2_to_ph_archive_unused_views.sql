do $$
declare
  archived_views text[] := array[
    'v2_app_database_health',
    'v2_app_realtime_budget_state',
    'v2_app_schema_cleanup_candidates',
    'v2_edge_write_surface_audit'
  ];
  view_name text;
  dependency_count integer;
begin
  foreach view_name in array archived_views loop
    select count(*)
      into dependency_count
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid
    join pg_class dependent_class on dependent_class.oid = r.ev_class
    join pg_namespace dependent_ns on dependent_ns.oid = dependent_class.relnamespace
    where d.refobjid = to_regclass(format('public.%I', view_name))::oid
      and dependent_ns.nspname = 'public'
      and dependent_class.relname <> view_name;

    if to_regclass(format('public.%I', view_name)) is not null
       and to_regclass(format('archive_schema_cleanup_20260802.%I', view_name)) is null
       and dependency_count = 0 then
      execute format('alter view public.%I set schema archive_schema_cleanup_20260802', view_name);
      delete from public.__rename_v2_ph_relation_map_20260802 where old_name = view_name;
    end if;
  end loop;
end $$;
