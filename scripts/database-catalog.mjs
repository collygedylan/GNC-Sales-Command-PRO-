import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './tooling-process.mjs';

const q = value => `"${String(value).replaceAll('"', '""')}"`;
const qualified = row => `${q(row.schema)}.${q(row.name)}`;
const end = sql => sql.replace(/;\s*$/, '') + ';\n';
const systemSchemas = new Set(['pg_catalog', 'information_schema']);
function extensionSetup(extension) {
  const schema = q(extension.schema);
  const createSchema = systemSchemas.has(extension.schema) ? [] : [`CREATE SCHEMA IF NOT EXISTS ${schema};`];
  return [...createSchema, `CREATE EXTENSION IF NOT EXISTS ${q(extension.name)} WITH SCHEMA ${schema};`];
}

/** Split SQL without splitting function bodies, strings, identifiers or comments. */
export function sqlStatements(source) {
  const statements = [];
  let start = 0, quote = '', dollar = '', block = 0, line = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (line) { if (char === '\n') line = false; continue; }
    if (block) {
      if (char === '/' && next === '*') { block++; i++; }
      else if (char === '*' && next === '/') { block--; i++; }
      continue;
    }
    if (dollar) { if (source.startsWith(dollar, i)) { i += dollar.length - 1; dollar = ''; } continue; }
    if (quote) {
      if (escaped && char === '\\') { i++; continue; }
      if (char === quote) { if (next === quote) i++; else quote = ''; }
      continue;
    }
    if (char === '-' && next === '-') { line = true; i++; }
    else if (char === '/' && next === '*') { block = 1; i++; }
    else if (char === '"' || char === "'") { quote = char; escaped = char === "'" && /(?:^|\W)e$/i.test(source.slice(Math.max(0, i - 2), i)); }
    else if (char === '$') { const match = source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/); if (match) { dollar = match[0]; i += dollar.length - 1; } }
    else if (char === ';') { statements.push(source.slice(start, i + 1)); start = i + 1; }
  }
  if (quote || dollar || block) throw new Error('DATABASE_SQL_UNTERMINATED_TOKEN');
  if (source.slice(start).trim()) statements.push(source.slice(start));
  return statements;
}
function grants(kind, name, owner, acl = []) {
  const commands = [`ALTER ${kind} ${name} OWNER TO ${q(owner)};`, `REVOKE ALL ON ${kind} ${name} FROM PUBLIC;`];
  for (const entry of acl || []) commands.push(`GRANT ${entry.privilege} ON ${kind} ${name} TO ${entry.role === 'PUBLIC' ? 'PUBLIC' : q(entry.role)}${entry.grantable ? ' WITH GRANT OPTION' : ''};`);
  return commands.join('\n');
}
function sequence(row) {
  const s = row.sequence;
  const integer = field => {
    const value = s[field];
    if ((typeof value === 'number' && !Number.isSafeInteger(value)) ||
        (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+$/.test(value)))) {
      throw new Error(`DATABASE_SEQUENCE_INTEGER_INVALID:${row.schema}.${row.name}.${field}`);
    }
    return String(value);
  };
  const increment = integer('increment'), min = integer('min'), max = integer('max');
  const start = integer('start'), cache = integer('cache');
  return `CREATE SEQUENCE ${qualified(row)} AS ${s.type} INCREMENT ${increment} MINVALUE ${min} MAXVALUE ${max} START ${start} CACHE ${cache} ${s.cycle ? '' : 'NO '}CYCLE;`;
}
function table(row) {
  return `CREATE TABLE ${qualified(row)} (\n${row.columns.map(column => {
    if (column.generated && !column.default) throw new Error(`DATABASE_GENERATED_COLUMN_EXPRESSION_MISSING:${row.name}.${column.name}`);
    const generated = column.generated ? ` GENERATED ALWAYS AS (${column.default}) STORED` : '';
    return `  ${q(column.name)} ${column.type}${generated}${column.identity ? ` GENERATED ${column.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY (SEQUENCE NAME ${column.sequence})` : ''}${column.notNull ? ' NOT NULL' : ''}`;
  }).join(',\n')}\n);`;
}

