export type ReclassMoveDirection = 'move_up' | 'move_down';

export interface ReclassMoveLine {
  direction: ReclassMoveDirection;
  destinationSeason: string;
  quantity: number;
}

export interface ReclassMoveCommand {
  commandId: string;
  expectedRevision: number;
  moves: Array<{
    source: { uniqueId: string; identity: Record<string, string | null> };
    lines: ReclassMoveLine[];
  }>;
}

type JsonRecord = Record<string, unknown>;
const DESTINATION_SEASONS = new Set(['F1', 'S1', 'U1', 'U2', 'U3', 'X', 'Y', 'Z']);
const SOURCE_IDENTITY_FIELDS = [
  'unique_id', 'itemcode', 'contsize', 'locationcode', 'lotcode', 'season', 'ptronhand', 'ptravailable',
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strictKeys(value: JsonRecord, allowed: readonly string[], code: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(code);
}

function requiredText(value: unknown, code: string, maxLength = 512): string {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(code);
  return normalized;
}

function identityText(value: unknown, code: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 1000) throw new Error(code);
  return value;
}

function expectedQuantity(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('INVENTORY_RECLASS_SOURCE_INVALID');
    return String(value);
  }
  if (typeof value !== 'string' || value.length > 80) throw new Error('INVENTORY_RECLASS_SOURCE_INVALID');
  return value;
}

/** Strict request boundary shared with app-api. SQL repeats every live-state check. */
export function normalizeReclassMoveCommand(payload: JsonRecord): ReclassMoveCommand {
  strictKeys(payload, ['action', 'commandId', 'expectedRevision', 'source', 'lines', 'moves'], 'INVENTORY_RECLASS_PAYLOAD_INVALID');
  if (payload.action !== 'inventory_reclass_move') throw new Error('INVENTORY_RECLASS_ACTION_INVALID');
  const commandId = requiredText(payload.commandId, 'INVENTORY_RECLASS_COMMAND_INVALID', 180);
  if (!/^[A-Za-z0-9:_.-]{12,180}$/.test(commandId)) throw new Error('INVENTORY_RECLASS_COMMAND_INVALID');
  const expectedRevision = payload.expectedRevision;
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error('INVENTORY_RECLASS_REVISION_INVALID');
  }
  const normalizeMove = (sourceValue: unknown, linesValue: unknown) => {
    if (!isRecord(sourceValue)) throw new Error('INVENTORY_RECLASS_SOURCE_INVALID');
    strictKeys(sourceValue, ['uniqueId', 'identity'], 'INVENTORY_RECLASS_SOURCE_INVALID');
    if (typeof sourceValue.uniqueId !== 'string' || !sourceValue.uniqueId.trim() || sourceValue.uniqueId.length > 1000) {
      throw new Error('INVENTORY_RECLASS_SOURCE_INVALID');
    }
    const uniqueId = sourceValue.uniqueId;
    if (!isRecord(sourceValue.identity)) throw new Error('INVENTORY_RECLASS_SOURCE_INVALID');
    strictKeys(sourceValue.identity, SOURCE_IDENTITY_FIELDS, 'INVENTORY_RECLASS_SOURCE_INVALID');
    const identity: Record<string, string | null> = {};
    for (const field of SOURCE_IDENTITY_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(sourceValue.identity, field)) throw new Error('INVENTORY_RECLASS_SOURCE_INVALID');
      identity[field] = field === 'ptronhand' || field === 'ptravailable'
        ? expectedQuantity(sourceValue.identity[field])
        : identityText(sourceValue.identity[field], 'INVENTORY_RECLASS_SOURCE_INVALID');
    }
    if (identity.unique_id !== uniqueId) throw new Error('INVENTORY_RECLASS_SOURCE_INVALID');
    if (!Array.isArray(linesValue) || linesValue.length < 1 || linesValue.length > 100) {
      throw new Error('INVENTORY_RECLASS_LINES_INVALID');
    }
    const lines = linesValue.map((value): ReclassMoveLine => {
    if (!isRecord(value)) throw new Error('INVENTORY_RECLASS_LINE_INVALID');
    strictKeys(value, ['direction', 'destinationSeason', 'quantity'], 'INVENTORY_RECLASS_LINE_INVALID');
    const direction = value.direction;
    if (direction !== 'move_up' && direction !== 'move_down') throw new Error('INVENTORY_RECLASS_LINE_INVALID');
    const destinationSeason = requiredText(value.destinationSeason, 'INVENTORY_RECLASS_LINE_INVALID', 8).toUpperCase();
    if (!DESTINATION_SEASONS.has(destinationSeason)) throw new Error('INVENTORY_RECLASS_DESTINATION_INVALID');
    const quantity = value.quantity;
    if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
      throw new Error('INVENTORY_RECLASS_QUANTITY_INVALID');
    }
    return { direction, destinationSeason, quantity };
    });
    return { source: { uniqueId, identity }, lines };
  };
  let moves: ReclassMoveCommand['moves'];
  if (Array.isArray(payload.moves)) {
    if (payload.moves.length < 1 || payload.moves.length > 100 || payload.source !== undefined || payload.lines !== undefined) {
      throw new Error('INVENTORY_RECLASS_MOVES_INVALID');
    }
    moves = payload.moves.map((move) => {
      if (!isRecord(move)) throw new Error('INVENTORY_RECLASS_MOVE_INVALID');
      strictKeys(move, ['source', 'lines'], 'INVENTORY_RECLASS_MOVE_INVALID');
      return normalizeMove(move.source, move.lines);
    });
  } else {
    moves = [normalizeMove(payload.source, payload.lines)];
  }
  const totalLines = moves.reduce((total, move) => total + move.lines.length, 0);
  if (totalLines > 100) throw new Error('INVENTORY_RECLASS_LINES_INVALID');
  if (new Set(moves.map((move) => move.source.uniqueId)).size !== moves.length) throw new Error('INVENTORY_RECLASS_OVERLAP_INVALID');
  return { commandId, expectedRevision, moves };
}
