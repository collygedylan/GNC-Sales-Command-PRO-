import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runPostgresFixtureSqlTests, selectAffectedPostgresFixtureSqlGroups } from '../scripts/run-postgres-fixture-sql-tests.mjs';
import { forgetDisposableSupabaseWorkspace, inspectDisposableSupabaseWorkspace } from '../scripts/disposable-supabase-container.mjs';
import { withDisposableSupabase } from '../scripts/database-workspace-runner.mjs';
import { run } from '../scripts/tooling-process.mjs';

const projectId = 'gncdbfixture123';
const containerId = '0'.repeat(64);
const status = 'DB_URL="postgresql://postgres:local_fixture_secret@127.0.0.1:54322/postgres"\n';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixtureRoot(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gnc-db-workspace-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'supabase'), { recursive: true });
  writeFileSync(path.join(root, 'supabase/config.toml'), `project_id = "${projectId}"\n\n[db]\nport = 54322\n`);
  for (const file of [
    'supabase/ci/bloomscapes_pending_baseline.sql',
    'supabase/archive_migrations/20260908014335_bloomscapes_pending_orders.sql',
    'supabase/ci/suspend_tag_baseline.sql',
    'supabase/archive_migrations/20260908165943_suspend_tag_completion.sql',
    'supabase/tests/bloomscapes_pending_orders_test.sql',
    'supabase/tests/suspend_tag_completion_test.sql',
  ]) {
    const absolute = path.join(root, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, `select ${file.includes('_baseline') ? 101 : 202};\n`);
  }
  return root;
}

function dockerInspection({ id = containerId, name = `/supabase_db_${projectId}`, label = projectId, workdir = '', compose = projectId,
  image = 'public.ecr.aws/supabase/postgres:17.6.1.020', imageId = `sha256:${'a'.repeat(64)}`, port = '54322' } = {}) {
  return JSON.stringify([{
    Id: id,
    Image: imageId,
    Name: name,
    Config: { Image: image, Labels: {
      'com.supabase.cli.project': label,
      'com.supabase.cli.workdir': workdir,
      'com.docker.compose.project': compose,
    } },
    HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: port }] } },
  }]);
}

function executeFixture({ events = [], inspect, root, id = containerId } = {}) {
  const containerInspection = inspect || dockerInspection({ workdir: root });
  return (command, args, options = {}) => {
    events.push({ command, args, options });
    if (command === 'docker' && args[0] === 'ps') return `${id}\n`;
    if (command === 'docker' && args[0] === 'inspect') return containerInspection;
    return '';
  };
}

test('historical container verification binds temporary paths to the historical project family', t => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'gnc-historical-db-workspace-'));
  t.after(() => { forgetDisposableSupabaseWorkspace(workspace); rmSync(workspace, { recursive: true, force: true }); });
  mkdirSync(path.join(workspace, 'supabase'));
  const historicalProject = 'gnchistfixture123';
  const configPath = path.join(workspace, 'supabase/config.toml');
  const verify = () => inspectDisposableSupabaseWorkspace({ workspaceRoot: workspace, cli: 'fixture', status,
    execute: executeFixture({ root: workspace, inspect: dockerInspection({
      name: `/supabase_db_${historicalProject}`, label: historicalProject, compose: historicalProject, workdir: workspace,
    }) }), executeNode: () => '' });
  writeFileSync(configPath, `project_id = "${projectId}"\n[db]\nport = 54322\n`);
  assert.throws(verify, /WORKSPACE_CONFIG_INVALID/, 'canonical identity cannot authorize a historical path');
  writeFileSync(configPath, `project_id = "${historicalProject}"\n[db]\nport = 54322\n`);
  assert.equal(verify().projectId, historicalProject);
});

test('cloud historical path is permitted only under the exact Actions temporary root', t => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'gnc-ci-runner-test-'));
  t.after(() => { forgetDisposableSupabaseWorkspace(path.join(temporaryRoot, 'gnc-supabase-ci')); rmSync(temporaryRoot, { recursive: true, force: true }); });
  const workspace = path.join(temporaryRoot, 'gnc-supabase-ci');
  mkdirSync(path.join(workspace, 'supabase'), { recursive: true });
  const historicalProject = 'gnchistcloud123';
  writeFileSync(path.join(workspace, 'supabase/config.toml'), `project_id = "${historicalProject}"\n[db]\nport = 54322\n`);
  const verify = env => inspectDisposableSupabaseWorkspace({ workspaceRoot: workspace, cli: 'fixture', status, env,
    execute: executeFixture({ root: workspace, inspect: dockerInspection({
      name: `/supabase_db_${historicalProject}`, label: historicalProject, compose: historicalProject, workdir: workspace,
    }) }), executeNode: () => '' });
  assert.throws(() => verify({ RUNNER_TEMP: temporaryRoot }), /WORKSPACE_REQUIRED/);
  assert.throws(() => verify({ GITHUB_ACTIONS: 'true', RUNNER_TEMP: path.join(temporaryRoot, 'other') }), /WORKSPACE_REQUIRED/);
  assert.equal(verify({ GITHUB_ACTIONS: 'true', RUNNER_TEMP: temporaryRoot }).projectId, historicalProject);
});

