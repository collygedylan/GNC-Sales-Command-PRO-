-- Disposable local/CI database only. Fixtures and changes roll back.
-- Emit TAP directly so the same behavioral test runs in pg_prove and PGlite.
begin;
create temporary table av_note_checks (id integer generated always as identity, description text) on commit drop;
create function pg_temp.av_note_check(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'AV note regression: %', description; end if;
  insert into av_note_checks(description) values (description);
end $$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('95000000-0000-0000-0000-000000000001', 'av-note-test@example.invalid', '{}', '{}');
insert into public.profiles (id, username, display_name, role, must_change_password)
values ('95000000-0000-0000-0000-000000000001', 'av_note_test', 'AV Note Test', 'ADMIN', false);
insert into public.ph_app_settings (key, value)
values ('current_season_salesyear', '{"seasonCode":"F1","salesYear":"27"}'),
       ('av_blanks_photo_bypass_users', '{"users":["av_note_test"]}')
on conflict (key) do update set value=excluded.value;

insert into public.ph_master_inventory (
  unique_id, itemcode, commonname, season, saleyear, priority, ptravailable,
  s_lts, app_tab_assignment, locationcode, lotcode, av_note, photo_link,
  match, loc_match_qty, spec, av_rule_bundle_updated_at, av_rule_av_note_updated_at, av_rule_photo_updated_at
)
values
  ('AV-KEEP-A','AV-KEEP-ITEM','Retention','F1','27','1','100','100','season','A.01.001','27.F1','User entered 4-5 ft',
   'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/av-note-fixture.jpg','100','100','4-5 ft',now(),now(),now()),
  ('AV-KEEP-B','AV-KEEP-ITEM','Alternate','F1','27','2','50','100','location','A.02.001','27.F1','Alternate winner note',
   'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/av-note-fixture-b.jpg','100','50','4-5 ft',now(),now(),now()),
  ('AV-BLANK','AV-BLANK-ITEM','Intentional blank','F1','27','1','100','100','season','B.01.001','27.F1',null,
   'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/av-note-fixture-c.jpg','100','100','4-5 ft',now(),now(),now());

do $test$
declare
  response jsonb;
  first_arrival timestamptz;
  first_note_at timestamptz;
  expected_revision integer;
begin
  perform pg_temp.av_note_check(has_function_privilege('service_role','public.save_season_sales_office_av_note_v1(text,text,integer,text,text)','EXECUTE'), 'service API may save retained notes');
  perform pg_temp.av_note_check(not has_function_privilege('authenticated','public.save_season_sales_office_av_note_v1(text,text,integer,text,text)','EXECUTE'), 'browser cannot bypass protected save');
  perform pg_temp.av_note_check(not has_function_privilege('anon','public.save_season_sales_office_av_note_v1(text,text,integer,text,text)','EXECUTE'), 'anonymous callers cannot save');
  perform pg_temp.av_note_check(not has_column_privilege('authenticated','public.ph_season_sales_office_state','retained_av_note','UPDATE'), 'browser cannot overwrite retained note directly');
  perform pg_temp.av_note_check(not has_function_privilege('authenticated','private.capture_season_sales_av_note_v1()','EXECUTE'), 'snapshot capture is private');

  perform public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM','AV-BLANK-ITEM'],false,'initial-retention',null);
  select arrived_at into first_arrival from public.ph_sales_office where unique_id='AV-KEEP-A';
  select retained_av_note_at into first_note_at from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM';
  perform pg_temp.av_note_check((select retained_av_note='User entered 4-5 ft' and retained_av_note_at is not null from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM'), 'staging captures the user note');
  perform pg_temp.av_note_check((select av_note='User entered 4-5 ft' from public.ph_sales_office where unique_id='AV-KEEP-A'), 'initial mirror shows the captured note');
  perform pg_temp.av_note_check((select workflow_status='ready_for_custom_av' from public.ph_sales_office where unique_id='AV-KEEP-A'), 'fixture starts with complete valid evidence');
  perform pg_temp.av_note_check((select retained_av_note is null and retained_av_note_at is not null from public.ph_season_sales_office_state where itemcode_normalized='AV-BLANK-ITEM'), 'initial blank is a captured value');

  insert into public.ph_cav_import(unique_id,itemcode,season,holdstopreason,last_updated)
  values ('AV-CAV','AV-KEEP-ITEM','F1','',now()+interval '1 second');
  update public.ph_master_inventory set av_note=null where unique_id in ('AV-KEEP-A','AV-BLANK');
  perform public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM','AV-BLANK-ITEM'],false,'blank-cav',null);
  perform pg_temp.av_note_check((select av_note='User entered 4-5 ft' from public.ph_sales_office where unique_id='AV-KEEP-A'), 'blank CAV and cleared master cannot erase the staged note');
  perform pg_temp.av_note_check((select not (current_evidence_snapshot->'reasons' ? 'av_note_missing') from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM'), 'readiness uses retained note after master clear');
  update public.ph_cav_import set holdstopreason='Different CAV note',last_updated=now()+interval '2 seconds' where unique_id='AV-CAV';
  update public.ph_master_inventory set av_note='Imported master replacement' where unique_id in ('AV-KEEP-A','AV-BLANK');
  perform public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM','AV-BLANK-ITEM'],false,'different-cav',null);
  perform public.refresh_season_sales_office_v1('av_note_test','AV-KEEP-ITEM','repeat-refresh','av-note-refresh-token');
  perform pg_temp.av_note_check((select av_note='User entered 4-5 ft' and arrived_at=first_arrival from public.ph_sales_office where unique_id='AV-KEEP-A'), 'different imports and repeated refresh preserve note and arrival');
  perform pg_temp.av_note_check((select retained_av_note_at=first_note_at and revision=1 from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM'), 'refresh does not count as a user edit');
  perform pg_temp.av_note_check((select av_note is null from public.ph_sales_office where unique_id='AV-BLANK'), 'imported note cannot refill a captured blank');
  perform pg_temp.av_note_check((select av_note='Imported master replacement' from public.ph_master_inventory where unique_id='AV-KEEP-A'), 'retention does not rewrite imported inventory');

  response := public.save_season_sales_office_av_note_v1('av_note_test','AV-KEEP-A',1,'  Revised user note  ','av-note-edit-token');
  perform pg_temp.av_note_check(response->>'avNote'='Revised user note' and response->>'revision'='2', 'protected edit returns the saved note and new revision');
  perform pg_temp.av_note_check((select retained_av_note='Revised user note' from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM'), 'protected edit updates durable note');
  update public.ph_master_inventory set av_note='Another import' where unique_id='AV-KEEP-A';
  perform public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM'],false,'after-edit',null);
  perform pg_temp.av_note_check((select av_note='Revised user note' from public.ph_sales_office where unique_id='AV-KEEP-A'), 'later imports preserve an explicit edit');
  response := public.save_season_sales_office_av_note_v1('av_note_test','AV-KEEP-A',2,'   ','av-note-clear-token');
  perform pg_temp.av_note_check(response->>'avNote'='' and response->>'revision'='3', 'explicit clear is accepted');
  update public.ph_master_inventory set av_note='Import after clear' where unique_id='AV-KEEP-A';
  perform public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM'],false,'after-clear',null);
  perform pg_temp.av_note_check((select retained_av_note is null from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM'), 'explicit blank remains the durable value');
  perform pg_temp.av_note_check((select av_note is null and workflow_detail->'reasons' ? 'av_note_missing' from public.ph_sales_office where unique_id='AV-KEEP-A'), 'explicit blank remains visible and affects readiness');

  perform public.save_season_sales_office_av_note_v1('av_note_test','AV-KEEP-A',3,'Final retained note','av-note-final-token');
  update public.ph_master_inventory set av_note=null where unique_id='AV-KEEP-A';
  response := public.complete_season_sales_office_v1('av_note_test','AV-KEEP-A',4,'av-note-done-token');
  perform pg_temp.av_note_check(response->>'status'='done', 'Done completes with a retained note');
  perform pg_temp.av_note_check((select retained_av_note='Final retained note' and not (completed_evidence_snapshot->'reasons' ? 'av_note_missing') from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM'), 'Done keeps note and evaluates completion from it');
  perform pg_temp.av_note_check((select evidence_ready_at_completion from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM'), 'retained note permits complete evidence despite a cleared master note');
  perform pg_temp.av_note_check(not exists(select 1 from public.ph_sales_office where unique_id='AV-KEEP-A'), 'Done removes the open mirror');
  response := public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM'],true,'done-dry-run',null);
  perform pg_temp.av_note_check(response->>'reopenCount'='0', 'dry run does not treat imported blank as lost retained evidence');
  perform public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM'],false,'done-refresh',null);
  perform pg_temp.av_note_check((select status='done' from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM'), 'unchanged import preserves Done');
  update public.ph_cav_import set holdstopreason='',last_updated=now()+interval '3 seconds' where unique_id='AV-CAV';
  perform public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM'],false,'done-reopen',null);
  perform pg_temp.av_note_check((select status='open' and reopen_reason='cav_blank' and retained_av_note='Final retained note' from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM'), 'new blank CAV retains its existing reopen rule and preserves note');
  perform pg_temp.av_note_check((select av_note='Final retained note' from public.ph_sales_office where unique_id='AV-KEEP-A'), 'reopened mirror recovers retained note after Done');

  select revision into expected_revision from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM';
  perform public.complete_season_sales_office_v1('av_note_test','AV-KEEP-A',expected_revision,'av-note-done-again-token');
  update public.ph_master_inventory set photo_link='' where unique_id='AV-KEEP-A';
  perform public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM'],false,'photo-invalid',null);
  perform pg_temp.av_note_check((select status='open' and reopen_reason='evidence_invalid' from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM'), 'invalid photo still reopens completed work');
  perform pg_temp.av_note_check((select av_note='Final retained note' and workflow_status='reopened_evidence_invalid' from public.ph_sales_office where unique_id='AV-KEEP-A'), 'photo invalidation preserves the staged note');

  update public.ph_master_inventory set ptravailable='200' where unique_id='AV-KEEP-B';
  perform public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM'],false,'new-winner',null);
  perform pg_temp.av_note_check((select winner_unique_id='AV-KEEP-B' and retained_av_note='Alternate winner note' from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM'), 'winner change captures the new winner note');
  perform pg_temp.av_note_check((select av_note='Alternate winner note' from public.ph_sales_office where unique_id='AV-KEEP-B'), 'old winner note never leaks into another winner');

  -- The same inventory row can belong to lifecycle records for multiple sales years.
  update public.ph_app_settings set value='{"seasonCode":"F1","salesYear":"28"}' where key='current_season_salesyear';
  update public.ph_master_inventory set av_note='New sales year note' where unique_id='AV-KEEP-B';
  perform public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM'],false,'new-scope',null);
  perform pg_temp.av_note_check((select retained_av_note='New sales year note' from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM' and sales_year=28), 'new sales scope captures its own note');
  update public.ph_app_settings set value='{"seasonCode":"F1","salesYear":"27"}' where key='current_season_salesyear';
  perform public.reconcile_season_sales_office_v1(array['AV-KEEP-ITEM'],false,'previous-scope',null);
  perform pg_temp.av_note_check((select av_note='Alternate winner note' from public.ph_sales_office where unique_id='AV-KEEP-B'), 'previous sales scope restores its own note');
  select revision into expected_revision from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM' and sales_year=27;
  update public.ph_season_sales_office_state set updated_at=now()+interval '1 day' where itemcode_normalized='AV-KEEP-ITEM' and sales_year=28;
  perform public.save_season_sales_office_av_note_v1('av_note_test','AV-KEEP-B',expected_revision,'Edited prior scope note','av-note-prior-scope-token');
  perform pg_temp.av_note_check((select retained_av_note='Edited prior scope note' from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM' and sales_year=27), 'protected edit targets the current sales scope');
  perform pg_temp.av_note_check((select retained_av_note='New sales year note' from public.ph_season_sales_office_state where itemcode_normalized='AV-KEEP-ITEM' and sales_year=28), 'protected edit preserves another scope for the same winner');
end
$test$;

select 'ok ' || id || ' - ' || description as tap from av_note_checks order by id;
select '1..' || count(*) as tap from av_note_checks;
rollback;
