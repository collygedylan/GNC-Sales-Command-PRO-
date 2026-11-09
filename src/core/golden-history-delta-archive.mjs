import assert from 'node:assert/strict';
import { runInThisContext } from 'node:vm';
import { planConsecutiveHistoricalStates, requestArchivePath } from '../services/history-delta-review.mjs';

export function invariant563() {
  const base = { itemcode: '00123', locationcode: 'A.01.001', lotcode: '27.F1', available: 10 };
  const rows = [10, 10, 9, 10, 10].map((available, index) => ({ ...base, available,
    unique_id: String(index), file_id: `file-${index}`, file_sequence: index + 1,
    report_date: `2026-11-0${index + 1}` }));
  const plan = planConsecutiveHistoricalStates(rows, { keyFields: ['itemcode', 'locationcode', 'lotcode'] });
  assert.deepEqual(plan.kept.map(row => row.available), [10, 9, 10]);
  assert.deepEqual(plan.coverage.map(row => row.retainedId), ['0', '0', '2', '3', '3']);
  const reappearance = planConsecutiveHistoricalStates([rows[0], rows[3]], {
    keyFields: ['itemcode', 'locationcode', 'lotcode'],
  });
  assert.equal(reappearance.kept.length, 2);
  assert.deepEqual(requestArchivePath({ sales_rep: 'Rep', customer_name: 'Buyer', consignee_name: 'N/A',
    requested_at: '2024-01-02T10:00:00Z', unique_id: 'REQ-1', itemcode: '00123' }),
  ['Rep', 'Buyer', 'Direct_or_NA', '2024-01-02_REQ-1', '00123']);
}

function logicalObservation(id, physical, coverage, states) {
  const archived = coverage.get(id);
  if (!archived) return physical.get(id);
  return { ...states.get(archived.digest), ...archived.provenance };
}

function completeReceipt(metadata, observations) {
  return ['processed', 'row_indexed', 'complete'].includes(metadata.status)
    && Number.isInteger(metadata.rowCount) && metadata.rowCount >= 0
    && metadata.processedAt && metadata.reportDate && observations === metadata.rowCount;
}

export function invariant570({ read }) {
  const physical = new Map([['r1', { unique_id: 'r1', available: 20 }]]);
  const states = new Map([['state-20', { available: 20 }]]);
  const coverage = new Map([['r2', { digest: 'state-20', provenance: { unique_id: 'r2', file_id: 'f2' } }]]);
  assert.equal(logicalObservation('r2', physical, coverage, states).available, 20);
  physical.set('r1', { unique_id: 'r1', available: 777 });
  assert.equal(logicalObservation('r2', physical, coverage, states).available, 20);
  physical.delete('r1');
  assert.deepEqual(logicalObservation('r2', physical, coverage, states),
    { unique_id: 'r2', file_id: 'f2', available: 20 });
  assert.equal(completeReceipt({ status: 'indexed', rowCount: null }, 2), false);
  assert.equal(completeReceipt({ status: 'processed', rowCount: 2, processedAt: true, reportDate: true }, 1), false);
  assert.equal(completeReceipt({ status: 'processed', rowCount: 2, processedAt: true, reportDate: true }, 2), true);
  const coverageSql = read('supabase/migrations/20261109003000_agdata3039_snapshot_coverage.sql');
  assert.match(coverageSql, /history_snapshot_states_v3039[^]*foreign key\(relation_id,state_digest\)/);
  assert.match(coverageSql, /jsonb_populate_record[^]*state[.]business_state\|\|coverage[.]provenance/);
  assert.match(coverageSql, /complete_file_receipt_missing[^]*source_count_not_complete/);
  const pipeline = read('supabase/migrations/20261109007000_agdata3039_completed_snapshot_pipeline.sql');
  assert.match(pipeline, /after insert on public[.]ph_drive_around_report_rows[^]*capture_snapshot_insert_v3039/);
  assert.match(pipeline, /before insert on public[.]ph_drive_around_report_rows[^]*skip_archived_snapshot_replay_v3039/);
  const privateImport = read('supabase/migrations/20261109006500_agdata3039_private_import_snapshot_delta.sql');
  assert.match(privateImport, /import_history_logical_rows_v3039[^]*compact_import_history_delta_v3039/);
  const maintenance = read('scripts/compact-historical-deltas.mjs');
  assert.match(maintenance, /import:\s*'import_private[.]import_history_rows'/);
  assert.match(maintenance, /processImportHistoryMaintenanceBatch[^]*compact_import_history_delta_v3039/);
}

export async function invariant572({ read }) {
  const sql = read('supabase/migrations/20261109008000_agdata3039_request_archive_reader.sql');
  assert.match(sql, /array_to_string\(h\.archive_path,' '\)\)[^]*like[^]*or lower\(concat_ws[^]*coalesce\(h\.request_folder,''\)[^]*like/);
  assert.match(sql, /'Folder',p_row->>'request_folder'/);

  const { build } = await import('esbuild');
  const bundle = await build({ entryPoints: ['services/historicalRequests.ts'], bundle: true,
    format: 'cjs', platform: 'node', write: false, logLevel: 'silent' });
  const module = { exports: {} };
  runInThisContext(`(module) => {\n${bundle.outputFiles[0].text}\n}`, { filename: 'historical-requests-test-bundle.cjs' })(module);
  const { createHistoricalRequestsBridge } = module.exports;
  const folder = 'Retained Pickup Folder';
  const path = ['Alpha Rep', 'Buying Account', 'Direct_or_NA', '2024-02-03_REQ-1', '00123'];
  const query = { operation: 'archive-search', recordKind: 'requests', query: folder, page: 0, pageSize: 25 };
  const response = { operation: query.operation, recordKind: query.recordKind, page: 0, pageSize: 25,
    scope: 'own', financials: false, path: [], depth: 0, maxDepth: 5,
    revision: 'history-r1', generatedAt: '2026-11-08T00:00:00Z', total: 1, rows: [{
      kind: 'record', id: 'REQ-1', archivePath: path, title: 'Rose', subtitle: path.join(' / '), status: 'Completed',
      occurredAt: '2024-02-04T00:00:00Z', itemcode: '00123', commonname: 'Rose', contsize: '', locationcode: '',
      lotcode: '', quantity: 25, unitListPrice: null, lineDollarValue: null, photoLinks: [], notes: [], facts: { Folder: folder },
    }] };
  const bridge = createHistoricalRequestsBridge({ role: 'Rep', scopeKey: 'rep-1', revisionKey: 'history-r1', async transport(input) {
    assert.deepEqual(input, query);
    return response;
  } });
  const [row] = (await bridge.readArchive(query)).rows;
  assert.equal(row.facts.Folder, folder);
  assert.deepEqual(row.archivePath, path);
}
