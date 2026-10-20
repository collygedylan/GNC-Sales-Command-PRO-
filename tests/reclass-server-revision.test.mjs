import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { normalizeReclassMoveCommand } from '../services/reclassMove.ts';
import { handleInventoryReclassMove } from '../supabase/functions/_shared/production-workflow.ts';
import { migrationContractQuery, reclassServerRevisionMigrationName, releaseDatabaseMigrations } from '../scripts/apply-item-low-stock-migration.mjs';

const actor = { id: 'ec34e498-ed81-4b30-8236-5751af4e68cb', username: 'jd_jones',
  role: 'ADMIN', must_change_password: false, disabled_at: null, locked_until: null };
const command = { action: 'inventory_reclass_move', commandId: 'reclass-current-command-0001', moves: [{
  source: { uniqueId: 'row-1', identity: { unique_id: 'row-1', itemcode: 'ITEM', contsize: '#3',
    locationcode: 'C.01.001', lotcode: '27.F1', season: 'F1', ptronhand: '10', ptravailable: '10' } },
  lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 3 }],
}] };

test('missing or null client revision is advisory while malformed watermarks remain invalid', () => {
  assert.equal(normalizeReclassMoveCommand(command).expectedRevision, null);
  assert.equal(normalizeReclassMoveCommand({ ...command, expectedRevision: null }).expectedRevision, null);
  assert.equal(normalizeReclassMoveCommand({ ...command, expectedRevision: 1 }).expectedRevision, 1);
  for (const expectedRevision of [0, -1, 1.5, '1', '', true, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeReclassMoveCommand({ ...command, expectedRevision }), /REVISION_INVALID/);
  }
  const changed = structuredClone(command);
  delete changed.moves[0].source.identity.ptravailable;
  assert.throws(() => normalizeReclassMoveCommand(changed), /SOURCE_INVALID/);
});

test('Edge sends one authenticated atomic command with an optional watermark and unchanged source CAS', async () => {
  const calls = [];
  const supabase = { rpc: async (name, params) => { calls.push({ name, params }); return { data: { status: 'applied' }, error: null }; } };
  for (const expectedRevision of [undefined, null, 1]) {
    await handleInventoryReclassMove({ supabase, actorProfile: actor, payload: { ...command, expectedRevision } });
    const { name, params } = calls.at(-1);
    assert.equal(name, 'apply_inventory_reclass_moves_with_delivery_v1');
    assert.equal(params.p_actor_id, actor.id);
    assert.equal(params.p_command_id, command.commandId);
    assert.deepEqual(params.p_moves, command.moves);
    assert.equal(Object.hasOwn(params, 'p_expected_revision'), expectedRevision === 1);
    if (expectedRevision === 1) assert.equal(params.p_expected_revision, 1);
  }
  assert.equal(calls.length, 3);
  await assert.rejects(handleInventoryReclassMove({ supabase, actorProfile: { ...actor, disabled_at: '2026-10-20' },
    payload: { ...command, expectedRevision: null } }), /PROFILE_INACTIVE/);
  await assert.rejects(handleInventoryReclassMove({ supabase, actorProfile: actor,
    payload: { ...command, actor_id: 'forged' } }), /PAYLOAD_INVALID/);
  assert.equal(calls.length, 3);
});

test('deployment registers the server-bound revision and exact failed-stage lease contract', () => {
  assert.ok(releaseDatabaseMigrations.includes(reclassServerRevisionMigrationName));
  const migration = fs.readFileSync(new URL(`../supabase/migrations/${reclassServerRevisionMigrationName}`, import.meta.url), 'utf8');
  for (const marker of ['batch_receipt.request->>\'expectedRevision\'',
    'resolved_revision := private.lock_ph_master_inventory_for_reclass_lkg_v1()',
    'p_actor_id, p_command_id, resolved_revision, p_moves', "run.state = 'failed'",
    "stage.status = 'staging'", 'stage.published_response is null', 'stage.publication_run_id is null',
    'and not exists (', 'and not lkg_reclass_context then']) assert.ok(migration.includes(marker), marker);
  assert.doesNotMatch(migration, /delete from app_sync_private.import_leases|update public.app_dataset_revisions set state/i);
  for (const marker of ['context.backend_pid = pg_backend_pid()', 'context.transaction_id = txid_current()',
    'context.inventory_revision = current_revision.revision', 'revision.revision = current_revision.revision + 1']) {
    assert.ok(migration.includes(marker), marker);
  }
  const query = migrationContractQuery(reclassServerRevisionMigrationName);
  for (const marker of ['resolved_revision', 'reclass_failed_unpublished_canonical_run_v1',
    'ph_request_delivery_outbox', 'has_function_privilege', 'lkg_reclass_context']) assert.ok(query.includes(marker), marker);
});
