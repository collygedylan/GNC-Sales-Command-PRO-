import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { handleInventoryReclassMove } from '../supabase/functions/_shared/production-workflow.ts';

const actor = { id: 'ec34e498-ed81-4b30-8236-5751af4e68cb', username: 'dylan_collyge', role: 'Admin', must_change_password: false };
const uuid = 'ec34e498-ed81-4b30-8236-5751af4e68cb';
const commandId = 'reclass-delivery-command-0001';
const requestId = '06df62a1-46d5-4d89-9e90-98f28f4647a8';
const eventKey = `inventory-reclass-move-completed:${uuid}:${commandId}`;
const messageIdHeader = `<gnc-${createHash('sha256').update(eventKey).digest('hex').slice(0, 40)}@request-delivery.agdatasolutions.local>`;
const payload = {
  action: 'inventory_reclass_move', commandId, expectedRevision: 41,
  moves: [{ source: { uniqueId: 'source-1', identity: {
    unique_id: 'source-1', itemcode: '006138.051.1', contsize: '5DP', locationcode: 'D.08.001',
    lotcode: null, season: 'F1', ptronhand: '10', ptravailable: '8',
  } }, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 2 }] }],
};

test('Reclass move service uses one idempotent move-and-delivery RPC; status remains a read-only RPC', async () => {
  const calls = [];
  const supabase = { rpc: async (name, params) => { calls.push({ name, params }); return { data: { status: 'applied' }, error: null }; } };
  const applied = await handleInventoryReclassMove({ supabase, actorProfile: actor,
    payload: { ...payload, receiptEncoding: 'master-null-elision-v1' } });
  assert.equal(applied.status, 'applied');
  assert.equal(calls[0].name, 'apply_inventory_reclass_moves_with_delivery_v1');
  assert.deepEqual(calls[0].params, {
    p_actor_id: actor.id, p_command_id: commandId, p_expected_revision: 41,
    p_moves: payload.moves, p_receipt_encoding: 'master-null-elision-v1',
  });
  calls.length = 0;
  await handleInventoryReclassMove({ supabase, actorProfile: actor,
    payload: { action: 'inventory_reclass_move', operation: 'status', commandId } });
  assert.equal(calls[0].name, 'get_inventory_reclass_move_status_v1');
  assert.equal(calls[0].params.p_actor_id, actor.id);
  calls.length = 0;
  await assert.rejects(handleInventoryReclassMove({ supabase, actorProfile: actor,
    payload: { ...payload, actor_id: 'untrusted' } }), /PAYLOAD_INVALID/);
  assert.equal(calls.length, 0, 'caller-supplied actor identity is rejected before database dispatch');
});

