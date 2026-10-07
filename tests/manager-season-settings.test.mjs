import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('app-api.ts', source, ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['handleManagerSeasonSettings', 'resolveActiveSessionProfile'].includes(node.name?.text)).map(node => node.getText(ast)).join('\n'),
{ compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const authId = '00000000-0000-4000-8000-000000000007';
const session = { authUserId: authId, username: 'dylan_collyge' };
const save = { action: 'manager_season_settings', operation: 'save', seasonCode: 'S1', salesYear: 27, expectedRevision: 3 };
function fixture(options = {}) {
  const calls = [];
  const profile = { id: authId, username: 'dylan_collyge', disabled_at: null, must_change_password: false, ...options.profile };
  const context = vm.createContext({
    jsonObject: value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('JSON object required');
      return value;
    },
    FULL_ACCESS_USER_KEYS: new Set(['dylan_collyge', 'jd_jones', 'megan_kelly']),
    normalizeUsername: value => String(value || '').trim().toLowerCase(),
    isAppAccountActive: async () => options.accountActive !== false,
    errorResponse: (error, status, extra) => ({ status, body: { ok: false, error, ...extra } }),
    jsonResponse: body => ({ status: 200, body }),
    supabase: {
      auth: { getUser: async token => { calls.push({ auth: token }); return options.auth || { data: { user: { id: authId } } }; } },
      from: table => ({ select: () => ({ eq: (key, value) => ({ maybeSingle: async () => {
        calls.push({ table, key, value }); return { data: profile };
      } }) }) }),
      rpc: async (name, args) => {
        calls.push({ name, args });
        return options.rpc || { data: { seasonCode: 'S1', salesYear: 27, revision: 4, updatedBy: profile.username, updatedAt: '2026-10-07T00:00:00Z' } };
      },
    },
  });
  vm.runInContext(code, context);
  return { calls, invoke: (payload = save, identity = session, bearer = 'Bearer fixture-token') =>
    context.handleManagerSeasonSettings(new Request('https://fixture.invalid', { headers: { authorization: bearer } }), identity, payload) };
}

test('Managers season operation uses native Auth and stored allowed username, never client audit fields', async () => {
  for (const username of ['dylan_collyge', 'jd_jones', 'megan_kelly']) {
    const f = fixture({ profile: { username } });
    assert.equal((await f.invoke(save, { ...session, username })).status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))), { name: 'aura_manager_season_settings_v1', args: {
      p_actor_id: authId, p_operation: 'save', p_season_code: 'S1', p_sales_year: 27, p_expected_revision: 3,
    } });
    assert.equal(f.calls[1].key, 'id');
  }
  assert.match(source, /if \(action === "manager_season_settings"\) return await handleManagerSeasonSettings\(req, session, payload\)/);
});

test('missing, invalid, mismatched, locked, inactive or unauthorized Manager identities fail before settings access', async () => {
  for (const options of [
    { auth: { error: { message: 'invalid' } } }, { auth: { data: { user: { id: 'someone-else' } } } },
    { profile: { username: 'Dylan_Collyge' } }, { profile: { username: 'zoe_green' } },
    { profile: { id: 'someone-else' } }, { profile: { disabled_at: '2026-01-01' } },
    { profile: { must_change_password: true } }, { profile: { locked_until: '2999-01-01' } }, { accountActive: false },
  ]) {
    const f = fixture(options); assert.equal((await f.invoke()).status, 403);
    assert.equal(f.calls.some(call => call.name), false);
  }
  for (const identity of [null, { username: 'dylan_collyge' }, { ...session, mustChangePassword: true }]) {
    const f = fixture(); assert.equal((await f.invoke(save, identity)).status, 403); assert.equal(f.calls.length, 0);
  }
  assert.equal((await fixture().invoke(save, session, '')).status, 403);
});

test('Managers validates exact operation, season, year, revision and forbids spoofed audit metadata', async () => {
  for (const change of [{ operation: 'delete' }, { seasonCode: 'U1' }, { seasonCode: 's1' }, { salesYear: null },
    { salesYear: '27' }, { salesYear: 0 }, { salesYear: 100 }, { salesYear: 27.5 },
    { expectedRevision: null }, { expectedRevision: -1 }, { expectedRevision: '3' },
    { updatedBy: 'megan_kelly' }, { actorId: 'other' }, { updatedAt: 'tomorrow' }]) {
    const f = fixture(); assert.equal((await f.invoke({ ...save, ...change })).status, 400);
    assert.equal(f.calls.some(call => call.name), false);
  }
  const f = fixture();
  assert.equal((await f.invoke({ action: 'manager_season_settings', operation: 'read' })).status, 200);
  assert.equal(f.calls.at(-1).args.p_expected_revision, undefined);
});

test('stale revisions return 409 and database failures expose no internal details', async () => {
  const conflict = await fixture({ rpc: { error: { code: '40001', message: 'AURA_MANAGER_SETTINGS_CONFLICT' } } }).invoke();
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'AURA_MANAGER_SETTINGS_CONFLICT');
  assert.equal((await fixture({ rpc: { error: { code: '42501', message: 'private details' } } }).invoke()).status, 403);
  for (const rpc of [{ error: { code: 'XX000', message: 'private details' } }, { data: null }, { data: { seasonCode: 'F1', salesYear: 27 } }]) {
    const result = await fixture({ rpc }).invoke(); assert.equal(result.status, 503);
    assert.doesNotMatch(JSON.stringify(result), /private details|XX000/);
  }
});
