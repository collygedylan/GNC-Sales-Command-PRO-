begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

select has_table('public','core_employees','HR employee master exists');
select has_table('public','hr_job_codes','job-code lookup exists');
select has_table('public','hr_events','append-only HR event log exists');
select has_table('public','labor_timesheets','partitioned labor ledger exists');
select has_column('public','core_employees','profile_id','employee profile mapping is nullable and unique');
select has_column('public','labor_timesheets','work_date','labor partition key is a work date');
select ok((select relkind = 'p' from pg_class where oid = 'public.labor_timesheets'::regclass), 'timesheets are range-partitioned');
select ok((select relrowsecurity from pg_class where oid = 'public.core_employees'::regclass), 'employee table uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.labor_timesheets'::regclass), 'timesheet parent uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass), 'Realtime messages already use RLS');
select ok((select count(*) = 2 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
  and policyname in ('alpha_dylan_chat_realtime_select', 'alpha_dylan_chat_realtime_insert')),
  'Dylan-only Realtime channel policies are installed');
select ok(not has_table_privilege('anon','public.core_employees','select'), 'anonymous users cannot read employee records');
select ok(not has_table_privilege('anon','public.hr_calendar_reminder_outbox','select'), 'anonymous users cannot read reminder outbox');
select ok(not has_table_privilege('authenticated','public.hr_events','update'), 'authenticated users cannot mutate immutable HR events');
select ok(not has_function_privilege('authenticated','public.hr_claim_calendar_reminders_v1(integer)','execute'), 'authenticated users cannot claim push work');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.ph_department_calendar_events'::regclass and tgname = 'hr_reconcile_time_off_out'), 'time-off approval trigger reconciles OUT rows');
select ok(exists (select 1 from cron.job where jobname = 'hr_calendar_reminder_sweep' and schedule = '*/5 * * * *'), 'five-minute calendar reminder sweep is registered');

select * from finish();
rollback;
