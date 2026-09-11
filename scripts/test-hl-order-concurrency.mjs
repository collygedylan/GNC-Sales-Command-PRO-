import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Committed synthetic fixtures are necessary for real independent sessions.
// This script is restricted to a disposable loopback CI database.
const connectionString = process.env.HL_ORDER_TEST_DB_URL || '';
const target = new URL(connectionString || 'postgresql://invalid');
assert.equal(process.env.CI, 'true', 'HL concurrency fixtures require isolated CI');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'Hosted database fixtures forbidden');
assert.equal(target.pathname, '/postgres');
const options = { connectionString, connectionTimeoutMillis: 10_000, statement_timeout: 15_000,
  application_name: 'isolated_hl_order_concurrency_test' };
const admin = new pg.Client(options);
const clients = [];
const actor = randomUUID(), session = randomUUID(), prefix = `HL-CONCURRENT-${randomUUID()}`;
const ids = [`${prefix}-A`, `${prefix}-B`, `${prefix}-ADDITION`];
const claims = { role: 'authenticated', sub: actor, session_id: session,
  iss: 'https://kzrnyjsosryejjejliii.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600 };
const state = async client => (await client.query('select public.hl_order_state() state')).rows[0].state;
const command = async (client, action, payload, revision, id = randomUUID()) =>
  (await client.query('select public.hl_order_command($1,$2,$3::jsonb,$4) state', [id, action, JSON.stringify(payload), revision])).rows[0].state;
const authenticate = async (client, service = false) => {
  await client.query("select set_config('request.jwt.claims',$1,false),set_config('request.jwt.claim.role',$2,false)",
    [JSON.stringify(service ? { role: 'service_role' } : claims), service ? 'service_role' : 'authenticated']);
  await client.query(service ? 'set role service_role' : 'set role authenticated');
};
let committed = false;
await admin.connect();
try {
  assert.equal((await admin.query("select count(*)::int n from public.profiles where username='dylan_collyge'")).rows[0].n, 0,
    'Synthetic Dylan name is occupied; never overwrite a real profile');
  await admin.query('begin');
  await admin.query("insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,'{}','{}')", [actor, `${actor}@hl-concurrency.example.invalid`]);
  await admin.query("insert into public.profiles(id,username,display_name,role,must_change_password) values($1,'dylan_collyge','HL concurrency','ADMIN',false)", [actor]);
  await admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [session, actor]);
  for (const id of ids) await admin.query("insert into public.ph_soc_master(unique_id,itemcode,contsize,locationcode,lotcode,quantityordered,dock,planstart,transactionnumber) values($1,$1,'#3','C.12.4','27.S1','10','D1','2026-09-15',$1)", [id]);
  await admin.query('commit'); committed = true;
  for (let i = 0; i < 10; i++) {
    const client = new pg.Client(options); clients.push(client); await client.connect(); await authenticate(client);
  }
  let initial = await state(clients[0]);
  const sameId = randomUUID(), draftPayload = { rows: [{ source_id: ids[0], quantity: 6 }] };
  const repeated = await Promise.all(clients.map(client => command(client, 'draft_save', draftPayload, initial.revision, sameId)));
  for (const response of repeated) assert.deepEqual(response, repeated[0], 'Concurrent command retries must return the saved response');
  assert.equal((await admin.query('select count(*)::int n from hl_order_private.commands where command_id=$1', [sameId])).rows[0].n, 1);
  initial = await state(clients[0]);
  const competing = await Promise.allSettled(clients.slice(0, 2).map((client, index) =>
    command(client, 'draft_save', { rows: [{ source_id: ids[0], quantity: index + 3 }] }, initial.revision)));
  assert.equal(competing.filter(x => x.status === 'fulfilled').length, 1, 'Only one stale-tab edit may win CAS');
  assert.equal(competing.find(x => x.status === 'rejected').reason.message, 'HL_ORDER_REVISION_CONFLICT');
  initial = await state(clients[0]);
  const previewed = await command(clients[0], 'preview', {}, initial.revision);
  const submitted = await Promise.allSettled(clients.slice(0, 2).map(client =>
    command(client, 'submit', { preview_id: previewed.preview.id }, previewed.revision)));
  assert.equal(submitted.filter(x => x.status === 'fulfilled').length, 1, 'One preview may create only one order');
  assert.equal(submitted.find(x => x.status === 'rejected').reason.message, 'HL_ORDER_REVISION_CONFLICT');
  const queued = submitted.find(x => x.status === 'fulfilled').value;
  const order = queued.orders.find(x => x.created_by === actor);
  assert.equal((await admin.query("select count(*)::int n from public.ph_request_delivery_outbox where payload->>'created_by'=$1", [actor])).rows[0].n, 1);

  // Hold the same row the worker holds before its AFTER trigger acquires state.
  // A user reconciliation must SKIP LOCKED and fail fast, never invert locks.
  await authenticate(clients[2], true);
  await clients[2].query('begin');
  await clients[2].query('select event_id from public.ph_request_delivery_outbox where event_id=$1 for update', [order.event_id]);
  await assert.rejects(command(clients[0], 'reconcile_delivery', { event_id: order.event_id }, queued.revision), /HL_ORDER_DELIVERY_BUSY/);
  await clients[2].query('commit');
  const lease = randomUUID();
  await admin.query("update public.ph_request_delivery_outbox set status='processing',lease_token=$2,lease_expires_at=now()+interval '2 minutes' where event_id=$1", [order.event_id, lease]);
  await clients[2].query("select public.hl_order_delivery_record_v1($1,$2,'sending','{}')", [order.event_id, lease]);
  await clients[2].query("select public.hl_order_delivery_record_v1($1,$2,'sent','{\"gmail_message_id\":\"synthetic-concurrency-receipt\"}')", [order.event_id, lease]);
  assert.equal((await state(clients[0])).orders.find(x => x.id === order.id).status, 'sent');

  // Concurrent previews/additions must share the open order and create one new batch.
  initial = await state(clients[0]);
  const additionDraft = await command(clients[0], 'draft_save', { rows: [{ source_id: ids[2], quantity: 3 }] }, initial.revision);
  const previews = await Promise.allSettled(clients.slice(0, 2).map(client =>
    command(client, 'preview', { ship_date: '2026-09-15' }, additionDraft.revision)));
  assert.equal(previews.filter(x => x.status === 'fulfilled').length, 1, 'Only one concurrent addition preview may win CAS');
  const additionPreview = previews.find(x => x.status === 'fulfilled').value;
  assert.equal(additionPreview.preview.report.order_id, order.id);
  assert.equal(additionPreview.preview.report.order_number, order.order_number);
  assert.equal(additionPreview.preview.report.kind, 'addition');
  const additions = await Promise.allSettled(clients.slice(0, 2).map(client =>
    command(client, 'submit', { preview_id: additionPreview.preview.id }, additionPreview.revision)));
  assert.equal(additions.filter(x => x.status === 'fulfilled').length, 1, 'Concurrent addition sends produce one batch');
  assert.equal((await admin.query('select count(*)::int n from hl_order_private.orders where created_by=$1', [actor])).rows[0].n, 1);
  assert.equal((await admin.query('select count(*)::int n from hl_order_private.submission_batches where created_by=$1', [actor])).rows[0].n, 2);

  // A committed import must invalidate the old revision before a draft write.
  initial = await state(clients[0]);
  await command(clients[0], 'draft_save', { rows: [{ source_id: ids[1], quantity: 5 }] }, initial.revision);
  initial = await state(clients[0]);
  await admin.query('begin');
  await admin.query("update public.ph_soc_master set quantityordered='12' where unique_id=$1", [ids[1]]);
  const waitingCommand = command(clients[0], 'draft_save', { rows: [{ source_id: ids[1], quantity: 6 }] }, initial.revision);
  waitingCommand.catch(() => {}); // Install the rejection handler before COMMIT wakes it.
  // Observe a real pending table lock before releasing the importing session.
  let waiting = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    waiting = (await admin.query("select exists(select 1 from pg_locks where relation='public.ph_soc_master'::regclass and mode='ShareLock' and not granted) waiting")).rows[0].waiting;
    if (waiting) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(waiting, 'Command must lock the imported SOC snapshot before comparison');
  await admin.query('commit');
  await assert.rejects(waitingCommand, /HL_ORDER_REVISION_CONFLICT/);
  assert.equal((await state(clients[0])).draft.find(x => x.source_id === ids[1]).status, 'needs_review');
  console.log('PASS HL concurrency: 10 identical retries; competing tab CAS; one preview/one event; same-order additions; worker lock ordering; import snapshot race.');
} finally {
  await admin.query('rollback');
  for (const client of clients) { try { await client.query('rollback'); } catch {} }
  await Promise.all(clients.map(client => client.end()));
  if (committed) {
    await admin.query('begin');
    // Test-only cleanup bypasses append-only triggers in this isolated CI DB.
    await admin.query('set local session_replication_role=replica');
    await admin.query('delete from hl_order_private.history where created_by=$1 or payload->>\'event_id\' in (select event_id::text from hl_order_private.orders where created_by=$1)', [actor]);
    await admin.query('delete from hl_order_private.receipts where created_by=$1', [actor]);
    await admin.query('delete from hl_order_private.cancellation_lines where cancellation_id in (select id from hl_order_private.cancellations where created_by=$1)', [actor]);
    await admin.query('delete from hl_order_private.cancellations where created_by=$1', [actor]);
    await admin.query('delete from hl_order_private.order_lines where order_id in (select id from hl_order_private.orders where created_by=$1)', [actor]);
    await admin.query('delete from hl_order_private.submission_batches where created_by=$1', [actor]);
    await admin.query('delete from hl_order_private.orders where created_by=$1', [actor]);
    await admin.query('delete from hl_order_private.commands where created_by=$1', [actor]);
    await admin.query('delete from public.ph_hl_order_previews where created_by=$1', [actor]);
    await admin.query("delete from public.ph_request_delivery_outbox where payload->>'created_by'=$1", [actor]);
    await admin.query('delete from hl_order_private.drafts where source_id=any($1::text[])', [ids]);
    await admin.query('delete from hl_order_private.dispositions where source_id=any($1::text[])', [ids]);
    await admin.query('delete from public.ph_soc_master where unique_id=any($1::text[])', [ids]);
    await admin.query('delete from private.app_access_user_overrides where profile_id=$1', [actor]);
    await admin.query('delete from private.app_access_legacy_baseline where profile_id=$1', [actor]);
    await admin.query('delete from public.profiles where id=$1', [actor]);
    await admin.query('delete from auth.sessions where id=$1', [session]);
    await admin.query('delete from auth.users where id=$1', [actor]);
    await admin.query('commit');
  }
  await admin.end();
}
