// Local isolated PostgreSQL/WASM contract test for item low-stock targets.
// This exercises the checked-in migration and never connects to a live DB.
// npm install --prefix <cache> --no-save --package-lock=false @electric-sql/pglite@0.5.8
// node supabase/ci/eval_item_low_stock_targets_pglite.mjs --pglite-root <cache>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw new Error('Pass --pglite-root with the external pinned PGlite installation.');
const require = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const expect = (condition, message) => { if (!condition) throw new Error(message); };
// Reuse the inventory schema loaded by release-database.yml. A separate local
// table definition previously hid a missing CI column used by Eval Reports #2.
const inventoryBaseline = read('supabase/ci/request_workflow_baseline.sql')
  .match(/create table if not exists public\.ph_master_inventory\s*\([\s\S]*?\n\);/)?.[0];
const inventoryExtensions = read('supabase/ci/request_eval_drive_reliability_baseline.sql')
  .match(/alter table public\.ph_master_inventory\b[\s\S]*?;/)?.[0];
expect(inventoryBaseline && inventoryExtensions, 'release database inventory baselines must be available');

async function expectSqlError(sql, message) {
  try { await db.exec(sql); }
  catch (error) {
    if (String(error.message || '').includes(message)) return;
    throw new Error(`Expected ${message}; got ${error.message}`, { cause: error });
  }
  throw new Error(`Expected SQL error ${message}`);
}

