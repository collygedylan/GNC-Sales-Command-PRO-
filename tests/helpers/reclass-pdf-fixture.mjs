import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Synthetic data exercises the production Apps Script renderer without email or database access. */
export function reclassPdfFixture(count = 35, { v7 = false } = {}) {
  const source = readFileSync(new URL('../../Code.gs', import.meta.url), 'utf8');
  const start = source.indexOf('const RECLASS_INQUIRY_ROW_FIELDS_');
  const end = source.indexOf('function handleInventoryTransaction_', start);
  assert.ok(start > 0 && end > start);
  const first = (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '';
  const context = vm.createContext({
    console,
    firstNonEmptyRequestValue_: first,
    repairDisplayUtf8Mojibake_: value => String(value ?? ''),
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
    locationnote: `Prior location note ${index}`,
    locationptn1: `Prior PTN1 ${index}`,
    desigcust: `Prior customer ${index}`,
    desigloc: `Prior designation location ${index}`,
    pullerresponsibility: `Prior puller ${index}`,
    oversellpercentage: '10%',
    salesnote: `Prior sales note ${index}`,
    suspend: index === 0 ? 'SYN' : (index === 1 ? '' : 'RS'),
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
  let reportRows = result.rows;
  const reportPayload = { workflowPolicyVersion: policyVersion, transaction, actor: { display: 'Synthetic reviewer' } };
  if (v7) {
    const fields = ['locationnote', 'locationptn1', 'desigitem', 'desigcust', 'desigloc',
      'pullerresponsibility', 'oversellpercentage', 'salesnote', 'suspend'];
    const inventoryFields = [];
    const reportStamps = [];
    reportRows = result.rows.map((row, index) => {
      const before = Object.fromEntries(fields.map(field => [field, rows[index][field] == null ? null : String(rows[index][field])]));
      const after = { ...before };
      if (index < count - 1) {
        after.locationnote = `Confirmed location note ${index}`;
        after.locationptn1 = `Confirmed PTN1 ${index}`;
        after.desigcust = `Confirmed customer ${index}`;
        after.desigloc = `Confirmed designation location ${index}`;
        after.pullerresponsibility = `Confirmed puller ${index}`;
        after.oversellpercentage = '18%';
        after.salesnote = `Confirmed sales note ${index}`;
        if (index === 0) after.suspend = null;
        if (index === 1) after.suspend = 'SR';
      }
      const changedFields = fields.filter(field => String(before[field] ?? '') !== String(after[field] ?? ''));
      fields.forEach(field => { row.values[field] = after[field] ?? ''; });
      row.changedFields = [...new Set([...(row.changedFields || []), ...changedFields])];
      const stamps = {
        prisetby: 'SR',
        priupdated: '10/8/2026 9:00 AM',
        locationnotedate: changedFields.includes('locationnote') ? '10/8/2026 9:00 AM' : null,
        evaldate: '10/8/2026',
      };
      reportStamps.push({ unique_id: row.unique_id, stamps });
      if (changedFields.length) inventoryFields.push({ unique_id: row.unique_id, before, after, changedFields, stamps });
      return row;
    });
    reportPayload.workflowPolicyVersion = 'reclass-action-workflow-v7-editable-fields-20261009';
    reportPayload.v7InventoryFields = inventoryFields;
    reportPayload.v7ReportStamps = reportStamps;
  }
  const model = context.buildReclassInquiryReportModel_(rows[0], rows, reportRows,
    reportPayload, new Date('2026-10-08T14:00:00Z'));
  return { html: context.buildReclassInquiryCompactReportHtml_(model, true), arrows };
}

export function reclassPdfV7Fixture(count = 35) {
  return reclassPdfFixture(count, { v7: true });
}
