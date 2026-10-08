-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

select has_function('public','enqueue_drive_reclass_inquiry_v5',array['jsonb'],'V5 has a dedicated enqueue RPC');
select ok(has_function_privilege('service_role','public.enqueue_drive_reclass_inquiry_v5(jsonb)','execute'),'service_role can enqueue V5');
select ok(not has_function_privilege('authenticated','public.enqueue_drive_reclass_inquiry_v5(jsonb)','execute'),'authenticated cannot bypass the app API');
select ok(not has_function_privilege('anon','public.enqueue_drive_reclass_inquiry_v5(jsonb)','execute'),'anonymous users cannot enqueue V5');
select has_function('private','project_reclass_sheared_v5',array['jsonb'],'V5 has a strict request-only projector');
select has_function('private','validate_eval_work_inquiry_sheared_v5',array['jsonb','text','jsonb'],'Eval Work uses the same V5 projection and validation');
select ok(position('validate_eval_work_inquiry_sheared_v5' in pg_get_functiondef('public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text)'::regprocedure))>0,'Eval Work V1 submission stores the server projection');
select ok(position('validate_eval_work_inquiry_sheared_v5' in pg_get_functiondef('public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text)'::regprocedure))>0,'Eval Work V2 submission stores the server projection');
select ok(position('update public.ph_master_inventory' in lower(pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v5(jsonb)'::regprocedure)))=0,'V5 never mutates live inventory');

create function pg_temp.reclass_v5_payload(p_uid text,p_quantity integer,p_oh text,p_desigitem text,p_actions text[],p_proposals jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v5-sheared-20261008',
    'idempotencyToken','reclass-v5-fixture-token-00001','actorUsername','dylan_collyge',
    'source',jsonb_build_object('unique_id','v5-main','source_table','ph_master_inventory','itemcode','RECLASS-V5-TEST','lotcode','27.F1','locationcode','C.16.000'),
    'transaction',jsonb_build_object('requestActions',to_jsonb(p_actions),'holdStopProposals','[]'::jsonb,'scope',jsonb_build_object()),
    'rowOverlays',jsonb_build_array(jsonb_build_object(
      'unique_id',p_uid,
      'resolution','done',
      'expected',jsonb_build_object('itemcode',case when p_uid='v5-main' then 'RECLASS-V5-TEST' else 'OTHER-V5-TEST' end,
        'lotcode','27.F1','locationcode','C.16.000','ptronhand',p_oh,'desigitem',p_desigitem),
      'proposals',p_proposals
    ))
  )
$$;

select is((private.project_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-main',3,'1,000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb
))->>'workflowPolicyVersion'),'reclass-action-workflow-v5-sheared-20261008','projection preserves the V5 policy');
select is((private.project_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-main',3,'1,000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb
)) #>> '{rowOverlays,0,proposals,0,desigitem}'),'3-->#','database derives exact ASCII designation text');
select is((private.project_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-main',3,'1,000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb
)) #>> '{rowOverlays,0,expected,desigitem}'),'','original null designation snapshot remains unchanged');
select throws_ok($$select private.project_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-main',3,'1000','','{sheared}','[{"action":"sheared","quantity":3,"desigitem":"forged"}]'::jsonb))$$,
  '22023','DRIVE_RECLASS_V5_SHEARED_FIELDS_INVALID','client-supplied derived designation is rejected');
select throws_ok($$select private.project_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-main',0,'1000','','{sheared}','[{"action":"sheared","quantity":0}]'::jsonb))$$,
  '22023','DRIVE_RECLASS_V5_SHEARED_QUANTITY_INVALID','zero sheared quantity is rejected');
select throws_ok($$select private.project_reclass_sheared_v5(
  pg_temp.reclass_v5_payload('v5-main',3,'1000','','{}','[{"action":"sheared","quantity":3}]'::jsonb))$$,
  '22023','DRIVE_RECLASS_V5_ACTIONS_INVALID','empty or no-op V5 action sets are rejected');

create temporary table reclass_v5_fixture(uid text primary key,before_row jsonb) on commit drop;
insert into reclass_v5_fixture(uid,before_row) values ('v5-main',null),('v5-other',null);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,
  ptronhand,ptravailable,source,season,saleyear,desigitem)
