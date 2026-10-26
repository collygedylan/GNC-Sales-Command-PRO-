import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Pool } from 'pg';
import { google } from 'googleapis';
import yauzl from 'yauzl';
import { createDatabaseClientOptions } from './apply-item-low-stock-migration.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supportedDomains = new Set(['auto', 'orders', 'reserves', 'drive']);
const supportedExtensions = new Set(['.csv', '.xlsx']);
const defaultBatchSize = 2_000;
const defaultWorkers = 16;

const tableContracts = {
  orders: {
    table: 'public.ph_orders_history',
    primaryKey: 'order_line_key',
    columns: {
      order_line_key: 'text', source_unique_id: 'text', source_kind: 'text', source_file_id: 'text', source_file_name: 'text',
      report_date: 'text', sales_rep: 'text', customer_name: 'text', consignee_name: 'text', customer_consignee_label: 'text',
      order_folder_key: 'text', order_number: 'text', tripnumber: 'text', dock_num: 'text', drop_num: 'text', planstart: 'text',
      order_date: 'timestamptz', checker: 'text', inspector: 'text', mistake: 'text', dock_status: 'text', item_check_status: 'text',
      issue_status: 'text', issue_note: 'text', issue_photos: 'jsonb', itemcode: 'text', commonname: 'text', contsize: 'text',
      locationcode: 'text', lotcode: 'text', qty_ordered: 'numeric', unit_list_price: 'numeric', line_dollar_value: 'numeric',
      photos: 'jsonb', photo_url: 'text', photo_date: 'text', spec: 'text', caliper: 'text', loc_match_pct: 'numeric',
      loc_photo_match: 'numeric', pick_note: 'text', av_note: 'text', sales_note: 'text', row_state_hash: 'text',
      first_seen_at: 'timestamptz', last_seen_at: 'timestamptz', first_file_id: 'text', last_file_id: 'text',
      first_file_name: 'text', last_file_name: 'text', seen_count: 'integer',
    },
  },
  reserves: {
    table: 'public.ph_reserves_history',
    primaryKey: 'reserve_history_key',
    columns: {
      reserve_history_key: 'text', source_unique_id: 'text', source_file_id: 'text', source_file_name: 'text', report_date: 'text',
      sales_rep: 'text', customer_name: 'text', consignee_name: 'text', customer_consignee_label: 'text', reserve_folder_key: 'text',
      order_number: 'text', itemcode: 'text', commonname: 'text', contsize: 'text', locationcode: 'text', lotcode: 'text',
      qty_reserved: 'numeric', on_hand: 'numeric', available_qty: 'numeric', open_stock: 'numeric', unit_list_price: 'numeric',
      line_dollar_value: 'numeric', hold_stop_code: 'text', hold_stop_reason: 'text', photos: 'jsonb', photo_url: 'text',
      photo_date: 'text', spec: 'text', caliper: 'text', av_note: 'text', pick_note: 'text', sales_note: 'text', row_state_hash: 'text',
      first_seen_at: 'timestamptz', last_seen_at: 'timestamptz', first_file_id: 'text', last_file_id: 'text',
      first_file_name: 'text', last_file_name: 'text', seen_count: 'integer',
    },
  },
  drive: {
    table: 'public.ph_drive_mode_history',
    primaryKey: 'history_key',
    columns: {
      history_key: 'text', source_kind: 'text', source_unique_id: 'text', source_file_id: 'text', source_file_name: 'text',
      report_date: 'date', itemcode: 'text', commonname: 'text', contsize: 'text', locationcode: 'text', lotcode: 'text',
      season: 'text', ptravailable: 'numeric', on_hand: 'numeric', review: 'numeric', available: 'numeric', open_stock: 'numeric',
      pri: 'text', unit_list_price: 'numeric', photos: 'jsonb', photo_url: 'text', photo_date: 'text',
      spec: 'text', caliper: 'text', loc_match_pct: 'numeric', loc_photo_match: 'numeric', pick_note: 'text', av_note: 'text',
      sales_note: 'text', hold_stop_code: 'text', hold_stop_reason: 'text', archive_reason: 'text', row_state_hash: 'text',
      first_seen_at: 'timestamptz', last_seen_at: 'timestamptz', first_file_id: 'text', last_file_id: 'text',
      first_file_name: 'text', last_file_name: 'text', seen_count: 'integer',
    },
  },
};

