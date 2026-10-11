import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { augmentPublicBaseline, filterPostBaselineTriggers, renderStandaloneCatalog, restoreBaselineFunctionBodies, sqlStatements } from '../scripts/database-catalog.mjs';
import { catalogQuery } from '../scripts/database-catalog-query.mjs';

test('schema statement splitting preserves function bodies and quoted semicolons', () => {
  const source = `-- leading; comment\nCREATE FUNCTION demo() RETURNS text LANGUAGE sql AS $body$ select 'x;y'; $body$;
/* outer; /* nested; */ end */ SELECT 'a'';b', E'c\\\';d', "semi;colon";
SELECT '\\';`;
  const statements = sqlStatements(source);
  assert.equal(statements.length, 3);
  assert.equal(statements.join(''), source);
  assert.match(statements[0], /select 'x;y'; \$body\$/);
  assert.throws(() => sqlStatements('SELECT $body$ unfinished'), /UNTERMINATED/);
});

test('catalog capture reads schema metadata without querying application records', () => {
  assert.throws(() => catalogQuery(["public'; delete from profiles"]), /Invalid/);
  const query = catalogQuery(['public']);
  assert.match(query, /pg_get_functiondef/);
  assert.doesNotMatch(query, /\b(?:insert|update|delete|alter|drop|create)\s+(?:table|schema|function|from|into)\b/i);
  assert.doesNotMatch(query, /from\s+public\./i);
});

test('private snapshot includes genuine prerequisites but no application rows or secret literals', () => {
  const catalog = JSON.parse(readFileSync(new URL('../supabase/schema/baseline-private.catalog.json', import.meta.url), 'utf8'));
  assert.ok(catalog.relations.some(row => row.schema === 'app_sync_private' && row.name === 'sources'));
  assert.ok(catalog.functions.some(fn => fn.schema === 'app_sync_private' && fn.name === 'touch_source'));
  assert.match(catalog.functions.find(fn => fn.schema === 'bunch_note_private' && fn.name === 'actor').definition, /RETURNS public\.profiles/);
  assert.ok(catalog.functions.every(fn => fn.definition && !fn.sensitiveLiteral));
  assert.ok(catalog.relations.every(row => !('rows' in row) && !('data' in row)));
  assert.ok(catalog.relations.every(row => row.schema !== 'public' && row.schema !== 'aura_private'));
});

test('baseline private catalog omits only the 11 post-baseline Bunch Note triggers', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const catalog = JSON.parse(readFileSync(new URL('../supabase/schema/baseline-private.catalog.json', import.meta.url), 'utf8'));
  const baseline = readFileSync(new URL('../supabase/migrations/20260929200000_production_baseline.sql', import.meta.url), 'utf8');
  const { catalog: filtered, removed } = filterPostBaselineTriggers(catalog, baseline, { root });
  const expected = [
    'bunch_note_private.actuals.bunch_note_actual_card_write_guard',
    'bunch_note_private.batches.bunch_note_batch_structure',
    'bunch_note_private.batches.bunch_note_batch_v5_cards',
    'bunch_note_private.batches.bunch_note_batch_work_cards',
    'bunch_note_private.jobs.bunch_note_job_card_write_guard',
    'bunch_note_private.jobs.bunch_note_job_structure',
    'bunch_note_private.jobs.bunch_note_job_v5_cards',
    'bunch_note_private.jobs.bunch_note_job_work_cards',
    'bunch_note_private.previews.bunch_note_preview_card_owner_names',
    'bunch_note_private.worker_actions.bunch_note_worker_card_write_guard',
    'bunch_note_private.worker_actions.bunch_note_worker_structure',
  ];
  assert.deepEqual(removed, expected);
  const retained = filtered.relations.flatMap(row => row.triggers || []);
  assert.ok(retained.some(trigger => /CREATE TRIGGER app_dataset_revision_inserted .*EXECUTE FUNCTION app_sync_private\.touch_source\(\)/i.test(trigger)));
  assert.ok(retained.some(trigger => /CREATE TRIGGER app_dataset_revision_updated .*EXECUTE FUNCTION app_sync_private\.touch_source\(\)/i.test(trigger)));
});

test('private catalog refuses an unrecognized captured trigger dependency', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const catalog = JSON.parse(readFileSync(new URL('../supabase/schema/baseline-private.catalog.json', import.meta.url), 'utf8'));
  const baseline = readFileSync(new URL('../supabase/migrations/20260929200000_production_baseline.sql', import.meta.url), 'utf8');
  const batches = catalog.relations.find(row => row.schema === 'bunch_note_private' && row.name === 'batches');
  batches.triggers.push('CREATE TRIGGER mystery_guard BEFORE INSERT ON bunch_note_private.batches FOR EACH ROW EXECUTE FUNCTION bunch_note_private.mystery_guard()');
  assert.throws(() => filterPostBaselineTriggers(catalog, baseline, { root }), /DATABASE_TRIGGER_PROVENANCE_UNKNOWN/);
});

