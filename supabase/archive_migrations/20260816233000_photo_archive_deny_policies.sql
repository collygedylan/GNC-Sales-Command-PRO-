-- Explicit fail-closed policies keep archive audit data service-only while
-- satisfying schema linting that requires a visible RLS policy contract.

create policy photo_archive_runs_deny_browser
  on public.ph_photo_archive_runs
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy photo_archive_jobs_deny_browser
  on public.ph_photo_archive_jobs
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

