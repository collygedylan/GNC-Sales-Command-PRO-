import { expect } from '@playwright/test';
import { driveEvidenceColumns } from '../../services/driveEvidence.ts';
import { inquiryEditableFields } from '../../services/reclassEditableFields.ts';
import { normalizeReclassMoveCommand } from '../../services/reclassMove.ts';
import { inventoryReadFixture } from '../fixtures/inventory-list-read-fixture.mjs';

const RESPONSE_TIME = '2026-10-20T20:00:00.000Z';

const INSTALL_SUBMIT_TIMING = `(() => {
  const target = window;
  const timing = { startedAt: null, feedbackMs: null, hiddenMs: null, submitMs: null, settledMs: null, requests: [] };
  target.__releaseSmokeSubmitTiming = timing;
  const modal = document.getElementById('argos-inventory-transaction-modal');
  const button = document.getElementById('argos-inventory-transaction-apply');
  button.addEventListener('click', () => { timing.startedAt = performance.now(); }, { capture: true, once: true });
  const observer = new MutationObserver(() => {
    if (timing.startedAt === null) return;
    if (button.disabled && timing.feedbackMs === null) timing.feedbackMs = performance.now() - timing.startedAt;
    if (modal.classList.contains('hidden') && timing.hiddenMs === null) {
      timing.hiddenMs = performance.now() - timing.startedAt;
      timing.submitMs = Math.max(timing.feedbackMs || 0, timing.hiddenMs);
      observer.disconnect();
      requestAnimationFrame(() => requestAnimationFrame(() => { timing.settledMs = performance.now() - timing.startedAt; }));
    }
  });
  observer.observe(modal, { attributes: true, subtree: true, attributeFilter: ['class', 'disabled'] });
  const fetch = window.fetch.bind(window);
  window.fetch = ((input, init) => {
    let body = {};
    try { if (typeof init?.body === 'string') body = JSON.parse(init.body); } catch (_) {}
    if (timing.startedAt === null || !['inventory_reclass_move', 'drive_reclass_inquiry'].includes(String(body.action))) return fetch(input, init);
    const phase = { action: String(body.action), operation: String(body.operation || 'submit'),
      startedMs: performance.now() - timing.startedAt };
    timing.requests.push(phase);
    return fetch(input, init).then(response => {
      phase.responseMs = performance.now() - timing.startedAt; phase.status = response.status; return response;
    }, error => { phase.error = String(error?.message || error); throw error; });
  });
})()`;

function createReclassState(snapshot, details, fixtureUsername) {
  const source = snapshot.masterRows.find(row => String(row.UNIQUE_ID ?? row.unique_id) === details.uid);
  expect(source).toBeTruthy();
  const state = { snapshot, details, fixtureUsername, responseTime: RESPONSE_TIME,
    authoritative: inventoryReadFixture.fromFixtureShape(source), requests: [], exactHydrationRequests: 0 };
  state.hydrationGate = new Promise(resolve => { state.releaseHydration = resolve; });
  return state;
}

function fulfillJson(route, data) {
  return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*',
    'access-control-allow-headers': '*', 'content-type': 'application/json' }, body: JSON.stringify(data) });
}

function isExactHydrationRequest(body, params, state) {
  return body.action === 'inventory_read' && body.operation === 'master_page'
    && params?.dataset === 'lookup' && params.projection === 'full'
    && params.itemCode === state.authoritative.itemcode;
}

async function fulfillExactHydration(route, params, state) {
  expect(Object.keys(params).sort()).toEqual(['dataset', 'itemCode', 'limit', 'offset', 'projection']);
  expect(params.limit).toBe(1000);
  state.exactHydrationRequests += 1;
  await state.hydrationGate;
  const rows = state.snapshot.masterRows
    .filter(row => String(row.ITEMCODE ?? row.itemcode) === params.itemCode)
    .map(row => inventoryReadFixture.fromFixtureShape(row));
  return fulfillJson(route, { ok: true, data: inventoryReadFixture.readMasterPage(rows, params) });
}

function fulfillReclassMove(route, body, state) {
  const { receiptEncoding: ignoredReceiptEncoding, reclassExplanations, ...input } = body;
  void ignoredReceiptEncoding;
  const command = normalizeReclassMoveCommand(input);
  expect(reclassExplanations).toEqual({ [state.details.uid]: '' });
  expect(command.expectedRevision).toBeNull();
  expect(command.moves).toHaveLength(1);
  expect(command.moves[0].source.uniqueId).toBe(state.details.uid);
  expect(command.moves[0].lines).toEqual([{ direction: 'move_up', destinationSeason: 'U1', quantity: 1 }]);
  for (const [field, value] of Object.entries(command.moves[0].source.identity)) {
    expect(state.authoritative[field] ?? null).toBe(value);
  }
  state.authoritative = { ...state.authoritative,
    ptronhand: String(Number(state.authoritative.ptronhand) - 1),
    ptravailable: String(Number(state.authoritative.ptravailable) - 1), last_updated: state.responseTime };
  const target = { ...state.authoritative, unique_id: 'synthetic-reclass-target', season: 'U1',
    lotcode: String(state.authoritative.lotcode).replace(/[^.]+$/, 'U1'), ptronhand: '1', ptravailable: '1' };
  return fulfillJson(route, { ok: true, data: { ok: true, commandId: command.commandId,
    requestId: 'synthetic-reclass-move', revision: '8278', status: 'applied', importStatus: 'pending',
    rows: [state.authoritative, target].map(row => ({ table: 'ph_master_inventory', row })),
    movements: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 1,
      sourceUniqueId: state.details.uid, destinationUniqueId: target.unique_id }] } });
}

