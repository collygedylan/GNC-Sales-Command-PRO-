import test from 'node:test';
import { assertSuspendRoutingAndDefaults } from '../src/core/golden-soc-suspend-routing.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Workbook routes own evaluator assignment and per-user dropdown defaults',assertSuspendRoutingAndDefaults);
test('SOC cleanup preserves app work and exact Complete Tag tombstones',async()=>{
 const name='20261105190000_suspend_all_routes_and_saved_work.sql',sql=read('supabase/migrations/'+name);
 const {releaseDatabaseMigrations,migrationContractQuery}=await import('../scripts/apply-item-low-stock-migration.mjs');
 assert.ok(releaseDatabaseMigrations.includes(name));assert.ok(migrationContractQuery(name).includes('as installed'));
 assert.ok(sql.includes('and not private.soc_tag_has_saved_work_v23188(to_jsonb(target))'));
 assert.ok(sql.includes("h.event_key='suspend-tag-complete:'||new.unique_id"));
 assert.ok(sql.includes("new.suspend_completed:=true"));
 assert.ok(!sql.includes('where source_uid=new.unique_id or business_key='));
 assert.ok(sql.includes("WHEN 'ms' THEN 'megan_kelly' WHEN 'mk' THEN 'megan_kelly'"));
 assert.ok(!sql.includes("families.owner, 'dylan_collyge'"));
 assert.ok(!/DELETE FROM public.ph_master_inventory|UPDATE public.ph_master_inventory|GRANT /i.test(sql));
});
