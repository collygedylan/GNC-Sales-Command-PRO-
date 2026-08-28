import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { chromium } from '@playwright/test';

const root = process.cwd();
const outputDir = path.resolve(process.argv[2] || path.join(root, 'test-results', 'reclass-pdf-fixture'));
fs.mkdirSync(outputDir, { recursive: true });

const code = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const start = code.indexOf('const RECLASS_INQUIRY_ROW_FIELDS_');
const end = code.indexOf('function handleInventoryTransaction_', start);
if (start < 0 || end <= start) throw new Error('Reclass report source could not be located.');

const context = {
  Map, Set, Number, Object, String, Date, JSON, console,
  firstNonEmptyRequestValue_: (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
  normalizeInventoryTransactionText_: (value) => String(value ?? '').trim(),
  normalizeInventoryTransactionCompareText_: (value) => String(value ?? '').trim().toUpperCase(),
  getInventoryTransactionRowUid_: (row) => String(row?.unique_id || row?.UNIQUE_ID || '').trim(),
  getInventoryTransactionRowValue_: (row, aliases, fallback = '') => {
    for (const alias of aliases) if (Object.hasOwn(row || {}, alias)) return row[alias] ?? '';
    return fallback;
  },
  Utilities: { formatDate: () => '8/28/2026, 8:45:00 AM' },
  buildPhoneSizedEmailHtml_: (value) => String(value || ''),
  escapeEmailHtml_: (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
};
vm.createContext(context);
vm.runInContext(`${code.slice(start, end)}; this.render = buildReclassInquiryCompactReportHtml_;`, context);

const model = {
  identity: {
    plantgroupcode: '140_GRASS', commonname: 'Dallas Blues Switch Grass', contsize: '#3', itemcode: '000748.010.1',
    genusname: 'Panicum', fieldtagcolor: 'Blue', itemspec: '18-24 inch', pullerresponsibility: 'Shipping',
    holdstopcode: 'H', holdstopreason: 'sheared',
  },
  identityChangedFields: ['holdstopcode', 'holdstopreason'],
  originUid: 'origin',
  transaction: { scope: { season: 'F1', salesYear: 2027, affectedCount: 3 } },
  requestActions: ['hold', 'priority_change', 'move_up', 'move_down', 'recount'],
  requestActionLabel: 'On Hold Request + Priority Change + Move Up Request + Move Down Request + Re-Count Request',
  actorDisplay: 'Synthetic Tester', submittedAt: '8/28/2026, 8:45:00 AM',
  editSummary: { rowCount: 2, fieldCount: 8 }, isSyntheticPilot: true,
  rows: [
    {
      unique_id: 'origin',
      values: { lotcode: '27.S1', locationcode: 'C.16.000', source: 'LD', priority: '1', ptronhand: '800', ptrreviewed: '12', locationnotedate: '8/26/2026', locationnote: 'Originating synthetic row.', holdstopcode: 'H', holdstopreason: 'sheared' },
      actionValues: { moveupquantity: '40', moveupseason: 'F1', movedownquantity: '20', movedownseason: 'S1' },
      changedFields: ['holdstopcode', 'holdstopreason', 'priority', 'moveupquantity', 'moveupseason', 'movedownquantity', 'movedownseason'],
    },
    {
      unique_id: 'context',
      values: { lotcode: '27.F1', locationcode: 'A.01.000', source: 'SH', priority: '', ptronhand: '120', ptrreviewed: '4', locationnotedate: '', locationnote: 'Priority intentionally cleared.', holdstopcode: '', holdstopreason: '' },
      actionValues: {}, changedFields: ['priority'],
    },
  ],
};

const html = context.render(model, true);
fs.writeFileSync(path.join(outputDir, 'reclass-print-safe.html'), html, 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: path.join(outputDir, 'reclass-print-safe.pdf'), format: 'Letter', landscape: true, printBackground: true, margin: { top: '0.34in', right: '0.34in', bottom: '0.34in', left: '0.34in' } });
} finally {
  await browser.close();
}
console.log(outputDir);
