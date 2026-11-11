import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { listErpSourceFiles, moveProcessed, stageFileContinuation } from '../supabase/functions/_shared/erp-sync.mjs';
import { prefetchSecondaryFolders, runSecondaryErpSyncStep } from '../supabase/functions/_shared/erp-secondary-sync.mjs';
import { parseLegacyErpPage } from '../src/core/erp-legacy-workbook.mjs';
import { finishStageContinuation, isConfirmedPendingStageReceipt } from '../supabase/functions/_shared/erp-stage-publication.mjs';
import { fixtureErpReceipt } from '../src/core/erp-runtime-fetch-fixtures.mjs';
import { withErpStageCheckRecording } from '../supabase/functions/_shared/erp-browser-start.ts';
import { moveVerifiedErpFile } from '../src/core/erp-archive-receipt.mjs';

const folderMime = 'application/vnd.google-apps.folder';
const workbookMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function entry(id, name, parent, mimeType = workbookMime) {
  return { id, name, mimeType, parents: [parent], modifiedTime: '2026-11-11T12:46:50Z' };
}

function driveFixture(entries, visited = []) {
  return async input => {
    const url = new URL(input);
    const query = url.searchParams.get('q') || '';
    const parent = query.match(/'([^']+)' in parents/)?.[1];
    if (parent) { visited.push(parent); return Response.json({ files: entries.filter(item => item.parents.includes(parent)) }); }
    if (url.pathname.endsWith('/files/drop')) return Response.json({ id: 'drop', parents: ['outer'] });
    return Response.json({ files: [] });
  };
}

test('Drive discovers every pending spreadsheet in root and nested drop folders', async () => {
  const entries = [
    entry('nested', 'DriveAround', 'drop', folderMime),
    entry('archive', 'Archive', 'drop', folderMime),
    entry('root-file', 'DylanDriveAround.xlsx', 'drop'),
    entry('nested-file', 'DriveAround-other.csv', 'nested', 'text/csv'),
    entry('generic-file', 'new.xlsx', 'nested', 'application/x-vendor-sheet'),
    entry('legacy-file', 'older.xls', 'nested', 'application/vnd.ms-excel'),
    entry('lock-file', '~$editing.xlsx', 'drop'),
    entry('archived', 'DriveAround-old.xlsx', 'processed'),
    entry('archive-file', 'DriveAround-archive.xlsx', 'archive'),
  ];
  const visited = [];
  const files = await listErpSourceFiles(driveFixture(entries, visited), 'token',
    { drive: 'drop', processed: { drive: 'processed' } }, { key: 'drive' }, { pendingOnly: true });
  assert.deepEqual(files.map(file => file.id).sort(), ['generic-file', 'legacy-file', 'nested-file', 'root-file']);
  assert.ok(files.every(file => !file.supersededFiles?.length));
  assert.deepEqual(visited.sort(), ['drop', 'nested']);
});

test('an empty pending folder never chooses a previously processed workbook', async () => {
  const entries = [entry('archived', 'DriveAroundMC-10-12000020261110120000.xlsx', 'processed')];
  const files = await listErpSourceFiles(driveFixture(entries), 'token',
    { drive: 'drop', processed: { drive: 'processed' } }, { key: 'drive' }, { pendingOnly: true });
  assert.deepEqual(files, []);
});

test('HL PO discovers each pending PDF and excludes Processed files and temporary files', async () => {
  const entries = [
    entry('first', 'HL PO first.pdf', 'hl-drop', 'application/pdf'),
    entry('second', 'HL PO second.pdf', 'hl-drop', 'application/pdf'),
    entry('temp', 'TEMP_hl.pdf', 'hl-drop', 'application/pdf'),
    entry('old', 'HL PO old.pdf', 'hl-processed', 'application/pdf'),
  ];
  const stages = [{ key: 'hl_po_parsed', folder: 'hl-drop', processed: 'hl-processed', includeParent: true }];
  const snapshot = await prefetchSecondaryFolders(driveFixture(entries), 'token', stages, { pendingOnly: true });
  assert.deepEqual(snapshot.hl_po_parsed.files.map(file => file.id).sort(), ['first', 'second']);
});

