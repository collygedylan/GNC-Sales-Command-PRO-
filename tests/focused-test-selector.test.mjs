import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { changedFilesFromGit, selectFocusedTests, releaseMarkerOnly } from '../scripts/select-focused-tests.mjs';

const map = JSON.parse(readFileSync(new URL('../live-src/change-impact.json', import.meta.url), 'utf8'));

test('module tile changes select compiled foundation and focused Sales coverage', () => {
  const result = selectFocusedTests(['assets/mobile-workspace.js'], map);
  assert.deepEqual(result.modules, ['module-hubs']);
  assert.match(result.commands.join('\n'), /check:foundation/);
  assert.match(result.commands.join('\n'), /playwright\.sales-mobile\.config\.ts/);
  assert.deepEqual(result.unknown, []);
});

test('runtime infrastructure changes select manifest and foundation checks once', () => {
  const result = selectFocusedTests(['live-src/runtime-modules.json', 'scripts/live-runtime-manifest.mjs'], map);
  assert.deepEqual(result.modules, ['runtime-foundation']);
  assert.equal(new Set(result.commands).size, result.commands.length);
  assert.match(result.commands[0], /live-runtime-manifest\.test\.mjs/);
});

test('unknown paths fail safe to the shared foundation check', () => {
  const result = selectFocusedTests(['assets/new-unmapped-feature.js'], map);
  assert.deepEqual(result.modules, []);
  assert.deepEqual(result.unknown, ['assets/new-unmapped-feature.js']);
  assert.deepEqual(result.commands, map.fallbackCommands);
});

test('committed branch changes remain selected after the working tree is clean', t => {
  const repo = mkdtempSync(path.join(tmpdir(), 'gnc-test-committed-selector-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: repo });
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
  execFileSync('git', ['init', '--quiet'], { cwd: repo });
  mkdirSync(path.join(repo, 'assets'));
  writeFileSync(path.join(repo, 'assets', 'mobile-workspace.js'), 'before\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=GNC Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: repo });
  writeFileSync(path.join(repo, 'assets', 'mobile-workspace.js'), 'after\n');
  writeFileSync(path.join(repo, 'unknown-shared.js'), 'new\n');
  const files = changedFilesFromGit(repo);
  assert.deepEqual(files.sort(), ['assets/mobile-workspace.js', 'unknown-shared.js']);
  const result = selectFocusedTests(files, map);
  assert.deepEqual(result.unknown, ['unknown-shared.js']);
  assert.match(result.commands.join('\n'), /check:foundation/);
  execFileSync('git', ['remote', 'add', 'origin', 'https://example.invalid/repository.git'], { cwd: repo });
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
