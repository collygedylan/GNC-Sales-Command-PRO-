import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw new Error('Pass --pglite-root');
const require = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const database = new PGlite();

async function seed() {
  await database.exec(`create schema private;create role anon;create role authenticated;create role service_role;
    create type private.fixture_profile as (id text);
    create function private.current_active_profile() returns private.fixture_profile language sql stable security definer set search_path=''
    as $$select row(nullif(current_setting('agdata.fixture_profile',true),''))::private.fixture_profile$$;
    create table public.ph_drive_around_report_files(file_id text primary key,file_name text,
      report_date date,canonical_report_date date,canonical_sequence integer,canonical_file_name text,
      status text default 'indexed',row_count integer,processed_at timestamptz);
    create table public.ph_orders_history(order_line_key text,itemcode text,first_seen_at timestamptz);
    create table public.ph_reserves_history(reserve_history_key text,itemcode text,first_seen_at timestamptz);
    create table public.ph_drive_mode_history(history_key text,itemcode text,first_seen_at timestamptz);
    create table public.ph_drive_around_report_rows(unique_id text primary key,itemcode text,
      locationcode text,lotcode text,season text,saleyear text,file_id text,file_name text,report_date date,
      row_number integer,ptravailable numeric,holdstopreason text,extra_header text,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.ph_hold_stop_itemcode_snapshots(unique_id text primary key,itemcode text,
      file_id text,file_name text,file_date date,canonical_sequence integer,file_rank integer,
      is_blocked boolean,holdstopreason text,source_row_ids text[],snapshot jsonb,
      created_at timestamptz default now(),updated_at timestamptz default now());
    grant select on public.ph_drive_around_report_rows,public.ph_hold_stop_itemcode_snapshots to anon,authenticated,service_role;
    alter table public.ph_drive_around_report_rows enable row level security;
    alter table public.ph_hold_stop_itemcode_snapshots enable row level security;
    create policy own_rows on public.ph_drive_around_report_rows for select to authenticated using(true);
    create policy own_rows on public.ph_hold_stop_itemcode_snapshots for select to authenticated using(true);
    create policy service_rows on public.ph_drive_around_report_rows for select to service_role using(true);
    create policy service_rows on public.ph_hold_stop_itemcode_snapshots for select to service_role using(true);
    create policy scheduled_handover_active_session on public.ph_drive_around_report_rows
      as restrictive for all to authenticated using ((select (private.current_active_profile()).id) is not null);
    create policy scheduled_handover_active_session on public.ph_hold_stop_itemcode_snapshots
      as restrictive for all to authenticated using ((select (private.current_active_profile()).id) is not null);
    set agdata.fixture_profile='fixture-user';`);
  for (let sequence = 1; sequence <= 8; sequence++) {
    await database.query(`insert into public.ph_drive_around_report_files(file_id,file_name,report_date,canonical_sequence,
      status,row_count,processed_at)
      values($1,$1,$2::date,$3,$4,$5,clock_timestamp())`,
    [`f${sequence}`, `2026-11-0${sequence}`, sequence, sequence === 8 ? 'indexed' : 'processed',
      sequence === 8 ? null : sequence === 6 ? 0 : 1]);
  }
  for (const [sequence, available] of [[1, 20], [2, 20], [3, 19], [4, 20], [5, 20], [7, 20]]) {
    await database.query(`insert into public.ph_drive_around_report_rows(unique_id,itemcode,locationcode,
      lotcode,season,saleyear,file_id,file_name,report_date,row_number,ptravailable,holdstopreason)
      values($1,'ITEM','A.01.001','27.F1','F1','2027',$2,$2,$3::date,$4,$5,'Grow')`,
    [`r${sequence}`, `f${sequence}`, `2026-11-0${sequence}`, sequence, available]);
    await database.query(`insert into public.ph_hold_stop_itemcode_snapshots(unique_id,itemcode,file_id,
      file_name,file_date,canonical_sequence,file_rank,is_blocked,holdstopreason,source_row_ids,snapshot)
      values($1,'ITEM',$2,$2,$3::date,$4,$4,$5,'Grow',$6,'{"locations":["A.01.001"]}')`,
    [`h${sequence}`, `f${sequence}`, `2026-11-0${sequence}`, sequence, available === 20, [`r${sequence}`]]);
  }
}

