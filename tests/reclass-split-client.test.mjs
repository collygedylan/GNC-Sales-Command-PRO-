import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parseExpressionAt } from 'acorn';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function source(name) {
  let start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, name);
  if (html.slice(Math.max(0, start - 6), start) === 'async ') start -= 6;
  return html.slice(start, parseExpressionAt(html, start, { ecmaVersion: 'latest' }).end);
}
const functions = ['cloneArgosReclassProposal', 'getArgosReclassMoveBalance', 'getArgosReclassMoveBalanceText',
  'hasArgosReclassMoveUpProposal',
  'collectArgosReclassMoveProposal', 'collectArgosReclassV3Draft', 'changeArgosReclassMoveSplit',
  'markArgosReclassProposalEdited', 'buildArgosReclassV3ProposalHtml'];
function fixture() {
  const entry = { unique_id: 'r1', values: { ptronhand: '25', lotcode: '27.F1', locationcode: 'A.01', season: 'F1' }, sourceRow: { ITEMCODE: 'TEST' } };
  const rowMap = {};
  const ctx = {
    Map, Set, console,
    RECLASS_ACTION_WORKFLOW_V3_ORDER: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship', 'recount', 'priority_change', 'move_up', 'move_down'],
    RECLASS_ACTION_WORKFLOW_V5_ORDER: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship', 'recount', 'priority_change', 'move_up', 'move_down', 'sheared'],
    RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'],
    RECLASS_ACTION_WORKFLOW_V2_SEASONS: ['F1', 'S1', 'U1', 'U2', 'U3', 'X', 'Y', 'Z'],
    argosInventoryTransactionState: { sourceView: 'drive', idempotencyToken: 'original', inquiryModel: { locationRows: [entry] } },
    argosReclassMultiActionState: { rowResolutions: new Map([['r1', 'done']]) },
    getArgosReclassRowProposalMap: () => rowMap,
    getArgosReclassV3Proposal: (_, action) => rowMap[action],
    getArgosReclassV3HoldProposal: () => null,
    getReclassActionWorkflowV2Config: action => ({ kind: 'move', label: action === 'move_up' ? 'Move Up Request' : 'Move Down Request' }),
    getReclassActionWorkflowV5Config: action => ({ kind: action === 'sheared' ? 'sheared' : 'move', label: action === 'sheared' ? 'Sheared Request' : (action === 'move_up' ? 'Move Up Request' : 'Move Down Request') }),
    getArgosReclassRowCurrentSeason: row => row.values.season,
    getArgosReclassTemporaryOverlay: () => null,
    collectArgosReclassInventoryFieldEdits: () => [],
    getItemInquiryItemCode: row => row.ITEMCODE,
    captureEvalWorkLocalDraftSoon() {}, refreshArgosReclassMultiActionUi() {},
    generateArgosInventoryTransactionId: () => 'edited-token',
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  };
  vm.createContext(ctx);
  vm.runInContext(functions.map(source).join('\n'), ctx);
  const move = (splits = [{ quantity: '15', destinationSeason: 'X' }, { quantity: '5', destinationSeason: 'S1' }, { quantity: '5', destinationSeason: 'U1' }]) =>
    rowMap.move_up = { action: 'move_up', splits, applyHold: false, holdReason: '' };
  return { ctx, entry, rowMap, move };
}

test('collector preserves ordered repeated splits and exact OH without a hidden move hold', () => {
  const { ctx, entry, move } = fixture();
  const draft = move([{ quantity: '15', destinationSeason: 'X' }, { quantity: '5', destinationSeason: 'S1' }, { quantity: '5', destinationSeason: 'X' }]);
  draft.action = 'move_down';
  const rowMap = ctx.getArgosReclassRowProposalMap();
  delete rowMap.move_up;
  rowMap.move_down = draft;
  draft.applyHold = false; draft.holdReason = '';
  const before = plain(entry);
  const result = ctx.collectArgosReclassV3Draft();
  assert.deepEqual(plain(result.rowOverlays[0].proposals), [{ action: 'move_down', splits: [
    { quantity: 15, destinationSeason: 'X' }, { quantity: 5, destinationSeason: 'S1' }, { quantity: 5, destinationSeason: 'X' },
  ], applyHold: false, holdReason: '' }]);
  assert.deepEqual(plain(result.holdStopProposals), []);
  assert.deepEqual(plain(entry), before);
  assert.equal(ctx.getArgosReclassMoveBalance(entry).remaining, 0);
});

