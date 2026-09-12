import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const headers = ['Item Code', 'Lot', 'Size', 'Common Name', 'PO Ordered', 'Lot Pend Rec', 'Seas On Hand', 'PO Remain'];
function sourceFile(id, count = 1, remain = '1,200') {
  return { getId: () => id, getName: () => `2026-09-12 ${id}.csv`, getMimeType: () => 'text/csv',
    getDateCreated: () => new Date('2026-09-12T00:00:00Z'),
    values: [headers, ...Array.from({ length: count }, (_, i) => [`ITEM-${i}`, '27.F1', '#3', 'Synthetic', '1,300', '0', '0', remain])] };
}
function harness(options = {}) {
  const files = [...(options.files || [sourceFile('a'), sourceFile('b')])];
  const events = [];
  const properties = new Map();
  let fileIndex = 0;
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) || '',
      setProperty: (key, value) => { if (options.archiveSaveFailure) throw new Error('property save failed'); properties.set(key, value); },
      deleteProperty: key => properties.delete(key) }) },
    MimeType: { CSV: 'text/csv' }, Utilities: { getUuid: () => 'synthetic-run' },
    UrlFetchApp: { fetch(url, request) {
      const name = new URL(url).pathname.split('/').pop();
      const payload = JSON.parse(request.payload);
      events.push({ type: 'rpc', name, payload });
      let status = 200, body = { ok: true };
      if (name === 'hl_po_import_capabilities') {
        status = options.capabilityStatus ?? 200;
        body = options.capabilityBody ?? { version: 1 };
        if (options.capabilityThrows) throw new Error('network unavailable');
      } else if (name === 'hl_po_import_stage') {
        if (payload.p_complete) body = options.finalizeResult || { status: 'pending', awaitingReconciliation: true };
        if (options.stageFailure && (payload.p_complete || payload.p_rows[0]?.source_file_id === options.stageFailure)) {
          status = 500; body = { code: 'XX000' };
        }
        if (options.finalizeFailure && payload.p_complete) throw new Error('lost final acknowledgement');
      } else throw new Error(`Unexpected RPC ${name}`);
      return { getResponseCode: () => status, getContentText: () => JSON.stringify(body) };
    } }
  });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(ctx);
  ctx.getSupabaseHeaders_ = () => ({ apikey: 'synthetic-service-key' });
  ctx.getDriveFolderByIdWithRetry_ = id => ({ id });
  ctx.listDriveFilesWithRetry_ = () => { fileIndex = 0; return { hasNext: () => fileIndex < files.length, next: () => files[fileIndex++] }; };
  ctx.extractHlPoParsedSheet_ = file => {
    if (options.parseFailure === file.getId()) throw new Error('invalid workbook');
    return { values: file.values, sourceSheetName: 'CSV', headerRowIndex: 0, indexByColumn: ctx.getHlPoHeaderMatch_(headers) };
  };
  ctx.upsertHlPoParsedRows_ = (table, rows) => { events.push({ type: 'legacy', table, rows: plain(rows) }); return rows.length; };
  ctx.moveDriveFileToFolderWithRetry_ = file => {
    events.push({ type: 'move', id: file.getId() });
    if (options.archiveFailureIds?.has(file.getId())) throw new Error('Drive move failed');
    files.splice(files.indexOf(file), 1);
  };
  ctx.emitTableSyncLiveEvent_ = () => events.push({ type: 'active-event' });
  return { ctx, events, properties, files, run: () => plain(ctx.syncHlPoParsedFolder_('source', 'processed', 'ph_27f1_hl_po')) };
}
const stages = h => h.events.filter(e => e.type === 'rpc' && e.name === 'hl_po_import_stage');

test('a complete HL PO report stages every file before finalizing or moving source files', () => {
  const h = harness({ files: [sourceFile('a', 1001), sourceFile('b')] });
  const result = h.run();
  assert.equal(h.events.filter(e => e.name === 'hl_po_import_capabilities').length, 1);
  assert.deepEqual(stages(h).map(e => e.payload.p_rows.length), [500, 500, 1, 1, 0]);
  assert.ok(stages(h).slice(0, -1).every(e => e.payload.p_complete === false && e.payload.p_run_id === 'synthetic-run'));
  assert.equal(stages(h).at(-1).payload.p_complete, true);
  const completeIndex = h.events.findIndex(e => e.payload?.p_complete);
  assert.ok(h.events.filter(e => e.type === 'move').every(e => h.events.indexOf(e) > completeIndex));
  assert.equal(h.events.some(e => ['legacy', 'active-event'].includes(e.type)), false);
  assert.equal(result.filesProcessed, 2);
  assert.equal(result.totalRows, 1002);
  assert.equal(result.importStatus, 'awaiting_reconciliation');
  assert.equal(result.awaitingReconciliation, true);
  const row = stages(h)[0].payload.p_rows[0];
  assert.equal(row.po_remain, 1200);
  assert.equal(row.source_values.po_remain, '1,200');
  assert.equal(row.source_values.po_received, null);
  assert.equal(row.row_index, 2);
});

