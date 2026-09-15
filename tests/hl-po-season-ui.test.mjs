import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf("        const PO_MANAGEMENT_TABLE =");
const end = html.indexOf('        function getWeatherHoldNumber(', start);
const runtime = () => {
  let owner = 'Dylan';
  const ctx = vm.createContext({ Map, Set, Object, Array, Promise, Date, Number, String,
    document: { getElementById: () => null }, getSupabaseReadIdentityScope: () => owner,
    canAccessView: () => true, isViewVisible: () => true, SUPABASE_READ_TIMEOUT_MS: 8000,
    shouldUseProductionLiveSyncSideLoad: () => false, classifyDatasetLoadFailureCode: () => 'DATASET_NETWORK_FAILURE',
  });
  vm.runInContext(html.slice(start, end), ctx);
  ctx.renderPoManagement = () => {};
  return { ctx, changeAccount: () => { owner = 'Another manager'; } };
};

test('a rejected obsolete PO read cannot overwrite the new season or account state', async () => {
  const { ctx, changeAccount } = runtime();
  let rejectFirst;
  const first = new Promise((_, reject) => { rejectFirst = reject; });
  const tables = [];
  ctx.fetchAuthenticatedSupabaseReadPage = async table => {
    tables.push(table);
    if (table === 'ph_view_po_27f1_hl') return first;
    return { rows: [{ itemcode: 'SPRING', lotcode: '27.S1', po_remain: 794 }] };
  };
  const old = ctx.loadPoManagementData();
  vm.runInContext("poManagementState = { ...poManagementState, season: '27S1', rows: [], loading: false, loaded: false, promise: null, error: '' };", ctx);
  changeAccount();
  await ctx.loadPoManagementData();
  rejectFirst(new Error('old request failed')); await old;
  const state = vm.runInContext('poManagementState', ctx);
  assert.equal(state.season, '27S1'); assert.equal(state.error, ''); assert.equal(state.loaded, true);
  assert.equal(state.rows[0].po_remain, 794);
  assert.deepEqual(tables, ['ph_view_po_27f1_hl', 'ph_view_po_27s1_hl']);
});

test('season-specific PO rows require every page before the read resolves', async () => {
  const { ctx } = runtime();
  const requests = [];
  ctx.fetchAuthenticatedSupabaseReadPage = async (table, query) => {
    requests.push([table, query]);
    return { rows: query.includes('offset=0') ? Array.from({ length: 1000 }, (_, i) => ({ itemcode: String(i), lotcode: '27.S1' })) : [{ itemcode: 'LAST', lotcode: '27.S1', po_remain: 0 }] };
  };
  const rows = await ctx.fetchPoManagementRows('27S1');
  assert.equal(rows.length, 1001); assert.equal(rows.at(-1).po_remain, 0);
  assert.equal(requests.length, 2); assert.match(requests[1][1], /offset=1000/);
  assert.equal(requests[0][0], 'ph_view_po_27s1_hl');
});
