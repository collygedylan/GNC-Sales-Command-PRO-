import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gitRepositoryContextEnvironment } from '../scripts/git-repository-context.mjs';
import { runNode } from '../scripts/tooling-process.mjs';

const runGit = (cwd, args, env = process.env) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
const fixtureGitEnv = gitRepositoryContextEnvironment();

test('the merged process runner cannot reintroduce a hook index into test children', () => {
  const original = process.env.GIT_INDEX_FILE;
  try {
    process.env.GIT_INDEX_FILE = 'enclosing-hook-index';
    const cleanEnv = gitRepositoryContextEnvironment();
    const result = runNode(['-e', 'process.stdout.write(String("GIT_INDEX_FILE" in process.env))'],
      { env: cleanEnv, capture: true });
    assert.equal(result, 'false');
    assert.equal(process.env.GIT_INDEX_FILE, 'enclosing-hook-index');
  } finally {
    if (original === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = original;
  }
});

test('foreign Git fixtures ignore an enclosing hook index and leave it untouched', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'gnc-git-context-'));
  const outer = path.join(root, 'outer');
  const fixture = path.join(root, 'fixture');
  const expectedTmp = path.resolve(tmpdir()) + path.sep;
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(expectedTmp));
    rmSync(root, { recursive: true, force: true });
  });

  const cleanEnv = gitRepositoryContextEnvironment({ env: {
    ...process.env,
    GIT_DIR: path.join(outer, '.git'),
    GIT_WORK_TREE: outer,
    GIT_INDEX_FILE: path.join(outer, '.git', 'index'),
    GIT_COMMON_DIR: path.join(outer, '.git'),
  } });
  assert.equal(cleanEnv.GIT_DIR, undefined);
  assert.equal(cleanEnv.GIT_WORK_TREE, undefined);
  assert.equal(cleanEnv.GIT_INDEX_FILE, undefined);
  assert.equal(cleanEnv.GIT_COMMON_DIR, undefined);

  runGit(root, ['init', '--quiet', outer], fixtureGitEnv);
  writeFileSync(path.join(outer, 'outer.txt'), 'outer state\n');
  runGit(outer, ['add', 'outer.txt'], fixtureGitEnv);
  runGit(outer, ['-c', 'user.name=Outer Fixture', '-c', 'user.email=outer@example.invalid', 'commit', '--quiet', '-m', 'outer'], fixtureGitEnv);
  const outerIndex = readFileSync(path.join(outer, '.git', 'index'));

  runGit(root, ['init', '--quiet', fixture], cleanEnv);
  writeFileSync(path.join(fixture, 'fixture.txt'), 'fixture state\n');
  runGit(fixture, ['add', 'fixture.txt'], cleanEnv);
  assert.equal(runGit(fixture, ['ls-files', '--error-unmatch', 'fixture.txt'], cleanEnv).toString().trim(), 'fixture.txt');

  assert.deepEqual(readFileSync(path.join(outer, '.git', 'index')), outerIndex);
  assert.equal(runGit(outer, ['ls-files', '--error-unmatch', 'outer.txt'], fixtureGitEnv).toString().trim(), 'outer.txt');
});
