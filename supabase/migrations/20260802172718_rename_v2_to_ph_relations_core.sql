do $$
declare
  r record;
  object_kind text;
begin
  for r in
    select *
    from public.__rename_v2_ph_relation_map_20260802
    where to_regclass(format('public.%I', old_name)) is not null
      and to_regclass(format('public.%I', new_name)) is null
    order by
      case relkind
        when 'S' then 1
        when 'r' then 2
        when 'p' then 2
        when 'm' then 3
        when 'v' then 4
        else 9
      end,
      old_name
  loop
    object_kind := case r.relkind
      when 'S' then 'sequence'
      when 'v' then 'view'
      when 'm' then 'materialized view'
      else 'table'
    end;
    execute format('alter %s public.%I rename to %I', object_kind, r.old_name, r.new_name);
  end loop;
end $$;
