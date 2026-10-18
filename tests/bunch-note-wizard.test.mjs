// @test-group: bunch-notes-wizard
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const source = read('assets/bunch-note.js');

function createRuntime(postAppFunctionJson, viewId = 'bunch-note', useDom = false) {
  let currentView = viewId;
  const dom = useDom ? new JSDOM('<!doctype html><main id="main-scroll-area"><div id="bunch-note-content"></div></main>', {
    url: 'https://fixture.test/', runScripts: 'dangerously', pretendToBeVisual: true,
  }) : null;
  const element = dom ? dom.window.document.getElementById('bunch-note-content') : { classList: { add() {} }, innerHTML: '', childNodes: [], setAttribute() {}, querySelectorAll: () => [] };
  const documentListeners = new Map();
  const document = dom ? dom.window.document : { getElementById: () => element, querySelectorAll: () => [],
    addEventListener(type, listener) { const listeners=documentListeners.get(type)||new Set();listeners.add(listener);documentListeners.set(type,listeners); },
    removeEventListener(type, listener) { documentListeners.get(type)?.delete(listener); },
    dispatchEvent(event) { for (const listener of documentListeners.get(event.type)||[]) listener(event); } };
  const context = vm.createContext({
    console, Date, Map, Set, URL, Blob, Uint8Array, structuredClone, atob: globalThis.atob,
    currentUser: 'dylan_collyge', nativeAuthSessionActive: true, nativeAuthAccessToken: 'fixture-access-token', REQUEST_EMAIL_SCRIPT_TIMEOUT_MS: 45000,
    nativeAuthProfile: { id: 'dylan', username: 'dylan_collyge', must_change_password: false },
    APP_API_FUNCTION_URL: 'https://fixture.invalid', postAppFunctionJson,
    postGoogleScriptJsonPayload: async () => ({ ok: true, pdfs: [{ base64: 'JVBERi0xLjQK', filename: 'BN.pdf' }] }),
    document, activeReqTab: 'bunch-notes', getCurrentVisibleViewId: () => currentView,
    switchView: value => { currentView = value; },
    showToast() {}, crypto: { randomUUID: (() => { let id = 0; return () => `wizard-${++id}`; })() }
  });
  vm.runInContext(read('assets/location-code.js'), context);
  vm.runInContext(source, context);
  return { BunchNote: context.BunchNote, element, document,
    setView(value) { currentView = value; },
    setAccount(value) { context.currentUser = value; },
    setActiveTab(value) { context.activeReqTab = value; },
    close() { dom?.window.close(); } };
}

test('Inventory Bunch Notes exposes Create note and Assigned work on the standalone route', async () => {
  const requests = [];
  const { BunchNote: note, element } = createRuntime(async (_url, request) => {
    requests.push(plain(request));
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'list') return { ok: true, data: { jobs: [] } };
    return { ok: true, data: {} };
  });

  await note.open();
  assert.match(element.innerHTML, /id="bn-create-note-mode"[^>]*aria-pressed="true"/);
  assert.match(element.innerHTML, /<h2>Inv Bunch Notes<\/h2>/);
  assert.match(element.innerHTML, /Open block D/);
  assert.match(element.innerHTML, /id="bn-assigned-work-mode"/);

  note.setQueueMode('assigned');
  assert.match(element.innerHTML, /id="bn-assigned-work-mode"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(element.innerHTML, /Open block D/);
  note.setQueueMode('create');
  assert.match(element.innerHTML, /Open block D/);
  assert.ok(requests.some(request => request.operation === 'blocks'));
});

test('revising assigned work opens the revised draft in Create note mode', async () => {
  const job = { id: 'job-revise', block: 'D', location: 'D.05.123', status: 'open', owner_id: 'dylan', revision: 3, cards: [], body: { locations: [], actions: [], source: [] }, progress: {}, actuals: [], worker_actions: [] };
  const draft = { id: 'draft-revise', revision: 1, body: { format_version: 5, block: 'D', locations: [{ location: 'D.05.123', purposes: 'Inspect', direction: '', instructions: '', source: [], row_ids: [], cards: [], actions: [] }], recipient_ids: [] } };
  const row = { unique_id: 'lot-revise', blockalpha: 'D', locationcode: 'D.05.123', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 12, review: 0, available: 12 };
  const { BunchNote: note, element } = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'list') return { ok: true, data: { jobs: [job] } };
    if (request.operation === 'get') return { ok: true, data: { job, versions: [], audit: [] } };
    if (request.operation === 'revise') return { ok: true, data: { draft } };
    if (request.operation === 'inventory') return { ok: true, data: { rows: [row] } };
    return { ok: true, data: {} };
  });

  await note.open();
  note.setQueueMode('assigned');
  await new Promise(resolve => setImmediate(resolve));
  await note.detail(job.id);
  await note.revise();

  assert.match(element.innerHTML, /id="bn-create-note-mode"[^>]*aria-pressed="true"/);
  assert.match(element.innerHTML, /<h2>Inv Bunch Notes<\/h2>/);
  assert.match(element.innerHTML, /\u003e1 inventory rows\u003c/);
  assert.match(element.innerHTML, /BunchNote\.openLocation\(&quot;D\.05\.123&quot;\)/);
});

