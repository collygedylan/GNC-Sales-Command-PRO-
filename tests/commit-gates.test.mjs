import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { precommit, requiredChecks, stagedPaths } from '../scripts/precommit.mjs';
import { doctor, MINIMUM_DATABASE_FREE_BYTES } from '../scripts/tooling-doctor.mjs';
import { repoRoot, run as runTool } from '../scripts/tooling-process.mjs';
import { gitRepositoryContextEnvironment } from '../scripts/git-repository-context.mjs';

test('captured command failures retain stderr and stdout diagnostics', () => {
  assert.throws(() => runTool('fixture', [], { capture: true,
    spawn: () => ({ status: 1, stderr: 'Connecting to local database', stdout: 'not ok: behavior assertion' }) }),
  error => /Connecting to local database/.test(error.message) && /not ok: behavior assertion/.test(error.message));
});

test('SQL and generated contracts require a database; ordinary frontend changes do not', () => {
  for (const file of ['supabase/migrations/new.sql', 'supabase/tests/new_test.sql', 'supabase/functions/_shared/database.types.ts', 'v2/src/services/sandbox.database.types.ts', 'services/database-contracts.generated.ts', 'scripts/database-types.mjs',
    'scripts/historical-database-fixture.mjs', 'scripts/historical-database-migrations.json', 'scripts/run-sql-rollback-tests.mjs',
    'scripts/disposable-supabase-container.mjs', 'scripts/sql-lint-temp-context.mjs',
    'scripts/run-postgres-fixture-sql-tests.mjs', 'scripts/run-discovered-database-tests.mjs', 'scripts/prepare-isolated-sql-tests.mjs',
    'scripts/test-discovery.mjs', 'scripts/sandbox-database-workspace.mjs', '.github/workflows/release-database.yml']) {
    assert.equal(requiredChecks([file]).database, true, file);
  }
  assert.equal(requiredChecks(['v2/src/pages/App.tsx']).database, false);
  assert.equal(requiredChecks(['supabase/functions/app-api/index.ts']).edge, true);
  assert.equal(requiredChecks(['services/databaseRest.ts']).edge, true);
  assert.equal(requiredChecks(['services/database-contract-runtime.ts']).edge, true);
  assert.equal(requiredChecks(['docs/guide.md']).code, false);
});

test('staged selection preserves spaces, deletions and rename sides without shell parsing', () => {
  let command;
  const files = stagedPaths(repoRoot, (bin, args) => { command = [bin, args]; return 'old path.ts\0new path.ts\0deleted.ts\0'; });
  assert.deepEqual(files, ['old path.ts', 'new path.ts', 'deleted.ts']);
  assert.equal(command[0], 'git');
  assert.ok(command[1].includes('--no-renames'));
  assert.ok(command[1].includes('-z'));
});

test('pre-commit clears inherited Git context only for foreign test processes', () => {
  const originalIndex = process.env.GIT_INDEX_FILE;
  process.env.GIT_INDEX_FILE = 'outer-hook-index';
  try {
    const calls = [];
    precommit({ files: ['supabase/migrations/fixture.sql'], preflight: () => {},
      execute: (args, options) => calls.push({ args, env: { ...process.env, ...options.env } }) });
    const unit = calls.find(call => call.args.includes('--test'));
    const database = calls.find(call => call.args.includes('scripts/database-check.mjs'));
    assert.ok(unit, 'discovered unit tests should run');
    assert.ok(database, 'staged database validation should run');
    assert.equal(unit.env.GIT_INDEX_FILE, undefined);
    assert.equal(database.env.GIT_INDEX_FILE, 'outer-hook-index');
  } finally {
    if (originalIndex === undefined) delete process.env.GIT_INDEX_FILE;
    else process.env.GIT_INDEX_FILE = originalIndex;
  }
});

test('shared Edge adapters run Deno compilation and discovered unit tests before commit', () => {
  const calls = [];
  const diagnostics = [];
  precommit({ files: ['services/databaseRest.ts'], execute: args => calls.push(args),
    preflight: options => diagnostics.push(options) });
  assert.equal(diagnostics[0].edge, true);
  assert.equal(diagnostics[0].database, false);
  const check = calls.findIndex(args => args[1] === 'check');
  const tests = calls.findIndex(args => args[1] === 'test');
  assert.ok(check > 0 && tests > check);
  assert.ok(calls[check].includes('supabase/functions/app-api/index.ts'));
  assert.ok(calls[tests].includes('supabase/functions/app-api/suspend-tag-read_test.ts'));
  assert.ok(calls[tests].includes('--allow-net'));
  assert.ok(!calls.some(args => args[0] === 'scripts/database-check.mjs'));
});

