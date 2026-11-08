import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fixtureTimers } from '../services/fixture-timers.mjs';
const read = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
const source = read('assets/bunch-note.js');

export function createRuntime(postAppFunctionJson, viewId = 'bunch-note', useDom = false) {
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
    ...fixtureTimers, queueMicrotask, console, Date, Map, Set, URL, Blob, Uint8Array, structuredClone, atob: globalThis.atob,
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


const plain = value => JSON.parse(JSON.stringify(value));

export function createSourceCardScenario() {
  const rows = [
    { unique_id: 'lot-1', blockalpha: 'D', locationcode: 'D.08.001', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'A', stock: 12, review: 1, available: 11 },
    { unique_id: 'lot-2', blockalpha: 'D', locationcode: 'D.08.001', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'B', stock: 9, review: 0, available: 9 },
    { unique_id: 'other', blockalpha: 'D', locationcode: 'D.09.001', itemcode: 'PLANT', commonname: 'Peony', contsize: '#3', lotcode: 'C', stock: 4, review: 0, available: 4 }
  ];
  const snapshot = { savedBody: null };
  const requests = [];
  const { BunchNote: note, element } = createRuntime(async (_url, request) => {
    requests.push(plain(request));
    if (request.operation === 'blocks') return { ok: true, data: { blocks: ['D'] } };
    if (request.operation === 'inventory') return { ok: true, data: { rows } };
    if (request.operation === 'directory') return { ok: true, data: { users: [] } };
    if (request.operation === 'drafts') return { ok: true, data: { drafts: snapshot.savedBody ? [{ id: 'batch-1', revision: 2, block: 'D', body: snapshot.savedBody, updated_at: '2026-10-17T00:00:00Z' }] : [] } };
    if (request.operation === 'catalog') return { ok: true, data: { options: [], locations: [] } };
    if (request.operation === 'save') {
      snapshot.savedBody = plain(request.payload.body);
      return { ok: true, data: { draft: { id: 'batch-1', revision: (request.expectedRevision || 0) + 1, body: snapshot.savedBody } } };
    }
    if (request.operation === 'preview') return { ok: true, data: { preview: { id: 'preview-1', instruction_revision: 1, recipients: [{ email: 'dylan@example.com' }] } } };
    if (request.operation === 'pdf_preview') return { ok: true, data: { pdfs: [{ base64: 'JVBERi0xLjQK', filename: 'BN.pdf' }] } };
    return { ok: true, data: {} };
  });

  return { note, element, requests, snapshot };
}
