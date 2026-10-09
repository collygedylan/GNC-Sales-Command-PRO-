-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
select plan(76);

select has_function('private','guard_ph_master_inventory_priority_hold_v1',array[]::text[],'master legacy-field shield trigger function exists');
select ok(not has_table_privilege('authenticated','app_sync_private.ph_master_inventory_app_edits','select'),'app-edit shield state is private');
select ok(not has_table_privilege('service_role','app_sync_private.ph_master_inventory_app_edits','select'),'service callers cannot read shield state directly');

insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei,av_note,
  assignedto,app_tab_assignment,spec,photo_link
) values
  ('smart-shield-main','SMART-SHIELD-MAIN','Synthetic shield plant','#3','A.01.001','27.F1','10','9','1','PH','F1','27','D1','C1','L1','10','preserve this evidence',null,null,null,null),
  ('smart-shield-alias-canonical','SMART-SHIELD-ALIAS','Synthetic alias plant','#3','B.01.001','27.F1','20','19','1','PH','F1','27','D2','C2','L2','10','alias AV note','Dylan','av','alias spec','https://example.invalid/alias.jpg'),
  ('smart-shield-exact-a','SMART-SHIELD-EXACT','Synthetic exact plant','#3','C.01.001','27.F1','30','29','1','PH','F1','27','D3','C3','L3','10',null,null,null,null,null),
  ('smart-shield-exact-b','SMART-SHIELD-EXACT','Synthetic exact plant','#3','C.01.001','27.F1','30','29','1','PH','F1','27','D3','C3','L3','10',null,null,null,null,null),
  ('smart-v6-source','SMART-V6','Synthetic V6 source','#3','D.01.001','27.F1','10','9','3','PH','F1','27','D4','C4','L4','10',null,null,null,null,null),
  ('smart-v6-prior','SMART-V6','Synthetic prior-season sibling','#3','D.02.001','26.F1','10','9','2','PH','F1','26','D5','C5','L5','10',null,null,null,null,null),
  ('smart-v6-future','SMART-V6','Synthetic future sibling','#3','D.03.001','28.F1','10','9','2','PH','F1','28','D6','C6','L6','10',null,null,null,null,null),
  ('smart-v6-other-season','SMART-V6','Synthetic other-season row','#3','D.04.001','27.F2','10','9','2','PH','F2','27','D7','C7','L7','10',null,null,null,null,null);

insert into app_sync_private.ph_master_inventory_source_baselines(
  canonical_unique_id,lineage_key,priority,holdstopcode,holdstopreason
)
select m.unique_id,private.ph_master_inventory_lineage_key_v1(to_jsonb(m)),m.priority,m.holdstopcode,m.holdstopreason
from public.ph_master_inventory m where m.unique_id in (
  'smart-shield-alias-canonical','smart-shield-exact-a','smart-shield-exact-b'
)
on conflict (canonical_unique_id) do update set
  lineage_key=excluded.lineage_key,priority=excluded.priority,
  holdstopcode=excluded.holdstopcode,holdstopreason=excluded.holdstopreason;

select set_config('request.headers','{}',true);
select set_config('request.jwt.claim.role','service_role',true);
update public.ph_master_inventory
set priority='4',holdstopcode='H',holdstopreason='App-managed hold'
where unique_id='smart-shield-main';
update public.ph_master_inventory set av_note='preserve this evidence'
where unique_id='smart-shield-main';
select ok((select pending_legacy_sync from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id='smart-shield-main'),
  'an app priority/hold edit creates a pending legacy acknowledgement');
select ok((select concat like 'smart-shield-pending:%' from public.ph_master_inventory where unique_id='smart-shield-main'),
  'the importer hash is invalidated until the old tuple is acknowledged');
select is((select count(*)::integer from app_sync_private.ph_master_inventory_source_baselines where canonical_unique_id='smart-shield-main'),1,
  'the first app edit records a stable baseline for future priority-derived UID aliases');
update public.ph_master_inventory set priority='2' where unique_id='smart-shield-alias-canonical';
update public.ph_master_inventory set av_note='alias AV note',assignedto='Dylan',app_tab_assignment='av',
  spec='alias spec',photo_link='https://example.invalid/alias.jpg'
where unique_id='smart-shield-alias-canonical';
select ok((select pending_legacy_sync from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id='smart-shield-alias-canonical'),
  'a changed-UID candidate has a real app edit before its import fence begins');

select public.begin_dataset_import_v1(array['ph_master_inventory'],'9b000000-0000-4000-8000-000000000001');
select set_config('request.headers','{"x-gnc-import-run-id":"9b000000-0000-4000-8000-000000000001"}',true);
update public.ph_master_inventory set
  priority='1',holdstopcode=null,holdstopreason=null,concat='stale-legacy-hash',av_note=null
