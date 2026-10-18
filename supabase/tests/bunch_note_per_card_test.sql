-- @test-runtime: isolated-supabase
begin;
create temporary table bn_card_checks(description text);
create function pg_temp.bn_card_check(ok boolean, description text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Bunch Note cards: %',description; end if;
 insert into bn_card_checks values(description);
end $$;
create function pg_temp.bn_card_reject(actor_id uuid, operation_name text, payload jsonb, revision_value bigint, command_id uuid, expected text)
returns void language plpgsql as $$
begin
 begin
  perform public.bunch_note_card_command_v1(actor_id,operation_name,payload,command_id,revision_value);
  raise exception 'Expected %',expected;
 exception when others then
  if sqlerrm<>expected then raise; end if;
 end;
 perform pg_temp.bn_card_check(true,expected);
end $$;
create function pg_temp.bn_legacy_reject(actor_id uuid, operation_name text, payload jsonb, revision_value bigint, command_id uuid, expected text)
returns void language plpgsql as $$
begin
 begin
  perform public.bunch_note_command_v1(actor_id,operation_name,payload,command_id,revision_value);
  raise exception 'Expected %',expected;
 exception when others then
  if sqlerrm<>expected then raise; end if;
 end;
 perform pg_temp.bn_card_check(true,expected);
end $$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('99000000-0000-0000-0000-000000000001','dylan-card@example.invalid','{}','{}'),
 ('99000000-0000-0000-0000-000000000002','crew-one@example.invalid','{}','{}'),
 ('99000000-0000-0000-0000-000000000003','crew-two@example.invalid','{}','{}'),
 ('99000000-0000-0000-0000-000000000004','unassigned@example.invalid','{}','{}'),
 ('99000000-0000-0000-0000-000000000005','sharon-review@example.invalid','{}','{}'),
 ('99000000-0000-0000-0000-000000000006','outside-supervisor@example.invalid','{}','{}'),
 ('99000000-0000-0000-0000-000000000007','count-only@example.invalid','{}','{}'),
 ('99000000-0000-0000-0000-000000000008','sales-rep@example.invalid','{}','{}'),
 ('99000000-0000-0000-0000-000000000009','disabled-counter@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('99000000-0000-0000-0000-000000000001','dylan_collyge','Dylan','ADMIN',false),
 ('99000000-0000-0000-0000-000000000002','bn_card_one','Crew One','EVAL',false),
 ('99000000-0000-0000-0000-000000000003','bn_card_two','Crew Two','EVAL',false),
 ('99000000-0000-0000-0000-000000000004','bn_card_none','No Assigned Work','EVAL',false),
 ('99000000-0000-0000-0000-000000000005','sharon_combs','Sharon Review','EVAL',false),
 ('99000000-0000-0000-0000-000000000006','bn_outside_supervisor','Outside Supervisor','SUPERVISOR',false),
 ('99000000-0000-0000-0000-000000000007','bn_count_only','Count Only','EVAL',false),
 ('99000000-0000-0000-0000-000000000008','bn_sales_rep','Sales Rep','SALESREP',false),
 ('99000000-0000-0000-0000-000000000009','bn_disabled','Disabled Counter','EVAL',false);
update public.profiles set disabled_at=now() where id='99000000-0000-0000-0000-000000000009';
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,blockalpha,locationcode,lotcode,ptronhand,ptravailable,season,ptrreviewed)
 values('BN-CARD-A','CARD-I','Card Plant','#3','CARD','C.88.001','CARD-LOT-A','0',null,'27.Y','0'),
 ('BN-CARD-B','CARD-I','Card Plant','#5','CARD','C.88.001','CARD-LOT-B','12','0','27.F1','0'),
 ('BN-CARD-SIBLING','CARD-I','Card Plant','#4','CARD','C.88.001','CARD-LOT-SIBLING','8','8','27.Y','0'),
 ('BN-CARD-C','CARD-J','Setup Plant','#1','CARD','C.88.002','CARD-LOT-C','5','5','27.Y','0'),
 ('BN-CARD-WORKFLOW','CARD-W','Workflow Plant','#2','CARD','C.88.003','CARD-LOT-W','5','5','27.Y','0'),
 ('BN-CARD-WORKFLOW-OTHER','CARD-W-OTHER','Other Workflow Plant','#2','CARD','C.88.003','CARD-LOT-W-OTHER','7','7','27.Y','0');
insert into public.core_employees(id,profile_id,name,emp_number,department,role)
values('99100000-0000-4000-8000-000000000002','99000000-0000-0000-0000-000000000002','Crew One','BN-COUNT-ONE','Kiers & Counters','Counter'),
 ('99100000-0000-4000-8000-000000000003','99000000-0000-0000-0000-000000000003','Crew Two','BN-COUNT-TWO','Kiers & Counters','Counter'),
 ('99100000-0000-4000-8000-000000000007','99000000-0000-0000-0000-000000000007','Count Only','BN-COUNT-ONLY','Kiers & Counters','Counter');
insert into bunch_note_private.options(id,category,label,kind)
select 'bb000000-0000-4000-8000-000000000002','inventory','TA / culls follow-up','ta'
where not exists(select 1 from bunch_note_private.options where kind='ta');

create function pg_temp.bn_card_call(actor_id uuid, operation_name text, payload jsonb default '{}', revision_value bigint default null, command_id uuid default gen_random_uuid())
returns jsonb language sql as $$
 select public.bunch_note_card_command_v1(actor_id,operation_name,payload,command_id,revision_value)
$$;

do $$
declare
 d uuid:='99000000-0000-0000-0000-000000000001';
 w1 uuid:='99000000-0000-0000-0000-000000000002';
 w2 uuid:='99000000-0000-0000-0000-000000000003';
 other uuid:='99000000-0000-0000-0000-000000000004';
 card_a uuid:='aa000000-0000-4000-8000-000000000001';
 card_b uuid:='aa000000-0000-4000-8000-000000000002';
 setup_card uuid:='aa000000-0000-4000-8000-000000000003';
 ta bunch_note_private.options; body jsonb; draft jsonb; preview jsonb; reports jsonb; result jsonb; replay jsonb; job_a uuid; job_setup uuid;
 command_id uuid; completion_command uuid; completion_payload jsonb; completion_result jsonb; replay_result jsonb;
 job_revision bigint; card_revision bigint; actual_id uuid; inventory_before jsonb; inventory_after jsonb; snapshot_before jsonb;
 saved_action_id text; saved_action_snapshot jsonb;
 automatic_preview bunch_note_private.previews; automatic_event public.ph_request_delivery_outbox; route_entry jsonb; route_normalized jsonb;
 invalid_row_rejected boolean;
 perf_started timestamptz; perf_elapsed_ms numeric;
 manual_preview jsonb; publish_result jsonb; invalid_body jsonb; legacy_body jsonb; legacy_draft jsonb; perf_body jsonb; perf_draft jsonb; perf_replay jsonb; perf_revision jsonb; perf_batch uuid; perf_command uuid; perf_revision_command uuid;
begin
 select jsonb_agg(to_jsonb(m) order by unique_id) into inventory_before from public.ph_master_inventory m;
 select * into ta from bunch_note_private.options where kind='ta' order by label limit 1;
 perform pg_temp.bn_card_check(ta.id is not null,'TA action fixture exists');
 legacy_body:=jsonb_build_object('block','CARD','recipient_ids','[]'::jsonb,'locations',jsonb_build_array(
  jsonb_build_object('location','C.88.001','purposes','Legacy snapshot regression','instructions','Preserve sibling source snapshot',
   'row_ids',jsonb_build_array('BN-CARD-A'),'actions','[]'::jsonb)));
 legacy_draft:=public.bunch_note_command_v1(d,'save',jsonb_build_object('batch_id','bb000000-0000-4000-8000-000000000095','body',legacy_body),
  'bb000000-0000-4000-8000-000000000094',null)->'draft';
 perform pg_temp.bn_card_check(legacy_draft->'body'->'locations'->0->>'format_version'='4'
  and (legacy_draft->'body'->'locations'->0->'source') @> '[{"unique_id":"BN-CARD-SIBLING"}]'::jsonb,
  'legacy format-four save preserves same-itemcode sibling source snapshot');

 body:=jsonb_build_object('block','CARD','recipient_ids','[]'::jsonb,'locations',jsonb_build_array(
  jsonb_build_object('location','C.88.001','purposes','Separate nursery card work','instructions','Keep rows with their assigned crew',
   'row_ids',jsonb_build_array('BN-CARD-A','BN-CARD-B'),'cards',jsonb_build_array(
    jsonb_build_object('id',card_a,'kind','inventory','location_code','C.88.001','itemcode','CARD-I','commonname','Card Plant','contsize','#3','row_ids',jsonb_build_array('BN-CARD-A'),'owner_id',null,'house','North','direction','West to East','workflow_action','move','destination_location','C.88.003','notes','Stage in holding area'),
    jsonb_build_object('id',card_b,'kind','inventory','location_code','C.88.001','itemcode','CARD-I','commonname','Card Plant','contsize','#5','row_ids',jsonb_build_array('BN-CARD-B'),'owner_id',w2,'house','South','direction','East to West','workflow_action','bunch','destination_house','East & Center House','notes','Keep lots together')),
   'actions',jsonb_build_array(
    jsonb_build_object('id','card-action-a','card_id',card_a,'option_id',ta.id,'group',ta.category,'kind',ta.kind,'label',ta.label,'instructions',ta.label,'scope','rows','row_ids',jsonb_build_array('BN-CARD-A'),'quantity','2'),
    jsonb_build_object('id','card-action-b','card_id',card_b,'option_id',ta.id,'group',ta.category,'kind',ta.kind,'label',ta.label,'instructions',ta.label,'scope','rows','row_ids',jsonb_build_array('BN-CARD-B'),'quantity','2'))),
  jsonb_build_object('location','C.88.002','purposes','Quick-edit setup only','instructions','No action list is required for a structured card',
   'row_ids',jsonb_build_array('BN-CARD-C'),'cards',jsonb_build_array(
    jsonb_build_object('id',setup_card,'kind','inventory','location_code','C.88.002','itemcode','CARD-J','commonname','Setup Plant','contsize','#1','row_ids',jsonb_build_array('BN-CARD-C'),'owner_id',null,'house','House A','direction','South to North','workflow_action','ta','notes','TA staging only')),'actions','[]'::jsonb)
  ));
 command_id:=gen_random_uuid();
 draft:=public.bunch_note_command_v1(d,'save',jsonb_build_object('body',body),command_id,null)->'draft';
 perform pg_temp.bn_card_check(draft->'body'->'locations'->0->>'format_version'='5','saving card locations enables format version five');
 perform pg_temp.bn_card_check(jsonb_array_length(draft->'body'->'locations'->0->'cards')=2,'draft retains two explicit inventory cards');
 perform pg_temp.bn_card_check(jsonb_array_length(draft->'body'->'locations'->1->'actions')=0,'quick-edit card with no actions remains a valid saved draft');
 perform pg_temp.bn_card_check((draft->'body'->'locations'->0->'source_all') @> '[{"unique_id":"BN-CARD-SIBLING"}]'::jsonb,
  'format-five full source snapshot retains same-itemcode sibling rows');
 perform pg_temp.bn_card_check(not((draft->'body'->'locations'->0->'source') @> '[{"unique_id":"BN-CARD-SIBLING"}]'::jsonb),
  'format-five worker source remains limited to explicitly assigned card rows');
 invalid_body:=jsonb_set(body,'{locations,0,row_ids}','["BN-CARD-A","BN-CARD-DOES-NOT-EXIST"]'::jsonb);
 perform pg_temp.bn_legacy_reject(d,'save',jsonb_build_object('batch_id','bb000000-0000-4000-8000-000000000099','body',invalid_body),null,
  'bb000000-0000-4000-8000-000000000098','BUNCH_NOTE_SOURCE_CHANGED');
 perform pg_temp.bn_card_check(not exists(select 1 from bunch_note_private.batches where id='bb000000-0000-4000-8000-000000000099')
  and not exists(select 1 from bunch_note_private.commands where id='bb000000-0000-4000-8000-000000000098'),
  'invalid source membership rejects the whole save without persisting a batch or command receipt');
 route_entry:=jsonb_build_object('location','C.88.001','source',jsonb_build_array(jsonb_build_object('unique_id','BN-CARD-A','locationcode','C.88.001','itemcode','CARD-I','commonname','Card Plant','contsize','#3')),
  'cards',jsonb_build_array(jsonb_build_object('id',card_a,'kind','inventory','location_code','C.88.001','itemcode','CARD-I','commonname','Card Plant','contsize','#3','row_ids',jsonb_build_array('BN-CARD-A'))),'actions','[]'::jsonb);
 route_normalized:=bunch_note_private.normalize_work_cards(route_entry,null);
 perform pg_temp.bn_card_check(route_normalized->0->>'workflow_action'='','legacy format-five card without routing normalizes to an empty route');
 route_entry:=jsonb_set(route_entry,'{cards}',route_normalized);
 route_normalized:=bunch_note_private.normalize_work_cards(route_entry,null);
 perform pg_temp.bn_card_check(route_normalized->0->>'workflow_action'='','resaving normalized legacy empty routing remains valid without inventing a move');
 route_entry:=jsonb_build_object('location','C.88.001','source_all',jsonb_build_array(
   jsonb_build_object('unique_id','BN-NORM-A','locationcode','c.88.001','itemcode','card  i','commonname',' Plant  X ','contsize','# 3 '),
   jsonb_build_object('unique_id','BN-NORM-B','locationcode','C.88.001','itemcode','CARD I','commonname','plant x','contsize','# 3')),
  'cards',jsonb_build_array(jsonb_build_object('id',card_a,'kind','inventory','location_code','c.88.001','itemcode','CARD I','commonname','Plant X','contsize','# 3',
   'row_ids',jsonb_build_array('BN-NORM-B','BN-NORM-A'))),'actions','[]'::jsonb);
 route_normalized:=bunch_note_private.normalize_work_cards(route_entry,null);
 perform pg_temp.bn_card_check(route_normalized->0->'row_ids'='["BN-NORM-A","BN-NORM-B"]'::jsonb,
  'indexed group validation preserves case and whitespace normalization with the full matching sibling set');
 route_entry:=jsonb_set(route_entry,'{cards,0,row_ids}','["BN-NORM-A","BN-NORM-MISSING"]'::jsonb);
 invalid_row_rejected:=false;
 begin
  perform bunch_note_private.normalize_work_cards(route_entry,null);
 exception when others then if sqlerrm='BUNCH_NOTE_CARD_SOURCE_INVALID' then invalid_row_rejected:=true; else raise; end if; end;
 perform pg_temp.bn_card_check(invalid_row_rejected,'indexed source membership rejects a missing row id');
 route_entry:=jsonb_set(route_entry,'{source_all}',jsonb_build_array(jsonb_build_object('unique_id','123','locationcode','C.88.001','itemcode','CARD I','commonname','Plant X','contsize','# 3')));
 route_entry:=jsonb_set(route_entry,'{cards,0,row_ids}','[123]'::jsonb);
 invalid_row_rejected:=false;
 begin
  perform bunch_note_private.normalize_work_cards(route_entry,null);
 exception when others then if sqlerrm='BUNCH_NOTE_CARD_SOURCE_INVALID' then invalid_row_rejected:=true; else raise; end if; end;
 perform pg_temp.bn_card_check(invalid_row_rejected,'indexed membership retains string-only row ID validation');
 perform pg_temp.bn_card_check((select count(*)=3 from bunch_note_private.bunch_note_work_cards wc join bunch_note_private.bunch_notes n on n.id=wc.bunch_note_id where n.batch_id=(draft->>'id')::uuid and wc.active),'draft cards mirror into protected work-card records');
 replay:=public.bunch_note_command_v1(d,'save',jsonb_build_object('body',body),command_id,null)->'draft';
 perform pg_temp.bn_card_check(replay=draft,'duplicate draft command replays exact card state');
 perform pg_temp.bn_legacy_reject(w1,'save',jsonb_build_object('body',body),null,gen_random_uuid(),'BUNCH_NOTE_AUTHOR_ONLY');

 preview:=public.bunch_note_command_v1(d,'preview',jsonb_build_object('batch_id',draft->'id'),gen_random_uuid(),1)->'preview';
 reports:=preview->'reports';
 perform public.bunch_note_freeze_pdfs_v1((preview->>'id')::uuid,(select jsonb_agg(jsonb_build_object('job_id',r->'job_id','filename','card.pdf','base64',encode(convert_to('%PDF-1.4'||repeat('c',200),'UTF8'),'base64')))
  from jsonb_array_elements(reports) r));
 perform public.bunch_note_command_v1(d,'publish',jsonb_build_object('preview_id',preview->'id'),gen_random_uuid(),1);
 perform pg_temp.bn_card_check((select not exists(select 1 from bunch_note_private.jobs j cross join lateral jsonb_array_elements(j.body->'cards') as cards(card)
   where j.id in (select (r->>'job_id')::uuid from jsonb_array_elements(reports) r)
    and bunch_note_private.card_instruction_snapshot_map(j.body)->(cards.card->>'id') is distinct from bunch_note_private.card_instruction_snapshot(j.body,(cards.card->>'id')::uuid))),
  'set-based instruction snapshot map preserves per-card owner-excluded snapshot semantics');
 select (r->>'job_id')::uuid into job_a from jsonb_array_elements(reports) r where r->>'location'='C.88.001';
 select (r->>'job_id')::uuid into job_setup from jsonb_array_elements(reports) r where r->>'location'='C.88.002';
 perform pg_temp.bn_card_check((select count(*)=2 from bunch_note_private.bunch_note_work_cards wc join bunch_note_private.bunch_notes n on n.id=wc.bunch_note_id where n.job_id=job_a and wc.active),'publish creates independent live card records');
 perform pg_temp.bn_card_check((select jsonb_array_length(j.body->'actions')=0 from bunch_note_private.jobs j where j.id=job_setup),'publishing header/card-only work needs no fabricated action');
 delete from bunch_note_private.bunch_note_card_assignees where bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_a) and card_id=card_b;
 result:=pg_temp.bn_card_call(w2,'get',jsonb_build_object('job_id',job_a));
 perform pg_temp.bn_card_check(exists(select 1 from jsonb_array_elements(result->'job'->'cards') c where c->>'id'=card_b::text and c->>'owner_id'=w2::text and c->'owner_ids'=jsonb_build_array(w2)),
   'legacy primary owner remains authorized and projected when its relation row is absent');

 select revision into card_revision from bunch_note_private.bunch_note_work_cards where card_id=setup_card and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_setup);
 result:=pg_temp.bn_card_call(d,'assign_card',jsonb_build_object('job_id',job_setup,'card_id',setup_card,'owner_ids',jsonb_build_array(w1,w2)),card_revision,gen_random_uuid());
 perform pg_temp.bn_card_check(result->'job'->'cards'->0->'owner_ids'=jsonb_build_array(w1,w2) and result->'job'->'cards'->0->>'owner_id'=w1::text,'multi-assignment returns every assignee and keeps the first assignee as legacy owner');
 perform pg_temp.bn_card_check(result->'job'->'cards'->0->'owner_names'=jsonb_build_array('Crew One','Crew Two'),'assignment projection preserves readable names in owner order');
 select revision into card_revision from bunch_note_private.bunch_note_work_cards where card_id=setup_card and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_setup);
 perform pg_temp.bn_card_reject(d,'assign_card',jsonb_build_object('job_id',job_setup,'card_id',setup_card,'owner_ids','not-an-array'),card_revision,gen_random_uuid(),'BUNCH_NOTE_CARD_OWNER_INVALID');
 perform pg_temp.bn_card_check((select revision=card_revision and owner_id=w1 from bunch_note_private.bunch_note_work_cards where card_id=setup_card and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_setup)) and (select count(*)=2 from bunch_note_private.bunch_note_card_assignees where card_id=setup_card and user_id in (w1,w2)),
  'malformed owner_ids rejection is atomic and preserves prior assignments');
 update public.profiles set disabled_at=now() where id=other;
 select revision into card_revision from bunch_note_private.bunch_note_work_cards where card_id=setup_card and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_setup);
 perform pg_temp.bn_card_reject(d,'assign_card',jsonb_build_object('job_id',job_setup,'card_id',setup_card,'owner_ids',jsonb_build_array(w1,other)),card_revision,gen_random_uuid(),'BUNCH_NOTE_CARD_OWNER_INVALID');
 update public.profiles set disabled_at=null where id=other;
 perform pg_temp.bn_card_check((select revision=card_revision and owner_id=w1 from bunch_note_private.bunch_note_work_cards where card_id=setup_card and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_setup)) and (select count(*)=2 from bunch_note_private.bunch_note_card_assignees where card_id=setup_card and user_id in (w1,w2)),'inactive assignee rejection leaves revision and both prior assignments unchanged');
 result:=pg_temp.bn_card_call(w1,'get',jsonb_build_object('job_id',job_setup));
 perform pg_temp.bn_card_check(result->'job'->'cards'->0->>'workflow_action'='ta' and result->'job'->'cards'->0->>'notes'='TA staging only','published card exposes exact routing plan and notes before completion');
 select bunch_note_private.card_instruction_snapshot(j.body,setup_card) into snapshot_before from bunch_note_private.jobs j where j.id=job_setup;
 perform pg_temp.bn_card_check(snapshot_before is not distinct from (select bunch_note_private.card_instruction_snapshot(jsonb_set(jsonb_set(j.body,'{cards,0,owner_ids}','["99000000-0000-0000-0000-000000000002","99000000-0000-0000-0000-000000000003"]'::jsonb),'{cards,0,owner_names}','["Crew One","Crew Two"]'::jsonb),setup_card) from bunch_note_private.jobs j where j.id=job_setup),
   'assignment display metadata is excluded from instruction snapshot semantics');
 update bunch_note_private.jobs j set body=j.body||jsonb_build_object('worker_assignment_touch','preserve-relations') where j.id=job_setup;
 perform pg_temp.bn_card_check((select count(*)=2 and count(*) filter(where user_id in (w1,w2))=2 from bunch_note_private.bunch_note_card_assignees where card_id=setup_card),
   'job body mirror with unchanged legacy owner fields retains all relational assignments');
 result:=pg_temp.bn_card_call(w1,'get',jsonb_build_object('job_id',job_setup));
 perform pg_temp.bn_card_check(result->'job'->'cards'->0->'owner_ids'=jsonb_build_array(w1,w2),'first assigned worker can read multi-assignee card');
 result:=pg_temp.bn_card_call(w2,'get',jsonb_build_object('job_id',job_setup));
 perform pg_temp.bn_card_check(result->'job'->'cards'->0->'owner_ids'=jsonb_build_array(w1,w2),'secondary assigned worker can read multi-assignee card');
 perform pg_temp.bn_card_reject(other,'get',jsonb_build_object('job_id',job_setup),null,gen_random_uuid(),'BUNCH_NOTE_NOT_FOUND');
 select revision into card_revision from bunch_note_private.bunch_note_work_cards where card_id=setup_card and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_setup);
 command_id:=gen_random_uuid();
 result:=pg_temp.bn_card_call(w1,'release_card',jsonb_build_object('job_id',job_setup,'card_id',setup_card),card_revision,command_id);
 replay:=pg_temp.bn_card_call(w1,'release_card',jsonb_build_object('job_id',job_setup,'card_id',setup_card),card_revision,command_id);
 perform pg_temp.bn_card_check(result=replay and result->>'released'='true' and result->>'card_id'=setup_card::text and not(result ? 'job'),'release of own assignment commits/replays minimal acknowledgement when another assignee retains the card');
 perform pg_temp.bn_card_check((select owner_id=w2 from bunch_note_private.bunch_note_work_cards where card_id=setup_card and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_setup)) and not exists(select 1 from bunch_note_private.bunch_note_card_assignees where card_id=setup_card and user_id=w1) and exists(select 1 from bunch_note_private.bunch_note_card_assignees where card_id=setup_card and user_id=w2),'release removes only the acting assignee and keeps remaining owner compatibility');
 command_id:=gen_random_uuid();
 result:=pg_temp.bn_card_call(w2,'release_card',jsonb_build_object('job_id',job_setup,'card_id',setup_card),(select revision from bunch_note_private.bunch_note_work_cards where card_id=setup_card and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_setup)),command_id);
 replay:=pg_temp.bn_card_call(w2,'release_card',jsonb_build_object('job_id',job_setup,'card_id',setup_card),(select revision from bunch_note_private.bunch_note_work_cards where card_id=setup_card and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_setup))-1,command_id);
 perform pg_temp.bn_card_check(result=replay and result->'job'->'cards'->0->>'owner_id' is null,'last assigned worker release replays accessible unassigned card state');
 perform pg_temp.bn_card_check((select owner_id is null from bunch_note_private.bunch_note_work_cards where card_id=setup_card and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_setup)),'last assigned worker can release card back to claimable state');
 result:=pg_temp.bn_card_call(w1,'claim_card',jsonb_build_object('job_id',job_setup,'card_id',setup_card),(select revision from bunch_note_private.bunch_note_work_cards where card_id=setup_card and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_setup)),gen_random_uuid());
 perform pg_temp.bn_card_check(result->'job'->'cards'->0->>'owner_id'=w1::text,'released card can be claimed by an eligible worker');
 result:=pg_temp.bn_card_call(w1,'list');
 perform pg_temp.bn_card_check(exists(select 1 from jsonb_array_elements(result->'jobs') j where j->>'id'=job_a::text),'unassigned card is discoverable by eligible worker');
 perform pg_temp.bn_card_check((select jsonb_array_length(j->'cards')=1 and j->'cards'->0->>'id'=card_a::text and jsonb_array_length(j->'body'->'source')=1 and j->'body'->'source'->0->>'unique_id'='BN-CARD-A'
  from jsonb_array_elements(result->'jobs') j where j->>'id'=job_a::text),'worker list returns only the eligible card and its source row');
 perform pg_temp.bn_card_check((select j->'cards'->0->>'workflow_action'='move' and j->'cards'->0->>'destination_location'='C.88.003' and j->'cards'->0->>'notes'='Stage in holding area' from jsonb_array_elements(result->'jobs') j where j->>'id'=job_a::text),'published move plan retains exact destination and notes in worker-safe card detail');
 result:=pg_temp.bn_card_call(w1,'get',jsonb_build_object('job_id',job_a));
 perform pg_temp.bn_card_check(jsonb_array_length(result->'job'->'cards')=1 and result->'job'->'cards'->0->>'id'=card_a::text,'unassigned card can be safely reviewed before claim');
 result:=pg_temp.bn_card_call(other,'get',jsonb_build_object('job_id',job_a));
 perform pg_temp.bn_card_check(jsonb_array_length(result->'job'->'cards')=1 and result->'job'->'cards'->0->>'id'=card_a::text
  and jsonb_array_length(result->'job'->'body'->'source')=1 and result->'job'->'body'->'source'->0->>'unique_id'='BN-CARD-A'
  and jsonb_array_length(result->'job'->'body'->'actions')=1 and result->'job'->'body'->'actions'->0->>'id'='card-action-a',
  'another eligible worker can review only the unassigned card before claim');
 perform pg_temp.bn_card_reject(w1,'claim_card',jsonb_build_object('job_id',job_a,'card_id',card_b),1,gen_random_uuid(),'BUNCH_NOTE_ALREADY_CLAIMED');

 command_id:=gen_random_uuid();
 result:=pg_temp.bn_card_call(w1,'claim_card',jsonb_build_object('job_id',job_a,'card_id',card_a),1,command_id);
 replay:=pg_temp.bn_card_call(w1,'claim_card',jsonb_build_object('job_id',job_a,'card_id',card_a),1,command_id);
 perform pg_temp.bn_card_check(result=replay and (select revision=2 and owner_id=w1 from bunch_note_private.bunch_note_work_cards where bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_a) and card_id=card_a),'claim retry is idempotent and increments only the selected card revision');
 perform pg_temp.bn_card_reject(w1,'add_action',jsonb_build_object('job_id',job_a,'card_id',card_a,'action',jsonb_build_object(
  'id','cross-card-action','card_id',card_a,'option_id',ta.id,'group',ta.category,'kind',ta.kind,'label',ta.label,
  'instructions',ta.label,'scope','rows','row_ids',jsonb_build_array('BN-CARD-B'))),2,gen_random_uuid(),'BUNCH_NOTE_ACTION_CARD_ROWS_INVALID');
 perform pg_temp.bn_card_check(not exists(select 1 from bunch_note_private.worker_actions where job_id=job_a and action->>'id'='cross-card-action'),
  'rejected cross-card row scope does not persist a worker action');
 perform pg_temp.bn_card_reject(other,'get',jsonb_build_object('job_id',job_a),null,gen_random_uuid(),'BUNCH_NOTE_NOT_FOUND');
 perform pg_temp.bn_card_reject(w1,'progress',jsonb_build_object('job_id',job_a,'card_id',card_a,'action_id','card-action-a','status','done'),1,gen_random_uuid(),'BUNCH_NOTE_REVISION_CONFLICT');
 perform pg_temp.bn_card_reject(w1,'progress',jsonb_build_object('job_id',job_a,'card_id',card_a,'action_id','card-action-b','status','done'),2,gen_random_uuid(),'BUNCH_NOTE_ACTION_CARD_INVALID');
 perform pg_temp.bn_card_reject(w1,'actual',jsonb_build_object('job_id',job_a,'card_id',card_a,'action_id','card-action-a','source_id','BN-CARD-B','quantity','1'),2,gen_random_uuid(),'BUNCH_NOTE_CARD_SOURCE_INVALID');

 result:=pg_temp.bn_card_call(w1,'get',jsonb_build_object('job_id',job_a));
 perform pg_temp.bn_card_check(jsonb_array_length(result->'job'->'cards')=1 and result->'job'->'cards'->0->>'id'=card_a::text
  and jsonb_array_length(result->'job'->'body'->'source')=1 and result->'job'->'body'->'source'->0->>'unique_id'='BN-CARD-A'
  and not(result->'job'->'body'->'source' @> '[{"unique_id":"BN-CARD-B"}]'::jsonb),'card read projection excludes sibling definition and inventory row');
 result:=pg_temp.bn_card_call(w1,'actual',jsonb_build_object('job_id',job_a,'card_id',card_a,'action_id','card-action-a','source_id','BN-CARD-A','quantity','2','explanation','Verified physical count'),2,gen_random_uuid());
 select revision into card_revision from bunch_note_private.bunch_note_work_cards where card_id=card_a and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_a);
 select revision into job_revision from bunch_note_private.jobs where id=job_a;
 perform pg_temp.bn_card_check(card_revision=3 and (select count(*)=1 from bunch_note_private.actuals where job_id=job_a and action_id='card-action-a'),'recorded actual is scoped to the assigned card and durable');
 select id into actual_id from bunch_note_private.actuals where job_id=job_a and action_id='card-action-a';
 select a.action_id,a.action_snapshot into saved_action_id,saved_action_snapshot from bunch_note_private.actuals a where a.id=actual_id;
 perform set_config('bunch_note.card_command','on',true);
 update bunch_note_private.actuals a set action_id='orphaned-card-action',action_snapshot='{"scope":"rows","row_ids":[]}'::jsonb where a.id=actual_id;
 result:=pg_temp.bn_card_call(w1,'get',jsonb_build_object('job_id',job_a));
 perform pg_temp.bn_card_check(jsonb_array_length(result->'job'->'actuals')=0,
   'empty row-scope actual without card/action linkage is not exposed to an assigned worker');
 update bunch_note_private.actuals a set action_id=saved_action_id,action_snapshot=saved_action_snapshot where a.id=actual_id;
 perform set_config('bunch_note.card_command','off',true);
 perform pg_temp.bn_card_reject(w1,'actual',jsonb_build_object('job_id',job_a,'card_id',card_b,'action_id','card-action-b','source_id','BN-CARD-B','quantity','1'),1,gen_random_uuid(),'BUNCH_NOTE_OWNER_ONLY');
 result:=pg_temp.bn_card_call(w1,'get',jsonb_build_object('job_id',job_a));
 perform pg_temp.bn_card_check(jsonb_array_length(result->'job'->'actuals')=1 and result->'job'->'actuals'->0->>'action_id'='card-action-a','history projection excludes other workers actuals');
 perform pg_temp.bn_card_call(w1,'progress',jsonb_build_object('job_id',job_a,'card_id',card_a,'action_id','card-action-a','status','done','reason','Verified physical count'),3,gen_random_uuid());
 select revision into card_revision from bunch_note_private.bunch_note_work_cards where card_id=card_a and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_a);
 perform pg_temp.bn_card_call(w1,'complete_card',jsonb_build_object('job_id',job_a,'card_id',card_a),card_revision,gen_random_uuid());
 perform pg_temp.bn_card_check((select status='complete' and revision=5 from bunch_note_private.bunch_note_work_cards where card_id=card_a and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_a)),'completion is card-scoped and preserves actual ledger');
 perform pg_temp.bn_card_check((select status='open' from bunch_note_private.jobs where id=job_a),'job remains open while a sibling card remains unfinished');
 perform pg_temp.bn_card_reject(w1,'actual',jsonb_build_object('job_id',job_a,'card_id',card_a,'action_id','card-action-a','source_id','BN-CARD-A','quantity','1','explanation','Late worker edit'),5,gen_random_uuid(),'BUNCH_NOTE_CARD_COMPLETE');

 perform pg_temp.bn_card_call(d,'actual',jsonb_build_object('job_id',job_a,'card_id',card_a,'action_id','card-action-a','source_id','BN-CARD-A','replaces_id',actual_id,'quantity','2','explanation','Supervisor reviewed open location'),5,gen_random_uuid());
 perform pg_temp.bn_card_check((select status='open' from bunch_note_private.bunch_note_work_cards where card_id=card_a and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_a)),
  'correction reopens the completed card while its parent location remains open');
 perform pg_temp.bn_card_reject(w1,'complete_card',jsonb_build_object('job_id',job_a,'card_id',card_a),6,gen_random_uuid(),'BUNCH_NOTE_UNRESOLVED_ACTIONS');
 perform pg_temp.bn_card_call(w1,'progress',jsonb_build_object('job_id',job_a,'card_id',card_a,'action_id','card-action-a','status','done','reason','Verified correction'),6,gen_random_uuid());
 perform pg_temp.bn_card_call(w1,'complete_card',jsonb_build_object('job_id',job_a,'card_id',card_a),7,gen_random_uuid());
 select a.id into actual_id from bunch_note_private.actuals a where a.job_id=job_a and a.action_id='card-action-a'
  and not exists(select 1 from bunch_note_private.actuals newer where newer.replaces_id=a.id);

 perform pg_temp.bn_card_call(w2,'actual',jsonb_build_object('job_id',job_a,'card_id',card_b,'action_id','card-action-b','source_id','BN-CARD-B','quantity','2','explanation','Verified physical count'),1,gen_random_uuid());
 perform pg_temp.bn_card_call(w2,'progress',jsonb_build_object('job_id',job_a,'card_id',card_b,'action_id','card-action-b','status','done','reason','Verified physical count'),2,gen_random_uuid());
 select revision into card_revision from bunch_note_private.bunch_note_work_cards where card_id=card_b and bunch_note_id=(select id from bunch_note_private.bunch_notes where job_id=job_a);
 completion_payload:=jsonb_build_object('job_id',job_a,'card_id',card_b);
 completion_command:=gen_random_uuid();
 completion_result:=public.bunch_note_card_command_v1(w2,'complete_card',completion_payload,completion_command,card_revision);
 perform pg_temp.bn_card_check((select status='complete' from bunch_note_private.jobs where id=job_a),'job completes only after every active card is complete');
 select * into automatic_preview from bunch_note_private.previews where job_id=job_a and report_kind='completed_work' and published;
 select * into automatic_event from public.ph_request_delivery_outbox where event_id=automatic_preview.event_id;
 perform pg_temp.bn_card_check(automatic_preview.id is not null and automatic_preview.pdfs is null
  and automatic_preview.job_revision=(select revision from bunch_note_private.jobs where id=job_a)
  and automatic_preview.recipients @> '[{"username":"dylan_collyge"}]'::jsonb,
  'last card completion freezes one report revision and saved recipients including mandatory Dylan');
 perform pg_temp.bn_card_check(automatic_event.event_type='bunch_note_submission' and automatic_event.status='pending'
  and automatic_event.event_key='bunch-note-auto-completion:'||job_a::text||':'||automatic_preview.job_revision::text
  and automatic_event.payload->>'automatic_completion'='true',
  'last card completion atomically queues the deterministic automatic delivery event');
 perform pg_temp.bn_card_check(jsonb_array_length(automatic_preview.reports)=1
  and automatic_preview.reports->0->>'report_kind'='completed_work'
  and jsonb_array_length(automatic_preview.reports->0->'source')=2
  and jsonb_array_length(automatic_preview.reports->0->'actuals')=3,
  'automatic report freezes all source rows and recorded work from the completion transaction');
 replay_result:=public.bunch_note_card_command_v1(w2,'complete_card',completion_payload,completion_command,card_revision);
 perform pg_temp.bn_card_check(replay_result=completion_result
  and (select count(*)=1 from bunch_note_private.previews where job_id=job_a and report_kind='completed_work' and published)
  and (select count(*)=1 from public.ph_request_delivery_outbox where event_key=automatic_event.event_key),
  'completion command retry returns its original result without duplicating the report or email');
 perform public.bunch_note_freeze_pdfs_v1(automatic_preview.id,jsonb_build_array(jsonb_build_object(
  'job_id',job_a,'filename','automatic-work.pdf','base64',encode(convert_to('%PDF-1.4'||repeat('a',200),'UTF8'),'base64'))));
 perform pg_temp.bn_card_check((select pdfs->0->>'filename'='automatic-work.pdf' from bunch_note_private.previews where id=automatic_preview.id),
  'service delivery can freeze a PDF onto the published automatic report');
 select revision into job_revision from bunch_note_private.jobs where id=job_a;
 manual_preview:=public.bunch_note_command_v1(d,'work_preview',jsonb_build_object('job_id',job_a,'recipient_ids',jsonb_build_array(w1)),gen_random_uuid(),job_revision)->'preview';
 perform public.bunch_note_freeze_pdfs_v1((manual_preview->>'id')::uuid,jsonb_build_array(jsonb_build_object(
  'job_id',job_a,'filename','manual-work.pdf','base64',encode(convert_to('%PDF-1.4'||repeat('m',200),'UTF8'),'base64'))));
 publish_result:=public.bunch_note_command_v1(d,'work_publish',jsonb_build_object('preview_id',manual_preview->'id','send_email',true),gen_random_uuid(),job_revision);
 perform pg_temp.bn_card_check(publish_result->>'already_published'='true'
  and publish_result->>'preview_id'=automatic_preview.id::text and publish_result->>'event_id'=automatic_event.event_id::text
  and (select count(*)=1 from public.ph_request_delivery_outbox where event_key=automatic_event.event_key),
  'manual author publish safely reuses the automatic event at the same revision');
 perform pg_temp.bn_card_call(d,'actual',jsonb_build_object('job_id',job_a,'card_id',card_a,'action_id','card-action-a','source_id','BN-CARD-A','replaces_id',actual_id,'quantity','2','explanation','Supervisor verified correction'),8,gen_random_uuid());
 perform pg_temp.bn_card_check((select count(*)=4 and exists(select 1 from bunch_note_private.actuals original where original.id=actual_id)
  and exists(select 1 from bunch_note_private.actuals correction where correction.job_id=job_a and correction.replaces_id=actual_id)
  from bunch_note_private.actuals where job_id=job_a),'author correction appends a linked record and preserves the superseded actual');
 result:=pg_temp.bn_card_call(w1,'get',jsonb_build_object('job_id',job_a));
 perform pg_temp.bn_card_check(jsonb_array_length(result->'job'->'actuals')=3 and result->'job'->'actuals' @> jsonb_build_array(jsonb_build_object('id',actual_id)),
  'completed card owner retains original and corrected actual history');
  perform pg_temp.bn_card_reject(other,'get',jsonb_build_object('job_id',job_a),null,gen_random_uuid(),'BUNCH_NOTE_NOT_FOUND');

 select revision into job_revision from bunch_note_private.jobs where id=job_a;
 begin
  perform public.bunch_note_command_v1(d,'progress',jsonb_build_object('job_id',job_a,'action_id','card-action-a','status','not_needed','reason','legacy bypass probe'),gen_random_uuid(),job_revision);
  raise exception 'Expected direct legacy card-job mutation to be blocked';
 exception when others then
  if sqlerrm not in ('BUNCH_NOTE_CARD_COMMAND_REQUIRED','BUNCH_NOTE_CARD_ID_REQUIRED','BUNCH_NOTE_REVISION_CONFLICT') then raise; end if;
 end;
 perform pg_temp.bn_card_check(true,'legacy whole-job mutation cannot bypass card commands');
 perform pg_temp.bn_card_check((public.bunch_note_command_v1(d,'get',jsonb_build_object('job_id',job_a))->'job'->'progress' ? 'card-action-a'),'author retains complete job and progress history');
 perform pg_temp.bn_card_check(not has_table_privilege('authenticated','bunch_note_private.bunch_note_work_cards','select')
  and not has_table_privilege('authenticated','bunch_note_private.bunch_note_lines','select'),'browser cannot query protected card or line tables');
 perform pg_temp.bn_card_check(not has_function_privilege('authenticated','public.bunch_note_card_command_v1(uuid,text,jsonb,uuid,bigint)','execute'),'browser cannot impersonate actors via card RPC');

 select revision into job_revision from bunch_note_private.jobs where id=job_setup;
 result:=pg_temp.bn_card_call(d,'cancel',jsonb_build_object('job_id',job_setup,'reason','Staging setup cancelled'),job_revision,gen_random_uuid());
 perform pg_temp.bn_card_check((select status='cancelled' and jsonb_array_length(result->'job'->'cards')=1
  from bunch_note_private.jobs where id=job_setup),'Dylan cancellation preserves retired card history');
 perform pg_temp.bn_card_check((select count(*)=1 and bool_and(not active and status='retired') from bunch_note_private.bunch_note_work_cards wc
  join bunch_note_private.bunch_notes n on n.id=wc.bunch_note_id where n.job_id=job_setup),'cancel retires every card from worker availability');
 perform pg_temp.bn_card_reject(w1,'get',jsonb_build_object('job_id',job_setup),null,gen_random_uuid(),'BUNCH_NOTE_NOT_FOUND');
 perform pg_temp.bn_card_check(exists(select 1 from jsonb_array_elements((pg_temp.bn_card_call(d,'list')->'jobs')) j where j->>'id'=job_setup::text and j->>'status'='cancelled'),
  'author list retains cancelled card work for history');

 update public.profiles set disabled_at=now() where id=w1;
 begin
  perform pg_temp.bn_card_call(w1,'get',jsonb_build_object('job_id',job_a));
  raise exception 'Expected inactive card worker to be denied';
 exception when others then
  if sqlerrm not in ('BUNCH_NOTE_ACTOR_INACTIVE','BUNCH_NOTE_NOT_FOUND') then raise; end if;
 end;
 update public.profiles set disabled_at=null where id=w1;
 insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,blockalpha,locationcode,lotcode,ptronhand,ptravailable,season,ptrreviewed)
 select 'BN-SAVE100-'||lpad(i::text,3,'0'),'SAVE100-'||lpad(i::text,3,'0'),'Save Performance Plant','#1','CARD','C.88.100',
  'SAVE100-LOT-'||i,'1','1','27.Y','0' from generate_series(1,100) i;
 select jsonb_build_object('block','CARD','recipient_ids','[]'::jsonb,'locations',jsonb_build_array(
  jsonb_build_object('location','C.88.100','purposes','100-card idempotency regression','instructions','Preserve every selected source and route',
   'row_ids',(select jsonb_agg('BN-SAVE100-'||lpad(i::text,3,'0') order by i) from generate_series(1,100) i),
   'cards',(select jsonb_agg(jsonb_build_object('id',md5('bn-save100-card-'||i)::uuid,'kind','inventory','location_code','C.88.100',
    'itemcode','SAVE100-'||lpad(i::text,3,'0'),'commonname','Save Performance Plant','contsize','#1',
    'row_ids',jsonb_build_array('BN-SAVE100-'||lpad(i::text,3,'0')),'owner_id',w1,'owner_ids',jsonb_build_array(w1,w2),
    'workflow_action','move','destination_location','C.88.001','notes','Save 100 regression card') order by i)
    from generate_series(1,100) i),'actions','[]'::jsonb))) into perf_body;
 perf_batch:='bb000000-0000-4000-8000-000000000099'; perf_command:='bb000000-0000-4000-8000-000000000097';
 perf_draft:=public.bunch_note_command_v1(d,'save',jsonb_build_object('batch_id',perf_batch,'body',perf_body),perf_command,1)->'draft';
 perf_replay:=public.bunch_note_command_v1(d,'save',jsonb_build_object('batch_id',perf_batch,'body',perf_body),perf_command,1)->'draft';
 perform pg_temp.bn_card_check(perf_replay=perf_draft and jsonb_array_length(perf_draft->'body'->'locations'->0->'cards')=100
  and (select count(*)=100 from bunch_note_private.bunch_note_work_cards wc join bunch_note_private.bunch_notes n on n.id=wc.bunch_note_id where n.batch_id=perf_batch and wc.active)
  and (select count(*)=200 from bunch_note_private.bunch_note_card_assignees ca join bunch_note_private.bunch_notes n on n.id=ca.bunch_note_id where n.batch_id=perf_batch),
  '100-card save and identical command replay retain all selected rows and both assignees');
 perf_body:=jsonb_set(perf_body,'{locations,0,cards,0,notes}','"Revised 100 regression card"'::jsonb);
 perf_revision_command:='bb000000-0000-4000-8000-000000000096';
 perf_started:=clock_timestamp();
 perf_revision:=public.bunch_note_command_v1(d,'save',jsonb_build_object('batch_id',perf_batch,'body',perf_body),perf_revision_command,1)->'draft';
 perf_elapsed_ms:=extract(epoch from clock_timestamp()-perf_started)*1000;
 raise notice 'BUNCH_V221_100_CARD_REVISION_MS=%',round(perf_elapsed_ms,3);
 perform pg_temp.bn_card_check(perf_elapsed_ms<=300,format('100-card revision save completed in %s ms (approved <=300 ms)',round(perf_elapsed_ms,3)));
 perform pg_temp.bn_card_check((perf_revision->>'revision')::integer=2
  and perf_revision->'body'->'locations'->0->'cards'->0->>'notes'='Revised 100 regression card'
  and (select count(*)=100 from bunch_note_private.bunch_note_work_cards wc join bunch_note_private.bunch_notes n on n.id=wc.bunch_note_id where n.batch_id=perf_batch and wc.active)
  and (select count(*)=200 from bunch_note_private.bunch_note_card_assignees ca join bunch_note_private.bunch_notes n on n.id=ca.bunch_note_id where n.batch_id=perf_batch),
  '100-card revision preserves stable card IDs and all assignment relations');
 delete from public.ph_master_inventory where unique_id like 'BN-SAVE100-%';
 select jsonb_agg(to_jsonb(m) order by unique_id) into inventory_after from public.ph_master_inventory m;
 perform pg_temp.bn_card_check(inventory_after=inventory_before,'card assignment, actuals and completion never mutate source inventory');
