import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {prepareAppsScriptPublication} from '../src/services/apps-script-publication-preparation.mjs';
import {mergeAppsScriptProjectFiles} from '../src/services/apps-script-project-files.mjs';
import {sameAppsScriptSourceBlobs} from '../src/services/apps-script-release-source.mjs';
import {assertRequestRowIsolation} from './helpers/request-row-isolation-contract.mjs';
import {assertRequestCompletionBatch} from './helpers/request-completion-batch-contract.mjs';

test('F1 and S1 require the full physical identity while qualified legacy aliases remain safe',assertRequestRowIsolation);

test('the completion worker sends no partial snapshot and builds every completed row from the authoritative receipt',assertRequestCompletionBatch);

test('the scoped companion keeps unrelated source and rejects a missing or substituted module',async()=>{
  const fingerprint="const APPS_SCRIPT_DEPLOYMENT_COMMIT_ = '__GNC_APPS_SCRIPT_DEPLOYMENT_COMMIT__';\n";
  const source=fingerprint+'function getRequestDeliveryRows_(eventRow) { return AgDataRequestCompletion.getRequestDeliveryRows(eventRow); }';
  const files=[{name:'Code',type:'SERVER_JS',source:fingerprint+'function getRequestDeliveryRows_(eventRow) { return eventRow.rows; }\nfunction retained() {return 4;}'}];
  const script={projects:{getContent:async()=>({data:{files}})}};
  const manifest={appsScriptPatchFunctions:['getRequestDeliveryRows_'],appsScriptScopedPatchFunctions:['getRequestDeliveryRows_']};
  const prepared=await prepareAppsScriptPublication({script,scriptId:'fixture',source,manifest,githubSha:'fixture',applyFingerprint:s=>s,deployedVersion:1});
  assert.match(prepared.source,/function retained\(\) \{return 4;\}/);
  assert.equal(prepared.companionFiles[0].name,'RequestCompletion');
  assert.match(prepared.companionFiles[0].source,/request_completion_dispatch_rows_v3065/);
  assert.throws(()=>mergeAppsScriptProjectFiles({files,source}),/REQUEST_COMPLETION_COMPANION_MISSING/);
  assert.throws(()=>mergeAppsScriptProjectFiles({files,source,companionFiles:[{...prepared.companionFiles[0],name:'Other'}]}),/COMPANION_ALLOWLIST_INVALID/);
});

test('the release source closure preserves paired photo modules and fences a changed completion companion',()=>{
  const sha='a'.repeat(40),next='b'.repeat(40),base=[sha,sha,sha,null,sha];
  assert.equal(sameAppsScriptSourceBlobs(base,base),true);
  assert.equal(sameAppsScriptSourceBlobs([sha,sha,null,null,sha],[sha,sha,null,null,sha]),false);
  assert.equal(sameAppsScriptSourceBlobs([sha,sha,sha,sha,sha],[sha,sha,sha,next,sha]),false);
});

test('the completion companion compiles as synchronous Apps Script without an import dependency',async()=>{
  const result=await build({entryPoints:[new URL('../src/services/request-completion-email.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],
    bundle:true,write:false,format:'iife',globalName:'AgDataRequestCompletion',platform:'neutral'});
  assert.doesNotMatch(result.outputFiles[0].text,/^import /m);
  assert.match(result.outputFiles[0].text,/AgDataRequestCompletion/);
});
