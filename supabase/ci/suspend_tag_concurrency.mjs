// Committed synthetic fixtures only, on CI's disposable local PostgreSQL.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const host = process.env.PGHOST;
if (!['localhost', '127.0.0.1'].includes(host) || process.env.PGDATABASE !== 'suspend_tag_test') {
  throw new Error('Requires disposable PGDATABASE=suspend_tag_test on localhost.');
}
const env = { ...process.env, PGCONNECT_TIMEOUT: '5' };
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete env[key];
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const actor = randomUUID();
const session = randomUUID();
const run = randomUUID().slice(0, 8);
const children = new Set();
function start(name, sql, open = false) {
  const child = spawn('psql', ['-X', '-qAt', '--host', host, '--dbname', 'suspend_tag_test', '-v', 'ON_ERROR_STOP=1'], {
    env: { ...env, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { child, out: '', err: '' };
  children.add(state);
  child.stdout.on('data', data => { state.out += data; });
  child.stderr.on('data', data => { state.err += data; });
  child.stdin.on('error', error => { state.err += error.message; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
  state.done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer); children.delete(state);
      if (code !== 0) reject(new Error(`${name}: ${state.err || code}`)); else resolve(state.out);
    });
  });
  // Attach immediately: a background client can fail before the assertion joins it.
  state.done.catch(() => {});
  const prefix = "set statement_timeout='15s'; set lock_timeout='12s'; set idle_in_transaction_session_timeout='20s';\n";
  if (open) child.stdin.write(prefix + sql); else child.stdin.end(prefix + sql);
  return state;
}
const query = sql => start(`suspend-${run}-inspect`, sql).done;
const claims = { sub: actor, session_id: session, role: 'authenticated', iss: 'https://kzrnyjsosryejjejliii.supabase.co/auth/v1', exp: Math.floor(Date.now()/1000)+3600 };
const context = `begin; select set_config('request.jwt.claims',${literal(JSON.stringify(claims))},true); set local role authenticated;`;
const result = output => JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('RESULT:')).slice(7));
try {
  await query(`insert into public.profiles(id,username,role,must_change_password) values(${literal(actor)},'dylan_collyge','Admin',false);
    insert into auth.sessions values(${literal(session)},${literal(actor)},now()+interval '1 day');`);
  for (const sameToken of [false, true]) {
    const source = `synthetic-race-${run}-${sameToken}`;
    await query(`insert into public.ph_soc_master(unique_id,last_updated,suspend,suspend_to,ptronhand,ptravailable,s_lts) values(${literal(source)},'2026-09-08T12:00:00Z','SUSPEND','DC','10','8','20');`);
    const token = randomUUID();
    const call = request => `select 'RESULT:'||public.complete_suspend_tag_v1(${literal(source)},'2026-09-08T12:00:00Z',${literal(request)})::text;`;
    const first = start(`suspend-${run}-first`, context + call(token) + "select 'READY';\n", true);
    for (let i = 0; !first.out.includes('READY') && i < 200; i++) await delay(25);
    assert.ok(first.out.includes('READY'), `First command did not hold transaction: ${first.err}`);
    const secondName = `suspend-${run}-second`;
    const second = start(secondName, context + call(sameToken ? token : randomUUID()) + 'commit;');
    let waited = false;
    for (let i = 0; i < 50; i++) {
      const locks = await query(`select count(*) from pg_stat_activity where application_name=${literal(secondName)} and wait_event_type='Lock';`);
      if (locks.trim() === '1') { waited = true; break; }
      await delay(25);
    }
    assert.ok(waited, 'Concurrent command did not serialize against first transaction');
    first.child.stdin.end('commit;\n');
    const [firstAck, secondAck] = (await Promise.all([first.done, second.done])).map(result);
    assert.equal(firstAck.completedAt, secondAck.completedAt, 'No second timestamp');
    assert.equal(firstAck.alreadyCompleted, false);
    assert.equal(secondAck.alreadyCompleted, !sameToken);
    if (sameToken) assert.deepEqual(firstAck, secondAck, 'Same-token replay returns exact receipt');
    assert.equal((await query(`select count(*) from public.fixture_live_events where source_uid=${literal(source)};`)).trim(), '1', 'Exactly one source update');
    assert.equal((await query(`select ptronhand||','||ptravailable||','||s_lts from public.ph_soc_master where unique_id=${literal(source)};`)).trim(), '10,8,20', 'No stock mutation');
  }
  process.stdout.write('Concurrent Done and lost-response retry tests passed on isolated PostgreSQL.\n');
} finally {
  for (const state of children) { state.child.kill('SIGKILL'); await state.done.catch(() => {}); }
}
