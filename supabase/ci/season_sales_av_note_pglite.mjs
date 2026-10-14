// Optional, isolated PostgreSQL WASM verification when native Postgres is absent.
// Pass the installed PGlite dependency root with --pglite-root.
// This does not exercise Supabase Auth, transport, or concurrent connections.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { discoverTests } from '../../scripts/test-discovery.mjs';
const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw new Error('Pass --pglite-root with the installed PGlite package.');
const { PGlite } = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'))('@electric-sql/pglite');
const db = await PGlite.create();
const migration = 'supabase/archive_migrations/20260908231650_retain_season_sales_office_av_notes.sql';
const resetMigration = 'supabase/archive_migrations/20260909004018_align_season_sales_av_note_shared_resets.sql';
const files = [
  'supabase/ci/season_sales_av_note_baseline.sql',
  'supabase/ci/sales_office_baseline.sql',
  'supabase/ci/season_sales_av_note_reset_baseline.sql',
  'supabase/archive_migrations/20260903171416_repair_season_sales_office_custom_av_staging.sql',
  'supabase/archive_migrations/20260903180500_repair_season_sales_pgcrypto_search_path.sql',
  'supabase/archive_migrations/20260903181500_repair_season_sales_winner_alias.sql',
  'supabase/archive_migrations/20260903183000_reconcile_legacy_season_sales_mirrors.sql',
  'supabase/archive_migrations/20260903193349_enforce_season_sales_note_users_and_drive_drill.sql',
  'supabase/archive_migrations/20260904184630_repair_request_season_sales_office_refresh.sql',
  'supabase/archive_migrations/20260904192758_add_season_sales_office_arrived_at.sql',
  'supabase/archive_migrations/20260906154833_repair_season_sales_done_lifecycle.sql',
  'supabase/archive_migrations/20260907212041_enforce_photo_evidence_projection.sql',
];
// Keep CREATE FUNCTION bodies and later exact patch text on the same newline
// convention when this harness runs on Windows or a CRLF checkout.
const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
try {
  for (const file of files) {
    await db.exec(read(file));
    console.log(`PASS ${file}`);
  }
  // Run the exact deployed shared expiry body, without unrelated request setup.
  const expiry = read('supabase/archive_migrations/20260820114722_request_integrity_and_eval_assignments.sql')
    .match(/create or replace function private\.expire_shared_av_results\(\)[\s\S]*?\r?\n\$\$;/)?.[0];
  if (!expiry) throw new Error('Shared AV expiry function was not found in its source migration.');
  await db.exec(expiry);
  // Existing open mirrors can contain notes already different from inventory.
  // Migrate real pre-column state, including an intentional blank and Done.
  await db.exec(`
    insert into public.ph_master_inventory(unique_id,itemcode,av_note) values
      ('BACKFILL-OPEN','BACKFILL-OPEN','Imported replacement'),
      ('BACKFILL-BLANK','BACKFILL-BLANK','Imported replacement'),
      ('BACKFILL-DONE','BACKFILL-DONE','Completed note');
    insert into public.ph_season_sales_office_state(season_code,sales_year,itemcode_normalized,winner_unique_id,status) values
      ('F1',27,'BACKFILL-OPEN','BACKFILL-OPEN','open'),
      ('F1',27,'BACKFILL-BLANK','BACKFILL-BLANK','open'),
      ('F1',27,'BACKFILL-DONE','BACKFILL-DONE','done'),
      ('F1',27,'BACKFILL-ORPHAN','BACKFILL-ORPHAN','open');
    insert into public.ph_sales_office(unique_id,master_id,itemcode,av_note,so_source) values
      ('BACKFILL-OPEN','BACKFILL-OPEN','BACKFILL-OPEN','Existing staged user note','season'),
      ('BACKFILL-BLANK','BACKFILL-BLANK','BACKFILL-BLANK',null,'season'),
      ('BACKFILL-ORPHAN','BACKFILL-ORPHAN','BACKFILL-ORPHAN','Note survives missing master','season');
  `);
  await db.exec(read(migration));
  console.log(`PASS ${migration}`);
  const { rows } = await db.query(`select itemcode_normalized,retained_av_note,retained_av_note_at is not null captured
    from public.ph_season_sales_office_state order by itemcode_normalized`);
  const expected = { 'BACKFILL-OPEN': 'Existing staged user note', 'BACKFILL-BLANK': null, 'BACKFILL-DONE': 'Completed note', 'BACKFILL-ORPHAN': 'Note survives missing master' };
  if (rows.length !== 4 || rows.some(row => row.retained_av_note !== expected[row.itemcode_normalized] || !row.captured)) {
    throw new Error(`Migration backfill failed: ${JSON.stringify(rows)}`);
  }
  console.log('PASS migration backfill: existing open note, explicit blank, completed note, missing master');
  await db.exec(read(resetMigration));
  console.log(`PASS ${resetMigration}`);
  const conflictMigration = 'supabase/migrations/20260930205254_season_sales_business_conflicts_use_pt409.sql';
  await db.exec(read(conflictMigration));
  console.log(`PASS ${conflictMigration}`);
  const captureDefinition = await db.query("select pg_get_functiondef('private.capture_season_sales_av_note_v1()'::regprocedure) as definition");
  if (!/for\s+share/i.test(captureDefinition.rows[0].definition)) {
    throw new Error('Installed note capture does not lock the source master row FOR SHARE.');
  }
  console.log('PASS installed capture function locks source master FOR SHARE');
  // The shared reset fixture now exercises the deployed V7 strict-release
  // behavior. Install its exact reset functions after the legacy backfill
  // assertions, retaining the complete historic migration coverage above.
  const holdClearMigration = 'supabase/migrations/20261009202507_prompt25_editable_field_shield_and_hold_clear.sql';
  const holdClearSource = read(holdClearMigration);
  const editorStart = holdClearSource.indexOf('create or replace function private.project_reclass_editable_fields_v7(');
  if (editorStart < 0 || !/^begin;/i.test(holdClearSource.trimStart())) throw new Error('V7 reset migration boundary was not found.');
  await db.exec(`${holdClearSource.slice(0, editorStart)}\ncommit;`);
  console.log(`PASS deployed V7 Hold/Stop reset functions from ${holdClearMigration}`);
  const mirrorCleanupMigration = 'supabase/migrations/20261014144043_season_sales_skip_empty_mirror_cleanup.sql';
  const mirrorCleanupSql = read(mirrorCleanupMigration);
  if (!mirrorCleanupSql.trim()) throw new Error(`Season mirror cleanup migration is empty: ${mirrorCleanupMigration}`);
  await db.exec(mirrorCleanupSql);
  await db.exec(mirrorCleanupSql);
  const mirrorDefinition = await db.query("select pg_get_functiondef('private.season_sales_mirror_winner_v1(public.ph_master_inventory,public.ph_season_sales_office_state)'::regprocedure) as definition");
  assert.match(mirrorDefinition.rows[0].definition, /if exists\s*\(\s*select 1 from public\.ph_sales_office/i,
    'the installed mirror helper must guard obsolete-row cleanup with EXISTS');
  console.log(`PASS ${mirrorCleanupMigration}: exact helper replacement and replay idempotence`);
  for (const test of discoverTests({ group: 'sql-secondary-harness', harness: 'season-av' })) {
    const results = await db.exec(read(test));
    console.log(`PASS ${test}`);
    for (const result of results) for (const row of result.rows ?? []) if (row.tap) console.log(row.tap);
  }

  // A canonical open mirror should not issue an empty cleanup DELETE. The
  // statement-level trigger counts DELETE statements (including zero-row
  // statements), so this catches the trigger/fence overhead that row triggers
  // would miss. Genuine stale rows must still be removed.
  await db.exec(`
    create table public.test_season_mirror_delete_calls (calls integer not null default 0);
    insert into public.test_season_mirror_delete_calls default values;
    create function public.test_count_season_mirror_delete_v1() returns trigger
    language plpgsql as $$ begin
      update public.test_season_mirror_delete_calls set calls = calls + 1;
      return null;
    end $$;
    create trigger test_count_season_mirror_delete_v1
      after delete on public.ph_sales_office for each statement
      execute function public.test_count_season_mirror_delete_v1();
    insert into public.ph_master_inventory(unique_id,itemcode,season,saleyear,priority)
      values ('MIRROR-CLEANUP-WINNER','MIRROR-CLEANUP','F1','27','1');
    insert into public.ph_season_sales_office_state(
      season_code,sales_year,itemcode_normalized,winner_unique_id,status,readiness_status
    ) values ('F1',27,'MIRROR-CLEANUP','MIRROR-CLEANUP-WINNER','open','needs_photo_data');
    insert into public.ph_sales_office(unique_id,master_id,itemcode,so_source)
      values ('MIRROR-CLEANUP-WINNER','MIRROR-CLEANUP-WINNER','MIRROR-CLEANUP','season');
    update public.test_season_mirror_delete_calls set calls = 0;
  `);
  await db.exec(`select private.season_sales_mirror_winner_v1(m, s)
    from public.ph_master_inventory m
    join public.ph_season_sales_office_state s on s.winner_unique_id = m.unique_id
    where m.unique_id = 'MIRROR-CLEANUP-WINNER'`);
  assert.equal((await db.query('select calls from public.test_season_mirror_delete_calls')).rows[0].calls, 0,
    'an already-canonical mirror must skip its empty cleanup DELETE');
  await db.exec(`
    insert into public.ph_sales_office(unique_id,master_id,itemcode,so_source)
      values ('MIRROR-CLEANUP-STALE','MIRROR-CLEANUP-STALE','MIRROR-CLEANUP','season');
    update public.test_season_mirror_delete_calls set calls = 0;
  `);
  await db.exec(`select private.season_sales_mirror_winner_v1(m, s)
    from public.ph_master_inventory m
    join public.ph_season_sales_office_state s on s.winner_unique_id = m.unique_id
    where m.unique_id = 'MIRROR-CLEANUP-WINNER'`);
  assert.equal((await db.query('select calls from public.test_season_mirror_delete_calls')).rows[0].calls, 1,
    'stale-row cleanup must retain its DELETE statement');
  assert.equal((await db.query(`select count(*)::integer as count from public.ph_sales_office
    where unique_id = 'MIRROR-CLEANUP-STALE'`)).rows[0].count, 0,
  'the stale Season mirror row must still be removed');
  await db.exec(`drop trigger test_count_season_mirror_delete_v1 on public.ph_sales_office;
    drop function public.test_count_season_mirror_delete_v1();
    drop table public.test_season_mirror_delete_calls;`);
  console.log('PASS Season mirror cleanup: skips zero-row DELETE; removes stale same-itemcode Season row');

  // The production reconciliation predicates normalize nullable CAV keys with
  // COALESCE. The older expression index omits it, so lock in the pre-fix plan
  // and verify the focused migration makes both the plan and result correct.
  const cavIndexMigration = 'supabase/migrations/20261014142125_season_sales_cav_lookup_index.sql';
  await db.exec(`insert into public.ph_cav_import(unique_id,last_updated,itemcode,season,holdstopreason)
    select 'CAV-LOOKUP-DECOY-'||g,now()-interval '1 day','DECOY-'||g,'F1',''
    from generate_series(1,8000) g;
    insert into public.ph_cav_import(unique_id,last_updated,itemcode,season,holdstopreason) values
      ('CAV-LOOKUP-TARGET-OLD',now()-interval '2 days',' cav-lookup-target ',' f1 ','') ,
      ('CAV-LOOKUP-TARGET-NEW',now()-interval '1 day','CAV-LOOKUP-TARGET','F1',''),
      ('CAV-LOOKUP-TARGET-HELD',now(),'CAV-LOOKUP-TARGET','F1','H');
    analyze public.ph_cav_import;`);
  const cavLookupQuery = `select max(c.last_updated) as latest_blank
    from public.ph_cav_import c
    where upper(btrim(coalesce(c.itemcode,'')))='CAV-LOOKUP-TARGET'
      and upper(btrim(coalesce(c.season,'')))='F1'
      and btrim(coalesce(c.holdstopreason,''))=''
      and c.last_updated > '-infinity'::timestamptz`;
  const planBeforeIndex = (await db.query(`explain (costs true, format text) ${cavLookupQuery}`)).rows
    .map(row => row['QUERY PLAN']).join('\n');
  assert.match(planBeforeIndex, /Seq Scan on ph_cav_import/i,
    'the COALESCE-normalized CAV predicate must reproduce the old sequential scan plan');
  assert.doesNotMatch(planBeforeIndex, /ph_cav_import_season_sales_normalized_lookup_idx/);
  const resultBeforeIndex = (await db.query(cavLookupQuery)).rows;
  const migrationSql = read(cavIndexMigration);
  if (!migrationSql.trim()) throw new Error(`CAV lookup index migration is empty: ${cavIndexMigration}`);
  await db.exec(migrationSql);
  await db.exec(migrationSql);
  const planAfterIndex = (await db.query(`explain (costs true, format text) ${cavLookupQuery}`)).rows
    .map(row => row['QUERY PLAN']).join('\n');
  assert.match(planAfterIndex, /(?:Index Scan|Bitmap Index Scan).*ph_cav_import_season_sales_normalized_lookup_idx/is,
    `the normalized CAV index must serve the reconciliation predicate; got plan:\n${planAfterIndex}`);
  assert.deepEqual((await db.query(cavLookupQuery)).rows, resultBeforeIndex,
    'adding the lookup index must not change the CAV reconciliation result');
  assert.equal((await db.query(`select count(*)::integer as count from pg_indexes
    where schemaname='public' and indexname='ph_cav_import_season_sales_normalized_lookup_idx'`)).rows[0].count, 1,
  'replaying the migration must leave exactly one normalized CAV index');
  console.log(`PASS ${cavIndexMigration}: old scan reproduced; normalized index selected; query result unchanged; replay is idempotent`);

  // The bounded reconciliation caller needs the complete immutable worklist,
  // including stale state and mirror keys that have no current master winner.
  const worklistMigration = 'supabase/migrations/20261014145025_season_sales_reconciliation_worklist.sql';
  const worklistSql = read(worklistMigration);
  if (!worklistSql.trim()) throw new Error(`Season worklist migration is empty: ${worklistMigration}`);
  await db.exec(worklistSql);
  await db.exec(worklistSql);
  await db.exec(`
    insert into public.ph_app_settings(key,value) values
      ('current_season_salesyear', '{"seasonCode":"F1","salesYear":"27"}'::jsonb)
    on conflict (key) do update set value = excluded.value;
    insert into public.ph_master_inventory(unique_id,itemcode,season,saleyear,priority,app_tab_assignment)
      values ('WORKLIST-MASTER',' worklist-master ','F1','27','1','season');
    insert into public.ph_season_sales_office_state(
      season_code,sales_year,itemcode_normalized,winner_unique_id,status
    ) values ('F1',27,'WORKLIST-RETIRED','WORKLIST-OLD-WINNER','retired');
    insert into public.ph_sales_office(unique_id,master_id,itemcode,so_source)
      values ('WORKLIST-STALE-SALES','WORKLIST-STALE-SALES',' worklist-stale-sales ','season');
  `);
  const fullWorklist = (await db.query(
    'select public.reconcile_season_sales_office_v1(null,true,null,null) as result'
  )).rows[0].result;
  const expectedWorklist = (await db.query(`
    select coalesce(jsonb_agg(itemcode_normalized order by itemcode_normalized), '[]'::jsonb) as itemcodes
    from (
      select distinct upper(btrim(m.itemcode)) as itemcode_normalized
      from public.ph_master_inventory m
      where btrim(coalesce(m.itemcode,'')) <> ''
        and upper(btrim(coalesce(m.season,''))) = 'F1'
        and private.season_sales_year_v1(m.saleyear) <= 27
        and lower(btrim(coalesce(m.app_tab_assignment,''))) in ('season','location')
      union
      select state.itemcode_normalized
      from public.ph_season_sales_office_state state
      where state.season_code = 'F1' and state.sales_year = 27
      union
      select distinct upper(btrim(sales.itemcode))
      from public.ph_sales_office sales
      where lower(btrim(coalesce(sales.so_source,'season'))) = 'season'
        and btrim(coalesce(sales.itemcode,'')) <> ''
    ) scoped
  `)).rows[0].itemcodes;
  assert.deepEqual(fullWorklist.itemcodes, expectedWorklist,
    'the returned worklist must exactly equal the complete master/state/Season mirror scope');
  assert.ok(fullWorklist.itemcodes.includes('WORKLIST-MASTER'));
  assert.ok(fullWorklist.itemcodes.includes('WORKLIST-RETIRED'),
    'retired state-only keys remain in the cleanup scope');
  assert.ok(fullWorklist.itemcodes.includes('WORKLIST-STALE-SALES'),
    'stale Season mirror keys remain in the cleanup scope');
  assert.equal(fullWorklist.scopeCount, fullWorklist.itemcodes.length,
    'scopeCount must match the complete worklist length');
  assert.match(fullWorklist.scopeHash, /^[0-9a-f]{64}$/,
    'the reconciliation response must retain its SHA-256 scope hash');

  const emptyWorklist = (await db.query(`
    select public.reconcile_season_sales_office_v1(array['WORKLIST-NOT-FOUND'],true,null,null) as result
  `)).rows[0].result;
  assert.deepEqual(emptyWorklist.itemcodes, [], 'an empty scoped worklist must be [] rather than null');
  assert.equal(emptyWorklist.scopeCount, 0);
  assert.match(emptyWorklist.scopeHash, /^[0-9a-f]{64}$/);
  console.log(`PASS ${worklistMigration}: complete sorted worklist, stale cleanup scope, empty array, hash, and replay idempotence`);
} catch (error) {
  console.error(error.message, error.detail || '', error.where || '');
  process.exitCode = 1;
} finally { await db.close(); }
