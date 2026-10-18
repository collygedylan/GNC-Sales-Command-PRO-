// @test-group: bunch-notes-v221
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const rows = [
  { unique_id: 'private-lot-1', blockalpha: 'D', locationcode: 'D.05.000', itemcode: 'PLANT-A', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 12, review: 1, available: 11 },
  { unique_id: 'private-lot-2', blockalpha: 'D', locationcode: 'D.05.000', itemcode: 'PLANT-B', commonname: 'Hosta', contsize: '#2', lotcode: 'B', stock: 8, review: 0, available: 8 },
];

function runtime() {
  const dom = new JSDOM('<!doctype html><main id="main-scroll-area"><div id="bunch-note-content"></div></main>', {
    url: 'https://fixture.test/', runScripts: 'dangerously', pretendToBeVisual: true,
  });
  const { window } = dom;
  const originalConsoleError = window.console.error.bind(window.console);
  window.console.error = (...args) => { if (!String(args[0] || '').includes('ERR_UNSUPPORTED_ESM_URL_SCHEME')) originalConsoleError(...args); };
  window.currentUser = 'dylan_collyge';
  window.nativeAuthSessionActive = true;
  window.nativeAuthAccessToken = 'fixture-token';
  window.nativeAuthProfile = { id: 'dylan', username: 'dylan_collyge', must_change_password: false };
  window.APP_API_FUNCTION_URL = 'https://fixture.invalid';
  window.APP_SHELL_BUILD = 'test';
  window.REQUEST_EMAIL_SCRIPT_TIMEOUT_MS = 45000;
  window.getCurrentVisibleViewId = () => 'bunch-note';
  window.getMainAreaScrollTop = () => window.document.getElementById('main-scroll-area').scrollTop;
  window.setMainAreaScrollTop = value => { window.document.getElementById('main-scroll-area').scrollTop = value; };
  window.showToast = () => {};
  window.switchView = () => {};
  window.structuredClone = structuredClone;
  window.URL.createObjectURL = () => 'blob:fixture';
  window.URL.revokeObjectURL = () => {};
  Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: (() => { let id = 0; return () => `v221-${++id}`; })() });
  const requests = [];
  let savedBody = null;
  window.postAppFunctionJson = async (_url, request) => {
    requests.push(plain(request));
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'directory') return { ok: true, data: { users: [{ id: 'worker-1', username: 'sam', display: 'Sam' }] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: ['D.05.000', 'D.05.001', 'G.15.001', 'H.00.031'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows } };
    if (request.operation === 'save') {
      savedBody = plain(request.payload.body);
      return { ok: true, data: { draft: { id: 'batch-v221', revision: (request.expectedRevision || 0) + 1, body: savedBody } } };
    }
    if (request.operation === 'preview') return { ok: true, data: { preview: { id: 'preview-v221', recipients: [{ email: 'dylan@example.test' }], pdfs: [] } } };
    return { ok: true, data: {} };
  };
  window.postGoogleScriptJsonPayload = async () => ({ ok: true, pdfs: [{ base64: 'JVBERi0xLjQK', filename: 'Bunch-note.pdf' }] });
  window.eval(read('assets/location-code.js'));
  window.eval(read('assets/bunch-note.js'));
  return { dom, window, note: window.BunchNote, requests, get savedBody() { return savedBody; } };
}

async function openLocation(rt) {
  await rt.note.open();
  await rt.note.chooseBlock('D');
  rt.note.openLocation('D.05.000');
}

