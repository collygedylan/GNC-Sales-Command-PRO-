import assert from 'node:assert/strict';

export function assertDriveFastIngestTimeout(read) {
  const migration = read('supabase/migrations/20261026190000_agdata_v2373_drive_timeout_recovery.sql');
  const code = read('Code.gs');
  const packageJson = JSON.parse(read('package.json'));
  assert.match(migration, /alter function public\.fast_ingest_drive_around_v1\(jsonb,jsonb\)[^]*statement_timeout='120s'/);
  assert.match(migration, /V2373_DRIVE_TIMEOUT_RECOVERY_MISSING/);
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'), /agdataV2373DriveTimeoutRecoveryMigrationName[^]*statement_timeout=120s/);
  assert.match(code, /return logical === 'ph_master_inventory' \|\| logical === 'ph_soc_master' \|\| logical === 'ph_reserves'/);
  assert.ok(packageJson.appsScriptPatchFunctions.includes('isCheckpointedLatestImportTable_'));
  assert.match(read('.codex/skills/agdata-sync-and-supabase-architect/SKILL.md'), /Never give the outer Drive fast-ingest RPC a shorter timeout/);
}

export function assertDriveSnapshotReplacesRows(runFunctions) {
  const ghost = { UNIQUE_ID: 'gone', LOCATIONCODE: 'A.01.000', PTRONHAND: 140 };
  const current = [
    { UNIQUE_ID: 'current-f1', LOCATIONCODE: 'B.02.000', PTRONHAND: 119 },
    { UNIQUE_ID: 'current-s1', LOCATIONCODE: 'B.02.000', PTRONHAND: 250 },
  ];
  const state = runFunctions('src/core/loaded-inventory-master.js',
    ['installLoadedMasterRows', 'preserveLoadedMasterEvidence'], {
      fullInventory: [ghost, ...current],
      confirmedDriveEvidenceRows: new Map([[ghost.UNIQUE_ID, ghost]]),
      preserveConfirmedDriveEvidence: row => row,
      scopeMasterInventoryRowsForCurrentUser: rows => rows,
      buildSearchIndex: row => row,
      normalizeRowPhotoFields: row => row,
      applyMasterAppTabAssignments: () => {},
    });
  state.installLoadedMasterRows({ data: current }, { avOpenByMasterId: new Map() });
  assert.equal(state.fullInventory, current);
  assert.deepEqual(state.fullInventory.map(row => row.UNIQUE_ID), ['current-f1', 'current-s1']);
  assert.equal(state.fullInventory.reduce((sum, row) => sum + row.PTRONHAND, 0), 369);
}
