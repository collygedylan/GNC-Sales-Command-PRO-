import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inspectDisposableSupabaseWorkspace } from './disposable-supabase-container.mjs';
import { DATABASE_LINT_SCHEMAS } from './database-workspace.mjs';
import { packageBin, repoRoot, run, runNode } from './tooling-process.mjs';

const SUPPORTED = Object.freeze({
  'public.apply_inventory_reclass_move_v1': Object.freeze({
    args: ['uuid', 'text', 'bigint', 'text', 'jsonb', 'jsonb'], declarations: ['destination_season text;', 'destination_lot text;',
      'actor_username text;', 'is_manager boolean;', 'assigned_to_actor boolean;'],
  }),
  'private.apply_inventory_reclass_moves_set_v1': Object.freeze({
    args: ['uuid', 'text', 'bigint', 'jsonb', 'uuid'], declarations: [],
  }),
  'private.apply_inventory_reclass_import_overlay_v1': Object.freeze({
    args: ['uuid', 'uuid'], declarations: ['movement_request record;', 'movement record;', 'source_stage record;', 'target_stage record;',
      'source_rows integer;', 'source_matches boolean;', 'all_pre boolean;', 'all_post boolean;', 'target_count integer;',
      'target_pre boolean;', 'target_post boolean;', 'desired_status text;', 'conflict_reason_value text;'],
    contextTables: ['ph_master_bulk_stage_v1', 'ph_master_bulk_map_v1'],
  }),
  'public.bulk_import_master_snapshot_v1': Object.freeze({
    args: ['uuid', 'uuid', 'jsonb', 'text'], declarations: ['v_rows jsonb;'],
  }),
  'public.finalize_master_snapshot_stage_v1': Object.freeze({
    args: ['uuid', 'uuid', 'text'], declarations: [],
    probeGroup: 'master-snapshot-stage', contextTables: ['ph_master_bulk_stage_v1'],
  }),
  'public.ph_refresh_hold_learning_itemcode_batch': Object.freeze({
    args: ['text', 'integer'], declarations: ['v_job_name text;', 'v_batch_size integer;'],
  }),
  'public.ph_refresh_hold_learning_summary_batch': Object.freeze({
    args: ['text', 'integer'], declarations: ['v_job_name text;', 'v_batch_size integer;'],
  }),
  'public.ph_refresh_hold_stop_itemcode_cycles_fast': Object.freeze({
    args: ['date', 'date'], declarations: ['v_start_date date;', 'v_end_date date;'],
  }),
  'public.reconcile_season_sales_office_v1': Object.freeze({
    args: ['text[]', 'boolean', 'text', 'text'], declarations: [],
  }),
  'public.v2_refresh_hold_learning_profiles': Object.freeze({ args: [], declarations: [] }),
  'public.v2_refresh_hold_stop_itemcode_episode_learning': Object.freeze({
    args: ['date', 'date', 'integer'], declarations: ['safe_start date;', 'safe_end date;'],
  }),
});

const IDENT = /^[a-z_][a-z0-9_$]*$/i;
const TEMP_CREATE = /^\s*create\s+(?:(?:local|global)\s+)?(?:temp|temporary)\s+table\b/i;
const TEMP_NAME = /^\s*create\s+(?:(?:local|global)\s+)?(?:temp|temporary)\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_$]*)\b/i;
const STAGED_VIEW_CONTRACT = `create temp view ph_master_bulk_stage_v1 as
  select s.row_number::bigint as row_number,s.raw_values,s.raw_item6_count,
    s.raw_item6_fields,s.field_keys,s.lineage_key,s.source_hash,s.stable_identity_key,%s,
    null::text as warehousei
  from app_sync_private.ph_master_snapshot_stage_rows_v1 s
  where s.request_id=%L::uuid`;

