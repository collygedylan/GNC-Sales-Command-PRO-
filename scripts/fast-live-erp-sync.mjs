import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { createDatabaseClientOptions } from './apply-item-low-stock-migration.mjs';
import { driveSources, hashFile, localSources, normalizeHeader, objectRows } from './fast-historical-archive-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasets = new Set(['auto', 'drive_around', 'soc', 'reserves', 'cav', 'warehouse_assigned']);
const contracts = {
  drive_around: { table: 'ph_master_inventory', rpc: 'fast_ingest_drive_around_v1' },
  soc: { table: 'ph_soc_master', rpc: 'fast_ingest_soc_orders_v1' },
  reserves: { table: 'ph_reserves', rpc: 'fast_ingest_soc_reserves_v1' },
  cav: { table: 'ph_cav_import', rpc: 'fast_ingest_cav_v1' },
  warehouse_assigned: { table: 'ph_warehouse_assigned_items', rpc: 'fast_ingest_warehouse_assigned_v1' },
};

function fail(message) {
  const error = new Error(message);
  error.name = 'FastLiveErpSyncError';
  throw error;
}

export function parseFastLiveArguments(argv) {
  const options = { dataset: 'auto', execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--execute') options.execute = true;
    else if (['--input', '--drive-folder', '--dataset'].includes(value)) {
      const next = argv[++index];
      if (!next) fail(`Missing value for ${value}.`);
      if (value === '--input') options.input = path.resolve(next);
      else if (value === '--drive-folder') options.driveFolder = next.trim();
      else options.dataset = next.trim().toLowerCase();
    } else fail(`Unknown argument: ${value}`);
  }
  if ((!options.input && !options.driveFolder) || (options.input && options.driveFolder)) {
    fail('Provide exactly one of --input or --drive-folder.');
  }
  if (!datasets.has(options.dataset)) fail('FAST_LIVE_ERP_DATASET_INVALID');
  return options;
}

function readEnvFile() {
  const filePath = path.join(root, '.env');
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const raw = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = raw;
  }
}

function liveDatabaseUrl() {
  const value = String(process.env.FAST_LIVE_ERP_DATABASE_URL || process.env.GNC_SUPABASE_DB_URL
    || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '').trim();
  if (!value) fail('FAST_LIVE_ERP_DATABASE_URL_MISSING');
  return value;
}

export function inferLiveDataset(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (/^~\$|^temp_/i.test(name)) return null;
  if (name.includes('reserve')) return 'reserves';
  if (name.includes('open order') || name.includes('soc-10')) return 'soc';
  if (name.includes('warehouse') || name.includes('assignment')) return 'warehouse_assigned';
  if (name.includes('cav') || name.includes('wide open')) return 'cav';
  if (name.includes('drive') || name.includes('inventory')) return 'drive_around';
  return null;
}

function cleanValue(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().replaceAll("\\'", "'");
  return text === '' || text.toUpperCase() === 'NULL' ? null : text;
}

function first(row, ...keys) {
  for (const key of keys) {
    const value = cleanValue(row[normalizeHeader(key)]);
    if (value !== null) return value;
  }
  return '';
}

function safeIdentity(parts) {
  return parts.map(value => String(value || '')).join('-').replace(/[^a-zA-Z0-9-]/g, '_');
}

function fallbackIdentity(dataset, row) {
  if (dataset === 'soc') return safeIdentity([
    first(row, 'dock'), first(row, 'transactionnumber'), first(row, 'tagcode'), first(row, 'stopnumber'),
    first(row, 'itemcode'), first(row, 'locationcode'), first(row, 'lotcode'),
    first(row, 'quantityshipped', 'quantityordered'), first(row, 'consigneename'), first(row, 'customername'),
    first(row, 'contsize', 'printedcontainercode'), first(row, 'source'), first(row, 'priority'), first(row, 'desigitem'),
  ]);
  if (dataset === 'reserves') return safeIdentity([
    first(row, 'transactionnumber'), first(row, 'customername'), first(row, 'consigneename'), first(row, 'salesrepname'),
    first(row, 'itemcode'), first(row, 'contsize', 'printedcontainercode'), first(row, 'locationcode'),
    first(row, 'lotcode'), first(row, 'source'), first(row, 'priority'), first(row, 'desigitem'),
  ]);
  if (dataset === 'cav') return safeIdentity([
    first(row, 'item', 'itemcode'), first(row, 'productdescription', 'commonname'), first(row, 'brandcode'),
    first(row, 'size', 'contsize'), first(row, 'season'),
  ]);
  if (dataset === 'warehouse_assigned') return safeIdentity([
    first(row, 'itemcode'), first(row, 'genusname'), first(row, 'locationcode'), first(row, 'contsize'),
  ]);
  const digest = createHash('sha256').update(JSON.stringify([
    first(row, 'warehouseid'), first(row, 'itemcode'), first(row, 'contsize', 'printedcontainercode'),
    first(row, 'lotcode'), first(row, 'locationcode'), first(row, 'source'), first(row, 'desigitem'),
    first(row, 'desigcust'), first(row, 'desigloc'),
  ])).digest('hex').slice(0, 32);
  return `drive-${digest}`;
}

