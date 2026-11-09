import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function commitFixture(root, fixture, files) {
  for (const args of [['init','--quiet'],['add','--',...files],
    ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','baseline'],
    ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','--allow-empty','-m','comparison']]) {
    const result = spawnSync('git',args,{cwd:fixture,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
    if (args[0] === 'init') {
      const objects=spawnSync('git',['rev-parse','--path-format=absolute','--git-path','objects'],{cwd:root,encoding:'utf8',windowsHide:true});
      assert.equal(objects.status,0,objects.stderr);
      fs.writeFileSync(path.join(fixture,'.git/objects/info/alternates'),objects.stdout.trim()+'\n');
    }
  }
}

export function prepareFastLockFixture(root, fixture, acornUrl, {portableGeometry = false} = {}) {
  const runtime=fs.readFileSync(path.join(root,'assets/app-runtime.js'),'utf8');
  const lock=fs.readFileSync(path.join(root,'scripts/fast-regression-lock.mjs'),'utf8');
  const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const files=new Set(['package.json','version.json','index.html','sw.js','.nojekyll','assets/app-runtime.js','assets/row-workflow-functions.js','assets/runtime-watchdog.js','assets/eval-reports-engine.js','assets/app-styles.css','scripts/fast-regression-lock.mjs','scripts/fast-regression-contracts.mjs','scripts/anti-spaghetti-lock.mjs','scripts/engineering-validator.mjs','scripts/engineering-ast-lock.mjs','scripts/monolith-growth-lock.mjs','scripts/git-batch-blobs.mjs','scripts/source-git-environment.mjs','scripts/monolith-baseline.json','scripts/engineering-proof.mjs']);
  for (const file of ['scripts/frontend-only-release.mjs','supabase/functions/app-api/index.ts']) files.add(file);
  for(const match of (lock.match(/const syntaxFiles = \[([^\]]+)\]/)?.[1] || '').matchAll(/['"]([^'"]+)['"]/g))files.add(match[1]);
  for(const file of ['scripts/syntax-lock-worker.mjs','scripts/fast-feature-lock.mjs','scripts/drive-permission-fixture.mjs','scripts/drive-mobile-geometry.mjs','src/ui/drive-geometry-fixture.mjs','.gnc-local/drive-mobile-geometry.json','assets/ops-precision-pilot.js','assets/aura-voice.js','assets/navigation-preferences.js','components/common/auraVoiceWidget.js'])files.add(file);
  for(const match of indexHtml.matchAll(/<link\b[^>]*>/gi)) {
    const tag=match[0],href=tag.match(/href=["']([^"']+)/)?.[1];
    if(/rel=["']stylesheet/.test(tag)&&href&&!/^(?:https?:)?\/\//.test(href))files.add(href.split('?')[0].replace(/^\.\//,''));
  }
  for(const match of runtime.matchAll(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g))files.add(match[1]);
  for(const match of lock.matchAll(/read\(['"](assets\/[^'"]+)['"]\)/g))files.add(match[1]);
  for(const file of files) {
    const out=path.join(fixture,file);fs.mkdirSync(path.dirname(out),{recursive:true});
    const original=path.join(root,file);
    const input=file === '.gnc-local/drive-mobile-geometry.json' && (portableGeometry || !fs.existsSync(original))
      ? path.join(root,'tests/fixtures/drive-geometry-receipt.json') : original;
    fs.copyFileSync(input,out);
  }
  fs.mkdirSync(path.join(fixture,'supabase/functions'),{recursive:true});
  fs.writeFileSync(path.join(fixture,'.gitignore'),'node_modules/\nartifact/\n.gnc-local/engineering-proof*\n');files.add('.gitignore');
  fs.symlinkSync(path.join(root,'node_modules'),path.join(fixture,'node_modules'),'junction');
  const helper=path.join(fixture,'scripts/fast-regression-contracts.mjs'), original=fs.readFileSync(helper,'utf8');
  assert(original.includes("from 'acorn'"));
  fs.writeFileSync(helper,original.replace("from 'acorn'",'from '+JSON.stringify(acornUrl)));
  commitFixture(root,fixture,[...files]);
  const env={...process.env}; delete env.GITHUB_EVENT_PATH;
  const proof=spawnSync(process.execPath,['scripts/anti-spaghetti-lock.mjs'],{cwd:fixture,encoding:'utf8',windowsHide:true,timeout:30000,env});
  assert.equal(proof.status,0,proof.stdout+proof.stderr);
  const run=(args=[])=>spawnSync(process.execPath,['scripts/fast-regression-lock.mjs',...args],{cwd:fixture,encoding:'utf8',windowsHide:true,timeout:10000,env});
  return {runtime,indexHtml,run};
}

function fixtureWriter(fixture, restore) {
  return (file,value) => {
    const target=path.join(fixture,file), prior=fs.existsSync(target)?fs.readFileSync(target):null;
    restore.push({target,prior});
    if(value===null)fs.rmSync(target);else fs.writeFileSync(target,value);
  };
}

export function checkLockMutation(fixture, run, mutate, patterns) {
  const restore=[];
  try {
    mutate(fixtureWriter(fixture,restore));
    const failed=run();assert.notEqual(failed.status,0,'Injected regression passed');
    for(const pattern of patterns)assert.match(failed.stdout+failed.stderr,pattern);
  } finally {
    for(const {target,prior} of restore.reverse()) {
      if(prior===null)fs.rmSync(target,{force:true});else fs.writeFileSync(target,prior);
    }
  }
}


export function prepareArtifactFixture(fixture) {
  const artifact = path.join(fixture, 'artifact');
  for (const name of ['assets', 'components']) fs.cpSync(path.join(fixture, name), path.join(artifact, name), {recursive:true});
  for (const name of ['index.html', 'sw.js', 'version.json', '.nojekyll']) fs.copyFileSync(path.join(fixture, name), path.join(artifact, name));
  const runtime = fs.readFileSync(path.join(fixture, 'assets/app-runtime.js'), 'utf8');
  const composed = runtime.replace(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g,
    (_, file) => fs.readFileSync(path.join(fixture, file), 'utf8'));
  fs.writeFileSync(path.join(artifact, 'assets/live-app-runtime-v2026082010.min.js'), composed);
  return artifact;
}
