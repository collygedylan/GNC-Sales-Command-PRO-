import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearForeignGitEnvironment } from '../../scripts/source-git-environment.mjs';

function git(cwd, args, env = process.env) {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true }).trim();
}

export function assertSourceGitWorktreeIsolation() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'source-git-env-'));
  try {
    git(base, ['init', '--quiet']);
    git(base, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'initial']);
    const linked = path.join(base, 'linked');
    git(base, ['worktree', 'add', '--quiet', '--detach', linked]);
    writeFileSync(path.join(base, 'source.txt'), 'source\n');
    git(base, ['add', 'source.txt']);
    const foreign = {
      ...process.env, GIT_DIR: git(linked, ['rev-parse', '--absolute-git-dir']),
      GIT_WORK_TREE: linked, GIT_INDEX_FILE: git(linked, ['rev-parse', '--path-format=absolute', '--git-path', 'index']),
    };
    assert.equal(git(base, ['rev-parse', '--show-toplevel'], foreign), linked.replaceAll('\\', '/'));
    clearForeignGitEnvironment(foreign);
    assert.equal(git(base, ['rev-parse', '--show-toplevel'], foreign), base.replaceAll('\\', '/'));
    assert.match(git(base, ['diff', '--cached', '--name-only'], foreign), /^source\.txt$/);
    assert.equal(git(linked, ['diff', '--cached', '--name-only']), '');
  } finally { rmSync(base, { recursive: true, force: true }); }
}