function cavAliases(row) {
  return {
    itemcode: first(row, 'itemcode', 'item'), commonname: first(row, 'commonname', 'productdescription'),
    contsize: first(row, 'contsize', 'size'), ptravailable: first(row, 'ptravailable', 'available'),
    brand: first(row, 'brand', 'brandcode'), unitprice: first(row, 'unitprice'),
    holdstopreason: first(row, 'holdstopreason', 'holdreasonnotescomment', 'holdreasonnotescomments'),
    ordertotal: first(row, 'ordertotal', 'extitemtotal'), product_description: first(row, 'productdescription'),
    brand_code: first(row, 'brandcode'), reserved_qty: first(row, 'reservedqty'), order_qty: first(row, 'orderqty'),
    unit_price: first(row, 'unitprice'), hot_price: first(row, 'hotprice'),
    hold_reason: first(row, 'holdreasonnotescomment', 'holdreasonnotescomments'), ext_item_total: first(row, 'extitemtotal'),
  };
}

export async function prepareLiveRows(filePath, dataset, allowedColumns) {
  const rows = [];
  const identities = new Map();
  for await (const source of objectRows(filePath)) {
    const normalized = {};
    for (const [key, value] of Object.entries(source)) {
      const target = normalizeHeader(key);
      if (allowedColumns.has(target)) normalized[allowedColumns.get(target)] = cleanValue(value);
    }
    if (dataset === 'cav') Object.assign(normalized, Object.fromEntries(Object.entries(cavAliases(source))
      .filter(([key]) => allowedColumns.exact?.has(key) || allowedColumns.has(normalizeHeader(key)))
      .map(([key, value]) => [allowedColumns.exact?.has(key) ? key : allowedColumns.get(normalizeHeader(key)), value])));
    if (!first(source, 'itemcode', 'item')) continue;
    const supplied = first(source, 'unique_id', 'uniqueid');
    const base = supplied || fallbackIdentity(dataset, source);
    const occurrence = identities.get(base) || 0;
    identities.set(base, occurrence + 1);
    normalized[allowedColumns.get('uniqueid') || 'unique_id'] = occurrence ? `${base}-${occurrence}` : base;
    rows.push(normalized);
  }
  if (!rows.length) fail('FAST_LIVE_ERP_SOURCE_EMPTY');
  return rows;
}

async function sourceBundle(options) {
  if (options.input) return { sources: await localSources(options.input), cleanup: async () => {} };
  return driveSources(options.driveFolder);
}

function latestSources(sources, selectedDataset) {
  const latest = new Map();
  for (const source of sources) {
    const dataset = selectedDataset === 'auto' ? inferLiveDataset(source.fileName) : selectedDataset;
    if (!dataset || /^~\$|^temp_/i.test(source.fileName)) continue;
    const current = latest.get(dataset);
    if (!current || String(source.modifiedTime || '') > String(current.modifiedTime || '')) latest.set(dataset, source);
  }
  return latest;
}

async function tableColumns(client, table) {
  const result = await client.query(`select column_name from information_schema.columns
    where table_schema='public' and table_name=$1 and is_generated='NEVER'
    order by (position('_' in column_name)>0) desc,ordinal_position`, [table]);
  const columns = new Map(result.rows.map(row => [normalizeHeader(row.column_name), row.column_name]));
  columns.exact = new Set(result.rows.map(row => row.column_name));
  return columns;
}

export async function runFastLiveErpSync(options) {
  readEnvFile();
  const bundle = await sourceBundle(options);
  const selected = latestSources(bundle.sources, options.dataset);
  if (!selected.size) fail('FAST_LIVE_ERP_SOURCE_NOT_FOUND');
  if (!options.execute) {
    const preview = [];
    for (const [dataset, source] of selected) preview.push({ dataset, fileName: source.fileName, modifiedTime: source.modifiedTime });
    await bundle.cleanup();
    return { ok: true, execute: false, sources: preview };
  }
  const entries = [...selected];
  const pool = new Pool({ ...createDatabaseClientOptions(liveDatabaseUrl()), max: Math.min(entries.length, 5) });
  try {
    const output = await Promise.all(entries.map(async ([dataset, source]) => {
      const contract = contracts[dataset];
      try {
        const contentHash = await hashFile(source.filePath);
        const meta = { file_id: source.fileId || contentHash, file_name: source.fileName,
          modified_at: source.modifiedTime || new Date().toISOString(), content_hash: contentHash };
        let columns;
        const checkClient = await pool.connect();
        try {
          await checkClient.query('begin');
          await checkClient.query("select set_config('request.jwt.claim.role','service_role',true)");
          const check = await checkClient.query('select public.check_erp_file_sync_needed_v1($1,$2,$3,$4,$5) result',
            [dataset, meta.file_id, meta.file_name, meta.modified_at, meta.content_hash]);
          if (check.rows[0].result.skip) {
            await checkClient.query('commit');
            return { dataset, fileName: source.fileName, ...check.rows[0].result };
          }
          columns = await tableColumns(checkClient, contract.table);
          await checkClient.query('commit');
        } catch (error) {
          await checkClient.query('rollback');
          throw error;
        } finally {
          checkClient.release();
        }
        const rows = await prepareLiveRows(source.filePath, dataset, columns);
        const ingestClient = await pool.connect();
        try {
          await ingestClient.query('begin');
          await ingestClient.query("select set_config('request.jwt.claim.role','service_role',true)");
          const result = await ingestClient.query(`select public.${contract.rpc}($1::jsonb,$2::jsonb) result`, [meta, rows]);
          await ingestClient.query('commit');
          return { dataset, fileName: source.fileName, ...result.rows[0].result };
        } catch (error) {
          await ingestClient.query('rollback');
          throw error;
        } finally {
          ingestClient.release();
        }
      } finally {
        await source.cleanup();
      }
    }));
    return { ok: true, execute: true, results: output };
  } finally {
    await pool.end();
    await bundle.cleanup();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runFastLiveErpSync(parseFastLiveArguments(process.argv.slice(2))).then(result => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(error => {
    process.stderr.write(`${error.name || 'Error'}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
