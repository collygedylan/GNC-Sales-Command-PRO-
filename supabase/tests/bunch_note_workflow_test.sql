begin;
create temporary table bn_checks(description text);
create function pg_temp.bn_check(ok boolean,description text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Bunch Note: %',description; end if; insert into bn_checks values(description); end $$;
create function pg_temp.bn_reject(actor uuid,op text,payload jsonb,rev bigint,expected text) returns void language plpgsql as $$
begin
 begin perform public.bunch_note_command_v1(actor,op,payload,gen_random_uuid(),rev); raise exception 'Expected %',expected;
 exception when others then if sqlerrm<>expected then raise; end if; end;
 perform pg_temp.bn_check(true,expected);
end $$;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('98000000-0000-0000-0000-000000000001','dylan@example.invalid','{}','{}'),
 ('98000000-0000-0000-0000-000000000002','worker@example.invalid','{}','{}'),
 ('98000000-0000-0000-0000-000000000003','other@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('98000000-0000-0000-0000-000000000001','dylan_collyge','Dylan','ADMIN',false),
 ('98000000-0000-0000-0000-000000000002','bn_worker','Worker','EVAL',false),
 ('98000000-0000-0000-0000-000000000003','bn_other','Other','EVAL',false);
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,blockalpha,locationcode,lotcode,ptronhand,ptravailable,locationnote,season,ptrreviewed,desigitem)
 values('BN-A','BN-I','Plant','#3',' Full.Block ',' c.12.001 ','27.F1','0',null,'Wide aisles','27.Y','0',''),
 ('BN-B','BN-I','Plant','#3','FULL.BLOCK','C.12.002','26.F1','10','0','Signs','26.F1','2','SHFT');
do $$
declare d uuid:='98000000-0000-0000-0000-000000000001'; w uuid:='98000000-0000-0000-0000-000000000002'; other uuid:='98000000-0000-0000-0000-000000000003';
 draft jsonb; p jsonb; j jsonb; body jsonb; r jsonb; jobid uuid; previewid uuid; command uuid:=gen_random_uuid(); original jsonb; snapshot jsonb; lease uuid:=gen_random_uuid(); eventid uuid; rev bigint;
begin
 select jsonb_agg(to_jsonb(m) order by unique_id) into original from public.ph_master_inventory m;
 perform pg_temp.bn_check((public.bunch_note_command_v1(d,'blocks')->'blocks') ? 'FULL.BLOCK','full block preserved');
 perform pg_temp.bn_reject(w,'drafts','{}',null,'BUNCH_NOTE_AUTHOR_ONLY');
 body:='{"block":"full.block","recipient_ids":[],"locations":[{"location":"c.12.001","purposes":"Rain day","instructions":"Keep aisles","row_ids":["BN-A"],"actions":[{"id":"a","group":"placement","scope":"rows","row_ids":["BN-A"],"instructions":"Center house","quantity":"2"},{"id":"b","group":"hauling","scope":"location","instructions":"Wait for hauling"}]},{"location":"C.12.002","purposes":"Haul-in space","row_ids":["BN-B"],"actions":[{"id":"c","group":"grading","scope":"location","instructions":"Grade","percentage":"20"}]}]}'::jsonb;
 draft:=public.bunch_note_command_v1(d,'save',jsonb_build_object('body',body),command,null)->'draft';
 perform pg_temp.bn_check(draft=public.bunch_note_command_v1(d,'save',jsonb_build_object('body',body),command,null)->'draft','duplicate command replays draft');
 perform pg_temp.bn_check(draft->'body'->'locations'->0->'source'->0->>'stock'='0','zero stock preserved');
 perform pg_temp.bn_check(draft->'body'->'locations'->0->'source'->0->'available'='null','unknown availability preserved');
 perform pg_temp.bn_reject(d,'save',jsonb_build_object('batch_id',draft->'id','body',body),0,'BUNCH_NOTE_REVISION_CONFLICT');
 perform pg_temp.bn_reject(d,'save',jsonb_build_object('body',jsonb_set(body,'{locations,0,actions,0,quantity}','"-1"')),null,'BUNCH_NOTE_QUANTITY_INVALID');
 perform pg_temp.bn_reject(d,'save',jsonb_build_object('body',jsonb_set(body,'{locations,1,actions,0,percentage}','"101"')),null,'BUNCH_NOTE_PERCENTAGE_INVALID');
 p:=public.bunch_note_command_v1(d,'preview',jsonb_build_object('batch_id',draft->'id'),gen_random_uuid(),1)->'preview'; previewid:=(p->>'id')::uuid;
 perform pg_temp.bn_check(jsonb_array_length(p->'recipients')=1 and p->'recipients'->0->>'username'='dylan_collyge','mandatory Dylan only by default');
 perform pg_temp.bn_reject(w,'preview_read',jsonb_build_object('preview_id',previewid),null,'BUNCH_NOTE_AUTHOR_ONLY');
 perform public.bunch_note_freeze_pdfs_v1(previewid,(select jsonb_agg(jsonb_build_object('job_id',x->'job_id','filename','test.pdf','base64',encode(convert_to('%PDF-1.4'||repeat('x',200),'UTF8'),'base64'))) from jsonb_array_elements(p->'reports') x));
 command:=gen_random_uuid();
 r:=public.bunch_note_command_v1(d,'publish',jsonb_build_object('preview_id',previewid,'send_email',true),command,1);
 perform pg_temp.bn_check(r=public.bunch_note_command_v1(d,'publish',jsonb_build_object('preview_id',previewid,'send_email',true),command,1),'publish response loss replay');
 eventid:=(r->>'event_id')::uuid;
 perform pg_temp.bn_check((select count(*)=2 from bunch_note_private.jobs),'separate jobs per location');
 perform pg_temp.bn_reject(w,'cancel',jsonb_build_object('job_id',p->'reports'->1->'job_id','reason','No longer needed'),1,'BUNCH_NOTE_AUTHOR_ONLY');
 perform public.bunch_note_command_v1(d,'cancel',jsonb_build_object('job_id',p->'reports'->1->'job_id','reason','No longer needed'),gen_random_uuid(),1);
 perform pg_temp.bn_reject(w,'get',jsonb_build_object('job_id',p->'reports'->1->'job_id'),null,'BUNCH_NOTE_NOT_FOUND');
 perform pg_temp.bn_reject(w,'pdf',jsonb_build_object('job_id',p->'reports'->1->'job_id'),null,'BUNCH_NOTE_NOT_FOUND');
 perform pg_temp.bn_check((public.bunch_note_command_v1(d,'get',jsonb_build_object('job_id',p->'reports'->1->'job_id'))->'job'->>'status')='cancelled','Dylan retains canceled history');
 jobid:=(p->'reports'->0->>'job_id')::uuid;
 command:=gen_random_uuid();
 perform public.bunch_note_command_v1(w,'claim',jsonb_build_object('job_id',jobid),command,1);
 perform pg_temp.bn_reject(other,'get',jsonb_build_object('job_id',jobid),null,'BUNCH_NOTE_NOT_FOUND');
 perform pg_temp.bn_reject(other,'pdf',jsonb_build_object('job_id',jobid),null,'BUNCH_NOTE_NOT_FOUND');
 perform pg_temp.bn_reject(w,'progress',jsonb_build_object('job_id',jobid,'action_id','a','status','not_needed'),2,'BUNCH_NOTE_REASON_REQUIRED');
 perform public.bunch_note_command_v1(w,'progress',jsonb_build_object('job_id',jobid,'action_id','a','status','done'),gen_random_uuid(),2);
 perform pg_temp.bn_reject(w,'complete',jsonb_build_object('job_id',jobid),3,'BUNCH_NOTE_UNRESOLVED_ACTIONS');
 perform public.bunch_note_command_v1(w,'release',jsonb_build_object('job_id',jobid),gen_random_uuid(),3);
 perform public.bunch_note_command_v1(d,'assign',jsonb_build_object('job_id',jobid,'owner_id',other),gen_random_uuid(),4);
 begin perform public.bunch_note_command_v1(w,'claim',jsonb_build_object('job_id',jobid),command,1); raise exception 'Expected stale replay rejection';
 exception when others then if sqlerrm<>'BUNCH_NOTE_NOT_FOUND' then raise; end if; end;
 perform pg_temp.bn_check(true,'old owner cannot replay commands to read reassigned work');
 j:=public.bunch_note_command_v1(d,'get',jsonb_build_object('job_id',jobid))->'job';
 perform pg_temp.bn_check(j->'progress'->'a'->>'status'='done','ownership preserves action progress');
 draft:=public.bunch_note_command_v1(d,'revise',jsonb_build_object('job_id',jobid),gen_random_uuid(),5)->'draft';
 body:=jsonb_set(draft->'body','{locations,0,actions,1,instructions}','"Wait for hauling, then count"');
 draft:=public.bunch_note_command_v1(d,'save',jsonb_build_object('batch_id',draft->'id','body',body),gen_random_uuid(),1)->'draft';
 p:=public.bunch_note_command_v1(d,'preview',jsonb_build_object('batch_id',draft->'id'),gen_random_uuid(),2)->'preview';
 perform public.bunch_note_freeze_pdfs_v1((p->>'id')::uuid,(select jsonb_agg(jsonb_build_object('job_id',x->'job_id','filename','rev.pdf','base64',encode(convert_to('%PDF-1.4'||repeat('y',200),'UTF8'),'base64'))) from jsonb_array_elements(p->'reports') x));
 perform public.bunch_note_command_v1(d,'publish',jsonb_build_object('preview_id',p->'id'),gen_random_uuid(),2);
 j:=public.bunch_note_command_v1(other,'get',jsonb_build_object('job_id',jobid))->'job';
 perform pg_temp.bn_check(j->'progress'->'a'->>'status'='done' and not(j->'progress' ? 'b') and j->>'instruction_revision'='2','revisions keep unchanged progress and owner');
 perform pg_temp.bn_check((select count(*)=1 from public.ph_request_delivery_outbox where event_type='bunch_note_submission'),'revision does not automatically email');
 rev:=(j->>'revision')::bigint;
 perform public.bunch_note_command_v1(other,'progress',jsonb_build_object('job_id',jobid,'action_id','b','status','not_needed','reason','Hauling finished'),gen_random_uuid(),rev);
 perform public.bunch_note_command_v1(other,'complete',jsonb_build_object('job_id',jobid),gen_random_uuid(),rev+1);
 perform pg_temp.bn_reject(w,'get',jsonb_build_object('job_id',jobid),null,'BUNCH_NOTE_NOT_FOUND');
 perform pg_temp.bn_check((public.bunch_note_command_v1(other,'get',jsonb_build_object('job_id',jobid))->'job'->>'status')='complete','owner retains completed history');
 update public.ph_request_delivery_outbox set status='processing',lease_token=lease,lease_expires_at=now()+interval '2 minutes' where event_id=eventid;
 perform public.bunch_note_delivery_record_v1(eventid,lease,'sending','{}');
 perform public.bunch_note_delivery_record_v1(eventid,lease,'unknown','{}');
 perform pg_temp.bn_check(public.bunch_note_delivery_record_v1(eventid,lease,'sending','{}')->'allow_send'='false','unknown prevents blind sending');
 perform public.bunch_note_delivery_record_v1(eventid,lease,'sent','{"gmail_message_id":"receipt"}');
 perform public.bunch_note_delivery_record_v1(eventid,lease,'unknown','{}');
 perform pg_temp.bn_check(public.bunch_note_delivery_lookup_v1(eventid)->>'delivery_status'='sent','durable receipt survives acknowledgement loss');
 perform pg_temp.bn_check((select jsonb_agg(to_jsonb(m) order by unique_id)=original from public.ph_master_inventory m),'no inventory changes');
 snapshot:=public.bunch_note_command_v1(other,'pdf',jsonb_build_object('job_id',jobid));
 begin perform bunch_note_private.recipients('["98000000-0000-0000-0000-000000000099"]'); raise exception 'Expected recipient injection rejection';
 exception when others then if sqlerrm<>'BUNCH_NOTE_RECIPIENT_INVALID' then raise; end if; end;
 perform pg_temp.bn_check(true,'unmapped recipient injection rejected');
 delete from public.ph_master_inventory where unique_id='BN-A';
 perform pg_temp.bn_check(public.bunch_note_command_v1(other,'pdf',jsonb_build_object('job_id',jobid))=snapshot,'inventory deletion cannot change historical PDF');
 update auth.users set email=null where id=d;
 begin perform bunch_note_private.recipients('[]'); raise exception 'Expected missing Dylan mapping';
 exception when others then if sqlerrm<>'BUNCH_NOTE_DYLAN_EMAIL_REQUIRED' then raise; end if; end;
 perform pg_temp.bn_check(true,'missing Dylan mapping blocks email');
 perform pg_temp.bn_reject(d,'preview',jsonb_build_object('batch_id',draft->'id'),3,'BUNCH_NOTE_SOURCE_CHANGED');
 perform pg_temp.bn_check(not has_function_privilege('authenticated','public.bunch_note_command_v1(uuid,text,jsonb,uuid,bigint)','execute'),'browser RPC cannot impersonate actor');
 perform pg_temp.bn_check(not has_schema_privilege('authenticated','bunch_note_private','usage'),'browser cannot read private records');
end $$;
-- Recorded work tests run in the same focused, rolled-back fixture.
update auth.users set email='dylan@example.invalid' where id='98000000-0000-0000-0000-000000000001';
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,blockalpha,locationcode,lotcode,ptronhand,ptrreviewed,ptravailable,season,desigitem)
values ('BN-C',' Mix ','Plant','#3','NEW','N.1','LOT1','10','0','8','27.y',''),
 ('BN-D','MIX','Plant','#5','NEW','N.1','LOT2','20',null,'0','27.F1',''),
 ('BN-E','OTHER','Other','#5','NEW','N.1','LOT3','30','2','29','27.F1','SHFT');
