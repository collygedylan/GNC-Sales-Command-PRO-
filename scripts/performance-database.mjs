#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { benchmarkMetricLimit, parseBenchmarkManifest, parseSqlSchemaExtensions, percentile } from '../services/performanceBaseline.ts';
import {
  INVENTORY_MASTER_BROWSE_FIELDS,
  INVENTORY_MASTER_FULL_FIELDS,
  projectInventoryRows,
} from '../supabase/functions/_shared/inventory-projections.ts';
import { jsonObject, jsonValue } from '../services/database-contract-runtime.ts';
import { inspectDisposableSupabaseWorkspace } from './disposable-supabase-container.mjs';
import { createApiSampleDiagnostics } from './performance-api-sample-diagnostics.mjs';
import { parseAppServerTimingDuration } from './performance-function-sample-correlation.mjs';
import { assertPerformanceFunctionPolicy, PERFORMANCE_API_FUNCTION_POLICY } from './performance-function-policy.mjs';
import { packageBin, repoRoot, run, runNode } from './tooling-process.mjs';

const MAX_SYNTHETIC_ROWS = 100_000;
const INITIAL_SYNTHETIC_ROWS = 10_000;
const API_LIMIT = 500;
const SQL_BENCHMARK_SAMPLES = 30;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const FIXTURE_PREFIX = 'PERF-QUE-DRIVE-V1';
const FIXTURE_TIMESTAMP = '2026-10-08T16:00:00Z';
// Exact live v2 Drive card projection from v2/src/services/api.ts. This is a
// physical-read proxy against the canonical schema; it does not model sandbox RLS.
export const BETA_DRIVE_CARD_FIELDS = [
  'unique_id', 'itemcode', 'commonname', 'contsize', 'locationcode', 'lotcode',
  'ptravailable', 'ptronhand', 'ptrreviewed', 'priority', 'season', 'season_supply',
  'saleyear', 'blockalpha', 'blocknumber', 'holdstopcode', 'photo_link', 'photo_name',
].join(',');
const manifestPath = path.join(repoRoot, 'performance', 'baseline.json');
const manifest = parseBenchmarkManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
const schemaExtensions = parseSqlSchemaExtensions(JSON.parse(readFileSync(path.join(repoRoot, 'performance', 'sql-schema-extensions.json'), 'utf8')));
const errorCode = code => Object.assign(new Error(code), { code });

function normalizeSourceText(value) {
  return String(value).replace(/\r\n?/g, '\n');
}

function listSqlFiles(directory, repositoryRoot) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw errorCode('PERFORMANCE_PINNED_SQL_MIGRATION_SYMLINK');
    if (entry.isDirectory()) files.push(...listSqlFiles(absolute, repositoryRoot));
    else if (entry.isFile() && entry.name.endsWith('.sql')) {
      files.push(path.relative(repositoryRoot, absolute).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function sqlSourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const marker = source.indexOf(endMarker, start);
  if (start < 0 || marker < 0) throw errorCode('PERFORMANCE_PINNED_SQL_READER_MARKER_MISSING');
  const lineEnd = source.indexOf('\n', marker);
  return source.slice(start, lineEnd < 0 ? source.length : lineEnd);
}

function removeOldProjectorDefinition(source) {
  const pattern = /^[ \t]*function projectInventoryRows\(rows: unknown, fields: string\): Json\[\] \{\r?\n[\s\S]*?^[ \t]*\}(?:\r?\n[ \t]*){1,2}/gm;
  const matches = [...source.matchAll(pattern)];
  if (matches.length > 1) throw errorCode('PERFORMANCE_PINNED_SQL_PROJECTOR_CONTRACT_INVALID');
  return { source: source.replace(pattern, ''), removed: matches.length };
}

function stripAppVersionLine(source) {
  const pattern = /^export const APP_VERSION = '[^'\r\n]+';\r?$/gm;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw errorCode('PERFORMANCE_PINNED_BETA_API_VERSION_MARKER_INVALID');
  return source.replace(pattern, '');
}

/** Fail closed unless the SQL benchmark's pinned database and readers are unchanged. */
export function assertPinnedSqlContract({ root = repoRoot, baselineCommit = manifest.baselineCommit,
  sqlSchemaCommit = manifest.sqlSchemaCommit, sqlSchemaExtensions = schemaExtensions, execute = run } = {}) {
  if (!/^[a-f0-9]{40}$/.test(String(baselineCommit)) || !/^[a-f0-9]{40}$/.test(String(sqlSchemaCommit))) {
    throw errorCode('PERFORMANCE_PINNED_SQL_BASELINE_INVALID');
  }
  const baselinePaths = execute('git', ['ls-tree', '-r', '-z', '--name-only', baselineCommit, '--', 'supabase/migrations'], { root, capture: true })
    .split('\0').filter(Boolean).sort();
  const schemaPaths = execute('git', ['ls-tree', '-r', '-z', '--name-only', sqlSchemaCommit, '--', 'supabase/migrations'], { root, capture: true })
    .split('\0').filter(Boolean).sort();
  const currentPaths = listSqlFiles(path.join(root, 'supabase/migrations'), root);
  const priorPaths = baselinePaths.map(file => [file, execute('git', ['rev-parse', `${baselineCommit}:${file}`], { root, capture: true }).trim()]);
  const schemaHashes = schemaPaths.map(file => [file, execute('git', ['rev-parse', `${sqlSchemaCommit}:${file}`], { root, capture: true }).trim()]);
  // Explicit blob pins allow a reviewed additive migration in the same candidate
  // that introduces it. They never repin prior migrations, readers, or budgets.
  for (const extension of sqlSchemaExtensions) {
    if (schemaPaths.includes(extension.path) || extension.path <= schemaPaths.at(-1)) {
      throw errorCode('PERFORMANCE_SCHEMA_EXTENSION_INVALID');
    }
    schemaPaths.push(extension.path);
    schemaHashes.push([extension.path, extension.gitBlob]);
  }
  const currentHashes = currentPaths.map(file => [file,
    // --path applies Git's clean filters so Windows checkout line endings map to the pinned blob.
    execute('git', ['hash-object', `--path=${file}`, '--', file], { root, capture: true }).trim()]);
  assertApprovedSqlSchemaExtension(baselinePaths, schemaPaths, currentPaths, priorPaths, schemaHashes, currentHashes);

  const baselineAppApi = normalizeSourceText(execute('git', ['show', `${baselineCommit}:supabase/functions/app-api/index.ts`], { root, capture: true }));
  const currentAppApi = normalizeSourceText(readFileSync(path.join(root, 'supabase/functions/app-api/index.ts'), 'utf8'));
  const baselineBetaApi = normalizeSourceText(execute('git', ['show', `${baselineCommit}:v2/src/services/api.ts`], { root, capture: true }));
  const currentBetaApi = normalizeSourceText(readFileSync(path.join(root, 'v2/src/services/api.ts'), 'utf8'));
  const readerDigests = assertPinnedReaderTextContract({ baselineAppApi, currentAppApi, baselineBetaApi, currentBetaApi });
  return {
    baselineCommit,
    sqlSchemaCommit,
    sqlSchemaExtensions,
    migrationCount: currentPaths.length,
    migrationDigest: createHash('sha256').update(JSON.stringify(schemaHashes)).digest('hex'),
    ...readerDigests,
    comparison: 'pinned readers and explicit schema pins verified; timing is shared-control only',
  };
}

/** Permit only reviewed additive migrations while requiring all old blobs and the pinned schema to match exactly. */
export function assertApprovedSqlSchemaExtension(baselinePaths, schemaPaths, currentPaths, baselineHashes, schemaHashes, currentHashes) {
  const normalize = value => Array.isArray(value) ? value.slice().sort() : [];
  const previous = normalize(baselinePaths), pinned = normalize(schemaPaths), current = normalize(currentPaths);
  if (!Array.isArray(baselinePaths) || !Array.isArray(schemaPaths) || !Array.isArray(currentPaths)
      || new Set(previous).size !== previous.length || new Set(pinned).size !== pinned.length
      || new Set(current).size !== current.length || previous.some(file => !pinned.includes(file))
      || JSON.stringify(pinned) !== JSON.stringify(current)) {
    throw errorCode('PERFORMANCE_PINNED_SQL_MIGRATION_SET_CHANGED');
  }
  const mapHashes = (entries, expected) => {
    if (!Array.isArray(entries) || entries.length !== expected.length) throw errorCode('PERFORMANCE_PINNED_SQL_MIGRATION_CONTENT_CHANGED');
    const result = new Map(entries);
    if (result.size !== expected.length || expected.some(file => !/^[a-f0-9]{40}$/.test(String(result.get(file) || '')))) {
      throw errorCode('PERFORMANCE_PINNED_SQL_MIGRATION_CONTENT_CHANGED');
    }
    return result;
  };
  const previousByPath = mapHashes(baselineHashes, previous);
  const pinnedByPath = mapHashes(schemaHashes, pinned);
  const currentByPath = mapHashes(currentHashes, current);
  if (previous.some(file => previousByPath.get(file) !== pinnedByPath.get(file))
      || pinned.some(file => pinnedByPath.get(file) !== currentByPath.get(file))) {
    throw errorCode('PERFORMANCE_PINNED_SQL_MIGRATION_CONTENT_CHANGED');
  }
  return true;
}

