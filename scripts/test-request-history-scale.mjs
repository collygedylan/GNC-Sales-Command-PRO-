// @test-runtime: postgres-concurrency
// @test-db-env: REQUEST_HISTORY_TEST_DB_URL
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import pg from 'pg';

// These rows model imported historical evidence, not new native submissions.
// Restore the prior claims before every protected read, including on failure.
async function insertLegacyActiveFixture(db, sql, values) {
  const prior = (await db.query("select current_setting('request.jwt.claim.role',true) role,current_setting('request.jwt.claims',true) claims")).rows[0];
  try {
    await db.query("select set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");
    return await db.query(sql, values);
  } finally {
    await db.query("select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claims',$2,true)", [prior.role || '', prior.claims || '{}']);
  }
}

export async function runRequestHistoryScaleFixture(db) {
  const actors=[randomUUID(),randomUUID()],prefix=`HISTORY-SCALE-${randomUUID()}`;
  const names=[`${prefix.toLowerCase()}_rep`,`${prefix.toLowerCase()}_other`];
  await db.query('begin');
  try {
    const ownerOnly=(await db.query(`select position('history_redact_financial_v1' in pg_get_functiondef(
      'public.request_history_command_v1(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0 as owner_only`)).rows[0].owner_only;
    const outboxBefore=(await db.query('select count(*) n from public.ph_request_delivery_outbox')).rows[0].n;
    for(let i=0;i<2;i++) {
      await db.query("insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,'{}','{}')",[actors[i],`${names[i]}@example.invalid`]);
      await db.query("insert into public.profiles(id,username,display_name,role,must_change_password) values($1,$2,$2,'REP',false)",[actors[i],names[i]]);
    }
    // No permission override: exercise ordinary REP navigation-policy evaluation.
    await db.query(`insert into public.ph_request_history(unique_id,request_selected_rep_username,
      request_created_by_username,req_status,created_at,date_completed,customeridentityid,customername,
      consigneeidentityid,consigneename,commonname,itemcode,request_folder,snapshot)
      select $1||'-'||i,case when i%4=0 then $3 else $2 end,
        case when i%20=0 then $2 else 'synthetic_office_csr' end,
        case when i%2=0 then 'Complete' else 'Pending' end,
        now()-(i/10)*interval '1 second',case when i%2=0 then now()-(i/10)*interval '1 second' end,
        $1||'-customer',case when i=3651 then 'DeepCustomerNeedle' else 'Scale Customer' end,
        $1||'-consignee-'||(i%3),case when i=3651 then 'DeepConsigneeNeedle' else 'Scale Consignee' end,
        case when i=3651 then 'DeepCommonNeedle' else 'Scale Plant' end,
        case when i=3651 then 'DeepItemNeedle' else 'Scale Item' end,
        case when i=3651 then 'DeepFolderNeedle' else $1||'-folder' end,
        jsonb_build_object('synthetic_note',repeat('Scale evidence ',80))
      from generate_series(1,3651) i`,[prefix,...names]);
    // Same IDs, conflicting assignment/status. Retained history must win before
    // authorization; invisible history cannot expose a visible active fallback.
    await insertLegacyActiveFixture(db, `insert into public.ph_active_request(unique_id,request_selected_rep_username,req_status,request_source)
      select $1||'-'||i,$2,'Pending','legacy' from generate_series(1,3512) i`,[prefix,names[0]]);
    assert.equal((await db.query('select count(*)::int n from public.ph_request_history where unique_id like $1',[`${prefix}-%`])).rows[0].n,3651);
    assert.equal((await db.query('select count(*)::int n from public.ph_active_request where unique_id like $1',[`${prefix}-%`])).rows[0].n,3512);
    await db.query('analyze public.ph_request_history');
    await db.query('analyze public.ph_active_request');
    await db.query('analyze public.ph_credit_sources');
    await db.query("set local statement_timeout='8s'");
    await db.query("set local lock_timeout='3s'");
    const timings=[];
    const read=async(operation,payload={})=>{
      const started=performance.now();
      const value=(await db.query('select public.request_history_command_v1($1,$2,$3) result',[actors[0],operation,payload])).rows[0].result;
      const durationMs=Math.round(performance.now()-started);
      timings.push({operation,durationMs});
      assert.ok(durationMs<8000,'History reads must fit the unchanged production 8s deadline');
      return value;
    };
    const first=await read('search',{limit:10});
    assert.equal(first.rows.length,10);
    assert.ok(first.nextCursor);
    assert.ok(first.rows.some(row=>row.status==='pending')&&first.rows.some(row=>row.status==='completed'),'Default All retains both states');
    assert.ok(first.rows.every(row=>row.assigned_rep_id===actors[0]||!ownerOnly&&row.request_created_by_username===names[0]));
    const second=await read('search',{limit:10,cursor:first.nextCursor});
    assert.equal(second.rows.length,10);
    assert.ok(second.rows.every(row=>!first.rows.some(prior=>prior.unique_id===row.unique_id)),'Timestamp ties page without overlap');
    for(const query of ['DeepCustomerNeedle','DeepConsigneeNeedle','DeepCommonNeedle','DeepItemNeedle','DeepFolderNeedle']) {
      const result=await read('search',{query,limit:10});
      assert.deepEqual(result.rows.map(row=>row.unique_id),[`${prefix}-3651`],'All five fields search beyond the first page');
    }
    const expected=(await db.query(`select count(*)::int n from public.ph_request_history
      where unique_id like $1 and (assigned_rep_id=$2 or not $4 and request_created_by_username=$3)`,[`${prefix}-%`,actors[0],names[0],ownerOnly])).rows[0].n;
    const folders=await read('folders',{limit:100});
    assert.equal(folders.folders.reduce((total,folder)=>total+Number(folder.count),0),expected,'Folder counts cover the full permitted history');
    const creator=await read('detail',{id:`${prefix}-20`});
    if(ownerOnly) {
      assert.equal(creator.rows.length,0,'Current history hides creator-only evidence assigned to another rep');
      assert.equal(creator.rows[0],undefined,'Creator-only detail exposes no other-rep data or credit eligibility');
    } else {
      assert.equal(creator.rows.length,1,'September fixture preserves its legacy creator-attribution contract');
      assert.equal(creator.rows[0].canRequestCredit,false,'Creator-only visibility grants no credit ownership');
    }
    assert.equal((await read('detail',{id:`${prefix}-2`})).rows[0].canRequestCredit,true,'Owned completed evidence still permits credit');
    assert.ok((await read('search',{status:'pending',limit:10})).rows.every(row=>row.status==='pending'),'Pending filter remains exact');
    await db.query(`update public.ph_credit_sources owned set canonical_source_id=other.id
      from public.ph_credit_sources other where owned.source_kind='request_history' and owned.source_id=$1
        and other.source_kind='request_history' and other.source_id=$2`,[`${prefix}-2`,`${prefix}-4`]);
    assert.equal((await read('detail',{id:`${prefix}-2`})).rows[0].canRequestCredit,false,'Another rep canonical source never inherits credit permission');
    assert.equal((await read('detail',{id:`${prefix}-4`})).rows.length,0,'Invisible retained history cannot expose assigned active fallback');
    assert.equal((await read('search',{status:'completed',query:'DeepFolderNeedle'})).rows.length,0);
    await insertLegacyActiveFixture(db, `insert into public.ph_active_request(unique_id,request_selected_rep_username,req_status,request_source)
      values($1,$2,'Pending','legacy')`,[`${prefix}-active-only`,names[0]]);
    assert.equal((await read('detail',{id:`${prefix}-active-only`})).rows.length,1,'Active-only assignment fallback remains visible');
    assert.equal((await db.query('select count(*) n from public.ph_request_delivery_outbox')).rows[0].n,outboxBefore,
      'Fixtures and read-only history calls must not enqueue emails');
    console.log(JSON.stringify({ok:true,fixture:'request-history-production-scale',historyRows:3651,
      overlappingActiveRows:3512,readBudgetMs:8000,timings,ownerOnly,ownership:true,pagination:true,deepSearch:true,notificationsUnchanged:true}));
  } finally { await db.query('rollback'); }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const connectionString=process.env.REQUEST_HISTORY_TEST_DB_URL||'';
  const target=new URL(connectionString||'postgresql://invalid');
  assert.equal(process.env.CI,'true','Scale fixtures require isolated CI');
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname),'Hosted database fixtures forbidden');
  assert.equal(target.pathname,'/postgres','Unexpected isolated database');
  const db=new pg.Client({connectionString,connectionTimeoutMillis:10000,query_timeout:60000,application_name:'isolated_request_history_scale_test'});
  await db.connect();
  try { await runRequestHistoryScaleFixture(db); } finally { await db.end(); }
}