create function pg_temp.bn_do(actor uuid,jobid uuid,op text,payload jsonb default '{}') returns jsonb language plpgsql as $$
declare rev bigint;
begin select revision into rev from bunch_note_private.jobs where id=jobid;
 return public.bunch_note_command_v1(actor,op,payload||jsonb_build_object('job_id',jobid),gen_random_uuid(),rev);
end $$;
do $$
declare d uuid:='98000000-0000-0000-0000-000000000001'; w uuid:='98000000-0000-0000-0000-000000000002'; other uuid:='98000000-0000-0000-0000-000000000003';
 ta bunch_note_private.options; move bunch_note_private.options; shift bunch_note_private.options; custom jsonb; draft jsonb; p jsonb; body jsonb; j jsonb; result jsonb; history jsonb;
 jobid uuid; eid uuid; first_id uuid; correction_id uuid; command uuid; previewid uuid; rev bigint; snapshot jsonb; inventory_before jsonb;
begin
 select jsonb_agg(to_jsonb(m) order by unique_id) into inventory_before from public.ph_master_inventory m;
 select * into ta from bunch_note_private.options where kind='ta' limit 1;
 select * into move from bunch_note_private.options where label='Move';
 select * into shift from bunch_note_private.options where label='Grade shift';
 perform pg_temp.bn_check(bunch_note_private.shift_eligible('{"season":"Y"}') and bunch_note_private.shift_eligible('{"season":"U3"}') and bunch_note_private.shift_eligible('{"season":"F1","desigitem":"shft"}') and not bunch_note_private.shift_eligible('{"season":"F1"}'),'shift qualification is OR, case insensitive');
 body:=jsonb_build_object('block','NEW','recipient_ids','[]'::jsonb,'locations',jsonb_build_array(jsonb_build_object('location','N.1','purposes','Recorded work','row_ids',jsonb_build_array('BN-C'),
 'actions',jsonb_build_array(jsonb_build_object('id','ta','option_id',ta.id,'group',ta.category,'kind',ta.kind,'label',ta.label,'instructions',ta.label,'scope','rows','row_ids',jsonb_build_array('BN-C'),'quantity','5'),
 jsonb_build_object('id','move','option_id',move.id,'group',move.category,'kind',move.kind,'label',move.label,'instructions',move.label,'scope','rows','row_ids',jsonb_build_array('BN-C'),'quantity','4')))));
 draft:=public.bunch_note_command_v1(d,'save',jsonb_build_object('body',body),gen_random_uuid())->'draft';
 perform pg_temp.bn_check(jsonb_array_length(draft->'body'->'locations'->0->'source')=2,'selected item snapshots every lot even when action targets just one');
 perform pg_temp.bn_check(draft->'body'->'locations'->0->'source'->0->>'season'='27.y' and draft->'body'->'locations'->0->'source'->0->>'review'='0','actual Season and Review projected');
 perform pg_temp.bn_reject(d,'save',jsonb_build_object('body',jsonb_set(body,'{locations,0,source_all}','[]')),null,'BUNCH_NOTE_SOURCE_CHANGED');
 -- A shift action cannot include the nonqualifying #5 lot.
 begin perform bunch_note_private.validate_action(jsonb_build_object('id','shift','option_id',shift.id,'group',shift.category,'kind',shift.kind,'label',shift.label,'instructions',shift.label,'scope','rows','row_ids',jsonb_build_array('BN-D')),bunch_note_private.inventory('NEW','N.1'));raise exception 'Expected shift denial';
 exception when others then if sqlerrm<>'BUNCH_NOTE_SHIFT_ROWS_INVALID' then raise; end if;end;
 p:=public.bunch_note_command_v1(d,'preview',jsonb_build_object('batch_id',draft->'id'),gen_random_uuid(),1)->'preview';
 previewid:=(p->>'id')::uuid;jobid:=(p->'reports'->0->>'job_id')::uuid;
 perform public.bunch_note_freeze_pdfs_v1(previewid,jsonb_build_array(jsonb_build_object('job_id',jobid,'filename','instructions.pdf','base64',encode(convert_to('%PDF-1.4'||repeat('x',200),'UTF8'),'base64'))));
 perform public.bunch_note_command_v1(d,'publish',jsonb_build_object('preview_id',previewid),gen_random_uuid(),1);
 perform pg_temp.bn_reject(w,'add_action',jsonb_build_object('job_id',jobid),1,'BUNCH_NOTE_OWNER_ONLY');
 perform pg_temp.bn_reject(w,'actual',jsonb_build_object('job_id',jobid),1,'BUNCH_NOTE_OWNER_ONLY');
 perform pg_temp.bn_do(w,jobid,'claim');
 perform pg_temp.bn_reject(other,'actual',jsonb_build_object('job_id',jobid),2,'BUNCH_NOTE_NOT_FOUND');
 perform pg_temp.bn_reject(w,'actual',jsonb_build_object('job_id',jobid,'action_id','ta','source_id','BN-C','quantity','2'),1,'BUNCH_NOTE_REVISION_CONFLICT');
 perform pg_temp.bn_reject(w,'progress',jsonb_build_object('job_id',jobid,'action_id','ta','status','done'),2,'BUNCH_NOTE_ACTUAL_REQUIRED');
 perform pg_temp.bn_do(w,jobid,'actual','{"action_id":"ta","source_id":"BN-C","quantity":"2"}');
 select id into first_id from bunch_note_private.actuals where job_id=jobid and action_id='ta';
 command:=gen_random_uuid();select revision into rev from bunch_note_private.jobs where id=jobid;
 result:=public.bunch_note_command_v1(w,'actual',jsonb_build_object('job_id',jobid,'action_id','ta','source_id','BN-C','quantity','3'),command,rev);
 perform pg_temp.bn_check(result=public.bunch_note_command_v1(w,'actual',jsonb_build_object('job_id',jobid,'action_id','ta','source_id','BN-C','quantity','3'),command,rev),'actual response-loss retry replays without duplicate entry');
 perform pg_temp.bn_do(w,jobid,'progress','{"action_id":"ta","status":"done"}');
 select revision into rev from bunch_note_private.jobs where id=jobid;
 perform pg_temp.bn_reject(w,'actual',jsonb_build_object('job_id',jobid,'action_id','move','source_id','BN-C','quantity','2'),rev,'BUNCH_NOTE_DESTINATION_REQUIRED');
 perform pg_temp.bn_do(w,jobid,'actual','{"action_id":"move","source_id":"BN-C","quantity":"2","destination":"EXISTING.LOC"}');
 perform pg_temp.bn_do(w,jobid,'actual','{"action_id":"move","source_id":"BN-C","quantity":"1","destination":"NEW.LOC"}');
 select revision into rev from bunch_note_private.jobs where id=jobid;
 perform pg_temp.bn_reject(w,'progress',jsonb_build_object('job_id',jobid,'action_id','move','status','done'),rev,'BUNCH_NOTE_VARIANCE_REASON_REQUIRED');
 perform pg_temp.bn_do(w,jobid,'progress','{"action_id":"move","status":"done","reason":"One remained locally"}');
 perform pg_temp.bn_check((select progress->'move'->'review_flags' ? 'differs_from_planned_quantity' from bunch_note_private.jobs where id=jobid),'under-plan completion is visibly flagged');
 -- Reusable choices have revision control and cannot change already saved labels.
 custom:=pg_temp.bn_do(w,jobid,'option_add','{"category":"inventory","kind":"ta","label":"Extra TA check"}')->'option';
 begin perform pg_temp.bn_do(w,jobid,'option_add','{"category":"inventory","kind":"hauling","label":"Bypass shift"}');raise exception 'Expected hauling category constraint';
 exception when check_violation then perform pg_temp.bn_check(true,'custom hauling cannot bypass eligibility through another category');end;
 perform pg_temp.bn_reject(w,'option_edit',jsonb_build_object('option_id',custom->'id','label','No'),1,'BUNCH_NOTE_AUTHOR_ONLY');
 perform pg_temp.bn_do(w,jobid,'add_action',jsonb_build_object('action',jsonb_build_object('id','extra','option_id',custom->'id','group','inventory','kind','ta','label','Extra TA check','instructions','Extra TA check','scope','rows','row_ids',jsonb_build_array('BN-D'))));
 perform public.bunch_note_command_v1(d,'option_edit',jsonb_build_object('option_id',custom->'id','label','Renamed TA','active',false),gen_random_uuid(),1);
 perform pg_temp.bn_check((select action->>'label'='Extra TA check' from bunch_note_private.worker_actions where job_id=jobid),'catalog rename preserves saved worker instruction');
 perform pg_temp.bn_reject(d,'option_edit',jsonb_build_object('option_id',custom->'id','label','Stale'),1,'BUNCH_NOTE_REVISION_CONFLICT');
 perform pg_temp.bn_do(w,jobid,'actual','{"action_id":"extra","source_id":"BN-D","quantity":"25","explanation":"Additional stock arrived; review count"}');
 perform pg_temp.bn_check((select review_flags ? 'exceeds_saved_stock' from bunch_note_private.actuals where job_id=jobid and action_id='extra'),'overstock recorded unchanged with review flag');
 perform pg_temp.bn_do(w,jobid,'actual',jsonb_build_object('action_id','ta','source_id','BN-C','replaces_id',first_id,'quantity','1','explanation','Corrected count'));
 select id into correction_id from bunch_note_private.actuals where replaces_id=first_id;
 perform pg_temp.bn_check((select not(progress ? 'ta') from bunch_note_private.jobs where id=jobid),'open correction requires fresh action completion');
 perform pg_temp.bn_do(w,jobid,'progress','{"action_id":"ta","status":"done","reason":"Corrected actual below plan"}');
 perform pg_temp.bn_do(w,jobid,'progress','{"action_id":"extra","status":"done"}');
 -- A published revision cannot erase actuals or worker-added work.
 history:=bunch_note_private.actual_history(jobid);
 draft:=pg_temp.bn_do(d,jobid,'revise')->'draft';
 body:=jsonb_set(draft->'body','{locations,0,instructions}','"Updated location preparation"');
 draft:=public.bunch_note_command_v1(d,'save',jsonb_build_object('batch_id',draft->'id','body',body),gen_random_uuid(),1)->'draft';
 p:=public.bunch_note_command_v1(d,'preview',jsonb_build_object('batch_id',draft->'id'),gen_random_uuid(),2)->'preview';
 perform public.bunch_note_freeze_pdfs_v1((p->>'id')::uuid,jsonb_build_array(jsonb_build_object('job_id',jobid,'filename','revised.pdf','base64',encode(convert_to('%PDF-1.4'||repeat('r',200),'UTF8'),'base64'))));
 perform public.bunch_note_command_v1(d,'publish',jsonb_build_object('preview_id',p->'id'),gen_random_uuid(),2);
 perform pg_temp.bn_check(bunch_note_private.actual_history(jobid)=history and (select progress ? 'extra' from bunch_note_private.jobs where id=jobid),'instruction revision preserves actuals and unchanged worker progress');
 -- Ownership transfers preserve actual history but revoke prior owner's access and replay.
 perform pg_temp.bn_do(w,jobid,'release');perform pg_temp.bn_do(d,jobid,'assign',jsonb_build_object('owner_id',other));
 perform pg_temp.bn_reject(w,'get',jsonb_build_object('job_id',jobid),null,'BUNCH_NOTE_NOT_FOUND');
 begin perform public.bunch_note_command_v1(w,'actual',jsonb_build_object('job_id',jobid,'action_id','ta','source_id','BN-C','quantity','3'),command,rev);raise exception 'Expected old replay denial';
 exception when others then if sqlerrm not in ('BUNCH_NOTE_NOT_FOUND','BUNCH_NOTE_COMMAND_CONFLICT') then raise;end if;end;
 perform pg_temp.bn_do(other,jobid,'complete');
 select revision into rev from bunch_note_private.jobs where id=jobid;
 perform pg_temp.bn_reject(other,'actual',jsonb_build_object('job_id',jobid,'replaces_id',correction_id),rev,'BUNCH_NOTE_OWNER_ONLY');
 perform pg_temp.bn_reject(other,'work_preview',jsonb_build_object('job_id',jobid),rev,'BUNCH_NOTE_AUTHOR_ONLY');
 p:=pg_temp.bn_do(d,jobid,'work_preview',jsonb_build_object('recipient_ids',jsonb_build_array(other)))->'preview';
 perform pg_temp.bn_check(p->>'report_kind'='completed_work' and jsonb_array_length(p->'recipients')=2,'work preview freezes actual history and mandatory Dylan plus selected user');
 previewid:=(p->>'id')::uuid;
 perform public.bunch_note_freeze_pdfs_v1(previewid,jsonb_build_array(jsonb_build_object('job_id',jobid,'filename','work.pdf','base64',encode(convert_to('%PDF-1.4'||repeat('w',200),'UTF8'),'base64'))));
 perform pg_temp.bn_do(d,jobid,'actual',jsonb_build_object('action_id','ta','source_id','BN-C','replaces_id',correction_id,'quantity','2','explanation','Supervisor verified final count'));
 select revision into rev from bunch_note_private.jobs where id=jobid;
 perform pg_temp.bn_reject(d,'work_publish',jsonb_build_object('preview_id',previewid),rev,'BUNCH_NOTE_REVISION_CONFLICT');
 p:=pg_temp.bn_do(d,jobid,'work_preview',jsonb_build_object('recipient_ids',jsonb_build_array(other)))->'preview';previewid:=(p->>'id')::uuid;
 perform public.bunch_note_freeze_pdfs_v1(previewid,jsonb_build_array(jsonb_build_object('job_id',jobid,'filename','work2.pdf','base64',encode(convert_to('%PDF-1.4'||repeat('v',200),'UTF8'),'base64'))));
 result:=public.bunch_note_command_v1(d,'work_publish',jsonb_build_object('preview_id',previewid,'send_email',true),gen_random_uuid(),rev);eid:=(result->>'event_id')::uuid;
 perform pg_temp.bn_check(public.bunch_note_delivery_lookup_v1(eid)->'reports'->0->>'report_kind'='completed_work','work report uses frozen Bunch delivery channel');
 perform pg_temp.bn_reject(w,'work_pdf',jsonb_build_object('job_id',jobid,'preview_id',previewid),null,'BUNCH_NOTE_NOT_FOUND');
 snapshot:=public.bunch_note_command_v1(other,'work_pdf',jsonb_build_object('job_id',jobid,'preview_id',previewid));
 perform pg_temp.bn_check(snapshot->'pdf'->>'filename'='work2.pdf','authorized owner downloads saved work report');
 perform pg_temp.bn_check(jsonb_array_length(public.bunch_note_command_v1(d,'get',jsonb_build_object('job_id',jobid))->'work_reports')=1,'work report versions separate from instruction revisions');
 perform pg_temp.bn_check((select jsonb_agg(to_jsonb(m) order by unique_id)=inventory_before from public.ph_master_inventory m),'recording, amendments and reports never write inventory');
 perform pg_temp.bn_check(not has_table_privilege('authenticated','bunch_note_private.actuals','select') and not has_table_privilege('service_role','bunch_note_private.actuals','update'),'actual history cannot be directly read or rewritten');