test('missing Docker blocks required SQL validation with an actionable error', () => {
  const statfs = () => ({ bavail: MINIMUM_DATABASE_FREE_BYTES, bsize: 1 });
  assert.throws(() => doctor({ database: true, statfs, node: () => '', execute: () => { throw new Error('unavailable'); } }), /Docker.*No database checks were skipped/);
  assert.throws(() => doctor({ database: true, statfs, node: () => '', execute: () => '' }), /Docker.*No database checks were skipped/);
  assert.throws(() => doctor({ database: true, statfs, node: () => '', execute: () => 'Docker Desktop could not start' }), /Docker.*No database checks were skipped/);
  assert.equal(doctor({ database: true, statfs, node: () => '', execute: () => '28.4.0\n' }).database, true);
});

test('SQL validation fails before Supabase or Docker when repo or temp space is below the image-download floor', () => {
  for (const lowDirectory of ['repo', 'temp']) {
    const nodeCalls = [];
    const executeCalls = [];
    const statfs = directory => ({ bavail: ((directory === repoRoot ? 'repo' : directory) === lowDirectory)
      ? MINIMUM_DATABASE_FREE_BYTES - 1 : MINIMUM_DATABASE_FREE_BYTES, bsize: 1 });
    assert.throws(() => doctor({ database: true, root: repoRoot, temporaryDirectory: 'temp', statfs,
      node: args => nodeCalls.push(args), execute: (...args) => executeCalls.push(args) }),
    /at least 8 GiB free.*15 GiB is recommended.*No database checks were skipped/);
    assert.deepEqual(nodeCalls, []);
    assert.deepEqual(executeCalls, []);
  }
});

test('SQL validation fails closed if repository or temporary free space cannot be measured', () => {
  let calls = 0;
  assert.throws(() => doctor({ database: true, root: repoRoot, temporaryDirectory: 'temp',
    statfs: () => { calls++; throw new Error('statfs unavailable'); },
    node: () => assert.fail('Supabase must not run when disk space is unknown'),
    execute: () => assert.fail('Docker must not run when disk space is unknown') }),
  /Free space.*could not be measured.*no database checks were skipped/);
  assert.equal(calls, 1);
});

