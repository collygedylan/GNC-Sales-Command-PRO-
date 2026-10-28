import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Explicit registry shared by the fast architecture/governance contracts.
export const toolingSkillManifests = Object.freeze([
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
].map(name => `.codex/skills/${name}/SKILL.md`));

export const toolingReleaseCheckFiles = Object.freeze([
  'scripts/enforce-all-14-gems-gate.mjs',
  'tests/golden-invariants.test.mjs',
  'tests/user-access-lifecycle.test.mjs',
  'tests/release-scope.test.mjs',
  'tests/main-release-registration.test.mjs',
  'tests/tooling-release-runner.test.mjs',
  'tests/code-health-governance.test.mjs',
  'tests/agdata-governance.test.mjs',
  'tests/agdata-architecture.test.mjs',
]);

export function runToolingReleaseChecks({ spawn = spawnSync, now = () => performance.now(), print = console.log,
  error = console.error } = {}) {
  const started = now();
  const result = spawn(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...toolingReleaseCheckFiles], {
    cwd: root, encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024,
    windowsHide: true, timeout: 45000,
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