const sqlIdentifier = '(?:"((?:""|[^"])*)"|([A-Za-z_][A-Za-z_0-9$]*))';
function identifier(quoted, plain) { return quoted !== undefined ? quoted.replaceAll('""', '"') : plain; }
function trimLeadingComments(statement) {
  return statement.replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/, '');
}
function schemaObject(schema, name, defaultSchema = 'public') {
  return `${schema || defaultSchema}.${name}`;
}
function parseFunctionCreation(statement) {
  const match = trimLeadingComments(statement).match(new RegExp(`^\\s*create\\s+(?:or\\s+replace\\s+)?function\\s+(${sqlIdentifier})(?:\\s*\\.\\s*(${sqlIdentifier}))?\\s*\\(`, 'i'));
  if (!match) return null;
  const first = identifier(match[2], match[3]);
  const schema = match[5] === undefined && match[6] === undefined ? null : first;
  const name = schema ? identifier(match[5], match[6]) : first;
  return schemaObject(schema, name);
}
function parseTrigger(statement) {
  const match = trimLeadingComments(statement).match(new RegExp(`^\\s*create\\s+(?:constraint\\s+)?trigger\\s+(${sqlIdentifier})[\\s\\S]*?\\bon\\s+(?:(${sqlIdentifier})\\s*\\.\\s*)?(${sqlIdentifier})[\\s\\S]*?\\bexecute\\s+(?:function|procedure)\\s+(?:(${sqlIdentifier})\\s*\\.\\s*)?(${sqlIdentifier})\\s*\\(`, 'i'));
  if (!match) return null;
  const read = offset => identifier(match[offset + 1], match[offset + 2]);
  const triggerName = read(1);
  const tableSchema = match[5] !== undefined || match[6] !== undefined ? read(4) : null;
  const tableName = read(7);
  const fnSchemaPresent = match[11] !== undefined || match[12] !== undefined;
  const fnSchema = fnSchemaPresent ? read(10) : null;
  const fnName = read(13);
  return {
    name: triggerName,
    relation: `${tableSchema || 'public'}.${tableName}`,
    function: schemaObject(fnSchema, fnName),
  };
}
function migrationSqlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.sql'))
    .map(entry => ({ name: entry.name, source: readFileSync(path.join(directory, entry.name), 'utf8') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Remove only captured triggers first introduced by active post-baseline migrations. */
export function filterPostBaselineTriggers(catalog, baselineSource, { root = repoRoot, baselineName = '20260929200000_production_baseline.sql' } = {}) {
  const migrationFiles = migrationSqlFiles(path.join(root, 'supabase', 'migrations'));
  const baselineIndex = migrationFiles.findIndex(file => file.name === baselineName);
  if (baselineIndex < 0) throw new Error('DATABASE_BASELINE_MISSING');
  const baselineFunctions = new Set((catalog.functions || []).map(fn => `${fn.schema}.${fn.name}`));
  for (const statement of sqlStatements(baselineSource)) {
    const fn = parseFunctionCreation(statement);
    if (fn) baselineFunctions.add(fn);
  }
  const active = migrationFiles.slice(baselineIndex + 1);
  const activeFunctions = new Set();
  const activeTriggers = new Map();
  for (const file of active) {
    for (const statement of sqlStatements(file.source)) {
      const fn = parseFunctionCreation(statement);
      if (fn) activeFunctions.add(fn);
      const trigger = parseTrigger(statement);
      if (trigger) activeTriggers.set(`${trigger.relation}.${trigger.name}`, trigger.function);
      else if (/^\s*create\s+(?:constraint\s+)?trigger\b/i.test(trimLeadingComments(statement))) {
        throw new Error(`DATABASE_ACTIVE_TRIGGER_PROVENANCE_UNRECOGNIZED:${file.name}`);
      }
    }
  }
  const archiveFunctions = new Set();
  const archiveTriggers = new Set();
  const archiveDir = path.join(root, 'supabase', 'archive_migrations');
  if (readdirSync(path.join(root, 'supabase')).includes('archive_migrations')) {
    for (const file of migrationSqlFiles(archiveDir)) for (const statement of sqlStatements(file.source)) {
      const fn = parseFunctionCreation(statement);
      if (fn) archiveFunctions.add(fn);
      const trigger = parseTrigger(statement);
      if (trigger) archiveTriggers.add(`${trigger.relation}.${trigger.name}`);
    }
  }

  const removed = [];
  const filtered = structuredClone(catalog);
  for (const row of filtered.relations || []) {
    row.triggers = (row.triggers || []).filter(definition => {
      const trigger = parseTrigger(definition);
      if (!trigger) throw new Error(`DATABASE_TRIGGER_DEFINITION_UNRECOGNIZED:${row.schema}.${row.name}`);
      const key = `${row.schema}.${row.name}.${trigger.name}`;
      const introducedFunction = activeTriggers.get(key);
      if (baselineFunctions.has(trigger.function)) return true;
      if (!activeFunctions.has(trigger.function) || introducedFunction !== trigger.function) {
        throw new Error(`DATABASE_TRIGGER_PROVENANCE_UNKNOWN:${key}:${trigger.function}`);
      }
      if (archiveFunctions.has(trigger.function) || archiveTriggers.has(key)) {
        throw new Error(`DATABASE_TRIGGER_PREBASELINE_PROVENANCE_CONFLICT:${key}:${trigger.function}`);
      }
      removed.push(key);
      return false;
    });
  }
  return { catalog: filtered, removed };
}

/** Restore captured functions to pre-patch state where active replay expects older source text. */
export function restoreBaselineFunctionBodies(catalog, { root = repoRoot } = {}) {
  const restored = structuredClone(catalog);
  const specifications = [
    {
      migration: '20261006200449_inventory_row_assignment_fence_integration.sql',
      schema: 'app_sync_private',
      name: 'begin_import',
      identity: 'p_dataset_keys text[], p_run_id uuid, p_canonical_keys text[]',
      current: "from unnest(coalesce(p_canonical_keys,keys)) requested(source_key);\n  if 'ph_master_inventory' = any(keys) then\n    select array_agg(distinct requested.source_key order by requested.source_key) into keys\n    from unnest(keys || array['ph_itemcode_default_owners','ph_inventory_row_assignments']) requested(source_key);\n  end if;",
      baseline: 'from unnest(coalesce(p_canonical_keys,keys)) requested(source_key);',
      migrationProof: 'INVENTORY_ROW_ASSIGNMENT_IMPORT_FENCE_PATCH_FAILED',
    },
    {
      migration: '20261006200449_inventory_row_assignment_fence_integration.sql',
      schema: 'app_sync_private',
      name: 'advance_import',
      identity: 'p_run_id uuid, p_action text',
      current: 'assignment_result := private.reconcile_inventory_row_assignments_v1(p_run_id);',
      baseline: 'assignment_result := public.reconcile_eval_itemcodes(p_run_id);',
      migrationProof: 'INVENTORY_ROW_ASSIGNMENT_FINISH_HOOK_PATCH_FAILED',
    },
  ];
  for (const specification of specifications) {
    const migrationPath = path.join(root, 'supabase', 'migrations', specification.migration);
    let migrationSource;
    try { migrationSource = readFileSync(migrationPath, 'utf8'); }
    catch (error) { throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_MIGRATION_MISSING:${specification.migration}`, { cause: error }); }
    if (!migrationSource.includes(specification.migrationProof)) {
      throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_PROVENANCE_INVALID:${specification.migration}`);
    }
    const fn = restored.functions.find(candidate => candidate.schema === specification.schema
      && candidate.name === specification.name && candidate.identityArgs === specification.identity);
    if (!fn?.definition) throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_TARGET_MISSING:${specification.schema}.${specification.name}`);
    const count = (fn.definition.split(specification.current).length - 1);
    if (count !== 1) throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_STATE_INVALID:${specification.schema}.${specification.name}:${count}`);
    fn.definition = fn.definition.replace(specification.current, specification.baseline);
  }

  const membershipMigrationName = '20261006210200_inventory_row_assignment_live_consumers.sql';
  const membershipMigrationPath = path.join(root, 'supabase', 'migrations', membershipMigrationName);
  let membershipMigration;
  try { membershipMigration = readFileSync(membershipMigrationPath, 'utf8'); }
  catch (error) { throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_MIGRATION_MISSING:${membershipMigrationName}`, { cause: error }); }
  if (!membershipMigration.includes('ROW_ASSIGNMENT_EVAL_WORK_MEMBERSHIP_SOURCE_MISMATCH')) {
    throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_PROVENANCE_INVALID:${membershipMigrationName}`);
  }
  const ownerGateMatch = membershipMigration.match(/old_owner_gate\s+text\s*:=\s*\$old\$([\s\S]*?)\$old\$;/i);
  if (!ownerGateMatch?.[1]) throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_SOURCE_MISSING:${membershipMigrationName}:old_owner_gate`);
  const membership = restored.functions.find(candidate => candidate.schema === 'private'
    && candidate.name === 'eval_work_assert_itemcode_membership_v1'
    && candidate.identityArgs === 'p_work_id uuid');
  if (!membership?.definition) throw new Error('DATABASE_BASELINE_FUNCTION_PATCH_TARGET_MISSING:private.eval_work_assert_itemcode_membership_v1');
  const oldOwnerGate = ownerGateMatch[1];
  if (membership.definition.includes(oldOwnerGate)) {
    throw new Error('DATABASE_BASELINE_FUNCTION_PATCH_STATE_INVALID:private.eval_work_assert_itemcode_membership_v1:already-present');
  }
  const returnAnchor = '  return current_rows;';
  const anchorCount = membership.definition.split(returnAnchor).length - 1;
  if (anchorCount !== 1) throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_STATE_INVALID:private.eval_work_assert_itemcode_membership_v1:${anchorCount}`);
  membership.definition = membership.definition.replace(returnAnchor, `${oldOwnerGate}${returnAnchor}`);

  const validatorMigrationName = '20261006145333_reclass_split_move_inquiries_v4.sql';
  const validatorArchiveName = '20260827005258_eval_work_v1.sql';
  const readSql = (directory, name) => {
    try { return readFileSync(path.join(root, 'supabase', directory, name), 'utf8'); }
    catch (error) { throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_MIGRATION_MISSING:${name}`, { cause: error }); }
  };
  const validatorMigration = readSql('migrations', validatorMigrationName);
  const renameStatement = sqlStatements(validatorMigration).filter(statement =>
    /\balter\s+function\s+private\.validate_eval_work_inquiry_v1\s*\(\s*jsonb\s*,\s*text\s*,\s*jsonb\s*\)\s+rename\s+to\s+validate_eval_work_inquiry_legacy_v1\b/i.test(trimLeadingComments(statement)));
  if (renameStatement.length !== 1) {
    throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_PROVENANCE_INVALID:${validatorMigrationName}:rename`);
  }
  const wrapperDefinitions = sqlStatements(validatorMigration).filter(statement =>
    parseFunctionCreation(statement) === 'private.validate_eval_work_inquiry_v1'
      && /\bp_inquiry\s+jsonb\s*,\s*p_itemcode\s+text\s*,\s*p_context_rows\s+jsonb\b/i.test(statement));
  if (wrapperDefinitions.length !== 1
      || (wrapperDefinitions[0].match(/reclass-action-workflow-v4-split-moves-20261006/g) || []).length !== 1
      || (wrapperDefinitions[0].match(/private\.validate_eval_work_inquiry_legacy_v1\s*\(/g) || []).length !== 2) {
    throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_PROVENANCE_INVALID:${validatorMigrationName}:wrapper`);
  }
  const validator = restored.functions.find(candidate => candidate.schema === 'private'
    && candidate.name === 'validate_eval_work_inquiry_v1'
    && candidate.identityArgs === 'p_inquiry jsonb, p_itemcode text, p_context_rows jsonb');
  if (!validator?.definition) throw new Error('DATABASE_BASELINE_FUNCTION_PATCH_TARGET_MISSING:private.validate_eval_work_inquiry_v1');
  const currentWrapperMarker = 'reclass-action-workflow-v4-split-moves-20261006';
  const currentLegacyCalls = (validator.definition.match(/private\.validate_eval_work_inquiry_legacy_v1\s*\(/g) || []).length;
  if ((validator.definition.match(new RegExp(currentWrapperMarker, 'g')) || []).length !== 1 || currentLegacyCalls !== 2) {
    throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_STATE_INVALID:private.validate_eval_work_inquiry_v1:${currentLegacyCalls}`);
  }
  const dollarBody = definition => definition.match(/\bas\s+(\$[\w]*\$)([\s\S]*)\1/i)?.[2]?.replace(/\r\n/g, '\n') ?? null;
  const capturedWrapperBody = dollarBody(validator.definition);
  const migrationWrapperBody = dollarBody(wrapperDefinitions[0]);
  if (capturedWrapperBody === null || migrationWrapperBody === null || capturedWrapperBody !== migrationWrapperBody) {
    throw new Error('DATABASE_BASELINE_FUNCTION_PATCH_STATE_INVALID:private.validate_eval_work_inquiry_v1:body');
  }

  const validatorArchive = readSql('archive_migrations', validatorArchiveName);
  const archivedDefinitions = sqlStatements(validatorArchive).filter(statement =>
    parseFunctionCreation(statement) === 'private.validate_eval_work_inquiry_v1'
      && /\bp_inquiry\s+jsonb\s*,\s*p_itemcode\s+text\s*,\s*p_context_rows\s+jsonb\b/i.test(statement));
  if (archivedDefinitions.length !== 1
      || /reclass-action-workflow-v4-split-moves-20261006|validate_eval_work_inquiry_legacy_v1/i.test(archivedDefinitions[0])) {
    throw new Error(`DATABASE_BASELINE_FUNCTION_PATCH_PROVENANCE_INVALID:${validatorArchiveName}:validator`);
  }
  validator.definition = archivedDefinitions[0].trim();
  return restored;
}