function fail(message) {
  const error = new Error(message);
  error.name = 'HistoricalArchiveImportError';
  throw error;
}

export function parseArguments(argv) {
  const options = { domain: 'auto', execute: false, workers: defaultWorkers, batchSize: defaultBatchSize };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--execute') options.execute = true;
    else if (['--input', '--drive-folder', '--domain', '--workers', '--batch-size', '--checkpoint'].includes(value)) {
      const next = argv[++index];
      if (!next) fail(`Missing value for ${value}.`);
      if (value === '--input') options.input = path.resolve(next);
      else if (value === '--drive-folder') options.driveFolder = next.trim();
      else if (value === '--domain') options.domain = next.trim().toLowerCase();
      else if (value === '--workers') options.workers = Number(next);
      else if (value === '--batch-size') options.batchSize = Number(next);
      else options.checkpoint = path.resolve(next);
    } else fail(`Unknown argument: ${value}`);
  }
  if (Boolean(options.input) === Boolean(options.driveFolder)) fail('Set exactly one of --input or --drive-folder.');
  if (!supportedDomains.has(options.domain)) fail('--domain must be auto, orders, reserves, or drive.');
  if (!Number.isInteger(options.workers) || options.workers < 1 || options.workers > 16) fail('--workers must be between 1 and 16.');
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > defaultBatchSize) fail('--batch-size must be between 1 and 2000.');
  return options;
}

export function historicalImportWindowOpen(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const minutes = (parts.hour % 24) * 60 + parts.minute;
  return minutes >= 23 * 60 + 30 || minutes < 6 * 60 + 15;
}

export function normalizeHeader(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function field(row, ...aliases) {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return null;
}

function numberValue(row, ...aliases) {
  const value = field(row, ...aliases);
  if (value === null) return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value, dateOnly = false) {
  if (!value) return null;
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) && numeric > 20_000 && numeric < 100_000
    ? new Date(Date.UTC(1899, 11, 30) + numeric * 86_400_000) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).trim() || null;
  return dateOnly ? parsed.toISOString().slice(0, 10) : parsed.toISOString();
}