where unique_id='smart-shield-main';
select is((select jsonb_build_array(priority,holdstopcode,holdstopreason) from public.ph_master_inventory where unique_id='smart-shield-main'),
  '["4","H","App-managed hold"]'::jsonb,'a stale legacy tuple cannot overwrite an app edit');
select ok((select pending_legacy_sync from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id='smart-shield-main'),
  'a stale import does not discharge the pending marker');
select is((select av_note from public.ph_master_inventory where unique_id='smart-shield-main'),'preserve this evidence',
  'a blocked imported hold cannot clear verified app evidence');
select ok((select concat like 'smart-shield-pending:%' from public.ph_master_inventory where unique_id='smart-shield-main'),
  'a stale import cannot make a false hash acknowledgement');

update public.ph_master_inventory set priority='4',holdstopcode='H',holdstopreason='App-managed hold',concat='acknowledged'
where unique_id='smart-shield-main';
select ok(not (select pending_legacy_sync from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id='smart-shield-main'),
  'the exact app tuple acknowledges and releases the shield');
update public.ph_master_inventory set priority='5',holdstopcode='S',holdstopreason='Next source hold'
where unique_id='smart-shield-main';
select is((select jsonb_build_array(priority,holdstopcode,holdstopreason) from public.ph_master_inventory where unique_id='smart-shield-main'),
  '["5","S","Next source hold"]'::jsonb,'a later legacy update is accepted after exact acknowledgement');

insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei,
  av_note,assignedto,app_tab_assignment,spec,photo_link
) values ('smart-shield-alias-imported','SMART-SHIELD-ALIAS','Synthetic alias plant','#3','B.01.001','27.F1','20','19',
  '2','PH','F1','27','D2','C2','L2','10',null,null,null,null,null)
on conflict (unique_id) do update set
  priority=excluded.priority,holdstopcode=excluded.holdstopcode,holdstopreason=excluded.holdstopreason,
  av_note=excluded.av_note,assignedto=excluded.assignedto,app_tab_assignment=excluded.app_tab_assignment,
  spec=excluded.spec,photo_link=excluded.photo_link;
select is((select count(*)::integer from public.ph_master_inventory where unique_id='smart-shield-alias-canonical'),1,
  'a priority-derived legacy UID maps to the stable canonical row');
select is((select priority from public.ph_master_inventory where unique_id='smart-shield-alias-canonical'),'2',
  'a changed-UID stale import preserves app priority');
select is((select av_note from public.ph_master_inventory where unique_id='smart-shield-alias-canonical'),'alias AV note',
  'a changed-UID stale import preserves existing AV notes');
select is((select spec from public.ph_master_inventory where unique_id='smart-shield-alias-canonical'),'alias spec',
  'a changed-UID stale import preserves existing specification data');
select is((select photo_link from public.ph_master_inventory where unique_id='smart-shield-alias-canonical'),'https://example.invalid/alias.jpg',
  'a changed-UID stale import preserves existing photo evidence');
select is((select assignedto from public.ph_master_inventory where unique_id='smart-shield-alias-canonical'),'Dylan',
  'a changed-UID stale import preserves an omitted assignment');
select is((select app_tab_assignment from public.ph_master_inventory where unique_id='smart-shield-alias-canonical'),'av',
  'a changed-UID stale import preserves its app tab assignment');
select is((select imported_unique_id from app_sync_private.ph_master_inventory_import_lineage_seen
  where run_id='9b000000-0000-4000-8000-000000000001' and canonical_unique_id='smart-shield-alias-canonical'),
  'smart-shield-alias-imported','the canonical import records the UID alias for this run');
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei,av_note,assignedto,app_tab_assignment,spec,photo_link
) values ('smart-shield-alias-imported','SMART-SHIELD-ALIAS','Synthetic alias plant','#3','B.01.001','27.F1','20','19',
  '2','PH','F1','27','D2','C2','L2','10',null,null,null,null,null)
on conflict (unique_id) do update set
  priority=excluded.priority,holdstopcode=excluded.holdstopcode,holdstopreason=excluded.holdstopreason,
  av_note=excluded.av_note,assignedto=excluded.assignedto,app_tab_assignment=excluded.app_tab_assignment,
  spec=excluded.spec,photo_link=excluded.photo_link;
select ok(not (select pending_legacy_sync from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id='smart-shield-alias-canonical'),
  'a changed-UID exact tuple acknowledges the app edit');
