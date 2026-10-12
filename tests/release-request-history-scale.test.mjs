import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const sql=fs.readFileSync(new URL('../supabase/archive_migrations/20260924181019_optimize_request_history_read_projection.sql',import.meta.url),'utf8');
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

test('current scale fixture enforces owner-only counts and blocks creator-attributed data without changing the read budget',()=>{
  const source=fs.readFileSync(new URL('../scripts/test-request-history-scale.mjs',import.meta.url),'utf8');
  assert.match(source,/history_redact_financial_v1/);
  assert.match(source,/assigned_rep_id=\$2 or not \$4 and request_created_by_username=\$3/);
  assert.match(source,/Current history hides creator-only evidence assigned to another rep/);
  assert.match(source,/Creator-only detail exposes no other-rep data or credit eligibility/);
  assert.match(source,/durationMs<8000/);
  assert.match(source,/notificationsUnchanged:true/);
});

test('legacy scale seeds restore caller claims before reads even when insertion fails', async () => {
  const source = fs.readFileSync(new URL('../scripts/test-request-history-scale.mjs', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('async function insertLegacyActiveFixture('), source.indexOf('export async function runRequestHistoryScaleFixture('));
  assert.match(helper, /finally/);
  assert.equal((source.match(/await insertLegacyActiveFixture\(db,/g) || []).length, 2);
  assert.match(source, /generate_series\(1,3512\)/);
  assert.match(source, /overlappingActiveRows:3512/);
  for (const fail of [false, true]) {
    const calls = [];
    const db = { async query(sql, values) {
      calls.push({ sql, values });
      if (calls.length === 1) return { rows: [{ role: 'authenticated', claims: '{"role":"authenticated"}' }] };
      if (sql === 'fixture insert' && fail) throw Error('synthetic insert failure');
      return { rows: [] };
    } };
    const run = vm.runInNewContext(helper + '\ninsertLegacyActiveFixture', {});
    if (fail) await assert.rejects(run(db, 'fixture insert', []), /synthetic insert failure/);
    else await run(db, 'fixture insert', []);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).values)), ['authenticated', '{"role":"authenticated"}']);
    assert.match(calls[1].sql, /service_role/);
  }
});