end $$;

do $$
declare
 d uuid:='99000000-0000-0000-0000-000000000001';
 w1 uuid:='99000000-0000-0000-0000-000000000002';
 w2 uuid:='99000000-0000-0000-0000-000000000003';
 other uuid:='99000000-0000-0000-0000-000000000004';
 counter_only uuid:='99000000-0000-0000-0000-000000000007';
 sales_rep uuid:='99000000-0000-0000-0000-000000000008';
 disabled_counter uuid:='99000000-0000-0000-0000-000000000009';
 sharon uuid:='99000000-0000-0000-0000-000000000005';
 outside_supervisor uuid:='99000000-0000-0000-0000-000000000006';
 target_card_id uuid:='aa000000-0000-4000-8000-000000000004';
 other_card_id uuid:='aa000000-0000-4000-8000-000000000005';
 body jsonb; draft jsonb; preview jsonb; result jsonb; replay jsonb; review bunch_note_private.count_reviews; delivery jsonb; ta bunch_note_private.options;
 target_batch_id uuid; target_job_id uuid; target_note_id uuid; card_revision bigint; review_revision bigint;
 complete_command uuid:='bb000000-0000-4000-8000-000000000201';
 actuals jsonb:='{"BN-CARD-WORKFLOW":3}'::jsonb;
 rejected boolean:=false;
 review_active_before bigint;
 prior_job_updated_at timestamptz;
 prior_job_revision bigint;
