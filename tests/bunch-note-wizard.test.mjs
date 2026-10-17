// @test-group: bunch-notes-wizard
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const source = read('assets/bunch-note.js');

function createRuntime(postAppFunctionJson, viewId = 'bunch-note') {
  const element = { classList: { add() {} }, innerHTML: '', childNodes: [], setAttribute() {}, querySelectorAll: () => [] };
  const context = vm.createContext({
    console, Date, Map, Set, URL, Blob, Uint8Array, structuredClone, atob: globalThis.atob,
    currentUser: 'dylan_collyge', nativeAuthSessionActive: true,
    nativeAuthProfile: { id: 'dylan', username: 'dylan_collyge', must_change_password: false },
    APP_API_FUNCTION_URL: 'https://fixture.invalid', postAppFunctionJson,
    postGoogleScriptJsonPayload: async () => ({ ok: true, pdfs: [{ base64: 'JVBERi0xLjQK', filename: 'BN.pdf' }] }),
    document: { getElementById: () => element, querySelectorAll: () => [] }, activeReqTab: 'bunch-notes', getCurrentVisibleViewId: () => viewId,
    showToast() {}, crypto: { randomUUID: (() => { let id = 0; return () => `wizard-${++id}`; })() }
  });
  vm.runInContext(read('assets/location-code.js'), context);
  vm.runInContext(source, context);
  return { BunchNote: context.BunchNote, element };
}

test('Que Bunch Notes opens the same author wizard by default and preserves the assigned-work mode', async () => {
  const requests = [];
  const { BunchNote: note, element } = createRuntime(async (_url, request) => {
    requests.push(plain(request));
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'list') return { ok: true, data: { jobs: [] } };
    return { ok: true, data: {} };
  }, 'request');

  await note.open();
  assert.match(element.innerHTML, /id="bn-create-note-mode"[^>]*aria-pressed="true"/);
  assert.match(element.innerHTML, /Open block D/);
  assert.match(element.innerHTML, /id="bn-assigned-work-mode"/);

  note.setQueueMode('assigned');
  assert.match(element.innerHTML, /id="bn-assigned-work-mode"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(element.innerHTML, /Open block D/);
  note.setQueueMode('create');
  assert.match(element.innerHTML, /Open block D/);
  assert.ok(requests.some(request => request.operation === 'blocks'));
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

test('Que location selection and collapsed advanced controls do not eagerly mount the full CardBoard', async () => {
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
  }, 'request');

  await note.open({ refresh: false });
  await note.chooseBlock('D');
  assert.equal(rows.length, 1001);
  assert.doesNotMatch(element.innerHTML, /data-bn-cards/, 'the location selection step must not mount the full React CardBoard');
  assert.match(element.innerHTML, /aria-label="Open location D\.08\.001"/);
  assert.match(element.innerHTML, /aria-label="Open location D\.08\.002"/);
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
    return { ok: true, data: {} };
  }, 'bunch-note');
  await standalone.BunchNote.open({ refresh: false });
  await standalone.BunchNote.chooseBlock('D');
  assert.match(standalone.element.innerHTML, /data-bn-cards/, 'standalone authoring retains its CardBoard location workflow');
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
    if (request.operation === 'preview') return { ok: true, data: { preview: { id: 'preview-1', instruction_revision: 1 } } };
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
  note.pickerField('direction', 'Check the east row');
  note.pickerField('notes', 'Keep lots separate');
  await note.commitPickerCard();
  assert.equal(savedBody.locations[0].cards.length, 1);
  assert.deepEqual(plain(savedBody.locations[0].cards[0].row_ids), ['lot-1', 'lot-2']);
  assert.equal(savedBody.locations[0].cards[0].direction, 'Check the east row');
  assert.equal(Object.hasOwn(savedBody.locations[0].cards[0], 'notes'), false);
  assert.equal(savedBody.locations[0].actions.length, 1);
  assert.equal(savedBody.locations[0].actions[0].kind, 'instruction');
  assert.equal(savedBody.locations[0].actions[0].label, 'Card notes');
  assert.equal(savedBody.locations[0].actions[0].instructions, 'Keep lots separate');
  assert.equal(savedBody.locations[0].actions[0].card_id, savedBody.locations[0].cards[0].id);
  assert.deepEqual(plain(savedBody.locations[0].actions[0].row_ids), ['lot-1', 'lot-2']);
  assert.ok(savedBody.locations[0].actions[0].option_id);
  assert.match(element.innerHTML, /role="dialog"/);
  assert.match(element.innerHTML, /Search inventory/);
  assert.match(element.innerHTML, /Peony/);
  note.cardPickerSearch('Peony');
  assert.equal((element.innerHTML.match(/class="bn-picker-result"/g) || []).length, 1, 'the reset picker remains searchable from cached full source rows');
  assert.equal(requests.filter(request=>request.operation==='inventory').length,1,'reset and search do not fetch inventory again');
  const committedSave=requests.filter(request=>request.operation==='save').at(-1);
  assert.equal(committedSave.payload.body.locations[0].actions[0].instructions,'Keep lots separate');
  await note.backEditor();
  await note.openDraft('batch-1');
  note.openLocation('D.08.001');
  await note.nextItems();
  assert.match(element.innerHTML,/Keep lots separate/);
  await note.preview();
  const previewRequest=requests.find(request=>request.operation==='preview');
  assert.equal(previewRequest.payload.batch_id,'batch-1');
  assert.ok(savedBody.locations[0].actions.some(action=>action.label==='Card notes'&&action.instructions==='Keep lots separate'));
});

test('inventory picker pages complete local results and searches all 1000 groups without another inventory read', async () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    unique_id: `lot-${index + 1}`, blockalpha: 'D', locationcode: 'D.08.001',
    itemcode: `PLANT-${String(index + 1).padStart(4, '0')}`, commonname: `Plant ${String(index + 1).padStart(4, '0')}`,
    contsize: '#3', lotcode: `LOT-${index + 1}`, stock: 12, review: 0, available: 12
  }));
  let inventoryReads = 0;
  const { BunchNote: note, element } = createRuntime(async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') { inventoryReads += 1; return { ok: true, data: { rows } }; }
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') return { ok: true, data: { draft: { id: 'batch-test', revision: (request.expectedRevision || 0) + 1, body: request.payload.body } } };
    return { ok: true, data: {} };
  });

  await note.open();
  await note.chooseBlock('D');
  assert.doesNotMatch(element.innerHTML, /role="alert"/);
  note.openLocation('D.08.001');
  assert.doesNotMatch(element.innerHTML, /role="alert"/);
  note.wizardField('workType', 'Inspect');
  await note.nextItems();
  note.openCardPicker();
  assert.equal((element.innerHTML.match(/class="bn-picker-result"/g) || []).length, 100, element.innerHTML.slice(-1500));
  assert.match(element.innerHTML, /Showing 100 of 1000 cards/);
  assert.match(element.innerHTML, /aria-label="Load more inventory cards"/);

  note.loadMorePickerCards();
  assert.equal((element.innerHTML.match(/class="bn-picker-result"/g) || []).length, 200);
  assert.match(element.innerHTML, /Showing 200 of 1000 cards/);

  note.cardPickerSearch('Plant 1000');
  assert.equal((element.innerHTML.match(/class="bn-picker-result"/g) || []).length, 1);
  assert.match(element.innerHTML, /Plant 1000/);
  assert.match(element.innerHTML, /Showing 1 of 1 card/);
  assert.equal(inventoryReads, 1, 'pagination and search use the complete cached source rows');
});
