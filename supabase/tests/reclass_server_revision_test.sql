-- @test-runtime: canonical
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();

create temporary table reclass_current_users(username text primary key,id uuid not null,email text not null) on commit drop;
insert into reclass_current_users
select name,coalesce((select p.id from public.profiles p where p.username=name),gen_random_uuid()),
  'reclass-current-'||name||'@example.invalid'
from unnest(array['dylan_collyge','megan_kelly','jd_jones']) name;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select id,email,now(),'{}','{}' from reclass_current_users
on conflict(id) do update set email=excluded.email,email_confirmed_at=excluded.email_confirmed_at;
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select id,username,username,'ADMIN',false,null,null from reclass_current_users
on conflict(id) do update set role='ADMIN',must_change_password=false,disabled_at=null,locked_until=null;
insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope)
select private.resolve_app_access_policy_id_v1(false),id,'drive.reclass.submit',true,'global' from reclass_current_users
on conflict(policy_id,profile_id,permission_key) do update set allowed=true,access_scope='global';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_app_settings(key,value)
values('current_season_salesyear','{"seasonCode":"F1","salesYear":27}'::jsonb)
on conflict(key) do update set value=excluded.value;

insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,
  ptronhand,ptravailable,source,season,saleyear,priority,locationnote,salesnote)
values('reclass-current-source','RECLASS-CURRENT','Current revision fixture','#3','C.17.001','27.F1',
  '10','10','PH','F1','27','2','Old location note','Old sales note');

insert into app_sync_private.import_runs(id,source_keys,canonical_keys,state,expires_at,created_at,finished_at)
values
 ('f2317000-0000-4000-8000-000000000001','{ph_master_inventory}','{ph_master_inventory}','completed',now()-interval '2 hours',now()-interval '3 hours',now()-interval '3 hours'),
 ('f2317000-0000-4000-8000-000000000002','{ph_master_inventory}','{ph_master_inventory}','failed',now()+interval '12 minutes',now()-interval '1 minute',now()-interval '30 seconds');
create temporary table reclass_current_sources(key text primary key) on commit drop;
insert into reclass_current_sources select unnest(array[
  'ph_active_request','ph_crop_roll_drive_rows','ph_eval_work','ph_eval_work_events','ph_eval_work_origin_rows',
  'ph_hold_learning_events','ph_inventory_row_assignments','ph_itemcode_default_owners','ph_master_inventory',
  'ph_request_delivery_outbox','ph_sales_office','ph_warehouse_assigned_items']);
update app_sync_private.import_runs set source_keys=(select array_agg(key order by key) from reclass_current_sources)
where id in ('f2317000-0000-4000-8000-000000000001','f2317000-0000-4000-8000-000000000002');
insert into app_sync_private.ph_master_snapshot_stage_v1(request_id,run_id,source_manifest,source_manifest_digest,
  source_digest,expected_rows,expected_chunks,payload_hash,status,publication_run_id,published_response,updated_at)
values
 ('f2317000-0000-4000-8000-000000000011','f2317000-0000-4000-8000-000000000001','{}',repeat('a',64),repeat('b',64),1,1,repeat('c',64),'published','f2317000-0000-4000-8000-000000000001','{"published":true}',now()-interval '2 hours'),
 ('f2317000-0000-4000-8000-000000000012','f2317000-0000-4000-8000-000000000002','{}',repeat('d',64),repeat('e',64),1,1,repeat('f',64),'staging',null,null,now()-interval '1 minute');
insert into app_sync_private.import_leases(key,run_id)
select key,'f2317000-0000-4000-8000-000000000002'::uuid from reclass_current_sources;
update public.app_dataset_revisions set state='interrupted'
where key in (select key from reclass_current_sources);

create function pg_temp.reclass_current_moves() returns jsonb language sql stable as $function$
  select jsonb_build_array(jsonb_build_object('source',jsonb_build_object('uniqueId',m.unique_id,
    'identity',jsonb_build_object('unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,
      'locationcode',m.locationcode,'lotcode',m.lotcode,'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)),
    'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U1','quantity',3))))
  from public.ph_master_inventory m where m.unique_id='reclass-current-source'
