import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// These fixtures commit to exercise independent database connections. Refuse
// hosted databases and never replace an existing account or source record.
const connectionString = process.env.SALES_CREDIT_TEST_DB_URL || '';
const target = new URL(connectionString || 'postgresql://invalid');
assert.equal(process.env.CI, 'true', 'Concurrency fixtures require isolated CI');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'Hosted database fixtures forbidden');
assert.equal(target.pathname, '/postgres', 'Unexpected isolated database');
const run = randomUUID(), prefix = `SALES-CONCURRENT-${run}`, repName = `credit_${run.replaceAll('-', '')}`;
const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const [dylan, jd, rep, grower] = ids;
const sourceId = `${prefix}-SOC`, masterId = `${prefix}-INVENTORY`, repMapId = `${prefix}-REP-MAP`;
const draftIds = [randomUUID(), randomUUID(), randomUUID()], lineIds = [randomUUID(), randomUUID(), randomUUID()];
const config = { connectionString, connectionTimeoutMillis: 10000, statement_timeout: 15000, application_name: `sales-concurrency-${run}` };
const admin = new pg.Client(config), clients = [new pg.Client(config), new pg.Client(config)];
const workerPids = [];
const publicationSourceIds = [], publicationRunIds = [], publicationActiveIds = [];
let fixtureCommitted = false, step = 'connect', failure;

const serviceSession = client => client.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false),set_config('request.jwt.claim.role','service_role',false)");
const credit = async (client, actor, operation, payload, revision, command = randomUUID()) =>
  (await client.query('select public.sales_credit_command_v1($1,$2,$3,$4,$5) result', [actor, operation, payload, command, revision])).rows[0].result;
const production = async (client, actor, operation, payload) =>
  (await client.query('select public.production_workflow_command_v1($1,$2,$3) result', [actor, operation, payload])).rows[0].result;

async function race(lockSql, params, requests) {
  await admin.query('begin');
  let pending;
  try {
    await admin.query(lockSql, params);
    // Attach rejection handlers before starting the lock barrier so a deliberately
    // losing command cannot become an unhandled promise rejection.
    pending = Promise.allSettled(requests.map((request, index) => request(clients[index])));
    let blocked = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await admin.query('select pg_stat_clear_snapshot()');
      const result = await admin.query("select count(*)::int count from pg_stat_activity where pid=any($1::int[]) and wait_event_type='Lock'", [workerPids]);
      if (result.rows[0].count === requests.length) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.equal(blocked, true, 'Both independent requests must contend before the barrier is released');
    await admin.query('commit');
    return await pending;
  } catch (error) {
    await admin.query('rollback');
    if (pending) await pending;
    throw error;
  }
}

function oneWinner(results, code) {
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'Exactly one competing command succeeds');
  const loser = results.find(result => result.status === 'rejected');
  assert.equal(loser.reason.message, code, 'The loser receives the expected conflict, not a hidden infrastructure error');
  return results.find(result => result.status === 'fulfilled').value;
}

async function waitForBlock(workerPid, blockerPid, description) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await admin.query('select pg_stat_clear_snapshot()');
    const result = await admin.query('select $2::int=any(pg_blocking_pids($1::int)) blocked', [workerPid, blockerPid]);
    if (result.rows[0].blocked) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.fail(description);
}

const settle = promise => promise.then(value => ({ value }), error => ({ error }));
function requireSuccess(result) { if (result.error) throw result.error; return result.value; }
const mappingKeys = ['ph_customer_consignee_sales_reps'];
const beginMappingImport = (client, id) => client.query('select public.begin_dataset_import_v1($1::text[],$2::uuid)', [mappingKeys, id]);
const finishMappingImport = (client, id) => client.query('select public.finish_dataset_import_v1($1::uuid)', [id]);
const insertPublicationSource = (client, kind, id) => kind === 'docks'
  ? client.query('insert into public.ph_soc_master(unique_id,salesrepid) values($1,$2)', [id, repName])
  : client.query("insert into public.ph_request_history(unique_id,req_status,snapshot) values($1,'Complete',$2::jsonb)", [id, { salesrepid: repName }]);
