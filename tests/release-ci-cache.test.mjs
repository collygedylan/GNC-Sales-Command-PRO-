import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const node = yaml.load(read('.github/actions/setup-node-dependencies/action.yml'));
const browsers = yaml.load(read('.github/actions/setup-playwright/action.yml'));
const expression = (source, context) => vm.runInNewContext(source.replace(/\.([\w]+-[\w-]+)/g, "['$1']"), context);
const expandKey = (key, context) => key.replace(/\$\{\{(.*?)\}\}/g, (_, code) => String(expression(code, context)));
const context = {
  runner: {os:'Linux',arch:'X64'},
  steps: {platform:{outputs:{image:'ubuntu24',browsers:'chromium'}},node:{outputs:{'node-version':'v22.20.0'}}},
  inputs: {'install-mode':'normal'},
  hashFiles: () => 'lock-a',
};

test('dependency caches miss on changed lockfiles, Node, image, arch or install mode', () => {
  const cache = node.runs.steps.find(step => step.id === 'dependencies');
  assert.equal(cache.uses, 'actions/cache/restore@v4');
  assert.equal(cache.with.path, 'node_modules');
  assert.equal(cache.with['restore-keys'], undefined);
  assert.match(cache.with.key, /hashFiles\('package.json', 'package-lock.json'\)/);
  const original = expandKey(cache.with.key, context);
  for (const alter of [
    c => { c.hashFiles = () => 'lock-b'; },
    c => { c.inputs['install-mode'] = 'ignore-scripts'; },
    c => { c.steps.node.outputs['node-version'] = 'v24.0.0'; },
    c => { c.steps.platform.outputs.image = 'ubuntu26'; },
    c => { c.runner.arch = 'ARM64'; },
    c => { c.runner.os = 'Windows'; },
  ]) {
    const variant = {...structuredClone({...context,hashFiles:undefined}),hashFiles:context.hashFiles};
    alter(variant);
    assert.notEqual(expandKey(cache.with.key, variant), original);
  }
});

test('only exact hits skip installation; clean caches are saved before caller code', () => {
  for (const hit of ['true','false','',undefined]) {
    const condition = node.runs.steps.find(step => step.name === 'Install locked dependencies on cache miss').if;
    assert.equal(expression(condition, {steps:{dependencies:{outputs:{'cache-hit':hit}}}}), hit !== 'true');
  }
  const steps = node.runs.steps;
  const install = steps.findIndex(step => step.name === 'Install locked dependencies on cache miss');
  const save = steps.findIndex(step => step.uses === 'actions/cache/save@v4');
  assert.equal(save, install + 1);
  assert.equal(save, steps.length - 1);
  assert.equal(steps[save].if, steps[install].if);
  assert.equal(steps[save].with.key, '${{ steps.dependencies.outputs.cache-primary-key }}');
  assert.equal(steps.find(step => step.uses === 'actions/setup-node@v4').with.cache, 'npm');
  const run = steps[install].run;
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  for (const mode of ['normal','ignore-scripts']) {
    const result = spawnSync(bash, ['-c', 'npm() { printf "%s\\n" "$*"; }\n' + run], {encoding:'utf8',env:{...process.env,INSTALL_MODE:mode}});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ci .*--no-audit --no-fund/);
    assert.equal(result.stdout.includes('--ignore-scripts'), mode === 'ignore-scripts');
  }
});

test('browser cache separates subsets and platforms and always ensures OS dependencies', () => {
  const cache = browsers.runs.steps.find(step => step.id === 'browsers');
  const original = expandKey(cache.with.key, context);
  assert.equal(cache.with['restore-keys'], undefined);
  for (const browserSet of ['webkit','chromium firefox webkit']) {
    const variant = {...context, steps:{...context.steps,platform:{outputs:{image:'ubuntu24',browsers:browserSet}}}};
    assert.notEqual(expandKey(cache.with.key, variant), original);
  }
  assert.notEqual(expandKey(cache.with.key, {...context,hashFiles:()=> 'lock-b'}), original);
  const install = browsers.runs.steps.find(step => step.name === 'Ensure browser binaries and system dependencies');
  assert.equal(install.if, undefined);
  assert.match(install.run, /prepare-ci-playwright-apt.mjs/);
  assert.match(install.run, /playwright install --with-deps/);
  const save = browsers.runs.steps.at(-1);
  assert.equal(save.uses, 'actions/cache/save@v4');
  assert.equal(save.with.key, '${{ steps.browsers.outputs.cache-primary-key }}');
});

test('all npm CI installs use shared caching without changing caller Node versions or guards', () => {
  const versions = {'apps-script-database-diagnostic.yml':20,'codex-ops.yml':24};
  let count = 0;
  for (const file of fs.readdirSync(new URL('../.github/workflows/',import.meta.url))) {
    const source = read('.github/workflows/'+file);
    assert.doesNotMatch(source, /\bnpm ci\b/, file);
    const workflow = yaml.load(source);
    for (const job of Object.values(workflow.jobs || {})) {
      for (const step of job.steps || []) if (step.uses === './.github/actions/setup-node-dependencies') {
        count++;
        assert.equal(Number(step.with?.['node-version'] || node.inputs['node-version'].default),versions[file] || 22,file);
      }
    }
  }
  assert.ok(count >= 12);
  const diagnostic = yaml.load(read('.github/workflows/apps-script-database-diagnostic.yml'));
  assert.equal(diagnostic.jobs['diagnose-database'].steps.find(s=>s.uses==='./.github/actions/setup-node-dependencies').with['install-mode'],'ignore-scripts');
  const photo = yaml.load(read('.github/workflows/photo-archive.yml'));
  assert.equal(photo.jobs.archive.steps.find(s=>s.uses==='./.github/actions/setup-node-dependencies').with['install-mode'],'ignore-scripts');
  const ops = yaml.load(read('.github/workflows/codex-ops.yml'));
  assert.equal(ops.jobs.repair.steps.find(s=>s.uses==='./.github/actions/setup-node-dependencies').if,"${{ steps.repair_gate.outputs.publish_allowed == 'true' }}");
});

