// Optional, isolated PostgreSQL WASM verification when native Postgres is absent.
// Pass an installed @electric-sql/pglite/dist/index.js path (tested with 0.3.10).
// This does not exercise Supabase Auth, transport, or concurrent connections.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const modulePath = process.argv[2];
if (!modulePath) throw new Error('Pass the installed @electric-sql/pglite dist/index.js path.');
const { PGlite } = await import(pathToFileURL(modulePath));
const db = await PGlite.create();
const migration = 'supabase/migrations/20260908231650_retain_season_sales_office_av_notes.sql';
const files = [
  'supabase/ci/season_sales_av_note_baseline.sql',
  'supabase/ci/sales_office_baseline.sql',
  'supabase/migrations/20260903171416_repair_season_sales_office_custom_av_staging.sql',
  'supabase/migrations/20260903180500_repair_season_sales_pgcrypto_search_path.sql',
  'supabase/migrations/20260903181500_repair_season_sales_winner_alias.sql',
  'supabase/migrations/20260903183000_reconcile_legacy_season_sales_mirrors.sql',
  'supabase/migrations/20260903193349_enforce_season_sales_note_users_and_drive_drill.sql',
  'supabase/migrations/20260904184630_repair_request_season_sales_office_refresh.sql',
  'supabase/migrations/20260904192758_add_season_sales_office_arrived_at.sql',
  'supabase/migrations/20260906154833_repair_season_sales_done_lifecycle.sql',
  'supabase/migrations/20260907212041_enforce_photo_evidence_projection.sql',
];
const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
try {
  for (const file of files) {
    await db.exec(read(file));
    console.log(`PASS ${file}`);
  }
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
  const results = await db.exec(read('supabase/tests/season_sales_av_note_retention_test.sql'));
  for (const result of results) for (const row of result.rows ?? []) if (row.tap) console.log(row.tap);
} catch (error) {
  console.error(error.message, error.detail || '', error.where || '');
  process.exitCode = 1;
} finally { await db.close(); }
