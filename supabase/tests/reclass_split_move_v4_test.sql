begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

create function pg_temp.reclass_v4_inquiry(up_move jsonb, down_move jsonb, expected_oh text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v4-split-moves-20261006',
    'transaction',jsonb_build_object('requestActions',to_jsonb(array_remove(array[
      case when up_move is null then null else 'move_up' end,
      case when down_move is null then null else 'move_down' end
    ]::text[],null)),'holdStopProposals','[]'::jsonb,'scope',jsonb_build_object()),
    'rowOverlays',jsonb_build_array(jsonb_build_object(
      'unique_id','v4-u1',
      'expected',jsonb_build_object('itemcode','A1','lotcode','27.F1','locationcode','A.1','ptronhand',expected_oh),
      'proposals',to_jsonb(array_remove(array[up_move,down_move]::jsonb[],null))
    ))
  )
$$;
select lives_ok($$select private.validate_eval_work_inquiry_v1(
  pg_temp.reclass_v4_inquiry(
    '{"action":"move_up","splits":[{"quantity":3,"destinationSeason":"X"},{"quantity":2,"destinationSeason":"X"}],"applyHold":true,"holdReason":"review ok"}'::jsonb,
    '{"action":"move_down","splits":[{"quantity":5,"destinationSeason":"S1"}],"applyHold":false,"holdReason":""}'::jsonb,
    '10'),
  'A1',
  '[{"unique_id":"v4-u1","itemcode":"A1","lotcode":"27.F1","locationcode":"A.1","ptronhand":"10","season":"F1"}]'::jsonb
)$$,'ordered repeated destinations and independent move holds validate without inventory writes');
select is(private.project_reclass_split_move_v4(pg_temp.reclass_v4_inquiry(
  '{"action":"move_up","splits":[{"quantity":3,"destinationSeason":"X"},{"quantity":2,"destinationSeason":"X"}],"applyHold":true,"holdReason":"review ok"}'::jsonb,
  null,'10'),false) #>> '{rowOverlays,0,proposals,1,destinationSeason}','X','repeated destinations retain their submitted order');
select throws_ok($$select private.validate_eval_work_inquiry_v1(
  pg_temp.reclass_v4_inquiry(
    '{"action":"move_up","splits":[{"quantity":6,"destinationSeason":"X"}],"applyHold":false,"holdReason":""}'::jsonb,
    '{"action":"move_down","splits":[{"quantity":5,"destinationSeason":"S1"}],"applyHold":false,"holdReason":""}'::jsonb,
    '10'),
  'A1',
  '[{"unique_id":"v4-u1","itemcode":"A1","lotcode":"27.F1","locationcode":"A.1","ptronhand":"10","season":"F1"}]'::jsonb
)$$,'22023','eval_work_combined_move_exceeds_oh','combined up and down split quantities cannot exceed original OH');
select throws_ok($$select private.validate_eval_work_inquiry_v1(
  pg_temp.reclass_v4_inquiry(
    '{"action":"move_up","splits":[{"quantity":3,"destinationSeason":"X"}],"applyHold":false,"holdReason":""}'::jsonb,
    null,'11'),
  'A1',
  '[{"unique_id":"v4-u1","itemcode":"A1","lotcode":"27.F1","locationcode":"A.1","ptronhand":"10","season":"F1"}]'::jsonb
)$$,'40001','eval_work_original_oh_conflict','a stale OH snapshot is rejected');

select throws_ok($$select private.validate_eval_work_inquiry_v4_strict(
  pg_temp.reclass_v4_inquiry(
    '{"action":"move_up","splits":[{"quantity":3,"destinationSeason":"X"}],"applyHold":false,"holdReason":""}'::jsonb,
    null,'10') #- '{rowOverlays,0,expected,ptronhand}',
  'A1',
  '[{"unique_id":"v4-u1","itemcode":"A1","lotcode":"27.F1","locationcode":"A.1","ptronhand":"10","season":"F1"}]'::jsonb
)$$,'40001','eval_work_original_oh_conflict','final moves cannot omit their reviewed OH');
select lives_ok($$select private.validate_eval_work_inquiry_v4_strict(
  pg_temp.reclass_v4_inquiry(null,null,''),'A1',
  '[{"unique_id":"v4-u1","itemcode":"A1","lotcode":"27.F1","locationcode":"A.1","ptronhand":null,"season":"F1"}]'::jsonb
)$$,'untouched rows with unknown OH remain valid inquiry context');

select has_function('public','enqueue_drive_reclass_inquiry_v4',array['jsonb'],'V4 has a dedicated protected enqueue');
select ok(has_function_privilege('service_role','public.enqueue_drive_reclass_inquiry_v4(jsonb)','execute'),'service role may call V4 after app API authorization');
select ok(not has_function_privilege('authenticated','public.enqueue_drive_reclass_inquiry_v4(jsonb)','execute'),'authenticated users cannot bypass the app API');
select ok(not has_function_privilege('anon','public.enqueue_drive_reclass_inquiry_v4(jsonb)','execute'),'anonymous users cannot enqueue V4');
select has_function('private','project_reclass_split_move_v4',array['jsonb'],'V4 split payloads have a bounded projection');
select has_function('private','validate_drive_reclass_split_move_v4',array['jsonb'],'Drive splits validate against authoritative inventory');
select ok(position('reclass-action-workflow-v4-split-moves-20261006' in pg_get_functiondef('private.project_reclass_split_move_v4(jsonb,boolean)'::regprocedure)) > 0,'projection pins the exact V4 contract');
select ok(position('split_count > 100' in pg_get_functiondef('private.project_reclass_split_move_v4(jsonb,boolean)'::regprocedure)) > 0,'each movement is bounded to 100 ordered splits');
select ok(position('holdReason' in pg_get_functiondef('private.project_reclass_split_move_v4(jsonb,boolean)'::regprocedure)) > 0,'hold reason is part of each movement proposal');
select ok(position('requestFingerprint' in pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v4(jsonb)'::regprocedure)) > 0,'outbox records a fingerprint of the complete canonical request');
select ok(position('saved_fingerprint is distinct from fingerprint' in pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v4(jsonb)'::regprocedure)) > 0,'changed retries conflict while exact retries reuse their event');
select ok(position('public.enqueue_drive_reclass_inquiry_v1' in pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v4(jsonb)'::regprocedure)) > 0,'V4 retains V1 actor role assignment and recipient safeguards');
select ok(position('update public.ph_master_inventory' in lower(pg_get_functiondef('public.enqueue_drive_reclass_inquiry_v4(jsonb)'::regprocedure)) = 0,'V4 does not mutate inventory');
select ok(position('validate_eval_work_inquiry_legacy_v1' in pg_get_functiondef('private.validate_eval_work_inquiry_v1(jsonb,text,jsonb)'::regprocedure)) > 0,'EvalWork V4 validation preserves existing V2/V3 validation');
select ok(position('expected,ptronhand' in pg_get_functiondef('private.validate_eval_work_inquiry_v1(jsonb,text,jsonb)'::regprocedure)) > 0,'draft save rejects a stale original OH snapshot');
select ok(position('private.project_reclass_split_move_v4(p_inquiry,false)' in pg_get_functiondef('private.validate_eval_work_inquiry_v4_strict(jsonb,text,jsonb)'::regprocedure)) > 0,'final submission requires complete split quantities, destinations, and hold reason');
select ok(position('private.validate_eval_work_inquiry_v4_strict' in pg_get_functiondef('public.submit_eval_work_v1(uuid,text,integer,jsonb,jsonb,text)'::regprocedure)) > 0,'EvalWork finalization enforces strict V4 validation');
select ok(position('private.validate_eval_work_inquiry_v4_strict' in pg_get_functiondef('public.submit_eval_work_v2(uuid,text,integer,jsonb,jsonb,text)'::regprocedure)) > 0,'multi-origin EvalWork finalization enforces strict V4 validation');
select lives_ok($$select private.project_reclass_split_move_v4(pg_temp.reclass_v4_inquiry(
  '{"action":"move_up","splits":[{"quantity":"","destinationSeason":""}],"applyHold":true,"holdReason":""}'::jsonb,
  null,'10'),true)$$,'draft projection accepts a blank split row and incomplete hold reason');
select throws_ok($$select private.project_reclass_split_move_v4(pg_temp.reclass_v4_inquiry(
  '{"action":"move_up","splits":[{"quantity":2,"destinationSeason":"X"}],"applyHold":true,"holdReason":""}'::jsonb,
  null,'10'))$$,'22023','DRIVE_RECLASS_V4_HOLD_REASON_INVALID','strict projection rejects a held move without a reason');
select throws_ok($$select private.project_reclass_split_move_v4(pg_temp.reclass_v4_inquiry(
  '{"action":"move_up","splits":[{"quantity":"","destinationSeason":""}],"applyHold":false,"holdReason":""}'::jsonb,
  null,'10'))$$,'22023','DRIVE_RECLASS_V4_SPLIT_INVALID','strict projection rejects an incomplete split row');

-- Exercise the real service-only enqueue against isolated rows and users.
create temporary table reclass_v4_test_actor(username text primary key, id uuid not null) on commit drop;
insert into reclass_v4_test_actor(username,id)
select wanted.username, coalesce(existing.id,gen_random_uuid())
from (values ('dylan_collyge'),('megan_kelly'),('sharon_combs')) wanted(username)
left join lateral (
  select p.id from public.profiles p where lower(btrim(p.username))=wanted.username limit 1
) existing on true;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select a.id, a.username || '.reclass-v4@example.invalid', now(), '{}'::jsonb, '{}'::jsonb
from reclass_v4_test_actor a
on conflict (id) do update set email=excluded.email,email_confirmed_at=now();
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select a.id,a.username,'Reclass V4 SQL fixture','ADMIN',false,null,null
from reclass_v4_test_actor a
on conflict (id) do update set username=excluded.username,display_name=excluded.display_name,
  role=excluded.role,must_change_password=false,disabled_at=null,locked_until=null;
insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope)
select private.resolve_app_access_policy_id_v1(false),a.id,'drive.reclass.submit',true,'global'
from reclass_v4_test_actor a where a.username='dylan_collyge'
on conflict (policy_id,profile_id,permission_key) do update set allowed=true,access_scope='global';

create temporary table reclass_v4_test_source(unique_id text primary key, before_row jsonb) on commit drop;
insert into reclass_v4_test_source(unique_id,before_row) values ('reclass-v4-' || gen_random_uuid()::text,null);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,
  ptronhand,ptravailable,source,season,saleyear)
select unique_id,'RECLASS-V4-TEST','Reclass V4 fixture','#3','C.16.000','27.F1','10','10','PH','F1','27'
from reclass_v4_test_source;
update reclass_v4_test_source s set before_row=to_jsonb(m)
from public.ph_master_inventory m where m.unique_id=s.unique_id;

create function pg_temp.reclass_v4_drive_payload(p_uid text,p_token text,p_up jsonb,p_down jsonb,p_oh text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'type','reclass_inquiry_email','action','reclass',
    'workflowPolicyVersion','reclass-action-workflow-v4-split-moves-20261006',
    'idempotencyToken',p_token,'actorUsername','dylan_collyge',
    'source',jsonb_build_object('unique_id',p_uid,'source_table','ph_master_inventory',
      'itemcode','RECLASS-V4-TEST','lotcode','27.F1','locationcode','C.16.000','season','F1','saleyear','27'),
    'transaction',jsonb_build_object('requestActions',jsonb_build_array('move_up','move_down'),
      'holdStopProposals','[]'::jsonb,'scope',jsonb_build_object()),
    'rowOverlays',jsonb_build_array(jsonb_build_object('unique_id',p_uid,
      'expected',jsonb_build_object('itemcode','RECLASS-V4-TEST','lotcode','27.F1',
        'locationcode','C.16.000','ptronhand',p_oh),
      'proposals',jsonb_strip_nulls(jsonb_build_array(p_up,p_down)))))
$$;

create temporary table reclass_v4_test_result(result jsonb) on commit drop;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
insert into reclass_v4_test_result(result)
select public.enqueue_drive_reclass_inquiry_v4(pg_temp.reclass_v4_drive_payload(
  s.unique_id,'reclass-v4-split-token-00001',
  '{"action":"move_up","splits":[{"quantity":3,"destinationSeason":"X"},{"quantity":2,"destinationSeason":"X"}],"applyHold":true,"holdReason":"review after transfer"}'::jsonb,
  '{"action":"move_down","splits":[{"quantity":5,"destinationSeason":"Y"}],"applyHold":false,"holdReason":""}'::jsonb,
  '10')) from reclass_v4_test_source s;

select is((select result->>'duplicate' from reclass_v4_test_result),'false','first V4 enqueue creates a new delivery event');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.payload#>>'{reclassPayload,idempotencyToken}'='reclass-v4-split-token-00001'),1,
  'one immutable outbox snapshot is created');
select is((select o.payload#>'{reclassPayload,rowOverlays,0,proposals,0,splits}'
  from public.ph_request_delivery_outbox o where o.payload#>>'{reclassPayload,idempotencyToken}'='reclass-v4-split-token-00001'),
  '[{"quantity":3,"destinationSeason":"X"},{"quantity":2,"destinationSeason":"X"}]'::jsonb,
  'ordered repeated destinations are preserved in the outbox');
select is((select o.payload#>>'{reclassPayload,rowOverlays,0,proposals,0,applyHold}'
  from public.ph_request_delivery_outbox o where o.payload#>>'{reclassPayload,idempotencyToken}'='reclass-v4-split-token-00001'),
  'true','upward move keeps its independent hold request');
select is((select o.payload#>>'{reclassPayload,rowOverlays,0,proposals,0,holdReason}'
  from public.ph_request_delivery_outbox o where o.payload#>>'{reclassPayload,idempotencyToken}'='reclass-v4-split-token-00001'),
  'review after transfer','held movement reason is retained in the snapshot');
select is((select o.payload#>>'{reclassPayload,rowOverlays,0,proposals,1,applyHold}'
  from public.ph_request_delivery_outbox o where o.payload#>>'{reclassPayload,idempotencyToken}'='reclass-v4-split-token-00001'),
  'false','downward move remains independently not held');
select is((select to_jsonb(m) from public.ph_master_inventory m join reclass_v4_test_source s on s.unique_id=m.unique_id),
  (select before_row from reclass_v4_test_source),'enqueue does not mutate source inventory');
select is((select count(*)::integer from public.ph_inventory_transactions t
  where t.delivery_event_id=(select (result->>'jobId')::uuid from reclass_v4_test_result) and t.status='applied'),0,
  'enqueue does not create an applied inventory transaction');
select is((select count(*)::integer from public.ph_inventory_transactions t
  where t.delivery_event_id=(select (result->>'jobId')::uuid from reclass_v4_test_result)
    and t.status='requested' and t.event_type='inventory_change_request'),1,
  'enqueue preserves one requested-delivery audit');
select is((select t.raw_payload from public.ph_inventory_transactions t
  where t.delivery_event_id=(select (result->>'jobId')::uuid from reclass_v4_test_result)
    and t.status='requested' and t.event_type='inventory_change_request'),
  (select jsonb_build_object('transaction',o.payload#>'{reclassPayload,transaction}',
    'rowOverlays',o.payload#>'{reclassPayload,rowOverlays}')
   from public.ph_request_delivery_outbox o where o.event_id=(select (result->>'jobId')::uuid from reclass_v4_test_result)),
  'requested audit preserves the final V4 split and hold snapshot');

select is((public.enqueue_drive_reclass_inquiry_v4(pg_temp.reclass_v4_drive_payload(
  (select unique_id from reclass_v4_test_source),'reclass-v4-split-token-00001',
  '{"action":"move_up","splits":[{"quantity":3,"destinationSeason":"X"},{"quantity":2,"destinationSeason":"X"}],"applyHold":true,"holdReason":"review after transfer"}'::jsonb,
  '{"action":"move_down","splits":[{"quantity":5,"destinationSeason":"Y"}],"applyHold":false,"holdReason":""}'::jsonb,'10'))->>'duplicate'),
  'true','an identical retry returns the original event');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.payload#>>'{reclassPayload,idempotencyToken}'='reclass-v4-split-token-00001'),1,
  'identical retries do not create another outbox event');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v4(pg_temp.reclass_v4_drive_payload(
  (select unique_id from reclass_v4_test_source),'reclass-v4-split-token-00001',
  '{"action":"move_up","splits":[{"quantity":4,"destinationSeason":"X"}],"applyHold":true,"holdReason":"review after transfer"}'::jsonb,
  '{"action":"move_down","splits":[{"quantity":5,"destinationSeason":"Y"}],"applyHold":false,"holdReason":""}'::jsonb,'10'))$$,
  'P0001','DRIVE_RECLASS_TOKEN_CONFLICT','changed content with a reused token is rejected');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.payload#>>'{reclassPayload,idempotencyToken}'='reclass-v4-split-token-00001'),1,
  'conflicting retries do not create a second outbox event');
select is((select count(*)::integer from public.ph_inventory_transactions t
  where t.delivery_event_id=(select (result->>'jobId')::uuid from reclass_v4_test_result)
    and t.status='requested' and t.event_type='inventory_change_request'),1,
  'identical and conflicting retries do not duplicate the requested audit');

select throws_ok($$select public.enqueue_drive_reclass_inquiry_v4(pg_temp.reclass_v4_drive_payload(
  (select unique_id from reclass_v4_test_source),'reclass-v4-missing-hold-token-001',
  '{"action":"move_up","splits":[{"quantity":2,"destinationSeason":"X"}],"applyHold":true,"holdReason":" "}'::jsonb,
  null,'10'))$$,'22023','DRIVE_RECLASS_V4_HOLD_REASON_INVALID','a held move requires a normalized nonempty reason');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.payload#>>'{reclassPayload,idempotencyToken}'='reclass-v4-missing-hold-token-001'),0,
  'missing hold reason is rejected before enqueue');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v4(pg_temp.reclass_v4_drive_payload(
  (select unique_id from reclass_v4_test_source),'reclass-v4-invalid-destination-token-01',
  '{"action":"move_up","splits":[{"quantity":2,"destinationSeason":"Q9"}],"applyHold":false,"holdReason":""}'::jsonb,
  null,'10'))$$,'22023','DRIVE_RECLASS_V4_SPLIT_INVALID','an unconfigured destination is rejected');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.payload#>>'{reclassPayload,idempotencyToken}'='reclass-v4-invalid-destination-token-01'),0,
  'invalid destination is rejected before enqueue');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v4(pg_temp.reclass_v4_drive_payload(
  (select unique_id from reclass_v4_test_source),'reclass-v4-invalid-quantity-token-01',
  '{"action":"move_up","splits":[{"quantity":0,"destinationSeason":"X"}],"applyHold":false,"holdReason":""}'::jsonb,
  null,'10'))$$,'22023','DRIVE_RECLASS_V4_SPLIT_INVALID','a zero movement quantity is rejected');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v4(pg_temp.reclass_v4_drive_payload(
  (select unique_id from reclass_v4_test_source),'reclass-v4-over-oh-token-000001',
  '{"action":"move_up","splits":[{"quantity":6,"destinationSeason":"X"}],"applyHold":false,"holdReason":""}'::jsonb,
  '{"action":"move_down","splits":[{"quantity":5,"destinationSeason":"Y"}],"applyHold":false,"holdReason":""}'::jsonb,'10'))$$,
  '22023','eval_work_combined_move_exceeds_oh','combined upward and downward quantities cannot exceed original OH');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.payload#>>'{reclassPayload,idempotencyToken}'='reclass-v4-over-oh-token-000001'),0,
  'an over-OH request leaves no outbox event');
select is((select to_jsonb(m) from public.ph_master_inventory m join reclass_v4_test_source s on s.unique_id=m.unique_id),
  (select before_row from reclass_v4_test_source),'invalid and repeated requests preserve source inventory');
select is((select count(*)::integer from public.ph_inventory_transactions t
  join reclass_v4_test_source s on s.unique_id=t.source_unique_id
  where t.status='requested' and t.event_type='inventory_change_request'),1,
  'rejected requests roll back their provisional outbox audit');

select * from finish();
rollback;
