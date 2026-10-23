import assert from 'node:assert/strict';
import test from 'node:test';
import { runToolingReleaseChecks, toolingReleaseCheckFiles } from '../scripts/run-tooling-release-checks.mjs';

test('daytime tooling runs only focused scope, registration, governance and mocked runner contracts', () => {
  assert.deepEqual(toolingReleaseCheckFiles, [
    'tests/release-scope.test.mjs', 'tests/main-release-registration.test.mjs',
    'tests/tooling-release-runner.test.mjs',
    'tests/code-health-governance.test.mjs',
    'tests/agdata-governance.test.mjs', 'tests/agdata-architecture.test.mjs',
  ]);
  const logs = [];
  const errors = [];
  let calls = 0;
  const result = runToolingReleaseChecks({ now: () => 0, print: message => logs.push(message), error: message => errors.push(message),
    spawn(command, args, options) {
      calls++;
      assert.equal(command, process.execPath);
      assert.deepEqual(args, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...toolingReleaseCheckFiles]);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 45000);
      assert.equal(options.windowsHide, true);
      return { status: 0, stdout: '# tests 7\n# pass 7\n# fail 0\n# cancelled 0\n# skipped 0\n' };
    },
  });
  assert.deepEqual(result, { exitCode: 0, passed: 7 });
  assert.equal(calls, 1);
  assert.equal(errors.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /7 tests/);
});

test('tooling failures and the bounded process timeout retain failure evidence', () => {
  for (const failure of [{ status: 3 }, { status: null, error: { code: 'ETIMEDOUT' } }, { status: null, error: { code: 'ENOENT' } }]) {
    const logs = [];
    const errors = [];
    const result = runToolingReleaseChecks({ spawn: () => ({ ...failure, stdout: 'failure detail', stderr: 'failure context' }),
      now: () => 0, print: message => logs.push(message), error: message => errors.push(message) });
    assert.equal(result.exitCode, failure.status || 1);
    assert.deepEqual(errors.slice(0, 2), ['failure detail', 'failure context']);
    assert.equal(logs.length, 0);
  }
});

test('an empty successful child cannot claim that checks passed', () => {
  const logs = [];
  const result = runToolingReleaseChecks({ spawn: () => ({ status: 0, stdout: '# pass 0\n' }),
    now: () => 0, print: message => logs.push(message), error() {} });
  assert.equal(result.exitCode, 1);
  assert.equal(logs.length, 0);
});

test('positive passes cannot hide failed, cancelled, skipped, or incomplete TAP summaries', () => {
  const summaries = [
    '# pass 1\n# fail 1\n# cancelled 0\n# skipped 0\n',
    '# pass 1\n# fail 0\n# cancelled 1\n# skipped 0\n',
    '# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n',
    '# pass 1\n',
    '# pass 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n',
  ];
  for (const stdout of summaries) {
    const logs = [];
    const errors = [];
    const result = runToolingReleaseChecks({ spawn: () => ({ status: 0, stdout }), now: () => 0,
      print: message => logs.push(message), error: message => errors.push(message) });
    assert.equal(result.exitCode, 1);
    assert.equal(logs.length, 0);
    assert.equal(errors[0], stdout);
  }
});
