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
 ('99000000-0000-0000-0000-000000000004','unassigned@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('99000000-0000-0000-0000-000000000001','dylan_collyge','Dylan','ADMIN',false),
 ('99000000-0000-0000-0000-000000000002','bn_card_one','Crew One','EVAL',false),
 ('99000000-0000-0000-0000-000000000003','bn_card_two','Crew Two','EVAL',false),
 ('99000000-0000-0000-0000-000000000004','bn_card_none','No Assigned Work','EVAL',false);
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,blockalpha,locationcode,lotcode,ptronhand,ptravailable,season,ptrreviewed)
 values('BN-CARD-A','CARD-I','Card Plant','#3','CARD','C.88.001','CARD-LOT-A','0',null,'27.Y','0'),
 ('BN-CARD-B','CARD-I','Card Plant','#5','CARD','C.88.001','CARD-LOT-B','12','0','27.F1','0'),
 ('BN-CARD-C','CARD-J','Setup Plant','#1','CARD','C.88.002','CARD-LOT-C','5','5','27.Y','0');

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
 command_id uuid; job_revision bigint; card_revision bigint; actual_id uuid; inventory_before jsonb; inventory_after jsonb;
begin
 select jsonb_agg(to_jsonb(m) order by unique_id) into inventory_before from public.ph_master_inventory m;
 select * into ta from bunch_note_private.options where kind='ta' order by label limit 1;
 perform pg_temp.bn_card_check(ta.id is not null,'TA action fixture exists');

 body:=jsonb_build_object('block','CARD','recipient_ids','[]'::jsonb,'locations',jsonb_build_array(
  jsonb_build_object('location','C.88.001','purposes','Separate nursery card work','instructions','Keep rows with their assigned crew',
   'row_ids',jsonb_build_array('BN-CARD-A','BN-CARD-B'),'cards',jsonb_build_array(
    jsonb_build_object('id',card_a,'kind','inventory','location_code','C.88.001','itemcode','CARD-I','commonname','Card Plant','contsize','#3','row_ids',jsonb_build_array('BN-CARD-A'),'owner_id',null,'house','North','direction','West to East'),
    jsonb_build_object('id',card_b,'kind','inventory','location_code','C.88.001','itemcode','CARD-I','commonname','Card Plant','contsize','#5','row_ids',jsonb_build_array('BN-CARD-B'),'owner_id',w2,'house','South','direction','East to West')),
   'actions',jsonb_build_array(
    jsonb_build_object('id','card-action-a','card_id',card_a,'option_id',ta.id,'group',ta.category,'kind',ta.kind,'label',ta.label,'instructions',ta.label,'scope','rows','row_ids',jsonb_build_array('BN-CARD-A'),'quantity','2'),
    jsonb_build_object('id','card-action-b','card_id',card_b,'option_id',ta.id,'group',ta.category,'kind',ta.kind,'label',ta.label,'instructions',ta.label,'scope','rows','row_ids',jsonb_build_array('BN-CARD-B'),'quantity','2'))),
  jsonb_build_object('location','C.88.002','purposes','Quick-edit setup only','instructions','No action list is required for a structured card',
   'row_ids',jsonb_build_array('BN-CARD-C'),'cards',jsonb_build_array(
    jsonb_build_object('id',setup_card,'kind','inventory','location_code','C.88.002','itemcode','CARD-J','commonname','Setup Plant','contsize','#1','row_ids',jsonb_build_array('BN-CARD-C'),'owner_id',null,'house','House A','direction','South to North')),'actions','[]'::jsonb)
  ));
 command_id:=gen_random_uuid();
 draft:=public.bunch_note_command_v1(d,'save',jsonb_build_object('body',body),command_id,null)->'draft';
 perform pg_temp.bn_card_check(draft->'body'->'locations'->0->>'format_version'='5','saving card locations enables format version five');
 perform pg_temp.bn_card_check(jsonb_array_length(draft->'body'->'locations'->0->'cards')=2,'draft retains two explicit inventory cards');
 perform pg_temp.bn_card_check(jsonb_array_length(draft->'body'->'locations'->1->'actions')=0,'quick-edit card with no actions remains a valid saved draft');
 perform pg_temp.bn_card_check((select count(*)=3 from bunch_note_private.bunch_note_work_cards wc join bunch_note_private.bunch_notes n on n.id=wc.bunch_note_id where n.batch_id=(draft->>'id')::uuid and wc.active),'draft cards mirror into protected work-card records');
 replay:=public.bunch_note_command_v1(d,'save',jsonb_build_object('body',body),command_id,null)->'draft';
 perform pg_temp.bn_card_check(replay=draft,'duplicate draft command replays exact card state');
 perform pg_temp.bn_legacy_reject(w1,'save',jsonb_build_object('body',body),null,gen_random_uuid(),'BUNCH_NOTE_AUTHOR_ONLY');

 preview:=public.bunch_note_command_v1(d,'preview',jsonb_build_object('batch_id',draft->'id'),gen_random_uuid(),1)->'preview';
 reports:=preview->'reports';
 perform public.bunch_note_freeze_pdfs_v1((preview->>'id')::uuid,(select jsonb_agg(jsonb_build_object('job_id',r->'job_id','filename','card.pdf','base64',encode(convert_to('%PDF-1.4'||repeat('c',200),'UTF8'),'base64')))
  from jsonb_array_elements(reports) r));
 perform public.bunch_note_command_v1(d,'publish',jsonb_build_object('preview_id',preview->'id'),gen_random_uuid(),1);
 select (r->>'job_id')::uuid into job_a from jsonb_array_elements(reports) r where r->>'location'='C.88.001';
 select (r->>'job_id')::uuid into job_setup from jsonb_array_elements(reports) r where r->>'location'='C.88.002';
 perform pg_temp.bn_card_check((select count(*)=2 from bunch_note_private.bunch_note_work_cards wc join bunch_note_private.bunch_notes n on n.id=wc.bunch_note_id where n.job_id=job_a and wc.active),'publish creates independent live card records');
 perform pg_temp.bn_card_check((select jsonb_array_length(j.body->'actions')=0 from bunch_note_private.jobs j where j.id=job_setup),'publishing header/card-only work needs no fabricated action');

 result:=pg_temp.bn_card_call(w1,'list');
 perform pg_temp.bn_card_check(exists(select 1 from jsonb_array_elements(result->'jobs') j where j->>'id'=job_a::text),'unassigned card is discoverable by eligible worker');
 perform pg_temp.bn_card_check((select jsonb_array_length(j->'cards')=1 and j->'cards'->0->>'id'=card_a::text and jsonb_array_length(j->'body'->'source')=1 and j->'body'->'source'->0->>'unique_id'='BN-CARD-A'
  from jsonb_array_elements(result->'jobs') j where j->>'id'=job_a::text),'worker list returns only the eligible card and its source row');
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
 perform pg_temp.bn_card_call(w2,'complete_card',jsonb_build_object('job_id',job_a,'card_id',card_b),card_revision,gen_random_uuid());
 perform pg_temp.bn_card_check((select status='complete' from bunch_note_private.jobs where id=job_a),'job completes only after every active card is complete');
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
 select jsonb_agg(to_jsonb(m) order by unique_id) into inventory_after from public.ph_master_inventory m;
 perform pg_temp.bn_card_check(inventory_after=inventory_before,'card assignment, actuals and completion never mutate source inventory');
end $$;

select plan(1);
select ok((select count(*)>=20 from bn_card_checks),'per-card Bunch Note authorization, isolation, revision and lifecycle assertions passed');
select * from finish();
rollback;
