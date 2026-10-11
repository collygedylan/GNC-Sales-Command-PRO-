-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

select has_column('private', 'drive_evidence_idempotency', 'outcome_code', 'save outcomes are classified');
select has_column('private', 'drive_evidence_idempotency', 'expires_at', 'temporary conflict cache entries can expire');
select has_function('public', 'save_drive_evidence_v1', array['text','text','text','text','text','jsonb','boolean','text','text'], 'V1 compatibility RPC remains available');
select has_function('public', 'save_drive_evidence_v2', array['text','text','text','text','text','jsonb','jsonb','boolean','text','text'], 'V2 field-merge RPC is available');
select has_function('public', 'get_drive_evidence_save_health_v2', array[]::text[], 'service health RPC is available');
select ok(has_function_privilege('authenticated', 'public.save_drive_evidence_v1(text,text,text,text,text,jsonb,boolean,text,text)', 'execute'), 'authenticated old shells can use V1');
select ok(has_function_privilege('authenticated', 'public.save_drive_evidence_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text)', 'execute'), 'authenticated new shells can use V2');
select ok(not has_function_privilege('anon', 'public.save_drive_evidence_v1(text,text,text,text,text,jsonb,boolean,text,text)', 'execute'), 'anonymous cannot use V1');
select ok(not has_function_privilege('anon', 'public.save_drive_evidence_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text)', 'execute'), 'anonymous cannot use V2');
select ok(not has_function_privilege('authenticated', 'public.get_drive_evidence_save_health_v2()', 'execute'), 'authenticated clients cannot read save health');
select ok(has_function_privilege('service_role', 'public.get_drive_evidence_save_health_v2()', 'execute'), 'service role can read sanitized save health');
select ok(pg_get_functiondef('private.save_drive_evidence_core_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text,boolean,text)'::regprocedure) like '%pg_try_advisory_xact_lock%', 'save path uses try-locks');
select ok(pg_get_functiondef('private.save_drive_evidence_core_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text,boolean,text)'::regprocedure) not like '%FOR UPDATE%', 'save path never queues on a row lock');
select ok(pg_get_functiondef('private.save_drive_evidence_core_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text,boolean,text)'::regprocedure) ilike '%last_updated is not distinct from v_row.last_updated%', 'save path uses a conditional atomic update');
select is((public.get_drive_evidence_save_health_v2()->>'contractVersion')::text, 'drive-evidence-save-health-v2', 'health contract is versioned');

-- Exercise the canonical completion response as well as the idempotent replay.
-- These rows are transaction-local test fixtures and never target live records.
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('9f8b0000-0000-4000-8000-000000000021','drive-evidence@example.invalid','{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password)
values('9f8b0000-0000-4000-8000-000000000021','drive_evidence_fixture','Drive Evidence Fixture','ADMIN',false)
on conflict(id) do update set role='ADMIN',disabled_at=null,locked_until=null,must_change_password=false;
insert into public.app_dataset_revisions(key,revision,state)
values('ph_master_inventory',1,'ready')
on conflict(key) do update set state='ready';
insert into public.ph_master_inventory(
  unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,
  match,loc_match_qty,initial_ptr,spec,av_note,last_updated
) values
  ('drive-evidence-success','DRIVE.EVIDENCE.SUCCESS','Drive evidence success','#3','C.12.001','27.F1','80',null,null,null,null,null,'2026-10-06T12:00:00Z'),
  ('drive-evidence-no-match','DRIVE.EVIDENCE.NO.MATCH','Drive evidence no match','#3','C.12.002','27.F1','80',null,null,null,null,null,'2026-10-06T12:00:00Z')
on conflict(unique_id) do update set itemcode=excluded.itemcode,locationcode=excluded.locationcode,lotcode=excluded.lotcode,
  ptravailable=excluded.ptravailable,match=null,loc_match_qty=null,initial_ptr=null,spec=null,av_note=null,
  date_completed=null,app_tab_assignment=null,last_updated=excluded.last_updated,
  av_rule_photo_updated_at=null,av_rule_spec_updated_at=null,av_rule_bundle_updated_at=null,
  av_rule_caliper_updated_at=null,av_rule_match_updated_at=null,av_rule_av_note_updated_at=null,
  av_rule_last_clear_reason=null,av_rule_last_cleared_at=null;
create temporary table drive_evidence_test_identity as
select unique_id,last_updated::text as expected_signature
from public.ph_master_inventory
where unique_id in ('drive-evidence-success','drive-evidence-no-match');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"9f8b0000-0000-4000-8000-000000000021"}',true);
select set_config('request.jwt.claim.sub','9f8b0000-0000-4000-8000-000000000021',true);
select set_config('request.jwt.claim.role','authenticated',true);
-- A dated capture remains current relative to transaction-stable now(); the
-- RPC's later clock_timestamp() metadata is checked independently below.
create temporary table drive_evidence_success_result as
select public.save_drive_evidence_v2(
  'drive-evidence-success','DRIVE.EVIDENCE.SUCCESS','C.12.001','27.F1',
  (select expected_signature from drive_evidence_test_identity where unique_id='drive-evidence-success'), '{}'::jsonb,
  jsonb_build_object(
    'photo_link','https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/location_sales_notes_photos/drive-evidence-success.jpg',
    'photo_name','drive-evidence-success-' || to_char(now() - interval '1 day','YYYY-MM-DD') || '.jpg','spec','1.5 in','av_note','Verified from current photo',
    'match','95','initial_ptr','80','loc_match_qty','76'
  ),
  true,'location','drive-evidence-success-token'
) as payload;

