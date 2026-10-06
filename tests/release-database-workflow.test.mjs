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
const requestWorkflowBaseline = fs.readFileSync(new URL('../supabase/ci/request_workflow_baseline.sql', import.meta.url), 'utf8');
const departmentCalendarBaseline = fs.readFileSync(new URL('../supabase/ci/department_calendar_baseline.sql', import.meta.url), 'utf8');
const evalReport2Migration = fs.readFileSync(new URL('../supabase/archive_migrations/20260902002912_flatten_eval_reports_2_and_reconcile_work.sql', import.meta.url), 'utf8');

test('handover CI includes the production flyer row type before compiling the worker', () => {
  const fixture = fs.readFileSync(new URL('../supabase/ci/scheduled_handover_fixture.sql', import.meta.url), 'utf8');
  const baseline = fs.readFileSync(new URL('../supabase/migrations/20260929200000_production_baseline.sql', import.meta.url), 'utf8');
  const expected = baseline.match(/CREATE TABLE public\.ph_flyer_folder_rows \([\s\S]*?\n\);/)[0]
    .replace('CREATE TABLE public.', 'CREATE TABLE IF NOT EXISTS public.').replace(/\r\n/g, '\n');
  assert.ok(fixture.replace(/\r\n/g, '\n').includes(expected));
  assert.match(fixture, /ALTER TABLE public\.ph_flyer_folder_rows ENABLE ROW LEVEL SECURITY/);
  assert.match(fixture, /REVOKE ALL ON public\.ph_flyer_folder_rows FROM public, anon, authenticated/);
  assert.ok(workflow.indexOf('20261001215507_ci_scheduled_handover_fixture.sql') < workflow.indexOf('cp supabase/migrations/20261001215508_scheduled_handover_005.sql'));
});