$function$;
create temporary table reclass_current_request as select pg_temp.reclass_current_moves() moves;
create temporary table reclass_current_result(result jsonb) on commit drop;

select ok(private.reclass_failed_unpublished_canonical_run_v1('f2317000-0000-4000-8000-000000000002'),
  'an unexpired lease from a failed unpublished canonical stage is eligible');
select is((select count(*)::integer from app_sync_private.import_leases
  where run_id='f2317000-0000-4000-8000-000000000002'),12,
  'the failed canonical import retains leases for all twelve production companion sources');
select is((select count(*)::integer from public.app_dataset_revisions
  where key in (select key from reclass_current_sources) and state='interrupted'),12,
  'the movement and outbox paths run against all twelve interrupted companion datasets');
select ok((app_sync_private.published_snapshot_read_proof('ph_master_inventory',
  (select revision from public.app_dataset_revisions where key='ph_master_inventory'))->>'mutationAllowed')::boolean,
  'failed canonical lease retains proven LKG mutation eligibility');
select throws_ok($$select private.lock_ph_master_inventory_for_live_edit_v6()$$,'40001',
  'RECLASS_V6_INVENTORY_REFRESH_REQUIRED','general nested live-edit lock remains fenced without private V7 context');
select throws_ok($$update public.ph_master_inventory set itemcode=itemcode where unique_id='reclass-current-source'$$,
  '55000','MASTER_SNAPSHOT_NOT_READY','direct writes remain fenced while the failed import is interrupted');

-- HTTP mutations start in a fresh transaction. Fixture setup must not cause
-- touch_source's transaction-local fast path to hide the first live write.
select set_config('app_sync.touched','{}',true);
insert into reclass_current_result select public.apply_inventory_reclass_moves_with_delivery_v1(
  p_actor_id=>(select id from reclass_current_users where username='jd_jones'),
  p_command_id=>'reclass-current-server-command-0001',p_moves=>moves) from reclass_current_request;
select ok((select result->>'status'='applied' and result->>'emailQueued'='true' from reclass_current_result),
  'missing client watermark applies source-bound stock and atomic completion outbox');
select is((select ptronhand from public.ph_master_inventory where unique_id='reclass-current-source'),'7',
  'the source quantity changes exactly once');
select is((select cardinality(public.get_reclass_delivery_recipients_v1('jd_jones'))),3,
  'JD submission resolves Dylan, Megan, and JD exactly once');
select ok((select state='interrupted' from public.app_dataset_revisions where key='ph_master_inventory')
  and exists(select 1 from app_sync_private.import_leases where key='ph_master_inventory'
    and run_id='f2317000-0000-4000-8000-000000000002'),
  'failed import state, lease, and resumable staging are preserved');
select throws_ok($$select private.lock_ph_master_inventory_for_live_edit_v6()$$,'40001',
  'RECLASS_V6_INVENTORY_REFRESH_REQUIRED','completed stock mutation clears its privileged context');

update public.app_dataset_revisions set revision=revision+1 where key='ph_master_inventory';
select ok((select public.apply_inventory_reclass_moves_with_delivery_v1(
  (select id from reclass_current_users where username='jd_jones'),'reclass-current-server-command-0001',1,moves,null)->>'duplicate'='true'
  from reclass_current_request),'same-command retry reuses its stored request revision despite a stale advisory watermark');
select is((select count(*)::integer from public.ph_request_delivery_outbox
  where event_key='inventory-reclass-move-completed:'||(select id::text from reclass_current_users where username='jd_jones')||':reclass-current-server-command-0001'),1,
  'same-command retry retains exactly one completion outbox event');
select throws_ok($$select public.apply_inventory_reclass_moves_with_delivery_v1(
  (select id from reclass_current_users where username='jd_jones'),'reclass-current-server-command-0001',null,
  jsonb_set((select moves from reclass_current_request),'{0,lines,0,quantity}','2'))$$,
  '40001','INVENTORY_RECLASS_COMMAND_CONFLICT','same-command changed quantity remains a request conflict');