function fulfillReclassInquiry(route, body, state) {
  expect(body.operation).toBe('create');
  expect(body.transaction.holdStopProposals).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'hold', reason: 'synthetic stock check' }),
  ]));
  const edits = body.rowOverlays.find(row => row.unique_id === state.details.uid).fieldEdits;
  expect(edits).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: 'locationnote', value: 'Synthetic location draft' }),
    expect.objectContaining({ field: 'salesnote', value: 'Synthetic sales draft' }),
  ]));
  const before = Object.fromEntries(inquiryEditableFields.map(field => [field, state.authoritative[field] ?? null]));
  for (const edit of edits) state.authoritative[edit.field] = edit.value;
  Object.assign(state.authoritative, { holdstopcode: 'H', holdstopreason: 'synthetic stock check',
    last_updated: state.responseTime, av_rule_last_clear_reason: 'hold_requested',
    av_rule_last_cleared_at: state.responseTime });
  const evidence = Object.fromEntries(driveEvidenceColumns.map(field => [field, state.authoritative[field] ?? null]));
  const after = Object.fromEntries(inquiryEditableFields.map(field => [field, state.authoritative[field] ?? null]));
  return fulfillJson(route, { ok: true, status: 'queued', jobId: 'synthetic-reclass-queued',
    workflowPolicyVersion: body.workflowPolicyVersion, inventoryRevision: '8279',
    liveEdits: [{ unique_id: state.details.uid, priority: state.authoritative.priority ?? null,
      holdstopcode: 'H', holdstopreason: 'synthetic stock check', av_rule_last_clear_reason: 'hold_requested',
      av_rule_last_cleared_at: state.responseTime, last_updated: state.responseTime, evidence }],
    inventoryFields: [{ unique_id: state.details.uid, before, after,
      changedFields: edits.map(edit => edit.field), stamps: { prisetby: state.fixtureUsername,
        priupdated: state.responseTime, locationnotedate: state.responseTime, evaldate: state.responseTime } }] });
}

async function installReclassRoute(page, state) {
  await page.route('**/functions/v1/app-api', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const body = request.postDataJSON();
    const params = body.params;
    if (isExactHydrationRequest(body, params, state)) return fulfillExactHydration(route, params, state);
    if (!['inventory_reclass_move', 'drive_reclass_inquiry'].includes(String(body.action))) return route.fallback();
    expect(request.headers()['authorization']).toBe('Bearer browser-only-no-real-session');
    if (body.action === 'drive_reclass_inquiry' && body.operation === 'status') {
      expect(Object.keys(body).sort()).toEqual(['action', 'idempotencyToken', 'operation']);
      return fulfillJson(route, { ok: true, status: 'queued', jobId: 'synthetic-reclass-queued' });
    }
    state.requests.push(structuredClone(body));
    if (body.action === 'inventory_reclass_move') return fulfillReclassMove(route, body, state);
    return fulfillReclassInquiry(route, body, state);
  });
}

async function openReclassModal({ page, app, info, state }) {
  const open = await page.evaluate(async uid => window.eval(`(async () => {
    Object.assign(getDatasetState('master'), { fullLoaded: false, rowCompleteness: 'partial', liveVerifiedRevision: '' });
    productionLiveSyncVerifiedView = '';
    const started = performance.now();
    openArgosInventoryTransactionModal(${JSON.stringify(uid)}, 'reclass', 'drive');
    const immediate = !document.getElementById('argos-inventory-transaction-modal').classList.contains('hidden');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { immediate, openMs: performance.now() - started, username: currentUser };
  })()`), state.details.uid);
  await info.attach('release-smoke-reclass-open-phase', { contentType: 'application/json',
    body: Buffer.from(JSON.stringify({ project: info.project.name, username: state.fixtureUsername, ...open })) });
  expect(open).toMatchObject({ immediate: true, username: state.fixtureUsername });
  expect(open.openMs).toBeLessThanOrEqual(2000);
  const modal = page.locator('#argos-inventory-transaction-modal');
  const sourceCard = modal.locator(`[data-reclass-row-card="${state.details.uid}"]`);
  if (await sourceCard.getAttribute('data-reclass-row-expanded') !== 'true') {
    await app.activate(sourceCard.locator('.argos-reclass-row-toggle'));
  }
  await expect(page.locator('#argos-inventory-transaction-review')).toBeVisible();
  return { open, modal, sourceCard };
}

