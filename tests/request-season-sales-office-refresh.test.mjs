import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(resolve(
  here,
  '../supabase/migrations/20260904184630_repair_request_season_sales_office_refresh.sql'
), 'utf8');

test('scoped Season Sales Notes refresh derives a previously blank assignment', () => {
  assert.match(migration, /create or replace function private\.refresh_eligible_season_sales_itemcode_v1/i);
  assert.match(migration, /coalesce\(private\.season_sales_safe_numeric_v1\(candidate\.s_lts\), 0\) > 0/i);
  assert.match(migration, /when target\.unique_id = \(select winner\.unique_id from winner\) then 'season'/i);
  assert.match(migration, /else 'location'/i);
  assert.match(migration, /upper\(coalesce\(candidate\.holdstopcode, ''\)\) !~ '\[HS\]'/i);
  assert.match(migration, /not private\.season_sales_assignment_protected_v1\(target\.app_tab_assignment\)/i);
});

test('the existing refresh API routes through the scoped classifier', () => {
  assert.match(
    migration,
    /create or replace function public\.refresh_season_sales_office_v1[\s\S]*return private\.refresh_eligible_season_sales_itemcode_v1/i
  );
  assert.match(
    migration,
    /revoke all on function public\.refresh_season_sales_office_v1\(text, text, text, text\)[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    migration,
    /grant execute on function public\.refresh_season_sales_office_v1\(text, text, text, text\)[\s\S]*to service_role/i
  );
});

test('Request completion reconciles server-side without allowing refresh failure to undo the save', () => {
  assert.match(
    migration,
    /save_result := public\.save_request_work_v1\([\s\S]*if coalesce\(complete, false\) and existing\.master_id is not null/i
  );
  assert.match(
    migration,
    /season_result := private\.refresh_eligible_season_sales_itemcode_v1/i
  );
  assert.match(
    migration,
    /exception when others then[\s\S]*'code', 'MAINTENANCE_DEFERRED'/i
  );
  assert.match(
    migration,
    /save_result := coalesce\(save_result, '\{\}'::jsonb\)[\s\S]*'season_sales_office'/i
  );
});

test('private helper is never exposed to browser roles', () => {
  assert.match(
    migration,
    /revoke all on function private\.refresh_eligible_season_sales_itemcode_v1\(text, text, text\)[\s\S]*from public, anon, authenticated/i
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function private\.refresh_eligible_season_sales_itemcode_v1\(text, text, text\)\s+to (?:anon|authenticated)/i
  );
});
