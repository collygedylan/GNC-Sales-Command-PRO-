-- Disposable isolated local/CI database only. Synthetic profiles, work and
-- outbox events are transaction-scoped and rolled back; nothing is delivered.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

-- Follow the native profile/auth fixtures used by reclass_review_assignedto_test.
create temporary table sep09_test_profiles as
select username, coalesce((select id from public.profiles p where lower(p.username)=names.username), gen_random_uuid()) id
from unnest(array['dylan_collyge','megan_kelly','jd_jones','charley_robertson','zoe_green','sep09_extra']) names(username);
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select id,username||'@sep09.example.invalid','{}'::jsonb,'{}'::jsonb from sep09_test_profiles
on conflict(id) do update set email=excluded.email;
insert into public.profiles(id,username,display_name,role,must_change_password)
select id,username,'Sep09 '||username,'ADMIN',false from sep09_test_profiles
on conflict(id) do update set display_name=excluded.display_name,disabled_at=null,locked_until=null,must_change_password=false;
insert into public.ph_app_settings(key,value)
values('current_season_salesyear','{"seasonCode":"F1","salesYear":"27"}')
on conflict(key) do update set value=excluded.value;
insert into public.ph_master_inventory(unique_id,itemcode,genusname,commonname,contsize,locationcode,lotcode,source,season,saleyear,ptronhand,ptravailable)
values('SEP09-COMPAT-A','SEP09-COMPAT-ITEM','Spiraea','Synthetic rollback fixture','#3','I.13.000','27.S1','LD','S1','27','40','40');
insert into public.ph_warehouse_assigned_items(unique_id,itemcode,itemcode_normalized,genusname,genusname_normalized,assignment_key,assignedto,present_in_drive,assigned_at)
values('SEP09-COMPAT-ASSIGN','SEP09-COMPAT-ITEM','SEP09-COMPAT-ITEM','Spiraea','spiraea','SEP09-COMPAT-ITEM|spiraea','charley_robertson',true,now());

create temporary table sep09_packets(name text primary key,payload jsonb);
insert into sep09_packets values('source','{"actorUsername":"dylan_collyge","source":{"unique_id":"SEP09-COMPAT-A","source_table":"ph_master_inventory","itemcode":"SEP09-COMPAT-ITEM","locationcode":"I.13.000","lotcode":"27.S1"}}');
-- This is the server payload assembled for the old browser's manual-assignee
-- shape. Canonical evaluator emails are resolved in App API before this RPC.
insert into sep09_packets
select 'legacy',payload||jsonb_build_object(
  'createToken','sep09-compat-legacy-create-0001',
  'assigneeUsername','zoe_green','assigneeEmail','zoe_green@sep09.example.invalid',
  'assignees',jsonb_build_array(jsonb_build_object('username','zoe_green','email','zoe_green@sep09.example.invalid')),
  'completionRecipients',jsonb_build_array('SEP09_EXTRA@sep09.example.invalid','sep09_extra@sep09.example.invalid','invalid-address'),
  'instructions','Preserve the Sep 9 manual review')
from sep09_packets where name='source';

select ok(not has_function_privilege('anon','public.create_eval_work_legacy_sep09_v1(jsonb)','execute'),'legacy RPC is not anonymous callable');
select ok(not has_function_privilege('authenticated','public.create_eval_work_legacy_sep09_v1(jsonb)','execute'),'legacy RPC cannot bypass authenticated App API');
select ok(has_function_privilege('service_role','public.create_eval_work_legacy_sep09_v1(jsonb)','execute'),'legacy RPC is server callable');
select set_config('request.jwt.claim.role','anon',true);
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy'))$q$,'42501','eval_work_create_forbidden','anonymous request claims fail the explicit service guard');
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy'))$q$,'42501','eval_work_create_forbidden','browser request claims fail the explicit service guard');
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy')||'{"actorUsername":"missing_sep09_actor"}'::jsonb)$q$,'42501','eval_work_actor_not_authorized','missing actor cannot create a legacy review');
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy')||'{"actorUsername":"charley_robertson"}'::jsonb)$q$,'42501','eval_work_create_forbidden','evaluator role alone cannot create a legacy review');
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy')||'{"actorUsername":"jd_jones"}'::jsonb)$q$,'42501','eval_work_create_forbidden','legacy retains Sep 9 Dylan/Megan creator scope');
update public.profiles set disabled_at=now() where username='dylan_collyge';
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy'))$q$,'42501','eval_work_actor_not_authorized','disabled creator is denied');
update public.profiles set disabled_at=null,locked_until=now()+interval '1 day' where username='dylan_collyge';
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy'))$q$,'42501','eval_work_actor_not_authorized','locked creator is denied');
update public.profiles set locked_until=null where username='dylan_collyge';