select is((select payload->>'code' from drive_evidence_success_result),'SAVED','secure Drive completion saves the canonical evidence row');
select is((select payload->>'canonicalConfirmed' from drive_evidence_success_result),'true','completion response confirms canonical persistence');
select is((select payload->'row'->>'unique_id' from drive_evidence_success_result),'drive-evidence-success','response retains the exact inventory identity');
select is((select payload->'row'->>'itemcode' from drive_evidence_success_result),'DRIVE.EVIDENCE.SUCCESS','response retains the expected itemcode');
select is((select payload->'row'->>'locationcode' from drive_evidence_success_result),'C.12.001','response retains the expected location');
select is((select payload->'row'->>'lotcode' from drive_evidence_success_result),'27.F1','response retains the expected lot');
select is((select payload->'row'->>'photo_link' from drive_evidence_success_result),'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/location_sales_notes_photos/drive-evidence-success.jpg','saved photo reference is returned');
select is((select payload->'row'->>'spec' from drive_evidence_success_result),'1.5 in','saved specification is returned');
select is((select payload->'row'->>'loc_match_qty' from drive_evidence_success_result),'76','verified location match quantity is returned');
select ok((select (payload->'row'->>'av_rule_photo_updated_at')::timestamptz is not null
  and (payload->'row'->>'av_rule_spec_updated_at')::timestamptz is not null
  and (payload->'row'->>'av_rule_bundle_updated_at')::timestamptz is not null
  and (payload->'row'->>'av_rule_photo_updated_at')::timestamptz=(payload->'row'->>'av_rule_spec_updated_at')::timestamptz
  and (payload->'row'->>'av_rule_bundle_updated_at')::timestamptz=(payload->'row'->>'av_rule_photo_updated_at')::timestamptz
  from drive_evidence_success_result),'photo, spec, and bundle freshness timestamps share the committed write time');
select is((private.season_sales_evidence_v1((select payload->'row' from drive_evidence_success_result))->>'ready'),'true','complete current photo, spec, note, and match evidence is AV-ready');

create temporary table drive_evidence_success_replay as
select public.save_drive_evidence_v2(
  'drive-evidence-success','DRIVE.EVIDENCE.SUCCESS','C.12.001','27.F1',
  (select expected_signature from drive_evidence_test_identity where unique_id='drive-evidence-success'), '{}'::jsonb,
  jsonb_build_object(
    'photo_link','https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/location_sales_notes_photos/drive-evidence-success.jpg',
    'photo_name','drive-evidence-success-' || to_char(now() - interval '1 day','YYYY-MM-DD') || '.jpg','spec','1.5 in','av_note','Verified from current photo',
    'match','95','initial_ptr','80','loc_match_qty','76'
  ),
  true,'location','drive-evidence-success-token'
) as payload;
select is((select payload->>'recovered' from drive_evidence_success_replay),'true','same idempotency request replays the persisted result');
select is((select payload->'row'->>'last_updated' from drive_evidence_success_replay),
  (select payload->'row'->>'last_updated' from drive_evidence_success_result),'replay returns the same committed row version');

-- Task completion may be recorded with a photo even when AV match/spec data is
-- absent. That state must remain explicitly unverified rather than fabricated.
create temporary table drive_evidence_no_match_result as
select public.save_drive_evidence_v2(
  'drive-evidence-no-match','DRIVE.EVIDENCE.NO.MATCH','C.12.002','27.F1',
  (select expected_signature from drive_evidence_test_identity where unique_id='drive-evidence-no-match'), '{}'::jsonb,
  jsonb_build_object(
    'photo_link','https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/location_sales_notes_photos/drive-evidence-no-match.jpg',
    'photo_name','drive-evidence-no-match-' || to_char(now() - interval '1 day','YYYY-MM-DD') || '.jpg'
  ),
  true,'location','drive-evidence-no-match-token'
) as payload;
select is((select payload->>'code' from drive_evidence_no_match_result),'SAVED','missing optional match data does not reject task completion');
select is((select payload->>'completed' from drive_evidence_no_match_result),'true','photo-only task completion is reported as completed');
select ok((select payload->'row'->>'match' is null and payload->'row'->>'loc_match_qty' is null
  and payload->'row'->>'spec' is null from drive_evidence_no_match_result),'missing match and specification remain null');
select ok((select payload->'row'->>'date_completed' is not null from drive_evidence_no_match_result),'task completion time is recorded independently of AV readiness');
select is((private.season_sales_evidence_v1((select payload->'row' from drive_evidence_no_match_result))->>'ready'),'false','photo-only completion remains AV-unverified');
select ok((private.season_sales_evidence_v1((select payload->'row' from drive_evidence_no_match_result))->'reasons') @> '["match_missing","spec_missing","loc_match_qty_missing"]'::jsonb,
  'unverified completion reports the missing match, specification, and quantity reasons');

select * from finish();
rollback;
