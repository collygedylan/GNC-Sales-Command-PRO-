import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  migrationBody,
  migrationContractQuery,
  releaseDatabaseMigrations,
  suspendTagSenderIdentityMigrationName,
} from '../scripts/apply-item-low-stock-migration.mjs';

test('v2.3.8 Suspend sender identity migration is release-registered with installed security contract', () => {
  const expectedName = '20261019113414_suspend_tag_sender_identity.sql';
  assert.equal(suspendTagSenderIdentityMigrationName, expectedName);
  assert.ok(releaseDatabaseMigrations.includes(expectedName));

  const source = readFileSync(new URL(`../supabase/migrations/${expectedName}`, import.meta.url), 'utf8');
  const body = migrationBody(source);
  assert.match(source, /^begin;\s/i);
  assert.match(source, /add column if not exists sent_by uuid references public\.profiles\(id\)/i);
  assert.match(source, /add column if not exists decision_message text/i);
  assert.match(source, /alter column sent_by set not null/i);
  assert.match(source, /approval_recipients enable row level security/i);
  assert.match(source, /revoke all on table suspend_tag_private\.approval_recipients from public, anon, authenticated/i);
  assert.match(source, /sender_id := nullif\(current_setting\('app\.suspend_tag_actor_id', true\), ''\)::uuid/i);
  assert.match(source, /sender_id := auth\.uid\(\)/i);
  assert.match(source, /SUSPEND_TAG_SENDER_REQUIRED/);
  assert.match(source, /session_active\(p_actor_id, p_session_id\)/);
  assert.match(source, /SUSPEND_TAG_DECISION_MESSAGE_INVALID/);
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(body, /^begin;/i);
  assert.doesNotMatch(body, /commit;\s*$/i);

  const contract = migrationContractQuery(expectedName);
  for (const marker of [
    "column_name='sent_by' and udt_name='uuid' and is_nullable='NO'",
    "column_name='decision_message' and data_type='text'",
    "c.relname='approval_recipients' and c.relrowsecurity",
    'aclexplode(coalesce(c.relacl,acldefault(\'r\',c.relowner))) acl',
    'acl.grantee=0 and acl.privilege_type=\'SELECT\'',
    "has_table_privilege('anon','suspend_tag_private.approval_recipients','select')",
    "has_table_privilege('authenticated','suspend_tag_private.approval_recipients','select')",
    "to_regprocedure('suspend_tag_private.capture_decision_message()')",
    "to_regprocedure('suspend_tag_private.request_approval(text)')",
    "to_regprocedure('public.suspend_tag_command_v1(uuid,text,jsonb,uuid,bigint,uuid)')",
    "to_regprocedure('public.prepare_suspend_tag_delivery_v1(uuid,uuid)')",
    'as installed',
  ]) assert.ok(contract.includes(marker), `installed contract is missing ${marker}`);
});

test('v2.3.97 recovers only a unique active physical Suspend source and exposes one service-only Reclass ledger', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261028220500_agdata_v2397_bulk_reclass_override_import.sql', import.meta.url), 'utf8');
  const recovery = migration.slice(migration.indexOf('do $patch_suspend_add_candidates_identity$'), migration.indexOf('$patch_suspend_add_candidates_identity$;') + 37);
  assert.match(recovery, /p_operation=''close''/);
  assert.match(recovery, /p_operation=''add_candidates''/);
  assert.match(recovery, /suspend_tag_private\.eligible\(candidate\.suspend,candidate\.suspend_to\)/);
  assert.match(recovery, /transactionnumber/);
  assert.match(recovery, /quantityshipped/);
  assert.match(recovery, /customeridentityid/);
  assert.match(recovery, /consigneeidentityid/);
  assert.match(recovery, /having count\(\*\)=1/);
  assert.match(recovery, /SUSPEND_TAG_SOURCE_MISSING/);
  assert.match(migration, /create or replace view public\.ph_inventory_reclass_moves with \(security_invoker=true\)/i);
  assert.match(migration, /from private\.ph_inventory_reclass_movements_v1/i);
  assert.match(migration, /grant select on public\.ph_inventory_reclass_moves to service_role/i);
  assert.match(migration, /revoke all on public\.ph_inventory_reclass_moves from public,anon,authenticated/i);
  assert.doesNotMatch(migration, /create table[^;]*ph_inventory_reclass_moves/i);
});