test('card picker rerenders retain its scroll position and focused checkbox/action control', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  rt.note.openCardPicker();
  const picker = rt.window.document.querySelector('.bn-card-picker');
  const results = rt.window.document.querySelector('.bn-picker-results');
  picker.scrollTop = 213;
  results.scrollTop = 97;
  let checkbox = rt.window.document.querySelector('[aria-label="Select card PLANT-A Peony"]');
  checkbox.focus();
  rt.note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  assert.equal(rt.window.document.querySelector('.bn-card-picker').scrollTop, 213);
  assert.equal(rt.window.document.querySelector('.bn-picker-results').scrollTop, 97);
  checkbox = rt.window.document.querySelector('[aria-label="Select card PLANT-A Peony"]');
  assert.equal(rt.window.document.activeElement, checkbox);

  rt.note.showPickerDetails();
  const action = rt.window.document.querySelector('[aria-label="Required card action"]');
  action.focus();
  const details = rt.window.document.querySelector('.bn-card-picker');
  details.scrollTop = 180;
  rt.note.pickerField('workflow_action', 'move');
  assert.equal(rt.window.document.activeElement, rt.window.document.querySelector('[aria-label="Required card action"]'));
  assert.equal(rt.window.document.querySelector('.bn-card-picker').scrollTop, 180);
  rt.dom.window.close();
});

test('canonical destination selection rerender restores the focused destination input', async () => {
  const rt = runtime();
  await openLocation(rt);
  await rt.note.nextItems();
  rt.note.openCardPicker();
  rt.note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  rt.note.showPickerDetails();
  rt.note.pickerField('workflow_action', 'move');
  let destination = rt.window.document.querySelector('[aria-label="Move destination"]');
  assert.ok(destination);
  destination.focus();
  rt.note.pickerField('destination_search', 'D.05.');
  // A native datalist choice may blur its text input before dispatching change.
  destination.blur();
  rt.note.pickCardDestination('D.05.');
  destination = rt.window.document.querySelector('[aria-label="Move destination"]');
  assert.equal(rt.window.document.activeElement, destination);
  rt.dom.window.close();
});

test('header-only location can save and open PDF preview with no inventory cards', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.wizardField('workType', 'D.05. Whole-house notes');
  await rt.note.nextItems();
  const save = [...rt.window.document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Save draft');
  assert.ok(save && !save.disabled, 'header-only location save remains enabled');
  await rt.note.save();
  assert.equal(rt.savedBody.locations[0].cards.length, 0);
  await rt.note.preview();
  assert.ok(rt.requests.some(request => request.operation === 'preview'));
  assert.match(rt.window.document.querySelector('#bunch-note-content').textContent, /Review Inv Bunch Notes PDFs/);
  rt.dom.window.close();
});

test('divider-only locations persist an empty row identity list instead of null', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.insertDivider('D.05.000', 'Crew change');
  await rt.note.save();
  assert.deepEqual(rt.savedBody.locations[0].cards, [{
    id: 'v221-1', kind: 'divider', text: 'Crew change', left_margin: '',
  }]);
  assert.deepEqual(plain(rt.savedBody.locations[0].row_ids), []);
  rt.dom.window.close();
});

test('divider rows expose and persist the optional left-margin callout', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  rt.note.insertDivider('D.05.000', 'Crew change');
  const dividerId = rt.window.document.querySelector('.bn-sequence-divider')?.dataset.sequenceId;
  const margin = rt.window.document.querySelector('[aria-label="Divider left-margin tag"]');
  assert.ok(margin, 'divider has an editable optional left-margin callout');
  margin.value = 'any row';
  margin.dispatchEvent(new rt.window.Event('input', { bubbles: true }));
  await rt.note.save();
  assert.deepEqual(plain(rt.savedBody.locations[0].cards), [{
    id: dividerId, kind: 'divider', text: 'Crew change', left_margin: 'any row',
  }]);
  assert.deepEqual(plain(rt.savedBody.locations[0].row_ids), []);
  rt.dom.window.close();
});

