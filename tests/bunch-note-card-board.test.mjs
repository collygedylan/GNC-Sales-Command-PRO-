import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const built = await build({ entryPoints: [new URL('../components/bunch-notes/CardBoard.jsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' });
const componentModule = { exports: {} };
require('vm').runInNewContext(built.outputFiles[0].text, { require, module: componentModule, exports: componentModule.exports,
  console, globalThis, crypto: globalThis.crypto });
const React = require('react');
const { render, screen, fireEvent, waitFor, cleanup } = require('@testing-library/react');
const { BunchNoteCardBoard } = componentModule.exports;

const rows = [{ unique_id: 'lot-1', location_code: 'E.2.000', itemcode: 'RR-1', commonname: 'Royal Red', contsize: '#1', stock: 0, ptronhand: 7, available: 4 }];
const locations = [{ id: 'location-1', location_code: 'E.2.000', direction: 'West to East', target_houses: 'South only',
  house_sections: [{ id: 'house-1', name: 'South House' }], general_instructions: 'Leave aisles clear', cards: [] }];

test('quick action fields update independently and card movement stays a separate callback', async () => {
  let viewState = {};
  const edits = [], moves = [];
  let update;
  const props = { rows, locations, users: [{ id: 'worker-1', full_name: 'Toby Brown' }], viewState,
    onViewState: next => { viewState = next; update(React.createElement(BunchNoteCardBoard, { ...props, viewState })); },
    onCardChange: (location, card) => edits.push({ location, card }), onMove: (location, card) => moves.push(card) };
  const rendered = render(React.createElement(BunchNoteCardBoard, props));
  update = rendered.rerender;
  fireEvent.click(screen.getByRole('button', { name: 'Assign Worker Name' }));
  fireEvent.change(screen.getByLabelText('Assign worker'), { target: { value: 'worker-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'House to work in' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'House to work in' }), { target: { value: 'South House' } });
  fireEvent.click(screen.getByRole('button', { name: 'Direction' }));
  fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'East to West' } });
  assert.equal(edits.at(-1).card.owner_id, 'worker-1');
  assert.equal(edits.at(-1).card.house, 'South House');
  assert.equal(edits.at(-1).card.direction, 'East to West');
  fireEvent.click(screen.getByRole('button', { name: 'Move' }));
  assert.equal(moves.length, 1);
  assert.equal(edits.at(-1).card.owner_id, 'worker-1');
  cleanup();
});

test('included-card edit remains visible after a failed save and error is announced', async () => {
  const edits = [];
  render(React.createElement(BunchNoteCardBoard, { rows, locations, users: [{ id: 'worker-1', full_name: 'Toby Brown' }], onCardChange: (location, card) => edits.push(card),
    onSave: async () => { throw new Error('Revision conflict. Refresh and review.'); } }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include in this Bunch Note' }));
  fireEvent.click(screen.getByRole('button', { name: 'Assign Worker Name' }));
  fireEvent.change(screen.getByLabelText('Assign worker'), { target: { value: 'worker-1' } });
  assert.equal(screen.getByLabelText('Assign worker').value, 'worker-1', 'quick action keeps the selected worker before save');
  fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
  await waitFor(() => assert.equal(screen.getByRole('alert').textContent, 'Revision conflict. Refresh and review.'));
  assert.equal(screen.getByLabelText('Assign worker').value, 'worker-1');
  assert.equal(edits.at(-1).included, true);
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Save card' }).disabled, false));
  cleanup();
});

test('removing and re-adding a card before save keeps its allocated ID stable', () => {
  const edits = [];
  render(React.createElement(BunchNoteCardBoard, { rows, locations,
    onCardChange: (location, card) => edits.push(card) }));
  const checkbox = screen.getByRole('checkbox', { name: 'Include in this Bunch Note' });
  fireEvent.click(checkbox);
  const firstId = edits.at(-1).id;
  fireEvent.click(checkbox);
  assert.equal(edits.at(-1).included, false);
  fireEvent.click(checkbox);
  assert.equal(edits.at(-1).included, true);
  assert.equal(edits.at(-1).id, firstId);
  cleanup();
});

test('a rejected card removal cannot be saved until a later edit is accepted', () => {
  const selected = [{ ...locations[0], cards: [{ id: 'saved-card', kind: 'inventory', location_code: 'E.2.000',
    itemcode: 'RR-1', commonname: 'Royal Red', contsize: '#1', row_ids: ['lot-1'], owner_id: null }] }];
  render(React.createElement(BunchNoteCardBoard, { rows, locations: selected, onSave: async () => ({ ok: true }),
    onCardChange: (_location, card) => { if (!card.included) throw new Error('Remove planned actions first.'); } }));
  const checkbox = screen.getByRole('checkbox', { name: 'Include in this Bunch Note' });
  fireEvent.click(checkbox);
  assert.equal(screen.getByRole('alert').textContent, 'Remove planned actions first.');
  assert.equal(screen.getByRole('button', { name: 'Save card' }).disabled, true);
  fireEvent.click(checkbox);
  assert.equal(screen.queryByRole('alert'), null);
  assert.equal(screen.getByRole('button', { name: 'Save card' }).disabled, false);
  cleanup();
});

test('a rejected Move callback is reported in the card', () => {
  render(React.createElement(BunchNoteCardBoard, { rows, locations,
    onMove: () => { throw new Error('Move is unavailable for this card.'); } }));
  fireEvent.click(screen.getByRole('button', { name: 'Move' }));
  assert.equal(screen.getByRole('alert').textContent, 'Move is unavailable for this card.');
  cleanup();
});

test('lot expansion is represented in caller-owned view state for remount persistence', async () => {
  let viewState = {};
  const renderBoard = () => render(React.createElement(BunchNoteCardBoard, { rows, locations, viewState,
    onViewState: next => { viewState = next; } }));
  const { unmount } = renderBoard();
  fireEvent.click(screen.getByText('Expand all lot details (1)'));
  await waitFor(() => assert.equal(viewState.expandedCardIds?.length, 1));
  unmount(); renderBoard();
  assert.equal(document.querySelector('.bn-board-lots').open, true);
  cleanup();
});

test('published assignment controls defer reassignment to Queue', () => {
  render(React.createElement(BunchNoteCardBoard, { rows, locations: [{ ...locations[0], job_id: 'published-job',
    cards: [{ id: 'published-card', kind: 'inventory', location_code: 'E.2.000', itemcode: 'RR-1',
      commonname: 'Royal Red', contsize: '#1', row_ids: ['lot-1'], owner_id: 'worker-1' }] }],
    users: [{ id: 'worker-1', full_name: 'Toby Brown' }] }));
  fireEvent.click(screen.getByRole('button', { name: 'Assign Worker Name' }));
  assert.equal(screen.getByLabelText('Assign worker').disabled, true);
  assert.ok(screen.getByText('Reassign published work in Que.'));
  cleanup();
});
