-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei,
  locationnote,locationptn1,pullerresponsibility,oversellpercentage,salesnote,suspend
) values (
  'p25-v7-source','P25-V7','Synthetic V7 plant','#3','V.01.001','27.F1','10','9',
  '2','PH','F1','27','D1','C1','L1','10',
  'Old location note','Old PTN','Old puller','8','Old sales note',null
);
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei
) values ('p25-v7-collision-a','P25-V7-AMBIG','Ambiguous tuple A','#3','V.02.001','27.S1','10','9',
  '2','PH','F1','27','D1','C1','L1','10');
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei
) values ('p25-v7-collision-b','P25-V7-AMBIG','Ambiguous tuple B','#3','V.02.001','27.S1','10','9',
  '2','PH','F1','27','Z9','C9','L9','10');
update public.ph_master_inventory set desigitem='D2' where unique_id='p25-v7-collision-a';
update public.app_dataset_revisions set state='ready',revision=greatest(revision,1)
where key='ph_master_inventory';

create temporary table p25_v7_actor(username text primary key,id uuid not null) on commit drop;
insert into p25_v7_actor(username,id)
select 'dylan_collyge',coalesce((select p.id from public.profiles p where lower(p.username)='dylan_collyge' limit 1),gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select id,'p25-v7-admin@example.invalid',now(),'{}'::jsonb,'{}'::jsonb from p25_v7_actor
on conflict(id) do update set email=excluded.email,email_confirmed_at=now();
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select id,'dylan_collyge','Dylan Collyge','ADMIN',false,null,null from p25_v7_actor
on conflict(id) do update set username=excluded.username,display_name=excluded.display_name,role=excluded.role,
  must_change_password=false,disabled_at=null,locked_until=null;
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values('a7000000-0000-4000-8000-000000000071','p25-v7-active-csr@example.invalid',now(),'{}'::jsonb,'{}'::jsonb),
  ('a7000000-0000-4000-8000-000000000072','p25-v7-disabled-csr@example.invalid',now(),'{}'::jsonb,'{}'::jsonb)
on conflict(id) do update set email=excluded.email,email_confirmed_at=excluded.email_confirmed_at;
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select u.id,case when u.email='p25-v7-active-csr@example.invalid' then 'p25_v7_active_csr' else 'p25_v7_disabled_csr' end,
  'Prompt 2.5 recipient', 'CSR',true,
  case when u.email='p25-v7-disabled-csr@example.invalid' then now() else null end,
  case when u.email='p25-v7-active-csr@example.invalid' then now()+interval '1 day' else null end
from auth.users u where u.email in ('p25-v7-active-csr@example.invalid','p25-v7-disabled-csr@example.invalid')
on conflict(id) do update set role=excluded.role,must_change_password=excluded.must_change_password,
  disabled_at=excluded.disabled_at,locked_until=excluded.locked_until;
insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope)
select private.resolve_app_access_policy_id_v1(false),id,'drive.reclass.submit',true,'global' from p25_v7_actor
on conflict(policy_id,profile_id,permission_key) do update set allowed=true,access_scope='global';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);

create function pg_temp.p25_v7_payload(p_token text) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'workflowPolicyVersion','reclass-action-workflow-v7-editable-fields-20261009',
    'idempotencyToken',p_token,'actorUsername','dylan_collyge',
    'source',jsonb_build_object('unique_id',m.unique_id,'source_table','ph_master_inventory',
      'itemcode',m.itemcode,'lotcode',m.lotcode,'locationcode',m.locationcode),
    'transaction',jsonb_build_object('requestActions',jsonb_build_array('inventory_fields'),
      'holdStopProposals','[]'::jsonb,'scope','{}'::jsonb),
    'rowOverlays',jsonb_build_array(jsonb_build_object(
      'unique_id',m.unique_id,'resolution','done',
      'expected',jsonb_build_object('itemcode',m.itemcode,'lotcode',m.lotcode,'locationcode',m.locationcode,
        'ptronhand',m.ptronhand,'desigitem',m.desigitem,'priority',m.priority,
        'holdstopcode',m.holdstopcode,'holdstopreason',m.holdstopreason,
        'locationnote',m.locationnote,'locationptn1',m.locationptn1,'desigcust',m.desigcust,'desigloc',m.desigloc,
        'pullerresponsibility',m.pullerresponsibility,'oversellpercentage',m.oversellpercentage,
        'salesnote',m.salesnote,'suspend',m.suspend),
      'proposals','[]'::jsonb,
      'fieldEdits',jsonb_build_array(
        jsonb_build_object('field','locationnote','expected',m.locationnote,'value','New location note'),
        jsonb_build_object('field','locationptn1','expected',m.locationptn1,'value','New PTN'),
        jsonb_build_object('field','desigitem','expected',m.desigitem,'value','D2'),
        jsonb_build_object('field','desigcust','expected',m.desigcust,'value','C2'),
        jsonb_build_object('field','desigloc','expected',m.desigloc,'value','L2'),
        jsonb_build_object('field','pullerresponsibility','expected',m.pullerresponsibility,'value','New puller'),
        jsonb_build_object('field','oversellpercentage','expected',m.oversellpercentage,'value','12'),
        jsonb_build_object('field','salesnote','expected',m.salesnote,'value','New sales note'),
        jsonb_build_object('field','suspend','expected',m.suspend,'decision','yes')
      )
    ))
  ) from public.ph_master_inventory m where m.unique_id='p25-v7-source'
