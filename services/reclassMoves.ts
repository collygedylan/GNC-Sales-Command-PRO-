import { normalizeReclassMoveCommand, type ReclassMoveCommand } from './reclassMove.ts';
import { decodeInventoryReclassReceipt } from './reclassReceipt.ts';

type JsonRecord = Record<string, unknown>;
type RequestOptions = { timeoutMs: number; label: string; idempotencyKey?: string };
type Request = (payload: JsonRecord, options: RequestOptions) => Promise<unknown>;
const RECEIPT_ENCODING = 'master-null-elision-v1';

export interface ConfirmedInventoryReclassMove {
  table: 'ph_master_inventory';
  row: JsonRecord;
}

export interface InventoryReclassMoveReceipt {
  ok: true;
  commandId: string;
  requestId: string;
  revision: string;
  rows: ConfirmedInventoryReclassMove[];
  seasonStocks?: { itemcode: string; season: string; openStock: number; seasonOnHand: number }[];
  movements: JsonRecord[];
  status: 'applied' | 'acknowledged' | 'pending' | 'conflict';
  importStatus?: 'pending' | 'acknowledged' | 'conflict';
}

export type InventoryReclassMoveStatus =
  | { status: 'missing' }
  | { status: 'pending' | 'conflict' }
  | { status: 'applied' | 'acknowledged'; receipt: InventoryReclassMoveReceipt };

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function revision(value: unknown): string {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new Error('INVENTORY_RECLASS_RECEIPT_REVISION_INVALID');
}

function stockQuantity(value: unknown): { coefficient: bigint; scale: number } | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  const normalized = text.replace(/,/g, '');
  const [whole, fraction = ''] = normalized.split('.');
  try { return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length }; }
  catch { return null; }
}

function rowValue(row: JsonRecord, field: string): unknown {
  return row[field] !== undefined ? row[field] : row[field.toUpperCase()];
}

function unwrap(value: unknown): unknown {
  if (!record(value)) throw new Error('INVENTORY_RECLASS_RECEIPT_INVALID');
  if (value.ok === false) throw new Error(String(value.message || value.error || 'INVENTORY_RECLASS_REJECTED'));
  return value.data ?? value;
}

export function confirmedInventoryReclassMoveReceipt(value: unknown): InventoryReclassMoveReceipt {
  const result = decodeInventoryReclassReceipt(unwrap(value));
  if (!record(result)) throw new Error('INVENTORY_RECLASS_RECEIPT_INVALID');
  if (result.status === 'pending' || result.status === 'conflict') {
    const error = new Error(result.status === 'pending' ? 'INVENTORY_RECLASS_OUTCOME_PENDING' : 'INVENTORY_RECLASS_CONFLICT');
    Object.assign(error, { code: result.status === 'pending' ? 'INVENTORY_RECLASS_OUTCOME_PENDING' : 'INVENTORY_RECLASS_CONFLICT',
      status: result.status === 'pending' ? 503 : 409 });
    throw error;
  }
  if (result.ok !== true || typeof result.commandId !== 'string' || !result.commandId.trim()
    || typeof result.requestId !== 'string' || !result.requestId.trim()
    || !Array.isArray(result.rows) || result.rows.length < 2 || result.rows.length > 200
    || !Array.isArray(result.movements) || result.movements.length < 1 || result.movements.length > 100
    || !['applied', 'acknowledged'].includes(String(result.status || ''))) {
    throw new Error('INVENTORY_RECLASS_RECEIPT_INVALID');
  }
  const seenRows = new Set<string>();
  const rows = result.rows.map((raw): ConfirmedInventoryReclassMove => {
    if (!record(raw) || raw.table !== 'ph_master_inventory' || !record(raw.row)) throw new Error('INVENTORY_RECLASS_RECEIPT_ROW_INVALID');
    const uid = String(raw.row.unique_id || '').trim();
    if (!uid || seenRows.has(uid)) throw new Error('INVENTORY_RECLASS_RECEIPT_ROW_INVALID');
    seenRows.add(uid);
    for (const field of ['itemcode', 'locationcode', 'lotcode', 'season', 'ptronhand', 'ptravailable']) {
      if (!(field in raw.row) || raw.row[field] !== null && typeof raw.row[field] !== 'string') {
        throw new Error('INVENTORY_RECLASS_RECEIPT_ROW_INVALID');
      }
    }
    return { table: 'ph_master_inventory', row: raw.row };
  });
  const movements = result.movements.map((raw) => {
    if (!record(raw) || !['move_up', 'move_down'].includes(String(raw.direction || ''))
      || typeof raw.sourceUniqueId !== 'string' || typeof raw.destinationUniqueId !== 'string'
      || !seenRows.has(raw.sourceUniqueId) || !seenRows.has(raw.destinationUniqueId)
      || typeof raw.destinationSeason !== 'string' || !Number.isSafeInteger(raw.quantity) || Number(raw.quantity) < 1
      || raw.status != null && !['pending', 'acknowledged', 'conflict'].includes(String(raw.status))) {
      throw new Error('INVENTORY_RECLASS_RECEIPT_MOVEMENT_INVALID');
    }
    return raw;
  });
  const seasonStocks = result.seasonStocks === undefined ? [] : result.seasonStocks;
  if (!Array.isArray(seasonStocks) || seasonStocks.length > 1000 || seasonStocks.some(s => !record(s)
    || typeof s.itemcode !== 'string' || typeof s.season !== 'string'
    || typeof s.openStock !== 'number' || !Number.isFinite(s.openStock)
    || typeof s.seasonOnHand !== 'number' || !Number.isFinite(s.seasonOnHand))) throw new Error('INVENTORY_RECLASS_RECEIPT_STOCK_INVALID');
  return { seasonStocks: seasonStocks as NonNullable<InventoryReclassMoveReceipt['seasonStocks']>, ok: true, commandId: result.commandId, requestId: result.requestId, revision: revision(result.revision), rows, movements,
    status: result.status as InventoryReclassMoveReceipt['status'],
    ...(result.importStatus === 'pending' || result.importStatus === 'acknowledged' || result.importStatus === 'conflict'
      ? { importStatus: result.importStatus } : {}) };
}

