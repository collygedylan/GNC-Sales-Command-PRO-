-- @test-runtime: sql-rollback
begin;
-- Transaction-owned manager and backup identities for this rollback-only test.
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('ab000001-0000-4000-8000-000000000001', 'rollback-dylan@example.invalid', now(), '{}'::jsonb, '{}'::jsonb),
  ('ab000001-0000-4000-8000-000000000003', 'rollback-sharon@example.invalid', now(), '{}'::jsonb, '{}'::jsonb),
  ('ab000001-0000-4000-8000-000000000004', 'rollback-sunday@example.invalid', now(), '{}'::jsonb, '{}'::jsonb)
on conflict (id) do update set email=excluded.email, email_confirmed_at=excluded.email_confirmed_at,
  raw_app_meta_data=excluded.raw_app_meta_data, raw_user_meta_data=excluded.raw_user_meta_data;
insert into public.profiles (id, username, display_name, role, must_change_password) values
  ('ab000001-0000-4000-8000-000000000001', 'dylan_collyge', 'Rollback Dylan', 'ADMIN', false),
  ('ab000001-0000-4000-8000-000000000003', 'sharon_combs', 'Rollback Sharon', 'USER', false),
  ('ab000001-0000-4000-8000-000000000004', 'sunday_ellis', 'Rollback Sunday', 'USER', false)
on conflict (id) do update set username=excluded.username, display_name=excluded.display_name,
  role=excluded.role, disabled_at=null, locked_until=null, must_change_password=false;
insert into public.ph_item_inquiry_coverage (singleton, sharon_away, revision)
values (true, false, 1)
on conflict (singleton) do update set sharon_away=false, revision=1, updated_by=null, updated_at=now();
-- The catalog is intentionally empty in a fresh replay database. Seed the two
-- permission definitions this canary grants, within the same rollback scope.
insert into private.app_access_permissions
  (permission_key, permission_kind, module_key, label, description, scope_options, sort_order, active)
values
  ('module.managers.view', 'module', 'managers', 'Managers', 'Rollback canary permission', '{}', 0, true),
  ('managers.item_inquiry_coverage.manage', 'action', 'managers', 'Manage item inquiry coverage', 'Rollback canary permission', '{}', 0, true)
on conflict (permission_key) do update set
  permission_kind=excluded.permission_kind, module_key=excluded.module_key, label=excluded.label,
  description=excluded.description, scope_options=excluded.scope_options, sort_order=excluded.sort_order,
  active=excluded.active;
insert into private.app_access_role_grants (policy_id, role_key, permission_key, allowed, access_scope)
select private.resolve_app_access_policy_id_v1(false), 'ADMIN', permission_key, true, 'global'
from (values ('module.managers.view'), ('managers.item_inquiry_coverage.manage')) as fixture(permission_key)
on conflict (policy_id, role_key, permission_key) do update
set allowed=excluded.allowed, access_scope=excluded.access_scope, updated_at=now();
set local statement_timeout='20s';
do $test$
declare
  dylan_id uuid;
  sunday_id uuid;
  state jsonb;
  next_state jsonb;
  token text := 'coverage-rollback-' || gen_random_uuid()::text;
  v_event_key text := 'coverage-rollback-' || gen_random_uuid()::text;
  recipients jsonb;
begin
  select id into dylan_id from public.profiles where lower(username)='dylan_collyge';
  select id into sunday_id from public.profiles where lower(username)='sunday_ellis';
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub',dylan_id::text,true);
  state := public.get_item_inquiry_coverage_v1();
  next_state := public.set_item_inquiry_coverage_v1(true,(state->>'revision')::bigint,token);
  if next_state->>'sharonAway' <> 'true' or next_state->>'backupReady' <> 'true' then
    raise exception 'coverage state not acknowledged';
  end if;
  if public.set_item_inquiry_coverage_v1(true,(state->>'revision')::bigint,token)->>'replayed' <> 'true' then
    raise exception 'idempotent replay failed';
  end if;

  insert into public.ph_request_delivery_outbox(event_key,event_type,payload,status,next_attempt_at)
  values(v_event_key,'reclass_inquiry',jsonb_build_object('reclassPayload',jsonb_build_object(
    'recipientEmails',jsonb_build_array(private.item_inquiry_verified_email_v1('sharon_combs')))),
    'pending',now());
  select payload#>'{reclassPayload,recipientEmails}' into recipients
  from public.ph_request_delivery_outbox where ph_request_delivery_outbox.event_key=v_event_key;
  if not recipients ? private.item_inquiry_verified_email_v1('sharon_combs')
    or not recipients ? private.item_inquiry_verified_email_v1('sunday_ellis') then
    raise exception 'reclass recipients incomplete';
  end if;
  if (select payload#>>'{itemInquiryCoverage,sundayAdded}' from public.ph_request_delivery_outbox where ph_request_delivery_outbox.event_key=v_event_key) <> 'true' then
    raise exception 'coverage snapshot missing';
  end if;

  insert into public.ph_request_delivery_outbox(event_key,event_type,payload,status,next_attempt_at)
  values(v_event_key||'-completion','eval_work_completion',jsonb_build_object(
    'completionRecipients',jsonb_build_array(private.item_inquiry_verified_email_v1('sharon_combs'))),
    'pending',now());
  select payload->'completionRecipients' into recipients from public.ph_request_delivery_outbox
    where ph_request_delivery_outbox.event_key=v_event_key||'-completion';
  if not recipients ? private.item_inquiry_verified_email_v1('sunday_ellis') then
    raise exception 'completion recipient coverage missing';
  end if;

  insert into public.ph_request_delivery_outbox(event_key,event_type,payload,status,next_attempt_at)
  values(v_event_key||'-assignment','eval_work_assignment',jsonb_build_object(
    'assignmentRecipients',jsonb_build_array(private.item_inquiry_verified_email_v1('sharon_combs'))),
    'pending',now());
  if (select payload ? 'itemInquiryCoverage' from public.ph_request_delivery_outbox
      where ph_request_delivery_outbox.event_key=v_event_key||'-assignment') then
    raise exception 'initial assignment was changed';
  end if;

  perform set_config('request.jwt.claim.sub',sunday_id::text,true);
  begin
    perform public.get_item_inquiry_coverage_v1();
    raise exception 'non-manager read accepted';
  exception when insufficient_privilege then null;
  end;
end
$test$;
rollback;
