import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {prepareFastLockFixture,checkLockMutation,prepareArtifactFixture} from './helpers/fast-lock-fixture.mjs';
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
 const version='3.0.54';
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
  const {runtime,indexHtml,run}=prepareFastLockFixture(root,fixture,acornUrl,{portableGeometry:true});
  const good=run();assert.equal(good.status,0,good.stdout+good.stderr);assert.match(good.stdout,/FAST REGRESSION LOCK PASS/);
  const artifact = prepareArtifactFixture(fixture);
  const artifactGood = run(['--artifact-root',artifact]);
  assert.equal(artifactGood.status,0,artifactGood.stdout+artifactGood.stderr);
  const artifactVersion = path.join(artifact,'version.json');
  const priorVersion = fs.readFileSync(artifactVersion);
  fs.writeFileSync(artifactVersion, JSON.stringify({version:'3.0.0',release:'AgData v3.0.0'}));
  const artifactBad = run(['--artifact-root',artifact]);
  assert.notEqual(artifactBad.status,0);
  assert.match(artifactBad.stdout+artifactBad.stderr,/Pages artifact.*release mismatch|Pages artifact differs from source release/);
  fs.writeFileSync(artifactVersion,priorVersion);
  const check=(mutate,patterns)=>checkLockMutation(fixture,run,mutate,patterns);
  check(write=>write('index.html',indexHtml.replace('<button type="button" id="drive-excel-lotcode-btn"','<span><button type="button" id="drive-excel-lotcode-btn"')),[/static direct siblings|invalid nesting/]);
  check(write=>write('assets/app-styles.css',fs.readFileSync(path.join(fixture,'assets/app-styles.css'),'utf8')+'\n#drive-content{max-height:300px!important}'),[/geometry proof is stale/]);
  check(write=>write('assets/av-inventory-card.js',fs.readFileSync(path.join(fixture,'assets/av-inventory-card.js'),'utf8').replace('Loading…','Loading photos…')),[/geometry proof is stale/]);
  check(write=>write('assets/app-runtime.js',runtime.replace('function renderDrive() {\n            ensureDriveToolbarControls();','function renderDrive() {')),[/ensureDriveToolbarControls|geometry proof is stale/]);
  const snapshot=fs.readFileSync(path.join(fixture,'assets/app-update-state.js'),'utf8');
  const restore=fs.readFileSync(path.join(fixture,'assets/app-update-restore.js'),'utf8');
  check(write=>{
    write('assets/app-update-state.js',snapshot.replace('function saveWorkStateBeforeAppUpdate(', 'function removedSaveWorkState('));
    write('assets/app-update-restore.js',restore.replace('function restoreWorkStateAfterAppUpdate(', 'function removedRestoreWorkState('));
  },[/canonical saveWorkStateBeforeAppUpdate/,/canonical restoreWorkStateAfterAppUpdate/]);
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
  const dependencies=path.join(target,'node_modules');
  if(fs.existsSync(dependencies)){assert(fs.lstatSync(dependencies).isSymbolicLink());fs.rmdirSync(dependencies);}
  fs.rmSync(target,{recursive:true,force:true});
 }
});