test('Inv Bunch Notes Step 1 shortens only the displayed three-digit location suffix', async () => {
  const row = { unique_id: 'lot-5000', blockalpha: 'D', locationcode: 'D.05.123', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 12, review: 0, available: 12 };
  let savedBody;
  const { BunchNote: note, element } = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows: [row] } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') {
      savedBody = plain(request.payload.body);
      return { ok: true, data: { draft: { id: 'batch-5000', revision: 1, body: savedBody } } };
    }
    return { ok: true, data: {} };
  });

  await note.open();
  note.setQueueMode('create');
  await note.chooseBlock('D');
  assert.match(element.innerHTML, /<h2>Inv Bunch Notes<\/h2>/);
  assert.match(element.innerHTML, /<strong>D\.05\.<\/strong>/);
  assert.match(element.innerHTML, /aria-label="Open location D\.05\."/);
  note.openLocation('D.05.123');
  note.wizardField('workType', 'Prepare shipment');
  await note.nextItems();
  assert.equal(savedBody.locations[0].location, 'D.05.123');
});

test('non-author opens Inventory Bunch Notes directly into assigned work without author metadata reads', async () => {
  const operations = [];
  const { BunchNote: note, element, setAccount } = createRuntime(async (_url, request) => {
    operations.push(request.operation);
    if (request.operation === 'list') return { ok: true, data: { jobs: [{ id:'job-1', block:'D', location:'D.05.000', status:'open', owner_id:null, cards:[], body:{ purposes:'Inspect' }, progress:{} }] } };
    return { ok: true, data: {} };
  });
  setAccount('field-worker');

  await note.open();

  assert.match(element.innerHTML, /<strong>D\.05<\/strong>/);
  assert.deepEqual(operations, ['list']);
  assert.doesNotMatch(element.innerHTML, /Create note/);
});

test('location setup is a guided header step before inventory card selection', async () => {
  const row = { unique_id: 'lot-1', blockalpha: 'D', locationcode: 'D.08.001', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 12, review: 1, available: 11 };
  let savedBody = null;
  const { BunchNote: note, element } = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows: [row] } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: ['D.08.001'] } };
    if (request.operation === 'save') {
      savedBody = plain(request.payload.body);
      return { ok: true, data: { draft: { id: 'batch-1', revision: 1, body: savedBody } } };
    }
    return { ok: true, data: {} };
  });

  await note.open();
  await note.chooseBlock('D');
  note.openLocation('D.08.001');
  assert.match(element.innerHTML, /Work type/);
  assert.match(element.innerHTML, /Direction/);
  assert.match(element.innerHTML, /Extra notes/);
  assert.doesNotMatch(element.innerHTML, /Inventory action editor/);

  note.wizardField('workType', 'Inspect for quality');
  note.wizardField('direction', 'Start at the west gate');
  note.wizardField('notes', 'Call the crew lead');
  await note.nextItems();
  assert.equal(savedBody.locations[0].purposes, 'Inspect for quality');
  assert.equal(savedBody.locations[0].direction, 'Start at the west gate');
  assert.equal(savedBody.locations[0].instructions, 'Call the crew lead');
  assert.match(element.innerHTML, /Add inventory card/);
  assert.doesNotMatch(element.innerHTML, /data-bn-structured="header"/);
});