select is((select jsonb_build_array(av_note,assignedto,app_tab_assignment,spec,photo_link)
  from public.ph_master_inventory where unique_id='smart-shield-alias-canonical'),
  '["alias AV note","Dylan","av","alias spec","https://example.invalid/alias.jpg"]'::jsonb,
  'a changed-UID acknowledgement preserves app-owned evidence and assignment fields');
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,holdstopcode,holdstopreason,source,season,saleyear,desigitem,desigcust,desigloc,warehousei,
  av_note,assignedto,app_tab_assignment,spec,photo_link
) values ('smart-shield-alias-imported','SMART-SHIELD-ALIAS','Synthetic alias plant','#3','B.01.001','27.F1','20','19',
  '2','H','New source hold','PH','F1','27','D2','C2','L2','10',null,null,null,null,null)
on conflict (unique_id) do update set
  priority=excluded.priority,holdstopcode=excluded.holdstopcode,holdstopreason=excluded.holdstopreason,
  av_note=excluded.av_note,assignedto=excluded.assignedto,app_tab_assignment=excluded.app_tab_assignment,
  spec=excluded.spec,photo_link=excluded.photo_link;
select is((select jsonb_build_array(date_completed,av_note,sales_note,match,spec,caliper,pic_note,
  loc_match_qty,initial_ptr,photo_link,photo_name) from public.ph_master_inventory
  where unique_id='smart-shield-alias-canonical'),
  '[null,null,null,null,null,null,null,null,null,null,null]'::jsonb,
  'a newly accepted blocking hold on an alias clears the same evidence fields as a canonical import');
select throws_ok($$insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei
) values ('smart-shield-alias-second','SMART-SHIELD-ALIAS','Synthetic alias plant','#3','B.01.001','27.F1','20','19',
  '3','PH','F1','27','D2','C2','L2','10')$$,
  '40001','MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS','two changed UIDs cannot map to one canonical row in a run');
delete from public.ph_master_inventory where unique_id='smart-shield-alias-canonical';
select is((select count(*)::integer from public.ph_master_inventory where unique_id='smart-shield-alias-canonical'),1,
  'deleting a canonical UID observed under an alias is safely ignored within the import run');
delete from public.ph_master_inventory where unique_id='smart-shield-alias-canonical';
select is((select count(*)::integer from public.ph_master_inventory where unique_id='smart-shield-alias-canonical'),1,
  'retrying the same delete keeps the run-scoped alias marker effective');
update public.ph_master_inventory set priority='9' where unique_id='smart-shield-exact-b';
select is((select priority from public.ph_master_inventory where unique_id='smart-shield-exact-b'),'9',
  'an exact UID with shared lineage remains independently importable');
select public.finish_dataset_import_v1('9b000000-0000-4000-8000-000000000001');

select public.begin_dataset_import_v1(array['ph_cav_import','ph_master_inventory'],
  '9b000000-0000-4000-8000-000000000002',array['ph_cav_import']);
select set_config('request.headers','{"x-gnc-import-run-id":"9b000000-0000-4000-8000-000000000002"}',true);
create temp table shield_revision_before_aux as
select revision from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id='smart-shield-main';
update public.ph_master_inventory set priority='8',holdstopcode='S',holdstopreason='Auxiliary attempt'
where unique_id='smart-shield-main';
select is((select jsonb_build_array(priority,holdstopcode,holdstopreason) from public.ph_master_inventory where unique_id='smart-shield-main'),
  '["5","S","Next source hold"]'::jsonb,'a fenced auxiliary source cannot change or acknowledge the DriveAround tuple');
select is((select revision from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id='smart-shield-main'),
  (select revision from shield_revision_before_aux),
  'an auxiliary write does not mutate canonical shield metadata');
select public.finish_dataset_import_v1('9b000000-0000-4000-8000-000000000002');

select public.begin_dataset_import_v1(array['ph_cav_import'],'9b000000-0000-4000-8000-000000000004');
select set_config('request.headers','{"x-gnc-import-run-id":"9b000000-0000-4000-8000-000000000004"}',true);
select throws_ok($$update public.ph_master_inventory set priority='8',holdstopcode='H',holdstopreason='Mis-scoped write'
  where unique_id='smart-shield-main'$$,
  '55000','MASTER_PRIORITY_HOLD_IMPORT_FENCE_LOST','a valid fence without the master source fails closed');
select is((select jsonb_build_array(priority,holdstopcode,holdstopreason) from public.ph_master_inventory where unique_id='smart-shield-main'),
  '["5","S","Next source hold"]'::jsonb,'a mis-scoped fenced write cannot fall through as an app edit');
select public.finish_dataset_import_v1('9b000000-0000-4000-8000-000000000004');

