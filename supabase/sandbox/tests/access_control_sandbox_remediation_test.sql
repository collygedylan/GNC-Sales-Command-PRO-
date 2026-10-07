-- @test-runtime: sandbox-pgtap
-- Synthetic auth/profile fixtures only; the surrounding transaction rolls back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(47);

SELECT ok(has_function_privilege('service_role', 'public.get_my_app_permissions_v1()', 'EXECUTE'),
  'service role retains the permission snapshot RPC grant');
SELECT ok(has_function_privilege('service_role', 'public.publish_access_control_policy_v1(integer,text)', 'EXECUTE'),
  'service role retains the policy publish RPC grant');
SELECT ok(has_function_privilege('service_role', 'public.save_access_control_draft_v1(integer,jsonb,text)', 'EXECUTE'),
  'service role retains the policy draft RPC grant');
SELECT ok(has_function_privilege('service_role', 'public.save_limited_access_override_v1(integer,jsonb,text)', 'EXECUTE'),
  'service role retains the limited-access RPC grant');

SELECT ok(has_function_privilege('authenticated', 'private.current_active_profile()', 'EXECUTE'),
  'authenticated can use the active-profile helper');
SELECT ok(NOT has_function_privilege('anon', 'private.current_active_profile()', 'EXECUTE'),
  'anonymous users cannot execute the active-profile helper');
SELECT ok(has_function_privilege('service_role', 'private.is_service_role_request()', 'EXECUTE'),
  'service role can use the service-request helper');
SELECT ok(NOT has_function_privilege('authenticated', 'private.is_service_role_request()', 'EXECUTE'),
  'authenticated users cannot execute the service-request helper');

SELECT ok(has_function_privilege('authenticated', 'public.get_my_app_permissions_v1()', 'EXECUTE'),
  'authenticated users retain the permission snapshot RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.get_my_app_permissions_v1()', 'EXECUTE'),
  'anonymous users cannot call the permission snapshot RPC');
SELECT ok(has_function_privilege('authenticated', 'public.save_access_control_draft_v1(integer,jsonb,text)', 'EXECUTE'),
  'authenticated users retain the draft RPC entry point');
SELECT ok(NOT has_function_privilege('anon', 'public.save_access_control_draft_v1(integer,jsonb,text)', 'EXECUTE'),
  'anonymous users cannot call the draft RPC');
SELECT ok(has_function_privilege('authenticated', 'public.publish_access_control_policy_v1(integer,text)', 'EXECUTE'),
  'authenticated users retain the publish RPC entry point');
SELECT ok(NOT has_function_privilege('anon', 'public.publish_access_control_policy_v1(integer,text)', 'EXECUTE'),
  'anonymous users cannot call the publish RPC');
SELECT ok(has_function_privilege('authenticated', 'public.save_limited_access_override_v1(integer,jsonb,text)', 'EXECUTE'),
  'authenticated users retain the limited-access RPC entry point');
SELECT ok(NOT has_function_privilege('anon', 'public.save_limited_access_override_v1(integer,jsonb,text)', 'EXECUTE'),
  'anonymous users cannot call the limited-access RPC');

SELECT ok(has_function_privilege('service_role', 'public.get_access_control_health_snapshot_v1()', 'EXECUTE'),
  'service role retains the access-control health RPC');
SELECT ok(NOT has_function_privilege('authenticated', 'public.get_access_control_health_snapshot_v1()', 'EXECUTE'),
  'authenticated users cannot call the health RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.get_access_control_health_snapshot_v1()', 'EXECUTE'),
  'anonymous users cannot call the health RPC');

SELECT ok(has_function_privilege('service_role', 'public.v2_refresh_hold_learning_profiles()', 'EXECUTE'),
  'service role retains the hold-profile RPC signature');
SELECT ok(NOT has_function_privilege('authenticated', 'public.v2_refresh_hold_learning_profiles()', 'EXECUTE'),
  'authenticated users cannot call the hold-profile RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.v2_refresh_hold_learning_profiles()', 'EXECUTE'),
  'anonymous users cannot call the hold-profile RPC');
SELECT ok(has_function_privilege('service_role', 'public.v2_refresh_hold_learning_weather_features(integer)', 'EXECUTE'),
  'service role retains the hold-weather RPC signature');
SELECT ok(NOT has_function_privilege('authenticated', 'public.v2_refresh_hold_learning_weather_features(integer)', 'EXECUTE'),
  'authenticated users cannot call the hold-weather RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.v2_refresh_hold_learning_weather_features(integer)', 'EXECUTE'),
  'anonymous users cannot call the hold-weather RPC');

INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('9a000000-0000-4000-8000-000000000001', 'sandbox-remediation-active@example.invalid', '{}', '{}'),
  ('9a000000-0000-4000-8000-000000000002', 'sandbox-remediation-disabled@example.invalid', '{}', '{}'),
  ('9a000000-0000-4000-8000-000000000003', 'sandbox-remediation-locked@example.invalid', '{}', '{}');

