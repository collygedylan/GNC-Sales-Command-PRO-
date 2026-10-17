// @test-group: foundation
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const client = readFileSync(new URL('../assets/ops-precision-pilot.js', import.meta.url), 'utf8');
const source = client.slice(client.indexOf('  const BROWSE_RAIL_SELECTOR'), client.indexOf('  function requestPreferenceSave'));
const scheduleSource = client.slice(client.indexOf('  function scheduleDecorateRecordCollections()'), client.indexOf('  function isNarrowOrTouchLayout()'));
const deferPredicateSource = client.slice(client.indexOf('  function shouldDeferRecordCollectionDecoration('), client.indexOf('  function nodeTouchesCompactBrowseRail('));

function fixture() {
  const dom = new JSDOM('<div id="drive-toolbar-rail"><button>A</button><button>B</button><button>C</button></div>', { runScripts: 'outside-only' });
  const window = dom.window;
  window.eval(`${source}\nwindow.decorateRails = decorateCompactBrowseRails; window.mutationAffectsRails = mutationAffectsCompactBrowseRails; window.isProgressiveChunkActive = isProgressiveChunkContainerActive; window.shouldDeferRecordScan = shouldDeferRecordCollectionDecoration;`);
  const query = window.document.querySelectorAll.bind(window.document);
  let scans = 0;
  window.document.querySelectorAll = selector => { scans++; return query(selector); };
  return { window, close: () => window.close(), scans: () => scans, rail: window.document.getElementById('drive-toolbar-rail') };
}

test('card-only mutations skip compact rail scans while rail changes still schedule them', () => {
  const f = fixture();
  try {
    const cardList = f.window.document.createElement('div');
    cardList.id = 'request-content';
    const card = f.window.document.createElement('article');
    card.className = 'request-card';
    cardList.appendChild(card);
    f.window.document.body.appendChild(cardList);
    const cardMutation = { target: cardList, addedNodes: [card], removedNodes: [] };
    assert.equal(f.window.mutationAffectsRails([cardMutation]), false,
      'request card chunks outside filter rails should not trigger a document-wide rail scan');

    const requestContainer = f.window.document.createElement('section');
    requestContainer.id = 'view-request';
    requestContainer.appendChild(f.rail);
    const requestCards = f.window.document.createElement('div');
    requestCards.className = 'request-cards';
    requestContainer.appendChild(requestCards);
    f.window.document.body.appendChild(requestContainer);
    const siblingRailCardMutation = { target: requestContainer, addedNodes: [card], removedNodes: [] };
    assert.equal(f.window.mutationAffectsRails([siblingRailCardMutation]), false,
      'an unrelated card mutation on a container that happens to contain a rail sibling must not scan rails');

    const railChild = f.window.document.createElement('button');
    assert.equal(f.window.mutationAffectsRails([{ target: f.rail, addedNodes: [railChild], removedNodes: [] }]), true,
      'changes inside a rail can alter its compact disclosure structure');
    assert.equal(f.window.mutationAffectsRails([{ target: f.rail.parentElement, addedNodes: [f.rail], removedNodes: [] }]), true,
      'new rail insertion must be detected');
    const nestedRailWrapper = f.window.document.createElement('div');
    nestedRailWrapper.innerHTML = '<div id="request-dylan-filter-panel" class="compact-filter-rail"></div>';
    assert.equal(f.window.mutationAffectsRails([{ target: requestContainer, addedNodes: [nestedRailWrapper], removedNodes: [] }]), true,
      'a newly inserted wrapper containing a rail must be detected');
    assert.equal(f.window.mutationAffectsRails([{ target: f.rail.parentElement, addedNodes: [], removedNodes: [f.rail] }]), true,
      'rail removal or replacement must preserve responsive restoration');
  } finally { f.close(); }
});