async function proveCoverage(table, view) {
  const before = (await database.query(`select to_jsonb(r) payload from public.${table} r order by unique_id`)).rows;
  const dry = (await database.query('select private.compact_snapshot_item_v3039($1,$2,false) report',
    [`public.${table}`, 'ITEM'])).rows[0].report;
  assert.equal(dry.observations, 6);
  assert.equal(dry.state_changes_kept, 4);
  assert.equal(dry.physical_rows_eligible, 2);
  await database.exec('begin');
  const receipt = (await database.query('select private.compact_snapshot_item_v3039($1,$2,true) report',
    [`public.${table}`, 'ITEM'])).rows[0].report;
  assert.equal(receipt.rows_removed, 2);
  assert.equal((await database.query(`select count(*) as count from public.${table}`)).rows[0].count, 4);
  assert.deepEqual((await database.query(`select to_jsonb(r) payload from public.${view} r order by unique_id`)).rows, before);
  const anchors = table.includes('hold') ? ['h1', 'h3', 'h4', 'h7'] : ['r1', 'r3', 'r4', 'r7'];
  assert.deepEqual((await database.query(`select unique_id from public.${table} order by unique_id`)).rows.map(row => row.unique_id), anchors);
  const coverage = (await database.query(`select * from public.ph_history_state_coverage_v3039
    where relation_id=$1::regclass::oid order by retained_id`, [`public.${table}`])).rows;
  assert.equal(coverage.length, 2);
  await database.exec('rollback');
  assert.equal((await database.query(`select count(*) as count from public.${table}`)).rows[0].count, 6);
  await database.query('select private.compact_snapshot_item_v3039($1,$2,true)', [`public.${table}`, 'ITEM']);
  const retry = (await database.query('select private.compact_snapshot_item_v3039($1,$2,true) report',
    [`public.${table}`, 'ITEM'])).rows[0].report;
  assert.equal(retry.rows_removed, 0);
  assert.deepEqual((await database.query(`select to_jsonb(r) payload from public.${view} r order by unique_id`)).rows, before);
}

async function proveReaderGate() {
  await database.exec(`create function public.unmigrated_reader_v3039() returns bigint language sql as
    $$select count(*) from public.ph_drive_around_report_rows$$`);
  await assert.rejects(database.query(`select private.compact_snapshot_item_v3039(
    'public.ph_drive_around_report_rows','ITEM',true)`), /HISTORY_UNMIGRATED_SNAPSHOT_READERS/);
  await database.exec('drop function public.unmigrated_reader_v3039()');
}

async function proveAmbiguousKeysStayWhole() {
  await database.exec(`begin; insert into public.ph_drive_around_report_rows(unique_id,itemcode,locationcode,lotcode,
    season,saleyear,file_id,file_name,report_date,ptravailable) values
    ('amb-1','AMB','A','L','F1','2027','f1','f1','2026-11-01',20),
    ('amb-2','AMB','A','L','F1','2027','f2','f2','2026-11-02',20),
    ('amb-3','AMB','A','L','F1','2027','f2','f2','2026-11-02',20)`);
  const report = (await database.query(`select private.snapshot_delta_report_v3039(
    'public.ph_drive_around_report_rows','AMB') report`)).rows[0].report;
  await database.exec('rollback');
  assert.equal(report.state_changes_kept, 3);
  assert.equal(report.physical_rows_eligible, 0);
}

