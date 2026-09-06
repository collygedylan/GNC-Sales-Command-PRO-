begin;

-- Initialize Auth helper values once per statement instead of once per row.
alter policy "Allow service write drive around report files" on public.ph_drive_around_report_files
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
alter policy "Allow service write drive around compact rows" on public.ph_drive_around_report_rows
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
alter policy "Allow service write hold learning events" on public.ph_hold_learning_events
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
alter policy "Allow service write hold learning profiles" on public.ph_hold_learning_profiles
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
alter policy "Allow service write hold release cycles" on public.ph_hold_release_cycles
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
alter policy "v2_ml_github_dispatch_state service only" on public.ph_ml_github_dispatch_state
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
alter policy "Allow service write weather daily" on public.ph_weather_daily
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
alter policy "Allow service write weather hourly" on public.ph_weather_hourly
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

alter policy "Authenticated users read their AV option eval requests"
  on public.ph_av_option_eval_requests
  using (
    lower(coalesce(
      (select auth.jwt()) ->> 'username',
      (select auth.jwt()) ->> 'preferred_username',
      (select auth.jwt()) ->> 'email',
      ''
    )) = any (array['dylan_collyge', 'jd_jones', 'megan_kelly'])
    or lower(assignedto) = lower(coalesce(
      (select auth.jwt()) ->> 'username',
      (select auth.jwt()) ->> 'preferred_username',
      (select auth.jwt()) ->> 'email',
      ''
    ))
    or lower(coalesce(created_by, '')) = lower(coalesce(
      (select auth.jwt()) ->> 'username',
      (select auth.jwt()) ->> 'preferred_username',
      (select auth.jwt()) ->> 'email',
      ''
    ))
  );

alter policy "Authenticated evaluators update AV option eval requests"
  on public.ph_av_option_eval_requests
  using (
    lower(coalesce(
      (select auth.jwt()) ->> 'username',
      (select auth.jwt()) ->> 'preferred_username',
      (select auth.jwt()) ->> 'email',
      ''
    )) = any (array['dylan_collyge', 'jd_jones', 'megan_kelly'])
    or lower(assignedto) = lower(coalesce(
      (select auth.jwt()) ->> 'username',
      (select auth.jwt()) ->> 'preferred_username',
      (select auth.jwt()) ->> 'email',
      ''
    ))
  )
  with check (
    lower(coalesce(
      (select auth.jwt()) ->> 'username',
      (select auth.jwt()) ->> 'preferred_username',
      (select auth.jwt()) ->> 'email',
      ''
    )) = any (array['dylan_collyge', 'jd_jones', 'megan_kelly'])
    or lower(assignedto) = lower(coalesce(
      (select auth.jwt()) ->> 'username',
      (select auth.jwt()) ->> 'preferred_username',
      (select auth.jwt()) ->> 'email',
      ''
    ))
  );

-- Pin legacy SECURITY DEFINER functions that predate the explicit-path rule.
-- Browser roles cannot CREATE in public, so keeping public first preserves their
-- existing object resolution while removing the caller-controlled path.
do $block$
declare
  target_oid regprocedure;
begin
  for target_oid in
    select function_row.oid::regprocedure
    from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(function_row.proconfig, '{}'::text[])) setting
        where setting like 'search_path=%'
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
