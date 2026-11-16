import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {existsSync} from 'node:fs';

function committedCommand({args,root,readFileSync,events,production,sandbox,failCommitted}) {
  const workspaceRoot=args[2],command=args.slice(3);
  if(workspaceRoot===production.root) {
    if(command[0]==='test' && command[1]==='db' && command.length>2) {
      assert.equal(command.length,3,'each committed fixture runs alone');
      assert.equal(path.isAbsolute(command[2]),true,'CLI receives the absolute reviewed fixture path');
      events.push(`committed:${command[2]}`);
      if(failCommitted) throw new Error('committed fixture failed');
    } else events.push(command.join(' '));
  }
  if(command[0]==='status') return 'API_URL="http://127.0.0.1:54321"\n';
  if(command[0]==='gen') return readFileSync(path.join(root,workspaceRoot===sandbox.root
    ?'v2/src/services/sandbox.database.types.ts':'supabase/functions/_shared/database.types.ts'),'utf8');
  return '';
}

function runCommittedCase(context,{mode='all',files,failCommitted=false}={}) {
  const {root,runDatabaseCheck,readFileSync,committed}=context,events=[];
  const roots=committedFixtureRoots(os.tmpdir());
  const production={root:roots.production,migrationCount:4,dispose(){events.push('dispose-production');}};
  const sandbox={root:roots.sandbox,migrationCount:1,testCount:1,lintSchemas:['public'],dispose(){}};
  const options={root,mode,environment:{},execute:()=> 'supabase/tests/canonical_schema_contract_test.sql\0',
    preflight:()=>{},resolveCli:()=> 'supabase-fixture',discoverCanonicalHttpTests:()=>['supabase/ci/mock-http.mjs'],
    runHttpTests:()=>events.push('http'),createProductionWorkspace:()=>production,createSandboxWorkspace:()=>sandbox,
    runLintWithTempContext:({action})=>action(),runRollback:()=>{},
    executeNode:args=>committedCommand({args,root,readFileSync,events,production,sandbox,failCommitted})};
  if(files) options.discoverCanonicalCommittedTests=()=>files;
  if(failCommitted) {
    assert.throws(()=>runDatabaseCheck(options),/committed fixture failed/);
    assert.ok(events.includes('stop --no-backup')&&events.includes('dispose-production'));
    assert.equal(events.includes('test db'),false,'a failed committed fixture fails the gate before normal SQL');
    return;
  }
  const result=runDatabaseCheck(options);
  assert.equal(result.committedSqlTests,(files||committed).length);
  const relevant=events.filter(event=>event==='http'||event.startsWith('committed:')
    ||event==='db reset --local --no-seed'||event==='test db');
  const target=file=>file==='supabase/tests/master_snapshot_chunked_staging_v1_test.sql'
    ?path.resolve(production.root,'canonical-fixtures','master_snapshot_chunked_staging_v1_test.sql'):path.resolve(root,file);
  assert.deepEqual(relevant,['http',...(files||committed).flatMap(file=>
    [`committed:${target(file)}`,'db reset --local --no-seed']),'test db']);
}

export function committedFixtureRoots(temporaryDirectory,paths=path) {
  return {production:paths.join(temporaryDirectory,'gnc-committed-production'),
    sandbox:paths.join(temporaryDirectory,'gnc-committed-sandbox')};
}

export function assertCommittedCanonicalOrder(context) {
  const committed=context.discoverTests({root:context.root,group:'sql-canonical-committed'});
  assert.ok(committed.length>0,'the real staging fixture must execute, not only synthetic examples');
  const inputs={...context,committed};
  runCommittedCase(inputs);
  runCommittedCase(inputs,{mode:'staged'});
  runCommittedCase(inputs,{files:['supabase/tests/first_committed_test.sql','supabase/tests/second_committed_test.sql']});
  runCommittedCase(inputs,{failCommitted:true});
}