test('header blueprint persists purpose, plan, banner, direction, and quick rule text', async () => {
  const rt = runtime();
  await openLocation(rt);
  assert.match(rt.window.document.querySelector('#bunch-note-content').textContent, /Purpose|Sequence Thread/);
  assert.match(rt.window.document.querySelector('#bunch-note-content').textContent, /Default House Plan/);
  assert.match(rt.window.document.querySelector('#bunch-note-content').textContent, /Schedule|Prerequisite Alert/);
  assert.match(rt.window.document.querySelector('#bunch-note-content').textContent, /Keep countable rows/);
  rt.note.wizardField('purpose_thread', 'Early Winter Protect');
  rt.note.wizardField('default_house_plan', 'Bunch West & Center');
  rt.note.wizardField('schedule_banner', 'Complete reconsolidation first');
  rt.note.wizardField('direction', 'South → North');
  rt.note.insertRuleChip('Keep countable rows, leave aisles between varieties, risers, & doors');
  await rt.note.nextItems();
  assert.equal(rt.savedBody.locations[0].purpose_thread, 'Early Winter Protect');
  assert.equal(rt.savedBody.locations[0].default_house_plan, 'Bunch West & Center');
  assert.equal(rt.savedBody.locations[0].schedule_banner, 'Complete reconsolidation first');
  assert.equal(rt.savedBody.locations[0].direction, 'South → North');
  assert.deepEqual(rt.savedBody.locations[0].rule_chips, ['Keep countable rows, leave aisles between varieties, risers, & doors']);
  assert.match(rt.savedBody.locations[0].instructions, /Keep countable rows/);
  rt.dom.window.close();
});

test('editable Work Type title and Purpose thread persist independently through save and preview', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.wizardField('workType', 'D.05. Inspect whole block');
  rt.note.wizardField('purpose_thread', 'Early Winter Protect');
  await rt.note.nextItems();
  await rt.note.preview();
  const saved = rt.savedBody.locations[0];
  assert.equal(saved.work_type, 'D.05. Inspect whole block');
  assert.equal(saved.purposes, 'D.05. Inspect whole block', 'legacy title field is synchronized with editable Work Type');
  assert.equal(saved.purpose_thread, 'Early Winter Protect');
  assert.ok(rt.requests.some(request => request.operation === 'preview' && request.payload.batch_id === 'batch-v221'));
  assert.match(rt.window.document.querySelector('#bunch-note-content').textContent, /Review Inv Bunch Notes PDFs/);
  rt.dom.window.close();
});

test('Move destinations show unique truncated bases and preserve canonical destination plus qualifier', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  rt.note.openCardPicker();
  rt.note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  rt.note.showPickerDetails();
  rt.note.pickerField('workflow_action', 'move');
  const destinationOptions = [...rt.window.document.querySelectorAll('#bn-picker-destinations option')].map(option => option.value);
  assert.deepEqual(destinationOptions, ['D.05.', 'G.15.', 'H.00.']);
  assert.equal(rt.window.document.querySelector('[aria-label="Full destination location"]'), null, 'preferred .000 needs no extra choice');
  rt.note.pickCardDestination('D.05.', 'North House');
  rt.note.pickerField('notes', 'Leave aisle clear');
  await rt.note.commitPickerCard();
  const card = rt.savedBody.locations[0].cards[0];
  assert.equal(card.destination_location, 'D.05.000');
  assert.equal(card.destination_qualifier, 'North House');
  rt.dom.window.close();
});

test('sequential list hides source UIDs, supports divider, reorder and bulk note edits', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  rt.note.openCardPicker();
  rt.note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  rt.note.showPickerDetails();
  rt.note.pickerField('workflow_action', '');
  await rt.note.commitPickerCard();
  const first = rt.savedBody.locations[0].cards[0];
  assert.ok(first);
  rt.note.openCardPicker();
  rt.note.togglePickerCard('D.05.000\u001fPLANT-B\u001fHOSTA\u001f#2', true);
  rt.note.showPickerDetails();
  await rt.note.commitPickerCard();
  const second = rt.savedBody.locations[0].cards.find(card => card.itemcode === 'PLANT-B');
  rt.note.insertDivider('D.05.000', '-------- DITCH --------');
  rt.note.reorderCard('D.05.000', second.id, -1);
  rt.note.toggleSequenceCard('D.05.000', first.id, true);
  rt.note.toggleSequenceCard('D.05.000', second.id, true);
  rt.note.bulkUpdateCards('notes_append', 'Leave one row off for drape plastic');
  const saved = rt.savedBody.locations[0].cards;
  assert.equal(saved[0].id, second.id);
  assert.equal(saved[2].kind, 'divider');
  assert.equal(saved[2].text, '-------- DITCH --------');
  assert.ok(saved.filter(card => card.kind === 'inventory').every(card => card.notes.includes('Leave one row off for drape plastic')));
  const text = rt.window.document.querySelector('#bunch-note-content').textContent;
  assert.doesNotMatch(text, /private-lot-1|private-lot-2/);
  rt.dom.window.close();
});

