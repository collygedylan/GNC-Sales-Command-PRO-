import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const yaml = createRequire(import.meta.url)('js-yaml');
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const workflow = file => yaml.load(read('.github/workflows/' + file));

test('root agent instructions persist the workspace and implementation policies', () => {
  const policy = read('AGENTS.md');
  for (const rule of [
    /No spaghetti or God functions/, /Single source of truth/, /Separation of concerns/,
    /Supabase cost and quota guard/, /Zero dead code/, /No suppression comments/,
    /automatic baseline resets/, /anti-spaghetti-lock\.mjs/,
  ]) assert.match(policy, rule);
  assert.match(policy, /fast-regression-lock\.mjs/);
});

test('nightly retains daily and manual diagnostics and opts into full database coverage', () => {
  const nightly = workflow('nightly-validation.yml');
  assert.equal(nightly.on.schedule[0].cron, '30 1,2 * * *');
  assert.ok(Object.hasOwn(nightly.on, 'workflow_dispatch'));
  assert.match(nightly.jobs['central-time-gate'].steps[0].run, /TZ=America\/Chicago date \+%H/);
  assert.match(nightly.jobs['central-time-gate'].steps[0].run, /central_hour.*== "20"/);
  const email = nightly.jobs['compile-and-email-report'].steps.at(-1);
  assert.equal(email.uses, 'dawidd6/action-send-mail@v3');
  assert.equal(email.with.to, 'dylan_collyge@greenleafnursery.com');
  assert.equal(email.with.body, 'file://nightly-validation-report.txt');
  assert.match(email.with.server_address, /secrets\.SMTP_SERVER/);
  assert.match(email.with.username, /secrets\.SMTP_USERNAME/);
  assert.match(email.with.password, /secrets\.SMTP_PASSWORD/);
  assert.equal(nightly.jobs['expanded-validation'].with['run-nightly-suites'], true);
  for (const input of ['run-schema-tests', 'run-browser-tests', 'run-performance-tests', 'run-all-schema-tests']) {
    assert.equal(nightly.jobs['backend-diagnostics'].with[input], true, input);
  }
});

test('Pages frontend-only release stays independent and mixed release sequences backend first', () => {
  const pages = workflow('pages-static.yml');
  assert.ok(pages.jobs['fast-gate']);
  assert.match(pages.jobs['backend-publication'].if, /needs\.fast-gate\.outputs\.supabase == 'true'/);
  assert.match(pages.jobs['backend-publication'].if, /needs\.fast-gate\.outputs\['apps-script'\] == 'true'/);
  assert.match(pages.jobs.deploy.if, /needs\.backend-publication\.result == 'success'/);
  assert.match(pages.jobs.deploy.if, /needs\.backend-publication\.result == 'skipped'/);
  assert.equal(pages.jobs['exact-live'].needs, 'deploy');
  assert.match(JSON.stringify(pages.jobs), /apps-script-sync/);
});