test('historical runner establishes container proof before reset', () => {
  const events = [];
  withDisposableSupabase({
    workspace: { root: 'historical-fixture', projectId: 'gnchisttest', verifyContainer: true, dispose() { events.push('dispose'); } },
    cli: 'fixture', execute(args) { events.push(args.slice(3).join(' ')); },
    inspectWorkspace() { events.push('verify'); },
    action: runCli => runCli(['db', 'reset', '--local', '--no-seed']),
  });
  assert.deepEqual(events.slice(1), ['verify', 'db reset --local --no-seed', 'stop --no-backup', 'dispose']);
});

test('shared container verifier permits only a previously verified workspace container recreated by reset', t => {
  const root = fixtureRoot(t);
  const firstId = '1'.repeat(64), resetId = '2'.repeat(64);
  let currentId = firstId;
  let currentInspection = dockerInspection({ id: firstId, workdir: root });
  const execute = (command, args) => {
    if (command === 'docker' && args[0] === 'ps') return `${currentId}\n`;
    if (command === 'docker' && args[0] === 'inspect') return currentInspection;
    return '';
  };
  const verify = () => inspectDisposableSupabaseWorkspace({ root: repoRoot, workspaceRoot: root, cli: 'supabase-fixture',
    status, execute, executeNode: () => '' });
  t.after(() => forgetDisposableSupabaseWorkspace(root, projectId));

  currentInspection = dockerInspection({ id: firstId, workdir: '' });
  assert.throws(verify, /DISPOSABLE_SUPABASE_DB_CONTAINER_IDENTITY_MISMATCH/, 'missing workdir proof is rejected on first use');
  currentInspection = dockerInspection({ id: firstId, workdir: root });
  assert.equal(verify().containerId, firstId, 'the exact workdir label establishes process-local proof');

  currentId = resetId;
  currentInspection = dockerInspection({ id: resetId, workdir: '' });
  assert.equal(verify().containerId, resetId, 'reset-recreated container retains the verified immutable identity');
  assert.equal(verify().containerId, resetId, 'later same-process consumers can reuse the reset proof');

  currentInspection = dockerInspection({ id: resetId, workdir: '', imageId: `sha256:${'b'.repeat(64)}` });
  assert.throws(verify, /DISPOSABLE_SUPABASE_DB_CONTAINER_IDENTITY_MISMATCH/, 'a changed immutable image digest remains rejected');
  currentInspection = dockerInspection({ id: resetId, workdir: path.join(root, 'other') });
  assert.throws(verify, /DISPOSABLE_SUPABASE_DB_CONTAINER_IDENTITY_MISMATCH/, 'a conflicting workdir label remains rejected');
  assert.equal(forgetDisposableSupabaseWorkspace(root, projectId), true);
  currentInspection = dockerInspection({ id: resetId, workdir: '' });
  assert.throws(verify, /DISPOSABLE_SUPABASE_DB_CONTAINER_IDENTITY_MISMATCH/, 'cleared proof cannot authorize missing workdir labels');
});

