import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: suspend
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readComposedAppSource().replace(/\r\n/g, '\n');

function extract(name) {
  const match = html.match(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(match, `${name} exists`);
  const start = match.index;
  const next = html.slice(start + match[0].length).search(/\n        (?:async )?function \w+\(/);
  assert.ok(next >= 0, `${name} boundary`);
  return html.slice(start, start + match[0].length + next);
}

const sourceRow = { UNIQUE_ID: 'master-42', ITEMCODE: 'SKU-9', LOTCODE: '27.U3', LOCATIONCODE: 'A1' };
const payload = version => ({
  workflowPolicyVersion: version,
  idempotencyToken: 'token-42',
  source: { unique_id: sourceRow.UNIQUE_ID, itemcode: sourceRow.ITEMCODE },
  actor: { email: 'actor@example.test' },
  recipientEmails: ['old@example.test'], emailRecipients: ['old@example.test'], recipients: [{ email: 'old@example.test' }],
  transaction: { requestAction: 'reclass' },
});

function transportHarness({ sourceView = 'suspend-tag', failCreate = false } = {}) {
  const calls = [];
  const job = { token: 'token-42', status: 'queued', actorUsername: 'tester', sourceView,
    sourceUid: sourceRow.UNIQUE_ID, payload: payload('legacy'), recipientEmails: [] };
  const jobs = new Map([[job.token, job]]);
  const context = vm.createContext({
    String, Object, Array, Set, Map, Date, JSON, Number, Promise,
    window: { GncDatabase: { validateReclassEditableFieldProposals: value => value } },
    RECLASS_ACTION_WORKFLOW_V7_POLICY_VERSION: 'v7',
    argosInventoryTransactionState: { sourceView, item: sourceRow },
    canCurrentUserSubmitRepInventoryOperations: () => false,
    // This transport fixture has no loaded inventory/status patches. The shared
    // handler must preserve its request-only routing and idempotency assertions.
    getInventoryStatusSync: () => null,
    buildInventoryStatusPatches: () => [],
    firstNonEmptyValue: (...values) => values.find(value => value !== '' && value != null),
    isArgosEvalReport2Inquiry: () => false,
    dedupeRequestEmailRecipients: values => [...new Set(values)],
    openGroupedBloomNcrRecipientModal: async () => { throw new Error('protected mode must not show recipient picker'); },
    driveReclassApi: async (operation, body, options = {}) => {
      calls.push({ type: 'protected', operation, body: structuredClone(body), options });
      if (operation === 'create' && failCreate) throw new Error('mock create failure');
      return operation === 'status' ? { status: 'delivered', deliveredAt: 'now' } : { ok: true, status: 'queued' };
    },
    postGoogleScriptRawJsonPayload: async (...args) => { calls.push({ type: 'legacy', args }); return { ok: true, status: 'queued' }; },
    getCurrentReclassDeliveryActor: () => 'tester',
    document: { hidden: false },
    readReclassDeliveryJobs: () => [...jobs.values()],
    renderReclassDeliveryStatusTray: () => {},
    upsertReclassDeliveryJob: updated => jobs.set(updated.token, updated),
    getReclassDeliveryJob: token => jobs.get(token),
    reclassDeliveryPollActive: false,
    showToast: () => {},
    getFriendlyBackendErrorMessage: error => error.message,
  });
  vm.runInContext([
    extract('applyArgosInventoryTransactionSourceContext'),
    extract('applyArgosInventoryTransactionEmailRecipients'),
    extract('isProtectedDriveReclassPayload'),
    extract('runInventoryStatusMutation'),
    extract('postArgosInventoryTransactionPayload'),
    extract('pollReclassDeliveryJobs'),
    extract('retryReclassDeliveryJob'),
  ].join('\n'), context);
  return { context, calls, jobs };
}

test('Suspend Tag payload uses protected create, keeps master identity and idempotency, and removes client recipients', async () => {
  const h = transportHarness();
  const legacy = payload('legacy');
  const mapped = h.context.applyArgosInventoryTransactionSourceContext(legacy);
  assert.equal(mapped.sourceContext.sourceMode, 'drive');
  const withRecipients = await h.context.applyArgosInventoryTransactionEmailRecipients(mapped);
  assert.equal(withRecipients.recipientEmails, undefined);
  assert.equal(withRecipients.emailRecipients, undefined);
  assert.equal(withRecipients.recipients, undefined);
  assert.equal(withRecipients.actor, undefined);
  await h.context.postArgosInventoryTransactionPayload(withRecipients);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].type, 'protected');
  assert.equal(h.calls[0].operation, 'create');
  assert.equal(h.calls[0].body.source.unique_id, 'master-42');
  assert.equal(h.calls[0].options.idempotencyKey, 'token-42');

  const v7 = payload('v7');
  h.context.argosInventoryTransactionState.sourceView = 'suspend-tag';
  const v7Mapped = h.context.applyArgosInventoryTransactionSourceContext(v7);
  await h.context.postArgosInventoryTransactionPayload(v7Mapped);
  assert.equal(h.calls[1].type, 'protected');
  assert.equal(h.calls[1].body.sourceContext.sourceMode, 'drive');
});