async function proveReaderCompatibility() {
  await database.exec(`create function private.drive_around_report_state_hash_v2366(p_row public.ph_drive_around_report_rows)
    returns text language sql immutable as $$select md5(to_jsonb(p_row)::text)$$;
    create function private.historical_drive_file_page_v2367(p_file_id text,p_page integer,p_page_size integer)
    returns jsonb language sql stable security definer set search_path='' as $$
      select jsonb_agg(jsonb_build_object('id',row.unique_id,'hash',private.drive_around_report_state_hash_v2366(row)))
      from public.ph_drive_around_report_rows row where file_id=p_file_id
    $$;
    create function public.ph_refresh_hold_stop_itemcode_summaries() returns jsonb
    language plpgsql security definer set search_path='' as $$begin
      delete from public.ph_hold_stop_itemcode_snapshots where itemcode='ERASEME';
      return (select jsonb_agg(to_jsonb(s) order by s.unique_id) from public.ph_hold_stop_itemcode_snapshots s);
    end$$;
    create function public.get_historical_inventory_rows() returns jsonb language sql stable security invoker
    set search_path='' as $$select jsonb_agg(unique_id order by unique_id) from public.ph_drive_around_report_rows$$;
    revoke all on function public.get_historical_inventory_rows() from public,anon;
    grant execute on function public.get_historical_inventory_rows() to authenticated;
    grant execute on function private.historical_drive_file_page_v2367(text,integer,integer) to authenticated;`);
  const before = (await database.query(`select
    private.historical_drive_file_page_v2367('f2',0,25) drive,
    public.ph_refresh_hold_stop_itemcode_summaries() hold`)).rows;
  const contract = (await database.query(`select private.snapshot_function_contract_v3039(
    'private.historical_drive_file_page_v2367(text,integer,integer)'::regprocedure::oid) contract`)).rows[0];
  await database.exec(fs.readFileSync('supabase/migrations/20261109006000_agdata3039_snapshot_reader_compatibility.sql', 'utf8'));
  assert.deepEqual((await database.query(`select
    private.historical_drive_file_page_v2367('f2',0,25) drive,
    public.ph_refresh_hold_stop_itemcode_summaries() hold`)).rows, before);
  assert.deepEqual((await database.query(`select private.snapshot_function_contract_v3039(
    'private.historical_drive_file_page_v2367(text,integer,integer)'::regprocedure::oid) contract`)).rows[0], contract);
  const definition = (await database.query(`select pg_get_functiondef(
    'public.ph_refresh_hold_stop_itemcode_summaries()'::regprocedure) source`)).rows[0].source;
  assert.match(definition, /delete from public\.ph_hold_stop_itemcode_snapshots where/);
  assert.match(definition, /from public\.ph_hold_stop_itemcode_snapshots_snapshot_v3039 s/);
  return before;
}

async function proveInvokerAccess() {
  await database.exec('set role authenticated');
  try {
    const rows = (await database.query('select public.get_historical_inventory_rows() rows')).rows[0].rows;
    assert.deepEqual(rows, ['r1', 'r2', 'r3', 'r4', 'r5', 'r7']);
    await assert.rejects(database.query('select * from private.history_snapshot_states_v3039'), /permission denied for schema private/);
  } finally { await database.exec('reset role'); }
  await database.exec("set agdata.fixture_profile=''; set role authenticated");
  try {
    assert.equal((await database.query('select count(*) count from public.ph_drive_around_report_rows_snapshot_v3039')).rows[0].count, 0);
    assert.equal((await database.query('select count(*) count from public.ph_hold_stop_itemcode_snapshots_snapshot_v3039')).rows[0].count, 0);
  } finally { await database.exec("reset role; set agdata.fixture_profile='fixture-user'"); }
  await database.exec('set role anon');
  try {
    await assert.rejects(database.query('select public.get_historical_inventory_rows()'), /permission denied/);
    assert.equal((await database.query('select count(*) count from public.ph_drive_around_report_rows_snapshot_v3039')).rows[0].count, 0);
  } finally { await database.exec('reset role'); }
  await database.exec(`begin; create policy scoped_drive on public.ph_drive_around_report_rows
    as restrictive for select to authenticated using(itemcode='ITEM')`);
  await assert.rejects(database.query(`select private.compact_snapshot_item_v3039(
    'public.ph_drive_around_report_rows','ITEM',true)`), /HISTORY_SNAPSHOT_ROW_SCOPE_UNSUPPORTED/);
  await database.exec('rollback');
}

async function readObservation(view, id) {
  return (await database.query(`select to_jsonb(r) payload from public.${view} r where unique_id=$1`, [id])).rows[0]?.payload;
}

async function proveRetainedMutationIsolated() {
  const view = 'ph_drive_around_report_rows_snapshot_v3039';
  const anchor = await readObservation(view, 'r1');
  const duplicate = await readObservation(view, 'r2');
  await database.exec('begin');
  try {
    await database.exec("update public.ph_drive_around_report_rows set ptravailable=99 where unique_id='r1'");
    assert.deepEqual(await readObservation(view, 'r2'), duplicate);
    assert.deepEqual(await readObservation(view, 'r1'), anchor);
    await database.exec("delete from public.ph_drive_around_report_rows where unique_id='r1'");
    await database.exec('set role authenticated');
    assert.deepEqual(await readObservation(view, 'r2'), duplicate);
    assert.deepEqual(await readObservation(view, 'r1'), anchor);
  } finally { await database.exec('rollback'); }
}

