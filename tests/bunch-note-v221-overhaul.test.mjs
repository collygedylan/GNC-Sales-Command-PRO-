import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: bunch-notes-v221
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

test('Bunch Notes native scrollers are excluded from delayed shell input repositioning', () => {
  const html=readComposedAppSource();
  const source=html.slice(html.indexOf('        function isMobileTextEntryPositionLocked('),html.indexOf('        function rememberMobileTextEntryScroll('));
  const context=vm.createContext({shouldUseMobileTextEntryStabilizer:()=>true, mobileTextEntryState:null, Date});
  vm.runInContext(source,context);
  for(const insideBunch of [false,true]){
    const target={closest:selector=>{assert.equal(selector,'.bn-card-picker, #bunch-note-content');return insideBunch?{}:null;}};
    context.mobileTextEntryState={target,preserveUntil:Date.now()+9000};
    assert.equal(context.isMobileTextEntryPositionLocked(target),!insideBunch);
  }
});
const rows = [
  { unique_id: 'private-lot-1', blockalpha: 'D', locationcode: 'D.05.000', itemcode: 'PLANT-A', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 12, review: 1, available: 11 },
  { unique_id: 'private-lot-2', blockalpha: 'D', locationcode: 'D.05.000', itemcode: 'PLANT-B', commonname: 'Hosta', contsize: '#2', lotcode: 'B', stock: 8, review: 0, available: 8 },
];

