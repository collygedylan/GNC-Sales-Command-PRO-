create or replace view public.v2_view_av_hot_price as
with ranked_cav as (
  select
    c.unique_id,
    c.itemcode as cav_itemcode,
    c.hot_price,
    c.filename as cav_filename,
    c.last_updated as cav_last_updated,
    upper(regexp_replace(c.itemcode, '[^A-Za-z0-9]', '', 'g')) as itemcode_key,
    row_number() over (
      partition by upper(regexp_replace(c.itemcode, '[^A-Za-z0-9]', '', 'g'))
      order by c.last_updated desc nulls last, c.filename desc nulls last, c.unique_id desc
    ) as rn
  from public.v2_cav_import c
  where coalesce(trim(c.hot_price), '') <> ''
    and upper(trim(c.hot_price)) <> 'NULL'
    and coalesce(trim(c.itemcode), '') <> ''
    and upper(trim(c.itemcode)) <> 'NULL'
),
hot_cav as (
  select
    cav_itemcode,
    hot_price,
    cav_filename,
    cav_last_updated,
    itemcode_key
  from ranked_cav
  where rn = 1
)
select
  m.*, 
  hot_cav.hot_price,
  hot_cav.cav_itemcode,
  hot_cav.cav_filename,
  hot_cav.cav_last_updated
from public.v2_master_inventory m
join hot_cav
  on upper(regexp_replace(coalesce(m.itemcode, ''), '[^A-Za-z0-9]', '', 'g')) = hot_cav.itemcode_key
where coalesce(trim(m.itemcode), '') <> '';