export function assertSamePinnedMigrationSnapshot(baselinePaths, currentPaths, baselineHashes, currentHashes) {
  const normalizePaths = value => Array.isArray(value) ? value.slice().sort() : [];
  const expectedPaths = normalizePaths(baselinePaths);
  if (!Array.isArray(baselinePaths) || !Array.isArray(currentPaths)
      || new Set(expectedPaths).size !== expectedPaths.length
      || JSON.stringify(expectedPaths) !== JSON.stringify(normalizePaths(currentPaths))) {
    throw errorCode('PERFORMANCE_PINNED_SQL_MIGRATION_SET_CHANGED');
  }
  const baselineHashPaths = Array.isArray(baselineHashes) ? baselineHashes.map(([file]) => file) : [];
  const currentHashPaths = Array.isArray(currentHashes) ? currentHashes.map(([file]) => file) : [];
  if (!Array.isArray(baselineHashes) || !Array.isArray(currentHashes)
      || baselineHashes.length !== expectedPaths.length || currentHashes.length !== expectedPaths.length
      || new Set(baselineHashPaths).size !== baselineHashPaths.length || new Set(currentHashPaths).size !== currentHashPaths.length
      || JSON.stringify(expectedPaths) !== JSON.stringify(normalizePaths(baselineHashPaths))
      || JSON.stringify(expectedPaths) !== JSON.stringify(normalizePaths(currentHashPaths))) {
    throw errorCode('PERFORMANCE_PINNED_SQL_MIGRATION_CONTENT_CHANGED');
  }
  const currentByPath = new Map(currentHashes);
  if (baselineHashes.some(([file, hash]) => !/^[a-f0-9]{40}$/.test(String(hash))
      || !/^[a-f0-9]{40}$/.test(String(currentByPath.get(file) || '')) || currentByPath.get(file) !== hash)) {
    throw errorCode('PERFORMANCE_PINNED_SQL_MIGRATION_CONTENT_CHANGED');
  }
  return true;
}

export function assertPinnedReaderTextContract({ baselineAppApi, currentAppApi, baselineBetaApi, currentBetaApi }) {
  const readerStart = 'function inventoryReadParams(';
  const readerEnd = 'const AURA_V2_OPERATIONS =';
  const baselineReader = removeOldProjectorDefinition(sqlSourceSlice(normalizeSourceText(baselineAppApi), readerStart, readerEnd));
  const currentReader = removeOldProjectorDefinition(sqlSourceSlice(normalizeSourceText(currentAppApi), readerStart, readerEnd));
  if (baselineReader.removed !== 1 || currentReader.removed !== 0 || baselineReader.source !== currentReader.source) {
    throw errorCode('PERFORMANCE_PINNED_SQL_INVENTORY_READER_CHANGED');
  }
  const normalizedBaselineBetaApi = stripAppVersionLine(normalizeSourceText(baselineBetaApi));
  const normalizedCurrentBetaApi = stripAppVersionLine(normalizeSourceText(currentBetaApi));
  if (normalizedBaselineBetaApi !== normalizedCurrentBetaApi) throw errorCode('PERFORMANCE_PINNED_SQL_BETA_READER_CHANGED');
  return {
    inventoryReaderDigest: createHash('sha256').update(baselineReader.source).digest('hex'),
    betaReaderDigest: createHash('sha256').update(normalizedBaselineBetaApi).digest('hex'),
  };
}

export function validateLocalBenchmarkUrl(value, protocols, pathname = undefined) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw errorCode('PERFORMANCE_LOCAL_URL_INVALID'); }
  if (!protocols.includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname.replace(/^\[|\]$/g, ''))
      || (pathname !== undefined && url.pathname !== pathname)) throw errorCode('PERFORMANCE_LOCAL_URL_REQUIRED');
  return url;
}

export function inventoryScopeSql(role) {
  if (role === 'admin') return '';
  if (role === 'rep') return "(season IS NULL OR season NOT ILIKE 'U3') AND (lotcode IS NULL OR lotcode NOT ILIKE '%.U3')";
  if (role === 'foreman') return "priority IS NOT NULL AND priority NOT IN ('', '-', '--', '---', 'N/A', 'NA', 'NULL', 'NONE')";
  throw errorCode('PERFORMANCE_ROLE_UNSUPPORTED');
}

export function buildInventoryWhere({ role = 'admin', itemcode = null, since = null, queue = false } = {}) {
  const clauses = [];
  const values = [];
  const scope = inventoryScopeSql(role);
  if (scope) clauses.push(`(${scope})`);
  if (itemcode !== null) {
    if (typeof itemcode !== 'string' || !itemcode.trim()) throw errorCode('PERFORMANCE_ITEMCODE_INVALID');
    values.push(itemcode);
    clauses.push(`itemcode = $${values.length}`);
  }
  if (since !== null) {
    const date = new Date(since);
    if (Number.isNaN(date.valueOf())) throw errorCode('PERFORMANCE_SINCE_INVALID');
    values.push(date.toISOString());
    clauses.push(`last_updated > $${values.length}::timestamptz`);
  }
  if (queue) clauses.push("app_tab_assignment = 'ncr_inventory_recount'");
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

export function buildInventoryPageSql({ fields, role = 'admin', itemcode = null, since = null, queue = false,
  offset = 0, limit = API_LIMIT, queueOrder = false } = {}) {
  if (![INVENTORY_MASTER_BROWSE_FIELDS, INVENTORY_MASTER_FULL_FIELDS, 'unique_id'].includes(fields)) {
    throw errorCode('PERFORMANCE_PROJECTION_INVALID');
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 2_000_000 || !Number.isInteger(limit) || limit < 1 || limit > API_LIMIT) {
    throw errorCode('PERFORMANCE_PAGE_INVALID');
  }
  const where = buildInventoryWhere({ role, itemcode, since, queue });
  const order = queueOrder ? 'ORDER BY last_updated DESC NULLS LAST, unique_id ASC' : 'ORDER BY unique_id ASC';
  return {
    page: `SELECT ${fields} FROM public.ph_master_inventory ${where.sql} ${order} OFFSET ${offset} LIMIT ${limit}`,
    count: `SELECT count(*)::bigint AS total FROM public.ph_master_inventory ${where.sql}`,
    values: where.values,
  };
}

export function validateApiFunctionPolicy(mode, policy) {
  if (mode === 'api' && policy !== PERFORMANCE_API_FUNCTION_POLICY) {
    throw errorCode('PERFORMANCE_API_FUNCTION_POLICY_REQUIRED');
  }
  return mode === 'api' ? PERFORMANCE_API_FUNCTION_POLICY : null;
}

export function buildBetaDrivePageSql({ search = null, offset = 0, limit = 250 } = {}) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 2_000_000
      || !Number.isInteger(limit) || limit < 1 || limit > 250) throw errorCode('PERFORMANCE_PAGE_INVALID');
  const values = [];
  const where = search === null ? '' : (() => {
    if (typeof search !== 'string' || !search.trim() || search.length > 120) throw errorCode('PERFORMANCE_SEARCH_INVALID');
    values.push(`%${search.trim()}%`);
    return `WHERE commonname ILIKE $1 OR itemcode ILIKE $1 OR locationcode ILIKE $1`;
  })();
  return {
    page: `SELECT ${BETA_DRIVE_CARD_FIELDS} FROM public.ph_master_inventory ${where} ORDER BY commonname ASC, unique_id ASC OFFSET ${offset} LIMIT ${limit}`,
    count: `SELECT count(*)::bigint AS total FROM public.ph_master_inventory ${where}`,
    values,
  };
}