async function proveHoldRebuildIsolated() {
  const view = 'ph_hold_stop_itemcode_snapshots_snapshot_v3039';
  const anchor = await readObservation(view, 'h1');
  const duplicate = await readObservation(view, 'h2');
  await database.exec('begin');
  try {
    await database.exec('truncate public.ph_hold_stop_itemcode_snapshots');
    await database.query(`insert into public.ph_hold_stop_itemcode_snapshots
      select (jsonb_populate_record(null::public.ph_hold_stop_itemcode_snapshots,$1)).*`,
    [{ ...anchor, holdstopreason: 'Rebuilt with different state' }]);
    assert.deepEqual(await readObservation(view, 'h2'), duplicate);
    assert.deepEqual(await readObservation(view, 'h1'), anchor);
    await database.query(`insert into public.ph_hold_stop_itemcode_snapshots
      select (jsonb_populate_record(null::public.ph_hold_stop_itemcode_snapshots,$1)).*`,
    [{ ...duplicate, updated_at: '2099-01-01T00:00:00Z' }]);
    assert.equal(await readObservation('ph_hold_stop_itemcode_snapshots', 'h2'), undefined);
  } finally { await database.exec('rollback'); }
}

async function insertCompletedFile(sequence, { empty = false, incomplete = false, header = '', status = 'processed' } = {}) {
  const fileId = `f${sequence}`, date = `2026-11-${sequence}`;
  if (!empty && !incomplete) {
    await database.query(`insert into public.ph_drive_around_report_rows(unique_id,itemcode,locationcode,
      lotcode,season,saleyear,file_id,file_name,report_date,row_number,ptravailable,holdstopreason,extra_header)
      values($1,'FUTURE','A.01.001','27.F1','F1','2027',$2,$2,$3::date,1,20,'Grow',$4)`,
    [`future-r${sequence}`, fileId, date, header]);
    await database.query(`insert into public.ph_hold_stop_itemcode_snapshots(unique_id,itemcode,file_id,file_name,
      file_date,canonical_sequence,file_rank,is_blocked,holdstopreason,source_row_ids,snapshot)
      values($1,'FUTURE',$2,$2,$3::date,$4,$4,true,'Grow',$5,'{"locations":["A.01.001"]}')`,
    [`future-h${sequence}`, fileId, date, sequence, [`future-r${sequence}`]]);
  }
  await database.query(`insert into public.ph_drive_around_report_files(file_id,file_name,report_date,
    canonical_sequence,status,row_count,processed_at) values($1,$1,$2::date,$3,$5,$4,clock_timestamp())`,
  [fileId, date, sequence, empty ? 0 : status === 'indexed' ? null : 1, empty ? 'empty' : status]);
}

async function proveFutureCompletedFilePipeline() {
  await database.exec("update public.ph_drive_around_report_files set status='processed',row_count=0 where file_id='f8'");
  await insertCompletedFile(10);
  await insertCompletedFile(11);
  await insertCompletedFile(12, { empty: true });
  await insertCompletedFile(13);
  await insertCompletedFile(14, { header: 'new business header' });
  await insertCompletedFile(15, { incomplete: true });
  const captured = (await database.query(`select count(*) count from private.history_snapshot_coverage_v3039
    where file_id in('f10','f11','f13','f14')`)).rows[0].count;
  assert.equal(captured, 8);
  const prior = await readObservation('ph_drive_around_report_rows_snapshot_v3039', 'future-r11');
  await database.exec("update public.ph_drive_around_report_rows set ptravailable=99 where unique_id='future-r11'");
  assert.deepEqual(await readObservation('ph_drive_around_report_rows_snapshot_v3039', 'future-r11'), prior);
  await database.exec("update public.ph_drive_around_report_rows set ptravailable=20 where unique_id='future-r11'");
  const receipts = [];
  for (let step = 0; step < 14; step++) {
    receipts.push((await database.query('select private.process_history_delta_queue_v3039() receipt')).rows[0].receipt);
  }
  assert.ok(receipts.some(receipt => receipt.status === 'waiting_for_complete_source'));
  assert.equal(receipts.filter(receipt => receipt.rows_removed === 1).length, 3);
  const retained = (await database.query(`select file_id from public.ph_drive_around_report_rows
    where itemcode='FUTURE' order by file_id`)).rows;
  assert.deepEqual(retained.map(row => row.file_id), ['f10', 'f13', 'f14']);
  const logical = (await database.query(`select file_id from public.ph_drive_around_report_rows_snapshot_v3039
    where itemcode='FUTURE' order by file_id`)).rows;
  assert.deepEqual(logical.map(row => row.file_id), ['f10', 'f11', 'f13', 'f14']);
  const held = (await database.query(`select file_id from public.ph_hold_stop_itemcode_snapshots
    where itemcode='FUTURE' order by file_id`)).rows;
  assert.deepEqual(held.map(row => row.file_id), ['f10', 'f13']);
  const queue = (await database.query("select status,count(*) count from private.history_delta_pending_files_v3039 where file_id<>'f8' group by status order by status")).rows;
  assert.deepEqual(queue, [{ status: 'complete', count: 10 }, { status: 'waiting', count: 2 }]);
}

