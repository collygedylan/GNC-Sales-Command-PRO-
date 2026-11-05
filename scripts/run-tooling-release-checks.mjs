import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Explicit registry shared by the fast architecture/governance contracts.
export const toolingSkillManifests = Object.freeze([
  'agdata-request-queue-and-email-delivery-fortress',
  'agdata-mobile-touch-and-keypad-guardian',
  'agdata-supabase-quota-and-egress-guardian',
  'agdata-supabase-storage-and-db-hygiene-janitor',
  'agdata-supabase-schema-and-query-contract-guard',
  'agdata-cybersecurity-and-rls-fortress',
  'agdata-ip-and-code-theft-shield',
  'agdata-fast-release-and-ci-pipeline-guard',
  'agdata-smart-moves-and-gdd-hold-intelligence',
  'agdata-shear-crew-load-and-gdd-guard',
  'agdata-app-shell-and-navigation',
  'agdata-aura-assistant',
  'agdata-bloom-and-request-specialist',
  'agdata-docks-and-orders-specialist',
  'agdata-drive-and-av-specialist',
  'agdata-field-ops-and-qc',
  'agdata-email-outbox-and-worker-guard',
  'agdata-queue-and-reclass-specialist',
  'agdata-release-governor',
  'agdata-request-lifecycle-and-lock-guard',
  'agdata-runtime-watchdog',
  'agdata-skill-learner',
  'agdata-suspend-tag-approval-specialist',
  'agdata-sync-and-supabase-architect',
  'agdata-table-management-and-directory',
  'agdata-zero-lockout-guard',
  'agdata-zero-regression-mutation-engine',
  'agdata-access-and-permissions-governor',
  'agdata-access-and-permission-matrix',
  'gnc-president-master-orchestrator',
  'gnc-bed-and-hydro-supervisor',
  'gnc-planting-location-fallback-shield',
  'gnc-f1-sy27-movement-manager',
  'gnc-bunch-notes-and-schedule-ingest',
  'gnc-bunch-notes-rule-and-issue-auditor',
  'gnc-bunch-notes-multi-hop-sequencer',
  'gnc-bunch-notes-crew-and-ribbon-dispatcher',
  'gnc-cross-sheet-bunch-notes-linker',
  'gnc-consolidation-agent',
  'test-agdata-access-and-permission-matrix',
  'test-agdata-access-and-permissions-governor',
  'test-agdata-app-shell-and-navigation',
  'test-agdata-aura-assistant',
  'test-agdata-bloom-and-request-specialist',
  'test-agdata-docks-and-orders-specialist',
  'test-agdata-drive-and-av-specialist',
  'test-agdata-email-outbox-and-worker-guard',
  'test-agdata-field-ops-and-qc',
  'test-agdata-queue-and-reclass-specialist',
  'test-agdata-release-governor',
  'test-agdata-request-lifecycle-and-lock-guard',
  'test-agdata-runtime-watchdog',
  'test-agdata-shear-crew-load-and-gdd-guard',
  'test-agdata-skill-learner',
  'test-agdata-smart-moves-and-gdd-hold-intelligence',
  'test-agdata-supabase-quota-and-egress-guardian',
  'test-agdata-suspend-tag-approval-specialist',
  'test-agdata-sync-and-supabase-architect',
  'test-agdata-table-management-and-directory',
  'test-agdata-zero-lockout-guard',
  'test-agdata-zero-regression-mutation-engine',
  'test-agdata-sandbox-and-db-clone-architect',
  'test-agdata-hl-replenishment-and-c12-staging-specialist',
  'test-agdata-wingding-fleet-and-puller-quality-governor',
  'test-agdata-six-stage-dock-pipeline-orchestrator',
  'test-agdata-mistake-queue-and-line-split-specialist',
  'test-agdata-suspend-tag-location-replace-and-docks-sync',
  'test-agdata-traffic-dispatch-and-live-driver-rush-engine',
].map(name => `.codex/skills/${name}/SKILL.md`));

export const toolingReleaseCheckFiles = Object.freeze([
  'tests/release-automation.test.mjs',
  'tests/manager-table-workspace.test.mjs',
  'tests/supabase-quota-security.test.mjs',
  'tests/access-permission-workspace.test.mjs',
  'scripts/enforce-all-14-gems-gate.mjs',
  'tests/golden-invariants.test.mjs',
  'tests/completed-row-workflow.test.mjs',
  'tests/photo-suspend-recovery.test.mjs',
  'tests/user-access-lifecycle.test.mjs',
  'tests/request-capability-fallback.test.mjs',
  'tests/role-access-parity.test.mjs',
  'tests/release-scope.test.mjs',
  'tests/main-release-registration.test.mjs',
  'tests/tooling-release-runner.test.mjs',
  'tests/code-health-governance.test.mjs',
  'tests/agdata-governance.test.mjs',
  'tests/agdata-architecture.test.mjs',
  'tests/customer-mapping.test.mjs',
]);

export function runToolingReleaseChecks({ spawn = spawnSync, now = () => performance.now(), print = console.log,
  error = console.error, env = process.env } = {}) {
  const started = now();
  const fullAudit = env.AGDATA_FULL_AUDIT_ONCE === '1';
  delete env.AGDATA_FULL_AUDIT_ONCE; // Explicit one-run opt-in is never inherited by the next run.
  const result = spawn(process.execPath, ['--test', '--test-reporter=tap', `--test-concurrency=${fullAudit ? 1 : 8}`, ...toolingReleaseCheckFiles], {
    cwd: root, encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024,
    windowsHide: true, timeout: 75000, env: { ...env },
  });
  const elapsedSeconds = ((now() - started) / 1000).toFixed(1);

  if (result.error || result.status !== 0) {
    if (result.stdout) error(result.stdout);
    if (result.stderr) error(result.stderr);
    error(`Tooling release checks failed (${result.error?.code || `exit ${result.status}`}; ${elapsedSeconds}s).`);
    return { exitCode: Number.isInteger(result.status) && result.status > 0 ? result.status : 1 };
  }
  const output = String(result.stdout || '');
  const count = name => {
    const matches = [...output.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
    return matches.length === 1 ? Number(matches[0][1]) : null;
  };
  const passed = count('pass');
  if (!(passed > 0) || ['fail', 'cancelled', 'skipped'].some(name => count(name) !== 0)) {
    if (output) error(output);
    error('Tooling release checks require passing tests with no failed, cancelled, or skipped checks.');
    return { exitCode: 1 };
  }
  print(`Tooling release checks passed (${passed} tests, ${elapsedSeconds}s).`);
  return { exitCode: 0, passed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runToolingReleaseChecks().exitCode;
}
