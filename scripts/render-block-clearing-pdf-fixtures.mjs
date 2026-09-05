import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBackend, makePayload } from '../tests/helpers/block-clearing-pdf-harness.mjs';

// Uses the exact Apps Script HTML builder with synthetic inventory, never an email API.
// GNC_PLAYWRIGHT_MODULE can point to a bundled playwright/index.mjs when dependencies are external.
const { chromium } = await import(process.env.GNC_PLAYWRIGHT_MODULE
  ? pathToFileURL(path.resolve(process.env.GNC_PLAYWRIGHT_MODULE)).href
  : '@playwright/test');
const outputDir = path.resolve(process.argv[2] || 'output/pdf/block-clearing-fixtures');
fs.mkdirSync(outputDir, { recursive: true });
const { context } = createBackend();

function itemFixture(index, rowCount = 2) {
  const item = structuredClone(makePayload().report.items[0]);
  item.itemcode = `${String(748 + index).padStart(6, '0')}.010.1`;
  item.commonname = [
    'Dallas Blues Switch Grass', 'Autumn Blaze Freeman Maple', 'Little Lime Hydrangea',
    'Green Giant Arborvitae', 'Double Play Candy Corn Spirea', 'Blue Star Juniper',
  ][index % 6];
  item.contsize = index % 2 ? '#7' : '#3';
  item.action = ['move', 'ta', 'grade_save_best'][index % 3];
  item.quantity = 75;
  item.instructions = item.action === 'grade_save_best'
    ? 'Grade this item and save the best 75 plants. Keep each original lot clearly marked.\nRecord the completed quantity in the blank above.'
    : item.action === 'ta' ? 'TA the specified quantity after confirming the source lot. Keep the aisle clear.'
      : 'Move the planned quantity to the full destination shown. Keep original lot labels with each group.';
  item.rows = Array.from({ length: rowCount }, (_, rowIndex) => ({
    uniqueId: `synthetic-source-${index}-${rowIndex}`, itemcode: item.itemcode,
    locationcode: `A.05.${String(rowIndex * 10).padStart(3, '0')}`, lotcode: `${rowIndex % 2 ? '27.S1' : '26.F1'}.LOT.${String(rowIndex + 1).padStart(3, '0')}`,
    salesyear: rowIndex % 2 ? '2027' : '2026', source: rowIndex % 2 ? 'SH' : 'LD', ptronhand: 40 + rowIndex,
  }));
  if (item.action === 'move') {
    item.destinationEvidence[0].uniqueId = `synthetic-destination-${index}`;
    item.destinationEvidence[0].itemcode = item.itemcode;
  } else {
    item.destinationLocationcode = '';
    item.destinationEvidence = [];
  }
  return item;
}

const short = makePayload();
short.report.title = 'Block Clearing Worksheet - A.05 (Synthetic QA)';
short.report.items = [itemFixture(0), itemFixture(1)];
const long = makePayload();
long.report.title = 'Block Clearing Worksheet - A.05 (Synthetic Multi-Page QA)';
long.report.items = Array.from({ length: 8 }, (_, index) => itemFixture(index, index === 4 ? 36 : 3));
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, payload] of [['block-clearing-one-page', short], ['block-clearing-multipage', long]]) {
    const html = context.buildBlockClearingPdfHtml_(context.normalizeBlockClearingPdfReport_(payload));
    const htmlPath = path.join(outputDir, name + '.html');
    const pdfPath = path.join(outputDir, name + '.pdf');
    fs.writeFileSync(htmlPath, html, 'utf8');
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
    await page.close();
    console.log(pdfPath);
  }
} finally {
  await browser.close();
}
