create or replace view public.v2_view_av_hot_price_keys as
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
)
select
  itemcode_key,
  cav_itemcode,
  hot_price,
  cav_filename,
  cav_last_updated
from ranked_cav
where rn = 1;

grant select on public.v2_view_av_hot_price_keys to anon, authenticated;
notify pgrst, 'reload schema';