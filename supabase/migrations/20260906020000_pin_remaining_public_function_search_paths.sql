begin;

-- Pin legacy SECURITY INVOKER helpers as well as SECURITY DEFINER functions.
-- Browser roles cannot CREATE in these schemas, so preserving the existing
-- lookup order removes caller-controlled resolution without changing behavior.
do $block$
declare
  target_oid regprocedure;
begin
  for target_oid in
    select function_row.oid::regprocedure
    from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.prokind = 'f'
      and not exists (
        select 1
        from unnest(coalesce(function_row.proconfig, '{}'::text[])) setting
        where setting like 'search_path=%'
      )
      and not exists (
        select 1
        from pg_depend dependency
        where dependency.classid = 'pg_proc'::regclass
          and dependency.objid = function_row.oid
          and dependency.deptype = 'e'
      )
  loop
    execute format(
      'alter function %s set search_path to public, extensions, private, vault, pg_temp',
      target_oid
    );
  end loop;
end
$block$;

commit;
