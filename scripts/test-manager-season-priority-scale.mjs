import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import pg from 'pg';

// Shared with the private local query-plan reproduction. All values are synthetic.
export async function seedSeasonPriorityScaleRows(db, prefix) {
  await db.query(`insert into public.ph_master_inventory
    (unique_id,itemcode,genusname,commonname,contsize,locationcode,lotcode,source,season,saleyear,
     ptronhand,ptravailable,priority,app_tab_assignment,assignedto,blockalpha)
    select $1||'-row-'||i,
      $1||case when i<=400 then '-item-'||((i-1)/8) when i<=450 then '-item-'||(i-401) else '-background-'||((i-451)/4) end,
      'Scale genus','Scale plant','#3','A.'||lpad(i::text,6,'0'),'27.F1','PH',
      case when i<=400 then 'F1' else 'U1' end,'27','200',
      case when i%8=7 then '100' else '20' end,
      case when i=400 then '5' when i%8=7 then (2+((i-1)/8)%3)::text when i<=400 then '1' else '' end,
      case when i<=400 then 'season' else 'other' end,'stale_scale_assignment','A'
    from generate_series(1,9364) i`, [prefix]);
  await db.query(`insert into public.ph_cav_import(unique_id,itemcode,commonname,contsize,season,holdstopreason)
    select $1||'-cav-'||i,$1||'-item-'||i,'Scale plant','#3','F1','' from generate_series(0,49) i`,[prefix]);
  await db.query(`insert into public.ph_warehouse_assigned_items
    (unique_id,itemcode,itemcode_normalized,genusname,assignedto,source,present_in_drive)
    select $1||'-assignment-'||i,$1||case when i<50 then '-item-'||i else '-background-'||i end,
      $1||case when i<50 then '-item-'||i else '-background-'||i end,'Scale genus',
      case when i%3=0 then '' when i%3=1 then 'scale_manager_a' else 'scale_manager_b' end,'fixture',i%2=0
    from generate_series(0,4054) i`,[prefix]);
}

export function seasonPriorityListQuery(definition) {
  const start = definition.indexOf('with ranked as materialized');
  const end = definition.indexOf(' into result;', start);
  assert.ok(start >= 0 && end > start, 'Actual protected list query must be available');
  return definition.slice(start,end)
    .replace(/\bcurrent_season\b/g, '$1::text').replace(/\bcurrent_sales_year\b/g, '$2::integer')
    .replace(/\broster_available\b/g, '$3::boolean').replace(/\bfilter_value\b/g, '$4::text')
    .replace(/\binventory_revision\b/g, '0::bigint');
}

export function assertSingleScopeProducer(plan, expectedRows) {
  const nodes=[];
  const visit=node=>{nodes.push(node);for(const child of node.Plans||[])visit(child);};
  visit(plan);
  const producers=nodes.filter(node=>node['Subplan Name']==='CTE scope_hashes');
  assert.equal(producers.length,1,'Scope hashes require one materialized producer');
  assert.equal(producers[0]['Actual Loops'],1,'Scope fingerprints must not be recalculated per joined row');
  assert.equal(producers[0]['Actual Rows'],expectedRows,'Every complete eligible group must be fingerprinted');
}

