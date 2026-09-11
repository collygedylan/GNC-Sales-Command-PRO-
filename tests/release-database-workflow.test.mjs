import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release-database.yml', import.meta.url), 'utf8');
const browserConfig = fs.readFileSync(new URL('../playwright.database.config.ts', import.meta.url), 'utf8');
const provisioning = fs.readFileSync(new URL('./native-auth-provisioning-local.spec.js', import.meta.url), 'utf8');
const legacyBaseline = fs.readFileSync(new URL('../supabase/ci/native_auth_legacy_user_baseline.sql', import.meta.url), 'utf8');

test('database reusable workflow is secret-free and has read-only repository permissions', () => {
  assert.match(workflow, /on:\s+workflow_call:/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.doesNotMatch(workflow, /secrets:|secrets\.|id-token:|contents: write|PRODUCTION_|--linked|--db-url|db push|functions deploy/);
  assert.match(workflow, /node-version: 22\s+cache: npm/);
});

test('all original migrations and pgTAP tests remain alongside grouped health and HL ordering regressions', () => {
  const migrations = [...workflow.matchAll(/cp supabase\/migrations\/(\S+)/g)].map(match => match[1]);
  assert.equal(migrations.length, 88);
  assert.equal(new Set(migrations).size, migrations.length);
  for (const filename of migrations) {
    assert.ok(fs.existsSync(new URL(`../supabase/migrations/${filename}`, import.meta.url)), filename);
  }
  for (const filename of [
    '20260902002912_flatten_eval_reports_2_and_reconcile_work.sql',
    '20260902105411_group_eval_report2_assignment_email.sql',
    '20260910174603_grouped_eval_itemcode_health_contract.sql',
    '20260911115037_hl_ordering_system.sql',
  ]) assert.ok(migrations.includes(filename), `Grouped health dependency: ${filename}`);
  const sqlTests = [...workflow.matchAll(/cp supabase\/tests\/(\S+)/g)].map(match => match[1]);
  assert.deepEqual([...sqlTests].sort(), [
    'native_auth_rls_test.sql', 'request_integrity_rls_test.sql', 'codex_ops_rls_test.sql',
    'pikes_orders_rls_test.sql', 'request_eval_drive_reliability_test.sql',
    'reclass_review_assignedto_test.sql', 'request_option_append_test.sql',
    'drive_reclass_protected_test.sql', 'drive_evidence_retry_storm_test.sql',
    'photo_delivery_health_rls_test.sql', 'photo_history_rls_test.sql',
    'function_search_path_pinning_test.sql', 'season_sales_done_lifecycle_test.sql',
    'season_sales_av_note_retention_test.sql', 'season_sales_av_note_reset_test.sql',
    'photo_evidence_projection_test.sql',
    'grouped_eval_itemcode_health_test.sql',
    'hl_order_lifecycle_test.sql', 'hl_order_delivery_test.sql',
  ].sort());
  for (const filename of sqlTests) {
    assert.ok(fs.existsSync(new URL(`../supabase/tests/${filename}`, import.meta.url)), filename);
  }
});

test('database migration, pgTAP, concurrency, browser, and Edge checks stay serialized', () => {
  const commands = [
    'supabase --workdir "$SUPABASE_CI_ROOT" start',
    'supabase --workdir "$SUPABASE_CI_ROOT" db reset --local --no-seed',
    'supabase --workdir "$SUPABASE_CI_ROOT" test db',
    'CI=true EVAL_REVIEW_TEST_DB_URL="$DB_URL" node scripts/test-reclass-review-concurrency.mjs',
    'CI=true HL_ORDER_TEST_DB_URL="$DB_URL" node scripts/test-hl-order-concurrency.mjs',
    'npx playwright test --config playwright.database.config.ts --project=chromium',
    'deno test --allow-env --allow-net supabase/functions',
  ];
  let previous = -1;
  for (const command of commands) {
    const at = workflow.indexOf(command);
    assert.ok(at > previous, `Missing or out-of-order command: ${command}`);
    previous = at;
  }
  assert.doesNotMatch(workflow, /strategy:|matrix:/);
});

test('local browser config explicitly includes provisioning and prevents silent missing-environment skips', () => {
  assert.match(browserConfig, /testMatch: \['request-integrity-local\.spec\.js', 'native-auth-provisioning-local\.spec\.js'\]/);
  assert.match(browserConfig, /fullyParallel: false/);
  assert.match(browserConfig, /workers: 1/);
  assert.match(browserConfig, /isolated loopback Supabase environment/);
  assert.match(browserConfig, /SUPABASE_LOCAL_ANON_KEY/);
  assert.match(browserConfig, /SUPABASE_LOCAL_SERVICE_ROLE_KEY/);
});

test('database reports have a uniquely named artifact with browser failure evidence', () => {
  assert.match(workflow, /name: release-database-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /playwright-report\/database/);
  assert.match(workflow, /test-results\/database/);
});

test('native provisioning fixture exercises the two-part password update contract', () => {
  const nativeChange = provisioning.indexOf('const nativePasswordChange');
  const linkedChange = provisioning.indexOf('const passwordChange');
  assert.ok(nativeChange > 0 && nativeChange < linkedChange);
  assert.match(provisioning, /expect\(nativePasswordChange\.response\.ok/);
  assert.match(provisioning, /expect\(signedIn\.response\.ok/);
  assert.match(provisioning, /expect\(oldPasswordSignIn\.response\.ok\)\.toBeFalsy\(\)/);
  assert.match(provisioning, /invalid_credentials/);
});

test('native provisioning legacy-table fixture is installed with service-only access', () => {
  assert.match(workflow, /cp supabase\/ci\/native_auth_legacy_user_baseline\.sql "\$ci_root\/supabase\/migrations\/20260803110000_native_auth_legacy_user_baseline\.sql"/);
  assert.match(legacyBaseline, /create table public\.ph_app_users/);
  for (const field of ['id', 'username', 'password', 'role', 'password_hash', 'password_salt', 'password_changed_at', 'must_change_password', 'failed_login_count', 'locked_until', 'disabled_at', 'division', 'language']) {
    assert.match(legacyBaseline, new RegExp(`\\b${field} (?:integer|text|timestamptz|boolean)\\b`), field);
  }
  assert.match(legacyBaseline, /alter table public\.ph_app_users enable row level security/);
  assert.match(legacyBaseline, /revoke all on table public\.ph_app_users from public, anon, authenticated/);
  assert.match(legacyBaseline, /revoke all on sequence public\.ph_app_users_id_seq from public, anon, authenticated/);
  assert.match(legacyBaseline, /grant select, insert, update, delete on table public\.ph_app_users to service_role/);
  assert.doesNotMatch(legacyBaseline, /grant[^;]+to\s+(?:public|anon|authenticated)\b/i);
  assert.match(provisioning, /expect\(deniedLegacy\.body\.code\)\.toBe\('42501'\)/);
});
