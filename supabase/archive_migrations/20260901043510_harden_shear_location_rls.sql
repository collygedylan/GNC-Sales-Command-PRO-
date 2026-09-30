begin;

create policy ph_shear_location_submissions_browser_deny
on public.ph_shear_location_submissions
for all
to anon, authenticated
using (false)
with check (false);

create policy ph_shear_location_inquiries_browser_deny
on public.ph_shear_location_inquiries
for all
to anon, authenticated
using (false)
with check (false);

create policy ph_shear_location_items_browser_deny
on public.ph_shear_location_items
for all
to anon, authenticated
using (false)
with check (false);

create policy ph_shear_location_rows_browser_deny
on public.ph_shear_location_rows
for all
to anon, authenticated
using (false)
with check (false);

create policy ph_shear_location_events_browser_deny
on public.ph_shear_location_events
for all
to anon, authenticated
using (false)
with check (false);

commit;