test('baseline replay restores captured function bodies before active text patches', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const catalog = JSON.parse(readFileSync(new URL('../supabase/schema/baseline-private.catalog.json', import.meta.url), 'utf8'));
  const snapshotBefore = structuredClone(catalog);
  const restored = restoreBaselineFunctionBodies(catalog, { root });
  const begin = restored.functions.find(fn => fn.schema === 'app_sync_private' && fn.name === 'begin_import').definition;
  const finish = restored.functions.find(fn => fn.schema === 'app_sync_private' && fn.name === 'advance_import').definition;
  const membership = restored.functions.find(fn => fn.schema === 'private' && fn.name === 'eval_work_assert_itemcode_membership_v1').definition;
  const inquiryValidator = restored.functions.find(fn => fn.schema === 'private' && fn.name === 'validate_eval_work_inquiry_v1');
  const companionSourceNeedle = 'from unnest(coalesce(p_canonical_keys,keys)) requested(source_key);';

  assert.equal(begin.split(companionSourceNeedle).length - 1, 1);
  assert.doesNotMatch(begin, /ph_itemcode_default_owners|ph_inventory_row_assignments/);
  assert.equal(finish.split('assignment_result := public.reconcile_eval_itemcodes(p_run_id);').length - 1, 1);
  assert.doesNotMatch(finish, /assignment_result := private\.reconcile_inventory_row_assignments_v1\(p_run_id\)/);
  assert.match(membership, /matched_users := private\.eval_work_match_assignment_users_v1\(work\.itemcode, selected_filters\)/);
  assert.equal(membership.split("if matched_users is distinct from work.assigned_to_users then").length - 1, 1);
  assert.equal(inquiryValidator.identityArgs, 'p_inquiry jsonb, p_itemcode text, p_context_rows jsonb');
  assert.match(inquiryValidator.definition, /allowed_actions constant text\[\] := array\['hold','take_off_hold','stop_ship','off_stop_ship','recount','priority_change','move_up','move_down'\]/);
  assert.doesNotMatch(inquiryValidator.definition, /reclass-action-workflow-v4-split-moves-20261006|validate_eval_work_inquiry_legacy_v1/);
  const validatorMigration = readFileSync(new URL('../supabase/migrations/20261006145333_reclass_split_move_inquiries_v4.sql', import.meta.url), 'utf8');
  assert.match(validatorMigration, /alter function private\.validate_eval_work_inquiry_v1\(jsonb,text,jsonb\)\s+rename to validate_eval_work_inquiry_legacy_v1/i);
  assert.match(validatorMigration, /perform private\.validate_eval_work_inquiry_legacy_v1\(projected,p_itemcode,p_context_rows\)/i);
  assert.deepEqual(catalog, snapshotBefore, 'the captured live metadata snapshot stays immutable');

  const wrongState = structuredClone(catalog);
  const wrongBegin = wrongState.functions.find(fn => fn.schema === 'app_sync_private' && fn.name === 'begin_import');
  wrongBegin.definition = wrongBegin.definition.replace("array['ph_itemcode_default_owners','ph_inventory_row_assignments']", "array['unexpected']");
  assert.throws(() => restoreBaselineFunctionBodies(wrongState, { root }), /DATABASE_BASELINE_FUNCTION_PATCH_STATE_INVALID/);

  const wrongValidatorState = structuredClone(catalog);
  const wrongValidator = wrongValidatorState.functions.find(fn => fn.schema === 'private' && fn.name === 'validate_eval_work_inquiry_v1');
  wrongValidator.definition = wrongValidator.definition.replace('reclass-action-workflow-v4-split-moves-20261006', 'unexpected-version');
  assert.throws(() => restoreBaselineFunctionBodies(wrongValidatorState, { root }), /DATABASE_BASELINE_FUNCTION_PATCH_STATE_INVALID:private\.validate_eval_work_inquiry_v1/);

  const changedConditionState = structuredClone(catalog);
  const changedCondition = changedConditionState.functions.find(fn => fn.schema === 'private' && fn.name === 'validate_eval_work_inquiry_v1');
  changedCondition.definition = changedCondition.definition.replace('if current_row is null then', 'if current_row is not null then');
  assert.match(changedCondition.definition, /reclass-action-workflow-v4-split-moves-20261006/);
  assert.equal((changedCondition.definition.match(/private\.validate_eval_work_inquiry_legacy_v1\s*\(/g) || []).length, 2);
  assert.throws(() => restoreBaselineFunctionBodies(changedConditionState, { root }), /DATABASE_BASELINE_FUNCTION_PATCH_STATE_INVALID:private\.validate_eval_work_inquiry_v1:body/);
});