values
  ('v5-main','RECLASS-V5-TEST','Reclass V5 fixture','#3','C.16.000','27.F1','1000','1000','PH','F1','27',null),
  ('v5-other','OTHER-V5-TEST','Other V5 fixture','#3','C.16.000','27.F1','1000','1000','PH','F1','27','ORIGINAL');
update reclass_v5_fixture f set before_row=to_jsonb(m)
from public.ph_master_inventory m where m.unique_id=f.uid;

select lives_ok($$select private.validate_drive_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-main',3,'1,000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb))$$,
  'a blank expected designation and formatted 1,000 OH match the unchanged source row');
select lives_ok($$select private.validate_drive_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-main',600,'1000','','{move_up,sheared}',
  '[{"action":"move_up","splits":[{"quantity":400,"destinationSeason":"S1"}],"applyHold":false,"holdReason":""},{"action":"sheared","quantity":600}]'::jsonb))$$,
  'movement and sheared allocations may exactly equal current OH');
select throws_ok($$select private.validate_drive_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-main',600,'1000','','{move_up,sheared}',
  '[{"action":"move_up","splits":[{"quantity":401,"destinationSeason":"S1"}],"applyHold":false,"holdReason":""},{"action":"sheared","quantity":600}]'::jsonb))$$,
  '22023','DRIVE_RECLASS_V5_QUANTITY_EXCEEDS_OH','combined movement and shear cannot exceed current OH');
select throws_ok($$select private.validate_drive_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-main',3,'1000','STALE','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb))$$,
  '40001','DRIVE_RECLASS_V5_ORIGINAL_SNAPSHOT_CONFLICT','a stale original designation is rejected');
select throws_ok($$select private.validate_drive_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-other',3,'1000','ORIGINAL','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb))$$,
  '40001','eval_work_row_identity_conflict','a shear-only overlay cannot cross the authorized source itemcode');
select throws_ok($$select private.validate_drive_reclass_sheared_v5(
  (pg_temp.reclass_v5_payload('v5-main',3,'1000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb)
    || jsonb_build_object('rowOverlays',jsonb_build_array(
      jsonb_build_object('unique_id','v5-main','expected',jsonb_build_object('itemcode','RECLASS-V5-TEST','lotcode','27.F1','locationcode','C.16.000','ptronhand','1000','desigitem',''),'proposals','[{"action":"sheared","quantity":3}]'::jsonb),
      jsonb_build_object('unique_id','v5-main','expected',jsonb_build_object('itemcode','RECLASS-V5-TEST','lotcode','27.F1','locationcode','C.16.000','ptronhand','1000','desigitem',''),'proposals','[{"action":"sheared","quantity":3}]'::jsonb)
    ))))$$,
  '22023','DRIVE_RECLASS_V4_DUPLICATE_ROW','duplicate row identities are rejected even for shear-only actions');
select is((select to_jsonb(m) from public.ph_master_inventory m where m.unique_id='v5-main'),
  (select before_row from reclass_v5_fixture where uid='v5-main'),'validation leaves live inventory byte-for-byte unchanged');
update public.ph_master_inventory set ptronhand='NaN' where unique_id='v5-main';
select throws_ok($$select private.validate_drive_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-main',3,'NaN','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb))$$,
  '40001','DRIVE_RECLASS_V5_ORIGINAL_SNAPSHOT_CONFLICT','nonfinite OH cannot authorize Drive shearing');
