import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const names = [
  'firstNonEmptyValue', 'getRequestCapabilityUsernameKey', 'getRequestCapabilities',
  'getRequestEntrySourceView', 'openRequestModal', 'finalizeRequestAction',
];
const declarations = new Map();
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  if (!match[1].includes('function openRequestModal(')) continue;
  const source = ts.createSourceFile('request-entry.js', match[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) {
      declarations.set(node.name.text, node.getText(source));
    }
  }
}
for (const name of names) assert.ok(declarations.has(name), `Extract the production ${name} function`);
const code = names.map(name => declarations.get(name)).join('\n');
const avOnly = { canCreateAv: true, canCreateGeneral: false };
const generalOnly = { canCreateAv: false, canCreateGeneral: true };

function fixture({ view = 'detail', origin = 'av', lastView = 'av', capabilities = avOnly,
  status = 'ready', stale = false, username = 'tony_bono', capabilityUsername = username } = {}) {
  const calls = { modal: 0, schema: 0, source: [], toasts: [], writes: [] };
  const rejectWrite = (...args) => { calls.writes.push(args); throw new Error('Unexpected business write in entry-source test'); };
  const context = {
    currentUser: username, activeDetailSourceView: origin, lastView,
    requestCapabilityState: { username: capabilityUsername, status, stale, capabilities },
    getCurrentVisibleViewId: () => view,
    showToast: (...args) => calls.toasts.push(args),
    toggleCartPanel() {}, resetQuickDriveRequestState() {},
    showRequestModalBase: () => { calls.modal++; },
    getDefaultRequestRepName: () => 'Tony Bono',
    isRequestRepPickerLockedForCurrentUser: () => true,
    detailRequestSourceDomIds: ['selected-row'], tempSelectedReqRep: 'Tony Bono',
    isQuickDriveRequestMode: () => false,
    resolveRequestRepSelectionForCurrentUser: value => value,
    syncRequestEmailChainSelectionFromInputs() {},
    buildRequestCreatorAuditInfo: () => ({}),
    getRequestCreatorExtraRecipientEmails: () => [],
    canUseRequestEmailChainPicker: () => false,
    dedupeRequestEmailRecipients: () => [],
    getRequestReusableData: () => ({ hasReusableEvidence: false }),
    // Observe passing entry authorization, then stop before any local or remote business mutation.
    ensureRequestSchemaCompatible: async () => { calls.schema++; return false; },
    window: {}, requestsInventory: [],
    closeRequestModal: rejectWrite, createRequestFolderId: rejectWrite,
    saveRequestOutboxEntry: rejectWrite, supabaseRpc: rejectWrite, supabaseFetch: rejectWrite, fetch: rejectWrite,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  const resolve = context.getRequestEntrySourceView;
  context.getRequestEntrySourceView = (...args) => {
    const resolved = resolve(...args);
    calls.source.push(resolved);
    return resolved;
  };
  const submit = () => context.finalizeRequestAction(null, 'Fixture Customer', {}, [{
    domId: 'fixture-master-row', item: { UNIQUE_ID: 'fixture-master-id', DOM_ID: 'fixture-master-row' }, data: {},
  }]);
  return { context, calls, submit, setView: next => { view = next; } };
}

for (const scenario of [
  { label: 'AV-only REP opening an AV row detail', view: 'detail', origin: 'av', lastView: 'drive', source: 'av', allowed: true },
  { label: 'AV-only REP creating from the AV list', view: 'av', origin: 'drive', lastView: 'drive', source: 'av', allowed: true },
  { label: 'AV-only REP opening Drive detail', view: 'detail', origin: 'drive', lastView: 'av', source: 'drive', allowed: false },
  { label: 'current Drive list ignores a stale AV detail origin', view: 'drive', origin: 'av', lastView: 'av', source: 'drive', allowed: false },
  { label: 'CSR General access creating from Drive detail', view: 'detail', origin: 'drive', lastView: 'av', capabilities: generalOnly, username: 'csr_fixture', source: 'drive', allowed: true },
  { label: 'General access cannot substitute for AV creation access', view: 'detail', origin: 'av', capabilities: generalOnly, username: 'csr_fixture', source: 'av', allowed: false },
  { label: 'normalized AV detail origin', view: ' DETAIL ', origin: ' AV ', lastView: 'drive', source: 'av', allowed: true },
  { label: 'missing detail origin falls back to the last AV view', view: 'detail', origin: '', lastView: 'av', source: 'av', allowed: true },
]) {
  test(`${scenario.label}: modal and submit use the same capability`, async () => {
    const f = fixture(scenario);
    const opened = f.context.openRequestModal('detail');
    assert.equal(f.calls.modal, scenario.allowed ? 1 : 0);
    if (!scenario.allowed) assert.equal(opened, false);
    await f.submit();
    assert.deepEqual(f.calls.source, [scenario.source, scenario.source], 'both production entry points call the shared resolver');
    assert.equal(f.calls.schema, scenario.allowed ? 1 : 0, 'submit reaches schema verification only with the matching creation capability');
    assert.equal(f.calls.toasts.filter(([title]) => title === 'Request Restricted').length, scenario.allowed ? 0 : 2);
    assert.equal(f.calls.writes.length, 0);
    assert.equal(f.context.requestsInventory.length, 0);
  });
}

for (const scenario of [
  { label: 'pending capability load', status: 'loading', capabilities: null },
  { label: 'failed capability load', status: 'error', capabilities: null },
  { label: 'stale cached AV capability', status: 'error', capabilities: avOnly, stale: true },
  { label: 'capabilities belonging to the previous login', capabilityUsername: 'another_rep' },
]) {
  test(`${scenario.label} keeps both entry points closed`, async () => {
    const f = fixture(scenario);
    assert.equal(f.context.openRequestModal('detail'), false);
    assert.equal(await f.submit(), false);
    assert.equal(f.calls.modal, 0);
    assert.equal(f.calls.schema, 0);
    assert.deepEqual(f.calls.toasts.map(([title]) => title), ['Request Access Check', 'Request Access Check']);
    assert.equal(f.calls.writes.length, 0);
  });
}

test('submit rechecks current source after an AV modal was opened', async () => {
  const f = fixture();
  f.context.openRequestModal('detail');
  assert.equal(f.calls.modal, 1);
  f.setView('drive');
  assert.equal(await f.submit(), false);
  assert.deepEqual(f.calls.source, ['av', 'drive']);
  assert.equal(f.calls.schema, 0);
  assert.equal(f.calls.toasts.at(-1)[0], 'Request Restricted');
  assert.equal(f.calls.writes.length, 0);
});

test('submit rechecks AV permission after the modal was opened', async () => {
  const f = fixture();
  f.context.openRequestModal('detail');
  assert.equal(f.calls.modal, 1);
  f.context.requestCapabilityState.capabilities = { ...avOnly, canCreateAv: false };
  assert.equal(await f.submit(), false);
  assert.equal(f.calls.schema, 0);
  assert.equal(f.calls.toasts.at(-1)[0], 'Request Restricted');
  assert.equal(f.calls.writes.length, 0);
});
