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
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,blockalpha,locationcode,lotcode,ptronhand,ptravailable,locationnote)
 values('BN-A','BN-I','Plant','#3',' Full.Block ',' c.12.001 ','27.F1','0',null,'Wide aisles'),
 ('BN-B','BN-I','Plant','#3','FULL.BLOCK','C.12.002','26.F1','10','0','Signs');
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
select plan(1);
select ok((select count(*) from bn_checks)>=20,'Bunch Note lifecycle, privacy, revisions, quantities and delivery assertions passed');
select * from finish();
rollback;
