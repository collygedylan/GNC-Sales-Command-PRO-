-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei,
  locationnote,locationptn1,pullerresponsibility,oversellpercentage,salesnote,suspend,
  photo_link,photo_name,spec,av_note,match
) values (
  'p25-eval-v7-row','P25-EVAL-V7','Synthetic Eval V7 plant','#3','E.01.001','27.F1','14','11',
  '3','PH','F1','27','D1','C1','L1','10',
  'Original Eval note','Original PTN','Original puller','4','Original sales note',null,
  'https://example.invalid/eval-v7.jpg','eval-v7.jpg','Original specification','Original AV note','88'
);
update public.app_dataset_revisions set state='ready',revision=greatest(revision,1)
where key='ph_master_inventory';

create temporary table p25_eval_v7_actors(username text primary key,id uuid not null) on commit drop;
insert into p25_eval_v7_actors(username,id) values
  ('p25_eval_v7_assignee','a7500000-0000-4000-8000-000000000071'),
  ('p25_eval_v7_other','a7500000-0000-4000-8000-000000000072');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select id,username||'@example.invalid',now(),'{}'::jsonb,'{}'::jsonb from p25_eval_v7_actors
on conflict(id) do update set email=excluded.email,email_confirmed_at=now();
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select id,username,case when username='p25_eval_v7_assignee' then 'Eval Assignee' else 'Other Evaluator' end,
  'EVAL',false,null,null from p25_eval_v7_actors
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,
  must_change_password=false,disabled_at=null,locked_until=null;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);

create function pg_temp.p25_eval_v7_inquiry() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v7-editable-fields-20261009',
    'source',jsonb_build_object('unique_id',m.unique_id,'source_table','ph_master_inventory',
      'itemcode',m.itemcode,'lotcode',m.lotcode,'locationcode',m.locationcode),
    'transaction',jsonb_build_object('requestActions',jsonb_build_array('inventory_fields','move_down'),
      'holdStopProposals','[]'::jsonb,'scope','{}'::jsonb),
    'rowOverlays',jsonb_build_array(jsonb_build_object(
      'unique_id',m.unique_id,'resolution','done',
      'expected',jsonb_build_object('itemcode',m.itemcode,'lotcode',m.lotcode,'locationcode',m.locationcode,
        'ptronhand',m.ptronhand,'desigitem',m.desigitem,'priority',m.priority,
        'holdstopcode',m.holdstopcode,'holdstopreason',m.holdstopreason),
      'proposals',jsonb_build_array(jsonb_build_object('action','move_down',
        'splits',jsonb_build_array(jsonb_build_object('quantity',2,'destinationSeason','S1')),
        'applyHold',false,'holdReason','')),
      'fieldEdits',jsonb_build_array(jsonb_build_object(
        'field','locationnote','expected',m.locationnote,'value','Updated Eval note'))
    ))
  ) from public.ph_master_inventory m where m.unique_id='p25-eval-v7-row'
$$;

create temporary table p25_eval_v7_work_id(id uuid primary key) on commit drop;
insert into p25_eval_v7_work_id values('a7500000-0000-4000-8000-000000000081');
insert into public.ph_eval_work(
  id,create_token,contract_version,status,creator_username,creator_display,
  assignee_username,assignee_display,assignee_email,completion_recipients,
  itemcode,commonname,contsize,origin_unique_id,origin_locationcode,origin_lotcode,origin_source,
  origin_snapshot,context_rows,inventory_signature,settings_signature,inquiry_draft,
  version,origin_count,assignee_usernames,assignee_profiles,assigned_to_users
)
select w.id,'p25-eval-v7-create-token','eval-work-v1','open',
  'p25_eval_v7_creator','Prompt 2.5 Eval V7 SQL fixture',a.username,'Eval Assignee',a.username||'@example.invalid',
  array[a.username||'@example.invalid'],m.itemcode,m.commonname,m.contsize,m.unique_id,m.locationcode,m.lotcode,m.source,
  to_jsonb(m),private.eval_work_context_rows_v1(m.itemcode),
  md5(private.eval_work_context_rows_v1(m.itemcode)::text),md5(private.eval_work_settings_v1()::text),
  pg_temp.p25_eval_v7_inquiry(),1,1,array[a.username],
  jsonb_build_array(jsonb_build_object('username',a.username,'displayName','Eval Assignee','email',a.username||'@example.invalid')),
  array[a.username]
from p25_eval_v7_work_id w
cross join p25_eval_v7_actors a
cross join public.ph_master_inventory m
where a.username='p25_eval_v7_assignee' and m.unique_id='p25-eval-v7-row';

select lives_ok($q$select public.save_eval_work_v1(
  w.id,'p25_eval_v7_assignee',w.version,w.inquiry_draft,'{}'::jsonb)
  from public.ph_eval_work w where w.id=(select id from p25_eval_v7_work_id)$q$,
  'Eval Work accepts the V7 draft before final submission');
select is((select locationnote from public.ph_master_inventory where unique_id='p25-eval-v7-row'),
  'Original Eval note','saving the V7 draft does not apply editable inventory fields');
select is((select ptronhand from public.ph_master_inventory where unique_id='p25-eval-v7-row'),
  '14','saving the mixed V7 draft does not change quantity');
select ok(not exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7
  where canonical_unique_id='p25-eval-v7-row' and field_name='locationnote' and pending),
  'saving a V7 draft creates no live field shield');

