import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBackend, makePayload, backendSource } from './helpers/block-clearing-pdf-harness.mjs';

test('normalizes item identities, dedupes physical rows, and derives snapshot totals', () => {
  const { context } = createBackend();
  const payload = makePayload();
  payload.report.items[0].itemcode = ' 000748.010.1 ';
  payload.report.items[0].rows.push(structuredClone(payload.report.items[0].rows[0]));
  payload.report.totalOnHand = 999999;
  payload.report.items[0].totalOnHand = 999999;
  const report = context.normalizeBlockClearingPdfReport_(payload);
  assert.equal(report.totalOnHand, 105);
  assert.equal(report.itemCount, 1);
  assert.equal(report.rowCount, 2);
  assert.equal(report.items[0].rows[1].locationcode, 'A.05.010');
  assert.equal(report.items[0].rows[1].lotcode, '27.S1');
});

test('rejects conflicting row identities and duplicate item groups', () => {
  const { context } = createBackend();
  for (const changed of ['ptronhand', 'lotcode', 'source', 'locationcode']) {
    const payload = makePayload();
    const row = structuredClone(payload.report.items[0].rows[0]);
    row[changed] = changed === 'ptronhand' ? 41 : changed === 'locationcode' ? 'A.05.020' : 'changed';
    payload.report.items[0].rows.push(row);
    assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /CONFLICTING_ROW_ID/);
  }
  const payload = makePayload();
  payload.report.items.push(structuredClone(payload.report.items[0]));
  assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /DUPLICATE_ITEMCODE/);
});

test('rejects invalid quantities and stock counts before any rendering or email', () => {
  const backend = createBackend();
  for (const quantity of [0, -1, 1.5, 106, '', null, true, '1e2', '0x20', {}, NaN, Infinity]) {
    const payload = makePayload();
    payload.report.items[0].quantity = quantity;
    assert.throws(() => backend.context.handleBlockClearingPdf_(payload), /QUANTITY/);
  }
  for (const ptronhand of [-1, '', null, true, '0x20', 'invalid', Infinity]) {
    const payload = makePayload();
    payload.report.items[0].rows[0].ptronhand = ptronhand;
    assert.throws(() => backend.context.handleBlockClearingPdf_(payload), /PTRONHAND/);
  }
  assert.equal(backend.renderedHtml.length, 0);
  assert.equal(backend.sent.length, 0);
});

test('requires source rows in the exact bucket and matching item', () => {
  const { context } = createBackend();
  for (const locationcode of ['A.06.000', 'A.050.000', 'B.05.000', 'A.05.']) {
    const payload = makePayload();
    payload.report.items[0].rows[0].locationcode = locationcode;
    assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /ROW_OUTSIDE_BUCKET|ROW_LOCATION/);
  }
  const payload = makePayload();
  payload.report.items[0].rows[0].itemcode = 'OTHER';
  assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /ROW_ITEMCODE/);
});

test('matches padded numeric buckets while preserving raw full locations and supports named locations', () => {
  const { context } = createBackend();
  const payload = makePayload();
  payload.report.items[0].rows[0].locationcode = 'A.5.000';
  let report = context.normalizeBlockClearingPdfReport_(payload);
  assert.equal(report.locationBucket, 'A.05');
  assert.equal(report.items[0].rows[0].locationcode, 'A.05.010');
  assert.ok(report.items[0].rows.some((row) => row.locationcode === 'A.5.000'));
  payload.report.locationBucket = 'HOLD PAD';
  payload.report.blockalpha = 'Z';
  payload.report.items[0].rows.forEach((row) => { row.locationcode = 'HOLD PAD'; });
  payload.report.items[0].destinationLocationcode = 'QUARANTINE PAD';
  payload.report.items[0].destinationEvidence[0].locationcode = 'QUARANTINE PAD';
  report = context.normalizeBlockClearingPdfReport_(payload);
  assert.equal(report.locationBucket, 'HOLD PAD');
  assert.equal(report.items[0].destinationLocationcode, 'QUARANTINE PAD');
});

test('Move accepts any source sales year, but requires matching destination evidence', () => {
  const { context } = createBackend();
  const payload = makePayload();
  assert.equal(context.normalizeBlockClearingPdfReport_(payload).items[0].destinationEvidence[0].salesyear, '2027');
  payload.report.items[0].destinationEvidence[0].salesyear = '2028';
  assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /DESTINATION_ITEM_YEAR_MISMATCH/);
  payload.report.items[0].destinationEvidence[0].salesyear = '2026';
  payload.report.items[0].destinationEvidence[0].itemcode = 'OTHER';
  assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /DESTINATION_ITEM_YEAR_MISMATCH/);
  payload.report.items[0].destinationMode = 'all';
  assert.equal(context.normalizeBlockClearingPdfReport_(payload).items[0].destinationLocationcode, 'B.08.010');
  payload.report.items[0].destinationEvidence = [];
  assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /DESTINATION_EVIDENCE/);
});