const retainedTail=[
    'supabase/migrations/20261011032352_aura_voice_soc_reads.sql',
    'supabase/migrations/20261011170000_request_mapping_salesrep_identity.sql',
    'supabase/migrations/20261011193000_historical_requests_price_fallback.sql',
    'supabase/migrations/20261011223000_reclass_concurrent_hold_rows.sql',
    'supabase/migrations/20261011224500_normalize_sales_actor_role_boundaries.sql',
    'supabase/migrations/20261011230000_normalize_navigation_role_boundaries.sql',
    'supabase/migrations/20261012011000_request_history_drilldown_isolation.sql',
    'supabase/migrations/20261012052500_aura_enterprise_domain_voice.sql',
    'supabase/migrations/20261012153000_aura_account_rollout.sql',
    'supabase/migrations/20261012180000_sales_rep_inventory_operations.sql',
    'supabase/migrations/20261012190002_manager_report_read_v2.sql',
    'supabase/migrations/20261012190003_manager_list_read_v2.sql',
    'supabase/migrations/20261013160000_inventory_location_item_on_hand.sql',
    'supabase/migrations/20261013170000_master_inventory_realtime_publication.sql',
    'supabase/migrations/20261014110620_eval2_shared_low_stock_threshold.sql',
    'supabase/migrations/20261014140147_master_lineage_cleanup_bounded.sql',
    'supabase/migrations/20261014142125_season_sales_cav_lookup_index.sql',
    'supabase/migrations/20261014144043_season_sales_skip_empty_mirror_cleanup.sql',
    'supabase/migrations/20261014145025_season_sales_reconciliation_worklist.sql',
    'supabase/migrations/20261014155536_inventory_assignment_reconciliation_batches.sql',
    'supabase/migrations/20261014160924_inventory_assignment_witness_projection.sql',
    'supabase/migrations/20261014161813_inventory_assignment_input_generation.sql',
    'supabase/migrations/20261017203000_bunch_note_multi_assignment_routing.sql',
    'supabase/migrations/20261018014347_bunch_note_blueprint_header_pdf_delivery.sql',
    'supabase/migrations/20261018183204_bunch_note_queue_execution_and_recounts.sql',
    'supabase/migrations/20261019003759_bunch_note_supervisor_assignee_facets_v1.sql',
  ];

export function assertHistoricalManifestContract({root,readHistoricalMigrationManifest,readFileSync}) {
  const manifest = readHistoricalMigrationManifest({ root });
  const workflow = readFileSync(path.join(root, '.github/workflows/release-database.yml'), 'utf8');
  assert.equal(manifest.length,209);
  const rateLimit='20261021042013_app_login_rate_limit_v1.sql';
  assert.deepEqual(manifest.at(-1),{source:'supabase/migrations/'+rateLimit,destination:rateLimit});
  const retained=manifest.filter(entry=>entry.destination!==rateLimit);
  assert.equal(retained.length,208);
  assert.deepEqual(retained.at(-1), {
    source: 'supabase/migrations/20261019003759_bunch_note_supervisor_assignee_facets_v1.sql',
    destination: '20261019003759_bunch_note_supervisor_assignee_facets_v1.sql'
  });
  assert.equal(new Set(manifest.map(entry => entry.destination)).size, manifest.length);
  assert.deepEqual(retained.slice(-26).map(entry => entry.source),retainedTail);
  const sources = new Set(manifest.map(entry => entry.source));
  for (const name of ["20261008190038_reclass_sheared_action_v5.sql","20261009053029_reclass_smart_priority_hold_shield_v6.sql","20261009202507_prompt25_editable_field_shield_and_hold_clear.sql","20261010024830_customer_rep_mapping_management.sql","20261010152556_customer_rep_mapping_finalize_timeout_55s.sql","20261010165013_historical_requests_financial_dashboard.sql","20261011170000_request_mapping_salesrep_identity.sql","20261011193000_historical_requests_price_fallback.sql"]) {
    assert.ok(sources.has(`supabase/migrations/${name}`), `${name} and its read dependencies are replayed`);
  }
  assert.deepEqual(manifest.map(entry => entry.destination), [...manifest.map(entry => entry.destination)].sort());
  const coverageShape = readFileSync(path.join(root, 'supabase/ci/reclass_v7_baseline.sql'), 'utf8');
  assert.match(coverageShape, /sharon_away boolean default false not null/);
  assert.ok(manifest.findIndex(entry => entry.source === 'supabase/ci/reclass_v7_baseline.sql') < manifest.findIndex(entry => entry.destination === '20261009202507_prompt25_editable_field_shield_and_hold_clear.sql'));
  const socShape = readFileSync(path.join(root, 'supabase/ci/suspend_tag_approval_baseline.sql'), 'utf8');
  assert.match(socShape, /alter table public\.ph_soc_master[\s\S]*add column if not exists desigitem text/);
  assert.match(socShape, /alter table public\.ph_reserves add column if not exists desigitem text/);
  for (const entry of manifest) assert.ok(existsSync(path.join(root, entry.source)), entry.source);
  assert.match(workflow, /node scripts\/historical-database-fixture\.mjs "\$RUNNER_TEMP\/gnc-supabase-ci"/);
  assert.doesNotMatch(workflow, /cp supabase\/(?:ci|archive_migrations|migrations)\/[^\s]+\.sql "\$ci_root\/supabase\/migrations\//);
  assert.doesNotMatch(workflow, /python3 - "\$ci_root"/);
}
