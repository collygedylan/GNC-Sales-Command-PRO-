import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { discoverTests } from '../scripts/test-discovery.mjs';

const migration = readFileSync(new URL('../supabase/migrations/20261015213506_manager_module_revision_signals.sql', import.meta.url), 'utf8');
const tracked = [
  'ph_company_directory_contacts', 'ph_company_directory_blocks', 'ph_company_directory_beds', 'ph_company_directory_codes',
  'production_schedule_active', 'core_employees', 'hr_job_codes', 'labor_timesheets'
];

test('manager revision migration registers only opaque, RLS-filtered source metadata', () => {
  for (const source of tracked) assert.match(migration, new RegExp(`'${source}'`));
  assert.match(migration, /on conflict \(key\) do nothing/);
  assert.match(migration, /tablename = 'app_dataset_revisions'/);
  assert.match(migration, /alter publication supabase_realtime add table public\.app_dataset_revisions/);
  assert.doesNotMatch(migration, /alter publication supabase_realtime add table public\.(?:core_employees|hr_job_codes|labor_timesheets|ph_company_directory_|production_schedule_)/);
  assert.match(migration, /'ph_company_directory_contacts', '\{managers\}', true, true/);
  assert.match(migration, /'core_employees', '\{managers\}', true, true/);
  assert.match(migration, /'production_schedule_active', '\{managers\}', true, false/);
});

test('revision trigger SQL is part of the canonical database contract suite', () => {
  assert.match(readFileSync(new URL('../supabase/tests/manager_module_revision_signals_test.sql', import.meta.url), 'utf8'), /^-- @test-runtime: canonical/m);
  assert.ok(discoverTests({ group: 'sql-canonical' }).includes('supabase/tests/manager_module_revision_signals_test.sql'));
});

test('every new mutable module source advances opaque revisions on insert, update, delete, and truncate', () => {
  for (const table of tracked) {
    for (const operation of ['inserted', 'updated', 'deleted', 'truncated']) {
      assert.match(migration, new RegExp(`create trigger app_dataset_revision_${operation}[\\s\\S]*?on public\\.${table}[\\s\\S]*?execute function app_sync_private\\.touch_source\\(\\);`), `${operation} ${table}`);
    }
  }
  assert.doesNotMatch(migration, /create policy|grant .*authenticated|revoke .*authenticated/i,
    'signal support must preserve existing table access policies and grants');
});