select public.begin_dataset_import_v1(array['ph_master_inventory'],'9b000000-0000-4000-8000-000000000003');
select set_config('request.headers','{"x-gnc-import-run-id":"9b000000-0000-4000-8000-000000000003"}',true);
delete from public.ph_master_inventory where unique_id='smart-shield-alias-canonical';
select is((select count(*)::integer from public.ph_master_inventory where unique_id='smart-shield-alias-canonical'),0,
  'a later canonical snapshot may delete the absent row');
select is((select count(*)::integer from app_sync_private.ph_master_inventory_app_edits where canonical_unique_id='smart-shield-alias-canonical'),0,
  'canonical deletion retires the associated app shield');
select public.finish_dataset_import_v1('9b000000-0000-4000-8000-000000000003');

select set_config('request.headers','{}',true);
insert into public.ph_app_settings(key,value) values
  ('current_season_salesyear','{"seasonCode":"F1","salesYear":27}'::jsonb)
on conflict(key) do update set value=excluded.value;
select set_config('request.jwt.claim.role','service_role',true);
create function pg_temp.v6_hold_payload() returns jsonb language sql as $$
  select jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v6-smart-shield-20261009',
    'idempotencyToken','smart-shield-v6-fixture-token-001','actorUsername','dylan_collyge',
    'source',jsonb_build_object('unique_id','smart-v6-source','source_table','ph_master_inventory',
      'itemcode','SMART-V6','lotcode','27.F1','locationcode','D.01.001'),
    'transaction',jsonb_build_object('requestActions',jsonb_build_array('hold','priority_change'),
      'holdStopProposals',jsonb_build_array(jsonb_build_object('action','hold','reason','Manager hold','sourceUid','smart-v6-source')),
      'scope',jsonb_build_object()),
    'rowOverlays',jsonb_build_array(jsonb_build_object('unique_id','smart-v6-source','resolution','done',
      'expected',jsonb_build_object('itemcode','SMART-V6','lotcode','27.F1','locationcode','D.01.001',
        'ptronhand','10','desigitem','D4','priority','3','holdstopcode',null,'holdstopreason',null),
      'proposals',jsonb_build_array(jsonb_build_object('action','priority_change','priority','8'))))
  )
