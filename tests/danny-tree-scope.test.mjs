import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('index.html');
const edge = read('supabase/functions/app-api/index.ts');
const migration = read('supabase/migrations/20260901171419_danny_tree_production_scope.sql');

test('Danny has one case-normalized inventory scope and every other user remains unrestricted', () => {
  assert.match(html, /danny_fountain:\s*Object\.freeze\(\['330_TREES'\]\)/);
  assert.match(html, /function normalizeInventoryPlantGroupCode[\s\S]*toUpperCase\(\)/);
  assert.match(html, /function isInventoryPlantGroupRowVisibleToCurrentUser[\s\S]*if \(!scope\.length\) return true;[\s\S]*scope\.includes\(plantGroupCode\)/);
  assert.match(html, /function scopeMasterInventoryRowsForCurrentUser[\s\S]*filter\(\(item\) => isMasterInventoryRowVisibleToCurrentUser/);
  assert.match(html, /function scopeEvalVisibleRowsForCurrentUser[\s\S]*filter\(\(item\) => isEvalScopedDataRowVisibleToCurrentUser/);
  assert.match(html, /!shouldScopeMasterInventoryToCurrentEval\(\) && !hasCurrentUserInventoryPlantGroupScope\(\)/);
  assert.match(html, /item && item\.snapshot && item\.snapshot\.PLANTGROUPCODE/);

  const visible = (username, plantGroupCode) => {
    const scopes = { danny_fountain: ['330_TREES'] };
    const scope = scopes[String(username || '').trim().toLowerCase()] || [];
    if (!scope.length) return true;
    return scope.includes(String(plantGroupCode || '').trim().toUpperCase());
  };
  assert.equal(visible('danny_fountain', '330_trees'), true);
  assert.equal(visible('danny_fountain', ' 330_TREES '), true);
  assert.equal(visible('danny_fountain', '130_SHRUB'), false);
  assert.equal(visible('danny_fountain', ''), false);
  assert.equal(visible('dylan_collyge', '130_SHRUB'), true);
});

test('Production Drive and open workflow rows preserve and enforce PLANTGROUPCODE', () => {
  assert.match(html, /buildProductionWorkflowSnapshot[\s\S]*'PLANTGROUPCODE'/);
  assert.match(html, /plantgroupcode:\s*firstNonEmptyValue\(item\.PLANTGROUPCODE, item\.plantgroupcode/);
  assert.match(html, /productionWorkflowState\.rows = \(Array\.isArray\(rows\) \? rows : \[\]\)[\s\S]*isInventoryPlantGroupRowVisibleToCurrentUser/);
  assert.match(html, /cacheProductionWorkflowRow[\s\S]*isInventoryPlantGroupRowVisibleToCurrentUser\(row\)/);
});

test('native Auth RLS uses an active profile and restrictive policies for plant-bearing tables', () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /create or replace function private\.current_inventory_plantgroup_scope_v1\(\)/);
  assert.match(migration, /lower\(btrim\(coalesce\(p\.username, ''\)\)\) = 'danny_fountain'[\s\S]*array\['330_TREES'\]/);
  assert.match(migration, /p\.disabled_at is null[\s\S]*p\.locked_until[\s\S]*must_change_password/);
  assert.match(migration, /as restrictive[\s\S]*for all[\s\S]*to authenticated/);
  assert.match(migration, /upper\(btrim\(coalesce\(plantgroupcode, ''\)\)\) = any/);
  for (const table of ['ph_master_inventory', 'ph_active_request', 'ph_soc_master', 'ph_sales_office', 'ph_production_workflow_rows']) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon/);
  assert.match(migration, /commit;\s*$/);
});

test('legacy app sessions receive the same server-side scope for reads and writes', () => {
  assert.match(edge, /\["danny_fountain", "330_TREES"\]/);
  assert.match(edge, /INVENTORY_PLANTGROUP_SCOPED_DB_TABLES/);
  assert.match(edge, /params\.set\("plantgroupcode", `eq\.\$\{scope\}`\)/);
  assert.match(edge, /method === "POST" \|\| method === "PATCH"[\s\S]*normalizeInventoryPlantGroup[\s\S]*PLANTGROUP_SCOPE_DENIED/);
  assert.match(edge, /method === "PATCH" && !hasPlantGroup[\s\S]*\? true/);
  for (const table of ['ph_reserves', 'ph_shear_list', 'ph_inventory_edit_requests', 'ph_flyer_folder_rows', 'ph_flyer_folder_history']) {
    assert.match(edge, new RegExp(`"${table}"`));
  }
  const handleDb = edge.slice(edge.indexOf('async function handleDb'), edge.indexOf('async function handlePhotoUpload'));
  assert.match(handleDb, /applyLegacyInventoryPlantGroupScope/);
  assert.ok(handleDb.indexOf('applyLegacyInventoryPlantGroupScope') < handleDb.indexOf('restRequest(table, method, query, body)'));
});