test('advanced actions, multi-user assignment, and workflow instructions persist separately from notes', async () => {
  const rt = runtime();
  rt.window.postAppFunctionJson = new Proxy(rt.window.postAppFunctionJson, { apply(target, thisArg, args) { if (args[1]?.operation === 'directory') return Promise.resolve({ ok: true, data: { users: [{ id: 'worker-1', username: 'sam', display: 'Sam' }, { id: 'worker-2', username: 'rhett', display: 'Rhett' }] } }); return Reflect.apply(target, thisArg, args); } });
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  rt.note.openCardPicker();
  rt.note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  rt.note.showPickerDetails();
  rt.note.togglePickerOwner('worker-1', true);
  rt.note.togglePickerOwner('worker-2', true);
  rt.note.pickerField('workflow_action', 'compound');
  rt.note.pickerField('notes', 'Visible row note');
  rt.note.pickerField('workflow_instructions', 'Move then bunch after QC');
  await rt.note.commitPickerCard();
  const card = rt.savedBody.locations[0].cards[0];
  assert.deepEqual(card.owner_ids, ['worker-1', 'worker-2']);
  assert.equal(card.workflow_action, 'compound');
  assert.equal(card.notes, 'Visible row note');
  assert.equal(card.workflow_instructions, 'Move then bunch after QC');
  rt.dom.window.close();
});

async function addSequentialCard(rt, key, { action = '', destination = '', notes = '', owners = [] } = {}) {
  rt.note.openCardPicker();
  rt.note.togglePickerCard(key, true);
  rt.note.showPickerDetails();
  rt.note.pickerField('workflow_action', action);
  if (destination) rt.note.pickCardDestination(destination);
  rt.note.pickerField('notes', notes);
  for (const owner of owners) rt.note.togglePickerOwner(owner, true);
  await rt.note.commitPickerCard();
}