export function parseBenchmarkCliArgs(argv) {
  if (!Array.isArray(argv)) throw errorCode('PERFORMANCE_CLI_ARGUMENTS_INVALID');
  const [mode, workspaceRoot, ...tail] = argv;
  let cli;
  for (let index = 0; index < tail.length;) {
    if (tail[index] !== '--cli' || cli || !tail[index + 1] || index + 2 !== tail.length) {
      throw errorCode('PERFORMANCE_CLI_ARGUMENTS_INVALID');
    }
    cli = tail[index + 1];
    index += 2;
  }
  if (!['--sql-workspace', '--api-workspace'].includes(mode) || !workspaceRoot) {
    throw errorCode('PERFORMANCE_CLI_ARGUMENTS_INVALID');
  }
  return { mode, workspaceRoot, cli };
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function withInventoryUserTriggersDisabled(db, work) {
  await db.query('BEGIN');
  try {
    const ownership = await db.query(`SELECT pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c WHERE c.oid='public.ph_master_inventory'::regclass`);
    const current = await db.query('SELECT current_user');
    if (ownership.rows[0]?.owner !== current.rows[0]?.current_user) throw errorCode('PERFORMANCE_FIXTURE_TABLE_OWNER_REQUIRED');
    const triggers = await db.query(`SELECT tgname,tgenabled FROM pg_trigger
      WHERE tgrelid='public.ph_master_inventory'::regclass AND NOT tgisinternal AND tgenabled <> 'D' ORDER BY tgname`);
    for (const trigger of triggers.rows) {
      await db.query(`ALTER TABLE public.ph_master_inventory DISABLE TRIGGER ${quoteIdentifier(trigger.tgname)}`);
    }
    const result = await work();
    for (const trigger of triggers.rows) {
      const state = trigger.tgenabled === 'A' ? 'ALWAYS' : trigger.tgenabled === 'R' ? 'REPLICA' : 'NORMAL';
      if (state === 'NORMAL') await db.query(`ALTER TABLE public.ph_master_inventory ENABLE TRIGGER ${quoteIdentifier(trigger.tgname)}`);
      else await db.query(`ALTER TABLE public.ph_master_inventory ENABLE ${state} TRIGGER ${quoteIdentifier(trigger.tgname)}`);
    }
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function seedInventory(db, prefix, onSeeded) {
  const existing = await db.query('SELECT count(*)::bigint AS total FROM public.ph_master_inventory');
  if (Number(existing.rows[0]?.total) !== 0) throw errorCode('PERFORMANCE_FIXTURE_REQUIRES_EMPTY_INVENTORY');
  await insertInventoryRange(db, prefix, 1, INITIAL_SYNTHETIC_ROWS, onSeeded);
}

async function insertInventoryRange(db, prefix, start, count, onInserted = undefined) {
  await withInventoryUserTriggersDisabled(db, () => db.query({
    text: `INSERT INTO public.ph_master_inventory
      (unique_id,itemcode,commonname,genusname,botanicalname,contsize,locationcode,lotcode,source,
       season,saleyear,priority,ptravailable,ptronhand,app_tab_assignment,last_updated)
      SELECT $1 || '-' || CASE WHEN i <= 10000 THEN '10k-' || lpad(i::text,5,'0')
                               ELSE '100k-' || lpad((i-10000)::text,6,'0') END,
        CASE WHEN i <= 10000 THEN 'PERF10-' || $1 ELSE 'PERF100-' || $1 END,
        'Synthetic performance plant','Performance','Synthetic performance plant','#3','A.' || lpad(i::text,6,'0'),
        CASE WHEN i % 20 = 0 THEN '27.U3' ELSE '27.F1' END,'PH',
        CASE WHEN i % 20 = 0 THEN 'U3' ELSE 'F1' END,'27',
        CASE WHEN i % 5 = 0 THEN '' ELSE 'A' END,'20','20',
        CASE WHEN i % 10 = 0 THEN 'ncr_inventory_recount' ELSE 'inventory' END,
        CASE WHEN i % 1000 = 0 THEN NULL
             ELSE $4::timestamptz - ((i % 7200)::text || ' seconds')::interval END
      FROM generate_series($2::integer,$2::integer + $3::integer - 1) i`,
    values: [prefix, start, count, FIXTURE_TIMESTAMP],
    query_timeout: 180000,
  }));
  onInserted?.();
  await db.query('ANALYZE public.ph_master_inventory');
}

async function cleanupInventory(db, prefix) {
  await withInventoryUserTriggersDisabled(db, () => db.query({
    text: 'DELETE FROM public.ph_master_inventory WHERE unique_id LIKE $1 || \'-%\'',
    values: [prefix],
    query_timeout: 120000,
  }));
}

function metricStore() {
  const metrics = new Map();
  return {
    add(id, kind, value) {
      if (!Number.isFinite(value) || value < 0) throw errorCode('PERFORMANCE_METRIC_INVALID');
      const prior = metrics.get(id);
      if (prior && prior.kind !== kind) throw errorCode('PERFORMANCE_METRIC_KIND_MISMATCH');
      (prior || (metrics.set(id, { id, kind, samples: [] }), metrics.get(id))).samples.push(value);
    },
    list() { return [...metrics.values()]; },
  };
}

function flattenPlan(plan, nodes = []) {
  if (!plan || typeof plan !== 'object') return nodes;
  nodes.push({ nodeType: plan['Node Type'] || null, indexName: plan['Index Name'] || null,
    relationName: plan['Relation Name'] || null, actualRows: plan['Actual Rows'] ?? null,
    sharedHitBlocks: plan['Shared Hit Blocks'] ?? 0, sharedReadBlocks: plan['Shared Read Blocks'] ?? 0 });
  for (const child of plan.Plans || []) flattenPlan(child, nodes);
  return nodes;
}

function baselineProjectInventoryRows(rows, fields) {
  if (!Array.isArray(rows)) return [];
  const allowed = fields === '*' ? null : new Set(fields.split(',').map(field => field.trim()).filter(Boolean));
  return rows.map(row => {
    const value = jsonObject(jsonValue(row));
    return allowed ? Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key))) : value;
  });
}

function createProjectionRows(count, fields) {
  const columns = fields.split(',');
  return Array.from({ length: count }, (_, index) => Object.fromEntries(columns.map(column => [column,
    column === 'unique_id' ? `PERF-PROJECT-${index}`
      : column === 'itemcode' ? `PERF-${index % 997}`
        : column === 'last_updated' ? '2026-10-08T12:00:00Z'
          : column === 'ptravailable' ? String(index % 40)
            : column === 'season' ? index % 20 === 0 ? 'U3' : 'F1'
              : column === 'priority' && index % 5 === 0 ? null
                : `synthetic-${column}-${index % 13}`,
  ])));
}

function measureProjectionPair(metrics, evidence, fields, projectionName) {
  const size = API_LIMIT;
  const rows = createProjectionRows(size, fields);
  const expected = baselineProjectInventoryRows(rows, fields);
  const actual = projectInventoryRows(rows, fields);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw errorCode('PERFORMANCE_PROJECTOR_SEMANTICS_MISMATCH');
  const sampleCount = manifest.coldSamples + manifest.warmSamples;
  const baselineId = `projector.${projectionName}.baseline_ms`;
  const candidateId = `projector.${projectionName}.candidate_ms`;
  const digest = createHash('sha256').update(JSON.stringify(actual)).digest('hex');
  for (let index = 0; index < sampleCount; index += 1) {
    const order = index % 2 === 0 ? [
      ['baseline', baselineProjectInventoryRows], ['candidate', projectInventoryRows],
    ] : [
      ['candidate', projectInventoryRows], ['baseline', baselineProjectInventoryRows],
    ];
    for (const [label, projector] of order) {
      const started = performance.now();
      const result = projector(rows, fields);
      metrics.add(label === 'baseline' ? baselineId : candidateId, 'duration', performance.now() - started);
      if (result.length !== size || Object.keys(result[0] || {}).length !== Object.keys(expected[0] || {}).length) {
        throw errorCode('PERFORMANCE_PROJECTOR_OUTPUT_INVALID');
      }
    }
  }
  evidence.push({ scenario: `projector.${projectionName}`, inputRows: size, inputColumns: Object.keys(rows[0] || {}).length,
    selectedFields: fields.split(',').length, outputRows: actual.length, outputBytes: Buffer.byteLength(JSON.stringify(actual)),
    outputSha256: digest, sampleCount, comparison: 'baseline-current-main-filter-map-vs-candidate-single-pass' });
}

