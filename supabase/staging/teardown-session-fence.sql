-- Separate approval required: additive restrictions on shared sandbox objects.
-- Existing demo users and anonymous access retain their existing behavior.
-- This blocks authenticated teardown identities from unrelated sandbox data.
-- It does not repair the sandbox's pre-existing anonymous/public access policies.
begin;
create or replace function teardown_private.is_teardown_identity()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from teardown_private.members where user_id = auth.uid());
$$;
revoke all on function teardown_private.is_teardown_identity() from public, anon;
grant execute on function teardown_private.is_teardown_identity() to authenticated;
do $$
declare target text;
begin
  foreach target in array array[
    'public.sandbox_runtime','public.ph_master_inventory','public.ph_active_request',
    'public.ph_cav_import','public.ph_27f1_hl_po','public.ph_dock_team_status',
    'public.sandbox_profiles','public.sandbox_workflow_records','public.sandbox_message_threads',
    'public.sandbox_messages','public.sandbox_upload_jobs','public.sandbox_event_log',
    'public.ph_app_user_preferences','public.ph_app_live_pilot_flags','public.profiles',
    'public.ph_runtime_feature_flags','storage.objects'
  ] loop
    if to_regclass(target) is null then raise exception 'TEARDOWN_SHARED_OBJECT_MISSING: %', target; end if;
    if not exists (select 1 from pg_policy where polrelid=to_regclass(target) and polname='teardown_identity_fence') then
      execute format('create policy teardown_identity_fence on %s as restrictive for all to authenticated using (not teardown_private.is_teardown_identity()) with check (not teardown_private.is_teardown_identity())',target);
    end if;
  end loop;
end $$;
commit;