test('card picker persists multiple selected cards with assigned users and required conditional routing', async () => {
  const rows = [
    { unique_id: 'lot-a', blockalpha: 'D', locationcode: 'D.05.000', itemcode: 'PLANT-A', commonname: 'Peony', contsize: '#3', lotcode: 'A' },
    { unique_id: 'lot-b', blockalpha: 'D', locationcode: 'D.05.000', itemcode: 'PLANT-B', commonname: 'Hosta', contsize: '#2', lotcode: 'B' },
  ];
  let savedBody;
  const { BunchNote: note, element, document, close } = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows } };
    if (request.operation === 'directory') return { ok: true, data: { users: [{ id: 'user-1', username: 'sam', display: 'Sam' }, { id: 'user-2', username: 'lee', display: 'Lee' }] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: ['D.06.000'] } };
    if (request.operation === 'save') {
      savedBody = plain(request.payload.body);
      return { ok: true, data: { draft: { id: 'batch-route', revision: 1, body: savedBody } } };
    }
    return { ok: true, data: {} };
  }, 'bunch-note', true);

  await note.open();
  await note.chooseBlock('D');
  note.openLocation('D.05.000');
  assert.match(element.innerHTML, /value="D\.05\. Bunch Notes"/);
  await note.nextItems();
  note.openCardPicker();
  note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  note.togglePickerCard('D.05.000\u001fPLANT-B\u001fHOSTA\u001f#2', true);
  note.showPickerDetails();
  const dialog = () => document.querySelector('.bn-card-picker');
  assert.ok(dialog().querySelector('[aria-label="Assign to Sam"]'));
  assert.ok(dialog().querySelector('[aria-label="Assign to Lee"]'));
  assert.match(dialog().textContent, /Move/);
  assert.match(dialog().textContent, /Bunch/);
  assert.match(dialog().textContent, /TA \(Throw Away\)/);
  note.pickerField('workflow_action', 'bunch');
  assert.match(dialog().innerHTML, /South &amp; Center House/);
  assert.doesNotMatch(dialog().innerHTML, /aria-label="Move destination"/);
  note.pickerField('workflow_action', 'ta');
  assert.doesNotMatch(dialog().innerHTML, /aria-label="Bunch destination house"/);
  note.togglePickerOwner('user-1', true);
  note.togglePickerOwner('user-2', true);
  note.pickerField('workflow_action', 'move');
  assert.match(dialog().innerHTML, /aria-label="Move destination"/);
  assert.doesNotMatch(dialog().innerHTML, /aria-label="Bunch destination house"/);
  note.pickerField('destination_location', 'D.06.000');
  note.pickerField('notes', 'Move these together');
  await note.commitPickerCard();
  const cards = savedBody.locations[0].cards;
  assert.equal(cards.length, 2);
  assert.deepEqual(plain(cards.map(card => card.workflow_action)), ['move', 'move']);
  assert.deepEqual(plain(cards.map(card => card.destination_location)), ['D.06.000', 'D.06.000']);
  assert.deepEqual(plain(cards.map(card => card.owner_ids)), [['user-1', 'user-2'], ['user-1', 'user-2']]);
  assert.deepEqual(plain(cards.map(card => card.notes)), ['Move these together', 'Move these together']);
  assert.equal(savedBody.locations[0].location, 'D.05.000');
  close();
});

test('card picker retains existing per-card owners and does not carry deselected owners onto new cards', async () => {
  const rows = [
    { unique_id: 'lot-a', blockalpha: 'D', locationcode: 'D.05.000', itemcode: 'PLANT-A', commonname: 'Peony', contsize: '#3', lotcode: 'A' },
    { unique_id: 'lot-b', blockalpha: 'D', locationcode: 'D.05.000', itemcode: 'PLANT-B', commonname: 'Hosta', contsize: '#2', lotcode: 'B' },
  ];
  const cardA = { id: 'card-a', kind: 'inventory', location_code: 'D.05.000', itemcode: 'PLANT-A', commonname: 'Peony', contsize: '#3', row_ids: ['lot-a'], owner_id: 'user-1', owner_ids: ['user-1'], house: '', direction: '' };
  const draft = { id: 'batch-owners', revision: 1, body: { format_version: 5, block: 'D', recipient_ids: [], locations: [{ location: 'D.05.000', purposes: 'Inspect', direction: '', instructions: '', row_ids: ['lot-a'], cards: [cardA], source: rows, actions: [] }] } };
  let savedBody = null;
  const { BunchNote: note, element } = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows } };
    if (request.operation === 'directory') return { ok: true, data: { users: [{ id: 'user-1', username: 'sam', display: 'Sam' }, { id: 'user-2', username: 'lee', display: 'Lee' }] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [draft] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') {
      savedBody = plain(request.payload.body);
      return { ok: true, data: { draft: { ...draft, revision: (request.expectedRevision || 0) + 1, body: savedBody } } };
    }
    return { ok: true, data: {} };
  });

  await note.open();
  await note.openDraft(draft.id);
  note.openLocation('D.05.000');
  await note.nextItems();
  note.openCardPicker();
  note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  note.showPickerDetails();
  assert.match(element.innerHTML, /PLANT-A:<\/b> Sam/);
  assert.match(element.innerHTML, /Existing cards keep their current assignments/);
  note.showPickerDetails(false);
  note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', false);
  note.togglePickerCard('D.05.000\u001fPLANT-B\u001fHOSTA\u001f#2', true);
  note.showPickerDetails();
  note.pickerField('workflow_action', 'ta');
  await note.commitPickerCard();

  const cards = savedBody.locations[0].cards;
  assert.deepEqual(plain(cards.find(card => card.id === cardA.id).owner_ids), ['user-1']);
  const newCard = cards.find(card => card.itemcode === 'PLANT-B');
  assert.deepEqual(plain(newCard.owner_ids), []);
  assert.equal(newCard.owner_id, null);
});