function runtime(options = {}) {
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
  let frozenPreviewBody = null;
  window.postAppFunctionJson = async (_url, request) => {
    requests.push(plain(request));
    if (request.operation === 'blocks') return { ok: true, data: { blocks: options.blocks || ['D'] } };
    if (request.operation === 'directory') return { ok: true, data: { users: [{ id: 'worker-1', username: 'sam', display: 'Sam' }] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: options.drafts || [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: ['D.05.000', 'D.05.001', 'G.15.001', 'H.00.031'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows: options.rows || rows } };
    if (request.operation === 'save') {
      savedBody = plain(request.payload.body);
      if (options.saveErrorOnce) {
        const message = options.saveErrorOnce;
        options.saveErrorOnce = '';
        return { ok: false, message };
      }
      return { ok: true, data: { draft: { id: 'batch-v221', revision: (request.expectedRevision || 0) + 1, body: savedBody } } };
    }
    if (request.operation === 'preview') {
      frozenPreviewBody = plain(savedBody);
      return { ok: true, data: { preview: { id: 'preview-v221', body: frozenPreviewBody, recipients: [{ email: 'dylan@example.test' }], pdfs: [] } } };
    }
    if (request.operation === 'pdf_preview') return { ok: true, data: { pdfs: [{ base64: 'JVBERi0xLjQK', filename: 'Bunch-note.pdf' }] } };
    return { ok: true, data: {} };
  };
  window.postGoogleScriptJsonPayload = async () => { throw new Error('PDF preview must use the authenticated app API'); };
  window.eval(read('assets/location-code.js'));
  window.eval(read('assets/bunch-note.js'));
  return { dom, window, note: window.BunchNote, requests, get savedBody() { return savedBody; }, get frozenPreviewBody() { return frozenPreviewBody; } };
}

async function openLocation(rt) {
  await rt.note.open();
  await rt.note.chooseBlock('D');
  rt.note.openLocation('D.05.000');
}

test('Bunch Notes focus calls never use the native scrolling default', () => {
  const source=read('assets/bunch-note.js');
  assert.doesNotMatch(source,/\.focus(?:\?\.)?\(\s*\)/);
  assert.doesNotMatch(source,/schedulePickerScrollRestore|pickerPositionGeneration/);
});

test('card picker input changes retain DOM identity, scroll and focused controls', async () => {
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
  assert.equal(rt.window.document.querySelector('.bn-card-picker'), picker);
  assert.equal(rt.window.document.querySelector('.bn-picker-results'), results);
  assert.equal(rt.window.document.querySelector('[aria-label="Select card PLANT-A Peony"]'), checkbox);
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
  assert.equal(rt.window.document.querySelector('.bn-card-picker'), details);
  assert.equal(rt.window.document.querySelector('[aria-label="Required card action"]'), action);
  assert.equal(rt.window.document.activeElement, rt.window.document.querySelector('[aria-label="Required card action"]'));
  assert.equal(rt.window.document.querySelector('.bn-card-picker').scrollTop, 180);
  rt.dom.window.close();
});

test('picker assignments and lots update in place without deferred scroll restoration', async () => {
  const rt = runtime();
  await openLocation(rt);
  await rt.note.nextItems();
  rt.note.openCardPicker();
  const win = rt.window;
  rt.note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  rt.note.showPickerDetails();
  const workspace = win.document.querySelector('#bunch-note-content');
  const heading = workspace.querySelector('h2');
  const picker = win.document.querySelector('.bn-card-picker');
  const owner = picker.querySelector('[aria-label="Assign to Sam"]');
  const lot = picker.querySelector('[aria-label^="Select lot"]');
  assert.ok(owner && lot);
  picker.scrollTop = 213;
  owner.focus({ preventScroll: true });
  rt.note.togglePickerOwner('worker-1', true);
  assert.equal(win.document.querySelector('.bn-card-picker'), picker);
  assert.equal(picker.querySelector('[aria-label="Assign to Sam"]'), owner);
  assert.equal(owner.checked, true);
  assert.equal(win.document.activeElement, owner);
  lot.focus({ preventScroll: true });
  rt.note.togglePickerLot('private-lot-1', false);
  assert.equal(picker.querySelector('[aria-label^="Select lot"]'), lot);
  assert.equal(lot.checked, false);
  assert.equal(picker.scrollTop, 213);
  assert.equal(workspace.querySelector('h2'), heading);
  assert.equal(win.document.activeElement, lot);
  const frames=[];
  win.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
  picker.scrollTop=72;
  rt.note.togglePickerLot('private-lot-1', true);
  assert.equal(frames.length,0, 'input changes need no deferred focus/scroll repair');
  assert.equal(picker.scrollTop,72);
  rt.dom.window.close();
});

test('canonical destination selection keeps the input and does not steal newer focus', async () => {
  const rt = runtime();
  await openLocation(rt);
  await rt.note.nextItems();
  rt.note.openCardPicker();
  rt.note.togglePickerCard('D.05.000\u001fPLANT-A\u001fPEONY\u001f#3', true);
  rt.note.showPickerDetails();
  rt.note.pickerField('workflow_action', 'move');
  const destination = rt.window.document.querySelector('[aria-label="Move destination"]');
  assert.ok(destination);
  destination.focus();
  rt.note.pickerField('destination_search', 'D.05.');
  const action=rt.window.document.querySelector('[aria-label="Required card action"]');
  action.focus({preventScroll:true});
  rt.note.pickCardDestination('D.05.');
  assert.equal(rt.window.document.querySelector('[aria-label="Move destination"]'),destination);
  assert.equal(rt.window.document.activeElement, action);
  rt.dom.window.close();
});

test('reopening and saving an existing Move card preserves qualifier and instructions in the frozen preview', async () => {
  const rt = runtime();
  await openLocation(rt);
  rt.note.wizardField('workType', 'Inspect');
  await rt.note.nextItems();
  rt.note.openCardPicker();
  const cardKey = 'D.05.000\u001fPLANT-A\u001fPEONY\u001f#3';
  rt.note.togglePickerCard(cardKey, true);
  rt.note.showPickerDetails();
  rt.note.pickerField('workflow_action', 'move');
  rt.note.pickerField('destination_search', 'D.05.');
  rt.note.pickCardDestination('D.05.');
  rt.note.pickerField('destination_qualifier', 'South House staging row');
  rt.note.pickerField('workflow_instructions', 'Keep this lot with the south crew');
  await rt.note.commitPickerCard();
  assert.equal(rt.savedBody.locations[0].cards[0].destination_qualifier, 'South House staging row');
  assert.equal(rt.savedBody.locations[0].cards[0].workflow_instructions, 'Keep this lot with the south crew');

  rt.note.togglePickerCard(cardKey, true);
  rt.note.showPickerDetails();
  assert.equal(rt.window.document.querySelector('[aria-label="Required card action"]').value, 'move');
  assert.equal(rt.window.document.querySelector('[aria-label="Destination qualifier"]').value, 'South House staging row');
  assert.equal(rt.window.document.querySelector('[data-bn-focus-key="field:Workflow instructions"]').value, 'Keep this lot with the south crew');
  await rt.note.commitPickerCard();
  await rt.note.preview();

  const saved = rt.savedBody.locations[0].cards[0];
  assert.equal(saved.destination_qualifier, 'South House staging row');
  assert.equal(saved.workflow_instructions, 'Keep this lot with the south crew');
  assert.deepEqual(plain(rt.frozenPreviewBody.locations[0].cards[0]), plain(saved));
  const saveIndexes = rt.requests.map((request, index) => request.operation === 'save' ? index : -1).filter(index => index >= 0);
  const previewIndex = rt.requests.findIndex(request => request.operation === 'preview');
  assert.ok(saveIndexes.at(-1) < previewIndex, 'the frozen preview is requested only after the latest preserved card save');
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

test('email recipient panel is immutable and Dylan-only', async () => {
  const rt=runtime();
  rt.window.postAppFunctionJson=new Proxy(rt.window.postAppFunctionJson,{apply(target,thisArg,args){
    if(args[1]?.operation==='directory')return Promise.resolve({ok:true,data:{users:[{id:'worker-1',username:'sam',display:'Sam',email:'sam@example.test'}]}});
    return Reflect.apply(target,thisArg,args);
  }});
  await rt.note.open();
  await rt.note.chooseBlock('D');
  const main=rt.window.document.querySelector('#bunch-note-content');
  assert.match(main.textContent,/Dylan Collyge only/);
  assert.match(main.textContent,/Assignees receive work in the app, not by email/);
  assert.equal(main.querySelector('[aria-label="Email recipient Sam"]'),null);
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

test('header save canonicalizes dotted locations, derives block, bounds multiline text, and clears stale errors', async () => {
  const rt = runtime({ saveErrorOnce: 'BUNCH_NOTE_HEADER_INVALID' });
  await rt.note.open();
  await rt.note.chooseBlock('I.');
  rt.note.openLocation('I.07.');
  rt.note.wizardField('workType', 'LOC. Bunch Notes');
  rt.note.wizardField('purpose_thread', 'Early Winter Protect');
  rt.note.wizardField('direction', 'East → West');
  rt.note.wizardField('default_house_plan', 'Bunch West & Center, Spread Space, or custom plan');
  rt.note.wizardField('schedule_banner', ` First line\r\n${'alert '.repeat(500)} `);
  rt.note.wizardField('notes', ` Extra notes\r\n${'detail '.repeat(1500)} `);
  assert.equal(rt.window.document.querySelector('.bn-location-editor h3')?.textContent, 'Plan work · I · I.07');
  await rt.note.nextItems();
  assert.match(rt.window.document.querySelector('[role="alert"]')?.textContent || '', /BUNCH_NOTE_HEADER_INVALID/);
  rt.note.wizardField('default_house_plan', '');
  assert.equal(rt.window.document.querySelector('[role="alert"]'), null, 'editing clears the stale header error immediately');
  await rt.note.nextItems();
  assert.equal(rt.savedBody.block, 'I');
  assert.equal(rt.savedBody.locations[0].location, 'I.07.000');
  assert.equal(rt.savedBody.locations[0].source_location, 'I.07.000');
  assert.equal(rt.savedBody.locations[0].work_type, 'LOC. Bunch Notes');
  assert.equal(rt.savedBody.locations[0].purpose_thread, 'Early Winter Protect');
  assert.equal(rt.savedBody.locations[0].direction, 'East → West');
  assert.equal(rt.savedBody.locations[0].default_house_plan, '');
  assert.equal(rt.savedBody.locations[0].schedule_banner.length, 2000);
  assert.equal(rt.savedBody.locations[0].instructions.length, 8000);
  assert.match(rt.savedBody.locations[0].schedule_banner, /^First line\n/);
  rt.dom.window.close();
});

test('app API normalizes Bunch Note save payloads before the database command', () => {
  const source = read('supabase/functions/app-api/index.ts');
  assert.match(source, /function normalizeBunchNoteSavePayload/);
  assert.match(source, /operation === "save" \? normalizeBunchNoteSavePayload\(payload\.payload\)/);
  assert.match(source, /forceBunchNoteDylanRecipient\(normalizedPayload, String\(dylanRecipient\.id\), operation\)/);
  assert.match(source, /source_location: location, format_version: 5/);
});

test('F.05 and F.05.000 share one durable local draft across reset and surface draft badges', async () => {
  const f05Rows = [{ ...rows[0], unique_id: 'f05-lot', blockalpha: 'F', locationcode: 'F.05.000' }];
  const rt = runtime({ blocks: ['F'], rows: f05Rows });
  await rt.note.open();
  await rt.note.chooseBlock('F');
  rt.note.openLocation('F.05');
  rt.note.wizardField('workType', 'F.05 Bunch Notes');
  rt.note.wizardField('notes', 'Keep the saved F.05 plan');
  assert.equal(rt.note.normalizeBunchNoteLocationKey('F.05'), rt.note.normalizeBunchNoteLocationKey('F.05.000'));
  rt.note.reset();
  await rt.note.open();
  const root = rt.window.document.querySelector('#bunch-note-content');
  assert.match(root.textContent, /Saved Drafts \/ Active Bunch Notes/);
  assert.match(root.textContent, /F\.05\.000 \(Draft\)/);
  assert.match(root.textContent, /Block Alpha DRAFT/);
  await rt.note.chooseBlock('F');
  assert.match(root.textContent, /Location Code DRAFT/);
  rt.note.openLocation('F.05.000');
  assert.match(root.textContent, /Plan work · F · F\.05/);
  assert.equal(root.querySelector('[data-bn-field="Work type"] input').value, 'F.05 Bunch Notes');
  assert.match(rt.window.localStorage.getItem('gnc_bunch_note_drafts_v1') || '', /F\.05\.000/);
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
  const panel = [...content.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent.includes('Dylan Collyge only'));
  assert.match(panel.textContent, /Bunch Notes email delivery is locked to Dylan Collyge/);
  assert.equal(panel.querySelector('input[type="checkbox"]'),null);
  rt.dom.window.close();
});

test('recipient repaint cannot add an optional email recipient', async () => {
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

  const panel = [...rt.window.document.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent.includes('Dylan Collyge only'));
  assert.ok(panel);
  const main = rt.window.document.getElementById('main-scroll-area');
  main.scrollTop = 137;
  rt.note.recipient('optional', true);
  rt.note.render();

  const repaintedPanel = [...rt.window.document.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent.includes('Dylan Collyge only'));
  assert.equal(repaintedPanel.querySelector('input[onchange*="optional"]'),null);
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