function readStatusValues(status) {
  const values = {};
  for (const line of String(status).split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return values;
}

export function readTomlInteger(configText, sectionName, keyName) {
  let section = '';
  for (const line of String(configText).split(/\r?\n/)) {
    const header = line.match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
    if (header) { section = header[1]; continue; }
    if (section !== sectionName) continue;
    const value = line.match(new RegExp(`^${keyName}\\s*=\\s*(\\d+)\\s*(?:#.*)?$`));
    if (value) return Number(value[1]);
  }
  return NaN;
}

export function resolveLocalApiUrl(values, configText, required) {
  if (!values?.API_URL) {
    if (!required) return null;
    throw errorCode('PERFORMANCE_LOCAL_API_URL_MISSING');
  }
  const apiUrl = validateLocalBenchmarkUrl(values.API_URL, ['http:'], '/');
  const configuredApi = readTomlInteger(configText, 'api', 'port');
  if (!Number.isInteger(configuredApi) || Number(apiUrl.port) !== configuredApi) throw errorCode('PERFORMANCE_LOCAL_API_PORT_MISMATCH');
  return apiUrl;
}

async function verifiedWorkspace({ root, workspaceRoot, cli, executeNode, execute, requireApi }) {
  const identity = inspectDisposableSupabaseWorkspace({ root, workspaceRoot, cli, executeNode, execute });
  const status = executeNode([cli, '--workdir', identity.absolute, 'status', '--output', 'env'], { root, capture: true });
  const statusText = typeof status === 'string' ? status : status.stdout;
  const values = readStatusValues(statusText);
  const apiUrl = resolveLocalApiUrl(values, readFileSync(identity.configPath, 'utf8'), requireApi);
  return { identity, values, apiUrl };
}

async function planScenario(db, metrics, scenario, sampleCount, baselineProjections) {
  if (scenario.kind === 'beta-drive-physical') {
    const baselineQuery = buildBetaDrivePageSql(scenario);
    const candidateQuery = buildBetaDrivePageSql(scenario);
    if (baselineQuery.page !== candidateQuery.page || baselineQuery.count !== candidateQuery.count
        || JSON.stringify(baselineQuery.values) !== JSON.stringify(candidateQuery.values)) {
      throw errorCode('PERFORMANCE_BETA_DRIVE_SQL_SEMANTICS_CHANGED');
    }
    return runSharedControlExplainScenario(db, metrics, scenario, sampleCount, candidateQuery);
  }
  const projectionType = scenario.fields === INVENTORY_MASTER_FULL_FIELDS ? 'full' : 'browse';
  const baselineScenario = { ...scenario, fields: baselineProjections[projectionType] };
  const baselineQuery = buildInventoryPageSql(baselineScenario);
  const candidateQuery = buildInventoryPageSql(scenario);
  if (baselineQuery.page !== candidateQuery.page || baselineQuery.count !== candidateQuery.count
      || JSON.stringify(baselineQuery.values) !== JSON.stringify(candidateQuery.values)) {
    throw errorCode('PERFORMANCE_SQL_SEMANTICS_CHANGED');
  }
  return runSharedControlExplainScenario(db, metrics, scenario, sampleCount, candidateQuery);
}

async function runSharedControlExplainScenario(db, metrics, scenario, sampleCount, query) {
  const baselineQuery = query;
  const candidateQuery = query;
  const parityBaselineRows = await db.query(baselineQuery.page, baselineQuery.values);
  const parityCandidateRows = await db.query(candidateQuery.page, candidateQuery.values);
  const baselineRowHash = createHash('sha256').update(JSON.stringify(parityBaselineRows.rows)).digest('hex');
  const candidateRowHash = createHash('sha256').update(JSON.stringify(parityCandidateRows.rows)).digest('hex');
  if (baselineRowHash !== candidateRowHash || parityBaselineRows.rows.length !== parityCandidateRows.rows.length) {
    throw errorCode('PERFORMANCE_SQL_ROW_PARITY_FAILED');
  }
  const baselineCount = await db.query(baselineQuery.count, baselineQuery.values);
  const candidateCount = await db.query(candidateQuery.count, candidateQuery.values);
  if (baselineCount.rows[0]?.total !== candidateCount.rows[0]?.total
      || Number(candidateCount.rows[0]?.total) !== scenario.total) throw errorCode('PERFORMANCE_SQL_COUNT_PARITY_FAILED');

  const controlSamples = { page: [], count: [] };
  const representative = { page: null, count: null };
  for (let index = 0; index < sampleCount; index += 1) {
    const pageExplain = await db.query({ text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.page}`, values: query.values, query_timeout: 60000 });
    const countExplain = await db.query({ text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.count}`, values: query.values, query_timeout: 60000 });
    const pagePlan = pageExplain.rows[0]?.['QUERY PLAN']?.[0];
    const countPlan = countExplain.rows[0]?.['QUERY PLAN']?.[0];
    if (!pagePlan || !countPlan) throw errorCode('PERFORMANCE_EXPLAIN_RESULT_INVALID');
    controlSamples.page.push({ planning: pagePlan['Planning Time'], execution: pagePlan['Execution Time'] });
    controlSamples.count.push({ planning: countPlan['Planning Time'], execution: countPlan['Execution Time'] });
    if (!representative.page) representative.page = pagePlan;
    if (!representative.count) representative.count = countPlan;
  }
  for (const queryKind of ['page', 'count']) {
    for (const metric of ['planning', 'execution']) {
      const id = `db.${scenario.id}.control.${queryKind}.${metric}_ms`;
      for (const sample of controlSamples[queryKind]) metrics.add(id, 'database-duration', sample[metric]);
    }
  }
  const expectedPage = Math.max(0, Math.min(scenario.limit, scenario.total - scenario.offset));
  if (parityBaselineRows.rows.length !== expectedPage || parityCandidateRows.rows.length !== expectedPage) throw errorCode('PERFORMANCE_SQL_PAGE_SIZE_MISMATCH');
  const queryFingerprint = createHash('sha256').update(JSON.stringify({ page: query.page, count: query.count, values: query.values })).digest('hex');
  metrics.add(`db.${scenario.id}.rows_expected`, 'count', expectedPage);
  return { scenario: scenario.id, total: scenario.total, offset: scenario.offset, pageRowsExpected: expectedPage, sampleCount,
    comparison: 'not_applicable_identical_sql', queryFingerprint,
    baselineRowHash, candidateRowHash,
    baselineCount: baselineCount.rows[0]?.total, candidateCount: candidateCount.rows[0]?.total,
    controlPagePlan: representative.page,
    controlCountPlan: representative.count,
    controlPagePlanNodes: flattenPlan(representative.page?.Plan),
    controlCountPlanNodes: flattenPlan(representative.count?.Plan),
    controlSampleCount: controlSamples.page.length,
    firstControlSample: {
      cache: 'shared-cache-not-flushed; one measurement per query per sample',
      page: controlSamples.page[0], count: controlSamples.count[0],
    },
    ...(scenario.kind === 'beta-drive-physical' ? { scope: 'canonical-schema-physical-read-only; sandbox RLS/auth not measured', projection: BETA_DRIVE_CARD_FIELDS } : {}) };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  }
  return value;
}

async function expectedApiPageDigest(db, scenario) {
  const query = buildInventoryPageSql(scenario);
  const result = await db.query({ text: `SELECT to_jsonb(expected_row) AS row FROM (${query.page}) AS expected_row`,
    values: query.values, query_timeout: 60000 });
  const rows = result.rows.map(entry => entry.row);
  return createHash('sha256').update(JSON.stringify(canonicalJson(rows))).digest('hex');
}

function roleScopeForApi(role) {
  return role === 'foreman' ? 'Foreman' : role === 'rep' ? 'REP' : 'Admin';
}

export function buildLocalIdentityFixture(role, nonce, password) {
  if (!['admin', 'rep', 'foreman'].includes(role) || !/^[a-z0-9-]{1,64}$/i.test(nonce)
      || typeof password !== 'string' || password.length < 16) throw errorCode('PERFORMANCE_LOCAL_IDENTITY_FIXTURE_INVALID');
  const username = `perf_${role}_${nonce.toLowerCase()}`;
  return {
    username,
    email: `${username}@example.invalid`,
    password,
    role: roleScopeForApi(role),
    legacyRow: { username, password, role: roleScopeForApi(role), must_change_password: false, division: '10', language: 'English' },
    profileRow: { username, display_name: 'Local performance fixture', role: roleScopeForApi(role),
      division: '10', language: 'English', must_change_password: false },
  };
}

