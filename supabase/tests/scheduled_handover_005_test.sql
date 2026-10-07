-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select has_table('private','scheduled_account_handover_v1','fixed handover schedule exists');
select has_function('public','app_account_active_v1',array['uuid','text'],'service account activity check exists');
select has_function('public','resolve_operational_recipients_v1',array['text[]','text'],'recipient expansion RPC exists');
select has_function('public','scheduled_handover_tick_v1',array[]::text[],'bounded handover worker RPC exists');
select is((select departing_profile_id from private.scheduled_account_handover_v1 where transition_key='kayla_knepp_to_nelly_aguilar_20261002'),
  'e2584b32-472c-4888-b592-394235050b5b'::uuid,'scheduled account is the verified Kayla profile');
select is((select successor_profile_id from private.scheduled_account_handover_v1 where transition_key='kayla_knepp_to_nelly_aguilar_20261002'),
  '961b0a0f-11a6-4db5-b066-582f772ab8e7'::uuid,'successor is the verified Nelly profile');
select is((select effective_at from private.scheduled_account_handover_v1 where transition_key='kayla_knepp_to_nelly_aguilar_20261002'),
  '2026-10-03 04:00:00+00'::timestamptz,'cutoff is 11 PM Central on October 2');
select ok(not private.scheduled_handover_cutoff_reached_v1('kayla_knepp','2026-10-03 03:59:59.999999+00'),
  'Kayla remains active one microsecond before cutoff');
select ok(private.scheduled_handover_cutoff_reached_v1('kayla_knepp','2026-10-03 04:00:00+00'),
  'Kayla is denied at the exact cutoff');
select ok(private.app_account_active_at_v1('e2584b32-472c-4888-b592-394235050b5b','kayla_knepp','2026-10-03 03:59:59.999999+00'),
  'Kayla account is accepted one microsecond before cutoff');
select ok(not private.app_account_active_at_v1('e2584b32-472c-4888-b592-394235050b5b','kayla_knepp','2026-10-03 04:00:00+00'),
  'Kayla account is rejected at the exact cutoff');
select is(private.resolve_operational_recipients_at_v1(array['kayla_knepp'],'username','2026-10-03 03:59:59.999999+00'),
  array['kayla_knepp','nelly_aguilar']::text[],'Kayla routing overlaps to Nelly until cutoff');
select is(private.resolve_operational_recipients_at_v1(array['kayla_knepp'],'username','2026-10-03 04:00:00+00'),
  array['nelly_aguilar']::text[],'Kayla routing moves to Nelly at cutoff');
select is(private.resolve_operational_recipients_at_v1(array['kayla_knepp_backup'],'username','2026-10-03 03:59:59+00'),
  array['kayla_knepp_backup']::text[],'resolver does not match Kayla by substring');
select * from finish();
rollback;
