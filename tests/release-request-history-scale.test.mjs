import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260924181019_optimize_request_history_read_projection.sql',import.meta.url),'utf8');
test('History caches actor scope and projects credit only after full filtered paging',()=>{
  assert.equal((sql.match(/credit_allowed:=public.navigation_module_allowed_v1/g)||[]).length,1);
  assert.doesNotMatch(sql,/sales_private\.can_read_source\(/);
  assert.match(sql,/rep_scoped:=sales_private\.is_rep\(actor.role\) or actor.username in \('ben_brown','chance_alldredge'\)/);
  const filtered=sql.indexOf('filtered as materialized'),page=sql.indexOf('page as materialized'),credit=sql.indexOf("'canRequestCredit'");
  assert.ok(filtered>0&&page>filtered&&credit>page);
  assert.match(sql,/where not rep_scoped or rep=actor.id or sales_private.key\(row->>'request_created_by_username'\)=actor_key/);
  assert.match(sql,/not exists\(select 1 from public.ph_request_history h where h.unique_id=a.unique_id\)/);
  assert.match(sql,/from public,anon,authenticated/);
  const bodyless=sql.replace(/as \$\$[\s\S]*?end \$\$;/,'');
  assert.doesNotMatch(bodyless,/\b(?:update|insert|delete|select|call)\s+(?:public\.|private\.|sales_private\.)/i);
});
test('scale fixture rejects hosted databases before connecting',()=>{
  const result=spawnSync(process.execPath,['scripts/test-request-history-scale.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',
    env:{...process.env,CI:'true',REQUEST_HISTORY_TEST_DB_URL:'postgresql://invalid:invalid@hosted.example.invalid/postgres'}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Hosted database fixtures forbidden/);
});
