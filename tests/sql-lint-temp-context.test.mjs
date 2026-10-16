import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decorateDefinitions,
  extractTempStatements,
  firstBeginIndex,
  getSupportedFunctions,
  patchSql,
  probeSql,
  validateShapes,
  withSqlLintTempContext,
} from '../scripts/sql-lint-temp-context.mjs';

const fixtureFunctions = () => [
  ['apply_inventory_reclass_move_v1', 'uuid, text, bigint, text, jsonb, jsonb', 'destination_season text;\ndestination_lot text;\nactor_username text;\nis_manager boolean;\nassigned_to_actor boolean;', 'create temporary table reclass_move_targets_v1 (destination_season text primary key) on commit drop;'],
  ['apply_inventory_reclass_moves_set_v1', 'uuid, text, bigint, jsonb, uuid', '', [
    'reclass_batch_source_before_v1', 'reclass_batch_source_after_v1',
    'reclass_batch_target_before_v1', 'reclass_batch_target_after_v1',
    'reclass_batch_sources_v1', 'reclass_batch_lines_v1', 'reclass_batch_targets_v1',
    'reclass_batch_source_json_v1', 'reclass_batch_target_json_v1',
  ].map(name => `create temporary table if not exists ${name} (source_index integer) on commit drop;`).join(' ')],
  ['apply_inventory_reclass_import_overlay_v1', 'uuid, uuid', 'movement_request record;\nmovement record;\nsource_stage record;\ntarget_stage record;\nsource_rows integer;\nsource_matches boolean;\nall_pre boolean;\nall_post boolean;\ntarget_count integer;\ntarget_pre boolean;\ntarget_post boolean;\ndesired_status text;\nconflict_reason_value text;', 'perform (select count(*) from pg_temp.ph_master_bulk_stage_v1 s join pg_temp.ph_master_bulk_map_v1 m using(row_number));'],
  ['ph_refresh_hold_learning_itemcode_batch', 'text, integer', 'v_job_name text;\nv_batch_size integer;', 'create temp table tmp_hl_batch on commit drop as select v_job_name as name limit v_batch_size;'],
  ['ph_refresh_hold_learning_summary_batch', 'text, integer', 'v_job_name text;\nv_batch_size integer;', 'create temp table tmp_hl_summary on commit drop as select v_job_name as name limit v_batch_size;'],
  ['ph_refresh_hold_stop_itemcode_cycles_fast', 'date, date', 'v_start_date date;\nv_end_date date;', 'create temp table tmp_hs_files on commit drop as select v_start_date as day where v_end_date is null;'],
  ['reconcile_season_sales_office_v1', 'text[], boolean, text, text', '', 'create temporary table season_items (itemcode text primary key) on commit drop;'],
  ['v2_refresh_hold_learning_profiles', '', '', 'create temporary table profile_stage on commit drop as select 1::integer as sample_count;'],
  ['v2_refresh_hold_stop_itemcode_episode_learning', 'date, date, integer', 'safe_start date;\nsafe_end date;', 'create temp table episode_files on commit drop as select safe_start as day where safe_end is null;'],
  ['bulk_import_master_snapshot_v1', 'uuid, uuid, jsonb, text', 'v_rows jsonb;', 'create temp table ph_master_bulk_stage_v1 on commit drop as select 1::bigint as row_number, \'{}\'::jsonb as raw_values, array[]::text[] as raw_item6_fields, array[]::text[] as field_keys, null::text as lineage_key, null::text as source_hash, null::text as unique_id, null::text as itemcode, null::text as contsize, null::text as locationcode, null::text as lotcode, null::text as source, null::numeric as ptronhand, null::numeric as ptravailable where false; create temp table ph_master_bulk_map_v1 on commit drop as select row_number, null::text as canonical_unique_id, null::integer as candidate_count from pg_temp.ph_master_bulk_stage_v1;'],
].map(([name, args, declarations, ddl]) => {
  const body = (declarations ? 'DECLARE\n' + declarations + '\n' : '') + 'BEGIN\n  ' + ddl + '\nEND;';
  const schema = name === 'apply_inventory_reclass_import_overlay_v1' || name === 'apply_inventory_reclass_moves_set_v1' ? 'private' : 'public';
  return { schema, name, arguments: args, argumentNames: [], body,
    definition: 'CREATE OR REPLACE FUNCTION ' + schema + '.' + name + '() RETURNS void LANGUAGE plpgsql AS $$' + body + '$$;' };
});