$$;
create temporary table p25_v7_input(payload jsonb not null) on commit drop;
insert into p25_v7_input values(pg_temp.p25_v7_payload('p25-v7-edit-submit-token-0001'));
create temporary table p25_v7_result(result jsonb) on commit drop;
insert into p25_v7_result select public.enqueue_drive_reclass_inquiry_v7(payload) from p25_v7_input;

select is((select result->>'duplicate' from p25_v7_result),'false','V7 field submission creates a new protected request');
select is((select jsonb_build_array(locationnote,locationptn1,desigitem,desigcust,desigloc,
  pullerresponsibility,oversellpercentage,salesnote,suspend) from public.ph_master_inventory where unique_id='p25-v7-source'),
  '["New location note","New PTN","D2","C2","L2","New puller","12","New sales note","DC"]'::jsonb,
  'the authorized V7 submission atomically applies all nine editable fields and derives SUS from the actor');
select is((select ptronhand from public.ph_master_inventory where unique_id='p25-v7-source'),'10',
  'editable field submission leaves on hand unchanged');
select ok((select prisetby is not null and priupdated is not null and locationnotedate is not null
  from public.ph_master_inventory where unique_id='p25-v7-source'),'V7 stamps priority actor/update and changed location note');
select is((select result #>> '{inventoryFields,0,after,desigitem}' from p25_v7_result),'D2',
  'receipt reports the committed designation');
select is((select result #>> '{inventoryFields,0,before,desigitem}' from p25_v7_result),'D1',
  'receipt freezes the original designation');
select is((select result #>> '{inventoryFields,0,stamps,evaldate}' from p25_v7_result) ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$',true,
  'receipt includes a server-generated Chicago date');
select is((select result #>> '{v7Scope,sourceMode}' from p25_v7_result),'drive','the V7 result identifies its validated source mode');
select is((select jsonb_array_length(result #> '{v7Scope,reportStamps}') from p25_v7_result),1,
  'server report stamps cover the selected row');
select is((select o.payload #>> '{reclassPayload,workflowPolicyVersion}' from public.ph_request_delivery_outbox o
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('p25-v7-edit-submit-token-0001','sha256'),'hex'),40)),
  'reclass-action-workflow-v7-editable-fields-20261009','the outbox stores the V7 policy');
select is((select o.payload #>> '{reclassPayload,protectedDelivery,v7FrozenRows,0,unique_id}' from public.ph_request_delivery_outbox o
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('p25-v7-edit-submit-token-0001','sha256'),'hex'),40)),
  'p25-v7-source','the protected delivery freezes the selected pre-edit row');
select is((select o.payload #>> '{reclassPayload,protectedDelivery,inventoryFields,0,after,suspend}' from public.ph_request_delivery_outbox o
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('p25-v7-edit-submit-token-0001','sha256'),'hex'),40)),
  'DC','the protected delivery records the server-derived SUS value');
select is((select count(*)::integer from public.ph_inventory_transactions t join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('p25-v7-edit-submit-token-0001','sha256'),'hex'),40)
    and t.status='requested' and t.event_type='inventory_change_request'),1,'V7 creates one requested audit row');
select is((select t.raw_payload #>> '{workflowPolicyVersion}' from public.ph_inventory_transactions t
  join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('p25-v7-edit-submit-token-0001','sha256'),'hex'),40)
    and t.status='requested' and t.event_type='inventory_change_request'),
  'reclass-action-workflow-v7-editable-fields-20261009','the requested audit stores the V7 policy');
select is((select t.raw_payload #>> '{protectedDelivery,inventoryFields,0,after,locationnote}' from public.ph_inventory_transactions t
  join public.ph_request_delivery_outbox o on o.event_id=t.delivery_event_id
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('p25-v7-edit-submit-token-0001','sha256'),'hex'),40)
    and t.status='requested' and t.event_type='inventory_change_request'),
  'New location note','the requested audit contains the committed field values');