test('card picker validates every selected group before mutating any card when source rows change', async () => {
  let inventoryRows = [
    { unique_id: 'lot-a', blockalpha: 'D', locationcode: 'D.05.000', itemcode: 'PLANT-A', commonname: 'Peony', contsize: '#3', lotcode: 'A' },
    { unique_id: 'lot-b', blockalpha: 'D', locationcode: 'D.05.000', itemcode: 'PLANT-B', commonname: 'Hosta', contsize: '#2', lotcode: 'B' },
  ];
  const draft = { id: 'batch-atomic', revision: 1, body: { format_version: 5, block: 'D', recipient_ids: [], locations: [{ location: 'D.05.000', purposes: 'Inspect', direction: '', instructions: '', row_ids: [], cards: [], source: [], actions: [] }] } };
  const savedBodies = [];
  const { BunchNote: note, element } = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows: inventoryRows } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [draft] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') {
      const body = plain(request.payload.body);
      savedBodies.push(body);
      return { ok: true, data: { draft: { ...draft, revision: (request.expectedRevision || 0) + 1, body } } };
    }
    return { ok: true, data: {} };
  });

  await note.open();
  await note.openDraft(draft.id);
  note.openLocation('D.05.000');
  await note.nextItems();
  note.openCardPicker();
  note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  note.togglePickerCard('D.05.000\u001fPLANT-B\u001fHOSTA\u001f#2', true);
  note.showPickerDetails();
  note.pickerField('workflow_action', 'ta');
  inventoryRows = [inventoryRows[0]];
  await note.refreshSource();
  await note.commitPickerCard();

  assert.equal(savedBodies.length, 1, 'only the preceding step transition was saved; invalid picker state was not saved');
  assert.match(element.innerHTML, /Selected lots no longer match/);
  note.closeCardPicker();
  assert.doesNotMatch(element.innerHTML, /<article class="bn-card bn-wizard-card"/);
});

test('structured header changes preserve newer wizard fields but apply fields edited in the header', () => {
  const { BunchNote: note } = createRuntime(async () => ({ ok: true, data: {} }));
  const current = { direction: 'West to East', target_houses: '' };
  const staleStructuredBaseline = { direction: '', target_houses: '' };
  assert.deepEqual(plain(note.mergeStructuredHeaderValue(current, staleStructuredBaseline, { direction: '', target_houses: 'South house only' })), {
    direction: 'West to East', target_houses: 'South house only'
  });
  assert.deepEqual(plain(note.mergeStructuredHeaderValue(current, staleStructuredBaseline, { direction: 'East to West', target_houses: 'North house only' })), {
    direction: 'East to West', target_houses: 'North house only'
  });
});

