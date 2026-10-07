// @test-group: aura
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { migrationBody, migrationContractQuery, auraLlmFreeTierMigrationName, releaseDatabaseMigrations } from '../scripts/apply-item-low-stock-migration.mjs';
import { discoverTests } from '../scripts/test-discovery.mjs';
import { readHistoricalMigrationManifest } from '../scripts/historical-database-fixture.mjs';
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('AURA quota migration is atomic, private, and checked before release', () => {
  const sql = migrationBody(read(`supabase/migrations/${auraLlmFreeTierMigrationName}`));
  assert.ok(releaseDatabaseMigrations.includes(auraLlmFreeTierMigrationName));
  assert.match(sql, /pg_advisory_xact_lock\(110011011\)/);
  assert.match(sql, /primary key \(request_id, round\)/);
  assert.match(sql, /alter table aura_private\.llm_provider_calls enable row level security/);
  assert.match(sql, /revoke all on schema aura_private from public, anon, authenticated/);
  assert.match(sql, /America\/Los_Angeles/);
  assert.match(sql, /p_rpm not between 1 and 15/);
  assert.doesNotMatch(sql, /security definer|grant .+ to (?:anon|authenticated)/i);
  const contract = migrationContractQuery(auraLlmFreeTierMigrationName);
  assert.match(contract, /relrowsecurity/);
  assert.match(contract, /not has_schema_privilege\('authenticated'/);
  assert.match(contract, /aura_llm_reserve_call_v1/);
  assert.match(contract, /statement_timeout=4s/);
});

test('AURA router deploy follows migration and remains a prerequisite of Pages', () => {
  const workflow = yaml.safeLoad(read('.github/workflows/apps-script-sync.yml'));
  const steps = workflow.jobs['sync-codegs'].steps;
  const schema = steps.findIndex(step => step.name?.includes('Apply backend release migrations'));
  const router = steps.findIndex(step => step.run?.includes('supabase functions deploy aura-llm-router'));
  assert.ok(schema >= 0 && router > schema);
  assert.ok(workflow.jobs['publish-pages'].needs.includes('sync-codegs'));
  assert.match(steps[router].run, /deploy aura-llm-router --use-api --project-ref/);
  assert.doesNotMatch(steps[router].run, /GEMINI_API_KEY\s*=/);
  assert.match(read('supabase/config.toml'), /\[functions\.aura-llm-router\][\s\S]*?verify_jwt = false/);
});

test('database CI checks quota contention and permissions in an isolated database', () => {
  const workflow = read('.github/workflows/release-database.yml');
  const historicalSources = new Set(readHistoricalMigrationManifest().map(entry => entry.source));
  assert.ok(historicalSources.has(`supabase/migrations/${auraLlmFreeTierMigrationName}`), 'historical fixture replays the quota migration');
  assert.ok(discoverTests({ group: 'sql-isolated-supabase' }).includes('supabase/tests/aura_llm_011_test.sql'), 'quota assertions are runtime-discovered');
  assert.match(workflow, /node scripts\/historical-database-fixture\.mjs/);
  assert.match(workflow, /node scripts\/sql-lint-temp-context\.mjs --historical-reset/);
  assert.doesNotMatch(workflow, /cp supabase\/.*aura_llm_011/);
  assert.ok(discoverTests({ group: 'postgres-concurrency' }).includes('scripts/test-aura-llm-quota-concurrency.mjs'), 'quota contention check is runtime-discovered');
  assert.match(workflow, /node scripts\/run-discovered-database-tests\.mjs postgres-concurrency "\$DB_URL"/);
  assert.ok(discoverTests({ group: 'deno-entrypoints' }).includes('supabase/functions/aura-llm-router/index.ts'), 'router is in discovered Edge entrypoints');
  assert.match(workflow, /node scripts\/test-discovery\.mjs deno-entrypoints/);
  const concurrency = read('scripts/test-aura-llm-quota-concurrency.mjs');
  assert.match(concurrency, /LOCAL_DATABASE_ONLY/);
  assert.match(concurrency, /results\.filter\(r=>r\.allowed\)\.length,15/);
});

test('router deduplication does not put utterances or customer sidecars in diagnostic keys', () => {
  const source = read('index.html');
  const adapter = source.slice(source.indexOf('        async function requestAuraLlm('), source.indexOf('        async function resolveAuraOrderParty('));
  assert.match(adapter, /payload\.turnId \|\| options\.requestId/);
  assert.doesNotMatch(adapter, /JSON\.stringify\(payload\)/);
  assert.match(adapter, /maxAttempts: 1/);
});