create temporary table p25_eval_v7_submit_request(inquiry jsonb not null,evidence jsonb not null) on commit drop;
insert into p25_eval_v7_submit_request
select w.inquiry_draft,
  jsonb_build_object('spec','Original specification','avNote','Original AV note','locMatchPercent','88',
    'photos',jsonb_build_array(jsonb_build_object('filePath','eval/'||w.id::text||'/fixture.jpg',
      'url','https://example.invalid/eval-v7.jpg','name','eval-v7.jpg')))
from public.ph_eval_work w where w.id=(select id from p25_eval_v7_work_id);

create temporary table p25_eval_v7_submitted on commit drop as
select (public.submit_eval_work_v1(
  w.id,'p25_eval_v7_assignee',w.version,(select inquiry from p25_eval_v7_submit_request),
  (select evidence from p25_eval_v7_submit_request),
  'p25-eval-v7-submit-token-0001'
)).*
from public.ph_eval_work w where w.id=(select id from p25_eval_v7_work_id);

select is((select locationnote from public.ph_master_inventory where unique_id='p25-eval-v7-row'),
  'Updated Eval note','final V7 submission applies the editable field atomically');
select is((select ptronhand from public.ph_master_inventory where unique_id='p25-eval-v7-row'),
  '14','mixed field and Move Down submission leaves live on-hand quantity unchanged');
select is((select jsonb_build_array(photo_link,photo_name,spec,av_note,match) from public.ph_master_inventory where unique_id='p25-eval-v7-row'),
  '["https://example.invalid/eval-v7.jpg","eval-v7.jpg","Original specification","Original AV note","88"]'::jsonb,
  'the V7 location-note edit preserves existing inventory photo and AV evidence');
select is((select submitted_inquiry->>'workflowPolicyVersion' from public.ph_eval_work where id=(select id from p25_eval_v7_work_id)),
  'reclass-action-workflow-v7-editable-fields-20261009','the submitted Eval snapshot retains the V7 policy');
select is((select submitted_inquiry #>> '{transaction,requestActions,1}' from public.ph_eval_work where id=(select id from p25_eval_v7_work_id)),
  'move_down','the mixed movement proposal remains in the submitted inquiry');
select is((select o.payload #>> '{protectedDelivery,liveEditVersion}' from public.ph_request_delivery_outbox o
  where o.event_id=(select completion_event_id from public.ph_eval_work where id=(select id from p25_eval_v7_work_id))),
  'reclass-action-workflow-v7-editable-fields-20261009','the completion outbox is marked as a protected V7 delivery');
select is((select o.payload #>> '{protectedDelivery,inventoryFields,0,before,locationnote}' from public.ph_request_delivery_outbox o
  where o.event_id=(select completion_event_id from public.ph_eval_work where id=(select id from p25_eval_v7_work_id))),
  'Original Eval note','the completion receipt freezes the old editable value');
select is((select o.payload #>> '{protectedDelivery,inventoryFields,0,after,locationnote}' from public.ph_request_delivery_outbox o
  where o.event_id=(select completion_event_id from public.ph_eval_work where id=(select id from p25_eval_v7_work_id))),
  'Updated Eval note','the completion receipt includes the confirmed editable value');
select is((select o.payload #>> '{protectedDelivery,v7FrozenRows,0,locationnote}' from public.ph_request_delivery_outbox o
  where o.event_id=(select completion_event_id from public.ph_eval_work where id=(select id from p25_eval_v7_work_id))),
  'Original Eval note','the frozen completion row is the pre-edit inventory snapshot');
select is((select o.payload #>> '{inquiry,transaction,requestActions,1}' from public.ph_request_delivery_outbox o
  where o.event_id=(select completion_event_id from public.ph_eval_work where id=(select id from p25_eval_v7_work_id))),
  'move_down','the queued completion payload retains the Move Down request');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.event_type='eval_work_completion' and o.request_id=(select id::text from p25_eval_v7_work_id)),
  1,'the V7 Eval submission creates one completion event');
select ok((select pending from app_sync_private.ph_master_inventory_item6_edits_v7
  where canonical_unique_id='p25-eval-v7-row' and field_name='locationnote'),
  'the submitted V7 field remains shielded until its raw source value is acknowledged');

select lives_ok($q$select public.submit_eval_work_v1(
  w.id,'p25_eval_v7_assignee',w.version,
  (select inquiry from p25_eval_v7_submit_request),
  (select evidence from p25_eval_v7_submit_request),
  'p25-eval-v7-submit-token-0001') from public.ph_eval_work w
  where w.id=(select id from p25_eval_v7_work_id)$q$,
  'an identical V7 Eval retry returns the committed submission');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.event_type='eval_work_completion' and o.request_id=(select id::text from p25_eval_v7_work_id)),
  1,'an idempotent V7 Eval retry does not create another completion event');

select throws_ok($q$select public.submit_eval_work_v1(
  w.id,'p25_eval_v7_other',w.version,w.submitted_inquiry,'{}'::jsonb,'p25-eval-v7-submit-token-0001')
  from public.ph_eval_work w where w.id=(select id from p25_eval_v7_work_id)$q$,
  '42501','eval_work_submit_forbidden','an unrelated evaluator cannot retry another assignee’s submission');
select is((select count(*)::integer from public.ph_request_delivery_outbox o
  where o.event_type='eval_work_completion' and o.request_id=(select id::text from p25_eval_v7_work_id)),
  1,'an unauthorized submit attempt creates no completion event');

select * from finish();
rollback;