const publicationOwner = async (client, kind, id) =>
  (await client.query('select assigned_rep_id from public.ph_credit_sources where source_kind=$1 and source_id=$2', [kind, id])).rows[0]?.assigned_rep_id;

// Start the source statement before the publisher commits, so its outer SQL
// snapshot is deliberately stale. The volatile capture must reread after waiting.
async function insertAcrossPublication(kind, id, publish) {
  await admin.query('begin');
  let pending;
  try {
    await publish(admin);
    const adminPid = (await admin.query('select pg_backend_pid() pid')).rows[0].pid;
    pending = settle(insertPublicationSource(clients[0], kind, id));
    await waitForBlock(workerPids[0], adminPid, 'Source statement must wait for map publication before taking business row locks');
    await admin.query('commit');
    requireSuccess(await pending);
  } finally {
    await admin.query('rollback');
    if (pending) await pending;
  }
}

async function mixedImportAcrossActiveWriter(operation, importId, activeId) {
  await clients[0].query('begin');
  let pending;
  try {
    // Pause at the BEFORE STATEMENT barrier, before the active-row mutation.
    await clients[0].query('select key from public.app_dataset_revisions where key=$1 for share', [mappingKeys[0]]);
    pending = settle(operation === 'begin'
      ? clients[1].query('select public.begin_dataset_import_v1($1::text[],$2::uuid)', [['ph_active_request', ...mappingKeys], importId])
      : finishMappingImport(clients[1], importId));
    await waitForBlock(workerPids[1], workerPids[0], 'Mixed import must wait at the map revision before taking the active revision');
    await admin.query('begin');
    try {
      await admin.query("select key from public.app_dataset_revisions where key='ph_active_request' for update nowait");
    } finally {
      await admin.query('rollback');
    }
    if (operation === 'begin') {
      await clients[0].query("insert into public.ph_active_request(unique_id,req_status,requested_by,request_selected_rep_username) values($1,'Pending',$2,$2)", [activeId, repName]);
    } else {
      await clients[0].query("update public.ph_active_request set request_note='Mixed import lock-order fixture' where unique_id=$1", [activeId]);
    }
    await clients[0].query('commit');
    requireSuccess(await pending);
  } finally {
    await clients[0].query('rollback');
    if (pending) await pending;
  }
}