$$;
create temp table smart_v6_prepared as
select private.prepare_reclass_live_edits_v6(pg_temp.v6_hold_payload(),'dylan_collyge') prepared;
select is((select prepared #>> '{liveEditScope,holdFanoutCount}' from smart_v6_prepared),'2',
  'an authorized current-season hold records the source and all eligible prior-year siblings');
select is((select prepared #>> '{liveEditScope,holdFanoutSiblingCount}' from smart_v6_prepared),'1',
  'hold scope counts only the one eligible sibling');
select is((select prepared #>> '{liveEditScope,holdSalesYearMax}' from smart_v6_prepared),'27',
  'frozen hold scope records the sales-year cutoff');
select is((select value #>> '{target,priority}' from smart_v6_prepared, jsonb_array_elements(prepared->'edits') value
  where value->>'unique_id'='smart-v6-source'),'8','priority intent remains in the combined hold edit');
select is((select value #>> '{target,holdstopcode}' from smart_v6_prepared, jsonb_array_elements(prepared->'edits') value
  where value->>'unique_id'='smart-v6-source'),'H','the selected hold source receives the server-derived code');
select is((select count(*)::integer from smart_v6_prepared, jsonb_array_elements(prepared->'edits') value
  where value->>'unique_id' in ('smart-v6-source','smart-v6-prior')),2,
  'the current source and eligible prior-year row are the complete edit set');
select is((select count(*)::integer from smart_v6_prepared, jsonb_array_elements(prepared->'edits') value
  where value->>'unique_id' in ('smart-v6-future','smart-v6-other-season')),0,
  'future-year and other-season rows are excluded from fanout');
select is((private.apply_ph_master_inventory_live_edits_v6((select prepared->'edits' from smart_v6_prepared))->>'inventoryRevision') ~ '^[0-9]+$',true,
  'the atomic live-edit result returns a decimal revision');
select is((select jsonb_build_array(priority,holdstopcode,holdstopreason) from public.ph_master_inventory where unique_id='smart-v6-source'),
  '["8","H","Manager hold"]'::jsonb,'combined V6 priority and hold edits are applied together');
select is((select holdstopcode from public.ph_master_inventory where unique_id='smart-v6-prior'),'H',
  'the eligible sibling receives the hold without changing its priority');
select is((select holdstopcode from public.ph_master_inventory where unique_id='smart-v6-future'),null::text,
  'future rows remain unchanged by hold fanout');
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select private.apply_ph_master_inventory_live_edits_v6('[]'::jsonb)$$,
  '42501','RECLASS_V6_LIVE_EDIT_FORBIDDEN','non-service request roles cannot invoke the live mutation helper');

select throws_ok($$select private.validate_reclass_smart_shield_v6(
  (pg_temp.v6_hold_payload() || jsonb_build_object(
    'transaction',(pg_temp.v6_hold_payload()->'transaction') || jsonb_build_object('requestActions',jsonb_build_array('hold','move_up')),
    'rowOverlays',jsonb_build_array((pg_temp.v6_hold_payload()->'rowOverlays'->0) || jsonb_build_object(
      'proposals',jsonb_build_array(jsonb_build_object('action','move_up','splits',jsonb_build_array(
        jsonb_build_object('quantity',1,'destinationSeason','S1')),'applyHold',false,'holdReason',''))
    ))
  )))$$,
  '22023','DRIVE_RECLASS_V6_MOVE_UP_HOLD_CONFLICT','Move Up cannot coexist with a hold proposal');

-- Exercise the public V6 queue path: request-only movement is retained while
-- priority/hold changes apply atomically and are reflected in the protected
-- outbox and Requested audit snapshot.
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei
) values (
  'smart-v6-rpc-source','SMART-V6-RPC','Synthetic V6 RPC plant','#3','E.01.001','27.F1','12','11',
  '2','PH','F1','27','R1','RC1','RL1','10'
);
update public.app_dataset_revisions set state='ready',revision=greatest(revision,1)
where key='ph_master_inventory';
create temporary table smart_v6_rpc_actor(username text primary key,id uuid not null) on commit drop;
insert into smart_v6_rpc_actor(username,id)
select wanted.username,coalesce(existing.id,gen_random_uuid())
from (values ('dylan_collyge'),('megan_kelly'),('sharon_combs')) wanted(username)
left join lateral (select p.id from public.profiles p where lower(btrim(p.username))=wanted.username limit 1) existing on true;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select a.id,'v6.'||a.username||'@example.invalid',now(),'{}'::jsonb,'{}'::jsonb from smart_v6_rpc_actor a
on conflict(id) do update set email=excluded.email,email_confirmed_at=now();
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select a.id,a.username,'Smart Shield V6 SQL fixture',case when a.username='dylan_collyge' then 'ADMIN' else 'MANAGER' end,false,null,null
from smart_v6_rpc_actor a
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,
  must_change_password=false,disabled_at=null,locked_until=null;
insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope)
select private.resolve_app_access_policy_id_v1(false),a.id,'drive.reclass.submit',true,'global'
from smart_v6_rpc_actor a where a.username='dylan_collyge'
on conflict(policy_id,profile_id,permission_key) do update set allowed=true,access_scope='global';
create function pg_temp.v6_public_rpc_payload(p_token text,p_expected_priority text,p_target_priority text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v6-smart-shield-20261009',
    'idempotencyToken',p_token,'actorUsername','dylan_collyge',
    'source',jsonb_build_object('unique_id',m.unique_id,'source_table','ph_master_inventory',
      'itemcode',m.itemcode,'lotcode',m.lotcode,'locationcode',m.locationcode),
    'transaction',jsonb_build_object(
      'requestActions',jsonb_build_array('hold','priority_change','move_down'),
      'holdStopProposals',jsonb_build_array(jsonb_build_object('action','hold','reason','V6 RPC test hold','sourceUid',m.unique_id)),
      'scope',jsonb_build_object()
    ),
    'rowOverlays',jsonb_build_array(jsonb_build_object(
      'unique_id',m.unique_id,'resolution','done',
      'expected',jsonb_build_object('itemcode',m.itemcode,'lotcode',m.lotcode,'locationcode',m.locationcode,
        'ptronhand',m.ptronhand,'desigitem',coalesce(m.desigitem,''),'priority',p_expected_priority,
        'holdstopcode',m.holdstopcode,'holdstopreason',m.holdstopreason),
      'proposals',jsonb_build_array(
        jsonb_build_object('action','priority_change','priority',p_target_priority),
        jsonb_build_object('action','move_down','splits',jsonb_build_array(jsonb_build_object('quantity',2,'destinationSeason','S1')),
          'applyHold',false,'holdReason','')
      )
    ))
  )
  from public.ph_master_inventory m where m.unique_id='smart-v6-rpc-source'
