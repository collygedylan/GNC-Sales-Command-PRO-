// @test-group: sync
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FAST_LIVE_BATCH_SIZE,
  buildFastAtomicSwapSql,
  buildFastBatchSql,
  buildFastStageRpcSql,
  inferLiveDataset,
  parseFastLiveArguments,
  shouldIncludeSocLiveRow
} from '../scripts/fast-live-erp-sync.mjs';

test('fast live ERP batches stay bounded at 1,000 rows', () => {
  const rows = Array.from({ length: FAST_LIVE_BATCH_SIZE }, (_, index) => ({ unique_id: `row-${index}`, itemcode: `item-${index}` }));
  const sql = buildFastBatchSql('_stage', rows, ['unique_id', 'itemcode']);
  assert.equal(FAST_LIVE_BATCH_SIZE, 1000);
  assert.match(sql, /jsonb_populate_recordset/);
  assert.match(sql, /insert into public\."_stage"/);
  assert.equal(JSON.parse(sql.split('$rows$')[1]).length, 1000);
});

test('SOC selection retains every Dock row and dockless Suspend-to-DC row', () => {
  assert.equal(shouldIncludeSocLiveRow({ dock: 'Dock 30' }), true);
  assert.equal(shouldIncludeSocLiveRow({ dock: '', suspend: 'SUSPEND', suspendto: 'dc' }), true);
  assert.equal(shouldIncludeSocLiveRow({ dock: '', suspend: 'SUSPEND', suspendto: 'ew' }), false);
  assert.equal(shouldIncludeSocLiveRow({ dock: '', suspend: '', suspendto: '' }), false);
});

