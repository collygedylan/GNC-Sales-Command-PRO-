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

async function seedSchema() {
  await database.exec(`create schema private; create role anon; create role authenticated; create role service_role;
    create table public.ph_orders_history(order_line_key text primary key,
      source_unique_id text,source_kind text,source_file_id text,source_file_name text,report_date text,
      itemcode text,locationcode text,lotcode text,available numeric,spec text,extra_business_header text,
      row_state_hash text,first_seen_at timestamptz,last_seen_at timestamptz,
      first_file_id text,last_file_id text,first_file_name text,last_file_name text,
      seen_count integer default 1,archived_at timestamptz,updated_at timestamptz);
    create table public.ph_reserves_history(like public.ph_orders_history);
    alter table public.ph_reserves_history rename column order_line_key to reserve_history_key;
    create table public.ph_drive_mode_history(like public.ph_orders_history);
    alter table public.ph_drive_mode_history rename column order_line_key to history_key;
    create table public.ph_requests_completed_history(id bigint,unique_id text,
      assigned_rep_id uuid,sales_rep text,customer_name text,consignee_name text,
      requested_at timestamptz,created_at timestamptz,date_completed timestamptz,
      itemcode text,photo_url text,req_photo_link text,photo_link text,photos jsonb);
    alter table public.ph_requests_completed_history enable row level security;
    create table public.ph_photo_archive_jobs(source_key text,source_url text,source_bucket text,source_path text);
    alter table public.ph_photo_archive_jobs enable row level security;
    create schema cron;
    create table cron.job(jobid bigint,jobname text,command text,active boolean);
    insert into cron.job values
      (56,'agdata_historical_state_dedup_v2366','select private.run_historical_state_dedup_v2366();',true),
      (57,'agdata_historical_state_dedup_v2366','select unrelated_command();',true),
      (58,'unrelated-job','select private.run_historical_state_dedup_v2366();',true);
    create function cron.alter_job(p_job bigint,active boolean) returns void language sql as
      $$update cron.job set active=$2 where jobid=$1$$;`);
}

async function assertUnverifiedHistoryRetained(table, key) {
  for (const [sequence, available] of [[1, 20], [2, 20], [3, 19], [4, 20]]) {
    const file = `file-${sequence}`, date = `2026-11-0${sequence}`;
    await database.query(`insert into public.${table}(${key},source_unique_id,source_kind,
      source_file_id,source_file_name,report_date,itemcode,locationcode,lotcode,available,spec,archived_at,updated_at)
      values($1,'physical-row','soc',$1,$1,$2::text,'00123','A.01.001','27.F1',$3,'24 H',
      $2::text::timestamptz,$2::text::timestamptz)`, [file, date, available]);
  }
  const rows = (await database.query(`select ${key} as id,available,seen_count,last_file_id
    from public.${table} order by first_seen_at`)).rows;
  assert.deepEqual(rows.map(row => row.id), ['file-1', 'file-2', 'file-3', 'file-4']);
  assert.deepEqual(rows.map(row => row.available), ['20', '20', '19', '20']);
  assert.ok(rows.every(row => row.seen_count === 1 && row.id === row.last_file_id));
  await database.query(`update public.${table} set available=18 where ${key}='file-1'`);
  assert.equal((await database.query(`select available from public.${table} where ${key}='file-1'`)).rows[0].available, '18');
}

