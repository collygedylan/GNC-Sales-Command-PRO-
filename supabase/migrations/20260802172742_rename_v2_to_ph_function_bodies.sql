do $$
declare
  fn record;
  mapping record;
  definition text;
  next_definition text;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ilike '%v2_%'
  loop
    definition := pg_get_functiondef(fn.oid);
    next_definition := definition;

    for mapping in
      select old_name, new_name
      from public.__rename_v2_ph_relation_map_20260802
      order by length(old_name) desc, old_name
    loop
      next_definition := replace(next_definition, format('public.%I', mapping.old_name), format('public.%I', mapping.new_name));
      next_definition := replace(next_definition, 'public.' || mapping.old_name, 'public.' || mapping.new_name);
      next_definition := replace(next_definition, mapping.old_name, mapping.new_name);
    end loop;

    -- Keep existing RPC names stable. Some scheduled jobs still call v2_* functions.
    next_definition := regexp_replace(
      next_definition,
      'CREATE OR REPLACE FUNCTION public\.[^(]+\(',
      'CREATE OR REPLACE FUNCTION public.' || quote_ident(fn.proname) || '('
    );

    if next_definition <> definition then
      execute next_definition;
    end if;
  end loop;
end $$;
