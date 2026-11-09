import assert from 'node:assert/strict';
import {
  collectReleaseUnitTestFiles,
  runReleaseUnitChecks,
} from '../../scripts/run-release-unit-checks.mjs';

export function assertReleaseUnitRunnerExecution(root) {
  const calls = [];
  const status = runReleaseUnitChecks({ rootDir: root, print() {}, spawn(...args) {
    calls.push(args);
    return { status: calls.length === 1 ? 7 : 0 };
  } });
  const fastLock = 'tests/fast-regression-lock.test.mjs';
  const serialArgs = ['--test', '--test-concurrency=1'];
  assert.equal(status, 7);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0][1], [...serialArgs, fastLock]);
  assert.deepEqual(calls[1][1], [
    ...serialArgs,
    ...collectReleaseUnitTestFiles(root).filter(file => file !== fastLock),
  ]);
  for (const [executable, , options] of calls) {
    assert.equal(executable, process.execPath);
    assert.equal(options.cwd, root);
    assert.equal(options.stdio, 'inherit');
    assert.equal(options.env, process.env);
  }
  assert.equal(runReleaseUnitChecks({ print() {}, spawn: () => ({ status: null }) }), 1);
  assert.throws(
    () => runReleaseUnitChecks({ print() {}, spawn: () => ({ error: new Error('spawn failed') }) }),
    /spawn failed/,
  );
}

export function assertReleaseUnitRunnerListMode(root) {
  const output = [];
  const status = runReleaseUnitChecks({
    rootDir: root,
    argv: ['--list'],
    print: value => output.push(value),
    spawn: () => assert.fail('list mode must not run tests'),
  });
  assert.equal(status, 0);
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), collectReleaseUnitTestFiles(root));
  assert.throws(() => runReleaseUnitChecks({ argv: ['--unknown'] }), /Usage:/);
}
