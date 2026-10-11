// @test-group: local-validation
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { focusedPlan, runLocalChecks } from '../scripts/check-local.mjs';
import { sourceDigest, siteDigest, assertLocalValidation } from '../scripts/local-validation-evidence.mjs';
import { selectAffectedTests } from '../scripts/select-focused-tests.mjs';
import { gitRepositoryContextEnvironment } from '../scripts/git-repository-context.mjs';

const map = JSON.parse(fs.readFileSync(new URL('../live-src/change-impact.json', import.meta.url), 'utf8'));
test('mapped features, shared edits, docs and unknown files select discovered coverage', () => {
  const bunch = selectAffectedTests(['assets/bunch-note.js'], { map });
  assert.deepEqual(bunch.modules, ['bunch-notes']);
  assert.ok(bunch.nodeUnit.includes('tests/bunch-note.test.mjs'));
  assert.ok(bunch.playwrightTags.includes('@bunch-note'));
  assert.equal(selectAffectedTests(['docs/example.md'], { map }).nodeUnit.length, 0);
  const unknown = selectAffectedTests(['assets/unmapped.js'], { map });
  assert.ok(unknown.nodeUnit.length > 0);
  assert.ok(unknown.vitest.length > 0);
  const plan = focusedPlan({ nodeUnit: bunch.nodeUnit, vitest: [], playwrightTags: bunch.playwrightTags });
  assert.ok(plan.browsers.length);
  assert.equal(plan.unit.length, new Set(plan.unit).size);
});
test('foundation is excluded from focused unit selection', () => {
  const plan = focusedPlan({ nodeUnit: ['tests/release-app-lifecycle.test.mjs', 'tests/bunch-note.test.mjs', 'tests/bunch-note.test.mjs'], vitest: [], playwrightTags: [] });
  assert.deepEqual(plan, { unit: ['tests/bunch-note.test.mjs'], vitest: [], browsers: [] });
});

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(tmpdir(), 'gnc-local-validation-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, file), value); };
  write('.gitignore', '.gnc-local/\n');
  write('index.html', 'source');
  write('assets/bunch-note.js', 'source');
  write('tests/bunch-note.test.mjs', '// @test-group: bunch-notes\n');
  write('tests/bunch-note.e2e.spec.ts', '// @test-group: @local-e2e,bunch-notes\nimport { test } from \'@playwright/test\';\ntest("fixture", {tag:["@local-e2e"]}, async()=>{});\n');
  write('live-src/change-impact.json', JSON.stringify({ schemaVersion: 'gnc-change-impact-v1', modules: [{ id: 'bunch-notes', paths: ['assets/bunch-note.js'] }] }));
  const git = args => execFileSync('git', args, { cwd, stdio: 'pipe', env: gitRepositoryContextEnvironment() });
  git(['init', '--quiet']); git(['add', '.']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'base']);
  write('assets/bunch-note.js', 'current source');
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
test('one build feeds dynamically discovered focused tests and browsers', t => {
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