test('legacy non-V7 Suspend Tag jobs poll and retry through protected endpoints', async () => {
  const h = transportHarness();
  assert.equal(await h.context.pollReclassDeliveryJobs(), true);
  assert.deepEqual(h.calls.map(call => [call.type, call.operation]), [['protected', 'status']]);
  assert.equal(h.jobs.get('token-42').status, 'delivered');
  h.jobs.get('token-42').payload = payload('legacy');
  assert.equal(await h.context.retryReclassDeliveryJob('token-42'), false);
  assert.ok(h.calls.some(call => call.type === 'protected' && call.operation === 'retry'));
  assert.equal(h.calls.some(call => call.type === 'legacy'), false);
});

function submitHarness(failCreate = false) {
  const dom = new JSDOM('<!doctype html><button id="argos-inventory-transaction-apply">Send</button>');
  const calls = [];
  const state = { sourceView: 'suspend-tag', item: sourceRow, submitting: false, action: 'reclass', idempotencyToken: 'token-42' };
  const context = vm.createContext({
    String, Object, Array, Set, Map, Date, JSON, Number, Promise,
    window: dom.window,
    GncDatabase: { validateReclassEditableFieldProposals: value => value },
    document: dom.window.document,
    argosInventoryTransactionState: state,
    ensureArgosReclassSubmissionVerification: async () => {},
    RECLASS_ACTION_WORKFLOW_V6_POLICY_VERSION: 'v6',
    RECLASS_ACTION_WORKFLOW_V7_POLICY_VERSION: 'v7',
    getArgosReclassLiveEditIdentityKey: () => 'actor-session',
    getCurrentReclassDeliveryActor: () => 'tester',
    applyArgosInventoryTransactionSourceContext: p => { p.sourceContext = { sourceMode: 'drive' }; return p; },
    applyArgosInventoryTransactionEmailRecipients: async p => p,
    buildArgosInventoryTransactionPayload: () => payload('legacy'),
    postArgosInventoryTransactionPayload: async p => { calls.push(structuredClone(p)); if (failCreate) throw new Error('mock create failure'); return { ok: true, status: 'queued', jobId: 'job-1' }; },
    rememberQueuedReclassDelivery: (...args) => { context.receipt = args; },
    closeArgosInventoryTransactionModal: () => { context.closed = true; context.argosInventoryTransactionState = null; },
    showToast: () => {},
    pollReclassDeliveryJobs: async () => true,
    getFriendlyBackendErrorMessage: error => error.message,
    setArgosInventoryTransactionAction: () => {},
    getArgosInventoryTransactionRequestAction: () => '',
    getArgosInventoryTransactionRequestLabel: () => 'Reclass',
    isArgosInventoryTransactionRequestOnlyMode: () => false,
    getArgosInventoryTransactionActionLabel: () => 'Reclass',
    applyArgosInventoryTransactionReturnedRow: () => {},
    getCurrentVisibleViewId: () => 'request',
    queueInteractiveViewRender: () => {},
  });
  vm.runInContext([
    extract('getArgosInventoryTransactionPayloadForPendingMove'),
    extract('submitArgosInventoryTransaction'),
  ].join('\n'), context);
  return { dom, context, calls, state };
}

test('submit sends Suspend Tag master inquiry through protected workflow and closes on success', async () => {
  const h = submitHarness();
  await h.context.submitArgosInventoryTransaction();
  assert.equal(h.calls[0].source.unique_id, 'master-42');
  assert.equal(h.calls[0].sourceContext.sourceMode, 'drive');
  assert.equal(h.context.receipt[3], 'suspend-tag', 'delivery recovery retains the originating view');
  assert.equal(h.context.receipt[0].source.unique_id, 'master-42');
  assert.equal(h.context.closed, true);
  assert.equal(h.dom.window.document.getElementById('argos-inventory-transaction-apply').disabled, true, 'success keeps reference to the submit control after closing');
  h.dom.window.close();
});

test('failed protected submission preserves Suspend Tag draft and restores submit control', async () => {
  const h = submitHarness(true);
  await h.context.submitArgosInventoryTransaction();
  assert.equal(h.context.argosInventoryTransactionState, h.state);
  assert.equal(h.state.sourceView, 'suspend-tag');
  assert.equal(h.state.item.UNIQUE_ID, 'master-42');
  assert.equal(h.state.submitting, false);
  assert.equal(h.dom.window.document.getElementById('argos-inventory-transaction-apply').disabled, false);
  assert.equal(h.context.closed, undefined);
  h.dom.window.close();
});