test('handover CI includes every assignment target and the production Eval rule schema', () => {
  const fixture = fs.readFileSync(new URL('../supabase/ci/scheduled_handover_fixture.sql', import.meta.url), 'utf8');
  const baseline = fs.readFileSync(new URL('../supabase/migrations/20260929200000_production_baseline.sql', import.meta.url), 'utf8');
  const expected = baseline.match(/CREATE TABLE public\.ph_eval_assignment_rules \([\s\S]*?\n\);/)[0]
    .replace('CREATE TABLE public.', 'CREATE TABLE IF NOT EXISTS public.').replace(/\r\n/g, '\n');
  assert.ok(fixture.replace(/\r\n/g, '\n').includes(expected));
  assert.match(fixture, /ALTER TABLE public\.ph_eval_assignment_rules ENABLE ROW LEVEL SECURITY/);
  assert.match(fixture, /REVOKE ALL ON public\.ph_eval_assignment_rules FROM public, anon, authenticated/);
  const sources = [...workflow.matchAll(/cp (supabase\/(?:ci|archive_migrations|migrations)\/\S+\.sql) /g)]
    .map(match => fs.readFileSync(new URL(`../${match[1]}`, import.meta.url), 'utf8')).join('\n');
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261001222228_handover_assignment_transfer_005.sql', import.meta.url), 'utf8');
  const targets = [...migration.matchAll(/\('(ph_\w+)','\w+',array\[/g)].map(match => match[1]);
  assert.ok(targets.length >= 7);
  for (const table of new Set(targets)) {
    assert.match(sources, new RegExp(`create table (?:if not exists )?public\\.${table}\\s*\\(`, 'i'), `${table} must exist in the isolated replay`);
  }
});

test('handover fixture accounts retain sequence and historical permission-audit contracts', () => {
  const fixture = fs.readFileSync(new URL('../supabase/ci/scheduled_handover_fixture.sql', import.meta.url), 'utf8');
  assert.match(fixture, /setval\(pg_get_serial_sequence\('public\.ph_app_users','id'\),\s+greatest\(\(select max\(id\) from public\.ph_app_users\), 74\), true\)/);
  assert.match(fixture, /insert into private\.app_access_legacy_baseline\(profile_id,permission_key,allowed,access_scope\)/);
  assert.match(fixture, /private\.get_effective_app_permissions_v1\(p\.id,private\.resolve_app_access_policy_id_v1\(true\)\)/);
  assert.match(fixture, /e\.permission_key in \('drive\.reclass\.submit','manager\.orders\.view'\)/);
  assert.match(fixture, /on conflict\(profile_id,permission_key\) do nothing/);
});

test('perennial and Pikes SQL fixtures only call documented pgTAP assertions', () => {
  // Assertion names are checked against pgTAP's public API documentation:
  // https://pgtap.org/documentation.html (plan, ok, is, isnt, throws_ok,
  // lives_ok, matches, has_table, has_column, has_function, has_index).
  const documented = new Set(['plan', 'ok', 'is', 'isnt', 'throws_ok', 'lives_ok', 'matches', 'has_table', 'has_column', 'has_function', 'has_index']);
  for (const filename of ['perennial_zone_assignment_test.sql', 'pikes_orders_rls_test.sql']) {
    const source = fs.readFileSync(new URL(`../supabase/tests/${filename}`, import.meta.url), 'utf8');
    const calls = [...source.matchAll(/^\s*select\s+([a-z_]+)\s*\(/gim)].map(match => match[1].toLowerCase());
    const assertions = calls.filter(name => !['set_config', 'count'].includes(name));
    assert.ok(assertions.length > 0, `${filename} contains pgTAP assertions`);
    assert.deepEqual([...new Set(assertions.filter(name => !documented.has(name)))], [], `${filename} uses only documented pgTAP APIs`);
    assert.doesNotMatch(source, /\bis_null\s*\(/i, `${filename} does not use the nonexistent is_null assertion`);
  }
});

test('request workflow baseline provides the text hold start date consumed by Eval Report #2', () => {
  const inventory = requestWorkflowBaseline.match(/create table if not exists public\.ph_master_inventory\s*\(([\s\S]*?)\n\);/i);
  assert.ok(inventory, 'CI baseline defines the legacy master inventory table');
  assert.match(inventory[1], /\bholdstopbegindate\s+text\b/i);
  assert.match(evalReport2Migration, /eval_report2_inventory_date_v1\(m\.holdstopbegindate\)/i);
});

test('isolated database stages the existing calendar before the HR migration', () => {
  assert.match(departmentCalendarBaseline, /create table public\.ph_department_calendar_events\s*\(/i);
  assert.match(departmentCalendarBaseline, /unique_id text primary key/i);
  assert.match(departmentCalendarBaseline, /assigned_usernames jsonb/i);
  assert.doesNotMatch(departmentCalendarBaseline, /hr_source_event_id/i);
  assert.match(workflow, /cp supabase\/ci\/department_calendar_baseline\.sql "\$ci_root\/supabase\/migrations\/20260929200001_ci_department_calendar_baseline\.sql"/);
  assert.match(workflow, /cp supabase\/migrations\/20261001025638_aura_hr_command_center_v1\.sql/);
});

test('database reusable workflow is secret-free and has read-only repository permissions', () => {
  assert.match(workflow, /on:\s+workflow_call:/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.doesNotMatch(workflow, /secrets:|secrets\.|id-token:|contents: write|PRODUCTION_|--linked|--db-url|db push|functions deploy/);
  assert.match(workflow, /node-version: 22\s+cache: npm/);
});

test('Edge Function CI resolves pinned npm imports used by the push sender', () => {
  const edge = databaseJob.steps.find(step => step.name === 'Run Edge Function unit tests');
  assert.ok(edge);
  for (const line of edge.run.split('\n').filter(line => /^\s*deno (?:check|test)\b/.test(line))) {
    assert.match(line, /--node-modules-dir=auto/, 'Deno must install pinned npm imports before checking or testing');
  }
});

test('archived regression migrations and pgTAP tests remain staged in the isolated database fixture', () => {
  const migrations = [...workflow.matchAll(/cp supabase\/archive_migrations\/(\S+)/g)].map(match => match[1]);
  assert.equal(migrations.length, 128);
  assert.equal(new Set(migrations).size, migrations.length);
  for (const filename of migrations) {
    assert.ok(fs.existsSync(new URL(`../supabase/archive_migrations/${filename}`, import.meta.url)), filename);
  }
  const activeMigrations = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(filename => filename.endsWith('.sql'));
  assert.deepEqual(activeMigrations, [
    '20260929200000_production_baseline.sql',
    '20260930183036_grower_row_scout_fields.sql',
    '20260930205254_season_sales_business_conflicts_use_pt409.sql',
    '20261001012038_production_schedule_snapshot_v1.sql',
    '20261001025638_aura_hr_command_center_v1.sql',
    '20261001215508_scheduled_handover_005.sql',
    '20261001215511_request_archive_005.sql',
    '20261001222228_handover_assignment_transfer_005.sql',
    '20261002014421_index_request_history_assigned_rep_006.sql',
    '20261002121446_aura_inventory_v2_007.sql',
      '20261002134138_nelly_access_audit_baseline_repair_007.sql',
    '20261002155017_eval_delivery_archive_health_007.sql',
    '20261002204108_aura_inventory_match_010.sql',
    '20261003025749_aura_llm_free_tier_011.sql',
    '20261004010000_company_directory.sql',
    '20261005194158_suspend_tag_approval_loop.sql',
    '20261005225759_structured_bunch_notes.sql',
    '20261006110751_bunch_note_per_card_work.sql',
    '20261006111244_bunch_note_card_commands.sql',
  ]);
  const pt409Fixture = 'cp supabase/migrations/20260930205254_season_sales_business_conflicts_use_pt409.sql "$ci_root/supabase/migrations/"';
  assert.ok(workflow.includes(pt409Fixture), 'the current PT409 migration is staged in the isolated database fixture');
  assert.ok(workflow.indexOf(pt409Fixture) > workflow.lastIndexOf('cp supabase/archive_migrations/'),
    'the PT409 migration applies after historical fixtures install the legacy Season Sales RPC definitions');
  assert.ok(workflow.includes('archive_migrations in this disposable project only'));
  assert.ok(workflow.includes('cp supabase/ci/suspend_tag_approval_baseline.sql "$ci_root/supabase/migrations/20261005194157_ci_suspend_tag_approval_baseline.sql"'));
  assert.ok(workflow.includes('cp supabase/migrations/20261004010000_company_directory.sql "$ci_root/supabase/migrations/"'),
    'the Company Directory migration is staged for the isolated database fixture');
  for (const filename of [
    '20260928145055_item_low_stock_targets.sql',
    '20260929013125_perennial_zone_assignment_override.sql',
    '20260929160000_password_change_profile_reconciliation.sql',
    '20260901024608_drive_eval_shear_location_inquiries_v1.sql',
    '20260901043510_harden_shear_location_rls.sql',
    '20260901135456_drive_shear_location_access_audit_baseline_v1.sql',
    '20260929000151_stabilize_manager_rpc_conflicts_and_photo_refresh.sql',
    '20260922233000_manager_season_priority_inquiry_v1.sql',
    '20260923174000_optimize_manager_season_priority_scope.sql',
    '20260923222348_materialize_manager_season_priority_scope_hashes.sql',
    '20260924115226_sales_history_customer_docks_ownership.sql',
    '20260924145431_incident_pause_request_delivery_wakes.sql',
    '20260924145930_incident_pause_request_delivery_claims.sql',
    '20260924155225_request_metadata_notification_guard.sql',
    '20260924155542_restore_request_delivery_after_metadata_guard.sql',
    '20260924172552_request_drive_evidence_reset_guard.sql',
    '20260924181019_optimize_request_history_read_projection.sql',
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
  const shearMigrationOrder = [
    '20260901024608_drive_eval_shear_location_inquiries_v1.sql',
    '20260901043510_harden_shear_location_rls.sql',
    '20260901135456_drive_shear_location_access_audit_baseline_v1.sql',
    '20260929000151_stabilize_manager_rpc_conflicts_and_photo_refresh.sql',
  ].map(filename => migrations.indexOf(filename));
  assert.ok(shearMigrationOrder.every((index, offset) => index >= 0 && (!offset || shearMigrationOrder[offset - 1] < index)),
    'Shear schema, deny policies, audit baseline, and RPC replacement apply in dependency order');
  const sqlTests = [
    ...[...workflow.matchAll(/cp supabase\/tests\/(\S+)/g)].map(match => match[1]),
    ...[...workflow.matchAll(/"([a-z_]+_test\.sql)": "[a-z_]+_checks"/g)].map(match => match[1]),
  ];
  assert.deepEqual([...sqlTests].sort(), [
    'production_schedule_cards_006_test.sql',
    'aura_inventory_v2_007_test.sql',
    'aura_inventory_match_010_test.sql',
    'aura_llm_011_test.sql',
    'nelly_access_audit_baseline_repair_007_test.sql',
    'password_change_profile_reconciliation_test.sql',
    'perennial_zone_assignment_test.sql',
    'eval_item_low_stock_targets_test.sql',
    'manager_season_priority_test.sql',
    'bunch_note_workflow_test.sql', 'bunch_note_per_card_test.sql', 'native_auth_rls_test.sql', 'request_integrity_rls_test.sql', 'codex_ops_rls_test.sql',
    'pikes_orders_rls_test.sql', 'request_eval_drive_reliability_test.sql',
    'reclass_review_assignedto_test.sql', 'request_option_append_test.sql',
    'drive_reclass_protected_test.sql', 'drive_evidence_retry_storm_test.sql',
    'shear_location_inquiry_v1_test.sql',
    'photo_delivery_health_rls_test.sql', 'photo_history_rls_test.sql',
    'function_search_path_pinning_test.sql', 'season_sales_done_lifecycle_test.sql',
    'season_sales_av_note_retention_test.sql', 'season_sales_av_note_reset_test.sql',
    'photo_evidence_projection_test.sql',
    'grouped_eval_itemcode_health_test.sql',
    'hl_order_lifecycle_test.sql', 'hl_order_delivery_test.sql', 'hl_order_ship_dates_test.sql', 'hl_order_po_receipts_test.sql',
    'hl_order_restock_test.sql', 'hl_po_seasons_test.sql', 'hl_po_health_test.sql',
    'hr_command_center_behavior_test.sql', 'hr_command_center_schema_test.sql',
    'scheduled_handover_005_test.sql',
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

test('handover cron is disabled inside the disposable migration transaction only', () => {
  const isolation = fs.readFileSync(new URL('../supabase/ci/scheduled_handover_isolation.sql', import.meta.url), 'utf8');
  assert.match(isolation, /select cron\.alter_job\(jobid, active := false\)\s+from cron\.job where jobname='scheduled_handover_kayla_nelly_20261002'/);
  assert.doesNotMatch(isolation, /(?:update|delete from)\s+cron\.job/i);
  assert.match(workflow, /source\[:-len\("commit;"\)\] \+ isolation \+ "\\ncommit;\\n"/);
  const productionRunner = fs.readFileSync(new URL('../scripts/apply-item-low-stock-migration.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(productionRunner, /scheduled_handover_isolation/);
});

test('audit baseline repair checks both historical-row preservation and missing-row insertion in isolation', () => {
  const snapshot = workflow.indexOf('cp supabase/ci/nelly_access_audit_baseline_snapshot_fixture.sql');
  const repair = workflow.indexOf('cp supabase/migrations/20261002134138_nelly_access_audit_baseline_repair_007.sql');
  assert.ok(snapshot > workflow.indexOf('cp supabase/ci/scheduled_handover_fixture.sql') && repair > snapshot);
  assert.match(workflow, /20261002134137_ci_nelly_baseline_snapshot\.sql/);
  assert.match(workflow, /node supabase\/ci\/nelly_access_audit_baseline_pglite\.mjs --pglite-root "\$pglite_root"/);
  const runner = fs.readFileSync(new URL('../scripts/apply-item-low-stock-migration.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(runner, /nelly_access_audit_baseline_snapshot_fixture|ci_nelly_baseline_snapshot/);
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
    'CI=true REQUEST_HISTORY_TEST_DB_URL="$DB_URL" node scripts/test-request-history-scale.mjs',
    'npx playwright test --config playwright.database.config.ts --project=chromium',
    'deno test --node-modules-dir=auto --allow-env --allow-net supabase/functions',
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
