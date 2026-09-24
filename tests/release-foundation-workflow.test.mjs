import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const workflow = yaml.load(read('.github/workflows/release-validation.yml'));
test('foundation is a required sealed-artifact gate before functional and feature suites', () => {
  const job = workflow.jobs.foundation;
  assert.equal(job.needs, 'build');
  assert.equal(job['timeout-minutes'], 8);
  assert.ok(job.steps.some(step => step.uses === './.github/actions/download-release'));
  assert.ok(job.steps.some(step => step.run === 'npm run test:foundation -- --reporter=github'));
  assert.ok(job.steps.some(step => step.run === 'node scripts/release-artifact.mjs verify'));
  for (const name of ['functional', 'compiled']) assert.ok(workflow.jobs[name].needs.includes('foundation'));
  assert.ok(workflow.jobs['release-gate'].needs.includes('foundation'));
  assert.match(workflow.jobs['release-gate'].steps[0].run, /'foundation'/);
  assert.doesNotMatch(job.steps.map(step => step.run || '').join('\n'), /build:|--retries=[1-9]|continue-on-error/);
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
  const html = read('index.html');
  assert.equal(html.split('data-app-lifecycle').length, 2);
  assert.doesNotMatch(html, /function installShellMaintenanceLifecycle|productionLiveSyncNavigation = new AbortController/);
  assert.match(html, /AgMetricLifecycle\.getSignal\('session'\)/);
  assert.match(html, /AgMetricLifecycle\.resetSession\(\)/);
});
