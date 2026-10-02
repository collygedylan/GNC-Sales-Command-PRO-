// Isolated execution of the production schedule cards migration. Never connects remotely.
// node supabase/ci/production_schedule_cards_pglite.mjs --pglite-root .gnc-local/pglite
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const root = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !root) throw Error('Pass --pglite-root');
const { PGlite } = createRequire(path.join(path.resolve(root), 'package.json'))('@electric-sql/pglite');
const db = new PGlite();
const migration = fs.readFileSync(new URL('../migrations/20261002014421_index_request_history_assigned_rep_006.sql', import.meta.url), 'utf8');
const query = async (sql, params = []) => (await db.query(sql, params)).rows;

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.ph_request_history(unique_id text primary key, assigned_rep_id uuid, updated_at timestamptz);
    create table public.production_schedule_snapshots(
      id uuid primary key, status text not null check (status in ('queued','running','ready','failed','superseded'))
    );
    create table public.production_schedule_active(slot smallint primary key, snapshot_id uuid not null references public.production_schedule_snapshots(id));
    create table public.production_schedule_sheets(
      snapshot_id uuid not null references public.production_schedule_snapshots(id), sheet_index int not null,
      columns jsonb not null, filter_columns jsonb not null, primary key(snapshot_id,sheet_index)
    );
    create table public.production_schedule_rows(
      snapshot_id uuid not null, sheet_index int not null, source_row int not null, cells jsonb not null,
      search_vector tsvector not null, primary key(snapshot_id,sheet_index,source_row)
    );
    create index production_schedule_rows_search_idx on public.production_schedule_rows using gin(search_vector);
    create index production_schedule_rows_cells_idx on public.production_schedule_rows using gin(cells jsonb_path_ops);
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.exec(migration);
  console.log('PASS: migration parses, compiles, and applies in isolated PGlite');

  const snapshot = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const sheets = [
    { index: 1, header: 'Item' }, { index: 2, header: 'Status' }, { index: 784, header: 'Metric' },
  ];
  await query("insert into public.production_schedule_snapshots(id,status) values($1,'ready')", [snapshot]);
  await query('insert into public.production_schedule_active(slot,snapshot_id) values(1,$1)', [snapshot]);
  await query('insert into public.production_schedule_sheets(snapshot_id,sheet_index,columns,filter_columns) values($1,0,$2::jsonb,$3::jsonb)', [
    snapshot, JSON.stringify(sheets), JSON.stringify([sheets[1]]),
  ]);
  const cells1 = { '1': 'Accolade Elm', '2': 'Open', '784': '0', '3': 'source only' };
  const cells2 = { '1': 'Blue Point Juniper', '2': 'Closed', '784': '17', '3': 'other source value' };
  await query(`insert into public.production_schedule_rows(snapshot_id,sheet_index,source_row,cells,search_vector)
    values($1,0,9,$2::jsonb,to_tsvector('simple',$3)),($1,0,12,$4::jsonb,to_tsvector('simple',$5)),($1,0,18,'{}'::jsonb,''::tsvector)`, [
    snapshot, JSON.stringify(cells1), Object.values(cells1).join(' '), JSON.stringify(cells2), Object.values(cells2).join(' '),
  ]);
  await db.exec('set role service_role');
  const call = async (params) => (await query('select public.production_schedule_read_cards_v1($1,$2,$3,$4,$5,$6::jsonb,$7::integer[]) as data', [
    params.sheet ?? 0, params.snapshot ?? null, params.cursor ?? 0, params.limit ?? 100,
    params.search ?? '', JSON.stringify(params.filters ?? {}), params.columns ?? [1, 784],
  ]))[0].data;

  const projected = await call({ limit: 1 });
  assert.equal(projected.total, 3);
  assert.equal(projected.rows.length, 1);
  assert.deepEqual(projected.rows[0].cells, { '1': 'Accolade Elm', '784': '0' });
  assert.equal(projected.rows[0].sourceRow, 9);
  assert.equal(projected.rows[0].fieldCount, 4);
  assert.equal(projected.hasMore, true);
  assert.equal(projected.nextCursor, '9');
  const next = await call({ cursor: Number(projected.nextCursor), columns: [1] });
  assert.equal(next.rows[0].sourceRow, 12);
  assert.equal(next.rows[0].cells['1'], 'Blue Point Juniper');
  assert.equal(next.rows[0].cells['784'], undefined);
  const filtered = await call({ filters: { '2': 'Open' }, columns: [] });
  assert.equal(filtered.total, 1);
  assert.deepEqual(filtered.rows[0].cells, {});
  assert.equal(filtered.rows[0].fieldCount, 4);
  const searched = await call({ search: 'Blue Point', columns: [1] });
  assert.equal(searched.total, 1);
  assert.equal(searched.rows[0].sourceRow, 12);
  const capped = await call({ limit: 999 });
  assert.equal(capped.rows.length, 3);
  assert.equal(capped.hasMore, false);
  console.log('PASS: bounded projection, empty projection, zero-valued cells, field counts, filters, search, and cursor paging');

  await assert.rejects(() => call({ columns: [785] }), /PRODUCTION_SCHEDULE_COLUMNS_INVALID/);
  await assert.rejects(() => call({ columns: Array.from({ length: 33 }, (_, i) => i + 1) }), /PRODUCTION_SCHEDULE_COLUMNS_INVALID/);
  await assert.rejects(() => call({ filters: { '1': 'Accolade Elm' } }), /PRODUCTION_SCHEDULE_FILTER_INVALID/);
  await assert.rejects(() => call({ sheet: 99 }), /PRODUCTION_SCHEDULE_SHEET_NOT_FOUND/);
  await assert.rejects(() => call({ columns: [1, 1] }), /PRODUCTION_SCHEDULE_COLUMNS_INVALID/);
  const acl = await query(`select has_function_privilege('service_role',
    'public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])','execute') as service_ok,
    has_function_privilege('authenticated',
    'public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])','execute') as authenticated_ok`);
  assert.equal(acl[0].service_ok, true);
  assert.equal(acl[0].authenticated_ok, false);
  await db.exec('reset role');
  await query(`insert into public.production_schedule_rows(snapshot_id,sheet_index,source_row,cells,search_vector)
    select $1,0,source_row,'{}'::jsonb,''::tsvector from generate_series(100,700) source_row`, [snapshot]);
  await db.exec('set role service_role');
  const largePage = await call({ limit: 999 });
  assert.equal(largePage.total, 604);
  assert.equal(largePage.rows.length, 500);
  assert.equal(largePage.hasMore, true);
  const remainder = await call({ cursor: Number(largePage.nextCursor), limit: 500 });
  assert.equal(remainder.rows.length, 104);
  assert.equal(remainder.hasMore, false);
  console.log('PASS: invalid inputs rejected and RPC remains service-role-only');
} finally {
  await db.close();
}
