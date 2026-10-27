import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { driveSources, hashFile, localSources, normalizeHeader, objectRows } from './fast-historical-archive-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);
export const FAST_LIVE_BATCH_SIZE = 1000;
const DRIVE_RAW_FIELD_MASK = new Set(['locationnote','locationptn1','desigitem','desigcust','desigloc',
  'pullerresponsibility','oversellpercentage','salesnote','suspend']);
const datasets = new Set(['auto', 'drive_around', 'soc', 'reserves', 'cav']);
const contracts = {
  drive_around: { table: 'ph_master_inventory', preserve: ['date_completed','end_cap_folder','end_cap_qty','end_cap_level','pic_note','sales_note','av_note','photo_link','photo_name','dock_spec','dock_caliper','dock_note','dock_photo_link','dock_photo_name','flyer_cat','flyer_title','flyer_inst','flyer_assigned','flyer_notes','flyer_photo_link','flyer_photo_name','flyer_completed','initial_ptr','loc_match_qty','app_tab_assignment','ncr_approval_type','ncr_requested_by_username','ncr_requested_by_display','ncr_requested_by_email','ncr_requested_at','ncr_approval_message','hold_release_approved_at','hold_release_approved_by','hold_release_approved_by_display','hold_release_approved_holdstopbegindate','flyer_av_note','flyer_match','flyer_loc_match_qty','flyer_spec','flyer_caliper','flyer_pick','flyer_initial_ptr','eval_task_type','eval_task_status','eval_task_instructions','eval_task_assigned_by','eval_task_assigned_at','eval_task_completed_by','eval_task_completed_at','eval_task_recount_qty','eval_task_moved_up_qty','eval_task_hold_action','eval_task_hold_code','eval_task_hold_reason','eval_task_result_note','photo_url','photo_date','loc_match_pct','baseline_on_hand','initial_photo_match_qty','loc_photo_match','pick_note','photo_expires_at','photos','pick','assignedto','match','spec','caliper'] },
  soc: { table: 'ph_soc_master', preserve: ['date_completed','assignedto','dock_photo_link','dock_photo_name','dock_spec','dock_caliper','dock_note','pic_note','sales_note','av_note','photo_link','photo_name','initial_ptr','loc_match_qty','app_tab_assignment','suspend_candidate_group','suspend_candidate_state','suspend_order_quantity','suspend_origin_uid','spec','caliper','match'] },
  reserves: { table: 'ph_reserves', preserve: ['date_completed','assignedto','pic_note','sales_note','av_note','photo_link','photo_name','initial_ptr','loc_match_qty','app_tab_assignment','spec','caliper','match'] },
  cav: { table: 'ph_cav_import', preserve: [] },
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

export function inferLiveDataset(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (/^~\$|^temp_/i.test(name)) return null;
  if (name.includes('reserve')) return 'reserves';
  if (name.includes('open order') || name.includes('soc-10')) return 'soc';
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

export function shouldIncludeSocLiveRow(row) {
  return first(row, 'dock') !== '' || first(row, 'suspend').toUpperCase() === 'SUSPEND'
    && first(row, 'suspend-to', 'suspend_to', 'suspendto').toLowerCase() === 'dc';
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
  for await (const source of objectRows(filePath, { requiredHeaders: ['itemcode'] })) {
    if (dataset === 'soc') {
      if (!shouldIncludeSocLiveRow(source)) continue;
    }
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

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function jsonDollarLiteral(value) {
  const json = JSON.stringify(value);
  let tag = '$rows$';
  while (json.includes(tag)) tag = `$rows${tag.length}$`;
  return `${tag}${json}${tag}`;
}

function parseLinkedRows(stdout) {
  const text = String(stdout || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) fail('FAST_LIVE_ERP_LINKED_QUERY_INVALID');
  const payload = JSON.parse(text.slice(start, end + 1));
  return Array.isArray(payload.rows) ? payload.rows : [];
}

async function runLinkedSql(sql, label) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agdata-fast-live-'));
  const filePath = path.join(directory, `${String(label || 'query').replace(/[^a-z0-9_-]/gi, '-')}.sql`);
  const startedAt = Date.now();
  const progressFile = String(process.env.FAST_LIVE_PROGRESS_FILE || '').trim();
  if (progressFile) fs.appendFileSync(progressFile, `START ${label} ${new Date().toISOString()}\n`);
  try {
    await fs.promises.writeFile(filePath, sql, 'utf8');
    const argumentsList = ['db', 'query', '--linked', '--file', filePath];
    const command = process.platform === 'win32'
      ? process.execPath
      : 'supabase';
    const commandArguments = process.platform === 'win32'
      ? [path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'supabase', 'dist', 'supabase.js'), ...argumentsList]
      : argumentsList;
    const { stdout } = await execFileAsync(command, commandArguments, {
      cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, SUPABASE_TELEMETRY_ENABLED: 'false' }
    });
    const rows = parseLinkedRows(stdout);
    process.stderr.write(`FAST_LIVE_SQL ${label} ${Date.now() - startedAt}ms\n`);
    if (progressFile) fs.appendFileSync(progressFile, `DONE ${label} ${Date.now() - startedAt}ms\n`);
    return rows;
  } catch (error) {
    if (progressFile) fs.appendFileSync(progressFile, `FAIL ${label} ${Date.now() - startedAt}ms ${String(error?.message || error).split('\n')[0]}\n`);
    throw error;
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

function resultObject(rows) {
  const value = rows?.[0]?.result;
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') return JSON.parse(value);
  return {};
}

async function tableColumns(table) {
  const rows = await runLinkedSql(`select json_build_object('columns',coalesce(json_agg(column_name order by ordinal_position),'[]'::json))::text result
from information_schema.columns where table_schema='public' and table_name=${quoteLiteral(table)} and is_generated='NEVER';\n`, `${table}-columns`);
  const names = resultObject(rows).columns || [];
  const columns = new Map(names.map(column => [normalizeHeader(column), column]));
  columns.exact = new Set(names);
  return columns;
}

export function buildFastBatchSql(stageTable, rows, columns) {
  const identifiers = columns.map(quoteIdentifier).join(',');
  return `begin; set local statement_timeout='45s';\ninsert into public.${quoteIdentifier(stageTable)} (${identifiers})\nselect ${identifiers} from jsonb_populate_recordset(null::public.${quoteIdentifier(stageTable)},${jsonDollarLiteral(rows)}::jsonb);\ncommit;\n`;
}

export function buildFastAtomicSwapSql({ dataset, contract, stageTable, mergedTable, rowCount, columns, usedColumns, meta }) {
  const identifiers = columns.map(quoteIdentifier).join(',');
  const preserve = new Set(contract.preserve.filter(column => columns.includes(column)));
  const expressions = columns.map(column => preserve.has(column)
    ? `coalesce(live.${quoteIdentifier(column)},stage.${quoteIdentifier(column)})`
    : `stage.${quoteIdentifier(column)}`).join(',');
  const metadata = jsonDollarLiteral(meta);
  return `begin;
set local statement_timeout='110s'; set local lock_timeout='10s';
do $validate$ begin
  if (select count(*) from public.${quoteIdentifier(stageTable)})<>${rowCount} then raise exception 'FAST_LIVE_STAGE_COUNT_MISMATCH'; end if;
  if (select count(distinct unique_id) from public.${quoteIdentifier(stageTable)})<>${rowCount} then raise exception 'FAST_LIVE_STAGE_IDENTITY_MISMATCH'; end if;
end $validate$;
create temp table ${quoteIdentifier(mergedTable)} (like public.${quoteIdentifier(contract.table)} including defaults) on commit drop;
insert into ${quoteIdentifier(mergedTable)} (${identifiers})
select ${expressions} from public.${quoteIdentifier(stageTable)} stage
left join public.${quoteIdentifier(contract.table)} live on live.unique_id=stage.unique_id;
alter table public.${quoteIdentifier(contract.table)} disable trigger user;
truncate table public.${quoteIdentifier(contract.table)};
insert into public.${quoteIdentifier(contract.table)} (${identifiers}) select ${identifiers} from ${quoteIdentifier(mergedTable)};
alter table public.${quoteIdentifier(contract.table)} enable trigger user;
update public.app_dataset_revisions set revision=revision+1,changed_at=clock_timestamp(),state='ready',
  source_file_id=(${metadata}::jsonb)->>'file_id',source_file_name=(${metadata}::jsonb)->>'file_name',source_import_run_id=gen_random_uuid(),
  source_imported_at=clock_timestamp(),source_modified_at=((${metadata}::jsonb)->>'modified_at')::timestamptz,source_content_hash=(${metadata}::jsonb)->>'content_hash'
where key=${quoteLiteral(contract.table)};
drop table public.${quoteIdentifier(stageTable)};
commit;
select json_build_object('dataset',${quoteLiteral(dataset)},'rows',(select count(*) from public.${quoteIdentifier(contract.table)}),'batches',${Math.ceil(rowCount / FAST_LIVE_BATCH_SIZE)},'used_columns',${usedColumns.length})::text result;\n`;
}

export function buildFastStageRpcSql({ rpc, args }) {
  let call;
  if (rpc === 'fast_begin_erp_stage_v1') {
    if (!args || typeof args.p_dataset_key !== 'string' || !Number.isInteger(args.p_expected_rows)) fail('FAST_ERP_STAGE_ARGS_INVALID');
    call = `public.${rpc}(${quoteLiteral(args.p_dataset_key)}::text,${jsonDollarLiteral(args.p_file_meta)}::jsonb,${args.p_expected_rows}::integer)`;
  } else if (rpc === 'fast_append_erp_stage_batch_v1') {
    if (!args || !Number.isInteger(args.p_start_row) || !Array.isArray(args.p_rows)) fail('FAST_ERP_STAGE_ARGS_INVALID');
    call = `public.${rpc}(${quoteLiteral(args.p_stage_id)}::uuid,${args.p_start_row}::integer,${jsonDollarLiteral(args.p_rows)}::jsonb)`;
  } else if (rpc === 'fast_commit_erp_stage_swap_v1' || rpc === 'fast_abort_erp_stage_v1') {
    call = `public.${rpc}(${quoteLiteral(args?.p_stage_id)}::uuid)`;
  } else fail('FAST_ERP_STAGE_RPC_INVALID');
  return `select set_config('request.jwt.claim.role','service_role',false);\nselect ${call}::text result;\n`;
}

async function callFastStageRpc(rpc, args, label) {
  const rows = await runLinkedSql(buildFastStageRpcSql({ rpc, args }), label);
  const result = resultObject(rows);
  if (!result || result.ok !== true) fail('FAST_ERP_STAGE_RPC_UNCONFIRMED');
  return result;
}

export async function runFastLiveErpSync(options) {
  const bundle = await sourceBundle(options);
  const selected = latestSources(bundle.sources, options.dataset);
  if (!selected.size) fail('FAST_LIVE_ERP_SOURCE_NOT_FOUND');
  if (!options.execute) {
    const preview = [];
    for (const [dataset, source] of selected) preview.push({ dataset, fileName: source.fileName, modifiedTime: source.modifiedTime });
    await bundle.cleanup();
    return { ok: true, execute: false, sources: preview };
  }
  const datasetOrder = ['drive_around', 'cav', 'reserves', 'soc'];
  const entries = [...selected].sort((left, right) => datasetOrder.indexOf(left[0]) - datasetOrder.indexOf(right[0]));
  try {
    const output = [];
    for (const [dataset, source] of entries) {
      const contract = contracts[dataset];
      try {
        const contentHash = await hashFile(source.filePath);
        const meta = { file_id: source.fileId || contentHash, file_name: source.fileName,
          modified_at: source.modifiedTime || new Date().toISOString(), content_hash: contentHash };
        const columns = await tableColumns(contract.table);
        let rows = await prepareLiveRows(source.filePath, dataset, columns);
        if (dataset === 'drive_around') {
          rows = rows.map(row => ({ values: row,
            rawFields: Object.keys(row).filter(field => DRIVE_RAW_FIELD_MASK.has(normalizeHeader(field))) }));
        }
        const checkRows = await runLinkedSql(`select set_config('request.jwt.claim.role','service_role',false);
select json_build_object(
  'sync',public.check_erp_file_sync_needed_v1(${quoteLiteral(dataset)},${quoteLiteral(meta.file_id)},${quoteLiteral(meta.file_name)},${quoteLiteral(meta.modified_at)},${quoteLiteral(meta.content_hash)}),
  'row_count',(select count(*) from public.${quoteIdentifier(contract.table)}))::text result;\n`, `${dataset}-check`);
        const checkResult = resultObject(checkRows);
        const check = checkResult.sync || {};
        if (check.skip && Number(checkResult.row_count) === rows.length) {
          output.push({ dataset, fileName: source.fileName, ...check, rowCount: rows.length });
          continue;
        }
        let stageId = '';
        try {
          const begin = await callFastStageRpc('fast_begin_erp_stage_v1', {
            p_dataset_key: dataset, p_file_meta: meta, p_expected_rows: rows.length
          }, `${dataset}-stage-begin`);
          if (begin.skipped === true) {
            output.push({ dataset, fileName: source.fileName, ...check, rowCount: rows.length, stageSkip: true });
            continue;
          }
          stageId = String(begin.stage_id || '');
          if (!stageId || Number(begin.expected_rows) !== rows.length) fail('FAST_ERP_STAGE_BEGIN_INVALID');
          let offset = Number(begin.staged_rows) || 0;
          if (!Number.isInteger(offset) || offset < 0 || offset > rows.length) fail('FAST_ERP_STAGE_CURSOR_INVALID');
          for (; offset < rows.length; offset += FAST_LIVE_BATCH_SIZE) {
            const batch = rows.slice(offset, offset + FAST_LIVE_BATCH_SIZE);
            const appended = await callFastStageRpc('fast_append_erp_stage_batch_v1', {
              p_stage_id: stageId, p_start_row: offset, p_rows: batch
            }, `${dataset}-batch-${Math.floor(offset / FAST_LIVE_BATCH_SIZE) + 1}`);
            if (Number(appended.staged_rows) !== offset + batch.length) fail('FAST_ERP_STAGE_BATCH_UNCONFIRMED');
          }
          const result = await callFastStageRpc('fast_commit_erp_stage_swap_v1', { p_stage_id: stageId }, `${dataset}-commit`);
          output.push({ dataset, fileName: source.fileName, ...result });
        } catch (error) {
          // Keep durable batch progress for safe retry after transient failures.
          throw error;
        }
      } finally {
        await source.cleanup();
      }
    }
    return { ok: true, execute: true, results: output };
  } finally {
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
