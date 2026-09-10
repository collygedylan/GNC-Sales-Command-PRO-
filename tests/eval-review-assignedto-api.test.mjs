import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const code = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const sourceFile = ts.createSourceFile('app-api.ts', code, ts.ScriptTarget.Latest, true);
const functions = ['evalReviewSource', 'evalWorkError', 'handleEvalWorkAction'];
const extracted = sourceFile.statements.filter((node) => ts.isFunctionDeclaration(node) && functions.includes(node.name?.text)).map((node) => node.getText(sourceFile)).join('\n');
const compiled = ts.transpileModule(extracted, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ active = true, manager = true, rpcError = null } = {}) {
  const calls = [];
  const setup = { evaluator: { username: 'charley_robertson', displayName: 'Charley Robertson', email: 'charley@example.invalid' }, assignmentRevision: 'frozen-revision' };
  const work = { id: 'frozen-review', assignee_username: 'charley_robertson', completion_recipients: ['charley@example.invalid'], delivery: {} };
  const context = {
    normalizeUsername: (value) => String(value || '').trim().toLowerCase(),
    isEvalWorkManager: () => manager,
    resolveActiveSessionProfile: async () => active ? { id: 'actor-profile' } : null,
    jsonResponse: (body) => ({ status: 200, body }),
    errorResponse: (message, status, extra = {}) => ({ status, body: { ok: false, error: message, ...extra } }),
    withEvalWorkDeliveryStatus: async (row) => row,
    recordHandledError: async () => {},
    resolveEvalWorkAssignees: () => { throw new Error('single review must never resolve client evaluators'); },
    supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'get_eval_work_review_setup_v1' ? setup : work, error: rpcError }; } },
  };
  vm.createContext(context);
  vm.runInContext(compiled, context);
  return { calls, setup, work, invoke: (payload, session = { username: 'dylan_collyge' }) => context.handleEvalWorkAction(session, payload) };
}

const origin = { unique_id: 'opening-row', source_table: 'ph_master_inventory', itemcode: '006535.030.1', locationcode: 'I.13.000', lotcode: '27.S1' };

test('review setup authenticates and forwards only exact source and session actor', async () => {
  const f = fixture();
  const result = await f.invoke({ operation: 'review_setup', actorUsername: 'other-user', assigneeUsername: 'other-user', source: { ...origin, assignedto: 'other-user' } });
  assert.equal(result.body.setup, f.setup);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [{ name: 'get_eval_work_review_setup_v1', args: { p_payload: { actorUsername: 'dylan_collyge', source: origin } } }]);
});

test('creation ignores evaluator, required recipients, and actor overrides; RPC owns frozen replay', async () => {
  const f = fixture();
  const result = await f.invoke({ operation: 'create', createToken: 'stable-create-token', source: origin, actorUsername: 'spoofed', assigneeUsername: 'spoofed', assignees: [{ username: 'spoofed' }], completionRecipients: ['spoofed@example.invalid'], additionalCompletionRecipients: ['extra@example.invalid'], expectedAssignmentRevision: 'reviewed-revision', instructions: 'Keep this instruction' });
  assert.equal(result.body.data, f.work);
  const payload = f.calls[0].args.p_payload;
  assert.equal(f.calls[0].name, 'create_eval_work_multi_v1');
  assert.equal(payload.actorUsername, 'dylan_collyge');
  assert.equal(payload.expectedAssignmentRevision, 'reviewed-revision');
  assert.deepEqual(Array.from(payload.additionalCompletionRecipients), ['extra@example.invalid']);
  for (const key of ['assignees', 'assigneeUsername', 'assigneeEmail', 'completionRecipients']) assert.equal(key in payload, false);
  assert.equal(f.calls.length, 1, 'no current-assignment read before idempotent RPC');
});

for (const operation of ['review_setup', 'create']) {
  for (const [label, options, session] of [['anonymous', {}, null], ['inactive', { active: false }, { username: 'dylan_collyge' }], ['unauthorized', { manager: false }, { username: 'other' }], ['password change', {}, { username: 'dylan_collyge', mustChangePassword: true }]]) {
    test(`${operation} denies ${label} before reading assignment or creating work`, async () => {
      const f = fixture(options);
      const result = await f.invoke({ operation, source: origin }, session);
      assert.ok(result.status === 401 || result.status === 403);
      assert.equal(f.calls.length, 0);
    });
  }
}

for (const errorCode of ['REVIEW_SOURCE_MISSING', 'REVIEW_SOURCE_STALE', 'REVIEW_ASSIGNMENT_MISSING', 'REVIEW_ASSIGNMENT_AMBIGUOUS', 'REVIEW_ASSIGNEE_INELIGIBLE', 'REVIEW_ASSIGNEE_INACTIVE', 'REVIEW_ASSIGNEE_EMAIL_MISSING', 'REVIEW_ASSIGNMENT_CHANGED', 'REVIEW_CONFIRMATION_REQUIRED', 'REVIEW_RECIPIENT_INVALID']) {
  test(`${errorCode} returns specific sanitized retry guidance`, async () => {
    const f = fixture({ rpcError: { code: '40001', message: `${errorCode}: private@example.invalid internal detail` } });
    const result = await f.invoke({ operation: 'create', source: origin });
    assert.equal(result.body.code, errorCode);
    assert.match(result.body.error, /row|AssignedTo|recipient|review/i);
    assert.doesNotMatch(JSON.stringify(result), /private@example|internal detail/);
  });
}

test('unknown service failures do not expose raw database errors', async () => {
  const f = fixture({ rpcError: { code: 'XX000', message: 'private@example.invalid internal database details' } });
  const result = await f.invoke({ operation: 'review_setup', source: origin });
  assert.doesNotMatch(JSON.stringify(result), /private@example|internal database/);
});