function appsScriptHarness(verifiedPayload, authoritativeRecipients = ['dylan@example.test', 'megan@example.test', 'sharon@example.test', 'actor@example.test']) {
  const backend = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
  const recipientsStart = backend.indexOf('function getReclassInquiryEmailRecipients_(payload)');
  const recipientsEnd = backend.indexOf('\nfunction ', recipientsStart + 1);
  const start = backend.indexOf('function handleSignedInventoryReclassMoveDelivery_(');
  const end = backend.indexOf('\nfunction ', start + 1);
  assert.ok(recipientsStart >= 0 && recipientsEnd > recipientsStart && start >= 0 && end > start);
  const state = { receipts: new Map(), intents: new Map(), sends: [], rpcCalls: [], recipientCalls: [] };
  const props = {
    getProperty: key => state.intents.get(key) || null,
    setProperty: (key, value) => state.intents.set(key, value),
    deleteProperty: key => state.intents.delete(key),
  };
  const context = vm.createContext({
    Date, JSON, String, Number, Array, Error, Object, isFinite,
    firstNonEmptyRequestValue_: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, text) => [...createHash('sha256').update(String(text), 'utf8').digest()] },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => props },
    getRequestDeliveryReceipt_: id => state.receipts.get(id) || null,
    callSupabaseRpc_: (name, params) => {
      state.recipientCalls.push({ name, params });
      if (name !== 'get_reclass_delivery_recipients_v1') throw new Error('unexpected recipient RPC');
      return authoritativeRecipients;
    },
    findSentRequestDeliveryByMessageId_: id => {
      const sent = state.sentByMessageId?.get(id);
      // Mirrors getGmailDeliveryMetadata_: Gmail search returns message headers
      // and IDs, not the send helper's transient `mode` field.
      if (!sent) return null;
      return { gmailMessageId: sent.gmailMessageId, threadId: sent.threadId, messageId: sent.messageId,
        replyToMessageId: sent.replyToMessageId || '' };
    },
    saveRequestDeliveryReceipt_: (id, result) => state.receipts.set(id, { ...result, messageIdHeader: id }),
    requestDeliveryRest_: (route, method, query, body) => {
      state.rpcCalls.push({ route, method, query, body });
      return verifiedPayload;
    },
    normalizeEmailAddress_: value => String(value || '').trim().toLowerCase(),
    dedupeEmailAddresses_: values => [...new Set(values.map(value => String(value).trim().toLowerCase()))],
    isLikelyEmailAddress_: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')),
    resolveOperationalEmailHeaders_: values => ({ to: [...values] }),
    resolveAutomatedEmailSenderAddress_: () => 'automation@example.com',
    MimeType: { PDF: 'application/pdf' },
    HtmlService: { createHtmlOutput: htmlOutput => ({ getBlob: () => ({ htmlOutput, getAs(type) { return { type, htmlOutput, filename: '', setName(name) { this.filename = name; return this; } }; } }) }) },
    buildCompletedInventoryReclassReportModel_: (receipt, now) => {
      state.reportInput = receipt;
      return { identity: { commonname: 'Cobalt and Gold St. John\'s Wort', contsize: '3DP', itemspec: '18 inch' },
        actorDisplay: receipt.actorDisplayName, requestActionLabel: 'Reclass Move Completed', completedRevision: receipt.revision,
        completedMoveSummary: receipt.moves };
    },
    buildReclassItemInquiryPdf_: () => ({ type: 'application/pdf', filename: 'GNC_PH_Reclass_Completed_Cobalt_and_Gold_St_Johns_Wort.pdf',
      htmlOutput: 'ITEM SPEC H/S Priority Loc Note Available' }),
    buildReclassInquiryEmailSubject_: model => `${model.identity.contsize} ${model.identity.commonname} Reclass - Move Completed`,
    buildReclassInquiryCompactReportHtml_: model => '<html>GNC PH Reclass Item Inquiry ITEM SPEC H/S Priority Loc Note Available ' + model.identity.itemspec + '</html>',
    buildReclassInquiryReportText_: () => 'GNC PH Reclass Item Inquiry completed report',
    buildReclassInquiryEmailHtml_: () => '<div>GNC PH Reclass Item Inquiry completed report</div>',
    escapeEmailHtml_: value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    sendGmailApiMessage_: options => {
      state.sends.push(options);
      const result = { ok: true, gmailMessageId: `gmail-${state.sends.length}`, threadId: `thread-${state.sends.length}`,
        messageId: `message-${state.sends.length}`, recipients: options.toArray, mode: 'gmail_api' };
      if (state.throwAfterSend) {
        state.throwAfterSend = false;
        state.sentByMessageId = new Map([[options.messageIdHeader, result]]);
        throw new Error('simulated transport response loss after acceptance');
      }
      return result;
    },
  });
  vm.runInContext(`${backend.slice(recipientsStart, recipientsEnd)}\n${backend.slice(start, end)}`, context);
  return { context, state };
}

const verified = {
  contractVersion: 'inventory-reclass-move-completed-v1', commandId, requestId, actorProfileId: uuid,
  actorUsername: 'tester', actorDisplayName: 'Dylan <Ops>', actorEmail: 'actor@example.test', revision: '42',
  deliveryRecipients: ['dylan@example.test', 'megan@example.test', 'sharon@example.test', 'actor@example.test'],
  report_rows: [{ unique_id: 'source-1', itemcode: '006138.051.1', commonname: 'Cobalt and Gold St. John\'s Wort',
    contsize: '3DP', season: 'F1', lotcode: '27.F1', locationcode: 'D.08.001', ptronhand: '10', ptrreviewed: '0',
    ptravailable: '8', itemspec: '18 inch', holdstopcode: 'H', holdstopreason: 'test', priority: '1',
    locationnote: 'retied', salesnote: 'confirm' }],
  appliedRows: [
    { table: 'ph_master_inventory', row: { unique_id: 'source-1', itemcode: '006138.051.1', commonname: 'Cobalt and Gold St. John\'s Wort', contsize: '3DP', season: 'F1', lotcode: '27.F1', locationcode: 'D.08.001', ptronhand: '8', ptravailable: '6', itemspec: '18 inch', holdstopcode: 'H', holdstopreason: 'test', priority: '1', locationnote: 'retied', salesnote: 'confirm' } },
    { table: 'ph_master_inventory', row: { unique_id: 'dest-1', itemcode: '006138.051.1', commonname: 'Cobalt and Gold St. John\'s Wort', contsize: '3DP', season: 'U1', lotcode: '27.U1', locationcode: 'D.08.001', ptronhand: '2', ptravailable: '2', itemspec: '18 inch', holdstopcode: null, holdstopreason: null, priority: '1', locationnote: 'retied', salesnote: 'confirm' } },
  ],
  moves: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 2,
    source: { unique_id: 'source-1', commonname: 'Cobalt and Gold St. John\'s Wort', contsize: '3DP', itemcode: '006138.051.1', season: 'F1', lotcode: '27.F1', locationcode: 'D.08.001' },
    destination: { unique_id: 'dest-1', commonname: 'Cobalt and Gold St. John\'s Wort', contsize: '3DP', itemcode: '006138.051.1', season: 'U1', lotcode: '27.U1', locationcode: 'D.08.001' } }],
};

