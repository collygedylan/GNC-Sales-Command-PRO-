import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { handleInventoryReclassMove, inventoryReclassMoveError } from '../supabase/functions/_shared/production-workflow.ts';

const actor = { id: 'ec34e498-ed81-4b30-8236-5751af4e68cb', username: 'authorized-reclass-user',
  role: 'EVAL', must_change_password: false, disabled_at: null, locked_until: null };
const source = { uniqueId: 'row-1', identity: { unique_id: 'row-1', itemcode: 'ITEM-1', contsize: '#3',
  locationcode: 'C.12.001', lotcode: '27.F1', season: 'F1', ptronhand: '700', ptravailable: '650' } };
const command = { action: 'inventory_reclass_move', commandId: 'reclass-api-command-0001', expectedRevision: 17,
  moves: [{ source, lines: [{ direction: 'move_up', destinationSeason: 'U1', quantity: 610 }] }] };

test('Reclass API binds the authenticated actor and forwards the bounded atomic batch RPC contract', async () => {
  const calls = [];
  const receipt = { ok: true, commandId: command.commandId, requestId: 'batch-id', revision: 18,
    status: 'applied', importStatus: 'pending', rows: [{ table: 'ph_master_inventory', row: { unique_id: 'server-target' } }], movements: [] };
  const supabase = { rpc: async (name, params) => { calls.push({ name, params }); return { data: receipt, error: null }; } };
  const result = await handleInventoryReclassMove({ supabase, actorProfile: actor, payload: command });
  assert.equal(result.commandId, command.commandId);
  assert.equal(result.importStatus, 'pending');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'apply_inventory_reclass_moves_with_delivery_v1');
  assert.equal(calls[0].params.p_actor_id, actor.id);
  assert.equal(calls[0].params.p_command_id, command.commandId);
  assert.deepEqual(calls[0].params.p_moves[0].source, source);
  assert.equal(Object.hasOwn(calls[0].params, 'p_receipt_encoding'), false);
  await assert.rejects(handleInventoryReclassMove({ supabase, actorProfile: actor,
    payload: { ...command, actorId: 'attacker' } }), /PAYLOAD_INVALID/);
});

test('Reclass status lookup proves the same command and returns the top-level committed receipt', async () => {
  const calls = [];
  const receipt = { ok: true, commandId: command.commandId, requestId: 'batch-id', revision: 19,
    status: 'applied', importStatus: 'conflict', movements: [] };
  const supabase = { rpc: async (name, params) => { calls.push({ name, params }); return { data: receipt, error: null }; } };
  const result = await handleInventoryReclassMove({ supabase, actorProfile: actor,
    payload: { action: 'inventory_reclass_move', operation: 'status', commandId: command.commandId } });
  assert.equal(calls[0].name, 'get_inventory_reclass_move_status_v1');
  assert.equal(calls[0].params.p_actor_id, actor.id);
  assert.equal(result.status, 'applied');
  assert.equal(result.importStatus, 'conflict');
  assert.equal(result.requestId, 'batch-id');
  await assert.rejects(handleInventoryReclassMove({ supabase, actorProfile: actor,
    payload: { action: 'inventory_reclass_move', operation: 'status', commandId: command.commandId, moves: [] } }), /STATUS_INVALID/);
});

test('Reclass compact transport is an additive RPC adapter and preserves receipt metadata', async () => {
  const compact = { ok: true, commandId: command.commandId, revision: 18, status: 'applied', importStatus: 'pending',
    rowEncoding: 'master-null-elision-v1', rowColumns: ['unique_id'],
    rows: [{ table: 'ph_master_inventory', values: { unique_id: 'server-target' } }], movements: [] };
  const calls = [];
  const supabase = { rpc: async (name, params) => { calls.push({ name, params }); return { data: compact, error: null }; } };
  const compactCommand = { ...command, receiptEncoding: 'master-null-elision-v1' };
  const result = await handleInventoryReclassMove({ supabase, actorProfile: actor, payload: compactCommand });
  assert.equal(calls[0].name, 'apply_inventory_reclass_moves_with_delivery_v1');
  assert.equal(result.rowEncoding, 'master-null-elision-v1');
  assert.equal(result.importStatus, 'pending');
  assert.equal(calls[0].params.p_receipt_encoding, 'master-null-elision-v1');
  const status = await handleInventoryReclassMove({ supabase, actorProfile: actor,
    payload: { action: 'inventory_reclass_move', operation: 'status', commandId: command.commandId,
      receiptEncoding: 'master-null-elision-v1' } });
  assert.equal(calls[1].name, 'get_inventory_reclass_move_status_compact_v1');
  assert.deepEqual(status, compact);
  assert.deepEqual(calls[0].params.p_moves[0].source, source);
  assert.equal(Object.hasOwn(calls[0].params.p_moves[0], 'receiptEncoding'), false);
});

test('Reclass API rejects unsupported receipt codecs before RPC dispatch', async () => {
  let called = false;
  const supabase = { rpc: async () => { called = true; return { data: null, error: null }; } };
  await assert.rejects(handleInventoryReclassMove({ supabase, actorProfile: actor,
    payload: { ...command, receiptEncoding: 'unknown-v9' } }), /RECEIPT_ENCODING_UNSUPPORTED/);
  assert.equal(called, false);
});

test('Reclass API errors are sanitized and route registration remains in the app-api entrypoint', () => {
  assert.deepEqual(inventoryReclassMoveError({ code: '40001', message: 'INVENTORY_RECLASS_SOURCE_CHANGED', details: 'sensitive SQL' }), {
    status: 409,
    body: { ok: false, code: 'INVENTORY_RECLASS_SOURCE_CHANGED',
      message: 'Inventory identity changed before this move could be confirmed. Your draft is retained.' },
  });
  assert.equal(inventoryReclassMoveError({ code: '40001', message: 'INVENTORY_RECLASS_DESTINATION_SEASON_MISMATCH' }).status, 409);
  assert.equal(inventoryReclassMoveError({ message: 'secret database detail' }).body.code, 'INVENTORY_RECLASS_UNAVAILABLE');
  const entrypoint = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  assert.match(entrypoint, /action === "inventory_reclass_move"/);
  assert.match(entrypoint, /handleInventoryReclassMove\(\{ supabase, actorProfile: actor, payload \}\)/);
});