async function fillReclassDraft({ page, app, state, sourceCard }) {
  await app.activate(sourceCard.locator('[data-reclass-v3-action="move_up"]'));
  await sourceCard.getByLabel('Move Up quantity 1', { exact: true }).fill('1');
  await sourceCard.getByLabel('Move Up destination 1', { exact: true }).selectOption('U1');
  await app.activate(sourceCard.locator('[data-reclass-v3-action="hold"]'));
  await sourceCard.locator('[data-reclass-v3-proposal-action="hold"][data-reclass-v3-proposal-field="reason"]')
    .fill('synthetic stock check');
  const details = sourceCard.locator('[data-reclass-location-details]');
  if (!await details.evaluate(element => element.hasAttribute('open'))) {
    await app.activate(sourceCard.locator('[data-reclass-location-details] > summary'));
  }
  await sourceCard.locator('[data-reclass-temporary-field="locationnote"]').fill('Synthetic location draft');
  await sourceCard.locator('[data-reclass-temporary-field="salesnote"]').fill('Synthetic sales draft');
  await expect.poll(() => state.exactHydrationRequests).toBe(1);
  const hydrationResponse = page.waitForResponse(response => {
    if (response.request().method() !== 'POST') return false;
    const body = response.request().postDataJSON();
    return body?.action === 'inventory_read' && body.operation === 'master_page'
      && body.params?.itemCode === state.authoritative.itemcode && body.params?.dataset === 'lookup';
  });
  state.releaseHydration();
  await hydrationResponse;
  await app.activate(sourceCard.locator('[data-reclass-v3-action="move_up"]'));
  await expect(sourceCard.getByLabel('Move Up quantity 1', { exact: true })).toHaveValue('1');
  await expect(sourceCard.locator('[data-reclass-temporary-field="locationnote"]')).toHaveValue('Synthetic location draft');
  await expect(sourceCard.locator('[data-reclass-temporary-field="salesnote"]')).toHaveValue('Synthetic sales draft');
}

async function submitReclass({ page, app, info, state, modal }) {
  await page.evaluate(code => window.eval(code), INSTALL_SUBMIT_TIMING);
  const commandStarted = Date.now();
  let observationError = '';
  try {
    await app.activate(page.locator('#argos-inventory-transaction-apply'));
    await app.activate(page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }));
    await page.waitForFunction(() => window.__releaseSmokeSubmitTiming?.submitMs != null, null, { timeout: 15000 });
    await page.waitForFunction(() => window.__releaseSmokeSubmitTiming?.settledMs != null, null, { timeout: 15000 });
  } catch (error) { observationError = String(error); }
  const timing = await page.evaluate(() => window.__releaseSmokeSubmitTiming);
  await info.attach('release-smoke-reclass-submit-phases', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    project: info.project.name, username: state.fixtureUsername, commandWallMs: Date.now() - commandStarted,
    observationError, ...timing, commandBodies: state.requests, failedResources: app.failedResources,
  })) });
  expect(observationError).toBe('');
  expect(timing.startedAt).not.toBeNull();
  expect(timing.submitMs).not.toBeNull();
  const submitMs = Number(timing.submitMs);
  expect(submitMs).toBeLessThanOrEqual(2000);
  await expect(modal).toBeHidden();
  await expect.poll(() => state.requests.map(body => body.action), { timeout: 20_000 })
    .toEqual(['inventory_reclass_move', 'drive_reclass_inquiry']);
  return submitMs;
}

async function attachReclassEvidence({ info, state, open, submitMs }) {
  expect(state.authoritative).toMatchObject({ holdstopcode: 'H',
    locationnote: 'Synthetic location draft', salesnote: 'Synthetic sales draft' });
  await info.attach('release-smoke-reclass-evidence', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    profile: info.project.name, username: state.fixtureUsername, masterRows: state.snapshot.masterRows.length,
    cache: 'same-account partial cached rows with interrupted import and stale permissions',
    ...open, submitMs, simulatedAtomicMove: true, simulatedLiveFields: true,
    lateHydrationPreservedDraft: true, reportStatus: 'queued', productionWrites: false, realEmailsSent: false,
  })) });
}

export async function runPublishedReclassSmoke({ page, app, info, snapshot, fixtureUsername, details }) {
  const state = createReclassState(snapshot, details, fixtureUsername);
  await installReclassRoute(page, state);
  const { open, modal, sourceCard } = await openReclassModal({ page, app, info, state });
  await fillReclassDraft({ page, app, state, sourceCard });
  const submitMs = await submitReclass({ page, app, info, state, modal });
  await attachReclassEvidence({ info, state, open, submitMs });
}