update public.ph_master_inventory set ptronhand='Infinity' where unique_id='v5-main';
select throws_ok($$select private.validate_drive_reclass_sheared_v5(pg_temp.reclass_v5_payload(
  'v5-main',3,'Infinity','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb))$$,
  '40001','DRIVE_RECLASS_V5_ORIGINAL_SNAPSHOT_CONFLICT','infinite OH cannot authorize Drive shearing');
update public.ph_master_inventory set ptronhand='1000' where unique_id='v5-main';

create temporary table reclass_v5_eval(result jsonb) on commit drop;
insert into reclass_v5_eval(result)
select private.validate_eval_work_inquiry_sheared_v5(
  pg_temp.reclass_v5_payload('v5-main',3,'1,000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb),
  'RECLASS-V5-TEST',jsonb_build_array((select to_jsonb(m) from public.ph_master_inventory m where m.unique_id='v5-main'))
);
select is((select result #>> '{rowOverlays,0,proposals,0,desigitem}' from reclass_v5_eval),'3-->#',
  'Eval Work V5 projection persists the server-derived designation');
select is((select result #>> '{rowOverlays,0,expected,desigitem}' from reclass_v5_eval),'',
  'Eval Work V5 preserves original nullable designation evidence');
select lives_ok($$select private.validate_eval_work_inquiry_v1(
  jsonb_build_object('workflowPolicyVersion','reclass-action-workflow-v4-split-moves-20261006',
    'transaction',jsonb_build_object('requestActions',jsonb_build_array('move_up'),'holdStopProposals','[]'::jsonb,'scope',jsonb_build_object()),
    'rowOverlays',jsonb_build_array(jsonb_build_object('unique_id','v5-main',
      'expected',jsonb_build_object('itemcode','RECLASS-V5-TEST','lotcode','27.F1','locationcode','C.16.000','ptronhand','1000'),
      'proposals',jsonb_build_array(jsonb_build_object('action','move_up','splits',jsonb_build_array(jsonb_build_object('quantity','','destinationSeason','')),'applyHold',false,'holdReason',''))))),
  'RECLASS-V5-TEST',jsonb_build_array((select to_jsonb(m) from public.ph_master_inventory m where m.unique_id='v5-main'))
)$$,'V4 drafts retain their prior incomplete-split validation behavior');
update public.ph_master_inventory set ptronhand='NaN' where unique_id='v5-main';
select throws_ok($$select private.validate_eval_work_inquiry_sheared_v5(
  pg_temp.reclass_v5_payload('v5-main',3,'NaN','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb),
  'RECLASS-V5-TEST',jsonb_build_array((select to_jsonb(m) from public.ph_master_inventory m where m.unique_id='v5-main')))$$,
  '40001','DRIVE_RECLASS_V5_ORIGINAL_SNAPSHOT_CONFLICT','nonfinite OH cannot authorize Eval Work shearing');
update public.ph_master_inventory set ptronhand='1000' where unique_id='v5-main';
select throws_ok($$select private.validate_eval_work_inquiry_sheared_v5(
  pg_temp.reclass_v5_payload('v5-main',3,'1000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb),
  'RECLASS-V5-TEST',jsonb_build_array((select to_jsonb(m) from public.ph_master_inventory m where m.unique_id='v5-other')))$$,
  '40001','DRIVE_RECLASS_V5_SOURCE_ROW_MISSING','Eval Work shearing cannot escape its current context rows');

create temporary table reclass_v5_actor(username text primary key,id uuid not null) on commit drop;
insert into reclass_v5_actor(username,id)
select wanted.username,coalesce(existing.id,gen_random_uuid())
from (values ('dylan_collyge'),('megan_kelly'),('sharon_combs'),('reclass_v5_actor')) wanted(username)
left join lateral (select p.id from public.profiles p where lower(btrim(p.username))=wanted.username limit 1) existing on true;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select a.id,a.username||'.reclass-v5@example.invalid',now(),'{}'::jsonb,'{}'::jsonb from reclass_v5_actor a
on conflict(id) do update set email=excluded.email,email_confirmed_at=now();
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select a.id,a.username,'Reclass V5 SQL fixture',case when a.username='reclass_v5_actor' then 'EVAL' else 'ADMIN' end,false,null,null from reclass_v5_actor a
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,
  must_change_password=false,disabled_at=null,locked_until=null;
insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope)
select private.resolve_app_access_policy_id_v1(false),a.id,'drive.reclass.submit',true,'global'
from reclass_v5_actor a where a.username='dylan_collyge'
on conflict(policy_id,profile_id,permission_key) do update set allowed=true,access_scope='global';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
create temporary table reclass_v5_delivery(result jsonb) on commit drop;
insert into reclass_v5_delivery(result)
select public.enqueue_drive_reclass_inquiry_v5(
  pg_temp.reclass_v5_payload('v5-main',3,'1,000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb)
  || jsonb_build_object('idempotencyToken','reclass-v5-delivery-token-0001','actorUsername','dylan_collyge')
);
select is((select result->>'duplicate' from reclass_v5_delivery),'false','first V5 enqueue creates a new request');
select is((select o.payload#>>'{reclassPayload,rowOverlays,0,proposals,0,desigitem}' from public.ph_request_delivery_outbox o
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('reclass-v5-delivery-token-0001','sha256'),'hex'),40)),
  '3-->#','outbox snapshot carries the database-derived designation');
select is((select o.payload#>>'{reclassPayload,rowOverlays,0,expected,desigitem}' from public.ph_request_delivery_outbox o
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('reclass-v5-delivery-token-0001','sha256'),'hex'),40)),
  '','outbox snapshot retains the original designation separately');
select is((select count(*)::integer from public.ph_inventory_transactions t join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('reclass-v5-delivery-token-0001','sha256'),'hex'),40)
    and t.status='requested' and t.event_type='inventory_change_request'),1,'V5 creates only the Requested audit row');
select is((select t.raw_payload #>> '{rowOverlays,0,proposals,0,desigitem}'
  from public.ph_inventory_transactions t join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('reclass-v5-delivery-token-0001','sha256'),'hex'),40)
    and t.status='requested' and t.event_type='inventory_change_request'),
  '3-->#','immutable Requested audit stores the server-derived V5 designation');
