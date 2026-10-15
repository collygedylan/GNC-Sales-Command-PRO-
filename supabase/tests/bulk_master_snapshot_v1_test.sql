-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,warehousei,
  priority,holdstopcode,holdstopreason,locationnote,av_note,assignedto
) values (
  'bulk-v1-existing','BULK-V1','Existing fixture','#1','A.01','L1','PH','10',
  '1',null,null,'live location','keep existing evidence','existing-assignment'
),(
  'bulk-v1-empty-app','BULK-V1-EMPTY','Empty app field fixture','#1','A.03','L3','PH','10',
  '1','LIVE-H','live reason','omitted live location','',''
),(
  'bulk-v1-explicit-null','BULK-V1-NULL','Explicit null fixture','#1','A.04','L4','PH','10',
  '1','LIVE-H-NULL','live null reason','explicit null live location',null,null
);
insert into app_sync_private.ph_master_inventory_source_baselines(
  canonical_unique_id,lineage_key,priority,holdstopcode,holdstopreason
)
select m.unique_id,private.ph_master_inventory_lineage_key_v1(to_jsonb(m)),'1',m.holdstopcode,m.holdstopreason
from public.ph_master_inventory m where m.unique_id='bulk-v1-empty-app';
update public.ph_master_inventory set priority='9' where unique_id='bulk-v1-empty-app';
update app_sync_private.ph_master_inventory_app_edits
set pending_legacy_sync=false,legacy_priority='9'
where canonical_unique_id='bulk-v1-empty-app';
update app_sync_private.ph_master_inventory_source_baselines
set priority='1'
where canonical_unique_id='bulk-v1-empty-app';
select public.begin_dataset_import_v1(
  array['ph_master_inventory'],'b1000000-0000-4000-8000-000000000001',array['ph_master_inventory']);
select set_config('request.headers','{"x-gnc-import-run-id":"b1000000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select public.bulk_import_master_snapshot_v1(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','[]'::jsonb,repeat('a',64))$$,
  '42501','BULK_MASTER_IMPORT_FORBIDDEN','authenticated callers cannot bulk publish');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);

create temporary table bulk_v1_payload(payload jsonb) on commit drop;
insert into bulk_v1_payload values (jsonb_build_array(
  jsonb_build_object('values',jsonb_build_object(
    'unique_id','bulk-v1-existing','itemcode','BULK-V1','commonname','Existing fixture',
    'contsize','#1','locationcode','A.01','lotcode','L1','source','PH','warehousei','10',
    'priority','1','holdstopcode','H','holdstopreason','source hold','locationnote','source location',
    'av_note','source evidence','last_updated','2026-10-14T12:00:00Z','filename','snapshot-a.csv','concat','hash-a'
  ),'rawFields',jsonb_build_array('locationnote')),
  jsonb_build_object('values',jsonb_build_object(
    'unique_id','bulk-v1-new','itemcode','BULK-V1-NEW','commonname','New fixture',
    'contsize','#1','locationcode','A.02','lotcode','L2','source','PH','warehousei','10',
    'priority','3','holdstopcode','H','holdstopreason','new source hold','locationnote','new source location',
    'genusname','Hydrangea macrophylla','assignedto','forged-source-assignment',
    'last_updated','2026-10-14T12:00:00Z','filename','snapshot-a.csv','concat','hash-new'
  ),'rawFields',jsonb_build_array('locationnote')),
  jsonb_build_object('values',jsonb_build_object(
    'unique_id','bulk-v1-empty-app','itemcode','BULK-V1-EMPTY','commonname','Empty app field fixture',
    'contsize','#1','locationcode','A.03','lotcode','L3','source','PH','warehousei','10',
    'av_note','source fills empty app field'
  ),'rawFields','[]'::jsonb),
  jsonb_build_object('values',jsonb_build_object(
    'unique_id','bulk-v1-explicit-null','itemcode','BULK-V1-NULL','commonname','Explicit null fixture',
    'contsize','#1','locationcode','A.04','lotcode','L4','source','PH','warehousei','10',
    'priority','1','holdstopcode',null,'holdstopreason',null,'locationnote',null
  ),'rawFields',jsonb_build_array('locationnote'))
));
create temporary table bulk_v1_first_payload as select payload from bulk_v1_payload;
select throws_ok($$select public.bulk_import_master_snapshot_v1(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000099',
  (select payload || payload from bulk_v1_payload),repeat('d',64))$$,
  '22023','BULK_MASTER_IMPORT_DUPLICATE_UNIQUE_ID','duplicate source unique IDs are rejected before staging');
