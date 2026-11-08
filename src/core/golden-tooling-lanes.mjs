import assert from 'node:assert/strict';
import { runToolingReleaseChecks, toolingPerformanceCheckFile, toolingReleaseCheckFiles } from '../../scripts/run-tooling-release-checks.mjs';

export function assertIsolatedToolingBenchmark() {
  const calls = [], good = '# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n';
  const result = runToolingReleaseChecks({ now:()=>0, print(){}, error(){}, spawn(_command,args) {
    calls.push(args);
    return { status:0, stdout:good };
  } });
  assert.equal(result.passed, 2);
  assert.deepEqual(calls[0].slice(-2), ['--test-concurrency=1', toolingPerformanceCheckFile]);
  assert.deepEqual(calls[1].slice(-toolingReleaseCheckFiles.length), toolingReleaseCheckFiles);
  assert.ok(calls[1].includes('--test-concurrency=8'));
  let attempts = 0;
  const failed = runToolingReleaseChecks({ now:()=>0, print(){}, error(){}, spawn() {
    attempts++;
    return { status:0, stdout:'# pass 1\n# fail 0\n# cancelled 1\n# skipped 0\n' };
  } });
  assert.equal(failed.exitCode, 1);
  assert.equal(attempts, 1);
}
