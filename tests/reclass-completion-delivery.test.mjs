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

function appsScriptHarness(verifiedPayload) {
  const backend = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
  const start = backend.indexOf('function handleSignedInventoryReclassMoveDelivery_(');
  const end = backend.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  const state = { receipts: new Map(), intents: new Map(), sends: [], rpcCalls: [] };
  const props = {
    getProperty: key => state.intents.get(key) || null,
    setProperty: (key, value) => state.intents.set(key, value),
    deleteProperty: key => state.intents.delete(key),
  };
  const context = vm.createContext({
    Date, JSON, String, Number, Array, Error, Object, isFinite,
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_algorithm, text) => [...createHash('sha256').update(String(text), 'utf8').digest()] },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => props },
    getRequestDeliveryReceipt_: id => state.receipts.get(id) || null,
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
  vm.runInContext(backend.slice(start, end), context);
  return { context, state };
}

const verified = {
  contractVersion: 'inventory-reclass-move-completed-v1', commandId, requestId, actorProfileId: uuid,
  actorUsername: 'dylan_collyge', actorDisplayName: 'Dylan <Ops>', actorEmail: 'actor@example.test', revision: '42',
  deliveryRecipients: ['actor@example.test', 'required-1@example.test', 'required-2@example.test',
    'required-3@example.test', 'required-4@example.test', 'required-5@example.test'],
  moves: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 2,
    source: { commonname: 'Rose <script>', contsize: '5DP', itemcode: '006138.051.1', season: 'F1', lotcode: '27.F1', locationcode: 'D.08.001' },
    destination: { commonname: 'Rose <script>', contsize: '5DP', itemcode: '006138.051.1', season: 'U1', lotcode: '27.U1', locationcode: 'D.08.001' } }],
};

test('Apps Script sends only the frozen verified recipients and recovers duplicate delivery without a second send', () => {
  const { context, state } = appsScriptHarness(verified);
  const delivery = { eventId: '41df62a1-46d5-4d89-9e90-98f28f4647a8', eventKey,
    eventType: 'inventory_reclass_move_completed', leaseToken: '51df62a1-46d5-4d89-9e90-98f28f4647a8',
    requestId, messageIdHeader, payload: { ...verified, deliveryRecipients: ['attacker@evil.test'] } };
  const first = context.handleSignedInventoryReclassMoveDelivery_(delivery);
  assert.equal(first.ok, true);
  assert.equal(state.sends.length, 1);
  assert.deepEqual(state.sends[0].toArray, verified.deliveryRecipients);
  assert.deepEqual(state.sends[0].requiredRecipientEmails, verified.deliveryRecipients);
  assert.match(state.sends[0].htmlBody, /Rose &lt;script&gt;/);
  assert.doesNotMatch(state.sends[0].htmlBody, /<script>/);
  assert.equal(state.rpcCalls.length, 1);
  assert.equal(state.rpcCalls[0].route, 'rpc/prepare_inventory_reclass_move_delivery_v1');
  const replay = context.handleSignedInventoryReclassMoveDelivery_(delivery);
  assert.equal(replay.gmailMessageId, first.gmailMessageId);
  assert.equal(state.sends.length, 1, 'stable message ID receipt prevents a second send');
});

test('Apps Script rejects event, actor, request, recipient, and malformed movement mismatches before Gmail', () => {
  const delivery = { eventId: '41df62a1-46d5-4d89-9e90-98f28f4647a8', eventKey,
    eventType: 'inventory_reclass_move_completed', leaseToken: '51df62a1-46d5-4d89-9e90-98f28f4647a8',
    requestId, messageIdHeader, payload: verified };
  const { context, state } = appsScriptHarness({ ...verified, deliveryRecipients: ['actor@example.test', 'actor@example.test'] });
  assert.throws(() => context.handleSignedInventoryReclassMoveDelivery_(delivery), /RECIPIENTS_INVALID/);
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
