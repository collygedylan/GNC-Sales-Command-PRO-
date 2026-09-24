import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Committed fixtures are allowed only on the disposable loopback CI database.
const connectionString = process.env.REQUEST_DRIVE_TEST_DB_URL || '';
const target = new URL(connectionString || 'postgresql://invalid');
assert.equal(process.env.CI, 'true', 'Concurrency fixtures require isolated CI');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'Hosted database fixtures forbidden');
assert.equal(target.pathname, '/postgres', 'Unexpected isolated database');
const options = { connectionString, connectionTimeoutMillis: 10_000, statement_timeout: 15_000,
  application_name: 'isolated_request_drive_reset_concurrency' };
const admin = new pg.Client(options), worker = new pg.Client(options);
const prefix = `RESET-CONCURRENT-${randomUUID()}`;
const masterIds = ['timestamp','reason'].map(kind => `${prefix}-${kind}`);
const historyIds = masterIds.map(id => `${id}-history`);
let connected = false;
await admin.connect();
try {
  await worker.connect();
  connected = true;
  await worker.query("select set_config('request.jwt.claim.role','service_role',false)");
  const adminPid = (await admin.query('select pg_backend_pid() pid')).rows[0].pid;
  const workerPid = (await worker.query('select pg_backend_pid() pid')).rows[0].pid;
  const outboxBefore = (await admin.query('select count(*) n from public.ph_request_delivery_outbox')).rows[0].n;
  for (let index = 0; index < masterIds.length; index++) {
    const masterId = masterIds[index], historyId = historyIds[index];
    await admin.query('insert into public.ph_master_inventory(unique_id,itemcode) values($1,$1)',[masterId]);
    await admin.query(`insert into public.ph_request_history(unique_id,master_id,req_status,date_completed,req_spec)
      values($1,$2,'Completed',now()-interval '1 hour','superseded evidence')`,[historyId,masterId]);
    await admin.query('begin');
    let pending;
    try {
      await admin.query('select unique_id from public.ph_master_inventory where unique_id=$1 for update',[masterId]);
      // Promise captures failures immediately while the independent connection waits.
      pending = worker.query('select public.repair_request_drive_evidence_v1($1,false) result',[[historyId]])
        .then(value => ({ value }), error => ({ error }));
      const deadline = Date.now()+5000;
      let blocked = false;
      while (Date.now()<deadline) {
        const observed = await admin.query('select $2::int=any(pg_blocking_pids($1::int)) blocked',[workerPid,adminPid]);
        if (observed.rows[0].blocked) { blocked=true; break; }
        await new Promise(resolve => setTimeout(resolve,40));
      }
      assert.equal(blocked,true,'Repair must read the candidate then block on this exact master lock');
      if (index===0) {
        await admin.query('update public.ph_master_inventory set av_rule_last_cleared_at=now() where unique_id=$1',[masterId]);
      } else {
        await admin.query("update public.ph_master_inventory set av_rule_last_clear_reason='concurrent_reset' where unique_id=$1",[masterId]);
      }
      await admin.query('commit');
      const outcome = await pending;
      if (outcome.error) throw outcome.error;
      assert.equal(outcome.value.rows[0].result.eligible_count,1,'Candidate was eligible before the concurrent reset');
      assert.equal(outcome.value.rows[0].result.repaired_count,0,'Concurrent reset must win');
      assert.equal(outcome.value.rows[0].result.skipped_newer_count,1,'CAS miss is reported as skipped');
      const row = (await admin.query(`select spec,caliper,match,pic_note,av_note,photo_link,photo_name,
        av_rule_bundle_updated_at,av_rule_spec_updated_at from public.ph_master_inventory where unique_id=$1`,[masterId])).rows[0];
      assert.ok(Object.values(row).every(value=>value===null),'Repair must preserve blank values and provenance');
      console.log(`PASS concurrent ${index===0?'timestamp-only':'reason-only'} reset fences stale repair`);
    } catch(error) {
      await admin.query('rollback');
      if (pending) await pending;
      throw error;
    }
  }
  assert.equal((await admin.query('select count(*) n from public.ph_request_delivery_outbox')).rows[0].n,outboxBefore,
    'Reset races must not enqueue notifications');
} finally {
  await admin.query('rollback');
  await admin.query('delete from public.ph_request_history where unique_id=any($1::text[])',[historyIds]);
  await admin.query('delete from public.ph_master_inventory where unique_id=any($1::text[])',[masterIds]);
  if (connected) await worker.end();
  await admin.end();
}
