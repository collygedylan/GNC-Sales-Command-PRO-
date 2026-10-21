import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: aura
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readComposedAppSource();
function extract(name, next) {
  const start = html.indexOf(`        async function ${name}(`);
  const end = html.indexOf(`        async function ${next}(`, start + 1);
  assert.ok(start >= 0 && end > start, name);
  return html.slice(start, end);
}
const party = { key: 'acme|||north', customerName: 'Acme', consigneeName: 'North', label: 'Acme - North' };
const line = (id = 'lot1') => ({ unique_id: id, itemcode: id, commonname: 'Limelight', contsize: '3DP', locationcode: 'A.07.000', lotcode: '27.U1', ptravailable: 100, quantity: 50 });
function fixture(options = {}) {
  const dom = new JSDOM('<div id="bloom-picker-modal" class="hidden"></div><input id="bloom-order-number" value="old">');
  const calls = [];
  const context = vm.createContext({
    document: dom.window.document,
    selectedItems: new Set(options.selected || []), selectedItemSources: new Map(),
    fullInventory: [], avOpenInventory: [],
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

test('AURA multi-line review validates every row and populates the existing form without an order write', async () => {
  const f = fixture();
  try {
    assert.equal((await f.run({ party, lines: [line(), line('lot2')] })).ok, true);
    assert.deepEqual([...f.context.selectedItems], ['aura_lot1', 'aura_lot2']);
    assert.deepEqual([...f.context.document.querySelectorAll('.bp-item-qty-input')].map(input => input.value), ['50', '50']);
    assert.equal(f.context.document.getElementById('bloom-order-number').value, '');
    assert.equal(f.calls[0].operation, 'validate_draft');
    assert.equal(f.calls[0].lines.length, 2);
    assert.equal(f.calls[1][0], 'open');
    assert.equal(f.calls[1][1].freshDraft, true);
    assert.equal(f.calls[2][0], 'party');
    assert.equal(f.context.avOpenInventory[0].listprice, '22.50');
    assert.doesNotMatch(extract('openAuraBloomPickerDraft', 'openAuraBloomPickerOrder'), /\.insert\(|submitBloomPickerOrder\(|supabaseFetch\(/);
  } finally { f.dom.window.close(); }
});

test('an existing Bloom Picker cart remains untouched and avoids a validation request', async () => {
  const f = fixture({ selected: ['manual-row'] });
  try {
    await assert.rejects(f.run(), /already contains/);
    assert.deepEqual([...f.context.selectedItems], ['manual-row']);
    assert.equal(f.calls.length, 0);
  } finally { f.dom.window.close(); }
});

test('partial, stale, and unknown-quantity validation never stages a partial cart', async () => {
  const cases = [
    { valid: false, complete: false, rows: [], failures: [{ unique_id: 'lot1', error: 'Stock changed' }] },
    { valid: true, complete: true, rows: [{ ...line(), ptravailable: '' }] },
    { valid: true, complete: true, rows: [{ ...line(), ptravailable: 49 }] },
    { valid: true, complete: true, rows: [{ ...line(), lotcode: 'different' }] },
  ];
  for (const validation of cases) {
    const f = fixture({ validation });
    try {
      await assert.rejects(f.run());
      assert.equal(f.context.selectedItems.size, 0);
      assert.equal(f.context.avOpenInventory.length, 0);
    } finally { f.dom.window.close(); }
  }
});

test('account changes, cancellation, and cart edits during verification invalidate handoff', async () => {
  for (const kind of ['signout', 'abort', 'cart']) {
    const controller = new AbortController();
    const f = fixture({ duringValidation(context) {
      if (kind === 'signout') context.authorized = false;
      if (kind === 'abort') controller.abort();
      if (kind === 'cart') context.selectedItems.add('new-manual-row');
    } });
    try {
      await assert.rejects(f.run(undefined, { signal: controller.signal }));
      assert.equal(f.context.avOpenInventory.length, 0);
      assert.deepEqual([...f.context.selectedItems], kind === 'cart' ? ['new-manual-row'] : []);
    } finally { f.dom.window.close(); }
  }
});

test('form-opening failure rolls back staged selection and leaves the AURA draft with its caller', async () => {
  const f = fixture({ failOpen: true });
  const draft = { party, lines: [line()] };
  try {
    await assert.rejects(f.run(draft), /could not open/);
    assert.equal(f.context.selectedItems.size, 0);
    assert.equal(draft.lines.length, 1);
  } finally { f.dom.window.close(); }
});

test('customer resolution prefers exact names and returns all ambiguity without guessing', async () => {
  const context = vm.createContext({
    isAuraWidgetAuthorized: () => true, getSupabaseReadIdentityScope: () => 'dylan',
    normalizeRepMatchToken: value => String(value || '').toLowerCase().trim(),
    ensureDatasetLoaded: async () => true,
    getBloomPickerReservePartyOptions: () => [party, { ...party, key: 'south', consigneeName: 'South', label: 'Acme - South' }, { ...party, key: 'other', customerName: 'Acme Extra', label: 'Acme Extra' }],
  });
  vm.runInContext(extract('resolveAuraOrderParty', 'saveAuraScoutLog'), context);
  const result = await context.resolveAuraOrderParty('Acme');
  assert.deepEqual([...result.items].map(item => item.key), ['acme|||north', 'south']);
  assert.equal(result.hasMore, false);
});

test('AURA reads enter the shared read boundary and retain error status metadata', () => {
  const source = extract('requestAuraV2Inventory', 'resolveAuraOrderParty');
  assert.match(source, /withProductionLiveSyncSignal/);
  assert.match(source, /runDedupeSupabaseRead/);
  assert.match(source, /maxAttempts: 1/);
  assert.match(source, /AURA_QUERY_URL/);
  const api = extract('callAuraAppApi', 'requestAuraInventory');
  assert.match(api, /error\.status = Number\(payload\?\.status/);
  assert.match(api, /error\.code = String\(payload\?\.code/);
});

test('AURA router calls use the verified native session, 35-second deadline, and request idempotency', async () => {
  const authStart = html.indexOf('        function isAuraRouterProfileCandidate()');
  const authEnd = html.indexOf('        function disposeAuraWidget()', authStart + 1);
  const start = html.indexOf('        function awaitAuraRead(');
  const end = html.indexOf('        async function resolveAuraOrderParty(', start + 1);
  const postStart = html.indexOf('        async function postAppFunctionJson(');
  const postEnd = html.indexOf('        function getAvReadDataset(', postStart + 1);
  assert.ok(start >= 0 && end > start && postStart >= 0 && postEnd > postStart);
  const calls = [];
  const context = vm.createContext({
    AbortController, Date, setTimeout, clearTimeout,
    nativeAuthSessionActive: true,
    nativeAuthProfile: { id: 'profile', username: 'manager', role: 'MANAGER' },
    currentUser: 'manager', auraVerifiedProfileId: '', auraRouterVerifiedProfileId: 'profile',
    auraRouterCapabilities: { auraEnabled: true, id: 'profile', username: 'manager', role: 'MANAGER', inventory: true, history: true, drafts: true },
    auraPendingRequests: new Set(), AURA_QUERY_URL: 'https://api.example.test/functions/v1/aura-llm-router',
    AURA_LLM_ROUTER_URL: 'https://api.example.test/functions/v1/aura-llm-router',
    SUPABASE_KEY: 'project-anon-key',
    getSupabaseReadIdentityScope: () => 'dylan:session',
    getNativeAuthRequestHeaders: async () => ({ Authorization: 'Bearer native-dylan' }),
    getCurrentAppSessionToken: () => 'legacy-token',
    fetchWithTimeout: async (url, init, timeoutMs, label) => {
      calls.push({ url, init, timeoutMs, label });
      const request = JSON.parse(init.body);
      const response = { ok: true, requestId: 'turn-1' };
      return { ok: true, headers: { get: () => 'turn-1' }, text: async () => JSON.stringify(response) };
    },
    console,
  });
  vm.runInContext(`${html.slice(authStart, authEnd)}\n${html.slice(start, end)}\n${html.slice(postStart, postEnd)}\nglobalThis.invokeAuraRouter = callAuraLlmRouter;`, context);
  const command = { mode: 'command', text: 'check open stock for SKU-1', source: 'typed', turnId: 'turn-1', context: { mode: 'inventory', lines: [] } };
  const result = await context.invokeAuraRouter(command, { deadlineAt: Date.now() + 35000, requestId: 'turn-1' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.example.test/functions/v1/aura-llm-router');
    assert.ok(call.timeoutMs > 0 && call.timeoutMs <= 35000);
    assert.equal(call.init.headers.Authorization, 'Bearer native-dylan');
    assert.equal(call.init.headers['x-request-id'], 'turn-1');
    assert.equal(call.init.headers['x-gnc-session'], undefined);
  }
  assert.equal(calls[0].label, 'AURA command');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'turn-1:command');
  assert.deepEqual(JSON.parse(calls[0].init.body), command);
  assert.doesNotMatch(JSON.stringify({ text: command.text, context: command.context }), /Acme|North/);
  assert.equal(context.auraPendingRequests.size, 0);
});

test('AURA inventory deadline aborts a stalled native-auth lookup at the five-second budget', async () => {
  const start = html.indexOf('        function awaitAuraRead(');
  const end = html.indexOf('        async function requestAuraInventory(', start + 1);
  assert.ok(start >= 0 && end > start);
  let resolveHeaders;
  let headerCalls = 0;
  let postCalls = 0;
  const timers = [];
  const context = vm.createContext({
    AbortController,
    nativeAuthSessionActive: true,
    nativeAuthProfile: { id: 'profile', username: 'dylan_collyge' },
    currentUser: 'dylan_collyge',
    auraVerifiedProfileId: 'profile',
    auraPendingRequests: new Set(),
    APP_API_FUNCTION_URL: 'https://api.example.test/functions/v1/app-api',
    getSupabaseReadIdentityScope: () => 'dylan:session',
    isAuraWidgetAuthorized: () => true,
    getNativeAuthRequestHeaders: () => {
      headerCalls += 1;
      return new Promise(resolve => { resolveHeaders = resolve; });
    },
    postAppFunctionJson: async () => { postCalls += 1; return { ok: true }; },
    setTimeout: (callback, delay) => { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cleared = true; },
    console,
  });
  vm.runInContext(`${html.slice(start, end)}\nglobalThis.invokeAuraApi = callAuraAppApi;`, context);

  const deadlineAt = Date.now() + 5000;
  const pending = context.invokeAuraApi({ action: 'aura_inventory_v2', operation: 'match' }, {
    deadlineAt, requestId: 'request-010', onStage() {},
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(headerCalls, 1, 'native headers are resolved once for the operation');
  assert.equal(postCalls, 0, 'the API request waits for authentication');
  assert.ok(timers[0].delay <= 5000 && timers[0].delay >= 4900, 'the forwarded deadline starts at five seconds');
  timers[0].callback();
  await assert.rejects(pending, error => error.code === 'AURA_DEADLINE_EXCEEDED');
  assert.equal(context.auraPendingRequests.size, 0, 'the aborted request is removed from lifecycle tracking');
  resolveHeaders({ Authorization: 'Bearer stale' });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(postCalls, 0, 'late authentication cannot start a request after timeout');
});

test('AURA forwards one verified header set, deadline, request metadata, and cancellation; stale replies are ignored', async () => {
  const start = html.indexOf('        function awaitAuraRead(');
  const end = html.indexOf('        async function requestAuraInventory(', start + 1);
  assert.ok(start >= 0 && end > start);
  const postStart = html.indexOf('        async function postAppFunctionJson(');
  const postEnd = html.indexOf('        function getAvReadDataset(', postStart + 1);
  assert.ok(postStart >= 0 && postEnd > postStart);
  const external = new AbortController();
  const headers = { Authorization: 'Bearer verified' };
  let headerCalls = 0;
  let releaseResponse;
  let fetchOptions;
  const context = vm.createContext({
    AbortController,
    nativeAuthSessionActive: true,
    nativeAuthProfile: { id: 'profile', username: 'dylan_collyge' },
    currentUser: 'dylan_collyge',
    auraVerifiedProfileId: 'profile',
    auraPendingRequests: new Set(),
    APP_API_FUNCTION_URL: 'https://api.example.test/functions/v1/app-api',
    SUPABASE_KEY: 'project-anon-key',
    getSupabaseReadIdentityScope: () => 'dylan:session',
    isAuraWidgetAuthorized: () => true,
    getNativeAuthRequestHeaders: async () => { headerCalls += 1; return headers; },
    getCurrentAppSessionToken: () => 'legacy-session-token',
    fetchWithTimeout: async (_url, init, timeoutMs, label) => {
      fetchOptions = { init, timeoutMs, label };
      return new Promise(resolve => { releaseResponse = resolve; });
    },
    setTimeout,
    clearTimeout,
    console,
  });
  vm.runInContext(`${html.slice(start, end)}\n${html.slice(postStart, postEnd)}\nglobalThis.invokeAuraApi = callAuraAppApi;`, context);

  const deadlineAt = Date.now() + 5000;
  const pending = context.invokeAuraApi({ action: 'aura_inventory_v2', operation: 'match' }, {
    signal: external.signal, deadlineAt, requestId: 'request-010', idempotencyKey: 'read-key',
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(headerCalls, 1);
  assert.ok(fetchOptions, 'the request starts after native authentication resolves');
  assert.equal(fetchOptions.label, 'AURA');
  assert.ok(fetchOptions.timeoutMs > 0 && fetchOptions.timeoutMs <= 5000);
  assert.equal(fetchOptions.init.headers.Authorization, 'Bearer verified', 'safeOptions.nativeHeaders are used by the request wrapper');
  assert.equal(fetchOptions.init.headers['x-request-id'], 'request-010');
  assert.equal(fetchOptions.init.headers['Idempotency-Key'], 'read-key');
  assert.equal(fetchOptions.init.headers['x-gnc-session'], undefined, 'the native session is used without a second legacy session');
  assert.ok(fetchOptions.init.signal instanceof AbortSignal);
  external.abort(Object.assign(new Error('Superseded command.'), { name: 'AbortError', code: 'REQUEST_ABORTED' }));
  await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
  assert.equal(fetchOptions.init.signal.aborted, true, 'the caller signal reaches the in-flight fetch');
  releaseResponse({ ok: true, headers: { get: () => 'request-010' }, text: async () => JSON.stringify({ ok: true, rows: [{ itemcode: 'stale' }] }) });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(context.auraPendingRequests.size, 0);
});

test('the shell checks router role eligibility and native identity before importing AURA', async () => {
  const candidate = html.slice(html.indexOf('        function isAuraProfileCandidate()'), html.indexOf('        function disposeAuraWidget()'));
  const loader = html.slice(html.indexOf('        async function syncAuraWidgetForSession()'), html.indexOf('        let bloomscapesPendingState'));
  for (const { account, role, expectedSessionChecks } of [
    { account: 'sales_rep', role: 'REP', expectedSessionChecks: 1 },
    { account: 'nelly_aguilar', role: 'CSR', expectedSessionChecks: 1 },
    { account: 'unapproved_user', role: 'INTERN', expectedSessionChecks: 1 },
    { account: 'dylan_collyge', role: 'LEGACY', expectedSessionChecks: 1 },
  ]) {
    let imports = 0, disposed = 0, verified = 0;
    const context = vm.createContext({
      nativeAuthSessionActive: true, nativeAuthProfile: { id: 'profile', username: account, role },
      currentUser: account, auraVerifiedProfileId: '', auraLoadSequence: 0, auraWidgetHandle: null,
      getSupabaseReadIdentityScope: () => `${account}:session`,
      disposeAuraWidget: () => { disposed += 1; },
      getNativeAuthSession: async () => { verified += 1; return { user: { id: 'different-profile' } }; },
    });
    new vm.Script(candidate + loader, { importModuleDynamically: () => { imports += 1; throw Error('Unexpected asset request'); } }).runInContext(context);
    await context.syncAuraWidgetForSession();
    assert.equal(imports, 0, account);
    assert.equal(disposed, 1, account);
    assert.equal(verified, expectedSessionChecks, account);
  }
});

test('new React voice conversations never fall back to the Dylan-only legacy query', () => {
  const requestStart = html.indexOf('        async function requestAuraQuery(');
  const requestEnd = html.indexOf('        async function openAuraQueryAction(', requestStart + 1);
  const syncStart = html.indexOf('        async function syncAuraWidgetForSession()');
  const syncEnd = html.indexOf('        let bloomscapesPendingState', syncStart + 1);
  assert.ok(requestStart >= 0 && requestEnd > requestStart && syncStart >= 0 && syncEnd > syncStart);
  const request = html.slice(requestStart, requestEnd);
  const sync = html.slice(syncStart, syncEnd);
  assert.match(request, /callAuraLlmRouter\(command, \{ \.\.\.request, requestId: originalTurnId \}\)/);
  assert.match(request, /AURA_APP_CONTEXT_STALE/);
  assert.match(sync, /capabilities\.socReserves === true \|\| capabilities\.socOpenOrders === true/);
  assert.doesNotMatch(request, /callAuraLegacyQuery/);
  assert.match(sync, /if \(!access\.configured \|\| !hasCapability\)[\s\S]*showToast\('AURA unavailable'/);
  assert.match(sync, /requestAssistant: requestAuraQuery/);
  assert.doesNotMatch(sync, /requestAssistant: callAuraLegacyQuery|useLegacy/);
  assert.match(sync, /reactHost\.id = 'aura-react-root'/);
  assert.match(sync, /mountAuraWidgetReact\(reactHost, options\)/);
  assert.doesNotMatch(sync, /mountAuraWidgetReact\(document\.body/);
  const appApi = extract('callAuraAppApi', 'requestAuraInventory');
  const alpha = html.slice(html.indexOf('        async function mountAlphaCommandCenter('), html.indexOf('        function isAuraProfileCandidate()', html.indexOf('        async function mountAlphaCommandCenter(')));
  assert.match(appApi, /isAuraWidgetAuthorized\(\)/, 'legacy app-api stays restricted to its original owner');
  assert.match(alpha, /isAuraWidgetAuthorized\(\)/, 'the separate Alpha command center keeps legacy authorization');
});

test('unconfigured Gemini is an explicit unavailable state and does not call the legacy endpoint', async () => {
  const request = extract('requestAuraQuery', 'openAuraQueryAction');
  let routerCalls = 0, legacyCalls = 0;
  const context = vm.createContext({
    crypto: { randomUUID: () => 'request-1' },
    isAuraRouterWidgetAuthorized: () => true,
    getSupabaseReadIdentityScope: () => 'manager:session-1',
    auraRouterCapabilities: { configured: false },
    APP_CURRENT_SEASON_OPTIONS: ['S1', 'F1'],
    getCurrentAppSeasonSettings: () => ({ seasonCode: 'S1', salesYear: 27, revision: 8 }),
    normalizeAppSeasonSettingsPayload: value => ({ seasonCode: value.seasonCode || value.season || 'S1', salesYear: Number(value.salesYear ?? value.salesyear ?? 27), revision: Number(value.revision ?? value.settingRevision ?? 0) }),
    writeLocalAppSeasonSettings: value => value,
    callAuraLlmRouter: async () => { routerCalls += 1; return { ok: true }; },
    callAuraLegacyQuery: async () => { legacyCalls += 1; return { ok: true }; },
  });
  vm.runInContext(`${request}\nglobalThis.invokeRequestAuraQuery = requestAuraQuery;`, context);
  await assert.rejects(context.invokeRequestAuraQuery({ mode: 'command' }), error => {
    assert.equal(error.code, 'AURA_LLM_UNAVAILABLE');
    assert.doesNotMatch(error.message, /Gemini|Google/i);
    assert.match(error.message, /Contact your administrator/);
    return true;
  });
  assert.equal(routerCalls, 0);
  assert.equal(legacyCalls, 0);
  context.auraRouterCapabilities.configured = true;
  await context.invokeRequestAuraQuery({ mode: 'command' });
  assert.equal(routerCalls, 1);
  assert.equal(legacyCalls, 0);
});

test('AURA commands persist a confirmed stale context and use it for the next command', async () => {
  const request = extract('requestAuraQuery', 'openAuraQueryAction');
  const calls = [];
  let settings = { seasonCode: 'S1', salesYear: 27, revision: 8 };
  const context = vm.createContext({
    crypto: { randomUUID: () => 'request-id' },
    isAuraRouterWidgetAuthorized: () => true,
    getSupabaseReadIdentityScope: () => 'manager:session-1',
    auraRouterCapabilities: { configured: true },
    APP_CURRENT_SEASON_OPTIONS: ['F1', 'S1', 'U1', 'U2', 'U3', 'X', 'Y', 'Z'],
    getCurrentAppSeasonSettings: () => settings,
    normalizeAppSeasonSettingsPayload: value => ({ seasonCode: value.seasonCode || value.season || 'F1', salesYear: Number(value.salesYear ?? value.salesyear ?? 27), revision: Number(value.revision ?? value.settingRevision ?? 0) }),
    writeLocalAppSeasonSettings: value => { settings = { seasonCode: value.seasonCode, salesYear: value.salesYear, revision: value.revision }; return settings; },
    callAuraLlmRouter: async (body, options) => {
      calls.push({ body, options });
      if (calls.length === 1) throw Object.assign(new Error('stale'), { code: 'AURA_APP_CONTEXT_STALE', status: 409,
        appContext: { season: 'F1', salesyear: 28, settingRevision: 9 } });
      return { ok: true, requestId: body.turnId, reply: 'The current result', actions: [] };
    },
  });
  vm.runInContext(`${request}\nglobalThis.invokeRequestAuraQuery = requestAuraQuery;`, context);
  const result = await context.invokeRequestAuraQuery({ mode: 'command', text: 'check open stock', source: 'voice', turnId: 'original-turn' }, { requestId: 'original-turn' });
  assert.equal(calls.length, 2, 'stale settings trigger at most one retry');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body.appContext)), { season: 'S1', salesyear: 27, settingRevision: 8 });
  assert.equal(calls[0].body.source, 'voice');
  assert.equal(calls[1].body.turnId, 'original-turn');
  assert.equal(calls[1].options.requestId, 'original-turn', 'cancel and deduplication remain bound to the active voice turn');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].body.appContext)), { season: 'F1', salesyear: 28, settingRevision: 9 });
  assert.equal(calls[1].body.source, 'voice', 'voice origin survives the stale retry');
  assert.equal(result.requestId, 'original-turn', 'the widget and cancel path retain the original interaction ID');
  assert.equal(result.reply, 'The current result');
  assert.deepEqual(JSON.parse(JSON.stringify(settings)), { seasonCode: 'F1', salesYear: 28, revision: 9 });
  await context.invokeRequestAuraQuery({ mode: 'command', text: 'check another item', source: 'voice', turnId: 'second-turn' }, { requestId: 'second-turn' });
  assert.equal(calls.length, 3, 'the next command succeeds without another stale-context retry');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2].body.appContext)), { season: 'F1', salesyear: 28, settingRevision: 9 });
});

test('AURA stale-context retry is suppressed after the verified identity changes', async () => {
  const request = extract('requestAuraQuery', 'openAuraQueryAction');
  let identity = 'manager:session-1', calls = 0;
  let settingsWrites = 0;
  const context = vm.createContext({
    crypto: { randomUUID: () => 'fresh-turn' },
    isAuraRouterWidgetAuthorized: () => identity === 'manager:session-1',
    getSupabaseReadIdentityScope: () => identity,
    auraRouterCapabilities: { configured: true },
    APP_CURRENT_SEASON_OPTIONS: ['F1', 'S1', 'U1', 'U2', 'U3', 'X', 'Y', 'Z'],
    getCurrentAppSeasonSettings: () => ({ seasonCode: 'S1', salesYear: 27, revision: 8 }),
    normalizeAppSeasonSettingsPayload: value => ({ seasonCode: value.seasonCode || value.season || 'F1', salesYear: Number(value.salesYear ?? value.salesyear ?? 27), revision: Number(value.revision ?? value.settingRevision ?? 0) }),
    writeLocalAppSeasonSettings: () => { settingsWrites++; },
    callAuraLlmRouter: async () => {
      calls++;
      identity = 'other-account:session-2';
      throw Object.assign(new Error('stale'), { code: 'AURA_APP_CONTEXT_STALE', status: 409,
        appContext: { season: 'F1', salesyear: 28, settingRevision: 9 } });
    },
  });
  vm.runInContext(`${request}\nglobalThis.invokeRequestAuraQuery = requestAuraQuery;`, context);
  await assert.rejects(context.invokeRequestAuraQuery({ mode: 'command', text: 'check', turnId: 'original-turn' }), error => error.code === 'AURA_APP_CONTEXT_STALE');
  assert.equal(calls, 1, 'an old account response cannot replay under the next identity');
  assert.equal(settingsWrites, 0, 'an old-account context cannot update current local settings');
});

test('AURA cancellation during a stale-context response cannot apply settings or retry', async () => {
  const request = extract('requestAuraQuery', 'openAuraQueryAction');
  const controller = new AbortController();
  let calls = 0, settingsWrites = 0;
  const context = vm.createContext({
    crypto: { randomUUID: () => 'request-id' },
    isAuraRouterWidgetAuthorized: () => true,
    getSupabaseReadIdentityScope: () => 'manager:session-1',
    auraRouterCapabilities: { configured: true },
    APP_CURRENT_SEASON_OPTIONS: ['F1', 'S1'],
    getCurrentAppSeasonSettings: () => ({ seasonCode: 'S1', salesYear: 27, revision: 8 }),
    normalizeAppSeasonSettingsPayload: value => ({ seasonCode: value.seasonCode || value.season || 'F1', salesYear: Number(value.salesYear ?? value.salesyear ?? 27), revision: Number(value.revision ?? value.settingRevision ?? 0) }),
    writeLocalAppSeasonSettings: () => { settingsWrites++; },
    callAuraLlmRouter: async () => {
      calls++;
      controller.abort();
      throw Object.assign(new Error('stale'), { code: 'AURA_APP_CONTEXT_STALE', status: 409,
        appContext: { season: 'F1', salesyear: 28, settingRevision: 9 } });
    },
  });
  vm.runInContext(`${request}\nglobalThis.invokeRequestAuraQuery = requestAuraQuery;`, context);
  await assert.rejects(context.invokeRequestAuraQuery({ mode: 'command', text: 'check', turnId: 'original-turn' }, { signal: controller.signal }),
    error => error.code === 'AURA_APP_CONTEXT_STALE');
  assert.equal(calls, 1);
  assert.equal(settingsWrites, 0, 'cancelled command settings are not applied');
});

test('release packaging ships both V2 modules and versions all relative widget imports', () => {
  const packager = fs.readFileSync(new URL('../scripts/prepare-release-site.mjs', import.meta.url), 'utf8');
  for (const module of ['auraConversation.js', 'auraLingo.js', 'auraGeminiSpeech.js']) assert.ok(packager.includes(module));
  assert.match(packager, /auraRelease = await readExpectedRelease\(root\)/);
  assert.match(packager, /specifier\}\?v=\$\{encodeURIComponent\(auraRelease\)/);
  assert.match(packager, /\['components\/common\/auraVoiceWidget\.js', 'utils\/auraIntentParser\.js'\]/);
});

test('release packaging includes every relative dependency of the standalone Aura widget', () => {
  const packager = fs.readFileSync(new URL('../scripts/prepare-release-site.mjs', import.meta.url), 'utf8');
  const copied = new Set([...packager.matchAll(/await copyTree\(path\.join\(root, ([^)]+)\),/g)]
    .map(match => [...match[1].matchAll(/'([^']+)'/g)].map(part => part[1]).join('/')));
  const visited = new Set();
  const repositoryURL = new URL('../', import.meta.url);
  const check = file => {
    if (visited.has(file)) return;
    visited.add(file);
    assert.ok(copied.has(file), `Public artifact must contain ${file}`);
    const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    for (const match of source.matchAll(/from\s+["'](\.\.?\/[^"']+\.js)["']/g)) {
      const dependency = new URL(match[1], new URL('../' + file, import.meta.url));
      assert.ok(dependency.href.startsWith(repositoryURL.href), 'Aura modules must stay in the repository');
      const relative = decodeURIComponent(dependency.href.slice(repositoryURL.href.length));
      check(relative);
    }
  };
  check('components/common/auraVoiceWidget.js');
});