export function assertInventoryReclassMoveReceiptMatchesCommand(
  receipt: InventoryReclassMoveReceipt, command: ReclassMoveCommand,
): InventoryReclassMoveReceipt {
  if (receipt.commandId !== command.commandId) throw new Error('INVENTORY_RECLASS_RECEIPT_COMMAND_MISMATCH');
  const expected = command.moves.flatMap((move) => move.lines.map((line) => ({ source: move.source.uniqueId,
    direction: line.direction, destinationSeason: line.destinationSeason.toUpperCase(), quantity: line.quantity })));
  if (receipt.movements.length !== expected.length) throw new Error('INVENTORY_RECLASS_RECEIPT_MOVEMENTS_MISMATCH');
  const used = new Set<number>();
  for (const line of expected) {
    const index = receipt.movements.findIndex((movement, movementIndex) => !used.has(movementIndex)
      && movement.sourceUniqueId === line.source && movement.direction === line.direction
      && movement.destinationSeason === line.destinationSeason && movement.quantity === line.quantity);
    if (index < 0) throw new Error('INVENTORY_RECLASS_RECEIPT_MOVEMENTS_MISMATCH');
    used.add(index);
  }
  const rowsById = new Map(receipt.rows.map((entry) => [String(entry.row.unique_id), entry.row]));
  const movedQuantityBySource = new Map<string, number>();
  for (const line of expected) movedQuantityBySource.set(line.source, (movedQuantityBySource.get(line.source) || 0) + line.quantity);
  for (const move of command.moves) {
    const row = rowsById.get(move.source.uniqueId);
    if (!row) throw new Error('INVENTORY_RECLASS_RECEIPT_SOURCE_MISMATCH');
    for (const field of ['itemcode', 'contsize', 'locationcode', 'lotcode', 'season']) {
      const requested = move.source.identity[field];
      if (requested !== undefined && (row[field] == null ? null : String(row[field])) !== requested) {
        throw new Error('INVENTORY_RECLASS_RECEIPT_SOURCE_MISMATCH');
      }
    }
    const moved = movedQuantityBySource.get(move.source.uniqueId) || 0;
    for (const field of ['ptronhand', 'ptravailable']) {
      const before = stockQuantity(move.source.identity[field]);
      const after = stockQuantity(rowValue(row, field));
      if (before === null || after === null) {
        throw new Error(`INVENTORY_RECLASS_RECEIPT_SOURCE_${field.toUpperCase()}_MISMATCH`);
      }
      const scale = Math.max(before.scale, after.scale);
      const factor = 10n ** BigInt(scale);
      const beforeAtScale = before.coefficient * (10n ** BigInt(scale - before.scale));
      const afterAtScale = after.coefficient * (10n ** BigInt(scale - after.scale));
      if (afterAtScale !== beforeAtScale - BigInt(moved) * factor) {
        throw new Error(`INVENTORY_RECLASS_RECEIPT_SOURCE_${field.toUpperCase()}_MISMATCH`);
      }
    }
  }
  for (const movement of receipt.movements) {
    const source = command.moves.find((move) => move.source.uniqueId === String(movement.sourceUniqueId));
    const destination = rowsById.get(String(movement.destinationUniqueId));
    if (!source || !destination) throw new Error('INVENTORY_RECLASS_RECEIPT_DESTINATION_MISMATCH');
    const sourceRow = rowsById.get(source.source.uniqueId)!;
    const sourceLot = String(source.source.identity.lotcode || '');
    const targetLot = `${sourceLot.replace(/[.][^.]+$/, '')}.${movement.destinationSeason}`;
    for (const field of ['itemcode', 'contsize', 'locationcode']) {
      const requested = source.source.identity[field];
      if (requested !== undefined && (destination[field] == null ? null : String(destination[field])) !== requested) {
        throw new Error('INVENTORY_RECLASS_RECEIPT_DESTINATION_MISMATCH');
      }
    }
    const physical = (row: JsonRecord, field: string) => rowValue(row, field) ?? null;
    for (const field of ['source', 'desigitem', 'desigcust', 'desigloc']) {
      if (String(physical(destination, field) ?? '') !== String(physical(sourceRow, field) ?? '')) {
        throw new Error('INVENTORY_RECLASS_RECEIPT_DESTINATION_MISMATCH');
      }
    }
    const destinationWarehouse = physical(destination, 'warehouseid') ?? physical(destination, 'warehousei') ?? '';
    const sourceWarehouse = physical(sourceRow, 'warehouseid') ?? physical(sourceRow, 'warehousei') ?? '';
    if (String(destinationWarehouse) !== String(sourceWarehouse)) throw new Error('INVENTORY_RECLASS_RECEIPT_DESTINATION_MISMATCH');
    if (String(destination.lotcode || '') !== targetLot || String(destination.season || '').toUpperCase() !== movement.destinationSeason) {
      throw new Error('INVENTORY_RECLASS_RECEIPT_DESTINATION_MISMATCH');
    }
    if (String(sourceRow.unique_id) === String(destination.unique_id)) throw new Error('INVENTORY_RECLASS_RECEIPT_DESTINATION_MISMATCH');
  }
  return receipt;
}

