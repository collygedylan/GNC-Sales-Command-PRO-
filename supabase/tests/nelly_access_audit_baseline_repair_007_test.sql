begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions, pg_temp;
select plan(6);

select is(
  (select count(*)::integer from public.profiles
   where id='961b0a0f-11a6-4db5-b066-582f772ab8e7'
     and lower(btrim(username))='nelly_aguilar'
     and private.normalized_profile_role(role)='ADMIN'
     and disabled_at is null
     and (locked_until is null or locked_until<=statement_timestamp())
     and not must_change_password),
  1,
  'baseline repair targets the verified active Nelly admin profile'
);

select is(
  (select count(*)::integer from private.app_access_legacy_baseline
   where profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'),
  (select count(*)::integer from private.app_access_permissions where active),
  'Nelly has one baseline row for every active permission'
);

select is(
  (select count(*)::integer from private.ci_nelly_baseline_before_repair),
  2,
  'isolated replay records Nelly baseline rows that predate the repair'
);

select is(
  (select count(*)::integer
   from private.ci_nelly_baseline_before_repair snapshot
   left join private.app_access_legacy_baseline baseline
     on baseline.profile_id=snapshot.profile_id
    and baseline.permission_key=snapshot.permission_key
   where baseline.permission_key is null
      or baseline.allowed is distinct from snapshot.allowed
      or baseline.access_scope is distinct from snapshot.access_scope
      or baseline.captured_at is distinct from snapshot.captured_at),
  0,
  'the repair preserves historical Nelly baseline rows without rewriting them'
);

select is(
  (select count(*)::integer
   from private.app_access_legacy_baseline baseline
   join private.get_effective_app_permissions_v1(
     '961b0a0f-11a6-4db5-b066-582f772ab8e7',
     private.resolve_app_access_policy_id_v1(true)
   ) effective using(permission_key)
   where baseline.profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'
     and not exists(select 1 from private.ci_nelly_baseline_before_repair snapshot
       where snapshot.profile_id=baseline.profile_id and snapshot.permission_key=baseline.permission_key)
     and (baseline.allowed is distinct from effective.allowed
       or baseline.access_scope is distinct from effective.access_scope)),
  0,
  'new baseline rows match the historical effective-policy resolver'
);

select is(
  (select count(*)::integer
   from private.get_effective_app_permissions_v1(
     '961b0a0f-11a6-4db5-b066-582f772ab8e7',
     private.resolve_app_access_policy_id_v1(true)
   ) effective
   left join private.app_access_legacy_baseline baseline
     on baseline.profile_id='961b0a0f-11a6-4db5-b066-582f772ab8e7'
    and baseline.permission_key=effective.permission_key
   where baseline.permission_key is null),
  0,
  'no active effective permission is missing from Nelly baseline'
);

select * from finish();
rollback;