test('shared runner clears recreated-container proof even when stack cleanup fails', t => {
  const root = fixtureRoot(t);
  const platformPrivilegeSqlPath = path.join(root, 'platform-admin-default-privileges.sql');
  writeFileSync(platformPrivilegeSqlPath, 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;\n');
  let currentId = '3'.repeat(64);
  let currentInspection = dockerInspection({ id: currentId, workdir: root });
  let stopped = false;
  const executeNode = (args) => {
    const cliArgs = args.slice(3);
    if (cliArgs.includes('status')) return status;
    if (cliArgs[0] === 'db' && cliArgs[1] === 'reset') {
      currentId = '4'.repeat(64);
      currentInspection = dockerInspection({ id: currentId, workdir: '' });
    }
    if (cliArgs[0] === 'stop') { stopped = true; throw new Error('stop failed'); }
    return '';
  };
  const executeDocker = (_command, args) => {
    if (args[0] === 'ps') return `${currentId}\n`;
    if (args[0] === 'inspect') return currentInspection;
    return '';
  };
  assert.throws(() => withDisposableSupabase({
    root: repoRoot,
    workspace: { root, projectId, platformPrivilegeSqlPath, dispose() {} },
    cli: 'supabase-fixture', execute: executeNode, executeDocker,
    action: runCli => runCli(['db', 'reset', '--local']),
  }), /DATABASE_STACK_CLEANUP_FAILED:stop: stop failed/);
  assert.equal(stopped, true);
  assert.throws(() => inspectDisposableSupabaseWorkspace({ root: repoRoot, workspaceRoot: root, cli: 'supabase-fixture', status,
    execute: executeDocker, executeNode: () => '' }), /DISPOSABLE_SUPABASE_DB_CONTAINER_IDENTITY_MISMATCH/,
  'cleanup removes the in-process proof even when stop fails');
});

function executeNodeFixture({ events = [] } = {}) {
  return (args, options = {}) => {
    events.push({ command: 'node', args, options });
    if (args.includes('status')) return status;
    return '';
  };
}

test('dedicated SQL fixtures run only in a verified disposable project database and are dropped', t => {
  const root = fixtureRoot(t);
  const events = [];
  const nodeEvents = [];
  const result = runPostgresFixtureSqlTests({ root, workspaceRoot: root, groups: ['bloomscapes-pgtap'], status,
    cli: 'supabase-fixture.cjs', execute: executeFixture({ events, root }), executeNode: executeNodeFixture({ events: nodeEvents }), discover: ({ group }) => [
      `supabase/tests/${group === 'bloomscapes-pgtap' ? 'bloomscapes_pending_orders_test.sql' : 'suspend_tag_completion_test.sql'}`,
    ] });
  assert.equal(result.projectId, projectId);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].files.length, 1);
  const create = events.find(event => event.command === 'docker' && event.args[0] === 'exec' && event.args.at(-1).includes('CREATE DATABASE'));
  const drop = events.find(event => event.command === 'docker' && event.args[0] === 'exec' && event.args.at(-1).includes('DROP DATABASE'));
  assert.ok(create && drop);
  assert.ok(events.some(event => event.command === 'docker' && event.args[0] === 'ps' && event.args.includes('--no-trunc')),
    'container lookup requests full IDs for exact docker inspect identity matching');
  assert.equal(create.args[1], containerId);
  assert.equal(drop.args[1], containerId);
  const sqlCalls = events.filter(event => event.command === 'docker' && event.args.includes('psql') && event.args.includes('-i'));
  assert.equal(sqlCalls.length, 3);
  assert.equal(sqlCalls[0].options.input, 'select 101;\n');
  assert.equal(sqlCalls[1].options.input, 'select 202;\n');
  assert.equal(sqlCalls[2].options.input, 'select 202;\n');
  assert.ok(sqlCalls.every(event => event.args.includes(result.results[0].database)));
  assert.ok(sqlCalls.every(event => event.args.includes('ON_ERROR_STOP=1')));
  assert.equal(events.some(event => event.command === 'psql'), false, 'runner never requires host psql');
  assert.equal(nodeEvents.some(event => event.args.includes('test')), false, 'exception-based SQL is not misrouted to TAP');
});

test('shared container verifier rejects truncated Docker IDs', t => {
  const root = fixtureRoot(t);
  const events = [];
  const execute = (command, args) => {
    events.push({ command, args });
    if (command === 'docker' && args[0] === 'ps') return '0123456789ab\n';
    if (command === 'docker' && args[0] === 'inspect') return dockerInspection({ id: '0123456789ab', workdir: root });
    return '';
  };
  assert.throws(() => inspectDisposableSupabaseWorkspace({ root: repoRoot, workspaceRoot: root, cli: 'supabase-fixture',
    status, execute, executeNode: () => '' }), /DISPOSABLE_SUPABASE_DB_CONTAINER_NOT_UNIQUE/);
  assert.ok(events.some(event => event.command === 'docker' && event.args.includes('--no-trunc')));
});

