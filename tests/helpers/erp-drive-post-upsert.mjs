import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const migrationPath = 'supabase/migrations/20261113190000_drive_publication_lineage_work.sql';

function assertItem6Ownership(sql) {
  assert.match(sql, /if private\.has_drive_work_binding_v3078\(true\) then\\n'[\s\S]*?perform private\.reconcile_drive_item6_location_notes_v3084\(p_run_id\);\\n'\s*\|\|E'    else\\n'\|\|original_sql/);
  assert.match(sql, /s\.raw_item6_fields @> array\['locationnote'\]/);
  assert.match(sql, /create unique index on pg_temp\.drive_item6_note_delta_v3084\(canonical_unique_id\)/);
  assert.match(sql, /where i\.canonical_unique_id=n\.canonical_unique_id\s*and i\.field_values->'locationnote' is distinct from n\.raw_note;/);
}

function runItem6Fixture(container, sql) {
  assert.match(container, /^(?:[a-f0-9]{12,64}|supabase_db_gncdb[a-z0-9]{8,32})$/);
  const metadata = execFileSync('docker', ['inspect','--format','{{.Name}}|{{.Config.Image}}',container],
    {encoding:'utf8', timeout:5000}).trim();
  assert.match(metadata, /^\/supabase_db_gncdb[a-z0-9]{8,32}\|public\.ecr\.aws\/supabase\/postgres:17\.[0-9.]+$/);
  const helper = sql.match(/create or replace function private\.reconcile_drive_item6_location_notes_v3084\(p_run_id uuid\)[\s\S]*?\$notes\$;/)?.[0];
  assert.ok(helper, 'extract the installed Item6 function body');
  const definition = helper.replace('function private.', 'function pg_temp.')
    .replaceAll('app_sync_private.ph_master_inventory_item6_source_v7', 'pg_temp.item6_source_fixture');
  const fixture = read('tests/sql/erp-drive-post-upsert.sql');
  const input = `begin;\ncreate temp table item6_fixture_session (id int);\n${definition}\n${fixture}\nrollback;`;
  const result = execFileSync('docker', ['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-Atq'],
    {encoding:'utf8', input, timeout:15000});
  assert.equal(result.trim().split('\n').at(-1), 'compiled DRIVE Item6 verified');
}

export function assertDrivePostUpsert() {
  const sql = read(migrationPath);
  assertItem6Ownership(sql);
  for (const guard of ["s.raw_item6_fields @> array['locationnote']", 'unique index on pg_temp.drive_item6_note_delta_v3084',
    "and i.field_values->'locationnote' is distinct from n.raw_note;", "else\\n'||original_sql"]) {
    assert.ok(sql.includes(guard));
    assert.throws(() => assertItem6Ownership(sql.replace(guard, 'removed_fixture_guard')), undefined, guard);
  }
  const container = process.env.GNC_DRIVE_CANDIDATE_SQL_CONTAINER;
  if (container) runItem6Fixture(container, sql);
}