test('sandbox schema snapshot is sourced from the sandbox project and excludes application rows', () => {
  const catalog = JSON.parse(readFileSync(new URL('../supabase/schema/sandbox-project.catalog.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(catalog.capture.sourceProjectRef, 'apztnscvagayslumnalr');
  assert.deepEqual(catalog.capture.scope, ['public', 'private', 'bloomscapes_demo']);
  assert.equal(catalog.capture.contents, 'schema metadata only; no application rows');
  assert.ok(catalog.relations.some(row => row.schema === 'public' && row.name === 'sandbox_workflow_records'));
  assert.ok(catalog.functions.some(fn => fn.schema === 'public' && fn.name === 'list_codex_ops_tasks_v1'));
  assert.ok(catalog.functions.every(fn => fn.definition && !fn.sensitiveLiteral));
  assert.ok(catalog.relations.every(row => !('rows' in row) && !('data' in row)));
});

test('captured defaults are installed after the function bodies they call', () => {
  const migration = renderStandaloneCatalog({
    types: null,
    schemas: [{ name: 'public', owner: 'postgres', acl: [] }],
    extensions: [],
    relations: [{
      schema: 'public', name: 'default_probe', kind: 'r', owner: 'postgres', rls: false, forceRls: false,
      columns: [{ name: 'id', type: 'uuid', default: 'public.probe_default()', notNull: true, identity: '', generated: '' }],
      constraints: [], indexes: [], triggers: [], policies: [], acl: [],
    }],
    functions: [{
      schema: 'public', name: 'probe_default', identityArgs: '', owner: 'postgres', acl: [], sensitiveLiteral: false,
      definition: 'CREATE OR REPLACE FUNCTION public.probe_default() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$',
    }],
  });
  const functionAt = migration.indexOf('CREATE OR REPLACE FUNCTION public.probe_default');
  const defaultAt = migration.indexOf('ALTER TABLE "public"."default_probe" ALTER COLUMN "id" SET DEFAULT public.probe_default()');
  const tableEnd = migration.indexOf(');', migration.indexOf('CREATE TABLE "public"."default_probe"'));
  assert.ok(functionAt >= 0 && defaultAt > functionAt);
  assert.equal(migration.slice(migration.indexOf('CREATE TABLE "public"."default_probe"'), tableEnd).includes('DEFAULT'), false);
});

test('extension installation never creates PostgreSQL system schemas', () => {
  const migration = renderStandaloneCatalog({
    types: null,
    schemas: [],
    extensions: [
      { name: 'plpgsql', schema: 'pg_catalog' },
      { name: 'pg_cron', schema: 'pg_catalog' },
      { name: 'pg_stat_statements', schema: 'extensions' },
    ],
    relations: [],
    functions: [],
  });

  assert.doesNotMatch(migration, /CREATE SCHEMA IF NOT EXISTS "pg_catalog"/);
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog"/);
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS "extensions"/);
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions"/);
});

test('sequence rendering preserves bigint text and rejects rounded numeric metadata', () => {
  const makeCatalog = max => ({
    types: null, schemas: [], extensions: [], functions: [],
    relations: [{
      schema: 'private', name: 'sequence_probe', kind: 'S', owner: 'postgres', acl: [],
      sequence: { type: 'bigint', increment: '1', min: '1', max, start: '1', cache: '1', cycle: false, identity: false, ownedBy: null },
    }],
  });
  assert.match(renderStandaloneCatalog(makeCatalog('9223372036854775807')), /MAXVALUE 9223372036854775807/);
  assert.throws(() => renderStandaloneCatalog(makeCatalog(9223372036854776000)), /DATABASE_SEQUENCE_INTEGER_INVALID/);
});

test('catalog query serializes sequence integers as exact text', () => {
  const query = catalogQuery(['private']);
  for (const field of ['seqstart', 'seqincrement', 'seqmin', 'seqmax', 'seqcache']) {
    assert.match(query, new RegExp(`${field}::text`));
  }
});

test('function metadata is deparsed after an empty transaction-local search path is set', () => {
  const query = catalogQuery(['private']);
  assert.match(query, /function_path as materialized \(select set_config\('search_path','',true\)/);
  assert.match(query, /from function_path fp cross join lateral/);
  assert.match(query, /pg_get_functiondef\(p\.oid\)/);
  assert.match(query, /pg_get_function_identity_arguments\(p\.oid\)/);
});

test('public baseline augmentation does not create captured system schemas', () => {
  const publicTypes = [
    'profiles', 'ph_master_inventory', 'ph_eval_work', 'ph_request_delivery_outbox',
    'ph_season_sales_office_state', 'ph_sales_credit_requests', 'ph_credit_sources',
  ];
  const source = publicTypes.map(name => `CREATE TABLE public.${name} (id integer);`).join('\n');
  const { baseline } = augmentPublicBaseline(source);
  assert.doesNotMatch(baseline, /CREATE SCHEMA IF NOT EXISTS "pg_catalog"/);
  assert.match(baseline, /CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog"/);
  assert.match(baseline, /assignment_result := public\.reconcile_eval_itemcodes\(p_run_id\)/);
  assert.doesNotMatch(baseline, /assignment_result := private\.reconcile_inventory_row_assignments_v1\(p_run_id\)/);
  assert.match(baseline, /matched_users := private\.eval_work_match_assignment_users_v1\(work\.itemcode, selected_filters\)/);
});
