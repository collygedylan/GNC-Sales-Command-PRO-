-- DO NOT RUN without a separate explicit destructive-action approval.
-- RESTRICT deliberately fails if any dependency still exists.
begin;

drop table public.ph_chat_members restrict;
drop table public.ph_chat_threads restrict;
drop table public.ph_employee_time_cards restrict;
drop table public.ph_security_audit_events restrict;
drop table public.ph_walkie_voice_messages restrict;
drop table public.ph_outlook_accounts restrict;
drop table public.ph_eval_assignment_rules restrict;

-- Replace this rollback with COMMIT only after reviewing the dependency and
-- usage reports and receiving explicit production execution approval.
rollback;
