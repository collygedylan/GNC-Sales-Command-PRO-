import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const source = await readFile(new URL('../assets/photo-history-v2026090401.js', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../assets/app-runtime.js', import.meta.url), 'utf8');

function setup() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://agdata.invalid/', pretendToBeVisual: true });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.removeAttribute('open'); };
  dom.window.ResizeObserver = class { observe() {} disconnect() {} };
  vm.runInContext(source, vm.createContext({ window: dom.window, document: dom.window.document, URL,
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    ResizeObserver: dom.window.ResizeObserver, localStorage: dom.window.localStorage,
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' } }));
  return dom;
}

function bridge(calls) {
  return { actorKey: 'dylan_collyge', allowed: () => true, request: async operation => {
    calls.push(operation);
    if (operation === 'search') return { ok: true, photos: [{ id: 'photo-1', filename: 'rose.jpg', commonname: 'Rose', photo_at: '2026-10-01', thumbnailUrl: 'data:image/png;base64,AA==' }], hasMore: false, asOf: 'revision-1', indexedAt: '2026-10-02' };
    if (operation === 'asset') return { ok: true, thumbnail: 'data:image/png;base64,AA==' };
    if (operation === 'recipients') return { ok: true, recipients: [{ id: 'rep-1', name: 'Rep One' }] };
    if (operation === 'status') return { ok: true, shares: [] };
    if (operation === 'send') return { ok: true };
    throw new Error('Unexpected operation ' + operation);
  } };
}

test('Table Management Photo History hides and guards sharing while legacy entry retains sharing', async () => {
  assert.match(runtime, /if \(key === 'photo-history'\) return openDylanPhotoHistory\(\{ readOnly: true \}\);/);
  assert.match(runtime, /function openDylanPhotoHistory\(options = \{\}\)[^]*readOnly: options\.readOnly === true/);
  const archived = setup(), archiveCalls = [];
  await archived.window.GncPhotoHistory.open({ ...bridge(archiveCalls), readOnly: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const archiveDialog = archived.window.document.querySelector('#photo-history-dialog');
  assert.equal(archiveDialog.querySelector('#phg-tray').hidden, true);
  assert.equal(archiveDialog.querySelector('#phg-notices').hidden, true);
  assert.equal(archiveDialog.querySelectorAll('.phg-card input[type=checkbox]').length, 0);
  assert.equal(archiveDialog.querySelectorAll('.phg-card .phg-open').length, 1);
  archiveDialog.querySelector('#phg-send').click();
  assert.equal(archiveCalls.includes('recipients'), false);
  assert.equal(archiveCalls.includes('status'), false);
  assert.equal(archiveCalls.includes('send'), false, 'a direct hidden-button click is guarded too');
  archived.window.GncPhotoHistory.close(); archived.window.close();

  const legacy = setup(), legacyCalls = [];
  await legacy.window.GncPhotoHistory.open(bridge(legacyCalls));
  await new Promise(resolve => setTimeout(resolve, 0));
  const legacyDialog = legacy.window.document.querySelector('#photo-history-dialog');
  assert.equal(legacyDialog.querySelector('#phg-tray').hidden, false);
  assert.equal(legacyDialog.querySelectorAll('.phg-card input[type=checkbox]').length, 1);
  assert.ok(legacyCalls.includes('recipients'));
  const recipient = legacyDialog.querySelector('#phg-recipientId'); recipient.value = 'rep-1'; recipient.dispatchEvent(new legacy.window.Event('change'));
  const checkbox = legacyDialog.querySelector('.phg-card input[type=checkbox]'); checkbox.checked = true; checkbox.dispatchEvent(new legacy.window.Event('change'));
  legacyDialog.querySelector('#phg-send').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(legacyCalls.includes('send'), true, 'normal Photo History continues to support its existing share workflow');
  legacy.window.GncPhotoHistory.close(); legacy.window.close();
});
