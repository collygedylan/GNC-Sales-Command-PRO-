import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkerApi, localWorkerConfig, pollLocalWorkerOnce, runClaimedLocalJob } from '../scripts/local-erp-sync-worker.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agdata-local-erp-worker-'));
}
function prepareStageDirs(root) {
  for (const relative of ['DriveAround/DriveAround','DriveAround/Processed','Custom AV/cav PENDING','Custom AV/cav PROCESSED',
    'Reserves 10Reserve/Unprocessed Reserves','Reserves 10Reserve/Processed Reserves','SOC/SOC','SOC/Porcessed SOC',
    'PO Reports/HL/27F1 PENDING HL','PO Reports/HL/27F1 PROCESSED HL']) fs.mkdirSync(path.join(root,relative),{recursive:true});
}

test('local worker observes status then claims exactly once and moves only after staged commit', async () => {
  const root = tempRoot();
  try {
    prepareStageDirs(root);
    const input = path.join(root,'DriveAround/DriveAround/Drive.csv');
    fs.writeFileSync(input,'itemcode,commonname,locationcode\n001,Blue Grass,C.15.000\n');
    const calls = [];
    const api = async (operation, fields = {}) => {
      calls.push({operation,fields});
      if (operation === 'status') return {active:true,status:'queued',runId:'run-1'};
      if (operation === 'claim_worker') return {claimed:true,status:{active:true,status:'running',runId:'run-1'}};
      if (operation === 'check_file') return {skip:false};
      if (operation === 'columns') return ['itemcode','commonname','locationcode','unique_id'];
      if (operation === 'begin') return {stage_id:'stage-1',expected_rows:1,staged_rows:0};
      if (operation === 'append') return {staged_rows:1};
      if (operation === 'commit') return {ok:true};
      return {};
    };
    const attemptedRuns = new Set();
    const result = await pollLocalWorkerOnce({api,basePath:root,workerId:'worker-1',attemptedRuns,log:()=>{}});
    assert.equal(result.outcome,'processed');
    assert.equal(result.status,'complete');
    assert.equal(calls.filter(call => call.operation === 'claim_worker').length,1);
    assert.equal(calls.some(call => call.operation === 'start'),false);
    assert.deepEqual(calls.slice(0,2).map(call => call.operation),['status','claim_worker']);
    const claim = calls[1];
    assert.equal(claim.fields.runId,'run-1');
    assert.equal(claim.fields.workerId,'worker-1');
    const append = calls.find(call => call.operation === 'append');
    assert.equal(append.fields.args.p_rows.length,1);
    assert.equal(fs.existsSync(input),false);
    assert.equal(fs.existsSync(path.join(root,'DriveAround/Processed/Drive.csv')),true);
    for (const key of ['cav','reserves','soc','hl_po_parsed']) {
      assert.ok(result.stageResults.some(row => row.key === key && row.outcome === 'UP_TO_DATE'));
    }
    const second = await pollLocalWorkerOnce({api,basePath:root,workerId:'worker-2',attemptedRuns,log:()=>{}});
    assert.equal(second.outcome,'idle');
    assert.equal(calls.filter(call => call.operation === 'claim_worker').length,1);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('nonempty HL folder is held without allocation import or source move', async () => {
  const root = tempRoot();
  try {
    prepareStageDirs(root);
    const workbook = path.join(root,'PO Reports/HL/27F1 PENDING HL/HL PO.csv');
    fs.writeFileSync(workbook,'itemcode,locationcode,quantityordered\n001,C.15.000,4\n');
    const calls = [];
    const api = async (operation, fields = {}) => {
      calls.push(operation);
      if (operation === 'status') return {active:true,status:'queued',runId:'run-hl'};
      if (operation === 'claim_worker') return {claimed:true,status:{active:true,status:'running',runId:'run-hl'}};
      return {};
    };
    const result = await pollLocalWorkerOnce({api,basePath:root,workerId:'worker-hl',attemptedRuns:new Set(),log:()=>{}});
    assert.equal(result.status,'blocked');
    assert.ok(result.stageResults.some(row => row.key === 'hl_po_parsed' && row.outcome === 'requires_template'));
    assert.equal(calls.includes('begin'),false);
    assert.equal(calls.includes('append'),false);
    assert.equal(calls.includes('commit'),false);
    assert.equal(fs.existsSync(workbook),true);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('idle status never claims, and API transport uses the dedicated worker key with a public apikey', async () => {
  assert.throws(() => localWorkerConfig({},'G:\\My Drive\\GNC'),/ERP_LOCAL_WORKER_AUTH_REQUIRED/);
  const config = localWorkerConfig({ERP_SYNC_LOCAL_WORKER_KEY:'worker-key',SUPABASE_ANON_KEY:'anon-key'},'G:\\My Drive\\GNC');
  assert.equal(config.workerKey,'worker-key');
  assert.equal(config.anonKey,'anon-key');
  const calls = [];
  const api = createWorkerApi({apiUrl:'https://kzrnyjsosryejjejliii.supabase.co/functions/v1/app-api',workerKey:'test-worker-key',anonKey:'test-anon-key',
    fetcher:async (_url,options) => { calls.push(options); return {ok:true,json:async()=>({ok:true,data:{active:false,status:'idle'}})}; }});
  const root = tempRoot();
  try {
    const result = await pollLocalWorkerOnce({api,basePath:root,attemptedRuns:new Set(),log:()=>{}});
    assert.equal(result.outcome,'idle');
    assert.equal(calls.length,1);
    assert.equal(calls[0].headers.authorization,'Bearer test-worker-key');
    assert.equal(calls[0].headers.apikey,'test-anon-key');
    assert.deepEqual(JSON.parse(calls[0].body),{action:'erp_sync_worker',payload:{operation:'status'}});
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
