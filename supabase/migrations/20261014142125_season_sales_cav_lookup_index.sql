begin;

set local lock_timeout = '5s';
-- Match both MAX(last_updated) and newer-blank CAV lookups performed for
-- each season-sales winner. The older index omits COALESCE and cannot serve
-- these expression predicates.
create index if not exists ph_cav_import_season_sales_normalized_lookup_idx
on public.ph_cav_import (
  upper(btrim(coalesce(itemcode, ''))),
  upper(btrim(coalesce(season, ''))),
  last_updated desc
);

commit;
