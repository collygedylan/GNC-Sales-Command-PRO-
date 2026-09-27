import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { focusedPlan, runLocalChecks } from '../scripts/check-local.mjs';
import { sourceDigest, siteDigest, assertLocalValidation } from '../scripts/local-validation-evidence.mjs';
import { selectFocusedTests } from '../scripts/select-focused-tests.mjs';

const map = JSON.parse(fs.readFileSync(new URL('../live-src/change-impact.json', import.meta.url), 'utf8'));
test('mapped features, shared edits, docs and unknown files select bounded relevant coverage', () => {
  assert.deepEqual(selectFocusedTests(['assets/bunch-note.js'], map).modules, ['bunch-notes']);
  assert.ok(selectFocusedTests(['index.html'], map).commands.some(c => c.includes('home-native-startup')));
  assert.ok(selectFocusedTests(['assets/unmapped.js'], map).commands.some(c => c.includes('session-recovery')));
  assert.deepEqual(selectFocusedTests(['docs/example.md'], map).commands, ['npm run check:foundation']);
  const plan = focusedPlan(map.modules.flatMap(m => m.commands).concat(map.fallbackCommands));
  assert.ok(plan.browsers.length);
  assert.equal(plan.unit.length, new Set(plan.unit).size);
});
test('foundation is not scheduled twice and arbitrary shell commands cannot run', () => {
  const plan = focusedPlan(['npm run check:foundation', 'node --test tests/release-app-lifecycle.test.mjs tests/bunch-note.test.mjs', 'node --test tests/bunch-note.test.mjs']);
  assert.deepEqual(plan, { unit: ['tests/bunch-note.test.mjs'], browsers: [] });
  assert.throws(() => focusedPlan(['npm run build:live && echo done']), /UNSUPPORTED/);
});

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(tmpdir(), 'gnc-local-validation-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, file), value); };
  write('.gitignore', '.gnc-local/\n');
  write('index.html', 'source');
  write('live-src/change-impact.json', JSON.stringify({ schemaVersion: 'gnc-change-impact-v1', fallbackCommands: [], modules: [{ id: 'fixture', paths: ['index.html'], commands: [
    'npm run check:foundation', 'node --test tests/bunch-note.test.mjs', 'npx playwright test --config playwright.bunch-note.config.ts',
  ] }] }));
  const git = args => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git(['init', '--quiet']); git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'base']);
  write('index.html', 'current source');
  const calls = [];
  const spawn = (exe, args, options) => {
    calls.push({ args, env: options.env });
    if (args.includes('check:foundation')) {
      const site = fs.mkdtempSync(path.join(cwd, '.gnc-local', 'foundation-site-'));
      fs.writeFileSync(path.join(site, 'index.html'), 'fresh compiled fixture');
      write('.gnc-local/foundation-check.json', JSON.stringify({ ok: true, site, sourceDigest: sourceDigest(cwd), siteDigest: siteDigest(site), baseCommit: 'a'.repeat(40), stages: [] }));
    }
    return { status: 0 };
  };
  return { cwd, write, calls, spawn };
}
test('one build feeds foundation and focused browsers; success is tied to unchanged source and artifact', t => {
  const f = fixture(t);
  const result = runLocalChecks({ ...f, npm: 'npm-cli.js', print: () => {} });
  assert.equal(result.ok, true);
  assert.equal(f.calls.filter(c => c.args.includes('check:foundation')).length, 1);
  const browser = f.calls.find(c => c.args.includes('playwright.local.config.ts'));
  assert.equal(browser.env.GNC_LOCAL_SITE_DIR, result.site);
  assert.ok(browser.args.includes('--retries=0'));
  assert.equal(assertLocalValidation(f.cwd).ok, true);
  fs.writeFileSync(path.join(result.site, 'index.html'), 'stale');
  assert.throws(() => assertLocalValidation(f.cwd), /BUILD_CHANGED/);
  f.write('index.html', 'edited again');
  assert.throws(() => assertLocalValidation(f.cwd), /SOURCE_CHANGED/);
});
test('failed baseline invalidates prior success, skips focused work, and blocks dispatch evidence', t => {
  const f = fixture(t);
  const passed = runLocalChecks({ ...f, npm: 'npm-cli.js', print: () => {} });
  assert.equal(passed.ok, true);
  let count = 0;
  const failed = runLocalChecks({ cwd: f.cwd, npm: 'npm-cli.js', spawn: () => { count++; return { status: 1 }; }, print: () => {} });
  assert.equal(count, 1);
  assert.equal(failed.ok, false);
  assert.throws(() => assertLocalValidation(f.cwd), /LOCAL_CHECK_FAILED/);
});
test('missing local evidence cannot authorize candidate dispatch', t => {
  const f = fixture(t);
  assert.throws(() => assertLocalValidation(f.cwd), /LOCAL_CHECK_REQUIRED/);
});
