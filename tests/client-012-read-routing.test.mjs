import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('protected browser datasets route through typed dataset_read projections and pagination caps', () => {
  const start = html.indexOf('function getAuthorizedDatasetRead(');
  const end = html.indexOf('\n        async function requestAuthorizedDatasetReadPage(', start);
  assert.ok(start >= 0 && end > start);
  const ctx = { URLSearchParams, Math, Number, String, Object, Array, Error, REQUEST_LIVE_SIGNATURE_SELECT_FIELDS: 'unique_id,req_status' };
  vm.createContext(ctx);
  vm.runInContext(`${html.slice(start, end)}; this.getMap=getAuthorizedDatasetRead; this.build=buildAuthorizedDatasetReadParams;`, ctx);
  assert.equal(ctx.getMap('ph_sales_office').dataset, 'sales_office');
  const query = 'select=unique_id&filename=eq.soc.csv&last_updated=not.is.null&or=(salesrepname.ilike.%25north%25,salesrepname.ilike.%25west%25)&order=last_updated.desc';
  const params = ctx.build('ph_reserves', query, 1000, 500);
  assert.equal(params.limit, 500);
  assert.equal(params.offset, 500);
  assert.equal(params.projection, 'ids');
  assert.deepEqual(JSON.parse(JSON.stringify(params.filters)), [
    { field: 'filename', op: 'eq', value: 'soc.csv' },
    { field: 'last_updated', op: 'not.is', value: null },
  ]);
  assert.equal(params.anyOf.length, 2);
  assert.equal(params.order[0].ascending, false);
});

test('client uses protected productivity append and never probes restricted tables anonymously', () => {
  const appendStart = html.indexOf('async function appendProductivityHistoryEntries(');
  const appendEnd = html.indexOf('\n        async function ', appendStart + 20);
  const append = html.slice(appendStart, appendEnd);
  assert.match(append, /append_productivity_history/);
  assert.match(append, /completed_by_username/);
  assert.doesNotMatch(append, /supabaseFetch\([^)]*PRODUCTIVITY_HISTORY_TABLE[^)]*POST/);
  assert.doesNotMatch(html, /\$\{SUPABASE_URL\}\/rest\/v1\/ph_(?:sales_office|dock_item_status|dock_issue_status|dock_issue_allocations)\?/);
  assert.doesNotMatch(html, /\$\{SUPABASE_URL\}\/rest\/v1\/ph_active_request\?select=completed_by_/);
  assert.match(html, /requestInventoryRead\('source_freshness'/);
});

test('Request terminal permission errors stop polling and manual Retry clears the denial gate', () => {
  const failureStart = html.indexOf('function recordRequestViewReadFailure(');
  const failureEnd = html.indexOf('\n        function clearRequestViewReadFailure(', failureStart);
  const failure = html.slice(failureStart, failureEnd);
  assert.match(failure, /requestViewTerminalReadIdentityScope = getSupabaseReadIdentityScope\(\)/);
  assert.match(failure, /clearRequestViewLiveSync\(\)/);
  const runStart = html.indexOf('async function runRequestViewLiveSync(');
  const runEnd = html.indexOf('\n        async function forceRefreshRequestsForView(', runStart);
  assert.match(html.slice(runStart, runEnd), /isRequestViewReadTerminalForCurrentIdentity\(\)/);
  assert.match(html.slice(runStart, runEnd), /finally[\s\S]*!isRequestViewReadTerminalForCurrentIdentity\(\)/);
  const retryStart = html.indexOf('function retryVerifiedViewData(');
  const retryEnd = html.indexOf('\n        function getViewBackgroundLoadDelayMs(', retryStart);
  assert.match(html.slice(retryStart, retryEnd), /clearSupabaseReadTerminalDenialsForIdentity\(\)/);
  assert.match(html.slice(retryStart, retryEnd), /requestViewTerminalReadIdentityScope = ''/);
});