export async function runSeasonPriorityScaleFixture(db) {
  const actor=randomUUID(), prefix=`SP-SCALE-${randomUUID()}`;
  await db.query('begin');
  try {
    const initial=(await db.query(`select
      (select count(*)::int from public.ph_master_inventory) inventory,
      (select count(*)::int from public.ph_warehouse_assigned_items) assignments,
      (select count(*)::int from private.manager_season_priority_receipts) receipts,
      (select count(*)::int from public.ph_request_delivery_outbox) deliveries`)).rows[0];
    assert.equal(initial.inventory,0,'Scale fixture requires an empty isolated inventory');
    assert.equal(initial.assignments,0,'Scale fixture requires an empty isolated assignment table');
    await db.query("insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1,$2,now(),'{}','{}')",[actor,`${prefix}@example.invalid`]);
    await db.query("insert into public.profiles(id,username,display_name,role,must_change_password) values($1,$2,'Scale Manager','MANAGER',false)",[actor,prefix.toLowerCase()]);
    await db.query("insert into public.ph_app_settings(key,value) values('current_season_salesyear','{\"seasonCode\":\"F1\",\"salesYear\":27}') on conflict(key) do update set value=excluded.value");
    await seedSeasonPriorityScaleRows(db,prefix);
    await db.query("update public.app_dataset_revisions set state='ready',revision=greatest(revision,1) where key in ('ph_master_inventory','ph_cav_import','ph_warehouse_assigned_items')");
    await db.query('analyze public.ph_master_inventory');
    await db.query('analyze public.ph_cav_import');
    await db.query('analyze public.ph_warehouse_assigned_items');
    const fingerprint=async()=> (await db.query(`select md5(string_agg(unique_id||':'||coalesce(priority,''),',' order by unique_id)) value from public.ph_master_inventory`)).rows[0].value;
    const before=await fingerprint();
    await db.query("set local statement_timeout='8s'");
    await db.query("set local lock_timeout='3s'");
    const started=performance.now();
    const listed=(await db.query('select public.manager_season_priority_list_v1($1,$2) result',[actor,'all'])).rows[0].result;
    const coldMs=Math.round(performance.now()-started);
    assert.equal(listed.ok,true);
    assert.equal(listed.rows.length,50);
    assert.ok(coldMs<8000,'Cold protected list must fit the existing production 8s budget');
    assert.ok(listed.rows.every(row=>[2,3,4].includes(row.priority)&&row.assignmentAuthoritative===true));
    const parity=(await db.query(`select bool_and(row->>'scopeFingerprint'=private.manager_season_priority_scope_fingerprint_v1(row->>'itemcode')) ok from jsonb_array_elements($1::jsonb) row`,[JSON.stringify(listed.rows)])).rows[0].ok;
    assert.equal(parity,true,'Every returned fingerprint must equal the full frozen scope helper');
    for(const filter of ['scale_manager_a','__unassigned__']) {
      const filtered=(await db.query('select public.manager_season_priority_list_v1($1,$2) result',[actor,filter])).rows[0].result;
      const expected=listed.rows.filter(row=>filter==='__unassigned__'?row.resolvedAssignedTo.length===0:row.resolvedAssignedTo.includes(filter));
      assert.deepEqual(filtered.rows,expected,'Filtering must follow selection, without changing row contents');
      assert.deepEqual(filtered.assignedToOptions,listed.assignedToOptions,'Filter options retain the complete eligible set');
    }
    const definition=(await db.query("select pg_get_functiondef('public.manager_season_priority_list_v1(uuid,text)'::regprocedure) source")).rows[0].source;
    const explained=(await db.query('explain (analyze,format json) '+seasonPriorityListQuery(definition),['F1',27,true,'all'])).rows[0]['QUERY PLAN'][0];
    assertSingleScopeProducer(explained.Plan,50);
    assert.equal(await fingerprint(),before,'List and plan probes must leave inventory priorities unchanged');
    const final=(await db.query(`select (select count(*)::int from private.manager_season_priority_receipts) receipts,(select count(*)::int from public.ph_request_delivery_outbox) deliveries`)).rows[0];
    assert.deepEqual(final,{receipts:initial.receipts,deliveries:initial.deliveries},'List must not create inquiries or delivery');
    console.log(JSON.stringify({ok:true,fixture:'season-priority-production-scale',inventoryRows:9364,assignmentRows:4055,
      eligibleRows:50,coldMs,scopeProducerLoops:1,planExecutionMs:explained['Execution Time'],fingerprintParity:true,filters:true,inventoryUnchanged:true,deliveryUnchanged:true}));
  } finally { await db.query('rollback'); }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const connectionString=process.env.SEASON_PRIORITY_TEST_DB_URL||'';
  const target=new URL(connectionString||'postgresql://invalid');
  assert.equal(process.env.CI,'true','Scale fixtures require isolated CI');
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname),'Hosted database fixtures forbidden');
  assert.equal(target.pathname,'/postgres','Unexpected isolated database');
  const db=new pg.Client({connectionString,connectionTimeoutMillis:10000,query_timeout:10000,application_name:'isolated_season_priority_scale_test'});
  await db.connect();
  try { await runSeasonPriorityScaleFixture(db); } finally { await db.end(); }
}
