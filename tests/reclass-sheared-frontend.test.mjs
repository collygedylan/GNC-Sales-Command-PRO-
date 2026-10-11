import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function loadWorkflowPolicySelector() {
  const start = html.indexOf('function getArgosReclassActionWorkflowPolicyVersionV3(');
  const end = html.indexOf('\n        }', start) + '\n        }'.length;
  assert.ok(start > 0 && end > start);
  const context = {
    RECLASS_ACTION_WORKFLOW_V4_POLICY_VERSION: 'reclass-action-workflow-v4-split-moves-20261006',
    RECLASS_ACTION_WORKFLOW_V5_POLICY_VERSION: 'reclass-action-workflow-v5-sheared-20261008',
    RECLASS_ACTION_WORKFLOW_V6_POLICY_VERSION: 'reclass-action-workflow-v6-smart-shield-20261009',
    RECLASS_ACTION_WORKFLOW_V7_POLICY_VERSION: 'reclass-action-workflow-v7-editable-fields-20261009',
    RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'],
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}; this.selectPolicy = getArgosReclassActionWorkflowPolicyVersionV3;`, context);
  return context.selectPolicy;
}

test('Reclass policy defaults to V7 and preserves explicit legacy V4/V5 selection', () => {
  const selectPolicy = loadWorkflowPolicySelector();
  const empty = { requestActions: [], rowOverlays: [] };
  const priority = { requestActions: ['priority_change'], rowOverlays: [{ proposals: [{ action: 'priority_change' }] }] };
  const move = { requestActions: ['move_down'], rowOverlays: [{ proposals: [{ action: 'move_down' }] }] };
  const sheared = { requestActions: ['sheared'], rowOverlays: [{ proposals: [{ action: 'Sheared' }] }] };
  const hold = { requestActions: [], holdStopProposals: [{ action: 'hold', reason: 'safety' }], rowOverlays: [] };
  for (const draft of [empty, priority, move, sheared, hold]) {
    assert.equal(selectPolicy(draft), 'reclass-action-workflow-v7-editable-fields-20261009');
  }
  assert.equal(selectPolicy(empty, { allowLiveEdits: false }), 'reclass-action-workflow-v4-split-moves-20261006');
  assert.equal(selectPolicy(move, { allowLiveEdits: false }), 'reclass-action-workflow-v4-split-moves-20261006');
  assert.equal(selectPolicy(sheared, { allowLiveEdits: false }), 'reclass-action-workflow-v5-sheared-20261008');
  assert.equal(selectPolicy(priority, { allowLiveEdits: false }), 'reclass-action-workflow-v4-split-moves-20261006');
  assert.equal(selectPolicy(hold, { allowLiveEdits: false }), 'reclass-action-workflow-v4-split-moves-20261006');
  assert.match(html, /workflowPolicyVersion: getArgosReclassActionWorkflowPolicyVersionV3\(\{ rowOverlays, holdStopProposals \}, \{ allowLiveEdits: true \}\)/);
  assert.match(html, /workflowPolicyVersion: getArgosReclassActionWorkflowPolicyVersionV3\(draft, \{ allowLiveEdits: true \}\)/);
});

test('active Reclass picker describes priority and hold as live updates with queued inquiries', () => {
  const blockStart = html.indexOf('const ARGOS_INVENTORY_TRANSACTION_HOLD_ACTION_OPTIONS = Object.freeze([');
  const blockEnd = html.indexOf('\n        ]);', blockStart);
  assert.ok(blockStart > 0 && blockEnd > blockStart);
  const options = html.slice(blockStart, blockEnd);
  for (const action of ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship', 'priority_change']) {
    const option = options.match(new RegExp(`\\{ value: '${action}',[^\\n]+`));
    assert.ok(option, `picker option ${action} exists`);
    assert.match(option[0], /detail: 'Live update \+ queued inquiry'/);
    assert.doesNotMatch(option[0], /Email(?: report)? only/i);
  }
  assert.match(options, /\{ value: 'move_up', label: 'Move Up Request', detail: 'Email only' \}/);
  assert.match(options, /\{ value: 'move_down', label: 'Move Down Request', detail: 'Email only' \}/);
});

function loadDraftCollector(rowMap = {}) {
  const start = html.indexOf('function collectArgosReclassV3Draft()');
  const end = html.indexOf('function collectArgosReclassInquiryOverlays()', start);
  const guardStart = html.indexOf('function hasArgosReclassMoveUpProposal()');
  const guardEnd = html.indexOf('function cloneArgosReclassProposal(', guardStart);
  assert.ok(start > 0 && end > start);
  assert.ok(guardStart > 0 && guardEnd > guardStart);
  const entry = {
    unique_id: 'row-1',
    sourceRow: { ITEMCODE: 'A100' },
    values: { itemcode: 'A100', lotcode: '27.F1', locationcode: 'A.01.001', ptronhand: '10', desigitem: 'Original designation', priority: '3', holdstopcode: 'H', holdstopreason: 'legacy hold' },
  };
  const context = {
    argosInventoryTransactionState: { inquiryModel: { locationRows: [entry] }, sourceView: 'drive' },
    RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'],
    RECLASS_ACTION_WORKFLOW_V5_ORDER: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship', 'recount', 'priority_change', 'move_up', 'move_down', 'sheared'],
    getArgosReclassV3HoldProposal: () => rowMap.__hold || null,
    getArgosReclassScopeSettings: () => ({ season: '', salesYear: null }),
    getReclassActionWorkflowV2Config: action => ({ kind: ['hold', 'stop_ship'].includes(action) ? 'hold_on' : 'hold_off', label: action }),
    getArgosReclassRowProposalMap: () => rowMap,
    getArgosReclassV3Proposal: (_uid, action) => rowMap[action] || null,
    getReclassActionWorkflowV5Config: (action) => ({
      hold: { kind: 'hold_on' }, take_off_hold: { kind: 'hold_off' }, stop_ship: { kind: 'hold_on' }, off_stop_ship: { kind: 'hold_off' },
      recount: { kind: 'recount' }, priority_change: { kind: 'priority' }, move_up: { kind: 'move', label: 'Move Up' }, move_down: { kind: 'move', label: 'Move Down' },
      sheared: { kind: 'sheared', label: 'Sheared' },
    }[action]),
    collectArgosReclassMoveProposal: (proposal, _entry, _rule, allowHold = true) => ({
      action: proposal.action,
      splits: proposal.splits.map((split) => ({ quantity: Number(split.quantity), destinationSeason: split.destinationSeason })),
      applyHold: allowHold && proposal.applyHold === true,
      holdReason: allowHold && proposal.applyHold === true ? proposal.holdReason : '',
    }),
    getArgosReclassTemporaryOverlay: () => null,
    collectArgosReclassInventoryFieldEdits: () => [],
    getItemInquiryItemCode: (source) => source.ITEMCODE,
    getEvalWorkInquiryRowResolution: () => '',
    window: { GncDatabase: { reclassShearedProposal: value => value } },
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(guardStart, guardEnd)}; ${html.slice(start, end)}; this.collect = collectArgosReclassV3Draft;`, context);
  return context.collect;
}