export function sanitizedDatabaseFailureCode(prefix, error) {
  if (!/^PERFORMANCE_LOCAL_[A-Z0-9_]+$/.test(prefix)) throw errorCode('PERFORMANCE_LOCAL_ERROR_PREFIX_INVALID');
  const sqlState = typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
    ? error.code
    : 'UNKNOWN';
  return errorCode(`${prefix}:${sqlState}`);
}

export function sanitizedApplicationErrorCode(responseBody) {
  const code = responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
    ? responseBody.code
    : null;
  return typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'UNKNOWN';
}

/** Compact only the owned, empty inventory relation before a disposable fixture pass. */
export async function vacuumEmptyPerformanceInventory(db) {
  const ownership = await db.query(`SELECT pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c WHERE c.oid='public.ph_master_inventory'::regclass`);
  const current = await db.query('SELECT current_user');
  if (!ownership.rows[0]?.owner || ownership.rows[0].owner !== current.rows[0]?.current_user) {
    throw errorCode('PERFORMANCE_FIXTURE_TABLE_OWNER_REQUIRED');
  }
  const existing = await db.query('SELECT count(*)::bigint AS total FROM public.ph_master_inventory');
  if (Number(existing.rows[0]?.total) !== 0) throw errorCode('PERFORMANCE_FIXTURE_REQUIRES_EMPTY_INVENTORY');
  // VACUUM FULL is deliberately limited to this empty table in the verified
  // disposable workspace. It removes fixture dead tuples, but does not flush
  // PostgreSQL shared buffers or claim cold-cache measurements.
  await db.query('VACUUM (FULL, ANALYZE) public.ph_master_inventory');
}

export async function readInventoryPhysicalSizes(db) {
  const { rows } = await db.query(`SELECT pg_relation_size('public.ph_master_inventory')::bigint AS heap_bytes,
    pg_indexes_size('public.ph_master_inventory')::bigint AS index_bytes,
    pg_total_relation_size('public.ph_master_inventory')::bigint AS total_bytes`);
  const row = rows[0];
  const sizes = { heapBytes: Number(row?.heap_bytes), indexBytes: Number(row?.index_bytes), totalBytes: Number(row?.total_bytes) };
  if (Object.values(sizes).some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw errorCode('PERFORMANCE_RELATION_SIZE_INVALID');
  }
  return sizes;
}

async function createLocalIdentity(db, admin, apiUrl, publishableKey, role, nonce) {
  const password = `Bench-${randomUUID()}-T9!`;
  const fixture = buildLocalIdentityFixture(role, nonce, password);
  const { username, email } = fixture;
  const legacy = await admin.from('ph_app_users').insert(fixture.legacyRow).select('id').single();
  if (legacy.error || !legacy.data?.id) {
    throw sanitizedDatabaseFailureCode('PERFORMANCE_LOCAL_LEGACY_USER_CREATE_FAILED', legacy.error);
  }
  const legacyUserId = legacy.data.id;
  let userId = null;
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true,
      app_metadata: { role: fixture.role, legacy_user_id: legacyUserId, performance_fixture: true },
      user_metadata: { username } });
    if (created.error || !created.data?.user?.id) throw errorCode('PERFORMANCE_LOCAL_AUTH_USER_CREATE_FAILED');
    userId = created.data.user.id;
    const profile = await admin.from('profiles').insert({ id: userId, legacy_user_id: legacyUserId, ...fixture.profileRow });
    if (profile.error) throw sanitizedDatabaseFailureCode('PERFORMANCE_LOCAL_PROFILE_CREATE_FAILED', profile.error);
    const browser = createClient(apiUrl.href, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const signedIn = await browser.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session?.access_token) throw errorCode('PERFORMANCE_LOCAL_AUTH_SIGNIN_FAILED');
    return { userId, legacyUserId, admin, browser, accessToken: signedIn.data.session.access_token, username };
  } catch (error) {
    try {
      await cleanupLocalIdentity(db, admin, userId, legacyUserId);
    } catch {
      throw errorCode('PERFORMANCE_LOCAL_AUTH_USER_CLEANUP_FAILED');
    }
    throw error;
  }
}

export async function cleanupLocalIdentity(db, admin, userId, legacyUserId) {
  let cleanupError;
  if (userId) {
    try {
      // The REP profile refresh trigger creates this synthetic mapping, whose
      // FK intentionally prevents deleting a profile while the mapping exists.
      await db.query('DELETE FROM sales_private.rep_identities WHERE profile_id = $1::uuid', [userId]);
    } catch (error) {
      cleanupError ||= sanitizedDatabaseFailureCode('PERFORMANCE_LOCAL_REP_IDENTITY_CLEANUP_FAILED', error);
    }
    const profile = await admin.from('profiles').delete().eq('id', userId);
    if (profile.error) cleanupError ||= sanitizedDatabaseFailureCode('PERFORMANCE_LOCAL_PROFILE_CLEANUP_FAILED', profile.error);
    const auth = await admin.auth.admin.deleteUser(userId);
    if (auth.error) cleanupError ||= errorCode('PERFORMANCE_LOCAL_AUTH_USER_CLEANUP_FAILED');
  }
  if (legacyUserId) {
    const legacy = await admin.from('ph_app_users').delete().eq('id', legacyUserId);
    if (legacy.error) cleanupError ||= errorCode('PERFORMANCE_LOCAL_LEGACY_USER_CLEANUP_FAILED');
  }
  if (cleanupError) throw cleanupError;
}

function sqlScenarios(prefix, recentSince, totalCounts, size) {
  const make = (id, options) => ({ id: `${id}.dataset-${size}`, limit: API_LIMIT, ...options });
  const tenKCode = `PERF10-${prefix}`;
  const hundredKCode = `PERF100-${prefix}`;
  const scenarios = [
    make('lookup.10k.admin.first', { role: 'admin', itemcode: tenKCode, fields: INVENTORY_MASTER_BROWSE_FIELDS, offset: 0, total: totalCounts.get('admin:10k') }),
    make('lookup.10k.rep.deep', { role: 'rep', itemcode: tenKCode, fields: INVENTORY_MASTER_BROWSE_FIELDS, offset: Math.max(0, totalCounts.get('rep:10k') - API_LIMIT), total: totalCounts.get('rep:10k') }),
    make('lookup.90k.admin.first', { role: 'admin', itemcode: hundredKCode, fields: INVENTORY_MASTER_BROWSE_FIELDS, offset: 0, total: totalCounts.get('admin:100k') }),
    make('lookup.90k.rep.deep', { role: 'rep', itemcode: hundredKCode, fields: INVENTORY_MASTER_FULL_FIELDS, offset: Math.max(0, totalCounts.get('rep:100k') - API_LIMIT), total: totalCounts.get('rep:100k') }),
    make(`master.${size}.admin.browse.first`, { role: 'admin', fields: INVENTORY_MASTER_BROWSE_FIELDS, offset: 0, total: totalCounts.get('admin:all') }),
    make(`master.${size}.admin.browse.deep`, { role: 'admin', fields: INVENTORY_MASTER_BROWSE_FIELDS, offset: Math.max(0, totalCounts.get('admin:all') - API_LIMIT), total: totalCounts.get('admin:all') }),
    make(`master.${size}.foreman.browse.deep`, { role: 'foreman', fields: INVENTORY_MASTER_BROWSE_FIELDS, offset: Math.max(0, totalCounts.get('foreman:all') - API_LIMIT), total: totalCounts.get('foreman:all') }),
    make(`master.${size}.rep.full.deep`, { role: 'rep', fields: INVENTORY_MASTER_FULL_FIELDS, offset: Math.max(0, totalCounts.get('rep:all') - API_LIMIT), total: totalCounts.get('rep:all') }),
    make('delta.admin.recent', { role: 'admin', fields: INVENTORY_MASTER_FULL_FIELDS, since: recentSince, offset: 0, total: totalCounts.get('admin:delta') }),
    make('delta.admin.recent.deep', { role: 'admin', fields: INVENTORY_MASTER_FULL_FIELDS, since: recentSince,
      offset: Math.max(0, totalCounts.get('admin:delta') - API_LIMIT), total: totalCounts.get('admin:delta') }),
    make('queue.recount.admin.first', { role: 'admin', fields: INVENTORY_MASTER_FULL_FIELDS, queue: true, queueOrder: true, offset: 0, total: totalCounts.get('admin:queue') }),
    make('queue.recount.admin.deep', { role: 'admin', fields: INVENTORY_MASTER_FULL_FIELDS, queue: true, queueOrder: true,
      offset: Math.max(0, totalCounts.get('admin:queue') - API_LIMIT), total: totalCounts.get('admin:queue') }),
  ];
  return size === '100k' ? scenarios : scenarios.filter(scenario => !scenario.id.includes('90k'));
}

