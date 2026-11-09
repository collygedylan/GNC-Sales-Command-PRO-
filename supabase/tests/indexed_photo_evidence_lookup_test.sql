-- @test-runtime: canonical
begin;
do $$ begin
  if not exists(select 1 from private.ci_schema_workspace_guard where marker='canonical-baseline-replay') then
    raise exception 'INDEXED_PHOTO_FIXTURE_REQUIRES_DISPOSABLE_SCHEMA_WORKSPACE';
  end if;
end $$;
create extension if not exists pgtap with schema extensions;
set local search_path=public,private,extensions,pg_temp;
select plan(6);

set local session_replication_role=replica;
insert into public.ph_master_inventory(unique_id,itemcode,locationcode,lotcode,photo_link) values
  ('CI-PHOTO-INDEX-1',' ci-photo-lookup ',' ci-bay ','27.F1','https://fixture.invalid/exact'),
  ('CI-PHOTO-INDEX-2','CI-PHOTO-LOOKUP','CI-BAY','27.S1','https://fixture.invalid/other-lot'),
  ('CI-PHOTO-INDEX-3','CI-PHOTO-LOOKUP','CI-OTHER','27.F1','https://fixture.invalid/other-bay'),
  ('CI-PHOTO-INDEX-4',null,'CI-BAY','27.F1','https://fixture.invalid/null-item'),
  ('CI-PHOTO-INDEX-5','','CI-BAY','27.F1','https://fixture.invalid/empty-item');
set local session_replication_role=origin;

select is(private.collect_item_detail_photo_links_v308('ci-photo-lookup',' CI-BAY','27.f1','[]'),
  'https://fixture.invalid/exact','existing lot, case and whitespace semantics are preserved');
select is(private.collect_item_detail_photo_links_v308('ci-photo-lookup','CI-BAY','missing','[]'),
  'https://fixture.invalid/exact,https://fixture.invalid/other-lot','missing lot falls back within the exact location');
select is(private.collect_item_detail_photo_links_v308('','CI-BAY','27.F1','[]'),
  'https://fixture.invalid/empty-item','an empty item does not select a null stored item');
select is(private.collect_item_detail_photo_links_v308(null,'CI-BAY','27.F1','[]'),
  '','a null parameter does not select inventory');
select is(private.collect_item_detail_photo_links_v308(null,null,null,
  '[{"photo_url":"https://fixture.invalid/last","photo_link":"https://fixture.invalid/first","junk":"https://fixture.invalid/ignore"},["https://fixture.invalid/array","https://fixture.invalid/first"]]'),
  'https://fixture.invalid/first,https://fixture.invalid/last,https://fixture.invalid/array',
  'payload-only calls preserve photo-field order, array entries, and deduplication');
select ok(not has_function_privilege('anon','private.collect_item_detail_photo_links_v308(text,text,text,jsonb)','execute')
  and not has_function_privilege('authenticated','private.collect_item_detail_photo_links_v308(text,text,text,jsonb)','execute'),
  'private lookup still has no browser grants');
select * from finish();
rollback;
