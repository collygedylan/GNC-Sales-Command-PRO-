// @test-group: backend
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { masterSnapshotAliasDedupMigrationName, masterSnapshotIdentityDedupMigrationName, migrationContractQuery, releaseDatabaseMigrations } from '../scripts/apply-item-low-stock-migration.mjs';

const migration = readFileSync(new URL('../supabase/migrations/20261022203000_master_snapshot_alias_dedup_v1.sql', import.meta.url), 'utf8');
const identityMigration = readFileSync(new URL('../supabase/migrations/20261022214500_master_snapshot_identity_dedup_v1.sql', import.meta.url), 'utf8');

test('snapshot finalization selects one source row per canonical alias and field mask', () => {
  assert.match(migration, /finalize_master_snapshot_stage_v1/);
  assert.match(migration, /coalesce\(duplicate_mapped\.canonical_unique_id, duplicate_s\.unique_id\)/);
  assert.match(migration, /duplicate_s\.raw_item6_fields = s\.raw_item6_fields/);
  assert.match(migration, /duplicate_s\.unique_id < s\.unique_id/);
  assert.ok(releaseDatabaseMigrations.includes(masterSnapshotAliasDedupMigrationName));
  assert.match(migrationContractQuery(masterSnapshotAliasDedupMigrationName), /duplicate_mapped\.canonical_unique_id/);
});

test('snapshot finalization deduplicates unresolved rows by source identities', () => {
  assert.match(identityMigration, /duplicate_s\.lineage_key = s\.lineage_key/);
  assert.match(identityMigration, /duplicate_s\.stable_identity_key = s\.stable_identity_key/);
  assert.match(identityMigration, /duplicate_s\.unique_id < s\.unique_id/);
  assert.ok(releaseDatabaseMigrations.includes(masterSnapshotIdentityDedupMigrationName));
  assert.match(migrationContractQuery(masterSnapshotIdentityDedupMigrationName), /stable_identity_key/);
});
