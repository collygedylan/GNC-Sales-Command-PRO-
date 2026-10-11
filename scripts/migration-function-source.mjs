import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sqlStatements } from './database-catalog.mjs';
import { repoRoot } from './tooling-process.mjs';

const identifier = '(?:"((?:""|[^"])*)"|([A-Za-z_][A-Za-z_0-9$]*))';

function decodeIdentifier(match) {
  return match[1] !== undefined ? match[1].replaceAll('""', '"') : match[2].toLowerCase();
}

function leadingSql(source) {
  return source.replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)+/, '');
}

function readQualifiedFunctionHeader(statement) {
  const sql = leadingSql(statement);
  const prefix = /^create\s+(?:or\s+replace\s+)?function\b/i.exec(sql);
  if (!prefix) return null;
  let cursor = prefix[0].length;
  const readIdentifier = () => {
    while (/\s/.test(sql[cursor] || '')) cursor++;
    const match = new RegExp(`^${identifier}`).exec(sql.slice(cursor));
    if (!match) return null;
    cursor += match[0].length;
    return decodeIdentifier(match);
  };
  const schema = readIdentifier();
  while (/\s/.test(sql[cursor] || '')) cursor++;
  if (!schema || sql[cursor] !== '.') return null;
  cursor++;
  const name = readIdentifier();
  while (/\s/.test(sql[cursor] || '')) cursor++;
  if (!name || sql[cursor] !== '(') return null;
  const open = cursor++;
  let depth = 1, quote = '', dollar = '', escaped = false;
  for (; cursor < sql.length; cursor++) {
    const char = sql[cursor], next = sql[cursor + 1];
    if (dollar) {
      if (sql.startsWith(dollar, cursor)) { cursor += dollar.length - 1; dollar = ''; }
      continue;
    }
    if (quote) {
      if (escaped && char === '\\') { cursor++; continue; }
      if (char === quote) {
        if (next === quote) cursor++;
        else quote = '';
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      escaped = char === "'" && /(?:^|\W)e$/i.test(sql.slice(Math.max(0, cursor - 2), cursor));
    } else if (char === '$') {
      const match = sql.slice(cursor).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
      if (match) { dollar = match[0]; cursor += dollar.length - 1; }
    } else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) {
      return { sql, schema, name, argumentsSql: sql.slice(open + 1, cursor) };
    }
  }
  throw new Error('MIGRATION_FUNCTION_ARGUMENT_LIST_UNTERMINATED');
}

function splitArguments(source) {
  const values = [];
  let start = 0, depth = 0, quote = '', dollar = '', escaped = false;
  for (let cursor = 0; cursor < source.length; cursor++) {
    const char = source[cursor], next = source[cursor + 1];
    if (dollar) {
      if (source.startsWith(dollar, cursor)) { cursor += dollar.length - 1; dollar = ''; }
      continue;
    }
    if (quote) {
      if (escaped && char === '\\') { cursor++; continue; }
      if (char === quote) {
        if (next === quote) cursor++;
        else quote = '';
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      escaped = char === "'" && /(?:^|\W)e$/i.test(source.slice(Math.max(0, cursor - 2), cursor));
    } else if (char === '$') {
      const match = source.slice(cursor).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
      if (match) { dollar = match[0]; cursor += dollar.length - 1; }
    } else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      values.push(source.slice(start, cursor).trim());
      start = cursor + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) values.push(tail);
  return values;
}

function argumentType(declaration) {
  const withoutDefault = declaration
    .replace(/\s+(?:default|=)\s+[\s\S]*$/i, '')
    .replace(/^\s*(?:inout|in|out|variadic)\s+/i, '')
    .trim();
  const match = withoutDefault.match(/^(?:"(?:""|[^"])*"|[A-Za-z_][A-Za-z_0-9$]*)\s+([\s\S]+)$/);
  if (!match) throw new Error('MIGRATION_FUNCTION_ARGUMENT_CONTRACT_UNPARSEABLE');
  return match[1].trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeExpectedType(type) {
  if (typeof type !== 'string' || !type.trim()) throw new Error('MIGRATION_FUNCTION_EXPECTED_SIGNATURE_INVALID');
  return type.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Find the latest exact function signature in ordered active migration sources. */
export function latestMigrationFunctionDefinition({
  root = repoRoot,
  schema,
  name,
  argumentTypes,
  sources,
} = {}) {
  if (typeof schema !== 'string' || !schema || typeof name !== 'string' || !name
      || !Array.isArray(argumentTypes)) {
    throw new Error('MIGRATION_FUNCTION_LOOKUP_INVALID');
  }
  const orderedSources = (sources || readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter(file => /^\d{14}_.+\.sql$/i.test(file))
    .map(file => ({ filename: file, sql: readFileSync(path.join(root, 'supabase', 'migrations', file), 'utf8') })))
    .slice()
    .sort((left, right) => left.filename.localeCompare(right.filename));
  const expectedTypes = argumentTypes.map(normalizeExpectedType);
  let latestFilename = '';
  let latestDefinitions = [];
  for (const source of orderedSources) {
    if (!source || typeof source.filename !== 'string' || typeof source.sql !== 'string') {
      throw new Error('MIGRATION_FUNCTION_SOURCE_INVALID');
    }
    const definitions = [];
    for (const statement of sqlStatements(source.sql)) {
      const header = readQualifiedFunctionHeader(statement);
      if (!header || header.schema !== schema || header.name !== name) continue;
      const actualTypes = splitArguments(header.argumentsSql).map(argumentType);
      if (actualTypes.length === expectedTypes.length
          && actualTypes.every((type, index) => type === expectedTypes[index])) {
        definitions.push(statement.trim());
      }
    }
    if (definitions.length) {
      latestFilename = source.filename;
      latestDefinitions = definitions;
    }
  }
  if (!latestDefinitions.length) throw new Error(`MIGRATION_FUNCTION_DEFINITION_NOT_FOUND:${schema}.${name}`);
  if (latestDefinitions.length !== 1) throw new Error(`MIGRATION_FUNCTION_DEFINITION_AMBIGUOUS:${latestFilename}:${schema}.${name}`);
  return `${latestDefinitions[0].replace(/;?\s*$/, ';')}\n`;
}
