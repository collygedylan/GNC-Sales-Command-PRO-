do $$
declare
  source_tables text[] := array[
    'ph_active_request',
    'ph_av_notes',
    'ph_bunch_counts',
    'ph_cav_import',
    'ph_diagnostic_lab_cases',
    'ph_disease_training_assets',
    'ph_dock_issue_allocations',
    'ph_dock_issue_status',
    'ph_dock_item_status',
    'ph_dock_team_status',
    'ph_drive_around_report_files',
    'ph_drive_around_report_rows',
    'ph_flyer_folder_history',
    'ph_flyer_folder_rows',
    'ph_grower_scout_assets',
    'ph_grower_scout_reports',
    'ph_hold_learning_events',
    'ph_hold_learning_profiles',
    'ph_hold_release_cycles',
    'ph_labor_hours',
    'ph_master_inventory',
    'ph_ml_image_jobs',
    'ph_ncr_completions',
    'ph_productivity_history',
    'ph_request_history',
    'ph_reserves',
    'ph_sales_office',
    'ph_shear_list',
    'ph_soc_master',
    'ph_spread_counts',
    'ph_take_back_queue',
    'ph_warehouse_assigned_items',
    'ph_weather_daily',
    'ph_weather_hourly'
  ];
  farm record;
  source_table text;
  target_table text;
  source_oid oid;
  target_oid oid;
  source_rls_enabled boolean;
  source_force_rls boolean;
  warehouse_column text;
  policy_record record;
  grant_record record;
  target_policy record;
  policy_roles text;
  policy_cmd text;
  using_clause text;
  check_clause text;
begin
  for farm in
    select *
    from (values
      ('tx'::text, '20'::text),
      ('nc'::text, '40'::text),
      ('hl'::text, '60'::text)
    ) as farms(prefix, warehouse_id)
  loop
    foreach source_table in array source_tables
    loop
      select c.oid, c.relrowsecurity, c.relforcerowsecurity
        into source_oid, source_rls_enabled, source_force_rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = source_table
        and c.relkind in ('r', 'p');

      if source_oid is null then
        raise notice 'Skipping %, source table does not exist', source_table;
        continue;
      end if;

      target_table := farm.prefix || '_' || substring(source_table from 4);

      execute format(
        'create table if not exists public.%I (like public.%I including all)',
        target_table,
        source_table
      );

      select c.oid
        into target_oid
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = target_table
        and c.relkind in ('r', 'p');

      execute format(
        'comment on table public.%I is %L',
        target_table,
        'Future farm table cloned empty from public.' || source_table ||
        ' for ' || upper(farm.prefix) || ' warehouse ' || farm.warehouse_id || '.'
      );

      -- Keep future public-schema tables protected by RLS. If the PH source
      -- table is currently open with RLS disabled, add an explicit mirror
      -- policy so table grants still behave the same when the table is used.
      execute format('alter table public.%I enable row level security', target_table);
      if source_force_rls then
        execute format('alter table public.%I force row level security', target_table);
      else
        execute format('alter table public.%I no force row level security', target_table);
      end if;

      for target_policy in
        select pol.polname
        from pg_policy pol
        where pol.polrelid = target_oid
      loop
        execute format('drop policy if exists %I on public.%I', target_policy.polname, target_table);
      end loop;

      for policy_record in
        select
          pol.polname,
          pol.polcmd,
          pol.polpermissive,
          pg_get_expr(pol.polqual, pol.polrelid) as qual_expr,
          pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expr,
          (
            select string_agg(
              case
                when role_oid = 0 then 'public'
                else quote_ident(r.rolname)
              end,
              ', '
              order by case when role_oid = 0 then 'public' else r.rolname end
            )
            from unnest(pol.polroles) as role_oid
            left join pg_roles r on r.oid = role_oid
          ) as roles_sql
        from pg_policy pol
        where pol.polrelid = source_oid
      loop
        policy_cmd := case policy_record.polcmd
          when 'r' then 'select'
          when 'a' then 'insert'
          when 'w' then 'update'
          when 'd' then 'delete'
          when '*' then 'all'
        end;
        policy_roles := coalesce(nullif(policy_record.roles_sql, ''), 'public');
        using_clause := case
          when policy_record.qual_expr is null then ''
          else ' using (' || policy_record.qual_expr || ')'
        end;
        check_clause := case
          when policy_record.with_check_expr is null then ''
          else ' with check (' || policy_record.with_check_expr || ')'
        end;

        execute format(
          'create policy %I on public.%I as %s for %s to %s%s%s',
          policy_record.polname,
          target_table,
          case when policy_record.polpermissive then 'permissive' else 'restrictive' end,
          policy_cmd,
          policy_roles,
          using_clause,
          check_clause
        );
      end loop;

      if not source_rls_enabled then
        execute format(
          'create policy %I on public.%I as permissive for all to public using (true) with check (true)',
          'mirror_ph_open_access',
          target_table
        );
      end if;

      execute format('revoke all on table public.%I from public, anon, authenticated, service_role', target_table);
      for grant_record in
        select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilege_list
        from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = source_table
          and grantee <> 'postgres'
        group by grantee
      loop
        execute format(
          'grant %s on table public.%I to %I',
          grant_record.privilege_list,
          target_table,
          grant_record.grantee
        );
      end loop;

      select quote_ident(column_name)
        into warehouse_column
      from information_schema.columns
      where table_schema = 'public'
        and table_name = target_table
        and lower(column_name) = 'warehousei'
      order by ordinal_position
      limit 1;

      if warehouse_column is not null then
        execute format(
          'alter table public.%I drop constraint if exists %I',
          target_table,
          target_table || '_warehousei_check'
        );
        execute format(
          'alter table public.%I add constraint %I check (btrim(%s::text) = %L)',
          target_table,
          target_table || '_warehousei_check',
          warehouse_column,
          farm.warehouse_id
        );
      end if;

      warehouse_column := null;
      source_oid := null;
      target_oid := null;
    end loop;
  end loop;
end $$;
