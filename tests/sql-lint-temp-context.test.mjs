import test from 'node:test';
import assert from 'node:assert/strict';
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
  ['ph_refresh_hold_learning_itemcode_batch', 'text, integer', 'v_job_name text;\nv_batch_size integer;', 'create temp table tmp_hl_batch on commit drop as select v_job_name as name limit v_batch_size;'],
  ['ph_refresh_hold_learning_summary_batch', 'text, integer', 'v_job_name text;\nv_batch_size integer;', 'create temp table tmp_hl_summary on commit drop as select v_job_name as name limit v_batch_size;'],
  ['ph_refresh_hold_stop_itemcode_cycles_fast', 'date, date', 'v_start_date date;\nv_end_date date;', 'create temp table tmp_hs_files on commit drop as select v_start_date as day where v_end_date is null;'],
  ['reconcile_season_sales_office_v1', 'text[], boolean, text, text', '', 'create temporary table season_items (itemcode text primary key) on commit drop;'],
  ['v2_refresh_hold_learning_profiles', '', '', 'create temporary table profile_stage on commit drop as select 1::integer as sample_count;'],
  ['v2_refresh_hold_stop_itemcode_episode_learning', 'date, date, integer', 'safe_start date;\nsafe_end date;', 'create temp table episode_files on commit drop as select safe_start as day where safe_end is null;'],
].map(([name, args, declarations, ddl]) => {
  const body = (declarations ? 'DECLARE\n' + declarations + '\n' : '') + 'BEGIN\n  ' + ddl + '\nEND;';
  return { schema: 'public', name, arguments: args, argumentNames: [], body,
    definition: 'CREATE OR REPLACE FUNCTION public.' + name + '() RETURNS void LANGUAGE plpgsql AS $$' + body + '$$;' };
});

function encodeJson(value) { return Buffer.from(JSON.stringify(value)).toString('base64'); }

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
  assert.equal(functions.length, 6);
  assert.equal(functions.flatMap(item => item.statements).length, 6);
  assert.match(probeSql(functions), /WITH NO DATA/);
  assert.match(probeSql(functions), /create temporary table season_items/i);
  assert.throws(() => getSupportedFunctions(fixtureFunctions().slice(1)), /FUNCTION_SET_CHANGED/);
  const changed = fixtureFunctions();
  changed[0].body = changed[0].body.replace('v_batch_size integer;', 'v_batch_size integer;\nv_unmapped_local text;')
    .replace('v_job_name as name', 'v_unmapped_local as name');
  changed[0].definition = 'CREATE FUNCTION public.' + changed[0].name + '() AS $$' + changed[0].body + '$$;';
  assert.throws(() => getSupportedFunctions(changed), /UNSUPPORTED_LOCAL_VARIABLE/);
});

test('derived shapes produce exact pragmas and decoration inserts them after the actual function BEGIN', () => {
  const functions = getSupportedFunctions(fixtureFunctions());
  const shapes = functions.flatMap(item => item.statements.map(statement => ({
    name: statement.name, columns: [{ name: 'id', type: 'integer' }],
  })));
  const withPragmas = validateShapes(functions, shapes);
  const decorated = decorateDefinitions(withPragmas, 'extensions');
  assert.equal(decorated.length, 6);
  assert.match(decorated[0].decorated, /BEGIN\s+PERFORM "extensions"\.plpgsql_check_pragma\('table: tmp_hl_batch\(id integer\)'\);/);
  assert.match(decorated[0].decorated, /limit v_batch_size/i);
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
  const shapes = functions.flatMap(item => extractTempStatements(item.body, item.name).map(statement => ({
    name: statement.name, columns: [{ name: 'id', type: 'integer' }],
  })));
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
  const shapes = functions.flatMap(item => extractTempStatements(item.body, item.name).map(statement => ({
    name: statement.name, columns: [{ name: 'id', type: 'integer' }],
  })));
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
