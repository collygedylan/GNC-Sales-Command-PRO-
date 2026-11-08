import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const source = read('assets/bunch-note.js');
const hasCards = body => body.locations?.some(location => location.cards?.length);

function createDomFixture() {
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
  const scope = { view: 'bunch-note', tab: 'bunch-notes', account: 'dylan_collyge' };
  window.getCurrentVisibleViewId = () => scope.view;
  Object.defineProperty(window, 'currentUser', { configurable: true, get: () => scope.account });
  Object.defineProperty(window, 'activeReqTab', { configurable: true, get: () => scope.tab });
  Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: (() => { let id = 0; return () => `dom-${++id}`; })() });
  let releaseSave;
  let savedBody;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  window.postAppFunctionJson = async (_url, request) => {
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows: [{ unique_id: 'lot-dom', blockalpha: 'D', locationcode: 'D.08.001', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 12, review: 0, available: 12 }] } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') {
      savedBody = request.payload.body;
      if (hasCards(savedBody)) await saveGate;
      return { ok: true, data: { draft: { id: 'batch-dom', revision: 1, body: savedBody } } };
    }
    return { ok: true, data: {} };
  };
  window.eval(read('assets/location-code.js'));
  window.eval(source);
  return { dom, window, scope, note: window.BunchNote, releaseSave, saved: () => savedBody };
}

async function verifyPendingSave(fixture) {
  const { window, note } = fixture;
  await note.open();
  await note.chooseBlock('D');
  note.openLocation('D.08.001');
  note.wizardField('workType', 'Inspect');
  await note.nextItems();
  note.openCardPicker();
  note.selectPickerCard('D.08.001\u001fPLANT\u001fPEONY\u001f#3');
  note.showPickerDetails();
  note.pickerField('workflow_action', 'ta');
  note.wizardField('direction', 'North rows');
  note.pickerField('notes', 'Keep selected lots separate');
  const portalBackdrop = window.document.querySelector('.bn-picker-backdrop');
  assert.ok(portalBackdrop);
  assert.equal(portalBackdrop.parentElement.parentElement, window.document.body, 'picker overlay must escape transformed content stacking contexts');
  assert.equal(portalBackdrop.parentElement.dataset.bnPickerPortal, 'true');
  assert.equal(portalBackdrop.closest('#request-content'), null);
  const saving = note.commitPickerCard();
  const portalFields = [...window.document.querySelectorAll('.bn-picker-portal-host button')];
  assert.ok(portalFields.length > 0);
  assert.ok(portalFields.filter(field => field.closest('fieldset')).every(field => field.matches(':disabled')),
    'picker fields inherit the disabled save fieldset');
  note.pickerField('notes', 'This late edit must be ignored');
  assert.equal(fixture.saved().locations[0].cards[0].notes, 'Keep selected lots separate');
  const outside = window.document.getElementById('outside');
  let outsideActivated = 0;
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
  fixture.releaseSave();
  await saving;
  assert.equal(fixture.saved().locations[0].cards[0].row_ids[0], 'lot-dom');

  return { outside, activationCount: () => outsideActivated };
}

function verifyDismissal(fixture, controls) {
  const { window, note } = fixture;
  const { outside, activationCount } = controls;

  note.openCardPicker();
  const clicksBeforeDismiss = activationCount();
  const backgroundClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  outside.dispatchEvent(backgroundClick);
  assert.equal(backgroundClick.defaultPrevented, true, 'background click should dismiss the picker and block the underlying action');
  assert.equal(activationCount(), clicksBeforeDismiss, 'underlying navigation/action must not receive the dismiss click');
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
}

function verifyScopeDisposal(fixture, controls) {
  const { window, note, scope } = fixture;
  const { outside } = controls;
  note.openCardPicker();
  scope.view = 'request';
  scope.tab = 'assigned';
  const hiddenEscape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  outside.dispatchEvent(hiddenEscape);
  assert.equal(hiddenEscape.defaultPrevented, false, 'hidden navigation cannot mutate the picker');
  const hiddenClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  outside.dispatchEvent(hiddenClick);
  assert.equal(hiddenClick.defaultPrevented, false, 'hidden navigation cannot dismiss the picker through the document handler');
  assert.equal(window.document.querySelector('.bn-card-picker'), null, 'a picker cannot remain portaled over another view');
  assert.equal(window.document.querySelector('.bn-picker-portal-host'), null);
  scope.tab = 'bunch-notes';
  scope.view = 'bunch-note';
  note.openCardPicker();
  scope.account = 'another-user';
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
}

export async function assertBunchPickerDismissals() {
  const fixture = createDomFixture();
  try {
    const controls = await verifyPendingSave(fixture);
    verifyDismissal(fixture, controls);
    verifyScopeDisposal(fixture, controls);
  } finally { fixture.dom.window.close(); }
}