function photoArray(row) {
  const values = ['photos', 'photo urls', 'photo links', 'photo_url', 'photo link'].flatMap(alias => {
    const value = field(row, alias);
    if (!value) return [];
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch {}
    return value.split(/[|;,\n]+/g);
  });
  return [...new Set(values.map(value => String(value || '').trim()).filter(value => /^https?:\/\//i.test(value)))];
}

function stableKey(domain, fileHash, rowNumber, sourceId) {
  return createHash('sha256').update(`${domain}|${fileHash}|${rowNumber}|${sourceId || ''}`).digest('hex');
}

function archiveStateText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function archiveStateNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : '0';
}

export function archiveRowStateHash(domain, row) {
  const values = domain === 'orders' ? [
    row.itemcode, row.locationcode, row.lotcode, row.customer_name, row.consignee_name, row.sales_rep,
    row.order_number, row.tripnumber, row.dock_num, row.drop_num, row.planstart,
    archiveStateNumber(row.qty_ordered), archiveStateNumber(row.unit_list_price), row.checker, row.inspector,
    row.mistake, row.dock_status, row.item_check_status, row.issue_status, row.issue_note, row.spec, row.caliper,
    row.av_note, row.pick_note, row.sales_note,
  ].map(archiveStateText).concat(String(row.photo_url ?? '')) : domain === 'reserves' ? [
    row.itemcode, row.locationcode, row.lotcode, row.customer_name, row.consignee_name, row.sales_rep,
    row.order_number, archiveStateNumber(row.qty_reserved), archiveStateNumber(row.unit_list_price),
    row.hold_stop_code, row.hold_stop_reason, row.spec, row.caliper, row.av_note, row.pick_note, row.sales_note,
  ].map(archiveStateText).concat(String(row.photo_url ?? '')) : [
    row.itemcode, row.commonname, row.contsize, row.locationcode, row.lotcode,
    archiveStateNumber(row.on_hand), archiveStateNumber(row.review), archiveStateNumber(row.available ?? row.ptravailable),
    archiveStateNumber(row.open_stock), archiveStateNumber(row.loc_photo_match), row.pri, row.hold_stop_code,
    row.hold_stop_reason, archiveStateNumber(row.unit_list_price), row.spec, row.caliper, row.av_note,
    row.pick_note, row.sales_note,
  ].map(archiveStateText).concat(String(row.photo_url ?? ''));
  return createHash('md5').update(values.join('|')).digest('hex');
}

function finalizeArchiveRow(domain, row, context) {
  const rowStateHash = archiveRowStateHash(domain, row);
  const primaryKey = tableContracts[domain].primaryKey;
  const seenAt = dateValue(context.modifiedTime) || new Date().toISOString();
  return {
    ...row,
    [primaryKey]: createHash('sha256').update(`${domain}|${archiveStateText(row.itemcode)}|${rowStateHash}`).digest('hex'),
    row_state_hash: rowStateHash,
    first_seen_at: seenAt,
    last_seen_at: seenAt,
    first_file_id: context.fileHash,
    last_file_id: context.fileHash,
    first_file_name: context.fileName,
    last_file_name: context.fileName,
    seen_count: 1,
  };
}

export function mapArchiveRow(domain, row, context) {
  const itemcode = field(row, 'itemcode', 'item code', 'code_item', 'sku');
  if (!itemcode) return null;
  const sourceId = field(row, 'unique_id', 'source_unique_id', 'id') || `${context.fileHash}:${context.rowNumber}`;
  const key = stableKey(domain, context.fileHash, context.rowNumber, sourceId);
  const photos = photoArray(row);
  const reportDate = dateValue(field(row, 'report_date', 'snapshot_date', 'file date', 'date') || context.modifiedTime, true);
  const common = {
    source_unique_id: sourceId, source_file_id: context.fileHash, source_file_name: context.fileName, report_date: reportDate,
    itemcode, commonname: field(row, 'commonname', 'common name', 'description', 'description_1_item'),
    contsize: field(row, 'contsize', 'container', 'size'), locationcode: field(row, 'locationcode', 'location', 'code_location'),
    lotcode: field(row, 'lotcode', 'lot', 'code_lot'), photos, photo_url: photos[0] || field(row, 'photo_url', 'photo link'),
    photo_date: field(row, 'photo_date', 'photo date'), spec: field(row, 'spec', 'itemspec', 'item spec'),
    caliper: field(row, 'caliper'), av_note: field(row, 'av_note', 'av note'), pick_note: field(row, 'pick_note', 'picknote', 'pick note'),
    sales_note: field(row, 'sales_note', 'salesnote', 'sales note'),
  };
  if (domain === 'orders') {
    const customer = field(row, 'customer_name', 'customername', 'customer') || 'Unassigned';
    const consignee = field(row, 'consignee_name', 'consigneename', 'consignee') || 'Unassigned';
    const trip = field(row, 'tripnumber', 'trip number', 'trip #', 'fm_trip_number_om_transaction_header');
    const dock = field(row, 'dock_num', 'dock', 'dock #');
    const drop = field(row, 'drop_num', 'stopnumber', 'drop', 'fm_pu_stop_number_om_transaction_header');
    const planstart = field(row, 'planstart', 'plan start');
    const quantity = numberValue(row, 'qty_ordered', 'quantityordered', 'ordered_quantity', 'quantity');
    const unitPrice = numberValue(row, 'unit_list_price', 'listprice', 'unitprice', 'price') || 0;
    return finalizeArchiveRow(domain, { ...common, order_line_key: key, source_kind: 'historical_file_import', sales_rep: field(row, 'sales_rep', 'salesrepname', 'sales rep'),
      customer_name: customer, consignee_name: consignee, customer_consignee_label: `${customer} | ${consignee}`,
      order_folder_key: [trip && `Trip ${trip}`, dock && `Dock ${dock}`, drop && `Drop ${drop}`, planstart && `PlanStart ${planstart}`].filter(Boolean).join(' • ') || context.fileName,
      order_number: field(row, 'order_number', 'transactionnumber', 'purchaseordernumber', 'reference'), tripnumber: trip, dock_num: dock,
      drop_num: drop, planstart, order_date: dateValue(field(row, 'order_date', 'requestdate', 'invoicedate', 'transaction_datetime')),
      checker: field(row, 'checker'), inspector: field(row, 'inspector'), mistake: field(row, 'mistake'), dock_status: field(row, 'dock_status', 'status'),
      item_check_status: field(row, 'item_check_status'), issue_status: field(row, 'issue_status', 'issue_state'), issue_note: field(row, 'issue_note'),
      issue_photos: photoArray({ photos: field(row, 'issue_photos', 'issue photo') }), qty_ordered: quantity, unit_list_price: unitPrice,
      line_dollar_value: numberValue(row, 'line_dollar_value', 'amount') ?? Math.round((quantity || 0) * unitPrice * 100) / 100,
      loc_match_pct: numberValue(row, 'loc_match_pct'), loc_photo_match: numberValue(row, 'loc_photo_match') }, context);
  }
  if (domain === 'reserves') {
    const salesRep = field(row, 'sales_rep', 'salesrepname', 'sales rep') || 'Unassigned';
    const customer = field(row, 'customer_name', 'customername', 'customer') || 'Unassigned';
    const consignee = field(row, 'consignee_name', 'consigneename', 'consignee') || 'Unassigned';
    const order = field(row, 'order_number', 'transactionnumber', 'purchaseordernumber');
    const quantity = numberValue(row, 'qty_reserved', 'reserve_qty', 'quantityordered', 'quantity');
    const unitPrice = numberValue(row, 'unit_list_price', 'listprice', 'unitprice', 'price') || 0;
    return finalizeArchiveRow(domain, { ...common, reserve_history_key: key, sales_rep: salesRep, customer_name: customer, consignee_name: consignee,
      customer_consignee_label: `${customer} | ${consignee}`, reserve_folder_key: [order, reportDate, context.fileName].filter(Boolean).join(' • '),
      order_number: order, qty_reserved: quantity, on_hand: numberValue(row, 'on_hand', 'ptronhand'),
      available_qty: numberValue(row, 'available_qty', 'ptravailable', 'available'), open_stock: numberValue(row, 'open_stock', 's_lts'),
      unit_list_price: unitPrice, line_dollar_value: numberValue(row, 'line_dollar_value', 'amount') ?? Math.round((quantity || 0) * unitPrice * 100) / 100,
      hold_stop_code: field(row, 'hold_stop_code', 'holdstopcode'), hold_stop_reason: field(row, 'hold_stop_reason', 'holdstopreason') }, context);
  }
  return finalizeArchiveRow(domain, { ...common, history_key: key, source_kind: 'historical_file_import', season: field(row, 'season'),
    ptravailable: numberValue(row, 'ptravailable', 'available'), on_hand: numberValue(row, 'on_hand', 'ptronhand'),
    review: numberValue(row, 'review', 'ptrreviewed'), available: numberValue(row, 'available', 'ptravailable'),
    open_stock: numberValue(row, 'open_stock', 's_lts'), pri: field(row, 'pri', 'priority'),
    unit_list_price: numberValue(row, 'unit_list_price', 'listprice', 'price'),
    loc_match_pct: numberValue(row, 'loc_match_pct'), loc_photo_match: numberValue(row, 'loc_photo_match'),
    hold_stop_code: field(row, 'hold_stop_code', 'holdstopcode'), hold_stop_reason: field(row, 'hold_stop_reason', 'holdstopreason'),
    archive_reason: 'historical_file_import' }, context);
}

export async function* parseCsvRows(stream) {
  let fieldValue = '', row = [], inQuotes = false, pendingQuote = false;
  const emit = () => { row.push(fieldValue); const value = row; fieldValue = ''; row = []; return value; };
  for await (const chunk of stream) {
    const text = chunk.toString('utf8');
    for (const character of text) {
      if (pendingQuote) {
        if (character === '"') { fieldValue += '"'; pendingQuote = false; continue; }
        inQuotes = false; pendingQuote = false;
      }
      if (inQuotes) {
        if (character === '"') pendingQuote = true;
        else fieldValue += character;
      } else if (character === '"' && fieldValue === '') inQuotes = true;
      else if (character === ',') { row.push(fieldValue); fieldValue = ''; }
      else if (character === '\n') yield emit();
      else if (character !== '\r') fieldValue += character;
    }
  }
  if (pendingQuote) inQuotes = false;
  if (inQuotes) fail('CSV_UNTERMINATED_QUOTED_FIELD');
  if (fieldValue !== '' || row.length) yield emit();
}

function decodeXml(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&#(x?[0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code.startsWith('x') ? code.slice(1) : code, code.startsWith('x') ? 16 : 10)));
}

function columnIndex(reference) {
  return [...String(reference).match(/^[A-Z]+/i)?.[0] || ''].reduce((total, letter) => total * 26 + letter.toUpperCase().charCodeAt(0) - 64, 0) - 1;
}

async function readZipEntries(filePath) {
  const zip = await new Promise((resolve, reject) => yauzl.open(filePath, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)));
  const entries = new Map();
  await new Promise((resolve, reject) => {
    zip.on('error', reject); zip.on('end', resolve); zip.on('entry', entry => {
      if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/.*\.xml)$/.test(entry.fileName)) { zip.readEntry(); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error) { reject(error); return; }
        const chunks = []; stream.on('data', chunk => chunks.push(chunk)); stream.on('error', reject);
        stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks).toString('utf8')); zip.readEntry(); });
      });
    });
    zip.readEntry();
  });
  return entries;
}

