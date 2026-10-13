import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const yaml = createRequire(import.meta.url)('js-yaml');
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const workflow = file => yaml.load(read('.github/workflows/' + file));

test('root agent instructions persist the pipeline policy and explicit monitoring rule', () => {
  const policy = read('AGENTS.md');
  for (const rule of [
    /frontend publication and Supabase\/Apps Script backend deployment are decoupled/,
    /Standard PR validation runs unit tests and lint\/type checks only/,
    /scheduled daily at 09:17 UTC/,
    /Do not fix unrelated legacy phone layout tests, layout snapshots/,
    /final GitHub Pages workflow succeeds[\s\S]*immutable fingerprint check pass/,
    /job timeout is a safety limit, not an expected deployment duration/,
    /Monitor only when the user explicitly requests it for the current task/,
  ]) assert.match(policy, rule);
  assert.doesNotMatch(policy, /FIRE-AND-FORGET|STAY AWAKE|gh pr checks --watch/);
});

test('nightly retains daily and manual diagnostics and opts into full database coverage', () => {
  const nightly = workflow('nightly-browser-validation.yml');
  assert.equal(nightly.on.schedule[0].cron, '17 9 * * *');
  assert.ok(Object.hasOwn(nightly.on, 'workflow_dispatch'));
  assert.equal(nightly.jobs['expanded-validation'].with['run-nightly-suites'], true);
  for (const input of ['run-schema-tests', 'run-browser-tests', 'run-performance-tests', 'run-all-schema-tests']) {
    assert.equal(nightly.jobs['backend-diagnostics'].with[input], true, input);
  }
});

test('backend integration failure cannot become a Pages dependency', () => {
  const pages = workflow('pages-static.yml');
  assert.equal(pages.jobs.validation.with['run-backend-tests'], false);
  assert.equal(pages.jobs.validation.with['run-schema-tests'], false);
  assert.equal(pages.jobs.validation.with['run-nightly-suites'], false);
  assert.deepEqual(pages.jobs.deploy.needs, ['authorize-main', 'validation']);
  assert.equal(pages.jobs['exact-live'].needs, 'deploy');
  assert.doesNotMatch(JSON.stringify(pages.jobs), /apps-script-sync|release-database|backend-validation/);
});
