import assert from 'node:assert/strict';
import vm from 'node:vm';
import { databaseBridge } from '../../tests/helpers/database-bridge.mjs';
import { smartHoldDirectReadFixture } from '../../tests/helpers/release-smoke-route-policy.mjs';
import { historicalSnapshotReadUrl } from '../services/historical-snapshot-transport.mjs';

export async function invariant567({ read }) {
  const [smartHold, registry, routePolicy, migration, appApi] = await Promise.all([
    read('assets/smart-hold-runtime-functions.js'),
    read('assets/live-sync-registry.js'),
    read('tests/helpers/release-smoke-route-policy.mjs'),
    read('supabase/migrations/20261109003000_agdata3039_snapshot_coverage.sql'),
    read('supabase/functions/app-api/index.ts'),
  ]);
  const logical = 'ph_drive_around_report_rows_snapshot_v3039';
  assert.match(smartHold, new RegExp(`\\['observations','${logical}'`));
  assert.doesNotMatch(smartHold, /\['observations','ph_drive_around_report_rows'/);
  assert.match(registry, /historical:[^\n]*ph_drive_around_report_rows'/);
  assert.doesNotMatch(registry, new RegExp(`historical:[^\\n]*${logical}`));
  assert.match(routePolicy, new RegExp(`${logical}:\\[`));
  const pageCalls = [];
  const context = vm.createContext({ fetchSupabaseRowsPage: async (_table, _query, limit, offset) => {
    pageCalls.push([limit, offset]);
    return { rows: Array.from({ length: limit }, (_, index) => offset + index) };
  } });
  vm.runInContext(smartHold, context);
  assert.equal((await context.fetchSmartHoldBoundedRows(logical, 'select=unique_id', 1500)).length, 1500);
  assert.deepEqual(pageCalls, [[1000, 0], [500, 1000]]);
  const url = `https://kzrnyjsosryejjejliii.supabase.co/rest/v1/${logical}`
    + '?select=unique_id%2Cfile_id%2Cfile_name%2Creport_date%2Citemcode%2Clocationcode%2Clotcode%2Choldstopcode%2Choldstopreason%2Chold_reason_category%2Choldstopbegindate%2Chsreasonbegin%2Citemspec%2Clocationnote'
    + '&itemcode=in.%28ITEM-1%29&order=report_date.desc%2Cunique_id.desc&limit=1000&offset=0';
  assert.deepEqual(smartHoldDirectReadFixture('GET', url), []);
  assert.deepEqual(smartHoldDirectReadFixture('GET', url.replace('limit=1000&offset=0', 'limit=500&offset=1000')), []);
  assert.equal(smartHoldDirectReadFixture('GET', url.replace(logical, 'ph_drive_around_report_rows')), null);
  const calls = [];
  const bridge = databaseBridge(async (target, init) => {
    calls.push({ target, method: init.method });
    return Response.json([]);
  });
  await bridge.fetchTable('https://kzrnyjsosryejjejliii.supabase.co', logical,
    new URL(url).search.slice(1), { method: 'GET' }, 1000, 'Smart Hold history');
  assert.equal(new URL(calls[0].target).pathname, `/rest/v1/${logical}`);
  await assert.rejects(bridge.fetchTable('https://kzrnyjsosryejjejliii.supabase.co', logical,
    'select=unique_id', { method: 'POST', body: '{}' }, 1000, 'unsafe write'), /read-only/);
  assert.equal(calls.length, 1);
  assert.match(appApi, /global: \{ fetch: \(input, init\) => fetchHistoricalSnapshot\(fetch, input, init\) \}/);
  const edgeUrl = 'https://kzrnyjsosryejjejliii.supabase.co/rest/v1/ph_drive_around_report_rows?select=unique_id';
  assert.equal(historicalSnapshotReadUrl(edgeUrl), edgeUrl.replace('ph_drive_around_report_rows', logical));
  assert.match(migration, /create or replace view public\.%I with\(security_invoker=true\)/);
  assert.match(migration, /create_snapshot_read_view_v3039\('public\.ph_drive_around_report_rows',[\s\S]*?'ph_drive_around_report_rows_snapshot_v3039'\)/);
}