function loadRecipientDirectoryRefresh({ requestAllowed = true, bloomAllowed = true, initial = {} } = {}) {
  const start = html.indexOf('async function refreshRequestRecipientDirectory(');
  const end = html.indexOf('function retryRequestRecipientDirectory(', start);
  assert.ok(start > 0 && end > start);
  const calls = [];
  const applied = [];
  let owner = 'profile:user-1';
  let response;
  const context = {
    APP_API_FUNCTION_URL: '/app-api',
    nativeAuthProfile: { id: 'user-1' },
    currentUser: 'dylan_collyge',
    currentUserDisplay: 'Dylan',
    appEmailRecipientDirectoryRevision: initial.revision || '',
    appEmailRecipientDirectoryOwner: initial.owner || '',
    appEmailRecipientDirectoryLoaded: initial.loaded === true,
    appEmailRecipientDirectoryPromise: null,
    appEmailRecipientDirectoryError: '',
    appEmailRecipientDirectoryGeneration: 0,
    appEmailRecipientUsers: initial.users || [],
    requestQtyEmailStepActive: initial.requestStepActive === true,
    tempRequestEmailChainSelectedEmails: new Set(initial.selectedEmails || []),
    tempRequestEmailChainRecipientByEmail: new Map((initial.users || []).map(user => [user.email, { name: user.display, email: user.email, group: 'APP' }])),
    postAppFunctionJson: (...args) => { calls.push(args); return response; },
    window: { GncDatabase: { requestRecipientDirectoryFromResult: value => value } },
    getRequestRecipientDirectoryOwnerKey: () => owner,
    hasCurrentRequestRecipientDirectory: () => context.appEmailRecipientDirectoryLoaded && context.appEmailRecipientDirectoryOwner === owner,
    canUseRequestEmailChainPicker: () => requestAllowed,
    canUseBloomCropUpdateEmail: () => bloomAllowed,
    resolveRequestRecipientEmail: username => `${username}@greenleafnursery.com`,
    normalizeRequestEmailAddress: email => String(email || '').trim().toLowerCase(),
    getRequestEmailChainAllRecipients: () => [
      ...context.appEmailRecipientUsers.map(user => ({ email: user.email, group: 'APP' })),
      ...(initial.otherRecipients || []),
    ],
    applyAppEmailRecipientUsersToRepGroups: (entries, source) => {
      applied.push({ entries, source });
      context.appEmailRecipientUsers = entries.map(entry => ({ username: entry.username, display: entry.displayName, email: entry.email, role: entry.role }));
      return context.appEmailRecipientUsers;
    },
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}; this.refresh = refreshRequestRecipientDirectory;`, context);
  return {
    context,
    calls,
    applied,
    setOwner(value) { owner = value; },
    setResponse(value) { response = Promise.resolve(value); },
    setDeferredResponse() {
      let resolve;
      response = new Promise(done => { resolve = done; });
      return resolve;
    },
  };
}

test('V5 sheared action uses the typed proposal and preserves the expected original designation', () => {
  const collect = loadDraftCollector({ sheared: { action: 'sheared', quantity: '4' } });
  const draft = collect();
  assert.deepEqual(JSON.parse(JSON.stringify(draft.requestActions)), ['sheared']);
  assert.deepEqual(JSON.parse(JSON.stringify(draft.rowOverlays[0].expected)), {
    itemcode: 'A100', lotcode: '27.F1', locationcode: 'A.01.001', ptronhand: '10', desigitem: 'Original designation',
  });
  assert.equal(loadWorkflowPolicySelector()(draft), 'reclass-action-workflow-v7-editable-fields-20261009');
  assert.equal(loadWorkflowPolicySelector()(draft, { allowLiveEdits: false }), 'reclass-action-workflow-v5-sheared-20261008');
  assert.deepEqual(JSON.parse(JSON.stringify(draft.rowOverlays[0].proposals)), [{ action: 'sheared', quantity: 4 }]);
  assert.equal(JSON.stringify(draft).includes('desigitem'), true);
  assert.match(html, /window\.GncDatabase\.reclassShearedProposal\(\{ action: 'sheared', quantity \}\)/);
  assert.match(html, /data-sheared-request-preview="true"/);
  assert.match(html, /\$\{value\.trim\(\)\}-->#/);
  assert.match(html, /RECLASS_ACTION_WORKFLOW_V5_POLICY_VERSION/);
});

test('V6 live proposals freeze the original priority and hold values in each row snapshot', () => {
  const priorityDraft = loadDraftCollector({ priority_change: { action: 'priority_change', priority: '2' } })();
  assert.equal(loadWorkflowPolicySelector()(priorityDraft), 'reclass-action-workflow-v7-editable-fields-20261009');
  assert.equal(loadWorkflowPolicySelector()(priorityDraft, { allowLiveEdits: false }), 'reclass-action-workflow-v4-split-moves-20261006');
  assert.deepEqual(JSON.parse(JSON.stringify(priorityDraft.rowOverlays[0].expected)), {
    itemcode: 'A100', lotcode: '27.F1', locationcode: 'A.01.001', ptronhand: '10',
    priority: '3', holdstopcode: 'H', holdstopreason: 'legacy hold',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(priorityDraft.rowOverlays[0].proposals)), [{ action: 'priority_change', priority: '2' }]);
  assert.match(html, /workflowPolicyVersion: getArgosReclassActionWorkflowPolicyVersionV3\(draft, \{ allowLiveEdits: true \}\)/);
  assert.match(html, /RECLASS_ACTION_WORKFLOW_V6_POLICY_VERSION/);
});

test('V5 sheared quantity validates whole numbers, original OH, and combined movement limits', () => {
  for (const quantity of ['', '0', '-2', '1.5', '11', 'Infinity']) {
    assert.throws(() => loadDraftCollector({ sheared: { action: 'sheared', quantity } })(), /Sheared Qty must be a whole number/);
  }
  assert.throws(() => loadDraftCollector({
    sheared: { action: 'sheared', quantity: '4' },
    move_up: { action: 'move_up', splits: [{ quantity: '7', destinationSeason: 'S1' }] },
  })(), /Combined Move Up, Move Down, and Sheared quantities cannot exceed original OH/);
});

function loadMoveUpHoldGuard(rows = []) {
  const start = html.indexOf('function hasArgosReclassMoveUpProposal()');
  const end = html.indexOf('function cloneArgosReclassProposal(', start);
  assert.ok(start > 0 && end > start);
  const rowMaps = new Map(rows.map(row => [row.unique_id, row.proposals || {}]));
  const context = {
    argosInventoryTransactionState: { inquiryModel: { locationRows: rows.map(({ unique_id }) => ({ unique_id })) } },
    argosReclassMultiActionState: { holdStopProposals: { hold: { action: 'hold', reason: 'draft' } } },
    RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'],
    getArgosReclassV3Proposal: (uid, action) => rowMaps.get(uid)?.[action] || null,
    getArgosReclassRowProposalMap: uid => rowMaps.get(uid) || {},
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}; this.hasMoveUp = hasArgosReclassMoveUpProposal; this.clearHold = clearArgosReclassHoldDraftForMoveUp;`, context);
  return { context, rowMaps };
}