test('both move actions count toward one OH cap and failed collection retains edits', () => {
  const { ctx, entry, rowMap, move } = fixture(); move();
  rowMap.move_down = { action: 'move_down', splits: [{ quantity: 1, destinationSeason: 'Y' }], applyHold: false };
  const before = plain(rowMap);
  assert.throws(() => ctx.collectArgosReclassV3Draft(), /cannot exceed original OH/);
  assert.deepEqual(plain(rowMap), before);
  assert.equal(ctx.getArgosReclassMoveBalance(entry).remaining, -1);
  rowMap.move_up.splits[0].quantity = 14;
  assert.equal(ctx.collectArgosReclassV3Draft().rowOverlays[0].proposals.length, 2);
});

test('invalid split rows and retired saved hold controls block submission without discarding input', () => {
  for (const split of [{ quantity: '', destinationSeason: 'X' }, { quantity: 0, destinationSeason: 'X' },
    { quantity: -1, destinationSeason: 'X' }, { quantity: 1.5, destinationSeason: 'X' },
    { quantity: 2, destinationSeason: '' }, { quantity: 2, destinationSeason: 'F1' }, { quantity: 2, destinationSeason: 'Q1' }]) {
    const { ctx, move, rowMap } = fixture(); move([split]); const before = plain(rowMap);
    assert.throws(() => ctx.collectArgosReclassV3Draft()); assert.deepEqual(plain(rowMap), before);
  }
  const { ctx, move } = fixture(); const proposal = move(); proposal.action = 'move_down';
  const rowMap = ctx.getArgosReclassRowProposalMap(); delete rowMap.move_up; rowMap.move_down = proposal;
  proposal.applyHold = true;
  assert.throws(() => ctx.collectArgosReclassV3Draft(), /retired Hold option/);
  proposal.holdReason = 'x'.repeat(1001);
  assert.throws(() => ctx.collectArgosReclassV3Draft(), /retired Hold option/);
  proposal.applyHold = false;
  assert.equal(ctx.collectArgosReclassV3Draft().rowOverlays[0].proposals[0].holdReason, '');
  assert.equal(proposal.holdReason.length, 1001, 'unchecked reason remains available in the editable draft');
});

test('legacy adaptation and draft snapshots own their nested split arrays', () => {
  const { ctx } = fixture();
  const legacy = { action: 'move_down', moveQuantity: 5, destinationSeason: 'X' };
  assert.deepEqual(plain(ctx.cloneArgosReclassProposal(legacy)), { action: 'move_down', splits: [{ quantity: 5, destinationSeason: 'X' }], applyHold: false, holdReason: '' });
  const saved = { action: 'move_up', splits: [{ quantity: '', destinationSeason: '' }], applyHold: true, holdReason: 'draft' };
  const copy = ctx.cloneArgosReclassProposal(saved); copy.splits[0].quantity = 12;
  assert.equal(saved.splits[0].quantity, '');
  for (const name of ['buildEvalWorkLocalInquirySnapshot', 'hydrateEvalWorkReclassState', 'reopenReclassDeliveryJob']) assert.match(source(name), /cloneArgosReclassProposal/);
});

test('add/remove split edits invalidate a completed resolution and submission identity', () => {
  const { ctx, rowMap, move } = fixture(); move([{ quantity: 15, destinationSeason: 'X' }]);
  const button = { closest: () => ({ getAttribute: () => 'r1', querySelector: () => ({ focus() {} }) }) };
  ctx.changeArgosReclassMoveSplit(button, 'move_up');
  assert.equal(rowMap.move_up.splits.length, 2);
  assert.equal(rowMap.move_up.splits[1].quantity, '');
  assert.equal(ctx.argosReclassMultiActionState.rowResolutions.has('r1'), false);
  assert.equal(ctx.argosInventoryTransactionState.idempotencyToken, 'edited-token');
  ctx.changeArgosReclassMoveSplit(button, 'move_up', 0);
  assert.equal(rowMap.move_up.splits.length, 1);
  ctx.changeArgosReclassMoveSplit(button, 'move_up', 0);
  assert.equal(rowMap.move_up.splits.length, 1, 'last row remains editable');
});

test('move renderer retains accessible split controls and directs holds to the main action grid', () => {
  const { ctx, entry, move } = fixture(); const proposal = move(); proposal.action = 'move_down';
  const rowMap = ctx.getArgosReclassRowProposalMap(); delete rowMap.move_up; rowMap.move_down = proposal;
  proposal.applyHold = true; proposal.holdReason = '<script>bad</script>';
  const output = ctx.buildArgosReclassV3ProposalHtml(entry, 'move_down');
  assert.doesNotMatch(output, /Place moved quantities On Hold|type="checkbox"|data-reclass-v3-proposal-field="applyHold"/);
  assert.match(output, /retired Hold option/);
  assert.match(output, /Move Down quantity 3/); assert.match(output, /Move Down destination 3/);
  assert.match(output, /Requested \(Up \+ Down\): 25/); assert.match(output, /Remaining: 0/);
  assert.doesNotMatch(output, /<script>|bad/);
  proposal.applyHold = false;
  assert.match(ctx.buildArgosReclassV3ProposalHtml(entry, 'move_down'), /Use On Hold or Off Hold in the action grid/);
  assert.doesNotMatch(output, /<option value="F1"/);
});