function stagedViewSetup(body, functionName) {
  const matches = [...body.matchAll(/execute\s+format\(\s*'(create temp view ph_master_bulk_stage_v1 as[^']*)',\s*stage_columns,\s*p_request_id\);/gi)];
  if (matches.length !== 1 || matches[0][1].replace(/\s+/g, '') !== STAGED_VIEW_CONTRACT.replace(/\s+/g, '')
      || !/stage_columns\s*:=\s*app_sync_private\.master_snapshot_stage_columns_v1\('s'\);/.test(body)) {
    throw new Error(`SQL_LINT_TEMP_CONTEXT_VIEW_CONTRACT_CHANGED:${functionName}`);
  }
  // The exact production view and typed projection are planned with a null
  // request id, so this probe cannot read or publish a staged request.
  return `DO $lint_staged_view$\nDECLARE stage_columns text;\nBEGIN\n` +
    `  stage_columns := app_sync_private.master_snapshot_stage_columns_v1('s');\n` +
    `  EXECUTE format('${matches[0][1]}',stage_columns,null::uuid);\nEND\n$lint_staged_view$;`;
}
const functionInventorySql = `
select 'SQL_LINT_FUNCTIONS:' || replace(encode(convert_to(coalesce(jsonb_agg(jsonb_build_object(
  'schema', n.nspname, 'name', p.proname,
  'arguments', oidvectortypes(p.proargtypes),
  'argumentNames', p.proargnames,
  'body', p.prosrc, 'definition', pg_get_functiondef(p.oid)
) order by n.nspname, p.proname, p.oid), '[]'::jsonb)::text, 'UTF8'), 'base64'), E'\\n', '')
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where l.lanname = 'plpgsql'
  and n.nspname in ('public', 'private', 'aura_private', 'bunch_note_private', 'hl_order_private', 'app_sync_private')
  and (p.prosrc ~* 'create[[:space:]]+(local[[:space:]]+|global[[:space:]]+)?(temp|temporary)[[:space:]]+table'
    or (n.nspname='private' and p.proname='apply_inventory_reclass_import_overlay_v1'));
`.trim();

function isWord(char) { return Boolean(char && /[A-Za-z0-9_$]/.test(char)); }

function findStatementEnd(source, start) {
  let quote = '', dollar = '', lineComment = false, blockDepth = 0, escapeQuote = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockDepth) {
      if (char === '/' && next === '*') { blockDepth++; index++; }
      else if (char === '*' && next === '/') { blockDepth--; index++; }
      continue;
    }
    if (dollar) { if (source.startsWith(dollar, index)) { index += dollar.length - 1; dollar = ''; } continue; }
    if (quote) {
      if (escapeQuote && char === '\\') { index++; continue; }
      if (char === quote) { if (next === quote) index++; else { quote = ''; escapeQuote = false; } }
      continue;
    }
    if (char === '-' && next === '-') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockDepth = 1; index++; continue; }
    if (char === "'" || char === '"') {
      quote = char;
      escapeQuote = char === "'" && /(?:^|[^A-Za-z0-9_$])[eE]$/.test(source.slice(Math.max(start, index - 2), index));
      continue;
    }
    if (char === '$') {
      const match = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) { dollar = match[0]; index += dollar.length - 1; }
      continue;
    }
    if (char === ';') return index;
  }
  return -1;
}

function extractStaticTemporaryDdl(body) {
  const statements = [];
  let quote = '', dollar = '', lineComment = false, blockDepth = 0, escapeQuote = false;
  for (let index = 0; index < body.length; index++) {
    const char = body[index], next = body[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockDepth) {
      if (char === '/' && next === '*') { blockDepth++; index++; }
      else if (char === '*' && next === '/') { blockDepth--; index++; }
      continue;
    }
    if (dollar) { if (body.startsWith(dollar, index)) { index += dollar.length - 1; dollar = ''; } continue; }
    if (quote) {
      if (escapeQuote && char === '\\') { index++; continue; }
      if (char === quote) { if (next === quote) index++; else { quote = ''; escapeQuote = false; } }
      continue;
    }
    if (char === '-' && next === '-') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockDepth = 1; index++; continue; }
    if (char === "'" || char === '"') {
      quote = char;
      escapeQuote = char === "'" && /(?:^|[^A-Za-z0-9_$])[eE]$/.test(body.slice(Math.max(0, index - 2), index));
      continue;
    }
    if (char === '$') {
      const match = body.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) { dollar = match[0]; index += dollar.length - 1; }
      continue;
    }
    if (!isWord(body[index - 1]) && /^create\b/i.test(body.slice(index)) && TEMP_CREATE.test(body.slice(index))) {
      const end = findStatementEnd(body, index);
      if (end < 0) throw new Error('SQL_LINT_TEMP_CONTEXT_TEMP_TABLE_UNTERMINATED');
      statements.push(body.slice(index, end + 1).trim());
      index = end;
    }
  }
  return statements;
}

