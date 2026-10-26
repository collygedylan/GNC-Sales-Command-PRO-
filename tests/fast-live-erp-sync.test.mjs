// @test-group: sync
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FAST_LIVE_BATCH_SIZE,
  buildFastAtomicSwapSql,
  buildFastBatchSql,
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