select is((public.enqueue_drive_reclass_inquiry_v7((select payload from p25_v7_input))->>'duplicate'),'true',
  'an exact V7 retry returns the saved receipt without rereading changed live values');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v7((
  select payload||jsonb_build_object('transaction',(payload->'transaction')||jsonb_build_object('scope',jsonb_build_object('changed',true)))
  from p25_v7_input
))$$,'P0001','DRIVE_RECLASS_TOKEN_CONFLICT','a changed V7 request cannot reuse its token');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v7(
  jsonb_set(pg_temp.p25_v7_payload('p25-v7-stale-field-token-0001'),'{rowOverlays,0,fieldEdits,0,expected}',to_jsonb('stale'::text))
)$$,'40001','DRIVE_RECLASS_V7_FIELD_CONFLICT','a stale editable-field snapshot is rejected before enqueue');
select is((select count(*)::integer from public.ph_request_delivery_outbox
  where event_key='reclass-inquiry:'||left(encode(extensions.digest('p25-v7-stale-field-token-0001','sha256'),'hex'),40)),0,
  'a stale field conflict leaves no queued request');

-- Per-field shields use the presence header: absent fields stay protected,
-- present conflicts stay blocked, exact acknowledgments release individually.
select is((select count(*)::integer from app_sync_private.ph_master_inventory_item6_edits_v7
  where canonical_unique_id='p25-v7-source' and pending),9,'each submitted editable field starts with its own pending source acknowledgment');
select public.begin_dataset_import_v1(array['ph_master_inventory'],'d7000000-0000-4000-8000-000000000007',array['ph_master_inventory']);
select set_config('request.headers',jsonb_build_object(
  'x-gnc-import-run-id','d7000000-0000-4000-8000-000000000007',
  'x-gnc-master-tuple-policy','raw-priority-hold-v1',
  'x-gnc-master-item6-fields',to_jsonb(array['locationnote','salesnote'])::text)::text,true);
update public.ph_master_inventory set locationnote='Legacy conflicting note',locationptn1='Legacy omitted PTN',salesnote='New sales note'
where unique_id='p25-v7-source';
select is((select jsonb_build_array(locationnote,locationptn1,salesnote) from public.ph_master_inventory where unique_id='p25-v7-source'),
  '["New location note","New PTN","New sales note"]'::jsonb,
  'a raw conflict is blocked, an absent-header field stays protected, and an exact field acknowledgment is accepted');
select is((select array_agg(field_name order by field_name) from app_sync_private.ph_master_inventory_item6_edits_v7
  where canonical_unique_id='p25-v7-source' and pending),
  array['desigcust','desigitem','desigloc','locationnote','locationptn1','oversellpercentage','pullerresponsibility','suspend']::text[],
  'only the present exact field acknowledges; conflict and absent fields remain protected');
select public.finish_dataset_import_v1('d7000000-0000-4000-8000-000000000007');
select set_config('request.headers','{}',true);

-- A designation change alters the spreadsheet UID. Stable tuple resolution
-- retains the original row and supports a later exact acknowledgment.
update public.ph_master_inventory set desigitem='D3' where unique_id='p25-v7-source';
select public.begin_dataset_import_v1(array['ph_master_inventory'],'d7000000-0000-4000-8000-000000000008',array['ph_master_inventory']);
select set_config('request.headers',jsonb_build_object(
  'x-gnc-import-run-id','d7000000-0000-4000-8000-000000000008',
  'x-gnc-master-tuple-policy','raw-priority-hold-v1',
  'x-gnc-master-item6-fields',to_jsonb(array['desigitem'])::text)::text,true);
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei
) values ('p25-v7-alias','P25-V7','Synthetic V7 plant','#3','V.01.001','27.F1','10','9',
  '2','PH','F1','27','D1','C1','L1','10')
on conflict(unique_id) do update set desigitem=excluded.desigitem,desigcust=excluded.desigcust,desigloc=excluded.desigloc;
select is((select count(*)::integer from public.ph_master_inventory where itemcode='P25-V7'),1,
  'a keyer UID maps to its canonical row without creating a duplicate');
select is((select desigitem from public.ph_master_inventory where unique_id='p25-v7-source'),'D3',
  'a stale designation import cannot replace the app-edited designation');
select ok((select canonical_unique_id='p25-v7-source' from app_sync_private.ph_master_inventory_item6_aliases_v7
  where imported_unique_id='p25-v7-alias'),'the changed UID is persisted as a canonical alias');
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei
) values ('p25-v7-alias','P25-V7','Synthetic V7 plant','#3','V.01.001','27.F1','10','9',
  '2','PH','F1','27','D3','C2','L2','10')
