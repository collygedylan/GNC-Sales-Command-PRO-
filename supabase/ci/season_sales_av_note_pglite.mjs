// Optional, isolated PostgreSQL WASM verification when native Postgres is absent.
// Pass the installed PGlite dependency root with --pglite-root.
// This does not exercise Supabase Auth, transport, or concurrent connections.
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
  for (const test of discoverTests({ group: 'sql-secondary-harness', harness: 'season-av' })) {
    const results = await db.exec(read(test));
    console.log(`PASS ${test}`);
    for (const result of results) for (const row of result.rows ?? []) if (row.tap) console.log(row.tap);
  }
} catch (error) {
  console.error(error.message, error.detail || '', error.where || '');
  process.exitCode = 1;
} finally { await db.close(); }