await admin.connect();
try {
  step = 'isolated fixture setup';
  await serviceSession(admin);
  assert.equal((await admin.query("select count(*)::int count from public.profiles where username in ('dylan_collyge','jd_jones')")).rows[0].count, 0,
    'Reserved reviewer fixture names already occupied; will not overwrite');
  await admin.query('begin');
  const names = ['dylan_collyge', 'jd_jones', repName, `grower_${run.replaceAll('-', '')}`];
  for (let index = 0; index < ids.length; index++) {
    await admin.query("insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,'{}','{}')", [ids[index], `${ids[index]}@example.invalid`]);
    await admin.query('insert into public.profiles(id,username,display_name,role,must_change_password) values($1,$2,$2,$3,false)',
      [ids[index], names[index], index < 2 ? 'ADMIN' : index === 2 ? 'REP' : 'GROWER']);
  }
  await admin.query('insert into public.ph_customer_consignee_sales_reps(unique_id,salesrepid,salesrepname) values($1,$2,$2)',
    [repMapId, repName]);
  await admin.query(`insert into public.ph_soc_master(unique_id,itemcode,commonname,contsize,locationcode,lotcode,quantityordered,dock,stopnumber,
    transactionnumber,customeridentityid,customername,consigneeidentityid,consigneename,salesrepid)
    values($1,$2,'Concurrency plant','#3','D.08.001','27.F1','20','Dock 1','1',$3,$3,'Concurrency customer',$3,'Concurrency consignee',$4)`,
    [sourceId, prefix, `${prefix}-SHIPMENT`, repName]);
  await admin.query("insert into public.ph_master_inventory(unique_id,itemcode,commonname,contsize,locationcode,lotcode,blockalpha,ptronhand,ptravailable) values($1,$2,'Concurrency plant','#3','D.08.001','27.F1','D','20','20')", [masterId, prefix]);
  await admin.query('commit');
  fixtureCommitted = true;
  await Promise.all(clients.map(async (client, index) => {
    await client.connect();
    await serviceSession(client);
    // Connection setup can finish out of order. Publication barriers address
    // clients by index, so their backend identities must use that same index.
    workerPids[index] = (await client.query('select pg_backend_pid() pid')).rows[0].pid;
    await client.query('set role service_role');
  }));
  const source = (await admin.query("select * from public.ph_credit_sources where source_kind='docks' and source_id=$1", [sourceId])).rows[0];
  assert.equal(source.assigned_rep_id, rep, 'Archived source resolves its assigned rep');
  for (let index = 0; index < draftIds.length; index++) {
    await credit(admin, rep, 'save_draft', { id: draftIds[index], customerKey: source.customer_key,
      lines: [{ id: lineIds[index], sourceId: source.id, quantity: '1', explanation: `Damaged group ${index + 1}`, attachmentIds: [] }] }, 0);
  }

  step = 'simultaneous duplicate credit submission';
  const submitCommand = randomUUID();
  const duplicate = await race('select id from public.ph_credit_submissions where id=$1 for update', [draftIds[0]],
    clients.map(() => client => credit(client, rep, 'submit', { id: draftIds[0] }, 1, submitCommand)));
  assert.ok(duplicate.every(result => result.status === 'fulfilled'), 'Both duplicate submissions return confirmed saved content');
  assert.deepEqual(duplicate[0].value, duplicate[1].value, 'Same command replays the exact original submission');
  assert.equal((await admin.query('select count(*)::int count from public.ph_sales_credit_requests where submission_id=$1', [draftIds[0]])).rows[0].count, 1);

  step = 'simultaneous independent reviewers';
  await race('select unique_id from public.ph_sales_credit_requests where unique_id=$1 for update', [lineIds[0]], [
    client => credit(client, dylan, 'review_line', { lineId: lineIds[0], decision: 'approved', reason: 'Dylan review' }, 1),
    client => credit(client, jd, 'review_line', { lineId: lineIds[0], decision: 'approved', reason: 'JD review' }, 1),
  ]).then(results => oneWinner(results, 'CREDIT_REVISION_CONFLICT'));
  assert.equal((await admin.query("select count(*)::int count from sales_private.review_events where line_id=$1 and operation='review_line'", [lineIds[0]])).rows[0].count, 1,
    'Exactly one reviewer audit survives');

  step = 'single-use authorization across simultaneous replacement submissions';
  await credit(admin, dylan, 'authorize_repeat', { sourceId: source.id, requesterId: rep, reason: 'One additional damaged group authorized' }, Number(source.revision));
  const competing = await race('select id from public.ph_credit_sources where id=$1 for update', [source.id], [
    client => credit(client, rep, 'submit', { id: draftIds[1] }, 1),
    client => credit(client, rep, 'submit', { id: draftIds[2] }, 1),
  ]);
  oneWinner(competing, 'CREDIT_REPEAT_AUTHORIZATION_REQUIRED');
  assert.equal((await admin.query('select count(*)::int count from public.ph_sales_credit_requests where source_id=$1', [source.id])).rows[0].count, 2,
    'Only the first and one authorized additional claim are submitted');
  assert.equal((await admin.query('select count(*)::int count from sales_private.repeat_authorizations where source_id=$1 and consumed_at is not null', [source.id])).rows[0].count, 1);
  const losingDraft = draftIds[competing[0].status === 'rejected' ? 1 : 2];
  assert.equal((await admin.query('select state from public.ph_credit_submissions where id=$1', [losingDraft])).rows[0].state, 'draft', 'Losing submission retains its draft');

  step = 'simultaneous production source additions';
  const identity = { unique_id: masterId, itemcode: prefix, contsize: '#3', locationcode: 'D.08.001', lotcode: '27.F1' };
  const added = await race('select unique_id from public.ph_master_inventory where unique_id=$1 for update', [masterId], clients.map(() => client =>
    production(client, grower, 'add', { workflow_type: 'planting', source_unique_id: masterId, source_identity: identity,
      quantity: '5', baynumber: '001', instructions: 'Retain tags', expected_revision: 0, command_id: randomUUID() })));
  const productionRow = oneWinner(added, 'PRODUCTION_ALREADY_OPEN').row;
  assert.equal((await admin.query("select count(*)::int count from public.ph_production_workflow_rows where source_unique_id=$1 and status='open'", [masterId])).rows[0].count, 1);

  step = 'simultaneous stale production completion';
  const completionCommands = [randomUUID(), randomUUID()];
  const completePayload = { workflow_type: 'planting', unique_id: productionRow.unique_id, expected_revision: Number(productionRow.revision) };
  const completed = await race('select unique_id from public.ph_production_workflow_rows where unique_id=$1 for update', [productionRow.unique_id],
    clients.map((_, index) => client => production(client, grower, 'complete', { ...completePayload, command_id: completionCommands[index] })));
  const completedRow = oneWinner(completed, 'WORKFLOW_REVISION_CONFLICT').row;
  const winningIndex = completed.findIndex(result => result.status === 'fulfilled');
  const replay = await production(clients[winningIndex], grower, 'complete', { ...completePayload, command_id: completionCommands[winningIndex] });
  assert.deepEqual(replay.row, completedRow, 'Completion acknowledgement loss replays the same row and revision');
  assert.equal(replay.duplicate, true);
  assert.equal((await admin.query('select ptronhand from public.ph_master_inventory where unique_id=$1', [masterId])).rows[0].ptronhand, '20', 'Production work never changes stock');

  // Direct business-table fixture writes use the isolated database owner. The
  // preceding API races still execute as service_role, with their real grants.
  await Promise.all(clients.map(client => client.query('reset role')));
  assert.equal((await admin.query('select state from public.app_dataset_revisions where key=$1', [mappingKeys[0]])).rows[0].state, 'ready');
  for (const kind of ['docks', 'request_history']) {
    const importId = randomUUID(), nextImportId = randomUUID();
    publicationRunIds.push(importId, nextImportId);
    const duringBegin = `${prefix}-${kind}-BEGIN`, beforeFinish = `${prefix}-${kind}-UNCOMMITTED`, duringFinish = `${prefix}-${kind}-FINISH`;
    publicationSourceIds.push(duringBegin, beforeFinish, duringFinish);

    step = `${kind} statement waits for import begin and rejects its pre-begin snapshot`;
    await insertAcrossPublication(kind, duringBegin, client => beginMappingImport(client, importId));
    assert.equal(await publicationOwner(admin, kind, duringBegin), null, 'Statement started before import begin must observe importing after lock wait');

    step = `${kind} uncommitted source blocks finish until the new archive is visible`;
    await clients[0].query('begin');
    let finishing;
    try {
      await insertPublicationSource(clients[0], kind, beforeFinish);
      assert.equal(await publicationOwner(clients[0], kind, beforeFinish), null, 'Importing source starts unassigned');
      finishing = settle(finishMappingImport(clients[1], importId));
      await waitForBlock(workerPids[1], workerPids[0], 'Finish must wait for an in-flight source transaction before repairing owners');
      await clients[0].query('commit');
      requireSuccess(await finishing);
    } finally {
      await clients[0].query('rollback');
      if (finishing) await finishing;
    }
    assert.equal(await publicationOwner(admin, kind, beforeFinish), rep, 'Finish sees and repairs the newly committed source');
    assert.equal(await publicationOwner(admin, kind, duringBegin), rep, 'Finish also repairs the source deferred at begin');

    step = `${kind} statement waits for finish and rejects its pre-finish snapshot`;
    await beginMappingImport(admin, nextImportId);
    await insertAcrossPublication(kind, duringFinish, client => finishMappingImport(client, nextImportId));
    assert.equal(await publicationOwner(admin, kind, duringFinish), rep, 'Statement started during importing observes ready after finish commits');
  }
  const mixedRun = randomUUID(), mixedActive = `${prefix}-MIXED-ACTIVE`;
  publicationRunIds.push(mixedRun);
  publicationActiveIds.push(mixedActive);
  step = 'mixed import begin locks map before active revision';
  await mixedImportAcrossActiveWriter('begin', mixedRun, mixedActive);
  step = 'mixed import finish locks map before active revision';
  await mixedImportAcrossActiveWriter('finish', mixedRun, mixedActive);
  assert.equal((await admin.query("select bool_and(state='ready') ready from public.app_dataset_revisions where key=any($1::text[])", [['ph_active_request', ...mappingKeys]])).rows[0].ready, true);
  console.log('PASS: competing credit submissions/reviewers, single-use authorization, production deduplication, stale completion, and eight independent-connection ownership/publication barriers.');
} catch (error) {
  console.error(`FAILED STEP: ${step}`);
  failure = error;
} finally {
  await Promise.all(clients.map(client => client.end().catch(() => {})));
  try {
    await admin.query('rollback');
    if (fixtureCommitted) {
      // Every import above changes only metadata, so complete any interrupted
      // test barrier before deleting this run's exact isolated fixture records.
      const unfinished = await admin.query("select id from app_sync_private.import_runs where id=any($1::uuid[]) and state='active'", [publicationRunIds]);
      for (const row of unfinished.rows) await finishMappingImport(admin, row.id);
      await admin.query('begin');
      await admin.query('delete from sales_private.commands where actor_id=any($1::uuid[])', [ids]);
      await admin.query('delete from sales_private.review_events where actor_id=any($1::uuid[])', [ids]);
      await admin.query('delete from sales_private.repeat_authorizations where requester_id=$1', [rep]);
      await admin.query('delete from public.ph_sales_credit_requests where submission_id=any($1::uuid[])', [draftIds]);
      await admin.query('delete from public.ph_credit_submissions where id=any($1::uuid[])', [draftIds]);
      await admin.query('delete from sales_private.source_versions where source_id in (select id from public.ph_credit_sources where source_id=any($1::text[]))', [publicationSourceIds]);
      await admin.query('delete from public.ph_credit_sources where source_id=any($1::text[])', [publicationSourceIds]);
      await admin.query('delete from public.ph_request_history where unique_id=any($1::text[])', [publicationSourceIds]);
      await admin.query('delete from public.ph_soc_master where unique_id=any($1::text[])', [publicationSourceIds]);
      await admin.query('delete from public.ph_active_request where unique_id=any($1::text[])', [publicationActiveIds]);
      await admin.query('delete from app_sync_private.import_runs where id=any($1::uuid[])', [publicationRunIds]);
      await admin.query("delete from sales_private.source_versions where source_id in (select id from public.ph_credit_sources where source_kind='docks' and source_id=$1)", [sourceId]);
      await admin.query("delete from public.ph_credit_sources where source_kind='docks' and source_id=$1", [sourceId]);
      await admin.query('delete from public.ph_soc_master where unique_id=$1', [sourceId]);
      await admin.query('delete from public.ph_customer_consignee_sales_reps where unique_id=$1', [repMapId]);
      await admin.query('delete from workflow_private.commands where actor_id=any($1::uuid[])', [ids]);
      await admin.query('delete from public.ph_production_workflow_rows where source_unique_id=$1', [masterId]);
      await admin.query('delete from public.ph_master_inventory where unique_id=$1', [masterId]);
      await admin.query('delete from sales_private.rep_identities where profile_id=any($1::uuid[])', [ids]);
      await admin.query('delete from private.app_access_user_overrides where profile_id=any($1::uuid[])', [ids]);
      await admin.query('delete from private.app_access_legacy_baseline where profile_id=any($1::uuid[])', [ids]);
      await admin.query('delete from public.profiles where id=any($1::uuid[])', [ids]);
      await admin.query('delete from auth.users where id=any($1::uuid[])', [ids]);
      await admin.query('commit');
    }
  } catch (error) {
    console.error('FAILED STEP: isolated concurrency fixture cleanup');
    failure ||= error;
  }
  await admin.end();
}
if (failure) throw failure;
