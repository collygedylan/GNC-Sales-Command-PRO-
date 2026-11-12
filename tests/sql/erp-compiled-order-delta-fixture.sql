-- Run within an isolated rollback. The raw owner is the reference for every
-- input and result column, including nullable photo dates and numeric scale.
create temp table delta_example (
  n integer primary key, incoming_oh text, incoming_review text, erp_oh numeric, erp_review numeric,
  master_oh text, master_review text, match_qty text, photo_days integer, expected_delta numeric, pending_out numeric
);
insert into delta_example values
  (1,'10.00','3.0',10,3,'100','100','9',1,0,7),
  (2,'10','5',10,2,'100','100','2',1,3,0),
  (3,'12','5',20,3,'100','100','10',1,5,5),
  (4,'25','4',20,9,'100','100','5',12,0,0),
  (5,'8','4.25',null,null,'19','4.25','4.00',null,2.5,2),
  (6,null,'1,000',null,null,'5','+9','invalid',null,5,0),
  (7,'-4.50','1e3',0,-3,'99','99','0',null,7.5,0),
  (8,'400','400',1,1,'1','1','0',null,null,0);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,
  ptronhand,ptrreviewed,ptravailable,erp_on_hand,erp_ptrreview,loc_photo_match,loc_match_qty,photo_date)
select 'delta-fixture-'||n,'delta-stock-'||n,'delta fixture','#1','X.93.001','26.F1','PH',
  master_oh,master_review,'5',erp_oh,erp_review,null,match_qty,case when photo_days is not null then now()-photo_days*interval '1 day' end
from delta_example;
do $photos$
declare e record;
begin
  perform set_config('app.eval_publication_v309','on',true);
  for e in select n,photo_days,match_qty from delta_example where photo_days is not null loop
    perform set_config('app.eval_publication_uid_v309','delta-fixture-'||e.n,true);
    update public.ph_master_inventory set spec='fixture spec',photo_link='https://fixture.invalid/order-delta-'||e.n||'.jpg',
      loc_match_qty=e.match_qty,photo_date=now()-e.photo_days*interval '1 day' where unique_id='delta-fixture-'||e.n;
  end loop;
  perform set_config('app.eval_publication_v309','off',true);
end $photos$;
delete from app_sync_private.inventory_live_overrides_v1
  where canonical_unique_id in(select 'delta-fixture-'||n from delta_example);
insert into app_sync_private.inventory_live_overrides_v1(canonical_unique_id,field_name,erp_baseline_value,app_override_value,latest_erp_value,pending,updated_by)
values ('delta-fixture-1','ptronhand','"10"','"3"','"99"',true,'fixture'),
  ('delta-fixture-3','ptronhand','"20"','"15"','"99"',true,'fixture'),
  ('delta-fixture-5','ptronhand','"15.50"','"13.5"','" 12.50 "',true,'fixture'),
  ('delta-fixture-5','ptrreviewed','"0"','"0"','"oops"',false,'fixture'),
  ('delta-fixture-6','ptronhand','null','null','""',false,'fixture'),
  ('delta-fixture-7','ptronhand','"10"','"12"','"99"',true,'fixture');
select private.prepare_master_bulk_stage_v3046(jsonb_agg(jsonb_build_object('values',jsonb_build_object(
  'unique_id','delta-source-'||n,'itemcode','delta-stock-'||n,'ptronhand',incoming_oh,'ptrreviewed',incoming_review),
  'rawFields','[]'::jsonb) order by n)) from delta_example;
create temp table ph_master_bulk_map_v1 as select n::bigint row_number,'delta-fixture-'||n canonical_unique_id,
  case when n=8 then 2 else 1 end candidate_count from delta_example;
-- A caller-supplied prepared flag cannot replace the owned compiled binding.
select set_config('agdata.erp.prepared_drive','on',true);
select private.capture_drive_order_delta_v3078();
create temp table delta_raw_reference as select * from pg_temp.erp_order_delta_v23196;
drop table pg_temp.erp_order_delta_v23196;
select private.build_compiled_drive_order_delta_v3078();

do $equivalence$
begin
  assert not exists((select * from delta_raw_reference except all select * from pg_temp.erp_order_delta_v23196)
    union all (select * from pg_temp.erp_order_delta_v23196 except all select * from delta_raw_reference));
  assert (select count(*)=7 and bool_and(d.order_delta=e.expected_delta and d.pending_out=e.pending_out)
    from pg_temp.erp_order_delta_v23196 d join delta_example e on e.n=d.row_number);
  assert (select old_oh=12.50 and old_review=4.25 from pg_temp.erp_order_delta_v23196 where row_number=5);
  assert (select old_oh=5 and old_review=0 and new_oh=0 and new_review=0 and photo_date is null
    from pg_temp.erp_order_delta_v23196 where row_number=6);
  assert (select photo_date<now()-interval '10 days' and order_delta=0 from pg_temp.erp_order_delta_v23196 where row_number=4);
  assert (select photo_date>now()-interval '10 days' and order_delta=0 from pg_temp.erp_order_delta_v23196 where row_number=1);
  assert (select bool_and(numeric_send(a.order_delta)=numeric_send(d.order_delta))
    from delta_raw_reference a join pg_temp.erp_order_delta_v23196 d using(row_number));
  assert not has_function_privilege('service_role','private.build_compiled_drive_order_delta_v3078()','EXECUTE');
  assert not has_function_privilege('authenticated','private.capture_drive_order_delta_v3078()','EXECUTE');
end $equivalence$;
