// Optional local SQL verification when Docker/PostgreSQL is unavailable.
// This is an in-memory PostgreSQL WASM test, not a native Auth/Realtime test.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const modulePath = process.argv[2];
if (!modulePath) throw new Error('Pass the installed @electric-sql/pglite dist/index.js path.');
const { PGlite } = await import(pathToFileURL(modulePath));
const db = await PGlite.create();
try {
  await db.exec("select set_config('app.sync_test','isolated',false)");
  for (const file of ['supabase/ci/live_dataset_revision_baseline.sql',
    'supabase/migrations/20260908185903_live_dataset_revisions.sql',
    'supabase/tests/live_dataset_revisions_test.sql']) {
    try {
      await db.exec(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
      console.log(`PASS ${file}`);
    } catch (error) {
      console.error(file, error.message, error.detail || '', error.where || '');
      process.exitCode = 1;
      break;
    }
  }
} finally { await db.close(); }
