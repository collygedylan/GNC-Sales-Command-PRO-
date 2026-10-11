import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readHistoricalMigrationManifest } from '../../scripts/historical-database-fixture.mjs';
import { discoverTests } from '../../scripts/test-discovery.mjs';

const workflow = () => readFileSync(new URL('../../.github/workflows/release-database.yml', import.meta.url), 'utf8');

export function assertHistoricalMigration(name) {
  assert.match(workflow(), /node scripts\/historical-database-fixture\.mjs/);
  assert.ok(readHistoricalMigrationManifest().some(entry => entry.destination === name || entry.source.endsWith(`/${name}`)), `${name} is replayed in CI`);
}

export function assertIsolatedSqlTest(name) {
  assert.match(workflow(), /supabase --workdir "\$SUPABASE_CI_ROOT" test db/);
  const files = [...discoverTests({ group: 'sql-isolated-supabase' }), ...discoverTests({ group: 'sql-isolated-acceptance' })];
  assert.ok(files.includes(`supabase/tests/${name}`), `${name} is discovered for the isolated SQL suite`);
}

export function assertPgliteTest(name) {
  assert.match(workflow(), /node scripts\/run-discovered-database-tests\.mjs pglite/);
  assert.ok(discoverTests({ group: 'pglite' }).includes(`supabase/ci/${name}`), `${name} is discovered for PGlite`);
}