create temporary table bulk_v1_first as
select public.bulk_import_master_snapshot_v1(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',payload,repeat('a',64)
) as response from bulk_v1_payload;
select is((select response->>'published' from bulk_v1_first),'true','bulk import publishes the complete snapshot');
select is((select (response->>'sourceRows')::int from bulk_v1_first),4,'response reports normalized source row count');
select is((select (response->>'inserted')::int from bulk_v1_first),1,'new source row is inserted');
select is((select (response->>'updated')::int from bulk_v1_first),3,'existing source rows are updated once');
select is((select holdstopcode from public.ph_master_inventory where unique_id='bulk-v1-existing'),null::text,
  'incoming holdstopcode cannot overwrite the live field');
select is((select holdstopreason from public.ph_master_inventory where unique_id='bulk-v1-existing'),null::text,
  'incoming holdstopreason cannot overwrite the live field');
select is((select locationnote from public.ph_master_inventory where unique_id='bulk-v1-existing'),'live location',
  'incoming locationnote cannot overwrite the live field');
select is((select av_note from public.ph_master_inventory where unique_id='bulk-v1-existing'),'keep existing evidence',
  'new raw hold cannot clear existing app evidence');
select is((select av_note from public.ph_master_inventory where unique_id='bulk-v1-empty-app'),'source fills empty app field',
  'source fills an empty app-owned field');
select is((select priority from public.ph_master_inventory where unique_id='bulk-v1-empty-app'),'9',
  'omitted priority preserves the live value instead of restoring an older source baseline');
select is((select assignedto from public.ph_master_inventory where unique_id='bulk-v1-new'),'megan_kelly',
  'database assignment override replaces a forged source assignment');
select is((select jsonb_build_array(holdstopcode,holdstopreason,locationnote)
  from public.ph_master_inventory where unique_id='bulk-v1-empty-app'),
  '["LIVE-H","live reason","omitted live location"]'::jsonb,
  'omitted protected fields retain existing live values');
select is((select jsonb_build_array(holdstopcode,holdstopreason,locationnote)
  from public.ph_master_inventory where unique_id='bulk-v1-explicit-null'),
  '["LIVE-H-NULL","live null reason","explicit null live location"]'::jsonb,
  'explicit null protected fields retain existing live values');
select is((select holdstopcode from app_sync_private.ph_master_inventory_source_baselines where canonical_unique_id='bulk-v1-explicit-null'),
  null::text,'explicit null is acknowledged as a source value in the private baseline');
select is((select holdstopcode from public.ph_master_inventory where unique_id='bulk-v1-new'),null::text,
  'new rows do not receive imported holdstopcode');
select is((select locationnote from public.ph_master_inventory where unique_id='bulk-v1-new'),null::text,
  'new rows do not receive imported locationnote');
select is((select holdstopcode from app_sync_private.ph_master_inventory_source_baselines where canonical_unique_id='bulk-v1-existing'),'H',
  'raw holdstopcode is acknowledged in the private source baseline');
select is((select field_values->>'locationnote' from app_sync_private.ph_master_inventory_item6_source_v7 where canonical_unique_id='bulk-v1-existing'),'source location',
  'raw locationnote is acknowledged in the private item6 source baseline');
select is((select field_values->>'locationnote' from app_sync_private.ph_master_inventory_item6_source_v7 where canonical_unique_id='bulk-v1-new'),'new source location',
  'new row records raw locationnote without changing its live value');

-- Sync metadata changes alone do not trigger an UPDATE or count as changed rows.
update bulk_v1_payload set payload = jsonb_set(jsonb_set(payload,'{0,values,last_updated}','"2026-10-15T12:00:00Z"'),'{0,values,filename}','"snapshot-b.csv"');
update bulk_v1_payload set payload = jsonb_set(jsonb_set(payload,'{1,values,last_updated}','"2026-10-15T12:00:00Z"'),'{1,values,filename}','"snapshot-b.csv"');
update bulk_v1_payload set payload = jsonb_set(jsonb_set(payload,'{2,values,last_updated}','"2026-10-15T12:00:00Z"'),'{2,values,filename}','"snapshot-b.csv"');
update bulk_v1_payload set payload = jsonb_set(jsonb_set(payload,'{3,values,last_updated}','"2026-10-15T12:00:00Z"'),'{3,values,filename}','"snapshot-b.csv"');
create temporary table bulk_v1_noop as
select public.bulk_import_master_snapshot_v1(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002',payload,repeat('b',64)
) as response from bulk_v1_payload;
select is((select (response->>'updated')::int from bulk_v1_noop),0,'timestamp and filename changes alone are no-op');
select is((select (response->>'unchanged')::int from bulk_v1_noop),4,'unchanged rows are reported accurately');

select public.finish_dataset_import_v1('b1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.bulk_import_master_snapshot_v1(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000003',
  (select payload from bulk_v1_payload),repeat('e',64))$$,
  '55000','MASTER_PRIORITY_HOLD_IMPORT_FENCE_LOST','a new request cannot write after its import fence closes');