test('Inventory location selection and collapsed advanced controls do not eagerly mount the full CardBoard', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    unique_id: `row-${index}`, blockalpha: 'D', locationcode: index < 1000 ? 'D.08.001' : 'D.08.002',
    itemcode: `ITEM-${index}`, commonname: `Plant ${index}`, contsize: '#3', lotcode: `LOT-${index}`,
    stock: 2, review: 0, available: 2
  }));
  const { BunchNote: note, element } = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') return { ok: true, data: { draft: { id: 'batch-1', revision: 1, body: plain(request.payload.body) } } };
    return { ok: true, data: {} };
  });

  await note.open({ refresh: false });
  await note.chooseBlock('D');
  assert.equal(rows.length, 1001);
  assert.doesNotMatch(element.innerHTML, /data-bn-cards/, 'the location selection step must not mount the full React CardBoard');
  assert.equal((element.innerHTML.match(/aria-label="Open location D\.08\."/g) || []).length, 2,
    'distinct raw locations use the requested shortened display label');
  assert.match(element.innerHTML, /onclick="BunchNote\.openLocation\(&quot;D\.08\.001&quot;\)"/);
  assert.match(element.innerHTML, /onclick="BunchNote\.openLocation\(&quot;D\.08\.002&quot;\)"/);
  assert.match(element.innerHTML, /1000 inventory rows/);
  assert.match(element.innerHTML, /1 inventory rows/);

  note.openLocation('D.08.001');
  note.wizardField('workType', 'Inspect');
  await note.nextItems();
  assert.match(element.innerHTML, /Advanced inventory and action controls/);
  assert.doesNotMatch(element.innerHTML, /data-bn-cards/, 'collapsed advanced controls must not mount CardBoard');
  assert.doesNotMatch(element.innerHTML, /class="bn-plants"/, 'collapsed advanced controls must not render the detailed 1001-row editor');

  note.advancedInventoryPanel('D.08.001', true);
  assert.match(element.innerHTML, /data-bn-cards/, 'opening Advanced must retain access to the existing CardBoard');
  assert.match(element.innerHTML, /class="bn-plants"/);

  const standalone = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') return { ok: true, data: { draft: { id: 'batch-standalone', revision: 1, body: plain(request.payload.body) } } };
    return { ok: true, data: {} };
  }, 'bunch-note');
  await standalone.BunchNote.open({ refresh: false });
  await standalone.BunchNote.chooseBlock('D');
  assert.doesNotMatch(standalone.element.innerHTML, /data-bn-cards/, 'standalone authoring begins with the guided location list');
  standalone.BunchNote.openLocation('D.08.001');
  standalone.BunchNote.wizardField('workType', 'Inspect');
  await standalone.BunchNote.nextItems();
  assert.match(standalone.element.innerHTML, /Advanced inventory and action controls/);
  assert.doesNotMatch(standalone.element.innerHTML, /data-bn-cards/);
  standalone.BunchNote.advancedInventoryPanel('D.08.001', true);
  assert.match(standalone.element.innerHTML, /data-bn-cards/, 'standalone authoring keeps the existing CardBoard in Advanced controls');
});

test('inventory picker uses only source rows and + commits exact card notes before reopening search', async () => {
  const rows = [
    { unique_id: 'lot-1', blockalpha: 'D', locationcode: 'D.08.001', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 12, review: 1, available: 11 },
    { unique_id: 'lot-2', blockalpha: 'D', locationcode: 'D.08.001', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'B', stock: 9, review: 0, available: 9 },
    { unique_id: 'other', blockalpha: 'D', locationcode: 'D.09.001', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'C', stock: 4, review: 0, available: 4 }
  ];
  let savedBody = null;
  const requests = [];
  const { BunchNote: note, element } = createRuntime(async (_url, request) => {
    requests.push(plain(request));
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: savedBody ? [{ id: 'batch-1', revision: 2, block: 'D', body: savedBody, updated_at: '2026-10-17T00:00:00Z' }] : [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') {
      savedBody = plain(request.payload.body);
      return { ok: true, data: { draft: { id: 'batch-1', revision: (request.expectedRevision || 0) + 1, body: savedBody } } };
    }
    if (request.operation === 'preview') return { ok: true, data: { preview: { id: 'preview-1', instruction_revision: 1, recipients: [{ email: 'dylan@example.com' }] } } };
    if (request.operation === 'pdf_preview') return { ok: true, data: { pdfs: [{ base64: 'JVBERi0xLjQK', filename: 'BN.pdf' }] } };
    return { ok: true, data: {} };
  });

  await note.open({ refresh: false });
  await note.chooseBlock('D');
  note.openLocation('D.08.001');
  note.wizardField('workType', 'Inspect');
  await note.nextItems();
  assert.doesNotMatch(element.innerHTML, /role="alert"/);
  assert.match(element.innerHTML, /Add inventory card/);
  note.openCardPicker();
  assert.match(element.innerHTML, /role="dialog"/);
  assert.match(element.innerHTML, /Peony/);
  assert.doesNotMatch(element.innerHTML, /D\.09\.001/);
  note.selectPickerCard('D.08.001\u001fPLANT\u001fPEONY\u001f#3');
  note.showPickerDetails();
  note.pickerField('workflow_action', 'ta');
  note.pickerField('direction', 'Check the east row');
  note.pickerField('notes', 'Keep lots separate');
  await note.commitPickerCard();
  assert.equal(savedBody.locations[0].cards.length, 1);
  assert.deepEqual(plain(savedBody.locations[0].cards[0].row_ids), ['lot-1', 'lot-2']);
  assert.equal(savedBody.locations[0].cards[0].direction, 'Check the east row');
  assert.equal(savedBody.locations[0].cards[0].notes, 'Keep lots separate');
  assert.equal(savedBody.locations[0].actions.length, 0, 'new card notes live on the card and do not create a duplicate legacy action');
  assert.match(element.innerHTML, /role="dialog"/);
  assert.match(element.innerHTML, /Search inventory/);
  assert.match(element.innerHTML, /Peony/);
  note.cardPickerSearch('Peony');
  assert.equal((element.innerHTML.match(/class="[^"]*\bbn-picker-result\b[^"]*"/g) || []).length, 1, 'the reset picker remains searchable from cached full source rows');
  assert.equal(requests.filter(request=>request.operation==='inventory').length,1,'reset and search do not fetch inventory again');
  const committedSave=requests.filter(request=>request.operation==='save').at(-1);
  assert.equal(committedSave.payload.body.locations[0].cards[0].notes,'Keep lots separate');
  note.closeCardPicker();
  await note.backEditor();
  await note.openDraft('batch-1');
  note.openLocation('D.08.001');
  await note.nextItems();
  assert.match(element.innerHTML,/Keep lots separate/);
  await note.preview();
  const previewRequest=requests.find(request=>request.operation==='preview');
  assert.equal(previewRequest.payload.batch_id,'batch-1');
  assert.equal(savedBody.locations[0].cards[0].notes,'Keep lots separate');
  assert.match(element.innerHTML,/Review Inv Bunch Notes PDFs/);
  note.closePreview();
  assert.match(element.innerHTML,/id="bn-assigned-work-mode"[^>]*aria-pressed="true"/,'closing the preview returns to Inventory Assigned work');
});