test('Move rejects the entire source bucket, incomplete destinations, and conflicting evidence', () => {
  const { context } = createBackend();
  for (const destination of ['', 'A.05', 'A.05.999', 'A.05.010', 'B.08', 'B.08.']) {
    const payload = makePayload();
    payload.report.items[0].destinationLocationcode = destination;
    assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /FULL_DESTINATION_REQUIRED|DESTINATION_INSIDE_BUCKET|DESTINATION_EVIDENCE/);
  }
  const payload = makePayload();
  payload.report.items[0].destinationEvidence[0].uniqueId = 'source-1';
  assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /CONFLICTING_ROW_ID/);
});

test('TA and Grade & Save Best work without a destination and reject stale Move fields', () => {
  const { context } = createBackend();
  for (const action of ['ta', 'grade_save_best']) {
    const payload = makePayload();
    payload.report.items[0].action = action;
    assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /DESTINATION_REQUIRES_MOVE/);
    payload.report.items[0].destinationLocationcode = '';
    payload.report.items[0].destinationEvidence = [];
    const report = context.normalizeBlockClearingPdfReport_(payload);
    assert.equal(report.items[0].action, action);
    if (action === 'grade_save_best') assert.match(context.buildBlockClearingPdfHtml_(report), /number of best plants to keep/);
  }
});

test('requires supported contract and operation and validates descriptive fields', () => {
  const { context } = createBackend();
  for (const [field, value, expected] of [['contractVersion', 'old', 'CONTRACT_VERSION'], ['operation', 'send', 'OPERATION']]) {
    const payload = makePayload();
    payload[field] = value;
    assert.throws(() => context.handleBlockClearingPdf_(payload), new RegExp(expected));
  }
  for (const [field, value] of [['createdAt', 'yesterday'], ['title', {}], ['submittedBy', ''], ['blockalpha', 'B'], ['locationBucket', 'A.05.000']]) {
    const payload = makePayload();
    payload.report[field] = value;
    assert.throws(() => context.handleBlockClearingPdf_(payload), /BLOCK_CLEARING_VALIDATION/);
  }
});

test('render returns one PDF, exposes no mail side effects, and escapes user content', () => {
  const backend = createBackend();
  const payload = makePayload();
  payload.report.title = '<script>alert(1)</script>';
  payload.report.items[0].instructions = '<img src=x onerror=alert(1)>\nSecond line';
  const result = backend.context.handleBlockClearingPdf_(payload);
  assert.equal(result.success, true);
  assert.equal(result.contractVersion, 'block-clearing-pdf-v1');
  assert.equal(result.attachmentCount, 1);
  assert.equal(result.file.mimeType, 'application/pdf');
  assert.match(result.file.filename, /^GNC_PH_Block_Clearing_A\.05_.*\.pdf$/);
  assert.equal(Buffer.from(result.file.base64, 'base64').subarray(0, 5).toString(), '%PDF-');
  assert.equal(backend.sent.length, 0);
  assert.equal(backend.receipts.size, 0);
  assert.doesNotMatch(backend.renderedHtml[0], /<script>|<img /);
  assert.match(backend.renderedHtml[0], /&lt;img/);
  for (const text of ['size:letter landscape', 'A.05.010', '27.S1', 'Actual Qty', 'Worker Signature', 'Completion Date', 'Total Plants On Hand: 105', 'Clearing Location:', 'Move To']) assert.ok(backend.renderedHtml[0].includes(text), text);
});

test('email uses the same canonical PDF builder and exactly one attachment; sender and Dylan are included', () => {
  const backend = createBackend();
  const payload = makePayload();
  const download = backend.context.handleBlockClearingPdf_(payload);
  payload.operation = 'email';
  payload.attachments = [{ filename: 'untrusted.xlsx', base64: 'x' }];
  const email = backend.context.handleBlockClearingPdf_(payload);
  assert.equal(email.success, true);
  assert.equal(email.attachmentCount, 1);
  assert.equal(email.pdfFilename, download.file.filename);
  assert.equal(backend.renderedHtml[0], backend.renderedHtml[1]);
  assert.equal(backend.sent[0].attachments.length, 1);
  assert.equal(backend.sent[0].attachments[0].name, download.file.filename);
  assert.deepEqual(Array.from(backend.sent[0].toArray), ['dylan_collyge@greenleafnursery.com', 'synthetic-sender@example.invalid', 'synthetic-worker@example.invalid']);
  assert.equal(backend.lockCount, 0);
});

test('exact retry recovers its receipt without generating or sending again; changed content is a new delivery', () => {
  const backend = createBackend();
  const payload = makePayload();
  payload.operation = 'email';
  backend.context.handleBlockClearingPdf_(payload);
  payload.report.items[0].rows.reverse();
  const recovered = backend.context.handleBlockClearingPdf_(payload);
  assert.equal(recovered.recovered, true);
  assert.equal(backend.sent.length, 1);
  assert.equal(backend.renderedHtml.length, 1);
  payload.report.items[0].quantity = 70;
  backend.context.handleBlockClearingPdf_(payload);
  assert.equal(backend.sent.length, 2);
  assert.notEqual(backend.sent[0].messageIdHeader, backend.sent[1].messageIdHeader);
});

