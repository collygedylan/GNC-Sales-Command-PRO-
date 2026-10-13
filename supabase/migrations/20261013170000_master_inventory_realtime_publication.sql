begin;
set local lock_timeout = '5s';

-- Realtime checks column SELECT grants as well as RLS. Expose only the primary
-- key and invalidation pair; all status/evidence reads still use inventory_read.
grant select (unique_id, itemcode, locationcode) on public.ph_master_inventory to authenticated;

-- Keep every existing restrictive policy (including scheduled handover) intact.
-- Match inventory_read's active-profile and Foreman priority boundary. The API
-- permits inventory reads for all active role families; no data writes are added.
do $policy$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
      and tablename='ph_master_inventory' and policyname='inventory_status_realtime_read_v1') then
    create policy inventory_status_realtime_read_v1 on public.ph_master_inventory
      for select to authenticated using (
        (select (private.current_active_profile()).id) is not null
        and not coalesce((select (private.current_active_profile()).must_change_password), true)
        and (regexp_replace(upper(coalesce((select (private.current_active_profile()).role),'')), '[^A-Z0-9]', '', 'g') not like '%FOREMAN%'
          or (priority is not null and priority not in ('','-','--','---','N/A','NA','NULL','NONE')))
      );
  end if;
end
$policy$;

do $migration$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'SUPABASE_REALTIME_PUBLICATION_MISSING';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ph_master_inventory'
  ) then
    alter publication supabase_realtime add table public.ph_master_inventory;
  end if;
end
$migration$;

commit;