on conflict(unique_id) do update set desigitem=excluded.desigitem,desigcust=excluded.desigcust,desigloc=excluded.desigloc;
select ok(not exists(select 1 from app_sync_private.ph_master_inventory_item6_edits_v7
  where canonical_unique_id='p25-v7-source' and field_name='desigitem' and pending),
  'the exact accepted designation clears only its field shield');

-- A second live row may share the fixed tuple while only one row has a
-- pending designation. Unknown imported UIDs must remain ambiguous anyway.
select throws_ok($$insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptronhand,ptravailable,
  priority,source,season,saleyear,desigitem,desigcust,desigloc,warehousei
) values ('p25-v7-ambiguous-import','P25-V7-AMBIG','Ambiguous imported row','#3','V.02.001','27.S1','10','9',
  '2','PH','F1','27','D1','C1','L1','10')$$,
  '40001','MASTER_ITEM6_LINEAGE_AMBIGUOUS','multiple live rows sharing the fixed tuple make a new designation UID ambiguous');
select public.finish_dataset_import_v1('d7000000-0000-4000-8000-000000000008');

-- Movement-only V7 submissions still carry server stamps while remaining
-- inquiry-only for quantity and field values.
create function pg_temp.p25_v7_move_payload(p_token text) returns jsonb language sql stable as $$
  select (pg_temp.p25_v7_payload(p_token)||jsonb_build_object(
    'transaction',jsonb_build_object('requestActions',jsonb_build_array('move_down'),
      'holdStopProposals','[]'::jsonb,'scope','{}'::jsonb),
    'rowOverlays',jsonb_build_array(jsonb_build_object(
      'unique_id',m.unique_id,'resolution','done',
      'expected',jsonb_build_object('itemcode',m.itemcode,'lotcode',m.lotcode,'locationcode',m.locationcode,
        'ptronhand',m.ptronhand,'desigitem',m.desigitem,'priority',m.priority,'holdstopcode',m.holdstopcode,
        'holdstopreason',m.holdstopreason),
      'proposals',jsonb_build_array(jsonb_build_object('action','move_down','splits',jsonb_build_array(
        jsonb_build_object('quantity',2,'destinationSeason','S1')),'applyHold',false,'holdReason',''))
    ))
  ) - 'sourceContext') from public.ph_master_inventory m where m.unique_id='p25-v7-source'
$$;
create temporary table p25_v7_move_result(result jsonb) on commit drop;
insert into p25_v7_move_result select public.enqueue_drive_reclass_inquiry_v7(
  pg_temp.p25_v7_move_payload('p25-v7-move-only-token-0001'));
select is((select ptronhand from public.ph_master_inventory where unique_id='p25-v7-source'),'10',
  'a V7 movement inquiry never mutates live on-hand quantity');
select is((select result->'inventoryFields' from p25_v7_move_result),'[]'::jsonb,
  'movement-only requests do not claim a live editable-field mutation');
select is((select jsonb_array_length(result #> '{v7Scope,reportStamps}') from p25_v7_move_result),1,
  'movement-only requests still freeze server-derived report stamps');

create temporary table p25_v7_recipient_result(result jsonb) on commit drop;
insert into p25_v7_recipient_result select public.enqueue_drive_reclass_inquiry_v7(
  pg_temp.p25_v7_move_payload('p25-v7-item-inquiry-token-0001') || jsonb_build_object(
    'sourceContext',jsonb_build_object('sourceMode','item-inquiry'),
    'recipientEmails',jsonb_build_array('p25-v7-active-csr@example.invalid')));
select is((select o.payload #> '{reclassPayload,recipientEmails}' from public.ph_request_delivery_outbox o
  where o.event_key='reclass-inquiry:'||left(encode(extensions.digest('p25-v7-item-inquiry-token-0001','sha256'),'hex'),40)),
  '["p25-v7-active-csr@example.invalid"]'::jsonb,
  'item-inquiry accepts an active CSR recipient despite password-change and temporary-lock flags');
select throws_ok($$select public.enqueue_drive_reclass_inquiry_v7(
  pg_temp.p25_v7_move_payload('p25-v7-disabled-recipient-token-0001') || jsonb_build_object(
    'sourceContext',jsonb_build_object('sourceMode','item-inquiry'),
    'recipientEmails',jsonb_build_array('p25-v7-disabled-csr@example.invalid'))
)$$,'42501','DRIVE_RECLASS_V7_RECIPIENTS_FORBIDDEN',
  'a disabled profile is not accepted from the item-inquiry recipient directory');

select * from finish();
rollback;
