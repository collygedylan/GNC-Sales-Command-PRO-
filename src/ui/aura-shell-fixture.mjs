import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

export const html = readComposedAppSource();
export function extract(name, next) {
  const start = html.indexOf(`        async function ${name}(`);
  const end = html.indexOf(`        async function ${next}(`, start + 1);
  assert.ok(start >= 0 && end > start, name);
  return html.slice(start, end);
}
export const party = { key: 'acme|||north', customerName: 'Acme', consigneeName: 'North', label: 'Acme - North' };
export const line = (id = 'lot1') => ({ unique_id: id, itemcode: id, commonname: 'Limelight', contsize: '3DP', locationcode: 'A.07.000', lotcode: '27.U1', ptravailable: 100, quantity: 50 });
export function fixture(options = {}) {
  const dom = new JSDOM('<div id="bloom-picker-modal" class="hidden"></div><input id="bloom-order-number" value="old">');
  const calls = [];
  const context = vm.createContext({
    document: dom.window.document,
    selectedItems: new Set(options.selected || []), selectedItemSources: new Map(),
    fullInventory: [], avOpenInventory: [], masterInventoryById: new Map(),
    authorized: options.authorized !== false,
    isAuraWidgetAuthorized: () => context.authorized,
    getSupabaseReadIdentityScope: () => 'dylan:verified-session',
    resolveAuraOrderParty: async () => ({ items: [party], hasMore: false }),
    requestAuraV2Inventory: async body => {
      calls.push(body);
      if (options.duringValidation) await options.duringValidation(context);
      return options.validation || { valid: true, complete: true, rows: body.lines.map(row => ({ ...row, ptravailable: 100, listprice: '22.50' })), failures: [] };
    },
    parseAppNumber: value => value == null || String(value).trim() === '' ? null : Number(value),
    formatFetchedRows: rows => rows.map(row => ({ UNIQUE_ID: row.unique_id, ITEMCODE: row.itemcode, ...row })),
    shouldIncludeMasterItemInAvOpenView: () => true,
    canSubmitBloomPickerOrder: () => true,
    invalidateInventoryDomIdLookup() {}, updateGlobalActionBar() {}, refreshCartButtons() {},
    openBloomPickerModal(openOptions) {
      calls.push(['open', openOptions]);
      if (options.failOpen) return;
      const modal = context.document.getElementById('bloom-picker-modal');
      modal.classList.remove('hidden');
      for (const id of context.selectedItems) {
        const input = context.document.createElement('input');
        input.className = 'bp-item-qty-input'; input.setAttribute('data-dom-id', id); modal.append(input);
      }
    },
    applyBloomPickerReservePartyOption(value) { calls.push(['party', value]); },
    syncBloomPickerFolderName() {},
    closeBloomPickerModal() { context.document.getElementById('bloom-picker-modal').classList.add('hidden'); },
  });
  vm.runInContext(extract('openAuraBloomPickerDraft', 'openAuraBloomPickerOrder'), context);
  return { context, calls, dom, run: (draft = { party, lines: [line()] }, opts) => context.openAuraBloomPickerDraft(draft, opts) };
}

export function loadAuraQuery(context, source) {
  const start = html.indexOf('        function parseAuraDeterministicInventoryQuestion(');
  const end = html.indexOf('        function buildAuraDeterministicInventoryAnswer(', start);
  vm.runInContext(html.slice(start, end) + '\n' + source + '\nglobalThis.invokeRequestAuraQuery = requestAuraQuery;', context);
}

export function loadAuraTransport(context) {
  Object.assign(context, {
    isAllowedAppHostname: () => true,
    isLoginScreenVisible: () => false,
    nativeAuthRecoveryEpoch: 1,
    PRELOGIN_BACKGROUND_ACTIONS: new Set(),
    APP_VERSION: 'test', APP_SHELL_VERSION: 'test', window: context.window || {}
  });
  vm.runInContext(fs.readFileSync(new URL('../../assets/app-api-transport.js', import.meta.url), 'utf8'), context);
}
