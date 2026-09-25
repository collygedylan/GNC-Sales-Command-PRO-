import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { changedFilesFromGit, selectFocusedTests } from '../scripts/select-focused-tests.mjs';

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
  assert.deepEqual(result.commands, ['npm run check:foundation']);
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
});
