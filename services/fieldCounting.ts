import type { Database } from '../supabase/functions/_shared/database.types';
import type { CountRow, CountingLotRow, CountingOption, CountingType, FieldCountingBridge, FieldCountingMutation, FieldCountingReceipt, FieldCountingSnapshot } from '../components/field-counting/contract';

type Inventory = Database['public']['Tables']['ph_master_inventory']['Row'];
type Observation = Database['public']['Tables']['ph_bunch_counts']['Row'];
const failureMessages: Readonly<Record<string, string>> = {
  FIELD_COUNT_REVISION_CONFLICT: 'These counts changed while you were editing. Refresh, review your entries, and save again.',
  FIELD_COUNT_SOURCE_CHANGED: 'Inventory in this location changed. Refresh and review your entries before saving.',
  FIELD_COUNT_INVENTORY_UPDATING: 'Inventory is updating. Your entries are retained; refresh after the import finishes.',
  FIELD_COUNT_FORBIDDEN: 'Your account cannot access field counting. Sign in again or contact a manager.',
  FIELD_COUNT_UNAVAILABLE: 'Field counting is temporarily unavailable. Your entries are retained. Try again.',
};
export type FieldCountingTransport = (payload: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid field-count response. Refresh before continuing.');
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => { if (typeof value !== 'string') throw new Error('Invalid field-count text.'); return value; };
const integer = (value: unknown): number => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid field-count quantity.'); return value; };
const countQuantity = (value: unknown): number => { const result = integer(value); if (result > 999_999_999) throw new Error('Count must be between zero and 999,999,999.'); return result; };
const list = (value: unknown, limit = 100): unknown[] => { if (!Array.isArray(value) || value.length > limit) throw new Error('Invalid field-count page.'); return value; };
const nullableText = (value: unknown): string | null => value === null ? null : text(value);
function lot(value: unknown): CountingLotRow {
  const row = record(value);
  const onHand: Inventory['ptronhand'] = nullableText(row.onHand);
  const sourceUid: Inventory['unique_id'] = text(row.sourceUid);
  if (!sourceUid) throw new Error('Missing inventory identity.');
  return { sourceUid, onHand, block: text(row.block), location: text(row.location), itemcode: text(row.itemcode),
    commonname: text(row.commonname), contsize: text(row.contsize), lotcode: text(row.lotcode), season: text(row.season) };
}
function count(value: unknown): CountRow {
  const row = record(value);
  const countedQty: Observation['counted_qty'] = row.countedQty === null ? null : countQuantity(row.countedQty);
  const updatedAt = text(row.updatedAt);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error('Missing count revision.');
  return { sourceUid: text(row.sourceUid), countedQty, direction: text(row.direction), rowOrder: integer(row.rowOrder),
    note: text(row.note), updatedAt, actor: text(row.actor) };
}
function option(value: unknown): CountingOption {
  const row = record(value); return { value: text(row.value), label: text(row.label), rowCount: integer(row.rowCount) };
}
export function fieldCountingSnapshot(value: unknown): FieldCountingSnapshot {
  const data = record(value);
  if (typeof data.complete !== 'boolean') throw new Error('Invalid count completeness.');
  const rows = list(data.rows).map(lot), counts = list(data.counts).map(count);
  const ids = new Set(rows.map(row => row.sourceUid));
  if (ids.size !== rows.length || new Set(counts.map(row => row.sourceUid)).size !== counts.length || counts.some(row => !ids.has(row.sourceUid))) {
    throw new Error('Invalid count row identities.');
  }
  return { rows, counts, options: list(data.options).map(option), datasetRevision: text(data.datasetRevision), masterRevision: text(data.masterRevision),
    page: integer(data.page), total: integer(data.total), complete: data.complete };
}
export function fieldCountingReceipt(value: unknown, completion = false): FieldCountingReceipt {
  const data = record(value), savedSourceUids = list(data.savedSourceUids).map(text);
  if (!savedSourceUids.length || new Set(savedSourceUids).size !== savedSourceUids.length) throw new Error('Count save was not confirmed.');
  const receipt: FieldCountingReceipt = { revision: text(data.revision), savedSourceUids };
  if (completion) {
    const reportId = text(data.reportId);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(reportId) || data.deliveryStatus !== 'queued') throw new Error('Completion report was not confirmed queued.');
    receipt.reportId = reportId; receipt.deliveryStatus = 'queued';
  }
  return receipt;
}

export function createFieldCountingBridge({ scopeKey, countType, revisionKey, transport, onRevision }: {
  scopeKey: string; countType: CountingType; revisionKey: string; transport: FieldCountingTransport;
  onRevision?: (countType: CountingType, revision: string) => void;
}): FieldCountingBridge {
  if (!scopeKey || !['bunch', 'spread'].includes(countType)) throw new Error('A signed-in counting scope is required.');
  async function request(operation: string, payload: Record<string, unknown>, commandId?: string, signal?: AbortSignal) {
    let raw: unknown;
    try { raw = await transport({ action: 'field_count', operation, payload, ...(commandId ? { commandId } : {}) }, signal); }
    catch (error) {
      if (error instanceof Error && failureMessages[error.message]) error.message = failureMessages[error.message];
      throw error;
    }
    const reply = record(raw);
    if (reply.ok !== true) {
      const message = typeof reply.message === 'string' ? reply.message : 'Field counts could not be confirmed.';
      throw new Error(failureMessages[message] || message);
    }
    return reply.data;
  }
  async function save(input: FieldCountingMutation, complete: boolean) {
    if (!['bunch', 'spread'].includes(input.countType) || !input.idempotencyKey) throw new Error('The counting scope changed. Reopen the current screen.');
    if (!Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > 100
      || input.entries.some(entry => !Number.isSafeInteger(entry.countedQty) || entry.countedQty < 0 || entry.countedQty > 999_999_999)) {
      throw new Error('A count batch must contain 1–100 whole counts between zero and 999,999,999.');
    }
    const { idempotencyKey, ...payload } = input;
    const receipt = fieldCountingReceipt(await request(complete ? 'complete' : 'save', payload, idempotencyKey), complete);
    if (receipt.savedSourceUids.length !== input.entries.length || input.entries.some(row => !receipt.savedSourceUids.includes(row.sourceUid))) {
      throw new Error('Not every count was confirmed. Keep this draft and refresh before retrying.');
    }
    onRevision?.(input.countType, receipt.revision);
    return receipt;
  }
  return { scopeKey, countType, revisionKey, onRevision,
    readSnapshot: async query => {
      if (!['bunch', 'spread'].includes(query.countType)) throw new Error('The count type changed.');
      const { signal, ...payload } = query;
      return fieldCountingSnapshot(await request('read', payload, undefined, signal));
    },
    saveCounts: input => save(input, false), completeAndEmail: input => save(input, true),
  };
}