test('Apps Script sends the canonical manager recipients plus actor, attaches report, and recovers without a second send', () => {
  const { context, state } = appsScriptHarness(verified);
  const delivery = { eventId: '41df62a1-46d5-4d89-9e90-98f28f4647a8', eventKey,
    eventType: 'inventory_reclass_move_completed', leaseToken: '51df62a1-46d5-4d89-9e90-98f28f4647a8',
    requestId, messageIdHeader, payload: { ...verified, deliveryRecipients: ['attacker@evil.test'] } };
  const first = context.handleSignedInventoryReclassMoveDelivery_(delivery);
  assert.equal(first.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(state.recipientCalls)), [
    { name: 'get_reclass_delivery_recipients_v1', params: { p_actor_username: verified.actorUsername } }
  ]);
  assert.equal(state.sends.length, 1);
  assert.deepEqual(state.sends[0].toArray, verified.deliveryRecipients);
  assert.deepEqual(state.sends[0].requiredRecipientEmails, verified.deliveryRecipients);
  assert.match(state.sends[0].htmlBody, /GNC PH Reclass Item Inquiry/);
  assert.equal(state.sends[0].attachments.length, 1);
  assert.equal(state.sends[0].attachments[0].type, 'application/pdf');
  assert.match(state.sends[0].attachments[0].filename, /GNC_PH_Reclass_Completed_Cobalt_and_Gold_St_Johns_Wort\.pdf/);
  assert.match(state.sends[0].attachments[0].htmlOutput, /ITEM SPEC H\/S Priority Loc Note Available/);
  assert.doesNotMatch(state.sends[0].subject, new RegExp(commandId));
  assert.equal(state.reportInput.appliedRows.length, 2);
  assert.equal(state.rpcCalls.length, 1);
  assert.equal(state.rpcCalls[0].route, 'rpc/prepare_inventory_reclass_move_delivery_v1');
  const replay = context.handleSignedInventoryReclassMoveDelivery_(delivery);
  assert.equal(replay.gmailMessageId, first.gmailMessageId);
  assert.equal(state.sends.length, 1, 'stable message ID receipt prevents a second send');
});

