import assert from 'node:assert/strict';
import {getSupportedFunctions,extractTempStatements,probeSql,validateShapes,functionInventorySql} from '../../scripts/sql-lint-temp-context.mjs';

export function assertCropTierGlossary(read,runFunctions) {
  const migration = read('supabase/migrations/20261026020000_agdata_v2367_crop_tier_aura_glossary.sql');
  for (const marker of ['get_consolidation_move_candidates_v1', "'CARRY_OVER'", "'CURRENT_CROP'", "'FUTURE_CROP'",
    'source_profile.max_sales_year<settings.current_sales_year', 'source_profile.min_sales_year=settings.current_sales_year',
    'destination_profile.max_sales_year<settings.current_sales_year', 'destination_profile.min_sales_year=settings.current_sales_year',
    'candidate.sales_year=source.sales_year', 'get_consolidation_move_candidates_v1() candidate',
    'aura_inventory_crop_tier_v1', 'definition text', "synonyms text[]"]) {
    assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const term of ['carry over','current crop','future crop','inv consolidation','loc photo match','request sales impact',
    'mistake guy','historical orders','historical reserves','historical drive around','location moves','suspend tag',
    'recount','bunch notes','eval work','shear list']) assert.match(migration, new RegExp(`'${term}'`));
  assert.match(read('supabase/migrations/20261026034500_agdata_v2367_historical_drive_fast_read.sql'),
    /historical_drive_file_page_v2367[^]*item_key_v2367[^]*state_hash_v2367/);

  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  for (const marker of ['006138.021.1', 'G.15.000', 'E.22.000', '008404.010.1', 'C.11.034', 'C.11.054']) {
    assert.match(runner, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const runtime = read('assets/app-runtime.js');
  for (const marker of ['getInventoryConsolidationValidDestinations', 'All Crop Tiers', 'Carry Over (&lt; SY',
    'Current Crop (SY', 'Future Crop (&gt; SY', 'CARRY_OVER', 'CURRENT_CROP', 'FUTURE_CROP']) assert.ok(runtime.includes(marker), marker);
  assert.doesNotMatch(runtime, /OLDER SY -> ANY SY|Current SY -> Same SY|Older SY -> Any SY/);

  const parser = runFunctions('supabase/functions/app-api/index.ts', ['parseAuraDeterministicInventoryQuestion'], { exports: {} });
  assert.equal(parser.parseAuraDeterministicInventoryQuestion('show carry-over boxwood').cropTier, 'CARRY_OVER');
  assert.equal(parser.parseAuraDeterministicInventoryQuestion('show current crop').cropTier, 'CURRENT_CROP');
  assert.equal(parser.parseAuraDeterministicInventoryQuestion('show future crop').cropTier, 'FUTURE_CROP');
  const verifier = read('scripts/verify-live-request-queue.mjs');
  for (const marker of ['requestBadgeCount !== 6', 'badPairExcluded', 'CARRY OVER -> CARRY OVER',
    'CURRENT CROP -> CURRENT CROP', 'auraGlossaryTerms']) assert.match(verifier, new RegExp(marker));
}

function compiledOrderFixture(read) {
  const source=read('supabase/migrations/20261112060000_agdata3078_compiled_drive_order_delta.sql');
  const definition=source.match(/create function private\.build_compiled_drive_order_delta_v3078[\s\S]*?\$compiled\$;/)[0];
  const body=definition.match(/as \$compiled\$([\s\S]*?)\$compiled\$;/)[1];
  return {schema:'private',name:'build_compiled_drive_order_delta_v3078',arguments:'',argumentNames:[],body,definition};
}

function assertCurrentAuthorityEpoch() {
  const body="declare destination_season text;\ndestination_lot text;\nactor_username text;\nactor_profile public.profiles%rowtype;\nBEGIN\n"
    +"perform private.require_reclass_capability_v3076(p_actor_id,'{}'::jsonb);\n"
    +"actor_username := lower(btrim(coalesce(actor_profile.username,'')));\n"
    +'create temp table reclass_move_targets_v1(destination_season text,destination_lot text) on commit drop;\nEND;';
  const item={schema:'public',name:'apply_inventory_reclass_move_v1',arguments:'uuid, text, bigint, text, jsonb, jsonb',
    argumentNames:['p_actor_id','p_command_id','p_expected_revision','p_source_uid','p_source_identity','p_lines'],body,
    definition:'CREATE FUNCTION public.apply_inventory_reclass_move_v1() RETURNS void LANGUAGE plpgsql AS $$'+body+'$$;'};
  assert.doesNotThrow(()=>getSupportedFunctions([item],{allowMissing:true}));
  for(const changed of [body.replace('require_reclass_capability_v3076','unreviewed_capability'),
    body.replace('actor_profile.username','actor_profile.id')]) {
    assert.throws(()=>getSupportedFunctions([{...item,body:changed}],{allowMissing:true}),/LOCAL_DECLARATION_CHANGED/);
  }
}

export function assertCompiledLintContracts(read) {
  const fixture=compiledOrderFixture(read);
  const [parsed]=getSupportedFunctions([fixture],{allowMissing:true});
  assert.equal(parsed.specification.compiledProbe,true);
  assert.deepEqual(parsed.statements.map(statement=>statement.name),['erp_order_delta_v23196']);
  assert.ok(parsed.statements.every(statement=>/WITH NO DATA;$/i.test(statement.statement)));
  assert.throws(()=>getSupportedFunctions([{...fixture,name:'unregistered_order_delta'}],{allowMissing:true}),/FUNCTION_UNSUPPORTED/);
  assert.throws(()=>getSupportedFunctions([{...fixture,arguments:'uuid'}],{allowMissing:true}),/FUNCTION_SIGNATURE_CHANGED/);
  assert.throws(()=>getSupportedFunctions([fixture]),/FUNCTION_SET_CHANGED/);
  assert.throws(()=>probeSql([parsed]),/SETUP_PRODUCER_MISSING/);
  const one='create temp table ph_master_ordinal_edges on commit drop as select 1::bigint as row_number;';
  const pair='begin if p_compiled then '+one+' else '+one+' end if;end;';
  const options={duplicateTables:{ph_master_ordinal_edges:2},allowNoData:true};
  assert.throws(()=>extractTempStatements(pair,'unreviewed'),/DUPLICATE_TEMP_TABLE/);
  assert.equal(extractTempStatements(pair,'reviewed',options).length,2);
  assert.throws(()=>extractTempStatements(one,'reviewed',options),/VARIANT_COUNT_CHANGED/);
  assert.throws(()=>extractTempStatements(pair+one,'reviewed',options),/DUPLICATE_TEMP_TABLE/);
  const empty='create temp table empty_stage on commit drop as select 1 as id with no data;';
  assert.throws(()=>extractTempStatements(empty,'legacy'),/UNEXPECTED_NO_DATA/);
  assert.equal(extractTempStatements(empty,'reviewed',{allowNoData:true})[0].statement,empty);
  assertCurrentAuthorityEpoch();
}

export function assertSetBasedErpIngestion(read,functionSource) {
  const migration = read('supabase/migrations/20261026070000_agdata_v2369_fast_live_erp_ingestion.sql');
  const appsScript = read('Code.gs');
  const appApi = read('supabase/functions/app-api/index.ts');
  const fastSync = read('scripts/fast-live-erp-sync.mjs');
  for (const rpc of ['check_erp_file_sync_needed_v1', 'fast_ingest_drive_around_v1',
    'fast_ingest_soc_orders_v1', 'fast_ingest_soc_reserves_v1', 'fast_ingest_cav_v1',
    'fast_ingest_warehouse_assigned_v1']) assert.ok(migration.includes(rpc), rpc);
  for (const marker of ["set statement_timeout='200ms'", "'target_ms',50", "'target_ms',2000",
    'jsonb_populate_record(null::%s,source_row.value)', 'bulk_import_master_snapshot_v1',
    'reconcile_inventory_location_evidence_v1', 'refresh_soc_order_history_v2366',
    'refresh_reserve_history_v2366', 'row_state_hash', 'source_content_hash', 'source_modified_at']) {
    assert.ok(migration.includes(marker), marker);
  }
  assert.doesNotMatch(migration, /\b(?:drop\s+table|truncate)\b/i);
  assert.doesNotMatch(migration, /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.ph_(?:active_request|requests_pending|reclass_recount|bunch_note)/i);
  assert.match(migration, /revoke all on function public\.fast_ingest_drive_around_v1\(jsonb,jsonb\) from public,anon,authenticated/);
  assert.match(migration, /current_setting\('agdata\.fast_erp_defer_history',true\)='on'/);
  for (const marker of ['processFastLiveFile_', 'check_erp_file_sync_needed_v1',
    'FAST_ERP_COMPLETE_SNAPSHOT_REQUIRED', 'runWarehouseAssignedOnly']) assert.ok(appsScript.includes(marker), marker);
  assert.match(appApi, /action === "fast_erp_ingest"[^]*FULL_ACCESS_USER_KEYS[^]*check_erp_file_sync_needed_v1[^]*rpcByDataset/);
  for (const marker of ['objectRows', 'latestSources', 'check_erp_file_sync_needed_v1',
    'FAST_LIVE_BATCH_SIZE', 'shouldIncludeSocLiveRow', 'disable trigger user', "'--linked'", 'supabase.js']) assert.ok(fastSync.includes(marker), marker);
  assert.doesNotMatch(fastSync, /FAST_LIVE_ERP_DATABASE_URL|GNC_SUPABASE_DB_URL|new Pool|from 'pg'/);
  assert.match(functionSource('assets/app-runtime.js', 'runGoogleAppsScriptTrigger'), /action: 'erp_sync'[^]*operation: 'start'[^]*maxAttemptsPerStage: 1/);
  assert.doesNotMatch(functionSource('assets/app-runtime.js', 'runGoogleAppsScriptTrigger'), /postGoogleScriptJsonPayload|manual_run|manual_continue/);
}

export function assertTemporaryReaderContracts() {
  const body='BEGIN RETURN EXISTS(SELECT 1 FROM pg_temp.ph_master_bulk_context_v3046 c WHERE c.run_id=p_run AND c.request_id=p_request); END;';
  const fixture={schema:'private',name:'has_master_bulk_context_v3046',arguments:'uuid, uuid',
    argumentNames:['p_run','p_request'],body,definition:'CREATE FUNCTION private.has_master_bulk_context_v3046() RETURNS boolean LANGUAGE plpgsql AS $$'+body+'$$;'};
  const [reader]=getSupportedFunctions([fixture],{allowMissing:true});
  assert.equal(reader.statements.length,0,'reader coverage does not require constructing a temporary relation');
  assert.deepEqual(reader.specification.contextTables,['ph_master_bulk_context_v3046']);
  assert.throws(()=>validateShapes([reader],[]),/SHAPE_COUNT_MISMATCH/);
  const [valid]=validateShapes([reader],[{name:'ph_master_bulk_context_v3046',columns:[{name:'run_id',type:'uuid'},{name:'request_id',type:'uuid'}]}]);
  assert.match(valid.pragmas[0],/run_id uuid, request_id uuid/);
  assert.throws(()=>getSupportedFunctions([{...fixture,name:'unregistered_reader'}],{allowMissing:true}),/FUNCTION_UNSUPPORTED/);
  assert.throws(()=>getSupportedFunctions([{...fixture,arguments:'uuid'}],{allowMissing:true}),/FUNCTION_SIGNATURE_CHANGED/);
  assert.match(functionInventorySql,/anchor\.proname='build_compiled_drive_order_delta_v3078'[\s\S]*p\.prosrc ~\* 'pg_temp\[\.\]'/);
}
