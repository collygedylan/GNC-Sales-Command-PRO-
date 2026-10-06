import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationCardBoard, cardGroupKey, groupIncludedRows, normalizeCardDraft } from '../components/bunch-notes/card-model.mjs';

const row = (unique_id, values = {}) => ({ unique_id, location_code: 'E.2.000', itemcode: 'RR-1',
  commonname: 'Royal Red butterfly bush', contsize: '#1', ...values });

test('groups full location/item/name/size with case and whitespace normalization and natural order', () => {
  const rows = [
    row('lot-10', { location_code: 'E.10.000', itemcode: 'X', commonname: 'A', contsize: '1' }),
    row('lot-2', { location_code: ' e.2.000 ', itemcode: ' rr-1 ', commonname: ' royal  red butterfly bush ', contsize: ' #1 ' }),
    row('lot-1'),
    row('other-size', { contsize: '#2' }),
  ];
  const groups = groupIncludedRows([{ id: 'card', row_ids: rows.map(item => item.unique_id), rows }]);
  assert.deepEqual(groups.map(group => [group.location_code, group.itemcode, group.contsize, group.row_ids.length]), [
    ['e.2.000', 'rr-1', '#1', 2], ['E.2.000', 'RR-1', '#2', 1], ['E.10.000', 'X', '1', 1],
  ]);
  assert.equal(cardGroupKey(rows[1]), cardGroupKey(rows[2]));
});

test('deduplicates by stable UID, treats zero as known, and signals unknown quantities', () => {
  const rows = [row('same', { stock: 0, ptronhand: 99, available: null, ptravailable: 4 }),
    row('same', { stock: 50, available: 10 }),
    row('second', { stock: '', ptronhand: 3, available: 1 }),
    row('unknown', { commonname: 'Unknown quantity', stock: null, ptronhand: '', onhand: null })];
  const groups = groupIncludedRows([{ id: 'board', rows, row_ids: rows.map(item => item.unique_id) }]);
  const royal = groups.find(group => group.commonname === 'Royal Red butterfly bush');
  assert.deepEqual(royal.row_ids, ['same', 'second']);
  assert.deepEqual(royal.on_hand, { value: 3, complete: true, knownCount: 2, rowCount: 2 });
  assert.deepEqual(royal.available, { value: 5, complete: true, knownCount: 2, rowCount: 2 });
  assert.equal(groups.find(group => group.commonname === 'Unknown quantity').on_hand.complete, false);
  assert.equal(groups.find(group => group.commonname === 'Unknown quantity').on_hand.value, 0);
});

test('renders all inventory groups but marks only explicitly selected row sets as included', () => {
  const rows = [row('a'), row('b'), row('c', { location_code: 'E.10.000', itemcode: 'X', commonname: 'Y' })];
  const locations = [
    { id: 'loc10', location_code: 'E.10.000', cards: [] },
    { id: 'loc2', location_code: 'E.2.000', cards: [{ id: 'saved-uuid', kind: 'inventory',
      location_code: 'E.2.000', itemcode: 'RR-1', commonname: 'Royal Red butterfly bush', contsize: '#1', row_ids: ['a'] }] },
  ];
  const board = buildLocationCardBoard(locations, rows);
  assert.deepEqual(board.map(item => item.location.id), ['loc2', 'loc10']);
  assert.deepEqual(board.map(item => item.cards.length), [1, 1]);
  assert.equal(board[0].cards[0].included, true);
  assert.equal(board[0].cards[0].id, 'saved-uuid');
  assert.deepEqual(board[0].cards[0].row_ids, ['a']);
  assert.deepEqual(board[0].cards[0].rows.map(row => row.unique_id), ['a', 'b']);
  assert.equal(board[0].cards[0].row_coverage_complete, false);
  assert.equal(board[1].cards[0].included, false);
  assert.match(board[1].cards[0].id, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
});

test('synthesizes view-only location cards from full block rows without including inventory', () => {
  const board = buildLocationCardBoard([], [row('a', { location_code: 'E.10.000' }), row('b'), row('a')]);
  assert.deepEqual(board.map(item => item.location.location_code), ['E.2.000', 'E.10.000']);
  assert.deepEqual(board.map(item => item.cards.map(card => card.included)), [[false], [false]]);
  assert.ok(board.every(item => item.location._view_only));
});

test('adapts legacy selected row actions as shared records, not inventory inclusions', () => {
  const location = { location_code: 'E.2.000', actions: [{ id: 'act-1', scope: 'rows', row_ids: ['a'], label: 'Haul' }] };
  const cards = normalizeCardDraft(location, [row('a')]);
  assert.equal(cards[0].kind, 'shared');
  assert.deepEqual(cards[0].row_ids, ['a']);
  const board = buildLocationCardBoard([location], [row('a')]);
  assert.equal(board[0].cards[0].included, false);
});

test('keeps changed or missing saved source lots in a visible orphan card without retargeting', () => {
  const location = { location_code: 'E.2.000', cards: [{ id: 'kept-card', kind: 'inventory',
    location_code: 'E.2.000', itemcode: 'OLD', commonname: 'Old name', contsize: '#7', row_ids: ['gone'] }] };
  const board = buildLocationCardBoard([location], [row('new', { itemcode: 'NEW', commonname: 'New name', contsize: '#1' })]);
  const orphan = board[0].groups.find(group => group.orphan).cards[0];
  assert.equal(orphan.id, 'kept-card');
  assert.deepEqual(orphan.row_ids, ['gone']);
  assert.deepEqual(orphan.rows, []);
  assert.equal(orphan.row_coverage_complete, false);
  assert.equal(orphan.on_hand.complete, false);
  assert.equal(board[0].cards.find(card => card.commonname === 'New name').included, false);
});
