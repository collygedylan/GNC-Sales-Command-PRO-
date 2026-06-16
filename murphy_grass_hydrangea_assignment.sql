-- Reassign Murphy's grass work and Hydrangea M rows in current inventory data.
-- Run in Supabase SQL editor after deploying the app code.

begin;

update public.v2_master_inventory
set assignedto = 'dylan_collyge'
where upper(btrim(coalesce(plantgroupcode, ''))) = '140_GRASS';

update public.v2_master_inventory
set assignedto = 'megan_kelly'
where lower(btrim(coalesce(genusname, ''))) like '%hydrangea m%';

-- Optional check:
-- select assignedto, count(*)
-- from public.v2_master_inventory
-- where upper(btrim(coalesce(plantgroupcode, ''))) = '140_GRASS'
--    or lower(btrim(coalesce(genusname, ''))) like '%hydrangea m%'
-- group by assignedto
-- order by assignedto;

commit;