select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy')||'{"completionRecipients":[]}'::jsonb)$q$,'22023','eval_work_completion_recipient_required','legacy creation requires a completion recipient');
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy')||'{"completionRecipients":["invalid-address"]}'::jsonb)$q$,'22023','eval_work_completion_recipient_required','invalid-only completion recipients cannot create work');
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy')||'{"assignees":[{"username":"zoe_green","email":"invalid-address"}]}'::jsonb)$q$,'22023','eval_work_assignee_email_invalid','legacy assignee email must be usable');
update public.profiles set disabled_at=now() where username='zoe_green';
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy'))$q$,'42501','eval_work_actor_not_authorized','inactive manual evaluator is denied');
update public.profiles set disabled_at=null where username='zoe_green';
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1(jsonb_set((select payload from sep09_packets where name='legacy'),'{source,lotcode}','"26.F1"'))$q$,'40001','eval_work_origin_identity_conflict','legacy source identity validation remains active');
select is((select count(*)::integer from public.ph_eval_work where create_token='sep09-compat-legacy-create-0001'),0,'rejected legacy requests have no saved work');

select lives_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy'))$q$,'old manual-assignee payload creates real work without a modern revision');
create temporary table sep09_legacy_created as select * from public.ph_eval_work where create_token='sep09-compat-legacy-create-0001';
select is((select assignee_username from sep09_legacy_created),'zoe_green','manual evaluator is preserved despite different current AssignedTo');
select is((select assignee_usernames from sep09_legacy_created),array['zoe_green'],'legacy assignee arrays satisfy the base INSERT contract');
select is((select assignee_profiles#>>'{0,email}' from sep09_legacy_created),'zoe_green@sep09.example.invalid','legacy stores the verified evaluator email');
select is((select completion_recipients from sep09_legacy_created),array['sep09_extra@sep09.example.invalid'],'legacy completion recipients normalize, deduplicate and omit invalid addresses');
select ok((select not(coalesce(source_context,'{}'::jsonb)?'reviewAssignment') from sep09_legacy_created),'legacy creation does not invent a modern confirmation snapshot');
select ok((select o.payload->'assignmentRecipients' @> '["dylan_collyge@sep09.example.invalid","megan_kelly@sep09.example.invalid","zoe_green@sep09.example.invalid"]'::jsonb from public.ph_request_delivery_outbox o join sep09_legacy_created w on w.assignment_event_id=o.event_id),'assignment delivery retains required managers and manual evaluator');
select is((select jsonb_array_length(o.payload->'assignmentRecipients') from public.ph_request_delivery_outbox o join sep09_legacy_created w on w.assignment_event_id=o.event_id),3,'completion extras do not become assignment recipients');

select is((public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy'))).id,(select id from sep09_legacy_created),'same legacy token returns its original work');
select is((select count(*)::integer from public.ph_eval_work where create_token='sep09-compat-legacy-create-0001'),1,'same legacy token creates exactly one work row');
select is((select count(*)::integer from public.ph_eval_work_events where eval_work_id=(select id from sep09_legacy_created) and event_type='created'),1,'legacy replay creates no duplicate creation event');
select is((select count(*)::integer from public.ph_request_delivery_outbox where request_id=(select id::text from sep09_legacy_created) and event_type='eval_work_assignment'),1,'legacy replay creates no duplicate assignment delivery');
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy')||'{"actorUsername":"megan_kelly"}'::jsonb)$q$,'42501','eval_work_create_token_forbidden','another allowed creator cannot reuse a legacy token');
select throws_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy')||'{"assignees":[{"username":"charley_robertson","email":"charley_robertson@sep09.example.invalid"}]}'::jsonb)$q$,'40001','eval_work_create_token_assignees_conflict','same token cannot silently switch manual evaluators');
select is((select assignee_usernames from public.ph_eval_work where id=(select id from sep09_legacy_created)),array['zoe_green'],'conflicting replay leaves original evaluator intact');
select lives_ok($q$select public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='legacy')||'{"actorUsername":"megan_kelly","createToken":"sep09-compat-megan-create-0002"}'::jsonb)$q$,'Megan retains the Sep 9 creator permission');

-- Newer open clients still create and replay through the unchanged modern RPC.
insert into sep09_packets
select 'modern',payload||jsonb_build_object(
  'createToken','sep09-compat-modern-create-0003',
  'expectedAssignmentRevision',public.get_eval_work_review_setup_v1(payload)->>'assignmentRevision',
  'additionalCompletionRecipients',jsonb_build_array('sep09_extra@sep09.example.invalid'),
  'instructions','Preserve the modern frozen review')
from sep09_packets where name='source';
select lives_ok($q$select public.create_eval_work_multi_v1((select payload from sep09_packets where name='modern'))$q$,'current AssignedTo review creation remains available');
create temporary table sep09_modern_created as select * from public.ph_eval_work where create_token='sep09-compat-modern-create-0003';
create temporary table sep09_modern_delivery as select o.* from public.ph_request_delivery_outbox o join sep09_modern_created w on w.assignment_event_id=o.event_id;
select is((select assignee_username from sep09_modern_created),'charley_robertson','modern creation keeps authoritative AssignedTo evaluator');
select ok((select source_context?'reviewAssignment' from sep09_modern_created),'modern review has a frozen confirmation snapshot');
select throws_ok($q$select public.create_eval_work_multi_v1(((select payload from sep09_packets where name='modern')-'expectedAssignmentRevision')||'{"createToken":"sep09-compat-modern-no-confirm-0004"}'::jsonb)$q$,'22023','REVIEW_CONFIRMATION_REQUIRED','adding legacy RPC does not weaken modern confirmation');

-- Change the data the old wrapper would normally rewrite on replay, then send
-- a legacy-shaped retry carrying the already-created modern review's token.
update public.profiles set display_name='Changed Charley fixture' where username='charley_robertson';
update auth.users set email='changed_charley@sep09.example.invalid' where id=(select id from sep09_test_profiles where username='charley_robertson');
update auth.users set email='changed_manager@sep09.example.invalid' where id=(select id from sep09_test_profiles where username='megan_kelly');
insert into sep09_packets
select 'modern_legacy_retry',payload||jsonb_build_object(
  'createToken','sep09-compat-modern-create-0003',
  'assigneeUsername','charley_robertson','assigneeEmail','changed_charley@sep09.example.invalid',
  'assignees',jsonb_build_array(jsonb_build_object('username','charley_robertson','email','changed_charley@sep09.example.invalid')),
  'completionRecipients',jsonb_build_array('changed_completion@sep09.example.invalid'))
from sep09_packets where name='legacy';
select is((public.create_eval_work_legacy_sep09_v1((select payload from sep09_packets where name='modern_legacy_retry'))).id,(select id from sep09_modern_created),'legacy retry recognizes already-created modern review');
select is((select to_jsonb(w) from public.ph_eval_work w where w.id=(select id from sep09_modern_created)),(select to_jsonb(w) from sep09_modern_created w),'legacy retry cannot rewrite any frozen modern work field');
select is((select to_jsonb(o) from public.ph_request_delivery_outbox o join sep09_modern_created w on w.assignment_event_id=o.event_id),(select to_jsonb(o) from sep09_modern_delivery o),'legacy retry cannot rewrite modern recipients, snapshots or delivery metadata');
select is((select count(*)::integer from public.ph_request_delivery_outbox where request_id=(select id::text from sep09_modern_created) and event_type='eval_work_assignment'),1,'cross-contract replay creates no duplicate delivery');
select is((public.create_eval_work_multi_v1((select payload from sep09_packets where name='modern'))).id,(select id from sep09_modern_created),'newer client still replays its original modern review after profile changes');
select is((select to_jsonb(o) from public.ph_request_delivery_outbox o join sep09_modern_created w on w.assignment_event_id=o.event_id),(select to_jsonb(o) from sep09_modern_delivery o),'modern replay also preserves the original delivery');

select * from finish();
rollback;