INSERT INTO public.profiles(id, username, display_name, role, disabled_at, locked_until)
VALUES
  ('9a000000-0000-4000-8000-000000000001', 'sandbox_remediation_user', 'Synthetic Sandbox User', 'User', NULL, NULL),
  ('9a000000-0000-4000-8000-000000000002', 'sandbox_remediation_disabled', 'Synthetic Disabled User', 'User', now(), NULL),
  ('9a000000-0000-4000-8000-000000000003', 'sandbox_remediation_locked', 'Synthetic Locked User', 'User', NULL, now() + interval '1 hour');

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE authenticated;
SELECT ok((private.current_active_profile()).id IS NULL,
  'a request without an identity resolves no active profile');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT ok((private.current_active_profile()).id = '9a000000-0000-4000-8000-000000000001'::uuid,
  'an authenticated identity resolves its active profile');
SELECT is(public.get_my_app_permissions_v1() #>> '{username}', 'sandbox_remediation_user',
  'active identity can read its own permission snapshot');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.get_my_app_permissions_v1()$$,
  '42501', 'permission denied for function get_my_app_permissions_v1', 'anonymous role cannot execute the permission snapshot RPC');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000002', true);
SET LOCAL ROLE authenticated;
SELECT ok((private.current_active_profile()).id IS NULL,
  'disabled profiles are not active');
SELECT throws_ok($$SELECT public.get_my_app_permissions_v1()$$, '42501', 'APP_ACCESS_PROFILE_REQUIRED',
  'disabled identities cannot obtain a permission snapshot');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000003', true);
SET LOCAL ROLE authenticated;
SELECT ok((private.current_active_profile()).id IS NULL,
  'profiles with a future lock are not active');
SELECT throws_ok($$SELECT public.get_my_app_permissions_v1()$$, '42501', 'APP_ACCESS_PROFILE_REQUIRED',
  'locked identities cannot obtain a permission snapshot');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000004', true);
SET LOCAL ROLE authenticated;
SELECT ok((private.current_active_profile()).id IS NULL,
  'an identity without a profile resolves no active profile');
SELECT throws_ok($$SELECT public.get_my_app_permissions_v1()$$, '42501', 'APP_ACCESS_PROFILE_REQUIRED',
  'identities without profiles cannot obtain a permission snapshot');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '9a000000-0000-4000-8000-000000000001', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.save_access_control_draft_v1(1, '[]'::jsonb, 'test reason')$$,
  '42501', 'ACCESS_CONTROL_FORBIDDEN', 'non-maintainers cannot save an access draft');
SELECT throws_ok($$SELECT public.publish_access_control_policy_v1(1, 'test reason')$$,
  '42501', 'ACCESS_CONTROL_FORBIDDEN', 'non-maintainers cannot publish an access policy');
SELECT throws_ok($$SELECT public.save_limited_access_override_v1(1, '[]'::jsonb, 'test reason')$$,
  '42501', 'LIMITED_ACCESS_CONTROL_FORBIDDEN', 'non-managers cannot save limited-access overrides');
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.get_access_control_health_snapshot_v1()$$,
  '42501', 'permission denied for function get_access_control_health_snapshot_v1', 'authenticated role cannot execute the health RPC');
RESET ROLE;
SELECT throws_ok($$SELECT public.get_access_control_health_snapshot_v1()$$,
  '42501', 'ACCESS_CONTROL_HEALTH_FORBIDDEN', 'health RPC rejects a non-service JWT role');
SELECT ok(NOT private.is_service_role_request(), 'authenticated JWT claims are not treated as service role');

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT ok(private.is_service_role_request(), 'service-role JWT claims are recognized');
SET LOCAL ROLE service_role;
SELECT is(public.get_access_control_health_snapshot_v1() #>> '{contract_version}', 'app-access-v1',
  'service role can obtain the health snapshot');
SELECT throws_ok($$SELECT public.v2_refresh_hold_learning_profiles()$$,
  '0A000', 'SANDBOX_HOLD_LEARNING_UNAVAILABLE', 'hold-profile RPC reports its unsupported sandbox feature');
SELECT throws_ok($$SELECT public.v2_refresh_hold_learning_weather_features(10)$$,
  '0A000', 'SANDBOX_HOLD_LEARNING_UNAVAILABLE', 'hold-weather RPC reports its unsupported sandbox feature');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.v2_refresh_hold_learning_profiles()$$,
  '42501', 'permission denied for function v2_refresh_hold_learning_profiles', 'anonymous role cannot execute the hold-profile RPC');
SELECT throws_ok($$SELECT public.v2_refresh_hold_learning_weather_features(10)$$,
  '42501', 'permission denied for function v2_refresh_hold_learning_weather_features', 'anonymous role cannot execute the hold-weather RPC');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
