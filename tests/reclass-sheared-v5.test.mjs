import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  reclassShearedMigrationName,
  releaseDatabaseMigrations,
  migrationContractQuery,
} from '../scripts/apply-item-low-stock-migration.mjs';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const migration = read(`supabase/migrations/${reclassShearedMigrationName}`);
const sqlTest = read('supabase/tests/reclass_sheared_action_v5_test.sql');
const appsScript = read('Code.gs');

test('V5 sheared migration is registered and release contract is service-only', () => {
  assert.ok(releaseDatabaseMigrations.includes(reclassShearedMigrationName));
  const contract = migrationContractQuery(reclassShearedMigrationName);
  assert.match(contract, /enqueue_drive_reclass_inquiry_v5/);
  assert.match(contract, /not has_function_privilege\('authenticated'/);
  assert.match(contract, /not has_function_privilege\('anon'/);
  assert.match(contract, /quantity_text/);
});

test('V5 derives the proposal designation in SQL and preserves original row identity', () => {
  assert.match(migration, /'action','sheared','quantity',quantity,'desigitem',quantity_text \|\| '-->#'/);
  assert.match(migration, /coalesce\(row_json->>'desigitem',''\) <> coalesce\(expected->>'desigitem',''\)/);
  assert.match(migration, /current_oh <> expected_oh/);
  assert.equal((migration.match(/current_oh_text !~ '\^\[\+\-\]\?/g) || []).length, 2,
    'Drive and Eval Work reject nonfinite OH text before numeric comparison');
  assert.match(migration, /sheared_total \+ movement_total > current_oh/);
  assert.match(migration, /select to_jsonb\(m\)[\s\S]*?for share/);
  const enqueue = migration.slice(migration.indexOf('create or replace function public.enqueue_drive_reclass_inquiry_v5'));
  assert.doesNotMatch(enqueue, /update public\.ph_master_inventory|insert into public\.ph_master_inventory|delete from public\.ph_master_inventory/i);
  assert.match(enqueue, /requestFingerprint/);
  assert.match(enqueue, /validate_drive_reclass_sheared_v5/);
});

test('V5 Eval Work branches preserve authorization, idempotency, and persist the projected request', () => {
  for (const version of ['v1', 'v2']) {
    const start = migration.indexOf(`create or replace function public.submit_eval_work_${version}`);
    const end = migration.indexOf(`revoke all on function public.submit_eval_work_${version}`, start);
    assert.ok(start >= 0 && end > start);
    const body = migration.slice(start, end);
    assert.match(body, /eval_work_assert_actor_v1/);
    assert.match(body, /submission_request_fingerprint/);
    assert.match(body, /eval_work_version_conflict/);
    assert.match(body, /validate_eval_work_inquiry_sheared_v5/);
    assert.match(body, new RegExp(`submit_eval_work_legacy_${version}`));
    assert.match(body, /legacy_inquiry,p_(?:evidence|evidence_by_origin)/);
  }
  assert.match(migration, /workflowPolicyVersion','reclass-action-workflow-v4-split-moves-20261006'/);
  assert.match(migration, /workflowPolicyVersion','reclass-action-workflow-v5-sheared-20261008'/);
});

test('Apps Script delivery verifies server-derived desigitem without changing original designation', () => {
  assert.match(appsScript, /\['action', 'quantity', 'desigitem'\]/);
  assert.match(appsScript, /proposal\.desigitem !== proposedDesigitem/);
  assert.match(appsScript, /actionValues\.shearedproposeddesigitem = proposedDesigitem/);
  assert.match(appsScript, /values: values/);
});

test('V5 SQL regression suite is discoverable and covers projection, authorization scope, persistence, and no-write guarantees', () => {
  const declared = Number(sqlTest.match(/select plan\((\d+)\)/)?.[1]);
  const assertions = sqlTest.match(/^select (?:has_function|ok|is|throws_ok|lives_ok)\(/gm) || [];
  assert.equal(declared, assertions.length);
  assert.match(sqlTest, /^-- @test-runtime: canonical/);
  assert.match(sqlTest, /eval_work_row_identity_conflict/);
  assert.match(sqlTest, /DRIVE_RECLASS_V5_QUANTITY_EXCEEDS_OH/);
  assert.match(sqlTest, /server-derived designation/);
  assert.match(sqlTest, /does not apply inventory changes/);
  for (const rpc of ['save_eval_work_v1', 'save_eval_work_v2', 'submit_eval_work_v1', 'submit_eval_work_v2']) {
    assert.match(sqlTest, new RegExp(`public\\.${rpc}\\(`));
  }
});