export async function xlsxValueRows(filePath) {
  const entries = await readZipEntries(filePath);
  const workbook = entries.get('xl/workbook.xml') || '';
  const relationships = entries.get('xl/_rels/workbook.xml.rels') || '';
  const relationshipId = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"/i)?.[1];
  const target = [...relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)].map(match => match[1]).map(attributes => ({
    id: attributes.match(/\bId="([^"]+)"/i)?.[1], target: attributes.match(/\bTarget="([^"]+)"/i)?.[1],
  })).find(entry => entry.id === relationshipId)?.target || 'worksheets/sheet1.xml';
  const sheetPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize(`xl/${target}`);
  const sheet = entries.get(sheetPath) || entries.get('xl/worksheets/sheet1.xml');
  if (!sheet) fail('XLSX_WORKSHEET_MISSING');
  const shared = [...(entries.get('xl/sharedStrings.xml') || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)]
    .map(match => decodeXml([...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(text => text[1]).join('')));
  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const values = [];
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const reference = cell[1].match(/\br="([^"]+)"/i)?.[1];
      const type = cell[1].match(/\bt="([^"]+)"/i)?.[1];
      const content = cell[2] || '';
      const raw = content.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1];
      const inline = [...content.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(match => match[1]).join('');
      const value = type === 's' ? shared[Number(raw)] ?? '' : type === 'inlineStr' ? decodeXml(inline) : decodeXml(raw || inline || '');
      values[Math.max(0, columnIndex(reference))] = value;
    }
    rows.push(values);
  }
  return rows;
}

