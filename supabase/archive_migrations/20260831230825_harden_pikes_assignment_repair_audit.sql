begin;

drop policy if exists "Pikes repair audit deny browser access"
  on public.ph_pikes_order_assignment_repair_audit;
create policy "Pikes repair audit deny browser access"
on public.ph_pikes_order_assignment_repair_audit
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

commit;
