-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(7);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);

insert into auth.users(id,email,email_confirmed_at) values
 ('59400000-0000-4000-8000-000000000001','rep594@example.invalid',now()),
 ('59400000-0000-4000-8000-000000000002','manager594@example.invalid',now());
insert into public.profiles(id,username,display_name,role,must_change_password) values
 ('59400000-0000-4000-8000-000000000001','rep_594','Fixture Rep','SALESREP',false),
 ('59400000-0000-4000-8000-000000000002','manager_594','Fixture Manager','MANAGER',false);

insert into public.ph_soc_master(unique_id,itemcode,locationcode,lotcode,dock,stopnumber,transactionnumber,
  salesrepname,suspend,suspend_to,suspend_candidate_state,suspend_origin_uid,quantityordered,last_updated)
values
 ('approve-594','594001.030.1','C.09.000','27.F1','38','2','APPROVE-594','Fixture Rep','SUSPEND','dc','candidate',null,'12',now()),
 ('option-594','594001.030.1','B.04.000','27.F1','38','2','APPROVE-594','Fixture Rep','SUSPEND','dc','candidate','approve-594','12',now()),
 ('deny-594','594001.030.1','G.22.000','27.F1','38','2','DENY-594','Fixture Rep','SUSPEND','dc','candidate',null,'12',now()),
 ('sibling-594','594001.030.1','C.09.000','27.F1','38','2','SIBLING-594','Fixture Rep',null,null,null,null,'12',now());

insert into suspend_tag_private.approvals(id,source_uid,source_revision,round,completed_by,rep_id,snapshot,submitter_email,rep_email,sent_by)
select approval_id,s.unique_id,s.last_updated,1,'59400000-0000-4000-8000-000000000002',
 '59400000-0000-4000-8000-000000000001',
 to_jsonb(s)||jsonb_build_object('candidates',(select jsonb_agg(to_jsonb(r)) from public.ph_soc_master r
   where r.unique_id=s.unique_id or r.suspend_origin_uid=s.unique_id)),
 'manager594@example.invalid','rep594@example.invalid','59400000-0000-4000-8000-000000000002'
from (values ('approve-594','59400000-0000-4000-8000-000000000011'::uuid),
 ('deny-594','59400000-0000-4000-8000-000000000012'::uuid)) a(uid,approval_id)
join public.ph_soc_master s on s.unique_id=a.uid;
insert into suspend_tag_private.workflows(source_uid,source_revision,status,current_approval_id)
select r.unique_id,r.last_updated,'awaiting_rep',a.id from suspend_tag_private.approvals a
join public.ph_soc_master r on r.unique_id=a.source_uid or r.suspend_origin_uid=a.source_uid
where a.source_uid in ('approve-594','deny-594');

select throws_ok($$select suspend_tag_private.group_command('59400000-0000-4000-8000-000000000002','decide',
 '{"approvalId":"59400000-0000-4000-8000-000000000011","decision":"approve","candidateUid":"option-594"}',
 '59400000-0000-4000-8000-000000000021',null)$$,'42501','SUSPEND_TAG_FORBIDDEN','an unassigned Manager cannot decide');
select set_config('app.suspend_tag_actor_id','59400000-0000-4000-8000-000000000001',true);
select is(suspend_tag_private.group_command('59400000-0000-4000-8000-000000000001','decide',
 '{"approvalId":"59400000-0000-4000-8000-000000000011","decision":"approve","candidateUid":"option-594"}',
 '59400000-0000-4000-8000-000000000022',null)->>'decision','approved','the assigned Rep can approve the frozen candidate');
select is((select locationcode from public.ph_soc_master where unique_id='approve-594'),'B.04.000','the physical original records the chosen location');
select is((select locationcodeshipchange from public.ph_soc_master where unique_id='option-594'),
 'pic approved B.04.000 Fixture Rep','the selected pull records the exact rep and location');
select is(suspend_tag_private.group_command('59400000-0000-4000-8000-000000000001','decide',
 '{"approvalId":"59400000-0000-4000-8000-000000000012","decision":"deny"}',
 '59400000-0000-4000-8000-000000000023',null)->>'decision','denied','deny all commits a terminal decision');
select ok((select status='Canceled' and cancel_reason='per Fixture Rep' and quantityordered='0'
 from public.ph_soc_master where unique_id='deny-594'),'the original order is canceled and removed from pull quantity');
select ok((select locationcode='C.09.000' and quantityordered='12' and cancel_reason is null
 from public.ph_soc_master where unique_id='sibling-594'),'another order on the same Dock/Drop stays intact');
select * from finish();
rollback;
