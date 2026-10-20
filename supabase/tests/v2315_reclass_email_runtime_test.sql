-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
create temporary table v2315_delivery_users(username text primary key,id uuid not null,email text not null) on commit drop;
insert into v2315_delivery_users values
  ('dylan_collyge',gen_random_uuid(),'v2315-dylan-'||gen_random_uuid()::text||'@example.invalid'),
  ('megan_kelly',gen_random_uuid(),'v2315-megan-'||gen_random_uuid()::text||'@example.invalid'),
  ('v2315_runtime_actor',gen_random_uuid(),'v2315-actor-'||gen_random_uuid()::text||'@example.invalid'),
  ('v2315_disabled_actor',gen_random_uuid(),'v2315-disabled-'||gen_random_uuid()::text||'@example.invalid'),
  ('v2315_unconfirmed_actor',gen_random_uuid(),'v2315-unconfirmed-'||gen_random_uuid()::text||'@example.invalid');

insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select id,email,case when username='v2315_unconfirmed_actor' then null else now() end,'{}'::jsonb,'{}'::jsonb
from v2315_delivery_users;
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
select id,username,username,'ADMIN',false,
  case when username='v2315_disabled_actor' then now() else null end,null
from v2315_delivery_users;
insert into private.app_access_user_overrides(policy_id,profile_id,permission_key,allowed,access_scope)
select private.resolve_app_access_policy_id_v1(false),id,'drive.reclass.submit',true,'global'
from v2315_delivery_users where username='v2315_runtime_actor'
on conflict(policy_id,profile_id,permission_key) do update set allowed=true,access_scope='global';

create temporary table v2315_delivery_call(result jsonb) on commit drop;
create temporary table v2315_delivery_event(event_id uuid,lease_token uuid) on commit drop;
create temporary table v2315_delivery_prepared(payload jsonb) on commit drop;
create temporary table v2315_delivery_context_checks(check_name text primary key,passed boolean) on commit drop;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
select plan(13);

-- Resolver must normalize actor casing and return the fixed addresses plus actor.
select ok(
  (select public.get_reclass_delivery_recipients_v1('  V2315_RUNTIME_ACTOR  ') @>
      array[lower(email)] and cardinality(public.get_reclass_delivery_recipients_v1('V2315_RUNTIME_ACTOR'))=3
   from v2315_delivery_users where username='v2315_runtime_actor')
  and (select public.get_reclass_delivery_recipients_v1('V2315_RUNTIME_ACTOR') @>
      array[lower(d.email),lower(m.email)]
    from v2315_delivery_users d cross join v2315_delivery_users m
    where d.username='dylan_collyge' and m.username='megan_kelly'),
  'case-insensitive actor lookup returns the canonical fixed recipients and the submitting actor');
select ok(cardinality(public.get_reclass_delivery_recipients_v1('DYLAN_COLLYGE'))=2,
  'a fixed-recipient submitter is included once in the two-identity policy');
select ok(public.get_reclass_delivery_recipients_v1('DYLAN_COLLYGE') @>
    (select array_agg(lower(email)) from v2315_delivery_users where username=any(array['dylan_collyge','megan_kelly']))
  and cardinality(public.get_reclass_delivery_recipients_v1('DYLAN_COLLYGE'))=2,
  'fixed Dylan and Megan identities resolve to their verified normalized addresses');
select throws_ok($$select public.get_reclass_delivery_recipients_v1('v2315_disabled_actor')$$,
  '42501','RECLASS_RECIPIENT_ACTOR_INACTIVE','disabled submitters cannot resolve delivery recipients');
select throws_ok($$select public.get_reclass_delivery_recipients_v1('v2315_unconfirmed_actor')$$,
  '40001','RECLASS_REQUIRED_RECIPIENTS_UNAVAILABLE','unconfirmed submitter addresses cannot resolve delivery recipients');

do $test$
declare
  actor_id uuid;
  inventory_revision bigint;
  source_uid text := 'v2315-source-'||gen_random_uuid()::text;
  command_key text := 'v2315-reclass-command-'||gen_random_uuid()::text;
  request_value jsonb;
  result_value jsonb;
  replay_value jsonb;
  event_value public.ph_request_delivery_outbox%rowtype;
  token_value uuid := gen_random_uuid();