test('Move Up clears global and split-move hold drafts without touching saved inventory values', () => {
  const fixture = loadMoveUpHoldGuard([
    { unique_id: 'up', proposals: { move_up: { action: 'move_up' } } },
    { unique_id: 'down', proposals: { move_down: { action: 'move_down', applyHold: true, holdReason: 'draft reason' } } },
  ]);
  assert.equal(fixture.context.hasMoveUp(), true);
  fixture.context.clearHold();
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.context.argosReclassMultiActionState.holdStopProposals)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.rowMaps.get('up').move_up)), { action: 'move_up', applyHold: false, holdReason: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.rowMaps.get('down').move_down)), { action: 'move_down', applyHold: false, holdReason: '' });
  assert.equal(fixture.context.hasMoveUp(), true);
});

test('Move Up hold controls are unavailable while priority proposals remain available', () => {
  assert.match(html, /const disabledByMoveUp = moveUpSelected && RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS\.includes\(action\)/);
  assert.match(html, /const holdControlsEnabled = !hasArgosReclassMoveUpProposal\(\)/);
  assert.match(html, /Move Up before adding a Hold\/Stop draft/);
  assert.match(html, /collectArgosReclassMoveProposal\(proposal, entry, rule, !hasArgosReclassMoveUpProposal\(\)\)/);
  assert.doesNotMatch(html, /if \(normalized === 'move_up'\) clearArgosReclassHoldDraftForMoveUp\(\);[\s\S]{0,180}values\.priority/);
});

