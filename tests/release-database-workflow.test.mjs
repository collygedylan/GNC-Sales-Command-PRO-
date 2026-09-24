import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startIsolatedDatabase, collectDatabaseEvidence, excludedServices } from '../scripts/release-database-startup.mjs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release-database.yml', import.meta.url), 'utf8');
const yaml = createRequire(import.meta.url)('js-yaml');
const databaseJob = yaml.load(workflow).jobs['database-and-functions'];
const browserConfig = fs.readFileSync(new URL('../playwright.database.config.ts', import.meta.url), 'utf8');
const provisioning = fs.readFileSync(new URL('./native-auth-provisioning-local.spec.js', import.meta.url), 'utf8');
const legacyBaseline = fs.readFileSync(new URL('../supabase/ci/native_auth_legacy_user_baseline.sql', import.meta.url), 'utf8');

test('database reusable workflow is secret-free and has read-only repository permissions', () => {
  assert.match(workflow, /on:\s+workflow_call:/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.doesNotMatch(workflow, /secrets:|secrets\.|id-token:|contents: write|PRODUCTION_|--linked|--db-url|db push|functions deploy/);
  assert.match(workflow, /node-version: 22\s+cache: npm/);
});

test('all original migrations and pgTAP tests remain alongside grouped health, HL ordering and rollback compatibility regressions', () => {
  const migrations = [...workflow.matchAll(/cp supabase\/migrations\/(\S+)/g)].map(match => match[1]);
  assert.equal(migrations.length, 120);
  assert.equal(new Set(migrations).size, migrations.length);
  for (const filename of migrations) {
    assert.ok(fs.existsSync(new URL(`../supabase/migrations/${filename}`, import.meta.url)), filename);
  }
  for (const filename of [
    '20260922233000_manager_season_priority_inquiry_v1.sql',
    '20260923174000_optimize_manager_season_priority_scope.sql',
    '20260923222348_materialize_manager_season_priority_scope_hashes.sql',
    '20260924115226_sales_history_customer_docks_ownership.sql',
    '20260924145431_incident_pause_request_delivery_wakes.sql',
    '20260924145930_incident_pause_request_delivery_claims.sql',
    '20260924155225_request_metadata_notification_guard.sql',
    '20260924155542_restore_request_delivery_after_metadata_guard.sql',
    '20260924172552_request_drive_evidence_reset_guard.sql',
    '20260815043342_dylan_live_pilot_preferences.sql',
    '20260904003007_sales_marketing_and_kayla_limited_access.sql',
    '20260902002912_flatten_eval_reports_2_and_reconcile_work.sql',
    '20260902105411_group_eval_report2_assignment_email.sql',
    '20260910174603_grouped_eval_itemcode_health_contract.sql',
    '20260911115037_hl_ordering_system.sql',
    '20260911203510_hl_ship_date_submission_batches.sql',
    '20260912002734_hl_po_receipt_balances.sql',
    '20260912013440_hl_po_membership_index.sql',
    '20260908185903_live_dataset_revisions.sql',
    '20260908201318_live_dataset_revision_empty_statements.sql',
    '20260912170906_hl_restocking.sql',
    '20260914164706_hl_state_balances_once.sql',
    '20260915021525_hl_po_seasons_pdf.sql',
    '20260915115800_hl_po_negative_pdf_balances.sql',
    '20260917013505_hl_complete_restock_data.sql',
    '20260920060133_bunch_note_location_work_v1.sql',
    '20260920132156_hl_po_pdf_health_contract.sql',
    '20260920133738_hl_po_s1_read_only_grants.sql',
    '20260920154005_bunch_note_recorded_work.sql',
    '20260920192648_bunch_note_destinations.sql',
    '20260921011812_bunch_note_phone_steps.sql',
    '20260911152125_restore_sep09_eval_review_compatibility.sql',
    '20260921034331_sales_history_permanent_credit_workflow.sql',
    '20260921034349_production_workflow_and_atomic_inventory_audit.sql',
    '20260921034506_navigation_preferences_and_live_view_grants.sql',
    '20260921123226_hl_draft_review_removal.sql',
  ]) assert.ok(migrations.includes(filename), `Required migration: ${filename}`);
  const sqlTests = [
    ...[...workflow.matchAll(/cp supabase\/tests\/(\S+)/g)].map(match => match[1]),
    ...[...workflow.matchAll(/"([a-z_]+_test\.sql)": "[a-z_]+_checks"/g)].map(match => match[1]),
  ];
  assert.deepEqual([...sqlTests].sort(), [
    'manager_season_priority_test.sql',
    'bunch_note_workflow_test.sql', 'native_auth_rls_test.sql', 'request_integrity_rls_test.sql', 'codex_ops_rls_test.sql',
    'pikes_orders_rls_test.sql', 'request_eval_drive_reliability_test.sql',
    'reclass_review_assignedto_test.sql', 'request_option_append_test.sql',
    'drive_reclass_protected_test.sql', 'drive_evidence_retry_storm_test.sql',
    'photo_delivery_health_rls_test.sql', 'photo_history_rls_test.sql',
    'function_search_path_pinning_test.sql', 'season_sales_done_lifecycle_test.sql',
    'season_sales_av_note_retention_test.sql', 'season_sales_av_note_reset_test.sql',
    'photo_evidence_projection_test.sql',
    'grouped_eval_itemcode_health_test.sql',
    'hl_order_lifecycle_test.sql', 'hl_order_delivery_test.sql', 'hl_order_ship_dates_test.sql', 'hl_order_po_receipts_test.sql',
    'hl_order_restock_test.sql', 'hl_po_seasons_test.sql', 'hl_po_health_test.sql',
    'sep09_eval_review_compatibility_test.sql',
    'sales_credit_workflow_test.sql', 'sales_history_docks_test.sql', 'navigation_preferences_test.sql', 'production_workflow_test.sql',
    'request_metadata_notifications_test.sql',
    'request_drive_reset_test.sql',
  ].sort());
  for (const filename of sqlTests) {
    assert.ok(fs.existsSync(new URL(`../supabase/tests/${filename}`, import.meta.url)), filename);
  }
  const hlBaseline = workflow.match(/migrations\/(\d+)_hl_order_baseline\.sql/);
  const salesBaseline = workflow.match(/migrations\/(\d+)_sales_credit_baseline\.sql/);
  const liveRegistration = migrations.find(filename => filename.endsWith('_live_dataset_revisions.sql'));
  assert.ok(hlBaseline && salesBaseline && liveRegistration, 'Required source baselines and live-sync migration remain present');
  assert.ok(hlBaseline[1] < salesBaseline[1] && salesBaseline[1] < liveRegistration.split('_')[0],
    'Legacy source tables exist before live-sync registration');
  assert.match(workflow, /source\[:-len\("rollback;"\)\]/, 'TAP envelope retains every original assertion');
  assert.match(workflow, /ON_ERROR_STOP on/, 'A SQL exception must fail the gate');
  assert.match(workflow, /select ok\(\(select count\(\*\) > 0 from \{checks_table\}\)/, 'TAP result requires completed assertions');
});

test('database migration, pgTAP, concurrency, browser, and Edge checks stay serialized', () => {
  const commands = [
    'node scripts/release-database-startup.mjs start',
    'supabase --workdir "$SUPABASE_CI_ROOT" db reset --local --no-seed',
    'supabase --workdir "$SUPABASE_CI_ROOT" test db',
    'CI=true SEASON_PRIORITY_TEST_DB_URL="$DB_URL" node scripts/test-manager-season-priority-scale.mjs',
    'CI=true EVAL_REVIEW_TEST_DB_URL="$DB_URL" node scripts/test-reclass-review-concurrency.mjs',
    'CI=true HL_ORDER_TEST_DB_URL="$DB_URL" node scripts/test-hl-order-concurrency.mjs',
    'CI=true BUNCH_NOTE_TEST_DB_URL="$DB_URL" node scripts/test-bunch-note-concurrency.mjs',
    'CI=true SALES_CREDIT_TEST_DB_URL="$DB_URL" node scripts/test-sales-credit-concurrency.mjs',
    'CI=true SEASON_PRIORITY_TEST_DB_URL="$DB_URL" node scripts/test-manager-season-priority-concurrency.mjs',
    'CI=true REQUEST_DRIVE_TEST_DB_URL="$DB_URL" node scripts/test-request-drive-reset-concurrency.mjs',
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

test('pinned CLI fallback is restored after setup and remains active for all database steps', () => {
  const steps = databaseJob.steps;
  const cli = steps.findIndex(step => step.uses === 'supabase/setup-cli@v1');
  const registry = steps.findIndex(step => step.id === 'registry');
  const start = steps.findIndex(step => step.id === 'stack');
  assert.equal(steps[cli].with.version, '2.111.0');
  assert.ok(cli < registry && registry < start);
  assert.equal(steps[registry].run, 'echo "SUPABASE_INTERNAL_IMAGE_REGISTRY=" >> "$GITHUB_ENV"');
  assert.equal(excludedServices, 'studio,imgproxy,logflare,vector');
  assert.equal(databaseJob['timeout-minutes'], 35);
  assert.ok(steps.every(step => !step['continue-on-error']));
  assert.doesNotMatch(workflow, /--ignore-health-check|gh run rerun|nick-fields\/retry/);
  const evidence = steps.find(step => step.run === 'node scripts/release-database-startup.mjs evidence');
  assert.equal(evidence.if, 'always()');
  assert.equal(evidence.env.DATABASE_STEPS, '${{ toJSON(steps) }}');
});

function startupFixture(result) {
  const runnerTemp = path.resolve('isolated-runner');
  const records = [];
  const calls = [];
  let clock = 1000;
  const options = {
    env: { RUNNER_TEMP: runnerTemp, SUPABASE_CI_ROOT: path.join(runnerTemp, 'gnc-supabase-ci'),
      SUPABASE_INTERNAL_IMAGE_REGISTRY: 'ghcr.io', PRIVATE_SENTINEL: 'do-not-record' },
    run: (...args) => { calls.push(args); return result; },
    now: () => { clock += 25; return clock; },
    save: (name, report) => records.push({ name, report }),
  };
  return { options, records, calls };
}

test('isolated startup preserves failure codes, records timing, and never retries the stack', () => {
  for (const status of [0, 7]) {
    const f = startupFixture({ status });
    assert.equal(startIsolatedDatabase(f.options), status);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].slice(0, 2), ['supabase', ['--workdir', f.options.env.SUPABASE_CI_ROOT,
      'start', '--exclude', 'studio,imgproxy,logflare,vector']]);
    assert.equal(f.calls[0][2].env.SUPABASE_INTERNAL_IMAGE_REGISTRY, '');
    assert.equal(f.records[0].report.exitCode, status);
    assert.equal(f.records[0].report.durationMs, 25);
    assert.equal(f.records[0].report.failure, status ? 'STACK_START_FAILED' : null);
    assert.doesNotMatch(JSON.stringify(f.records), /do-not-record/);
  }
});

test('invalid workdir and missing or terminated CLI fail closed with sanitized evidence', () => {
  const invalid = startupFixture({ status: 0 });
  invalid.options.env.SUPABASE_CI_ROOT = path.resolve('some-other-project');
  assert.equal(startIsolatedDatabase(invalid.options), 1);
  assert.equal(invalid.calls.length, 0);
  assert.equal(invalid.records[0].report.failure, 'ISOLATED_WORKDIR_REQUIRED');
  for (const result of [{ status: null, error: new Error('do-not-record') }, { status: null, signal: 'SIGTERM' }]) {
    const f = startupFixture(result);
    assert.equal(startIsolatedDatabase(f.options), 1);
    assert.equal(f.records[0].report.failure, 'START_PROCESS_FAILED');
    assert.doesNotMatch(JSON.stringify(f.records), /do-not-record/);
  }
});

test('stage evidence retains failures and public image identities without step outputs or Docker secrets', () => {
  const records = [];
  const digest = 'sha256:' + 'a'.repeat(64);
  const options = {
    steps: { stack: { outcome: 'failure', outputs: { token: 'do-not-record' } }, migrations: { outcome: 'skipped' } },
    run: () => ({ status: 0, stdout: JSON.stringify({ Repository: 'public.ecr.aws/supabase/postgres',
      Tag: '17.6.1.156', ID: digest, Digest: digest, Secret: 'do-not-record' }) }),
    save: (name, report) => records.push({ name, report }),
  };
  assert.equal(collectDatabaseEvidence(options), 0);
  assert.deepEqual(records[0].report.failedStages, ['stack']);
  assert.deepEqual(records[0].report.images, [{ repository: 'public.ecr.aws/supabase/postgres',
    tag: '17.6.1.156', id: digest, digest }]);
  assert.doesNotMatch(JSON.stringify(records), /do-not-record/);
  options.run = () => ({ status: 1, stderr: 'do-not-record' });
  assert.equal(collectDatabaseEvidence(options), 1);
  assert.equal(records[1].report.imageInventoryAvailable, false);
  assert.deepEqual(records[1].report.failedStages, ['stack']);
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