async function assertArchiveCatalog() {
  const row = { sales_rep: 'Dylan', customer_name: 'Buying Account', consignee_name: 'N/A',
    requested_at: '2024-02-03T14:30:00Z', unique_id: 'REQ-77', itemcode: '00123' };
  const actual = await database.query('select public.request_archive_path_v3039($1) as path', [row]);
  assert.deepEqual(actual.rows[0].path, ['Dylan', 'Buying Account', 'Direct_or_NA', '2024-02-03_REQ-77', '00123']);
  const fullResolution = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/full-resolution-original.jpg';
  await database.query(`insert into public.ph_requests_completed_history(id,unique_id,sales_rep,
    customer_name,consignee_name,requested_at,itemcode,photo_url,photos)
    values(1,'REQ-77','Dylan','Buying Account','Receiving Store','2024-02-03','00123',$1,$2)`,
  [fullResolution, JSON.stringify([fullResolution])]);
  await database.query(`insert into public.ph_photo_archive_jobs(source_key,source_url,source_bucket,source_path)
    values(encode(sha256(convert_to('request_photos/full-resolution-original.jpg','UTF8')),'hex'),
      $1,'request_photos','full-resolution-original.jpg')`, [fullResolution]);
  const queue = (await database.query('select * from public.ph_photo_archive_queue')).rows;
  assert.equal(queue[0].source_url, fullResolution);
  assert.equal(queue[0].request_archive_paths[0][2], 'Receiving Store');
  const protectedViews = await database.query(`select relname,reloptions from pg_class
    where relname in('ph_request_archive_catalog_v3039','ph_photo_archive_queue')`);
  assert.ok(protectedViews.rows.every(row => row.reloptions.includes('security_invoker=true')));
  const grants = await database.query(`select has_table_privilege('authenticated',
    'public.ph_photo_archive_queue','select') as browser,has_table_privilege('service_role',
    'public.ph_photo_archive_queue','select') as worker`);
  assert.deepEqual(grants.rows[0], { browser: false, worker: true });
}

async function seedImportHistory() {
  await database.exec(`create schema auth;
    create function auth.role() returns text language sql stable as
      $$select current_setting('agdata.fixture_role',true)$$;
    create function private.can_manage_eval_assignments() returns boolean language sql stable as
      $$select current_setting('agdata.fixture_manager',true)='yes'$$;
    set agdata.fixture_role='service_role'; set agdata.fixture_manager='yes';`);
  for (const file of ['20261015165733_import_history_routing.sql',
    '20261109006500_agdata3039_private_import_snapshot_delta.sql']) {
    await database.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
  }
}

async function beginImport(sequence, count, columns = ['ITEM', '', 'ITEM'], dataset = 'drive') {
  const sql = `select public.begin_import_history_v1($1,$2,'v1',$2,$3::date,$3::timestamptz,
    $4,$5,repeat('a',64)) receipt`;
  return (await database.query(sql, [dataset, `file-${sequence}`, `2026-11-${String(sequence).padStart(2, '0')}`,
    count, columns])).rows[0].receipt.snapshotId;
}

async function stageImport(snapshot, values) {
  const sql = 'select public.stage_import_history_rows_v1($1,$2) receipt';
  return (await database.query(sql, [snapshot, JSON.stringify(values)])).rows[0].receipt;
}

const item = (value, row = 1) => ({ row_number: row, values: ['001', '', value] });
const publish = (id) => database.query('select public.publish_import_history_v1($1) receipt', [id]);
const physical = async (id) => (await database.query('select row_number from import_private.import_history_rows where snapshot_id=$1', [id])).rows;
const compact = async (id, apply = true) => (await database.query(`select import_private.compact_import_history_delta_v3039(
  $1,0,500,$2) receipt`, [id, apply])).rows[0].receipt;

async function readyImport(sequence, rows, columns, dataset) {
  const snapshot = await beginImport(sequence, rows.length, columns, dataset);
  if (rows.length) await stageImport(snapshot, rows);
  await publish(snapshot);
  return snapshot;
}

