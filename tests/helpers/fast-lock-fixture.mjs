import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function commitFixture(fixture, files) {
  for (const args of [['init','--quiet'],['add','--',...files],
    ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','baseline'],
    ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','--allow-empty','-m','comparison']]) {
    const result = spawnSync('git',args,{cwd:fixture,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
  }
}

export function prepareFastLockFixture(root, fixture, acornUrl) {
  const runtime=fs.readFileSync(path.join(root,'assets/app-runtime.js'),'utf8');
  const lock=fs.readFileSync(path.join(root,'scripts/fast-regression-lock.mjs'),'utf8');
  const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const files=new Set(['package.json','version.json','index.html','sw.js','.nojekyll','assets/app-runtime.js','assets/row-workflow-functions.js','assets/runtime-watchdog.js','assets/eval-reports-engine.js','assets/app-styles.css','scripts/fast-regression-lock.mjs','scripts/fast-regression-contracts.mjs','scripts/anti-spaghetti-lock.mjs','scripts/engineering-ast-lock.mjs']);
  for(const match of (lock.match(/const syntaxFiles = \[([^\]]+)\]/)?.[1] || '').matchAll(/['"]([^'"]+)['"]/g))files.add(match[1]);
  for(const file of ['scripts/syntax-lock-worker.mjs','scripts/fast-feature-lock.mjs','scripts/drive-permission-fixture.mjs','scripts/drive-mobile-geometry.mjs','.gnc-local/drive-mobile-geometry.json','assets/ops-precision-pilot.js','assets/aura-voice.js','assets/navigation-preferences.js','components/common/auraVoiceWidget.js'])files.add(file);
  for(const match of indexHtml.matchAll(/<link\b[^>]*>/gi)) {
    const tag=match[0],href=tag.match(/href=["']([^"']+)/)?.[1];
    if(/rel=["']stylesheet/.test(tag)&&href&&!/^(?:https?:)?\/\//.test(href))files.add(href.split('?')[0].replace(/^\.\//,''));
  }
  for(const match of runtime.matchAll(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g))files.add(match[1]);
  for(const match of lock.matchAll(/read\(['"](assets\/[^'"]+)['"]\)/g))files.add(match[1]);
  for(const file of files) {
    const out=path.join(fixture,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(root,file),out);
  }
  fs.mkdirSync(path.join(fixture,'supabase/functions'),{recursive:true});
  fs.writeFileSync(path.join(fixture,'.gitignore'),'node_modules/\n');files.add('.gitignore');
  fs.symlinkSync(path.join(root,'node_modules'),path.join(fixture,'node_modules'),'junction');
  const helper=path.join(fixture,'scripts/fast-regression-contracts.mjs'), original=fs.readFileSync(helper,'utf8');
  assert(original.includes("from 'acorn'"));
  fs.writeFileSync(helper,original.replace("from 'acorn'",'from '+JSON.stringify(acornUrl)));
  commitFixture(fixture,[...files]);
  const run=()=>spawnSync(process.execPath,['scripts/fast-regression-lock.mjs'],{cwd:fixture,encoding:'utf8',windowsHide:true,timeout:10000});
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