try {
  await db.waitReady;
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;
    create schema app_sync_private;
    create table app_sync_private.sources(key text primary key, modules text[] not null default '{}', dylan_only boolean not null default false);
    create table public.app_dataset_revisions(key text primary key, revision bigint not null default 0, changed_at timestamptz not null default now());
    create function app_sync_private.touch_source() returns trigger language plpgsql security definer set search_path='' as $$
    declare source_key text := case when tg_table_schema='public' then tg_table_name else tg_table_schema||'.'||tg_table_name end;
    begin
      insert into public.app_dataset_revisions(key) values(source_key)
      on conflict(key) do update set revision=public.app_dataset_revisions.revision+1, changed_at=now();
      return null;
    end $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table public.profiles(
      id uuid primary key, username text unique, role text, disabled_at timestamptz,
      locked_until timestamptz, must_change_password boolean default false
    );
    create function private.current_active_profile() returns public.profiles
    language sql stable security definer set search_path=''
    as $$ select p from public.profiles p where p.id=auth.uid() and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now()) $$;
    create function private.resolve_app_access_policy_id_v1(boolean default false) returns bigint
    language sql stable security definer set search_path='' as $$ select 1::bigint $$;
    create function private.get_effective_app_permissions_v1(uuid,bigint)
    returns table(permission_key text,permission_kind text,module_key text,label text,description text,
      scope_options text[],sort_order integer,allowed boolean,access_scope text,decision_source text)
    language sql stable security definer set search_path=''
    as $$
      select p.permission_key,'action'::text,'managers'::text,'test'::text,'test'::text,
        '{}'::text[],1,true,null::text,'fixture'::text
      from public.profiles actor
      cross join (values ('manager.assigned_items_export.view'),('manager.eval_reports_2.view')) p(permission_key)
      where actor.id=$1 and actor.username in ('dylan_collyge','megan_kelly','jd_jones')
    $$;
    create table public.ph_app_settings(key text primary key, value jsonb);
    insert into public.ph_app_settings(key,value) values ('current_season_salesyear','{"seasonCode":"F1","salesYear":"27"}'::jsonb);
    create function private.eval_work_settings_v1() returns jsonb language sql stable as $$ select coalesce((select value from public.ph_app_settings where key='current_season_salesyear'),'{}'::jsonb) $$;
    create function private.eval_work_normalized_sales_year_v1(text) returns integer language sql immutable as $$ select nullif(regexp_replace(coalesce($1,''),'[^0-9]','','g'),'')::integer $$;
    create function private.eval_work_safe_numeric_v1(text) returns numeric language sql immutable as $$ select nullif(replace(coalesce($1,''),',',''),'')::numeric $$;
    create function private.eval_report2_inventory_date_v1(text) returns date language sql immutable as $$ select null::date $$;
    create function private.eval_report2_is_excluded_row_v1(text,text) returns boolean language sql immutable as $$ select false $$;
    create table public.ph_eval_report_settings(
      singleton boolean primary key default true, low_stock_max_slts integer,
      hold_age_days integer, location_note_age_days integer
    );
    insert into public.ph_eval_report_settings(singleton,low_stock_max_slts,hold_age_days,location_note_age_days)
    values(true,150,5,10);
    insert into public.profiles(id,username,role) values
      ('91000000-0000-4000-8000-000000000001','dylan_collyge','ADMIN'),
      ('91000000-0000-4000-8000-000000000002','megan_kelly','ADMIN'),
      ('91000000-0000-4000-8000-000000000003','jd_jones','ADMIN'),
      ('91000000-0000-4000-8000-000000000004','unrelated_user','USER');
  `);

  await db.exec(inventoryBaseline + '\n' + inventoryExtensions);
  await db.exec(read('supabase/archive_migrations/20260928145055_item_low_stock_targets.sql'));
  // Reproduce the observed CI error and roll back the deliberate fixture
  // damage before running the complete positive contract checks below.
  await db.exec('begin; alter table public.ph_master_inventory drop column holdstopbegindate;');
  await expectSqlError("select private.eval_report2_item_qualifies_v1('low-stock','FIXTURE-COLUMN-CHECK')", 'column m.holdstopbegindate does not exist');
  await db.exec('rollback;');
  const holdDateColumn = await db.query("select data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='ph_master_inventory' and column_name='holdstopbegindate'");
  expect(holdDateColumn.rows[0]?.data_type === 'text' && holdDateColumn.rows[0]?.is_nullable === 'YES', 'CI inventory fixture preserves the nullable production hold-start text column');
  const activationTimeout = await db.query("select proconfig from pg_proc where oid='public.activate_eval_item_low_stock_import_v1(uuid)'::regprocedure");
  expect(activationTimeout.rows[0].proconfig.includes('statement_timeout=55s'), 'archive activation is bounded below the PostgREST 60-second cap');

  const manifest = [
    { drive_file_id: 'soc-a', source_revision: '2026-09-27T10:00:00Z|soc-history-v1' },
    { drive_file_id: 'soc-b', source_revision: '2026-09-27T12:00:00Z|soc-history-v1' },
    { drive_file_id: 'soc-c', source_revision: '2026-09-28T08:00:00Z|soc-history-v1' },
    { drive_file_id: 'reserve-file', source_revision: '2026-09-28T09:00:00Z|soc-history-v1' }
  ];
  const begin = await db.query('select public.begin_eval_item_low_stock_import_v1($1::jsonb) as result', [JSON.stringify(manifest)]);
  const run = begin.rows[0].result;
  expect(run.pending_files.length === 4 && !run.active, 'initial scan should request each file');
  await expectSqlError(`select public.activate_eval_item_low_stock_import_v1('${run.run_id}')`, 'LOW_STOCK_IMPORT_COVERAGE_INCOMPLETE');
  const rawWriteAcl = await db.query("select has_table_privilege('service_role','private.ph_eval_item_low_stock_order_rows','insert') as can_insert");
  expect(rawWriteAcl.rows[0].can_insert === false, 'service importer cannot bypass the guarded row-staging RPC');

  async function importFile(file, meta, rows) {
    const prepared = await db.query(`select public.prepare_eval_item_low_stock_file_v1(
      $1::uuid,$2::text,$3::text,$4::text,$5::date,$6::timestamptz,$7::text,$8::text,
      $9::bigint,$10::text,$11::integer,$12::integer,$13::jsonb,$14::text,$15::text,$16::timestamptz
    ) as result`, [
      run.run_id,file.drive_file_id,file.source_revision,meta.name,meta.day,meta.snapshot,
      meta.method,meta.hash,meta.bytes,meta.sheet,meta.sourceRows,rows.length,
      JSON.stringify(meta.exclusions || {}),meta.disposition || 'eligible',meta.reason || null,meta.createdAt || null
    ]);
    const fileVersionId = prepared.rows[0].result.file_version_id;
    expect(prepared.rows[0].result.status === 'staging', 'new file should begin staging');
    if (rows.length) {
      const payload = rows.map((row) => ({ ...row, source_sheet_name: meta.sheet }));
      if (file.drive_file_id === manifest[0].drive_file_id) {
        await db.query('select public.stage_eval_item_low_stock_rows_v1($1::uuid,$2::jsonb)', [fileVersionId, JSON.stringify([payload[0]])]);
        const resumed = await db.query(`select public.prepare_eval_item_low_stock_file_v1(
          $1::uuid,$2::text,$3::text,$4::text,$5::date,$6::timestamptz,$7::text,$8::text,
          $9::bigint,$10::text,$11::integer,$12::integer,$13::jsonb,$14::text,$15::text,$16::timestamptz
        ) as result`, [run.run_id,file.drive_file_id,file.source_revision,meta.name,meta.day,meta.snapshot,meta.method,meta.hash,meta.bytes,meta.sheet,meta.sourceRows,rows.length,JSON.stringify(meta.exclusions || {}),meta.disposition || 'eligible',meta.reason || null,meta.createdAt || null]);
        expect(resumed.rows[0].result.last_staged_row_number === payload[0].source_row_number, 're-preparing partial file reports last staged source row for resume');
        await expectSqlError(`select public.stage_eval_item_low_stock_rows_v1('${fileVersionId}', '[{"group_key":"G1","itemcode":"ITEM-X","quantity_ordered":1,"dock":"0.0","source_row_number":50,"source_sheet_name":"${meta.sheet}"}]'::jsonb)`, 'LOW_STOCK_IMPORT_ROWS_INVALID');
        await expectSqlError(`select public.stage_eval_item_low_stock_rows_v1('${fileVersionId}', '[{"group_key":"G1","itemcode":"ITEM-X","quantity_ordered":"Infinity","dock":"D1","source_row_number":51,"source_sheet_name":"${meta.sheet}"}]'::jsonb)`, 'LOW_STOCK_IMPORT_ROWS_INVALID');
        await expectSqlError(`select public.stage_eval_item_low_stock_rows_v1('${fileVersionId}', '[{"group_key":"G1","itemcode":"NULL","quantity_ordered":1,"dock":"D1","source_row_number":52,"source_sheet_name":"${meta.sheet}"}]'::jsonb)`, 'LOW_STOCK_IMPORT_ROWS_INVALID');
      }
      await db.query('select public.stage_eval_item_low_stock_rows_v1($1::uuid,$2::jsonb)', [fileVersionId, JSON.stringify(payload)]);
      // Replaying an identical chunk is idempotent and does not duplicate lines.
      await db.query('select public.stage_eval_item_low_stock_rows_v1($1::uuid,$2::jsonb)', [fileVersionId, JSON.stringify(payload)]);
    }
    await db.query('select public.finalize_eval_item_low_stock_file_v1($1::uuid,$2::text,$3::integer)', [fileVersionId,meta.hash,rows.length]);
  }

  await importFile(manifest[0],{
    name:'SOC-09.27-1000.xlsx',day:'2026-09-27',snapshot:'2026-09-27T00:00:00Z',createdAt:'2026-09-27T16:00:00Z',method:'filename_date',hash:'a'.repeat(64),bytes:1000,sheet:'SOC 9-27',sourceRows:3
  },[
    {group_key:'["A","TX1","customer 1","ITEM-X"]',itemcode:' item-x ',quantity_ordered:10,dock:'Dock A',source_row_number:2},
    {group_key:'["A","TX1","customer 1","ITEM-X"]',itemcode:'ITEM-X',quantity_ordered:10,dock:'Dock A',source_row_number:3},
    {group_key:'["A","TX2","customer 2","ITEM-X"]',itemcode:'ITEM-X',quantity_ordered:40,dock:'Dock A',source_row_number:4}
  ]);
  await importFile(manifest[1],{
    name:'SOC-09.27-1200.xlsx',day:'2026-09-27',snapshot:'2026-09-27T00:00:00Z',createdAt:'2026-09-27T17:00:00Z',method:'filename_date',hash:'b'.repeat(64),bytes:1100,sheet:'SOC 9-27',sourceRows:2
  },[
    {group_key:'["A","TX1","customer 1","ITEM-X"]',itemcode:'ITEM-X',quantity_ordered:100,dock:'Dock A',source_row_number:2},
    {group_key:'["A","TX1","customer 1","ITEM-X"]',itemcode:'ITEM-X',quantity_ordered:100,dock:'Dock A',source_row_number:3}
  ]);
  await importFile(manifest[2],{
    name:'SOC-09.28-0800.xlsx',day:'2026-09-28',snapshot:'2026-09-29T00:00:00Z',method:'filename_timestamp',hash:'c'.repeat(64),bytes:900,sheet:'SOC 9-28',sourceRows:1
  },[
    {group_key:'["A","TX1","customer 1","ITEM-X"]',itemcode:'ITEM-X',quantity_ordered:10,dock:'Dock A',source_row_number:2}
  ]);
  await importFile(manifest[3],{
    name:'SOC Reserves 09.28.xlsx',day:'2026-09-28',snapshot:'2026-09-29T01:00:00Z',method:'creation_time_fallback',hash:'d'.repeat(64),bytes:500,sheet:null,sourceRows:12,
    disposition:'excluded',reason:'non_soc_reserves',exclusions:{schema:'reserves'}
  },[]);

  const activated = await db.query('select public.activate_eval_item_low_stock_import_v1($1::uuid) as result', [run.run_id]);
  expect(activated.rows[0].result.status === 'active', 'fully reconciled manifest should activate');
  const transient = [...manifest, { drive_file_id: 'transient-file', source_revision: 'temporary-revision' }];
  const transientRun = await db.query('select public.begin_eval_item_low_stock_import_v1($1::jsonb) as result', [JSON.stringify(transient)]);
  expect(transientRun.rows[0].result.complete === false, 'changed folder snapshot begins a pending reconciliation');
  const restoredRun = await db.query('select public.begin_eval_item_low_stock_import_v1($1::jsonb) as result', [JSON.stringify(manifest)]);
  expect(restoredRun.rows[0].result.active === true, 'returning to the complete active manifest clears stale pending work');
  const pendingState = await db.query('select pending_run_id from private.ph_eval_item_low_stock_import_state where singleton');
  expect(pendingState.rows[0].pending_run_id === null, 'stale pending run cannot leave history status stuck');
  const historyRevision = await db.query("select revision from public.app_dataset_revisions where key='private.ph_eval_item_low_stock_import_state'");
  expect(Number(historyRevision.rows[0].revision) > 0, 'activation and manifest-state changes invalidate manager live sync');
  const clientId = '91000000-0000-4000-8000-000000000001';
  await db.query("select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role','authenticated',false)", [JSON.stringify({role:'authenticated',sub:clientId})]);
  const target = await db.query("select * from public.get_eval_item_low_stock_targets_v1(array['item-x'])");
  const row = target.rows[0];
  expect(row.itemcode_normalized === 'ITEM-X', 'itemcode must normalize');
  expect(row.qualifying_line_count === 4 && row.qualifying_day_count === 2 && row.source_file_count === 3, 'latest full daily group bags should produce four lines, two days, and three files');
  expect(Number(row.mean_quantity) === 62.5 && Number(row.p75_quantity) === 100 && row.suggested_qty === 163, 'mean, nearest-rank P75, and suggested quantity formula should match');
  expect(row.effective_qty === 163 && Number(row.override_revision) === 0, 'default effective threshold should use derived suggestion');
  expect(row.calculated_at instanceof Date, 'target exposes a distinct aggregate calculation timestamp');
  const cachedStats = await db.query("select count(*)::int as n, min(history_from_date) as from_date, max(history_through_date) as through_date from private.ph_eval_item_low_stock_target_stats where run_id=(select active_run_id from private.ph_eval_item_low_stock_import_state where singleton)");
  expect(cachedStats.rows[0].n === 1 && cachedStats.rows[0].from_date.toISOString().startsWith('2026-09-27') && cachedStats.rows[0].through_date.toISOString().startsWith('2026-09-28'), 'activation should persist the exact aggregate and report-date coverage once per item');

  await db.exec("insert into public.ph_master_inventory(unique_id,itemcode,season,saleyear,s_lts) values ('ITEM-X-F1','ITEM-X','F1','27','162'),('ITEM-X-U1','ITEM-X','U1','27','300')");
  const qualifies = await db.query("select private.eval_report2_item_qualifies_v1('low-stock','ITEM-X') as value");
  expect(qualifies.rows[0].value === true, 'Eval Report #2 should use the item target instead of global 150');
  await db.exec("insert into public.ph_master_inventory(unique_id,itemcode,season,saleyear,s_lts) values ('ITEM-X-S1-CURRENT','ITEM-X','S1','27','162'),('ITEM-F1-ONLY-F1','ITEM-F1-ONLY','F1','27','149'),('ITEM-F1-ONLY-SUPPORT','ITEM-F1-ONLY','U1','27','300'); update public.ph_app_settings set value='{\"seasonCode\":\"S1\",\"salesYear\":\"27\"}'::jsonb where key='current_season_salesyear'");
  const currentS1 = await db.query("select private.eval_report2_item_qualifies_v1('low-stock','ITEM-X') as value");
  expect(currentS1.rows[0].value === true, 'Eval Report #2 qualifies current S1 inventory against the item target');
  const oldF1Only = await db.query("select private.eval_report2_item_qualifies_v1('low-stock','ITEM-F1-ONLY') as value");
  expect(oldF1Only.rows[0].value === false, 'previous F1 inventory does not qualify as current low stock during S1');
  await db.exec("update public.ph_app_settings set value='{\"seasonCode\":\"F1\",\"salesYear\":\"27\"}'::jsonb where key='current_season_salesyear'");
  await expectSqlError("select * from public.set_eval_item_low_stock_override_v1('ITEM-X',100000001,0)", 'LOW_STOCK_OVERRIDE_INVALID');
  const saved = await db.query("select * from public.set_eval_item_low_stock_override_v1('item-x',160,0)");
  expect(saved.rows[0].effective_qty === 160 && Number(saved.rows[0].override_revision) === 1, 'manual override should persist at revision 1');
  expect(saved.rows[0].calculated_at.getTime() === row.calculated_at.getTime(), 'manual override updates do not change aggregate calculation time');
  const afterOverride = await db.query("select private.eval_report2_item_qualifies_v1('low-stock','ITEM-X') as value");
  expect(afterOverride.rows[0].value === false, 'Eval Report #2 should use manual override threshold');
  await expectSqlError("select * from public.set_eval_item_low_stock_override_v1('ITEM-X',170,0)", 'LOW_STOCK_OVERRIDE_CONFLICT');
  const reset = await db.query("select * from public.set_eval_item_low_stock_override_v1('ITEM-X',null,1)");
  expect(reset.rows[0].effective_qty === 163 && reset.rows[0].manual_override_qty === null && Number(reset.rows[0].override_revision) === 2, 'reset should restore computed suggestion and preserve revision');
  const audit = await db.query("select count(*)::int as n from private.ph_eval_item_low_stock_override_audit where itemcode_normalized='ITEM-X'");
  expect(audit.rows[0].n === 2, 'override and reset must both be audited');
  const overrideRevision = await db.query("select revision from public.app_dataset_revisions where key='private.ph_eval_item_low_stock_overrides'");
  expect(Number(overrideRevision.rows[0].revision) > 0, 'override writes invalidate manager live sync');

  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({role:'authenticated',sub:'91000000-0000-4000-8000-000000000004'})]);
  await expectSqlError("select * from public.get_eval_item_low_stock_targets_v1(array['ITEM-X'])", 'LOW_STOCK_TARGETS_FORBIDDEN');
  await expectSqlError("select * from public.set_eval_item_low_stock_override_v1('ITEM-X',170,2)", 'LOW_STOCK_OVERRIDE_FORBIDDEN');

  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({role:'service_role'})]);
  const all = await db.query('select * from public.get_eval_item_low_stock_targets_v1(null,null,1)');
  expect(all.rows.length === 1 && all.rows[0].itemcode_normalized === 'ITEM-X', 'service role can page the complete aggregate for export');
  console.log('PASS: shared CI inventory fixture, missing-column regression, SOC file manifest staging, idempotent row chunks, complete-coverage activation, daily group snapshots, suggestion formula, Eval #2 threshold parity, manual override revision/audit, and read/write ACLs.');
} catch (error) {
  console.error(error.message);
  if (error.detail) console.error(`DETAIL: ${error.detail}`);
  if (error.where) console.error(`CONTEXT: ${error.where}`);
  if (error.position) console.error(`POSITION: ${error.position}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
