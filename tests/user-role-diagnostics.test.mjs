import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticRoles, diagnosticRequestAllowed, probeRoleBaseline, openDiagnosticDriveCards } from '../scripts/diagnose-user-roles.mjs';
const api = 'https://example.supabase.co/functions/v1/app-api';

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
      ['#drive-content .app-smart-card','wait',{state:'visible',timeout:30000}]]);
  }
});
test('diagnostic coverage includes sales, nursery and supervisory roles, including whitespace aliases', () => {
  for (const role of ['ADMIN','REP','CSR','DATA ENTRY','DATA ENTRY SUPERVISOR','EVAL','FOREMAN','GROWER','QC','QC SUPERVISOR','TAKE BACKS','\nREP']) {
    assert.ok(diagnosticRoles.includes(role));
  }
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
  for (const operation of ['master_page','master_delta','source_freshness','schema_capabilities']) {
    assert.equal(diagnosticRequestAllowed(api,'POST',{action:'inventory_read',operation}),true);
  }
  for (const body of [{action:'drive_reclass_inquiry',operation:'create'}, {action:'request_history',operation:'complete'},
    {action:'inventory_read',operation:'master_page',commandId:'write'}, {action:'navigation_preferences',operation:'save'}]) {
    assert.equal(diagnosticRequestAllowed(api,'POST',body),false);
  }
  assert.equal(diagnosticRequestAllowed('https://example.supabase.co/auth/v1/admin/users','POST',{}),false);
  assert.equal(diagnosticRequestAllowed('https://example.supabase.co/rest/v1/ph_master_inventory','PATCH',{}),false);
});
