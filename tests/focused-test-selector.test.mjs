// @test-group: runtime-foundation,local-validation
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { changedFilesFromGit, selectAffectedTests, releaseMarkerOnly } from '../scripts/select-focused-tests.mjs';
import { gitRepositoryContextEnvironment } from '../scripts/git-repository-context.mjs';

const map = JSON.parse(readFileSync(new URL('../live-src/change-impact.json', import.meta.url), 'utf8'));
const fixtureGitEnv = gitRepositoryContextEnvironment();

test('module tile changes select discovered Sales coverage', () => {
  const result = selectAffectedTests(['assets/mobile-workspace.js'], { map });
  assert.deepEqual(result.modules, ['module-hubs']);
  assert.ok(result.nodeUnit.includes('tests/live-pilot.test.mjs'));
  assert.ok(result.playwrightTags.includes('@sales-mobile'));
  assert.deepEqual(result.unknown, []);
});

test('runtime infrastructure changes select manifest and foundation checks once', () => {
  const result = selectAffectedTests(['live-src/runtime-modules.json', 'scripts/live-runtime-manifest.mjs'], { map });
  assert.deepEqual(result.modules, ['runtime-foundation']);
  assert.ok(result.nodeUnit.includes('tests/live-runtime-manifest.test.mjs'));
  assert.ok(result.nodeUnit.includes('tests/focused-test-selector.test.mjs'));
});

test('unknown paths fail safe to the shared foundation check', () => {
  const result = selectAffectedTests(['assets/new-unmapped-feature.js'], { map });
  assert.deepEqual(result.modules, []);
  assert.deepEqual(result.unknown, ['assets/new-unmapped-feature.js']);
  assert.ok(result.nodeUnit.length > 0);
  assert.ok(result.vitest.length > 0);
});

test('shared configuration selects all fast unit and mount coverage', () => {
  for (const file of ['package.json', '.github/workflows/new.yml', 'services/databaseRest.ts']) {
    const result = selectAffectedTests([file], { map });
    assert.ok(result.nodeUnit.includes('tests/aura-query-panel.test.mjs'), file);
    assert.ok(result.vitest.some(test => test.endsWith('CompanyDirectory.test.tsx')), file);
  }
  assert.ok(selectAffectedTests(['sync_weather_hold_learning.py'], { map }).python.length > 0);
});

test('committed branch changes remain selected after the working tree is clean', t => {
  const repo = mkdtempSync(path.join(tmpdir(), 'gnc-test-committed-selector-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: repo, env: fixtureGitEnv });
  git(['init', '--quiet']);
  writeFileSync(path.join(repo, 'app.js'), 'before\n');
  git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'base']);
  git(['branch', 'base']);
  writeFileSync(path.join(repo, 'app.js'), 'after\n');
  git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'change']);
  assert.deepEqual(changedFilesFromGit(repo, 'base'), ['app.js']);
});

