import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260924172552_request_drive_evidence_reset_guard.sql',import.meta.url),'utf8');
test('reset correction is definition-only, preserves service-only permissions and reset CAS',()=>{
  assert.equal((migration.match(/create or replace function /g)||[]).length,2);
  const outsideBodies=migration.replace(/as \$function\$[\s\S]*?\$function\$;/g,'');
  assert.doesNotMatch(outsideBodies,/\b(?:update|insert|delete|select|call|do)\s+(?:public\.|private\.|\$)/i);
  assert.match(migration,/completion\.av_rule_last_cleared_at < completion\.completed_at/);
  assert.match(migration,/candidate\.av_rule_last_cleared_at >= completed_at/);
  for(const field of ['av_rule_last_cleared_at','av_rule_last_clear_reason'])
    assert.ok(migration.includes(`master.${field} is not distinct from candidate.${field}`));
  assert.equal((migration.match(/set search_path = ''/g)||[]).length,2);
  assert.equal((migration.match(/if not private.is_service_role_request\(\)/g)||[]).length,2);
  assert.equal((migration.match(/from public, anon, authenticated/g)||[]).length,2);
  assert.doesNotMatch(migration,/ph_request_delivery_outbox|claim_request_delivery_events/);
});
test('concurrency fixture refuses hosted databases before connecting',()=>{
  const result=spawnSync(process.execPath,['scripts/test-request-drive-reset-concurrency.mjs'],{
    cwd:new URL('../',import.meta.url),encoding:'utf8',
    env:{...process.env,CI:'true',REQUEST_DRIVE_TEST_DB_URL:'postgresql://invalid:invalid@hosted.example.invalid/postgres'}
  });
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Hosted database fixtures forbidden/);
});
