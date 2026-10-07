import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { checkAuraAuthorization } from '../scripts/aura-query-production-smoke.mjs';
import { auraInternalQueryMigrationName, auraCommonNamePriorityMigrationName, auraDynamicSeasonScopeMigrationName, auraInventoryExplicitProjectionMigrationName, releaseDatabaseMigrations, migrationContractQuery } from '../scripts/apply-item-low-stock-migration.mjs';
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('internal Aura deploys after its migration and before Pages, including the compatibility endpoint', () => {
  const workflow = yaml.safeLoad(read('.github/workflows/apps-script-sync.yml'));
  const steps = workflow.jobs['sync-codegs'].steps;
  const migration = steps.findIndex(step => step.run?.includes('apply-item-low-stock-migration'));
  const engine = steps.findIndex(step => step.run?.includes('functions deploy aura-query'));
  assert.ok(migration >= 0 && engine > migration);
  assert.ok(steps[engine].run.includes('functions deploy aura-llm-router'));
  assert.ok(workflow.jobs['publish-pages'].needs.includes('sync-codegs'));
  assert.equal(releaseDatabaseMigrations.at(-4), auraInternalQueryMigrationName);
  assert.equal(releaseDatabaseMigrations.at(-3), auraCommonNamePriorityMigrationName);
  assert.equal(releaseDatabaseMigrations.at(-2), auraDynamicSeasonScopeMigrationName);
  assert.equal(releaseDatabaseMigrations.at(-1), auraInventoryExplicitProjectionMigrationName);
  assert.match(migrationContractQuery(auraCommonNamePriorityMigrationName), /idx_ph_master_inventory_aura_name_trgm/);
  assert.match(migrationContractQuery(auraInternalQueryMigrationName), /aura_query_conversation_v1/);
  assert.match(migrationContractQuery(auraDynamicSeasonScopeMigrationName), /aura_resolve_season_v1/);
  assert.match(migrationContractQuery(auraDynamicSeasonScopeMigrationName), /settingRevision/);
  assert.match(migrationContractQuery(auraInventoryExplicitProjectionMigrationName), /m\.unique_id,m\.itemcode,m\.commonname/);
  assert.match(migrationContractQuery(auraInventoryExplicitProjectionMigrationName), /position\('m\.\*' in prosrc\)=0/);
  assert.match(read('supabase/config.toml'), /\[functions\.aura-query\][\s\S]*?verify_jwt = false/);
  assert.match(read('.github/workflows/release-database.yml'), /cp supabase\/tests\/aura_internal_query_test.sql/);
  assert.match(read('.github/workflows/release-database.yml'), /node supabase\/ci\/aura_internal_query_pglite.mjs/);
  assert.match(read('.github/workflows/release-database.yml'), /cp supabase\/migrations\/20261007123459_aura_inventory_common_name_priority.sql/);
  assert.match(read('.github/workflows/release-database.yml'), /cp supabase\/tests\/aura_inventory_common_name_test.sql/);
  assert.match(read('.github/workflows/release-database.yml'), /cp supabase\/migrations\/20261007145433_aura_dynamic_season_scope.sql/);
  assert.match(read('.github/workflows/release-database.yml'), /cp supabase\/migrations\/20261007153351_aura_inventory_explicit_projection.sql/);
  assert.match(read('.github/workflows/release-database.yml'), /cp supabase\/tests\/aura_dynamic_season_scope_test.sql/);
});

test('query UI is packaged, versioned through the widget import and excluded from shared SW caching', () => {
  assert.match(read('components/common/auraVoiceWidget.js'), /from "\.\/auraQueryPanel\.js"/);
  assert.match(read('scripts/prepare-release-site.mjs'), /'auraQueryPanel\.js'/);
  assert.match(read('sw.js'), /auraVoiceWidget\|auraQueryPanel/);
  assert.match(read('index.html'), /requestAssistant: requestAuraQuery/);
  assert.match(read('index.html'), /functions\/v1\/aura-query/);
});

