// @test-group: aura
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('supabase/functions/_shared/aura-capabilities.ts');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { AURA_READ_CAPABILITIES, AURA_MODULE_CAPABILITIES, AURA_DOMAIN_ROUTES } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const schema = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(name => name.endsWith('.sql'))
  .map(name => read(`supabase/migrations/${name}`)).join('\n');

test('each domain reader has a fixed projection of real fields and scalar text search columns', () => {
  for (const [id, cap] of Object.entries(AURA_READ_CAPABILITIES)) {
    assert.equal(cap.id, id);
    assert.ok(cap.module in AURA_MODULE_CAPABILITIES, `${id}: registered permission module`);
    if (cap.reader && cap.reader !== 'seasonal_records') { assert.equal(cap.table, ''); continue; }
    if (cap.reader === 'seasonal_records') assert.equal(cap.seasonal, true, `${id}: season scope required`);
    const table = schema.match(new RegExp(`create table (?:if not exists )?public\\.${cap.table} \\(([\\s\\S]+?)\\n\\);`, 'i'));
    const view = schema.match(new RegExp(`create view public\\.${cap.table} [\\s\\S]+? AS([\\s\\S]+?);`, 'i'));
    assert.ok(table || view, `${id}: ${cap.table} exists in the checked-in schema`);
    const columns = [...new Set([cap.key, ...cap.fields.split(','), ...cap.searchFields, ...cap.filterFields, ...Object.keys(cap.fixedFilters || {}), ...(cap.dateField ? [cap.dateField] : [])])];
    for (const column of columns) {
      assert.match(column, /^[a-z][a-z0-9_]*$/, `${id}: fixed identifier`);
      const declared = table && table[1].match(new RegExp(`^\\s+${column} ([^\\n]+)`, 'im'));
      const altered = schema.match(new RegExp(`alter table public\\.${cap.table} add column(?: if not exists)? ${column} ([^;]+)`, 'i'));
      assert.ok(declared || altered || (view && new RegExp(`\\b${column}\\b`, 'i').test(view[1])), `${id}: ${cap.table}.${column} exists`);
      if (cap.searchFields.includes(column) && (declared || altered)) {
        assert.match((declared || altered)[1], /^(?:text|character varying)\b(?!\[)/i, `${id}: ${column} supports ilike`);
      }
    }
  }
});

test('the capability registry covers every enabled navigation module and gives review destinations', () => {
  const catalog = read('supabase/archive_migrations/20260921034506_navigation_preferences_and_live_view_grants.sql');
  const values = catalog.slice(catalog.indexOf('insert into private.navigation_view_catalog'), catalog.indexOf('create table private.navigation_access_state'));
  const modules = [...values.matchAll(/\('([^']+)',/g)].map(match => match[1]);
  assert.ok(modules.length >= 35, 'load actual navigation catalog');
  for (const module of modules) {
    const entry = AURA_MODULE_CAPABILITIES[module];
    assert.ok(entry, `${module}: coverage required`);
    assert.ok(entry.questions.length && entry.reviewView, `${module}: wording and destination`);
    for (const id of entry.capabilities) assert.ok(AURA_READ_CAPABILITIES[id], `${module}: ${id} reader`);
  }
  assert.equal(AURA_MODULE_CAPABILITIES['production:can-filling'].available, false);
  assert.equal(AURA_MODULE_CAPABILITIES['production:order-pulling'].available, false);
  for (const route of AURA_DOMAIN_ROUTES) assert.ok(AURA_READ_CAPABILITIES[route.capability]);
});