select is((select public.bulk_import_master_snapshot_v1(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',payload,repeat('a',64)
) from bulk_v1_first_payload),(select response from bulk_v1_first),'exact request retry replays its saved receipt after fence closure');
select throws_ok($$select public.bulk_import_master_snapshot_v1(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
  (select payload from bulk_v1_payload),repeat('c',64))$$,
  '22023','BULK_MASTER_IMPORT_REQUEST_ID_REUSED','request UUID cannot be reused with different contents');
select ok(not has_table_privilege('anon','app_sync_private.ph_master_bulk_import_source_v1','select'),
  'private source fingerprint table is not browser-readable');

-- A changed source UID with the same stable lineage must update the canonical
-- row, acknowledge the exact pending app tuple, and remain in the snapshot.
select set_config('request.headers','{}',true);
update public.ph_master_inventory
set priority='1',holdstopcode='H',holdstopreason='source hold'
where unique_id='bulk-v1-existing';
select ok((select pending_legacy_sync from app_sync_private.ph_master_inventory_app_edits
  where canonical_unique_id='bulk-v1-existing'),'app tuple change creates a pending exact-ack marker');
create temporary table bulk_v1_alias_payload as
select jsonb_set(payload,'{0,values,unique_id}','"bulk-v1-existing-alias"') as payload
from bulk_v1_first_payload;
select public.begin_dataset_import_v1(
  array['ph_master_inventory'],'b1000000-0000-4000-8000-000000000002',array['ph_master_inventory']);
select set_config('request.headers','{"x-gnc-import-run-id":"b1000000-0000-4000-8000-000000000002"}',true);
create temporary table bulk_v1_alias_result as
select public.bulk_import_master_snapshot_v1(
  'b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000004',payload,repeat('f',64)
) as response from bulk_v1_alias_payload;
select is((select count(*)::int from public.ph_master_inventory where unique_id='bulk-v1-existing'),1,
  'changed source UID retains its canonical inventory row');
select is((select count(*)::int from public.ph_master_inventory where unique_id='bulk-v1-existing-alias'),0,
  'changed source UID is not published as a duplicate live row');
select ok(not (select pending_legacy_sync from app_sync_private.ph_master_inventory_app_edits
  where canonical_unique_id='bulk-v1-existing'),'the exact raw priority and hold tuple acknowledges pending app state');
select public.finish_dataset_import_v1('b1000000-0000-4000-8000-000000000002');
select set_config('request.headers','{}',true);

-- Two canonical rows sharing one lineage make an imported alias ambiguous;
-- the RPC must reject the snapshot before changing either row.
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,source,warehousei,priority
) values
  ('bulk-v1-ambiguous-a','BULK-V1-AMBIG','Ambiguous fixture','#1','Z.01','ZA','PH','10','1'),
  ('bulk-v1-ambiguous-b','BULK-V1-AMBIG','Ambiguous fixture','#1','Z.01','ZA','PH','10','1');
insert into app_sync_private.ph_master_inventory_source_baselines(
  canonical_unique_id,lineage_key,priority,holdstopcode,holdstopreason
)
select m.unique_id,private.ph_master_inventory_lineage_key_v1(to_jsonb(m)),m.priority,m.holdstopcode,m.holdstopreason
from public.ph_master_inventory m where m.unique_id in ('bulk-v1-ambiguous-a','bulk-v1-ambiguous-b');
create temporary table bulk_v1_ambiguous_payload(payload jsonb) on commit drop;
insert into bulk_v1_ambiguous_payload values(jsonb_build_array(jsonb_build_object(
  'values',jsonb_build_object('unique_id','bulk-v1-ambiguous-source','itemcode','BULK-V1-AMBIG',
    'commonname','Ambiguous fixture','contsize','#1','locationcode','Z.01','lotcode','ZA',
    'source','PH','warehousei','10','priority','1'),
  'rawFields','[]'::jsonb
)));
select public.begin_dataset_import_v1(
  array['ph_master_inventory'],'b1000000-0000-4000-8000-000000000003',array['ph_master_inventory']);
select set_config('request.headers','{"x-gnc-import-run-id":"b1000000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select public.bulk_import_master_snapshot_v1(
  'b1000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000005',
  (select payload from bulk_v1_ambiguous_payload),repeat('1',64))$$,
  '40001','BULK_MASTER_IMPORT_LINEAGE_AMBIGUOUS','ambiguous UID aliases reject atomically');
select is((select count(*)::int from public.ph_master_inventory where unique_id in ('bulk-v1-ambiguous-a','bulk-v1-ambiguous-b')),2,
  'ambiguous alias rejection preserves both canonical rows');
select * from finish();
rollback;
