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
import { localEvidenceDirectory } from '../scripts/release-disk-policy.mjs';
import { recordCandidateValidation, recordValidationRun } from '../scripts/repair-ledger.mjs';

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

function clearTemporaryFixture(directory) {
  const relative = path.relative(tmpdir(), path.resolve(directory));
  assert.match(relative, /^gnc-local-(?:validation|runner-evidence)-[^\\/]+$/);
  function visit(target) {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const file = path.join(target, entry.name);
      if (entry.isSymbolicLink()) fs.unlinkSync(file);
      else if (entry.isDirectory()) visit(file);
      else {
        fs.chmodSync(file, 0o600);
        fs.writeFileSync(file, '');
        fs.unlinkSync(file);
      }
    }
    fs.rmdirSync(target);
  }
  visit(directory);
}

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(tmpdir(), 'gnc-local-validation-'));
  t.after(() => clearTemporaryFixture(cwd));
  const write = (file, value) => { fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, file), value); };
  write('.gitignore', '.gnc-local/\n_site/\n');
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
      const site = path.join(cwd, '_site');
      const evidence = localEvidenceDirectory(cwd);
      fs.mkdirSync(site, { recursive: true });
      fs.mkdirSync(evidence, { recursive: true });
      fs.writeFileSync(path.join(site, 'index.html'), 'fresh compiled fixture');
      fs.writeFileSync(path.join(evidence, 'foundation-check.json'), JSON.stringify({ ok: true, site, sourceDigest: sourceDigest(cwd), siteDigest: siteDigest(site), baseCommit: 'a'.repeat(40), stages: [] }));
    }
    return { status: 0 };
  };
  return { cwd, write, calls, spawn };
}
function useRunnerEvidenceRoot() {
  const oldGithubActions = process.env.GITHUB_ACTIONS;
  const oldRunnerTemp = process.env.RUNNER_TEMP;
  const runnerTemp = fs.mkdtempSync(path.join(tmpdir(), 'gnc-local-runner-evidence-'));
  process.env.GITHUB_ACTIONS = 'true';
  process.env.RUNNER_TEMP = runnerTemp;
  return () => {
    if (oldGithubActions === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = oldGithubActions;
    if (oldRunnerTemp === undefined) delete process.env.RUNNER_TEMP; else process.env.RUNNER_TEMP = oldRunnerTemp;
    clearTemporaryFixture(runnerTemp);
  };
}
test('one build feeds dynamically discovered focused tests and browsers', t => {
  const f = fixture(t);
  const restoreEnvironment = useRunnerEvidenceRoot();
  let result;
  try {
    result = runLocalChecks({ ...f, npm: 'npm-cli.js', print: () => {} });
    assert.equal(result.ok, true, JSON.stringify(result.failure || {}));
    assert.equal(f.calls.filter(c => c.args.includes('check:foundation')).length, 1);
    assert.equal(result.site, path.join(f.cwd, '_site'));
    assert.ok(result.output.startsWith(localEvidenceDirectory(f.cwd)));
    const browser = f.calls.find(c => c.args.includes('playwright.local.config.ts'));
    assert.equal(browser.env.GNC_LOCAL_SITE_DIR, result.site);
    assert.ok(browser.args.includes('--retries=0'));
    assert.equal(assertLocalValidation(f.cwd).ok, true);
    fs.writeFileSync(path.join(result.site, 'index.html'), 'stale');
    assert.throws(() => assertLocalValidation(f.cwd), /BUILD_CHANGED/);
    f.write('index.html', 'edited again');
    assert.throws(() => assertLocalValidation(f.cwd), /SOURCE_CHANGED/);
  } finally {
    restoreEnvironment();
  }
});
test('failed baseline invalidates prior success, skips focused work, and blocks dispatch evidence', t => {
  const f = fixture(t);
  const restoreEnvironment = useRunnerEvidenceRoot();
  try {
    const passed = runLocalChecks({ ...f, npm: 'npm-cli.js', print: () => {} });
    assert.equal(passed.ok, true, JSON.stringify(passed.failure || {}));
    let count = 0;
    const failed = runLocalChecks({ cwd: f.cwd, npm: 'npm-cli.js', spawn: () => { count++; return { status: 1 }; }, print: () => {} });
    assert.equal(count, 1);
    assert.equal(failed.ok, false);
    assert.throws(() => assertLocalValidation(f.cwd), /LOCAL_CHECK_FAILED/);
  } finally {
    restoreEnvironment();
  }
});
test('missing local evidence cannot authorize candidate dispatch', t => {
  const f = fixture(t);
  assert.throws(() => assertLocalValidation(f.cwd), /LOCAL_CHECK_REQUIRED/);
});

test('foundation build stays in repo _site and validation plus repair ledgers stay in evidence storage', t => {
  const f = fixture(t);
  const source = fs.readFileSync(new URL('../scripts/check-foundation.mjs', import.meta.url), 'utf8');
  assert.match(source, /releaseSiteDirectory\(root\)/);
  assert.doesNotMatch(source, /mkdtempSync/);
  assert.match(source, /localEvidenceDirectory\(root\)/);
  const restoreEnvironment = useRunnerEvidenceRoot();
  try {
    const evidence = localEvidenceDirectory(f.cwd);
    fs.mkdirSync(evidence, { recursive: true });
    const site = path.join(f.cwd, '_site');
    fs.mkdirSync(site, { recursive: true });
    fs.writeFileSync(path.join(site, 'index.html'), 'compiled');
    const report = { schemaVersion: 'gnc-local-check-v1', ok: true, site,
      sourceDigest: sourceDigest(f.cwd), siteDigest: siteDigest(site), output: evidence, completedAt: new Date().toISOString(), stages: [] };
    fs.writeFileSync(path.join(evidence, 'local-check.json'), JSON.stringify(report));
    assert.equal(assertLocalValidation(f.cwd).ok, true);
    recordCandidateValidation(f.cwd, { phase: 'validation' });
    recordValidationRun(f.cwd, report);
    execFileSync(process.execPath, [path.resolve('scripts/repair-ledger.mjs'), 'diagnosis', 'gpt-6.1-sol', 'low'],
      { cwd: f.cwd, env: { ...process.env }, stdio: 'pipe' });
    assert.equal(fs.existsSync(path.join(evidence, 'validation-history.jsonl')), true);
    assert.equal(fs.existsSync(path.join(evidence, 'repair-ledger.json')), true);
    assert.equal(fs.existsSync(path.join(f.cwd, '.gnc-local')), false);
    assert.equal(fs.existsSync(path.join(f.cwd, '.gnc-local', 'validation-history.jsonl')), false);
  } finally {
    restoreEnvironment();
  }
});
