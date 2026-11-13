import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const migrationPath = 'supabase/migrations/20261113190000_drive_publication_lineage_work.sql';
const fixturePath = 'tests/sql/erp-drive-upsert-candidates.sql';

function assertCompiledSourceBoundaries(sql) {
  assert.match(sql, /if private\.has_drive_work_binding_v3078\(true\) then\\n'[\s\S]*?perform private\.prepare_drive_pending_ack_v3084\(\);/);
  assert.match(sql, /if not starts_with\(p_sql,head\) then return p_sql; end if;/);
  assert.match(sql, /candidate_sql := (?:replace\()?substr\(p_sql,start_at,end_at-start_at\)/);
  assert.ok(sql.includes("with changed_rows as materialized (select s.row_number'||candidate_sql"));
  assert.match(sql, /join changed_rows changed using \(row_number\)'\s*\|\| substr\(p_sql,end_at\)/);
  assert.match(sql, /cohort_def text := pg_get_functiondef\('private\.drive_compiled_cohort_sql_v3078\(text,text,jsonb\)'::regprocedure\)/);
  assert.match(sql, /p_sql:=replace\(p_sql,predicate,format\('s\.erp_work_cohort = %s',cohort\)\);\s*return private\.filter_drive_upsert_candidates_v3084\(private\.filter_drive_update_candidates_v3084\(p_sql\)\);/);
}

function runPostgresFixture(container, sql) {
  assert.match(container, /^(?:[a-f0-9]{12,64}|supabase_db_gncdb[a-z0-9]{8,32})$/);
  const inspect = execFileSync('docker', ['inspect','--format','{{.Name}}|{{.Config.Image}}',container],
    { encoding:'utf8', timeout:5000 }).trim();
  assert.match(inspect, /^\/supabase_db_gncdb[a-z0-9]{8,32}\|public\.ecr\.aws\/supabase\/postgres:17\.[0-9.]+$/);
  const helpers = sql.match(/create function private\.filter_drive_(?:update|upsert)_candidates_v3084\(p_sql text\)[\s\S]*?\$candidates\$;/g);
  assert.equal(helpers?.length, 2, 'extract the actual migration functions');
  const definition = helpers.join('\n').replaceAll('create function private.', 'create function pg_temp.');
  const input = `begin;\ncreate temp table drive_fixture_session (id int);\n${definition}\n${read(fixturePath)}\nrollback;`;
  const result = execFileSync('docker', ['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-Atq'],
    { encoding:'utf8', input, timeout:15000 });
  assert.equal(result.trim().split('\n').at(-1), 'compiled DRIVE candidates verified');
}

export function assertDriveUpsertCandidates() {
  const sql = read(migrationPath);
  assertCompiledSourceBoundaries(sql);
  for (const [correct, broken] of [
    ["with changed_rows as materialized (select s.row_number'||candidate_sql", "with changed_rows as (select s.row_number'||candidate_sql"],
    ['if not starts_with(p_sql,head) then return p_sql;', 'if false then return p_sql;'],
    ['|| substr(p_sql,end_at);', "|| ' returning unique_id';"],
    ["cohort_def text := pg_get_functiondef('private.drive_compiled_cohort_sql_v3078", "cohort_def text := pg_get_functiondef('private.raw_cohort"],
  ]) {
    assert.ok(sql.includes(correct));
    assert.throws(() => assertCompiledSourceBoundaries(sql.replace(correct, broken)), undefined, correct);
  }
  const container = process.env.GNC_DRIVE_CANDIDATE_SQL_CONTAINER;
  if (container) runPostgresFixture(container, sql);
}