async function proveOutOfOrderPredecessor() {
  await insertCompletedFile(16, { status: 'indexed' });
  await insertCompletedFile(17);
  await database.exec(`update private.history_delta_pending_files_v3039 set next_attempt_at=clock_timestamp()+interval '5 minutes';
    update private.history_delta_pending_files_v3039 set next_attempt_at=clock_timestamp()
    where relation_id='public.ph_drive_around_report_rows'::regclass and file_id='f17'`);
  const waiting = (await database.query('select private.process_history_delta_queue_v3039() receipt')).rows[0].receipt;
  assert.equal(waiting.status, 'waiting_for_complete_source');
  assert.equal(waiting.reason, 'predecessor_not_complete');
  assert.equal(waiting.previous_file, 'f16');
  const dry = (await database.query(`select private.snapshot_delta_report_v3039(
    'public.ph_drive_around_report_rows','FUTURE') receipt`)).rows[0].receipt;
  assert.equal(dry.physical_rows_eligible, 0);
  const unverified = (await database.query(`select private.compact_completed_snapshot_file_v3039(
    'public.ph_drive_around_report_rows','f16',500) receipt`)).rows[0].receipt;
  assert.equal(unverified.reason, 'complete_file_receipt_missing');
  assert.equal((await readObservation('ph_drive_around_report_rows', 'future-r16')).ptravailable, 20);
  await database.exec("update public.ph_drive_around_report_files set status='processed',row_count=1,processed_at=clock_timestamp() where file_id='f16'");
  const requeued = (await database.query(`select status,next_attempt_at<=clock_timestamp() due
    from private.history_delta_pending_files_v3039 where relation_id='public.ph_drive_around_report_rows'::regclass and file_id='f17'`)).rows[0];
  assert.deepEqual(requeued, { status: 'pending', due: true });
  const receipt = (await database.query(`select private.compact_completed_snapshot_file_v3039(
    'public.ph_drive_around_report_rows','f17',500) receipt`)).rows[0].receipt;
  assert.equal(receipt.rows_removed, 1);
}

async function proveReplayChangeOnly() {
  const table = 'ph_drive_around_report_rows';
  const view = 'ph_drive_around_report_rows_snapshot_v3039';
  const original = await readObservation(view, 'future-r11');
  const insert = (payload) => database.query(`insert into public.${table}
    select (jsonb_populate_record(null::public.ph_drive_around_report_rows,$1)).* returning unique_id`, [payload]);
  assert.deepEqual((await insert({ ...original, updated_at: '2099-01-01T00:00:00Z' })).rows, []);
  assert.equal(await readObservation(table, 'future-r11'), undefined);
  assert.deepEqual(await readObservation(view, 'future-r11'), original);
  await database.exec('begin');
  try {
    assert.deepEqual((await insert({ ...original, ptravailable: 42 })).rows, [{ unique_id: 'future-r11' }]);
    assert.equal((await readObservation(table, 'future-r11')).ptravailable, 42);
    assert.deepEqual(await readObservation(view, 'future-r11'), original);
  } finally { await database.exec('rollback'); }
}

