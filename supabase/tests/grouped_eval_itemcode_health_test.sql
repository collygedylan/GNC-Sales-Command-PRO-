-- Disposable composed local/CI database only; all fixtures roll back.
-- Direct TAP plus SQL assertions runs identically in pg_prove and PGlite.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temporary table grouped_health_checks(id integer generated always as identity, description text) on commit drop;
create temporary table grouped_health_fixture(kind text primary key, value jsonb) on commit drop;
create function pg_temp.health_check(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'Grouped health regression: %', description; end if;
  insert into grouped_health_checks(description) values(description);
end $$;
insert into grouped_health_fixture values('before', public.get_eval_itemcode_work_health_snapshot_v2());

-- Generate real single assignment payloads/frozen rows, then use the actual
-- grouping function to produce the envelope (not a hand-written happy path).
create function pg_temp.seed_health_work(work_id uuid, label text, batch text)
returns void language plpgsql as $$
declare
  origins jsonb;
  signature text;
  member jsonb;
  event uuid;
begin
  origins := jsonb_build_array(
    jsonb_build_object('unique_id', label || '-1', 'itemcode', label, 'locationcode', 'A.1', 'lotcode', '27.F1', 'source', 'PH', 'ptronhand', '10'),
    jsonb_build_object('unique_id', label || '-2', 'itemcode', label, 'locationcode', 'A.2', 'lotcode', '27.F1', 'source', 'PH', 'ptronhand', '20'));
  signature := private.eval_work_membership_signature_v1(origins);
  insert into public.ph_eval_work(id,create_token,contract_version,creator_username,creator_display,
    assignee_username,assignee_display,assignee_email,completion_recipients,itemcode,
    origin_unique_id,origin_locationcode,origin_lotcode,origin_source,origin_snapshot,context_rows,
    inventory_signature,settings_signature,origin_count,source_context,batch_token,assignee_usernames,assignee_profiles)
  values(work_id,'grouped-health-' || work_id,'eval-work-v2-multi-origin','health_test','Health Test',
    'health_eval','Health Eval','health-eval@example.invalid',array['health-manager@example.invalid'],label,
    label || '-1','A.1','27.F1','PH',origins->0,origins,signature,'synthetic-settings',2,
    jsonb_build_object('scopeContract','itemcode-all-rows-v1','membershipCount',2,'membershipSignature',signature),batch,
    array['health_eval'],jsonb_build_array(jsonb_build_object('username','health_eval','display','Health Eval','email','health-eval@example.invalid')));
  insert into public.ph_eval_work_origin_rows(eval_work_id,origin_unique_id,itemcode,locationcode,lotcode,source,ordinal,origin_snapshot)
  select work_id,origin->>'unique_id',label,origin->>'locationcode',origin->>'lotcode',origin->>'source',ordinality::integer,origin
  from jsonb_array_elements(origins) with ordinality selected(origin,ordinality);
  member := jsonb_build_object('contractVersion','eval-work-v2-multi-origin','scopeContract','itemcode-all-rows-v1',
    'membershipCount',2,'membershipSignature',signature,'deliveryKind','assignment','evalWorkId',work_id,
    'assignmentRecipients',jsonb_build_array('health-eval@example.invalid'),
    'source',jsonb_build_object('unique_id',label || '-1','itemcode',label,'locationcode','A.1','lotcode','27.F1','source_table','ph_master_inventory'),
    'origins',origins);
  insert into public.ph_request_delivery_outbox(event_key,event_type,request_id,payload,status)
  values('grouped-health-single:' || work_id,'eval_work_assignment',work_id::text,member,'pending') returning event_id into event;
  update public.ph_eval_work set assignment_event_id=event where id=work_id;
end $$;
select pg_temp.seed_health_work('97000000-0000-4000-8000-000000000001','HEALTH-A','grouped-health-batch-001');
select pg_temp.seed_health_work('97000000-0000-4000-8000-000000000002','HEALTH-B','grouped-health-batch-001');
select pg_temp.seed_health_work('97000000-0000-4000-8000-000000000003','HEALTH-C','grouped-health-batch-001');
select pg_temp.seed_health_work('97000000-0000-4000-8000-000000000004','HEALTH-FOREIGN','grouped-health-foreign');
select private.eval_report2_group_assignment_delivery_v1(
  (select jsonb_agg(to_jsonb(work) order by id) from public.ph_eval_work work where batch_token='grouped-health-batch-001'),
  'grouped-health-batch-001') is not null as grouped_fixture_created;
insert into grouped_health_fixture
select 'group',to_jsonb(delivery) from public.ph_request_delivery_outbox delivery
where event_key='eval-report2-batch:' || md5('grouped-health-batch-001') || ':assignment:v1';
insert into grouped_health_fixture
select 'foreign',payload from public.ph_request_delivery_outbox where event_key='grouped-health-single:97000000-0000-4000-8000-000000000004';

create function pg_temp.expect_bad_group(payload_value jsonb, description text)
returns void language plpgsql as $$
declare
  baseline jsonb;
  original jsonb;
begin
  select value into baseline from grouped_health_fixture where kind='before';
  select value into original from grouped_health_fixture where kind='group';
  update public.ph_request_delivery_outbox set payload=payload_value where event_id=(original->>'event_id')::uuid;
  perform pg_temp.health_check((public.get_eval_itemcode_work_health_snapshot_v2()->>'pdf_origin_mismatch_count')::integer
    = (baseline->>'pdf_origin_mismatch_count')::integer+1,description);
  update public.ph_request_delivery_outbox set payload=original->'payload' where event_id=(original->>'event_id')::uuid;
end $$;

do $test$
declare
  original jsonb := (select value from grouped_health_fixture where kind='group');
  payload jsonb := original->'payload';
  baseline jsonb := (select value from grouped_health_fixture where kind='before');
  foreign_member jsonb := (select value from grouped_health_fixture where kind='foreign');
  snapshot jsonb;
  malformed jsonb;
  changed jsonb;
  old_sources jsonb;
begin
  snapshot := public.get_eval_itemcode_work_health_snapshot_v2();
  perform pg_temp.health_check(snapshot->>'contract_version'='eval-itemcode-work-health-v2' and snapshot->>'scope_contract'='itemcode-all-rows-v1','public contract names remain compatible');
  perform pg_temp.health_check(snapshot->>'pdf_origin_mismatch_count'=baseline->>'pdf_origin_mismatch_count','real grouped three plus valid singleton pass');
  perform pg_temp.health_check(snapshot->>'stored_membership_mismatch_count'=baseline->>'stored_membership_mismatch_count','frozen stored membership remains healthy');
  perform pg_temp.health_check((payload->>'assignmentCount')::integer=3 and jsonb_array_length(payload->'assignments')=3,'actual generator emitted all three members');
  perform pg_temp.health_check((select count(*)=3 from public.ph_request_delivery_outbox where request_id in
    ('97000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000003') and status='suppressed'),'generator suppression is preserved');
  perform pg_temp.health_check((select provolatile='s' and prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.get_eval_itemcode_work_health_snapshot_v2()'::regprocedure),'health remains stable definer with empty search path');
  perform pg_temp.health_check(has_function_privilege('service_role','public.get_eval_itemcode_work_health_snapshot_v2()','execute'),'service health access preserved');
  perform pg_temp.health_check(not has_function_privilege('anon','public.get_eval_itemcode_work_health_snapshot_v2()','execute') and not has_function_privilege('authenticated','public.get_eval_itemcode_work_health_snapshot_v2()','execute'),'anonymous and browser health access remain denied');
  perform pg_temp.health_check(not has_function_privilege('authenticated','private.eval_itemcode_health_member_valid_v1(jsonb)','execute') and not has_function_privilege('anon','private.eval_itemcode_health_group_valid_v1(jsonb,text,text)','execute'),'new helpers are not browser endpoints');

  foreach malformed in array array['null'::jsonb,'{}'::jsonb,'"bad"'::jsonb,'2'::jsonb] loop
    perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments}',malformed),'malformed assignments shape fails without throwing');
    perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0}',malformed),'malformed member fails without throwing');
    perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,origins}',malformed),'malformed origins shape fails without throwing');
    perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,origins,0}',malformed),'malformed origin fails without throwing');
  end loop;
  foreach malformed in array array['null'::jsonb,'"3"'::jsonb,'3.5'::jsonb,'-3'::jsonb,'1000000000000000000000000'::jsonb,'{}'::jsonb] loop
    perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignmentCount}',malformed),'invalid group count fails without throwing');
    perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,membershipCount}',malformed),'invalid member count fails without throwing');
  end loop;
  perform pg_temp.expect_bad_group(payload-'assignmentCount','missing assignmentCount fails');
  perform pg_temp.expect_bad_group(payload-'evalWorkIds','missing evalWorkIds fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{evalWorkIds,0}','7'::jsonb),'nonstring declared ID fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,evalWorkId}','7'::jsonb),'nonstring nested ID fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,1}',payload#>'{assignments,0}'),'duplicate nested work fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{evalWorkIds,1}',payload#>'{evalWorkIds,0}'),'duplicate declared work fails');
  changed := jsonb_set(jsonb_set(jsonb_set(payload,'{assignments}',(payload->'assignments')-2),'{evalWorkIds}',(payload->'evalWorkIds')-2),'{assignmentCount}','2');
  perform pg_temp.expect_bad_group(changed,'dropping a persisted member from both arrays and count fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,evalWorkId}','"97000000-0000-4000-8000-000000000099"'::jsonb),'nonexistent work fails');
  changed := jsonb_set(jsonb_set(payload,'{assignments,0}',foreign_member),'{evalWorkIds,0}',foreign_member->'evalWorkId');
  perform pg_temp.expect_bad_group(changed,'valid foreign work swapped into both arrays fails batch provenance');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,scopeContract}','"unknown"'::jsonb),'wrong nested scope fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,membershipSignature}','"forged"'::jsonb),'forged signature fails');
  perform pg_temp.expect_bad_group(payload#-'{assignments,0,membershipSignature}','missing signature fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,origins,1}',payload#>'{assignments,0,origins,0}'),'duplicate origin at same length fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,origins,0,unique_id}','"FOREIGN-ORIGIN"'::jsonb),'foreign origin at same length fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,origins}',jsonb_build_array(payload#>'{assignments,0,origins,0}')),'missing origin fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,origins,0,locationcode}','"WRONG"'::jsonb),'frozen origin identity mutation fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,origins,0,ptronhand}','"999"'::jsonb),'frozen quantity mutation fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{assignments,0,source,unique_id}','"FOREIGN-ORIGIN"'::jsonb),'foreign PDF source fails despite valid origins');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{contractVersion}','"unknown-batch-version"'::jsonb),'unknown grouped contract fails');
  perform pg_temp.expect_bad_group(jsonb_set(payload,'{contractVersion}','"eval-work-v2-multi-origin"'::jsonb),'group marker cannot masquerade as singleton');

  update public.ph_request_delivery_outbox set request_id='missing-group-representative' where event_id=(original->>'event_id')::uuid;
  perform pg_temp.health_check((public.get_eval_itemcode_work_health_snapshot_v2()->>'pdf_origin_mismatch_count')::integer=(baseline->>'pdf_origin_mismatch_count')::integer+1,'missing representative cannot remove group from scan');
  update public.ph_request_delivery_outbox set request_id=original->>'request_id',event_key='wrong-batch-key' where event_id=(original->>'event_id')::uuid;
  perform pg_temp.health_check((public.get_eval_itemcode_work_health_snapshot_v2()->>'pdf_origin_mismatch_count')::integer=(baseline->>'pdf_origin_mismatch_count')::integer+1,'wrong envelope key fails provenance');
  update public.ph_request_delivery_outbox set event_key=original->>'event_key' where event_id=(original->>'event_id')::uuid;
  select source_context into old_sources from public.ph_eval_work where id='97000000-0000-4000-8000-000000000001';
  foreach malformed in array array['"oops"'::jsonb,'{}'::jsonb,'1000000000000000000000000'::jsonb] loop
    update public.ph_eval_work set source_context=jsonb_set(old_sources,'{membershipCount}',malformed) where id='97000000-0000-4000-8000-000000000001';
    snapshot:=public.get_eval_itemcode_work_health_snapshot_v2();
    perform pg_temp.health_check((snapshot->>'stored_membership_mismatch_count')::integer=(baseline->>'stored_membership_mismatch_count')::integer+1 and (snapshot->>'pdf_origin_mismatch_count')::integer=(baseline->>'pdf_origin_mismatch_count')::integer+1,'malformed stored count reports mismatches instead of throwing');
  end loop;
  update public.ph_eval_work set source_context=old_sources where id='97000000-0000-4000-8000-000000000001';

  -- A valid historical envelope remains valid when today's edit/draft pointers
  -- differ. Only frozen creation evidence is the health reference.
  update public.ph_eval_work set assignment_event_id=null,context_rows='[]',inventory_signature='changed-by-later-draft'
    where batch_token='grouped-health-batch-001';
  perform pg_temp.health_check(public.get_eval_itemcode_work_health_snapshot_v2()->>'pdf_origin_mismatch_count'=baseline->>'pdf_origin_mismatch_count','later reassignment and mutable context changes do not invalidate frozen delivery');
  update public.ph_request_delivery_outbox set payload=jsonb_set(original->'payload','{assignments,0,extra}','"excelAttachment"'),status='delivered'
    where event_id=(original->>'event_id')::uuid;
  perform pg_temp.health_check((public.get_eval_itemcode_work_health_snapshot_v2()->>'excel_attachment_violation_count')::integer=(baseline->>'excel_attachment_violation_count')::integer+1,'nested Excel marker remains blocking after delivery');
  update public.ph_request_delivery_outbox set payload=original->'payload' where event_id=(original->>'event_id')::uuid;
  update public.ph_request_delivery_outbox set payload=foreign_member-'scopeContract' where event_key='grouped-health-single:97000000-0000-4000-8000-000000000004';
  perform pg_temp.health_check((public.get_eval_itemcode_work_health_snapshot_v2()->>'pdf_origin_mismatch_count')::integer=(baseline->>'pdf_origin_mismatch_count')::integer+1,'malformed singleton remains blocking');
  update public.ph_request_delivery_outbox set created_at='2026-09-03 18:23:59+00' where event_key='grouped-health-single:97000000-0000-4000-8000-000000000004';
  snapshot:=public.get_eval_itemcode_work_health_snapshot_v2();
  perform pg_temp.health_check(snapshot->>'pdf_origin_mismatch_count'=baseline->>'pdf_origin_mismatch_count' and (snapshot->>'historical_pdf_origin_mismatch_count')::integer=(baseline->>'historical_pdf_origin_mismatch_count')::integer+1,'pre-cutoff mismatch remains nonblocking history');
  update public.ph_request_delivery_outbox set created_at='2026-09-03 18:24:00+00' where event_key='grouped-health-single:97000000-0000-4000-8000-000000000004';
  perform pg_temp.health_check((public.get_eval_itemcode_work_health_snapshot_v2()->>'pdf_origin_mismatch_count')::integer=(baseline->>'pdf_origin_mismatch_count')::integer+1,'cutoff boundary remains inclusive');
  update public.ph_request_delivery_outbox set status='suppressed' where event_key='grouped-health-single:97000000-0000-4000-8000-000000000004';
  perform pg_temp.health_check(public.get_eval_itemcode_work_health_snapshot_v2()->>'pdf_origin_mismatch_count'=baseline->>'pdf_origin_mismatch_count','suppressed payloads remain excluded without history rewrite');
  perform pg_temp.health_check(not private.eval_itemcode_health_group_valid_v1(payload,null,original->>'event_key'),'null representative returns false not null');
end
$test$;

select '1..' || count(*) as tap from grouped_health_checks;
select 'ok ' || id || ' - ' || description as tap from grouped_health_checks order by id;
rollback;
