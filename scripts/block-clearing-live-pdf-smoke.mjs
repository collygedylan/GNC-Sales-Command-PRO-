// Render-only production canary: no email, Queue work, or inventory changes.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { makePayload } from '../tests/helpers/block-clearing-pdf-harness.mjs';

const args = process.argv.slice(2);
assert.ok(args.every((arg) => arg === '--multipage') && args.length <= 1, 'Only --multipage is supported; this canary always renders without email');
const multipage = args.includes('--multipage');
const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const endpoint = source.match(/const GOOGLE_SCRIPT_URL = "([^"]+)"/)?.[1];
assert.match(endpoint || '', /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/);
const payload = makePayload();
payload.report.title += multipage ? ' - SYNTHETIC MULTIPAGE RENDER CHECK' : ' - SYNTHETIC RENDER CHECK';
payload.report.createdAt = new Date().toISOString();
if (multipage) {
  const base = structuredClone(payload.report.items[0]);
  payload.report.items = Array.from({ length: 8 }, (_, index) => {
    const item = structuredClone(base);
    item.itemcode = `${String(748 + index).padStart(6, '0')}.010.1`;
    item.commonname = ['Dallas Blues Switch Grass', 'Autumn Blaze Freeman Maple', 'Little Lime Hydrangea', 'Green Giant Arborvitae', 'Double Play Candy Corn Spirea', 'Blue Star Juniper'][index % 6];
    item.action = ['move', 'ta', 'grade_save_best'][index % 3];
    item.rows = Array.from({ length: index === 4 ? 36 : 3 }, (_, rowIndex) => ({
      uniqueId: `synthetic-live-source-${index}-${rowIndex}`, itemcode: item.itemcode,
      locationcode: `A.05.${String(rowIndex * 10).padStart(3, '0')}`,
      lotcode: `${rowIndex % 2 ? '27.S1' : '26.F1'}.LIVE.${String(rowIndex + 1).padStart(3, '0')}`,
      salesyear: rowIndex % 2 ? '2027' : '2026', source: rowIndex % 2 ? 'SH' : 'LD', ptronhand: 40 + rowIndex,
    }));
    item.instructions = item.action === 'grade_save_best'
      ? 'Keep the best 75 plants and preserve the full source lot labels.\nRecord completed quantity in the blank above.'
      : item.action === 'ta' ? 'TA the planned quantity after checking the source lot.'
        : 'Move the planned quantity to the full destination shown. Keep the original lot labels with each group.';
    if (item.action === 'move') {
      item.destinationEvidence[0].uniqueId = `synthetic-live-destination-${index}`;
      item.destinationEvidence[0].itemcode = item.itemcode;
    } else {
      item.destinationLocationcode = '';
      item.destinationEvidence = [];
    }
    return item;
  });
}
payload.operation = 'render';
delete payload.recipientEmails;
delete payload.requestedBy;
delete payload.requestedByEmail;
delete payload.idempotencyKey;
const response = await fetch(endpoint, {
  method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(payload), signal: AbortSignal.timeout(60000), redirect: 'follow'
});
assert.equal(response.ok, true, 'PDF render endpoint must succeed');
const result = await response.json();
assert.equal(result.success, true, result.error || result.message || 'PDF response failed');
assert.equal(result.contractVersion, 'block-clearing-pdf-v1');
assert.equal(result.attachmentCount, 1);
assert.equal(result.file?.mimeType, 'application/pdf');
const bytes = Buffer.from(result.file.base64, 'base64');
assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
if (process.env.BLOCK_CLEARING_SMOKE_OUTPUT_DIR) {
  const directory = resolve(process.env.BLOCK_CLEARING_SMOKE_OUTPUT_DIR);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, multipage ? 'block-clearing-live-render-multipage.pdf' : 'block-clearing-live-render.pdf'), bytes);
}
console.log(JSON.stringify({ ok: true, operation: 'render', fixture: multipage ? 'multipage' : 'single-item', items: payload.report.items.length, sourceRows: payload.report.items.reduce((total, item) => total + item.rows.length, 0), contractVersion: result.contractVersion, attachmentCount: 1, bytes: bytes.length, emailSent: false }));