$$;
create temporary table smart_v6_rpc_inputs(token text primary key,payload jsonb not null) on commit drop;
insert into smart_v6_rpc_inputs(token,payload) values
  ('smart-shield-v6-public-token-0001',pg_temp.v6_public_rpc_payload('smart-shield-v6-public-token-0001','2','8')),
  ('smart-shield-v6-public-token-0002',pg_temp.v6_public_rpc_payload('smart-shield-v6-public-token-0002','2','7'));
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
create temporary table smart_v6_rpc_result(result jsonb) on commit drop;
insert into smart_v6_rpc_result(result)
select public.enqueue_drive_reclass_inquiry_v6(payload) from smart_v6_rpc_inputs where token='smart-shield-v6-public-token-0001';
select is((select result->>'duplicate' from smart_v6_rpc_result),'false','public V6 enqueue creates a new request');
select is((select priority from public.ph_master_inventory where unique_id='smart-v6-rpc-source'),'8',
  'public V6 applies its approved priority edit');
select is((select jsonb_build_array(holdstopcode,holdstopreason) from public.ph_master_inventory where unique_id='smart-v6-rpc-source'),
  '["H","V6 RPC test hold"]'::jsonb,'public V6 applies its approved hold atomically');
select is((select ptronhand from public.ph_master_inventory where unique_id='smart-v6-rpc-source'),'12',
  'a mixed Move Down inquiry does not mutate live quantity');
select is((select result #>> '{liveEditScope,holdFanoutCount}' from smart_v6_rpc_result),'1',
  'the returned live scope records the selected-row-only hold');
select is((select o.payload #>> '{reclassPayload,workflowPolicyVersion}' from public.ph_request_delivery_outbox o
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('smart-shield-v6-public-token-0001','sha256'),'hex'),40)),
  'reclass-action-workflow-v6-smart-shield-20261009','the protected queue stores the V6 policy');
select is((select o.payload #>> '{reclassPayload,protectedDelivery,v6FrozenRows,0,unique_id}' from public.ph_request_delivery_outbox o
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('smart-shield-v6-public-token-0001','sha256'),'hex'),40)),
  'smart-v6-rpc-source','the V6 outbox freezes its full source row');
select is((select count(*)::integer from public.ph_inventory_transactions t join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('smart-shield-v6-public-token-0001','sha256'),'hex'),40)
    and t.status='requested' and t.event_type='inventory_change_request'),1,'the V6 submission retains one Requested audit');
select is((select t.raw_payload #>> '{workflowPolicyVersion}' from public.ph_inventory_transactions t
  join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('smart-shield-v6-public-token-0001','sha256'),'hex'),40)
    and t.status='requested' and t.event_type='inventory_change_request'),
  'reclass-action-workflow-v6-smart-shield-20261009','the Requested audit records the committed V6 policy');
select is((select t.raw_payload #>> '{protectedDelivery,liveEdits,0,priority}' from public.ph_inventory_transactions t
  join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('smart-shield-v6-public-token-0001','sha256'),'hex'),40)
    and t.status='requested' and t.event_type='inventory_change_request'),
  '8','the Requested audit records the server-confirmed live edit');
select is((select t.raw_payload #> '{protectedDelivery,liveEdits,0,evidence}' from public.ph_inventory_transactions t
  join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('smart-shield-v6-public-token-0001','sha256'),'hex'),40)
    and t.status='requested' and t.event_type='inventory_change_request'),
  (select jsonb_build_object(
    'unique_id',m.unique_id,'itemcode',m.itemcode,'locationcode',m.locationcode,'lotcode',m.lotcode,
    'last_updated',m.last_updated,'photo_link',m.photo_link,'photo_name',m.photo_name,'match',m.match,
    'spec',m.spec,'caliper',m.caliper,'initial_ptr',m.initial_ptr,'loc_match_qty',m.loc_match_qty,
    'ptravailable',m.ptravailable,'av_note',m.av_note,'pic_note',m.pic_note,'sales_note',m.sales_note,
    'date_completed',m.date_completed,'app_tab_assignment',m.app_tab_assignment,
    'av_rule_av_note_updated_at',m.av_rule_av_note_updated_at,'av_rule_bundle_updated_at',m.av_rule_bundle_updated_at,
    'av_rule_caliper_updated_at',m.av_rule_caliper_updated_at,'av_rule_holdstop_snapshot',m.av_rule_holdstop_snapshot,
    'av_rule_last_clear_reason',m.av_rule_last_clear_reason,'av_rule_last_cleared_at',m.av_rule_last_cleared_at,
    'av_rule_match_updated_at',m.av_rule_match_updated_at,'av_rule_photo_updated_at',m.av_rule_photo_updated_at,
    'av_rule_priority_snapshot',m.av_rule_priority_snapshot,'av_rule_spec_updated_at',m.av_rule_spec_updated_at
  ) from public.ph_master_inventory m where m.unique_id='smart-v6-rpc-source'),
  'the V6 receipt returns the exact post-trigger Drive evidence projection');
