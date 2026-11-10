create temporary table erp_drive_single_write_probe(name_changed boolean,raw_stock_changed boolean);

create function pg_temp.capture_erp_drive_single_write()
returns trigger language plpgsql as $capture$
begin
  insert into pg_temp.erp_drive_single_write_probe
  values(old.commonname is distinct from new.commonname,old.erp_on_hand is distinct from new.erp_on_hand);
  return null;
end
$capture$;

create trigger erp_drive_single_write_fixture after update on public.ph_master_inventory
for each row when(new.unique_id='erp-delta-fixture-stock'
  and (old.commonname is distinct from new.commonname or old.erp_on_hand is distinct from new.erp_on_hand))
execute function pg_temp.capture_erp_drive_single_write();
