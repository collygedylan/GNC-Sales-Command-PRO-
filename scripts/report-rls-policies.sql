-- Read-only RLS audit. This inventories exposed tables and highlights broad
-- policies without changing access. Review by workflow domain before replacing
-- any policy during the native Auth rollout.
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  count(p.policyname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
  on p.schemaname = n.nspname
 and p.tablename = c.relname
where n.nspname in ('public', 'storage')
  and c.relkind in ('r', 'p')
group by n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
order by n.nspname, c.relname;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check,
  (
    coalesce(trim(qual), '') in ('true', '(true)')
    or coalesce(trim(with_check), '') in ('true', '(true)')
    or 'public' = any(roles)
    or 'anon' = any(roles)
  ) as requires_security_review
from pg_policies
where schemaname in ('public', 'storage')
order by requires_security_review desc, schemaname, tablename, policyname;
