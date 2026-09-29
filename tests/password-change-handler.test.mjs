import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('app-api.ts', source, ts.ScriptTarget.Latest, true);
const names = ['passwordChangeFingerprint', 'readPasswordChangeSession', 'passwordReconciliationError', 'handlePasswordChange'];
const code = ts.transpileModule(ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const ready = { status: 'ready', attempt_id: 'attempt-1', profile_id: 'native-nelly', legacy_user_id: 7, username: 'nelly_aguilar', display_name: 'Nelly Aguilar', role: 'User', must_change_password: true };
const done = { ...ready, status: 'completed', must_change_password: false };
const session = { username: 'nelly_aguilar', displayName: 'Nelly Aguilar', role: 'STALE_ROLE', mustChangePassword: true };
const payload = { newPassword: 'Synthetic-next-2026!', confirmPassword: 'Synthetic-next-2026!' };

function fixture(options = {}) {
  const calls = []; let prepareCount = 0;
  const context = {
    TextEncoder, Uint8Array, crypto: webcrypto,
    Deno: { env: { get: () => options.noSecret ? '' : 'synthetic-test-signing-secret' } },
    normalizeUsername: value => String(value || '').trim().toLowerCase(),
    isForcedPasswordValue: value => value.toUpperCase() === 'WELCOME',
    errorResponse: (message, status, extra = {}) => ({ status, body: { ok: false, error: message, ...extra } }),
    jsonResponse: body => ({ status: 200, body }),
    createAppSession: async claims => { calls.push({ type: 'session', claims }); return { token: 'synthetic-session', claims: { ...claims, exp: 100 } }; },
    supabase: {
      rpc: async (name, args) => {
        calls.push({ type: name, args });
        if (name === 'prepare_password_change_profile') {
          const result = options.prepareResults?.[prepareCount++];
          return result || { data: [ready], error: options.prepareError || null };
        }
        return options.completeResult || { data: [done], error: options.completeError || null };
      },
      auth: {
        getUser: async token => { calls.push({ type: 'getUser', token }); return options.nativeIdentity || { data: { user: { id: 'native-nelly' } }, error: null }; },
        admin: {
          createUser: async args => { calls.push({ type: 'createUser', args }); if (options.createThrows) throw new Error('ambiguous private create error'); return { data: { user: { id: 'native-nelly' } }, error: null }; },
          updateUserById: async (id, args) => { calls.push({ type: 'updateUserById', id, args }); if (options.updateThrows) throw new Error('private timeout'); return { error: options.updateError || null }; },
        },
      },
    },
  };
  vm.createContext(context); vm.runInContext(code, context);
  return { calls, context, invoke: (body = payload, actor = session) => context.handlePasswordChange(actor, body) };
}

test('password handler reconciles before Auth and atomically completes before issuing current-role session', async () => {
  const f = fixture(); const result = await f.invoke({ ...payload, username: 'other', authUserId: 'other' });
  assert.equal(result.status, 200);
  assert.deepEqual(f.calls.map(call => call.type), ['prepare_password_change_profile', 'updateUserById', 'complete_password_change_profile', 'session']);
  assert.equal(f.calls[0].args.p_username, 'nelly_aguilar');
  assert.equal(f.calls[0].args.p_auth_user_id, null);
  assert.equal('p_password' in f.calls[0].args, false);
  assert.match(f.calls[0].args.p_password_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(f.calls[2].args.p_password_fingerprint, f.calls[0].args.p_password_fingerprint);
  assert.equal(f.calls[3].claims.role, 'User');
  assert.equal(result.body.session.mustChangePassword, false);
  assert.doesNotMatch(JSON.stringify(result), /Synthetic-next|password_fingerprint|attempt-1/);
});

for (const error of [
  { code: '23505', message: 'password_change_duplicate_legacy_username private detail' },
  { code: '23505', message: 'password_change_identity_conflict private detail' },
  { code: '23505', message: 'password_change_profile_link_conflict private detail' },
  { code: '42501', message: 'password_change_inactive_account private detail' },
  { code: '40001', message: 'password_change_attempt_conflict private detail' },
]) test(`prepare rejects ${error.message.split(' ')[0]} before changing credentials`, async () => {
  const f = fixture({ prepareError: error }); const result = await f.invoke();
  assert.ok([403, 409].includes(result.status));
  assert.deepEqual(f.calls.map(call => call.type), ['prepare_password_change_profile']);
  assert.doesNotMatch(JSON.stringify(result), /private detail/);
});

test('verified native UUID is supplied and a mismatched prepared account never changes credentials', async () => {
  const f = fixture(); const result = await f.invoke(payload, { ...session, authUserId: 'different-native' });
  assert.equal(f.calls[0].args.p_auth_user_id, 'different-native');
  assert.equal(result.status, 409); assert.equal(f.calls.length, 1);
});

test('deferred native account is created only from verified database attributes then re-prepared', async () => {
  const f = fixture({ prepareResults: [{ data: [{ ...ready, status: 'needs_native_identity', profile_id: null }] }, { data: [ready] }] });
  assert.equal((await f.invoke()).status, 200);
  assert.deepEqual(f.calls.map(call => call.type), ['prepare_password_change_profile', 'createUser', 'prepare_password_change_profile', 'updateUserById', 'complete_password_change_profile', 'session']);
  assert.equal(f.calls[1].args.email, 'nelly_aguilar@greenleafnursery.com');
  assert.equal(f.calls[1].args.app_metadata.legacy_user_id, 7);
  assert.equal(f.calls[1].args.app_metadata.role, 'User');
});

test('ambiguous native create can recover through identity revalidation without deleting accounts', async () => {
  const f = fixture({ createThrows: true, prepareResults: [{ data: [{ ...ready, status: 'needs_native_identity', profile_id: null }] }, { data: [ready] }] });
  assert.equal((await f.invoke()).status, 200);
  assert.equal(f.calls.filter(call => call.type === 'createUser').length, 1);
});

for (const options of [{ updateError: { message: 'private Auth error' } }, { updateThrows: true }, { completeError: { message: 'private SQL error' } }, { completeResult: { data: [] } }, { completeResult: { data: [{ ...done, must_change_password: true }] } }, { completeResult: { data: [{ ...done, profile_id: 'other' }] } }]) {
  test(`uncertain or incomplete synchronization keeps password gate (${Object.keys(options)[0]} ${JSON.stringify(options.completeResult || '')})`, async () => {
    const f = fixture(options); const result = await f.invoke();
    assert.equal(result.status, 503); assert.equal(result.body.code, 'PASSWORD_CHANGE_RETRY_REQUIRED');
    assert.match(result.body.error, /same new password/);
    assert.equal(f.calls.some(call => call.type === 'session'), false);
    assert.doesNotMatch(JSON.stringify(result), /private (?:Auth|SQL|timeout)/);
  });
}

test('same-password retry uses stable private fingerprint and can finish after partial synchronization', async () => {
  const options = { completeError: { message: 'unavailable' } }; const f = fixture(options);
  assert.equal((await f.invoke()).status, 503);
  options.completeError = null;
  assert.equal((await f.invoke()).status, 200);
  const prepares = f.calls.filter(call => call.type === 'prepare_password_change_profile');
  assert.equal(prepares[0].args.p_password_fingerprint, prepares[1].args.p_password_fingerprint);
});

test('lost successful response returns confirmed session without repeating Auth update', async () => {
  const f = fixture({ prepareResults: [{ data: [done] }] });
  assert.equal((await f.invoke()).status, 200);
  assert.deepEqual(f.calls.map(call => call.type), ['prepare_password_change_profile', 'session']);
});

test('optional password change is not allowed through this forced-reset handler', async () => {
  const f = fixture({ prepareResults: [{ data: [{ status: 'password_change_not_required' }] }] });
  assert.equal((await f.invoke()).body.code, 'PASSWORD_CHANGE_NOT_REQUIRED');
  assert.equal(f.calls.length, 1);
});

test('invalid/anonymous input and missing signing secret never change an account', async () => {
  for (const body of [{ newPassword: 'tiny', confirmPassword: 'tiny' }, { ...payload, confirmPassword: 'different' }, { newPassword: 'WELCOME', confirmPassword: 'WELCOME' }]) {
    const f = fixture(); assert.equal((await f.invoke(body)).status, 400); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); assert.equal((await f.invoke(payload, null)).status, 401); assert.equal(f.calls.length, 0);
  const missing = fixture({ noSecret: true }); assert.equal((await missing.invoke()).status, 503); assert.equal(missing.calls.length, 0);
});

test('missing-profile fallback accepts only a verified bearer UUID, with no client-supplied role or username', async () => {
  const f = fixture();
  const resolved = await f.context.readPasswordChangeSession(new Request('http://localhost', { headers: { Authorization: 'Bearer verified-token' } }), null);
  assert.equal(resolved.authUserId, 'native-nelly'); assert.equal(resolved.username, ''); assert.equal(resolved.role, '');
  assert.equal(resolved.mustChangePassword, true);
  const denied = fixture({ nativeIdentity: { data: null, error: { message: 'invalid' } } });
  assert.equal(await denied.context.readPasswordChangeSession(new Request('http://localhost', { headers: { Authorization: 'Bearer invalid' } }), null), null);
  assert.equal(await denied.context.readPasswordChangeSession(new Request('http://localhost'), null), null);
  assert.match(source, /action === "password_change"\) return await handlePasswordChange\(await readPasswordChangeSession\(req, session\), payload\)/);
});