select is((select t.raw_payload #>> '{protectedDelivery,liveEditScope,holdSourceUid}' from public.ph_inventory_transactions t
  join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('smart-shield-v6-public-token-0001','sha256'),'hex'),40)
    and t.status='requested' and t.event_type='inventory_change_request'),
  'smart-v6-rpc-source','the Requested audit records the exact hold origin');
select is((public.enqueue_drive_reclass_inquiry_v6((select payload from smart_v6_rpc_inputs where token='smart-shield-v6-public-token-0001'))->>'duplicate'),'true',
  'an identical public V6 retry returns its original receipt after the live update');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v6((
  select payload || jsonb_build_object('rowOverlays',jsonb_set(payload->'rowOverlays','{0,proposals,0,priority}','"7"'::jsonb))
  from smart_v6_rpc_inputs where token='smart-shield-v6-public-token-0001'))$$,
  'P0001','DRIVE_RECLASS_TOKEN_CONFLICT','a changed public V6 payload cannot reuse the committed token');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v6((select payload from smart_v6_rpc_inputs where token='smart-shield-v6-public-token-0002'))$$,
  '40001','DRIVE_RECLASS_V6_LIVE_EDIT_CONFLICT','a stale expected live tuple aborts a new V6 request');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('smart-shield-v6-public-token-0002','sha256'),'hex'),40)),0,
  'a failed V6 live conflict rolls back the queued outbox event');
select is((select count(*)::integer from public.ph_inventory_transactions t
  join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('smart-shield-v6-public-token-0002','sha256'),'hex'),40)
    and t.status='requested'),0,'a failed V6 live conflict rolls back the Requested audit');

-- The Manager V2 adapter keeps its V1 receipt and request, then applies the
-- selected priority in the same transaction and updates the audit snapshot.
insert into public.ph_cav_import(unique_id,itemcode,commonname,contsize,season,holdstopreason)
values ('smart-v6-manager-cav','SMART-V6-MANAGER','Synthetic manager row','#3','F1','')
on conflict(unique_id) do update set itemcode=excluded.itemcode,season=excluded.season,holdstopreason=excluded.holdstopreason;
insert into public.ph_master_inventory(
  unique_id,itemcode,genusname,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,blockalpha,desigitem,desigloc,assignedto,app_tab_assignment
) values (
  'smart-v6-manager-source','SMART-V6-MANAGER','Acer','Synthetic manager row','#3','F.01.001','27.F1','9','8',
  '2','PH','F1','27','F','M1','ML1','dylan_collyge','season'
);
update public.app_dataset_revisions set state='ready',revision=greatest(revision,1)
where key in ('ph_master_inventory','ph_cav_import','ph_warehouse_assigned_items');
insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope)
select private.resolve_app_access_policy_id_v1(false),a.id,permission_key,true,'global'
from smart_v6_rpc_actor a cross join (values ('module.managers.view'),('managers.season_priority.submit')) permissions(permission_key)
where a.username='dylan_collyge'
on conflict(policy_id,profile_id,permission_key) do update set allowed=true,access_scope='global';
create temporary table smart_v6_manager_result(result jsonb) on commit drop;
create temporary table smart_v6_manager_scope(fingerprint text not null) on commit drop;
insert into smart_v6_manager_scope values (private.manager_season_priority_scope_fingerprint_v1('SMART-V6-MANAGER'));
insert into smart_v6_manager_result(result)
select public.submit_manager_season_priority_v2(
  (select id from smart_v6_rpc_actor where username='dylan_collyge'),
  'smart-v6-manager-source',2,
  (select fingerprint from smart_v6_manager_scope),
  'smart-shield-v6-manager-token-0001'
);
select is((select result->>'duplicate' from smart_v6_manager_result),'false','Manager V2 creates its first protected request');
select is((select priority from public.ph_master_inventory where unique_id='smart-v6-manager-source'),'1',
  'Manager V2 applies its selected priority to live inventory');
select is((select o.payload #>> '{reclassPayload,transaction,seasonPriority,contractVersion}' from public.ph_request_delivery_outbox o
  where o.event_id=((select result->>'eventId' from smart_v6_manager_result))::uuid),
  'manager-season-priority-v2','Manager V2 preserves the V1 receipt with a V2 delivery contract');
select is((select t.raw_payload #>> '{protectedDelivery,liveEdits,0,priority}' from public.ph_inventory_transactions t
  where t.delivery_event_id=((select result->>'eventId' from smart_v6_manager_result))::uuid
    and t.status='requested' and t.event_type='inventory_change_request'),
  '1','Manager V2 synchronizes its committed live edit into the Requested audit');
