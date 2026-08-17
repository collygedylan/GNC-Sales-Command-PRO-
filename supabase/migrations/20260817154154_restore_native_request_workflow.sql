-- Restore the Request workflow after the native Supabase Auth cutover.
-- This mirrors the existing app-api authorization boundary: active
-- Admin/Manager/Sales Rep/CSR profiles may create and complete requests;
-- QC-only profiles remain read-only unless explicitly allowlisted.

create or replace function private.can_write_requests()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.disabled_at is null
      and (p.locked_until is null or p.locked_until <= now())
      and (
        lower(btrim(p.username)) in ('dylan_collyge', 'jd_jones', 'megan_kelly')
        or upper(regexp_replace(coalesce(p.role, ''), '\s+', '', 'g')) not like 'QC%'
      )
  )
$$;

revoke all on function private.can_write_requests() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_write_requests() to authenticated;

grant select, insert, update, delete on table public.ph_active_request to authenticated;
grant select, insert, update, delete on table public.ph_request_history to authenticated;
grant usage, select on sequence public.ph_active_request_id_seq1 to authenticated;
grant usage, select on sequence public.ph_request_history_id_seq to authenticated;

drop policy if exists ph_active_request_native_insert on public.ph_active_request;
create policy ph_active_request_native_insert
on public.ph_active_request
for insert
to authenticated
with check ((select private.can_write_requests()));

drop policy if exists ph_active_request_native_update on public.ph_active_request;
create policy ph_active_request_native_update
on public.ph_active_request
for update
to authenticated
using ((select private.can_write_requests()))
with check ((select private.can_write_requests()));

drop policy if exists ph_active_request_native_delete on public.ph_active_request;
create policy ph_active_request_native_delete
on public.ph_active_request
for delete
to authenticated
using ((select private.can_write_requests()));

-- The legacy public ALL policy would bypass the native role check as soon as
-- authenticated DML grants are restored, so replace it with scoped policies.
drop policy if exists "Allow app write request history" on public.ph_request_history;

drop policy if exists ph_request_history_native_insert on public.ph_request_history;
create policy ph_request_history_native_insert
on public.ph_request_history
for insert
to authenticated
with check ((select private.can_write_requests()));

drop policy if exists ph_request_history_native_update on public.ph_request_history;
create policy ph_request_history_native_update
on public.ph_request_history
for update
to authenticated
using ((select private.can_write_requests()))
with check ((select private.can_write_requests()));

drop policy if exists ph_request_history_native_delete on public.ph_request_history;
create policy ph_request_history_native_delete
on public.ph_request_history
for delete
to authenticated
using ((select private.can_write_requests()));

comment on function private.can_write_requests() is
  'Native Auth authorization gate for Request and Request History writes; mirrors the existing app-api Admin/Manager/Rep/CSR boundary.';