export async function* objectRows(filePath, options = {}) {
  const extension = path.extname(filePath).toLowerCase();
  const values = extension === '.csv' ? parseCsvRows(fs.createReadStream(filePath)) : await xlsxValueRows(filePath);
  let headers = null;
  const requiredHeaders = (Array.isArray(options.requiredHeaders) ? options.requiredHeaders : [])
    .map(normalizeHeader).filter(Boolean);
  for await (const row of values) {
    if (!headers) {
      const candidates = row.map((value, index) => normalizeHeader(value) || `column${index + 1}`);
      if (requiredHeaders.some(header => !candidates.includes(header))) continue;
      headers = candidates;
      continue;
    }
    if (!row.some(value => String(value ?? '').trim())) continue;
    yield Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
  }
  if (!headers) fail('ARCHIVE_IMPORT_HEADER_MISSING');
}

export async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function localSources(input) {
  const found = [];
  const visit = async target => {
    const details = await fs.promises.stat(target);
    if (details.isDirectory()) {
      for (const name of await fs.promises.readdir(target)) await visit(path.join(target, name));
    } else if (supportedExtensions.has(path.extname(target).toLowerCase())) {
      found.push({ filePath: target, fileName: path.basename(target), modifiedTime: details.mtime.toISOString(), cleanup: async () => {} });
    }
  };
  await visit(input);
  return found.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

export async function driveSources(folderId) {
  const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const drive = google.drive({ version: 'v3', auth });
  const files = [];
  const collect = async parentId => {
    let pageToken;
    do {
      const response = await drive.files.list({ q: `'${parentId.replaceAll("'", "\\'")}' in parents and trashed=false`, pageToken,
        pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime)' });
      for (const file of response.data.files || []) {
        if (file.mimeType === 'application/vnd.google-apps.folder') await collect(file.id);
        else files.push(file);
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);
  };
  await collect(folderId);
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agdata-history-'));
  const sources = [];
  for (const file of files) {
    const googleSheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';
    const extension = googleSheet ? '.csv' : path.extname(file.name || '').toLowerCase();
    if (!supportedExtensions.has(extension)) continue;
    const filePath = path.join(tempRoot, `${file.id}${extension}`);
    const response = googleSheet
      ? await drive.files.export({ fileId: file.id, mimeType: 'text/csv' }, { responseType: 'stream' })
      : await drive.files.get({ fileId: file.id, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
    await pipeline(response.data, fs.createWriteStream(filePath));
    sources.push({ filePath, fileId: file.id, fileName: file.name || `${file.id}${extension}`, modifiedTime: file.modifiedTime,
      cleanup: async () => fs.promises.rm(filePath, { force: true }) });
  }
  return { sources, cleanup: async () => fs.promises.rm(tempRoot, { recursive: true, force: true }) };
}

function inferredDomain(fileName) {
  const normalized = fileName.toLowerCase();
  if (normalized.includes('reserve')) return 'reserves';
  if (normalized.includes('drive') || normalized.includes('inventory')) return 'drive';
  return 'orders';
}

function upsertSql(domain) {
  const contract = tableContracts[domain];
  const columns = Object.keys(contract.columns);
  const definitions = columns.map(column => `${column} ${contract.columns[column]}`).join(',');
  const tableName = contract.table.split('.').at(-1);
  const preserved = new Set([contract.primaryKey, 'first_seen_at', 'first_file_id', 'first_file_name', 'seen_count']);
  const updates = columns.filter(column => !preserved.has(column) && !['last_seen_at', 'last_file_id', 'last_file_name'].includes(column))
    .map(column => `${column}=excluded.${column}`);
  updates.push(`last_seen_at=greatest(${tableName}.last_seen_at,excluded.last_seen_at)`);
  updates.push('last_file_id=excluded.last_file_id', 'last_file_name=excluded.last_file_name');
  updates.push(`seen_count=${tableName}.seen_count+case when coalesce(${tableName}.last_file_id,${tableName}.last_file_name,'') is distinct from coalesce(excluded.last_file_id,excluded.last_file_name,'') then excluded.seen_count else 0 end`);
  return `insert into ${contract.table}(${columns.join(',')}) select ${columns.join(',')} from jsonb_to_recordset($1::jsonb) as incoming(${definitions}) on conflict(itemcode,row_state_hash) where row_state_hash is not null do update set ${updates.join(',')},updated_at=clock_timestamp()`;
}

function readEnvFile() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) return [];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[match[1], value]];
  }));
}

