-- @test-runtime: sql-rollback
-- Production-safe rollback canary: no inventory, work or email survives.
begin;
-- Transaction-owned identities and source rows for the rollback-only exercise.
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('ab000001-0000-4000-8000-000000000001', 'rollback-dylan@example.invalid', now(), '{}'::jsonb, '{}'::jsonb),
  ('ab000001-0000-4000-8000-000000000002', 'rollback-megan@example.invalid', now(), '{}'::jsonb, '{}'::jsonb),
  ('ab000001-0000-4000-8000-000000000003', 'rollback-sharon@example.invalid', now(), '{}'::jsonb, '{}'::jsonb)
on conflict (id) do update set email=excluded.email, email_confirmed_at=excluded.email_confirmed_at,
  raw_app_meta_data=excluded.raw_app_meta_data, raw_user_meta_data=excluded.raw_user_meta_data;
insert into public.profiles (id, username, display_name, role, must_change_password) values
  ('ab000001-0000-4000-8000-000000000001', 'dylan_collyge', 'Rollback Dylan', 'ADMIN', false),
  ('ab000001-0000-4000-8000-000000000002', 'megan_kelly', 'Rollback Megan', 'ADMIN', false),
  ('ab000001-0000-4000-8000-000000000003', 'sharon_combs', 'Rollback Sharon', 'USER', false)
on conflict (id) do update set username=excluded.username, display_name=excluded.display_name,
  role=excluded.role, disabled_at=null, locked_until=null, must_change_password=false;
insert into public.ph_app_settings (key, value)
values ('current_season_salesyear', '{"seasonCode":"F1","salesYear":"27"}'::jsonb)
on conflict (key) do update set value=excluded.value, updated_at=now();
insert into public.ph_master_inventory
  (unique_id, itemcode, commonname, contsize, locationcode, lotcode, source, season, saleyear,
   ptravailable, ptronhand, priority, s_lts)
values
  ('rollback-eval-origin-1', 'ROLLBACK-EVAL-001', 'Rollback Fixture Plant One', '#1', 'A.01.001', 'R-1', 'fixture', 'U1', '27', '10', '10', null, '10'),
  ('rollback-eval-origin-2', 'ROLLBACK-EVAL-002', 'Rollback Fixture Plant Two', '#1', 'A.01.002', 'R-2', 'fixture', 'U1', '27', '10', '10', null, '10');
insert into public.ph_eval_work
  (create_token, creator_username, creator_display, assignee_username, assignee_display,
   assignee_email, completion_recipients, itemcode, commonname, contsize, origin_unique_id,
   origin_snapshot, context_rows, inventory_signature, settings_signature, source_context,
   origin_count, assignee_usernames, assignee_profiles)
values
  ('rollback-eval-existing-1', 'dylan_collyge', 'Rollback Dylan', 'dylan_collyge', 'Rollback Dylan',
   'rollback-dylan@example.invalid', array['rollback-dylan@example.invalid'], 'ROLLBACK-EVAL-001',
   'Rollback Fixture Plant One', '#1', 'rollback-eval-origin-1', '{}', '[]', 'fixture-signature',
   'fixture-settings', '{"report":{"reportId":"u1","reportIds":["u1"],"sourceMode":"eval-report-2"}}',
   1, array['dylan_collyge'], '[{"username":"dylan_collyge","display":"Rollback Dylan","email":"rollback-dylan@example.invalid"}]'::jsonb),
  ('rollback-eval-existing-2', 'dylan_collyge', 'Rollback Dylan', 'dylan_collyge', 'Rollback Dylan',
   'rollback-dylan@example.invalid', array['rollback-dylan@example.invalid'], 'ROLLBACK-EVAL-002',
   'Rollback Fixture Plant Two', '#1', 'rollback-eval-origin-2', '{}', '[]', 'fixture-signature',
   'fixture-settings', '{"report":{"reportId":"u1","reportIds":["u1"],"sourceMode":"eval-report-2"}}',
   1, array['dylan_collyge'], '[{"username":"dylan_collyge","display":"Rollback Dylan","email":"rollback-dylan@example.invalid"}]'::jsonb);
set local statement_timeout = '25s';
select set_config('request.jwt.claim.role','service_role',true);
do $test$
declare
  context jsonb := '{"reportIds":["s1-with-pri","u1","u2","u3","od-loc-note-date","hs-plus-5-days","get-off-hold","low-stock","no-pri","culls","not-in-f1"]}';
  item public.ph_eval_work;
  items jsonb := '[]';
  token text := 'eval-multi-rollback-' || gen_random_uuid()::text;
  payload jsonb;
  result jsonb;
  replay jsonb;
  email text;
  work_count integer;
  events_before integer;
  dry_result jsonb;
