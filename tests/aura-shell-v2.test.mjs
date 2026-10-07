// @test-group: aura
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
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

test('AURA router calls use the verified native session, bounded deadline, and separate party-bind idempotency', async () => {
  const start = html.indexOf('        function awaitAuraRead(');
  const end = html.indexOf('        async function resolveAuraOrderParty(', start + 1);
  const postStart = html.indexOf('        async function postAppFunctionJson(');
  const postEnd = html.indexOf('        function getAvReadDataset(', postStart + 1);
  assert.ok(start >= 0 && end > start && postStart >= 0 && postEnd > postStart);
  const calls = [];
  const context = vm.createContext({
    AbortController, Date, setTimeout, clearTimeout,
    nativeAuthSessionActive: true,
    nativeAuthProfile: { id: 'profile', username: 'dylan_collyge' },
    currentUser: 'dylan_collyge', auraVerifiedProfileId: 'profile',
    auraPendingRequests: new Set(), AURA_QUERY_URL: 'https://api.example.test/functions/v1/aura-llm-router',
    SUPABASE_KEY: 'project-anon-key',
    getSupabaseReadIdentityScope: () => 'dylan:session',
    isAuraWidgetAuthorized: () => true,
    getNativeAuthRequestHeaders: async () => ({ Authorization: 'Bearer native-dylan' }),
    getCurrentAppSessionToken: () => 'legacy-token',
    fetchWithTimeout: async (url, init, timeoutMs, label) => {
      calls.push({ url, init, timeoutMs, label });
      const request = JSON.parse(init.body);
      const response = request.mode === 'bind_party' ? { ok: true, partyRef: 'opaque-ref' } : { ok: true, requestId: 'turn-1' };
      return { ok: true, headers: { get: () => 'turn-1' }, text: async () => JSON.stringify(response) };
    },
    console,
  });
  vm.runInContext(`${html.slice(start, end)}\n${html.slice(postStart, postEnd)}\nglobalThis.invokeAuraRouter = callAuraLlmRouter;`, context);
  const bind = await context.invokeAuraRouter({ mode: 'bind_party', party: { customerIdentityId: 'cust-1', consigneeIdentityId: 'cons-1', customerName: 'Acme', consigneeName: 'North' } }, { deadlineAt: Date.now() + 15000, requestId: 'turn-1' });
  const command = { mode: 'command', text: 'check open stock for SKU-1', source: 'typed', turnId: 'turn-1', context: { mode: 'inventory', lines: [] }, partyRef: bind.partyRef,
    partySidecar: { customerIdentityId: 'cust-1', consigneeIdentityId: 'cons-1', customerName: 'Acme', consigneeName: 'North' } };
  const result = await context.invokeAuraRouter(command, { deadlineAt: Date.now() + 15000, requestId: 'turn-1' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.example.test/functions/v1/aura-llm-router');
    assert.ok(call.timeoutMs > 0 && call.timeoutMs <= 15000);
    assert.equal(call.init.headers.Authorization, 'Bearer native-dylan');
    assert.equal(call.init.headers['x-request-id'], 'turn-1');
    assert.equal(call.init.headers['x-gnc-session'], undefined);
  }
  assert.equal(calls[0].label, 'AURA command');
  assert.equal(calls[0].init.headers['Idempotency-Key'], 'turn-1:bind_party');
  assert.equal(calls[1].init.headers['Idempotency-Key'], 'turn-1:command');
  assert.deepEqual(JSON.parse(calls[1].init.body), command);
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

test('the real shell loader never imports AURA for another account or an unverified profile', async () => {
  const candidate = html.slice(html.indexOf('        function isAuraProfileCandidate()'), html.indexOf('        function disposeAuraWidget()'));
  const loader = html.slice(html.indexOf('        async function syncAuraWidgetForSession()'), html.indexOf('        let bloomscapesPendingState'));
  for (const account of ['sales_rep', 'nelly_aguilar', 'dylan_collyge']) {
    let imports = 0, disposed = 0, verified = 0;
    const context = vm.createContext({
      nativeAuthSessionActive: true, nativeAuthProfile: { id: 'profile', username: account },
      currentUser: account, auraVerifiedProfileId: '', auraLoadSequence: 0, auraWidgetHandle: null,
      disposeAuraWidget: () => { disposed += 1; },
      getNativeAuthSession: async () => { verified += 1; return { user: { id: 'different-profile' } }; },
    });
    new vm.Script(candidate + loader, { importModuleDynamically: () => { imports += 1; throw Error('Unexpected asset request'); } }).runInContext(context);
    await context.syncAuraWidgetForSession();
    assert.equal(imports, 0, account);
    assert.equal(disposed, 1, account);
    assert.equal(verified, account === 'dylan_collyge' ? 1 : 0, account);
  }
});

test('release packaging ships both V2 modules and versions all relative widget imports', () => {
  const packager = fs.readFileSync(new URL('../scripts/prepare-release-site.mjs', import.meta.url), 'utf8');
  for (const module of ['auraConversation.js', 'auraLingo.js']) assert.ok(packager.includes(module));
  assert.match(packager, /auraRelease = `V\$\{JSON\.parse/);
  assert.match(packager, /specifier\}\?v=\$\{encodeURIComponent\(auraRelease\)/);
  assert.match(packager, /\['components\/common\/auraVoiceWidget\.js', 'utils\/auraIntentParser\.js'\]/);
});