function encodeJson(value) { return Buffer.from(JSON.stringify(value)).toString('base64'); }

function fixtureShapes(functions) {
  const names = new Set(functions.flatMap(item => [
    ...(item.name === 'apply_inventory_reclass_import_overlay_v1' ? [] : extractTempStatements(item.body, item.name).map(statement => statement.name)),
    ...(item.name === 'apply_inventory_reclass_import_overlay_v1' ? ['ph_master_bulk_stage_v1', 'ph_master_bulk_map_v1'] : []),
  ]));
  return [...names].map(name => ({ name, columns: [{ name: 'id', type: 'integer' }] }));
}

test('bulk master migration exposes both temporary shapes to strict lint without executing source data', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261015012249_bulk_master_snapshot_v1.sql', import.meta.url), 'utf8');
  const definition = migration.slice(migration.indexOf('create or replace function public.bulk_import_master_snapshot_v1('));
  const body = definition.split('as $function$')[1].split('$function$;')[0];
  const [supported] = getSupportedFunctions([{
    schema: 'public', name: 'bulk_import_master_snapshot_v1', arguments: 'uuid, uuid, jsonb, text',
    argumentNames: ['p_run_id', 'p_request_id', 'p_rows', 'p_source_digest'], body, definition,
  }], { allowMissing: true });
  assert.deepEqual(supported.statements.map(statement => statement.name), ['ph_master_bulk_stage_v1', 'ph_master_bulk_map_v1']);
  const probe = probeSql([supported]);
  assert.match(probe, /v_rows jsonb;/);
  assert.equal(probe.match(/WITH NO DATA;/g).length, 2);
  assert.doesNotMatch(probe, /p_rows|bulk_import_master_snapshot_v1\(/);
});

test('Reclass movement RPC temporary tables are registered with strict SQL lint context', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261015230000_inventory_reclass_moves_v1.sql', import.meta.url), 'utf8');
  const specifications = [
    ['public', 'apply_inventory_reclass_move_v1', 'uuid, text, bigint, text, jsonb, jsonb', ['reclass_move_targets_v1']],
    ['private', 'apply_inventory_reclass_moves_set_v1', 'uuid, text, bigint, jsonb, uuid', [
      'reclass_batch_source_before_v1', 'reclass_batch_source_after_v1',
      'reclass_batch_target_before_v1', 'reclass_batch_target_after_v1',
      'reclass_batch_sources_v1', 'reclass_batch_lines_v1', 'reclass_batch_targets_v1',
      'reclass_batch_source_json_v1', 'reclass_batch_target_json_v1',
    ]],
  ];
  for (const [schema, name, args, expectedTables] of specifications) {
    const start = migration.indexOf(`create or replace function ${schema}.${name}(`);
    assert.ok(start >= 0, `missing ${name}`);
    const end = migration.indexOf('$function$;', start) + '$function$;'.length;
    const definition = migration.slice(start, end);
    const body = definition.split('as $function$')[1].split('$function$;')[0];
    const [supported] = getSupportedFunctions([{ schema, name, arguments: args,
      argumentNames: [], body, definition }], { allowMissing: true });
    assert.deepEqual(supported.statements.map(statement => statement.name), expectedTables);
    for (const table of expectedTables) {
      assert.match(probeSql([supported]), new RegExp(`create temporary table if not exists ${table}`, 'i'));
    }
  }
  const publicBatchStart = migration.indexOf('create or replace function public.apply_inventory_reclass_moves_v1(');
  const publicBatchEnd = migration.indexOf('$function$;', publicBatchStart) + '$function$;'.length;
  const publicBatchBody = migration.slice(publicBatchStart, publicBatchEnd).split('as $function$')[1].split('$function$;')[0];
  assert.match(publicBatchBody, /private\.apply_inventory_reclass_moves_set_v1/);
  assert.doesNotMatch(publicBatchBody, /create\s+(?:temp|temporary)\s+table/i);
  const start = migration.indexOf('create or replace function private.apply_inventory_reclass_import_overlay_v1(');
  const end = migration.indexOf('$function$;', start) + '$function$;'.length;
  const definition = migration.slice(start, end);
  const body = definition.split('as $function$')[1].split('$function$;')[0];
  const [overlay] = getSupportedFunctions([{ schema: 'private', name: 'apply_inventory_reclass_import_overlay_v1',
    arguments: 'uuid, uuid', argumentNames: ['p_run_id', 'p_import_request_id'], body, definition }], { allowMissing: true });
  assert.deepEqual(overlay.statements, []);
  const contextual = validateShapes([overlay], ['ph_master_bulk_stage_v1', 'ph_master_bulk_map_v1']
    .map(name => ({ name, columns: [{ name: 'row_number', type: 'bigint' }] })))[0];
  assert.deepEqual(contextual.pragmas, [
    'table: ph_master_bulk_stage_v1(row_number bigint)',
    'table: ph_master_bulk_map_v1(row_number bigint)',
  ]);
});

