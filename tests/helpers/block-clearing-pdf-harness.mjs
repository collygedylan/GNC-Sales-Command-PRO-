import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

export const backendSource = readFileSync(new URL('../../Code.gs', import.meta.url), 'utf8');
export function createBackend(overrides = {}) {
  const start = backendSource.indexOf('const BLOCK_CLEARING_PDF_CONTRACT_');
  const end = backendSource.indexOf('// Photo History uses bounded previews', start);
  if (start < 0 || end < start) throw new Error('Block Clearing PDF backend missing');
  const sent = [];
  const renderedHtml = [];
  const receipts = new Map();
  let lockCount = 0;
  const escape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const context = {
    Utilities: {
      formatDate: () => 'Sep 4, 2026 2:30 PM CDT',
      base64Encode: (value) => Buffer.from(value).toString('base64'),
      computeDigest: (_, value) => [...createHash('sha256').update(value).digest()],
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, getUuid: () => 'synthetic-random-key',
    },
    HtmlService: {
      createHtmlOutput: (html) => {
        renderedHtml.push(html);
        const blob = { getAs() { return this; }, setName(name) { this.name = name; return this; }, getBytes() { return [...Buffer.from('%PDF-1.7\nSynthetic PDF for unit tests')]; } };
        return { getBlob: () => blob };
      },
    },
    MimeType: { PDF: 'application/pdf' },
    escapeEmailHtml_: escape,
    firstNonEmptyRequestValue_: (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim()) ?? '',
    normalizeEmailAddress_: (value) => String(value || '').trim().toLowerCase(),
    isLikelyEmailAddress_: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    resolveRequestRecipientEmail_: (_, fallback) => fallback,
    collectRequestRecipients_: (payload) => ({ toArray: payload.recipientEmails || [] }),
    dedupeEmailAddresses_: (values) => [...new Set(values.flat(Infinity).filter(Boolean).map((value) => String(value).toLowerCase()))],
    isGmailAdvancedServiceAvailable_: () => true,
    requestDeliveryBase64Url_: (bytes) => Buffer.from(bytes).toString('base64url'),
    LockService: { getScriptLock: () => ({ tryLock: () => { lockCount++; return true; }, releaseLock: () => { lockCount--; } }) },
    getRequestDeliveryReceipt_: (id) => receipts.get(id),
    findSentRequestDeliveryByMessageId_: () => null,
    saveRequestDeliveryReceipt_: (id, result) => receipts.set(id, result),
    resolveAutomatedEmailSenderAddress_: () => 'synthetic-automation@example.invalid',
    sendGmailApiMessage_: (options) => { sent.push(options); return { ok: true, gmailMessageId: 'synthetic-message-' + sent.length }; },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(backendSource.slice(start, end), context);
  return { context, sent, renderedHtml, receipts, get lockCount() { return lockCount; } };
}

export function makePayload() {
  return {
    type: 'block_clearing_pdf', operation: 'render', contractVersion: 'block-clearing-pdf-v1',
    requestedBy: 'Synthetic Tester', requestedByEmail: 'synthetic-sender@example.invalid',
    recipientEmails: ['synthetic-worker@example.invalid'], idempotencyKey: 'block-clearing-synthetic-001',
    report: {
      title: 'Block Clearing Worksheet - A.05', createdAt: '2026-09-04T19:30:00.000Z', submittedBy: 'Synthetic Tester', blockalpha: 'A', locationBucket: 'A.05',
      items: [{
        itemcode: '000748.010.1', commonname: 'Dallas Blues Switch Grass', contsize: '#3', action: 'move', quantity: 75,
        destinationMode: 'itemcode', destinationLocationcode: 'B.08.010', instructions: 'Pull the strongest plants first. Keep full lot labels with each group.',
        rows: [
          { uniqueId: 'source-1', itemcode: '000748.010.1', locationcode: 'A.05.000', lotcode: '26.F1', salesyear: '2026', source: 'LD', ptronhand: 40 },
          { uniqueId: 'source-2', itemcode: '000748.010.1', locationcode: 'A.05.010', lotcode: '27.S1', salesyear: '2027', source: 'SH', ptronhand: 65 },
        ],
        destinationEvidence: [{ uniqueId: 'destination-1', itemcode: '000748.010.1', locationcode: 'B.08.010', salesyear: '2027', ptronhand: 90 }],
      }],
    },
  };
}