test('sequential editor exposes divider reordering and a scannable card summary', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  await addSequentialCard(rt, 'D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', { action: 'move', destination: 'D.05.' , notes: 'Keep this row together' });
  const location = 'D.05.000';
  const card = rt.savedBody.locations[0].cards[0];
  rt.note.editCard(location, card.id, 'left_margin', 'QC');
  rt.note.insertDivider(location, 'Crew change');
  rt.note.closeCardPicker();
  const content = rt.window.document.querySelector('#bunch-note-content');
  assert.match(content.querySelector('.bn-sequence-summary')?.textContent || '', /\[QC\].*\[#3\].*\[Peony\].*Move.*D\.05\..*Keep this row together/s);
  const divider = content.querySelector('.bn-sequence-divider');
  assert.ok(divider.querySelector('[aria-label="Move divider up"]'));
  divider.querySelector('[aria-label="Move divider up"]').click();
  assert.equal(rt.window.document.querySelector('.bn-sequence').firstElementChild.className, 'bn-sequence-divider');
  rt.window.document.querySelector('.bn-sequence-divider [aria-label="Move divider down"]').click();
  assert.equal(rt.window.document.querySelector('.bn-sequence').firstElementChild.className, 'bn-sequence-card');
  rt.dom.window.close();
});

test('bulk values and assignments survive action rerender; inline action reveals its destination', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  await addSequentialCard(rt, 'D.05.000\u001fPLANT-A\u001fPEONY\u001f#3');
  rt.note.closeCardPicker();
  const card = rt.savedBody.locations[0].cards[0];
  let content = rt.window.document.querySelector('#bunch-note-content');
  const inlineAction = content.querySelector(`[aria-label="Action for PLANT-A"]`);
  inlineAction.value = 'move';
  inlineAction.dispatchEvent(new rt.window.Event('change', { bubbles: true }));
  content = rt.window.document.querySelector('#bunch-note-content');
  assert.ok(content.querySelector('[aria-label="Move destination for PLANT-A"]'), 'Move choice immediately reveals its destination input');

  content.querySelector('[aria-label="Select PLANT-A for bulk edit"]').click();
  content = rt.window.document.querySelector('#bunch-note-content');
  let owners = content.querySelector('[aria-label="Bulk assigned users"]');
  owners.options[0].selected = true;
  owners.dispatchEvent(new rt.window.Event('change', { bubbles: true }));
  content.querySelector('[aria-label="Bulk left-margin tag"]').value = 'Brandt';
  content.querySelector('[aria-label="Bulk left-margin tag"]').dispatchEvent(new rt.window.Event('input', { bubbles: true }));
  content.querySelector('[aria-label="Append bulk card notes"]').value = 'Keep west row clear';
  content.querySelector('[aria-label="Append bulk card notes"]').dispatchEvent(new rt.window.Event('input', { bubbles: true }));
  content.querySelector('[aria-label="Bulk card action"]').value = 'bunch';
  content.querySelector('[aria-label="Bulk card action"]').dispatchEvent(new rt.window.Event('change', { bubbles: true }));
  content = rt.window.document.querySelector('#bunch-note-content');
  content.querySelector('[aria-label="Bulk Bunch house"]').value = 'North House';
  content.querySelector('[aria-label="Bulk Bunch house"]').dispatchEvent(new rt.window.Event('change', { bubbles: true }));
  content = rt.window.document.querySelector('#bunch-note-content');
  owners = content.querySelector('[aria-label="Bulk assigned users"]');
  assert.equal(owners.options[0].selected, true);
  assert.equal(content.querySelector('[aria-label="Bulk left-margin tag"]').value, 'Brandt');
  assert.equal(content.querySelector('[aria-label="Append bulk card notes"]').value, 'Keep west row clear');
  rt.note.applyBulk();
  await rt.note.save();
  const saved = rt.savedBody.locations[0].cards.find(item => item.id === card.id);
  assert.deepEqual(saved.owner_ids, ['worker-1']);
  assert.equal(saved.workflow_action, 'bunch');
  assert.equal(saved.left_margin, 'Brandt');
  assert.equal(saved.notes, 'Keep west row clear');
  rt.dom.window.close();
});

test('Move destinations prefer exact .000 and require explicit full code when no default exists', async () => {
  const rt = runtime();
  rt.window.postAppFunctionJson = new Proxy(rt.window.postAppFunctionJson, { apply(target, thisArg, args) {
    if (args[1]?.operation === 'catalog') return Promise.resolve({ ok: true, data: { options: [], locations: ['D.05.001', 'D.05.000', 'G.15.001', 'H.00.031'] } });
    return Reflect.apply(target, thisArg, args);
  } });
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  rt.note.openCardPicker();
  rt.note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  rt.note.showPickerDetails();
  rt.note.pickerField('workflow_action', 'move');
  rt.note.pickCardDestination('D.05.');
  await rt.note.commitPickerCard();
  assert.equal(rt.savedBody.locations[0].cards[0].destination_location, 'D.05.000');
  rt.dom.window.close();

  const ambiguous = runtime();
  ambiguous.window.postAppFunctionJson = new Proxy(ambiguous.window.postAppFunctionJson, { apply(target, thisArg, args) {
    if (args[1]?.operation === 'catalog') return Promise.resolve({ ok: true, data: { options: [], locations: ['D.05.002', 'D.05.001'] } });
    return Reflect.apply(target, thisArg, args);
  } });
  await openLocation(ambiguous);
  ambiguous.note.wizardField('workType', 'Inspect');
  await ambiguous.note.nextItems();
  ambiguous.note.openCardPicker();
  ambiguous.note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  ambiguous.note.showPickerDetails();
  ambiguous.note.pickerField('workflow_action', 'move');
  let destination = ambiguous.window.document.querySelector('[aria-label="Move destination"]');
  destination.value = 'D.05.';
  destination.dispatchEvent(new ambiguous.window.Event('input', { bubbles: true }));
  destination.dispatchEvent(new ambiguous.window.Event('change', { bubbles: true }));
  const fullCode = ambiguous.window.document.querySelector('[aria-label="Full destination location"]');
  assert.ok(fullCode, 'ambiguous truncated destination requires a canonical full-code choice');
  fullCode.value = 'D.05.002';
  fullCode.dispatchEvent(new ambiguous.window.Event('change', { bubbles: true }));
  await ambiguous.note.commitPickerCard();
  assert.equal(ambiguous.savedBody.locations[0].cards[0].destination_location, 'D.05.002');
  ambiguous.dom.window.close();
});

