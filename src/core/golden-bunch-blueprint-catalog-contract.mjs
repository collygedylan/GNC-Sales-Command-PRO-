import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

export function assertHistoricalConsolidation(read) {
  const dedup = read('supabase/migrations/20261026003000_agdata_v2366_historical_state_dedup.sql');
  for (const marker of ['deduplicate_drive_around_report_rows_batch_v1(p_max_files integer default 25)',
    'row_state_hash', 'seen_count', "time '23:30'", "time '06:15'", "set statement_timeout='4500ms'",
    'historical_archive_read_v2']) assert.match(dedup, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(dedup, /(?:^|\n)\s*truncate\s/i);

  const consolidation = read('supabase/migrations/20261026004500_agdata_v2366_inventory_consolidation.sql');
  for (const marker of ["array['#2','#3','#1','2DP','3DP','1GP','8DP','8 IN.','5DP','7DP','QT','2QTD','6QTD','8\" P','3GP','1DP']",
    'source.loc_on_hand>0 and source.loc_on_hand<100', 'source.sales_year<current_sales_year or candidate.sales_year=source.sales_year',
    'inventoryConsolidation', 'destination_salesyear']) assert.match(consolidation, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(consolidation, /insert\s+into\s+public\.ph_requests_pending/i);

  const html = read('index.html');
  for (const marker of ['inventory-open-suggestions', 'view-inventory-suggestion', 'view-inv-consolidation']) assert.match(html, new RegExp(marker));
  const runtime = read('assets/app-runtime.js');
  for (const marker of ['INVENTORY_CONSOLIDATION_SIZES', 'openInventorySuggestionView', 'openInventoryConsolidationView',
    'Nothing enters Location Moves until you click Send.', 'Send to Location Moves']) assert.match(runtime, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(read('supabase/functions/app-api/index.ts'), /inventory_consolidation_suggestions_v1/);
  assert.match(read('supabase/migrations/20261026010000_agdata_v2366_inventory_consolidation_sales_year_fix.sql'),
    /inventory_consolidation_sales_year_v2366\(private\.season_sales_settings_v1\(\)->>''salesYear'',null\)/);
  const consolidationCache = read('supabase/migrations/20261026011500_agdata_v2366_inventory_consolidation_cache.sql');
  for (const marker of ['inventory_consolidation_cache_v2366', 'refresh_inventory_consolidation_cache_v2366',
    "set statement_timeout='500ms'", 'background refresh never creates Queue work']) assert.match(consolidationCache, new RegExp(marker));
  assert.match(read('supabase/migrations/20261026013000_agdata_v2366_historical_archive_page_dedup.sql'),
    /select distinct on \(state_hash\)[^]*state-dedup-v2366/);
  assert.match(read('supabase/migrations/20261026014500_agdata_v2366_drive_archive_search_hash_fix.sql'),
    /drive-search-row-alias-v2366[^]*drive_around_report_state_hash_v2366\(raw_row\)/);
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'), /agdataV2366HistoricalStateDedupMigrationName[^]*agdataV2366InventoryConsolidationMigrationName[^]*registeredReleaseDatabaseMigrations/);
}

export function assertBlueprintCatalogIsolation(read) {
  const database=new DatabaseSync(':memory:');
  const fixture=read('supabase/tests/bunch_note_v221_blueprint.sql');
  const selection=fixture.match(/select \* into option_row from bunch_note_private\.options[\s\S]*?;/)?.[0];
  assert.ok(selection,'blueprint fixture selects its actual catalogue row');
  const query=selection.replace('into option_row','');
  const id='bb000000-0000-4000-8000-000000000001';
  try {
    database.exec(`attach database ':memory:' as bunch_note_private;
      create table bunch_note_private.options(id text,active boolean,category text,kind text);
      insert into bunch_note_private.options values
      ('00000000-0000-4000-8000-000000000001',true,'hauling','hauling'),
      ('${id}',true,'sequence','instruction'),
      ('00000000-0000-4000-8000-000000000002',true,'placement','move');`);
    assert.deepEqual(database.prepare(query).all().map(row=>row.id),[id]);
    for(const invalid of ['active=false',"kind='hauling'","category='hauling'"]) {
      database.exec(`update bunch_note_private.options set active=true,kind='instruction',category='sequence' where id='${id}';
        update bunch_note_private.options set ${invalid} where id='${id}';`);
      assert.equal(database.prepare(query).all().length,0,'an invalid fixed option cannot fall back to an unrelated action');
    }
  } finally {
    database.close();
  }
}