test('manual HL PO processes each pending PDF before its archive move', async () => {
  const files = [entry('a', 'first.pdf', 'drop', 'application/pdf'), entry('b', 'second.pdf', 'drop', 'application/pdf')];
  const events = [], parents = new Map();
  const checksum = createHash('sha256').update('fixture PDF').digest('hex');
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/hl-po-pdf-import')) {
      const payload = JSON.parse(options.body);
      events.push(`publish:${payload.source_file_id}`);
      return Response.json({ ok: true, run_id: `receipt:${payload.source_file_id}`, next_page: null, total_rows: 1 });
    }
    const id = url.pathname.split('/').at(-1);
    if (options.method === 'PATCH') {
      events.push(`archive:${id}`);
      parents.set(id, [url.searchParams.get('addParents')]);
      return Response.json({ id });
    }
    if (url.searchParams.get('alt') === 'media') return new Response('fixture PDF');
    return Response.json({ id, parents: parents.get(id) || ['drop'], version: '1', sha256Checksum: checksum });
  };
  const args = { supabase: { rpc: async () => { throw new Error('filename skip should not be consulted'); } },
    fetcher, accessToken: 'token', env: () => 'https://fixture.test', status: async () => {}, operationalOnly: true };
  let result = await runSecondaryErpSyncStep({ ...args,
    cursor: { secondaryFolders: { hl_po_parsed: { files, listDurationMs: 0 } } } });
  result = await runSecondaryErpSyncStep({ ...args, cursor: result.cursor });
  assert.equal(result.done, true);
  assert.deepEqual(events, ['publish:a', 'archive:a', 'publish:b', 'archive:b']);
});

test('archive moves only the file with a confirmed publication', async () => {
  const requests = [];
  const fetcher = async (input, options) => {
    const url = new URL(input);
    requests.push([url.pathname, options.method]);
    return Response.json({ id: 'confirmed', parents: ['drop'] });
  };
  const file = entry('confirmed', 'DriveAround.xlsx', 'drop');
  file.supersededFiles = [entry('other', 'old.xlsx', 'drop')];
  await moveProcessed(fetcher, 'token', file, 'drop', 'processed');
  assert.deepEqual(requests, [
    ['/drive/v3/files/confirmed', 'GET'], ['/drive/v3/files/confirmed', 'PATCH']
  ]);
});

test('archive leaves a file in place if its Drive revision changed during publication', async () => {
  let moves = 0;
  const file = { ...entry('confirmed', 'DriveAround.xlsx', 'drop'), md5Checksum: 'original-md5' };
  const fetcher = async (_, options) => {
    if (options.method === 'PATCH') moves += 1;
    return Response.json({ id: file.id, parents: ['drop'], modifiedTime: file.modifiedTime, md5Checksum: 'new-md5' });
  };
  await assert.rejects(moveProcessed(fetcher, 'token', file, 'drop', 'processed'), /ERP_DRIVE_SOURCE_CHANGED_BEFORE_ARCHIVE/);
  assert.equal(moves, 0);
});