test('SOC trailing-dot canonicalization is guarded set-based, exact-location/lot, and preserves physical row identity', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261029170500_agdata_v23104_docks_suspend.sql', import.meta.url), 'utf8');
  assert.match(migration, /^begin;\s+set local lock_timeout='2s';\s+set local statement_timeout='30s';/i);
  assert.match(migration, /after insert on public\.ph_master_inventory\s+referencing new table as new_inventory_rows\s+for each statement/i);
  assert.match(migration, /after update on public\.ph_master_inventory\s+referencing new table as new_inventory_rows\s+for each statement/i);
  assert.match(migration, /after insert on public\.ph_soc_master\s+referencing new table as new_soc_rows\s+for each statement/i);
  assert.match(migration, /after update on public\.ph_soc_master\s+referencing new table as new_soc_rows\s+for each statement/i);
  assert.match(migration, /join public\.ph_master_inventory as inventory/i);
  const bulkWrapper = migration.slice(migration.indexOf('create or replace function public.bulk_import_master_snapshot_v1'), migration.indexOf('create or replace function public.finalize_master_snapshot_stage_v1'));
  const stagedWrapper = migration.slice(migration.indexOf('create or replace function public.finalize_master_snapshot_stage_v1'), migration.indexOf('drop trigger if exists ph_master_normalize_soc_itemcode_insert_v23104'));
  const masterTrigger = migration.slice(migration.indexOf('create or replace function private.normalize_soc_itemcode_from_master_v23104'), migration.indexOf('revoke all on function private.normalize_soc_itemcode_from_master_v23104'));
  const socTrigger = migration.slice(migration.indexOf('create or replace function private.normalize_soc_itemcode_after_import_v23104'), migration.indexOf('revoke all on function private.normalize_soc_itemcode_after_import_v23104'));
  assert.match(bulkWrapper, /enable trigger user[\s\S]*normalize_soc_itemcode_from_pairs_v23104\(p_rows\)/i);
  assert.match(stagedWrapper, /select coalesce\(jsonb_agg[\s\S]*from app_sync_private\.ph_master_snapshot_stage_rows_v1[\s\S]*finalize_master_snapshot_stage_v2374_base[\s\S]*normalize_soc_itemcode_from_pairs_v23104\(normalization_pairs\)/i);
  assert.doesNotMatch(bulkWrapper + stagedWrapper, /normalize_soc_itemcode_from_current_master_v23104/i,
    'import hooks resolve only the changed master pairs');
  assert.match(masterTrigger, /if not exists\(select 1 from new_inventory_rows[\s\S]*then return null; end if;\s+with impacted_prefixes/i,
    'empty master transitions stop before querying or updating SOC');
  assert.match(socTrigger, /if not exists\(select 1 from new_soc_rows[\s\S]*right\(btrim\(itemcode\),1\)='\.'[\s\S]*then return null; end if;\s+with changed_soc/i,
    'canonical SOC updates exit before the AFTER STATEMENT update can recurse');
  assert.match(migration, /count\(distinct c\.itemcode\)=1/i);
  assert.match(migration, /c\.locationcode=upper\(btrim\(soc\.locationcode\)\)[\s\S]*c\.lotcode=upper\(btrim\(soc\.lotcode\)\)/i);
  assert.ok(migration.includes("upper(btrim(inventory.itemcode))>=changed.item_prefix||'.'"));
  assert.ok(migration.includes("upper(btrim(inventory.itemcode))<changed.item_prefix||'/'"));
  assert.match(migration, /from new_inventory_rows as changed[\s\S]*join public\.ph_soc_master as soc/i);
  assert.match(migration, /where right\(btrim\(soc\.itemcode\),1\)='\.'/i, 'already-canonical rows return without recursive updates');
  assert.doesNotMatch(migration, /group by upper\(btrim\(itemcode\)\),upper\(btrim\(locationcode\)\),upper\(btrim\(lotcode\)\)/i,
    'normalization must not aggregate the entire master inventory');
  assert.match(migration, /set itemcode=matched\.itemcode[\s\S]*where soc\.unique_id=matched\.unique_id/i);
  assert.doesNotMatch(migration, /for each row/i);
  assert.match(migration, /fast_commit_erp_stage_swap_v1/i);
});

test('Warehouse Assigned Items cannot be selected as a recurring ERP ingestion dataset', () => {
  assert.throws(() => parseFastLiveArguments(['--input', 'warehouse.xlsx', '--dataset', 'warehouse_assigned']),
    /FAST_LIVE_ERP_DATASET_INVALID/);
});

test('fast live multi-source execution orders Drive, CAV, Reserves, then SOC and excludes temp sources', () => {
  const source = readFileSync(new URL('../scripts/fast-live-erp-sync.mjs', import.meta.url), 'utf8');
  assert.match(source, /const datasetOrder = \['drive_around', 'cav', 'reserves', 'soc'\];[\s\S]*\.sort\(\(left, right\) => datasetOrder\.indexOf\(left\[0\]\) - datasetOrder\.indexOf\(right\[0\]\)\)/);
  assert.equal(inferLiveDataset('TEMP_IMPORT_drive.xlsx'), null);
  assert.equal(inferLiveDataset('~$DriveAround.xlsx'), null);
  assert.equal(inferLiveDataset('DriveAround.xlsx'), 'drive_around');
});

test('fast live CLI executes only the service-role durable staged importer', () => {
  const begin = buildFastStageRpcSql({ rpc: 'fast_begin_erp_stage_v1', args: {
    p_dataset_key: 'drive_around', p_file_meta: { file_id: 'f1' }, p_expected_rows: 1001
  } });
  const append = buildFastStageRpcSql({ rpc: 'fast_append_erp_stage_batch_v1', args: {
    p_stage_id: '11111111-1111-1111-1111-111111111111', p_start_row: 1000,
    p_rows: [{ values: { unique_id: 'erp-1' }, rawFields: ['unique_id'] }]
  } });
  const commit = buildFastStageRpcSql({ rpc: 'fast_commit_erp_stage_swap_v1', args: {
    p_stage_id: '11111111-1111-1111-1111-111111111111'
  } });
  for (const sql of [begin, append, commit]) {
    assert.match(sql, /set_config\('request\.jwt\.claim\.role','service_role',false\)/);
    assert.match(sql, /select public\.fast_/);
  }
  assert.match(begin, /fast_begin_erp_stage_v1/);
  assert.match(begin, /fast_begin_erp_stage_v1\('drive_around'::text,[^]*::jsonb,1001::integer\)/);
  assert.match(append, /fast_append_erp_stage_batch_v1/);
  assert.match(append, /fast_append_erp_stage_batch_v1\('11111111-1111-1111-1111-111111111111'::uuid,1000::integer,[^]*::jsonb\)/);
  assert.match(commit, /fast_commit_erp_stage_swap_v1/);
  assert.match(commit, /fast_commit_erp_stage_swap_v1\('11111111-1111-1111-1111-111111111111'::uuid\)/);
  const source = readFileSync(new URL('../scripts/fast-live-erp-sync.mjs', import.meta.url), 'utf8');
  assert.match(source, /callFastStageRpc\('fast_begin_erp_stage_v1'/);
  assert.match(source, /callFastStageRpc\('fast_append_erp_stage_batch_v1'/);
  assert.match(source, /callFastStageRpc\('fast_commit_erp_stage_swap_v1'/);
  assert.doesNotMatch(source.slice(source.indexOf('export async function runFastLiveErpSync'), source.indexOf("if (import.meta.url")),
    /buildFastAtomicSwapSql\(|truncate table/);
});

test('all four ERP atomic swaps suppress user triggers and publish READY metadata', () => {
  for (const [dataset, table] of Object.entries({ drive_around: 'ph_master_inventory', soc: 'ph_soc_master', reserves: 'ph_reserves', cav: 'ph_cav_import' })) {
    const sql = buildFastAtomicSwapSql({
      dataset,
      contract: { table, preserve: [] },
      stageTable: `_stage_${dataset}`,
      mergedTable: `_merged_${dataset}`,
      rowCount: 1,
      columns: ['unique_id'],
      usedColumns: ['unique_id'],
      meta: { file_id: 'hash', file_name: `${dataset}.xlsx`, modified_at: '2026-10-26T21:00:00Z', content_hash: 'hash' }
    });
    assert.match(sql, new RegExp(`alter table public\\."${table}" disable trigger user`));
    assert.match(sql, new RegExp(`truncate table public\\."${table}"`));
    assert.match(sql, new RegExp(`alter table public\\."${table}" enable trigger user`));
    assert.match(sql, /state='ready'/);
  }
  const source = readFileSync(new URL('../scripts/fast-live-erp-sync.mjs', import.meta.url), 'utf8');
  const archiveSource = readFileSync(new URL('../scripts/fast-historical-archive-import.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from 'pg'|GNC_SUPABASE_DB_URL|new Pool/);
  assert.match(source, /\['db', 'query', '--linked', '--file', filePath\]/);
  assert.match(source, /objectRows\(filePath, \{ requiredHeaders: \['itemcode'\] \}\)/);
  assert.match(source, /check\.skip && Number\(checkResult\.row_count\) === rows\.length/);
  assert.match(archiveSource, /\(\?:\\\/\>\|\>\(\[\\s\\S\]\*\?\)\<\\\/c\>\)/);
});
