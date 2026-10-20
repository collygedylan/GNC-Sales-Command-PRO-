import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const checks = [
  'tests/release-scope.test.mjs',
  'tests/release-pipeline.test.mjs',
  'tests/release-publish-candidate.test.mjs',
  'tests/apps-script-deployment-guard.test.mjs',
  'tests/agdata-governance.test.mjs',
  'tests/release-check-execution.test.mjs',
  'tests/scoped-release-deployment.test.mjs',
  'tests/pipeline-policy.test.mjs',
  'tests/v2311-release-gates.test.mjs',
  'tests/v2313-release-contract.test.mjs',
  'tests/release-smoke-artifacts.test.mjs',
  'tests/validation-config.test.mjs',
];

const started = performance.now();
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...checks], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
});
const elapsedSeconds = ((performance.now() - started) / 1000).toFixed(1);

if (result.error) {
  console.error(result.error);
  process.exitCode = 1;
} else if (result.status !== 0) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.error(`Tooling release checks failed (exit ${result.status}; ${elapsedSeconds}s).`);
  process.exitCode = result.status || 1;
} else {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const passed = Number(output.match(/^# pass (\d+)$/m)?.[1] || [...output.matchAll(/^ok \d+ - /gm)].length);
  const fixture = output.match(/PREINDEXED_PAGE_METRIC rows=(\d+) samples=(\d+) max_ms=([\d.]+)/);
  console.log(`Tooling release checks passed (${passed} tests, ${elapsedSeconds}s).`);
  if (fixture) console.log(`Fixture: ${fixture[1]} rows, ${fixture[2]} warm page calls, maximum ${fixture[3]} ms.`);
}
