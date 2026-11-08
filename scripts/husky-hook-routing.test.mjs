import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const hook = path.resolve('.husky/pre-commit');
const shell = process.platform === 'win32'
  ? path.join(path.dirname(path.dirname(execFileSync('where.exe', ['git'], {encoding:'utf8'}).trim().split(/\r?\n/)[0])), 'bin', 'sh.exe')
  : 'sh';
function invoke(cwd, gitDir, marker) {
  const env = {...process.env, GIT_DIR: gitDir, ROUTE_MARKER: marker};
  delete env.GIT_COMMON_DIR;
  if (!gitDir) delete env.GIT_DIR;
  execFileSync(shell, [hook, 'artifact-argument'], {cwd, env, windowsHide:true});
}

test('Husky routes both source and linked worktree to the mandatory common hook', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'husky-route-'));
  try {
    const common = path.join(base, 'common'), linked = path.join(common, 'worktrees', 'pages');
    mkdirSync(path.join(common, 'hooks'), {recursive:true});
    mkdirSync(linked, {recursive:true});
    writeFileSync(path.join(common, 'hooks', 'pre-commit'), 'printf "called:%s" "$1" > "$ROUTE_MARKER"\n');
    writeFileSync(path.join(linked, 'commondir'), '../..\n');
    const marker = path.join(base, 'called');
    invoke(base, common, marker);
    assert.equal(readFileSync(marker, 'utf8'), 'called:artifact-argument');
    rmSync(marker);
    invoke(base, linked, marker);
    assert.equal(readFileSync(marker, 'utf8'), 'called:artifact-argument');
    const fallback = path.join(base, 'fallback');
    mkdirSync(fallback);
    execFileSync('git', ['init', '--quiet'], {cwd:fallback, windowsHide:true});
    writeFileSync(path.join(fallback, '.git', 'hooks', 'pre-commit'), 'printf "called:%s" "$1" > "$ROUTE_MARKER"\n');
    rmSync(marker);
    invoke(fallback, '', marker);
    assert.equal(readFileSync(marker, 'utf8'), 'called:artifact-argument');
  } finally { rmSync(base, {recursive:true, force:true}); }
});
