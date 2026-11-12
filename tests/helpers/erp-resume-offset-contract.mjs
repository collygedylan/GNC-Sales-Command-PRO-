import assert from 'node:assert/strict';

export async function assertErpResumedOffset() {
  const { runErpSyncWorkerStep } = await import('../../supabase/functions/_shared/erp-sync.mjs');
  const statuses = [];
  const folderSnapshot = Object.fromEntries(['drive', 'cav', 'reserves', 'soc', 'hl_po_parsed']
    .map(key => [key, { files: [], listDurationMs: 0 }]));
  const file = { id: 'resume-file-104', name: 'Resume.xlsx', modifiedTime: '2026-10-28T12:00:00Z', parents: ['drive-folder'] };
  const cursor = { stageIndex: 0, stageResults: [], attemptedByStage: {}, folderSnapshot,
    fileContinuation: { stageIndex: 0, file, state: { stageId: 'stage-resume-104', expectedRows: 50000,
      expectedRowsPending: true, nextOffset: 12000, processedRows: 8000, identityCounts: {},
      headerRowIndex: 1, header: ['itemcode'] } } };
  const folders = { drive: 'drive-folder', cav: 'cav-folder', reserves: 'reserves-folder',
    soc: 'soc-folder', hl_po_parsed: 'hl-folder' };
  const env = key => key === 'ERP_SYNC_DROP_FOLDERS_JSON' ? JSON.stringify(folders) : '';
  const supabase = { rpc: async name => name === 'check_erp_file_sync_needed_v1' ? { data: { skip: false } } : { data: null } };
  await assert.rejects(runErpSyncWorkerStep({ supabase,
    fetcher: async () => { throw new Error('fixture resumed download fault'); },
    status: async patch => statuses.push(patch), env, accessToken: 'fixture-token', cursor
  }), /fixture resumed download fault/);
  const firstPersistedCursor = statuses[0].continuationCursor;
  assert.equal(firstPersistedCursor.stageIndex, 0);
  assert.equal(firstPersistedCursor.fileContinuation.file.id, file.id);
  assert.equal(firstPersistedCursor.fileContinuation.state.nextOffset, 12000);
  assert.equal(firstPersistedCursor.fileContinuation.state.processedRows, 8000);
  assert.equal(statuses.length, 2, 'the durable cursor precedes the resumed phase announcement and download');
  assert.equal(statuses[1].sourceProgressDelta.stage,'staging');
}
