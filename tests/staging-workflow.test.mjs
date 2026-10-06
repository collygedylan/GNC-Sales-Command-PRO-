import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
const source = fs.readFileSync(new URL('../.github/workflows/staging-teardown.yml',import.meta.url),'utf8');
const workflow = yaml.safeLoad(source);
test('staging workflow only handles the staging base and requires all validation jobs',()=>{
  assert.deepEqual(workflow.on.push.branches,['staging-teardown']);
  assert.deepEqual(workflow.on.pull_request.branches,['staging-teardown']);
  assert.equal(workflow.concurrency['cancel-in-progress'],true);
  assert.equal(workflow.jobs.regression.with['production-health'],false);
  assert.deepEqual(workflow.jobs['staging-gate'].needs,['architecture','database','regression','build','browser']);
  assert.equal(workflow.jobs.browser.strategy['fail-fast'],true);
  assert.match(workflow.jobs.browser.steps.find(step=>step.name==='Mobile staging boundaries').run,/--max-failures=1/);
});
test('publisher executes no candidate files, targets separate repo and serializes deployment',()=>{
  const publish = workflow.jobs.publish;
  assert.equal(publish.environment,'staging-teardown');
  assert.equal(publish.needs,'staging-gate');
  assert.match(publish.if,/github.ref == 'refs\/heads\/staging-teardown'/);
  assert.equal(publish.concurrency['cancel-in-progress'],false);
  assert.ok(!publish.steps.some(step=>String(step.uses).includes('checkout')));
  const app=publish.steps.find(step=>String(step.uses).includes('create-github-app-token'));
  assert.equal(app.with.repositories,'gnc-teardown-staging');
  assert.doesNotMatch(source,/secrets\.(?:SUPABASE_|APPS_SCRIPT_|GDRIVE_)/);
  const command=publish.steps.find(step=>step.name==='Publish only the separate staging repository').run;
  assert.match(command,/gnc-teardown-staging\.git/);
  assert.ok(command.includes("find artifact -type f \\( -iname 'CNAME' -o -iname 'OneSignalSDKWorker.js' -o -iname 'OneSignalSDKUpdaterWorker.js' \\)"));
  assert.doesNotMatch(command,/test ! -f artifact\/CNAME/);
  assert.doesNotMatch(command,/GNC-Sales-Command-PRO-|HEAD:main|npm |node /);
});
test('staging rules never change main, and restoration requires human review',()=>{
  const rules=fs.readFileSync(new URL('../scripts/staging/configure-rules.mjs',import.meta.url),'utf8');
  assert.match(rules,/include: \['refs\/heads\/staging-teardown'\]/);
  assert.match(rules,/required_approving_review_count: phase === 'review' \? 1 : 0/);
  assert.doesNotMatch(rules,/refs\/heads\/main/);
});

test('hosted acceptance requires publication, the exact commit, and real account checks',()=>{
  const hosted=workflow.jobs['hosted-review'];
  assert.equal(hosted.needs,'publish');
  assert.equal(hosted.environment,'staging-teardown');
  assert.match(hosted.steps.find(step=>step.name==='Require exact hosted commit').run,/commitSha === process.env.SOURCE_SHA/);
  const auth=hosted.steps.find(step=>step.name==='Verify real synthetic workflows on Android and iPhone');
  assert.equal(auth.if,undefined);
  assert.match(auth.run,/playwright.auth.config.ts --workers=1 --max-failures=1/);
  assert.match(auth.env.TEARDOWN_STAGING_ACCESS_CODE,/secrets.TEARDOWN_STAGING_ACCESS_CODE/);
  const config=fs.readFileSync(new URL('../staging/playwright.auth.config.ts',import.meta.url),'utf8');
  assert.match(config,/trace: 'off'/);
});
