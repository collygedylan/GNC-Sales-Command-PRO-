import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261022193000_master_snapshot_source_dedup_v1.sql', import.meta.url), 'utf8');

test('master snapshot publication deduplicates converged canonical source rows', () => {
  assert.match(migration, /distinct on \(coalesce\(c\.canonical_unique_id/i);
  assert.match(migration, /order by coalesce\(c\.canonical_unique_id/i);
  assert.match(migration, /bulk_import_master_snapshot_v1\(uuid,uuid,jsonb,text\)/);
  assert.match(migration, /finalize_master_snapshot_stage_v1\(uuid,uuid,text\)/);
});
