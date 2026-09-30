-- Edge Functions and recovery workers use the service role to resolve and
-- maintain native-auth profiles. RLS bypass alone does not grant table access.
grant select, insert, update, delete on table public.profiles to service_role;
