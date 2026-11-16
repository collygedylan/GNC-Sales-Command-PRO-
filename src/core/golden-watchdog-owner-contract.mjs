import assert from 'node:assert/strict';

export function assertRecountGrouping(runFunctions,plain,functionSource,read) {
  const context = runFunctions('assets/app-runtime.js', ['buildReclassRecountLocationGroups'], {
    Array, Number, String, requestsInventory: [],
    fullInventory: [{ ITEMCODE: '000745.250.9', COMMONNAME: 'Taylor Juniper', CONTSIZE: '#25' }]
  });
  const groups = plain(context.buildReclassRecountLocationGroups([{
    id: 'job-1', itemcode: '006737.070.1', commonname: 'Unknown', locationcode: 'A.05.000', requested_by_username: 'requester',
    lines: [{ source_unique_id: 's1', lotcode: '27.S1', season: 'S1', on_hand: 5, available: 4, review: 1 }],
  }, {
    id: 'job-2', itemcode: '006737.070.1', commonname: 'Test Plant', locationcode: 'A.05.000', requested_by_username: 'requester',
    lines: [
      { source_unique_id: 's1', lotcode: '27.S1', season: 'S1', on_hand: 5, available: 4, review: 1 },
      { source_unique_id: 'u1', lotcode: '27.U1', season: 'U1', on_hand: 5, available: 3, review: 2 },
    ],
  }, {
    id: 'job-3', itemcode: '000745.250.1', commonname: 'Unknown', locationcode: 'B.05.000', requested_by_username: 'requester',
    lines: [{ source_unique_id: 't1', lotcode: '27.F1', season: 'F1', on_hand: 8, available: 6, review: 2 }],
  }]));
  assert.equal(groups.length, 2);
  assert.equal(groups[0].job_ids.length, 2);
  assert.equal(groups[0].commonname, 'Test Plant');
  assert.equal(groups[0].contsize, '#7');
  assert.equal(groups[0].locationcode, 'A.05.000');
  assert.equal(groups[0].system_on_hand, 10);
  assert.deepEqual(groups[0].lines.map(line => [line.lotcode, line.on_hand, line.available, line.review]), [['27.S1', 5, 4, 1], ['27.U1', 5, 3, 2]]);
  assert.equal(groups[1].commonname, 'Taylor Juniper');
  assert.equal(groups[1].contsize, '#25');
  assert.equal(new Set(groups.map(group => `${group.itemcode.toUpperCase()}|${group.locationcode.toUpperCase()}`)).size, groups.length);
  assert.match(functionSource('Code.gs', 'handleSignedReclassRecountCompletion_'), /On Hand[^]*Available[^]*Review[^]*countedTotal/);
  const surgicalMigration = read('supabase/migrations/20261025003000_agdata_v2361_surgical_restore.sql');
  const canonicalMigration = read('supabase/migrations/20261025013000_agdata_v2362_canonical_requests.sql');
  const uniformMigration = read('supabase/migrations/20261025023000_agdata_v2363_uniform_active_history_architecture.sql');
  assert.match(surgicalMigration, /ph_reclass_recount_jobs_pending_item_location_v2361_idx/);
  assert.match(surgicalMigration, /RECOUNT_NAME_UNRESOLVED/);
  assert.match(uniformMigration, /ph_active_recount[^]*ph_historical_inventory_dimensions[^]*regexp_replace[^]*identity_rank = 1/);
  assert.match(read('supabase/functions/app-api/index.ts'), /ph_active_recount\?select=id,itemcode,commonname/);
  assert.doesNotMatch(canonicalMigration, /drop table[^;]*ph_reclass_recount_jobs/i);
}

export async function assertOwnedWatchdogReview(runFunctions) {
  let scope='owner',writes=0,receipt={ok:true,resolved:1,confirmed_ids:[12762]};
  const context=runFunctions('assets/row-workflow-functions.js',['resolveReviewedWatchdogEvents'],{
    currentUser:'dylan_collyge',APP_VERSION:'3.0.86',SUPABASE_URL:'https://fixture',
    getSupabaseReadIdentityScope:()=>scope,getNativeAuthRequestHeaders:async()=>({Authorization:'Bearer fixture'}),
    fetchWithTimeout:async(url,options)=>{
      writes++;
      assert.equal(url,'https://fixture/rest/v1/rpc/resolve_runtime_watchdog_events_v23158');
      assert.deepEqual(JSON.parse(options.body),{p_ids:[12762]});
      assert.equal(options.headers['x-client-info'],'agdata/3.0.86');
      return {ok:true,json:async()=>receipt};
    },
  });
  assert.equal((await context.resolveReviewedWatchdogEvents([12762])).resolved,1);
  receipt={ok:true,resolved:0,confirmed_ids:[12762]};
  assert.equal((await context.resolveReviewedWatchdogEvents([12762])).resolved,0);
  for(const invalid of [{ok:true,resolved:1,confirmed_ids:[12763]},
    {ok:true,resolved:1,confirmed_ids:[]},{ok:false,resolved:1,confirmed_ids:[12762]},
    {ok:true,resolved:-1,confirmed_ids:[12762]}]) {
    receipt=invalid;
    await assert.rejects(context.resolveReviewedWatchdogEvents([12762]),/WATCHDOG_REVIEW_RECEIPT_INVALID/);
  }
  context.getNativeAuthRequestHeaders=async()=>({});
  await assert.rejects(context.resolveReviewedWatchdogEvents([12762]),/WATCHDOG_REVIEW_SESSION_REQUIRED/);
  context.getNativeAuthRequestHeaders=async()=>{scope='another-account';return {Authorization:'Bearer fixture'};};
  scope='owner';
  await assert.rejects(context.resolveReviewedWatchdogEvents([12762]),/WATCHDOG_REVIEW_SESSION_REQUIRED/);
  const before=writes;context.currentUser='nelly_aguilar';
  await assert.rejects(context.resolveReviewedWatchdogEvents([12762]),/WATCHDOG_REVIEW_DENIED/);
  assert.equal(writes,before);
}
