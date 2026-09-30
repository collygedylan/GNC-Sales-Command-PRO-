-- Retire the temporary v2_* compatibility aliases created on 2026-08-02.
--
-- The production shell, Google Apps Script integrations, and deployed Edge
-- Functions now use the canonical ph_* relations. These are ordinary views;
-- dropping them removes no rows and frees no relation storage.
--
-- Rollback: re-run the compatibility-view body from
-- 20260802173907_rename_v2_to_ph_compatibility_views.sql.

do $$
declare
  compatibility_view record;
  compatibility_view_count integer;
  unexpected_object_count integer;
begin
  select count(*)::integer
    into compatibility_view_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and c.relname like 'v2\_%' escape '\';

  select count(*)::integer
    into unexpected_object_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname like 'v2\_%' escape '\'
    and c.relkind <> 'v';

  if compatibility_view_count <> 72 then
    raise exception
      'Expected 72 public v2 compatibility views, found %; refusing cleanup',
      compatibility_view_count;
  end if;

  if unexpected_object_count <> 0 then
    raise exception
      'Found % non-view public v2 objects; refusing cleanup',
      unexpected_object_count;
  end if;

  for compatibility_view in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and c.relname like 'v2\_%' escape '\'
    order by c.relname
  loop
    execute format(
      'drop view public.%I restrict',
      compatibility_view.relname
    );
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');
