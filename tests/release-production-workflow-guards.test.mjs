import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const load = (file) => yaml.load(fs.readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'));

test('manual production mutation workflows require the main ref', () => {
  const guarded = [
    ['apps-script-lifecycle-canary.yml', 'canary'],
    ['photo-archive.yml', 'archive'],
    ['weather-hold-learning.yml', 'sync-weather-hold-learning'],
    ['production-auth-health.yml', 'published-release'],
    ['codex-ops-maintenance.yml', 'cleanup'],
    ['drive-sync.yml', 'sync-models']
  ];
  for (const [file, jobName] of guarded) {
    const condition = String(load(file).jobs[jobName].if || '');
    assert.match(condition, /github\.ref == 'refs\/heads\/main'/, `${file} must reject feature-branch dispatch`);
  }
});

test('scheduled production maintenance remains eligible while feature dispatch does not', () => {
  const mixed = [
    ['photo-archive.yml', 'archive'],
    ['weather-hold-learning.yml', 'sync-weather-hold-learning'],
    ['production-auth-health.yml', 'published-release'],
    ['codex-ops-maintenance.yml', 'cleanup'],
    ['drive-sync.yml', 'sync-models']
  ];
  for (const [file, jobName] of mixed) {
    const condition = String(load(file).jobs[jobName].if || '');
    assert.match(condition, /github\.event_name != 'workflow_dispatch'/, `${file} must preserve non-manual triggers`);
  }
  assert.equal(load('apps-script-lifecycle-canary.yml').jobs.canary.if, "github.ref == 'refs/heads/main'");
});