test('narrow card layouts defer whole-list decoration only while their progressive chunk is active', () => {
  const f = fixture();
  try {
    const container = f.window.document.createElement('div');
    container.dataset.activeChunkRenderKey = 'request-main';
    container.dataset.activeChunkRenderToken = '7';
    assert.equal(f.window.isProgressiveChunkActive(container), true);
    assert.equal(f.window.shouldDeferRecordScan({ narrowOrTouch: true, grid: false,
      activeChunk: f.window.isProgressiveChunkActive(container) }), true,
    'phone card decoration waits until progressive rows finish');

    delete container.dataset.activeChunkRenderKey;
    delete container.dataset.activeChunkRenderToken;
    assert.equal(f.window.isProgressiveChunkActive(container), false,
      'chunk completion or cancellation clears the public container markers');
    assert.equal(f.window.shouldDeferRecordScan({ narrowOrTouch: true, grid: false,
      activeChunk: f.window.isProgressiveChunkActive(container) }), false,
    'the final append can schedule collection decoration after activity ends');
    assert.equal(f.window.shouldDeferRecordScan({ narrowOrTouch: true, grid: true, activeChunk: true }), false,
      'grid layouts keep their collection decoration during progressive rendering');
    assert.equal(f.window.shouldDeferRecordScan({ narrowOrTouch: false, grid: false, activeChunk: true }), false,
      'non-touch layouts keep their existing decoration schedule');
  } finally { f.close(); }
});

test('scheduled collection decoration retries after the active chunk marker clears', () => {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  const window = dom.window;
  const callbacks = [];
  window.decorationCount = 0;
  window.requestIdleCallback = callback => { callbacks.push(callback); return callbacks.length; };
  window.eval(`
    let decorateFrame = 0;
    let activeChunk = true;
    function isNarrowOrTouchLayout() { return true; }
    function getEffectiveDisplayMode() { return 'cards'; }
    function hasActiveProgressiveListChunk() { return activeChunk; }
    function decorateRecordCollections() { window.decorationCount += 1; }
    function setActiveChunk(value) { activeChunk = value; }
    ${deferPredicateSource}
    ${scheduleSource}
    window.scheduleCollectionDecoration = scheduleDecorateRecordCollections;
    window.setActiveChunk = setActiveChunk;
  `);
  try {
    window.scheduleCollectionDecoration();
    callbacks.shift()();
    assert.equal(window.decorationCount, 0, 'the whole-list pass is skipped during progressive chunk work');

    window.setActiveChunk(false);
    window.scheduleCollectionDecoration();
    callbacks.shift()();
    assert.equal(window.decorationCount, 1, 'a later observer callback can run the final collection pass');
  } finally { dom.window.close(); }
});

test('desktop skips mobile rail scans until a mobile layout needs restoration', () => {
  const f = fixture();
  try {
    const buttons = Array.from(f.rail.children);
    f.window.innerWidth = 1440;
    f.window.decorateRails();
    f.window.decorateRails();
    assert.equal(f.scans(), 0);
    assert.deepEqual(Array.from(f.rail.children), buttons);

    f.window.innerWidth = 390;
    f.window.decorateRails();
    assert.equal(f.scans(), 1);
    const details = f.rail.querySelector('details');
    assert.ok(details);
    assert.deepEqual(Array.from(details.lastElementChild.children), buttons.slice(1));
    f.window.decorateRails();
    assert.equal(f.rail.querySelector('details'), details, 'unchanged mobile controls retain their nodes');

    f.window.innerWidth = 1440;
    f.window.decorateRails();
    assert.deepEqual(Array.from(f.rail.children), buttons, 'desktop restores the original controls in order');
    assert.equal(f.rail.classList.contains('mobile-browse-rail'), false);
    const restoredScans = f.scans();
    f.window.decorateRails();
    assert.equal(f.scans(), restoredScans, 'subsequent desktop card updates do not scan unrelated rails');

    f.window.innerWidth = 390;
    f.window.decorateRails();
    assert.ok(f.rail.querySelector('details'), 'resizing back to mobile still recreates the disclosure');
  } finally { f.close(); }
});

test('mobile rail replacement preserves the stored disclosure state', () => {
  const f = fixture();
  try {
    f.window.innerWidth = 390;
    f.window.decorateRails();
    const details = f.rail.querySelector('details');
    details.open = true;
    details.dispatchEvent(new f.window.Event('toggle'));
    const replacement = f.window.document.createElement('div');
    replacement.id = f.rail.id;
    replacement.innerHTML = '<button>D</button><button>E</button><button>F</button>';
    f.rail.replaceWith(replacement);
    f.window.decorateRails();
    assert.equal(replacement.querySelector('details').open, true);
    f.window.innerWidth = 1440;
    f.window.decorateRails();
    assert.deepEqual(Array.from(replacement.children, child => child.textContent), ['D', 'E', 'F']);
  } finally { f.close(); }
});
