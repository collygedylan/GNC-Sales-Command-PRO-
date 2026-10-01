import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const authSource = fs.readFileSync(new URL('../supabase/functions/_shared/app-auth.ts', import.meta.url), 'utf8');
const code = fs.readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
globalThis.Deno = { env: { get: key => key === 'APP_SESSION_SECRET' ? 'unit-test-only-secret-005' : undefined } };
const loadTs = async path => {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`);
};
const auth = await loadTs('../supabase/functions/_shared/app-auth.ts');
const routing = await loadTs('../supabase/functions/_shared/operational-routing.ts');
const profile = { username: 'kayla_knepp', display_name: 'Kayla', role: 'ADMIN', disabled_at: null, locked_until: null, must_change_password: false };
function client(active = true) {
  const calls = [];
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: profile, error: null }; } };
  return { calls, auth: { getUser: async () => ({ data: { user: { id: 'e2584b32-472c-4888-b592-394235050b5b' } } }) },
    from: () => query, rpc: async (name, args) => { calls.push([name, args]); return { data: active, error: null }; } };
}

test('native JWT cannot bypass an effective cutoff even before profile disable worker runs', async () => {
  const request = new Request('https://example.invalid', { headers: { authorization: 'Bearer existing-native-jwt' } });
  const before = client(true), after = client(false);
  assert.equal((await auth.readSupabaseOrAppSessionFromRequest(request, before)).username, 'kayla_knepp');
  assert.equal(await auth.readSupabaseOrAppSessionFromRequest(request, after), null);
  assert.equal(after.calls.length, 1);
  assert.equal(after.calls[0][1].p_profile_id, 'e2584b32-472c-4888-b592-394235050b5b');
});

test('previously signed legacy token is live checked; no client or lookup means denial', async () => {
  const signed = await auth.createAppSession({ username: 'kayla_knepp', role: 'ADMIN' });
  const request = new Request('https://example.invalid', { headers: { 'x-gnc-session': signed.token } });
  assert.equal((await auth.readAppSessionFromRequest(request, client(true))).username, 'kayla_knepp');
  assert.equal(await auth.readAppSessionFromRequest(request, client(false)), null);
  assert.equal(await auth.readAppSessionFromRequest(request), null);
  assert.equal(await auth.readAppSessionFromRequest(request, { rpc: async () => { throw new Error('network'); } }), null);
});

test('failed native authentication cannot bypass the cutoff with a stale legacy fallback', async () => {
  const signed = await auth.createAppSession({ username: 'kayla_knepp', role: 'ADMIN' });
  const request = new Request('https://example.invalid', { headers: { authorization: 'Bearer expired', 'x-app-session': signed.token } });
  const denied = client(false);
  denied.auth.getUser = async () => ({ error: new Error('expired') });
  assert.equal(await auth.readSupabaseOrAppSessionFromRequest(request, denied), null);
});

test('active unrelated accounts and password-change sessions keep their existing session contract', async () => {
  const signed = await auth.createAppSession({ username: 'floor_staff', role: 'sales', mustChangePassword: true });
  const request = new Request('https://example.invalid', { headers: { 'x-gnc-session': signed.token } });
  const verified = await auth.readAppSessionFromRequest(request, client(true));
  assert.equal(verified.username, 'floor_staff');
  assert.equal(verified.mustChangePassword, true);
  assert.match(authSource, /app_account_active_v1/);
});

test('Edge routing rejects resolution errors instead of using the stale recipients', async () => {
  await assert.rejects(routing.resolveOperationalRecipients({ rpc: async () => ({ error: { code: 'timeout' } }) }, ['kayla_knepp'], 'username'), /RECIPIENT_RESOLUTION_UNAVAILABLE/);
  const rows = await routing.resolveOperationalRecipients({ rpc: async () => ({ data: ['nelly_aguilar', 'nelly_aguilar'] }) }, ['kayla_knepp'], 'username');
  assert.deepEqual(rows, ['nelly_aguilar']);
});

test('a claimed service role cannot bypass the push sender account cutoff', () => {
  const push = fs.readFileSync(new URL('../supabase/functions/send-push-alert/index.ts', import.meta.url), 'utf8');
  const expression = push.match(/const hasServiceRole = ([^;]+);/)[1];
  const check = (authHeader, apiKey) => vm.runInNewContext(expression, { authHeader, apiKey, SUPABASE_SERVICE_ROLE_KEY: 'test-real-service-secret' });
  const forged = `e30.${Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase' })).toString('base64url')}.forged`;
  assert.equal(check(forged, 'anon'), false);
  assert.equal(check('previously-issued-user-token', forged), false);
  assert.equal(check('test-real-service-secret', ''), true);
  assert.equal(check('', 'test-real-service-secret'), true);
});

