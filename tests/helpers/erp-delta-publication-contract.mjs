import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { erpDeltaPublicationMigration, erpPublicationMigrationContract } from '../../src/services/erp-publication-migration-registry.mjs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url),'utf8');

function localPostgresContainer(container) {
    assert.match(container || '',/^(?:[a-f0-9]{12,64}|supabase_db_gncdb[a-z0-9]{8,32})$/);
    const metadata = execFileSync('docker',['inspect','--format','{{.Name}}|{{.Config.Image}}',container],{encoding:'utf8',timeout:5000}).trim();
    assert.match(metadata,/^\/supabase_db_gncdb[a-z0-9]{8,32}\|public\.ecr\.aws\/supabase\/postgres:17\.[0-9.]+$/);
    return container;
}

export function runErpDeltaPublicationFixture(container) {
    const migration = read('supabase/migrations/' + erpDeltaPublicationMigration);
    const fixture = read('tests/sql/erp-delta-publication-fixture.sql');
    const sql = migration.replace(/commit;\s*$/,'') + fixture + '\n' +
        erpPublicationMigrationContract(erpDeltaPublicationMigration) + ';\nrollback;';
    const result = execFileSync('docker',['exec','-i',localPostgresContainer(container),'psql','-X','-v','ON_ERROR_STOP=1',
        '-U','postgres','-Atq'],{encoding:'utf8',input:sql,timeout:15000});
    assert.equal(result.trim().split('\n').at(-1),'t','isolated exact-delta fixture and installed migration contract');
}