begin
  if private.eval_report2_context_ids_v1('{"reportId":" U1 "}') <> array['u1']
    or private.eval_report2_context_ids_v1('{"reportIds":[" U2 ","u1","u2"]}') <> array['u1','u2'] then
    raise exception 'normalization failed';
  end if;
  begin
    perform private.eval_report2_context_ids_v1('{"reportIds":["u1","unknown"]}');
    raise exception 'invalid report accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform private.eval_report2_context_ids_v1('{"reportIds":[]}');
    raise exception 'empty reports accepted';
  exception when invalid_parameter_value then null;
  end;
  if has_function_privilege('anon','public.create_eval_report2_batch_v1(jsonb)','execute')
    or has_function_privilege('authenticated','public.create_eval_report2_batch_v1(jsonb)','execute')
    or has_function_privilege('authenticated','public.reconcile_eval_report2_work_v1(text,boolean,integer)','execute')
    then raise exception 'grants widened'; end if;
  for item in select distinct on (w.itemcode) w.* from public.ph_eval_work w
    where w.source_context#>>'{report,sourceMode}'='eval-report-2'
      and cardinality(private.eval_report2_matching_reports_v1(context,w.itemcode)) > 0
    order by w.itemcode, w.created_at desc limit 2
  loop
    items := items || jsonb_build_array(jsonb_build_object(
      'itemcode',item.itemcode,'createToken',token || ':' || item.itemcode,
      'inquiry', item.inquiry_draft,
      'reportContext',context || jsonb_build_object('sourceMode','eval-report-2','selectedUserFilters',jsonb_build_array('all_users')),
      'source',jsonb_build_object('unique_id',item.origin_unique_id,'itemcode',item.itemcode)
    ));
  end loop;
  if jsonb_array_length(items) <> 2 then raise exception 'need two fixtures'; end if;
  email := (private.eval_report2_verified_user_emails_v1(array['dylan_collyge']))[1];
  payload := jsonb_build_object('actorUsername','dylan_collyge','batchToken',token,'items',items,
    'instructions','ROLLBACK ONLY multi-report canary','assignees',jsonb_build_array(jsonb_build_object('username','dylan_collyge','email',email)));
  result := public.create_eval_report2_batch_v1(payload);
  if jsonb_array_length(result->'rows') <> 2 then raise exception 'batch count failed'; end if;
  select count(distinct assignment_event_id) into work_count from public.ph_eval_work where batch_token=token;
  if work_count <> 1 then raise exception 'batch email not grouped'; end if;
  if exists(select 1 from public.ph_eval_work w where batch_token=token and
    (w.source_context#>'{report,reportIds}' is distinct from to_jsonb(private.eval_report2_matching_reports_v1(context,w.itemcode))
    or w.origin_count <> jsonb_array_length(private.eval_work_itemcode_context_rows_v1(w.itemcode)))) then
    raise exception 'report membership or origins incomplete'; end if;
  if exists(select 1 from public.ph_request_delivery_outbox o join public.ph_eval_work w on w.assignment_event_id=o.event_id
    where w.batch_token=token and (o.payload->>'contractVersion' <> 'eval-work-assignment-batch-v1'
      or jsonb_array_length(o.payload->'assignments')<>2
      or o.payload->'assignmentRecipients' ? (private.eval_report2_verified_user_emails_v1(array['sharon_combs']))[1])) then
    raise exception 'assignment delivery contract changed'; end if;
  replay := public.create_eval_report2_batch_v1(payload);
  select count(*) into work_count from public.ph_eval_work where batch_token=token;
  if work_count <> 2 or replay->'rows'->0->>'id' <> result->'rows'->0->>'id' then raise exception 'replay duplicated work'; end if;
  select count(*) into events_before from public.ph_request_delivery_outbox;
  dry_result := public.reconcile_eval_report2_work_v1('eval-multi-test',true,100);
  if events_before <> (select count(*) from public.ph_request_delivery_outbox) then raise exception 'dry run queued email'; end if;
end
$test$;
select 'passed: normalization, invalid IDs, grants, two ITEMCODEs, all origins, matched report IDs, one email/two PDFs, no Sharon initial, replay, silent dry-run' as result;
rollback;