test('Move Up collection omits hold drafts but keeps priority and movement inquiry proposals', () => {
  const collect = loadDraftCollector({
    __hold: { action: 'hold', reason: 'draft reason' },
    priority_change: { action: 'priority_change', priority: '2' },
    move_up: { action: 'move_up', splits: [{ quantity: '3', destinationSeason: 'S1' }], applyHold: true, holdReason: 'stale draft' },
  });
  const draft = collect();
  assert.deepEqual(JSON.parse(JSON.stringify(draft.requestActions)), ['priority_change', 'move_up']);
  assert.deepEqual(JSON.parse(JSON.stringify(draft.holdStopProposals)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(draft.rowOverlays[0].proposals)), [
    { action: 'priority_change', priority: '2' },
    { action: 'move_up', splits: [{ quantity: 3, destinationSeason: 'S1' }], applyHold: false, holdReason: '' },
  ]);
});

test('Move Down can retain a hold draft when Move Up is absent', () => {
  const collect = loadDraftCollector({
    move_down: { action: 'move_down', splits: [{ quantity: '3', destinationSeason: 'S1' }], applyHold: true, holdReason: 'keep plants safe' },
  });
  const draft = collect();
  assert.deepEqual(JSON.parse(JSON.stringify(draft.rowOverlays[0].proposals)), [
    { action: 'move_down', splits: [{ quantity: 3, destinationSeason: 'S1' }], applyHold: true, holdReason: 'keep plants safe' },
  ]);
});

