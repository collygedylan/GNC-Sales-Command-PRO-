import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Synthetic data exercises the production Apps Script renderer without email or database access. */
export function reclassPdfFixture(count = 35) {
  const source = readFileSync(new URL('../../Code.gs', import.meta.url), 'utf8');
  const start = source.indexOf('const RECLASS_INQUIRY_ROW_FIELDS_');
  const end = source.indexOf('function handleInventoryTransaction_', start);
  assert.ok(start > 0 && end > start);
  const first = (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '';
  const context = vm.createContext({
    console,
    firstNonEmptyRequestValue_: first,
    normalizeInventoryTransactionText_: value => String(value ?? '').trim(),
    normalizeInventoryTransactionCompareText_: value => String(value ?? '').trim().toUpperCase(),
    getInventoryTransactionRowUid_: row => String(first(row?.unique_id, row?.UNIQUE_ID)),
    getInventoryTransactionRowValue_: (row, aliases, fallback = '') => {
      for (const alias of aliases) if (Object.hasOwn(row || {}, alias)) return row[alias] ?? '';
      return fallback;
    },
    Utilities: { formatDate: () => '10/8/2026, 9:00 AM' },
    escapeEmailHtml_: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  });
  vm.runInContext(source.slice(start, end), context);
  const rows = Array.from({ length: count }, (_, index) => ({
    unique_id: `pdf-${index}`, itemcode: '000123.003',
    commonname: 'Synthetic Hydrangea paniculata exceptionally long cultivar name for stacked movement pagination',
    contsize: '#3', lotcode: '27.U1', locationcode: `A.01.${String(index).padStart(3, '0')}`,
    ptronhand: '2000', desigitem: 'ORIGINAL', season: 'U1', holdstopcode: '', holdstopreason: '',
  }));
  const arrows = rows.map((_, index) => [`${700 + index}-->F1`, `${200 + index}-->S1`, `${100 + index}-->#`]);
  const overlays = rows.map((row, index) => ({
    unique_id: row.unique_id,
    expected: { itemcode: row.itemcode, lotcode: row.lotcode, locationcode: row.locationcode,
      ptronhand: row.ptronhand, desigitem: row.desigitem },
    proposals: [
      { action: 'move_up', splits: [{ quantity: 700 + index, destinationSeason: 'F1' }], applyHold: false, holdReason: '' },
      { action: 'move_down', splits: [{ quantity: 200 + index, destinationSeason: 'S1' }], applyHold: false, holdReason: '' },
      { action: 'sheared', quantity: 100 + index, desigitem: arrows[index][2] },
    ],
  }));
  const policyVersion = 'reclass-action-workflow-v5-sheared-20261008';
  const transaction = { requestActions: ['move_up', 'move_down', 'sheared'], holdStopProposals: [], scope: {} };
  const result = context.buildReclassInquiryActionRowsV3_(transaction, rows, overlays, null, { policyVersion });
  assert.equal(result.ok, true);
  const model = context.buildReclassInquiryReportModel_(rows[0], rows, result.rows,
    { workflowPolicyVersion: policyVersion, transaction, actor: { display: 'Synthetic reviewer' } }, new Date('2026-10-08T14:00:00Z'));
  return { html: context.buildReclassInquiryCompactReportHtml_(model, true), arrows };
}
