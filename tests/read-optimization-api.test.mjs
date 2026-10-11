import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('app-api.ts', source, ts.ScriptTarget.Latest, true);
const functions = ['parseProductionScheduleRequest', 'handleProductionScheduleAction'].map(name => {
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, name);
  return declaration.getText(tree).replace(/^export\s+/, '');
}).join('\n');

function fixture({ published = true, row = { source_row: 8, cells: { '1': '0', '2': '' } }, databaseError = null } = {}) {
  const calls = [];
  const context = vm.createContext({
    isProductionScheduleUser: username => ['dylan_collyge', 'megan_kelly', 'jd_jones'].includes(username),
    normalizeUsername: value => String(value || '').toLowerCase(),
    resolveActiveSessionProfile: async session => { if (session.inactive) throw new Error('inactive'); return session.actor; },
    errorResponse: (message, status, extra = {}) => ({ status, error: message, ...extra }),
    databaseFailureResponse: (message, error, code) => ({ status: error.code === '42501' ? 403 : 503, error: message, code: error.code || code }),
    jsonResponse: body => ({ status: 200, ...body }),
    supabase: {
      rpc: async (name, params) => { calls.push(['rpc', name, params]); return { data: { rows: [], total: 0, hasMore: false }, error: databaseError }; },
      from(table) {
        calls.push(['from', table]);
        const builder = {};
        for (const method of ['select', 'eq', 'in']) builder[method] = (...args) => { calls.push([method, ...args]); return builder; };
        builder.maybeSingle = async () => ({ error: databaseError,
          data: table === 'production_schedule_snapshots' ? published ? { id: snapshotId } : null : row });
        return builder;
      },
    },
  });
  vm.runInContext(ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { calls, parse: context.parseProductionScheduleRequest, invoke: context.handleProductionScheduleAction };
}
const snapshotId = '00000000-0000-4000-8000-000000000006';
const authorized = { actor: { username: 'dylan_collyge' } };

test('schedule compact parser bounds physical columns and preserves old full pages', () => {
  const { parse } = fixture();
  assert.equal(parse({ operation: 'rows', sheetId: 0 }).projection, 'full');
  const cards = parse({ operation: 'rows', sheetId: 0, projection: 'cards', columnIndexes: [1, 2, 2], limit: 900 });
  assert.equal(cards.limit, 500);
  assert.deepEqual([...cards.columnIndexes], [1, 2]);
  assert.equal(parse({ operation: 'rows', sheetId: 0, projection: 'cards', columnIndexes: [] }).columnIndexes.length, 0);
  for (const columnIndexes of [[0], [-1], ['1'], [1.5], Array.from({ length: 33 }, (_, i) => i + 1)]) {
    assert.throws(() => parse({ operation: 'rows', sheetId: 0, projection: 'cards', columnIndexes }), /COLUMNS_INVALID/);
  }
  assert.throws(() => parse({ operation: 'row_detail', sheetId: 0, sourceRow: 8 }), /ROW_INVALID/);
  assert.throws(() => parse({ operation: 'row_detail', sheetId: 0, sourceRow: 0, snapshotId }), /ROW_INVALID/);
});

test('schedule actions authorize active exact accounts before querying', async () => {
  for (const [session, status] of [[null, 401], [{ inactive: true }, 403], [{ mustChangePassword: true }, 403], [{ actor: { username: 'another_admin' } }, 403]]) {
    const f = fixture();
    assert.equal((await f.invoke(session, { operation: 'row_detail', snapshotId, sheetId: 0, sourceRow: 8 })).status, status);
    assert.equal(f.calls.length, 0);
  }
});

test('schedule card read selects bounded RPC and keeps legacy RPC for full callers', async () => {
  const f = fixture();
  await f.invoke(authorized, { operation: 'rows', sheetId: 0, snapshotId, projection: 'cards', columnIndexes: [1, 4], limit: 100 });
  assert.equal(f.calls[0][1], 'production_schedule_read_cards_v1');
  assert.equal(f.calls[0][2].p_limit, 100);
  assert.deepEqual([...f.calls[0][2].p_column_indexes], [1, 4]);
  await f.invoke(authorized, { operation: 'rows', sheetId: 0, snapshotId });
  assert.equal(f.calls[1][1], 'production_schedule_read_rows_v1');
  assert.equal('p_column_indexes' in f.calls[1][2], false);
});

test('detail pins exact published snapshot and row while preserving zero versus blank', async () => {
  const f = fixture();
  const result = await f.invoke(authorized, { operation: 'row_detail', snapshotId, sheetId: 2, sourceRow: 8 });
  assert.equal(result.status, 200);
  assert.equal(result.snapshotId, snapshotId);
  assert.equal(result.row.cells['1'], '0');
  assert.equal(result.row.cells['2'], '');
  assert.ok(f.calls.some(([method, key, value]) => method === 'eq' && key === 'source_row' && value === 8));
  assert.ok(f.calls.some(([method, key, value]) => method === 'eq' && key === 'sheet_index' && value === 2));
  assert.ok(f.calls.some(([method, key, value]) => method === 'eq' && key === 'snapshot_id' && value === snapshotId));
  const staged = fixture({ published: false });
  assert.equal((await staged.invoke(authorized, { operation: 'row_detail', snapshotId, sheetId: 2, sourceRow: 8 })).status, 409);
  assert.equal(staged.calls.some(([method, table]) => method === 'from' && table === 'production_schedule_rows'), false);
  assert.equal((await fixture({ row: null }).invoke(authorized, { operation: 'row_detail', snapshotId, sheetId: 2, sourceRow: 8 })).status, 404);
});
