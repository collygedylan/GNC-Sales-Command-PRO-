import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('app-api.ts', source, ts.ScriptTarget.Latest, true);
const names = ['handleRequestQueueRemove', 'databaseFailureResponse', 'isRequestRemovalTimestamp'];
const code = ts.transpileModule(ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const command = {
  action: 'request_queue_remove', uid: 'request-row-42', idempotencyKey: '01234567-89ab-4cde-8f01-234567890123',
  expectedRowVersion: 7, expectedUpdatedAt: '2026-10-09T12:34:56.123456Z',
};
function setup(options = {}) {
  const calls = [];
  const context = vm.createContext({
    Number, Date, String, Object, Array, Set, Error, Promise,
    jsonObject: value => value && typeof value === "object" && !Array.isArray(value) ? value : {},
    resolveActiveSessionProfile: async session => {
      if (!session || options.inactive) throw new Error('inactive');
      return { id: options.actorId || 'verified-profile-id' };
    },
    errorResponse: (message, status, extra = {}) => ({ status, body: { ok: false, ...extra } }),
    jsonResponse: body => ({ status: 200, body }),
    supabase: { rpc: async (name, args) => {
      calls.push({ name, args });
      return options.rpc || { data: { uid: command.uid, state: 'removed', idempotencyKey: command.idempotencyKey, replayed: false }, error: null };
    } },
  });
  vm.runInContext(code, context);
  return { calls, run: (payload = command, session = { username: 'manager_fixture' }) => context.handleRequestQueueRemove(session, payload) };
}

test('queue removal derives actor from verified session and forwards revision plus idempotency fields', async () => {
  const fixture = setup();
  const result = await fixture.run(command, { username: 'manager_fixture', actorId: 'forged' });
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.calls)), [{ name: 'request_queue_remove_v1', args: {
    p_actor_id: 'verified-profile-id', p_uid: command.uid, p_expected_row_version: 7,
    p_expected_updated_at: command.expectedUpdatedAt, p_idempotency_key: command.idempotencyKey,
  } }]);
  const uppercase = setup();
  assert.equal((await uppercase.run({ ...command, idempotencyKey: command.idempotencyKey.toUpperCase() })).status, 200);
  assert.equal(uppercase.calls[0].args.p_idempotency_key, command.idempotencyKey, 'UUID receipts use the PostgreSQL canonical lowercase representation');
});

test('missing, inactive, malformed, and extra-field commands never reach the RPC', async () => {
  const fixture = setup();
  assert.equal((await fixture.run(command, null)).status, 401);
  assert.equal((await setup({ inactive: true }).run()).status, 403);
  assert.equal((await fixture.run(command, { username: 'manager_fixture', mustChangePassword: true })).status, 403, 'mandatory password-change sessions are inactive for commands');
  for (const invalid of [
    { ...command, uid: '  ' }, { ...command, uid: 'x'.repeat(241) },
    { ...command, expectedRowVersion: 0 }, { ...command, expectedRowVersion: 1.5 },
    { ...command, expectedRowVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...command, expectedUpdatedAt: '2026-10-09' },
    { ...command, expectedUpdatedAt: '2026-10-09T99:00:00Z' },
    { ...command, expectedUpdatedAt: '2026-02-30T12:00:00Z' },
    { ...command, idempotencyKey: 'bad-key' }, { ...command, extra: true },
  ]) assert.equal((await fixture.run(invalid)).status, 400);
  assert.equal(fixture.calls.length, 0);
});

test('database errors map forbidden, conflict, missing, invalid, and transient failures without success', async () => {
  for (const [code, status] of [['42501',403], ['PT409',409], ['PT404',404], ['PT400',400], ['57014',503]]) {
    const fixture = setup({ rpc: { data: null, error: { code } } });
    assert.equal((await fixture.run()).status, status, code);
    assert.equal(fixture.calls.length, 1);
  }
});

test('malformed RPC response fails closed and exact removal replay is returned', async () => {
  for (const data of [null, [], 'removed', { uid: command.uid, state: 'archived' }]) {
    assert.equal((await setup({ rpc: { data, error: null } }).run()).status, 503);
  }
  const bad = setup({ rpc: { data: { uid: 'other-row', state: 'removed', idempotencyKey: command.idempotencyKey, replayed: true }, error: null } });
  assert.equal((await bad.run()).status, 503);
  const retry = setup({ rpc: { data: { uid: command.uid, state: 'removed', idempotencyKey: command.idempotencyKey, replayed: true }, error: null } });
  assert.deepEqual(JSON.parse(JSON.stringify((await retry.run()).body)), { ok: true, data: { uid: command.uid, state: 'removed', idempotencyKey: command.idempotencyKey, replayed: true } });
});