select throws_ok($$select public.apply_inventory_reclass_moves_with_delivery_v1(
  (select id from reclass_current_users where username='jd_jones'),'reclass-current-stale-source-0001',null,
  (select moves from reclass_current_request))$$,'40001','INVENTORY_RECLASS_SOURCE_CHANGED',
  'missing global watermark never bypasses exact source and quantity CAS');
select ok(not exists(select 1 from private.ph_inventory_reclass_batch_receipts_v1 where command_id='reclass-current-stale-source-0001'),
  'failed source CAS rolls back its command receipt');
select set_config('app_sync.touched','{}',true);
select ok((public.apply_inventory_reclass_moves_with_delivery_v1(
  (select id from reclass_current_users where username='jd_jones'),'reclass-current-stale-watermark-0001',1,
  pg_temp.reclass_current_moves(),'master-null-elision-v1')->>'rowEncoding')='master-null-elision-v1',
  'a stale positive advisory watermark uses the current locked revision with compact receipts');

-- Exercise the real outer V7 -> V6 Hold/Stop -> live edit lock path, plus V7
-- note CAS; the proof and failed lease are identical to the stock path above.
create temporary table reclass_current_inquiry as
select jsonb_build_object('workflowPolicyVersion','reclass-action-workflow-v7-editable-fields-20261009',
  'idempotencyToken','reclass-current-live-fields-token-0001','actorUsername','jd_jones',
  'source',jsonb_build_object('unique_id',m.unique_id,'source_table','ph_master_inventory','itemcode',m.itemcode,
    'lotcode',m.lotcode,'locationcode',m.locationcode),
  'sourceContext',jsonb_build_object('sourceMode','drive'),
  'transaction',jsonb_build_object('requestActions','["hold","priority_change","inventory_fields"]'::jsonb,
    'holdStopProposals',jsonb_build_array(jsonb_build_object('action','hold','reason','Current revision field check','sourceUid',m.unique_id)),'scope','{}'::jsonb),
  'rowOverlays',jsonb_build_array(jsonb_build_object('unique_id',m.unique_id,'resolution','done',
    'expected',jsonb_build_object('itemcode',m.itemcode,'lotcode',m.lotcode,'locationcode',m.locationcode,
      'ptronhand',m.ptronhand,'desigitem',m.desigitem,'priority',m.priority,'holdstopcode',m.holdstopcode,
      'holdstopreason',m.holdstopreason,'locationnote',m.locationnote,'locationptn1',m.locationptn1,
      'desigcust',m.desigcust,'desigloc',m.desigloc,'pullerresponsibility',m.pullerresponsibility,
      'oversellpercentage',m.oversellpercentage,'salesnote',m.salesnote,'suspend',m.suspend),
    'proposals','[{"action":"priority_change","priority":"3"}]'::jsonb,
    'fieldEdits',jsonb_build_array(jsonb_build_object('field','locationnote','expected',m.locationnote,'value','Current location note'),
      jsonb_build_object('field','salesnote','expected',m.salesnote,'value','Current sales note'))))) payload
from public.ph_master_inventory m where m.unique_id='reclass-current-source';
select set_config('app_sync.touched','{}',true);
select lives_ok($$select public.enqueue_drive_reclass_inquiry_v7(payload) from reclass_current_inquiry$$,
  'V7 Hold/Stop, priority, and note changes apply through the existing protected atomic delivery path');
select ok((select holdstopcode='H' and priority='3' and locationnote='Current location note'
  and salesnote='Current sales note' from public.ph_master_inventory where unique_id='reclass-current-source'),
  'all confirmed field edits persist together against the interrupted baseline');
select throws_ok($$select private.lock_ph_master_inventory_for_live_edit_v6()$$,'40001',
  'RECLASS_V6_INVENTORY_REFRESH_REQUIRED','V7 clears the private write context on return');