function checkedOutput(execute, command, args, options, label) {
  const result = execute(command, args, options);
  if (result?.status !== undefined && result.status !== 0) {
    throw new Error(`SQL_LINT_TEMP_CONTEXT_${label}_FAILED:${result.status}`);
  }
  return typeof result === 'string' ? result : result?.stdout || '';
}

function checkedNodeOutput(executeNode, args, options, label) {
  const result = executeNode(args, options);
  if (result?.status !== undefined && result.status !== 0) {
    throw new Error(`SQL_LINT_TEMP_CONTEXT_${label}_FAILED:${result.status}`);
  }
  return typeof result === 'string' ? result : result?.stdout || '';
}

function decodeJsonBase64(output, label) {
  const marker = label === 'FUNCTION_INVENTORY' ? 'SQL_LINT_FUNCTIONS:' : 'SQL_LINT_SHAPES:';
  const encoded = String(output).split(/\r?\n/).map(line => line.trim())
    .find(line => line.startsWith(marker))?.slice(marker.length);
  if (!encoded || !/^[A-Za-z0-9+/]+=*$/.test(encoded)) throw new Error(`SQL_LINT_TEMP_CONTEXT_${label}_OUTPUT_INVALID`);
  try { return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); }
  catch { throw new Error(`SQL_LINT_TEMP_CONTEXT_${label}_JSON_INVALID`); }
}

function normalizeArgumentTypes(value) {
  return String(value || '').split(',').map(arg => arg.trim().toLowerCase()).filter(Boolean);
}

export function extractTempStatements(body, functionName) {
  const statements = extractStaticTemporaryDdl(body);
  if (!statements.length) throw new Error(`SQL_LINT_TEMP_CONTEXT_STATIC_TEMP_TABLES_REQUIRED:${functionName}`);
  const names = [];
  const normalized = statements.map(statement => {
    const name = statement.match(TEMP_NAME)?.[1];
    if (!name || !IDENT.test(name)) throw new Error(`SQL_LINT_TEMP_CONTEXT_TEMP_TABLE_DDL_UNSUPPORTED:${functionName}`);
    if (names.includes(name.toLowerCase())) throw new Error(`SQL_LINT_TEMP_CONTEXT_DUPLICATE_TEMP_TABLE:${functionName}:${name}`);
    names.push(name.toLowerCase());
    const asIndex = statement.search(/\bas\s+(?:with\b|select\b)/i);
    if (asIndex < 0) return { name, statement };
    if (/\bwith\s+no\s+data\s*;?\s*$/i.test(statement)) throw new Error(`SQL_LINT_TEMP_CONTEXT_UNEXPECTED_NO_DATA:${functionName}:${name}`);
    const semicolon = statement.lastIndexOf(';');
    if (semicolon < 0 || statement.slice(semicolon + 1).trim()) throw new Error(`SQL_LINT_TEMP_CONTEXT_TEMP_TABLE_DDL_UNSUPPORTED:${functionName}:${name}`);
    return { name, statement: `${statement.slice(0, semicolon).trimEnd()} WITH NO DATA;` };
  });
  return normalized;
}

