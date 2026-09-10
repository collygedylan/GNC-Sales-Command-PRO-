import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release-database.yml', import.meta.url), 'utf8');
const browserConfig = fs.readFileSync(new URL('../playwright.database.config.ts', import.meta.url), 'utf8');
const provisioning = fs.readFileSync(new URL('./native-auth-provisioning-local.spec.js', import.meta.url), 'utf8');

test('database reusable workflow is secret-free and has read-only repository permissions', () => {
  assert.match(workflow, /on:\s+workflow_call:/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.doesNotMatch(workflow, /secrets:|secrets\.|id-token:|contents: write|PRODUCTION_|--linked|--db-url|db push|functions deploy/);
  assert.match(workflow, /node-version: 22\s+cache: npm/);
});

test('all original migration and sixteen pgTAP test files remain in the isolated database', () => {
  const migrations = [...workflow.matchAll(/cp supabase\/migrations\/(\S+)/g)].map(match => match[1]);
  assert.equal(migrations.length, 84);
  assert.equal(new Set(migrations).size, migrations.length);
  for (const filename of migrations) {
    assert.ok(fs.existsSync(new URL(`../supabase/migrations/${filename}`, import.meta.url)), filename);
  }
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
