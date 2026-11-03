import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { masterOrdinalLineageMigrationName, migrationContractQuery, releaseDatabaseMigrations } from '../../scripts/apply-item-low-stock-migration.mjs';

export function ordinalLineageContract() {
  assert.ok(releaseDatabaseMigrations.includes(masterOrdinalLineageMigrationName));
  assert.match(migrationContractQuery(masterOrdinalLineageMigrationName), /as installed/);
  const migration = readFileSync(new URL('../../supabase/migrations/' + masterOrdinalLineageMigrationName, import.meta.url), 'utf8');
  const statement = migration.match(/loop\s+(with available as \([\s\S]*?target\.row_number=w\.row_number;)/)[1];
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`attach ':memory:' as pg_temp;
      create table pg_temp.ph_master_bulk_map_v1(row_number integer primary key, canonical_unique_id text unique, candidate_count integer);
      create table pg_temp.ph_master_ordinal_edges(row_number integer,canonical_unique_id text,prior_match integer,
        priority_match integer,evaluation_at text,incoming_on_hand integer,source_unique_id text);
      insert into pg_temp.ph_master_bulk_map_v1 values (1,'exact',1),(3661,null,0),(3662,null,0),(4,null,0),(5,null,0),(6,null,0);
      insert into pg_temp.ph_master_ordinal_edges values
        (3662,'C.12.013',0,0,null,165,'drive-split-1'),(3661,'C.12.013',0,1,null,179,'drive-split'),
        (4,'A',0,1,'2026-11-01',12,'alias-a'),(4,'B',0,1,'2026-11-02',12,'alias-a'),
        (5,'B',1,1,'2026-11-02',3,'alias-b'),(6,'exact',0,1,null,100,'new');`);
    const match = db.prepare(statement);
    for (let pass=0; pass<3; pass++) match.run();
    const result = () => db.prepare('select canonical_unique_id from pg_temp.ph_master_bulk_map_v1 order by row_number').all().map(r => r.canonical_unique_id);
    assert.deepEqual(result(), ['exact','A','B',null,'C.12.013',null]);
    db.exec('update pg_temp.ph_master_bulk_map_v1 set canonical_unique_id=null,candidate_count=0 where row_number<>1; pragma reverse_unordered_selects=on;');
    for (let pass=0; pass<3; pass++) match.run();
    assert.deepEqual(result(), ['exact','A','B',null,'C.12.013',null]);
  } finally {
    db.close();
  }
}