function holdTargetFixture(rows, sourceUid = '', currentUsername = 'dylan_collyge', { profileUsername = currentUsername, displayUsername = '' } = {}) {
  const names = ['normalizeArgosReclassSalesYear', 'getArgosReclassScopeSettings', 'isArgosReclassHoldFanoutActorHint', 'isArgosReclassHoldScopeEntry',
    'getArgosReclassHoldScopeEntries', 'getArgosReclassHoldTargetEntries', 'getArgosReclassHoldProposalTargetEntries'];
  const currentProposal = sourceUid ? { action: 'hold', sourceUid } : null;
  const ctx = {
    argosInventoryTransactionState: { inquiryModel: { locationRows: rows } },
    argosReclassMultiActionState: { holdStopProposals: currentProposal ? { hold: currentProposal } : {} },
    RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'],
    AV_OPTION_EVAL_MANAGER_USERS: new Set(['dylan_collyge', 'jd_jones', 'megan_kelly', 'mitch_kaiser']),
    currentUser: currentUsername, currentUserDisplay: displayUsername,
    nativeAuthProfile: profileUsername ? { username: profileUsername } : null,
    normalizeEvalAccessUserKey: value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
    getArgosReclassV3HoldProposal: () => currentProposal,
    getReclassActionWorkflowV5Config: action => ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'].includes(action) ? ({
      kind: ['take_off_hold', 'off_stop_ship'].includes(action) ? 'hold_off' : 'hold_on',
      code: ['stop_ship', 'off_stop_ship'].includes(action) ? 'S' : 'H',
    }) : null,
    getConfiguredCurrentSeasonCode: () => 'F1',
    getConfiguredCurrentSalesYearCode: () => 2026,
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== '') ?? '',
  };
  vm.createContext(ctx);
  vm.runInContext(names.map(source).join('\n'), ctx);
  return ctx;
}

test('future-season and future-year hold origins remain selectable as selected-row-only requests', () => {
  const current = { unique_id: 'current', values: { season: 'F1', saleyear: '2025', holdstopcode: '' }, sourceRow: { UNIQUE_ID: 'current' } };
  const futureSeason = { unique_id: 'future-season', values: { season: 'S1', saleyear: '2025', holdstopcode: '' }, sourceRow: { UNIQUE_ID: 'future-season' } };
  const futureYear = { unique_id: 'future-year', values: { season: 'F1', saleyear: '2027', holdstopcode: '' }, sourceRow: { UNIQUE_ID: 'future-year' } };
  const futureCodedSibling = { unique_id: 'future-coded-sibling', values: { season: 'S1', saleyear: '2027', holdstopcode: 'H' }, sourceRow: { UNIQUE_ID: 'future-coded-sibling' } };
  const ctx = holdTargetFixture([current, futureSeason, futureYear, futureCodedSibling]);

  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('hold', 'future-season')), [futureSeason]);
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('stop_ship', 'future-year')), [futureYear]);
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('take_off_hold', 'future-coded-sibling')), [futureCodedSibling]);
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('take_off_hold', 'future-year')), [],
    'a coded but unrelated future row does not make Hold Off eligible for an uncoded origin');
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('unsupported', 'future-year')), [], 'unknown actions have no targets');
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('take_off_hold', 'missing-source')), [], 'missing origins have no targets');
  assert.deepEqual(plain(ctx.getArgosReclassHoldProposalTargetEntries('hold')), [],
    'no proposal means no effective targets');
  assert.match(source('buildArgosReclassActionFieldsHtml'), /getArgosReclassHoldTargetEntries\(action, uid\)/,
    'the row action buttons use the selected origin eligibility helper');
});