/** App API wrapper preserves the exact command body for safe retries after an unknown outcome. */
export function createInventoryReclassMovesService(request: Request) {
  return {
    async submit(input: JsonRecord): Promise<InventoryReclassMoveReceipt> {
      const command: ReclassMoveCommand = normalizeReclassMoveCommand({ action: 'inventory_reclass_move', ...input });
      const payload: JsonRecord = { action: 'inventory_reclass_move', ...command, receiptEncoding: RECEIPT_ENCODING };
      const response = await request(payload, { timeoutMs: 30000, label: 'Inventory Reclass move', idempotencyKey: command.commandId });
      try {
        return assertInventoryReclassMoveReceiptMatchesCommand(confirmedInventoryReclassMoveReceipt(response), command);
      } catch (error) {
        // A response arrived after the server may have committed. Keep the command
        // fenced for status lookup/retry if its receipt cannot be trusted locally.
        if (error instanceof Error) Object.assign(error, { outcomeUncertain: true });
        throw error;
      }
    },
    async status(commandId: string, expectedCommand?: JsonRecord): Promise<InventoryReclassMoveStatus> {
      const id = String(commandId || '').trim();
      if (!/^[A-Za-z0-9:_.-]{12,180}$/.test(id)) throw new Error('INVENTORY_RECLASS_COMMAND_INVALID');
      const rawResponse = await request({ action: 'inventory_reclass_move', operation: 'status', commandId: id, receiptEncoding: RECEIPT_ENCODING },
        { timeoutMs: 15000, label: 'Inventory Reclass status' });
      try {
        const response = decodeInventoryReclassReceipt(unwrap(rawResponse));
        if (!record(response) || response.ok !== true || !['missing', 'pending', 'applied', 'acknowledged', 'conflict'].includes(String(response.status || ''))) {
          throw new Error('INVENTORY_RECLASS_STATUS_INVALID');
        }
        if (response.status === 'applied' || response.status === 'acknowledged') {
          const receipt = confirmedInventoryReclassMoveReceipt(response);
          if (expectedCommand) {
            const command = normalizeReclassMoveCommand({ action: 'inventory_reclass_move', ...expectedCommand });
            if (command.commandId !== id) throw new Error('INVENTORY_RECLASS_STATUS_COMMAND_MISMATCH');
            return { status: response.status, receipt: assertInventoryReclassMoveReceiptMatchesCommand(receipt, command) };
          }
          return { status: response.status, receipt };
        }
        return { status: response.status as 'missing' | 'pending' | 'conflict' };
      } catch (error) {
        // Status is the recovery path. Any unusable response leaves the
        // command unresolved; it must never cause optimistic rollback.
        if (error instanceof Error) Object.assign(error, { outcomeUncertain: true });
        throw error;
      }
    }
  };
}

export { normalizeReclassMoveCommand };