async function assertPrivateImportChangeOnly() {
  const first = await readyImport(1, [item('A')]);
  const same = await beginImport(2, 1);
  assert.equal((await stageImport(same, [item('A')])).acceptedRows, 1);
  assert.equal((await stageImport(same, [item('A')])).acceptedRows, 0);
  await assert.rejects(stageImport(same, [item('B')]), /IMPORT_HISTORY_ROW_RETRY_CONFLICT/);
  await publish(same);
  assert.deepEqual(await physical(same), []);
  assert.deepEqual(await physical(await readyImport(3, [item('B')])), [{ row_number: 1 }]);
  assert.deepEqual(await physical(await readyImport(4, [item('A')])), [{ row_number: 1 }]);
  await readyImport(5, []);
  assert.deepEqual(await physical(await readyImport(6, [item('A')])), [{ row_number: 1 }]);
  assert.deepEqual(await physical(await readyImport(7, [item('A')], ['ITEM', 'changed', 'ITEM'])), [{ row_number: 1 }]);
  await database.query("update import_private.import_history_rows set row_values='[\"001\",\"\",\"changed\"]' where snapshot_id=$1", [first]);
  await database.query('delete from import_private.import_history_rows where snapshot_id=$1', [first]);
  const page = (await database.query('select public.get_import_history_rows_v1($1,0,1) receipt', [same])).rows[0].receipt;
  assert.deepEqual(page.rows, [{ rowNumber: 1, values: ['001', '', 'A'] }]);
  assert.equal(page.hasMore, false);
}

async function assertPrivateImportReceiptBarriers() {
  await readyImport(8, [item('A')]);
  const partial = await beginImport(9, 2);
  await stageImport(partial, [item('A')]);
  await assert.rejects(publish(partial), /IMPORT_HISTORY_ROWS_INCOMPLETE/);
  const after = await readyImport(10, [item('A')]);
  assert.deepEqual(await physical(after), [{ row_number: 1 }]);
  assert.equal((await compact(after)).rows_removed, 0);
  assert.equal((await compact(partial)).rows_removed, 0);
  const sameOtherDataset = await readyImport(10, [item('A')], undefined, 'soc');
  assert.deepEqual(await physical(sameOtherDataset), [{ row_number: 1 }]);
  const old = await readyImport(11, [item('A')]);
  await database.query('delete from import_private.import_history_coverage_v3039 where snapshot_id=$1', [old]);
  await database.query(`insert into import_private.import_history_rows(snapshot_id,row_number,row_values)
    values($1,1,'["001","","A"]')`, [old]);
  assert.equal((await compact(old, false)).eligible, 1);
  assert.equal((await compact(old)).rows_removed, 1);
  assert.deepEqual(await physical(old), []);
  const falseReady = await beginImport(12, 2);
  await stageImport(falseReady, [item('A')]);
  await database.query(`update import_private.import_history_files set status='ready',published_at=now(),staged_rows=2
    where id=$1`, [falseReady]);
  const afterFalseReady = await readyImport(13, [item('A')]);
  assert.deepEqual(await physical(afterFalseReady), [{ row_number: 1 }]);
  assert.equal((await compact(afterFalseReady)).rows_removed, 0);
  assert.equal((await compact(falseReady)).rows_removed, 0);
  const role = await database.query(`select has_table_privilege('service_role',
    'import_private.import_history_logical_rows_v3039','select') as service_read`);
  assert.equal(role.rows[0].service_read, false);
}

async function assertPrivateImportBatchLimit() {
  const rows = Array.from({ length: 501 }, (_, index) => item('A', index + 1));
  await readyImport(14, rows);
  const current = await beginImport(15, rows.length);
  await database.query(`insert into import_private.import_history_rows(snapshot_id,row_number,row_values)
    select $1,n,'["001","","A"]' from generate_series(1,501) n`, [current]);
  await database.query('update import_private.import_history_files set staged_rows=501 where id=$1', [current]);
  await publish(current);
  const first = await compact(current);
  assert.equal(first.rows_removed, 500);
  assert.equal(first.done, false);
  assert.equal(first.next_row, 500);
  const second = (await database.query(`select import_private.compact_import_history_delta_v3039(
    $1,$2,500,true) receipt`, [current, first.next_row])).rows[0].receipt;
  assert.equal(second.rows_removed, 1);
  assert.equal(second.done, true);
  assert.deepEqual(await physical(current), []);
  const page = (await database.query('select public.get_import_history_rows_v1($1,500,20) receipt', [current])).rows[0].receipt;
  assert.deepEqual(page.rows, [{ rowNumber: 501, values: ['001', '', 'A'] }]);
}

