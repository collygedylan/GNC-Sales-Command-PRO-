-- Disposable isolated local/CI database only. Every fixture and outbox event
-- rolls back; this is not a production data repair or delivery canary.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table review_test_profiles as
select username, coalesce((select id from public.profiles p where lower(p.username) = names.username), gen_random_uuid()) id
from unnest(array['dylan_collyge','megan_kelly','jd_jones','charley_robertson','zoe_green','review_extra']) names(username);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select id, username || '@review.example.invalid', '{}'::jsonb, '{}'::jsonb from review_test_profiles
on conflict(id) do update set email = excluded.email;
insert into public.profiles(id,username,display_name,role,must_change_password)
select id,username,'Review ' || username,'ADMIN',false from review_test_profiles
on conflict(id) do update set display_name=excluded.display_name,disabled_at=null,locked_until=null,must_change_password=false;
insert into public.ph_app_settings(key,value)
values('current_season_salesyear','{"seasonCode":"F1","salesYear":"27"}')
on conflict(key) do update set value=excluded.value;
insert into public.ph_master_inventory(unique_id,itemcode,genusname,commonname,contsize,locationcode,lotcode,source,season,saleyear,ptronhand,ptravailable)
values
 ('REVIEW-TEST-A','REVIEW-TEST-ITEM','Spiraea','Magic Carpet fixture','#3','I.13.000','27.S1','LD','S1','27','40','40'),
 ('REVIEW-TEST-B','REVIEW-TEST-ITEM','Hydrangea','Same ITEMCODE other genus','#3','B.01.000','27.F1','LD','F1','27','20','20');
insert into public.ph_warehouse_assigned_items(unique_id,itemcode,itemcode_normalized,genusname,genusname_normalized,assignment_key,assignedto,present_in_drive,assigned_at)
values
 ('REVIEW-ASSIGN-A','REVIEW-TEST-ITEM','REVIEW-TEST-ITEM','Spiraea','spiraea','REVIEW-TEST-ITEM|spiraea','charley_robertson',true,now()),
 ('REVIEW-ASSIGN-B','REVIEW-TEST-ITEM','REVIEW-TEST-ITEM','Hydrangea','hydrangea','REVIEW-TEST-ITEM|hydrangea','zoe_green',true,now());
create temporary table review_packets(name text primary key,payload jsonb);
insert into review_packets values ('a','{"actorUsername":"dylan_collyge","source":{"unique_id":"REVIEW-TEST-A","source_table":"ph_master_inventory","itemcode":"REVIEW-TEST-ITEM","locationcode":"I.13.000","lotcode":"27.S1"}}');
insert into review_packets select 'b', payload || '{"source":{"unique_id":"REVIEW-TEST-B","source_table":"ph_master_inventory","itemcode":"REVIEW-TEST-ITEM","locationcode":"B.01.000","lotcode":"27.F1"}}'::jsonb from review_packets where name='a';
create temporary table review_setup_results as select name,public.get_eval_work_review_setup_v1(payload) setup from review_packets;

