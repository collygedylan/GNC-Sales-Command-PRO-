-- Edge Function write hardening for the AG Metric app.
-- Goal: browser clients should not be allowed to write directly with anon/authenticated keys.
-- The app-api Edge Function keeps using the service role key server-side after validating
-- the app session token and role.
--
-- Safe to run repeatedly. This does not affect service_role writes used by Edge Functions,
-- Apps Script, or backend workers. It only removes direct public browser writes.

begin;

do $$
declare
  rel record;
begin
  for rel in
    select n.nspname as schema_name, c.relname as relation_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    execute format('revoke insert, update, delete on table %I.%I from anon, authenticated', rel.schema_name, rel.relation_name);
  end loop;
end $$;

create or replace view public.v2_edge_write_surface_audit as
select
  table_schema,
  table_name,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
group by table_schema, table_name, grantee
order by table_name, grantee;

commit;

select *
from public.v2_edge_write_surface_audit;
