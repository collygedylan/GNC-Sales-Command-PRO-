import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
// Explicit registry shared by the fast architecture/governance contracts.
export const toolingSkillManifests = Object.freeze([
  'agdata-adaptive-model-policy',
  'agdata-live-pwa-card-truth-guardian',
  'agdata-cross-gem-memory-bus-orchestrator',
  'agdata-db-berkeley-wal-realtime-and-quota-sre',
  'agdata-db-cmu-chief-schema-and-constraint-architect',
  'agdata-db-harvard-etl-staging-and-sync-pipeline-engineer',
  'agdata-db-mit-plpgsql-rpc-and-trigger-engineer',
  'agdata-db-stanford-query-planner-and-index-optimizer',
  'agdata-db-yale-clone-isolation-and-rls-auditor',
  'agdata-hl-replenishment-and-c12-staging-specialist',
  'agdata-it-berkeley-security-and-rls-ciso',
  'agdata-it-caltech-release-and-sandbox-devops-chief',
  'agdata-it-harvard-formal-verification-and-qa-director',
  'agdata-it-mit-principal-systems-architect',
  'agdata-it-stanford-db-and-realtime-sre',
  'agdata-it-yale-ui-ux-and-table-ergonomics-dean',
  'agdata-mistake-queue-and-line-split-specialist',
  'agdata-sandbox-and-db-clone-architect',
  'agdata-six-stage-dock-pipeline-orchestrator',
  'agdata-suspend-tag-location-replace-and-docks-sync',
  'agdata-traffic-dispatch-and-live-driver-rush-engine',
  'agdata-wingding-fleet-and-puller-quality-governor',
  'gnc-2027-production-optimizer',
  'gnc-can-filling-agent',
  'gnc-cuttings-agent',
  'gnc-future-inventory-reconciler',
  'gnc-planting-agent',
  'gnc-prod-schedule-demand-cutoff-analyst',
  'gnc-sheet-header-architect',
  'gnc-shift-haul-and-schedule-navigator',
  'gnc-sticking-agent',
  'nursery-production-reconciler',
  'test-agdata-cross-gem-memory-bus-orchestrator',
  'test-agdata-cybersecurity-and-rls-fortress',
  'test-agdata-db-berkeley-wal-realtime-and-quota-sre',
  'test-agdata-db-cmu-chief-schema-and-constraint-architect',
  'test-agdata-db-harvard-etl-staging-and-sync-pipeline-engineer',
  'test-agdata-db-mit-plpgsql-rpc-and-trigger-engineer',
  'test-agdata-db-stanford-query-planner-and-index-optimizer',
  'test-agdata-db-yale-clone-isolation-and-rls-auditor',
  'test-agdata-fast-release-and-ci-pipeline-guard',
  'test-agdata-ip-and-code-theft-shield',
  'test-agdata-it-berkeley-security-and-rls-ciso',
  'test-agdata-it-caltech-release-and-sandbox-devops-chief',
  'test-agdata-it-harvard-formal-verification-and-qa-director',
  'test-agdata-it-mit-principal-systems-architect',
  'test-agdata-it-stanford-db-and-realtime-sre',
  'test-agdata-it-yale-ui-ux-and-table-ergonomics-dean',
  'test-agdata-mobile-touch-and-keypad-guardian',
  'test-agdata-request-queue-and-email-delivery-fortress',
  'test-agdata-supabase-schema-and-query-contract-guard',
  'test-agdata-supabase-storage-and-db-hygiene-janitor',
  'test-gnc-2027-production-optimizer',
  'test-gnc-bed-and-hydro-supervisor',
  'test-gnc-bunch-notes-and-schedule-ingest',
  'test-gnc-bunch-notes-crew-and-ribbon-dispatcher',
  'test-gnc-bunch-notes-multi-hop-sequencer',
  'test-gnc-bunch-notes-rule-and-issue-auditor',
  'test-gnc-can-filling-agent',
  'test-gnc-consolidation-agent',
  'test-gnc-cross-sheet-bunch-notes-linker',
  'test-gnc-cuttings-agent',
  'test-gnc-f1-sy27-movement-manager',
  'test-gnc-future-inventory-reconciler',
  'test-gnc-planting-agent',
  'test-gnc-planting-location-fallback-shield',
  'test-gnc-president-master-orchestrator',
  'test-gnc-prod-schedule-demand-cutoff-analyst',
  'test-gnc-sheet-header-architect',
  'test-gnc-shift-haul-and-schedule-navigator',
  'test-gnc-sticking-agent',
  'test-nursery-production-reconciler',
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

export const toolingModularAgentManifests = Object.freeze([
  'agdata-core-sync',
  'agdata-canonical-engine',
  'agdata-views-workflows',
  'agdata-ui-shell',
  'agdata-services-release',
  'gnc-production-schedule-pipeline',
  'gnc-bunch-notes-and-hydro-engine',
  'gnc-nursery-stage-operations',
  'argos-erp-operations-and-orders',
  'argos-erp-finance-and-mobile-ui',
].map(name => `.agents/skills/${name}/SKILL.md`));

export const toolingReleaseCheckFiles = Object.freeze([
  'tests/anti-spaghetti-lock.test.mjs',
  'tests/release-automation.test.mjs',
  'tests/manager-table-workspace.test.mjs',
  'tests/manager-workspace-restoration.test.mjs',
  'tests/modular-agent-skills.test.mjs',
  'tests/apps-script-fingerprint-repair.test.mjs',
  'tests/maintenance-database-target.test.mjs',
  'tests/production-database-maintenance.test.mjs',
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

function runCapturedChecks(spawn, args, env, timeout) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agdata-tooling-'));
  const stdoutPath = path.join(directory, 'stdout');
  const stderrPath = path.join(directory, 'stderr');
  let stdoutFd;
  let stderrFd;
  try {
    stdoutFd = fs.openSync(stdoutPath, 'w');
    stderrFd = fs.openSync(stderrPath, 'w');
    const result = spawn(process.execPath, args, {
      cwd: root, stdio: ['ignore', stdoutFd, stderrFd], shell: false,
      windowsHide: true, timeout, env: { ...env },
    });
    return {
      ...result,
      stdout: result.stdout ?? fs.readFileSync(stdoutPath, 'utf8'),
      stderr: result.stderr ?? fs.readFileSync(stderrPath, 'utf8'),
    };
  } finally {
    if (stdoutFd !== undefined) fs.closeSync(stdoutFd);
    if (stderrFd !== undefined) fs.closeSync(stderrFd);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export const toolingPerformanceCheckFile = 'tests/canonical-row-owner-performance.test.mjs';
export const toolingReleaseDeadlineMs = 120000;
const performanceLaneDeadlineMs = 75000;
const goldenReleaseCheckFile = 'tests/golden-invariants.test.mjs';

function parseToolingSummary(output) {
  const count = name => {
    const matches = [...output.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
    const value = matches.length === 1 ? Number(matches[0][1]) : null;
    return Number.isSafeInteger(value) ? value : null;
  };
  const passed = count('pass');
  if (!(passed > 0) || count('tests') !== passed) return null;
  if (['fail', 'cancelled', 'skipped', 'todo'].some(name => count(name) !== 0)) return null;
  return passed;
}

function runToolingLane({ spawn, args, env, timeout, error, label }) {
  const result = runCapturedChecks(spawn, args, env, timeout);
  if (result.error || result.status !== 0) {
    if (result.stdout) error(result.stdout);
    if (result.stderr) error(result.stderr);
    error(`Tooling ${label} checks failed (${result.error?.code || `exit ${result.status}`}).`);
    return { exitCode: Number.isInteger(result.status) && result.status > 0 ? result.status : 1 };
  }
  const passed = parseToolingSummary(String(result.stdout || ''));
  if (passed === null) {
    if (result.stdout) error(result.stdout);
    error(`Tooling ${label} checks require one complete summary with every test passing.`);
    return { exitCode: 1 };
  }
  return { exitCode: 0, passed };
}

export function runToolingReleaseChecks({ spawn = spawnSync, now = () => performance.now(), print = console.log,
  error = console.error, env = process.env } = {}) {
  const started = now();
  const fullAudit = env.AGDATA_FULL_AUDIT_ONCE === '1';
  delete env.AGDATA_FULL_AUDIT_ONCE;
  const prefix = ['--test', '--test-reporter=./scripts/compact-test-reporter.mjs'];
  const performanceLane = runToolingLane({ spawn, env, error, label:'performance', timeout:performanceLaneDeadlineMs,
    args:[...prefix, '--test-concurrency=1', toolingPerformanceCheckFile] });
  if (performanceLane.exitCode) return performanceLane;
  const remaining = toolingReleaseDeadlineMs - (now() - started);
  if (remaining <= 0) {
    error(`Tooling release checks exceeded the ${toolingReleaseDeadlineMs / 1000}-second deadline.`);
    return { exitCode: 1 };
  }
  const normalLane = runToolingLane({ spawn, env, error, label:'functional', timeout:Math.max(1, Math.floor(remaining)),
    args:['scripts/tooling-test-worker.mjs', `--test-concurrency=${fullAudit ? 1 : 4}`, goldenReleaseCheckFile,
      ...toolingReleaseCheckFiles.filter(file => file !== goldenReleaseCheckFile)] });
  if (normalLane.exitCode) return normalLane;
  const passed = performanceLane.passed + normalLane.passed;
  print(`Tooling release checks passed (${passed} tests, ${((now() - started) / 1000).toFixed(1)}s).`);
  return { exitCode: 0, passed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runToolingReleaseChecks().exitCode;
}
