-- Convert the temporary stored snapshot into a live Supabase view.
-- The parsed PO import is the row driver, so the view updates automatically
-- whenever Apps Script updates ph_27f1_hl_po, ph_master_inventory, or ph_soc_master.

drop table if exists public.ph_view_po_27f1_hl cascade;
drop view if exists public.ph_view_po_27f1_hl cascade;

create view public.ph_view_po_27f1_hl
with (security_invoker = true)
as
with latest_po_scope as (
  select coalesce(nullif(run_id, ''), source_file_id) as scope_key
  from public.ph_27f1_hl_po
  where coalesce(nullif(run_id, ''), source_file_id) is not null
  order by imported_at desc, id desc
  limit 1
),
po_base as (
  select
    p.*,
    row_number() over (
      partition by nullif(btrim(p.item_code), '')
      order by p.row_index, p.id
    ) as item_row_number
  from public.ph_27f1_hl_po p
  join latest_po_scope latest
    on coalesce(nullif(p.run_id, ''), p.source_file_id) = latest.scope_key
  where nullif(btrim(p.item_code), '') is not null
),
inventory_numbered as (
  select
    nullif(btrim(itemcode), '') as itemcode,
    upper(nullif(btrim(lotcode), '')) as lotcode,
    nullif(btrim(commonname), '') as commonname,
    nullif(btrim(contsize), '') as contsize,
    nullif(btrim(locationcode), '') as locationcode,
    nullif(btrim(priority), '') as priority,
    nullif(btrim(holdstopcode), '') as holdstopcode,
    nullif(btrim(holdstopreason), '') as holdstopreason,
    case
      when cleaned_ptronhand ~ '^-?[0-9]+(\.[0-9]+)?$' then cleaned_ptronhand::numeric
      when cleaned_ptronhand ~ '^\([0-9]+(\.[0-9]+)?\)$' then ('-' || trim(both '()' from cleaned_ptronhand))::numeric
      else null
    end as ptronhand_num
  from (
    select
      inv.*,
      regexp_replace(replace(replace(replace(coalesce(inv.ptronhand, ''), '$', ''), ',', ''), '%', ''), '[[:space:]]', '', 'g') as cleaned_ptronhand
    from public.ph_master_inventory inv
  ) inv
  where nullif(btrim(itemcode), '') is not null
    and nullif(btrim(lotcode), '') is not null
    and upper(btrim(lotcode)) ~ '^\d+\.[A-Z0-9]+'
    and split_part(upper(btrim(lotcode)), '.', 1)::integer <= 27
    and split_part(upper(btrim(lotcode)), '.', 2) in ('F1', 'U1', 'U2', 'S1')
),
inventory_lot as (
  select
    itemcode,
    lotcode,
    min(commonname) as commonname,
    min(contsize) as contsize,
    string_agg(distinct locationcode, ', ' order by locationcode) filter (where locationcode is not null) as locationcode,
    string_agg(distinct priority, ', ' order by priority) filter (where priority is not null) as priority,
    string_agg(distinct holdstopcode, ', ' order by holdstopcode) filter (where holdstopcode is not null) as holdstopcode,
    string_agg(distinct holdstopreason, ', ' order by holdstopreason) filter (where holdstopreason is not null) as holdstopreason,
    sum(ptronhand_num) as ptronhand
  from inventory_numbered
  group by itemcode, lotcode
),
inventory_item as (
  select itemcode, sum(ptronhand_num) as total_ptronhand
  from inventory_numbered
  group by itemcode
),
soc_numbered as (
  select
    nullif(btrim(itemcode), '') as itemcode,
    nullif(btrim(commonname), '') as commonname,
    nullif(btrim(salesrepid), '') as salesrepid,
    nullif(btrim(salesrepname), '') as salesrepname,
    nullif(btrim(customername), '') as customername,
    nullif(btrim(consigneename), '') as consigneename,
    nullif(btrim(consigneestate), '') as consigneestate,
    nullif(btrim(stopnumber), '') as stopnumber,
    nullif(btrim(requestdate), '') as requestdate,
    nullif(btrim(stagename), '') as stagename,
    nullif(btrim(step), '') as step,
    nullif(btrim(dock), '') as dock,
    unique_id,
    case
      when cleaned_quantityordered ~ '^-?[0-9]+(\.[0-9]+)?$' then cleaned_quantityordered::numeric
      when cleaned_quantityordered ~ '^\([0-9]+(\.[0-9]+)?\)$' then ('-' || trim(both '()' from cleaned_quantityordered))::numeric
      else null
    end as quantityordered
  from (
    select
      soc.*,
      regexp_replace(replace(replace(replace(coalesce(soc.quantityordered, ''), '$', ''), ',', ''), '%', ''), '[[:space:]]', '', 'g') as cleaned_quantityordered
    from public.ph_soc_master soc
  ) soc
  where nullif(btrim(itemcode), '') is not null
    and coalesce(upper(stagename), '') not like '%SHIPPED%'
    and coalesce(upper(stagename), '') not like '%COMPLETED%'
),
soc_totals as (
  select itemcode, sum(coalesce(quantityordered, 0)) as total_quantity_ordered
  from soc_numbered
  group by itemcode
),
soc_detail as (
  select
    s.*,
    row_number() over (partition by itemcode order by unique_id) as item_row_number
  from soc_numbered s
)
select
  p.id,
  p.run_id,
  p.row_index,
  nullif(btrim(p.item_code), '') as itemcode,
  coalesce(inv.commonname, nullif(btrim(p.common_name), '')) as commonname,
  coalesce(inv.contsize, nullif(btrim(p.size), '')) as contsize,
  inv.locationcode,
  inv.priority,
  nullif(btrim(p.lot), '') as lotcode,
  inv.holdstopcode,
  inv.holdstopreason,
  case
    when p.item_row_number = 1 then coalesce(soc_total.total_quantity_ordered, p.po_ordered)
    else null
  end as total_quantity_ordered,
  coalesce(inv.ptronhand, p.seas_on_hand) as ptronhand,
  case
    when p.item_row_number = 1 then inv_item.total_ptronhand
    else null
  end as total_ptronhand,
  p.lot_pend_rec,
  soc.salesrepid,
  soc.salesrepname,
  soc.customername,
  soc.consigneename,
  soc.consigneestate,
  soc.stopnumber,
  soc.quantityordered,
  soc.requestdate,
  soc.stagename,
  soc.step,
  soc.dock,
  p.po_remain,
  p.created_at,
  coalesce(p.imported_at, p.created_at) as built_at
from po_base p
left join inventory_lot inv
  on inv.itemcode = nullif(btrim(p.item_code), '')
 and inv.lotcode = upper(nullif(btrim(p.lot), ''))
left join inventory_item inv_item
  on inv_item.itemcode = nullif(btrim(p.item_code), '')
left join soc_totals soc_total
  on soc_total.itemcode = nullif(btrim(p.item_code), '')
left join soc_detail soc
  on soc.itemcode = nullif(btrim(p.item_code), '')
 and soc.item_row_number = p.item_row_number;

revoke all on table public.ph_view_po_27f1_hl from anon;
revoke all on table public.ph_view_po_27f1_hl from authenticated;
grant select on table public.ph_view_po_27f1_hl to service_role;

notify pgrst, 'reload schema';