test('seasonal SOC reader projection is present with production types in the composed CI fixture', () => {
  const reader = read('supabase/migrations/20261007145433_aura_dynamic_season_scope.sql');
  const socBranch = reader.match(/if capability='soc_orders' then([\s\S]*?)\), filtered as materialized/);
  assert.ok(socBranch, 'SOC branch projection remains discoverable');
  const projectedColumns = [...new Set([...socBranch[1].matchAll(/\bs\.([a-z_][a-z0-9_]*)\b/g)].map(match => match[1]))];

  const production = read('supabase/migrations/20260929200000_production_baseline.sql');
  const normalizeType = type => type.toLowerCase().replace(/\btimestamptz\b/g, 'timestamp with time zone').replace(/\s+/g, ' ').trim();
  const productionSoc = production.match(/CREATE TABLE public\.ph_soc_master \(([\s\S]*?)\n\);/);
  assert.ok(productionSoc, 'production SOC schema exists');
  const productionColumns = new Map([...productionSoc[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s+([a-z][a-z0-9_ ]*?)(?:\s+(?:DEFAULT|NOT NULL|CHECK|PRIMARY|REFERENCES|COLLATE)|,?$)/gim)]
    .map(match => [match[1], normalizeType(match[2])]));

  // hl_order_baseline creates a reduced SOC table first. The later scheduled
  // handover CREATE TABLE IF NOT EXISTS cannot add columns to that table.
  const ciBase = read('supabase/ci/hl_order_baseline.sql');
  const ciCreate = ciBase.match(/create table if not exists public\.ph_soc_master \(([\s\S]*?)\n\);/i);
  assert.ok(ciCreate, 'reduced CI SOC table exists');
  const ciColumns = new Map([...ciCreate[1].matchAll(/^\s*([a-z_][a-z0-9_]*)\s+([a-z][a-z0-9_ ]*?)(?:\s+(?:default|not null|primary|references|check)|,?$)/gim)]
    .map(match => [match[1], normalizeType(match[2])]));

  for (const fixture of ['supabase/ci/sales_credit_baseline.sql', 'supabase/ci/suspend_tag_approval_baseline.sql']) {
    const sql = read(fixture);
    const alter = sql.match(/alter table public\.ph_soc_master([\s\S]*?);/i)?.[1] || '';
    for (const match of alter.matchAll(/add column if not exists\s+([a-z_][a-z0-9_]*)\s+([a-z][a-z0-9_]*)/gi)) {
      ciColumns.set(match[1].toLowerCase(), normalizeType(match[2]));
    }
  }

  assert.ok(projectedColumns.length > 0, 'reader references physical SOC columns');
  for (const column of projectedColumns) {
    assert.ok(productionColumns.has(column), `production ph_soc_master has ${column}`);
    assert.equal(ciColumns.get(column), productionColumns.get(column), `CI ph_soc_master.${column} matches production type`);
  }
});

test('Aura query and compatibility sources contain no external AI calls or provider activation dependency', () => {
  const files = ['supabase/functions/aura-query/index.ts', 'supabase/functions/aura-llm-router/index.ts', 'supabase/functions/_shared/aura-query-handler.ts', 'supabase/functions/_shared/aura-query.ts'];
  for (const file of files) {
    assert.doesNotMatch(read(file), /generativelanguage|api\.openai|GEMINI_API_KEY|OPENAI_API_KEY|AURA_LLM_ENABLED|generateContent/);
  }
});

test('cloud production smoke requires 403 on query, history and deletion in both routes', async () => {
  const requests = [];
  const result = await checkAuraAuthorization('https://abcdefghijklmnopqrst.supabase.co', async (url, options) => {
    requests.push({ path: url.pathname, mode: JSON.parse(options.body).mode, auth: options.headers.Authorization });
    return new Response('{}', { status: 403 });
  });
  assert.equal(result.assertions, 16);
  assert.equal(requests.length, 16);
  await assert.rejects(checkAuraAuthorization('https://abcdefghijklmnopqrst.supabase.co', async () => new Response('{}')), /AUTHORIZATION_REFUSAL_REQUIRED/);
  assert.match(read('.github/workflows/apps-script-sync.yml'), /node scripts\/aura-query-production-smoke.mjs/);
  assert.match(read('playwright.config.ts'), /aura-query/);
});