test('a parse failure leaves the whole report incomplete and all source files in place', () => {
  const h = harness({ parseFailure: 'b' });
  const result = h.run();
  assert.equal(stages(h).length, 1);
  assert.equal(stages(h).some(e => e.payload.p_complete), false);
  assert.equal(h.events.some(e => e.type === 'move' || e.type === 'legacy'), false);
  assert.equal(result.failedFiles, 1);
  assert.equal(result.filesProcessed, 0);
  assert.equal(result.importStatus, 'incomplete');
  assert.equal(result.awaitingReconciliation, false);
});

test('a stage failure never falls back to direct upsert or finalizes a partial report', () => {
  const h = harness({ stageFailure: 'b' });
  const result = h.run();
  assert.equal(result.failedFiles, 1);
  assert.equal(stages(h).some(e => e.payload.p_complete), false);
  assert.equal(h.events.some(e => e.type === 'move' || e.type === 'legacy'), false);
});

test('uncertain finalization retains every source file for an idempotent retry', () => {
  const h = harness({ finalizeFailure: true });
  const result = h.run();
  assert.equal(stages(h).at(-1).payload.p_complete, true);
  assert.equal(h.events.some(e => e.type === 'move'), false);
  assert.equal(result.failedFiles, 2);
  assert.equal(result.awaitingReconciliation, false);
});

test('only missing capability functions allow the pre-migration importer', () => {
  for (const code of ['PGRST202', '42883']) {
    const h = harness({ capabilityStatus: 404, capabilityBody: { code } });
    const result = h.run();
    assert.equal(stages(h).length, 0);
    assert.equal(h.events.filter(e => e.type === 'legacy').length, 2);
    assert.equal(h.events.filter(e => e.type === 'active-event').length, 1);
    assert.equal(result.importStatus, 'legacy_applied');
    assert.equal(Object.hasOwn(h.events.find(e => e.type === 'legacy').rows[0], 'source_values'), false);
  }
});

test('authorization, server, network, malformed capability and unknown version errors fail closed', () => {
  for (const options of [
    { capabilityStatus: 401, capabilityBody: { code: 'PGRST301' } },
    { capabilityStatus: 403, capabilityBody: { code: '42501' } },
    { capabilityStatus: 500, capabilityBody: { code: 'PGRST202' } },
    { capabilityStatus: 404, capabilityBody: { code: 'unrelated' } },
    { capabilityBody: { version: 2 } }, { capabilityBody: [] }, { capabilityThrows: true }
  ]) {
    const h = harness(options);
    assert.throws(h.run);
    assert.equal(h.events.some(e => e.type === 'move' || e.type === 'legacy'), false);
    assert.equal(stages(h).length, 0);
  }
});

test('empty folders neither probe capability nor finalize an empty report', () => {
  const h = harness({ files: [] });
  const result = h.run();
  assert.equal(h.events.length, 0);
  assert.equal(result.importStatus, 'no_files');
});

test('a partial archive retry moves only finalized report files and never stages a subset or new arrival', () => {
  const failingIds = new Set(['b']);
  const h = harness({ archiveFailureIds: failingIds });
  const first = h.run();
  assert.equal(first.failedFiles, 1);
  assert.equal(first.awaitingReconciliation, true);
  assert.equal(h.properties.size, 1);
  assert.deepEqual(h.files.map(file => file.getId()), ['b']);
  h.files.push(sourceFile('new-report'));
  failingIds.clear();
  const eventOffset = h.events.length;
  const retried = h.run();
  assert.deepEqual(h.events.slice(eventOffset), [{ type: 'move', id: 'b' }]);
  assert.equal(retried.runId, first.runId);
  assert.equal(retried.awaitingReconciliation, true);
  assert.equal(h.properties.size, 0);
  assert.deepEqual(h.files.map(file => file.getId()), ['new-report']);
});

test('archive manifest storage failure keeps every file even after database finalization', () => {
  const h = harness({ archiveSaveFailure: true });
  const result = h.run();
  assert.equal(stages(h).at(-1).payload.p_complete, true);
  assert.equal(h.events.some(e => e.type === 'move'), false);
  assert.equal(result.failedFiles, 2);
  assert.deepEqual(h.files.map(file => file.getId()), ['a', 'b']);
});

test('an interrupted run with all files already archived only clears its manifest', () => {
  const h = harness({ files: [] });
  h.properties.set('HL_PO_IMPORT_ARCHIVE_source', JSON.stringify({ runId: 'finalized-run', processedFolderId: 'processed', fileIds: ['done'] }));
  const result = h.run();
  assert.equal(h.events.length, 0);
  assert.equal(h.properties.size, 0);
  assert.equal(result.runId, 'finalized-run');
  assert.equal(result.awaitingReconciliation, true);
});

test('duplicate reports are archived without asking for another reconciliation', () => {
  const h = harness({ finalizeResult: { status: 'duplicate', awaitingReconciliation: false } });
  const result = h.run();
  assert.equal(result.filesProcessed, 2);
  assert.equal(result.importStatus, 'duplicate');
  assert.equal(result.awaitingReconciliation, false);
  assert.equal(h.events.some(e => e.type === 'legacy' || e.type === 'active-event'), false);
});