test('temporary SQL extraction ignores comments and quoted dynamic DDL and makes CTAS planning data-free', () => {
  const body = "BEGIN\n" +
    "  -- CREATE TEMP TABLE commented_out AS SELECT 1;\n" +
    "  PERFORM 'CREATE TEMP TABLE string_value AS SELECT 2;';\n" +
    "  CREATE TEMP TABLE actual_rows ON COMMIT DROP AS SELECT 3 AS id;\n" +
    "  EXECUTE format('CREATE TEMP TABLE dynamic_rows AS SELECT %s', 4);\n" +
    'END;';
  const [statement] = extractTempStatements(body, 'public.fixture');
  assert.equal(statement.name, 'actual_rows');
  assert.match(statement.statement, /WITH NO DATA;$/);
  assert.throws(() => extractTempStatements("BEGIN EXECUTE 'CREATE TEMP TABLE dynamic_rows AS SELECT 1;'; END;", 'public.dynamic'), /STATIC_TEMP_TABLES_REQUIRED/);
});

test('temporary SQL parser respects nested comments, dollar strings, and escape strings', () => {
  const body = "DECLARE\n" +
    "  note text := E'quoted \\' CREATE TEMP TABLE hidden;';\n" +
    'BEGIN\n' +
    '  /* outer comment /* nested CREATE TEMP TABLE ignored; */ still comment */\n' +
    '  PERFORM $tag$CREATE TEMP TABLE dollar_hidden AS SELECT 1;$tag$;\n' +
    '  CREATE TEMP TABLE visible_rows (id integer);\n' +
    'END;';
  const statements = extractTempStatements(body, 'public.fixture');
  assert.deepEqual(statements.map(statement => statement.name), ['visible_rows']);
  assert.ok(firstBeginIndex(body) > body.indexOf('DECLARE'));
});

test('source inventory validates exact function signatures, local declarations, and static temp DDL', () => {
  const functions = getSupportedFunctions(fixtureFunctions());
  assert.equal(functions.length, 10);
  assert.equal(functions.flatMap(item => item.statements).length, 18);
  assert.match(probeSql(functions), /WITH NO DATA/);
  assert.match(probeSql(functions), /create temporary table season_items/i);
  assert.throws(() => getSupportedFunctions(fixtureFunctions().slice(1)), /FUNCTION_SET_CHANGED/);
  const changed = fixtureFunctions();
  const changedIndex = changed.findIndex(item => item.name === 'ph_refresh_hold_learning_itemcode_batch');
  changed[changedIndex].body = changed[changedIndex].body.replace('v_batch_size integer;', 'v_batch_size integer;\nv_unmapped_local text;')
    .replace('v_job_name as name', 'v_unmapped_local as name');
  changed[changedIndex].definition = 'CREATE FUNCTION public.' + changed[changedIndex].name + '() AS $$' + changed[changedIndex].body + '$$;';
  assert.throws(() => getSupportedFunctions(changed), /UNSUPPORTED_LOCAL_VARIABLE/);
});

test('derived shapes produce exact pragmas and decoration inserts them after the actual function BEGIN', () => {
  const functions = getSupportedFunctions(fixtureFunctions());
  const shapes = fixtureShapes(fixtureFunctions());
  const withPragmas = validateShapes(functions, shapes);
  const decorated = decorateDefinitions(withPragmas, 'extensions');
  assert.equal(decorated.length, 10);
  const learningBatch = decorated.find(item => item.signature === 'public.ph_refresh_hold_learning_itemcode_batch').decorated;
  assert.match(learningBatch, /BEGIN\s+PERFORM "extensions"\.plpgsql_check_pragma\('table: tmp_hl_batch\(id integer\)'\);/);
  assert.match(learningBatch, /limit v_batch_size/i);
  assert.match(decorated[0].original, /BEGIN\n/);
  assert.throws(() => validateShapes(functions, shapes.slice(1)), /SHAPE_COUNT_MISMATCH/);
});

