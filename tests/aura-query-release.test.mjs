import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { checkAuraAuthorization } from '../scripts/aura-query-production-smoke.mjs';
import { auraInternalQueryMigrationName, auraCommonNamePriorityMigrationName, releaseDatabaseMigrations, migrationContractQuery } from '../scripts/apply-item-low-stock-migration.mjs';
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('internal Aura deploys after its migration and before Pages, including the compatibility endpoint', () => {
  const workflow = yaml.safeLoad(read('.github/workflows/apps-script-sync.yml'));
  const steps = workflow.jobs['sync-codegs'].steps;
  const migration = steps.findIndex(step => step.run?.includes('apply-item-low-stock-migration'));
  const engine = steps.findIndex(step => step.run?.includes('functions deploy aura-query'));
  assert.ok(migration >= 0 && engine > migration);
  assert.ok(steps[engine].run.includes('functions deploy aura-llm-router'));
  assert.ok(workflow.jobs['publish-pages'].needs.includes('sync-codegs'));
  assert.equal(releaseDatabaseMigrations.at(-2), auraInternalQueryMigrationName);
  assert.equal(releaseDatabaseMigrations.at(-1), auraCommonNamePriorityMigrationName);
  assert.match(migrationContractQuery(auraCommonNamePriorityMigrationName), /idx_ph_master_inventory_aura_name_trgm/);
  assert.match(migrationContractQuery(auraInternalQueryMigrationName), /aura_query_conversation_v1/);
  assert.match(read('supabase/config.toml'), /\[functions\.aura-query\][\s\S]*?verify_jwt = false/);
  assert.match(read('.github/workflows/release-database.yml'), /cp supabase\/tests\/aura_internal_query_test.sql/);
  assert.match(read('.github/workflows/release-database.yml'), /node supabase\/ci\/aura_internal_query_pglite.mjs/);
  assert.match(read('.github/workflows/release-database.yml'), /cp supabase\/migrations\/20261007123459_aura_inventory_common_name_priority.sql/);
  assert.match(read('.github/workflows/release-database.yml'), /cp supabase\/tests\/aura_inventory_common_name_test.sql/);
});

test('query UI is packaged, versioned through the widget import and excluded from shared SW caching', () => {
  assert.match(read('components/common/auraVoiceWidget.js'), /from "\.\/auraQueryPanel\.js"/);
  assert.match(read('scripts/prepare-release-site.mjs'), /'auraQueryPanel\.js'/);
  assert.match(read('sw.js'), /auraVoiceWidget\|auraQueryPanel/);
  assert.match(read('index.html'), /requestAssistant: requestAuraQuery/);
  assert.match(read('index.html'), /functions\/v1\/aura-query/);
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