begin
  select id into actor_id from v2315_delivery_users where username='v2315_runtime_actor';
  insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,
    ptronhand,ptravailable,source,season,saleyear)
  values(source_uid,'V2315-RECLASS','Runtime movement fixture','#3','C.16.000','27.F1',
    '10','10','PH','F1','27');
  select revision into inventory_revision from public.app_dataset_revisions where key='ph_master_inventory';
  insert into app_sync_private.import_runs(id,source_keys,canonical_keys,state,expires_at,created_at,finished_at)
  values
    ('f2315100-0000-4000-8000-000000000001','{ph_master_inventory}','{ph_master_inventory}','completed',now()-interval '1 day',now()-interval '3 hours',now()-interval '3 hours'),
    ('f2315100-0000-4000-8000-000000000003','{ph_master_inventory}','{ph_master_inventory}','failed',now()-interval '1 minute',now()-interval '1 minute',now()-interval '30 seconds');
  insert into app_sync_private.ph_master_snapshot_stage_v1(
    request_id,run_id,source_manifest,source_manifest_digest,source_digest,
    expected_rows,expected_chunks,payload_hash,status,publication_run_id,published_response,updated_at
  ) values
    ('f2315100-0000-4000-8000-000000000011','f2315100-0000-4000-8000-000000000001','{}',repeat('a',64),repeat('b',64),1,1,repeat('c',64),'published','f2315100-0000-4000-8000-000000000001','{"published":true}',now()-interval '2 hours'),
    ('f2315100-0000-4000-8000-000000000013','f2315100-0000-4000-8000-000000000003','{}',repeat('d',64),repeat('e',64),1,1,repeat('f',64),'staging',null,null,now()-interval '1 minute');
  update public.app_dataset_revisions set state='interrupted' where key='ph_master_inventory';
  insert into v2315_delivery_context_checks values('failed_canonical_proof',
    coalesce((app_sync_private.published_snapshot_read_proof('ph_master_inventory',inventory_revision)->>'mutationAllowed')::boolean,false));
  select jsonb_build_array(jsonb_build_object(
    'source',jsonb_build_object('uniqueId',m.unique_id,'identity',jsonb_build_object(
      'unique_id',m.unique_id,'itemcode',m.itemcode,'contsize',m.contsize,'locationcode',m.locationcode,
      'lotcode',m.lotcode,'season',m.season,'ptronhand',m.ptronhand,'ptravailable',m.ptravailable)),
    'lines',jsonb_build_array(jsonb_build_object('direction','move_up','destinationSeason','U1','quantity',3))))
    into request_value from public.ph_master_inventory m where m.unique_id=source_uid;
  result_value:=public.apply_inventory_reclass_moves_with_delivery_v1(
    actor_id,command_key,inventory_revision,request_value,null);
  insert into v2315_delivery_call values(result_value);
  if result_value->>'status'<>'applied' or result_value->>'emailQueued'<>'true'
    or jsonb_array_length(result_value->'rows')<>2 then
    raise exception 'movement did not apply with its authoritative source and destination receipt';
  end if;
  if (select ptronhand from public.ph_master_inventory where unique_id=source_uid)<>'7'
     or (select ptravailable from public.ph_master_inventory where unique_id=source_uid)<>'7' then
    raise exception 'movement quantity mutation differs from the existing atomic Reclass semantics';
  end if;
  begin
    execute format($sql$update public.ph_master_inventory set itemcode=itemcode where unique_id=%L$sql$,source_uid);
    insert into v2315_delivery_context_checks values('context_cleared_after_apply',false);
  exception when sqlstate '55000' then
    if sqlerrm='MASTER_SNAPSHOT_NOT_READY' then
      insert into v2315_delivery_context_checks values('context_cleared_after_apply',true);
    else
      raise;
    end if;
  end;
  select * into event_value from public.ph_request_delivery_outbox where event_id=(result_value->>'deliveryEventId')::uuid;
  if event_value.event_id is null then raise exception 'same-transaction completion event was not created'; end if;
  -- Deliberately corrupt cached delivery fields; prepare must re-derive canonical values from receipt/profile.
  update public.ph_request_delivery_outbox set status='processing',lease_token=token_value,lease_owner='v2315-runtime',
    lease_expires_at=now()+interval '5 minutes',
    payload=payload||jsonb_build_object('deliveryRecipients',jsonb_build_array('forged@example.invalid'),'appliedRows','[]'::jsonb)
  where event_id=event_value.event_id;
  insert into v2315_delivery_event values(event_value.event_id,token_value);
  replay_value:=public.apply_inventory_reclass_moves_with_delivery_v1(
    actor_id,command_key,inventory_revision,request_value,null);
  if replay_value->>'duplicate'<>'true' or replay_value->>'emailQueued'<>'true'
     or (select count(*) from public.ph_request_delivery_outbox where event_key=event_value.event_key)<>1 then
    raise exception 'idempotent replay duplicated or lost the completion delivery event';
  end if;
end
$test$;

select ok((select passed from v2315_delivery_context_checks where check_name='failed_canonical_proof'),
  'the failed canonical staged baseline is eligible for revision-locked Reclass mutation');
select ok((select passed from v2315_delivery_context_checks where check_name='context_cleared_after_apply'),
  'the private Reclass context is consumed by the approved stock mutation and cannot authorize a second direct write');
select ok((select (result->>'duplicate')='false' and (result->>'emailQueued')='true'
  and jsonb_array_length(result->'rows')=2 from v2315_delivery_call),
  'applied movement returns one queued completion event and full post-move source/target rows');
select ok((select m.ptronhand='7' and m.ptravailable='7' from v2315_delivery_call c
  cross join lateral jsonb_array_elements(c.result->'rows') as r(value)
  join public.ph_master_inventory m on m.unique_id=r.value#>>'{row,unique_id}'
  where r.value#>>'{row,unique_id}' like 'v2315-source-%'),
  'the delivery wrapper leaves the established inventory movement balances intact');
select ok((select count(*)=1 from public.ph_request_delivery_outbox o
  join v2315_delivery_event e on e.event_id=o.event_id
  where o.event_type='inventory_reclass_move_completed' and o.status='processing'),
  'the idempotent movement creates exactly one leased outbox event');
select lives_ok($$insert into v2315_delivery_prepared
  select public.prepare_inventory_reclass_move_delivery_v1(event_id,lease_token)
  from v2315_delivery_event$$,
  'preparation accepts the current processing lease for an applied receipt');
select ok((select payload->'appliedRows'=(select result->'rows' from v2315_delivery_call)
  and payload->'deliveryRecipients' @> (select jsonb_agg(lower(email)) from v2315_delivery_users
    where username=any(array['dylan_collyge','megan_kelly','v2315_runtime_actor']))
  and not (payload->'deliveryRecipients' @> '["forged@example.invalid"]'::jsonb)
  from v2315_delivery_prepared),
  'leased preparation replaces cached fields with the applied receipt and canonical recipient set');
select ok((select payload->>'actorEmail'=(select lower(email) from v2315_delivery_users
  where username='v2315_runtime_actor') from v2315_delivery_prepared),
  'leased preparation binds the receipt to the confirmed actor email');
select * from finish();
rollback;
