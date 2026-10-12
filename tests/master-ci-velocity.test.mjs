import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { runReleaseUnitChecks, collectReleaseUnitTestFiles } from '../scripts/run-release-unit-checks.mjs';
import { selectSupabaseImages } from '../scripts/ci-supabase-image-cache.mjs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
test('parallel unit shards execute every discovered file exactly once', () => {
  const all = [];
  for (let i = 1; i <= 4; i++) runReleaseUnitChecks({ argv: [`--shard=${i}/4`], print() {}, spawn(_node, args) {
    assert.deepEqual(args.slice(0, 2), ['--test', '--test-concurrency=1']);
    all.push(...args.slice(2)); return { status: 0 };
  } });
  assert.deepEqual(all.sort(), collectReleaseUnitTestFiles().sort());
  assert.equal(new Set(all).size, all.length);
  for (const value of ['--shard=0/4', '--shard=5/4', '--shard=1/33']) assert.throws(() => runReleaseUnitChecks({ argv: [value] }), /Usage/);
});
test('React, Node, database and immutable build lanes run concurrently', () => {
  const workflow = yaml.load(read('.github/workflows/release-validation.yml'));
  for (const lane of ['unit', 'react', 'contracts', 'database', 'build']) assert.equal(workflow.jobs[lane].needs, undefined);
  assert.deepEqual(workflow.jobs.unit.strategy.matrix.shard, [1, 2, 3, 4]);
  const build = workflow.jobs.build.steps.find(step => step.uses === 'docker/build-push-action@v7');
  assert.match(build.with['cache-from'], /type=gha.*version=2/);
  assert.match(build.with['cache-to'], /mode=max/);
  const docker = read('Dockerfile.ci');
  assert.ok(docker.indexOf('COPY package.json package-lock.json') < docker.indexOf('RUN npm ci'));
  assert.ok(docker.indexOf('RUN npm ci') < docker.indexOf('COPY . .'));
  assert.match(read('Dockerfile.ci.dockerignore'), /\*\*\/\.env\*/);
});
test('image caches contain only reusable service images, never application images or volumes', () => {
  assert.deepEqual(selectSupabaseImages('supabase/postgres:17\nsupabase/gotrue:v2\nghcr.io/supabase/realtime:v2\nkong:2.8\nprivate/app:latest\nsupabase/postgres:<none>\nsupabase/postgres:17\n'),
    ['supabase/postgres:17', 'supabase/gotrue:v2', 'ghcr.io/supabase/realtime:v2', 'kong:2.8']);
  const action = yaml.load(read('.github/actions/setup-supabase-images/action.yml'));
  const cache = action.runs.steps.find(step => step.uses === 'actions/cache@v4');
  assert.match(cache.with.path, /gnc-supabase-images$/);
  assert.equal(cache.with['restore-keys'], undefined);
  assert.match(cache.with.key, /cli2\.111\.0/);
});
