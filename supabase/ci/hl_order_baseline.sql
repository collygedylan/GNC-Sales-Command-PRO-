-- CI-only missing legacy SOC shape. This is never a production schema repair.
-- The composed request baseline already owns ph_master_inventory.
create table if not exists public.ph_soc_master (
  unique_id text primary key,
  itemcode text,
  contsize text,
  commonname text,
  locationcode text,
  lotcode text,
  quantityordered text,
  dock text,
  stopnumber text,
  transactionnumber text,
  purchaseordernumber text,
  tripnumber text,
  customeridentityid text,
  customername text,
  consigneeidentityid text,
  consigneename text,
  ptravailable text,
  invoicedate text,
  planstart text,
  planstartdate text
);