function mailContext(afterCutoff) {
  const sent = [];
  const context = vm.createContext({ console, PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) }, GmailApp: { sendEmail: (...args) => sent.push(args) } });
  new vm.Script(code, { filename: 'Code.gs' }).runInContext(context);
  context.callSupabaseRpc_ = (name, args) => {
    assert.equal(name, 'resolve_operational_recipients_v1');
    assert.equal(args.p_kind, 'email');
    return [...new Set(args.p_recipients.flatMap(address => address === 'kayla_knepp@greenleafnursery.com'
      ? afterCutoff ? ['nelly_aguilar@greenleafnursery.com'] : [address, 'nelly_aguilar@greenleafnursery.com'] : [address]))];
  };
  return { context, sent };
}

test('last email boundary expands overlap, dedupes across To/CC/BCC, and preserves external customers', () => {
  const { context, sent } = mailContext(false);
  context.sendOperationalEmail_('kayla_knepp@greenleafnursery.com,customer@example.org', 'Subject', 'Body', { cc: 'nelly_aguilar@greenleafnursery.com', bcc: 'dylan_collyge@greenleafnursery.com', htmlBody: '<p>Body</p>' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'kayla_knepp@greenleafnursery.com,nelly_aguilar@greenleafnursery.com,customer@example.org');
  assert.equal(sent[0][3].cc, undefined);
  assert.equal(sent[0][3].bcc, 'dylan_collyge@greenleafnursery.com');
});

test('retry with stale explicit recipients resolves Nelly at send time; failures send nothing', () => {
  const { context, sent } = mailContext(true);
  context.sendOperationalEmail_('kayla_knepp@greenleafnursery.com', 'Queued message', 'Body', {});
  assert.equal(sent[0][0], 'nelly_aguilar@greenleafnursery.com');
  context.callSupabaseRpc_ = () => { throw new Error('unavailable'); };
  assert.throws(() => context.sendOperationalEmail_('kayla_knepp@greenleafnursery.com', 'Retry', 'Body'), /unavailable/);
  assert.equal(sent.length, 1);
});

test('all GmailApp delivery paths and raw thread MIME pass the resolver; unauthenticated approvals fail closed', () => {
  assert.equal((code.match(/GmailApp\.sendEmail\(/g) || []).length, 1);
  assert.match(code, /function sendGmailApiMessage_\(options\)\s*\{\s*const headers = resolveOperationalEmailHeaders_/);
  const { context } = mailContext(true);
  context.Session = { getActiveUser: () => ({ getEmail: () => 'kayla_knepp@greenleafnursery.com' }) };
  assert.equal(context.isActiveEmailApprovalActor_('dylan'), false);
  context.Session = { getActiveUser: () => ({ getEmail: () => '' }) };
  assert.equal(context.isActiveEmailApprovalActor_('jd'), false);
});

test('threaded lifecycle receipt records resolved recipients instead of retrying for departed Kayla', () => {
  const { context } = mailContext(true);
  const rawMessages = [];
  let mimeOptions;
  context.buildMimeEmail_ = options => { mimeOptions = options; return 'resolved MIME'; };
  context.base64UrlEncode_ = value => value;
  context.Gmail = { Users: { Messages: {
    send: request => { rawMessages.push(request); return { id: 'sent-005', threadId: 'existing-thread' }; },
    get: () => ({ payload: { headers: [{ name: 'Message-ID', value: '<sent-005>' }] } }),
  } } };
  const stale = ['kayla_knepp@greenleafnursery.com'];
  const result = context.sendGmailApiMessage_({ toArray: stale, ccList: 'nelly_aguilar@greenleafnursery.com',
    bccList: 'customer@example.org', threadId: 'existing-thread', requiredRecipientEmails: stale, submitterEmails: stale });
  const receipt = context.decorateRequestLifecycleEmailResult_({ emailType: 'request_complete' }, result, { toArray: stale });
  assert.equal(rawMessages.length, 1);
  assert.equal(rawMessages[0].threadId, 'existing-thread');
  assert.equal(mimeOptions.toList, 'nelly_aguilar@greenleafnursery.com');
  assert.equal(mimeOptions.ccList, '');
  assert.equal(mimeOptions.bccList, 'customer@example.org');
  assert.deepEqual(Array.from(receipt.recipients), ['nelly_aguilar@greenleafnursery.com']);
  assert.equal(receipt.requiredRecipientsSatisfied, true);
  assert.equal(receipt.submitterIncluded, true);
});
