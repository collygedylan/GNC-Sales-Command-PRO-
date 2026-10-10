import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';
import { buildSync } from 'esbuild';

const bundle = buildSync({ entryPoints: ['services/reclassEditableFields.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { inquiryFieldEdits, inquiryEditableFields, validateReclassEditableFieldProposals, confirmedInquiryFields, RECLASS_EDITABLE_FIELDS_POLICY } = module.exports;
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).find(value => value.includes('function repairDisplayMojibake('));
const ast = parse(source, { ecmaVersion: 'latest' });
function functions(names, values = {}) {
  const selected = ast.body.filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name)
    || node.type === 'VariableDeclaration' && node.declarations.some(declaration => names.includes(declaration.id.name)));
  const context = vm.createContext({ console, TextDecoder, Uint8Array, Map, Set, ...values });
  vm.runInContext(selected.map(node => source.slice(node.start, node.end)).join('\n'), context);
  return context;
}

test('V7 field boundary is exact, rejects quantities and client-derived SUS stamps', () => {
  assert.equal(inquiryEditableFields.length, 9);
  assert.deepEqual(inquiryFieldEdits([{ field: 'salesnote', expected: 'old', value: '' }, { field: 'suspend', expected: null, decision: 'yes' }]),
    [{ field: 'salesnote', expected: 'old', value: '' }, { field: 'suspend', expected: null, decision: 'yes' }]);
  for (const field of ['sales_note', 'ptronhand', 'ptrreviewed', 'prisetby', 'suspendto', 'inventorynote', 'brand', 'plantgroupcode']) {
    assert.throws(() => inquiryFieldEdits([{ field, expected: '', value: 'tampered' }]), /FIELD_INVALID/);
  }
  assert.throws(() => inquiryFieldEdits([{ field: 'suspend', expected: '', decision: 'yes', value: 'FAKE' }]), /SUSPEND_INVALID/);
  assert.throws(() => inquiryFieldEdits([{ field: 'locationnote', expected: '', value: 'a' }, { field: 'locationnote', expected: '', value: 'b' }]), /FIELD_INVALID/);
});

test('field-only and mixed V7 proposals keep truthful actions and reject designation/shear conflicts', () => {
  const payload = { workflowPolicyVersion: RECLASS_EDITABLE_FIELDS_POLICY,
    transaction: { requestActions: ['inventory_fields'], holdStopProposals: [] },
    rowOverlays: [{ unique_id: 'row', proposals: [], fieldEdits: [{ field: 'desigitem', expected: '', value: 'retail' }] }] };
  assert.doesNotThrow(() => validateReclassEditableFieldProposals(payload));
  assert.throws(() => validateReclassEditableFieldProposals({ ...payload, transaction: { ...payload.transaction, requestActions: [] } }), /ACTIONS_INVALID/);
  assert.throws(() => validateReclassEditableFieldProposals({ ...payload, rowOverlays: [{ ...payload.rowOverlays[0], proposals: [{ action: 'sheared', quantity: 2 }] }] }), /DESIGNATION_PROPOSAL_CONFLICT/);
  assert.doesNotThrow(() => validateReclassEditableFieldProposals({ ...payload, transaction: { ...payload.transaction, requestActions: ['inventory_fields', 'move_up'] },
    rowOverlays: [{ ...payload.rowOverlays[0], proposals: [{ action: 'move_up', splits: [{ quantity: 2, destinationSeason: 'S1' }] }] }] }));
});

test('confirmed field receipt cannot introduce unverified IDs, fields or stamp keys', () => {
  const before = Object.fromEntries(inquiryEditableFields.map(field => [field, null]));
  const row = { unique_id: 'row', before, after: { ...before, suspend: 'DC' }, changedFields: ['suspend'],
    stamps: { prisetby: 'DC', priupdated: '2026-10-09', locationnotedate: null, evaldate: '2026-10-09' } };
  assert.deepEqual(confirmedInquiryFields([row], new Set(['row'])), [row]);
  assert.throws(() => confirmedInquiryFields([row], new Set(['other'])), /FIELDS_INVALID/);
  assert.throws(() => confirmedInquiryFields([{ ...row, after: { ...row.after, sales_note: 'wrong field' } }], new Set(['row'])), /FIELDS_INVALID/);
  assert.throws(() => confirmedInquiryFields([{ ...row, changedFields: [] }], new Set(['row'])), /CHANGES_INVALID/);
});

test('common-name display repair preserves adjacent valid Unicode and fixes repeated encoding', () => {
  const context = functions(['WINDOWS_1252_EXTRA_CODEPOINT_TO_BYTE', 'DISPLAY_MOJIBAKE_MARKERS',
    'countDisplayMojibakeMarkers', 'hasDisplayMojibake', 'getWindows1252ByteFromChar', 'decodeWindows1252Utf8RoundTrip', 'repairDisplayMojibake']);
  for (const [input, expected] of [
    ['EncoreÂ®🌿', 'Encore®🌿'], ['CafÃ©植物', 'Café植物'], ['Bloomâ„¢', 'Bloom™'], ['FranÃƒÂ§ais', 'Français'],
    ['José — 東京 🌿 ® ™', 'José — 東京 🌿 ® ™'], ['Ã', 'Ã'], ['plain ASCII', 'plain ASCII'],
  ]) assert.equal(context.repairDisplayMojibake(input), expected);
});

test('live Hold YES submits only the hold action and reconciles server evidence, without a broad row write', async () => {
  const calls = [];
  const item = { PTRONHAND: '41', PHOTO_LINK: 'keep.jpg', SPEC: 'keep specs' };
  const context = functions(['liveHoldRemovalAttempts', 'submitConfirmedLiveHoldRemoval'], {
    canSubmitLiveHoldRemoval: () => true, getArgosReclassLiveEditIdentityKey: () => 'actor1', getCurrentReclassDeliveryActor: () => 'dylan_collyge',
    getArgosInventorySourceSnapshot: () => ({ uniqueId: 'row', itemCode: '001', lotCode: '27.F1', locationCode: 'D.29.000', priority: '2', holdStopCode: 'H', holdStopReason: 'old' }),
    generateArgosInventoryTransactionId: () => 'hold-removal-test', getArgosReclassScopeSettings: () => ({ season: 'F1', salesYear: 2027 }),
    RECLASS_ACTION_WORKFLOW_V7_POLICY_VERSION: RECLASS_EDITABLE_FIELDS_POLICY, APP_SHELL_VERSION: 'test',
    postArgosInventoryTransactionPayload: async payload => { calls.push(JSON.parse(JSON.stringify(payload))); return { ok: true, receipt: 'saved' }; },
    rememberQueuedReclassDelivery: () => {}, applyConfirmedArgosReclassLiveEdits: receipt => { assert.equal(receipt.receipt, 'saved'); return { applied: 1, stale: false }; },
    showToast: () => {}, pollReclassDeliveryJobs: async () => {},
  });
  assert.equal(await context.submitConfirmedLiveHoldRemoval(item), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].transaction.requestActions, ['take_off_hold']);
  assert.deepEqual(calls[0].rowOverlays[0].proposals, []);
  assert.equal(JSON.stringify(calls[0]).includes('keep.jpg'), false, 'photo/spec values are never included in the mutation payload');
  assert.deepEqual(item, { PTRONHAND: '41', PHOTO_LINK: 'keep.jpg', SPEC: 'keep specs' });
});