function checkpointPath(options) {
  if (options.checkpoint) return options.checkpoint;
  return options.input && fs.statSync(options.input).isDirectory()
    ? path.join(options.input, '.agdata-historical-archive-checkpoints.json')
    : path.join(os.homedir(), '.agdata', 'historical-archive-checkpoints.json');
}

async function readCheckpoint(filePath) {
  try { return JSON.parse(await fs.promises.readFile(filePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { version: 1, files: {} }; throw error; }
}

async function writeCheckpoint(filePath, checkpoint) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  await fs.promises.rename(temporary, filePath);
}

async function processSource(source, options, pool, checkpoint, checkpointFile) {
  const fileHash = await hashFile(source.filePath);
  const domain = options.domain === 'auto' ? inferredDomain(source.fileName) : options.domain;
  const checkpointKey = `${domain}:${fileHash}`;
  if (checkpoint.files[checkpointKey]?.complete) return { domain, file: source.fileName, status: 'checkpoint', rows: checkpoint.files[checkpointKey].rows };
  const sql = upsertSql(domain);
  const pending = new Set();
  let batch = [], rows = 0, skipped = 0, firstReportDate = null;
  const flush = async () => {
    if (!batch.length) return;
    const uniqueStates = new Map(batch.map(row => [`${archiveStateText(row.itemcode)}|${row.row_state_hash}`, row]));
    const payload = Array.from(uniqueStates.values()); batch = [];
    if (!options.execute) return;
    const operation = pool.query(sql, [JSON.stringify(payload)]).finally(() => pending.delete(operation));
    pending.add(operation);
    if (pending.size >= options.workers) await Promise.race(pending);
  };
  try {
    for await (const rawRow of objectRows(source.filePath)) {
      const mapped = mapArchiveRow(domain, rawRow, { fileHash, fileName: source.fileName, modifiedTime: source.modifiedTime, rowNumber: rows + skipped + 2 });
      if (!mapped) { skipped += 1; continue; }
      firstReportDate ||= mapped.report_date;
      batch.push(mapped); rows += 1;
      if (batch.length >= options.batchSize) await flush();
    }
    await flush();
    const settled = await Promise.allSettled(pending);
    const failed = settled.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    if (options.execute && domain === 'drive') await pool.query(`insert into public.ph_drive_mode_history_files(file_id,file_name,report_date,row_count,status,processed_at,archived_at,updated_at)
      values($1,$2,$3,$4,'imported',clock_timestamp(),clock_timestamp(),clock_timestamp()) on conflict(file_id) do update set
      file_name=excluded.file_name,report_date=excluded.report_date,row_count=excluded.row_count,status=excluded.status,processed_at=excluded.processed_at,updated_at=excluded.updated_at`,
      [fileHash, source.fileName, firstReportDate, rows]);
    if (options.execute) {
      checkpoint.files[checkpointKey] = { complete: true, domain, fileName: source.fileName, sha256: fileHash, rows, skipped, importedAt: new Date().toISOString() };
      await writeCheckpoint(checkpointFile, checkpoint);
    }
    return { domain, file: source.fileName, status: options.execute ? 'imported' : 'validated', rows, skipped, sha256: fileHash };
  } finally {
    await Promise.allSettled(pending);
  }
}

export async function runHistoricalArchiveImport(options) {
  if (options.execute && !historicalImportWindowOpen()) fail('HISTORICAL_IMPORT_WINDOW_CLOSED_2330_TO_0615_AMERICA_CHICAGO');
  const checkpointFile = checkpointPath(options);
  const checkpoint = await readCheckpoint(checkpointFile);
  const drive = options.driveFolder ? await driveSources(options.driveFolder) : null;
  const sources = drive?.sources || await localSources(options.input);
  if (!sources.length) fail('NO_SUPPORTED_CSV_OR_XLSX_FILES_FOUND');
  const localEnv = readEnvFile();
  const databaseUrl = process.env.HISTORICAL_ARCHIVE_DATABASE_URL || localEnv.GNC_SUPABASE_DB_URL
    || process.env.GNC_SUPABASE_DB_URL || process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (options.execute && !databaseUrl) fail('HISTORICAL_ARCHIVE_DATABASE_URL_MISSING');
  const pool = options.execute ? new Pool({ ...createDatabaseClientOptions(databaseUrl), max: options.workers }) : null;
  const started = performance.now();
  try {
    if (pool) {
      const contract = await pool.query("select to_regclass('public.ph_orders_history') is not null and to_regclass('public.ph_reserves_history') is not null and to_regclass('public.ph_drive_mode_history') is not null as ready");
      if (contract.rows[0]?.ready !== true) fail('HISTORICAL_ARCHIVE_MIGRATION_REQUIRED');
    }
    const results = [];
    for (const source of sources) {
      try { results.push(await processSource(source, options, pool, checkpoint, checkpointFile)); }
      finally { await source.cleanup(); }
    }
    const rows = results.reduce((total, result) => total + Number(result.rows || 0), 0);
    return { execute: options.execute, files: results.length, rows, elapsedMs: Math.round(performance.now() - started),
      rowsPerSecond: Math.round(rows / Math.max(0.001, (performance.now() - started) / 1000)), results };
  } finally {
    if (pool) await pool.end();
    if (drive) await drive.cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHistoricalArchiveImport(parseArguments(process.argv.slice(2))).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
