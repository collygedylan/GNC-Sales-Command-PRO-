import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const enqueueSql = read('supabase/migrations/20261006145333_reclass_split_move_inquiries_v4.sql');
const submissionSql = read('supabase/migrations/20261006150745_reclass_split_move_eval_submit_guards.sql');
const api = read('supabase/functions/app-api/index.ts');
const sqlTests = read('supabase/tests/reclass_split_move_v4_test.sql');

test('V4 split requests retain ordered instructions and guard their stored payload size', () => {
  assert.match(enqueueSql, /reclass-action-workflow-v4-split-moves-20261006/);
  assert.match(enqueueSql, /split_count > 100/);
  assert.match(enqueueSql, /projected_proposals := projected_proposals \|\| jsonb_build_array/);
  assert.match(enqueueSql, /final_payload := jsonb_set\(event_row\.payload/);
  assert.match(enqueueSql, /octet_length\(convert_to\(final_payload::text,'UTF8'\)\) > 4 \* 1024 \* 1024/);
  assert.match(enqueueSql, /DRIVE_RECLASS_V4_PAYLOAD_TOO_LARGE/);
  const enqueue = enqueueSql.slice(enqueueSql.indexOf('create or replace function public.enqueue_drive_reclass_inquiry_v4'));
  assert.doesNotMatch(enqueue, /update public\.ph_master_inventory|insert into public\.ph_master_inventory|delete from public\.ph_master_inventory/i);
});

test('EvalWork V1 and V2 preserve V4 validation and bind same-token retries to the full request', () => {
  for (const version of ['v1', 'v2']) {
    const start = submissionSql.indexOf(`create or replace function public.submit_eval_work_${version}`);
    const end = submissionSql.indexOf(`revoke all on function public.submit_eval_work_${version}`, start);
    const wrapper = submissionSql.slice(start, end);
    assert.match(wrapper, /submission_request_fingerprint is not null/);
    assert.match(wrapper, /submission_request_fingerprint is distinct from fingerprint/);
    assert.match(wrapper, /validate_eval_work_inquiry_v4_strict/);
    assert.match(wrapper, new RegExp(`submit_eval_work_legacy_${version}`));
  }
  assert.match(submissionSql, /add column if not exists submission_request_fingerprint text/);
  assert.match(submissionSql, /eval_work_submission_token_conflict/);
});

test('Drive maps validation conflicts safely and keeps V4 behind its protected enqueue RPC', () => {
  const errors = api.slice(api.indexOf('function driveReclassErrorResponse'), api.indexOf('async function handleDriveReclassAction'));
  assert.ok(errors.includes('EVAL_WORK_(ORIGINAL_OH|VERSION|SUBMISSION_TOKEN)_.*CONFLICT'));
  assert.match(errors, /EVAL_WORK_\(MOVE_\|INQUIRY_\|ROW_\|ACTION_\|PROPOSAL_\|SPLIT_\|ORIGINAL_OH_\)/);
  assert.doesNotMatch(errors, /code:\s*raw|code:\s*message/);
  assert.match(api, /workflowPolicyVersion === "reclass-action-workflow-v4-split-moves-20261006"[\s\S]*enqueue_drive_reclass_inquiry_v4/);
});

test('disposable SQL contract covers ordered splits, quantity bounds, stale OH, and authorization', () => {
  const declared = Number(sqlTests.match(/select plan\((\d+)\)/)?.[1]);
  const assertions = sqlTests.match(/^select (?:has_function|ok|is|throws_ok|lives_ok)\(/gm) || [];
  assert.equal(declared, assertions.length, 'pgTAP plan must include every declared assertion');
  assert.match(sqlTests, /split_move_v4/);
  assert.match(sqlTests, /original_oh_conflict/);
  assert.match(sqlTests, /eval_work_combined_move_exceeds_oh/i);
  assert.match(sqlTests, /requestFingerprint|idempotency/i);
});

test('disposable SQL contract verifies the requested audit preserves V4 and retries safely', () => {
  assert.match(sqlTests, /ph_inventory_transactions[\s\S]*status='requested'[\s\S]*event_type='inventory_change_request'/);
  assert.match(sqlTests, /t\.raw_payload[\s\S]*rowOverlays[\s\S]*final V4 split and hold snapshot/);
  assert.match(sqlTests, /identical and conflicting retries do not duplicate the requested audit/);
  assert.match(sqlTests, /rejected requests roll back their provisional outbox audit/);
});