async function betaDriveScenarios(db, size, total) {
  const limit = 250;
  const search = 'Synthetic performance plant';
  const searchCount = await db.query(buildBetaDrivePageSql({ search, limit: 1 }).count,
    buildBetaDrivePageSql({ search, limit: 1 }).values);
  const filteredTotal = Number(searchCount.rows[0]?.total || 0);
  const make = (id, searchText, count) => ({ id: `beta_drive.${size}.${id}`, kind: 'beta-drive-physical',
    apiSupported: false, limit, offset: id.endsWith('.deep') ? Math.max(0, count - limit) : 0,
    total: count, search: searchText });
  return [
    make('first', null, total), make('deep', null, total),
    make('search.first', search, filteredTotal), make('search.deep', search, filteredTotal),
  ];
}

async function countFor(db, options) {
  const query = buildInventoryPageSql({ ...options, fields: 'unique_id', limit: 1 });
  const result = await db.query(query.count, query.values);
  return Number(result.rows[0]?.total || 0);
}

async function expectedTotals(db, prefix, since, size) {
  const totals = new Map();
  for (const role of ['admin', 'rep', 'foreman']) {
    totals.set(`${role}:dataset`, await countFor(db, { role }));
    totals.set(`${role}:10k`, await countFor(db, { role, itemcode: `PERF10-${prefix}` }));
    if (size === '100k') totals.set(`${role}:100k`, await countFor(db, { role, itemcode: `PERF100-${prefix}` }));
    totals.set(`${role}:all`, await countFor(db, { role }));
  }
  totals.set('admin:delta', await countFor(db, { role: 'admin', since }));
  totals.set('admin:queue', await countFor(db, { role: 'admin', queue: true }));
  return totals;
}

async function callAppApi(apiUrl, identity, payload, apiDiagnostics) {
  const endpoint = new URL('/functions/v1/app-api', apiUrl);
  const requestId = `perf-api-${randomBytes(16).toString('hex')}`;
  const requestEluStart = apiDiagnostics.snapshotEventLoopUtilization();
  const started = performance.now();
  const response = await fetch(endpoint, { method: 'POST', headers: {
    apikey: identity.publishableKey,
    Authorization: `Bearer ${identity.accessToken}`,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'x-request-id': requestId,
  }, body: JSON.stringify({ action: 'inventory_read', ...payload }), signal: AbortSignal.timeout(30000) });
  const headersAt = performance.now();
  const bodyReadStartedAt = headersAt;
  const bodyText = await response.text();
  const bodyCompleteAt = performance.now();
  const requestEluEnd = apiDiagnostics.snapshotEventLoopUtilization();
  const elapsed = bodyCompleteAt - started;
  if (!response.ok) {
    let responseBody = null;
    try { responseBody = JSON.parse(bodyText); } catch { /* Error responses may not be JSON. */ }
    throw errorCode(`PERFORMANCE_AUTHENTICATED_API_FAILED:${response.status}:${sanitizedApplicationErrorCode(responseBody)}`);
  }
  const decodeEluStart = apiDiagnostics.snapshotEventLoopUtilization();
  const decodeStartedAt = performance.now();
  let body;
  try { body = JSON.parse(bodyText); } catch { throw errorCode('PERFORMANCE_API_JSON_INVALID'); }
  if (body?.ok !== true || !body.data || !Array.isArray(body.data.rows)) throw errorCode('PERFORMANCE_API_RESPONSE_INVALID');
  const bytes = Buffer.byteLength(bodyText);
  const decodeEndedAt = performance.now();
  const decodeEluEnd = apiDiagnostics.snapshotEventLoopUtilization();
  return { elapsed, bytes, body, timing: {
    requestStartedAt: started, headersAt, bodyReadStartedAt, bodyCompleteAt,
    decodeStartedAt, decodeEndedAt, requestEluStart, requestEluEnd, decodeEluStart, decodeEluEnd,
    requestId, responseRequestId: response.headers.get('x-request-id'), responseStatus: response.status,
    appServerDurationMs: parseAppServerTimingDuration(response.headers.get('server-timing')),
  } };
}

function apiRequestFor(scenario) {
  if (scenario.id.startsWith('queue.')) return { operation: 'recount_queue', params: { limit: API_LIMIT, offset: scenario.offset } };
  if (scenario.id.startsWith('delta.')) return { operation: 'master_delta', params: { since: scenario.since, limit: API_LIMIT, offset: scenario.offset } };
  if (scenario.id.startsWith('lookup.')) return { operation: 'master_page', params: { dataset: 'lookup', projection: scenario.fields === INVENTORY_MASTER_FULL_FIELDS ? 'full' : 'browse',
    itemCode: scenario.itemcode, limit: API_LIMIT, offset: scenario.offset } };
  if (scenario.id.startsWith('master.')) return { operation: 'master_page', params: { dataset: 'master', projection: scenario.fields === INVENTORY_MASTER_FULL_FIELDS ? 'full' : 'browse',
    limit: API_LIMIT, offset: scenario.offset } };
  throw errorCode('PERFORMANCE_SCENARIO_INVALID');
}

function assertApiResponse(scenario, response, expectedPageDigest) {
  const data = response.body.data;
  if (Number(data.total) !== scenario.total || Number(data.offset) !== scenario.offset) throw errorCode(`PERFORMANCE_API_COUNT_MISMATCH:${scenario.id}`);
  const expectedRows = Math.max(0, Math.min(API_LIMIT, scenario.total - scenario.offset));
  if (data.rows.length !== expectedRows) throw errorCode(`PERFORMANCE_API_PAGE_MISMATCH:${scenario.id}`);
  const actualDigest = createHash('sha256').update(JSON.stringify(canonicalJson(data.rows))).digest('hex');
  if (actualDigest !== expectedPageDigest) throw errorCode(`PERFORMANCE_API_ROW_PARITY_FAILED:${scenario.id}`);
  if (data.hasMore !== (scenario.offset + expectedRows < scenario.total)) throw errorCode(`PERFORMANCE_API_CURSOR_MISMATCH:${scenario.id}`);
  if (scenario.id.startsWith('lookup.') || scenario.id.startsWith('master.')) {
    const expected = scenario.fields.split(',').sort();
    const columns = Array.isArray(data.columns) ? data.columns.slice().sort() : [];
    if (columns.length !== expected.length || columns.some((value, index) => value !== expected[index])) throw errorCode(`PERFORMANCE_API_PROJECTION_MISMATCH:${scenario.id}`);
  }
  if (scenario.fields) {
    const expected = scenario.fields.split(',').sort();
    for (const row of data.rows) {
      const keys = Object.keys(row).sort();
      if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw errorCode(`PERFORMANCE_API_ROW_SHAPE_MISMATCH:${scenario.id}`);
    }
  }
}

function buildReport(metrics, sqlPlanEvidence, digest) {
  return { schemaVersion: 1, commit: digest.commit, baselineCommit: manifest.baselineCommit, artifactDigest: digest.artifactDigest,
    fixtureVersion: manifest.fixtureVersion, browser: digest.mode === 'api' ? 'authenticated-http-local' : 'postgres', viewport: { width: 1, height: 1 },
    method: digest.mode === 'api'
      ? 'local-disposable-postgres-authenticated-app-api-v2; edge-runtime=oneshot (every measured request uses a fresh isolate); stable 10k-then-100k fixtures; exact row/count/projection parity enforced'
      : 'local-disposable-postgres-pinned-reader-shared-control-v1; identical SQL measured once; no SQL speedup claim; beta Drive is canonical-schema physical-read proxy only (sandbox RLS/auth not measured); shared buffers reported, not flushed',
    metrics: metrics.list(), diagnostics: { scenarios: sqlPlanEvidence } };
}

