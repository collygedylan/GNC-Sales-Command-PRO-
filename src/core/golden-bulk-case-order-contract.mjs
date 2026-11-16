import assert from 'node:assert/strict';
import {runBulkMasterCases} from '../services/bulk-master-http-run.mjs';

export function assertIndexedArchive(read) {
  const migration = read('supabase/migrations/20261025220000_agdata_v2366_historical_archive.sql');
  for (const table of ['ph_orders_history', 'ph_reserves_history', 'ph_drive_mode_history_files', 'ph_drive_mode_history']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`${table}[^]*create index|create index[^]*${table}`));
  }
  for (const marker of ['historical_archive_read_v1', 'ph_soc_master_archive_v2366', 'ph_reserves_archive_v2366',
    'ph_drive_files_archive_v2366', 'ph_drive_evidence_archive_v2366', 'HISTORICAL_ARCHIVE_RETENTION_PROTECTED',
    'HISTORICAL_PHOTO_RETENTION_PROTECTED', 'row.file_id=path_2', 'source.itemcode=dimension.itemcode']) assert.match(migration, new RegExp(marker));
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i);
  assert.doesNotMatch(migration, /(?:^|\n)\s*truncate\s/i);
  assert.doesNotMatch(migration, /count\(\*\)[^;]*ph_drive_around_report_rows/i);

  const view = read('components/historical-requests/HistoricalRequestsView.tsx');
  for (const label of ['Historical Requests', 'Historical SOC Open Orders', 'Historical SOC Reserves', 'Historical Drive Around']) {
    assert.match(view, new RegExp(label));
  }
  assert.match(view, /Search this archive/);
  const importer = read('scripts/fast-historical-archive-import.mjs');
  for (const marker of ['defaultBatchSize = 2_000', 'defaultWorkers = 16', 'jsonb_to_recordset', 'sha256',
    'historicalImportWindowOpen', 'application\/vnd\.google-apps\.spreadsheet', 'supportedExtensions = new Set']) assert.match(importer, new RegExp(marker));
  assert.match(importer, /'\.csv', '\.xlsx'/);
  assert.match(read('assets/app-runtime.js'), /\['master', 'soc', 'reserves', 'requests', 'requestHistory', 'customerRepMap'\]/);
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'), /agdataV2366HistoricalArchiveMigrationName[^]*registeredReleaseDatabaseMigrations/);
}

export async function assertBulkCaseIsolation() {
  const ctx={state:{tableColumns:Array(233),masterImportFieldCount:78,
    masterProductionTriggerCount:53,sourceByteCount:1},appEdited:false};
  const changed={milliseconds:2,protectedId:'exact-row',protectedBefore:{locationnote:'retained'}};
  const output=[];
  let checkedMetadata=false;
  const operations={prepareBulkHandoverIdentity:async()=>{},verifyBulkActionSqlContract:async()=>{},
    scheduleBulkHandover:async()=>{},seedBulkMasterFixture:async()=>{},
    assertInitialBulkPublication:async()=>({insert:1,replay:1}),
    assertUnchangedBulkPublication:async current=>{
      assert.equal(current.appEdited,false,'metadata-only publication cannot follow an app mutation');
      checkedMetadata=true;return 0;
    },
    assertChangedBulkPublication:async current=>{
      assert.equal(checkedMetadata,true);current.appEdited=true;return changed;
    },
    assertAtomicBulkRollback:async(current,receipt)=>{assert.equal(current.appEdited,true);assert.equal(receipt,changed);},
    assertLegacyBulkBootstrap:async(current,receipt)=>{assert.equal(current.appEdited,true);assert.equal(receipt,changed);return 3;}};
  await runBulkMasterCases(ctx,operations,line=>output.push(line));
  assert.equal(output.length,2);
  const failure=new Error('metadata-only case failed');
  let laterCases=0;
  await assert.rejects(runBulkMasterCases({...ctx,appEdited:false},{...operations,
    assertUnchangedBulkPublication:async()=>{throw failure;},
    assertChangedBulkPublication:async()=>{laterCases++;return changed;}},()=>{laterCases++;}),error=>error===failure);
  assert.equal(laterCases,0,'failed metadata verification cannot run dependent edits or emit a success summary');
}
