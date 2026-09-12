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
const restockItem = `${prefix}-RESTOCK`;
const restockMasterId = `${prefix}-RESTOCK-MASTER`;
const claims = { role: 'authenticated', sub: actor, session_id: session,
  iss: 'https://kzrnyjsosryejjejliii.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 3600 };
const state = async client => (await client.query('select public.hl_order_state() state')).rows[0].state;
const restockState = async client => (await client.query('select public.hl_order_restock_state() state')).rows[0].state;
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
  for (const [i,id] of ids.entries()) await admin.query("insert into public.ph_27f1_hl_po(source_file_id,row_index,run_id,item_code,size,lot,po_remain,imported_po_remain) values($1,$2,$1,$3,'#3','27.F1',20,20)",[prefix,i,id]);
  await admin.query("update hl_order_private.po_control set active_scope=$1,receipt_cutoff='1970-01-01' where singleton",[prefix]);
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

  // Receipt replay uses the same state lock as imports and cannot double-debit.
  initial = await state(clients[0]);
  const receiveLine=initial.orders.find(x=>x.id===order.id).lines.find(x=>x.source_id===ids[0]);
  const receiptId=randomUUID(), receiptPayload={order_id:order.id,lines:[{line_id:receiveLine.id,received_quantity:2}]};
  const receipts=await Promise.all(clients.slice(0,2).map(client=>command(client,'receive',receiptPayload,initial.revision,receiptId)));
  assert.deepEqual(receipts[0],receipts[1]);
  assert.equal((await admin.query('select po_remain::int balance from public.ph_27f1_hl_po where source_file_id=$1 and item_code=$2',[prefix,ids[0]])).rows[0].balance,18);
  assert.equal((await admin.query('select count(*)::int n from hl_order_private.po_receipt_adjustments where itemcode=$1',[ids[0].toUpperCase()])).rows[0].n,1);
  initial=await state(clients[0]);
  const corrections=await Promise.allSettled(clients.slice(0,2).map((client,i)=>command(client,'receive',{order_id:order.id,lines:[{line_id:receiveLine.id,received_quantity:3+i}]},initial.revision)));
  assert.equal(corrections.filter(x=>x.status==='fulfilled').length,1,'Only one concurrent receipt correction wins CAS');
  const received=(await admin.query('select received_quantity::int n from hl_order_private.order_lines where id=$1',[receiveLine.id])).rows[0].n;
  assert.equal((await admin.query('select po_remain::int balance from public.ph_27f1_hl_po where source_file_id=$1 and item_code=$2',[prefix,ids[0]])).rows[0].balance,20-received);

  // Confirming a reconciled report races with a receipt under one CAS lock.
  const cutoff=(await admin.query('select clock_timestamp() t')).rows[0].t.toISOString();
  const importRows=ids.map((id,i)=>({source_file_id:prefix,row_index:i,item_code:id,size:'#3',lot:'27.F1',po_remain:20,report_date:'2026-09-11'}));
  const staged=(await clients[2].query('select public.hl_po_import_stage($1,$2::jsonb,true) result',[prefix+'-import',JSON.stringify(importRows)])).rows[0].result;
  initial=await state(clients[0]);
  let importPreview=await command(clients[0],'po_import_preview',{import_id:staged.id,receipt_cutoff:cutoff},initial.revision);
  const correctionPayload={order_id:order.id,reason:'Concurrent count correction',lines:[{line_id:receiveLine.id,received_quantity:received-1}]};
  const racing=await Promise.allSettled([
    command(clients[0],'po_import_confirm',{preview_id:importPreview.po_import_preview.id},importPreview.revision),
    command(clients[1],'receive',correctionPayload,importPreview.revision)
  ]);
  assert.equal(racing.filter(x=>x.status==='fulfilled').length,1,'Import and receipt share revision serialization');
  assert.equal(racing.find(x=>x.status==='rejected').reason.message,'HL_ORDER_REVISION_CONFLICT');
  initial=await state(clients[0]);
  if(racing[0].status==='fulfilled') await command(clients[1],'receive',correctionPayload,initial.revision);
  else {
    importPreview=await command(clients[0],'po_import_preview',{import_id:staged.id,receipt_cutoff:cutoff},initial.revision);
    await command(clients[0],'po_import_confirm',{preview_id:importPreview.po_import_preview.id},importPreview.revision);
  }
  assert.equal((await admin.query('select po_remain::int balance from public.ph_27f1_hl_po where source_file_id=$1 and item_code=$2',[prefix,ids[0]])).rows[0].balance,21,'Only post-cutoff correction applies to imported balance');

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

  // Genuine restock intent: the fixture adds no SOC row for this item. Use the
  // active confirmed report and actual dataset revision triggers in native CI.
  const activeScope = (await admin.query('select active_scope from hl_order_private.po_control where singleton')).rows[0].active_scope;
  await admin.query("insert into public.ph_27f1_hl_po(source_file_id,row_index,run_id,item_code,size,lot,po_ordered,po_remain,imported_po_remain) values($1,100,$2,$3,'#3','27.F1',100,100,100)", [prefix, activeScope, restockItem]);
  await admin.query("insert into public.ph_master_inventory(unique_id,itemcode,contsize,locationcode,lotcode,ptravailable) values($1,$2,'#3','C.12.004','27.F1','10')", [restockMasterId, restockItem]);
  await authenticate(clients[2]);
  let restocking = await restockState(clients[0]);
  const restockCode = restockItem.toUpperCase();
  const itemState = snapshot => snapshot.items.find(item => item.itemcode === restockCode && item.size === '#3');
  assert.equal(itemState(restocking).status, 'ready');
  assert.equal(itemState(restocking).suggested_quantity, 20);
  const restockPayload = { ship_date: '2026-09-17', inventory_snapshot: restocking.inventory_snapshot,
    rows: [{ itemcode: restockItem, size: '#3', quantity: 5 }] };
  const restockReplayId = randomUUID();
  const restockRetries = await Promise.all(clients.map(client =>
    command(client, 'restock_draft_save', restockPayload, restocking.revision, restockReplayId)));
  for (const response of restockRetries) assert.deepEqual(response, restockRetries[0], 'Concurrent restock replay must not add the quantity again');
  assert.equal((await admin.query('select count(*)::int n from hl_order_private.commands where command_id=$1', [restockReplayId])).rows[0].n, 1);
  assert.equal((await admin.query('select count(*)::int n from hl_order_private.restock_intents where created_by=$1 and itemcode=$2', [actor, restockCode])).rows[0].n, 1);
  assert.equal((await admin.query('select count(*)::int n from public.ph_soc_master where itemcode=$1', [restockItem])).rows[0].n, 0);
  restocking = await restockState(clients[0]);
  assert.equal(itemState(restocking).saved_quantity, 5);
  const restockCompeting = await Promise.allSettled(clients.slice(0, 2).map((client, index) =>
    command(client, 'restock_draft_save', { ...restockPayload, inventory_snapshot: restocking.inventory_snapshot,
      rows: [{ itemcode: restockItem, size: '#3', quantity: index ? 6 : 4 }] }, restocking.revision)));
  assert.equal(restockCompeting.filter(result => result.status === 'fulfilled').length, 1, 'Only one competing restock addition wins CAS');
  assert.equal(restockCompeting.find(result => result.status === 'rejected').reason.message, 'HL_ORDER_REVISION_CONFLICT');
  const restockQuantity = restockCompeting[0].status === 'fulfilled' ? 9 : 11;
  restocking = await restockState(clients[0]);
  assert.equal(itemState(restocking).saved_quantity, restockQuantity, 'Winning addition must reuse and increase one date-scoped draft');
  assert.equal(itemState(restocking).suggested_quantity, 20 - restockQuantity);
  assert.equal((await admin.query('select count(*)::int n from hl_order_private.restock_intents where created_by=$1 and itemcode=$2', [actor, restockCode])).rows[0].n, 1);

  const restockPreview = await command(clients[0], 'preview', { ship_date: '2026-09-17' }, restocking.revision);
  assert.equal(restockPreview.preview.report.contract_version, 'hl-order-report-v3');
  const restockSubmitted = await command(clients[0], 'submit', { preview_id: restockPreview.preview.id }, restockPreview.revision);
  const restockOrder = restockSubmitted.orders.find(entry => entry.id === restockPreview.preview.report.order_id);
  const restockLine = restockOrder.lines.find(entry => entry.source_kind === 'restock');
  assert.equal(restockLine.quantity, restockQuantity);
  const restockLease = randomUUID();
  await admin.query("update public.ph_request_delivery_outbox set status='processing',lease_token=$2,lease_expires_at=now()+interval '2 minutes' where event_id=$1", [restockOrder.event_id, restockLease]);
  await authenticate(clients[2], true);
  await clients[2].query("select public.hl_order_delivery_record_v1($1,$2,'sending','{}')", [restockOrder.event_id, restockLease]);
  await clients[2].query("select public.hl_order_delivery_record_v1($1,$2,'sent','{\"gmail_message_id\":\"synthetic-restock-concurrency-receipt\"}')", [restockOrder.event_id, restockLease]);
  initial = await state(clients[0]);
  await command(clients[0], 'receive', { order_id: restockOrder.id, lines: [{ line_id: restockLine.id, received_quantity: 2 }] }, initial.revision);
  await admin.query("update public.ph_master_inventory set ptravailable='12' where unique_id=$1", [restockMasterId]);
  restocking = await restockState(clients[0]);
  assert.equal(itemState(restocking).can_confirm_inventory, true, 'Only a newer complete inventory revision permits confirmation');
  assert.equal(itemState(restocking).receipts.length, 1);
  const confirmationPayload = { itemcode: restockItem, size: '#3', inventory_snapshot: restocking.inventory_snapshot,
    receipt_watermark: itemState(restocking).receipt_watermark };
  const restockCorrection = { order_id: restockOrder.id, lines: [{ line_id: restockLine.id, received_quantity: 3 }] };
  const confirmationRace = await Promise.allSettled([
    command(clients[0], 'restock_inventory_confirm', confirmationPayload, restocking.revision),
    command(clients[1], 'receive', restockCorrection, restocking.revision)
  ]);
  assert.equal(confirmationRace.filter(result => result.status === 'fulfilled').length, 1, 'Inventory confirmation and a new receipt serialize under the same revision');
  assert.equal(confirmationRace.find(result => result.status === 'rejected').reason.message, 'HL_ORDER_REVISION_CONFLICT');
  if (confirmationRace[0].status === 'fulfilled') {
    initial = await state(clients[0]);
    await command(clients[1], 'receive', restockCorrection, initial.revision);
  }
  restocking = await restockState(clients[0]);
  assert.equal(itemState(restocking).status, 'receipt_pending', 'The newly received stock must require its own confirmation');
  assert.equal(itemState(restocking).can_confirm_inventory, false);
  assert.equal(itemState(restocking).incoming_quantity, restockQuantity - 3);
  assert.equal((await admin.query('select po_remain::int balance from public.ph_27f1_hl_po where source_file_id=$1 and item_code=$2', [prefix, restockItem])).rows[0].balance, 97);
  assert.equal((await admin.query('select count(*)::int n from hl_order_private.po_receipt_adjustments where itemcode=$1', [restockCode])).rows[0].n, 2);
  await admin.query("update public.ph_master_inventory set ptravailable='13' where unique_id=$1", [restockMasterId]);
  restocking = await restockState(clients[0]);
  await assert.rejects(command(clients[0], 'restock_inventory_confirm', { ...confirmationPayload, inventory_snapshot: restocking.inventory_snapshot }, restocking.revision), /HL_RESTOCK_CONFIRMATION_STALE/);
  await command(clients[0], 'restock_inventory_confirm', { ...confirmationPayload, inventory_snapshot: restocking.inventory_snapshot,
    receipt_watermark: itemState(restocking).receipt_watermark }, restocking.revision);
  restocking = await restockState(clients[0]);
  assert.equal(itemState(restocking).status, 'ready');
  assert.equal(itemState(restocking).receipts.length, 0, 'Confirmation clears only receipts covered by the verified watermark');
  assert.equal(itemState(restocking).suggested_quantity, 20 - restockQuantity, 'Received stock and incoming quantity must not be counted twice');
  console.log('PASS HL concurrency: 10 identical retries; competing tab CAS; one preview/one event; same-order additions; receipt replay/CAS; receipt versus PO import reconciliation; worker lock ordering; import snapshot race; 10 restock retries; concurrent restock additions; receipt versus inventory confirmation with stale watermark rejection.');
} finally {
  await admin.query('rollback');
  for (const client of clients) { try { await client.query('rollback'); } catch {} }
  await Promise.all(clients.map(client => client.end()));
  if (committed) {
    await admin.query('begin');
    // Test-only cleanup bypasses append-only triggers in this isolated CI DB.
    await admin.query('set local session_replication_role=replica');
    await admin.query('delete from hl_order_private.history where created_by=$1 or payload->>\'event_id\' in (select event_id::text from hl_order_private.orders where created_by=$1)', [actor]);
    await admin.query('delete from hl_order_private.po_receipt_adjustments where receipt_id in (select id from hl_order_private.receipts where created_by=$1)', [actor]);
    await admin.query('delete from hl_order_private.receipts where created_by=$1', [actor]);
    await admin.query('delete from hl_order_private.cancellation_lines where cancellation_id in (select id from hl_order_private.cancellations where created_by=$1)', [actor]);
    await admin.query('delete from hl_order_private.cancellations where created_by=$1', [actor]);
    await admin.query('delete from hl_order_private.order_lines where order_id in (select id from hl_order_private.orders where created_by=$1)', [actor]);
    await admin.query('delete from hl_order_private.submission_batches where created_by=$1', [actor]);
    await admin.query('delete from hl_order_private.orders where created_by=$1', [actor]);
    await admin.query('delete from hl_order_private.commands where created_by=$1', [actor]);
    await admin.query('delete from public.ph_hl_order_previews where created_by=$1', [actor]);
    await admin.query("delete from public.ph_request_delivery_outbox where payload->>'created_by'=$1", [actor]);
    await admin.query('delete from hl_order_private.drafts where source_id=any($1::text[]) or source_id in (select source_id from hl_order_private.restock_intents where created_by=$2)', [ids, actor]);
    await admin.query('delete from hl_order_private.dispositions where source_id=any($1::text[]) or source_id in (select source_id from hl_order_private.restock_intents where created_by=$2)', [ids, actor]);
    await admin.query('delete from hl_order_private.restock_intents where created_by=$1 and itemcode=$2', [actor, restockItem.toUpperCase()]);
    await admin.query('delete from hl_order_private.restock_inventory_gates where itemcode=$1', [restockItem.toUpperCase()]);
    await admin.query('delete from public.ph_master_inventory where unique_id=$1', [restockMasterId]);
    await admin.query('delete from public.ph_soc_master where unique_id=any($1::text[])', [ids]);
    await admin.query('delete from public.ph_27f1_hl_po where source_file_id=$1', [prefix]);
    await admin.query('update hl_order_private.po_control set active_scope=null,active_import_id=null where active_import_id in (select id from hl_order_private.po_imports where run_id=$1)',[prefix+'-import']);
    await admin.query('delete from hl_order_private.po_import_previews where created_by=$1',[actor]);
    await admin.query('delete from hl_order_private.po_import_rows where import_id in (select id from hl_order_private.po_imports where run_id=$1)',[prefix+'-import']);
    await admin.query('delete from hl_order_private.po_imports where run_id=$1',[prefix+'-import']);
    await admin.query('delete from private.app_access_user_overrides where profile_id=$1', [actor]);
    await admin.query('delete from private.app_access_legacy_baseline where profile_id=$1', [actor]);
    await admin.query('delete from public.profiles where id=$1', [actor]);
    await admin.query('delete from auth.sessions where id=$1', [session]);
    await admin.query('delete from auth.users where id=$1', [actor]);
    await admin.query('commit');
  }
  await admin.end();
}