test('inventory picker pages complete local results and searches all 1000 groups without another inventory read', async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    unique_id: `lot-${index + 1}`, blockalpha: 'D', locationcode: 'D.08.001',
    itemcode: `PLANT-${String(index + 1).padStart(4, '0')}`, commonname: `Plant ${String(index + 1).padStart(4, '0')}`,
    contsize: '#3', lotcode: `LOT-${index + 1}`, stock: 12, review: 0, available: 12
  }));
  let inventoryReads = 0;
  const { BunchNote: note, element, document, close } = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') { inventoryReads += 1; return { ok: true, data: { rows } }; }
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') return { ok: true, data: { draft: { id: 'batch-test', revision: (request.expectedRevision || 0) + 1, body: request.payload.body } } };
    return { ok: true, data: {} };
  }, 'bunch-note', true);

  await note.open();
  await note.chooseBlock('D');
  assert.doesNotMatch(element.innerHTML, /role="alert"/);
  note.openLocation('D.08.001');
  assert.doesNotMatch(element.innerHTML, /role="alert"/);
  note.wizardField('workType', 'Inspect');
  await note.nextItems();
  note.openCardPicker();
  const dialog = () => document.querySelector('.bn-card-picker');
  assert.equal(dialog().querySelectorAll('.bn-picker-result').length, 100);
  assert.match(dialog().textContent, /Showing 100 of 1000 cards/);
  assert.ok(dialog().querySelector('[aria-label="Load more inventory cards"]'));

  note.loadMorePickerCards();
  assert.equal(dialog().querySelectorAll('.bn-picker-result').length, 200);
  assert.match(dialog().textContent, /Showing 200 of 1000 cards/);

  note.cardPickerSearch('Plant 1000');
  assert.equal(dialog().querySelectorAll('.bn-picker-result').length, 1);
  assert.match(dialog().textContent, /Plant 1000/);
  assert.match(dialog().textContent, /Showing 1 of 1 card/);
  assert.equal(inventoryReads, 1, 'pagination and search use the complete cached source rows');
  close();
});

test('inventory picker Escape closes from outside dialog focus and backdrop retains its close action', async () => {
  const rows = [{ unique_id: 'lot-escape', blockalpha: 'D', locationcode: 'D.08.001', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 12, review: 0, available: 12 }];
  const { BunchNote: note, element, document } = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') return { ok: true, data: { draft: { id: 'batch-escape', revision: (request.expectedRevision || 0) + 1, body: request.payload.body } } };
    return { ok: true, data: {} };
  });
  await note.open();
  await note.chooseBlock('D');
  note.openLocation('D.08.001');
  note.wizardField('workType', 'Inspect');
  await note.nextItems();
  note.openCardPicker();
  assert.match(element.innerHTML, /role="dialog"/);

  let prevented = false, stopped = false;
  document.dispatchEvent({ type: 'keydown', key: 'Escape', target: { outsidePicker: true }, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.doesNotMatch(element.innerHTML, /class="bn-card-picker"/);

  note.openCardPicker();
  assert.match(element.innerHTML, /onclick="if\(event\.target===this\)BunchNote\.closeCardPicker\(\)"/);
  note.closeCardPicker();
  assert.doesNotMatch(element.innerHTML, /class="bn-card-picker"/);
});

