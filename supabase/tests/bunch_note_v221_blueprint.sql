-- @test-runtime: isolated-supabase
select plan(1);
begin;
create temporary table bn_v221_checks(description text);
create function pg_temp.bn_v221_check(ok boolean, description text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Bunch Note v2.2.1: %',description; end if;
 insert into bn_v221_checks values(description);
end $$;
create function pg_temp.bn_v221_reject(actor_id uuid, operation_name text, payload jsonb, revision_value bigint,
 command_id uuid, expected text) returns void language plpgsql as $$
begin
 begin
  perform public.bunch_note_command_v1(actor_id,operation_name,payload,command_id,revision_value);
  raise exception 'Expected %',expected;
 exception when others then
  if sqlerrm<>expected then raise; end if;
 end;
 perform pg_temp.bn_v221_check(true,expected);
end $$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('88000000-0000-4000-8000-000000000001','dylan-v221@example.invalid','{}','{}'),
 ('88000000-0000-4000-8000-000000000002','megan-v221@example.invalid','{}','{}'),
 ('88000000-0000-4000-8000-000000000003','sharon-v221@example.invalid','{}','{}'),
 ('88000000-0000-4000-8000-000000000004','worker-v221@example.invalid','{}','{}'),
 ('88000000-0000-4000-8000-000000000005','header-owner-v221@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('88000000-0000-4000-8000-000000000001','dylan_collyge','Dylan','ADMIN',false),
 ('88000000-0000-4000-8000-000000000002','megan_kelly','Megan Kelly','ADMIN',false),
 ('88000000-0000-4000-8000-000000000003','sharon_combs','Sharon Combs','EVAL',false),
 ('88000000-0000-4000-8000-000000000004','bn_v221_worker','Worker','EVAL',false),
 ('88000000-0000-4000-8000-000000000005','bn_v221_header_owner','Header Owner','EVAL',false);
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,blockalpha,locationcode,lotcode,ptronhand,ptravailable,season,ptrreviewed)
 values('BN-V221-SNAPSHOT-1','V221-ITEM','Peony','#3','V221','C.88.001','V221-LOT-1','8','6','27.Y','0');

do $$
declare normalized jsonb; recipients jsonb; option_row bunch_note_private.options; action_value jsonb; source_value jsonb;
begin
 perform bunch_note_private.require_ready(jsonb_build_object(
  'format_version',5,'work_type','D.05. Whole-location Bunch Notes','purpose_thread','Early Winter Protect',
  'row_ids','[]'::jsonb,'actions','[]'::jsonb,'cards',jsonb_build_array(
   jsonb_build_object('id','header-divider','kind','divider','text','--- WALKWAY ---'))));
 perform pg_temp.bn_v221_check(true,'header-only note is ready with divider rows but no inventory cards or legacy actions');

 normalized:=bunch_note_private.normalize_work_cards(jsonb_build_object(
  'location','C.88.001',
  'source_all',jsonb_build_array(jsonb_build_object('unique_id','V221-ROW-1','locationcode','C.88.001','itemcode','PEONY-1','commonname','Peony','contsize','#3')),
  'cards',jsonb_build_array(
   jsonb_build_object('id','ditch-divider','kind','divider','text','-------- DITCH --------','left_margin','STOP'),
   jsonb_build_object('id','88000000-0000-4000-8000-000000000010','kind','inventory','location_code','C.88.001',
    'itemcode','PEONY-1','commonname','Peony','contsize','#3','row_ids',jsonb_build_array('V221-ROW-1'),
    'owner_ids',jsonb_build_array('88000000-0000-4000-8000-000000000004'),'workflow_action','compound',
    'workflow_instructions','TA worst 2 and haul remaining plants','destination_location','G.15.000',
    'destination_qualifier','South House','left_margin','QC','notes','Leave aisle clear')),
  'actions','[]'::jsonb),null);
 perform pg_temp.bn_v221_check(jsonb_array_length(normalized)=2 and normalized->0->>'kind'='divider'
  and normalized->1->>'destination_location'='G.15.000' and normalized->1->>'destination_qualifier'='South House'
  and normalized->1->>'workflow_instructions'='TA worst 2 and haul remaining plants'
  and normalized->1->>'notes'='Leave aisle clear' and normalized->1->>'left_margin'='QC'
  and normalized->1->'owner_ids' @> jsonb_build_array('88000000-0000-4000-8000-000000000004'),
  'divider order and canonical route, qualifier, instructions, notes, margin, and assigned worker are preserved');

 recipients:=bunch_note_private.recipients_for_reports('[]'::jsonb,jsonb_build_array(
  jsonb_build_object('cards',normalized)));
 perform pg_temp.bn_v221_check(recipients @> jsonb_build_array(
  jsonb_build_object('profile_id','88000000-0000-4000-8000-000000000001','email','dylan-v221@example.invalid'),
  jsonb_build_object('profile_id','88000000-0000-4000-8000-000000000002','email','megan-v221@example.invalid'),
  jsonb_build_object('profile_id','88000000-0000-4000-8000-000000000003','email','sharon-v221@example.invalid'),
  jsonb_build_object('profile_id','88000000-0000-4000-8000-000000000004','email','worker-v221@example.invalid')),
  'preview resolves default group and saved worker assignments on the server');
 recipients:=bunch_note_private.recipients_for_reports('[]'::jsonb,jsonb_build_array(
  jsonb_build_object('owner_id','88000000-0000-4000-8000-000000000005','cards','[]'::jsonb)));
 perform pg_temp.bn_v221_check(recipients @> jsonb_build_array(
  jsonb_build_object('profile_id','88000000-0000-4000-8000-000000000005','email','header-owner-v221@example.invalid')),
  'legacy header owner is included for whole-location reports without inventory cards');
 select * into option_row from bunch_note_private.options where active and kind in ('instruction','ta','move','hauling') order by id limit 1;
 perform pg_temp.bn_v221_check(option_row.id is not null,'an active catalogue action fixture exists');
 source_value:=jsonb_build_array(jsonb_build_object('unique_id','V221-ROW-X','locationcode','C.88.001','itemcode','X'));
 update bunch_note_private.options set active=false where id=option_row.id;
 action_value:=bunch_note_private.validate_action(jsonb_build_object('id','retained-action','option_id',option_row.id,
  'group',option_row.category,'kind',option_row.kind,'label',option_row.label,'instructions',option_row.label,
  'scope','rows','row_ids',jsonb_build_array('V221-ROW-X')),source_value,jsonb_build_array(
   jsonb_build_object('id','retained-action','option_id',option_row.id,'group',option_row.category,'kind',option_row.kind,
    'label',option_row.label,'instructions',option_row.label,'scope','rows','row_ids',jsonb_build_array('V221-ROW-X'))));
 perform pg_temp.bn_v221_check(action_value->>'option_id'=option_row.id::text,
  'a previously saved action uses its immutable snapshot when its catalogue option is retired');
 action_value:=bunch_note_private.validate_action(jsonb_build_object('id','new-stale-action','option_id',option_row.id,
  'group',option_row.category,'kind',option_row.kind,'label',option_row.label,'instructions',option_row.label,
  'scope','rows','row_ids',jsonb_build_array('V221-ROW-X')),source_value,'[]'::jsonb);
 perform pg_temp.bn_v221_check(not(action_value ? 'option_id') and action_value->>'label'=option_row.label,
  'new stale catalogue selections retain copied text but drop the retired option identity');
 update bunch_note_private.options set active=true where id=option_row.id;
end $$;

-- Exercise the public command's actual saved/frozen preview path, including
-- a header-only location and ordered divider + assigned inventory rows.
do $$
declare
 d uuid:='88000000-0000-4000-8000-000000000001';
 worker uuid:='88000000-0000-4000-8000-000000000004';
  saved jsonb; preview_result jsonb; draft_batch_id uuid; report jsonb; location_report jsonb; result jsonb; replay jsonb;
 preview_id uuid; publish_command uuid:=gen_random_uuid();
 invalid_divider_action boolean:=false;
 recipient_started timestamptz; recipient_elapsed_ms numeric; resolved_recipients jsonb;
begin
 saved:=public.bunch_note_command_v1(d,'save',jsonb_build_object('body',jsonb_build_object(
  'block','V221','recipient_ids','[]'::jsonb,'locations',jsonb_build_array(
   jsonb_build_object('location','C.88.001','format_version',5,'work_type','C.88.001 Bunch Notes',
    'title','V221 walking list','purpose_thread','Spring move sequence','direction','South to North',
    'default_house_plan','North House','schedule_banner','Start after irrigation shuts off','rule_chips',jsonb_build_array('Keep the east lane clear'),
    'row_ids',jsonb_build_array('BN-V221-SNAPSHOT-1'),'cards',jsonb_build_array(
     jsonb_build_object('id','divider-ditch','kind','divider','text','--- DITCH ---','left_margin','STOP'),
     jsonb_build_object('id','88000000-0000-4000-8000-000000000020','kind','inventory','location_code','C.88.001',
      'itemcode','V221-ITEM','commonname','Peony','contsize','#3','row_ids',jsonb_build_array('BN-V221-SNAPSHOT-1'),
      'owner_ids',jsonb_build_array(worker),'workflow_action','compound','destination_location','G.15.000',
      'destination_qualifier','North side','workflow_instructions','Move first two to staging; bunch remainder',
      'left_margin','QC','notes','Protect the buds')),'actions','[]'::jsonb),
   jsonb_build_object('location','C.88.002','format_version',5,'work_type','D.05. Bunch Notes',
    'purpose_thread','Header-only daily route','direction','West to East','schedule_banner','Wait for dry ground',
    'default_house_plan','South House','row_ids','[]'::jsonb,
    'cards',jsonb_build_array(jsonb_build_object('id','header-divider','kind','divider','text','--- WALKWAY ---')),'actions','[]'::jsonb)
  ))),gen_random_uuid(),null);
 draft_batch_id:=(saved->'draft'->>'id')::uuid;
 perform pg_temp.bn_v221_check(draft_batch_id is not null and
  saved->'draft'->'body'->'locations'->1->>'format_version'='5',
  'v5 save accepts a meaningful header-only location');
 perform pg_temp.bn_v221_reject(d,'save',jsonb_build_object('batch_id',draft_batch_id,'body',saved->'draft'->'body'),0,
  gen_random_uuid(),'BUNCH_NOTE_REVISION_CONFLICT');
 perform pg_temp.bn_v221_reject(d,'save',jsonb_build_object('body',jsonb_build_object('block','V221','recipient_ids','[]'::jsonb,
  'locations',jsonb_build_array(jsonb_build_object('location','C.88.001','format_version',5,'work_type','Bad source',
   'row_ids',jsonb_build_array('BN-V221-MISSING-ROW'),'cards','[]'::jsonb,'actions','[]'::jsonb)))),null,
  gen_random_uuid(),'BUNCH_NOTE_SOURCE_CHANGED');
 begin
  perform bunch_note_private.normalize_work_cards(jsonb_build_object('location','C.88.001',
   'source_all',jsonb_build_array(jsonb_build_object('unique_id','BN-V221-SNAPSHOT-1','locationcode','C.88.001')),
   'cards',jsonb_build_array(jsonb_build_object('id','divider-only','kind','divider','text','Divider only')),
   'actions',jsonb_build_array(jsonb_build_object('id','bad-action','card_id','divider-only','scope','location','instructions','Invalid'))),null);
 exception when others then
  if sqlerrm<>'BUNCH_NOTE_ACTION_CARD_REQUIRED' then raise; end if;
  invalid_divider_action:=true;
 end;
 perform pg_temp.bn_v221_check(invalid_divider_action,'actions cannot bind to a divider row');
 preview_result:=public.bunch_note_command_v1(d,'preview',jsonb_build_object('batch_id',draft_batch_id),gen_random_uuid(),1)->'preview';
 preview_id:=(preview_result->>'id')::uuid;
 report:=preview_result->'reports'->0;
 location_report:=preview_result->'reports'->1;
 recipient_started:=clock_timestamp();
 resolved_recipients:=bunch_note_private.recipients_for_reports('[]'::jsonb,preview_result->'reports');
 recipient_elapsed_ms:=extract(epoch from clock_timestamp()-recipient_started)*1000;
 raise notice 'BUNCH_V221_FROZEN_RECIPIENT_RESOLUTION_MS=%',round(recipient_elapsed_ms,3);
 perform pg_temp.bn_v221_check(recipient_elapsed_ms<100,
  format('frozen-report recipient resolution %s ms is below the 100 ms interactive limit',round(recipient_elapsed_ms,3)));
 perform pg_temp.bn_v221_check(jsonb_array_length(preview_result->'reports')=2 and
  report->>'work_type'='C.88.001 Bunch Notes' and report->>'purpose_thread'='Spring move sequence' and
  report->>'direction'='South to North' and report->>'default_house_plan'='North House' and
  report->>'schedule_banner'='Start after irrigation shuts off' and
  report->'rule_chips' @> '["Keep the east lane clear"]'::jsonb,
  'public save and preview preserve rich header fields in frozen report snapshots');
 perform pg_temp.bn_v221_check(jsonb_array_length(report->'cards')=2 and
  report->'cards'->0->>'kind'='divider' and report->'cards'->0->>'text'='--- DITCH ---' and
  report->'cards'->1->'owner_ids' @> jsonb_build_array(worker) and
  report->'cards'->1->>'destination_location'='G.15.000' and
  report->'cards'->1->>'destination_qualifier'='North side' and
  report->'cards'->1->>'workflow_instructions'='Move first two to staging; bunch remainder' and
  report->'cards'->1->>'notes'='Protect the buds',
  'frozen preview keeps divider order and exact assigned compound row payload');
 perform pg_temp.bn_v221_check((select count(*)=1 from bunch_note_private.bunch_note_work_cards wc
  join bunch_note_private.bunch_notes n on n.id=wc.bunch_note_id where n.batch_id=draft_batch_id and n.location_code='C.88.001'),
  'only inventory cards receive relational work-card ACL records; divider remains ordered JSON');
 perform pg_temp.bn_v221_check(jsonb_array_length(location_report->'cards')=1 and location_report->'cards'->0->>'kind'='divider' and
  location_report->>'work_type'='D.05. Bunch Notes' and location_report->>'purpose_thread'='Header-only daily route',
  'header-only preview snapshot retains its metadata and zero inventory cards');
 perform pg_temp.bn_v221_check(preview_result->'recipients' @> jsonb_build_array(
  jsonb_build_object('profile_id',worker,'email','worker-v221@example.invalid'),
  jsonb_build_object('profile_id',d,'email','dylan-v221@example.invalid'),
  jsonb_build_object('profile_id','88000000-0000-4000-8000-000000000002','email','megan-v221@example.invalid'),
  jsonb_build_object('profile_id','88000000-0000-4000-8000-000000000003','email','sharon-v221@example.invalid')),
  'saved assigned worker plus default Bunch recipients resolve in preview on the server');
 perform public.bunch_note_freeze_pdfs_v1(preview_id,(select jsonb_agg(jsonb_build_object(
  'job_id',r->'job_id','filename','v221-walking-list.pdf',
  'base64',encode(convert_to('%PDF-1.4'||repeat('x',220),'UTF8'),'base64')))
  from jsonb_array_elements(preview_result->'reports') r));
 result:=public.bunch_note_command_v1(d,'publish',jsonb_build_object('preview_id',preview_id,'send_email',true),publish_command,1);
 replay:=public.bunch_note_command_v1(d,'publish',jsonb_build_object('preview_id',preview_id,'send_email',true),publish_command,1);
 perform pg_temp.bn_v221_check(result=replay and result->>'event_id' is not null,
  'publishing the frozen blueprint replays the same existing email outbox event');
 perform pg_temp.bn_v221_check((select count(*)=1 from public.ph_request_delivery_outbox e
  where e.event_id=(result->>'event_id')::uuid),
  'header-only and multi-card blueprint publish enqueue exactly one mocked delivery event without sending email');
 perform pg_temp.bn_v221_check((select count(*)=1 from bunch_note_private.previews p
  where p.id=preview_id and p.published and p.reports=preview_result->'reports'),
  'published walking-list report and header-only location remain frozen in the receipt snapshot');
end $$;

select ok((select count(*)=20 from bn_v221_checks),'all v2.2.1 database checks ran');
select * from finish();
rollback;
