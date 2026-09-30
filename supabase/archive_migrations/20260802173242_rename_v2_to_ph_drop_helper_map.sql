do $$
declare
  r record;
begin
  for r in
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name like 'ph\_%' escape '\'
      and column_name in ('source_table', 'table_name', 'last_table_name')
      and data_type in ('text', 'character varying')
      and table_name in (
        select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
      )
  loop
    execute format(
      'update public.%I set %I =
        case
          when lower(%I) in (%L, %L) then %L
          when lower(%I) like %L escape %L then %L || substr(lower(%I), 4)
          else %I
        end
        where lower(%I) in (%L, %L) or lower(%I) like %L escape %L',
      r.table_name,
      r.column_name,
      r.column_name, 'v2_cav', 'ph_cav', 'ph_cav_import',
      r.column_name, 'v2\_%', '\', 'ph_',
      r.column_name,
      r.column_name, 'v2_cav', 'ph_cav',
      r.column_name, 'v2\_%', '\'
    );
  end loop;
end $$;

drop table if exists public.__rename_v2_ph_relation_map_20260802;