end $$;

-- Destination reads must respect the source job, even when the receiving location is public inventory.
do $$
declare d uuid:='98000000-0000-0000-0000-000000000001'; w uuid:='98000000-0000-0000-0000-000000000002'; other uuid:='98000000-0000-0000-0000-000000000003';
 batchid uuid:=gen_random_uuid(); sourceid uuid:=gen_random_uuid(); targetid uuid:=gen_random_uuid(); result jsonb; action jsonb; snapshot jsonb; firstid uuid; inventory_before jsonb;
begin
 insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,blockalpha,locationcode,lotcode,saleyear,ptronhand,ptravailable,ptrreviewed) values
 ('BN-D-SRC','BN-DEST','Destination Plant','#3','D','D.08.001','LOT1','26','20','0',null),
 ('BN-D-MATCH','BN-DEST','Destination Plant','#5','D','D.09.001','LOT2','2026','0',null,'0'),
 ('BN-D-YEAR','BN-DEST','Destination Plant','#3','D','D.09.002','LOT3','27','8','8','0'),
 ('BN-D-OTHER','OTHER','Other Plant','#3','D','D.10.001','LOT4','26','5','5','0');
 snapshot:=bunch_note_private.inventory('D','D.08.001');
 action:='{"id":"destination-action","kind":"move","group":"grading","label":"Grade and Save / Move To","instructions":"Keep the best and move","scope":"rows","row_ids":["BN-D-SRC"],"quantity":"4","destination":"D.09.001","destination_mode":"matching"}'::jsonb;
 insert into bunch_note_private.batches(id,created_by,block,body) values(batchid,d,'D','{}');
 insert into bunch_note_private.jobs(id,batch_id,note_number,block,location,owner_id,created_by,body) values
 (sourceid,batchid,'BN-DEST-SOURCE','D','D.08.001',w,d,jsonb_build_object('source',snapshot,'actions',jsonb_build_array(action),'instructions','Private source instructions')),
 (targetid,batchid,'BN-DEST-TARGET','D','D.09.001',other,d,jsonb_build_object('source',bunch_note_private.inventory('D','D.09.001'),'actions','[]'::jsonb,'instructions','Private destination instructions'));
 select jsonb_agg(to_jsonb(m) order by unique_id) into inventory_before from public.ph_master_inventory m;
 result:=public.bunch_note_command_v1(w,'destination_lookup',jsonb_build_object('job_id',sourceid,'source_ids',jsonb_build_array('BN-D-SRC'),'itemcode','OTHER','salesyear','27'));
 perform pg_temp.bn_check(result->>'itemcode'='BN-DEST' and result->>'salesyear'='2026','lookup derives trusted source despite injected item/year');
 perform pg_temp.bn_check(exists(select 1 from jsonb_array_elements(result->'matching') r where r->>'unique_id'='BN-D-MATCH' and r->>'stock'='0' and r->'available'='null'),'same-year matching retains zero and unknown');
 perform pg_temp.bn_check(not exists(select 1 from jsonb_array_elements(result->'matching') r where r->>'unique_id' in ('BN-D-YEAR','BN-D-OTHER')),'wrong year and wrong item excluded');
 perform pg_temp.bn_reject(other,'destination_lookup',jsonb_build_object('job_id',sourceid,'source_ids',jsonb_build_array('BN-D-SRC')),null,'BUNCH_NOTE_NOT_FOUND');
 perform pg_temp.bn_reject(w,'destination_lookup','{"source_ids":["BN-D-SRC"]}',null,'BUNCH_NOTE_AUTHOR_ONLY');
 perform pg_temp.bn_reject(w,'destination_lookup',jsonb_build_object('job_id',sourceid,'source_ids',jsonb_build_array('BN-D-OTHER')),null,'BUNCH_NOTE_ACTION_ROWS_INVALID');
 result:=public.bunch_note_command_v1(w,'destination_detail','{"location":" d.09.001 "}');
 perform pg_temp.bn_check(jsonb_array_length(result->'incoming')=1 and jsonb_array_length(result->'jobs')=0,'source owner sees incoming work but not private receiving job');
 result:=public.bunch_note_command_v1(other,'destination_detail','{"location":"D.09.001"}');
 perform pg_temp.bn_check(jsonb_array_length(result->'incoming')=0 and jsonb_array_length(result->'jobs')=1,'receiving owner cannot see private source work');
 result:=public.bunch_note_command_v1(d,'destination_detail','{"location":"D.09.001"}');
 perform pg_temp.bn_check(jsonb_array_length(result->'incoming')=1 and jsonb_array_length(result->'jobs')=1,'Dylan sees incoming and receiving instructions together');
 perform pg_temp.bn_do(w,sourceid,'actual','{"action_id":"destination-action","source_id":"BN-D-SRC","quantity":"2","destination":"D.09.001","destination_mode":"matching"}');
 select id into firstid from bunch_note_private.actuals where job_id=sourceid;
 perform pg_temp.bn_do(w,sourceid,'actual',jsonb_build_object('action_id','destination-action','source_id','BN-D-SRC','quantity','1','destination','D.09.001','replaces_id',firstid,'explanation','Corrected count'));
 result:=public.bunch_note_command_v1(w,'destination_detail','{"location":"D.09.001"}');
 perform pg_temp.bn_check(result->'incoming'->0->'action'->>'quantity'='4' and jsonb_array_length(result->'incoming'->0->'actuals')=1 and result->'incoming'->0->'actuals'->0->>'quantity'='1','planned and actual are separate, superseded entry not counted');
 perform pg_temp.bn_check((select jsonb_agg(to_jsonb(m) order by unique_id)=inventory_before from public.ph_master_inventory m),'destination workflow does not write inventory');
 update public.ph_master_inventory set saleyear='27' where unique_id='BN-D-MATCH';
 begin perform bunch_note_private.validate_destination(action,snapshot); raise exception 'Expected destination revalidation'; exception when others then if sqlerrm<>'BUNCH_NOTE_DESTINATION_CHANGED' then raise; end if; end;
 perform pg_temp.bn_check(true,'changed matching destination requires review');
 perform pg_temp.bn_check(bunch_note_private.sales_year(null) is null and bunch_note_private.sales_year('26.Y') is null,'unknown year is never inferred from season/lot');
end $$;
select plan(1);
select ok((select count(*) from bn_checks)>=20,'Bunch Note lifecycle, privacy, revisions, quantities and delivery assertions passed');
select * from finish();
rollback;