test('picker Escape preserves a draft during a busy save and ignores stale navigation or account scope', async () => {
  const rows = [{ unique_id: 'lot-busy', blockalpha: 'D', locationcode: 'D.08.001', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 12, review: 0, available: 12 }];
  let resolveSave;
  let savedBody;
  const saveGate = new Promise(resolve => { resolveSave = resolve; });
  const runtime = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') {
      savedBody = plain(request.payload.body);
      if (savedBody.locations?.some(location => location.cards?.length)) await saveGate;
      return { ok: true, data: { draft: { id: 'batch-busy', revision: 1, body: savedBody } } };
    }
    return { ok: true, data: {} };
  });
  const { BunchNote: note, element, document } = runtime;
  await note.open();
  await note.chooseBlock('D');
  note.openLocation('D.08.001');
  note.wizardField('workType', 'Inspect');
  await note.nextItems();
  note.openCardPicker();
  note.selectPickerCard('D.08.001\u001fPLANT\u001fPEONY\u001f#3');
  note.showPickerDetails();
  note.pickerField('workflow_action', 'ta');

  const saving = note.commitPickerCard();
  let prevented = false;
  document.dispatchEvent({ type: 'keydown', key: 'Escape', target: {}, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, false, 'Escape must not dismiss a picker while the card save is pending');
  assert.match(element.innerHTML, /role="dialog"/);
  assert.match(element.innerHTML, /Peony/);
  resolveSave();
  await saving;
  assert.equal(savedBody.locations[0].cards[0].row_ids[0], 'lot-busy');

  note.openCardPicker();
  runtime.setView('request');
  runtime.setActiveTab('assigned');
  document.dispatchEvent({ type: 'keydown', key: 'Escape', target: {}, preventDefault() {}, stopPropagation() {} });
  assert.match(element.innerHTML, /role="dialog"/, 'a hidden navigation context cannot close the active picker');

  runtime.setActiveTab('bunch-notes');
  runtime.setAccount('another-user');
  document.dispatchEvent({ type: 'keydown', key: 'Escape', target: {}, preventDefault() {}, stopPropagation() {} });
  assert.match(element.innerHTML, /role="dialog"/, 'an event from a stale account scope cannot mutate the picker');

  runtime.setAccount('dylan_collyge');
  runtime.setView('bunch-note');
  let currentPrevented = false;
  document.dispatchEvent({ type: 'keydown', key: 'Escape', target: {}, preventDefault() { currentPrevented = true; }, stopPropagation() {} });
  assert.equal(currentPrevented, true);
  assert.doesNotMatch(element.innerHTML, /class="bn-card-picker"/);
});