test('a future source hold stays a V7 selected-row proposal without client fanout settings', () => {
  const draft = loadDraftCollector({ __hold: { action: 'hold', reason: 'future stock', sourceUid: 'row-1' } })();
  assert.deepEqual(JSON.parse(JSON.stringify(draft.requestActions)), ['hold']);
  assert.deepEqual(JSON.parse(JSON.stringify(draft.holdStopProposals)), [{ action: 'hold', reason: 'future stock', sourceUid: 'row-1' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(draft.scope)), {});
  assert.deepEqual(JSON.parse(JSON.stringify(draft.rowOverlays[0].expected)), {
    itemcode: 'A100', lotcode: '27.F1', locationcode: 'A.01.001', ptronhand: '10',
    priority: '3', holdstopcode: 'H', holdstopreason: 'legacy hold',
  });
  assert.match(html, /getArgosReclassActionWorkflowPolicyVersionV3\(draft, \{ allowLiveEdits: true \}\)/);
  assert.match(html, /getArgosReclassActionWorkflowPolicyVersionV3\(\{ rowOverlays, holdStopProposals \}, \{ allowLiveEdits: true \}\)/);
});

test('a selected future row can start a hold draft without current-season settings', () => {
  const start = html.indexOf('function toggleArgosReclassV3Action(');
  const end = html.indexOf('function handleArgosReclassV3ProposalInput(', start);
  assert.ok(start > 0 && end > start);
  const entry = { unique_id: 'future-1', values: { ptronhand: '0', season: 'U2' } };
  const rowMap = new Map();
  const context = {
    argosInventoryTransactionState: { inquiryModel: { locationRows: [entry] }, sourceView: 'eval-work' },
    argosReclassMultiActionState: { holdStopProposals: {}, rowResolutions: new Map(), rowProposals: new Map() },
    RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'],
    getArgosReclassRowEditorEntry: uid => uid === entry.unique_id ? entry : null,
    getArgosReclassRowProposalMap: (uid, create = false) => {
      if (!rowMap.has(uid) && create) rowMap.set(uid, {});
      return rowMap.get(uid) || null;
    },
    getArgosReclassV3Proposal: () => null,
    getArgosReclassV3HoldProposal: () => null,
    getArgosReclassScopeSettings: () => ({ season: '', salesYear: null }),
    getReclassActionWorkflowV5Config: action => ({ kind: action === 'hold' || action === 'stop_ship' ? 'hold_on' : 'hold_off', label: action }),
    getReclassActionWorkflowV2Config: action => ({ kind: action === 'hold' || action === 'stop_ship' ? 'hold_on' : 'hold_off', label: action }),
    hasArgosReclassMoveUpProposal: () => false,
    generateArgosInventoryTransactionId: () => 'next-token',
    refreshArgosReclassMultiActionUi() {}, captureEvalWorkLocalDraftSoon() {}, showToast() {},
    window: { confirm: () => true },
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}; this.toggle = toggleArgosReclassV3Action;`, context);
  context.toggle(null, 'hold', entry.unique_id);
  assert.deepEqual(JSON.parse(JSON.stringify(context.argosReclassMultiActionState.holdStopProposals)), {
    hold: { action: 'hold', reason: '', sourceUid: 'future-1' },
  });
});

test('recipient directory refresh is a no-parameter authenticated request and deduplicates concurrent picker opens', async () => {
  const fixture = loadRecipientDirectoryRefresh();
  const resolve = fixture.setDeferredResponse();
  const first = fixture.context.refresh('request');
  const second = fixture.context.refresh('request');
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls[0][1])), { action: 'request_recipient_directory' });
  resolve({ ok: true, revision: `recipients-v1:${'a'.repeat(64)}`, users: [{ username: 'alyssa_beitz', displayName: 'Alyssa Beitz', role: 'CSR' }] });
  await Promise.all([first, second]);
  assert.equal(fixture.applied.length, 1);
  assert.equal(fixture.applied[0].source, 'directory');
  assert.equal(fixture.applied[0].entries[0].email, 'alyssa_beitz@greenleafnursery.com');
});

test('recipient directory only replaces the cache when its revision changes', async () => {
  const revision = `recipients-v1:${'b'.repeat(64)}`;
  const fixture = loadRecipientDirectoryRefresh({ initial: {
    loaded: true, owner: 'profile:user-1', revision,
    users: [{ username: 'prior', display: 'Prior', email: 'prior@greenleafnursery.com' }],
  } });
  fixture.setResponse({ ok: true, revision, users: [{ username: 'new_user', displayName: 'New User', role: 'User' }] });
  await fixture.context.refresh('request');
  assert.equal(fixture.calls.length, 1, 'each picker opening revalidates the server revision');
  assert.equal(fixture.applied.length, 0, 'same revision leaves the rendered recipients and selection state intact');
  assert.equal(fixture.context.appEmailRecipientUsers[0].username, 'prior');
});

test('recipient revision removes selected inactive APP users but preserves addresses still present in another group', async () => {
  const removed = { username: 'removed_user', display: 'Removed User', email: 'removed_user@greenleafnursery.com' };
  const retained = { username: 'retained_user', display: 'Retained User', email: 'retained_user@greenleafnursery.com' };
  const fixture = loadRecipientDirectoryRefresh({ initial: {
    loaded: true, owner: 'profile:user-1', revision: `recipients-v1:${'d'.repeat(64)}`, requestStepActive: true,
    users: [removed, retained], selectedEmails: [removed.email, retained.email],
    otherRecipients: [{ email: removed.email, group: 'ADMIN' }],
  } });
  fixture.setResponse({ ok: true, revision: `recipients-v1:${'e'.repeat(64)}`, users: [{ username: retained.username, displayName: retained.display, role: 'APP' }] });
  await fixture.context.refresh('request');
  assert.deepEqual([...fixture.context.tempRequestEmailChainSelectedEmails], [removed.email, retained.email]);

  const removedFromAllGroups = loadRecipientDirectoryRefresh({ initial: {
    loaded: true, owner: 'profile:user-1', revision: `recipients-v1:${'f'.repeat(64)}`, requestStepActive: true,
    users: [removed], selectedEmails: [removed.email],
  } });
  removedFromAllGroups.setResponse({ ok: true, revision: `recipients-v1:${'1'.repeat(64)}`, users: [] });
  await removedFromAllGroups.context.refresh('request');
  assert.deepEqual([...removedFromAllGroups.context.tempRequestEmailChainSelectedEmails], []);
  assert.equal(removedFromAllGroups.context.tempRequestEmailChainRecipientByEmail.has(removed.email), false);
});

test('recipient directory refuses unauthorized fetches and ignores responses after the signed-in identity changes', async () => {
  const denied = loadRecipientDirectoryRefresh({ requestAllowed: false });
  await assert.rejects(() => denied.context.refresh('request'), /unavailable for this account/);
  assert.equal(denied.calls.length, 0);

  const changed = loadRecipientDirectoryRefresh();
  const resolve = changed.setDeferredResponse();
  const pending = changed.context.refresh('request');
  changed.setOwner('profile:user-2');
  resolve({ ok: true, revision: `recipients-v1:${'c'.repeat(64)}`, users: [{ username: 'other', displayName: 'Other User', role: 'User' }] });
  await assert.rejects(() => pending, /Retry loading recipients/);
  assert.equal(changed.applied.length, 0);
});

test('legacy users cache cannot overwrite a current authoritative directory', () => {
  const start = html.indexOf('function applyAppEmailRecipientUsersToRepGroups(');
  const end = html.indexOf('function getRequestRecipientDirectoryStatusText(', start);
  const source = html.slice(start, end);
  assert.match(source, /source !== 'directory' && sameOwnerDirectory && !force/);
  assert.match(html, /appEmailRecipientDirectoryOwner !== getRequestRecipientDirectoryOwnerKey\(\)\) resetRequestRecipientDirectoryCache/);
  assert.match(html, /resetRequestRecipientDirectoryCache\(\);\s*invalidateNativeAuthRecovery/);
});
