begin;

create or replace view public.ph_active_suspend with (security_invoker=true) as
select normalized.*,
  coalesce(metric.on_hand,0) as on_hand,
  coalesce(metric.review,0) as review,
  coalesce(metric.available,0) as available,
  coalesce(stock.open_stock,0) as open_stock,
  coalesce(metric.loc_photo_match,0) as loc_photo_match,
  coalesce(location.loc_on_hand,0) as loc_on_hand,
  'Pending'::text as status,
  'suspend_tag'::text as request_type,
  true as is_suspend_tag,
  normalized.suspend_to as suspendto,
  normalized.stopnumber as drop_number,
  coalesce(private.request_numeric_v2362(normalized.quantityshipped),private.request_numeric_v2362(normalized.quantityordered),0) as qty,
  coalesce(normalized.consigneename,normalized.customername) as consignee,
  coalesce(normalized.customername,normalized.consigneename) as customer,
  normalized.salesrepname as sales_rep
from (
  select (jsonb_populate_record(null::public.ph_soc_master,
    to_jsonb(soc)||jsonb_build_object(
      'dock',coalesce(nullif(btrim(soc.dock::text),''),'Unassigned'),
      'contsize',coalesce(nullif(btrim(soc.printedcontainercode::text),''),soc.containersort)
    ))).*
  from public.ph_soc_master soc
  where upper(btrim(coalesce(soc.suspend,'')))='SUSPEND'
    and lower(btrim(coalesce(soc.suspend_to,'')))='dc'
    and soc.date_completed is null
    and lower(btrim(coalesce(soc.suspend_candidate_state,'pending'))) not in ('complete','completed','approved','rejected')
) normalized
left join lateral (
  select private.request_numeric_v2362(to_jsonb(master)->>'ptronhand') on_hand,
    private.request_numeric_v2362(to_jsonb(master)->>'ptrreviewed') review,
    private.request_numeric_v2362(to_jsonb(master)->>'ptravailable') available,
    private.request_numeric_v2362(to_jsonb(master)->>'loc_photo_match') loc_photo_match
  from public.ph_master_inventory master
  where upper(btrim(master.itemcode))=upper(btrim(normalized.itemcode))
  order by ((upper(btrim(master.locationcode))=upper(btrim(normalized.locationcode)))::int
    +(upper(btrim(master.lotcode))=upper(btrim(normalized.lotcode)))::int) desc,master.unique_id
  limit 1
) metric on true
left join lateral (
  select sum(coalesce(private.request_numeric_v2362(master.ptravailable),0)) open_stock
  from public.ph_master_inventory master
  where upper(btrim(master.itemcode))=upper(btrim(normalized.itemcode))
    and upper(btrim(master.lotcode)) ~ '\.(F1|S1)$'
) stock on true
left join lateral (
  select sum(coalesce(private.request_numeric_v2362(master.ptronhand),0)) loc_on_hand
  from public.ph_master_inventory master
  where upper(btrim(master.itemcode))=upper(btrim(normalized.itemcode))
    and upper(btrim(master.locationcode))=upper(btrim(normalized.locationcode))
) location on true;

create or replace view public.ph_soc_suspend_tag_rows with (security_invoker=true) as
select * from public.ph_active_suspend;

grant select on public.ph_active_suspend,public.ph_soc_suspend_tag_rows to anon,authenticated;

insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('app_version',jsonb_build_object('app_version','2.3.75','release','AgData v2.3.75'),'release-v2.3.75',now())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;

do $v2375_contract$
begin
  if not exists(select 1 from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='public' and relation.relname='ph_active_suspend'
      and coalesce(relation.reloptions,'{}'::text[]) @> array['security_invoker=true']) then
    raise exception 'SUSPEND_SECURITY_INVOKER_MISSING';
  end if;
  if (select count(*) from public.ph_active_suspend)<>(select count(*) from public.ph_soc_master
    where upper(btrim(coalesce(suspend,'')))='SUSPEND'
      and lower(btrim(coalesce(suspend_to,'')))='dc'
      and date_completed is null
      and lower(btrim(coalesce(suspend_candidate_state,'pending'))) not in ('complete','completed','approved','rejected')) then
    raise exception 'SUSPEND_ACTIVE_COUNT_MISMATCH';
  end if;
end
$v2375_contract$;

commit;
