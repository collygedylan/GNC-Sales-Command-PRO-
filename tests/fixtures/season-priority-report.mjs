import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

export function loadSeasonPriorityReport() {
  const code = readFileSync(new URL('../../Code.gs', import.meta.url), 'utf8');
  const context = {
    console, Map, Set, Number, Object, String, Date, JSON,
    firstNonEmptyRequestValue_: (...values) => values.find(value => value != null && String(value).trim()) ?? '',
    normalizeInventoryTransactionText_: value => String(value ?? '').trim(),
    normalizeInventoryTransactionCompareText_: value => String(value ?? '').trim().toUpperCase(),
    getInventoryTransactionRowUid_: row => String(row.unique_id || row.UNIQUE_ID || ''),
    getInventoryTransactionRowValue_: (row, keys, fallback = '') => {
      for (const key of keys) if (Object.hasOwn(row, key)) return row[key] ?? '';
      return fallback;
    },
    Utilities: { formatDate: () => '9/22/2026, 10:00:00 AM' },
    buildPhoneSizedEmailHtml_: value => value,
    escapeEmailHtml_: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  };
  vm.createContext(context);
  vm.runInContext(code.slice(code.indexOf('const RECLASS_INQUIRY_ROW_FIELDS_'), code.indexOf('function handleInventoryTransaction_')), context);
  return context;
}

export function seasonPriorityFixture(k = 3, count = 9) {
  const ranks = [1, 1, 2, k, 4, '', 99, 'invalid', 3];
  const rows = Array.from({ length: count }, (_, index) => ({
    unique_id: `season-priority-test-${index}`, warehouseid: '10', itemcode: 'TEST.001', commonname: 'Synthetic Season Priority Plant',
    contsize: '#3', locationcode: `${index % 2 ? 'BB' : 'AA'}.${String(index + 1).padStart(2, '0')}.001`,
    lotcode: index % 2 ? '26.F1' : '27.S1', season: index % 2 ? 'F1' : 'S1', saleyear: index % 2 ? '26' : '27', source: `LOT-${index}`,
    priority: String(ranks[index % ranks.length]), ptronhand: '125', ptravailable: '100', reviewed: '5', assignedto: 'test_manager',
    locationnote: `Synthetic note ${index + 1}: long note with <markup> & special characters. ` + 'Keep this lot available for seasonal sales. '.repeat(index % 4 === 0 ? 8 : 1),
    desigitem: '', desigcust: '', desigloc: '',
  }));
  const overlays = rows.map((row, index) => {
    const lineage = Object.fromEntries(['warehouse', 'itemcode', 'contsize', 'locationcode', 'lotcode', 'source', 'desigitem', 'desigcust', 'desigloc'].map(key => [key, (key === 'warehouse' ? row.warehouseid : row[key]).trim().toUpperCase()]));
    const lineageHash = createHash('sha256').update('[' + Object.values(lineage).map(value => JSON.stringify(value)).join(', ') + ']').digest('hex');
    const rank = /^[1-4]$/.test(row.priority) ? Number(row.priority) : null;
    const priority = index === 3 ? 1 : rank !== null && rank < k ? rank + 1 : null;
    return { unique_id: row.unique_id, expected: { itemcode: row.itemcode, locationcode: row.locationcode, lotcode: row.lotcode,
      priority: row.priority, ptronhand: row.ptronhand, ptravailable: row.ptravailable, lineage, lineageHash },
      proposals: priority === null ? [] : [{ action: 'priority_change', priority: String(priority) }] };
  });
  const transaction = { requestActions: ['priority_change'], holdStopProposals: [], scope: {}, seasonPriority: {
    contractVersion: 'manager-season-priority-v1', mode: 'priority_one_rotation', selectedPriority: k,
    selectedLineageHash: overlays[3].expected.lineageHash, scopeFingerprint: 'a'.repeat(64), requestFingerprint: 'b'.repeat(64),
    beforeStateHash: 'c'.repeat(64), afterStateHash: 'd'.repeat(64),
  } };
  return { rows, overlays, transaction };
}

export function buildSeasonPriorityReportFixture(k = 3, count = 9) {
  const server = loadSeasonPriorityReport();
  const { rows, overlays, transaction } = seasonPriorityFixture(k, count);
  const result = server.buildReclassInquiryActionRowsV3_(transaction, rows, overlays, {});
  if (!result.ok) throw new Error(result.message);
  const model = server.buildReclassInquiryReportModel_(rows[3], rows, result.rows, { transaction, actor: { display: 'Synthetic Manager' } }, new Date());
  model.isSyntheticPilot = true;
  return { server, model, rows, result, pdfHtml: server.buildReclassInquiryCompactReportHtml_(model, true), emailHtml: server.buildReclassInquiryEmailHtml_(model) };
}