select ok(not has_function_privilege('anon','public.get_eval_work_review_setup_v1(jsonb)','execute'),'setup denied to anonymous');
select ok(not has_function_privilege('authenticated','public.get_eval_work_review_setup_v1(jsonb)','execute'),'setup cannot bypass App API');
select ok(has_function_privilege('service_role','public.get_eval_work_review_setup_v1(jsonb)','execute'),'setup granted only to server');
select ok(not has_function_privilege('authenticated','public.create_eval_work_multi_v1(jsonb)','execute'),'creation cannot bypass App API');
select ok(not has_function_privilege('anon','private.create_eval_work_review_base_v1(jsonb)','execute'),'private clone not anonymous callable');
select ok(not has_function_privilege('authenticated','private.create_eval_work_review_base_v1(jsonb)','execute'),'private clone not browser callable');
select is((select setup#>>'{evaluator,username}' from review_setup_results where name='a'),'charley_robertson','exact opening genus resolves Charley');
select is((select setup#>>'{evaluator,username}' from review_setup_results where name='b'),'zoe_green','same ITEMCODE other genus resolves Zoe');
select is((select setup#>>'{completionRecipients,0}' from review_setup_results where name='a'),'charley_robertson@review.example.invalid','assigned evaluator automatically required');
select is((select count(*)::integer from public.ph_eval_work where origin_unique_id like 'REVIEW-TEST-%'),0,'setup is read-only');
select throws_ok($q$select public.get_eval_work_review_setup_v1((select payload from review_packets where name='a') || '{"actorUsername":"review_extra"}'::jsonb)$q$,'42501','eval_work_create_forbidden','unapproved creator denied');
select throws_ok($q$select public.get_eval_work_review_setup_v1(jsonb_set((select payload from review_packets where name='a'),'{source,unique_id}','"missing"'))$q$,'22023','REVIEW_SOURCE_MISSING','missing source guidance');
select throws_ok($q$select public.get_eval_work_review_setup_v1(jsonb_set((select payload from review_packets where name='a'),'{source,lotcode}','"26.F1"'))$q$,'22023','REVIEW_SOURCE_STALE','stale physical identity denied');

insert into review_packets select 'create',p.payload || jsonb_build_object(
 'createToken','review-assignedto-test-created-0001','expectedAssignmentRevision',s.setup->>'assignmentRevision',
 'additionalCompletionRecipients',jsonb_build_array('REVIEW_EXTRA@review.example.invalid','charley_robertson@review.example.invalid','review_extra@review.example.invalid'),
 'instructions','Keep this instruction',
 'inquiry',jsonb_build_object('workflowPolicyVersion','reclass-action-workflow-v3-row-actions-20260826','transaction',jsonb_build_object('requestActions','[]'::jsonb),'rowOverlays','[]'::jsonb),
 'assigneeUsername','zoe_green','assigneeEmail','attacker@example.invalid','assignees',jsonb_build_array(jsonb_build_object('username','zoe_green','email','attacker@example.invalid')),
 'completionRecipients',jsonb_build_array('attacker@example.invalid'))
from review_packets p join review_setup_results s using(name) where name='a';
select throws_ok($q$select public.create_eval_work_multi_v1((select payload from review_packets where name='create')-'expectedAssignmentRevision')$q$,'22023','REVIEW_CONFIRMATION_REQUIRED','old clients must confirm assigned evaluator');
select throws_ok($q$select public.create_eval_work_multi_v1((select payload from review_packets where name='create') || '{"additionalCompletionRecipients":["attacker@example.invalid"]}'::jsonb)$q$,'22023','REVIEW_RECIPIENT_INVALID','extra recipients must resolve active profiles');
select throws_ok($q$select public.create_eval_work_multi_v1((select payload from review_packets where name='create') || '{"expectedAssignmentRevision":"old"}'::jsonb)$q$,'22023','REVIEW_ASSIGNMENT_CHANGED','stale assignment rejected before insertion');
select lives_ok($q$select public.create_eval_work_multi_v1((select payload from review_packets where name='create'))$q$,'composed base inserts real work with valid email');
create temporary table review_created as select * from public.ph_eval_work where create_token='review-assignedto-test-created-0001';
select is((select assignee_username from review_created),'charley_robertson','hostile evaluator override ignored');
select is((select assignee_usernames from review_created),array['charley_robertson'],'required assignee arrays populated at INSERT');
select is((select assignee_profiles#>>'{0,email}' from review_created),'charley_robertson@review.example.invalid','assignee address server-derived');
select is((select cardinality(completion_recipients) from review_created),2,'assigned person plus extras deduplicated');
select ok((select completion_recipients @> array['charley_robertson@review.example.invalid','review_extra@review.example.invalid'] from review_created),'completion required assignee and extra present');
select ok((select not(completion_recipients && array['dylan_collyge@review.example.invalid','megan_kelly@review.example.invalid','attacker@example.invalid']) from review_created),'no forced manager completion copies or hostile recipient');
select is((select source_context#>>'{reviewAssignment,completionRecipients,0,displayName}' from review_created),'Review charley_robertson','actual completion names frozen');
select ok((select o.payload->'assignmentRecipients' @> '["dylan_collyge@review.example.invalid","megan_kelly@review.example.invalid","charley_robertson@review.example.invalid"]'::jsonb from public.ph_request_delivery_outbox o join review_created w on w.assignment_event_id=o.event_id),'assignment email retains manager copies and evaluator');
create temporary table review_frozen_event as select o.* from public.ph_request_delivery_outbox o join review_created w on w.assignment_event_id=o.event_id;

update public.ph_warehouse_assigned_items set assignedto='zoe_green',assigned_at=now()+interval '1 second' where unique_id='REVIEW-ASSIGN-A';
select is((public.create_eval_work_multi_v1((select payload from review_packets where name='create'))).id,(select id from review_created),'idempotent retry returns original work after assignment changed');
select is((select count(*)::integer from public.ph_eval_work where create_token='review-assignedto-test-created-0001'),1,'same token creates exactly one review');
select is((select to_jsonb(o) from public.ph_request_delivery_outbox o join review_created w on w.assignment_event_id=o.event_id),(select to_jsonb(f) from review_frozen_event f),'replay never rewrites assignment delivery');
select throws_ok($q$select public.create_eval_work_multi_v1((select payload from review_packets where name='create') || '{"createToken":"review-assignedto-test-stale-0002"}'::jsonb)$q$,'22023','REVIEW_ASSIGNMENT_CHANGED','new work requires reconfirmation of changed assignment');
select throws_ok($q$select public.create_eval_work_multi_v1((select payload from review_packets where name='create') || '{"actorUsername":"megan_kelly"}'::jsonb)$q$,'42501','eval_work_create_token_forbidden','another creator cannot replay someone else token');

update public.ph_warehouse_assigned_items set assignedto='' where unique_id='REVIEW-ASSIGN-A';
select throws_ok($q$select public.get_eval_work_review_setup_v1((select payload from review_packets where name='a'))$q$,'22023','REVIEW_ASSIGNMENT_MISSING','blank assignment has specific guidance');
update public.ph_warehouse_assigned_items set assignedto='charley_robertson,zoe_green' where unique_id='REVIEW-ASSIGN-A';
select throws_ok($q$select public.get_eval_work_review_setup_v1((select payload from review_packets where name='a'))$q$,'22023','REVIEW_ASSIGNMENT_AMBIGUOUS','multiple assigned people never silently selected');
update public.ph_warehouse_assigned_items set assignedto='review_extra' where unique_id='REVIEW-ASSIGN-A';
select throws_ok($q$select public.get_eval_work_review_setup_v1((select payload from review_packets where name='a'))$q$,'22023','REVIEW_ASSIGNEE_INELIGIBLE','non-evaluator assignment denied');
update public.ph_warehouse_assigned_items set assignedto='charley_robertson' where unique_id='REVIEW-ASSIGN-A';
update public.profiles set disabled_at=now() where username='charley_robertson';
select throws_ok($q$select public.get_eval_work_review_setup_v1((select payload from review_packets where name='a'))$q$,'22023','REVIEW_ASSIGNEE_INACTIVE','inactive evaluator denied');
select is((public.create_eval_work_multi_v1((select payload from review_packets where name='create'))).id,(select id from review_created),'old work replay does not depend on current evaluator eligibility');
update public.profiles set disabled_at=null,locked_until=now()+interval '1 day' where username='charley_robertson';
select throws_ok($q$select public.get_eval_work_review_setup_v1((select payload from review_packets where name='a'))$q$,'22023','REVIEW_ASSIGNEE_INACTIVE','locked evaluator denied');
update public.profiles set locked_until=null where username='charley_robertson';
update auth.users set email=null where id=(select id from review_test_profiles where username='charley_robertson');
select throws_ok($q$select public.get_eval_work_review_setup_v1((select payload from review_packets where name='a'))$q$,'22023','REVIEW_ASSIGNEE_EMAIL_MISSING','missing canonical email denied');
update auth.users set email='charley_robertson@review.example.invalid' where id=(select id from review_test_profiles where username='charley_robertson');
select lives_ok($q$select public.create_eval_work_multi_v1((select payload from review_packets where name='create') || jsonb_build_object('actorUsername','jd_jones','createToken','review-assignedto-test-jd-0003','expectedAssignmentRevision',public.get_eval_work_review_setup_v1((select payload from review_packets where name='a'))->>'assignmentRevision'))$q$,'JD existing UI/API creator access works in final SQL path');
select lives_ok($q$select public.create_eval_work_multi_v1(((select payload from review_packets where name='create')-'inquiry') || jsonb_build_object('createToken','review-assignedto-test-blank-0004','expectedAssignmentRevision',public.get_eval_work_review_setup_v1((select payload from review_packets where name='a'))->>'assignmentRevision'))$q$,'blank inquiry uses valid base default');
select lives_ok($q$select public.create_eval_work_multi_v1((select payload from review_packets where name='create') || jsonb_build_object('createToken','review-assignedto-test-null-0005','inquiry',null,'expectedAssignmentRevision',public.get_eval_work_review_setup_v1((select payload from review_packets where name='a'))->>'assignmentRevision'))$q$,'JSON null inquiry uses valid base default');

-- Completion uses the stored recipient list, even after a later reassignment.
update public.ph_warehouse_assigned_items set assignedto='zoe_green' where unique_id='REVIEW-ASSIGN-A';
select lives_ok($q$select public.submit_eval_work_v1(w.id,'charley_robertson',w.version,w.inquiry_draft,
 jsonb_build_object('spec','N/A','avNote','Fixture reviewed','locMatchPercent','100','photos',jsonb_build_array(jsonb_build_object('filePath','eval/'||w.id::text||'/fixture.jpg','url','https://example.invalid/fixture.jpg','name','fixture.jpg'))),
 'review-assignedto-completion-0001') from public.ph_eval_work w where w.create_token='review-assignedto-test-created-0001'$q$,'existing review is completed by saved evaluator after assignment changes');
select is((select o.payload->'completionRecipients' from public.ph_request_delivery_outbox o join public.ph_eval_work w on w.completion_event_id=o.event_id where w.create_token='review-assignedto-test-created-0001'),(select to_jsonb(completion_recipients) from review_created),'completion event preserves frozen assigned person plus extras');
select is((select count(*)::integer from public.ph_request_delivery_outbox where event_type='eval_work_completion' and request_id=(select id::text from review_created)),1,'exactly one completion event');

select * from finish();
rollback;
