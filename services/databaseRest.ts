import type { Database } from '../supabase/functions/_shared/database.types.ts';
import { contracts } from './database-contracts.generated.ts';
import { validateSchema, type Schema } from './database-contract-runtime.ts';

type Table = keyof Database['public']['Tables'] | keyof Database['public']['Views'];
type Rpc = keyof Database['public']['Functions'];
export type FetchWithTimeout = (url: string, init: RequestInit, timeout: number, label: string) => Promise<Response>;
const has = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
export function tableName(input: unknown): Table {
  if (typeof input !== 'string' || !has(contracts.tables, input)) throw new Error('Unknown database table. Refresh the application before retrying.');
  return input as Table;
}
export function rpcName(input: unknown): Rpc {
  if (typeof input !== 'string' || !has(contracts.functions, input)) throw new Error('Unknown database operation. Refresh the application before retrying.');
  return input as Rpc;
}
// app-api has a compatibility fallback for older v2_* relation names. Keep it
// finite and schema-derived; browser callers do not receive this alias map.
export const legacyDatabaseTableAliases = Object.freeze(Object.fromEntries(
  Object.keys(contracts.tables).filter(name => name.startsWith('ph_'))
    .map(name => [`v2_${name.slice(3)}`, name]),
) as Record<string, Table>);
function rowSchema(table: Table) {
  const schema = contracts.tables[table].row;
  if (typeof schema !== 'object' || !('object' in schema)) throw new Error('Invalid generated table contract.');
  return schema.object;
}
function column(table: Table, expression: string) {
  // PostgREST JSON paths and casts address a physical root column.
  const name = expression.trim().replace(/^"|"$/g, '').split(/->|::/)[0];
  if (!has(rowSchema(table), name)) throw new Error(`Unknown ${table} column: ${name}`);
}
export function validateQuery(table: Table, input: unknown): string {
  if (typeof input !== 'string') throw new Error('Database filters must be a query string.');
  const params = new URLSearchParams(input.replace(/^\?/, ''));
  for (const [key, value] of params) {
    if (key === 'select') {
      for (const entry of value.split(',')) {
        if (entry === '*') continue;
        // Existing legacy readers use physical columns/aliases only. Relational
        // embedding belongs in a fixed typed Supabase reader, not this bridge.
        if (/[()!]/.test(entry)) throw new Error('Use a typed reader for relational projections.');
        column(table, entry.replace(/^[a-zA-Z_][a-zA-Z0-9_]*:(?!:)/, ''));
      }
    } else if (key === 'order') {
      for (const entry of value.split(',')) column(table, entry.split('.')[0]);
    } else if (key === 'or' || key === 'and') {
      // Operators and values retain PostgREST's own parser. Validate every
      // referenced column while allowing quoted values and in(...) lists.
      const fields = value.matchAll(/(?:^|[,(])\s*(?:not\.)?([A-Za-z_][A-Za-z0-9_]*)(?:->>?[^.(),]+)?\.(?:not\.)?(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov|sl|sr|nxr|nxl|adj|fts|plfts|phfts|wfts)\./g);
      for (const field of fields) column(table, field[1]);
    } else if (key === 'limit' || key === 'offset') {
      if (!/^\d+$/.test(value)) throw new Error(`Invalid ${key}.`);
    } else if (key === 'on_conflict' || key === 'columns') {
      for (const name of value.split(',')) column(table, name);
    } else column(table, key);
  }
  return params.toString();
}
function requestBody(input: RequestInit['body']): unknown {
  if (input == null || input === '') return {};
  if (typeof input !== 'string') throw new Error('Database writes require a JSON body.');
  return JSON.parse(input);
}
function validateRows(schema: Schema, input: unknown, label: string) {
  for (const row of Array.isArray(input) ? input : [input]) validateSchema(schema, row, label);
}
function selectedColumn(table: Table, entry: string) {
  const colon = entry.indexOf(':');
  const hasAlias = colon > 0 && entry[colon + 1] !== ':';
  const alias = hasAlias ? entry.slice(0, colon) : undefined;
  const expression = hasAlias ? entry.slice(colon + 1) : entry;
  column(table, expression);
  const root = expression.split(/->|::/)[0].trim().replace(/^"|"$/g, '');
  const jsonPath = expression.match(/->>?([^>]+)$/);
  const outputName = alias || (jsonPath ? jsonPath[1].replace(/^"|"$/g, '') : root);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(outputName)) throw new Error('Unsupported database projection alias.');
  let schema = rowSchema(table)[root].schema;
  if (jsonPath) schema = expression.includes('->>') ? { oneOf: ['string', 'null'] } : 'json';
  else if (expression.includes('::')) schema = 'json';
  return [outputName, schema] as const;
}
function tableResponseSchema(table: Table, query: string): Schema {
  const params = new URLSearchParams(query);
  const select = params.get('select');
  if (!select) return { object: rowSchema(table) };
  const projected: Record<string, { schema: Schema }> = {};
  for (const entry of select.split(',')) {
    if (entry === '*') {
      Object.assign(projected, rowSchema(table));
      continue;
    }
    const [name, schema] = selectedColumn(table, entry);
    if (has(projected, name)) throw new Error(`Duplicate ${table} projection field: ${name}`);
    projected[name] = { schema };
  }
  return { object: projected };
}
async function validateSuccessfulJson(response: Response, schema: Schema, label: string, method: string) {
  if (!response.ok || method === 'HEAD' || response.status === 204) return response;
  const body = await response.clone().text();
  if (!body.trim()) return response;
  let parsed: unknown;
  try { parsed = JSON.parse(body); }
  catch { throw new Error(`Invalid ${label}: successful response was not valid JSON.`); }
  if (schema && typeof schema === 'object' && 'object' in schema && Array.isArray(parsed)) {
    for (const row of parsed) validateSchema(schema, row, `${label} response`);
  } else validateSchema(schema, parsed, `${label} response`);
  return response;
}
export function tableRequest<T extends Table>(table: T, query: string, init: RequestInit) {
  const checkedQuery = validateQuery(table, query);
  const method = String(init.method || 'GET').toUpperCase();
  if (contracts.tables[table].insert === 'never' && !['GET', 'HEAD'].includes(method)) throw new Error('Database views are read-only.');
  if (method === 'POST' || method === 'PATCH') validateRows(contracts.tables[table][method === 'POST' ? 'insert' : 'update'], requestBody(init.body), `${table} ${method}`);
  else if (!['GET', 'HEAD', 'DELETE'].includes(method)) throw new Error('Unsupported database method.');
  return checkedQuery;
}
export function createDatabaseRestBridge(fetcher: FetchWithTimeout, aliases: Readonly<Record<string, Table>> = {}) {
  return {
    async fetchTable(baseUrl: string, inputTable: unknown, inputQuery: unknown, init: RequestInit, timeout: number, label: string) {
      const isAlias = typeof inputTable === 'string' && !has(contracts.tables, inputTable) && has(aliases, inputTable);
      const table = isAlias ? tableName(aliases[inputTable as string]) : tableName(inputTable);
      const transportTable = isAlias ? inputTable as string : table;
      if (typeof inputQuery !== 'string') throw new Error('Invalid database query.');
      const query = tableRequest(table, inputQuery, init);
      const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/rest/v1/${transportTable}${query ? '?' + query : ''}`, init, timeout, label);
      return validateSuccessfulJson(response, tableResponseSchema(table, query), `${table} table`, String(init.method || 'GET').toUpperCase());
    },
    async fetchRpc(baseUrl: string, inputName: unknown, init: RequestInit, timeout: number, label: string) {
      const name = rpcName(inputName);
      validateSchema(contracts.functions[name], requestBody(init.body), `${name} arguments`);
      const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/rest/v1/rpc/${name}`, init, timeout, label);
      return validateSuccessfulJson(response, contracts.functionReturns[name], `${name} RPC`, String(init.method || 'POST').toUpperCase());
    },
  };
}
