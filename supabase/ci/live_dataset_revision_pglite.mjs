// Optional local SQL verification when Docker/PostgreSQL is unavailable.
// This is an in-memory PostgreSQL WASM test, not a native Auth/Realtime test.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { discoverTests } from '../../scripts/test-discovery.mjs';
const args = process.argv.slice(2);
const dependencyRoot = args[args.indexOf('--pglite-root') + 1];
if (!args.includes('--pglite-root') || !dependencyRoot) throw new Error('Pass --pglite-root with the installed PGlite package.');
const { PGlite } = createRequire(path.join(path.resolve(dependencyRoot), 'package.json'))('@electric-sql/pglite');
const db = await PGlite.create();
try {
  await db.exec("select set_config('app.sync_test','isolated',false)");
  const files = [
    'supabase/ci/live_dataset_revision_baseline.sql',
    'supabase/archive_migrations/20260908185903_live_dataset_revisions.sql',
    'supabase/archive_migrations/20260908201318_live_dataset_revision_empty_statements.sql',
    ...discoverTests({ group: 'live-dataset-revision-sql' }),
  ];
  for (const file of files) {
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
