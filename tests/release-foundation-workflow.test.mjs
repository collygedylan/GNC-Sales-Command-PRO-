import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: foundation
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const workflow = yaml.load(read('.github/workflows/release-validation.yml'));
test('foundation remains a sealed-artifact diagnostic in the scheduled nightly suite', () => {
  const nightly = yaml.load(read('.github/workflows/nightly-validation.yml'));
  const job = workflow.jobs.foundation;
  assert.ok(job.needs.includes('build'));
  assert.ok(job.needs.includes('release-mode'));
  assert.match(job.if, /inputs\.run-nightly-suites/);
  assert.equal(job['timeout-minutes'], 20);
  assert.ok(job.steps.some(step => step.uses === './.github/actions/download-release'));
  assert.ok(job.steps.some(step => step.run === 'npm run test:foundation -- --project=${{ matrix.project }} --max-failures=1 --reporter=github'));
  assert.deepEqual(job.strategy.matrix.include.map(row => row.project), ['lifecycle-chromium', 'lifecycle-iphone']);
  assert.equal(job.strategy['fail-fast'], true);
  assert.ok(job.steps.some(step => step.run === 'node scripts/release-artifact.mjs verify'));
  for (const name of ['functional', 'compiled']) assert.deepEqual(workflow.jobs[name].needs, ['build', 'release-mode']);
  assert.ok(workflow.jobs['release-gate'].needs.includes('foundation'));
  assert.match(workflow.jobs['release-gate'].steps[0].run, /RUN_NIGHTLY_SUITES/);
  assert.equal(nightly.on.schedule[0].cron, '30 1,2 * * *');
  assert.equal(nightly.jobs['expanded-validation'].with['run-nightly-suites'], true);
  assert.equal(nightly.jobs['expanded-validation'].with['run-schema-tests'], false);
  assert.doesNotMatch(job.steps.map(step => step.run || '').join('\n'), /build:|--retries|continue-on-error/);
  const manifest = JSON.parse(read('package.json'));
  assert.doesNotMatch(manifest.scripts['test:foundation'], /--retries/);
  assert.match(read('playwright.app-lifecycle.config.ts'), /retries: process\.env\.CI \? 2 : 0/);
});
test('local feedback builds a fresh complete site without publication or silent reuse', () => {
  const source = read('scripts/check-foundation.mjs');
  assert.match(source, /mkdtempSync/);
  assert.match(source, /scripts\/prepare-release-site\.mjs/);
  assert.match(source, /APP_LIFECYCLE_SITE_DIR: site, APP_LIFECYCLE_BASE_URL: ''/);
  assert.match(source, /'--workers=1', '--retries=0'/);
  assert.match(source, /result\.status !== 0/);
  assert.match(source, /local-feedback-not-release-proof/);
  assert.doesNotMatch(source, /git push|workflow run|release-candidate|artifact\.mjs seal/);
});
test('the compiler embeds the one lifecycle owner before deferred runtime boot', () => {
  const source = read('scripts/build-live-shell.mjs');
  assert.match(source, /rawHtml\.split\(lifecycleTag\)\.length !== 2/);
  assert.match(source, /assets', 'app-lifecycle\.js'/);
  assert.match(source, /id="app-lifecycle-owner"/);
  const html = readComposedAppSource();
  assert.equal(html.split('data-app-lifecycle').length, 2);
  assert.doesNotMatch(html, /function installShellMaintenanceLifecycle|productionLiveSyncNavigation = new AbortController/);
  assert.match(html, /AgMetricLifecycle\.getSignal\('session'\)/);
  assert.match(html, /AgMetricLifecycle\.resetSession\(\)/);
});
// @test-group: foundation
