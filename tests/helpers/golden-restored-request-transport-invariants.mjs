import assert from 'node:assert/strict';
import {runFunctions, plain} from './golden-test-environment.mjs';

function rejectFirstEvidenceAttempt(row, calls) {
  return async (url, name, init) => {
    const body = JSON.parse(init.body);
    calls.push({url,name,body,authorization:init.headers.Authorization});
    if (calls.length === 1) throw new TypeError('Failed to fetch');
    return Response.json({ok:true,row});
  };
}

export async function invariant238() {
  const context=runFunctions('assets/app-runtime.js',['getCommittedDriveEvidenceReceipt','firstNonEmptyValue'],{});
  const item={UNIQUE_ID:'physical-a',ITEMCODE:'005687.031.1',LOCATIONCODE:'A.06.000',LOTCODE:'27.F1'};
  const row={unique_id:'physical-a',itemcode:item.ITEMCODE,locationcode:item.LOCATIONCODE,lotcode:item.LOTCODE,av_note:'FULL BODY / SPEC - 16-18" H',loc_photo_match:41};
  const receipt=context.getCommittedDriveEvidenceReceipt({ok:true,row},item);
  assert.equal(receipt.canonicalConfirmed,true);assert.equal(receipt.writeConfirmed,true);assert.equal(receipt.row.av_note,row.av_note);
  assert.throws(()=>context.getCommittedDriveEvidenceReceipt({ok:true,row:{...row,unique_id:'physical-b'}},item),/IDENTITY/);
  assert.equal(context.getCommittedDriveEvidenceReceipt({ok:false,code:'DRIVE_FIELD_CONFLICT'},item),null);
  const calls=[];
  const transport=runFunctions('assets/app-runtime.js',['supabaseRpc'],{
    assertEvalDataSourceAllowed(){},getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer verified'}),
    SUPABASE_WRITE_TIMEOUT_MS:1000,SUPABASE_URL:'https://database.test',setTimeout,clearTimeout,
    window:{GncDatabase:{fetchRpc:rejectFirstEvidenceAttempt(row,calls)}},
    redactEvalSensitiveData:value=>value,Response
  });
  const command={p_master_uid:item.UNIQUE_ID,p_idempotency_key:'same-command'};
  const saved=await transport.supabaseRpc('save_drive_evidence_v3',command);
  assert.equal(saved.ok,true);assert.equal(calls.length,2);assert.deepEqual(plain(calls[1].body),command);assert.equal(calls[1].authorization,'Bearer verified');
}

export async function invariant463() {
  const sends = [];
  const api = runFunctions('assets/app-runtime.js', ['postAppFunctionJson','applyAppApiSessionHeaders'], {
    currentUser:'dylan_collyge', nativeAuthRecoveryEpoch:1, APP_VERSION:'fixture', SUPABASE_KEY:'public-fixture',
    getSupabaseReadIdentityScope:()=> 'fixture-owner', setTimeout,clearTimeout,
    window:{}, PRELOGIN_BACKGROUND_ACTIONS:new Set(), isAllowedAppHostname:() => true,
    getCurrentAppSessionToken:() => 'unusable-legacy-token',
    getNativeAuthRequestHeaders: async refresh => ({ Authorization: refresh ? 'Bearer renewed' : 'Bearer prior' }),
    canRunManualInventoryImport:() => true,
    fetchWithTimeout: async (_url, request, _timeout, _label, decode) => {
      sends.push({ headers:request.headers, payload:JSON.parse(request.body) });
      const ok = sends.length === 2;
      const response = { ok, status:ok ? 200 : 401, headers:{get:() => null},
        text:async () => JSON.stringify(ok ? {ok:true,cloudRelay:true} : {code:'AUTH_REQUIRED'}) };
      return decode(response);
    }
  });
  const command = { action:'erp_sync', operation:'start', commandId:'fixture-command', force:true };
  const receipt = await api.postAppFunctionJson('/app-api', command);
  assert.equal(receipt.cloudRelay, true);
  assert.deepEqual(sends.map(send => send.headers.Authorization), ['Bearer prior', 'Bearer renewed']);
  assert.ok(sends.every(send => !('x-gnc-session' in send.headers)));
  assert.deepEqual(sends.map(send => send.payload), [command, command]);
  const legacy = {};
  api.applyAppApiSessionHeaders(legacy, null, true);
  assert.equal(legacy['x-gnc-session'], 'unusable-legacy-token');
  api.getNativeAuthRequestHeaders = async () => { api.nativeAuthRecoveryEpoch++; return null; };
  await assert.rejects(api.postAppFunctionJson('/app-api', command), {code:'REQUEST_SCOPE_CHANGED'});
  assert.equal(sends.length, 2);

  let release;
  const oldStatus = new Promise(resolve => { release = resolve; });
  const current = { runId:'new', active:true, startedAt:'2026-11-04T18:00:00Z' };
  const poll = runFunctions('assets/app-runtime.js', ['refreshManualSyncStatus'], {
    currentUser:'dylan_collyge', document:{hidden:false}, navigator:{onLine:true},
    manualSyncStatusPollInFlight:false, manualSyncStatusState:null, getSupabaseReadIdentityScope:() => 'fixture-owner',
    fetchManualSyncStatusFromScript:() => oldStatus, applyManualSyncStatus:() => assert.fail('superseded status applied')
  });
  const observed = poll.refreshManualSyncStatus(true);
  poll.manualSyncStartGeneration++;
  poll.manualSyncStatusState = current;
  release({runId:'yesterday',active:false,percent:100});
  assert.equal(await observed, current);
}

function fixtureEarlyAuthResponse(calls) {
  return async (_url,request,_timeout,_label,decode) => {
    calls.push(request);
    const ok = calls.length === 2;
    const response = Response.json(ok?{ok:true}:{code:'AUTH_REQUIRED'},{status:ok?200:401});
    return decode ? decode(response) : response;
  };
}

export async function invariant464() {
  for (const multipart of [false,true]) {
    const calls = [];
    const api = runFunctions('assets/app-runtime.js', ['postAppFunctionJson','postAppFunctionFormData','applyAppApiSessionHeaders'], {
      currentUser:'fixture', nativeAuthRecoveryEpoch:1, APP_VERSION:'fixture', SUPABASE_KEY:'public', SUPABASE_UPLOAD_TIMEOUT_MS:1000,
      getSupabaseReadIdentityScope:()=> 'fixture-owner', setTimeout,clearTimeout,
      window:{}, PRELOGIN_BACKGROUND_ACTIONS:new Set(), isAllowedAppHostname:()=>true,
      getNativeAuthRequestHeaders:async refresh=>({Authorization:refresh?'Bearer fresh':'Bearer prior'}),
      getCurrentAppSessionToken:()=>'', isLoginScreenVisible:()=>false,
      fetchWithTimeout:fixtureEarlyAuthResponse(calls)
    });
    const body = multipart ? new FormData() : {action:'suspend_tag',operation:'save',commandId:'row-command'};
    if (multipart) body.set('prefix','req-');
    const result = await api[multipart?'postAppFunctionFormData':'postAppFunctionJson']('/app-api',body);
    assert.equal(result.ok,true);
    assert.deepEqual(calls.map(call=>call.headers.Authorization),['Bearer prior','Bearer fresh']);
    assert.equal(calls[0].body,calls[1].body);
  }
}