test('reopening Move resolves an unchanged verified destination display after action changes', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  rt.note.openCardPicker();
  rt.note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  rt.note.showPickerDetails();
  rt.note.pickerField('workflow_action', 'move');
  rt.note.pickerField('destination_search', 'D.05.');
  // The datalist's native change event may not fire when the same display value
  // is restored after action changes; Move selection must resolve it safely.
  rt.note.pickerField('workflow_action', 'bunch');
  rt.note.pickerField('destination_house', 'North House');
  rt.note.pickerField('workflow_action', 'ta');
  rt.note.pickerField('workflow_action', 'move');
  // Re-entering the identical display value may emit `input` without a native
  // `change`; the live full-code choice must remain valid in that case.
  rt.note.pickerField('destination_search', 'D.05.');
  await rt.note.commitPickerCard();
  assert.equal(rt.savedBody.locations[0].cards[0].destination_location, 'D.05.000');
  rt.dom.window.close();
});

test('opening advanced inventory controls restores the focused summary and main scroll', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  const main = rt.window.document.querySelector('#main-scroll-area');
  main.scrollTop = 137;
  const summary = rt.window.document.querySelector('.bn-wizard-items > details > summary');
  summary.focus();
  rt.note.advancedInventoryPanel('D.05.000', true);
  assert.equal(main.scrollTop, 137);
  assert.equal(rt.window.document.activeElement, rt.window.document.querySelector('.bn-wizard-items > details > summary'));
  assert.equal(rt.window.document.querySelector('.bn-wizard-items > details').open, true);
  rt.dom.window.close();
});

test('header recipient panel shows server-required defaults and assigned workers as locked', async () => {
  const rt = runtime();
  const directory = [
    { id: 'dylan', username: 'dylan_collyge', display: 'Dylan', email: 'dylan@example.test' },
    { id: 'megan', username: 'megan_kelly', display: 'Megan', email: 'megan@example.test' },
    { id: 'sharon', username: 'sharon_combs', display: 'Sharon', email: 'sharon@example.test' },
    { id: 'worker-1', username: 'sam', display: 'Sam', email: 'sam@example.test' },
    { id: 'legacy-owner', username: 'legacy_worker', display: 'Legacy Worker', email: 'legacy@example.test' },
    { id: 'optional', username: 'optional_user', display: 'Optional', email: 'optional@example.test' },
  ];
  rt.window.postAppFunctionJson = new Proxy(rt.window.postAppFunctionJson, { apply(target, thisArg, args) {
    if (args[1]?.operation === 'directory') return Promise.resolve({ ok: true, data: { users: directory } });
    return Reflect.apply(target, thisArg, args);
  } });
  await openLocation(rt);
  rt.note.edit(0, 'owner_id', 'legacy-owner');
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  await addSequentialCard(rt, 'D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', { owners: ['worker-1'] });
  rt.note.backLocations();
  const content = rt.window.document.querySelector('#bunch-note-content');
  const panel = [...content.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent.includes('Email recipients'));
  assert.match(panel.textContent, /Always included by the server: Dylan Collyge, Megan Kelly, Sharon Combs, Sam, Legacy Worker/);
  for (const id of ['dylan', 'megan', 'sharon', 'worker-1', 'legacy-owner']) {
    const checkbox = panel.querySelector(`input[onchange*="${id}"]`);
    assert.ok(checkbox?.checked, `${id} is visibly included`);
    assert.ok(checkbox.disabled, `${id} is server-required`);
  }
  const optional = panel.querySelector('input[onchange*="optional"]');
  assert.equal(optional.checked, false);
  assert.equal(optional.disabled, false);
  assert.match(panel.textContent, /recipient email addresses are resolved by the server/);
  rt.dom.window.close();
});

