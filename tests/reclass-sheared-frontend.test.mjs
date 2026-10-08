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
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}; this.selectPolicy = getArgosReclassActionWorkflowPolicyVersionV3;`, context);
  return context.selectPolicy;
}

test('Eval Work and Drive select V5 only when a row actually carries a shear proposal', () => {
  const selectPolicy = loadWorkflowPolicySelector();
  assert.equal(selectPolicy({ requestActions: [], rowOverlays: [] }), 'reclass-action-workflow-v4-split-moves-20261006');
  assert.equal(selectPolicy({ requestActions: ['priority_change'], rowOverlays: [{ proposals: [{ action: 'priority_change' }] }] }), 'reclass-action-workflow-v4-split-moves-20261006');
  assert.equal(selectPolicy({ requestActions: ['sheared'], rowOverlays: [{ proposals: [{ action: 'Sheared' }] }] }), 'reclass-action-workflow-v5-sheared-20261008');
  assert.match(html, /workflowPolicyVersion: getArgosReclassActionWorkflowPolicyVersionV3\(\{ rowOverlays \}\)/);
  assert.match(html, /workflowPolicyVersion: getArgosReclassActionWorkflowPolicyVersionV3\(draft\)/);
});

function loadDraftCollector(rowMap = {}) {
  const start = html.indexOf('function collectArgosReclassV3Draft()');
  const end = html.indexOf('function collectArgosReclassInquiryOverlays()', start);
  assert.ok(start > 0 && end > start);
  const entry = {
    unique_id: 'row-1',
    sourceRow: { ITEMCODE: 'A100' },
    values: { itemcode: 'A100', lotcode: '27.F1', locationcode: 'A.01.001', ptronhand: '10', desigitem: 'Original designation' },
  };
  const context = {
    argosInventoryTransactionState: { inquiryModel: { locationRows: [entry] }, sourceView: 'drive' },
    RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'],
    RECLASS_ACTION_WORKFLOW_V5_ORDER: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship', 'recount', 'priority_change', 'move_up', 'move_down', 'sheared'],
    getArgosReclassV3HoldProposal: () => null,
    getArgosReclassScopeSettings: () => ({ season: '', salesYear: null }),
    getArgosReclassRowProposalMap: () => rowMap,
    getReclassActionWorkflowV5Config: (action) => ({
      hold: { kind: 'hold_on' }, take_off_hold: { kind: 'hold_off' }, stop_ship: { kind: 'hold_on' }, off_stop_ship: { kind: 'hold_off' },
      recount: { kind: 'recount' }, priority_change: { kind: 'priority' }, move_up: { kind: 'move', label: 'Move Up' }, move_down: { kind: 'move', label: 'Move Down' },
      sheared: { kind: 'sheared', label: 'Sheared' },
    }[action]),
    collectArgosReclassMoveProposal: (proposal) => ({ action: proposal.action, splits: proposal.splits.map((split) => ({ quantity: Number(split.quantity), destinationSeason: split.destinationSeason })) }),
    getArgosReclassTemporaryOverlay: () => null,
    getItemInquiryItemCode: (source) => source.ITEMCODE,
    getEvalWorkInquiryRowResolution: () => '',
    window: { GncDatabase: { reclassShearedProposal: value => value } },
  };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}; this.collect = collectArgosReclassV3Draft;`, context);
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
  assert.deepEqual(JSON.parse(JSON.stringify(draft.rowOverlays[0].proposals)), [{ action: 'sheared', quantity: 4 }]);
  assert.equal(JSON.stringify(draft).includes('desigitem'), true);
  assert.match(html, /window\.GncDatabase\.reclassShearedProposal\(\{ action: 'sheared', quantity \}\)/);
  assert.match(html, /data-sheared-request-preview="true"/);
  assert.match(html, /\$\{value\.trim\(\)\}-->#/);
  assert.match(html, /RECLASS_ACTION_WORKFLOW_V5_POLICY_VERSION/);
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
