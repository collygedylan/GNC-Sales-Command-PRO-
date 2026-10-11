-- @test-runtime: canonical
begin;
select plan(14);

select ok(private.ph_holdstop_strict_reduction_v1('HS','S'),'removing only H from HS is a strict reduction');
select ok(private.ph_holdstop_strict_reduction_v1('HS',''),'removing both H and S is a strict reduction');
select ok(not private.ph_holdstop_strict_reduction_v1('H','S'),'replacing H with S adds a different blocker');
select ok(not private.ph_holdstop_strict_reduction_v1('','H'),'adding H is not a reduction');
select ok(not private.ph_holdstop_strict_reduction_v1('S','S'),'unchanged blocking set is not a reduction');

insert into public.ph_master_inventory(
  unique_id,itemcode,priority,holdstopcode,holdstopreason,av_note,spec,caliper,
  photo_link,photo_name,match,loc_match_qty,initial_ptr,date_completed
) values
  ('P25-HS-TO-S','P25-HS-TO-S','1','HS','both','note hs','spec hs','cal hs','photo hs','photo hs','70','4','8','2026-10-08'::timestamptz),
  ('P25-HS-TO-CLEAR','P25-HS-TO-CLEAR','1','HS','both','note clear','spec clear','cal clear','photo clear','photo clear','71','5','9','2026-10-08'::timestamptz),
  ('P25-H-TO-S','P25-H-TO-S','1','H','hold','note swap','spec swap','cal swap','photo swap','photo swap','72','6','10','2026-10-08'::timestamptz),
  ('P25-ADD-H','P25-ADD-H','1',null,null,'note add','spec add','cal add','photo add','photo add','73','7','11','2026-10-08'::timestamptz),
  ('P25-PRIORITY','P25-PRIORITY','1',null,null,'note priority','spec priority','cal priority','photo priority','photo priority','74','8','12','2026-10-08'::timestamptz);

update public.ph_master_inventory
set holdstopcode='S',holdstopreason='remaining stop',priority='2'
where unique_id='P25-HS-TO-S';
select is((select av_note from public.ph_master_inventory where unique_id='P25-HS-TO-S'),'note hs','HS to S tied to priority preserves AV note');
select is((select spec from public.ph_master_inventory where unique_id='P25-HS-TO-S'),'spec hs','HS to S tied to priority preserves spec');
select is((select photo_link from public.ph_master_inventory where unique_id='P25-HS-TO-S'),'photo hs','HS to S tied to priority preserves photo');
select is((select av_rule_last_clear_reason from public.ph_master_inventory where unique_id='P25-HS-TO-S'),null::text,'HS to S does not mint an automatic reset marker');

update public.ph_master_inventory set holdstopcode=null,holdstopreason=null
where unique_id='P25-HS-TO-CLEAR';
select is((select av_note from public.ph_master_inventory where unique_id='P25-HS-TO-CLEAR'),'note clear','removing final H/S preserves evidence');

update public.ph_master_inventory set holdstopcode='S',holdstopreason='new stop'
where unique_id='P25-H-TO-S';
select is((select av_note from public.ph_master_inventory where unique_id='P25-H-TO-S'),null::text,'H to S adds a blocking token and clears verified evidence');
select is((select av_rule_last_clear_reason from public.ph_master_inventory where unique_id='P25-H-TO-S'),'hold_stop_changed',
  'H to S adds a distinct blocking token and records the normal reset marker');

update public.ph_master_inventory set holdstopcode='H',holdstopreason='new hold'
where unique_id='P25-ADD-H';
select is((select av_note from public.ph_master_inventory where unique_id='P25-ADD-H'),null::text,'new H still clears evidence');

update public.ph_master_inventory set priority='2'
where unique_id='P25-PRIORITY';
select is((select av_note from public.ph_master_inventory where unique_id='P25-PRIORITY'),null::text,'priority-only still clears evidence');

select * from finish();
rollback;
