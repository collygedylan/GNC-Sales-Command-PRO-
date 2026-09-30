do $$
declare
  r record;
  next_name text;
begin
  for r in
    select c.relname as old_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'i'
      and c.relname like '%v2_%'
    order by c.relname
  loop
    next_name := replace(r.old_name, 'v2_', 'ph_');
    if next_name <> r.old_name and to_regclass(format('public.%I', next_name)) is null then
      execute format('alter index public.%I rename to %I', r.old_name, next_name);
    end if;
  end loop;
end $$;
