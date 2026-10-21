begin;
set local lock_timeout = '1s';
set local statement_timeout = '15s';

-- Audited against production pg_indexes: the master triple covers item and
-- item/location prefixes. CAV has no lotcode. SOC uses stopnumber, not drop_num.
-- Reserves already has (locationcode,itemcode,lotcode,contsize); watchdog has
-- an open-status/last_seen_at partial index; history already indexes updated_at.
create index if not exists ph_master_inventory_item_loc_lot_idx on public.ph_master_inventory (itemcode, locationcode, lotcode) INCLUDE (ptronhand, ptravailable);
create index if not exists ph_master_inventory_location_idx on public.ph_master_inventory (locationcode);
create index if not exists ph_master_inventory_commonname_idx on public.ph_master_inventory (commonname);
create index if not exists ph_soc_master_dock_stop_item_idx on public.ph_soc_master (dock, stopnumber, itemcode);
create index if not exists ph_soc_master_item_loc_lot_idx on public.ph_soc_master (itemcode, locationcode, lotcode);
create index if not exists ph_soc_master_location_idx on public.ph_soc_master (locationcode);
create index if not exists ph_soc_master_last_updated_idx on public.ph_soc_master (last_updated DESC);
create index if not exists ph_customer_rep_name_tuple_idx on public.ph_customer_consignee_sales_reps (salesrepname, customername, consigneename);
create index if not exists ph_warehouse_assigned_item_loc_idx on public.ph_warehouse_assigned_items (itemcode, locationcode);
create index if not exists ph_active_request_item_loc_idx on public.ph_active_request (itemcode, locationcode);
create index if not exists ph_active_request_status_updated_idx on public.ph_active_request (req_status, updated_at DESC);
create index if not exists ph_request_history_item_loc_idx on public.ph_request_history (itemcode, locationcode);
create index if not exists ph_request_history_status_updated_idx on public.ph_request_history (req_status, updated_at DESC);

analyze public.ph_master_inventory;
analyze public.ph_cav_import;
analyze public.ph_soc_master;
analyze public.ph_customer_consignee_sales_reps;
analyze public.ph_reserves;
analyze public.ph_warehouse_assigned_items;
analyze public.ph_active_request;
analyze public.ph_request_history;
analyze public.app_runtime_watchdog_events;
analyze public.profiles;
analyze public.ph_app_users;
analyze public.ph_inventory_row_assignments;
analyze public.ph_itemcode_default_owners;
commit;