test('dedicated SQL fixture runner refuses containers with a different project, workspace, or compose owner', t => {
  const root = fixtureRoot(t);
  for (const inspection of [
    dockerInspection({ label: 'different-project', workdir: root }),
    dockerInspection({ workdir: path.join(root, 'other-workspace') }),
    dockerInspection({ workdir: root, compose: 'different-project' }),
  ]) {
    const events = [];
    const execute = executeFixture({ events, root, inspect: inspection });
    assert.throws(() => runPostgresFixtureSqlTests({ root, workspaceRoot: root, groups: ['suspend-tag-pgtap'], status, execute, cli: 'supabase-fixture' }),
      /POSTGRES_FIXTURE_DB_CONTAINER_IDENTITY_MISMATCH/);
    assert.equal(events.some(event => event.command === 'docker' && event.args.includes('CREATE DATABASE')), false);
  }
});

test('shared Supabase container verifier requires the workspace directly under the system temp root', t => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'gnc-workspace-parent-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const workspace = path.join(parent, 'gnc-db-workspace-forged');
  assert.throws(() => runPostgresFixtureSqlTests({ root: repoRoot, workspaceRoot: workspace,
    groups: ['bloomscapes-pgtap'], status, execute: executeFixture({ root: workspace }), cli: 'supabase-fixture' }),
  /POSTGRES_FIXTURE_WORKSPACE_REQUIRED/);
});

test('dedicated fixture database cleanup runs when PostgreSQL reports failed assertions', t => {
  const root = fixtureRoot(t);
  const events = [];
  const nodeEvents = [];
  const execute = executeFixture({ events, root });
  let sqlCalls = 0;
  assert.throws(() => runPostgresFixtureSqlTests({ root, workspaceRoot: root, groups: ['suspend-tag-pgtap'], status,
    execute: (command, args, options) => {
      const result = execute(command, args, options);
      if (args.includes('-i') && ++sqlCalls === 3) return { status: 3 };
      return result;
    }, executeNode: executeNodeFixture({ events: nodeEvents }),
    cli: 'supabase-fixture.cjs', discover: () => ['supabase/tests/suspend_tag_completion_test.sql'] }),
  /POSTGRES_FIXTURE_COMMAND_FAILED:docker:3/);
  assert.ok(events.some(event => event.command === 'docker' && event.args.at(-1).includes('DROP DATABASE')));
  assert.equal(sqlCalls, 3, 'the failure occurs in the discovered test after fixture replay');
});

test('dedicated database group selection follows runtime annotations and mapped fixtures', () => {
  const groups = {
    'bloomscapes-pgtap': ['supabase/tests/bloomscapes_pending_orders_test.sql'],
    'suspend-tag-pgtap': ['supabase/tests/suspend_tag_completion_test.sql'],
  };
  const discover = ({ group }) => groups[group];
  assert.deepEqual(selectAffectedPostgresFixtureSqlGroups({ files: [groups['bloomscapes-pgtap'][0]], discover }), ['bloomscapes-pgtap']);
  assert.deepEqual(selectAffectedPostgresFixtureSqlGroups({ files: ['supabase/ci/suspend_tag_baseline.sql'], discover }), ['suspend-tag-pgtap']);
  assert.deepEqual(selectAffectedPostgresFixtureSqlGroups({ files: ['supabase/migrations/new.sql'], discover }), ['bloomscapes-pgtap', 'suspend-tag-pgtap']);
});

test('plain-Postgres fixtures remain safe in the Supabase container with pre-existing global roles', () => {
  for (const file of ['supabase/ci/bloomscapes_pending_baseline.sql', 'supabase/ci/suspend_tag_baseline.sql']) {
    const source = readFileSync(path.join(repoRoot, file), 'utf8');
    assert.match(source, /exception when duplicate_object then null/i, `${file} safely reuses Supabase global roles`);
    assert.match(source, /create schema auth/i, `${file} still builds the isolated auth schema`);
    assert.match(source, /create table auth\.sessions/i, `${file} retains its per-database auth fixture`);
  }
});

test('tooling runner pipes SQL to Docker stdin only when input is supplied', () => {
  const observed = [];
  const spawn = (command, args, options) => {
    observed.push({ command, args, options });
    return { status: 0, stdout: '', stderr: '' };
  };
  run('docker', ['exec', '-i', 'db-container', 'psql'], { root: repoRoot, capture: true, input: 'select 1;', spawn });
  run('docker', ['ps'], { root: repoRoot, spawn });
  assert.deepEqual(observed.map(({ options }) => options.stdio), ['pipe', 'inherit']);
  assert.equal(observed[0].options.input, 'select 1;');
  assert.equal(Object.hasOwn(observed[1].options, 'input'), false);
});