/** Render one captured project's complete metadata as a standalone schema migration. */
export function renderStandaloneCatalog(catalog) {
  if (catalog.types?.length) throw new Error('DATABASE_PRIVATE_CUSTOM_TYPES_REQUIRE_REPLAY');
  if (catalog.functions.some(fn => fn.sensitiveLiteral || !fn.definition)) throw new Error('DATABASE_CATALOG_SENSITIVE_DEFINITION');
  const before = ['SET check_function_bodies = false;'];
  const after = [];
  for (const schema of catalog.schemas || []) {
    before.push(`CREATE SCHEMA IF NOT EXISTS ${q(schema.name)};`, grants('SCHEMA', q(schema.name), schema.owner, schema.acl));
  }
  for (const extension of catalog.extensions || []) {
    if (extension.name !== 'plpgsql') before.push(...extensionSetup(extension));
  }
  for (const row of catalog.relations || []) {
    if (row.kind === 'S') {
      const statement = sequence(row);
      if (!row.sequence.identity) before.push(statement);
    }
    if (!['r', 'p', 'S', 'v', 'm'].includes(row.kind)) throw new Error(`DATABASE_RELATION_KIND_UNSUPPORTED:${row.kind}`);
  }
  for (const row of catalog.relations.filter(row => ['r', 'p'].includes(row.kind))) {
    before.push(table(row));
    for (const constraint of row.constraints || []) {
      const statement = `ALTER TABLE ${qualified(row)} ADD CONSTRAINT ${q(constraint.name)} ${constraint.definition};`;
      (['p', 'u'].includes(constraint.kind) ? before : after).push(statement);
    }
    if (row.rls) before.push(`ALTER TABLE ${qualified(row)} ENABLE ROW LEVEL SECURITY;`);
    if (row.forceRls) before.push(`ALTER TABLE ${qualified(row)} FORCE ROW LEVEL SECURITY;`);
    for (const column of row.columns) if (column.default && !column.identity && !column.generated) after.push(`ALTER TABLE ${qualified(row)} ALTER COLUMN ${q(column.name)} SET DEFAULT ${column.default};`);
    for (const index of row.indexes || []) after.push(end(index));
    for (const trigger of row.triggers || []) after.push(end(trigger));
    for (const policy of row.policies || []) {
      const command = { '*': 'ALL', r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE' }[policy.command];
      if (!command) throw new Error('DATABASE_POLICY_COMMAND_INVALID');
      after.push(`CREATE POLICY ${q(policy.name)} ON ${qualified(row)} AS ${policy.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${command} TO ${policy.roles.map(role => role === 'PUBLIC' ? 'PUBLIC' : q(role)).join(',')}${policy.using ? ` USING (${policy.using})` : ''}${policy.check ? ` WITH CHECK (${policy.check})` : ''};`);
    }
  }
  const output = [...before];
  for (const fn of catalog.functions) output.push(end(fn.definition), grants('FUNCTION', `${qualified(fn)}(${fn.identityArgs})`, fn.owner, fn.acl));
  for (const row of catalog.relations) {
    if (row.kind === 'v') {
      if (!row.view) throw new Error(`DATABASE_VIEW_DEFINITION_MISSING:${row.schema}.${row.name}`);
      output.push(`CREATE VIEW ${qualified(row)}${row.options?.length ? ` WITH (${row.options.join(',')})` : ''} AS ${end(row.view)}`);
    }
    if (row.kind === 'm') {
      if (!row.view) throw new Error(`DATABASE_VIEW_DEFINITION_MISSING:${row.schema}.${row.name}`);
      output.push(`CREATE MATERIALIZED VIEW ${qualified(row)} AS ${end(row.view)}`);
    }
    if (row.kind === 'S' && !row.sequence.identity && row.sequence.ownedBy) output.push(`ALTER SEQUENCE ${qualified(row)} OWNED BY ${row.sequence.ownedBy};`);
    output.push(grants(row.kind === 'S' ? 'SEQUENCE' : 'TABLE', qualified(row), row.owner, row.acl));
  }
  output.push(...after, 'RESET check_function_bodies;');
  return `${output.join('\n')}\n`;
}

/**
 * Augment the immutable public dump with its omitted private schema objects.
 * The capture contains schema metadata only. Public migration bodies are kept
 * intact; private routines wait until their public composite types exist.
 */
export function augmentPublicBaseline(source, { root = repoRoot } = {}) {
  const captured = JSON.parse(readFileSync(path.join(root, 'supabase/schema/baseline-private.catalog.json'), 'utf8'));
  const { catalog: triggerFiltered } = filterPostBaselineTriggers(captured, source, { root });
  const catalog = restoreBaselineFunctionBodies(triggerFiltered, { root });
  if (catalog.types?.length) throw new Error('DATABASE_PRIVATE_CUSTOM_TYPES_REQUIRE_REPLAY');
  if (catalog.functions.some(fn => fn.sensitiveLiteral || !fn.definition)) throw new Error('DATABASE_CATALOG_SENSITIVE_DEFINITION');
  const before = ['SET check_function_bodies = false;'];
  const after = [];
  for (const schema of catalog.schemas) {
    before.push(`CREATE SCHEMA IF NOT EXISTS ${q(schema.name)};`, grants('SCHEMA', q(schema.name), schema.owner, schema.acl));
  }
  for (const extension of catalog.extensions) {
    if (extension.name !== 'plpgsql') before.push(...extensionSetup(extension));
  }
  for (const row of catalog.relations) {
    if (row.kind === 'S') {
      const statement = sequence(row);
      if (!row.sequence.identity) before.push(statement);
    }
    if (!['r', 'S', 'v'].includes(row.kind)) throw new Error(`DATABASE_RELATION_KIND_UNSUPPORTED:${row.kind}`);
  }
  for (const row of catalog.relations.filter(row => row.kind === 'r')) {
    before.push(table(row));
    for (const constraint of row.constraints || []) {
      const sql = `ALTER TABLE ${qualified(row)} ADD CONSTRAINT ${q(constraint.name)} ${constraint.definition};`;
      (['p', 'u'].includes(constraint.kind) ? before : after).push(sql);
    }
    if (row.rls) before.push(`ALTER TABLE ${qualified(row)} ENABLE ROW LEVEL SECURITY;`);
    if (row.forceRls) before.push(`ALTER TABLE ${qualified(row)} FORCE ROW LEVEL SECURITY;`);
    for (const column of row.columns) if (column.default && !column.identity && !column.generated) after.push(`ALTER TABLE ${qualified(row)} ALTER COLUMN ${q(column.name)} SET DEFAULT ${column.default};`);
    for (const index of row.indexes || []) after.push(end(index));
    for (const trigger of row.triggers || []) after.push(end(trigger));
    for (const policy of row.policies || []) {
      const command = { '*': 'ALL', r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE' }[policy.command];
      if (!command) throw new Error('DATABASE_POLICY_COMMAND_INVALID');
      after.push(`CREATE POLICY ${q(policy.name)} ON ${qualified(row)} AS ${policy.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${command} TO ${policy.roles.map(role => role === 'PUBLIC' ? 'PUBLIC' : q(role)).join(',')}${policy.using ? ` USING (${policy.using})` : ''}${policy.check ? ` WITH CHECK (${policy.check})` : ''};`);
    }
  }
  for (const row of catalog.relations) {
    if (row.kind === 'v') after.push(`CREATE VIEW ${qualified(row)}${row.options?.length ? ` WITH (${row.options.join(',')})` : ''} AS ${end(row.view)}`);
    if (row.kind === 'S' && !row.sequence.identity && row.sequence.ownedBy) after.push(`ALTER SEQUENCE ${qualified(row)} OWNED BY ${row.sequence.ownedBy};`);
    after.push(grants(row.kind === 'S' ? 'SEQUENCE' : 'TABLE', qualified(row), row.owner, row.acl));
  }
  const pending = [...catalog.functions];
  const publicTypes = new Set();
  const output = [...before];
  function installFunctions() {
    for (let i = 0; i < pending.length;) {
      const fn = pending[i];
      if ((fn.publicTypes || []).every(type => publicTypes.has(type))) {
        output.push(end(fn.definition), grants('FUNCTION', `${qualified(fn)}(${fn.identityArgs})`, fn.owner, fn.acl));
        pending.splice(i, 1);
      } else i++;
    }
  }
  installFunctions();
  for (const statement of sqlStatements(source)) {
    output.push(statement);
    const created = statement.match(/\bCREATE TABLE public\.(\w+)\s*\(/);
    if (created) { publicTypes.add(created[1]); installFunctions(); }
  }
  if (pending.length) throw new Error(`DATABASE_PRIVATE_PUBLIC_TYPES_MISSING:${pending.map(fn => `${fn.schema}.${fn.name}:${fn.publicTypes}`).join(',')}`);
  return { baseline: output.join('\n'), postlude: after.join('\n') + '\nRESET check_function_bodies;\n' };
}