test('patch batch terminates each pg_get_functiondef even when deparser omits final semicolon', () => {
  const sql = patchSql([
    { signature: 'public.first_fn', original: 'CREATE FUNCTION public.first_fn() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql', decorated: 'CREATE OR REPLACE FUNCTION public.first_fn() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql' },
    { signature: 'public.second_fn', original: 'CREATE FUNCTION public.second_fn() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;', decorated: 'CREATE OR REPLACE FUNCTION public.second_fn() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;' },
  ], 'aura_lint_test');
  assert.match(sql, /LANGUAGE plpgsql;\nCREATE OR REPLACE FUNCTION public\.second_fn/);
  assert.match(sql, /LANGUAGE plpgsql;\nCOMMIT;/);
});

test('lint helper restores original definitions after a strict lint failure', () => {
  const functions = fixtureFunctions();
  const shapes = fixtureShapes(functions);
  const calls = [];
  const executeDocker = (_command, args, options = {}) => {
    calls.push({ args, input: options.input });
    if (args.includes('-c') && args.some(value => String(value).includes('SQL_LINT_FUNCTIONS:'))) {
      return { status: 0, stdout: 'SQL_LINT_FUNCTIONS:' + encodeJson(functions) + '\n' };
    }
    if (args.includes('-c') && args.some(value => String(value).includes('SQL_LINT_EXTENSION:'))) {
      return { status: 0, stdout: 'SQL_LINT_EXTENSION:extensions\n' };
    }
    if (options.input?.includes('SQL_LINT_SHAPES:')) return { status: 0, stdout: 'SQL_LINT_SHAPES:' + encodeJson(shapes) + '\n' };
    return { status: 0, stdout: '' };
  };
  assert.throws(() => withSqlLintTempContext({
    root: process.cwd(),
    workspaceRoot: 'C:/temp/gnc-db-workspace-fixture',
    cli: 'supabase-fixture',
    inspectWorkspace: () => ({ containerId: 'a'.repeat(64) }),
    executeDocker,
    action: () => { throw new Error('strict lint failed'); },
  }), /strict lint failed/);
  const sqlInputs = calls.map(call => call.input).filter(Boolean);
  assert.ok(sqlInputs.some(input => input.includes('CREATE EXTENSION IF NOT EXISTS plpgsql_check')));
  assert.ok(sqlInputs.some(input => input.includes('CREATE SCHEMA "aura_lint_')));
  assert.ok(sqlInputs.some(input => input.includes('DROP SCHEMA "aura_lint_') && input.includes('EXECUTE saved.definition')));
  assert.equal(sqlInputs.filter(input => input.includes('WITH NO DATA')).length, 1);
});

test('lint helper surfaces restoration failures without losing the primary lint error', () => {
  const functions = fixtureFunctions();
  const shapes = fixtureShapes(functions);
  const executeDocker = (_command, args, options = {}) => {
    if (args.some(value => String(value).includes('SQL_LINT_FUNCTIONS:'))) return { status: 0, stdout: 'SQL_LINT_FUNCTIONS:' + encodeJson(functions) + '\n' };
    if (args.some(value => String(value).includes('SQL_LINT_EXTENSION:'))) return { status: 0, stdout: 'SQL_LINT_EXTENSION:extensions\n' };
    if (options.input?.includes('SQL_LINT_SHAPES:')) return { status: 0, stdout: 'SQL_LINT_SHAPES:' + encodeJson(shapes) + '\n' };
    if (options.input?.includes('EXECUTE saved.definition')) return { status: 1, stdout: '', stderr: 'restore failed' };
    return { status: 0, stdout: '' };
  };
  assert.throws(() => withSqlLintTempContext({
    root: process.cwd(), workspaceRoot: 'C:/temp/gnc-db-workspace-restore-failure', cli: 'supabase-fixture',
    inspectWorkspace: () => ({ containerId: 'b'.repeat(64) }), executeDocker, action: () => { throw new Error('lint failed'); },
  }), error => error instanceof AggregateError && error.errors.some(item => item.message === 'lint failed')
    && error.errors.some(item => item.message === 'SQL_LINT_TEMP_CONTEXT_RESTORE_FAILED:1')
    && error.cause?.message === 'SQL_LINT_TEMP_CONTEXT_RESTORE_FAILED:1');
});