async function seedDriveModeBarrier() {
  await database.exec(`create table public.ph_master_inventory(unique_id text primary key);
    create table public.ph_drive_around_report_files(file_id text primary key,report_date date,row_count integer,
      status text,processed_at timestamptz,raw jsonb);
    alter table public.ph_drive_mode_history add column archive_reason text;
    create function private.fast_archive_drive_v2369(p_file_meta jsonb) returns jsonb
      language plpgsql security definer set search_path='' as $$declare
      meta jsonb:=p_file_meta; row_count integer:=(meta->>'expected')::integer;
      history_count integer:=(meta->>'written')::integer;
    begin
      return jsonb_build_object('report_rows',row_count,'history_rows',history_count);
    end$$;
    insert into public.ph_master_inventory values('a'),('b');`);
  const file = '20261109007500_agdata3039_drive_projection_receipts.sql';
  await database.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
}

async function assertDriveModePublicationBarrier() {
  const receipt = async () => (await database.query(`select file_id,row_count
    from private.drive_mode_projection_receipts_v3039 order by file_id`)).rows;
  const finish = (file, count) => database.query('select private.fast_archive_drive_v2369($1) result',
    [{ file_id: file, expected: count, written: count }]);
  await database.exec(`insert into public.ph_drive_around_report_files values
    ('proof','2026-11-01',2,'processed',now(),'{"pipeline":"fast-live-erp-v2369"}');
    insert into public.ph_drive_mode_history(history_key,source_unique_id,source_kind,source_file_id,report_date,archive_reason)
    values(md5('proof|a'),'a','drive_around','proof','2026-11-01','drive_file_snapshot'),
      (md5('proof|incorrect'),'incorrect','drive_around','proof','2026-11-01','drive_file_snapshot');`);
  assert.deepEqual(await receipt(), []);
  assert.deepEqual((await finish('proof', 2)).rows[0].result, { report_rows: 2, history_rows: 2 });
  assert.deepEqual(await receipt(), []);
  await database.exec(`update public.ph_drive_mode_history set history_key=md5('proof|b'),source_unique_id='b'
    where history_key=md5('proof|incorrect')`);
  await finish('proof', 2);
  assert.deepEqual(await receipt(), [{ file_id: 'proof', row_count: 2 }]);
  await database.exec(`truncate public.ph_master_inventory;
    insert into public.ph_drive_around_report_files values
    ('empty','2026-11-02',0,'processed',now(),'{"pipeline":"fast-live-erp-v2369"}');`);
  await finish('empty', 0);
  assert.deepEqual(await receipt(), [{ file_id: 'empty', row_count: 0 }, { file_id: 'proof', row_count: 2 }]);
}

try {
  await seedSchema();
  for (const file of ['20261109001000_agdata3039_consecutive_history_states.sql',
    '20261109002000_agdata3039_request_archive_catalog.sql']) {
    await database.exec(fs.readFileSync(path.join('supabase/migrations', file), 'utf8'));
  }
  assert.deepEqual((await database.query('select jobid,active from cron.job order by jobid')).rows,
    [{ jobid: 56, active: false }, { jobid: 57, active: true }, { jobid: 58, active: true }]);
  for (const [table, key] of [['ph_orders_history', 'order_line_key'],
    ['ph_reserves_history', 'reserve_history_key'], ['ph_drive_mode_history', 'history_key']]) {
    await database.exec(`create trigger state_merge before insert or update on public.${table}
      for each row execute function private.merge_compact_history_state_v2366()`);
    await assertUnverifiedHistoryRetained(table, key);
  }
  await assertArchiveCatalog();
  await seedImportHistory();
  await assertPrivateImportChangeOnly();
  await assertPrivateImportReceiptBarriers();
  await assertPrivateImportBatchLimit();
  await seedDriveModeBarrier();
  await assertDriveModePublicationBarrier();
  process.stdout.write('PASS: compact events retained, Request paths, private snapshot delta receipts and Drive Mode publication barriers.\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ message: error.message, detail: error.detail, where: error.where }) + '\n');
  process.exitCode = 1;
} finally {
  await database.close();
}