function performanceArtifactDigest(sourceRoot, mode) {
  const baseFiles = [
    'supabase/functions/app-api/index.ts',
    'supabase/functions/_shared/database.types.ts',
  ];
  const optionalFiles = [
    'supabase/functions/_shared/inventory-projections.ts',
    'services/database-contract-runtime.ts',
    ...(mode === 'sql' ? ['scripts/performance-database.mjs', 'v2/src/services/api.ts'] : []),
  ];
  const sourceFiles = [...baseFiles, ...optionalFiles.filter(file => existsSync(path.join(sourceRoot, file)))];
  const hash = createHash('sha256');
  for (const file of sourceFiles) {
    hash.update(file).update('\0').update(readFileSync(path.join(sourceRoot, file))).update('\0');
  }
  const artifactContext = { fixtureVersion: manifest.fixtureVersion, stagedRows: [INITIAL_SYNTHETIC_ROWS, MAX_SYNTHETIC_ROWS],
    rowFormula: 'index:1..100000; itemcode:10k-cohort-then-90k-cohort; season/lotcode U3 every20th; recount every10th; timestamp age modulo7200s',
    timestampAnchor: '2026-10-08T16:00:00Z', roleScopes: ['admin', 'rep', 'foreman'], pageSize: API_LIMIT, mode };
  if (mode === 'api') artifactContext.functionPolicy = PERFORMANCE_API_FUNCTION_POLICY;
  hash.update(JSON.stringify(artifactContext));
  const commit = mode === 'api' ? String(process.env.PERFORMANCE_SOURCE_COMMIT || '').trim()
    : run('git', ['rev-parse', 'HEAD'], { root: sourceRoot, capture: true }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw errorCode('PERFORMANCE_SOURCE_COMMIT_INVALID');
  return { artifactDigest: hash.digest('hex'), commit };
}

export function pinnedBaselineProjections(root = repoRoot) {
  const source = run('git', ['show', `${manifest.baselineCommit}:supabase/functions/app-api/index.ts`], { root, capture: true });
  const extract = name => {
    const start = source.indexOf(`const ${name} = [`);
    if (start < 0) throw errorCode(`PERFORMANCE_BASELINE_PROJECTION_MISSING:${name}`);
    const end = source.indexOf('].join(",");', start);
    if (end < 0) throw errorCode(`PERFORMANCE_BASELINE_PROJECTION_INVALID:${name}`);
    return [...source.slice(start, end).matchAll(/"([^"]+)"/g)].map(match => match[1]).join(',');
  };
  const browse = extract('INVENTORY_MASTER_BROWSE_FIELDS');
  const full = extract('INVENTORY_MASTER_FULL_FIELDS');
  if (browse !== INVENTORY_MASTER_BROWSE_FIELDS || full !== INVENTORY_MASTER_FULL_FIELDS) {
    throw errorCode('PERFORMANCE_INVENTORY_PROJECTION_SEMANTICS_CHANGED');
  }
  return { browse, full };
}

export function assertPairedSqlPerformance(metrics) {
  const byId = new Map(metrics.map(metric => [metric.id, metric]));
  const regressions = [];
  const candidates = metrics.filter(metric => metric.id.startsWith('db.') && metric.id.includes('.candidate.')
    && metric.id.endsWith('.execution_ms'));
  if (!candidates.length) throw errorCode('PERFORMANCE_SQL_PAIR_EMPTY');
  for (const candidate of candidates) {
    const baselineId = candidate.id.replace('.candidate.', '.baseline.');
    const baseline = byId.get(baselineId);
    if (!baseline || baseline.kind !== 'database-duration' || candidate.kind !== baseline.kind
        || baseline.samples.length !== candidate.samples.length) throw errorCode('PERFORMANCE_SQL_PAIR_INCOMPLETE');
    for (const p of [0.5, 0.95]) {
      const before = percentile(baseline.samples, p);
      const after = percentile(candidate.samples, p);
      const limit = benchmarkMetricLimit(manifest, before, 'database-duration');
      if (after > limit) regressions.push(`${candidate.id} p${p * 100}: ${after.toFixed(2)} exceeds ${limit.toFixed(2)} (pinned baseline ${before.toFixed(2)})`);
    }
  }
  if (regressions.length) throw errorCode(`PERFORMANCE_SQL_REGRESSION:${regressions.join('; ')}`);
  return true;
}

export function assertSqlControlCoverage(evidence, expectedScenarioIds, sampleCount = SQL_BENCHMARK_SAMPLES) {
  if (!Array.isArray(evidence) || !(expectedScenarioIds instanceof Set) || expectedScenarioIds.size === 0) {
    throw errorCode('PERFORMANCE_SQL_CONTROL_COVERAGE_INVALID');
  }
  const controls = evidence.filter(entry => entry?.comparison === 'not_applicable_identical_sql');
  const byScenario = new Map(controls.map(entry => [entry.scenario, entry]));
  if (controls.length !== expectedScenarioIds.size || byScenario.size !== controls.length
      || [...expectedScenarioIds].some(id => !byScenario.has(id))) {
    throw errorCode('PERFORMANCE_SQL_CONTROL_COVERAGE_INCOMPLETE');
  }
  for (const entry of controls) {
    if (entry.controlSampleCount !== sampleCount || entry.sampleCount !== sampleCount
        || !/^[a-f0-9]{64}$/.test(entry.queryFingerprint || '')
        || !/^[a-f0-9]{64}$/.test(entry.baselineRowHash || '')
        || entry.baselineRowHash !== entry.candidateRowHash
        || Number(entry.baselineCount) !== Number(entry.candidateCount)
        || !entry.controlPagePlan?.Plan || !entry.controlCountPlan?.Plan
        || !Array.isArray(entry.controlPagePlanNodes) || !Array.isArray(entry.controlCountPlanNodes)) {
      throw errorCode('PERFORMANCE_SQL_CONTROL_EVIDENCE_INVALID');
    }
  }
  return true;
}

async function runBenchmark({ mode, workspaceRoot, root = repoRoot, cli = packageBin('supabase', 'supabase', root), executeNode = runNode, execute = run } = {}) {
  if (!['sql', 'api'].includes(mode)) throw errorCode('PERFORMANCE_MODE_INVALID');
  validateApiFunctionPolicy(mode, process.env.PERFORMANCE_FUNCTION_POLICY);
  const sqlContract = mode === 'sql' ? assertPinnedSqlContract({ root }) : null;
  const { identity: workspace, values, apiUrl } = await verifiedWorkspace({ root, workspaceRoot, cli, executeNode, execute, requireApi: mode === 'api' });
  if (mode === 'api') assertPerformanceFunctionPolicy(workspace, root, PERFORMANCE_API_FUNCTION_POLICY);
  const baselineProjections = pinnedBaselineProjections(root);
  const db = new Client({ connectionString: workspace.dbUrl.href, connectionTimeoutMillis: 10000,
    query_timeout: 180000, application_name: `gnc_inventory_perf_${mode}` });
  await db.connect();
  const prefix = FIXTURE_PREFIX;
  const recentSince = new Date(Date.parse(FIXTURE_TIMESTAMP) - 15 * 60 * 1000).toISOString();
  const metrics = metricStore();
  const planEvidence = [];
  if (mode === 'sql') {
    measureProjectionPair(metrics, planEvidence, INVENTORY_MASTER_BROWSE_FIELDS, 'browse-page-500');
    measureProjectionPair(metrics, planEvidence, INVENTORY_MASTER_FULL_FIELDS, 'full-page-500');
  }
  const expectedSqlControls = new Set();
  const users = new Map();
  const adminClient = mode === 'api' ? createClient(apiUrl.href, values.SERVICE_ROLE_KEY || '', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) : null;
  let seeded = false;
  let report;
  let apiSampleDiagnosticsSummary = null;
  let cleanupFailure;
  const apiDiagnostics = mode === 'api' ? createApiSampleDiagnostics() : null;
  try {
    if (mode === 'api' && (!values.SERVICE_ROLE_KEY || !values.ANON_KEY || process.env.EXPECTED_PROJECT_REF !== 'local')) {
      throw errorCode('PERFORMANCE_LOCAL_AUTH_ENV_REQUIRED');
    }
    await vacuumEmptyPerformanceInventory(db);
    await seedInventory(db, prefix, () => { seeded = true; });
    if (mode === 'api') {
      for (const role of ['admin', 'rep', 'foreman']) {
        users.set(role, await createLocalIdentity(db, adminClient, apiUrl, values.ANON_KEY, role, prefix.slice(-8)));
      }
    }

    const runStage = async size => {
      const totals = await expectedTotals(db, prefix, recentSince, size);
      const physicalSizes = await readInventoryPhysicalSizes(db);
      planEvidence.push({ scenario: `fixture.${size}.physical-relation-size`, ...physicalSizes,
        sharedBuffersFlushed: false, purpose: 'observe table/index storage after deterministic fixture seeding and ANALYZE' });
      const nullTimestampRows = await db.query({ text: `SELECT count(*)::bigint AS total
        FROM public.ph_master_inventory WHERE unique_id LIKE $1 || '-%' AND last_updated IS NULL`, values: [prefix] });
      const expectedNullTimestampRows = Number(size === '10k' ? INITIAL_SYNTHETIC_ROWS : MAX_SYNTHETIC_ROWS) / 1000;
      if (Number(nullTimestampRows.rows[0]?.total) !== expectedNullTimestampRows) throw errorCode('PERFORMANCE_NULL_TIMESTAMP_FIXTURE_INVALID');
      planEvidence.push({ scenario: `fixture.${size}.null-last-updated`, rows: expectedNullTimestampRows,
        purpose: 'exercise descending queue order with NULLS LAST as used by app-api' });
      const scenarios = [...sqlScenarios(prefix, recentSince, totals, size),
        ...await betaDriveScenarios(db, size, totals.get('admin:all'))];
      if (mode === 'sql') {
        for (const scenario of scenarios) {
          expectedSqlControls.add(scenario.id);
          planEvidence.push(await planScenario(db, metrics, scenario, SQL_BENCHMARK_SAMPLES, baselineProjections));
        }
        return;
      }
      for (const scenario of scenarios.filter(entry => entry.apiSupported !== false)) {
        const role = scenario.id.includes('.rep.') ? 'rep' : scenario.id.includes('.foreman.') ? 'foreman' : 'admin';
        const identity = { ...users.get(role), publishableKey: values.ANON_KEY };
        const request = apiRequestFor(scenario);
        const expectedPageDigest = await expectedApiPageDigest(db, scenario);
        const samples = [];
        for (let index = 0; index < manifest.coldSamples + manifest.warmSamples; index += 1) {
          const response = await callAppApi(apiUrl, identity, request, apiDiagnostics);
          const validationEluStart = apiDiagnostics.snapshotEventLoopUtilization();
          const validationStartedAt = performance.now();
          assertApiResponse(scenario, response, expectedPageDigest);
          const validationEndedAt = performance.now();
          const validationEluEnd = apiDiagnostics.snapshotEventLoopUtilization();
          apiDiagnostics.recordSample({ scenario: scenario.id, sampleIndex: index,
            ...response.timing,
            validationStartedAt, validationEndedAt, validationEluStart, validationEluEnd,
          });
          samples.push(response.elapsed);
          metrics.add(`api.${scenario.id}.response_ms`, 'duration', response.elapsed);
          metrics.add(`api.${scenario.id}.response_bytes`, 'bytes', response.bytes);
          metrics.add(`api.${scenario.id}.rows_returned`, 'count', response.body.data.rows.length);
        }
        planEvidence.push({ scenario: scenario.id, role, total: scenario.total, offset: scenario.offset,
          expectedPageDigest, initialApiMs: samples[0], medianLikeApiMs: samples[Math.floor(samples.length / 2)], samples: samples.length });
      }
    };
    await runStage('10k');
    await insertInventoryRange(db, prefix, INITIAL_SYNTHETIC_ROWS + 1, MAX_SYNTHETIC_ROWS - INITIAL_SYNTHETIC_ROWS);
    await runStage('100k');
    if (apiDiagnostics) {
      const apiSampleDiagnostics = apiDiagnostics.finalize();
      for (const evidence of planEvidence) {
        const samples = apiSampleDiagnostics.scenarios[evidence.scenario];
        if (samples) evidence.apiSampleDiagnostics = samples;
      }
      apiSampleDiagnosticsSummary = {
        functionPolicy: PERFORMANCE_API_FUNCTION_POLICY,
        sampleLifecycle: 'cold-isolate-per-request',
        observerAvailable: apiSampleDiagnostics.observerAvailable,
        gcEntryLimit: apiSampleDiagnostics.gcEntryLimit,
        gcEntriesObserved: apiSampleDiagnostics.gcEntriesObserved,
        gcEntriesDropped: apiSampleDiagnostics.gcEntriesDropped,
        perScenario: Object.fromEntries(Object.entries(apiSampleDiagnostics.scenarios).map(([scenario, samples]) => [scenario, samples.length])),
        method: 'All API samples retained. Supabase Edge Runtime oneshot policy serves each measured request on a fresh isolate; response_ms remains fetch start through response.text completion. JSON decode and parity validation are reported separately. GC overlaps are diagnostic only.',
      };
    }
    if (mode === 'sql') assertSqlControlCoverage(planEvidence, expectedSqlControls);

    const sourceRoot = mode === 'api' ? path.resolve(process.env.PERFORMANCE_SOURCE_ROOT || workspaceRoot) : root;
    if (mode === 'api' && !existsSync(path.join(sourceRoot, 'supabase/functions/app-api/index.ts'))) {
      throw errorCode('PERFORMANCE_API_SOURCE_ROOT_INVALID');
    }
    const sourceCommit = mode === 'api' ? String(process.env.PERFORMANCE_SOURCE_COMMIT || '').trim() : undefined;
    if (mode === 'api' && !/^[a-f0-9]{40}$/.test(sourceCommit)) throw errorCode('PERFORMANCE_SOURCE_COMMIT_INVALID');
    report = buildReport(metrics, planEvidence, { ...performanceArtifactDigest(sourceRoot, mode), mode });
    if (apiSampleDiagnosticsSummary) {
      report.diagnostics = { ...report.diagnostics, apiSampleDiagnostics: apiSampleDiagnosticsSummary };
    }
    const indexes = await db.query(`SELECT indexname,indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='ph_master_inventory' ORDER BY indexname`);
    report.diagnostics = { ...report.diagnostics,
      fixturePhysicalReset: { statement: 'VACUUM (FULL, ANALYZE) public.ph_master_inventory',
        scope: 'only after the verified disposable inventory table is confirmed owned by the current role and empty',
        sharedBuffersFlushed: false },
      unchangedQueryIndexes: indexes.rows,
      queryIndexNote: 'Read from local disposable schema after seeding; no index or migration changes are made by this benchmark.' };
    if (sqlContract) {
      const postgres = await db.query('SELECT version() AS version');
      report.diagnostics = { ...report.diagnostics, sqlContract,
        postgresVersion: postgres.rows[0]?.version || null,
        nodeVersion: process.version,
        sqlSampleMethod: '30 shared-control EXPLAIN samples per identical page/count query; no baseline/candidate timing comparison or SQL speedup claim' };
    }
  } finally {
    apiDiagnostics?.close();
    for (const user of users.values()) {
      try { await cleanupLocalIdentity(db, adminClient, user.userId, user.legacyUserId); } catch (error) { cleanupFailure ||= error; }
    }
    if (seeded) {
      try { await cleanupInventory(db, prefix); } catch (error) { cleanupFailure ||= error; }
    }
    try { await db.end(); } catch (error) { cleanupFailure ||= error; }
  }
  if (cleanupFailure) throw cleanupFailure;
  return report;
}

/** Synchronous adapter for database-check's already-running canonical stack. */
export function runDatabasePerformanceBenchmark({ root = repoRoot, workspaceRoot, cli, executeNode = runNode, reportPath } = {}) {
  if (!workspaceRoot) throw errorCode('PERFORMANCE_WORKSPACE_REQUIRED');
  const args = [fileURLToPath(import.meta.url), '--sql-workspace', path.resolve(workspaceRoot)];
  if (cli) args.push('--cli', path.resolve(cli));
  const output = executeNode(args, { root, capture: true, ...(reportPath ? { env: { PERFORMANCE_REPORT_PATH: path.resolve(reportPath) } } : {}) });
  const stdout = typeof output === 'string' ? output : output?.stdout || '';
  const line = stdout.trim().split(/\r?\n/).at(-1);
  try { return JSON.parse(line || ''); } catch { throw errorCode('PERFORMANCE_REPORT_INVALID'); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { mode, workspaceRoot, cli } = parseBenchmarkCliArgs(process.argv.slice(2));
    const report = await runBenchmark({ mode: mode === '--sql-workspace' ? 'sql' : 'api', workspaceRoot, cli });
    const outputPath = process.env.PERFORMANCE_REPORT_PATH;
    if (outputPath) writeFileSync(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