function archiveFixture(mode = 'normal') {
  const state = { parents: ['drop'], version: 1, hash: 'a'.repeat(64), patches: [] };
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    if (options.method === 'PATCH') {
      state.patches.push(options.headers['if-match']);
      state.parents = url.searchParams.get('addParents').split(',').filter(Boolean);
      state.version += 1;
      if (mode === 'changed-after' && state.parents.includes('processed')) state.hash = 'b'.repeat(64);
      if (mode === 'independent-parent' && state.parents.includes('processed')) {
        state.parents.push('external');
        state.hash = 'b'.repeat(64);
      }
      if (mode === 'interrupted' && state.parents.includes('processed')) throw new Error('connection lost');
    }
    return Response.json({ id: 'file', parents: state.parents, version: String(state.version), sha256Checksum: state.hash },
      { headers: { etag: `"v${state.version}"` } });
  };
  const api = { driveUrl: (path, params) => { const url = new URL(`https://drive.test/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value); return url; },
    processedFolder: async () => 'processed', sourceBytes: async () => { throw new Error('unexpected download'); } };
  return { state, fetcher, api, file: { id: 'file', publishedContentHash: 'a'.repeat(64) } };
}

test('verified archive checks the published hash and uses a strong ETag', async () => {
  const { state, fetcher, api, file } = archiveFixture();
  await moveVerifiedErpFile(fetcher, 'token', file, 'drop', 'processed', api);
  assert.deepEqual(state.parents, ['processed']);
  assert.deepEqual(state.patches, ['"v1"']);
});

test('verified archive rejects an altered source before moving', async () => {
  const { state, fetcher, api, file } = archiveFixture();
  state.hash = 'b'.repeat(64);
  await assert.rejects(moveVerifiedErpFile(fetcher, 'token', file, 'drop', 'processed', api), /ERP_DRIVE_SOURCE_CHANGED_BEFORE_ARCHIVE/);
  assert.deepEqual(state.parents, ['drop']);
  assert.deepEqual(state.patches, []);
});

test('verified archive fails closed when Drive supplies no version', async () => {
  const { api, file } = archiveFixture();
  let patches = 0;
  const fetcher = async (_, options = {}) => {
    if (options.method === 'PATCH') patches += 1;
    return Response.json({ id: file.id, parents: ['drop'], sha256Checksum: file.publishedContentHash });
  };
  await assert.rejects(moveVerifiedErpFile(fetcher, 'token', file, 'drop', 'processed', api), /ERP_ARCHIVE_IDENTITY_UNAVAILABLE/);
  assert.equal(patches, 0);
});

test('changed and interrupted archive operations restore the pending parent', async () => {
  for (const mode of ['changed-after', 'interrupted']) {
    const { state, fetcher, api, file } = archiveFixture(mode);
    await assert.rejects(moveVerifiedErpFile(fetcher, 'token', file, 'drop', 'processed', api));
    assert.deepEqual(state.parents, ['drop']);
    assert.equal(state.patches.length, 2);
  }
});

test('archive compensation does not overwrite an independent parent change', async () => {
  const { state, fetcher, api, file } = archiveFixture('independent-parent');
  await assert.rejects(moveVerifiedErpFile(fetcher, 'token', file, 'drop', 'processed', api), /ERP_ARCHIVE_RESTORE_FAILED/);
  assert.deepEqual(state.parents, ['processed', 'external']);
  assert.equal(state.patches.length, 1);
});

test('a rejected conditional move does not restore over an independent move', async () => {
  const { state, fetcher: base, api, file } = archiveFixture();
  const fetcher = async (input, options = {}) => {
    if (options.method !== 'PATCH') return base(input, options);
    state.parents = ['external'];
    return new Response('', { status: 412 });
  };
  await assert.rejects(moveVerifiedErpFile(fetcher, 'token', file, 'drop', 'processed', api), /ERP_DRIVE_SOURCE_CHANGED_BEFORE_ARCHIVE/);
  assert.deepEqual(state.parents, ['external']);
  assert.equal(state.patches.length, 0);
});

test('an unconfirmed stage receipt cannot archive a pending file', async () => {
  let archives = 0;
  await assert.rejects(stageFileContinuation({
    supabase: { rpc: async name => name === 'fast_erp_import_columns_v1'
      ? { data: ['itemcode'] } : { data: { committed: true, expected_rows: 1, receipt: { ok: false } } } },
    fetcher: async (_, options) => {
      if (options.method === 'PATCH') archives += 1;
      return new Response('itemcode\n123\n');
    },
    token: 'token', file: entry('new-id', 'DriveAround.csv', 'drop'),
    dataset: 'drive_around', stageKey: 'drive', parentId: 'drop', processedId: 'processed',
    status: async () => {}, state: null
  }), /ERP_PENDING_RECEIPT_UNCONFIRMED/);
  assert.equal(archives, 0);
});

test('a successful-looking skipped commit cannot archive a pending file', async () => {
  let archives = 0;
  await assert.rejects(finishStageContinuation({
    supabase: { rpc: async () => ({ data: { ok: true, skip: true, source_rows: 0 } }) },
    file: entry('new-id', 'DriveAround.csv', 'drop'), dataset: 'drive_around', stageKey: 'drive',
    parentId: 'drop', processedId: 'processed', next: { stageId: 's', processedRows: 1, expectedRows: 1 },
    status: async () => {}, moveProcessed: async () => { archives += 1; }, maxRows: 50000
  }), /ERP_STAGE_COMMIT_UNCONFIRMED/);
  assert.equal(archives, 0);
});

test('manual publication requires the exact file, dataset and row-count receipt', async () => {
  const valid = fixtureErpReceipt('ph_master_inventory', 'DriveAround.xlsx', 2);
  const invalid = [
    { ok: true }, { ...valid, skip: true }, { ...valid, source_rows: 0 },
    { ...valid, file_name: 'other.xlsx' }, { ...valid, dataset_key: 'ph_cav_import' },
    { ...valid, staged_rows: 1 }, { ...valid, stage_commit: 'other' },
    { ...valid, source_rows: undefined }
  ];
  assert.equal(isConfirmedPendingStageReceipt(valid, 'drive_around', 'DriveAround.xlsx', 2), true);
  for (const receipt of invalid) {
    let moves = 0;
    await assert.rejects(finishStageContinuation({
      supabase: { rpc: async () => ({ data: receipt }) }, file: { id: 'file', name: 'DriveAround.xlsx' },
      dataset: 'drive_around', stageKey: 'drive', parentId: 'drop', processedId: 'processed',
      next: { stageId: 'stage', processedRows: 2, expectedRows: 2 }, status: async () => {},
      moveProcessed: async () => { moves += 1; }, maxRows: 50000, requireReceipt: true
    }), /ERP_STAGE_COMMIT_UNCONFIRMED/);
    assert.equal(moves, 0);
  }
});

test('a mismatched committed-stage replay cannot archive a pending file', async () => {
  const receipt = fixtureErpReceipt('ph_master_inventory', 'other.csv', 1);
  let moves = 0;
  await assert.rejects(stageFileContinuation({
    supabase: { rpc: async name => name === 'fast_erp_import_columns_v1'
      ? { data: ['itemcode'] } : { data: { committed: true, expected_rows: 1, receipt } } },
    fetcher: async (_, options = {}) => {
      if (options.method === 'PATCH') moves += 1;
      return new Response('itemcode\n123\n');
    },
    token: 'token', file: entry('new-id', 'DriveAround.csv', 'drop'), dataset: 'drive_around',
    stageKey: 'drive', parentId: 'drop', processedId: 'processed', status: async () => {}, state: null
  }), /ERP_PENDING_RECEIPT_UNCONFIRMED/);
  assert.equal(moves, 0);
});

test('an archive retry requires its original matching receipt', async () => {
  let calls = 0;
  await assert.rejects(stageFileContinuation({
    supabase: {}, fetcher: async () => { calls += 1; throw new Error('unexpected Drive request'); },
    token: 'token', file: entry('new-id', 'DriveAround.csv', 'drop'), dataset: 'drive_around',
    stageKey: 'drive', parentId: 'drop', processedId: 'processed', status: async () => {},
    state: { phase: 'move', expectedRows: 1, receipt: fixtureErpReceipt('ph_cav_import', 'DriveAround.csv', 1) }
  }), /ERP_PENDING_RECEIPT_UNCONFIRMED/);
  assert.equal(calls, 0);
});

test('only successful completed stage checks receive durable check timestamps', async () => {
  const persisted = [], recorded = [];
  const writer = { current: { active: true }, persist: async patch => { persisted.push(patch); } };
  const wrapped = withErpStageCheckRecording(writer, async key => {
    recorded.push(key);
    return '2026-11-11T12:49:45Z';
  });
  await wrapped.persist({ sourceProgressDelta: { key: 'drive', stage: 'failed', checked: false } });
  await wrapped.persist({ sourceProgressDelta: { key: 'cav', stage: 'complete', checked: true } });
  assert.deepEqual(recorded, ['cav']);
  assert.equal(persisted[1].sourceProgressDelta.last_checked_at, '2026-11-11T12:49:45Z');
  assert.equal(persisted[0].sourceProgressDelta.last_checked_at, undefined);
  const failing = withErpStageCheckRecording(writer, async () => { throw new Error('lease expired'); });
  await assert.rejects(failing.persist({ sourceProgressDelta: { key: 'drive', stage: 'complete', checked: true } }), /lease expired/);
  assert.equal(persisted.length, 2);
});

test('legacy workbook pages preserve raw offsets and reject missing headers', async () => {
  const records = [['Report'], ['Item Code', 'Available'], ['A', '2'], ['B', '3']];
  const XLSX = { read: () => ({ SheetNames: ['Data'], Sheets: { Data: { '!ref': 'A1:B4' } } }),
    utils: { sheet_to_json: () => records, decode_range: () => ({ e: { r: 3 } }) } };
  const api = { loadWorkbook: async () => XLSX, maxRows: 10,
    normalizeHeader: value => value.toLowerCase().replace(/\W/g, ''),
    toObjects: rows => rows.slice(1).map(row => ({ itemcode: row[0], available: row[1] })) };
  const first = await parseLegacyErpPage(new Uint8Array(), 0, 1, { dataset: 'drive_around' }, api);
  const second = await parseLegacyErpPage(new Uint8Array(), first.nextOffset, 1,
    { dataset: 'drive_around', headerRowIndex: first.headerRowIndex, header: first.header }, api);
  assert.deepEqual(first.rows, [{ itemcode: 'A', available: '2' }]);
  assert.equal(first.done, false);
  assert.deepEqual(second.rows, [{ itemcode: 'B', available: '3' }]);
  assert.equal(second.done, true);
  records[1] = ['Unknown'];
  await assert.rejects(parseLegacyErpPage(new Uint8Array(), 0, 1, {}, api), /ERP_SOURCE_HEADER_MISSING/);
});
