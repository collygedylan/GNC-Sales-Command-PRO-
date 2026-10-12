import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticRoles, diagnosticScreens, diagnosticDriveLoadedSelector, diagnosticRequestAllowed, probeRoleBaseline, openDiagnosticDriveCards, waitForDiagnosticHistory } from '../scripts/diagnose-user-roles.mjs';
const api = 'https://example.supabase.co/functions/v1/app-api';

test('diagnostics cover both nested Request History and Historical Requests routes', () => {
  assert.ok(diagnosticScreens.includes('request-history'));
  assert.ok(diagnosticScreens.includes('historical-requests'));
});

test('Drive diagnostics wait for real inventory cards before checking Reclass', async () => {
  for (const mobile of [true, false]) {
    const calls=[];
    const page={locator:selector=>({
      isVisible:async()=>mobile,
      selectOption:async value=>calls.push([selector,'select',value]),
      click:async()=>calls.push([selector,'click']),
      first:()=>({waitFor:async options=>calls.push([selector,'wait',options])}),
    })};
    await openDiagnosticDriveCards(page);
    assert.deepEqual(calls,[mobile?['#drive-mobile-mode','select','card']:['#tab-drive-card','click'],
      [diagnosticDriveLoadedSelector,'wait',{state:'visible',timeout:90000}]]);
    assert.match(diagnosticDriveLoadedSelector, /items match these filters\|rows are available for/);
    assert.doesNotMatch(diagnosticDriveLoadedSelector, /rows are loading/);
    assert.match(diagnosticDriveLoadedSelector, /\.drive-grid-row\[data-dom-id\]/);
  }
});
test('diagnostic coverage includes sales, nursery and supervisory roles, including whitespace aliases', () => {
  for (const role of ['ADMIN','REP','CSR','DATA ENTRY','DATA ENTRY SUPERVISOR','EVAL','FOREMAN','GROWER','QC','QC SUPERVISOR','TAKE BACKS','\nREP']) {
    assert.ok(diagnosticRoles.includes(role));
  }
});

test('history diagnostics accept ready empty folders and reject visible read errors', async () => {
  const calls = [];
  const page = { waitForFunction: async (fn, id, options) => calls.push([id, options, fn.toString()]) };
  const view = { locator: selector => ({
    waitFor: async options => calls.push([selector, options]),
    count: async () => 0,
  }) };
  await waitForDiagnosticHistory(page, view, 'request-history');
  assert.equal(calls[0][0], '.historical-requests');
  assert.equal(calls[1][0], 'view-request-history');
  assert.match(calls[1][2], /Loading\|\^Saving/);
  await assert.rejects(waitForDiagnosticHistory(page, { locator: () => ({ waitFor: async () => {}, count: async () => 1 }) }, 'historical-requests'), /could not load/);
  assert.equal(diagnosticRequestAllowed('https://example.supabase.co/rest/v1/rpc/historical_requests_read_v1','POST',{p_query:{operation:'months'}}), true);
});

test('authenticated baseline probes retain status and counts without recording rows or credentials', async () => {
  const calls=[];
  const results=[{data:{total:3,rows:[{customer:'Private customer',price:19}]}},
    {rows:[{name:'Private consignee'}]}, [{unique_id:'private-id'}]];
  const baseline=await probeRoleBaseline({session:{access_token:'private-token'}}, {
    supabaseURL:'https://example.supabase.co',key:'public-key',fetcher:async (url,options)=>{
      calls.push({url,options});return {status:200,json:async()=>results.shift()};
    },
  });
  assert.deepEqual(baseline,{inventory:{status:200,total:3,rows:1,code:undefined},
    history:{status:200,rows:1,code:undefined},requests:{status:200,rows:1,code:undefined}});
  assert.ok(calls.every(call=>call.options.headers.authorization==='Bearer private-token'));
  assert.ok(calls.every(call=>!call.options.method||call.options.method==='POST'));
  assert.doesNotMatch(JSON.stringify(baseline),/private-token|Private customer|Private consignee|private-id|price/);
});
test('diagnostics permit actual inventory reads and deny submissions and auth administration', () => {
  for (const action of ['av_read','get_user_preferences','live_pilot_bootstrap']) {
    assert.equal(diagnosticRequestAllowed(api,'POST',{action}),true);
    assert.equal(diagnosticRequestAllowed(api,'POST',{action,commandId:'write'}),false);
    assert.equal(diagnosticRequestAllowed(api,'POST',{action,operation:'save'}),false);
  }
  for (const operation of ['search','folders']) {
    assert.equal(diagnosticRequestAllowed(api,'POST',{action:'request_history',operation}),true);
  }
  for (const operation of ['master_page','master_delta','source_freshness','schema_capabilities']) {
    assert.equal(diagnosticRequestAllowed(api,'POST',{action:'inventory_read',operation}),true);
  }
  for (const body of [{action:'drive_reclass_inquiry',operation:'create'}, {action:'request_history',operation:'complete'},
    {action:'inventory_read',operation:'master_page',commandId:'write'}, {action:'navigation_preferences',operation:'save'},
    {action:'set_user_preferences'}, {action:'live_pilot_preferences_save'}]) {
    assert.equal(diagnosticRequestAllowed(api,'POST',body),false);
  }
  assert.equal(diagnosticRequestAllowed('https://example.supabase.co/auth/v1/admin/users','POST',{}),false);
  assert.equal(diagnosticRequestAllowed('https://example.supabase.co/rest/v1/ph_master_inventory','PATCH',{}),false);
});
