import test from 'node:test';
import { assertSocSuspendMembership } from '../src/core/golden-soc-suspend-membership.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Suspend queue retains each workbook destination and explicit lifecycle',assertSocSuspendMembership);
test('Suspend membership migration preserves invoker security and existing data',async()=>{
 const name='20261105180000_soc_suspend_source_membership.sql',sql=read('supabase/migrations/'+name);
 const {releaseDatabaseMigrations,migrationContractQuery}=await import('../scripts/apply-item-low-stock-migration.mjs');
 assert.ok(migrationContractQuery('20261103153000_all_active_suspend_destinations.sql').includes(') workbook_suspend'),'legacy destination migration must recognize the reviewed replacement');
 assert.ok(releaseDatabaseMigrations.includes(name));assert.ok(migrationContractQuery(name).includes('as installed'));
 assert.ok(sql.includes('security_invoker=true'));assert.ok(!/DELETE FROM|UPDATE public|DROP VIEW|GRANT /.test(sql));
});
