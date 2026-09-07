-- Disposable local/CI database only. All fixtures and effects roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('94000000-0000-0000-0000-000000000001', 'season-done-test@example.invalid', '{}', '{}'),
       ('94000000-0000-0000-0000-000000000002', 'season-done-unassigned@example.invalid', '{}', '{}');
insert into public.profiles (id, username, display_name, role, must_change_password)
values ('94000000-0000-0000-0000-000000000001', 'season_done_test', 'Season Done Test', 'ADMIN', false),
       ('94000000-0000-0000-0000-000000000002', 'season_done_unassigned', 'Unassigned Test', 'ADMIN', false);
insert into public.ph_app_settings (key, value)
values ('current_season_salesyear', '{"seasonCode":"F1","salesYear":"27"}'),
       ('av_blanks_photo_bypass_users', '{"users":["season_done_test"]}')
on conflict (key) do update set value = excluded.value;

insert into public.ph_master_inventory (
  unique_id, itemcode, commonname, season, saleyear, priority, ptravailable,
  s_lts, app_tab_assignment, locationcode, lotcode, av_note, photo_link, match,
  loc_match_qty, av_rule_bundle_updated_at, end_cap_folder, holdstopcode,
  spec, av_rule_photo_updated_at
)
values
  ('DONE-A', 'DONE-ITEM-A', 'Done A', 'F1', '27', '1', '100', '100', 'season', 'A.01.001', '27.F1', 'SPEC', 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/done-fixture.jpg', '100', '100', now(), null, null, '3-4 ft H', now()),
  ('DONE-A-ALT', 'DONE-ITEM-A', 'Done A', 'F1', '26', '2', '50', '100', 'location', 'A.02.001', '26.F1', 'SPEC', 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/done-fixture-alt.jpg', '100', '50', now(), null, null, '3-4 ft H', now()),
  ('DONE-A-OTHER', 'DONE-ITEM-A', 'Done A', 'U1', '27', '1', '200', '100', '', 'A.03.001', '27.U1', null, null, null, null, null, null, null, null, null),
  ('DONE-A-FLYER', 'DONE-ITEM-A', 'Done A', 'F1', '27', '1', '300', '100', 'flyer', 'A.04.001', '27.F1', null, null, null, null, null, null, null, null, null),
  ('DONE-A-ENDCAP', 'DONE-ITEM-A', 'Done A', 'F1', '27', '1', '400', '100', '', 'A.05.001', '27.F1', null, null, null, null, null, 'DISPLAY', null, null, null),
  ('DONE-A-HOLD', 'DONE-ITEM-A', 'Done A', 'F1', '27', '1', '500', '100', 'location', 'A.06.001', '27.F1', null, null, null, null, null, null, 'H', null, null),
  ('DONE-B', 'DONE-ITEM-B', 'Done B', 'F1', '27', '1', '100', '100', 'season', 'B.01.001', '27.F1', null, null, null, null, null, null, null, null, null),
  ('DONE-C', 'DONE-ITEM-C', 'Done C', 'F1', '27', '1', '100', '100', 'season', 'C.01.001', '27.F1', null, null, null, null, null, null, null, null, null),
  ('DONE-D', 'DONE-ITEM-D', 'Done D', 'F1', '27', '1', '100', '100', 'location', 'D.01.001', '27.F1', null, null, null, null, null, null, null, null, null),
  ('DONE-D-WINNER', 'DONE-ITEM-D', 'Done D', 'F1', '27', '1', '200', '100', 'season', 'D.02.001', '27.F1', null, null, null, null, null, null, null, null, null);

select ok(has_function_privilege('service_role', 'public.complete_season_sales_office_v1(text,text,integer,text)', 'execute'), 'protected API service role can complete');
select ok(not has_function_privilege('anon', 'public.complete_season_sales_office_v1(text,text,integer,text)', 'execute'), 'anonymous callers cannot complete');
select ok(not has_function_privilege('authenticated', 'public.complete_season_sales_office_v1(text,text,integer,text)', 'execute'), 'browsers cannot bypass protected completion API');
select ok(not has_function_privilege('authenticated', 'private.eval_work_apply_request_drive_parity_v1(uuid,text)', 'execute'), 'Eval publishing remains private');
select throws_ok($q$select public.complete_season_sales_office_v1('season_done_unassigned', 'DONE-A', 1, 'done-unassigned-token')$q$,
  '42501', 'SEASON_SALES_USER_NOT_ASSIGNED', 'active but unassigned users cannot complete');

select lives_ok($q$select public.reconcile_season_sales_office_v1(array['DONE-ITEM-A','DONE-ITEM-B'], false, 'done-test-initial', null)$q$, 'initial authoritative reconciliation succeeds');
select is((select winner_unique_id from public.ph_season_sales_office_state where itemcode_normalized = 'DONE-ITEM-A'), 'DONE-A', 'shared rules select ordinary highest-available eligible winner');
select is((select workflow_status from public.ph_sales_office where unique_id = 'DONE-B'), 'needs_photo_data', 'missing-evidence rows are eligible staged work');

insert into public.ph_sales_office (unique_id, master_id, itemcode, so_source)
values ('DONE-A-FLYER-ALIAS', 'DONE-A', 'DONE-ITEM-A', 'flyer_folder'),
       ('DONE-A-EMPTY-ALIAS', 'DONE-A', 'DONE-ITEM-A', ''),
       ('DONE-A-NULL-ALIAS', 'DONE-A', 'DONE-ITEM-A', null),
       ('DONE-A-BLOOM', 'DONE-A', 'DONE-ITEM-A', 'bloom_picker'),
       ('DONE-A-MOVE', 'DONE-A', 'DONE-ITEM-A', 'move'),
       ('DONE-A-MOVES', 'DONE-A', 'DONE-ITEM-A', 'moves');
insert into public.ph_sales_office (unique_id, master_id, itemcode, so_source, order_folder)
values ('DONE-A-BLOOM-HYPHEN', 'DONE-A', 'DONE-ITEM-A', 'bloom-picker', null),
       ('DONE-A-ORDER-ALIAS', 'DONE-A', 'DONE-ITEM-A', 'season', 'TEST-BLOOM-ORDER');

create temporary table season_done_results (name text primary key, response jsonb) on commit drop;
insert into season_done_results values ('first', public.complete_season_sales_office_v1('season_done_test', 'DONE-A', 1, 'done-a-first-token'));
select is((select response->>'status' from season_done_results where name = 'first'), 'done', 'Done acknowledges a committed completion');
select is((select status || ':' || revision from public.ph_season_sales_office_state where itemcode_normalized = 'DONE-ITEM-A'), 'done:2', 'Done persists durable state and increments revision once');
select is((select count(*)::integer from public.ph_sales_office where master_id = 'DONE-A' and coalesce(so_source, '') not in ('bloom_picker','bloom-picker','move','moves') and coalesce(order_folder, '')=''), 0, 'Done atomically removes canonical and legacy Season-view aliases');
select is((select jsonb_array_length(response->'removedMirrorIds') from season_done_results where name = 'first'), 4, 'acknowledgment identifies all removed mirror aliases');
select is((select count(*)::integer from public.ph_sales_office where master_id = 'DONE-A'), 5, 'both Bloom spellings, legacy order aliases, and both Move spellings survive Done');
select is((select count(*)::integer from public.ph_master_inventory where itemcode = 'DONE-ITEM-A'), 6, 'Done never deletes master inventory');
select ok((select completed_evidence_snapshot->>'ready' = 'true' and completed_at is not null from public.ph_season_sales_office_state where itemcode_normalized = 'DONE-ITEM-A'), 'completion preserves evidence snapshot and completion time');

insert into public.ph_sales_office (unique_id, master_id, itemcode, so_source)
values ('DONE-A-STRAY-1', 'DONE-A', 'DONE-ITEM-A', 'season');
select is(public.complete_season_sales_office_v1('season_done_test', 'DONE-A', 1, 'done-a-second-token')->>'status', 'already_done', 'a second acknowledgment recognizes durable Done');
select is((select count(*)::integer from public.ph_sales_office where unique_id = 'DONE-A-STRAY-1'), 0, 'already_done cleans a stray mirror');
insert into public.ph_sales_office (unique_id, master_id, itemcode, so_source)
values ('DONE-A-STRAY-2', 'DONE-A', 'DONE-ITEM-A', 'flyer_folder');
select is(public.complete_season_sales_office_v1('season_done_test', 'DONE-A', 1, 'done-a-first-token')->>'idempotentReplay', 'true', 'lost-response retry reuses original acknowledgment');
select is((select count(*)::integer from public.ph_sales_office where unique_id = 'DONE-A-STRAY-2'), 0, 'idempotent acknowledgment also repairs stale aliases');
select is((select count(*)::integer from public.ph_season_sales_office_events e join public.ph_season_sales_office_state s on s.id=e.state_id where s.itemcode_normalized='DONE-ITEM-A' and e.event_type='completed'), 1, 'double taps and retries create one completion event');
select throws_ok($q$select public.complete_season_sales_office_v1('season_done_test', 'DONE-A', 2, 'done-a-first-token')$q$,
  '22023', 'SEASON_SALES_TOKEN_CONFLICT', 'a reused token cannot target a different expected revision');

select lives_ok($q$select public.reconcile_season_sales_office_v1(array['DONE-ITEM-A'], false, 'unchanged-import', null)$q$, 'unchanged import reconciles successfully');
select is((select status from public.ph_season_sales_office_state where itemcode_normalized='DONE-ITEM-A'), 'done', 'unchanged import does not reopen Done');
select is((select count(*)::integer from public.ph_sales_office where unique_id='DONE-A'), 0, 'unchanged import does not restore the removed card');

insert into public.ph_eval_work (
  id, create_token, creator_username, creator_display, assignee_username,
  assignee_display, assignee_email, completion_recipients, itemcode,
  origin_unique_id, inventory_signature, settings_signature, source_context,
  assignee_usernames, assignee_profiles
) values (
  '94000000-0000-0000-0000-000000000010', 'done-eval-fixture', 'season_done_test', 'Test',
  'season_done_test', 'Test', 'season-done-test@example.invalid', array['test@example.invalid'],
  'DONE-ITEM-A', 'DONE-A', 'fixture', 'fixture', '{"scopeContract":"itemcode-all-rows-v1"}',
  array['season_done_test'], '[{"username":"season_done_test","display":"Test","email":"season-done-test@example.invalid"}]'
);
insert into public.ph_eval_work_origin_rows (eval_work_id, origin_unique_id, itemcode, ordinal, origin_snapshot)
values ('94000000-0000-0000-0000-000000000010', 'DONE-A', 'DONE-ITEM-A', 1, '{}');
select lives_ok($q$select private.eval_work_apply_request_drive_parity_v1('94000000-0000-0000-0000-000000000010', 'season_done_test')$q$, 'Eval publishes through authoritative scoped lifecycle');
select is((select status from public.ph_season_sales_office_state where itemcode_normalized='DONE-ITEM-A'), 'done', 'unchanged Eval evidence does not override Done');
select is((select count(*)::integer from public.ph_sales_office where unique_id='DONE-A'), 0, 'Eval cannot directly reinsert the completed card');
select is((select app_tab_assignment from public.ph_master_inventory where unique_id='DONE-A-OTHER'), 'location', 'Eval preserves ordinary other-season Location classification');
select is((select app_tab_assignment from public.ph_master_inventory where unique_id='DONE-A-FLYER'), 'flyer', 'Eval preserves protected assignments');
select is((select app_tab_assignment from public.ph_master_inventory where unique_id='DONE-A-ENDCAP'), 'endcap', 'Eval preserves endcap classification');

select is(public.complete_season_sales_office_v1('season_done_test', 'DONE-B', 1, 'done-b-first-token')->>'status', 'done', 'Done also works on needs-photo-data rows');
insert into public.ph_sales_office (unique_id, master_id, itemcode, so_source)
values ('DONE-C-LEGACY', 'DONE-C', 'DONE-ITEM-C', 'flyer_folder');
select is(public.complete_season_sales_office_v1('season_done_test', 'DONE-C', 1, 'done-c-legacy-token')->>'status', 'done', 'legacy mirror bootstraps only its linked ITEMCODE lifecycle');
select is((select count(*)::integer from public.ph_sales_office where master_id='DONE-C'), 0, 'legacy mirror disappears after canonical completion');
select throws_ok($q$select public.complete_season_sales_office_v1('season_done_test', 'DONE-D', 1, 'done-d-wrong-winner-token')$q$,
  '40001', 'SEASON_SALES_WINNER_CHANGED', 'legacy row cannot complete a different deterministic winner');
select is((select count(*)::integer from public.ph_season_sales_office_state where itemcode_normalized='DONE-ITEM-D'), 0, 'failed legacy completion rolls back its attempted staging changes');

insert into public.ph_cav_import (unique_id, itemcode, season, holdstopreason, last_updated)
values ('DONE-CAV-A', 'DONE-ITEM-A', 'F1', '', now() + interval '1 second');
select lives_ok($q$select public.reconcile_season_sales_office_v1(array['DONE-ITEM-A'], false, 'new-blank-cav', null)$q$, 'a newer blank Custom AV import reconciles');
select is((select status || ':' || revision || ':' || reopen_reason from public.ph_season_sales_office_state where itemcode_normalized='DONE-ITEM-A'), 'open:3:cav_blank', 'the existing newer-blank rule reopens Done');
select throws_ok($q$select public.complete_season_sales_office_v1('season_done_test', 'DONE-A', 1, 'done-a-first-token')$q$,
  '40001', 'SEASON_SALES_STALE_REVISION', 'late lost-response replay cannot acknowledge a reopened revision');
select is((select state_revision from public.ph_sales_office where unique_id='DONE-A'), 3, 'late retry leaves the legitimately reopened mirror visible');
select throws_ok($q$select public.complete_season_sales_office_v1('season_done_test', 'DONE-A', 1, 'done-a-stale-new-token')$q$,
  '40001', 'SEASON_SALES_STALE_REVISION', 'a stale new completion cannot finish reopened work');
select is(public.complete_season_sales_office_v1('season_done_test', 'DONE-A', 3, 'done-a-reopened-token')->>'status', 'done', 'current revision can explicitly complete reopened work');
update public.ph_cav_import set holdstopreason='SPEC', last_updated=now()+interval '2 seconds' where unique_id='DONE-CAV-A';
select lives_ok($q$select public.reconcile_season_sales_office_v1(array['DONE-ITEM-A'], false, 'new-nonblank-cav', null)$q$, 'a newer nonblank import reconciles');
select is((select status from public.ph_season_sales_office_state where itemcode_normalized='DONE-ITEM-A'), 'done', 'a nonblank Custom AV import does not reopen Done');

update public.ph_master_inventory set photo_link='' where unique_id='DONE-A';
select lives_ok($q$select public.reconcile_season_sales_office_v1(array['DONE-ITEM-A'], false, 'evidence-invalid', null)$q$, 'invalid evidence reconciles');
select is((select status || ':' || revision || ':' || reopen_reason from public.ph_season_sales_office_state where itemcode_normalized='DONE-ITEM-A'), 'open:5:evidence_invalid', 'the existing ready-to-invalid rule reopens Done');
select is(public.complete_season_sales_office_v1('season_done_test', 'DONE-A', 5, 'done-a-incomplete-token')->>'status', 'done', 'reopened incomplete-evidence work can be acknowledged');
update public.ph_master_inventory set photo_link='https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/done-fixture.jpg', av_rule_photo_updated_at=now() where unique_id='DONE-A';
select lives_ok($q$select public.reconcile_season_sales_office_v1(array['DONE-ITEM-A'], false, 'evidence-ready-again', null)$q$, 'restored evidence reconciles without forced reopening');
select ok((select status='done' and evidence_ready_seen_after_completion from public.ph_season_sales_office_state where itemcode_normalized='DONE-ITEM-A'), 'readiness achieved after Done is tracked without reopening');
update public.ph_master_inventory set photo_link='' where unique_id='DONE-A';
select lives_ok($q$select public.reconcile_season_sales_office_v1(array['DONE-ITEM-A'], false, 'later-evidence-invalid', null)$q$, 'a later invalidation reconciles');
select is((select status || ':' || revision from public.ph_season_sales_office_state where itemcode_normalized='DONE-ITEM-A'), 'open:7', 'ready-seen-after-completion rule still reopens invalidated evidence');
select is(public.complete_season_sales_office_v1('season_done_test', 'DONE-A', 7, 'done-a-final-token')->>'status', 'done', 'latest revision completes before winner change');
update public.ph_master_inventory set ptravailable='200' where unique_id='DONE-A-ALT';
select lives_ok($q$select public.reconcile_season_sales_office_v1(array['DONE-ITEM-A'], false, 'winner-changed', null)$q$, 'new deterministic winner reconciles');
select is((select status || ':' || revision || ':' || winner_unique_id from public.ph_season_sales_office_state where itemcode_normalized='DONE-ITEM-A'), 'open:9:DONE-A-ALT', 'winner changes retain their existing reopening rule');
select throws_ok($q$select public.complete_season_sales_office_v1('season_done_test', 'DONE-A', 7, 'done-a-final-token')$q$,
  '40001', 'SEASON_SALES_STALE_REVISION', 'old-winner replay cannot affect new-winner work');
select is((select count(*)::integer from public.ph_sales_office where unique_id='DONE-A-ALT'), 1, 'new-winner card survives old completion replay');
select throws_ok($q$update public.ph_season_sales_office_events set metadata='{}' where state_id=(select id from public.ph_season_sales_office_state where itemcode_normalized='DONE-ITEM-A')$q$,
  '42501', 'SEASON_SALES_AUDIT_APPEND_ONLY', 'completion and reopening history remains append-only');

update public.profiles set disabled_at=now() where username='season_done_test';
select throws_ok($q$select public.complete_season_sales_office_v1('season_done_test', 'DONE-A-ALT', 9, 'done-disabled-token')$q$,
  '42501', 'SEASON_SALES_PROFILE_NOT_ACTIVE', 'inactive sessions cannot finish work');

select * from finish();
rollback;