select is((public.submit_manager_season_priority_v2(
  (select id from smart_v6_rpc_actor where username='dylan_collyge'),'smart-v6-manager-source',2,
  (select fingerprint from smart_v6_manager_scope),'smart-shield-v6-manager-token-0001')->>'duplicate'),
  'true','Manager V2 retry returns the original receipt without reapplying its edit');

-- Eval Work uses the same V6 live transaction at final submit, while its
-- stored submitted inquiry and completion outbox preserve the V6 snapshot.
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select gen_random_uuid(),'smart-v6-eval@example.invalid',now(),'{}'::jsonb,'{}'::jsonb
where not exists(select 1 from auth.users where email='smart-v6-eval@example.invalid');
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select u.id,'smart_v6_eval','Smart V6 Eval SQL fixture','EVAL',false,null,null
from auth.users u where u.email='smart-v6-eval@example.invalid'
on conflict(id) do update set username=excluded.username,role=excluded.role,must_change_password=false,disabled_at=null,locked_until=null;
create temporary table smart_v6_eval_work_id(id uuid primary key) on commit drop;
insert into smart_v6_eval_work_id values(gen_random_uuid());
insert into public.ph_eval_work(
  id,create_token,contract_version,status,creator_username,creator_display,
  assignee_username,assignee_display,assignee_email,completion_recipients,
  itemcode,commonname,contsize,origin_unique_id,origin_locationcode,origin_lotcode,origin_source,
  origin_snapshot,context_rows,inventory_signature,settings_signature,inquiry_draft,
  version,origin_count,assignee_usernames,assignee_profiles,assigned_to_users
)
select w.id,'smart-v6-eval-create-token','eval-work-v1','open',
  'dylan_collyge','Smart V6 SQL fixture','smart_v6_eval','Smart V6 Eval SQL fixture',
  'smart-v6-eval@example.invalid',array['smart-v6-eval@example.invalid'],
  m.itemcode,m.commonname,m.contsize,m.unique_id,m.locationcode,m.lotcode,m.source,
  to_jsonb(m),private.eval_work_context_rows_v1(m.itemcode),
  md5(private.eval_work_context_rows_v1(m.itemcode)::text),md5(private.eval_work_settings_v1()::text),
  pg_temp.v6_public_rpc_payload('smart-shield-v6-eval-token-0001','8','7'),
  1,1,array['smart_v6_eval'],
  jsonb_build_array(jsonb_build_object('username','smart_v6_eval','displayName','Smart V6 Eval SQL fixture','email','smart-v6-eval@example.invalid')),
  array['smart_v6_eval']
from smart_v6_eval_work_id w cross join public.ph_master_inventory m where m.unique_id='smart-v6-rpc-source';
select lives_ok($q$select public.save_eval_work_v1(
  w.id,'smart_v6_eval',w.version,w.inquiry_draft,'{}'::jsonb)
  from public.ph_eval_work w where w.id=(select id from smart_v6_eval_work_id)$q$,
  'Eval Work V1 accepts a V6 saved draft without applying live edits');
select is((select priority from public.ph_master_inventory where unique_id='smart-v6-rpc-source'),'8',
  'saving a V6 draft leaves the live priority unchanged');
select lives_ok($q$select public.submit_eval_work_v1(
  w.id,'smart_v6_eval',w.version,w.inquiry_draft,
  jsonb_build_object('spec','V6 fixture spec','avNote','V6 fixture evidence','locMatchPercent','100',
    'photos',jsonb_build_array(jsonb_build_object('filePath','eval/'||w.id::text||'/fixture.jpg',
      'url','https://example.invalid/fixture.jpg','name','fixture.jpg'))),
  'smart-shield-v6-eval-submit-token-0001') from public.ph_eval_work w
  where w.id=(select id from smart_v6_eval_work_id)$q$,'Eval Work V1 accepts and atomically submits a V6 live-edit proposal');
select is((select priority from public.ph_master_inventory where unique_id='smart-v6-rpc-source'),'7',
  'Eval Work V6 applies live priority only at final submission');
select is((select submitted_inquiry->>'workflowPolicyVersion' from public.ph_eval_work where id=(select id from smart_v6_eval_work_id)),
  'reclass-action-workflow-v6-smart-shield-20261009','Eval Work final state preserves the V6 policy snapshot');
select is((select o.payload #>> '{protectedDelivery,liveEdits,0,priority}' from public.ph_request_delivery_outbox o
  where o.event_id=(select completion_event_id from public.ph_eval_work where id=(select id from smart_v6_eval_work_id))),
  '7','Eval Work completion outbox includes the server-confirmed live edit');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.event_type='eval_work_completion' and o.request_id=(select id::text from smart_v6_eval_work_id)),
  1,'Eval Work V6 creates exactly one completion event');

select * from finish();
rollback;
