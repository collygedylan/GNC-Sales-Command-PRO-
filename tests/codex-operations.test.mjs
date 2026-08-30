import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { validateChangedFiles } from '../scripts/validate-codex-mobile-patch.mjs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260830021512_mobile_codex_operations_v1.sql');
const escalationMigration = read('../supabase/migrations/20260830022003_codex_ops_terra_escalation_v2.sql');
const api = read('../supabase/functions/codex-ops-api/index.ts');
const runner = read('../supabase/functions/codex-ops-runner/index.ts');
const githubApp = read('../supabase/functions/_shared/github-app.ts');
const workflow = read('../.github/workflows/codex-ops.yml');
const maintenance = read('../.github/workflows/codex-ops-maintenance.yml');
const pathWorkflow = read('../.github/workflows/codex-mobile-path-policy.yml');
const html = read('../index.html');
const healthProbe = read('../scripts/probe-production-auth-health.mjs');

test('private Codex control-plane tables are RLS protected and clients get RPCs only', () => {
  for (const table of ['tasks', 'messages', 'events', 'attachments', 'approvals', 'dispatches', 'audit_events']) {
    assert.match(migration, new RegExp(`create table if not exists private\\.codex_ops_${table}`));
    assert.match(migration, new RegExp(`alter table private\\.codex_ops_${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table private\\.codex_ops_${table} from public, anon, authenticated`));
  }
  assert.match(migration, /private\.require_codex_ops_dylan_v1/);
  assert.match(migration, /lower\(btrim\(p\.username\)\) = 'dylan_collyge'/);
  assert.match(migration, /CODEX_OPS_REVISION_CONFLICT/);
  assert.match(migration, /CODEX_OPS_HEAD_CHANGED/);
  assert.match(migration, /codex_ops_enabled', false, 0/);
  assert.match(migration, /codex_ops_deploy_enabled', false, 0/);
  assert.match(migration, /get_codex_ops_health_snapshot_v1/);
  assert.match(escalationMigration, /CODEX_OPS_FINGERPRINT_REPAIR_LIMIT/);
  assert.match(escalationMigration, /status = 'needs_escalation'/);
  assert.match(runner, /apply_codex_ops_repair_result_service_v2/);
  assert.match(migration, /CODEX_OPS_TASK_BUSY_OR_TERMINAL/);
});

test('evidence uses a private signed-token flow and verifies signatures and bounds', () => {
  assert.match(migration, /'codex-ops-evidence-v1'[\s\S]*false[\s\S]*157286400/);
  assert.match(api, /createSignedUploadUrl/);
  assert.match(api, /detectEvidenceMime/);
  assert.match(api, /Range: "bytes=0-511"/);
  assert.match(api, /CODEX_OPS_SIGNATURE_MISMATCH/);
  assert.doesNotMatch(api, /getPublicUrl/);
  assert.match(maintenance, /codex-ops-runner-client\.mjs cleanup/);
});

test('GitHub OIDC validation binds runner access to repository, workflow, ref, environment, and SHA', () => {
  for (const claim of ['issuer', 'audience', 'repository', 'workflow', 'ref', 'environment', 'runner', 'commit']) {
    assert.match(runner.toLowerCase(), new RegExp(`oidc_${claim}`));
  }
  assert.match(runner, /token\.actions\.githubusercontent\.com/);
  assert.match(runner, /RSASSA-PKCS1-v1_5/);
  assert.match(runner, /refs\/heads\/main/);
});

test('official Codex Action is immutable-pinned and model routing is bounded', () => {
  const pinned = /openai\/codex-action@86365089eb2b84e0a8fb0717b304f8bdcb13b20e/g;
  assert.equal((workflow.match(pinned) || []).length, 2);
  assert.match(workflow, /model:.*gpt-5\.6-luna/);
  assert.match(workflow, /model: gpt-5\.6-terra/);
  assert.match(workflow, /gpt-5\.6-sol/);
  assert.match(workflow, /permission-profile: :read-only/);
  assert.match(workflow, /permission-profile: :workspace/);
  assert.equal((workflow.match(/ACTIONS_ID_TOKEN_REQUEST_TOKEN: ''/g) || []).length, 2);
  assert.equal((workflow.match(/GITHUB_TOKEN: ''/g) || []).length, 2);
  assert.doesNotMatch(workflow, /self-hosted|pull_request_target/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /needs\.diagnose\.outputs\.repair_allowed == 'true'/);
});

test('publisher, exact SHA approval, required checks, and deterministic revert are separated', () => {
  assert.match(workflow, /publish:[\s\S]*contents: write/);
  assert.match(workflow, /git apply --check/);
  assert.match(workflow, /codex-mobile\/task-/);
  assert.match(workflow, /git revert --no-edit/);
  assert.match(workflow, /codex-mobile\/rollback-/);
  assert.match(githubApp, /head_sha: actualSha/);
  assert.match(githubApp, /commit-specific Dylan approval/);
  assert.match(githubApp, /sha: actualSha, merge_method: "squash"/);
  assert.match(pathWorkflow, /codex-mobile-path-policy/);
});

test('mobile path validator blocks security and operations surfaces', () => {
  const denied = validateChangedFiles([
    'supabase/migrations/evil.sql',
    'Code.gs',
    'assets/vendor/bundle.js',
    '.github/workflows/codex-ops.yml',
    'scripts/probe-production-auth-health.mjs',
  ]);
  assert.equal(denied.ok, false);
  assert.equal(validateChangedFiles(['index.html', 'tests/ui.test.mjs']).ok, true);
});

test('guarded monitoring exposes only a sanitized contract snapshot', () => {
  assert.match(healthProbe, /get_codex_ops_health_snapshot_v1/);
  assert.match(healthProbe, /production_codex_ops_contract_unhealthy/);
  assert.match(migration, /anonymous_table_access_denied/);
  assert.match(migration, /authenticated_table_access_denied/);
  assert.doesNotMatch(healthProbe, /codex_ops_tasks\?select/);
});

test('PWA module is Dylan-only, mobile-first, and exact-commit approval aware', () => {
  assert.match(html, /const MANAGER_CODEX_OPERATIONS_VIEW = 'codex-operations'/);
  assert.match(html, /getCodexOpsCurrentUserKey\(\) !== 'dylan_collyge'/);
  assert.match(html, /function renderCodexOperationsPanel/);
  assert.match(html, /function submitCodexOpsTask/);
  assert.match(html, /uploadToSignedUrl/);
  assert.match(html, /Approve and Deploy/);
  assert.match(html, /task\.pathPolicyPassed === true && task\.requiredChecksPassed === true/);
  assert.match(html, /min-height:44px/);
  assert.match(html, /body\.dark-mode \.codex-ops-panel/);
});
