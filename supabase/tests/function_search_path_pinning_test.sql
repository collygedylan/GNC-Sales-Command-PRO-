begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

select is(
  (
    select count(*)::bigint
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
  ),
  0::bigint,
  'all public application functions pin search_path'
);

select * from finish();
rollback;