async function proveHoldReceiptRequiresExactMembership() {
  await database.exec('begin');
  try {
    await insertCompletedFile(18, { incomplete: true });
    await database.exec(`insert into public.ph_drive_around_report_rows(unique_id,itemcode,file_id,report_date)
      values('raw-18','RIGHT','f18','2026-11-18');
      insert into public.ph_hold_stop_itemcode_snapshots(unique_id,itemcode,file_id,file_date)
      values('hold-18','WRONG','f18','2026-11-18')`);
    const receipt = (await database.query(`select private.compact_completed_snapshot_file_v3039(
      'public.ph_hold_stop_itemcode_snapshots','f18',500) receipt`)).rows[0].receipt;
    assert.equal(receipt.reason, 'hold_item_coverage_not_complete');
  } finally { await database.exec('rollback'); }
}

async function proveMultiBatchConvergence() {
  for (const sequence of [20, 21]) {
    const fileId = `f${sequence}`, date = `2026-11-${sequence}`;
    await database.query(`insert into public.ph_drive_around_report_rows(unique_id,itemcode,locationcode,
      lotcode,season,saleyear,file_id,file_name,report_date,row_number,ptravailable)
      select $1||'-'||n,'MANY-'||n,'A.01.001','27.F1','F1','2027',$1,$1,$2::date,n,20 from generate_series(1,501) n`, [fileId, date]);
    await database.query(`insert into public.ph_drive_around_report_files(file_id,file_name,report_date,
      canonical_sequence,status,row_count,processed_at) values($1,$1,$2::date,$3,'processed',501,clock_timestamp())`,
    [fileId, date, sequence]);
  }
  const read = async table => (await database.query(`select to_jsonb(r) payload from public.${table} r
    where file_id='f21' order by unique_id`)).rows;
  const before = await read('ph_drive_around_report_rows');
  const compact = async () => (await database.query(`select private.compact_completed_snapshot_file_v3039(
    'public.ph_drive_around_report_rows','f21',500) receipt`)).rows[0].receipt;
  const first = await compact();
  assert.equal(first.status, 'more');
  assert.equal(first.rows_removed, 500);
  const second = await compact();
  assert.equal(second.status, 'complete');
  assert.equal(second.rows_removed, 1);
  assert.equal((await compact()).rows_removed, 0);
  assert.equal((await read('ph_drive_around_report_rows')).length, 0);
  assert.deepEqual(await read('ph_drive_around_report_rows_snapshot_v3039'), before);
}

try {
  await seed();
  for (const file of ['20261109001000_agdata3039_consecutive_history_states.sql',
    '20261109003000_agdata3039_snapshot_coverage.sql',
    '20261109004000_agdata3039_snapshot_delta_plans.sql',
    '20261109005000_agdata3039_bounded_snapshot_compaction.sql']) {
    await database.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
  }
  await proveReaderGate();
  await database.exec(fs.readFileSync('supabase/migrations/20261109006000_agdata3039_snapshot_reader_compatibility.sql', 'utf8'));
  const readerBefore = await proveReaderCompatibility();
  await proveCoverage('ph_drive_around_report_rows', 'ph_drive_around_report_rows_snapshot_v3039');
  await proveCoverage('ph_hold_stop_itemcode_snapshots', 'ph_hold_stop_itemcode_snapshots_snapshot_v3039');
  assert.deepEqual((await database.query(`select
    private.historical_drive_file_page_v2367('f2',0,25) drive,
    public.ph_refresh_hold_stop_itemcode_summaries() hold`)).rows, readerBefore);
  await proveAmbiguousKeysStayWhole();
  await proveInvokerAccess();
  await database.exec(fs.readFileSync('supabase/migrations/20261109007000_agdata3039_completed_snapshot_pipeline.sql', 'utf8'));
  await proveRetainedMutationIsolated();
  await proveHoldRebuildIsolated();
  await proveFutureCompletedFilePipeline();
  await proveReplayChangeOnly();
  await proveOutOfOrderPredecessor();
  await proveHoldReceiptRequiresExactMembership();
  await proveMultiBatchConvergence();
  process.stdout.write('PASS: immutable Drive/Hold observations, exact receipt barriers, scoped readers, change-only replay and bounded physical compaction.\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ message: error.message, detail: error.detail, where: error.where }) + '\n');
  process.exitCode = 1;
} finally {
  await database.close();
}