select is((select t.raw_payload #>> '{rowOverlays,0,expected,desigitem}'
  from public.ph_inventory_transactions t join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('reclass-v5-delivery-token-0001','sha256'),'hex'),40)
    and t.status='requested' and t.event_type='inventory_change_request'),
  '','immutable Requested audit preserves the original designation separately');
select is((select count(*)::integer from public.ph_inventory_transactions t join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('reclass-v5-delivery-token-0001','sha256'),'hex'),40) and t.status='applied'),0,
  'V5 does not apply inventory changes');
select is((public.enqueue_drive_reclass_inquiry_v5(
  pg_temp.reclass_v5_payload('v5-main',3,'1,000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb)
    || jsonb_build_object('idempotencyToken','reclass-v5-delivery-token-0001','actorUsername','dylan_collyge')))->>'duplicate',
  'true','an identical token retry returns the original V5 request');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v5(
  pg_temp.reclass_v5_payload('v5-main',4,'1,000','','{sheared}','[{"action":"sheared","quantity":4}]'::jsonb)
    || jsonb_build_object('idempotencyToken','reclass-v5-delivery-token-0001','actorUsername','dylan_collyge'))$$,
  'P0001','DRIVE_RECLASS_TOKEN_CONFLICT','changed content cannot reuse a V5 token');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('reclass-v5-delivery-token-0001','sha256'),'hex'),40)),1,
  'identical and conflicting V5 retries do not create duplicate requests');
select is((select to_jsonb(m) from public.ph_master_inventory m where m.unique_id='v5-main'),
  (select before_row from reclass_v5_fixture where uid='v5-main'),'enqueue leaves source inventory unchanged');