test('recipient checkbox keeps focus and main scroll after a live repaint', async () => {
  const rt = runtime();
  rt.window.postAppFunctionJson = new Proxy(rt.window.postAppFunctionJson, { apply(target, thisArg, args) {
    if (args[1]?.operation === 'directory') return Promise.resolve({ ok: true, data: { users: [
      { id: 'dylan', username: 'dylan_collyge', display: 'Dylan', email: 'dylan@example.test' },
      { id: 'optional', username: 'optional_user', display: 'Optional', email: 'optional@example.test' },
    ] } });
    return Reflect.apply(target, thisArg, args);
  } });
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  rt.note.backLocations();

  const panel = [...rt.window.document.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent.includes('Email recipients'));
  const checkbox = panel.querySelector('input[onchange*="optional"]');
  assert.ok(checkbox);
  const main = rt.window.document.getElementById('main-scroll-area');
  main.scrollTop = 137;
  checkbox.focus();
  rt.note.recipient('optional', true);
  rt.note.render();

  const repaintedPanel = [...rt.window.document.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent.includes('Email recipients'));
  const repainted = repaintedPanel.querySelector('input[onchange*="optional"]');
  assert.equal(repainted.checked, true);
  assert.equal(rt.window.document.activeElement, repainted);
  assert.equal(main.scrollTop, 137);
  rt.dom.window.close();
});

test('selected legacy choices keep their copied snapshot through a catalog refresh', async () => {
  const rt = runtime();
  let catalogOption = { id: 'copied-option', category: 'inventory', label: 'Original copied label', instructions: 'Original copied instructions', kind: 'instruction', active: true, revision: 1 };
  rt.window.postAppFunctionJson = new Proxy(rt.window.postAppFunctionJson, { apply(target, thisArg, args) {
    if (args[1]?.operation === 'catalog') return Promise.resolve({ ok: true, data: { options: [catalogOption], locations: ['D.05.000'] } });
    if (args[1]?.operation === 'option_edit') { catalogOption = { ...catalogOption, label: args[1].payload.label, instructions: args[1].payload.label, revision: 2 }; return Promise.resolve({ ok: true, data: {} }); }
    return Reflect.apply(target, thisArg, args);
  } });
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  rt.note.advancedInventoryPanel('D.05.000', true);
  rt.note.openItem('D.05.000|PLANT-A');
  rt.note.selectItem(0, ['private-lot-1'], true, false);
  const key = 'item:0:D.05.000|PLANT-A';
  rt.note.startAction(key, 'copied-option');
  assert.match(rt.window.document.querySelector('#bunch-note-content').textContent, /Original copied label/);
  await rt.note.finishAction();
  await rt.note.backEditor();
  rt.window.document.getElementById('bn-option-copied-option').value = 'Changed current catalog label';
  await rt.note.editOption('copied-option', true);
  await rt.note.chooseBlock('D');
  rt.note.openLocation('D.05.000');
  await rt.note.nextItems();
  rt.note.advancedInventoryPanel('D.05.000', true);
  rt.note.openItem('D.05.000|PLANT-A');
  rt.note.selectItem(0, ['private-lot-1'], true, false);
  rt.note.startAction(key, 'copied-option');
  assert.match(rt.window.document.querySelector('#bunch-note-content').textContent, /Original copied label/);
  await rt.note.finishAction();
  await rt.note.save();
  assert.equal(rt.savedBody.locations[0].actions[0].label, 'Original copied label');
  assert.equal(rt.savedBody.locations[0].actions[0].instructions, 'Original copied instructions');
  assert.equal(rt.savedBody.locations[0].actions[0].kind, 'instruction');
  rt.dom.window.close();
});