export function getSupportedFunctions(rawFunctions, { allowMissing = false } = {}) {
  if (!Array.isArray(rawFunctions)) throw new Error('SQL_LINT_TEMP_CONTEXT_FUNCTION_INVENTORY_INVALID');
  const functions = new Map();
  for (const item of rawFunctions) {
    const qualifiedName = `${item.schema}.${item.name}`;
    const specification = SUPPORTED[qualifiedName];
    if (!specification) throw new Error(`SQL_LINT_TEMP_CONTEXT_FUNCTION_UNSUPPORTED:${qualifiedName}`);
    const args = normalizeArgumentTypes(item.arguments);
    if (JSON.stringify(args) !== JSON.stringify(specification.args)) {
      throw new Error(`SQL_LINT_TEMP_CONTEXT_FUNCTION_SIGNATURE_CHANGED:${qualifiedName}`);
    }
    if (!item.body || !item.definition || functions.has(qualifiedName)) {
      throw new Error(`SQL_LINT_TEMP_CONTEXT_FUNCTION_INVALID:${qualifiedName}`);
    }
    for (const declaration of specification.declarations) {
      const variable = declaration.match(/^([a-z_][a-z0-9_$]*)\s+/i)?.[1];
      const [name, type] = declaration.slice(0, -1).split(/\s+/);
      if (!variable || !new RegExp(`\\b${name}\\s+${type}\\b`, 'i').test(item.body)) {
        throw new Error(`SQL_LINT_TEMP_CONTEXT_LOCAL_DECLARATION_CHANGED:${qualifiedName}:${name}`);
      }
    }
    const statements = specification.contextTables?.length && extractStaticTemporaryDdl(item.body).length === 0
      ? [] : extractTempStatements(item.body, qualifiedName);
    const beginIndex = firstBeginIndex(item.body);
    const declaredNames = [...item.body.slice(0, beginIndex).matchAll(/^\s*([a-z_][a-z0-9_$]*)\s+(?=[a-z_])/gmi)]
      .map(match => match[1].toLowerCase()).filter(name => name !== 'declare');
    const parameterNames = Array.isArray(item.argumentNames) ? item.argumentNames.map(name => String(name || '').toLowerCase()).filter(Boolean) : [];
    const supportedNames = new Set(specification.declarations.map(declaration => declaration.split(/\s+/)[0].toLowerCase()));
    const referencedInTempSql = name => statements.some(statement => new RegExp(`\\b${name}\\b`, 'i').test(statement.statement));
    for (const name of [...declaredNames, ...parameterNames]) {
      if (!supportedNames.has(name) && referencedInTempSql(name)) {
        throw new Error(`SQL_LINT_TEMP_CONTEXT_UNSUPPORTED_LOCAL_VARIABLE:${qualifiedName}:${name}`);
      }
    }
    const contextSetup = specification.probeGroup === 'master-snapshot-stage' ? stagedViewSetup(item.body, qualifiedName) : '';
    functions.set(qualifiedName, { ...item, qualifiedName, specification, statements, contextSetup });
  }
  const expected = Object.keys(SUPPORTED).sort();
  const actual = [...functions.keys()].sort();
  if ((!allowMissing && JSON.stringify(actual) !== JSON.stringify(expected))
      || actual.some(name => !expected.includes(name))) {
    throw new Error(`SQL_LINT_TEMP_CONTEXT_FUNCTION_SET_CHANGED:${actual.join(',')}`);
  }
  const tableNames = [...functions.values()].flatMap(item => item.statements.map(statement =>
    `${item.specification.probeGroup || 'default'}:${statement.name.toLowerCase()}`));
  if (new Set(tableNames).size !== tableNames.length) throw new Error('SQL_LINT_TEMP_CONTEXT_TEMP_TABLE_NAME_COLLISION');
  return [...functions.values()];
}

export function groupProbeFunctions(functions) {
  const groups = new Map();
  for (const item of functions) {
    const name = item.specification.probeGroup || 'default';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  }
  return [...groups.values()];
}