test('real DOM dismisses the picker with Escape from an outside focused control and backdrop click', async () => {
  const dom = new JSDOM('<!doctype html><div id="bunch-note-content"></div><button id="outside">Outside</button>', {
    url: 'https://fixture.test/', runScripts: 'dangerously', pretendToBeVisual: true
  });
  const { window } = dom;
  window.currentUser = 'dylan_collyge';
  window.nativeAuthSessionActive = true;
  window.nativeAuthProfile = { id: 'dylan', username: 'dylan_collyge', must_change_password: false };
  window.APP_API_FUNCTION_URL = 'https://fixture.invalid';
  window.activeReqTab = 'bunch-notes';
  window.getCurrentVisibleViewId = () => 'bunch-note';
  window.showToast = () => {};
  window.structuredClone = structuredClone;
  let visibleView = 'bunch-note';
  let activeTab = 'bunch-notes';
  let currentAccount = 'dylan_collyge';
  window.getCurrentVisibleViewId = () => visibleView;
  Object.defineProperty(window, 'currentUser', { configurable: true, get: () => currentAccount });
  Object.defineProperty(window, 'activeReqTab', { configurable: true, get: () => activeTab });
  Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: (() => { let id = 0; return () => `dom-${++id}`; })() });
  let releaseSave;
  let savedBody;
  let outsideActivated = 0;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  window.postAppFunctionJson = async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows: [{ unique_id: 'lot-dom', blockalpha: 'D', locationcode: 'D.08.001', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 12, review: 0, available: 12 }] } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') {
      savedBody = request.payload.body;
      if (savedBody.locations?.some(location => location.cards?.length)) await saveGate;
      return { ok: true, data: { draft: { id: 'batch-dom', revision: 1, body: savedBody } } };
    }
    return { ok: true, data: {} };
  };
  window.eval(read('assets/location-code.js'));
  window.eval(source);
  const note = window.BunchNote;
  await note.open();
  await note.chooseBlock('D');
  note.openLocation('D.08.001');
  note.wizardField('workType', 'Inspect');
  await note.nextItems();
  note.openCardPicker();
  note.selectPickerCard('D.08.001\u001fPLANT\u001fPEONY\u001f#3');
  note.showPickerDetails();
  note.pickerField('workflow_action', 'ta');
  note.pickerField('direction', 'North rows');
  note.pickerField('notes', 'Keep selected lots separate');
  const portalBackdrop = window.document.querySelector('.bn-picker-backdrop');
  assert.ok(portalBackdrop);
  assert.equal(portalBackdrop.parentElement.parentElement, window.document.body, 'picker overlay must escape transformed content stacking contexts');
  assert.equal(portalBackdrop.parentElement.dataset.bnPickerPortal, 'true');
  assert.equal(portalBackdrop.closest('#request-content'), null);
  const saving = note.commitPickerCard();
  const portalFields = [...window.document.querySelectorAll('.bn-picker-portal-host textarea')];
  assert.equal(portalFields.length, 3);
  assert.ok(portalFields.every(field => field.disabled), 'picker fields are disabled while its save is pending');
  note.pickerField('notes', 'This late edit must be ignored');
  assert.equal(portalFields[1].value, 'Keep selected lots separate');
  const outside = window.document.getElementById('outside');
  outside.addEventListener('click', () => { outsideActivated++; });
  outside.focus();
  assert.equal(window.document.activeElement, outside);
  const busyClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  outside.dispatchEvent(busyClick);
  assert.equal(busyClick.defaultPrevented, true, 'busy save blocks an outside navigation click');
  assert.equal(outsideActivated, 0);
  assert.ok(window.document.querySelector('.bn-card-picker'));
  const busyEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  outside.dispatchEvent(busyEscape);
  assert.equal(busyEscape.defaultPrevented, false, 'busy save cannot dismiss or discard the open picker');
  assert.ok(window.document.querySelector('.bn-card-picker'));
  releaseSave();
  await saving;
  assert.equal(savedBody.locations[0].cards[0].row_ids[0], 'lot-dom');

  note.openCardPicker();
  const clicksBeforeDismiss = outsideActivated;
  const backgroundClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  outside.dispatchEvent(backgroundClick);
  assert.equal(backgroundClick.defaultPrevented, true, 'background click should dismiss the picker and block the underlying action');
  assert.equal(outsideActivated, clicksBeforeDismiss, 'underlying navigation/action must not receive the dismiss click');
  assert.equal(window.document.querySelector('.bn-card-picker'), null);

  note.openCardPicker();
  window.document.querySelector('.bn-picker-backdrop').click();
  assert.equal(window.document.querySelector('.bn-card-picker'), null, 'clicking the backdrop dismisses the picker');
  note.openCardPicker();
  assert.ok(window.document.querySelector('.bn-picker-portal-host'));
  note.disposeView();
  assert.equal(window.document.querySelector('.bn-picker-portal-host'), null, 'navigation disposal removes the body portal');
  note.render();
  assert.equal(window.document.querySelector('.bn-card-picker'), null, 'returning to the view cannot resurrect a stale picker');
  note.openCardPicker();
  visibleView = 'request';
  activeTab = 'assigned';
  const hiddenEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  outside.dispatchEvent(hiddenEscape);
  assert.equal(hiddenEscape.defaultPrevented, false, 'hidden navigation cannot mutate the picker');
  const hiddenClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  outside.dispatchEvent(hiddenClick);
  assert.equal(hiddenClick.defaultPrevented, false, 'hidden navigation cannot dismiss the picker through the document handler');
  assert.equal(window.document.querySelector('.bn-card-picker'), null, 'a picker cannot remain portaled over another view');
  assert.equal(window.document.querySelector('.bn-picker-portal-host'), null);
  activeTab = 'bunch-notes';
  visibleView = 'bunch-note';
  note.openCardPicker();
  currentAccount = 'another-user';
  note.render();
  assert.equal(window.document.querySelector('.bn-card-picker'), null, 'account changes remove the old account picker');
  assert.equal(window.document.querySelector('.bn-picker-portal-host'), null);
  const staleAccountEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  outside.dispatchEvent(staleAccountEscape);
  assert.equal(staleAccountEscape.defaultPrevented, false, 'stale account scope cannot mutate the picker');
  const staleAccountClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  outside.dispatchEvent(staleAccountClick);
  assert.equal(staleAccountClick.defaultPrevented, false, 'stale account scope cannot dismiss the picker through the document handler');
  assert.equal(window.document.querySelector('.bn-card-picker'), null);
  note.reset();
  assert.equal(window.document.querySelector('.bn-picker-portal-host'), null, 'logout/reset removes any remaining portal host');
  dom.window.close();
});