test('real pre-commit refuses syntax, type and mount failures and preserves staged content', { timeout: 90_000 }, () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'gnc commit gates '));
  const childEnv = { ...gitRepositoryContextEnvironment(), HUSKY: '1', GIT_CONFIG_NOSYSTEM: '1' };
  delete childEnv.NODE_TEST_CONTEXT;
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: fixture, encoding: 'utf8', shell: false, windowsHide: true,
    env: childEnv });
  const git = (...args) => { const result = run('git', args); assert.equal(result.status, 0, result.stderr); return result.stdout; };
  const write = (name, content) => writeFileSync(path.join(fixture, name), content);
  try {
    mkdirSync(path.join(fixture, 'tests'));
    symlinkSync(path.join(repoRoot, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    write('.gitignore', '/node_modules\n');
    write('tracked note.txt', 'original note\n');
    write('package.json', '{"type":"module"}\n');
    write('ui.js', 'export function mount(root) { root.textContent = "Ready"; }\n');
    write('types.ts', 'export const count: number = 1;\n');
    write('tsconfig.json', '{"compilerOptions":{"strict":true,"skipLibCheck":true,"noEmit":true,"types":[]},"include":["types.ts"]}\n');
    write('tests/mount.test.mjs', 'import {test} from "node:test"; import assert from "node:assert/strict"; import {JSDOM} from "jsdom"; import {mount} from "../ui.js"; test("mount",()=>{const dom=new JSDOM("<main></main>"); mount(dom.window.document.querySelector("main")); assert.equal(dom.window.document.querySelector("main").textContent,"Ready"); dom.window.close();});\n');
    write('guard.mjs', 'import {spawnSync} from "node:child_process"; import {readdirSync} from "node:fs"; const tests=readdirSync("tests").filter(f=>f.endsWith(".test.mjs")).map(f=>"tests/"+f); for(const args of [["--check","ui.js"],["node_modules/typescript/bin/tsc","--noEmit","-p","tsconfig.json"],["--test",...tests]]) { const result=spawnSync(process.execPath,args,{stdio:"inherit"}); if(result.status!==0) process.exit(result.status||1); }\n');
    write('lint-staged.config.mjs', 'export default () => ["node guard.mjs"];\n');
    git('init', '--quiet'); git('config', 'user.name', 'Commit Gate Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    git('add', '.');
    assert.equal(git('ls-files', 'node_modules'), '', 'fixture dependencies must remain untracked on every platform');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'fixture baseline');
    mkdirSync(path.join(fixture, '.husky'));
    write('.husky/pre-commit', '#!/usr/bin/env sh\n' + readFileSync(path.join(repoRoot, '.husky/pre-commit'), 'utf8').replace('--hide-all', '--hide-all --verbose'));
    chmodSync(path.join(fixture, '.husky/pre-commit'), 0o755);
    git('config', 'core.hooksPath', '.husky');
    const head = git('rev-parse', 'HEAD');
    for (const [name, bad] of [['ui.js', 'export function mount( {\n'], ['types.ts', 'export const count: number = "wrong";\n'], ['ui.js', 'export function mount() { throw new Error("mount failed"); }\n']]) {
      const original = readFileSync(path.join(fixture, name), 'utf8');
      write(name, bad); git('add', name);
      const staged = git('diff', '--cached', '--binary');
      write(name, original + '// unstaged fix must not conceal broken staged content\n');
      write('untracked note.txt', 'preserve me\n');
      const commit = run('git', ['commit', '-m', 'must fail']);
      assert.notEqual(commit.status, 0, name + ': ' + bad + commit.stdout + commit.stderr);
      assert.equal(git('rev-parse', 'HEAD'), head);
      assert.equal(git('diff', '--cached', '--binary'), staged);
      assert.equal(readFileSync(path.join(fixture, name), 'utf8'), original + '// unstaged fix must not conceal broken staged content\n');
      assert.equal(readFileSync(path.join(fixture, 'untracked note.txt'), 'utf8'), 'preserve me\n');
      git('restore', '--staged', name); write(name, original);
    }
    write('types.ts', 'export const count: number = 2;\n'); git('add', 'types.ts');
    write('tests/unstaged.test.mjs', 'throw new Error("untracked test must not run");\n');
    const passing = run('git', ['commit', '-m', 'valid staged change']);
    assert.equal(passing.status, 0, passing.stdout + passing.stderr);
    assert.match(readFileSync(path.join(fixture, 'tests/unstaged.test.mjs'), 'utf8'), /untracked/);

    git('mv', 'tracked note.txt', 'renamed note.txt');
    write('renamed note.txt', 'preserve unstaged rename content\n');
    const renamed = run('git', ['commit', '-m', 'rename with spaces']);
    assert.equal(renamed.status, 0, renamed.stdout + renamed.stderr);
    assert.equal(git('show', 'HEAD:renamed note.txt'), 'original note\n');
    assert.equal(readFileSync(path.join(fixture, 'renamed note.txt'), 'utf8'), 'preserve unstaged rename content\n');
    git('rm', '--cached', 'renamed note.txt');
    const deleted = run('git', ['commit', '-m', 'delete from index while retaining local content']);
    assert.equal(deleted.status, 0, deleted.stdout + deleted.stderr);
    assert.equal(readFileSync(path.join(fixture, 'renamed note.txt'), 'utf8'), 'preserve unstaged rename content\n');
    assert.equal(git('ls-files', 'renamed note.txt'), '');

    const linked = path.join(fixture, 'linked checkout with spaces');
    git('worktree', 'add', '--quiet', '-b', 'linked-hook-proof', linked);
    const linkedModules = path.join(linked, 'node_modules');
    assert.equal(lstatSync(linkedModules, { throwIfNoEntry: false }), undefined,
      'linked checkout must not materialize the ignored dependency link');
    symlinkSync(path.join(repoRoot, 'node_modules'), linkedModules, process.platform === 'win32' ? 'junction' : 'dir');
    assert.ok(existsSync(path.join(linkedModules, 'typescript', 'bin', 'tsc')));
    assert.ok(existsSync(path.join(linkedModules, 'jsdom', 'package.json')));
    mkdirSync(path.join(linked, '.husky'));
    writeFileSync(path.join(linked, '.husky/pre-commit'), '#!/usr/bin/env sh\n' + readFileSync(path.join(repoRoot, '.husky/pre-commit'), 'utf8'));
    chmodSync(path.join(linked, '.husky/pre-commit'), 0o755);
    const linkedGit = args => spawnSync('git', args, { cwd: linked, encoding: 'utf8', shell: false, windowsHide: true, env: childEnv });
    writeFileSync(path.join(linked, 'types.ts'), 'export const count: number = "broken";\n');
    assert.equal(linkedGit(['add', 'types.ts']).status, 0);
    const linkedIndex = linkedGit(['diff', '--cached', '--binary']).stdout;
    writeFileSync(path.join(linked, 'types.ts'), 'export const count: number = 3; // unstaged\n');
    writeFileSync(path.join(linked, 'untracked.txt'), 'keep this\n');
    assert.notEqual(linkedGit(['commit', '-m', 'linked must fail']).status, 0);
    assert.equal(linkedGit(['diff', '--cached', '--binary']).stdout, linkedIndex);
    assert.match(readFileSync(path.join(linked, 'types.ts'), 'utf8'), /unstaged/);
    assert.equal(readFileSync(path.join(linked, 'untracked.txt'), 'utf8'), 'keep this\n');
  } finally {
    const allowed = path.resolve(tmpdir()) + path.sep;
    assert.ok(path.resolve(fixture).startsWith(allowed));
    rmSync(fixture, { recursive: true, force: true });
  }
});
