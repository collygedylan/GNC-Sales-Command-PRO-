import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {inspectProgram,canonicalEngineFailures,forbiddenAssetText,liveAssetVersionFailures} from '../scripts/fast-regression-contracts.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const acornUrl=pathToFileURL(path.join(path.dirname(require.resolve('acorn')),'acorn.mjs')).href;
const canonical={engines:['resolveCanonicalInventoryRow','publishRowEvaluationToMasterAndNotes'],routes:[['card','resolveCanonicalInventoryRow'],['save','publishRowEvaluationToMasterAndNotes']],transports:{transport:['publishRowEvaluationToMasterAndNotes']},reportRenderers:['report']};
const valid=`function resolveCanonicalInventoryRow(row){return row} function publishRowEvaluationToMasterAndNotes(){return transport()} function card(row){return resolveCanonicalInventoryRow(row)} function save(){return publishRowEvaluationToMasterAndNotes()} function report(){return '<button>Block Alpha</button>'}`;
test('canonical routes require executable calls and unique owners',()=>{
 assert.deepEqual(canonicalEngineFailures(inspectProgram(valid),canonical),[]);
 for(const code of [valid.replace('return resolveCanonicalInventoryRow(row)',"return 'resolveCanonicalInventoryRow(row)'"),valid.replace('return publishRowEvaluationToMasterAndNotes()','return transport()'),valid+' function resolveCanonicalInventoryRow(){return null}',valid.replace('function publishRowEvaluationToMasterAndNotes()','function oldPublisher()')])assert(canonicalEngineFailures(inspectProgram(code),canonical).length);
 assert(canonicalEngineFailures(inspectProgram(valid+' function stray(){runSuspendTagRowCommand("save",row,patch)}'),canonical).some(e=>e.includes('Suspend save')));
});
test('report chrome and all raw forbidden strings are independently rejected',()=>{
 for(const markup of ['← All reports','&larr; All reports','EVAL REPORTS #2 > LOWSTOCK','EVAL REPORTS #2 &gt; LOWSTOCK','<summary>Reports: Low Stock</summary>','<summary><span>Filters</span></summary>']){
  const code=valid.replace("'<button>Block Alpha</button>'",JSON.stringify(markup));
  assert(canonicalEngineFailures(inspectProgram(code),canonical).some(e=>/report/.test(e)),markup);
 }
 for(const phrase of ['Request Still Open','Take or upload at least one request photo','APPROVED BUNCH NOTE:'])assert.deepEqual(forbiddenAssetText('// '+phrase),[phrase]);
});
test('every local script and stylesheet has exactly the release version',()=>{
 const version='3.0.33';
 assert.deepEqual(liveAssetVersionFailures('<script src="./assets/a.js?v='+version+'"></script><link rel="stylesheet" href="/assets/a.css?v='+version+'"><script src="https://cdn.invalid/vendor.js"></script>',version),[]);
 for(const url of ['./a.js','./a.js?v=old','./a.js?v='+version+'.1','./a.js?v='+version+'&amp;v='+version])assert.equal(liveAssetVersionFailures('<script src="'+url+'"></script>',version).length,1);
 assert.equal(liveAssetVersionFailures("<link rel='stylesheet' href='./bad.css?v=old'>",version).length,1);
 assert.deepEqual(liveAssetVersionFailures('<script>const text="inline"</script><link rel="icon" href="./icon.png">',version),[]);
});
test('actual mandatory command passes good source and fails injected regressions',()=>{
 const tempBase=fs.realpathSync(os.tmpdir());
 const fixture=fs.mkdtempSync(path.join(tempBase,'agdata-fast-lock-'));
 assert(path.resolve(fixture).startsWith(path.resolve(tempBase)+path.sep));
 try {
  const runtime=fs.readFileSync(path.join(root,'assets/app-runtime.js'),'utf8');
  const lock=fs.readFileSync(path.join(root,'scripts/fast-regression-lock.mjs'),'utf8');
  const files=new Set(['package.json','version.json','index.html','sw.js','.nojekyll','assets/app-runtime.js','assets/row-workflow-functions.js','assets/runtime-watchdog.js','assets/eval-reports-engine.js','assets/app-styles.css','scripts/fast-regression-lock.mjs','scripts/fast-regression-contracts.mjs']);
  for (const file of ['scripts/drive-permission-fixture.mjs','scripts/drive-mobile-geometry.mjs','.gnc-local/drive-mobile-geometry.json','assets/ops-precision-pilot.js','assets/aura-voice.js','assets/navigation-preferences.js','components/common/auraVoiceWidget.js']) files.add(file);
  const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const match of indexHtml.matchAll(/<link\b[^>]*>/gi)){const tag=match[0],href=tag.match(/href=["']([^"']+)/)?.[1];if(/rel=["']stylesheet/.test(tag)&&href&&!/^(?:https?:)?\/\//.test(href))files.add(href.split('?')[0].replace(/^\.\//,''));}
  for(const match of runtime.matchAll(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g))files.add(match[1]);
  for(const match of lock.matchAll(/read\(['"](assets\/[^'"]+)['"]\)/g))files.add(match[1]);
  for(const file of files){const out=path.join(fixture,file);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(root,file),out);}
  fs.mkdirSync(path.join(fixture,'supabase/functions'),{recursive:true});
  const helper=path.join(fixture,'scripts/fast-regression-contracts.mjs');
  const originalHelper=fs.readFileSync(helper,'utf8');assert(originalHelper.includes("from 'acorn'"));
  fs.writeFileSync(helper,originalHelper.replace("from 'acorn'",'from '+JSON.stringify(acornUrl)));
  const run=()=>spawnSync(process.execPath,['scripts/fast-regression-lock.mjs'],{cwd:fixture,encoding:'utf8',windowsHide:true,timeout:10000});
  const good=run();assert.equal(good.status,0,good.stdout+good.stderr);assert.match(good.stdout,/FAST REGRESSION LOCK PASS/);
  const check=(mutate,patterns)=>{const restore=[];const write=(file,value)=>{const target=path.join(fixture,file);const prior=fs.existsSync(target)?fs.readFileSync(target):null;restore.push(()=>prior===null?fs.rmSync(target,{force:true}):fs.writeFileSync(target,prior));if(value===null)fs.rmSync(target);else fs.writeFileSync(target,value);};try{mutate(write);const failed=run();assert.notEqual(failed.status,0,'Injected regression passed');for(const pattern of patterns)assert.match(failed.stdout+failed.stderr,pattern);}finally{restore.reverse().forEach(fn=>fn());}};
  check(write=>write('index.html',indexHtml.replace('<button type="button" id="drive-excel-lotcode-btn"','<span><button type="button" id="drive-excel-lotcode-btn"')),[/static direct siblings|invalid nesting/]);
  check(write=>write('assets/app-styles.css',fs.readFileSync(path.join(fixture,'assets/app-styles.css'),'utf8')+'\n#drive-content{max-height:300px!important}'),[/geometry proof is stale/]);
  check(write=>write('assets/app-runtime.js',runtime.replace('function renderDrive() {\n            ensureDriveToolbarControls();','function renderDrive() {')),[/ensureDriveToolbarControls|geometry proof is stale/]);
  const snapshot=fs.readFileSync(path.join(fixture,'assets/app-update-state.js'),'utf8');
  check(write=>write('assets/app-update-state.js',snapshot.replace('function saveWorkStateBeforeAppUpdate(', 'function removedSaveWorkState(').replace('function restoreWorkStateAfterAppUpdate(', 'function removedRestoreWorkState(')),[/canonical saveWorkStateBeforeAppUpdate/,/canonical restoreWorkStateAfterAppUpdate/]);
  check(write=>write('index.html',fs.readFileSync(path.join(fixture,'index.html'),'utf8').replace(/(src="\.\/assets\/app-runtime\.js\?v=)[^"]+/, '$1wrong')),[/asset version mismatch/]);
  const row=fs.readFileSync(path.join(fixture,'assets/row-workflow-functions.js'),'utf8');
  check(write=>{write('assets/app-runtime.js',runtime+'\nfunction {');write('assets/row-workflow-functions.js',row+'\nfunction {')},[/app-runtime\.js: syntax invalid/,/row-workflow-functions\.js: syntax invalid/]);
  check(write=>write('assets/forbidden-regression.txt','Request Still Open\nTake or upload at least one request photo\nAPPROVED BUNCH NOTE:'),[/forbidden asset text Request Still Open/,/forbidden asset text Take or upload at least one request photo/,/forbidden asset text APPROVED BUNCH NOTE:/]);
  check(write=>{write('assets/app-runtime.js',runtime+'\nfunction duplicateSave(){ return saveSecureDriveEvidence(row); }');write('assets/row-workflow-functions.js',row.replace('function resolveCanonicalInventoryRow(','function oldCanonicalRow(').replace('function publishRowEvaluationToMasterAndNotes(','function oldPublisher('))},[/canonical resolveCanonicalInventoryRow/,/canonical publishRowEvaluationToMasterAndNotes/,/duplicateSave bypasses canonical publication/]);
  check(write=>write('assets/app-runtime.js',runtime+`
    function strayRawMaster(){return runDetailWriteWithRetry('ph_master_inventory','PATCH',{spec:'bad'});}
    function strayRequest(){return supabaseRpc('save_request_work',{});}
    function straySeason(){return seasonSalesOfficeApi('save_av_note',{});}
    function strayPhoto(){return postAppFunctionJson('request_work',{operation:'append_photo'});}
    function straySuspend(){return runSuspendTagRowCommand(done?'complete':'save',row,patch);}
  `),[/strayRawMaster bypasses audited master publication/,/strayRequest bypasses canonical RPC/,/straySeason bypasses canonical Season/,/strayPhoto bypasses canonical Request photo/,/straySuspend bypasses canonical Suspend save/]);
  check(write=>write('assets/app-runtime.js',runtime.replace('if (scrollFramePending) return;','if (false) return;')),[/scroll frame coalescing missing/]);
  check(write=>write('assets/app-runtime.js',runtime.replace(/(function renderManagerEvalReport2DrillGroupCard\([^)]*\)\s*\{)/,"$1 const blockedChrome='<button>← All reports</button>EVAL REPORTS #2 > LOWSTOCK<summary>Filters</summary>';")),[/redundant report navigation/,/Reports\/Filters accordion/]);
  check(write=>{const old=[3,0,23].join('.');write('version.json',JSON.stringify({version:old,release:'AgData v'+old}));write('.nojekyll',null)},[/release predates canonical engine lock/,/release mismatch/,/root \.nojekyll missing/]);
  check(write=>write('index.html',fs.readFileSync(path.join(fixture,'index.html'),'utf8').replace('<script id="app-script-source"','<script type="module" id="app-script-source"')),[/classic runtime loading changed/]);
 } finally {
  const target=path.resolve(fixture);assert(target.startsWith(path.resolve(tempBase)+path.sep)&&path.basename(target).startsWith('agdata-fast-lock-'));
  fs.rmSync(target,{recursive:true,force:true});
 }
});