test('Git change discovery includes untracked files so unknown paths cannot bypass fallback checks', t => {
  const repo = mkdtempSync(path.join(tmpdir(), 'gnc-test-selector-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: repo, env: fixtureGitEnv });
  mkdirSync(path.join(repo, 'assets'));
  writeFileSync(path.join(repo, 'assets', 'mobile-workspace.js'), 'before\n');
  execFileSync('git', ['add', '.'], { cwd: repo, env: fixtureGitEnv });
  execFileSync('git', ['-c', 'user.name=GNC Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: repo, env: fixtureGitEnv });
  writeFileSync(path.join(repo, 'assets', 'mobile-workspace.js'), 'after\n');
  writeFileSync(path.join(repo, 'unknown-shared.js'), 'new\n');
  const files = changedFilesFromGit(repo);
  assert.deepEqual(files.sort(), ['assets/mobile-workspace.js', 'unknown-shared.js']);
  const result = selectAffectedTests(files, { root: repo, map: { schemaVersion: 'gnc-change-impact-v1', modules: [{ id: 'assets', paths: ['assets/**'] }] } });
  assert.deepEqual(result.unknown, ['unknown-shared.js']);
  assert.equal(result.nodeUnit.length, 0);
  assert.equal(result.vitest.length, 0);
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/repository.git'], { cwd: repo, env: fixtureGitEnv });
  assert.throws(() => changedFilesFromGit(repo), /FOCUSED_BASE_UNAVAILABLE/);
});

test('version-only markers do not select shared suites but real changes alongside a bump do', () => {
  const before = 'window.__APP_SHELL_VERSION__ = "V2026.09.26.01";\nrender();\n';
  const after = before.replaceAll('V2026.09.26.01', 'V2026.09.26.03');
  assert.equal(releaseMarkerOnly('index.html', before, after), true);
  assert.equal(releaseMarkerOnly('index.html', before, after.replace('render()', 'broken()')), false);
  const pkg = { version: '2026.09.26.01', scripts: { test: 'node test.mjs' } };
  const bumped = { ...pkg, version: '2026.09.26.03' };
  assert.equal(releaseMarkerOnly('package.json', JSON.stringify(pkg), JSON.stringify(bumped)), true);
  bumped.scripts = { test: 'node different.mjs' };
  assert.equal(releaseMarkerOnly('package.json', JSON.stringify(pkg), JSON.stringify(bumped)), false);
});

test('affected-test selection is discovery-backed, handles docs, unknown edits, and deletions', () => {
  const aura = selectAffectedTests(['components/common/auraVoiceWidget.js']);
  assert.ok(aura.nodeUnit.includes('tests/aura-voice.test.mjs'));
  assert.ok(aura.nodeUnit.includes('tests/aura-query-panel.test.mjs'));
  assert.deepEqual(selectAffectedTests(['docs/aura-llm-proposal.md']).nodeUnit, []);
  const unknown = selectAffectedTests(['assets/unmapped-feature.js']);
  assert.equal(unknown.nodeUnit.length > 0, true);
  assert.equal(unknown.vitest.length > 0, true);
  const deleted = selectAffectedTests(['assets/deleted-feature.js']);
  assert.deepEqual(deleted.deleted, ['assets/deleted-feature.js']);
  assert.equal(deleted.nodeUnit.length > 0, true);
});

test('affected-test selection follows recursive local imports for unit and mount tests', t => {
  const repo = mkdtempSync(path.join(tmpdir(), 'gnc-test-import-graph-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  for (const directory of ['src/nested', 'tests', 'v2/src']) mkdirSync(path.join(repo, directory), { recursive: true });
  writeFileSync(path.join(repo, 'src/bridge.js'), "export { value } from './nested/source.ts';\n");
  writeFileSync(path.join(repo, 'src/nested/source.ts'), 'export const value = 1;\n');
  writeFileSync(path.join(repo, 'tests/affected.test.mjs'), "import '../src/bridge.js';\n");
  writeFileSync(path.join(repo, 'tests/unrelated.test.mjs'), 'import assert from "node:assert";\n');
  writeFileSync(path.join(repo, 'v2/src/mount.test.ts'), "import '../../src/bridge.js';\n");
  const result = selectAffectedTests(['src/nested/source.ts'], {
    root: repo,
    map: { schemaVersion: 'gnc-change-impact-v1', modules: [{ id: 'demo', paths: ['src/**'] }] },
  });
  assert.deepEqual(result.nodeUnit, ['tests/affected.test.mjs']);
  assert.deepEqual(result.vitest, ['v2/src/mount.test.ts']);
});

test('database changes flag local database validation and discovery returns direct pgTAP inputs', () => {
  const result = selectAffectedTests(['supabase/migrations/new_change.sql']);
  assert.equal(result.requiresLocalDb, true);
  assert.ok(result.sql.length > 0);
  assert.ok(result.sql.every(file => file.startsWith('supabase/tests/') && file.endsWith('_test.sql')
    && !/rollback|canary/i.test(file)));
});