-- Exercise both public Eval Work submit wrappers through saved V5 drafts,
-- finalization, fingerprinted duplicate replay, and changed-token rejection.
create temporary table reclass_v5_eval_work_ids(contract text primary key,id uuid not null) on commit drop;
insert into reclass_v5_eval_work_ids values ('v1',gen_random_uuid()),('v2',gen_random_uuid());
insert into public.ph_eval_work(
  id,create_token,contract_version,status,creator_username,creator_display,
  assignee_username,assignee_display,assignee_email,completion_recipients,
  itemcode,commonname,contsize,origin_unique_id,origin_locationcode,origin_lotcode,origin_source,
  origin_snapshot,context_rows,inventory_signature,settings_signature,inquiry_draft,
  version,origin_count,assignee_usernames,assignee_profiles,assigned_to_users
)
select w.id,'reclass-v5-eval-'||w.contract,
  case when w.contract='v1' then 'eval-work-v1' else 'eval-work-v2-multi-origin' end,'open',
  'dylan_collyge','Reclass V5 SQL fixture','reclass_v5_actor','Reclass V5 SQL fixture',
  'reclass_v5_actor@example.invalid',array['reclass_v5_actor@example.invalid'],
  m.itemcode,m.commonname,m.contsize,m.unique_id,m.locationcode,m.lotcode,m.source,
  to_jsonb(m),private.eval_work_context_rows_v1(m.itemcode),
  md5(private.eval_work_context_rows_v1(m.itemcode)::text),md5(private.eval_work_settings_v1()::text),
  pg_temp.reclass_v5_payload('v5-main',3,'1000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb),
  1,1,array['reclass_v5_actor'],
  jsonb_build_array(jsonb_build_object('username','reclass_v5_actor','displayName','Reclass V5 SQL fixture','email','reclass_v5_actor@example.invalid')),
  array['reclass_v5_actor']
from reclass_v5_eval_work_ids w
cross join public.ph_master_inventory m
where m.unique_id='v5-main';
insert into public.ph_eval_work_origin_rows(eval_work_id,origin_unique_id,itemcode,locationcode,lotcode,source,ordinal,origin_snapshot)
select w.id,m.unique_id,m.itemcode,m.locationcode,m.lotcode,m.source,1,to_jsonb(m)
from reclass_v5_eval_work_ids w cross join public.ph_master_inventory m
where w.contract='v2' and m.unique_id='v5-main';
select lives_ok($q$select public.save_eval_work_v1(
  (select id from reclass_v5_eval_work_ids where contract='v1'),'reclass_v5_actor',1,
  pg_temp.reclass_v5_payload('v5-main',3,'1000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb),'{}'::jsonb)$q$,
  'V1 savedraft accepts a valid raw V5 shearing proposal');
select is((select inquiry_draft#>>'{rowOverlays,0,proposals,0,desigitem}' from public.ph_eval_work where id=(select id from reclass_v5_eval_work_ids where contract='v1')),
  null,'V1 savedraft preserves the raw client draft; projection is applied at submission');
select lives_ok($q$select public.save_eval_work_v2(
  (select id from reclass_v5_eval_work_ids where contract='v2'),'reclass_v5_actor',1,
  pg_temp.reclass_v5_payload('v5-main',3,'1000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb),
  '{"v5-main":{}}'::jsonb)$q$,
  'V2 savedraft accepts a valid raw V5 shearing proposal');
select is((select inquiry_draft#>>'{rowOverlays,0,proposals,0,desigitem}' from public.ph_eval_work where id=(select id from reclass_v5_eval_work_ids where contract='v2')),
  null,'V2 savedraft preserves the raw client draft; projection is applied at submission');
select throws_ok($q$select public.submit_eval_work_v1(
  w.id,'reclass_v5_actor',1,w.inquiry_draft,'{}'::jsonb,'reclass-v5-submit-v1-token-0001')
  from public.ph_eval_work w where w.id=(select id from reclass_v5_eval_work_ids where contract='v1')$q$,
  '40001','eval_work_version_conflict','V1 submission retains optimistic-version enforcement after V5 save');
select lives_ok($q$select public.submit_eval_work_v1(
  w.id,'reclass_v5_actor',w.version,pg_temp.reclass_v5_payload('v5-main',3,'1000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb),
  jsonb_build_object('spec','V5 fixture spec','avNote','Fixture reviewed','locMatchPercent','100',
    'photos',jsonb_build_array(jsonb_build_object('filePath','eval/'||w.id::text||'/fixture.jpg','url','https://example.invalid/fixture.jpg','name','fixture.jpg'))),
  'reclass-v5-submit-v1-token-0001')
  from public.ph_eval_work w where w.id=(select id from reclass_v5_eval_work_ids where contract='v1')$q$,
  'V1 submission finalizes a saved V5 request');
select lives_ok($q$select public.submit_eval_work_v2(
  w.id,'reclass_v5_actor',w.version,pg_temp.reclass_v5_payload('v5-main',3,'1000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb),
  jsonb_build_object('v5-main',jsonb_build_object('spec','V5 fixture spec','avNote','Fixture reviewed','locMatchPercent','100',
    'photos',jsonb_build_array(jsonb_build_object('filePath','eval/'||w.id::text||'/v5-main/fixture.jpg','url','https://example.invalid/fixture.jpg','name','fixture.jpg')))),
  'reclass-v5-submit-v2-token-0001')
  from public.ph_eval_work w where w.id=(select id from reclass_v5_eval_work_ids where contract='v2')$q$,
  'V2 submission finalizes a saved V5 multi-origin request');
select is((select submitted_inquiry#>>'{rowOverlays,0,proposals,0,desigitem}' from public.ph_eval_work where id=(select id from reclass_v5_eval_work_ids where contract='v1')),
  '3-->#','V1 finalized snapshot retains the derived proposal designation');
select is((select submitted_inquiry#>>'{rowOverlays,0,proposals,0,desigitem}' from public.ph_eval_work where id=(select id from reclass_v5_eval_work_ids where contract='v2')),
  '3-->#','V2 finalized snapshot retains the derived proposal designation');
select is((select submitted_inquiry#>>'{rowOverlays,0,expected,desigitem}' from public.ph_eval_work where id=(select id from reclass_v5_eval_work_ids where contract='v1')),
  '','V1 finalized snapshot keeps the original designation separate');
select is((select submitted_inquiry#>>'{rowOverlays,0,expected,desigitem}' from public.ph_eval_work where id=(select id from reclass_v5_eval_work_ids where contract='v2')),
  '','V2 finalized snapshot keeps the original designation separate');
select lives_ok($q$select public.submit_eval_work_v1(
  w.id,'reclass_v5_actor',w.version,
  pg_temp.reclass_v5_payload('v5-main',3,'1000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb),
  jsonb_build_object('spec','V5 fixture spec','avNote','Fixture reviewed','locMatchPercent','100',
    'photos',jsonb_build_array(jsonb_build_object('filePath','eval/'||w.id::text||'/fixture.jpg','url','https://example.invalid/fixture.jpg','name','fixture.jpg'))),
  'reclass-v5-submit-v1-token-0001')
  from public.ph_eval_work w where w.id=(select id from reclass_v5_eval_work_ids where contract='v1')$q$,
  'identical V1 submission retry returns the original work');
select lives_ok($q$select public.submit_eval_work_v2(
  w.id,'reclass_v5_actor',w.version,
  pg_temp.reclass_v5_payload('v5-main',3,'1000','','{sheared}','[{"action":"sheared","quantity":3}]'::jsonb),
  jsonb_build_object('v5-main',jsonb_build_object('spec','V5 fixture spec','avNote','Fixture reviewed','locMatchPercent','100',
    'photos',jsonb_build_array(jsonb_build_object('filePath','eval/'||w.id::text||'/v5-main/fixture.jpg','url','https://example.invalid/fixture.jpg','name','fixture.jpg')))),
  'reclass-v5-submit-v2-token-0001')
  from public.ph_eval_work w where w.id=(select id from reclass_v5_eval_work_ids where contract='v2')$q$,
  'identical V2 submission retry returns the original work');
select is((select count(*)::integer from public.ph_request_delivery_outbox where event_type='eval_work_completion'
  and request_id=(select id::text from reclass_v5_eval_work_ids where contract='v1')),
  1,'V1 duplicate submit creates no second completion event');
select is((select count(*)::integer from public.ph_request_delivery_outbox where event_type='eval_work_completion'
  and request_id=(select id::text from reclass_v5_eval_work_ids where contract='v2')),
  1,'V2 duplicate submit creates no second completion event');
select throws_ok($q$select public.submit_eval_work_v1(
  w.id,'reclass_v5_actor',w.version,
  pg_temp.reclass_v5_payload('v5-main',4,'1000','','{sheared}','[{"action":"sheared","quantity":4}]'::jsonb),
  jsonb_build_object('spec','V5 fixture spec','avNote','Fixture reviewed','locMatchPercent','100',
    'photos',jsonb_build_array(jsonb_build_object('filePath','eval/'||w.id::text||'/fixture.jpg','url','https://example.invalid/fixture.jpg','name','fixture.jpg'))),
  'reclass-v5-submit-v1-token-0001')
  from public.ph_eval_work w where w.id=(select id from reclass_v5_eval_work_ids where contract='v1')$q$,
  'P0001','eval_work_submission_token_conflict','changed V1 content cannot reuse a submitted token');
select throws_ok($q$select public.submit_eval_work_v2(
  w.id,'reclass_v5_actor',w.version,
  pg_temp.reclass_v5_payload('v5-main',4,'1000','','{sheared}','[{"action":"sheared","quantity":4}]'::jsonb),
  jsonb_build_object('v5-main',jsonb_build_object('spec','V5 fixture spec','avNote','Fixture reviewed','locMatchPercent','100',
    'photos',jsonb_build_array(jsonb_build_object('filePath','eval/'||w.id::text||'/v5-main/fixture.jpg','url','https://example.invalid/fixture.jpg','name','fixture.jpg')))),
  'reclass-v5-submit-v2-token-0001')
  from public.ph_eval_work w where w.id=(select id from reclass_v5_eval_work_ids where contract='v2')$q$,
  'P0001','eval_work_submission_token_conflict','changed V2 content cannot reuse a submitted token');
select is((select jsonb_build_array(m.ptronhand,m.desigitem) from public.ph_master_inventory m where m.unique_id='v5-main'),
  '["1000",null]'::jsonb,'V1/V2 sheared requests preserve source quantity and designation');

select * from finish();
rollback;
