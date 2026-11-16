-- @test-runtime: canonical
begin;
do $guard$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'PHYSICAL_PHOTO_FIXTURE_REQUIRES_DISPOSABLE_SCHEMA';
  end if;
end $guard$;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(5);
set local session_replication_role=replica;
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,photo_link) values
  ('CI-PHOTO-PHYSICAL-A','CI-PHYSICAL','CI-BAY','27.F1','https://fixture.invalid/row-a'),
  ('CI-PHOTO-PHYSICAL-B','CI-PHYSICAL','CI-BAY','27.F1','https://fixture.invalid/row-b'),
  ('CI-PHOTO-PHYSICAL-C','CI-PHYSICAL','OTHER-BAY','27.F1','https://fixture.invalid/other-bay');
set local session_replication_role=origin;
select is(private.collect_item_detail_photo_links_v308('CI-PHYSICAL','CI-BAY','27.F1','[]'),
  '','item, location and lot without physical identity never merge photos');
select is(private.collect_item_detail_photo_links_v308('CI-PHYSICAL','CI-BAY','27.F1','[{"unique_id":"CI-PHOTO-PHYSICAL-C"}]'),
  '','a physical ID in another location never leaks its evidence');
select is(private.collect_item_detail_photo_links_v308('CI-PHYSICAL','CI-BAY','27.S1','[{"unique_id":"CI-PHOTO-PHYSICAL-A"}]'),
  '','an exact physical ID with a wrong lot never falls back');
select is(private.collect_item_detail_photo_links_v308('CI-PHYSICAL','CI-BAY','27.F1','[{"unique_id":"CI-PHOTO-PHYSICAL-A"}]'),
  'https://fixture.invalid/row-a','exact physical row A owns only its photo');
select is(private.collect_item_detail_photo_links_v308('CI-PHYSICAL','CI-BAY','27.F1','[{"unique_id":"CI-PHOTO-PHYSICAL-B"}]'),
  'https://fixture.invalid/row-b','same-item same-lot sibling B retains separate evidence');
select * from finish();
rollback;
