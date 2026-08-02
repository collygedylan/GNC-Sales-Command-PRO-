-- Temporary v2_* compatibility views for cached clients and older deployed functions.
-- The live app uses ph_* names directly.
do $$
declare
  r record;
  old_name text;
begin
  for r in
    select c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'ph\_%' escape '\'
      and c.relkind in ('r', 'p', 'v', 'm')
  loop
    old_name := 'v2_' || substring(r.relname from 4);
    if to_regclass(format('public.%I', old_name)) is null then
      execute format(
        'create or replace view public.%I with (security_invoker = true) as select * from public.%I',
        old_name,
        r.relname
      );
      if r.relkind in ('r', 'p', 'v') then
        execute format('grant select, insert, update, delete on public.%I to anon, authenticated', old_name);
      else
        execute format('grant select on public.%I to anon, authenticated', old_name);
      end if;
    end if;
  end loop;

  if to_regclass('public.v2_cav') is null and to_regclass('public.ph_cav_import') is not null then
    execute 'create or replace view public.v2_cav with (security_invoker = true) as select * from public.ph_cav_import';
    execute 'grant select, insert, update, delete on public.v2_cav to anon, authenticated';
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');
