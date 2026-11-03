begin;
set local lock_timeout = '4s';
set local statement_timeout = '15s';
set local request.jwt.claim.role = 'service_role';
-- Resolve dormant metadata without changing owners, requests, evidence or timestamps.
create temporary table dormant_group_proof on commit drop as
select 'owners' kind,md5(string_agg((to_jsonb(d)-'plant_group_code')::text,'|' order by itemcode_normalized)) fingerprint from public.ph_itemcode_default_owners d
union all select 'requests',md5(string_agg(to_jsonb(r)::text,'|' order by unique_id)) from public.ph_requests_pending r;
create temporary table dormant_family_groups on commit drop as
with candidates as (
 select split_part(upper(itemcode),'.',1) family,nullif(upper(btrim(plantgroupcode)),'') code from public.ph_master_inventory
 union all select split_part(upper(itemcode),'.',1),nullif(upper(btrim(coalesce(raw_row->>'plantgroupcode',raw_row->>'PLANTGROUPCODE',raw_row->>'plant_group_code'))),'') from public.ph_warehouse_assigned_items
) select family,min(code) code from candidates where code is not null group by family having count(distinct code)=1;
create unique index on dormant_family_groups(family);
update public.ph_itemcode_default_owners d set plant_group_code=g.code from dormant_family_groups g
where nullif(btrim(d.plant_group_code),'') is null and split_part(d.itemcode_normalized,'.',1)=g.family;
-- Historical range predicates use the existing itemcode/date index, never a full archive scan.
with missing as (select itemcode_normalized,split_part(itemcode_normalized,'.',1) family from public.ph_itemcode_default_owners where nullif(btrim(plant_group_code),'') is null),
resolved as (select d.itemcode_normalized,coalesce(h.plantgroupcode,'UNCLASSIFIED') code from missing d
 left join lateral(select upper(btrim(h.plantgroupcode)) plantgroupcode from public.ph_drive_around_report_rows h
 where h.itemcode>=d.family||'.' and h.itemcode<d.family||'/' and split_part(h.itemcode,'.',1)=d.family
 and nullif(btrim(h.plantgroupcode),'') is not null and h.report_date is not null
 order by h.report_date desc,h.unique_id desc limit 1) h on true)
update public.ph_itemcode_default_owners d set plant_group_code=r.code from resolved r where d.itemcode_normalized=r.itemcode_normalized;
do $proof$ begin
 if exists(select 1 from dormant_group_proof p join (
  select 'owners' kind,md5(string_agg((to_jsonb(d)-'plant_group_code')::text,'|' order by itemcode_normalized)) fingerprint from public.ph_itemcode_default_owners d
  union all select 'requests',md5(string_agg(to_jsonb(r)::text,'|' order by unique_id)) from public.ph_requests_pending r
 ) current using(kind) where p.fingerprint is distinct from current.fingerprint) then raise exception 'DORMANT_GROUP_PROTECTED_STATE_CHANGED'; end if;
 if exists(select 1 from public.ph_itemcode_default_owners where nullif(btrim(plant_group_code),'') is null) then raise exception 'DORMANT_PLANT_GROUP_MISSING'; end if;
end $proof$;
commit;
