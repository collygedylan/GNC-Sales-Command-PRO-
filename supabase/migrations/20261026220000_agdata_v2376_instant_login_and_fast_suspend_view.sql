begin;

create index if not exists ph_master_inventory_suspend_lookup_v2376_idx
on public.ph_master_inventory (
  (lower(btrim(coalesce(itemcode::text,'')))),
  (lower(btrim(coalesce(locationcode::text,'')))),
  (lower(btrim(coalesce(lotcode::text,''))))
);

create index if not exists ph_soc_master_suspend_dc_v2376_idx
on public.ph_soc_master (
  (upper(btrim(coalesce(suspend::text,'')))),
  (lower(btrim(coalesce(suspend_to::text,''))))
);

do $create_fast_suspend_view$
declare
  source_projection text;
begin
  select string_agg(case column_name
    when 'dock' then 'coalesce(nullif(btrim(soc.dock::text),'''') ,''Unassigned'') as dock'
    when 'contsize' then 'coalesce(nullif(btrim(soc.printedcontainercode::text),''''),soc.containersort) as contsize'
    else format('soc.%I',column_name)
  end,E',\n    ' order by ordinal_position)
  into source_projection
  from information_schema.columns
  where table_schema='public' and table_name='ph_soc_master';

  execute format($view$
create or replace view public.ph_active_suspend with (security_invoker=true) as
with active_soc as materialized (
  select %s
  from public.ph_soc_master soc
  where upper(btrim(coalesce(soc.suspend,'')))='SUSPEND'
    and lower(btrim(coalesce(soc.suspend_to,'')))='dc'
    and soc.date_completed is null
    and lower(btrim(coalesce(soc.suspend_candidate_state,'pending'))) not in ('complete','completed','approved','rejected')
), active_item_keys as materialized (
  select distinct lower(btrim(coalesce(itemcode::text,''))) item_key from active_soc
), active_item_location_keys as materialized (
  select distinct lower(btrim(coalesce(itemcode::text,''))) item_key,
    lower(btrim(coalesce(locationcode::text,''))) location_key
  from active_soc
), metric_by_suspend_row as materialized (
  select distinct on (soc.unique_id) soc.unique_id,
    private.request_numeric_v2362(master.ptronhand) on_hand,
    private.request_numeric_v2362(master.ptrreviewed) review,
    private.request_numeric_v2362(master.ptravailable) available,
    private.request_numeric_v2362(master.loc_photo_match::text) loc_photo_match
  from active_soc soc
  left join public.ph_master_inventory master
    on lower(btrim(coalesce(master.itemcode::text,'')))=lower(btrim(coalesce(soc.itemcode::text,'')))
  order by soc.unique_id,
    ((lower(btrim(coalesce(master.locationcode::text,'')))=lower(btrim(coalesce(soc.locationcode::text,''))))::int
      +(lower(btrim(coalesce(master.lotcode::text,'')))=lower(btrim(coalesce(soc.lotcode::text,''))))::int) desc,
    master.unique_id
), open_stock_by_item as materialized (
  select lower(btrim(coalesce(master.itemcode::text,''))) item_key,
    sum(coalesce(private.request_numeric_v2362(master.ptravailable),0)) open_stock
  from public.ph_master_inventory master
  join active_item_keys active on active.item_key=lower(btrim(coalesce(master.itemcode::text,'')))
  where upper(btrim(coalesce(master.lotcode::text,''))) ~ '\.(F1|S1)$'
  group by lower(btrim(coalesce(master.itemcode::text,'')))
), loc_totals_by_item_loc as materialized (
  select lower(btrim(coalesce(master.itemcode::text,''))) item_key,
    lower(btrim(coalesce(master.locationcode::text,''))) location_key,
    sum(coalesce(private.request_numeric_v2362(master.ptronhand),0)) loc_on_hand
  from public.ph_master_inventory master
  join active_item_location_keys active
    on active.item_key=lower(btrim(coalesce(master.itemcode::text,'')))
   and active.location_key=lower(btrim(coalesce(master.locationcode::text,'')))
  group by lower(btrim(coalesce(master.itemcode::text,''))),lower(btrim(coalesce(master.locationcode::text,'')))
)
select soc.*,
  coalesce(metric.on_hand,0) as on_hand,
  coalesce(metric.review,0) as review,
  coalesce(metric.available,0) as available,
  coalesce(stock.open_stock,0) as open_stock,
  coalesce(metric.loc_photo_match,0) as loc_photo_match,
  coalesce(location.loc_on_hand,0) as loc_on_hand,
  'Pending'::text as status,
  'suspend_tag'::text as request_type,
  true as is_suspend_tag,
  soc.suspend_to as suspendto,
  soc.stopnumber as drop_number,
  coalesce(private.request_numeric_v2362(soc.quantityshipped),private.request_numeric_v2362(soc.quantityordered),0) as qty,
  coalesce(soc.consigneename,soc.customername) as consignee,
  coalesce(soc.customername,soc.consigneename) as customer,
  soc.salesrepname as sales_rep
from active_soc soc
left join metric_by_suspend_row metric on metric.unique_id=soc.unique_id
left join open_stock_by_item stock on stock.item_key=lower(btrim(coalesce(soc.itemcode::text,'')))
left join loc_totals_by_item_loc location
  on location.item_key=lower(btrim(coalesce(soc.itemcode::text,'')))
 and location.location_key=lower(btrim(coalesce(soc.locationcode::text,'')));
$view$,source_projection);
end
$create_fast_suspend_view$;

create or replace view public.ph_soc_suspend_tag_rows with (security_invoker=true) as
select * from public.ph_active_suspend;

grant select on public.ph_active_suspend,public.ph_active_request,public.ph_master_inventory,public.ph_soc_master,
  public.ph_reserves,public.ph_cav_import,public.app_dataset_revisions,public.ph_app_settings
to anon,authenticated,service_role;

alter role anon set statement_timeout='120s';
alter role authenticated set statement_timeout='120s';
notify pgrst,'reload config';

do $v2376_contract$
begin
  if not coalesce((select reloptions @> array['security_invoker=true'] from pg_class
    where oid='public.ph_active_suspend'::regclass),false) then
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
$v2376_contract$;

commit;
