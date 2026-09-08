// Execute only against the disposable PostgreSQL service created by CI.
// This harness deliberately commits synthetic fixtures so separate sessions can
// race. It does not connect to Supabase or modify imported stock after seeding.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const host = process.env.PGHOST;
if (process.env.PGDATABASE !== 'pending_orders_test'
    || !['localhost', '127.0.0.1'].includes(host)) {
  throw new Error('Concurrency tests require PGDATABASE=pending_orders_test and PGHOST=localhost or 127.0.0.1.');
}

const environment = { ...process.env, PGCONNECT_TIMEOUT: '5' };
// Prevent a libpq service or address override from bypassing the local guard.
delete environment.PGHOSTADDR;
delete environment.PGSERVICE;
delete environment.PGSERVICEFILE;
const actor = '54c87ebf-d76d-452b-96b4-beaaeb1742d9';
const session = randomUUID();
const run = randomUUID().slice(0, 8);
const sourceId = `pending-concurrency-${run}`;
const rowId = createHash('sha256').update(sourceId).digest('hex');
const processes = new Set();
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;

function startPsql(name, sql, { open = false } = {}) {
  const child = spawn('psql', [
    '-X', '-qAt', '--host', host, '--dbname', 'pending_orders_test',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
  ], {
    env: { ...environment, PGAPPNAME: name },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const processState = { child, stdout: '', stderr: '', settled: false, timedOut: false };
  processes.add(processState);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', value => { processState.stdout += value; });
  child.stderr.on('data', value => { processState.stderr += value; });
  // EPIPE is reported together with the child's exit/error below.
  child.stdin.on('error', error => { processState.stderr += `\nstdin: ${error.message}`; });
  let timer;
  processState.done = new Promise(resolve => {
    const finish = (code, signal, error) => {
      if (processState.settled) return;
      processState.settled = true;
      clearTimeout(timer);
      processes.delete(processState);
      resolve({ code, signal, error, stdout: processState.stdout,
        stderr: processState.stderr, timedOut: processState.timedOut });
    };
    child.on('error', error => finish(-1, null, error.message));
    child.on('close', (code, signal) => finish(code, signal));
    timer = setTimeout(() => {
      processState.timedOut = true;
      child.kill('SIGKILL');
    }, 25_000);
  });
  const prefix = "set statement_timeout = '15s';\nset lock_timeout = '12s';\nset idle_in_transaction_session_timeout = '20s';\n";
  if (open) child.stdin.write(prefix + sql);
  else child.stdin.end(prefix + sql);
  return processState;
}

function requireSuccess(result, label) {
  assert.equal(result.timedOut, false, `${label}: process timed out`);
  assert.equal(result.code, 0, `${label}: ${result.error || result.stderr || result.signal}`);
  return result;
}

function resultJson(result, label) {
  const rows = result.stdout.split(/\r?\n/).filter(line => line.startsWith('RESULT:'));
  assert.equal(rows.length, 1, `${label}: expected one JSON result, received ${rows.length}`);
  return JSON.parse(rows[0].slice('RESULT:'.length));
}

async function query(sql, label) {
  const result = await startPsql(`pending-${run}-inspect`, sql).done;
  return requireSuccess(result, label);
}

async function inspect(expression, label) {
  return resultJson(await query(`select 'RESULT:' || (${expression})::text;\n`, label), label);
}

function commandSql(action, payload, token) {
  return `
begin;
set local role authenticated;
do $claims$ begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', ${literal(actor)}, 'session_id', ${literal(session)},
    'iss', 'https://kzrnyjsosryejjejliii.supabase.co/auth/v1',
    'exp', extract(epoch from now()) + 3600)::text, true);
end $claims$;
select 'RESULT:' || public.bloomscapes_pending_command(
  ${literal(action)}, ${json(payload)}, ${literal(token)}::uuid)::text;
commit;
`;
}

async function command(action, payload, token = randomUUID()) {
  const result = await startPsql(`pending-${run}-seed`, commandSql(action, payload, token)).done;
  return resultJson(requireSuccess(result, action), action);
}

async function waitUntil(check, label, deadlineMs = 10_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}

async function race(label, commands) {
  const controller = startPsql(`pending-${run}-${label}-gate`, `
begin;
select pg_advisory_xact_lock(hashtextextended(${literal(`bloomscapes-pending:${actor}`)}, 0));
select 'CONTROLLER_READY';
`, { open: true });
  const workers = [];
  try {
    await waitUntil(() => {
      if (controller.settled) throw new Error(`Controller exited before its barrier: ${controller.stderr}`);
      return controller.stdout.split(/\r?\n/).includes('CONTROLLER_READY');
    }, `${label}: controller acquired the actor lock`);
    for (let index = 0; index < commands.length; index += 1) {
      const name = `pending-${run}-${label}-${index}`;
      workers.push({ name, process: startPsql(name, commands[index]) });
    }
    await waitUntil(async () => {
      for (const worker of workers) {
        if (worker.process.settled) {
          const outcome = await worker.process.done;
          throw new Error(`${label}: worker exited before overlapping: ${outcome.stderr || outcome.stdout}`);
        }
      }
      const blocked = await inspect(`(select count(*) from pg_stat_activity
        where application_name in (${workers.map(worker => literal(worker.name)).join(',')})
          and state = 'active' and wait_event_type = 'Lock' and wait_event = 'advisory')`, `${label}: barrier`);
      return blocked === commands.length;
    }, `${label}: both workers blocked on the actor lock`);
    controller.child.stdin.end('commit;\n');
    requireSuccess(await controller.done, `${label}: release barrier`);
    return await Promise.all(workers.map(worker => worker.process.done));
  } finally {
    if (!controller.settled) {
      controller.child.kill('SIGKILL');
      await controller.done;
    }
    for (const worker of workers) {
      if (!worker.process.settled) worker.process.child.kill('SIGKILL');
    }
    await Promise.all(workers.map(worker => worker.process.done));
  }
}

const stockExpression = "(select coalesce(jsonb_agg(to_jsonb(m) order by unique_id), '[]'::jsonb) from public.ph_master_inventory m)";
const cartPayload = quantity => ({
  cartId: null, revision: 0, tier: 'retail', customerName: 'Synthetic concurrency fixture',
  note: `Disposable CI run ${run}`, lines: [{ rowId, quantity }],
});

async function main() {
  await query(`
begin;
insert into public.profiles(id,username,disabled_at,locked_until,must_change_password)
values (${literal(actor)}::uuid,'dylan_collyge',null,null,false)
on conflict(id) do update set username=excluded.username,disabled_at=null,locked_until=null,must_change_password=false;
insert into auth.sessions(id,user_id,not_after)
values (${literal(session)}::uuid,${literal(actor)}::uuid,now()+interval '1 day');
insert into public.ph_app_settings(key,value) values('current_season_salesyear','{"seasonCode":"F1","salesYear":27}')
on conflict(key) do update set value=excluded.value;
insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,season,saleyear,listprice,s_lts,ptronhand,ptravailable,spec)
values (${literal(sourceId)},'TEST-RACE','Synthetic Test Oak','#5','TEST.RACE','27.F1','F1','27','23.00','100','100','100','4 ft');
commit;
`, 'commit synthetic fixtures');
  const beforeStock = await inspect(stockExpression, 'stock before concurrency');
  const saved = await command('save_cart', cartPayload(2));
  const checkoutPayload = { cartId: saved.cart.id, revision: saved.cart.revision };
  const checkoutTokens = [randomUUID(), randomUUID()];
  const checkoutResults = await race('checkout', checkoutTokens.map(token => commandSql('checkout', checkoutPayload, token)));
  const checkouts = checkoutResults.map((result, index) => resultJson(requireSuccess(result, `checkout ${index}`), `checkout ${index}`));
  assert.deepEqual(checkouts[0], checkouts[1], 'different checkout tokens must return the same order response');
  const order = checkouts[0].order;
  assert.equal(order.status, 'pending');
  assert.equal(order.payment_status, 'unpaid');
  assert.equal(order.stock_reserved, false);
  assert.equal(order.subtotal_cents, 11500);
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0].quantity, 2);
  const checkoutState = await inspect(`jsonb_build_object(
    'orders', (select count(*) from bloomscapes_private.orders where cart_id=${literal(saved.cart.id)}::uuid),
    'lines', (select count(*) from bloomscapes_private.order_lines where order_id=${literal(order.id)}::uuid),
    'cart', (select to_jsonb(c) from bloomscapes_private.carts c where id=${literal(saved.cart.id)}::uuid),
    'receipts', (select jsonb_agg(jsonb_build_object('request_id',request_id,'response',response) order by request_id)
      from bloomscapes_private.commands where owner_id=${literal(actor)}::uuid
        and request_id in (${checkoutTokens.map(token => `${literal(token)}::uuid`).join(',')})))`, 'checkout persisted state');
  assert.equal(checkoutState.orders, 1, 'only one order may be created for the cart');
  assert.equal(checkoutState.lines, 1, 'order lines must not be duplicated');
  assert.equal(checkoutState.cart.revision, saved.cart.revision + 1, 'checkout changes revision once');
  assert.equal(checkoutState.cart.submitted_order_id, order.id);
  assert.equal(checkoutState.receipts.length, 2, 'both distinct successful tokens receive receipts');
  for (const receipt of checkoutState.receipts) assert.deepEqual(receipt.response, checkouts[0]);
  assert.deepEqual(await inspect(stockExpression, 'stock after checkout'), beforeStock, 'checkout must not change imported inventory');
  console.log('PASS: overlapping distinct-token checkout creates one unpaid, unreserved order.');

  const open = await command('save_cart', cartPayload(1));
  const editTokens = [randomUUID(), randomUUID()];
  const edits = [3, 4].map((quantity, index) => ({
    ...cartPayload(quantity), cartId: open.cart.id, revision: open.cart.revision,
    note: `Concurrent edit ${index} (${run})`,
  }));
  const editResults = await race('save', edits.map((payload, index) => commandSql('save_cart', payload, editTokens[index])));
  const winners = editResults.flatMap((result, index) => result.code === 0 ? [index] : []);
  assert.equal(winners.length, 1, 'exactly one edit of the same cart revision may succeed');
  const winner = winners[0];
  const loser = 1 - winner;
  assert.equal(editResults[loser].timedOut, false, 'stale edit must fail with a validation error, not a timeout');
  assert.equal(editResults[loser].code, 3, 'psql must stop on the stale command SQL error');
  assert.match(editResults[loser].stderr, /P0001: Cart changed\. Refresh before editing\./, 'expected stale revision error');
  const winnerResult = resultJson(requireSuccess(editResults[winner], 'winning edit'), 'winning edit');
  const editState = await inspect(`jsonb_build_object(
    'cart', (select to_jsonb(c) from bloomscapes_private.carts c where id=${literal(open.cart.id)}::uuid),
    'orders', (select count(*) from bloomscapes_private.orders where cart_id=${literal(open.cart.id)}::uuid),
    'receipts', (select coalesce(jsonb_agg(jsonb_build_object('request_id',request_id,'response',response)), '[]'::jsonb)
      from bloomscapes_private.commands where owner_id=${literal(actor)}::uuid
        and request_id in (${editTokens.map(token => `${literal(token)}::uuid`).join(',')})))`, 'edit persisted state');
  assert.deepEqual(editState.cart, winnerResult.cart, 'persisted cart must equal the winning response');
  assert.equal(editState.cart.revision, open.cart.revision + 1, 'concurrent edits increment revision once');
  assert.equal(editState.cart.lines[0].quantity, edits[winner].lines[0].quantity);
  assert.equal(editState.cart.note, edits[winner].note);
  assert.equal(editState.cart.submitted_order_id, null);
  assert.equal(editState.orders, 0, 'saving a cart must not create an order');
  assert.equal(editState.receipts.length, 1, 'only the winning edit may persist a receipt');
  assert.equal(editState.receipts[0].request_id, editTokens[winner]);
  assert.deepEqual(editState.receipts[0].response, winnerResult);
  assert.deepEqual(await inspect(stockExpression, 'stock after edits'), beforeStock, 'cart edits must not change imported inventory');
  console.log('PASS: overlapping stale saves have one winner and preserve imported inventory.');
}

try {
  await main();
  console.log('Pending-order concurrency tests passed in the disposable CI database.');
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
} finally {
  const remaining = [...processes];
  for (const processState of remaining) processState.child.kill('SIGKILL');
  await Promise.all(remaining.map(processState => processState.done));
}
