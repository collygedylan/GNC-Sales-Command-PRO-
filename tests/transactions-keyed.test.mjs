import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const code = read('Code.gs');
const html = read('index.html');
const migration = read('supabase/migrations/20260827113846_transactions_keyed_manager_dashboard.sql');

const expectedHeaders = [
  'Transaction Date', 'Invoice Date', 'Commit Date', 'Code - Item',
  'Description 1 - Item', 'Code - Lot', 'Code - Location', 'Source',
  'Code 2 - Detail', 'DesigItem', 'Code 5 - Detail', 'DesigCust',
  'Code 3 - Detail', 'DesigLoc', 'Code 4 - Detail',
  'Out Ordered - Transaction Location', 'Quantity', 'Code 1 - Detail',
  'Reference', 'Status', 'Created By - Detail', 'Transaction Number',
  'Date 1 - Detail', 'Reference 1 - Detail', 'Reference 2 - Detail',
  'Program', 'Module', 'Transaction Type', 'Stage',
  'Shipping Date - OM Transaction Header', 'Ship To Name - OM Transaction Header',
  'FM PU Stop Number - OM Transaction Header', 'FM Trip Number - OM Transaction Header',
  'Ordered Quantity', 'Shipped Quantity - OM Transaction Detail', 'Price', 'Amount',
  'Reference 1 - Lot', 'Reference 2 - Lot', 'Reference 4 - Lot'
];

test('Transactions Keyed importer uses the exact supplied 40-column contract', () => {
  const block = code.slice(
    code.indexOf('const TRANSACTIONS_KEYED_COLUMNS'),
    code.indexOf('function normalizeTransactionsKeyedHeader_')
  );
  const actualHeaders = [...block.matchAll(/header:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(actualHeaders, expectedHeaders);
  assert.equal(actualHeaders.length, 40);
  assert.match(code, /getDisplayValues\(\)/);
  assert.match(code, /column\.type === 'text'[\s\S]*\? displayValue/);
  assert.match(code, /column\.type === 'number'[\s\S]*parseTransactionsKeyedNumber_/);
  assert.match(code, /column\.type === 'datetime'[\s\S]*parseTransactionsKeyedDateTime_/);
});

test('five-minute sync has a bounded retry-safe Transactions Keyed stage', () => {
  assert.match(code, /TRANSACTIONS_KEYED_PENDING_FOLDER_ID = '1aP8zvY9SwOEV3ThcQf7t9oBBinEr3gMe'/);
  assert.match(code, /TRANSACTIONS_KEYED_PROCESSED_FOLDER_ID = '1glpzw3zr1Q2YyNj2OtD_O5fBBFpPe78Q'/);
  assert.match(code, /TRANSACTIONS_KEYED_MAX_FILES_PER_RUN = 3/);
  assert.match(code, /MANUAL_SYNC_STAGE_ORDER_DEFAULT[^\n]*'transactions_keyed'/);
  assert.match(code, /getTransactionsKeyedFileHash_[\s\S]*DigestAlgorithm\.SHA_256/);
  assert.match(code, /prepare_transactions_keyed_import/);
  assert.match(code, /finalize_transactions_keyed_import/);
  assert.match(code, /mark_transactions_keyed_file_archived/);
  assert.match(code, /moveDriveFileToFolderWithRetry_[\s\S]*mark_transactions_keyed_file_archived/);
  assert.match(code, /Keeping|file remains pending/i);
});

test('database contract activates only complete canonical files and isolates writes', () => {
  assert.match(migration, /create table if not exists public\.ph_transactions_keyed_files/);
  assert.match(migration, /create table if not exists public\.ph_transactions_keyed_rows/);
  assert.match(migration, /primary key \(drive_file_id, content_sha256, source_sheet_name, source_row_number\)/);
  assert.match(migration, /transaction_datetime timestamp without time zone/);
  assert.match(migration, /transaction_business_date date generated always as \(transaction_datetime::date\) stored/);
  assert.match(migration, /created_by_key text generated always as \(lower\(btrim\(coalesce\(created_by_detail, ''\)\)\)\) stored/);
  assert.match(migration, /if imported_count <> expected_row_count/);
  assert.match(migration, /status = 'archive_pending'/);
  assert.match(migration, /where f\.status = 'processed'[\s\S]*f\.duplicate_of_drive_file_id is null/);
  assert.match(migration, /alter table public\.ph_transactions_keyed_files enable row level security/);
  assert.match(migration, /alter table public\.ph_transactions_keyed_rows enable row level security/);
  assert.match(migration, /revoke all on table public\.ph_transactions_keyed_files from public, anon, authenticated/);
  assert.match(migration, /revoke all on table public\.ph_transactions_keyed_rows from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.ph_transactions_keyed_rows to service_role/);
  assert.match(migration, /revoke all on function public\.prepare_transactions_keyed_import[\s\S]*from public, anon, authenticated/);
});

test('dashboard access and percentage denominators follow the manager-only policy', () => {
  assert.match(migration, /in \('dylan_collyge', 'megan_kelly', 'jd_jones'\)/);
  assert.match(migration, /language plpgsql[\s\S]*stable[\s\S]*security invoker[\s\S]*get_transactions_keyed_dashboard|create or replace function public\.get_transactions_keyed_dashboard[\s\S]*security invoker/);
  assert.match(migration, /d\.day_count::numeric \/ dt\.total_count/);
  assert.match(migration, /h\.historical_count::numeric \/ ht\.total_count/);
  assert.match(migration, /r\.created_by_key <> ''/);
  assert.match(migration, /r\.transaction_business_date is not null/);
  assert.match(html, /const MANAGER_TRANSACTIONS_KEYED_VIEW = 'transactions-keyed'/);
  assert.match(html, /canViewTransactionsKeyed: canViewTransactionsKeyed\(\)/);
  assert.match(html, /label: 'Transactions Keyed'/);
  assert.match(html, /supabaseRpc\('get_transactions_keyed_dashboard'/);
  assert.match(html, /Date View/);
  assert.match(html, /All Dates/);
  assert.match(html, /Processed Files/);
  assert.match(html, /requestToken !== state\.requestToken/);
});