test('completed report model uses only the frozen pre-edit ERP rows and separately labels the applied move', () => {
  const backend = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
  const start = backend.indexOf('function buildCompletedInventoryReclassReportModel_(');
  const end = backend.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  const rows = [
    { unique_id: 'source-1', commonname: 'Cobalt and Gold St. John\'s Wort', contsize: '3DP', itemcode: '006138.051.1',
      season: 'F1', lotcode: '27.F1', locationcode: 'D.08.001', ptronhand: '8', ptravailable: '6', itemspec: '18 inch',
      holdstopcode: 'H', holdstopreason: 'test', priority: '1', locationnote: 'retied', salesnote: 'confirm' },
    { unique_id: 'dest-1', commonname: 'Cobalt and Gold St. John\'s Wort', contsize: '3DP', itemcode: '006138.051.1',
      season: 'U1', lotcode: '27.U1', locationcode: 'D.08.001', ptronhand: '2', ptravailable: '2', itemspec: '18 inch' },
  ];
  const captured = {};
  const fields = ['commonname', 'contsize', 'itemcode', 'season', 'lotcode', 'locationcode', 'ptronhand', 'ptravailable', 'itemspec', 'holdstopcode', 'holdstopreason', 'priority', 'locationnote', 'salesnote']
    .map(key => ({ key, aliases: [key] }));
  const context = vm.createContext({
    Date, Array, Map, String, Number, Object, Error,
    RECLASS_INQUIRY_ROW_FIELDS_: fields,
    firstNonEmptyRequestValue_: (...values) => values.find(value => value != null && String(value).trim()) || '',
    normalizeInventoryTransactionText_: value => String(value == null ? '' : value).trim(),
    getInventoryTransactionRowUid_: row => row && row.unique_id,
    getReclassInquiryExactValue_: (row, aliases) => { for (const alias of aliases) if (row && row[alias] != null) return row[alias]; return ''; },
    buildReclassInquiryReportModel_: (_source, authoritativeRows, reportRows, payload) => {
      captured.authoritativeRows = authoritativeRows;
      captured.reportRows = reportRows;
      captured.payload = payload;
      return { identity: { commonname: _source.commonname, contsize: _source.contsize, itemspec: _source.itemspec }, actorDisplay: payload.actor.display };
    },
  });
  vm.runInContext(backend.slice(start, end), context);
  const model = context.buildCompletedInventoryReclassReportModel_({
    actorUsername: 'tester', actorDisplayName: 'Tester', revision: '42',
    appliedRows: rows.map(row => ({ table: 'ph_master_inventory', row })),
    report_rows: [{ ...rows[0], ptronhand: '10', ptrreviewed: '0', ptravailable: '8' }],
    moves: [{ direction: 'move_up', quantity: 2, source: { unique_id: 'source-1' }, destination: { unique_id: 'dest-1', season: 'U1' } }],
  }, new Date('2026-10-20T12:00:00Z'));
  assert.equal(captured.authoritativeRows.length, 1, 'the app-created destination row is excluded from the inquiry table');
  assert.equal(captured.authoritativeRows[0].ptronhand, '10', 'the source retains its pre-edit OH');
  assert.equal(captured.authoritativeRows[0].ptrreviewed, '0', 'the source retains its pre-edit PTRREVIEWED');
  assert.equal(captured.reportRows[0].values.ptronhand, '10');
  assert.equal(captured.reportRows[0].values.itemspec, '18 inch');
  assert.equal(captured.reportRows[0].values.holdstopcode, 'H');
  assert.equal(captured.reportRows[0].values.priority, '1');
  assert.equal(captured.reportRows[0].values.locationnote, 'retied');
  assert.equal(model.completedRevision, '42');
  assert.equal(model.completedMoveSummary[0].quantity, 2);
  assert.equal(model.requestActionLabel, 'Reclass Move Completed');
});

test('Apps Script rejects event, actor, request, recipient, and malformed movement mismatches before Gmail', () => {
  const delivery = { eventId: '41df62a1-46d5-4d89-9e90-98f28f4647a8', eventKey,
    eventType: 'inventory_reclass_move_completed', leaseToken: '51df62a1-46d5-4d89-9e90-98f28f4647a8',
    requestId, messageIdHeader, payload: verified };
  const { context, state } = appsScriptHarness(verified, ['dylan@example.test', 'megan@example.test', 'sharon@example.test']);
  assert.throws(() => context.handleSignedInventoryReclassMoveDelivery_(delivery), /INVENTORY_RECLASS_MOVE_RECIPIENTS_INVALID/);
  assert.equal(state.sends.length, 0);
  assert.equal(state.rpcCalls.length, 1);

  const { context: mismatch, state: mismatchState } = appsScriptHarness(verified);
  assert.throws(() => mismatch.handleSignedInventoryReclassMoveDelivery_({ ...delivery, requestId: '61df62a1-46d5-4d89-9e90-98f28f4647a8' }), /RECEIPT_INVALID/);
  assert.equal(mismatchState.sends.length, 0);
});

test('ambiguous Gmail acceptance is recovered by stable Message-ID without a second send', () => {
  const { context, state } = appsScriptHarness(verified);
  state.throwAfterSend = true;
  const delivery = { eventId: '41df62a1-46d5-4d89-9e90-98f28f4647a8', eventKey,
    eventType: 'inventory_reclass_move_completed', leaseToken: '51df62a1-46d5-4d89-9e90-98f28f4647a8',
    requestId, messageIdHeader, payload: verified };
  assert.throws(() => context.handleSignedInventoryReclassMoveDelivery_(delivery), /simulated transport response loss/);
  const recovered = context.handleSignedInventoryReclassMoveDelivery_(delivery);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.mode, 'gmail_api_idempotent_recovery');
  assert.equal(state.sends.length, 1);
});

test('delivery worker has an explicit lease-checked Reclass event path and never uses caller recipient fields', () => {
  const worker = readFileSync(new URL('../supabase/functions/request-delivery-worker/index.ts', import.meta.url), 'utf8');
  assert.match(worker, /eventType === "inventory_reclass_move_completed"[\s\S]*?prepare_inventory_reclass_move_delivery_v1/);
  assert.match(worker, /event\.payload = payload;[\s\S]*?callAppsScript\(event, \[\], null\)/);
  assert.doesNotMatch(worker, /deliveryRecipients:\s*event\.payload/);
});