test('recovers Sent-mail evidence after an interrupted receipt write', () => {
  const backend = createBackend({ findSentRequestDeliveryByMessageId_: () => ({ gmailMessageId: 'already-sent' }) });
  const payload = makePayload();
  payload.operation = 'email';
  assert.equal(backend.context.handleBlockClearingPdf_(payload).recovered, true);
  assert.equal(backend.sent.length, 0);
  assert.equal(backend.renderedHtml.length, 0);
});

test('conversion, service, or send failures never fall back to attachment-free email', () => {
  const payload = makePayload();
  payload.operation = 'email';
  const conversion = createBackend({ HtmlService: { createHtmlOutput: () => { throw new Error('conversion failed'); } } });
  assert.throws(() => conversion.context.handleBlockClearingPdf_(payload), /PDF_BUILD_FAILED/);
  assert.equal(conversion.sent.length, 0);
  assert.equal(conversion.lockCount, 0);
  const service = createBackend({ isGmailAdvancedServiceAvailable_: () => false });
  assert.throws(() => service.context.handleBlockClearingPdf_(payload), /GMAIL_SERVICE_UNAVAILABLE/);
  assert.equal(service.sent.length, 0);
  let attempts = 0;
  const send = createBackend({ sendGmailApiMessage_: () => { attempts++; throw new Error('send failed'); } });
  assert.throws(() => send.context.handleBlockClearingPdf_(payload), /BLOCK_CLEARING_EMAIL_SEND_FAILED/);
  assert.equal(attempts, 1);
  assert.equal(send.lockCount, 0);
});

test('requires a resolved sender and safe idempotency key for email', () => {
  const backend = createBackend();
  const payload = makePayload();
  payload.operation = 'email';
  payload.requestedByEmail = 'not-an-email';
  assert.throws(() => backend.context.handleBlockClearingPdf_(payload), /SENDER_EMAIL_REQUIRED/);
  payload.requestedByEmail = 'synthetic-sender@example.invalid';
  payload.idempotencyKey = 'injected\r\nheader';
  assert.throws(() => backend.context.handleBlockClearingPdf_(payload), /IDEMPOTENCY_KEY/);
});

test('busy locks are sanitized and never render or email; successful sends tolerate receipt-storage failure', () => {
  const payload = makePayload();
  payload.operation = 'email';
  const busy = createBackend({ LockService: { getScriptLock: () => { throw new Error('private lock detail'); } } });
  assert.throws(() => busy.context.handleBlockClearingPdf_(payload), /^Error: BLOCK_CLEARING_EMAIL_BUSY_RETRY$/);
  assert.equal(busy.sent.length, 0);
  assert.equal(busy.renderedHtml.length, 0);
  const failedReceipt = createBackend({ saveRequestDeliveryReceipt_: () => { throw new Error('private properties detail'); } });
  const result = failedReceipt.context.handleBlockClearingPdf_(payload);
  assert.equal(result.success, true);
  assert.equal(result.receiptPersisted, false);
  assert.equal(failedReceipt.sent.length, 1);
  assert.equal(failedReceipt.lockCount, 0);
});

test('honors the editor field limits and rejects malformed destination evidence', () => {
  const { context } = createBackend();
  const payload = makePayload();
  payload.report.title = 'T'.repeat(200);
  payload.report.items[0].instructions = 'I'.repeat(4000);
  assert.equal(context.normalizeBlockClearingPdfReport_(payload).title.length, 200);
  payload.report.title += 'T';
  assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /TITLE/);
  payload.report.title = 'Valid title';
  payload.report.items[0].instructions += 'I';
  assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /INSTRUCTIONS/);
  payload.report.items[0].instructions = '';
  payload.report.items[0].action = 'ta';
  payload.report.items[0].destinationLocationcode = '';
  payload.report.items[0].destinationEvidence = {};
  assert.throws(() => context.normalizeBlockClearingPdfReport_(payload), /DESTINATION_EVIDENCE/);
});

test('routes the new contract independently and retains the legacy Excel email path', () => {
  assert.match(backendSource, /if \(payload\.type === 'block_clearing_pdf'\)\s*\{\s*return jsonOutput_\(handleBlockClearingPdf_\(payload\)\)/);
  assert.match(backendSource, /safeType === 'drive_shift_report' \|\| safeType === 'block_clearing_email'/);
  const handler = backendSource.slice(backendSource.indexOf('function handleBlockClearingPdf_'), backendSource.indexOf('// Photo History uses bounded previews'));
  assert.doesNotMatch(handler, /GmailApp|sendRequestEmailWithFallback_|buildRequestEmailAttachmentBlob_/);
});