begin
 select * into ta from bunch_note_private.options where kind='ta' order by label limit 1;
 body:=jsonb_build_object('block','CARD','recipient_ids','[]'::jsonb,'locations',jsonb_build_array(
  jsonb_build_object('location','C.88.003','purposes','Count variance workflow','instructions','Record the completed movement quantity',
   'row_ids',jsonb_build_array('BN-CARD-WORKFLOW','BN-CARD-WORKFLOW-OTHER'),'cards',jsonb_build_array(
    jsonb_build_object('id',target_card_id,'kind','inventory','location_code','C.88.003','itemcode','CARD-W','commonname','Workflow Plant','contsize','#2',
     'row_ids',jsonb_build_array('BN-CARD-WORKFLOW'),'owner_id',w1,'owner_ids',jsonb_build_array(w1,w2),
      'workflow_action','move','destination_location','C.88.004','notes','Move and reconcile'),
     jsonb_build_object('id',other_card_id,'kind','inventory','location_code','C.88.003','itemcode','CARD-W-OTHER','commonname','Other Workflow Plant','contsize','#2',
      'row_ids',jsonb_build_array('BN-CARD-WORKFLOW-OTHER'),'owner_id',w2,'owner_ids',jsonb_build_array(w2),
       'workflow_action','ta','notes','Other assigned card'),
      jsonb_build_object('id','aa000000-0000-4000-8000-000000000006'::uuid,'kind','shared','location_code','C.88.003',
       'row_ids','[]'::jsonb,'owner_id',w1)),
    'actions',jsonb_build_array(
     jsonb_build_object('id','workflow-legacy-action','card_id',target_card_id,'option_id',ta.id,
      'group',ta.category,'kind',ta.kind,'label',ta.label,'instructions',ta.label,'scope','rows',
      'row_ids',jsonb_build_array('BN-CARD-WORKFLOW'),'quantity','1'),
     jsonb_build_object('id','other-legacy-action','card_id',other_card_id,'option_id',ta.id,
      'group',ta.category,'kind',ta.kind,'label',ta.label,'instructions',ta.label,'scope','rows',
      'row_ids',jsonb_build_array('BN-CARD-WORKFLOW-OTHER'),'quantity','1')))));
 draft:=public.bunch_note_command_v1(d,'save',jsonb_build_object('body',body),gen_random_uuid(),null)->'draft';
 target_batch_id:=(draft->>'id')::uuid;
 preview:=public.bunch_note_command_v1(d,'preview',jsonb_build_object('batch_id',target_batch_id),gen_random_uuid(),1)->'preview';
 select jsonb_agg(jsonb_build_object('job_id',report->'job_id','filename','instruction.pdf',
   'base64',encode(convert_to('%PDF-1.4'||repeat('i',200),'UTF8'),'base64')))
  into result from jsonb_array_elements(preview->'reports') report;
 perform public.bunch_note_freeze_pdfs_v1((preview->>'id')::uuid,result);
 perform public.bunch_note_command_v1(d,'publish',jsonb_build_object('preview_id',preview->'id'),gen_random_uuid(),1);
 -- Historical rows can contain a shared task that current format-five save validation will not create.
 -- Inject it only in this transaction while suppressing the sync triggers, then restore them immediately.
 alter table bunch_note_private.jobs disable trigger user;
 update bunch_note_private.jobs j set body=jsonb_set(j.body,'{actions}',coalesce(j.body->'actions','[]'::jsonb)||jsonb_build_array(
  jsonb_build_object('id','unscoped-legacy-action','group','sequence','kind','instruction','label','Shared irrigation check',
   'instructions','Coordinate with irrigation','scope','location','row_ids','[]'::jsonb,'quantity','1')))
  where j.id=(select n.job_id from bunch_note_private.bunch_notes n where n.batch_id=target_batch_id and n.location_code='C.88.003');
 alter table bunch_note_private.jobs enable trigger user;
 select j.id,n.id,wc.revision into target_job_id,target_note_id,card_revision
  from bunch_note_private.jobs j join bunch_note_private.bunch_notes n on n.job_id=j.id
  join bunch_note_private.bunch_note_work_cards wc on wc.bunch_note_id=n.id
  where n.batch_id=target_batch_id and wc.card_id=target_card_id;
 delete from bunch_note_private.bunch_note_card_assignees where bunch_note_id=target_note_id and card_id=target_card_id and user_id=w1;
 perform pg_temp.bn_card_check(target_job_id is not null and target_note_id is not null and card_revision=1,
  'publish materializes an assigned work card with its initial card revision');

 result:=public.bunch_note_workflow_command_v1(w1,'queue',jsonb_build_object('filter','mine','limit',100,'offset',0));
 perform pg_temp.bn_card_check((result->>'total')::integer>=1
   and exists(select 1 from jsonb_array_elements(result->'cards') c where c->>'card_id'=target_card_id::text
    and c->>'stablecard_id'=target_job_id::text||':'||target_card_id::text
    and c->>'status'='open' and c->>'can_complete'='true' and c->'assignees' @> jsonb_build_array(jsonb_build_object('id',w2))
    and c->'assignees' @> jsonb_build_array(jsonb_build_object('id',w1))),
   'assigned worker queue returns relational assignees and the legacy owner, plus a completion capability');
 result:=public.bunch_note_workflow_command_v1(sharon,'queue',jsonb_build_object('filter','mine','limit',100,'offset',0));
 perform pg_temp.bn_card_check(not exists(select 1 from jsonb_array_elements(result->'cards') c where c->>'card_id'=target_card_id::text)
   and exists(select 1 from jsonb_array_elements(public.bunch_note_workflow_command_v1(sharon,'queue',jsonb_build_object('filter','all','limit',100,'offset',0))->'cards') c where c->>'card_id'=target_card_id::text),
   'reviewers see all authorized cards in all filter while mine remains assigned-only');
 perform pg_temp.bn_card_check((select jsonb_array_length((public.bunch_note_workflow_command_v1(other,'queue',
   jsonb_build_object('filter','mine','limit',100,'offset',0))->'cards'))=0),
   'unassigned worker cannot discover assigned card or source inventory');
 perform pg_temp.bn_card_check((select jsonb_array_length((public.bunch_note_workflow_command_v1(outside_supervisor,'queue',
   jsonb_build_object('filter','all','limit',100,'offset',0))->'cards'))=0),
   'supervisors outside Kiers & Counters do not receive global Bunch review visibility');
 rejected:=false;
 begin
  perform public.bunch_note_workflow_command_v1(other,'complete_card',jsonb_build_object('job_id',target_job_id,'card_id',target_card_id,
    'actual_qty_by_row',actuals),gen_random_uuid(),card_revision);
  raise exception 'Expected unassigned worker card completion to be denied';
 exception when others then
  if sqlerrm='BUNCH_NOTE_OWNER_ONLY' then rejected:=true; else raise; end if;
 end;
 perform pg_temp.bn_card_check(rejected and not exists(select 1 from bunch_note_private.card_completions c where c.card_id=target_card_id),
  'unassigned worker cannot complete another user card');

  rejected:=false;
  begin
   perform public.bunch_note_workflow_command_v1(w1,'complete_card',jsonb_build_object('job_id',target_job_id,
    'card_id','aa000000-0000-4000-8000-000000000006','actual_qty_by_row','{}'::jsonb),gen_random_uuid(),1);
   raise exception 'Expected a shared card completion attempt to be rejected';
  exception when others then
   if sqlerrm='BUNCH_NOTE_CARD_NOT_INVENTORY' then rejected:=true; else raise; end if;
  end;
  perform pg_temp.bn_card_check(rejected and not exists(select 1 from bunch_note_private.card_completions c
    where c.job_id=target_job_id and c.card_id='aa000000-0000-4000-8000-000000000006'),
   'shared briefing cards cannot be submitted as inventory quantities');

 rejected:=false;
 begin
  perform public.bunch_note_workflow_command_v1(w1,'complete_card',jsonb_build_object('job_id',target_job_id,'card_id',target_card_id,
    'actual_qty_by_row','{}'::jsonb),gen_random_uuid(),card_revision);
  raise exception 'Expected incomplete source quantities to be rejected';
 exception when others then
  if sqlerrm='BUNCH_NOTE_ACTUAL_ROWS_INVALID' then rejected:=true; else raise; end if;
 end;
 perform pg_temp.bn_card_check(rejected and not exists(select 1 from bunch_note_private.card_completions c where c.card_id=target_card_id),
  'completion requires an exact quantity for every underlying inventory row and remains atomic');

 perform set_config('bunch_note.card_command','off',true);
 perform set_config('bunch_note.workflow_card_completion','off',true);
 result:=public.bunch_note_workflow_command_v1(w1,'complete_card',jsonb_build_object('job_id',target_job_id,'card_id',target_card_id,
   'actual_qty_by_row',actuals),complete_command,card_revision);
 replay:=public.bunch_note_workflow_command_v1(w1,'complete_card',jsonb_build_object('job_id',target_job_id,'card_id',target_card_id,
   'actual_qty_by_row',actuals),complete_command,card_revision);
 perform pg_temp.bn_card_check(result=replay and result->'completion'->>'variance'='-2'
  and result->'discrepancy'->>'routed_to'='sharon_combs' and result->>'delivery_queued'='true',
  'card completion compares actual quantity with live PTRAVAILABLE, routes the variance, and replays idempotently');
 perform pg_temp.bn_card_check(current_setting('bunch_note.card_command',true)='off'
  and current_setting('bunch_note.workflow_card_completion',true)='off',
  'successful workflow completion restores transaction-local trigger guards before a subsequent RPC');
  perform pg_temp.bn_card_check((select wc.status='complete' and wc.revision=2 from bunch_note_private.bunch_note_work_cards wc where wc.bunch_note_id=target_note_id and wc.card_id=target_card_id)
   and (select j.status='open' and j.progress='{}'::jsonb from bunch_note_private.jobs j where j.id=target_job_id)
  and (select count(*)=1 from bunch_note_private.previews p where p.job_id=target_job_id and p.report_kind='completed_work' and p.published)
  and (select count(*)=1 from public.ph_request_delivery_outbox e where e.event_key='bunch-note-card-completion:'||target_job_id::text||':'||target_card_id::text||':2'),
   'actual-count completion works with an unresolved legacy action while preserving job progress and avoiding duplicate delivery');
 result:=public.bunch_note_workflow_command_v1(w2,'complete_card',jsonb_build_object('job_id',target_job_id,'card_id',other_card_id,
   'actual_qty_by_row','{"BN-CARD-WORKFLOW-OTHER":7}'::jsonb),gen_random_uuid(),1);
 perform pg_temp.bn_card_check(result->'job'->>'status'='open'
  and (select progress='{}'::jsonb and status='open' from bunch_note_private.jobs where id=target_job_id)
  and exists(select 1 from bunch_note_private.card_actions((select j.* from bunch_note_private.jobs j where j.id=target_job_id)) a
    where a->>'id'='unscoped-legacy-action' and nullif(a->>'card_id','') is null),
  'the final inventory card preserves progress and leaves unrelated unscoped work open');

 select r.* into review from bunch_note_private.count_reviews r where r.job_id=target_job_id and r.card_id=target_card_id;
 result:=public.bunch_note_workflow_command_v1(sharon,'list_discrepancies',jsonb_build_object('limit',100,'offset',0));
  perform pg_temp.bn_card_check(result->>'can_review'='true'
   and result->'counters'->0->>'username'='sharon_combs'
   and result->'counters'->1->>'username'='dylan_collyge'
   and result->'counters' @> jsonb_build_array(jsonb_build_object('id',w2))
   and result->'counters' @> jsonb_build_array(jsonb_build_object('id',w1))
   and not(result->'counters' @> jsonb_build_array(jsonb_build_object('id',sales_rep)))
   and not(result->'counters' @> jsonb_build_array(jsonb_build_object('id',disabled_counter)))
  and result->'reviews' @> jsonb_build_array(jsonb_build_object('id',review.id,'variance',-2,'actual_qty',3,'ptravailable',5)),
  'counter choices place Sharon and Dylan first, then include active non-sales-rep profiles only');
 result:=public.bunch_note_workflow_command_v1(sharon,'queue',jsonb_build_object('filter','mine','limit',100,'offset',0));
 review_active_before:=(result->>'active_count')::bigint;
 result:=public.bunch_note_workflow_command_v1(sharon,'queue',jsonb_build_object('filter','completed','limit',100,'offset',0));
 perform pg_temp.bn_card_check((result->>'active_count')::bigint=review_active_before and review_active_before>=1,
  'completed filter retains the authorized active-work badge count');
 update bunch_note_private.jobs set updated_at='2000-01-01 00:00:00+00' where id=target_job_id;
 select updated_at,revision into prior_job_updated_at,prior_job_revision from bunch_note_private.jobs where id=target_job_id;
  result:=public.bunch_note_workflow_command_v1(sharon,'assign_counter',jsonb_build_object('review_id',review.id,'counter_username','  FIELD.TAG_1  '),
   gen_random_uuid(),review.revision);
  review_revision:=(result->'review'->>'revision')::bigint;
  perform pg_temp.bn_card_check(result->'review'->>'assigned_counter_id' is null
   and result->'review'->>'assigned_counter_username'='field.tag_1'
   and (select assigned_counter_id is null and assigned_counter_username='field.tag_1' from bunch_note_private.count_reviews where id=review.id),
   'unknown valid username becomes a normalized custom tag without granting account access');
  rejected:=false;
  begin
   perform public.bunch_note_workflow_command_v1(other,'complete_recount',jsonb_build_object('review_id',review.id,
    'recount_qty_by_row','{"BN-CARD-WORKFLOW":4}'::jsonb),gen_random_uuid(),review_revision);
   raise exception 'Expected custom tag to confer no access';
  exception when others then
   if sqlerrm='BUNCH_NOTE_REVIEW_FORBIDDEN' then rejected:=true; else raise; end if;
  end;
  perform pg_temp.bn_card_check(rejected,'custom username tag does not grant completion permission to any profile');
  rejected:=false;
  begin
   perform public.bunch_note_workflow_command_v1(sharon,'assign_counter',jsonb_build_object('review_id',review.id,'counter_username','bn_sales_rep'),
    gen_random_uuid(),review_revision);
   raise exception 'Expected sales rep assignment to be rejected';
  exception when others then
   if sqlerrm='BUNCH_NOTE_COUNTER_INVALID' then rejected:=true; else raise; end if;
  end;
  perform pg_temp.bn_card_check(rejected,'known sales-rep username is rejected instead of downgraded to a custom tag');
  rejected:=false;
  begin
   perform public.bunch_note_workflow_command_v1(sharon,'assign_counter',jsonb_build_object('review_id',review.id,'counter_username','bn_disabled'),
    gen_random_uuid(),review_revision);
   raise exception 'Expected inactive username assignment to be rejected';
  exception when others then
   if sqlerrm='BUNCH_NOTE_COUNTER_INVALID' then rejected:=true; else raise; end if;
  end;
  perform pg_temp.bn_card_check(rejected,'known disabled username is rejected instead of downgraded to a custom tag');
  result:=public.bunch_note_workflow_command_v1(sharon,'assign_counter',jsonb_build_object('review_id',review.id,'counter_id',counter_only),
   gen_random_uuid(),review_revision);
 review_revision:=(result->'review'->>'revision')::bigint;
  perform pg_temp.bn_card_check(result->'review'->>'assigned_counter_id'=counter_only::text
   and result->'review'->>'assigned_counter_username'='bn_count_only' and result->'review'->>'status'='assigned',
   'authorized reviewer assigns a profile-backed active non-sales-rep counter with canonical username');
 result:=public.bunch_note_workflow_command_v1(counter_only,'queue',jsonb_build_object('filter','mine','limit',100,'offset',0));
 perform pg_temp.bn_card_check((result->>'total')::integer=0 and (result->>'review_count')::integer=1
  and result->>'can_review'='false'
  and (select (public.bunch_note_workflow_command_v1(counter_only,'list_discrepancies',jsonb_build_object('limit',100,'offset',0))->>'total')::integer=1),
  'a counter assigned to recount without an original job sees its review count and assigned discrepancy only');
 perform pg_temp.bn_card_check((select updated_at>prior_job_updated_at and revision=prior_job_revision from bunch_note_private.jobs where id=target_job_id),
  'recount assignment emits a watched Bunch job update without changing its business revision');
 result:=public.bunch_note_workflow_command_v1(counter_only,'complete_recount',jsonb_build_object('review_id',review.id,
  'recount_qty_by_row','{"BN-CARD-WORKFLOW":4}'::jsonb),gen_random_uuid(),review_revision);
 perform pg_temp.bn_card_check(result->'review'->>'status'='resolved' and result->'review'->>'recount_qty'='4'
  and (select recount_qty_by_row->>'BN-CARD-WORKFLOW'='4' from bunch_note_private.count_reviews where id=review.id),
  'assigned count worker resolves the discrepancy using exact per-row recount quantities');
 result:=public.bunch_note_workflow_command_v1(w2,'list_discrepancies',jsonb_build_object('limit',100,'offset',0));
 perform pg_temp.bn_card_check(not(result->'reviews' @> jsonb_build_array(jsonb_build_object('id',review.id))),
  'resolved recounts leave the active review queue');

 select p.id into target_note_id from bunch_note_private.previews p
  where p.job_id=target_job_id and p.report_kind='completed_work' and p.published
   and p.reports->0->'cards'->0->>'id'=target_card_id::text;
 delivery:=public.bunch_note_delivery_lookup_v1((select e.event_id from public.ph_request_delivery_outbox e
   where e.payload->>'preview_id'=target_note_id::text));
 perform pg_temp.bn_card_check(delivery->>'preview_id'=target_note_id::text and delivery->'pdfs'='null'::jsonb
  and delivery->'reports'->0->>'report_kind'='completed_work'
  and delivery->'recipients' @> jsonb_build_array(jsonb_build_object('username','bn_card_two'))
  and delivery->'recipients' @> jsonb_build_array(jsonb_build_object('username','sharon_combs'))
  and jsonb_array_length(delivery->'reports'->0->'actions')=1
  and delivery->'reports'->0->'actions'->0->>'card_id'=target_card_id::text
  and jsonb_array_length(delivery->'reports'->0->'source')=1
  and delivery->'reports'->0->'source'->0->>'unique_id'='BN-CARD-WORKFLOW'
  and delivery->'reports'->0->'completion'->'actual_qty_by_row'=actuals
  and delivery->'reports'->0->'cards'->0->>'workflow_instructions' like '%Completed By: bn_card_one (Crew One)%'
  and delivery->'reports'->0->'cards'->0->>'workflow_instructions' like '%Actual Qty reported: 3%'
  and delivery->'reports'->0->'cards'->0->>'workflow_instructions' like '%Drive Mode PTRAVAILABLE: 5%'
  and delivery->'reports'->0->'cards'->0->>'workflow_instructions' like '%Count discrepancy: -2 (needs recount review)%',
  'automatic per-card completion delivery includes assignee recipients and complete execution summary for worker-side PDF freezing');
 perform public.bunch_note_freeze_pdfs_v1(target_note_id,jsonb_build_array(jsonb_build_object('job_id',target_job_id,'filename','completed-work.pdf',
  'base64',encode(convert_to('%PDF-1.4'||repeat('w',200),'UTF8'),'base64'))));
 perform pg_temp.bn_card_check((select p.pdfs->0->>'filename'='completed-work.pdf' from bunch_note_private.previews p where p.id=target_note_id),
  'authorized delivery worker freezes the completed-work PDF bytes before sending');
end $$;

select plan(1);
select diag(format('BUNCH_CARD_INTERNAL_CHECKS=%s',(select count(*) from bn_card_checks)));
select ok((select count(*)>=20 from bn_card_checks),format('per-card Bunch Note authorization, isolation, revision and lifecycle assertions passed (%s checks)',(select count(*) from bn_card_checks)));
select * from finish();
rollback;