test('current-scope hold origins preserve manager fanout and Hold Off coded-row eligibility', () => {
  const origin = { unique_id: 'origin', values: { season: 'F1', saleyear: '2026', holdstopcode: '' }, sourceRow: { UNIQUE_ID: 'origin' } };
  const olderCoded = { unique_id: 'older-coded', values: { season: 'F1', saleyear: '2025', holdstopcode: 'H' }, sourceRow: { UNIQUE_ID: 'older-coded' } };
  const olderUncoded = { unique_id: 'older-uncoded', values: { season: 'F1', saleyear: '2024', holdstopcode: '' }, sourceRow: { UNIQUE_ID: 'older-uncoded' } };
  const futureCoded = { unique_id: 'future-coded', values: { season: 'F1', saleyear: '2027', holdstopcode: 'H' }, sourceRow: { UNIQUE_ID: 'future-coded' } };
  const ctx = holdTargetFixture([origin, olderCoded, olderUncoded, futureCoded], 'origin');
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('hold', 'origin')), [origin, olderCoded, olderUncoded]);
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('take_off_hold', 'origin')), [olderCoded]);
  assert.deepEqual(plain(ctx.getArgosReclassHoldProposalTargetEntries('hold')), [origin, olderCoded, olderUncoded]);
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('take_off_hold', 'future-coded')), [futureCoded],
    'future origin can clear its own matching code but cannot fan out to current or sibling rows');
});

test('ordinary users preview selected-row-only scope and cannot infer Hold Off from unrelated sibling codes', () => {
  const ordinaryOrigin = { unique_id: 'ordinary-origin', values: { season: 'F1', saleyear: '2026', holdstopcode: '' }, sourceRow: { UNIQUE_ID: 'ordinary-origin' } };
  const codedSibling = { unique_id: 'coded-sibling', values: { season: 'F1', saleyear: '2025', holdstopcode: 'H' }, sourceRow: { UNIQUE_ID: 'coded-sibling' } };
  const ctx = holdTargetFixture([ordinaryOrigin, codedSibling], 'ordinary-origin', 'ordinary_user');
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('hold', 'ordinary-origin')), [ordinaryOrigin]);
  assert.deepEqual(plain(ctx.getArgosReclassHoldProposalTargetEntries('hold')), [ordinaryOrigin]);
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('take_off_hold', 'ordinary-origin')), [],
    'a sibling code does not imply fanout or enable a no-op for an ordinary actor');
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('take_off_hold', 'coded-sibling')), [codedSibling],
    'the ordinary actor may still target the selected row that actually has H');
});

test('fanout hint uses authenticated profile username, not display name or stale shell username', () => {
  const origin = { unique_id: 'origin', values: { season: 'F1', saleyear: '2026', holdstopcode: '' }, sourceRow: { UNIQUE_ID: 'origin' } };
  const sibling = { unique_id: 'sibling', values: { season: 'F1', saleyear: '2025', holdstopcode: '' }, sourceRow: { UNIQUE_ID: 'sibling' } };
  const displayNameOnly = holdTargetFixture([origin, sibling], '', 'ordinary_user', { profileUsername: 'ordinary_user', displayUsername: 'Dylan Collyge' });
  assert.deepEqual(plain(displayNameOnly.getArgosReclassHoldTargetEntries('hold', 'origin')), [origin],
    'a display-name match does not grant the UI fanout hint');
  const profileWins = holdTargetFixture([origin, sibling], '', 'ordinary_user', { profileUsername: 'dylan_collyge', displayUsername: 'Ordinary User' });
  assert.deepEqual(plain(profileWins.getArgosReclassHoldTargetEntries('hold', 'origin')), [origin, sibling],
    'the authenticated profile username is authoritative over the shell username');
});

test('Hold Off and Stop Off recognize composite SQL H/S codes', () => {
  const codedOrigin = { unique_id: 'composite-origin', values: { season: 'F1', saleyear: '2027', holdstopcode: 'HS' }, sourceRow: { UNIQUE_ID: 'composite-origin' } };
  const ctx = holdTargetFixture([codedOrigin], 'composite-origin', 'ordinary_user');
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('take_off_hold', 'composite-origin')), [codedOrigin]);
  assert.deepEqual(plain(ctx.getArgosReclassHoldTargetEntries('off_stop_ship', 'composite-origin')), [codedOrigin]);
  const scopeSource = source('getArgosReclassHoldScopeEntries');
  assert.match(scopeSource, /toUpperCase\(\)\.includes\(rule\.code\)/,
    'current manager fanout preview matches the SQL helper’s H/S token removal');
});

test('Hold/Stop action copy describes the selected origin and server-authorized scope', () => {
  const panelSource = source('buildArgosReclassActionFieldsHtml');
  const proposalSource = source('buildArgosReclassV3ProposalHtml');
  assert.match(panelSource, /starts from the selected row; the server determines any authorized matching-row scope/);
  assert.doesNotMatch(panelSource, /inquiry-wide scope/);
  assert.match(proposalSource, /The selected row is the origin\. The server determines whether matching rows/);
  assert.match(proposalSource, /matching hold code will be removed\. Its reason clears only if no hold\/stop code remains/);
  assert.doesNotMatch(proposalSource, /apply to every eligible row/);
});