function quoteIdentifier(value) {
  if (!IDENT.test(value)) throw new Error('SQL_LINT_TEMP_CONTEXT_IDENTIFIER_INVALID');
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function probeSql(functions) {
  const groups = groupProbeFunctions(functions);
  if (groups.length > 1) return groups.map(group => probeSql(group)).join('\n');
  const blocks = functions.map((item, index) => {
    const declarations = item.specification.declarations.length
      ? `DECLARE\n${item.specification.declarations.map(value => `  ${value}`).join('\n')}\n`
      : '';
    return `DO $lint_temp_context_${index}$\n${declarations}BEGIN\n${item.statements.map(statement => `  ${statement.statement}`).join('\n')}\nEND\n$lint_temp_context_${index}$;`;
  });
  const names = [...new Set(functions.flatMap(item => [
    ...item.statements.map(statement => statement.name), ...(item.specification.contextTables || []),
  ]))];
  const namesArray = `ARRAY[${names.map(name => quoteLiteral(name)).join(', ')}]::text[]`;
  const metadata = `select 'SQL_LINT_SHAPES:' || replace(replace(encode(convert_to(coalesce(jsonb_agg(jsonb_build_object(
  'name', c.relname,
  'columns', (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) order by a.attnum)
    from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
) order by c.relname), '[]'::jsonb)::text, 'UTF8'), 'base64'), E'\\n', ''), E'\\r', '')
from pg_class c
where c.relnamespace = pg_my_temp_schema() and c.relkind in ('r','v') and c.relname = any(${namesArray});`;
  return `BEGIN;\n${functions.map(item => item.contextSetup).filter(Boolean).join('\n')}\n${blocks.join('\n')}\n${metadata}\nROLLBACK;\n`;
}

export function validateShapes(functions, rawShapes) {
  if (!Array.isArray(rawShapes)) throw new Error('SQL_LINT_TEMP_CONTEXT_SHAPES_INVALID');
  const byName = new Map(rawShapes.map(shape => [String(shape.name).toLowerCase(), shape]));
  const allStatements = functions.flatMap(item => item.statements.map(statement => ({ functionName: item.qualifiedName, ...statement })));
  const expectedShapeNames = new Set([
    ...allStatements.map(statement => statement.name.toLowerCase()),
    ...functions.flatMap(item => item.specification.contextTables || []).map(name => name.toLowerCase()),
  ]);
  if (byName.size !== expectedShapeNames.size || [...byName.keys()].some(name => !expectedShapeNames.has(name))) {
    throw new Error('SQL_LINT_TEMP_CONTEXT_SHAPE_COUNT_MISMATCH');
  }
  return functions.map(item => ({
    ...item,
    pragmas: [...item.statements.map(statement => statement.name), ...(item.specification.contextTables || [])].map(name => {
      const shape = byName.get(name.toLowerCase());
      if (!shape || !Array.isArray(shape.columns) || shape.columns.length === 0) {
        throw new Error(`SQL_LINT_TEMP_CONTEXT_SHAPE_MISSING:${item.qualifiedName}:${name}`);
      }
      const columns = shape.columns.map(column => {
        if (!IDENT.test(column.name) || typeof column.type !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_ .(),\[\]]*$/.test(column.type)) {
          throw new Error(`SQL_LINT_TEMP_CONTEXT_COLUMN_INVALID:${name}`);
        }
        return `${column.name} ${column.type}`;
      });
      return `table: ${name}(${columns.join(', ')})`;
    }),
  }));
}

export function firstBeginIndex(body) {
  let quote = '', dollar = '', lineComment = false, blockDepth = 0, escapeQuote = false;
  for (let index = 0; index < body.length; index++) {
    const char = body[index], next = body[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockDepth) {
      if (char === '/' && next === '*') { blockDepth++; index++; }
      else if (char === '*' && next === '/') { blockDepth--; index++; }
      continue;
    }
    if (dollar) { if (body.startsWith(dollar, index)) { index += dollar.length - 1; dollar = ''; } continue; }
    if (quote) {
      if (escapeQuote && char === '\\') { index++; continue; }
      if (char === quote) { if (next === quote) index++; else { quote = ''; escapeQuote = false; } }
      continue;
    }
    if (char === '-' && next === '-') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockDepth = 1; index++; continue; }
    if (char === "'" || char === '"') {
      quote = char;
      escapeQuote = char === "'" && /(?:^|[^A-Za-z0-9_$])[eE]$/.test(body.slice(Math.max(0, index - 2), index));
      continue;
    }
    if (char === '$') {
      const match = body.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) { dollar = match[0]; index += dollar.length - 1; }
      continue;
    }
    if ((char === 'b' || char === 'B') && body.slice(index, index + 5).toLowerCase() === 'begin'
        && !/[A-Za-z0-9_$]/.test(body[index - 1] || '') && !/[A-Za-z0-9_$]/.test(body[index + 5] || '')) return index;
  }
  throw new Error('SQL_LINT_TEMP_CONTEXT_FUNCTION_BEGIN_NOT_FOUND');
}