update public.profiles set disabled_at=now() where id=(select id from reclass_current_users where username='jd_jones');
select throws_ok($$select public.apply_inventory_reclass_moves_with_delivery_v1(
  (select id from reclass_current_users where username='jd_jones'),'reclass-current-disabled-actor-0001',null,pg_temp.reclass_current_moves())$$,
  '42501','INVENTORY_RECLASS_PROFILE_INACTIVE','server revision resolution does not bypass current actor authorization');
update public.profiles set disabled_at=null where id=(select id from reclass_current_users where username='jd_jones');
update public.profiles set disabled_at=now() where id=(select id from reclass_current_users where username='megan_kelly');
select throws_ok($$select public.apply_inventory_reclass_moves_with_delivery_v1(
  (select id from reclass_current_users where username='jd_jones'),'reclass-current-email-rollback-0001',null,pg_temp.reclass_current_moves())$$,
  '40001','RECLASS_REQUIRED_RECIPIENTS_UNAVAILABLE','unavailable mandatory recipient rolls back the whole stock-and-outbox transaction');
select ok((select ptronhand='4' and ptravailable='4' from public.ph_master_inventory where unique_id='reclass-current-source')
  and not exists(select 1 from private.ph_inventory_reclass_batch_receipts_v1 where command_id='reclass-current-email-rollback-0001'),
  'failed outbox policy leaves stock and command receipts unchanged');
update public.profiles set disabled_at=null where id=(select id from reclass_current_users where username='megan_kelly');

-- An independent revision change must not be mistaken for this trigger's own
-- bump, even when an old private context remains in the same transaction.
select private.lock_ph_master_inventory_for_reclass_lkg_v1(true);
update public.app_dataset_revisions set revision=revision+1 where key='ph_master_inventory';
select set_config('app_sync.touched','{}',true);
select throws_ok($$update public.ph_master_inventory set itemcode=itemcode where unique_id='reclass-current-source'$$,
  '55000','MASTER_SNAPSHOT_NOT_READY','an unrelated revision advance invalidates an old private mutation context');
select private.clear_current_ph_inventory_reclass_lkg_context_v1();

update app_sync_private.import_runs set state='active',expires_at=now()+interval '12 minutes'
where id='f2317000-0000-4000-8000-000000000002';
select ok(not private.reclass_failed_unpublished_canonical_run_v1('f2317000-0000-4000-8000-000000000002'),
  'active canonical imports never qualify for the failed-stage exception');
select throws_ok($$select public.apply_inventory_reclass_moves_with_delivery_v1(
  (select id from reclass_current_users where username='jd_jones'),'reclass-current-active-import-0001',null,pg_temp.reclass_current_moves())$$,
  '40001','RECLASS_V6_INVENTORY_REFRESH_REQUIRED','active import lease still fences all new stock commands');
update app_sync_private.import_runs set state='failed',canonical_keys='{}'
where id='f2317000-0000-4000-8000-000000000002';
select ok(not private.reclass_failed_unpublished_canonical_run_v1('f2317000-0000-4000-8000-000000000002'),
  'a failed direct-write run never receives canonical eligibility');
select throws_ok($$select private.lock_ph_master_inventory_for_reclass_lkg_v1(true)$$,'40001',
  'RECLASS_V6_INVENTORY_REFRESH_REQUIRED','failed partial direct imports remain fenced');
select ok(not has_function_privilege('authenticated','private.reclass_failed_unpublished_canonical_run_v1(uuid)','execute')
  and not has_function_privilege('service_role','private.reclass_failed_unpublished_canonical_run_v1(uuid)','execute'),
  'lease eligibility is private and cannot be invoked as a public authorization bypass');
select ok(has_function_privilege('service_role','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
  and not has_function_privilege('authenticated','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute')
  and not has_function_privilege('anon','public.apply_inventory_reclass_moves_with_delivery_v1(uuid,text,bigint,jsonb,text)','execute'),
  'the atomic movement wrapper remains restricted to its trusted authenticated service boundary');
select * from finish();
rollback;
