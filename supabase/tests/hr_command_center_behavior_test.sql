-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Synthetic identities and roster data are isolated by this test transaction.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
  ('c2000000-0000-4000-8000-000000000001','hr-alpha-dylan@example.invalid','{}','{}'),
  ('c2000000-0000-4000-8000-000000000002','hr-alpha-megan@example.invalid','{}','{}'),
  ('c2000000-0000-4000-8000-000000000003','hr-alpha-sharon@example.invalid','{}','{}');
insert into public.profiles(id,username,display_name,role,must_change_password) values
  ('c2000000-0000-4000-8000-000000000001','dylan_collyge','Dylan Fixture','ADMIN',false),
  ('c2000000-0000-4000-8000-000000000002','megan_kelly','Megan Fixture','Manager',false),
  ('c2000000-0000-4000-8000-000000000003','sharon_combs','Sharon Fixture','Manager',false);
insert into public.core_employees(id,profile_id,name,emp_number,department)
values ('c2100000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Dylan Fixture','HR-T-DYLAN','Inventory'),
       ('c2100000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','Megan Fixture','HR-T-MEGAN','Plant Evaluators'),
       ('c2100000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000003','Sharon Fixture','HR-T-SHARON','Kiers & Counters');
insert into public.hr_job_codes(job_code,description) values ('HR-TEST-A','Test A'),('HR-TEST-B','Test B');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"c2000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select is((select count(*)::integer from public.core_employees where id='c2100000-0000-4000-8000-000000000002'),0,'Megan cannot read Plant Evaluators while department rollout is gated');
select is((select count(*)::integer from public.core_employees where id='c2100000-0000-4000-8000-000000000001'),0,'Megan cannot read a different department');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c2000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select is((select count(*)::integer from public.core_employees where id='c2100000-0000-4000-8000-000000000003'),0,'Sharon department rule remains disabled during the alpha gate');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c2000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is((select count(*)::integer from public.core_employees),3,'Dylan can read all departments');
select is((select count(*)::integer from public.hr_job_codes),2,'Dylan can read job-code lookup');
insert into public.hr_events(emp_number,event_type,details,created_by_profile_id)
values('HR-T-MEGAN','promotion','{}','c2000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.hr_events where emp_number='HR-T-MEGAN'),1,'Dylan can append a scoped HR event');
reset role;
select throws_ok($$update public.hr_events set details='{"changed":true}' where emp_number='HR-T-MEGAN'$$,
  '42501','hr_events_append_only','HR events cannot be edited after insertion');
set local role authenticated;
insert into public.labor_timesheets(employee_id,work_date,job_code,hours,created_by_profile_id)
values('c2100000-0000-4000-8000-000000000002','2026-09-28','HR-TEST-A',3,'c2000000-0000-4000-8000-000000000001'),
      ('c2100000-0000-4000-8000-000000000002','2026-09-28','HR-TEST-B',4,'c2000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.labor_timesheets where employee_id='c2100000-0000-4000-8000-000000000002' and work_date='2026-09-28'),2,'multiple job-code entries are allowed per employee day');
select throws_ok($$insert into public.labor_timesheets(employee_id,work_date,job_code,hours,created_by_profile_id) values('c2100000-0000-4000-8000-000000000002','2026-09-28','HR-TEST-A',2,'c2000000-0000-4000-8000-000000000001')$$,
  '23505',null::text,'duplicate employee/day/job-code entries are idempotency conflicts');
reset role;

insert into public.ph_department_calendar_events(unique_id,department,event_type,title,description,start_at,end_at,requested_by_username,assigned_to_username,assigned_usernames,status)
values('hr-alpha-timeoff-test','Inventory','time_off','Vacation request','fixture','2026-10-12 13:00:00+00','2026-10-12 21:00:00+00','dylan_collyge','dylan_collyge','["dylan_collyge"]','requested');
select is((select count(*)::integer from public.ph_department_calendar_events where hr_source_event_id='hr-alpha-timeoff-test'),0,'pending request does not create an OUT row');
update public.ph_department_calendar_events set status='approved',approved_by_username='dylan_collyge',approved_at=now() where unique_id='hr-alpha-timeoff-test';
select is((select count(*)::integer from public.ph_department_calendar_events where hr_source_event_id='hr-alpha-timeoff-test' and status='approved'),1,'approval creates the linked OUT calendar row');
update public.ph_department_calendar_events set start_at='2026-10-13 13:00:00+00',end_at='2026-10-13 21:00:00+00' where unique_id='hr-alpha-timeoff-test';
select is((select count(*)::integer from public.ph_department_calendar_events where hr_source_event_id='hr-alpha-timeoff-test'),1,'rescheduling updates rather than duplicates the linked OUT row');
select is((select start_at from public.ph_department_calendar_events where hr_source_event_id='hr-alpha-timeoff-test'),'2026-10-13 13:00:00+00'::timestamptz,'OUT row tracks the approved time-off dates');
update public.ph_department_calendar_events set status='cancelled' where unique_id='hr-alpha-timeoff-test';
select is((select status from public.ph_department_calendar_events where hr_source_event_id='hr-alpha-timeoff-test'),'cancelled','cancelling a request cancels its linked OUT row');
update public.ph_department_calendar_events set status='approved' where unique_id='hr-alpha-timeoff-test';
select is((select count(*)::integer from public.ph_department_calendar_events where hr_source_event_id='hr-alpha-timeoff-test'),1,'reapproval reuses the unique OUT row');
select is((select count(*)::integer from public.ph_department_calendar_events where unique_id='hr-alpha-timeoff-test' and hr_source_event_id is null),1,'source request remains distinguishable from its OUT row');

insert into public.ph_department_calendar_events(unique_id,event_type,title,start_at,end_at,status)
values('hr-alpha-meeting-spring','meeting','DST spring fixture','2026-03-09 15:00:00+00','2026-03-09 16:00:00+00','approved'),
      ('hr-alpha-meeting-fall','meeting','DST fall fixture','2026-11-02 16:00:00+00','2026-11-02 17:00:00+00','approved');
select private.hr_enqueue_calendar_reminders_v1('2026-03-08 14:00:00+00'::timestamptz);
select is((select count(*)::integer from public.hr_calendar_reminder_outbox where calendar_event_id='hr-alpha-meeting-spring' and event_type='meeting_day_before'),1,'prior-day 9 AM reminder uses CDT across spring DST transition');
select private.hr_enqueue_calendar_reminders_v1('2026-11-01 15:00:00+00'::timestamptz);
select is((select count(*)::integer from public.hr_calendar_reminder_outbox where calendar_event_id='hr-alpha-meeting-fall' and event_type='meeting_day_before'),1,'prior-day 9 AM reminder uses CST across fall DST transition');
select is((select count(*)::integer from public.hr_calendar_reminder_outbox where calendar_event_id='hr-alpha-meeting-spring' and recipient_username='dylan_collyge'),1,'reminder outbox targets only Dylan');
select is((select count(*)::integer from public.hr_calendar_reminder_outbox where event_key like 'hr-calendar:%' and calendar_event_id='hr-alpha-meeting-spring'),1,'same schedule timestamp creates one idempotent reminder');

insert into public.hr_calendar_reminder_outbox(event_key,event_type,calendar_event_id,status,attempt_count,lease_expires_at)
values('hr-alpha-expired-lease','meeting_t1h','hr-alpha-meeting-spring','processing',0,now()-interval '1 minute');
select is((select count(*)::integer from public.hr_claim_calendar_reminders_v1(10) where event_key='hr-alpha-expired-lease'),1,'expired processing lease is reclaimed');
select is((select attempt_count from public.hr_calendar_reminder_outbox where event_key='hr-alpha-expired-lease'),1,'lease reclaim increments bounded retry accounting');

insert into public.hr_calendar_reminder_outbox(event_key,event_type,calendar_event_id,status,created_at,sent_at)
values('hr-alpha-old-sent','meeting_t1h','old','sent',now()-interval '181 days',now()-interval '181 days'),
      ('hr-alpha-old-failed','meeting_t1h','old','failed',now()-interval '181 days',null),
      ('hr-alpha-old-pending','meeting_t1h','pending','pending',now()-interval '181 days',null);
select is(private.hr_purge_calendar_reminders_v1(),2,'bounded retention removes only terminal reminder rows older than 180 days');
select is((select count(*)::integer from public.hr_calendar_reminder_outbox where event_key='hr-alpha-old-pending'),1,'retention preserves pending delivery and its idempotency key');

select * from finish();
rollback;