export function decorateDefinitions(functions, extensionSchema) {
  return functions.map(item => {
    const beginIndex = firstBeginIndex(item.body);
    const insertion = beginIndex + 'begin'.length;
    const calls = item.pragmas.map(pragma => `\n  PERFORM ${quoteIdentifier(extensionSchema)}.plpgsql_check_pragma(${quoteLiteral(pragma)});`).join('');
    const body = `${item.body.slice(0, insertion)}${calls}${item.body.slice(insertion)}`;
    const first = item.definition.indexOf(item.body);
    if (first < 0 || first !== item.definition.lastIndexOf(item.body)) {
      throw new Error(`SQL_LINT_TEMP_CONTEXT_FUNCTION_SOURCE_MISMATCH:${item.qualifiedName}`);
    }
    return { signature: item.qualifiedName, original: item.definition, decorated: `${item.definition.slice(0, first)}${body}${item.definition.slice(first + item.body.length)}` };
  });
}

export function patchSql(definitions, restoreSchema) {
  const saved = definitions.map((item, index) => `(${quoteLiteral(`${item.signature}#${index}`)}, ${quoteLiteral(item.original)})`).join(',\n');
  return `BEGIN;\nCREATE SCHEMA ${quoteIdentifier(restoreSchema)};\nCREATE TABLE ${quoteIdentifier(restoreSchema)}.saved_functions (signature text primary key, definition text not null);\nREVOKE ALL ON SCHEMA ${quoteIdentifier(restoreSchema)} FROM PUBLIC;\nREVOKE ALL ON TABLE ${quoteIdentifier(restoreSchema)}.saved_functions FROM PUBLIC;\nINSERT INTO ${quoteIdentifier(restoreSchema)}.saved_functions(signature, definition) VALUES\n${saved};\n${definitions.map(item => `${item.decorated.replace(/;\s*$/, '')};`).join('\n')}\nCOMMIT;\n`;
}

function restoreSql(restoreSchema) {
  const schema = quoteIdentifier(restoreSchema);
  return `BEGIN;\nDO $restore_sql_lint_context$\nDECLARE saved record;\nBEGIN\n  FOR saved IN SELECT definition FROM ${schema}.saved_functions ORDER BY signature LOOP\n    EXECUTE saved.definition;\n  END LOOP;\nEND\n$restore_sql_lint_context$;\nDROP SCHEMA ${schema} CASCADE;\nCOMMIT;\n`;
}

function decodeShapes(output, functions) {
  const shapes = decodeJsonBase64(output, 'TEMP_SHAPES');
  return validateShapes(functions, shapes);
}

function psql(execute, root, containerId, input, label) {
  return checkedOutput(execute, 'docker', ['exec', '-i', containerId, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { root, capture: true, input }, label);
}

/** Apply exact source-derived temporary-table pragmas only around strict lint on a verified disposable stack. */
export function withSqlLintTempContext({ root = repoRoot, workspaceRoot, cli = packageBin('supabase', 'supabase', root),
  executeNode = runNode, executeDocker = run, inspectWorkspace = inspectDisposableSupabaseWorkspace,
  status, allowMissingFunctions = false, action } = {}) {
  if (typeof action !== 'function') throw new Error('SQL_LINT_TEMP_CONTEXT_ACTION_REQUIRED');
  const workspace = inspectWorkspace({ root, workspaceRoot, cli, execute: executeDocker, executeNode, status });
  psql(executeDocker, root, workspace.containerId,
    'CREATE SCHEMA IF NOT EXISTS extensions;\nCREATE EXTENSION IF NOT EXISTS plpgsql_check WITH SCHEMA extensions;\n', 'EXTENSION_INSTALL');
  const inventoryOutput = checkedOutput(executeDocker, 'docker', ['exec', workspace.containerId, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', functionInventorySql],
    { root, capture: true }, 'FUNCTION_INVENTORY');
  const functions = getSupportedFunctions(decodeJsonBase64(inventoryOutput, 'FUNCTION_INVENTORY'), { allowMissing: allowMissingFunctions });
  if (functions.length === 0 && allowMissingFunctions) return action();
  const decorated = groupProbeFunctions(functions).flatMap(group => {
    const shapesOutput = psql(executeDocker, root, workspace.containerId, probeSql(group), 'TEMP_PROBE');
    return decodeShapes(shapesOutput, group);
  });
  const extensionOutput = checkedOutput(executeDocker, 'docker', ['exec', workspace.containerId, 'psql', '-X', '-q', '-A', '-t', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
    "select 'SQL_LINT_EXTENSION:' || n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='plpgsql_check_pragma' and p.provariadic<>0"],
  { root, capture: true }, 'EXTENSION_LOOKUP');
  const extensionRows = String(extensionOutput).split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('SQL_LINT_EXTENSION:'));
  const extensionSchema = extensionRows.length === 1 ? extensionRows[0].slice('SQL_LINT_EXTENSION:'.length) : '';
  if (!extensionSchema || !IDENT.test(extensionSchema)) throw new Error('SQL_LINT_TEMP_CONTEXT_PRAGMA_FUNCTION_UNAVAILABLE');
  const definitions = decorateDefinitions(decorated, extensionSchema);
  const restoreSchema = `aura_lint_${randomBytes(8).toString('hex')}`;
  if (!IDENT.test(restoreSchema)) throw new Error('SQL_LINT_TEMP_CONTEXT_RESTORE_SCHEMA_INVALID');
  psql(executeDocker, root, workspace.containerId, patchSql(definitions, restoreSchema), 'PATCH');
  let result;
  let failure;
  try { result = action(); } catch (error) { failure = error; }
  try { psql(executeDocker, root, workspace.containerId, restoreSql(restoreSchema), 'RESTORE'); }
  catch (restoreError) {
    const message = failure instanceof Error ? failure.message : failure ? String(failure) : '';
    throw new AggregateError([failure, restoreError].filter(Boolean), `${message}${message ? '; ' : ''}${restoreError.message}`, { cause: restoreError });
  }
  if (failure) throw failure;
  return result;
}

export const sqlLintTempContextFunctions = Object.freeze(Object.keys(SUPPORTED));

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const [flag, workspaceRoot, ...rest] = process.argv.slice(2);
    if (flag !== '--historical-reset' || !workspaceRoot || rest.length) {
      throw new Error('Usage: node scripts/sql-lint-temp-context.mjs --historical-reset <verified-disposable-workspace>');
    }
    const cli = packageBin('supabase', 'supabase', repoRoot);
    const executeNode = (args, options) => runNode(args, options);
    const beforeReset = inspectDisposableSupabaseWorkspace({ root: repoRoot, workspaceRoot, cli, executeNode, execute: run });
    checkedNodeOutput(executeNode, [cli, '--workdir', beforeReset.absolute, 'db', 'reset', '--local', '--no-seed'],
      { root: repoRoot }, 'HISTORICAL_RESET');
    withSqlLintTempContext({ root: repoRoot, workspaceRoot: beforeReset.absolute, cli, executeNode,
      allowMissingFunctions: true, action: () => checkedNodeOutput(executeNode,
        [cli, '--workdir', beforeReset.absolute, 'db', 'lint', '--local', '--schema', DATABASE_LINT_SCHEMAS.join(','), '--fail-on', 'error'],
        { root: repoRoot, capture: true }, 'HISTORICAL_LINT') });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
