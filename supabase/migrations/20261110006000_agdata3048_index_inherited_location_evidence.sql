begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- The protected publication trigger and its inheritance helper keep their
-- definitions. Support their exact physical-location lookups without a scan
-- of unrelated evidence for every new ERP identity.
create index inventory_location_evidence_location_v3048_idx
  on app_sync_private.inventory_location_evidence_v1(itemcode_key,locationcode_key);
create index ph_location_sales_notes_location_v3048_idx
  on public.ph_location_sales_notes(upper(btrim(itemcode)),upper(btrim(locationcode)));

commit;
