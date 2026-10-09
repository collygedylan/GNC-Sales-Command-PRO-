import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parseExpressionAt } from 'acorn';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function source(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, name);
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

test('collector preserves ordered repeated splits, exact OH, and Move Down hold scope', () => {
  const { ctx, entry, move } = fixture();
  const draft = move([{ quantity: '15', destinationSeason: 'X' }, { quantity: '5', destinationSeason: 'S1' }, { quantity: '5', destinationSeason: 'X' }]);
  draft.action = 'move_down';
  const rowMap = ctx.getArgosReclassRowProposalMap();
  delete rowMap.move_up;
  rowMap.move_down = draft;
  draft.applyHold = true; draft.holdReason = ' Quality REVIEW ';
  const before = plain(entry);
  const result = ctx.collectArgosReclassV3Draft();
  assert.deepEqual(plain(result.rowOverlays[0].proposals), [{ action: 'move_down', splits: [
    { quantity: 15, destinationSeason: 'X' }, { quantity: 5, destinationSeason: 'S1' }, { quantity: 5, destinationSeason: 'X' },
  ], applyHold: true, holdReason: 'quality review' }]);
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

test('invalid split rows and missing hold reason block submission without discarding input', () => {
  for (const split of [{ quantity: '', destinationSeason: 'X' }, { quantity: 0, destinationSeason: 'X' },
    { quantity: -1, destinationSeason: 'X' }, { quantity: 1.5, destinationSeason: 'X' },
    { quantity: 2, destinationSeason: '' }, { quantity: 2, destinationSeason: 'F1' }, { quantity: 2, destinationSeason: 'Q1' }]) {
    const { ctx, move, rowMap } = fixture(); move([split]); const before = plain(rowMap);
    assert.throws(() => ctx.collectArgosReclassV3Draft()); assert.deepEqual(plain(rowMap), before);
  }
  const { ctx, move } = fixture(); const proposal = move(); proposal.action = 'move_down';
  const rowMap = ctx.getArgosReclassRowProposalMap(); delete rowMap.move_up; rowMap.move_down = proposal;
  proposal.applyHold = true;
  assert.throws(() => ctx.collectArgosReclassV3Draft(), /Hold reason/);
  proposal.holdReason = 'x'.repeat(1001);
  assert.throws(() => ctx.collectArgosReclassV3Draft(), /Hold reason/);
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

test('move renderer escapes drafts and shows accessible per-split controls and scoped hold', () => {
  const { ctx, entry, move } = fixture(); const proposal = move(); proposal.action = 'move_down';
  const rowMap = ctx.getArgosReclassRowProposalMap(); delete rowMap.move_up; rowMap.move_down = proposal;
  proposal.applyHold = true; proposal.holdReason = '<script>bad</script>';
  const output = ctx.buildArgosReclassV3ProposalHtml(entry, 'move_down');
  assert.match(output, /Place moved quantities On Hold/);
  assert.match(output, /Move Down quantity 3/); assert.match(output, /Move Down destination 3/);
  assert.match(output, /Requested \(Up \+ Down\): 25/); assert.match(output, /Remaining: 0/);
  assert.match(output, /&lt;script&gt;bad&lt;\/script&gt;/); assert.doesNotMatch(output, /<script>/);
  assert.doesNotMatch(output, /<option value="F1"/);
});
