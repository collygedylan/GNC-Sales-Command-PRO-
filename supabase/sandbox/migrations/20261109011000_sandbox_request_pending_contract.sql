begin;

-- The sandbox client uses the pending relation. Keep the existing sandbox
-- rows, RLS policies, indexes and grants on their original table object.
alter table public.ph_active_request rename to ph_requests_pending;

create view public.ph_active_request with (security_invoker=true) as
select * from public.ph_requests_pending;
revoke all on public.ph_active_request from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.ph_active_request to anon,authenticated,service_role;

commit;
