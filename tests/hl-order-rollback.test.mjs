import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const html = read('index.html');
function appFunction(name) {
  const start = html.search(new RegExp(`        (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} exists`);
  const end = html.indexOf('\n        }', start);
  assert.ok(end > start, `${name} closes`);
  return html.slice(start, end + 10);
}

// Exact function fingerprints from the requested release, commit
// 9a29cbe6dbc043a624ffdb6693ea160568a0da34. A shallow CI checkout needs no old Git objects.
const baselineCameraFunctions = {
  handlePhotoUpload: '3466af67c158d4b3c55414c2faa0d252046c799ed5c83b11e70742816a8d5f7e',
  handleNcrPhotoSelect: '85cf28e7f73c882c7fef3263fd18b8a8b2d577007a0e0b66d4453fcce8433440',
  handleTaskDetailQuickPhotoUpload: '4f820c3c3878e0bb70fecfe3e7c5bb2db70a848dcceeab54f5f01d117db8edc8',
  applyProtectedEditState: 'eaef441bcbbaddfcbbd74f69c79c50d7bd3e546a42cc4450d79d4a09ca5f1291',
  renderProtectedControls: 'af26907ccbd1bfadba0e0085a11246484843c0b9fb7d9cc2abe61e9971fc2883',
  applyCameraPermissions: 'c480d618fe7a02d99ee30674ec6127b7d69bb953e7e0ea9b6e535330a4bc97b1',
};

test('legacy camera and protected controls are exactly the requested September 9 implementation', () => {
  for (const [name, expected] of Object.entries(baselineCameraFunctions)) {
    assert.equal(createHash('sha256').update(appFunction(name)).digest('hex'), expected, name);
  }
  assert.doesNotMatch(html, /function (?:ensureDetailPhotoCaptureReady|retryRetainedRequestCameraSelection|onProductionMasterDetailsVerified)\(/);
});

test('the complete client is the September 9 release with only a fresh cache stamp', () => {
  const baseline = html.replaceAll('V2026.09.11.03', 'V2026.09.09.01');
  assert.equal(createHash('sha256').update(baseline).digest('hex'), '82af80e38e93049b344f89140f0cea942ab72f63403dccf04ea02a57e4789a5a');
  assert.doesNotMatch(html, /hl-order|hl_tags|hlOrder|HlOrder|batch-btn-hl-tags/);
  assert.doesNotMatch(read('assets/live-sync-registry.js'), /hl-order/);
});

test('absence fixtures recognize revision reads while blocking every network mutation', async () => {
  for (const file of ['home-role-visibility', 'session-recovery', 'hl-order']) {
    const ast = ts.createSourceFile(file + '.ts', read(`tests/${file}.e2e.spec.ts`), ts.ScriptTarget.Latest, true);
    let callback;
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'page.route'
        && node.arguments[0]?.text === '**/*') callback = node.arguments[1];
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.ok(callback, `${file} installs its network boundary`);
    const unexpectedMutations = [];
    const code = ts.transpileModule('const handle = ' + callback.getText(ast), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const context = vm.createContext({ URL, unexpectedMutations, appOrigin: 'http://127.0.0.1:43136' });
    vm.runInContext(code + '\nglobalThis.handle = handle;', context);
    for (const [method, host, path, expected] of [
      ['POST', 'kzrnyjsosryejjejliii.supabase.co', 'get_my_dataset_revisions_v1', 0],
      ['DELETE', 'kzrnyjsosryejjejliii.supabase.co', 'get_my_dataset_revisions_v1', 1],
      ['POST', 'other.example.invalid', 'get_my_dataset_revisions_v1', 1],
      ['POST', 'kzrnyjsosryejjejliii.supabase.co', 'hl_order_command_v1', 1],
    ]) {
      unexpectedMutations.length = 0;
      let aborted = 0;
      await context.handle({
        request: () => ({ method: () => method, url: () => `https://${host}/rest/v1/rpc/${path}`, postData: () => '{}' }),
        abort: () => { aborted++; },
        continue: () => { throw new Error('The fixture must never send these requests'); },
      });
      assert.equal(aborted, 1, `${file}: ${method} ${host}/${path}`);
      assert.equal(unexpectedMutations.length, expected, `${file}: ${method} ${host}/${path}`);
    }
  }
});

const apiSource = ts.createSourceFile('app-api.ts', read('supabase/functions/app-api/index.ts'), ts.ScriptTarget.Latest, true);
const apiFunctions = ['evalReviewSource', 'evalWorkError', 'handleEvalWorkAction'];
const apiCode = ts.transpileModule(apiSource.statements
  .filter(node => ts.isFunctionDeclaration(node) && apiFunctions.includes(node.name?.text))
  .map(node => node.getText(apiSource)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const plain = (value) => JSON.parse(JSON.stringify(value));
const legacySource = { unique_id: 'rollback-row', source_table: 'ph_master_inventory', itemcode: 'ITEM.003', locationcode: 'A.01.001', lotcode: '27.F1' };
const legacyPayload = () => ({ operation: 'create', createToken: 'rollback-token', source: legacySource,
  assigneeUsernames: ['charley_robertson'], completionRecipients: ['completion@example.invalid'], instructions: 'Review this row' });

function apiFixture({ active = true, manager = true } = {}) {
  const rpcCalls = [], resolved = [];
  const assignees = [{ username: 'charley_robertson', displayName: 'Charley Robertson', email: 'verified@example.invalid' }];
  const work = { id: 'saved-work', delivery: {} };
  const context = vm.createContext({
    normalizeUsername: (value) => String(value || '').trim().toLowerCase(),
    isEvalWorkManager: () => manager,
    resolveActiveSessionProfile: async () => active ? { id: 'active-actor' } : null,
    resolveEvalWorkAssignees: async (usernames) => { resolved.push(usernames); return assignees; },
    jsonResponse: (body) => ({ status: 200, body }),
    errorResponse: (message, status, extra = {}) => ({ status, body: { ok: false, error: message, ...extra } }),
    withEvalWorkDeliveryStatus: async (row) => row,
    recordHandledError: async () => {},
    supabase: { rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: work, error: null }; } },
  });
  vm.runInContext(apiCode, context);
  return { rpcCalls, resolved, assignees, work,
    invoke: (payload, session = { username: 'dylan_collyge' }) => context.handleEvalWorkAction(session, payload) };
}

test('September 9 review requests use the compatible RPC with trusted actor and evaluator emails', async () => {
  const f = apiFixture();
  const result = await f.invoke({ ...legacyPayload(), actorUsername: 'spoofed', assigneeEmail: 'spoofed@example.invalid',
    assignees: [{ username: 'spoofed', email: 'spoofed@example.invalid' }] });
  assert.equal(result.status, 200);
  assert.equal(result.body.data, f.work);
  assert.deepEqual(f.resolved, [['charley_robertson']]);
  assert.equal(f.rpcCalls.length, 1);
  assert.equal(f.rpcCalls[0].name, 'create_eval_work_legacy_sep09_v1');
  const payload = plain(f.rpcCalls[0].args.p_payload);
  assert.equal(payload.actorUsername, 'dylan_collyge');
  assert.equal(payload.assigneeUsername, 'charley_robertson');
  assert.equal(payload.assigneeEmail, 'verified@example.invalid');
  assert.deepEqual(payload.assignees, f.assignees);
  assert.deepEqual(payload.source, legacySource);
  assert.deepEqual(payload.completionRecipients, ['completion@example.invalid']);
});

for (const [field, value] of [
  ['expectedAssignmentRevision', 'reviewed-revision'], ['expectedAssignmentRevision', ''],
  ['expectedAssignmentRevision', null], ['expectedAssignmentRevision', undefined],
  ['additionalCompletionRecipients', []], ['additionalCompletionRecipients', null],
]) {
  test(`a present ${field}=${String(value)} retains the modern confirmation contract`, async () => {
    const f = apiFixture();
    await f.invoke({ ...legacyPayload(), [field]: value });
    assert.equal(f.resolved.length, 0);
    assert.equal(f.rpcCalls.length, 1);
    assert.equal(f.rpcCalls[0].name, 'create_eval_work_multi_v1');
    const payload = f.rpcCalls[0].args.p_payload;
    for (const name of ['assigneeUsernames', 'assigneeUsername', 'assigneeEmail', 'assignees', 'completionRecipients']) {
      assert.equal(Object.hasOwn(payload, name), false, name);
    }
  });
}

for (const [name, options, session] of [
  ['anonymous', {}, null], ['inactive', { active: false }, { username: 'dylan_collyge' }],
  ['unauthorized', { manager: false }, { username: 'other-user' }],
  ['password change', {}, { username: 'dylan_collyge', mustChangePassword: true }],
]) {
  test(`legacy review rejects ${name} before resolving recipients or calling the database`, async () => {
    const f = apiFixture(options);
    const result = await f.invoke(legacyPayload(), session);
    assert.ok([401, 403].includes(result.status));
    assert.equal(f.resolved.length, 0);
    assert.equal(f.rpcCalls.length, 0);
  });
}
